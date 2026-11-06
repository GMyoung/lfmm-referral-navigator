"use strict";

const source = window.LFMM_REFERRAL_DATA;
const locationUtils = window.LFMM_LOCATION_UTILS;
const RADIUS_OPTIONS = [25, 50, 100];
const STANDARD_BODY_AREAS = ["Head", "Neck", "Shoulder", "Arm", "Elbow", "Wrist", "Hand", "Chest", "Abdomen", "Back", "Spine", "Hip", "Pelvis", "Knee", "Leg", "Ankle", "Foot"];

const CATEGORY_CONFIG = {
  "Pain Management": {label:"Pain management",symbol:"PM",color:"#b23a63"},
  "Physical Therapy": {label:"Physical therapy",symbol:"PT",color:"#0b8f70"},
  "Behavioral Therapy": {label:"Behavioral therapy",symbol:"BT",color:"#7954a1"},
  "Imaging": {label:"Imaging",symbol:"IM",color:"#088ca1"}
};
const DEFAULT_CATEGORY = { label: "Other service", symbol: "MD", color: "#536b70" };

const $ = (selector, root) => (root || document).querySelector(selector);
const $$ = (selector, root) => Array.from((root || document).querySelectorAll(selector));

function escapeHtml(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function normalized(value) {
  return String(value == null ? "" : value)
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function categoryFor(group) {
  return CATEGORY_CONFIG[group] || DEFAULT_CATEGORY;
}

function iconSvg(name, className) {
  return '<svg class="' + escapeHtml(className || "ui-icon") + '" aria-hidden="true"><use href="#icon-' + escapeHtml(name) + '"></use></svg>';
}

function doctorProvider(row) {
  const p = {providerType:"organization",firstName:"",lastName:"",credentials:"",practice:"",specialty:"",group:"",
    bodyAreas:[],languages:[],restrictions:[],otherLocations:[],publicEmails:[],otherOfficePhones:[],otherOfficeFaxes:[],
    officeNotes:"",staffNotes:"",referralBlocked:false,caseRules:{wc:"unknown",pi:"unknown"},rawStatus:"Source listed",
    order:100000,detailed:true,lat:null,lng:null,...row};
  p.name = p.sourceTitle || p.firstName;
  p.sourceTitle ||= p.name;
  p.initials = p.providerType === "organization"
    ? p.firstName.split(/\s+/).map(part => part[0]).slice(0, 2).join("").toUpperCase()
    : (p.firstName[0] || "") + (p.lastName[0] || "");
  p.locations = Array.isArray(row.locations) ? structuredClone(row.locations) : [];
  if(p.locations.length) {
    const first = p.locations[0];
    for(const key of ["address","city","region","zip","lat","lng"])p[key]=first[key]??(key==="lat"||key==="lng"?null:"");
  } else {
    p.address=p.locationSummary||"Location information to verify";p.city=p.locationSummary?p.city:"Not mapped";
    p.lat=null;p.lng=null;
  }
  p.otherLocations=p.locations.slice(1).map(o=>o.address);
  for(const key of ["phone","fax","hours"])p[key]=p[key]||"Not provided";
  return p;
}

function providerLocations(provider) {
  return (provider.locations || []).filter(office => !state.excludePending || office.status !== "coming_soon");
}
function mappedLocations(provider) {
  if (provider.inactive) return [];
  return providerLocations(provider).filter(p=>Number.isFinite(p.lat)&&Number.isFinite(p.lng));
}
function pointInsideBounds(point, bounds=state.mapBounds) {
  return !bounds || (point.lat>=bounds.south&&point.lat<=bounds.north&&
    (bounds.west<=bounds.east?point.lng>=bounds.west&&point.lng<=bounds.east:point.lng>=bounds.west||point.lng<=bounds.east));
}
function visibleMapLocations(provider) {
  return mappedLocations(provider).filter(p=>pointInsideBounds(p)&&(!state.origin||
    locationUtils.haversineMiles(state.origin.lat,state.origin.lng,p.lat,p.lng)<=state.effectiveRadius));
}
function activeDirectoryLocations() {
  return activeDirectoryProviders().flatMap(p=>providerLocations(p).map(o=>({...p,...o,id:p.id})));
}

const providers = source.providers.map(doctorProvider);

const state = {
  query: "",
  location: "",
  locationMode: "none",
  specialty: "all",
  body: "all",
  caseType: "all",
  sort: "source",
  selectedId: null,
  detailedOnly: false,
  mappedOnly: false,
  excludePending: false,
  radius: 25,
  effectiveRadius: 25,
  radiusExpanded: false,
  origin: null,
  mapBounds: null,
  locationMessage: "",
  locationMessageKind: "info",
  locationPending: false,
  addressCandidates: [],
  lastMatches: []
};

let map;
let markerGroups = new Map();
const markerEntries = new Map();
let hoveredProviderId = null;
let focusedProviderId = null;
let originLayer = null;
let suppressMoveNotice = false;
let lastFocusedElement = null;
let panelCloseTimer = null;
let toastTimer = null;
let locationLookupVersion = 0;
let activeAddressRequest = null;
let locationSuggestions = null;

const list = $("#provider-list");
const count = $("#result-count");
const emptyState = $("#empty-state");
const searchInput = $("#provider-search");
const locationInput = $("#location-search");
const specialtySelect = $("#specialty-filter");
const bodySelect = $("#body-filter");
const sortSelect = $("#sort-select");
const detailSheet = $("#detail-sheet");
const filterSheet = $("#filter-sheet");
const detailContent = $("#detail-content");
const scrim = $("#scrim");
const moreFilterButton = $("#more-filter");

const synonymMap = {
  "dr": "doctor",
  "ortho": "orthopedic",
  "orthopaedic": "orthopedic",
  "back": "spine",
  "neck": "spine",
  "wrist": "hand",
  "dpm": "podiatry",
  "podiatrist": "podiatry",
  "xray": "radiology",
  "x-ray": "radiology",
  "nerve": "emg",
  "pt": "physical therapy"
};

function queryTerms(value) {
  return normalized(value).split(" ").filter(Boolean).map((term) => synonymMap[term] || term);
}

function activeDirectoryProviders() {
  return providers.filter(provider => !provider.inactive);
}

function coversAllBodyAreas(provider) {
  return provider.group === "Pain Management" || provider.bodyAreas.includes("All body areas");
}

function availableBodyAreas() {
  const active = activeDirectoryProviders();
  const areas = active.flatMap(provider => provider.bodyAreas);
  if (active.some(coversAllBodyAreas)) areas.push(...STANDARD_BODY_AREAS);
  return [...new Set(areas)].filter(area => area !== "All body areas").sort();
}

function doctorPhoto(provider, large=false) {
  const isLogo = provider.providerType === "organization";
  return '<span class="doctor-photo'+(isLogo?' provider-logo':'')+(large?' large':'')+'"><span class="doctor-photo-placeholder" aria-hidden="true">'+escapeHtml(provider.initials)+'</span>'+
    (provider.photoUrl?'<img data-provider-photo src="'+escapeHtml(provider.photoUrl)+'" alt="'+escapeHtml(provider.name+(isLogo?' logo':''))+'" loading="lazy" decoding="async" referrerpolicy="no-referrer">':'')+'</span>';
}

function doctorNoteTemplate(provider) {
  if (!provider.staffNotes?.trim()) return "";
  return '<span class="doctor-note"><span class="doctor-note-heading"><strong>Note</strong></span><span class="doctor-note-text">'+escapeHtml(provider.staffNotes)+'</span></span>';
}

function doctorLocationsSection(provider) {
  const offices = providerLocations(provider);
  const selected = offices.find(office => office.id === state.selectedLocationId);
  const locations = selected ? [selected, ...offices.filter(office => office !== selected)] : offices;
  return '<section class="detail-section"><h3>Locations · '+locations.length+'</h3><div class="doctor-offices">'+locations.map(office=>{
    const mapped = Number.isFinite(office.lat) && Number.isFinite(office.lng);
    const url = office.sourceUrl || office.sourceUrls?.[0];
    return '<article class="doctor-office'+(office===selected?' selected-office':'')+'"><strong>'+escapeHtml(office.label||office.city||'Office')+'</strong>'+
      (office.status==='coming_soon'?'<span class="location-status">Coming soon</span>':'')+
      '<p>'+escapeHtml(office.address)+'</p>'+
      (office.phone?'<p>Phone <a href="tel:'+office.phone.replace(/[^\d+]/g,'')+'">'+escapeHtml(office.phone)+'</a></p>':'')+
      (office.fax?'<p>Fax '+escapeHtml(office.fax)+'</p>':'')+
      (office.hours?'<p>'+escapeHtml(Array.isArray(office.hours)?office.hours.join(' · '):office.hours)+'</p>':'')+
      (office.notes?'<p class="office-note">'+escapeHtml(office.notes)+'</p>':'')+
      '<div class="doctor-office-actions">'+(mapped?'<button type="button" data-action="show-doctor-location" data-provider-id="'+escapeHtml(provider.id)+'" data-location-id="'+escapeHtml(office.id)+'">Show on map</button>':'<span class="office-unmapped">Address location to confirm</span>')+
      '<a href="https://www.google.com/maps/search/?api=1&amp;query='+encodeURIComponent(office.address)+'" target="_blank" rel="noreferrer">Directions</a>'+
      (url?'<a href="'+escapeHtml(url)+'" target="_blank" rel="noreferrer">Office website</a>':'')+'</div></article>';
  }).join('')+'</div></section>';
}

function setupFilters() {
  const groups = [...new Set(providers.map(provider=>provider.group))];
  specialtySelect.innerHTML = ['all',...groups].map(value=>'<option value="'+escapeHtml(value)+'">'+escapeHtml(value==='all'?'All services':value)+'</option>').join('');
  bodySelect.innerHTML = ['all',...availableBodyAreas()].map(value=>'<option value="'+escapeHtml(value)+'">'+escapeHtml(value==='all'?'Any body area':value)+'</option>').join('');
}

function caseMatches(provider) {
  if (state.caseType === "all") return true;
  return provider.wcApproved === true;
}

function insideStoredBounds(provider) {
  return !state.mapBounds || mappedLocations(provider).some(p=>pointInsideBounds(p));
}

function baseMatches(provider) {
  if (provider.inactive) return false;
  const terms = queryTerms(state.query);
  const locationTerms = state.locationMode === "text" ? queryTerms(state.location) : [];
  const haystack = normalized([
    provider.name,
    provider.specialty,
    provider.group,
    provider.practice,
    provider.address,
    provider.city,
    provider.zip,
    (coversAllBodyAreas(provider) ? availableBodyAreas() : provider.bodyAreas).join(" "),
    provider.officeNotes, provider.staffNotes,
    ...(provider.publicEmails || []),
    ...providerLocations(provider).flatMap(p=>[p.label,p.address,p.city,p.region,p.zip,p.phone,p.fax]),
    provider.aliases
  ].join(" "));
  const locationHaystack = normalized([provider.address, provider.city, provider.zip, ...providerLocations(provider).flatMap(p=>[p.label,p.address,p.city,p.region,p.zip])].join(" "));
  const matchesQuery = terms.every((term) => haystack.includes(term));
  const matchesLocation = locationTerms.every((term) => locationHaystack.includes(term));
  const matchesSpecialty = state.specialty === "all" || provider.group === state.specialty;
  const matchesBody = state.body === "all" || coversAllBodyAreas(provider) || provider.bodyAreas.some((area) => normalized(area) === normalized(state.body));
  const matchesCoverage = (!state.detailedOnly || provider.detailed) && (!state.mappedOnly || mappedLocations(provider).length>0);
  const matchesStatus = !state.excludePending || provider.rawStatus !== "Pending";
  return matchesQuery
    && matchesLocation
    && matchesSpecialty
    && matchesBody
    && matchesCoverage
    && matchesStatus
    && caseMatches(provider)
    && insideStoredBounds(provider);
}

function sortProviders(items) {
  return items.sort((left, right) => {
    if (state.sort === "source") return left.order - right.order || String(left.createdAt||"").localeCompare(String(right.createdAt||""));
    if (state.sort === "distance") {
      const leftDistance = Number.isFinite(left.distance) ? left.distance : Number.POSITIVE_INFINITY;
      const rightDistance = Number.isFinite(right.distance) ? right.distance : Number.POSITIVE_INFINITY;
      return leftDistance - rightDistance || (left.lastName || left.firstName).localeCompare(right.lastName || right.firstName);
    }
    if (state.sort === "name") return (left.lastName || left.firstName).localeCompare(right.lastName || right.firstName) || left.firstName.localeCompare(right.firstName);
    if (state.sort === "city") return left.city.localeCompare(right.city) || (left.lastName || left.firstName).localeCompare(right.lastName || right.firstName);
    return left.lastName.localeCompare(right.lastName) || left.firstName.localeCompare(right.firstName);
  });
}

function computeResults() {
  const officeSearchTerms = queryTerms([state.query, state.locationMode === "text" ? state.location : ""].join(" "));
  let candidates = providers.filter(baseMatches).map((provider) => {
    const offices=mappedLocations(provider).filter(p=>pointInsideBounds(p));
    const ranked=state.origin?offices.map(p=>({office:p,distance:locationUtils.haversineMiles(state.origin.lat,state.origin.lng,p.lat,p.lng)})).sort((a,b)=>a.distance-b.distance):[];
    const textMatches = officeSearchTerms.length ? providerLocations(provider).map(office => {
      const text = normalized([office.label, office.address, office.city, office.zip].join(" "));
      return {office, score:officeSearchTerms.filter(term => text.includes(term)).length};
    }).filter(match => match.score > 0).sort((a,b) => b.score - a.score) : [];
    return Object.assign({}, provider, { distance:ranked[0]?.distance??null, matchedLocation:ranked[0]?.office||textMatches[0]?.office||null });
  });
  state.effectiveRadius = state.radius;
  state.radiusExpanded = false;

  if (state.origin) {
    candidates = candidates.filter((provider) => Number.isFinite(provider.distance));
    if (!state.mapBounds) {
      const availableRadii = RADIUS_OPTIONS.filter((radius) => radius >= state.radius);
      let chosenRadius = availableRadii[availableRadii.length - 1] || state.radius;
      let radiusMatches = [];
      for (const radius of availableRadii) {
        const within = candidates.filter((provider) => provider.distance <= radius);
        if (within.length) {
          chosenRadius = radius;
          radiusMatches = within;
          break;
        }
      }
      state.effectiveRadius = chosenRadius;
      state.radiusExpanded = chosenRadius > state.radius;
      candidates = radiusMatches;
    } else {
      candidates = candidates.filter((provider) => provider.distance <= state.radius);
    }
  }

  return sortProviders(candidates);
}

function cardTemplate(provider) {
  const category = categoryFor(provider.group);
  const locationLine = provider.detailed
    ? "<strong>" + escapeHtml(provider.matchedLocation?.city || provider.city) + "</strong>" + (provider.locations.length>1 ? " · "+provider.locations.length+" locations" : "") + (provider.practice ? " · " + escapeHtml(provider.practice) : "")
    : "Office location to verify";
  const distance = Number.isFinite(provider.distance)
    ? '<p class="distance-line">' + provider.distance.toFixed(provider.distance < 10 ? 1 : 0) + " miles from " + escapeHtml(state.origin.label) + "</p>"
    : "";
  const card = [
    '<button class="provider-card ', provider.detailed ? "" : "roster-only", provider.providerType === "organization" ? " organization-card" : "", state.selectedId === provider.id ? " selected" : "", provider.inactive ? " inactive" : "",
    '" style="--category:', category.color, '" type="button" data-provider-id="', escapeHtml(provider.id), '">',
    doctorPhoto(provider),
    "<span>",
    '<h2 class="provider-name">', escapeHtml(provider.name), "</h2>",
    provider.wcApproved ? '<span class="wc-list-badge">WC approved list</span>' : "",
    provider.inactive ? '<span class="inactive-badge">' + iconSvg("close") + 'Inactive</span>' : '',
    doctorNoteTemplate(provider),
    '<p class="provider-specialty">', escapeHtml(provider.specialty), "</p>",
    '<p class="provider-location">', locationLine, "</p>",
    distance,
    "</span>",
    '<span class="card-arrow" aria-hidden="true">', iconSvg(provider.inactive ? "close" : "chevron-right"), "</span>",
    "</button>"
  ].join("");
  return card;
}

function activeFilterCount() {
  return [
    state.detailedOnly,
    state.mappedOnly,
    state.excludePending,
    state.caseType !== "all",
    state.radius !== 25
  ].filter(Boolean).length;
}

function updateFilterUi() {
  $("#advanced-count").textContent = activeFilterCount();
  $("#quick-detailed").classList.toggle("active", state.detailedOnly);
  $("#quick-detailed").setAttribute("aria-pressed", String(state.detailedOnly));
  $("#quick-mapped").classList.toggle("active", state.mappedOnly);
  $("#quick-mapped").setAttribute("aria-pressed", String(state.mappedOnly));
  $("#specialty-label").textContent = specialtySelect.options[specialtySelect.selectedIndex].text;
  $("#body-label").textContent = bodySelect.options[bodySelect.selectedIndex].text;
  $$("[data-service]").forEach(button=>button.setAttribute("aria-pressed",String(button.dataset.service===state.specialty)));
}

function updateFilterSummary(matches) {
  const pieces = [];
  if (state.origin) {
    pieces.push('<span class="distance-summary">' + state.effectiveRadius + " mi around " + escapeHtml(state.origin.label) + "</span>");
  }
  if (state.caseType !== "all") pieces.push("<span>" + escapeHtml(state.caseType) + ": unknown eligibility may appear</span>");
  $("#active-summary").innerHTML = pieces.join("");
}

function updateLocationNotice() {
  const notice = $("#location-notice");
  let message = state.locationMessage;
  let kind = state.locationMessageKind;
  if (state.origin) {
    message = "Showing mapped providers within " + state.effectiveRadius + " miles of " + state.origin.label + ".";
    if (state.origin.approximate) message += " Address location is approximate.";
    if (state.radiusExpanded) message += " No matches were found at " + state.radius + " miles, so the radius expanded automatically.";
    kind = "info";
  }
  notice.hidden = !message;
  notice.classList.toggle("warning", kind === "warning");
  notice.textContent = message;
}

function renderAddressSearchUi() {
  const searchButton = $("#search-button");
  searchButton.disabled = state.locationPending;
  searchButton.textContent = state.locationPending ? "Locating…" : "Search";
  locationInput.setAttribute("aria-busy", String(state.locationPending));
  const choices = $("#address-candidates");
  choices.hidden = state.addressCandidates.length === 0;
  $("#address-candidate-options").innerHTML = state.addressCandidates.map((candidate, index) =>
    '<button type="button" class="address-option" data-address-index="' + index + '">' + escapeHtml(candidate.label) + '</button>'
  ).join("");
}

function render() {
  renderAddressSearchUi();
  const matches = computeResults();
  state.lastMatches = matches;
  count.textContent = matches.length;
  $("#result-noun").textContent = matches.length===1?"network":"networks";
  $("#location-count").textContent = matches.reduce((total,provider)=>total+providerLocations(provider).length,0);
  list.innerHTML = matches.map(cardTemplate).join("");
  emptyState.hidden = matches.length > 0;
  list.hidden = matches.length === 0;
  if (!matches.length) {
    emptyState.querySelector("h2").textContent = "No matching networks";
    emptyState.querySelector("p").textContent = state.origin
      ? "Try a larger radius, another service, or clear the map-area filter."
      : "Try another service, address, city or ZIP.";
  }
  $("#area-filter-banner").hidden = !state.mapBounds;
  updateFilterSummary(matches);
  updateFilterUi();
  updateLocationNotice();
  renderMarkers(matches);
}

function initMap() {
  if (!window.L) {
    $("#map-status").textContent = "Map could not load · list search is still available";
    return;
  }
  map = L.map("map", { zoomControl: false, attributionControl: true, preferCanvas: true }).setView([41.86, -87.85], 9);
  L.control.zoom({ position: "bottomright" }).addTo(map);
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "&copy; OpenStreetMap contributors"
  }).addTo(map);
  map.on("movestart", () => {
    if (!suppressMoveNotice) $("#map-research").classList.add("visible");
  });
}

