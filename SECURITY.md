# Security Policy

## Private Reporting

Security issues should be handled privately before any disclosure. Do not post exploit details, credentials, personal data, or sensitive logs in public channels or issue trackers. Use the repository owner's approved private communication channel.

## Secret Handling

Never commit or share:

- Bearer tokens
- Browser cookies
- Passwords
- Session tokens
- Database credentials or connection strings
- API keys or API secrets
- Authentication headers
- Private network captures or browser session exports

Use environment variables for secrets and keep real `.env` files out of Git. `.env.example` must contain placeholders only.

If a credential is accidentally exposed, stop using it and rotate or revoke it immediately. Removing it from a later commit does not make the original exposure safe; coordinate private remediation before changing history.

## External Integrations

External integrations must use only public data or data legitimately available to the user's authorized session. They must respect authentication, authorization, privacy controls, access restrictions, CAPTCHA, rate limits, and platform terms.

Do not implement or attempt:

- Account compromise or credential extraction
- Authentication or authorization bypasses
- Circumvention of server-side access restrictions
- Cloudflare or CAPTCHA bypasses
- Collection of copied browser cookies, session tokens, or passwords
- Access to private or closed source records without authorization

## Application and Database Safety

- Validate untrusted external input before retrieval, normalization, or persistence.
- Keep raw source data server-side and avoid exposing it in routine UI responses.
- Use transactions for multi-record persistence.
- Preserve moderation state and intentional local overrides during re-imports.
- Review migrations and never casually reset a database containing user data.
- Treat the Prisma pool, adapter, and client as one shared lifecycle bundle in long-lived development processes.

## Owner Authentication

- The single owner credential is configured only through server environment variables.
- Store only the generated scrypt password hash, never the plaintext password.
- Use a unique, random `AUTH_SESSION_SECRET` for each deployed environment.
- Owner sessions are database-backed and represented in the browser by a signed HttpOnly cookie.
- Session cookies use SameSite protection, become Secure in production, and expire after a fixed interval.
- Logout removes the server-side session before clearing the cookie.
- Login attempts are rate-limited per application instance; production infrastructure may add an additional trusted edge limit.
- The process-local limiter is acceptable for the initial low-traffic private beta, but it is not a distributed limit across multiple Vercel function instances.
- Never expose owner authentication variables through `NEXT_PUBLIC_` names or client component props.

## Staging Deployment

- Use a clean managed PostgreSQL database and `prisma migrate deploy`; never use development resets or local Prisma Dev infrastructure in staging.
- Keep development import fixtures disabled in production-mode builds.
- The public `/api/health` endpoint is liveness-only and must not expose database, environment, session, or repository data.
- Follow the reviewed checklist in `docs/STAGING.md` before creating or deploying external infrastructure.
