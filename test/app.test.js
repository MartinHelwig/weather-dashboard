// SPDX-FileCopyrightText: 2026 Martin Helwig
//
// SPDX-License-Identifier: MIT

/* global Deno */

"use strict";

const textsSource = Deno.readTextFileSync(
  new URL("../www/js/texts.js", import.meta.url),
);
const iconsSource = Deno.readTextFileSync(
  new URL("../www/js/icons.js", import.meta.url),
);
const appSource = Deno.readTextFileSync(
  new URL("../www/js/app.js", import.meta.url),
);

let restoreGlobals = () => {};

function fail(message) {
  throw new Error(message);
}

function assertEqual(actual, expected) {
  if (!Object.is(actual, expected)) {
    fail(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function assertDeepEqual(actual, expected) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    fail(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function assertMatch(actual, expected) {
  if (!expected.test(actual)) {
    fail(`Expected ${JSON.stringify(actual)} to match ${expected}`);
  }
}

function assertOk(value, message) {
  if (!value) {
    fail(message || `Expected a truthy value, got ${JSON.stringify(value)}`);
  }
}

function assertNotEqual(actual, expected, message) {
  if (Object.is(actual, expected)) fail(message);
}

function createElement(tagName = "div") {
  const selectors = new Map();
  const attributes = {};
  const element = {
    tagName: tagName.toUpperCase(),
    attributes,
    children: [],
    dataset: {},
    style: {},
    classList: {
      values: new Set(),
      toggle(name, force) {
        if (force) this.values.add(name);
        else this.values.delete(name);
      },
    },
    textContent: "",
    innerHTML: "",
    hidden: false,
    open: false,
    disabled: false,
    setAttribute(name, value) {
      attributes[name] = value;
    },
    getAttribute(name) {
      return attributes[name];
    },
    append(...children) {
      this.children.push(...children);
    },
    replaceChildren(...children) {
      this.children = [...children];
    },
    querySelector(selector) {
      if (!selectors.has(selector)) selectors.set(selector, createElement());
      return selectors.get(selector);
    },
    focus() {},
    select() {},
    showModal() {
      this.open = true;
    },
    close() {
      this.open = false;
    },
    addEventListener() {},
  };
  Object.defineProperty(element, "innerHTML", {
    get() {
      return this._innerHTML || "";
    },
    set(value) {
      this._innerHTML = value;
      if (value.includes("<b>") && this.children.length === 0) {
        this.children.push(createElement("b"));
      }
    },
  });
  return element;
}

function createWeatherFixture() {
  return {
    timezone: "Europe/Berlin",
    current: {
      time: "2026-10-23T12:00",
      is_day: 1,
      weather_code: 3,
      temperature_2m: 18,
      apparent_temperature: 17,
      relative_humidity_2m: 65,
      wind_speed_10m: 12,
      wind_direction_10m: 180,
      wind_gusts_10m: 20,
      pressure_msl: 1012,
      precipitation: 0.2,
      cloud_cover: 50,
    },
    hourly: {
      time: ["2026-10-23T12:00", "2026-10-23T13:00", "2026-10-23T14:00"],
      temperature_2m: [18, 19, 17],
      precipitation_probability: [0, 20, 60],
      weather_code: [3, 61, 71],
      is_day: [1, 1, 1],
      visibility: [20000, 8000, 3000],
      dew_point_2m: [10, 11, 10],
      uv_index: [2, 3, 1],
      pressure_msl: [1011, 1012, 1013],
    },
    daily: {
      time: ["2026-10-23", "2026-10-24"],
      weather_code: [3, 61],
      temperature_2m_max: [20, 16],
      temperature_2m_min: [12, 10],
      apparent_temperature_max: [19, 15],
      apparent_temperature_min: [11, 9],
      sunrise: ["2026-10-23T06:30", "2026-10-24T06:32"],
      sunset: ["2026-10-23T18:45", "2026-10-24T18:42"],
      daylight_duration: [44100, 43560],
      sunshine_duration: [30000, 20000],
      uv_index_max: [5, 3],
      precipitation_sum: [1.2, 4.5],
      precipitation_hours: [2, 5],
      precipitation_probability_max: [20, 80],
      snowfall_sum: [0, 0],
      wind_speed_10m_max: [18, 25],
      wind_gusts_10m_max: [30, 40],
      wind_direction_10m_dominant: [180, 270],
    },
  };
}

function createIndexedDB(failureMode = "") {
  const stores = new Map();
  const database = {
    objectStoreNames: { contains: (name) => stores.has(name) },
    createObjectStore: (name) => stores.set(name, new Map()),
    transaction: (name) => {
      const transaction = {};
      transaction.objectStore = () => {
        const store = stores.get(name);
        return {
          get: (key) => {
            const request = {};
            queueMicrotask(() => {
              if (failureMode === "request") {
                request.error = new Error("IndexedDB request failed");
                request.onerror();
                return;
              }
              request.result = store.get(key);
              request.onsuccess();
              if (failureMode === "transaction") {
                transaction.error = new Error("IndexedDB transaction failed");
                transaction.onerror();
                return;
              }
              if (failureMode === "abort") {
                transaction.error = new Error("IndexedDB transaction aborted");
                transaction.onabort();
                return;
              }
              queueMicrotask(() => transaction.oncomplete());
            });
            return request;
          },
          put: (value, key) => {
            const request = {};
            queueMicrotask(() => {
              if (failureMode === "request") {
                request.error = new Error("IndexedDB request failed");
                request.onerror();
                return;
              }
              store.set(key, value);
              request.result = key;
              request.onsuccess();
              if (failureMode === "transaction") {
                transaction.error = new Error("IndexedDB transaction failed");
                transaction.onerror();
                return;
              }
              if (failureMode === "abort") {
                transaction.error = new Error("IndexedDB transaction aborted");
                transaction.onabort();
                return;
              }
              queueMicrotask(() => transaction.oncomplete());
            });
            return request;
          },
        };
      };
      return transaction;
    },
    close: () => {},
  };
  return {
    stores,
    open: () => {
      const request = {};
      queueMicrotask(() => {
        if (failureMode === "open") {
          request.error = new Error("IndexedDB open failed");
          request.onerror();
          return;
        }
        request.result = database;
        if (stores.size === 0) request.onupgradeneeded();
        request.onsuccess();
      });
      return request;
    },
  };
}

function createApp(
  fetchImpl = () => Promise.reject(new Error("Unexpected network request")),
  prefersDark = false,
  indexedDBFailure = "",
  timerOverrides = {},
) {
  restoreGlobals();

  const storage = new Map();
  const indexedDB = createIndexedDB(indexedDBFailure);
  const elements = new Map();
  const queryLists = new Map();
  const themeButtons = ["auto", "light", "dark"].map((themeMode) => {
    const classes = new Set();
    const attributes = {};
    return {
      dataset: { themeMode },
      classes,
      attributes,
      classList: {
        toggle: (className, force) =>
          force ? classes.add(className) : classes.delete(className),
      },
      setAttribute: (name, value) => {
        attributes[name] = value;
      },
    };
  });
  const documentElement = createElement("html");
  const getElement = (id) => {
    if (!elements.has(id)) elements.set(id, createElement());
    return elements.get(id);
  };
  const globals = {
    document: {
      documentElement,
      getElementById: getElement,
      createElement,
      title: "",
      querySelectorAll: (selector) =>
        selector === "[data-theme-mode]"
          ? themeButtons
          : queryLists.get(selector) || [],
    },
    fetch: fetchImpl,
    indexedDB,
    localStorage: {
      getItem: (key) => storage.get(key) ?? null,
      removeItem: (key) => storage.delete(key),
      setItem: (key, value) => storage.set(key, value),
    },
    window: {
      crypto: globalThis.crypto,
      matchMedia: () => ({ matches: prefersDark }),
    },
    getComputedStyle: () => ({ fontSize: "16px" }),
    ...timerOverrides,
  };
  const previous = new Map();

  for (const [name, value] of Object.entries(globals)) {
    previous.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, {
      configurable: true,
      enumerable: true,
      writable: true,
      value,
    });
  }

  restoreGlobals = () => {
    for (const [name, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
    restoreGlobals = () => {};
  };

  const withoutStartup = appSource.replace(/\nvoid start\(\);\s*$/, "\n");
  assertNotEqual(withoutStartup, appSource, "app startup call should be found");
  new Function(
    `${textsSource}\n//# sourceURL=${
      new URL("../www/js/texts.js", import.meta.url).href
    }`,
  )();
  new Function(
    `${iconsSource}\n//# sourceURL=${
      new URL("../www/js/icons.js", import.meta.url).href
    }`,
  )();
  const api = new Function(
    `${withoutStartup}\nreturn {
      num, temp, compass, wmoText, uvLevel, moonPhase, dayName,
      dayLabel, stamp, hhmm, minutes, nowHourIndex,
      placeFromResult, searchCities, locate, forecast, getJson, load, readCache, writeCache,
      render, hourly, daily, openDay, stepDay, renderDay,
      status, setCitySearchOpen, hideCitySuggestions, showCitySuggestions,
      updateCitySuggestions, setLang,
      setWeather: (value) => { wx = value; },
      setLocation: (value) => { loc = value; },
      wxIcon: globalThis.wxIcon, wxSky: globalThis.wxSky,
      setTheme,
      getWeather: () => wx,
      getTexts: () => globalThis.WX_TEXT,
    };\n//# sourceURL=${new URL("../www/js/app.js", import.meta.url).href}`,
  )();

  return {
    api,
    storage,
    indexedDB,
    cacheStorage: indexedDB.stores,
    elements,
    getElement,
    queryLists,
    themeButtons,
    document: globals.document,
  };
}

const tests = [
  [
    "keeps German and English text dictionaries structurally consistent",
    () => {
      const { api } = createApp();
      const texts = api.getTexts();
      const validateLocalePair = (german, english, path) => {
        assertEqual(typeof english, typeof german);
        if (typeof german === "string") {
          assertOk(german.trim(), `Missing German text at ${path}`);
          assertOk(english.trim(), `Missing English text at ${path}`);
          return;
        }
        if (Array.isArray(german)) {
          assertEqual(english.length, german.length);
          for (let i = 0; i < german.length; i++) {
            validateLocalePair(german[i], english[i], `${path}[${i}]`);
          }
          return;
        }

        const germanKeys = Object.keys(german).sort();
        assertDeepEqual(Object.keys(english).sort(), germanKeys);
        for (const key of germanKeys) {
          validateLocalePair(german[key], english[key], `${path}.${key}`);
        }
      };

      validateLocalePair(texts.de, texts.en, "texts");
      assertEqual(texts.de.compass.length, 16);
      assertEqual(texts.de.phases.length, 8);
      assertNotEqual(
        texts.de.title,
        texts.en.title,
        "titles should be localized",
      );
    },
  ],
  [
    "formats numbers and temperatures for German and English",
    () => {
      const { api } = createApp();

      api.setLang("de");
      assertEqual(api.num(1234.56, 1), "1.234,6");
      assertEqual(api.temp(-2.4), "-2°");
      assertEqual(api.num(null), "–");
      assertEqual(api.num(Number.NaN), "–");

      api.setLang("en");
      assertEqual(api.num(1234.56, 1), "1,234.6");
      assertEqual(api.temp(20.5), "21°");
    },
  ],
  [
    "maps compass directions across wrap-around and sector boundaries",
    () => {
      const { api } = createApp();

      api.setLang("en");
      assertEqual(api.compass(0), "N");
      assertEqual(api.compass(11.25), "NNE");
      assertEqual(api.compass(348.75), "N");
      assertEqual(api.compass(-90), "W");
      assertEqual(api.compass(720), "N");
    },
  ],
  [
    "maps known and neighboring WMO codes to localized descriptions",
    () => {
      const { api } = createApp();

      api.setLang("de");
      assertEqual(api.wmoText(0), "Klar");
      assertEqual(api.wmoText(68), "Starker gefrierender Regen");
      assertEqual(api.wmoText(4), "Bedeckt");

      api.setLang("en");
      assertEqual(api.wmoText(95), "Thunderstorm");
    },
  ],
  [
    "assigns UV thresholds to the correct levels",
    () => {
      const { api } = createApp();

      assertDeepEqual(
        [0, 2.99, 3, 5.99, 6, 7.99, 8, 10.99, 11].map(api.uvLevel),
        [0, 0, 1, 1, 2, 2, 3, 3, 4],
      );
    },
  ],
  [
    "calculates moon phases at new and full moon",
    () => {
      const { api } = createApp();
      const newMoon = api.moonPhase(Date.UTC(2000, 0, 6, 14, 24));
      const fullMoon = api.moonPhase(Date.UTC(2000, 0, 21, 4, 47));

      assertEqual(newMoon.index, 0);
      assertEqual(newMoon.lit, 0);
      assertEqual(fullMoon.index, 4);
      assertEqual(fullMoon.lit, 100);
    },
  ],
  [
    "uses localized relative and calendar day names",
    () => {
      const { api } = createApp();

      api.setLang("en");
      assertEqual(api.dayName("2026-10-21", 0), "Today");
      assertEqual(api.dayName("2026-10-22", 1), "Tomorrow");
      assertEqual(api.dayName("2026-10-23", 2), "Friday");

      api.setLang("de");
      assertEqual(api.dayName("2026-10-23", 2), "Freitag");
    },
  ],
  [
    "formats timestamps and compact day labels in the selected language",
    () => {
      const { api } = createApp();

      api.setLang("en");
      assertEqual(api.hhmm("2026-10-23T09:45"), "09:45");
      assertEqual(api.minutes("2026-10-23T09:45"), 585);
      assertEqual(api.dayLabel("2026-10-23", 0), "Today");
      assertEqual(api.dayLabel("2026-10-24", 1), "Tomorrow");
      assertEqual(api.dayLabel("2026-10-23", 2), "Fri 23");
      assertMatch(api.stamp(Date.UTC(2026, 9, 23, 9, 45)), /\d{1,2}:\d{2}/);

      api.setLang("de");
      assertEqual(api.dayLabel("2026-10-23", 2), "Fr 23.");
    },
  ],
  [
    "ignores a city selection that contains no city name",
    async () => {
      let calls = 0;
      const { api } = createApp(() => {
        calls++;
        throw new Error("An empty city must not trigger a request");
      });

      await api.load(false, "   ");
      assertEqual(calls, 0);
    },
  ],
  [
    "aborts the request when its timeout expires and clears the timer",
    async () => {
      let timeout;
      let timeoutMs;
      let clearedTimer;
      let signal;
      const { api } = createApp(
        (_url, options) => {
          signal = options.signal;
          timeout();
          return Promise.resolve({ ok: true, json: () => ({ ok: true }) });
        },
        false,
        "",
        {
          setTimeout: (callback, delay) => {
            timeout = callback;
            timeoutMs = delay;
            return 17;
          },
          clearTimeout: (id) => {
            clearedTimer = id;
          },
        },
      );

      assertDeepEqual(await api.getJson("/weather"), { ok: true });
      assertEqual(timeoutMs, 12000);
      assertEqual(signal.aborted, true);
      assertEqual(clearedTimer, 17);
    },
  ],
  [
    "creates location records with a region fallback",
    () => {
      const { api } = createApp();
      const place = api.placeFromResult({
        name: "Berlin",
        country: "Deutschland",
        latitude: 52.52,
        longitude: 13.405,
        timezone: "Europe/Berlin",
      });

      assertEqual(place.city, "Berlin");
      assertEqual(place.region, "Berlin");
      assertEqual(place.country, "Deutschland");
      assertEqual(place.lat, 52.52);
      assertEqual(place.lon, 13.405);
      assertEqual(place.timezone, "Europe/Berlin");
      assertEqual(typeof place.at, "number");
    },
  ],
  [
    "uses a fresh location cache without requesting geocoding",
    async () => {
      let calls = 0;
      const { api, cacheStorage } = createApp(() => {
        calls++;
        throw new Error("Should use cached location");
      });
      const cached = {
        city: "Berlin",
        region: "Berlin",
        country: "Germany",
        lat: 52.52,
        lon: 13.405,
        timezone: "Europe/Berlin",
        at: Date.now(),
      };
      await api.writeCache("wx.loc", cached);

      assertDeepEqual({ ...(await api.locate("berlin")) }, cached);
      assertEqual(calls, 0);
      assertEqual(cacheStorage.get("cache").has("wx.loc"), true);
      assertEqual(
        new TextDecoder()
          .decode(cacheStorage.get("cache").get("wx.loc").data)
          .includes("Berlin"),
        false,
      );
    },
  ],
  [
    "encodes city search queries and returns an empty list without results",
    async () => {
      let requestedUrl;
      const { api } = createApp((url) => {
        requestedUrl = url;
        return { ok: true, json: () => ({}) };
      });

      api.setLang("de");
      assertDeepEqual([...(await api.searchCities("Bad Homburg"))], []);
      assertMatch(requestedUrl, /name=Bad%20Homburg/);
      assertMatch(requestedUrl, /language=de/);
    },
  ],
  [
    "refreshes expired forecasts and stores the response under its versioned key",
    async () => {
      let requestedUrl;
      const response = {
        current: {
          temperature_2m: 18,
          time: "2026-10-23T09:30",
        },
        hourly: {
          time: ["2026-10-23T08:00", "2026-10-23T10:00"],
        },
      };
      const { api, cacheStorage } = createApp((url) => {
        requestedUrl = url;
        return { ok: true, json: () => response };
      });
      const place = { lat: 52.52, lon: 13.405 };
      const key = "52.52,13.40|16d-1";
      const startedAt = Date.now();
      await api.writeCache("wx.data", {
        key,
        at: Date.now() - 11 * 60 * 1000,
        data: {},
      });

      assertEqual(await api.forecast(place, false), true);
      assertMatch(requestedUrl, /latitude=52\.52/);
      assertMatch(requestedUrl, /longitude=13\.405/);
      assertDeepEqual({ ...api.getWeather() }, response);
      assertEqual(api.nowHourIndex(), 1);
      const saved = await api.readCache("wx.data");
      assertEqual(saved.key, key);
      assertOk(saved.at >= startedAt && saved.at <= Date.now());
      assertDeepEqual(saved.data, response);
      assertEqual(
        new TextDecoder()
          .decode(cacheStorage.get("cache").get("wx.data").data)
          .includes("temperature_2m"),
        false,
      );
    },
  ],
  [
    "treats an unreadable encrypted forecast as a cache miss",
    async () => {
      let calls = 0;
      const response = { current: { temperature_2m: 18 } };
      const { api, cacheStorage } = createApp(() => {
        calls++;
        return { ok: true, json: () => response };
      });
      const place = { lat: 52.52, lon: 13.405 };
      await api.writeCache("wx.data", {
        key: "52.52,13.40|16d-1",
        at: Date.now(),
        data: {},
      });
      cacheStorage.get("cache").set("wx.data", {
        iv: new Uint8Array(12),
        data: new Uint8Array([1, 2, 3]).buffer,
      });

      assertEqual(await api.forecast(place, false), true);
      assertEqual(calls, 1);
      assertDeepEqual((await api.readCache("wx.data")).data, response);
    },
  ],
  [
    "treats IndexedDB open, request, transaction, and abort errors as cache misses",
    async () => {
      for (const failureMode of ["open", "request", "transaction", "abort"]) {
        const { api } = createApp(undefined, false, failureMode);
        assertEqual(await api.readCache("wx.test"), null);
      }
    },
  ],
  [
    "updates translated labels and controls the city search panel",
    async () => {
      const { api, document, getElement, queryLists } = createApp();
      const label = createElement();
      label.dataset.i18n = "title";
      const ariaLabel = createElement();
      ariaLabel.dataset.i18nLabel = "city_label";
      const title = createElement();
      title.dataset.i18nTitle = "refresh";
      const placeholder = createElement();
      placeholder.dataset.i18nPlaceholder = "city_placeholder";
      const languageButton = createElement("button");
      languageButton.dataset.lang = "en";
      queryLists.set("[data-i18n]", [label]);
      queryLists.set("[data-i18n-label]", [ariaLabel]);
      queryLists.set("[data-i18n-title]", [title]);
      queryLists.set("[data-i18n-placeholder]", [placeholder]);
      queryLists.set("[data-lang]", [languageButton]);

      await api.setLang("en");
      assertEqual(document.documentElement.lang, "en");
      assertEqual(document.title, "Weather");
      assertEqual(label.textContent, "Weather");
      assertEqual(ariaLabel.getAttribute("aria-label"), "City");
      assertEqual(title.title, "Refresh");
      assertEqual(placeholder.placeholder, "Enter a city");
      assertEqual(languageButton.classList.values.has("act"), true);

      api.setCitySearchOpen(true);
      assertEqual(getElement("city-form").hidden, false);
      assertEqual(getElement("city-input").value, "Berlin");
      assertEqual(
        getElement("city-input").getAttribute("aria-expanded"),
        "false",
      );
      api.setCitySearchOpen(false);
      assertEqual(getElement("city-form").hidden, true);
    },
  ],
  [
    "shows localized city suggestions and hides results for short queries",
    async () => {
      const { api, getElement } = createApp(() =>
        Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              results: [
                { name: "Berlin", admin1: "Berlin", country: "Germany" },
                { name: "Bergen" },
              ],
            }),
        }),
      );
      getElement("city-form").hidden = false;
      getElement("city-input").value = "Ber";

      api.updateCitySuggestions("B");
      assertEqual(getElement("city-suggestions").hidden, true);
      api.updateCitySuggestions("Ber");
      await new Promise((resolve) => setTimeout(resolve, 350));

      const list = getElement("city-suggestions");
      assertEqual(list.hidden, false);
      assertEqual(list.getAttribute("role"), "listbox");
      assertEqual(list.children.length, 2);
      assertEqual(list.children[0].textContent, "Berlin");
      assertEqual(list.children[0].children[0].textContent, "Berlin, Germany");
      assertEqual(
        getElement("city-input").getAttribute("aria-expanded"),
        "true",
      );

      api.showCitySuggestions([], "No cities");
      assertEqual(list.getAttribute("role"), "status");
      assertEqual(list.children[0].textContent, "No cities");
      api.hideCitySuggestions();
      assertEqual(list.hidden, true);
      assertEqual(list.children.length, 0);
    },
  ],
  [
    "shows a city-search error when geocoding fails",
    async () => {
      const { api, getElement } = createApp(() =>
        Promise.reject(new Error("Geocoding unavailable")),
      );
      getElement("city-form").hidden = false;
      getElement("city-input").value = "Berlin";

      api.updateCitySuggestions("Berlin");
      await new Promise((resolve) => setTimeout(resolve, 350));

      assertEqual(
        getElement("city-suggestions").getAttribute("role"),
        "status",
      );
      assertEqual(
        getElement("city-suggestions").children[0].textContent,
        "Stadtvorschläge konnten nicht geladen werden.",
      );
    },
  ],
  [
    "selects a city suggestion and closes the suggestion list",
    async () => {
      const { api, getElement } = createApp(() =>
        Promise.reject(new Error("Weather service unavailable")),
      );
      api.showCitySuggestions(
        [
          {
            name: "Hamburg",
            admin1: "Hamburg",
            country: "Germany",
            latitude: 53.55,
            longitude: 10,
            timezone: "Europe/Berlin",
          },
        ],
        "",
      );

      await getElement("city-suggestions").children[0].onclick();
      await new Promise((resolve) => setTimeout(resolve, 20));

      assertEqual(getElement("city-suggestions").hidden, true);
      assertEqual(
        getElement("city-input").getAttribute("aria-expanded"),
        "false",
      );
      assertEqual(getElement("city-input").value, "Hamburg");
    },
  ],
  [
    "shows retry actions and reports a failed location load",
    async () => {
      const { api, getElement } = createApp();

      api.status("Temporarily unavailable", "warn", true);
      const status = getElement("status");
      assertEqual(status.className, "status warn");
      assertEqual(status.children.length, 1);
      assertEqual(status.children[0].textContent, "Erneut versuchen");

      await status.children[0].onclick();
      assertEqual(status.className, "status err");
      assertEqual(status.children.length, 2);
      assertEqual(status.children[1].textContent, "Erneut versuchen");
    },
  ],
  [
    "renders current conditions, hourly chart, daily cards, and sun arc",
    () => {
      const { api, elements } = createApp();
      api.setWeather(createWeatherFixture());
      api.setLocation({ city: "Berlin", country: "Deutschland" });

      api.render();

      assertEqual(elements.get("dash").hidden, false);
      assertEqual(elements.get("place").textContent, "Berlin, Deutschland");
      assertEqual(elements.get("hero-temp").textContent, "18");
      assertEqual(elements.get("m-humidity").textContent, "65");
      assertEqual(elements.get("strip").children.length, 3);
      assertEqual(
        elements.get("strip").children[0].children[0].textContent,
        "Jetzt",
      );
      assertMatch(elements.get("chart").innerHTML, /class="line"/);
      assertEqual(elements.get("daily").children.length, 2);
      assertMatch(elements.get("sunarc").innerHTML, /class="sunball"/);
      assertEqual(elements.get("daylight").textContent, "12:15 h");
    },
  ],
  [
    "opens and navigates daily forecast details",
    () => {
      const { api, elements } = createApp();
      api.setWeather(createWeatherFixture());

      api.openDay(0);
      assertEqual(elements.get("day").open, true);
      assertEqual(elements.get("day-prev").disabled, true);
      assertEqual(elements.get("day-next").disabled, false);
      assertEqual(elements.get("day-tiles").children.length, 8);
      assertEqual(elements.get("day-strip").children.length, 3);

      api.stepDay(1);
      assertEqual(elements.get("day-prev").disabled, false);
      assertEqual(elements.get("day-next").disabled, true);
      assertEqual(elements.get("day-hi").textContent, "16°");
      api.stepDay(1);
      assertEqual(elements.get("day-hi").textContent, "16°");
      api.stepDay(-1);
      assertEqual(elements.get("day-hi").textContent, "20°");
    },
  ],
  [
    "renders SVG weather icons and selects the matching sky category",
    () => {
      const { api } = createApp();
      const { wxIcon, wxSky } = api;

      assertMatch(wxIcon(0, true), /^<svg class="wx"/);
      assertMatch(wxIcon(0, true), /class="sun"/);
      assertMatch(wxIcon(0, false), /class="moon"/);
      assertEqual(wxSky(95, true), "storm");
      assertEqual(wxSky(73, true), "snow");
      assertEqual(wxSky(61, true), "rain");
      assertEqual(wxSky(48, true), "fog");
      assertEqual(wxSky(3, true), "cloudy");
      assertEqual(wxSky(0, false), "clear-night");
    },
  ],
  [
    "renders the correct SVG weather symbols across WMO code ranges",
    () => {
      const { api } = createApp();
      const expectations = [
        [0, true, /class="sun"/],
        [0, false, /class="moon"/],
        [1, true, /class="cloud"/],
        [2, false, /class="moon"/],
        [3, true, /class="cloud dark"/],
        [45, true, /class="fogl"/],
        [48, true, /class="fogl"/],
        [51, true, /class="rain"/],
        [55, true, /class="drop"/],
        [56, true, /class="flake"/],
        [57, false, /class="flake"/],
        [61, true, /class="cloud dark"/],
        [65, true, /class="drop"/],
        [66, true, /class="flake"/],
        [67, false, /class="flake"/],
        [71, true, /class="snow"/],
        [77, true, /class="flake"/],
        [80, true, /class="cloud dark"/],
        [82, false, /class="drop"/],
        [85, true, /class="snow"/],
        [86, false, /class="flake"/],
        [95, true, /class="bolt"/],
        [96, true, /class="flake"/],
        [99, false, /class="flake"/],
        [10, true, /class="cloud"/],
      ];

      for (const [code, isDay, expected] of expectations) {
        const svg = api.wxIcon(code, isDay);
        assertMatch(svg, /^<svg class="wx" viewBox="0 0 64 64"/);
        assertMatch(svg, expected);
      }
    },
  ],
  [
    "maps every WMO weather family to its sky category",
    () => {
      const { api } = createApp();
      const expectations = [
        [0, "clear-day"],
        [1, "clear-day"],
        [3, "cloudy"],
        [45, "fog"],
        [48, "fog"],
        [51, "rain"],
        [57, "rain"],
        [61, "rain"],
        [67, "rain"],
        [71, "snow"],
        [77, "snow"],
        [80, "rain"],
        [82, "rain"],
        [85, "snow"],
        [86, "snow"],
        [95, "storm"],
        [99, "storm"],
      ];

      for (const [code, expected] of expectations) {
        assertEqual(api.wxSky(code, true), expected);
      }
      assertEqual(api.wxSky(48, false), "fog");
      assertEqual(api.wxSky(2, false), "clear-night");
    },
  ],
  [
    "selects one accessible theme mode and applies automatic system preference",
    async () => {
      const { api, storage, cacheStorage, themeButtons, document } = createApp(
        undefined,
        true,
      );

      await api.setTheme("auto");
      assertEqual(document.documentElement.dataset.theme, "dark");
      assertEqual(await api.readCache("wx.theme"), "auto");
      assertEqual(storage.has("wx.theme"), false);
      assertEqual(
        new TextDecoder()
          .decode(cacheStorage.get("cache").get("wx.theme").data)
          .includes("auto"),
        false,
      );
      assertDeepEqual(
        themeButtons.map((button) => button.attributes["aria-pressed"]),
        ["true", "false", "false"],
      );

      api.setTheme("light");
      assertEqual(document.documentElement.dataset.theme, "light");
      assertDeepEqual(
        themeButtons.map((button) => button.classes.has("act")),
        [false, true, false],
      );

      api.setTheme("dark");
      assertEqual(document.documentElement.dataset.theme, "dark");
      assertDeepEqual(
        themeButtons.map((button) => button.attributes["aria-pressed"]),
        ["false", "false", "true"],
      );
    },
  ],
];

Deno.test("weather dashboard app", async (t) => {
  for (const [name, run] of tests) {
    await t.step(name, async () => {
      try {
        await run();
        console.log(`✔ ${name}`);
      } catch (error) {
        console.error(`✖ ${name}`);
        console.error(error);
        throw error;
      } finally {
        restoreGlobals();
      }
    });
  }
});