function markerCategory(group) {
  const categories = Array.from(new Set(group.map((provider) => provider.group)));
  if (categories.length === 1) {
    const config = categoryFor(categories[0]);
    return {
      label: config.label,
      color: config.color,
      symbol: group.length > 1 ? String(group.length) : config.symbol
    };
  }
  return { label: "Multiple services", color: "#153a52", symbol: String(group.length) };
}

function markerIcon(group, selected) {
  const config = markerCategory(group);
  return L.divIcon({
    className: "marker-shell",
    html: '<div class="provider-marker' + (selected ? " selected" : "") + '" style="--marker:' + config.color + '"><svg class="provider-marker-shape" viewBox="0 0 32 42" aria-hidden="true" focusable="false"><path d="M16 1.5C8.82 1.5 3 7.32 3 14.5c0 9.55 13 25.5 13 25.5s13-15.95 13-25.5C29 7.32 23.18 1.5 16 1.5Z"/><text class="provider-marker-label" x="16" y="14.5" text-anchor="middle" dominant-baseline="central">' + escapeHtml(config.symbol) + "</text></svg></div>",
    iconSize: [32, 42],
    iconAnchor: [16, 40]
  });
}

function renderOrigin() {
  if (!map) return;
  if (originLayer) originLayer.remove();
  originLayer = null;
  if (!state.origin) return;
  const center = [state.origin.lat, state.origin.lng];
  const radiusMeters = state.effectiveRadius * 1609.344;
  const pointIcon = L.divIcon({ className: "marker-shell", html: '<div class="origin-marker"></div>', iconSize: [18, 18], iconAnchor: [9, 9] });
  originLayer = L.layerGroup([
    L.circle(center, {
      radius: radiusMeters,
      color: "#153a52",
      weight: 1,
      opacity: .42,
      fillColor: "#153a52",
      fillOpacity: .045,
      interactive: false
    }),
    L.marker(center, { icon: pointIcon, title: state.origin.label, keyboard: false, interactive: false })
  ]).addTo(map);
}

