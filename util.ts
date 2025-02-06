import {existsSync} from "https://deno.land/std@0.224.0/fs/mod.ts";
import {writeAllSync} from "https://deno.land/std@0.224.0/io/write_all.ts";
import playwright from "npm:playwright@1.50.1";
import {JSDOM} from "npm:jsdom@26.0.0";
import geojsonCheck from "npm:@placemarkio/check-geojson@0.1.12";
import sanitizeHTML from "npm:sanitize-html@2.14.0";
import {MapFeature, MapFeatureCollection, mapFeatureCollectionSchema, mapFeatureSchema,} from "./schema.ts";
import {BufReader, BufWriter} from "https://deno.land/std@0.140.0/io/buffer.ts";
import type {Reader, Writer} from "https://deno.land/std@0.224.0/io/types.ts";

export { JSDOM, mapFeatureCollectionSchema, mapFeatureSchema };
export type { MapFeature, MapFeatureCollection };

export const userAgent =
  "github.com/dzfranklin/paper-maps (daniel@danielzfranklin.org)";

export function assertString(v: unknown): string {
  if (typeof v !== "string") {
    throw new Error("expected string, got: " + v);
  }
  return v;
}

export function assertDefined(v: unknown): unknown {
  if (v === undefined) {
    throw new Error("unexpected undefined");
  }
  return v;
}

export function isoTimestamp(d?: Date) {
  if (!d) d = new Date();
  return d.toISOString().replace(/\.\d+Z$/, "Z");
}

export type ClosableWriter = Writer & { close(): void };
export type ClosableReader = Reader & { close(): void };

export class NDJSONWriter {
  private _w: ClosableWriter | null;
  private _b: BufWriter | null;
  private _te = new TextEncoder();

  constructor(writer: ClosableWriter) {
    this._w = writer;
    this._b = BufWriter.create(this._w);
  }

  static async open(path: string) {
    const f = await Deno.open(path, {
      write: true,
      create: true,
      truncate: true,
    });
    return new NDJSONWriter(f);
  }

  async close() {
    await this._b?.flush();
    this._b = null;

    this._w?.close();
    this._w = null;
  }

  async flush() {
    if (this._b === null) throw new Error("NDJSONWriter closed");
    await this._b.flush();
  }

  async write(value: unknown) {
    if (this._b === null) throw new Error("NDJSONWriter closed");
    const s = JSON.stringify(value) + "\n";
    await this._b.write(this._te.encode(s));
  }
}

export class NDJSONReader {
  private _r: ClosableReader | null;
  private _b: BufReader | null;

  static DEFAULT_BUFFER_SIZE = 10 * 1024;

  static EOF = class extends Error {
    constructor() {
      super("EOF");
    }
  };

  constructor(
    reader: ClosableReader,
    size: number = NDJSONReader.DEFAULT_BUFFER_SIZE,
  ) {
    this._r = reader;
    this._b = BufReader.create(this._r, size);
  }

  static async open(
    path: string,
    size: number = NDJSONReader.DEFAULT_BUFFER_SIZE,
  ) {
    const f = await Deno.open(path);
    return new NDJSONReader(f);
  }

  close() {
    this._r?.close();
    this._r = null;
    this._b = null;
  }

  async read(): Promise<unknown> {
    if (this._b === null) throw new Error("NDJSONReader closed");
    const line = await this._b.readString("\n");
    if (line === null || line.trim().length === 0) {
      throw new NDJSONReader.EOF();
    }
    return JSON.parse(line);
  }

  async *[Symbol.asyncIterator]() {
    while (true) {
      try {
        yield await this.read();
      } catch (err) {
        if (err instanceof NDJSONReader.EOF) break;
        throw err;
      }
    }
  }
}

export function check(fc: MapFeatureCollection) {
  mapFeatureCollectionSchema.parse(fc);
  geojsonCheck.check(JSON.stringify(fc));
}

export function checkFeature(f: MapFeature) {
  try {
    mapFeatureSchema.parse(f);
    geojsonCheck.check(JSON.stringify(f));
  } catch (err) {
    let s = JSON.stringify(f, null, 2);

    const f2 = JSON.parse(s);
    if ("geometry" in f2 && "coordinates" in f2.geometry) {
      f2.geometry.coordinates = "__COORDS_TOKEN_REPLACEME__";
      s = JSON.stringify(f2, null, 2).replace(
        '"__COORDS_TOKEN_REPLACEME__"',
        JSON.stringify(f?.geometry?.coordinates),
      );
    }

    log("invalid feature: " + s);
    throw err;
  }
}

export function ensureCoordinates2D(geom: any) {
  if ("coordinates" in geom) {
    return {
      ...geom,
      coordinates: _makeCoordinates2D(geom.coordinates),
    };
  } else {
    throw new Error("unexpected feature shape");
  }
}

function _makeCoordinates2D(cs: any): any {
  if (Array.isArray(cs) && cs.every(Array.isArray)) {
    return cs.map(_makeCoordinates2D);
  } else if (
    Array.isArray(cs) && cs.length >= 2 &&
    cs.every((v) => typeof v === "number")
  ) {
    return [cs[0], cs[1]];
  } else {
    throw new Error("invalid coordinates");
  }
}

const textEncoder = new TextEncoder();

export function log(...args: unknown[]) {
  const msg = args.join(" ") + "\n";
  writeAllSync(Deno.stderr, textEncoder.encode(msg));
}

