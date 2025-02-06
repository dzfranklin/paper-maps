#!/usr/bin/env -S deno run --allow-all

import {
    assertDefined,
    assertString,
    browserContext,
    cached,
    checkFeature,
    cleanPlaintextWhitespace,
    downloadDOM,
    HTML2Text,
    isoTimestamp,
    log,
    NDJSONReader,
    sanitizeDescriptionHTML,
    sleep,
} from "../../util.ts";

// OS has maps covering the whole UK, I don't expect the list of maps to change for a while. Scraping it takes a few
// thousand requests, so I've split that into a separate script scrape_whichosmap.js. However, this script re-fetches
// the metadata in case of updates.

const desiredSeries = [
    "OS Explorer",
    "OS Landranger",
    "OS Pathfinder Circular Walks",
    "OS Short Walks Made Easy",
    "OS Pathfinder Short Walks",
    "OS Pathfinder City Walks",
];

/*
- 403 OS Explorer maps (https://shop.ordnancesurvey.co.uk/map-of-complete-set-of-os-explorer-maps)
- 204 OS Landranger maps (https://shop.ordnancesurvey.co.uk/map-of-complete-set-of-os-landranger-maps/)
 */
const expectedMinimumFeatureCount = 607;

const browser = await browserContext();
const page = await browser.newPage();

const html2text = new HTML2Text();

const assembleTimestamp = isoTimestamp();

const scrapeReader = await NDJSONReader.open("./whichosmap_results.ndjson", 2048);
const scrapeHeader = await scrapeReader.read();
const scrapeTimestamp = isoTimestamp(new Date(scrapeHeader.scrapeStartTimestamp));

async function assembleEntry(isbn, scrapeEntry) {
    let entryUpdateTimestamp = assembleTimestamp;

    const searchPageURL =
        "https://shop.ordnancesurvey.co.uk/search.php?search_query=" + isbn;
    const productLinks = await cached(searchPageURL, async () => {
        if (isbn === "9781780590370") {
            return ["https://shop.ordnancesurvey.co.uk/more-lake-district-walks-guidebook/"];
        }

        await sleep(1);
        const start = performance.now();

        await page.goto(searchPageURL, {waitUntil: "domcontentloaded"});

        const linksLoc = page.locator("a[data-testid=product-link]");
        try {
            await linksLoc.waitFor({state: "attached"});
        } catch (err) {
            throw new Error(`failed to find product links on ${searchPageURL}: ${err}`);
        }
        const hrefs = await Promise.all(
            (await linksLoc.all()).map((l) => l.evaluate((l) => l.href)),
        );
        log(
            `searching ${searchPageURL} took ${
                Math.round((performance.now() - start) / 100) / 10
            }s`,
        );
        return hrefs;
    });
    if (productLinks.length !== 1) {
        throw new Error("expected 1 product link");
    }
    const productURL = productLinks[0];

    const productPage = await downloadDOM(productURL);

    let whichosmapScript = productPage.querySelector("script[src^='https://v2.whichosmap.co.uk/js/embed.js?key=']");
    if (!whichosmapScript) {
        // guidebooks don't have the whichosmap embed as of Feb 2025
        const pageWithScript = await downloadDOM('https://shop.ordnancesurvey.co.uk/map-of-campsie-fells/');
        whichosmapScript = pageWithScript.querySelector("script[src^='https://v2.whichosmap.co.uk/js/embed.js?key=']");
    }
    const whichosmapToken = whichosmapScript.src.match(/key=([^&]+)/)[1];

    let sku;
    for (const script of productPage.querySelectorAll("script[type='application/ld+json']")) {
        const ldText = script.textContent;
        const ld = JSON.parse(ldText.replaceAll('\n', ' ')); // some pages have improperly escaped html in the json-ld as of Feb 2025
        if ('sku' in ld) {
            sku = ld.sku;
            break;
        }
    }
    if (!sku) throw new Error("expected sku in json-ld on product page");

    const whichosmapSearch = await cached(`https://api.whichosmap.co.uk/search?term=${encodeURIComponent(sku)}`, async () => {
        await sleep(1);
        const url = `https://api.whichosmap.co.uk/search?api_token=${whichosmapToken}&term=${encodeURIComponent(sku)}`;
        log(`Requesting ${url}`);
        const resp = await fetch(url, {
            redirect: "follow",
            method: "GET",
            headers: {
                accept: "application/json",
                origin: "https://shop.ordnancesurvey.co.uk",
                referer: "https://shop.ordnancesurvey.co.uk/",
                "user-agent": "github.com/dzfranklin/paper-maps (daniel@danielzfranklin.org)"
            },
        });
        if (!resp.ok) {
            console.log("Failed to fetch", resp.status);
            console.log(await resp.text());
            throw new Error("Fetch failed: " + resp.status);
        }
        return await resp.json();
    });
    let whichosmapEntry;
    if (whichosmapSearch.data.length === 0) {
        log(`whichosmap search for sku ${sku} returned no results, using entry from scrape`);
        whichosmapEntry = scrapeEntry;
        entryUpdateTimestamp = scrapeTimestamp;
    } else if (whichosmapSearch.data.length > 1) {
        throw new Error("unexpected: more than one result from whichosmap search");
    } else {
        whichosmapEntry = whichosmapSearch.data[0];
    }

    const whichosmapVariant = whichosmapEntry.variants.find(v => v.isbn === isbn);
    if (!whichosmapVariant) throw new Error("unexpected whichosmap entry");

    const galleryLinks = productPage.querySelectorAll(
        "a[data-image-gallery-zoom-image-url]",
    );
    const images = Array.from(galleryLinks).map((l) =>
        new URL(assertString(l.getAttribute("data-image-gallery-zoom-image-url")), productURL).href
    );

    const descriptionHTML = sanitizeDescriptionHTML(productPage.querySelector(".product__description").innerHTML, productURL);
    const descriptionText = cleanPlaintextWhitespace(await html2text.process(descriptionHTML));

    const sheetNumber = assertDefined(whichosmapEntry.full_sheet_number).toString(); // Either a number or a string

    return {
        type: "Feature",
        geometry: whichosmapEntry.geometry,
        properties: {
            last_updated: entryUpdateTimestamp,
            publisher: "Ordnance Survey",
            series: assertString(whichosmapVariant.series),
            color: assertString(whichosmapVariant.colour),
            isbn: assertString(whichosmapVariant.isbn),
            url: assertString(productURL),
            title: sheetNumber + " " + assertString(whichosmapEntry.title),
            short_title: sheetNumber,
            icon: "https://plantopo-storage.b-cdn.net/paper-maps/publisher-icons/os.png",
            thumbnail: assertString(whichosmapVariant.cover.thumbnail),
            images: images,
            description: assertString(descriptionText),
            description_html: assertString(descriptionHTML),
        },
    };
}

