#!/bin/sh
# Runs the job schedule with the container's environment available to each job.
set -e
printenv | grep -v -E '^(HOME|PATH|PWD|SHLVL|_)=' | sed 's/^\(.*\)$/export \1/' > /app/.job-env
sed 's#cd /app \&\&#. /app/.job-env \&\& cd /app \&\&#' /app/docker/cron/crontab > /etc/crontabs/root
echo "[cron] schedule:" && cat /etc/crontabs/root
exec crond -f -l 2
