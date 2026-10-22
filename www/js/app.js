// SPDX-FileCopyrightText: 2026 Martin Helwig
//
// SPDX-License-Identifier: MIT

// www/js/app.js - A weather dashboard for big monitors, tablets and phones (a separate browser application).
//
// Two internet requests at most: the selected city from Open-Meteo Geocoding (kept for 24 hours) and one request to
// open-meteo.com for everything on the page (current values, 24 hours of detail and 16 days; kept for 10 minutes, the page
// asks again every 15 minutes while it is open). Texts: texts.js, icons: icons.js. Nothing is sent anywhere else.
//   ?lang=de|en and ?theme=auto|light|dark in the address choose the language and the look (and are remembered).
"use strict";

const $ = (id) => document.getElementById(id);
const API_GEO = "https://geocoding-api.open-meteo.com/v1";
const API_WX = "https://api.open-meteo.com/v1/forecast";
const WX_PARAMS = {
  timezone: "auto",
  forecast_days: "16",
  wind_speed_unit: "kmh",
  current:
    "temperature_2m,relative_humidity_2m,apparent_temperature,is_day,precipitation,weather_code,cloud_cover,pressure_msl,wind_speed_10m,wind_direction_10m,wind_gusts_10m",
  hourly:
    "temperature_2m,precipitation_probability,weather_code,is_day,visibility,dew_point_2m,uv_index,pressure_msl",
  daily:
    "weather_code,temperature_2m_max,temperature_2m_min,apparent_temperature_max,apparent_temperature_min,sunrise,sunset,daylight_duration,sunshine_duration,uv_index_max,precipitation_sum,precipitation_hours,precipitation_probability_max,snowfall_sum,wind_speed_10m_max,wind_gusts_10m_max,wind_direction_10m_dominant",
};
const WX_VERSION = "16d-1"; // the saved answer of an older version of the request is not used
const CACHE_DB = "weather-dashboard-cache",
  CACHE_KEY_ALIAS = "weather-cache-key";
const TTL_LOCATION = 24 * 3600e3,
  TTL_WEATHER = 10 * 60e3,
  REFRESH_MS = 15 * 60e3,
  MIN_MANUAL_MS = 60e3,
  TIMEOUT_MS = 12e3;

let lang = "de",
  theme = "auto",
  loc = null,
  wx = null,
  wxAt = 0,
  loading = false,
  error = "",
  pendingDay = null,
  city = "Berlin";
let citySearchTimer = 0,
  citySearchSequence = 0;
const preferredColorScheme = window.matchMedia("(prefers-color-scheme: dark)");

// --- Encrypted storage (unavailable storage behaves like an empty cache) ---------------------------------------
function openCacheDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(CACHE_DB, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("keys")) db.createObjectStore("keys");
      if (!db.objectStoreNames.contains("cache")) db.createObjectStore("cache");
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
function cacheTransaction(db, storeName, mode, operation) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, mode);
    const request = operation(transaction.objectStore(storeName));
    let result;
    request.onsuccess = () => {
      result = request.result;
    };
    request.onerror = () => reject(request.error);
    transaction.oncomplete = () => resolve(result);
    transaction.onerror = () => reject(transaction.error || request.error);
    transaction.onabort = () => reject(transaction.error || request.error);
  });
}
async function cacheKey(db, create) {
  let key = await cacheTransaction(db, "keys", "readonly", (store) =>
    store.get(CACHE_KEY_ALIAS),
  );
  if (!key && create) {
    key = await window.crypto.subtle.generateKey(
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"],
    );
    await cacheTransaction(db, "keys", "readwrite", (store) =>
      store.put(key, CACHE_KEY_ALIAS),
    );
  }
  return key;
}
async function readCache(key) {
  let db;
  try {
    db = await openCacheDB();
    const encrypted = await cacheTransaction(db, "cache", "readonly", (store) =>
      store.get(key),
    );
    if (!encrypted) return null;
    const cryptoKey = await cacheKey(db, false);
    if (!cryptoKey) return null;
    const plaintext = await window.crypto.subtle.decrypt(
      { name: "AES-GCM", iv: encrypted.iv },
      cryptoKey,
      encrypted.data,
    );
    return JSON.parse(new TextDecoder().decode(plaintext));
  } catch {
    return null;
  } finally {
    db?.close();
  }
}
async function writeCache(key, value) {
  let db;
  try {
    db = await openCacheDB();
    const cryptoKey = await cacheKey(db, true);
    const iv = window.crypto.getRandomValues(new Uint8Array(12));
    const data = await window.crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      cryptoKey,
      new TextEncoder().encode(JSON.stringify(value)),
    );
    await cacheTransaction(db, "cache", "readwrite", (store) =>
      store.put({ iv, data }, key),
    );
  } catch {
    // The cache is optional; unavailable storage is treated like a cache miss.
  } finally {
    db?.close();
  }
}
function t(key) {
  return globalThis.WX_TEXT[lang][key] !== undefined
    ? globalThis.WX_TEXT[lang][key]
    : key;
}
const locale = () => (lang === "de" ? "de-DE" : "en-GB");
const num = (v, digits) =>
  v === null || v === undefined || isNaN(v)
    ? "–"
    : Number(v).toLocaleString(locale(), {
        maximumFractionDigits: digits || 0,
        minimumFractionDigits: digits || 0,
      });
