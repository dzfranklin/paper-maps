#!/usr/bin/env -S deno run --allow-all

import {existsSync} from "https://deno.land/std@0.224.0/fs/mod.ts";
import {writeAllSync} from "https://deno.land/std@0.224.0/io/write_all.ts";
import rewind from "npm:@mapbox/geojson-rewind";
import {check} from "npm:@placemarkio/check-geojson@0.1.12";
import * as tj from "npm:@tmcw/togeojson@6.0.1";
import {DOMParser} from "npm:xmldom@0.6.0";

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

if (!existsSync(".cache")) {
    await Deno.mkdir(".cache");
}

if (!existsSync(".cache/data.js")) {
    console.log("Requesting data.js");
    const data = await (await fetch("https://www.harveymaps.co.uk/acatalog/finder_data/data.js")).text();
    await Deno.writeTextFile(".cache/data.js", data);
}
const rawData = JSON.parse(await Deno.readTextFile(".cache/data.js"));

const layerFilter = [
    "Superwalker (1:25,000)",
    "Ultramap (1:40,000)",
    "British Mountain Map (1:40,000)",
    "Trail Map (1:40,000)",
    "Outdoor Atlas",
    "Cycle Touring maps",
    "Off Road Cycling maps",
];

const layerColors = {
    "Superwalker (1:25,000)": "#c80739",
    "Ultramap (1:40,000)": "#fdc800",
    "British Mountain Map (1:40,000)": "#e42849",
    "Trail Map (1:40,000)": "#5a317e",
    "Outdoor Atlas": "#00918e",
    "Cycle Touring maps": "#42a534",
    "Off Road Cycling maps": "#038559",
}

