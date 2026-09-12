# ---- builder ----
FROM python:3.12-slim AS builder
ENV PIP_NO_CACHE_DIR=1 PIP_DISABLE_PIP_VERSION_CHECK=1
WORKDIR /build
RUN apt-get update && apt-get install -y --no-install-recommends build-essential \
    && rm -rf /var/lib/apt/lists/*
COPY pyproject.toml ./
RUN python -m venv /opt/venv \
    && /opt/venv/bin/pip install --upgrade pip \
    && /opt/venv/bin/pip install .

# ---- runtime ----
FROM python:3.12-slim AS runtime
ENV PATH="/opt/venv/bin:$PATH" \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1
# -m creates the home directory: gunicorn's control server writes there, and
# without it every boot logs "Permission denied: '/home/app'".
RUN groupadd -r app && useradd -r -g app -m -d /home/app app
ENV HOME=/home/app
WORKDIR /app
COPY --from=builder /opt/venv /opt/venv
COPY --chown=app:app . .
USER app
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
    CMD python -c "import httpx,os,sys; sys.exit(0 if httpx.get('http://localhost:%s/api/v1/health' % os.environ.get('PORT', '8000')).status_code==200 else 1)"
# Production: migrate, then gunicorn managing uvicorn workers. Never the dev
# server. Run through `sh` rather than as an executable so the image builds
# identically from a Windows checkout, where the exec bit does not survive.
CMD ["sh", "./docker-entrypoint.sh"]
