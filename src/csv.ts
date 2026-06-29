import type { ImportIssue, ImportMemberRecord } from "./types";

export const MEMBER_CSV_HEADERS = [
  "精灵名",
  "期数",
  "姓名",
  "手机号",
  "微信号",
  "邮箱",
  "省份",
  "城市",
  "所在公司及现任职务",
  "你目前主要关注或从事的领域",
  "当前状态",
  "用一句话介绍现在的自己",
  "角色",
] as const;

const MEMBER_FIELD_ALIASES = {
  spiritName: ["精灵名", "spirit_name"],
  cohort: ["期数", "cohort"],
  realName: ["姓名", "真实姓名", "real_name"],
  phone: ["手机号", "phone"],
  wechat: ["微信号", "微信", "wechat"],
  email: ["邮箱", "email"],
  province: ["省份", "province"],
  city: ["城市", "当前所在城市", "city"],
  companyTitle: ["所在公司及现任职务", "公司 / 角色", "公司/角色", "company_title"],
  focusFields: ["你目前主要关注或从事的领域", "关注领域", "focus_fields"],
  currentStatus: ["当前状态", "current_status"],
  selfIntro: ["用一句话介绍现在的自己", "一句话介绍", "self_intro"],
  role: ["角色", "role"],
  directoryVisibility: ["通讯录授权", "directory_visibility"],
} as const;

export class CsvValidationError extends Error {
  readonly details: string[];

  constructor(message: string, details: string[] = []) {
    super(message);
    this.name = "CsvValidationError";
    this.details = details;
  }
}

export interface ParsedMemberCsv {
  records: ImportMemberRecord[];
  errors: ImportIssue[];
}

export interface CsvHeader<T extends string> {
  key: T;
  label: string;
}

export function parseCsv(text: string): string[][] {
  const input = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];

    if (inQuotes) {
      if (char === '"') {
        if (input[index + 1] === '"') {
          cell += '"';
          index += 1;
        } else {
          inQuotes = false;
        }
      } else {
        cell += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
      continue;
    }

    if (char === ",") {
      row.push(cell);
      cell = "";
      continue;
    }

    if (char === "\n" || char === "\r") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      if (char === "\r" && input[index + 1] === "\n") {
        index += 1;
      }
      continue;
    }

    cell += char;
  }

  if (inQuotes) {
    throw new CsvValidationError("CSV 引号没有正确闭合");
  }

  if (cell !== "" || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }

  return rows;
}

