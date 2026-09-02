# Production artifact import (Step 14A)

Character Archive treats the owner extractor as an external, read-only producer. The original file at `C:\Users\Karl\Downloads\jai_profile_extractor-1.3.0.js` is not copied into, imported by, or modified from this repository. Produce an export with that owner-controlled tool, then upload the resulting ZIP on **Add & Manage**. A standalone Character Card V2 PNG can be uploaded through the same control.

## Supported inputs

- Owner extractor ZIPs containing deterministic `NNN_name_shortid` groups, optional `_manifest.json`, and optional `_lorebooks` data.
- PNG Character Cards with a valid PNG structure and a `chara` `tEXt` chunk containing base64 UTF-8 JSON.
- Character Card contract `chara_card_v2`, version `2.0`.
- Existing Manual JSON remains available under Alternative imports.

The ZIP manifest is untrusted summary metadata. Character identity always comes from a validated full source UUID in the card contract. An eight-character filename suffix is only a grouping hint. A card without proven source identity is persisted as source-neutral `OTHER` content with a stable SHA-256 card identity; it is never claimed as Janitor AI.

## Review and save boundary

Upload inspection runs on the server. Every valid character produces one session-owned `ImportPreviewJob` with the existing 15-minute expiry. Invalid entries are isolated so another valid entry can still be reviewed. The browser receives compact previews, warnings, and opaque preview IDs—not raw card payloads.

Validated PNG bytes are prepared under an opaque, session-scoped pending key and bound to the immutable preview snapshot by SHA-256, media type, exact byte length, dimensions, and expiry. **Save selected** consumes each exact reviewed snapshot once. It promotes those already-reviewed bytes to their content-addressed final key; it does not read the ZIP/PNG again and does not contact an upstream source. Saves remain subject to existing duplicate analysis, authoritative moderation, uploader attribution, publication, SourceTag, and visibility rules.

Fallback TXT files are accepted only when the owner extractor's exact partial CCv2 heading and balanced JSON section are present. Reconstructed prose is not guessed into archive fields. Such items are marked `FALLBACK_REVIEW_REQUIRED`; Review & Map creates a new immutable preview only after the importer explicitly maps the canonical fields. An associated validated PNG is carried into that reviewed preview even when it has no CCv2 chunk.

## Security bounds

| Boundary | Limit |
| --- | ---: |
| Compressed upload | 256 MiB |
| Expanded ZIP data | 1 GiB |
| One Character Card PNG | 32 MiB |
| One JSON entry | 2 MiB |
| One fallback TXT | 2 MiB |
| One other supported entry | 2 MiB |
| ZIP entries | 1,000 |
| Character groups | 250 |
| Compression ratio | 200:1 |
| Decoded card JSON | 2 MiB |
| Lorebook entries per book | 5,000 |
| PNG width or height | 16,384 px |

Requests use one raw binary body with a bounded `Content-Length`; multipart buffering is not part of this route. The Next.js proxy buffer is explicitly aligned to the same 256 MiB ceiling, and both the browser request and route publish a five-minute duration bound. ZIP64, multi-disk, encrypted entries, nested archives, duplicate/case-colliding paths, absolute paths, drive paths, backslashes, `.`/`..`, unsupported compression, malformed central directories, invalid CRCs, duplicate `chara` chunks, and malformed base64/UTF-8/JSON are rejected.

The central directory and declared totals are validated before decompression. ZIP entries are then inflated into a pre-sized output bounded by their classified type—at most 32 MiB for PNG and 2 MiB for JSON, TXT, or other supported entries—and consumed individually instead of materializing the full expanded archive. At the exact compressed ceiling, request handling can briefly hold the proxy's bounded 256 MiB clone plus the route's 256 MiB byte buffer, one bounded entry, and normalized preview snapshots that must survive for review. It never adds a simultaneous 1 GiB inflated buffer. Entries remain in memory and are never extracted to filesystem paths.

## Lorebooks and artwork

CCv2 lorebook entries are associated by explicit full lorebook IDs in `extensions.janitorai.lorebook_id`. Multiple books with an entry missing its source ID produce `LOREBOOK_AMBIGUOUS`; the importer does not guess. Valid embedded books use the existing `Lorebook`, `LorebookEntry`, and `CharacterLorebook` models and travel inside the immutable preview snapshot.

Validated PNGs use the provider-neutral `ArtworkObjectStore`. Development stores opaque pending objects and immutable final objects under ignored `.var/artwork/`; neither archive filenames nor Character names enter a storage key. The canonical final key is `artwork/sha256/<digest>.png`, so exact duplicate bytes share one `ArtworkAsset`. Exact PNG bytes are retained without resizing, transcoding, recompression, or metadata stripping.

Upload does not create an `ArtworkAsset`. Ready CCv2 cards and artwork-only fallback reviews first receive private, session-owned preview artwork. Explicit Save verifies the pending bytes, promotes them, upserts metadata, and links the Character inside the existing database transaction. If promotion succeeds but the transaction rolls back, the immutable object is deliberately left as an unreferenced orphan for reference-aware cleanup; a final object is never deleted while its digest has a database reference. Missing or changed pending bytes fail before the database transaction, so no broken relation can be stored. Pending objects expire after 24 hours and upload performs a bounded opportunistic cleanup (50 objects, with bounded directory scans). Failed preparation deletes only keys created by that request.

Presentation uses one precedence rule: local `avatarUrlOverride`, durable uploaded artwork, source `avatarUrl`, then the existing component placeholder. Exact-source re-import preserves an already-linked durable asset; a later import does not silently replace it. `avatarUrl` remains source provenance and existing URL-only records require no backfill.

Final bytes are served through the authenticated Character artwork route after the ordinary Character visibility predicate. Responses are `image/png`, `nosniff`, digest-ETagged, and privately cached as immutable; shared caches cannot reuse one user's authorization result. Pending artwork is `private, no-store` and is available only through its owning session's preview/review route. Raw filesystem and provider keys never reach browser DTOs.

Set `ARTWORK_STORAGE_PROVIDER=local` only for local development. It defaults to local outside production, survives normal development restarts, and may use `ARTWORK_LOCAL_ROOT` to select a controlled absolute development root. Production never falls back to filesystem storage: missing configuration fails closed, and `vercel-blob` is a reserved provider name whose private adapter and direct multipart upload flow must be connected during launch preparation. The current 256 MiB raw request route remains a local-acceptance path and is not a claim of production Vercel upload support.

## Operator notes

- For a mixed batch (20+ entries), review the ready/attention counts and manifest cross-check before selecting items.
- `FALLBACK_REVIEW_REQUIRED` items remain unselected until Review & Map creates a valid preview. `LOREBOOK_AMBIGUOUS` and invalid items remain unselected.
- A failed save is reported per item; other selected previews continue.
- Preview IDs are session-bound. Another user/session cannot inspect or consume them.
- To reclaim abandoned local pending files, run the normal bounded import cleanup opportunistically or remove `.var/artwork/pending-artwork` while the development server is stopped. Final objects require reference-aware database reconciliation and must not be bulk-deleted blindly.
- The browser Companion remains labeled **Experimental — Production development paused**. Step 14A does not remove its retained code or tests and does not resume its development.
