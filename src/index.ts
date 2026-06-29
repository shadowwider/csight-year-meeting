import { CsvValidationError, parseMembersCsv, stringifyCsv, type CsvHeader } from "./csv";
import {
  DuplicatePhoneError,
  campaignSlug,
  createRecoveryRequest,
  createVerificationToken,
  findVerifiedMember,
  getAdminStats,
  getMemberByToken,
  getSurveyByMember,
  importMembers,
  isMarketInterested,
  isPositiveAttendance,
  listMembers,
  listPendingMembers,
  listRecoveryRequests,
  listResponses,
  normalizePhone,
  normalizeText,
  nowIso,
  textOrNull,
  updateMember,
  upsertSurveyResponse,
} from "./storage";
import type {
  ApiFailure,
  ApiSuccess,
  Env,
  JsonValue,
  Member,
  MemberWriteFields,
  RecoveryWriteFields,
  SurveyResponseWithMember,
  SurveyWriteFields,
} from "./types";

const EVENT_CONFIG = {
  date: "2026-07-25",
  theme: "Passion",
  checkInTime: "12:00",
  address: "上海市徐汇区田林路130号20号楼",
};

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/")) {
      return env.ASSETS ? env.ASSETS.fetch(request) : jsonError(404, "not_found", "页面不存在");
    }

    try {
      return await handleApi(request, env, url);
    } catch (error) {
      if (error instanceof RequestError) {
        return jsonError(error.status, error.code, error.message, error.details);
      }
      if (error instanceof CsvValidationError) {
        return jsonError(400, "invalid_csv", error.message, error.details);
      }
      if (error instanceof DuplicatePhoneError) {
        return jsonError(409, "duplicate_phone", error.message);
      }

      console.error(error);
      return jsonError(500, "internal_error", "服务暂时开小差了，请稍后再试。");
    }
  },
};

async function handleApi(request: Request, env: Env, url: URL): Promise<Response> {
  const path = normalizePath(url.pathname);
  const slug = campaignSlug(env.CAMPAIGN_SLUG);

  if (request.method === "GET" && path === "/api/health") {
    return jsonOk({
      status: "ok",
      service: "csight-alumni-passion",
      timestamp: nowIso(),
    });
  }

  if (request.method === "GET" && path === "/api/config") {
    return jsonOk({
      campaignSlug: slug,
      activity: EVENT_CONFIG,
    });
  }

  if (request.method === "POST" && path === "/api/verify") {
    return handleVerify(request, env);
  }

  if (request.method === "GET" && path === "/api/member") {
    return handleGetMember(url, env, slug);
  }

  if (request.method === "POST" && path === "/api/member/update") {
    return handleMemberUpdate(request, env);
  }

  if (request.method === "POST" && path === "/api/survey") {
    return handleSurvey(request, env, slug);
  }

  if (request.method === "POST" && path === "/api/recovery") {
    return handleRecovery(request, env);
  }

  if (path.startsWith("/api/admin/")) {
    requireAdmin(request, env);
    return handleAdmin(request, env, url, path, slug);
  }

  return jsonError(404, "not_found", "没有找到这个 API。");
}

async function handleVerify(request: Request, env: Env): Promise<Response> {
  const body = await readJsonObject(request);
  const name = normalizeText(getAliasedValue([body], ["name", "精灵名", "姓名", "spiritName", "realName"]));
  const phone = normalizePhone(getAliasedValue([body], ["phone", "手机号"]));
  const cohort = textOrNull(getAliasedValue([body], ["cohort", "期数", "所在期数"]));

  if (!name || !phone) {
    throw new RequestError(400, "missing_required_fields", "请填写精灵名或姓名，以及手机号。");
  }

  const member = await findVerifiedMember(env.DB, { name, phone, cohort });
  if (!member) {
    throw new RequestError(
      404,
      "member_not_found",
      "暂时没有匹配到记录，可能是精灵名、姓名或手机号有变化。你可以再试一次，或提交人工恢复。",
    );
  }

  const issuedAt = nowIso();
  const token = await createVerificationToken(env.DB, member.id, issuedAt);
  return jsonOk({
    token: token.token,
    verificationToken: token.token,
    verification_token: token.token,
    expiresAt: token.expiresAt,
    member,
  });
}

