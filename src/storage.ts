import type {
  AdminStats,
  ImportMemberRecord,
  ImportMembersResult,
  JsonValue,
  Member,
  MemberRow,
  MemberWriteFields,
  RecoveryRequest,
  RecoveryRequestRow,
  RecoveryWriteFields,
  SurveyResponse,
  SurveyResponseRow,
  SurveyResponseWithMember,
  SurveyWriteFields,
} from "./types";

type D1BindingValue = string | number | null;
type MemberWriteKey = keyof MemberWriteFields;
type SurveyWriteKey = keyof SurveyWriteFields;

const TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const MEMBER_COLUMN_BY_KEY: Record<MemberWriteKey, string> = {
  spiritName: "spirit_name",
  cohort: "cohort",
  realName: "real_name",
  phone: "phone",
  wechat: "wechat",
  email: "email",
  province: "province",
  city: "city",
  companyTitle: "company_title",
  focusFields: "focus_fields",
  currentStatus: "current_status",
  selfIntro: "self_intro",
  role: "role",
  directoryVisibility: "directory_visibility",
};

const SURVEY_COLUMN_BY_KEY: Record<SurveyWriteKey, string> = {
  willAttend: "will_attend",
  currentStatus: "current_status",
  focusFields: "focus_fields",
  selfIntro: "self_intro",
  activitiesJoined: "activities_joined",
  activityOther: "activity_other",
  memorableActivity: "memorable_activity",
  activityValue: "activity_value",
  activityImprovements: "activity_improvements",
  futureActivities: "future_activities",
  futureTopics: "future_topics",
  coCreationRoles: "co_creation_roles",
  marketInterest: "market_interest",
  marketDescription: "market_description",
  marketTypes: "market_types",
  followupConsent: "followup_consent",
  directoryVisibility: "directory_visibility",
  messageToCsight: "message_to_csight",
};

export class DuplicatePhoneError extends Error {
  constructor() {
    super("手机号已被其他成员使用");
    this.name = "DuplicatePhoneError";
  }
}

export class NotFoundError extends Error {
  constructor(message = "记录不存在") {
    super(message);
    this.name = "NotFoundError";
  }
}

