import { describe, expect, it } from "vitest";
import type { MollieCustomer, MolliePayment } from "../api/mollie";
import type { NormalizedContact } from "../types";
import {
  mergeByEmail,
  normalizeEmail,
  normalizePayment,
  splitName,
} from "./normalize";

describe("normalizeEmail", () => {
  it("lowercases and trims", () => {
    expect(normalizeEmail("  USER@EXAMPLE.COM  ")).toBe("user@example.com");
  });

  it("returns null for missing input", () => {
    expect(normalizeEmail(null)).toBeNull();
    expect(normalizeEmail(undefined)).toBeNull();
    expect(normalizeEmail("")).toBeNull();
  });

  it("rejects strings that don't look like emails", () => {
    expect(normalizeEmail("not-an-email")).toBeNull();
    // No TLD — easily forgotten edge case.
    expect(normalizeEmail("user@host")).toBeNull();
    // Bare dot, no host.
    expect(normalizeEmail("user@.com")).toBeNull();
    // Whitespace inside.
    expect(normalizeEmail("user @example.com")).toBeNull();
  });

  it("accepts plus-addressing and subdomains", () => {
    expect(normalizeEmail("user+tag@sub.example.com")).toBe(
      "user+tag@sub.example.com",
    );
  });
});

describe("splitName", () => {
  it("splits on the first whitespace, not the last", () => {
    // This is the Dutch / Belgian case that's easy to break.
    expect(splitName("Clara van der Berg")).toEqual({
      firstName: "Clara",
      lastName: "van der Berg",
    });
  });

  it("returns single names as first only", () => {
    expect(splitName("Madonna")).toEqual({
      firstName: "Madonna",
      lastName: null,
    });
  });

  it("collapses internal whitespace", () => {
    expect(splitName("  Jan   de    Vries  ")).toEqual({
      firstName: "Jan",
      lastName: "de Vries",
    });
  });

  it("handles empty / whitespace-only input", () => {
    expect(splitName(null)).toEqual({ firstName: null, lastName: null });
    expect(splitName(undefined)).toEqual({ firstName: null, lastName: null });
    expect(splitName("")).toEqual({ firstName: null, lastName: null });
    expect(splitName("   ")).toEqual({ firstName: null, lastName: null });
  });
});

describe("normalizePayment", () => {
  const baseCustomer: MollieCustomer = {
    resource: "customer",
    id: "cst_x",
    name: "Alice Vermeer",
    email: "alice@example.test",
  };

  function makePayment(overrides: Partial<MolliePayment> = {}): MolliePayment {
    return {
      resource: "payment",
      id: "tr_x",
      mode: "test",
      status: "paid",
      amount: { currency: "EUR", value: "10.00" },
      description: "Premium Plan",
      createdAt: "2025-01-01T00:00:00+00:00",
      paidAt: "2025-01-01T00:01:00+00:00",
      customerId: "cst_x",
      ...overrides,
    };
  }

  it("uses billingEmail when present", () => {
    const r = normalizePayment(
      makePayment({ billingEmail: "Billing@EXAMPLE.test" }),
      { customers: new Map() },
    );
    expect(r?.email).toBe("billing@example.test");
  });

  it("falls back to the customer record's email when billingEmail is absent", () => {
    const r = normalizePayment(makePayment({}), {
      customers: new Map([["cst_x", baseCustomer]]),
    });
    expect(r?.email).toBe("alice@example.test");
  });

  it("returns null when there's no usable email anywhere", () => {
    const p = makePayment({});
    p.customerId = undefined;
    expect(normalizePayment(p, { customers: new Map() })).toBeNull();
  });

  it("uses details.consumerName when no customer record exists", () => {
    const r = normalizePayment(
      makePayment({
        customerId: undefined,
        billingEmail: "bob@example.test",
        details: { consumerName: "Bob Janssen" },
      }),
      { customers: new Map() },
    );
    expect(r?.firstName).toBe("Bob");
    expect(r?.lastName).toBe("Janssen");
  });

  it("captures product, payment id, and paidAt timestamp", () => {
    const r = normalizePayment(makePayment({}), {
      customers: new Map([["cst_x", baseCustomer]]),
    });
    expect(r?.productName).toBe("Premium Plan");
    expect(r?.paymentId).toBe("tr_x");
    expect(r?.paymentDate).toBe("2025-01-01T00:01:00+00:00");
  });

  it("uses createdAt when paidAt is absent (e.g. unpaid payments)", () => {
    const p = makePayment({});
    p.paidAt = undefined;
    const r = normalizePayment(p, {
      customers: new Map([["cst_x", baseCustomer]]),
    });
    expect(r?.paymentDate).toBe("2025-01-01T00:00:00+00:00");
  });

  it("handles a name like 'Clara van der Berg' end-to-end", () => {
    const r = normalizePayment(makePayment({}), {
      customers: new Map([
        ["cst_x", { ...baseCustomer, name: "Clara van der Berg" }],
      ]),
    });
    expect(r?.firstName).toBe("Clara");
    expect(r?.lastName).toBe("van der Berg");
  });
});

describe("mergeByEmail", () => {
  function contact(
    email: string,
    paymentId: string,
    paymentDate: string,
    firstName: string | null = null,
  ): NormalizedContact {
    return {
      email,
      firstName,
      lastName: null,
      productName: null,
      paymentId,
      paymentDate,
    };
  }

  it("keeps the latest payment per email", () => {
    const merged = mergeByEmail([
      contact("a@b.test", "tr_old", "2025-01-01", "Old"),
      contact("a@b.test", "tr_new", "2025-02-01", "New"),
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0].firstName).toBe("New");
    expect(merged[0].paymentId).toBe("tr_new");
  });

  it("preserves distinct emails", () => {
    const merged = mergeByEmail([
      contact("a@b.test", "tr_1", "2025-01-01"),
      contact("b@c.test", "tr_2", "2025-01-01"),
    ]);
    expect(merged).toHaveLength(2);
  });

  it("picks the latest regardless of input order", () => {
    // Same data, opposite input order — outcome must be identical.
    const newerFirst = mergeByEmail([
      contact("a@b.test", "tr_new", "2025-02-01", "Newer"),
      contact("a@b.test", "tr_old", "2025-01-01", "Older"),
    ]);
    const olderFirst = mergeByEmail([
      contact("a@b.test", "tr_old", "2025-01-01", "Older"),
      contact("a@b.test", "tr_new", "2025-02-01", "Newer"),
    ]);
    expect(newerFirst[0].firstName).toBe("Newer");
    expect(olderFirst[0].firstName).toBe("Newer");
  });

  it("returns an empty array for empty input", () => {
    expect(mergeByEmail([])).toEqual([]);
  });
});
