# Contributing

Character Archive is currently a private project. Contributions should be scoped, reviewable, tested, and free of secrets or third-party private data.

## Branch Strategy

- `main`: stable, release-ready code
- `develop`: active integration branch
- `feature/*`: new features
- `fix/*`: bug fixes
- `docs/*`: documentation-only changes
- `chore/*`: tooling and maintenance changes

Example branch names:

```text
feature/private-auth
feature/janitor-importer
feature/repository-search
feature/duplicate-detection
feature/saucepan-adapter
feature/datacat-adapter
fix/prisma-pool-lifecycle
fix/accent-contrast
docs/update-architecture
```

After the initial repository setup, normal development should not be committed directly to `main`.

## Development Workflow

```text
feature/* or fix/*
        ↓
Pull Request
        ↓
develop
        ↓
testing / beta
        ↓
Pull Request
        ↓
main
```

Keep branches focused. Describe behavior changes, tests, migration impact, and security considerations in every pull request.

## Required Checks

Before merging into `develop`:

```bash
npm test
npm run typecheck
npm run lint
```

Before a release merge into `main`, also run:

```bash
npm run build
```

Run `npm run db:check` when database-facing behavior changes.

## Database Changes

- Every schema change requires a reviewed Prisma migration.
- Inspect generated migration SQL before applying it.
- Never casually reset a database containing user data.
- Never commit database credentials or connection strings.
- Handle production migrations deliberately, with a rollback and data-safety plan where appropriate.
- Do not use destructive Prisma flags merely to resolve development drift.

## Commit Messages

Use concise Conventional Commit-style messages:

- `feat: ...`
- `fix: ...`
- `docs: ...`
- `refactor: ...`
- `test: ...`
- `chore: ...`

Examples:

```text
feat: add deterministic character moderation
feat: add lorebook persistence
fix: preserve Prisma adapter pool across hot reloads
fix: improve customizable accent contrast
docs: add architecture guide
test: add character persistence coverage
```

Avoid messages such as `update`, `stuff`, `changes`, or `fix again`.

## Security and Source Data

- Do not commit secrets, cookies, tokens, credentials, network captures, or private third-party content.
- Keep automated importer tests fully mocked unless a script is explicitly documented as an opt-in live check.
- External integrations must respect authentication, authorization, privacy, rate limits, and platform terms.
- Preserve local overrides and moderation status during source synchronization.

Read [SECURITY.md](SECURITY.md) before working on authentication or external integrations.
