const path = require('path');
const { app, BrowserWindow, globalShortcut, ipcMain, Tray, Menu, desktopCapturer, session, nativeImage } = require('electron');
const { spawn } = require('child_process');
const WebSocket = require('ws');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

let mainWindow;
let tray;
let deepgramSocket;
let isTranscribing = false;
let audioChunksSent = 0;
let audioBytesSent = 0;
let dgMessages = 0;
let dgFinals = 0;

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 760,
    height: 520,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));

  mainWindow.on('close', (event) => {
    if (!app.isQuiting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });
}

function createTray() {
  const iconPath = path.join(__dirname, 'icon.png');
  const icon = nativeImage.createFromPath(iconPath);
  tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon);
  const contextMenu = Menu.buildFromTemplate([
    { label: 'Show', click: () => mainWindow.show() },
    { label: 'Start (Alt+S)', click: () => startTranscription() },
    { label: 'Stop (Alt+E)', click: () => stopTranscription() },
    {
      label: 'Quit',
      click: () => {
        app.isQuiting = true;
        stopTranscription();
        app.quit();
      }
    }
  ]);

  tray.setToolTip('System Audio Transcriber');
  tray.setContextMenu(contextMenu);
  tray.on('double-click', () => mainWindow.show());
}

function updateStatus(message) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('status-update', message);
  }
}

function registerShortcuts() {
  globalShortcut.register('Alt+S', () => {
    startTranscription();
  });

  globalShortcut.register('Alt+E', () => {
    stopTranscription();
  });

  globalShortcut.register('Alt+T', () => {
    typeIntoActiveWindow('typing test from SystemAudioTranscriber');
  });
}

function escapeForSendKeys(text) {
  return text.replace(/[+^%~(){}\[\]]/g, (m) => `{${m}}`);
}

function escapeForPowerShellSingleQuoted(text) {
  return text.replace(/'/g, "''");
}

function typeWithSendKeysFallback(text) {
  return new Promise((resolve, reject) => {
    const escaped = escapeForPowerShellSingleQuoted(escapeForSendKeys(text));
    const ps = [
      'Add-Type -AssemblyName System.Windows.Forms',
      `Start-Sleep -Milliseconds 40`,
      `[System.Windows.Forms.SendKeys]::SendWait('${escaped}')`
    ].join('; ');

    const child = spawn('powershell.exe', ['-NoProfile', '-Command', ps], { windowsHide: true });

    let err = '';
    child.stderr.on('data', (d) => {
      err += d.toString();
    });

    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(err || `SendKeys exited with code ${code}`));
    });
  });
}

async function typeIntoActiveWindow(text) {
  if (!text || !text.trim()) return;

  const sanitized = text.replace(/\s+/g, ' ').trim();
  if (!sanitized) return;

  try {
    await typeWithSendKeysFallback(`${sanitized} `);
    updateStatus('keyboard: SendKeys ok');
  } catch (error) {
    updateStatus(`typing error: ${error.message}`);
  }
}

