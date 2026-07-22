# Platform API

For local database work, start PostgreSQL with `docker compose up -d platform-db`, export `DATABASE_URL=postgres://platform_api:platform_api_local@localhost:5432/platform_db`, then run `pnpm --filter @alterx/platform-api db:migrate`.
