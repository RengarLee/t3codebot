import { useRef, useState, type FormEvent, type ReactNode } from "react";

import {
  BOT_WORKING_FOLDERS_MAX,
  MAIN_BOT_ID,
  type BotSummary,
  type SkillScope,
} from "../contracts.ts";
import { updateBotProfile, updateBotWorkingFolders } from "./apiClient.ts";
import { BotMemorySection, BotPersonaSection } from "./BotMemorySection.tsx";
import { useBotList } from "./botList.ts";
import { createBotTranslator, type BotMessageKey, type BotTranslator } from "./i18n.ts";
import { useOpenBotHome } from "./openBotHome.ts";
import { SkillDetailView } from "./SkillDetailView.tsx";
import { SkillListSection, SkillSuggestionsSection } from "./SkillListSection.tsx";
import { SkillReviewSection } from "./SkillReviewSection.tsx";

export interface BotAddFolderDialogRenderProps {
  readonly bot: BotSummary;
  readonly busy: boolean;
  readonly error: string | null;
  readonly onClearError: () => void;
  readonly onAdd: (folderPath: string) => Promise<boolean>;
  readonly onClose: () => void;
}

export interface BotsSettingsViewProps {
  readonly locale: string | undefined;
  readonly httpBaseUrl?: string | null | undefined;
  /** Host navigation to a T3 thread in the environment these bots belong to. */
  readonly onOpenThread: (threadId: string) => void;
  /** Optional host-rendered "Show Bot" setting row shown above the bot chooser list. */
  readonly sidebarToggleSlot?: ReactNode;
  /** Optional host-rendered folder picker dialog (reuses T3's live filesystem browse dialog). */
  readonly renderAddFolderDialog?:
    | ((props: BotAddFolderDialogRenderProps) => ReactNode)
    | undefined;
}

function folderBaseName(folderPath: string): string {
  const trimmed = folderPath.replace(/[\\/]+$/, "");
  if (!trimmed) return folderPath;
  const segments = trimmed.split(/[\\/]+/).filter(Boolean);
  return segments.at(-1) ?? trimmed;
}

function normalizePathKey(folderPath: string): string {
  const trimmed = folderPath.trim().replace(/[\\/]+$/, "");
  return trimmed || folderPath.trim();
}

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }
  return fallback;
}

function botWorkspacePath(bot: BotSummary): string {
  const separator = bot.path.includes("\\") ? "\\" : "/";
  const trimmed = bot.path.replace(/[\\/]+$/, "");
  return trimmed ? `${trimmed}${separator}workspace` : "workspace";
}

function BotGlyph({ main }: { readonly main: boolean }) {
  return (
    <span
      aria-hidden
      className={
        main
          ? "flex size-6 shrink-0 items-center justify-center rounded-md border border-primary/30 bg-primary/15 text-primary"
          : "flex size-6 shrink-0 items-center justify-center rounded-md border border-border/70 bg-muted/60 text-muted-foreground"
      }
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.75}
        strokeLinecap="round"
        strokeLinejoin="round"
        className="size-3.5"
      >
        <path d="M12 8V4H8" />
        <rect width="16" height="12" x="4" y="8" rx="2" />
        <path d="M2 14h2" />
        <path d="M20 14h2" />
        <path d="M15 13v2" />
        <path d="M9 13v2" />
      </svg>
    </span>
  );
}

function ChevronRightGlyph() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="size-4 shrink-0 text-muted-foreground"
    >
      <path d="m9 18 6-6-6-6" />
    </svg>
  );
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

function PlusGlyph() {
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
      <path d="M5 12h14" />
      <path d="M12 5v14" />
    </svg>
  );
}

