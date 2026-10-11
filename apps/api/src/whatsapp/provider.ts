/** Provider-agnostic WhatsApp sending. Phase 2 ships Meta Cloud API;
 * additional BSPs implement this interface without touching domain logic. */
export interface SendTextResult {
  providerMessageId: string;
}

export interface WhatsappProvider {
  readonly name: string;
  sendText(opts: {
    phoneNumberId: string;
    accessToken: string;
    to: string;
    body: string;
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
}
