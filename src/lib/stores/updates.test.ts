import { describe, expect, it } from "vitest";
import { isNewer } from "./updates.svelte";

describe("update versions", () => {
  it("compares like updates.rs", () => {
    expect(isNewer("0.2.0", "0.1.0")).toBe(true);
    expect(isNewer("v0.1.1", "0.1.0")).toBe(true);
    expect(isNewer("0.10.0", "0.9.0")).toBe(true);
    expect(isNewer("1.0.0", "0.99.99")).toBe(true);
    expect(isNewer("0.1.0", "0.1.0")).toBe(false);
    expect(isNewer("0.1.0", "0.2.0")).toBe(false);
  });

  it("treats dev builds as coming after their base release", () => {
    expect(isNewer("0.1.0", "0.1.0-dev.84")).toBe(false);
    expect(isNewer("0.1.1", "0.1.0-dev.84")).toBe(true);
  });

  it("reads versions with extra text", () => {
    expect(isNewer("0.2.0", "0.1.0 (browser preview)")).toBe(true);
  });

  it("never offers nonsense", () => {
    expect(isNewer("latest", "0.1.0")).toBe(false);
    expect(isNewer("0.2.0", "")).toBe(false);
    expect(isNewer("0.2.0-beta.1", "0.1.0")).toBe(false);
  });
});
