import { describe, expect, it } from "vitest";
import { handler } from "./health.js";

describe("GET /v1/health", () => {
  it("responde 200 con status ok", async () => {
    const res = await handler();

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body ?? "")).toEqual({ status: "ok" });
  });
});
