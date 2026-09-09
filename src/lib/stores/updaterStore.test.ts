import { describe, it, expect, vi, beforeEach } from "vitest";
import { formatBytes, downloadPercent, downloadAndInstall, restartAfterUpdate, takeInstalledUpdate, UpdateRestartError } from "./updaterStore";

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

const updaterMocks = vi.hoisted(() => ({ invoke: vi.fn(), relaunch: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: updaterMocks.invoke }));
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch: updaterMocks.relaunch }));

describe("update installation and restart", () => {
  beforeEach(() => {
    updaterMocks.invoke.mockReset().mockResolvedValue(undefined);
    updaterMocks.relaunch.mockReset().mockResolvedValue(undefined);
  });

  it("downloads, saves restart intent, installs, then relaunches in order", async () => {
    const steps: string[] = [];
    updaterMocks.invoke.mockImplementation(async () => { steps.push("prepare"); });
    updaterMocks.relaunch.mockImplementation(async () => { steps.push("relaunch"); });
    const progress = vi.fn();
    const install = vi.fn(async () => { steps.push("install"); });
    const download = vi.fn(async (cb) => {
      steps.push("download");
      cb({ event: "Started", data: { contentLength: 100 } });
      cb({ event: "Progress", data: { chunkLength: 100 } });
      cb({ event: "Finished" });
    });
    await downloadAndInstall({ version: "1.0.6", raw: { download, install } }, progress);
    expect(steps).toEqual(["download", "prepare", "install", "relaunch"]);
    expect(updaterMocks.invoke).toHaveBeenCalledWith("prepare_update_restart", { version: "1.0.6" });
    expect(install).toHaveBeenCalledWith({ restartAfterInstall: true });
    expect(progress).toHaveBeenLastCalledWith({ downloaded: 100, total: 100 });
  });

  it("does not restart if installation fails", async () => {
    const error = new Error("Installation failed");
    await expect(downloadAndInstall({ version: "1.0.6", raw: {
      download: vi.fn().mockResolvedValue(undefined),
      install: vi.fn().mockRejectedValue(error),
    } })).rejects.toBe(error);
    expect(updaterMocks.relaunch).not.toHaveBeenCalled();
  });

  it("allows retrying only the restart after installation succeeds", async () => {
    updaterMocks.relaunch.mockRejectedValueOnce(new Error("Restart failed"));
    const install = vi.fn().mockResolvedValue(undefined);
    await expect(downloadAndInstall({ version: "1.0.6", raw: {
      download: vi.fn().mockResolvedValue(undefined), install,
    } })).rejects.toBeInstanceOf(UpdateRestartError);
    await restartAfterUpdate();
    expect(install).toHaveBeenCalledTimes(1);
    expect(updaterMocks.relaunch).toHaveBeenCalledTimes(2);
  });

  it("does not install if restart intent cannot be saved", async () => {
    updaterMocks.invoke.mockRejectedValue(new Error("Disk full"));
    const install = vi.fn();
    await expect(downloadAndInstall({ version: "1.0.6", raw: {
      download: vi.fn().mockResolvedValue(undefined), install,
    } })).rejects.toThrow("Disk full");
    expect(install).not.toHaveBeenCalled();
    expect(updaterMocks.relaunch).not.toHaveBeenCalled();
  });

  it("consumes the version verified by the restarted application", async () => {
    updaterMocks.invoke.mockResolvedValueOnce("1.0.6");
    await expect(takeInstalledUpdate()).resolves.toBe("1.0.6");
    expect(updaterMocks.invoke).toHaveBeenCalledWith("take_update_success");
  });
});
