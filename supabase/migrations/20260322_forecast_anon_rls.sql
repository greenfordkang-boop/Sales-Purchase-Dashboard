-- forecast 테이블에 anon 전체 접근 허용 (기존 authenticated만 있었음)
DO $$
DECLARE
  tbl TEXT;
BEGIN
  FOR tbl IN SELECT unnest(ARRAY[
    'forecast_data', 'forecast_summary', 'forecast_uploads'
  ])
  LOOP
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = tbl) THEN
      EXECUTE format(
        'DROP POLICY IF EXISTS "Allow anon full access on %I" ON public.%I', tbl, tbl
      );
      EXECUTE format(
        'CREATE POLICY "Allow anon full access on %I" ON public.%I FOR ALL TO anon USING (true) WITH CHECK (true)',
        tbl, tbl
      );
    END IF;
  END LOOP;
END $$;

-- no 컬럼을 integer → numeric 변경 (소수점 값 수용)
ALTER TABLE forecast_data ALTER COLUMN no TYPE NUMERIC USING no::NUMERIC;
