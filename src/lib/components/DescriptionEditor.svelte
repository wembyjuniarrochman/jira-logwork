<script lang="ts">
  import { t } from "../stores/i18n.svelte";
  /**
   * DescriptionEditor
   *
   * A lightweight worklog-comment editor: a plain <textarea> (so the value
   * stays Jira REST v2 compatible plain text) plus a toolbar that inserts
   * Jira **wiki-markup** notation. Five controls, matching Jira's comment
   * editor: Text Style, Insert Element, Insert Link, Undo, Redo.
   *
   * Markup reference (Jira Server/DC text formatting notation):
   *   *bold*  _italic_  -strike-  +underline+  {{mono}}  h3. heading
   *   * bullet   # numbered   {code}…{code}   {quote}…{quote}
   *   [text|url]   ----
   *
   * Undo/Redo drive the textarea's native edit history via execCommand, which
   * the Tauri webview (WebKit) supports, so they cover both typed text and
   * toolbar insertions through a single history.
   */
  interface Props {
    /** Two-way bound markup text. */
    value: string;
    id?: string;
    maxlength?: number;
    placeholder?: string;
    ariaInvalid?: boolean;
  }

  let {
    value = $bindable(""),
    id,
    maxlength = 500,
    placeholder = "",
    ariaInvalid = false,
  }: Props = $props();

  let el = $state<HTMLTextAreaElement | null>(null);
  let rootEl = $state<HTMLDivElement | null>(null);
  let openMenu = $state<"style" | "element" | "link" | null>(null);

  // Insert-link sub-form fields.
  let linkText = $state("");
  let linkUrl = $state("");
  let urlInputEl = $state<HTMLInputElement | null>(null);

  function toggleMenu(menu: "style" | "element" | "link"): void {
    const next = openMenu === menu ? null : menu;
    openMenu = next;
    if (next === "link") {
      // Prefill the label with whatever the user had selected.
      const { start, end } = currentSelection();
      linkText = value.slice(start, end);
      linkUrl = "";
      // Focus the URL field on the next frame (after it mounts).
      queueMicrotask(() => urlInputEl?.focus());
    }
  }

  function closeMenu(): void {
    openMenu = null;
  }

  /** Read the textarea's selection. The offsets persist even when focus has
   *  moved to a toolbar button, so this is valid at click time. */
  function currentSelection(): { start: number; end: number } {
    if (!el) return { start: value.length, end: value.length };
    return {
      start: el.selectionStart ?? value.length,
      end: el.selectionEnd ?? value.length,
    };
  }

  /** Insert text over the current selection, preserving native undo. */
  function insertText(text: string): void {
    if (!el) return;
    el.focus();
    const ok = document.execCommand?.("insertText", false, text);
    if (!ok) {
      // Fallback for engines without execCommand insertText (still undoable
      // via the input event, just not merged into the native stack).
      const start = el.selectionStart ?? value.length;
      const end = el.selectionEnd ?? value.length;
      el.setRangeText(text, start, end, "end");
    }
    value = el.value;
  }

  /** Wrap the selection (or a placeholder) with before/after markers. */
  function wrap(before: string, after: string, placeholder = "teks"): void {
    if (!el) return;
    const { start, end } = currentSelection();
    const body = value.slice(start, end) || placeholder;
    el.focus();
    el.setSelectionRange(start, end);
    insertText(before + body + after);
    // Re-select the inner text so the user can type over the placeholder.
    const innerStart = start + before.length;
    el.setSelectionRange(innerStart, innerStart + body.length);
    closeMenu();
  }

  /** Prefix every line spanned by the selection (bulleted / numbered lists,
   *  headings). Expands the range to whole lines first. */
  function prefixLines(prefix: string): void {
    if (!el) return;
    const { start, end } = currentSelection();
    const lineStart = value.lastIndexOf("\n", start - 1) + 1;
    const block = value.slice(lineStart, end);
    const prefixed = block
      .split("\n")
      .map((line) => prefix + line)
      .join("\n");
    el.focus();
    el.setSelectionRange(lineStart, end);
    insertText(prefixed);
    closeMenu();
  }

  /** Wrap the selection (or placeholder) in a block construct. */
  function insertBlock(open: string, close: string, placeholder = ""): void {
    if (!el) return;
    const { start, end } = currentSelection();
    const body = value.slice(start, end) || placeholder;
    el.focus();
    el.setSelectionRange(start, end);
    insertText(open + body + close);
    closeMenu();
  }

  function insertLink(): void {
    const url = linkUrl.trim();
    if (!url) return;
    const label = linkText.trim();
    const markup = label ? `[${label}|${url}]` : `[${url}]`;
    if (el) {
      const { start, end } = currentSelection();
      el.focus();
      el.setSelectionRange(start, end);
    }
    insertText(markup);
    linkText = "";
    linkUrl = "";
    closeMenu();
  }

  function undo(): void {
    if (!el) return;
    el.focus();
    document.execCommand?.("undo");
    value = el.value;
  }

  function redo(): void {
    if (!el) return;
    el.focus();
    document.execCommand?.("redo");
    value = el.value;
  }

  // Close any open menu on outside click / Escape.
  $effect(() => {
    if (!openMenu) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node | null;
      if (rootEl && t && !rootEl.contains(t)) closeMenu();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeMenu();
    };
    window.addEventListener("mousedown", onDown, true);
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("mousedown", onDown, true);
      window.removeEventListener("keydown", onKey, true);
    };
  });
