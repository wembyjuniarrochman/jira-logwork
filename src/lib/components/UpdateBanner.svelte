<script lang="ts">
  /**
   * UpdateBanner
   *
   * Memberi tahu user saat ada versi baru, lalu memasangnya atas persetujuan
   * mereka. Muncul sebagai bar mengambang di kanan bawah supaya tidak
   * menutupi kalender atau bar "Submit changes" yang ada di tengah bawah.
   *
   * Pengecekan berjalan sekali saat komponen dipasang dan sengaja diam kalau
   * gagal — server update tidak terjangkau bukan alasan untuk mengganggu
   * user yang sedang bekerja.
   */
  import { t } from "../stores/i18n.svelte";
  import {
    checkForUpdate,
    UpdateRestartError,
    restartAfterUpdate,
    downloadAndInstall,
    downloadPercent,
    formatBytes,
    currentVersion,
    takeInstalledUpdate,
    type AvailableUpdate,
    type DownloadProgress,
  } from "../stores/updaterStore";
  import { updateCheckRequest } from "../stores/updateSignal.svelte";

  type Phase = "idle" | "available" | "installing" | "error" | "restart-error" | "updated";

  let phase = $state<Phase>("idle");
  let update = $state<AvailableUpdate | null>(null);
  let progress = $state<DownloadProgress>({ downloaded: 0, total: null });
  let errorMsg = $state<string | null>(null);
  let dismissed = $state<boolean>(false);
  let runningVersion = $state<string>("");
  let verifiedVersion = $state<string | null>(null);

  let percent = $derived(downloadPercent(progress));

  $effect(() => {
    void (async () => {
      const [current, installed] = await Promise.all([
        currentVersion(),
        takeInstalledUpdate(),
      ]);
      runningVersion = current;
      if (installed) {
        verifiedVersion = installed;
        phase = "updated";
        dismissed = false;
      }
    })();
  });

  // Berjalan sekali saat mount, lalu setiap kali panel Tentang meminta cek
  // ulang. Pengecekan manual juga membatalkan status "Nanti" sebelumnya —
  // user baru saja secara eksplisit menanyakan pembaruan.
  $effect(() => {
    const requested = updateCheckRequest();
    void (async () => {
      const found = await checkForUpdate();
      if (found && phase !== "installing" && phase !== "updated") {
        update = found;
        phase = "available";
        if (requested > 0) dismissed = false;
      }
    })();
  });

  async function install(): Promise<void> {
    if (!update || phase === "installing") return;
    const restartOnly = phase === "restart-error";
    phase = "installing";
    errorMsg = null;
    try {
      if (restartOnly) {
        await restartAfterUpdate();
      } else {
        await downloadAndInstall(update, (p) => {
          progress = p;
        });
      }
    } catch (err) {
      phase = restartOnly || err instanceof UpdateRestartError ? "restart-error" : "error";
      errorMsg = err instanceof Error ? err.message : String(err);
    }
  }
</script>

