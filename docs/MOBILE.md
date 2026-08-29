# Building the Mobile App

First includes Capacitor Android and iOS projects. This short guide covers a local Android debug
build; after `npm run build:mobile`, use Xcode on macOS for an iOS development build.

The mobile build is standalone: no passkey login, no server sync, no telemetry. Data is
stored on the device. First does not publish a signed APK; build artifacts are local. The exercise
catalogue contains 1,324 pt-BR names and matching pt-BR instruction sets.

## Android Debug Build

Before building, provide the separately licensed media in these untracked local directories:

```text
media/img/   # 1,324 .jpg files
media/gif/   # 1,324 .gif files
```

The filenames must match the exercise ids. `npm run build:mobile` validates the collection and
copies it to `frontend/dist/media/` before Capacitor synchronizes the web bundle. The resulting APK
therefore includes all 1,324 JPG previews and 1,324 animated GIF demonstrations for offline use.

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
under its MIT license. The pt-BR instructions come from the `tutods` contribution at commit
[`93475e2982117339d2cbf88eb900ad2ceb8d97d6`](https://github.com/tutods/exercises-dataset/commit/93475e2982117339d2cbf88eb900ad2ceb8d97d6).

Images and GIFs require separate rights from their copyright holder. They remain in the local
ignored `media/` directory and are never added to the public Git repository. The app displays the
visible attribution **© Gym visual**. Supplying, building, or distributing an APK containing those
files is the builder's responsibility; neither the dataset's MIT license nor First's AGPL licenses
the media.

## License

The program code remains under the GNU AGPL v3.0. Preserve the original openGym attribution and
make corresponding source available when distributing a build. [NOTICE.md](../NOTICE.md) records
the inherited app-store exception; it does not grant rights to exercise media.