export function campaignSlug(envSlug: string | undefined): string {
  return envSlug?.trim() || "csight-passion-2026";
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function normalizeText(value: unknown): string {
  return String(value ?? "").trim();
}

export function normalizePhone(value: unknown): string {
  const stripped = normalizeText(value).replace(/[\s\-()（）]/g, "");
  if (stripped.startsWith("+86")) {
    return stripped.slice(3);
  }
  if (stripped.startsWith("86") && stripped.length === 13) {
    return stripped.slice(2);
  }
  return stripped;
}

export function normalizeCohort(value: unknown): string {
  const text = normalizeText(value).replace(/\s+/g, "");
  if (!text || ["不知道", "不记得", "不确定"].includes(text)) {
    return "";
  }
  const digits = text.match(/\d+/)?.[0];
  if (digits) {
    return String(Number(digits));
  }
  return text.replace(/^第/, "").replace(/期$/, "");
}

export function textOrNull(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (Array.isArray(value)) {
    const joined = value.map((item) => normalizeText(item)).filter(Boolean).join("、");
    return joined || null;
  }
  if (typeof value === "object") {
    return JSON.stringify(value);
  }
  const text = normalizeText(value);
  return text === "" ? null : text;
}

export async function findVerifiedMember(
  db: D1Database,
  input: { name: string; phone: string; cohort?: string | null },
): Promise<Member | null> {
  const phone = normalizePhone(input.phone);
  const name = normalizeComparable(input.name);
  const cohort = normalizeCohort(input.cohort);

  if (!phone || !name) {
    return null;
  }

  const result = await db
    .prepare(
      `SELECT *
       FROM members
       WHERE phone = ?
          OR REPLACE(REPLACE(REPLACE(REPLACE(phone, ' ', ''), '-', ''), '(', ''), ')', '') = ?
       LIMIT 10`,
    )
    .bind(phone, phone)
    .all<MemberRow>();

  for (const row of result.results ?? []) {
    const spiritName = normalizeComparable(row.spirit_name);
    const realName = normalizeComparable(row.real_name);
    const candidateCohort = normalizeCohort(row.cohort);
    const nameMatches = name === spiritName || (realName !== "" && name === realName);
    const cohortMatches = cohort === "" || candidateCohort === "" || cohort === candidateCohort;

    if (nameMatches && cohortMatches) {
      return mapMember(row);
    }
  }

  return null;
}

export async function findMemberCandidates(
  db: D1Database,
  input: { spiritName?: string | null; realName?: string | null; phone?: string | null; wechat?: string | null; email?: string | null },
): Promise<Member[]> {
  const spiritName = normalizeComparable(input.spiritName);
  const realName = normalizeComparable(input.realName);
  const phone = normalizePhone(input.phone);
  const wechat = normalizeText(input.wechat);
  const email = normalizeText(input.email).toLowerCase();
  const candidates: Member[] = [];
  const seen = new Set<string>();

  if (!spiritName && !realName && !phone && !wechat && !email) {
    return [];
  }

  const result = await db
    .prepare(
      `SELECT *
       FROM members
       WHERE (? <> '' AND LOWER(REPLACE(spirit_name, ' ', '')) = ?)
          OR (? <> '' AND LOWER(REPLACE(COALESCE(real_name, ''), ' ', '')) = ?)
          OR (? <> '' AND REPLACE(REPLACE(REPLACE(REPLACE(phone, ' ', ''), '-', ''), '(', ''), ')', '') = ?)
          OR (? <> '' AND COALESCE(wechat, '') = ?)
          OR (? <> '' AND LOWER(COALESCE(email, '')) = ?)
       ORDER BY cohort, spirit_name
       LIMIT 20`,
    )
    .bind(spiritName, spiritName, realName, realName, phone, phone, wechat, wechat, email, email)
    .all<MemberRow>();

  for (const row of result.results ?? []) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    candidates.push(mapMember(row));
  }

  return candidates;
}

export async function createVerificationToken(
  db: D1Database,
  memberId: string,
  issuedAt: string,
): Promise<{ token: string; expiresAt: string }> {
  const token = randomToken();
  const expiresAt = new Date(Date.parse(issuedAt) + TOKEN_TTL_MS).toISOString();

  await db.prepare("DELETE FROM verification_tokens WHERE expires_at <= ?").bind(issuedAt).run();
  await db
    .prepare(
      `INSERT INTO verification_tokens (token, member_id, expires_at, created_at)
       VALUES (?, ?, ?, ?)`,
    )
    .bind(token, memberId, expiresAt, issuedAt)
    .run();

  return { token, expiresAt };
}

export async function getMemberByToken(
  db: D1Database,
  token: string,
  checkedAt: string,
): Promise<Member | null> {
  const row = await db
    .prepare(
      `SELECT m.*
       FROM verification_tokens t
       JOIN members m ON m.id = t.member_id
       WHERE t.token = ? AND t.expires_at > ?
       LIMIT 1`,
    )
    .bind(token, checkedAt)
    .first<MemberRow>();

  return row ? mapMember(row) : null;
}

export async function getSurveyByMember(
  db: D1Database,
  memberId: string,
  slug: string,
): Promise<SurveyResponse | null> {
  const row = await db
    .prepare(
      `SELECT *
       FROM survey_responses
       WHERE member_id = ? AND campaign_slug = ?
       LIMIT 1`,
    )
    .bind(memberId, slug)
    .first<SurveyResponseRow>();

  return row ? mapSurvey(row) : null;
}

