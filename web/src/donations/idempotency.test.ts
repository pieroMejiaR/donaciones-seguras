import { describe, expect, it } from "vitest";
import { createIdempotencyTracker } from "./idempotency";

function sequentialKeys() {
  let next = 0;
  return () => `clave-${++next}`;
}

const payload = { projectId: "p-1", amountCents: 1_000 };

describe("createIdempotencyTracker (CA-05.4)", () => {
  it("reutiliza la clave mientras se reintenta la misma carga", () => {
    const tracker = createIdempotencyTracker(sequentialKeys());

    expect(tracker.keyFor(payload)).toBe("clave-1");
    expect(tracker.keyFor({ ...payload })).toBe("clave-1");
  });

  it("usa otra clave si cambia el monto o el proyecto", () => {
    const tracker = createIdempotencyTracker(sequentialKeys());

    expect(tracker.keyFor(payload)).toBe("clave-1");
    expect(tracker.keyFor({ ...payload, amountCents: 2_000 })).toBe("clave-2");
    expect(tracker.keyFor({ ...payload, amountCents: 2_000, projectId: "p-2" })).toBe("clave-3");
    // Volver a la carga original es un intento nuevo, no el anterior.
    expect(tracker.keyFor(payload)).toBe("clave-4");
  });

  it("tras reiniciar, la misma carga es una donación nueva", () => {
    const tracker = createIdempotencyTracker(sequentialKeys());

    tracker.keyFor(payload);
    tracker.reset();

    expect(tracker.keyFor(payload)).toBe("clave-2");
  });

  it("por defecto genera UUID v4", () => {
    const key = createIdempotencyTracker().keyFor(payload);
    expect(key).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});
