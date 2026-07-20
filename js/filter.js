// filter.js — the filter panel UI: unit tag (single-select), newly
// written / cover (single-select), and singing character (multi-select,
// AND-combined) — all rendered as icon/chip grids per the spec rather
// than <select> dropdowns.

import { state } from "./state.js";
import { UNIT_TAGS, UNIT_TAG_LABELS } from "./api.js";
import { getFilterCharacterList, characterKey, avatarHtml } from "./characters.js";
import { qs, escapeHtml } from "./utils.js";
import { renderList } from "./list-view.js";

const NEWLY_WRITTEN_OPTIONS = [
  { value: "all", label: "全て" },
  { value: "new", label: "書き下ろし" },
  { value: "cover", label: "カバー" },
];

export function renderFilterPanel() {
  renderUnitTagRow();
  renderNewlyWrittenRow();
  renderCharacterGrid();
  updateFilterBadge();
}

function renderUnitTagRow() {
  const row = qs("#unitTagRow");
  row.innerHTML = UNIT_TAGS.map((tag) => {
    const selected = state.filters.unitTag === tag;
    const swatch = tag === "all" ? "" : `<span class="chip__swatch" style="--chip-color:var(--unit-${tag})"></span>`;
    return `<button type="button" class="chip ${selected ? "is-selected" : ""}" data-unit-tag="${tag}">${swatch}${UNIT_TAG_LABELS[tag]}</button>`;
  }).join("");

  row.querySelectorAll("[data-unit-tag]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.filters.unitTag = btn.dataset.unitTag;
      renderFilterPanel();
      renderList();
    });
  });
}

function renderNewlyWrittenRow() {
  const row = qs("#newlyWrittenRow");
  row.innerHTML = NEWLY_WRITTEN_OPTIONS.map(
    (opt) =>
      `<button type="button" class="chip ${state.filters.newlyWritten === opt.value ? "is-selected" : ""}" data-newly="${opt.value}">${opt.label}</button>`
  ).join("");

  row.querySelectorAll("[data-newly]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.filters.newlyWritten = btn.dataset.newly;
      renderFilterPanel();
      renderList();
    });
  });
}

function renderCharacterGrid() {
  const grid = qs("#characterFilterGrid");
  const chars = getFilterCharacterList();

  grid.innerHTML = chars
    .map((c) => {
      const key = characterKey(c.type, c.id);
      const selected = state.filters.characters.has(key);
      return `
        <button type="button" class="character-tile ${selected ? "is-selected" : ""}" data-char-key="${key}" aria-pressed="${selected}">
          ${avatarHtml(c, 44)}
          <span class="character-tile__name">${escapeHtml(c.shortName)}</span>
        </button>`;
    })
    .join("");

  grid.querySelectorAll("[data-char-key]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const key = btn.dataset.charKey;
      if (state.filters.characters.has(key)) {
        state.filters.characters.delete(key);
      } else {
        state.filters.characters.add(key);
      }
      renderFilterPanel();
      renderList();
    });
  });
}

function updateFilterBadge() {
  const active =
    state.filters.unitTag !== "all" || state.filters.newlyWritten !== "all" || state.filters.characters.size > 0;
  const dot = qs("#filterToggleBtn .icon-btn__dot");
  if (dot) dot.style.display = active ? "block" : "none";
}

export function resetFilters() {
  state.filters.unitTag = "all";
  state.filters.newlyWritten = "all";
  state.filters.characters = new Set();
  renderFilterPanel();
  renderList();
}

export function initFilterPanel() {
  const panel = qs("#filterSortPanel");
  const toggleBtn = qs("#filterToggleBtn");
  toggleBtn.addEventListener("click", () => {
    panel.classList.toggle("open");
    toggleBtn.classList.toggle("is-active");
  });
  qs("#resetFiltersBtn").addEventListener("click", resetFilters);
  renderFilterPanel();
}
