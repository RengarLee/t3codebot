import { createBot } from "@t3tools/bot/web/apiClient";
import { createBotTranslator } from "@t3tools/bot/web/i18n";
import type { EnvironmentId } from "@t3tools/contracts";
import { BotIcon } from "lucide-react";
import { type KeyboardEvent, useState, useSyncExternalStore } from "react";

import { getI18nSnapshot, subscribeI18n } from "../../i18n/runtime";
import { useEnvironmentHttpBaseUrl } from "../../state/environments";
import {
  ADDON_ICON_CLASS,
  type CommandPaletteActionItem,
  type CommandPaletteView,
  ITEM_ICON_CLASS,
} from "../CommandPalette.logic";
import { CommandPaletteSubmitButton } from "../CommandPaletteAddProject";
import { CommandPaletteTitleIcon } from "../CommandPaletteResults";

type CreateBotStep =
  | { readonly environmentId: EnvironmentId; readonly step: "name" }
  | { readonly environmentId: EnvironmentId; readonly step: "purpose"; readonly name: string };

const botView = (): CommandPaletteView => ({
  addonIcon: <BotIcon className={ADDON_ICON_CLASS} />,
  groups: [],
});

/** "Create bot" in the add-project palette: one submenu view per field, like "New project". */
export function useCreateBotPaletteFlow(props: {
  readonly query: string;
  readonly pushView: (view: CommandPaletteView) => void;
  readonly setOpen: (open: boolean) => void;
}) {
  const { locale } = useSyncExternalStore(subscribeI18n, getI18nSnapshot);
  const t = createBotTranslator(locale);
  const [flow, setFlow] = useState<CreateBotStep | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const httpBaseUrl = useEnvironmentHttpBaseUrl(flow?.environmentId ?? null);
  const value = props.query.trim();
  const canSubmit = flow !== null && value.length > 0 && !submitting;

  const submitLabel = submitting
    ? t("bots.create.creating")
    : flow?.step === "name"
      ? t("bots.create.next")
      : t("bots.create.submit");

  const submit = async () => {
    if (flow === null || !canSubmit) return;
    setError(null);
    if (flow.step === "name") {
      setFlow({ environmentId: flow.environmentId, step: "purpose", name: value });
      props.pushView(botView());
      return;
    }
    setSubmitting(true);
    try {
      await createBot({ name: flow.name, summary: value }, { httpBaseUrl });
      props.setOpen(false);
    } catch {
      setError(t("bots.create.failed"));
    } finally {
      setSubmitting(false);
    }
  };

  return {
    active: flow !== null,
    placeholder:
      flow?.step === "purpose"
        ? t("bots.create.purposePlaceholder")
        : t("bots.create.namePlaceholder"),
    submitLabel,
    emptyHint:
      flow?.step === "purpose" ? t("bots.create.purposeEmptyHint") : t("bots.create.nameEmptyHint"),
    handleKeyDown: (event: KeyboardEvent<HTMLInputElement>): boolean => {
      // Enter that confirms an IME composition is part of typing.
      if (flow === null || event.key !== "Enter" || event.nativeEvent.isComposing) return false;
      event.preventDefault();
      void submit();
      return true;
    },
    accessory: (id: string) =>
      flow === null ? null : (
        <CommandPaletteSubmitButton
          id={id}
          label={submitLabel}
          shortcutLabel="Enter"
          ariaLabel={submitLabel}
          tooltip={submitLabel}
          disabled={!canSubmit}
          onSubmit={() => void submit()}
        />
      ),
    item: (environmentId: EnvironmentId): CommandPaletteActionItem => ({
      kind: "action",
      value: `action:add-project:${environmentId}:bot`,
      searchTerms: ["bot", "agent", "assistant", "机器人"],
      title: t("bots.create.title"),
      description: t("bots.create.paletteDescription"),
      icon: <BotIcon className={ITEM_ICON_CLASS} />,
      keepOpen: true,
      run: async () => {
        setError(null);
        setFlow({ environmentId, step: "name" });
        props.pushView(botView());
      },
    }),
    back: () => {
      setError(null);
      setFlow((current) =>
        current?.step === "purpose" ? { environmentId: current.environmentId, step: "name" } : null,
      );
    },
    summary:
      flow === null ? null : (
        <div className="p-2 pb-0">
          <div className="flex min-h-8 items-center gap-2 rounded-sm px-2 py-1.5">
            <CommandPaletteTitleIcon>
              <BotIcon className={ITEM_ICON_CLASS} />
            </CommandPaletteTitleIcon>
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-foreground text-sm">
                {flow.step === "purpose" ? flow.name : value || t("bots.create.newBot")}
              </span>
              <span
                className={
                  error
                    ? "truncate text-destructive-foreground text-xs"
                    : "truncate text-muted-foreground/85 text-xs"
                }
              >
                {error ??
                  (flow.step === "name"
                    ? t("bots.create.nameHint")
                    : value || t("bots.create.purposeHint"))}
              </span>
            </span>
          </div>
        </div>
      ),
  };
}
