export const NOTIFICATION_KINDS = [
  "conversation.reply",
  "conversation.assigned",
  "contact.assigned",
  "followup.created",
  "followup.due",
  "followup.overdue",
  "appointment.scheduled",
  "appointment.reminder",
  "sequence.attention",
] as const;

export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];
