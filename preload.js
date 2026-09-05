const { ipcRenderer } = require('electron');

// --- Helper Functions ---
function debounce(func, wait) {
    let timeout;
    return function (...args) {
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(this, args), wait);
    };
}

// --- 1. Notification Interception (Main + Service Worker) ---
function filterNotification(title, options) {
    const lowerTitle = title ? title.toLowerCase() : '';
    const lowerBody = (options && options.body) ? options.body.toLowerCase() : '';
    const isMessage = lowerTitle.includes('message') || lowerTitle.includes('messenger') || 
                      lowerTitle.includes('訊息') || lowerTitle.includes('聊天室') ||
                      lowerBody.includes('sent') || lowerBody.includes('傳送') ||
                      lowerBody.includes('message') || lowerBody.includes('訊息');
    const isFB = lowerTitle.includes('facebook') || lowerBody.includes('facebook');
    if (isFB && !isMessage) return true; 
    if (!isMessage) return true;
    return false;
}

const OriginalNotification = window.Notification;
const CustomNotification = function (title, options) {
    if (filterNotification(title, options)) {
        return { onclick: null, onshow: null, onerror: null, onclose: null, close: () => {} };
    }
    return new OriginalNotification(title, options);
};
CustomNotification.requestPermission = OriginalNotification.requestPermission;
CustomNotification.permission = OriginalNotification.permission;
window.Notification = CustomNotification;

if ('ServiceWorkerRegistration' in window) {
    const originalShowNotification = ServiceWorkerRegistration.prototype.showNotification;
    ServiceWorkerRegistration.prototype.showNotification = function(title, options) {
        if (filterNotification(title, options)) return Promise.resolve();
        return originalShowNotification.call(this, title, options);
    };
}

// --- 2. DOM-Only Badge Detection ---
function getMessengerUnreadCount() {
    const messengerSelectors = [
        'a[href^="/messages/"]',
        'div[role="button"][aria-label*="Messenger"]',
        'div[role="button"][aria-label*="訊息"]',
        'div[aria-label="Messenger"]',
        'div[aria-label="訊息"]'
    ];
    
    for (const selector of messengerSelectors) {
        const element = document.querySelector(selector);
        if (element) {
            const badge = element.querySelector('span[role="gridcell"], span[aria-hidden="false"], div[style*="background-color"] span, span:not(:empty)');
            if (badge) {
                const count = parseInt(badge.textContent.trim(), 10);
                if (!isNaN(count) && count > 0) return count;
            }
            return 0;
        }
    }

    const title = document.title;
    const match = title.match(/^\((\d+)\)/);
    if (match) {
        const isGeneric = title.includes('Messenger | Facebook') || title.includes('Messages | Facebook') || title.includes('Facebook');
        if (!isGeneric) return parseInt(match[1], 10);
    }
    return 0;
}

let lastCount = -1;
function updateBadge() {
    const count = getMessengerUnreadCount();
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
    updateBadge();
    const debouncedUpdateBadge = debounce(updateBadge, 200);
    const observer = new MutationObserver(debouncedUpdateBadge);
    observer.observe(document.body, { childList: true, subtree: true });
    const titleElement = document.querySelector('title');
    if (titleElement) {
        new MutationObserver(debouncedUpdateBadge).observe(titleElement, { childList: true, subtree: true, characterData: true });
    }
    setInterval(updateBadge, 2000);
});