function renderLegend(matches) {
  const configs = [];
  const seen = new Set();
  matches.filter((provider) => mappedLocations(provider).length>0).forEach((provider) => {
    if (!seen.has(provider.group)) {
      seen.add(provider.group);
      configs.push(categoryFor(provider.group));
    }
  });
  $("#map-legend").innerHTML = configs.slice(0, 7).map((config) => (
    '<span><i class="legend-dot" style="--legend:' + config.color + '"></i>' + escapeHtml(config.label) + "</span>"
  )).join("") + (configs.length > 7 ? "<span>+" + (configs.length - 7) + " more</span>" : "");
  $("#map-legend").hidden = configs.length === 0;
}

function applyMarkerInteraction(entry) {
  const element = entry.marker.getElement();
  if (!element) return;
  const cardProvider = entry.group.find(provider => provider.id === (hoveredProviderId || focusedProviderId));
  const selectedProvider = providers.find(provider => provider.id === state.selectedId);
  const selectedOffice = selectedProvider && providerLocations(selectedProvider).find(office => office.id === state.selectedLocationId);
  const selectedKey = selectedOffice && Number.isFinite(selectedOffice.lat) && Number.isFinite(selectedOffice.lng)
    ? selectedOffice.lat.toFixed(5) + "|" + selectedOffice.lng.toFixed(5) : null;
  const selected = entry.group.some(provider => provider.id === state.selectedId &&
    (!selectedKey || selectedKey === provider.lat.toFixed(5) + "|" + provider.lng.toFixed(5)));
  const popupOpen = Boolean(entry.popup && map.hasLayer(entry.popup));
  const highlighted = Boolean(cardProvider || entry.mapHovered || entry.mapFocused || popupOpen);
  const shape = element.querySelector(".provider-marker");
  shape?.classList.toggle("selected", selected);
  shape?.classList.toggle("hovered", highlighted);
  const zIndex = highlighted ? 2000 : selected ? 1000 : 0;
  if (entry.zIndex !== zIndex) {
    entry.marker.setZIndexOffset(zIndex);
    entry.zIndex = zIndex;
  }
  const tooltip = cardProvider
    ? escapeHtml(cardProvider.name) + "<br>" + escapeHtml(cardProvider.specialty)
    : entry.defaultTooltip;
  if (entry.tooltip !== tooltip) {
    entry.marker.setTooltipContent(tooltip);
    entry.tooltip = tooltip;
  }
  if (highlighted && !popupOpen) entry.marker.openTooltip();
  else entry.marker.closeTooltip();
}

