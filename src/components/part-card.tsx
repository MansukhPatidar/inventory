"use client";

import { useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { deletePart } from "@/lib/actions";
import type { Part } from "@/lib/types";

export function PartCard({
  part,
  onDeleted,
}: {
  part: Part;
  onDeleted?: () => void;
}) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function handleDelete() {
    setDeleting(true);
    try {
      await deletePart(part.id);
      toast.success(`Deleted "${part.item_name}"`);
      setConfirmOpen(false);
      onDeleted?.();
    } catch {
      toast.error("Failed to delete part");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <>
      <div className="group flex items-center justify-between p-4 rounded-xl border border-border/50 bg-card hover:bg-accent hover:border-border transition-all">
        <Link
          href={`/parts?id=${part.id}`}
          className="min-w-0 flex-1"
        >
          <div className="flex items-center gap-2 mb-1">
            <span className="font-medium text-card-foreground group-hover:text-primary transition-colors truncate">
              {part.item_name}
            </span>
            {part.package && (
              <Badge variant="secondary" className="text-[11px] shrink-0 font-mono">
                {part.package}
              </Badge>
            )}
          </div>
          <div className="text-xs text-muted-foreground truncate font-mono">
            {part.barcode && <span>{part.barcode}</span>}
            {part.location && (
              <span className="font-sans ml-2 text-primary/70">
                {part.location}
                {part.bin_number != null && (
                  <span className="text-muted-foreground/70"> bin {part.bin_number}</span>
                )}
              </span>
            )}
            {part.details && (
              <span className="font-sans ml-2 text-muted-foreground/70">
                {part.details}
              </span>
            )}
          </div>
        </Link>
        <div className="flex items-center gap-2 shrink-0 ml-4">
          <span
            className={`text-lg font-mono font-semibold ${
              part.qty === 0
                ? "text-destructive"
                : part.qty <= 3
                ? "text-amber-400"
                : "text-primary"
            }`}
          >
            {part.qty}
          </span>
          <Link
            href={`/parts?id=${part.id}&edit=1`}
            className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-primary transition-all p-1"
            title="Edit"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z" />
              <path d="m15 5 4 4" />
            </svg>
          </Link>
          <button
            onClick={(e) => {
              e.preventDefault();
              setConfirmOpen(true);
            }}
            className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-all p-1"
            title="Delete"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M3 6h18" />
              <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
              <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
              <line x1="10" x2="10" y1="11" y2="17" />
              <line x1="14" x2="14" y1="11" y2="17" />
            </svg>
          </button>
        </div>
      </div>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
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
              onClick={() => setConfirmOpen(false)}
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
    </>
  );
}
