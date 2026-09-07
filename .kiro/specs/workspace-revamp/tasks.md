# Implementation Plan: Workspace Revamp

## Overview

Convert the feature design into a series of prompts for a code-generation LLM that will implement each step with incremental progress. Make sure that each prompt builds on the previous prompts, and ends with wiring things together. There should be no hanging or orphaned code that isn't integrated into a previous step. Focus ONLY on tasks that involve writing, modifying, or testing code.

This plan implements the post-login workspace revamp for JIRA Logwork (Svelte 5 + TypeScript + Tauri 2 + Tailwind v4). It is ordered bottom-up: pure stores first (testable in isolation), then leaf components, then composite components, then the `Workspace.svelte` shell, then `App.svelte` wiring, then deletion of legacy files. Property tests target the pure-logic surface and are marked optional with `*`. Test framework setup is included as the first task since the project does not yet have one.

## Tasks

- [x] 1. Set up testing framework and shared style tokens
  - [x] 1.1 Install and configure vitest + fast-check + @testing-library/svelte
    - Add `vitest`, `@vitest/ui`, `jsdom`, `fast-check`, `@testing-library/svelte`, `@testing-library/jest-dom` as devDependencies in `package.json`
    - Add a `vitest.config.ts` at repo root with `environment: 'jsdom'`, Svelte plugin, alias `$lib -> src/lib`
    - Add `"test": "vitest --run"` and `"test:watch": "vitest"` scripts to `package.json`
    - Create `src/test-setup.ts` registering `@testing-library/jest-dom` matchers and a global `prefers-reduced-motion` matchMedia stub
    - Create `src/lib/test-utils/tauriMocks.ts` exporting helpers to mock `@tauri-apps/api` `invoke` and `@tauri-apps/plugin-store` `load`
    - _Requirements: 4.5, 5.2, 6.5, 7.2, 7.4, 9.3, 10.2, 14.1, 14.2_

  - [x] 1.2 Add glass-morphism CSS tokens to `src/app.css`
    - Append `:root { --glass-bg, --glass-bg-strong, --glass-border, --glass-blur, --glass-shadow, --glass-radius, --accent-from, --accent-to, --focus-ring, --intensity-0..4 }` per design "Glass-Morphism Style Tokens"
    - Add `.glass` utility class applying `background`, `backdrop-filter: blur(var(--glass-blur))`, border, shadow, radius
    - Add `@media (prefers-reduced-motion: reduce)` rules disabling transforms on `.drawer-panel` and counter classes
    - _Requirements: 1.3, 11.2, 11.3, 11.4, 11.5_