function connectDeepgram() {
  const apiKey = process.env.DEEPGRAM_API_KEY;
  if (!apiKey) {
    updateStatus('error: missing DEEPGRAM_API_KEY in .env');
    return null;
  }

  const url =
    'wss://api.deepgram.com/v1/listen?model=nova-3&language=en-US&punctuate=true&interim_results=true&endpointing=300&smart_format=true';

  const socket = new WebSocket(url, {
    headers: {
      Authorization: `Token ${apiKey}`
    }
  });

  socket.on('open', () => {
    updateStatus('deepgram connected');
  });

  socket.on('message', (buffer) => {
    try {
      const data = JSON.parse(buffer.toString());
      dgMessages += 1;

      if (data?.type && data.type !== 'Results') {
        if (data.type === 'Metadata') {
          updateStatus('deepgram metadata received');
        }
        return;
      }

      const text =
        data?.channel?.alternatives?.[0]?.transcript ||
        data?.results?.channels?.[0]?.alternatives?.[0]?.transcript ||
        '';

      // Deepgram can send is_final=false while speech_final=true, so use OR.
      const isFinal = Boolean(data?.is_final) || Boolean(data?.speech_final);

      if (!isFinal && text) {
        updateStatus(`dg interim: ${text.slice(0, 40)}${text.length > 40 ? '...' : ''}`);
      }

      if (isFinal && text) {
        dgFinals += 1;
        updateStatus(`typing: ${text.slice(0, 60)}${text.length > 60 ? '...' : ''}`);
        typeIntoActiveWindow(text);
      }
    } catch (error) {
      updateStatus(`parse error: ${error.message}`);
    }
  });

  socket.on('close', () => {
    if (isTranscribing) {
      updateStatus('socket closed');
    }
  });

  socket.on('error', (err) => {
    updateStatus(`socket error: ${err.message}`);
  });

  return socket;
}

function startTranscription() {
  if (isTranscribing) {
    updateStatus('already running');
    return;
  }

  isTranscribing = true;
  audioChunksSent = 0;
  audioBytesSent = 0;
  dgMessages = 0;
  dgFinals = 0;
  updateStatus('starting...');

  deepgramSocket = connectDeepgram();
  if (!deepgramSocket) {
    isTranscribing = false;
    return;
  }

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('capture:start');
  }

  updateStatus('waiting for media capture...');
}

function stopTranscription() {
  if (!isTranscribing) {
    updateStatus('idle');
    return;
  }

  isTranscribing = false;

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('capture:stop');
  }

  if (deepgramSocket) {
    if (deepgramSocket.readyState === WebSocket.OPEN) {
      deepgramSocket.close();
    }
    deepgramSocket = null;
  }

  updateStatus('stopped');
}

ipcMain.on('audio:chunk', (_event, chunk) => {
  if (!isTranscribing || !deepgramSocket || deepgramSocket.readyState !== WebSocket.OPEN) {
    return;
  }

  try {
    const payload = Buffer.isBuffer(chunk)
      ? chunk
      : chunk instanceof ArrayBuffer
        ? Buffer.from(chunk)
        : Buffer.from(chunk);
    deepgramSocket.send(payload);
    audioChunksSent += 1;
    audioBytesSent += payload.length;
    if (audioChunksSent % 20 === 0) {
      updateStatus(`audio->dg chunks=${audioChunksSent} bytes=${audioBytesSent}`);
    }
  } catch (error) {
    updateStatus(`audio chunk error: ${error.message}`);
  }
});

ipcMain.on('capture:error', (_event, message) => {
  updateStatus(`capture error: ${message}`);
  stopTranscription();
});

ipcMain.on('capture:state', (_event, state) => {
  updateStatus(`capture ${state}`);
});

ipcMain.handle('transcription:start', () => {
  startTranscription();
});

ipcMain.handle('transcription:stop', () => {
  stopTranscription();
});

ipcMain.handle('diagnostics:get', () => {
  return {
    isTranscribing,
    deepgramState: deepgramSocket ? deepgramSocket.readyState : null,
    audioChunksSent,
    audioBytesSent,
    dgMessages,
    dgFinals
  };
});

ipcMain.handle('typing:test', async () => {
  await typeIntoActiveWindow('typing test from SystemAudioTranscriber');
  return true;
});

app.whenReady().then(() => {
  createMainWindow();

  session.defaultSession.setDisplayMediaRequestHandler(
    async (_request, callback) => {
      try {
        const sources = await desktopCapturer.getSources({ types: ['screen'] });
        const source = sources[0];

        if (!source) {
          callback({});
          return;
        }

        callback({ video: source, audio: 'loopback' });
      } catch {
        callback({});
      }
    },
    { useSystemPicker: false }
  );

  createTray();
  registerShortcuts();
  updateStatus('idle');

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  stopTranscription();
});
