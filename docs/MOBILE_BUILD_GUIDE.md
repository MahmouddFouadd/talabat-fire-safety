# MOBILE_BUILD_GUIDE

## Android (Capacitor 6)
App id `com.talabatmart.firesafety`, name **Fire Safety Management**, min SDK 22, target 34. The web build is bundled inside the APK, so the app opens without internet (drafts work offline; sending needs a connection).

### Test APK (no setup)
GitHub → Actions → **Android APK** → Run workflow → download artifact → `FireSafety-<version>-debug.apk`. Install it on the phone (allow "install unknown apps" once).

### Signed release APK + AAB (Google Play)
1. Create a keystore once, on any computer with Java:
   ```bash
   keytool -genkeypair -v -keystore release.keystore -alias firesafety -keyalg RSA -keysize 2048 -validity 10000
   base64 -w0 release.keystore > keystore.b64
   ```
2. Add GitHub Secrets: `ANDROID_KEYSTORE_BASE64` (content of keystore.b64), `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS` (= firesafety), `ANDROID_KEY_PASSWORD`.
3. Push a tag: `git tag v1.0.0 && git push --tags`. The workflow builds debug + signed release APK + AAB, writes SHA256SUMS and attaches them to the GitHub Release.

Keep `release.keystore` and its passwords safe and **outside** the repository (`*.keystore` is git-ignored). Losing it means you cannot update the Play Store app.

### Local build (optional, needs Android Studio)
```bash
npm ci && npm run build && npx cap sync android && npx cap open android
```

## iPhone
- Supported now as an installable PWA (Safari → Share → Add to Home Screen): full screen, safe-area aware, works with the same login.
- A native iOS build needs a Mac with Xcode and an Apple Developer account: `npm i @capacitor/ios@6.1.2 && npx cap add ios && npx cap open ios`. Not built or tested in this delivery.
