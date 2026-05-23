import { describe, expect, it } from "vitest";
import { extractErrorMessage, isDuplicateError } from "./emailoctopus";
import { ApiError } from "./errors";

describe("isDuplicateError", () => {
  it("recognizes the v2 already-exists problem type", () => {
    const body = JSON.stringify({
      title: "Conflict",
      status: 409,
      type: "https://emailoctopus.com/api-documentation/v2#already-exists",
    });
    const err = new ApiError(
      "conflict",
      409,
      "https://api.emailoctopus.com/lists/x/contacts",
      body,
    );
    expect(isDuplicateError(err)).toBe(true);
  });

  it("treats any 409 as a duplicate even if the body isn't JSON", () => {
    // The API could change its problem-type URL — we don't want to misclassify
    // every 409 in that case. Falling back to "409 == conflict == duplicate" is
    // intentional.
    const err = new ApiError("conflict", 409, "x", "not json");
    expect(isDuplicateError(err)).toBe(true);
  });

  it("returns false for non-409 ApiErrors", () => {
    expect(isDuplicateError(new ApiError("server", 500, "x", "{}"))).toBe(
      false,
    );
    expect(isDuplicateError(new ApiError("auth", 401, "x", "{}"))).toBe(false);
  });

  it("returns false for non-ApiError values", () => {
    expect(isDuplicateError(new Error("plain"))).toBe(false);
    expect(isDuplicateError(undefined)).toBe(false);
    expect(isDuplicateError(null)).toBe(false);
    expect(isDuplicateError("a string")).toBe(false);
  });
});

describe("extractErrorMessage", () => {
  it("formats an RFC 7807 problem detail with field errors", () => {
    const body = JSON.stringify({
      title: "Bad Request",
      detail: "email_address is invalid",
      errors: [{ pointer: "/email_address", detail: "must be a valid email" }],
    });
    const err = new ApiError("bad request", 400, "x", body);
    const msg = extractErrorMessage(err);
    expect(msg).toContain("email_address is invalid");
    expect(msg).toContain("must be a valid email");
  });

  it("falls back to title when no detail is provided", () => {
    const body = JSON.stringify({ title: "Forbidden" });
    const err = new ApiError("forbidden", 403, "x", body);
    expect(extractErrorMessage(err)).toBe("Forbidden");
  });

  it("falls back to the ApiError message when body isn't JSON", () => {
    const err = new ApiError("network thing", 502, "x", "not json");
    expect(extractErrorMessage(err)).toBe("network thing");
  });

  it("handles non-ApiError values gracefully", () => {
    expect(extractErrorMessage(new Error("plain"))).toBe("plain");
    expect(extractErrorMessage("just a string")).toBe("just a string");
  });
});
