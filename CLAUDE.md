# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a simple Electron wrapper application for Facebook Messenger (https://www.messenger.com/). It packages the web version of Messenger as a standalone desktop app with native desktop features like notifications, taskbar badges, and system integration.

## Build and Development Commands

```bash
# Install dependencies
npm install

# Run in development mode
npm start

# Build installer for Windows
npm run build
```

The built installer is located at: `dist/Facebook Messenger.exe`

## Architecture

This is a minimal Electron app with three main components:

### 1. Main Process (main.js)

The main Electron process handles:

- **Window Management**: Uses `electron-window-state` to persist window size/position between sessions
- **Single Instance Lock**: Prevents multiple instances of the app from running simultaneously (main.js:12-23)
- **Notification System**: Monitors page title changes to detect new messages and shows native notifications when the window is unfocused (main.js:84-120)
  - Implements a 1-second cooldown to prevent notification spam
  - Uses a timer-based debouncing mechanism to queue notifications
  - Ignores titles starting with `(N)` format to avoid duplicate notifications
  - Resets notification state when window gains focus
- **Navigation Controls**: Intercepts navigation and link clicks to keep the app on messenger.com while opening external links in the system browser (main.js:141-188)
  - Allows navigation to messenger.com and Facebook auth pages
  - Opens all other URLs in external browser
- **Taskbar Badge**: Receives IPC messages from preload script to update the Windows taskbar overlay icon with unread message count
- **Application Menu**: Provides Edit, View, Debug, and Help menus with options to:
  - Toggle background notifications
  - Toggle launch at startup
  - View current URL and open DevTools (Debug menu)

### 2. Preload Script (preload.js)

Runs in the renderer context with access to Node.js APIs. Responsible for:

- **Badge Drawing**: Creates a canvas-based badge image with the unread message count (preload.js:3-36)
  - Draws a red circle with white text
  - Handles different font sizes for 1-9, 10-99, and 99+ messages
  - Generates a data URL for the badge image
- **Title Monitoring**: Uses MutationObserver to watch for title changes and extract message count from format `(N) Title`
- **IPC Communication**: Sends badge updates to the main process via `ipcRenderer.send('update-badge', ...)`

### 3. Package Configuration (package.json)

- **electron-builder**: Configured to build Windows NSIS installer
- **Target Output**: `dist/` directory
- **App ID**: `com.electron.fbmessenger`
- Uses latest versions of Electron and electron-builder

## Key Implementation Details

### User Agent Spoofing
The app sets a Chrome user agent (main.js:57) to ensure Facebook Messenger renders properly and doesn't show mobile or unsupported browser warnings.

### Security Context
The BrowserWindow is configured with security best practices:
- `nodeIntegration: false`
- `contextIsolation: true`
- Uses preload script for controlled Node.js access

### Platform-Specific Behavior
- Sets Windows App User Model ID for proper taskbar integration (main.js:5-7)
- macOS-specific: Window recreation on dock icon click (main.js:311-315)
- macOS-specific: App doesn't quit when all windows closed (main.js:322-324)

### Notification Behavior
- Only shows notifications when window is unfocused
- Title changes matching `(N)` pattern are ignored to prevent duplicates
- Generic "Messenger" titles are ignored
- Clicking notification focuses and restores the window
- Window flashing is enabled on new notifications and disabled on focus

## Testing the App

Since there are no automated tests, manual testing should cover:
- Window state persistence (resize, move, relaunch)
- Single instance lock (try launching multiple times)
- Notifications when receiving messages (window unfocused)
- Badge updates in taskbar
- External link handling (should open in browser)
- Login flow (should stay in app)
- Navigation within Messenger
- Launch at startup functionality
