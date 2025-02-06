import {z} from "npm:zod@3.24.1";
import geojsonCheck from "npm:@placemarkio/check-geojson@0.1.12";
import geojsonRewind from "npm:@mapbox/geojson-rewind@0.5.1";

const isoTimestampSchema = z.string().regex(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z/);

function superRefineCoordinates<T>(type: string) {
  return (val: T, ctx: z.RefinementCtx) => {
    const wrapper = {
      type: "Feature",
      properties: {},
      geometry: { type, coordinates: val },
    };
    for (const issue of geojsonCheck.getIssues(JSON.stringify(wrapper))) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: issue.message,
      });
    }
  };
}

function superRefineWindingOrder<T>(type: string) {
  return (val: T, ctx: z.RefinementCtx) => {
    const wrapper = {
      type: "Feature",
      properties: {},
      geometry: {type, coordinates: val},
    };
    geojsonRewind(wrapper);

    if (JSON.stringify(wrapper.geometry.coordinates) !== JSON.stringify(val)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "invalid winding order",
      });
    }
  };
}

const pointSchema = z.object({
  type: z.literal("Point"),
  coordinates: z.tuple([z.number(), z.number()]).superRefine(
    superRefineCoordinates("Point"),
  ),
});

const multiPointSchema = z.object({
  type: z.literal("MultiPoint"),
  coordinates: z.array(z.tuple([z.number(), z.number()])).nonempty()
    .superRefine(superRefineCoordinates("MultiPoint")),
});

const lineStringSchema = z.object({
  type: z.literal("LineString"),
  coordinates: z.array(z.tuple([z.number(), z.number()])).nonempty()
    .superRefine(superRefineCoordinates("LineString")),
});

const multiLineStringSchema = z.object({
  type: z.literal("MultiLineString"),
  coordinates: z.array(z.array(z.tuple([z.number(), z.number()])).nonempty())
    .nonempty().superRefine(superRefineCoordinates("MultiLineString")),
});

const polygonSchema = z.object({
  type: z.literal("Polygon"),
  coordinates: z.array(z.array(z.tuple([z.number(), z.number()])).nonempty())
    .nonempty().superRefine(superRefineCoordinates("Polygon")).superRefine(
      superRefineWindingOrder("Polygon"),
    ),
});

const multiPolygonSchema = z.object({
  type: z.literal("MultiPolygon"),
  coordinates: z.array(
    z.array(z.array(z.tuple([z.number(), z.number()])).nonempty()).nonempty(),
  ).nonempty().superRefine(superRefineCoordinates("MultiPolygon")).superRefine(
    superRefineWindingOrder("MultiPolygon"),
  ),
});

const absoluteURLSchema = z.string().url().refine(
  (u) => u.startsWith("https://") || u.startsWith("http://"),
  "url must start with https:// or http://",
);

const hexColorSchema = z.string().regex(
  /^#[0-9a-fA-F]{6}$/,
  "must be hex color in format #RRGGBB",
);

export const mapFeatureSchema = z.object({
  type: z.literal("Feature"),
  geometry: z.discriminatedUnion("type", [
    pointSchema,
    multiPointSchema,
    lineStringSchema,
    multiLineStringSchema,
    polygonSchema,
    multiPolygonSchema,
  ]),
  properties: z.object({
    last_updated: isoTimestampSchema,
    title: z.string(),
    short_title: z.string().optional(),
    truncated_title: z.string().optional(),
    publisher: z.string(),
    series: z.string().optional(),
    isbn: z.string().optional(),
    color: hexColorSchema.optional(),
    url: absoluteURLSchema.optional(),
    icon: absoluteURLSchema.optional(),
    thumbnail: absoluteURLSchema.optional(),
    images: z.array(absoluteURLSchema).optional(),
    description: z.string().optional(),
    description_html: z.string().optional(),
  }),
});

export type MapFeature = z.infer<typeof mapFeatureSchema>;

export const mapFeatureCollectionSchema = z.object({
  type: z.literal("FeatureCollection"),
  features: z.array(mapFeatureSchema),
});

export type MapFeatureCollection = z.infer<typeof mapFeatureCollectionSchema>;
