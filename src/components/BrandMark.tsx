import { CookingPot } from "lucide-react";

export function BrandMark({ compact = false }: { compact?: boolean }) {
  return (
    <span className="brand-mark" aria-label="Lägermat">
      <span className="brand-mark__word">Lägermat</span>
      <CookingPot aria-hidden="true" size={compact ? 25 : 29} strokeWidth={2.2} />
    </span>
  );
}
