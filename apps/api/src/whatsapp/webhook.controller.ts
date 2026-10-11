import { Controller, Get, Inject, Post, Req, Res, Logger } from "@nestjs/common";
import { createHmac, timingSafeEqual } from "node:crypto";
import type { Request, Response } from "express";
import { WhatsappService } from "./whatsapp.service";
import { parseMetaPayload } from "./meta.provider";

function validSignature(raw: Buffer, signature: string | undefined): boolean {
  if (process.env.SKIP_WHATSAPP_SIGNATURE === "1") return true;
  const secret = process.env.WHATSAPP_APP_SECRET ?? "";
  if (!secret || !signature) return false;
  const expected = `sha256=${createHmac("sha256", secret).update(raw).digest("hex")}`;
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
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
    try {
      for (const msg of parseMetaPayload(req.body)) {
        await this.wa.ingest(msg);
      }
    } catch (e) {
      this.log.error(`ingest failed: ${(e as Error).message}`);
    }
    return res.status(200).send("EVENT_RECEIVED");
  }
}
