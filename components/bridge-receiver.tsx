"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  createBridgeReceiverController,
  type BridgeReceiverStatus,
} from "@/src/lib/bridge/receiver-client";
import { inspectBridgeReceiverInitialization } from "@/src/lib/bridge/receiver-channel";

const INITIAL_STATUS: BridgeReceiverStatus = {
  kind: "waiting",
  message: "Waiting for Janitor…",
};

export function BridgeReceiver() {
  const [status, setStatus] = useState<BridgeReceiverStatus>(INITIAL_STATUS);
  const [pairingCode, setPairingCode] = useState("");
  const controllerRef = useRef<ReturnType<typeof createBridgeReceiverController> | null>(null);

  useEffect(() => {
    const opener = window.opener;
    const initialization = inspectBridgeReceiverInitialization(window.location.hash, Boolean(opener));
    if (!initialization.ok || !opener) {
      const invalidReceiver = window.setTimeout(() => {
        setStatus({
          kind: "error",
          code: initialization.ok ? "NO_OPENER" : initialization.code,
          message: initialization.ok
            ? "Open this receiver from the Janitor bridge."
            : initialization.message,
        });
      }, 0);
      return () => window.clearTimeout(invalidReceiver);
    }

    let initializationTimer: number | null = null;
    const updateStatus = (nextStatus: BridgeReceiverStatus) => {
      if (nextStatus.kind !== "waiting" && initializationTimer !== null) {
        window.clearTimeout(initializationTimer);
        initializationTimer = null;
      }
      setStatus(nextStatus);
    };
    const controller = createBridgeReceiverController({
      channelNonce: initialization.channelNonce,
      expectedOpener: opener,
      onStatus: updateStatus,
    });
    controllerRef.current = controller;
    const receive = (event: MessageEvent) => {
      void controller.handleMessage(event);
    };
    window.addEventListener("message", receive);
    controller.announce();
    const heartbeat = window.setInterval(() => controller.announce(), 750);
    initializationTimer = window.setTimeout(() => {
      initializationTimer = null;
      setStatus({
        kind: "error",
        code: "INITIALIZATION_TIMEOUT",
        message: "The Janitor bridge did not acknowledge this receiver. Keep both windows open and try again.",
      });
    }, 10_000);
    return () => {
      if (initializationTimer !== null) window.clearTimeout(initializationTimer);
      window.clearInterval(heartbeat);
      window.removeEventListener("message", receive);
      if (controllerRef.current === controller) controllerRef.current = null;
      controller.dispose();
    };
  }, []);

  async function pairReceiver(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const paired = await controllerRef.current?.pair(pairingCode);
    if (paired) setPairingCode("");
  }

  const pairingAvailable = status.kind === "ready" || (
    status.kind === "error" && ["INVALID_PAIRING", "PAIRING_FAILED", "PAIRING_EXPIRED", "PAIRING_ALREADY_USED"].includes(status.code)
  );

  return (
    <section className="w-full max-w-md rounded-2xl border border-white/10 bg-zinc-950/85 p-6 shadow-2xl shadow-black/40">
      <div className="flex items-center gap-3">
        <span aria-hidden="true" className="grid size-10 place-items-center rounded-xl bg-[color:var(--archive-accent)] font-bold text-[color:var(--accent-foreground)]">
          CA
        </span>
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[color:var(--archive-accent)]">
            Character Archive
          </p>
          <h1 className="mt-1 text-xl font-semibold text-zinc-100">Janitor bridge receiver</h1>
        </div>
      </div>

      <div className="mt-6 rounded-xl border border-white/10 bg-zinc-900/70 p-4" aria-live="polite">
        <div className="flex items-start gap-3">
          <span
            aria-hidden="true"
            className={`mt-1 size-2.5 shrink-0 rounded-full ${statusDot(status.kind)}`}
          />
          <div>
            <p className="text-sm font-medium text-zinc-100">{statusTitle(status.kind)}</p>
            <p className="mt-1 text-sm leading-6 text-zinc-400">{status.message}</p>
            {status.kind === "error" && (
              <p className="mt-2 font-mono text-xs text-red-300">Reason: {status.code}</p>
            )}
          </div>
        </div>
      </div>

      {(status.kind === "waiting" || status.kind === "ready" || status.kind === "pairing" || pairingAvailable) && (
        <form className="mt-4 space-y-3" onSubmit={(event) => void pairReceiver(event)}>
          <label htmlFor="bridge-pairing-code" className="block text-xs font-medium uppercase tracking-wider text-zinc-400">
            One-time pairing code
          </label>
          <input
            id="bridge-pairing-code"
            value={pairingCode}
            onChange={(event) => setPairingCode(event.target.value)}
            disabled={!pairingAvailable}
            autoComplete="off"
            inputMode="text"
            placeholder="0000-0000-0000-0000"
            className="archive-focus w-full rounded-lg border border-white/10 bg-zinc-950 px-3 py-2.5 font-mono text-sm tracking-wider text-zinc-100 placeholder:text-zinc-700 disabled:cursor-not-allowed disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={!pairingAvailable || !pairingCode.trim()}
            className="archive-button-primary archive-focus w-full text-sm disabled:cursor-not-allowed disabled:opacity-50"
          >
            {status.kind === "pairing" ? "Pairing…" : "Pair receiver"}
          </button>
        </form>
      )}

      {status.kind === "error" && !pairingAvailable && (
        <button
          type="button"
          onClick={() => window.close()}
          className="archive-focus mt-4 w-full rounded-lg border border-white/10 px-3 py-2.5 text-sm text-zinc-300 hover:bg-white/5"
        >
          Close
        </button>
      )}

      <p className="mt-4 text-xs leading-5 text-zinc-500">
        This window receives one selected character. It never receives Janitor cookies, credentials, or session data.
      </p>
    </section>
  );
}

function statusTitle(kind: BridgeReceiverStatus["kind"]): string {
  if (kind === "ready") return "Ready";
  if (kind === "pairing") return "Pairing";
  if (kind === "paired") return "Paired";
  if (kind === "receiving") return "Receiving";
  if (kind === "success") return "Received successfully";
  if (kind === "error") return "Bridge error";
  return "Waiting for Janitor";
}

function statusDot(kind: BridgeReceiverStatus["kind"]): string {
  if (kind === "success" || kind === "paired") return "bg-emerald-400";
  if (kind === "error") return "bg-red-400";
  if (kind === "pairing" || kind === "receiving") return "animate-pulse bg-amber-300";
  return "bg-zinc-500";
}