function FallbackAddFolderDialog({
  busy,
  error,
  onClearError,
  onAdd,
  onClose,
  t,
}: BotAddFolderDialogRenderProps & { readonly t: (key: BotMessageKey) => string }) {
  const [draftPath, setDraftPath] = useState("");

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const candidate = draftPath.trim();
    if (!candidate || busy) return;
    void onAdd(candidate).then((ok) => {
      if (ok) onClose();
    });
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t("bots.folders.dialogTitle")}
      data-testid="bot-add-folder-dialog"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
    >
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-md space-y-4 rounded-xl border border-border bg-card p-5 text-foreground shadow-lg"
      >
        <div className="space-y-1">
          <h3 className="text-base font-semibold">{t("bots.folders.dialogTitle")}</h3>
          <p className="text-xs text-muted-foreground">{t("bots.folders.dialogDescription")}</p>
        </div>
        <div className="space-y-1.5">
          <label className="block text-xs font-medium" htmlFor="bot-fallback-folder-input">
            {t("bots.folders.pathLabel")}
          </label>
          <input
            id="bot-fallback-folder-input"
            type="text"
            autoComplete="off"
            spellCheck={false}
            disabled={busy}
            placeholder={t("bots.folders.placeholder")}
            data-testid="bot-folder-input"
            value={draftPath}
            onChange={(event) => {
              setDraftPath(event.currentTarget.value);
              if (error !== null) onClearError();
            }}
            className="h-8 w-full rounded-lg border border-border bg-background px-2.5 font-mono text-xs text-foreground placeholder:text-muted-foreground focus:border-ring focus:outline-none disabled:opacity-64"
          />
          {error !== null ? (
            <p role="alert" className="text-xs text-destructive">
              {error}
            </p>
          ) : null}
        </div>
        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={onClose}
            className="h-8 cursor-pointer rounded-lg border border-border px-3 text-xs text-foreground hover:bg-muted disabled:opacity-64"
          >
            {t("bots.folders.cancel")}
          </button>
          <button
            type="submit"
            disabled={busy || draftPath.trim().length === 0}
            data-testid="bot-folder-submit"
            className="h-8 cursor-pointer rounded-lg bg-primary px-3 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:cursor-default disabled:opacity-64"
          >
            {t("bots.folders.addButton")}
          </button>
        </div>
      </form>
    </div>
  );
}

interface BotDetailViewProps {
  readonly bot: BotSummary;
  readonly httpBaseUrl?: string | null | undefined;
  readonly onBack: () => void;
  readonly onOpenHome: (botId: string, projectId: string | null) => Promise<void>;
  readonly openingBotId: string | null;
  readonly failedBotId: string | null;
  readonly renderAddFolderDialog?:
    | ((props: BotAddFolderDialogRenderProps) => ReactNode)
    | undefined;
  readonly t: BotTranslator;
  readonly locale: string | undefined;
  readonly bots: ReadonlyArray<BotSummary>;
  readonly onOpenSkill: (scope: SkillScope, name: string | null) => void;
  readonly onOpenThread: (threadId: string) => void;
}

