# Architecture

## System Overview

Character Archive separates platform-specific data acquisition from the internal repository. This keeps external response shapes and access constraints out of the core data model and UI.

The entire archive is access-gated by database-backed user authentication. A new HttpOnly cookie carries 32 random opaque bytes; PostgreSQL stores only its SHA-256 hash in `UserSession`, along with the user relationship and eight-hour expiration. Next.js Proxy provides a broad optimistic gate, while protected pages, route handlers, and sensitive data boundaries repeat authoritative database session checks. Legacy owner cookies and `OwnerSession` rows are intentionally invalid after the Step 11B migration.

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

### Source Adapter

A source adapter owns platform-specific URL parsing and maps a supported platform to its retrieval and normalization layers. It must not bypass authentication, authorization, rate limits, or other platform controls.

### Source Retrieval

Retrieval obtains one source record and returns its raw, platform-specific representation. It validates identifiers, classifies upstream failures, and leaves normalization and persistence to later stages. Retrieval code must not write to the database.

### Normalization

Normalization converts a defensive source response into platform-neutral character or lorebook data. It validates required identity fields, normalizes tags and keys, preserves meaningful order, and retains the original source payload as raw data for traceability. It does not merge characters.

### Moderation / Filtering

Deterministic rules evaluate normalized names, creator information, tags, descriptive fields, dialogs, and greetings. Blocked-creator records are evaluated against character sources. Matching records are quarantined for owner review; they are not automatically destroyed.

### Persistence

Persistence uses transactions to synchronize a normalized record atomically. A source is identified by platform and external ID. Existing source records update their owning internal character, while new sources create a new character unless a deliberate future linking decision is made.

### Repository UI

Server-side repository services return purpose-built view data rather than exposing raw Prisma records. The UI provides browsing, detail views, moderation, settings, local overrides, greeting controls, and soft deletion.

## Core Data Responsibilities

### Character

The internal repository identity and canonical imported character fields. It stores moderation state, duplicate-detection signals, timestamps, immutable `firstAddedByUserId` uploader attribution, the nullable one-time `publishedAt`, local display overrides, and an optional content-addressed artwork reference. `Character` is intentionally independent of any single source platform. Existing `avatarUrl` source provenance and `avatarUrlOverride` remain intact.

### ArtworkAsset

Metadata for one exact validated PNG, keyed by its lowercase SHA-256 digest. `storageKey` is provider-neutral and unique; byte length and dimensions are retained for integrity checks and future exact Character Card export. Multiple Characters may reference one asset. Binary bytes live behind `ArtworkObjectStore`, not in PostgreSQL and not under a public filesystem path. Import inspection writes only session-scoped expiring pending objects. Explicit Save verifies and promotes the exact preview-bound bytes before atomically upserting the asset metadata and Character link. Presentation precedence is override, durable asset, source URL, then the established UI placeholder.

### CharacterSource

The identity and provenance of a character on an external platform. It stores platform/external ID uniqueness, creator identity, source URL, sync timestamps, immutable `firstAddedByUserId` attribution for the user who first attached that exact source, and the complete source raw payload. Multiple sources may belong to one `Character`.

### Greeting

An ordered source greeting associated with both its internal character and originating source. Source order and raw data are retained, while `localPosition` and `hidden` support local presentation changes without rewriting imported content.

### Tag, SourceTag, and CharacterTag

`Tag` is the normalized repository-wide identity keyed by slug. `SourceTag` records one observed canonical-tag occurrence per `CharacterSource`, retaining the source's raw label, normalized search key, and optional external tag ID. A source refresh replaces only that source's occurrences. `CharacterTag` remains the compatibility join used by existing character filtering and is rebuilt as the canonical union of every `SourceTag` belonging to the character.

There is no independent manual/local tag mutation feature. Consequently, source-union recomputation does not preserve a separate manual tag class. If local tags are introduced later, they need an explicit provenance kind before this invariant changes.

Tag discovery is a separate bounded service from character browsing. Canonical mode displays `Tag.name`; source mode consolidates equivalent `(Tag, normalizedLabel)` observations and displays a deterministic raw source label. Both modes count only published ACTIVE catalog characters, including for ADMIN users on the ordinary Characters surface, so restricted vocabulary cannot leak through tag names or counts. Character source filtering and tag-vocabulary source filtering are independent URL states.

### Lorebook

A platform-identified lorebook reference and its source metadata. Platform/external ID and platform/source URL constraints prevent duplicate source records.

### LorebookEntry

An ordered entry belonging to one lorebook. It stores content, activation keys, category and activation options, enabled/constant state, source identity, and complete entry raw data.

### CharacterLorebook

The many-to-many relationship linking internal characters to lorebooks. Re-importing an existing relationship does not create a duplicate association.

### BlockRule

A deterministic repository rule for character names, creator names, creator IDs, tags, or bounded keywords. Rules can be disabled without losing their configuration.

### BlockedCreator

A manually managed creator block that can be platform-specific or platform-agnostic and can match external creator ID, creator name, or both.

### RepositorySettings

A singleton-style settings record for the configurable website name, subtitle, logo, accent color, and theme preference. Internal project naming is not permanent client branding.

### User and UserSession

`User` stores the normalized login identity, scrypt password hash, display name, `ADMIN`/`MEMBER` role, and `ACTIVE`/`REVOKED` access state. `UserSession` stores only a SHA-256 token hash, never the raw browser token. Revoked users are rejected even when a session has not expired. The initial `ADMIN` is created only by the explicit idempotent bootstrap command. There is no public registration; an ADMIN may create only fixed `ACTIVE`/`MEMBER` accounts through Settings → Access.

