// Clickjacking: another site could load the app in a hidden frame and trick a signed-in admin into clicking Send or Delete.
// GitHub Pages can't send X-Frame-Options or a CSP frame-ancestors header (a <meta> CSP ignores frame-ancestors), so the
// app checks it itself and does not start inside a frame. Nothing in the app frames itself: sign-in is a full-page redirect.

/** True when this window is inside a frame (or the browser won't say, which counts as framed). */
export function isFramed(win: { readonly self: unknown; readonly top: unknown } = window): boolean {
  try { return win.self !== win.top; } catch { return true; }
}

/** Replaces the page with a short note and a link that opens the app in its own tab. Text only, no markup from outside. */
export function refuseFrame(doc: Document = document, href: string = window.location.href): void {
  const p = doc.createElement('p');
  p.style.cssText = 'font: 16px/1.5 Arial, sans-serif; margin: 2rem;';
  p.append('Decluttering only runs in its own browser tab. ');
  const a = doc.createElement('a');
  a.href = href.split('#')[0] ?? href;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  a.textContent = 'Open Decluttering';
  p.append(a);
  doc.body.replaceChildren(p);
}
