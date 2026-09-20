# Selectel host deployment ownership

This runbook is the reproducible source for the existing Selectel host at
`/opt/memoly/app`. It fixes the previous `memoly-webapp-1` collision by keeping
the already-running host-port Caddy gateway unmanaged and giving Docker Compose
ownership only of internal services.

## Ownership model

- The configured gateway (`GATEWAY_CONTAINER`, normally `memoly-webapp-1`) is a
  manually managed Caddy container. It owns host ports 80/443 and must have no
  `com.docker.compose.*` labels.
- The Compose project (`COMPOSE_PROJECT`) owns `backend`, `worker`, `scheduler`,
  and `static` on the external `MEMOLY_EDGE_NETWORK` network.
- `static` is the only frontend service. It publishes no host port and has no
  `container_name`; the gateway routes ordinary traffic to `static:80`.
- The static image must contain the built webapp at `/srv` and Caddy must use
  `Caddyfile.static.template`. The gateway uses
  `Caddyfile.edge.template` and routes API/health/scoped handlers before the
  SPA fallback.

The gateway is never addressed through `docker compose`. The script refuses a
missing gateway, a running gateway with Compose labels, or a missing network.
It never deletes or renames a container and never uses orphan removal.

## One-time host preparation

Verify the external network and attach the existing gateway during a controlled
maintenance window. Do not recreate the gateway just to free a name:

```sh
docker network inspect memoly_default >/dev/null 2>&1 || docker network create memoly_default
docker network connect memoly_default memoly-webapp-1
```

Copy `rollback.env.example` to an ignored server-only file such as
`/opt/memoly/rollback.env`, then set the previous accepted immutable tags.
Keep the Compose env files at `/opt/memoly/env/postgres.env` and
`/opt/memoly/env/backend.env`, and keep the three MAX secret files under
`/opt/memoly/secrets/`. Never commit any of these server-only files.

## Promotion

Run from `/opt/memoly/app` after a reviewed checkout has supplied these files:

```sh
export MEMOLY_PRODUCT_SHA='0123456789abcdef0123456789abcdef01234567'
export MEMOLY_BACKEND_IMAGE_TAG="$MEMOLY_PRODUCT_SHA"
export MEMOLY_WEBAPP_IMAGE_TAG="$MEMOLY_PRODUCT_SHA"
export MEMOLY_PUBLIC_HOST='app.memoly.ru'
deploy/selectel/redeploy.sh preflight
deploy/selectel/redeploy.sh migration-status
deploy/selectel/redeploy.sh deploy
```

`preflight` validates gateway ownership, shared-network membership, locally
available immutable images, candidate Caddy configuration, and Compose config.
`deploy` checks migration status, promotes backend and verifies readiness from
inside the backend container, promotes worker and scheduler, promotes internal
static and verifies it from the backend over `http://static:80`, then atomically
installs/reloads the stable gateway and checks public health and the root. It
does not run `prisma db push`, pull registry images, or execute destructive SQL.

If any critical check fails, stop promotion and use the prepared rollback:

```sh
deploy/selectel/redeploy.sh rollback
```

Rollback promotes the configured previous backend/webapp tags through the same
Compose project and readiness checks. It leaves both additive MAX migrations in
place; database rollback is not part of application rollback.

## Config validation

Before copying files to the host, run:

```sh
bun test tests/selectel-deployment-ownership.test.mjs
bash -n deploy/selectel/redeploy.sh
deploy/selectel/redeploy.sh preflight
```

The final command loads the three server-only MAX secret files, validates the
candidate Caddyfile in the running unmanaged gateway, checks local immutable
images, and runs `docker compose config`. It requires the server's Docker daemon
and must be run on the host before promotion; do not substitute a committed env
file or print secret values.