const temp = (v) =>
  v === null || v === undefined || isNaN(v) ? "–" : num(Math.round(v)) + "°";

// --- The two requests -------------------------------------------------------------------------------------------
async function getJson(url) {
  const ctl = new AbortController(),
    timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(url, { signal: ctl.signal });
    if (!r.ok) throw new Error("HTTP " + r.status);
    return await r.json();
  } finally {
    clearTimeout(timer);
  }
}

function placeFromResult(result) {
  return {
    city: result.name,
    region: result.admin1 || result.name,
    country: result.country,
    lat: result.latitude,
    lon: result.longitude,
    timezone: result.timezone,
    at: Date.now(),
  };
}

async function searchCities(query) {
  const language = lang === "de" ? "de" : "en";
  const data = await getJson(
    API_GEO +
      "/search?name=" +
      encodeURIComponent(query) +
      "&count=6&language=" +
      language +
      "&format=json",
  );
  return Array.isArray(data.results) ? data.results : [];
}

async function locate(cityName) {
  const language = lang === "de" ? "de" : "en";
  const saved = await readCache("wx.loc");

  if (
    saved &&
    saved.city?.toLowerCase() === cityName?.toLowerCase() &&
    Date.now() - saved.at < TTL_LOCATION
  ) {
    return saved;
  }

  let d;
  try {
    d = await getJson(
      API_GEO +
        "/search?name=" +
        encodeURIComponent(cityName) +
        "&count=1&language=" +
        language +
        "&format=json",
    );

    if (!d.results || d.results.length === 0) {
      throw new Error("location not found");
    }
  } catch (e) {
    if (saved && saved.city?.toLowerCase() === cityName?.toLowerCase()) {
      return saved;
    }
    throw e;
  }

  const place = placeFromResult(d.results[0]);
  await writeCache("wx.loc", place);
  return place;
}

async function forecast(place, force) {
  const key =
      place.lat.toFixed(2) + "," + place.lon.toFixed(2) + "|" + WX_VERSION,
    saved = await readCache("wx.data");
  if (saved && saved.key === key) {
    wx = saved.data;
    wxAt = saved.at;
    if (Date.now() - saved.at < (force ? MIN_MANUAL_MS : TTL_WEATHER)) {
      return false; // young enough: no request
    }
  }
  const q = new URLSearchParams(WX_PARAMS);
  q.set("latitude", place.lat);
  q.set("longitude", place.lon);
  wx = await getJson(API_WX + "?" + q.toString());
  wxAt = Date.now();
  await writeCache("wx.data", { key, at: wxAt, data: wx });
  return true;
}

async function load(force, citySelection) {
  if (loading) return;
  let selectedPlace = null;
  if (citySelection !== undefined) {
    const requestedCity =
      typeof citySelection === "string"
        ? citySelection.trim()
        : citySelection.name;
    if (!requestedCity) return;
    if (typeof citySelection !== "string") {
      selectedPlace = placeFromResult(citySelection);
    }
    const cityChanged = requestedCity.toLowerCase() !== city.toLowerCase();
    const placeChanged =
      selectedPlace &&
      loc &&
      (selectedPlace.lat !== loc.lat || selectedPlace.lon !== loc.lon);
    if (cityChanged || placeChanged) {
      loc = null;
      wx = null;
      wxAt = 0;
      $("dash").hidden = true;
    }
    city = requestedCity;
    $("city-input").value = city;
  }
  loading = true;
  error = "";
  if (!wx) status(t("loading"), "busy");
  try {
    if (selectedPlace) {
      loc = selectedPlace;
      await writeCache("wx.loc", loc);
    } else {
      loc = await locate(city);
    }
    void writeCache("wx.city", city);
  } catch {
    error = "err_loc";
  }
  if (loc) {
    try {
      await forecast(loc, force);
    } catch {
      error = "err_wx";
    }
  }
  loading = false;
  if (wx) {
    $("status").hidden = true;
    render();
    if (!error) setCitySearchOpen(false, false);
    if (error) status(t("err_stale") + " " + stamp(wxAt), "warn");
    if (pendingDay !== null) {
      openDay(Math.min(pendingDay, wx.daily.time.length - 1));
      pendingDay = null;
    } // ?day=3 opens the fourth day
  } else status(t(error || "err_wx"), "err", true);
}

