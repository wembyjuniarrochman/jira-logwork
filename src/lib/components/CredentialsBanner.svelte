<script lang="ts">
  import { t } from "../stores/i18n.svelte";
  /**
   * CredentialsBanner
   *
   * Non-blocking glass banner shown when the user's Jira credentials are
   * incomplete (R15.7). Inline-flow only: it does not overlay content.
   *
   * Validates: Requirements 1.3, 11.2, 15.7
   */

  interface Props {
    show: boolean;
    onOpenSettings: () => void;
  }

  let { show, onOpenSettings }: Props = $props();
</script>

{#if show}
  <div
    class="credentials-banner glass"
    role="status"
    aria-live="polite"
  >
    <svg
      class="warning-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>

    <span class="message">
      {t("misc.setupIncomplete")}
    </span>

    <button
      type="button"
      class="open-settings-btn"
      onclick={onOpenSettings}
    >
      {t("misc.openSettings")}
    </button>
  </div>
{/if}

<style>
  .credentials-banner {
    /* Inline flow — does NOT overlay content (R15.7). */
    display: flex;
    align-items: center;
    gap: 0.75rem;
    width: 100%;
    padding: 0.75rem 1rem;
    /* Amber/yellow accent layered on top of the .glass surface to
     * communicate "warning" without losing the glass-morphism look. */
    background-color: rgba(245, 158, 11, 0.12);
    border-color: rgba(245, 158, 11, 0.35);
    color: var(--text-warning);
    font-size: 0.875rem;
    line-height: 1.4;
  }

  .warning-icon {
    width: 1.25rem;
    height: 1.25rem;
    flex-shrink: 0;
    color: #fbbf24;
  }

  .message {
    flex: 1 1 auto;
    min-width: 0;
    color: var(--text-warning);
  }

  .open-settings-btn {
    flex-shrink: 0;
    padding: 0.5rem 0.875rem;
    border-radius: 0.5rem;
    border: 1px solid rgba(245, 158, 11, 0.45);
    background: rgba(245, 158, 11, 0.18);
    color: var(--text-warning);
    font-size: 0.8125rem;
    font-weight: 600;
    cursor: pointer;
    transition: background-color 0.2s ease-out, border-color 0.2s ease-out, box-shadow 0.15s ease-out;
  }

  .open-settings-btn:hover {
    background: rgba(245, 158, 11, 0.28);
    border-color: rgba(245, 158, 11, 0.6);
  }

  .open-settings-btn:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
    border-color: rgba(99, 102, 241, 0.6);
  }

  .open-settings-btn:active {
    background: rgba(245, 158, 11, 0.35);
  }
</style>
