export const designTokens = {
  font: {
    sans: "Inter, system-ui, sans-serif",
    baseSize: 14,
  },
  radius: {
    card: 10,
    input: 8,
  },
  color: {
    action: "#16a34a",
    due: "#f59e0b",
    overdue: "#dc2626",
    conversion: "#7c3aed",
  },
} as const;

export const nav = [
  "Home",
  "Inbox",
  "Contacts",
  "Pipelines",
  "Follow-ups",
  "Appointments",
  "Reports",
  "Settings",
] as const;