- [x] 2. Implement pure stores (no Svelte dependency)
  - [x] 2.1 Create `src/lib/stores/recentIssuesStore.ts`
    - Export `RecentIssue` interface (`issueKey`, `summary`, `lastUsedAt`) and `RECENT_ISSUES_MAX = 10`
    - Implement pure `cacheKeyForEmail(email)` returning `email.trim().toLowerCase()`
    - Implement pure `upsertRecentIssue(cache, {issueKey, summary}, now = new Date())` that bumps the issue's `lastUsedAt`, sorts by `lastUsedAt` descending, dedupes by key, and trims to `RECENT_ISSUES_MAX`
    - Implement async `loadRecentIssues(email)` and `saveRecentIssues(email, cache)` using `@tauri-apps/plugin-store` `recent-issues.json` under top-level key `"users"` mapping email -> cache; `loadRecentIssues` returns `[]` on any error
    - _Requirements: 6.2, 6.3, 6.5, 6.6, 14.1, 14.2, 14.5_

  - [ ]* 2.2 Write property tests for `recentIssuesStore` pure logic
    - **Property 1: Recent issues upsert maintains cache invariants**
    - **Validates: Requirements 6.2, 6.3, 6.5, 14.2, 15.5**
    - File: `src/lib/stores/recentIssuesStore.test.ts`
    - Use `fc.array(recentIssueArb, {maxLength: 30})`, `recentIssueArb`, `fc.date()` generators

  - [ ]* 2.3 Write property test for recent-issues persistence round-trip
    - **Property 2: Recent issues persistence round-trip is keyed by lowercased email**
    - **Validates: Requirements 6.6, 14.1, 14.2**
    - File: `src/lib/stores/recentIssuesStore.test.ts` (add to existing file)
    - Mock `@tauri-apps/plugin-store` via `tauriMocks.ts`; assert save+load returns deeply equal cache for any-casing/whitespace email pairs

  - [x] 2.4 Create `src/lib/stores/heatmapStore.ts`
    - Re-export `WorklogDay` from `worklogStore.ts` and define `HeatmapCell { date, hours, intensity }`
    - Implement pure `intensityFor(hours)` returning `0|1|2|3|4` per design buckets (0 / 0<h<2 / 2≤h<4 / 4≤h<8 / h≥8)
    - Implement pure `buildHeatmap(worklogsByDate, weeks, today)` returning `{ range: { startDate, endDate }, cells }` with `7 * weeks` cells ending on Saturday of `today`'s week
    - Implement pure `filterByAuthorEmail(worklogs, email)` doing case-insensitive trimmed comparison preserving order
    - _Requirements: 5.2, 5.3, 5.8, 5.9_

  - [ ]* 2.5 Write property test for heatmap intensity bucketing
    - **Property 3: Heatmap intensity bucketing is correct and monotonic**
    - **Validates: Requirements 5.2**
    - File: `src/lib/stores/heatmapStore.test.ts`
    - Generators: `fc.float({min: 0, max: 100, noNaN: true})` plus boundary set `{0, 0.0001, 1.999, 2, 4, 7.999, 8}`

  - [ ]* 2.6 Write property test for heatmap range and cell shape
    - **Property 4: Heatmap range matches displayed cells**
    - **Validates: Requirements 5.3, 5.8**
    - File: `src/lib/stores/heatmapStore.test.ts`

  - [ ]* 2.7 Write property test for author email filter
    - **Property 5: Author email filter is case-insensitive**
    - **Validates: Requirements 5.9**
    - File: `src/lib/stores/heatmapStore.test.ts`


  - [x] 2.8 Create `src/lib/stores/searchStore.ts`
    - Export `SearchResult { key, summary }` and `ISSUE_KEY_REGEX = /^[A-Z][A-Z0-9_]+-\d+$/i`
    - Implement pure `looksLikeIssueKey(query)` matching the regex
    - Implement pure `mergeAndDedupeResults(lists)` preserving first-seen order across nested arrays
    - Implement async `searchAll(ctx, query)` orchestrator: tries `search_issues` with empty `projectKey`, on rejection fans out via `get_projects` and `Promise.all`, merges via `mergeAndDedupeResults`; if `looksLikeIssueKey(query)` also queries the exact key and merges; uses an internal request-id check so stale responses are dropped
    - _Requirements: 7.2, 7.3, 7.4, 7.5_

  - [ ]* 2.9 Write property test for issue-key regex
    - **Property 10: Issue-key detection matches the published regex**
    - **Validates: Requirements 7.4**
    - File: `src/lib/stores/searchStore.test.ts`

  - [ ]* 2.10 Write property test for merge/dedupe
    - **Property 11: Search merge is deduplicated and exhaustive**
    - **Validates: Requirements 7.3**
    - File: `src/lib/stores/searchStore.test.ts`

  - [x] 2.11 Create `src/lib/stores/settingsStore.ts`
    - Export `WorkspaceSettings { reminderEnabled, reminderHour, targetHours }` and `SettingsValidation`
    - Implement pure `validateWorkspaceSettings(s)` enforcing `Number.isInteger(reminderHour) && 8..22`, `1 ≤ targetHours ≤ 12`, `Number.isInteger(targetHours * 2)`
    - Implement pure helpers `weeklyTarget(targetHours) = targetHours * 5`, `clamp01(x)`, `secondsForHours(h) = Math.round(h * 3600)`, `jiraStarted(date) = date + 'T09:00:00.000+0000'`
    - Implement async `loadWorkspaceSettings()` and `saveWorkspaceSettings(s)` against `settings.json` using existing key names; load returns sensible defaults `{ reminderEnabled: false, reminderHour: 9, targetHours: 8 }` on any error
    - _Requirements: 4.5, 4.7, 9.3, 10.2, 10.3, 14.6_

  - [ ]* 2.12 Write property test for settings validation
    - **Property 7: Workspace settings validation matches the specified ranges**
    - **Validates: Requirements 4.5**
    - File: `src/lib/stores/settingsStore.test.ts`

  - [ ]* 2.13 Write property test for worklog submission transforms
    - **Property 13: Worklog submission transforms are correct**
    - **Validates: Requirements 9.3**
    - File: `src/lib/stores/settingsStore.test.ts`

  - [ ]* 2.14 Write property test for weekly summary math
    - **Property 18: Weekly summary math is correct**
    - **Validates: Requirements 10.2, 10.3**
    - File: `src/lib/stores/settingsStore.test.ts`

  - [x] 2.15 Create `src/lib/stores/quickLogReducer.ts` (extracted pure reducer for QuickLogCard)
    - Export pure `canSubmit({recentIssuesReady, selectedIssue, effectiveHours, submitState})` → boolean
    - Export pure `chipReducer(state, action)` handling chip-click and custom-hours actions to maintain single-selection radio invariants
    - Export pure `isValidCustomHours(h)` (0.25 ≤ h ≤ 24, multiple of 0.25), `isValidDescription(s)` (length ≤ 500)
    - Export pure `initialFor(displayName, email)` returning the avatar initial per Property 17
    - Export pure `shouldShowCredentialsBanner(creds)` reusing `isCredentialComplete` from `authStore`
    - _Requirements: 3.2, 8.2, 8.3, 8.4, 8.5, 9.1, 9.2, 12.2, 14.3, 15.7_


  - [ ]* 2.16 Write property test for canSubmit gating
    - **Property 14: Submit button gating is sound**
    - **Validates: Requirements 9.1, 9.2, 12.2, 14.3**
    - File: `src/lib/stores/quickLogReducer.test.ts`

  - [ ]* 2.17 Write property test for chip group reducer
    - **Property 15: Time preset chips form a single-selection radio group**
    - **Validates: Requirements 8.2, 8.4, 13.5**
    - File: `src/lib/stores/quickLogReducer.test.ts`

  - [ ]* 2.18 Write property test for custom hours and description validators
    - **Property 16: Custom hours and description validators**
    - **Validates: Requirements 8.3, 8.5**
    - File: `src/lib/stores/quickLogReducer.test.ts`

  - [ ]* 2.19 Write property test for avatar initial derivation
    - **Property 17: Avatar initial derivation is deterministic**
    - **Validates: Requirements 3.2**
    - File: `src/lib/stores/quickLogReducer.test.ts`

  - [ ]* 2.20 Write property test for credentials banner visibility
    - **Property 20: Credentials banner visibility tracks completeness**
    - **Validates: Requirements 15.7**
    - File: `src/lib/stores/quickLogReducer.test.ts`