function status(text, kind, retry) {
  const el = $("status");
  el.hidden = false;
  el.className = "status " + kind;
  el.textContent = text;
  if (retry) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "btn";
    b.textContent = t("retry");
    b.onclick = () => load(true);
    el.append(b);
  }
}

function setCitySearchOpen(open, returnFocus = true) {
  clearTimeout(citySearchTimer);
  citySearchSequence++;
  $("place").hidden = open;
  $("btn-city-toggle").hidden = open;
  $("city-form").hidden = !open;
  $("btn-city-toggle").setAttribute("aria-expanded", String(open));
  hideCitySuggestions();
  if (open) {
    $("city-input").value = city;
    $("city-input").focus();
    $("city-input").select();
  } else if (returnFocus) $("btn-city-toggle").focus();
}

function hideCitySuggestions() {
  const list = $("city-suggestions");
  list.hidden = true;
  list.setAttribute("role", "listbox");
  list.replaceChildren();
  $("city-input").setAttribute("aria-expanded", "false");
}

function showCitySuggestions(results, message) {
  const list = $("city-suggestions");
  list.replaceChildren();
  if (results.length) {
    list.setAttribute("role", "listbox");
    for (const result of results) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "city-suggestion";
      button.setAttribute("role", "option");
      button.setAttribute("aria-selected", "false");
      button.textContent = result.name;
      const detail = [result.admin1, result.country].filter(Boolean).join(", ");
      if (detail) {
        const small = document.createElement("small");
        small.textContent = detail;
        button.append(small);
      }
      button.onclick = () => {
        hideCitySuggestions();
        load(true, result);
      };
      list.append(button);
    }
  } else {
    list.setAttribute("role", "status");
    const item = document.createElement("div");
    item.className = "city-suggestion-message";
    item.textContent = message;
    list.append(item);
  }
  list.hidden = false;
  $("city-input").setAttribute("aria-expanded", "true");
}

function updateCitySuggestions(query) {
  clearTimeout(citySearchTimer);
  const sequence = ++citySearchSequence;
  if (query.length < 2) {
    hideCitySuggestions();
    return;
  }
  citySearchTimer = setTimeout(async () => {
    try {
      const results = await searchCities(query);
      if (
        sequence !== citySearchSequence ||
        $("city-form").hidden ||
        $("city-input").value.trim() !== query
      ) {
        return;
      }
      showCitySuggestions(results, t("city_no_results"));
    } catch {
      if (sequence !== citySearchSequence) return;
      showCitySuggestions([], t("city_suggestions_error"));
    }
  }, 300);
}

// --- Helpers for the data ---------------------------------------------------------------------------------------
const stamp = (ms) =>
  new Date(ms).toLocaleTimeString(locale(), {
    hour: "2-digit",
    minute: "2-digit",
  });
const hhmm = (iso) => iso.slice(11, 16);
const minutes = (iso) => +iso.slice(11, 13) * 60 + +iso.slice(14, 16);
function dayName(iso, i) {
  if (i === 0) return t("today");
  if (i === 1) return t("tomorrow");
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(locale(), {
    weekday: "long",
    timeZone: "UTC",
  });
}
function compass(deg) {
  return t("compass")[Math.round((((deg % 360) + 360) % 360) / 22.5) % 16];
}
function wmoText(code) {
  return (
    globalThis.WX_TEXT[lang].wmo[code] ||
    globalThis.WX_TEXT[lang].wmo[
      Object.keys(globalThis.WX_TEXT[lang].wmo)
        .map(Number)
        .filter((c) => c <= code)
        .pop()
    ] ||
    "–"
  );
}
function uvLevel(v) {
  return v < 3 ? 0 : v < 6 ? 1 : v < 8 ? 2 : v < 11 ? 3 : 4;
}
function nowHourIndex() {
  const hour = wx.current.time.slice(0, 13) + ":00",
    i = wx.hourly.time.findIndex((x) => x >= hour);
  return i < 0 ? 0 : i;
}
// The moon over the date alone (no request): synodic month from a known new moon.
function moonPhase(ms) {
  const age =
      (((ms / 86400000 + 2440587.5 - 2451550.1) % 29.530588853) +
        29.530588853) %
      29.530588853,
    p = age / 29.530588853;
  return {
    index: Math.floor(p * 8 + 0.5) % 8,
    lit: Math.round(((1 - Math.cos(p * 2 * Math.PI)) / 2) * 100),
  };
}
const MOONS = ["🌑", "🌒", "🌓", "🌔", "🌕", "🌖", "🌗", "🌘"];

