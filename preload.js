const { ipcRenderer } = require('electron');

// --- Helper Functions ---
function debounce(func, wait) {
    let timeout;
    return function (...args) {
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(this, args), wait);
    };
}

// --- Messenger unread badge detection ---
// Only a numeric badge inside the Messenger navigation control is a notification
// signal. A missing control means "unknown", not zero.
function getMessengerUnreadSignal() {
    const messengerSelectors = [
        'a[href="/messages/"], a[href="/messages"]',
        'div[role="button"][aria-label*="Messenger"]',
        'div[role="button"][aria-label*="訊息"]',
        'div[aria-label="Messenger"]',
        'div[aria-label="訊息"]'
    ];
    
    let foundControl = false;
    let ambiguousBadge = false;
    for (const selector of messengerSelectors) {
        const element = document.querySelector(selector);
        if (element) {
            foundControl = true;
            const badges = element.querySelectorAll('span[role="gridcell"], span[aria-hidden="false"], div[style*="background-color"] span');
            for (const badge of badges) {
                const text = badge.textContent.trim();
                if (/^\d{1,5}$/.test(text)) return Number(text);
                if (/^\d{1,5}\+$/.test(text)) return Number(text.slice(0, -1));
                if (text) ambiguousBadge = true;
            }
        }
    }
    return foundControl && !ambiguousBadge ? 0 : null;
}

function getMessengerUnreadCount(count = getMessengerUnreadSignal()) {
    if (count !== null) return count;
    // Title counts are only a visual badge fallback; Facebook can include other
    // notifications in its title, so never use them to trigger a message alert.
    const title = document.title;
    const match = title.match(/^\((\d+)\)/);
    if (match) {
        const isGeneric = title.includes('Messenger | Facebook') || title.includes('Messages | Facebook') || title.includes('Facebook');
        if (!isGeneric) return parseInt(match[1], 10);
    }
    return 0;
}

