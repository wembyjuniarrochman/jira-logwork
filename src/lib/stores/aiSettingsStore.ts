/** Per-user preferences for the optional AI description helper.
 *
 * The API key is deliberately not kept here: it lives in the operating
 * system keychain through Tauri commands. `settings.json` stores only the
 * non-sensitive opt-in preference and output language.
 */

export type AiOutputLanguage = "auto" | "id" | "en";
export type AiProvider = "openai" | "gemini" | "claude";

export interface AiSettings {
  enabled: boolean;
  provider: AiProvider;
  language: AiOutputLanguage;
}

export const DEFAULT_AI_SETTINGS: AiSettings = {
  enabled: false,
  provider: "openai",
  language: "auto",
};

const SETTINGS_FILE = "settings.json";
const KEY_ENABLED = "aiDescriptionEnabled";
const KEY_PROVIDER = "aiDescriptionProvider";
const KEY_LANGUAGE = "aiDescriptionLanguage";

export async function loadAiSettings(): Promise<AiSettings> {
  try {
    const { load } = await import("@tauri-apps/plugin-store");
    const store = await load(SETTINGS_FILE);
    const enabled = await store.get<boolean>(KEY_ENABLED);
    const provider = await store.get<AiProvider>(KEY_PROVIDER);
    const language = await store.get<AiOutputLanguage>(KEY_LANGUAGE);
    return {
      enabled: typeof enabled === "boolean" ? enabled : DEFAULT_AI_SETTINGS.enabled,
      provider: provider === "openai" || provider === "gemini" || provider === "claude"
        ? provider
        : DEFAULT_AI_SETTINGS.provider,
      language: language === "auto" || language === "id" || language === "en"
        ? language
        : DEFAULT_AI_SETTINGS.language,
    };
  } catch {
    return { ...DEFAULT_AI_SETTINGS };
  }
}

export async function saveAiSettings(settings: AiSettings): Promise<void> {
  const { load } = await import("@tauri-apps/plugin-store");
  const store = await load(SETTINGS_FILE);
  await store.set(KEY_ENABLED, settings.enabled);
  await store.set(KEY_PROVIDER, settings.provider);
  await store.set(KEY_LANGUAGE, settings.language);
  await store.save();
}
