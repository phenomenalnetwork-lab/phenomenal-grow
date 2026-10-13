const STATUS_CLASS: Record<string, string> = {
  ACTIVE: "badge",
  INACTIVE: "badge badge-muted",
  ARCHIVED: "badge badge-muted",
  DNC: "badge badge-dnc",
  OPEN: "badge",
  CLOSED: "badge badge-muted",
  SCHEDULED: "badge",
  COMPLETED: "badge badge-conv",
  CANCELLED: "badge badge-muted",
  NOSHOW: "badge badge-due",
  ONGOING: "badge",
  CONVERTED: "badge badge-conv",
  NOT_CONVERTED: "badge badge-muted",
};

export function StatusBadge({ status }: { status: string }) {
  return <span className={STATUS_CLASS[status] ?? "badge badge-muted"}>{status}</span>;
}
