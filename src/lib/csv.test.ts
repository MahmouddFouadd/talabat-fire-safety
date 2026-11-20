import { describe, it, expect } from "vitest";
import { toCsv } from "./csv";
describe("toCsv", () => {
  it("neutralises formulas", () => expect(toCsv([["=1+1"]])).toBe("\uFEFF'=1+1"));
  it("quotes commas and quotes", () => expect(toCsv([['a,b', 'say "hi"']])).toBe('\uFEFF"a,b","say ""hi"""'));
  it("keeps Arabic", () => expect(toCsv([["الدقي"]])).toContain("الدقي"));
});
