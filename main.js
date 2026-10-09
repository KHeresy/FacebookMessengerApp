const { app, BrowserWindow, shell, Menu, session, Notification, dialog, nativeImage, ipcMain, clipboard } = require('electron');
const path = require('path');
const fs = require('fs');

// Handle Hardware Acceleration
if (process.argv.includes('--disable-gpu')) {
  console.log('Disabling hardware acceleration...');
  app.disableHardwareAcceleration();
}

const windowStateKeeper = require('electron-window-state');
const translations = require('./translations');

if (process.platform === 'win32') {
  app.setAppUserModelId('com.heresy.fbmessenger');
}

let notificationsEnabled = true;
let showMessagePreviews = true;
const NOTIFICATION_MODES = { WEB: 'web', MESSENGER_ONLY: 'messenger-only' };
let notificationMode = NOTIFICATION_MODES.MESSENGER_ONLY;
let checkForUpdates = true;
let ignoredVersion = '';
let hideTopBar = true;
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
      if (config.checkForUpdates !== undefined) {
        checkForUpdates = config.checkForUpdates;
      }
      if (config.ignoredVersion) {
        ignoredVersion = config.ignoredVersion;
      }
      if (config.hideTopBar !== undefined) {
        hideTopBar = config.hideTopBar;
      }
      if (typeof config.notificationsEnabled === 'boolean') {
        notificationsEnabled = config.notificationsEnabled;
      }
      if (typeof config.showMessagePreviews === 'boolean') {
        showMessagePreviews = config.showMessagePreviews;
      }
      if (Object.values(NOTIFICATION_MODES).includes(config.notificationMode)) {
        notificationMode = config.notificationMode;
      }
    }
  } catch (e) {
    console.error('Failed to load config:', e);
  }
}

