-- uq_forecast_part_customer에 version 컬럼 포함 (current/previous 공존 가능)
ALTER TABLE forecast_data DROP CONSTRAINT IF EXISTS uq_forecast_part_customer;
CREATE UNIQUE INDEX IF NOT EXISTS uq_forecast_part_customer ON forecast_data (version, part_no, customer);
