# Contributing

Start by reading [SETUP.md](docs/SETUP.md), [architecture](docs/ARQUITETURA.md) and [SECURITY.md](SECURITY.md). Discuss substantial changes in an issue before implementing them. Review the [license status](LICENSE.md) before reusing or contributing code.

Use Node.js 24.x, install with `npm ci`, and work on a focused branch. Preserve existing financial records and migration history. Use integer cents and explicit account ownership; do not weaken authorization or replace concurrency checks with client-only validation.

Before proposing a change:

```sh
npm run check:secrets
npm run check
npm run build:app
```

Run the relevant isolated integration/browser checks for financial, authentication, storage or offline behavior. Explain the user-visible result, tests performed and remaining limitations in the pull request. Verify responsive layouts and reduced-motion behavior for UI changes.

Never attach environment files, credentials, personal financial records, production screenshots, traces or database backups. Use synthetic examples. Do not edit an already applied migration; add a reviewed migration instead.
