// sort.js — sort field (title / id / level / date), ascending/descending
// toggle, and the difficulty-basis sub-picker that appears only when
// sorting by level.

import { state } from "./state.js";
import { DIFFICULTY_ORDER, DIFFICULTY_LABELS } from "./api.js";
import { qs } from "./utils.js";
import { icon } from "./icons.js";
import { renderList } from "./list-view.js";

const SORT_FIELDS = [
  { value: "title", label: "タイトル順" },
  { value: "id", label: "ID順" },
  { value: "level", label: "レベル順" },
  { value: "date", label: "公開日順" },
];

export function renderSortPanel() {
  renderFieldRow();
  renderDirectionToggle();
  renderLevelDifficultyRow();
}

function renderFieldRow() {
  const row = qs("#sortFieldRow");
  row.innerHTML = SORT_FIELDS.map(
    (f) =>
      `<button type="button" class="chip ${state.sort.field === f.value ? "is-selected" : ""}" data-sort-field="${f.value}">${f.label}</button>`
  ).join("");

  row.querySelectorAll("[data-sort-field]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.sort.field = btn.dataset.sortField;
      renderSortPanel();
      renderList();
    });
  });
}

function renderDirectionToggle() {
  const btn = qs("#sortDirectionBtn");
  const asc = state.sort.direction === "asc";
  btn.innerHTML = `${icon("sort")}<span>${asc ? "昇順" : "降順"}</span>`;
  btn.onclick = () => {
    state.sort.direction = asc ? "desc" : "asc";
    renderSortPanel();
    renderList();
  };
}

function renderLevelDifficultyRow() {
  const wrap = qs("#sortLevelDifficultyWrap");
  const row = qs("#sortLevelDifficultyRow");
  const show = state.sort.field === "level";
  wrap.hidden = !show;
  if (!show) return;

  row.innerHTML = DIFFICULTY_ORDER.map(
    (d) =>
      `<button type="button" class="chip ${state.sort.levelDifficulty === d ? "is-selected" : ""}" data-sort-diff="${d}">
        <span class="chip__swatch" style="--chip-color:var(--diff-${d})"></span>${DIFFICULTY_LABELS[d]}
      </button>`
  ).join("");

  row.querySelectorAll("[data-sort-diff]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.sort.levelDifficulty = btn.dataset.sortDiff;
      renderSortPanel();
      renderList();
    });
  });
}

export function initSortPanel() {
  renderSortPanel();
}
