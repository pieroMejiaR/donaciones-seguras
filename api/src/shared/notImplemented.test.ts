import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { describe, expect, it } from "vitest";
import { notImplemented } from "./notImplemented.js";

describe("notImplemented", () => {
  it("responde 501 con el formato uniforme de error", async () => {
    const event = { requestContext: { requestId: "req-123" } } as unknown as APIGatewayProxyEventV2;

    const response = await notImplemented(event);

    expect(response.statusCode).toBe(501);
    expect(JSON.parse(response.body ?? "")).toEqual({
      code: "NOT_IMPLEMENTED",
      message: expect.any(String),
      requestId: "req-123",
    });
  });
});
