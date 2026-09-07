# Requirements Document

## Introduction

This feature replaces the existing post-login workspace UI of the JIRA Logwork desktop application (Svelte 5 + Tauri 2) with a single-page, animated workspace centered on a Quick Log Card. The current tabbed navigation (Calendar / Settings), the modal-based logwork form, the ActivityWatch integration, and the existing month-grid calendar are removed in their entirety. The new workspace presents a heatmap-style calendar, a persistent Quick Log Card with universal issue search, time preset chips, and recent-issue caching, plus a weekly summary widget. Settings move into a drawer triggered from a user avatar dropdown in a compact header. The visual language reuses the existing AnimatedBackground component and glass-morphism styling from the login page, with smooth transitions, micro-interactions, animated counters, and skeleton loaders. No backend changes are required: all data flows through existing Tauri commands (`test_connection`, `get_my_worklogs`, `get_projects`, `search_issues`, `add_worklog`).

## Glossary

- **Workspace**: The single-page UI shown after successful authentication, replacing the previous tabbed Calendar/Settings layout.
- **Workspace_Shell**: The top-level Svelte component that composes the Header, Heatmap_Calendar, Quick_Log_Card, Weekly_Summary, and Settings_Drawer, and renders the AnimatedBackground.
- **Header**: The compact top bar of the Workspace containing the application logo, current date, and the User_Avatar_Dropdown.
- **User_Avatar_Dropdown**: The avatar control in the Header that, when activated, exposes entries for opening the Settings_Drawer and for logging out.
- **Settings_Drawer**: The slide-in panel (drawer or modal) containing the Jira connection form, daily reminder settings, and target hours setting, replacing the previous Settings page.
- **Heatmap_Calendar**: The GitHub-contributions-style calendar component that renders one cell per day, colored by intensity based on hours logged that day.
- **Quick_Log_Card**: The persistent card on the workspace that allows the user to log work, containing the Recent_Issues_List, Universal_Search, Time_Preset_Chips, an optional Description_Field, and a Submit_Button.
- **Recent_Issues_List**: The locally cached list of the user's most recently logged-to issues (size 5 to 10), displayed in the Quick_Log_Card for one-click selection.
- **Recent_Issues_Cache**: The persistent local store, keyed by user email, that backs the Recent_Issues_List.
- **Universal_Search**: The single search input in the Quick_Log_Card that accepts an issue key or summary text and returns matching issues without requiring a project to be selected first.
- **Time_Preset_Chips**: The set of selectable hour-amount chips in the Quick_Log_Card with values 0.5, 1, 2, 4, and 8 hours.
- **Description_Field**: The optional multi-line text input in the Quick_Log_Card for the worklog comment.
- **Submit_Button**: The control in the Quick_Log_Card that submits the worklog via the `add_worklog` Tauri command.
- **Weekly_Summary**: The widget that displays total hours logged in the current ISO week, the configured weekly target (Target_Hours x 5), and progress toward that target.
- **Target_Hours**: The user-configured daily target hours value (default 8) stored in `settings.json`.
- **Animated_Background**: The existing `AnimatedBackground.svelte` component reused on the Workspace.
- **Glass_Style**: The visual style used on the login page, characterized by translucent backgrounds, backdrop-filter blur, soft borders, and indigo/violet accent gradients.
- **Skeleton_Loader**: A placeholder UI that mimics the shape of content being loaded, shown in place of spinners while data is fetched.
- **Animated_Counter**: A numeric display that transitions smoothly between values when its target changes.
- **Reduced_Motion_Mode**: The state in which the operating system reports `prefers-reduced-motion: reduce`; in this mode, decorative animations are disabled.
- **Tauri_Store_Settings**: The `settings.json` Tauri store containing `baseUrl`, `email`, `apiToken`, `isCloud`, `reminderEnabled`, `reminderHour`, and `targetHours`.

## Requirements

### Requirement 1: Single-Page Workspace Replacing Tab Navigation

**User Story:** As an authenticated user, I want a single-page workspace with no tab navigation, so that I can see my calendar and log work without switching pages.

#### Acceptance Criteria

