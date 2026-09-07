<script lang="ts">
  /**
   * AuditLogPanel
   *
   * Overlay panel yang menampilkan jejak audit aksi worklog (tambah / edit /
   * hapus / auto-schedule) beserta status & sumbernya. Mendukung filter,
   * salin-sebagai-CSV, dan clear. Ditutup lewat backdrop / tombol / Escape.
   */

  import {
    type AuditEntry,
    type AuditStatus,
    toCsv,
  } from "../stores/auditLogStore";

  interface Props {
    open: boolean;
    entries: AuditEntry[];
    onClose: () => void;
    onClear: () => void;
  }

  let { open, entries, onClose, onClear }: Props = $props();

  type Filter = "all" | "auto" | "manual" | "error";
  let filter = $state<Filter>("all");
  let copied = $state(false);

  const FILTERS: { id: Filter; label: string }[] = [
    { id: "all", label: "Semua" },
    { id: "auto", label: "Otomatis" },
    { id: "manual", label: "Manual" },
    { id: "error", label: "Error" },
  ];

  let filtered = $derived.by(() => {
    switch (filter) {
      case "auto":
        return entries.filter((e) => e.source === "auto");
      case "manual":
        return entries.filter((e) => e.source === "manual");
      case "error":
        return entries.filter((e) => e.status === "failed");
      default:
        return entries;
    }
  });

  const ACTION_LABEL: Record<AuditEntry["action"], string> = {
    add: "Tambah",
    edit: "Ubah",
    delete: "Hapus",
  };

  const STATUS_LABEL: Record<AuditStatus, string> = {
    success: "Berhasil",
    failed: "Gagal",
    queued: "Antre",
  };

  function formatWhen(iso: string): string {
    try {
      const d = new Date(iso);
      if (Number.isNaN(d.getTime())) return iso;
      return d.toLocaleString(undefined, {
        day: "2-digit",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return iso;
    }
  }

  async function copyCsv(): Promise<void> {
    try {
      await navigator.clipboard.writeText(toCsv(filtered));
      copied = true;
      window.setTimeout(() => (copied = false), 1800);
    } catch {
      copied = false;
    }
  }

  // Reset transient UI state whenever the panel is (re)opened.
  $effect(() => {
    if (open) {
      filter = "all";
      copied = false;
    }
  });
</script>

{#if open}
  <div
    class="audit-overlay"
    role="presentation"
    onclick={onClose}
    onkeydown={(e) => {
      if (e.key === "Escape") onClose();
    }}
  >
    <div
      class="audit-panel glass glass-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Audit log"
      tabindex="-1"
      onclick={(e) => e.stopPropagation()}
      onkeydown={(e) => e.stopPropagation()}
    >
      <header class="audit-header">
        <h2 class="audit-title">Audit Log</h2>
        <button
          type="button"
          class="audit-close"
          aria-label="Tutup audit log"
          onclick={onClose}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </header>

      <div class="audit-toolbar">
        <div class="audit-filters" role="group" aria-label="Filter audit log">
          {#each FILTERS as f (f.id)}
            <button
              type="button"
              class="audit-filter"
              class:active={filter === f.id}
              aria-pressed={filter === f.id}
              onclick={() => (filter = f.id)}
            >
              {f.label}
            </button>
          {/each}
        </div>
        <div class="audit-actions">
          <button
            type="button"
            class="audit-btn"
            disabled={filtered.length === 0}
            onclick={copyCsv}
          >
            {copied ? "Disalin!" : "Salin CSV"}
          </button>
          <button
            type="button"
            class="audit-btn danger"
            disabled={entries.length === 0}
            onclick={onClear}
          >
            Clear
          </button>
        </div>
      </div>

      <div class="audit-list">
        {#if filtered.length === 0}
          <p class="audit-empty">
            {entries.length === 0
              ? "Belum ada aktivitas tercatat."
              : "Tidak ada entri untuk filter ini."}
          </p>
        {:else}
          {#each filtered as e (e.id)}
            <div class="audit-row" class:failed={e.status === "failed"}>
              <span class="audit-status status-{e.status}" title={STATUS_LABEL[e.status]}></span>
              <div class="audit-main">
                <div class="audit-line1">
                  <span class="audit-action">{ACTION_LABEL[e.action]}</span>
                  {#if e.issueKey}
                    <span class="audit-issue">{e.issueKey}</span>
                  {/if}
                  {#if e.hours !== undefined}
                    <span class="audit-hours">{e.hours}j</span>
                  {/if}
                  {#if e.date}
                    <span class="audit-date">{e.date}</span>
                  {/if}
                  <span class="audit-source source-{e.source}">
                    {e.source === "auto" ? "otomatis" : "manual"}
                  </span>
                </div>
                {#if e.message}
                  <div class="audit-message">{e.message}</div>
                {/if}
              </div>
              <time class="audit-when" datetime={e.timestamp}>{formatWhen(e.timestamp)}</time>
            </div>
          {/each}
        {/if}
      </div>
    </div>
  </div>
{/if}

<style>
  .audit-overlay {
    position: fixed;
    inset: 0;
    z-index: 60;
    display: flex;
    align-items: flex-start;
    justify-content: center;
    padding: 4rem 1rem 1rem;
    background: rgba(2, 6, 23, 0.55);
    backdrop-filter: blur(4px);
    -webkit-backdrop-filter: blur(4px);
    overflow-y: auto;
    animation: audit-fade-in 160ms ease-out;
  }

  .audit-panel {
    position: relative;
    width: 100%;
    max-width: 40rem;
    max-height: 80vh;
    display: flex;
    flex-direction: column;
    padding: 1.25rem;
    animation: audit-pop-in 200ms cubic-bezier(0.22, 1, 0.36, 1);
  }

  .audit-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 0.875rem;
  }

  .audit-title {
    margin: 0;
    font-size: 1.125rem;
    font-weight: 700;
    color: #f1f5f9;
    letter-spacing: -0.01em;
  }

  .audit-close {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 2rem;
    height: 2rem;
    border-radius: 0.5rem;
    border: 1px solid transparent;
    background: transparent;
    color: rgba(255, 255, 255, 0.7);
    cursor: pointer;
    transition: background-color 150ms ease-out, color 150ms ease-out;
    outline: none;
  }

  .audit-close:hover {
    background: rgba(255, 255, 255, 0.08);
    color: #f1f5f9;
  }

  .audit-close:focus-visible {
    box-shadow: var(--focus-ring);
  }

  .audit-close svg {
    width: 1.125rem;
    height: 1.125rem;
  }

  .audit-toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 0.5rem;
    margin-bottom: 0.75rem;
  }

  .audit-filters {
    display: inline-flex;
    gap: 0.25rem;
    padding: 0.1875rem;
    border-radius: 0.625rem;
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid rgba(255, 255, 255, 0.1);
  }

  .audit-filter {
    padding: 0.3125rem 0.625rem;
    border: none;
    border-radius: 0.5rem;
    background: transparent;
    color: rgba(255, 255, 255, 0.7);
    font-size: 0.75rem;
    font-weight: 600;
    cursor: pointer;
    transition: background-color 150ms ease-out, color 150ms ease-out;
    outline: none;
  }

  .audit-filter:hover {
    color: #f1f5f9;
  }

  .audit-filter.active {
    background: rgba(99, 102, 241, 0.28);
    color: #e0e7ff;
  }

  .audit-filter:focus-visible {
    box-shadow: var(--focus-ring);
  }

  .audit-actions {
    display: inline-flex;
    gap: 0.5rem;
  }

  .audit-btn {
    padding: 0.375rem 0.75rem;
    border-radius: 0.5rem;
    border: 1px solid rgba(255, 255, 255, 0.14);
    background: rgba(255, 255, 255, 0.06);
    color: rgba(255, 255, 255, 0.85);
    font-size: 0.75rem;
    font-weight: 600;
    cursor: pointer;
    transition: background-color 150ms ease-out;
    outline: none;
  }

  .audit-btn:hover:not(:disabled) {
    background: rgba(255, 255, 255, 0.12);
  }

  .audit-btn.danger {
    border-color: rgba(239, 68, 68, 0.3);
    background: rgba(239, 68, 68, 0.12);
    color: #fca5a5;
  }

  .audit-btn.danger:hover:not(:disabled) {
    background: rgba(239, 68, 68, 0.2);
  }

  .audit-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .audit-btn:focus-visible {
    box-shadow: var(--focus-ring);
  }

  .audit-list {
    display: flex;
    flex-direction: column;
    gap: 0.375rem;
    overflow-y: auto;
    min-height: 0;
  }

  .audit-empty {
    margin: 1.5rem 0;
    text-align: center;
    font-size: 0.8125rem;
    color: rgba(255, 255, 255, 0.5);
  }

  .audit-row {
    display: flex;
    align-items: flex-start;
    gap: 0.625rem;
    padding: 0.5rem 0.625rem;
    border-radius: 0.5rem;
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid rgba(255, 255, 255, 0.06);
  }

  .audit-row.failed {
    background: rgba(239, 68, 68, 0.08);
    border-color: rgba(239, 68, 68, 0.22);
  }

  .audit-status {
    flex-shrink: 0;
    width: 0.5rem;
    height: 0.5rem;
    margin-top: 0.4375rem;
    border-radius: 999px;
  }

  .status-success {
    background: #4ade80;
  }

  .status-failed {
    background: #f87171;
  }

  .status-queued {
    background: #fbbf24;
  }

  .audit-main {
    flex: 1;
    min-width: 0;
  }

  .audit-line1 {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.375rem;
    font-size: 0.8125rem;
    color: rgba(255, 255, 255, 0.9);
  }

  .audit-action {
    font-weight: 600;
    color: #f1f5f9;
  }

  .audit-issue {
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 0.75rem;
    font-weight: 600;
    color: #c7d2fe;
  }

  .audit-hours,
  .audit-date {
    font-size: 0.75rem;
    color: rgba(255, 255, 255, 0.6);
  }

  .audit-source {
    font-size: 0.625rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    padding: 0.0625rem 0.375rem;
    border-radius: 999px;
  }

  .source-auto {
    background: rgba(99, 102, 241, 0.22);
    color: #c7d2fe;
  }

  .source-manual {
    background: rgba(255, 255, 255, 0.1);
    color: rgba(255, 255, 255, 0.7);
  }

  .audit-message {
    margin-top: 0.1875rem;
    font-size: 0.75rem;
    line-height: 1.4;
    color: rgba(255, 255, 255, 0.6);
    word-break: break-word;
  }

  .audit-when {
    flex-shrink: 0;
    font-size: 0.6875rem;
    color: rgba(255, 255, 255, 0.45);
    white-space: nowrap;
  }

  @keyframes audit-fade-in {
    from { opacity: 0; }
    to { opacity: 1; }
  }

  @keyframes audit-pop-in {
    from { opacity: 0; transform: translateY(-6px) scale(0.98); }
    to { opacity: 1; transform: translateY(0) scale(1); }
  }

  @media (prefers-reduced-motion: reduce) {
    .audit-overlay,
    .audit-panel {
      animation: none;
    }
  }
</style>
