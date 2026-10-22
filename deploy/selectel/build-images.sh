#!/usr/bin/env bash
set -Eeuo pipefail

usage() {
  printf 'Usage: %s <40-character-commit-sha> [--frontend-only]\n' "$0" >&2
  printf 'Set SELECTEL_MAX_BOT_USERNAME to the public MAX bot username before running.\n' >&2
}

die() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || die "required command is missing: $1"
}

[ "$#" -ge 1 ] && [ "$#" -le 2 ] || { usage; exit 2; }
PRODUCT_SHA=$1
BUILD_MODE=${2:-full}
case "$BUILD_MODE" in full|--frontend-only) ;; *) usage; exit 2 ;; esac
[[ "$PRODUCT_SHA" =~ ^[0-9a-fA-F]{40}$ ]] || die 'commit SHA must contain exactly 40 hexadecimal characters'

require_command git
require_command docker
require_command mktemp
require_command tar

CHECKOUT_ROOT=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd -P)
repo_git() {
  git -c "safe.directory=$CHECKOUT_ROOT" -C "$CHECKOUT_ROOT" "$@"
}

origin=$(repo_git config --get remote.origin.url || true)
case "$origin" in
  https://github.com/alexdubaev/OurMemoriesDevBot.git|git@github.com:alexdubaev/OurMemoriesDevBot.git) ;;
  *) die 'remote.origin.url must be the canonical OurMemoriesDevBot repository' ;;
esac

head=$(repo_git rev-parse HEAD 2>/dev/null || true)
[ "$head" = "$PRODUCT_SHA" ] || die "checkout HEAD must equal requested SHA ($PRODUCT_SHA)"
[ -z "$(repo_git status --porcelain)" ] || die 'checkout must be clean before building images'
repo_git cat-file -e "$PRODUCT_SHA^{commit}" 2>/dev/null || die 'requested SHA is not a local commit'
accepted_sha=$(repo_git rev-parse refs/remotes/origin/main 2>/dev/null || true)
[ -n "$accepted_sha" ] || die 'origin/main is missing; fetch the canonical remote before building'
repo_git merge-base --is-ancestor "$PRODUCT_SHA" "$accepted_sha" || die 'requested SHA is not accepted by origin/main'

: "${SELECTEL_MAX_BOT_USERNAME:?SELECTEL_MAX_BOT_USERNAME must contain the public MAX bot username}"
[[ "$SELECTEL_MAX_BOT_USERNAME" =~ ^[A-Za-z0-9_]{5,32}$ ]] || die 'SELECTEL_MAX_BOT_USERNAME has an invalid public username format'

BACKEND_IMAGE="memoly-backend:$PRODUCT_SHA"
WEBAPP_IMAGE="memoly-webapp:$PRODUCT_SHA"
BUILD_CONTEXT=$(mktemp -d)
cleanup() {
  [ -z "${VERIFY_CONTAINER:-}" ] || docker rm -f "$VERIFY_CONTAINER" >/dev/null 2>&1 || true
  [ -z "${VERIFY_EXISTING_CONTAINER:-}" ] || docker rm -f "$VERIFY_EXISTING_CONTAINER" >/dev/null 2>&1 || true
  [ -z "${VERIFY_TEMP_TAG:-}" ] || docker image rm "$VERIFY_TEMP_TAG" >/dev/null 2>&1 || true
  [ -z "${VERIFY_TEMP_DIR:-}" ] || rm -rf -- "$VERIFY_TEMP_DIR"
  rm -rf -- "$BUILD_CONTEXT"
}
trap cleanup EXIT

# Build from a tracked archive so ignored files on a long-lived host checkout
# cannot enter a Docker context and change the artifact.
repo_git archive --format=tar "$PRODUCT_SHA" | tar -xf - -C "$BUILD_CONTEXT"

