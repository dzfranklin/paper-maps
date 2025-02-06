#!/usr/bin/env -S deno run --allow-all

import {check, checkFeature, downloadJSON, isoTimestamp} from "../../util.ts";

const endpoint = 'https://apps.fs.usda.gov/fsgisx05/rest/services/wo_nfs_gtac/gtac_fstopo_index/MapServer/dynamicLayer/query';
const where = encodeURIComponent(`vintage > 0`);
const outFields = encodeURIComponent(`quad_name,secoord`);
const layer = encodeURIComponent(`{"source":{"type":"mapLayer","mapLayerId":0}}`)
const resultRecordCount = 2000;
const expectedMinCount = 11_500;

const updateTimestamp = isoTimestamp();

let resultOffset = 0;
let rawFeatures = [];
while (true) {
    const data = await downloadJSON(`${endpoint}?f=geojson&where=${where}&returnGeometry=true&outFields=${outFields}&layer=${layer}&resultRecordCount=${resultRecordCount}&resultOffset=${resultOffset}`);

    rawFeatures.push(...data.features);
    console.log(`Downloaded features ${resultOffset} - ${resultOffset + resultRecordCount} (now ${rawFeatures.length} in total) [latest ${rawFeatures.at(-1)?.properties?.quad_name}]`)

    if (data.features.length < resultRecordCount) {
        break
    }
    resultOffset += data.features.length;
}
if (rawFeatures.length < expectedMinCount) {
    throw new Error(`Expected at least ${expectedMinCount} features, found ${rawFeatures.length}`);
}

const features = [];
for (const raw of rawFeatures) {
    const f = {
        type: "Feature",
        geometry: raw.geometry,
        properties: {
            last_updated: updateTimestamp,
            publisher: "US Forest Service",
            title: raw.properties.quad_name,
            icon: "https://plantopo-storage.b-cdn.net/paper-maps/publisher-icons/usfs.png",
            series: "FSTopo",
            color: "#00783c",
            url: `https://data.fs.usda.gov/geodata/rastergateway/downloadMap.php?mapID=${raw.properties.secoord}&mapType=pdf&seriesType=FSTopo`,
        }
    };
    checkFeature(f);
    features.push(f);
}

const out = {type: "FeatureCollection", features};
check(out);

await Deno.writeTextFile("./geojson.json", JSON.stringify(out, null, 4));
