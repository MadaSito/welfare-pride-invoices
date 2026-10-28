import { describe, expect, it } from "vitest";
import { nextFutureScheduledRunAt, nextScheduledRunAt } from "./routes/recurringInvoiceRoutes";

const base = {
  dayOfWeek: null,
  dayOfMonth: null,
  monthOfYear: null,
  hourUtc: 9,
  minuteUtc: 0,
} as const;

const iso = (date: Date) => date.toISOString();

describe("recurring schedule next-run calculation", () => {
  it("advances daily timing at an exact UTC boundary", () => {
    expect(iso(nextScheduledRunAt({ ...base, cadence: "daily" }, new Date("2026-10-28T09:00:00Z")))).toBe("2026-10-29T09:00:00.000Z");
  });

  it("uses the configured January–June anchor and its six-month pair", () => {
    const schedule = { ...base, cadence: "semiannual" as const, dayOfMonth: 15, monthOfYear: 1 };
    expect(iso(nextScheduledRunAt(schedule, new Date("2026-01-15T09:00:00Z")))).toBe("2026-07-15T09:00:00.000Z");
    expect(iso(nextScheduledRunAt(schedule, new Date("2026-07-15T09:00:00Z")))).toBe("2027-01-15T09:00:00.000Z");
  });

  it("rolls a yearly anchor into the next year", () => {
    const schedule = { ...base, cadence: "yearly" as const, dayOfMonth: 15, monthOfYear: 10 };
    expect(iso(nextScheduledRunAt(schedule, new Date("2026-10-15T09:00:00Z")))).toBe("2027-10-15T09:00:00.000Z");
  });

  it("advances a delayed callback to the next future run without changing its scheduled occurrence", () => {
    const schedule = { ...base, cadence: "daily" as const };
    expect(iso(nextFutureScheduledRunAt(schedule, new Date("2026-10-28T09:00:00Z"), new Date("2026-10-30T10:00:00Z")))).toBe("2026-10-31T09:00:00.000Z");
  });
});
