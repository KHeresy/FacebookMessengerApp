const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function startApp() {
  const handlers = new EventEmitter();
  const notifications = [];
  const savedConfigs = [];
  const timers = new Map();
  let nextTimer = 0;
  let now = 0;
  let window;
  let menu;
  const permissions = {};

  class FakeWindow extends EventEmitter {
    constructor() {
      super();
      this.webContents = new EventEmitter();
      this.webContents.mainFrame = {};
      this.webContents.getUserAgent = () => 'Chrome/123 Electron/44';
      this.webContents.getURL = () => this.url;
      this.webContents.setWindowOpenHandler = () => {};
      this.webContents.loadURL = url => { this.url = url; return Promise.resolve(); };
      this.loadURL = url => this.webContents.loadURL(url);
      this.isDestroyed = () => false;
      this.isFocused = () => this.focused;
      this.isMinimized = () => false;
      this.flashFrame = () => {};
      this.overlays = [];
      this.setOverlayIcon = (icon, text) => this.overlays.push({ icon, text });
      this.focused = false;
      window = this;
    }
  }

  class FakeNotification extends EventEmitter {
    constructor(options) {
      super();
      this.options = options;
    }
    show() { notifications.push(this.options); }
  }

  const app = new EventEmitter();
  app.name = 'Facebook Messenger';
  app.getPath = () => 'test-user-data';
  app.requestSingleInstanceLock = () => true;
  app.whenReady = () => Promise.resolve();
  app.getLoginItemSettings = () => ({ openAtLogin: false });
  app.getVersion = () => '1.4.0';
  app.setAppUserModelId = () => {};

  const electron = {
    app,
    BrowserWindow: FakeWindow,
    shell: {},
    Menu: {
      buildFromTemplate: template => template,
      setApplicationMenu: value => { menu = value; }
    },
    session: { defaultSession: {
      setPermissionRequestHandler: handler => { permissions.request = handler; },
      setPermissionCheckHandler: handler => { permissions.check = handler; }
    } },
    Notification: FakeNotification,
    dialog: {},
    nativeImage: { createFromDataURL: dataUrl => ({ dataUrl }) },
    ipcMain: handlers,
    clipboard: {}
  };
  const configFile = path.join('test-user-data', 'config.json');
  const fileSystem = {
    existsSync: () => false,
    readFileSync: () => '',
    writeFileSync: (name, content) => {
      assert.equal(name, configFile);
      savedConfigs.push(JSON.parse(content));
    }
  };
  const clock = { now: () => now };
  const source = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  vm.runInNewContext(source, {
    require: name => {
      if (name === 'electron') return electron;
      if (name === 'electron-window-state') return () => ({ manage: () => {} });
      if (name === 'fs') return fileSystem;
      if (name === 'path') return path;
      if (name === './translations') return require('../translations');
      throw new Error(`Unexpected dependency: ${name}`);
    },
    process: { argv: [], platform: 'win32', versions: {} },
    __dirname: path.join(__dirname, '..'),
    console,
    Date: clock,
    URL,
    setTimeout: (callback, delay) => {
      const id = ++nextTimer;
      timers.set(id, { callback, delay });
      return id;
    },
    clearTimeout: id => timers.delete(id),
    setInterval: () => {},
    fetch: async () => ({ ok: false })
  });

  return {
    ready: async () => { await new Promise(resolve => setImmediate(resolve)); },
    get window() { return window; },
    get menu() { return menu; },
    permissions,
    notifications,
    savedConfigs,
    tick: value => { now = value; },
    fireTimers: () => {
      for (const [id, timer] of timers) {
        timers.delete(id);
        timer.callback();
      }
    },
    report: (count, url = 'https://www.facebook.com/messages/') => {
      window.url = url;
      handlers.emit('messenger-unread-count', {
        sender: window.webContents,
        senderFrame: window.webContents.mainFrame
      }, count);
    },
    conversationChange: (id, url = 'https://www.facebook.com/messages/t/123/', message = id, preview = '') => {
      window.url = url;
      handlers.emit('messenger-conversation-change', {
        sender: window.webContents,
        senderFrame: window.webContents.mainFrame
      }, { thread: id, message, preview });
    },
    conversationRead: (id, url = 'https://www.facebook.com/messages/t/123/') => {
      window.url = url;
      handlers.emit('messenger-conversation-read', {
        sender: window.webContents,
        senderFrame: window.webContents.mainFrame
      }, id);
    },
    registerAttentionIcon: () => handlers.emit('register-attention-icon', {
      sender: window.webContents,
      senderFrame: window.webContents.mainFrame
    }, 'data:image/png;base64,AAAA'),
    badgeOverlay: (dataUrl, text) => handlers.emit('update-badge', {
      sender: window.webContents,
      senderFrame: window.webContents.mainFrame
    }, { dataUrl, text })
  };
}