export async function updateMember(
  db: D1Database,
  memberId: string,
  fields: Partial<MemberWriteFields>,
  updatedAt: string,
): Promise<Member> {
  const normalizedFields = await prepareMemberUpdateFields(db, memberId, fields);
  const entries = Object.entries(normalizedFields) as Array<[MemberWriteKey, string | null]>;

  if (entries.length > 0) {
    const assignments = entries.map(([key]) => `${MEMBER_COLUMN_BY_KEY[key]} = ?`);
    const values = entries.map(([, value]) => value);
    await db
      .prepare(`UPDATE members SET ${assignments.join(", ")}, updated_at = ? WHERE id = ?`)
      .bind(...values, updatedAt, memberId)
      .run();
  }

  const member = await getMemberById(db, memberId);
  if (!member) {
    throw new NotFoundError("成员不存在");
  }
  return member;
}

export async function createMember(
  db: D1Database,
  fields: MemberWriteFields,
  createdAt: string,
): Promise<Member> {
  const id = crypto.randomUUID();
  const normalized = await prepareMemberUpdateFields(db, id, fields);

  await db
    .prepare(
      `INSERT INTO members (
         id, spirit_name, cohort, real_name, phone, wechat, email, province, city,
         company_title, focus_fields, current_status, self_intro, role,
         directory_visibility, created_at, updated_at
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      normalized.spiritName,
      normalized.cohort,
      normalized.realName,
      normalized.phone,
      normalized.wechat,
      normalized.email,
      normalized.province,
      normalized.city,
      normalized.companyTitle,
      normalized.focusFields,
      normalized.currentStatus,
      normalized.selfIntro,
      normalized.role ?? "校友",
      normalized.directoryVisibility ?? "internal",
      createdAt,
      createdAt,
    )
    .run();

  const member = await getMemberById(db, id);
  if (!member) {
    throw new NotFoundError("成员创建后未找到记录");
  }
  return member;
}

export async function upsertSurveyResponse(
  db: D1Database,
  memberId: string | null,
  slug: string,
  fields: SurveyWriteFields,
  payload: JsonValue,
  updatedAt: string,
): Promise<SurveyResponse> {
  const id = crypto.randomUUID();
  const payloadText = JSON.stringify(payload);

  if (!memberId) {
    await db
      .prepare(
        `INSERT INTO survey_responses (
           id, campaign_slug, member_id,
           will_attend, current_status, focus_fields, self_intro,
           activities_joined, activity_other, memorable_activity, activity_value,
           activity_improvements, future_activities, future_topics, co_creation_roles,
           market_interest, market_description, market_types, followup_consent,
           directory_visibility, message_to_csight, payload, created_at, updated_at
         )
         VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        id,
        slug,
        fields.willAttend,
        fields.currentStatus,
        fields.focusFields,
        fields.selfIntro,
        fields.activitiesJoined,
        fields.activityOther,
        fields.memorableActivity,
        fields.activityValue,
        fields.activityImprovements,
        fields.futureActivities,
        fields.futureTopics,
        fields.coCreationRoles,
        fields.marketInterest,
        fields.marketDescription,
        fields.marketTypes,
        fields.followupConsent,
        fields.directoryVisibility,
        fields.messageToCsight,
        payloadText,
        updatedAt,
        updatedAt,
      )
      .run();

    const response = await getSurveyById(db, id);
    if (!response) {
      throw new NotFoundError("问卷保存后未找到记录");
    }
    return response;
  }

  await db
    .prepare(
      `INSERT INTO survey_responses (
         id, campaign_slug, member_id,
         will_attend, current_status, focus_fields, self_intro,
         activities_joined, activity_other, memorable_activity, activity_value,
         activity_improvements, future_activities, future_topics, co_creation_roles,
         market_interest, market_description, market_types, followup_consent,
         directory_visibility, message_to_csight, payload, created_at, updated_at
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(member_id, campaign_slug) DO UPDATE SET
         will_attend = excluded.will_attend,
         current_status = excluded.current_status,
         focus_fields = excluded.focus_fields,
         self_intro = excluded.self_intro,
         activities_joined = excluded.activities_joined,
         activity_other = excluded.activity_other,
         memorable_activity = excluded.memorable_activity,
         activity_value = excluded.activity_value,
         activity_improvements = excluded.activity_improvements,
         future_activities = excluded.future_activities,
         future_topics = excluded.future_topics,
         co_creation_roles = excluded.co_creation_roles,
         market_interest = excluded.market_interest,
         market_description = excluded.market_description,
         market_types = excluded.market_types,
         followup_consent = excluded.followup_consent,
         directory_visibility = excluded.directory_visibility,
         message_to_csight = excluded.message_to_csight,
         payload = excluded.payload,
         updated_at = excluded.updated_at`,
    )
    .bind(
      id,
      slug,
      memberId,
      fields.willAttend,
      fields.currentStatus,
      fields.focusFields,
      fields.selfIntro,
      fields.activitiesJoined,
      fields.activityOther,
      fields.memorableActivity,
      fields.activityValue,
      fields.activityImprovements,
      fields.futureActivities,
      fields.futureTopics,
      fields.coCreationRoles,
      fields.marketInterest,
      fields.marketDescription,
      fields.marketTypes,
      fields.followupConsent,
      fields.directoryVisibility,
      fields.messageToCsight,
      payloadText,
      updatedAt,
      updatedAt,
    )
    .run();

  const response = await getSurveyByMember(db, memberId, slug);
  if (!response) {
    throw new NotFoundError("问卷保存后未找到记录");
  }
  return response;
}