function setCardHighlight(id, kind) {
  const affectedIds = [hoveredProviderId, focusedProviderId];
  if (kind === "focus") focusedProviderId = id;
  else hoveredProviderId = id;
  affectedIds.push(hoveredProviderId, focusedProviderId);
  new Set(affectedIds.flatMap(providerId => Array.from(markerGroups.get(providerId)||[]))).forEach(applyMarkerInteraction);
}

function groupPopupContent(entry) {
  const content = document.createElement("section");
  content.className = "map-provider-group";
  const heading = document.createElement("h3");
  heading.textContent = entry.group.length + " providers at this location";
  const hint = document.createElement("p");
  hint.className = "map-group-hint";
  hint.textContent = "Choose a provider to view details.";
  const choices = document.createElement("div");
  choices.className = "map-group-options";
  entry.group.forEach(provider => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "map-group-provider";
    const name = document.createElement("strong");
    name.textContent = provider.name;
    const specialty = document.createElement("span");
    specialty.textContent = provider.specialty;
    const office = document.createElement("small");
    office.textContent = provider.practice + " · " + (provider.mapLocation?.address||provider.address);
    button.append(name, specialty, office);
    button.addEventListener("click", event => {
      event.preventDefault();
      event.stopPropagation();
      selectProvider(provider.id, true, provider.mapLocation?.id);
    });
    choices.appendChild(button);
  });
  content.append(heading, hint, choices);
  return content;
}

function ensureMarkerPopup(entry) {
  if (!entry.popup) {
    entry.popup = L.popup({ className: "provider-group-popup", minWidth: 220, maxWidth: 340,
      autoPanPaddingTopLeft: [24, 68], autoPanPaddingBottomRight: [24, 90], offset: [0, -31] });
    entry.popup.on("add remove", () => applyMarkerInteraction(entry));
  }
  entry.popup.options.maxHeight = Math.max(100, Math.min(360, map.getSize().y - 180));
  return entry.popup;
}

