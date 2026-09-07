<script lang="ts">
  /**
   * UserAvatarDropdown
   *
   * Avatar button in the workspace header that toggles a small menu with
   * exactly two entries: "Settings" and "Logout".
   *
   * Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.6, 3.7, 13.3, 13.4
   *
   * R13.4 invariant: the menu and its keyboard handlers are rendered together
   * in the same `{#if isOpen}` block, so the menu DOM cannot exist without
   * the handlers attached (Svelte hydrates inline `on*` props as part of the
   * same render pass).
   */

  import { t } from "../stores/i18n.svelte";
  import { tick } from "svelte";
  import { initialFor } from "../stores/quickLogReducer";

  interface Props {
    displayName: string;
    email: string;
    onOpenSettings: () => void;
    onLogout: () => void;
  }

  let { displayName, email, onOpenSettings, onLogout }: Props = $props();

  // --- State ---

  let isOpen = $state(false);
  let focusedIndex = $state<0 | 1>(0);

  // DOM references used for focus management and outside-click detection.
  let wrapperEl: HTMLDivElement | undefined = $state();
  let avatarButtonEl: HTMLButtonElement | undefined = $state();
  let menuItemEls: (HTMLButtonElement | undefined)[] = $state([
    undefined,
    undefined,
  ]);

  const ITEMS = ["Settings", "Logout"] as const;

  let initial = $derived(initialFor(displayName, email));

  // --- Open / close helpers ---

  async function openMenu(initialIndex: 0 | 1 = 0) {
    if (isOpen) return;
    focusedIndex = initialIndex;
    isOpen = true;
    // Wait for the menu to render, then move focus onto the focused item.
    await tick();
    menuItemEls[focusedIndex]?.focus();
  }

  function closeMenu(restoreFocus: boolean = true) {
    if (!isOpen) return;
    isOpen = false;
    if (restoreFocus) {
      avatarButtonEl?.focus();
    }
  }

  function toggleMenu() {
    if (isOpen) {
      closeMenu();
    } else {
      void openMenu(0);
    }
  }

  // --- Avatar button keyboard handling (R3.7, R13.3) ---

  function onAvatarKeyDown(event: KeyboardEvent) {
    if (event.key === "Enter" || event.key === " " || event.key === "Spacebar") {
      event.preventDefault();
      toggleMenu();
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      void openMenu(0);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      void openMenu(1);
    }
  }

  // --- Menu keyboard handling (R3.6, R13.3) ---

  async function focusItem(index: 0 | 1) {
    focusedIndex = index;
    await tick();
    menuItemEls[focusedIndex]?.focus();
  }

  function onMenuKeyDown(event: KeyboardEvent) {
    if (event.key === "Escape") {
      event.preventDefault();
      closeMenu();
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      void focusItem(focusedIndex === 0 ? 1 : 0);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      void focusItem(focusedIndex === 0 ? 1 : 0);
      return;
    }
    if (event.key === "Home") {
      event.preventDefault();
      void focusItem(0);
      return;
    }
    if (event.key === "End") {
      event.preventDefault();
      void focusItem(1);
      return;
    }
    if (event.key === "Tab") {
      // Tabbing out moves focus elsewhere; close to keep focus model clean.
      // We do not preventDefault so the browser proceeds with the tab.
      closeMenu(false);
    }
  }

  // --- Outside click / focus-out handling (R3.6) ---

  // R13.4: this $effect fires only after the menu has been opened (and thus
  // rendered with its inline handlers). It registers/removes the global
  // listeners that are not expressible as inline DOM event props.
  $effect(() => {
    if (!isOpen) return;

    function onWindowMouseDown(event: MouseEvent) {
      const target = event.target as Node | null;
      if (target && wrapperEl && !wrapperEl.contains(target)) {
        closeMenu(false);
      }
    }

    window.addEventListener("mousedown", onWindowMouseDown, true);
    return () => {
      window.removeEventListener("mousedown", onWindowMouseDown, true);
    };
  });

  function onWrapperFocusOut(event: FocusEvent) {
    if (!isOpen) return;
    const next = event.relatedTarget as Node | null;
    // If focus moves outside the wrapper, close the menu without stealing
    // focus back (the user is intentionally leaving).
    if (!next || !wrapperEl || !wrapperEl.contains(next)) {
      closeMenu(false);
    }
  }

  // --- Item activation ---

  function onItemClick(index: 0 | 1) {
    closeMenu(false);
    if (index === 0) {
      onOpenSettings();
    } else {
      onLogout();
    }
  }
</script>

<div
  class="avatar-wrapper"
  bind:this={wrapperEl}
  onfocusout={onWrapperFocusOut}
