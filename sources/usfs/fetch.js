#!/usr/bin/env -S deno run --allow-all

const endpoint = 'https://apps.fs.usda.gov/fsgisx05/rest/services/wo_nfs_gtac/gtac_fstopo_index/MapServer/dynamicLayer/query';
const where = encodeURIComponent(`vintage > 0`);
const outFields = encodeURIComponent(`quad_name,secoord`);
const layer = encodeURIComponent(`{"source":{"type":"mapLayer","mapLayerId":0}}`)
const resultRecordCount = 2000;

let resultOffset = 0;
let features = [];
while (true) {
    await new Promise(resolve => setTimeout(resolve, 5000));

    const resp = await fetch(`${endpoint}?f=geojson&where=${where}&returnGeometry=true&outFields=${outFields}&layer=${layer}&resultRecordCount=${resultRecordCount}&resultOffset=${resultOffset}`)
    if (resp.status !== 200) {
        throw new Error('bad status: '+resp.status);
    }

    const data = await resp.json();
    features.push(...data.features);
    console.log(`Downloaded features ${resultOffset} - ${resultOffset + resultRecordCount} (now ${features.length} in total) [latest ${features.at(-1)?.properties?.quad_name}]`)

    if (data.features.length < resultRecordCount) {
        break
    }
    resultOffset += data.features.length;
}

await Deno.writeTextFile("raw.json", JSON.stringify({type: "FeatureCollection", features}));