async function handleGetMember(url: URL, env: Env, slug: string): Promise<Response> {
  const token = normalizeText(url.searchParams.get("token"));
  if (!token) {
    throw new RequestError(400, "missing_token", "缺少核验 token。");
  }

  const member = await requireVerifiedMember(env, token);
  const response = await getSurveyByMember(env.DB, member.id, slug);
  return jsonOk({ member, response });
}

async function handleMemberUpdate(request: Request, env: Env): Promise<Response> {
  const body = await readJsonObject(request);
  const token = getTokenFromBody(body);
  const member = await requireVerifiedMember(env, token);
  const fields = extractMemberFields(body);

  validateMemberUpdate(fields);
  const updated = Object.keys(fields).length > 0
    ? await updateMember(env.DB, member.id, fields, nowIso())
    : member;

  return jsonOk({ member: updated });
}

async function handleSurvey(request: Request, env: Env, slug: string): Promise<Response> {
  const body = await readJsonObject(request);
  const token = getTokenFromBody(body);
  const member = await requireVerifiedMember(env, token);
  const surveyFields = extractSurveyFields(body);
  const memberFields = mergeSurveyBackToMember(extractMemberFields(body), surveyFields);

  validateMemberUpdate(memberFields);
  const updatedMember = Object.keys(memberFields).length > 0
    ? await updateMember(env.DB, member.id, memberFields, nowIso())
    : member;
  const response = await upsertSurveyResponse(
    env.DB,
    member.id,
    slug,
    surveyFields,
    payloadWithoutToken(body),
    nowIso(),
  );

  return jsonOk({ member: updatedMember, response });
}

async function handleRecovery(request: Request, env: Env): Promise<Response> {
  const body = await readJsonObject(request);
  const fields = extractRecoveryFields(body);

  if (!fields.realName && !fields.spiritName && !fields.phone && !fields.oldContact) {
    throw new RequestError(400, "missing_recovery_contact", "请至少留下姓名、精灵名、当前手机号或旧联系方式中的一项。");
  }

  const requestRecord = await createRecoveryRequest(env.DB, fields, nowIso());
  return jsonOk(
    {
      request: requestRecord,
      message: "已收到恢复请求，主理人会核对后再联系你。",
    },
    201,
  );
}

async function handleAdmin(
  request: Request,
  env: Env,
  url: URL,
  path: string,
  slug: string,
): Promise<Response> {
  if (request.method === "GET" && path === "/api/admin/stats") {
    return jsonOk(await getAdminStats(env.DB, slug));
  }

  if (request.method === "GET" && path === "/api/admin/members") {
    const items = await listMembers(env.DB, {
      search: url.searchParams.get("search") ?? undefined,
      cohort: url.searchParams.get("cohort") ?? undefined,
      limit: numberParam(url, "limit"),
      offset: numberParam(url, "offset"),
    });
    return jsonOk({ items, count: items.length });
  }

  if (request.method === "GET" && path === "/api/admin/responses") {
    const items = await listResponses(env.DB, slug, {
      limit: numberParam(url, "limit"),
      offset: numberParam(url, "offset"),
    });
    return jsonOk({ items, count: items.length });
  }

  if (request.method === "GET" && path === "/api/admin/recovery") {
    const items = await listRecoveryRequests(env.DB, {
      status: url.searchParams.get("status") ?? undefined,
      limit: numberParam(url, "limit"),
      offset: numberParam(url, "offset"),
    });
    return jsonOk({ items, count: items.length });
  }

  if (request.method === "POST" && path === "/api/admin/import-members") {
    const csvText = await readCsvText(request);
    const parsed = parseMembersCsv(csvText);
    const result = await importMembers(env.DB, parsed.records, parsed.errors, nowIso());
    return jsonOk(result);
  }

  if (request.method === "GET" && path === "/api/admin/export") {
    return handleAdminExport(env, url, slug);
  }

  return jsonError(404, "not_found", "没有找到这个管理员 API。");
}