export async function createRecoveryRequest(
  db: D1Database,
  fields: RecoveryWriteFields,
  createdAt: string,
): Promise<RecoveryRequest> {
  const id = crypto.randomUUID();
  await db
    .prepare(
      `INSERT INTO recovery_requests (
         id, real_name, spirit_name, cohort, phone, old_contact,
         contact_preference, note, status, created_at, updated_at
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
    )
    .bind(
      id,
      fields.realName,
      fields.spiritName,
      fields.cohort,
      fields.phone ? normalizePhone(fields.phone) : null,
      fields.oldContact,
      fields.contactPreference,
      fields.note,
      createdAt,
      createdAt,
    )
    .run();

  const row = await db
    .prepare("SELECT * FROM recovery_requests WHERE id = ?")
    .bind(id)
    .first<RecoveryRequestRow>();

  if (!row) {
    throw new NotFoundError("恢复请求保存后未找到记录");
  }

  return mapRecovery(row);
}

export async function importMembers(
  db: D1Database,
  records: ImportMemberRecord[],
  initialErrors: ImportMembersResult["errors"],
  importedAt: string,
): Promise<ImportMembersResult> {
  let created = 0;
  let updated = 0;
  const errors = [...initialErrors];

  for (const record of records) {
    try {
      const normalizedPhone = normalizePhone(record.phone);
      const existed = normalizedPhone
        ? await db
            .prepare("SELECT id FROM members WHERE phone = ? LIMIT 1")
            .bind(normalizedPhone)
            .first<{ id: string }>()
        : null;
      const memberId = existed?.id ?? crypto.randomUUID();

      if (existed) {
        await db
          .prepare(
            `UPDATE members
             SET spirit_name = ?,
                 cohort = ?,
                 real_name = ?,
                 phone = ?,
                 wechat = ?,
                 email = ?,
                 province = ?,
                 city = ?,
                 company_title = ?,
                 focus_fields = ?,
                 current_status = ?,
                 self_intro = ?,
                 role = ?,
                 directory_visibility = ?,
                 updated_at = ?
             WHERE id = ?`,
          )
          .bind(
            record.spiritName,
            record.cohort,
            record.realName,
            normalizedPhone,
            record.wechat,
            record.email,
            record.province,
            record.city,
            record.companyTitle,
            record.focusFields,
            record.currentStatus,
            record.selfIntro,
            record.role ?? "校友",
            record.directoryVisibility ?? "internal",
            importedAt,
            memberId,
          )
          .run();
      } else {
        await db
          .prepare(
            `INSERT INTO members (
             id, spirit_name, cohort, real_name, phone, wechat, email, province, city,
             company_title, focus_fields, current_status, self_intro, role,
             directory_visibility, created_at, updated_at
           )
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .bind(
            memberId,
            record.spiritName,
            record.cohort,
            record.realName,
            normalizedPhone,
            record.wechat,
            record.email,
            record.province,
            record.city,
            record.companyTitle,
            record.focusFields,
            record.currentStatus,
            record.selfIntro,
            record.role ?? "校友",
            record.directoryVisibility ?? "internal",
            importedAt,
            importedAt,
          )
          .run();
      }

      if (existed) {
        updated += 1;
      } else {
        created += 1;
      }
    } catch (error) {
      errors.push({
        row: record.sourceRow,
        message: error instanceof Error ? error.message : "导入失败",
      });
    }
  }

  return {
    imported: created + updated,
    created,
    updated,
    skipped: errors.length,
    errors,
  };
}

