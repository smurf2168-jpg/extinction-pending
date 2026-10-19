'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow, globalShortcut, shell, Menu, dialog, session, screen, ipcMain } = require('electron');
const { autoUpdater } = require('electron-updater');

const BASE = 'https://extinction-pending.islepilot.eu';
const HOME = new URL(BASE).origin;
const MIN_WIDTH = 250;
const MIN_HEIGHT = 180;
let win = null;
let clickThrough = false;
let quitting = false;
let updateStatus = 'idle';
let updateVersion = '';
let updateCheckTimer = null;

function isWebUrl(url) {
  try { return ['https:', 'http:'].includes(new URL(url).protocol); }
  catch { return false; }
}
function external(url) {
  if (isWebUrl(url)) shell.openExternal(url).catch(() => {});
}
function navigate(route) {
  if (win && !win.isDestroyed()) win.loadURL(new URL(route, BASE).href).catch(() => {});
}
function settingsFile() {
  return path.join(app.getPath('userData'), 'window-state.json');
}
function getSavedBounds() {
  const fallback = { width: 900, height: 650 };
  try {
    const saved = JSON.parse(fs.readFileSync(settingsFile(), 'utf8'));
    if (![saved.x, saved.y, saved.width, saved.height].every(Number.isInteger)) return fallback;
    const bounds = { x: saved.x, y: saved.y, width: Math.max(MIN_WIDTH, saved.width), height: Math.max(MIN_HEIGHT, saved.height) };
    const visible = screen.getAllDisplays().some(({ workArea: area }) =>
      bounds.x < area.x + area.width && bounds.x + bounds.width > area.x &&
      bounds.y < area.y + area.height && bounds.y + bounds.height > area.y
    );
    return visible ? bounds : fallback;
  } catch { return fallback; }
}
function saveWindowBounds() {
  if (!win || win.isDestroyed() || win.isMinimized() || win.isMaximized()) return;
  try { fs.writeFileSync(settingsFile(), JSON.stringify(win.getBounds(), null, 2), 'utf8'); }
  catch (error) { console.error('Could not save window position:', error); }
}
function enforceAlwaysOnTop() {
  if (!win || win.isDestroyed()) return;
  win.setAlwaysOnTop(true, 'screen-saver');
  if (process.platform !== 'win32') win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
}
function toggleVisibility() {
  if (!win || win.isDestroyed()) return;
  if (win.isVisible()) { win.hide(); return; }
  if (clickThrough) { clickThrough = false; win.setIgnoreMouseEvents(false); }
  win.show(); enforceAlwaysOnTop(); win.focus();
}
function toggleClickThrough() {
  if (!win || win.isDestroyed()) return;
  clickThrough = !clickThrough;
  win.setIgnoreMouseEvents(clickThrough, { forward: true });
}

