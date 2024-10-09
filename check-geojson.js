#!/usr/bin/env -S deno run --allow-all
import { check } from "npm:@placemarkio/check-geojson"
const contents = await Deno.readTextFile(Deno.args[0]);
check(contents);
console.log('JSON is valid');
