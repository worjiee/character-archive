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
