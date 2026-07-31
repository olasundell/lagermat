export const SUPPLIER_SEMANTIC_MATCH_ENDPOINT =
  "/api/supplier-match-rerank";
export const SUPPLIER_SEMANTIC_PROMPT_VERSION =
  "supplier-product-rerank-v2";
export const SUPPLIER_SEMANTIC_MAX_GROUPS_PER_REQUEST = 8;
export const SUPPLIER_SEMANTIC_MAX_CANDIDATES_PER_GROUP = 12;

export type SupplierSemanticDecision = "match" | "ambiguous" | "no_match";
export type SupplierSemanticAdapter =
  | "netlify-ai-gateway"
  | "fixture"
  | "none";

export interface SupplierSemanticCandidate {
  productId: string;
  productFingerprint: string;
  displayName: string;
  brand: string | null;
  category: string | null;
  purchaseUnit: string;
  packageAmount: number;
  packageUnit: string;
  innerUnitCount?: number | null;
  innerUnitLabel?: string | null;
  deterministicScore: number;
  deterministicReasons: string[];
}

export interface SupplierSemanticIngredient {
  canonicalKey: string;
  displayName: string;
  requiredUnit: string;
  category: string | null;
  comment: string | null;
  recipeNames: string[];
  dietaryLabels: string[];
}

export interface SupplierSemanticRerankGroup {
  ingredient: SupplierSemanticIngredient;
  candidates: SupplierSemanticCandidate[];
}

export interface SupplierSemanticRerankRequest {
  organizationId: string;
  campId: string;
  supplierAccountId: string;
  promptVersion: typeof SUPPLIER_SEMANTIC_PROMPT_VERSION;
  groups: SupplierSemanticRerankGroup[];
}

export interface SupplierSemanticRerankResult {
  canonicalKey: string;
  decision: SupplierSemanticDecision;
  selectedProductId: string | null;
  confidence: number;
  explanation: string;
  cached: boolean;
}

export interface SupplierSemanticRerankResponse {
  configured: boolean;
  adapter: SupplierSemanticAdapter;
  model: string | null;
  promptVersion: typeof SUPPLIER_SEMANTIC_PROMPT_VERSION;
  results: SupplierSemanticRerankResult[];
}
