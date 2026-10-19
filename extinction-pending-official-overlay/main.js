'use strict';
const { app, BrowserWindow, globalShortcut, shell, Menu, dialog, session } = require('electron');
const BASE = 'https://extinction-pending.islepilot.eu';
const HOME = new URL(BASE).origin;
let win = null;
let clickThrough = false;
let quitting = false;

function isWebUrl(url) {
  try { return ['https:', 'http:'].includes(new URL(url).protocol); } catch { return false; }
}
function external(url) {
  if (isWebUrl(url)) shell.openExternal(url).catch(() => {});
}
function navigate(path) {
  if (win && !win.isDestroyed()) win.loadURL(new URL(path, BASE).href).catch(() => {});
}
function toggleVisibility() {
  if (!win || win.isDestroyed()) return;
  if (win.isVisible()) { win.hide(); return; }
  if (clickThrough) {
    clickThrough = false;
    win.setIgnoreMouseEvents(false);
  }
  win.show(); win.focus();
}
function toggleClickThrough() {
  if (!win || win.isDestroyed()) return;
  clickThrough = !clickThrough;
  win.setIgnoreMouseEvents(clickThrough, { forward: true });
}
function createWindow() {
  win = new BrowserWindow({
    title: 'Extinction Pending Overlay', width: 1250, height: 820,
    minWidth: 640, minHeight: 420, show: false,
    backgroundColor: '#101010', autoHideMenuBar: true,
    alwaysOnTop: true,
    webPreferences: {
      partition: 'persist:extinction-pending',
      nodeIntegration: false, contextIsolation: true, sandbox: true,
      webSecurity: true, devTools: false
    }
  });
  win.once('ready-to-show', () => win && win.show());
  win.loadURL(BASE).catch(() => {
    if (win && !win.isDestroyed()) dialog.showMessageBox(win, {
      type: 'warning', title: 'Website unavailable',
      message: 'Could not load Extinction Pending. Check your internet connection and choose Website → Reload.'
    });
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isWebUrl(url)) {
      if (new URL(url).origin === HOME) navigate(url);
      else external(url); // Steam login and third-party popups use system browser
    }
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    if (!isWebUrl(url)) event.preventDefault();
  });
  win.webContents.on('will-redirect', (event, url) => {
    if (!isWebUrl(url)) event.preventDefault();
  });
  win.on('closed', () => { win = null; });
  const menu = Menu.buildFromTemplate([
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
    { label: 'Overlay', submenu: [
      { label: 'Always on top', type: 'checkbox', checked: true, click: item => win?.setAlwaysOnTop(item.checked) },
      { label: '100% opacity', click: () => win?.setOpacity(1) },
      { label: '90% opacity', click: () => win?.setOpacity(.9) },
      { label: '75% opacity', click: () => win?.setOpacity(.75) },
      { label: 'Toggle click-through (Ctrl+Shift+C)', click: toggleClickThrough },
      { label: 'Show / hide (F8)', click: toggleVisibility },
      { type: 'separator' },
      { label: 'Exit', click: () => { quitting = true; app.quit(); } }
    ] }
  ]);
  Menu.setApplicationMenu(menu);
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => {
    if (win && !win.isDestroyed()) { win.show(); win.focus(); }
  });
  app.whenReady().then(() => {
    // Restrict permission prompts from embedded web content.
    const ses = session.fromPartition('persist:extinction-pending');
    ses.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
    createWindow();
    if (!globalShortcut.register('F8', toggleVisibility)) {
      dialog.showMessageBox({ type: 'warning', message: 'F8 is already in use by another application. Use Overlay → Show / hide instead.' });
    }
    globalShortcut.register('CommandOrControl+Shift+C', toggleClickThrough);
  });
}
app.on('will-quit', () => globalShortcut.unregisterAll());
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (!win) createWindow(); });