</script>

<div class="desc-editor" class:invalid={ariaInvalid} bind:this={rootEl}>
  <div class="desc-toolbar" role="toolbar" aria-label={t("editor.formatLabel")}>
    <!-- Text Style -->
    <div class="tb-group">
      <button
        type="button"
        class="tb-btn"
        class:active={openMenu === "style"}
        aria-haspopup="menu"
        aria-expanded={openMenu === "style"}
        title={t("editor.textStyle")}
        onclick={() => toggleMenu("style")}
      >
        <span class="tb-aa">Aa</span>
        <svg class="tb-caret" viewBox="0 0 24 24" aria-hidden="true">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      {#if openMenu === "style"}
        <div class="tb-menu" role="menu">
          <button type="button" role="menuitem" class="tb-item" onclick={() => wrap("*", "*", "tebal")}>
            <span class="tb-item-mark" style="font-weight:800;">B</span> {t("editor.bold")}
          </button>
          <button type="button" role="menuitem" class="tb-item" onclick={() => wrap("_", "_", "miring")}>
            <span class="tb-item-mark" style="font-style:italic;">I</span> {t("editor.italic")}
          </button>
          <button type="button" role="menuitem" class="tb-item" onclick={() => wrap("-", "-", "coret")}>
            <span class="tb-item-mark" style="text-decoration:line-through;">S</span> {t("editor.strike")}
          </button>
          <button type="button" role="menuitem" class="tb-item" onclick={() => wrap("+", "+", "garis bawah")}>
            <span class="tb-item-mark" style="text-decoration:underline;">U</span> {t("editor.underline")}
          </button>
          <button type="button" role="menuitem" class="tb-item" onclick={() => wrap("{{", "}}", "kode")}>
            <span class="tb-item-mark tb-mono">{"</>"}</span> {t("editor.mono")}
          </button>
          <div class="tb-divider" role="separator"></div>
          <button type="button" role="menuitem" class="tb-item" onclick={() => prefixLines("h3. ")}>
            <span class="tb-item-mark">H</span> {t("editor.heading")}
          </button>
        </div>
      {/if}
    </div>

    <!-- Insert Element -->
    <div class="tb-group">
      <button
        type="button"
        class="tb-btn tb-icon"
        class:active={openMenu === "element"}
        aria-haspopup="menu"
        aria-expanded={openMenu === "element"}
        title={t("editor.insertElement")}
        aria-label={t("editor.insertElement")}
        onclick={() => toggleMenu("element")}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <line x1="12" y1="5" x2="12" y2="19" />
          <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
      </button>
      {#if openMenu === "element"}
        <div class="tb-menu" role="menu">
          <button type="button" role="menuitem" class="tb-item" onclick={() => prefixLines("* ")}>
            <span class="tb-item-mark">•</span> {t("editor.bullets")}
          </button>
          <button type="button" role="menuitem" class="tb-item" onclick={() => prefixLines("# ")}>
            <span class="tb-item-mark">1.</span> {t("editor.numbers")}
          </button>
          <button type="button" role="menuitem" class="tb-item" onclick={() => insertBlock("{code}\n", "\n{code}", "kode")}>
            <span class="tb-item-mark tb-mono">{"{}"}</span> {t("editor.codeBlock")}
          </button>
          <button type="button" role="menuitem" class="tb-item" onclick={() => insertBlock("{quote}\n", "\n{quote}", "kutipan")}>
            <span class="tb-item-mark">❝</span> {t("editor.quote")}
          </button>
          <button type="button" role="menuitem" class="tb-item" onclick={() => insertText("\n----\n")}>
            <span class="tb-item-mark">―</span> {t("editor.divider")}
          </button>
        </div>
      {/if}
    </div>

    <!-- Insert Link -->
    <div class="tb-group">
      <button
        type="button"
        class="tb-btn tb-icon"
        class:active={openMenu === "link"}
        aria-haspopup="dialog"
        aria-expanded={openMenu === "link"}
        title={t("editor.insertLink")}
        aria-label={t("editor.insertLink")}
        onclick={() => toggleMenu("link")}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M10 13a5 5 0 0 0 7.07 0l2.83-2.83a5 5 0 0 0-7.07-7.07l-1.41 1.41" />
          <path d="M14 11a5 5 0 0 0-7.07 0L4.1 13.83a5 5 0 0 0 7.07 7.07l1.41-1.41" />
        </svg>
      </button>
      {#if openMenu === "link"}
        <div class="tb-menu tb-link-form" role="dialog" aria-label="{t("editor.insertLink")}">
          <label class="tb-link-field">
            <span>{t("editor.linkText")}</span>
            <input
              class="tb-link-input"
              type="text"
              bind:value={linkText}
              placeholder="{t("editor.linkLabel")}"
            />
          </label>
          <label class="tb-link-field">
            <span>{t("editor.url")}</span>
            <input
              class="tb-link-input"
              type="url"
              bind:value={linkUrl}
              bind:this={urlInputEl}
              placeholder="https://…"
              onkeydown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  insertLink();
                }
              }}
            />
          </label>
          <div class="tb-link-actions">
            <button type="button" class="tb-link-cancel" onclick={closeMenu}>{t("common.cancel")}</button>
            <button
              type="button"
              class="tb-link-insert"
              disabled={!linkUrl.trim()}
              onclick={insertLink}
            >
              {t("editor.insert")}
            </button>
          </div>
        </div>
      {/if}
    </div>

    <span class="tb-spacer"></span>

    <!-- Undo / Redo -->
    <button type="button" class="tb-btn tb-icon" title={t("editor.undo")} aria-label={t("editor.undo")} onclick={undo}>
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <polyline points="9 14 4 9 9 4" />
        <path d="M4 9h11a5 5 0 0 1 0 10h-1" />
      </svg>
    </button>
    <button type="button" class="tb-btn tb-icon" title={t("editor.redo")} aria-label={t("editor.redo")} onclick={redo}>
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <polyline points="15 14 20 9 15 4" />
        <path d="M20 9H9a5 5 0 0 0 0 10h1" />
      </svg>
    </button>
  </div>

  <textarea
    {id}
    class="desc-textarea"
    bind:this={el}
    bind:value
    {maxlength}
    {placeholder}
    rows="3"
    aria-invalid={ariaInvalid ? "true" : undefined}
  ></textarea>
