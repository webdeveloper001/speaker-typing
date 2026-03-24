# System Audio Transcriber (Electron)

This app captures **system speaker audio**, sends it to Deepgram for live transcription, and types finalized text into the currently focused input field using simulated keystrokes.

## Features

- Real-time transcription of system sound (speaker output)
- Global hotkeys:
  - `Alt+S` start transcription
  - `Alt+E` stop transcription
- Keeps running in the background (system tray)
- Writes transcript into currently selected input box

## Requirements

- Windows
- Node.js 18+
- Deepgram API key

## Setup

1. Copy env template:

   ```bash
   copy .env.example .env
   ```

2. Update `.env`:

   - `DEEPGRAM_API_KEY=...`

3. Install dependencies:

   ```bash
   npm install
   ```

4. Start app:

   ```bash
   npm start
   ```

## Build standalone executable (Windows)

This project is configured with `electron-forge`.

1. Install dependencies:

   ```bash
   npm install
   ```

2. Build Windows artifacts:

   ```bash
   npm run build:win
   ```

3. Find output in:

   - `out/make/zip/win32/x64/` (zip artifact)

## Notes on system audio capture

This version uses Electron/Chromium built-in media capture (`getDisplayMedia` + `MediaRecorder`) with loopback audio, so no FFmpeg setup is required.

## Important limitation

Keystroke simulation depends on OS permissions/focus behavior and target app security policies. Some elevated or protected apps may block synthetic input.