export function parseMembersCsv(text: string): ParsedMemberCsv {
  const rows = parseCsv(text).filter((row) => !isEmptyRow(row));
  if (rows.length === 0) {
    throw new CsvValidationError("CSV 不能为空");
  }

  const headers = rows[0].map((header) => header.trim());
  const missingHeaders = [
    requiredHeaderLabel("spiritName", headers),
    requiredHeaderLabel("phone", headers),
  ].filter((label): label is string => Boolean(label));

  if (missingHeaders.length > 0) {
    throw new CsvValidationError("CSV 表头不完整，至少需要精灵名和手机号", missingHeaders);
  }

  const headerIndex = new Map(headers.map((header, index) => [header, index]));
  const records: ImportMemberRecord[] = [];
  const errors: ImportIssue[] = [];
  const phonesInFile = new Set<string>();

  for (let index = 1; index < rows.length; index += 1) {
    const row = rows[index];
    const sourceRow = index + 1;
    const record: ImportMemberRecord = {
      sourceRow,
      spiritName: getAliasedCell(row, headerIndex, MEMBER_FIELD_ALIASES.spiritName),
      cohort: nullable(getAliasedCell(row, headerIndex, MEMBER_FIELD_ALIASES.cohort)),
      realName: nullable(getAliasedCell(row, headerIndex, MEMBER_FIELD_ALIASES.realName)),
      phone: getAliasedCell(row, headerIndex, MEMBER_FIELD_ALIASES.phone),
      wechat: nullable(getAliasedCell(row, headerIndex, MEMBER_FIELD_ALIASES.wechat)),
      email: nullable(getAliasedCell(row, headerIndex, MEMBER_FIELD_ALIASES.email)),
      province: nullable(getAliasedCell(row, headerIndex, MEMBER_FIELD_ALIASES.province)),
      city: nullable(getAliasedCell(row, headerIndex, MEMBER_FIELD_ALIASES.city)),
      companyTitle: nullable(getAliasedCell(row, headerIndex, MEMBER_FIELD_ALIASES.companyTitle)),
      focusFields: nullable(getAliasedCell(row, headerIndex, MEMBER_FIELD_ALIASES.focusFields)),
      currentStatus: nullable(getAliasedCell(row, headerIndex, MEMBER_FIELD_ALIASES.currentStatus)),
      selfIntro: nullable(getAliasedCell(row, headerIndex, MEMBER_FIELD_ALIASES.selfIntro)),
      role: nullable(getAliasedCell(row, headerIndex, MEMBER_FIELD_ALIASES.role)) ?? "校友",
      directoryVisibility:
        normalizeVisibility(getAliasedCell(row, headerIndex, MEMBER_FIELD_ALIASES.directoryVisibility)) ??
        "internal",
    };

    if (!record.spiritName.trim()) {
      errors.push({ row: sourceRow, message: "缺少必填字段：精灵名" });
      continue;
    }

    if (!record.phone.trim()) {
      errors.push({ row: sourceRow, message: "缺少必填字段：手机号" });
      continue;
    }

    const normalizedPhone = normalizeCsvPhone(record.phone);
    if (phonesInFile.has(normalizedPhone)) {
      errors.push({ row: sourceRow, message: "CSV 中手机号重复，已跳过该行" });
      continue;
    }

    phonesInFile.add(normalizedPhone);
    records.push({ ...record, phone: normalizedPhone, spiritName: record.spiritName.trim() });
  }

  return { records, errors };
}

export function stringifyCsv<T extends string>(
  headers: CsvHeader<T>[],
  rows: Array<Record<T, unknown>>,
): string {
  const headerLine = headers.map((header) => escapeCsvValue(header.label)).join(",");
  const lines = rows.map((row) =>
    headers.map((header) => escapeCsvValue(row[header.key])).join(","),
  );
  return `\uFEFF${[headerLine, ...lines].join("\r\n")}\r\n`;
}

function getCell(row: string[], headerIndex: Map<string, number>, header: string): string {
  const index = headerIndex.get(header);
  if (index === undefined) {
    return "";
  }
  return (row[index] ?? "").trim();
}

function getAliasedCell(
  row: string[],
  headerIndex: Map<string, number>,
  aliases: readonly string[],
): string {
  for (const alias of aliases) {
    const value = getCell(row, headerIndex, alias);
    if (value !== "") {
      return value;
    }
    if (headerIndex.has(alias)) {
      return value;
    }
  }
  return "";
}

function requiredHeaderLabel(field: keyof typeof MEMBER_FIELD_ALIASES, headers: string[]): string | null {
  return MEMBER_FIELD_ALIASES[field].some((alias) => headers.includes(alias))
    ? null
    : MEMBER_FIELD_ALIASES[field][0];
}

function isEmptyRow(row: string[]): boolean {
  return row.every((cell) => cell.trim() === "");
}

function nullable(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function normalizeVisibility(value: string): string | null {
  const text = value.trim();
  if (!text) {
    return null;
  }
  if (text === "alumni" || text.includes("公开") || text.includes("愿意")) {
    return "alumni";
  }
  if (text === "internal" || text.includes("内部") || text.includes("留存")) {
    return "internal";
  }
  return text;
}

function normalizeCsvPhone(value: string): string {
  const stripped = value.replace(/[\s\-()（）]/g, "");
  if (stripped.startsWith("+86")) {
    return stripped.slice(3);
  }
  if (stripped.startsWith("86") && stripped.length === 13) {
    return stripped.slice(2);
  }
  return stripped;
}

function escapeCsvValue(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }
  const text = Array.isArray(value) ? value.join("、") : String(value);
  if (/[",\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}