>
  <button
    type="button"
    class="avatar-button"
    aria-haspopup="menu"
    aria-expanded={isOpen}
    aria-label="Open user menu for {displayName || email}"
    bind:this={avatarButtonEl}
    onclick={toggleMenu}
    onkeydown={onAvatarKeyDown}
  >
    <span class="avatar-initial" aria-hidden="true">{initial}</span>
  </button>

  {#if isOpen}
    <!-- The menu and its handlers render together in the same pass,
         so the menu DOM cannot exist without keyboard navigation
         attached (R13.4). -->
    <div
      class="menu glass"
      role="menu"
      aria-orientation="vertical"
      aria-label={t("misc.userMenu")}
      tabindex="-1"
      onkeydown={onMenuKeyDown}
    >
      <div class="menu-header" aria-hidden="true">
        <p class="menu-name">{displayName || email}</p>
        {#if displayName && email && displayName !== email}
          <p class="menu-email">{email}</p>
        {/if}
      </div>

      <div class="menu-divider" aria-hidden="true"></div>

      <button
        type="button"
        class="menu-item"
        role="menuitem"
        tabindex={focusedIndex === 0 ? 0 : -1}
        bind:this={menuItemEls[0]}
        onclick={() => onItemClick(0)}
      >
        <svg
          class="menu-icon"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="3" />
          <path
            d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h.04a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h.04a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v.04a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"
          />
        </svg>
        <span>{ITEMS[0]}</span>
      </button>

      <button
        type="button"
        class="menu-item"
        role="menuitem"
        tabindex={focusedIndex === 1 ? 0 : -1}
        bind:this={menuItemEls[1]}
        onclick={() => onItemClick(1)}
      >
        <svg
          class="menu-icon"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
          <polyline points="16 17 21 12 16 7" />
          <line x1="21" y1="12" x2="9" y2="12" />
        </svg>
        <span>{ITEMS[1]}</span>
      </button>
    </div>
  {/if}
</div>

<style>
  .avatar-wrapper {
    position: relative;
    display: inline-flex;
  }

  .avatar-button {
    width: 2.5rem;
    height: 2.5rem;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: 9999px;
    border: 1px solid rgb(var(--fg-rgb) / 0.18);
    background: linear-gradient(135deg, var(--accent-from) 0%, var(--accent-to) 100%);
    color: var(--text-on-accent);
    cursor: pointer;
    padding: 0;
    box-shadow: 0 4px 14px rgba(99, 102, 241, 0.35);
    transition:
      transform 150ms ease-out,
      box-shadow 200ms ease-out,
      border-color 200ms ease-out;
  }

  .avatar-button:hover {
    transform: translateY(-1px);
    box-shadow: 0 6px 18px rgba(99, 102, 241, 0.45);
    border-color: rgb(var(--fg-rgb) / 0.28);
  }

  .avatar-button:active {
    transform: translateY(0);
  }

  /* Focus ring distinct from hover (R11.4). */
  .avatar-button:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring), 0 4px 14px rgba(99, 102, 241, 0.35);
    border-color: rgb(var(--fg-rgb) / 0.4);
  }

  .avatar-initial {
    font-size: 0.95rem;
    font-weight: 700;
    letter-spacing: 0.01em;
    line-height: 1;
    user-select: none;
  }

  .menu {
    position: absolute;
    top: calc(100% + 0.5rem);
    right: 0;
    min-width: 14rem;
    padding: 0.5rem;
    z-index: 30;
    display: flex;
    flex-direction: column;
    gap: 0.125rem;
    /* Override the .glass surface with a near-opaque dark panel. The
     * default glass background (5% white) lets content from the heatmap
     * and other panels bleed through and clash with the menu text. We
     * keep a slight translucency + heavier blur so the panel still feels
     * like part of the glass-morphism language, but text and chips
     * behind it are no longer legible through the dropdown. */
    background:
      linear-gradient(
        180deg,
        rgb(var(--surface-rgb) / 0.94) 0%,
        rgb(var(--surface-rgb) / 0.92) 100%
      );
    backdrop-filter: blur(28px) saturate(1.2);
    -webkit-backdrop-filter: blur(28px) saturate(1.2);
    border: 1px solid rgb(var(--fg-rgb) / 0.14);
    box-shadow:
      0 20px 40px -12px rgb(var(--shadow-rgb) / calc(0.65 * var(--shadow-strength))),
      0 0 0 1px rgb(var(--fg-rgb) / 0.04) inset;
  }

  .menu-header {
    padding: 0.5rem 0.75rem 0.5rem;
    display: flex;
    flex-direction: column;
    gap: 0.125rem;
    min-width: 0;
  }

  .menu-name {
    margin: 0;
    font-size: 0.875rem;
    font-weight: 600;
    color: var(--text-primary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .menu-email {
    margin: 0;
    font-size: 0.75rem;
    color: rgba(226, 232, 240, 0.65);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .menu-divider {
    height: 1px;
    margin: 0.375rem 0;
    background: rgb(var(--fg-rgb) / 0.10);
  }

  .menu-item {
    display: flex;
    align-items: center;
    gap: 0.625rem;
    width: 100%;
    padding: 0.5rem 0.75rem;
    border-radius: 0.5rem;
    border: 1px solid transparent;
    background: transparent;
    color: rgb(var(--fg-rgb) / 0.92);
    font: inherit;
    font-size: 0.875rem;
    text-align: left;
    cursor: pointer;
    transition:
      background-color 200ms ease-out,
      border-color 200ms ease-out,
      box-shadow 150ms ease-out;
    outline: none;
  }

  .menu-item:hover {
    background: rgb(var(--fg-rgb) / 0.07);
    border-color: rgb(var(--fg-rgb) / 0.15);
  }

  /* Focus ring distinct from hover (R11.4). */
  .menu-item:focus-visible {
    background: rgba(99, 102, 241, 0.18);
    border-color: rgba(99, 102, 241, 0.45);
    box-shadow: var(--focus-ring);
  }

  .menu-icon {
    width: 1rem;
    height: 1rem;
    flex-shrink: 0;
    color: rgb(var(--fg-rgb) / 0.7);
  }

  .menu-item:hover .menu-icon,
  .menu-item:focus-visible .menu-icon {
    color: var(--text-accent-strong);
  }
</style>
