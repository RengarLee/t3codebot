#!/usr/bin/env node
import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Config from "effect/Config";
import * as DateTime from "effect/DateTime";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { Command, Flag } from "effect/cli";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import * as HostProcess from "@t3tools/shared/HostProcess";

export class LocalDesktopError extends Schema.TaggedError<LocalDesktopError>()(
  "LocalDesktopError",
  {
    message: Schema.String,
  },
) {}

const run = Effect.fn("localDesktop.run")(function* (command: string, args: string[]) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const child = yield* spawner.spawn(
    ChildProcess.make(command, args, {
      stdout: "inherit",
      stderr: "inherit",
      stdin: "inherit",
    }),
  );
  const code = Number(yield* child.exitCode);
  if (code !== 0)
    return yield* new LocalDesktopError({ message: `${command} exited with ${code}.` });
});

const quotePowerShell = (value: string) => `'${value.replaceAll("'", "''")}'`;

// Use exact executable paths: this machine may host unrelated T3 servers and agent processes.
export function deploymentScript(input: {
  installDir: string;
  payloadDir: string;
  stateDir: string;
  backupDir: string;
  executable: string;
}) {
  return `$ErrorActionPreference = 'Stop'
$install = ${quotePowerShell(input.installDir)}
$payload = ${quotePowerShell(input.payloadDir)}
$state = ${quotePowerShell(input.stateDir)}
$backup = ${quotePowerShell(input.backupDir)}
$exe = ${quotePowerShell(input.executable)}
$previous = Join-Path $backup 'application'
$mutex = [Threading.Mutex]::new($false, 'Local\\T3CodeLocalPublish')
if (!$mutex.WaitOne(0)) { $mutex.Dispose(); throw 'Another local publish is running.' }
try {
if (Test-Path -LiteralPath $backup) { throw 'Backup destination already exists.' }
$prefix = $install.TrimEnd('\\') + '\\'
$running = @(Get-Process | Where-Object { $_.Path -and $_.Path.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase) })
foreach ($app in $running) { [void]$app.CloseMainWindow() }
foreach ($app in $running) {
  if (!$app.WaitForExit(15000)) { throw 'Application is still running. Quit it from the tray, then rerun local:publish.' }
}
$remaining = @(Get-Process | Where-Object { $_.Path -and $_.Path.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase) })
if ($remaining.Count) { throw 'Application processes are still running; update cancelled.' }
New-Item -ItemType Directory -Path $backup | Out-Null
if (Test-Path -LiteralPath $state) {
  foreach ($db in Get-ChildItem -LiteralPath $state -Filter '*.sqlite' -Recurse) {
    $handle = [IO.File]::Open($db.FullName, 'Open', 'Read', 'None')
    $handle.Dispose()
  }
  Copy-Item -LiteralPath $state -Destination (Join-Path $backup 'userdata') -Recurse
}
Copy-Item -LiteralPath $payload -Destination (Join-Path $backup 'new-application') -Recurse
foreach ($uninstaller in Get-ChildItem -LiteralPath $install -Filter 'Uninstall *' -File) {
  Copy-Item -LiteralPath $uninstaller.FullName -Destination (Join-Path $backup 'new-application')
}
Move-Item -LiteralPath $install -Destination $previous
try {
  Move-Item -LiteralPath (Join-Path $backup 'new-application') -Destination $install
  $env:T3CODE_HOME = Split-Path -Parent $state
  Remove-Item Env:T3CODE_DESKTOP_DEV -ErrorAction SilentlyContinue
  Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
  $launched = Start-Process -FilePath (Join-Path $install $exe) -WindowStyle Hidden -PassThru
} catch {
  if (Test-Path -LiteralPath $install) {
    Move-Item -LiteralPath $install -Destination (Join-Path $backup 'failed-application')
  }
  Move-Item -LiteralPath $previous -Destination $install
  throw
}
Write-Output "Updated application. Backup: $backup"
} finally {
  $mutex.ReleaseMutex()
  $mutex.Dispose()
}
`;
}

