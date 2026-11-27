import { useState } from "react";

import {
  BOT_USER_MEMORY_FILE,
  BOT_MEMORY_FILE,
  BOT_PERSONA_FILE,
  BOT_POLICY_FILE,
} from "../contracts.ts";
import { BotFileEditor } from "./BotFileEditor.tsx";
import type { BotMessageKey, BotTranslator } from "./i18n.ts";
import { SKILL_CARD_CLASS } from "./skillUi.tsx";

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

type MemoryTab = "bot" | "user" | "policy";

const MEMORY_TABS: ReadonlyArray<{
  readonly id: MemoryTab;
  readonly label: BotMessageKey;
  readonly description: BotMessageKey;
}> = [
  {
    id: "bot",
    label: "bots.memory.tab.bot",
    description: "bots.memory.bot.description",
  },
  {
    id: "user",
    label: "bots.memory.tab.user",
    description: "bots.memory.user.description",
  },
  { id: "policy", label: "bots.memory.tab.policy", description: "bots.memory.policy.description" },
];

export function BotMemorySection({ botId, httpBaseUrl, t }: BotFileSectionProps) {
  const [tab, setTab] = useState<MemoryTab>("bot");

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
            {entry.id === "policy" ? (
              <BotFileEditor
                botId={botId}
                path={BOT_POLICY_FILE}
                label={t(entry.label)}
                httpBaseUrl={httpBaseUrl}
                t={t}
              />
            ) : (
              <BotFileEditor
                botId={botId}
                path={entry.id === "bot" ? BOT_MEMORY_FILE : BOT_USER_MEMORY_FILE}
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
