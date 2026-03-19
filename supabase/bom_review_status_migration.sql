-- BOM Review Status: 체크박스 상태를 Supabase에 공유 저장
CREATE TABLE IF NOT EXISTS bom_review_status (
  item_code TEXT PRIMARY KEY,
  production BOOLEAN DEFAULT FALSE,
  development BOOLEAN DEFAULT FALSE,
  sales BOOLEAN DEFAULT FALSE,
  purchase BOOLEAN DEFAULT FALSE,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE bom_review_status ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all" ON bom_review_status FOR ALL USING (true);
