(function configureCharacterArchiveCompanion(root) {
  "use strict";

  // This destination is owner-controlled extension configuration. Page content
  // cannot override it. Add future staging/production origins explicitly to the
  // manifest host_permissions before changing this value.
  root.CharacterArchiveCompanionConfig = Object.freeze({
    archiveOrigin: "http://localhost:3000",
    bridgeVersion: 1,
    operation: "CHARACTER_IMPORT",
    payloadType: "CHARACTER",
  });
})(globalThis);
