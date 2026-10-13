// Dark-mode audit (#228), step 2 of 3: render each prepared email the way the reader does and score
// how readable each way of showing it is.
//
//   node scripts/dark-audit/audit.mjs <corpus-dir> [--modes light,naive,phase1] [--limit N] [--only key,key]
//
// Every email is rendered with the reader's own frame document (frontend utils/emailFrameDoc.js) in
// Chromium, at a reading-pane width, with ALL network requests blocked: rendering hundreds of real
// newsletters must not load their tracking pixels and mark them opened. Remote images therefore
// show as empty boxes.
//
// Modes:
//   light   as sent, forced light: the baseline every other mode is compared with
//   naive   the theme's dark background and text, nothing else (the approach declined on #228)
//   phase1  the sender's own dark design, for emails that carry one
//
// For each mode it records the contrast of every piece of visible text (utils/emailContrast.js),
// the text that is readable in light but not in this mode ("regressed"), and the share of the
// email's area that is bright. Results and screenshots go to <corpus-dir>/audit/.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { buildFrameDoc, DARK_DEFAULTS } from '../../frontend/src/utils/emailFrameDoc.js';
import { summarize, parseColor, UNREADABLE, HIDDEN } from '../../frontend/src/utils/emailContrast.js';
import { measureContentHeight } from '../../frontend/src/utils/emailFrameHeight.js';
import { PREPARED } from './prepare.mjs';

export const WIDTH = 720;
export const MAX_HEIGHT = 1400;
export const ALL_MODES = ['light', 'naive', 'phase1'];

// The measuring code runs inside the rendered email. The frame's CSP forbids scripts, so it is
// evaluated over the DevTools protocol (which the CSP does not govern) as one expression.
const CONTRAST_SOURCE = readFileSync(new URL('../../frontend/src/utils/emailContrast.js', import.meta.url), 'utf8')
  .replace(/^export /gm, '');
const measureExpression = (canvas) =>
  `(() => { ${CONTRAST_SOURCE}\n return measureTextContrast(document, { canvas: ${JSON.stringify(canvas)}, samples: true }); })()`;

const LIGHT_CANVAS = { r: 255, g: 255, b: 255, a: 1 };
const hexToRgb = (hex) => {
  const n = Number.parseInt(hex.slice(1), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, a: 1 };
};
const DARK_CANVAS = parseColor(DARK_DEFAULTS.background) ?? hexToRgb(DARK_DEFAULTS.background);

export function frameDocFor(email, mode) {
  if (mode === 'light') return buildFrameDoc({ html: email.html });
  if (mode === 'naive') return buildFrameDoc({ html: email.html, dark: true, palette: DARK_DEFAULTS });
  if (mode === 'phase1') return buildFrameDoc({ html: email.html, dark: true, palette: DARK_DEFAULTS, darkCss: email.darkCss });
  throw new Error(`unknown mode ${mode}`);
}

export const appliesTo = (email, mode) => mode !== 'phase1' || (Boolean(email.darkCss) && !email.lightOnly);

// Text readable in light (and not hidden by the sender there) that this mode makes unreadable.
export function compareWithLight(light, other) {
  const base = new Map(light.map(e => [e.i, e]));
  let counted = 0;
  let regressed = 0;
  const worst = [];
  for (const e of other) {
    const l = base.get(e.i);
    // Not shown in light, or shown at (almost) no contrast there: the sender's own hidden text.
    if (!l || l.ratio === null || l.ratio < HIDDEN || l.overImage) continue;
    if (e.overImage || e.ratio === null) continue;
    counted += e.chars;
    if (e.ratio < UNREADABLE && l.ratio >= UNREADABLE) {
      regressed += e.chars;
      worst.push({ ratio: e.ratio, lightRatio: l.ratio, chars: e.chars, sample: e.sample, color: e.color, background: e.background });
    }
  }
  worst.sort((a, b) => a.ratio - b.ratio || b.chars - a.chars);
  const verdict = regressed === 0 ? 'clean' : regressed <= Math.max(20, counted * 0.01) ? 'minor' : 'broken';
  return { counted, regressed, verdict, worst: worst.slice(0, 6) };
}

// Share of the screenshot's pixels that are bright (relative luminance above 0.6), worked out in a
// plain helper page.
async function brightShare(helper, png) {
  return helper.evaluate(async (b64) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = img.width;
    canvas.height = img.height;
    const g = canvas.getContext('2d');
    g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, canvas.width, canvas.height).data;
    let bright = 0;
    let n = 0;
    for (let i = 0; i < d.length; i += 16) {
      const lin = (c) => { const s = c / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
      if (0.2126 * lin(d[i]) + 0.7152 * lin(d[i + 1]) + 0.0722 * lin(d[i + 2]) > 0.6) bright += 1;
      n += 1;
    }
    return Math.round((bright / n) * 1000) / 1000;
  }, png.toString('base64'));
}

