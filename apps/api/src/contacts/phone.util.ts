import { BadRequestException } from "@nestjs/common";

/** Strict-ish E.164: strips common formatting, requires + or 00 prefix. */
export function normalizePhone(input: unknown): string {
  if (typeof input !== "string" || !input.trim()) {
    throw new BadRequestException("Phone is required in international format, e.g. +15551234567");
  }
  const cleaned = input.replace(/[\s\-().]/g, "");
  const e164 = cleaned.startsWith("00") ? `+${cleaned.slice(2)}` : cleaned;
  if (!/^\+\d{7,15}$/.test(e164)) {
    throw new BadRequestException(`Invalid phone number: ${input}`);
  }
  return e164;
}
