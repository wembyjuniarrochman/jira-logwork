// Pure math helper for AnimatedCounter.
//
// Extracted to a sibling .ts module (not the .svelte file) so the easing
// function can be exercised directly by the property test in task 4.2 without
// having to mount the component or use jsdom timers.

/**
 * Ease-out-cubic interpolation between `from` and `to` over `duration`
 * milliseconds.
 *
 * The easing curve maps normalized progress `p` (in [0, 1]) to
 * `1 - (1 - p)^3`, then linearly interpolates `from -> to` along that curve.
 *
 * Property guarantees (used by Property 19 in the design):
 *   - easeOutCubic(0, from, to, duration)        === from
 *   - easeOutCubic(duration, from, to, duration) === to
 *   - For 0 <= t <= duration the result lies on the segment [from, to].
 *
 * Edge cases:
 *   - duration <= 0:  the tween is degenerate; returns `to`.
 *   - t <= 0:         tween has not started; returns `from`.
 *   - t >= duration:  tween has completed; returns `to`.
 */
export function easeOutCubic(
  t: number,
  from: number,
  to: number,
  duration: number,
): number {
  if (duration <= 0) return to;
  if (t <= 0) return from;
  if (t >= duration) return to;
  const progress = t / duration;
  const eased = 1 - Math.pow(1 - progress, 3);
  return from + (to - from) * eased;
}

/**
 * Clamp the AnimatedCounter `duration` prop to the spec-mandated range
 * [200ms, 800ms] (Requirement 10.4).
 */
export function clampDuration(duration: number): number {
  if (!Number.isFinite(duration)) return 600;
  return Math.max(200, Math.min(800, duration));
}
