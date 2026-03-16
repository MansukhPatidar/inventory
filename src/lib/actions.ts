import { supabase } from "./supabase";
import type { Part, Box } from "./types";

export async function getLocations(): Promise<string[]> {
  const { data, error } = await supabase
    .from("parts")
    .select("location")
    .not("location", "is", null)
    .order("location");
  if (error) throw error;
  const unique = [...new Set(data.map((d) => d.location as string))];
  return unique;
}

export async function getParts(search?: string, location?: string) {
  let query = supabase
    .from("parts")
    .select("*")
    .order("item_code", { ascending: true });

  if (location) {
    query = query.eq("location", location);
  }

  if (search) {
    query = query.or(
      `item_name.ilike.%${search}%,details.ilike.%${search}%,package.ilike.%${search}%,barcode.ilike.%${search}%`
    );
  }

  const { data, error } = await query;
  if (error) throw error;
  return data as Part[];
}

export async function getPartById(id: number) {
  const { data, error } = await supabase
    .from("parts")
    .select("*")
    .eq("id", id)
    .single();
  if (error) throw error;
  return data as Part;
}

export async function getPartByBarcode(barcode: string) {
  const { data, error } = await supabase
    .from("parts")
    .select("*")
    .eq("barcode", barcode)
    .single();
  if (error) return null;
  return data as Part;
}

export async function createPart(
  part: Omit<Part, "id" | "notes" | "created_at" | "updated_at">
) {
  const { data, error } = await supabase
    .from("parts")
    .insert(part)
    .select()
    .single();
  if (error) throw error;
  return data as Part;
}

export async function updatePart(
  id: number,
  updates: Partial<Omit<Part, "id" | "created_at" | "updated_at">>
) {
  const { data, error } = await supabase
    .from("parts")
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return data as Part;
}

export async function deletePart(id: number) {
  const { error } = await supabase.from("parts").delete().eq("id", id);
  if (error) throw error;
}

export async function adjustQty(
  partId: number,
  delta: number,
  note?: string
) {
  const { data: part, error: partError } = await supabase
    .from("parts")
    .select("qty")
    .eq("id", partId)
    .single();
  if (partError) throw partError;

  const newQty = (part.qty || 0) + delta;

  const { error: updateError } = await supabase
    .from("parts")
    .update({ qty: newQty, updated_at: new Date().toISOString() })
    .eq("id", partId);
  if (updateError) throw updateError;

  const { error: logError } = await supabase.from("qty_log").insert({
    part_id: partId,
    delta,
    qty_after: newQty,
    note: note || null,
  });
  if (logError) throw logError;

  return newQty;
}

export async function getQtyLog(partId: number) {
  const { data, error } = await supabase
    .from("qty_log")
    .select("*")
    .eq("part_id", partId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data;
}

export async function getPackages(): Promise<string[]> {
  const { data, error } = await supabase
    .from("parts")
    .select("package")
    .not("package", "is", null)
    .order("package");
  if (error) throw error;
  const unique = [...new Set(data.map((d) => d.package as string))];
  return unique;
}

export async function getNextItemCode() {
  const { data, error } = await supabase
    .from("parts")
    .select("item_code")
    .order("item_code", { ascending: false })
    .limit(1);
  if (error) throw error;
  return data.length > 0 ? data[0].item_code + 1 : 1;
}

export async function importParts(
  parts: {
    barcode?: string;
    item_code: number;
    item_name: string;
    package?: string;
    location?: string;
    details?: string;
    qty?: number;
  }[]
) {
  // Insert in batches to avoid bulk upsert issues
  const results = [];
  for (const p of parts) {
    const row = {
      barcode: p.barcode || null,
      item_code: p.item_code,
      item_name: p.item_name,
      package: p.package || null,
      location: p.location || null,
      details: p.details || null,
      qty: p.qty || 0,
    };

    const { data, error } = await supabase
      .from("parts")
      .upsert(row, { onConflict: "item_code" })
      .select()
      .single();
    if (error) throw new Error(`Row ${p.item_code} (${p.item_name}): ${error.message}`);
    results.push(data);
  }
  return results;
}

export async function getOccupiedBins(
  location: string
): Promise<{ bin_number: number; parts: { id: number; item_name: string }[] }[]> {
  const { data, error } = await supabase
    .from("parts")
    .select("id, item_name, bin_number")
    .eq("location", location)
    .not("bin_number", "is", null)
    .order("bin_number");
  if (error) throw error;

  const binMap = new Map<number, { id: number; item_name: string }[]>();
  for (const row of data) {
    const bn = row.bin_number as number;
    if (!binMap.has(bn)) binMap.set(bn, []);
    binMap.get(bn)!.push({ id: row.id, item_name: row.item_name });
  }

  return Array.from(binMap.entries()).map(([bin_number, parts]) => ({
    bin_number,
    parts,
  }));
}

// --- Boxes ---

export async function getBoxes(): Promise<Box[]> {
  const { data, error } = await supabase
    .from("boxes")
    .select("*")
    .order("id");
  if (error) throw error;
  return data as Box[];
}

export async function getBoxesWithParts(): Promise<{
  boxes: Box[];
  partsByBox: Record<string, Part[]>;
}> {
  const [boxesRes, partsRes] = await Promise.all([
    supabase.from("boxes").select("*").order("id"),
    supabase
      .from("parts")
      .select("*")
      .not("location", "is", null)
      .order("item_code", { ascending: true }),
  ]);
  if (boxesRes.error) throw boxesRes.error;
  if (partsRes.error) throw partsRes.error;

  const partsByBox: Record<string, Part[]> = {};
  for (const part of partsRes.data as Part[]) {
    const loc = part.location!;
    if (!partsByBox[loc]) partsByBox[loc] = [];
    partsByBox[loc].push(part);
  }

  return { boxes: boxesRes.data as Box[], partsByBox };
}

export async function createBox(id: string, bin_count: number): Promise<Box> {
  const { data, error } = await supabase
    .from("boxes")
    .insert({ id, bin_count })
    .select()
    .single();
  if (error) throw error;
  return data as Box;
}

export async function updateBox(id: string, bin_count: number): Promise<Box> {
  const { data, error } = await supabase
    .from("boxes")
    .update({ bin_count })
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return data as Box;
}

export async function deleteBox(id: string): Promise<void> {
  const { error } = await supabase.from("boxes").delete().eq("id", id);
  if (error) throw error;
}