ADMIN retains the current archive and moderation visibility. Every ordinary MEMBER character read uses the centralized predicate `status = ACTIVE AND publishedAt IS NOT NULL`, including browse/search/facets, Fresh, Quick View, author and lorebook surfaces, Favorites, Cart, and exports. Repository settings and source connections remain global and their mutations/management are ADMIN-only.

The main Fresh feed is publication chronology: it filters and orders by `publishedAt`, with character ID as the deterministic tie-breaker. The separate Recent Activity rail remains operational archive history based on `updatedAt` and is labeled accordingly. First approval of a never-published restricted record sets `publishedAt` once; quarantine, blocking, deletion, restoration, and exact-source re-import preserve an existing publication timestamp.

Access lifecycle operations are server-authoritative. Revocation changes the MEMBER to `REVOKED` and deletes every related `UserSession` in one transaction; password replacement stores a new scrypt hash and likewise deletes every session. Reactivation never restores old sessions. Deleting a session also cascades through its browser-bridge capabilities. The deterministic `initial-admin` has no normal revoke, reset, downgrade, or deletion action, and v1 exposes no general role editor.

MEMBER import access covers manual JSON, experimental public-only Single Retrieve, and the per-session browser companion, including validation, duplicate analysis, moderation, and explicit persistence stages. Every method, including browser capture, creates the same 15-minute, session-owned `ImportPreviewJob`; Save atomically consumes its versioned sanitized normalized snapshot and never retrieves or re-normalizes upstream data. A `BridgeJob` is transport/status state only: its authoritative canonical target is fixed at pairing, its receipt references the preview job, and it retains no saveable raw payload. Cross-source force-linking remains ADMIN-only. Persistent `SourceConnection` credentials remain ADMIN-only and are used only when an internal caller deliberately requests `ADMIN_CREDENTIAL_DIAGNOSTIC`; omitted mode and ordinary ADMIN/MEMBER requests are `PUBLIC_ONLY`.

Artifact snapshots may additionally bind safe pending-artwork metadata. The browser never supplies or receives writable/provider storage keys. Pending routes require the same `UserSession`; final routes reuse ordinary Character visibility. The development filesystem adapter is explicit and ignored by Git. Production artwork persistence fails closed until a reviewed private object-store adapter is configured; local filesystem persistence is never selected silently in production.

Favorites and Cart are per-user membership tables. `CharacterFavorite` and `CharacterCartItem` use the compound identity `(userId, characterId)`, so two users may independently save the same canonical Character without copying it. Every collection read, mutation, count, page, header state, Quick View action, bulk Cart add, and Cart export is scoped from the authenticated principal on the server; client payloads never choose the owner.

Revoking a User does not remove collection rows or shared upload attribution. There is no normal hard-delete-user workflow; collection and first-adder foreign keys use `ON DELETE RESTRICT`, so an administrative database-level User deletion must first be an explicit retention or cleanup decision. Character deletion retains the existing cascade behavior for memberships. User-specific collection responses are private and uncached globally.

## Moderation and Quarantine State

Characters use `ACTIVE`, `QUARANTINED`, `BLOCKED`, and `DELETED` states. Deterministic matches move active characters to quarantine and store a human-readable reason. Owner actions control restoration or blocking. Re-imports preserve intentional moderation state and never automatically return blocked or quarantined records to active status.

`DELETED` is a soft-delete state. Normal repository queries exclude deleted records, but owners can restore them. Permanent deletion is intentionally not part of the current management workflow.

## Local Overrides and Customizations

Imported source values remain in the canonical character and greeting fields. Owner display edits use separate override fields for name, description, personality, scenario, and avatar. Greeting visibility and local order are likewise stored separately from source position and content. Future synchronization must update source-owned values without clearing these local choices.

## Multi-Source Identity

Source identity and internal character identity are separate by design:

```text
Character
├── Janitor AI source
├── Saucepan source
└── Datacat source
```

The schema permits this relationship, but current persistence only resolves an exact existing source. It does not perform cross-platform fuzzy merging. Future tools may propose links between sources, but uncertain matches must remain reviewable.

## Future Duplicate Detection

Duplicate detection is expected to combine several signals, including:

- Normalized character name
- Greeting similarity
- Description and other content similarity
- Creator and source metadata
- Tags, lorebook references, and other stable metadata

No single signal should automatically prove identity. In particular, matching names or fingerprints must not blindly merge records. High-confidence deterministic matches may be automated only after policy and test coverage are established; uncertain candidates should require human review.

## Current Integration Boundaries

The demonstrated import workflow uses isolated synthetic fixtures. Janitor public server retrieval remains unavailable without authenticated browser context; the supported fallback is the experimental Character Archive Companion or manual JSON. The extension has a source-neutral observer lifecycle under `browser-extension/core/` and isolated Janitor character/profile adapters; no other source is enabled. Retrieval starts only after an explicit owner action. Character pairing binds one external ID; profile pairing binds one profile UUID and may enumerate at most 100 distinct lightweight listing entries, then retrieve only the user-selected discovered IDs with concurrency two. Each accepted detail becomes its own session-owned immutable `ImportPreviewJob`; the expiring bridge coordinator stores only identifiers, status, and preview-job references. Saucepan, Datacat, Janny persistence, Author-page Retrieve All, live lorebooks, source refresh, and cross-platform duplicate resolution remain future work.
