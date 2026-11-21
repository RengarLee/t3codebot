#!/usr/bin/env node
// Read-only summary of what the isolated server persisted: runs and checkpoints per thread.
// Usage: node .agents/skills/verify-t3code/scripts/db-summary.mjs <home-dir>
import * as NodePath from "node:path";
import * as NodeSqlite from "node:sqlite";

const home = process.argv[2];
if (!home) {
  console.error("usage: db-summary.mjs <home-dir>");
  process.exit(2);
}

const db = new NodeSqlite.DatabaseSync(NodePath.join(home, "userdata", "statev2.sqlite"), {
  readOnly: true,
});
const rows = db
  .prepare(
    `select r.thread_id, r.ordinal, r.provider_instance_id as provider, r.status, r.completed_at,
            (select count(*) from orchestration_v2_projection_checkpoints c
              where c.thread_id = r.thread_id and c.status = 'ready') as ready_checkpoints
       from orchestration_v2_projection_runs r
      order by r.requested_at`,
  )
  .all();
console.table(rows);
process.exit(rows.length ? 0 : 1);
