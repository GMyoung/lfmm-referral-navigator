(function attachAddressSuggestions(root) {
  "use strict";

  const ENDPOINT = "https://photon.komoot.io/api/";
  const cache = new Map();
  let lastRequestAt = 0;
  const clean = value => typeof value === "string" ? value.trim().slice(0, 200) : "";
  const words = value => String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()
    .replace(/\b(n|s|e|w|ave|av|st|rd|blvd|dr|ln|pkwy)\b/g, part => ({ n: "north", s: "south", e: "east", w: "west", ave: "avenue", av: "avenue", st: "street", rd: "road", blvd: "boulevard", dr: "drive", ln: "lane", pkwy: "parkway" })[part]);

  function localOptions(query, providers) {
    const terms = words(query).split(" ").filter(Boolean);
    const numbered = root.LFMM_LOCATION_UTILS.isStreetAddress(query);
    const results = [];
    const seen = new Set();
    for (const provider of providers) {
      if (!Number.isFinite(provider.lat) || !Number.isFinite(provider.lng)) continue;
      const city = clean(provider.city);
      if (!numbered && city && !seen.has(city) && terms.every(term => words(city).includes(term))) {
        const origin = root.LFMM_LOCATION_UTILS.resolveKnownOrigin(city, providers);
        if (origin) results.push({ ...origin, label: city + ", IL", detail: "City area", approximate: true });
        seen.add(city);
      }
      const address = clean(provider.address);
      if (address && !seen.has(address) && terms.every(term => words(address).includes(term))) {
        results.push({ label: address, detail: "Saved office address", lat: provider.lat, lng: provider.lng, source: "directory-address" });
        seen.add(address);
      }
      if (results.length >= 4) break;
    }
    if (/^\d{5}(?:-\d{4})?$/.test(query)) {
      const origin = root.LFMM_LOCATION_UTILS.resolveKnownOrigin(query, providers);
      if (origin) results.unshift({ ...origin, label: query, detail: "ZIP area center", approximate: true });
    }
    return results.slice(0, 4);
  }

  async function onlineOptions(query, bias, signal) {
    const numbered = root.LFMM_LOCATION_UTILS.isStreetAddress(query);
    const house = numbered ? query.match(/^\d+[a-z]?(?:[-/]\d+)?/i)[0] : "";
    // Street completion supplies city/state context; Census checks the actual
    // house number on selection. A road coordinate is never used as that house.
    const searchText = numbered ? words(query.replace(/^\d+[a-z]?(?:[-/]\d+)?\s+/i, "")) : query;
    const key = searchText.toLowerCase() + "|" + house + "|" + bias.lat.toFixed(2) + "|" + bias.lng.toFixed(2);
    if (cache.has(key)) return cache.get(key);
    const url = new URL(ENDPOINT);
    url.search = new URLSearchParams({ q: searchText, limit: "6", lang: "en", countrycode: "US", lat: bias.lat.toFixed(3), lon: bias.lng.toFixed(3), zoom: "10", location_bias_scale: "0.15" });
    const controller = new AbortController();
    const abort = () => controller.abort();
    if (signal.aborted) throw new DOMException("Cancelled", "AbortError");
    signal.addEventListener("abort", abort, { once: true });
    const timer = root.setTimeout(abort, 8000);
    try {
      const response = await fetch(url, { signal: controller.signal, credentials: "omit", referrerPolicy: "no-referrer" });
      if (!response.ok) throw new Error("Suggestions unavailable");
      const payload = await response.json();
      if (!Array.isArray(payload.features)) throw new Error("Invalid suggestions");
      const seen = new Set();
      const options = [];
      for (const feature of payload.features.slice(0, 12)) {
        const p = feature.properties || {};
        const country = clean(p.countrycode).toUpperCase();
        const coordinates = feature.geometry?.coordinates;
        if (country !== "US" || feature.geometry?.type !== "Point" || !Array.isArray(coordinates)) continue;
        const [lng, lat] = coordinates;
        if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) continue;
        const city = clean(p.city) || clean(p.town) || clean(p.village) || clean(p.locality);
        const state = clean(p.state);
        const street = clean(p.street) || (p.osm_key === "highway" || p.type === "street" ? clean(p.name) : "");
        let option;
        if (numbered) {
          if (!street || !city || !state) continue;
          const label = house + " " + street + ", " + city + ", " + state;
          option = { label, searchText: label, detail: "Complete address · check house number", needsGeocode: true, source: "photon-completion" };
        } else {
          const streetLine = [clean(p.housenumber), street].filter(Boolean).join(" ");
          const name = clean(p.name);
          const label = [name && name !== street && name !== city ? name : "", streetLine, city, state, clean(p.postcode)].filter(Boolean).join(", ");
          if (!label) continue;
          option = { label, detail: streetLine ? "Address / place" : "City / area", lat, lng, source: "photon", approximate: true };
        }
        const identity = words(option.label);
        if (!seen.has(identity)) { seen.add(identity); options.push(option); }
      }
      if (cache.size >= 30) cache.delete(cache.keys().next().value);
      cache.set(key, options);
      return options;
    } finally {
      root.clearTimeout(timer);
      signal.removeEventListener("abort", abort);
    }
  }

  function create(config) {
    const { input, getProviders, getBias, onSelect } = config;
    const panel = document.getElementById("location-suggestion-panel");
    const list = document.getElementById("location-suggestions");
    const status = document.getElementById("location-suggestion-status");
    const field = input.closest(".location-search");
    let items = [];
    let active = -1;
    let opened = false;
    let busy = false;
    let message = "";
    let version = 0;
    let timer;
    let request;

    function render() {
      panel.hidden = !opened;
      input.setAttribute("aria-expanded", String(opened));
      list.replaceChildren();
      items.forEach((item, index) => {
        const option = document.createElement("li");
        option.id = "location-option-" + index;
        option.dataset.locationOption = String(index);
        option.setAttribute("role", "option");
        option.setAttribute("aria-selected", String(index === active));
        const title = document.createElement("span");
        title.className = "location-option-title";
        title.textContent = item.label;
        const detail = document.createElement("small");
        detail.textContent = item.detail;
        option.append(title, detail);
        list.appendChild(option);
      });
      status.textContent = busy ? "Finding address suggestions…" : message;
      status.hidden = !status.textContent;
      if (active >= 0 && opened) {
        input.setAttribute("aria-activedescendant", "location-option-" + active);
        list.children[active]?.scrollIntoView({ block: "nearest" });
      } else input.removeAttribute("aria-activedescendant");
    }

    function close() {
      version += 1;
      root.clearTimeout(timer);
      request?.abort();
      request = null;
      opened = false;
      busy = false;
      active = -1;
      items = [];
      render();
    }

    function select(index) {
      const item = items[index];
      if (!item) return;
      close();
      onSelect(item);
    }

    function schedule() {
      close();
      const query = input.value.trim();
      if (query.length < 3 || /^current location$/i.test(query)) return;
      const current = version;
      const local = localOptions(query, getProviders());
      items = local;
      opened = true;
      const online = !/^\d{1,5}(?:-\d{0,4})?$/.test(query);
      busy = online;
      message = local.length ? "" : "Enter a full ZIP or keep typing an address.";
      render();
      if (!online) return;
      const wait = Math.max(600, 1000 - (Date.now() - lastRequestAt));
      timer = root.setTimeout(async () => {
        request = new AbortController();
        lastRequestAt = Date.now();
        try {
          const remote = await onlineOptions(query, getBias(), request.signal);
          if (version !== current || input.value.trim() !== query) return;
          const seen = new Set();
          const selectedLabel = items[active]?.label;
          items = local.concat(remote).filter(item => {
            const key = words(item.label);
            if (seen.has(key)) return false;
            seen.add(key); return true;
          }).slice(0, 7);
          active = selectedLabel ? items.findIndex(item => item.label === selectedLabel) : -1;
          message = items.length ? "" : "No suggestions found. Add a city or ZIP, or press Search.";
        } catch {
          if (version !== current) return;
          message = local.length ? "More suggestions are unavailable. You can use a saved address." : "Suggestions are unavailable. Add a city or ZIP and press Search.";
        } finally {
          if (version === current) { busy = false; request = null; render(); }
        }
      }, wait);
    }

    function handleKey(event) {
      if (event.isComposing) return false;
      if (event.key === "Tab") { close(); return false; }
      if (!opened && event.key === "ArrowDown") { event.preventDefault(); schedule(); return true; }
      if (!opened) return false;
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); return true; }
      if (["ArrowDown", "ArrowUp"].includes(event.key) && items.length) {
        event.preventDefault();
        active = event.key === "ArrowDown" ? (active + 1) % items.length : (active < 0 ? items.length - 1 : (active - 1 + items.length) % items.length);
        render(); return true;
      }
      if (event.key === "Enter" && active >= 0) { event.preventDefault(); select(active); return true; }
      return false;
    }

    list.addEventListener("pointerdown", event => { if (event.pointerType === "mouse") event.preventDefault(); });
    list.addEventListener("click", event => {
      const option = event.target.closest("[data-location-option]");
      if (option) select(Number(option.dataset.locationOption));
    });
    input.addEventListener("focus", schedule);
    input.addEventListener("compositionstart", close);
    input.addEventListener("compositionend", schedule);
    document.addEventListener("pointerdown", event => { if (!field.contains(event.target)) close(); });
    root.addEventListener("pagehide", close);
    return Object.freeze({ schedule, close, handleKey });
  }

  root.LFMM_ADDRESS_SUGGESTIONS = Object.freeze({ create });
})(window);
