# Zero-cost production setup

This project intentionally stays on Firebase's no-cost Spark plan. Do not enable billing for the items below.

## Required free console settings

1. Firebase Authentication → Settings → Password policy:
   - minimum 12 characters
   - require uppercase, lowercase, number, and symbol
2. Firebase Authentication → Settings → User actions:
   - enable email enumeration protection
3. Firebase Authentication → Settings → Authorized domains:
   - keep only domains actually used by the app
   - remove `localhost` from the production project
4. Create a separate free Firebase project for development. Never point local builds at production.
5. Deploy and verify the checked-in Firestore rules before releasing:

   ```sh
   firebase deploy --only firestore:rules
   ```

## Business configuration

Admins can now use **More → Settings → Business settings** to change the business
name, address, phone, room numbering/count, PG capacity, library seat prefix/count,
default customer fees and electricity rate. Changes sync across devices without
rebuilding. Default customer fees do not change existing customer records or
issued invoices; saved meter readings retain their recorded rates.

These `.env` values remain installation defaults until business settings are saved:

```sh
EXPO_PUBLIC_ROOM_START=101
EXPO_PUBLIC_ROOM_COUNT=14
EXPO_PUBLIC_PG_ROOM_CAPACITY=2
```

Changing the `.env` fallback values still requires rebuilding the native app.
Inventory reductions are rejected when they would invalidate active allocations
or reservations. Existing legacy seat codes remain editable; changing the seat
inventory requires moving or closing allocations outside the new range first.

Admins can use **More → Team** to restrict customer/allocation changes, money
management and operational updates separately. Existing staff keep their current
permissions until an admin changes them. Approved staff can still read daily
records. Checkout requires both customer and money permissions.

Deploy the updated rules before distributing this app version: it reads
`settings/business`, and the previous rules do not grant access to that document.
Older APKs cannot use the meter screen to bypass the checkout settlement anymore;
upgrade those devices before they need to check out customers.

## Phases 1–2 review checkpoint

- Scope: core workflow fixes and business configuration; completed before phases 3–4 below.
- Core fixes: PG peak occupancy, invalid stay dates, checkout requiring an atomic
  settlement, stale-customer transaction protection and empty allocation guards
  that prevent released reservations from being restored by stale clients.
- Configuration: shared admin settings, dynamic inventory and fees, branded bills
  and receipts, staff permission switches and matching Firestore write restrictions.
- Validation: business regression tests, Firestore emulator security tests,
  TypeScript and Android bundle export. No production data or rules were changed.
- Review on a development device: change settings and verify a second device updates;
  try invalid inventory reductions; create PG/hotel/library customers; complete
  check-in and checkout; verify totals/receipts; disable each staff permission and
  verify its controls disappear and writes fail; review Hindi labels.
- Remaining release checks: authenticated device acceptance and coordinated rules
  deployment/app rollout. No Android device was connected during implementation.
- Next batch: phases 3–4 were subsequently authorized and implemented below.

## Phases 3–4 review checkpoint

Implementation is ready for review; deployment and authenticated device acceptance
remain pending. No paid service, new dependency, production data change or rules
deployment was introduced.

**Phase 3 — Money management**

- Cash, UPI and bank methods, transaction references and collector identity on new
  payment records and receipts. Checkout collections and refunds use the same
  method/reference fields. Expenses now use consistent payment methods.
- Admin UPI ID and optional uploaded bank QR image in Business settings. Staff and
  customers can view the details and open an installed UPI app. Confirm payments
  manually in the bank account; QR/app opening never marks a bill paid.
- More → Money management: transaction-protected deposit collection, deduction and
  refund history. Recorded deposits cannot become negative. Checkout atomically
  closes the deposit ledger and transfers any refund liability to Settlements;
  it does not count deposit application as a new cash receipt.
- Legacy deposits without a ledger can still be entered at checkout after manual
  verification. Record new deposits in the ledger before checkout. Historic
  payments without a method are unclassified, rather than assumed to be cash.
- Individual final monthly bills can include an additional charge, discount/credit,
  reason and due date. Issued bills are immutable. Apply adjustments before issuing
  the bill; a credit reduces charges and does not create a cash refund.
- Daily reconciliation saves opening balances, actual closing cash/bank balances,
  expected net movements and differences. These are immutable manual snapshots,
  not bank imports. Days with unclassified legacy movements cannot be finalized.

**Phase 4 — Memberships and agreements**

- More → Memberships & agreements: admin library plans with a monthly fee and
  duration of 1–12 whole calendar months. Retiring a plan preserves history.
- Library renewals require customer and money permissions, check seat conflicts,
  prevent overlapping periods and atomically issue fixed-price monthly invoices.
  Dates/prices and allocation are saved in renewal history. Existing final invoices
  cannot be overwritten; begin with an unbilled month. Fees before membership
  management continue using the existing customer ledger.
- Expiry/upcoming status and saved seat dates are visible. Expired dated reservations
  free inventory; extending the period rechecks allocation. Memberships do not
  automatically check customers out or perform financial settlement.
- PG, hotel and library agreement versions preserve the business/customer details,
  fee, dates and supplied terms. PDF export uses the existing print/share tools.
  Acceptance requires the customer's name and a readable signed JPEG photo; the
  record becomes immutable. This batch supports photo attachments, not PDF imports
  or certified electronic signatures. Create a new agreement version for changes.

**Validation and review**

- Passed: 28 regression tests, 13 Firestore emulator security tests, TypeScript,
  Android bundle export and final whitespace/diff checks.
- Device review: collect Cash/UPI/Bank payments and open receipts; scan the uploaded
  QR from another device; collect/deduct/refund a deposit, then check out and pay the
  remaining refund; verify daily cash/bank differences; issue an adjusted bill;
  start/renew a library plan, try a conflicting seat and an overlapping renewal;
  export an agreement, attach a signed photo and check its PDF readability.
- Verify the new screens on a development project with these rules before rollout.
  Rules deployment must precede coordinated app upgrades. Device acceptance remains
  unverified; bundle export does not replace installing and testing the native app.
- Next action: stop for review. Phases 5–6 have not started.

## Deliberately not enabled

- Cloud Storage: Firebase requires the Blaze billing plan. Photos remain compressed and size-limited in Firestore.
- Cloud Functions: production deployment requires billing, so account provisioning remains client-side and Firestore profiles remain the authorization boundary.
- SMS MFA: SMS verification requires the paid plan.
- Firestore PITR/scheduled backups: billed features.
- App Check/Crashlytics: the current Firebase JavaScript SDK cannot provide native attestation or Crashlytics. Adding them safely requires a React Native Firebase migration and native Firebase configuration files.

Never enable App Check enforcement before a compatible client build is installed on every active device; doing so would lock legitimate users out.
