<script lang="ts">
  // AnimatedCounter
  //
  // Smoothly tweens the displayed numeric value from its previous value to the
  // new `value` prop using requestAnimationFrame and an ease-out-cubic curve.
  //
  // - Default duration is 600ms; user-supplied durations are clamped to
  //   [200, 800] ms (Requirement 10.4).
  // - When the OS reports `prefers-reduced-motion: reduce` the displayed value
  //   jumps directly to the new value with no intermediate frames
  //   (Requirements 10.6 / 11.5). The `.animated-counter` class also lets the
  //   global rule in `src/app.css` neutralize transitions/animations on this
  //   element, so we keep the class even though the JS already short-circuits.
  // - Pure easing math lives in `./animatedCounterMath.ts` so it can be
  //   property-tested in isolation by task 4.2.
  import { untrack } from "svelte";
  import { clampDuration, easeOutCubic } from "./animatedCounterMath";

  interface Props {
    value: number;
    duration?: number;
    fractionDigits?: number;
  }

  let { value, duration = 600, fractionDigits }: Props = $props();

  let dur = $derived(clampDuration(duration));
  let digits = $derived(fractionDigits ?? 1);

  // Displayed value. Initialised to `value` so the first render shows the
  // correct number with no animation (there is nothing to tween from).
  let currentValue = $state(value);

  let rafId: number | null = null;

  function cancelTween(): void {
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
  }

  function prefersReducedMotion(): boolean {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return false;
    }
    try {
      return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    } catch {
      return false;
    }
  }

  $effect(() => {
    // Subscribe only to `value` and `dur` changes. Reading and writing
    // `currentValue` happens inside `untrack` so the rAF loop's writes do not
    // re-trigger the effect.
    const target = value;
    const tweenDuration = dur;

    untrack(() => {
      cancelTween();

      // Reduced-motion users always jump straight to the target value.
      if (prefersReducedMotion()) {
        currentValue = target;
        return;
      }

      const from = currentValue;
      if (from === target) {
        return;
      }

      const start =
        typeof performance !== "undefined" && typeof performance.now === "function"
          ? performance.now()
          : Date.now();

      const step = (now: number): void => {
        const elapsed = now - start;
        if (elapsed >= tweenDuration) {
          currentValue = target;
          rafId = null;
          return;
        }
        currentValue = easeOutCubic(elapsed, from, target, tweenDuration);
        rafId = requestAnimationFrame(step);
      };

      rafId = requestAnimationFrame(step);
    });

    return () => {
      cancelTween();
    };
  });
</script>

<span class="animated-counter">{currentValue.toFixed(digits)}</span>

<style>
  .animated-counter {
    /* Hint to the layout engine that this element will animate via JS. The
     * actual movement is driven by the rAF loop above; this just ensures we
     * paint on its own layer to avoid jitter. */
    will-change: contents;
    font-variant-numeric: tabular-nums;
  }
</style>
