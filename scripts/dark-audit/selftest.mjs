// Dark-mode audit (#228): checks the harness, and the reader's dark-body code it drives, on made-up
// emails whose right answers are known. Needs Playwright's Chromium.
//
//   node scripts/dark-audit/selftest.mjs
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { prepareCorpus } from './prepare.mjs';
import { auditEmails, totals } from './audit.mjs';

const CARD = 'padding:40px;height:400px';
export const FIXTURES = {
  // Sets no colors: the theme's text on the theme's background reads fine.
  plain: '<p>Hello there, this is a plain email with no colors of its own.</p>',
  // Dark text set by the sender stays dark on the dark background unless recolored.
  inlineDarkText: '<p style="color:#333333">Dark gray text set inline by the sender, a whole sentence of it.</p>',
  // A white card keeps its own dark text: readable, but a bright block, unless recolored.
  whiteCard: `<table width="100%" bgcolor="#ffffff" cellpadding="0" cellspacing="0"><tr><td style="color:#222222;${CARD}">Card text in a white table cell, as most newsletters are built.</td></tr></table>`,
  // Preview text hidden in the usual ways is not text anyone reads.
  preheader: '<div style="display:none">Hidden one</div>'
    + '<span style="font-size:1px;color:#ffffff;line-height:1px">Hidden two</span>'
    + '<div style="max-height:0;overflow:hidden">Hidden three</div>'
    + '<div style="color:#ffffff">Hidden four, white on white</div>'
    + '<div style="position:absolute;left:-9999px">Hidden five</div>'
    + '<p>Visible body text.</p>',
  // Text over a background image has no single background color: left as sent.
  backgroundImage: '<table><tr><td style="background-image:url(https://example.invalid/bg.png);background-color:#123456;color:#ffffff;padding:20px">Text over an image</td></tr></table>',
  // A light area under a background image (a hero banner) stays as sent, light, as its colors
  // cannot be read; the email around it is still shown dark.
  lightImageArea: `<div style="background-image:url(https://example.invalid/hero.png);background-color:#ffffff;color:#222222;${CARD}">Headline over a light hero image</div><p>Text below the hero.</p>`,
  // The sender's own dark design, which is preferred when it reads.
  senderDark: '<style>@media (prefers-color-scheme: dark) { .card { background: #111111 !important; color: #eeeeee !important; } }</style>'
    + `<div class="card" style="background:#ffffff;color:#222222;${CARD}">A card that knows how to be dark.</div>`,
  // A sender dark design that darkens the card but misses a line whose inline color wins: MailFlow
  // must not show it, and recolors instead.
  brokenSenderDark: '<style>@media (prefers-color-scheme: dark) { .card { background: #111111 !important; } }</style>'
    + `<div class="card" style="background:#ffffff;${CARD}"><p style="color:#222222 !important">This line keeps its dark inline color in the sender design.</p></div>`,
  // Colored text and a pale colored callout keep their hues.
  colors: '<p style="color:#d32f2f">Red warning text that should stay red.</p>'
    + '<p style="color:#1565c0">Blue informational text that should stay blue.</p>'
    + '<div style="background:#fff3cd;color:#856404;padding:12px">A pale yellow callout with brown text.</div>',
  // A dark header with white text is dark already: left alone.
  darkHeader: '<div id="hdr" style="background:#1a237e;color:#ffffff;padding:16px">Dark header with white text</div><p>Body text below it.</p>',
  // Links that animate their color, common in newsletters: showing it dark must not read the
  // color mid-animation and take the old dark text on the new dark background as unreadable.
  transitions: '<style>a, p { transition: color 2s, background-color 2s; }</style>'
    + '<p style="color:#222222">Body text that fades between colors.</p><p><a href="https://example.invalid/" style="color:#1a0dab">A link that fades too</a></p>',
  // A sender that asks to stay light.
  lightOnly: '<html><head><meta name="color-scheme" content="only light"></head><body><p style="color:#333">Keep me light please.</p><img src="https://example.invalid/pixel.gif" width="1" height="1"></body></html>',
};

