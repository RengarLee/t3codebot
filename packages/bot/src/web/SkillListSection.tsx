// @effect-diagnostics globalDate:off - display-only relative times in a React view, outside any Effect runtime.
import { useState } from "react";

import {
  skillScopeKey,
  type BotSummary,
  type SkillScope,
  type SkillSuggestion,
  type SkillSummary,
} from "../contracts.ts";
import {
  acceptSkillSuggestion,
  dismissSkillSuggestion,
  fetchSkillHistory,
  listSkills,
  listSkillSuggestions,
  restoreSkill,
} from "./apiClient.ts";
import type { BotTranslator } from "./i18n.ts";
import { formatSkillTime, latestLiveRevision } from "./skillsLogic.ts";
import {
  SKILL_BADGE_CLASS,
  SKILL_BUTTON_CLASS,
  SKILL_CARD_CLASS,
  SKILL_PRIMARY_BUTTON_CLASS,
  SkillErrorLine,
  skillBotName,
  skillErrorText,
} from "./skillUi.tsx";
import { skillErrorStatus, useSkillResource } from "./useSkillResource.ts";

interface SkillHostProps {
  readonly locale: string | undefined;
  readonly httpBaseUrl?: string | null | undefined;
  readonly t: BotTranslator;
}

export interface SkillListSectionProps extends SkillHostProps {
  readonly scope: SkillScope;
  readonly title: string;
  readonly note: string;
  /** Opens a skill's detail; a null name starts a new skill in this scope. */
  readonly onOpenSkill: (scope: SkillScope, name: string | null) => void;
}

function SkillRow({
  skill,
  nowMs,
  locale,
  busy,
  onOpen,
  onRestore,
  t,
}: {
  readonly skill: SkillSummary;
  readonly nowMs: number;
  readonly locale: string | undefined;
  readonly busy: boolean;
  readonly onOpen: () => void;
  readonly onRestore: () => void;
  readonly t: BotTranslator;
}) {
  const scopeKey = skillScopeKey(skill.scope);
  return (
    <div
      className="flex items-center gap-2 pr-3 sm:pr-4"
      data-testid={`skill-row-${scopeKey}-${skill.name}`}
    >
      <button
        type="button"
        onClick={onOpen}
        className="flex min-w-0 flex-1 cursor-pointer flex-col gap-0.5 px-3 py-2.5 text-left outline-none hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:px-4"
      >
        <span className="flex min-w-0 items-center gap-2">
          <span className="min-w-0 truncate font-mono text-sm font-medium text-foreground">
            {skill.name}
          </span>
          {skill.builtin ? (
            <span className={SKILL_BADGE_CLASS}>{t("bots.skills.builtin")}</span>
          ) : null}
          {skill.deleted ? (
            <span className="shrink-0 rounded-md border border-destructive/40 px-1.5 py-0.5 text-xs leading-none font-medium text-destructive">
              {t("bots.skills.deleted")}
            </span>
          ) : null}
        </span>
        <span className="block truncate text-xs text-muted-foreground">
          {skill.description || t("bots.skills.noDescription")}
        </span>
        <span className="block truncate text-xs text-muted-foreground">
          {t("bots.skills.revision", { revision: skill.revision })}
          {" · "}
          {t("bots.skills.updated", { time: formatSkillTime(skill.updatedAt, nowMs, locale) })}
        </span>
      </button>
      {skill.deleted ? (
        <button
          type="button"
          disabled={busy}
          aria-label={`${t("bots.skills.restore")} ${skill.name}`}
          data-testid={`skill-restore-${scopeKey}-${skill.name}`}
          onClick={onRestore}
          className={SKILL_BUTTON_CLASS}
        >
          {t("bots.skills.restore")}
        </button>
      ) : null}
    </div>
  );
}

