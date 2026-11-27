import { useState } from "react";

import type { BotFile, BotFilePath } from "../contracts.ts";
import { readBotFile, saveBotFile, readBotFileHistory, restoreBotFile } from "./apiClient.ts";
import type { BotTranslator } from "./i18n.ts";
import { SKILL_BUTTON_CLASS, SKILL_PRIMARY_BUTTON_CLASS } from "./skillUi.tsx";
import { skillErrorStatus, useSkillResource } from "./useSkillResource.ts";

export interface BotFileEditorProps {
  readonly botId: string;
  readonly path: BotFilePath;
  readonly label: string;
  readonly httpBaseUrl?: string | null | undefined;
  readonly t: BotTranslator;
}

type SaveState = "idle" | "saving" | "saved" | "failed" | "conflict";

/** Edits one of a bot's markdown files. The bot writes these too, so saves are refused when stale. */
export function BotFileEditor(props: BotFileEditorProps) {
  return <FileEditor key={`${props.httpBaseUrl}:${props.botId}:${props.path}`} {...props} />;
}

function FileEditor({ botId, path, label, httpBaseUrl, t }: BotFileEditorProps) {
  const resource = useSkillResource(`${botId}:${path}`, () =>
    readBotFile(botId, path, { httpBaseUrl }),
  );
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyVersion, setHistoryVersion] = useState(0);
  const [saved, setSaved] = useState<BotFile | null>(null);
  const [draft, setDraft] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("idle");

  const base = saved ?? resource.data?.file ?? null;
  if (base === null) {
    if (resource.error !== null) {
      return (
        <div className="flex items-center justify-between gap-3 px-3 py-3 sm:px-4">
          <p role="alert" className="text-xs text-destructive">
            {t("bots.file.loadFailed")}
          </p>
          <button type="button" className={SKILL_BUTTON_CLASS} onClick={resource.reload}>
            {t("bots.file.retry")}
          </button>
        </div>
      );
    }
    return (
      <p className="px-3 py-3 text-xs text-muted-foreground sm:px-4">{t("bots.file.loading")}</p>
    );
  }

  const text = draft ?? base.content;
  const dirty = text !== base.content;
  const busy = saveState === "saving";

  const write = async (expectedVersion: string | null) => {
    setSaveState("saving");
    try {
      const { file } = await saveBotFile(
        { botId, path, content: text, expectedVersion },
        { httpBaseUrl },
      );
      setHistoryVersion((value) => value + 1);
      setSaved(file);
      setDraft(null);
      setSaveState("saved");
    } catch (caught) {
      setSaveState(skillErrorStatus(caught) === 409 ? "conflict" : "failed");
    }
  };

  const keepMine = async () => {
    setSaveState("saving");
    try {
      const { file } = await readBotFile(botId, path, { httpBaseUrl });
      await write(file.version);
    } catch {
      setSaveState("failed");
    }
  };

  const loadLatest = () => {
    setSaved(null);
    setDraft(null);
    setSaveState("idle");
    resource.reload();
  };

  return (
    <div className="space-y-2 px-3 py-3 sm:px-4">
      {(path === "MEMORY.md" || path === "USER.md") && (
        <>
          <button
            type="button"
            className={SKILL_BUTTON_CLASS}
            aria-expanded={historyOpen}
            onClick={() => setHistoryOpen(!historyOpen)}
          >
            {t("bots.file.history")}
          </button>
          {historyOpen && (
            <MemoryHistory
              key={historyVersion}
              botId={botId}
              path={path}
              httpBaseUrl={httpBaseUrl}
              t={t}
              disabled={dirty || busy || saveState === "conflict"}
              dirty={dirty}
              onRestore={async (revision) => {
                setSaveState("saving");
                try {
                  const { file } = await restoreBotFile(
                    { botId, path, revision, expectedVersion: base.version },
                    { httpBaseUrl },
                  );
                  setSaved(file);
                  setDraft(null);
                  setSaveState("saved");
                  setHistoryVersion((value) => value + 1);
                } catch (error) {
                  setSaveState(skillErrorStatus(error) === 409 ? "conflict" : "failed");
                }
              }}
            />
          )}
        </>
      )}
      <textarea
        aria-label={label}
        data-testid={`bot-file-editor-${path}`}
        spellCheck={false}
        value={text}
        disabled={busy}
        onChange={(event) => {
          setDraft(event.currentTarget.value);
          if (saveState === "saved" || saveState === "failed") setSaveState("idle");
        }}
        onKeyDown={(event) => {
          if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
            event.preventDefault();
            if (dirty && !busy && saveState !== "conflict") void write(base.version);
          }
        }}
        className="block min-h-48 w-full resize-y rounded-lg border border-border bg-background p-2.5 font-mono text-xs leading-normal text-foreground focus:border-ring focus:outline-none disabled:opacity-64"
      />
      {saveState === "conflict" ? (
        <div
          role="alert"
          className="flex flex-col gap-2 rounded-lg border border-destructive/40 bg-destructive/5 px-2.5 py-2 sm:flex-row sm:items-center sm:justify-between"
        >
          <p className="text-xs text-destructive">{t("bots.file.conflict")}</p>
          <div className="flex shrink-0 items-center gap-2">
            <button type="button" className={SKILL_BUTTON_CLASS} onClick={loadLatest}>
              {t("bots.file.loadLatest")}
            </button>
            {dirty && (
              <button
                type="button"
                className={SKILL_PRIMARY_BUTTON_CLASS}
                onClick={() => void keepMine()}
              >
                {t("bots.file.keepMine")}
              </button>
            )}
          </div>
        </div>
      ) : (
        <div className="flex items-center justify-end gap-2">
          {saveState === "failed" ? (
            <span role="alert" className="mr-auto text-xs text-destructive">
              {t("bots.file.saveFailed")}
            </span>
          ) : saveState === "saved" && !dirty ? (
            <span className="mr-auto text-xs text-muted-foreground">{t("bots.file.saved")}</span>
          ) : null}
          <button
            type="button"
            className={SKILL_BUTTON_CLASS}
            disabled={!dirty || busy}
            onClick={() => {
              setDraft(null);
              setSaveState("idle");
            }}
          >
            {t("bots.file.revert")}
          </button>
          <button
            type="button"
            data-testid={`bot-file-save-${path}`}
            className={SKILL_PRIMARY_BUTTON_CLASS}
            disabled={!dirty || busy}
            onClick={() => void write(base.version)}
          >
            {busy ? t("bots.file.saving") : t("bots.file.save")}
          </button>
        </div>
      )}
    </div>
  );
}

