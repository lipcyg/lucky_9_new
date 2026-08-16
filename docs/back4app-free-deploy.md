# Back4app Free Deploy

Use this path when you need a free public server without entering credit card details.

## Why Back4app Containers

Back4app Containers has a free container plan with GitHub deployment, Docker deployment, and a public URL. Back4app's pricing page says the free container plan is `0 USD/month` and no credit card is required.

## 1. Sign Up

Open:

```text
https://www.back4app.com/signup-containers
```

Sign up with GitHub so Back4app can see your repositories.

## 2. Create A Container App

1. Choose Containers / Web Deployment.
2. Connect GitHub if it asks.
3. Select this repository:

```text
lipcyg/lucky_9_new
```

4. Configure:

```text
App name: lucky9
Branch: main
Root: /
Dockerfile: /Dockerfile
Auto deploy: enabled
```

No extra environment variables are required. The Dockerfile sets:

```text
PORT=4179
```

## 3. Wait For Deployment

Back4app will build the Dockerfile and deploy the container. When it finishes, open the app URL from the Back4app dashboard.

Test:

```text
https://YOUR-BACK4APP-URL/api/health
```

It should show:

```json
{"ok":true}
```

## 4. Build The Android APK With That URL

Back on this Windows machine:

```powershell
scripts\build-all.cmd -ServerUrl https://YOUR-BACK4APP-URL -RequireAndroid
```

Install:

```text
dist\android\app-debug.apk
```

The APK will hide the Server URL box and connect to Back4app automatically.

## Notes

- Do not use a LAN URL like `http://192.168.x.x:4179` for internet play.
- Do not use placeholder URLs such as `https://your-permanent-lucky9-server.com`.
- If the health URL does not show `{"ok":true}`, check the Back4app build/runtime logs.
