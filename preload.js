const { ipcRenderer } = require('electron');

// --- 1. Notification Interception (Main + Service Worker) ---
function filterNotification(title, options) {
    const lowerTitle = title ? title.toLowerCase() : '';
    const lowerBody = (options && options.body) ? options.body.toLowerCase() : '';
    
    // Only allow if it's explicitly a message
    const isMessage = lowerTitle.includes('message') || lowerTitle.includes('messenger') || 
                      lowerTitle.includes('訊息') || lowerTitle.includes('聊天室') ||
                      lowerBody.includes('sent') || lowerBody.includes('傳送') ||
                      lowerBody.includes('message') || lowerBody.includes('訊息');

    // Block if it's general FB or doesn't look like a message
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

// --- 2. DOM-Only Badge Detection (The Key Fix) ---
function getMessengerUnreadCount() {
    // We search for the Messenger icon in the top navigation or left sidebar.
    // These buttons have specific aria-labels and often contain the badge.
    
    // Selectors for the Messenger button/link
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
            // Find the badge inside this element. 
            // FB badges are usually spans with numeric text and a red background.
            // We look for any span/div that contains a number.
            const badge = element.querySelector('span[role="gridcell"], span[aria-hidden="false"], div[style*="background-color"] span, span:not(:empty)');
            if (badge) {
                const text = badge.textContent.trim();
                const count = parseInt(text, 10);
                if (!isNaN(count) && count > 0) {
                    return count;
                }
            }
            
            // If we found the Messenger element but it has NO badge inside,
            // it means there are 0 unread messages, even if the Title says otherwise!
            return 0;
        }
    }

    // Fallback: If we can't find the Messenger icon at all (e.g. page still loading), 
    // only THEN check the title, but with extreme skepticism.
    const title = document.title;
    const match = title.match(/^\((\d+)\)/);
    if (match) {
        // Only trust title if it's NOT just generic Messenger/Facebook
        // If it's a specific person "(1) John Doe", it's probably a message.
        const isGeneric = title.includes('Messenger | Facebook') || title.includes('Messages | Facebook') || title.includes('Facebook');
        if (!isGeneric) {
            return parseInt(match[1], 10);
        }
    }
    
    return 0;
}

let lastCount = -1;
function updateBadge() {
    const count = getMessengerUnreadCount();

    if (count !== lastCount) {
        console.log(`[Badge] Confirmed Unread count: ${count} (Ignored Title: "${document.title}")`);
        lastCount = count;
        if (count > 0) {
            const dataUrl = drawBadge(count);
            ipcRenderer.send('update-badge', { dataUrl, text: count.toString() });
        } else {
            ipcRenderer.send('update-badge', { dataUrl: null, text: '' });
        }
    }
}

// --- 3. UI Cleaning ---
function injectStyles() {
    const style = document.createElement('style');
    style.textContent = `
        /* Hide ALL general notification indicators on Facebook */
        div[aria-label="Notifications"], div[aria-label="通知"],
        a[href*="/notifications/"] { 
            display: none !important; 
        }
        
        /* Hide red dots on the notification bell in the top nav */
        div[aria-label="Notifications"] span, div[aria-label="通知"] span {
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

window.addEventListener('DOMContentLoaded', () => {
    injectStyles();
    updateBadge();

    // Observe body for any changes (since FB is a heavy SPA)
    const observer = new MutationObserver(updateBadge);
    observer.observe(document.body, { childList: true, subtree: true });
    
    const titleElement = document.querySelector('title');
    if (titleElement) {
        new MutationObserver(updateBadge).observe(titleElement, { childList: true, subtree: true, characterData: true });
    }
    
    setInterval(updateBadge, 2000);
});