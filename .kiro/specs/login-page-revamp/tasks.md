# Implementation Plan: Login Page Revamp

## Overview

This plan implements a dedicated login page for the JIRA Logwork desktop app. The approach starts with the pure logic layer (authStore, validation, error classification), then builds UI components (AnimatedBackground, CredentialForm, Login page), and finally wires everything into App.svelte with auth state gating and logout. Property-based tests validate correctness properties using fast-check.

## Tasks

- [x] 1. Create authStore with credential persistence and validation logic
  - [x] 1.1 Create `src/lib/stores/authStore.ts` with types, validation functions, and credential persistence
    - Define `AuthPhase`, `AuthState`, `Credentials`, `AuthError`, `ValidationResult` types
    - Implement `isCredentialComplete(creds)`: returns true only if all three fields are non-empty after trimming
    - Implement `validateUrl(url)`: returns invalid if URL does not start with "https://"
    - Implement `validateEmail(email)`: returns invalid if email lacks valid format (chars@chars.chars)
    - Implement `isFormSubmittable(creds)`: returns true only if all fields are non-whitespace-only
    - Implement `classifyError(error)`: categorize errors into "auth", "network", "timeout", or "unknown" based on error string patterns
    - Implement `loadCredentials()`: read baseUrl, email, apiToken from settings.json via tauri-plugin-store, return empty strings on failure
    - Implement `saveCredentials(creds)`: write all three fields to settings.json
    - Implement `authenticate(creds)`: invoke `test_connection` with 30s timeout via `Promise.race`
    - Implement `logout()`: clear apiToken from settings.json while retaining baseUrl and email
    - Export reactive auth state using Svelte 5 `$state` rune
    - _Requirements: 1.1, 3.5, 3.6, 3.7, 4.1, 4.2, 4.4, 4.5, 5.1, 5.4, 6.1, 6.2, 6.5, 7.4, 8.2_

  - [ ]* 1.2 Write property tests for validation functions (Properties 2, 3, 4)
    - Install fast-check as a dev dependency
    - Create `src/lib/stores/__tests__/authStore.property.test.ts`
    - **Property 2: Form validation disables submission for incomplete input**
    - **Property 3: URL validation rejects non-HTTPS URLs**
    - **Property 4: Email validation rejects invalid formats**
    - **Validates: Requirements 3.5, 3.6, 3.7, 4.3**

  - [ ]* 1.3 Write property tests for credential completeness (Property 1)
    - **Property 1: Credential completeness determines authentication requirement**
    - **Validates: Requirements 1.1**

  - [ ]* 1.4 Write property tests for error classification (Property 7)
    - **Property 7: Error classification is exhaustive and correct**
    - **Validates: Requirements 6.1, 6.2, 6.5**

  - [ ]* 1.5 Write property tests for credential persistence round-trip (Property 5)
    - **Property 5: Credential persistence round-trip**
    - Mock tauri-plugin-store for in-memory round-trip testing
    - **Validates: Requirements 4.1, 4.2**

  - [ ]* 1.6 Write property tests for partial credential loading (Property 6)
    - **Property 6: Partial credential loading preserves available fields**
    - **Validates: Requirements 4.4, 7.2**

- [x] 2. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 3. Implement AnimatedBackground component
  - [x] 3.1 Create `src/lib/components/AnimatedBackground.svelte`
    - Implement full-viewport CSS/SVG animated background (gradient orbs or floating shapes)
    - Use `@media (prefers-reduced-motion: reduce)` to disable animations and show static background
    - Ensure animations are GPU-accelerated (transform/opacity only) for 30+ fps
    - Provide sufficient contrast behind form content (dark overlay or blur layer)
    - No external asset downloads — pure CSS/SVG
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_

- [x] 4. Implement CredentialForm component
  - [x] 4.1 Create `src/lib/components/CredentialForm.svelte`
    - Accept props: `credentials`, `isLoading`, `error`, `welcomeEmail`, `onSubmit`
    - Render labeled input for Jira URL (type="url", placeholder "https://company.atlassian.net")
    - Render labeled input for Email (type="email", placeholder "user@company.com")
    - Render labeled input for API Token (type="password", masked)
    - Render Login button, disabled when `isFormSubmittable` returns false or `isLoading` is true
    - On submit: run `validateUrl` and `validateEmail`, show inline errors if invalid, otherwise call `onSubmit`
    - Display `error` message with appropriate styling based on error type
    - Display welcome message with stored email when `welcomeEmail` is provided
    - Show loading indicator when `isLoading` is true
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 5.2, 6.3, 6.4, 7.1_

  - [ ]* 4.2 Write property test for form state preservation after failure (Property 8)
    - **Property 8: Form state preservation after authentication failure**
    - **Validates: Requirements 6.3**

  - [ ]* 4.3 Write property test for welcome message containing email (Property 9)
    - **Property 9: Welcome message contains stored email**
    - **Validates: Requirements 7.1**

- [x] 5. Implement Login page
  - [x] 5.1 Create `src/lib/pages/Login.svelte`
    - Compose `AnimatedBackground` and `CredentialForm` into a full-screen login page
    - Manage local auth flow: loading state, call `authenticate` from authStore on form submit
    - On success: display authenticated user display name for 2 seconds, then signal transition
    - On failure: pass classified error to CredentialForm, preserve form values
    - On auth error with pre-populated credentials: clear API token field, retain URL and email
    - Show loading state while credential store is being checked on startup
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 5.1, 5.2, 5.3, 5.4, 6.1, 6.2, 6.3, 6.4, 6.5, 7.1, 7.2, 7.3, 7.4_

  - [ ]* 5.2 Write property test for auth failure clearing only API token (Property 10)
    - **Property 10: Authentication failure clears only the API token**
    - **Validates: Requirements 7.4**

- [x] 6. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 7. Wire auth state into App.svelte and implement logout
  - [x] 7.1 Modify `src/App.svelte` to gate rendering on auth state
    - Import and use authStore reactive state
    - On startup: call `loadCredentials()`, show Login page while phase is "loading" or "unauthenticated"
    - When phase is "authenticated": render existing App Shell (nav + pages)
    - When phase transitions from "authenticated" to "unauthenticated" (logout): render Login page
    - Remove credential-related logic from Settings page (auth is now handled by Login)
    - _Requirements: 1.1, 1.2, 1.3, 5.3_

  - [x] 7.2 Add logout button to App Shell navigation in `src/App.svelte`
    - Add a logout button/icon in the nav bar (right side, near online indicator)
    - On click: call `logout()` from authStore, which clears API token and transitions to Login page
    - Handle store write failure gracefully: still navigate to Login, show warning if token could not be cleared
    - _Requirements: 8.1, 8.2, 8.3, 8.4_

  - [ ]* 7.3 Write property test for logout clearing only API token (Property 11)
    - **Property 11: Logout clears only the API token**
    - **Validates: Requirements 8.2**

- [x] 8. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document using fast-check
- Unit tests validate specific examples and edge cases
- The existing `test_connection` Tauri command is reused — no Rust changes needed
- Credential store keys (`baseUrl`, `email`, `apiToken`) match the existing Settings page schema

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "1.3", "1.4", "1.5", "1.6", "3.1"] },
    { "id": 2, "tasks": ["4.1"] },
    { "id": 3, "tasks": ["4.2", "4.3", "5.1"] },
    { "id": 4, "tasks": ["5.2", "7.1"] },
    { "id": 5, "tasks": ["7.2"] },
    { "id": 6, "tasks": ["7.3"] }
  ]
}
```