// --- Drawing ------------------------------------------------------------------------------------------------------
function render() {
  const c = wx.current,
    h = wx.hourly,
    d = wx.daily,
    i = nowHourIndex(),
    isDay = c.is_day === 1;
  $("dash").hidden = false;
  $("place").textContent = loc.city + (loc.country ? ", " + loc.country : "");
  clock();

  const hero = $("hero");
  hero.dataset.sky = globalThis.wxSky(c.weather_code, isDay);
  $("hero-icon").innerHTML = globalThis.wxIcon(c.weather_code, isDay);
  $("hero-temp").textContent = num(Math.round(c.temperature_2m));
  $("hero-desc").textContent = wmoText(c.weather_code);
  $("hero-feels").textContent = temp(c.apparent_temperature);
  $("hero-hi").textContent = temp(d.temperature_2m_max[0]);
  $("hero-lo").textContent = temp(d.temperature_2m_min[0]);
  $("hero-updated").textContent = t("updated") + " " + stamp(wxAt);

  // tiles
  $("m-humidity").textContent = num(c.relative_humidity_2m);
  $("m-humidity-bar").style.width = c.relative_humidity_2m + "%";
  $("m-dew").textContent = t("dew") + " " + temp(h.dew_point_2m[i]);
  $("m-wind").textContent = num(c.wind_speed_10m);
  $("m-wind-dir").textContent = compass(c.wind_direction_10m);
  $("m-wind-arrow").style.transform =
    "rotate(" + (c.wind_direction_10m + 180) + "deg)";
  $("m-gust").textContent = t("gusts") + " " + num(c.wind_gusts_10m) + " km/h";
  $("m-pressure").textContent = num(c.pressure_msl);
  const before = h.pressure_msl[Math.max(0, i - 3)],
    delta = c.pressure_msl - before;
  $("m-trend").textContent =
    delta > 1
      ? "↗ " + t("trend_up")
      : delta < -1
        ? "↘ " + t("trend_down")
        : "→ " + t("trend_flat");
  const uv = h.uv_index[i] === null ? 0 : h.uv_index[i];
  $("m-uv").textContent = num(uv, 1);
  $("m-uv-mark").style.left = Math.min(100, (uv / 12) * 100) + "%";
  $("m-uv-label").textContent =
    t("uv_" + uvLevel(uv)) + " · max " + num(d.uv_index_max[0], 1);
  $("m-precip").textContent = num(c.precipitation, 1);
  $("m-precip-sub").textContent =
    num(d.precipitation_sum[0], 1) + " mm " + t("today_sum");
  const vis = (h.visibility[i] || 0) / 1000;
  $("m-vis").textContent = num(Math.min(vis, 50), vis >= 10 ? 0 : 1);
  $("m-vis-label").textContent = t(
    vis >= 10
      ? "vis_good"
      : vis >= 4
        ? "vis_fair"
        : vis >= 1
          ? "vis_poor"
          : "vis_bad",
  );
  $("m-cloud").textContent = num(c.cloud_cover);
  $("m-cloud-bar").style.width = c.cloud_cover + "%";
  const pop = h.precipitation_probability[i] || 0;
  $("m-pop").textContent = num(pop);
  $("m-pop-bar").style.width = pop + "%";

  hourly(i);
  daily();
  sun();
}

// The hour boxes of a strip (n hours from index `from` of the hourly data); returns the points for the chart.
function fillStrip(strip, from, n, nowFirst) {
  const h = wx.hourly,
    pts = [];
  strip.textContent = "";
  for (let k = 0; k < n; k++) {
    const j = from + k,
      el = document.createElement("div");
    el.className = "hr";
    const pop = h.precipitation_probability[j] || 0;
    el.innerHTML = `<b></b>${globalThis.wxIcon(
      h.weather_code[j],
      h.is_day[j] === 1,
    )}<span class="t"></span><span class="p"></span>`;
    el.children[0].textContent =
      nowFirst && k === 0 ? t("now") : hhmm(h.time[j]);
    el.querySelector(".t").textContent = temp(h.temperature_2m[j]);
    el.querySelector(".p").textContent = pop >= 10 ? pop + " %" : "";
    strip.append(el);
    pts.push({
      label: hhmm(h.time[j]).slice(0, 2),
      temp: h.temperature_2m[j],
      pop,
    });
  }
  return pts;
}

