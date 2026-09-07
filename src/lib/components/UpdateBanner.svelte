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
  import {
    checkForUpdate,
    downloadAndInstall,
    downloadPercent,
    formatBytes,
    type AvailableUpdate,
    type DownloadProgress,
  } from "../stores/updaterStore";
  import { updateCheckRequest } from "../stores/updateSignal.svelte";

  type Phase = "idle" | "available" | "installing" | "error";

  let phase = $state<Phase>("idle");
  let update = $state<AvailableUpdate | null>(null);
  let progress = $state<DownloadProgress>({ downloaded: 0, total: null });
  let errorMsg = $state<string | null>(null);
  let dismissed = $state<boolean>(false);

  let percent = $derived(downloadPercent(progress));

  // Berjalan sekali saat mount, lalu setiap kali panel Tentang meminta cek
  // ulang. Pengecekan manual juga membatalkan status "Nanti" sebelumnya —
  // user baru saja secara eksplisit menanyakan pembaruan.
  $effect(() => {
    const requested = updateCheckRequest();
    void (async () => {
      const found = await checkForUpdate();
      if (found) {
        update = found;
        phase = "available";
        if (requested > 0) dismissed = false;
      }
    })();
  });

  async function install(): Promise<void> {
    if (!update) return;
    phase = "installing";
    errorMsg = null;
    try {
      await downloadAndInstall(update, (p) => {
        progress = p;
      });
    } catch (err) {
      phase = "error";
      errorMsg = err instanceof Error ? err.message : String(err);
    }
  }
</script>

{#if update && !dismissed && phase !== "idle"}
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
      {#if phase === "installing"}
        <span class="update-title">Memasang versi {update.version}…</span>
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
            Mengunduh {formatBytes(progress.downloaded)}…
          {:else}
            {percent}% · {formatBytes(progress.downloaded)}
          {/if}
        </span>
      {:else if phase === "error"}
        <span class="update-title">Gagal memasang update</span>
        <span class="update-sub error">{errorMsg}</span>
      {:else}
        <span class="update-title">Versi {update.version} tersedia</span>
        <span class="update-sub">
          Aplikasi akan dimuat ulang setelah update dipasang.
        </span>
      {/if}
    </div>

    {#if phase !== "installing"}
      <div class="update-actions">
        <button type="button" class="btn-later" onclick={() => (dismissed = true)}>
          Nanti
        </button>
        <button type="button" class="btn-install" onclick={install}>
          {phase === "error" ? "Coba lagi" : "Update"}
        </button>
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
    align-items: center;
    gap: 0.875rem;
    width: min(24rem, calc(100vw - 2.5rem));
    padding: 0.875rem 1rem;
    border-radius: 0.875rem;
    box-shadow: 0 18px 40px -12px rgba(0, 0, 0, 0.6);
    animation: update-bar-in 220ms cubic-bezier(0.22, 1, 0.36, 1);
  }

  .update-icon {
    width: 1.25rem;
    height: 1.25rem;
    flex-shrink: 0;
    color: #a5b4fc;
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
    color: #f1f5f9;
  }

  .update-sub {
    font-size: 0.75rem;
    color: rgba(255, 255, 255, 0.6);
  }

  .update-sub.error {
    color: #fca5a5;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .progress-track {
    height: 0.375rem;
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.1);
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
    color: rgba(255, 255, 255, 0.7);
  }

  .btn-later:hover {
    background: rgba(255, 255, 255, 0.08);
  }

  .btn-install {
    border: none;
    color: #fff;
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
