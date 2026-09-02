(function bootstrapCharacterArchivePageObserver(root) {
  "use strict";

  const harness = root.CharacterArchiveObserverHarness;
  const activeHarness = root.CharacterArchiveActiveRetrievalHarness;
  const contract = root.CharacterArchiveCompanionContract;
  const registry = root.CharacterArchiveObserverRegistry;
  const activeRegistry = root.CharacterArchiveActiveAdapterRegistry;
  if (!contract || !registry) {
    root.console?.debug?.("[Character Archive Companion]", {
      event: "OBSERVER_INITIALIZATION_FAILED",
      code: "SOURCE_CONTRACT_CHANGED",
    });
    return;
  }

  const selected = contract.matchPage?.(root.location.href);
  if (selected?.targetKind !== "CHARACTER" || typeof selected.externalId !== "string") return;

  if (harness && typeof harness.createObserverHarness === "function") {
    harness.createObserverHarness({ page: root, contract, registry });
  }
  if (activeHarness && typeof activeHarness.createActiveRetrievalHarness === "function" && activeRegistry) {
    activeHarness.createActiveRetrievalHarness({ page: root, contract, registry: activeRegistry });
  }
})(globalThis);
