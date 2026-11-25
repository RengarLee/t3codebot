import { useState } from "react";

import { fetchSkillReviewSettings, setSkillReviewEnabled, startSkillReview } from "./apiClient.ts";
import type { BotTranslator } from "./i18n.ts";
import { reviewNowStatus } from "./skillsLogic.ts";
import {
  SKILL_BUTTON_CLASS,
  SKILL_CARD_CLASS,
  SkillErrorLine,
  skillErrorText,
} from "./skillUi.tsx";
import { useSkillResource } from "./useSkillResource.ts";

export interface SkillReviewSectionProps {
  readonly httpBaseUrl?: string | null | undefined;
  readonly t: BotTranslator;
  /** The bot whose chats "Review now" covers; null shows the switch alone. */
  readonly botId: string | null;
}

/** The background review switch, plus a per-bot "Review now" on a bot's own page. */
export function SkillReviewSection({ httpBaseUrl, t, botId }: SkillReviewSectionProps) {
  const settings = useSkillResource("review-settings", () =>
    fetchSkillReviewSettings({ httpBaseUrl }),
  );
  const [saved, setSaved] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);
  const [starting, setStarting] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const enabled = saved ?? settings.data?.settings.enabled ?? null;

  const toggle = async () => {
    if (enabled === null || saving) return;
    setSaving(true);
    setError(null);
    try {
      const result = await setSkillReviewEnabled(!enabled, { httpBaseUrl });
      setSaved(result.settings.enabled);
    } catch (caught) {
      setError(skillErrorText(caught, t));
    } finally {
      setSaving(false);
    }
  };

  const reviewNow = async () => {
    if (botId === null || starting) return;
    setStarting(true);
    setStatus(null);
    setError(null);
    try {
      const { queued } = await startSkillReview(botId, { httpBaseUrl });
      const outcome = reviewNowStatus(queued);
      setStatus(t(outcome.key, outcome.params));
    } catch (caught) {
      setError(skillErrorText(caught, t));
    } finally {
      setStarting(false);
    }
  };

  const title = t("bots.skills.review.title");
  return (
    <section className="space-y-2.5" data-testid="skill-review">
      <div className="flex min-h-7 items-center px-3 sm:px-4">
        <h2 className="text-base font-semibold text-foreground">{title}</h2>
      </div>
      <div className={SKILL_CARD_CLASS}>
        <div className="flex items-start justify-between gap-4 px-3 py-3 sm:px-4">
          <p className="min-w-0 flex-1 text-xs leading-normal text-muted-foreground">
            {t("bots.skills.review.description")}
          </p>
          <button
            type="button"
            role="switch"
            aria-checked={enabled === true}
            aria-label={title}
            disabled={enabled === null || saving}
            data-testid="skill-review-toggle"
            onClick={() => void toggle()}
            className={`relative mt-0.5 inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border border-transparent outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default disabled:opacity-50 ${
              enabled === true ? "bg-primary" : "bg-input"
            }`}
          >
            <span
              aria-hidden="true"
              className={`pointer-events-none block size-4 rounded-full bg-background shadow-xs transition-transform ${
                enabled === true ? "translate-x-4.5" : "translate-x-0.5"
              }`}
            />
          </button>
        </div>
        {settings.error !== null && saved === null ? (
          <div className="flex items-center justify-between gap-3 px-3 py-3 sm:px-4">
            <p role="alert" className="text-xs text-destructive">
              {t("bots.skills.loadFailed")}
            </p>
            <button type="button" onClick={settings.reload} className={SKILL_BUTTON_CLASS}>
              {t("bots.skills.retry")}
            </button>
          </div>
        ) : null}
        {botId !== null ? (
          <div className="flex items-center justify-between gap-3 px-3 py-3 sm:px-4">
            <p
              role="status"
              data-testid="skill-review-status"
              className="min-w-0 text-xs text-muted-foreground"
            >
              {status}
            </p>
            <button
              type="button"
              disabled={starting}
              data-testid={`skill-review-now-${botId}`}
              onClick={() => void reviewNow()}
              className={SKILL_BUTTON_CLASS}
            >
              {starting ? t("bots.skills.review.starting") : t("bots.skills.review.now")}
            </button>
          </div>
        ) : null}
        {error !== null ? <SkillErrorLine>{error}</SkillErrorLine> : null}
      </div>
    </section>
  );
}
