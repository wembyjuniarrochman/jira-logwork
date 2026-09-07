<script lang="ts">
  /**
   * UniversalSearch
   *
   * The single search input that finds Jira issues by key or summary without
   * requiring a project to be selected first. Wraps the pure orchestrator
   * `searchAll` from `../stores/searchStore` and adds:
   *   - 300ms keystroke debounce via a cancellable `setTimeout` (R7.2).
   *   - A minimum query length of 2 before any network call fires.
   *   - A request-id check so that if a newer keystroke fires while a previous
   *     request is in flight, the stale response is discarded (the store also
   *     does this internally, but tracking it here keeps the UI state honest
   *     about which response it is rendering).
   *   - A skeleton placeholder while a request is in flight (R7.6, R11.6).
   *   - An inline error message that retains the user's query when the search
   *     rejects (R7.8).
   *   - Click-to-select that emits `onSelect` and clears the query (R7.7).
   *   - Clearing the query hides the results list (R7.9).
   *   - A `<label>` associated to the `<input>` via `for`/`id` (R13.7).
   *
   * Validates: Requirements 7.1, 7.2, 7.5, 7.6, 7.7, 7.8, 7.9, 11.6, 13.7
   */

  import { t } from "../stores/i18n.svelte";
  import {
    searchAll,
    fetchChildren,
    fetchProjectEpics,
    fetchParentsWithChildren,
    fetchCreateMeta,
    fetchAssignableUsers,
    createIssue,
    findSubtaskIssueTypeName,
    projectKeyFromIssueKey,
    type SearchResult,
    type ProjectCreateMeta,
    type AssignableUser,
  } from "../stores/searchStore";
  import { timerStore } from "../stores/timerStore";

  interface Props {
    baseUrl: string;
    email: string;
    apiToken: string;
    isCloud: boolean;
    onSelect: (issue: { key: string; summary: string; issueType?: string }) => void;
    /**
     * Optional project scope. When set, the search is restricted to issues
     * inside this project (no fan-out across all projects).
     */
    projectKey?: string;
    /**
     * When true and `projectKey` is set, an empty query auto-fires a search
     * (the project's most recently updated issues), so the user sees an
     * initial list without typing.
     */
    autoSearchOnEmpty?: boolean;
    /**
     * Issue yang ditawarkan saat kotak pencarian masih kosong — dipakai
     * QuickLogCard untuk menampilkan riwayat terakhir. Sebelumnya riwayat
     * berdiri sebagai daftar terpisah, sehingga memilih issue punya tiga
     * tempat berbeda; menaruhnya di sini menjadikan pencarian satu-satunya
     * pintu masuk.
     */
    suggestions?: SearchResult[];
    suggestionsLabel?: string;
    /** Ditampilkan saat `suggestions` kosong (mis. belum ada riwayat). */
    suggestionsEmpty?: string;
  }

  let {
    baseUrl,
    email,
    apiToken,
    isCloud,
    onSelect,
    projectKey,
    autoSearchOnEmpty = false,
    suggestions = [],
    suggestionsLabel = "",
    suggestionsEmpty = "",
  }: Props = $props();

  // ---------------------------------------------------------------------
  // Jira issue link helpers
  // ---------------------------------------------------------------------

  /** Build `https://<base>/browse/<KEY>` defensively against missing or
   *  trailing-slash-laden base URLs. Returns "" when we can't form a real
   *  link, so callers can skip rendering the anchor. */
  function issueUrl(issueKey: string): string {
    if (!issueKey) return "";
    const base = (baseUrl ?? "").trim().replace(/\/+$/, "");
    if (!base) return "";
    return `${base}/browse/${encodeURIComponent(issueKey)}`;
  }

  /** Open the issue page in the user's default browser via Tauri's
   *  `shell:default` capability (which restricts opens to http(s)/tel/
   *  mailto, so passing arbitrary base URLs is safe). Falls back to
   *  `window.open` outside the Tauri runtime so the link still works in
   *  browser preview / tests. The click event is stopped from bubbling
   *  so the row's `handleSelect` doesn't also fire. */
  async function openIssue(event: MouseEvent, issueKey: string): Promise<void> {
    event.stopPropagation();
    event.preventDefault();
    const url = issueUrl(issueKey);
    if (!url) return;
    try {
      const { open } = await import("@tauri-apps/plugin-shell");
      await open(url);
    } catch {
      try {
        window.open(url, "_blank", "noopener,noreferrer");
      } catch {
        /* swallow */
      }
    }
  }

  // ---------------------------------------------------------------------
  // Ikon tipe issue
  // ---------------------------------------------------------------------

  /**
   * Keluarga ikon untuk sebuah nama issue type.
   *
   * Jira mengizinkan tiap project menamai tipe issue-nya sendiri ("Task
   * Development / Configuration", "IT Ticket", …), jadi pencocokannya lewat
   * substring, bukan daftar nama persis — tipe yang tak dikenal jatuh ke
   * "task", sama seperti Jira yang memakai ikon task untuk tipe generik.
   *
   * Urutannya penting: "sub-task" juga mengandung "task", jadi ia harus
   * diperiksa lebih dulu.
   */
  type IconKind = "epic" | "story" | "task" | "bug" | "subtask";

  function iconKind(issueType: string): IconKind {
    const s = issueType.toLowerCase();
    if (s.includes("epic")) return "epic";
    if (s.includes("subtask") || s.includes("sub-task")) return "subtask";
    if (s.includes("story")) return "story";
    if (s.includes("bug")) return "bug";
    return "task";
  }

  // -- Internal state -------------------------------------------------------

  let query = $state("");
  let results = $state<SearchResult[]>([]);
  let inFlight = $state(false);
  let error = $state<string | null>(null);

  // -- Tree expansion state -------------------------------------------------
  // Cached children per parent key so collapsing+re-expanding doesn't refetch.
  // null = not loaded yet, [] = loaded empty.
  let childrenByKey = $state<Record<string, SearchResult[] | null>>({});
  let expandedKeys = $state<Record<string, boolean>>({});
  let loadingKeys = $state<Record<string, boolean>>({});
  let childErrorByKey = $state<Record<string, string | null>>({});

  /**
   * Set of Epic keys currently visible in `results` that actually have at
   * least one child. Populated upfront after each list load via
   * `fetchParentsWithChildren` so the chevron only renders for Epics that
   * really have children — avoids the "click chevron, find nothing" UX.
   *
   * For Task/Story/Bug rows we use `result.subtasksCount` from the row
   * itself (filled by the search response's `fields.subtasks.length`),
   * which is more direct.
   */
  let parentsWithChildren = $state<Set<string>>(new Set());

  /**
   * Tree mode aktif hanya saat:
   *   - tidak ada query yang sedang diketik (atau user belum mencapai
   *     `MIN_QUERY_LENGTH`), DAN
   *   - sebuah project dipilih (kita punya scope untuk auto-list).
   * Di luar kondisi itu, results dirender flat seperti perilaku lama —
   * hierarchy hanya membingungkan saat user sedang mencocokkan teks.
   */
  let isTreeMode = $derived(
    Boolean(projectKey) && query.length === 0 && autoSearchOnEmpty,
  );

  /**
   * Cell deserves a chevron only when it has children we can show:
   *   - Sub-task → never (no children at all)
   *   - Epic → only if `parentsWithChildren` (filled by the post-load
   *     `fetchParentsWithChildren` call) contains the key
   *   - Task / Story / Bug / dll. → only if `subtasksCount > 0`
   *
   * `subtasksCount` falls back to checking `parentsWithChildren` when it
   * isn't available (e.g. children loaded by `fetchChildren` itself
   * don't carry it on every Jira deployment), so a deeply-nested grandchild
   * row still gets a chevron when it has descendants.
   */
  function isExpandable(result: SearchResult): boolean {
    // Dinamai `type`, bukan `t`: `t` sudah dipakai fungsi terjemahan, dan
    // membayanginya di sini adalah jebakan bagi perubahan berikutnya.
    const type = (result.issueType ?? "").toLowerCase();
    if (type === "sub-task" || type === "subtask") return false;
    if (type === "epic") return parentsWithChildren.has(result.key);
    if (typeof result.subtasksCount === "number") {
      return result.subtasksCount > 0;
    }
    return parentsWithChildren.has(result.key);
  }

  async function toggleExpand(parent: SearchResult): Promise<void> {
    const k = parent.key;
    if (expandedKeys[k]) {
      // Collapse — keep cache, just hide.
      expandedKeys = { ...expandedKeys, [k]: false };
      return;
    }
    expandedKeys = { ...expandedKeys, [k]: true };
    if (childrenByKey[k] !== undefined && childrenByKey[k] !== null) {
      // Already cached.
      return;
    }
    loadingKeys = { ...loadingKeys, [k]: true };
    childErrorByKey = { ...childErrorByKey, [k]: null };
    try {
      const kids = await fetchChildren(
        { baseUrl, email, apiToken, isCloud },
        k,
      );
      childrenByKey = { ...childrenByKey, [k]: kids };
    } catch (err) {
      const message =
        err instanceof Error && err.message ? err.message : "Failed to load children.";
      childErrorByKey = { ...childErrorByKey, [k]: message };
      childrenByKey = { ...childrenByKey, [k]: [] };
    } finally {
      loadingKeys = { ...loadingKeys, [k]: false };
    }
  }

  // -- Inline "Add Task / Add Sub-task" state ------------------------------
  // Only one form is open at a time, keyed by the parent issue key. The form
  // appears in-place below the parent row and fetches `createMeta` +
  // `assignableUsers` lazily on first open per project (results are cached
  // inside the store so opening on another row of the same project is free).
  let createOpenFor = $state<string | null>(null);
  let createMeta = $state<ProjectCreateMeta | null>(null);
  let assignableUsers = $state<AssignableUser[]>([]);
  let createMetaLoading = $state(false);
  let createMetaError = $state<string | null>(null);
  let createSubmitting = $state(false);
  let createSubmitError = $state<string | null>(null);
  // Form fields — bound to the inputs.
  let formSummary = $state("");
  let formIssueTypeName = $state("");
  let formAssigneeId = $state("");
  let formWorkReferenceId = $state("");

  /** Pure: which issuetype options are valid for a given parent. Epic
   *  accepts non-subtask types (excluding "Epic" itself, to prevent nested
   *  Epics). Task/Story/Bug accepts only subtask types. */
  function eligibleIssueTypes(parent: SearchResult, meta: ProjectCreateMeta) {
    const parentType = (parent.issueType ?? "").toLowerCase();
    if (parentType === "epic") {
      return meta.issueTypes.filter(
        (t) => !t.subtask && t.name.toLowerCase() !== "epic",
      );
    }
    return meta.issueTypes.filter((t) => t.subtask);
  }

  /** Pure: prefer "Task" for an Epic parent, the auto-detected subtask name
   *  for a Task parent. Falls back to the first eligible type. */
  function defaultIssueTypeName(parent: SearchResult, meta: ProjectCreateMeta): string {
    const options = eligibleIssueTypes(parent, meta);
    const parentType = (parent.issueType ?? "").toLowerCase();
    if (parentType === "epic") {
      const task = options.find((t) => t.name.toLowerCase() === "task");
      if (task) return task.name;
    } else {
      const sub = findSubtaskIssueTypeName(meta);
      if (sub && options.some((t) => t.name === sub)) return sub;
    }
    return options[0]?.name ?? "";
  }

  /** True iff a "+" button should appear on this row. Sub-task rows can't
   *  have children, so we hide the action there. */
  function canCreateChildIn(result: SearchResult): boolean {
    const t = (result.issueType ?? "").toLowerCase();
    return t !== "sub-task" && t !== "subtask";
  }

  async function openCreateForm(parent: SearchResult): Promise<void> {
    if (createOpenFor === parent.key) {
      closeCreateForm();
      return;
    }
    createOpenFor = parent.key;
    createMeta = null;
    assignableUsers = [];
    createMetaError = null;
    createSubmitError = null;
    formSummary = "";
    formIssueTypeName = "";
    formAssigneeId = "";
    formWorkReferenceId = "";
    createMetaLoading = true;
    const project = projectKeyFromIssueKey(parent.key);
    const ctx = { baseUrl, email, apiToken, isCloud };
    try {
      const [meta, users] = await Promise.all([
        fetchCreateMeta(ctx, project),
        fetchAssignableUsers(ctx, project).catch(() => [] as AssignableUser[]),
      ]);
      if (createOpenFor !== parent.key) return; // raced — user opened another row
      createMeta = meta;
      assignableUsers = users;
      formIssueTypeName = defaultIssueTypeName(parent, meta);
    } catch (err) {
      if (createOpenFor !== parent.key) return;
      const message =
        err instanceof Error && err.message ? err.message : "Failed to load create form.";
      createMetaError = message;
    } finally {
      if (createOpenFor === parent.key) createMetaLoading = false;
    }
  }

  function closeCreateForm(): void {
    createOpenFor = null;
    createMeta = null;
    assignableUsers = [];
    createMetaLoading = false;
    createMetaError = null;
    createSubmitError = null;
    createSubmitting = false;
  }

  /**
   * Re-fetch a parent's children, keeping any locally-created rows the
   * server has not indexed yet.
   *
   * Jira's JQL search is backed by an asynchronously-updated index, so an
   * issue created a moment ago is routinely absent from `parent = X`
   * results for a second or more. A plain replace would therefore drop the
   * row the user just created — and because the (stale) list then sits in
   * `childrenByKey`, collapsing and re-expanding would not bring it back
   * either.
   */
  async function reconcileChildren(
    parentKey: string,
    pinned: SearchResult[],
  ): Promise<void> {
    try {
      const kids = await fetchChildren(
        { baseUrl, email, apiToken, isCloud },
        parentKey,
      );
      const seen = new Set(kids.map((k) => k.key));
      const missing = pinned.filter((p) => !seen.has(p.key));
      childrenByKey = { ...childrenByKey, [parentKey]: [...kids, ...missing] };
    } catch {
      // Keep whatever is on screen — the optimistic row is more useful than
      // an error here, and the next expand will retry.
    } finally {
      loadingKeys = { ...loadingKeys, [parentKey]: false };
    }
  }

  async function submitCreate(parent: SearchResult): Promise<void> {
    const summary = formSummary.trim();
    if (!summary || !formIssueTypeName) {
      createSubmitError = "Summary dan task type wajib diisi.";
      return;
    }
    createSubmitting = true;
    createSubmitError = null;
    const project = projectKeyFromIssueKey(parent.key);
    const customFields: Record<string, unknown> = {};
    if (createMeta?.workReference && formWorkReferenceId) {
      customFields[createMeta.workReference.key] = { id: formWorkReferenceId };
    }
    try {
      const newKey = await createIssue(
        { baseUrl, email, apiToken, isCloud },
        {
          projectKey: project,
          issueTypeName: formIssueTypeName,
          summary,
          parentKey: parent.key,
          assigneeAccountId: formAssigneeId || undefined,
          customFields: Object.keys(customFields).length ? customFields : undefined,
        },
      );

      // Make sure parent has a chevron now (it definitely has at least one
      // child going forward).
      if (!parentsWithChildren.has(parent.key)) {
        const next = new Set(parentsWithChildren);
        next.add(parent.key);
        parentsWithChildren = next;
      }

      // Show the new issue straight away instead of waiting on Jira's search
      // index (see `reconcileChildren`). Falls back to a plain refetch when
      // the create response carried no key.
      const cached = childrenByKey[parent.key];
      const optimistic: SearchResult | null = newKey
        ? { key: newKey, summary, issueType: formIssueTypeName, subtasksCount: 0 }
        : null;
      childrenByKey = {
        ...childrenByKey,
        [parent.key]: optimistic ? [...(cached ?? []), optimistic] : null,
      };
      expandedKeys = { ...expandedKeys, [parent.key]: true };
      closeCreateForm();

      // Spinner only when there is nothing on screen to show meanwhile.
      if (!optimistic || !cached || cached.length === 0) {
        loadingKeys = { ...loadingKeys, [parent.key]: true };
      }
      void reconcileChildren(parent.key, optimistic ? [optimistic] : []);
    } catch (err) {
      const message =
        err instanceof Error && err.message ? err.message : "Failed to create issue.";
      createSubmitError = message;
    } finally {
      createSubmitting = false;
    }
  }

  /**
   * Monotonically-incrementing id assigned to each `runSearch` invocation.
   * Resolved promises whose id is older than the latest are ignored, so a
   * fast typist never sees stale results overwrite fresher ones.
   */
  let latestRequestId = 0;

  // Cancellable debounce timer id; `null` when no debounce is pending.
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  const DEBOUNCE_MS = 300;
  /** Satu karakter sudah cukup: JQL memakai pencocokan per-awalan-kata,
   *  jadi "p" mengembalikan hasil yang berarti. Debounce 300ms tetap
   *  menahan laju request saat mengetik cepat. */
  const MIN_QUERY_LENGTH = 1;

  // Number of skeleton rows shown while a search is in flight (3–4 per
  // implementation notes).
  const SKELETON_ROW_COUNT = 4;

  // -- Derived --------------------------------------------------------------

  // Whether the results list (or its skeleton/empty state) should be shown.
  // Per R7.9, clearing the query hides the list — kecuali kita berada di
  // tree mode (project dipilih + auto-list aktif), karena di mode itu
  // daftar Epic sengaja diisi tanpa query, jadi region perlu tetap
  // terlihat agar user bisa drill-down via chevron.
  const shouldShowResults = $derived(
    query.length > 0 || (isTreeMode && (inFlight || results.length > 0 || error !== null)),
  );

  // -- Search orchestration -------------------------------------------------

  function clearDebounce(): void {
    if (debounceTimer !== null) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
  }

  /**
   * After a list of root-level results is loaded, kick off a single
   * `fetchParentsWithChildren` call for every Epic in the list. Results
   * that aren't Epics rely on `subtasksCount` directly, so they don't
   * need a roundtrip. Failures are silent — the worst case is a chevron
   * that should be there isn't (the user can still type a key into the
   * input to find children).
   */
  async function refreshParentsWithChildren(rows: SearchResult[]): Promise<void> {
    const epicKeys = rows
      .filter((r) => (r.issueType ?? "").toLowerCase() === "epic")
      .map((r) => r.key);
    if (epicKeys.length === 0) {
      parentsWithChildren = new Set();
      return;
    }
    try {
      const found = await fetchParentsWithChildren(
        { baseUrl, email, apiToken, isCloud },
        epicKeys,
      );
      parentsWithChildren = found;
    } catch {
      // Best-effort: leave whatever was last computed; an empty Set just
      // means no Epic gets a chevron until the next list refresh.
      parentsWithChildren = new Set();
    }
  }

  async function runSearch(q: string): Promise<void> {
    const myId = ++latestRequestId;
    inFlight = true;
    error = null;

    try {
      const found = await searchAll(
        { baseUrl, email, apiToken, isCloud },
        q,
        { projectKey },
      );
      // Drop stale responses if the user has typed again in the meantime.
      if (myId !== latestRequestId) return;
      results = found;
      void refreshParentsWithChildren(found);
    } catch (err) {
      if (myId !== latestRequestId) return;
      // Retain the user's query (R7.8) and surface an inline error.
      const message =
        err instanceof Error && err.message ? err.message : "Search failed.";
      error = message;
      results = [];
    } finally {
      if (myId === latestRequestId) {
        inFlight = false;
      }
    }
  }

  /**
   * Hydrate the search list with the project's Epics only. Called when a
   * project is selected and the input is empty (tree mode), so the user
   * sees Epics first and can drill into Tasks/Stories → Sub-tasks via
   * the chevron without ever typing a query. Falls back gracefully when
   * the project has no Epics: the empty state will hint that the user
   * can type to find other issue types.
   */
  async function runEpicsList(pk: string): Promise<void> {
    const myId = ++latestRequestId;
    inFlight = true;
    error = null;

    try {
      const epics = await fetchProjectEpics(
        { baseUrl, email, apiToken, isCloud },
        pk,
      );
      if (myId !== latestRequestId) return;
      results = epics;
      void refreshParentsWithChildren(epics);
    } catch (err) {
      if (myId !== latestRequestId) return;
      const message =
        err instanceof Error && err.message ? err.message : "Failed to load Epics.";
      error = message;
      results = [];
    } finally {
      if (myId === latestRequestId) {
        inFlight = false;
      }
    }
  }

  function scheduleSearch(q: string): void {
    clearDebounce();
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      void runSearch(q);
    }, DEBOUNCE_MS);
  }

  function handleInput(event: Event): void {
    const next = (event.currentTarget as HTMLInputElement).value;
    query = next;

    // Any keystroke cancels the pending debounce.
    clearDebounce();

    if (next.length === 0) {
      // Clearing the query hides the list (R7.9) and forgets prior state.
      // Bumping `latestRequestId` ensures any in-flight resolution is dropped.
      latestRequestId++;
      results = [];
      error = null;
      inFlight = false;
      return;
    }

    if (next.length < MIN_QUERY_LENGTH) {
      // Not enough characters yet; clear stale results but keep query.
      results = [];
      error = null;
      return;
    }

    scheduleSearch(next);
  }

  function handleSelect(result: SearchResult): void {
    onSelect({ key: result.key, summary: result.summary, issueType: result.issueType });
    query = "";
  }

  function startTimer(e: MouseEvent, result: SearchResult): void {
    e.stopPropagation();
    timerStore.start(result.key, result.summary);
    // Clear search after starting timer
    query = "";
  }

  /** Keyboard activation for the `role="button"` result row. The row is a
   *  <div> (not a <button>) because it contains interactive children (the
   *  issue link + start-timer button), which a <button> may not legally
   *  nest. The `target === currentTarget` guard ensures Enter/Space pressed
   *  while focus is on an inner control doesn't also trigger row select. */
  function rowKeydown(e: KeyboardEvent, result: SearchResult): void {
    if (e.target !== e.currentTarget) return;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      handleSelect(result);
    }
  }

  function clearSearch(): void {
    // Clearing the query both resets state and hides the list (R7.7, R7.9).
    clearDebounce();
    latestRequestId++;
    query = "";
    results = [];
    error = null;
    inFlight = false;
  }

  // Cancel any outstanding timer when the component unmounts.
  $effect(() => {
    return () => {
      clearDebounce();
    };
  });

  // When `projectKey` changes (or first mounts with one), and `autoSearchOnEmpty`
  // is enabled, hydrate the list with the project's Epics so the user sees a
  // tree-friendly starting point. We also clear stale results when the project
  // changes so the list never shows entries from a previous scope. Tree-state
  // caches are also flushed because parent/child relationships are scoped to
  // a project.
  $effect(() => {
    // Track the prop so the effect re-runs whenever it changes.
    const pk = projectKey;
    const auto = autoSearchOnEmpty;
    clearDebounce();
    latestRequestId++;
    results = [];
    error = null;
    inFlight = false;
    childrenByKey = {};
    expandedKeys = {};
    loadingKeys = {};
    childErrorByKey = {};
    parentsWithChildren = new Set();
    closeCreateForm();
    if (auto && pk && query.length === 0) {
      // Tree mode: list Epics only — Tasks/Sub-tasks load on demand.
      void runEpicsList(pk);
    } else if (query.length >= MIN_QUERY_LENGTH) {
      // Re-run any active query against the new scope.
      void runSearch(query);
    }
  });
