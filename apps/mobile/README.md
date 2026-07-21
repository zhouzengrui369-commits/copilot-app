# OpenClaw Mobile

iPhone/TestFlight-first companion app for OpenClaw Workbench. Android/Mate60 is paused except for crash-log diagnosis.

## iPhone TestFlight

TestFlight is the final iPhone delivery path. It requires an Apple Developer Program account or App Store Connect team membership for the Apple ID used by EAS.

```bash
cd /Users/njx/openclaw_data/openclaw_workbench
npm run mobile:ios:testflight
npm run mobile:ios:submit:testflight
```

If EAS returns `You are not registered as an Apple Developer`, do not keep retrying the build with the same Apple ID. Enroll the Apple ID in Apple Developer Program or use an Apple ID that already belongs to a Developer/App Store Connect team.

## iPhone Expo Go preview

Expo Go is a temporary iPhone preview path to validate pairing, today, chat, approvals, and offline-read behavior before TestFlight credentials are ready. It does not replace TestFlight or final installation acceptance.

```bash
cd /Users/njx/openclaw_data/openclaw_workbench
npm run mobile:ios:expo-go
```

Use these values on iPhone:

- Expo Go Metro URL: `exp://192.168.0.107:8082`
- Workbench URL during pairing: `http://192.168.0.107:38888`

Keep iPhone and Mac on the same Wi-Fi. Open Workbench `/mobile`, generate a fresh 6-digit pairing code, then enter the Workbench URL and code in the iPhone preview.

## Android preview APK

Prerequisites:

- Expo/EAS account with Android build access.
- Mac Workbench running on `38888`.
- Android test phone.
- Cloudflare Tunnel HTTPS domain for outside-LAN use, or Mac LAN IP for same-Wi-Fi testing.

First-time EAS setup requires account login and project linking:

```bash
cd /Users/njx/openclaw_data/openclaw_workbench/apps/mobile
npx eas-cli@latest login
npx eas-cli@latest init
```

`eas init` writes the Expo project id into `app.json`. Do not invent this id manually.

Build the Android internal APK:

```bash
cd /Users/njx/openclaw_data/openclaw_workbench
npm run mobile:android:preview
```

For a local Android build environment:

```bash
npm run mobile:android:preview:local
```

EAS returns an install link and APK artifact. Install that APK on the Android phone.

## Pairing

Use one of these Workbench URLs on the phone:

- Same Wi-Fi: `http://<Mac-LAN-IP>:38888`
- Outside LAN: `https://<cloudflare-tunnel-domain>`

Then create a desktop pairing code from the logged-in Workbench session and enter the 6-digit code in the app. The phone stores only the mobile device token; the server stores token hashes and can revoke the device.

Desktop pairing entry:

- Open `http://127.0.0.1:38888/mobile` in the logged-in Workbench.
- Click `生成配对码`.
- Scan the QR with Android to open `openclaw://pair`, or manually enter the Workbench URL and 6-digit code.
- Revoke stale devices from the same desktop page or from the app device page.

## Sync model

Mac Workbench is the only source of truth.

- Mac to Android: app start, foreground return, pull-to-refresh, and successful actions refetch mobile bootstrap/today data.
- Android to Mac: chat, approvals, and device revoke write through Workbench APIs.
- Offline: last today cache remains readable, but send and approval actions are disabled until the server is reachable again.

## Updates

JS/UI-only Android changes can use EAS Update:

```bash
npm run mobile:update:preview
```

Native changes, package changes, permissions, notification native config, or new native modules require a new APK:

```bash
npm run mobile:android:preview
```

The server exposes version compatibility in `/api/mobile/bootstrap.mobile`.

## Checks

```bash
npm run test:mobile-release
npm run test:mobile-api
npm run test:mobile-app
```
