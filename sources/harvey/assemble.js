#!/usr/bin/env -S deno run --allow-all

import {existsSync} from "https://deno.land/std@0.224.0/fs/mod.ts";
import {writeAllSync} from "https://deno.land/std@0.224.0/io/write_all.ts";
import rewind from "npm:@mapbox/geojson-rewind";
import {check} from "npm:@placemarkio/check-geojson"

Deno.addSignalListener("SIGINT", () => {
    console.log("interrupted!");
    Deno.exit();
});

const logTextEncoder = new TextEncoder();

function log(...args) {
    const msg = args.join(" ") + "\n";
    writeAllSync(Deno.stderr, logTextEncoder.encode(msg));
}

const sleep = (s) => new Promise((resolve) => setTimeout(resolve, s * 1000));

if (!existsSync(".data.js.cache")) {
    console.log("Requesting data.js");
    const data = await (await fetch("https://www.harveymaps.co.uk/acatalog/finder_data/data.js")).text();
    await Deno.writeTextFile(".data.js.cache", data);
}
const rawData = JSON.parse(await Deno.readTextFile(".data.js.cache"));

const layerFilter = ["Superwalker (1:25,000)", "Ultramap (1:40,000)", "British Mountain Map (1:40,000)", "Trail Map (1:40,000)", "Outdoor Atlas", "Cycle Touring maps", "Off Road Cycling maps"];

const layerColors = {
    "Superwalker (1:25,000)": "#c80739",
    "Ultramap (1:40,000)": "#fdc800",
    "British Mountain Map (1:40,000)": "#e42849",
    "Trail Map (1:40,000)": "#e42849",
    "Outdoor Atlas": "#00918e",
    "Cycle Touring maps": "#42a534",
    "Off Road Cycling maps": "#038559",
}

async function download(src, dst) {
    if (existsSync(dst)) {
        return
    }

    log(`Downloading ${src}->${dst}`);
    await sleep(1);

    const resp = await fetch(src);
    if (!resp.ok) {
        throw new Error("Fetch failed: " + resp.status);
    }

    const data = await resp.arrayBuffer();
    await Deno.writeFile(dst, new Uint8Array(data));
}

// In EPSG:27700

const baseImgSize = 6400;
const baseImgXCenter = 243506.8680401177;
const baseImgYCenter = 544662.6429331194;
const baseImgScale = 220.12913124621824;

const baseLayerSize = 800;

const baseLayerScale = baseImgScale * (baseImgSize / baseLayerSize);
const baseLayerXOrigin = baseImgXCenter - (baseLayerSize / 2) * baseLayerScale;
const baseLayerYOrigin = baseImgYCenter + (baseLayerSize / 2) * baseLayerScale;

log("base layer origin", baseLayerXOrigin, baseLayerYOrigin);
log("base layer ullr",
    baseImgXCenter - (baseLayerSize / 2) * baseLayerScale, // ulx
    baseImgYCenter + (baseLayerSize / 2) * baseLayerScale, // uly
    baseImgXCenter + (baseLayerSize / 2) * baseLayerScale, // lrx
    baseImgYCenter - (baseLayerSize / 2) * baseLayerScale, // lry
);

function reproject(srcX, srcY) {
    return [srcX * baseLayerScale + baseLayerXOrigin, -1 * srcY * baseLayerScale + baseLayerYOrigin];
}

const skipList = [
    "YHSWTRW",
    "YHSWCR",
    "YHWRSD",
    "YHCMCCW", // encoded as a polygon when it should be a line
];

