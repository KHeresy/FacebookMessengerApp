const { app, BrowserWindow, shell, Menu, session, Notification } = require('electron');
const path = require('path');
const windowStateKeeper = require('electron-window-state');

if (process.platform === 'win32' && app.isPackaged) {
  app.setAppUserModelId('com.electron.fbmessenger');
}

let notificationsEnabled = true;

function createWindow() {
  // Load the previous state with fallback to defaults
  let mainWindowState = windowStateKeeper({
    defaultWidth: 640,
    defaultHeight: 800
  });

  // Create the browser window.
  const mainWindow = new BrowserWindow({
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

  // Monitor Title Changes for Notifications
  mainWindow.on('page-title-updated', (event, title) => {
    // If the window is focused, we assume the user sees the message, so no notification.
    // If the title is generic 'Messenger', ignore it.
    if (notificationsEnabled && !mainWindow.isFocused() && title !== 'Messenger') {
      new Notification({
        title: 'New Message',
        body: title, // The title usually contains "User sent a message"
        silent: false
      }).show();
    }
  });

  // Let us register listeners on the window, so we can update the state
  // automatically (the listeners will be removed when the window is closed)
  // and restore the maximized or full screen state
  mainWindowState.manage(mainWindow);

  // Load the Facebook Messages URL.
  mainWindow.loadURL('https://www.messenger.com/');

  // Open links externally
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    // If the URL is part of Messenger or Facebook messages, open it in the main window
    if (url.includes('messenger.com') || url.includes('facebook.com')) {
      mainWindow.loadURL(url);
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
      return { action: 'deny' };
    }

    shell.openExternal(url);
    return { action: 'deny' };
  });
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(() => {
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
        { role: 'toggleDevTools' },
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

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit();
});
