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
    onSelect: (issue: { key: string; summary: string }) => void;
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
  }

  let {
    baseUrl,
    email,
    apiToken,
    isCloud,
    onSelect,
    projectKey,
    autoSearchOnEmpty = false,
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
    const t = (result.issueType ?? "").toLowerCase();
    if (t === "sub-task" || t === "subtask") return false;
    if (t === "epic") return parentsWithChildren.has(result.key);
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
  const MIN_QUERY_LENGTH = 2;

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
    onSelect({ key: result.key, summary: result.summary });
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
    Search issues
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
      placeholder="Search by issue key or summary"
      autocomplete="off"
      spellcheck="false"
      value={query}
      oninput={handleInput}
      aria-controls="universal-search-results"
      aria-describedby={error ? "universal-search-error" : undefined}
    />
  </div>

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
      aria-label="Search results"
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
                <p class="create-form-loading">Memuat form…</p>
              {:else if createMetaError}
                <p class="create-form-error" role="alert">{createMetaError}</p>
                <div class="create-form-actions">
                  <button type="button" class="create-btn-secondary" onclick={closeCreateForm}>
                    Tutup
                  </button>
                </div>
              {:else if createMeta}
                {@const types = eligibleIssueTypes(parent, createMeta)}
                <label class="create-field">
                  <span class="create-label">Summary</span>
                  <input
                    type="text"
                    class="create-input"
                    bind:value={formSummary}
                    placeholder="Apa yang ingin dikerjakan?"
                    required
                    autofocus
                    disabled={createSubmitting}
                  />
                </label>
                <div class="create-field-row">
                  <label class="create-field">
                    <span class="create-label">Task type</span>
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
                    <span class="create-label">Assignee</span>
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
                    Batal
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
        <ul class="results-list" role="list">
          {#each results as result (result.key)}
            {@const expandable = isExpandable(result)}
            {@const expanded = !!expandedKeys[result.key]}
            {@const loading = !!loadingKeys[result.key]}
            {@const childErr = childErrorByKey[result.key] ?? null}
            {@const kids = childrenByKey[result.key] ?? null}
            <li>
              <div class="result-row-wrap" style="--depth: 0;">
                {#if expandable}
                  <button
                    type="button"
                    class="chevron-btn"
                    class:expanded
                    aria-expanded={expanded}
                    aria-label={expanded ? `Tutup ${result.key}` : `Buka ${result.key}`}
                    onclick={() => toggleExpand(result)}
                  >
                    {#if loading}
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
                  onclick={() => handleSelect(result)}
                  onkeydown={(e) => rowKeydown(e, result)}
                >
                  {#if issueUrl(result.key)}
                    <a
                      class="result-key result-key-link"
                      href={issueUrl(result.key)}
                      onclick={(e) => openIssue(e, result.key)}
                      title={`Buka ${result.key} di Jira`}
                    >
                      {result.key}
                    </a>
                  {:else}
                    <span class="result-key">{result.key}</span>
                  {/if}
                  {#if result.issueType}
                    <span
                      class={`result-type type-${result.issueType.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}
                    >
                      {result.issueType}
                    </span>
                  {/if}
                  <span class="result-summary" title={result.summary}>
                    {result.summary}
                  </span>
                  <button
                    type="button"
                    class="start-timer-btn"
                    title="Start Timer"
                    onclick={(e) => startTimer(e, result)}
                  >
                    <svg viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                  </button>
                </div>
                {#if canCreateChildIn(result)}
                  <button
                    type="button"
                    class="add-child-btn"
                    class:active={createOpenFor === result.key}
                    aria-label={`Tambah child di ${result.key}`}
                    title={result.issueType?.toLowerCase() === "epic"
                      ? "Tambah Task"
                      : "Tambah Sub-task"}
                    onclick={() => void openCreateForm(result)}
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true">
                      <line x1="12" y1="5" x2="12" y2="19" />
                      <line x1="5" y1="12" x2="19" y2="12" />
                    </svg>
                  </button>
                {/if}
              </div>
              {@render createFormBlock(result, 1)}

              {#if expandable && expanded}
                {#if childErr}
                  <p class="child-error" role="alert" style="--depth: 1;">
                    {childErr}
                  </p>
                {:else if kids && kids.length === 0 && !loading}
                  <p class="child-empty" style="--depth: 1;">
                    Tidak ada child issue.
                  </p>
                {:else if kids && kids.length > 0}
                  {@const renderQueue: Array<{ node: SearchResult; depth: number }> = (() => {
                    const out: Array<{ node: SearchResult; depth: number }> = [];
                    const walk = (parent: SearchResult, depth: number) => {
                      const pkids = childrenByKey[parent.key];
                      if (!pkids) return;
                      for (const c of pkids) {
                        out.push({ node: c, depth });
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
                    <div
                      class="result-row-wrap is-child"
                      style="--depth: {item.depth};"
                    >
                      {#if cExpandable}
                        <button
                          type="button"
                          class="chevron-btn"
                          class:expanded={cExpanded}
                          aria-expanded={cExpanded}
                          aria-label={cExpanded ? `Tutup ${item.node.key}` : `Buka ${item.node.key}`}
                          onclick={() => toggleExpand(item.node)}
                        >
                          {#if cLoading}
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
                        onclick={() => handleSelect(item.node)}
                        onkeydown={(e) => rowKeydown(e, item.node)}
                      >
                        {#if issueUrl(item.node.key)}
                          <a
                            class="result-key result-key-link"
                            href={issueUrl(item.node.key)}
                            onclick={(e) => openIssue(e, item.node.key)}
                            title={`Buka ${item.node.key} di Jira`}
                          >
                            {item.node.key}
                          </a>
                        {:else}
                          <span class="result-key">{item.node.key}</span>
                        {/if}
                        {#if item.node.issueType}
                          <span
                            class={`result-type type-${item.node.issueType.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}
                          >
                            {item.node.issueType}
                          </span>
                        {/if}
                        <span class="result-summary" title={item.node.summary}>
                          {item.node.summary}
                        </span>
                        <button
                          type="button"
                          class="start-timer-btn"
                          title="Start Timer"
                          onclick={(e) => startTimer(e, item.node)}
                        >
                          <svg viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                        </button>
                      </div>
                      {#if canCreateChildIn(item.node)}
                        <button
                          type="button"
                          class="add-child-btn"
                          class:active={createOpenFor === item.node.key}
                          aria-label={`Tambah child di ${item.node.key}`}
                          title={item.node.issueType?.toLowerCase() === "epic"
                            ? "Tambah Task"
                            : "Tambah Sub-task"}
                          onclick={() => void openCreateForm(item.node)}
                        >
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true">
                            <line x1="12" y1="5" x2="12" y2="19" />
                            <line x1="5" y1="12" x2="19" y2="12" />
                          </svg>
                        </button>
                      {/if}
                    </div>
                    {@render createFormBlock(item.node, item.depth + 1)}
                  {/each}
                {/if}
              {/if}
            </li>
          {/each}
        </ul>
      {:else if !error && query.length >= MIN_QUERY_LENGTH}
        <p class="empty-state">No issues match this query.</p>
      {:else if !error && isTreeMode && !inFlight && results.length === 0}
        <p class="empty-state">
          Project ini belum punya Epic. Ketik untuk mencari issue lain.
        </p>
      {/if}
    </div>
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
    color: rgba(255, 255, 255, 0.6);
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
    color: rgba(255, 255, 255, 0.45);
    pointer-events: none;
  }

  .search-input {
    width: 100%;
    padding: 0.625rem 0.875rem 0.625rem 2.25rem;
    border-radius: 0.625rem;
    border: 1px solid rgba(255, 255, 255, 0.12);
    background: rgba(255, 255, 255, 0.06);
    color: #f1f5f9;
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
    color: rgba(255, 255, 255, 0.35);
  }

  .search-input:hover {
    background: rgba(255, 255, 255, 0.08);
    border-color: rgba(255, 255, 255, 0.2);
  }

  /* Focus ring distinct from hover (R11.4). */
  .search-input:focus-visible {
    border-color: rgba(99, 102, 241, 0.6);
    box-shadow: var(--focus-ring);
    background: rgba(255, 255, 255, 0.08);
  }

  .error-message {
    margin: 0;
    padding: 0.5rem 0.75rem;
    border-radius: 0.5rem;
    background: rgba(239, 68, 68, 0.12);
    border: 1px solid rgba(239, 68, 68, 0.3);
    color: #fca5a5;
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

  .result-row {
    width: 100%;
    display: flex;
    flex-wrap: wrap;
    align-items: flex-start;
    gap: 0.375rem 0.625rem;
    padding: 0.5rem 0.75rem;
    border-radius: 0.5rem;
    border: 1px solid rgba(255, 255, 255, 0.08);
    background: rgba(255, 255, 255, 0.04);
    color: rgba(255, 255, 255, 0.92);
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
    display: flex;
    align-items: stretch;
    gap: 0.375rem;
    position: relative;
    padding-left: calc(var(--depth, 0) * 1.25rem);
  }

  .result-row-wrap.is-child::before {
    /* Vertical connector line that runs the height of each child row,
     * anchored at the parent's chevron column. Subtle so it whispers
     * hierarchy without competing with the row content. */
    content: "";
    position: absolute;
    left: calc((var(--depth, 1) - 1) * 1.25rem + 0.6875rem);
    top: 0;
    bottom: 0;
    width: 1px;
    background: rgba(255, 255, 255, 0.1);
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
    color: rgba(255, 255, 255, 0.55);
    cursor: pointer;
    border-radius: 0.375rem;
    transition: background 150ms ease-out, color 150ms ease-out;
    outline: none;
  }

  .chevron-btn:hover {
    background: rgba(255, 255, 255, 0.08);
    color: #f8fafc;
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
    color: #fca5a5;
    background: rgba(239, 68, 68, 0.08);
    border: 1px solid rgba(239, 68, 68, 0.2);
  }

  .child-empty {
    color: rgba(255, 255, 255, 0.5);
    background: transparent;
    font-style: italic;
  }

  .result-row:hover {
    background: rgba(255, 255, 255, 0.08);
    border-color: rgba(255, 255, 255, 0.18);
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
    color: #c7d2fe;
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
    color: #e0e7ff;
    border-bottom-color: rgba(199, 210, 254, 0.65);
    outline: none;
  }

  /* Issue type badge — defaults to a neutral chip; specific types pick up
   * their own accent via `.type-<slug>` rules below. The slug comes from
   * the issue type name (e.g. "Sub-task" → "sub-task", "Story" → "story").
   *
   * `max-width` keeps long labels (e.g. "TASK DEVELOPMENT / CONFIGURATION")
   * from monopolising the row width when the badge wraps to its own line;
   * `overflow-wrap: anywhere` lets the badge break inside long tokens
   * rather than pushing past the container edge. */
  .result-type {
    display: inline-flex;
    align-items: center;
    flex-shrink: 0;
    max-width: 100%;
    padding: 0.0625rem 0.4375rem;
    border-radius: 0.375rem;
    font-size: 0.6875rem;
    font-weight: 600;
    line-height: 1.4;
    letter-spacing: 0.02em;
    text-transform: uppercase;
    background: rgba(255, 255, 255, 0.08);
    border: 1px solid rgba(255, 255, 255, 0.14);
    color: rgba(241, 245, 249, 0.85);
    overflow-wrap: anywhere;
    white-space: normal;
  }

  .result-type.type-epic {
    background: rgba(139, 92, 246, 0.18);
    border-color: rgba(139, 92, 246, 0.35);
    color: #ddd6fe;
  }

  .result-type.type-story {
    background: rgba(34, 197, 94, 0.18);
    border-color: rgba(34, 197, 94, 0.35);
    color: #bbf7d0;
  }

  .result-type.type-task {
    background: rgba(59, 130, 246, 0.18);
    border-color: rgba(59, 130, 246, 0.35);
    color: #bfdbfe;
  }

  .result-type.type-sub-task,
  .result-type.type-subtask {
    background: rgba(14, 165, 233, 0.18);
    border-color: rgba(14, 165, 233, 0.35);
    color: #bae6fd;
  }

  .result-type.type-bug {
    background: rgba(239, 68, 68, 0.18);
    border-color: rgba(239, 68, 68, 0.35);
    color: #fecaca;
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
    border: 1px solid rgba(255, 255, 255, 0.08);
    background: rgba(255, 255, 255, 0.04);
    color: rgba(255, 255, 255, 0.55);
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
    color: #6ee7b7;
  }

  .start-timer-btn:focus-visible {
    box-shadow: var(--focus-ring);
    border-color: rgba(99, 102, 241, 0.5);
  }

  .add-child-btn {
    flex-shrink: 0;
    align-self: stretch;
    width: 1.875rem;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    border: 1px solid rgba(255, 255, 255, 0.08);
    background: rgba(255, 255, 255, 0.04);
    color: rgba(255, 255, 255, 0.55);
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
    color: #c7d2fe;
  }

  .add-child-btn:focus-visible {
    box-shadow: var(--focus-ring);
    border-color: rgba(99, 102, 241, 0.5);
  }

  .add-child-btn.active {
    background: rgba(99, 102, 241, 0.22);
    border-color: rgba(99, 102, 241, 0.55);
    color: #e0e7ff;
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
    color: rgba(255, 255, 255, 0.55);
  }

  .create-input {
    width: 100%;
    padding: 0.4375rem 0.625rem;
    border-radius: 0.4375rem;
    border: 1px solid rgba(255, 255, 255, 0.12);
    background: rgba(15, 23, 42, 0.55);
    color: #f1f5f9;
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
    color: #f8fafc;
  }

  .create-btn-primary:hover:not(:disabled) {
    background: rgba(99, 102, 241, 1);
  }

  .create-btn-primary:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .create-btn-secondary {
    border: 1px solid rgba(255, 255, 255, 0.14);
    background: transparent;
    color: rgba(255, 255, 255, 0.75);
  }

  .create-btn-secondary:hover:not(:disabled) {
    background: rgba(255, 255, 255, 0.08);
  }

  .create-form-loading {
    margin: 0;
    font-size: 0.8125rem;
    color: rgba(255, 255, 255, 0.6);
  }

  .create-form-error {
    margin: 0;
    padding: 0.375rem 0.625rem;
    border-radius: 0.4375rem;
    background: rgba(239, 68, 68, 0.12);
    border: 1px solid rgba(239, 68, 68, 0.3);
    color: #fca5a5;
    font-size: 0.8125rem;
  }

  .result-summary {
    flex: 1 1 12rem;
    min-width: 8rem;
    font-size: 0.875rem;
    color: rgba(255, 255, 255, 0.85);
    line-height: 1.4;
    /* Allow long summaries to wrap onto multiple lines instead of being
     * truncated with ellipsis. `overflow-wrap` makes sure unbroken tokens
     * (e.g. "ITBP/ITPMO/BPR" or long URLs) still break inside the row
     * rather than overflowing horizontally. */
    overflow-wrap: anywhere;
    white-space: normal;
  }

  /* -- Skeleton rows ---------------------------------------------------- */

  .skeleton-row {
    display: flex;
    align-items: center;
    gap: 0.625rem;
    padding: 0.5rem 0.75rem;
    border-radius: 0.5rem;
    border: 1px solid rgba(255, 255, 255, 0.08);
    background: rgba(255, 255, 255, 0.04);
  }

  .skeleton-key,
  .skeleton-summary {
    display: block;
    height: 0.75rem;
    border-radius: 0.25rem;
    background: linear-gradient(
      90deg,
      rgba(255, 255, 255, 0.06) 0%,
      rgba(255, 255, 255, 0.14) 50%,
      rgba(255, 255, 255, 0.06) 100%
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
      background: rgba(255, 255, 255, 0.08);
    }
  }

  .empty-state {
    margin: 0;
    padding: 0.75rem 1rem;
    border-radius: 0.5rem;
    background: var(--glass-bg);
    border: 1px dashed var(--glass-border);
    color: rgba(255, 255, 255, 0.55);
    font-size: 0.8125rem;
    line-height: 1.4;
  }
</style>
