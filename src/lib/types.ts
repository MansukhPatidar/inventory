export interface Part {
  id: number;
  barcode: string | null;
  item_code: number;
  item_name: string;
  package: string | null;
  location: string | null;
  details: string | null;
  qty: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface QtyLog {
  id: number;
  part_id: number;
  delta: number;
  qty_after: number;
  note: string | null;
  created_at: string;
}
