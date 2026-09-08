/**
 * Tes runtime untuk DateTimeField.
 *
 * Komponen ini menggantikan `<input type="date">` bawaan dengan pemilih dari
 * pustaka, dan bagian yang paling mudah rusak diam-diam adalah jembatan
 * string ⇄ tipe pustaka: `svelte-check` hanya membuktikan tipenya cocok,
 * bukan bahwa nilainya benar-benar sampai. Tes ini memeriksa jembatan itu.
 */

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/svelte";
import DateTimeField from "./DateTimeField.svelte";

/** Tanggal hari ini sebagai `YYYY-MM-DD` lokal, sama seperti komponennya. */
function ymd(offsetDays = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

describe("DateTimeField", () => {
  it("menampilkan tanggal dan jam yang diberikan sebagai segmen", () => {
    render(DateTimeField, { date: "2026-03-17", time: "14:30" });

    // Segmen dirender sebagai elemen ber-`data-part`; nilainya harus
    // mencerminkan string yang masuk, bukan tanggal hari ini.
    const parts = document.querySelectorAll("[data-part]");
    const text = Array.from(parts).map((e) => e.textContent?.trim());

    expect(text).toContain("2026");
    expect(text).toContain("03");
    expect(text).toContain("17");
    expect(text).toContain("14");
    expect(text).toContain("30");
  });

  it("menandai chip pintasan yang cocok dengan tanggal saat ini", () => {
    render(DateTimeField, { date: ymd(-1), time: "09:00" });

    const kemarin = screen.getByRole("button", { name: /kemarin|yesterday/i });
    expect(kemarin.getAttribute("aria-pressed")).toBe("true");

    const hariIni = screen.getByRole("button", { name: /hari ini|today/i });
    expect(hariIni.getAttribute("aria-pressed")).toBe("false");
  });

  it("tidak menandai chip apa pun untuk tanggal yang jauh", () => {
    render(DateTimeField, { date: "2020-01-01", time: "09:00" });

    for (const name of [/hari ini|today/i, /kemarin|yesterday/i]) {
      expect(
        screen.getByRole("button", { name }).getAttribute("aria-pressed"),
      ).toBe("false");
    }
  });

  it("bertahan terhadap tanggal yang tidak sah tanpa melempar", () => {
    // Nilai kosong terjadi sungguhan: `startedDate` diinisialisasi "" sebelum
    // efek pengisiannya berjalan.
    expect(() => render(DateTimeField, { date: "", time: "" })).not.toThrow();
  });
});
