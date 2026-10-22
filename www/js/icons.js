// SPDX-FileCopyrightText: 2023 Martin Helwig
//
// SPDX-License-Identifier: MIT

// www/js/icons.js - The weather icons as inline SVG (viewBox 64 x 64), drawn from a few parts; the colours come from
// the CSS variables of style.css, so light and dark mode and the sky of the hero card need nothing here.
// wxIcon(code, isDay) -> SVG text for a WMO weather code; wxSky(code, isDay) -> the sky name for the hero background.
const WX_PARTS = {
  sun: (x, y, r) => {
    let rays = "";
    for (let i = 0; i < 8; i++) {
      const a = (i * Math.PI) / 4,
        c = Math.cos(a),
        s = Math.sin(a);
      rays += `<path d="M${(x + c * (r + 4)).toFixed(1)} ${(y + s * (r + 4)).toFixed(1)}L${(x + c * (r + 9)).toFixed(1)} ${(y + s * (r + 9)).toFixed(1)}"/>`;
    }
    return `<g class="sun"><g class="rays" style="transform-origin:${x}px ${y}px">${rays}</g><circle cx="${x}" cy="${y}" r="${r}"/></g>`;
  },
  moon: (x, y, s) =>
    `<path class="moon" transform="translate(${x} ${y}) scale(${s})" d="M0 -16a16 16 0 1 0 16 22A13 13 0 0 1 0 -16z"/>`,
  cloud: (x, y, s, cls) =>
    `<path class="${cls || "cloud"}" transform="translate(${x} ${y}) scale(${s})" d="M14 44h28a10 10 0 0 0 1.5-19.9A14 14 0 0 0 16.5 27 8.6 8.6 0 0 0 14 44z"/>`,
  drops: (n, long) => {
    let d = "";
    for (let i = 0; i < n; i++)
      d += `<path class="drop" style="animation-delay:${i * 0.25}s" d="M${22 + i * 10} 49l-${long ? 4 : 2.5} ${long ? 9 : 6}"/>`;
    return `<g class="rain">${d}</g>`;
  },
  flakes: (n) => {
    let d = "";
    for (let i = 0; i < n; i++)
      d += `<circle class="flake" style="animation-delay:${i * 0.3}s" cx="${22 + i * 10}" cy="${52 + (i % 2) * 5}" r="2.4"/>`;
    return `<g class="snow">${d}</g>`;
  },
  bolt: () => `<path class="bolt" d="M34 38l-9 15h7l-3 10 13-17h-8l4-8z"/>`,
  hail: () =>
    `<g class="snow"><circle class="flake" cx="22" cy="58" r="2"/><circle class="flake" cx="48" cy="58" r="2"/></g>`,
  fog: () => `<g class="fogl"><path d="M14 48h36M18 55h28M22 62h20"/></g>`,
};

globalThis.wxIcon = function (code, isDay) {
  const P = WX_PARTS;
  const star = (x, y, r) =>
    isDay ? P.sun(x, y, r) : P.moon(x + 2, y + 2, r / 11);
  let g = "";
  if (code === 0) g = star(32, 32, 12);
  else if (code === 1) g = star(26, 26, 10) + P.cloud(14, 8, 0.6);
  else if (code === 2) g = star(24, 22, 9) + P.cloud(6, 4, 0.95);
  else if (code === 3)
    g = P.cloud(-2, -8, 0.8, "cloud dark") + P.cloud(6, 2, 0.95);
  else if (code === 45 || code === 48) g = P.cloud(6, -6, 0.95) + P.fog();
  else if (code >= 51 && code <= 57)
    g =
      P.cloud(6, -6, 0.95) +
      P.drops(3, false) +
      (code >= 56 ? P.flakes(1) : "");
  else if (code >= 61 && code <= 67)
    g =
      P.cloud(6, -6, 0.95, "cloud dark") +
      P.drops(3, true) +
      (code >= 66 ? P.flakes(1) : "");
  else if (code >= 71 && code <= 77) g = P.cloud(6, -6, 0.95) + P.flakes(3);
  else if (code >= 80 && code <= 82)
    g = star(22, 18, 8) + P.cloud(8, -6, 0.9, "cloud dark") + P.drops(3, true);
  else if (code === 85 || code === 86)
    g = star(22, 18, 8) + P.cloud(8, -6, 0.9) + P.flakes(3);
  else if (code >= 95)
    g =
      P.cloud(6, -10, 0.95, "cloud dark") +
      P.bolt() +
      (code >= 96 ? P.hail() : "");
  else g = P.cloud(6, 0, 0.95);
  return `<svg class="wx" viewBox="0 0 64 64" aria-hidden="true">${g}</svg>`;
};

globalThis.wxSky = function (code, isDay) {
  if (code >= 95) return "storm";
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return "snow";
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return "rain";
  if (code === 45 || code === 48) return "fog";
  if (code === 3) return "cloudy";
  return isDay ? "clear-day" : "clear-night";
};
