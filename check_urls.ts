#!/usr/bin/env -S deno run --allow-all

import {JSDOM, log, MapFeature, mapFeatureCollectionSchema, sleep, userAgent,} from "./util.ts";

const gjF = Deno.openSync("./out/paper_maps_geojson.json.gz");
const unzipper = new DecompressionStream("gzip");
const gjResp = new Response(gjF.readable.pipeThrough(unzipper));
const gj = mapFeatureCollectionSchema.parse(JSON.parse(await gjResp.text()));
log("Checking", gj.features.length, "features");

const urlsByOrigin = new Map<string, Map<string, MapFeature[]>>();

for (const f of gj.features) {
  const p = f.properties;

  const candidates = [p.url, p.icon, p.thumbnail];
  if (p.images !== undefined) candidates.push(...p.images);

  if (p.description_html !== undefined) {
    const descriptionDOM = new JSDOM(p.description_html).window.document;
    for (const a of descriptionDOM.querySelectorAll("a")) {
      if (a.hasAttribute("href")) {
        candidates.push(a.getAttribute("href"));
      }
    }
    for (const img of descriptionDOM.querySelectorAll("img")) {
      if (img.hasAttribute("src")) {
        candidates.push(img.getAttribute("src"));
      }
    }
  }

  for (const candidate of candidates) {
    if (candidate !== undefined) {
      const u = new URL(candidate);
      const normalizedURL = u.toString();
      if (!urlsByOrigin.has(u.origin)) {
        urlsByOrigin.set(u.origin, new Map());
      }
      if (!urlsByOrigin.get(u.origin)!.has(normalizedURL)) {
        urlsByOrigin.get(u.origin)!.set(normalizedURL, []);
      }
      urlsByOrigin.get(u.origin)!.get(normalizedURL)!.push(f);
    }
  }
}

log(
  "Found",
  urlsByOrigin.size,
  "unique origins",
  "(" + Array.from(urlsByOrigin.keys()).join(", ") + ")",
  "and",
  urlsByOrigin.values().reduce((acc, m) => acc + m.size, 0),
  "unique urls",
);

const failureByOrigin = new Map<string, Set<string>>();

async function checkOrigin(origin: string, urls: Map<string, MapFeature[]>) {
  for (const url of urls.keys()) {
    await sleep(1);

    log("HEAD", url);
    const headRes = await fetch(url, {
      method: "HEAD",
      redirect: "follow",
      headers: { "User-Agent": userAgent },
    });
    if (headRes.ok) continue;
    log("HEAD not ok", url);

    log("GET", url);
    const getRes = await fetch(url, {
      method: "GET",
      redirect: "follow",
      headers: { "User-Agent": userAgent },
    });
    if (getRes.ok) continue;
    log("GET not ok", url);

    if (!failureByOrigin.has(origin)) failureByOrigin.set(origin, new Set());
    failureByOrigin.get(origin)!.add(url);
  }
}

await Promise.all(
  urlsByOrigin.entries().map(([origin, urls]) => checkOrigin(origin, urls)),
);

const totalFailures = failureByOrigin.values().reduce(
  (acc, m) => acc + m.size,
  0,
);
if (totalFailures > 0) {
  log("FAILURE", totalFailures, "urls are broken");
  for (const [origin, urls] of failureByOrigin.entries()) {
    log(origin);
    for (const url of urls) {
      const fs = urlsByOrigin.get(origin)!.get(url)!;
      let fnames = fs.map((f) =>
        f.properties.url ?? (f.properties.publisher + ":" + f.properties.title)
      ).join(", ");
      if (fnames.length > 1024) {
        fnames = fnames.slice(0, 1021) + "...";
      }
      log("  ", url, ":", fnames);
    }
  }
  Deno.exit(1);
} else {
  log("ALL OK");
}
