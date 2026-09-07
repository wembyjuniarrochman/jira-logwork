<script lang="ts">
  /**
   * WorkspaceHeader
   *
   * Compact glass-styled header for the post-login Workspace shell. Renders
   * the application logo and "JIRA Logwork" title on the left, the current
   * date in the user's locale long form in the center, and the
   * UserAvatarDropdown on the right.
   *
   * Validates: Requirements 1.3, 3.1, 11.2, 13.1
   *
   * R13.1 tab order: the logo button comes first in DOM order, then the
   * UserAvatarDropdown's avatar button. No other focusable elements live
   * inside the header.
   */

  import { t } from "../stores/i18n.svelte";
  import UserAvatarDropdown from "./UserAvatarDropdown.svelte";
  import LanguageToggle from "./LanguageToggle.svelte";

  interface Props {
    displayName: string;
    email: string;
    onOpenSettings: () => void;
    onOpenAuditLog: () => void;
    onLogout: () => void;
  }

  let { displayName, email, onOpenSettings, onOpenAuditLog, onLogout }: Props =
    $props();

  // --- Current date ---
  // Captured at mount; re-read inside an $effect so SSR/hydration is stable
  // and so the date refreshes whenever the component is re-mounted.

  let currentDate = $state<Date>(new Date());

  $effect(() => {
    currentDate = new Date();
  });

  // ISO YYYY-MM-DD for the <time datetime> attribute (R13.1 accessibility).
  let isoDate = $derived(toIsoDate(currentDate));

  // User-locale long form, e.g. "Wednesday, March 12, 2025" (R3.1).
  let displayDate = $derived(
    currentDate.toLocaleDateString(undefined, { dateStyle: "full" })
  );

  function toIsoDate(d: Date): string {
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }
</script>

<header class="workspace-header glass" role="banner">
  <!-- Left: logo + title. Logo is a focusable button so it appears first in
       the tab order per R13.1; clicking is a no-op in this MVP. -->
  <div class="header-left">
    <button
      type="button"
      class="logo-button"
      aria-label="JIRA Logwork"
    >
      <svg
        class="app-logo"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.5"
        aria-hidden="true"
      >
        <rect x="3" y="3" width="18" height="18" rx="3" />
        <path d="M8 12h8M12 8v8" />
      </svg>
      <span class="app-title">JIRA Logwork</span>
    </button>
  </div>

  <!-- Center: current date in user locale long form (R3.1). -->
  <div class="header-center">
    <time class="current-date" datetime={isoDate}>{displayDate}</time>
  </div>

  <!-- Right: audit log + language toggle + avatar dropdown. -->
  <div class="header-right">
    <button
      type="button"
      class="header-icon-btn"
      aria-label={t("header.openAuditLog")}
      title={t("header.auditLog")}
      onclick={onOpenAuditLog}
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
      >
        <path d="M3 3v5h5" />
        <path d="M3.05 13A9 9 0 1 0 6 5.3L3 8" />
        <path d="M12 7v5l4 2" />
      </svg>
    </button>
    <LanguageToggle />
    <UserAvatarDropdown
      {displayName}
      {email}
      {onOpenSettings}
      {onLogout}
    />
  </div>
</header>

<style>
  .workspace-header {
    position: sticky;
    top: 0;
    z-index: 20;
    display: grid;
    grid-template-columns: 1fr auto 1fr;
    align-items: center;
    gap: 1rem;
    padding: 0.75rem 1.25rem;
    /* The .glass utility supplies bg/blur/border/shadow/radius. */
  }

  .header-left {
    display: flex;
    align-items: center;
    justify-content: flex-start;
    min-width: 0;
  }

  .header-center {
    display: flex;
    align-items: center;
    justify-content: center;
    min-width: 0;
  }

  .header-right {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 0.625rem;
    min-width: 0;
  }

  /* --- Logo button --- */

  .logo-button {
    display: inline-flex;
    align-items: center;
    gap: 0.625rem;
    padding: 0.375rem 0.625rem;
    border-radius: 0.625rem;
    border: 1px solid transparent;
    background: transparent;
    color: inherit;
    font: inherit;
    cursor: pointer;
    transition:
      background-color 200ms ease-out,
      border-color 200ms ease-out,
      box-shadow 150ms ease-out;
    outline: none;
  }

  .logo-button:hover {
    background: rgb(var(--fg-rgb) / 0.05);
    border-color: rgb(var(--fg-rgb) / 0.12);
  }

  /* Focus ring distinct from hover (R11.4). */
  .logo-button:focus-visible {
    box-shadow: var(--focus-ring);
    border-color: rgba(99, 102, 241, 0.45);
  }

  .app-logo {
    width: 1.5rem;
    height: 1.5rem;
    color: var(--text-accent);
    flex-shrink: 0;
  }

  .app-title {
    font-size: 1rem;
    font-weight: 700;
    color: var(--text-primary);
    letter-spacing: -0.01em;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  /* --- Icon button (audit log) --- */

  .header-icon-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 2.25rem;
    height: 2.25rem;
    border-radius: 0.625rem;
    border: 1px solid transparent;
    background: transparent;
    color: rgb(var(--fg-rgb) / 0.75);
    cursor: pointer;
    transition:
      background-color 200ms ease-out,
      border-color 200ms ease-out,
      color 200ms ease-out,
      box-shadow 150ms ease-out;
    outline: none;
  }

  .header-icon-btn:hover {
    background: rgb(var(--fg-rgb) / 0.06);
    border-color: rgb(var(--fg-rgb) / 0.12);
    color: var(--text-primary);
  }

  .header-icon-btn:focus-visible {
    box-shadow: var(--focus-ring);
    border-color: rgba(99, 102, 241, 0.45);
  }

  .header-icon-btn svg {
    width: 1.25rem;
    height: 1.25rem;
  }

  /* --- Date --- */

  .current-date {
    font-size: 0.875rem;
    font-weight: 500;
    color: rgb(var(--fg-rgb) / 0.78);
    letter-spacing: 0.01em;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
</style>
