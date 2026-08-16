# GitHub Pages Web App

Use GitHub Pages for the browser/mobile web UI when Back4app Auto Deployment is unavailable.

Back4app will continue to run the Lucky 9 game server at:

```text
https://lucky9-13mbgohw.b4a.run
```

GitHub Pages will host the changing frontend files from the `public` folder.

## Enable GitHub Pages

1. Open:

```text
https://github.com/lipcyg/lucky_9_new/settings/pages
```

2. Under `Build and deployment`, set:

```text
Source: GitHub Actions
```

3. Save.

The workflow at `.github/workflows/pages.yml` deploys the `public` folder after every push to `main`.

## Public Web URL

After the workflow succeeds, open:

```text
https://lipcyg.github.io/lucky_9_new/
```

## Notes

- The Android APK does not use GitHub Pages for UI. APK UI changes require installing the rebuilt APK.
- Back4app still serves the API and game sessions.
- GitHub Pages is only for browser/mobile web users.
