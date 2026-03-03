-- CR Data: Add year column for multi-year support
-- Run this in Supabase SQL Editor

-- 1. Add year column with default 2025 (existing data gets 2025)
ALTER TABLE cr_data ADD COLUMN IF NOT EXISTS year INTEGER DEFAULT 2025;

-- 2. Ensure existing rows have year=2025
UPDATE cr_data SET year = 2025 WHERE year IS NULL;

-- 3. Make year NOT NULL after backfill
ALTER TABLE cr_data ALTER COLUMN year SET NOT NULL;

-- 4. Add index for year-based queries
CREATE INDEX IF NOT EXISTS idx_cr_year ON cr_data(year);
