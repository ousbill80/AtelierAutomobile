import { afterEach, describe, expect, it } from "vitest";
import { resetSensitiveRateLimiter, webhookRateLimitResponse } from "./sensitiveRateLimit";

describe("webhookRateLimitResponse", () => {
  afterEach(() => {
    resetSensitiveRateLimiter();
  });

  it("laisse passer les premiers appels puis répond 429", () => {
    const req = new Request("http://localhost/api/webhooks/whatsapp", {
      method: "POST",
      headers: { "x-forwarded-for": "198.51.100.20" },
    });
    for (let i = 0; i < 120; i++) {
      expect(webhookRateLimitResponse(req)).toBeNull();
    }
    const blocked = webhookRateLimitResponse(req);
    expect(blocked?.status).toBe(429);
  });
});
