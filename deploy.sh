#!/usr/bin/env bash
set -eou pipefail

aws s3 sync --delete \
    --exclude '*/.*' --exclude "tiles/*/*.pbf" \
    ./build s3://paper-map-data
echo "Synced non-tile files"

aws s3 sync --delete --exclude '*' \
    --include 'tiles/*/*.pbf' --content-encoding gzip \
    ./build s3://paper-map-data
echo "Synced tiles"

aws cloudfront create-invalidation --distribution-id E1N1T7ECZZ8M13 --paths '/*' >/dev/null
echo "Requested cloudfront invalidation"

echo "All done"
