const SETTINGS_FILE = "settings.json";
const KEY_COMPLETED = "onboardingCompleted";

export async function isOnboardingCompleted(): Promise<boolean> {
  try {
    const { load } = await import("@tauri-apps/plugin-store");
    const store = await load(SETTINGS_FILE);
    return (await store.get<boolean>(KEY_COMPLETED)) === true;
  } catch {
    return false;
  }
}

export async function completeOnboarding(): Promise<void> {
  const { load } = await import("@tauri-apps/plugin-store");
  const store = await load(SETTINGS_FILE);
  await store.set(KEY_COMPLETED, true);
  await store.save();
}
