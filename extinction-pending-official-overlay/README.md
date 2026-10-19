# Extinction Pending Overlay — Community Release

Windows desktop wrapper for the live website at https://extinction-pending.islepilot.eu. The site itself supplies all branding, shop, teleports, account pages and features; the app does not reproduce or replace the server backend.

## For players

Download the **Windows installer EXE** from your server's official GitHub Releases page, run it, and open **Extinction Pending Overlay** from the Start Menu. No Node.js or Electron Fiddle required. Alternatively download the **portable EXE** to run without installing.

- **F8**: show/hide overlay globally (if another program hasn't claimed F8)
- **Ctrl+Shift+C**: toggle mouse click-through (F8 will restore interaction when hidden)
- **Website menu**: Home, My Prehistoric Pal (`/me`), Dino Shop (`/shop`), Back, Forward, Reload
- **Teleports**: use the server website navigation
- **Overlay menu**: opacity, always on top, click-through, exit

Use **borderless windowed** game mode. Exclusive fullscreen or anti-cheat may block overlays or global shortcuts. This is a standalone window, not a game injection or in-game telemetry tool.

## For server administrators: create your Windows downloads

1. Create a GitHub repository and upload all project files, **including `.github/workflows/windows-release.yml`**.
2. In the GitHub repository open **Actions → Build Windows Overlay → Run workflow**.
3. When it finishes, download the **Extinction-Pending-Windows** artifact containing the installer and portable EXE.
4. Test both on a Windows machine before distributing to players. To create a permanent release page, push a tag such as `v1.0.0`; the workflow will attach the EXEs to a GitHub Release.
5. Publish the release link in your official server Discord/website. For broad public distribution, obtain a Windows code-signing certificate and configure secure signing in CI. Unsigned installers can trigger SmartScreen warnings.

Local development: `npm install` then `npm start`. Local Windows build: `npm run dist:win`.

## Limitations and safety

- This project includes **source and automated Windows packaging**, not a prebuilt or code-signed executable.
- The website may prevent embedded sign-in or rely on cookies or browser redirects. Third-party popups open in the default browser; returning to the overlay may require logging in again. Test Steam authentication, shop and teleports before release.
- No updater, tray icon, telemetry, game-memory access, or anti-cheat bypass is included.
- Global F8 may conflict with game bindings; the menu is a fallback while visible.
- Electron's website session is persistent on the player's machine. Do not share your installed app profile or session data.
- Only distribute this as an *official* overlay if you control the server or have permission to use its branding.
