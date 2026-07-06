PRAGMA foreign_keys=off;

DROP TABLE IF EXISTS members_new;

CREATE TABLE IF NOT EXISTS members_new (
  id TEXT PRIMARY KEY,
  spirit_name TEXT NOT NULL,
  cohort TEXT,
  real_name TEXT,
  phone TEXT,
  wechat TEXT,
  email TEXT,
  province TEXT,
  city TEXT,
  company_title TEXT,
  focus_fields TEXT,
  current_status TEXT,
  self_intro TEXT,
  role TEXT DEFAULT '校友',
  directory_visibility TEXT DEFAULT 'internal',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

INSERT INTO members_new (
  id, spirit_name, cohort, real_name, phone, wechat, email, province, city,
  company_title, focus_fields, current_status, self_intro, role,
  directory_visibility, created_at, updated_at
)
SELECT
  id, spirit_name, cohort, real_name, phone, wechat, email, province, city,
  company_title, focus_fields, current_status, self_intro, role,
  directory_visibility, created_at, updated_at
FROM members;

DROP TABLE members;
ALTER TABLE members_new RENAME TO members;

CREATE UNIQUE INDEX IF NOT EXISTS members_phone_idx ON members(phone);
CREATE INDEX IF NOT EXISTS members_spirit_name_idx ON members(spirit_name);
CREATE INDEX IF NOT EXISTS members_real_name_idx ON members(real_name);
CREATE INDEX IF NOT EXISTS members_cohort_idx ON members(cohort);
CREATE INDEX IF NOT EXISTS members_city_idx ON members(city);

PRAGMA foreign_keys=on;
