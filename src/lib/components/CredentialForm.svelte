<script lang="ts">
  import { tick } from "svelte";
  import { t } from "../stores/i18n.svelte";
  import {
    isFormSubmittable,
    validateUrl,
    validateEmail,
    type Credentials,
    type AuthError,
  } from "../stores/authStore";

  interface Props {
    credentials: Credentials;
    isLoading: boolean;
    error: AuthError | null;
    welcomeEmail: string | null;
    rememberToken: boolean;
    onSubmit: (creds: Credentials) => void;
    onRememberTokenChange: (value: boolean) => void;
  }

  let { credentials, isLoading, error, welcomeEmail, rememberToken, onSubmit, onRememberTokenChange }: Props = $props();

  // Local form state bound to inputs
  let baseUrl = $state("");
  let email = $state("");
  let apiToken = $state("");

  // Inline validation errors
  let urlError = $state<string | null>(null);
  let emailError = $state<string | null>(null);

  // Sync props → local state when credentials change externally
  $effect(() => {
    baseUrl = credentials.baseUrl;
    email = credentials.email;
    apiToken = credentials.apiToken;
  });

  /**
   * Arahkan fokus saat form pertama muncul.
   *
   * Tanpa ini fokus tertinggal di `<body>`, sehingga menekan Enter tidak
   * melakukan apa-apa — bahkan ketika seluruh kolom sudah terisi dari
   * kredensial tersimpan. Kalau sudah lengkap, tombol Login yang difokus
   * agar Enter langsung mengirim; kalau belum, kolom kosong pertama yang
   * difokus agar user bisa langsung mengetik.
   */
  let initialFocusDone = false;
  $effect(() => {
    if (initialFocusDone) return;
    // Baca state agar efek berjalan lagi setelah prop kredensial masuk.
    const ready = baseUrl !== undefined && email !== undefined;
    if (!ready) return;
    initialFocusDone = true;
    void tick().then(() => {
      if (!baseUrl.trim()) urlInput?.focus();
      else if (!email.trim()) emailInput?.focus();
      else if (!apiToken.trim()) tokenInput?.focus();
      else submitBtn?.focus();
    });
  });

  // Clear inline errors when user edits the respective field
  $effect(() => {
    if (baseUrl) urlError = null;
  });
  $effect(() => {
    if (email) emailError = null;
  });

  // Ref untuk pengaturan fokus awal.
  let urlInput: HTMLInputElement | null = $state(null);
  let emailInput: HTMLInputElement | null = $state(null);
  let tokenInput: HTMLInputElement | null = $state(null);
  let submitBtn: HTMLButtonElement | null = $state(null);

  let formCreds = $derived<Credentials>({ baseUrl, email, apiToken });
  let canSubmit = $derived(isFormSubmittable(formCreds) && !isLoading);

  function handleSubmit(e: Event) {
    e.preventDefault();

    // Run client-side validation
    const urlResult = validateUrl(baseUrl);
    const emailResult = validateEmail(email);

    urlError = urlResult.valid ? null : (urlResult.error ?? "Invalid URL");
    emailError = emailResult.valid ? null : (emailResult.error ?? "Invalid email");

    if (!urlResult.valid || !emailResult.valid) return;

    onSubmit({ baseUrl, email, apiToken });
  }
</script>

