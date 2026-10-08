# Settings and navigation incident — 8 October 2026

## User-visible failures

Spaces reached the signed-in screen but displayed “Could not load business settings”. The parent website rendered normally but clicking product/navigation links stayed on the same page.

## Confirmed causes and changes

1. A read-only check showed the deployed kothari-pg Firestore rules differed from source and had no settings/business match. The existing business-settings authorization test failed against that deployed rules snapshot in a demo emulator. All 15 tests passed against current source. The tested rules were compiled and deployed to kothari-pg, and a second read-only check confirmed the live rules exactly match source. This release changed rules only; it did not migrate/delete customer records or create production test accounts.
2. A Chrome check of the owner-private parent reproduced the click failure and “e is not a function” from the client navigation handler. Internal route links now use normal browser anchors, preserving server-rendered navigation, keyboard access and back/forward behavior. The lint exception is restricted to these navigation files. The leftover “Dicharo collection” heading is now “Parth collection”.
3. Spaces web no longer mounts the decorative native splash overlay, so it cannot retain a layer above browser controls. Native splash behavior stays in place. A demo-only Firebase emulator option was added for authenticated regression checks; it rejects non-demo project IDs before initializing Firebase. Production web exports clear Metro’s transform cache to avoid reusing a previous build’s inlined Firebase configuration.

## Verification

- Spaces: TypeScript, 30 business unit tests, four web utility/isolation tests, production web export and Android/Hermes export pass.
- Real browser login against local Auth/Firestore emulators: approved admin settings load, reload persistence, customer-module click, denied settings stream, successful Retry after restoring permission, Logout while settings are denied, staff login and customer own-account view. Zero page errors. All accounts/data were synthetic in demo-parth-spaces.
- Normal production-config local web smoke check: desktop/mobile login controls, mocked rejected login, dialogs, CSV download and isolated print content pass.
- Parent: lint and actual Home → Products → Studio → Workspace → Home clicks pass locally, along with catalog filtering, seven detail routes, account-bound local workspace persistence and negative API checks. The one expected 404 request in the broader check is not a navigation failure. Published navigation is checked again after deployment.

Real Android installation, complete billing/customer lifecycle and actual printing remain acceptance gates. These fixes do not establish multi-business tenancy or worldwide billing support.

## URL

The parent’s Parth Software Labs display name and its generated dicharo-works.spicyclock4.chatgpt.site address are separate hosting properties. The metadata operation changes only the title. No custom domain is currently attached; no domain was purchased and no replacement Site was created. A branded address needs a domain the founder owns and verified DNS configuration. Existing workspace records and private access are preserved.

## Reproducing authenticated regression checks

The checked-in scripts/check-web-session.mjs runs against Auth (9099) and Firestore (8080) emulators for demo-parth-spaces. It requires the installed Playwright test module, a supported browser and Python 3 for its temporary loopback static server; none is a production app dependency. Set PARTH_PLAYWRIGHT_MODULE to that module’s absolute path, PARTH_BROWSER_EXECUTABLE if using system Chrome, and PARTH_WEB_TEST_DIR to a separately exported demo web build.

Build that test artifact with EXPO_PUBLIC_FIREBASE_USE_EMULATORS=true, a demo-* project ID and synthetic values for all six EXPO_PUBLIC_FIREBASE_* fields, using expo export --platform web --clear into the dedicated test directory. Then run it through firebase emulators:exec --only firestore,auth --project demo-parth-spaces with a config containing both emulator ports and the checked-in rules. Keep the normal dist/ preview built without the emulator flag. Never run these fixtures against customer records.
