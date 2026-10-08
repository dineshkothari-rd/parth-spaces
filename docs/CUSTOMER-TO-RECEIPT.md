# Parth Spaces customer-to-receipt pilot — 8 October 2026

## Delivery status

Implementation and isolated acceptance are complete for the PG customer → photos → room/meter check-in → frozen monthly invoice → partial/full payment → receipt path. This is a staged release: new source and rules have not replaced the existing public app/backend. It is not certification of real Android installation, actual printing, owner credentials or a complete customer business launch.

## Corrections

- Monthly payments now read the saved invoice and current payment account inside a Firestore transaction. The account is keyed by customer/month; competing devices retry against the latest amount and cannot both record an overpayment.
- Freeze the month's invoice before collecting through the regular monthly flow. Saved invoice prices remain authoritative; an old screen cannot override the current balance.
- A submission retains its attempt ID across unchanged retries. Replaying that ID returns the same original payment, not another record. Different details or a voided attempt are rejected. Reopening the form starts a new attempt; bank/reference verification remains an operator responsibility.
- Voiding a guarded payment updates its counter atomically and preserves the original record/audit entry. Closed checkout records reject ordinary payment/void actions.
- Checkout reads existing payment documents and relevant monthly accounts before writing. A changed payment/balance requires reopening checkout; monetary comparisons round to paise.
- Failed payment saves appear as an accessible alert inside the open form. Duplicate clicks while saving are ignored. Shared text inputs expose their translated labels to screen readers.
- Existing numeric legacy payments using `tenantId` or `userId` are read from the server and counted when initializing a monthly account. Records are preserved. Unusual legacy records still require review before a real-business pilot.

## Data and permissions

New `paymentAccounts/{customerId}_{YYYY-MM}` documents contain `tenantId`, `month`, `paid`, `paymentId`, `updatedAt` and `updatedBy`. Rules allow staff reads and money-authorized changes only. A counter update must be paired with the corresponding recorded/voided payment and valid delta. A regular payment must be paired with its account and saved invoice; direct unlinked writes fail. Customers continue to read only their own invoices/payments and cannot read internal payment accounts.

Opening legacy totals are a controlled trust boundary: authorized money staff seed them from server records. The rules cannot aggregate old collections themselves. Move initialization to a reviewed server migration before admitting untrusted operators. No multi-business tenancy was introduced; external customer businesses still need isolated backends.

## Actual verification

- TypeScript passes; 30 business unit tests and four browser export/dialog tests pass.
- All 16 Firestore rule regressions pass against a demo emulator, including customer/staff isolation and guarded payment writes.
- `scripts/check-payment-lifecycle.ts` passes: two competing ₹700 submissions against a ₹1,000 invoice yield exactly one success; final payment, overpayment rejection, stable-ID replay, changed replay rejection, void/retry, legacy opening totals, missing-invoice rejection, closed checkout, stale checkout snapshot and counter/access tampering checks.
- A separate demo project restores a serialized data snapshot, preserving IDs, timestamps, monthly counters and payment count. This is data-only synthetic recovery; it does not back up Firebase Auth credentials or prove production restore.
- `scripts/check-customer-to-receipt.mjs` passes against demo Auth/Firestore with real Chrome UI interaction: admin login, new PG resident, customer/document gallery photos, room assignment, meter photo/manual reading, check-in, inline failed-save alert, frozen invoices, ₹400 payment/₹600 receipt balance, reload, rejected ₹601 overpayment, final ₹600 payment and verified ₹1,000 total. Customer sees their two receipts; money-restricted staff has no Finances navigation. Desktop/mobile show no overflow or page errors.
- Both web and Android JavaScript/Hermes exports pass. Android export is not a signed APK or device installation. Browser print is stubbed and receipt document content/opener isolation is checked; actual Save as PDF/print remains to be accepted.

## Reproduce safely

Use a demo Firebase project and isolated export, never customer production records. `firebase.json` declares Firestore 8080 and Auth 9099. Existing production/dev servers are not restarted by these scripts.

```
npx tsc --noEmit
npm test
npm run test:web
npm run test:rules
npm run test:payments
```

For the browser check, export with `EXPO_NO_DOTENV=1`, all six `EXPO_PUBLIC_FIREBASE_*` values set to demo fixtures, project ID `demo-parth-spaces` and `EXPO_PUBLIC_FIREBASE_USE_EMULATORS=true`. Set `PARTH_WEB_TEST_DIR` to that export directory, `PARTH_PLAYWRIGHT_MODULE` to an existing installed Playwright module, and `PARTH_BROWSER_EXECUTABLE` to the installed Chrome executable. Then run `npm run test:lifecycle`. No test dependency was added; this workspace reuses Parth English's installed Playwright module. The browser test owns only its temporary demo server at 5186.

## Coordinated release and remaining gates

1. Inventory the existing app versions and review unusual/legacy financial records. Confirm the real customer-business identity and billing settings.
2. Establish protected Firestore plus Auth backup/recovery and verify restoration before touching customer data. The synthetic recovery above does not satisfy this production gate.
3. Prepare an installable Android build and accept real sign-in, photo permissions, meter entry, receipt sharing and the same customer-to-payment flow on a device.
4. Release compatible web/Android code and tested rules together during a controlled pilot. New guarded-payment rules intentionally reject legacy clients' unlinked monthly writes; do not deploy them alone or silently leave an old Android app in use. The current production deployment was preserved.
5. Accept owner/customer pilot records, actual printing, settlement/refund scenarios and recovery before any wider customer offer. Owner Google Workspace consent/persistence is a separate parent acceptance gate.

No paid dependency, cloud resource or subscription was added. Git synchronization of this staged source does not publish the new Firebase rules or web application.

References: https://firebase.google.com/docs/firestore/manage-data/transactions and https://docs.expo.dev/versions/v57.0.0/
