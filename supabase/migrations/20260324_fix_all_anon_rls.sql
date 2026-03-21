-- ============================================
-- Fix RLS: Allow anon full access to ALL dashboard tables
-- revenue_data, purchase_data, sales_data 등 기존 누락된 테이블 모두 수정
-- ============================================

DO $$
DECLARE
  tbl TEXT;
BEGIN
  FOR tbl IN SELECT unnest(ARRAY[
    'revenue_data', 'purchase_data', 'sales_data',
    'inventory_data', 'inventory_v2',
    'cr_data', 'rfq_data', 'supplier_data',
    'item_revenue_data', 'ci_kpi_data', 'ci_details', 'ci_uploads'
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
      RAISE NOTICE 'Added anon RLS policy for %', tbl;
    ELSE
      RAISE NOTICE 'Table % does not exist, skipping', tbl;
    END IF;
  END LOOP;
END $$;
