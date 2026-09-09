<script lang="ts">
  import { t } from "../stores/i18n.svelte";
  import BackgroundPaths from "../components/BackgroundPaths.svelte";
  import CredentialForm from "../components/CredentialForm.svelte";
  import erajayaLogoUrl from "../../assets/erajaya-logo.svg";
  import { version as appVersion } from "../../../package.json";
  import {
    authenticate,
    classifyError,
    saveCredentials,
    loadRememberToken,
    saveRememberToken,
    type Credentials,
    type AuthError,
  } from "../stores/authStore";

  interface Props {
    credentials: Credentials;
    isLoadingCredentials: boolean;
    hasStoredCredentials: boolean;
    onAuthenticated: (credentials: Credentials) => void;
  }

  let { credentials, isLoadingCredentials, hasStoredCredentials, onAuthenticated }: Props = $props();

  // Local auth state
  let isAuthenticating = $state(false);
  let error = $state<AuthError | null>(null);
  let displayName = $state<string | null>(null);
  let showSuccess = $state(false);
  let rememberToken = $state(false);
  let connectionTest = $state<"idle" | "testing" | "success" | "error">("idle");
  let connectionMessage = $state("");

  // Local credential state that can be mutated on error
  let localCredentials = $state<Credentials>({ baseUrl: "", email: "", apiToken: "" });

  // Sync incoming credentials to local state
  $effect(() => {
    localCredentials = { ...credentials };
  });

  // Load remember token preference on mount
  $effect(() => {
    if (!isLoadingCredentials) {
      loadRememberToken().then((val) => { rememberToken = val; });
    }
  });

  // Derive welcome email: show only when all stored credentials are present
  let welcomeEmail = $derived(
    hasStoredCredentials && !isLoadingCredentials ? credentials.email : null
  );

  async function handleSubmit(creds: Credentials) {
    error = null;
    isAuthenticating = true;

    try {
      const name = await authenticate(creds);

      // Save credentials and remember token preference on success
      await saveCredentials(creds);
      await saveRememberToken(rememberToken);

      // Show success state with display name
      displayName = name;
      showSuccess = true;

      // Wait 2 seconds then signal transition
      setTimeout(() => {
        onAuthenticated(creds);
      }, 2000);
    } catch (err) {
      const classified = classifyError(err);
      error = classified;

      // On auth error with pre-populated credentials: clear API token, retain URL and email
      if (classified.type === "auth" && hasStoredCredentials) {
        localCredentials = { ...creds, apiToken: "" };
      } else {
        // Preserve all form values on other errors
        localCredentials = { ...creds };
      }

      isAuthenticating = false;
    }
  }

  async function handleTestConnection(creds: Credentials): Promise<void> {
    error = null;
    connectionTest = "testing";
    connectionMessage = "";
    try {
      const name = await authenticate(creds);
      connectionTest = "success";
      connectionMessage = t("login.connectionSuccess", { name });
    } catch (err) {
      connectionTest = "error";
      connectionMessage = classifyError(err).message;
    }
  }

  function handleRememberTokenChange(value: boolean) {
    rememberToken = value;
  }
</script>

<!-- `data-force-theme="dark"` mengunci layar ini ke palet gelap apa pun tema
     yang dipilih user: logo, gradien, dan kurva animasinya dirancang untuk
     latar gelap. Tema baru berlaku setelah masuk ke workspace. -->
