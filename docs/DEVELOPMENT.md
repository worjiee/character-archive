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
- `SHADOW_DATABASE_URL`: optional, development-only shadow database used by `prisma migrate dev`
- `OWNER_USERNAME`: one-time initial-administrator bootstrap username
- `OWNER_PASSWORD_HASH`: one-time initial-administrator bootstrap scrypt hash, never a plaintext password

Never commit `.env` or paste real credentials into documentation, issues, logs, or screenshots.

## Initial Administrator Setup

Choose a long, unique owner password. Generate its memory-hard scrypt hash locally; the command prints only the hash.

PowerShell:

```powershell
$securePassword = Read-Host "Owner password" -AsSecureString
$env:OWNER_PASSWORD_INPUT = [Net.NetworkCredential]::new("", $securePassword).Password
npm run auth:hash-password
Remove-Item Env:OWNER_PASSWORD_INPUT
```

Bash-compatible shells:

```bash
read -rsp "Owner password: " OWNER_PASSWORD_INPUT && echo
export OWNER_PASSWORD_INPUT
npm run auth:hash-password
unset OWNER_PASSWORD_INPUT
```

Copy the resulting `scrypt:...` value into the local `OWNER_PASSWORD_HASH` environment variable. Do not copy the plaintext password into `.env`.
The colon-delimited format is intentional: unescaped dollar-prefixed text can be treated as variable expansion by Next.js when it loads `.env` files.

After applying the reviewed User/UserSession migration, run the explicit bootstrap:

```bash
npm run auth:bootstrap-initial-admin
```

The command creates exactly one deterministic `initial-admin` record with `ADMIN`/`ACTIVE`, copies the configured hash exactly, and is idempotent only when the existing row matches every bootstrap field. It aborts on any identity, hash, role, status, or extra-user conflict. It never runs during application startup and never prints the password hash. Runtime login reads `User.normalizedUsername`; the owner bootstrap variables are not runtime credentials.

There is no public registration. After signing in as the initial ADMIN, use Settings → Access to list authorized users and create a trusted MEMBER. The form fixes role/status to `MEMBER`/`ACTIVE`, reuses the login username normalization and scrypt password policy, and never returns or logs the password hash. Unknown usernames, wrong passwords, and REVOKED users intentionally return the same public login error.

