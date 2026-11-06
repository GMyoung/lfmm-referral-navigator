# Third-party notices

## GeoNames Postal Code Data

The generated ZIP-center asset is derived from postal-code files for the United States and U.S. territories published by [GeoNames](https://download.geonames.org/export/zip/).

- License: [Creative Commons Attribution 4.0 International](https://creativecommons.org/licenses/by/4.0/)
- Source files: US.zip, PR.zip, VI.zip, GU.zip, AS.zip, and MP.zip from https://download.geonames.org/export/zip/
- Build tool: scripts/build-zip-centers.mjs

The source data and derived coordinates are provided without warranty. Some coordinates may be estimated or calculated from neighboring postal codes.

## Photon / OpenStreetMap address suggestions

Online autocomplete uses the [Photon public API](https://photon.komoot.io/) operated by komoot, based on OpenStreetMap data. The dropdown credits [OpenStreetMap contributors](https://www.openstreetmap.org/copyright). Photon API usage and its reasonable-use/availability limits are documented in the [official project](https://github.com/komoot/photon) and [API reference](https://github.com/komoot/photon/blob/master/docs/api-v1.md).

No Photon server code or database is bundled. Suggestions are requested only after a typing pause, rate limited in the page, and cached in memory. The public service has no availability guarantee; use a dedicated service or private instance for higher traffic.
