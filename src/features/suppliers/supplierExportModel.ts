import type { SupplyExportReadiness } from "../supplies/exportModel";
import {
  practicalSupplyAmount,
  type PracticalSupplyAmount,
  type SupplyItemRow,
} from "../supplies/supplyModel";
import {
  proposeSupplierOrder,
  type SupplierAccount,
  type SupplierMatchDetail,
  type SupplierOrderProposal,
} from "./supplierModel";

export interface SupplierUnderlayLine {
  item: SupplyItemRow;
  practicalRequirement: PracticalSupplyAmount;
  detail: SupplierMatchDetail | null;
  proposal: SupplierOrderProposal | null;
}

export interface SupplierOrderUnderlay {
  fileStem: string;
  organizationName: string;
  campName: string;
  supplier: SupplierAccount;
  generatedAt: string;
  draft: boolean;
  problems: string[];
  lines: SupplierUnderlayLine[];
}

export interface SupplierOrderUnderlayInput {
  organizationName: string;
  campName: string;
  supplier: SupplierAccount;
  items: SupplyItemRow[];
  details: SupplierMatchDetail[];
  readiness: SupplyExportReadiness;
  generatedAt?: Date;
}

const csvColumns = [
  "Dokumentstatus",
  "Kontrollstatus",
  "Att kontrollera",
  "Organisation",
  "Läger",
  "Leverantör",
  "Kundnummer",
  "Kategori",
  "Råvara",
  "Praktiskt behov",
  "Praktisk enhet",
  "Exakt beräkning",
  "Beräkningens enhet",
  "Matchningsstatus",
  "Leverantörens artikelnummer",
  "GTIN",
  "Artikelbenämning",
  "Beställningsenhet",
  "Mängd per beställningsenhet",
  "Matchningens enhet",
  "Minsta order",
  "Föreslaget antal beställningsenheter",
  "Föreslagen mängd",
  "Över behovet",
  "Produktens förpackningsinnehåll",
  "Produktens förpackningsenhet",
  "Kundpris",
  "Valuta",
  "Tillgänglighet",
  "Pris gäller från",
  "Pris gäller till",
  "Pris hämtat",
  "Beställt antal i Scoutmat",
  "Beställd enhet i Scoutmat",
  "Förpackningsanteckning",
  "Kommentar",
] as const;

function slug(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("sv-SE")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 70);
}

function csvCell(value: string | number | null): string {
  const source = String(value ?? "");
  const neutralized = /^[\t\r\n ]*[=+\-@]/.test(source) ? `'${source}` : source;
  return `"${neutralized.replaceAll('"', '""')}"`;
}

function rawDecimal(value: number | null): string {
  return value === null ? "" : String(value);
}

function approvedTimestamp(detail: SupplierMatchDetail): number {
  const value = detail.match.approved_at ?? detail.match.updated_at;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
}

function chooseLatestMatch(
  item: SupplyItemRow,
  supplier: SupplierAccount,
  details: SupplierMatchDetail[],
): SupplierMatchDetail | null {
  return details
    .filter((detail) =>
      detail.account.id === supplier.id
      && detail.match.canonical_key === item.canonical_key
      && detail.account.active
      && detail.product.active
    )
    .sort((left, right) =>
      approvedTimestamp(right) - approvedTimestamp(left)
      || right.match.id.localeCompare(left.match.id, "sv-SE")
    )[0] ?? null;
}

function matchStatus(line: SupplierUnderlayLine): string {
  if (!line.detail || !line.proposal) return "SAKNAR MATCHNING";
  if (line.proposal.status === "ready") return "MATCHAD";
  if (line.proposal.status === "unit_mismatch") return "ENHETSKONFLIKT";
  if (line.proposal.reason === "supplier_product_out_of_stock") return "SLUT I LAGER";
  if (line.proposal.reason === "supplier_product_discontinued") return "ARTIKEL UTGÅNGEN";
  return "OGILTIG MATCHNING";
}

