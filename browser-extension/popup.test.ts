import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";

type Listener = (event: { preventDefault(): void }) => void | Promise<void>;

describe("Character Archive Companion popup", () => {
  it("classifies an eligible unpaired character before pairing", async () => {
    const harness = popupHarness([notPairedState({
      selectedTargetKind: "CHARACTER",
      message: "Pair this Janitor character to retrieve it.",
    })]);

    await harness.settle();

    expect(harness.elements.pairButton.textContent).toBe("Pair Character");
    expect(harness.elements.pairedActions.hidden).toBe(true);
    expect(harness.elements.sendButton.textContent).toBe("Retrieve this Character");
  });

  it("classifies an eligible unpaired profile before pairing", async () => {
    const harness = popupHarness([notPairedState({
      selectedTargetKind: "PROFILE",
      profileTarget: true,
      message: "Pair this Janitor profile to discover its characters.",
    })]);

    await harness.settle();

    expect(harness.elements.pairButton.textContent).toBe("Pair Profile");
    expect(harness.elements.pairedActions.hidden).toBe(true);
    expect(harness.elements.sendButton.textContent).toBe("Discover profile characters");
    expect(harness.elements.status.textContent).toContain("Pair this Janitor profile");
  });

  it("enables Send immediately after Pair and clearing the pairing input", async () => {
    const harness = popupHarness([
      notPairedState(),
      pairedState(),
    ]);
    await harness.settle();
    harness.elements.code.value = "0101-0101-0101-0101";

    await harness.dispatch("form", "submit");

    expect(harness.elements.code.value).toBe("");
    expect(harness.elements.sendButton.disabled).toBe(false);
    expect(harness.elements.sendButton.textContent).toBe("Retrieve this Character");
    expect(harness.elements.pairedActions.hidden).toBe(false);
    expect(harness.elements.status.textContent).toContain("Paired. Ready to send");
  });

  it("reconstructs Send as enabled when a paired popup is reopened", async () => {
    const harness = popupHarness([pairedState()]);

    await harness.settle();

    expect(harness.messages).toEqual([{ contractVersion: 1, type: "POPUP_GET_STATE" }]);
    expect(harness.elements.sendButton.disabled).toBe(false);
    expect(harness.elements.pairedActions.hidden).toBe(false);
  });

  it("dispatches active retrieval only after the explicit primary action", async () => {
    const harness = popupHarness([pairedState(), { ...pairedState(), phase: "RETRIEVING", sendEnabled: false, retrieveEnabled: false }]);
    await harness.settle();
    expect(harness.messages).toEqual([{ contractVersion: 1, type: "POPUP_GET_STATE" }]);

    await harness.dispatch("sendButton", "click");
    expect(harness.messages).toEqual([
      { contractVersion: 1, type: "POPUP_GET_STATE" },
      { contractVersion: 1, type: "POPUP_RETRIEVE_SELECTED" },
    ]);
    expect(harness.elements.sendButton.textContent).toBe("Retrieving…");
  });

  it("routes the paired profile primary action only to profile discovery", async () => {
    const ready = pairedProfileState();
    const harness = popupHarness([ready, { ...ready, phase: "PROFILE_DISCOVERING", profileDiscoverEnabled: false }]);
    await harness.settle();

    expect(harness.elements.sendButton.textContent).toBe("Discover profile characters");
    expect(harness.elements.sendButton.disabled).toBe(false);
    await harness.dispatch("sendButton", "click");
    expect(harness.messages).toEqual([
      { contractVersion: 1, type: "POPUP_GET_STATE" },
      { contractVersion: 1, type: "POPUP_DISCOVER_PROFILE" },
    ]);
    expect(harness.elements.sendButton.textContent).toBe("Discovering…");
  });

  it("fails closed when a paired state has no explicit target kind", async () => {
    const invalid = { ...pairedState(), pairedTargetKind: null };
    const harness = popupHarness([invalid]);
    await harness.settle();

    expect(harness.elements.sendButton.disabled).toBe(true);
    expect(harness.elements.sendButton.textContent).toBe("Unavailable");
    await harness.dispatch("sendButton", "click");
    expect(harness.messages).toEqual([{ contractVersion: 1, type: "POPUP_GET_STATE" }]);
    expect(harness.elements.status.textContent).toContain("invalid or incompatible");
  });

  it("shows the background reason when the active tab cannot send", async () => {
    const harness = popupHarness([{
      ...pairedState(),
      message: "Paired, but the active tab is not a Janitor character page.",
      sendEnabled: false,
      disabledReason: "JANITOR_CHARACTER_REQUIRED",
    }]);

    await harness.settle();

    expect(harness.elements.sendButton.disabled).toBe(true);
    expect(harness.elements.sendButton.title).toBe("Unavailable: JANITOR_CHARACTER_REQUIRED");
    expect(harness.elements.status.textContent).toContain("not a Janitor character page");
  });

  it("shows an expired capability as disabled", async () => {
    const harness = popupHarness([{
      ...notPairedState(),
      phase: "EXPIRED",
      message: "Pairing expired. Create a new one-time code.",
      disabledReason: "CAPABILITY_EXPIRED",
    }]);

    await harness.settle();

    expect(harness.elements.sendButton.disabled).toBe(true);
    expect(harness.elements.status.textContent).toContain("Pairing expired");
  });

  it("shows a retry action when the content script is unavailable", async () => {
    const reloadRequired = {
      ...pairedState(),
      phase: "PAIRED_PAGE_RELOAD_REQUIRED",
      code: "CONTENT_SCRIPT_UNAVAILABLE",
      message: "Paired, but this tab is not ready. Reload the Janitor character page, then retry.",
      sendEnabled: false,
      retrieveEnabled: false,
      retryEnabled: true,
      disabledReason: "CONTENT_SCRIPT_UNAVAILABLE",
    };
    const harness = popupHarness([reloadRequired, { ...pairedState(), phase: "READY" }]);

    await harness.settle();

    expect(harness.elements.sendButton.disabled).toBe(false);
    expect(harness.elements.sendButton.textContent).toBe("Retry");
    expect(harness.elements.status.textContent).toContain("not ready");

    await harness.dispatch("sendButton", "click");
    expect(harness.messages).toEqual([
      { contractVersion: 1, type: "POPUP_GET_STATE" },
      { contractVersion: 1, type: "POPUP_RETRY_READY" },
    ]);
    expect(harness.elements.sendButton.textContent).toBe("Retrieve this Character");
  });

  it("does not display Waiting when an old bound tab is unavailable", async () => {
    const harness = popupHarness([{
      ...pairedState(),
      phase: "PAIRED",
      message: "Paired. Select the Janitor character tab to continue.",
      sendEnabled: false,
      retrieveEnabled: false,
      retryEnabled: false,
      disabledReason: "BOUND_TAB_UNAVAILABLE",
    }]);

    await harness.settle();

    expect(harness.elements.sendButton.disabled).toBe(true);
    expect(harness.elements.sendButton.textContent).toBe("Retrieve this Character");
    expect(harness.elements.status.textContent).toContain("Select the Janitor character tab");
  });

  it("shows explicit retrieval and preview-creation progress", async () => {
    const pending = popupHarness([{
      ...pairedState(),
      phase: "RETRIEVING",
      message: "Retrieving the selected character in this Janitor tab…",
      sendEnabled: false,
      disabledReason: "CAPTURE_ARMING",
    }]);
    await pending.settle();
    expect(pending.elements.sendButton.textContent).toBe("Retrieving…");

    const armed = popupHarness([{
      ...pairedState(),
      phase: "SENDING",
      message: "Creating the immutable preview…",
      sendEnabled: false,
      disabledReason: "CAPTURE_ARMED",
    }]);
    await armed.settle();
    expect(armed.elements.sendButton.textContent).toBe("Creating preview…");
  });

  it("renders the safe unpacked-mode readiness diagnostics from current background state", async () => {
    const harness = popupHarness([{
      ...pairedProfileState(),
      readinessDiagnostics: {
        extensionVersion: "0.1.5",
        pairedTargetKind: "PROFILE",
        targetId: "00000000-0000-4000-8000-000000000001",
        tabId: 9,
        contentReadyReceived: true,
        contentReadyContractVersion: 1,
        documentFingerprint: "1234abcd",
        documentGeneration: 2,
        documentStatus: "CURRENT",
        lastPingAttemptAt: "2026-09-01T10:00:00.000Z",
        lastPingResult: "PING_OK",
        mainProbeResult: "MAIN_MISSING",
        currentReadinessState: "PAIRED_PAGE_RELOAD_REQUIRED",
        safeError: "MAIN_MISSING",
      },
    }]);

    await harness.settle();

    expect(harness.elements.diagnostics.hidden).toBe(false);
    expect(harness.elements.diagnosticVersion.textContent).toBe("v0.1.5");
    expect(harness.elements.diagnosticTarget.textContent).toContain("PROFILE");
    expect(harness.elements.diagnosticContent.textContent).toBe("READY");
    expect(harness.elements.diagnosticPing.textContent).toBe("PING_OK");
    expect(harness.elements.diagnosticMain.textContent).toBe("MAIN_MISSING");
    expect(harness.elements.diagnosticDocument.textContent).toContain("generation 2");
    expect(harness.elements.diagnosticState.textContent).toBe("RELOAD_REQUIRED");
    expect(harness.elements.diagnosticError.textContent).toBe("MAIN_MISSING");
  });
});

