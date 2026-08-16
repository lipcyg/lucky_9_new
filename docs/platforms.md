# Platform Support

Lucky 9 ships as an installable web app backed by a Node matchmaking and game-state server.

## Windows

1. Start the server with `pnpm start`.
2. Open `http://localhost:4179`.
3. Install through Edge or Chrome for a desktop-window experience.

## Android 10+

1. Put the phone on the same network as the server.
2. Open `http://<server-ip>:4179` in Chrome.
3. Use the browser menu and choose "Add to Home screen".

## iOS 16+

1. Put the iPhone on the same network as the server.
2. Open `http://<server-ip>:4179` in Safari.
3. Use Share > Add to Home Screen.

For remote online play outside a LAN, deploy the server to a public host and serve the client over HTTPS. HTTPS is also required for a production-quality install experience on iOS and Android.
