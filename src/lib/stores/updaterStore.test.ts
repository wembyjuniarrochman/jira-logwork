import { describe, it, expect } from "vitest";
import { formatBytes, downloadPercent } from "./updaterStore";

describe("formatBytes", () => {
  it("keeps bytes whole and scales to larger units", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1024)).toBe("1.0 KB");
    expect(formatBytes(1024 * 1024 * 4.2)).toBe("4.2 MB");
  });

  it("drops the decimal once the value is large within its unit", () => {
    // <10 tetap satu desimal supaya progres kecil terlihat bergerak;
    // >=10 dibulatkan agar tidak ramai.
    expect(formatBytes(1024 * 1024 * 12.4)).toBe("12 MB");
  });

  it("guards against non-finite or negative input", () => {
    expect(formatBytes(Number.NaN)).toBe("0 B");
    expect(formatBytes(-5)).toBe("0 B");
  });
});

describe("downloadPercent", () => {
  it("computes a clamped percentage", () => {
    expect(downloadPercent({ downloaded: 50, total: 200 })).toBe(25);
    expect(downloadPercent({ downloaded: 200, total: 200 })).toBe(100);
    // Server kadang mengirim lebih banyak byte dari contentLength.
    expect(downloadPercent({ downloaded: 250, total: 200 })).toBe(100);
  });

  it("returns null when the total size is unknown", () => {
    // Tanpa Content-Length progress bar harus jatuh ke mode indeterminate.
    expect(downloadPercent({ downloaded: 100, total: null })).toBeNull();
    expect(downloadPercent({ downloaded: 100, total: 0 })).toBeNull();
  });
});
