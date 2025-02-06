#!/usr/bin/env bash
set -euo pipefail

MAPLIBRE_GL_VERSION="5.1.0"
TURF_VERSION="7.0.0"
PMTILES_VERSION="3.2.0"

mkdir -p ./out/demo_vendor

for src in \
  "https://unpkg.com/maplibre-gl@${MAPLIBRE_GL_VERSION}/dist/maplibre-gl.css" \
  "https://unpkg.com/maplibre-gl@${MAPLIBRE_GL_VERSION}/dist/maplibre-gl.js" \
  "https://cdn.jsdelivr.net/npm/@turf/turf@${TURF_VERSION}/turf.min.js" \
  "https://unpkg.com/pmtiles@${PMTILES_VERSION}/dist/pmtiles.js"
do
  curl --fail --remote-name --output-dir ./out/demo_vendor "$src"
done
