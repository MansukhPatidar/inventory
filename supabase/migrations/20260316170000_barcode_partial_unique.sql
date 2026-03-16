-- Replace plain UNIQUE on barcode with a partial unique index (only non-null values)
ALTER TABLE parts DROP CONSTRAINT IF EXISTS parts_barcode_key;
CREATE UNIQUE INDEX idx_parts_barcode_unique ON parts(barcode) WHERE barcode IS NOT NULL;
