<script lang="ts">
  /**
   * LanguageToggle
   *
   * Segmented EN / ID switch with flag icons and a sliding "thumb" that
   * animates between the two options. Drives the app-wide language store.
   *
   * Flags are inline SVG rather than emoji (🇬🇧 / 🇮🇩) on purpose: those are
   * regional-indicator pairs, and Windows' Segoe UI Emoji deliberately ships
   * no country-flag glyphs, so it falls back to rendering the raw letters —
   * the toggle read "GB EN | ID ID" on the Windows build.
   */
  import { lang, setLang } from "../stores/i18n.svelte";

  const current = $derived(lang());
</script>

<div class="lang-toggle" role="group" aria-label="Language / Bahasa">
  <span class="lang-thumb" class:id={current === "id"} aria-hidden="true"></span>
  <button
    type="button"
    class="lang-opt"
    class:active={current === "en"}
    aria-pressed={current === "en"}
    title="English"
    onclick={() => setLang("en")}
  >
    <svg class="flag" viewBox="0 0 60 30" aria-hidden="true">
      <clipPath id="lt-gb-clip"><rect width="60" height="30" rx="3" /></clipPath>
      <g clip-path="url(#lt-gb-clip)">
        <rect width="60" height="30" fill="#012169" />
        <path d="M0 0 60 30M60 0 0 30" stroke="#fff" stroke-width="6" />
        <path d="M0 0 60 30M60 0 0 30" stroke="#C8102E" stroke-width="4" />
        <path d="M30 0v30M0 15h60" stroke="#fff" stroke-width="10" />
        <path d="M30 0v30M0 15h60" stroke="#C8102E" stroke-width="6" />
      </g>
    </svg>
    <span class="code">EN</span>
  </button>
  <button
    type="button"
    class="lang-opt"
    class:active={current === "id"}
    aria-pressed={current === "id"}
    title="Bahasa Indonesia"
    onclick={() => setLang("id")}
  >
    <svg class="flag" viewBox="0 0 60 30" aria-hidden="true">
      <clipPath id="lt-id-clip"><rect width="60" height="30" rx="3" /></clipPath>
      <g clip-path="url(#lt-id-clip)">
        <rect width="60" height="15" fill="#CE1126" />
        <rect y="15" width="60" height="15" fill="#fff" />
      </g>
    </svg>
    <span class="code">ID</span>
  </button>
</div>

<style>
  .lang-toggle {
    position: relative;
    display: inline-flex;
    align-items: stretch;
    padding: 0.1875rem;
    border-radius: 999px;
    border: 1px solid rgba(255, 255, 255, 0.12);
    background: rgba(255, 255, 255, 0.05);
  }

  /* Sliding highlight behind the active option. */
  .lang-thumb {
    position: absolute;
    top: 0.1875rem;
    bottom: 0.1875rem;
    left: 0.1875rem;
    width: calc(50% - 0.1875rem);
    border-radius: 999px;
    background: linear-gradient(135deg, var(--accent-from) 0%, var(--accent-to) 100%);
    box-shadow: 0 2px 8px rgba(99, 102, 241, 0.45);
    transition: transform 280ms cubic-bezier(0.22, 1, 0.36, 1);
    z-index: 0;
  }

  .lang-thumb.id {
    transform: translateX(100%);
  }

  .lang-opt {
    position: relative;
    z-index: 1;
    flex: 1 0 auto;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.3125rem;
    min-width: 2.75rem;
    padding: 0.25rem 0.5rem;
    border: none;
    background: transparent;
    color: rgba(255, 255, 255, 0.6);
    font-size: 0.75rem;
    font-weight: 700;
    letter-spacing: 0.02em;
    cursor: pointer;
    border-radius: 999px;
    transition: color 200ms ease-out;
    outline: none;
  }

  .lang-opt.active {
    color: #ffffff;
  }

  .lang-opt:focus-visible {
    box-shadow: var(--focus-ring);
  }

  .flag {
    width: 1.125rem;
    height: 0.5625rem;
    flex-shrink: 0;
    display: block;
    border-radius: 2px;
    box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.18);
    transition: transform 280ms cubic-bezier(0.22, 1, 0.36, 1);
  }

  .lang-opt.active .flag {
    transform: scale(1.18);
  }

  @media (prefers-reduced-motion: reduce) {
    .lang-thumb,
    .flag {
      transition: none;
    }
  }
</style>