async function handleAdminExport(env: Env, url: URL, slug: string): Promise<Response> {
  const type = url.searchParams.get("type");
  if (!["members", "responses", "market", "attendees", "pending"].includes(type ?? "")) {
    throw new RequestError(
      400,
      "invalid_export_type",
      "导出类型必须是 members、responses、market、attendees 或 pending。",
    );
  }

  if (type === "members") {
    const members = await listMembers(env.DB, { limit: 10000 });
    return csvResponse("csight-members.csv", exportMembersCsv(members));
  }

  if (type === "pending") {
    const members = await listPendingMembers(env.DB, slug);
    return csvResponse("csight-pending.csv", exportMembersCsv(members));
  }

  const responses = await listResponses(env.DB, slug, { limit: 10000 });
  if (type === "responses") {
    return csvResponse("csight-responses.csv", exportResponsesCsv(responses));
  }
  if (type === "market") {
    return csvResponse(
      "csight-market.csv",
      exportResponsesCsv(responses.filter((item) => isMarketInterested(item.response.marketInterest))),
    );
  }

  return csvResponse(
    "csight-attendees.csv",
    exportResponsesCsv(responses.filter((item) => isPositiveAttendance(item.response.willAttend))),
  );
}

function extractMemberFields(body: Record<string, unknown>): Partial<MemberWriteFields> {
  const sources = nestedSources(body, ["member", "fields", "profile"]);
  const fields: Partial<MemberWriteFields> = {};

  assignStringField(fields, "spiritName", sources, ["spiritName", "spirit_name", "精灵名"]);
  assignNullableField(fields, "cohort", sources, ["cohort", "期数", "所在期数"]);
  assignNullableField(fields, "realName", sources, ["realName", "real_name", "姓名", "真实姓名"]);
  assignPhoneField(fields, sources, ["phone", "手机号", "当前手机号"]);
  assignNullableField(fields, "wechat", sources, ["wechat", "微信号", "微信"]);
  assignNullableField(fields, "email", sources, ["email", "邮箱"]);
  assignNullableField(fields, "province", sources, ["province", "省份"]);
  assignNullableField(fields, "city", sources, ["city", "城市", "当前所在城市", "当前城市"]);
  assignNullableField(fields, "companyTitle", sources, [
    "companyTitle",
    "company_title",
    "所在公司及现任职务",
    "公司 / 角色",
    "公司/角色",
    "公司及职位",
  ]);
  assignNullableField(fields, "focusFields", sources, [
    "focusFields",
    "focus_fields",
    "你目前主要关注或从事的领域",
    "关注领域",
    "领域",
  ]);
  assignNullableField(fields, "currentStatus", sources, ["currentStatus", "current_status", "当前状态"]);
  assignNullableField(fields, "selfIntro", sources, [
    "selfIntro",
    "self_intro",
    "用一句话介绍现在的自己",
    "一句话介绍",
  ]);
  assignNullableField(fields, "role", sources, ["role", "角色", "创见身份"]);

  const directoryVisibility = getAliasedValue(sources, [
    "directoryVisibility",
    "directory_visibility",
    "是否愿意加入创见校友通讯录",
    "通讯录授权",
    "联系偏好",
  ]);
  if (directoryVisibility !== undefined) {
    fields.directoryVisibility = normalizeDirectoryVisibility(directoryVisibility);
  }

  return fields;
}