function saveConfig() {
  try {
    const config = { language: currentLang, checkForUpdates, ignoredVersion, hideTopBar, notificationsEnabled, showMessagePreviews, notificationMode };
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

  ipcMain.on('update-badge', (event, badge) => {
    if (mainWindow && !mainWindow.isDestroyed() && event.sender === mainWindow.webContents &&
        event.senderFrame === mainWindow.webContents.mainFrame && isMessengerPage(event.sender.getURL()) &&
        badge && typeof badge.text === 'string' && badge.text.length <= 5 &&
        (badge.dataUrl === null || (typeof badge.dataUrl === 'string' &&
          badge.dataUrl.startsWith('data:image/png;base64,') && badge.dataUrl.length < 20000))) {
      mainWindow.updateBadgeOverlay(badge.dataUrl, badge.text);
    }
  });

  ipcMain.on('register-attention-icon', (event, dataUrl) => {
    if (mainWindow && !mainWindow.isDestroyed() && event.sender === mainWindow.webContents &&
        event.senderFrame === mainWindow.webContents.mainFrame && typeof dataUrl === 'string' &&
        dataUrl.startsWith('data:image/png;base64,') && dataUrl.length < 20000) {
      mainWindow.setAttentionIcon(dataUrl);
    }
  });

  // Only the main Messenger page may report unread conversation counts.
  ipcMain.on('messenger-unread-count', (event, count) => {
    if (!mainWindow || mainWindow.isDestroyed() || event.sender !== mainWindow.webContents ||
        event.senderFrame !== mainWindow.webContents.mainFrame || !isMessengerPage(event.sender.getURL()) ||
        (count !== null && (!Number.isSafeInteger(count) || count < 0 || count > 99999))) return;
    mainWindow.handleMessengerUnreadCount(count);
  });

  ipcMain.on('messenger-conversation-change', (event, change) => {
    if (!mainWindow || mainWindow.isDestroyed() || event.sender !== mainWindow.webContents ||
        event.senderFrame !== mainWindow.webContents.mainFrame ||
        !isMessengerConversationPage(event.sender.getURL()) ||
        !change || typeof change.thread !== 'string' || !/^[0-9a-f]{8}$/.test(change.thread) ||
        typeof change.message !== 'string' || !/^[0-9a-f]{8}$/.test(change.message) ||
        typeof change.preview !== 'string' || change.preview.length > 500) return;
    mainWindow.handleMessengerConversationChange(change);
  });

  ipcMain.on('messenger-conversation-read', (event, threadFingerprint) => {
    if (!mainWindow || mainWindow.isDestroyed() || event.sender !== mainWindow.webContents ||
        event.senderFrame !== mainWindow.webContents.mainFrame ||
        !isMessengerConversationPage(event.sender.getURL()) ||
        typeof threadFingerprint !== 'string' || !/^[0-9a-f]{8}$/.test(threadFingerprint)) return;
    mainWindow.handleMessengerConversationRead(threadFingerprint);
  });

  ipcMain.on('messenger-monitoring-scan', (event) => {
    if (!mainWindow || mainWindow.isDestroyed() || event.sender !== mainWindow.webContents ||
        event.senderFrame !== mainWindow.webContents.mainFrame ||
        !isMessengerConversationPage(event.sender.getURL())) return;
    mainWindow.handleMessengerMonitoringScan();
  });

  function isMessengerPage(url) {
    try {
      const { hostname, pathname, protocol } = new URL(url);
      return protocol === 'https:' && (
        ((hostname === 'www.facebook.com' || hostname === 'm.facebook.com') &&
          (pathname === '/messages' || pathname.startsWith('/messages/'))) ||
        hostname === 'www.messenger.com' || hostname === 'm.messenger.com'
      );
    } catch {
      return false;
    }
  }

  function isMessengerConversationPage(url) {
    try {
      const { hostname, pathname, protocol } = new URL(url);
      if (protocol !== 'https:') return false;
      if (hostname === 'www.facebook.com' || hostname === 'm.facebook.com') {
        return pathname === '/messages' || pathname === '/messages/' || pathname.startsWith('/messages/t/');
      }
      return (hostname === 'www.messenger.com' || hostname === 'm.messenger.com') &&
        (pathname === '/' || pathname.startsWith('/t/'));
    } catch {
      return false;
    }
  }

  function isMessageTitle(title) {
    const value = typeof title === 'string' ? title.trim() : '';
    return Boolean(value) && !/^\(\d+\)/.test(value) &&
      !/^(Messenger|Facebook|Messages)(\s*\|\s*Facebook)?$/i.test(value) &&
      !/\|\s*Facebook$/i.test(value);
  }

  function isFacebookOrigin(url) {
    try {
      const { hostname, protocol } = new URL(url);
      return protocol === 'https:' && (
        hostname === 'facebook.com' || hostname.endsWith('.facebook.com') ||
        hostname === 'messenger.com' || hostname.endsWith('.messenger.com')
      );
    } catch {
      return false;
    }
  }

  function allowWebNotifications(url) {
    return notificationsEnabled && notificationMode === NOTIFICATION_MODES.WEB && isFacebookOrigin(url);
  }

  ipcMain.on('copy-to-clipboard', (event, text) => {
    if (text) {
      clipboard.writeText(text);
    }
  });

  ipcMain.on('get-hide-top-bar', (event) => {
    event.returnValue = hideTopBar;
  });

  // Helper to get text based on current language
  function t(key) {
    const langData = translations[currentLang] || translations['zh-TW'] || translations['en'];
    return langData[key] || key;
  }

  // Helper to safely open external URLs (only http: and https: protocols allowed)
  function safeOpenExternal(url) {
    try {
      const parsedUrl = new URL(url);
      if (parsedUrl.protocol === 'http:' || parsedUrl.protocol === 'https:') {
        shell.openExternal(url);
      } else {
        console.warn(`Blocked opening non-http/https external URL: ${url}`);
      }
    } catch (e) {
      console.error(`Failed to parse URL for safe opening: ${url}`, e);
    }
  }

  async function checkUpdate(manual = false) {
    if (!checkForUpdates && !manual) return;

    try {
      const response = await fetch('https://api.github.com/repos/KHeresy/FacebookMessengerApp/releases/latest', {
        headers: { 'User-Agent': 'FacebookMessengerApp' }
      });
      if (!response.ok) return;
      const data = await response.json();
      const latestVersion = data.tag_name.replace(/^v/, '');

      if (!manual && latestVersion === ignoredVersion) return;

      const currentVersion = app.getVersion();

      // Split by dot or hyphen to handle 1.0.7-20251223 vs 1.0.7
      const v1 = currentVersion.split(/[.+-]/).map(Number);
      const v2 = latestVersion.split(/[.+-]/).map(Number);

      let hasUpdate = false;
      const len = Math.max(v1.length, v2.length);
      for (let i = 0; i < len; i++) {
        const a = v1[i] || 0;
        const b = v2[i] || 0;
        if (a < b) {
          hasUpdate = true;
          break;
        }
        if (a > b) break;
      }

      if (hasUpdate) {
        const focusedWin = BrowserWindow.getFocusedWindow();
        const activeWin = (focusedWin && !focusedWin.isDestroyed()) ? focusedWin : (mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined);
        const { response: btnIndex } = await dialog.showMessageBox(activeWin, {
          type: 'info',
          title: t('updateAvailable'),
          message: t('updateMessage').replace('{version}', latestVersion),
          buttons: [t('download'), t('later'), t('ignoreUpdate')],
          defaultId: 0,
          cancelId: 1
        });

        if (btnIndex === 0) {
          safeOpenExternal(data.html_url);
        } else if (btnIndex === 2) {
          ignoredVersion = latestVersion;
          saveConfig();
        }
      } else if (manual) {
        const focusedWin = BrowserWindow.getFocusedWindow();
        const activeWin = (focusedWin && !focusedWin.isDestroyed()) ? focusedWin : (mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined);
        dialog.showMessageBox(activeWin, {
          type: 'info',
          title: t('noUpdateAvailable'),
          message: t('latestVersionMessage'),
          buttons: ['OK']
        });
      }
    } catch (err) {
      console.error('Update check failed:', err);
      if (manual) {
        dialog.showErrorBox('Update Check Failed', err.message);
      }
    }
  }

  function updateApplicationMenu() {
    try {
      const debugMenu = {
        label: t('debug'),
        submenu: [
          {
            label: t('goBack'),
            accelerator: 'Alt+Left',
            click: () => {
              const win = BrowserWindow.getFocusedWindow() || mainWindow;
              if (win && win.webContents.canGoBack()) {
                win.webContents.goBack();
              }
            }
          },
          {
            label: t('showCurrentUrl'),
            click: () => {
              const win = BrowserWindow.getFocusedWindow() || mainWindow;
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
              const win = BrowserWindow.getFocusedWindow() || mainWindow;
              if (win) win.webContents.openDevTools({ mode: 'detach' });
            }
          },
          { type: 'separator' },
          {
            label: t('sendTestNotification'),
            click: () => {
              setTimeout(() => {
                const notification = new Notification({
                  title: t('testNotificationTitle'),
                  body: t('testNotificationBody'),
                  silent: false
                });

                notification.on('click', () => {
                  if (mainWindow) {
                    if (mainWindow.isMinimized()) mainWindow.restore();
                    mainWindow.focus();
                  }
                });

                notification.show();
                if (mainWindow) mainWindow.flashFrame(true);
              }, 3000);
            }
          }
        ]
      };

      const template = [
        ...(process.platform === 'darwin' ? [{
          label: app.name,
          submenu: [
            { role: 'about' },
            { type: 'separator' },
            { role: 'services' },
            { type: 'separator' },
            { role: 'hide' },
            { role: 'hideOthers' },
            { role: 'unhide' },
            { type: 'separator' },
            { role: 'quit' }
          ]
        }] : []),
        {
          label: t('edit'),
          submenu: [
            { label: t('undo'), role: 'undo' },
            { label: t('redo'), role: 'redo' },
            { type: 'separator' },
            { label: t('cut'), role: 'cut' },
            { label: t('copy'), role: 'copy' },
            { label: t('paste'), role: 'paste' },
            { label: t('selectAll'), role: 'selectAll' }
          ]
        },
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
              label: t('hideTopBar'),
              type: 'checkbox',
              checked: hideTopBar,
              click: (menuItem) => {
                hideTopBar = menuItem.checked;
                saveConfig();
                if (mainWindow && !mainWindow.isDestroyed()) {
                  mainWindow.webContents.send('toggle-top-bar', hideTopBar);
                }
              }
            },
            {
              label: t('enableNotifications'),
              type: 'checkbox',
              checked: notificationsEnabled,
              click: (menuItem) => {
                notificationsEnabled = menuItem.checked;
                saveConfig();
                if (mainWindow && !mainWindow.isDestroyed()) {
                  mainWindow.resetMessengerMonitoring();
                  if (!notificationsEnabled) mainWindow.clearUnreadAttention(true);
                }
              }
            },
            {
              label: t('notificationMode'),
              submenu: [
                {
                  label: t('webNotifications'),
                  type: 'radio',
                  checked: notificationMode === NOTIFICATION_MODES.WEB,
                  click: () => setNotificationMode(NOTIFICATION_MODES.WEB)
                },
                {
                  label: t('messengerOnlyNotifications'),
                  type: 'radio',
                  checked: notificationMode === NOTIFICATION_MODES.MESSENGER_ONLY,
                  click: () => setNotificationMode(NOTIFICATION_MODES.MESSENGER_ONLY)
                }
              ]
            },
            {
              label: t('showMessagePreviews'),
              type: 'checkbox',
              checked: showMessagePreviews,
              click: (menuItem) => {
                showMessagePreviews = menuItem.checked;
                saveConfig();
              }
            },
            {
              label: t('clearUnreadAttention'),
              click: () => {
                if (mainWindow && !mainWindow.isDestroyed()) mainWindow.clearUnreadAttention(true);
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
              label: t('checkUpdateNow'),
              click: () => {
                checkUpdate(true);
              }
            },
            {
              label: t('autoCheckUpdates'),
              type: 'checkbox',
              checked: checkForUpdates,
              click: (menuItem) => {
                checkForUpdates = menuItem.checked;
                saveConfig();
              }
            },
            { type: 'separator' },
            {
              label: t('about'),
              click: async () => {
                const focusedWin = BrowserWindow.getFocusedWindow();
                const activeWin = (focusedWin && !focusedWin.isDestroyed()) ? focusedWin : (mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined);
                const { response } = await dialog.showMessageBox(activeWin, {
                  type: 'info',
                  title: t('about'),
                  message: `Facebook Messenger\nVersion: ${app.getVersion()}\nElectron: ${process.versions.electron}\nChrome: ${process.versions.chrome}`,
                  buttons: ['OK', t('github')],
                  defaultId: 0,
                  cancelId: 0
                });

                if (response === 1) {
                  safeOpenExternal('https://github.com/KHeresy/FacebookMessengerApp');
                }
              }
            }
          ]
        }
      ];

      const menu = Menu.buildFromTemplate(template);
      Menu.setApplicationMenu(menu);
    } catch (e) {
      console.error('Failed to update menu:', e);
    }
  }

  function setNotificationMode(mode) {
    if (notificationMode === mode) return;
    notificationMode = mode;
    saveConfig();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.clearUnreadAttention(true);
      mainWindow.resetMessengerMonitoring();
    }
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
      show: true, // Show immediately to improve perceived speed
      backgroundColor: '#f0f2f5', // Messenger's background color
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        preload: path.join(__dirname, 'preload.js')
      }
    });

    // Spoof User Agent to look like regular Chrome, preserving the underlying Chrome version
    const defaultUserAgent = mainWindow.webContents.getUserAgent();
    mainWindow.webContents.userAgent = defaultUserAgent.replace(new RegExp(`\\s(${app.name}|Electron)/[^\\s]+`, 'g'), '');

    // A count is only a signal of a new unread conversation, not a message event.
    // Establish a baseline on load/switch and do not notify for existing unread items.
    let observedUnreadCount = null;
    let pendingBaseline = null;
    let notificationTimer = null;
    let pendingSignal = null;
    const pendingMessages = new Map();
    let notificationGeneration = 0;
    let lastNotifiedAt = -Infinity;
    let lastStrongSignalAt = -Infinity;
    let lastConversationSignalAt = -Infinity;
    let lastBadgeToastAt = -Infinity;
    let badgeRefinementCredits = 0;
    let lastBadgeNotifiedCount = 0;
    let badgeDecreaseTimer = null;
    const seenMessages = new Map();
    const seenTitles = new Map();
    let monitoringReadyAt = Date.now() + 5000;
    let redirectRetryCount = 0;
    let badgeIcon = null;
    let badgeText = '';
    let attentionIcon = null;
    let weakAttention = false;
    let reviewWeakAttention = false;
    let badgeDismissed = false;
    let lastOverlayState = '';
    const unreadThreads = new Set();

    const updateTaskbarOverlay = () => {
      if (process.platform !== 'win32' || mainWindow.isDestroyed()) return;
      const appMode = notificationMode === NOTIFICATION_MODES.MESSENGER_ONLY;
      // In app mode a renderer/title badge is only artwork: the trusted unread
      // state decides whether it may be displayed. Stale artwork cannot keep an
      // already-cleared alert alive.
      const showBadge = badgeIcon && (!appMode || (!badgeDismissed && observedUnreadCount > 0 &&
        badgeText === String(observedUnreadCount)));
      const attention = unreadThreads.size > 0 || weakAttention;
      const icon = appMode && !notificationsEnabled ? null :
        (showBadge ? badgeIcon : (appMode && attention ? attentionIcon : null));
      const overlayState = `${icon ? (icon === badgeIcon ? 'badge' : 'attention') : 'clear'}; ` +
        `count=${observedUnreadCount ?? 'unknown'}; threads=${unreadThreads.size}; weak=${weakAttention}`;
      if (appMode && overlayState !== lastOverlayState) {
        lastOverlayState = overlayState;
        console.info(`[Messenger notification] Taskbar ${overlayState}`);
      }
      mainWindow.setOverlayIcon(icon, icon ? (icon === badgeIcon ? badgeText : t('unreadAttention')) : '');
    };

    mainWindow.updateBadgeOverlay = (dataUrl, text) => {
      badgeIcon = dataUrl ? nativeImage.createFromDataURL(dataUrl) : null;
      badgeText = typeof text === 'string' ? text : '';
      updateTaskbarOverlay();
    };

    mainWindow.setAttentionIcon = (dataUrl) => {
      attentionIcon = nativeImage.createFromDataURL(dataUrl);
      updateTaskbarOverlay();
    };

    mainWindow.clearUnreadAttention = (clearBadge = false) => {
      weakAttention = false;
      badgeRefinementCredits = 0;
      reviewWeakAttention = false;
      unreadThreads.clear();
      if (clearBadge) {
        badgeDismissed = true;
        badgeIcon = null;
        badgeText = '';
      }
      mainWindow.resetMessengerNotification();
      updateTaskbarOverlay();
      mainWindow.flashFrame(false);
    };

    const showNotification = (preview = '') => {
      const notification = new Notification({
        title: t('newMessengerMessageTitle'),
        body: showMessagePreviews && preview ? preview : t('newMessengerMessageBody'),
        silent: false
      });

      notification.on('click', () => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          if (mainWindow.isMinimized()) mainWindow.restore();
          mainWindow.focus();
        }
      });

      notification.on('failed', (event, error) => console.error('[Messenger notification] Native notification failed:', error));
      try {
        notification.show();
      } catch (error) {
        console.error('[Messenger notification] Could not show native notification:', error);
      }
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.flashFrame(true);
    };

    mainWindow.resetMessengerNotification = () => {
      notificationGeneration++;
      if (notificationTimer) clearTimeout(notificationTimer);
      notificationTimer = null;
      pendingSignal = null;
      pendingMessages.clear();
      pendingBaseline = null;
    };

    mainWindow.resetMessengerMonitoring = (refresh = true) => {
      mainWindow.resetMessengerNotification();
      if (badgeDecreaseTimer) clearTimeout(badgeDecreaseTimer);
      badgeDecreaseTimer = null;
      observedUnreadCount = null;
      lastBadgeNotifiedCount = 0;
      lastNotifiedAt = -Infinity;
      lastStrongSignalAt = -Infinity;
      lastConversationSignalAt = -Infinity;
      lastBadgeToastAt = -Infinity;
      badgeRefinementCredits = 0;
      seenMessages.clear();
      seenTitles.clear();
      updateTaskbarOverlay();
      if (refresh) mainWindow.webContents.send('refresh-messenger-state');
    };

    const queueMessengerNotification = (source, value = '', message = '', preview = '') => {
      if (notificationMode !== NOTIFICATION_MODES.MESSENGER_ONLY || !notificationsEnabled ||
          !isMessengerConversationPage(mainWindow.webContents.getURL())) return;
      if (mainWindow.isFocused() || Date.now() < monitoringReadyAt) {
        console.info(`[Messenger notification] Ignored ${source}: ${mainWindow.isFocused() ? 'window focused' : 'initial baseline'}`);
        return;
      }
      const now = Date.now();
      const messageKey = `${value}:${message}`;
      if (source === 'conversation') {
        if (seenMessages.has(messageKey) && now - seenMessages.get(messageKey) < 10000) return;
        seenMessages.set(messageKey, now);
        if (seenMessages.size > 500) seenMessages.delete(seenMessages.keys().next().value);
        lastStrongSignalAt = now;
        lastConversationSignalAt = now;
        // A late conversation snapshot can identify a badge-only toast that
        // just appeared. Upgrade its read tracking instead of showing it twice.
        if (!notificationTimer && badgeRefinementCredits > 0 && now - lastBadgeToastAt < 1400) {
          badgeRefinementCredits--;
          unreadThreads.add(value);
          badgeDismissed = false;
          if (!badgeRefinementCredits) weakAttention = false;
          updateTaskbarOverlay();
          return;
        }
      } else if (source === 'badge') {
        if (observedUnreadCount <= lastBadgeNotifiedCount) return;
        lastBadgeNotifiedCount = observedUnreadCount;
        lastStrongSignalAt = now;
        // Badge hydration shortly after a conversation toast is commonly the
        // same arrival, rather than a second message. Later badge-only increases
        // still use the delayed queue.
        if (!notificationTimer && now - lastConversationSignalAt < 1400) return;
      } else {
        if (seenTitles.has(value) && now - seenTitles.get(value) < 30000) return;
        seenTitles.set(value, now);
        if (seenTitles.size > 100) seenTitles.delete(seenTitles.keys().next().value);
        if (now - lastStrongSignalAt < 5000 || now - lastNotifiedAt < 2500) return;
      }

      // A conversation change, badge increase and title change can describe the
      // same arrival. Prefer a known conversation over the weaker signals.
      if (pendingSignal === 'conversation' && source !== 'conversation') return;
      if (pendingSignal === 'badge' && source === 'title') return;
      if (pendingSignal === 'conversation' && source === 'conversation' && notificationTimer) {
        pendingMessages.set(messageKey, { thread: value, preview });
        return;
      }
      pendingSignal = source;
      if (source === 'conversation') {
        pendingMessages.set(messageKey, { thread: value, preview });
      }
      if (notificationTimer) clearTimeout(notificationTimer);
      const generation = notificationGeneration;
      // Distinct arrivals during cooldown are delayed, not discarded. Weaker
      // signals still coalesce with the stronger pending conversation event.
      const delay = Math.max(source === 'conversation' ? 600 : 1400, lastNotifiedAt + 2500 - now);
      if (delay > (source === 'conversation' ? 600 : 1400)) {
        console.info(`[Messenger notification] Delayed ${source}: toast cooldown`);
      }
      notificationTimer = setTimeout(() => {
        if (generation !== notificationGeneration) return;
        notificationTimer = null;
        const signal = pendingSignal;
        pendingSignal = null;
        if (signal && notificationMode === NOTIFICATION_MODES.MESSENGER_ONLY && notificationsEnabled &&
            !mainWindow.isDestroyed() && !mainWindow.isFocused() &&
            isMessengerConversationPage(mainWindow.webContents.getURL()) && Date.now() >= monitoringReadyAt &&
            (signal !== 'badge' || (observedUnreadCount !== null && observedUnreadCount > pendingBaseline))) {
          lastNotifiedAt = Date.now();
          badgeDismissed = false;
          if (signal === 'conversation') {
            for (const { thread } of pendingMessages.values()) unreadThreads.add(thread);
          } else {
            // A title/badge does not identify the receiving conversation.
            weakAttention = true;
            if (signal === 'badge') {
              lastBadgeToastAt = Date.now();
              badgeRefinementCredits = Math.max(1, observedUnreadCount - pendingBaseline);
            }
          }
          updateTaskbarOverlay();
          console.info(`[Messenger notification] Showing ${signal} signal`);
          showNotification(signal === 'conversation' && pendingMessages.size === 1 ?
            pendingMessages.values().next().value.preview : '');
        }
        pendingMessages.clear();
        pendingBaseline = null;
      }, delay);
    };

    mainWindow.handleMessengerConversationChange = ({ thread, message, preview }) => {
      const normalizedPreview = preview.replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, ' ')
        .replace(/\s+/g, ' ').trim();
      queueMessengerNotification('conversation', thread, message, Array.from(normalizedPreview).slice(0, 160).join(''));
    };

    mainWindow.handleMessengerConversationRead = (threadFingerprint) => {
      if (pendingSignal === 'conversation') {
        for (const [key, message] of pendingMessages) {
          if (message.thread === threadFingerprint) pendingMessages.delete(key);
        }
        if (!pendingMessages.size) mainWindow.resetMessengerNotification();
      }
      if (unreadThreads.delete(threadFingerprint)) {
        // A count of one can be lagging behind the only tracked conversation's
        // confirmed read. Larger counts may include other unread conversations.
        if (!unreadThreads.size && observedUnreadCount === 1) badgeDismissed = true;
        updateTaskbarOverlay();
        if (!unreadThreads.size && !weakAttention) mainWindow.flashFrame(false);
      }
    };

    mainWindow.handleMessengerMonitoringScan = () => {
      if (!reviewWeakAttention || !mainWindow.isFocused()) return;
      reviewWeakAttention = false;
      weakAttention = false;
      badgeRefinementCredits = 0;
      updateTaskbarOverlay();
      console.info('[Messenger notification] Weak alert acknowledged after focused scan');
    };

    mainWindow.handleMessengerUnreadCount = (count) => {
      const previous = observedUnreadCount;
      observedUnreadCount = count;
      if (badgeDecreaseTimer) clearTimeout(badgeDecreaseTimer);
      badgeDecreaseTimer = null;
      if (count === 0) {
        lastBadgeNotifiedCount = 0;
        mainWindow.clearUnreadAttention(true);
        console.info('[Messenger notification] Cleared: confirmed zero unread');
        return;
      }
      if (count !== null && count !== previous) badgeDismissed = false;
      updateTaskbarOverlay();
      if (count === null) {
        if (pendingSignal === 'badge') mainWindow.resetMessengerNotification();
        return;
      }
      if (previous === null) lastBadgeNotifiedCount = count;
      if (count < lastBadgeNotifiedCount) {
        const loweredCount = count;
        badgeDecreaseTimer = setTimeout(() => {
          badgeDecreaseTimer = null;
          if (observedUnreadCount === loweredCount) lastBadgeNotifiedCount = loweredCount;
        }, 1500);
      }
      if (Date.now() < monitoringReadyAt || notificationMode !== NOTIFICATION_MODES.MESSENGER_ONLY ||
          !notificationsEnabled || mainWindow.isFocused()) {
        mainWindow.resetMessengerNotification();
        return;
      }
      if (pendingSignal === 'badge' && count <= pendingBaseline) {
        mainWindow.resetMessengerNotification();
      }
      if (previous === null || count <= previous) return;

      if (pendingSignal !== 'badge') pendingBaseline = previous;
      queueMessengerNotification('badge');
    };

    // Facebook may not render the navigation badge in Messenger's conversation UI.
    // Restore the original title-based signal, but only on Messenger conversation pages.
    mainWindow.on('page-title-updated', (event, title) => {
      if (!isMessengerConversationPage(mainWindow.webContents.getURL()) || !isMessageTitle(title)) return;
      queueMessengerNotification('title', title.trim());
    });

    mainWindow.on('focus', () => {
      mainWindow.resetMessengerNotification();
      reviewWeakAttention = true;
      mainWindow.flashFrame(false);
      mainWindow.webContents.send('refresh-messenger-state');
    });
    mainWindow.on('closed', () => {
      if (notificationTimer) clearTimeout(notificationTimer);
      if (badgeDecreaseTimer) clearTimeout(badgeDecreaseTimer);
      notificationGeneration++;
      mainWindow = null;
    });
    mainWindow.webContents.on('did-start-navigation', (details) => {
      if (details.isMainFrame && !details.isSameDocument) {
        badgeIcon = null;
        badgeText = '';
        weakAttention = false;
        mainWindow.resetMessengerMonitoring(false);
        monitoringReadyAt = Date.now() + 5000;
      }
    });

    // Let us register listeners on the window, so we can update the state
    // automatically (the listeners will be removed when the window is closed)
    // and restore the maximized or full screen state
    mainWindowState.manage(mainWindow);

    // Show window when ready to show
    mainWindow.once('ready-to-show', () => {
      mainWindow.show();
    });

    // Reset retry counter on successful load
    mainWindow.webContents.on('did-finish-load', () => {
      redirectRetryCount = 0;
    });

    // Load failure handling
    mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      // Only handle failures for the main frame. 
      // This prevents minor iframe or subresource errors from blanking out the whole app.
      if (!isMainFrame) return;

      console.error(`Page failed to load: ${errorDescription} (${errorCode}) at ${validatedURL}`);
      
      // -3 (ABORTED) is common during redirects, ignore it.
      // -102 (CONNECTION_REFUSED), -105 (NAME_NOT_RESOLVED), -106 (INTERNET_DISCONNECTED) are common at startup
      const transientErrors = [-102, -105, -106, -100, -101, -118];

      if (transientErrors.includes(errorCode)) {
        console.log('Transient network error detected, retrying in 5 seconds...');
        setTimeout(() => {
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.loadURL('https://www.facebook.com/messages/').catch(() => {});
          }
        }, 5000);
        return;
      }

      // ERR_TOO_MANY_REDIRECTS: clear all storage and retry
      if (errorCode === -310) {
        if (redirectRetryCount < 3) {
          redirectRetryCount++;
          console.log(`Too many redirects detected (attempt ${redirectRetryCount}), clearing all session storage and retrying...`);
          session.defaultSession.clearStorageData().then(() => {
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.loadURL('https://www.messenger.com/').catch(() => {});
            }
          });
          return;
        } else {
          console.error('Too many redirects persistent after 3 retries. Falling back to error page.');
        }
      }

      if (errorCode !== -3) {
        const errorHtml = `
          <html>
            <body style="font-family: sans-serif; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; background: #f0f2f5; margin: 0; padding: 20px; text-align: center;">
              <h2 style="color: #1c1e21;">${t('loadFailedTitle')}</h2>
              <p style="color: #65676b;">${errorDescription} (${errorCode})</p>
              <p style="font-size: 14px; color: #8a8d91;">${t('loadFailedMessage')}</p>
              <button onclick="location.href='https://www.facebook.com/messages/'" style="padding: 12px 24px; background: #0084ff; color: white; border: none; border-radius: 8px; cursor: pointer; font-weight: bold; font-size: 16px; margin-top: 10px;">${t('reload')}</button>
            </body>
          </html>
        `;
        mainWindow.loadURL(`data:text/html;charset=UTF-8,${encodeURIComponent(errorHtml)}`);
      }
    });

    // Load the Facebook Messages URL with a slight delay if it's the first run
    const startLoading = () => {
      mainWindow.loadURL('https://www.facebook.com/messages/').catch(err => {
        console.error('Initial load failed:', err);
      });
    };

    startLoading();

    // Context Menu
    mainWindow.webContents.on('context-menu', (event, params) => {
      let menuTemplate = [];

      if (params.isEditable) {
        menuTemplate = [
          { label: t('undo'), role: 'undo' },
          { label: t('redo'), role: 'redo' },
          { type: 'separator' },
          { label: t('cut'), role: 'cut' },
          { label: t('copy'), role: 'copy' },
          { label: t('paste'), role: 'paste' },
          { label: t('selectAll'), role: 'selectAll' }
        ];
      } else {
        menuTemplate = [
          {
            label: t('selectAllSingleMessage'), // Select All Single Message
            click: () => {
              mainWindow.webContents.send('select-all-message');
            }
          },
          {
            label: t('copySingleMessage'), // Copy Entire Message
            click: () => {
              mainWindow.webContents.send('copy-entire-message');
            }
          },
          { type: 'separator' },
          { label: t('copy'), role: 'copy' } // Copy
        ];
      }

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
            safeOpenExternal(params.linkURL);
          }
        });
      }

      const menu = Menu.buildFromTemplate(menuTemplate);
      menu.popup(mainWindow);
    });

    // Intercept in-page navigation (e.g. clicking links)
    mainWindow.webContents.on('will-navigate', (event, url) => {
      try {
        const parsedUrl = new URL(url);
        const hostname = parsedUrl.hostname;
        const pathname = parsedUrl.pathname;

        // Allow navigation to messenger.com or facebook.com/messages
        if (hostname === 'www.messenger.com' || hostname === 'm.messenger.com' ||
          ((hostname === 'www.facebook.com' || hostname === 'm.facebook.com') && pathname.startsWith('/messages'))) {
          return;
        }

        // Allow navigation to facebook login/auth pages
        // Common paths: /login.php, /vX.X/dialog/oauth, /checkpoint, etc.
        if ((hostname === 'facebook.com' || hostname.endsWith('.facebook.com')) &&
            (pathname.includes('/two_step_verification') || pathname.includes('/login') || pathname.includes('/dialog/') || pathname.includes('/checkpoint'))) {
          return;
        }

        // For everything else (including l.facebook.com, generic facebook.com, and external sites),
        // block navigation and open externally.
        event.preventDefault();
        safeOpenExternal(url);
      } catch (e) {
        console.error('Navigation error:', e);
      }
    });

    // Open links externally (handling target="_blank" / window.open)
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
      try {
        const parsedUrl = new URL(url);
        const hostname = parsedUrl.hostname;
        const pathname = parsedUrl.pathname;

        // If it's a messenger.com link or facebook.com/messages link, keep it in the app (main window)
        if (hostname === 'www.messenger.com' || hostname === 'm.messenger.com' ||
          ((hostname === 'www.facebook.com' || hostname === 'm.facebook.com') && pathname.startsWith('/messages'))) {
          mainWindow.loadURL(url);
          if (mainWindow.isMinimized()) mainWindow.restore();
          mainWindow.focus();
          return { action: 'deny' };
        }

        // If it's a specific facebook auth link, allow it to open a popup window (standard behavior)
        // We do NOT force the main window to navigate, preventing white-out on shims.
        if ((hostname === 'facebook.com' || hostname.endsWith('.facebook.com')) &&
          (pathname.includes('/login') || pathname.includes('/dialog/') || pathname.includes('/checkpoint'))) {
          return { action: 'allow' };
        }

        // All other links (external sites, l.facebook.com redirects, etc.) -> Open in System Browser
        safeOpenExternal(url);
        return { action: 'deny' };
      } catch (e) {
        console.error('Window open handler error:', e);
        return { action: 'deny' };
      }
    });
  }

  // This method will be called when Electron has finished
  // initialization and is ready to create browser windows.
  // Some APIs can only be used after this event occurs.
  app.whenReady().then(() => {
    try {
      // Request and check handlers must agree, including for service workers.
      session.defaultSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
        callback(permission === 'notifications' && allowWebNotifications(details?.requestingUrl || webContents?.getURL()));
      });
      session.defaultSession.setPermissionCheckHandler((webContents, permission, requestingOrigin) => {
        return permission === 'notifications' && allowWebNotifications(requestingOrigin);
      });

      updateApplicationMenu();
      createWindow();

      // Check for updates
      checkUpdate();
      setInterval(() => {
        checkUpdate();
      }, 4 * 60 * 60 * 1000); // Check every 4 hours

      app.on('activate', function () {
        // On macOS it's common to re-create a window in the app when the
        // dock icon is clicked and there are no other windows open.
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
      });
    } catch (err) {
      console.error('Failed to start application:', err);
      dialog.showErrorBox('Startup Error', `Failed to start application: ${err.message}`);
    }
  }).catch(err => {
    console.error('app.whenReady failed:', err);
  });
}

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit();
});
