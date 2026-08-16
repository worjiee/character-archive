# Private Staging Deployment

This guide prepares Character Archive for a private staging deployment using Vercel and a managed PostgreSQL database. It is an execution checklist only: creating infrastructure, configuring Vercel, applying migrations, and deploying must be performed manually after review.

## Deployment Shape

- **Application:** Vercel-hosted Next.js application using the Node.js runtime.
- **Database:** A clean managed PostgreSQL database reachable from Vercel.
- **Authentication:** One owner credential configured through server-only environment variables, with database-backed sessions.
- **Importing:** Live source importing remains unavailable. Development fixtures are automatically disabled in staging and production builds.

No `vercel.json` is required. Vercel detects the Next.js application and uses the existing `npm run build` command. The `postinstall` script generates Prisma Client during dependency installation.

## Required Environment Variables

Configure these values for the Vercel environment used by the staging deployment:

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Managed PostgreSQL connection string used by Prisma Client and migration commands. |
| `OWNER_USERNAME` | Private owner username or email. |
| `OWNER_PASSWORD_HASH` | Locally generated scrypt password hash; never the plaintext password. |
| `AUTH_SESSION_SECRET` | Independent random signing secret containing at least 32 bytes. |

These values are server-only. Do not prefix any of them with `NEXT_PUBLIC_`.

`SHADOW_DATABASE_URL` is only needed when creating migrations with `prisma migrate dev`. It is not required by the application or by `prisma migrate deploy`, and should not be configured in Vercel unless a separate reviewed workflow genuinely needs it.

Vercel supplies `NODE_ENV=production`; do not configure it manually. No Janitor AI credential, token, cookie, or browser-session variable is used or required.

## A. Create the Managed PostgreSQL Database

1. Choose a staging-only managed PostgreSQL database.
2. Keep it separate from local development and any future production database.
3. Enable TLS as recommended by the provider.
4. If the provider offers separate pooled and direct URLs, use its pooled/runtime URL for the Vercel application. Use the provider-recommended migration connection when running the deliberate migration step.
5. Configure connection and role permissions so the migration operator can create the schema objects in `prisma/migrations` and the application can read and write its tables.
6. Enable provider backups or snapshots before future schema changes.

Do not copy the local database. The first staging database should be empty and should not contain real third-party character or card content.

## B. Obtain `DATABASE_URL`

Copy the staging database connection string from the provider's secret-management interface. Store it only in the trusted shell used for migration and in Vercel's encrypted environment-variable settings.

The URL must be a normal PostgreSQL connection supported by `pg` and `@prisma/adapter-pg`. It must not point to the local Prisma Dev ports and must not require `npx prisma dev start chikpeas`.

Never paste the URL into source files, documentation, issues, screenshots, build logs, or chat.

## C. Configure Vercel Environment Variables

1. Import the private GitHub repository into the intended Vercel team/project.
2. Select Node.js 24.x in the Vercel project settings.
3. Add the four required variables through Vercel's encrypted environment-variable UI.
4. Scope them to the staging environment. For a branch-based staging deployment, ensure they are available to the relevant Preview deployment without unintentionally sharing production credentials.
5. Confirm none of the variables use a `NEXT_PUBLIC_` prefix.
6. Do not add `SHADOW_DATABASE_URL`, local Prisma Dev URLs, Janitor credentials, or plaintext owner passwords.

## D. Generate the Staging Owner Password Hash

Choose a unique staging password of at least 12 characters. Generate the hash locally without writing the plaintext password to a file.

PowerShell:

```powershell
$securePassword = Read-Host "Staging owner password" -AsSecureString
$env:OWNER_PASSWORD_INPUT = [Net.NetworkCredential]::new("", $securePassword).Password
npm run auth:hash-password
Remove-Item Env:OWNER_PASSWORD_INPUT
```

Bash-compatible shells:

```bash
read -rsp "Staging owner password: " OWNER_PASSWORD_INPUT && echo
export OWNER_PASSWORD_INPUT
npm run auth:hash-password
unset OWNER_PASSWORD_INPUT
```

Store only the resulting `scrypt:...` value as `OWNER_PASSWORD_HASH`. Do not reuse the local development hash unless that reuse has been explicitly approved.

## E. Generate `AUTH_SESSION_SECRET`

