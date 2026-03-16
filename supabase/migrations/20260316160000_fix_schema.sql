-- Drop old tables
DROP TABLE IF EXISTS qty_log CASCADE;
DROP TABLE IF EXISTS parts CASCADE;
DROP TABLE IF EXISTS boxes CASCADE;

-- Parts table matching spreadsheet: Barcode, Item Code, Item Name, Package, Location, Details, Qty Available
CREATE TABLE parts (
  id SERIAL PRIMARY KEY,
  barcode TEXT UNIQUE,
  item_code INTEGER UNIQUE NOT NULL,
  item_name TEXT NOT NULL,
  package TEXT,
  location TEXT,
  details TEXT,
  qty INTEGER DEFAULT 0,
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

CREATE INDEX idx_parts_barcode ON parts(barcode);
CREATE INDEX idx_parts_location ON parts(location);
CREATE INDEX idx_qty_log_part ON qty_log(part_id);

-- Enable RLS but allow all (single-user app)
ALTER TABLE parts ENABLE ROW LEVEL SECURITY;
ALTER TABLE qty_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all on parts" ON parts FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on qty_log" ON qty_log FOR ALL USING (true) WITH CHECK (true);
