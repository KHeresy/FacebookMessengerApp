# Facebook Messenger App

A lightweight, Electron-based desktop application for [Facebook Messenger](https://www.facebook.com/messages/). This project wraps the official web interface into a native-feeling desktop app with enhanced features.

[中文說明 (Traditional Chinese)](README-tw.md)

## Features

*   **Native Experience**: Standalone desktop application window, separate from your browser.
*   **Multi-language Support**: Interface available in **English** and **Traditional Chinese (繁體中文)**.
*   **Auto Updates**: Automatically checks for new versions from GitHub Releases and notifies you.
*   **Desktop Notifications**: Choose "Original Web Notifications" or "Messenger Only (App Notifications)" under View → Notification Mode. Messenger-only mode blocks Facebook's web notifications and compares known conversations' latest previews and unread styling, including styling that updates shortly after the preview. Unread-badge increases and Messenger page-title changes are fallbacks. View → Show Message Previews in Notifications controls whether readable previews appear (enabled by default); badge/title-only signals and grouped messages use generic text. Previews may be truncated by Facebook. Duplicate signals are coalesced; distinct conversation/badge arrivals during the toast cooldown are delayed and may be grouped. Stable unread-count decreases reset the notification baseline. On Windows, confirmed conversation alerts persist until read; title/badge-only alerts without a known conversation are acknowledged after returning to Messenger and rescanning. Reliable zero unread clears alerts and pending notifications, while stale renderer badges cannot restore a cleared app alert. A missing or unrecognized badge is unknown, not zero; an empty previously recognized control must remain stable before reporting zero, and visible unread conversations override it. View → Clear Unread Alert is available when read state cannot be determined. Initial unread items, manual mark-as-unread without a recent preview change, and newly encountered conversations without a baseline do not trigger conversation signals. Detection depends on Facebook's page structure: identical consecutive previews without another signal can still be missed, and title-only signals can misidentify events. Both modes respect the persisted Enable Background Notifications switch.
*   **Enhanced Context Menu**: Context-aware right-click support:
    *   **Editable Areas**: Undo, Redo, Cut, Copy, Paste, Select All.
    *   **Messages**: Copy Entire Message, Select All, Copy Image, Open Links.
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
