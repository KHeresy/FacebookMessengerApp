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
      this.webContents.sent = [];
      this.webContents.send = (...args) => this.webContents.sent.push(args);
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
      timers.set(id, { callback, delay, due: now + delay });
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
    advance: duration => {
      const target = now + duration;
      while (true) {
        const next = [...timers].filter(([, timer]) => timer.due <= target)
          .sort((a, b) => a[1].due - b[1].due)[0];
        if (!next) break;
        const [id, timer] = next;
        timers.delete(id);
        now = Math.max(now, timer.due);
        timer.callback();
      }
      now = target;
    },
    fireTimers: () => {
      for (const [id, timer] of [...timers].sort((a, b) => a[1].due - b[1].due)) {
        if (!timers.has(id)) continue;
        timers.delete(id);
        now = Math.max(now, timer.due);
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
    blueDots: (hasBlueDot, url = 'https://www.facebook.com/messages/') => {
      window.url = url;
      handlers.emit('messenger-blue-dot-state', {
        sender: window.webContents,
        senderFrame: window.webContents.mainFrame
      }, hasBlueDot);
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
    scan: () => handlers.emit('messenger-monitoring-scan', {
      sender: window.webContents,
      senderFrame: window.webContents.mainFrame
    }),
    relay: (channel, ...args) => handlers.emit(channel, {
      sender: window.webContents,
      senderFrame: window.webContents.mainFrame
    }, ...args),
    relayFrom: (event, channel, ...args) => handlers.emit(channel, event, ...args),
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

function startPreload(onSend = () => {}) {
  let now = 0;
  let rows = [];
  let control = null;
  const messages = [];
  const listeners = new Map();
  const source = fs.readFileSync(path.join(__dirname, '..', 'preload.js'), 'utf8');
  const context = vm.createContext({
    require: () => ({ ipcRenderer: {
      sendSync: () => false,
      on: (channel, callback) => listeners.set(channel, callback),
      send: (...args) => { messages.push(args); onSend(...args); }
    } }),
    window: {
      addEventListener: () => {},
      getComputedStyle: element => ({ fontWeight: element.fontWeight, ...element.style })
    },
    document: {
      body: {},
      title: 'Messenger | Facebook',
      querySelectorAll: selector => selector.includes('/messages/t/') ? rows : (control ? [control] : []),
      createElement: () => ({ getContext: () => ({ beginPath() {}, arc() {}, fill() {}, fillText() {} }),
        toDataURL: () => 'data:image/png;base64,AAAA' })
    },
    location: { href: 'https://www.facebook.com/messages/' },
    Date: { now: () => now },
    URL,
    console
  });
  vm.runInContext(source, context);
  return {
    messages,
    tick: value => { now = value; },
    rows: value => { rows = value; },
    control: value => { control = value; },
    scan: () => vm.runInContext('updateConversationSignals()', context),
    update: () => vm.runInContext('updateBadge()', context),
    refresh: () => listeners.get('refresh-messenger-state')(),
    changes: () => messages.filter(([channel]) => channel === 'messenger-conversation-change'),
    blueDotReports: () => messages.filter(([channel]) => channel === 'messenger-blue-dot-state').map(([, value]) => value),
    thread: (id, preview, bold, href = `/messages/t/${id}/`) => {
      const previewNode = { textContent: preview, fontWeight: bold ? '700' : '400', querySelector: () => null };
      const avatar = { getBoundingClientRect: () => ({ left: 0, right: 48, top: 12, bottom: 60, width: 48, height: 48 }) };
      const row = {
        dots: [],
        style: { direction: 'ltr' },
        getBoundingClientRect: () => ({ left: 0, right: 280, top: 0, bottom: 72, width: 280, height: 72 }),
        querySelector: selector => selector === 'img' ? avatar : null,
        querySelectorAll: selector => selector === '[dir="auto"]' ?
          [{ textContent: `Name ${id}`, querySelector: () => null }, previewNode] : row.dots
      };
      return { row, preview: previewNode, getAttribute: () => href, closest: () => row };
    },
    dot: (options = {}) => {
      const { left = 254, top = 30, size = 12, color = 'rgb(0, 100, 230)', radius = '50%',
        text = '', display = 'block', visibility = 'visible', opacity = '1' } = options;
      return {
        textContent: text,
        getBoundingClientRect: () => ({ left, right: left + size, top, bottom: top + size, width: size, height: size }),
        style: { backgroundColor: color, display, visibility, opacity,
          borderTopLeftRadius: radius, borderTopRightRadius: radius, borderBottomLeftRadius: radius, borderBottomRightRadius: radius }
      };
    }
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

test('page title updates do not trigger Messenger-only notifications', async () => {
  const state = startApp();
  await state.ready();
  state.tick(6000);
  state.report(null, 'https://www.facebook.com/messages/t/123/');
  state.window.emit('page-title-updated', {}, 'Sent you a message');
  state.window.emit('page-title-updated', {}, 'Another message');
  state.fireTimers();
  assert.equal(state.notifications.length, 0);
});

test('badge count increases notify without relying on page titles', async () => {
  const state = startApp();
  await state.ready();
  state.tick(6000);
  state.report(0);
  state.report(1);
  state.fireTimers();
  assert.equal(state.notifications.length, 1);

  state.report(2);
  state.fireTimers();
  assert.equal(state.notifications.length, 2);
});

test('conversation changes win over badge signals without leaking message text', async () => {
  const state = startApp();
  await state.ready();
  state.tick(6000);
  state.report(0);
  state.conversationChange('aabbccdd');
  state.report(1, 'https://www.facebook.com/messages/t/123/');
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

test('a confirmed blue-dot state controls taskbar artwork without suppressing preview notifications', async () => {
  const state = startApp();
  await state.ready();
  state.registerAttentionIcon();
  state.report(2);
  state.badgeOverlay('data:image/png;base64,BBBB', '2');
  assert.equal(state.window.overlays.at(-1).text, '2');

  state.blueDots(false);
  assert.equal(state.window.overlays.at(-1).icon, null);
  state.blueDots(true);
  assert.equal(state.window.overlays.at(-1).icon.dataUrl, 'data:image/png;base64,AAAA');
  state.badgeOverlay(null, '');
  assert.equal(state.window.overlays.at(-1).icon.dataUrl, 'data:image/png;base64,AAAA');
  state.blueDots(false);
  assert.equal(state.window.overlays.at(-1).icon, null);

  state.tick(6000);
  state.conversationChange('aabbccdd', undefined, '00000001', 'Preview stays enabled');
  state.fireTimers();
  assert.equal(state.notifications.at(-1).body, 'Preview stays enabled');
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

test('grouped conversations use generic text rather than a misleading preview', async () => {
  const state = startApp();
  await state.ready();
  state.tick(6000);
  state.conversationChange('aabbccdd', undefined, '00000001', 'First message');
  state.conversationChange('bbccddee', undefined, '00000002', 'Second message');
  state.fireTimers();
  assert.equal(state.notifications.length, 1);
  assert.equal(state.notifications[0].body, '有新的 Messenger 訊息');
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

test('renderer clearing an absent badge does not erase pending attention; a positive unread count returning to zero does', async () => {
  const state = startApp();
  await state.ready();
  state.registerAttentionIcon();
  state.tick(6000);
  state.report(0);
  state.report(1);
  state.fireTimers();
  assert.equal(state.notifications.length, 1);
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
  let now = 0;
  const queriedSelectors = [];
  const context = vm.createContext({
    require: () => ({ ipcRenderer: { sendSync: () => false, on: () => {} } }),
    window: { addEventListener: () => {} },
    document: { querySelectorAll: selector => {
      queriedSelectors.push(selector);
      return control ? [control] : [];
    } },
    Date: { now: () => now },
    console
  });
  vm.runInContext(source, context);
  const signal = () => vm.runInContext('getMessengerUnreadSignal()', context);

  assert.equal(signal(), null);
  assert.ok(queriedSelectors.length > 0);
  assert.ok(queriedSelectors.every(selector => !selector.includes('訊息')));
  assert.ok(queriedSelectors.every(selector => !selector.includes('a[href="/messages/"]')));
  let badges = [];
  control = { querySelectorAll: () => badges };
  assert.equal(signal(), null); // Unrecognized empty controls are not reliable zero.
  badges = [{ textContent: '2' }];
  assert.equal(signal(), 2);
  badges = [{ textContent: '99+' }];
  assert.equal(signal(), 99);
  badges = [{ textContent: '2 notifications' }];
  assert.equal(signal(), null);
  badges = [];
  assert.equal(signal(), null);
  now = 1499;
  assert.equal(signal(), null);
  now = 1500;
  assert.equal(signal(), 0);
  control = { querySelectorAll: () => [] }; // A replacement control needs its own evidence.
  assert.equal(signal(), null);
});

test('conversation snapshots ignore initial unread, new rows and manual unread; detect changed unread previews', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'preload.js'), 'utf8');
  const messages = [];
  let rows = [];
  function thread(id, name, preview, bold) {
    const nameNode = { textContent: name, querySelector: () => null };
    const previewNode = { textContent: preview, fontWeight: bold ? '700' : '400', querySelector: () => null };
    const row = { querySelectorAll: () => [nameNode, previewNode],
      getBoundingClientRect: () => ({ width: 0, height: 0 }) };
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
  // Manual mark-as-unread is now observed too, so its later outgoing/read
  // transition is reconciled in addition to the two incoming-message reads.
  assert.equal(messages.filter(([channel]) => channel === 'messenger-conversation-read').length, 3);
});

test('confirmed zero cancels a pending conversation toast and clears stale numeric artwork', async () => {
  const state = startApp();
  await state.ready();
  state.registerAttentionIcon();
  state.tick(6000);
  state.report(1);
  state.badgeOverlay('data:image/png;base64,BBBB', '1');
  state.conversationChange('aabbccdd', undefined, '00000001', 'Already read before toast');
  state.advance(300);
  state.report(0);
  state.advance(3000);
  assert.equal(state.notifications.length, 0);
  assert.equal(state.window.overlays.at(-1).icon, null);
  state.badgeOverlay('data:image/png;base64,BBBB', '1');
  assert.equal(state.window.overlays.at(-1).icon, null);
});

test('a confirmed zero cancels a pending badge alert', async () => {
  const state = startApp();
  await state.ready();
  state.registerAttentionIcon();
  state.tick(6000);
  state.report(0);
  state.report(1);
  state.advance(500);
  state.report(0);
  assert.equal(state.window.overlays.at(-1).icon, null);
  state.advance(2000);
  assert.equal(state.notifications.length, 0);
});

test('a focused scan acknowledges weak alerts without clearing confirmed unread conversations', async () => {
  const state = startApp();
  await state.ready();
  state.registerAttentionIcon();
  state.tick(6000);
  state.report(0);
  state.report(1);
  state.advance(1400);
  state.advance(3000);
  state.conversationChange('aabbccdd');
  state.advance(600);
  state.window.focused = true;
  state.window.emit('focus');
  assert.equal(state.window.webContents.sent.at(-1)[0], 'refresh-messenger-state');
  state.scan();
  assert.ok(state.window.overlays.at(-1).icon);
  state.conversationRead('aabbccdd');
  assert.equal(state.window.overlays.at(-1).icon, null);
});

test('a weak badge alert on a conversation URL clears after focus and rescan', async () => {
  const state = startApp();
  await state.ready();
  state.registerAttentionIcon();
  state.tick(6000);
  state.report(0, 'https://www.facebook.com/messages/t/123/');
  state.report(1, 'https://www.facebook.com/messages/t/123/');
  state.advance(1400);
  state.scan(); // Background scans do not acknowledge the alert.
  assert.ok(state.window.overlays.at(-1).icon);
  state.window.focused = true;
  state.window.emit('focus');
  state.scan();
  assert.equal(state.window.overlays.at(-1).icon, null);
});

test('distinct messages during cooldown are delayed and grouped, not lost', async () => {
  const state = startApp();
  await state.ready();
  state.tick(6000);
  state.conversationChange('aabbccdd', undefined, '00000001', 'First');
  state.advance(600);
  state.advance(100);
  state.conversationChange('aabbccdd', undefined, '00000002', 'Second');
  state.conversationChange('bbccddee', undefined, '00000003', 'Third');
  state.advance(2399);
  assert.equal(state.notifications.length, 1);
  state.advance(1);
  assert.equal(state.notifications.length, 2);
  assert.equal(state.notifications[1].body, '有新的 Messenger 訊息');
});

test('reading a cooldown message cancels its delayed toast', async () => {
  const state = startApp();
  await state.ready();
  state.registerAttentionIcon();
  state.tick(6000);
  state.conversationChange('aabbccdd', undefined, '00000001');
  state.advance(600);
  state.conversationChange('aabbccdd', undefined, '00000002');
  state.conversationRead('aabbccdd');
  state.advance(3000);
  assert.equal(state.notifications.length, 1);
  assert.equal(state.window.overlays.at(-1).icon, null);
});

test('reading one grouped conversation leaves only the remaining preview in the pending toast', async () => {
  const state = startApp();
  await state.ready();
  state.tick(6000);
  state.conversationChange('aabbccdd', undefined, '00000001', 'Read message');
  state.conversationChange('bbccddee', undefined, '00000002', 'Still unread');
  state.conversationRead('aabbccdd');
  state.advance(600);
  assert.equal(state.notifications[0].body, 'Still unread');
});

test('stable decreases reset the badge baseline but transient oscillations do not', async () => {
  const state = startApp();
  await state.ready();
  state.tick(6000);
  state.report(0);
  state.report(5);
  state.advance(1400);
  state.report(3);
  state.advance(1499);
  state.report(5);
  state.advance(1500);
  assert.equal(state.notifications.length, 1);
  state.report(3);
  state.advance(1500);
  state.report(4);
  state.advance(1400);
  assert.equal(state.notifications.length, 2);
});

test('later badge arrivals during cooldown are delayed while same-arrival hydration is coalesced', async () => {
  const state = startApp();
  await state.ready();
  state.tick(6000);
  state.report(0);
  state.conversationChange('aabbccdd');
  state.advance(600);
  state.report(1); // Badge hydration of the already-notified conversation.
  state.advance(1400);
  assert.equal(state.notifications.length, 1);
  state.report(2); // A later distinct unread conversation.
  state.advance(1400);
  assert.equal(state.notifications.length, 2);
});

test('mode switches establish a fresh badge baseline and request unchanged renderer state', async () => {
  const state = startApp();
  await state.ready();
  state.tick(6000);
  state.report(0);
  const mode = state.menu.find(item => item.label === '檢視').submenu.find(item => item.label === '通知模式');
  mode.submenu[0].click();
  state.report(5);
  mode.submenu[1].click();
  assert.equal(state.window.webContents.sent.at(-1)[0], 'refresh-messenger-state');
  state.report(5);
  state.advance(2000);
  assert.equal(state.notifications.length, 0);
  state.report(6);
  state.advance(1400);
  assert.equal(state.notifications.length, 1);
});

test('confirmed read clears a lagging badge of one, but does not hide other unread conversations', async () => {
  const state = startApp();
  await state.ready();
  state.registerAttentionIcon();
  state.tick(6000);
  state.report(1);
  state.badgeOverlay('data:image/png;base64,BBBB', '1');
  state.conversationChange('aabbccdd');
  state.advance(600);
  state.conversationRead('aabbccdd');
  state.badgeOverlay('data:image/png;base64,BBBB', '1');
  assert.equal(state.window.overlays.at(-1).icon, null);
  state.report(2);
  state.badgeOverlay('data:image/png;base64,CCCC', '2');
  assert.equal(state.window.overlays.at(-1).text, '2');
});

test('delayed unread styling detects a new preview once, but later manual unread does not', () => {
  const state = startPreload();
  const row = state.thread('123', 'Old message', false);
  state.rows([row]);
  state.scan();
  state.tick(100);
  row.preview.textContent = 'New incoming message';
  state.scan();
  state.tick(2100);
  row.preview.fontWeight = '700';
  state.scan();
  state.scan();
  assert.equal(state.changes().length, 1);
  assert.equal(state.changes()[0][1].preview, 'New incoming message');
  row.preview.fontWeight = '400';
  state.scan();
  state.tick(10000);
  row.preview.fontWeight = '700';
  state.scan();
  assert.equal(state.changes().length, 1);
});

test('repeated preview transitions have distinct event identities and initial read rows reconcile retained alerts', () => {
  const state = startPreload();
  const row = state.thread('123', 'Hello', false);
  state.rows([row]);
  state.scan();
  assert.equal(state.messages.filter(([channel]) => channel === 'messenger-conversation-read').length, 1);
  row.preview.textContent = 'Other';
  row.preview.fontWeight = '700';
  state.scan();
  row.preview.textContent = 'Hello';
  state.scan();
  row.preview.textContent = 'Other';
  state.scan();
  const changes = state.changes();
  assert.equal(changes.length, 3);
  assert.notEqual(changes[0][1].message, changes[2][1].message);
});

test('a visible unread conversation prevents an empty badge from reporting global zero', () => {
  const state = startPreload();
  let badges = [{ textContent: '1' }];
  state.control({ querySelectorAll: () => badges });
  const row = state.thread('123', 'Unread', true);
  state.rows([row]);
  state.update();
  badges = [];
  state.update();
  state.tick(2000);
  state.update();
  assert.equal(state.messages.filter(([channel]) => channel === 'messenger-unread-count').at(-1)[1], null);
  row.preview.fontWeight = '400';
  state.update();
  assert.equal(state.messages.filter(([channel]) => channel === 'messenger-unread-count').at(-1)[1], 0);
});

test('renderer refresh does not restore taskbar artwork when no unread blue dot is present', async () => {
  const state = startApp();
  await state.ready();
  state.registerAttentionIcon();
  state.tick(6000);
  const preload = startPreload((...args) => state.relay(...args));
  const row = preload.thread('123', 'Earlier', false);
  preload.rows([row]);
  preload.update();
  preload.tick(1500);
  preload.update();
  row.preview.textContent = 'Confirmed incoming';
  row.preview.fontWeight = '700';
  preload.update();
  state.advance(600);
  assert.equal(state.notifications.length, 1);
  state.window.focused = true;
  state.window.emit('focus');
  preload.refresh();
  assert.equal(state.window.overlays.at(-1).icon, null); // Bold preview still drives toast detection, not taskbar artwork.
  row.preview.fontWeight = '400';
  preload.refresh();
  assert.equal(state.window.overlays.at(-1).icon, null);
});

test('full navigation invalidates cooldown toasts while fresh read observations clear retained attention', async () => {
  const state = startApp();
  await state.ready();
  state.registerAttentionIcon();
  state.tick(6000);
  state.conversationChange('aabbccdd', undefined, '00000001');
  state.advance(600);
  state.conversationChange('bbccddee', undefined, '00000002');
  state.window.webContents.emit('did-start-navigation', { isMainFrame: true, isSameDocument: false });
  state.advance(6000);
  assert.equal(state.notifications.length, 1);
  state.conversationRead('aabbccdd');
  assert.equal(state.window.overlays.at(-1).icon, null);
});

test('disabling notifications keeps rescans and stale renderer badges from restoring app alerts', async () => {
  const state = startApp();
  await state.ready();
  state.registerAttentionIcon();
  state.tick(6000);
  state.report(1);
  state.badgeOverlay('data:image/png;base64,BBBB', '1');
  const enabled = state.menu.find(item => item.label === '檢視').submenu.find(item => item.label === '啟用背景通知');
  enabled.click({ checked: false });
  state.report(1);
  state.badgeOverlay('data:image/png;base64,BBBB', '1');
  state.conversationChange('aabbccdd');
  state.advance(3000);
  assert.equal(state.notifications.length, 0);
  assert.equal(state.window.overlays.at(-1).icon, null);
});

test('a late conversation signal refines a badge toast while its next distinct message still queues', async () => {
  const state = startApp();
  await state.ready();
  state.registerAttentionIcon();
  state.tick(6000);
  state.report(0);
  state.report(1);
  state.advance(1400);
  state.advance(100);
  state.conversationChange('aabbccdd', undefined, '00000001');
  state.advance(700);
  assert.equal(state.notifications.length, 1);
  state.conversationChange('aabbccdd', undefined, '00000002', 'A distinct next message');
  state.advance(1699);
  assert.equal(state.notifications.length, 1);
  state.advance(1);
  assert.equal(state.notifications.length, 2);
  state.conversationRead('aabbccdd');
  assert.equal(state.window.overlays.at(-1).icon, null);
});

test('a trailing blue unread dot detects a new regular-weight preview and its read transition', async () => {
  const state = startApp();
  await state.ready();
  state.tick(6000);
  state.registerAttentionIcon();
  const preload = startPreload((...args) => state.relay(...args));
  const row = preload.thread('123', 'Earlier preview', false);
  preload.rows([row]);
  preload.update();
  row.preview.textContent = 'test';
  row.row.dots = [preload.dot()];
  preload.update();
  preload.update();
  state.advance(600);
  assert.equal(preload.changes().length, 1);
  assert.equal(state.notifications.length, 1);
  assert.equal(state.notifications[0].body, 'test');
  assert.ok(state.window.overlays.at(-1).icon);
  row.row.dots = [];
  preload.update();
  assert.ok(state.window.overlays.at(-1).icon); // A transient dot removal does not clear artwork.
  preload.tick(1500);
  preload.update();
  assert.equal(state.window.overlays.at(-1).icon, null);
});

test('manual taskbar dismissal keeps queued previews and restores only for a new arrival or a dot transition', async () => {
  const state = startApp();
  await state.ready();
  state.registerAttentionIcon();
  state.tick(6000);
  state.blueDots(true);
  state.conversationChange('aabbccdd', undefined, '00000001', 'Queued preview');
  const view = state.menu.find(item => item.label === '檢視');
  const clear = view.submenu.find(item => item.label === '清除未讀提示');
  clear.click();
  assert.equal(state.window.overlays.at(-1).icon, null);
  state.blueDots(true);
  assert.equal(state.window.overlays.at(-1).icon, null);
  state.advance(600);
  assert.equal(state.notifications[0].body, 'Queued preview');
  assert.ok(state.window.overlays.at(-1).icon);

  clear.click();
  state.blueDots(null);
  state.blueDots(true);
  assert.equal(state.window.overlays.at(-1).icon, null); // Unloading is not a read/unread transition.
  state.window.webContents.emit('did-start-navigation', { isMainFrame: true, isSameDocument: false });
  state.blueDots(true);
  assert.equal(state.window.overlays.at(-1).icon, null);
  state.blueDots(false);
  state.blueDots(true);
  assert.ok(state.window.overlays.at(-1).icon);
});

test('an unavailable conversation list preserves artwork despite badge and notification updates', async () => {
  const state = startApp();
  await state.ready();
  state.registerAttentionIcon();
  state.blueDots(true);
  state.blueDots(null);
  state.report(0);
  state.badgeOverlay(null, '');
  state.window.webContents.emit('did-start-navigation', { isMainFrame: true, isSameDocument: false });
  assert.ok(state.window.overlays.at(-1).icon);
  state.blueDots(false);
  state.tick(6000);
  state.blueDots(null);
  state.conversationChange('aabbccdd', undefined, '00000001', 'Still notify');
  state.fireTimers();
  assert.equal(state.notifications[0].body, 'Still notify');
  assert.equal(state.window.overlays.at(-1).icon, null);
});

test('notification switches respect current dot state and do not create initial-preview alerts', async () => {
  const state = startApp();
  await state.ready();
  state.registerAttentionIcon();
  state.blueDots(true);
  const view = state.menu.find(item => item.label === '檢視');
  const enabled = view.submenu.find(item => item.label === '啟用背景通知');
  enabled.click({ checked: false });
  state.blueDots(true);
  assert.equal(state.window.overlays.at(-1).icon, null);
  enabled.click({ checked: true });
  assert.ok(state.window.overlays.at(-1).icon);
  const mode = view.submenu.find(item => item.label === '通知模式');
  mode.submenu[0].click();
  assert.ok(state.window.overlays.at(-1).icon);
  mode.submenu[1].click();
  assert.ok(state.window.overlays.at(-1).icon);
  state.fireTimers();
  assert.equal(state.notifications.length, 0);
});

test('blue-dot IPC rejects subframes, other senders, invalid states and non-conversation pages', async () => {
  const state = startApp();
  await state.ready();
  state.registerAttentionIcon();
  state.blueDots(false);
  state.blueDots('true');
  state.blueDots(true, 'https://www.facebook.com/notifications/');
  state.window.url = 'https://www.facebook.com/messages/';
  state.relayFrom({ sender: state.window.webContents, senderFrame: {} }, 'messenger-blue-dot-state', true);
  state.relayFrom({ sender: {}, senderFrame: state.window.webContents.mainFrame }, 'messenger-blue-dot-state', true);
  assert.equal(state.window.overlays.at(-1).icon, null);
});

test('preload reports current blue-dot state independently of preview weight and preserves it while rows are unavailable', () => {
  const state = startPreload();
  const row = state.thread('123', 'Existing preview', true);
  state.rows([row]);
  state.update();
  assert.deepEqual(state.blueDotReports(), []);
  state.tick(1500);
  state.update();
  assert.deepEqual(state.blueDotReports(), [false]);

  row.row.dots = [state.dot()];
  state.update();
  assert.deepEqual(state.blueDotReports(), [false, true]);

  row.row.dots = [];
  state.update();
  assert.deepEqual(state.blueDotReports(), [false, true]);
  state.tick(3000);
  state.update();
  assert.deepEqual(state.blueDotReports(), [false, true, false]);

  state.rows([]);
  state.update();
  assert.deepEqual(state.blueDotReports(), [false, true, false, null]);
});

test('blue-dot monitoring works without a preview and restarts clear confirmation after unloading', () => {
  const state = startPreload();
  const row = state.thread('123', '', false);
  row.row.dots = [state.dot()];
  state.rows([row]);
  state.update();
  assert.deepEqual(state.blueDotReports(), [true]);
  assert.equal(state.changes().length, 0);

  row.row.dots = [];
  state.update();
  state.tick(1499);
  state.refresh();
  assert.deepEqual(state.blueDotReports(), [true]);
  row.row.dots = [state.dot()];
  state.update(); // A transient disappearance cannot complete a clear.
  row.row.dots = [];
  state.update();
  state.rows([]);
  state.update();
  state.tick(5000);
  state.rows([row]);
  state.update();
  assert.deepEqual(state.blueDotReports(), [true, true, null]); // Refresh re-reports the next confirmed state.
  state.tick(6500);
  state.update();
  assert.deepEqual(state.blueDotReports(), [true, true, null, false]);
});

test('hidden rows cannot confirm an empty blue-dot state', () => {
  const state = startPreload();
  const row = state.thread('123', 'Earlier', false);
  row.row.dots = [state.dot()];
  state.rows([row]);
  state.update();
  row.row.dots = [];
  row.row.getBoundingClientRect = () => ({ width: 0, height: 0 });
  state.update();
  state.tick(10000);
  state.update();
  assert.deepEqual(state.blueDotReports(), [true, null]);
});

test('an unread dot that arrives after preview text triggers once; initial and manual dots do not notify', () => {
  const state = startPreload();
  const row = state.thread('123', 'Initial unread', false);
  row.row.dots = [state.dot()];
  state.rows([row]);
  state.scan();
  assert.equal(state.changes().length, 0);
  row.row.dots = [];
  state.scan();
  row.row.dots = [state.dot()];
  state.scan(); // Manual unread, without a preview change.
  assert.equal(state.changes().length, 0);
  row.row.dots = [];
  row.preview.textContent = 'New incoming';
  state.tick(100);
  state.scan();
  state.tick(2100);
  row.row.dots = [state.dot()];
  state.scan();
  state.scan();
  assert.equal(state.changes().length, 1);
});

test('online dots, leading avatar decoration, hidden dots and rectangular blue controls are not unread', () => {
  const state = startPreload();
  const row = state.thread('123', 'Initial', false);
  state.rows([row]);
  state.scan();
  const decoys = [
    state.dot({ color: 'rgb(49, 162, 76)' }),
    state.dot({ left: 35 }),
    state.dot({ radius: '0px' }),
    state.dot({ size: 32 }),
    state.dot({ text: '1' }),
    state.dot({ display: 'none' }),
    state.dot({ visibility: 'hidden' }),
    state.dot({ opacity: '0' }),
    state.dot({ color: 'rgba(0, 100, 230, 0)' })
  ];
  for (const [index, dot] of decoys.entries()) {
    row.preview.textContent = `Changed ${index}`;
    row.row.dots = [dot];
    state.scan();
  }
  assert.equal(state.changes().length, 0);
});

test('a blue-dot unread row prevents an empty navigation badge from clearing its notification', () => {
  const state = startPreload();
  let badges = [{ textContent: '1' }];
  state.control({ querySelectorAll: () => badges });
  const row = state.thread('123', 'test', false);
  row.row.dots = [state.dot()];
  state.rows([row]);
  state.update();
  badges = [];
  state.update();
  state.tick(2000);
  state.update();
  assert.equal(state.messages.filter(([channel]) => channel === 'messenger-unread-count').at(-1)[1], null);
  row.row.dots = [];
  state.update();
  assert.equal(state.messages.filter(([channel]) => channel === 'messenger-unread-count').at(-1)[1], 0);
});

test('Facebook E2EE conversation links are scanned and their IPC notification is accepted', async () => {
  const state = startApp();
  await state.ready();
  state.tick(6000);
  state.window.url = 'https://www.facebook.com/messages/e2ee/t/27146404911639725/';
  const preload = startPreload((...args) => state.relay(...args));
  const row = preload.thread('27146404911639725', 'Earlier message', false,
    '/messages/e2ee/t/27146404911639725/');
  preload.rows([row]);
  preload.update();
  row.preview.textContent = 'New E2EE message';
  row.row.dots = [preload.dot()];
  preload.update();
  state.advance(600);

  assert.equal(preload.changes().length, 1);
  assert.equal(state.notifications.length, 1);
  assert.equal(state.notifications[0].body, 'New E2EE message');
});
