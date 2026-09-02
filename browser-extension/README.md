# Character Archive Companion

This experimental unpacked Manifest V3 extension has a source-neutral acquisition core and Janitor AI browser-local adapters. It transports either one explicitly selected character or a bounded selection discovered from one exactly paired Janitor profile. Character Archive remains authoritative for source validation, normalization, duplicate analysis, moderation, and explicit persistence.

## Local installation

1. Start Character Archive at `http://localhost:3000`.
2. Open `chrome://extensions` in Chrome.
3. Enable **Developer mode**.
4. Select **Load unpacked**.
5. Choose this `browser-extension/` directory.
6. Copy the extension ID shown by Chrome.
7. Set the ignored local Archive environment variable to the exact origin:

   ```text
   BRIDGE_EXTENSION_ORIGINS=chrome-extension://<extension-id>
   ```

8. Restart the Archive server after changing the environment.

After changing extension files, reload the unpacked extension first and then reload the open Janitor character page. Chrome does not retroactively install updated declarative content scripts into a page that was already open. If the popup reports missing site access, use the extension's Chrome site-access control to allow `janitorai.com`, then reload the character page.

The development Archive destination is fixed in `config.js` and declared in `manifest.json`. Add a staging or production host to both files explicitly before using a different Archive; never use a wildcard host.

## One-character workflow

1. Open Character Archive `/import` and select **Pair Companion**.
2. Open one Janitor character normally.
3. Open the extension popup, enter the one-time code, and select **Pair**.
4. Select **Retrieve this Character**. Pairing, READY, popup open, and page reload never trigger retrieval by themselves.
5. Return to Character Archive when the popup reports success. Active retrieval does not require a page reload.
6. Select **Preview** and review the result. Saving remains a separate explicit owner action and does not retrieve from Janitor again.

## Bounded profile workflow

1. Enter an exact `https://janitorai.com/profiles/<UUID>_profile-of-<slug>` URL (or the compatible UUID-only form) in Character Archive and create a Companion pairing.
2. Pair from that exact profile tab. Pairing and popup opening do not enumerate the profile.
3. Select **Discover profile characters** in the popup. Discovery requests listing pages sequentially and returns at most 100 distinct lightweight entries; it does not retrieve details.
4. Select discovered entries in Character Archive, send the selection, then explicitly select **Retrieve selected** in the popup.
5. Two browser-local workers retrieve only discovered selected IDs. Closing the popup does not stop the service-worker operation; reopen it to see safe progress or cancel.
6. Review independent immutable previews in Character Archive and explicitly **Save selected**. Every save is isolated and performs no second Janitor request.

## Security boundary

- Before **Retrieve this Character**, no active Janitor request occurs. The explicit command is bound to one operation nonce, the paired tab, and the immutable character target.
- Generic lifecycle, message, nonce, target-binding, size, and transport checks live under `core/`. Exact endpoint construction, ephemeral page-local authentication, response classification, and source preflight live only in `adapters/janitor-active.js`.
- The isolated content script validates the versioned, exact-field capture contract before forwarding it.
- The service worker alone stores the short-lived Archive capability in `chrome.storage.session` and chooses the fixed Archive destination.
- The active adapter constructs only `https://janitorai.com/hampter/characters/<paired UUID>`. Any Janitor authentication material is used ephemerally inside the Janitor MAIN page context; it is never posted across extension contexts, written to extension storage, logged, or sent to Character Archive.
- The passive observer remains available for diagnostics and contract observation, but the normal single-character workflow does not ARM, reload, or wait for passive traffic.
- Receipt creates the same session-owned immutable `ImportPreviewJob` used by other import methods. `BridgeJob` is transport/status only and retains no saveable raw payload. Repository persistence still requires explicit Save inside the authenticated Archive.
- Profile coordination retains only expiring target, discovery, selection/status, and preview-job references. Full character snapshots remain exclusively in their individual `ImportPreviewJob` records.

The older Tampermonkey userscript is retained only as development/experimental evidence and is not the supported transport.
