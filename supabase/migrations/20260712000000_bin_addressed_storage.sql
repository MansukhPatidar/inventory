-- Bin-addressed storage.
-- Every part gets a required {box}-{bin} address. Bins stay shareable, and a
-- bin past a box's bin_count is allowed (flagged in the UI, corrected by hand)
-- because real data already contains such rows.

-- Atomic: the backfill and the constraints that depend on it must land together
-- or not at all. A half-applied migration leaves parts with no bin and a NOT NULL
-- column that rejects every write.
BEGIN;

-- 1. REEL is a location with no boxes row. Its parts are stored loose on reels,
--    which the model treats as an ordinary box named REELS.
UPDATE parts SET location = 'REELS' WHERE location = 'REEL';

-- 2. Safety net: any remaining location without a boxes row gets one, sized to
--    hold its parts. Expected to insert nothing after step 1.
INSERT INTO boxes (id, bin_count, rows, cols)
SELECT p.location, GREATEST(COUNT(*), 1), 1, GREATEST(COUNT(*), 1)
FROM parts p
WHERE p.location IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM boxes b WHERE b.id = p.location)
GROUP BY p.location;

-- 3. Backfill bin_number. Parts with an explicit bin keep it. Parts without one
--    take the lowest bin in their box that nothing else claims, in item_code
--    order. row_number() over the unbinned parts, offset past every claimed bin
--    below it, produces exactly that sequence.
WITH claimed AS (
  SELECT location, bin_number
  FROM parts
  WHERE bin_number IS NOT NULL
  GROUP BY location, bin_number
),
unbinned AS (
  SELECT id, location, row_number() OVER (
    PARTITION BY location ORDER BY item_code
  ) AS seq
  FROM parts
  WHERE bin_number IS NULL
),
candidates AS (
  SELECT
    u.id,
    u.location,
    u.seq,
    -- Walk upward from seq, skipping claimed bins. Adding the count of claimed
    -- bins at-or-below the candidate and repeating until stable is what a
    -- while-loop would do; a generate_series of possible bins with a rank is
    -- the set-based equivalent.
    (
      SELECT b.bin
      FROM generate_series(
        1,
        u.seq + (SELECT COUNT(*) FROM claimed c WHERE c.location = u.location)
      ) AS b(bin)
      WHERE NOT EXISTS (
        SELECT 1 FROM claimed c
        WHERE c.location = u.location AND c.bin_number = b.bin
      )
      ORDER BY b.bin
      OFFSET u.seq - 1
      LIMIT 1
    ) AS assigned_bin
  FROM unbinned u
)
UPDATE parts p
SET bin_number = c.assigned_bin
FROM candidates c
WHERE p.id = c.id;

-- 4. Boxes must be able to name every bin their parts sit in. This raises
--    bin_count only where data already exceeds it; the user re-checks these
--    against the physical boxes afterward.
UPDATE boxes b
SET bin_count = GREATEST(b.bin_count, sub.max_bin)
FROM (
  SELECT location, MAX(bin_number) AS max_bin
  FROM parts
  WHERE location IS NOT NULL
  GROUP BY location
) sub
WHERE b.id = sub.location AND sub.max_bin > b.bin_count;

-- 5. Enforce the model.
ALTER TABLE parts ALTER COLUMN location SET NOT NULL;
ALTER TABLE parts ALTER COLUMN bin_number SET NOT NULL;
ALTER TABLE parts ADD CONSTRAINT parts_location_fkey
  FOREIGN KEY (location) REFERENCES boxes(id);
ALTER TABLE parts ADD CONSTRAINT parts_bin_number_positive
  CHECK (bin_number >= 1);

-- 6. Part-level barcodes are gone. Only box lids and bin compartments carry
--    printed identifiers now.
DROP INDEX IF EXISTS idx_parts_barcode_unique;
DROP INDEX IF EXISTS idx_parts_barcode;
ALTER TABLE parts DROP COLUMN barcode;

COMMIT;