function BotDetailView({
  bot,
  httpBaseUrl,
  onBack,
  onOpenHome,
  openingBotId,
  failedBotId,
  renderAddFolderDialog,
  t,
  locale,
  bots,
  onOpenSkill,
  onOpenThread,
}: BotDetailViewProps) {
  const [isSavingName, setIsSavingName] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);
  const nameEditedRef = useRef(false);
  const [isSavingSummary, setIsSavingSummary] = useState(false);
  const [summaryError, setSummaryError] = useState<string | null>(null);

  const [isAddingFolder, setIsAddingFolder] = useState(false);
  const [isSavingFolders, setIsSavingFolders] = useState(false);
  const [folderError, setFolderError] = useState<string | null>(null);
  const [dialogError, setDialogError] = useState<string | null>(null);

  const folders = bot.workingFolders;
  const limitReached = folders.length >= BOT_WORKING_FOLDERS_MAX;
  const workspacePath = botWorkspacePath(bot);
  const isMain = bot.id === MAIN_BOT_ID;

  const commitName = async (rawName: string, wasEdited: boolean) => {
    if (!wasEdited || isSavingName) return;
    const trimmed = rawName.trim();
    if (trimmed.length === 0) {
      setNameError(t("bots.detail.name.emptyError"));
      return;
    }
    if (trimmed === bot.name) {
      setNameError(null);
      return;
    }
    setIsSavingName(true);
    setNameError(null);
    try {
      await updateBotProfile(bot.id, { name: trimmed }, { httpBaseUrl });
    } catch (caught) {
      setNameError(errorMessage(caught, t("bots.detail.name.saveFailed")));
    } finally {
      setIsSavingName(false);
    }
  };

  const commitSummary = async (rawSummary: string) => {
    const trimmed = rawSummary.trim();
    if (isSavingSummary || trimmed === bot.summary) return;
    setIsSavingSummary(true);
    setSummaryError(null);
    try {
      await updateBotProfile(bot.id, { summary: trimmed }, { httpBaseUrl });
    } catch (caught) {
      setSummaryError(errorMessage(caught, t("bots.detail.summary.saveFailed")));
    } finally {
      setIsSavingSummary(false);
    }
  };

  const addFolder = async (rawPath: string): Promise<boolean> => {
    const candidate = rawPath.trim();
    if (!candidate || isSavingFolders) return false;
    if (limitReached) {
      setDialogError(t("bots.folders.limitReached"));
      return false;
    }
    const candidateKey = normalizePathKey(candidate);
    if (folders.some((existing) => normalizePathKey(existing) === candidateKey)) {
      setDialogError(t("bots.folders.duplicate"));
      return false;
    }
    setIsSavingFolders(true);
    setDialogError(null);
    setFolderError(null);
    try {
      await updateBotWorkingFolders(bot.id, [...folders, candidate], { httpBaseUrl });
      return true;
    } catch (caught) {
      setDialogError(errorMessage(caught, t("bots.folders.saveFailed")));
      return false;
    } finally {
      setIsSavingFolders(false);
    }
  };

  const removeFolder = async (target: string) => {
    if (isSavingFolders) return;
    setIsSavingFolders(true);
    setFolderError(null);
    try {
      await updateBotWorkingFolders(
        bot.id,
        folders.filter((folder) => folder !== target),
        { httpBaseUrl },
      );
    } catch (caught) {
      setFolderError(errorMessage(caught, t("bots.folders.saveFailed")));
    } finally {
      setIsSavingFolders(false);
    }
  };

  const dialogProps: BotAddFolderDialogRenderProps = {
    bot,
    busy: isSavingFolders,
    error: dialogError,
    onClearError: () => setDialogError(null),
    onAdd: addFolder,
    onClose: () => {
      setIsAddingFolder(false);
      setDialogError(null);
    },
  };

  return (
    <div className="space-y-6" data-testid={`bot-detail-${bot.id}`}>
      <div className="flex flex-wrap items-center justify-between gap-3 px-1 sm:px-2">
        <div className="flex min-w-0 items-center gap-2.5">
          <button
            type="button"
            data-testid="bot-detail-back"
            onClick={onBack}
            className="inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-lg border border-border/70 bg-background px-2.5 text-xs font-medium text-muted-foreground hover:bg-accent/50 hover:text-foreground"
          >
            <ArrowLeftGlyph />
            <span>{t("bots.settings.backToList")}</span>
          </button>
          <BotGlyph main={isMain} />
          <div className="flex min-w-0 items-center gap-2">
            <h2 className="truncate text-base font-semibold text-foreground">{bot.name}</h2>
            <span className="shrink-0 rounded-md border border-border/70 px-1.5 py-0.5 text-xs leading-none font-medium text-muted-foreground">
              {isMain ? t("bots.role.main") : t("bots.role.sub")}
            </span>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {failedBotId === bot.id ? (
            <span role="alert" className="text-xs text-destructive">
              {t("bots.home.openFailed")}
            </span>
          ) : null}
          <button
            type="button"
            disabled={openingBotId !== null}
            onClick={() => void onOpenHome(bot.id, bot.projectId)}
            className="h-7 cursor-pointer rounded-lg border border-border bg-background px-2.5 text-xs font-medium text-foreground hover:bg-accent/50 disabled:cursor-default disabled:opacity-64"
          >
            {t("bots.list.open")}
          </button>
        </div>
      </div>

      {/* Overview section matching ProjectSettingsPanel's Name row */}
      <section className="space-y-2.5">
        <div className="rounded-xl border border-border/60 bg-card/40 shadow-xs/5 *:not-first:border-t *:not-first:border-border/50">
          <div className="px-3 py-3 sm:px-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-8">
              <div className="min-w-0 flex-1 space-y-1">
                <h3 className="text-sm font-medium text-foreground">
                  {t("bots.detail.name.title")}
                </h3>
                <p className="text-xs leading-normal text-muted-foreground">
                  {t("bots.detail.name.description")}
                </p>
              </div>
              <div className="flex w-full min-w-0 shrink-0 flex-col gap-1 sm:w-64">
                <input
                  key={`${bot.id}:${bot.name}`}
                  type="text"
                  aria-label={t("bots.detail.name.title")}
                  data-testid={`bot-name-input-${bot.id}`}
                  disabled={isSavingName}
                  defaultValue={bot.name}
                  onChange={() => {
                    nameEditedRef.current = true;
                    if (nameError !== null) setNameError(null);
                  }}
                  onBlur={(event) => {
                    const wasEdited = nameEditedRef.current;
                    nameEditedRef.current = false;
                    void commitName(event.currentTarget.value, wasEdited);
                  }}
                  onKeyDown={(event) => {
                    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
                    if (event.key === "Enter") event.currentTarget.blur();
                  }}
                  className="h-8 w-full rounded-lg border border-border bg-background px-2.5 text-sm text-foreground focus:border-ring focus:outline-none disabled:opacity-64"
                />
                {nameError !== null ? (
                  <p role="alert" className="text-xs text-destructive">
                    {nameError}
                  </p>
                ) : null}
              </div>
            </div>
          </div>

          {isMain ? null : (
            <div className="space-y-2 px-3 py-3 sm:px-4">
              <div className="space-y-1">
                <h3 className="text-sm font-medium text-foreground">
                  {t("bots.detail.summary.title")}
                </h3>
                <p className="text-xs leading-normal text-muted-foreground">
                  {t("bots.detail.summary.description")}
                </p>
              </div>
              <input
                key={`${bot.id}:${bot.summary}`}
                type="text"
                aria-label={t("bots.detail.summary.title")}
                data-testid={`bot-summary-input-${bot.id}`}
                disabled={isSavingSummary}
                defaultValue={bot.summary}
                placeholder={t("bots.detail.summary.placeholder")}
                onChange={() => {
                  if (summaryError !== null) setSummaryError(null);
                }}
                onBlur={(event) => void commitSummary(event.currentTarget.value)}
                onKeyDown={(event) => {
                  if (event.nativeEvent.isComposing || event.keyCode === 229) return;
                  if (event.key === "Enter") event.currentTarget.blur();
                }}
                className="h-8 w-full rounded-lg border border-border bg-background px-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:border-ring focus:outline-none disabled:opacity-64"
              />
              {summaryError !== null ? (
                <p role="alert" className="text-xs text-destructive">
                  {summaryError}
                </p>
              ) : null}
            </div>
          )}

          <div className="px-3 py-3 sm:px-4">
            <div className="space-y-1">
              <h3 className="text-sm font-medium text-foreground">
                {t("bots.detail.workspace.title")}
              </h3>
              <p className="text-xs leading-normal text-muted-foreground">
                {t("bots.detail.workspace.description")}
              </p>
              <code className="block max-w-full truncate pt-0.5 font-mono text-xs text-muted-foreground">
                {workspacePath}
              </code>
            </div>
          </div>
        </div>
      </section>

      <BotPersonaSection botId={bot.id} httpBaseUrl={httpBaseUrl} t={t} />

      <BotMemorySection botId={bot.id} httpBaseUrl={httpBaseUrl} t={t} />

      {/* Working folders section matching ProjectRepositoriesSettings */}
      <section className="space-y-2.5" data-testid={`settings-bot-folders-${bot.id}`}>
        <div className="flex min-h-7 items-center justify-between px-3 sm:px-4">
          <div className="flex items-center gap-2">
            <h2 className="text-base font-semibold text-foreground">{t("bots.folders.title")}</h2>
            {folders.length > 0 ? (
              <span className="rounded-md border border-border/70 px-1.5 py-0.5 font-mono text-xs leading-none text-muted-foreground">
                {folders.length}
              </span>
            ) : null}
          </div>
        </div>
        <div className="rounded-xl border border-border/60 bg-card/40 shadow-xs/5 *:not-first:border-t *:not-first:border-border/50">
          <div className="px-3 py-3 sm:px-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-8">
              <p className="min-w-0 flex-1 text-xs leading-normal text-muted-foreground">
                {t("bots.folders.description")}
              </p>
              <div className="flex shrink-0 items-center gap-2">
                <button
                  type="button"
                  disabled={isSavingFolders || limitReached}
                  data-testid={`bot-folder-add-open-${bot.id}`}
                  onClick={() => {
                    setDialogError(null);
                    setIsAddingFolder(true);
                  }}
                  className="inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-lg border border-border bg-background px-2.5 text-xs font-medium text-foreground hover:bg-accent/50 disabled:cursor-default disabled:opacity-64"
                >
                  <PlusGlyph />
                  <span>{t("bots.folders.addButton")}</span>
                </button>
              </div>
            </div>
          </div>

          {folders.length === 0 ? (
            <p
              className="px-3 py-3 text-xs leading-normal text-muted-foreground sm:px-4"
              data-testid={`bot-folders-empty-${bot.id}`}
            >
              {t("bots.folders.emptyDetail")}
            </p>
          ) : (
            <div
              className="*:not-first:border-t *:not-first:border-border/50"
              data-testid={`bot-folders-list-${bot.id}`}
            >
              {folders.map((folder) => {
                const label = folderBaseName(folder);
                return (
                  <div
                    key={folder}
                    className="flex flex-col gap-2 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between sm:gap-6 sm:px-4"
                  >
                    <div className="min-w-0 flex-1 space-y-0.5">
                      <div className="flex min-w-0 items-center gap-2">
                        <span className="min-w-0 truncate text-sm font-medium text-foreground">
                          {label}
                        </span>
                        <span className="shrink-0 rounded-md border border-border/70 px-1.5 py-0.5 text-xs leading-none font-medium text-muted-foreground">
                          {t("bots.folders.folderBadge")}
                        </span>
                      </div>
                      <code className="block max-w-full truncate font-mono text-xs text-muted-foreground">
                        {folder}
                      </code>
                    </div>
                    <button
                      type="button"
                      disabled={isSavingFolders}
                      aria-label={`${t("bots.folders.remove")} ${label}`}
                      onClick={() => void removeFolder(folder)}
                      className="h-7 shrink-0 cursor-pointer self-start rounded-lg px-2.5 text-xs font-medium text-muted-foreground hover:bg-accent/50 hover:text-foreground disabled:cursor-default disabled:opacity-64 sm:self-center"
                    >
                      {t("bots.folders.remove")}
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          {folderError !== null ? (
            <p role="alert" className="px-3 py-2 text-xs text-destructive sm:px-4">
              {folderError}
            </p>
          ) : null}
        </div>
      </section>

      <SkillReviewSection httpBaseUrl={httpBaseUrl} t={t} botId={bot.id} />

      <SkillSuggestionsSection
        locale={locale}
        httpBaseUrl={httpBaseUrl}
        t={t}
        bots={bots}
        botId={bot.id}
        onOpenSkill={onOpenSkill}
        onOpenThread={onOpenThread}
      />

      <SkillListSection
        scope={{ scope: "bot", botId: bot.id }}
        title={t("bots.skills.title")}
        note={t("bots.skills.bot.note")}
        locale={locale}
        httpBaseUrl={httpBaseUrl}
        t={t}
        onOpenSkill={onOpenSkill}
      />

      {isAddingFolder ? (
        renderAddFolderDialog !== undefined ? (
          renderAddFolderDialog(dialogProps)
        ) : (
          <FallbackAddFolderDialog {...dialogProps} t={t} />
        )
      ) : null}
    </div>
  );
}

export function BotsSettingsView({
  locale,
  httpBaseUrl,
  onOpenThread,
  sidebarToggleSlot,
  renderAddFolderDialog,
}: BotsSettingsViewProps) {
  const t = createBotTranslator(locale);
  const bots = useBotList(httpBaseUrl);
  const { openHome, openingBotId, failedBotId } = useOpenBotHome(httpBaseUrl, onOpenThread);
  const [selectedBotId, setSelectedBotId] = useState<string | null>(null);
  const [openSkill, setOpenSkill] = useState<{
    readonly scope: SkillScope;
    readonly name: string | null;
  } | null>(null);

  const orderedBots = [...bots].sort((left, right) => {
    if (left.id === MAIN_BOT_ID) return -1;
    if (right.id === MAIN_BOT_ID) return 1;
    return left.name.localeCompare(right.name);
  });
  const selectedBot =
    selectedBotId === null ? null : (orderedBots.find((bot) => bot.id === selectedBotId) ?? null);

  if (openSkill !== null) {
    return (
      <SkillDetailView
        key={`${openSkill.scope.scope === "bot" ? openSkill.scope.botId : "shared"}:${openSkill.name ?? ""}`}
        scope={openSkill.scope}
        initialName={openSkill.name}
        bots={orderedBots}
        locale={locale}
        httpBaseUrl={httpBaseUrl}
        t={t}
        onBack={() => setOpenSkill(null)}
        onOpenThread={onOpenThread}
      />
    );
  }

  const onOpenSkill = (scope: SkillScope, name: string | null) => setOpenSkill({ scope, name });

  if (selectedBot !== null) {
    return (
      <BotDetailView
        key={selectedBot.id}
        bot={selectedBot}
        httpBaseUrl={httpBaseUrl}
        onBack={() => setSelectedBotId(null)}
        onOpenHome={openHome}
        openingBotId={openingBotId}
        failedBotId={failedBotId}
        renderAddFolderDialog={renderAddFolderDialog}
        t={t}
        locale={locale}
        bots={orderedBots}
        onOpenSkill={onOpenSkill}
        onOpenThread={onOpenThread}
      />
    );
  }

  return (
    <div className="space-y-6" data-testid="bots-settings-chooser">
      {sidebarToggleSlot ? (
        <div className="rounded-xl border border-border/60 bg-card/40 shadow-xs/5">
          {sidebarToggleSlot}
        </div>
      ) : null}

      <div className="space-y-3">
        <p className="px-3 text-sm text-muted-foreground sm:px-4">
          {t("bots.settings.choosePrompt")}
        </p>
        <div
          className="rounded-xl border border-border/60 bg-card/40 shadow-xs/5 *:not-first:border-t *:not-first:border-border/50"
          data-testid="settings-bots-list"
        >
          {orderedBots.map((bot) => {
            const isMain = bot.id === MAIN_BOT_ID;
            const subtitle =
              (isMain ? t("bots.main.description") : bot.summary) || botWorkspacePath(bot);
            return (
              <button
                key={bot.id}
                type="button"
                data-testid={`settings-bot-row-${bot.id}`}
                onClick={() => setSelectedBotId(bot.id)}
                className="flex w-full min-w-0 cursor-pointer items-center gap-3 px-3 py-3 text-left outline-none first:rounded-t-xl last:rounded-b-xl hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:px-4"
              >
                <BotGlyph main={isMain} />
                <span className="min-w-0 flex-1">
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="truncate text-sm font-medium text-foreground">{bot.name}</span>
                    <span className="shrink-0 rounded-md border border-border/70 px-1.5 py-0.5 text-xs leading-none font-medium text-muted-foreground">
                      {isMain ? t("bots.role.main") : t("bots.role.sub")}
                    </span>
                    {bot.workingFolders.length > 0 ? (
                      <span className="shrink-0 rounded-md border border-border/70 px-1.5 py-0.5 font-mono text-xs leading-none text-muted-foreground">
                        {bot.workingFolders.length}
                      </span>
                    ) : null}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">{subtitle}</span>
                </span>
                <ChevronRightGlyph />
              </button>
            );
          })}
        </div>
      </div>

      <SkillReviewSection httpBaseUrl={httpBaseUrl} t={t} botId={null} />

      <SkillSuggestionsSection
        locale={locale}
        httpBaseUrl={httpBaseUrl}
        t={t}
        bots={orderedBots}
        botId={null}
        onOpenSkill={onOpenSkill}
        onOpenThread={onOpenThread}
      />

      <SkillListSection
        scope={{ scope: "shared" }}
        title={t("bots.skills.shared.title")}
        note={
          orderedBots.length > 1
            ? t("bots.skills.shared.note", { count: orderedBots.length })
            : t("bots.skills.shared.noteGeneric")
        }
        locale={locale}
        httpBaseUrl={httpBaseUrl}
        t={t}
        onOpenSkill={onOpenSkill}
      />
    </div>
  );
}
