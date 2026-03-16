CREATE TABLE boxes (
  id TEXT PRIMARY KEY,
  bin_count INTEGER NOT NULL DEFAULT 20,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE boxes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all on boxes" ON boxes FOR ALL USING (true) WITH CHECK (true);

-- Seed with existing locations and reasonable bin counts
INSERT INTO boxes (id, bin_count) VALUES
  ('B1', 20),
  ('B3', 20),
  ('B4', 20),
  ('B5', 20),
  ('B6', 40),
  ('B7', 30),
  ('B8', 40),
  ('B9', 20),
  ('RED', 15);
