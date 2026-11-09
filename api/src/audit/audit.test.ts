import { describe, expect, it } from "vitest";
import { ForbiddenError, UnauthorizedError } from "../auth/errors.js";
import { BadRequestError, ConflictError } from "../shared/http.js";
import { auditItem, buildAuditEvent, outcomeFromError, pseudonymize } from "./audit.js";

describe("Módulo audit (CA-08.3, CA-10.2)", () => {
  const sub = "11111111-1111-4111-8111-111111111111";

  it("el seudónimo es estable, no contiene el sub y no lo deja reconstruir a simple vista", () => {
    const ref = pseudonymize(sub);

    expect(ref).toMatch(/^usr_[0-9a-f]{16}$/);
    expect(pseudonymize(sub)).toBe(ref);
    expect(ref).not.toContain(sub.slice(0, 8));
    expect(pseudonymize("33333333-3333-4333-8333-333333333333")).not.toBe(ref);
  });

  it("el evento incluye timestamp, requestId, actor, recurso, acción y resultado", () => {
    const event = buildAuditEvent({
      requestId: "req-1",
      actorRef: pseudonymize(sub),
      action: "PROJECT_PUBLISH",
      resourceRef: "project/abc",
      outcome: "SUCCESS",
    });

    expect(event).toEqual({
      eventId: expect.stringMatching(/^[0-9a-f-]{36}$/),
      timestamp: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
      requestId: "req-1",
      actorRef: pseudonymize(sub),
      action: "PROJECT_PUBLISH",
      resourceRef: "project/abc",
      outcome: "SUCCESS",
    });
  });

  it("indexa por acción y fecha para filtrar en GET /v1/audit", () => {
    const event = buildAuditEvent({
      timestamp: "2026-11-08T12:00:00.000Z",
      requestId: "req-1",
      actorRef: "usr_x",
      action: "PROJECT_CREATE",
      resourceRef: "project/new",
      outcome: "DENIED",
      reason: "FORBIDDEN_ROLE",
    });

    expect(auditItem(event)).toMatchObject({
      pk: `EVENT#${event.eventId}`,
      gsi1pk: "ACTION#PROJECT_CREATE",
      gsi1sk: `2026-11-08T12:00:00.000Z#${event.eventId}`,
    });
  });

  it.each([
    [new UnauthorizedError("MISSING_TOKEN"), "DENIED", "MISSING_TOKEN"],
    [new ForbiddenError("FORBIDDEN_ROLE"), "DENIED", "FORBIDDEN_ROLE"],
    [new BadRequestError("VALIDATION_ERROR"), "REJECTED", "VALIDATION_ERROR"],
    [new ConflictError("PROJECT_ALREADY_PUBLISHED"), "REJECTED", "PROJECT_ALREADY_PUBLISHED"],
    [new Error("boom"), "ERROR", "INTERNAL_SERVER_ERROR"],
  ])("clasifica %s como %s", (error, outcome, reason) => {
    expect(outcomeFromError(error)).toEqual({ outcome, reason });
  });
});
