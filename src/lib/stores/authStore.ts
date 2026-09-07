import { invoke } from "@tauri-apps/api/core";

// --- Types ---

export type AuthPhase = "loading" | "unauthenticated" | "authenticating" | "success" | "authenticated";

export interface Credentials {
  baseUrl: string;
  email: string;
  apiToken: string;
}

export interface AuthError {
  type: "auth" | "network" | "timeout" | "unknown";
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  error?: string;
}

export interface AuthState {
  phase: AuthPhase;
  credentials: Credentials;
  displayName: string | null;
  error: AuthError | null;
  hasStoredCredentials: boolean;
}

// --- Validation Functions (pure, testable) ---

export function isCredentialComplete(creds: Credentials): boolean {
  return (
    creds.baseUrl.trim().length > 0 &&
    creds.email.trim().length > 0 &&
    creds.apiToken.trim().length > 0
  );
}

export function validateUrl(url: string): ValidationResult {
  if (!url.startsWith("https://")) {
    return { valid: false, error: "URL must start with https://" };
  }
  return { valid: true };
}

export function validateEmail(email: string): ValidationResult {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return { valid: false, error: "Please enter a valid email address" };
  }
  return { valid: true };
}

export function isFormSubmittable(creds: Credentials): boolean {
  return (
    creds.baseUrl.trim().length > 0 &&
    creds.email.trim().length > 0 &&
    creds.apiToken.trim().length > 0
  );
}

export function classifyError(error: unknown): AuthError {
  const message = String(error).toLowerCase();

  if (message.includes("timeout")) {
    return { type: "timeout", message: "Connection timed out. Please try again." };
  }

  if (
    message.includes("http 401") ||
    message.includes("http 403") ||
    message.includes("http 404") ||
    message.includes("unauthorized") ||
    message.includes("forbidden")
  ) {
    return {
      type: "auth",
      message: message.includes("http 404")
        ? "Jira instance not found. Please check your URL."
        : "Invalid credentials. Please check your email and API token.",
    };
  }

  if (
    message.includes("dns") ||
    message.includes("connect") ||
    message.includes("resolve") ||
    message.includes("network") ||
    message.includes("econnrefused") ||
    message.includes("enotfound")
  ) {
    return {
      type: "network",
      message: "Cannot reach the server. Please check your URL and network connection.",
    };
  }

  return { type: "unknown", message: "An unexpected error occurred. Please try again." };
}

// --- Credential Persistence ---

export async function loadCredentials(): Promise<Credentials> {
  try {
    const { load } = await import("@tauri-apps/plugin-store");
    const store = await load("settings.json");
    const baseUrl = (await store.get<string>("baseUrl")) || "";
    const email = (await store.get<string>("email")) || "";
    const apiToken = (await store.get<string>("apiToken")) || "";
    return { baseUrl, email, apiToken };
  } catch {
    return { baseUrl: "", email: "", apiToken: "" };
  }
}

export async function saveCredentials(creds: Credentials): Promise<void> {
  const { load } = await import("@tauri-apps/plugin-store");
  const store = await load("settings.json");
  await store.set("baseUrl", creds.baseUrl);
  await store.set("email", creds.email);
  await store.set("apiToken", creds.apiToken);
  await store.save();
}

// --- Authentication ---

export async function authenticate(creds: Credentials): Promise<string> {
  const authPromise = invoke<string>("test_connection", {
    baseUrl: creds.baseUrl,
    email: creds.email,
    apiToken: creds.apiToken,
    isCloud: true,
  });

  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error("timeout")), 30000)
  );

  return Promise.race([authPromise, timeoutPromise]);
}

// --- Remember Token ---

export async function loadRememberToken(): Promise<boolean> {
  try {
    const { load } = await import("@tauri-apps/plugin-store");
    const store = await load("settings.json");
    const value = await store.get<boolean>("rememberToken");
    return value ?? false;
  } catch {
    return false;
  }
}

export async function saveRememberToken(remember: boolean): Promise<void> {
  const { load } = await import("@tauri-apps/plugin-store");
  const store = await load("settings.json");
  await store.set("rememberToken", remember);
  await store.save();
}

// --- Logout ---

export async function logout(): Promise<void> {
  const { load } = await import("@tauri-apps/plugin-store");
  const store = await load("settings.json");
  const rememberToken = (await store.get<boolean>("rememberToken")) ?? false;
  if (!rememberToken) {
    await store.set("apiToken", "");
  }
  await store.save();
}


