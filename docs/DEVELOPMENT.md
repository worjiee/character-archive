# Development Guide

## Prerequisites

- Node.js compatible with Next.js 16
- npm
- A local PostgreSQL development database
- Git for local version control

This project currently uses Prisma ORM 7 with the `@prisma/adapter-pg` PostgreSQL driver adapter.

## Dependency Installation

```bash
npm install
```

The `postinstall` script generates Prisma Client. Generated output is written under `generated/prisma/` and is ignored by Git.

## Environment Setup

Copy `.env.example` to `.env` and replace placeholders with local development values:

```bash
cp .env.example .env
```

On PowerShell:

```powershell
Copy-Item .env.example .env
```

Required variables:

- `DATABASE_URL`: application and Prisma Client PostgreSQL connection string
- `SHADOW_DATABASE_URL`: separate development shadow database used by Prisma migrations

Never commit `.env` or paste real credentials into documentation, issues, logs, or screenshots.

## Starting the Development Database

Start the named local Prisma development database with:

```bash
npx prisma dev start chikpeas
```

Use the connection information provided by Prisma Dev in your local `.env`. This command starts development infrastructure; it does not authorize destructive database operations.

## Prisma Commands

```bash
npm run db:generate        # Generate Prisma Client
npx prisma format          # Format prisma/schema.prisma
npx prisma validate        # Validate configuration and schema
npm run db:migrate         # Create/apply a reviewed development migration
npm run db:studio          # Open Prisma Studio
```

## Migrations

Schema changes require a named, reviewed Prisma migration. Before applying one:

1. Confirm that the target is a development database.
2. Review the schema change and generated SQL.
3. Consider whether existing records need a data migration.
4. Avoid reset, force-reset, or data-loss flags unless the exact disposable target and impact are explicitly approved.

Production migrations must be planned and applied deliberately. Never casually reset a database containing user data.

## Database Connectivity Check

```bash
npm run db:check
```

The script makes a simple Prisma query and prints only a safe connection result and character count. It disconnects when the standalone process finishes.

## Prisma Development Lifecycle

During long-lived Next.js development, these resources are one lifecycle bundle:

```text
pg Pool
   ↓
PrismaPg adapter
   ↓
PrismaClient
```

The application caches `{ pool, adapter, prisma }` together on `globalThis` in development. This is required for stable reuse across Next.js and Turbopack hot reloads.

Previously, caching only `PrismaClient` while creating an uncached adapter and pool allowed hot-reloaded module instances to dispose resources that were still backing the cached client. The result was intermittent Prisma `P1017` / `ConnectionClosed` failures. Do not reintroduce that pattern. If this initialization changes, preserve the complete resource bundle and verify repeated requests before and after a server-side hot reload.

Standalone scripts have a different lifecycle: they import the same client, perform their finite task, and may call `$disconnect()` as the process exits. Application routes and services must not disconnect the shared long-lived client.

## Running Next.js

```bash
npm run dev
```

Open `http://localhost:3000`. Repository queries and settings remain server-side.

## Tests

```bash
npm test
```

Tests use mocks and synthetic fixtures where practical. Importer unit tests must not make unmocked network requests.

## Type Checking

```bash
npm run typecheck
```

## Lint

```bash
npm run lint
```

## Production Build

```bash
npm run build
```

A successful build is required before release-ready changes merge to `main`.

## Common Development Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start Next.js development mode. |
| `npm run build` | Create a production build. |
| `npm start` | Start a completed production build. |
| `npm test` | Run the Vitest suite. |
| `npm run typecheck` | Run TypeScript validation. |
| `npm run lint` | Run ESLint. |
| `npm run db:generate` | Generate Prisma Client. |
| `npm run db:migrate` | Create/apply development migrations. |
| `npm run db:check` | Verify database connectivity. |
| `npm run db:studio` | Inspect local data with Prisma Studio. |

## Troubleshooting

### Database connection fails

- Confirm `npx prisma dev start chikpeas` reports the database as running.
- Confirm `.env` exists and contains local values for the required variables.
- Run `npm run db:check` to distinguish database connectivity from an application runtime problem.
- Do not print the connection string while diagnosing the failure.

### `P1017` or `ConnectionClosed` during development

- Inspect `lib/prisma.ts` before changing any repository query.
- Confirm the pool, adapter, and Prisma Client are cached as one `globalThis` bundle.
- Confirm application code does not call `$disconnect()`, `pool.end()`, or otherwise dispose the shared resources.
- Restart the development server only after fixing the lifecycle cause, then test repeated list/detail requests around a hot reload.

### Prisma Client types are stale

Run `npm run db:generate`, then repeat type checking. Generation does not modify database data.

### Migration validation fails

Run `npx prisma format` and `npx prisma validate`, inspect the reported schema/configuration error, and review migration SQL before applying anything. Do not use a reset as a shortcut.

### Live Janitor request is denied

The ordinary server-side request currently lacks the authorized browser context required by the observed endpoint. Do not copy cookies, tokens, or browser credentials and do not attempt to bypass authentication or Cloudflare. Use the clearly labeled development fixture workflow until an authorized integration is designed.