- [x] 3. Checkpoint - Pure store layer complete
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Implement leaf presentational components
  - [x] 4.1 Create `src/lib/components/AnimatedCounter.svelte`
    - `$props` interface `{ value: number; duration?: number; fractionDigits?: number }`
    - Internally tween from previous to next value via `requestAnimationFrame` using `easeOutCubic`; default duration 600ms; clamp to [200, 800]
    - When `window.matchMedia('(prefers-reduced-motion: reduce)').matches`, jump directly to `value` without intermediate frames
    - Render `<span>` with `value.toFixed(fractionDigits ?? 1)`
    - _Requirements: 10.4, 10.6, 11.5_

  - [ ]* 4.2 Write property test for AnimatedCounter easing
    - **Property 19: Animated counter starts at `from` and ends at `to`**
    - **Validates: Requirements 10.4, 10.6**
    - File: `src/lib/components/AnimatedCounter.test.ts`
    - Extract `easeOutCubic(t, from, to, duration)` to a small pure helper exported from the component module or a sibling `.ts` file so it can be tested directly

  - [x] 4.3 Create `src/lib/components/TimePresetChips.svelte`
    - `$props { value: 0.5|1|2|4|8|null; onChange: (v) => void }`
    - Render `<div role="radiogroup">` with five `<button role="radio" aria-checked>` chips for values 0.5, 1, 2, 4, 8
    - Implement Left/Right arrow navigation moving `aria-checked` and Space/Enter to confirm; cycle wraps at ends
    - Visible focus ring distinct from hover; hover transition ≤ 250ms
    - _Requirements: 8.1, 8.2, 11.3, 11.4, 13.5_

  - [ ]* 4.4 Write component test for TimePresetChips keyboard navigation
    - File: `src/lib/components/TimePresetChips.test.ts`
    - Render with stub `value=1`, `onChange` spy; simulate Left/Right/Space/Enter; assert `onChange` called with expected values; assert `role="radiogroup"` and exactly one `aria-checked="true"`
    - _Requirements: 8.1, 8.2, 13.5_

  - [x] 4.5 Create `src/lib/components/RecentIssuesList.svelte`
    - `$props { issues: RecentIssue[]; selectedKey: string | null; onSelect: (issue) => void }`
    - Render at most 10 entries already sorted, each row showing issue key + summary; selected row visually highlighted
    - Empty-state placeholder: "No recent issues. Use the search below to find one."
    - Keyboard reachable; Enter/Space activates row
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.7, 11.3, 11.4_


  - [x] 4.6 Create `src/lib/components/CredentialsBanner.svelte`
    - `$props { show: boolean; onOpenSettings: () => void }`
    - When `show`, render glass banner "Connection setup is incomplete. Open Settings to finish." with an "Open Settings" button calling `onOpenSettings`
    - Apply `.glass` style from app.css; non-blocking (does not overlay content)
    - _Requirements: 1.3, 11.2, 15.7_

  - [x] 4.7 Create `src/lib/components/UserAvatarDropdown.svelte`
    - `$props { displayName: string; email: string; onOpenSettings: () => void; onLogout: () => void }`
    - Render avatar button with initial via `initialFor(displayName, email)` (import from `quickLogReducer.ts`)
    - Click / Enter / Space toggles menu; menu uses `role="menu"` with `aria-orientation="vertical"`, items use `role="menuitem"` with exactly two entries: "Settings" and "Logout"
    - Up/Down arrows cycle items, Escape closes, outside-click closes, focus-out closes
    - Register keyboard handlers in the same render pass that opens the menu so the menu cannot open without them (R13.4)
    - On "Settings" click call `onOpenSettings`; on "Logout" click call `onLogout`
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.6, 3.7, 13.3, 13.4_

  - [ ]* 4.8 Write component test for UserAvatarDropdown keyboard nav
    - **Property 24 (partial): Keyboard navigation traps and cycles correctly**
    - **Validates: Requirements 13.3, 13.4**
    - File: `src/lib/components/UserAvatarDropdown.test.ts`
    - Render with spies; arb sequence of `Down/Up/Tab/Escape` events; assert focus indices and close behavior

  - [x] 4.9 Create `src/lib/components/WorkspaceHeader.svelte`
    - `$props { displayName: string; email: string; onOpenSettings: () => void; onLogout: () => void }`
    - Layout: logo + "JIRA Logwork" left; current date in user locale long form (`toLocaleDateString(undefined, { dateStyle: 'full' })`) center; `<UserAvatarDropdown>` right
    - Apply `.glass` style; ensure tab order: logo → avatar dropdown
    - _Requirements: 1.3, 3.1, 11.2, 13.1_

