# T3 Code Bot: Upstream Sync, Conflict Isolation & Automated Stable Release

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

## 2. Automated Upstream Stable Sync & Strict Release Gate

Three dedicated workflows (none touch upstream `.github/workflows/release.yml` or `ci.yml`):

1. `.github/workflows/bot-upstream-sync.yml`
   - Polls `pingdotgg/t3code` every 30 minutes for new published **stable** releases (`vX.Y.Z` via `/releases/latest`, ignoring drafts, nightlies, and previews).
   - Merges the new upstream tag into `sync/upstream-<tag>` and automatically regenerates `pnpm-lock.yaml` / `apps/web/src/routeTree.gen.ts` if only generated files conflict.
   - Runs `.github/workflows/bot-verify.yml` (footprint guard, `i18n:check`, `knip:check`, `vp check`, workspace `typecheck`, `@t3tools/bot` tests, sharded web/server/desktop tests, production web boot check, and full-stack Playwright E2E scenarios including `scripts/scenarios/bot-integration.e2e.ts` and `scripts/scenarios/replay-turn-streams.e2e.ts`).
   - Only when **every check passes** does it fast-forward `main`, cut a stable SemVer tag via `scripts/bot-release-version.ts` (`v<major>.<minor>.<upstreamPatch * 100 + seq>`), and invoke `.github/workflows/bot-release.yml`.
   - If manual merge conflicts occur, it opens a tracking issue; if verification/E2E fails, it opens a Draft PR and leaves `main` untouched.

2. `.github/workflows/bot-release.yml`
   - Reuses upstream `.github/workflows/release-desktop.yml` on standard GitHub-hosted runners (`macos-15`, `ubuntu-24.04`, `ubuntu-24.04-arm`, `windows-2025`, `windows-11-arm`) to build all 6 desktop installers (macOS arm64/x64 DMG+ZIP, Linux x64/arm64 AppImage+deb, Windows x64/arm64 NSIS) and all 5 CLI archives + `SHA256SUMS`.
   - Desktop auto-updates automatically target this fork repository via `GITHUB_REPOSITORY` (`T3CODE_DESKTOP_UPDATE_REPOSITORY`), merge multi-arch manifests (`latest-mac.yml`, `latest-linux.yml`, `latest-linux-arm64.yml`, `latest.yml`), and publish the GitHub Release as `Latest` (`prerelease: false`, `make_latest: true`).
   - CLI/SSH server downloads point to `RengarLee/t3codebot` via `packages/shared/src/cliRelease.ts`.
   - Manual `channel: nightly` dispatches remain supported if you ever want to test a prerelease build (`nightly*.yml` + `update-feed/nightly.json`).

## 3. Versioning & Release Workflow

- **Outer release tag / installer version (Stable)**: Uses segmented 3-part SemVer `v<major>.<minor>.<upstreamPatch * 100 + seq>` (`seq ∈ [0, 99]`), never custom prerelease suffixes like `-bot.1` (which would break desktop `latest` auto-updates where `allowPrerelease: false`), and never manually edits `apps/desktop/package.json`:
  - Upstream `v0.1.11` -> `v0.1.1100` (first release), `v0.1.1101`, `v0.1.1102`, ... (mid-cycle Bot updates)
  - Upstream `v0.1.12` -> `v0.1.1200`, `v0.1.1201`, ...
  - Upstream `v0.2.0` -> `v0.2.0`, `v0.2.1`, ...; upstream `v0.2.1` -> `v0.2.100`, `v0.2.101`, ...
- **Automatic monotonic sequence (`<seq>`)**: Both `bot-upstream-sync.yml` and `bot-release.yml` resolve the next version through `scripts/bot-release-version.ts` by reading the current upstream stable base (`max(lastSyncedTag, apps/desktop/package.json)`) and taking `max(existing repo tags in that upstream patch slot) + 1` (or `upstreamPatch * 100` if none exist yet).
- **Inner bot version (`packages/bot/package.json`)**: Maintained independently (`0.1.0`, `0.1.1`, `0.2.0`, ...). Only bump it when Bot functionality changes; pure upstream syncs keep it unchanged.
- **Release title convention**:
  - Upstream sync: `T3 Code Bot v<version> (sync: <upstreamTag> · bot <botVersion>)`
  - Bot update: `T3 Code Bot v<version> (bot <botVersion> · base <upstreamTag>)`
- **How to publish a Bot update**:
  1. Bump `version` in `packages/bot/package.json` and merge your changes to `main`.
  2. Open GitHub Actions → **Bot Release** → **Run workflow** on `main` (`channel: stable`, leave `version` empty).
  3. The workflow runs `bot-verify.yml`, auto-assigns the next stable tag in the current upstream slot (e.g. `v0.1.1201`), builds all desktop + CLI artifacts, and publishes the GitHub Release as `Latest` so desktop/CLI auto-updaters pick it up.

## 4. Optional Repository Configuration

Everything works out of the box with standard `GITHUB_TOKEN` (unsigned builds). Optional secrets/variables unlock full production signing and branch-protection pushes:

- `BOT_SYNC_TOKEN` (optional PAT / GitHub App token): only needed if `main` has branch protection rules that block `GITHUB_TOKEN` from pushing verified sync commits/tags.
- Apple signing & notarization (optional): secrets `CSC_LINK`, `CSC_KEY_PASSWORD`, `APPLE_API_KEY`, `APPLE_API_KEY_ID`, `APPLE_API_ISSUER`, `MACOS_PROVISIONING_PROFILE`, variable `APPLE_TEAM_ID`.
- Windows Azure Trusted Signing (optional): secrets `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`, `AZURE_TRUSTED_SIGNING_ENDPOINT`, `AZURE_TRUSTED_SIGNING_ACCOUNT_NAME`, `AZURE_TRUSTED_SIGNING_CERTIFICATE_PROFILE_NAME`, `AZURE_TRUSTED_SIGNING_PUBLISHER_NAME`.
