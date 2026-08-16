# Lucky 9

Lucky 9 is a cross-platform multiplayer card game for Windows, Android, and iOS. This implementation uses a dependency-free Node server and an installable PWA client, so the same experience works in desktop and mobile browsers.

## Run Locally

```powershell
scripts\start-server.cmd
```

Then open `http://localhost:4179` from Windows, or from a phone on the same network using the computer's LAN IP address.

For remote play with people on different networks:

```powershell
scripts\start-remote-server.cmd
```

Share the `https://*.trycloudflare.com` URL that appears. Browser players open it directly; Android APK players paste it into the `Server URL` field.

For app-style APK sharing where nobody types a server address, host the server at a permanent HTTPS URL and build with:

```powershell
scripts\build-all.cmd -ServerUrl https://REPLACE-WITH-YOUR-REAL-SERVER -RequireAndroid
```

The normal APK screen hides the Server URL field. Use `-AllowManualServerUrl` only for testing.

## Build Packages

```powershell
scripts\build-all.cmd
```

Android debug APK output:

```text
dist\android\app-debug.apk
```

See `docs\build-and-run.md` for Windows, Android, and iOS notes.
See `docs\back4app-free-deploy.md` for the recommended no-credit-card internet-hosting path.
See `docs\github-pages-web.md` for the free auto-updating browser/mobile web frontend.
See `docs\northflank-free-deploy.md` for the Northflank path if your account supports Sandbox without payment details.

## Test

```powershell
npm.cmd test
```

## Platform Notes

- Windows: works in current Microsoft Edge, Chrome, or Firefox. Edge/Chrome can install it as an app from the browser menu.
- Android 10+: works in Chrome or other modern Chromium browsers. Use "Add to Home screen" for app-style launch.
- iOS 16+: works in Safari. Use Share > Add to Home Screen. Production installs should be served over HTTPS.

The server owns the draw stack, player hands, scoring, matchmaking, disconnect handling, and per-player hidden state so clients cannot see private cards.
