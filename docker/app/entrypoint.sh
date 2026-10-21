#!/bin/sh
# App container start: apply migrations, then run the server (or whatever command was given).
set -e
if [ "${SKIP_MIGRATE:-0}" != "1" ]; then
  echo "[app] applying migrations"
  npx prisma migrate deploy
fi
exec "$@"
