// @effect-diagnostics globalDate:off - display-only relative times in a React view, outside any Effect runtime.
import { useState } from "react";

import {
  skillScopeKey,
  type BotSummary,
  type SkillRef,
  type SkillRevisionSummary,
} from "../contracts.ts";
import { fetchSkillRevision } from "./apiClient.ts";
import type { BotTranslator } from "./i18n.ts";
import {
  buildDiffRows,
  formatSkillDay,
  formatSkillTime,
  groupRevisionsByDay,
  skillTriggerLabelKey,
  skillTriggerToneClass,
  type DiffRow,
} from "./skillsLogic.ts";
import {
  SKILL_BADGE_CLASS,
  SKILL_BUTTON_CLASS,
  SKILL_CARD_CLASS,
  SKILL_PRIMARY_BUTTON_CLASS,
  skillBotName,
} from "./skillUi.tsx";
import { useSkillResource } from "./useSkillResource.ts";

const DIFF_ROW_CLASS = {
  add: "bg-success/10",
  remove: "bg-destructive/10",
  context: "",
} as const;

function diffRowKey(row: DiffRow, previous: DiffRow | undefined): string {
  if (row.kind === "gap") {
    const after = previous !== undefined && previous.kind !== "gap" ? previous.newLine : null;
    return `gap:${after ?? "start"}`;
  }
  return `${row.oldLine ?? "-"}:${row.newLine ?? "-"}`;
}

function DiffLine({ row, t }: { readonly row: DiffRow; readonly t: BotTranslator }) {
  if (row.kind === "gap") {
    return (
      <div className="bg-muted/40 px-3 py-0.5 text-center text-muted-foreground">
        {t("bots.skills.diff.unchanged", { count: row.hidden })}
      </div>
    );
  }
  const marker = row.kind === "add" ? "+" : row.kind === "remove" ? "-" : " ";
  return (
    <div className={`flex ${DIFF_ROW_CLASS[row.kind]}`} data-diff-kind={row.kind}>
      <span aria-hidden className="w-9 shrink-0 select-none px-1 text-right text-muted-foreground">
        {row.oldLine ?? ""}
      </span>
      <span aria-hidden className="w-9 shrink-0 select-none px-1 text-right text-muted-foreground">
        {row.newLine ?? ""}
      </span>
      <span aria-hidden className="w-4 shrink-0 select-none text-center text-muted-foreground">
        {marker}
      </span>
      {row.kind !== "context" ? (
        <span className="sr-only">
          {t(row.kind === "add" ? "bots.skills.diff.added" : "bots.skills.diff.removed")}
        </span>
      ) : null}
      <span className="min-w-0 flex-1 pr-2 break-words whitespace-pre-wrap">{row.text || " "}</span>
    </div>
  );
}

function RevisionDiff({
  skill,
  revision,
  httpBaseUrl,
  t,
}: {
  readonly skill: SkillRef;
  readonly revision: SkillRevisionSummary;
  readonly httpBaseUrl?: string | null | undefined;
  readonly t: BotTranslator;
}) {
  const key = `diff:${skillScopeKey(skill.scope)}:${skill.name}:${revision.revision}:${revision.parentRevision ?? "none"}`;
  const diff = useSkillResource(key, async () => {
    const [after, before] = await Promise.all([
      fetchSkillRevision(skill, revision.revision, { httpBaseUrl }),
      revision.parentRevision === null
        ? Promise.resolve(null)
        : fetchSkillRevision(skill, revision.parentRevision, { httpBaseUrl }),
    ]);
    return buildDiffRows(before?.revision.content ?? null, after.revision.content);
  });

  return (
    <div className="space-y-2" data-testid="skill-diff">
      <h3 className="text-sm font-medium text-foreground">
        {t("bots.skills.diff.title", { revision: revision.revision })}
      </h3>
      {revision.parentRevision === null ? (
        <p className="text-xs text-muted-foreground">{t("bots.skills.diff.first")}</p>
      ) : null}
      {diff.error !== null ? (
        <p role="alert" className="text-xs text-destructive">
          {t("bots.skills.actionFailed")}
        </p>
      ) : diff.data === null ? (
        <p className="text-xs text-muted-foreground">{t("bots.skills.diff.loading")}</p>
      ) : diff.data.length === 0 ? (
        <p className="text-xs text-muted-foreground">{t("bots.skills.diff.noChanges")}</p>
      ) : (
        <div
          role="group"
          aria-label={t("bots.skills.diff.title", { revision: revision.revision })}
          className="max-h-96 overflow-auto rounded-lg border border-border/60 bg-background py-1 font-mono text-xs leading-normal text-foreground"
        >
          {diff.data.map((row, index, rows) => (
            <DiffLine key={diffRowKey(row, rows[index - 1])} row={row} t={t} />
          ))}
        </div>
      )}
    </div>
  );
}

function revisionActor(
  revision: SkillRevisionSummary,
  bots: ReadonlyArray<BotSummary>,
  t: BotTranslator,
): string | null {
  if (revision.botId !== null) {
    return t("bots.skills.history.byBot", { bot: skillBotName(bots, revision.botId) });
  }
  return revision.trigger === "user_manual" ? t("bots.skills.history.you") : null;
}

export interface SkillHistoryPanelProps {
  readonly skill: SkillRef;
  /** Newest first. */
  readonly revisions: ReadonlyArray<SkillRevisionSummary>;
  readonly selectedRevision: number;
  readonly onSelect: (revision: number) => void;
  /** Restores a revision as a new one; the panel only asks for the confirmation. */
  readonly onRestore: (revision: number) => Promise<void>;
  readonly bots: ReadonlyArray<BotSummary>;
  readonly locale: string | undefined;
  readonly httpBaseUrl?: string | null | undefined;
  readonly t: BotTranslator;
  readonly onOpenThread: (threadId: string) => void;
}

