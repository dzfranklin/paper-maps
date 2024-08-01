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

# Build tiles

mkdir -p build/tiles

attribution=$(jq -s -r 'map(.features) | flatten | map(.properties.publisher) | unique | map("© "+.) | join(" ")' sources/*/geojson.json)

source_files=()
for source_path in sources/*; do
    source=$(basename "$source_path")
    source_files+=(sources/"$source"/geojson.json)
done

tippecanoe \
    --maximum-zoom=5 --minimum-zoom=1 \
    --output-to-directory=build/tiles \
    --generate-ids \
    --layer=maps \
    --name="Paper Maps" \
    "${source_files[@]}"

# Assemble resources

sed s/MAPBOX_ACCESS_TOKEN/"$MAPBOX_ACCESS_TOKEN"/ index.html >build/index.html
sed s/ATTRIBUTION/"$attribution"/ source.json >build/source.json

jq -s 'map(.features) | flatten | map([.properties.publisher, .properties.series]) | unique | group_by(.[0]) | map({key:.[0][0], value:{publisher: .[0][0], series: map(.[1]), icon: ("http://paper-map-data.plantopo.com/images/publisher_icons/"+(.[0][0] | @uri)+".png")}}) | from_entries' sources/*/geojson.json >build/publishers.json

echo
echo "All done"
