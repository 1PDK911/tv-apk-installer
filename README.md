# TV APK Installer

A small Windows desktop app for installing Android apps (`.apk`, `.apks`, `.xapk`, `.apkm`) onto a **Google TV / Android TV** over your home Wi-Fi. Under the hood it drives Google's official **adb** (Android Debug Bridge). You don't need a terminal.

- **Connect:** Wireless debugging (pairing code) or classic network debugging (port 5555). TVs on your network are found automatically, and you can always type an IP address.
- **Status:** each TV shows a live status (Connected / Waiting for approval on TV / Offline / Not paired / …) with the exact next step. TVs are remembered and reconnect at launch.
- **Before you install:** an info card shows the icon, name, package, version, min/target Android, CPU types, size, SHA-256, and whether the app is built for TV. Pre-flight checks warn about problems; you can override them.
- **Install:** a drag-and-drop queue with step-by-step progress and Cancel. Errors are explained in plain English with a fix, and some have one-click retries.
- **Bundles:** `.apks` / `.xapk` / `.apkm` are unpacked, the right splits are chosen for your TV, and they're installed with `install-multiple`. OBB game data is copied too.
- **Apps on TV:** open, force-stop, uninstall, or save a copy of any app you installed.
- **Privacy:** no accounts, no telemetry. Network traffic only goes to your TV and, if you choose, a one-time download of Google's platform-tools from `dl.google.com`.

---

## 1. Install the app (Windows)

