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
// signal. A missing/unrecognized control means "unknown", not zero. An absent
// badge is only evidence of zero after this same control exposed a numeric badge.
const recognizedBadgeControls = new WeakSet();
let zeroBadgeSince = null;
function getMessengerUnreadSignal() {
    const messengerSelectors = [
        'a[href="/messages/"], a[href="/messages"]',
        'div[role="button"][aria-label*="Messenger"]',
        'div[role="button"][aria-label*="訊息"]',
        'div[aria-label="Messenger"]',
        'div[aria-label="訊息"]'
    ];
    
    let recognizedControl = false;
    let ambiguousBadge = false;
    for (const selector of messengerSelectors) {
        for (const element of document.querySelectorAll(selector)) {
            if (recognizedBadgeControls.has(element)) recognizedControl = true;
            const badges = element.querySelectorAll('span[role="gridcell"], span[aria-hidden="false"], div[style*="background-color"] span');
            for (const badge of badges) {
                const text = badge.textContent.trim();
                if (/^\d{1,5}\+?$/.test(text)) {
                    recognizedBadgeControls.add(element);
                    recognizedControl = true;
                    const count = Number(text.replace('+', ''));
                    if (count > 0) {
                        zeroBadgeSince = null;
                        return count;
                    }
                    // Explicit zero also needs to survive transient hydration.
                    continue;
                }
                if (text) ambiguousBadge = true;
            }
        }
    }
    if (!recognizedControl || ambiguousBadge) {
        zeroBadgeSince = null;
        return null;
    }
    if (zeroBadgeSince === null) zeroBadgeSince = Date.now();
    return Date.now() - zeroBadgeSince >= 1500 ? 0 : null;
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

function hasUnreadDot(row) {
    // Some Messenger layouts use a blue dot instead of bold preview text. Scope
    // the visual fallback to a small, empty circle on the trailing side of one
    // conversation row; avatar presence dots and blue buttons are not unread.
    const rowRect = row.getBoundingClientRect();
    if (rowRect.width <= 0 || rowRect.height <= 0) return false;
    const rtl = window.getComputedStyle(row).direction === 'rtl';
    const candidates = row.querySelectorAll('span, div');
    for (const element of candidates) {
        if (element.textContent.trim()) continue;
        const rect = element.getBoundingClientRect();
        if (rect.width < 6 || rect.width > 16 || rect.height < 6 || rect.height > 16 ||
            Math.abs(rect.width - rect.height) > 2 ||
            (rtl ? rect.right > rowRect.left + rowRect.width * 0.3 : rect.left < rowRect.left + rowRect.width * 0.7) ||
            rect.left < rowRect.left - 1 || rect.right > rowRect.right + 1 ||
            rect.top < rowRect.top || rect.bottom > rowRect.bottom) continue;
        const style = window.getComputedStyle(element);
        if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) continue;
        const color = style.backgroundColor.match(/^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)(?:\s*[,/]\s*([\d.]+))?\s*\)$/);
        if (!color) continue;
        const [, red, green, blue] = color.map(Number);
        const alpha = color[4] === undefined ? 1 : Number(color[4]);
        if (alpha < 0.8 || blue < 150 || blue - red < 80 || blue - green < 40) continue;
        const rounded = ['borderTopLeftRadius', 'borderTopRightRadius', 'borderBottomLeftRadius', 'borderBottomRightRadius']
            .every(property => {
                const radius = style[property];
                return radius.endsWith('%') ? parseFloat(radius) >= 45 : parseFloat(radius) >= Math.min(rect.width, rect.height) * 0.45;
            });
        if (rounded) return true;
    }
    return false;
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
        // Preview text and unread styling can arrive in separate DOM updates.
        // Always recheck visible rows, including previously read conversations.
        const weight = window.getComputedStyle(preview).fontWeight;
        const boldPreview = weight === 'bold' || weight === 'bolder' || parseInt(weight, 10) >= 600;
        const unreadDot = !boldPreview && hasUnreadDot(row);
        const unread = boldPreview || unreadDot;
        threads.set(match[1], {
            preview: previewHash,
            previewText: Array.from(previewText).slice(0, 160).join(''),
            unread,
            unreadSource: boldPreview ? 'preview-weight' : (unreadDot ? 'blue-dot' : 'none')
        });
    }
    return threads;
}

let knownThreads = new Map();
let conversationBaselineReady = false;
let lastConversationAvailable = null;
let visibleUnread = false;
let refreshReadStates = false;
function updateConversationSignals() {
    const current = getConversationSnapshot();
    visibleUnread = [...current.values()].some(state => state.unread);
    if ((current.size > 0) !== lastConversationAvailable) {
        lastConversationAvailable = current.size > 0;
        console.info(`[Messenger notification] Conversation rows ${lastConversationAvailable ? 'detected' : 'unavailable'}`);
    }
    if (!current.size) return;
    const now = Date.now();
    for (const [id, state] of current) {
        const previous = knownThreads.get(id);
        let revision = previous?.revision || 0;
        let pendingUntil = previous?.pendingUntil || 0;
        if (previous && previous.preview !== state.preview) {
            revision++;
            pendingUntil = now + 4000;
        }
        if (conversationBaselineReady && previous) {
            if (state.unread && pendingUntil > now) {
                console.info(`[Messenger notification] Conversation arrival detected (${state.unreadSource})`);
                ipcRenderer.send('messenger-conversation-change', {
                    thread: fingerprint(id),
                    message: fingerprint(`${id}:${state.preview}:${revision}`),
                    preview: state.previewText
                });
                pendingUntil = 0;
            }
        }
        // Initial read observations also reconcile alerts retained across a full
        // reload. Visible rows are evidence; an unloaded row is never "read".
        if (!state.unread && (!previous || previous.unread || refreshReadStates)) {
            if (previous?.unread) console.info('[Messenger notification] Conversation read detected');
            ipcRenderer.send('messenger-conversation-read', fingerprint(id));
        }
        // Retain only fingerprints and detection metadata, never message text.
        knownThreads.set(id, { preview: state.preview, unread: state.unread, revision, pendingUntil });
    }
    conversationBaselineReady = true;
    refreshReadStates = false;
    // Virtualized lists may unload rows; retain a bounded history so scrolling
    // them back into view does not turn an old unread chat into a new alert.
    while (knownThreads.size > 500) knownThreads.delete(knownThreads.keys().next().value);
}

let lastCount = -1;
let lastSignal;
let lastBadgeAvailable = null;
function updateBadge() {
    updateConversationSignals();
    const badgeSignal = getMessengerUnreadSignal();
    // A visible unread conversation contradicts an empty navigation badge.
    const signal = badgeSignal === 0 && visibleUnread ? null : badgeSignal;
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
    ipcRenderer.send('messenger-monitoring-scan');
}

ipcRenderer.on('refresh-messenger-state', () => {
    // Re-report even unchanged values after mode switches or focus. A scan must
    // precede acknowledging weak alerts, so confirmed conversation reads win.
    lastSignal = undefined;
    lastCount = -1;
    refreshReadStates = true;
    if (document.body) updateBadge();
});

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
    observer.observe(document.body, {
        childList: true, subtree: true, characterData: true, attributes: true,
        attributeFilter: ['class', 'style', 'aria-label', 'aria-selected', 'aria-current']
    });
    const titleElement = document.querySelector('title');
    if (titleElement) {
        new MutationObserver(debouncedUpdateBadge).observe(titleElement, { childList: true, subtree: true, characterData: true });
    }
    setInterval(updateBadge, 2000);
});
