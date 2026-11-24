#!/usr/bin/env node
// @effect-diagnostics nodeBuiltinImport:off globalConsole:off - Standalone CI step that patches a release checkout.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

export interface RebrandEdit {
  readonly file: string;
  readonly from: string;
  readonly to: string;
}

// Release builds install as Steward beside the official T3 Code instead of upgrading it.
// The source stays upstream's so nightly syncs never conflict; CI applies these to its checkout.
export const BOT_REBRAND_EDITS: ReadonlyArray<RebrandEdit> = [
  {
    file: "scripts/build-desktop-artifact.ts",
    from: 'const DESKTOP_APP_ID = "com.t3tools.t3code";',
    to: 'const DESKTOP_APP_ID = "com.rengarlee.steward";',
  },
  {
    file: "scripts/build-desktop-artifact.ts",
    from: '? "T3 Code (Nightly)"\n    : (desktopPackageJson.productName ?? "T3 Code");',
    to: '? "Steward (Nightly)"\n    : "Steward";',
  },
  {
    file: "scripts/build-desktop-artifact.ts",
    from: 'artifactName: "T3-Code-${version}-${arch}.${ext}",',
    to: 'artifactName: "Steward-${version}-${arch}.${ext}",',
  },
  {
    // Must match appId: the installer stamps APP_ID onto the Start menu shortcut.
    file: "apps/desktop/src/app/DesktopEnvironment.ts",
    from: 'isDevelopment ? "com.t3tools.t3code.dev" : "com.t3tools.t3code",',
    to: 'isDevelopment ? "com.rengarlee.steward.dev" : "com.rengarlee.steward",',
  },
  {
    // A separate Electron profile keeps the single-instance lock apart. Seeding its Local State
    // from T3 Code's shares the safeStorage key, so both apps can read the shared ~/.t3 catalog.
    file: "apps/desktop/src/app/DesktopUserData.ts",
    from: ': { current: "t3code-v2", legacy: "T3 Code (Alpha)" };',
    to: ': { current: "steward", legacy: "t3code-v2" };',
  },
];

export function applyRebrandEdit(source: string, edit: RebrandEdit): string {
  const count = source.split(edit.from).length - 1;
  if (count !== 1) {
    throw new Error(
      `bot-rebrand: expected exactly one match in ${edit.file}, found ${count}: ${JSON.stringify(edit.from)}`,
    );
  }
  return source.replace(edit.from, () => edit.to);
}

export function applyRebrand(rootDir: string, edits: ReadonlyArray<RebrandEdit>): void {
  const patched = new Map<string, string>();
  for (const edit of edits) {
    const filePath = NodePath.join(rootDir, edit.file);
    const source = patched.get(filePath) ?? NodeFS.readFileSync(filePath, "utf8");
    patched.set(filePath, applyRebrandEdit(source, edit));
  }
  for (const [filePath, source] of patched) {
    NodeFS.writeFileSync(filePath, source);
  }
}

if (import.meta.main) {
  const rootDir = NodePath.resolve(import.meta.dirname, "..");
  applyRebrand(rootDir, BOT_REBRAND_EDITS);
  console.log(`bot-rebrand: applied ${BOT_REBRAND_EDITS.length} edits`);
}
