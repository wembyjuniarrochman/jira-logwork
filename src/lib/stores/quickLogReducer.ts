// src/lib/stores/quickLogReducer.ts
//
// Pure (no Tauri, no Svelte, no side effects) helpers powering QuickLogCard.
//
// Mirrors the design's Property 14 (canSubmit), Property 15 (chip group radio
// invariants), Property 16 (custom hours / description validators), Property 17
// (avatar initial derivation), and Property 20 (credentials banner visibility).

import { isCredentialComplete, type Credentials } from "./authStore";

// --- Types ---

export type SubmitState = "idle" | "submitting" | "success" | "error" | "queued";

export type ChipValue = 0.5 | 1 | 2 | 4 | 8;

export interface SelectedIssue {
  key: string;
  summary: string;
}

export interface CanSubmitArgs {
  recentIssuesReady: boolean;
  selectedIssue: SelectedIssue | null;
  effectiveHours: number;
  submitState: SubmitState;
}

export interface ChipState {
  chipHours: ChipValue | null;
  customHours: number | null;
}

export type ChipAction =
  | { type: "chipClick"; value: ChipValue }
  | { type: "customHours"; value: number | null };

// --- canSubmit (Property 14) ---

/**
 * Pure: Submit is allowed iff recent-issues cache is ready, an issue is
 * selected, hours > 0, and we are not already submitting.
 */
export function canSubmit({
  recentIssuesReady,
  selectedIssue,
  effectiveHours,
  submitState,
}: CanSubmitArgs): boolean {
  return (
    recentIssuesReady === true &&
    selectedIssue !== null &&
    effectiveHours > 0 &&
    submitState !== "submitting"
  );
}

// --- chipReducer (Property 15) ---

/**
 * Pure: maintains the single-selection radio invariant for the time-preset
 * chip group plus the mutually-exclusive custom-hours input.
 *
 * - `chipClick(value)`: selects the chip and clears any custom-hours value.
 * - `customHours(value)`:
 *   - `null`        → clears the custom value, leaves chip selection intact.
 *   - valid number  → sets the custom value and clears any chip selection.
 *   - invalid value → returns state unchanged (so partial typing does not
 *     accidentally deselect a chip).
 */
export function chipReducer(state: ChipState, action: ChipAction): ChipState {
  switch (action.type) {
    case "chipClick":
      return { chipHours: action.value, customHours: null };
    case "customHours": {
      if (action.value === null) {
        return { chipHours: state.chipHours, customHours: null };
      }
      if (isValidCustomHours(action.value)) {
        return { chipHours: null, customHours: action.value };
      }
      return state;
    }
  }
}

// --- Validators (Property 16) ---

/**
 * Pure: a valid custom-hours value is in [0.25, 24] and a multiple of 0.25.
 * The "multiple of 0.25" check uses `Number.isInteger(h * 4)` to avoid
 * floating-point modulus drift.
 */
export function isValidCustomHours(h: number): boolean {
  if (typeof h !== "number" || !Number.isFinite(h)) {
    return false;
  }
  if (h < 0.25 || h > 24) {
    return false;
  }
  return Number.isInteger(h * 4);
}

/**
 * Pure: description is valid when it does not exceed 500 characters.
 */
export function isValidDescription(s: string): boolean {
  return typeof s === "string" && s.length <= 500;
}

// --- initialFor (Property 17) ---

/**
 * Pure: returns the avatar initial.
 *
 * - First non-whitespace character of `displayName`, upper-cased, when the
 *   display name has any non-whitespace content.
 * - Otherwise the first non-whitespace character of `email`, upper-cased.
 * - Otherwise `'?'`.
 */
export function initialFor(displayName: string, email: string): string {
  const fromName = firstNonWhitespaceChar(displayName);
  if (fromName !== null) {
    return fromName.toUpperCase();
  }
  const fromEmail = firstNonWhitespaceChar(email);
  if (fromEmail !== null) {
    return fromEmail.toUpperCase();
  }
  return "?";
}

function firstNonWhitespaceChar(s: string): string | null {
  if (typeof s !== "string") {
    return null;
  }
  for (const ch of s) {
    if (!/\s/.test(ch)) {
      return ch;
    }
  }
  return null;
}

// --- shouldShowCredentialsBanner (Property 20) ---

/**
 * Pure: the credentials banner is shown iff credentials are incomplete. Reuses
 * the existing `isCredentialComplete` predicate from `authStore` so the banner
 * tracks the same definition as authentication.
 */
export function shouldShowCredentialsBanner(creds: Credentials): boolean {
  return !isCredentialComplete(creds);
}
