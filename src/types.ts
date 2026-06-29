export interface Env {
  DB: D1Database;
  ASSETS?: Fetcher;
  ADMIN_PASSWORD?: string;
  CAMPAIGN_SLUG?: string;
}

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export interface ApiSuccess<T> {
  ok: true;
  data: T;
}

export interface ApiFailure {
  ok: false;
  error: {
    code: string;
    message: string;
    details?: JsonValue;
  };
}

export type ApiResponse<T> = ApiSuccess<T> | ApiFailure;

export interface MemberRow {
  id: string;
  spirit_name: string;
  cohort: string | null;
  real_name: string | null;
  phone: string;
  wechat: string | null;
  email: string | null;
  province: string | null;
  city: string | null;
  company_title: string | null;
  focus_fields: string | null;
  current_status: string | null;
  self_intro: string | null;
  role: string | null;
  directory_visibility: string | null;
  created_at: string;
  updated_at: string;
}

export interface Member {
  id: string;
  spiritName: string;
  cohort: string | null;
  realName: string | null;
  phone: string;
  wechat: string | null;
  email: string | null;
  province: string | null;
  city: string | null;
  companyTitle: string | null;
  focusFields: string | null;
  currentStatus: string | null;
  selfIntro: string | null;
  role: string | null;
  directoryVisibility: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MemberWriteFields {
  spiritName: string;
  cohort: string | null;
  realName: string | null;
  phone: string;
  wechat: string | null;
  email: string | null;
  province: string | null;
  city: string | null;
  companyTitle: string | null;
  focusFields: string | null;
  currentStatus: string | null;
  selfIntro: string | null;
  role: string | null;
  directoryVisibility: string | null;
}

export interface SurveyResponseRow {
  id: string;
  campaign_slug: string;
  member_id: string;
  will_attend: string | null;
  current_status: string | null;
  focus_fields: string | null;
  self_intro: string | null;
  activities_joined: string | null;
  activity_other: string | null;
  memorable_activity: string | null;
  activity_value: string | null;
  activity_improvements: string | null;
  future_activities: string | null;
  future_topics: string | null;
  co_creation_roles: string | null;
  market_interest: string | null;
  market_description: string | null;
  market_types: string | null;
  followup_consent: string | null;
  directory_visibility: string | null;
  message_to_csight: string | null;
  payload: string;
  created_at: string;
  updated_at: string;
}

export interface SurveyResponse {
  id: string;
  campaignSlug: string;
  memberId: string;
  willAttend: string | null;
  currentStatus: string | null;
  focusFields: string | null;
  selfIntro: string | null;
  activitiesJoined: string | null;
  activityOther: string | null;
  memorableActivity: string | null;
  activityValue: string | null;
  activityImprovements: string | null;
  futureActivities: string | null;
  futureTopics: string | null;
  coCreationRoles: string | null;
  marketInterest: string | null;
  marketDescription: string | null;
  marketTypes: string | null;
  followupConsent: string | null;
  directoryVisibility: string | null;
  messageToCsight: string | null;
  payload: JsonValue;
  createdAt: string;
  updatedAt: string;
}

export interface SurveyResponseWithMember {
  member: Member;
  response: SurveyResponse;
}

export interface SurveyWriteFields {
  willAttend: string | null;
  currentStatus: string | null;
  focusFields: string | null;
  selfIntro: string | null;
  activitiesJoined: string | null;
  activityOther: string | null;
  memorableActivity: string | null;
  activityValue: string | null;
  activityImprovements: string | null;
  futureActivities: string | null;
  futureTopics: string | null;
  coCreationRoles: string | null;
  marketInterest: string | null;
  marketDescription: string | null;
  marketTypes: string | null;
  followupConsent: string | null;
  directoryVisibility: string | null;
  messageToCsight: string | null;
}

export interface RecoveryRequestRow {
  id: string;
  real_name: string | null;
  spirit_name: string | null;
  cohort: string | null;
  phone: string | null;
  old_contact: string | null;
  contact_preference: string | null;
  note: string | null;
  status: string | null;
  created_at: string;
  updated_at: string;
}

export interface RecoveryRequest {
  id: string;
  realName: string | null;
  spiritName: string | null;
  cohort: string | null;
  phone: string | null;
  oldContact: string | null;
  contactPreference: string | null;
  note: string | null;
  status: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RecoveryWriteFields {
  realName: string | null;
  spiritName: string | null;
  cohort: string | null;
  phone: string | null;
  oldContact: string | null;
  contactPreference: string | null;
  note: string | null;
}

export interface ImportMemberRecord extends MemberWriteFields {
  sourceRow: number;
}

export interface ImportIssue {
  row: number;
  message: string;
}

export interface ImportMembersResult {
  imported: number;
  created: number;
  updated: number;
  skipped: number;
  errors: ImportIssue[];
}

export interface AdminStats {
  members: number;
  responses: number;
  attendees: number;
  marketInterested: number;
  recoveryPending: number;
}
