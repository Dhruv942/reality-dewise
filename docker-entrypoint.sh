#!/bin/sh
set -e
# Apply pending migrations first (set RUN_MIGRATIONS=false to skip, e.g. when a release step does it).
if [ "${RUN_MIGRATIONS:-true}" = "true" ]; then
  node node_modules/node-pg-migrate/bin/node-pg-migrate.js -m migrations --migration-file-language sql up
fi
# exec: node becomes PID 1 and receives SIGTERM directly, so the graceful shutdown in server.ts runs.
exec node dist/src/server.js