ADMIN may revoke/reactivate a MEMBER or set a replacement MEMBER password from the same page. Revocation and password replacement delete all of the target's sessions immediately; reactivation requires a fresh login. These actions preserve the User, Favorites, Cart, and shared archive data. The initial ADMIN is protected, general role editing and user deletion are not available, and all `/api/admin/users` routes enforce the authoritative ADMIN session and same-origin policy.

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
npm run db:deploy          # Apply committed migrations in staging/production
npm run db:studio          # Open Prisma Studio
```

## Migrations

Schema changes require a named, reviewed Prisma migration. Before applying one:

1. Confirm that the target is a development database.
2. Review the schema change and generated SQL.
3. Consider whether existing records need a data migration.
4. Avoid reset, force-reset, or data-loss flags unless the exact disposable target and impact are explicitly approved.

Production migrations must be planned and applied deliberately. Never casually reset a database containing user data.

Use `npm run db:deploy` (`prisma migrate deploy`) for reviewed staging and production migrations. It does not require `SHADOW_DATABASE_URL`. See [STAGING.md](STAGING.md) for the manual deployment checklist.

The Step 11B migration replaces `OwnerSession` with `User` and `UserSession`. It deliberately invalidates legacy owner cookies and deletes ephemeral bridge pairings/sessions/jobs while preserving durable archive, settings, source-connection, Favorites, and Cart records. `UserSession` stores only a SHA-256 token hash and expiration; the raw token exists only in the HttpOnly browser cookie. Apply reviewed migrations, then run the explicit initial-admin bootstrap before starting the application.

The Step 11C migration adds non-null `userId` ownership to Favorites and Cart, backfills every legacy row to the deterministic `initial-admin`, and replaces the character-only primary keys with `(userId, characterId)`. It preserves membership and `createdAt` values. Apply it only after confirming `initial-admin` exists when legacy collection rows are present. Runtime collection services use the authenticated principal; no user identity is accepted from client input. User revocation retains collections, while database-level hard deletion is restricted until an administrator makes an explicit collection decision.

Step 11D creates no schema migration. The existing User/UserSession and per-user collection schema already supports MEMBER lifecycle management. MEMBER automatic retrieval is explicitly prevented from consulting the global ADMIN `SourceConnection`; use manual JSON or the per-session browser companion for the current safe import path. Repository settings, source-connection management, moderation mutations, and force-linking remain ADMIN-only.

The Step 11E migration adds required immutable first-adder attribution to `Character` and `CharacterSource`, plus nullable one-time `Character.publishedAt`. Before applying it to a database with archive rows, confirm the deterministic `initial-admin` exists and is `ADMIN`/`ACTIVE`. The migration stages attribution as nullable, backfills legacy rows to `initial-admin`, sets legacy ACTIVE publication to the original `createdAt`, asserts the invariants, and only then makes attribution required and adds `RESTRICT` foreign keys. Restricted legacy rows remain unpublished. Runtime import services derive attribution from the authenticated server-side principal; request payloads and bridge envelopes cannot choose the uploader.

The Step 11F migration adds `Tag.normalizedLabel` and source-level `SourceTag` provenance. Before applying it, verify every legacy `CharacterTag` belongs to a character with at least one `CharacterSource`; the migration also raises an exception if this invariant is false. Because historical joins do not prove which source supplied a tag, each legacy row is attributed deterministically to the character's earliest source by `(firstSeenAt, id)`, with `rawLabel = Tag.name`, the centralized normalized key, and no fabricated external ID. This is inferred legacy provenance, not historically exact attribution. Future authoritative imports replace only the refreshed source's rows and rebuild the canonical `CharacterTag` union.

The Step 13B migration adds `ImportPreviewJob`, owned by `UserSession` with cascade deletion. Automatic URL and manual JSON preview store a sanitized version-1 normalized snapshot for 15 minutes; successful Save claims and persists it in the same serializable transaction. Consumed or expired jobs are retained briefly for deterministic errors and opportunistically deleted after 24 hours. Normal Single Retrieve is always `PUBLIC_ONLY`, including for ADMIN. Stored `SourceConnection` credentials require the explicit internal `ADMIN_CREDENTIAL_DIAGNOSTIC` mode and are not exposed by the ordinary import route.

Janny remains presentation-only and is not part of persisted `SourcePlatform`. Its tag-source control stays disabled/Coming soon, and it must never be mapped to `OTHER`.

Fresh character rows use `publishedAt` for window filtering, deterministic ordering, and recency labels. The separate Recent Activity rail intentionally continues to use `updatedAt`. MEMBER visibility is always `ACTIVE` plus non-null `publishedAt`; collection membership rows are retained while a character is restricted and reappear when the same record becomes visible again.

Rollback requires coordinated application and database recovery: older code depends on the dropped `OwnerSession` table, cannot use the new opaque cookie, and expects character-only collection keys. Prefer a forward fix or restore a pre-migration database snapshot together with matching application code. Never use `prisma migrate reset` or `prisma db push` as rollback tools.

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
| `npm run db:deploy` | Apply committed migrations in staging/production. |
| `npm run db:check` | Verify database connectivity. |
| `npm run db:studio` | Inspect local data with Prisma Studio. |
| `npm run auth:hash-password` | Generate a scrypt password hash from temporary local input. |
| `npm run auth:bootstrap-initial-admin` | Explicitly create or verify the deterministic initial ADMIN. |

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

The ordinary server-side request currently lacks the authorized browser context required by the observed endpoint. Do not copy cookies, tokens, or browser credentials and do not attempt to bypass authentication or Cloudflare. Use the Janitor Chrome Companion or the manual JSON fallback.

### Character Archive Companion development setup

The supported experimental companion direction is the isolated Manifest V3 extension in `browser-extension/`. Its lifecycle, target binding, nonce/message contract, bounded payload checks, and transport are source-neutral; Janitor-specific page and response matching is isolated in `observers/janitor.js`. Janitor is the only currently registered source observer. The previous Tampermonkey script remains development evidence only. Do not extend either path with privileged networking.

1. Set `BRIDGE_ARCHIVE_ORIGINS` in the ignored `.env` to the exact Archive origin, such as `http://localhost:3000`.
2. Open `chrome://extensions`, enable **Developer mode**, choose **Load unpacked**, and select the repository's `browser-extension/` directory.
3. Copy the displayed extension ID. Set `BRIDGE_EXTENSION_ORIGINS` in the ignored `.env` to the exact `chrome-extension://<extension-id>` origin, then restart the Archive development server.
4. Confirm `browser-extension/config.js` and `manifest.json` both contain only the intended Archive origin. The development default is `http://localhost:3000`; staging/production origins must be added explicitly later.
5. Enter the selected Janitor character URL on `/import` while signed in and select **Pair Companion**. The server parses and stores its canonical target before issuing the short-lived one-time code.
6. Open that exact Janitor character normally, open the Character Archive Companion toolbar popup, enter the code, and choose **Pair**. The capability is bound to the authenticated user session, canonical character target, Archive origin, exact configured extension origin, operation, and expiry.
7. Choose **Send this character**. Only then is the exact tab/target observer armed. Responses that occurred before ARM were not cloned, parsed, or retained; reload the same character page normally once to produce a new response.
8. The extension observes only Janitor's successful `GET /hampter/characters/{UUID}` response for that page. Its service worker sends the source envelope to the fixed Archive origin with the scoped capability, then clears the capability.
9. Receipt atomically creates the ordinary immutable `ImportPreviewJob` and leaves `BridgeJob` as transport/status only with no retained source payload. Return to `/import`, select **Preview**, review duplicates and moderation, and stop or explicitly Save the exact snapshot.

The companion never reads Janitor authorization, request headers, cookies, browser storage, Cloudflare state, or the Archive owner cookie. The server-side bearer connector remains **Advanced / Experimental** and is not used by the extension.

The companion does not perform cross-origin Archive fetches and does not use `GM_xmlhttpRequest`. If the receiver cannot be opened, allow the explicit popup for the selected Janitor page and try again; do not enable a privileged networking fallback.
The legacy Tampermonkey evidence script explicitly requests its `raw` page context and verifies the selected world through `GM_info.sandboxMode`. It is not the supported extension transport. If it reports `PAGE_CONTEXT_UNAVAILABLE`, stop rather than enabling a privileged fallback.

### Login fails after the User/UserSession migration

- Confirm the reviewed migration is applied and `prisma migrate status` has no pending migration.
- Run `npm run auth:bootstrap-initial-admin` with local `OWNER_USERNAME` and `OWNER_PASSWORD_HASH` set.
- Confirm the bootstrap reports created or exactly matching without printing the hash.
- Confirm the user is `ADMIN` and `ACTIVE`; REVOKED users intentionally receive the generic invalid-credentials response.
- Restart the development server after migration/client generation. Legacy owner cookies cannot authenticate and should be cleared by signing in or logging out.
