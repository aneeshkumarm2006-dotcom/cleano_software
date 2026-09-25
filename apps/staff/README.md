# Bookmops Pro (`@bookmops/staff`)

The iOS and Android app for everyone who works for a company: cleaners and
field leads get the cleaner app, ops managers, admins and owners the manager
app. The signed-in role decides; the rules are `capabilitiesFor` in
`packages/api/src/v1/manager-access.ts`.
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
"Explore with sample data" on the sign-in screen, as a Cleaner, a Field
lead, a Manager (OPS_MANAGER) or an Admin, and answers as the server would
for that role. Set `EXPO_PUBLIC_PREVIEW=1` to start straight in it (and
`EXPO_PUBLIC_PREVIEW_ROLE=FIELD_LEAD`, `OPS_MANAGER` or `ADMIN` to pick who),
which lets any screen be opened by deep link on a simulator:

```bash
EXPO_PUBLIC_PREVIEW=1 npx expo start --ios
xcrun simctl openurl booted "exp://127.0.0.1:8081/--/jobs/j1"
EXPO_PUBLIC_PREVIEW=1 EXPO_PUBLIC_PREVIEW_ROLE=ADMIN npx expo start --ios
xcrun simctl openurl booted "exp://127.0.0.1:8081/--/manage/jobs/m-104/crew"
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
