# Local Gotland coastline mask

`gotland-coast-mask.json` contains unsimplified coastline geometry from
**© OpenStreetMap contributors**, licensed under the
[Open Database License (ODbL 1.0)](https://www.openstreetmap.org/copyright).
The coastline is a separate data asset; its ODbL terms apply to this database.

Source: `https://overpass-api.de/api/interpreter`, OSM snapshot
**2026-11-01T07:29:01Z**. The original query, source way IDs and SHA-256 of the
downloaded source JSON are recorded inside the file.

The query covers 56.5–58.5° N, 17.35–20.2° E, a buffer around the existing
Gotland field (56.6–58.3° N, 17.4–20.1° E). It includes Gotland, Fårö,
Stora/Lilla Karlsö, nearby small islands and Gotska Sandön north of the field.
All 629 source ways form 228 closed rings, with 40,180 segments. No source
way is omitted, simplified, clipped, rounded or closed with an invented edge.
No ring touches the query boundary. The original OSM sea/land division is
preserved; freshwater lakes are not reclassified as marine water.

Offline validation:

```
node scripts/validate-coast-mask.cjs
```

Checks cover closed rings, finite coordinates, zero-length edges, duplicated
source ways, self/cross-ring intersections and field coverage. Regression
tests check main islands, smaller islands, open water, Fårösund and field
edges. The worker also checks closure and coverage before using the asset.
Missing/corrupt data fail closed; no external coastline fallback is used.

The median segment length is 14.4 m, the 95th percentile 67.8 m and the
maximum 488.5 m. These describe vertex spacing, **not positional accuracy**.
This is a detailed OSM map mask, not a surveyed shoreline or a navigation
chart. Unmapped features and OSM inaccuracies remain possible, particularly
when inspecting zoom 16. There are no data-dependent changes to currents:
land and NoData remain transparent, rather than being assigned zero speed.

The existing application may still use Overpass for other features. Only
the new current-field worker is independent of that service.
