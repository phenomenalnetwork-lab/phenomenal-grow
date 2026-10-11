"use server";
import { redirect } from "next/navigation";
import { getSession, myMemberships, getActiveOrgId } from "@/lib/orgs";
import { apiFetch } from "@/lib/api";

export interface ImportRow {
  name: string;
  phone: string;
  email?: string;
  source?: string;
  tags?: string[];
}

function parseCsv(text: string): ImportRow[] {
  const rows: ImportRow[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const cells: string[] = [];
    let cur = "";
    let quoted = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (quoted) {
        if (ch === '"' && line[i + 1] === '"') {
          cur += '"';
          i++;
        } else if (ch === '"') {
          quoted = false;
        } else {
          cur += ch;
        }
      } else if (ch === '"') {
        quoted = true;
      } else if (ch === ",") {
        cells.push(cur.trim());
        cur = "";
      } else {
        cur += ch;
      }
    }
    cells.push(cur.trim());
    const [name = "", phone = "", email = "", source = "", tags = ""] = cells;
    rows.push({
      name,
      phone,
      email: email || undefined,
      source: source || undefined,
      tags: tags ? tags.split(";").map((t) => t.trim()).filter(Boolean) : undefined,
    });
  }
  return rows;
}

async function orgId(): Promise<string> {
  const session = await getSession();
  if (!session) redirect("/login");
  const active = await getActiveOrgId();
  const ms = await myMemberships(session.user.id);
  const id = (active && ms.some((m) => m.orgId === active) ? active : ms[0]?.orgId) ?? null;
  if (!id) throw new Error("No organisation");
  return id;
}

export async function dryRunImport(csv: string) {
  const oid = await orgId();
  const res = await apiFetch("/contacts/import", { method: "POST", orgId: oid, body: { rows: parseCsv(csv), dryRun: true } });
  if (!res.ok) throw new Error((res.data as any)?.message ?? "Dry run failed");
  return res.data as { created: number; updated: number; errors: number; report: Array<{ index: number; action: string; phone?: string; error?: string }> };
}

export async function commitImport(csv: string) {
  const oid = await orgId();
  const res = await apiFetch("/contacts/import", { method: "POST", orgId: oid, body: { rows: parseCsv(csv), dryRun: false } });
  if (!res.ok) throw new Error((res.data as any)?.message ?? "Import failed");
  return res.data as { created: number; updated: number; errors: number };
}