function extractSurveyFields(body: Record<string, unknown>): SurveyWriteFields {
  const sources = nestedSources(body, ["survey", "fields", "questionnaire"]);
  return {
    willAttend: aliasedText(sources, ["willAttend", "will_attend", "是否参加年会", "今年年会是否来", "是否来年会"]),
    currentStatus: aliasedText(sources, ["currentStatus", "current_status", "当前状态"]),
    focusFields: aliasedText(sources, [
      "focusFields",
      "focus_fields",
      "你目前主要关注或从事的领域",
      "关注领域",
    ]),
    selfIntro: aliasedText(sources, ["selfIntro", "self_intro", "用一句话介绍现在的自己", "一句话介绍"]),
    activitiesJoined: aliasedText(sources, [
      "activitiesJoined",
      "activities_joined",
      "过去一年，你是否参加过以下活动？",
      "参加过以下活动",
    ]),
    activityOther: aliasedText(sources, ["activityOther", "activity_other", "其他活动"]),
    memorableActivity: aliasedText(sources, [
      "memorableActivity",
      "memorable_activity",
      "如果参加过，哪一次活动让你印象最深？请说说为什么～",
      "印象最深的活动",
    ]),
    activityValue: aliasedText(sources, [
      "activityValue",
      "activity_value",
      "过去一年，你觉得创见活动最有价值的是？",
      "活动最有价值的是",
    ]),
    activityImprovements: aliasedText(sources, [
      "activityImprovements",
      "activity_improvements",
      "你觉得目前创见活动还有哪些可以优化的地方？",
      "活动优化建议",
    ]),
    futureActivities: aliasedText(sources, [
      "futureActivities",
      "future_activities",
      "未来一年，你希望参加哪些活动？",
      "希望参加哪些活动",
    ]),
    futureTopics: aliasedText(sources, [
      "futureTopics",
      "future_topics",
      "你最希望未来活动关注哪些主题？",
      "未来活动主题",
    ]),
    coCreationRoles: aliasedText(sources, [
      "coCreationRoles",
      "co_creation_roles",
      "如果未来有机会参与活动共创，你更愿意以什么方式参与？",
      "共创方式",
    ]),
    marketInterest: aliasedText(sources, [
      "marketInterest",
      "market_interest",
      "你是否有兴趣参与创见集市？",
      "集市兴趣",
    ]),
    marketDescription: aliasedText(sources, [
      "marketDescription",
      "market_description",
      "如果有兴趣，你希望展示什么内容？",
      "集市展示内容",
    ]),
    marketTypes: aliasedText(sources, ["marketTypes", "market_types", "你的展示属于哪种类型？", "展示类型"]),
    followupConsent: aliasedText(sources, [
      "followupConsent",
      "followup_consent",
      "是否愿意接受年会组后续联系？",
      "后续联系授权",
    ]),
    directoryVisibility: normalizeDirectoryVisibility(
      getAliasedValue(sources, [
        "directoryVisibility",
        "directory_visibility",
        "是否愿意加入创见校友通讯录？",
        "是否愿意加入创见校友通讯录",
        "通讯录授权",
      ]),
    ),
    messageToCsight: aliasedText(sources, ["messageToCsight", "message_to_csight", "还有什么想对创见说的话？"]),
  };
}

function extractRecoveryFields(body: Record<string, unknown>): RecoveryWriteFields {
  const sources = nestedSources(body, ["recovery", "fields"]);
  return {
    realName: aliasedText(sources, ["realName", "real_name", "姓名", "真实姓名"]),
    spiritName: aliasedText(sources, ["spiritName", "spirit_name", "精灵名", "可能的精灵名"]),
    cohort: aliasedText(sources, ["cohort", "期数", "所在期数"]),
    phone: normalizeNullablePhone(getAliasedValue(sources, ["phone", "手机号", "当前手机号"])),
    oldContact: aliasedText(sources, ["oldContact", "old_contact", "旧手机号 / 微信 / 邮箱任一", "旧联系方式"]),
    contactPreference: aliasedText(sources, [
      "contactPreference",
      "contact_preference",
      "希望管理员如何联系你",
      "联系偏好",
    ]),
    note: aliasedText(sources, ["note", "补充说明", "说明"]),
  };
}

function mergeSurveyBackToMember(
  memberFields: Partial<MemberWriteFields>,
  surveyFields: SurveyWriteFields,
): Partial<MemberWriteFields> {
  return {
    ...memberFields,
    currentStatus: memberFields.currentStatus ?? surveyFields.currentStatus ?? undefined,
    focusFields: memberFields.focusFields ?? surveyFields.focusFields ?? undefined,
    selfIntro: memberFields.selfIntro ?? surveyFields.selfIntro ?? undefined,
    directoryVisibility:
      memberFields.directoryVisibility ?? surveyFields.directoryVisibility ?? undefined,
  };
}

function validateMemberUpdate(fields: Partial<MemberWriteFields>): void {
  if ("spiritName" in fields && !normalizeText(fields.spiritName)) {
    throw new RequestError(400, "invalid_member", "精灵名不能为空。");
  }
  if ("phone" in fields && !normalizePhone(fields.phone)) {
    throw new RequestError(400, "invalid_member", "手机号不能为空。");
  }
}

async function requireVerifiedMember(env: Env, token: string): Promise<Member> {
  if (!token) {
    throw new RequestError(401, "missing_token", "请先完成身份核验。");
  }
  const member = await getMemberByToken(env.DB, token, nowIso());
  if (!member) {
    throw new RequestError(401, "invalid_token", "核验已过期或不存在，请重新核验身份。");
  }
  return member;
}

