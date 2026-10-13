export function LogoMark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <rect x="1" y="1" width="30" height="30" rx="8" fill="#0891b2" />
      <path
        d="M22.5 16.5A6.5 6.5 0 1 1 16 9.5c1.9 0 3.5.8 4.7 2l-2.1 2.1a3.6 3.6 0 0 0-2.6-1.1 3.7 3.7 0 0 0 0 7.4c1 0 1.9-.4 2.6-1H16v-2.9h6.5v1z"
        fill="#fff"
      />
      <circle cx="23.5" cy="22.5" r="4.4" fill="#0f172a" />
      <path d="M21.3 22.5l1.6 1.6 3-3.2" stroke="#fff" strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Logo({ size = 28 }: { size?: number }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
      <LogoMark size={size} />
      <strong style={{ color: "#fff", fontSize: 15 }}>Phenomenal Grow</strong>
    </span>
  );
}