</div>

<style>
  .desc-editor {
    display: flex;
    flex-direction: column;
    border-radius: 0.5rem;
    border: 1px solid rgb(var(--fg-rgb) / 0.12);
    background: rgb(var(--fg-rgb) / 0.06);
    transition: border-color 0.2s ease-out, box-shadow 0.15s ease-out, background 0.2s ease-out;
  }

  .desc-editor:focus-within {
    border-color: rgba(99, 102, 241, 0.6);
    box-shadow: var(--focus-ring);
    background: rgb(var(--fg-rgb) / 0.08);
  }

  .desc-editor.invalid {
    border-color: rgba(239, 68, 68, 0.6);
  }

  /* --- Toolbar --- */
  .desc-toolbar {
    display: flex;
    align-items: center;
    gap: 0.125rem;
    padding: 0.25rem 0.375rem;
    border-bottom: 1px solid rgb(var(--fg-rgb) / 0.08);
  }

  .tb-group {
    position: relative;
    display: inline-flex;
  }

  .tb-spacer {
    flex: 1;
  }

  .tb-btn {
    display: inline-flex;
    align-items: center;
    gap: 0.125rem;
    height: 1.75rem;
    padding: 0 0.375rem;
    border: none;
    border-radius: 0.375rem;
    background: transparent;
    color: rgb(var(--fg-rgb) / 0.8);
    cursor: pointer;
    transition: background 150ms ease-out, color 150ms ease-out;
    outline: none;
  }

  .tb-btn:hover,
  .tb-btn.active {
    background: rgb(var(--fg-rgb) / 0.1);
    color: var(--text-primary);
  }

  .tb-btn:focus-visible {
    box-shadow: var(--focus-ring);
  }

  .tb-btn.tb-icon {
    width: 1.75rem;
    justify-content: center;
    padding: 0;
  }

  .tb-btn svg {
    width: 1rem;
    height: 1rem;
    fill: none;
    stroke: currentColor;
    stroke-width: 2;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .tb-aa {
    font-size: 0.8125rem;
    font-weight: 600;
    line-height: 1;
  }

  .tb-caret {
    width: 0.75rem !important;
    height: 0.75rem !important;
    opacity: 0.7;
  }

  /* --- Dropdown menus --- */
  .tb-menu {
    position: absolute;
    top: calc(100% + 0.375rem);
    left: 0;
    z-index: 30;
    min-width: 11rem;
    padding: 0.25rem;
    display: flex;
    flex-direction: column;
    gap: 0.0625rem;
    border-radius: 0.5rem;
    border: 1px solid rgb(var(--fg-rgb) / 0.14);
    background: linear-gradient(
      180deg,
      rgb(var(--surface-rgb) / 0.97) 0%,
      rgb(var(--surface-rgb) / 0.95) 100%
    );
    backdrop-filter: blur(28px) saturate(1.2);
    -webkit-backdrop-filter: blur(28px) saturate(1.2);
    box-shadow: 0 20px 40px -12px rgb(var(--shadow-rgb) / calc(0.65 * var(--shadow-strength)));
  }

  .tb-item {
    display: flex;
    align-items: center;
    gap: 0.625rem;
    padding: 0.4375rem 0.5rem;
    border: none;
    border-radius: 0.375rem;
    background: transparent;
    color: rgb(var(--fg-rgb) / 0.88);
    font-size: 0.8125rem;
    text-align: left;
    cursor: pointer;
    transition: background 120ms ease-out;
    outline: none;
  }

  .tb-item:hover,
  .tb-item:focus-visible {
    background: rgba(99, 102, 241, 0.18);
  }

  .tb-item-mark {
    flex-shrink: 0;
    width: 1.25rem;
    text-align: center;
    font-size: 0.8125rem;
    color: var(--text-accent-strong);
  }

  .tb-mono {
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 0.6875rem;
  }

  .tb-divider {
    height: 1px;
    margin: 0.1875rem 0.25rem;
    background: rgb(var(--fg-rgb) / 0.08);
  }

  /* --- Insert-link form --- */
  .tb-link-form {
    min-width: 15rem;
    gap: 0.5rem;
    padding: 0.625rem;
  }

  .tb-link-field {
    display: flex;
    flex-direction: column;
    gap: 0.1875rem;
    font-size: 0.6875rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: rgb(var(--fg-rgb) / 0.5);
  }

  .tb-link-input {
    padding: 0.4375rem 0.5rem;
    border-radius: 0.375rem;
    border: 1px solid rgb(var(--fg-rgb) / 0.14);
    background: rgb(var(--fg-rgb) / 0.06);
    color: var(--text-primary);
    font-size: 0.8125rem;
    font-weight: 400;
    text-transform: none;
    letter-spacing: normal;
    outline: none;
  }

  .tb-link-input:focus-visible {
    border-color: rgba(99, 102, 241, 0.6);
    box-shadow: var(--focus-ring);
  }

  .tb-link-actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.5rem;
    margin-top: 0.125rem;
  }

  .tb-link-cancel,
  .tb-link-insert {
    padding: 0.375rem 0.75rem;
    border-radius: 0.375rem;
    font-size: 0.75rem;
    font-weight: 600;
    cursor: pointer;
    border: 1px solid transparent;
    outline: none;
  }

  .tb-link-cancel {
    background: rgb(var(--fg-rgb) / 0.06);
    border-color: rgb(var(--fg-rgb) / 0.12);
    color: rgb(var(--fg-rgb) / 0.85);
  }

  .tb-link-cancel:hover {
    background: rgb(var(--fg-rgb) / 0.1);
  }

  .tb-link-insert {
    background: rgba(99, 102, 241, 0.9);
    color: var(--text-on-accent);
  }

  .tb-link-insert:hover:not(:disabled) {
    background: rgba(99, 102, 241, 1);
  }

  .tb-link-insert:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }

  /* --- Textarea --- */
  .desc-textarea {
    width: 100%;
    box-sizing: border-box;
    padding: 0.625rem 0.75rem;
    border: none;
    background: transparent;
    color: var(--text-primary);
    font-size: 0.875rem;
    font-family: inherit;
    line-height: 1.45;
    resize: vertical;
    min-height: 4.5rem;
    outline: none;
  }

  .desc-textarea::placeholder {
    color: rgb(var(--fg-rgb) / 0.35);
  }

  @media (prefers-reduced-motion: reduce) {
    .desc-editor,
    .tb-btn,
    .tb-item {
      transition: none;
    }
  }
</style>
