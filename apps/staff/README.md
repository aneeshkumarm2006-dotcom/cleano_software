# Bookmops Pro (`@bookmops/staff`)

The iOS and Android app for cleaners, and later managers and admins.
Expo SDK 57 (React Native 0.86), expo-router, bundle id `com.bookmops.pro`.

Built on `@bookmops/ui-native` (design system), `@bookmops/api` (the v1
contract and client), and `@bookmops/core` (business rules). Screen designs
are in `docs/design/mobile/Pro*.html`; the API design in
`docs/architecture/API_V1.md`.

## Running it

From this folder:

```bash
npx expo start --ios          # iOS simulator, in Expo Go
npx expo start --android      # needs the Android SDK and an emulator
npx tsc --noEmit              # typecheck
npx expo export --platform ios --platform android   # production bundles
```

**Sample data.** Until the v1 API ships, a development build offers
"Explore with sample data" on the sign-in screen. Set
`EXPO_PUBLIC_PREVIEW=1` to start straight in it, which lets any screen be
opened by deep link on a simulator:

```bash
EXPO_PUBLIC_PREVIEW=1 npx expo start --ios
xcrun simctl openurl booted "exp://127.0.0.1:8081/--/jobs/j1"
```

Release builds contain neither the sample data nor the button: the only
import is behind `__DEV__`, which Metro strips.

## Things that will bite

- **Install Watchman** (`brew install watchman`). Without it Metro can miss
  file changes and keep serving an old bundle; `npx expo start --clear`
  recovers.
- **Typed routes are off.** In this npm workspace, `expo-router` is installed
  per app while `@expo/router-server` is hoisted to the root, and the typed
  routes generator in the latter cannot find the former. Links still type-check
  through expo-router's own API. Revisit if the hoisting changes.
- **`ios/` and `android/` are generated** (Continuous Native Generation) and
  ignored. Change native behaviour in `app.json` and config plugins only.
