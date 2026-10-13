// The document an email body is rendered in: the sandboxed frame's srcDoc (MessageBodyView).
//
// A plain function so the dark-mode audit harness (scripts/dark-audit) renders exactly what the
// reader does, from the same code.
//
// Shown dark: the theme's colors (`palette`), with the sender's own dark design (`darkCss`) after
// MailFlow's styles so it wins where it sets something; MailFlow's dark background is not
// !important for the same reason. Shown as sent: forced light, as every body was before (#228).

import { remoteLoadsCsp } from './remoteImagePolicy.js';

// The default dark theme's colors, for a palette value that is not a plain color.
export const DARK_DEFAULTS = { background: '#0f0f11', text: '#e8e8f0', link: '#8b7cf8', muted: '#9a9ab0', border: '#2a2a35' };

// The sender's dark CSS, if it may be used. It comes from inside a style element, so it cannot
// close one; refuse it if it ever does.
export function usableDarkCss(darkCss) {
  return typeof darkCss === 'string' && !/<\/style/i.test(darkCss) ? darkCss : '';
}

// `remoteImagesBlocked`: the body was served with remote images blocked, so the frame forbids
// remote loads outright (utils/remoteImagePolicy.js).
export function buildFrameDoc({ html, dark = false, palette = DARK_DEFAULTS, darkCss = '', remoteImagesBlocked = false }) {
  const css = dark ? usableDarkCss(darkCss) : '';
  return `<!DOCTYPE html><html><head><meta charset="utf-8">
      <meta name="viewport" content="width=device-width,initial-scale=1">
      <meta name="color-scheme" content="${dark ? 'dark' : 'only light'}">
      <meta http-equiv="Content-Security-Policy" content="script-src 'none'; object-src 'none'; frame-src 'none'; form-action 'none'; style-src 'unsafe-inline';${remoteLoadsCsp(remoteImagesBlocked)}">
      <base target="_blank">
    </head><body><div id="mf-scale-wrapper">${
      html.replace(/<a(\s)/gi, '<a rel="noopener noreferrer"$1')
    }</div><style>
        /* Injected AFTER email HTML so our rules win the source-order tiebreak
           for same-specificity !important declarations inside the email's own
           <style> blocks (which land in <body> after the email HTML). */
        html, body { height: auto !important; min-height: 0 !important; overflow: hidden !important; }
        body { margin: 0 !important; padding: 0 !important;
               background-color: ${dark ? palette.background : '#ffffff !important'}; color-scheme: ${dark ? 'dark' : 'light'};
               font-family: -apple-system, Arial, sans-serif;
               font-size: 14px; line-height: 1.6; color: ${dark ? palette.text : '#1a1a1a'};
               word-wrap: break-word; overflow-wrap: break-word; }
        img { max-width: 100% !important; height: auto !important; }
        /* Force top-level wrapper tables to fill the viewport. Selectors cover
           both the legacy body > table pattern and the mf-scale-wrapper layer. */
        body > table, body > center > table,
        body > div > table, body > center > div > table,
        #mf-scale-wrapper > table, #mf-scale-wrapper > center > table,
        #mf-scale-wrapper > div > table, #mf-scale-wrapper > center > div > table {
          width: 100% !important;
        }
        /* Reset min-width on cells only — not on table elements, because fluid
           grid systems (e.g. Oracle Eloqua "tolkien") set min-width on inline-table
           column elements as a layout fallback when their calc() width resolves to 0. */
        td, th { min-width: 0 !important; }
        td { word-break: break-word; }
        th { overflow-wrap: normal; word-break: normal; }
        a { color: ${dark ? palette.link : '#6366f1'}; }
        pre, code { overflow-x: auto; white-space: pre-wrap; word-break: break-all; }
        blockquote { border-left: 3px solid ${dark ? palette.border : '#ddd'}; margin: 0; padding-left: 12px; color: ${dark ? palette.muted : '#555'}; }
      </style>${css ? `<style>${css}</style>` : ''}</body></html>`;
}
