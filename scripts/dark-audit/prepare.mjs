// Dark-mode audit (#228), step 1 of 3: run each corpus email through the backend's sanitizer, as
// MailFlow stores it, and split off the sender's dark design as the body route does.
//
//   node scripts/dark-audit/prepare.mjs <corpus-dir>
//
// Reads every *.jsonl in the corpus folder (one email per line: its original HTML part plus
// sender domain, subject and date) and writes prepared.jsonl next to them. The corpus is the
// developer's own mail and stays outside the repo.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { sanitizeEmail, splitDarkScheme } from '../../backend/src/services/emailSanitizer.js';

export const PREPARED = 'prepared.jsonl';

export function prepareCorpus(dir) {
  const prepared = [];
  const files = readdirSync(dir).filter(f => f.endsWith('.jsonl') && f !== PREPARED).sort();
  for (const file of files) {
    for (const line of readFileSync(join(dir, file), 'utf8').split('\n')) {
      if (!line.trim()) continue;
      const { html: original, ...meta } = JSON.parse(line);
      const { html, darkCss, lightOnly } = splitDarkScheme(sanitizeEmail(original));
      prepared.push({ ...meta, html, darkCss: darkCss || '', lightOnly });
    }
  }
  writeFileSync(join(dir, PREPARED), prepared.map(e => JSON.stringify(e)).join('\n') + '\n');
  return prepared;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const dir = process.argv[2];
  if (!dir) { console.error('usage: prepare.mjs <corpus-dir>'); process.exit(2); }
  const prepared = prepareCorpus(dir);
  const withDark = prepared.filter(e => e.darkCss).length;
  const lightOnly = prepared.filter(e => e.lightOnly).length;
  console.log(`${prepared.length} emails prepared: ${withDark} carry a dark design, ${lightOnly} ask to stay light`);
}
