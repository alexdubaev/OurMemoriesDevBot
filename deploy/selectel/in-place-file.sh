#!/usr/bin/env bash
set -Eeuo pipefail

usage() {
	printf 'Usage: in-place-file.sh {activate|restore} SOURCE TARGET\n' >&2
}

die() {
	printf 'ERROR: %s\n' "$*" >&2
	exit 1
}

[ "$#" -eq 3 ] || { usage; exit 2; }
operation=$1
source_file=$2
target_file=$3

case "$operation" in
	activate|restore) ;;
	*) usage; exit 2 ;;
esac

[ -f "$source_file" ] || die "source file is missing: $source_file"
[ -f "$target_file" ] || die "active target file is missing: $target_file"
[ ! -L "$target_file" ] || die "active target must be a regular file, not a symlink: $target_file"
[ "$source_file" != "$target_file" ] || die "source and active target must differ"

inode_before=$(stat -c '%i' -- "$target_file")
cat -- "$source_file" > "$target_file"
inode_after=$(stat -c '%i' -- "$target_file")

[ "$inode_before" = "$inode_after" ] || die "active target inode changed during $operation"
cmp -s -- "$source_file" "$target_file" || die "active target content does not match source after $operation"