export function createSupplierOrderUnderlay(input: SupplierOrderUnderlayInput): SupplierOrderUnderlay {
  const lines = input.items
    .filter((item) => item.source_present)
    .sort((left, right) =>
      left.category.localeCompare(right.category, "sv")
      || left.item_name.localeCompare(right.item_name, "sv")
    )
    .map((item): SupplierUnderlayLine => {
      const detail = chooseLatestMatch(item, input.supplier, input.details);
      return {
        item,
        practicalRequirement: practicalSupplyAmount(
          item.required_amount,
          item.required_unit,
        ),
        detail,
        proposal: detail ? proposeSupplierOrder(item.required_amount, item.required_unit, detail) : null,
      };
    });
  const unmatchedCount = lines.filter((line) => !line.detail).length;
  const unitConflictCount = lines.filter((line) => line.proposal?.status === "unit_mismatch").length;
  const invalidCount = lines.filter((line) => line.proposal?.status === "invalid_mapping").length;
  const missingOfferCount = lines.filter((line) => line.detail && !line.detail.offer).length;
  const unknownAvailabilityCount = lines.filter((line) =>
    line.detail?.offer?.availability_status === "unknown"
  ).length;
  const supplierProblems = [
    unmatchedCount ? `${unmatchedCount} ${unmatchedCount === 1 ? "råvara saknar" : "råvaror saknar"} artikelmatchning` : null,
    unitConflictCount ? `${unitConflictCount} ${unitConflictCount === 1 ? "matchning har" : "matchningar har"} enhetskonflikt` : null,
    invalidCount ? `${invalidCount} ${invalidCount === 1 ? "artikel kan" : "artiklar kan"} inte beställas` : null,
    missingOfferCount ? `${missingOfferCount} ${missingOfferCount === 1 ? "matchad rad saknar" : "matchade rader saknar"} aktuellt pris och tillgänglighetsbesked` : null,
    unknownAvailabilityCount ? `${unknownAvailabilityCount} ${unknownAvailabilityCount === 1 ? "artikel har" : "artiklar har"} okänd tillgänglighet` : null,
  ].filter((problem): problem is string => Boolean(problem));
  const problems = [...input.readiness.problems, ...supplierProblems];

  return {
    fileStem: `lagermat-${slug(input.campName)}-${slug(input.supplier.display_name)}-leverantorsunderlag`,
    organizationName: input.organizationName,
    campName: input.campName,
    supplier: input.supplier,
    generatedAt: (input.generatedAt ?? new Date()).toISOString(),
    draft: !input.readiness.canFinalize || supplierProblems.length > 0,
    problems,
    lines,
  };
}

export function createSupplierOrderCsv(underlay: SupplierOrderUnderlay): string {
  const problems = underlay.problems.join(" | ");
  const rows = underlay.lines.map((line) => {
    const detail = line.detail;
    const proposal = line.proposal?.status === "ready" ? line.proposal : null;
    return [
      "UNDERLAG – INGEN ORDER HAR SKICKATS",
      underlay.draft ? "UNDERLAG MED VARNINGAR" : "KONTROLLERAT UNDERLAG",
      problems,
      underlay.organizationName,
      underlay.campName,
      underlay.supplier.display_name,
      underlay.supplier.customer_number ?? "",
      line.item.category,
      line.item.item_name,
      line.practicalRequirement.amount,
      line.practicalRequirement.unit,
      rawDecimal(line.item.required_amount),
      line.item.required_unit,
      matchStatus(line),
      detail?.product.supplier_article_number ?? "",
      detail?.product.gtin ?? "",
      detail?.product.display_name ?? "",
      detail?.product.purchase_unit ?? "",
      detail ? rawDecimal(detail.match.amount_per_purchase_unit) : "",
      detail?.match.required_unit ?? "",
      detail ? rawDecimal(detail.product.minimum_order_units) : "",
      proposal ? rawDecimal(proposal.purchaseUnits) : "",
      proposal ? rawDecimal(proposal.orderedAmount) : "",
      proposal ? rawDecimal(proposal.surplusAmount) : "",
      detail ? rawDecimal(detail.product.package_amount) : "",
      detail?.product.package_unit ?? "",
      detail?.offer ? rawDecimal(detail.offer.price) : "",
      detail?.offer?.currency ?? "",
      detail?.offer?.availability_status ?? "",
      detail?.offer?.valid_from ?? "",
      detail?.offer?.valid_to ?? "",
      detail?.offer?.fetched_at ?? "",
      rawDecimal(line.item.ordered_amount),
      line.item.ordered_unit ?? "",
      line.item.package_note ?? "",
      line.item.comment ?? "",
    ];
  });

  return `\uFEFF${[csvColumns, ...rows].map((row) => row.map(csvCell).join(";")).join("\r\n")}\r\n`;
}
