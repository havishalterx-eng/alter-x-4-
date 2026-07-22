# Platform API

For local database work, start PostgreSQL with `docker compose up -d platform-db`, export `DATABASE_URL=postgres://platform_api:platform_api_local@localhost:5432/platform_db`, then run `pnpm --filter @alterx/platform-api db:migrate`.

Auth0 client secrets use runtime references such as `AUTH0_M2M_CLIENT_SECRET_REF=env:AUTH0_M2M_CLIENT_SECRET`; only the referenced environment variable contains the secret value.
