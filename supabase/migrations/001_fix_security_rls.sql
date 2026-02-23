-- ============================================
-- Fix Security: Enable RLS + authenticated access
-- Supabase Security Advisor 경고 대응
-- ============================================

DO $$
DECLARE
  tbl TEXT;
BEGIN
  FOR tbl IN SELECT unnest(ARRAY[
    'sales_data', 'revenue_data', 'item_revenue_data',
    'purchase_data', 'inventory_data', 'inventory_v2',
    'cr_data', 'rfq_data', 'supplier_data',
    'purchase_item_master', 'purchase_monthly_summary'
  ])
  LOOP
    -- Enable RLS
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = tbl) THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', tbl);
      -- Create authenticated-only policy
      EXECUTE format(
        'CREATE POLICY "Authenticated access" ON public.%I FOR ALL TO authenticated USING (true) WITH CHECK (true)',
        tbl
      );
    END IF;
  END LOOP;
END $$;
