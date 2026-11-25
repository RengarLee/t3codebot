import { useState } from "react";

import {
  BUILTIN_SKILL_NAMES,
  skillScopeKey,
  type BotSummary,
  type SkillRef,
  type SkillScope,
} from "../contracts.ts";
import {
  deleteSkill,
  fetchSkillHistory,
  fetchSkillRevision,
  restoreSkill,
  saveSkill,
} from "./apiClient.ts";
import type { BotTranslator } from "./i18n.ts";
import { SkillHistoryPanel } from "./SkillHistoryPanel.tsx";
import { isValidSkillName, NEW_SKILL_TEMPLATE } from "./skillsLogic.ts";
import {
  SKILL_BADGE_CLASS,
  SKILL_BUTTON_CLASS,
  SKILL_CARD_CLASS,
  SKILL_DANGER_BUTTON_CLASS,
  SKILL_PRIMARY_BUTTON_CLASS,
  skillBotName,
  skillErrorText,
} from "./skillUi.tsx";
import { skillErrorStatus, useSkillResource } from "./useSkillResource.ts";

export interface SkillDetailViewProps {
  readonly scope: SkillScope;
  /** The skill to open; null starts a new one. */
  readonly initialName: string | null;
  readonly bots: ReadonlyArray<BotSummary>;
  readonly locale: string | undefined;
  readonly httpBaseUrl?: string | null | undefined;
  readonly t: BotTranslator;
  readonly onBack: () => void;
  readonly onOpenThread: (threadId: string) => void;
}

function ArrowLeftGlyph() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="size-3.5 shrink-0"
    >
      <path d="m12 19-7-7 7-7" />
      <path d="M19 12H5" />
    </svg>
  );
}

