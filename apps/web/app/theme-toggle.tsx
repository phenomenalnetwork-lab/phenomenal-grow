"use client";
import { useEffect, useState } from "react";

const KEY = "pg-theme";

export function ThemeToggle() {
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    // Deferred to a frame callback: reading storage/DOM and syncing state
    // must not run synchronously in the effect body.
    const raf = requestAnimationFrame(() => {
      const saved = localStorage.getItem(KEY);
      const initial = saved === "dark" || (!saved && window.matchMedia("(prefers-color-scheme: dark)").matches) ? "dark" : "light";
      document.documentElement.classList.toggle("dark", initial === "dark");
      setTheme(initial);
      setReady(true);
    });
    return () => cancelAnimationFrame(raf);
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
