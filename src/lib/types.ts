export interface Part {
  id: number;
  barcode: string | null;
  item_code: number;
  item_name: string;
  package: string | null;
  location: string | null;
  details: string | null;
  qty: number;
  bin_number: number | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface Box {
  id: string;
  bin_count: number;
  rows: number;
  cols: number;
  created_at: string;
}

export interface QtyLog {
  id: number;
  part_id: number;
  delta: number;
  qty_after: number;
  note: string | null;
  created_at: string;
}
