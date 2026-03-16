"use client";

import { useEffect, useState, useCallback, useRef, use } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { QtyAdjuster } from "@/components/qty-adjuster";
import { PartForm } from "@/components/part-form";
import { Textarea } from "@/components/ui/textarea";
import { getPartById, getQtyLog, deletePart, updatePart } from "@/lib/actions";
import type { Part, QtyLog } from "@/lib/types";

export default function PartDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();
  const searchParams = useSearchParams();
  const [part, setPart] = useState<Part | null>(null);
  const [logs, setLogs] = useState<QtyLog[]>([]);
  const [editing, setEditing] = useState(searchParams.get("edit") === "1");
  const [loading, setLoading] = useState(true);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [notesValue, setNotesValue] = useState("");
  const [notesSaving, setNotesSaving] = useState(false);
  const notesTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const [partData, logData] = await Promise.all([
        getPartById(parseInt(id)),
        getQtyLog(parseInt(id)),
      ]);
      setPart(partData);
      setNotesValue(partData.notes ?? "");
      setLogs(logData);
    } catch {
      console.error("Failed to fetch part");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  async function handleDelete() {
    setDeleting(true);
    try {
      await deletePart(parseInt(id));
      toast.success(`Deleted "${part?.item_name}"`);
      router.push("/");
    } catch {
      toast.error("Failed to delete part");
      setDeleting(false);
    }
  }

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="h-8 w-48 rounded-lg bg-card animate-pulse" />
        <div className="h-4 w-32 rounded bg-card animate-pulse" />
        <div className="h-24 rounded-xl bg-card animate-pulse" />
      </div>
    );
  }
  if (!part) return <p className="text-destructive">Part not found</p>;

  if (editing) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-bold">Edit Part</h1>
          <Button variant="ghost" size="sm" onClick={() => setEditing(false)}>
            Cancel
          </Button>
        </div>
        <PartForm part={part} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">{part.item_name}</h1>
            {part.barcode && (
              <p className="text-sm text-muted-foreground font-mono mt-1">{part.barcode}</p>
            )}
          </div>
          <div className="flex gap-2 shrink-0">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setEditing(true)}
              className="border-border/50"
            >
              Edit
            </Button>
            <Button variant="destructive" size="sm" onClick={() => setConfirmDelete(true)}>
              Delete
            </Button>
          </div>
        </div>

        <div className="flex gap-2 flex-wrap mt-3">
          {part.location && (
            <Badge className="bg-primary/15 text-primary border-primary/25 hover:bg-primary/20">
              {part.location}
            </Badge>
          )}
          {part.package && (
            <Badge variant="secondary" className="font-mono">
              {part.package}
            </Badge>
          )}
          <Badge variant="outline" className="font-mono border-border/50">
            #{part.item_code}
          </Badge>
        </div>

        {part.details && (
          <p className="text-sm text-muted-foreground mt-3 leading-relaxed">{part.details}</p>
        )}
      </div>

      <Separator className="bg-border/50" />

      <div className="rounded-xl border border-border/50 bg-card p-5">
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-4">
          Qty Available
        </h2>
        <QtyAdjuster
          partId={part.id}
          currentQty={part.qty}
          onAdjusted={(newQty) => {
            setPart({ ...part, qty: newQty });
            getQtyLog(part.id).then(setLogs);
          }}
        />
      </div>

      <div className="rounded-xl border border-border/50 bg-card p-5">
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">
          Notes
        </h2>
        <Textarea
          value={notesValue}
          onChange={(e) => {
            const val = e.target.value;
            setNotesValue(val);
            // Auto-save after 800ms of no typing
            if (notesTimer.current) clearTimeout(notesTimer.current);
            notesTimer.current = setTimeout(async () => {
              setNotesSaving(true);
              try {
                await updatePart(part.id, { notes: val || undefined });
                setPart((prev) => prev ? { ...prev, notes: val } : prev);
              } catch {
                toast.error("Failed to save notes");
              } finally {
                setNotesSaving(false);
              }
            }, 800);
          }}
          placeholder="Add notes about this part..."
          rows={3}
          className="bg-secondary border-border/50 text-sm"
        />
        {notesSaving && (
          <p className="text-xs text-muted-foreground/60 mt-1">Saving...</p>
        )}
      </div>

      <div>
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">
          History
        </h2>
        {logs.length === 0 ? (
          <p className="text-xs text-muted-foreground/60">No changes recorded yet.</p>
        ) : (
          <div className="space-y-1">
            {logs.map((log) => (
              <div
                key={log.id}
                className="flex items-center justify-between py-2 px-3 rounded-lg hover:bg-card transition-colors"
              >
                <div className="flex items-center gap-3">
                  <span
                    className={`font-mono font-semibold text-sm w-10 ${
                      log.delta > 0 ? "text-green-400" : "text-red-400"
                    }`}
                  >
                    {log.delta > 0 ? "+" : ""}
                    {log.delta}
                  </span>
                  <span className="text-sm text-muted-foreground font-mono">
                    {log.qty_after}
                  </span>
                  {log.note && (
                    <span className="text-sm text-muted-foreground/70">
                      {log.note}
                    </span>
                  )}
                </div>
                <time className="text-xs text-muted-foreground/50 font-mono">
                  {new Date(log.created_at).toLocaleDateString()}
                </time>
              </div>
            ))}
          </div>
        )}
      </div>

      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete part?</DialogTitle>
            <DialogDescription>
              This will permanently delete <strong>{part.item_name}</strong>
              {part.barcode && <> ({part.barcode})</>}. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <div className="flex gap-3 justify-end pt-2">
            <Button
              variant="ghost"
              onClick={() => setConfirmDelete(false)}
              disabled={deleting}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={deleting}
            >
              {deleting ? "Deleting..." : "Delete"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
