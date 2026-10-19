
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const {
  app,
  BrowserWindow,
  globalShortcut,
  shell,
  Menu,
  dialog,
  session,
  screen
} = require('electron');

const BASE = 'https://extinction-pending.islepilot.eu';
const HOME = new URL(BASE).origin;

const MIN_WIDTH = 250;
const MIN_HEIGHT = 180;

let win = null;
let clickThrough = false;
let quitting = false;

function isWebUrl(url) {
  try {
    return ['https:', 'http:'].includes(new URL(url).protocol);
  } catch {
    return false;
  }
}

function external(url) {
  if (isWebUrl(url)) {
    shell.openExternal(url).catch(() => {});
  }
}

function navigate(route) {
  if (win && !win.isDestroyed()) {
    win.loadURL(new URL(route, BASE).href).catch(() => {});
  }
}

// Save window size and position.
function settingsFile() {
  return path.join(app.getPath('userData'), 'window-state.json');
}

function getSavedBounds() {
  const fallback = {
    width: 900,
    height: 650
  };

  try {
    const saved = JSON.parse(
      fs.readFileSync(settingsFile(), 'utf8')
    );

    if (
      !Number.isInteger(saved.width) ||
      !Number.isInteger(saved.height) ||
      !Number.isInteger(saved.x) ||
      !Number.isInteger(saved.y)
    ) {
      return fallback;
    }

    const bounds = {
      x: saved.x,
      y: saved.y,
      width: Math.max(MIN_WIDTH, saved.width),
      height: Math.max(MIN_HEIGHT, saved.height)
    };

    // Keep the window on a connected monitor.
    const visible = screen.getAllDisplays().some(display => {
      const area = display.workArea;

      return (
        bounds.x < area.x + area.width &&
        bounds.x + bounds.width > area.x &&
        bounds.y < area.y + area.height &&
        bounds.y + bounds.height > area.y
      );
    });

    return visible ? bounds : fallback;
  } catch {
    return fallback;
  }
}

function saveWindowBounds() {
  if (!win || win.isDestroyed()) return;
  if (win.isMinimized() || win.isMaximized()) return;

  try {
    fs.writeFileSync(
      settingsFile(),
      JSON.stringify(win.getBounds(), null, 2),
      'utf8'
    );
  } catch (error) {
    console.error('Could not save window position:', error);
  }
}

// Keep the overlay above ordinary application windows.
function enforceAlwaysOnTop() {
  if (!win || win.isDestroyed()) return;

  win.setAlwaysOnTop(true, 'screen-saver');

  if (process.platform !== 'win32') {
    win.setVisibleOnAllWorkspaces(true, {
      visibleOnFullScreen: true
    });
  }
}

// Press F8 to hide or show the overlay.
function toggleVisibility() {
  if (!win || win.isDestroyed()) return;

  if (win.isVisible()) {
    win.hide();
    return;
  }

  if (clickThrough) {
    clickThrough = false;
    win.setIgnoreMouseEvents(false);
  }

  win.show();
  enforceAlwaysOnTop();
  win.focus();
}

// Toggle mouse click-through.
function toggleClickThrough() {
  if (!win || win.isDestroyed()) return;

  clickThrough = !clickThrough;

  win.setIgnoreMouseEvents(clickThrough, {
    forward: true
  });
}

