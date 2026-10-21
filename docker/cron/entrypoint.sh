#!/bin/sh
# Cron container: runs the job schedule with supercronic (container-native cron, env inherited, stdout logs).
set -e
echo "[cron] schedule:"
cat /app/docker/cron/crontab
exec supercronic -passthrough-logs /app/docker/cron/crontab
