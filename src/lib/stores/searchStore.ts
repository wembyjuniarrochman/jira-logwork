import { invoke } from "@tauri-apps/api/core";

// --- Types ---

export interface SearchResult {
  key: string;
  summary: string;
  /** Nama issue type ("Epic", "Task", "Sub-task", "Story", "Bug", dll.) jika
   *  tersedia di response Jira. UI memakainya untuk badge type per result. */
  issueType?: string;
  /**
   * Jumlah sub-task milik issue ini, dibaca dari `fields.subtasks.length`.
   * Dipakai UniversalSearch untuk menampilkan chevron expand hanya saat
   * issue benar-benar punya children. Hanya valid untuk Task/Story/Bug
   * (Epic punya children via `parent` link, bukan `subtasks` field — jadi
   * pengecekan-nya lewat `fetchParentsWithChildren`).
   */
  subtasksCount?: number;
}

export interface SearchContext {
  baseUrl: string;
  email: string;
  apiToken: string;
  isCloud: boolean;
}

export interface JiraProject {
  id: string;
  key: string;
  name: string;
}

interface JiraIssue {
  key?: string;
  fields?: {
    summary?: string;
    issuetype?: { name?: string };
    subtasks?: unknown[];
  };
}

// --- Pure helpers ---

/**
 * Pattern for queries that look like an issue key (e.g. "PROJ-123").
 * Case-insensitive: prefix uppercase letters/digits/underscores, dash, then digits.
 */
export const ISSUE_KEY_REGEX = /^[A-Z][A-Z0-9_]+-\d+$/i;

/** Pure: returns true iff `query` matches `ISSUE_KEY_REGEX`. */
export function looksLikeIssueKey(query: string): boolean {
  return ISSUE_KEY_REGEX.test(query);
}

/**
 * Pure: flatten and dedupe a list of result lists by `key`.
 * Order is first-seen across nested arrays (outer index, then inner index).
 */
export function mergeAndDedupeResults(lists: SearchResult[][]): SearchResult[] {
  const seen = new Set<string>();
  const out: SearchResult[] = [];
  for (const list of lists) {
    for (const item of list) {
      if (!item || typeof item.key !== "string") continue;
      if (seen.has(item.key)) continue;
      seen.add(item.key);
      out.push(item);
    }
  }
  return out;
}

/**
 * When a search returns an Epic alongside its matching tasks, render the
 * Epic as the single root. Its children remain available through the existing
 * expandable tree, so a reference shared by many tasks does not repeat the
 * same hierarchy as a flat result list.
 *
 * If no Epic matches, preserve every result: a task-only search must still
 * be selectable.
 */
export function preferEpicRoots(results: SearchResult[]): SearchResult[] {
  const epics = results.filter(
    (result) => (result.issueType ?? "").trim().toLowerCase() === "epic",
  );
  return epics.length > 0 ? epics : results;
}

/**
 * Jira's global text index does not reliably return punctuation and numeric
 * references embedded in summaries. For these queries, search each project
 * rather than relying on one globally-sorted candidate page.
 */
export function requiresProjectFanout(query: string): boolean {
  const text = query.trim();
  if (!text) return false;
  const hasSpecialCharacter = [...text].some(
    (character) => !/[\p{L}\p{N}\s]/u.test(character),
  );
  const numberOnly = /^[0-9]+$/.test(text);
  return hasSpecialCharacter || numberOnly;
}

// --- Response parsing ---

/**
 * Parse the raw response from the `search_issues` Tauri command.
 * The command may return either a JSON string or an already-parsed object.
 * The shape is `{ issues: [{ key, fields: { summary } }] }` or a bare array.
 */
function parseSearchResponse(raw: unknown): SearchResult[] {
  let data: unknown;
  if (typeof raw === "string") {
    try {
      data = JSON.parse(raw);
    } catch {
      return [];
    }
  } else {
    data = raw;
  }

  let issues: JiraIssue[] = [];
  if (data && typeof data === "object" && Array.isArray((data as { issues?: unknown }).issues)) {
    issues = (data as { issues: JiraIssue[] }).issues;
  } else if (Array.isArray(data)) {
    issues = data as JiraIssue[];
  }

  const out: SearchResult[] = [];
  for (const issue of issues) {
    if (!issue || typeof issue.key !== "string") continue;
    const subs = issue.fields?.subtasks;
    out.push({
      key: issue.key,
      summary: issue.fields?.summary ?? "",
      issueType: issue.fields?.issuetype?.name,
      subtasksCount: Array.isArray(subs) ? subs.length : undefined,
    });
  }
  return out;
}

// --- Tauri calls ---

