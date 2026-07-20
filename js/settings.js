// settings.js — the settings overlay. Per the spec this only needs the
// intro-silence-skip toggle, with no explanatory copy.

import { state, persistSettings } from "./state.js";
import { qs } from "./utils.js";

export function initSettings() {
  const panel = qs("#settingsPanel");
  const scrim = qs("#settingsScrim");
  const openBtn = qs("#settingsToggleBtn");
  const closeBtn = qs("#settingsCloseBtn");
  const toggle = qs("#introSkipToggle");

  function open() {
    panel.hidden = false;
    scrim.hidden = false;
    requestAnimationFrame(() => {
      panel.classList.add("open");
      scrim.classList.add("open");
    });
  }
  function close() {
    panel.classList.remove("open");
    scrim.classList.remove("open");
    setTimeout(() => {
      panel.hidden = true;
      scrim.hidden = true;
    }, 260);
  }

  openBtn.addEventListener("click", open);
  closeBtn.addEventListener("click", close);
  scrim.addEventListener("click", close);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !panel.hidden) close();
  });

  reflectIntroSkip();
  toggle.addEventListener("click", () => {
    state.settings.introSkip = !state.settings.introSkip;
    persistSettings();
    reflectIntroSkip();
  });

  function reflectIntroSkip() {
    toggle.classList.toggle("is-on", state.settings.introSkip);
    toggle.setAttribute("aria-checked", String(state.settings.introSkip));
  }
}
