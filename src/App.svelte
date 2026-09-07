<script lang="ts">
  import Login from "./lib/pages/Login.svelte";
  import Workspace from "./lib/pages/Workspace.svelte";
  import UpdateBanner from "./lib/components/UpdateBanner.svelte";
  import {
    loadCredentials,
    isCredentialComplete,
    logout,
    type Credentials,
  } from "./lib/stores/authStore";
  import { clearCacheForEmail } from "./lib/stores/worklogCacheStore";

  type AppAuthPhase = "loading" | "unauthenticated" | "authenticated";

  let authPhase = $state<AppAuthPhase>("loading");
  let credentials = $state<Credentials>({ baseUrl: "", email: "", apiToken: "" });
  let hasStoredCredentials = $state(false);

  // Load credentials on startup and determine auth phase
  async function initAuth() {
    try {
      const loaded = await loadCredentials();
      credentials = loaded;
      hasStoredCredentials = isCredentialComplete(loaded);
    } catch {
      credentials = { baseUrl: "", email: "", apiToken: "" };
      hasStoredCredentials = false;
    }
    // User always needs to click Login, so phase is "unauthenticated" after loading
    authPhase = "unauthenticated";
  }

  function handleAuthenticated() {
    authPhase = "authenticated";
  }

  function handleLogout() {
    authPhase = "unauthenticated";
    // Reload credentials to show pre-populated form (URL + email retained, token cleared)
    initAuthAfterLogout();
  }

  async function onLogout() {
    // Capture the email *before* logout clears credentials so we can target
    // the right cache key. The cache lives in `worklog-cache.json` keyed by
    // (email, baseUrl, range); without this clear, signing back in would
    // briefly paint stale heatmap data from the previous session.
    const previousEmail = credentials.email;
    try {
      await logout();
    } catch {
      // R3.5: transition to unauthenticated regardless of whether logout resolves or throws
    }
    if (previousEmail) {
      try {
        await clearCacheForEmail(previousEmail);
      } catch {
        /* cache clear is best-effort */
      }
    }
    handleLogout();
  }

  async function initAuthAfterLogout() {
    try {
      const loaded = await loadCredentials();
      credentials = loaded;
      hasStoredCredentials = isCredentialComplete(loaded);
    } catch {
      credentials = { baseUrl: "", email: "", apiToken: "" };
      hasStoredCredentials = false;
    }
  }

  // Derive a display name from the credentials email (portion before "@");
  // fall back to "User" when no email is available.
  let displayName = $derived(
    credentials.email && credentials.email.includes("@")
      ? credentials.email.split("@")[0] || "User"
      : credentials.email || "User"
  );

  // Initialize auth on startup
  initAuth();
</script>

{#if authPhase === "loading" || authPhase === "unauthenticated"}
  <Login
    {credentials}
    isLoadingCredentials={authPhase === "loading"}
    {hasStoredCredentials}
    onAuthenticated={handleAuthenticated}
  />
{:else}
  <Workspace
    {displayName}
    email={credentials.email}
    {onLogout}
  />
{/if}

<!-- Di luar percabangan auth: update ditawarkan baik di layar login maupun
     di workspace, dan bannernya bertahan saat user login. -->
<UpdateBanner />