// Update UI is a separate local window. It never injects JavaScript into IslePilot.
let updateWindow = null;
function updateWindowHtml() {
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'">
  <style>body{background:#121a20;color:#fff;font:14px system-ui;padding:16px;margin:0}h2{font-size:17px;margin:0 0 10px}p{color:#c9d2d7}button{background:#45b76a;border:0;border-radius:6px;padding:12px;color:#07110a;font-weight:700;width:100%;cursor:pointer}button:disabled{opacity:.55;cursor:default}#status{min-height:34px}</style></head>
  <body><h2>Extinction Pending Update</h2><p id="status">Checking update...</p><button id="action" style="display:none"></button>
  <script>
    const { ipcRenderer } = require('electron');
    const status = document.getElementById('status');
    const action = document.getElementById('action');
    ipcRenderer.on('update-state', (_event, data) => {
      status.textContent = data.message;
      action.style.display = data.button ? 'block' : 'none';
      action.textContent = data.button || '';
      action.disabled = !!data.disabled;
    });
    action.addEventListener('click', () => ipcRenderer.send('update-action'));
    ipcRenderer.send('update-state-request');
  </script></body></html>`;
}
function showUpdateWindow() {
  if (updateWindow && !updateWindow.isDestroyed()) { updateWindow.show(); updateWindow.focus(); return; }
  updateWindow = new BrowserWindow({
    title: 'Extinction Pending Update', width: 390, height: 225, resizable: false,
    parent: win && !win.isDestroyed() ? win : undefined,
    alwaysOnTop: true, autoHideMenuBar: true,
    webPreferences: { nodeIntegration: true, contextIsolation: false, sandbox: false, devTools: false }
  });
  updateWindow.setMenu(null);
  updateWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(updateWindowHtml()));
  updateWindow.on('closed', () => { updateWindow = null; });
}
function sendUpdateState() {
  if (!updateWindow || updateWindow.isDestroyed()) return;
  const states = {
    available: { message: `Version ${updateVersion} is available.`, button: 'Download Update' },
    downloading: { message: 'Downloading update. Please wait...', button: 'Downloading...', disabled: true },
    downloaded: { message: `Version ${updateVersion} is ready to install.`, button: 'Restart & Install' },
    error: { message: 'Update failed. Please try again later or use GitHub Releases.', button: '' },
    idle: { message: 'Checking for updates...', button: '' }
  };
  updateWindow.webContents.send('update-state', states[updateStatus] || states.idle);
}
function showUpdateNotice() {
  if (!win || win.isDestroyed()) return;
  // A native Windows menu is available even when the website is loaded remotely.
  const template = buildMenu();
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
function checkForUpdates() {
  if (!app.isPackaged || process.platform !== 'win32') return;
  autoUpdater.checkForUpdates().catch(error => console.error('Update check failed:', error));
}
function configureUpdater() {
  if (!app.isPackaged || process.platform !== 'win32') return;
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.on('update-available', info => {
    updateVersion = info.version;
    updateStatus = 'available';
    showUpdateNotice();
    sendUpdateState();
  });
  autoUpdater.on('update-not-available', () => {
    if (updateStatus === 'idle') showUpdateNotice();
  });
  autoUpdater.on('download-progress', progress => {
    updateStatus = 'downloading';
    if (updateWindow && !updateWindow.isDestroyed()) {
      updateWindow.webContents.send('update-state', {
        message: `Downloading: ${Math.round(progress.percent)}%`, button: 'Downloading...', disabled: true
      });
    }
  });
  autoUpdater.on('update-downloaded', () => {
    updateStatus = 'downloaded';
    showUpdateNotice();
    sendUpdateState();
  });
  autoUpdater.on('error', error => {
    console.error('Auto-update error:', error);
    if (updateStatus === 'downloading') { updateStatus = 'error'; sendUpdateState(); }
  });
  checkForUpdates();
  updateCheckTimer = setInterval(checkForUpdates, 60 * 60 * 1000);
}
function updateAction() {
  if (updateStatus === 'available') {
    updateStatus = 'downloading';
    sendUpdateState();
    autoUpdater.downloadUpdate().catch(error => {
      console.error('Download failed:', error);
      updateStatus = 'error'; sendUpdateState();
    });
  } else if (updateStatus === 'downloaded') {
    quitting = true;
    autoUpdater.quitAndInstall(false, true);
  }
}
function buildMenu() {
  const overlayItems = [
    { label: 'Always on top', type: 'checkbox', checked: true, enabled: false },
    { label: '100% opacity', click: () => win?.setOpacity(1) },
    { label: '90% opacity', click: () => win?.setOpacity(.9) },
    { label: '75% opacity', click: () => win?.setOpacity(.75) },
    { label: 'Toggle click-through (Ctrl+Shift+C)', click: toggleClickThrough },
    { label: 'Show / hide (F8)', click: toggleVisibility }
  ];
  if (['available', 'downloading', 'downloaded', 'error'].includes(updateStatus)) {
    overlayItems.push({ type: 'separator' }, {
      label: updateStatus === 'downloaded' ? 'Update Ready — Restart & Install' :
        updateStatus === 'downloading' ? 'Downloading Update...' : 'Update Available — Click Here',
      click: showUpdateWindow
    });
  }
  overlayItems.push({ type: 'separator' }, { label: 'Exit', click: () => { quitting = true; app.quit(); } });
  return [
    { label: 'Website', submenu: [
      { label: 'Home', click: () => navigate('/') },
      { label: 'My Prehistoric Pal', click: () => navigate('/me') },
      { label: 'Dino Shop', click: () => navigate('/shop') },
      { type: 'separator' },
      { label: 'Back', accelerator: 'Alt+Left', click: () => { if (win?.webContents.canGoBack()) win.webContents.goBack(); } },
      { label: 'Forward', accelerator: 'Alt+Right', click: () => { if (win?.webContents.canGoForward()) win.webContents.goForward(); } },
      { label: 'Reload', accelerator: 'CommandOrControl+R', click: () => win?.webContents.reload() },
      { label: 'Open current page in browser', click: () => external(win?.webContents.getURL() || BASE) }
    ] },
    { label: 'Overlay', submenu: overlayItems }
  ];
}
function createWindow() {
  win = new BrowserWindow({
    title: 'Extinction Pending Overlay', ...getSavedBounds(),
    frame: false, thickFrame: true,
    minWidth: MIN_WIDTH, minHeight: MIN_HEIGHT, resizable: true,
    show: false, backgroundColor: '#101010', autoHideMenuBar: false,
    alwaysOnTop: true, fullscreenable: false, skipTaskbar: false,
    webPreferences: {
      partition: 'persist:extinction-pending', nodeIntegration: false,
      contextIsolation: true, sandbox: true, webSecurity: true, devTools: false
    }
  });
  enforceAlwaysOnTop();
  win.once('ready-to-show', () => { if (win && !win.isDestroyed()) { win.show(); enforceAlwaysOnTop(); } });
  win.on('show', enforceAlwaysOnTop);
  win.on('restore', enforceAlwaysOnTop);
  win.on('focus', enforceAlwaysOnTop);
  win.on('resized', saveWindowBounds);
  win.on('moved', saveWindowBounds);
  win.on('close', saveWindowBounds);
  // A transparent 16px strip at the top lets players drag the frameless overlay.
  // It is recreated after navigation so it works on every website page.
  win.webContents.on('did-finish-load', () => {
    if (!win || win.isDestroyed()) return;
    win.webContents.insertCSS(`
      /* Hide the right scrollbar until the pointer is over the overlay. */
      html::-webkit-scrollbar, body::-webkit-scrollbar {
        width: 0;
        height: 0;
      }
      html:hover::-webkit-scrollbar, html:hover body::-webkit-scrollbar {
        width: 8px;
      }
      html::-webkit-scrollbar-thumb, body::-webkit-scrollbar-thumb {
        background: rgba(155, 165, 170, 0.65);
        border-radius: 8px;
      }
      html::-webkit-scrollbar-track, body::-webkit-scrollbar-track {
        background: transparent;
      }
      html::before {
        content: '';
        position: fixed;
        top: 0; left: 0; right: 0;
        height: 16px;
        z-index: 2147483647;
        background: transparent;
        -webkit-app-region: drag;
      }
    `).catch(error => console.error('Could not add drag strip:', error));
  });
  win.on('minimize', event => { if (!quitting && win && !win.isDestroyed()) event.preventDefault(); });
  win.loadURL(BASE).catch(() => {
    if (win && !win.isDestroyed()) dialog.showMessageBox(win, {
      type: 'warning', title: 'Website unavailable',
      message: 'Could not load Extinction Pending. Check your internet connection and choose Website → Reload.'
    });
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isWebUrl(url)) {
      if (new URL(url).origin === HOME) navigate(url);
      else external(url);
    }
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => { if (!isWebUrl(url)) event.preventDefault(); });
  win.webContents.on('will-redirect', (event, url) => { if (!isWebUrl(url)) event.preventDefault(); });
  win.on('closed', () => { win = null; });
  // Frameless windows have no native menu bar; show the menu on right-click.
  Menu.setApplicationMenu(null);
  win.webContents.on('context-menu', () => {
    const template = buildMenu();
    Menu.buildFromTemplate(template).popup({ window: win });
  });
}
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => {
    if (win && !win.isDestroyed()) {
      if (clickThrough) { clickThrough = false; win.setIgnoreMouseEvents(false); }
      win.show(); enforceAlwaysOnTop(); win.focus();
    }
  });
  app.whenReady().then(() => {
    const ses = session.fromPartition('persist:extinction-pending');
    ses.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
    ipcMain.on('update-state-request', event => {
      if (updateWindow && event.sender === updateWindow.webContents) sendUpdateState();
    });
    ipcMain.on('update-action', event => {
      if (updateWindow && event.sender === updateWindow.webContents) updateAction();
    });
    createWindow();
    if (!globalShortcut.register('F8', toggleVisibility)) {
      dialog.showMessageBox({ type: 'warning', message: 'F8 is already in use by another application. Use Overlay → Show / hide instead.' });
    }
    globalShortcut.register('CommandOrControl+Shift+C', toggleClickThrough);
    // Move the frameless window with Ctrl+Alt+arrow keys.
    const steps = { Up: [0, -30], Down: [0, 30], Left: [-30, 0], Right: [30, 0] };
    for (const [key, [dx, dy]] of Object.entries(steps)) {
      globalShortcut.register('CommandOrControl+Alt+' + key, () => {
        if (!win || win.isDestroyed()) return;
        const [x, y] = win.getPosition();
        win.setPosition(x + dx, y + dy);
        saveWindowBounds();
      });
    }
    configureUpdater();
  });
}
app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  if (updateCheckTimer) clearInterval(updateCheckTimer);
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (!win) createWindow(); });
