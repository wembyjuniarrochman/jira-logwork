import { describe, it, expect } from "vitest";
import {
  DEFAULT_THEME_PREFERENCE,
  resolveTheme,
  isThemePreference,
} from "./themeStore.svelte";

it("menggunakan tema gelap sebagai default instalasi baru", () => {
  expect(DEFAULT_THEME_PREFERENCE).toBe("dark");
});

describe("resolveTheme", () => {
  it("mengikuti OS saat preferensi auto", () => {
    expect(resolveTheme("auto", true)).toBe("dark");
    expect(resolveTheme("auto", false)).toBe("light");
  });

  it("mengabaikan OS saat tema dipilih eksplisit", () => {
    // Ini inti mode manual: pilihan user harus menang walau OS berkata lain.
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
  });
});

describe("isThemePreference", () => {
  it("menerima ketiga nilai yang sah", () => {
    expect(isThemePreference("auto")).toBe(true);
    expect(isThemePreference("light")).toBe(true);
    expect(isThemePreference("dark")).toBe(true);
  });

  it("menolak nilai lain, termasuk yang mirip", () => {
    // Menjaga settings.json yang rusak/lama tidak menghasilkan tema kosong.
    expect(isThemePreference("system")).toBe(false);
    expect(isThemePreference("Dark")).toBe(false);
    expect(isThemePreference("")).toBe(false);
    expect(isThemePreference(undefined)).toBe(false);
    expect(isThemePreference(null)).toBe(false);
  });
});
