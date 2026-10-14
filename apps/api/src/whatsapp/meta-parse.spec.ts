import { describe, expect, it } from "vitest";
import { parseMetaPayload } from "./meta.provider";

function envelope(message: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  return {
    entry: [
      {
        changes: [
          {
            value: {
              messaging_product: "whatsapp",
              metadata: { phone_number_id: "15550009999" },
              contacts: [{ wa_id: "15551230000", profile: { name: "Ama K." } }],
              messages: [message],
              ...extra,
            },
          },
        ],
      },
    ],
  };
}

describe("parseMetaPayload", () => {
  it("parses a text message with profile name", () => {
    const [m] = parseMetaPayload(
      envelope({ from: "15551230000", id: "wamid.1", timestamp: "1790000000", type: "text", text: { body: "Hi" } }),
    );
    expect(m.providerMessageId).toBe("wamid.1");
    expect(m.from).toBe("15551230000");
    expect(m.profileName).toBe("Ama K.");
    expect(m.text).toBe("Hi");
    expect(m.phoneNumberId).toBe("15550009999");
  });

  it("extracts media id/mime and click-to-chat referral", () => {
    const [m] = parseMetaPayload(
      envelope({
        from: "15551230000",
        id: "wamid.2",
        timestamp: "1790000000",
        type: "image",
        image: { id: "media-9", mime_type: "image/jpeg" },
        referral: { source_url: "https://www.instagram.com/", source_type: "ad", ctwa_clid: "CLID1" },
      }),
    );
    expect(m.mediaId).toBe("media-9");
    expect(m.mediaMime).toBe("image/jpeg");
    expect(m.referral?.ctwaClid).toBe("CLID1");
  });

  it("skips status-only payloads (receipts are acked, not stored)", () => {
    const payload = {
      entry: [
        { changes: [{ value: { metadata: { phone_number_id: "1" }, statuses: [{ id: "wamid.9", status: "delivered" }] } }] },
      ],
    };
    expect(parseMetaPayload(payload)).toEqual([]);
  });

  it("skips empty payloads without throwing", () => {
    expect(parseMetaPayload({})).toEqual([]);
    expect(parseMetaPayload(null)).toEqual([]);
  });
});
