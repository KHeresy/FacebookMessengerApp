const { app, BrowserWindow, shell, Menu, session, Notification, dialog, nativeImage, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const windowStateKeeper = require('electron-window-state');
const translations = require('./translations');

if (process.platform === 'win32') {
  app.setAppUserModelId('com.electron.fbmessenger');
}

let notificationsEnabled = true;
let mainWindow;
let currentLang = 'zh-TW'; // Default language

// Config persistence
const configPath = path.join(app.getPath('userData'), 'config.json');

function loadConfig() {
  try {
    if (fs.existsSync(configPath)) {
      const data = fs.readFileSync(configPath, 'utf8');
      const config = JSON.parse(data);
      if (config.language) {
        currentLang = config.language;
      }
    }
  } catch (e) {
    console.error('Failed to load config:', e);
  }
}

function saveConfig() {
  try {
    const config = { language: currentLang };
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  } catch (e) {
    console.error('Failed to save config:', e);
  }
}

// Load config initially
loadConfig();

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

  ipcMain.on('update-badge', (event, { dataUrl, text }) => {
    if (mainWindow) {
      if (dataUrl) {
        const img = nativeImage.createFromDataURL(dataUrl);
        mainWindow.setOverlayIcon(img, text);
      } else {
        mainWindow.setOverlayIcon(null, '');
      }
    }
  });

  // Helper to get text based on current language
  function t(key) {
    return translations[currentLang][key] || key;
  }

  function updateApplicationMenu() {
    const debugMenu = {
      label: t('debug'),
      submenu: [
        {
          label: t('goBack'),
          accelerator: 'Alt+Left',
          click: () => {
            const win = BrowserWindow.getFocusedWindow();
            if (win && win.webContents.canGoBack()) {
              win.webContents.goBack();
            }
          }
        },
        {
          label: t('showCurrentUrl'),
          click: () => {
            const win = BrowserWindow.getFocusedWindow();
            if (win) {
              dialog.showMessageBox(win, {
                type: 'info',
                title: t('showCurrentUrl'),
                message: win.webContents.getURL(),
                buttons: ['OK']
              });
            }
          }
        },
        {
          label: t('openDevTools'),
          click: () => {
             const win = BrowserWindow.getFocusedWindow();
             if (win) win.webContents.openDevTools({ mode: 'detach' });
          }
        }
      ]
    };

    const template = [
      {
        label: t('view'),
        submenu: [
          { label: t('reload'), role: 'reload' },
          { label: t('forceReload'), role: 'forceReload' },
          { type: 'separator' },
          { label: t('resetZoom'), role: 'resetZoom' },
          { label: t('zoomIn'), role: 'zoomIn' },
          { label: t('zoomOut'), role: 'zoomOut' },
          { type: 'separator' },
          { label: t('toggleFullscreen'), role: 'togglefullscreen' },
          { type: 'separator' },
          {
            label: t('enableNotifications'),
            type: 'checkbox',
            checked: notificationsEnabled,
            click: (menuItem) => {
              notificationsEnabled = menuItem.checked;
            }
          },
          {
            label: t('launchAtStartup'),
            type: 'checkbox',
            checked: app.getLoginItemSettings().openAtLogin,
            click: (menuItem) => {
              app.setLoginItemSettings({
                openAtLogin: menuItem.checked
              });
            }
          },
          { type: 'separator' },
          {
            label: t('language'),
            submenu: [
              {
                label: 'English',
                type: 'radio',
                checked: currentLang === 'en',
                click: () => {
                  if (currentLang !== 'en') {
                    currentLang = 'en';
                    saveConfig();
                    updateApplicationMenu();
                  }
                }
              },
              {
                label: '繁體中文',
                type: 'radio',
                checked: currentLang === 'zh-TW',
                click: () => {
                  if (currentLang !== 'zh-TW') {
                    currentLang = 'zh-TW';
                    saveConfig();
                    updateApplicationMenu();
                  }
                }
              }
            ]
          }
        ]
      },
      debugMenu,
      {
        label: t('help'),
        submenu: [
          {
            label: t('about'),
            click: async () => {
              const { response } = await dialog.showMessageBox(BrowserWindow.getFocusedWindow() || undefined, {
                type: 'info',
                title: t('about'),
                message: `Facebook Messenger\nVersion: ${app.getVersion()}\nElectron: ${process.versions.electron}\nChrome: ${process.versions.chrome}`,
                buttons: ['OK', t('github')],
                defaultId: 0,
                cancelId: 0
              });

              if (response === 1) {
                shell.openExternal('https://github.com/KHeresy/FacebookMessengerApp');
              }
            }
          }
        ]
      }
    ];

    const menu = Menu.buildFromTemplate(template);
    Menu.setApplicationMenu(menu);
  }

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
        preload: path.join(__dirname, 'preload.js')
      }
    });
    
    // Spoof User Agent to look like regular Chrome
    mainWindow.webContents.userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

    let lastNotifiedTitle = '';
    let lastNotificationTime = 0;
    let notificationTimer = null;

    const showNotification = (title) => {
      lastNotifiedTitle = title;
      lastNotificationTime = Date.now();

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
      mainWindow.flashFrame(true);
    };

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
        
        const now = Date.now();
        const COOLDOWN = 1000; // 3 seconds

        if (now - lastNotificationTime >= COOLDOWN) {
          if (notificationTimer) {
            clearTimeout(notificationTimer);
            notificationTimer = null;
          }
          showNotification(title);
        } else {
          if (notificationTimer) clearTimeout(notificationTimer);
          
          const remaining = COOLDOWN - (now - lastNotificationTime);
          notificationTimer = setTimeout(() => {
            showNotification(title);
            notificationTimer = null;
          }, remaining);
        }
      }
    });

    // Reset the last notified title when user focuses the window
    mainWindow.on('focus', () => {
      lastNotifiedTitle = '';
      if (notificationTimer) {
        clearTimeout(notificationTimer);
        notificationTimer = null;
      }
      mainWindow.flashFrame(false);
    });

    // Let us register listeners on the window, so we can update the state
    // automatically (the listeners will be removed when the window is closed)
    // and restore the maximized or full screen state
    mainWindowState.manage(mainWindow);

    // Load the Facebook Messages URL.
    mainWindow.loadURL('https://www.messenger.com/');

    // Context Menu
    mainWindow.webContents.on('context-menu', (event, params) => {
      const menuTemplate = [
        {
          label: t('selectAllSingleMessage'), // Select All Single Message
          click: () => {
            mainWindow.webContents.send('select-all-message');
          }
        },
        { type: 'separator' },
        { label: t('copy'), role: 'copy' }, // Copy
        { label: t('paste'), role: 'paste' }  // Paste
      ];

      if (params.mediaType === 'image') {
        menuTemplate.push({ type: 'separator' });
        menuTemplate.push({
          label: t('copyImage'), // Copy Image
          click: () => {
            mainWindow.webContents.copyImageAt(params.x, params.y);
          }
        });
      }

      if (params.linkURL) {
        menuTemplate.push({ type: 'separator' });
        menuTemplate.push({
          label: t('openInBrowser'), // Open in Browser
          click: () => {
            shell.openExternal(params.linkURL);
          }
        });
      }

      const menu = Menu.buildFromTemplate(menuTemplate);
      menu.popup(mainWindow);
    });

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
  // Handle permission requests (e.g. for notifications)
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    console.log(`Permission requested: ${permission}`); // Debug log
    if (permission === 'notifications') {
      callback(true);
    } else {
      callback(false);
    }
  });

  updateApplicationMenu();
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
