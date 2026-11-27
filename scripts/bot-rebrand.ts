#!/usr/bin/env node
// @effect-diagnostics nodeBuiltinImport:off globalConsole:off - Standalone CI step that patches a release checkout.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

export interface RebrandEdit {
  readonly file: string;
  readonly from: string;
  readonly to: string;
}

export interface RebrandCopy {
  readonly from: string;
  readonly to: string;
}

// Release builds ship as Steward, an unofficial fork, beside the official T3 Code (TRADEMARK.md).
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
  {
    file: "apps/desktop/src/app/DesktopEnvironment.ts",
    from: 'const APP_BASE_NAME = "T3 Code";',
    to: 'const APP_BASE_NAME = "Steward";',
  },
  {
    file: "apps/web/src/branding.ts",
    from: 'injectedDesktopAppBranding?.baseName ?? "T3 Code";',
    to: 'injectedDesktopAppBranding?.baseName ?? "Steward";',
  },
  {
    file: "apps/web/vite.config.ts",
    from: 'formatAppDisplayName({ baseName: "T3 Code", stageLabel });',
    to: 'formatAppDisplayName({ baseName: "Steward", stageLabel });',
  },
  {
    file: "apps/web/index.html",
    from: 'aria-label="T3 Code splash screen"',
    to: 'aria-label="Steward splash screen"',
  },
  {
    file: "apps/web/index.html",
    from: 'alt="T3 Code"',
    to: 'alt="Steward"',
  },
  {
    file: "apps/web/src/components/sidebar/SidebarChrome.tsx",
    from: '<T3Wordmark aria-label="T3" ',
    to: "<T3Wordmark aria-hidden ",
  },
  {
    file: "apps/web/src/components/sidebar/SidebarChrome.tsx",
    from: '{"Code"}',
    to: '{"Steward"}',
  },
  {
    file: "apps/web/src/components/ui/standalone-page.tsx",
    from: '<span className="text-lg font-medium tracking-tight">Code</span>',
    to: '<span className="text-lg font-medium tracking-tight">Steward</span>',
  },
  {
    // Usage analytics would otherwise report to T3's PostHog project.
    file: "apps/server/src/telemetry/AnalyticsService.ts",
    from: "const enabledAtStartup = Option.getOrElse(telemetryConfig.enabled, () => enabledByDefault);",
    to: "const enabledAtStartup = false;",
  },
];

const BRAND_DIR = "packages/bot/brand";
const brandCopies = (source: string, targets: ReadonlyArray<string>): ReadonlyArray<RebrandCopy> =>
  targets.map((to) => ({ from: `${BRAND_DIR}/${source}`, to }));

// Paths from scripts/lib/brand-assets.ts that Windows and web release builds read.
export const BOT_REBRAND_COPIES: ReadonlyArray<RebrandCopy> = [
  ...brandCopies("steward-windows.ico", [
    "assets/prod/t3-black-windows.ico",
    "assets/nightly/nightly-windows.ico",
  ]),
  ...brandCopies("steward-1024.png", [
    "assets/prod/black-macos-1024.png",
    "assets/prod/black-universal-1024.png",
    "assets/nightly/nightly-macos-1024.png",
    "assets/nightly/nightly-universal-1024.png",
  ]),
  ...brandCopies("steward-web-favicon.ico", [
    "assets/prod/t3-black-web-favicon.ico",
    "assets/nightly/nightly-web-favicon.ico",
  ]),
  ...brandCopies("steward-web-favicon-16x16.png", [
    "assets/prod/t3-black-web-favicon-16x16.png",
    "assets/nightly/nightly-web-favicon-16x16.png",
  ]),
  ...brandCopies("steward-web-favicon-32x32.png", [
    "assets/prod/t3-black-web-favicon-32x32.png",
    "assets/nightly/nightly-web-favicon-32x32.png",
  ]),
  ...brandCopies("steward-web-apple-touch-180.png", [
    "assets/prod/t3-black-web-apple-touch-180.png",
    "assets/nightly/nightly-web-apple-touch-180.png",
  ]),
  ...brandCopies("steward-web-icon-192x192.png", [
    "assets/prod/t3-black-web-icon-192x192.png",
    "assets/nightly/nightly-web-icon-192x192.png",
  ]),
  ...brandCopies("steward-web-icon-512x512.png", [
    "assets/prod/t3-black-web-icon-512x512.png",
    "assets/nightly/nightly-web-icon-512x512.png",
  ]),
  ...brandCopies("steward.svg", ["assets/prod/logo.svg"]),
  // Same export, drawing the Steward "S" in place of the T3 wordmark.
  ...brandCopies("T3Wordmark.tsx.txt", ["apps/web/src/components/T3Wordmark.tsx"]),
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

export function applyRebrand(
  rootDir: string,
  edits: ReadonlyArray<RebrandEdit>,
  copies: ReadonlyArray<RebrandCopy>,
): void {
  const patched = new Map<string, string>();
  for (const edit of edits) {
    const filePath = NodePath.join(rootDir, edit.file);
    const source = patched.get(filePath) ?? NodeFS.readFileSync(filePath, "utf8");
    patched.set(filePath, applyRebrandEdit(source, edit));
  }
  for (const copy of copies) {
    // A missing target means upstream moved its brand assets; overwriting nothing would ship T3's.
    if (!NodeFS.existsSync(NodePath.join(rootDir, copy.to))) {
      throw new Error(`bot-rebrand: brand asset target ${copy.to} no longer exists`);
    }
  }
  for (const [filePath, source] of patched) {
    NodeFS.writeFileSync(filePath, source);
  }
  for (const copy of copies) {
    NodeFS.copyFileSync(NodePath.join(rootDir, copy.from), NodePath.join(rootDir, copy.to));
  }
}

if (import.meta.main) {
  const rootDir = NodePath.resolve(import.meta.dirname, "..");
  applyRebrand(rootDir, BOT_REBRAND_EDITS, BOT_REBRAND_COPIES);
  console.log(
    `bot-rebrand: applied ${BOT_REBRAND_EDITS.length} edits and ${BOT_REBRAND_COPIES.length} brand assets`,
  );
}