- [x] 5. Checkpoint - Leaf components complete
  - Ensure all tests pass, ask the user if questions arise.

- [x] 6. Implement composite components
  - [x] 6.1 Create `src/lib/components/UniversalSearch.svelte`
    - `$props { baseUrl, email, apiToken, isCloud, onSelect }`
    - Internal `$state`: `query`, `results: SearchResult[]`, `inFlight: boolean`, `error: string | null`, `latestRequestId: number`
    - Debounce keystrokes 300ms via cancellable timer; only fire `searchAll` when `query.length >= 2`
    - Render labeled `<input>`, skeleton placeholder while `inFlight`, results list (up to 20 items, `Math.min(results.length, 20)`)
    - Click result calls `onSelect(result)` and clears `query`; clearing `query` hides results
    - On `searchAll` rejection set `error` and retain `query`
    - _Requirements: 7.1, 7.2, 7.5, 7.6, 7.7, 7.8, 7.9, 11.6, 13.7_

  - [ ]* 6.2 Write property test for UniversalSearch debounce
    - **Property 9: Universal Search debounces to a single invocation per burst**
    - **Validates: Requirements 7.2**
    - File: `src/lib/components/UniversalSearch.test.ts`
    - Use `vi.useFakeTimers()`; arb keystroke sequences with gap durations; assert `searchAll` invocation count

  - [ ]* 6.3 Write property test for search result truncation
    - **Property 12: Search result truncation never exceeds the visible cap**
    - **Validates: Requirements 7.5**
    - File: `src/lib/components/UniversalSearch.test.ts`


  - [x] 6.4 Create `src/lib/components/HeatmapCalendar.svelte`
    - `$props { worklogsByDate, isLoading, error, weeks, selectedDate, onSelectDate, onChangeRange, onRetry }`
    - Compute cells via `buildHeatmap(worklogsByDate, weeks, today)` (`$derived`)
    - Render columns of 7 (Sun–Sat); each cell is a `<button>` with `aria-label="{localeDate}, {hours.toFixed(1)} hours"` and a CSS class for `intensity-{0..4}` token
    - Hover tooltip via `<div role="tooltip">` showing locale date + hours to one decimal
    - Skeleton loader (12 × 7 shimmer squares) when `isLoading`
    - Error state: inline message + Retry button calling `onRetry`
    - Range controls (12 weeks default plus a small preset set) calling `onChangeRange`
    - First-day-of-week labels visible per R5.1
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.10, 11.6, 13.6, 15.1_

  - [ ]* 6.5 Write component test for HeatmapCalendar aria-labels
    - **Property 6: Heatmap cells expose accessible labels**
    - **Validates: Requirements 13.6**
    - File: `src/lib/components/HeatmapCalendar.test.ts`
    - Render with arb `worklogsByDate`; assert every cell button has `aria-label` containing the locale date and `hours.toFixed(1)`

  - [x] 6.6 Create `src/lib/components/WeeklySummary.svelte`
    - `$props { worklogsByDate, targetHours, isLoading, today }`
    - `$derived` `weeklyTotal` (sum of ISO Mon–Sun hours from `worklogsByDate`), `weeklyTarget = targetHours * 5`, `progress = clamp01(weeklyTotal / weeklyTarget)` (using `weeklyTarget`/`clamp01` from `settingsStore`)
    - Render `<AnimatedCounter value={weeklyTotal} fractionDigits={1} />`, target text `weeklyTarget.toFixed(1)`, and a progress bar reflecting `progress`
    - Skeleton loader when `isLoading`
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 11.6_

  - [x] 6.7 Create `src/lib/components/QuickLogCard.svelte`
    - `$props` interface from design (recentIssues, recentIssuesReady, recentIssuesError, selectedDate, email, baseUrl, apiToken, isCloud, onWorklogSubmitted, onWorklogQueued)
    - Render `<RecentIssuesList>`, `<UniversalSearch>`, `<TimePresetChips>`, custom hours `<input>` (0.25–24, 0.25 step), description `<textarea>` (label "Description (optional)", maxlength 500), and Submit `<button>`
    - Default `chipHours = 1` on first render; entering custom hours clears chip selection (via `chipReducer`)
    - `$derived effectiveHours = customHours ?? chipHours ?? 0`
    - `$derived canSubmit` via `canSubmit(...)` from `quickLogReducer.ts`
    - On submit: invoke `add_worklog` Tauri command with `{ baseUrl, email, apiToken, isCloud, issueKey, timeSpentSeconds: secondsForHours(hours), started: jiraStarted(selectedDate), comment: description }`
    - Loading state on Submit while in flight (disabled + spinner)
    - On success: set `submitState='success'` for 2000ms (within 1500–2500), clear description, reset chip to 1h, emit `onWorklogSubmitted({ issueKey, summary, hours, date })`
    - On error: classify via `classifyError(err)`. If `type === 'network'`, call `addPendingWorklog({ issueKey, timeSpentSeconds, started, comment })`; on enqueue success set `submitState='queued'` ("Queued for sync") and emit `onWorklogQueued`; on enqueue failure set `submitState='error'` with message and do NOT show queued confirmation. For non-network errors set `submitState='error'`, retain selected issue/hours/description
    - All inputs labeled via `<label for>` / `id`
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.7, 7.1, 8.1–8.7, 9.1–9.8, 11.6, 12.1, 12.3, 13.7, 15.2, 15.3, 15.4_

  - [ ]* 6.8 Write property test for QuickLogCard submit-state transitions
    - **Property 23: Submit state transitions preserve the right invariants**
    - **Validates: Requirements 9.5, 9.7**
    - File: `src/lib/components/QuickLogCard.test.ts`

  - [ ]* 6.9 Write property test for QuickLogCard network-error enqueue path
    - **Property 21: Network-error path enqueues exactly once**
    - **Validates: Requirements 15.2**
    - File: `src/lib/components/QuickLogCard.test.ts`


  - [x] 6.10 Create `src/lib/components/SettingsDrawer.svelte`
    - `$props { open, initialSettings, initialCredentials, initialIsCloud, onClose, onSettingsSaved, onCredentialsSaved }`
    - Render slide-in panel from the right (`transform: translateX(100%)` ↔ `translateX(0)`) over a fading backdrop; total animation duration 250ms (within 150–350ms range)
    - Three sections: "Jira Connection" (embeds existing `<CredentialForm>` plus a Cloud/Server toggle bound to `isCloud`; on submit invokes `test_connection` and persists `baseUrl/email/apiToken/isCloud` to `settings.json`), "Reminder" (checkbox `reminderEnabled`, integer `reminderHour`), "Target Hours" (number input `targetHours`)
    - On Save: call `validateWorkspaceSettings(s)`. On invalid → render inline errors per field, do not persist. On valid → call `saveWorkspaceSettings(s)` then `onSettingsSaved(s)`
    - Implement focus trap: capture first/last focusable elements, redirect Tab/Shift+Tab to wrap; restore focus on close
    - Outside-click and Escape call `onClose`
    - Disable translation/scaling animations when `prefers-reduced-motion: reduce`
    - _Requirements: 4.1–4.11, 11.2, 11.5, 13.2, 14.6_

  - [ ]* 6.11 Write property test for SettingsDrawer save gating
    - **Property 8: Settings persistence is gated by validation**
    - **Validates: Requirements 4.6, 4.7**
    - File: `src/lib/components/SettingsDrawer.test.ts`
    - Mock `saveWorkspaceSettings`; arb `WorkspaceSettings`; assert call count 1 iff valid, 0 otherwise

  - [ ]* 6.12 Write property test for SettingsDrawer focus trap
    - **Property 24 (partial): Keyboard navigation traps and cycles correctly**
    - **Validates: Requirements 4.9, 13.2**
    - File: `src/lib/components/SettingsDrawer.test.ts`
    - Arb sequence of `Tab`/`Shift+Tab` events; assert focus never escapes panel; first/last wrap correctly

