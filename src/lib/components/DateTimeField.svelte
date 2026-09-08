<script lang="ts">
  /**
   * Pemilih tanggal + jam untuk form Log Work.
   *
   * Menggantikan `<input type="date">` dan `<input type="time">` bawaan
   * browser. Keduanya tidak bisa di-styling — chrome popup-nya milik OS —
   * sehingga selalu terlihat asing di tengah antarmuka yang seluruhnya
   * didesain sendiri, dan popup-nya tidak ikut berganti saat tema diganti.
   *
   * Bentuknya mengikuti pola "input calendar": kolom bersegmen yang bisa
   * diketik, ditemani kalender sebagai pelengkap. Kolom melayani pengguna
   * keyboard, kalender melayani mouse dan sentuh — kalender saja justru
   * memperlambat orang yang sudah tahu tanggal yang dituju.
   *
   * Chip pintasan ada karena konteksnya: modal Log Work dibuka dari klik
   * tanggal di kalender utama, jadi nilainya hampir selalu sudah benar
   * sebelum disentuh. Kolom ini sarana koreksi, dan koreksi pada pencatat
   * kerja hampir selalu berjarak dekat — hari ini atau beberapa hari ke
   * belakang, nyaris tidak pernah tahun lalu.
   *
   * Kontraknya sengaja tetap string `YYYY-MM-DD` dan `HH:mm` seperti input
   * native yang digantikan, sehingga pemanggilnya tidak perlu tahu apa pun
   * soal tipe tanggal dari pustaka ini.
   */

  import { DatePicker, TimeField } from "bits-ui";
  import {
    CalendarDate,
    Time,
    getLocalTimeZone,
    today,
    type DateValue,
  } from "@internationalized/date";
  import { t, lang } from "../stores/i18n.svelte";

  interface Props {
    /** Tanggal mulai, `YYYY-MM-DD`. */
    date: string;
    /** Jam mulai, `HH:mm`. */
    time: string;
    /** Dipakai `<label for=...>` milik pemanggil. */
    id?: string;
  }

  let { date = $bindable(), time = $bindable(), id }: Props = $props();

  // --- Konversi string ⇄ tipe pustaka ------------------------------------

  function toCalendarDate(value: string): CalendarDate | undefined {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value ?? "");
    if (!m) return undefined;
    const [, y, mo, d] = m;
    return new CalendarDate(Number(y), Number(mo), Number(d));
  }

  /**
   * Menerima `DateValue`, bukan `CalendarDate`: pustaka bisa mengirim
   * `CalendarDateTime` atau `ZonedDateTime` tergantung granularitas, dan
   * ketiganya sama-sama punya year/month/day yang kita butuhkan.
   */
  function toDateString(value: DateValue | undefined): string {
    if (!value) return "";
    const p = (n: number) => String(n).padStart(2, "0");
    return `${value.year}-${p(value.month)}-${p(value.day)}`;
  }

  function toTime(value: string): Time | undefined {
    const m = /^(\d{2}):(\d{2})$/.exec(value ?? "");
    return m ? new Time(Number(m[1]), Number(m[2])) : undefined;
  }

  function toTimeString(value: Time | undefined): string {
    if (!value) return "";
    const p = (n: number) => String(n).padStart(2, "0");
    return `${p(value.hour)}:${p(value.minute)}`;
  }

  // Sumber kebenaran tetap string milik pemanggil; nilai pustaka diturunkan
  // darinya, dan perubahan dari UI ditulis balik ke string.
  let dateValue = $derived(toCalendarDate(date));
  let timeValue = $derived(toTime(time));

  function onDateChange(next: DateValue | undefined): void {
    const s = toDateString(next);
    if (s) date = s;
  }

  function onTimeChange(next: Time | undefined): void {
    const s = toTimeString(next);
    if (s) time = s;
  }

  // --- Pintasan relatif ---------------------------------------------------

  const presets = $derived([
    { key: "log.dateToday", offset: 0 },
    { key: "log.dateYesterday", offset: -1 },
    { key: "log.dateTwoDaysAgo", offset: -2 },
  ]);

  function presetDate(offset: number): string {
    return toDateString(today(getLocalTimeZone()).add({ days: offset }));
  }

  /**
   * Dihitung dari string, bukan dari objek tanggal: dua `CalendarDate` dengan
   * nilai sama bukan objek yang sama, jadi perbandingan identitas akan selalu
   * meleset dan tidak ada chip yang pernah tampak terpilih.
   */
  function isPresetActive(offset: number): boolean {
    return date === presetDate(offset);
  }

  // `@internationalized/date` memakai kode BCP-47; store bahasa memakai
  // "en" / "id" yang kebetulan sudah sah sebagai kode bahasa.
  const locale = $derived(lang() === "id" ? "id-ID" : "en-US");