function popupHarness(responses: Array<Record<string, unknown>>) {
  const elements = {
    form: fakeElement(),
    code: fakeElement(),
    pairButton: fakeElement(),
    pairedActions: fakeElement(),
    sendButton: fakeElement(),
    disconnectButton: fakeElement(),
    status: fakeElement(),
    diagnostics: fakeElement(),
    diagnosticVersion: fakeElement(),
    diagnosticTarget: fakeElement(),
    diagnosticContent: fakeElement(),
    diagnosticPing: fakeElement(),
    diagnosticMain: fakeElement(),
    diagnosticDocument: fakeElement(),
    diagnosticState: fakeElement(),
    diagnosticError: fakeElement(),
  };
  const byId: Record<string, ReturnType<typeof fakeElement>> = {
    "pair-form": elements.form,
    "pairing-code": elements.code,
    "pair-button": elements.pairButton,
    "paired-actions": elements.pairedActions,
    "send-button": elements.sendButton,
    "disconnect-button": elements.disconnectButton,
    "readiness-diagnostics": elements.diagnostics,
    "diagnostic-version": elements.diagnosticVersion,
    "diagnostic-target": elements.diagnosticTarget,
    "diagnostic-content": elements.diagnosticContent,
    "diagnostic-ping": elements.diagnosticPing,
    "diagnostic-main": elements.diagnosticMain,
    "diagnostic-document": elements.diagnosticDocument,
    "diagnostic-state": elements.diagnosticState,
    "diagnostic-error": elements.diagnosticError,
    status: elements.status,
  };
  const messages: unknown[] = [];
  const queue = [...responses];
  const sendMessage = vi.fn(async (message: unknown) => {
    messages.push(message);
    return queue.shift() ?? notPairedState();
  });
  const windowListeners = new Map<string, Listener>();
  const context = {
    chrome: { runtime: { sendMessage, getManifest: () => ({ version: "0.1.5" }) } },
    document: { getElementById: (id: string) => byId[id] },
    addEventListener: (type: string, listener: Listener) => windowListeners.set(type, listener),
    setInterval: vi.fn(() => 1),
    clearInterval: vi.fn(),
  };
  Object.assign(context, { globalThis: context });
  runInNewContext(readFileSync(resolve(process.cwd(), "browser-extension/popup.js"), "utf8"), context);

  return {
    elements,
    messages,
    settle: async () => {
      await vi.waitFor(() => expect(sendMessage).toHaveBeenCalled());
      await Promise.resolve();
    },
    dispatch: async (element: keyof Pick<typeof elements, "form" | "sendButton" | "disconnectButton">, type: string) => {
      const listener = elements[element].listeners.get(type);
      if (!listener) throw new Error(`Missing ${type} listener`);
      await listener({ preventDefault: vi.fn() });
    },
  };
}