export async function runSelftest() {
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
    const list = await auditEmails(prepared, { stats });
    const results = Object.fromEntries(list.map(r => [r.key, r]));
    for (const r of list) {
      assert.equal(r.error, undefined, `${r.key}: ${r.error}`);
      assert.equal(r.restoreMismatch, false, `${r.key}: putting it back as sent is exact`);
    }
    assert.ok(stats.blocked > 0, 'the fixtures do make requests');
    assert.equal(stats.served + stats.blocked, stats.requests, 'every request is either the harness or blocked');
    assert.ok(stats.served <= 8, `only the harness page and its modules are served (${stats.served})`);

    const m = (key, mode) => results[key].modes[mode];
    const auto = (key) => m(key, 'auto');

    assert.equal(m('plain', 'naive').verdict, 'clean');
    assert.equal(auto('plain').outcome, 'recolor');
    assert.ok(auto('plain').bright < 0.05, `plain recolored is dark: ${auto('plain').bright}`);

    assert.equal(m('inlineDarkText', 'naive').verdict, 'broken');
    assert.equal(m('inlineDarkText', 'recolor').verdict, 'clean', 'recoloring lightens the dark text');
    assert.equal(auto('inlineDarkText').outcome, 'recolor');

    assert.ok(m('whiteCard', 'naive').bright > 0.5, 'naive leaves the white card bright');
    assert.equal(auto('whiteCard').outcome, 'recolor');
    assert.ok(auto('whiteCard').bright < 0.05, `recolored card is dark: ${auto('whiteCard').bright}`);

    // Only "Visible body text." reads; the white-on-white line is the sender's own hiding.
    assert.equal(m('preheader', 'light').summary.chars, 'Visible body text.'.length + 'Hidden four, white on white'.length);
    assert.equal(auto('preheader').counted, 'Visible body text.'.length);
    assert.equal(auto('preheader').verdict, 'clean');
    assert.equal(auto('preheader').summary.hidden, 'Hidden four, white on white'.length, 'hidden text stays hidden when recolored');

    assert.equal(m('backgroundImage', 'light').summary.overImage, 'Text over an image'.length);
    assert.equal(auto('backgroundImage').summary.overImage, 'Text over an image'.length, 'left as sent');

    assert.equal(auto('lightImageArea').outcome, 'recolor');
    assert.ok(auto('lightImageArea').bright > 0.5, `the hero area stays light: ${auto('lightImageArea').bright}`);
    assert.equal(auto('lightImageArea').summary.overImage, 'Headline over a light hero image'.length);

    assert.equal(auto('senderDark').outcome, 'sender', "the sender's design is preferred");
    assert.ok(auto('senderDark').bright < 0.05);

    assert.equal(m('brokenSenderDark', 'sender').verdict, 'broken', 'the broken design is caught');
    assert.deepEqual(auto('brokenSenderDark').attempts.map(a => [a.kind, a.verdict]), [['sender', 'broken'], ['recolor', 'clean']]);
    assert.equal(auto('brokenSenderDark').outcome, 'recolor');

    assert.equal(auto('colors').outcome, 'recolor');
    assert.equal(auto('colors').verdict, 'clean');
    assert.ok(auto('colors').bright < 0.05);

    assert.equal(auto('darkHeader').outcome, 'recolor');
    assert.equal(auto('darkHeader').verdict, 'clean');

    assert.equal(auto('transitions').outcome, 'recolor', 'not refused because of a running transition');
    assert.equal(auto('transitions').verdict, 'clean');

    assert.deepEqual(Object.keys(results.lightOnly.modes), ['light'], 'a sender that asks to stay light is never shown dark');

    const t = totals(list);
    assert.equal(t.restoreMismatches, 0);
    assert.equal(t.auto.broken, 0, 'what the reader shows never has broken text');
    return { fixtures: Object.keys(FIXTURES).length, stats, totals: t };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const { fixtures, stats } = await runSelftest();
console.log(`selftest passed: ${fixtures} fixtures, ${stats.blocked} network requests blocked, ${stats.served} harness files served`);
