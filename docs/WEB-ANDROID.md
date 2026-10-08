# Parth Spaces: web and Android foundation — 8 October 2026

## Decision

Keep one Expo/React Native product repository with shared screens, business calculations, Firebase records, roles and customer-business settings. React Native Web and React DOM were already installed; no new dependency or paid subscription was added. The web version is the authenticated business application, separate from the Parth Software Labs marketing/management parent platform.

Both clients address the same configured business backend. This is cross-device access for one business, not multi-business tenancy. External businesses still require an isolated Firebase deployment until a tested membership/tenant migration exists. Existing Android bundle IDs, secure auth storage and customer records are unchanged.

## Implemented platform differences

| Function | Browser | Android |
|---|---|---|
| Sign-in persistence | Firebase browser local persistence | Existing SecureStore-backed persistence |
| Confirmations and photo choices | Accessible native browser dialog with all action buttons, Cancel/Escape and literal text | Existing native Alert |
| CSV reports | Browser download, preserving Unicode and existing CSV sanitization | Existing native file/share flow |
| Bills, receipts, agreements, report PDFs | Separate document print window; choose Save as PDF in the browser | Existing PDF generation and file/share flow |
| Meter photo | Attach/resize photo and confirm the reading manually; no native OCR import | Existing local text recognition and user confirmation |
| Customer business name | Existing independent business identity and placeholder guard | Same guard and business settings |

Web printing reports blocked popups instead of silently failing. Its load handler is installed after document.write, which can clear earlier handlers. The popup has no opener access and prints the generated document, not the private application screen. Web dialogs use textContent for title/message rather than injecting HTML.

The opening splash now uses Parth Spaces rather than the retired working brand. Both owner and customer receipt callers, agreements and reports use the shared platform-specific export utility.

## Local use and build

- npm run web starts the Expo web development server.
- npm run build:web exports a static site into ignored dist/.
- npm run android builds/runs the Android app using the existing native setup.
- npx tsc --noEmit checks shared and platform source files.
- npm test runs the existing business-unit suite.
- npm run test:web runs web dialog/export regression tests without new test dependencies.

Use the existing EXPO_PUBLIC_FIREBASE_* configuration for the specific business. Client configuration is public by design; server credentials must never be included. Do not test automated destructive workflows against customer records. A deployment needs HTTPS, the correct Firebase authorized domain and accepted role/recovery flows. No new public hosting or domain was activated during this foundation change.

## Evidence and remaining gates

TypeScript passes. All 30 existing unit tests and three new web dialog/export regression tests pass. Both production web export and Android JavaScript/Hermes export succeed. The latter is not a fresh APK or real-device acceptance.

Chrome checks covered the built desktop and 390px web login, password visibility, a mocked rejected login, horizontal overflow, multi-action dialog selection/cancellation/Escape, literal HTML-like text, CSV download, and separate receipt print content/title/opener isolation. No page errors were observed. The print call was stubbed; a real print/save operation still needs user acceptance.

Current web JS is approximately 2.06 MB raw / 494 KB gzip, measured on the generated bundle. Hosting compression and actual low-end device/network performance remain deployment checks. No 3D, graphics engine or additional UI library was added.

Positive sign-in, reload persistence, owner/staff/customer business journeys, live photo-picker/camera permissions, actual printing, and fresh Android installation still need isolated test-account/device acceptance. Browser screenshot protection cannot substitute for native restrictions. Both clients remain in development; no production Firestore rules or customer data were changed. Next: accept the same owner/customer workflow on web and Android, then a bounded isolated-business pilot.

## Primary implementation references

- Expo SDK 57: https://docs.expo.dev/versions/v57.0.0/
- Expo web workflow: https://docs.expo.dev/workflow/web/
- Expo Print platform behavior: https://docs.expo.dev/versions/v57.0.0/sdk/print/
- Firebase browser auth persistence: https://firebase.google.com/docs/auth/web/auth-state-persistence

## Later settings/navigation repair

The earlier foundation snapshot above preceded live rule deployment. See [SETTINGS-NAVIGATION-REPAIR.md](SETTINGS-NAVIGATION-REPAIR.md) for the confirmed settings denial, live rules synchronization, four current web tests and successful authenticated browser recovery checks. Full business lifecycle/device acceptance remains pending.

## Shared Parth design system

The 8 October design update aligns Spaces with the parent blue/neutral palette. Web sign-in becomes two columns at 900px; desktop admin/staff navigation becomes a sidebar at 1000px with up to 1200px content. Smaller browsers and native devices retain bottom navigation. The canonical palette and cross-repository maintenance are documented in Parth Software Labs `docs/DESIGN-SYSTEM.md`. Existing permissions, Firebase configuration and stored theme preferences stay compatible.
