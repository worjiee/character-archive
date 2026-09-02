"use strict";

importScripts(
  "config.js",
  "core/observer-registry.js",
  "observers/janitor.js",
  "core/contract.js",
  "lib/tab-resolver.js",
  "lib/background-controller.js",
);

const config = globalThis.CharacterArchiveCompanionConfig;
const contract = globalThis.CharacterArchiveCompanionContract;
const background = globalThis.CharacterArchiveCompanionBackground;
const tabs = globalThis.CharacterArchiveCompanionTabs.createTabResolver({
  getLastFocusedWindow: (options) => chrome.windows.getLastFocused(options),
  queryTabs: (query) => chrome.tabs.query(query),
  getTabById: (tabId) => chrome.tabs.get(tabId),
});

void chrome.storage.session.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });

const controller = background.createBackgroundController({
  config,
  contract,
  runtimeId: chrome.runtime.id,
  extensionVersion: chrome.runtime.getManifest().version,
  storage: chrome.storage.session,
  fetchImpl: fetch,
  getActiveTab: () => tabs.resolveActive(),
  getBoundTab: (tabId) => tabs.resolveBound(tabId),
  sendTabMessage: (tabId, message) => chrome.tabs.sendMessage(tabId, message),
  hasSiteAccess: (origin) => chrome.permissions.contains({ origins: [`${origin}/*`] }),
  scheduleExpiry: (name, when) => chrome.alarms.create(name, { when }),
  clearExpiry: (name) => chrome.alarms.clear(name),
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  void controller.handleMessage(message, sender).then(sendResponse).catch(() => {
    sendResponse({
      ok: false,
      code: "COMPANION_FAILED",
      phase: "ERROR",
      message: "The companion could not complete this action.",
    });
  });
  return true;
});

chrome.tabs.onRemoved.addListener((tabId) => {
  void controller.handleTabRemoved(tabId);
});

chrome.alarms.onAlarm.addListener((alarm) => {
  void controller.handleExpiryAlarm(alarm.name);
});