test('the two modes are exclusive and persisted; web permissions follow the global switch', async () => {
  const state = startApp();
  await state.ready();
  const view = state.menu.find(item => item.label === '檢視');
  const mode = view.submenu.find(item => item.label === '通知模式');
  const enabled = view.submenu.find(item => item.label === '啟用背景通知');

  assert.equal(state.permissions.check(null, 'notifications', 'https://www.facebook.com'), false);
  mode.submenu[0].click();
  assert.equal(state.savedConfigs.at(-1).notificationMode, 'web');
  assert.equal(state.permissions.check(null, 'notifications', 'https://www.facebook.com'), true);
  assert.equal(state.permissions.check(null, 'notifications', 'https://evilfacebook.com'), false);
  state.permissions.request(null, 'notifications', allowed => assert.equal(allowed, true), {
    requestingUrl: 'https://www.messenger.com/'
  });

  state.tick(6000);
  state.report(0);
  state.report(1);
  state.window.emit('page-title-updated', {}, 'Sent you a message');
  state.fireTimers();
  assert.equal(state.notifications.length, 0);

  enabled.click({ checked: false });
  assert.equal(state.savedConfigs.at(-1).notificationsEnabled, false);
  assert.equal(state.permissions.check(null, 'notifications', 'https://www.facebook.com'), false);
  mode.submenu[1].click();
  assert.equal(state.permissions.check(null, 'notifications', 'https://www.facebook.com'), false);
});

test('Messenger-only mode ignores existing unread counts, groups increases, and cancels stale alerts', async () => {
  const state = startApp();
  await state.ready();
  state.report(0);
  state.report(1); // Late badge hydration during startup is not a new message.
  state.report(3);
  state.fireTimers();
  assert.equal(state.notifications.length, 0);
  state.tick(6000);
  state.report(3); // Counts seen during startup become the baseline.
  state.fireTimers();
  assert.equal(state.notifications.length, 0);

  state.report(4);
  state.report(5);
  state.fireTimers();
  assert.equal(state.notifications.length, 1);
  assert.equal(state.notifications[0].body, '有新的 Messenger 訊息');

  state.report(6);
  state.window.emit('focus');
  state.fireTimers();
  assert.equal(state.notifications.length, 1);

  state.report(null);
  state.report(7); // Unknown count must re-establish a baseline.
  state.fireTimers();
  assert.equal(state.notifications.length, 1);

  state.report(8, 'https://www.facebook.com/notifications/');
  state.fireTimers();
  assert.equal(state.notifications.length, 1);
});

test('a full main-frame navigation resets the unread baseline before the next page reports its existing count', async () => {
  const state = startApp();
  await state.ready();
  state.tick(6000);
  state.report(0);
  state.window.webContents.emit('did-start-navigation', {
    isMainFrame: true,
    isSameDocument: false
  }, 'https://www.facebook.com/messages/t/123/', false, true);

  state.tick(12000);
  state.report(4); // Existing unread conversations on the newly loaded page.
  state.fireTimers();
  assert.equal(state.notifications.length, 0);

  state.report(5); // A later increase is a new notification signal.
  state.fireTimers();
  assert.equal(state.notifications.length, 1);
});

test('same-document and subframe navigations do not discard the current unread baseline', async () => {
  const state = startApp();
  await state.ready();
  state.tick(6000);
  state.report(0);
  state.window.webContents.emit('did-start-navigation', {
    isMainFrame: false,
    isSameDocument: false
  });
  state.window.webContents.emit('did-start-navigation', {
    isMainFrame: true,
    isSameDocument: true
  });
  state.report(1);
  state.fireTimers();
  assert.equal(state.notifications.length, 1);
});

