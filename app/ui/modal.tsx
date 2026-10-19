"use client";
import {
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type CSSProperties,
} from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
export function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null),
    closeRef = useRef(onClose);
  const [portal, setPortal] = useState<{
    target: HTMLElement;
    style: CSSProperties;
    dark: boolean;
  } | null>(null);
  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);
  // This effect reads the client-only document and computed theme after hydration.
  useEffect(() => {
    const shell = document.querySelector(".shell"),
      style = shell ? getComputedStyle(shell) : null;
    const variables: Record<string, string> = {};
    for (const key of [
      "--bg",
      "--surface",
      "--text",
      "--muted",
      "--line",
      "--accent",
      "--tint",
      "--glass",
      "--glass-border",
      "--glass-shadow",
      "--button-face",
      "--button-edge",
      "--button-ink",
      "--bone",
      "--bone-light",
    ])
      if (style) variables[key] = style.getPropertyValue(key);
    void Promise.resolve().then(() =>
      setPortal({
        target: document.body,
        style: variables as CSSProperties,
        dark: !!shell?.classList.contains("dark"),
      }),
    );
  }, []);
  useEffect(() => {
    if (!portal) return;
    const previous = document.activeElement as HTMLElement | null;
    const old = {
        overflow: document.body.style.overflow,
        position: document.body.style.position,
        top: document.body.style.top,
        width: document.body.style.width,
      },
      scrollY = window.scrollY;
    document.body.style.overflow = "hidden";
    document.body.style.position = "fixed";
    document.body.style.top = -scrollY + "px";
    document.body.style.width = "100%";
    const focusable = () =>
      Array.from(
        ref.current?.querySelectorAll<HTMLElement>(
          "button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),a[href]",
        ) || [],
      );
    focusable()[0]?.focus({ preventScroll: true });
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        closeRef.current();
      }
      if (e.key === "Tab") {
        const items = focusable();
        if (!items.length) {
          e.preventDefault();
          return;
        }
        if (e.shiftKey && document.activeElement === items[0]) {
          e.preventDefault();
          items[items.length - 1].focus({ preventScroll: true });
        } else if (
          !e.shiftKey &&
          document.activeElement === items[items.length - 1]
        ) {
          e.preventDefault();
          items[0].focus({ preventScroll: true });
        }
      }
    };
    document.addEventListener("keydown", handler);
    return () => {
      Object.assign(document.body.style, old);
      const behavior = document.documentElement.style.scrollBehavior;
      document.documentElement.style.scrollBehavior = "auto";
      window.scrollTo({ top: scrollY, behavior: "instant" });
      document.documentElement.style.scrollBehavior = behavior;
      document.removeEventListener("keydown", handler);
      previous?.focus({ preventScroll: true });
    };
  }, [portal]);
  if (!portal) return null;
  return createPortal(
    <div
      className={"modal-overlay " + (portal.dark ? "dark" : "")}
      style={portal.style}
      onClick={(e) => {
        if (e.target === e.currentTarget) closeRef.current();
      }}
    >
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        ref={ref}
      >
        <div className="modal-title">
          <h2>{title}</h2>
          <button onClick={() => closeRef.current()} aria-label="Fechar">
            <X size={20} />
          </button>
        </div>
        {children}
      </div>
    </div>,
    portal.target,
  );
}
