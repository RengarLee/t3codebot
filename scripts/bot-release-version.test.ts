import { describe, expect, it } from "vite-plus/test";

import {
  computeNextDailyNightlySequence,
  computeNightlyBaseVersion,
  resolveBotReleaseVersion,
} from "./bot-release-version.ts";

describe("bot-release-version", () => {
  it("computes the next nightly base version from apps/desktop/package.json", () => {
    expect(computeNightlyBaseVersion("0.1.11")).toBe("0.1.12");
    expect(computeNightlyBaseVersion("0.1.11-nightly.20261120.1")).toBe("0.1.12");
  });

  it("increments the daily sequence strictly above existing tags for the same base and date", () => {
    const tags = [
      "v0.1.11",
      "v0.1.12-nightly.20261121.99",
      "v0.1.12-nightly.20261122.1",
      "v0.1.12-nightly.20261122.15",
      "v0.1.12-nightly.20261122.3",
      // Upstream tags fetched under a prefix must be ignored.
      "upstream/v0.1.12-nightly.20261122.4900",
    ];

    expect(computeNextDailyNightlySequence("0.1.12", "20261122", tags)).toBe(16);
    expect(computeNextDailyNightlySequence("0.1.12", "20261123", tags)).toBe(1);
    expect(computeNextDailyNightlySequence("0.1.13", "20261122", tags)).toBe(1);
  });

  it("resolves monotonically increasing versions across upstream-sync and bot releases on the same day", () => {
    const syncRelease = resolveBotReleaseVersion({
      desktopPackageVersion: "0.1.11",
      botPackageVersion: "0.1.0",
      channel: "nightly",
      source: "upstream-sync",
      date: "20261122",
      existingTags: ["v0.1.12-nightly.20261122.1"],
      upstreamTag: "v0.1.12-nightly.20261122.4900",
      sha: "abcdef1234567890",
    });

    expect(syncRelease).toEqual({
      baseVersion: "0.1.12",
      version: "0.1.12-nightly.20261122.2",
      tag: "v0.1.12-nightly.20261122.2",
      botVersion: "0.1.0",
      upstreamLabel: "v0.1.12-nightly.20261122.4900",
      releaseName:
        "T3 Code Bot Nightly 0.1.12-nightly.20261122.2 (sync: v0.1.12-nightly.20261122.4900 · bot 0.1.0)",
      isPrerelease: true,
      makeLatest: false,
    });

    const botRelease = resolveBotReleaseVersion({
      desktopPackageVersion: "0.1.11",
      botPackageVersion: "0.2.0",
      channel: "nightly",
      source: "bot",
      date: "20261122",
      existingTags: ["v0.1.12-nightly.20261122.1", syncRelease.tag],
      upstreamTag: "v0.1.12-nightly.20261122.4900",
      sha: "1234567890abcdef",
    });

    expect(botRelease).toEqual({
      baseVersion: "0.1.12",
      version: "0.1.12-nightly.20261122.3",
      tag: "v0.1.12-nightly.20261122.3",
      botVersion: "0.2.0",
      upstreamLabel: "v0.1.12-nightly.20261122.4900",
      releaseName:
        "T3 Code Bot Nightly 0.1.12-nightly.20261122.3 (bot 0.2.0 · base v0.1.12-nightly.20261122.4900)",
      isPrerelease: true,
      makeLatest: false,
    });
  });

  it("rejects custom suffixes that would break T3's nightly/stable channel parser", () => {
    expect(() =>
      resolveBotReleaseVersion({
        desktopPackageVersion: "0.1.11",
        botPackageVersion: "0.1.0",
        channel: "nightly",
        source: "bot",
        date: "20261122",
        existingTags: [],
        explicitVersion: "0.1.12-bot.1",
        sha: "abcdef123456",
      }),
    ).toThrow(/Must match <X\.Y\.Z>-nightly\.<YYYYMMDD>\.<N>/);

    expect(() =>
      resolveBotReleaseVersion({
        desktopPackageVersion: "0.1.11",
        botPackageVersion: "0.1.0",
        channel: "stable",
        source: "bot",
        date: "20261122",
        existingTags: [],
        explicitVersion: "0.1.12-bot.1",
        sha: "abcdef123456",
      }),
    ).toThrow(/Must match <X\.Y\.Z>/);
  });
});
