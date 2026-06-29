const ADMIN_PASSWORD_KEY = "csight.adminPassword";
const VERIFY_TOKEN_KEY = "csight.verifyToken";
const DRAFT_KEY = "csight.passionSurveyDraft";
const CAMPAIGN_SLUG = "csight-passion-2026";

const state = {
  config: null,
  member: null,
  verifyToken: sessionStorage.getItem(VERIFY_TOKEN_KEY) || "",
  adminPassword: sessionStorage.getItem(ADMIN_PASSWORD_KEY) || "",
  adminLoaded: false
};

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

function setMessage(node, type, text) {
  if (!node) return;
  node.className = `message ${type || ""}`.trim();
  node.textContent = text;
  node.classList.toggle("hidden", !text);
}

function clearMessage(node) {
  if (!node) return;
  node.className = "message hidden";
  node.textContent = "";
}

function setBusy(button, busy, label) {
  if (!button) return;
  if (busy) {
    button.dataset.originalText = button.textContent;
    button.textContent = label || "处理中...";
    button.disabled = true;
  } else {
    button.textContent = button.dataset.originalText || button.textContent;
    button.disabled = false;
  }
}

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value == null || value === "") return [];
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return [];
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) return parsed;
    } catch {
      // Plain comma-separated values are accepted for display convenience.
    }
    return trimmed.split(/[,，、]/).map((item) => item.trim()).filter(Boolean);
  }
  return [value];
}

function displayValue(value, fallback = "未填写") {
  const list = asArray(value);
  if (list.length) return list.join("、");
  if (value === 0) return "0";
  return value || fallback;
}

function normalizeListPayload(payload, keys) {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== "object") return [];
  for (const key of keys) {
    if (Array.isArray(payload[key])) return payload[key];
  }
  if (payload.data && payload.data !== payload) return normalizeListPayload(payload.data, keys);
  return [];
}

function normalizeObjectPayload(payload, keys) {
  if (!payload || typeof payload !== "object") return {};
  for (const key of keys) {
    if (payload[key] && typeof payload[key] === "object") return payload[key];
  }
  if (payload.data && typeof payload.data === "object" && payload.data !== payload) {
    return normalizeObjectPayload(payload.data, keys);
  }
  return payload;
}

function formToObject(form) {
  const data = {};
  const formData = new FormData(form);
  for (const [key, value] of formData.entries()) {
    const clean = typeof value === "string" ? value.trim() : value;
    if (data[key] !== undefined) {
      data[key] = asArray(data[key]).concat(clean);
    } else {
      data[key] = clean;
    }
  }
  return data;
}

function fillForm(form, data) {
  if (!form || !data) return;
  $$("input, select, textarea", form).forEach((field) => {
    const name = field.name;
    if (!name || data[name] == null) return;
    const value = data[name];
    if (field.type === "checkbox") {
      field.checked = asArray(value).includes(field.value);
      return;
    }
    if (field.type === "radio") {
      field.checked = String(value) === field.value;
      return;
    }
    field.value = Array.isArray(value) ? value.join("、") : value;
  });
}

function hasFormValue(form, name) {
  const fields = $$(`[name="${name}"]`, form);
  if (!fields.length) return false;
  if (fields[0].type === "checkbox" || fields[0].type === "radio") {
    return fields.some((field) => field.checked);
  }
  return Boolean(String(fields[0].value || "").trim());
}

function setFormValueIfEmpty(form, name, value, options = {}) {
  if (!form || value == null || value === "") return false;
  const fields = $$(`[name="${name}"]`, form);
  if (!fields.length) return false;
  if (!options.overwrite && hasFormValue(form, name)) return false;

  if (fields[0].type === "checkbox") {
    const values = asArray(value);
    let matched = false;
    fields.forEach((field) => {
      field.checked = values.includes(field.value);
      matched = matched || field.checked;
    });
    return matched;
  }

  if (fields[0].type === "radio") {
    let matched = false;
    fields.forEach((field) => {
      field.checked = String(value) === field.value;
      matched = matched || field.checked;
    });
    return matched;
  }

  fields[0].value = Array.isArray(value) ? value.join("、") : value;
  return true;
}

