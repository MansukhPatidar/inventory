-- Add bin_number to parts. NULL means auto-assigned sequentially.
-- When set, multiple parts with the same (location, bin_number) share a bin.
ALTER TABLE parts ADD COLUMN bin_number INTEGER;
