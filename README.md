# Facebook Messenger App

A lightweight, Electron-based desktop application for [Facebook Messenger](https://www.facebook.com/messages/). This project wraps the official web interface into a native-feeling desktop app with enhanced features.

[中文說明 (Traditional Chinese)](README-tw.md)

## Features

*   **Native Experience**: Standalone desktop application window, separate from your browser.
*   **Multi-language Support**: Interface available in **English** and **Traditional Chinese (繁體中文)**.
*   **Auto Updates**: Automatically checks for new versions from GitHub Releases and notifies you.
*   **Desktop Notifications**:
    *   **Modes**: Choose "Original Web Notifications" or "Messenger Only (App Notifications)" under View → Notification Mode. Messenger-only mode blocks Facebook's web notifications and uses native app notifications.
    *   **New-message detection**: Messenger-only mode supports standard and end-to-end encrypted (E2EE) Facebook conversation rows. It compares preview changes and unread styling (bold previews or blue dots) in known conversations; unread-badge increases are a fallback signal. Page-title changes do not trigger notifications. Existing unread items on startup, manually marking a conversation unread without a recent preview change, and new conversations without a baseline do not trigger a conversation notification by themselves. The first conversation notification is sent immediately; later notifications have a one-second minimum interval, with distinct arrivals during the cooldown delayed and possibly grouped.
    *   **Message previews**: View → Show Message Previews in Notifications controls whether readable previews appear (enabled by default). When available, the notification title uses the sender or conversation name; grouped notifications include sender labels with each preview. Badge-only signals use generic text, and grouped previews are limited to 500 characters. Previews may already be truncated by Facebook.
    *   **Windows taskbar indicator**: The unread icon follows blue dots in successfully scanned conversation rows. It clears after no dots are confirmed for at least 1.5 seconds; if the list is temporarily unavailable, the last state is preserved. View → Clear Unread Alert clears the taskbar indicator (icon and flashing) without canceling a queued preview notification. In Messenger-only mode, a new notification while a dot is still present, or a confirmed dot disappearance followed by its return, can show the indicator again.
    *   **Limitations and settings**: Detection depends on Facebook's page structure; identical consecutive previews or an unloaded list can still cause missed or mistaken signals. Both modes respect the View → Enable Background Notifications switch.
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
