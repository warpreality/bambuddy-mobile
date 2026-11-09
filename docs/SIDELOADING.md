# Sideloading on iPhone with a free Apple ID

This guide installs a self-built copy of the app on your own iPhone **without a paid
Apple Developer account**, using [AltStore](https://altstore.io) (SideStore works the
same way). AltStore signs the app with your free Apple ID. Apps signed this way are
valid for **7 days**, and AltStore refreshes them automatically.

## 1. One-time setup on the Mac

1. Install **Xcode** from the App Store, open it once and let it install its components.
2. Install the tools:
   ```bash
   brew install node cocoapods
   ```
3. Install **AltServer** on the Mac and **AltStore** on the iPhone (follow
   [altstore.io](https://altstore.io)).
4. On the iPhone, enable **Settings → Privacy & Security → Developer Mode**. The phone restarts.

## 2. Build the .ipa

```bash
git clone https://github.com/warpreality/bambuddy-mobile.git
cd bambuddy-mobile
npm install
npm run build:ios:sideload
```

The script installs CocoaPods dependencies and builds an **unsigned** Release app. It
writes `dist/Bambuddy.ipa`. Options:

| Variable | Default | Purpose |
| --- | --- | --- |
| `BUNDLE_ID` | `com.dxrf.bambuddy` | Your own bundle identifier, e.g. `com.yourname.bambuddy`. Keep it the same between builds so updates replace the installed app and keep its data. |
| `OUTPUT` | `dist/Bambuddy.ipa` | Where to write the .ipa |

```bash
BUNDLE_ID=com.yourname.bambuddy OUTPUT=~/Desktop/Bambuddy.ipa npm run build:ios:sideload
```

## 3. Install with AltStore

Use either method:

- **From the Mac:** menu bar → AltServer icon → hold **⌥ Option** → *Sideload .ipa…* →
  pick your iPhone and the .ipa.
- **From the iPhone:** AirDrop the .ipa or save it to Files, then in AltStore go to
  **My Apps → +** and choose it.

If iOS says *Untrusted Developer*, open **Settings → General → VPN & Device
Management**, select your Apple ID and tap **Trust**.

To update, build again and install the new .ipa the same way.

## Troubleshooting

| Problem | Fix |
| --- | --- |
| `tool 'xcodebuild' requires Xcode` | Xcode is installed but not selected. The script falls back to `/Applications/Xcode.app` automatically. You can also run `sudo xcode-select -s /Applications/Xcode.app`. |
| `IPHONEOS_DEPLOYMENT_TARGET is set to 9.0…` | Fixed in `ios/Podfile` (pods are raised to iOS 15.1). Run `cd ios && pod install` again. |
| App closes immediately on iOS 27 | Fixed: the app uses the UIScene lifecycle that iOS 27 requires (`SceneDelegate` in `AppDelegate.swift`). Rebuild from this repository. |
| `Permission bits for '~/.netrc' should be 0600` from CocoaPods | `chmod 600 ~/.netrc` |
| App expired after 7 days | Open AltStore with the Mac (AltServer running) on the same Wi‑Fi network, or connect the phone by cable. AltStore refreshes the app. |
| Crash after launch | Connect the iPhone and run `xcrun devicectl device info files --device <UDID> --domain-type systemCrashLogs` to find `Bambuddy-*.ips`. |