1. WHEN the application enters the authenticated state, THE Workspace_Shell SHALL render the Header, the Heatmap_Calendar, the Quick_Log_Card, and the Weekly_Summary on a single page.
2. THE Workspace_Shell SHALL render the Animated_Background as the page backdrop using the existing `AnimatedBackground.svelte` component.
3. THE Workspace_Shell SHALL apply the Glass_Style to the Header, the Heatmap_Calendar container, the Quick_Log_Card, the Weekly_Summary, and the Settings_Drawer.
4. WHEN the application is in the unauthenticated state, THE Workspace_Shell SHALL NOT be rendered.

### Requirement 2: Removal of Legacy Components

**User Story:** As a developer, I want the legacy post-login components removed, so that the codebase reflects the new single-page workspace design.

#### Acceptance Criteria

1. THE source tree SHALL NOT contain the file `src/lib/pages/Calendar.svelte`.
2. THE source tree SHALL NOT contain the file `src/lib/pages/Settings.svelte`.
3. THE source tree SHALL NOT contain the file `src/lib/components/CalendarGrid.svelte`.
4. THE source tree SHALL NOT contain the file `src/lib/components/LogworkModal.svelte`.
5. THE source tree SHALL NOT contain the file `src/lib/components/ActivityPanel.svelte`.
6. THE Workspace_Shell SHALL NOT import any module from `@tauri-apps/api` that targets ActivityWatch commands (for example `check_activitywatch`, `get_aw_buckets`, `get_aw_events`).
7. THE Workspace_Shell SHALL NOT render any UI element labeled or functioning as an activity suggestion or drag-and-drop source for activities.

### Requirement 3: Header and User Avatar Dropdown

**User Story:** As a user, I want a compact header with my avatar, so that I can access settings and logout from a single menu.

#### Acceptance Criteria

1. THE Header SHALL display the application logo, the application name "JIRA Logwork", the current date formatted as the user's locale long date, and the User_Avatar_Dropdown.
2. THE User_Avatar_Dropdown SHALL display the initial of the authenticated user's display name or email when no avatar image is available.
3. WHEN the user activates the User_Avatar_Dropdown, THE User_Avatar_Dropdown SHALL display a menu containing exactly two entries: "Settings" and "Logout".
4. WHEN the user selects the "Settings" entry, THE Workspace_Shell SHALL open the Settings_Drawer and SHALL NOT alter the application's authentication state.
5. WHEN the user selects the "Logout" entry, THE Workspace_Shell SHALL invoke the existing `logout` function from `authStore.ts` and SHALL transition the application to the unauthenticated state regardless of whether the `logout` function resolves successfully or throws an error.
6. WHEN focus moves outside the User_Avatar_Dropdown menu or the user presses the Escape key, THE User_Avatar_Dropdown SHALL close the menu.
7. THE User_Avatar_Dropdown SHALL be reachable via keyboard Tab navigation and activatable with the Enter or Space key.

### Requirement 4: Settings Drawer

**User Story:** As a user, I want settings in a drawer overlay, so that I can adjust them without leaving the workspace.

#### Acceptance Criteria

1. WHEN the Settings_Drawer is opened, THE Settings_Drawer SHALL display three sections: "Jira Connection", "Reminder", and "Target Hours".
2. THE "Jira Connection" section SHALL contain inputs for `baseUrl`, `email`, `apiToken`, a Cloud/Server toggle bound to `isCloud`, and a "Test Connection & Save" button that invokes the `test_connection` Tauri command and persists all four values to Tauri_Store_Settings on success.
3. THE "Reminder" section SHALL contain a checkbox bound to `reminderEnabled` and a numeric input bound to `reminderHour`.
4. THE "Target Hours" section SHALL contain a numeric input bound to `targetHours`.
5. WHEN the user clicks the "Save" control of the Settings_Drawer, THE Settings_Drawer SHALL validate that `reminderHour` is an integer between 8 and 22 inclusive and that `targetHours` is between 1 and 12 inclusive in 0.5 increments.
6. IF validation in the Settings_Drawer fails on save, THEN THE Settings_Drawer SHALL display inline error messages on the offending fields and SHALL NOT persist any value to Tauri_Store_Settings during that save action.
7. WHEN validation in the Settings_Drawer succeeds on save, THE Settings_Drawer SHALL persist `reminderEnabled`, `reminderHour`, and `targetHours` to Tauri_Store_Settings.
8. WHEN the user clicks outside the Settings_Drawer panel or presses Escape, THE Workspace_Shell SHALL close the Settings_Drawer.
9. WHEN the Settings_Drawer is open, THE Settings_Drawer SHALL trap keyboard focus within its panel until it is closed.
10. THE Settings_Drawer SHALL animate in and out with a transition lasting between 150 ms and 350 ms inclusive.
11. WHILE Reduced_Motion_Mode is active, THE Settings_Drawer SHALL appear and disappear without translation or scaling animations.

