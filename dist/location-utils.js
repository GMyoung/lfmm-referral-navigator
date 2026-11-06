(function attachLocationUtils(root) {
  "use strict";

  const OFFLINE_ZIP_CENTERS = root.LFMM_ZIP_CENTERS || Object.freeze({
    "60603": [41.8806, -87.6277]
  });

  function normalize(value) {
    return String(value == null ? "" : value)
      .toLowerCase()
      .replace(/[’']/g, "")
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  }

  function titleCase(value) {
    return String(value || "")
      .toLowerCase()
      .replace(/(^|[\s-])\S/g, (letter) => letter.toUpperCase());
  }

  function centroid(items) {
    if (!items.length) return null;
    return {
      lat: items.reduce((sum, provider) => sum + provider.lat, 0) / items.length,
      lng: items.reduce((sum, provider) => sum + provider.lng, 0) / items.length
    };
  }

  function isStreetAddress(value) {
    const text = String(value || "").trim();
    return !/^\d{5}(?:-\d{4})?$/.test(text) && /^\d+[a-z]?(?:[-/]\d+)?\s+\S+/i.test(text);
  }

  function haversineMiles(lat1, lng1, lat2, lng2) {
    const toRadians = (degrees) => degrees * Math.PI / 180;
    const earthRadiusMiles = 3958.7613;
    const dLat = toRadians(lat2 - lat1);
    const dLng = toRadians(lng2 - lng1);
    const a = Math.sin(dLat / 2) ** 2
      + Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLng / 2) ** 2;
    return earthRadiusMiles * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  function resolveKnownOrigin(value, providers) {
    const text = String(value || "").trim();
    if (!text) return null;
    const mapped = providers.filter((provider) => Number.isFinite(provider.lat) && Number.isFinite(provider.lng));
    if (isStreetAddress(text)) {
      const exact = mapped.filter((provider) => normalize(provider.address) === normalize(text));
      if (exact.length) return { lat: exact[0].lat, lng: exact[0].lng, label: exact[0].address, source: "directory-address" };
      // Never silently replace a street address with its ZIP's centroid.
      return null;
    }
    const zipMatch = text.match(/\b\d{5}\b/);
    if (zipMatch) {
      const matches = mapped.filter((provider) => provider.zip === zipMatch[0]);
      const point = centroid(matches);
      if (point) return { lat: point.lat, lng: point.lng, label: zipMatch[0] + " directory centroid", source: "zip" };
      const offlinePoint = OFFLINE_ZIP_CENTERS[zipMatch[0]];
      if (offlinePoint) {
        return {
          lat: offlinePoint[0],
          lng: offlinePoint[1],
          label: zipMatch[0] + " center",
          source: "offline-zip"
        };
      }
    }
    const cleanedCity = normalize(text).replace(/\b(il|illinois)\b/g, "").trim();
    const matches = mapped.filter((provider) => normalize(provider.city) === cleanedCity);
    const point = centroid(matches);
    if (point) return { lat: point.lat, lng: point.lng, label: titleCase(cleanedCity) + " directory centroid", source: "city" };
    return null;
  }

  function resolveLocationSearch(value, providers) {
    const text = String(value || "").trim();
    if (!text) return { mode: "none", origin: null };
    const origin = resolveKnownOrigin(text, providers);
    if (origin) return { mode: "origin", origin: origin };
    if (isStreetAddress(text)) return { mode: "address", origin: null };
    const terms = normalize(text).split(" ").filter(Boolean);
    const hasDirectoryMatch = providers.some((provider) => {
      const haystack = normalize([provider.address, provider.city, provider.zip, ...(provider.otherLocations || [])].join(" "));
      return terms.every((term) => haystack.includes(term));
    });
    return { mode: hasDirectoryMatch ? "text" : "unresolved", origin: null };
  }

  root.LFMM_LOCATION_UTILS = Object.freeze({
    offlineZipCenters: OFFLINE_ZIP_CENTERS,
    haversineMiles: haversineMiles,
    isStreetAddress: isStreetAddress,
    resolveKnownOrigin: resolveKnownOrigin,
    resolveLocationSearch: resolveLocationSearch
  });
})(typeof window !== "undefined" ? window : globalThis);