const out = [];
for await (const scrapeEntry of scrapeReader) {
    let isbn = null;
    for (const variant of scrapeEntry.variants) {
        if (desiredSeries.includes(variant.series)) {
            isbn = variant.isbn;
            break;
        }
    }
    if (isbn === null) {
        console.log(
            `Skipping ${scrapeEntry.title} (${
                scrapeEntry.variants.map((v) => v.series).join(", ")
            }) as no variant in desired series`,
        );
        continue;
    }

    const feature = await assembleEntry(isbn, scrapeEntry);
    checkFeature(feature);
    out.push(feature);
}

scrapeReader.close();
await browser.close();
await html2text.close();

if (out.length < expectedMinimumFeatureCount) {
    throw new Error(
        `Expected at least ${expectedMinimumFeatureCount} features, found ${out.length}`,
    );
}

const outJSON27700 = {
    type: "FeatureCollection",
    crs: {
        "type": "name",
        "properties": {
            "name": "EPSG:27700",
        },
    },
    features: out,
};
const outF27700 = Deno.makeTempFileSync({suffix: "_geojson.json"});
Deno.writeTextFileSync(outF27700, JSON.stringify(outJSON27700, null, 4));
log("Wrote", outF27700)

const outF4326 = Deno.makeTempFileSync({suffix: "_geojson.json"});
Deno.removeSync(outF4326);
const ogrCmd = new Deno.Command("ogr2ogr", {
    args: ["-t_srs", "epsg:4326", outF4326, outF27700],
});
const ogrRes = await (await ogrCmd.spawn()).output();
if (!ogrRes.success) {
    throw new Error("ogr2ogr failed");
}
log("Wrote", outF4326, "with ogr2ogr");

const outJSON4326 = JSON.parse(Deno.readTextFileSync(outF4326));

Deno.writeTextFileSync("./geojson.json", JSON.stringify(outJSON4326, null, 4));
log("Wrote ./geojson.json");

Deno.removeSync(outF27700);
Deno.removeSync(outF4326);
