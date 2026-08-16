# Northflank Free Deploy

Use this path for internet play without asking players to type a server address.

## Why Northflank

Northflank Sandbox is the best free first choice for Lucky 9 because it provides always-on compute, free services, GitHub deployment, public HTTPS endpoints, and Dockerfile builds. It is easier than managing a free VM.

## 1. Push Lucky 9 To GitHub

Create a new GitHub repository, then from this project folder run:

```powershell
git add .
git commit -m "Initial Lucky 9"
git branch -M main
git remote add origin https://github.com/YOUR_GITHUB_NAME/lucky9.git
git push -u origin main
```

If `git remote add origin` says the remote already exists, use:

```powershell
git remote set-url origin https://github.com/YOUR_GITHUB_NAME/lucky9.git
git push -u origin main
```

## 2. Create The Northflank Service

1. Sign in to Northflank.
2. Create a Sandbox project.
3. Create a new combined service.
4. Select the Lucky 9 GitHub repository and the `main` branch.
5. Choose Dockerfile build.
6. Use this Dockerfile path:

```text
/Dockerfile
```

7. The Dockerfile already starts the server with:

```text
npm start
```

8. Add a public HTTP port:

```text
4179
```

Northflank will expose it through a public HTTPS `code.run` URL.

## 3. Verify The Server URL

Open:

```text
https://YOUR-NORTHFLANK-URL/api/health
```

It should show:

```json
{"ok":true}
```

## 4. Build The Android APK With That URL

Back on this Windows machine:

```powershell
scripts\build-all.cmd -ServerUrl https://YOUR-NORTHFLANK-URL -RequireAndroid
```

Install:

```text
dist\android\app-debug.apk
```

The APK will hide the Server URL box and connect to Northflank automatically.

## Notes

- Do not build with `https://your-permanent-lucky9-server.com`; that is only placeholder text.
- Do not use a LAN URL like `http://192.168.x.x:4179` for internet play.
- If Northflank Sandbox is unavailable for your account, use Oracle Cloud Always Free VM as the fallback.
