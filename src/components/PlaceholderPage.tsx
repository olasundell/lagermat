import { ArrowRight, ClipboardList } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { useEffect } from "react";

export function PlaceholderPage({ title, description }: { title: string; description: string }) {
  useEffect(() => {
    document.title = `${title} | Lägermat`;
  }, [title]);

  return (
    <section className="page page--narrow">
      <div className="empty-panel">
        <ClipboardPlaceholder />
        <h1>{title}</h1>
        <p>{description}</p>
        <Link to="/" className="button-link">
          Till översikten <ArrowRight aria-hidden="true" size={18} />
        </Link>
      </div>
    </section>
  );
}

function ClipboardPlaceholder() {
  return (
    <span className="empty-panel__icon" aria-hidden="true">
      <ClipboardList size={34} strokeWidth={1.7} />
    </span>
  );
}
