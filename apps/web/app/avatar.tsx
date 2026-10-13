const PALETTE = ["#0d9488", "#7c3aed", "#2563eb", "#db2777", "#ea580c", "#16a34a", "#0891b2", "#4d7c0f"];

export function colorFor(name: string): string {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function Avatar({ name, size = 28 }: { name: string; size?: number }) {
  const bg = colorFor(name || "?");
  return (
    <span
      aria-hidden="true"
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: size,
        height: size,
        borderRadius: "50%",
        background: bg,
        color: "#fff",
        fontSize: Math.max(10, Math.floor(size * 0.38)),
        fontWeight: 700,
        flexShrink: 0,
        verticalAlign: "middle",
        marginRight: 8,
      }}
    >
      {initials(name || "?")}
    </span>
  );
}
