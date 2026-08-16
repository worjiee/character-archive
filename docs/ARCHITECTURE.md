# Architecture

## System Overview

Character Archive separates platform-specific data acquisition from the internal repository. This keeps external response shapes and access constraints out of the core data model and UI.

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

The internal repository identity and canonical imported character fields. It stores moderation state, duplicate-detection signals, timestamps, and local display overrides. `Character` is intentionally independent of any single source platform.

### CharacterSource

The identity and provenance of a character on an external platform. It stores platform/external ID uniqueness, creator identity, source URL, sync timestamps, and the complete source raw payload. Multiple sources may belong to one `Character`.

### Greeting

An ordered source greeting associated with both its internal character and originating source. Source order and raw data are retained, while `localPosition` and `hidden` support local presentation changes without rewriting imported content.

### Tag and CharacterTag

`Tag` is a normalized repository-wide tag keyed by slug. `CharacterTag` is the explicit many-to-many join between tags and characters.

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

The demonstrated import workflow uses isolated synthetic fixtures. Janitor parsing, retrieval, normalization, and persistence layers exist, but live automatic importing is not enabled because the observed endpoint requires an authorized browser context unavailable to an ordinary server-side request. Saucepan, Datacat, bulk synchronization, private lorebook retrieval, and cross-platform duplicate resolution remain future work.
