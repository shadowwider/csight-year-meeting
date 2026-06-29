CREATE TABLE IF NOT EXISTS members (
  id TEXT PRIMARY KEY,
  spirit_name TEXT NOT NULL,
  cohort TEXT,
  real_name TEXT,
  phone TEXT NOT NULL,
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

CREATE UNIQUE INDEX IF NOT EXISTS members_phone_idx ON members(phone);
CREATE INDEX IF NOT EXISTS members_spirit_name_idx ON members(spirit_name);
CREATE INDEX IF NOT EXISTS members_real_name_idx ON members(real_name);
CREATE INDEX IF NOT EXISTS members_cohort_idx ON members(cohort);
CREATE INDEX IF NOT EXISTS members_city_idx ON members(city);

CREATE TABLE IF NOT EXISTS verification_tokens (
  token TEXT PRIMARY KEY,
  member_id TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (member_id) REFERENCES members(id)
);

CREATE INDEX IF NOT EXISTS verification_tokens_member_idx ON verification_tokens(member_id);
CREATE INDEX IF NOT EXISTS verification_tokens_expires_idx ON verification_tokens(expires_at);

CREATE TABLE IF NOT EXISTS survey_responses (
  id TEXT PRIMARY KEY,
  campaign_slug TEXT NOT NULL,
  member_id TEXT NOT NULL,
  will_attend TEXT,
  current_status TEXT,
  focus_fields TEXT,
  self_intro TEXT,
  activities_joined TEXT,
  activity_other TEXT,
  memorable_activity TEXT,
  activity_value TEXT,
  activity_improvements TEXT,
  future_activities TEXT,
  future_topics TEXT,
  co_creation_roles TEXT,
  market_interest TEXT,
  market_description TEXT,
  market_types TEXT,
  followup_consent TEXT,
  directory_visibility TEXT,
  message_to_csight TEXT,
  payload TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (member_id) REFERENCES members(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS survey_member_campaign_idx
ON survey_responses(member_id, campaign_slug);
CREATE INDEX IF NOT EXISTS survey_campaign_idx ON survey_responses(campaign_slug);
CREATE INDEX IF NOT EXISTS survey_market_interest_idx ON survey_responses(market_interest);
CREATE INDEX IF NOT EXISTS survey_will_attend_idx ON survey_responses(will_attend);

CREATE TABLE IF NOT EXISTS recovery_requests (
  id TEXT PRIMARY KEY,
  real_name TEXT,
  spirit_name TEXT,
  cohort TEXT,
  phone TEXT,
  old_contact TEXT,
  contact_preference TEXT,
  note TEXT,
  status TEXT DEFAULT 'pending',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS recovery_status_idx ON recovery_requests(status);
CREATE INDEX IF NOT EXISTS recovery_created_idx ON recovery_requests(created_at);
