#!/usr/bin/env bash
set -euo pipefail
shopt -s globstar nullglob

function fail {
  echo "$@" >&2
  exit 1
}

function log {
  printf "%s\n" "$@" >&2
}

if [ -z "${BUNNY_STORAGE_KEY:-}" ] || [ -z "${BUNNY_KEY}" ]; then
  fail "The environment variables BUNNY_STORAGE_KEY and BUNNY_KEY must be provided";
fi

log "Uploading files from ./out"
for srcpath in ./out/**/*; do
  if [ ! -f "$srcpath" ]; then
    continue
  fi

  dstpath="${srcpath#./out/}"
  dstURL="https://uk.storage.bunnycdn.com/plantopo/paper-maps/$dstpath"
  humanSize=$(du -sh "$srcpath" | cut -f1)


  if ! output="$(curl -X PUT -H "AccessKey: $BUNNY_STORAGE_KEY" --silent --show-error --fail-with-body 2>&1 \
         "$dstURL" --data-binary @"$srcpath")"; then
     fail "failed to upload $srcpath: $output"
 fi

  log "Uploaded $srcpath ($humanSize) -> $dstURL"
done
log "Done uploading"

for url in "https://plantopo-storage.b-cdn.net/paper-maps" "https://plantopo-storage.b-cdn.net/paper-maps/*"; do
  curl --get -H "AccessKey: $BUNNY_KEY" --fail-with-body "https://api.bunny.net/purge" \
    -d "url=$url"
  log "Purged $url"
done

log "All done"
