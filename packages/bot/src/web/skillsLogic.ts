// @effect-diagnostics globalDate:off - display-only relative times in a React view, outside any Effect runtime.
import { diffLines } from "diff";

import {
  skillScopeKey,
  type SkillRevisionSummary,
  type SkillScope,
  type SkillTrigger,
} from "../contracts.ts";
import type { BotMessageKey } from "./i18n.ts";

export type DiffRow =
  | {
      readonly kind: "add" | "remove" | "context";
      readonly text: string;
      readonly oldLine: number | null;
      readonly newLine: number | null;
    }
  | { readonly kind: "gap"; readonly hidden: number };

const DEFAULT_CONTEXT_LINES = 3;

function splitLines(value: string): ReadonlyArray<string> {
  if (value === "") return [];
  const lines = value.split("\n");
  if (lines.at(-1) === "") lines.pop();
  return lines;
}

function normalizeContent(value: string | null): string {
  return (value ?? "").replace(/\r\n?/g, "\n");
}

/**
 * Line diff of two `SKILL.md` texts. A null side (no parent, or a deleted skill) counts as empty, so
 * a first revision is all additions and a deletion is all removals. Long unchanged stretches
 * collapse into one `gap` row that keeps `contextLines` lines next to each change.
 */
export function buildDiffRows(
  before: string | null,
  after: string | null,
  contextLines = DEFAULT_CONTEXT_LINES,
): ReadonlyArray<DiffRow> {
  const parts = diffLines(normalizeContent(before), normalizeContent(after));
  const rows: Array<Exclude<DiffRow, { kind: "gap" }>> = [];
  let oldLine = 1;
  let newLine = 1;
  for (const part of parts) {
    for (const text of splitLines(part.value)) {
      if (part.added) {
        rows.push({ kind: "add", text, oldLine: null, newLine });
        newLine += 1;
      } else if (part.removed) {
        rows.push({ kind: "remove", text, oldLine, newLine: null });
        oldLine += 1;
      } else {
        rows.push({ kind: "context", text, oldLine, newLine });
        oldLine += 1;
        newLine += 1;
      }
    }
  }
  if (!rows.some((row) => row.kind !== "context")) return [];

  const keep = rows.map(() => false);
  rows.forEach((row, index) => {
    if (row.kind === "context") return;
    const from = Math.max(0, index - contextLines);
    const to = Math.min(rows.length - 1, index + contextLines);
    for (let cursor = from; cursor <= to; cursor += 1) keep[cursor] = true;
  });

  const collapsed: DiffRow[] = [];
  let hidden = 0;
  rows.forEach((row, index) => {
    if (keep[index]) {
      if (hidden > 0) {
        collapsed.push({ kind: "gap", hidden });
        hidden = 0;
      }
      collapsed.push(row);
    } else {
      hidden += 1;
    }
  });
  if (hidden > 0) collapsed.push({ kind: "gap", hidden });
  return collapsed;
}

export const SKILL_TRIGGER_LABEL_KEYS: Readonly<Record<SkillTrigger, BotMessageKey>> = {
  builtin: "bots.skills.trigger.builtin",
  user_manual: "bots.skills.trigger.user_manual",
  user_request: "bots.skills.trigger.user_request",
  suggested: "bots.skills.trigger.suggested",
  external: "bots.skills.trigger.external",
};

export function skillTriggerLabelKey(trigger: SkillTrigger): BotMessageKey {
  return SKILL_TRIGGER_LABEL_KEYS[trigger];
}

/** Theme-variable classes per trigger, so a row's origin reads at a glance. */
export function skillTriggerToneClass(trigger: SkillTrigger): string {
  switch (trigger) {
    case "builtin":
      return "border-border/70 bg-muted/60 text-muted-foreground";
    case "user_manual":
      return "border-primary/30 bg-primary/10 text-primary";
    case "user_request":
      return "border-info/30 bg-info/10 text-info-foreground";
    case "suggested":
      return "border-success/30 bg-success/10 text-success-foreground";
    case "external":
      return "border-warning/30 bg-warning/10 text-warning-foreground";
  }
}