function createWindow() {
  win = new BrowserWindow({
    title: 'Extinction Pending Overlay',

    ...getSavedBounds(),

    minWidth: MIN_WIDTH,
    minHeight: MIN_HEIGHT,
    resizable: true,

    show: false,
    backgroundColor: '#101010',
    autoHideMenuBar: true,

    alwaysOnTop: true,
    fullscreenable: false,
    skipTaskbar: false,

    webPreferences: {
      partition: 'persist:extinction-pending',
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      devTools: false
    }
  });

  enforceAlwaysOnTop();

  win.once('ready-to-show', () => {
    if (win && !win.isDestroyed()) {
      win.show();
      enforceAlwaysOnTop();
    }
  });

  win.on('show', enforceAlwaysOnTop);
  win.on('restore', enforceAlwaysOnTop);
  win.on('focus', enforceAlwaysOnTop);

  // Remember the latest window size and position.
  win.on('resized', saveWindowBounds);
  win.on('moved', saveWindowBounds);
  win.on('close', saveWindowBounds);

  // Prevent accidental minimizing.
  win.on('minimize', event => {
    if (!quitting && win && !win.isDestroyed()) {
      event.preventDefault();
    }
  });

  win.loadURL(BASE).catch(() => {
    if (win && !win.isDestroyed()) {
      dialog.showMessageBox(win, {
        type: 'warning',
        title: 'Website unavailable',
        message:
          'Could not load Extinction Pending. Check your internet connection and choose Website → Reload.'
      });
    }
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isWebUrl(url)) {
      if (new URL(url).origin === HOME) {
        navigate(url);
      } else {
        external(url);
      }
    }

    return { action: 'deny' };
  });

  win.webContents.on('will-navigate', (event, url) => {
    if (!isWebUrl(url)) {
      event.preventDefault();
    }
  });

  win.webContents.on('will-redirect', (event, url) => {
    if (!isWebUrl(url)) {
      event.preventDefault();
    }
  });

  win.on('closed', () => {
    win = null;
  });

  const menu = Menu.buildFromTemplate([
    {
      label: 'Website',
      submenu: [
        {
          label: 'Home',
          click: () => navigate('/')
        },
        {
          label: 'My Prehistoric Pal',
          click: () => navigate('/me')
        },
        {
          label: 'Dino Shop',
          click: () => navigate('/shop')
        },
        { type: 'separator' },
        {
          label: 'Back',
          accelerator: 'Alt+Left',
          click: () => {
            if (win?.webContents.canGoBack()) {
              win.webContents.goBack();
            }
          }
        },
        {
          label: 'Forward',
          accelerator: 'Alt+Right',
          click: () => {
            if (win?.webContents.canGoForward()) {
              win.webContents.goForward();
            }
          }
        },
        {
          label: 'Reload',
          accelerator: 'CommandOrControl+R',
          click: () => win?.webContents.reload()
        },
        {
          label: 'Open current page in browser',
          click: () =>
            external(win?.webContents.getURL() || BASE)
        }
      ]
    },
    {
      label: 'Overlay',
      submenu: [
        {
          label: 'Always on top',
          type: 'checkbox',
          checked: true,
          enabled: false
        },
        {
          label: '100% opacity',
          click: () => win?.setOpacity(1)
        },
        {
          label: '90% opacity',
          click: () => win?.setOpacity(0.9)
        },
        {
          label: '75% opacity',
          click: () => win?.setOpacity(0.75)
        },
        {
          label: 'Toggle click-through (Ctrl+Shift+C)',
          click: toggleClickThrough
        },
        {
          label: 'Show / hide (F8)',
          click: toggleVisibility
        },
        { type: 'separator' },
        {
          label: 'Exit',
          click: () => {
            quitting = true;
            app.quit();
          }
        }
      ]
    }
  ]);

  Menu.setApplicationMenu(menu);
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win && !win.isDestroyed()) {
      if (clickThrough) {
        clickThrough = false;
        win.setIgnoreMouseEvents(false);
      }

      win.show();
      enforceAlwaysOnTop();
      win.focus();
    }
  });

  app.whenReady().then(() => {
    const ses = session.fromPartition(
      'persist:extinction-pending'
    );

    ses.setPermissionRequestHandler(
      (_wc, _permission, callback) => callback(false)
    );

    createWindow();

    if (!globalShortcut.register('F8', toggleVisibility)) {
      dialog.showMessageBox({
        type: 'warning',
        message:
          'F8 is already in use by another application. Use Overlay → Show / hide instead.'
      });
    }

    globalShortcut.register(
      'CommandOrControl+Shift+C',
      toggleClickThrough
    );
  });
}

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (!win) {
    createWindow();
  }
});