build_webapp_image() {
  local target_tag=$1 existing_id existing_revision existing_container existing_dist built_container built_dist existing_checksum built_checksum built_revision
  existing_id=$(docker image inspect --format '{{.Id}}' "$WEBAPP_IMAGE" 2>/dev/null || true)
  if [ -n "$existing_id" ]; then
    existing_revision=$(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$WEBAPP_IMAGE" 2>/dev/null || true)
    [ "$existing_revision" = "$PRODUCT_SHA" ] || die "existing immutable webapp tag has an unexpected revision: $WEBAPP_IMAGE"
    target_tag="memoly-webapp-verify:$PRODUCT_SHA-$$"
    VERIFY_TEMP_TAG=$target_tag
  fi
  docker build \
  --build-arg VITE_API_URL= \
  --build-arg "VITE_MAX_BOT_USERNAME=$SELECTEL_MAX_BOT_USERNAME" \
  --build-arg VITE_MEMOLY_UI_VERSION=v2 \
  --label "org.opencontainers.image.revision=$PRODUCT_SHA" \
  --tag "$target_tag" \
  --file "$BUILD_CONTEXT/deploy/selectel/Dockerfile.webapp" \
  "$BUILD_CONTEXT"

  [ -z "$existing_id" ] && return 0
  docker image inspect --format '{{.Id}}' "$target_tag" >/dev/null || die 'built verification image is missing'
  built_revision=$(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$target_tag") || die 'cannot inspect built verification image'
  [ "$built_revision" = "$PRODUCT_SHA" ] || die 'built verification image revision label mismatch'
  VERIFY_TEMP_DIR=$(mktemp -d)
  existing_dist="$VERIFY_TEMP_DIR/existing"
  built_dist="$VERIFY_TEMP_DIR/built"
  mkdir "$existing_dist" "$built_dist"
  existing_container=$(docker create "$WEBAPP_IMAGE") || die 'cannot create a container for the existing immutable webapp image'
  VERIFY_EXISTING_CONTAINER=$existing_container
  built_container=$(docker create "$target_tag") || die 'cannot create a container to verify static artifact bytes'
  VERIFY_CONTAINER=$built_container
  docker cp "$existing_container:/srv/." "$existing_dist" >/dev/null || die 'cannot extract existing static artifact for immutable-tag comparison'
  docker cp "$built_container:/srv/." "$built_dist" >/dev/null || die 'cannot extract built static artifact for immutable-tag comparison'
  existing_checksum=$(cd "$existing_dist" && find . -type f -print0 | sort -z | xargs -0 sha256sum | sha256sum | awk '{print $1}')
  built_checksum=$(cd "$built_dist" && find . -type f -print0 | sort -z | xargs -0 sha256sum | sha256sum | awk '{print $1}')
  [ -n "$existing_checksum" ] && [ "$existing_checksum" = "$built_checksum" ] || die 'existing immutable webapp SHA tag contains different static bytes; refusing to retag'
  docker rm "$existing_container" "$built_container" >/dev/null
  VERIFY_EXISTING_CONTAINER=
  VERIFY_CONTAINER=
  rm -rf -- "$VERIFY_TEMP_DIR"
  VERIFY_TEMP_DIR=
  docker image rm "$target_tag" >/dev/null
  VERIFY_TEMP_TAG=
}

if [ "$BUILD_MODE" = full ]; then
  docker build \
    --label "org.opencontainers.image.revision=$PRODUCT_SHA" \
    --tag "$BACKEND_IMAGE" \
    --file "$BUILD_CONTEXT/backend/Dockerfile" \
    "$BUILD_CONTEXT"
fi
build_webapp_image "$WEBAPP_IMAGE"

images=("$WEBAPP_IMAGE")
[ "$BUILD_MODE" = full ] && images+=("$BACKEND_IMAGE")
for image in "${images[@]}"; do
  docker image inspect "$image" >/dev/null 2>&1 || die "built image is missing: $image"
  revision=$(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$image")
  [ "$revision" = "$PRODUCT_SHA" ] || die "image revision label mismatch: $image"
done

printf 'Built and verified immutable %s image(s) for %s:\n' "$BUILD_MODE" "$PRODUCT_SHA"
if [ "$BUILD_MODE" = full ]; then printf '  %s\n' "$BACKEND_IMAGE"; fi
printf '  %s\n' "$WEBAPP_IMAGE"
