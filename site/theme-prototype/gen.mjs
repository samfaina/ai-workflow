// PROTOTYPE, throwaway: builds the palette CSS for the site theme prototype, nudging text tokens to WCAG AA.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

// Each palette: label, note, dark and light sets. Text tokens get checked; bg/panel/sunk/rule stay pure.
const P = {
  'rp-main': {
    label: 'Rosé Pine · Main / Dawn',
    dark: { bg: '#191724', panel: '#1f1d2e', sunk: '#26233a', rule: '#403d52', ink: '#e0def4', soft: '#908caa', line: '#ebbcba', gate: '#eb6f92', fast: '#9ccfd8', pocock: '#9ccfd8', addy: '#31748f', pstack: '#c4a7e7', hl: '#f6c177' },
    light: { bg: '#faf4ed', panel: '#fffaf3', sunk: '#f2e9e1', rule: '#dfdad9', ink: '#575279', soft: '#797593', line: '#d7827e', gate: '#b4637a', fast: '#56949f', pocock: '#56949f', addy: '#286983', pstack: '#907aa9', hl: '#ea9d34' },
  },
  'rp-moon': {
    label: 'Rosé Pine · Moon / Dawn',
    dark: { bg: '#232136', panel: '#2a273f', sunk: '#393552', rule: '#44415a', ink: '#e0def4', soft: '#908caa', line: '#ea9a97', gate: '#eb6f92', fast: '#9ccfd8', pocock: '#9ccfd8', addy: '#3e8fb0', pstack: '#c4a7e7', hl: '#f6c177' },
    light: { bg: '#faf4ed', panel: '#fffaf3', sunk: '#f2e9e1', rule: '#dfdad9', ink: '#575279', soft: '#797593', line: '#d7827e', gate: '#b4637a', fast: '#56949f', pocock: '#56949f', addy: '#286983', pstack: '#907aa9', hl: '#ea9d34' },
  },
  catppuccin: {
    label: 'Catppuccin · Mocha / Latte',
    dark: { bg: '#1e1e2e', panel: '#181825', sunk: '#313244', rule: '#45475a', ink: '#cdd6f4', soft: '#a6adc8', line: '#f9e2af', gate: '#fab387', fast: '#89dceb', pocock: '#89b4fa', addy: '#94e2d5', pstack: '#cba6f7', hl: '#f9e2af' },
    light: { bg: '#eff1f5', panel: '#e6e9ef', sunk: '#dce0e8', rule: '#ccd0da', ink: '#4c4f69', soft: '#6c6f85', line: '#df8e1d', gate: '#fe640b', fast: '#209fb5', pocock: '#1e66f5', addy: '#179299', pstack: '#8839ef', hl: '#df8e1d' },
  },
  ayu: {
    label: 'Ayu · Dark / Light (reference)',
    dark: { bg: '#0d1017', panel: '#10141c', sunk: '#1b1f29', rule: '#2d3640', ink: '#bfbdb6', soft: '#98a0ac', line: '#e6b450', gate: '#ff8f40', fast: '#39bae6', pocock: '#59c2ff', addy: '#95e6cb', pstack: '#d2a6ff', hl: '#e6b450' },
    light: { bg: '#f8f9fa', panel: '#ffffff', sunk: '#eff1f3', rule: '#dfe2e6', ink: '#4b5157', soft: '#646b72', line: '#8f5c00', gate: '#a84b05', fast: '#14708f', pocock: '#2a78b8', addy: '#23785e', pstack: '#7d4fc4', hl: '#8f5c00' },
  },
  tokyo: {
    label: 'Tokyo Night · Night / Day',
    dark: { bg: '#1a1b26', panel: '#16161e', sunk: '#292e42', rule: '#3b4261', ink: '#c0caf5', soft: '#a9b1d6', line: '#7aa2f7', gate: '#ff9e64', fast: '#73daca', pocock: '#7dcfff', addy: '#9ece6a', pstack: '#bb9af7', hl: '#e0af68' },
    light: { bg: '#e1e2e7', panel: '#e9e9ec', sunk: '#d0d5e3', rule: '#c4c8da', ink: '#3760bf', soft: '#6172b0', line: '#2e7de9', gate: '#b15c00', fast: '#118c74', pocock: '#007197', addy: '#587539', pstack: '#9854f1', hl: '#8c6c3e' },
  },
  nord: {
    label: 'Nord · Polar Night / Snow Storm',
    dark: { bg: '#2e3440', panel: '#3b4252', sunk: '#434c5e', rule: '#4c566a', ink: '#eceff4', soft: '#d8dee9', line: '#88c0d0', gate: '#d08770', fast: '#8fbcbb', pocock: '#81a1c1', addy: '#a3be8c', pstack: '#b48ead', hl: '#ebcb8b' },
    light: { bg: '#eceff4', panel: '#f5f7fa', sunk: '#e5e9f0', rule: '#d8dee9', ink: '#2e3440', soft: '#4c566a', line: '#5e81ac', gate: '#d08770', fast: '#8fbcbb', pocock: '#81a1c1', addy: '#a3be8c', pstack: '#b48ead', hl: '#7d6420' },
  },
  poimandres: {
    label: 'Poimandres · dark / light (derived)',
    dark: { bg: '#1b1e28', panel: '#232633', sunk: '#303340', rule: '#383c4f', ink: '#e4f0fb', soft: '#a6accd', line: '#5de4c7', gate: '#d0679d', fast: '#89ddff', pocock: '#add7ff', addy: '#5fb3a1', pstack: '#fcc5e9', hl: '#fffac2' },
    light: { bg: '#eef1f6', panel: '#f9fafc', sunk: '#e2e6ee', rule: '#d3d8e3', ink: '#2b2f40', soft: '#5a6080', line: '#0f8a70', gate: '#b0407c', fast: '#1f7fae', pocock: '#2f6fae', addy: '#2f7f70', pstack: '#a0478a', hl: '#8a6d00' },
  },
};

