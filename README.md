# Facebook Messenger App

A lightweight, Electron-based desktop application for [Facebook Messenger](https://www.messenger.com/). This project wraps the official web interface into a native-feeling desktop app with enhanced features.

[中文說明 (Traditional Chinese)](README-tw.md)

## Features

*   **Native Experience**: Standalone desktop application window, separate from your browser.
*   **Multi-language Support**: Interface available in **English** and **Traditional Chinese (繁體中文)**.
*   **Auto Updates**: Automatically checks for new versions from GitHub Releases and notifies you.
*   **Desktop Notifications**: Native system notifications for incoming messages.
*   **Enhanced Context Menu**: Right-click support for:
    *   Copying/Pasting text.
    *   Copying images.
    *   Opening links in the default browser.
    *   Select All.
*   **Security & Privacy**: External links and Facebook tracking URLs are automatically opened in your default browser for safety.
*   **Window State Management**: Remembers your window size and position.

## Installation

Download the latest installer for your operating system from the [Releases](https://github.com/KHeresy/FacebookMessengerApp/releases) page.

## Development

### Prerequisites

*   Node.js (LTS version recommended)
*   npm

### Setup

```bash
# Clone the repository
git clone https://github.com/KHeresy/FacebookMessengerApp.git

# Enter the directory
cd FacebookMessengerApp

# Install dependencies
npm install
```

### Run Locally

```bash
npm start
```

### Build

#### Windows

```bash
npm run build
# Installer located at: dist\Facebook Messenger.exe
```

#### macOS

```bash
npm run build -- --mac
# DMG/App located at: dist/
```

## Troubleshooting

### macOS: "App is damaged and can't be opened"

Since this application is not signed with an Apple Developer Certificate, macOS Gatekeeper may block it. To fix this:

1.  Open **Terminal**.
2.  Run the following command:
    ```bash
    sudo xattr -cr /Applications/Facebook\ Messenger.app
    ```
    *(Adjust the path if you installed it elsewhere)*
3.  You should now be able to open the app.