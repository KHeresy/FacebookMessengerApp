const { app, BrowserWindow, shell, Menu, session, Notification, dialog } = require('electron');
const path = require('path');
const windowStateKeeper = require('electron-window-state');

if (process.platform === 'win32' && app.isPackaged) {
  app.setAppUserModelId('com.electron.fbmessenger');
}

let notificationsEnabled = true;
let mainWindow;

const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', (event, commandLine, workingDirectory) => {
    // Someone tried to run a second instance, we should focus our window.
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  function createWindow() {
    // Load the previous state with fallback to defaults
    let mainWindowState = windowStateKeeper({
      defaultWidth: 640,
      defaultHeight: 800
    });

    // Create the browser window.
    mainWindow = new BrowserWindow({
      x: mainWindowState.x,
      y: mainWindowState.y,
      width: mainWindowState.width,
      height: mainWindowState.height,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
      }
    });
    
    // Spoof User Agent to look like regular Chrome
    mainWindow.webContents.userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

    let lastNotifiedTitle = '';

    // Monitor Title Changes for Notifications
    mainWindow.on('page-title-updated', (event, title) => {
      // Messenger titles often cycle between "(1) User" and "Message Text".
      // We ignore the ones starting with a count (e.g. "(1)") so they don't reset our duplicate check
      // or trigger unwanted notifications.
      if (/^\(\d+\)/.test(title)) {
        return;
      }

      // If the window is focused, we assume the user sees the message, so no notification.
      // If the title is generic 'Messenger', ignore it.
      if (notificationsEnabled && !mainWindow.isFocused() && title !== 'Messenger') {
        // Prevent duplicate notifications for the exact same title text
        if (title === lastNotifiedTitle) {
          return;
        }
        lastNotifiedTitle = title;

        const notification = new Notification({
          title: 'New Message',
          body: title, // The title usually contains "User sent a message"
          silent: false
        });

        notification.on('click', () => {
          if (mainWindow) {
            if (mainWindow.isMinimized()) mainWindow.restore();
            mainWindow.focus();
          }
        });

        notification.show();
      }
    });

    // Reset the last notified title when user focuses the window
    mainWindow.on('focus', () => {
      lastNotifiedTitle = '';
    });

    // Let us register listeners on the window, so we can update the state
    // automatically (the listeners will be removed when the window is closed)
    // and restore the maximized or full screen state
    mainWindowState.manage(mainWindow);

    // Load the Facebook Messages URL.
    mainWindow.loadURL('https://www.messenger.com/');

    // Intercept in-page navigation (e.g. clicking links)
    mainWindow.webContents.on('will-navigate', (event, url) => {
      const parsedUrl = new URL(url);
      const hostname = parsedUrl.hostname;
      const pathname = parsedUrl.pathname;

      // Allow navigation strictly to messenger.com (but not subdomains like l.messenger.com)
      if (hostname === 'www.messenger.com' || hostname === 'm.messenger.com') {
        return;
      }

      // Allow navigation to facebook login/auth pages
      // Common paths: /login.php, /vX.X/dialog/oauth, /checkpoint, etc.
      if (hostname.endsWith('facebook.com') && 
         (pathname.includes('/login') || pathname.includes('/dialog/') || pathname.includes('/checkpoint'))) {
        return;
      }

      // For everything else (including l.facebook.com, generic facebook.com, and external sites),
      // block navigation and open externally.
      event.preventDefault();
      shell.openExternal(url);
    });

    // Open links externally (handling target="_blank" / window.open)
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
      const parsedUrl = new URL(url);
      const hostname = parsedUrl.hostname;
      const pathname = parsedUrl.pathname;

      // If it's a messenger.com link, keep it in the app (main window)
      if (hostname === 'www.messenger.com' || hostname === 'm.messenger.com') {
        mainWindow.loadURL(url);
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.focus();
        return { action: 'deny' };
      }

      // If it's a specific facebook auth link, allow it to open a popup window (standard behavior)
      // We do NOT force the main window to navigate, preventing white-out on shims.
      if (hostname.endsWith('facebook.com') && 
         (pathname.includes('/login') || pathname.includes('/dialog/') || pathname.includes('/checkpoint'))) {
        return { action: 'allow' };
      }

      // All other links (external sites, l.facebook.com redirects, etc.) -> Open in System Browser
      shell.openExternal(url);
      return { action: 'deny' };
    });
  }

  // This method will be called when Electron has finished
  // initialization and is ready to create browser windows.
  // Some APIs can only be used after this event occurs.
  app.whenReady().then(() => {
  const debugMenu = {
    label: 'Debug',
    submenu: [
      {
        label: 'Go Back',
        accelerator: 'Alt+Left',
        click: () => {
          const win = BrowserWindow.getFocusedWindow();
          if (win && win.webContents.canGoBack()) {
            win.webContents.goBack();
          }
        }
      },
      {
        label: 'Show Current URL',
        click: () => {
          const win = BrowserWindow.getFocusedWindow();
          if (win) {
            dialog.showMessageBox(win, {
              type: 'info',
              title: 'Current URL',
              message: win.webContents.getURL(),
              buttons: ['OK']
            });
          }
        }
      },
      {
        label: 'Open DevTools',
        click: () => {
           const win = BrowserWindow.getFocusedWindow();
           if (win) win.webContents.openDevTools({ mode: 'detach' });
        }
      }
    ]
  };

  const template = [
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' }
      ]
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        { type: 'separator' },
        {
          label: 'Enable Background Notifications',
          type: 'checkbox',
          checked: true,
          click: (menuItem) => {
            notificationsEnabled = menuItem.checked;
          }
        }
      ]
    },
    debugMenu,
    {
      label: 'Help',
      submenu: [
        {
          label: 'About',
          click: () => {
            dialog.showMessageBox(BrowserWindow.getFocusedWindow() || undefined, {
              type: 'info',
              title: 'About',
              message: `Facebook Messenger\nVersion: ${app.getVersion()}`,
              buttons: ['OK']
            });
          }
        }
      ]
    }
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);

  // Handle permission requests (e.g. for notifications)
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    console.log(`Permission requested: ${permission}`); // Debug log
    if (permission === 'notifications') {
      callback(true);
    } else {
      callback(false);
    }
  });

  createWindow();

  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});
}

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit();
});
