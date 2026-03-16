"use client";

import { useEffect, useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { BoxGrid } from "@/components/box-grid";
import {
  getBoxesWithParts,
  createBox,
  updateBox,
  deleteBox,
} from "@/lib/actions";
import type { Box, Part } from "@/lib/types";

export default function StoragePage() {
  const [boxes, setBoxes] = useState<Box[]>([]);
  const [partsByBox, setPartsByBox] = useState<Record<string, Part[]>>({});
  const [loading, setLoading] = useState(true);

  const [formOpen, setFormOpen] = useState(false);
  const [editingBox, setEditingBox] = useState<Box | null>(null);
  const [formId, setFormId] = useState("");
  const [formBins, setFormBins] = useState(20);
  const [formSaving, setFormSaving] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState<Box | null>(null);
  const [deleting, setDeleting] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      const data = await getBoxesWithParts();
      setBoxes(data.boxes);
      setPartsByBox(data.partsByBox);
    } catch {
      console.error("Failed to fetch storage data");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  function openCreate() {
    setEditingBox(null);
    setFormId("");
    setFormBins(20);
    setFormOpen(true);
  }

  function openEdit(box: Box) {
    setEditingBox(box);
    setFormId(box.id);
    setFormBins(box.bin_count);
    setFormOpen(true);
  }

  async function handleSave() {
    if (!formId.trim()) return;
    setFormSaving(true);
    try {
      if (editingBox) {
        await updateBox(editingBox.id, formBins);
        toast.success(`Updated ${editingBox.id}`);
      } else {
        await createBox(formId.trim().toUpperCase(), formBins);
        toast.success(`Created ${formId.trim().toUpperCase()}`);
      }
      setFormOpen(false);
      fetchData();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setFormSaving(false);
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await deleteBox(deleteTarget.id);
      toast.success(`Deleted ${deleteTarget.id}`);
      setDeleteTarget(null);
      fetchData();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Storage</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {loading
              ? "Loading..."
              : `${boxes.length} boxes`}
          </p>
        </div>
        <Button size="sm" onClick={openCreate}>
          + Add Box
        </Button>
      </div>

      {loading ? (
        <div className="space-y-4">
          {[...Array(3)].map((_, i) => (
            <div
              key={i}
              className="h-48 rounded-xl bg-card animate-pulse"
            />
          ))}
        </div>
      ) : boxes.length === 0 ? (
        <div className="text-center py-16">
          <p className="text-muted-foreground">No boxes configured</p>
          <p className="text-xs text-muted-foreground/60 mt-1">
            Add a box to start organizing your storage
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {boxes.map((box) => (
            <BoxGrid
              key={box.id}
              box={box}
              parts={partsByBox[box.id] || []}
              onEdit={() => openEdit(box)}
            />
          ))}
        </div>
      )}

      {/* Create / Edit dialog */}
      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {editingBox ? `Edit ${editingBox.id}` : "Add Box"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div className="space-y-2">
              <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                Box ID
              </Label>
              <Input
                value={formId}
                onChange={(e) => setFormId(e.target.value)}
                placeholder="B1, RED, SHELF-A..."
                disabled={!!editingBox}
                className="font-mono bg-secondary border-border/50"
                autoFocus={!editingBox}
              />
            </div>
            <div className="space-y-2">
              <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                Bin Count
              </Label>
              <Input
                type="number"
                value={formBins}
                onChange={(e) =>
                  setFormBins(parseInt(e.target.value) || 0)
                }
                className="font-mono bg-secondary border-border/50"
                autoFocus={!!editingBox}
              />
            </div>
            <div className="flex gap-3 justify-end pt-2">
              {editingBox && (
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => {
                    setFormOpen(false);
                    setDeleteTarget(editingBox);
                  }}
                  className="mr-auto"
                >
                  Delete
                </Button>
              )}
              <Button
                variant="ghost"
                onClick={() => setFormOpen(false)}
              >
                Cancel
              </Button>
              <Button
                onClick={handleSave}
                disabled={formSaving || !formId.trim()}
              >
                {formSaving
                  ? "Saving..."
                  : editingBox
                  ? "Update"
                  : "Create"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <Dialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete box?</DialogTitle>
            <DialogDescription>
              This will delete <strong>{deleteTarget?.id}</strong>. Parts
              assigned to this box will keep their location but the box
              definition will be removed.
            </DialogDescription>
          </DialogHeader>
          <div className="flex gap-3 justify-end pt-2">
            <Button
              variant="ghost"
              onClick={() => setDeleteTarget(null)}
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
