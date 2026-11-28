# Local desktop iteration on Windows

Run commands from the repository root after installing dependencies.

Use `vp run local:test` to start the development desktop with isolated data in
`~/.t3/local-test/<checkout-name>-<path-hash>/userdata`. Each checkout keeps its own
state outside the repository so threads without a project remain available.
`local:desktop` is an alias. Earlier `.t3/local-test` data stays in place; the new
location starts fresh.

Frontend changes update in place. Server changes rebuild automatically and restart
the development desktop, as desktop-shell changes already do. Wait for active turns
to finish before editing server code: a restart interrupts them.

Use `vp run local:publish` from an external terminal to build and replace the installed
Windows application. This uses the full desktop packaging pipeline, including its
Python, Rust, and Visual Studio prerequisites. It does not wait for GitHub CI.
See [Windows installer prerequisites](00_development.md#windows-installer-prerequisites).

If the bundle self-check reports an ancestor `node_modules`, use a temporary directory
outside that tree. In PowerShell, set both `$env:TEMP` and `$env:TMP` to an existing
directory whose parents contain no `node_modules`, then rerun `local:publish` in that
terminal. Keep the self-check enabled: it verifies the app includes its dependencies.

The default installation is `%LOCALAPPDATA%/Programs/t3code`. Override it with
`--install-dir <directory>`. Pass `--wsl-runtime <archive>` when packaging WSL support.

The build finishes before the running application is asked to close. If the app stays
in the tray or a database is still open, quit the app and rerun the command. The
publisher does not forcibly terminate processes. Run this from an external terminal:
updating the app hosting an agent can disconnect that agent.

The publisher copies `~/.t3/userdata` into `~/.t3/local-releases/<timestamp>/userdata`,
retains the previous installation in that backup's `application` directory, then starts
the new app against the original production data. Existing shortcuts and uninstallers
are preserved. This is real production use: changes affect your existing conversations,
projects, settings, and credentials.

If starting the executable fails, the previous application directory is restored.
A later application crash or database migration failure requires manual recovery:
quit all instances, preserve the current installation and data, then restore both
`application` and `userdata` from the same backup. Restoring data loses changes made
since that backup. Backups are retained until you remove them yourself.