async function callSearchIssues(
  ctx: SearchContext,
  projectKey: string,
  query: string,
): Promise<SearchResult[]> {
  const raw = await invoke("search_issues", {
    baseUrl: ctx.baseUrl,
    email: ctx.email,
    apiToken: ctx.apiToken,
    isCloud: ctx.isCloud,
    projectKey,
    query,
  });
  return parseSearchResponse(raw);
}

async function callGetProjects(ctx: SearchContext): Promise<JiraProject[]> {
  return await invoke<JiraProject[]>("get_projects", {
    baseUrl: ctx.baseUrl,
    email: ctx.email,
    apiToken: ctx.apiToken,
    isCloud: ctx.isCloud,
  });
}

/**
 * Search for `query` first via empty-projectKey, then on rejection fan out
 * across `get_projects` and merge per-project results. Per-project failures
 * are treated as empty result lists.
 *
 * Kalau `projectKey` diisi (dipanggil dari Project picker di QuickLogCard),
 * skip fan-out dan langsung query satu project saja — pengguna sudah
 * memilih scope-nya, jadi tidak perlu coba semua project dulu.
 */
async function searchByQuery(
  ctx: SearchContext,
  query: string,
  projectKey?: string,
): Promise<SearchResult[]> {
  if (projectKey) {
    try {
      return await callSearchIssues(ctx, projectKey, query);
    } catch {
      return [];
    }
  }

  // For references such as `1460` or `[IRQ-1460]`, the backend performs a
  // literal summary match. A global Jira request is sorted across every
  // project and can omit an older match, so explicitly fan out per project.
  if (requiresProjectFanout(query)) {
    let projects: JiraProject[];
    try {
      projects = await callGetProjects(ctx);
    } catch {
      // Keep the standard global request as a best-effort fallback when the
      // project list is unavailable.
      try {
        return await callSearchIssues(ctx, "", query);
      } catch {
        return [];
      }
    }
    const perProject = await Promise.all(
      projects.map(async (project) => {
        try {
          return await callSearchIssues(ctx, project.key, query);
        } catch {
          return [] as SearchResult[];
        }
      }),
    );
    return mergeAndDedupeResults(perProject);
  }

  try {
    return await callSearchIssues(ctx, "", query);
  } catch {
    let projects: JiraProject[];
    try {
      projects = await callGetProjects(ctx);
    } catch {
      return [];
    }
    const perProject = await Promise.all(
      projects.map(async (p) => {
        try {
          return await callSearchIssues(ctx, p.key, query);
        } catch {
          return [] as SearchResult[];
        }
      }),
    );
    return mergeAndDedupeResults(perProject);
  }
}

// --- Request-id tracking ---

// Module-level counter incremented per `searchAll` call; the latest request wins.
// Stale responses (where `myId !== latestRequestId`) are dropped.
let latestRequestId = 0;

/**
 * Orchestrate Universal Search per R7.2/R7.3/R7.4/R7.5:
 *  1. Try `search_issues` with empty `projectKey` (or scoped to `opts.projectKey`).
 *  2. On rejection, fan out via `get_projects` + `Promise.all` and merge.
 *  3. If `looksLikeIssueKey(query)`, also query the exact uppercase key and merge.
 *  4. If a newer call has started while this one was awaiting, drop the stale
 *     result and return `[]`.
 */
export async function searchAll(
  ctx: SearchContext,
  query: string,
  opts: { projectKey?: string } = {},
): Promise<SearchResult[]> {
  const myId = ++latestRequestId;
  const isStale = (): boolean => myId !== latestRequestId;

  const textResults = await searchByQuery(ctx, query, opts.projectKey);
  if (isStale()) return [];

  // A project fan-out already normalizes and resolves exact keys in the
  // backend. Avoid dispatching the same all-project search twice for a key
  // that can also appear as a summary reference (for example `IRQ-1460`).
  if (looksLikeIssueKey(query) && !requiresProjectFanout(query)) {
    const exactKey = query.toUpperCase();
    const exactResults = await searchByQuery(ctx, exactKey, opts.projectKey);
    if (isStale()) return [];
    return mergeAndDedupeResults([textResults, exactResults]);
  }

  return textResults;
}

/**
 * Fetch the list of projects via the Tauri `get_projects` command. Lifted
 * out of internal scope so QuickLogCard can populate its project picker.
 */
export async function fetchProjects(ctx: SearchContext): Promise<JiraProject[]> {
  return callGetProjects(ctx);
}

/**
 * Fetch only the Epic-typed issues for a project. Used as the initial
 * tree root in UniversalSearch when a project is selected and the search
 * input is empty — Tasks/Stories are loaded under each Epic via
 * `fetchChildren` once the user expands an Epic row.
 */
export async function fetchProjectEpics(
  ctx: SearchContext,
  projectKey: string,
): Promise<SearchResult[]> {
  const raw = await invoke("get_project_epics", {
    baseUrl: ctx.baseUrl,
    email: ctx.email,
    apiToken: ctx.apiToken,
    isCloud: ctx.isCloud,
    projectKey,
  });
  return parseSearchResponse(raw);
}

