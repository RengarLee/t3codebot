# T3 Code Bot: Upstream Sync, Conflict Isolation & Automated Nightly Release

## 1. Conflict-Isolation Architecture

All bot functionality lives inside the isolated workspace package `packages/bot/` (`@t3tools/bot`):

- **Contracts & preferences schema**: `packages/bot/src/contracts.ts`
- **Server HTTP routes & isolated storage**: `packages/bot/src/server/http.ts`, `packages/bot/src/server/storage.ts`
  - Mounted with a single line in `apps/server/src/server.ts` under `/api/bots/*`.
  - Bot persistence stays in `<stateDir>/bots/bots.sqlite` / `bots-config.json` and **never** touches upstream `statev2.sqlite` migrations.
- **Web i18n & client preferences**: `packages/bot/src/web/i18n.ts`, `packages/bot/src/web/preferences.ts`, `packages/bot/src/web/settingsMeta.ts`
  - Zero edits to upstream's 10 `apps/web/src/i18n/translations/*.json` files.
  - Zero edits to upstream `packages/contracts/src/settings.ts`.
- **Conflict guard**: `node scripts/bot-check-footprint.ts` enforces that only whitelisted thin-glue upstream files may be modified, within strict per-file line budgets, and bans high-conflict upstream hotspots.

## 2. Automated Upstream Nightly Sync & Strict Release Gate

Three dedicated workflows (none touch upstream `.github/workflows/release.yml` or `ci.yml`):

1. `.github/workflows/bot-upstream-sync.yml`
   - Polls `pingdotgg/t3code` every 30 minutes for new published `nightly` releases (`v*-nightly.YYYYMMDD.N`).
   - Merges the new upstream tag into `sync/upstream-<tag>` and automatically regenerates `pnpm-lock.yaml` / `apps/web/src/routeTree.gen.ts` if only generated files conflict.
   - Runs `.github/workflows/bot-verify.yml` (footprint guard, `i18n:check`, `knip:check`, `vp check`, workspace `typecheck`, `@t3tools/bot` tests, sharded web/server/desktop tests, production web boot check, and full-stack Playwright E2E scenarios including `scripts/scenarios/bot-integration.e2e.ts` and `scripts/scenarios/replay-turn-streams.e2e.ts`).
   - Only when **every check passes** does it fast-forward `main`, cut a native nightly tag via `scripts/bot-release-version.ts` (`v<baseVersion>-nightly.<YYYYMMDD>.<dailySeq>`), and invoke `.github/workflows/bot-release.yml`.
   - If manual merge conflicts occur, it opens a tracking issue; if verification/E2E fails, it opens a Draft PR and leaves `main` untouched.

2. `.github/workflows/bot-release.yml`
   - Reuses upstream `.github/workflows/release-desktop.yml` on standard GitHub-hosted runners (`macos-15`, `ubuntu-24.04`, `ubuntu-24.04-arm`, `windows-2025`, `windows-11-arm`) to build all 6 desktop installers (macOS arm64/x64 DMG+ZIP, Linux x64/arm64 AppImage+deb, Windows x64/arm64 NSIS) and all 5 CLI archives + `SHA256SUMS`.
   - Desktop auto-updates automatically target this fork repository via `GITHUB_REPOSITORY` (`T3CODE_DESKTOP_UPDATE_REPOSITORY`), merge multi-arch manifests (`nightly-mac.yml`, `nightly-linux.yml`, `nightly-linux-arm64.yml`, `nightly.yml`), and maintain the `update-feed` release (`nightly.json`).
   - CLI/SSH server downloads point to `RengarLee/t3codebot` via `packages/shared/src/cliRelease.ts`.

## 3. Versioning & Release Workflow

- **Outer release tag / installer version**: Always follows T3's strict nightly SemVer format `v<upstreamPatch+1>-nightly.<YYYYMMDD>.<N>` (never add custom suffixes like `-bot.1`, which would break `cliReleaseChannelOf` and desktop auto-updates, and never manually bump `apps/desktop/package.json`).
- **Unified daily monotonic sequence (`<N>`)**: Both `bot-upstream-sync.yml` and `bot-release.yml` resolve `<N>` through `scripts/bot-release-version.ts` by taking `max(existing repo tags for the same baseVersion and UTC date) + 1`, preventing version regressions or tag collisions when upstream syncs and bot releases happen on the same day.
- **Inner bot version (`packages/bot/package.json`)**: Maintained independently (`0.1.0`, `0.1.1`, `0.2.0`, ...). Only bump it when Bot functionality changes; pure upstream syncs keep it unchanged.
- **Release title convention**:
  - Upstream sync: `T3 Code Bot Nightly <version> (sync: <upstreamTag> · bot <botVersion>)`
  - Bot update: `T3 Code Bot Nightly <version> (bot <botVersion> · base <upstreamTag>)`
- **How to publish a Bot update**:
  1. Bump `version` in `packages/bot/package.json` and merge your changes to `main`.
  2. Open GitHub Actions → **Bot Release** → **Run workflow** on `main` (`channel: nightly`, leave `version` empty).
  3. The workflow runs `bot-verify.yml`, auto-assigns the next daily tag, builds all desktop + CLI artifacts, publishes the GitHub Release, and updates `update-feed/nightly.json`.

## 4. Optional Repository Configuration

Everything works out of the box with standard `GITHUB_TOKEN` (unsigned builds). Optional secrets/variables unlock full production signing and branch-protection pushes:

- `BOT_SYNC_TOKEN` (optional PAT / GitHub App token): only needed if `main` has branch protection rules that block `GITHUB_TOKEN` from pushing verified sync commits/tags.
- Apple signing & notarization (optional): secrets `CSC_LINK`, `CSC_KEY_PASSWORD`, `APPLE_API_KEY`, `APPLE_API_KEY_ID`, `APPLE_API_ISSUER`, `MACOS_PROVISIONING_PROFILE`, variable `APPLE_TEAM_ID`.
- Windows Azure Trusted Signing (optional): secrets `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`, `AZURE_TRUSTED_SIGNING_ENDPOINT`, `AZURE_TRUSTED_SIGNING_ACCOUNT_NAME`, `AZURE_TRUSTED_SIGNING_CERTIFICATE_PROFILE_NAME`, `AZURE_TRUSTED_SIGNING_PUBLISHER_NAME`.
