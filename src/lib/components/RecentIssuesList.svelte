<script lang="ts">
  import { t } from "../stores/i18n.svelte";
  import type { RecentIssue } from "../stores/recentIssuesStore";
  import { RECENT_ISSUES_MAX } from "../stores/recentIssuesStore";

  interface Props {
    issues: RecentIssue[];
    selectedKey: string | null;
    onSelect: (issue: RecentIssue) => void;
  }

  let { issues, selectedKey, onSelect }: Props = $props();

  // Cap at the documented maximum (R6.2). The store keeps the list trimmed,
  // but we slice defensively so the component never renders more than 10 rows.
  let visibleIssues = $derived(issues.slice(0, RECENT_ISSUES_MAX));
</script>

<section class="recent-issues" aria-labelledby="recent-issues-heading">
  <h3 id="recent-issues-heading" class="heading">{t("recent.title")}</h3>

  {#if visibleIssues.length === 0}
    <p class="empty-state">{t("recent.empty")}</p>
  {:else}
    <ul class="list" role="list">
      {#each visibleIssues as issue (issue.issueKey)}
        {@const isSelected = issue.issueKey === selectedKey}
        <li>
          <button
            type="button"
            class="row"
            class:selected={isSelected}
            aria-pressed={isSelected}
            onclick={() => onSelect(issue)}
          >
            <span class="issue-key">{issue.issueKey}</span>
            <span class="summary" title={issue.summary}>{issue.summary}</span>
          </button>
        </li>
      {/each}
    </ul>
  {/if}
</section>

<style>
  .recent-issues {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .heading {
    font-size: 0.75rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: rgb(var(--fg-rgb) / 0.6);
    margin: 0;
  }

  .empty-state {
    margin: 0;
    padding: 0.75rem 1rem;
    border-radius: 0.625rem;
    background: var(--glass-bg);
    border: 1px dashed var(--glass-border);
    color: rgb(var(--fg-rgb) / 0.55);
    font-size: 0.8125rem;
    line-height: 1.4;
  }

  .list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    /* Kolom kiri kini punya ruang vertikal lega, jadi batasnya dinaikkan:
       8.5rem hanya memuat tiga baris dan memaksa scroll bersarang di dalam
       popover yang juga bisa di-scroll. */
    max-height: 16rem;
    overflow-y: auto;
  }

  .row {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 0.625rem;
    padding: 0.5rem 0.75rem;
    border-radius: 0.5rem;
    border: 1px solid rgb(var(--fg-rgb) / 0.08);
    border-left: 3px solid transparent;
    background: rgb(var(--fg-rgb) / 0.04);
    color: rgb(var(--fg-rgb) / 0.92);
    font: inherit;
    text-align: left;
    cursor: pointer;
    /* Hover transition stays under 250ms per R11.3. */
    transition:
      background-color 200ms ease-out,
      border-color 200ms ease-out,
      box-shadow 150ms ease-out;
    outline: none;
  }

  .row:hover {
    background: rgb(var(--fg-rgb) / 0.07);
    border-color: rgb(var(--fg-rgb) / 0.18);
  }

  /* Focus ring distinct from hover, per R11.4. */
  .row:focus-visible {
    box-shadow: var(--focus-ring);
    border-color: rgba(99, 102, 241, 0.5);
  }

  .row.selected {
    background: rgba(99, 102, 241, 0.18);
    border-color: rgba(99, 102, 241, 0.35);
    border-left-color: var(--accent-from);
    color: var(--text-on-accent);
  }

  .row.selected:hover {
    background: rgba(99, 102, 241, 0.24);
  }

  .issue-key {
    font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace;
    font-size: 0.8125rem;
    font-weight: 600;
    color: var(--text-accent-strong);
    flex-shrink: 0;
    letter-spacing: 0.01em;
  }

  .row.selected .issue-key {
    color: var(--text-accent-strong);
  }

  .summary {
    flex: 1;
    min-width: 0;
    font-size: 0.875rem;
    color: rgb(var(--fg-rgb) / 0.85);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
</style>
