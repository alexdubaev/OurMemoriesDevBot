#!/usr/bin/env bash
# Shared fail-closed scope and review-receipt interpreter for local and Selectel
# frontend releases. Source this file or invoke it with `classify` / `verify`.
set -Eeuo pipefail

FRONTEND_SCOPE_POLICY=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)/frontend-safe-paths.txt
FRONTEND_REVIEW_ROOT=/opt/memoly/frontend-reviews

frontend_scope_error() { printf 'ERROR: %s\n' "$*" >&2; return 1; }
frontend_git() { command git -c "safe.directory=$(pwd -P)" "$@"; }

frontend_scope_classify() {
  local path=$1 kind expression
  [[ -n "$path" && "$path" != /* && "$path" != *\\* && "$path" != *$'\t'* && "$path" != *$'\n'* && "$path" != *$'\r'* ]] || {
    frontend_scope_error "ambiguous changed path: $path"; return 1;
  }
  [[ "/$path/" != *'/../'* && "/$path/" != *'/./'* && "/$path/" != *'//'* ]] || {
    frontend_scope_error "ambiguous changed path: $path"; return 1;
  }
  [[ -f "$FRONTEND_SCOPE_POLICY" && ! -L "$FRONTEND_SCOPE_POLICY" ]] || {
    frontend_scope_error 'shared frontend policy is missing or invalid'; return 1;
  }
  while IFS=$'\t' read -r kind expression; do
    expression=${expression%$'\r'}
    [[ -z "$kind" || "$kind" == \#* ]] && continue
    [[ "$kind" == A || "$kind" == R || "$kind" == D ]] && [[ -n "$expression" ]] || { frontend_scope_error 'shared frontend policy is malformed'; return 1; }
    [[ "$path" =~ $expression ]] && { printf '%s\n' "$kind"; return 0; }
  done < "$FRONTEND_SCOPE_POLICY"
  frontend_scope_error "unknown path requires FULL: $path"
  return 1
}

frontend_scope_hash() {
  sha256sum | awk '{print $1}'
}

frontend_scope_range_values() {
  local base=$1 candidate=$2 raw tree policy_sha script_blob candidate_script_blob candidate_policy_blob policy_blob
  [[ "$base" =~ ^[0-9a-f]{40}$ && "$candidate" =~ ^[0-9a-f]{40}$ ]] || { frontend_scope_error 'range requires full commit SHAs'; return 1; }
  [[ "$(frontend_git rev-parse --verify "${base}^{commit}")" == "$base" && "$(frontend_git rev-parse --verify "${candidate}^{commit}")" == "$candidate" ]] || { frontend_scope_error 'range SHA does not resolve exactly'; return 1; }
  # The policy and interpreter are themselves release tooling. A candidate may
  # never change its own classifier and then use that changed policy to pass.
  for protected in deploy/selectel/frontend-safe-paths.txt deploy/selectel/frontend-scope.sh deploy/selectel/frontend-release.sh scripts/verify-local.mjs; do
    frontend_git diff --quiet "$base" "$candidate" -- "$protected" || { frontend_scope_error "frontend policy/release tooling changed: $protected"; return 1; }
  done
  local summary
  summary=$(frontend_git diff --summary --no-ext-diff --no-renames "$base" "$candidate" --) || { frontend_scope_error 'cannot inspect source modes'; return 1; }
  [[ "$summary" != *'mode change'* && "$summary" != *'create mode 100755'* && "$summary" != *'create mode 120000'* && "$summary" != *'create mode 160000'* ]] || { frontend_scope_error 'frontend scope refuses executable, symlink, or submodule mode changes'; return 1; }
  tree=$(frontend_git rev-parse "${candidate}^{tree}") || return 1
  policy_sha=$(frontend_git show "$candidate:deploy/selectel/frontend-safe-paths.txt" | frontend_scope_hash) || { frontend_scope_error 'cannot read candidate policy blob'; return 1; }
  candidate_script_blob=$(frontend_git rev-parse "$candidate:deploy/selectel/frontend-scope.sh") || { frontend_scope_error 'cannot read candidate scope interpreter blob'; return 1; }
  script_blob=$(frontend_git hash-object --path=deploy/selectel/frontend-scope.sh "${BASH_SOURCE[0]}") || return 1
  [[ "$script_blob" == "$candidate_script_blob" ]] || { frontend_scope_error 'working scope interpreter differs from candidate blob'; return 1; }
  candidate_policy_blob=$(frontend_git rev-parse "$candidate:deploy/selectel/frontend-safe-paths.txt") || { frontend_scope_error 'cannot read candidate policy blob ID'; return 1; }
  policy_blob=$(frontend_git hash-object --path=deploy/selectel/frontend-safe-paths.txt "$FRONTEND_SCOPE_POLICY") || return 1
  [[ "$policy_blob" == "$candidate_policy_blob" ]] || { frontend_scope_error 'working policy differs from candidate blob'; return 1; }
  raw=$(mktemp) || { frontend_scope_error 'cannot allocate temporary range file'; return 1; }
  if ! frontend_git diff --raw --no-ext-diff --no-textconv -z --no-renames --abbrev=40 "$base" "$candidate" -- > "$raw"; then
    rm -f -- "$raw"; frontend_scope_error 'cannot read complete raw range diff'; return 1
  fi
  local diff_sha
  diff_sha=$(frontend_scope_hash < "$raw") || { rm -f -- "$raw"; return 1; }
  rm -f -- "$raw"
  printf '%s\t%s\t%s\t%s\n' "$base" "$tree" "$diff_sha" "$policy_sha"
}

frontend_scope_check_receipt() {
  local range=$1 mode=$2 supplied_dir=${3:-} base tree diff_sha policy_sha fingerprint root receipt report owner modebits reviewer report_sha
  IFS=$'\t' read -r base tree diff_sha policy_sha <<< "$range"
  fingerprint=$(printf '%s\0%s\0%s\0%s\n' "$base" "$tree" "$diff_sha" "$policy_sha" | frontend_scope_hash) || return 1
  if [[ "$mode" == server ]]; then
    root=$FRONTEND_REVIEW_ROOT
    [[ "$root" == /opt/memoly/frontend-reviews && -d "$root" && ! -L "$root" ]] || { frontend_scope_error 'protected frontend review store is unavailable'; return 1; }
    [[ ! -L /opt && ! -L /opt/memoly ]] || { frontend_scope_error 'protected frontend review store has a symlink parent'; return 1; }
    [[ "$(stat -c '%u:%a' /opt)" == 0:755 && "$(stat -c '%u:%a' /opt/memoly)" == 0:755 ]] || { frontend_scope_error 'protected frontend review store parents must be root-owned mode 0755'; return 1; }
    [[ "$(stat -c '%u:%a' "$root")" == 0:700 ]] || { frontend_scope_error 'protected frontend review store must be root-owned mode 0700'; return 1; }
  else
    [[ -n "$supplied_dir" && -d "$supplied_dir" && ! -L "$supplied_dir" ]] || { frontend_scope_error 'REVIEW_REQUIRED: provide --frontend-review with exact review receipts'; return 1; }
    root=$supplied_dir
  fi
  receipt="$root/$fingerprint.receipt"; report="$root/$fingerprint.report"
  [[ -f "$receipt" && ! -L "$receipt" && -f "$report" && ! -L "$report" ]] || { frontend_scope_error "REVIEW_REQUIRED: no exact-range frontend review receipt for $base"; return 1; }
  if [[ "$mode" == server ]]; then
    [[ "$(stat -c '%u:%a' "$receipt")" == 0:600 && "$(stat -c '%u:%a' "$report")" == 0:600 ]] || { frontend_scope_error 'frontend review receipt and report must be root-owned mode 0600'; return 1; }
  fi
  [[ "$(wc -l < "$receipt" | tr -d ' ')" == 9 ]] || { frontend_scope_error 'frontend review receipt has invalid structure'; return 1; }
  mapfile -t fields < "$receipt"
  [[ "${fields[0]}" == MEMOLY_FRONTEND_REVIEW=1 && "${fields[1]}" == "BASE_SHA=$base" && "${fields[2]}" == "CANDIDATE_TREE=$tree" && "${fields[3]}" == "DIFF_SHA256=$diff_sha" && "${fields[4]}" == "POLICY_SHA256=$policy_sha" ]] || { frontend_scope_error 'frontend review receipt is stale or mismatched'; return 1; }
  [[ "${fields[5]}" =~ ^REVIEWER_ID=[A-Za-z0-9._@/-]{3,120}$ ]] || { frontend_scope_error 'frontend review receipt has an invalid reviewer identity'; return 1; }
  reviewer=${fields[5]#REVIEWER_ID=}
  [[ "${fields[6]}" == DECISION=FRONTEND ]] || { frontend_scope_error 'frontend review receipt does not approve FRONTEND'; return 1; }
  [[ "${fields[7]}" =~ ^REPORT_SHA256=([0-9a-f]{64})$ ]] || { frontend_scope_error 'frontend review receipt has an invalid report digest'; return 1; }
  report_sha=${BASH_REMATCH[1]}
  [[ "${fields[8]}" == FINGERPRINT=$fingerprint ]] || { frontend_scope_error 'frontend review receipt fingerprint is invalid'; return 1; }
  [[ "$(cat "$report" | frontend_scope_hash)" == "$report_sha" ]] || { frontend_scope_error 'frontend review report digest does not match receipt'; return 1; }
  [[ -s "$report" ]] || { frontend_scope_error 'frontend review report is empty'; return 1; }
  printf 'REVIEW_OK base=%s reviewer=%s fingerprint=%s\n' "$base" "$reviewer" "$fingerprint"
}

frontend_scope_verify_range() {
  local base=$1 candidate=$2 receipt_mode=$3 receipt_dir=${4:-} path class has_review=false range
  range=$(frontend_scope_range_values "$base" "$candidate") || return 1
  local raw
  raw=$(mktemp) || { frontend_scope_error 'cannot allocate changed-path file'; return 1; }
  frontend_git diff --name-only -z --no-ext-diff --no-renames "$base" "$candidate" -- > "$raw" || { rm -f -- "$raw"; frontend_scope_error 'cannot read changed paths'; return 1; }
  while IFS= read -r -d '' path; do
    [[ -n "$path" ]] || { rm -f -- "$raw"; frontend_scope_error 'empty path in candidate range'; return 1; }
    class=$(frontend_scope_classify "$path") || { rm -f -- "$raw"; return 1; }
    case "$class" in
      D) rm -f -- "$raw"; frontend_scope_error "frontend scope requires FULL: $path"; return 1 ;;
      R) has_review=true ;;
      A) ;;
      *) rm -f -- "$raw"; frontend_scope_error 'invalid scope classification'; return 1 ;;
    esac
  done < "$raw"
  rm -f -- "$raw"
  if [[ "$has_review" == true ]]; then frontend_scope_check_receipt "$range" "$receipt_mode" "$receipt_dir" || return 1; fi
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  command=${1:-}; shift || true
  case "$command" in
    classify)
      [[ $# -gt 0 ]] || { frontend_scope_error 'classify requires paths'; exit 1; }
      for path in "$@"; do class=$(frontend_scope_classify "$path") || exit 1; printf '%s\t%s\n' "$path" "$class"; done ;;
    inspect)
      [[ $# -eq 2 ]] || { frontend_scope_error 'usage: frontend-scope.sh inspect BASE CANDIDATE'; exit 1; }
      range=$(frontend_scope_range_values "$1" "$2") || exit 1
      IFS=$'\t' read -r base tree diff_sha policy_sha <<< "$range"
      fingerprint=$(printf '%s\0%s\0%s\0%s\n' "$base" "$tree" "$diff_sha" "$policy_sha" | frontend_scope_hash)
      printf 'BASE_SHA=%s\nCANDIDATE_TREE=%s\nDIFF_SHA256=%s\nPOLICY_SHA256=%s\nFINGERPRINT=%s\n' "$base" "$tree" "$diff_sha" "$policy_sha" "$fingerprint" ;;
    verify)
      [[ $# -ge 3 && $# -le 4 ]] || { frontend_scope_error 'usage: frontend-scope.sh verify BASE CANDIDATE local|server [REVIEW_DIR]'; exit 1; }
      frontend_scope_verify_range "$1" "$2" "$3" "${4:-}" ;;
    *) frontend_scope_error 'usage: frontend-scope.sh classify PATH... | inspect BASE CANDIDATE | verify BASE CANDIDATE local|server [REVIEW_DIR]'; exit 2 ;;
  esac
fi