function requireAdmin(request: Request, env: Env): void {
  if (!env.ADMIN_TOKEN) {
    throw new RequestError(500, "admin_token_missing", "管理员密钥尚未配置。");
  }
  const expected = `Bearer ${env.ADMIN_TOKEN}`;
  if (request.headers.get("Authorization") !== expected) {
    throw new RequestError(401, "unauthorized", "需要管理员授权。");
  }
}

async function readJsonObject(request: Request): Promise<Record<string, unknown>> {
  const text = await request.text();
  if (!text.trim()) {
    return {};
  }
  try {
    const parsed: unknown = JSON.parse(text);
    if (!isRecord(parsed)) {
      throw new RequestError(400, "invalid_json", "请求体必须是 JSON 对象。");
    }
    return parsed;
  } catch (error) {
    if (error instanceof RequestError) {
      throw error;
    }
    throw new RequestError(400, "invalid_json", "请求体不是有效 JSON。");
  }
}

async function readCsvText(request: Request): Promise<string> {
  const text = await request.text();
  if (request.headers.get("Content-Type")?.includes("application/json")) {
    try {
      const parsed: unknown = JSON.parse(text);
      if (isRecord(parsed) && typeof parsed.csv === "string") {
        return parsed.csv;
      }
      throw new RequestError(400, "invalid_csv_payload", "JSON 请求体需要包含 csv 字段。");
    } catch (error) {
      if (error instanceof RequestError) {
        throw error;
      }
      throw new RequestError(400, "invalid_json", "请求体不是有效 JSON。");
    }
  }
  return text;
}

function jsonOk<T>(data: T, status = 200): Response {
  const payload: ApiSuccess<T> = { ok: true, data };
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      ...CORS_HEADERS,
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}

function jsonError(status: number, code: string, message: string, details?: JsonValue): Response {
  const payload: ApiFailure = {
    ok: false,
    error: details === undefined ? { code, message } : { code, message, details },
  };
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      ...CORS_HEADERS,
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}