- [x] 7. Checkpoint - Composite components complete
  - Ensure all tests pass, ask the user if questions arise.

- [x] 8. Implement Workspace shell
  - [x] 8.1 Create `src/lib/pages/Workspace.svelte`
    - `$props { displayName: string; email: string; onLogout: () => void }`
    - `$state` for `selectedDate`, `recentIssues`, `recentIssuesReady`, `recentIssuesError`, `worklogsByDate`, `worklogsLoading`, `worklogsError`, `workspaceSettings`, `credentials` (loaded from store), `isCloud`, `settingsDrawerOpen`, `refreshSeq`
    - On mount run three loads in parallel: `loadWorkspaceSettings()`, `loadRecentIssues(email)` (sets `recentIssuesReady` true on success / `recentIssuesError` on rejection), `get_my_worklogs(...)` for the active heatmap range; group via `groupWorklogsByDate` + `filterByAuthorEmail`
    - Compose layout: `<AnimatedBackground />` + 12-col responsive grid containing `<WorkspaceHeader>`, `<CredentialsBanner show={!isCredentialComplete(credentials)}>`, `<HeatmapCalendar>` (col-span 8), `<QuickLogCard>` (col-span 4), `<WeeklySummary>` (full width), and overlay `<SettingsDrawer>`
    - Pass `selectedDate ?? today` to QuickLogCard; on `HeatmapCalendar` `onSelectDate` update `selectedDate`
    - On QuickLogCard `onWorklogSubmitted`: `upsertRecentIssue` + `saveRecentIssues`, `refreshSeq++`, re-fetch worklogs
    - On QuickLogCard `onWorklogQueued`: `upsertRecentIssue` + `saveRecentIssues` (no fetch refresh needed yet)
    - Subscribe to existing `offlineStore` sync cycle completions; bump `refreshSeq` regardless of `synced/failed`, re-fetch worklogs
    - Header → `onOpenSettings` opens drawer; Header → `onLogout` proxies to prop
    - Skip the worklogs fetch when credentials are incomplete (banner is shown instead)
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 5.7, 5.8, 9.6, 10.1, 11.1, 12.2, 13.1, 14.3, 14.4, 14.5, 14.6, 15.5, 15.6, 15.7, 16.3, 16.4_

  - [ ]* 8.2 Write component test for Workspace mount and refresh wiring
    - File: `src/lib/pages/Workspace.test.ts`
    - Mount with stub props; mock `loadRecentIssues`, `loadWorkspaceSettings`, `invoke('get_my_worklogs')`; assert four panels render, drawer toggles, `onSelectDate` prefills QuickLogCard date
    - _Requirements: 1.1, 5.7, 16.3, 16.4_

  - [ ]* 8.3 Write property test for sync-completion refresh behavior
    - **Property 22: Sync completion always triggers a refresh**
    - **Validates: Requirements 15.6**
    - File: `src/lib/pages/Workspace.test.ts`
    - Arb `{synced: nat, failed: nat}` results; assert `refreshSeq` increments by exactly 1 after each callback