Generate a separate random secret:

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
```

Store the output as `AUTH_SESSION_SECRET` in Vercel. Do not reuse a development or production signing secret. Rotating this value invalidates every existing session token for that environment.

## F. Apply Reviewed Migrations

Review every SQL file under `prisma/migrations` before using staging credentials. Then, from a trusted environment with `DATABASE_URL` temporarily set to the staging database, run:

```bash
npm run db:deploy
```

This invokes `prisma migrate deploy`, which applies committed pending migrations without creating migrations, using a shadow database, or resetting data.

Do not use `prisma migrate dev`, `prisma db push`, or `prisma migrate reset` against staging. Do not make ordinary Vercel preview builds apply migrations automatically; run this deliberate step before deploying application code that requires the new schema.

The current migration chain creates the repository tables, customization fields, and database-backed `OwnerSession` table. It does not seed character content.

## G. Deploy the Vercel Project

After migrations succeed:

1. Confirm Vercel detects Next.js and uses `npm install` followed by `npm run build`.
2. Confirm `postinstall` runs `prisma generate` successfully.
3. Deploy the reviewed staging branch through the private repository integration.
4. Keep the generated staging URL private and share it only with approved beta testers.

No custom Vercel configuration file or local filesystem persistence is required. All mutable repository and session data belongs in PostgreSQL.

## H. Verify Login

1. Open `/login` in a private browser window.
2. Confirm repository branding renders.
3. Confirm an invalid login returns the generic invalid-credentials message.
4. Sign in with the staging owner credential.
5. Confirm the session cookie is `HttpOnly`, `Secure`, `SameSite=Strict`, scoped to `/`, and has a fixed expiration.

Do not inspect or share the cookie value.

## I. Verify Protected Routes

While signed out, verify `/`, `/characters`, `/import`, `/blocked`, and `/settings` redirect to `/login`. Verify private API routes return `401` without an authenticated session.

After signing in, verify each dashboard route loads normally. `/import` should show:

> Live source importing is currently under development.

It must not display or invoke development fixtures.

## J. Verify Database Persistence

1. Update a harmless repository setting.
2. Refresh the page and confirm the value persists.
3. Sign out and sign back in, then confirm it still persists.
4. If testing character creation later, use synthetic content only and document the cleanup plan.

The staging database should otherwise remain clean.

## K. Verify Logout and Session Invalidation

1. Sign in and confirm a row is created in `OwnerSession` through normal application behavior.
2. Use Logout.
3. Confirm the browser returns to `/login`.
4. Confirm the previous session cannot access a protected route.

Do not print session identifiers or cookies during verification.

## L. Verify `/api/health`

Request:

```text
GET /api/health
```

Expected response:

```json
{"status":"ok"}
```

This endpoint is intentionally public and uncached. It is a minimal liveness check for Vercel and external uptime monitoring; it does not query PostgreSQL and therefore reveals no database status, schema details, credentials, character data, or environment values. Database readiness is verified through authenticated application workflows.

## M. Rollback and Recovery

- Vercel can roll application code back to a previous deployment, but that does not roll back PostgreSQL schema changes.
- Prefer backward-compatible, forward-only migrations. Review application/schema compatibility before rolling code back.
- Take a provider snapshot or backup before any future migration that changes or removes data.
- If a migration fails, stop deployment, preserve logs privately, and follow Prisma's reviewed `migrate resolve` process. Never use reset as a repair shortcut.
- If credentials are exposed, rotate the database credential, owner password hash, and/or session secret as appropriate. Rotating the session secret invalidates all sessions.
- Restore data through the managed provider's documented backup workflow; do not copy an unreviewed local development database into staging.

## Authentication and Rate-Limit Notes

Authentication is server-side. The owner password is verified against a memory-hard hash, signed tokens contain no password, and active sessions are checked against PostgreSQL. Sessions expire after eight hours, and logout deletes the database session before clearing the cookie.

The current login limiter is process-local. That is acceptable for the initial low-traffic, single-owner private beta, but Vercel may run more than one function instance, so the limit is not globally coordinated. Before broader exposure, add a trusted distributed or edge-level rate limit. No Redis or paid rate-limit service is required for this staging preparation.

## Security Checklist

- Keep the GitHub and Vercel projects private and restrict team access.
- Keep all four required environment variables server-only and encrypted at rest by the deployment provider.
- Confirm `.env`, `.env.local`, `.vercel`, logs, generated Prisma artifacts, and local database files remain ignored.
- Do not configure Janitor AI bearer tokens, cookies, browser credentials, or scraping workarounds.
- Do not enable development fixtures in a production build.
- Do not log request cookies, authorization headers, environment variables, database URLs, or raw imported source data.
- Use Vercel production-mode error handling; normal API responses return generic messages while detailed errors remain in restricted server logs.
- Restrict access to the staging URL at the Vercel/team level when available; application owner authentication remains required regardless.