function hourly(from) {
  chart(
    fillStrip(
      $("strip"),
      from,
      Math.min(24, wx.hourly.time.length - from),
      true,
    ),
    $("chart"),
    true,
  );
}

// Temperature curve with the chance of rain as bars below it. The SVG is drawn in the pixels of its box (so the text keeps
// its size on a phone and on a 27" monitor) and drawn again when the box changes its size.
let chartPts = null;
function chart(pts, box, main) {
  if (main) chartPts = pts;
  const rem =
    parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
  const W = Math.max(320, box.clientWidth),
    H = Math.max(150, box.clientHeight);
  const L = 2.8 * rem,
    R = 1.3 * rem,
    T = 1.9 * rem,
    B = 2.3 * rem,
    w = W - L - R,
    ph = H - T - B,
    bars = Math.min(ph * 0.3, 2 * rem);
  const lo = Math.floor(Math.min(...pts.map((p) => p.temp)) - 1),
    hi = Math.ceil(Math.max(...pts.map((p) => p.temp)) + 2);
  const inset = 1.2 * rem,
    x = (k) =>
      L +
      inset +
      (pts.length > 1 ? k / (pts.length - 1) : 0.5) * (w - 2 * inset),
    y = (v) => T + (1 - (v - lo) / (hi - lo)) * ph;
  let path = "M" + x(0).toFixed(1) + " " + y(pts[0].temp).toFixed(1);
  for (let k = 1; k < pts.length; k++) {
    const mid = (x(k - 1) + x(k)) / 2;
    path += `C${mid.toFixed(1)} ${y(pts[k - 1].temp).toFixed(1)} ${mid.toFixed(
      1,
    )} ${y(pts[k].temp).toFixed(1)} ${x(k).toFixed(1)} ${y(pts[k].temp).toFixed(
      1,
    )}`;
  }
  const area =
    path +
    `L${x(pts.length - 1).toFixed(1)} ${T + ph}L${x(0).toFixed(1)} ${T + ph}Z`;
  let s = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}"><defs><linearGradient id="ga" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--accent)" stop-opacity=".28"/><stop offset="1" stop-color="var(--accent)" stop-opacity="0"/></linearGradient></defs>`;
  for (let g = 0; g <= 3; g++) {
    // grid lines with the temperature of each
    const v = lo + ((hi - lo) * g) / 3,
      gy = y(v);
    s += `<line class="grid" x1="${L}" x2="${W - R}" y1="${gy.toFixed(
      1,
    )}" y2="${gy.toFixed(1)}"/><text class="axis" x="${(L - 0.5 * rem).toFixed(
      1,
    )}" y="${(gy + 0.28 * rem).toFixed(1)}" text-anchor="end">${Math.round(
      v,
    )}°</text>`;
  }
  pts.forEach((p, k) => {
    // rain bars
    const bh = (p.pop / 100) * bars,
      bw = Math.max(3, (w / pts.length) * 0.45);
    if (p.pop >= 5) {
      s += `<rect class="pbar" x="${(x(k) - bw / 2).toFixed(1)}" y="${(
        T +
        ph -
        bh
      ).toFixed(
        1,
      )}" width="${bw.toFixed(1)}" height="${bh.toFixed(1)}" rx="2"/>`;
    }
  });
  s += `<path class="area" d="${area}"/><path class="line" d="${path}"/>`;
  pts.forEach((p, k) => {
    if (k % 3 !== 0 && k !== pts.length - 1) return;
    s += `<circle class="dot" cx="${x(k).toFixed(1)}" cy="${y(p.temp).toFixed(
      1,
    )}" r="${(0.3 * rem).toFixed(1)}"/><text class="val" x="${x(k).toFixed(
      1,
    )}" y="${(y(p.temp) - 0.8 * rem).toFixed(1)}" text-anchor="middle">${Math.round(
      p.temp,
    )}°</text>`;
    s += `<text class="axis" x="${x(k).toFixed(1)}" y="${(
      H -
      0.5 * rem
    ).toFixed(1)}" text-anchor="middle">${p.label}</text>`;
  });
  box.innerHTML = s + "</svg>";
}

