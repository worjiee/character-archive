# Character Archive

A private character-card and lorebook repository designed for archival, moderation, customization, and future multi-source importing.

The project name is intentionally neutral. The website name, subtitle, logo, accent color, and theme remain configurable through Repository Settings and can be adapted for client branding.

## Overview

Character Archive provides a private workspace for organizing normalized chatbot characters and their related source records, greetings, tags, and lorebooks. Its importer architecture separates external retrieval from normalization, moderation, and persistence so future integrations can be added without coupling them to the repository UI.

## Current Features

- Responsive character repository and character detail pages
- Private single-owner authentication with database-backed sessions
- PostgreSQL persistence through Prisma
- Multiple ordered greetings per character, including local reordering and visibility controls
- Tags and many-to-many character relationships
- Multiple source records per internal character
- Lorebook references, lorebook entries, and character-to-lorebook relationships
- Deterministic block rules and blocked-creator matching
- Quarantine, restore, block, and soft-delete workflows
- Local character display overrides that survive source re-imports
- Singleton repository settings with configurable branding, dark/light/system themes, and accent colors
- A development import workflow using synthetic fixtures
- Independently tested Janitor URL parsing, retrieval, normalization, and persistence layers

## Architecture

The import pipeline is deliberately layered:

```text
Source Adapter
      ↓
Source Retrieval
      ↓
Normalization
      ↓
Moderation / Filtering
      ↓
Persistence
      ↓
Repository UI
```

External source identity is stored separately from internal character identity. One internal character can therefore have multiple platform sources without forcing platform-specific fields into the core character model. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for details.

## Tech Stack

- Next.js 16 App Router
- React 19
- TypeScript
- Tailwind CSS 4
- Prisma ORM 7
- PostgreSQL
- Vitest
- ESLint

## Project Structure

```text
app/                         Next.js routes, layouts, and server endpoints
components/                  Reusable dashboard and management UI
docs/                        Architecture and development documentation
generated/prisma/            Generated Prisma Client (ignored)
lib/prisma.ts                Shared Prisma/adapter/pool lifecycle bundle
prisma/                      Schema and reviewed migrations
scripts/                     Development and database verification scripts
src/lib/characters/          Character queries and owner management services
src/lib/importers/           Source parsing, retrieval, normalization, fixtures, and persistence
src/lib/moderation/          Deterministic blocklist matching and moderation services
src/lib/settings/            Repository settings service
```

## Local Development

1. Install Node.js and PostgreSQL prerequisites described in [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md).
2. Install dependencies with `npm install`.
3. Copy `.env.example` to `.env` and supply local development database URLs.
4. Start the local Prisma development database and apply the existing migrations.
5. Generate Prisma Client with `npm run db:generate`.
6. Start Next.js with `npm run dev`.

Private staging preparation and the manual Vercel/PostgreSQL deployment checklist are documented in [docs/STAGING.md](docs/STAGING.md).

## Database Setup

The current local Prisma development database can be started with:

```bash
npx prisma dev start chikpeas
```

Use the connection details from the local development database in `.env`, then apply reviewed migrations with:

```bash
npm run db:migrate
```

Never run a reset against a database that may contain user data. More detailed database guidance is in [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md).

## Environment Variables

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | PostgreSQL connection string used by the application and Prisma Client. |
| `SHADOW_DATABASE_URL` | Optional development-only shadow database used by `prisma migrate dev`; not required in staging/production. |
| `OWNER_USERNAME` | Private owner username or email; read only by the server. |
| `OWNER_PASSWORD_HASH` | Memory-hard scrypt password hash generated locally. |
| `AUTH_SESSION_SECRET` | Random secret of at least 32 bytes used to sign session tokens. |

Only safe placeholders belong in `.env.example`. Real database passwords and third-party credentials must never be committed.

## Available Scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the Next.js development server. |
| `npm run build` | Create a production build. |
| `npm start` | Run the production build. |
| `npm test` | Run all Vitest tests once. |
| `npm run typecheck` | Run TypeScript without emitting files. |
| `npm run lint` | Run ESLint. |
| `npm run db:generate` | Generate Prisma Client. |
| `npm run db:migrate` | Create/apply a reviewed development migration. |
| `npm run db:deploy` | Apply committed migrations in staging/production with `prisma migrate deploy`. |
| `npm run db:check` | Verify database connectivity and report a safe character count. |
| `npm run db:studio` | Open Prisma Studio for local inspection. |
| `npm run test:janitor-live` | Attempt one public-character request and print only a safe summary; this is an opt-in manual check, not the fixture-driven UI. |
| `npm run auth:hash-password` | Generate a scrypt owner-password hash from a temporary local input variable. |

## Testing

Before merging ordinary changes, run:

```bash
npm test
npm run typecheck
npm run lint
```

Release-ready changes should also pass `npm run build` and relevant database checks.

## Import Architecture

URL parsing, source retrieval, normalization, moderation, and persistence are separate layers. The current demonstrated UI workflow uses development fixtures and clearly labels fixture previews.

Live automatic Janitor AI importing is **not currently enabled**. Development fixtures are disabled in staging and production, where the Import page shows a clear unavailable state. A normal server-side Janitor request does not currently have the authorized browser context required for the observed endpoint. This project does not bypass platform authentication, authorization, Cloudflare, CAPTCHA, rate limits, or other access controls.

Saucepan and Datacat adapters are planned but not implemented. Bulk automatic importing and synchronization are also not implemented.

## Moderation and Blocklist

Enabled deterministic rules can match character names, tags, creator names, creator IDs, and bounded keywords across normalized character text. Blocked creators can be platform-specific or platform-agnostic. Matching active characters are quarantined for review rather than automatically deleted, and owners can restore or permanently mark quarantined records as blocked.

AI-assisted celebrity, real-person, or fandom detection is not implemented.

## Lorebooks

Lorebooks and ordered entries can be normalized and persisted transactionally, including keys, categories, comments, activation options, and source raw data. The current end-to-end demonstration uses short synthetic development content. Retrieval of closed/private lorebooks is not implemented.

## Repository Customization

Repository Settings persist the site name, subtitle, logo URL, accent color, and dark/light/system theme preference. Character display overrides and greeting presentation controls are stored separately from imported source values so later synchronization does not blindly destroy intentional local edits.

## Current Development Status

This is a private beta-stage prototype. Single-owner authentication, database-backed sessions, repository management, moderation, settings, local management, fixture-driven import flow, and persistence layers are implemented and tested. Multi-user identity, password recovery, deployment hardening, live source adapters, bulk synchronization, and operational monitoring remain future work.

## Security Notes

- Never commit bearer tokens, browser cookies, passwords, session tokens, database credentials, or API secrets.
- Use environment variables for local secrets and keep `.env` files ignored.
- Owner passwords are stored only as memory-hard hashes; session cookies are HttpOnly, SameSite, and Secure in production.
- External integrations must use only public data or data legitimately available to the user's authorized session.
- Third-party authentication and access controls must never be bypassed.
- Review [SECURITY.md](SECURITY.md) before adding an external integration.

## Roadmap

- Deployment authentication hardening and optional owner MFA
- Authorized live source adapters
- Saucepan integration
- Datacat integration
- Bulk importing and synchronization with deliberate rate and access controls
- Cross-platform duplicate detection using multiple signals
- Human-reviewed handling of uncertain duplicate candidates
- Smart real-person and fandom detection
- Repository search, filtering, and operational tooling

## Private Project Notice

This repository is intended for private commissioned project development. No open-source license has currently been granted. Do not redistribute, publish, or reuse the project as open-source software without separate authorization.
