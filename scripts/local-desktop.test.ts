import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import * as HostProcess from "@t3tools/shared/HostProcess";
import { deploymentScript, localTestHome } from "./local-desktop.ts";

it.layer(NodeServices.layer)("local desktop deployment", (it) => {
  it.effect("keeps each checkout's test home outside the repository and production data", () =>
    Effect.gen(function* () {
      const path = yield* Path.Path;
      const fs = yield* FileSystem.FileSystem;
      const fixture = yield* fs.makeTempDirectoryScoped({ prefix: "t3-local-home-" });
      const userHome = path.join(fixture, "user");
      const root = path.join(userHome, "repos", "app");
      const home = yield* localTestHome(root).pipe(
        Effect.provideService(HostProcess.HomeDirectory, userHome),
      );
      assert.isFalse(home.startsWith(root + path.sep));
      assert.notEqual(home, path.join(userHome, ".t3"));
      const other = yield* localTestHome(path.join(userHome, "worktrees", "app")).pipe(
        Effect.provideService(HostProcess.HomeDirectory, userHome),
      );
      assert.notEqual(home, other);
      assert.equal(
        home,
        yield* localTestHome(path.join(root, ".")).pipe(
          Effect.provideService(HostProcess.HomeDirectory, userHome),
        ),
      );
    }),
  );

  it.effect.each([true, false])("preserves data and handles launch success=%s", (launchSucceeds) =>
    Effect.gen(function* () {
      if ((yield* HostProcess.Platform) !== "win32") return;
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "t3-local-test-'quoted-" });
      const installDir = path.join(root, "installed");
      const payloadDir = path.join(root, "payload");
      const stateDir = path.join(root, "userdata");
      const backupDir = path.join(root, "backup");
      for (const dir of [installDir, payloadDir, stateDir]) yield* fs.makeDirectory(dir);
      yield* fs.writeFileString(path.join(installDir, "version"), "old");
      yield* fs.writeFileString(path.join(payloadDir, "version"), "new");
      yield* fs.writeFileString(path.join(stateDir, "statev2.sqlite"), "original-data");
      const executable = "test.exe";
      if (launchSucceeds) {
        yield* fs.copyFile("C:\\Windows\\System32\\whoami.exe", path.join(payloadDir, executable));
      }
      const script = path.join(root, "deploy.ps1");
      yield* fs.writeFileString(
        script,
        deploymentScript({ installDir, payloadDir, stateDir, backupDir, executable }) +
          "\nif ($launched) { $launched.WaitForExit() }\n",
      );
      const child = yield* spawner.spawn(
        ChildProcess.make("powershell.exe", [
          "-NoProfile",
          "-ExecutionPolicy",
          "Bypass",
          "-File",
          script,
        ]),
      );
      const code = Number(yield* child.exitCode);
      assert.equal(code === 0, launchSucceeds);
      assert.equal(
        yield* fs.readFileString(path.join(installDir, "version")),
        launchSucceeds ? "new" : "old",
      );
      assert.equal(
        yield* fs.readFileString(path.join(stateDir, "statev2.sqlite")),
        "original-data",
      );
      assert.equal(
        yield* fs.readFileString(path.join(backupDir, "userdata", "statev2.sqlite")),
        "original-data",
      );
    }),
  );
});
