-- ============================================
-- Add RLS to Forecast tables
-- ============================================

DO $$
DECLARE
  tbl TEXT;
BEGIN
  FOR tbl IN SELECT unnest(ARRAY[
    'forecast_data', 'forecast_summary', 'forecast_uploads'
  ])
  LOOP
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = tbl) THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', tbl);
      EXECUTE format(
        'CREATE POLICY "Authenticated access" ON public.%I FOR ALL TO authenticated USING (true) WITH CHECK (true)',
        tbl
      );
    END IF;
  END LOOP;
END $$;
