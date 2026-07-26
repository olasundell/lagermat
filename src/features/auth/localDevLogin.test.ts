import { describe, expect, it } from "vitest";
import { isLocalDevLoginEnabled } from "./localDevLogin";

describe("isLocalDevLoginEnabled", () => {
  it("enables automatic sign-in only when explicitly requested against local Supabase in development", () => {
    expect(isLocalDevLoginEnabled({
      isDevelopment: true,
      isLocalSupabase: true,
      requested: true
    })).toBe(true);
  });

  it.each([
    { isDevelopment: false, isLocalSupabase: true, requested: true },
    { isDevelopment: true, isLocalSupabase: false, requested: true },
    { isDevelopment: true, isLocalSupabase: true, requested: false }
  ])("fails closed for %o", (conditions) => {
    expect(isLocalDevLoginEnabled(conditions)).toBe(false);
  });
});