test('a Messenger title change notifies when its navigation badge is unavailable', async () => {
  const state = startApp();
  await state.ready();
  state.tick(6000);
  state.report(null, 'https://www.facebook.com/messages/t/123/');
  const title = value => state.window.emit('page-title-updated', {}, value);

  title('Messenger | Facebook');
  title('(1) Messenger | Facebook');
  title('(1) Someone');
  state.fireTimers();
  assert.equal(state.notifications.length, 0);

  title('Sent you a message');
  state.fireTimers();
  assert.equal(state.notifications.length, 1);

  title('Another message'); // The same arrival should not produce a second alert.
  state.fireTimers();
  assert.equal(state.notifications.length, 1);

  state.tick(10000);
  state.window.url = 'https://www.facebook.com/notifications/';
  title('Some other Facebook activity');
  state.fireTimers();
  assert.equal(state.notifications.length, 1);

  state.window.url = 'https://www.facebook.com/messages/t/123/';
  state.window.focused = true;
  title('A focused conversation');
  state.fireTimers();
  assert.equal(state.notifications.length, 1);

  state.window.focused = false;
  title('An incoming message');
  state.window.emit('focus');
  state.fireTimers();
  assert.equal(state.notifications.length, 1);
});

test('badge and title signals for the same Messenger arrival produce one alert', async () => {
  const state = startApp();
  await state.ready();
  state.tick(6000);
  state.report(0);
  state.report(1);
  state.window.emit('page-title-updated', {}, 'Sent you a message');
  state.fireTimers();
  assert.equal(state.notifications.length, 1);

  state.tick(10000);
  state.report(null);
  state.window.emit('page-title-updated', {}, 'New message');
  state.fireTimers();
  assert.equal(state.notifications.length, 1);
  state.window.clearUnreadAttention();
  state.tick(12000);
  state.window.emit('page-title-updated', {}, 'Another new message');
  state.fireTimers();
  assert.equal(state.notifications.length, 2);
});

test('conversation changes win over badge and title signals without leaking message text', async () => {
  const state = startApp();
  await state.ready();
  state.tick(6000);
  state.report(0);
  state.conversationChange('aabbccdd');
  state.report(1, 'https://www.facebook.com/messages/t/123/');
  state.window.emit('page-title-updated', {}, 'Someone sent a message');
  state.fireTimers();
  assert.equal(state.notifications.length, 1);
  assert.equal(state.notifications[0].body, '有新的 Messenger 訊息');

  state.tick(10000);
  state.conversationChange('bad-id');
  state.conversationChange('aabbccdd', 'https://www.facebook.com/notifications/');
  state.fireTimers();
  assert.equal(state.notifications.length, 1);

  state.window.url = 'https://www.facebook.com/messages/t/123/';
  state.window.focused = true;
  state.conversationChange('aabbccdd');
  state.fireTimers();
  assert.equal(state.notifications.length, 1);
});

test('an unread alert persists after focus while a distinct new conversation still notifies', async () => {
  const state = startApp();
  await state.ready();
  state.registerAttentionIcon();
  state.tick(6000);
  state.conversationChange('aabbccdd');
  state.fireTimers();
  assert.equal(state.notifications.length, 1);
  assert.equal(state.window.overlays.at(-1).icon.dataUrl, 'data:image/png;base64,AAAA');

  state.window.emit('focus');
  assert.equal(state.window.overlays.at(-1).icon.dataUrl, 'data:image/png;base64,AAAA');
  state.tick(12000);
  state.window.emit('page-title-updated', {}, 'Another message while unread');
  state.conversationChange('bbccddee', 'https://www.facebook.com/messages/t/123/', '00000001');
  state.fireTimers();
  assert.equal(state.notifications.length, 2);

  state.conversationRead('aabbccdd');
  assert.equal(state.window.overlays.at(-1).icon.dataUrl, 'data:image/png;base64,AAAA');
  state.conversationChange('bbccddee', 'https://www.facebook.com/messages/t/123/', '00000001');
  state.fireTimers();
  assert.equal(state.notifications.length, 2);
  state.conversationRead('bbccddee');
  assert.equal(state.window.overlays.at(-1).icon, null);
});

test('a new preview in the same still-unread conversation notifies again, but replayed signals do not', async () => {
  const state = startApp();
  await state.ready();
  state.registerAttentionIcon();
  state.tick(6000);
  state.conversationChange('aabbccdd', undefined, '00000001');
  state.fireTimers();
  assert.equal(state.notifications.length, 1);

  state.tick(11000);
  state.conversationChange('aabbccdd', undefined, '00000002');
  state.fireTimers();
  assert.equal(state.notifications.length, 2);
  assert.ok(state.window.overlays.at(-1).icon);
  state.tick(15000);
  state.conversationChange('aabbccdd', undefined, '00000002');
  state.fireTimers();
  assert.equal(state.notifications.length, 2);
});