/**
 * Fetch direct child issues of `parentKey` via the `get_issue_children`
 * Tauri command. Used by UniversalSearch to lazily expand Epic → Tasks
 * and Task/Story → Sub-tasks in the tree view. Returns parsed
 * `SearchResult` objects (key, summary, issueType) so the same renderer
 * can be reused for child rows.
 */
export async function fetchChildren(
  ctx: SearchContext,
  parentKey: string,
): Promise<SearchResult[]> {
  const raw = await invoke("get_issue_children", {
    baseUrl: ctx.baseUrl,
    email: ctx.email,
    apiToken: ctx.apiToken,
    isCloud: ctx.isCloud,
    parentKey,
  });
  return parseSearchResponse(raw);
}

/**
 * Given a list of parent keys (typically Epics), return only the keys
 * that actually have at least one child issue. The Rust command runs a
 * single `parent in (...)` JQL and dedupes server-side, so this lets
 * UniversalSearch decide upfront which Epic rows deserve a chevron in
 * the tree picker — without chasing each Epic individually.
 *
 * Returns a Set for O(1) lookup at render time.
 */
export async function fetchParentsWithChildren(
  ctx: SearchContext,
  parentKeys: string[],
): Promise<Set<string>> {
  if (parentKeys.length === 0) return new Set();
  const found = await invoke<string[]>("get_parents_with_children", {
    baseUrl: ctx.baseUrl,
    email: ctx.email,
    apiToken: ctx.apiToken,
    isCloud: ctx.isCloud,
    parentKeys,
  });
  return new Set(Array.isArray(found) ? found : []);
}

// --- Test-only helper ---

/**
 * Reset the module-level request-id counter. Intended for tests so successive
 * test cases start from a known state.
 */
export function _resetRequestIdForTests(): void {
  latestRequestId = 0;
}

// --- Create issue helpers -------------------------------------------------

export interface AssignableUser {
  accountId: string;
  displayName: string;
}

export interface CreateIssueTypeOption {
  /** Issuetype `name` as Jira expects it in the POST /issue payload. */
  name: string;
  /** Whether this is a subtask issuetype. Used to split the dropdown between
   *  Add-in-Epic (non-subtask only) and Add-in-Task (subtask only). */
  subtask: boolean;
}

export interface AllowedValueOption {
  /** Stable id Jira returns for the option (used as the form value). */
  id: string;
  /** Human label rendered in the dropdown. */
  label: string;
}

export interface CustomFieldOption {
  /** Field key, e.g. `customfield_10050` — used as the JSON key in `fields`. */
  key: string;
  /** Display name, e.g. "Work Reference". */
  name: string;
  /** Available options when the field is a select list. Empty for free-text. */
  allowedValues: AllowedValueOption[];
}

export interface ProjectCreateMeta {
  /** All issuetypes available for the project. */
  issueTypes: CreateIssueTypeOption[];
  /** "Work Reference" custom field if present in the project's createmeta,
   *  else null. The frontend skips that dropdown when null. */
  workReference: CustomFieldOption | null;
}

/**
 * Pure: derive `project_key` from an issue key like "UMS-18" → "UMS".
 * Falls back to the whole input when no dash is present.
 */
export function projectKeyFromIssueKey(issueKey: string): string {
  const idx = issueKey.lastIndexOf("-");
  return idx > 0 ? issueKey.slice(0, idx) : issueKey;
}

/**
 * Pure: parse the createmeta payload returned by the `get_create_meta`
 * Tauri command. Walks `projects[0].issuetypes` for issuetype options and
 * the per-issuetype `fields` map to discover the "Work Reference" custom
 * field plus its allowed values.
 */