// Derive an incoming-message signal from conversation rows without depending on
// localized labels. Only compare threads already seen on this page: a newly
// rendered old conversation is not proof that a message just arrived.
function fingerprint(value) {
    let hash = 2166136261;
    for (const char of value.replace(/\s+/g, ' ').trim().slice(0, 500)) {
        hash = Math.imul(hash ^ char.codePointAt(0), 16777619);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
}

function getConversationSnapshot() {
    const threads = new Map();
    const links = document.querySelectorAll('a[href*="/messages/t/"], a[href^="/t/"]');
    for (const link of links) {
        if (threads.size >= 100) break;
        const href = link.getAttribute('href');
        if (!href) continue;
        let url;
        try { url = new URL(href, location.href); } catch { continue; }
        const match = url.pathname.match(/^\/(?:messages\/)?t\/([^/]+)\/?$/);
        if (!match || !['www.facebook.com', 'm.facebook.com', 'www.messenger.com', 'm.messenger.com'].includes(url.hostname)) continue;

        const row = link.closest('[role="row"], [role="listitem"]') || link;
        const texts = [...row.querySelectorAll('[dir="auto"]')]
            .filter(element => !element.querySelector('[dir="auto"]') && element.textContent.trim());
        // The first text node is typically the conversation name; the second is
        // the message preview. Skip rows where this structure is not present.
        if (texts.length < 2) continue;
        const preview = texts[1];
        const previewText = preview.textContent.replace(/\s+/g, ' ').trim();
        const previewHash = fingerprint(previewText);
        const previous = knownThreads.get(match[1]);
        let unread = previous?.unread || false;
        // Reading computed styles on every mutation is expensive on Facebook's
        // large DOM; only inspect a row when its preview actually changes.
        if (!previous || previous.unread || previous.preview !== previewHash) {
            const weight = window.getComputedStyle(preview).fontWeight;
            unread = weight === 'bold' || weight === 'bolder' || parseInt(weight, 10) >= 600;
        }
        threads.set(match[1], {
            preview: previewHash,
            previewText: Array.from(previewText).slice(0, 160).join(''),
            unread
        });
    }
    return threads;
}

let knownThreads = new Map();
let conversationBaselineReady = false;
let lastConversationAvailable = null;
function updateConversationSignals() {
    const current = getConversationSnapshot();
    if ((current.size > 0) !== lastConversationAvailable) {
        lastConversationAvailable = current.size > 0;
        console.info(`[Messenger notification] Conversation rows ${lastConversationAvailable ? 'detected' : 'unavailable'}`);
    }
    if (!current.size) return;
    if (conversationBaselineReady) {
        for (const [id, state] of current) {
            const previous = knownThreads.get(id);
            if (previous && state.unread && previous.preview !== state.preview) {
                ipcRenderer.send('messenger-conversation-change', {
                    thread: fingerprint(id),
                    message: fingerprint(`${id}:${state.preview}`),
                    preview: state.previewText
                });
            } else if (previous?.unread && !state.unread) {
                ipcRenderer.send('messenger-conversation-read', fingerprint(id));
            }
        }
    }
    conversationBaselineReady = true;
    // Keep only fingerprints between scans; do not retain message text.
    for (const [id, state] of current) knownThreads.set(id, { preview: state.preview, unread: state.unread });
    // Virtualized lists may unload rows; retain a bounded history so scrolling
    // them back into view does not turn an old unread chat into a new alert.
    while (knownThreads.size > 500) knownThreads.delete(knownThreads.keys().next().value);
}

let lastCount = -1;
let lastSignal = null;
let lastBadgeAvailable = null;
function updateBadge() {
    updateConversationSignals();
    const signal = getMessengerUnreadSignal();
    if ((signal !== null) !== lastBadgeAvailable) {
        lastBadgeAvailable = signal !== null;
        console.info(`[Messenger notification] Navigation badge ${lastBadgeAvailable ? 'available' : 'unavailable'}; title fallback ${lastBadgeAvailable ? 'optional' : 'enabled'}`);
    }
    if (signal !== lastSignal) {
        lastSignal = signal;
        ipcRenderer.send('messenger-unread-count', signal);
    }
    const count = getMessengerUnreadCount(signal);
    if (count !== lastCount) {
        console.log(`[Badge] Unread count: ${count}`);
        lastCount = count;
        if (count > 0) {
            const dataUrl = drawBadge(count);
            ipcRenderer.send('update-badge', { dataUrl, text: count.toString() });
        } else {
            ipcRenderer.send('update-badge', { dataUrl: null, text: '' });
        }
    }
}

// --- 3. UI Cleaning & Context Menu ---
function setTopBarVisibility(hide) {
    let style = document.getElementById('fbm-custom-topbar-style');
    if (hide) {
        if (!style) {
            style = document.createElement('style');
            style.id = 'fbm-custom-topbar-style';
            style.textContent = `
                :root, :host, body, div, [class], *, *::before, *::after {
                    --header-height: 0px !important;
                }
                html, html:root, body {
                    overflow: hidden !important;
                    overflow-y: hidden !important;
                }
                html::-webkit-scrollbar {
                    display: none !important;
                    width: 0px !important;
                    height: 0px !important;
                }
                div[role="banner"], header[role="banner"], [role="banner"] {
                    display: none !important;
                }
            `;
        }
        const target = document.documentElement || document.head;
        if (target && !style.isConnected) {
            target.appendChild(style);
        }
        if (document.documentElement) {
            document.documentElement.style.setProperty('overflow-y', 'hidden', 'important');
            document.documentElement.style.setProperty('overflow', 'hidden', 'important');
        }
        if (document.body) {
            document.body.style.setProperty('overflow-y', 'hidden', 'important');
            document.body.style.setProperty('overflow', 'hidden', 'important');
        }
    } else {
        if (style) {
            style.remove();
        }
        if (document.documentElement) {
            document.documentElement.style.removeProperty('overflow-y');
            document.documentElement.style.removeProperty('overflow');
        }
        if (document.body) {
            document.body.style.removeProperty('overflow-y');
            document.body.style.removeProperty('overflow');
        }
    }
}

let shouldHideTopBar = true;
try {
    const res = ipcRenderer.sendSync('get-hide-top-bar');
    if (typeof res === 'boolean') {
        shouldHideTopBar = res;
    }
} catch (e) {
    console.error('Failed to get hide-top-bar state:', e);
}

if (shouldHideTopBar) {
    const tryInjectInitial = () => {
        if (document.head || document.documentElement) {
            setTopBarVisibility(true);
        } else {
            requestAnimationFrame(tryInjectInitial);
        }
    };
    tryInjectInitial();
}

ipcRenderer.on('toggle-top-bar', (event, hide) => {
    shouldHideTopBar = hide;
    setTopBarVisibility(hide);
});

function injectStyles() {
    const style = document.createElement('style');
    style.textContent = `
        div[aria-label="Notifications"], div[aria-label="通知"],
        a[href*="/notifications/"] { display: none !important; }
        div[aria-label="Notifications"] span, div[aria-label="通知"] span { display: none !important; }
    `;
    document.head.appendChild(style);
}

function drawBadge(count) {
    const radius = 32;
    const size = radius * 2;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#FF3B30';
    ctx.beginPath();
    ctx.arc(radius, radius, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'white';
    ctx.font = 'bold 40px Arial'; 
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    let text = count > 99 ? '99+' : count.toString();
    if (count > 99) ctx.font = 'bold 30px Arial';
    else if (count > 9) ctx.font = 'bold 36px Arial';
    ctx.fillText(text, radius, radius + 4); 
    return canvas.toDataURL();
}

// Context Menu Features
let lastRightClickElement = null;
// Use capture: true to ensure we get the element even if FB stops propagation
window.addEventListener('contextmenu', (e) => {
    lastRightClickElement = e.target;
}, true);

function getMessageContainer(el) {
    if (!el) return null;
    
    // Try to find the closest element that represents the message text
    // Messenger uses dir="auto" for text containers.
    // We want the outermost one if they are nested.
    let current = el.closest('[dir="auto"]');
    if (!current) return el;

    let highest = current;
    while (current.parentElement) {
        current = current.parentElement.closest('[dir="auto"]');
        if (current) {
            highest = current;
        } else {
            break;
        }
    }
    return highest;
}

ipcRenderer.on('select-all-message', () => {
    const container = getMessageContainer(lastRightClickElement);
    if (container) {
        const range = document.createRange();
        range.selectNodeContents(container);
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
    }
});

ipcRenderer.on('copy-entire-message', () => {
    const container = getMessageContainer(lastRightClickElement);
    if (container) {
        const text = container.innerText || container.textContent || '';
        if (text) ipcRenderer.send('copy-to-clipboard', text);
    }
});

window.addEventListener('DOMContentLoaded', () => {
    injectStyles();
    setTopBarVisibility(shouldHideTopBar);
    ipcRenderer.send('register-attention-icon', drawBadge('!'));
    updateBadge();
    const debouncedUpdateBadge = debounce(updateBadge, 200);
    const observer = new MutationObserver(debouncedUpdateBadge);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    const titleElement = document.querySelector('title');
    if (titleElement) {
        new MutationObserver(debouncedUpdateBadge).observe(titleElement, { childList: true, subtree: true, characterData: true });
    }
    setInterval(updateBadge, 2000);
});
