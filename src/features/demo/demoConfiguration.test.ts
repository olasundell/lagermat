import { describe, expect, it } from "vitest";
import { resolveDemoConfiguration } from "./demoConfiguration";

describe("resolveDemoConfiguration", () => {
  it("är avstängt som standard", () => {
    expect(resolveDemoConfiguration({})).toEqual({
      enabled: false,
      siteKey: null,
      error: null
    });
  });

  it("kräver en publik sitekey när demoläget är uttryckligen på", () => {
    expect(resolveDemoConfiguration({ mode: "true" })).toEqual({
      enabled: false,
      siteKey: null,
      error: "Demoläget saknar en giltig publik Turnstile-sitekey."
    });
  });

  it("aktiverar bara en exakt och komplett konfiguration", () => {
    expect(resolveDemoConfiguration({
      mode: "true",
      turnstileSiteKey: "  public-site-key  "
    })).toEqual({
      enabled: true,
      siteKey: "public-site-key",
      error: null
    });
  });

  it("stänger säkert vid ett felskrivet lägesvärde", () => {
    expect(resolveDemoConfiguration({
      mode: "TRUE",
      turnstileSiteKey: "public-site-key"
    })).toEqual({
      enabled: false,
      siteKey: null,
      error: "VITE_DEMO_MODE måste vara true eller false."
    });
  });
});