</script>

<div class="datetime-field">
  <div class="datetime-row">
    <DatePicker.Root
      value={dateValue}
      onValueChange={onDateChange}
      {locale}
      weekStartsOn={1}
      preventDeselect
    >
      <div class="picker-shell">
        <DatePicker.Input>
          {#snippet children({ segments })}
            <!-- Dikunci indeks, bukan `part`: pemisah seperti "/" dan ":"
                   sama-sama ber-part "literal", jadi mengunci dengan part
                   menghasilkan kunci duplikat dan Svelte melempar saat
                   render. Susunan segmen tetap, jadi indeks aman. -->
              {#each segments as { part, value }, i (i)}
              <DatePicker.Segment {part} class="segment" data-part={part}>
                {value}
              </DatePicker.Segment>
            {/each}
          {/snippet}
        </DatePicker.Input>
        <DatePicker.Trigger class="picker-trigger" aria-label={t("log.openCalendar")}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
            <rect x="3" y="5" width="18" height="16" rx="2" />
            <path d="M3 10h18M8 3v4M16 3v4" />
          </svg>
        </DatePicker.Trigger>
      </div>

      <DatePicker.Content class="picker-popover glass-overlay" sideOffset={8}>
        <DatePicker.Calendar class="calendar">
          {#snippet children({ months, weekdays })}
            <DatePicker.Header class="cal-header">
              <DatePicker.PrevButton class="cal-nav" aria-label={t("log.prevMonth")}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <polyline points="15 6 9 12 15 18" />
                </svg>
              </DatePicker.PrevButton>
              <DatePicker.Heading class="cal-heading" />
              <DatePicker.NextButton class="cal-nav" aria-label={t("log.nextMonth")}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <polyline points="9 6 15 12 9 18" />
                </svg>
              </DatePicker.NextButton>
            </DatePicker.Header>

            {#each months as month (month.value)}
              <DatePicker.Grid class="cal-grid">
                <DatePicker.GridHead>
                  <DatePicker.GridRow class="cal-row">
                    {#each weekdays as day (day)}
                      <DatePicker.HeadCell class="cal-weekday">{day.slice(0, 2)}</DatePicker.HeadCell>
                    {/each}
                  </DatePicker.GridRow>
                </DatePicker.GridHead>
                <DatePicker.GridBody>
                  {#each month.weeks as week (week[0])}
                    <DatePicker.GridRow class="cal-row">
                      {#each week as d (d)}
                        <DatePicker.Cell date={d} month={month.value} class="cal-cell">
                          <DatePicker.Day class="cal-day">{d.day}</DatePicker.Day>
                        </DatePicker.Cell>
                      {/each}
                    </DatePicker.GridRow>
                  {/each}
                </DatePicker.GridBody>
              </DatePicker.Grid>
            {/each}
          {/snippet}
        </DatePicker.Calendar>
      </DatePicker.Content>
    </DatePicker.Root>

    <TimeField.Root
      value={timeValue}
      onValueChange={onTimeChange}
      {locale}
      hourCycle={24}
      granularity="minute"
    >
      <div class="picker-shell picker-shell-time">
        <TimeField.Input>
          {#snippet children({ segments })}
            <!-- Dikunci indeks, bukan `part`: pemisah seperti "/" dan ":"
                   sama-sama ber-part "literal", jadi mengunci dengan part
                   menghasilkan kunci duplikat dan Svelte melempar saat
                   render. Susunan segmen tetap, jadi indeks aman. -->
              {#each segments as { part, value }, i (i)}
              <TimeField.Segment {part} class="segment" data-part={part}>
                {value}
              </TimeField.Segment>
            {/each}
          {/snippet}
        </TimeField.Input>
      </div>
    </TimeField.Root>
  </div>

  <div class="date-presets" role="group" aria-label={t("log.dateShortcuts")}>
    {#each presets as p (p.offset)}
      <button
        type="button"
        class="date-preset"
        class:selected={isPresetActive(p.offset)}
        aria-pressed={isPresetActive(p.offset)}
        onclick={() => (date = presetDate(p.offset))}
      >
        {t(p.key)}
      </button>
    {/each}
  </div>
</div>

<style>
  .datetime-field {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .datetime-row {
    display: flex;
    gap: 0.5rem;
  }

  /* Kulit yang meniru input lain di kartu ini, supaya kolom bersegmen tidak
     terbaca sebagai jenis kontrol yang berbeda. */
  .picker-shell {
    flex: 1 1 60%;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 0.25rem;
    padding: 0.5rem 0.5rem 0.5rem 0.75rem;
    border-radius: 0.5rem;
    border: 1px solid rgb(var(--fg-rgb) / 0.12);
    background: rgb(var(--fg-rgb) / 0.06);
    transition:
      border-color 0.2s ease-out,
      box-shadow 0.15s ease-out,
      background 0.2s ease-out;
  }

  .picker-shell-time {
    flex: 1 1 40%;
    padding-right: 0.75rem;
  }

  .picker-shell:hover {
    background: rgb(var(--fg-rgb) / 0.08);
    border-color: rgb(var(--fg-rgb) / 0.2);
  }

  /* Cincin fokus dipasang di kulitnya, bukan di tiap segmen: yang menerima
     fokus adalah segmen, tapi yang harus terlihat menyala adalah kolomnya. */
  .picker-shell:has(:focus-visible) {
    border-color: rgba(99, 102, 241, 0.6);
    box-shadow: var(--focus-ring);
    background: rgb(var(--fg-rgb) / 0.08);
  }

  .datetime-field :global(.segment) {
    padding: 0.0625rem 0.125rem;
    border-radius: 0.25rem;
    color: var(--text-primary);
    font-size: 0.875rem;
    font-variant-numeric: tabular-nums;
    outline: none;
  }

  .datetime-field :global(.segment[data-part="literal"]) {
    padding: 0;
    color: rgb(var(--fg-rgb) / 0.4);
  }

  .datetime-field :global(.segment:focus) {
    background: rgba(99, 102, 241, 0.35);
    color: var(--text-strong);
  }

  /* Segmen yang belum diisi tampil sebagai placeholder. */
  .datetime-field :global(.segment[data-placeholder]) {
    color: rgb(var(--fg-rgb) / 0.4);
  }

  .datetime-field :global(.picker-trigger) {
    flex-shrink: 0;
    margin-left: auto;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 1.75rem;
    height: 1.75rem;
    padding: 0;
    border: none;
    border-radius: 0.375rem;
    background: transparent;
    color: rgb(var(--fg-rgb) / 0.55);
    cursor: pointer;
    transition: background 0.15s ease-out, color 0.15s ease-out;
  }

  .datetime-field :global(.picker-trigger svg) {
    width: 1rem;
    height: 1rem;
  }

  .datetime-field :global(.picker-trigger:hover) {
    background: rgb(var(--fg-rgb) / 0.1);
    color: var(--text-primary);
  }

  .datetime-field :global(.picker-trigger:focus-visible) {
    box-shadow: var(--focus-ring);
    color: var(--text-primary);
  }

  /* --- Popover kalender ------------------------------------------------ */

  :global(.picker-popover) {
    z-index: 60;
    padding: 0.75rem;
    border-radius: 0.75rem;
    border: 1px solid var(--glass-border);
    box-shadow: 0 18px 40px rgb(var(--shadow-rgb) / calc(0.35 * var(--shadow-strength)));
  }

  :global(.cal-header) {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    margin-bottom: 0.5rem;
  }

  :global(.cal-heading) {
    font-size: 0.8125rem;
    font-weight: 600;
    color: var(--text-primary);
  }

  :global(.cal-nav) {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 1.5rem;
    height: 1.5rem;
    padding: 0;
    border: none;
    border-radius: 0.375rem;
    background: transparent;
    color: rgb(var(--fg-rgb) / 0.55);
    cursor: pointer;
    transition: background 0.15s ease-out, color 0.15s ease-out;
  }

  :global(.cal-nav svg) {
    width: 0.875rem;
    height: 0.875rem;
  }

  :global(.cal-nav:hover) {
    background: rgb(var(--fg-rgb) / 0.1);
    color: var(--text-primary);
  }

  :global(.cal-nav:focus-visible) {
    box-shadow: var(--focus-ring);
  }

  :global(.cal-grid) {
    border-collapse: collapse;
  }

  :global(.cal-row) {
    display: grid;
    grid-template-columns: repeat(7, 1fr);
  }

  :global(.cal-weekday) {
    padding-bottom: 0.25rem;
    font-size: 0.6875rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: rgb(var(--fg-rgb) / 0.45);
  }

  :global(.cal-cell) {
    padding: 0.0625rem;
  }

  :global(.cal-day) {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 2rem;
    height: 2rem;
    border-radius: 0.5rem;
    border: 1px solid transparent;
    background: transparent;
    color: var(--text-primary);
    font-size: 0.8125rem;
    font-variant-numeric: tabular-nums;
    cursor: pointer;
    transition: background 0.15s ease-out, color 0.15s ease-out;
  }

  :global(.cal-day:hover) {
    background: rgb(var(--fg-rgb) / 0.1);
  }

  :global(.cal-day:focus-visible) {
    box-shadow: var(--focus-ring);
  }

  /* Tanggal di luar bulan yang sedang ditampilkan. */
  :global(.cal-day[data-outside-month]) {
    color: rgb(var(--fg-rgb) / 0.25);
  }

  /* Hari ini ditandai garis bawah, bukan latar — supaya tidak bersaing
     dengan penanda "terpilih" yang justru harus paling menonjol. */
  :global(.cal-day[data-today]:not([data-selected])) {
    border-color: rgb(var(--fg-rgb) / 0.25);
    font-weight: 600;
  }

  :global(.cal-day[data-selected]) {
    background: linear-gradient(135deg, var(--accent-from) 0%, var(--accent-to) 100%);
    border-color: transparent;
    color: var(--text-on-accent);
    font-weight: 600;
  }

  :global(.cal-day[data-disabled]) {
    color: rgb(var(--fg-rgb) / 0.2);
    cursor: default;
  }

  /* --- Chip pintasan --------------------------------------------------- */

  .date-presets {
    display: flex;
    flex-wrap: wrap;
    gap: 0.375rem;
  }

  .date-preset {
    padding: 0.25rem 0.625rem;
    border-radius: 0.5rem;
    border: 1px solid var(--glass-border);
    background: var(--glass-bg-strong);
    color: rgb(var(--fg-rgb) / 0.75);
    font: inherit;
    font-size: 0.75rem;
    cursor: pointer;
    transition:
      background 0.2s ease-out,
      border-color 0.2s ease-out,
      color 0.2s ease-out;
    outline: none;
  }

  .date-preset:hover {
    background: rgb(var(--fg-rgb) / 0.12);
    color: var(--text-primary);
  }

  .date-preset:focus-visible {
    box-shadow: var(--focus-ring);
    border-color: rgba(99, 102, 241, 0.6);
  }

  .date-preset.selected {
    background: rgba(99, 102, 241, 0.22);
    border-color: rgba(99, 102, 241, 0.5);
    color: var(--text-accent-strong);
  }

  @media (prefers-reduced-motion: reduce) {
    .picker-shell,
    .date-preset {
      transition: none;
    }
  }
</style>
