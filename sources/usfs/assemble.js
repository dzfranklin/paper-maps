#!/usr/bin/env -S deno run --allow-all

const raw = JSON.parse(await Deno.readTextFile("./raw.json"));

const features = [];
for (const f of raw.features) {
    const {quad_name, secoord} = f.properties;
    features.push({
        type: "Feature",
        geometry: f.geometry,
        properties: {
            publisher: "US Forest Service",
            title: quad_name,
            icon: "https://plantopo-storage.b-cdn.net/paper-maps/images/publisher_icons/usfs.png",
            series: "FSTopo",
            color: "#00783c",
            url: `https://data.fs.usda.gov/geodata/rastergateway/downloadMap.php?mapID=${secoord}&mapType=pdf&seriesType=FSTopo`,
            // TODO: Once I start hosting images put a downsampled copy in the images
        }
    })
}

const out = {type: "FeatureCollection", features};
await Deno.writeTextFile("./geojson.json", JSON.stringify(out, null, 4));
