import { afterEach, describe, expect, it } from "vitest";
import { calculateInvoiceTotals, formatInvoiceNumber, formatRecurringInvoiceNumber, hasRecurringSeriesPrefixConflict, isProvisionalInvoiceNumber, recurringOccurrenceKey } from "./db";
import { decryptConfig, encryptConfig, isEncryptionConfigured } from "./security/crypto";

const originalKey = process.env.APP_CONFIG_ENCRYPTION_KEY;

afterEach(() => {
  if (originalKey === undefined) delete process.env.APP_CONFIG_ENCRYPTION_KEY;
  else process.env.APP_CONFIG_ENCRYPTION_KEY = originalKey;
});

describe("invoice totals", () => {
  it("calculates taxable subtotal, discount, tax, and total in integer cents", () => {
    const totals = calculateInvoiceTotals([
      { description: "Taxable service", quantity: 2, unitPriceCents: 12_500, taxable: true },
      { description: "Non-taxable material", quantity: 1, unitPriceCents: 10_000, taxable: false },
    ], 800, 1000);
    expect(totals).toEqual({ subtotalCents: 35_000, discountCents: 3_500, taxCents: 1_800, totalCents: 33_300 });
  });
});

describe("sent invoice numbering and recurrence keys", () => {
  it("formats a tenant-local sequential sent-document number and distinguishes provisional references", () => {
    expect(formatInvoiceNumber("WP", new Date("2026-10-28T09:00:00Z"), 1001)).toBe("WP-2026-1001");
    expect(formatRecurringInvoiceNumber("HPP", 34)).toBe("HPP034");
    expect(formatRecurringInvoiceNumber("HPP", 35)).toBe("HPP035");
    expect(hasRecurringSeriesPrefixConflict(["HPP"], "HPP1")).toBe(true);
    expect(hasRecurringSeriesPrefixConflict(["HPP"], "HPC")).toBe(false);
    expect(isProvisionalInvoiceNumber("DRAFT-ABCDEFGH12")).toBe(true);
    expect(isProvisionalInvoiceNumber("WP-2026-1001")).toBe(false);
  });

  it("uses one idempotency occurrence key per UTC weekly or monthly period", () => {
    expect(recurringOccurrenceKey("weekly", new Date("2026-10-28T09:00:00Z"))).toBe("week-2026-10-26");
    expect(recurringOccurrenceKey("monthly", new Date("2026-10-28T09:00:00Z"))).toBe("month-2026-10");
  });
});

describe("provider configuration encryption", () => {
  it("requires a valid 32-byte encryption key", () => {
    delete process.env.APP_CONFIG_ENCRYPTION_KEY;
    expect(isEncryptionConfigured()).toBe(false);
    expect(() => encryptConfig({ secret: "never-store-plaintext" })).toThrow(/not configured/);
  });

  it("round-trips a stored configuration without exposing plaintext", () => {
    process.env.APP_CONFIG_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
    const encrypted = encryptConfig({ provider: "smtp", password: "private" });
    expect(encrypted).not.toContain("private");
    expect(decryptConfig<{ provider: string; password: string }>(encrypted)).toEqual({ provider: "smtp", password: "private" });
  });
});
