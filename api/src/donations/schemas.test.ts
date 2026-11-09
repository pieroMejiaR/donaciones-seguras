import { describe, expect, it } from "vitest";
import { CreateDonationInput, IdempotencyKey, SimulateDonationInput } from "./schemas.js";

const PROJECT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

describe("CreateDonationInput (HU-05)", () => {
  it.each([100, 15_050, 100_000])("CA-05.1: acepta %i céntimos", (amountCents) => {
    expect(CreateDonationInput.safeParse({ projectId: PROJECT_ID, amountCents }).success).toBe(true);
  });

  it.each([
    ["S/ 0", 0],
    ["S/ 0,99", 99],
    ["S/ 1 000,01", 100_001],
    ["un monto negativo", -500],
    ["más de dos decimales", 150.5],
    ["un monto como texto", "1000"],
  ])("T04 / CA-05.2: rechaza %s", (_caso, amountCents) => {
    expect(CreateDonationInput.safeParse({ projectId: PROJECT_ID, amountCents }).success).toBe(false);
  });

  it("CA-05.3: rechaza donorSub o donorId enviados por el cliente", () => {
    for (const field of ["donorSub", "donorId"]) {
      const result = CreateDonationInput.safeParse({
        projectId: PROJECT_ID,
        amountCents: 1000,
        [field]: "otro-usuario",
      });
      expect(result.success).toBe(false);
    }
  });

  it("CA-05.5: rechaza campos de pago como cardNumber o cvv", () => {
    const result = CreateDonationInput.safeParse({
      projectId: PROJECT_ID,
      amountCents: 1000,
      cardNumber: "4111111111111111",
      cvv: "123",
    });
    expect(result.success).toBe(false);
  });

  it("rechaza un projectId que no es UUID", () => {
    expect(CreateDonationInput.safeParse({ projectId: "1 OR 1=1", amountCents: 1000 }).success).toBe(false);
  });
});

describe("IdempotencyKey (CA-05.4)", () => {
  it("acepta un UUID v4 generado por la SPA", () => {
    expect(IdempotencyKey.safeParse(crypto.randomUUID()).success).toBe(true);
  });

  it.each(["", "corta", "x".repeat(129), "clave con espacios y ñ"])("rechaza %j", (key) => {
    expect(IdempotencyKey.safeParse(key).success).toBe(false);
  });
});

describe("SimulateDonationInput (CA-06.1)", () => {
  it("solo admite estados terminales", () => {
    expect(SimulateDonationInput.safeParse({ outcome: "CONFIRMADA_SIMULADA" }).success).toBe(true);
    expect(SimulateDonationInput.safeParse({ outcome: "RECHAZADA_SIMULADA" }).success).toBe(true);
    expect(SimulateDonationInput.safeParse({ outcome: "PENDIENTE_SIMULACION" }).success).toBe(false);
  });
});
