# Labor Force Referral Navigator

A separate referral directory prepared for Brook. Search the supplied IPM, WC physical therapy, behavioral therapy and imaging networks by name or branch address. The map and list share selected locations, and each office offers directions and available contact details.

## Source data

Edit `source/directory.json`, then run `node scripts/build-data.mjs`. This file contains provider and office IDs, original supplied addresses, official source URLs, map coordinates, research completeness and owner confirmations.

The initial ATI collection covers every clinic URL in the official Illinois directory and sitemap. Team Rehab includes its listed clinics and the Northlake coming-soon location. Its personnel-team entry is retained in source research metadata. The supplied Molecular Scans Indianapolis location is included.

WC listing status comes from the owner's supplied list. Office websites provide addresses and contact details. Confirm current appointment availability and case acceptance with the office.

## Local preview

Run `python -m http.server 4174 --directory dist` from this folder and open `http://127.0.0.1:4174/`.

Use **Edit directory** with the existing directory password to edit providers, notes, WC status, logos and individual locations. Add providers, deactivate them and reactivate them from the editor-only inactive list. Each location can be geocoded independently. Functional testing is performed manually by the user. Publication runs JavaScript syntax checks.

## Publishing

GitHub Pages deploys the `dist` folder from the `main` branch through `.github/workflows/deploy-pages.yml`. The owner-private Sites mirror uses `.openai/hosting.json` and the Sites source helper with a static archive.

The GitHub page loads shared edits from `https://lfmm-directory-data.harvey-the-rabbit.chatgpt.site/api/referrals`. Edits and revision history are stored in D1 under a separate referral namespace. Uploaded pictures are stored in R2 and their URLs are saved with the provider. The initial source and page code stay in this separate Git repository.

Choose **Upload / replace image**, review the preview, then **Save to live directory**. Images are resized to a maximum edge of 1600 pixels before upload. Replaced image objects remain available to historical revisions.

This static site uses Leaflet, OpenStreetMap, the bundled ZIP index, Photon suggestions and the Census geocoder. The shared API uses the existing server-side `DIRECTORY_EDITOR_PASSWORD` secret and an R2 `BUCKET` binding. Browser sessions contain a temporary bearer token in sessionStorage. Temporary publishing credentials belong only in memory and hidden standard input. See `THIRD_PARTY_NOTICES.md` for the ZIP source attribution.

Maintain the existing tool record and `E:\CodeX\tool-records\index.json` when changing behavior, data preparation or publishing.
