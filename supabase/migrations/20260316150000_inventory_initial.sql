-- Boxes (B1, B3, B4, B5, B6, B7, B8, RED)
CREATE TABLE boxes (
  id TEXT PRIMARY KEY,
  name TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Parts
CREATE TABLE parts (
  id SERIAL PRIMARY KEY,
  item_code INTEGER UNIQUE NOT NULL,
  item_name TEXT NOT NULL,
  package TEXT,
  box_id TEXT REFERENCES boxes(id),
  details TEXT,
  qty INTEGER DEFAULT 0,
  barcode TEXT GENERATED ALWAYS AS (box_id || '-' || item_code) STORED,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Quantity change log
CREATE TABLE qty_log (
  id SERIAL PRIMARY KEY,
  part_id INTEGER REFERENCES parts(id) ON DELETE CASCADE,
  delta INTEGER NOT NULL,
  qty_after INTEGER NOT NULL,
  note TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_parts_box ON parts(box_id);
CREATE INDEX idx_parts_barcode ON parts(barcode);
CREATE INDEX idx_qty_log_part ON qty_log(part_id);

-- Enable RLS but allow all (anon key usage, single-user app)
ALTER TABLE boxes ENABLE ROW LEVEL SECURITY;
ALTER TABLE parts ENABLE ROW LEVEL SECURITY;
ALTER TABLE qty_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all on boxes" ON boxes FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on parts" ON parts FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on qty_log" ON qty_log FOR ALL USING (true) WITH CHECK (true);
