"use client";
import { useEffect, useState } from "react";

const KEY = "pg-theme";

function current(): "light" | "dark" {
  if (typeof document === "undefined") return "light";
  if (document.documentElement.classList.contains("dark")) return "dark";
  return "light";
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem(KEY);
    const initial = saved === "dark" || (!saved && window.matchMedia("(prefers-color-scheme: dark)").matches) ? "dark" : "light";
    document.documentElement.classList.toggle("dark", initial === "dark");
    setTheme(initial);
    setReady(true);
  }, []);

  const flip = () => {
    const next = theme === "dark" ? "light" : "dark";
    document.documentElement.classList.toggle("dark", next === "dark");
    localStorage.setItem(KEY, next);
    setTheme(next);
  };

  if (!ready) return null;
  return (
    <button className="secondary inline" onClick={flip} aria-label="Toggle night mode" title="Toggle night mode">
      {theme === "dark" ? "☀ Light" : "☾ Night"}
    </button>
  );
}
