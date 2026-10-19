# Local setup

## 1. Requirements

- Node.js **24.x**, npm and Git.
- For persistent features: a separate Neon/PostgreSQL database and Vercel Blob store configured as **private**.
- For Windows integration QA: the isolated PostgreSQL helper described in [TESTING.md](TESTING.md).

Run `npm ci` from the repository root. The UI can be explored immediately with `npm run dev` and demonstration mode; no production account or database is bundled.

## 2. Private configuration

Copy `.env.example` to `.env.local` using your editor or file manager. Fill values directly in that private file. It is ignored by Git.

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Your application's PostgreSQL connection; a pooled Neon URL is suitable for runtime |
| `DATABASE_URL_UNPOOLED` | Direct connection used for migration/isolated schema work |
| `AUTH_ENCRYPTION_KEY` | A newly generated 32-byte base64 key for your installation |
| `BLOB_READ_WRITE_TOKEN` | Token for your own private Blob store |
| `CRON_SECRET` | An independent random secret authenticating scheduled work |
| `APP_ORIGIN` | Your application origin, initially `http://localhost:3000` |
| `WZY_ADMIN_USER_IDS` | Comma-separated account IDs permitted to administer the installation |

Generate **new** values locally, rather than copying an example key:

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
```

Run it separately for each secret. Keep the encryption key stable and backed up privately; losing it prevents decryption of existing encrypted snapshots and authenticator secrets. Never put server secrets in `NEXT_PUBLIC_*` variables, screenshots, issues or commits.

## 3. Initialize your isolated database

```sh
npm run db:migrate
npm run dev
```

The canonical schema is `db/vercel-schema.sql` plus `db/migrations/`. The migration connection needs permission to create the schema, policies and runtime role. The application executes financial work with the restricted runtime role. A read-only database credential is insufficient for initialization.

Use a new development database. Do not point this clone or its test helpers at the original deployment. Review SQL before applying it. Create additional migrations with `npm run db:generate -- descriptive_name`; never rewrite an applied migration.

The Drizzle model is a partial typed projection, not a replacement for the canonical SQL migrations.

## 4. First user and administrator

Create your own account through the application. No default user, administrator password or production ID is included. If administration is required, add that account's ID to the private `WZY_ADMIN_USER_IDS` configuration and restart the app. Enable authenticator 2FA before accessing administration. A profile email cannot grant administrator privileges.

## 5. Optional integrations

- **Email:** configure `RESEND_API_KEY` and `EMAIL_FROM` with a verified sender.
- **SMS:** configure the Twilio account, auth token and Verify service SID.
- **Push:** generate your own VAPID pair, configure public/private keys and a valid `WZY_PUSH_SUBJECT`; enable permission on the device.
- **Passkeys:** use a supported browser/device and HTTPS outside local development.

Leaving a provider unconfigured keeps its feature unavailable; this repository does not send real messages during automated QA or provision paid services automatically.

Before hosting a fork, replace `privacidade@example.com` and the generic operator text in the privacy/settings screens with your own public contact, and review the privacy wording for your installation. The supplied text is a technical starting point, not a legal certification.

## Common issues

| Symptom | Check |
| --- | --- |
| Demo opens but registration fails | Database/environment configuration; demo is intentionally available without persistence |
| Migration cannot create a role | Use a development database credential with the necessary DDL privileges |
| 2FA or snapshot encryption unavailable | Key must decode to exactly 32 bytes; preserve it between restarts |
| Email/SMS unavailable | Provider credentials, verified sender/service and environment target |
| Files cannot be uploaded | Store privacy mode, Blob token and file limits |
| Admin menu blocked | Correct account ID, active session and completed 2FA |
| Test browser missing | Run `npx playwright install chromium` |