Download from the [Releases page](https://github.com/1PDK911/tv-apk-installer/releases), or build it yourself (see [Development](#6-development)):

| File | Use it if… |
| --- | --- |
| `TV-APK-Installer-<version>-setup.exe` | You want a normal installer with a Start-menu shortcut. Installs for your user only, so no admin rights are needed. |
| `TV-APK-Installer-<version>-portable.exe` | You want a single file to run, with nothing installed. |

### "Windows protected your PC" / unsigned app warnings

The builds are **not code-signed** (a certificate costs money). Windows and your browser will warn about that the first time:

1. **Browser (Edge/Chrome):** if the download is flagged as "not commonly downloaded", open the downloads list, click **…** → **Keep** (Edge: **Show more** → **Keep anyway**).
2. **SmartScreen:** when you run the file, a blue **"Windows protected your PC"** window appears. Click **More info**, then **Run anyway**.
3. If Windows still refuses (some company PCs), right-click the file → **Properties** → tick **Unblock** at the bottom → **OK**.

Optionally, check the file is the one that was published. In PowerShell, run `Get-FileHash .\TV-APK-Installer-*-setup.exe` and compare the hash with the one listed on the release.

### First run: adb

The app looks for `adb` on your `PATH`, then in the standard Android SDK folder (`%LOCALAPPDATA%\Android\Sdk\platform-tools`). If it finds neither, it offers to **download Google's SDK Platform-Tools** (about 7 MB) from `dl.google.com`. It verifies the SHA-1 checksum from Google's repository index, unpacks it into the app's data folder (`%APPDATA%\TV APK Installer\platform-tools`), and confirms that `adb version` works. No other adb builds are ever used or bundled.

Windows may show a **Windows Defender Firewall** prompt for `adb.exe` the first time. Allow it on **Private networks** so adb can discover TVs on your home network.

---

## 2. Set up your TV (one time)

Use your remote: the arrows move, the centre button selects (**OK**), and **Back** goes back. The app has the same guide under **Setup guide**.

1. **Open Settings.** On the Google TV home screen, go up to your profile picture (top-right) → **Settings**. On older Android TV, select the gear icon.
2. **Unlock Developer options.** Go to **System → About**, scroll to **Android TV OS build**, and press **OK 7 times** quickly. You may be asked for your PIN. You'll see *"You are now a developer!"*
   *Older Android TV:* **Device Preferences → About → Build**.
3. **Open Developer options.** Press **Back** to **System** → **Developer options** (older TVs: under Device Preferences).
4. **Turn on debugging.** Which switch you'll see depends on the model:
   - **Wireless debugging** (Android TV 13+, e.g. Google TV Streamer): turn it on and allow it on your network. In the app use **Add TV → Wireless debugging**.
   - Otherwise turn on **USB debugging** (on Chromecast with Google TV and many TVs this also enables debugging over Wi-Fi), or **Network debugging** / **ADB debugging** if your TV has it. In the app use **Add TV → Network debugging (port 5555)**.
5. **Find the TV's IP address.** With Wireless debugging, it's on that screen under **IP address & Port**. Otherwise go to **Settings → Network & Internet** → select your Wi-Fi network → **IP address**.
   *Tip:* reserve that address for the TV in your router so it doesn't change.

> 🔒 **When you're done installing, turn debugging off again** in Developer options. While it's on, any computer you've paired or approved can control the TV.

---

## 3. Connect

### Wireless debugging (pairing code)

1. On the TV: **Developer options → Wireless debugging → Pair device with pairing code**. Leave this screen open.
2. In the app: **Add TV → Wireless debugging**. Enter the **IP address**, **pairing port** and **6-digit code** from that screen. If the TV appears under "TVs found on your network", click it to fill these in.
3. Press **Back** on the TV to the main Wireless debugging screen. Enter the port shown under **IP address & Port**. It's a *different* number from the pairing port.
4. Click **Pair & connect**.

You only pair once. The wireless debugging port changes when the TV restarts. The app tries to rediscover it automatically, and if it can't, it asks you for the new port.

### Network debugging (port 5555)

1. In the app: **Add TV → Network debugging (port 5555)** and enter the TV's IP address.
2. Click **Connect**, then **look at the TV**: an **"Allow USB debugging?"** dialog appears. Tick **Always allow from this computer** and select **Allow**. The status chip changes from *Waiting for approval on TV* to *Connected*.

---

## 4. Install apps

1. Drag files onto the big drop zone, or click it to choose them. You can queue several.
2. Each file gets an info card plus pre-flight checks against the selected TV:
   - **API level too low:** the app needs a newer Android than the TV has.
   - **ABI mismatch:** the app is built for a different processor.
   - **Low storage:** installing needs about twice the app's size free.
   - **Already installed:** shows "Update vX → vY", or flags a **downgrade**.
   - **Phone app:** it won't appear on the TV home screen and may not work with the remote.
   - **Old target SDK:** Android 14+ blocks apps built for very old Android versions.

   Warnings can be overridden with **I understand — install anyway**.
3. Click **Install** (or **Install all**). Progress is shown step by step, and **Cancel** stops it. Nothing is left half-installed.
4. After success, **Open on TV** launches the app. It uses the TV launcher entry (LEANBACK_LAUNCHER) and falls back to the phone launcher.

If an install fails, the app explains why and how to fix it. Some failures offer a guarded retry:

| Error | What the app offers |
| --- | --- |
| `UPDATE_INCOMPATIBLE` (different signature) / `VERSION_DOWNGRADE` | **Uninstall & reinstall**, after warning that the app's data will be deleted |
| `DEPRECATED_SDK_VERSION` (Android 14+ old-app block) | **Install anyway** with `--bypass-low-target-sdk-block`, after a warning |
| `TEST_ONLY` | **Install test build** with `-t`, after a warning |
| `NO_MATCHING_ABIS`, `OLDER_SDK`, `INSUFFICIENT_STORAGE`, `NO_CERTIFICATES`, `MISSING_SPLIT`, … | A plain-English explanation and the fix |

### Bundles

- **`.apks`:** SAI-style (flat `base.apk` + `split_*.apk`) and bundletool-style (`splits/` folder) are both supported.
- **`.xapk`:** APKs are installed together. OBB files are copied to `/sdcard/Android/obb/<package>/`.
- **`.apkm`:** best effort. Encrypted `.apkm` files (from older APKMirror releases) can't be opened, and the app says so.

The app picks the splits Android itself would pick: the TV's preferred **CPU type**, the closest **screen density**, and the TV's **language** plus English. The info card shows what was chosen.

---

## 5. Apps on TV

The **Apps on TV** tab lists apps you or the Play Store installed (system apps are hidden), with version and source. For each app you can:

- **Open** it.
- **Force stop** it.
- **Uninstall** it, after confirming.
- **Save APK:** a single APK is saved as-is. A split app is saved as one `.apks` file that you can drop back into this app to reinstall.

adb can't read app *names* without downloading every app, so the list shows package names (e.g. `com.netflix.ninja`).

The collapsible **Details** panel at the bottom shows every adb command and its raw output. Pairing codes are masked.

---

## Troubleshooting

| Problem | Try this |
| --- | --- |
| **"Can't reach TV"** | Check the TV is on (not in deep standby) and that the PC and TV are on the **same network**. Guest networks, "AP/client isolation", mesh guest SSIDs and VPNs on the PC all block local connections. Re-check the IP address. |
| **Stuck on "Waiting for approval on TV"** | Wake the TV. The dialog may be behind the screensaver. Click **Reconnect** to show it again. If you once clicked *Deny*, go to Developer options → **Revoke USB debugging authorizations** and reconnect. |
| **Pairing fails / "wrong code"** | The code is only valid while the pairing screen is open. Reopen **Pair device with pairing code** and use the new code and port. The pairing port is not the connect port. |
| **"Port changed"** after the TV restarted | Open **Wireless debugging** on the TV and enter the new **IP address & Port**. On some TVs, Wireless debugging also switches itself off after a restart. |
| **Download of platform-tools fails** | A firewall or proxy may be blocking `dl.google.com`. Install [platform-tools](https://developer.android.com/studio/releases/platform-tools) manually, add the folder to `PATH`, and click **I installed adb myself, check again**. |
| **"adb server version (…) doesn't match this client"** in Details | Another tool started a different adb version. Close other Android tools (Android Studio, phone managers) or run `adb kill-server` once, then click Reconnect. |
| **Installed app isn't on the home screen** | It's a phone app. Use **Open on TV**, or find it in Settings → Apps → *app* → Open. |
| **Play Protect blocked the install** | Look at the TV for a Play Protect message. Only choose to install anyway if you trust the app. |
| **Not enough storage** | Uninstall unused apps from the **Apps on TV** tab, or clear app caches in the TV's Settings → Apps. |
| **Anything else** | Open **Details**, click **Copy**, and include the log when you ask for help. |

---

## Privacy & security

- No telemetry, analytics, crash reporting, accounts or update checks. The spellchecker is disabled so Chromium never fetches dictionaries.
- Network traffic goes only to your TV (via adb) and, if you click the button, to `https://dl.google.com` for platform-tools. The download URL is checked to be `dl.google.com`.
- Electron hardening: `contextIsolation`, `sandbox`, no `nodeIntegration`, and a strict Content-Security-Policy with no remote code and no network access from the page. The preload exposes a narrow typed API, every IPC call is checked for the trusted sender and validated, and navigation, new windows and permission requests are all blocked.
- adb is always run with `spawn(file, argsArray)`. No local shell, and no command strings built from file paths or input. Arguments to `adb shell` are quoted for the TV's shell, and package names and remote paths are validated.
- The renderer refers to files only by an id the main process handed out for files you dropped or picked.
- Bundles are extracted with zip-slip protection into a temp folder that is deleted afterwards (and on next launch if the app was killed).
- IP address, port, pairing code and TV name are validated in both the UI and the main process.

---

## 6. Development

Requirements: **Node.js 20+** (22 LTS recommended) and git. Windows is the target, but development also works on macOS/Linux.

```bash
git clone https://github.com/1PDK911/tv-apk-installer
cd tv-apk-installer
npm ci
npm run dev        # run with hot reload
npm test           # unit tests (vitest)
npm run typecheck
npm run build      # production build into out/
npm start          # run the production build
```

### Build the Windows installer

On **Windows**:

```bash
npm run dist       # → release/TV-APK-Installer-<version>-setup.exe and -portable.exe
```

On Linux you can cross-build if Wine is installed (`apt install wine wine64 wine32:i386`). On macOS, use the GitHub Actions workflow instead: **Actions → Build → Run workflow** builds on a real Windows runner and attaches the installers as an artifact. Pushing a tag like `v0.1.0` does the same.

### Tests

- `npm test` runs the unit tests. All adb access goes through the `AdbRunner` interface, so parsers, error mapping, the device service, the installer and the app manager are tested against recorded and representative adb output in `test/fixtures/adb/`. `test/fixtures/README.md` says which is which.
- APK parsing is tested against real APKs and bundles built with aapt2 by `test/fixtures/apk-src/build.sh` (a dev-only tool; the app never uses aapt).
- `npm run e2e` drives the real UI end to end against a **fake adb** that imitates a TV (`test/e2e/fake-adb.cjs`). It needs Playwright (`npm i -D playwright`) and `npm run build` first.

### Project layout

```
src/
  main/               Electron main process (Node)
    adb/              runner (spawn, cancel, log), client, output parsers, error mapping, adb lookup
    apk/              binary XML + resources.arsc parsers, APK inspection, bundle handling
    services/         devices (pair/connect/status), install, preflight, apps, platform-tools download, store
    ipc.ts            every IPC handler, with input validation
    index.ts          window, CSP, permissions, lifecycle
  preload/index.ts    the typed `window.api` bridge (nothing else is exposed)
  shared/             types, API contract, validation, status copy, CSP
  renderer/           React UI (Vite)
test/                 vitest suites, fixtures, fake adb + e2e script
build/icon.png        app icon
```

## License

No license has been chosen yet; all rights reserved by the repository owner until one is added.