export function SkillListSection({
  scope,
  title,
  note,
  locale,
  httpBaseUrl,
  t,
  onOpenSkill,
}: SkillListSectionProps) {
  const scopeKey = skillScopeKey(scope);
  const skills = useSkillResource(`list:${scopeKey}`, () => listSkills(scope, { httpBaseUrl }));
  const [nowMs] = useState(() => Date.now());
  const [restoringName, setRestoringName] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const items = skills.data?.skills ?? [];

  const restore = async (skill: SkillSummary) => {
    if (restoringName !== null) return;
    setRestoringName(skill.name);
    setActionError(null);
    try {
      const ref = { scope, name: skill.name };
      const { revisions } = await fetchSkillHistory(ref, { httpBaseUrl });
      const target = latestLiveRevision(revisions);
      if (target === null) {
        setActionError(t("bots.skills.actionFailed"));
        return;
      }
      await restoreSkill(
        { ...ref, revision: target.revision, expectedRevision: skill.revision },
        { httpBaseUrl },
      );
      skills.reload();
    } catch (caught) {
      setActionError(skillErrorText(caught, t));
    } finally {
      setRestoringName(null);
    }
  };

  return (
    <section className="space-y-2.5" data-testid={`skills-section-${scopeKey}`}>
      <div className="flex min-h-7 items-center justify-between gap-2 px-3 sm:px-4">
        <div className="flex items-center gap-2">
          <h2 className="text-base font-semibold text-foreground">{title}</h2>
          {items.length > 0 ? (
            <span className="rounded-md border border-border/70 px-1.5 py-0.5 font-mono text-xs leading-none text-muted-foreground">
              {items.length}
            </span>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            disabled={skills.loading}
            data-testid={`skills-refresh-${scopeKey}`}
            aria-label={`${t("bots.skills.refresh")} ${title}`}
            onClick={skills.reload}
            className={SKILL_BUTTON_CLASS}
          >
            {t("bots.skills.refresh")}
          </button>
          <button
            type="button"
            data-testid={`skills-new-${scopeKey}`}
            aria-label={`${t("bots.skills.new")} (${title})`}
            onClick={() => onOpenSkill(scope, null)}
            className={SKILL_BUTTON_CLASS}
          >
            {t("bots.skills.new")}
          </button>
        </div>
      </div>
      <div className={SKILL_CARD_CLASS}>
        <p className="px-3 py-3 text-xs leading-normal text-muted-foreground sm:px-4">{note}</p>
        {skills.data === null && skills.error === null ? (
          <p className="px-3 py-3 text-xs text-muted-foreground sm:px-4">
            {t("bots.skills.loading")}
          </p>
        ) : skills.error !== null ? (
          <div className="flex items-center justify-between gap-3 px-3 py-3 sm:px-4">
            <p role="alert" className="text-xs text-destructive">
              {t("bots.skills.loadFailed")}
            </p>
            <button type="button" onClick={skills.reload} className={SKILL_BUTTON_CLASS}>
              {t("bots.skills.retry")}
            </button>
          </div>
        ) : items.length === 0 ? (
          <p
            className="px-3 py-3 text-xs text-muted-foreground sm:px-4"
            data-testid={`skills-empty-${scopeKey}`}
          >
            {t("bots.skills.empty")}
          </p>
        ) : (
          <div className="*:not-first:border-t *:not-first:border-border/50">
            {items.map((skill) => (
              <SkillRow
                key={skill.name}
                skill={skill}
                nowMs={nowMs}
                locale={locale}
                busy={restoringName !== null}
                onOpen={() => onOpenSkill(scope, skill.name)}
                onRestore={() => void restore(skill)}
                t={t}
              />
            ))}
          </div>
        )}
        {actionError !== null ? <SkillErrorLine>{actionError}</SkillErrorLine> : null}
      </div>
    </section>
  );
}

type SuggestionPhase = "idle" | "sending" | "sent";

function SuggestionCard({
  suggestion,
  bots,
  httpBaseUrl,
  t,
  onOpenSkill,
  onOpenThread,
  onDismissed,
}: {
  readonly suggestion: SkillSuggestion;
  readonly bots: ReadonlyArray<BotSummary>;
  readonly httpBaseUrl?: string | null | undefined;
  readonly t: BotTranslator;
  readonly onOpenSkill: (scope: SkillScope, name: string) => void;
  readonly onOpenThread: (threadId: string) => void;
  readonly onDismissed: () => void;
}) {
  const [phase, setPhase] = useState<SuggestionPhase>("idle");
  const [dismissing, setDismissing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const botName = skillBotName(bots, suggestion.botId);
  const scopeLabel =
    suggestion.scope.scope === "shared"
      ? t("bots.skills.sharedBadge")
      : skillBotName(bots, suggestion.scope.botId);

  const accept = async () => {
    if (phase !== "idle") return;
    setPhase("sending");
    setError(null);
    try {
      await acceptSkillSuggestion(suggestion.id, { httpBaseUrl });
      setPhase("sent");
    } catch (caught) {
      setPhase("idle");
      setError(
        skillErrorStatus(caught) === 503
          ? t("bots.skills.suggestions.unavailable")
          : skillErrorText(caught, t),
      );
    }
  };

  const dismiss = async () => {
    if (dismissing) return;
    setDismissing(true);
    setError(null);
    try {
      await dismissSkillSuggestion(suggestion.id, { httpBaseUrl });
      onDismissed();
    } catch (caught) {
      setError(skillErrorText(caught, t));
    } finally {
      setDismissing(false);
    }
  };

  return (
    <article
      className="space-y-2 px-3 py-3 sm:px-4"
      data-testid={`skill-suggestion-${suggestion.id}`}
      aria-label={suggestion.name}
    >
      <div className="flex flex-wrap items-center gap-1.5">
        {suggestion.action === "update" ? (
          <button
            type="button"
            onClick={() => onOpenSkill(suggestion.scope, suggestion.name)}
            className="cursor-pointer font-mono text-sm font-medium text-foreground underline-offset-2 hover:underline"
          >
            {suggestion.name}
          </button>
        ) : (
          <span className="font-mono text-sm font-medium text-foreground">{suggestion.name}</span>
        )}
        <span className={SKILL_BADGE_CLASS}>
          {t(
            suggestion.action === "create"
              ? "bots.skills.suggestions.action.create"
              : "bots.skills.suggestions.action.update",
          )}
        </span>
        <span className={SKILL_BADGE_CLASS}>
          {t(`bots.skills.suggestions.signal.${suggestion.signal}`)}
        </span>
        <span className={SKILL_BADGE_CLASS}>{scopeLabel}</span>
      </div>
      <p className="text-sm leading-normal text-foreground">{suggestion.message}</p>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
          <span className="truncate">{t("bots.skills.suggestions.from", { bot: botName })}</span>
          {suggestion.threadId !== null ? (
            <button
              type="button"
              onClick={() => onOpenThread(suggestion.threadId ?? "")}
              className="cursor-pointer text-xs underline underline-offset-2 hover:text-foreground"
            >
              {t("bots.skills.openChat")}
            </button>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            disabled={dismissing || phase === "sending"}
            data-testid={`skill-suggestion-dismiss-${suggestion.id}`}
            aria-label={`${t("bots.skills.suggestions.dismiss")} ${suggestion.name}`}
            onClick={() => void dismiss()}
            className={SKILL_BUTTON_CLASS}
          >
            {t("bots.skills.suggestions.dismiss")}
          </button>
          <button
            type="button"
            disabled={phase !== "idle" || dismissing}
            data-testid={`skill-suggestion-accept-${suggestion.id}`}
            aria-label={`${t("bots.skills.suggestions.accept")} ${suggestion.name}`}
            onClick={() => void accept()}
            className={SKILL_PRIMARY_BUTTON_CLASS}
          >
            {t("bots.skills.suggestions.accept")}
          </button>
        </div>
      </div>
      {phase === "sent" ? (
        <p role="status" className="text-xs text-muted-foreground">
          {t("bots.skills.suggestions.sent")}
        </p>
      ) : null}
      {error !== null ? (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </article>
  );
}

export interface SkillSuggestionsSectionProps extends SkillHostProps {
  readonly bots: ReadonlyArray<BotSummary>;
  /** Only suggestions made by this bot; null shows every bot's. */
  readonly botId: string | null;
  readonly onOpenSkill: (scope: SkillScope, name: string) => void;
  readonly onOpenThread: (threadId: string) => void;
}

/** Pending agent suggestions. Renders nothing while there are none. */
export function SkillSuggestionsSection({
  bots,
  botId,
  httpBaseUrl,
  t,
  onOpenSkill,
  onOpenThread,
}: SkillSuggestionsSectionProps) {
  const suggestions = useSkillResource("suggestions", () => listSkillSuggestions({ httpBaseUrl }));
  const pending = (suggestions.data?.suggestions ?? []).filter(
    (suggestion) =>
      suggestion.status === "pending" && (botId === null || suggestion.botId === botId),
  );
  if (pending.length === 0 && suggestions.error === null) return null;

  return (
    <section className="space-y-2.5" data-testid="skill-suggestions">
      <div className="flex min-h-7 items-center justify-between gap-2 px-3 sm:px-4">
        <div className="flex items-center gap-2">
          <h2 className="text-base font-semibold text-foreground">
            {t("bots.skills.suggestions.title")}
          </h2>
          {pending.length > 0 ? (
            <span className="rounded-md border border-border/70 px-1.5 py-0.5 font-mono text-xs leading-none text-muted-foreground">
              {pending.length}
            </span>
          ) : null}
        </div>
        <button
          type="button"
          disabled={suggestions.loading}
          data-testid="skill-suggestions-refresh"
          aria-label={`${t("bots.skills.refresh")} ${t("bots.skills.suggestions.title")}`}
          onClick={suggestions.reload}
          className={SKILL_BUTTON_CLASS}
        >
          {t("bots.skills.refresh")}
        </button>
      </div>
      <div className={SKILL_CARD_CLASS}>
        <p className="px-3 py-3 text-xs leading-normal text-muted-foreground sm:px-4">
          {t("bots.skills.suggestions.description")}
        </p>
        {suggestions.error !== null ? (
          <div className="flex items-center justify-between gap-3 px-3 py-3 sm:px-4">
            <p role="alert" className="text-xs text-destructive">
              {t("bots.skills.loadFailed")}
            </p>
            <button type="button" onClick={suggestions.reload} className={SKILL_BUTTON_CLASS}>
              {t("bots.skills.retry")}
            </button>
          </div>
        ) : null}
        {pending.map((suggestion) => (
          <SuggestionCard
            key={suggestion.id}
            suggestion={suggestion}
            bots={bots}
            httpBaseUrl={httpBaseUrl}
            t={t}
            onOpenSkill={onOpenSkill}
            onOpenThread={onOpenThread}
            onDismissed={suggestions.reload}
          />
        ))}
      </div>
    </section>
  );
}