export function parseCreateMeta(raw: unknown): ProjectCreateMeta {
  let data: unknown = raw;
  if (typeof raw === "string") {
    try {
      data = JSON.parse(raw);
    } catch {
      return { issueTypes: [], workReference: null };
    }
  }
  const projects = (data as { projects?: unknown[] } | null)?.projects;
  const project = Array.isArray(projects) ? (projects[0] as Record<string, unknown>) : null;
  const issuetypes = Array.isArray(project?.issuetypes) ? (project!.issuetypes as Record<string, unknown>[]) : [];

  const issueTypes: CreateIssueTypeOption[] = [];
  let workReference: CustomFieldOption | null = null;

  for (const it of issuetypes) {
    const name = typeof it.name === "string" ? it.name : "";
    if (!name) continue;
    issueTypes.push({ name, subtask: Boolean(it.subtask) });

    // Walk this issuetype's fields once to find Work Reference. Stop the
    // first time we find it — the same custom field is repeated across
    // issuetypes with identical allowedValues, so any occurrence is fine.
    if (!workReference) {
      const fields = (it.fields ?? {}) as Record<string, Record<string, unknown>>;
      for (const [key, field] of Object.entries(fields)) {
        const fname = typeof field?.name === "string" ? field.name : "";
        if (fname.trim().toLowerCase() !== "work reference") continue;
        const allowed = Array.isArray(field.allowedValues) ? field.allowedValues as Record<string, unknown>[] : [];
        const allowedValues: AllowedValueOption[] = allowed.map((opt) => ({
          id: typeof opt.id === "string" ? opt.id : String(opt.id ?? ""),
          label:
            (typeof opt.value === "string" && opt.value) ||
            (typeof opt.name === "string" && opt.name) ||
            String(opt.id ?? ""),
        })).filter((o) => o.id);
        workReference = { key, name: fname, allowedValues };
        break;
      }
    }
  }

  return { issueTypes, workReference };
}

/**
 * Pure: from a list of issuetypes, find the one Jira marks as a subtask.
 * Returns the `name` (what the POST /issue payload expects) or null when
 * the project has no subtask issuetype.
 */
export function findSubtaskIssueTypeName(meta: ProjectCreateMeta): string | null {
  return meta.issueTypes.find((t) => t.subtask)?.name ?? null;
}

/**
 * Fetch createmeta for a project (issuetypes + custom fields). Cached
 * per-project for the session to avoid repeated fetches when the user
 * opens the inline form on multiple rows.
 */
const createMetaCache = new Map<string, ProjectCreateMeta>();

export async function fetchCreateMeta(
  ctx: SearchContext,
  projectKey: string,
): Promise<ProjectCreateMeta> {
  const cached = createMetaCache.get(projectKey);
  if (cached) return cached;
  const raw = await invoke("get_create_meta", {
    baseUrl: ctx.baseUrl,
    email: ctx.email,
    apiToken: ctx.apiToken,
    isCloud: ctx.isCloud,
    projectKey,
  });
  const parsed = parseCreateMeta(raw);
  createMetaCache.set(projectKey, parsed);
  return parsed;
}

/** Pure: parse the assignable-users response from `get_assignable_users`. */
export function parseAssignableUsers(raw: unknown): AssignableUser[] {
  let data: unknown = raw;
  if (typeof raw === "string") {
    try {
      data = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  const arr = Array.isArray(data) ? (data as Record<string, unknown>[]) : [];
  const out: AssignableUser[] = [];
  for (const u of arr) {
    const accountId = typeof u.accountId === "string" ? u.accountId : (typeof u.name === "string" ? u.name : "");
    const displayName = typeof u.displayName === "string" ? u.displayName : accountId;
    if (!accountId) continue;
    out.push({ accountId, displayName });
  }
  return out;
}

const assignableUsersCache = new Map<string, AssignableUser[]>();

export async function fetchAssignableUsers(
  ctx: SearchContext,
  projectKey: string,
): Promise<AssignableUser[]> {
  const cached = assignableUsersCache.get(projectKey);
  if (cached) return cached;
  const raw = await invoke("get_assignable_users", {
    baseUrl: ctx.baseUrl,
    email: ctx.email,
    apiToken: ctx.apiToken,
    isCloud: ctx.isCloud,
    projectKey,
  });
  const parsed = parseAssignableUsers(raw);
  assignableUsersCache.set(projectKey, parsed);
  return parsed;
}

export interface CreateIssueInput {
  projectKey: string;
  issueTypeName: string;
  summary: string;
  parentKey?: string;
  assigneeAccountId?: string;
  /** Extra `customfield_XXXXX` → value pairs forwarded verbatim to Jira. */
  customFields?: Record<string, unknown>;
}

/** Create a Jira issue. Returns the new issue's `key` (e.g. "UMS-180"). */
export async function createIssue(
  ctx: SearchContext,
  input: CreateIssueInput,
): Promise<string> {
  const raw = await invoke<string>("create_issue", {
    baseUrl: ctx.baseUrl,
    email: ctx.email,
    apiToken: ctx.apiToken,
    isCloud: ctx.isCloud,
    projectKey: input.projectKey,
    issuetypeName: input.issueTypeName,
    summary: input.summary,
    parentKey: input.parentKey ?? null,
    assigneeAccountId: input.assigneeAccountId ?? null,
    customFields: input.customFields ?? null,
  });
  try {
    const parsed = JSON.parse(raw) as { key?: string };
    return parsed.key ?? "";
  } catch {
    return "";
  }
}

/** Test-only: clear per-project caches so successive tests don't bleed. */
export function _resetCreateCachesForTests(): void {
  createMetaCache.clear();
  assignableUsersCache.clear();
}
