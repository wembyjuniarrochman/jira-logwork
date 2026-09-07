<script lang="ts">
  /**
   * BackgroundPaths
   *
   * Svelte 5 port of the visual idea from kokonutd's "background-paths"
   * (21st.dev). The path geometry is the same — two stacked SVG layers,
   * 36 cubic curves each, mirrored across the X axis via a `position`
   * parameter — but the animation is implemented purely in CSS instead
   * of framer-motion.
   *
   * Each curve uses `pathLength="1"` so we can talk about strokes in a
   * normalized 0..1 length. We then run two concurrent animations:
   *   - `flow`  → `stroke-dashoffset` cycles, so the lit segment flows
   *               along the curve. This stands in for framer-motion's
   *               `pathOffset: [0, 1, 0]`.
   *   - `pulse` → opacity oscillates so curves brighten and dim, like
   *               the original `opacity: [0.3, 0.6, 0.3]`.
   *
   * Each path also gets its own random duration (20–30 s) and a negative
   * delay so the cycles never line up; this matches the
   * `duration: 20 + Math.random() * 10` from the source.
   */

  interface PathSpec {
    d: string;
    width: number;
    /** stroke-opacity multiplier — base, before the pulse animation. */
    opacity: number;
    /** Duration in seconds (20–30 s, like the source). */
    duration: number;
    /** Negative offset so cycles aren't in phase on first paint. */
    delay: number;
  }

  /**
   * Returns the same cubic path as the original component for index `i`
   * and `position ∈ {1, -1}`. Functional formula, kept verbatim so the
   * geometry is identical.
   */
  function pathD(i: number, position: 1 | -1): string {
    const x0 = -(380 - i * 5 * position);
    const y0 = -(189 + i * 6);
    // The first C control point coincides with the start, like the source.
    const c1x = x0;
    const c1y = y0;
    const c2x = -(312 - i * 5 * position);
    const c2y = 216 - i * 6;
    const e1x = 152 - i * 5 * position;
    const e1y = 343 - i * 6;
    // Second cubic continues from the previous endpoint.
    const c3x = 616 - i * 5 * position;
    const c3y = 470 - i * 6;
    const c4x = 684 - i * 5 * position;
    const c4y = 875 - i * 6;
    const e2x = c4x;
    const e2y = c4y;
    return `M${x0} ${y0}C${c1x} ${c1y} ${c2x} ${c2y} ${e1x} ${e1y}C${c3x} ${c3y} ${c4x} ${c4y} ${e2x} ${e2y}`;
  }

  function buildLayer(position: 1 | -1, baseDelay: number): PathSpec[] {
    return Array.from({ length: 36 }, (_, i) => ({
      d: pathD(i, position),
      width: 0.5 + i * 0.03,
      opacity: 0.1 + i * 0.03,
      // Source uses Math.random(); a deterministic but irregular
      // distribution gives the same "no two are in sync" feel without
      // re-randomizing on every render.
      duration: 20 + ((i * 7) % 10),
      delay: -(baseDelay + i * 0.45),
    }));
  }

  const layerOne = buildLayer(1, 0);
  const layerTwo = buildLayer(-1, 3.2);

  interface Props {
    /** When true, the entire background animates off-screen and fades out.
     *  Used by Login.svelte once the user submits credentials so the
     *  swarm clears the way for the success state. */
    exiting?: boolean;
  }

  let { exiting = false }: Props = $props();
</script>

