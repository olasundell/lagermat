import { describe, expect, it, vi } from "vitest";
import {
  fetchSupplierSemanticReranks,
  type SupplierSemanticSessionClient,
} from "./supplierSemanticMatchClient";
import {
  SUPPLIER_SEMANTIC_PROMPT_VERSION,
  type SupplierSemanticRerankGroup,
} from "./supplierSemanticMatch";

const organizationId = "9b7c02ca-11dc-4a10-bdd8-ed1f14833709";
const campId = "bf14c93e-49c3-4f16-8658-990a34c5755d";
const supplierAccountId = "ffda240b-5f3c-4d24-85d1-178f9f6ecafe";
const productId = "068a901d-77e8-44f0-9fe8-c693d8a54e4f";

function client(
  accessToken: string | null = "header.payload.signature",
): SupplierSemanticSessionClient {
  return {
    auth: {
      getSession: vi.fn().mockResolvedValue({
        data: {
          session: accessToken ? { access_token: accessToken } : null,
        },
        error: null,
      }),
    },
  };
}

const groups: SupplierSemanticRerankGroup[] = [{
  ingredient: {
    canonicalKey: "a".repeat(64),
    displayName: "Dressing",
    requiredUnit: "kg",
    category: "Skafferi",
    comment: null,
    recipeNames: ["Hamburgare"],
    dietaryLabels: [],
  },
  candidates: [{
    productId,
    productFingerprint: "b".repeat(64),
    displayName: "Hamburgerdressing 230g ICA",
    brand: "ICA",
    category: "Skafferi > Såser > Hamburgerdressing",
    purchaseUnit: "styck",
    packageAmount: 0.23,
    packageUnit: "kg",
    deterministicScore: 95,
    deterministicReasons: ["Svensk sammansättning."],
  }],
}];

describe("supplier semantic match client", () => {
  it("uses the current session and accepts a bounded review-only response", async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({
      configured: true,
      adapter: "fixture",
      model: "fixture-v1",
      promptVersion: SUPPLIER_SEMANTIC_PROMPT_VERSION,
      results: [{
        canonicalKey: "a".repeat(64),
        decision: "match",
        selectedProductId: productId,
        confidence: 0.91,
        explanation: "Receptet är hamburgare och artikeln är hamburgerdressing.",
        cached: false,
      }],
    }));

    await expect(fetchSupplierSemanticReranks(
      client(),
      organizationId,
      campId,
      supplierAccountId,
      groups,
      fetcher,
    )).resolves.toMatchObject({
      configured: true,
      adapter: "fixture",
      results: [{ selectedProductId: productId }],
    });
    expect(fetcher).toHaveBeenCalledWith(
      "/api/supplier-match-rerank",
      expect.objectContaining({
        method: "POST",
        credentials: "same-origin",
        headers: expect.objectContaining({
          Authorization: "Bearer header.payload.signature",
        }),
      }),
    );
  });

  it("rejects a selected product that was not in the safety-filtered group", async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({
      configured: true,
      adapter: "netlify-ai-gateway",
      model: "gpt-5-mini",
      promptVersion: SUPPLIER_SEMANTIC_PROMPT_VERSION,
      results: [{
        canonicalKey: "a".repeat(64),
        decision: "match",
        selectedProductId: "30fa2bb9-73cc-47c4-a20b-bb2c3a27c0b0",
        confidence: 0.99,
        explanation: "Felaktig produkt.",
        cached: false,
      }],
    }));

    await expect(fetchSupplierSemanticReranks(
      client(),
      organizationId,
      campId,
      supplierAccountId,
      groups,
      fetcher,
    )).rejects.toThrow("oväntat format");
  });

  it("requires a session before contacting the function", async () => {
    const fetcher = vi.fn();
    await expect(fetchSupplierSemanticReranks(
      client(null),
      organizationId,
      campId,
      supplierAccountId,
      groups,
      fetcher,
    )).rejects.toThrow("Logga in igen");
    expect(fetcher).not.toHaveBeenCalled();
  });
});