function surveyFormDataFromMember(member) {
  return {
    current_status: member.current_status || member.currentStatus || "",
    focus_fields: member.focus_fields || member.focusFields || "",
    self_intro: member.self_intro || member.selfIntro || "",
    directory_visibility: member.directory_visibility || member.directoryVisibility || ""
  };
}

function surveyFormDataFromResponse(response) {
  return {
    will_attend: response.will_attend || response.willAttend || "",
    current_status: response.current_status || response.currentStatus || "",
    focus_fields: response.focus_fields || response.focusFields || "",
    self_intro: response.self_intro || response.selfIntro || "",
    activities_joined: response.activities_joined || response.activitiesJoined || "",
    activity_other: response.activity_other || response.activityOther || "",
    memorable_activity: response.memorable_activity || response.memorableActivity || "",
    activity_value: response.activity_value || response.activityValue || "",
    activity_improvements: response.activity_improvements || response.activityImprovements || "",
    future_activities: response.future_activities || response.futureActivities || "",
    future_topics: response.future_topics || response.futureTopics || "",
    co_creation_roles: response.co_creation_roles || response.coCreationRoles || "",
    market_interest: response.market_interest || response.marketInterest || "",
    market_description: response.market_description || response.marketDescription || "",
    market_types: response.market_types || response.marketTypes || "",
    followup_consent: response.followup_consent || response.followupConsent || "",
    directory_visibility: response.directory_visibility || response.directoryVisibility || "",
    message_to_csight: response.message_to_csight || response.messageToCsight || ""
  };
}

function prefillSurvey(data, message, options = {}) {
  const form = $("#surveyForm");
  if (!form || !data) return;
  const changed = Object.entries(data)
    .filter(([, value]) => value != null && value !== "")
    .map(([name, value]) => setFormValueIfEmpty(form, name, value, options))
    .filter(Boolean).length;
  if (changed) {
    setMessage($("#surveyPrefillMsg"), "ok", message);
  }
}

function prefillSurveyFromMember(member) {
  prefillSurvey(
    surveyFormDataFromMember(member),
    "已从通讯录带入近况、关注领域和通讯录授权。你可以直接提交，也可以修改；问卷提交后会同步更新通讯录中的这些字段。"
  );
}

function prefillSurveyFromResponse(response) {
  prefillSurvey(
    surveyFormDataFromResponse(response),
    "已载入你之前提交过的问卷内容。修改后再次提交，会更新本次年会问卷。"
  );
}

function getTokenPayload() {
  return state.verifyToken ? { verification_token: state.verifyToken, token: state.verifyToken } : {};
}

function hasVerifiedIdentity() {
  return Boolean(state.verifyToken || state.member?.id);
}

class ApiError extends Error {
  constructor(message, status, data) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.data = data;
  }
}

async function apiRequest(path, options = {}) {
  const headers = new Headers(options.headers || {});
  headers.set("Accept", "application/json, text/csv, text/plain;q=0.9, */*;q=0.8");

  let body = options.body;
  if (body && !(body instanceof FormData) && typeof body !== "string") {
    headers.set("Content-Type", "application/json");
    body = JSON.stringify(body);
  } else if (typeof body === "string" && !headers.has("Content-Type")) {
    headers.set("Content-Type", "text/plain;charset=utf-8");
  }

  if (options.admin) {
    const password = state.adminPassword || sessionStorage.getItem(ADMIN_PASSWORD_KEY);
    if (password) headers.set("X-Admin-Password", password);
  }

  const response = await fetch(path, {
    method: options.method || (body ? "POST" : "GET"),
    headers,
    body
  });
  const text = await response.text();
  const contentType = response.headers.get("content-type") || "";
  let data = text;
  if (contentType.includes("application/json") || text.startsWith("{") || text.startsWith("[")) {
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = text;
    }
  }

  if (!response.ok) {
    const message = data?.message || data?.error || `接口暂时不可用（HTTP ${response.status}）`;
    throw new ApiError(message, response.status, data);
  }
  return data;
}

