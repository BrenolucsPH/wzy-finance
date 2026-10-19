# Testing and evidence

## Public snapshot validation — 2026-10-19

The sanitized public snapshot was installed from its lockfile, passed lint/TypeScript and database-free checks, compiled without provider credentials, and passed all **72 full local check groups** against real isolated PostgreSQL and headless Chromium. The production dependency audit reported **zero known vulnerabilities** on that date. Publication pattern checks inspected every tracked file; all 11 protected API route implementations were retained unchanged from the reviewed application. Demo screenshots were captured without a signed-in account or backend credentials.

These are dated results, not a promise that future versions or new vulnerability databases will have the same outcome. CI records checks for subsequent commits.

## Database-free checks

```sh
npm run check:secrets
npm run check
npm run build:app
npm audit --omit=dev --audit-level=high
```

`check` runs lint, strict TypeScript and pure financial/interface verification. `build:app` compiles the application without applying migrations or connecting to a provider. Publication checks inspect tracked files for credential patterns and private operational artifacts; they complement review and do not prove that every possible secret format is detectable.

## Full local integration suite — Windows

```sh
npm install --prefix ../qa-tools --save-exact @embedded-postgres/windows-x64@18.4.0-beta.17
npx playwright install chromium
node scripts/local-qa.mjs --dev
```

The helper starts its own PostgreSQL instance and Next.js server on loopback, creates a random `wzy_qa_` schema, generates fake accounts/keys and uses a local private-file adapter. It disables real email/SMS/push. It stops its own processes afterward; diagnostics remain under ignored `.qa-data/` and `test-results/` directories.

To test an optimized build, run `npm run build:app`, followed by `node scripts/local-qa.mjs`. The helper requires free local ports 5173 and 64329. Do not run it against an existing application process or supply real user data.

## Deployment checks

`npm run build` is intentionally different: it applies reviewed migrations, compiles the app and runs the full provider integration suite using synthetic users and a temporary schema. It requires the full private configuration and schema/role permissions. Do not use a production database merely to try a fork.

## Coverage

| Area | Examples |
| --- | --- |
| Authentication | HttpOnly sessions, same-origin writes, authenticator challenge and single-use recovery codes |
| Authorization | Owner isolation, restricted administrator actions, group invitation identity and revocation |
| Financial invariants | 2,000 exact-split cases, invoice cycles, fractional quantities, transfers and stale-write rejection |
| Large histories | 5,000 synthetic transactions, complete aggregates and pagination without duplicates |
| Recovery | Private file bytes, encrypted snapshots, remapped references and idempotent restore confirmation |
| Browser | First-transaction onboarding, unique sidebar sections, custom order/pins, keyboard dialogs, themes, 390/412 px layouts and offline reconnection |

The full suite currently reports 72 check groups. Assertions are grouped by behavior; this is not a coverage percentage. Screenshots in `docs/assets/` use demonstration data and are presentation assets, not screenshots of a user's finances.

Physical iOS/Android testing, complete screen-reader audits, concurrent-user load tests, independent security review and legal assessment remain separate activities.
