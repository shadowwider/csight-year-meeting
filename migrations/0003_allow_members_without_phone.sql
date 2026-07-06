DROP INDEX IF EXISTS members_phone_idx;
CREATE INDEX IF NOT EXISTS members_phone_idx ON members(phone);