<div class="login-page" data-force-theme="dark">
  <BackgroundPaths exiting={isAuthenticating || showSuccess} />

  <div class="login-content" role="main">
    <div class="login-stack">
      <div class="brand-backdrop" aria-hidden="true">
        <img
          class="brand-logo"
          src={erajayaLogoUrl}
          alt=""
          draggable="false"
        />
        <div class="brand-glow"></div>
      </div>

      {#if isLoadingCredentials}
        <!-- Loading state while credential store is being checked -->
        <div class="loading-container" aria-live="polite" aria-busy="true">
          <div class="loading-spinner-large" aria-hidden="true"></div>
          <p class="loading-text">{t("login.loading")}</p>
        </div>
      {:else if showSuccess}
        <!-- Success state: show display name for 2 seconds -->
        <div class="success-container" role="status" aria-live="polite">
          <div class="success-icon-wrap" aria-hidden="true">
            <span class="success-pulse"></span>
            <svg
              class="success-icon"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2.25"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <!-- Circle traces around the icon. pathLength normalizes the
                   dasharray so the animation is independent of the actual
                   SVG path length. -->
              <path
                class="success-icon-circle"
                pathLength="100"
                d="M22 11.08V12a10 10 0 1 1-5.93-9.14"
              />
              <!-- Checkmark draws in after the circle finishes. -->
              <polyline
                class="success-icon-check"
                pathLength="100"
                points="22 4 12 14.01 9 11.01"
              />
            </svg>
          </div>
          <h2 class="success-title">Welcome, {displayName}!</h2>
          <p class="success-subtitle">{t("login.redirecting")}</p>
        </div>
      {:else}
        <!-- Login form -->
        <div class="form-container">
          <div class="app-header">
            <svg class="app-logo" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
              <rect x="3" y="3" width="18" height="18" rx="3" />
              <path d="M8 12h8M12 8v8" />
            </svg>
            <h1 class="app-title">JIRA Logwork</h1>
          </div>

          <CredentialForm
            credentials={localCredentials}
            isLoading={isAuthenticating}
            {error}
            {welcomeEmail}
            {rememberToken}
            onSubmit={handleSubmit}
            onTestConnection={handleTestConnection}
            connectionTestState={connectionTest}
            onRememberTokenChange={handleRememberTokenChange}
          />
          <p class="app-version">{t("settings.version")} {appVersion}</p>
        </div>
      {/if}
    </div>
  </div>

  {#if connectionTest === "success" || connectionTest === "error"}
    <div
      class="connection-toast"
      class:success={connectionTest === "success"}
      role={connectionTest === "error" ? "alert" : "status"}
      aria-live="polite"
    >
      <span class="toast-icon" aria-hidden="true">{connectionTest === "success" ? "✓" : "!"}</span>
      <span>{connectionMessage}</span>
      <button
        type="button"
        class="toast-close"
        aria-label={t("common.close")}
        onclick={() => { connectionTest = "idle"; connectionMessage = ""; }}
      >×</button>
    </div>
  {/if}
</div>

<style>
  .login-page {
    position: fixed;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
    /* Safety net: even if the BackgroundPaths layers transition out
     * faster than expected, the page never flashes to the browser's
     * default white. The base color matches the swarm's gradient so
     * the transition reads as "curves leave a dark page". */
    background: var(--app-bg);
  }

  /* Keep the logo in the same flow as the title and form to prevent overlap. */
  .brand-backdrop {
    position: relative;
    flex-shrink: 0;
    z-index: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    pointer-events: none;
  }

  .brand-logo {
    width: clamp(120px, 18vw, 180px);
    max-width: 100%;
    display: block;
    height: auto;
    /* Tinted to a soft indigo glow so a multi-color logo doesn't fight
     * the dark slate palette. Slightly more visible than the previous
     * full-page version since the footprint is much smaller. */
    opacity: 0.85;
    filter:
      brightness(0) invert(var(--logo-invert))
      sepia(40%) saturate(420%) hue-rotate(210deg)
      drop-shadow(0 0 18px rgba(99, 102, 241, 0.55));
    user-select: none;
    -webkit-user-drag: none;
    /* Composite of three motions:
     *   - logo-fade-in: initial appearance after mount (1.4s)
     *   - logo-drift:   slow horizontal sway (24s)
     *   - logo-breathe: gentle opacity pulse (8s)
     * Splitting them lets each respect its own timing without compounding
     * easing artifacts. */
    animation:
      logo-fade-in 1400ms cubic-bezier(0.22, 1, 0.36, 1) both,
      logo-drift 24s ease-in-out 1.4s infinite alternate,
      logo-breathe 8s ease-in-out 1.4s infinite;
    transform-origin: center;
    will-change: transform, opacity;
  }

  /* Soft halo sized for the smaller header logo. */
  .brand-glow {
    position: absolute;
    width: clamp(220px, 28vw, 320px);
    height: clamp(220px, 28vw, 320px);
    border-radius: 50%;
    background: radial-gradient(
      circle at center,
      rgba(99, 102, 241, 0.22) 0%,
      rgba(139, 92, 246, 0.12) 40%,
      rgb(var(--surface-rgb) / 0) 70%
    );
    filter: blur(34px);
    animation: glow-pulse 9s ease-in-out infinite;
    will-change: transform, opacity;
    z-index: -1;
  }

  @keyframes logo-fade-in {
    0% {
      opacity: 0;
      transform: scale(0.92) translateY(-10px);
      filter:
        brightness(0) invert(1)
        sepia(40%) saturate(420%) hue-rotate(210deg)
        drop-shadow(0 0 0 rgba(99, 102, 241, 0))
        blur(6px);
    }
    100% {
      opacity: 0.85;
      transform: scale(1) translateY(0);
      filter:
        brightness(0) invert(1)
        sepia(40%) saturate(420%) hue-rotate(210deg)
        drop-shadow(0 0 18px rgba(99, 102, 241, 0.55))
        blur(0);
    }
  }

  @keyframes logo-drift {
    0%   { transform: translate3d(-2%, 0, 0) rotate(-0.6deg); }
    100% { transform: translate3d( 2%, 0, 0) rotate( 0.6deg); }
  }

  @keyframes logo-breathe {
    0%, 100% { opacity: 0.78; }
    50%      { opacity: 0.92; }
  }

  @keyframes glow-pulse {
    0%, 100% {
      opacity: 0.55;
      transform: scale(0.95);
    }
    50% {
      opacity: 0.85;
      transform: scale(1.05);
    }
  }

  .login-content {
    position: relative;
    z-index: 1;
    display: flex;
    align-items: center;
    flex-direction: column;
    width: 100%;
    height: 100%;
    padding: 2rem 1rem;
    overflow-y: auto;
    overflow-x: hidden;
  }

  .login-stack {
    display: flex;
    flex-direction: column;
    align-items: center;
    flex-shrink: 0;
    gap: 1.5rem;
    width: 100%;
    max-width: 420px;
    margin-block: auto;
  }

  .connection-toast {
    position: fixed;
    top: 1.25rem;
    right: 1.25rem;
    z-index: 20;
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: center;
    gap: .7rem;
    width: min(23rem, calc(100vw - 2rem));
    padding: .8rem .9rem;
    border: 1px solid rgb(239 68 68 / .28);
    border-radius: .75rem;
    background: #30202b;
    box-shadow: 0 16px 40px rgb(0 0 0 / .38);
    color: #fca5a5;
    font-size: .8rem;
    line-height: 1.4;
    animation: toast-in 180ms ease-out;
  }

  .connection-toast.success {
    border-color: rgb(52 211 153 / .28);
    background: #18302f;
    color: #86efc1;
  }

  .toast-icon { display: grid; place-items: center; width: 1.35rem; height: 1.35rem; border-radius: 50%; background: #fca5a5; color: #30202b; font-weight: 900; }
  .connection-toast.success .toast-icon { color: #18302f; background: #86efc1; }
  .toast-close { padding: .15rem .3rem; border: 0; background: none; color: currentColor; font-size: 1.2rem; line-height: 1; cursor: pointer; }

  @keyframes toast-in {
    from { opacity: 0; transform: translateY(-8px); }
    to { opacity: 1; transform: translateY(0); }
  }

  /* Loading state */
  .loading-container {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 1rem;
  }

  .loading-spinner-large {
    width: 2.5rem;
    height: 2.5rem;
    border: 3px solid rgb(var(--fg-rgb) / 0.15);
    border-top-color: rgba(99, 102, 241, 0.8);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  .loading-text {
    color: rgb(var(--fg-rgb) / 0.7);
    font-size: 0.9375rem;
    margin: 0;
  }

  /* Success state */
  .success-container {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 1rem;
    text-align: center;
    animation: fadeIn 0.4s ease-out;
  }

  .success-icon-wrap {
    /* Anchors the absolutely positioned pulse halo behind the icon. The
     * fixed-size box keeps the success layout from shifting as the halo
     * scales. */
    position: relative;
    width: 4.5rem;
    height: 4.5rem;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    /* Initial entrance: scale + fade so the icon "lands" before the
     * stroke-draw begins. */
    animation: success-pop 360ms cubic-bezier(0.22, 1.4, 0.36, 1) both;
  }

  .success-pulse {
    position: absolute;
    inset: 0;
    border-radius: 999px;
    background: radial-gradient(
      circle at center,
      rgba(52, 211, 153, 0.45) 0%,
      rgba(52, 211, 153, 0) 70%
    );
    /* Pulse appears after the stroke draw finishes; runs twice so it
     * doesn't compete with the brief redirect window. */
    opacity: 0;
    transform: scale(0.6);
    animation: success-pulse 1.5s ease-out 1.05s 2;
  }

  .success-icon {
    width: 3.5rem;
    height: 3.5rem;
    color: var(--text-success);
    /* Soft glow so the green pops on the dark background. */
    filter: drop-shadow(0 0 12px rgba(52, 211, 153, 0.45));
    /* Reset transform so success-pop on the wrap is the only entrance
     * animation; the stroke-dash animations happen on child paths. */
  }

  .success-icon-circle {
    /* `pathLength=100` lets us treat the path as a normalized 0..100
     * length, so 100/100 = fully hidden, 0/100 = fully drawn. */
    stroke-dasharray: 100;
    stroke-dashoffset: 100;
    animation: success-draw 600ms ease-out 200ms forwards;
  }

  .success-icon-check {
    stroke-dasharray: 100;
    stroke-dashoffset: 100;
    animation: success-draw 360ms cubic-bezier(0.22, 1, 0.36, 1) 700ms forwards;
  }

  @keyframes success-pop {
    0% {
      opacity: 0;
      transform: scale(0.5);
    }
    60% {
      opacity: 1;
      transform: scale(1.08);
    }
    100% {
      opacity: 1;
      transform: scale(1);
    }
  }

  @keyframes success-draw {
    to {
      stroke-dashoffset: 0;
    }
  }

  @keyframes success-pulse {
    0% {
      opacity: 0.6;
      transform: scale(0.6);
    }
    100% {
      opacity: 0;
      transform: scale(1.6);
    }
  }

  .success-title {
    font-size: 1.5rem;
    font-weight: 600;
    color: var(--text-primary);
    margin: 0;
  }

  .success-subtitle {
    font-size: 0.875rem;
    color: rgb(var(--fg-rgb) / 0.6);
    margin: 0;
  }

  /* Form container */
  .form-container {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 1.5rem;
    width: 100%;
    max-width: 420px;
    animation: fadeIn 0.4s ease-out;
  }

  /* App header / logo area */
  .app-version {
    margin: -0.5rem 0 0;
    padding: 0.375rem 0.875rem;
    border: 1px solid #555879;
    border-radius: 999px;
    background: #202338;
    color: #e2e4ff;
    font-size: 0.8125rem;
    font-weight: 500;
    line-height: 1.5;
    letter-spacing: 0.025em;
    text-align: center;
  }

  .app-header {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }

  .app-logo {
    width: 2rem;
    height: 2rem;
    color: var(--text-accent);
  }

  .app-title {
    font-size: 1.375rem;
    font-weight: 700;
    color: var(--text-primary);
    margin: 0;
    letter-spacing: -0.01em;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  @keyframes fadeIn {
    from { opacity: 0; transform: translateY(8px); }
    to { opacity: 1; transform: translateY(0); }
  }

  @media (max-height: 760px), (max-width: 480px) {
    .login-content {
      padding: 1.5rem 1rem;
    }
    .brand-logo {
      width: 120px;
    }
    .login-stack,
    .form-container {
      gap: 1.25rem;
    }
    .form-container :global(.credential-form-wrapper) {
      padding: 1.5rem;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .success-container,
    .success-icon-wrap,
    .success-icon-circle,
    .success-icon-check,
    .success-pulse,
    .form-container,
    .loading-spinner-large,
    .brand-logo,
    .brand-glow {
      animation: none !important;
    }
    .success-icon-circle,
    .success-icon-check {
      stroke-dashoffset: 0;
    }
    .success-pulse {
      opacity: 0;
    }
    .brand-logo {
      opacity: 0.85;
    }
  }
</style>
