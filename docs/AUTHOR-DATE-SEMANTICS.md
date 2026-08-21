# Author and character date semantics

The archive currently has no dedicated source-publish or source-created timestamp columns. Author UI must not label internal dates as source upload dates.

| Existing value | Current meaning | Suitable for author UI |
| --- | --- | --- |
| `Character.createdAt` | Time the canonical Character row was created in this repository. | Yes, when labeled as added to the archive. |
| `Character.updatedAt` | Prisma-managed time of the latest canonical Character update, including source refreshes and local management changes. | Yes, when labeled as repository/canonical activity; not source-site activity. |
| `CharacterSource.firstSeenAt` | Time this source record was first persisted in the archive. Persistence sets it only on source creation. | Yes, when labeled first seen/imported. |
| `CharacterSource.lastSyncedAt` | In current persistence code, the time a source import transaction successfully wrote the record. Failed attempts are not stored. | Yes, when labeled synced; it is not currently an attempted-sync timestamp. |
| `CharacterSource.lastSuccessfulSyncAt` | Time the current persistence transaction successfully imported the source. | Yes, when labeled successful sync/archive activity. |
| Janitor `created_at` | Optional source response field retained only in `CharacterSource.rawData`; normalization does not assign it a platform-neutral semantic or persist it separately. | No. |
| Janitor `updated_at` | Optional source response field retained only in `CharacterSource.rawData`; normalization does not persist it separately. | No. |

The Authors library uses the maximum `lastSuccessfulSyncAt`, falling back to `firstSeenAt`, and labels it as archive activity. It does not read or expose `rawData`.
