<script lang="ts">
  // AnimatedBackground: Full-viewport animated background with gradient orbs
  // GPU-accelerated (transform/opacity only), respects prefers-reduced-motion
  // Pure CSS — no external assets
</script>

<div class="animated-bg" aria-hidden="true">
  <!-- Gradient orbs floating in the background -->
  <div class="orb orb-1"></div>
  <div class="orb orb-2"></div>
  <div class="orb orb-3"></div>
  <div class="orb orb-4"></div>
  <div class="orb orb-5"></div>

  <!-- SVG mesh pattern for added depth -->
  <svg class="mesh-pattern" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 800" preserveAspectRatio="xMidYMid slice">
    <defs>
      <radialGradient id="mesh-grad-1" cx="30%" cy="30%" r="50%">
        <stop offset="0%" stop-color="rgba(99, 102, 241, 0.08)" />
        <stop offset="100%" stop-color="transparent" />
      </radialGradient>
      <radialGradient id="mesh-grad-2" cx="70%" cy="70%" r="50%">
        <stop offset="0%" stop-color="rgba(139, 92, 246, 0.06)" />
        <stop offset="100%" stop-color="transparent" />
      </radialGradient>
    </defs>
    <rect width="800" height="800" fill="url(#mesh-grad-1)" />
    <rect width="800" height="800" fill="url(#mesh-grad-2)" />
  </svg>

  <!-- Dark overlay for contrast behind form content -->
  <div class="contrast-overlay"></div>
</div>