function officePopupContent(entry) {
  const provider = providers.find(item => item.id === entry.focusedOffice?.providerId);
  const office = provider && providerLocations(provider).find(item => item.id === entry.focusedOffice.locationId);
  if (!office || provider.inactive || !entry.group.some(item => item.id === provider.id)) return null;
  const content = document.createElement("section");
  content.className = "map-office-focus";
  const heading = document.createElement("h3");
  heading.textContent = office.label || office.city || "Office location";
  const name = document.createElement("p");
  name.className = "map-office-doctor";
  name.textContent = provider.name;
  const address = document.createElement("p");
  address.className = "map-office-address";
  address.textContent = office.address;
  const actions = document.createElement("div");
  actions.className = "map-office-actions";
  const directions = document.createElement("a");
  directions.href = "https://www.google.com/maps/dir/?api=1&destination=" + encodeURIComponent(office.address);
  directions.target = "_blank";
  directions.rel = "noreferrer";
  directions.textContent = "Directions";
  const details = document.createElement("button");
  details.type = "button";
  details.textContent = "Back to network";
  details.addEventListener("click", () => selectProvider(provider.id, true, office.id));
  actions.append(directions, details);
  content.append(heading, name, address, actions);
  if (entry.group.length > 1) {
    const shared = document.createElement("details");
    shared.className = "map-office-shared";
    const summary = document.createElement("summary");
    summary.textContent = entry.group.length + " providers at this address";
    shared.append(summary, groupPopupContent(entry));
    content.append(shared);
  }
  return content;
}

function openMarkerProviders(entry) {
  entry.focusedOffice = null;
  if (entry.group.length === 1) {
    selectProvider(entry.group[0].id, true, entry.group[0].mapLocation?.id);
    return;
  }
  if (entry.popup && map.hasLayer(entry.popup)) {
    map.closePopup(entry.popup);
    return;
  }
  ensureMarkerPopup(entry).setLatLng(entry.marker.getLatLng()).setContent(groupPopupContent(entry)).openOn(map);
  applyMarkerInteraction(entry);
}

function wireMarkerFocus(entry) {
  const element = entry.marker.getElement();
  if (!element || entry.focusElement === element) return;
  entry.focusElement = element;
  element.addEventListener("focus", () => { entry.mapFocused = true; applyMarkerInteraction(entry); });
  element.addEventListener("blur", () => { entry.mapFocused = false; applyMarkerInteraction(entry); });
}

function renderMarkers(matches) {
  if (!map) return;
  renderOrigin();
  const grouped = new Map();
  matches.forEach(provider => visibleMapLocations(provider).forEach(office => {
    const key = office.lat.toFixed(5) + "|" + office.lng.toFixed(5);
    if (!grouped.has(key)) grouped.set(key, []);
    if(!grouped.get(key).some(p=>p.id===provider.id))grouped.get(key).push({...provider,lat:office.lat,lng:office.lng,mapLocation:office});
  }));
  markerEntries.forEach((entry, key) => {
    if (grouped.has(key)) return;
    if (entry.popup) map.closePopup(entry.popup);
    entry.marker.remove();
    markerEntries.delete(key);
  });
  markerGroups.clear();
  grouped.forEach((items, key) => {
    const group = items.slice().sort((left, right) => left.name.localeCompare(right.name));
    const signature = group.map(provider => [provider.id,provider.name,provider.group,provider.mapLocation?.address].join(":")).join("|");
    let entry = markerEntries.get(key);
    if (!entry) {
      const marker = L.marker([group[0].lat, group[0].lng], { icon: markerIcon(group, false), keyboard: true });
      entry = { marker, group, signature, mapHovered: false, mapFocused: false };
      marker.bindTooltip("", { className: "provider-tooltip", direction: "top", offset: [0, -36] });
      marker.on("click", () => openMarkerProviders(entry));
      marker.on("mouseover", () => { entry.mapHovered = true; applyMarkerInteraction(entry); });
      marker.on("mouseout", () => { entry.mapHovered = false; applyMarkerInteraction(entry); });
      marker.addTo(map);
      markerEntries.set(key, entry);
    } else {
      entry.group = group;
      if (entry.signature !== signature) {
        entry.marker.setIcon(markerIcon(group, false));
        entry.signature = signature;
      }
      if (entry.popup && map.hasLayer(entry.popup)) {
        if (entry.focusedOffice) {
          const content = officePopupContent(entry);
          if (content) entry.popup.setContent(content);
          else map.closePopup(entry.popup);
        } else if (group.length > 1) entry.popup.setContent(groupPopupContent(entry));
        else map.closePopup(entry.popup);
      }
    }
    const tooltipNames = group.slice(0, 4).map(provider => escapeHtml(provider.name)).join("<br>");
    entry.defaultTooltip = tooltipNames + (group.length > 4 ? "<br>+" + (group.length - 4) + " more" : "");
    const label = group.length === 1 ? group[0].name : group.length + " providers at this location. Open to choose a provider.";
    entry.marker.getElement()?.setAttribute("aria-label", label);
    wireMarkerFocus(entry);
    group.forEach(provider => {
      if(!markerGroups.has(provider.id))markerGroups.set(provider.id,new Set());
      markerGroups.get(provider.id).add(entry);
    });
    applyMarkerInteraction(entry);
  });
  if (!markerGroups.has(hoveredProviderId)) hoveredProviderId = null;
  if (!markerGroups.has(focusedProviderId)) focusedProviderId = null;
  const mappedCount = matches.filter(provider => mappedLocations(provider).length>0).length;
  $("#map-status").innerHTML = '<span class="pulse-dot"></span>' + mappedCount + " providers mapped · "+grouped.size+" locations · " + (matches.length - mappedCount) + " list-only";
  renderLegend(matches);
}