export interface RevisionDayGroup {
  /** Local calendar day, `YYYY-MM-DD`. */
  readonly day: string;
  /** The group's first timestamp, for formatting the heading. */
  readonly timestamp: string;
  readonly revisions: ReadonlyArray<SkillRevisionSummary>;
}

function localDayKey(isoTimestamp: string): string {
  const date = new Date(isoTimestamp);
  if (Number.isNaN(date.getTime())) return isoTimestamp.slice(0, 10);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

/** Groups a newest-first history into consecutive local-day buckets, keeping the order. */
export function groupRevisionsByDay(
  revisions: ReadonlyArray<SkillRevisionSummary>,
): ReadonlyArray<RevisionDayGroup> {
  const groups: Array<{ day: string; timestamp: string; revisions: SkillRevisionSummary[] }> = [];
  for (const revision of revisions) {
    const day = localDayKey(revision.createdAt);
    const last = groups.at(-1);
    if (last !== undefined && last.day === day) {
      last.revisions.push(revision);
    } else {
      groups.push({ day, timestamp: revision.createdAt, revisions: [revision] });
    }
  }
  return groups;
}

const MINUTE = 60;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

function safeLocale(locale: string | undefined): string {
  const tag = locale?.trim();
  if (!tag) return "en";
  try {
    return Intl.getCanonicalLocales(tag)[0] ?? "en";
  } catch {
    return "en";
  }
}

/** "5 minutes ago" within a week, the date after that. Falls back to the raw text for bad input. */
export function formatSkillTime(
  isoTimestamp: string,
  nowMs: number,
  locale: string | undefined,
): string {
  const timestamp = new Date(isoTimestamp).getTime();
  if (Number.isNaN(timestamp)) return isoTimestamp;
  const tag = safeLocale(locale);
  const elapsed = Math.round((nowMs - timestamp) / 1000);
  if (elapsed >= 7 * DAY || elapsed < -MINUTE) {
    return new Intl.DateTimeFormat(tag, { dateStyle: "medium", timeStyle: "short" }).format(
      timestamp,
    );
  }
  const formatter = new Intl.RelativeTimeFormat(tag, { numeric: "auto" });
  const seconds = Math.max(elapsed, 0);
  if (seconds < MINUTE) return formatter.format(0, "second");
  if (seconds < HOUR) return formatter.format(-Math.floor(seconds / MINUTE), "minute");
  if (seconds < DAY) return formatter.format(-Math.floor(seconds / HOUR), "hour");
  return formatter.format(-Math.floor(seconds / DAY), "day");
}

export function formatSkillDay(isoTimestamp: string, locale: string | undefined): string {
  const date = new Date(isoTimestamp);
  if (Number.isNaN(date.getTime())) return isoTimestamp;
  return new Intl.DateTimeFormat(safeLocale(locale), { dateStyle: "full" }).format(date);
}

export function sameSkillScope(left: SkillScope, right: SkillScope): boolean {
  return skillScopeKey(left) === skillScopeKey(right);
}

const SKILL_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SKILL_NAME_MAX = 64;

export function isValidSkillName(name: string): boolean {
  return name.length > 0 && name.length <= SKILL_NAME_MAX && SKILL_NAME_PATTERN.test(name);
}

/** The editor's starting text for a new skill. */
export const NEW_SKILL_TEMPLATE = "---\ndescription: \n---\n\n";

/**
 * The revision a deleted skill comes back as: the newest one that still has content. Null when the
 * skill never had any (it cannot be restored).
 */
export function latestLiveRevision(
  revisions: ReadonlyArray<SkillRevisionSummary>,
): SkillRevisionSummary | null {
  return revisions.find((revision) => !revision.deleted) ?? null;
}
