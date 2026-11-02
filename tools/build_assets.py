"""Build static assets bundled into the app (run once on the PC, not on the phone).

- www/data/coast.json   : land rings from the OSM coast mask, compact [lon,lat,...] with 6 decimals
- www/data/palette.json : official Copernicus colour map for sea_water_velocity (0..0.7 m/s)

Usage: python3 -I tools/build_assets.py <path-to-original-repo>
"""
import json, sys, urllib.request, urllib.parse, pathlib

repo = pathlib.Path(sys.argv[1])
out = pathlib.Path(__file__).resolve().parent.parent / "www" / "data"
out.mkdir(parents=True, exist_ok=True)

mask = json.loads((repo / "data" / "gotland-coast-mask.json").read_text())
rings = []
for el in mask["elements"]:
    flat = []
    for p in el["geometry"]:
        flat += [round(p["lon"], 6), round(p["lat"], 6)]
    rings.append(flat)
coast = {
    "attribution": mask["source"]["attribution"],
    "license": mask["source"]["license"],
    "coverage": mask["coverage"],
    "rings": rings,
}
(out / "coast.json").write_text(json.dumps(coast, separators=(",", ":")))
print("coast.json", len(rings), "rings", (out / "coast.json").stat().st_size // 1024, "KB")

style = "vectorStyle:solid,cmap:rainbow,range:0/0.7"  # same as original worker
url = ("https://wmts.marine.copernicus.eu/teroWmts/?service=WMTS&version=1.0.0&request=GetLegend"
       "&format=application%2Fjson&layer=BALTICSEA_ANALYSISFORECAST_PHY_003_006/"
       "cmems_mod_bal_phy_anfc_PT15M-i_202411/sea_water_velocity&STYLE=" + urllib.parse.quote(style))
leg = json.load(urllib.request.urlopen(url, timeout=60))["continuous"]
assert leg["valueMin"] == 0 and leg["valueMax"] == 0.7 and not leg.get("logScale"), leg
cmap = leg["cmap"]["colorMap"]
(out / "palette.json").write_text(json.dumps({"min": 0, "max": 0.7, "colors": cmap}))
print("palette.json", len(cmap), "colours")
