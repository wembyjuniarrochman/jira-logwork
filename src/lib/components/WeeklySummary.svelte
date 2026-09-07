<script lang="ts">
  /**
   * WeeklySummary
   *
   * Ringkasan jam kerja yang sinkron dengan mode CalendarGrid.
   *   - mode "day"   → hari yang sedang dilihat (selectedDate). Target 8 jam
   *                    fixed (mengakomodasi shifting / kerja Sabtu-Minggu).
   *   - mode "week"  → minggu kalender yang memuat cursorDate (Min..Sab).
   *                    Target = (5 - libur_di_minggu_itu) × 8 jam, di mana
   *                    "libur" = tanggal merah resmi yang jatuh di
   *                    Senin–Jumat (Sabtu/Minggu sudah weekend, tidak
   *                    mengurangi kuota lagi).
   *   - mode "month" → bulan yang memuat cursorDate. Target = jumlah hari
   *                    kerja efektif (Senin–Jumat dikurangi tanggal merah)
   *                    × 8 jam.
   *
   * Saat data masih loading, render skeleton.
   */

  import { t } from "../stores/i18n.svelte";
  import AnimatedCounter from "./AnimatedCounter.svelte";
  import type { WorklogDay } from "../stores/heatmapStore";
  import { clamp01 } from "../stores/settingsStore";
  import {
    countHolidaysInRange,
    countWorkdaysInRange,
  } from "../stores/indonesianHolidaysStore";

  type SummaryMode = "day" | "week" | "month";

  interface Props {
    worklogsByDate: Record<string, WorklogDay>;
    /** Default 8 — bisa diganti dari pengaturan workspace. */
    targetHours: number;
    isLoading: boolean;
    /** Hari ini (untuk default cursor + flag "hari ini"). */
    today: Date;
    /** Mode panel — selaras dengan mode CalendarGrid. */
    mode: SummaryMode;
    /** Tanggal jangkar periode (selectedDate / cursor calendar). */
    cursorDate: Date;
  }

  let {
    worklogsByDate,
    targetHours,
    isLoading,
    today,
    mode,
    cursorDate,
  }: Props = $props();

  // ----------------------------------------------------------------------
  // Pure date helpers (kept local — sama style dengan heatmapStore.ts).
  // ----------------------------------------------------------------------

  function toYMD(d: Date): string {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }

  function addDays(d: Date, days: number): Date {
    const result = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    result.setDate(result.getDate() + days);
    return result;
  }

  /** Minggu (Sunday) dari minggu yang memuat `d`. CalendarGrid memakai
   *  patokan Minggu sebagai awal minggu, jadi WeeklySummary mengikuti
   *  konvensi yang sama supaya rentangnya sinkron. */
  function startOfSundayWeek(d: Date): Date {
    return addDays(d, -d.getDay());
  }

  /** Pure: jumlahkan `totalHours` antara `start..end` (inclusive). */
  function sumHoursInRange(
    byDate: Record<string, WorklogDay>,
    start: Date,
    end: Date,
  ): number {
    let total = 0;
    let cur = new Date(start.getFullYear(), start.getMonth(), start.getDate());
    const last = new Date(end.getFullYear(), end.getMonth(), end.getDate());
    while (cur.getTime() <= last.getTime()) {
      const ymd = toYMD(cur);
      const day = byDate[ymd];
      if (day && Number.isFinite(day.totalHours)) total += day.totalHours;
      cur = addDays(cur, 1);
    }
    return total;
  }

  // ----------------------------------------------------------------------
  // Range, total, dan target per mode
  // ----------------------------------------------------------------------

  /** Tuple [startYMD, endYMD] untuk mode aktif. */
  let range = $derived.by<{ startDate: Date; endDate: Date; startYMD: string; endYMD: string }>(() => {
    if (mode === "day") {
      const d = cursorDate;
      const ymd = toYMD(d);
      return { startDate: d, endDate: d, startYMD: ymd, endYMD: ymd };
    }
    if (mode === "week") {
      const sun = startOfSundayWeek(cursorDate);
      const sat = addDays(sun, 6);
      return {
        startDate: sun,
        endDate: sat,
        startYMD: toYMD(sun),
        endYMD: toYMD(sat),
      };
    }
    // month
    const first = new Date(cursorDate.getFullYear(), cursorDate.getMonth(), 1);
    const last = new Date(cursorDate.getFullYear(), cursorDate.getMonth() + 1, 0);
    return {
      startDate: first,
      endDate: last,
      startYMD: toYMD(first),
      endYMD: toYMD(last),
    };
  });

  /** Total jam yang sudah di-log dalam range aktif. */
  let totalHours = $derived(
    sumHoursInRange(worklogsByDate, range.startDate, range.endDate),
  );

  /** Target jam aktif sesuai mode. */
  let totalTarget = $derived.by<number>(() => {
    const base = targetHours > 0 ? targetHours : 8;
    if (mode === "day") {
      // Tetap 8 jam untuk semua hari (mengakomodasi shifting / kerja
      // Sabtu-Minggu). Tidak peduli weekend atau tanggal merah.
      return base;
    }
    if (mode === "week") {
      // 5 hari kerja Senin–Jumat dikurangi libur nasional/cuti bersama
      // yang jatuh di hari kerja itu.
      const holidays = countHolidaysInRange(range.startYMD, range.endYMD);
      const workdays = Math.max(0, 5 - holidays);
      return workdays * base;
    }
    // month — hitung hari Senin–Jumat dalam bulan dikurangi libur.
    const workdays = countWorkdaysInRange(range.startYMD, range.endYMD);
    return workdays * base;
  });

  let progress = $derived(
    totalTarget > 0 ? clamp01(totalHours / totalTarget) : 0,
  );

  let progressPercent = $derived(Math.round(progress * 100));
  let targetReached = $derived(totalTarget > 0 && progress >= 1);

  // Heading per mode (English, sesuai permintaan).
  let title = $derived(
    mode === "day" ? t("calendar.day") : mode === "week" ? t("calendar.week") : t("calendar.month"),
  );
