# Pairing and sign-in

A browser authenticates to a T3 Code server with a one-time pairing URL and then stays signed in.

## Sub-features

- `pair-startup` signs in with the `pairingUrl:` the dev server prints.
- `pair-mint` issues a fresh URL when the first was used or expired.

## How to get to it (user POV)

- Open the pairing URL printed at server start.
- Run `t3 pair` against the server's home to get another.

## Driving it with the t3 CLI and the Browser panel

Preconditions: baseline from [README.md](README.md); the pairing URL is unused.

- **Sign in.** `preview_open` the `pairingUrl` from `dev.log`. The tab ends on `http://localhost:<webPort>/<environment-id>/...`, not on `/pair`, and network entries show `/api/auth/session` returning 200.
- **Mint.** If the token was consumed, `node apps/server/src/bin.ts pair --base-dir "$H"` prints a new `Pairing URL:`.

## Gotchas

- The token is single-use and an admin credential. Never paste it into evidence files; redact `dev.log` copies.
- The first paint shows a splash screen; wait for the sidebar before asserting.
