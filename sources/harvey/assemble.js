#!/usr/bin/env -S deno run --allow-all

import rewind from "npm:@mapbox/geojson-rewind";
import * as tj from "npm:@tmcw/togeojson@6.0.1";
import {DOMParser as XMLDomParser} from "npm:xmldom@0.6.0";
import {
    check,
    checkFeature,
    cleanPlaintextWhitespace,
    downloadDOM,
    downloadText,
    ensureCoordinates2D,
    HTML2Text, isoTimestamp,
    log,
    sanitizeDescriptionHTML
} from '../../util.ts';

Deno.addSignalListener("SIGINT", () => {
    console.log("interrupted!");
    Deno.exit();
});

const rawData = JSON.parse(await downloadText("https://www.harveymaps.co.uk/acatalog/finder_data/data.js"));

const layerFilter = [
    "Superwalker (1:25,000)",
    "Ultramap (1:40,000)",
    "British Mountain Map (1:40,000)",
    "Trail Map (1:40,000)",
    "Outdoor Atlas"
    // there are very few of these and the data seems buggy. For ex the layers don't match the site organization
    // "Cycle Touring maps",
    // "Off Road Cycling maps",
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

const updateTimestamp = isoTimestamp();

const outFeatures = [];
const html2text = new HTML2Text();
for (const layer of rawData.layers) {
    if (!layerFilter.includes(layer.name)) {
        log("Skipping", layer.name);
        continue;
    }

    log(`Processing ${layer.name} (${layer.features.length} features)`);
    for (const f of layer.features) {
        try {
            const a = f.attributes;

            const title = a.TITLE ?? a.NAME;

            if (a.HYPERLINK === '') {
                log('Skipping feature with empty hyperlink', layer.name, title);
                continue;
            }

            const prodCode = a.PROD_CODE ?? a.PRODUCT_CODE;

            let purchaseURL = a.HYPERLINK
            if (purchaseURL.startsWith("http://")) {
                purchaseURL = purchaseURL.replace("http://", "https://");
            }
            if (!purchaseURL.startsWith("https://")) {
                purchaseURL = "https://www.harveymaps.co.uk/acatalog/" + purchaseURL;
            }
            if (purchaseURL === "https://www.harveymaps.co.uk/acatalog/An-Teallach-YHSWAT.html") {
                purchaseURL = "https://www.harveymaps.co.uk/acatalog/An-Teallach--Fisherfield---Letterewe-YHSWAT.html";
            }
            if (purchaseURL === "https://www.harveymaps.co.uk/acatalog/Yorkshire-Dales--Bentham-YHSWYDBE.html") {
                purchaseURL = "https://www.harveymaps.co.uk/acatalog/Yorkshire-Dales-Bentham-YHSWYBE.html";
            }
            if (prodCode === "YHULSU") {
                purchaseURL = purchaseURL.replace("YHULLM", "YHULSU");
            }
            if (purchaseURL === "https://www.harveymaps.co.uk/acatalog/Arochar-Alps-YHULAA.html") {
                purchaseURL = "https://www.harveymaps.co.uk/acatalog/Arrochar-Alps-YHULAA.html";
            }
            if (prodCode === "YHSPCL") {
                purchaseURL = "https://www.harveymaps.co.uk/acatalog/Clackmananshire-Walking---Cycling-map-YHSPCL.html";
            }
            if (prodCode === "YHOMYDN") {
                purchaseURL = "https://www.harveymaps.co.uk/acatalog/Dales-North-cycle-map-YHOMDN.html";
            }

            if (prodCode === 'YHWRCTC' || prodCode === 'YHWROF' || prodCode === 'YHWRWA1') {
                log("Skipping map that is combination of other maps", layer.name, title);
                continue;
            }
            if (prodCode === 'YHULDAS' || prodCode === 'YHULDAN') {
                log("Skipping map known to have a broken coverage map", layer.name, title);
                continue;
            }

            const color = layerColors[layer.name];
            if (!color) {
                throw new Error("missing color for " + layer.name + " " + title);
            }

            const purchasePage = await downloadDOM(purchaseURL);

            const images = [];
            const purchasePageImageCarouselLinks = purchasePage.querySelectorAll("a[data-zoom-id][data-image]");
            for (const link of purchasePageImageCarouselLinks) {
                images.push(URL.parse(link.getAttribute("data-image"), purchaseURL).href);
            }

            const homeSection = purchasePage.querySelector("#home");
            for (let i = 1; i <= 6; i++) {
                homeSection.querySelectorAll(`h${i}`).forEach(h => h.remove());
            }
            let descriptionHTML = sanitizeDescriptionHTML(homeSection.innerHTML, purchaseURL);

            let descriptionText = await html2text.process(descriptionHTML);

            descriptionText = descriptionText.replace(/[^.\n]+ click here\.?/g, "");
            descriptionText = descriptionText.replace(/Click here [^.\n]+\.?/g, "");
            descriptionText = cleanPlaintextWhitespace(descriptionText);

            let coveragePageSrc = "https://www.harveymaps.co.uk/acatalog/coverage_" + prodCode + ".html";
            if (prodCode === "YHSWMU") {
                // Two maps in one. See https://harveymaps.co.uk/acatalog/Mull--Iona-and-Ulva-YHSWMU.html
                coveragePageSrc = "https://harveymaps.co.uk/acatalog/coverage_YHSWMU55.html";
            } else if (prodCode === "YHSWDAN") {
                coveragePageSrc = "https://www.harveymaps.co.uk/acatalog/coverage_YHSWDAN2.html";
            } else if (prodCode === "YHSWDAS") {
                coveragePageSrc = "https://www.harveymaps.co.uk/acatalog/coverage_YHSWDAS2.html"
            }

            const coveragePageHTML = await downloadText(coveragePageSrc);

            let coverageLayerURL;
            if (prodCode === "YHULAR" || prodCode === "YHSWAR") {
                coverageLayerURL = "http://www.harveymaps.co.uk/acatalog/overlays/sw_arran.kml";
            } else if (prodCode === "YHWRSH") {
                coverageLayerURL = "http://www.harveymaps.co.uk/acatalog/overlays/wr_shropshire_polygon.kml";
            } else {
                const coverageLayerMatches = Array.from(coveragePageHTML.matchAll(/KmlLayer\('(.*)'\)/g));
                if (coverageLayerMatches.length === 0) throw new Error("expected a KmlLayer");
                if (coverageLayerMatches.length > 1) throw new Error("more than one KmlLayer currently unsupported");
                coverageLayerURL = coverageLayerMatches[0][1];
            }
            const coverageLayerText = await downloadText(coverageLayerURL);

            const kmlDOM = new XMLDomParser().parseFromString(coverageLayerText);
            let coverageGJ = tj.kml(kmlDOM);
            if (coverageGJ.type !== "FeatureCollection") {
                throw new Error("expected a FeatureCollection");
            }

            if (coverageGJ.features.length === 1 && coverageGJ.features[0].geometry.type === 'GeometryCollection') {
                coverageGJ = {
                    type: 'FeatureCollection',
                    features: coverageGJ.features[0].geometry.geometries.map(g => ({
                        ...coverageGJ.features[0],
                        geometry: g,
                    })),
                }
            }

            let geometry;
            if (coverageGJ.features.length === 1) {
                geometry = rewind(coverageGJ.features[0]).geometry;
            } else if (coverageGJ.features.length > 1) {
                if (coverageGJ.features.every(f => f.geometry?.type === 'Polygon')) {
                    geometry = {
                        type: 'MultiPolygon',
                        coordinates: coverageGJ.features.map(f => rewind(f).geometry.coordinates),
                    };
                } else if (coverageGJ.features.every(f => f.geometry?.type === 'LineString')) {
                    geometry = {
                        type: 'MultiLineString',
                        coordinates: coverageGJ.features.map(f => rewind(f).geometry.coordinates),
                    }
                } else {
                    log(JSON.stringify(coverageGJ.features));
                    throw new Error("multiple features that aren't all Polygons are not supported: " + coverageLayerFile);
                }
            } else {
                log(JSON.stringify(coverageGJ, null, 4))
                throw new Error("no features in " + coverageLayerFile);
            }

            geometry = ensureCoordinates2D(geometry);

            const mapped = {
                "type": "Feature",
                "properties": {
                    "last_updated": updateTimestamp,
                    "publisher": "Harvey Maps",
                    "series": layer.name,
                    "color": color,
                    "url": purchaseURL,
                    "title": title,
                    "icon": "https://plantopo-storage.b-cdn.net/paper-maps/publisher-icons/harvey.png",
                    "thumbnail": images.at(0),
                    "images": images,
                    "description": descriptionText,
                    "description_html": descriptionHTML,
                },
                "geometry": geometry,
            };
            checkFeature(mapped);
            outFeatures.push(mapped);
        } catch (err) {
            log("Failed to process", layer.name, JSON.stringify(f.attributes), err);
            throw err;
        }
    }
}
await html2text.close();

const fc = {
    type: "FeatureCollection",
    features: outFeatures,
};

for (const f of fc.features) {
    if (f.geometry === null) {
        throw new Error("null geometry: " + JSON.stringify(f))
    }
}
check(fc);
log("validated output FeatureCollection");

await Deno.writeTextFile("./geojson.json", JSON.stringify(fc, null, 4));
log("wrote ./geojson.json");

log("All done");
