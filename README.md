# Paper Maps

My ultimate goal is to create a dataset of paper maps around the world.

For a preview of the data see https://plantopo-storage.b-cdn.net/paper-maps/index.html

## Coverage

United Kingdom:

- OS Explorer
- Most Harvey maps (lower quality geometries)
- OSNI Activity

United States:

- FSTopo

## Data model

Properties:

- publisher: User-facing name of the publisher (string)
- title: Title/name of the map (string)
- short_title: A version of the title suitable for display at a lower zoom (optional string)
- isbn: ISBN of the specific map (optional string)
- icon: URL of a small icon with a transparent background. Generally all maps by a publisher share an icon (optional string)
- series: User-facing name of the series (optional string)
- color: An appropriate color to display the map shape in. Not necessarily official. (optional string)
- url: A deep link to the page to purchase this specific map (optional string)
- thumbnail: Thumbnail of the map (e.g. its cover) (optional string)
- images: Images of the map (e.g. the cover or the actual map) (optional array of strings, JSON encoded in mvt)

Geometry:

Generally a polygon or a multipolygon. Trail-specific maps might end up being lines.
