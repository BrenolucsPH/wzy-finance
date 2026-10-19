# Security policy

## Reporting

Please use this repository's **Security → Report a vulnerability** channel for private reports. Include the affected behavior, reproduction steps with synthetic accounts and the expected/actual outcome. Do not include real user data, passwords, tokens or a database export. Do not publish an exploit against the live service in an issue.

## Public-source boundary

Route implementations are published for review, including administration and scheduled work. Their names are not credentials. Privileged operations require verified sessions, configured roles, 2FA/password confirmation where applicable, or a separate job secret. Financial queries carry owner context and are checked by PostgreSQL policies.

This snapshot excludes production environment files, operational IDs, original commit history, internal runbooks, user uploads, databases, browser authentication state and test traces. The sample environment file contains variable names and empty/example values only.

## Controls to preserve

- Keep server-only secrets outside client bundles and `NEXT_PUBLIC_*` variables.
- Preserve same-origin request checks, secure session settings and nonce-based CSP.
- Check authorization at each write/read boundary; never rely on hiding UI controls.
- Preserve owner isolation, transaction locks, idempotency and stale-write checks.
- Keep object storage private; validate file type/content, ownership and size.
- Generate independent keys for each installation and protect recovery material.
- Run tests with synthetic accounts and isolated schemas; never import real data as test fixtures.

`npm run check:secrets` and the CI workflow provide an additional publication check. Pattern scanning is not a guarantee against all possible disclosures. If a real credential is committed, remove it from use and rotate it with its provider; deleting the latest file alone is insufficient.

Security mechanisms and automated tests are engineering evidence, not an independent audit or compliance certification.