export async function getAdminStats(db: D1Database, slug: string): Promise<AdminStats> {
  const [memberCount, responseCount, recoveryCount, responseRows] = await Promise.all([
    countQuery(db, "SELECT COUNT(*) AS count FROM members"),
    countQuery(db, "SELECT COUNT(*) AS count FROM survey_responses WHERE campaign_slug = ?", [slug]),
    countQuery(db, "SELECT COUNT(*) AS count FROM recovery_requests WHERE status = 'pending'"),
    db
      .prepare(
        `SELECT will_attend, market_interest
         FROM survey_responses
         WHERE campaign_slug = ?`,
      )
      .bind(slug)
      .all<Pick<SurveyResponseRow, "will_attend" | "market_interest">>(),
  ]);

  const rows = responseRows.results ?? [];
  return {
    members: memberCount,
    responses: responseCount,
    attendees: rows.filter((row) => isPositiveAttendance(row.will_attend)).length,
    marketInterested: rows.filter((row) => isMarketInterested(row.market_interest)).length,
    recoveryPending: recoveryCount,
  };
}

export async function listMembers(
  db: D1Database,
  options: { search?: string; cohort?: string; limit?: number; offset?: number },
): Promise<Member[]> {
  const values: D1BindingValue[] = [];
  const conditions: string[] = [];

  if (options.search?.trim()) {
    values.push(`%${options.search.trim()}%`);
    conditions.push(
      "(spirit_name LIKE ? OR real_name LIKE ? OR phone LIKE ? OR wechat LIKE ? OR email LIKE ?)",
    );
    values.push(values[0], values[0], values[0], values[0]);
  }

  if (options.cohort?.trim()) {
    conditions.push("cohort = ?");
    values.push(options.cohort.trim());
  }

  const limit = clampLimit(options.limit);
  const offset = Math.max(0, options.offset ?? 0);
  values.push(limit, offset);

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const result = await db
    .prepare(
      `SELECT *
       FROM members
       ${whereClause}
       ORDER BY cohort, spirit_name
       LIMIT ? OFFSET ?`,
    )
    .bind(...values)
    .all<MemberRow>();

  return (result.results ?? []).map(mapMember);
}

export async function listResponses(
  db: D1Database,
  slug: string,
  options: { limit?: number; offset?: number },
): Promise<SurveyResponseWithMember[]> {
  const limit = clampLimit(options.limit);
  const offset = Math.max(0, options.offset ?? 0);
  const result = await db
    .prepare(
      `SELECT
         r.*,
         m.id AS m_id,
         m.spirit_name AS m_spirit_name,
         m.cohort AS m_cohort,
         m.real_name AS m_real_name,
         m.phone AS m_phone,
         m.wechat AS m_wechat,
         m.email AS m_email,
         m.province AS m_province,
         m.city AS m_city,
         m.company_title AS m_company_title,
         m.focus_fields AS m_focus_fields,
         m.current_status AS m_current_status,
         m.self_intro AS m_self_intro,
         m.role AS m_role,
         m.directory_visibility AS m_directory_visibility,
         m.created_at AS m_created_at,
         m.updated_at AS m_updated_at
       FROM survey_responses r
       LEFT JOIN members m ON m.id = r.member_id
       WHERE r.campaign_slug = ?
       ORDER BY r.updated_at DESC
       LIMIT ? OFFSET ?`,
    )
    .bind(slug, limit, offset)
    .all<JoinedSurveyRow>();

  return (result.results ?? []).map(mapJoinedSurvey);
}

