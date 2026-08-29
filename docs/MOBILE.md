# Building the Mobile App

First includes Capacitor Android and iOS projects. This short guide covers a local Android debug
build; after `npm run build:mobile`, use Xcode on macOS for an iOS development build.

The mobile build is standalone: no passkey login, no server sync, no telemetry. Data is
stored on the device. First does not publish a signed APK; build artifacts are local.

## Android Debug Build

```bash
cd frontend
npm ci
npm run build:mobile
cd android
./gradlew assembleDebug
```

Debug APK:

```text
frontend/android/app/build/outputs/apk/debug/app-debug.apk
```

## Install on a USB Device

From the repository root:

```bash
adb install -r frontend/android/app/build/outputs/apk/debug/app-debug.apk
adb shell monkey -p com.kowalskikgb.first 1
```

## Media

Exercise metadata and instructional text derived from `hasaneyldrm/exercises-dataset` remain
under its MIT license. Images and GIFs require a separate license from their copyright holder
and are not included, fetched, or enabled by the standard mobile build.

## License

The program code remains under the GNU AGPL v3.0. Preserve the original openGym attribution and
make corresponding source available when distributing a build. [NOTICE.md](../NOTICE.md) records
the inherited app-store exception; it does not grant rights to exercise media.