{#if !dismissed && phase !== "idle" && (update || verifiedVersion)}
  <div class="update-bar glass glass-overlay" role="status" aria-live="polite">
    <svg
      class="update-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <path d="M12 3v12" />
      <path d="m7 10 5 5 5-5" />
      <path d="M5 21h14" />
    </svg>

    <div class="update-body">
      {#if phase === "updated"}
        <span class="update-title">{t("update.updatedSuccess", { v: verifiedVersion ?? runningVersion })}</span>
        <span class="update-sub">{t("update.verified")}</span>
      {:else if phase === "installing" && update}
        <span class="update-title">{t("update.installing", { v: update.version })}</span>
        <div
          class="progress-track"
          role="progressbar"
          aria-valuenow={percent ?? undefined}
          aria-valuemin="0"
          aria-valuemax="100"
        >
          <div
            class="progress-fill"
            class:indeterminate={percent === null}
            style={percent === null ? "" : `width: ${percent}%`}
          ></div>
        </div>
        <span class="update-sub">
          {#if percent === null}
            {t("update.downloading", { n: formatBytes(progress.downloaded) })}
          {:else}
            {percent}% · {formatBytes(progress.downloaded)}
          {/if}
        </span>
      {:else if phase === "error" || phase === "restart-error"}
        <span class="update-title">{t(phase === "restart-error" ? "update.restartFailed" : "update.failed")}</span>
        <span class="update-sub error">{errorMsg}</span>
      {:else if update}
        <span class="update-title">{t("update.available", { v: update.version })}</span>
        <span class="version-transition">
          v{runningVersion || "…"} <span aria-hidden="true">→</span> v{update.version}
        </span>
        <span class="update-sub">
          {t("update.willRestart")}
        </span>
        <details class="release-notes">
          <summary>{t("update.releaseNotes")}</summary>
          <p>{update.notes?.trim() || t("update.noReleaseNotes")}</p>
        </details>
      {/if}
    </div>

    {#if phase !== "installing"}
      <div class="update-actions">
        {#if phase === "updated"}
          <button type="button" class="btn-install" onclick={() => (dismissed = true)}>
            {t("common.close")}
          </button>
        {:else}
          <button type="button" class="btn-later" onclick={() => (dismissed = true)}>
            {t("common.later")}
          </button>
          <button type="button" class="btn-install" onclick={install}>
            {phase === "restart-error" ? t("update.restart") : phase === "error" ? t("common.retry") : t("update.action")}
          </button>
        {/if}
      </div>
    {/if}
  </div>
{/if}

<style>
  .update-bar {
    position: fixed;
    right: 1.25rem;
    bottom: 1.25rem;
    z-index: 60;
    display: flex;
    align-items: flex-start;
    gap: 0.875rem;
    width: min(30rem, calc(100vw - 2.5rem));
    padding: 0.875rem 1rem;
    border-radius: 0.875rem;
    box-shadow: 0 18px 40px -12px rgb(var(--shadow-rgb) / calc(0.6 * var(--shadow-strength)));
    animation: update-bar-in 220ms cubic-bezier(0.22, 1, 0.36, 1);
  }

  .update-icon {
    width: 1.25rem;
    height: 1.25rem;
    flex-shrink: 0;
    color: var(--text-accent);
  }

  .update-body {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    min-width: 0;
    flex: 1;
  }

  .update-title {
    font-size: 0.875rem;
    font-weight: 600;
    color: var(--text-primary);
  }

  .update-sub {
    font-size: 0.75rem;
    color: rgb(var(--fg-rgb) / 0.6);
  }

  .version-transition {
    width: fit-content;
    padding: 0.2rem 0.5rem;
    border-radius: 999px;
    background: rgb(var(--fg-rgb) / 0.08);
    color: var(--text-accent-strong);
    font-size: 0.75rem;
    font-weight: 700;
  }

  .release-notes {
    margin-top: 0.2rem;
    font-size: 0.75rem;
    color: rgb(var(--fg-rgb) / 0.7);
  }

  .release-notes summary {
    cursor: pointer;
    color: var(--text-accent-strong);
    font-weight: 600;
  }

  .release-notes p {
    max-height: 7rem;
    margin: 0.45rem 0 0;
    overflow: auto;
    white-space: pre-wrap;
    line-height: 1.45;
  }

  .update-sub.error {
    color: var(--text-danger);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .progress-track {
    height: 0.375rem;
    border-radius: 999px;
    background: rgb(var(--fg-rgb) / 0.1);
    overflow: hidden;
  }

  .progress-fill {
    height: 100%;
    border-radius: 999px;
    background: linear-gradient(
      90deg,
      var(--accent-from) 0%,
      var(--accent-to) 100%
    );
    transition: width 180ms ease-out;
  }

  /* Server tidak selalu mengirim Content-Length; tanpa total kita tidak bisa
     menghitung persentase, jadi bar-nya bergerak bolak-balik. */
  .progress-fill.indeterminate {
    width: 40%;
    animation: indeterminate 1.1s ease-in-out infinite;
  }

  .update-actions {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-shrink: 0;
    align-self: center;
  }

  .btn-later,
  .btn-install {
    padding: 0.4375rem 0.75rem;
    border-radius: 999px;
    font-size: 0.8125rem;
    font-weight: 600;
    cursor: pointer;
    outline: none;
    transition:
      background 180ms ease-out,
      opacity 180ms ease-out;
  }

  .btn-later {
    border: 1px solid var(--glass-border);
    background: transparent;
    color: rgb(var(--fg-rgb) / 0.7);
  }

  .btn-later:hover {
    background: rgb(var(--fg-rgb) / 0.08);
  }

  .btn-install {
    border: none;
    color: var(--text-on-accent);
    background: linear-gradient(
      135deg,
      var(--accent-from) 0%,
      var(--accent-to) 100%
    );
  }

  .btn-install:hover {
    opacity: 0.92;
  }

  .btn-later:focus-visible,
  .btn-install:focus-visible {
    box-shadow: var(--focus-ring);
  }

  @keyframes update-bar-in {
    from {
      opacity: 0;
      transform: translateY(10px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  @keyframes indeterminate {
    0% { margin-left: -40%; }
    100% { margin-left: 100%; }
  }

  @media (prefers-reduced-motion: reduce) {
    .update-bar,
    .progress-fill.indeterminate {
      animation: none;
    }
  }
</style>