### Requirement 5: Heatmap Calendar

**User Story:** As a user, I want a heatmap-style calendar of my logged hours, so that I can see my logging patterns at a glance.

#### Acceptance Criteria

1. THE Heatmap_Calendar SHALL render one cell per calendar day for the displayed range, with each cell labeled by its day-of-month number for the first day of each week and on hover.
2. THE Heatmap_Calendar SHALL color each cell based on the hours logged that day using exactly five intensity levels: level 0 for 0 hours, level 1 for greater than 0 and less than 2 hours, level 2 for at least 2 and less than 4 hours, level 3 for at least 4 and less than 8 hours, and level 4 for 8 or more hours.
3. THE Heatmap_Calendar SHALL display the most recent 12 weeks of data by default, ending on the current week.
4. WHEN the Heatmap_Calendar is loading data, THE Heatmap_Calendar SHALL render a Skeleton_Loader instead of cells.
5. WHEN the user hovers a cell, THE Heatmap_Calendar SHALL display a tooltip containing the date in the user's locale and the total hours logged that day formatted to one decimal place.
6. WHEN the user clicks a cell, THE Heatmap_Calendar SHALL emit a `selectDate` event with the cell's date in `YYYY-MM-DD` format.
7. WHEN the Workspace_Shell receives a `selectDate` event, THE Workspace_Shell SHALL prefill the Quick_Log_Card's target date with the selected date.
8. THE Heatmap_Calendar SHALL fetch worklog data via the `get_my_worklogs` Tauri command using the credentials from Tauri_Store_Settings, with `startDate` set to the first day of the earliest displayed week and `endDate` set to the last day of the latest displayed week.
9. THE Heatmap_Calendar SHALL filter the worklog response to entries whose `author.emailAddress` matches the configured `email` from Tauri_Store_Settings, case-insensitively.
10. WHEN the user changes the displayed range using the Heatmap_Calendar's range controls, THE Heatmap_Calendar SHALL re-fetch data covering the new range.

### Requirement 6: Quick Log Card - Recent Issues

**User Story:** As a user, I want a list of issues I recently logged to, so that I can quickly select a frequent target without searching.

#### Acceptance Criteria

1. THE Quick_Log_Card SHALL display the Recent_Issues_List as the primary issue selector when at least one entry exists in the Recent_Issues_Cache.
2. THE Recent_Issues_List SHALL display at most 10 entries and at least 1 entry when the Recent_Issues_Cache is non-empty.
3. THE Recent_Issues_List SHALL display each entry's issue key and summary, sorted by most-recent-use first.
4. WHEN the user clicks an entry in the Recent_Issues_List, THE Quick_Log_Card SHALL set the selected issue to that entry and visually mark the entry as selected.
5. WHEN a worklog is successfully submitted via the Quick_Log_Card, THE Workspace_Shell SHALL upsert the submitted issue into the Recent_Issues_Cache, set its timestamp to the current time, and trim the cache to retain only the 10 most recently used entries.
6. THE Recent_Issues_Cache SHALL persist across application restarts using a Tauri store keyed by the user's `email`.
7. IF the Recent_Issues_Cache is empty, THEN THE Quick_Log_Card SHALL display a placeholder message instructing the user to use the Universal_Search.

### Requirement 7: Quick Log Card - Universal Search

**User Story:** As a user, I want one search field that finds issues by key or summary, so that I do not have to pick a project first.

#### Acceptance Criteria

