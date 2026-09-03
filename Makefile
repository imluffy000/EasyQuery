# Development tasks. Everything runs in Docker so the toolchain is identical
# on every machine; no local Python or Node version is assumed.

COMPOSE := docker compose
BACKEND_RUN := $(COMPOSE) run --rm --no-deps -T backend

.DEFAULT_GOAL := help
.PHONY: help up down restart logs build dev seed migrate migration test test-unit \
        test-integration lint format typecheck check clean urls ps shell psql redis-cli

help: ## Show this help
	@grep -hE '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | \
	  awk 'BEGIN{FS=":.*?## "}{printf "  \033[36m%-18s\033[0m %s\n", $$1, $$2}'

up: ## Start the full stack
	$(COMPOSE) up -d --build
	@$(MAKE) --no-print-directory urls

dev: ## Start dependencies only (run backend/frontend yourself)
	$(COMPOSE) up -d postgres redis

down: ## Stop everything
	$(COMPOSE) down

clean: ## Stop everything and delete volumes (destroys all data)
	$(COMPOSE) down -v

restart: ## Rebuild and restart the backend
	$(COMPOSE) up -d --build backend

ps: ## Show container status
	$(COMPOSE) ps

logs: ## Tail backend logs
	$(COMPOSE) logs -f backend

migrate: ## Apply database migrations
	$(BACKEND_RUN) alembic upgrade head

migration: ## Create a migration: make migration m="add x"
	$(BACKEND_RUN) alembic revision --autogenerate -m "$(m)"

seed: ## Recreate the demo customer database
	$(COMPOSE) exec -T postgres psql -U copilot -d postgres -c "DROP DATABASE IF EXISTS demo_analytics"
	$(COMPOSE) exec -T postgres psql -U copilot -d postgres -f /docker-entrypoint-initdb.d/01-init.sql
	$(COMPOSE) exec -T postgres psql -U copilot -d postgres -f /docker-entrypoint-initdb.d/02-seed-demo.sql

test: test-unit test-integration ## Run all tests

test-unit: ## Run unit tests (no services needed)
	$(BACKEND_RUN) python -m pytest tests/unit -q

test-integration: ## Run integration tests (needs `make dev`)
	$(COMPOSE) run --rm -T -e TEST_PG_HOST=postgres backend python -m pytest tests/integration -q

eval: ## Run the agent evaluation benchmark
	$(COMPOSE) run --rm -T -e TEST_PG_HOST=postgres backend python -m evaluation.run

lint: ## Lint backend and frontend
	$(BACKEND_RUN) ruff check app tests
	cd frontend && npm run lint

format: ## Auto-format backend
	$(BACKEND_RUN) ruff format app tests
	$(BACKEND_RUN) ruff check --fix app tests

typecheck: ## Type-check backend and frontend
	$(BACKEND_RUN) mypy app
	cd frontend && npm run typecheck

check: lint typecheck test ## Everything CI runs

shell: ## Open a shell in the backend container
	$(COMPOSE) run --rm backend /bin/bash

psql: ## psql into the control-plane database
	$(COMPOSE) exec postgres psql -U copilot -d copilot

psql-demo: ## psql into the demo customer database
	$(COMPOSE) exec postgres psql -U copilot -d demo_analytics

redis-cli: ## Open redis-cli
	$(COMPOSE) exec redis redis-cli

urls: ## Print service URLs
	@echo ""
	@echo "  App          http://localhost:5173"
	@echo "  API          http://localhost:8000/api/v1"
	@echo "  API docs     http://localhost:8000/docs"
	@echo "  Metrics      http://localhost:8000/metrics"
	@echo "  Prometheus   http://localhost:9090"
	@echo "  Grafana      http://localhost:3001  (admin/admin)"
	@echo ""