export function SkillHistoryPanel({
  skill,
  revisions,
  selectedRevision,
  onSelect,
  onRestore,
  bots,
  locale,
  httpBaseUrl,
  t,
  onOpenThread,
}: SkillHistoryPanelProps) {
  const [nowMs] = useState(() => Date.now());
  const [confirming, setConfirming] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const latest = revisions[0];
  const selected = revisions.find((revision) => revision.revision === selectedRevision) ?? latest;
  const groups = groupRevisionsByDay(revisions);
  const shared = skill.scope.scope === "shared";
  const restorable =
    selected !== undefined &&
    !selected.deleted &&
    latest !== undefined &&
    (latest.deleted || selected.revision !== latest.revision);

  const restore = async () => {
    if (selected === undefined || restoring) return;
    setRestoring(true);
    try {
      await onRestore(selected.revision);
      setConfirming(false);
    } finally {
      setRestoring(false);
    }
  };

  return (
    <section className="space-y-2.5" data-testid="skill-history">
      <div className="flex min-h-7 items-center px-3 sm:px-4">
        <h2 className="text-base font-semibold text-foreground">
          {t("bots.skills.history.title")}
        </h2>
      </div>
      <div className={SKILL_CARD_CLASS}>
        {revisions.length === 0 ? (
          <p className="px-3 py-3 text-xs text-muted-foreground sm:px-4">
            {t("bots.skills.history.empty")}
          </p>
        ) : (
          <div className="max-h-80 overflow-y-auto">
            {groups.map((group) => (
              <div key={group.day}>
                <h3 className="sticky top-0 bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground sm:px-4">
                  {formatSkillDay(group.timestamp, locale)}
                </h3>
                <ul className="*:not-first:border-t *:not-first:border-border/50">
                  {group.revisions.map((revision) => {
                    const actor = revisionActor(revision, bots, t);
                    const isSelected = revision.revision === selected?.revision;
                    return (
                      <li
                        key={revision.revision}
                        className={isSelected ? "bg-accent/60" : undefined}
                        data-testid={`skill-history-row-${revision.revision}`}
                      >
                        <button
                          type="button"
                          aria-pressed={isSelected}
                          onClick={() => {
                            setConfirming(false);
                            onSelect(revision.revision);
                          }}
                          className="flex w-full cursor-pointer flex-col gap-1 px-3 py-2.5 text-left outline-none hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:px-4"
                        >
                          <span className="flex flex-wrap items-center gap-1.5">
                            <span
                              className={`shrink-0 rounded-md border px-1.5 py-0.5 text-xs leading-none font-medium ${skillTriggerToneClass(revision.trigger)}`}
                            >
                              {t(skillTriggerLabelKey(revision.trigger))}
                            </span>
                            {revision === latest ? (
                              <span className={SKILL_BADGE_CLASS}>
                                {t("bots.skills.history.current")}
                              </span>
                            ) : null}
                            <span className="ml-auto font-mono text-xs text-muted-foreground">
                              {t("bots.skills.revision", { revision: revision.revision })}
                            </span>
                          </span>
                          <span className="text-sm text-foreground">
                            {revision.deleted
                              ? t("bots.skills.history.deletedRevision")
                              : revision.reason || t("bots.skills.history.noReason")}
                          </span>
                          <span className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                            <time dateTime={revision.createdAt}>
                              {formatSkillTime(revision.createdAt, nowMs, locale)}
                            </time>
                            {actor !== null ? <span>{actor}</span> : null}
                          </span>
                        </button>
                        {revision.threadId !== null ? (
                          <div className="px-3 pb-2.5 sm:px-4">
                            <button
                              type="button"
                              aria-label={`${t("bots.skills.openChat")} (${t("bots.skills.revision", { revision: revision.revision })})`}
                              data-testid={`skill-history-thread-${revision.revision}`}
                              onClick={() => onOpenThread(revision.threadId ?? "")}
                              className="cursor-pointer text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
                            >
                              {t("bots.skills.openChat")}
                            </button>
                          </div>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
        )}
        {selected !== undefined ? (
          <div className="space-y-3 px-3 py-3 sm:px-4">
            <RevisionDiff
              key={`${selected.revision}`}
              skill={skill}
              revision={selected}
              httpBaseUrl={httpBaseUrl}
              t={t}
            />
            {restorable ? (
              confirming ? (
                <div
                  className="space-y-2 rounded-lg border border-border/60 bg-background p-3"
                  data-testid="skill-restore-confirm-box"
                >
                  <p className="text-xs leading-normal text-foreground">
                    {t(
                      shared
                        ? "bots.skills.history.restoreConfirmShared"
                        : "bots.skills.history.restoreConfirm",
                      { revision: selected.revision },
                    )}
                  </p>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      disabled={restoring}
                      data-testid="skill-restore-confirm"
                      onClick={() => void restore()}
                      className={SKILL_PRIMARY_BUTTON_CLASS}
                    >
                      {t("bots.skills.history.restoreAction")}
                    </button>
                    <button
                      type="button"
                      disabled={restoring}
                      onClick={() => setConfirming(false)}
                      className={SKILL_BUTTON_CLASS}
                    >
                      {t("bots.folders.cancel")}
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  data-testid="skill-restore"
                  onClick={() => setConfirming(true)}
                  className={SKILL_BUTTON_CLASS}
                >
                  {t("bots.skills.history.restore")}
                </button>
              )
            ) : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}
