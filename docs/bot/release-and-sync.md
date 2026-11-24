# T3 Code Bot: Upstream Sync, Conflict Isolation & Automated Nightly Release (Windows)

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

## 2. Automated Daily Upstream Nightly Sync & Windows Release Pipeline

Four dedicated bot-owned workflows (none touch upstream `.github/workflows/release.yml`, `release-desktop.yml`, or `ci.yml`):

1. `.github/workflows/bot-upstream-sync.yml`
   - Polls `pingdotgg/t3code` once daily (`00:17 UTC` / `08:17 UTC+8`) for the latest published **nightly** release (`vX.Y.Z-nightly.YYYYMMDD.N`, ignoring drafts and previews).
   - Merges the new upstream tag into `sync/upstream-<tag>` and automatically regenerates `pnpm-lock.yaml` / `apps/web/src/routeTree.gen.ts` if only generated files conflict.
   - Runs `.github/workflows/bot-verify.yml` (footprint guard, `i18n:check`, `knip:check`, `vp check`, workspace `typecheck`, `@t3tools/bot` tests, sharded web/server/desktop tests, production web boot check, and full-stack Playwright E2E scenarios including `scripts/scenarios/bot-integration.e2e.ts` and `scripts/scenarios/replay-turn-streams.e2e.ts`).
   - Only when **every check passes** does it fast-forward `main`, cut a daily nightly tag via `scripts/bot-release-version.ts` (`v<X.Y.Z>-nightly.<YYYYMMDD>.<seq>`), and invoke `.github/workflows/bot-release.yml`.
   - If manual merge conflicts occur, it records the details in the job summary (and opens a tracking issue when Issues are enabled); if verification/E2E fails, it opens a Draft PR and leaves `main` untouched.

2. `.github/workflows/bot-release.yml` + `.github/workflows/bot-release-win.yml`
   - **Windows-only**: builds and verifies Windows x64 and Windows arm64 desktop installers (NSIS `.exe` + `.blockmap`) and Windows CLI archives (`t3-*.zip` + `SHA256SUMS`), without macOS or Linux release jobs.
   - Desktop auto-updates target this fork repository via `GITHUB_REPOSITORY` (`T3CODE_DESKTOP_UPDATE_REPOSITORY`), merge Windows x64/arm64 updater manifests into `nightly.yml` (or `latest.yml` for manual stable runs) via `scripts/merge-update-manifests.ts --platform win`, and maintain the `update-feed/nightly.json` pointer release so nightly desktop installs discover updates automatically.
   - CLI downloads point to `RengarLee/t3codebot` via `packages/shared/src/cliRelease.ts`.
   - Manual `channel: stable` dispatches remain supported if you ever want to cut a stable release (`v<major>.<minor>.<upstreamPatch * 100 + seq>` + `latest.yml`).

## 3. Versioning & Release Workflow

- **Outer release tag / installer version (Nightly default)**: Uses `v<nextBase>-nightly.<YYYYMMDD>.<seq>` (`seq` monotonically incremented per UTC day across both upstream syncs and Bot updates):
  - Example: upstream desktop base `0.1.11` -> `v0.1.12-nightly.20261124.1`, `v0.1.12-nightly.20261124.2`, ...
- **Inner bot version (`packages/bot/package.json`)**: Maintained independently (`0.1.0`, `0.1.1`, `0.2.0`, ...). Only bump it when Bot functionality changes; pure upstream syncs keep it unchanged.
- **Release title convention**:
  - Upstream sync: `T3 Code Bot Nightly <version> (sync: <upstreamTag> · bot <botVersion>)`
  - Bot update: `T3 Code Bot Nightly <version> (bot <botVersion> · base <upstreamTag>)`
- **How to publish a Bot update manually**:
  1. Merge work-in-progress Bot PRs into `dev`, and open a PR from `dev` to `main` when ready to ship (all PRs targeting `main` or `dev` run `bot-verify.yml`).
  2. Bump `version` in `packages/bot/package.json` and merge your changes to `main`.
  3. Open GitHub Actions → **Bot Release** → **Run workflow** on `main` (`channel: nightly`, leave `version` empty).
  4. The workflow runs `bot-verify.yml`, auto-assigns the next daily nightly tag, builds and verifies the Windows desktop + CLI artifacts, and publishes the GitHub Release + `update-feed/nightly.json`.

## 4. Optional Repository Configuration

Everything works out of the box with standard `GITHUB_TOKEN` (unsigned builds). Optional secrets unlock signing and branch-protection pushes:

- `BOT_SYNC_TOKEN` (optional PAT / GitHub App token): only needed if `main` has branch protection rules that block `GITHUB_TOKEN` from pushing verified sync commits/tags.
- Windows Azure Trusted Signing (optional): secrets `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`, `AZURE_TRUSTED_SIGNING_ENDPOINT`, `AZURE_TRUSTED_SIGNING_ACCOUNT_NAME`, `AZURE_TRUSTED_SIGNING_CERTIFICATE_PROFILE_NAME`, `AZURE_TRUSTED_SIGNING_PUBLISHER_NAME`.
