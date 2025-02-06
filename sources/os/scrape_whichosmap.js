#!/usr/bin/env -S deno run --allow-all

import {downloadDOM, NDJSONWriter} from "../../util.ts";

const minX = 50_000;
const maxX = 660_000;
const minY = 8_000;
const maxY = 1_210_000;

const xStep = 20_000; // An explorer map is 95.2/4=23.8 km wide
const yStep = 30_000; // An explorer map is 127/4=31.75 km tall

const searchTerms = [];
for (let x = minX; x < maxX; x += xStep) {
    for (let y = minY; y < maxY; y += yStep) {
        searchTerms.push(`${x},${y}`);
    }
}

const sleep = (secs) => new Promise((resolve) => setTimeout(resolve, secs * 1000));

const homepageDOM = await downloadDOM("https://whichosmap.co.uk/");
const scriptElem = homepageDOM.querySelector('script[src^="https://whichosmap.co.uk/js/embed.js"]');
const apiToken = scriptElem.src.match(/key=([^&]+)/)[1];

const out = await NDJSONWriter.open("./whichosmap_results.ndjson");

const header = {
    scrapeStartTimestamp: new Date().toISOString(),
    parameters: {
        minX,
        maxX,
        minY,
        maxY,
        xStep,
        yStep,
    }
}
await out.write(header);

const seenEntries = new Set();
for (let termI = 0; termI < searchTerms.length; termI++) {
    const term = searchTerms[termI];
    console.log(`Requesting ${term}, term ${termI + 1}/${searchTerms.length} (${Math.round(termI / searchTerms.length * 1000) / 10}%)`);

    const resp = await fetch(`https://api.whichosmap.co.uk/search?api_token=${apiToken}&term=${encodeURIComponent(term)}`, {
        redirect: "follow",
        method: "GET",
        headers: {
            accept: "application/json",
            origin: "https://whichosmap.co.uk",
            referer: "https://whichosmap.co.uk/",
            "user-agent": "github.com/dzfranklin/paper-maps (daniel@danielzfranklin.org)"
        },
    });
    if (!resp.ok) {
        console.log("Failed to fetch", resp.status);
        console.log(await resp.text());
        throw new Error("Fetch failed: " + resp.status);
    }
    const respBody = await resp.json();

    for (const entry of respBody.data) {
        const key = entry.variants.map(v => v.isbn).join(",");
        if (!seenEntries.has(key)) {
            seenEntries.add(key);
            await out.write(entry);
        }
    }

    await sleep(1);
}

await out.close();
