# Hostinger readiness

Character Archive is prepared for Hostinger managed Node.js Web Apps with Supabase PostgreSQL and private Supabase Storage. This document is preparation only; no Hostinger deployment, DNS change, Production change, or Supabase resource change is performed here.

## Application settings

- **Node.js:** `22.x`
- **Install:** `npm ci`
- **Build:** `npm run build`
- **Start:** `npm run start`
- **Port:** use the `PORT` supplied by Hostinger; Next.js must bind to it.
- **Health check:** `GET /api/health` (expects HTTP 200 and `{"status":"ok"}`).
- **Transport:** serve the application over HTTPS and keep secure cookies enabled in production.
- **Production branch:** `main`.
- **Preview reference:** Vercel `develop`; promote through a reviewed `develop` to `main` merge.

Hostinger ignores `vercel.json`. The file remains in the repository while Vercel Preview is active so its Singapore `sin1` region setting is preserved.

## Environment checklist

Set these in Hostinger without committing or printing values:

**Required runtime secrets and settings**

- `NODE_ENV=production`
- `CHARACTER_ARCHIVE_DEPLOYMENT=production`
- `DATABASE_URL` (Supabase PostgreSQL connection string)
- `ARTWORK_STORAGE_PROVIDER=supabase`
- `DATABASE_SUPABASE_URL`
- `DATABASE_SUPABASE_SERVICE_ROLE_KEY` (or the supported Supabase secret-key equivalent)
- `SUPABASE_ARTWORK_BUCKET` (private bucket name; defaults to `character-archive-artwork`)
- `SOURCE_ENCRYPTION_KEY`
- `BRIDGE_ARCHIVE_ORIGINS`
- `BRIDGE_EXTENSION_ORIGINS`

**Bootstrap/operational settings where used**

- `OWNER_EMAIL`, `OWNER_PASSWORD` (bootstrap only; rotate/remove according to the existing runbook)
- `AUTH_SESSION_SECRET` if the deployment process supplies it; the current session implementation uses its existing server-side configuration.

Do not configure Vercel Blob variables, `VERCEL_ENV`, or Vercel OIDC variables on Hostinger. `CHARACTER_ARCHIVE_RELEASE_CHANNEL` remains optional and is independent of deployment stage.

## Database release safety

Before promoting a build, apply the reviewed migration set with:

```text
npm run db:deploy
```

Production automation must never run `prisma migrate dev`, `prisma db push`, or `prisma migrate reset`. Keep migrations deliberate and separate from the application start command.

## Storage and importer behavior

Artwork uses the existing private Supabase Storage objects and the server-side adapter. The portability cleanup removes the obsolete Vercel Blob runtime path without re-uploading artwork.

The process-local artifact review fallback is enabled only for development/Preview workflows and is disabled when `CHARACTER_ARCHIVE_DEPLOYMENT=production`; no production persistence model is introduced. Universal Importer policy remains: a supported reliable resolver may retrieve, while recognized unavailable and unsupported sources fall back to Character Card upload. Companion is not made the canonical Janitor path; DataCat remains pending official API access and Saucepan remains unavailable pending a supported integration.

## Hostinger handoff

Configure the Web App from the repository's `main` branch, select Node 22, provide the environment checklist above, and use the standard build/start commands. Confirm `/api/health` after each release, then exercise authenticated flows against the intended environment. Keep Vercel `develop` as the Preview reference until Hostinger is accepted; retire `vercel.json` only after that transition is complete and the required Preview region behavior has another explicit mechanism.

Official Hostinger references:

- [Deploy a Node.js website](https://www.hostinger.com/support/how-to-deploy-a-nodejs-website-in-hostinger/)
- [Select the Node.js version](https://www.hostinger.com/support/how-to-select-the-node-js-version-for-your-application/)
- [Fix failed Node.js builds](https://www.hostinger.com/support/fix-failed-to-build-application-error-hostinger-node-js/)
- [Connect Supabase to a Hostinger Node.js application](https://www.hostinger.com/support/connecting-a-supabase-database-to-a-hostinger-node-js-application/)
