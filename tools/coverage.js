// SPDX-FileCopyrightText: 2026 Martin Helwig
//
// SPDX-License-Identifier: MIT

/* global Deno */

"use strict";

const coverageDirectory = new URL("../build/tests/coverage/", import.meta.url);
const reportPath = new URL("../build/tests/jacoco.xml", import.meta.url);
const targets = [
  {
    label: "www/js/app.js",
    className: "www/js/app",
    sourceName: "app.js",
    url: new URL("../www/js/app.js", import.meta.url).href,
  },
  {
    label: "www/js/icons.js",
    className: "www/js/icons",
    sourceName: "icons.js",
    url: new URL("../www/js/icons.js", import.meta.url).href,
  },
];

for (const target of targets) {
  target.source = await Deno.readTextFile(
    new URL(`../${target.label}`, import.meta.url),
  );
  target.sourceLength = target.source.length;
  target.functions = new Map();
  target.ranges = new Map();
}

for await (const entry of Deno.readDir(coverageDirectory)) {
  if (!entry.isFile || !entry.name.endsWith(".json")) continue;

  const profile = JSON.parse(
    await Deno.readTextFile(new URL(entry.name, coverageDirectory)),
  );
  const target = targets.find((item) => item.url === profile.url);
  if (!target) continue;

  for (const fn of profile.functions) {
    for (const range of fn.ranges) {
      if (
        range.endOffset > target.sourceLength ||
        range.startOffset >= range.endOffset
      )
        continue;

      const key = `${range.startOffset}:${range.endOffset}`;
      target.ranges.set(
        key,
        Math.max(target.ranges.get(key) ?? 0, range.count),
      );
    }

    const range = fn.ranges[0];
    if (
      !range ||
      range.startOffset === 0 ||
      range.endOffset > target.sourceLength
    )
      continue;

    const key = `${fn.functionName}:${range.startOffset}:${range.endOffset}`;
    target.functions.set(
      key,
      Boolean(target.functions.get(key) || range.count > 0),
    );
  }
}

function escapeXml(value) {
  return value.replace(/[<>&"']/g, (character) => {
    switch (character) {
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case "&":
        return "&amp;";
      case '"':
        return "&quot;";
      default:
        return "&apos;";
    }
  });
}

function getLineCoverage(target) {
  const ranges = [...target.ranges.entries()].map(([key, count]) => {
    const [startOffset, endOffset] = key.split(":").map(Number);
    return { startOffset, endOffset, count };
  });
  const lines = [];
  let lineNumber = 1;
  let lineStart = 0;

  while (lineStart <= target.sourceLength) {
    const newline = target.source.indexOf("\n", lineStart);
    const lineEnd = newline === -1 ? target.sourceLength : newline;
    let executable = false;
    let covered = false;

    for (let offset = lineStart; offset < lineEnd; offset++) {
      if (/\s/.test(target.source[offset])) continue;

      let smallestRangeLength = Infinity;
      let offsetCovered = false;
      for (const range of ranges) {
        if (range.startOffset > offset || range.endOffset <= offset) continue;

        const rangeLength = range.endOffset - range.startOffset;
        if (rangeLength < smallestRangeLength) {
          smallestRangeLength = rangeLength;
          offsetCovered = range.count > 0;
        } else if (rangeLength === smallestRangeLength && range.count > 0) {
          offsetCovered = true;
        }
      }

      if (smallestRangeLength === Infinity) continue;
      executable = true;
      covered ||= offsetCovered;
    }

    if (executable) lines.push({ number: lineNumber, covered });
    if (newline === -1) break;
    lineStart = newline + 1;
    lineNumber++;
  }

  return lines;
}

function getLineNumber(source, offset) {
  return source.slice(0, offset).split("\n").length;
}

function getCounter(type, total, covered) {
  return `<counter type="${type}" missed="${
    total - covered
  }" covered="${covered}"/>`;
}

function getReportClass(target) {
  const methods = [...target.functions.entries()].map(
    ([key, covered], index) => {
      const [name, startOffset] = key.split(":");
      const methodName = name || `function_${index + 1}`;
      const line = getLineNumber(target.source, Number(startOffset));
      return (
        `<method name="${escapeXml(methodName)}" desc="()V" line="${line}">` +
        `${getCounter("METHOD", 1, Number(covered))}</method>`
      );
    },
  );
  const coveredMethods = [...target.functions.values()].filter(Boolean).length;
  const coveredLines = target.lines.filter((line) => line.covered).length;

  return {
    coveredLines,
    coveredMethods,
    xml: [
      `<class name="${target.className}" sourcefilename="${target.sourceName}">`,
      ...methods,
      getCounter("LINE", target.lines.length, coveredLines),
      getCounter("METHOD", target.functions.size, coveredMethods),
      getCounter("CLASS", 1, Number(coveredMethods > 0)),
      "</class>",
      `<sourcefile name="${target.sourceName}">`,
      ...target.lines.map(
        (line) =>
          `<line nr="${line.number}" mi="${Number(!line.covered)}" ci="${Number(
            line.covered,
          )}" mb="0" cb="0"/>`,
      ),
      getCounter("LINE", target.lines.length, coveredLines),
      "</sourcefile>",
    ].join("\n"),
  };
}

for (const target of targets) {
  const total = target.functions.size;
  const covered = [...target.functions.values()].filter(Boolean).length;
  if (total === 0) {
    throw new Error(`No coverage data found for ${target.url}`);
  }

  target.lines = getLineCoverage(target);
  console.log(
    `Code coverage (${target.label}): ${covered}/${total} functions (${(
      (covered / total) *
      100
    ).toFixed(1)}%)`,
  );
}

const classes = targets.map(getReportClass);
const coveredLines = classes.reduce((sum, item) => sum + item.coveredLines, 0);
const totalLines = targets.reduce(
  (sum, target) => sum + target.lines.length,
  0,
);
const coveredMethods = classes.reduce(
  (sum, item) => sum + item.coveredMethods,
  0,
);
const totalMethods = targets.reduce(
  (sum, target) => sum + target.functions.size,
  0,
);
const coveredClasses = classes.filter((item) => item.coveredMethods > 0).length;

const report = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<report name="weather-dashboard">',
  '<package name="www/js">',
  ...classes.map((item) => item.xml),
  getCounter("LINE", totalLines, coveredLines),
  getCounter("METHOD", totalMethods, coveredMethods),
  getCounter("CLASS", classes.length, coveredClasses),
  "</package>",
  getCounter("LINE", totalLines, coveredLines),
  getCounter("METHOD", totalMethods, coveredMethods),
  getCounter("CLASS", classes.length, coveredClasses),
  "</report>",
  "",
].join("\n");

await Deno.writeTextFile(reportPath, report);
console.log(`JaCoCo XML report: ${reportPath.pathname}`);