const outFeatures = [];
for (const layer of rawData.layers) {
    if (!layerFilter.includes(layer.name)) {
        log("Skipping", layer.name);
        continue;
    }

    log(`Processing ${layer.name} (${layer.features.length} features)`);
    for (const f of layer.features) {
        const a = f.attributes;

        const title = a.TITLE ?? a.NAME;

        let purchaseURL = a.HYPERLINK
        if (purchaseURL.startsWith("http://")) {
            purchaseURL = purchaseURL.replace("http://", "https://");
        }
        if (!purchaseURL.startsWith("https://")) {
            purchaseURL = "https://www.harveymaps.co.uk/acatalog/" + purchaseURL;
        }

        const prodCode = a.PROD_CODE ?? a.PRODUCT_CODE;
        if (skipList.includes(prodCode)) {
            log("Skipping,", layer.name, title);
            continue;
        }

        const color = layerColors[layer.name];
        if (!color) {
            throw new Error("missing color for " + layer.name + " " + title);
        }

        try {
            await download(
                "https://www.harveymaps.co.uk/acatalog/" + prodCode + ".jpg",
                "images/" + prodCode + "_front.jpg");
        } catch (err) {
            log("Failed to fetch image, skipping", layer.name, title, ": ", err);
            continue;
        }

        if (f.polygons && f.polylines) {
            throw new Error("Unimplemented");
        }
        let geometry;
        if (f.polygons) {
            const coordinates = f.polygons.map(p => p.coords
                .split(" ")
                .map(c => {
                    const xy = c
                        .split(",")
                        .map(n => parseFloat(n));
                    if (xy.length !== 2) {
                        throw new Error("Unimplemented");
                    }
                    return reproject(xy[0], xy[1]);
                })
            );

            for (const poly of coordinates) {
                const first = poly.at(0);
                const last = poly.at(-1);
                if (first[0] !== last[0] || first[1] !== last[1]) {
                    log("Fixing non-closed polygon", layer.name, title);
                    poly.push([first[0], first[1]]);
                }
            }

            if (coordinates.length === 1) {
                geometry = {
                    type: "Polygon",
                    coordinates,
                };
            } else {
                geometry = {type: "MultiPolygon", coordinates: []};
                for (const poly of coordinates) {
                    if (poly.length < 4) {
                        log("Skipping multipolygon component with less than four points in " + title)
                        continue
                    }
                    geometry.coordinates.push([poly]);
                }
            }
            geometry = rewind({type: "Feature", geometry}).geometry;
        } else if (f.polylines) {
            log("Skipping line map", layer.name, title);
            continue;
            const coordinates = f.polylines.map(p => p.coords
                .split(" ")
                .map(c => {
                    const xy = c
                        .split(",")
                        .map(n => parseFloat(n));
                    if (xy.length != 2) {
                        throw new Error("Unimplemented");
                    }
                    return reproject(xy[0], xy[1]);
                })
            );
            geometry = {
                type: "MultiLineString",
                coordinates,
            };
        } else {
            log("Missing geometry, skipping", layer.name, title);
            continue
        }

        const mapped = {
            "type": "Feature",
            "properties": {
                "publisher": "Harvey Maps",
                "series": layer.name,
                "color": color,
                "url": purchaseURL,
                "title": title,
                "icon": "https://plantopo-storage.b-cdn.net/paper-maps/images/publisher_icons/harvey.png",
                "thumbnail": "https://plantopo-storage.b-cdn.net/paper-maps/images/harvey/" + prodCode + "_thumbnail.jpg",
                "images": ["https://plantopo-storage.b-cdn.net/paper-maps/images/harvey/" + prodCode + "_front.jpg"],
            },
            "geometry": geometry,
        };
        outFeatures.push(mapped);
    }
}

const json27700 = {
    type: "FeatureCollection",
    crs: {
        type: "name",
        properties: {
            name: "urn:ogc:def:crs:EPSG::27700"
        }
    },
    features: outFeatures,
};

const out27700 = await Deno.makeTempFile({suffix: ".json"});
await Deno.writeTextFile(out27700, JSON.stringify(json27700));

const out4326 = await Deno.makeTempFile({suffix: ".json"});
await Deno.remove(out4326);

const ogr2ogrCmd = new Deno.Command("ogr2ogr", {
    args: ["-t_srs", "epsg:4326", "-if", "geojson", "-lco", "RFC7946=YES", out4326, out27700],
});
const res = await ogr2ogrCmd.output();
if (res.code !== 0) {
    const dec = new TextDecoder();
    const stderr = dec.decode(res.stderr);
    throw new Error("ogr2ogr failed: " + stderr);
}
log("reprojected json")

const json4326 = JSON.parse(await Deno.readTextFile(out4326));
delete json4326.name;

check(JSON.stringify(json4326));
log("validated json")

await Deno.writeTextFile("./geojson.json", JSON.stringify(json4326, null, 4));
log("wrote ./geojson.json");

let thumbCount = 0;
for await (const entry of Deno.readDir("./images")) {
    if (!entry.isFile) continue;

    if (entry.name.endsWith("_front.jpg")) {
        const baseName = entry.name.replace(/_front.jpg$/, "");

        const cmd = new Deno.Command("magick", {
            args: [
                "./images/" + entry.name,
                "-strip",
                "-resize", "x250",
                "./images/" + baseName + "_thumbnail.jpg"
            ]
        });
        const res = await cmd.output();
        if (res.code !== 0) {
            const dec = new TextDecoder();
            const stderr = dec.decode(res.stderr);
            throw new Error("magick failed: " + stderr);
        }
        thumbCount++;
    }
}
log("Generated", thumbCount, "thumbnails");

log("All done");