<div class="credential-form-wrapper">
  <!-- Welcome message for returning users -->
  {#if welcomeEmail}
    <div class="welcome-banner" role="status" aria-live="polite">
      <svg class="welcome-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
        <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
        <circle cx="12" cy="7" r="4" />
      </svg>
      <span>{t("login.welcomeBack")} <strong>{welcomeEmail}</strong></span>
    </div>
  {/if}

  <!-- Error display -->
  {#if error}
    <div
      class="error-banner error-{error.type}"
      role="alert"
      aria-live="assertive"
    >
      <svg class="error-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
        {#if error.type === "network"}
          <path d="M1 1l22 22M16.72 11.06A10.94 10.94 0 0 1 19 12.55M5 12.55a10.94 10.94 0 0 1 5.17-2.39M10.71 5.05A16 16 0 0 1 22.56 9M1.42 9a15.91 15.91 0 0 1 4.7-2.88M8.53 16.11a6 6 0 0 1 6.95 0M12 20h.01" />
        {:else if error.type === "timeout"}
          <circle cx="12" cy="12" r="10" />
          <polyline points="12 6 12 12 16 14" />
        {:else}
          <circle cx="12" cy="12" r="10" />
          <line x1="15" y1="9" x2="9" y2="15" />
          <line x1="9" y1="9" x2="15" y2="15" />
        {/if}
      </svg>
      <span>{error.message}</span>
    </div>
  {/if}

  <form onsubmit={handleSubmit} novalidate aria-label={t("login.formLabel")}>
    <!-- Jira URL field -->
    <div class="form-field">
      <label for="jira-url">{t("login.jiraUrl")}</label>
      <input
        id="jira-url"
        type="url"
        bind:this={urlInput}
        bind:value={baseUrl}
        placeholder="https://company.atlassian.net"
        autocomplete="url"
        disabled={isLoading}
        aria-invalid={urlError ? "true" : undefined}
        aria-describedby={urlError ? "jira-url-error" : undefined}
      />
      {#if urlError}
        <p id="jira-url-error" class="field-error" role="alert">{urlError}</p>
      {/if}
    </div>

    <!-- Email field -->
    <div class="form-field">
      <label for="jira-email">{t("login.email")}</label>
      <input
        id="jira-email"
        type="email"
        bind:this={emailInput}
        bind:value={email}
        placeholder={t("settings.emailPlaceholder")}
        autocomplete="email"
        disabled={isLoading}
        aria-invalid={emailError ? "true" : undefined}
        aria-describedby={emailError ? "jira-email-error" : undefined}
      />
      {#if emailError}
        <p id="jira-email-error" class="field-error" role="alert">{emailError}</p>
      {/if}
    </div>

    <!-- API Token field -->
    <div class="form-field">
      <label for="jira-token">{t("login.apiToken")}</label>
      <input
        id="jira-token"
        type="password"
        bind:this={tokenInput}
        bind:value={apiToken}
        placeholder={t("login.tokenPlaceholder")}
        autocomplete="current-password"
        disabled={isLoading}
      />
    </div>

    <!-- Remember Token checkbox -->
    <div class="remember-field">
      <label class="remember-label">
        <input
          type="checkbox"
          checked={rememberToken}
          onchange={(e) => onRememberTokenChange(e.currentTarget.checked)}
          disabled={isLoading}
        />
        <span>{t("login.rememberToken")}</span>
      </label>
    </div>

    <!-- Submit button -->
    <button
      bind:this={submitBtn}
      type="submit"
      class="submit-btn"
      disabled={!canSubmit}
      aria-busy={isLoading}
    >
      {#if isLoading}
        <span class="loading-spinner" aria-hidden="true"></span>
        <span>{t("login.authenticating")}</span>
      {:else}
        <span>{t("login.submit")}</span>
      {/if}
    </button>
  </form>
</div>

<style>
  .credential-form-wrapper {
    width: 100%;
    max-width: 420px;
    padding: 2.5rem;
    border-radius: 1.25rem;
    /* Opaque base under the tint: without it the card relies on
       `backdrop-filter`, which does not paint on Windows/WebView2 — the
       animated background curves then read straight through the form and
       look as if they are drawn on top of it. */
    background:
      linear-gradient(var(--glass-bg), var(--glass-bg)),
      var(--surface-overlay);
    backdrop-filter: blur(20px);
    -webkit-backdrop-filter: blur(20px);
    border: 1px solid rgb(var(--fg-rgb) / 0.1);
    box-shadow:
      0 25px 50px -12px rgb(var(--shadow-rgb) / calc(0.5 * var(--shadow-strength))),
      inset 0 1px 0 rgb(var(--fg-rgb) / 0.1);
  }

  /* Welcome banner */
  .welcome-banner {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.875rem 1rem;
    margin-bottom: 1.5rem;
    border-radius: 0.75rem;
    background: rgba(99, 102, 241, 0.15);
    border: 1px solid rgba(99, 102, 241, 0.3);
    color: var(--text-accent-strong);
    font-size: 0.875rem;
  }

  .welcome-icon {
    width: 1.25rem;
    height: 1.25rem;
    flex-shrink: 0;
    color: var(--text-accent);
  }

  .welcome-banner strong {
    color: var(--text-accent-strong);
  }

  /* Error banner */
  .error-banner {
    display: flex;
    align-items: flex-start;
    gap: 0.75rem;
    padding: 0.875rem 1rem;
    margin-bottom: 1.5rem;
    border-radius: 0.75rem;
    font-size: 0.875rem;
    line-height: 1.4;
  }

  .error-icon {
    width: 1.25rem;
    height: 1.25rem;
    flex-shrink: 0;
    margin-top: 0.1rem;
  }

  .error-auth {
    background: rgba(239, 68, 68, 0.15);
    border: 1px solid rgba(239, 68, 68, 0.3);
    color: var(--text-danger);
  }

  .error-network {
    background: rgba(245, 158, 11, 0.15);
    border: 1px solid rgba(245, 158, 11, 0.3);
    color: var(--text-warning);
  }

  .error-timeout {
    background: rgba(245, 158, 11, 0.15);
    border: 1px solid rgba(245, 158, 11, 0.3);
    color: var(--text-warning);
  }

  .error-unknown {
    background: rgba(156, 163, 175, 0.15);
    border: 1px solid rgba(156, 163, 175, 0.3);
    color: #d1d5db;
  }

  /* Form fields */
  form {
    display: flex;
    flex-direction: column;
    gap: 1.25rem;
  }

  .form-field {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .form-field label {
    font-size: 0.8125rem;
    font-weight: 500;
    color: rgb(var(--fg-rgb) / 0.8);
    letter-spacing: 0.025em;
  }

  .form-field input {
    width: 100%;
    padding: 0.75rem 1rem;
    border-radius: 0.625rem;
    border: 1px solid rgb(var(--fg-rgb) / 0.12);
    background: rgb(var(--fg-rgb) / 0.06);
    color: var(--text-primary);
    font-size: 0.9375rem;
    transition: border-color 0.2s, box-shadow 0.2s, background 0.2s;
    outline: none;
  }

  .form-field input::placeholder {
    color: rgb(var(--fg-rgb) / 0.35);
  }

  .form-field input:focus {
    border-color: rgba(99, 102, 241, 0.6);
    box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.15);
    background: rgb(var(--fg-rgb) / 0.08);
  }

  .form-field input:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .form-field input[aria-invalid="true"] {
    border-color: rgba(239, 68, 68, 0.6);
    box-shadow: 0 0 0 3px rgba(239, 68, 68, 0.1);
  }

  .field-error {
    font-size: 0.75rem;
    color: var(--text-danger);
    margin: 0;
  }

  /* Remember token checkbox */
  .remember-field {
    margin-top: -0.25rem;
  }

  .remember-label {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.8125rem;
    color: rgb(var(--fg-rgb) / 0.7);
    cursor: pointer;
  }

  .remember-label input[type="checkbox"] {
    width: 1rem;
    height: 1rem;
    accent-color: #6366f1;
    cursor: pointer;
  }

  .remember-label input[type="checkbox"]:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  /* Submit button */
  .submit-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    width: 100%;
    padding: 0.875rem;
    margin-top: 0.5rem;
    border-radius: 0.625rem;
    border: none;
    background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%);
    color: white;
    font-size: 0.9375rem;
    font-weight: 600;
    cursor: pointer;
    transition: opacity 0.2s, transform 0.1s, box-shadow 0.2s;
    box-shadow: 0 4px 15px rgba(99, 102, 241, 0.3);
  }

  .submit-btn:hover:not(:disabled) {
    opacity: 0.92;
    box-shadow: 0 6px 20px rgba(99, 102, 241, 0.4);
  }

  .submit-btn:active:not(:disabled) {
    transform: scale(0.98);
  }

  .submit-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
    box-shadow: none;
  }

  /* Loading spinner */
  .loading-spinner {
    width: 1rem;
    height: 1rem;
    border: 2px solid rgb(var(--fg-rgb) / 0.3);
    border-top-color: white;
    border-radius: 50%;
    animation: spin 0.6s linear infinite;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }
</style>
