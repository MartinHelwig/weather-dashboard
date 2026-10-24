// SPDX-FileCopyrightText: 2026 Martin Helwig
//
// SPDX-License-Identifier: MIT

/* global Deno */

"use strict";

const coverageDirectory = new URL("../build/tests/coverage/", import.meta.url);
const targets = [
  {
    label: "www/js/app.js",
    url: new URL("../www/js/app.js", import.meta.url).href,
    sourceLength: (
      await Deno.readTextFile(new URL("../www/js/app.js", import.meta.url))
    ).length,
    functions: new Map(),
  },
  {
    label: "www/js/icons.js",
    url: new URL("../www/js/icons.js", import.meta.url).href,
    sourceLength: (
      await Deno.readTextFile(new URL("../www/js/icons.js", import.meta.url))
    ).length,
    functions: new Map(),
  },
];

for await (const entry of Deno.readDir(coverageDirectory)) {
  if (!entry.isFile || !entry.name.endsWith(".json")) continue;

  const profile = JSON.parse(
    await Deno.readTextFile(new URL(entry.name, coverageDirectory)),
  );
  const target = targets.find((item) => item.url === profile.url);
  if (!target) continue;

  for (const fn of profile.functions) {
    const range = fn.ranges[0];
    if (
      !range ||
      range.startOffset === 0 ||
      range.endOffset > target.sourceLength
    ) continue;

    const key = `${fn.functionName}:${range.startOffset}:${range.endOffset}`;
    target.functions.set(
      key,
      Boolean(target.functions.get(key) || range.count > 0),
    );
  }
}

for (const target of targets) {
  const total = target.functions.size;
  const covered = [...target.functions.values()].filter(Boolean).length;
  if (total === 0) {
    throw new Error(`No coverage data found for ${target.url}`);
  }
  console.log(
    `Code coverage (${target.label}): ${covered}/${total} functions (${
      ((covered / total) * 100).toFixed(1)
    }%)`,
  );
}
