import { describe, it, expect } from "vitest";
import { weekStartOf, addDays } from "./week";
describe("Sunday-based week", () => {
  it("Sunday is its own week start", () => expect(weekStartOf("2026-11-01")).toBe("2026-11-01"));
  it("Saturday belongs to the previous Sunday", () => expect(weekStartOf("2026-11-07")).toBe("2026-11-01"));
  it("Friday 20 Nov 2026 → Sunday 15 Nov", () => expect(weekStartOf("2026-11-20")).toBe("2026-11-15"));
  it("crosses year boundary", () => expect(weekStartOf("2027-01-01")).toBe("2026-12-27"));
  it("addDays", () => expect(addDays("2026-11-15", 6)).toBe("2026-11-21"));
});
