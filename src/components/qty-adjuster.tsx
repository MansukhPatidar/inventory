"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { adjustQty } from "@/lib/actions";

export function QtyAdjuster({
  partId,
  currentQty,
  onAdjusted,
}: {
  partId: number;
  currentQty: number;
  onAdjusted: (newQty: number) => void;
}) {
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleAdjust(delta: number) {
    setLoading(true);
    try {
      const newQty = await adjustQty(partId, delta, note || undefined);
      setNote("");
      onAdjusted(newQty);
    } catch (e) {
      alert("Failed to adjust quantity: " + (e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={loading || currentQty === 0}
          onClick={() => handleAdjust(-5)}
          className="w-12 font-mono text-destructive hover:text-destructive"
        >
          -5
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={loading || currentQty === 0}
          onClick={() => handleAdjust(-1)}
          className="w-12 font-mono text-destructive hover:text-destructive"
        >
          -1
        </Button>
        <div className="flex-1 text-center">
          <span className="text-3xl font-mono font-bold text-primary">{currentQty}</span>
        </div>
        <Button
          variant="outline"
          size="sm"
          disabled={loading}
          onClick={() => handleAdjust(1)}
          className="w-12 font-mono text-green-400 hover:text-green-400"
        >
          +1
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={loading}
          onClick={() => handleAdjust(5)}
          className="w-12 font-mono text-green-400 hover:text-green-400"
        >
          +5
        </Button>
      </div>
      <div className="space-y-1">
        <Input
          placeholder="Reason for change (optional)..."
          value={note}
          onChange={(e) => setNote(e.target.value)}
          className="text-sm"
        />
        {note && (
          <p className="text-xs text-muted-foreground/60">
            Note will be saved with next qty adjustment
          </p>
        )}
      </div>
    </div>
  );
}