export async function deleteSurveyResponse(
  db: D1Database,
  id: string,
  slug: string,
): Promise<void> {
  const result = await db
    .prepare("DELETE FROM survey_responses WHERE id = ? AND campaign_slug = ?")
    .bind(id, slug)
    .run();

  if (!result.meta.changes) {
    throw new NotFoundError("问卷记录不存在或已被删除");
  }
}

export async function listRecoveryRequests(
  db: D1Database,
  options: { status?: string; limit?: number; offset?: number },
): Promise<RecoveryRequest[]> {
  const values: D1BindingValue[] = [];
  const conditions: string[] = [];
  if (options.status?.trim()) {
    conditions.push("status = ?");
    values.push(options.status.trim());
  }

  const limit = clampLimit(options.limit);
  const offset = Math.max(0, options.offset ?? 0);
  values.push(limit, offset);
  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const result = await db
    .prepare(
      `SELECT *
       FROM recovery_requests
       ${whereClause}
       ORDER BY created_at DESC
       LIMIT ? OFFSET ?`,
    )
    .bind(...values)
    .all<RecoveryRequestRow>();

  return (result.results ?? []).map(mapRecovery);
}

export async function listPendingMembers(db: D1Database, slug: string): Promise<Member[]> {
  const result = await db
    .prepare(
      `SELECT m.*
       FROM members m
       LEFT JOIN survey_responses r
         ON r.member_id = m.id AND r.campaign_slug = ?
       WHERE r.id IS NULL
       ORDER BY m.cohort, m.spirit_name`,
    )
    .bind(slug)
    .all<MemberRow>();
  return (result.results ?? []).map(mapMember);
}

