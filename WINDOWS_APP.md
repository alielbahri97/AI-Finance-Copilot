# FinPilot as a Windows / mobile app

FinPilot is a Next.js web app. A full native UWP (C#/XAML) rewrite is out of scope.
Instead, FinPilot ships as a **Progressive Web App (PWA)** that installs like a native app
on phones and Windows, plus an optional **MSIX / PWABuilder** packaging path for Store or
sideload distribution.

Live site: https://ali-finpilot.vercel.app

## What you get vs true native UWP

| Capability | FinPilot PWA / packaged PWA | Classic UWP (C#) |
| --- | --- | --- |
| Home screen / Start menu icon | Yes | Yes |
| Standalone window (no browser chrome) | Yes | Yes |
| Offline shell / basic offline | Limited (shell cache) | Full offline possible |
| Push notifications | Yes (Web Push) | Native push APIs |
| Windows Store / sideload MSIX | Via PWABuilder | Native packaging |
| Native WinRT APIs, XAML UI | No — runs the web app in WebView2/Edge | Yes |

For SMB finance workflows (dashboard, import, copilot, reports), the PWA delivers the same
product as the website inside an installable shell.

---

## Install on phone (Android / iOS)

### Android (Chrome)

1. Open https://ali-finpilot.vercel.app in Chrome.
2. Sign in (optional before install).
3. Tap the **Install FinPilot** banner, or menu → **Install app** / **Add to Home screen**.
4. Launch FinPilot from the home screen — it opens fullscreen (standalone).

### iPhone / iPad (Safari)

1. Open https://ali-finpilot.vercel.app in Safari (not Chrome-in-app).
2. Tap the Share button → **Add to Home Screen**.
3. Confirm the name **FinPilot** and add.
4. Open from the home screen for the standalone experience.

---

## Install on Windows (no Visual Studio)

### Option A — Install from Edge / Chrome (fastest)

1. Open https://ali-finpilot.vercel.app in Microsoft Edge (recommended) or Chrome.
2. Click the install icon in the address bar, or use the **Install FinPilot** banner.
3. FinPilot appears in Start under your apps and can be pinned to the taskbar.

This is a Chromium PWA (same app package model Edge uses for installed web apps).

### Option B — Generate an MSIX package with PWABuilder (Store / sideload)

Use this when you want a classic Windows package (`.msix`) similar to UWP distribution.

1. Go to [PWABuilder](https://www.pwabuilder.com/).
2. Enter `https://ali-finpilot.vercel.app` and start.
3. Confirm the manifest scores well (name, icons 512px, `display: standalone`, service worker).
4. Under **Package for stores** → choose **Windows** → generate the MSIX / APPX package.
5. Sideload:
   - Enable **Developer Mode** or **Sideload apps** in Windows Settings → System → For developers.
   - Double-click the `.msix` or install via `Add-AppxPackage` in PowerShell.
6. Optionally submit the package to the Microsoft Store.

Config hints used by this repo live in `windows/pwabuilder.json`.

### Option C — Lightweight WebView2 host (developers)

If you prefer a thin native shell that always loads the live site:

1. On a Windows machine with Visual Studio 2022 + **Windows App SDK / WinUI 3** and
   **WebView2** runtime installed.
2. Create a blank WinUI 3 Desktop app.
3. Host a `WebView2` control and navigate to `https://ali-finpilot.vercel.app`.
4. Set the window title to **FinPilot** and use icons from `public/icons/`.

A starter pointer lives in `windows/webview2-host.md`. This is optional — Option A or B is
enough for most users.

---

## Verify PWA locally / in production

After deploy:

- Manifest: https://ali-finpilot.vercel.app/manifest.webmanifest
- Service worker: https://ali-finpilot.vercel.app/sw.js
- Chrome DevTools → Application → Manifest / Service Workers should show FinPilot as installable.

---

## Related files

- `src/app/manifest.ts` — web app manifest
- `public/sw.js` — service worker (install + push)
- `public/icons/` — PWA / touch icons
- `src/components/pwa-register.tsx` — registers the SW in production
- `src/components/pwa-install-prompt.tsx` — Chromium install banner
- `windows/` — PWABuilder / WebView2 packaging notes
