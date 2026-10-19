"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { navigationLabels } from "../lib/navigation";
function fromUrl() {
  if (typeof location === "undefined") return "Visão geral";
  const selected = new URLSearchParams(location.search).get("page");
  return selected &&
    (navigationLabels.includes(selected as never) ||
      selected === "Configurações")
    ? selected
    : "Visão geral";
}
export function useNavigation() {
  const [page, setPage] = useState("Visão geral"),
    [exiting, setExiting] = useState(false),
    timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const initial = setTimeout(() => setPage(fromUrl()), 0),
      listener = () => {
        if (timer.current) clearTimeout(timer.current);
        setPage(fromUrl());
        setExiting(false);
      };
    window.addEventListener("popstate", listener);
    return () => {
      clearTimeout(initial);
      if (timer.current) clearTimeout(timer.current);
      window.removeEventListener("popstate", listener);
    };
  }, []);
  const navigate = useCallback((next: string) => {
    if (timer.current) clearTimeout(timer.current);
    const url = new URL(location.href);
    url.searchParams.set("page", next);
    url.searchParams.delete("reset");
    url.searchParams.delete("section");
    history.pushState(null, "", url.pathname + url.search);
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setPage(next);
      setExiting(false);
      return;
    }
    setExiting(true);
    timer.current = setTimeout(() => {
      setPage(next);
      setExiting(false);
      window.scrollTo({ top: 0, behavior: "smooth" });
    }, 180);
  }, []);
  return { page, exiting, navigate };
}
