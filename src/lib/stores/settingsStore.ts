// --- Types ---

export interface WorkspaceSettings {
  reminderEnabled: boolean;
  /** Integer 8..22 inclusive (R4.5). */
  reminderHour: number;
  /** 1..12 inclusive, multiple of 0.5 (R4.5). */
  targetHours: number;
}

export interface SettingsValidation {
  valid: boolean;
  errors: { reminderHour?: string; targetHours?: string };
}

// --- Defaults ---

export const DEFAULT_WORKSPACE_SETTINGS: WorkspaceSettings = {
  reminderEnabled: false,
  reminderHour: 9,
  targetHours: 8,
};

// --- Pure validation (R4.5) ---

/**
 * Pure: validate a `WorkspaceSettings` value against the rules from R4.5.
 *
 *  - `reminderHour` must be an integer in [8, 22]
 *  - `targetHours` must be in [1, 12] and a multiple of 0.5
 *
 * When `valid` is `false`, the `errors` object has a key for each violated
 * input.
 */
export function validateWorkspaceSettings(s: WorkspaceSettings): SettingsValidation {
  const errors: { reminderHour?: string; targetHours?: string } = {};

  const { reminderHour, targetHours } = s;

  if (
    typeof reminderHour !== "number" ||
    !Number.isFinite(reminderHour) ||
    !Number.isInteger(reminderHour) ||
    reminderHour < 8 ||
    reminderHour > 22
  ) {
    errors.reminderHour = "Reminder hour must be an integer between 8 and 22.";
  }

  if (
    typeof targetHours !== "number" ||
    !Number.isFinite(targetHours) ||
    targetHours < 1 ||
    targetHours > 12 ||
    !Number.isInteger(targetHours * 2)
  ) {
    errors.targetHours = "Target hours must be between 1 and 12 in 0.5 increments.";
  }

  return { valid: Object.keys(errors).length === 0, errors };
}

// --- Pure helpers ---

/** Pure: weekly target derived from `targetHours` per R10.2. */
export function weeklyTarget(targetHours: number): number {
  return targetHours * 5;
}

/** Pure: clamp `x` to `[0, 1]` per R10.3. NaN is treated as 0. */
export function clamp01(x: number): number {
  if (Number.isNaN(x)) return 0;
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}

/** Pure: convert hours to seconds, rounded to the nearest integer (R9.3). */
export function secondsForHours(h: number): number {
  return Math.round(h * 3600);
}

/**
 * Pure: convert a `YYYY-MM-DD` date string to the Jira `started` format
 * expected by `add_worklog` (R9.3).
 */
export function jiraStarted(date: string): string {
  return `${date}T09:00:00.000+0000`;
}

// --- Persistence (R14.6) ---

const SETTINGS_FILE = "settings.json";
const KEY_REMINDER_ENABLED = "reminderEnabled";
const KEY_REMINDER_HOUR = "reminderHour";
const KEY_TARGET_HOURS = "targetHours";

/**
 * Load workspace settings from `settings.json`. Returns sensible defaults
 * (`{ reminderEnabled: false, reminderHour: 9, targetHours: 8 }`) on any
 * error or for any missing/invalid keys.
 */
export async function loadWorkspaceSettings(): Promise<WorkspaceSettings> {
  try {
    const { load } = await import("@tauri-apps/plugin-store");
    const store = await load(SETTINGS_FILE);

    const reminderEnabledRaw = await store.get<boolean>(KEY_REMINDER_ENABLED);
    const reminderHourRaw = await store.get<number>(KEY_REMINDER_HOUR);
    const targetHoursRaw = await store.get<number>(KEY_TARGET_HOURS);

    const reminderEnabled =
      typeof reminderEnabledRaw === "boolean"
        ? reminderEnabledRaw
        : DEFAULT_WORKSPACE_SETTINGS.reminderEnabled;

    const reminderHour =
      typeof reminderHourRaw === "number" && Number.isFinite(reminderHourRaw)
        ? reminderHourRaw
        : DEFAULT_WORKSPACE_SETTINGS.reminderHour;

    const targetHours =
      typeof targetHoursRaw === "number" && Number.isFinite(targetHoursRaw)
        ? targetHoursRaw
        : DEFAULT_WORKSPACE_SETTINGS.targetHours;

    return { reminderEnabled, reminderHour, targetHours };
  } catch {
    return { ...DEFAULT_WORKSPACE_SETTINGS };
  }
}

/**
 * Persist workspace settings to `settings.json` using the existing key names
 * shared with credentials (R14.6).
 */
export async function saveWorkspaceSettings(s: WorkspaceSettings): Promise<void> {
  const { load } = await import("@tauri-apps/plugin-store");
  const store = await load(SETTINGS_FILE);
  await store.set(KEY_REMINDER_ENABLED, s.reminderEnabled);
  await store.set(KEY_REMINDER_HOUR, s.reminderHour);
  await store.set(KEY_TARGET_HOURS, s.targetHours);
  await store.save();
}
