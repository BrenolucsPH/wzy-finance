"use client";
import { useEffect, useRef } from "react";
export function FeatureTabs({
  values,
  value,
  onChange,
  label = "Seções",
}: {
  values: string[];
  value: string;
  onChange: (v: string) => void;
  label?: string;
}) {
  const initial = useRef(false);
  useEffect(() => {
    if (initial.current) return;
    initial.current = true;
    const selected = new URL(location.href).searchParams.get("section");
    if (selected && values.includes(selected)) {
      const timer = setTimeout(() => onChange(selected), 0);
      return () => clearTimeout(timer);
    }
  }, [values, onChange]);
  function select(next: string) {
    onChange(next);
    const url = new URL(location.href);
    url.searchParams.set("section", next);
    history.replaceState(null, "", url.pathname + url.search);
  }
  return (
    <div
      className="account-tabs hub-tabs feature-tabs"
      role="tablist"
      aria-label={label}
    >
      {values.map((v, i) => (
        <button
          key={v}
          type="button"
          role="tab"
          aria-selected={v === value}
          tabIndex={v === value ? 0 : -1}
          className={v === value ? "selected" : ""}
          onClick={() => select(v)}
          onKeyDown={(e) => {
            if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key))
              return;
            e.preventDefault();
            const index =
              e.key === "Home"
                ? 0
                : e.key === "End"
                  ? values.length - 1
                  : (i + (e.key === "ArrowRight" ? 1 : -1) + values.length) %
                    values.length;
            select(values[index]);
            const container = e.currentTarget.parentElement;
            container
              ?.querySelectorAll<HTMLButtonElement>("[role=tab]")
              [index]?.focus();
          }}
        >
          {v}
        </button>
      ))}
    </div>
  );
}