export function SkillDetailView({
  scope,
  initialName,
  bots,
  locale,
  httpBaseUrl,
  t,
  onBack,
  onOpenThread,
}: SkillDetailViewProps) {
  const scopeKey = skillScopeKey(scope);
  const shared = scope.scope === "shared";
  const [name, setName] = useState(initialName);
  const [nameDraft, setNameDraft] = useState("");
  const [draft, setDraft] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [selectedRevision, setSelectedRevision] = useState<number | null>(null);
  const [busy, setBusy] = useState<"save" | "delete" | null>(null);
  const [saved, setSaved] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const ref: SkillRef | null = name === null ? null : { scope, name };
  const history = useSkillResource(`history:${scopeKey}:${name ?? ""}`, () =>
    ref === null ? Promise.resolve({ revisions: [] }) : fetchSkillHistory(ref, { httpBaseUrl }),
  );
  const revisions = history.data?.revisions ?? [];
  const latest = revisions[0] ?? null;
  const live = latest !== null && !latest.deleted;
  const content = useSkillResource(
    `content:${scopeKey}:${name ?? ""}:${live ? latest.revision : "none"}`,
    async () =>
      ref !== null && live
        ? ((await fetchSkillRevision(ref, latest.revision, { httpBaseUrl })).revision.content ?? "")
        : "",
  );

  const historyReady = name === null || history.data !== null;
  const contentReady = !live || content.data !== null;
  const baseText = name === null ? NEW_SKILL_TEMPLATE : (content.data ?? "");
  const text = draft ?? baseText;
  const dirty = draft !== null && draft !== baseText;
  const nameValid = name !== null || isValidSkillName(nameDraft.trim());
  const canSave =
    historyReady &&
    contentReady &&
    busy === null &&
    !conflict &&
    nameValid &&
    text.trim().length > 0 &&
    (name === null || dirty);
  const builtin = name !== null && (BUILTIN_SKILL_NAMES as ReadonlyArray<string>).includes(name);

  const failWith = (caught: unknown) => {
    if (skillErrorStatus(caught) === 409) {
      setConflict(true);
      history.reload();
      return;
    }
    setError(skillErrorText(caught, t));
  };

  const save = async () => {
    if (!canSave) return;
    const target = name ?? nameDraft.trim();
    setBusy("save");
    setError(null);
    setSaved(false);
    try {
      await saveSkill(
        {
          scope,
          name: target,
          content: text,
          reason: reason.trim(),
          expectedRevision: latest?.revision ?? null,
        },
        { httpBaseUrl },
      );
      setName(target);
      setDraft(null);
      setReason("");
      setSelectedRevision(null);
      setSaved(true);
      history.reload();
    } catch (caught) {
      failWith(caught);
    } finally {
      setBusy(null);
    }
  };

  const remove = async () => {
    if (ref === null || latest === null || busy !== null) return;
    setBusy("delete");
    setError(null);
    try {
      await deleteSkill({ ...ref, reason: "", expectedRevision: latest.revision }, { httpBaseUrl });
      setConfirmingDelete(false);
      setDraft(null);
      setSelectedRevision(null);
      history.reload();
    } catch (caught) {
      failWith(caught);
    } finally {
      setBusy(null);
    }
  };

  const restore = async (revision: number) => {
    if (ref === null || latest === null) return;
    setError(null);
    try {
      await restoreSkill({ ...ref, revision, expectedRevision: latest.revision }, { httpBaseUrl });
      setDraft(null);
      setSelectedRevision(null);
      setSaved(false);
      history.reload();
    } catch (caught) {
      failWith(caught);
    }
  };

  return (
    <div className="space-y-6" data-testid={`skill-detail-${scopeKey}-${name ?? "new"}`}>
      <div className="flex flex-wrap items-center gap-2.5 px-1 sm:px-2">
        <button
          type="button"
          data-testid="skill-detail-back"
          onClick={onBack}
          className="inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-lg border border-border/70 bg-background px-2.5 text-xs font-medium text-muted-foreground hover:bg-accent/50 hover:text-foreground"
        >
          <ArrowLeftGlyph />
          <span>{t("bots.skills.back")}</span>
        </button>
        <h2 className="min-w-0 truncate font-mono text-base font-semibold text-foreground">
          {name ?? t("bots.skills.detail.newTitle")}
        </h2>
        {shared ? (
          <span className={SKILL_BADGE_CLASS}>{t("bots.skills.sharedBadge")}</span>
        ) : scope.scope === "bot" ? (
          <span className={SKILL_BADGE_CLASS}>{skillBotName(bots, scope.botId)}</span>
        ) : null}
        {builtin ? <span className={SKILL_BADGE_CLASS}>{t("bots.skills.builtin")}</span> : null}
        {latest?.deleted ? (
          <span className="shrink-0 rounded-md border border-destructive/40 px-1.5 py-0.5 text-xs leading-none font-medium text-destructive">
            {t("bots.skills.deleted")}
          </span>
        ) : null}
      </div>

      <section className="space-y-2.5">
        <div className={SKILL_CARD_CLASS}>
          {shared ? (
            <p
              className="px-3 py-3 text-xs leading-normal text-muted-foreground sm:px-4"
              data-testid="skill-shared-warning"
            >
              {t("bots.skills.detail.sharedWarning")}
            </p>
          ) : null}

          {history.error !== null ? (
            <div className="flex items-center justify-between gap-3 px-3 py-3 sm:px-4">
              <p role="alert" className="text-xs text-destructive">
                {t("bots.skills.loadFailed")}
              </p>
              <button type="button" onClick={history.reload} className={SKILL_BUTTON_CLASS}>
                {t("bots.skills.retry")}
              </button>
            </div>
          ) : !historyReady || !contentReady ? (
            <p className="px-3 py-3 text-xs text-muted-foreground sm:px-4">
              {t("bots.skills.loading")}
            </p>
          ) : latest?.deleted ? (
            <p
              className="px-3 py-3 text-xs leading-normal text-muted-foreground sm:px-4"
              data-testid="skill-deleted-banner"
            >
              {t("bots.skills.detail.deletedBanner")}
            </p>
          ) : (
            <div className="space-y-3 px-3 py-3 sm:px-4">
              {name === null ? (
                <div className="space-y-1.5">
                  <label className="block text-xs font-medium" htmlFor="skill-name-input">
                    {t("bots.skills.detail.nameLabel")}
                  </label>
                  <input
                    id="skill-name-input"
                    type="text"
                    autoComplete="off"
                    spellCheck={false}
                    value={nameDraft}
                    data-testid="skill-name-input"
                    placeholder={t("bots.skills.detail.namePlaceholder")}
                    onChange={(event) => {
                      setNameDraft(event.currentTarget.value);
                      setError(null);
                    }}
                    className="h-8 w-full rounded-lg border border-border bg-background px-2.5 font-mono text-xs text-foreground placeholder:text-muted-foreground focus:border-ring focus:outline-none"
                  />
                  <p
                    className={
                      nameDraft.trim().length > 0 && !nameValid
                        ? "text-xs text-destructive"
                        : "text-xs text-muted-foreground"
                    }
                  >
                    {nameDraft.trim().length > 0 && !nameValid
                      ? t("bots.skills.detail.nameInvalid")
                      : t("bots.skills.detail.nameHint")}
                  </p>
                </div>
              ) : null}
              <textarea
                aria-label="SKILL.md"
                data-testid="skill-editor"
                spellCheck={false}
                value={text}
                onChange={(event) => {
                  setDraft(event.currentTarget.value);
                  setSaved(false);
                }}
                className="block min-h-64 w-full resize-y rounded-lg border border-border bg-background p-2.5 font-mono text-xs leading-normal text-foreground focus:border-ring focus:outline-none"
              />
              <div className="space-y-1.5">
                <label className="block text-xs font-medium" htmlFor="skill-reason-input">
                  {t("bots.skills.detail.reasonLabel")}
                </label>
                <input
                  id="skill-reason-input"
                  type="text"
                  value={reason}
                  data-testid="skill-reason-input"
                  placeholder={t("bots.skills.detail.reasonPlaceholder")}
                  onChange={(event) => setReason(event.currentTarget.value)}
                  className="h-8 w-full rounded-lg border border-border bg-background px-2.5 text-xs text-foreground placeholder:text-muted-foreground focus:border-ring focus:outline-none"
                />
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={!canSave}
                  data-testid="skill-save"
                  onClick={() => void save()}
                  className={SKILL_PRIMARY_BUTTON_CLASS}
                >
                  {busy === "save" ? t("bots.skills.detail.saving") : t("bots.skills.detail.save")}
                </button>
                {saved ? (
                  <span role="status" className="text-xs text-muted-foreground">
                    {t("bots.skills.detail.saved")}
                  </span>
                ) : null}
                {name !== null && !confirmingDelete ? (
                  <button
                    type="button"
                    disabled={busy !== null}
                    data-testid="skill-delete"
                    onClick={() => setConfirmingDelete(true)}
                    className={`${SKILL_DANGER_BUTTON_CLASS} ml-auto`}
                  >
                    {t("bots.skills.detail.delete")}
                  </button>
                ) : null}
              </div>
              {confirmingDelete ? (
                <div
                  className="space-y-2 rounded-lg border border-destructive/40 bg-background p-3"
                  data-testid="skill-delete-confirm-box"
                >
                  <p className="text-xs leading-normal text-foreground">
                    {t(
                      shared
                        ? "bots.skills.detail.deleteConfirmShared"
                        : "bots.skills.detail.deleteConfirm",
                    )}
                  </p>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      disabled={busy !== null}
                      data-testid="skill-delete-confirm"
                      onClick={() => void remove()}
                      className={SKILL_DANGER_BUTTON_CLASS}
                    >
                      {t("bots.skills.detail.delete")}
                    </button>
                    <button
                      type="button"
                      disabled={busy !== null}
                      onClick={() => setConfirmingDelete(false)}
                      className={SKILL_BUTTON_CLASS}
                    >
                      {t("bots.folders.cancel")}
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          )}

          {conflict ? (
            <div
              className="flex flex-col gap-2 px-3 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-4"
              data-testid="skill-conflict"
            >
              <p role="alert" className="text-xs leading-normal text-destructive">
                {t("bots.skills.detail.conflict")}
              </p>
              <button
                type="button"
                data-testid="skill-conflict-ack"
                onClick={() => {
                  setConflict(false);
                  setConfirmingDelete(false);
                  setSelectedRevision(null);
                  history.reload();
                }}
                className={SKILL_BUTTON_CLASS}
              >
                {t("bots.skills.detail.loadLatest")}
              </button>
            </div>
          ) : null}
          {error !== null ? (
            <p role="alert" className="px-3 py-2 text-xs text-destructive sm:px-4">
              {error}
            </p>
          ) : null}
        </div>
      </section>

      {ref !== null && history.data !== null ? (
        <SkillHistoryPanel
          skill={ref}
          revisions={revisions}
          selectedRevision={selectedRevision ?? latest?.revision ?? 0}
          onSelect={setSelectedRevision}
          onRestore={restore}
          bots={bots}
          locale={locale}
          httpBaseUrl={httpBaseUrl}
          t={t}
          onOpenThread={onOpenThread}
        />
      ) : null}
    </div>
  );
}
