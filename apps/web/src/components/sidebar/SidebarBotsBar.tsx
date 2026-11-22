import * as Schema from "effect/Schema";
import { useGT } from "gt-react";

import { useLocalStorage } from "../../hooks/useLocalStorage";
import { useClientSettings } from "../../hooks/useSettings";
import { CollapsibleSectionHeader } from "../ui/collapsible-section-header";

export function SidebarBotsBar() {
  const gt = useGT();
  const enabled = useClientSettings((settings) => settings.botsBarEnabled);
  const [expanded, setExpanded] = useLocalStorage(
    "t3code.sidebarBotsPanelOpen",
    false,
    Schema.Boolean,
  );
  if (!enabled) return null;
  return (
    <div className="mx-0.5">
      <CollapsibleSectionHeader expanded={expanded} onClick={() => setExpanded(!expanded)}>
        {gt("Bots")}
      </CollapsibleSectionHeader>
      {expanded && (
        <p className="px-2 pb-2 text-xs text-sidebar-muted-foreground">{gt("No bots yet")}</p>
      )}
    </div>
  );
}