function MemoryHistory({
  botId,
  path,
  httpBaseUrl,
  t,
  disabled,
  dirty,
  onRestore,
}: Omit<BotFileEditorProps, "path" | "label"> & {
  path: "MEMORY.md" | "USER.md";
  disabled: boolean;
  dirty: boolean;
  onRestore: (revision: number) => Promise<void>;
}) {
  const history = useSkillResource(`${httpBaseUrl}:${botId}:${path}`, () =>
    readBotFileHistory({ botId, path }, { httpBaseUrl }),
  );
  return (
    <div className="space-y-2 rounded-lg border border-border p-3 text-xs">
      {dirty && <p>{t("bots.file.historyDraft")}</p>}
      {history.loading && <p>{t("bots.file.loading")}</p>}
      {history.error !== null && (
        <button type="button" className={SKILL_BUTTON_CLASS} onClick={history.reload}>
          {t("bots.file.retry")}
        </button>
      )}
      {history.data?.revisions.length === 0 && <p>{t("bots.file.historyEmpty")}</p>}
      {history.data?.revisions.map((entry) => (
        <details key={entry.revision}>
          <summary className="cursor-pointer">
            <time dateTime={entry.createdAt}>{entry.createdAt}</time> · {entry.reason} ·{" "}
            {t(`bots.file.source.${entry.trigger}`)}
          </summary>
          {entry.threadId && <p className="break-all">{entry.threadId}</p>}
          <pre className="max-h-64 overflow-auto whitespace-pre-wrap py-2">{entry.content}</pre>
          <button
            type="button"
            className={SKILL_BUTTON_CLASS}
            disabled={disabled}
            onClick={() => void onRestore(entry.revision)}
          >
            {t("bots.file.restore")}
          </button>
        </details>
      ))}
    </div>
  );
}