const TEXT = ['ink', 'soft', 'line', 'gate', 'fast', 'pocock', 'addy', 'pstack', 'hl'];
const ACCENTS = ['line', 'gate', 'fast'];

const hex2rgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
const rgb2hex = c => '#' + c.map(v => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');
const lum = h => {
  const [r, g, b] = hex2rgb(h).map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };
const mix = (a, b, t) => { const A = hex2rgb(a), B = hex2rgb(b); return rgb2hex(A.map((v, i) => v * t + B[i] * (1 - t))); };
// Move toward white (dark mode) or black (light mode) a step at a time: keeps hue, changes lightness only.
const nudge = (h, dark, t) => mix(dark ? '#ffffff' : '#000000', h, t);

function build(set, dark) {
  const out = { ...set };
  const adjusted = [];
  // Tints first, from the pure accents.
  const tint = k => mix(set[k], set.bg, dark ? 0.16 : 0.13);
  for (const k of ACCENTS) out[`${k}-soft`] = tint(k);
  // Marks (rails, station circles, the gate's fill and pulse) are not text, so they keep the pure palette colour.
  for (const k of ACCENTS) out[`${k}-mark`] = set[k];
  for (const k of TEXT) {
    const grounds = [set.bg, set.panel, set.sunk, ...(ACCENTS.includes(k) ? [out[`${k}-soft`]] : [])];
    let v = set[k], t = 0;
    while (Math.min(...grounds.map(g => ratio(v, g))) < 4.5 && t < 1) { t += 0.02; v = nudge(set[k], dark, t); }
    if (v !== set[k]) adjusted.push(`${k} ${set[k]}→${v}`);
    out[k] = v;
  }
  // Text on filled accents (primary button, pills, upstream pills): bg in dark mode, white in light.
  out['on-accent'] = dark ? set.bg : '#ffffff';
  for (const k of ['line', 'gate', 'pocock', 'addy', 'pstack']) {
    const r = ratio(out['on-accent'], out[k]);
    if (r < 4.5) adjusted.push(`on-accent over ${k} only ${r.toFixed(2)}:1`);
  }
  return { tokens: out, adjusted };
}

const decl = t => Object.entries(t).map(([k, v]) => `--${k}:${v}`).join(';');
let css = '';
const report = {};
for (const [id, p] of Object.entries(P)) {
  const d = build(p.dark, true), l = build(p.light, false);
  report[id] = { label: p.label, dark: d.adjusted, light: l.adjusted };
  css += `:root[data-palette="${id}"]{${decl(d.tokens)};color-scheme:dark}\n`;
  css += `@media (prefers-color-scheme: light){:root[data-palette="${id}"]:not([data-theme="dark"]){${decl(l.tokens)};color-scheme:light}}\n`;
  css += `:root[data-palette="${id}"][data-theme="light"]{${decl(l.tokens)};color-scheme:light}\n`;
}
// Bare :root defaults = first palette, so every token exists before any attribute block.
const first = build(P['rp-main'].dark, true).tokens, firstL = build(P['rp-main'].light, false).tokens;
const base = `:root{${decl(first)};color-scheme:dark}\n@media (prefers-color-scheme: light){:root:not([data-theme="dark"]){${decl(firstL)};color-scheme:light}}\n:root[data-theme="light"]{${decl(firstL)};color-scheme:light}\n`;

const tpl = readFileSync(join(here, 'template.html'), 'utf8');
const html = tpl
  .replace('/*__PALETTES__*/', base + css)
  .replace('/*__REPORT__*/', JSON.stringify(report))
  .replace('/*__LABELS__*/', JSON.stringify(Object.fromEntries(Object.entries(P).map(([k, v]) => [k, v.label]))));
writeFileSync(join(here, 'site-theme-prototype.html'), html);
for (const [id, r] of Object.entries(report)) console.log(id, '\n  dark:', r.dark.join('; ') || '—', '\n  light:', r.light.join('; ') || '—');
