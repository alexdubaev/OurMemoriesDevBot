FROM oven/bun:1.4.0 AS build

WORKDIR /app

# Copy the repository instead of enumerating workspace manifests. The master branch
# intentionally has no mobile package, while the mobile branch does; this build must
# remain valid for both repository shapes.
COPY . .

RUN BUN_CONFIG_MAX_HTTP_REQUESTS=8 bun install --frozen-lockfile --network-concurrency 8 --filter @web-app-demo/backend

WORKDIR /app/backend

RUN DATABASE_URL="postgresql://superuser:superpassword@localhost:5432/web_app_demo?schema=public" bun run prisma:generate

FROM oven/bun:1.4.0 AS production-dependencies

WORKDIR /app

COPY . .

RUN BUN_CONFIG_MAX_HTTP_REQUESTS=8 bun install --frozen-lockfile --production --network-concurrency 8 --filter @web-app-demo/backend

FROM oven/bun:1.4.0 AS runtime

WORKDIR /app

# User media is prepared by the maintained OS package, never a stale npm-bundled binary.
RUN apt-get update && apt-get install --no-install-recommends -y ca-certificates ffmpeg \
  && rm -rf /var/lib/apt/lists/*

COPY backend/certificates/ /usr/local/share/ca-certificates/

RUN update-ca-certificates

COPY --from=build /app/package.json /app/bun.lock /app/bunfig.toml ./
COPY --from=production-dependencies /app/node_modules ./node_modules
COPY --from=build /app/packages/contracts ./packages/contracts
COPY --from=build /app/backend ./backend

WORKDIR /app/backend

ENV NODE_ENV=production

USER bun

CMD ["bun", "src/index.ts"]
