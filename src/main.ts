import { mount } from "svelte";
import App from "./App.svelte";
import "./app.css";

/**
 * Global animation gating for Windows/WebView2 performance.
 *
 * The app's decorative backgrounds (AnimatedBackground, BackgroundPaths) run
 * infinite CSS animations — large `blur(80px)` orbs and dozens of pulsing SVG
 * strokes. On Windows WebView2 these keep the compositor repainting every
 * frame even while the window is minimized or parked in the system tray,
 * which users reported as the whole machine feeling laggy.
 *
 * WebView2 does not reliably throttle CSS animations for a hidden window the
 * way a backgrounded browser tab does, so we gate it explicitly: whenever the
 * document is not visible, we flag the root element and CSS pauses the heavy
 * animations (`animation-play-state: paused`). Nothing visual changes while
 * the user is actually looking at the window.
 */
function installVisibilityGating(): void {
  const root = document.documentElement;
  const apply = (hidden: boolean): void => {
    if (hidden) root.setAttribute("data-doc-hidden", "");
    else root.removeAttribute("data-doc-hidden");
  };

  // `visibilitychange` covers minimize / tray / occluded on Windows.
  document.addEventListener("visibilitychange", () => {
    apply(document.visibilityState === "hidden");
  });
  // `blur`/`focus` reinforce the case where the window is visible but not
  // focused (e.g. behind another window) — still no reason to burn GPU on a
  // decorative background the user isn't interacting with.
  window.addEventListener("blur", () => apply(true));
  window.addEventListener("focus", () => apply(false));

  // Seed the initial state in case the app launches hidden (autostart /
  // start-in-tray).
  apply(document.visibilityState === "hidden");
}

installVisibilityGating();

const app = mount(App, { target: document.getElementById("app")! });
export default app;
