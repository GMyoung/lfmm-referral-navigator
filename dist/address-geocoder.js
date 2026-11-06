(function attachAddressGeocoder(root) {
  "use strict";

  const ENDPOINT = "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress";

  function search(value, options = {}) {
    const address = String(value || "").trim();
    if (!address || address.length > 200) return Promise.resolve([]);
    const signal = options.signal;
    if (signal && signal.aborted) return Promise.reject(new DOMException("Cancelled", "AbortError"));

    return new Promise((resolve, reject) => {
      const id = root.crypto.randomUUID();
      const url = new URL(ENDPOINT);
      url.search = new URLSearchParams({ address, benchmark: "Public_AR_Current", format: "jsonp", callback: "lfmmAddressResult" });
      const frame = document.createElement("iframe");
      frame.hidden = true;
      frame.title = "Address lookup";
      frame.setAttribute("aria-hidden", "true");
      // Census documents JSONP rather than CORS. Isolate its script from the
      // directory, internal contacts and browser storage in an opaque origin.
      frame.setAttribute("sandbox", "allow-scripts");
      frame.referrerPolicy = "no-referrer";
      let settled = false;
      let timer;

      function finish(error, matches) {
        if (settled) return;
        settled = true;
        root.clearTimeout(timer);
        root.removeEventListener("message", onMessage);
        if (signal) signal.removeEventListener("abort", onAbort);
        frame.remove();
        if (error) reject(error);
        else resolve(matches);
      }

      function onAbort() { finish(new DOMException("Cancelled", "AbortError")); }

      function onMessage(event) {
        if (event.source !== frame.contentWindow || event.data?.id !== id || event.data?.type !== "lfmm-address-result") return;
        const payload = event.data.payload;
        if (event.data.failed || !payload || !Array.isArray(payload.result?.addressMatches)) {
          finish(new Error("Address lookup unavailable"));
          return;
        }
        const seen = new Set();
        const matches = payload.result.addressMatches.flatMap((match) => {
          const lat = match.coordinates?.y;
          const lng = match.coordinates?.x;
          const label = typeof match.matchedAddress === "string" ? match.matchedAddress.slice(0, 300) : "";
          if (!label || !Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return [];
          const key = lat.toFixed(6) + "|" + lng.toFixed(6);
          if (seen.has(key)) return [];
          seen.add(key);
          return [{ lat, lng, label, source: "census", approximate: true }];
        }).slice(0, 5);
        finish(null, matches);
      }

      root.addEventListener("message", onMessage);
      if (signal) signal.addEventListener("abort", onAbort, { once: true });
      timer = root.setTimeout(() => finish(new Error("Address lookup timed out")), 15000);
      const responseScript = "function lfmmAddressResult(payload){parent.postMessage({type:'lfmm-address-result',id:" + JSON.stringify(id) + ",payload:payload},'*')}";
      const failureScript = "parent.postMessage({type:'lfmm-address-result',id:" + JSON.stringify(id) + ",failed:true},'*')";
      const escapedUrl = url.href.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
      frame.srcdoc = '<!doctype html><meta charset="utf-8"><meta name="referrer" content="no-referrer">' +
        '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'unsafe-inline\' https://geocoding.geo.census.gov">' +
        '<script>' + responseScript + '<\/script><script referrerpolicy="no-referrer" src="' + escapedUrl + '" onerror="' + failureScript.replace(/"/g, "&quot;") + '"><\/script>';
      document.body.appendChild(frame);
    });
  }

  root.LFMM_ADDRESS_GEOCODER = Object.freeze({ search });
})(window);