1. THE Quick_Log_Card SHALL provide a single search input that accepts a free-text query and SHALL NOT require a project to be selected before searching.
2. WHEN the user types a query of length 2 or more characters into the Universal_Search, THE Universal_Search SHALL invoke the `search_issues` Tauri command after a debounce interval of 300 ms with no further keystrokes, passing an empty string for `projectKey`.
3. IF the `search_issues` Tauri command rejects an empty `projectKey`, THEN after the 300 ms debounce interval has elapsed THE Universal_Search SHALL invoke `search_issues` once per project returned by `get_projects`, merge the results, and de-duplicate by issue key.
4. THE Universal_Search SHALL match queries that look like an issue key (matching the regex `^[A-Z][A-Z0-9_]+-\d+$` case-insensitively) by querying for that exact key in addition to the text search.
5. THE Universal_Search SHALL display search results in a list directly below the input, showing each result's issue key and summary, with a maximum of 20 visible results.
6. WHILE a search request is in flight, THE Universal_Search SHALL render a Skeleton_Loader inline below the input.
7. WHEN the user clicks a search result, THE Quick_Log_Card SHALL set the selected issue to that result and clear the Universal_Search query.
8. IF the `search_issues` Tauri command returns an error, THEN THE Universal_Search SHALL display an inline error message describing the failure and SHALL NOT clear the user's query.
9. WHEN the user clears the Universal_Search input, THE Universal_Search SHALL hide the search-results list.

### Requirement 8: Quick Log Card - Time Preset Chips and Description

**User Story:** As a user, I want one-tap time presets and an optional description, so that common entries take three seconds.

#### Acceptance Criteria

1. THE Time_Preset_Chips SHALL render exactly five chips with values of 0.5, 1, 2, 4, and 8 hours.
2. WHEN the user clicks a chip in the Time_Preset_Chips, THE Quick_Log_Card SHALL set the worklog hours to the chip's value and visually mark that chip as selected while unmarking the others.
3. THE Quick_Log_Card SHALL provide a custom hours input that accepts values from 0.25 to 24 inclusive in 0.25 increments.
4. WHEN the user enters a value into the custom hours input, THE Quick_Log_Card SHALL clear all selected chips in Time_Preset_Chips.
5. THE Description_Field SHALL be a multi-line textarea labeled "Description (optional)" with a maximum of 500 characters.
6. THE Quick_Log_Card SHALL submit successfully when the Description_Field is empty.
7. WHEN the Quick_Log_Card is first rendered, THE Time_Preset_Chips SHALL select the chip with value 1 hour by default.

### Requirement 9: Quick Log Card - Submission

**User Story:** As a user, I want to submit a worklog with one click, so that logging time is fast.

#### Acceptance Criteria

1. THE Submit_Button SHALL be enabled when an issue is selected and the worklog hours value is greater than 0.
2. THE Submit_Button SHALL be disabled when no issue is selected or when the worklog hours value is 0 or less.
3. WHEN the user clicks the Submit_Button, THE Quick_Log_Card SHALL invoke the `add_worklog` Tauri command with `issueKey` set to the selected issue's key, `timeSpentSeconds` set to `Math.round(hours * 3600)`, `started` set to the selected date concatenated with `T09:00:00.000+0000`, and `comment` set to the Description_Field value.
4. WHILE the `add_worklog` Tauri command is in flight, THE Submit_Button SHALL display a loading state and SHALL be disabled.
5. WHEN the `add_worklog` Tauri command succeeds, THE Quick_Log_Card SHALL display a success state for between 1500 ms and 2500 ms inclusive, clear the Description_Field, reset the Time_Preset_Chips to the default 1 hour selection, and emit a `worklogSubmitted` event with the issue key, hours, and date.
6. WHEN the Workspace_Shell receives a `worklogSubmitted` event, THE Workspace_Shell SHALL trigger a refresh of the Heatmap_Calendar data and the Weekly_Summary value.
7. IF the `add_worklog` Tauri command returns an error, THEN THE Quick_Log_Card SHALL display an inline error message describing the failure and SHALL retain the user's selected issue, hours, and description.
8. THE Quick_Log_Card SHALL default the worklog target date to the current local date when no date has been selected from the Heatmap_Calendar.

