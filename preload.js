const { ipcRenderer } = require('electron');

// --- 1. Notification Interception (Main + Service Worker) ---
function filterNotification(title, options) {
    const lowerTitle = title ? title.toLowerCase() : '';
    const lowerBody = (options && options.body) ? options.body.toLowerCase() : '';
    
    // Filter conditions
    const isFB = lowerTitle.includes('facebook') || lowerBody.includes('facebook');
    const isMessage = lowerTitle.includes('message') || lowerTitle.includes('messenger') || 
                      lowerTitle.includes('訊息') || lowerTitle.includes('聊天室') ||
                      lowerBody.includes('sent') || lowerBody.includes('傳送');

    if (isFB && !isMessage) {
        console.log('[Filter] Blocked General FB Notification:', { title, body: options?.body });
        return true; // Block
    }
    console.log('[Filter] Allowed Notification:', { title, body: options?.body });
    return false; // Allow
}

// Intercept Main Window Notifications
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

// Intercept Service Worker Notifications
if ('ServiceWorkerRegistration' in window) {
    const originalShowNotification = ServiceWorkerRegistration.prototype.showNotification;
    ServiceWorkerRegistration.prototype.showNotification = function(title, options) {
        if (filterNotification(title, options)) {
            return Promise.resolve();
        }
        return originalShowNotification.call(this, title, options);
    };
}

// --- 2. Advanced Badge Detection (DOM + Title) ---
function getMessengerUnreadCount() {
    // Strategy A: Check the Sidebar "Messenger" icon's badge directly
    // FB uses various selectors, we try to find the one with aria-label for Messenger
    const messengerLink = document.querySelector('a[href^="/messages/"]');
    if (messengerLink) {
        // Look for a badge inside or near the Messenger link
        const badge = messengerLink.querySelector('span[role="gridcell"] span, div[aria-label] span, span[aria-label*="未讀"], span[aria-label*="unread"]');
        if (badge) {
            const count = parseInt(badge.textContent, 10);
            if (!isNaN(count)) return count;
        }
    }

    // Strategy B: Fallback to Title with strict filtering
    const title = document.title;
    const match = title.match(/^\((\d+)\)/);
    if (match) {
        const c = parseInt(match[1], 10);
        const lowerTitle = title.toLowerCase();
        
        const hasMessageKeyword = lowerTitle.includes('message') || lowerTitle.includes('messenger') || lowerTitle.includes('訊息') || lowerTitle.includes('聊天室');
        const isNotificationAction = /(liked|commented|replied|tagged|shared|posted|invited|requested|added|說讚|回應|標註|分享|貼文|邀請|請求|加入)/i.test(lowerTitle);
        const isGenericFB = lowerTitle.includes('facebook') && !hasMessageKeyword;

        if (hasMessageKeyword) return c;
        if (isGenericFB || isNotificationAction) return 0;
        
        // If it's just a name like "(1) John Doe", we assume it's a message
        if (!lowerTitle.includes('facebook')) return c;
    }
    
    return 0;
}

let lastCount = -1;
function updateBadge() {
    const count = getMessengerUnreadCount();

    if (count !== lastCount) {
        console.log(`[Badge] Unread count changed: ${lastCount} -> ${count} (Title: "${document.title}")`);
        lastCount = count;
        if (count > 0) {
            const dataUrl = drawBadge(count);
            ipcRenderer.send('update-badge', { dataUrl, text: count.toString() });
        } else {
            ipcRenderer.send('update-badge', { dataUrl: null, text: '' });
        }
    }
}

// --- 3. UI Helpers ---
function injectStyles() {
    const style = document.createElement('style');
    style.textContent = `
        /* Hide general notifications bell count */
        div[aria-label="Notifications"] span, 
        div[aria-label="通知"] span,
        div[role="navigation"] a[href*="/notifications/"] span { 
            display: none !important; 
        }
        /* Hide the bell itself to be safe */
        div[aria-label="Notifications"], 
        div[aria-label="通知"],
        div[role="navigation"] a[href*="/notifications/"] { 
            display: none !important; 
        }
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

// --- Event Listeners ---
let lastRightClickElement = null;
window.addEventListener('contextmenu', (e) => { lastRightClickElement = e.target; });

ipcRenderer.on('select-all-message', () => {
    if (lastRightClickElement) {
        const range = document.createRange();
        range.selectNodeContents(lastRightClickElement);
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
    }
});

ipcRenderer.on('copy-entire-message', () => {
    if (lastRightClickElement) {
        const text = lastRightClickElement.innerText || lastRightClickElement.textContent || '';
        if (text) ipcRenderer.send('copy-to-clipboard', text);
    }
});

window.addEventListener('DOMContentLoaded', () => {
    injectStyles();
    updateBadge();

    const titleElement = document.querySelector('title');
    if (titleElement) {
        new MutationObserver(updateBadge).observe(titleElement, { childList: true, subtree: true, characterData: true });
    }
    
    // Check DOM periodically for badge changes that don't trigger title update
    setInterval(updateBadge, 2000);
});