async function download(src, dst) {
    if (existsSync(dst)) {
        return
    }

    let notFoundCache = [];
    try {
        notFoundCache = JSON.parse(await Deno.readTextFile("./.cache/notfound.json"));
    } catch (err) {
    }
    if (notFoundCache.includes(src)) {
        throw new Error("src in not found cache: " + src);
    }

    log(`Downloading ${src}->${dst}`);
    await sleep(1);

    const resp = await fetch(src);
    if (resp.status === 404) {
        await Deno.writeTextFile("./.cache/notfound.json", JSON.stringify([...notFoundCache, src]));
    }
    if (!resp.ok) {
        throw new Error("Fetch failed: " + resp.status);
    }

    const data = await resp.arrayBuffer();
    await Deno.writeFile(dst, new Uint8Array(data));
}

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

        if (a.HYPERLINK === '') {
            log('Skipping feature with empty hyperlink', layer.name, title);
            continue;
        }

        let purchaseURL = a.HYPERLINK
        if (purchaseURL.startsWith("http://")) {
            purchaseURL = purchaseURL.replace("http://", "https://");
        }
        if (!purchaseURL.startsWith("https://")) {
            purchaseURL = "https://www.harveymaps.co.uk/acatalog/" + purchaseURL;
        }

        const prodCode = a.PROD_CODE ?? a.PRODUCT_CODE;

        if (prodCode === 'YHWRCTC' || prodCode === 'YHWROF' || prodCode === 'YHWRWA1') {
            log("Skipping map that is combination of other maps", layer.name, title);
            continue;
        }

        const color = layerColors[layer.name];
        if (!color) {
            throw new Error("missing color for " + layer.name + " " + title);
        }

        let downloadedImg = false;
        for (const ext of ["jpg", "gif"]) {
            const src = "https://www.harveymaps.co.uk/acatalog/" + prodCode + "." + ext;
            const dst = "images/" + prodCode + "_front." + ext;
            try {
                await download(src, dst);
                downloadedImg = true;
                break
            } catch {
            }
        }
        if (!downloadedImg) {
            log("Failed to fetch any image, skipping layer", layer.name, title);
            continue;
        }

        let coveragePageSrc = "https://www.harveymaps.co.uk/acatalog/coverage_" + prodCode + ".html";
        if (prodCode === "YHSWMU") {
            // Two maps in one. See https://harveymaps.co.uk/acatalog/Mull--Iona-and-Ulva-YHSWMU.html
            coveragePageSrc = "https://harveymaps.co.uk/acatalog/coverage_YHSWMU55.html";
        } else if (prodCode === "YHSWDAN") {
            coveragePageSrc = "https://www.harveymaps.co.uk/acatalog/coverage_YHSWDAN2.html";
        } else if (prodCode === "YHSWDAS") {
            coveragePageSrc = "https://www.harveymaps.co.uk/acatalog/coverage_YHSWDAS2.html"
        }

        const coveragePageFile = ".cache/coverage_" + prodCode + ".html";
        await download(coveragePageSrc, coveragePageFile);

        let coverageLayerURL;
        if (prodCode === "YHULAR" || prodCode === "YHSWAR") {
            coverageLayerURL = "http://www.harveymaps.co.uk/acatalog/overlays/sw_arran.kml";
        } else if (prodCode === "YHWRSH") {
            coverageLayerURL = "http://www.harveymaps.co.uk/acatalog/overlays/wr_shropshire_polygon.kml";
        } else {
            const coveragePageHTML = await Deno.readTextFile(coveragePageFile);
            const coverageLayerMatches = Array.from(coveragePageHTML.matchAll(/KmlLayer\('(.*)'\)/g));
            if (coverageLayerMatches.length === 0) throw new Error("expected a KmlLayer in " + coveragePageFile);
            if (coverageLayerMatches.length > 1) throw new Error("more than one KmlLayer currently unsupported: " + coveragePageFile);
            coverageLayerURL = coverageLayerMatches[0][1];
        }
        const coverageLayerFile = ".cache/coverage_" + prodCode + ".kml";
        try {
            await download(coverageLayerURL, coverageLayerFile);
        } catch (err) {
            log("Failed to download coverage layer, skipping", coveragePageSrc, purchaseURL, err);
            continue
        }

        const kmlDOM = new DOMParser().parseFromString(await Deno.readTextFile(coverageLayerFile));
        const coverageGJ = tj.kml(kmlDOM);
        if (coverageGJ.type !== "FeatureCollection") {
            throw new Error("expected a FeatureCollection in " + coverageLayerFile);
        }

        let geometry;
        if (coverageGJ.features.length === 1) {
            geometry = rewind(coverageGJ.features[0]).geometry;
        } else if (coverageGJ.features.length > 1) {
            if (coverageGJ.features.every(f => f.geometry.type === 'Polygon')) {
                geometry = {
                    type: 'MultiPolygon',
                    coordinates: coverageGJ.features.map(f => rewind(f).geometry.coordinates),
                };
            } else if (coverageGJ.features.every(f => f.geometry.type === 'LineString')) {
                geometry = {
                    type: 'MultiLineString',
                    coordinates: coverageGJ.features.map(f => rewind(f).geometry.coordinates),
                }
            } else {
                log(coverageGJ.features.map(f => f.geometry.type));
                throw new Error("multiple features that aren't all Polygons are not supported: " + coverageLayerFile);
            }
        } else {
            throw new Error("no features in " + coverageLayerFile);
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

const fc = {
    type: "FeatureCollection",
    features: outFeatures,
};

for (const f of fc.features) {
    if (f.geometry === null) {
        throw new Error("null geometry: " + JSON.stringify(f))
    }
}
check(JSON.stringify(fc));
log("validated output FeatureCollection");

await Deno.writeTextFile("./geojson.json", JSON.stringify(fc, null, 4));
log("wrote ./geojson.json");

let thumbCount = 0;
for await (const entry of Deno.readDir("./images")) {
    if (!entry.isFile) continue;

    if (entry.name.endsWith("_front.jpg")) {
        const baseName = entry.name.replace(/_front.jpg$/, "");

        const outPath = "./images/" + baseName + "_thumbnail.jpg";
        if (existsSync(outPath)) {
            continue;
        }

        const cmd = new Deno.Command("magick", {
            args: [
                "./images/" + entry.name,
                "-strip",
                "-resize", "x250",
                outPath,
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