function fakeElement() {
  return {
    value: "",
    textContent: "",
    title: "",
    hidden: false,
    disabled: false,
    listeners: new Map<string, Listener>(),
    addEventListener(type: string, listener: Listener) {
      this.listeners.set(type, listener);
    },
  };
}

function pairedState() {
  return {
    ok: true,
    paired: true,
    pairedTargetKind: "CHARACTER",
    phase: "PAIRED",
    message: `Paired. Ready to send ${CHARACTER_ID}.`,
    sendEnabled: true,
    retrieveEnabled: true,
    disabledReason: null,
  };
}

function pairedProfileState() {
  return {
    ok: true,
    paired: true,
    pairedTargetKind: "PROFILE",
    phase: "READY",
    message: "Ready to discover characters from this profile.",
    profileTarget: true,
    profileDiscoverEnabled: true,
    selectedTargetKind: "PROFILE",
    sendEnabled: false,
    retrieveEnabled: false,
    disabledReason: null,
  };
}

function notPairedState(overrides: Record<string, unknown> = {}) {
  return {
    ok: true,
    paired: false,
    phase: "NOT_PAIRED",
    message: "Not paired.",
    sendEnabled: false,
    retrieveEnabled: false,
    disabledReason: "NOT_PAIRED",
    ...overrides,
  };
}

const CHARACTER_ID = "d7745ac8-8b75-48ec-aaf9-5699ad547cd7";
