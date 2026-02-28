-- ============================================
-- Standard Material Cost Reference Tables
-- (구매단가, 도료배합비율, 외주사출판매가)
-- Run this SQL in your Supabase SQL Editor
-- ============================================

-- 1. Purchase Price Master (구매단가 ~1,030건)
CREATE TABLE IF NOT EXISTS purchase_price_master (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  item_code TEXT NOT NULL,
  customer_pn TEXT DEFAULT '',
  item_name TEXT DEFAULT '',
  supplier TEXT DEFAULT '',
  current_price NUMERIC DEFAULT 0,
  previous_price NUMERIC DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_purchase_price_item_code ON purchase_price_master(item_code);
CREATE INDEX IF NOT EXISTS idx_purchase_price_customer_pn ON purchase_price_master(customer_pn);

-- 2. Paint Mix Ratio Master (도료배합비율 ~193건)
CREATE TABLE IF NOT EXISTS paint_mix_ratio_master (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  paint_code TEXT NOT NULL,
  paint_name TEXT DEFAULT '',
  main_ratio NUMERIC DEFAULT 100,
  hardener_ratio NUMERIC DEFAULT 0,
  thinner_ratio NUMERIC DEFAULT 0,
  main_code TEXT DEFAULT '',
  hardener_code TEXT DEFAULT '',
  thinner_code TEXT DEFAULT '',
  main_price NUMERIC DEFAULT 0,
  hardener_price NUMERIC DEFAULT 0,
  thinner_price NUMERIC DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_paint_mix_paint_code ON paint_mix_ratio_master(paint_code);
CREATE INDEX IF NOT EXISTS idx_paint_mix_main_code ON paint_mix_ratio_master(main_code);

-- 3. Outsource Injection Price (외주사출판매가 ~345건)
CREATE TABLE IF NOT EXISTS outsource_injection_price (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  item_code TEXT NOT NULL,
  customer_pn TEXT DEFAULT '',
  item_name TEXT DEFAULT '',
  supplier TEXT DEFAULT '',
  injection_price NUMERIC DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_outsource_inj_item_code ON outsource_injection_price(item_code);
CREATE INDEX IF NOT EXISTS idx_outsource_inj_customer_pn ON outsource_injection_price(customer_pn);

-- RLS Policies (anon 읽기/쓰기 허용 - 기존 테이블과 동일)
ALTER TABLE purchase_price_master ENABLE ROW LEVEL SECURITY;
ALTER TABLE paint_mix_ratio_master ENABLE ROW LEVEL SECURITY;
ALTER TABLE outsource_injection_price ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow anon full access on purchase_price_master"
  ON purchase_price_master FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Allow anon full access on paint_mix_ratio_master"
  ON paint_mix_ratio_master FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Allow anon full access on outsource_injection_price"
  ON outsource_injection_price FOR ALL USING (true) WITH CHECK (true);