<div class="bg-paths" class:exiting aria-hidden="true">
  <!-- Dark base. The source uses neutral-950 / white; we keep it
       coherent with the rest of this dark-themed app. -->
  <div class="bg-base"></div>

  <svg
    class="layer layer-one"
    viewBox="0 0 696 316"
    preserveAspectRatio="xMidYMid slice"
    xmlns="http://www.w3.org/2000/svg"
  >
    {#each layerOne as p, i (i)}
      <path
        class="path"
        d={p.d}
        pathLength="1"
        stroke-width={p.width}
        style="--base-opacity: {p.opacity}; --dur: {p.duration}s; --delay: {p.delay}s;"
      />
    {/each}
  </svg>

  <svg
    class="layer layer-two layer-mirror"
    viewBox="0 0 696 316"
    preserveAspectRatio="xMidYMid slice"
    xmlns="http://www.w3.org/2000/svg"
  >
    {#each layerTwo as p, i (i)}
      <path
        class="path"
        d={p.d}
        pathLength="1"
        stroke-width={p.width}
        style="--base-opacity: {p.opacity}; --dur: {p.duration}s; --delay: {p.delay}s;"
      />
    {/each}
  </svg>

  <!-- Soft vignette so the form sits comfortably over the swarm. -->
  <div class="vignette"></div>
</div>

<style>
  .bg-paths {
    position: fixed;
    inset: 0;
    z-index: 0;
    overflow: hidden;
    pointer-events: none;
  }

  .bg-base {
    position: absolute;
    inset: 0;
    background:
      radial-gradient(
        ellipse at 22% 12%,
        rgba(99, 102, 241, 0.18) 0%,
        rgba(99, 102, 241, 0) 55%
      ),
      radial-gradient(
        ellipse at 78% 88%,
        rgba(139, 92, 246, 0.16) 0%,
        rgba(139, 92, 246, 0) 55%
      ),
      linear-gradient(
        135deg,
        var(--app-bg) 0%,
        var(--app-bg-mid-1) 30%,
        var(--app-bg-mid-2) 60%,
        var(--app-bg) 100%
      );
  }

  .layer {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    fill: none;
    /* Source renders in `text-white` for dark mode; we follow that and
     * let `currentColor` carry the stroke. */
    color: rgb(var(--fg-rgb) / 0.95);
    transition:
      transform 1100ms cubic-bezier(0.65, 0, 0.35, 1),
      opacity 900ms ease-out;
  }

  /* Slight scale on the second layer so the two swarms read as
   * different depths even though the geometry is mirrored. */
  .layer-mirror {
    transform: scale(1.03);
  }

  /* Exit transition: each swarm slides off its own diagonal so the two
   * layers separate and clear the viewport, then fade out. The form
   * (success state) becomes fully visible underneath. The dark `.bg-base`
   * stays put so the page never flashes to the browser's default
   * (white) background while the curves are leaving. */
  .bg-paths.exiting .layer-one {
    transform: translate3d(-120%, -40%, 0) rotate(-6deg);
    opacity: 0;
  }

  .bg-paths.exiting .layer-two {
    /* Compose the existing scale(1.03) with the exit translation so the
     * mirror layer doesn't snap back to scale(1) at the start. */
    transform: scale(1.03) translate3d(120%, 40%, 0) rotate(6deg);
    opacity: 0;
  }

  .bg-paths.exiting .vignette {
    /* Soften the vignette a touch — full opacity competes with the
     * success state's centered icon. We do NOT zero this out, so the
     * dark base remains visually weighted toward the edges. */
    opacity: 0.4;
    transition: opacity 700ms ease-out 100ms;
  }

  .vignette {
    transition: opacity 700ms ease-out;
  }

  .path {
    stroke: currentColor;
    stroke-linecap: round;
    /* `pathLength="1"` lets us use 0..1 numbers here and they map to
     * the same fraction of the actual path. A long dash + slightly
     * shorter gap leaves a thin "trail" between repeated dashes. */
    stroke-dasharray: 0.45 0.55;
    /* Multiplied with the pulse animation to produce the soft fade. */
    stroke-opacity: var(--base-opacity);
    animation:
      bg-flow var(--dur) linear var(--delay) infinite,
      bg-pulse calc(var(--dur) * 0.5) ease-in-out var(--delay) infinite;
    will-change: stroke-dashoffset, stroke-opacity;
  }

  /* Stroke-dashoffset cycles 0 → -1 so the lit segment flows along the
   * curve. Linear easing matches the source's `ease: "linear"`. */
  @keyframes bg-flow {
    0%   { stroke-dashoffset: 0; }
    100% { stroke-dashoffset: -1; }
  }

  /* Opacity oscillation modeled after the source's
   * `opacity: [0.3, 0.6, 0.3]` keyframes. */
  @keyframes bg-pulse {
    0%, 100% { stroke-opacity: calc(var(--base-opacity) * 0.5); }
    50%      { stroke-opacity: calc(var(--base-opacity) * 1.6); }
  }

  .vignette {
    position: absolute;
    inset: 0;
    background: radial-gradient(
      ellipse at center,
      rgb(var(--shadow-rgb) / calc(0 * var(--shadow-strength))) 0%,
      rgb(var(--shadow-rgb) / calc(0.15 * var(--shadow-strength))) 55%,
      rgb(var(--shadow-rgb) / calc(0.55 * var(--shadow-strength))) 100%
    );
  }

  /* Reduced motion: freeze flow and reveal the curves as a static
   * composition with their resting opacity. */
  @media (prefers-reduced-motion: reduce) {
    .path {
      animation: none;
      stroke-dasharray: 1 0;
      stroke-dashoffset: 0;
      stroke-opacity: var(--base-opacity);
    }
  }
</style>
