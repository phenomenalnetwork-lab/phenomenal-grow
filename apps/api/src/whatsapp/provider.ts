/** Provider-agnostic WhatsApp sending. Phase 2 ships Meta Cloud API;
 * additional BSPs implement this interface without touching domain logic. */
export interface SendTextResult {
  providerMessageId: string;
  via: "text" | "template";
}

export interface WhatsappProvider {
  readonly name: string;
  sendText(opts: {
    phoneNumberId: string;
    accessToken: string;
    to: string;
    body: string;
  }): Promise<SendTextResult>;
  sendTemplate(opts: {
    phoneNumberId: string;
    accessToken: string;
    to: string;
    template: string;
    language?: string;
    bodyText?: string;
  }): Promise<SendTextResult>;
  /** Smart send: text inside Meta's 24h service window, approved template outside it. */
  sendOutbound(opts: {
    phoneNumberId: string;
    accessToken: string;
    to: string;
    body: string;
    contactName: string;
    lastInboundAt?: Date | null;
  }): Promise<SendTextResult>;
  fetchMedia(opts: {
    mediaId: string;
    accessToken: string;
  }): Promise<{ bytes: Uint8Array; mime: string } | null>;
}

export interface InboundMessage {
  providerMessageId: string;
  from: string;
  profileName?: string;
  phoneNumberId: string;
  timestamp: Date;
  type: string;
  text?: string;
  mediaId?: string;
  mediaMime?: string;
  /** Click-to-WhatsApp ad referral (attribution passthrough). */
  referral?: {
    sourceUrl?: string;
    sourceType?: string;
    ctwaClid?: string;
  };
}
