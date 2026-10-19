# Deploy your own installation

The repository includes Vercel configuration but contains no link to the original project, deployment tokens, database connection or environment export. GitHub Actions performs quality checks only; it does not publish to production.

1. Create your own hosting project, isolated Neon/PostgreSQL database and private Blob store.
2. Configure the variables from [SETUP.md](SETUP.md) in the correct hosting environment. Generate new secrets for your installation.
3. Review schema migrations and verify a recoverable private backup before changing an existing database.
4. Run the full checks in your own staging environment. The migration gate fails closed if a required encrypted checkpoint cannot be saved and verified.
5. Build for production and release only after checks succeed. Verify login, first transaction, totals, private uploads and administrator permissions.

Keep the runtime and direct database connections distinct where the provider requires it. Preserve the encryption key across releases. The versioned SQL migrations are canonical; the Drizzle schema is partial and must not overwrite them automatically.

Scheduled tasks require your own `CRON_SECRET`. Set provider/device integrations explicitly; no service subscription is created by this code. Understand storage quotas and preserve recovery material outside the repository.

The privacy/settings screens use generic operator/contact placeholders in this public snapshot. Configure your own public details and review privacy/retention requirements before inviting real users.

Keep deployment credentials in protected provider/CI configuration, never in workflow source, artifacts, pull-request logs or screenshots. Public pull requests must not receive deployment secrets. A repository push is not authorization to migrate another installation's database.