</script>

<section
  class="weekly-summary glass"
  aria-labelledby="weekly-summary-heading"
>
  {#if isLoading}
    <div class="summary-row">
      <h3 id="weekly-summary-heading" class="title">{title}</h3>
      <div class="skeleton skeleton-counter"></div>
    </div>
    <div class="skeleton skeleton-bar"></div>
    <span class="sr-only">{t("misc.loadingSummary")}</span>
  {:else}
    <!-- Compact single row: title + counter/target + (optional) reached badge,
         with a thin progress bar beneath — keeps the card short so the calendar
         fits on one screen. -->
    <div class="summary-row">
      <h3 id="weekly-summary-heading" class="title">{title}</h3>
      <span class="counter">
        <AnimatedCounter value={totalHours} fractionDigits={1} />
        <span class="counter-unit">h</span>
      </span>
      <span class="target">/ {totalTarget.toFixed(1)} target</span>
      {#if targetReached}
        <span class="target-reached" aria-live="polite">🎯 {t("misc.targetReached")}</span>
      {/if}
    </div>

    <div
      class="progress-track"
      role="progressbar"
      aria-valuemin="0"
      aria-valuemax="100"
      aria-valuenow={progressPercent}
      aria-label={`${title} progress toward target`}
    >
      <div
        class="progress-fill"
        class:full={targetReached}
        style="width: {progressPercent}%;"
      ></div>
    </div>
  {/if}
</section>

<style>
  .weekly-summary {
    display: flex;
    flex-direction: column;
    gap: 0.375rem;
    padding: 0.5rem 1rem;
    width: 100%;
  }

  .summary-row {
    display: flex;
    align-items: baseline;
    gap: 0.5rem;
    flex-wrap: nowrap;
  }

  .title {
    margin: 0;
    font-size: 0.625rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: rgb(var(--fg-rgb) / 0.45);
  }

  .target-reached {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    margin-left: auto;
    align-self: center;
    padding: 0.1875rem 0.5rem;
    border-radius: 999px;
    background: rgba(34, 197, 94, 0.18);
    border: 1px solid rgba(34, 197, 94, 0.4);
    color: var(--text-success);
    font-size: 0.6875rem;
    font-weight: 600;
    letter-spacing: 0.02em;
  }

  /* --- Totals --- */

  .counter {
    display: inline-flex;
    align-items: baseline;
    gap: 0.125rem;
    font-size: 1.125rem;
    font-weight: 800;
    line-height: 1;
    color: var(--text-strong);
    font-variant-numeric: tabular-nums;
  }

  .counter-unit {
    font-size: 0.75rem;
    font-weight: 600;
    color: rgb(var(--fg-rgb) / 0.7);
  }

  .target {
    font-size: 0.8125rem;
    font-weight: 500;
    color: rgb(var(--fg-rgb) / 0.45);
    font-variant-numeric: tabular-nums;
  }

  /* --- Progress bar --- */

  .progress-track {
    position: relative;
    width: 100%;
    height: 0.625rem;
    border-radius: 999px;
    background: var(--glass-bg-strong);
    border: 1px solid var(--glass-border);
    overflow: hidden;
  }

  .progress-fill {
    position: relative;
    height: 100%;
    border-radius: 999px;
    overflow: hidden;
    background: linear-gradient(
      90deg,
      var(--accent-from) 0%,
      var(--accent-to) 100%
    );
    box-shadow: 0 0 12px rgba(99, 102, 241, 0.45);
    transition: width 400ms cubic-bezier(0.22, 1, 0.36, 1);
    /* Tumbuh dari kiri saat pertama dirender. Memakai transform, bukan
       width, supaya tidak bertabrakan dengan `width` inline yang membawa
       nilai persentase sesungguhnya. */
    transform-origin: left center;
    animation: progress-grow 720ms cubic-bezier(0.22, 1, 0.36, 1) both;
  }

  /* Kilau yang menyapu isian — memberi kesan "sedang berjalan" tanpa
     mengubah angka apa pun. Dibatasi ke dalam isian oleh `overflow: hidden`
     di atas, jadi ia berhenti tepat di ujung progres. */
  .progress-fill::after {
    content: "";
    position: absolute;
    inset: 0;
    background: linear-gradient(
      90deg,
      transparent 0%,
      rgb(var(--fg-rgb) / 0.38) 50%,
      transparent 100%
    );
    animation: progress-sheen 2.6s ease-in-out infinite;
  }

  @keyframes progress-grow {
    from { transform: scaleX(0); }
    to   { transform: scaleX(1); }
  }

  @keyframes progress-sheen {
    from { transform: translateX(-100%); }
    /* Jeda di ujung supaya kilaunya tidak terasa gelisah. */
    60%, to { transform: translateX(100%); }
  }

  .progress-fill.full {
    background: linear-gradient(
      90deg,
      #34d399 0%,
      #6366f1 60%,
      #8b5cf6 100%
    );
    box-shadow: 0 0 16px rgba(52, 211, 153, 0.4);
    animation:
      progress-grow 720ms cubic-bezier(0.22, 1, 0.36, 1) both,
      progress-glow 2.8s ease-in-out infinite;
  }

  /* Target tercapai: denyut halus pada glow-nya sebagai perayaan kecil. */
  @keyframes progress-glow {
    0%, 100% { box-shadow: 0 0 16px rgba(52, 211, 153, 0.4); }
    50%      { box-shadow: 0 0 26px rgba(52, 211, 153, 0.65); }
  }

  /* --- Skeleton loader --- */

  .skeleton {
    position: relative;
    overflow: hidden;
    border-radius: 0.5rem;
    background: rgb(var(--fg-rgb) / 0.06);
  }

  .skeleton::after {
    content: "";
    position: absolute;
    inset: 0;
    background: linear-gradient(
      90deg,
      transparent 0%,
      rgb(var(--fg-rgb) / 0.08) 50%,
      transparent 100%
    );
    transform: translateX(-100%);
    animation: shimmer 1400ms ease-in-out infinite;
  }

  .skeleton-counter {
    width: 9rem;
    height: 2rem;
  }

  .skeleton-bar {
    width: 100%;
    height: 0.625rem;
    border-radius: 999px;
  }

  @keyframes shimmer {
    0% { transform: translateX(-100%); }
    100% { transform: translateX(100%); }
  }

  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }

  @media (prefers-reduced-motion: reduce) {
    /* Bar tetap tampil penuh pada lebar akhirnya — hanya geraknya yang
       dimatikan, bukan informasinya. */
    .progress-fill {
      transition: none;
      animation: none;
      transform: none;
    }
    .progress-fill::after { animation: none; opacity: 0; }
    .skeleton::after { animation: none; }
  }
</style>
