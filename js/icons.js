// icons.js — a small self-contained line-icon set (Feather-style, 24x24,
// stroke=currentColor). No emoji are used anywhere in this app; every
// visual glyph comes from this sprite.

const SPRITE = `
<svg xmlns="http://www.w3.org/2000/svg" style="display:none">
  <symbol id="ic-search" viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></symbol>
  <symbol id="ic-close" viewBox="0 0 24 24"><path d="M18 6 6 18M6 6l12 12"/></symbol>
  <symbol id="ic-back" viewBox="0 0 24 24"><path d="M15 18l-6-6 6-6"/></symbol>
  <symbol id="ic-filter" viewBox="0 0 24 24"><path d="M4 6h16M7 12h10M10 18h4"/></symbol>
  <symbol id="ic-sort" viewBox="0 0 24 24"><path d="M7 3v18M3 7l4-4 4 4M17 21V3M13 17l4 4 4-4"/></symbol>
  <symbol id="ic-chevron-down" viewBox="0 0 24 24"><path d="M6 9l6 6 6-6"/></symbol>
  <symbol id="ic-chevron-up" viewBox="0 0 24 24"><path d="M6 15l6-6 6 6"/></symbol>
  <symbol id="ic-grid1" viewBox="0 0 24 24"><rect x="4" y="5" width="16" height="4" rx="1"/><rect x="4" y="10.5" width="16" height="4" rx="1"/><rect x="4" y="16" width="16" height="4" rx="1"/></symbol>
  <symbol id="ic-grid3" viewBox="0 0 24 24"><rect x="3.5" y="4" width="5" height="16" rx="1"/><rect x="9.5" y="4" width="5" height="16" rx="1"/><rect x="15.5" y="4" width="5" height="16" rx="1"/></symbol>
  <symbol id="ic-grid5" viewBox="0 0 24 24"><rect x="2" y="4" width="3" height="16" rx="0.8"/><rect x="6.25" y="4" width="3" height="16" rx="0.8"/><rect x="10.5" y="4" width="3" height="16" rx="0.8"/><rect x="14.75" y="4" width="3" height="16" rx="0.8"/><rect x="19" y="4" width="3" height="16" rx="0.8"/></symbol>
  <symbol id="ic-play" viewBox="0 0 24 24"><path d="M6 4.5v15l14-7.5-14-7.5z"/></symbol>
  <symbol id="ic-pause" viewBox="0 0 24 24"><rect x="6" y="4.5" width="4.5" height="15" rx="1"/><rect x="13.5" y="4.5" width="4.5" height="15" rx="1"/></symbol>
  <symbol id="ic-rewind5" viewBox="0 0 24 24"><path d="M4 12a8 8 0 1 1 2.6 5.9"/><path d="M4 6v5h5"/><text x="12" y="16.5" font-size="7.5" font-family="inherit" stroke="none" fill="currentColor" text-anchor="middle">5</text></symbol>
  <symbol id="ic-forward5" viewBox="0 0 24 24"><path d="M20 12a8 8 0 1 0-2.6 5.9"/><path d="M20 6v5h-5"/><text x="12" y="16.5" font-size="7.5" font-family="inherit" stroke="none" fill="currentColor" text-anchor="middle">5</text></symbol>
  <symbol id="ic-settings" viewBox="0 0 24 24"><circle cx="12" cy="12" r="3.2"/><path d="M19.4 13a7.6 7.6 0 0 0 0-2l2-1.5-2-3.4-2.3.9a7.6 7.6 0 0 0-1.8-1l-.3-2.4H9l-.3 2.4a7.6 7.6 0 0 0-1.8 1l-2.3-.9-2 3.4L4.6 11a7.6 7.6 0 0 0 0 2l-2 1.5 2 3.4 2.3-.9c.5.4 1.2.8 1.8 1l.3 2.4h4.8l.3-2.4c.6-.2 1.3-.6 1.8-1l2.3.9 2-3.4-2-1.5z"/></symbol>
  <symbol id="ic-external" viewBox="0 0 24 24"><path d="M14 4h6v6M20 4l-9 9M19 13v5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h5"/></symbol>
  <symbol id="ic-alert" viewBox="0 0 24 24"><path d="M12 3 1.5 21h21L12 3z"/><path d="M12 10v4.5M12 17.2v.1" stroke-linecap="round"/></symbol>
  <symbol id="ic-check" viewBox="0 0 24 24"><path d="M5 13l4.5 4.5L19 7"/></symbol>
  <symbol id="ic-music" viewBox="0 0 24 24"><path d="M9 18V5l11-2v13"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="17.5" cy="16" r="2.5"/></symbol>
  <symbol id="ic-pen" viewBox="0 0 24 24"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/></symbol>
  <symbol id="ic-note-comp" viewBox="0 0 24 24"><circle cx="7" cy="17" r="3"/><path d="M10 17V4l9-1v12"/><circle cx="16" cy="15" r="3"/></symbol>
  <symbol id="ic-tune" viewBox="0 0 24 24"><path d="M4 21v-7M4 10V3M12 21v-11M12 6V3M20 21v-5M20 12V3"/><circle cx="4" cy="12" r="2"/><circle cx="12" cy="8" r="2"/><circle cx="20" cy="14" r="2"/></symbol>
  <symbol id="ic-calendar" viewBox="0 0 24 24"><rect x="3.5" y="5" width="17" height="16" rx="2"/><path d="M8 3v4M16 3v4M3.5 10h17"/></symbol>
  <symbol id="ic-hash" viewBox="0 0 24 24"><path d="M5 9h14M5 15h14M10 4 8 20M16 4l-2 16"/></symbol>
  <symbol id="ic-mic" viewBox="0 0 24 24"><rect x="9" y="2.5" width="6" height="12" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M9 21h6"/></symbol>
  <symbol id="ic-refresh" viewBox="0 0 24 24"><path d="M20 11A8 8 0 0 0 5.5 6.5L4 8M4 13a8 8 0 0 0 14.5 4.5L20 16"/><path d="M4 4v4h4M20 20v-4h-4"/></symbol>
  <symbol id="ic-piece" viewBox="0 0 24 24"><path d="M3 3h8v8H3zM13 3h8v3.5a4 4 0 0 1-8 0V3zM3 13h3.5a4 4 0 0 1 0 8H3zM13 13h8v8h-8z"/></symbol>
  <symbol id="ic-doc" viewBox="0 0 24 24"><path d="M6 2h9l5 5v15H6z"/><path d="M15 2v5h5"/></symbol>
</svg>`.trim();

export function injectIconSprite() {
  if (document.getElementById("icon-sprite-root")) return;
  const wrap = document.createElement("div");
  wrap.id = "icon-sprite-root";
  wrap.innerHTML = SPRITE;
  document.body.prepend(wrap);
}

/** Returns an <svg> element markup string referencing a sprite symbol. */
export function icon(name, cls = "") {
  return `<svg class="icon ${cls}" aria-hidden="true"><use href="#ic-${name}"></use></svg>`;
}
