# Labor Force Referral Navigator

A separate referral directory prepared for Brook. Search the supplied IPM, WC physical therapy, behavioral therapy and imaging networks by name or branch address. The map and list share selected locations, and each office offers directions and available contact details.

## Source data

Edit `source/directory.json`, then run `node scripts/build-data.mjs`. This file contains provider and office IDs, original supplied addresses, official source URLs, map coordinates, research completeness and owner confirmations.

The initial ATI collection covers every clinic URL in the official Illinois directory and sitemap. Team Rehab includes its listed clinics and the Northlake coming-soon location. Its personnel-team entry is retained in source research metadata. The supplied Molecular Scans Indianapolis location is included.

WC listing status comes from the owner's supplied list. Office websites provide addresses and contact details. Confirm current appointment availability and case acceptance with the office.

## Local preview

Run `python -m http.server 4174 --directory dist` from this folder and open `http://127.0.0.1:4174/`.

Functional testing is performed manually by the user. Publication runs JavaScript syntax checks. The directory is maintained through this separate Git repository.

## Publishing

GitHub Pages deploys the `dist` folder from the `main` branch through `.github/workflows/deploy-pages.yml`. The owner-private Sites mirror uses `.openai/hosting.json` and the Sites source helper with a static archive.

This static site uses Leaflet, OpenStreetMap, the bundled ZIP index, Photon suggestions and the Census geocoder. It requires no API keys or runtime credentials. Temporary publishing credentials belong only in memory and hidden standard input. See `THIRD_PARTY_NOTICES.md` for the ZIP source attribution.

Maintain the existing tool record and `E:\CodeX\tool-records\index.json` when changing behavior, data preparation or publishing.