test('verified conversation notifications show a bounded preview and respect the persisted preview toggle', async () => {
  const state = startApp();
  await state.ready();
  state.tick(6000);
  state.report(0);
  state.report(1); // A badge arrives before the more informative conversation signal.
  state.conversationChange('aabbccdd', undefined, '00000001', '  Hello\n there  ');
  state.fireTimers();
  assert.equal(state.notifications[0].body, 'Hello there');

  const view = state.menu.find(item => item.label === '檢視');
  const previewToggle = view.submenu.find(item => item.label === '在通知中顯示訊息預覽');
  assert.equal(previewToggle.checked, true);
  previewToggle.click({ checked: false });
  assert.equal(state.savedConfigs.at(-1).showMessagePreviews, false);
  state.tick(11000);
  state.conversationChange('aabbccdd', undefined, '00000002', 'Another private message');
  state.fireTimers();
  assert.equal(state.notifications[1].body, '有新的 Messenger 訊息');

  previewToggle.click({ checked: true });
  state.tick(16000);
  state.conversationChange('aabbccdd', undefined, '00000003', '\u202eSecret\tmessage');
  state.fireTimers();
  assert.equal(state.notifications[2].body, 'Secret message');

  state.tick(21000);
  state.conversationChange('aabbccdd', undefined, '00000004', 'x'.repeat(501));
  state.fireTimers();
  assert.equal(state.notifications.length, 3);
  state.conversationChange('aabbccdd', undefined, '00000005', '😀'.repeat(200));
  state.fireTimers();
  assert.equal(Array.from(state.notifications[3].body).length, 160);
});

test('unmatched and grouped signals use generic text rather than a misleading preview', async () => {
  const state = startApp();
  await state.ready();
  state.tick(6000);
  state.window.url = 'https://www.facebook.com/messages/';
  state.window.emit('page-title-updated', {}, 'Message without a verified preview');
  state.fireTimers();
  assert.equal(state.notifications[0].body, '有新的 Messenger 訊息');

  state.tick(11000);
  state.conversationChange('aabbccdd', undefined, '00000001', 'First message');
  state.conversationChange('bbccddee', undefined, '00000002', 'Second message');
  state.fireTimers();
  assert.equal(state.notifications[1].body, '有新的 Messenger 訊息');
});

test('a higher Messenger unread count can notify while the previous alert is still pending', async () => {
  const state = startApp();
  await state.ready();
  state.registerAttentionIcon();
  state.tick(6000);
  state.report(0);
  state.report(1);
  state.fireTimers();
  assert.equal(state.notifications.length, 1);

  state.tick(11000);
  state.report(2);
  state.fireTimers();
  assert.equal(state.notifications.length, 2);
  state.report(1);
  state.report(2); // An oscillating count is not a new unread conversation.
  state.fireTimers();
  assert.equal(state.notifications.length, 2);
});

test('title-only alerts stay visible until explicitly dismissed', async () => {
  const state = startApp();
  await state.ready();
  state.registerAttentionIcon();
  state.tick(6000);
  state.window.url = 'https://www.facebook.com/messages/';
  state.window.emit('page-title-updated', {}, 'Message preview');
  state.fireTimers();
  state.tick(12000);
  state.window.emit('page-title-updated', {}, 'Another preview');
  state.fireTimers();
  assert.equal(state.notifications.length, 2);
  assert.ok(state.window.overlays.at(-1).icon);

  state.badgeOverlay('data:image/png;base64,BBBB', '3');
  const view = state.menu.find(item => item.label === '檢視');
  view.submenu.find(item => item.label === '清除未讀提示').click();
  assert.equal(state.window.overlays.at(-1).icon, null);
  state.tick(16000);
  state.window.emit('page-title-updated', {}, 'Fresh message');
  state.fireTimers();
  assert.equal(state.notifications.length, 3);
});

