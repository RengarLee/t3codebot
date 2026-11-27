import { useState } from "react";
import type { BotScheduleUpdate } from "../contracts.ts";
import { listBotSchedules, updateBotSchedule } from "./apiClient.ts";
import type { BotTranslator } from "./i18n.ts";
import { SKILL_BUTTON_CLASS, SKILL_CARD_CLASS, SkillErrorLine } from "./skillUi.tsx";
import { useSkillResource } from "./useSkillResource.ts";

export function BotSchedulesSection({
  botId,
  locale,
  httpBaseUrl,
  t,
  onOpenThread,
}: {
  readonly botId: string;
  readonly locale: string | undefined;
  readonly httpBaseUrl?: string | null | undefined;
  readonly t: BotTranslator;
  readonly onOpenThread: (threadId: string) => void;
}) {
  const resource = useSkillResource(`${httpBaseUrl ?? ""}:${botId}:schedules`, () =>
    listBotSchedules(botId, { httpBaseUrl }),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  async function update(input: BotScheduleUpdate) {
    setBusy(true);
    setError(false);
    try {
      await updateBotSchedule(input, { httpBaseUrl });
      resource.reload();
    } catch {
      setError(true);
    }
    setBusy(false);
  }
  return (
    <section className="space-y-3" data-testid="bot-schedules">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-medium">{t("bots.schedules.title")}</h3>
        <button
          type="button"
          className={SKILL_BUTTON_CLASS}
          disabled={resource.loading || busy}
          onClick={resource.reload}
        >
          {t("bots.schedules.refresh")}
        </button>
      </div>
      <p className="text-xs text-muted-foreground">{t("bots.schedules.help")}</p>
      {error || resource.error !== null ? (
        <SkillErrorLine>{t("bots.schedules.error")}</SkillErrorLine>
      ) : null}
      {resource.loading && resource.data === null ? (
        <p className="text-xs text-muted-foreground">{t("bots.schedules.loading")}</p>
      ) : null}
      {resource.data?.tasks.length === 0 ? (
        <p className="text-xs text-muted-foreground">{t("bots.schedules.empty")}</p>
      ) : null}
      <div className={SKILL_CARD_CLASS}>
        {resource.data?.tasks.map((task) => {
          const models = resource.data?.models ?? [];
          const selected = models.findIndex(
            (model) =>
              model.instanceId === task.modelSelection.instanceId &&
              model.model === task.modelSelection.model,
          );
          return (
            <article key={task.id} className="space-y-3 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h4 className="text-sm font-medium">{task.title}</h4>
                <button
                  type="button"
                  className={SKILL_BUTTON_CLASS}
                  disabled={busy || resource.loading}
                  onClick={() =>
                    void update({ botId, id: task.id, kind: "enabled", enabled: !task.enabled })
                  }
                >
                  {t(task.enabled ? "bots.schedules.pause" : "bots.schedules.resume")}
                </button>
              </div>
              <p className="whitespace-pre-wrap break-words text-xs text-muted-foreground">
                {task.prompt}
              </p>
              <p className="text-xs text-muted-foreground">
                {task.schedule.type === "interval"
                  ? t("bots.schedules.interval", { minutes: task.schedule.everyMs / 60000 })
                  : task.schedule.type === "fixed_time"
                    ? `${task.schedule.timeOfDay} (${resource.data?.timeZone ?? ""}) · ${task.schedule.weekdays?.map((day) => new Intl.DateTimeFormat(locale, { weekday: "short", timeZone: "UTC" }).format(Date.UTC(2024, 0, 7 + day))).join(", ") ?? t("bots.schedules.daily")}`
                    : task.schedule.type === "once"
                      ? task.schedule.runAt
                      : t("bots.schedules.webhook")}
              </p>
              <label className="flex flex-wrap items-center gap-2 text-xs">
                {t("bots.schedules.model")}
                <select
                  aria-label={t("bots.schedules.model")}
                  className="max-w-full rounded border border-border bg-background p-1.5 text-foreground"
                  value={selected}
                  disabled={busy || resource.loading}
                  onChange={(event) => {
                    const modelSelection = models[Number(event.target.value)];
                    if (modelSelection)
                      void update({ botId, id: task.id, kind: "model", modelSelection });
                  }}
                >
                  {selected < 0 ? (
                    <option value={-1}>
                      {task.modelSelection.instanceId} / {task.modelSelection.model}
                    </option>
                  ) : null}
                  {models.map((model, index) => (
                    <option key={`${model.instanceId}/${model.model}`} value={index}>
                      {model.instanceId} / {model.model}
                    </option>
                  ))}
                </select>
              </label>
              <p className="text-xs text-muted-foreground">
                {t("bots.schedules.next", {
                  time:
                    task.nextRunAt === null
                      ? t("bots.schedules.none")
                      : new Intl.DateTimeFormat(locale, {
                          dateStyle: "short",
                          timeStyle: "short",
                        }).format(Date.parse(task.nextRunAt)),
                })}
              </p>
              {task.lastRunError ? <SkillErrorLine>{task.lastRunError}</SkillErrorLine> : null}
              {task.threadId ? (
                <button
                  type="button"
                  className={SKILL_BUTTON_CLASS}
                  onClick={() => {
                    if (task.threadId) onOpenThread(task.threadId);
                  }}
                >
                  {t("bots.schedules.history")}
                </button>
              ) : null}
            </article>
          );
        })}
      </div>
    </section>
  );
}
