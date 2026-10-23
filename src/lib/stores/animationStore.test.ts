import { describe, it, expect } from "vitest";
import {
  DEFAULT_REDUCE_ANIMATIONS,
  isReduceAnimations,
} from "./animationStore.svelte";

it("menyalakan animasi secara default (instalasi baru tidak berubah tampilannya)", () => {
  expect(DEFAULT_REDUCE_ANIMATIONS).toBe(false);
});

describe("isReduceAnimations", () => {
  it("menerima nilai boolean", () => {
    expect(isReduceAnimations(true)).toBe(true);
    expect(isReduceAnimations(false)).toBe(true);
  });

  it("menolak nilai non-boolean dari settings.json yang rusak/lama", () => {
    expect(isReduceAnimations("true")).toBe(false);
    expect(isReduceAnimations(1)).toBe(false);
    expect(isReduceAnimations(0)).toBe(false);
    expect(isReduceAnimations(null)).toBe(false);
    expect(isReduceAnimations(undefined)).toBe(false);
  });
});
