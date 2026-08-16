# Build And Run

Lucky 9 is a multiplayer web app with a Node server. All players, including Android and iOS users, must connect to the same running server.

## Start The Server

From the project folder:

```powershell
scripts\start-server.cmd
```

Or:

```powershell
scripts\start-server.ps1
```

The script prints:

- `http://localhost:4179` for the host computer.
- LAN URLs such as `http://192.168.1.17:4179` for phones on the same Wi-Fi.

For players in different places, start the server on a VPS/cloud machine or expose it with a tunnel such as Cloudflare Tunnel or ngrok, then share the HTTPS URL.

## Remote Play

For a quick test when players are not on the same Wi-Fi:

```powershell
scripts\start-remote-server.cmd
```

The first run downloads `cloudflared` into `.tools\cloudflared`. The script starts the Lucky 9 server on this computer, opens a Cloudflare quick tunnel, and prints a temporary public URL like:

```text
https://example-name.trycloudflare.com
```

Keep that terminal window open while everyone plays.

Share the printed HTTPS URL with the other players:

- Browser players open the URL directly.
- Android APK players paste the URL into the `Server URL` field, then create or join with the game code.
- iPhone/iPad browser players open the URL in Safari.

Cloudflare quick tunnels are best for testing and local sharing. For a permanent room URL, run Lucky 9 on a VPS or configure a named Cloudflare Tunnel with your own domain.

If the tunnel fails with `lookup api.trycloudflare.com: no such host`, this computer's DNS cannot resolve Cloudflare. Check internet access, then try a public DNS server such as `1.1.1.1` or `8.8.8.8`.

## App-Style Internet Play

Normal multiplayer APKs do not ask for a server address because the developer puts a permanent backend URL inside the app.

Lucky 9 can do the same. First host the Lucky 9 server somewhere with a stable HTTPS URL, for example:

- A VPS/cloud server running `node server/index.js`.
- A named Cloudflare Tunnel attached to your own domain.
- Any Node hosting provider that supports long-running HTTP servers.

Then build the APK with that URL:

```powershell
scripts\build-all.cmd -ServerUrl https://REPLACE-WITH-YOUR-REAL-SERVER -RequireAndroid
```

Or with an environment variable:

```powershell
$env:LUCKY9_SERVER_URL = "https://REPLACE-WITH-YOUR-REAL-SERVER"
scripts\build-all.cmd -RequireAndroid
```

When `ServerUrl` is bundled, Android users do not need to type the server address. They open the app, enter their name, and create or join with the game code.

To make a test build that shows the manual Server URL field:

```powershell
scripts\build-all.cmd -AllowManualServerUrl -RequireAndroid
```

## Build Everything

```powershell
scripts\build-all.cmd
```

Or:

```powershell
scripts\build-all.ps1
```

This creates:

- `dist\lucky9-server\` - runnable server/web package.
- `dist\lucky9-windows-server.zip` - Windows/server zip package.
- `dist\android\` - Android APK output folder, when an Android native project exists.
- `dist\ios\` - iOS output folder, when an iOS native project exists and the script is run on macOS.

To check whether this computer can build APK/iOS packages:

```powershell
scripts\check-native-prereqs.cmd
```

To install the Android build tools locally under `.tools`:

```powershell
scripts\install-android-toolchain.cmd
. .\.android-env.ps1
```

To make the build fail when Android or iOS cannot be built:

```powershell
scripts\build-all.cmd -RequireAndroid
scripts\build-all.cmd -RequireIos
```

## Android APK

This repository includes a Capacitor Android wrapper. Install the local Android toolchain first:

```powershell
scripts\install-android-toolchain.cmd
```

Then build:

```powershell
scripts\build-all.cmd
```

The script will call Gradle and copy APK files into `dist\android\`.

If you open a fresh terminal before building, the build script loads `.android-env.ps1` automatically.

The debug APK path is:

```text
dist\android\app-debug.apk
```

After installing the APK, enter your running Lucky 9 server URL on the first screen, for example `http://192.168.1.17:4179` on the same Wi-Fi or your public HTTPS tunnel URL for remote play.

If you built with `-ServerUrl`, the Server URL field is hidden and the APK connects automatically.

## iOS

iOS builds must be done on macOS with Xcode. Add Capacitor iOS on the Mac:

```bash
npm install @capacitor/core @capacitor/cli @capacitor/ios
npx cap init Lucky9 com.lucky9.game --web-dir public
npx cap add ios
scripts/build-all.ps1
```

To install on real iPhones, use Xcode signing. For wider sharing, use TestFlight or Apple Developer distribution.

## Windows EXE

The current build creates a Windows/server zip, not a true `.exe`. A real `.exe` needs an Electron or Tauri wrapper. The server still needs to run somewhere reachable by all players.
