// list-view.js — renders the song grid/list (1/3/5 column modes), and
// owns the view-mode toggle buttons.

import { state, persistViewMode } from "./state.js";
import { filterSongs, sortSongs, searchSongs } from "./query.js";
import { jacketUrl } from "./api.js";
import { icon } from "./icons.js";
import { qs, qsa, escapeHtml, debounce } from "./utils.js";
import { navigateToSong } from "./router.js";
import { unitChipHtml, diffBadgeHtml } from "./badges.js";

const PRIMARY_DIFF_ORDER = ["master", "expert", "hard", "normal", "easy", "append"];

function primaryDifficulty(song) {
  for (const d of PRIMARY_DIFF_ORDER) {
    if (song.levelByDifficulty[d]) return song.levelByDifficulty[d];
  }
  return null;
}

function primaryUnitTag(song) {
  return song.tags && song.tags.length ? song.tags[0] : null;
}

/** Recomputes the visible song list from current filters/sort/search state. */
export function getVisibleSongs() {
  let list = filterSongs(state.songs, state.filters);
  list = searchSongs(list, state.searchQuery);
  list = sortSongs(list, state.sort);
  return list;
}

export function renderList() {
  const grid = qs("#songGrid");
  const countEl = qs("#resultCount");
  const visible = getVisibleSongs();

  grid.className = `song-grid mode-${state.viewMode}`;
  countEl.textContent = `${visible.length}曲`;

  if (visible.length === 0) {
    grid.innerHTML = emptyStateHtml();
    return;
  }

  grid.innerHTML = visible.map((song) => cardHtml(song)).join("");
}

function emptyStateHtml() {
  return `
    <div class="empty-state">
      ${icon("search")}
      <div>条件に一致する楽曲が見つかりませんでした</div>
    </div>`;
}

function cardHtml(song) {
  const thumb = jacketUrl(song.jacketAssetbundleName);
  const diff = primaryDifficulty(song);
  const unitTag = primaryUnitTag(song);
  const titleSafe = escapeHtml(song.title);

  if (state.viewMode === "list1") {
    return `
      <button class="song-card" data-song-id="${song.id}" type="button">
        <img class="song-card__thumb" src="${thumb}" alt="" loading="lazy" width="56" height="56">
        <div class="song-card__body">
          <div class="song-card__title">${titleSafe}</div>
          <div class="song-card__reading">${escapeHtml(song.pronunciation)}</div>
          <div class="song-card__meta">
            <span class="song-card__id mono">No.${song.id}</span>
            ${unitTag ? unitChipHtml(unitTag) : ""}
            ${diff ? diffBadgeHtml(diff) : ""}
            ${song.isNewlyWrittenMusic ? `<span class="status-pill">${icon("check")}書き下ろし</span>` : ""}
          </div>
        </div>
        <span class="song-card__date mono">${formatShortDate(song.publishedAt)}</span>
      </button>`;
  }

  return `
    <button class="song-card" data-song-id="${song.id}" type="button">
      <div class="song-card__thumb-wrap">
        <img class="song-card__thumb" src="${thumb}" alt="" loading="lazy">
        ${song.isNewlyWrittenMusic ? `<span class="song-card__new-badge">書き下ろし</span>` : ""}
        ${diff ? `<span class="song-card__level-badge">${diffBadgeHtml(diff, true)}</span>` : ""}
      </div>
      <div class="song-card__body">
        <div class="song-card__title">${titleSafe}</div>
        ${unitTag ? `<div class="song-card__unit">${unitChipHtml(unitTag)}</div>` : ""}
      </div>
    </button>`;
}

function formatShortDate(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}`;
}

// ---- View mode toggle ----

export function initListView() {
  qs("#songGrid").addEventListener("click", (e) => {
    const card = e.target.closest(".song-card");
    if (card) navigateToSong(Number(card.dataset.songId));
  });

  qsa(".view-toggle button").forEach((btn) => {
    btn.addEventListener("click", () => setViewMode(btn.dataset.mode));
  });
  reflectViewModeButtons();

  window.addEventListener(
    "resize",
    debounce(() => {
      // The 5-col option is only offered from 700px up; fall back
      // gracefully if the window is resized past that while active.
      if (state.viewMode === "grid5" && window.innerWidth < 700) {
        setViewMode("grid3");
      }
    }, 150)
  );
}

export function setViewMode(mode) {
  if (!["list1", "grid3", "grid5"].includes(mode)) return;
  state.viewMode = mode;
  persistViewMode();
  reflectViewModeButtons();
  renderList();
}

function reflectViewModeButtons() {
  qsa(".view-toggle button").forEach((btn) => {
    btn.classList.toggle("is-active", btn.dataset.mode === state.viewMode);
    btn.setAttribute("aria-pressed", String(btn.dataset.mode === state.viewMode));
  });
}
