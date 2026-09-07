<script lang="ts">
  import { t } from "../stores/i18n.svelte";
  /**
   * TimePresetChips
   *
   * A radio-group of five time-preset chips (0.5, 1, 2, 4, 8 hours).
   * Implements the WAI-ARIA radio-group pattern:
   *   - The chip matching `value` (or the first chip if `value` is null) is the
   *     single tab-stop via roving tabindex.
   *   - Left/Right arrow keys move selection (and focus) to the previous/next
   *     chip, wrapping at the ends, and immediately call `onChange` with the
   *     newly focused chip's value (radio-group behavior per R13.5).
   *   - Space and Enter confirm the focused chip's value (also calling
   *     `onChange`), so a chip can be selected from a `null` start state via
   *     Tab + Space without first using arrow keys.
   *
   * Validates: Requirements 8.1, 8.2, 11.3, 11.4, 13.5
   */

  import {
    PRESET_MINUTES,
    minutesOf,
    formatDuration,
    type ChipValue,
  } from "../stores/quickLogReducer";

  interface Props {
    value: ChipValue | null;
    onChange: (value: ChipValue) => void;
  }

  const { value, onChange }: Props = $props();

  // Daftar preset berasal dari satu sumber di store; di sini dipakai dalam
  // jam agar antarmuka komponen tidak berubah.
  const VALUES: readonly number[] = PRESET_MINUTES.map((m) => m / 60);

  // Roving-tabindex anchor: the index of the chip that is the current tab stop.
  // - When `value` is one of the chip values, that chip is tabbable.
  // - When `value` is null, the first chip is tabbable (no chip is checked).
  // Dicocokkan lewat menit, bukan kesetaraan float: 5/60 tidak pernah sama
  // persis dengan nilai jam yang datang dari nilai tersimpan.
  const focusIndex = $derived(
    value === null
      ? 0
      : Math.max(
          0,
          VALUES.findIndex((v) => minutesOf(v) === minutesOf(value)),
        ),
  );

  // Refs to each button for focus management on arrow-key navigation.
  let buttons: (HTMLButtonElement | null)[] = $state(VALUES.map(() => null));

  function format(v: number): string {
    return formatDuration(minutesOf(v));
  }

  function selectAt(index: number) {
    const next = VALUES[((index % VALUES.length) + VALUES.length) % VALUES.length];
    onChange(next);
    // Move focus to match selection so keyboard users see the focus ring on
    // the newly selected chip. Schedule after the prop update propagates.
    queueMicrotask(() => {
      buttons[((index % VALUES.length) + VALUES.length) % VALUES.length]?.focus();
    });
  }

  function handleKeydown(event: KeyboardEvent, index: number) {
    switch (event.key) {
      case "ArrowRight":
      case "ArrowDown": {
        event.preventDefault();
        selectAt(index + 1);
        break;
      }
      case "ArrowLeft":
      case "ArrowUp": {
        event.preventDefault();
        selectAt(index - 1);
        break;
      }
      case " ":
      case "Spacebar":
      case "Enter": {
        event.preventDefault();
        selectAt(index);
        break;
      }
    }
  }
</script>

<div
  class="chip-group"
  role="radiogroup"
  aria-label={t("chips.label")}
>
  {#each VALUES as chip, i (chip)}
    {@const checked = value === chip}
    <button
      bind:this={buttons[i]}
      type="button"
      role="radio"
      aria-checked={checked}
      tabindex={i === focusIndex ? 0 : -1}
      class="chip"
      class:selected={checked}
      onclick={() => onChange(chip)}
      onkeydown={(e) => handleKeydown(e, i)}
    >
      {format(chip)}
    </button>
  {/each}
</div>

<style>
  .chip-group {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
  }

  .chip {
    /* Glass-style chip, consistent with the workspace surface tokens. */
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 3rem;
    padding: 0.5rem 0.875rem;
    border-radius: 0.625rem;
    border: 1px solid var(--glass-border);
    background: var(--glass-bg-strong);
    color: rgb(var(--fg-rgb) / 0.85);
    font-size: 0.875rem;
    font-weight: 500;
    line-height: 1;
    cursor: pointer;
    user-select: none;
    transition:
      background 200ms ease-out,
      border-color 200ms ease-out,
      color 200ms ease-out,
      box-shadow 150ms ease-out;
    outline: none;
  }

  .chip:hover {
    background: rgb(var(--fg-rgb) / 0.12);
    border-color: rgb(var(--fg-rgb) / 0.18);
    color: var(--text-primary);
  }

  /* Visible focus ring distinct from hover (R11.4). */
  .chip:focus-visible {
    box-shadow: var(--focus-ring);
    border-color: rgba(99, 102, 241, 0.6);
  }

  .chip.selected {
    background: linear-gradient(
      135deg,
      var(--accent-from) 0%,
      var(--accent-to) 100%
    );
    border-color: transparent;
    color: white;
    box-shadow: 0 4px 15px rgba(99, 102, 241, 0.3);
  }

  .chip.selected:hover {
    /* Keep the gradient on hover; subtle lift only. */
    box-shadow: 0 6px 20px rgba(99, 102, 241, 0.4);
  }

  .chip.selected:focus-visible {
    /* Combine accent shadow with focus ring so focus stays distinguishable. */
    box-shadow:
      var(--focus-ring),
      0 4px 15px rgba(99, 102, 241, 0.3);
  }

  @media (prefers-reduced-motion: reduce) {
    .chip {
      transition: none;
    }
  }
</style>