### Requirement 10: Weekly Summary

**User Story:** As a user, I want to see hours logged this week against my target, so that I know if I am on track.

#### Acceptance Criteria

1. THE Weekly_Summary SHALL display the total hours logged in the current ISO week formatted to one decimal place.
2. THE Weekly_Summary SHALL display the weekly target as `Target_Hours * 5` formatted to one decimal place.
3. THE Weekly_Summary SHALL display a progress indicator showing the ratio of total hours logged to weekly target, clamped to the range 0 to 1 inclusive.
4. WHEN the displayed total hours value changes, THE Weekly_Summary SHALL animate the displayed total using an Animated_Counter with a transition duration between 200 ms and 800 ms inclusive.
5. WHILE the Weekly_Summary is loading data, THE Weekly_Summary SHALL render a Skeleton_Loader.
6. WHILE Reduced_Motion_Mode is active, THE Animated_Counter SHALL update displayed values without intermediate frames.

### Requirement 11: Animations and Visual Style

**User Story:** As a user, I want a modern, animated UI consistent with the login page, so that the application feels polished.

#### Acceptance Criteria

1. THE Workspace_Shell SHALL render the Animated_Background using the existing `src/lib/components/AnimatedBackground.svelte` component without modification to that component's source.
2. THE Quick_Log_Card, the Heatmap_Calendar container, the Header, the Weekly_Summary, and the Settings_Drawer SHALL each use a translucent background with a backdrop-filter blur of at least 16 pixels and a 1-pixel border with opacity between 8 and 20 percent.
3. WHEN an interactive element (button, chip, recent-issue entry, search result, calendar cell) is hovered with a pointer device, THE interactive element SHALL apply a visible hover state that completes its transition within 250 ms.
4. WHEN an interactive element is focused via keyboard, THE interactive element SHALL display a focus ring distinct from its hover state.
5. WHILE Reduced_Motion_Mode is active, THE Workspace_Shell SHALL disable decorative orb animations, the Animated_Counter intermediate frames, and the Settings_Drawer slide animation.
6. THE Workspace_Shell SHALL use loading skeletons in place of spinning indicators for the Heatmap_Calendar, the Universal_Search results, the Recent_Issues_List initial load, and the Weekly_Summary.

### Requirement 12: Three-Second Quick Log Performance

**User Story:** As a user logging to the same issue often, I want to submit a worklog in under three seconds, so that logging does not interrupt my work.

#### Acceptance Criteria

1. WHEN the Recent_Issues_Cache contains at least one entry and the user clicks a Recent_Issues_List entry, then clicks a chip in Time_Preset_Chips, then clicks the Submit_Button, THE Quick_Log_Card SHALL invoke the `add_worklog` Tauri command within 3000 ms of the first click measured locally, excluding network round-trip time.
2. THE Workspace_Shell SHALL preload the Recent_Issues_Cache before the Quick_Log_Card's interactive elements are enabled.
3. THE Quick_Log_Card SHALL render its initial UI (Recent_Issues_List, Universal_Search input, Time_Preset_Chips, Description_Field, Submit_Button) within 520 ms of the Workspace_Shell mounting, measured from `mount` start to first paint of the card, excluding the initial network fetch for projects or worklogs.

### Requirement 13: Accessibility

**User Story:** As a user relying on keyboard or assistive technology, I want the workspace to be operable without a pointer, so that I can use the application.

#### Acceptance Criteria

1. THE Workspace_Shell SHALL expose a logical Tab order: Header logo, User_Avatar_Dropdown, Heatmap_Calendar range controls, Heatmap_Calendar cells (week-by-week), Recent_Issues_List entries, Universal_Search input, Universal_Search results, Time_Preset_Chips, Description_Field, Submit_Button.
2. WHEN the Settings_Drawer is open, THE Settings_Drawer SHALL trap focus within its panel.
3. WHILE the User_Avatar_Dropdown menu is open, THE User_Avatar_Dropdown SHALL accept Up Arrow and Down Arrow keys to move between menu items and the Escape key to close.
4. THE User_Avatar_Dropdown SHALL NOT open the menu until its keyboard navigation handlers (arrow keys and Escape) are registered.
5. THE Time_Preset_Chips SHALL be implemented as a radio group with `role="radiogroup"` and arrow-key navigation between chips.
6. THE Heatmap_Calendar SHALL provide an `aria-label` on each cell containing the date and hours logged.
7. THE Quick_Log_Card SHALL associate the Description_Field, the custom hours input, and the Universal_Search input with visible labels via `for`/`id` or `aria-labelledby`.
8. THE Workspace_Shell SHALL maintain a contrast ratio of at least 4.5 to 1 for body text against its translucent background.

