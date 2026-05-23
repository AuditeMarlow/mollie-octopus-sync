import { describe, expect, it } from "vitest";
import { detectMode } from "./mollie";

describe("detectMode", () => {
  it("identifies a live key by its prefix", () => {
    expect(detectMode("live_abc123XYZ")).toBe("live");
  });

  it("identifies a test key by its prefix", () => {
    expect(detectMode("test_xyz789")).toBe("test");
  });

  it("returns null for unprefixed input", () => {
    expect(detectMode("some-key")).toBeNull();
    expect(detectMode("")).toBeNull();
  });

  it("is case-sensitive — Mollie prefixes are lowercase", () => {
    expect(detectMode("LIVE_abc")).toBeNull();
    expect(detectMode("Test_abc")).toBeNull();
  });
});
