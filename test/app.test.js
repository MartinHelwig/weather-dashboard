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

function assertOk(value) {
  if (!value) fail(`Expected a truthy value, got ${JSON.stringify(value)}`);
}

function assertNotEqual(actual, expected, message) {
  if (Object.is(actual, expected)) fail(message);
}

function createIndexedDB() {
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
              request.result = store.get(key);
              request.onsuccess();
              queueMicrotask(() => transaction.oncomplete());
            });
            return request;
          },
          put: (value, key) => {
            const request = {};
            queueMicrotask(() => {
              store.set(key, value);
              request.result = key;
              request.onsuccess();
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
        request.result = database;
        if (stores.size === 0) request.onupgradeneeded();
        request.onsuccess();
      });
      return request;
    },
  };
}

function createApp(
  fetchImpl = async () => {
    throw new Error("Unexpected network request");
  },
  prefersDark = false,
) {
  restoreGlobals();

  const storage = new Map();
  const indexedDB = createIndexedDB();
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
  const globals = {
    document: {
      documentElement: { dataset: {} },
      querySelectorAll: (selector) =>
        selector === "[data-theme-mode]" ? themeButtons : [],
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
  const api = new Function(
    `${textsSource}\n${iconsSource}\n${withoutStartup}\nreturn {
      num, temp, compass, wmoText, uvLevel, moonPhase, dayName,
      placeFromResult, searchCities, locate, forecast, readCache, writeCache,
      wxIcon: globalThis.wxIcon, wxSky: globalThis.wxSky,
      setLang: (value) => { lang = value; },
      setTheme,
      getWeather: () => wx
    };`,
  )();

  return {
    api,
    storage,
    cacheStorage: indexedDB.stores,
    themeButtons,
    document: globals.document,
  };
}

const tests = [
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
      const { api, cacheStorage } = createApp(async () => {
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
      const { api } = createApp(async (url) => {
        requestedUrl = url;
        return { ok: true, json: async () => ({}) };
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
      const response = { current: { temperature_2m: 18 } };
      const { api, cacheStorage } = createApp(async (url) => {
        requestedUrl = url;
        return { ok: true, json: async () => response };
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
      const { api, cacheStorage } = createApp(async () => {
        calls++;
        return { ok: true, json: async () => response };
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

async function runTests() {
  let passed = 0;
  let failed = 0;

  for (const [name, run] of tests) {
    try {
      await run();
      passed++;
      console.log(`✔ ${name}`);
    } catch (error) {
      failed++;
      console.error(`✖ ${name}`);
      console.error(error);
    }
  }

  restoreGlobals();
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) Deno.exitCode = 1;
}

await runTests();