function csvResponse(filename: string, body: string): Response {
  return new Response(body, {
    headers: {
      ...CORS_HEADERS,
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}

function exportMembersCsv(members: Member[]): string {
  const headers: Array<CsvHeader<string>> = [
    { key: "spiritName", label: "精灵名" },
    { key: "cohort", label: "期数" },
    { key: "realName", label: "姓名" },
    { key: "phone", label: "手机号" },
    { key: "wechat", label: "微信号" },
    { key: "email", label: "邮箱" },
    { key: "province", label: "省份" },
    { key: "city", label: "城市" },
    { key: "companyTitle", label: "所在公司及现任职务" },
    { key: "focusFields", label: "你目前主要关注或从事的领域" },
    { key: "currentStatus", label: "当前状态" },
    { key: "selfIntro", label: "用一句话介绍现在的自己" },
    { key: "role", label: "角色" },
    { key: "directoryVisibility", label: "通讯录授权" },
    { key: "updatedAt", label: "更新时间" },
  ];
  return stringifyCsv(headers, members.map((member) => ({ ...member })));
}

function exportResponsesCsv(items: SurveyResponseWithMember[]): string {
  const headers: Array<CsvHeader<string>> = [
    { key: "spiritName", label: "精灵名" },
    { key: "cohort", label: "期数" },
    { key: "realName", label: "姓名" },
    { key: "phone", label: "手机号" },
    { key: "city", label: "城市" },
    { key: "willAttend", label: "是否参加年会" },
    { key: "currentStatus", label: "当前状态" },
    { key: "focusFields", label: "关注或从事领域" },
    { key: "selfIntro", label: "一句话介绍" },
    { key: "activitiesJoined", label: "过去一年参加活动" },
    { key: "memorableActivity", label: "印象最深活动" },
    { key: "activityValue", label: "活动价值" },
    { key: "activityImprovements", label: "活动优化建议" },
    { key: "futureActivities", label: "未来活动" },
    { key: "futureTopics", label: "未来主题" },
    { key: "coCreationRoles", label: "共创方式" },
    { key: "marketInterest", label: "集市兴趣" },
    { key: "marketDescription", label: "集市展示内容" },
    { key: "marketTypes", label: "展示类型" },
    { key: "followupConsent", label: "后续联系授权" },
    { key: "directoryVisibility", label: "通讯录授权" },
    { key: "messageToCsight", label: "想对创见说的话" },
    { key: "updatedAt", label: "更新时间" },
  ];
  const rows = items.map(({ member, response }) => ({
    spiritName: member.spiritName,
    cohort: member.cohort,
    realName: member.realName,
    phone: member.phone,
    city: member.city,
    willAttend: response.willAttend,
    currentStatus: response.currentStatus,
    focusFields: response.focusFields,
    selfIntro: response.selfIntro,
    activitiesJoined: response.activitiesJoined,
    memorableActivity: response.memorableActivity,
    activityValue: response.activityValue,
    activityImprovements: response.activityImprovements,
    futureActivities: response.futureActivities,
    futureTopics: response.futureTopics,
    coCreationRoles: response.coCreationRoles,
    marketInterest: response.marketInterest,
    marketDescription: response.marketDescription,
    marketTypes: response.marketTypes,
    followupConsent: response.followupConsent,
    directoryVisibility: response.directoryVisibility,
    messageToCsight: response.messageToCsight,
    updatedAt: response.updatedAt,
  }));
  return stringifyCsv(headers, rows);
}

function assignStringField<K extends keyof MemberWriteFields>(
  target: Partial<MemberWriteFields>,
  key: K,
  sources: Array<Record<string, unknown>>,
  aliases: string[],
): void {
  const value = getAliasedValue(sources, aliases);
  if (value !== undefined) {
    target[key] = normalizeText(value) as Partial<MemberWriteFields>[K];
  }
}

function assignNullableField<K extends keyof MemberWriteFields>(
  target: Partial<MemberWriteFields>,
  key: K,
  sources: Array<Record<string, unknown>>,
  aliases: string[],
): void {
  const value = getAliasedValue(sources, aliases);
  if (value !== undefined) {
    target[key] = textOrNull(value) as Partial<MemberWriteFields>[K];
  }
}

function assignPhoneField(
  target: Partial<MemberWriteFields>,
  sources: Array<Record<string, unknown>>,
  aliases: string[],
): void {
  const value = getAliasedValue(sources, aliases);
  if (value !== undefined) {
    target.phone = normalizePhone(value);
  }
}

function getTokenFromBody(body: Record<string, unknown>): string {
  return normalizeText(getAliasedValue([body], ["token", "verificationToken", "verification_token"]));
}

function aliasedText(sources: Array<Record<string, unknown>>, aliases: string[]): string | null {
  return textOrNull(getAliasedValue(sources, aliases));
}

function normalizeNullablePhone(value: unknown): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  const phone = normalizePhone(value);
  return phone || null;
}

function normalizeDirectoryVisibility(value: unknown): string | null {
  if (value === undefined) {
    return null;
  }
  const text = normalizeText(value);
  if (!text) {
    return null;
  }
  if (text.includes("公开") || text.includes("愿意")) {
    return "alumni";
  }
  if (text.includes("内部") || text.includes("留存")) {
    return "internal";
  }
  return text;
}

function getAliasedValue(sources: Array<Record<string, unknown>>, aliases: string[]): unknown {
  for (const source of sources) {
    for (const alias of aliases) {
      if (Object.prototype.hasOwnProperty.call(source, alias)) {
        return source[alias];
      }
    }
  }
  return undefined;
}

function nestedSources(body: Record<string, unknown>, keys: string[]): Array<Record<string, unknown>> {
  const sources: Array<Record<string, unknown>> = [body];
  for (const key of keys) {
    const value = body[key];
    if (isRecord(value)) {
      sources.push(value);
    }
  }
  return sources;
}

function payloadWithoutToken(body: Record<string, unknown>): JsonValue {
  const payload: Record<string, JsonValue> = {};
  for (const [key, value] of Object.entries(body)) {
    if (["token", "verificationToken", "verification_token"].includes(key)) {
      continue;
    }
    payload[key] = toJsonValue(value);
  }
  return payload;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizePath(pathname: string): string {
  return pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
}

function numberParam(url: URL, name: string): number | undefined {
  const raw = url.searchParams.get(name);
  if (!raw) {
    return undefined;
  }
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
}

class RequestError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: JsonValue;

  constructor(status: number, code: string, message: string, details?: JsonValue) {
    super(message);
    this.name = "RequestError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}
