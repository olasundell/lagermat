import { describe, expect, it } from "vitest";
import { applyDocumentTitle, routeDocumentTitles } from "./router";

describe("route document titles", () => {
  it("defines a distinct title for every application route", () => {
    const titles = Object.values(routeDocumentTitles);

    expect(new Set(titles).size).toBe(titles.length);
    expect(routeDocumentTitles["/deltagare"]).toBe("Deltagare | Lägermat");
    expect(routeDocumentTitles["/inkop"]).toBe("Inköp | Lägermat");
  });

  it("applies a route title to the document", () => {
    applyDocumentTitle(routeDocumentTitles["/recept"]);

    expect(document.title).toBe("Recept | Lägermat");
  });
});