</script>

<div class="universal-search">
  <label for="universal-search-input" class="search-label">
    {t("search.title")}
  </label>

  <div class="input-wrapper">
    <svg
      class="search-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <circle cx="11" cy="11" r="7" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
    <input
      id="universal-search-input"
      type="text"
      class="search-input"
      placeholder={t("search.placeholder")}
      autocomplete="off"
      spellcheck="false"
      value={query}
      oninput={handleInput}
      aria-controls="universal-search-results"
      aria-describedby={error ? "universal-search-error" : undefined}
    />
  </div>

  <!--
    Ikon tipe issue mengikuti set ikon Jira yang sekarang: glyph outline
    berwarna tanpa kotak latar. Nama tipenya tetap terbaca lewat `title`
    dan `aria-label` — persis pola Jira sendiri, yang juga hanya
    menampilkan ikon.

    Semua glyph digambar `fill="none"` dengan `stroke="currentColor"`,
    sehingga warnanya cukup diatur sekali lewat `color` di CSS per tipe.
  -->
  {#snippet typeIcon(issueType: string)}
    {@const kind = iconKind(issueType)}
    <span
      class="type-icon"
      data-kind={kind}
      title={issueType}
      role="img"
      aria-label={issueType}
    >
      {#if kind === "epic"}
        <!-- Petir -->
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path
            d="M9.6 2.1 4.5 8.9a.4.4 0 0 0 .32.64h2.53l-.85 4.02a.4.4 0 0 0 .72.31l5.28-6.79a.4.4 0 0 0-.32-.64H9.49l.83-4.02a.4.4 0 0 0-.72-.31Z"
          />
        </svg>
      {:else if kind === "story"}
        <!-- Pembatas buku -->
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path
            d="M4.9 2.9h6.2c.5 0 .9.4.9.9v9.03a.4.4 0 0 1-.64.32L8 10.5l-3.36 2.64a.4.4 0 0 1-.64-.32V3.8c0-.5.4-.9.9-.9Z"
          />
        </svg>
      {:else if kind === "bug"}
        <!-- Kumbang -->
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <rect x="4.9" y="5.4" width="6.2" height="7.7" rx="3.1" />
          <path d="M6.1 3.8 7.2 5.3M9.9 3.8 8.8 5.3" />
          <path d="M4.9 7.6H2.9M4.9 10.9H2.9M11.1 7.6h2M11.1 10.9h2" />
        </svg>
      {:else if kind === "subtask"}
        <!-- Dua kotak bertumpuk -->
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <rect x="2.4" y="2.4" width="7.3" height="7.3" rx="1.9" />
          <rect x="6.3" y="6.3" width="7.3" height="7.3" rx="1.9" />
        </svg>
      {:else}
        <!-- Kotak bercentang -->
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <rect x="2.5" y="2.5" width="11" height="11" rx="2.6" />
          <path d="m5.6 8.2 1.9 1.9 3.5-4" />
        </svg>
      {/if}
    </span>
  {/snippet}
  {#if error}
    <p
      id="universal-search-error"
      class="error-message"
      role="alert"
    >
      {error}
    </p>
  {/if}

  {#if shouldShowResults}
    <div
      id="universal-search-results"
      class="results-region"
      role="region"
      aria-label={t("search.results")}
      aria-busy={inFlight}
    >
      {#if inFlight}
        <ul class="skeleton-list" aria-hidden="true">
          {#each Array(SKELETON_ROW_COUNT) as _, i (i)}
            <li class="skeleton-row">
              <span class="skeleton-key"></span>
              <span class="skeleton-summary"></span>
            </li>
          {/each}
        </ul>
      {:else if results.length > 0}
        {#snippet createFormBlock(parent: SearchResult, depth: number)}
          {@const isOpen = createOpenFor === parent.key}
          {#if isOpen}
            <form
              class="create-form"
              style="--depth: {depth};"
              onsubmit={(e) => {
                e.preventDefault();
                void submitCreate(parent);
              }}
            >
              {#if createMetaLoading}
                <p class="create-form-loading">{t("search.formLoading")}</p>
              {:else if createMetaError}
                <p class="create-form-error" role="alert">{createMetaError}</p>
                <div class="create-form-actions">
                  <button type="button" class="create-btn-secondary" onclick={closeCreateForm}>
                    {t("common.close")}
                  </button>
                </div>
              {:else if createMeta}
                {@const types = eligibleIssueTypes(parent, createMeta)}
                <label class="create-field">
                  <span class="create-label">{t("search.summary")}</span>
                  <input
                    type="text"
                    class="create-input"
                    bind:value={formSummary}
                    placeholder={t("search.whatToDo")}
                    required
                    autofocus
                    disabled={createSubmitting}
                  />
                </label>
                <div class="create-field-row">
                  <label class="create-field">
                    <span class="create-label">{t("search.taskType")}</span>
                    <select
                      class="create-input"
                      bind:value={formIssueTypeName}
                      disabled={createSubmitting || types.length === 0}
                    >
                      {#each types as t (t.name)}
                        <option value={t.name}>{t.name}</option>
                      {/each}
                    </select>
                  </label>
                  <label class="create-field">
                    <span class="create-label">{t("search.assignee")}</span>
                    <select
                      class="create-input"
                      bind:value={formAssigneeId}
                      disabled={createSubmitting}
                    >
                      <option value="">— Tidak di-assign —</option>
                      {#each assignableUsers as u (u.accountId)}
                        <option value={u.accountId}>{u.displayName}</option>
                      {/each}
                    </select>
                  </label>
                </div>
                {#if createMeta.workReference}
                  <label class="create-field">
                    <span class="create-label">{createMeta.workReference.name}</span>
                    <select
                      class="create-input"
                      bind:value={formWorkReferenceId}
                      disabled={createSubmitting}
                    >
                      <option value="">— Tidak dipilih —</option>
                      {#each createMeta.workReference.allowedValues as opt (opt.id)}
                        <option value={opt.id}>{opt.label}</option>
                      {/each}
                    </select>
                  </label>
                {/if}
                {#if createSubmitError}
                  <p class="create-form-error" role="alert">{createSubmitError}</p>
                {/if}
                <div class="create-form-actions">
                  <button
                    type="button"
                    class="create-btn-secondary"
                    onclick={closeCreateForm}
                    disabled={createSubmitting}
                  >
                    {t("common.cancel")}
                  </button>
                  <button
                    type="submit"
                    class="create-btn-primary"
                    disabled={createSubmitting || !formSummary.trim() || !formIssueTypeName}
                  >
                    {createSubmitting ? "Membuat…" : "Buat"}
                  </button>
                </div>
              {/if}
            </form>
          {/if}
        {/snippet}
        <!--
          Satu definisi baris untuk semua kedalaman. Sebelumnya markup ini
          ditulis dua kali — sekali untuk epic di level atas, sekali untuk
          turunannya di dalam `renderQueue` — sehingga setiap perubahan harus
          diterapkan dua kali dan diam-diam bisa menyimpang.
        -->
        {#snippet resultRow(node: SearchResult, depth: number, isLast: boolean)}
          {@const rowExpandable = isExpandable(node)}
          {@const rowExpanded = !!expandedKeys[node.key]}
          {@const rowLoading = !!loadingKeys[node.key]}
          <div
            class="result-row-wrap"
            class:is-child={depth > 0}
            class:is-last={isLast}
            class:is-open={rowExpandable && rowExpanded}
            style="--depth: {depth};"
          >
            {#if rowExpandable}
              <button
                type="button"
                class="chevron-btn"
                class:expanded={rowExpanded}
                aria-expanded={rowExpanded}
                aria-label={rowExpanded ? `Tutup ${node.key}` : `Buka ${node.key}`}
                onclick={() => toggleExpand(node)}
              >
                {#if rowLoading}
                  <span class="chevron-spinner" aria-hidden="true"></span>
                {:else}
                  <svg
                    class="chevron-icon"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2.5"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    aria-hidden="true"
                  >
                    <polyline points="9 6 15 12 9 18" />
                  </svg>
                {/if}
              </button>
            {:else}
              <span class="chevron-spacer" aria-hidden="true"></span>
            {/if}
            <div
              class="result-row"
              role="button"
              tabindex="0"
              onclick={() => handleSelect(node)}
              onkeydown={(e) => rowKeydown(e, node)}
            >
              {#if issueUrl(node.key)}
                <a
                  class="result-key result-key-link"
                  href={issueUrl(node.key)}
                  onclick={(e) => openIssue(e, node.key)}
                  title={`Buka ${node.key} di Jira`}
                >
                  {node.key}
                </a>
              {:else}
                <span class="result-key">{node.key}</span>
              {/if}
              {#if node.issueType}
                {@render typeIcon(node.issueType)}
              {/if}
              <span class="result-summary" title={node.summary}>
                {node.summary}
              </span>
              <span class="row-actions">
                <button
                  type="button"
                  class="start-timer-btn"
                  title={t("search.startTimer")}
                  onclick={(e) => startTimer(e, node)}
                >
                  <svg viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                </button>
                {#if canCreateChildIn(node)}
                  <button
                    type="button"
                    class="add-child-btn"
                    class:active={createOpenFor === node.key}
                    aria-label={`Tambah child di ${node.key}`}
                    title={node.issueType?.toLowerCase() === "epic"
                      ? "Tambah Task"
                      : "Tambah Sub-task"}
                    onclick={(e) => {
                      // Tombol ini kini berada di dalam baris yang juga
                      // `role="button"`; tanpa ini satu klik akan membuka form
                      // sekaligus memilih issue-nya.
                      e.stopPropagation();
                      void openCreateForm(node);
                    }}
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true">
                      <line x1="12" y1="5" x2="12" y2="19" />
                      <line x1="5" y1="12" x2="19" y2="12" />
                    </svg>
                  </button>
                {/if}
              </span>
            </div>
          </div>
        {/snippet}
        <ul class="results-list" role="list">
          {#each results as result (result.key)}
            {@const expandable = isExpandable(result)}
            {@const expanded = !!expandedKeys[result.key]}
            {@const loading = !!loadingKeys[result.key]}
            {@const childErr = childErrorByKey[result.key] ?? null}
            {@const kids = childrenByKey[result.key] ?? null}
            <li>
              {@render resultRow(result, 0, false)}
              {@render createFormBlock(result, 1)}

              {#if expandable && expanded}
                {#if childErr}
                  <p class="child-error" role="alert" style="--depth: 1;">
                    {childErr}
                  </p>
                {:else if kids && kids.length === 0 && !loading}
                  <p class="child-empty" style="--depth: 1;">
                    {t("search.noChildren")}
                  </p>
                {:else if kids && kids.length > 0}
                  {@const renderQueue: Array<{ node: SearchResult; depth: number; isLast: boolean }> = (() => {
                    const out: Array<{ node: SearchResult; depth: number; isLast: boolean }> = [];
                    const walk = (parent: SearchResult, depth: number) => {
                      const pkids = childrenByKey[parent.key];
                      if (!pkids) return;
                      for (const [i, c] of pkids.entries()) {
                        // `isLast` dipakai CSS untuk memotong garis di tengah
                        // baris, membentuk "└" — tanpa itu garisnya menjulur
                        // ke bawah seolah masih ada adik yang menyusul.
                        out.push({ node: c, depth, isLast: i === pkids.length - 1 });
                        if (
                          isExpandable(c) &&
                          expandedKeys[c.key] &&
                          childrenByKey[c.key]
                        ) {
                          walk(c, depth + 1);
                        }
                      }
                    };
                    walk(result, 1);
                    return out;
                  })()}
                  {#each renderQueue as item (item.node.key)}
                    {@const cExpandable = isExpandable(item.node)}
                    {@const cExpanded = !!expandedKeys[item.node.key]}
                    {@const cLoading = !!loadingKeys[item.node.key]}
                    {@render resultRow(item.node, item.depth, item.isLast)}
                    {@render createFormBlock(item.node, item.depth + 1)}
                  {/each}
                {/if}
              {/if}
            </li>
          {/each}
        </ul>
      {:else if !error && query.length >= MIN_QUERY_LENGTH}
        <p class="empty-state">{t("search.noMatch")}</p>
      {:else if !error && isTreeMode && !inFlight && results.length === 0}
        <p class="empty-state">
          {t("search.noEpics")}
        </p>
      {/if}
    </div>
  {:else if suggestions.length > 0}
    <!-- Kotak masih kosong: tawarkan riwayat sebagai titik awal, sehingga
         kasus paling umum (mencatat ke issue yang sama seperti kemarin)
         tidak perlu mengetik apa pun. -->
    <div class="suggestions" role="region" aria-label={suggestionsLabel || t("search.recent")}>
      <span class="suggestions-label">{suggestionsLabel || t("search.recent")}</span>
      <ul class="suggestion-list" role="list">
        {#each suggestions as s (s.key)}
          <li>
            <button
              type="button"
              class="suggestion-row"
              onclick={() => handleSelect(s)}
            >
              <span class="suggestion-key">{s.key}</span>
              {#if s.issueType}
                {@render typeIcon(s.issueType)}
              {/if}
              <span class="suggestion-summary" title={s.summary}>
                {s.summary}
              </span>
            </button>
          </li>
        {/each}
      </ul>
    </div>
  {:else if suggestionsEmpty}
    <p class="empty-state">{suggestionsEmpty}</p>
  {/if}
</div>

<style>
  .universal-search {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    width: 100%;
  }

  .search-label {
    font-size: 0.75rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: rgb(var(--fg-rgb) / 0.6);
  }

  /* --- Saran saat kotak kosong ------------------------------------------ */

  .suggestions {
    display: flex;
    flex-direction: column;
    gap: 0.375rem;
  }

  .suggestions-label {
    font-size: 0.6875rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: rgb(var(--fg-rgb) / 0.45);
  }

  .suggestion-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    max-height: 16rem;
    overflow-y: auto;
    scrollbar-width: thin;
    scrollbar-color: var(--glass-border) transparent;
  }

  .suggestion-row {
    width: 100%;
    /* Tanpa reset `box-sizing` global, `width: 100%` + padding meluber
       melewati tepi wadahnya. */
    box-sizing: border-box;
    display: flex;
    /* `center`, bukan `baseline`: ikon tipe adalah kotak berukuran tetap
       tanpa garis dasar teks, jadi baseline akan menggesernya. */
    align-items: center;
    gap: 0.625rem;
    padding: 0.5rem 0.625rem;
    border-radius: 0.5rem;
    border: 1px solid transparent;
    background: rgb(var(--fg-rgb) / 0.04);
    color: var(--text-primary);
    text-align: left;
    cursor: pointer;
    outline: none;
    transition:
      background 150ms ease-out,
      border-color 150ms ease-out;
  }

  .suggestion-row:hover {
    background: rgba(99, 102, 241, 0.14);
    border-color: rgba(99, 102, 241, 0.35);
  }

  .suggestion-row:focus-visible {
    box-shadow: var(--focus-ring);
  }

  .suggestion-key {
    font-weight: 700;
    font-size: 0.8125rem;
    color: var(--text-accent);
    flex-shrink: 0;
  }

  .suggestion-summary {
    font-size: 0.8125rem;
    color: rgb(var(--fg-rgb) / 0.75);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
  }

  .input-wrapper {
    position: relative;
    display: flex;
    align-items: center;
  }

  .search-icon {
    position: absolute;
    left: 0.75rem;
    width: 1rem;
    height: 1rem;
    color: rgb(var(--fg-rgb) / 0.45);
    pointer-events: none;
  }

  .search-input {
    width: 100%;
    /* Tanpa reset `box-sizing` global, `width: 100%` + padding meluber
       melewati tepi wadahnya. */
    box-sizing: border-box;
    padding: 0.625rem 0.875rem 0.625rem 2.25rem;
    border-radius: 0.625rem;
    border: 1px solid rgb(var(--fg-rgb) / 0.12);
    background: rgb(var(--fg-rgb) / 0.06);
    color: var(--text-primary);
    font: inherit;
    font-size: 0.9375rem;
    /* Hover/focus transitions stay under 250ms (R11.3). */
    transition:
      border-color 200ms ease-out,
      background 200ms ease-out,
      box-shadow 150ms ease-out;
    outline: none;
  }

  .search-input::placeholder {
    color: rgb(var(--fg-rgb) / 0.35);
  }

  .search-input:hover {
    background: rgb(var(--fg-rgb) / 0.08);
    border-color: rgb(var(--fg-rgb) / 0.2);
  }

  /* Focus ring distinct from hover (R11.4). */
  .search-input:focus-visible {
    border-color: rgba(99, 102, 241, 0.6);
    box-shadow: var(--focus-ring);
    background: rgb(var(--fg-rgb) / 0.08);
  }

  .error-message {
    margin: 0;
    padding: 0.5rem 0.75rem;
    border-radius: 0.5rem;
    background: rgba(239, 68, 68, 0.12);
    border: 1px solid rgba(239, 68, 68, 0.3);
    color: var(--text-danger);
    font-size: 0.8125rem;
    line-height: 1.4;
  }

  .results-region {
    /* Results sit in normal flow below the input (no absolute positioning). */
    display: flex;
    flex-direction: column;
  }

  .results-list,
  .skeleton-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    max-height: 22rem;
    overflow-y: auto;
  }

  /* Satu baris per issue. Sebelumnya baris ini `flex-wrap: wrap` dengan
     ringkasan ber-`min-width: 8rem`, sehingga ringkasan hampir selalu turun ke
     baris kedua dan hanya ~4 issue muat di layar. Untuk daftar yang tugasnya
     dipindai cepat, kepadatan lebih berharga daripada ringkasan utuh — teks
     penuhnya tetap tersedia lewat `title`. */
  .result-row {
    /* `flex: 1` + `min-width: 0`, bukan `width: 100%`.
       Baris ini adalah flex item di samping kolom chevron, dan app ini tidak
       punya reset `box-sizing: border-box`. Dengan `width: 100%` lebarnya
       menjadi 100% wadah _plus_ padding 1.5rem, border 2px, chevron 1.5rem,
       dan gap-nya — meluber ~3.5rem. Karena `.results-list` ber-`overflow-y:
       auto`, CSS menaikkan `overflow-x` dari `visible` menjadi `auto`, dan
       muncullah scrollbar horizontal itu. Dengan `flex-basis: 0` lebarnya
       dihitung dari sisa ruang, jadi padding dan border sudah ikut terhitung. */
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 0.625rem;
    padding: 0.5rem 0.75rem;
    border-radius: 0.5rem;
    border: 1px solid rgb(var(--fg-rgb) / 0.08);
    background: rgb(var(--fg-rgb) / 0.04);
    color: rgb(var(--fg-rgb) / 0.92);
    font: inherit;
    text-align: left;
    cursor: pointer;
    transition:
      background-color 200ms ease-out,
      border-color 200ms ease-out,
      box-shadow 150ms ease-out;
    outline: none;
  }

  /* --- Tree row layout ---------------------------------------------------
   * Each row is a flex pair of [chevron button | result button]. The
   * chevron sits in a fixed-width slot so all rows align regardless of
   * whether their item is expandable. Children get progressive
   * `padding-left` based on their `--depth` and a vertical connector line
   * so the hierarchy is visually obvious. */

  .result-row-wrap {
    --tree-line: rgb(var(--fg-rgb) / 0.14);
    display: flex;
    /* `center`, bukan `stretch`. Chevron punya `height` eksplisit, dan flex
       item bertinggi pasti tidak ikut stretch — ia jatuh ke atas baris.
       Selama barisnya setinggi chevron itu tidak kelihatan, tapi baris kini
       lebih tinggi (padding + tombol aksi 1.5rem), jadi panahnya tampak
       naik beberapa piksel. */
    align-items: center;
    gap: 0.375rem;
    position: relative;
    padding-left: calc(var(--depth, 0) * 1.25rem);
  }

  /* Garis hierarki, tiga lapis background pada satu elemen.
   *
   * Kolom-kolomnya berjarak 1.25rem, sama dengan langkah indentasi, dan
   * kolom ke-N berimpit dengan pusat chevron baris berkedalaman N. Itulah
   * yang membuat garis induk dan garis anak menyambung tanpa perlu tahu
   * apa pun tentang satu sama lain.
   *
   *   1. Garis leluhur  — gradien berulang, selalu setinggi penuh, jadi
   *      tulang punggung tidak bolong saat ada keturunan yang lebih dalam.
   *   2. Garis sendiri  — setinggi `--own-spine`: 50% untuk anak terakhir
   *      sehingga berhenti di tengah dan membentuk "└".
   *   3. Garis ke bawah — separuh bawah baris, di kolom chevron baris ini,
   *      hanya saat barisnya terbuka. Tanpa ini ada jeda setinggi separuh
   *      baris antara panah dan tulang punggung anak-anaknya. */
  .result-row-wrap::before {
    content: "";
    position: absolute;
    left: 0.6875rem;
    top: 0;
    bottom: 0;
    width: calc(var(--depth, 0) * 1.25rem + 1px);
    background-image:
      linear-gradient(var(--tree-line) 0 100%),
      linear-gradient(var(--tree-line) 0 100%),
      repeating-linear-gradient(
        to right,
        var(--tree-line) 0 1px,
        transparent 1px 1.25rem
      );
    background-size:
      1px var(--open-spine),
      1px var(--own-spine),
      var(--ancestor-width) 100%;
    background-position:
      right bottom,
      right 1.25rem top,
      left top;
    background-repeat: no-repeat, no-repeat, repeat-y;
    pointer-events: none;
  }

  /* Tinggi 0 = lapisnya tidak tergambar. Ini yang menyalakan tiap lapis,
     tanpa perlu menulis ulang seluruh aturan `background` per varian. */
  .result-row-wrap {
    --own-spine: 0;
    --open-spine: 0;
    --ancestor-width: 0px;
  }

  .result-row-wrap.is-child {
    --own-spine: 100%;
    /* `is-child` menjamin `--depth` >= 1, jadi hasilnya tak pernah negatif —
       dan `background-size` negatif akan membatalkan seluruh deklarasi. */
    --ancestor-width: calc((var(--depth, 1) - 1) * 1.25rem);
  }

  .result-row-wrap.is-child.is-last {
    --own-spine: 50%;
  }

  .result-row-wrap.is-open {
    --open-spine: 50%;
  }

  /* Cabang mendatar dari garis ke baris ini. Inilah yang membuat tiap anak
     terlihat menempel ke induknya, bukan sekadar berdiri di sebelah batang. */
  .result-row-wrap.is-child::after {
    content: "";
    position: absolute;
    left: calc((var(--depth, 1) - 1) * 1.25rem + 0.6875rem);
    top: 50%;
    /* Sampai tepi kiri kotak baris, bukan berhenti di kolom chevron:
       satu langkah indentasi + lebar chevron + gap wrap − offset garis.
       Ditulis sebagai penjumlahan komponennya, bukan hasilnya (2.4375rem),
       supaya tetap benar kalau salah satu ukuran itu disetel. */
    width: calc(1.25rem + 1.5rem + 0.375rem - 0.6875rem);
    height: 1px;
    background: var(--tree-line);
    pointer-events: none;
  }

  .chevron-btn,
  .chevron-spacer {
    flex-shrink: 0;
    width: 1.5rem;
    height: 1.875rem;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }

  .chevron-btn {
    padding: 0;
    border: none;
    background: transparent;
    color: rgb(var(--fg-rgb) / 0.55);
    cursor: pointer;
    border-radius: 0.375rem;
    transition: background 150ms ease-out, color 150ms ease-out;
    outline: none;
  }

  .chevron-btn:hover {
    background: rgb(var(--fg-rgb) / 0.08);
    color: var(--text-primary);
  }

  .chevron-btn:focus-visible {
    box-shadow: var(--focus-ring);
  }

  .chevron-icon {
    width: 0.875rem;
    height: 0.875rem;
    transition: transform 200ms cubic-bezier(0.22, 1, 0.36, 1);
  }

  .chevron-btn.expanded .chevron-icon {
    transform: rotate(90deg);
  }

  .chevron-spinner {
    width: 0.875rem;
    height: 0.875rem;
    border-radius: 50%;
    border: 1.5px solid rgba(199, 210, 254, 0.25);
    border-top-color: rgba(199, 210, 254, 0.85);
    animation: spinner-spin 0.7s linear infinite;
  }

  @keyframes spinner-spin {
    to { transform: rotate(360deg); }
  }

  .child-error,
  .child-empty {
    margin: 0.25rem 0 0.25rem 0;
    padding: 0.4375rem 0.75rem;
    padding-left: calc(var(--depth, 1) * 1.25rem + 0.75rem);
    font-size: 0.75rem;
    border-radius: 0.5rem;
  }

  .child-error {
    color: var(--text-danger);
    background: rgba(239, 68, 68, 0.08);
    border: 1px solid rgba(239, 68, 68, 0.2);
  }

  .child-empty {
    color: rgb(var(--fg-rgb) / 0.5);
    background: transparent;
    font-style: italic;
  }

  .result-row:hover {
    background: rgb(var(--fg-rgb) / 0.08);
    border-color: rgb(var(--fg-rgb) / 0.18);
  }

  .result-row:focus-visible {
    box-shadow: var(--focus-ring);
    border-color: rgba(99, 102, 241, 0.5);
  }

  .result-key {
    font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas,
      "Liberation Mono", monospace;
    font-size: 0.8125rem;
    font-weight: 600;
    color: var(--text-accent-strong);
    flex-shrink: 0;
    letter-spacing: 0.01em;
  }

  /* Anchor variant of `.result-key`: same typographic look, but signals
   * clickability with a dashed underline that solidifies on hover/focus.
   * `event.stopPropagation()` in the click handler prevents the row
   * itself from also firing `handleSelect`. */
  a.result-key.result-key-link {
    text-decoration: none;
    border-bottom: 1px dashed transparent;
    cursor: pointer;
    transition:
      color 200ms ease-out,
      border-color 200ms ease-out;
  }

  a.result-key.result-key-link:hover,
  a.result-key.result-key-link:focus-visible {
    color: var(--text-accent-strong);
    border-bottom-color: rgba(199, 210, 254, 0.65);
    outline: none;
  }

  /* Ikon tipe issue mengikuti set ikon Jira yang sekarang: glyph outline
     berwarna, tanpa kotak latar. */
  .type-icon {
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 1.125rem;
    height: 1.125rem;
  }

  /* Atribut stroke ditaruh di sini, bukan diulang di tiap <path>, supaya
     hanya ada satu tempat kalau ketebalannya perlu disetel. */
  .type-icon svg {
    width: 100%;
    height: 100%;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.5;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  /* Warna tipe issue Jira. Karena kotak latarnya sudah tidak ada, warna ini
     yang menjadi warna glyph — dan keduanya sengaja nilai tetap, bukan token
     `--fg-rgb`, supaya tipe issue tetap dikenali dari warna yang sama persis
     di tema terang maupun gelap. Ungu dan biru ini punya kontras memadai di
     kedua latar. */
  .type-icon[data-kind="epic"] {
    color: #904ee2;
  }

  .type-icon[data-kind="story"] {
    color: #65ba43;
  }

  .type-icon[data-kind="task"] {
    color: #2684ff;
  }

  .type-icon[data-kind="bug"] {
    color: #e5493a;
  }

  .type-icon[data-kind="subtask"] {
    color: #2684ff;
  }

  /* Aksi per-baris disembunyikan sampai barisnya disentuh. Sebelumnya kedua
     tombol menyala permanen di setiap baris, jadi daftar 20 issue berarti 40
     tombol yang bersaing perhatian dengan key dan ringkasan — justru bagian
     yang sedang dibaca. */
  .row-actions {
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    opacity: 0;
    transition: opacity 150ms ease-out;
  }

  .result-row:hover .row-actions,
  /* `focus-within` menjaga tombol tetap terjangkau keyboard: menge-Tab ke
     dalamnya memunculkannya. */
  .result-row:focus-within .row-actions,
  .result-row:focus-visible .row-actions {
    opacity: 1;
  }

  /* Selama form "tambah child" terbuka, tombolnya tetap terlihat walau kursor
     sudah pindah ke form di bawahnya.
     Sengaja berdiri sebagai aturan terpisah, bukan digabung ke daftar
     selektor di atas: satu selektor tak dikenal membatalkan seluruh aturan,
     dan kalau `:has()` tidak didukung, aturan hover ikut hilang dan tombolnya
     tak pernah muncul sama sekali. Terpisah begini, kegagalannya hanya
     kehilangan penanda ini. */
  .row-actions:has(.add-child-btn.active) {
    opacity: 1;
  }

  /* Perangkat sentuh tidak punya hover sama sekali, jadi di sana aksi harus
     selalu tampil — kalau tidak, ia menjadi tak terjangkau. */
  @media (hover: none) {
    .row-actions {
      opacity: 1;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .row-actions {
      transition: none;
    }
  }

  /* Had no rule at all, so it rendered as a default UA button — grey chrome
     with a `currentColor` icon inheriting the document's black. */
  .start-timer-btn {
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 1.5rem;
    height: 1.5rem;
    padding: 0;
    border: 1px solid rgb(var(--fg-rgb) / 0.08);
    background: rgb(var(--fg-rgb) / 0.04);
    color: rgb(var(--fg-rgb) / 0.55);
    border-radius: 0.5rem;
    cursor: pointer;
    transition:
      background 150ms ease-out,
      color 150ms ease-out,
      border-color 150ms ease-out;
    outline: none;
  }

  .start-timer-btn svg {
    width: 0.6875rem;
    height: 0.6875rem;
  }

  .start-timer-btn:hover {
    background: rgba(16, 185, 129, 0.18);
    border-color: rgba(16, 185, 129, 0.4);
    color: var(--text-success);
  }

  .start-timer-btn:focus-visible {
    box-shadow: var(--focus-ring);
    border-color: rgba(99, 102, 241, 0.5);
  }

  /* Kini berada di dalam baris, bukan di kolom terpisah di kanannya — dulu
     kotak tersendiri itu terbaca sebagai elemen lain, bukan aksi milik baris
     ini. Ukurannya disamakan dengan tombol timer di sebelahnya. */
  .add-child-btn {
    flex-shrink: 0;
    width: 1.5rem;
    height: 1.5rem;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    border: 1px solid rgb(var(--fg-rgb) / 0.08);
    background: rgb(var(--fg-rgb) / 0.04);
    color: rgb(var(--fg-rgb) / 0.55);
    border-radius: 0.5rem;
    cursor: pointer;
    transition:
      background 150ms ease-out,
      color 150ms ease-out,
      border-color 150ms ease-out;
    outline: none;
  }

  .add-child-btn svg {
    width: 0.875rem;
    height: 0.875rem;
  }

  .add-child-btn:hover {
    background: rgba(99, 102, 241, 0.18);
    border-color: rgba(99, 102, 241, 0.35);
    color: var(--text-accent-strong);
  }

  .add-child-btn:focus-visible {
    box-shadow: var(--focus-ring);
    border-color: rgba(99, 102, 241, 0.5);
  }

  .add-child-btn.active {
    background: rgba(99, 102, 241, 0.22);
    border-color: rgba(99, 102, 241, 0.55);
    color: var(--text-accent-strong);
  }

  /* -- Inline create form ---------------------------------------------- */

  .create-form {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    margin: 0.25rem 0 0.25rem 0;
    padding: 0.625rem 0.75rem;
    padding-left: calc(var(--depth, 1) * 1.25rem + 0.75rem);
    border-radius: 0.5rem;
    border: 1px solid rgba(99, 102, 241, 0.25);
    background: rgba(99, 102, 241, 0.06);
  }

  .create-field {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    flex: 1 1 0;
    min-width: 0;
  }

  .create-field-row {
    display: flex;
    gap: 0.5rem;
    flex-wrap: wrap;
  }

  .create-label {
    font-size: 0.6875rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: rgb(var(--fg-rgb) / 0.55);
  }

  .create-input {
    width: 100%;
    /* Tanpa reset `box-sizing` global, `width: 100%` + padding meluber
       melewati tepi wadahnya. */
    box-sizing: border-box;
    padding: 0.4375rem 0.625rem;
    border-radius: 0.4375rem;
    border: 1px solid rgb(var(--fg-rgb) / 0.12);
    background: rgb(var(--surface-rgb) / 0.55);
    color: var(--text-primary);
    font: inherit;
    font-size: 0.875rem;
    outline: none;
    transition: border-color 150ms ease-out, box-shadow 150ms ease-out;
  }

  .create-input:focus-visible {
    border-color: rgba(99, 102, 241, 0.55);
    box-shadow: var(--focus-ring);
  }

  .create-input:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .create-form-actions {
    display: flex;
    gap: 0.5rem;
    justify-content: flex-end;
    margin-top: 0.125rem;
  }

  .create-btn-primary,
  .create-btn-secondary {
    padding: 0.375rem 0.875rem;
    border-radius: 0.4375rem;
    font: inherit;
    font-size: 0.8125rem;
    font-weight: 600;
    cursor: pointer;
    transition: background 150ms ease-out, border-color 150ms ease-out;
    outline: none;
  }

  .create-btn-primary {
    border: 1px solid rgba(99, 102, 241, 0.6);
    background: rgba(99, 102, 241, 0.85);
    color: var(--text-primary);
  }

  .create-btn-primary:hover:not(:disabled) {
    background: rgba(99, 102, 241, 1);
  }

  .create-btn-primary:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .create-btn-secondary {
    border: 1px solid rgb(var(--fg-rgb) / 0.14);
    background: transparent;
    color: rgb(var(--fg-rgb) / 0.75);
  }

  .create-btn-secondary:hover:not(:disabled) {
    background: rgb(var(--fg-rgb) / 0.08);
  }

  .create-form-loading {
    margin: 0;
    font-size: 0.8125rem;
    color: rgb(var(--fg-rgb) / 0.6);
  }

  .create-form-error {
    margin: 0;
    padding: 0.375rem 0.625rem;
    border-radius: 0.4375rem;
    background: rgba(239, 68, 68, 0.12);
    border: 1px solid rgba(239, 68, 68, 0.3);
    color: var(--text-danger);
    font-size: 0.8125rem;
  }

  .result-summary {
    /* `min-width: 0` wajib: tanpa itu flex item menolak menyusut di bawah
     * lebar konten intrinsiknya dan elipsisnya tidak pernah muncul. */
    flex: 1;
    min-width: 0;
    font-size: 0.875rem;
    color: rgb(var(--fg-rgb) / 0.85);
    line-height: 1.4;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  /* -- Skeleton rows ---------------------------------------------------- */

  .skeleton-row {
    display: flex;
    align-items: center;
    gap: 0.625rem;
    padding: 0.5rem 0.75rem;
    border-radius: 0.5rem;
    border: 1px solid rgb(var(--fg-rgb) / 0.08);
    background: rgb(var(--fg-rgb) / 0.04);
  }

  .skeleton-key,
  .skeleton-summary {
    display: block;
    height: 0.75rem;
    border-radius: 0.25rem;
    background: linear-gradient(
      90deg,
      rgb(var(--fg-rgb) / 0.06) 0%,
      rgb(var(--fg-rgb) / 0.14) 50%,
      rgb(var(--fg-rgb) / 0.06) 100%
    );
    background-size: 200% 100%;
    animation: shimmer 1.4s ease-in-out infinite;
  }

  .skeleton-key {
    width: 4rem;
    flex-shrink: 0;
  }

  .skeleton-summary {
    flex: 1;
  }

  @keyframes shimmer {
    0% {
      background-position: 100% 0;
    }
    100% {
      background-position: -100% 0;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .search-input,
    .result-row {
      transition: none;
    }

    .skeleton-key,
    .skeleton-summary {
      animation: none;
      background: rgb(var(--fg-rgb) / 0.08);
    }
  }

  .empty-state {
    margin: 0;
    padding: 0.75rem 1rem;
    border-radius: 0.5rem;
    background: var(--glass-bg);
    border: 1px dashed var(--glass-border);
    color: rgb(var(--fg-rgb) / 0.55);
    font-size: 0.8125rem;
    line-height: 1.4;
  }
</style>