const testCommand = Command.make("test", {}, () =>
  Effect.gen(function* () {
    const path = yield* Path.Path;
    const root = yield* path.fromFileUrl(new URL("../", import.meta.url));
    yield* run("node", [
      "scripts/dev-runner.ts",
      "dev:desktop",
      "--home-dir",
      path.join(root, ".t3", "local-test"),
    ]);
  }),
);

const publishCommand = Command.make(
  "publish",
  {
    installDir: Flag.String("install-dir").pipe(Flag.withDefault("")),
    wslRuntime: Flag.String("wsl-runtime").pipe(Flag.withDefault("")),
  },
  ({ installDir, wslRuntime }) =>
    Effect.gen(function* () {
      if ((yield* HostProcess.Platform) !== "win32") {
        return yield* new LocalDesktopError({
          message: "Local publishing currently supports Windows only.",
        });
      }
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const localAppData = yield* Config.String("LOCALAPPDATA");
      const userHome = yield* HostProcess.HomeDirectory;
      const install = path.resolve(installDir || path.join(localAppData, "Programs", "t3code"));
      const entries = yield* fs.readDirectory(install);
      const executable = [
        "Steward (Nightly).exe",
        "T3 Code (Nightly).exe",
        "Steward.exe",
        "T3 Code (Beta).exe",
      ].find((name) => entries.includes(name));
      if (!executable || !(yield* fs.exists(path.join(install, "resources", "app.asar")))) {
        return yield* new LocalDesktopError({
          message: `No supported installed desktop app at ${install}.`,
        });
      }
      const stamp = DateTime.formatIso(yield* DateTime.now).replaceAll(/[:.]/g, "-");
      const backupDir = path.join(userHome, ".t3", "local-releases", stamp);
      const output = yield* fs.makeTempDirectoryScoped({ prefix: "t3-local-build-" });
      yield* Console.log(
        "Building the complete Windows application. The installed app stays running until the build succeeds.",
      );
      yield* run("node", [
        "scripts/build-desktop-artifact.ts",
        "--platform",
        "win",
        "--target",
        "dir",
        "--output-dir",
        output,
        ...(wslRuntime ? ["--wsl-runtime", path.resolve(wslRuntime)] : []),
      ]);
      const payload = path.join(
        output,
        (yield* HostProcess.Architecture) === "arm64" ? "win-arm64-unpacked" : "win-unpacked",
      );
      const builtEntries = yield* fs.readDirectory(payload);
      const builtExe = builtEntries.find(
        (name) => name.endsWith(".exe") && !name.startsWith("Uninstall"),
      );
      if (!builtExe || !(yield* fs.exists(path.join(payload, "resources", "app.asar")))) {
        return yield* new LocalDesktopError({
          message: "Build output is missing its executable or app.asar.",
        });
      }
      if (builtExe !== executable)
        yield* fs.rename(path.join(payload, builtExe), path.join(payload, executable));
      for (const alias of [
        "Steward (Nightly).exe",
        "T3 Code (Nightly).exe",
        "Steward.exe",
        "T3 Code (Beta).exe",
      ]) {
        if (alias !== executable && entries.includes(alias)) {
          yield* fs.copyFile(path.join(payload, executable), path.join(payload, alias));
        }
      }
      const script = path.join(output, "deploy.ps1");
      yield* fs.writeFileString(
        script,
        deploymentScript({
          installDir: install,
          payloadDir: payload,
          stateDir: path.join(userHome, ".t3", "userdata"),
          backupDir,
          executable,
        }),
      );
      yield* Console.log(
        `Backup destination: ${backupDir}. Closing the installed app before replacement.`,
      );
      yield* run("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script]);
    }),
);

const command = Command.make("local-desktop").pipe(
  Command.withSubcommands([testCommand, publishCommand]),
);
if (import.meta.main) {
  Command.run(command, { version: "0.0.0" }).pipe(
    Effect.scoped,
    Effect.provide(NodeServices.layer),
    NodeRuntime.runMain,
  );
}