function dayLabel(iso, i) {
  // "Mi 21." for the narrow day cards of the monitor layout
  if (i < 2) return t(i === 0 ? "today" : "tomorrow");
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  const weekday = new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(locale(), {
    weekday: "short",
    timeZone: "UTC",
  });
  return weekday.replace(/[.,]/g, "") + " " + d + (lang === "de" ? "." : "");
}

function daily() {
  const d = wx.daily,
    box = $("daily");
  const lo = Math.min(...d.temperature_2m_min),
    hi = Math.max(...d.temperature_2m_max),
    span = Math.max(1, hi - lo);
  box.textContent = "";
  d.time.forEach((day, i) => {
    const row = document.createElement("button"),
      mn = d.temperature_2m_min[i],
      mx = d.temperature_2m_max[i];
    row.type = "button";
    row.className = "day";
    row.dataset.i = i;
    row.setAttribute(
      "aria-label",
      t("day_open").replace("{day}", dayName(day, i)),
    );
    row.innerHTML =
      `<b class="dn"></b><b class="ds"></b><span class="di">${globalThis.wxIcon(
        d.weather_code[i],
        true,
      )}</span><span class="dd"></span><span class="dp"></span>` +
      `<span class="lo"></span><span class="range"><i></i></span><span class="hi"></span><span class="dx"></span>`;
    row.querySelector(".dn").textContent = dayName(day, i);
    row.querySelector(".ds").textContent = dayLabel(day, i);
    row.querySelector(".dd").textContent = wmoText(d.weather_code[i]);
    const pp = d.precipitation_probability_max[i] || 0;
    row.querySelector(".dp").textContent = pp >= 10 ? "💧 " + pp + " %" : "";
    row.querySelector(".lo").textContent = temp(mn);
    row.querySelector(".hi").textContent = temp(mx);
    const bar = row.querySelector(".range i");
    bar.style.left = ((mn - lo) / span) * 100 + "%";
    bar.style.width = Math.max(6, ((mx - mn) / span) * 100) + "%";
    row.querySelector(".dx").textContent =
      num(d.wind_speed_10m_max[i]) + " km/h · UV " + num(d.uv_index_max[i], 0);
    box.append(row);
  });
}

// --- One day in detail (a click on a day): the figures of the day, its hours and its curve --------------------------
let dayIndex = -1;

function tile(label, value, unit, sub) {
  const el = document.createElement("div"),
    h = document.createElement("h3"),
    big = document.createElement("p"),
    line = document.createElement("p");
  el.className = "tile";
  big.className = "big";
  line.className = "sub";
  h.textContent = label;
  big.textContent = value;
  line.textContent = sub || "";
  if (unit) {
    const u = document.createElement("small");
    u.textContent = unit;
    big.append(u);
  }
  el.append(h, big, line);
  return el;
}

function openDay(i) {
  const dlg = $("day");
  dayIndex = i;
  if (!dlg.open) dlg.showModal();
  renderDay();
}

function stepDay(by) {
  const i = dayIndex + by;
  if (wx && i >= 0 && i < wx.daily.time.length) {
    dayIndex = i;
    renderDay();
  }
}

