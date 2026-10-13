// Dark-mode audit (#228): checks the harness itself on made-up emails whose right answers are
// known, so its numbers can be trusted on real mail. Needs Playwright's Chromium.
//
//   node scripts/dark-audit/selftest.mjs
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { prepareCorpus } from './prepare.mjs';
import { auditEmails } from './audit.mjs';

const FIXTURES = {
  // Sets no colors: the theme's text on the theme's background reads fine.
  plain: '<p>Hello there, this is a plain email with no colors of its own.</p>',
  // Dark text set by the sender stays dark on the dark background.
  inlineDarkText: '<p style="color:#333333">Dark gray text set inline by the sender, a whole sentence of it.</p>',
  // A white card keeps its own dark text: readable, but a bright block.
  whiteCard: '<table width="100%" bgcolor="#ffffff" cellpadding="0" cellspacing="0"><tr><td style="color:#222222;padding:40px;height:400px">Card text in a white table cell, as most newsletters are built.</td></tr></table>',
  // Preview text hidden in the usual ways is not text anyone reads.
  preheader: '<div style="display:none">Hidden one</div>'
    + '<span style="font-size:1px;color:#ffffff;line-height:1px">Hidden two</span>'
    + '<div style="max-height:0;overflow:hidden">Hidden three</div>'
    + '<div style="color:#ffffff">Hidden four, white on white</div>'
    + '<div style="position:absolute;left:-9999px">Hidden five</div>'
    + '<p>Visible body text.</p>',
  // Text over a background image has no single background color.
  backgroundImage: '<table><tr><td style="background-image:url(https://example.invalid/bg.png);background-color:#123456;color:#ffffff;padding:20px">Text over an image</td></tr></table>',
  // The sender's own dark design, which phase 1 shows.
  senderDark: '<style>@media (prefers-color-scheme: dark) { .card { background: #111111 !important; color: #eeeeee !important; } }</style>'
    + '<div class="card" style="background:#ffffff;color:#222222;padding:40px;height:400px">A card that knows how to be dark.</div>',
  // A sender that asks to stay light.
  lightOnly: '<html><head><meta name="color-scheme" content="only light"></head><body><p style="color:#333">Keep me light please.</p><img src="https://example.invalid/pixel.gif" width="1" height="1"></body></html>',
};

const dir = mkdtempSync(join(tmpdir(), 'dark-audit-selftest-'));
try {
  writeFileSync(join(dir, 'synthetic.jsonl'), Object.entries(FIXTURES)
    .map(([key, html]) => JSON.stringify({ key, instance: 'selftest', domain: `${key}.example`, subject: key, html }))
    .join('\n') + '\n');
  const prepared = prepareCorpus(dir);
  const byKey = Object.fromEntries(prepared.map(e => [e.key, e]));
  assert.ok(byKey.senderDark.darkCss.includes('#111111'), 'the sender dark design is split off');
  assert.equal(byKey.plain.darkCss, '');
  assert.equal(byKey.lightOnly.lightOnly, true);

  const stats = {};
  const results = Object.fromEntries((await auditEmails(prepared, { stats, concurrency: 2 })).map(r => [r.key, r]));
  for (const r of Object.values(results)) assert.equal(r.error, undefined, `${r.key}: ${r.error}`);
  assert.ok(stats.requests > 0, 'the fixtures do make requests');
  assert.equal(stats.blocked, stats.requests, 'every request is blocked by the harness');

  const m = (key, mode) => results[key].modes[mode];
  assert.equal(m('plain', 'naive').verdict, 'clean');
  assert.equal(m('plain', 'light').summary.unreadable, 0);

  assert.equal(m('inlineDarkText', 'light').summary.unreadable, 0);
  assert.equal(m('inlineDarkText', 'naive').verdict, 'broken');
  assert.ok(m('inlineDarkText', 'naive').worst[0].ratio < 2, 'dark gray on near-black');

  assert.equal(m('whiteCard', 'naive').verdict, 'clean');
  assert.ok(m('whiteCard', 'naive').bright > 0.5, `white card is bright: ${m('whiteCard', 'naive').bright}`);
  assert.ok(m('plain', 'naive').bright < 0.05, `plain dark is not: ${m('plain', 'naive').bright}`);

  // Only "Visible body text." is visible text, apart from the white-on-white line, which is
  // measured but is the sender's own hiding (ratio 1) and so never counts as a regression.
  assert.equal(m('preheader', 'light').summary.chars, 'Visible body text.'.length + 'Hidden four, white on white'.length);
  assert.equal(m('preheader', 'naive').counted, 'Visible body text.'.length);

  assert.equal(m('backgroundImage', 'light').summary.overImage, 'Text over an image'.length);

  assert.equal(m('senderDark', 'phase1').verdict, 'clean');
  assert.ok(m('senderDark', 'phase1').bright < 0.05, `phase 1 card is dark: ${m('senderDark', 'phase1').bright}`);
  assert.ok(m('senderDark', 'naive').bright > 0.5, 'naive leaves it white');
  assert.equal(m('plain', 'phase1'), undefined, 'phase 1 only applies to a sender dark design');
  assert.equal(m('lightOnly', 'phase1'), undefined, 'nor to a sender that asks to stay light');

  console.log(`selftest passed: ${Object.keys(FIXTURES).length} fixtures, all ${stats.requests} network requests blocked`);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