async function renderOne(page, helper, email, mode, shotsDir) {
  await page.setContent(frameDocFor(email, mode), { waitUntil: 'load', timeout: 20000 });
  const entries = await page.evaluate(measureExpression(mode === 'light' ? LIGHT_CANVAS : DARK_CANVAS));
  // The email's own height, measured as the reader sizes its frame. The document's scroll height
  // would not do: it never drops below the viewport, so short emails would count empty canvas.
  const measured = measureContentHeight(await page.evaluate(`(() => {
    const w = document.getElementById('mf-scale-wrapper');
    return { wrapperOffsetHeight: w?.offsetHeight, wrapperOffsetTop: w?.offsetTop,
      bodyScrollHeight: document.body.scrollHeight, bodyOffsetHeight: document.body.offsetHeight };
  })()`));
  const height = Math.max(1, Math.min(MAX_HEIGHT, Math.ceil(measured)));
  const clip = { x: 0, y: 0, width: WIDTH, height };
  const png = await page.screenshot({ clip });
  if (shotsDir) await page.screenshot({ clip, type: 'jpeg', quality: 55, path: join(shotsDir, `${email.key}-${mode}.jpg`) });
  return { entries, height, bright: await brightShare(helper, png) };
}

// `stats` counts every request the emails made and how many the harness blocked; the self-test
// asserts they are equal.
export async function auditEmails(emails, { modes = ALL_MODES, shotsDir = null, concurrency = 4, onProgress, stats = {} } = {}) {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: WIDTH, height: MAX_HEIGHT }, javaScriptEnabled: true });
  // Nothing leaves the machine: not images, fonts, stylesheets or tracking pixels.
  stats.requests = 0;
  stats.blocked = 0;
  context.on('request', () => { stats.requests += 1; });
  await context.route('**/*', route => { stats.blocked += 1; return route.abort(); });
  const helper = await context.newPage();
  const results = [];
  let next = 0;
  let done = 0;
  const worker = async () => {
    const page = await context.newPage();
    while (next < emails.length) {
      const email = emails[next++];
      const result = {
        key: email.key, instance: email.instance, domain: email.domain, fromName: email.fromName,
        subject: email.subject, date: email.date, hasDarkCss: Boolean(email.darkCss), lightOnly: email.lightOnly,
        modes: {},
      };
      try {
        const light = await renderOne(page, helper, email, 'light', shotsDir);
        result.modes.light = { summary: summarize(light.entries), bright: light.bright, height: light.height };
        for (const mode of modes) {
          if (mode === 'light' || !appliesTo(email, mode)) continue;
          const shown = await renderOne(page, helper, email, mode, shotsDir);
          result.modes[mode] = {
            summary: summarize(shown.entries), bright: shown.bright, height: shown.height,
            ...compareWithLight(light.entries, shown.entries),
          };
        }
      } catch (err) {
        result.error = err.message.split('\n')[0];
      }
      results.push(result);
      done += 1;
      onProgress?.(done, emails.length);
    }
    await page.close();
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, emails.length) }, worker));
  await browser.close();
  return results;
}

export function totals(results, modes = ALL_MODES) {
  const out = {};
  for (const mode of modes) {
    const rows = results.filter(r => r.modes[mode]);
    const brights = rows.map(r => r.modes[mode].bright).sort((a, b) => a - b);
    out[mode] = {
      emails: rows.length,
      clean: rows.filter(r => r.modes[mode].verdict === 'clean').length,
      minor: rows.filter(r => r.modes[mode].verdict === 'minor').length,
      broken: rows.filter(r => r.modes[mode].verdict === 'broken').length,
      medianBright: brights.length ? brights[Math.floor(brights.length / 2)] : null,
    };
  }
  return out;
}

function parseArgs(argv) {
  const args = { dir: null, modes: ALL_MODES, limit: Infinity, only: null };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--modes') args.modes = argv[++i].split(',');
    else if (argv[i] === '--limit') args.limit = Number(argv[++i]);
    else if (argv[i] === '--only') args.only = new Set(argv[++i].split(','));
    else args.dir = argv[i];
  }
  return args;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = parseArgs(process.argv.slice(2));
  if (!args.dir) { console.error('usage: audit.mjs <corpus-dir> [--modes ...] [--limit N] [--only keys]'); process.exit(2); }
  let emails = readFileSync(join(args.dir, PREPARED), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
  if (args.only) emails = emails.filter(e => args.only.has(e.key));
  emails = emails.slice(0, args.limit);
  const outDir = join(args.dir, 'audit');
  const shotsDir = join(outDir, 'shots');
  mkdirSync(shotsDir, { recursive: true });
  const started = Date.now();
  const results = await auditEmails(emails, {
    modes: args.modes, shotsDir,
    onProgress: (done, total) => { if (done % 50 === 0 || done === total) console.error(`${done}/${total}`); },
  });
  const summary = totals(results, args.modes);
  writeFileSync(join(outDir, 'results.json'), JSON.stringify({ when: new Date().toISOString(), modes: args.modes, summary, results }, null, 1));
  console.log(`audited ${results.length} emails in ${Math.round((Date.now() - started) / 1000)}s, ${results.filter(r => r.error).length} errors`);
  for (const [mode, t] of Object.entries(summary)) {
    if (mode === 'light') { console.log(`light   emails ${String(t.emails).padStart(4)}  (the baseline)  median bright ${t.medianBright}`); continue; }
    console.log(`${mode.padEnd(7)} emails ${String(t.emails).padStart(4)}  clean ${String(t.clean).padStart(4)}  minor ${String(t.minor).padStart(4)}  broken ${String(t.broken).padStart(4)}  median bright ${t.medianBright}`);
  }
}
