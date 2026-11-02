import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";

const originalDriver = process.env.STORAGE_DRIVER;
const originalPath = process.env.LOCAL_STORAGE_PATH;

function restore(name: "STORAGE_DRIVER" | "LOCAL_STORAGE_PATH", value: string | undefined) {
  if (value === undefined) delete process.env[name]; else process.env[name] = value;
}

afterEach(() => {
  restore("STORAGE_DRIVER", originalDriver);
  restore("LOCAL_STORAGE_PATH", originalPath);
  vi.resetModules();
});

describe("protected local storage", () => {
  it("writes a uniquely named private asset and reads it back", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "wp-local-storage-"));
    try {
      process.env.STORAGE_DRIVER = "local";
      process.env.LOCAL_STORAGE_PATH = root;
      const { storagePut, storageRead } = await import("./storage");
      const stored = await storagePut("companies/7/logos/company-logo.png", Buffer.from("logo"), "image/png");
      expect(stored.key).toMatch(/^companies\/7\/logos\/company-logo_[a-f0-9]{16}\.png$/);
      expect(stored.url).toContain("/api/assets/");
      const loaded = await storageRead(stored.key);
      expect(loaded?.data.toString()).toBe("logo");
      expect(loaded?.contentType).toBe("image/png");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("does not resolve an absent local asset", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "wp-local-storage-"));
    try {
      process.env.STORAGE_DRIVER = "local";
      process.env.LOCAL_STORAGE_PATH = root;
      const { storageRead } = await import("./storage");
      await expect(storageRead("companies/7/logos/missing.png")).resolves.toBeNull();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
