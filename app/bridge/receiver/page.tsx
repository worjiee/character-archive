import type { Metadata } from "next";
import { BridgeReceiver } from "@/components/bridge-receiver";

export const metadata: Metadata = {
  title: "Janitor Bridge Receiver | Character Archive",
  description: "A temporary receiver for an explicitly paired Character Archive import.",
  robots: { index: false, follow: false },
};

export default function BridgeReceiverPage() {
  return (
    <main className="grid min-h-screen place-items-center bg-zinc-950 px-4 py-10">
      <BridgeReceiver />
    </main>
  );
}
