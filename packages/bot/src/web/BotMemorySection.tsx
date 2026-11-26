import { useState } from "react";

import {
  BOT_LESSONS_FILE,
  BOT_LONG_TERM_MEMORY_FILE,
  BOT_PERSONA_FILE,
  type BotFilePath,
} from "../contracts.ts";
import { listBotDailyNotes } from "./apiClient.ts";
import { BotFileEditor } from "./BotFileEditor.tsx";
import type { BotMessageKey, BotTranslator } from "./i18n.ts";
import { SKILL_CARD_CLASS } from "./skillUi.tsx";
import { useSkillResource } from "./useSkillResource.ts";

interface BotFileSectionProps {
  readonly botId: string;
  readonly httpBaseUrl?: string | null | undefined;
  readonly t: BotTranslator;
}

function SectionHeading({ title }: { readonly title: string }) {
  return (
    <div className="flex min-h-7 items-center px-3 sm:px-4">
      <h2 className="text-base font-semibold text-foreground">{title}</h2>
    </div>
  );
}

function SectionNote({ children }: { readonly children: string }) {
  return (
    <p className="px-3 pt-3 text-xs leading-normal text-muted-foreground sm:px-4">{children}</p>
  );
}

export function BotPersonaSection({ botId, httpBaseUrl, t }: BotFileSectionProps) {
  return (
    <section className="space-y-2.5" data-testid={`bot-persona-${botId}`}>
      <SectionHeading title={t("bots.persona.title")} />
      <div className={SKILL_CARD_CLASS}>
        <div>
          <SectionNote>{t("bots.persona.description")}</SectionNote>
          <BotFileEditor
            botId={botId}
            path={BOT_PERSONA_FILE}
            label={t("bots.persona.title")}
            httpBaseUrl={httpBaseUrl}
            t={t}
          />
        </div>
      </div>
    </section>
  );
}

type MemoryTab = "longTerm" | "lessons" | "daily";

const MEMORY_TABS: ReadonlyArray<{
  readonly id: MemoryTab;
  readonly label: BotMessageKey;
  readonly description: BotMessageKey;
}> = [
  {
    id: "longTerm",
    label: "bots.memory.tab.longTerm",
    description: "bots.memory.longTerm.description",
  },
  {
    id: "lessons",
    label: "bots.memory.tab.lessons",
    description: "bots.memory.lessons.description",
  },
  { id: "daily", label: "bots.memory.tab.daily", description: "bots.memory.daily.description" },
];

function dailyLabel(path: BotFilePath): string {
  return path.slice(path.lastIndexOf("/") + 1).replace(/\.md$/, "");
}

function DailyNotes({ botId, httpBaseUrl, t }: BotFileSectionProps) {
  const notes = useSkillResource(`${botId}:daily`, () => listBotDailyNotes(botId, { httpBaseUrl }));
  const [picked, setPicked] = useState<BotFilePath | null>(null);

  if (notes.data === null) {
    return (
      <p className="px-3 py-3 text-xs text-muted-foreground sm:px-4">
        {notes.error === null ? t("bots.file.loading") : t("bots.file.loadFailed")}
      </p>
    );
  }
  const { daily } = notes.data;
  if (daily.length === 0) {
    return (
      <p className="px-3 py-3 text-xs text-muted-foreground sm:px-4">
        {t("bots.memory.daily.empty")}
      </p>
    );
  }
  const current = picked !== null && daily.includes(picked) ? picked : daily[0]!;

  return (
    <div>
      <div className="flex items-center gap-2 px-3 pt-3 sm:px-4">
        <label className="text-xs font-medium text-foreground" htmlFor={`bot-daily-${botId}`}>
          {t("bots.memory.daily.pick")}
        </label>
        <select
          id={`bot-daily-${botId}`}
          data-testid={`bot-daily-select-${botId}`}
          value={current}
          onChange={(event) => setPicked(event.currentTarget.value)}
          className="h-7 rounded-lg border border-border bg-background px-2 font-mono text-xs text-foreground focus:border-ring focus:outline-none"
        >
          {daily.map((path) => (
            <option key={path} value={path}>
              {dailyLabel(path)}
            </option>
          ))}
        </select>
      </div>
      <BotFileEditor
        key={current}
        botId={botId}
        path={current}
        label={`${t("bots.memory.tab.daily")} ${dailyLabel(current)}`}
        httpBaseUrl={httpBaseUrl}
        t={t}
      />
    </div>
  );
}

export function BotMemorySection({ botId, httpBaseUrl, t }: BotFileSectionProps) {
  const [tab, setTab] = useState<MemoryTab>("longTerm");

  return (
    <section className="space-y-2.5" data-testid={`bot-memory-${botId}`}>
      <SectionHeading title={t("bots.memory.title")} />
      <div className={SKILL_CARD_CLASS}>
        <div className="space-y-2.5 px-3 py-3 sm:px-4">
          <p className="text-xs leading-normal text-muted-foreground">
            {t("bots.memory.description")}
          </p>
          <div
            role="tablist"
            aria-label={t("bots.memory.title")}
            className="inline-flex rounded-lg border border-border bg-background p-0.5"
          >
            {MEMORY_TABS.map((entry) => (
              <button
                key={entry.id}
                type="button"
                role="tab"
                aria-selected={entry.id === tab}
                data-testid={`bot-memory-tab-${entry.id}`}
                onClick={() => setTab(entry.id)}
                className={
                  entry.id === tab
                    ? "h-6 cursor-pointer rounded-md bg-accent px-2.5 text-xs font-medium text-foreground"
                    : "h-6 cursor-pointer rounded-md px-2.5 text-xs font-medium text-muted-foreground hover:text-foreground"
                }
              >
                {t(entry.label)}
              </button>
            ))}
          </div>
        </div>
        {MEMORY_TABS.map((entry) => (
          <div key={entry.id} role="tabpanel" hidden={entry.id !== tab}>
            <SectionNote>{t(entry.description)}</SectionNote>
            {entry.id === "daily" ? (
              <DailyNotes botId={botId} httpBaseUrl={httpBaseUrl} t={t} />
            ) : (
              <BotFileEditor
                botId={botId}
                path={entry.id === "longTerm" ? BOT_LONG_TERM_MEMORY_FILE : BOT_LESSONS_FILE}
                label={t(entry.label)}
                httpBaseUrl={httpBaseUrl}
                t={t}
              />
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
