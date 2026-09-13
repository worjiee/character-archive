"use client";

import { useEffect } from "react";
import { recordView } from "../src/lib/history/client-tracker";

export function RecordViewTrigger({ characterId }: { characterId: string }) {
  useEffect(() => {
    recordView(characterId);
  }, [characterId]);

  return null;
}