export function sleep(secs: number) {
  return new Promise((resolve) => setTimeout(resolve, secs * 1000));
}

export async function download(src: string, dst: string): Promise<void> {
  if (existsSync(dst)) {
    return;
  }

  mkdirP("./cache");

  let notFoundCache = [];
  if (existsSync("./.cache/notfound.json")) {
    notFoundCache = JSON.parse(
      await Deno.readTextFile("./.cache/notfound.json"),
    );
  }
  if (notFoundCache.includes(src)) {
    throw new Error("src in not found cache: " + src);
  }

  log(`Downloading ${src} -> ${dst}`);
  await sleep(1);

  const resp = await fetch(src, { headers: { "User-Agent": userAgent } });
  if (resp.status === 404) {
    await Deno.writeTextFile(
      "./.cache/notfound.json",
      JSON.stringify([...notFoundCache, src]),
    );
  }
  if (!resp.ok) {
    throw new Error("Fetch failed: " + resp.status);
  }

  const data = await resp.arrayBuffer();
  await Deno.writeFile(dst, new Uint8Array(data));
}

export async function downloadText(src: string): Promise<string> {
  const url = new URL(src);

  let key = encodeURIComponent(src);
  if (key.length > 100) {
    const digest = await crypto.subtle.digest(
      "SHA-256",
      textEncoder.encode(src),
    );
    const hexDigest = Array.from(new Uint8Array(digest)).map((byte) =>
      byte.toString(16).padStart(2, "0")
    ).join("");
    key = url.hostname + "+" + hexDigest;
  }

  mkdirP(".cache");
  await download(src, ".cache/" + key);
  return await Deno.readTextFile(".cache/" + key);
}

export async function downloadJSON(src: string): Promise<unknown> {
  const text = await downloadText(src);
  return JSON.parse(text);
}

export async function downloadDOM(src: string): Promise<JSDOM.Document> {
  const html = await downloadText(src);
  return new JSDOM(html, { url: src }).window.document;
}

export async function cached<T>(key: string, fn: () => Promise<T>): Promise<T> {
  mkdirP(".cache");
  const path = ".cache/" + encodeURIComponent(key);
  if (existsSync(path)) {
    return JSON.parse(await Deno.readTextFile(path));
  }
  const value = await fn();
  await Deno.writeTextFile(path, JSON.stringify(value));
  return value;
}

export function mkdirP(dir: string) {
  if (!existsSync(dir)) {
    Deno.mkdirSync(dir, { recursive: true });
  }
}

let browser: playwright.Browser | null = null;
let browserContexts = 0;
export async function browserContext(): Promise<playwright.BrowserContext> {
  if (!browser) {
    log("Launching headless chromium");
    browser = await playwright.chromium.launch();
    browserContexts = 0;
  }

  const ctx = await browser.newContext({ userAgent });
  const _close = ctx.close.bind(ctx);
  ctx.close = async () => {
    await _close();

    browserContexts--;
    if (browserContexts === 0 && browser !== null) {
      const closingBrowser = browser;
      browser = null;
      await closingBrowser.close();
    }
  };

  browserContexts++;
  return ctx;
}

export class HTML2Text {
  private _ctx: Promise<playwright.BrowserContext> | null;
  private _page: Promise<playwright.Page> | null;

  constructor() {
    this._ctx = browserContext();
    this._page = this._ctx.then((ctx) => ctx.newPage());
  }

  async close() {
    if (this._ctx === null) {
      return;
    }
    const prevCtx = this._ctx;
    this._ctx = null;
    this._page = null;
    await (await prevCtx).close();
  }

  async process(html: string): Promise<string> {
    const page = await this._page;
    if (!page) throw new Error("HTML2Text closed");

    await page.goto("about:blank");
    await page.setContent(html);
    return await page.innerText("body");
  }
}

export function sanitizeDescriptionHTML(html: string, baseURL: string): string {
  {
    const dom = new JSDOM(html, { url: baseURL }).window.document;
    if (
      dom.body.childNodes.length === 1 && dom.body.childNodes[0].tagName === "P"
    ) {
      html = dom.body.childNodes[0].innerHTML;
    }
  }

  return sanitizeHTML(html, {
    allowedTags: ["b", "i", "em", "strong", "br", "p", "a", "span", "img"],
    allowedAttributes: {
      "a": ["href"],
      "img": ["src", "alt"],
    },
    transformTags: {
      "a": (tagName: string, attribs: Record<string, string>) => {
        if (attribs.href) {
          attribs = { ...attribs, href: new URL(attribs.href, baseURL).href };
        }
        return {
          tagName,
          attribs,
        };
      },
      "img": (tagName: string, attribs: Record<string, string>) => {
        if (attribs.src) {
          attribs = { ...attribs, src: new URL(attribs.src, baseURL).href };
        }
        return {
          tagName,
          attribs,
        };
      },
    },
  });
}

export function cleanPlaintextWhitespace(s: string): string {
  // remove runs of more than two newline characters (each possibly with surrounding whitespace)
  s = s.replace(
    /((?:[\r\t\f\v \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]*\n[\r\t\f\v \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]*){2})(?:[\r\t\f\v \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]*\n[\r\t\f\v \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]*)+/gm,
    "$1",
  );
  // replace runs of more than one non-newline whitespace characters
  s = s.replace(
    /([\r\t\f\v \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff])[\r\t\f\v \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+/g,
    "$1",
  );
  s = s.trim();
  return s;
}
