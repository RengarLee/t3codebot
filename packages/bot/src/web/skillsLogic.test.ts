import { describe, expect, it } from "vite-plus/test";

import { SkillTriggerSchema, type SkillRevisionSummary } from "../contracts.ts";
import { BOT_MESSAGES, translateBotMessage } from "./i18n.ts";
import { SKILL_MESSAGES } from "./i18nSkills.ts";
import {
  buildDiffRows,
  formatSkillTime,
  groupRevisionsByDay,
  isValidSkillName,
  latestLiveRevision,
  reviewNowStatus,
  SKILL_TRIGGER_LABEL_KEYS,
  skillTriggerLabelKey,
} from "./skillsLogic.ts";

const LOCALES = ["en", "zh", "de", "es", "fr", "ja", "ko", "pt-BR", "ru", "sv"] as const;

function revision(
  number: number,
  createdAt: string,
  overrides: Partial<SkillRevisionSummary> = {},
): SkillRevisionSummary {
  return {
    revision: number,
    parentRevision: number > 1 ? number - 1 : null,
    trigger: "user_manual",
    reason: "",
    threadId: null,
    botId: null,
    suggestionId: null,
    deleted: false,
    createdAt,
    ...overrides,
  };
}

describe("buildDiffRows", () => {
  it("shows every line as added when there is no parent", () => {
    const rows = buildDiffRows(null, "one\ntwo\n");
    expect(rows).toEqual([
      { kind: "add", text: "one", oldLine: null, newLine: 1 },
      { kind: "add", text: "two", oldLine: null, newLine: 2 },
    ]);
  });

  it("shows every line as removed for a deleted skill", () => {
    const rows = buildDiffRows("one\ntwo\n", null);
    expect(rows.map((row) => row.kind)).toEqual(["remove", "remove"]);
  });

  it("numbers old and new lines and keeps context around a change", () => {
    const before = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"].join("\n") + "\n";
    const after = before.replace("e\n", "E\n");
    const rows = buildDiffRows(before, after, 1);
    expect(rows).toEqual([
      { kind: "gap", hidden: 3 },
      { kind: "context", text: "d", oldLine: 4, newLine: 4 },
      { kind: "remove", text: "e", oldLine: 5, newLine: null },
      { kind: "add", text: "E", oldLine: null, newLine: 5 },
      { kind: "context", text: "f", oldLine: 6, newLine: 5 + 1 },
      { kind: "gap", hidden: 4 },
    ]);
  });

  it("returns nothing when the text is the same, ignoring line-ending style", () => {
    expect(buildDiffRows("a\r\nb\r\n", "a\nb\n")).toEqual([]);
    expect(buildDiffRows(null, null)).toEqual([]);
  });
});

describe("trigger labels", () => {
  it("has one distinct, translated label per trigger", () => {
    const triggers = SkillTriggerSchema.literals;
    expect(triggers).toHaveLength(5);
    const labels = triggers.map((trigger) =>
      translateBotMessage("en", skillTriggerLabelKey(trigger)),
    );
    expect(new Set(labels).size).toBe(5);
    expect(Object.keys(SKILL_TRIGGER_LABEL_KEYS).toSorted()).toEqual([...triggers].toSorted());
  });
});

describe("groupRevisionsByDay", () => {
  it("groups consecutive revisions by local day and keeps newest first", () => {
    // No offset suffix, so each timestamp is read as local time and the day key is timezone-proof.
    const at = (day: number, hour: number) =>
      `2026-05-${String(day).padStart(2, "0")}T${String(hour).padStart(2, "0")}:00:00`;
    const groups = groupRevisionsByDay([
      revision(4, at(3, 15)),
      revision(3, at(3, 9)),
      revision(2, at(2, 20)),
      revision(1, at(1, 8)),
    ]);
    expect(groups.map((group) => group.day)).toEqual(["2026-05-03", "2026-05-02", "2026-05-01"]);
    expect(groups.map((group) => group.revisions.map((entry) => entry.revision))).toEqual([
      [4, 3],
      [2],
      [1],
    ]);
  });
});

describe("latestLiveRevision", () => {
  it("skips tombstones", () => {
    const history = [
      revision(3, "2026-05-03T10:00:00Z", { deleted: true }),
      revision(2, "2026-05-02T10:00:00Z"),
      revision(1, "2026-05-01T10:00:00Z"),
    ];
    expect(latestLiveRevision(history)?.revision).toBe(2);
    expect(latestLiveRevision([history[0]!])).toBeNull();
  });
});

describe("formatSkillTime", () => {
  const now = Date.parse("2026-05-10T12:00:00Z");

  it("uses relative wording within a week and a date after that", () => {
    expect(formatSkillTime("2026-05-10T11:55:00Z", now, "en")).toBe("5 minutes ago");
    expect(formatSkillTime("2026-05-10T09:00:00Z", now, "en")).toBe("3 hours ago");
    expect(formatSkillTime("2026-05-10T11:59:50Z", now, "en")).toBe("now");
    expect(formatSkillTime("2026-04-01T09:00:00Z", now, "en")).toContain("2026");
  });

  it("falls back for unknown locales and bad input", () => {
    expect(formatSkillTime("2026-05-10T11:55:00Z", now, "not a locale!")).toBe("5 minutes ago");
    expect(formatSkillTime("garbage", now, "en")).toBe("garbage");
  });
});

describe("isValidSkillName", () => {
  it("matches the contract's name rule", () => {
    expect(isValidSkillName("release-notes")).toBe(true);
    expect(isValidSkillName("a1")).toBe(true);
    for (const bad of ["", "Release", "a--b", "-a", "a-", "a b", "a".repeat(65)]) {
      expect(isValidSkillName(bad)).toBe(false);
    }
  });
});

describe("reviewNowStatus", () => {
  it("reports how many reviews started, or that nothing was waiting", () => {
    expect(reviewNowStatus(2)).toEqual({
      key: "bots.skills.review.started",
      params: { count: 2 },
    });
    expect(reviewNowStatus(0)).toEqual({ key: "bots.skills.review.nothing" });
    expect(translateBotMessage("en", "bots.skills.review.started", { count: 3 })).toBe(
      "Reviews started: 3.",
    );
  });
});

describe("skill copy", () => {
  it("has every locale for every key, with the same placeholders", () => {
    for (const [key, entry] of Object.entries(SKILL_MESSAGES)) {
      const values: Record<string, string> = entry;
      expect(Object.keys(values).toSorted(), key).toEqual([...LOCALES].toSorted());
      const placeholders = (text: string) => (text.match(/\{\w+\}/g) ?? []).toSorted().join(",");
      for (const locale of LOCALES) {
        expect(placeholders(values[locale] ?? ""), `${key} (${locale})`).toBe(
          placeholders(values.en ?? ""),
        );
      }
    }
  });

  it("is part of the bot message table and fills parameters", () => {
    expect(Object.keys(SKILL_MESSAGES).every((key) => key in BOT_MESSAGES)).toBe(true);
    expect(translateBotMessage("en", "bots.skills.revision", { revision: 7 })).toBe("Revision 7");
    expect(translateBotMessage("zh", "bots.skills.revision", { revision: 7 })).toBe("第 7 版");
    expect(translateBotMessage("en", "bots.skills.revision")).toBe("Revision {revision}");
  });
});