- [x] 9. Checkpoint - Workspace shell complete
  - Ensure all tests pass, ask the user if questions arise.

- [x] 10. Wire `App.svelte` to the new Workspace and remove legacy UI
  - [x] 10.1 Modify `src/App.svelte` to render `Workspace` when authenticated
    - Remove imports of `./lib/pages/Calendar.svelte` and `./lib/pages/Settings.svelte`
    - Add `import Workspace from "./lib/pages/Workspace.svelte"`
    - Remove the tab navigation, `currentPage` state, `pendingCount`/`online` UI in the authenticated branch, and the existing logout button (delegated to Workspace's avatar dropdown)
    - When `authPhase === 'authenticated'` render `<Workspace displayName={...} email={credentials.email} onLogout={onLogout} />` only
    - Keep the existing `initAuth`, `handleAuthenticated`, `onLogout`, and 30s background-sync `$effect` intact
    - Keep `Login` rendered for `loading`/`unauthenticated`
    - Resolve a `displayName` to pass: derive from `credentials.email` (split before `@`) when no separate display name is available, or expose from `authStore` if already cached
    - _Requirements: 16.1, 16.2, 16.3, 16.4, 16.5_

  - [ ]* 10.2 Write smoke test asserting `App.svelte` does not import legacy pages
    - File: `src/App.smoke.test.ts`
    - Use Node `fs` to read `src/App.svelte`, assert it does NOT contain `Calendar.svelte` or `Settings.svelte` import strings, and DOES contain `Workspace.svelte` import
    - _Requirements: 16.1, 16.5_

- [x] 11. Delete legacy components and verify removal
  - [x] 11.1 Delete legacy source files
    - Delete `src/lib/pages/Calendar.svelte`
    - Delete `src/lib/pages/Settings.svelte`
    - Delete `src/lib/components/CalendarGrid.svelte`
    - Delete `src/lib/components/LogworkModal.svelte`
    - Delete `src/lib/components/ActivityPanel.svelte`
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_

  - [ ]* 11.2 Write smoke tests for legacy file absence and forbidden imports
    - File: `src/legacy.smoke.test.ts`
    - Use Node `fs` to assert each of the five files above does not exist
    - Recursively scan `src/` and assert no occurrence of `check_activitywatch`, `get_aw_buckets`, `get_aw_events`
    - _Requirements: 2.1–2.7_

  - [ ]* 11.3 Write smoke test for CSS token compliance
    - File: `src/styles.smoke.test.ts`
    - Read `src/app.css`; assert `--glass-blur` numeric value ≥ 16, glass-border opacity in [0.08, 0.20], and a focus-ring rule distinct from hover transitions ≤ 250ms
    - _Requirements: 11.2, 11.3, 11.4_

- [x] 12. Final checkpoint - Build, lint, and full test suite
  - Run `npm run build` to confirm Svelte/TypeScript compilation succeeds
  - Run `npm run test` to confirm vitest suite passes
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP. They cover property tests, component-level keyboard tests, and smoke checks.
- Each task references specific requirements (Rx.y) for traceability; property test sub-tasks additionally annotate the property number from the design.
- Pure stores in section 2 are implementation-language-only TypeScript and have no Svelte dependency, so they can be implemented and tested in parallel with leaf component work.
- The `SettingsDrawer` is intentionally placed in section 6 (composite) because it embeds the existing `CredentialForm.svelte` and depends on `settingsStore` and the validation functions from `quickLogReducer.ts`.
- The Workspace shell (section 8) is the only component that needs to be implemented after all leaf and composite components, so it is given its own phase with a checkpoint before and after.
- App.svelte modifications (section 10) come before legacy file deletion (section 11) so the build keeps compiling at every step (App.svelte must drop the imports before the files vanish).
- The 24 design properties map to 19 distinct property test sub-tasks; some properties are split (e.g. Property 24 covers both `UserAvatarDropdown` and `SettingsDrawer`) and a few covering UI-only behavior are tested via component tests rather than fast-check (Property 6).

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2"] },
    { "id": 1, "tasks": ["2.1", "2.4", "2.8", "2.11", "2.15"] },
    { "id": 2, "tasks": ["2.2", "2.5", "2.9", "2.12", "2.16", "4.1", "4.3", "4.5", "4.6", "4.7"] },
    { "id": 3, "tasks": ["2.3", "2.6", "2.10", "2.13", "2.17", "4.2", "4.4", "4.8", "4.9", "6.1", "6.4", "6.6", "6.10"] },
    { "id": 4, "tasks": ["2.7", "2.14", "2.18", "6.2", "6.5", "6.11", "6.7"] },
    { "id": 5, "tasks": ["2.19", "6.3", "6.12", "6.8", "8.1"] },
    { "id": 6, "tasks": ["2.20", "6.9", "8.2", "10.1"] },
    { "id": 7, "tasks": ["8.3", "10.2", "11.1"] },
    { "id": 8, "tasks": ["11.2", "11.3"] }
  ]
}
```
