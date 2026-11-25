import { useBotList } from "@t3tools/bot/web/botList";
import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import { AuthOrchestrationOperateScope, type ScopedThreadRef } from "@t3tools/contracts";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import * as ThreadUndo from "@t3tools/client-runtime/state/thread-undo";
import * as Option from "effect/Option";
import { useGT } from "gt-react";
import { CheckIcon, CheckCircle2Icon } from "lucide-react";
import { useState, type ReactNode } from "react";

import { cn } from "../../lib/utils";
import { useThreadShell } from "../../state/entities";
import { useEnvironmentScope, usePreparedConnection } from "../../state/session";
import { threadEnvironment } from "../../state/threads";
import { useOrchestrationCommand } from "../../state/use-orchestration-command";
import { InlineButton } from "../ui/button";
import { toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { isBotSessionThread } from "./useBotSessionChip";

export function BotSessionFooterSettle({ threadRef }: { readonly threadRef: ScopedThreadRef }) {
  const shell = useThreadShell(threadRef);
  const prepared = usePreparedConnection(threadRef.environmentId);
  const bots = useBotList(Option.isSome(prepared) ? prepared.value.httpBaseUrl : null);
  if (!isBotSessionThread(bots, shell?.projectId, threadRef.threadId)) return null;
  return (
    <div className="mx-auto flex w-full min-w-0 max-w-(--chat-content-max-width) items-center px-1 pb-2 text-xs text-muted-foreground">
      <ThreadSettleButton threadRef={threadRef} settled={false} />
    </div>
  );
}

export function ThreadSettleButton({
  threadRef,
  settled,
  compact = false,
}: {
  readonly threadRef: ScopedThreadRef;
  readonly settled: boolean;
  readonly compact?: boolean;
}) {
  const gt = useGT();
  const canOperate = useEnvironmentScope(threadRef.environmentId, AuthOrchestrationOperateScope);
  const settleThreadMutation = useOrchestrationCommand(threadEnvironment.settle, {
    reportFailure: false,
  });
  const unsettleThreadMutation = useOrchestrationCommand(threadEnvironment.unsettle, {
    reportFailure: false,
  });
  const [pending, setPending] = useState(false);
  if (!canOperate) return null;
  const label = settled ? gt("Un-settle thread") : gt("Settle thread");
  const toggle = async () => {
    if (pending) return;
    setPending(true);
    const key = scopedThreadKey(threadRef);
    ThreadUndo.invalidate("settle", key);
    if (!settled) {
      ThreadUndo.invalidate("pin", key);
      ThreadUndo.invalidate("snooze", key);
    }
    const result = await (settled
      ? unsettleThreadMutation({
          environmentId: threadRef.environmentId,
          input: { threadId: threadRef.threadId, reason: "user" },
        })
      : settleThreadMutation({
          environmentId: threadRef.environmentId,
          input: { threadId: threadRef.threadId },
        }));
    setPending(false);
    if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
      const error = squashAtomCommandFailure(result);
      toastManager.add({
        type: "error",
        title: settled ? gt("Failed to un-settle thread") : gt("Failed to settle thread"),
        description: error instanceof Error ? error.message : gt("An error occurred."),
      });
    }
  };
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <InlineButton
            aria-label={label}
            aria-pressed={settled}
            disabled={pending}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              void toggle();
            }}
          />
        }
      >
        {settled ? <CheckCircle2Icon className="size-3.5" /> : <CheckIcon className="size-3.5" />}
        {compact ? null : settled ? gt("Un-settle") : gt("Settle thread")}
      </TooltipTrigger>
      <TooltipPopup>{label}</TooltipPopup>
    </Tooltip>
  );
}

export function BotSessionChipActions({
  enabled,
  threadRef,
  children,
}: {
  readonly enabled: boolean;
  readonly threadRef: ScopedThreadRef;
  readonly children: ReactNode;
}) {
  const shell = useThreadShell(threadRef);
  if (!enabled || !shell) return children;
  const settled = shell.settledOverride === "settled";
  return (
    <span className="group/bot-session inline-flex max-w-full items-center gap-1 align-baseline">
      {children}
      <span
        className={cn(
          "inline-flex shrink-0 text-muted-foreground",
          !settled &&
            "pointer-events-none opacity-0 group-hover/bot-session:pointer-events-auto group-hover/bot-session:opacity-100 group-focus-within/bot-session:pointer-events-auto group-focus-within/bot-session:opacity-100 [@media(hover:none)]:pointer-events-auto [@media(hover:none)]:opacity-100",
        )}
      >
        <ThreadSettleButton
          key={threadRef.threadId}
          threadRef={threadRef}
          settled={settled}
          compact
        />
      </span>
    </span>
  );
}
