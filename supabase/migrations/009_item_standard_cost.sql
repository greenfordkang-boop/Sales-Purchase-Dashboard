-- item_standard_cost: per-item standard costs from 품목별재료비 sheet
-- Pre-computed costs validated against Excel formulas
CREATE TABLE IF NOT EXISTS item_standard_cost (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  item_code TEXT NOT NULL,
  customer_pn TEXT DEFAULT '',
  item_name TEXT DEFAULT '',
  customer_name TEXT DEFAULT '',
  variety TEXT DEFAULT '',
  item_type TEXT DEFAULT '',
  supply_type TEXT DEFAULT '',
  resin_cost_per_ea NUMERIC DEFAULT 0,
  paint_cost_per_ea NUMERIC DEFAULT 0,
  material_cost_per_ea NUMERIC DEFAULT 0,
  purchase_price_per_ea NUMERIC DEFAULT 0,
  injection_price_per_ea NUMERIC DEFAULT 0,
  jan_qty NUMERIC DEFAULT 0, feb_qty NUMERIC DEFAULT 0, mar_qty NUMERIC DEFAULT 0,
  apr_qty NUMERIC DEFAULT 0, may_qty NUMERIC DEFAULT 0, jun_qty NUMERIC DEFAULT 0,
  jul_qty NUMERIC DEFAULT 0, aug_qty NUMERIC DEFAULT 0, sep_qty NUMERIC DEFAULT 0,
  oct_qty NUMERIC DEFAULT 0, nov_qty NUMERIC DEFAULT 0, dec_qty NUMERIC DEFAULT 0,
  jan_amt NUMERIC DEFAULT 0, feb_amt NUMERIC DEFAULT 0, mar_amt NUMERIC DEFAULT 0,
  apr_amt NUMERIC DEFAULT 0, may_amt NUMERIC DEFAULT 0, jun_amt NUMERIC DEFAULT 0,
  jul_amt NUMERIC DEFAULT 0, aug_amt NUMERIC DEFAULT 0, sep_amt NUMERIC DEFAULT 0,
  oct_amt NUMERIC DEFAULT 0, nov_amt NUMERIC DEFAULT 0, dec_amt NUMERIC DEFAULT 0,
  total_qty NUMERIC DEFAULT 0,
  total_amt NUMERIC DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE item_standard_cost ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow anon full access on item_standard_cost"
  ON item_standard_cost FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE INDEX idx_item_standard_cost_item_code ON item_standard_cost(item_code);
CREATE INDEX idx_item_standard_cost_supply_type ON item_standard_cost(supply_type);