function renderDay() {
  if (!wx || dayIndex < 0) return;
  const d = wx.daily,
    h = wx.hourly,
    i = dayIndex,
    day = d.time[i],
    [y, m, dd] = day.split("-").map(Number);
  $("day-title").textContent = new Date(
    Date.UTC(y, m - 1, dd),
  ).toLocaleDateString(locale(), {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  });
  $("day-desc").textContent = wmoText(d.weather_code[i]);
  $("day-icon").innerHTML = globalThis.wxIcon(d.weather_code[i], true);
  $("day-hi").textContent = temp(d.temperature_2m_max[i]);
  $("day-lo").textContent = temp(d.temperature_2m_min[i]);
  const box = $("day-tiles"),
    daylight = d.daylight_duration[i] / 3600,
    sunshine = d.sunshine_duration[i] / 3600;
  const pop = d.precipitation_probability_max[i] || 0,
    uv = d.uv_index_max[i] || 0,
    snow = d.snowfall_sum[i] || 0;
  box.textContent = "";
  box.append(
    tile(
      t("rain"),
      num(d.precipitation_sum[i], 1),
      "mm",
      t("rain_hours").replace("{n}", num(d.precipitation_hours[i])),
    ),
    tile(t("chance"), num(pop), "%", ""),
    tile(
      t("wind"),
      num(d.wind_speed_10m_max[i]),
      "km/h",
      compass(d.wind_direction_10m_dominant[i]) +
        " · " +
        t("gusts") +
        " " +
        num(d.wind_gusts_10m_max[i]),
    ),
    tile(t("uv"), num(uv, 1), "", t("uv_" + uvLevel(uv))),
    tile(
      t("feels_day"),
      temp(d.apparent_temperature_max[i]),
      "",
      t("low") + " " + temp(d.apparent_temperature_min[i]),
    ),
    tile(
      t("sunrise"),
      hhmm(d.sunrise[i]),
      "",
      t("sunset") + " " + hhmm(d.sunset[i]),
    ),
    tile(
      t("sunshine"),
      num(sunshine, 1),
      "h",
      t("of_daylight").replace("{n}", num(daylight, 1)),
    ),
    snow > 0
      ? tile(t("snow"), num(snow, 1), "cm", "")
      : tile(
          t("moon"),
          MOONS[moonPhase(Date.UTC(y, m - 1, dd, 12)).index],
          "",
          t("phases")[moonPhase(Date.UTC(y, m - 1, dd, 12)).index],
        ),
  );
  const from = h.time.findIndex((x) => x.startsWith(day)),
    n = from < 0 ? 0 : Math.min(24, h.time.length - from);
  if (n) {
    chart(fillStrip($("day-strip"), from, n, false), $("day-chart"), false);
  }
  $("day-prev").disabled = i === 0;
  $("day-next").disabled = i === d.time.length - 1;
}

function sun() {
  const rise = wx.daily.sunrise[0],
    set = wx.daily.sunset[0],
    a = minutes(rise),
    b = minutes(set),
    cur = minutes(wx.current.time);
  $("sunrise").textContent = hhmm(rise);
  $("sunset").textContent = hhmm(set);
  const len = b - a;
  $("daylight").textContent =
    Math.floor(len / 60) + ":" + String(len % 60).padStart(2, "0") + " h";
  const p = Math.max(0, Math.min(1, (cur - a) / len)),
    up = cur >= a && cur <= b;
  const R = 150,
    cx = 180,
    cy = 170,
    ang = Math.PI * (1 - p),
    sx = cx + R * Math.cos(ang),
    sy = cy - R * Math.sin(ang);
  $("sunarc").innerHTML =
    `<svg viewBox="0 0 360 200" preserveAspectRatio="xMidYMid meet"><path class="horizon" d="M10 170H350"/>` +
    `<path class="arc" d="M${cx - R} ${cy}A${R} ${R} 0 0 1 ${cx + R} ${cy}"/>` +
    (up
      ? `<path class="arcdone" d="M${cx - R} ${cy}A${R} ${R} 0 0 1 ${sx.toFixed(
          1,
        )} ${sy.toFixed(1)}"/><circle class="sunball" cx="${sx.toFixed(1)}" cy="${sy.toFixed(
          1,
        )}" r="11"/>`
      : "") +
    `</svg>`;
  const m = moonPhase(Date.now());
  $("moon-icon").textContent = MOONS[m.index];
  $("moon-name").textContent = t("phases")[m.index];
  $("moon-sub").textContent = m.lit + " % " + t("illum");
}

// The date and time at the place (not the viewer's), once a minute.
function clock() {
  if (!wx) return;
  const tz = wx.timezone,
    now = new Date();
  const day = now.toLocaleDateString(locale(), {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: tz,
  });
  const time = now.toLocaleTimeString(locale(), {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: tz,
  });
  $("when").textContent = day + " · " + time;
}

// --- Controls -----------------------------------------------------------------------------------------------------
function setLang(l) {
  lang = globalThis.WX_TEXT[l] ? l : "de";
  const persistence = writeCache("wx.lang", lang);
  document.documentElement.lang = lang;
  document.title = t("title");
  document.querySelectorAll("[data-i18n]").forEach((el) => {
    el.textContent = t(el.dataset.i18n);
  });
  document
    .querySelectorAll("[data-i18n-label]")
    .forEach((el) => el.setAttribute("aria-label", t(el.dataset.i18nLabel)));
  document.querySelectorAll("[data-i18n-title]").forEach((el) => {
    el.title = t(el.dataset.i18nTitle);
  });
  document.querySelectorAll("[data-i18n-placeholder]").forEach((el) => {
    el.placeholder = t(el.dataset.i18nPlaceholder);
  });
  document
    .querySelectorAll("[data-lang]")
    .forEach((b) => b.classList.toggle("act", b.dataset.lang === lang));
  if (wx && loc) {
    render();
    if ($("day").open) renderDay();
  }
  return persistence;
}

