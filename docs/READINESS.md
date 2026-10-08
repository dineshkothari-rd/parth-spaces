# Parth Spaces readiness — 8 October 2026

## Current deployment boundary

The current Firebase collections, roles and settings/business document belong to one business. They do not implement business membership or tenant-scoped multi-business authorization. Use a separate Firebase project/deployment per external business until a tested tenant migration exists. Do not connect multiple customer businesses to the current production Firebase project.

Software branding is Parth Spaces. Customer business identity is independent; existing customer records retain their own name. Placeholder business names cannot be issued on bills or receipts. Native bundle IDs and storage keys remain unchanged to preserve installed-app data.

## Access correction and evidence

A new regression test demonstrated that an unverified customer with an already-active profile could activate an invited tenant record. The shared customerActivatingTenant rule now requires verified email. The regression failed before the fix and passed afterwards. All 15 Firestore emulator tests pass, including claimed-role/self-approval rejection; all 30 configured unit tests and the TypeScript check pass.

These checks used a demo Firestore emulator, not customer records. Source synchronization alone does not deploy rules. Following the reported settings failure, the tested rules were deployed to kothari-pg and live/source equality was verified; see SETTINGS-NAVIGATION-REPAIR.md. Android installation, native CSV/PDF sharing, full recovery including actual login credentials, and customer acceptance remain release gates.

## Staged customer-to-receipt pilot

See [CUSTOMER-TO-RECEIPT.md](CUSTOMER-TO-RECEIPT.md) for payment transactions, retry protection, staged rules, browser acceptance and coordinated-release gates. New source has passed isolated checks; production remains on the previous version until compatible Android/web/rules and real-business recovery are accepted.
