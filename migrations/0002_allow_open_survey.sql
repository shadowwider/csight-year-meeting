PRAGMA foreign_keys=off;

CREATE TABLE IF NOT EXISTS survey_responses_new (
  id TEXT PRIMARY KEY,
  campaign_slug TEXT NOT NULL,
  member_id TEXT,
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

INSERT INTO survey_responses_new (
  id, campaign_slug, member_id,
  will_attend, current_status, focus_fields, self_intro,
  activities_joined, activity_other, memorable_activity, activity_value,
  activity_improvements, future_activities, future_topics, co_creation_roles,
  market_interest, market_description, market_types, followup_consent,
  directory_visibility, message_to_csight, payload, created_at, updated_at
)
SELECT
  id, campaign_slug, member_id,
  will_attend, current_status, focus_fields, self_intro,
  activities_joined, activity_other, memorable_activity, activity_value,
  activity_improvements, future_activities, future_topics, co_creation_roles,
  market_interest, market_description, market_types, followup_consent,
  directory_visibility, message_to_csight, payload, created_at, updated_at
FROM survey_responses;

DROP TABLE survey_responses;
ALTER TABLE survey_responses_new RENAME TO survey_responses;

CREATE UNIQUE INDEX IF NOT EXISTS survey_member_campaign_idx
ON survey_responses(member_id, campaign_slug);
CREATE INDEX IF NOT EXISTS survey_campaign_idx ON survey_responses(campaign_slug);
CREATE INDEX IF NOT EXISTS survey_market_interest_idx ON survey_responses(market_interest);
CREATE INDEX IF NOT EXISTS survey_will_attend_idx ON survey_responses(will_attend);
CREATE INDEX IF NOT EXISTS survey_member_idx ON survey_responses(member_id);

PRAGMA foreign_keys=on;