export function mapMember(row: MemberRow): Member {
  return {
    id: row.id,
    spiritName: row.spirit_name,
    cohort: row.cohort,
    realName: row.real_name,
    phone: row.phone,
    wechat: row.wechat,
    email: row.email,
    province: row.province,
    city: row.city,
    companyTitle: row.company_title,
    focusFields: row.focus_fields,
    currentStatus: row.current_status,
    selfIntro: row.self_intro,
    role: row.role,
    directoryVisibility: row.directory_visibility,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function mapSurvey(row: SurveyResponseRow): SurveyResponse {
  return {
    id: row.id,
    campaignSlug: row.campaign_slug,
    memberId: row.member_id,
    willAttend: row.will_attend,
    currentStatus: row.current_status,
    focusFields: row.focus_fields,
    selfIntro: row.self_intro,
    activitiesJoined: row.activities_joined,
    activityOther: row.activity_other,
    memorableActivity: row.memorable_activity,
    activityValue: row.activity_value,
    activityImprovements: row.activity_improvements,
    futureActivities: row.future_activities,
    futureTopics: row.future_topics,
    coCreationRoles: row.co_creation_roles,
    marketInterest: row.market_interest,
    marketDescription: row.market_description,
    marketTypes: row.market_types,
    followupConsent: row.followup_consent,
    directoryVisibility: row.directory_visibility,
    messageToCsight: row.message_to_csight,
    payload: parseJsonValue(row.payload),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function mapRecovery(row: RecoveryRequestRow): RecoveryRequest {
  return {
    id: row.id,
    realName: row.real_name,
    spiritName: row.spirit_name,
    cohort: row.cohort,
    phone: row.phone,
    oldContact: row.old_contact,
    contactPreference: row.contact_preference,
    note: row.note,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function isPositiveAttendance(value: string | null): boolean {
  const text = normalizeText(value).toLowerCase();
  if (!text) {
    return false;
  }
  if (["yes", "true", "1", "y", "会", "是", "参加", "确定参加"].includes(text)) {
    return true;
  }
  return text.includes("参加") && !text.includes("不") && !text.includes("否");
}

export function isMarketInterested(value: string | null): boolean {
  const text = normalizeText(value);
  if (!text) {
    return false;
  }
  return !["暂无兴趣", "无兴趣", "没有兴趣", "不参与", "否", "no"].includes(text.toLowerCase());
}

async function getMemberById(db: D1Database, memberId: string): Promise<Member | null> {
  const row = await db.prepare("SELECT * FROM members WHERE id = ?").bind(memberId).first<MemberRow>();
  return row ? mapMember(row) : null;
}

async function getSurveyById(db: D1Database, id: string): Promise<SurveyResponse | null> {
  const row = await db.prepare("SELECT * FROM survey_responses WHERE id = ?").bind(id).first<SurveyResponseRow>();
  return row ? mapSurvey(row) : null;
}

async function prepareMemberUpdateFields(
  db: D1Database,
  memberId: string,
  fields: Partial<MemberWriteFields>,
): Promise<Partial<Record<MemberWriteKey, string | null>>> {
  const normalized: Partial<Record<MemberWriteKey, string | null>> = {};
  for (const key of Object.keys(fields) as MemberWriteKey[]) {
    const value = fields[key];
    if (value === undefined) {
      continue;
    }
    normalized[key] = key === "phone" ? (normalizePhone(value) || "") : value;
  }

  if (normalized.phone) {
    const duplicate = await db
      .prepare("SELECT id FROM members WHERE phone = ? AND id <> ? LIMIT 1")
      .bind(normalized.phone, memberId)
      .first<{ id: string }>();
    if (duplicate) {
      throw new DuplicatePhoneError();
    }
  }

  return normalized;
}

async function countQuery(
  db: D1Database,
  sql: string,
  values: D1BindingValue[] = [],
): Promise<number> {
  const row = await db.prepare(sql).bind(...values).first<{ count: number }>();
  return Number(row?.count ?? 0);
}

function mapJoinedSurvey(row: JoinedSurveyRow): SurveyResponseWithMember {
  return {
    member: row.m_id
      ? mapMember({
          id: row.m_id,
          spirit_name: row.m_spirit_name ?? "",
          cohort: row.m_cohort,
          real_name: row.m_real_name,
          phone: row.m_phone ?? "",
          wechat: row.m_wechat,
          email: row.m_email,
          province: row.m_province,
          city: row.m_city,
          company_title: row.m_company_title,
          focus_fields: row.m_focus_fields,
          current_status: row.m_current_status,
          self_intro: row.m_self_intro,
          role: row.m_role,
          directory_visibility: row.m_directory_visibility,
          created_at: row.m_created_at ?? "",
          updated_at: row.m_updated_at ?? "",
        })
      : null,
    response: mapSurvey(row),
  };
}

function parseJsonValue(value: string): JsonValue {
  try {
    return toJsonValue(JSON.parse(value));
  } catch {
    return {};
  }
}

function toJsonValue(value: unknown): JsonValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(toJsonValue);
  }
  if (typeof value === "object") {
    const result: Record<string, JsonValue> = {};
    for (const [key, nestedValue] of Object.entries(value)) {
      result[key] = toJsonValue(nestedValue);
    }
    return result;
  }
  return null;
}

function normalizeComparable(value: unknown): string {
  return normalizeText(value).replace(/\s+/g, "").toLowerCase();
}

function randomToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function clampLimit(value: number | undefined): number {
  if (value === undefined || Number.isNaN(value)) {
    return 500;
  }
  return Math.min(Math.max(Math.trunc(value), 1), 1000);
}

interface JoinedSurveyRow extends SurveyResponseRow {
  m_id: string | null;
  m_spirit_name: string | null;
  m_cohort: string | null;
  m_real_name: string | null;
  m_phone: string | null;
  m_wechat: string | null;
  m_email: string | null;
  m_province: string | null;
  m_city: string | null;
  m_company_title: string | null;
  m_focus_fields: string | null;
  m_current_status: string | null;
  m_self_intro: string | null;
  m_role: string | null;
  m_directory_visibility: string | null;
  m_created_at: string | null;
  m_updated_at: string | null;
}
