import { Inject, Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma.service";

const VAPID_SUBJECT = "mailto:admin@phenomenalgrow.local";

function vapidConfigured(): boolean {
  return Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
}

/** Lock-screen-safe push text per notification kind. Contact names, message
 * previews and failure details stay in the authenticated CRM only — push
 * payloads carry generic text plus the routing link. */
export function pushTextForKind(kind: string): { title: string; body: string } {
  const open = "Open Phenomenal Grow to see details.";
  const map: Record<string, { title: string; body: string }> = {
    "conversation.reply": { title: "New reply", body: "Someone replied — open Phenomenal Grow to read it." },
    "conversation.assigned": { title: "Conversation assigned", body: open },
    "contact.assigned": { title: "Contact assigned", body: open },
    "followup.created": { title: "New follow-up", body: open },
    "followup.due": { title: "Follow-up due", body: open },
    "followup.overdue": { title: "Overdue follow-up", body: open },
    "appointment.scheduled": { title: "Appointment scheduled", body: open },
    "appointment.reminder": { title: "Appointment reminder", body: open },
    "sequence.attention": { title: "Attention needed", body: open },
  };
  return map[kind] ?? { title: "Notification", body: open };
}

/** Action-only notifications with per-user, per-kind preferences (all on by default). */
@Injectable()
export class NotificationsService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async notify(opts: { orgId: string; userId: string; kind: string; title: string; body?: string; link?: string }) {
    if (!opts.userId) return null;
    const pref = await this.prisma.notificationPreference.findUnique({
      where: { orgId_userId_kind: { orgId: opts.orgId, userId: opts.userId, kind: opts.kind } },
    });
    if (pref && !pref.enabled) return null;
    const member = await this.prisma.membership.findUnique({
      where: { orgId_userId: { orgId: opts.orgId, userId: opts.userId } },
    });
    if (!member || !member.active) return null;
    const created = await this.prisma.notification.create({
      data: { orgId: opts.orgId, userId: opts.userId, kind: opts.kind, title: opts.title, body: opts.body ?? null, link: opts.link ?? null },
    });
    void this.pushToUser(opts.userId, opts.kind, opts.link);
    return created;
  }

  /** Best-effort Web Push fan-out; dead subscriptions are pruned. Payload is
   * generic lock-screen text (see pushTextForKind) — the detailed record
   * stays in the authenticated CRM. */
  async pushToUser(userId: string, kind: string, link?: string) {
    if (!vapidConfigured()) return;
    try {
      const webpush = await import("web-push");
      webpush.setVapidDetails(VAPID_SUBJECT, process.env.VAPID_PUBLIC_KEY!, process.env.VAPID_PRIVATE_KEY!);
      const subs = await this.prisma.pushSubscription.findMany({ where: { userId } });
      const text = pushTextForKind(kind);
      const payload = JSON.stringify({ title: text.title, body: text.body, link: link ?? "/" });
      for (const s of subs) {
        try {
          await webpush.sendNotification({ endpoint: s.endpoint, keys: s.keys as never }, payload);
        } catch (e) {
          const code = (e as { statusCode?: number })?.statusCode;
          if (code === 404 || code === 410) {
            await this.prisma.pushSubscription.delete({ where: { id: s.id } });
          }
        }
      }
    } catch {
      // Push is advisory — the in-app notification is the record.
    }
  }

  async saveSubscription(userId: string, endpoint: string, keys: unknown) {
    if (!endpoint || !keys) return null;
    return this.prisma.pushSubscription.upsert({
      where: { endpoint },
      update: { userId, keys: keys as never },
      create: { userId, endpoint, keys: keys as never },
    });
  }

  async removeSubscription(userId: string, endpoint: string) {
    await this.prisma.pushSubscription.deleteMany({ where: { userId, endpoint } });
    return { ok: true };
  }

  async notifyOwners(orgId: string, kind: string, title: string, body?: string, link?: string) {
    const owners = await this.prisma.membership.findMany({ where: { orgId, role: "OWNER", active: true } });
    for (const o of owners) {
      await this.notify({ orgId, userId: o.userId, kind, title, body, link });
    }
  }

  async list(orgId: string, userId: string, take = 50) {
    const items = await this.prisma.notification.findMany({
      where: { orgId, userId },
      orderBy: [{ readAt: "asc" }, { createdAt: "desc" }],
      take: Math.min(Math.max(take, 1), 200),
    });
    const unread = await this.prisma.notification.count({ where: { orgId, userId, readAt: null } });
    return { items, unread };
  }

  async markRead(orgId: string, userId: string, id: string) {
    const n = await this.prisma.notification.findFirst({ where: { id, orgId, userId } });
    if (!n) return null;
    return this.prisma.notification.update({ where: { id }, data: { readAt: new Date() } });
  }

  async markAllRead(orgId: string, userId: string) {
    return this.prisma.notification.updateMany({ where: { orgId, userId, readAt: null }, data: { readAt: new Date() } });
  }

  async preferences(orgId: string, userId: string) {
    return this.prisma.notificationPreference.findMany({ where: { orgId, userId } });
  }

  async setPreference(orgId: string, userId: string, kind: string, enabled: boolean) {
    return this.prisma.notificationPreference.upsert({
      where: { orgId_userId_kind: { orgId, userId, kind } },
      update: { enabled },
      create: { orgId, userId, kind, enabled },
    });
  }
}