<style>
  .animated-bg {
    position: fixed;
    inset: 0;
    z-index: 0;
    overflow: hidden;
    background: var(--app-bg-gradient);
  }

  /* Gradient orbs — GPU-accelerated with transform and opacity only.
   *
   * The original blur radius was 80 px, which is extremely expensive on
   * WebView2/Windows — it forces a large-radius Gaussian convolution every
   * frame the compositor repaints. Because the orbs are already radial
   * gradients that fade to transparent at 70 %, most of the softness comes
   * from the gradient itself, not the CSS blur. Halving the radius to 40 px
   * is barely perceptible but roughly halves the per-frame blur work. */
  .orb {
    position: absolute;
    border-radius: 50%;
    filter: blur(40px);
    will-change: transform, opacity;
    animation-timing-function: ease-in-out;
    animation-iteration-count: infinite;
    animation-direction: alternate;
  }

  .orb-1 {
    width: 500px;
    height: 500px;
    top: -10%;
    left: -5%;
    background: radial-gradient(circle, rgba(99, 102, 241, 0.4) 0%, rgba(99, 102, 241, 0) 70%);
    animation: float-1 8s ease-in-out infinite alternate;
  }

  .orb-2 {
    width: 400px;
    height: 400px;
    top: 50%;
    right: -10%;
    background: radial-gradient(circle, rgba(139, 92, 246, 0.35) 0%, rgba(139, 92, 246, 0) 70%);
    animation: float-2 10s ease-in-out infinite alternate;
  }

  .orb-3 {
    width: 350px;
    height: 350px;
    bottom: -5%;
    left: 20%;
    background: radial-gradient(circle, rgba(59, 130, 246, 0.3) 0%, rgba(59, 130, 246, 0) 70%);
    animation: float-3 12s ease-in-out infinite alternate;
  }

  .orb-4 {
    width: 250px;
    height: 250px;
    top: 30%;
    left: 50%;
    background: radial-gradient(circle, rgba(168, 85, 247, 0.25) 0%, rgba(168, 85, 247, 0) 70%);
    animation: float-4 9s ease-in-out infinite alternate;
  }

  .orb-5 {
    width: 300px;
    height: 300px;
    top: 10%;
    right: 20%;
    background: radial-gradient(circle, rgba(79, 70, 229, 0.3) 0%, rgba(79, 70, 229, 0) 70%);
    animation: float-5 11s ease-in-out infinite alternate;
  }

  /* Keyframes use only transform and opacity for GPU acceleration */
  @keyframes float-1 {
    0% { transform: translate(0, 0) scale(1); opacity: 0.6; }
    100% { transform: translate(60px, 40px) scale(1.1); opacity: 0.8; }
  }

  @keyframes float-2 {
    0% { transform: translate(0, 0) scale(1); opacity: 0.5; }
    100% { transform: translate(-50px, -30px) scale(1.15); opacity: 0.7; }
  }

  @keyframes float-3 {
    0% { transform: translate(0, 0) scale(1); opacity: 0.5; }
    100% { transform: translate(40px, -50px) scale(1.05); opacity: 0.7; }
  }

  @keyframes float-4 {
    0% { transform: translate(0, 0) scale(1); opacity: 0.4; }
    100% { transform: translate(-30px, 30px) scale(1.2); opacity: 0.6; }
  }

  @keyframes float-5 {
    0% { transform: translate(0, 0) scale(1); opacity: 0.45; }
    100% { transform: translate(35px, -25px) scale(1.08); opacity: 0.65; }
  }

  /* SVG mesh pattern for subtle texture */
  .mesh-pattern {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    opacity: 0.5;
    animation: mesh-drift 20s ease-in-out infinite alternate;
  }

  @keyframes mesh-drift {
    0% { transform: scale(1) rotate(0deg); opacity: 0.4; }
    100% { transform: scale(1.05) rotate(2deg); opacity: 0.6; }
  }

  /* Dark overlay for sufficient contrast behind form content */
  .contrast-overlay {
    position: absolute;
    inset: 0;
    background: radial-gradient(
      ellipse at center,
      rgb(var(--shadow-rgb) / calc(0.4 * var(--shadow-strength))) 0%,
      rgb(var(--shadow-rgb) / calc(0.2 * var(--shadow-strength))) 50%,
      rgb(var(--shadow-rgb) / calc(0.5 * var(--shadow-strength))) 100%
    );
    /* No `backdrop-filter` here: the app's own CSS notes it does not paint on
     * the Windows WebView2 build, so on Windows it was pure compositor cost
     * for zero visual gain. The radial gradient alone provides the contrast. */
  }

  /* Reduced motion: disable all animations, show static background */
  @media (prefers-reduced-motion: reduce) {
    .orb {
      animation: none;
      opacity: 0.5;
    }

    .mesh-pattern {
      animation: none;
      opacity: 0.4;
    }

    .orb-1 { transform: translate(30px, 20px) scale(1.05); }
    .orb-2 { transform: translate(-25px, -15px) scale(1.07); }
    .orb-3 { transform: translate(20px, -25px) scale(1.02); }
    .orb-4 { transform: translate(-15px, 15px) scale(1.1); }
    .orb-5 { transform: translate(18px, -12px) scale(1.04); }
  }

  /* Visibility gating (Windows/WebView2 perf).
   *
   * `data-doc-hidden` is set on <html> by main.ts whenever the window is
   * minimized, in the tray, or unfocused. Pause the animations so the
   * compositor stops repainting the blurred orbs and drifting mesh while
   * nobody is looking. `paused` freezes in place — no layout change — so the
   * background resumes seamlessly when the window returns. The selector is
   * global because the attribute lives on the document root, outside this
   * component's scope. */
  :global(html[data-doc-hidden]) .orb,
  :global(html[data-doc-hidden]) .mesh-pattern {
    animation-play-state: paused;
  }

  /* Manual "reduce animations" preference (animationStore → data attribute on
   * <html>). Unlike the visibility gate, this fully disables the animations
   * (not just pause) so low-end machines pay zero per-frame cost even while
   * the window is focused. Mirrors the prefers-reduced-motion resting state so
   * the orbs still read as a static composition. */
  :global(html[data-reduce-animations]) .orb {
    animation: none;
    opacity: 0.5;
  }
  :global(html[data-reduce-animations]) .mesh-pattern {
    animation: none;
    opacity: 0.4;
  }
</style>
