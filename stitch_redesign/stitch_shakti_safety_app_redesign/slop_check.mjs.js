#!/usr/bin/env node
// scripts/slop-check.mjs
// Fails when banned design patterns appear in source files.
// Usage: node scripts/slop-check.mjs [--report] [paths...]
// A line containing "slop-allow:" followed by a reason is skipped.
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, extname } from 'node:path';

const args = process.argv.slice(2);
const report = args.includes('--report');
const given = args.filter((a) => !a.startsWith('--'));
const ROOTS = given.length
  ? given
  : ['apps/web/src', 'apps/web/index.html', 'apps/web/public', 'index.html', 'public', 'vite.config.ts', 'package.json', 'apps/web/package.json'];

const SKIP_DIR = /(^|[\\/])(node_modules|dist|build|coverage|\.git|tests?|e2e|__tests__)([\\/]|$)/;
const SKIP_FILE = /\.(test|spec)\.[jt]sx?$/;
const CODE = new Set(['.tsx', '.ts', '.jsx', '.js', '.css', '.html', '.webmanifest']);
const TW = '(?:[a-z0-9-]+:)*';
const BEFORE = '(?<![\\w.-])';
const AFTER = '(?![\\w-])';

const rules = [
  { id: 'icon-package', msg: 'Icon package import (use the custom icon set)', ext: ['.tsx', '.ts', '.jsx', '.js', '.json'],
    re: /lucide|react-icons|@heroicons|@tabler\/icons|@phosphor-icons|feather-icons|@radix-ui\/react-icons/ },
  { id: 'shadow', msg: 'Shadow (use 1px borders)', ext: ['.tsx', '.ts', '.jsx', '.css', '.html'],
    re: new RegExp(`${BEFORE}${TW}(?:drop-)?shadow(?:-(?!none${AFTER})[\\w\\[\\]/.-]+)?${AFTER}|box-shadow\\s*:\\s*(?!none)|drop-shadow\\(`) },
  { id: 'gradient', msg: 'Gradient', ext: ['.tsx', '.ts', '.jsx', '.css', '.html'],
    re: new RegExp(`${BEFORE}${TW}bg-(?:gradient|linear|radial|conic)(?:-[\\w\\[\\]/.-]+)?${AFTER}|(?:linear|radial|conic)-gradient\\(`) },
  { id: 'blur-glass', msg: 'Blur or glass effect', ext: ['.tsx', '.ts', '.jsx', '.css', '.html'],
    re: new RegExp(`${BEFORE}${TW}(?:backdrop-blur|blur)(?:-[\\w\\[\\]/.-]+)?${AFTER}|backdrop-filter`) },
  { id: 'radius', msg: 'Radius larger than rounded-sm', ext: ['.tsx', '.ts', '.jsx', '.css', '.html'],
    re: new RegExp(`${BEFORE}${TW}rounded(?:-(?:[trblse]|tl|tr|bl|br|ss|se|es|ee))?(?:-(?:md|lg|xl|2xl|3xl|4xl|full))?${AFTER}|border-radius\\s*:\\s*(?:[3-9]|[1-9]\\d)px`) },
  { id: 'raw-hex', msg: 'Raw hex outside tokens.css', ext: ['.tsx', '.ts', '.jsx', '.css', '.html'], skipFile: /tokens\.css$/,
    re: /#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b/ },
  { id: 'pure-white-black', msg: 'Pure white or pure black', ext: ['.tsx', '.ts', '.jsx', '.css', '.html', '.webmanifest'],
    re: new RegExp(`#(?:fff|ffffff|000|000000)\\b|${BEFORE}${TW}(?:bg|border|ring|fill|stroke)-(?:white|black)(?:/\\d+)?${AFTER}`, 'i') },
  { id: 'palette-color', msg: 'Default palette color (use tokens: paper, surface, ink, muted, line, teal, crimson, night)', ext: ['.tsx', '.ts', '.jsx', '.html'],
    re: new RegExp(`${BEFORE}${TW}(?:bg|text|border|ring|fill|stroke|divide|outline|from|via|to|decoration|accent|caret|placeholder)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\\d{2,3}(?:/\\d+)?${AFTER}`) },
  { id: 'banned-font', msg: 'Banned font', ext: ['.tsx', '.ts', '.jsx', '.css', '.html'],
    re: /\bInter\b|\bGeist\b|Space Grotesk/ },
  { id: 'dash', msg: 'Em dash or en dash in user-facing text', ext: ['.tsx', '.jsx', '.html', '.json', '.ts'], onlyJsonIn: /(i18n|locales)/,
    re: /[\u2013\u2014]/ },
  { id: 'emoji', msg: 'Emoji or checkmark glyph', ext: ['.tsx', '.ts', '.jsx', '.json', '.html'],
    re: /(?![\u00A9\u00AE\u2122])\p{Extended_Pictographic}|[\u2713\u2714\u2705\u2611]/u, onlyJsonIn: /(i18n|locales)/ },
  { id: 'transition-all', msg: 'transition: all', ext: ['.tsx', '.ts', '.jsx', '.css', '.html'],
    re: new RegExp(`${BEFORE}${TW}transition-all${AFTER}|transition\\s*:\\s*all`) },
  { id: 'hover-motion', msg: 'Hover animation', ext: ['.tsx', '.ts', '.jsx', '.html'],
    re: new RegExp(`${BEFORE}(?:hover:(?:-?translate|-?scale|-?rotate|animate|shadow|blur)|group-hover:|peer-hover:)[\\w\\[\\]/.-]*`) },
  { id: 'three-card-row', msg: 'grid-cols-3 feature row (review, waive with slop-allow if it is data)', ext: ['.tsx', '.jsx', '.html'],
    re: new RegExp(`${BEFORE}${TW}grid-cols-3${AFTER}`) },
];

const files = [];
(function walk(p) {
  if (!existsSync(p) || SKIP_DIR.test(p)) return;
  const st = statSync(p);
  if (st.isDirectory()) { for (const n of readdirSync(p)) walk(join(p, n)); return; }
  if (SKIP_FILE.test(p)) return;
  const ext = extname(p);
  if (CODE.has(ext) || ext === '.json') files.push(p);
})(ROOTS.length ? ROOTS[0] : '.');
for (const r of ROOTS.slice(1)) (function walk(p) {
  if (!existsSync(p) || SKIP_DIR.test(p)) return;
  const st = statSync(p);
  if (st.isDirectory()) { for (const n of readdirSync(p)) walk(join(p, n)); return; }
  if (SKIP_FILE.test(p)) return;
  const ext = extname(p);
  if (CODE.has(ext) || ext === '.json') files.push(p);
})(r);

const findings = [];
for (const f of new Set(files)) {
  const ext = extname(f);
  const lines = readFileSync(f, 'utf8').split(/\r?\n/);
  for (const rule of rules) {
    if (!rule.ext.includes(ext)) continue;
    if (rule.skipFile && rule.skipFile.test(f)) continue;
    if (ext === '.json' && rule.id !== 'icon-package' && !/(i18n|locales)/.test(f.replace(/\\/g, '/'))) continue;
    lines.forEach((line, i) => {
      if (line.includes('slop-allow:')) return;
      if (rule.re.test(line)) findings.push({ f, n: i + 1, id: rule.id, msg: rule.msg, s: line.trim().slice(0, 100) });
    });
  }
}

if (report) {
  const byRule = {};
  for (const x of findings) byRule[x.id] = (byRule[x.id] || 0) + 1;
  console.log('Findings by rule:', byRule);
}
for (const x of findings) console.log(`${x.f}:${x.n} [${x.id}] ${x.msg}\n    ${x.s}`);
console.log(findings.length ? `\nslop-check: ${findings.length} finding(s)` : 'slop-check: clean');
process.exit(findings.length ? 1 : 0);
