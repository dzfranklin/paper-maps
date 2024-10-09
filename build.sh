#!/usr/bin/env bash
set -euo pipefail

# Clean build dir

if test -e build; then
    rm -r build/*
fi
mkdir -p build

# Assemble images

mkdir -p build/images

cp -r ./publisher_icons build/images/publisher_icons

for source_path in sources/*; do
    source=$(basename "$source_path")
    if test -e "$source_path"/images; then
        cp -R "$source_path"/images build/images/"$source"
    fi
done

echo "Assembled $(find build/images -type f | wc -l) images"
echo

# Assemble metadata

attribution=$(jq -s -r 'map(.features) | flatten | map(.properties.publisher) | unique | map("© "+.) | join(" ")' sources/*/geojson.json)

echo '{"type": "FeatureCollection", "properties": {"attribution": "'"$attribution"'"}, "features": []}' > build/paper_maps_geojson.json
for f in sources/*/geojson.json; do
  cp build/paper_maps_geojson.json build/input.json
  jq '.features += inputs.features' build/input.json "$f" > build/paper_maps_geojson.json
  rm build/input.json
done

jq -s 'map(.features) | flatten | map([.properties.publisher, .properties.series, .properties.icon]) | group_by(.[0]) | map({key:.[0][0], value:{publisher: .[0][0], series: map(.[1]) | unique, icon: .[0][2]}}) | from_entries' sources/*/geojson.json >build/publishers.json

# Build tiles

tippecanoe --output build/paper_maps.pmtiles \
    --name "Paper Maps" --description "Paper Maps generated $(date -u '+%Y-%m-%d')" \
    --attribution "$attribution" \
    --base-zoom=g \
    -zg \
    --generate-ids \
    --layer=default \
    --name="Paper Maps" \
    build/paper_maps_geojson.json

# Final prep

cp index.html build/index.html
gzip build/paper_maps_geojson.json

echo "All done"
echo "To deploy upload the ./build folder to the paper-maps folder in plantopo-storage at bunny.net"
