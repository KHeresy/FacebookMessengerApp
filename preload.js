const { ipcRenderer } = require('electron');

function drawBadge(count) {
    const radius = 32;
    const size = radius * 2; // 64x64 for high DPI
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');

    // Draw red circle
    ctx.fillStyle = '#FF3B30'; // iOS red style
    ctx.beginPath();
    ctx.arc(radius, radius, radius, 0, Math.PI * 2);
    ctx.fill();

    // Draw text
    ctx.fillStyle = 'white';
    // Scale font size based on canvas size
    ctx.font = 'bold 40px Arial'; 
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    
    let text = count.toString();
    if (count > 99) {
        text = '99+';
        ctx.font = 'bold 30px Arial';
    } else if (count > 9) {
         ctx.font = 'bold 36px Arial';
    }
    
    // Adjust Y slightly for visual centering
    ctx.fillText(text, radius, radius + 4); 

    return canvas.toDataURL();
}

let lastCount = -1;

function updateBadge() {
    const title = document.title;
    // Regex to match (1) or (20) at the start of title
    const match = title.match(/^\((\d+)\)/);
    const count = match ? parseInt(match[1], 10) : 0;

    if (count !== lastCount) {
        lastCount = count;
        if (count > 0) {
            const dataUrl = drawBadge(count);
            ipcRenderer.send('update-badge', { dataUrl, text: count.toString() });
        } else {
            ipcRenderer.send('update-badge', { dataUrl: null, text: '' });
        }
    }
}

let lastRightClickElement = null;

window.addEventListener('contextmenu', (e) => {
    lastRightClickElement = e.target;
});

ipcRenderer.on('select-all-message', () => {
    if (lastRightClickElement) {
        // Create a range to select the contents of the element
        const range = document.createRange();
        range.selectNodeContents(lastRightClickElement);
        
        // Update the current selection
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
    }
});

window.addEventListener('DOMContentLoaded', () => {
    // Initial check
    updateBadge();

    // 1. Observer strategy
    const titleElement = document.querySelector('title');
    if (titleElement) {
        new MutationObserver(updateBadge).observe(titleElement, { childList: true, subtree: true, characterData: true });
    } else {
        const headObserver = new MutationObserver(() => {
            const t = document.querySelector('title');
            if (t) {
                headObserver.disconnect();
                new MutationObserver(updateBadge).observe(t, { childList: true, subtree: true, characterData: true });
                updateBadge();
            }
        });
        headObserver.observe(document.head, { childList: true });
    }

    // 2. Polling strategy (Backup)
    // Sometimes frameworks update title in ways observers miss, or if the observer detaches.
    setInterval(updateBadge, 1000);
});