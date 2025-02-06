#!/usr/bin/env -S deno --allow-all

import {checkFeature, log} from "./util.ts";

const publisherIcons = {
    "Harvey Maps": "https://plantopo-storage.b-cdn.net/paper-maps/publisher-icons/harvey.png",
    "Ordnance Survey": "https://plantopo-storage.b-cdn.net/paper-maps/publisher-icons/os.png",
    "Ordnance Survey of Northern Ireland": "https://plantopo-storage.b-cdn.net/paper-maps/publisher-icons/osni.png",
    "US Forest Service": "https://plantopo-storage.b-cdn.net/paper-maps/publisher-icons/usfs.png",
}

const attribution = Deno.readTextFileSync('./attribution.html').replaceAll('\n', '');

const td = new TextDecoder();

const fc = {type: "FeatureCollection", features: []};
const fByPublisher = {};
const publishers = {};
for (const sourceEntry of Deno.readDirSync("./sources")) {
    if (sourceEntry.isDirectory) {
        const gjPath = "./sources/" + sourceEntry.name + "/geojson.json";
        log("Reading", gjPath);
        const gj = JSON.parse(Deno.readTextFileSync(gjPath));

        if (gj.type !== "FeatureCollection") {
            throw new Error("Expected FeatureCollection, got " + gj.type);
        }

        for (const f of gj.features) {
            if (f.properties.short_title === undefined) {
                const title = f.properties.title;
                const truncationLength = 23;
                if (title.length <= truncationLength) {
                    f.properties.truncated_title = title;
                } else {
                    f.properties.truncated_title = title.slice(0, truncationLength - 3) + "...";
                }
            }

            checkFeature(f);

            const publisher = f.properties.publisher;
            if (!(publisher in publishers)) {
                const publisherIcon = publisherIcons[publisher];
                if (!publisherIcon) {
                    throw new Error("Publisher \"" + publisher + "\" not in publisherIcons");
                }

                publishers[publisher] = {
                    publisher: publisher,
                    icon: publisherIcon,
                    series: [],
                };
            }
            if (!publishers[publisher].series.includes(f.properties.series)) {
                publishers[publisher].series.push(f.properties.series);
            }

            fc.features.push(f);

            if (!(publisher in fByPublisher)) {
                fByPublisher[publisher] = [];
            }
            fByPublisher[publisher].push(f);
        }
    }
}

const publishersOut = "./out/publishers.json";
Deno.writeTextFileSync(publishersOut, JSON.stringify(publishers, null, 4));
log("Wrote", publishersOut);

const sampleFeatures = [];
const perPublisherSampleSize = 3;
for (const publisher of Object.keys(fByPublisher).sort()) {
    const publisherList = fByPublisher[publisher];

    if (publisherList.length < perPublisherSampleSize) {
        sampleFeatures.push(...publisherList);
    }

    const sampleIndices = new Set();
    while (sampleIndices.size < perPublisherSampleSize) {
        const i = Math.floor(Math.random() * publisherList.length);
        if (!sampleIndices.has(i)) sampleIndices.add(i);
    }

    for (const i of sampleIndices) {
        sampleFeatures.push(publisherList[i]);
    }
}
const sampleGJ = {type: "FeatureCollection", features: sampleFeatures};

const stubKey = Math.random().toString(36).substring(2);
const stubFor = i => `__STUB_${stubKey}_${i}__`;
const sampleGJStubGeoms = {
    ...sampleGJ,
    features: sampleGJ.features.map((f, i) => ({...f, geometry: {...f.geometry, coordinates: stubFor(i)}}))
};
let sampleJSON = JSON.stringify(sampleGJStubGeoms, null, 4);
for (let i = 0; i < sampleGJ.features.length; i++) {
    sampleJSON = sampleJSON.replace('"' + stubFor(i) + '"', JSON.stringify(sampleGJ.features[i].geometry));
}

const sampleOut = "./out/geojson_sample.json";
Deno.writeTextFileSync(sampleOut, sampleJSON);
log("Wrote", sampleOut);

const uncompressedGJ = Deno.makeTempFileSync({suffix: ".json"});
Deno.writeTextFileSync(uncompressedGJ, JSON.stringify(fc, null, 4));
log("Wrote", uncompressedGJ);

const gzipCmd = new Deno.Command("gzip", {
    args: ["--best", "--keep", uncompressedGJ],
    stderr: "piped",
});
const gzipRes = await (await gzipCmd.spawn()).output();
if (!gzipRes.success) {
    throw new Error("gzip failed: " + td.decode(gzipRes.stderr));
}
const gjOut = "./out/paper_maps_geojson.json.gz";
Deno.renameSync(uncompressedGJ + ".gz", gjOut);
log("Wrote", gjOut);

const pmtilesOut = "./out/paper_maps.pmtiles";
const tippecanoeCmd = new Deno.Command("tippecanoe", {
    args: [
        "--name", "Paper Maps",
        "--description", `Paper Maps generated ${new Date().toISOString()} by github.com/dzfranklin/paper-maps`,
        "--attribution", attribution,
        "--base-zoom=g",
        "-zg", "--extend-zooms-if-still-dropping",
        "--generate-ids",
        "--layer=default",
        "--no-tile-stats",
        "--output", pmtilesOut,
        "--force",
        uncompressedGJ,
    ],
    stderr: "piped",
});
const tippecanoeRes = await (await tippecanoeCmd.spawn()).output();
if (!tippecanoeRes.success) {
    throw new Error("tippecanoe failed: " + td.decode(tippecanoeRes.stderr));
}
log("Wrote", pmtilesOut);

Deno.removeSync(uncompressedGJ);
log("Removed", uncompressedGJ);

log("All done");