test('renderer clearing an absent badge does not erase pending attention; a positive unread count returning to zero does', async () => {
  const state = startApp();
  await state.ready();
  state.registerAttentionIcon();
  state.tick(6000);
  state.window.url = 'https://www.facebook.com/messages/';
  state.window.emit('page-title-updated', {}, 'New message');
  state.fireTimers();
  state.badgeOverlay(null, '');
  assert.equal(state.window.overlays.at(-1).icon.dataUrl, 'data:image/png;base64,AAAA');

  state.report(1);
  state.badgeOverlay('data:image/png;base64,BBBB', '1');
  assert.equal(state.window.overlays.at(-1).text, '1');
  state.report(0);
  state.badgeOverlay(null, '');
  assert.equal(state.window.overlays.at(-1).icon, null);
});

test('preload only accepts numeric badges inside the Messenger control', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'preload.js'), 'utf8');
  let control = null;
  const context = vm.createContext({
    require: () => ({ ipcRenderer: { sendSync: () => false, on: () => {} } }),
    window: { addEventListener: () => {} },
    document: { querySelector: () => control },
    console
  });
  vm.runInContext(source, context);
  const signal = () => vm.runInContext('getMessengerUnreadSignal()', context);

  assert.equal(signal(), null);
  control = { querySelectorAll: () => [] };
  assert.equal(signal(), 0);
  control = { querySelectorAll: () => [{ textContent: '2' }] };
  assert.equal(signal(), 2);
  control = { querySelectorAll: () => [{ textContent: '99+' }] };
  assert.equal(signal(), 99);
  control = { querySelectorAll: () => [{ textContent: '2 notifications' }] };
  assert.equal(signal(), null);
});

test('conversation snapshots ignore initial unread, new rows and manual unread; detect changed unread previews', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'preload.js'), 'utf8');
  const messages = [];
  let rows = [];
  function thread(id, name, preview, bold) {
    const nameNode = { textContent: name, querySelector: () => null };
    const previewNode = { textContent: preview, fontWeight: bold ? '700' : '400', querySelector: () => null };
    const row = { querySelectorAll: () => [nameNode, previewNode] };
    return {
      getAttribute: () => `/messages/t/${id}/`,
      closest: () => row
    };
  }
  const context = vm.createContext({
    require: () => ({ ipcRenderer: {
      sendSync: () => false,
      on: () => {},
      send: (...args) => messages.push(args)
    } }),
    window: {
      addEventListener: () => {},
      getComputedStyle: element => ({ fontWeight: element.fontWeight })
    },
    document: { querySelectorAll: () => rows },
    location: { href: 'https://www.facebook.com/messages/' },
    URL,
    console
  });
  vm.runInContext(source, context);
  const scan = () => vm.runInContext('updateConversationSignals()', context);

  rows = [thread('123', 'Alice', 'Earlier message', true)];
  scan(); // Existing unread establishes the baseline.
  rows.push(thread('456', 'Bob', 'Earlier message', true));
  scan(); // A newly visible row is not necessarily a newly received message.
  rows[0] = thread('123', 'Alice', 'Earlier message', false);
  scan();
  rows[0] = thread('123', 'Alice', 'Earlier message', true);
  scan(); // Manual mark-as-unread changes no preview.
  rows[0] = thread('123', 'Alice', 'New outgoing message', false);
  scan();
  assert.equal(messages.filter(([channel]) => channel === 'messenger-conversation-change').length, 0);

  rows[0] = thread('123', 'Alice', 'New incoming message', true);
  scan();
  scan();
  const changes = () => messages.filter(([channel]) => channel === 'messenger-conversation-change');
  assert.equal(changes().length, 1);
  assert.match(changes()[0][1].thread, /^[0-9a-f]{8}$/);
  assert.match(changes()[0][1].message, /^[0-9a-f]{8}$/);
  assert.notEqual(changes()[0][1].thread, changes()[0][1].message);
  assert.equal(changes()[0][1].preview, 'New incoming message');
  assert.equal(vm.runInContext('knownThreads.get("123").previewText', context), undefined);

  rows[0] = thread('123', 'Alice', 'Another incoming message', true);
  rows[0].closest().querySelectorAll()[1].fontWeight = 'bold';
  scan();
  assert.equal(changes().length, 2);
  assert.notEqual(changes()[0][1].message, changes()[1][1].message);
  rows[0] = thread('123', 'Alice', 'Another incoming message', false);
  scan();
  assert.equal(messages.filter(([channel]) => channel === 'messenger-conversation-read').length, 2);
});