function setTheme(m) {
  theme = m === "light" || m === "dark" ? m : "auto";
  const persistence = writeCache("wx.theme", theme);
  document.documentElement.dataset.theme =
    theme === "auto"
      ? preferredColorScheme.matches
        ? "dark"
        : "light"
      : theme;
  document.querySelectorAll("[data-theme-mode]").forEach((button) => {
    const selected = button.dataset.themeMode === theme;
    button.classList.toggle("act", selected);
    button.setAttribute("aria-pressed", String(selected));
  });
  return persistence;
}

async function start() {
  const q = new URLSearchParams(location.search);
  const saved = await readCache("wx.lang");
  if (/^\d+$/.test(q.get("day") || "")) pendingDay = +q.get("day");
  setTheme(q.get("theme") || (await readCache("wx.theme")) || "auto");
  const updatePreferredTheme = () => {
    if (theme === "auto") setTheme("auto");
  };
  if (preferredColorScheme.addEventListener) {
    preferredColorScheme.addEventListener("change", updatePreferredTheme);
  } else preferredColorScheme.addListener(updatePreferredTheme);
  setLang(
    q.get("lang") ||
      saved ||
      ((navigator.language || "").toLowerCase().startsWith("de") ? "de" : "en"),
  );
  city = (await readCache("wx.city")) || "Berlin";
  $("city-input").value = city;
  $("btn-city-toggle").onclick = () => setCitySearchOpen($("city-form").hidden);
  $("city-input").oninput = (e) => updateCitySuggestions(e.target.value.trim());
  $("city-input").onkeydown = (e) => {
    if (e.key === "Escape") {
      if (!$("city-suggestions").hidden) hideCitySuggestions();
      else setCitySearchOpen(false);
    } else if (e.key === "ArrowDown") {
      const first = $("city-suggestions").querySelector(".city-suggestion");
      if (first) {
        e.preventDefault();
        first.focus();
      }
    }
  };
  $("city-suggestions").onkeydown = (e) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    const options = [
      ...$("city-suggestions").querySelectorAll(".city-suggestion"),
    ];
    const index = options.indexOf(document.activeElement);
    const next =
      e.key === "ArrowDown"
        ? Math.min(index + 1, options.length - 1)
        : Math.max(index - 1, -1);
    e.preventDefault();
    if (next < 0) $("city-input").focus();
    else options[next].focus();
  };
  $("city-form").onsubmit = (e) => {
    e.preventDefault();
    if (loading) {
      $("city-input").value = city;
      return;
    }
    hideCitySuggestions();
    load(true, $("city-input").value);
  };
  document
    .querySelectorAll("[data-lang]")
    .forEach((b) => (b.onclick = () => setLang(b.dataset.lang)));
  document.querySelectorAll("[data-theme-mode]").forEach((button) => {
    button.onclick = () => setTheme(button.dataset.themeMode);
  });
  $("btn-refresh").onclick = () => load(true);
  if (document.documentElement.requestFullscreen) {
    $("btn-full").onclick = () => {
      if (document.fullscreenElement) document.exitFullscreen();
      else document.documentElement.requestFullscreen();
    };
  } else $("btn-full").hidden = true;
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) {
      clock();
      if (Date.now() - wxAt > TTL_WEATHER) load(false);
    }
  });
  if (window.ResizeObserver) {
    // the chart follows its box (window size, monitor layout)
    let last = 0;
    new ResizeObserver(() => {
      const w = $("chart").clientWidth + "x" + $("chart").clientHeight;
      if (chartPts && w !== last) {
        last = w;
        chart(chartPts, $("chart"), true);
      }
    }).observe($("chart"));
  }
  $("daily").onclick = (e) => {
    const b = e.target.closest(".day");
    if (b) openDay(+b.dataset.i);
  };
  $("day-close").onclick = () => $("day").close();
  $("day-prev").onclick = () => stepDay(-1);
  $("day-next").onclick = () => stepDay(1);
  $("day").addEventListener("click", (e) => {
    if (e.target === $("day")) $("day").close();
  }); // a click beside the panel
  $("day").addEventListener("keydown", (e) => {
    if (e.key === "ArrowLeft") stepDay(-1);
    else if (e.key === "ArrowRight") stepDay(1);
  });
  window.addEventListener("resize", () => {
    if ($("day").open) renderDay();
  });
  setInterval(clock, 30e3);
  setInterval(() => {
    if (!document.hidden) load(false);
  }, REFRESH_MS);
  load(false);
}

void start();
