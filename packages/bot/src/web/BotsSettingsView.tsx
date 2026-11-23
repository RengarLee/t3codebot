import { MAIN_BOT_ID, type BotSummary } from "../contracts.ts";
import { useBotList } from "./botList.ts";
import { createBotTranslator } from "./i18n.ts";
import { useOpenBotHome } from "./openBotHome.ts";

export interface BotsListSectionProps {
  readonly locale: string | undefined;
  readonly httpBaseUrl?: string | null | undefined;
  /** Host navigation to a T3 thread in the environment these bots belong to. */
  readonly onOpenThread: (threadId: string) => void;
  /** The main bot's card, or the background sub-bots that never appear in the sidebar. */
  readonly role: "main" | "sub";
}

export function BotsListSection({ locale, httpBaseUrl, onOpenThread, role }: BotsListSectionProps) {
  const t = createBotTranslator(locale);
  const bots = useBotList(httpBaseUrl);
  const { openHome, openingBotId, failedBotId } = useOpenBotHome(httpBaseUrl, onOpenThread);
  const mainBot = bots.find((bot) => bot.id === MAIN_BOT_ID);
  const subBots = bots.filter((bot) => bot.role === "sub");

  const renderRow = (bot: BotSummary, title: string, summary: string) => (
    <li
      key={bot.id}
      data-testid={`settings-bot-${bot.id}`}
      className="flex items-center justify-between gap-2 rounded-md border border-border/60 bg-background px-2.5 py-1.5"
    >
      <div className="min-w-0">
        <div className="truncate font-medium text-foreground">{title}</div>
        {summary ? (
          <div className="truncate text-[11px] text-muted-foreground">{summary}</div>
        ) : null}
        {failedBotId === bot.id ? (
          <div className="text-[11px] text-destructive">{t("bots.home.openFailed")}</div>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <span className="rounded border border-border px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
          {bot.status}
        </span>
        <button
          type="button"
          disabled={openingBotId !== null}
          onClick={() => void openHome(bot.id, bot.projectId)}
          className="cursor-pointer rounded border border-border px-2 py-0.5 text-foreground hover:bg-muted disabled:cursor-default disabled:opacity-60"
        >
          {t("bots.list.open")}
        </button>
      </div>
    </li>
  );

  if (role === "main") {
    return (
      <ul className="mt-2 pb-2 text-xs" data-testid="settings-main-bot-section">
        {mainBot === undefined
          ? null
          : renderRow(mainBot, t("bots.main.title"), t("bots.main.description"))}
      </ul>
    );
  }

  return (
    <div className="mt-2 space-y-1.5 pb-2 text-xs" data-testid="settings-bots-list-section">
      <p className="text-muted-foreground">{t("bots.list.description")}</p>
      {subBots.length === 0 ? (
        <p className="text-muted-foreground">{t("bots.list.empty")}</p>
      ) : (
        <ul className="space-y-1.5">
          {subBots.map((bot) => renderRow(bot, bot.name, bot.summary))}
        </ul>
      )}
    </div>
  );
}
