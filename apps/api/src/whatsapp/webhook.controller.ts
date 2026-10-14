import { Controller, Get, Inject, Param, Post, Req, Res, Logger } from "@nestjs/common";
import type { Request, Response } from "express";
import { WhatsappService } from "./whatsapp.service";
import { parseMetaPayload, parseMetaStatuses } from "./meta.provider";
import { checkSignature } from "./webhook-verify";

function validSignatureWith(secret: string, raw: Buffer, signature: string | undefined): boolean {
  return checkSignature(secret, raw, signature);
}

function validSignature(raw: Buffer, signature: string | undefined): boolean {
  if (process.env.SKIP_WHATSAPP_SIGNATURE === "1") return true;
  return validSignatureWith(process.env.WHATSAPP_APP_SECRET ?? "", raw, signature);
}

/** Public Meta webhook. No session guards — Meta calls this, not users. */
@Controller("whatsapp")
export class WebhookController {
  private readonly log = new Logger(WebhookController.name);

  constructor(@Inject(WhatsappService) private readonly wa: WhatsappService) {}

  @Get("webhook")
  verify(@Req() req: Request, @Res() res: Response) {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];
    const expected = process.env.WHATSAPP_VERIFY_TOKEN ?? "";
    if (mode === "subscribe" && expected && token === expected) {
      return res.status(200).send(challenge);
    }
    return res.status(403).send("Forbidden");
  }

  @Post("webhook")
  async receive(@Req() req: Request & { rawBody?: Buffer }, @Res() res: Response) {
    const raw = req.rawBody ?? Buffer.from(JSON.stringify(req.body ?? {}));
    if (!validSignature(raw, req.headers["x-hub-signature-256"] as string | undefined)) {
      return res.status(401).send("Bad signature");
    }
    await this.ingestBody(req.body);
    return res.status(200).send("EVENT_RECEIVED");
  }

  /**
   * Tenant webhook (manual per-org setup). Each org pastes its own verify
   * token + app secret in Settings and points Meta at this tenant path.
   * Secrets are compared/decrypted fail-closed and never logged.
   */
  @Get("webhook/org/:orgId")
  async verifyOrg(@Param("orgId") orgId: string, @Req() req: Request, @Res() res: Response) {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];
    if (mode !== "subscribe" || typeof challenge !== "string") {
      return res.status(403).send("Forbidden");
    }
    const ok = await this.wa.checkOrgVerifyToken(orgId, token);
    if (!ok) return res.status(403).send("Forbidden");
    return res.status(200).send(challenge);
  }

  @Post("webhook/org/:orgId")
  async receiveOrg(
    @Param("orgId") orgId: string,
    @Req() req: Request & { rawBody?: Buffer },
    @Res() res: Response,
  ) {
    if (process.env.SKIP_WHATSAPP_SIGNATURE !== "1") {
      const raw = req.rawBody ?? Buffer.from(JSON.stringify(req.body ?? {}));
      const sig = req.headers["x-hub-signature-256"] as string | undefined;
      const { configured, secret } = await this.wa.getOrgAppSecret(orgId);
      const ok = configured
        ? secret !== null && validSignatureWith(secret, raw, sig)
        : validSignature(raw, sig);
      if (!ok) return res.status(401).send("Bad signature");
    }
    await this.ingestBody(req.body, orgId);
    return res.status(200).send("EVENT_RECEIVED");
  }

  private async ingestBody(body: unknown, expectedOrgId?: string) {
    try {
      for (const msg of parseMetaPayload(body)) {
        await this.wa.ingest(msg, expectedOrgId ? { expectedOrgId } : undefined);
      }
      const statuses = parseMetaStatuses(body);
      if (statuses.length > 0) {
        // Tenant path: receipts must not touch another tenant's messages.
        await this.wa.applyStatuses(statuses, expectedOrgId ? { expectedOrgId } : undefined);
      }
    } catch (e) {
      this.log.error(`ingest failed: ${(e as Error).message}`);
    }
  }
}
