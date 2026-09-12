#!/bin/sh
# Container start-up: bring the schema up to date, then serve.
#
# Migrations run here rather than in a separate release step because the free
# and starter Render plans have no pre-deploy hook. Alembic takes a lock on
# its version table, so a rolling deploy with several instances is safe: the
# first to arrive migrates and the rest find nothing to do. Set
# RUN_MIGRATIONS=false to skip it (e.g. a worker process that must not
# migrate).
set -e

if [ "${RUN_MIGRATIONS:-true}" = "true" ]; then
    echo "entrypoint: alembic upgrade head"
    alembic upgrade head
fi

# Render (and most PaaS) assign the port at runtime; 8000 is the compose default.
: "${PORT:=8000}"
# One worker per ~256MB. Four on a 512MB instance gets the process OOM-killed
# mid-request, which surfaces as a 502 with nothing in the application log.
: "${WEB_CONCURRENCY:=2}"

echo "entrypoint: gunicorn on 0.0.0.0:${PORT} with ${WEB_CONCURRENCY} worker(s)"
exec gunicorn app.main:app \
    --worker-class uvicorn.workers.UvicornWorker \
    --workers "${WEB_CONCURRENCY}" \
    --bind "0.0.0.0:${PORT}" \
    --timeout 120 \
    --graceful-timeout 30 \
    --access-logfile - \
    --error-logfile - \
    --forwarded-allow-ips '*'
