import { describe, expect, it } from "vitest";

import {
  isGreaterStableVersion,
  parseReleaseArguments,
  parseStableVersion,
} from "../../scripts/release";

describe("release version validation", () => {
  it.each(["1.0", "v1.0.0", "1.0.0-alpha.1", "01.0.0", "1.00.0", "1.0.0+build"])(
    "rejects %s",
    (version) => {
      expect(() => parseStableVersion(version)).toThrow("stable semver");
    },
  );

  it("compares stable versions without numeric precision loss", () => {
    expect(isGreaterStableVersion("1.10.0", "1.9.9")).toBe(true);
    expect(isGreaterStableVersion("9007199254740993.0.0", "9007199254740992.999.999")).toBe(true);
    expect(isGreaterStableVersion("1.0.0", "1.0.0")).toBe(false);
    expect(isGreaterStableVersion("0.9.9", "1.0.0")).toBe(false);
  });

  it("rejects versions that exceed the release commit subject limit", () => {
    expect(parseStableVersion(`${"1".repeat(66)}.0.0`)).toHaveLength(3);
    expect(() => parseStableVersion(`${"1".repeat(67)}.0.0`)).toThrow("stable semver");
  });

  it("requires an explicit push", () => {
    expect(parseReleaseArguments(["1.2.3", "--push"])).toBe("1.2.3");
    expect(() => parseReleaseArguments(["1.2.3"])).toThrow("Usage:");
    expect(() => parseReleaseArguments(["1.2.3", "--dry-run"])).toThrow("Usage:");
  });
});
