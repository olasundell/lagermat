import { describe, expect, it } from "vitest";
import {
  clearWorkspaceSelectionsForUser,
  selectedCampKey,
  selectedOrganizationKey
} from "./workspaceSelectionStorage";

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    key(index: number) {
      return [...values.keys()][index] ?? null;
    },
    getItem(key: string) {
      return values.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      values.set(key, value);
    },
    removeItem(key: string) {
      values.delete(key);
    }
  };
}

describe("workspace selection storage", () => {
  it("rensar bara den angivna användarens organisations- och lägerval", () => {
    const storage = memoryStorage();
    storage.setItem(selectedOrganizationKey("expired-user"), "old-org");
    storage.setItem(selectedCampKey("expired-user", "old-org"), "old-camp");
    storage.setItem(selectedCampKey("expired-user", "second-org"), "second-camp");
    storage.setItem(selectedOrganizationKey("other-user"), "other-org");
    storage.setItem(selectedCampKey("other-user", "other-org"), "other-camp");
    storage.setItem("lagermat:unrelated", "keep");

    clearWorkspaceSelectionsForUser("expired-user", storage);

    expect(storage.getItem(selectedOrganizationKey("expired-user"))).toBeNull();
    expect(storage.getItem(selectedCampKey("expired-user", "old-org"))).toBeNull();
    expect(storage.getItem(selectedCampKey("expired-user", "second-org"))).toBeNull();
    expect(storage.getItem(selectedOrganizationKey("other-user"))).toBe("other-org");
    expect(storage.getItem(selectedCampKey("other-user", "other-org"))).toBe("other-camp");
    expect(storage.getItem("lagermat:unrelated")).toBe("keep");
  });
});
