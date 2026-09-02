(function bootstrapProfilePage(root) {
  "use strict";
  const contract = root.CharacterArchiveCompanionContract;
  const target = contract?.matchPage?.(root.location.href);
  if (target?.targetKind !== "PROFILE" || typeof target.profileId !== "string") return;
  root.CharacterArchiveProfileRetrievalHarness?.createProfileRetrievalHarness?.({ page: root, contract, registry: root.CharacterArchiveActiveAdapterRegistry });
})(globalThis);
