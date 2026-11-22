import { describe, expect, it } from "vite-plus/test";

import {
  needsUpstreamSync,
  planConflictResolution,
  sanitizeBranchTag,
  selectLatestUpstreamNightly,
  selectLatestUpstreamRelease,
  selectLatestUpstreamStable,
  type UpstreamSyncState,
} from "./bot-upstream-sync.ts";

describe("bot-upstream-sync", () => {
  it("picks the newest non-draft, non-prerelease stable release by published_at", () => {
    const releases = [
      {
        tag_name: "v0.1.12",
        draft: true,
        prerelease: false,
        published_at: "2026-11-22T09:00:00Z",
      },
      {
        tag_name: "v0.1.12-nightly.20261122.4900",
        draft: false,
        prerelease: true,
        published_at: "2026-11-22T08:30:00Z",
      },
      {
        tag_name: "v0.1.12-preview.20261122.4901",
        draft: false,
        prerelease: true,
        published_at: "2026-11-22T08:40:00Z",
      },
      {
        tag_name: "v0.1.10",
        draft: false,
        prerelease: false,
        published_at: "2026-11-17T01:44:04Z",
      },
      {
        tag_name: "v0.1.11",
        draft: false,
        prerelease: false,
        published_at: "2026-11-20T07:38:08Z",
      },
    ];

    expect(selectLatestUpstreamStable(releases)?.tag_name).toBe("v0.1.11");
    expect(selectLatestUpstreamRelease(releases, "stable")?.tag_name).toBe("v0.1.11");
    expect(selectLatestUpstreamRelease(releases, "nightly")?.tag_name).toBe(
      "v0.1.12-nightly.20261122.4900",
    );
  });

  it("picks the newest non-draft nightly release by published_at", () => {
    const latest = selectLatestUpstreamNightly([
      {
        tag_name: "v0.1.12-nightly.20261122.9999",
        draft: true,
        published_at: "2026-11-22T09:00:00Z",
      },
      {
        tag_name: "v0.1.12-preview.20261122.9998",
        draft: false,
        published_at: "2026-11-22T08:30:00Z",
      },
      {
        tag_name: "v0.1.11",
        draft: false,
        published_at: "2026-11-22T08:00:00Z",
      },
      {
        tag_name: "v0.1.12-nightly.20261121.4800",
        draft: false,
        published_at: "2026-11-21T12:00:00Z",
      },
      {
        tag_name: "v0.1.12-nightly.20261122.4900",
        draft: false,
        published_at: "2026-11-22T07:00:00Z",
      },
    ]);

    expect(latest?.tag_name).toBe("v0.1.12-nightly.20261122.4900");
  });

  it("determines whether a new upstream stable release needs syncing", () => {
    const state: UpstreamSyncState = {
      upstreamRepo: "pingdotgg/t3code",
      channel: "stable",
      lastSyncedTag: "v0.1.11",
      lastSyncedSha: "0dc32b5c8b",
      lastSyncedAt: "2026-11-20T08:00:00Z",
    };

    expect(
      needsUpstreamSync(state, {
        tag_name: "v0.1.11",
        published_at: "2026-11-20T07:38:08Z",
      }),
    ).toBe(false);

    expect(
      needsUpstreamSync(state, {
        tag_name: "v0.1.12",
        published_at: "2026-11-24T07:00:00Z",
      }),
    ).toBe(true);
  });

  it("separates auto-regeneratable generated conflicts from manual source conflicts", () => {
    expect(planConflictResolution(["pnpm-lock.yaml", "apps/web/src/routeTree.gen.ts"])).toEqual({
      autoResolvable: true,
      generatedFiles: ["pnpm-lock.yaml", "apps/web/src/routeTree.gen.ts"],
      manualFiles: [],
    });

    expect(
      planConflictResolution(["pnpm-lock.yaml", "apps/web/src/components/Sidebar.tsx"]),
    ).toEqual({
      autoResolvable: false,
      generatedFiles: ["pnpm-lock.yaml"],
      manualFiles: ["apps/web/src/components/Sidebar.tsx"],
    });
  });

  it("sanitizes tags for branch names", () => {
    expect(sanitizeBranchTag("v0.1.12-nightly.20261122.4900")).toBe(
      "v0.1.12-nightly.20261122.4900",
    );
  });
});
