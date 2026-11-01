# Release v6.2.4 / 6240

## Reproducible release files

Run `node scripts/build-release.cjs --check` before publishing. It verifies the
19 pinned assets, their SHA-256 hashes, bootstrap integrity and canonical LF
bytes. `.gitattributes` preserves those bytes on Windows and GitHub Pages.
`node scripts/build-release.cjs` regenerates the manifest during development;
it does not fetch or change external dependencies. Their pinned versions and
hashes are recorded in `scripts/release-dependencies.json`.

Once published, a changed release file requires a **new release ID** and matching
references in the HTML, bootstrap, module, worker, mask URL and manifest. Do not
reuse 6240 with different file contents. A reused ID with a different complete
manifest is rejected rather than overwriting an installed release.

## Installation and updates

All release assets are downloaded and checksum-verified before the installation
is marked complete. Failed downloads, invalid bytes and interrupted writes do
not replace the previous release. Local application assets are served only from
the complete matching release cache; missing or mismatched assets fail closed.
The external runtime-data cache is separate from application code.

A running old app is not forcibly upgraded. A new startup gate initially runs
no app code. It can ask the waiting worker to activate only when every scoped
window acknowledges that it is a matching, app-free startup gate. A legacy
window, running app, missing acknowledgement or changed client list prevents
early activation. After controller change the gate reloads before starting app
code. This avoids a new startup window itself indefinitely retaining the old
controller. Close all old app windows to allow the update to finish.

## Offline limits

After successful installation the app shell and pinned Leaflet dependencies
can restart offline. Newly requested weather, marine and Copernicus current
fields still require a network connection. Zarr downloads are never persisted
by the service worker. Missing live data produce an unavailable state, not a
fabricated current field. Browser storage eviction or manual cache removal can
require reinstallation while online. Service workers require HTTPS (localhost
is permitted for tests) and a supported browser.

## Checks

```
node --test --test-isolation=none scripts/core-regression.test.cjs scripts/robustness-regression.test.cjs scripts/current-field.test.cjs scripts/release-regression.test.cjs
node scripts/build-release.cjs --check
node scripts/validate-coast-mask.cjs
git diff --check
```

Browser lifecycle checks use the actual `c516be5` legacy worker, multiple old
windows, the `/gotland_sea_trout/` subpath, fresh installation, waiting updates,
controlled activation, offline restart and an interrupted subsequent update.
Current interpolation, source values, coast geometry, scoring and timeline
rules are independent of this release mechanism.