### Requirement 14: Persistence and Caching

**User Story:** As a user, I want recent issues and settings to persist across sessions, so that I do not lose my context.

#### Acceptance Criteria

1. THE Recent_Issues_Cache SHALL be stored in the Tauri store named `recent-issues.json` under a key equal to the lowercased `email` from Tauri_Store_Settings.
2. THE Recent_Issues_Cache entry SHALL contain `issueKey`, `summary`, and `lastUsedAt` (ISO 8601 timestamp string) for each issue.
3. WHEN the Workspace_Shell mounts, THE Workspace_Shell SHALL load the Recent_Issues_Cache for the current user before enabling the Quick_Log_Card's Submit_Button.
4. IF loading the Recent_Issues_Cache fails (for example due to file corruption or insufficient permissions), THEN THE Quick_Log_Card's Submit_Button SHALL remain disabled and THE Workspace_Shell SHALL display an inline error message describing the failure.
5. WHEN the user logs out, THE Workspace_Shell SHALL NOT delete the Recent_Issues_Cache.
6. THE Workspace_Shell SHALL continue to use the existing Tauri_Store_Settings file (`settings.json`) for credentials and preferences without changing existing key names.

### Requirement 15: Error Handling and Offline Behavior

**User Story:** As a user, I want clear feedback when actions fail, so that I know what to do next.

#### Acceptance Criteria

1. IF the `get_my_worklogs` Tauri command returns an error during Heatmap_Calendar fetch, THEN THE Heatmap_Calendar SHALL display an inline error message and a "Retry" button that re-invokes the fetch.
2. IF the `add_worklog` Tauri command returns a network error, THEN THE Quick_Log_Card SHALL enqueue the worklog using the existing `addPendingWorklog` function from `offlineStore.ts`.
3. WHEN the `addPendingWorklog` enqueue operation succeeds, THE Quick_Log_Card SHALL display a "Queued for sync" confirmation.
4. IF the `addPendingWorklog` enqueue operation fails, THEN THE Quick_Log_Card SHALL display an inline error message describing the failure and SHALL NOT display a "Queued for sync" confirmation.
5. WHEN a worklog is enqueued for offline sync, THE Workspace_Shell SHALL upsert the issue into the Recent_Issues_Cache.
6. WHEN the existing background sync from `offlineStore.ts` completes a sync cycle, THE Workspace_Shell SHALL refresh the Heatmap_Calendar and Weekly_Summary regardless of whether the sync cycle reported successes, failures, or both.
7. IF Tauri_Store_Settings does not contain a complete set of credentials, THEN THE Workspace_Shell SHALL display a non-blocking banner prompting the user to open the Settings_Drawer to complete connection setup.

### Requirement 16: Application Shell Integration

**User Story:** As a developer, I want `App.svelte` to delegate the post-login UI to the new Workspace_Shell, so that the application boots into the new design.

#### Acceptance Criteria

1. THE file `src/App.svelte` SHALL import the Workspace_Shell from `src/lib/pages/Workspace.svelte`.
2. WHEN the application's auth phase is `authenticated`, THE file `src/App.svelte` SHALL render the Workspace_Shell and SHALL NOT render any tab navigation, Calendar page, or Settings page.
3. THE Workspace_Shell SHALL receive the authenticated user's display name and email from `App.svelte` via component props.
4. THE Workspace_Shell SHALL invoke a callback prop (for example `onLogout`) provided by `App.svelte` to perform logout, instead of re-implementing logout state transitions internally.
5. THE file `src/App.svelte` SHALL NOT import `Calendar.svelte` or `Settings.svelte`.
