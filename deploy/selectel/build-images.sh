#!/usr/bin/env bash
set -Eeuo pipefail

usage() {
  printf 'Usage: %s <40-character-commit-sha>\n' "$0" >&2
  printf 'Set VITE_MAX_BOT_USERNAME to the public MAX bot username before running.\n' >&2
}

die() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || die "required command is missing: $1"
}

[ "$#" -eq 1 ] || { usage; exit 2; }
PRODUCT_SHA=$1
[[ "$PRODUCT_SHA" =~ ^[0-9a-fA-F]{40}$ ]] || die 'commit SHA must contain exactly 40 hexadecimal characters'

require_command git
require_command docker

origin=$(git config --get remote.origin.url || true)
case "$origin" in
  https://github.com/alexdubaev/OurMemoriesDevBot.git|git@github.com:alexdubaev/OurMemoriesDevBot.git) ;;
  *) die 'remote.origin.url must be the canonical OurMemoriesDevBot repository' ;;
esac

head=$(git rev-parse HEAD 2>/dev/null || true)
[ "$head" = "$PRODUCT_SHA" ] || die "checkout HEAD must equal requested SHA ($PRODUCT_SHA)"
[ -z "$(git status --porcelain)" ] || die 'checkout must be clean before building images'
git cat-file -e "$PRODUCT_SHA^{commit}" 2>/dev/null || die 'requested SHA is not a local commit'

: "${VITE_MAX_BOT_USERNAME:?VITE_MAX_BOT_USERNAME must contain the public MAX bot username}"
[[ "$VITE_MAX_BOT_USERNAME" =~ ^[A-Za-z0-9_]{5,32}$ ]] || die 'VITE_MAX_BOT_USERNAME has an invalid public username format'

BACKEND_IMAGE="memoly-backend:$PRODUCT_SHA"
WEBAPP_IMAGE="memoly-webapp:$PRODUCT_SHA"

docker build \
  --label "org.opencontainers.image.revision=$PRODUCT_SHA" \
  --tag "$BACKEND_IMAGE" \
  --file backend/Dockerfile \
  .

docker build \
  --build-arg VITE_API_URL= \
  --build-arg "VITE_MAX_BOT_USERNAME=$VITE_MAX_BOT_USERNAME" \
  --label "org.opencontainers.image.revision=$PRODUCT_SHA" \
  --tag "$WEBAPP_IMAGE" \
  --file deploy/selectel/Dockerfile.webapp \
  .

for image in "$BACKEND_IMAGE" "$WEBAPP_IMAGE"; do
  docker image inspect "$image" >/dev/null 2>&1 || die "built image is missing: $image"
  revision=$(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$image")
  [ "$revision" = "$PRODUCT_SHA" ] || die "image revision label mismatch: $image"
done

printf 'Built and verified immutable images for %s:\n' "$PRODUCT_SHA"
printf '  %s\n  %s\n' "$BACKEND_IMAGE" "$WEBAPP_IMAGE"