function detailTemplate(provider) {
  const category = categoryFor(provider.group);
  const selectedOffice=provider.locations.find(p=>p.id===state.selectedLocationId)||provider.locations[0];
  const contact = directoryContactInfo(provider, selectedOffice);
  const mapsUrl = selectedOffice
    ? "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(selectedOffice.address)
    : "#";
  const factLink = (label, url) => {
    if (!url || !/^https?:\/\//i.test(url)) return "";
    return '<p class="detail-fact"><span>' + label + '</span><a href="' + escapeHtml(url) + '" target="_blank" rel="noreferrer">' + escapeHtml(new URL(url).hostname) + '</a></p>';
  };
  const phoneUrl = contact.phone ? "tel:" + contact.phone.replace(/[^\d+]/g, "") : "#";
  const caseTypeText = [
    provider.caseRules.wc === "yes" ? "Workers’ Comp" : provider.caseRules.wc === "no" ? "No Workers’ Comp" : "",
    provider.caseRules.pi === "yes" ? "Personal Injury" : provider.caseRules.pi === "no" ? "No Personal Injury" : ""
  ].filter(Boolean).join(" · ") || "Confirm case acceptance";
  return [
    '<section class="detail-hero" style="--category:', category.color, '">',
    '<div class="detail-doctor-heading">',doctorPhoto(provider,true),'<div>',
    '<div class="detail-category"><span class="detail-category-mark" aria-hidden="true">', escapeHtml(category.symbol), '</span><p class="detail-kicker">', escapeHtml(category.label), "</p></div>",
    "<h2>", escapeHtml(provider.name), "</h2>",
    provider.wcApproved ? '<span class="wc-list-badge">WC approved list</span>' : "",
    doctorNoteTemplate(provider),
    '<p class="detail-subtitle">', escapeHtml([provider.specialty,provider.practice].filter(Boolean).join(" · ")), "</p>",
    '</div></div>',
    "</section>",
    '<section class="detail-section"><h3>Referral details</h3>',
    '<p class="detail-address">', escapeHtml(selectedOffice?.address||provider.address), '</p>',
    provider.hours !== "Not provided" ? '<p class="detail-fact"><span>Hours</span>' + escapeHtml(provider.hours) + '</p>' : '',
    '<p class="detail-fact"><span>Case type</span>', escapeHtml(caseTypeText), '</p>',
    coversAllBodyAreas(provider) || provider.bodyAreas.length ? '<p class="detail-fact"><span>Body area</span>' + escapeHtml(coversAllBodyAreas(provider) ? "All body areas" : provider.bodyAreas.join(", ")) + '</p>' : '',
    provider.languages.length ? '<p class="detail-fact"><span>Languages</span>' + escapeHtml(provider.languages.join(", ")) + '</p>' : '',
    provider.rawStatus === "Pending" ? '<p class="detail-fact"><span>Status</span>Pending</p>' : '',
    factLink("Website", provider.website), factLink("Office locations", provider.locationsUrl),
    '</section>',
    directoryContactSection(provider, selectedOffice),
    doctorLocationsSection(provider),
    provider.restrictions.length ? '<section class="detail-section"><h3>Referral notes</h3><ul class="restriction-list">' + provider.restrictions.map((item) => '<li>' + escapeHtml(item) + '</li>').join('') + '</ul></section>' : '',
    '<p class="verification-note">Confirm current availability with the office.</p>',
    '<div class="sheet-actions">',
    '<a class="', selectedOffice ? "" : "disabled", '" href="', mapsUrl, '" target="_blank" rel="noreferrer">Directions</a>',
    '<a class="', contact.phone ? "" : "disabled", '" href="', phoneUrl, '">Call office</a>',
    "</div>"
  ].join("");
}

function focusProviderOnMap(provider, locationId) {
  const points=mappedLocations(provider),office=points.find(p=>p.id===locationId);
  if (!map || !points.length) return;
  suppressMoveNotice = true;
  if(office||points.length===1){const p=office||points[0];map.panTo([p.lat,p.lng], { animate: !window.matchMedia("(prefers-reduced-motion: reduce)").matches, duration: .22 });}
  else map.fitBounds(L.latLngBounds(points.map(p=>[p.lat,p.lng])),{padding:[48,48],maxZoom:12,animate:false});
  window.setTimeout(() => { suppressMoveNotice = false; }, 300);
}

function selectProvider(id, openSheet, locationId) {
  const provider = providers.find((item) => item.id === id);
  if (!provider || provider.inactive) return;
  map?.closePopup();
  hoveredProviderId = null;
  focusedProviderId = null;
  state.selectedId = id;
  state.selectedLocationId=locationId||null;
  focusProviderOnMap(provider,locationId);
  render();
  if (openSheet) openDetails(provider);
}

function showOfficeOnMap(provider, locationId) {
  const office = mappedLocations(provider).find(item => item.id === locationId);
  if (!map || !office) {
    showToast("Map unavailable for this office. Use Directions to open its address.");
    return;
  }
  cancelLocationLookup();
  state.origin = null;
  state.mapBounds = null;
  state.locationMode = "none";
  state.location = "";
  state.locationMessage = "";
  locationInput.value = "";
  state.selectedId = provider.id;
  state.selectedLocationId = office.id;
  hoveredProviderId = null;
  focusedProviderId = null;
  closePanels({ restoreFocus: false, immediate: true });
  document.body.classList.add("map-view");
  render();
  suppressMoveNotice = true;
  map.invalidateSize({ pan: false });
  map.setView([office.lat, office.lng], Math.max(map.getZoom(), 16), { animate: false });
  const entry = markerEntries.get(office.lat.toFixed(5) + "|" + office.lng.toFixed(5));
  if (entry) {
    entry.focusedOffice = { providerId: provider.id, locationId: office.id };
    const content = officePopupContent(entry);
    if (content) {
      ensureMarkerPopup(entry).setLatLng(entry.marker.getLatLng()).setContent(content).openOn(map);
      applyMarkerInteraction(entry);
      entry.popup.getElement()?.querySelector(".map-office-actions button")?.focus({ preventScroll: true });
    }
  }
  window.setTimeout(() => { suppressMoveNotice = false; }, 300);
}

function openPanel(panel) {
  window.clearTimeout(panelCloseTimer);
  const activeElement = document.activeElement;
  const selectedCard = state.selectedId ? $('[data-provider-id="' + state.selectedId + '"]', list) : null;
  lastFocusedElement = activeElement === document.body || (activeElement && activeElement.closest && activeElement.closest(".side-sheet"))
    ? (selectedCard || $(".brand"))
    : activeElement;
  $$(".side-sheet.open").forEach((item) => {
    item.classList.remove("open");
    item.setAttribute("aria-hidden", "true");
  });
  scrim.hidden = false;
  panel.classList.add("open");
  panel.setAttribute("aria-hidden", "false");
  if (panel !== filterSheet) moreFilterButton.setAttribute("aria-expanded", "false");
  window.setTimeout(() => {
    const focusable = panel.querySelector("button, a, input, select, textarea");
    if (focusable) focusable.focus({ preventScroll: true });
  }, 20);
}

function openDetails(provider) {
  if (provider.inactive) return;
  detailContent.innerHTML = detailTemplate(provider);
  openPanel(detailSheet);
}

function openFilters() {
  $("#detailed-only").checked = state.detailedOnly;
  $("#mapped-only").checked = state.mappedOnly;
  $("#exclude-pending").checked = state.excludePending;
  $('input[name="radius"][value="' + state.radius + '"]').checked = true;
  $('input[name="case-type"][value="' + state.caseType + '"]').checked = true;
  moreFilterButton.setAttribute("aria-expanded", "true");
  openPanel(filterSheet);
}

function closePanels({ restoreFocus = true, immediate = false } = {}) {
  window.clearTimeout(panelCloseTimer);
  $$(".side-sheet").forEach((panel) => {
    panel.classList.remove("open");
    panel.setAttribute("aria-hidden", "true");
  });
  moreFilterButton.setAttribute("aria-expanded", "false");
  if (immediate) scrim.hidden = true;
  else panelCloseTimer = window.setTimeout(() => { scrim.hidden = true; }, 220);
  if (restoreFocus && lastFocusedElement && document.contains(lastFocusedElement)) lastFocusedElement.focus({ preventScroll: true });
}

function resetAdvancedControls() {
  $("#detailed-only").checked = false;
  $("#mapped-only").checked = false;
  $("#exclude-pending").checked = false;
  $('input[name="radius"][value="25"]').checked = true;
  $('input[name="case-type"][value="all"]').checked = true;
}

function applyAdvancedFilters() {
  state.detailedOnly = $("#detailed-only").checked;
  state.mappedOnly = $("#mapped-only").checked;
  state.excludePending = $("#exclude-pending").checked;
  state.radius = Number($('input[name="radius"]:checked').value);
  state.caseType = $('input[name="case-type"]:checked').value;
  closePanels();
  render();
}

function resetFilters() {
  cancelLocationLookup();
  Object.assign(state, {
    query: "",
    location: "",
    locationMode: "none",
    specialty: "all",
    body: "all",
    caseType: "all",
    sort: "source",
    selectedId: null,
    detailedOnly: false,
    mappedOnly: false,
    excludePending: false,
    radius: 25,
    effectiveRadius: 25,
    radiusExpanded: false,
    origin: null,
    mapBounds: null,
    locationMessage: "",
    locationMessageKind: "info"
  });
  searchInput.value = "";
  locationInput.value = "";
  specialtySelect.value = "all";
  bodySelect.value = "all";
  sortSelect.value = state.sort;
  resetAdvancedControls();
  $("#map-research").classList.remove("visible");
  render();
  focusCurrentMatches();
}

function focusCurrentMatches() {
  if (!map) return;
  const points = state.lastMatches.flatMap(visibleMapLocations).map(p=>[p.lat,p.lng]);
  if (!points.length && !state.origin) return;
  suppressMoveNotice = true;
  if (state.origin) points.push([state.origin.lat, state.origin.lng]);
  if (points.length === 1) map.setView(points[0], 11, { animate: false });
  else map.fitBounds(L.latLngBounds(points), { padding: [48, 48], maxZoom: 12, animate: false });
  window.setTimeout(() => { suppressMoveNotice = false; }, 140);
  $("#map-research").classList.remove("visible");
}

function cancelLocationLookup() {
  locationSuggestions?.close();
  locationLookupVersion += 1;
  if (activeAddressRequest) activeAddressRequest.abort();
  activeAddressRequest = null;
  if (state.locationPending) {
    state.locationMessage = "";
    state.locationMode = "none";
  }
  state.locationPending = false;
  state.addressCandidates = [];
  $("#use-location").disabled = false;
  $("#use-location").classList.remove("loading");
  return locationLookupVersion;
}

function chooseAddress(candidate) {
  cancelLocationLookup();
  state.origin = Object.assign({}, candidate, { query: normalized(candidate.label) });
  state.location = candidate.label;
  locationInput.value = candidate.label;
  state.locationMode = "origin";
  state.locationMessage = "";
  state.mapBounds = null;
  state.sort = "distance";
  sortSelect.value = "distance";
  render();
  focusCurrentMatches();
}

async function performSearch() {
  const requestId = cancelLocationLookup();
  state.query = searchInput.value.trim();
  state.location = locationInput.value.trim();
  state.mapBounds = null;
  state.locationMessage = "";
  const preserveOrigin = state.origin && (
    (state.origin.source === "browser" && normalized(state.location) === "current location")
    || (state.origin.query && state.origin.query === normalized(state.location))
  );
  const resolution = preserveOrigin
    ? { mode: "origin", origin: state.origin }
    : locationUtils.resolveLocationSearch(state.location, activeDirectoryLocations());
  state.locationMode = resolution.mode;
  if (resolution.mode === "address") {
    state.origin = null;
    state.locationPending = true;
    state.locationMessage = "Finding this street address…";
    state.locationMessageKind = "info";
    activeAddressRequest = new AbortController();
    render();
    try {
      const matches = await window.LFMM_ADDRESS_GEOCODER.search(state.location, { signal: activeAddressRequest.signal });
      if (requestId !== locationLookupVersion) return;
      if (matches.length === 1) {
        chooseAddress(matches[0]);
        return;
      }
      state.addressCandidates = matches;
      state.locationMode = matches.length ? "choice" : "unresolved";
      state.locationMessage = matches.length
        ? "More than one address matched. Choose the location to search around."
        : "No street address matched. Include the street number and city/state or ZIP, or search a five-digit ZIP. No location filter has been applied.";
      state.locationMessageKind = matches.length ? "info" : "warning";
    } catch (error) {
      if (requestId !== locationLookupVersion || error.name === "AbortError") return;
      state.locationMode = "unresolved";
      state.locationMessage = "Address lookup is unavailable. Try again, or use a listed city or five-digit ZIP. No location filter has been applied.";
      state.locationMessageKind = "warning";
    } finally {
      if (requestId === locationLookupVersion) {
        state.locationPending = false;
        activeAddressRequest = null;
        render();
      }
    }
    return;
  }
  if (resolution.origin) {
    state.origin = resolution.origin;
    state.sort = "distance";
    sortSelect.value = "distance";
  } else {
    state.origin = null;
    if (state.location) {
      if (resolution.mode === "text") {
        state.locationMessage = "Showing providers whose saved directory address matches this location.";
        state.locationMessageKind = "info";
      } else {
        state.locationMessage = "Enter a U.S. street number and address with city/state or ZIP, a listed city, or a five-digit ZIP. This location was not matched; your other filters still work.";
        state.locationMessageKind = "warning";
      }
    }
  }
  render();
  focusCurrentMatches();
}

function useCurrentLocation() {
  const requestId = cancelLocationLookup();
  const button = $("#use-location");
  if (!navigator.geolocation) {
    state.locationMessage = "This browser does not provide location access. Search an address, listed city or ZIP instead.";
    state.locationMessageKind = "warning";
    state.origin = null;
    state.locationMode = "none";
    render();
    return;
  }
  button.classList.add("loading");
  button.disabled = true;
  state.origin = null;
  state.locationMessage = "Requesting your browser location…";
  state.locationMessageKind = "info";
  updateLocationNotice();
  navigator.geolocation.getCurrentPosition((position) => {
    if (requestId !== locationLookupVersion) return;
    state.origin = {
      lat: position.coords.latitude,
      lng: position.coords.longitude,
      label: "your current location",
      source: "browser"
    };
    state.locationMode = "origin";
    state.location = "";
    state.mapBounds = null;
    state.sort = "distance";
    state.locationMessage = "";
    locationInput.value = "Current location";
    sortSelect.value = "distance";
    button.classList.remove("loading");
    button.disabled = false;
    render();
    focusCurrentMatches();
  }, () => {
    if (requestId !== locationLookupVersion) return;
    state.origin = null;
    state.locationMode = "none";
    state.locationMessage = "Location was unavailable or denied. Search an address, listed city or ZIP instead.";
    state.locationMessageKind = "warning";
    button.classList.remove("loading");
    button.disabled = false;
    render();
  }, { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 });
}

function showToast(message) {
  const toast = $("#toast");
  window.clearTimeout(toastTimer);
  toast.textContent = message;
  toast.hidden = false;
  toastTimer = window.setTimeout(() => { toast.hidden = true; }, 2800);
}

function focusTrap(event) {
  const panel = $(".side-sheet.open");
  if (!panel || event.key !== "Tab") return;
  const focusable = $$('button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled])', panel)
    .filter((element) => element.offsetParent !== null);
  if (!focusable.length) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

list.addEventListener("click", (event) => {
  const card = event.target.closest("[data-provider-id]");
  if (card) {
    const match = state.lastMatches.find(provider => provider.id === card.dataset.providerId);
    selectProvider(card.dataset.providerId, true, match?.matchedLocation?.id);
  }
});

list.addEventListener("pointerover", (event) => {
  const card = event.target.closest("[data-provider-id]");
  if (!card || event.pointerType === "touch" || (event.relatedTarget instanceof Node && card.contains(event.relatedTarget))) return;
  setCardHighlight(card.dataset.providerId, "hover");
});

list.addEventListener("pointerout", (event) => {
  const card = event.target.closest("[data-provider-id]");
  if (!card || (event.relatedTarget instanceof Node && card.contains(event.relatedTarget))) return;
  if (hoveredProviderId === card.dataset.providerId) setCardHighlight(null, "hover");
});

list.addEventListener("focusin", event => {
  const card = event.target.closest("[data-provider-id]");
  if (card) setCardHighlight(card.dataset.providerId, "focus");
});

list.addEventListener("focusout", event => {
  const card = event.target.closest("[data-provider-id]");
  if (!card || (event.relatedTarget instanceof Node && card.contains(event.relatedTarget))) return;
  if (focusedProviderId === card.dataset.providerId) setCardHighlight(null, "focus");
});

searchInput.addEventListener("input", (event) => {
  state.query = event.target.value;
  render();
});

locationInput.addEventListener("input", (event) => {
  cancelLocationLookup();
  state.location = event.target.value;
  state.locationMode = "none";
  if (state.origin) {
    state.origin = null;
    state.sort = "source";
    sortSelect.value = state.sort;
  }
  state.locationMessage = "";
  render();
  if (!event.isComposing) locationSuggestions?.schedule();
});

$("#address-candidate-options").addEventListener("click", (event) => {
  const button = event.target.closest("[data-address-index]");
  const candidate = button && state.addressCandidates[Number(button.dataset.addressIndex)];
  if (candidate) chooseAddress(candidate);
});

[searchInput, locationInput].forEach((input) => input.addEventListener("keydown", (event) => {
  if (input === locationInput && locationSuggestions?.handleKey(event)) return;
  if (event.isComposing) return;
  if (event.key === "Enter") {
    event.preventDefault();
    performSearch();
  }
}));

specialtySelect.addEventListener("change", (event) => {
  state.specialty = event.target.value;
  render();
});

bodySelect.addEventListener("change", (event) => {
  state.body = event.target.value;
  render();
});

sortSelect.addEventListener("change", (event) => {
  state.sort = event.target.value;
  render();
});

$("#quick-detailed").addEventListener("click", () => {
  state.detailedOnly = !state.detailedOnly;
  render();
});

$("#quick-mapped").addEventListener("click", () => {
  state.mappedOnly = !state.mappedOnly;
  render();
});

$("#clear-filters").addEventListener("click", resetFilters);
$("#empty-reset").addEventListener("click", resetFilters);
$("#sheet-close").addEventListener("click", closePanels);
$("#filter-close").addEventListener("click", closePanels);
moreFilterButton.addEventListener("click", openFilters);
$("#advanced-reset").addEventListener("click", resetAdvancedControls);
$("#advanced-apply").addEventListener("click", applyAdvancedFilters);
$("#search-button").addEventListener("click", performSearch);
$("#use-location").addEventListener("click", useCurrentLocation);
$("#clear-map-area").addEventListener("click", () => {
  state.mapBounds = null;
  render();
  showToast("Map-area filter cleared.");
});

$("#mobile-view-toggle").addEventListener("click", () => {
  document.body.classList.toggle("map-view");
  if (document.body.classList.contains("map-view") && map) window.setTimeout(() => map.invalidateSize(), 230);
});

scrim.addEventListener("click", closePanels);

$("#map-research").addEventListener("click", () => {
  if (!map) return;
  const bounds = map.getBounds();
  state.mapBounds = {
    north: bounds.getNorth(),
    south: bounds.getSouth(),
    east: bounds.getEast(),
    west: bounds.getWest()
  };
  $("#map-research").classList.remove("visible");
  render();
  showToast("List filtered to the visible map area.");
});

detailContent.addEventListener("click", (event) => {
  const action = event.target.closest('[data-action="show-doctor-location"]');
  if (!action) return;
  const provider = providers.find(item => item.id === action.dataset.providerId);
  if (!provider) return;
  if(action.dataset.action==="show-doctor-location"){
    showOfficeOnMap(provider, action.dataset.locationId);return;
  }
});

document.addEventListener("keydown", (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
    event.preventDefault();
    searchInput.focus();
  }
  if (event.key === "Escape" && $(".side-sheet.open")) closePanels();
  focusTrap(event);
});

document.addEventListener("error",event=>{
  if(event.target.matches?.("img[data-provider-photo]"))event.target.remove();
},true);

setupFilters();
$$("[data-service]").forEach(button=>button.addEventListener("click",()=>{state.specialty=button.dataset.service;specialtySelect.value=state.specialty;render();}));
initMap();
locationSuggestions = window.LFMM_ADDRESS_SUGGESTIONS.create({
  input: locationInput,
  getProviders: activeDirectoryLocations,
  getBias: () => {
    const center = map?.getCenter();
    return center ? { lat: center.lat, lng: center.lng } : { lat: 41.8781, lng: -87.6298 };
  },
  onSelect: (candidate) => {
    if (candidate.needsGeocode) {
      locationInput.value = candidate.searchText;
      void performSearch();
    } else chooseAddress(candidate);
  }
});
render();
focusCurrentMatches();