function route(name, options = {}) {
  if (name === "admin" && !state.adminPassword) {
    route("admin-login");
    return;
  }
  $$(".page").forEach((page) => page.classList.toggle("active", page.id === name));
  $$("[data-route]").forEach((button) => button.classList.toggle("on", button.dataset.route === name));
  if (name === "admin") {
    $$("[data-route]").forEach((button) => button.classList.remove("on"));
    const adminEntry = $('[data-route="admin-login"]');
    if (adminEntry) adminEntry.classList.add("on");
    if (!state.adminLoaded) loadAdminData();
  }
  if (!options.silent) {
    history.replaceState(null, "", `#${name}`);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
}

function adminView(name) {
  $$(".admin-panel").forEach((panel) => panel.classList.toggle("active", panel.id === `admin-${name}`));
  $$("[data-admin-panel]").forEach((button) => button.classList.toggle("on", button.dataset.adminPanel === name));
}

function enableContactForm(enabled) {
  const form = $("#contactForm");
  if (!form) return;
  form.classList.toggle("is-disabled", !enabled);
  form.setAttribute("aria-disabled", enabled ? "false" : "true");
  $$("input, select, textarea, button", form).forEach((field) => {
    if (field.dataset.route) return;
    field.disabled = !enabled;
  });
}

function renderMember(member) {
  state.member = member || null;
  if (!member) {
    $("#memberNotice")?.classList.remove("hidden");
    $("#memberSummary")?.classList.add("hidden");
    enableContactForm(false);
    return;
  }

  $("#memberNotice")?.classList.add("hidden");
  $("#memberSummary")?.classList.remove("hidden");
  enableContactForm(true);

  const spiritName = member.spirit_name || member.spiritName || "创见伙伴";
  const realName = member.real_name || member.realName || "";
  const cohort = member.cohort || "期数待确认";
  const role = member.role || "校友";
  const city = member.city || "城市待确认";

  $("#memberAvatar").textContent = spiritName.slice(0, 1) || "见";
  $("#memberTitle").textContent = realName ? `${spiritName} · ${realName}` : spiritName;
  $("#memberMeta").textContent = `${cohort} · ${role} · ${city}`;

  fillForm($("#contactForm"), {
    spirit_name: spiritName,
    real_name: realName,
    phone: member.phone || "",
    wechat: member.wechat || "",
    email: member.email || "",
    city: member.city || "",
    current_status: member.current_status || member.currentStatus || "",
    company_title: member.company_title || member.companyTitle || "",
    focus_fields: displayValue(member.focus_fields || member.focusFields, ""),
    self_intro: member.self_intro || member.selfIntro || "",
    directory_visibility: member.directory_visibility || member.directoryVisibility || "internal"
  });
  prefillSurveyFromMember(member);
}

function showVerifiedContactFallback(seed = {}) {
  state.member = null;
  const notice = $("#memberNotice");
  if (notice) {
    notice.textContent = "身份已核验，但暂时无法读取后端旧资料。你可以先手动填写并提交；最终是否保存以后端返回为准。";
    notice.className = "message warn";
  }
  $("#memberSummary")?.classList.add("hidden");
  enableContactForm(true);
  fillForm($("#contactForm"), {
    spirit_name: seed.spirit_name || "",
    cohort: seed.cohort || "",
    phone: seed.phone || "",
    directory_visibility: "internal"
  });
}

function renderConfig(config) {
  state.config = config || {};
  const surveyOpen = config.survey_open ?? config.surveyOpen ?? config.open;
  const statusNode = $("#configStatus");
  const homeSurveyStatus = $("#homeSurveyStatus");
  if (statusNode) {
    statusNode.classList.toggle("closed", surveyOpen === false);
    statusNode.classList.toggle("open", surveyOpen !== false);
    statusNode.textContent = surveyOpen === false ? "问卷已截止" : "2026 Passion";
  }
  if (homeSurveyStatus) {
    homeSurveyStatus.textContent = surveyOpen === false ? "已截止" : "开放中";
  }
}

async function loadConfig() {
  try {
    const payload = await apiRequest("/api/config");
    renderConfig(normalizeObjectPayload(payload, ["config", "campaign"]));
    clearMessage($("#configMessage"));
  } catch (error) {
    $("#homeSurveyStatus").textContent = "等待接口同步";
    setMessage($("#configMessage"), "warn", "暂时无法同步后端配置。你仍可阅读公开信；提交时会再次连接服务器。");
  }
}

async function loadMemberFromToken() {
  if (!state.verifyToken) {
    renderMember(null);
    return;
  }
  try {
    const payload = await apiRequest(`/api/member?token=${encodeURIComponent(state.verifyToken)}`, {
      headers: { "X-Verification-Token": state.verifyToken }
    });
    const data = normalizeObjectPayload(payload, ["data"]);
    const member = data.member || normalizeObjectPayload(payload, ["member"]);
    renderMember(member);
    if (data.response) prefillSurveyFromResponse(data.response);
  } catch {
    if (state.verifyToken) showVerifiedContactFallback();
    else renderMember(null);
  }
}

async function handleVerify(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const button = $("#verifySubmit");
  const message = $("#verifyMsg");
  const data = formToObject(form);

  if (!data.phone || !data.spirit_name) {
    setMessage(message, "error", "请至少填写精灵名和手机号。若信息记不清，可以提交人工恢复。");
    return;
  }

  setBusy(button, true, "核验中...");
  clearMessage(message);
  try {
    const payload = await apiRequest("/api/verify", { body: data });
    const result = normalizeObjectPayload(payload, ["result", "verification"]);
    const token = result.token || result.verification_token || payload.token || payload.verification_token;
    const member = result.member || payload.member || normalizeObjectPayload(payload, ["member"]);

    if (!token && !member?.id) {
      throw new ApiError("后端没有返回可用的核验结果，请稍后再试或走人工恢复。", 200, payload);
    }

    state.verifyToken = token || state.verifyToken;
    if (state.verifyToken) sessionStorage.setItem(VERIFY_TOKEN_KEY, state.verifyToken);
    if (member?.id || member?.spirit_name) {
      renderMember(member);
    } else if (state.verifyToken) {
      showVerifiedContactFallback(data);
    } else {
      renderMember(null);
    }
    if (!member?.id && state.verifyToken) await loadMemberFromToken();

    setMessage(message, "ok", "核验成功。正在进入通讯录确认。");
    setTimeout(() => route("contact"), 420);
  } catch (error) {
    setMessage(message, "error", `${error.message || "核验失败"}。你可以再检查一次，或提交人工恢复。`);
  } finally {
    setBusy(button, false);
  }
}

async function submitContact(event) {
  event.preventDefault();
  const button = $("#contactSubmit");
  const message = $("#contactMsg");
  if (!hasVerifiedIdentity()) {
    setMessage(message, "error", "请先完成身份核验，再提交通讯录更新。");
    route("verify");
    return;
  }
  const data = {
    ...getTokenPayload(),
    campaign_slug: CAMPAIGN_SLUG,
    member_id: state.member?.id,
    ...formToObject(event.currentTarget)
  };

  setBusy(button, true, "保存中...");
  clearMessage(message);
  try {
    const payload = await apiRequest("/api/member/update", { body: data });
    const member = normalizeObjectPayload(payload, ["member"]);
    if (member && Object.keys(member).length) renderMember(member);
    setMessage(message, "ok", "通讯录更新已保存。可以继续填写年会问卷。");
  } catch (error) {
    setMessage(message, "error", `${error.message || "保存失败"}。你的修改还没有被后端确认，请稍后再试。`);
  } finally {
    setBusy(button, false);
  }
}

async function confirmContact() {
  const form = $("#contactForm");
  const message = $("#contactMsg");
  if (!form || !hasVerifiedIdentity()) {
    route("verify");
    return;
  }
  await submitContact(new Event("submit", { cancelable: true, bubbles: false, currentTarget: form }));
  setMessage(message, message.classList.contains("error") ? "error" : "ok", message.textContent || "已确认当前资料。");
}

function restoreDraft() {
  const raw = localStorage.getItem(DRAFT_KEY);
  if (!raw) return;
  try {
    const draft = JSON.parse(raw);
    fillForm($("#surveyForm"), draft);
    setMessage($("#surveyMsg"), "warn", "已载入本机保存的草稿。草稿不是正式提交，请确认后提交。");
  } catch {
    localStorage.removeItem(DRAFT_KEY);
  }
}

function saveDraft() {
  const form = $("#surveyForm");
  if (!form) return;
  localStorage.setItem(DRAFT_KEY, JSON.stringify(formToObject(form)));
  setMessage($("#surveyMsg"), "ok", "草稿已保存在这个浏览器里。它不会替代正式提交。");
}

async function submitSurvey(event) {
  event.preventDefault();
  const button = $("#surveySubmit");
  const message = $("#surveyMsg");
  if (!hasVerifiedIdentity()) {
    setMessage(message, "error", "请先完成身份核验，再提交问卷。");
    route("verify");
    return;
  }
  const survey = formToObject(event.currentTarget);
  const payload = {
    ...getTokenPayload(),
    campaign_slug: CAMPAIGN_SLUG,
    member_id: state.member?.id,
    ...survey,
    payload: survey
  };

  setBusy(button, true, "提交中...");
  clearMessage(message);
  try {
    const responsePayload = await apiRequest("/api/survey", { body: payload });
    const member = normalizeObjectPayload(responsePayload, ["member"]);
    if (member && Object.keys(member).length) renderMember(member);
    localStorage.removeItem(DRAFT_KEY);
    route("done");
  } catch (error) {
    setMessage(message, "error", `${error.message || "提交失败"}。问卷尚未保存到后端，请稍后再试。`);
  } finally {
    setBusy(button, false);
  }
}

async function submitRecovery(event) {
  event.preventDefault();
  const button = $("#recoverSubmit");
  const message = $("#recoverMsg");
  const data = formToObject(event.currentTarget);
  if (!data.phone && !data.old_contact && !data.wechat) {
    setMessage(message, "error", "请至少填写当前手机号或一个旧联系方式，方便秘书处核对。");
    return;
  }
  setBusy(button, true, "提交中...");
  clearMessage(message);
  try {
    await apiRequest("/api/recovery", { body: data });
    setMessage(message, "ok", "已提交。秘书处会人工核对，不会自动展示你的旧资料。");
    event.currentTarget.reset();
  } catch (error) {
    setMessage(message, "error", `${error.message || "提交失败"}。如果一直失败，请直接联系秘书处。`);
  } finally {
    setBusy(button, false);
  }
}

function saveAdminPassword() {
  const input = $("#adminPassword");
  const password = input.value.trim();
  if (!password) {
    setMessage($("#adminLoginMsg"), "error", "请输入管理密码。");
    return;
  }
  state.adminPassword = password;
  sessionStorage.setItem(ADMIN_PASSWORD_KEY, password);
  setMessage($("#adminLoginMsg"), "ok", "管理密码已保存到当前会话。");
  route("admin");
}

function clearAdminPassword() {
  state.adminPassword = "";
  state.adminLoaded = false;
  sessionStorage.removeItem(ADMIN_PASSWORD_KEY);
  const input = $("#adminPassword");
  if (input) input.value = "";
  setMessage($("#adminLoginMsg"), "ok", "管理密码已清除。");
  route("admin-login");
}

function renderStats(payload) {
  const stats = normalizeObjectPayload(payload, ["stats"]);
  const grid = $("#statsGrid");
  if (!grid) return;

  const items = [
    ["成员总数", stats.total_members ?? stats.totalMembers ?? stats.members],
    ["已确认资料", stats.confirmed_members ?? stats.confirmedMembers],
    ["问卷回应", stats.survey_responses ?? stats.responses],
    ["愿意参加年会", stats.will_attend ?? stats.attending ?? stats.attendees],
    ["集市有兴趣", stats.market_interest ?? stats.marketInterested],
    ["恢复请求", stats.recovery_pending ?? stats.pendingRecovery ?? stats.recoveryPending]
  ].filter((item) => item[1] !== undefined && item[1] !== null);

  if (!items.length) {
    grid.innerHTML = '<div class="stat empty-state">/api/admin/stats 没有返回可展示的统计字段</div>';
    return;
  }

  grid.innerHTML = items.map(([label, value]) => `
    <div class="stat">
      <div class="k">${escapeHtml(label)}</div>
      <div class="v">${escapeHtml(String(value))}</div>
      <div class="d">来自后端统计接口</div>
    </div>
  `).join("");
}

function renderMembers(payload) {
  const rows = normalizeListPayload(payload, ["members", "items", "rows"]);
  $("#adminMembersSummary").textContent = rows.length ? `${rows.length} 条成员记录` : "接口未返回成员记录";
  renderTable("#membersBody", rows, 7, (row) => `
    <tr>
      <td>${escapeHtml(displayValue(row.cohort, ""))}</td>
      <td>${escapeHtml(displayValue(row.spirit_name || row.spiritName, ""))}</td>
      <td>${escapeHtml(displayValue(row.real_name || row.realName, ""))}</td>
      <td>${escapeHtml(displayValue(row.city, ""))}</td>
      <td>${escapeHtml(displayValue(row.current_status || row.currentStatus, ""))}</td>
      <td class="mono">${escapeHtml(displayValue(row.wechat, ""))}</td>
      <td class="mono">${escapeHtml(displayValue(row.updated_at || row.updatedAt, ""))}</td>
    </tr>
  `);
}

function renderResponses(payload) {
  const rows = normalizeListPayload(payload, ["responses", "items", "rows"]);
  $("#adminResponsesSummary").textContent = rows.length ? `${rows.length} 条问卷回应` : "接口未返回问卷回应";
  renderTable("#responsesBody", rows, 7, (row) => `
    <tr>
      <td>${escapeHtml(displayValue(row.member_name || row.memberName || row.spirit_name || row.spiritName, ""))}</td>
      <td>${escapeHtml(displayValue(row.will_attend || row.willAttend, ""))}</td>
      <td>${escapeHtml(displayValue(row.current_status || row.currentStatus, ""))}</td>
      <td>${escapeHtml(displayValue(row.future_activities || row.futureActivities, ""))}</td>
      <td>${escapeHtml(displayValue(row.market_interest || row.marketInterest, ""))}</td>
      <td>${escapeHtml(displayValue(row.message_to_csight || row.messageToCsight, ""))}</td>
      <td class="mono">${escapeHtml(displayValue(row.created_at || row.createdAt, ""))}</td>
    </tr>
  `);
}

function renderRecovery(payload) {
  const rows = normalizeListPayload(payload, ["recovery", "requests", "items", "rows"]);
  $("#adminRecoverySummary").textContent = rows.length ? `${rows.length} 条恢复请求` : "接口未返回恢复请求";
  renderTable("#recoveryBody", rows, 7, (row) => `
    <tr>
      <td>${escapeHtml(displayValue(row.real_name || row.realName, ""))}</td>
      <td>${escapeHtml(displayValue(row.spirit_name || row.spiritName, ""))}</td>
      <td>${escapeHtml(displayValue(row.cohort, ""))}</td>
      <td class="mono">${escapeHtml(displayValue(row.phone, ""))}</td>
      <td>${escapeHtml(displayValue(row.old_contact || row.oldContact, ""))}</td>
      <td>${escapeHtml(displayValue(row.status, ""))}</td>
      <td class="mono">${escapeHtml(displayValue(row.created_at || row.createdAt, ""))}</td>
    </tr>
  `);
}

function renderTable(selector, rows, colspan, rowRenderer) {
  const body = $(selector);
  if (!body) return;
  if (!rows.length) {
    body.innerHTML = `<tr><td colspan="${colspan}" class="empty-cell">接口未返回数据</td></tr>`;
    return;
  }
  body.innerHTML = rows.map(rowRenderer).join("");
}

async function loadAdminData() {
  if (!state.adminPassword) {
    route("admin-login");
    return;
  }
  const button = $("#adminRefresh");
  setBusy(button, true, "刷新中...");
  clearMessage($("#adminMsg"));
  const endpoints = [
    ["stats", "/api/admin/stats", renderStats],
    ["members", "/api/admin/members", renderMembers],
    ["responses", "/api/admin/responses", renderResponses],
    ["recovery", "/api/admin/recovery", renderRecovery]
  ];
  const results = await Promise.allSettled(endpoints.map(([, path]) => apiRequest(path, { admin: true })));
  const failures = [];
  results.forEach((result, index) => {
    const [name, , renderer] = endpoints[index];
    if (result.status === "fulfilled") {
      renderer(result.value);
    } else {
      failures.push(`${name}: ${result.reason?.message || "接口不可用"}`);
    }
  });
  state.adminLoaded = true;
  if (failures.length) {
    setMessage($("#adminMsg"), "warn", `部分后台接口暂时不可用：${failures.join("；")}`);
  } else {
    setMessage($("#adminMsg"), "ok", "后台数据已从接口同步。");
  }
  setBusy(button, false);
}

async function importCsv() {
  const type = $("#csvType").value;
  const csv = $("#csvText").value;
  if (type !== "members") {
    setMessage($("#csvMsg"), "error", "当前 MVP 只支持导入成员名单。问卷、集市和参会名单请使用导出。");
    return;
  }
  if (!csv.trim()) {
    setMessage($("#csvMsg"), "error", "请先粘贴要导入的 CSV 文本。");
    return;
  }
  setMessage($("#csvMsg"), "warn", "正在提交 CSV 到后端...");
  try {
    const payload = await apiRequest("/api/admin/import-members", {
      admin: true,
      body: { type, csv }
    });
    setMessage($("#csvMsg"), "ok", payload.message || "CSV 已提交给后端处理。");
    await loadAdminData();
  } catch (error) {
    setMessage($("#csvMsg"), "error", `${error.message || "导入失败"}。`);
  }
}

async function exportCsv() {
  const type = $("#csvType").value;
  setMessage($("#csvMsg"), "warn", "正在从后端拉取 CSV...");
  try {
    const payload = await apiRequest(`/api/admin/export?type=${encodeURIComponent(type)}`, { admin: true });
    const csv = typeof payload === "string" ? payload : payload.csv || payload.text || "";
    $("#csvText").value = csv || JSON.stringify(payload, null, 2);
    setMessage($("#csvMsg"), "ok", "已从后端拉取导出内容。");
  } catch (error) {
    setMessage($("#csvMsg"), "error", `${error.message || "导出失败"}。`);
  }
}

async function copyCsv() {
  const text = $("#csvText").value;
  if (!text) {
    setMessage($("#csvMsg"), "error", "没有可复制的 CSV 文本。");
    return;
  }
  try {
    await navigator.clipboard.writeText(text);
    setMessage($("#csvMsg"), "ok", "CSV 文本已复制。");
  } catch {
    setMessage($("#csvMsg"), "warn", "浏览器不允许自动复制，请手动选中文本复制。");
  }
}

function downloadCsv() {
  const text = $("#csvText").value;
  if (!text) {
    setMessage($("#csvMsg"), "error", "没有可下载的 CSV 文本。");
    return;
  }
  const type = $("#csvType").value;
  const blob = new Blob([text], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `csight-${type}-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function bindEvents() {
  $$("[data-route]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.preventDefault();
      route(button.dataset.route);
    });
  });
  $$("[data-admin-panel]").forEach((button) => {
    button.addEventListener("click", () => adminView(button.dataset.adminPanel));
  });

  $("#verifyForm")?.addEventListener("submit", handleVerify);
  $("#contactForm")?.addEventListener("submit", submitContact);
  $("#contactConfirmBtn")?.addEventListener("click", () => $("#contactForm")?.requestSubmit());
  $("#surveyForm")?.addEventListener("submit", submitSurvey);
  $("#saveDraftBtn")?.addEventListener("click", saveDraft);
  $("#recoverForm")?.addEventListener("submit", submitRecovery);

  $("#adminPasswordSave")?.addEventListener("click", saveAdminPassword);
  $("#adminPasswordClear")?.addEventListener("click", clearAdminPassword);
  $("#adminLogout")?.addEventListener("click", clearAdminPassword);
  $("#adminRefresh")?.addEventListener("click", loadAdminData);
  $("#csvImport")?.addEventListener("click", importCsv);
  $("#csvExport")?.addEventListener("click", exportCsv);
  $("#csvCopy")?.addEventListener("click", copyCsv);
  $("#csvDownload")?.addEventListener("click", downloadCsv);
}

function boot() {
  bindEvents();
  enableContactForm(hasVerifiedIdentity());
  if (state.adminPassword) $("#adminPassword").value = state.adminPassword;
  restoreDraft();
  loadConfig();
  loadMemberFromToken();

  const startHash = window.location.hash.replace("#", "");
  route(startHash && document.getElementById(startHash) ? startHash : "home", { silent: true });
  window.addEventListener("hashchange", () => {
    const next = window.location.hash.replace("#", "");
    route(next && document.getElementById(next) ? next : "home", { silent: true });
  });
}

boot();

