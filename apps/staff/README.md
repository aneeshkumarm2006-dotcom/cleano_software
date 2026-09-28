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

**Sample data.** A development build offers "Explore with sample data" on
the sign-in screen, as a Cleaner, a Field lead, a Manager (OPS_MANAGER) or an
Admin, and answers as the server would for that role. Set
`EXPO_PUBLIC_PREVIEW=1` to start straight in it (and
`EXPO_PUBLIC_PREVIEW_ROLE=FIELD_LEAD`, `OPS_MANAGER` or `ADMIN` to pick who),
which lets any screen be opened by deep link on a simulator:

```bash
EXPO_PUBLIC_PREVIEW=1 npx expo start --ios
xcrun simctl openurl booted "exp://127.0.0.1:8081/--/jobs/j1"
EXPO_PUBLIC_PREVIEW=1 EXPO_PUBLIC_PREVIEW_ROLE=ADMIN npx expo start --ios
xcrun simctl openurl booted "exp://127.0.0.1:8081/--/manage/jobs/m-104/crew"
```

Release builds contain neither the sample data nor the button: the only
import is behind `__DEV__`, which Metro strips. Signed in for real, every
screen reads and writes through `createClient` (`src/data/session.tsx`), the
same client a release build uses; sample data is never mixed in.

## Running against a real server (local web app on staging)

A development build can talk to a web app running on your Mac, connected to
the **staging** database (`udgbixmlyqsoalvrjbgo`). Never point it at
production, never use `apps/web/.env.production.local`, and never create an
`apps/web/.env`.

**Hostnames.** The server finds the company from the first label of the host
(`acme.…`), and sign-in hands the app that company's own address. The web's
usual `acme.localhost:3000` only resolves inside desktop browsers: a
simulator or phone can't reach it. Use a wildcard DNS name that resolves to
your Mac instead, e.g. [nip.io](https://nip.io): `acme.192-168-1-20.nip.io`
resolves to `192.168.1.20` (use `127-0-0-1` for the iOS simulator, your
Mac's LAN IP, dashed, for a phone on the same wifi). The root is given with a
`www.` in front, because the server drops the first label to find it.

**1. The web app**, from `apps/web` (values from `.env.local`, only for this
shell; nothing is written):

```bash
set -a; source <(grep -E '^STAGING_(APP_)?(DATABASE|DIRECT)_URL=' .env.local); set +a
echo "$STAGING_APP_DATABASE_URL" | grep -q udgbixmlyqsoalvrjbgo || echo "NOT STAGING - stop"
LAN=192-168-1-20   # or 127-0-0-1 for the simulator
DATABASE_URL="$STAGING_APP_DATABASE_URL" DIRECT_URL="$STAGING_APP_DIRECT_URL" \
PLATFORM_DATABASE_URL="$STAGING_DATABASE_URL" \
APP_ROOT_DOMAIN="http://www.$LAN.nip.io:3000" NEXT_PUBLIC_APP_URL="http://www.$LAN.nip.io:3000" \
npx next dev --turbopack -H 0.0.0.0 -p 3000
```

Shell variables win over every `.env*` file, so this overrides the local
database in `.env.development.local`. Check
`curl http://www.$LAN.nip.io:3000/api/v1/meta` answers before going on.

**2. The app**, from this folder:

```bash
EXPO_PUBLIC_PLATFORM_URL="http://www.$LAN.nip.io:3000" \
EXPO_PUBLIC_DEV_ORIGIN="http://<slug>.$LAN.nip.io:3000" \
npx expo start --ios --clear
```

`<slug>` is the staging company you'll sign in to. Sign in with a staging
staff account of that company (not the sample-data button). The app only
sends a password to `EXPO_PUBLIC_PLATFORM_URL` and to the one company address
in `EXPO_PUBLIC_DEV_ORIGIN`; a sign-in that returns any other address is
refused ("That company's address isn't one this app can use"), which is how
you'll notice a typo.

**Plain HTTP.** Expo Go loads plain `http://` from any host. A development
*client* build (EAS `development` profile) has iOS App Transport Security on,
which allows plain HTTP only to local-network names and IPs, not to nip.io;
for that, and for a phone that isn't on your wifi, use an HTTPS tunnel that
serves a wildcard hostname (e.g. a Cloudflare named tunnel on
`*.dev.example.com` to `localhost:3000`) and use `https://www.<that root>` and
`https://<slug>.<that root>` above.

**Release builds are locked.** `EXPO_PUBLIC_PLATFORM_URL` and
`EXPO_PUBLIC_DEV_ORIGIN` are read only under `__DEV__` (`src/config.ts`).
A release build always signs in at `https://useawer.com` and only talks to
`https://<company>.useawer.com`, whatever the build's env says.

## Push notifications

The server sends them (`apps/web/src/server/push`) through the Expo Push API
to the tokens this app registers with `POST /api/v1/devices`; a tap opens the
`data.path` in the payload (`useNotificationRouting`). Before a release build
can receive any, the owner must:

1. **Create the EAS project** (`eas init` while logged in to Expo) so
   `app.json` gets `extra.eas.projectId`. Without it `enablePush` returns
   "unavailable" and no token is ever registered.
2. **Give EAS the push credentials**: an APNs key for iOS (`eas credentials`,
   or let `eas build` create one) and an FCM v1 service account key for
   Android.
3. **Optionally turn on Expo's enhanced push security** for the project and
   set the access token as `EXPO_ACCESS_TOKEN` on the web app in Vercel; the
   server sends it as a bearer token when it is set.

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
