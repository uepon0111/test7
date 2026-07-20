// search.js — search by title / reading / lyricist / composer / arranger.
// Typing both narrows the main grid live and shows a typeahead dropdown
// of candidate songs for quick jumping straight to a detail page.

import { state } from "./state.js";
import { searchSuggestions } from "./query.js";
import { jacketUrl } from "./api.js";
import { qs, debounce, escapeHtml } from "./utils.js";
import { renderList } from "./list-view.js";
import { navigateToSong } from "./router.js";

let highlightIndex = -1;
let currentSuggestions = [];

export function initSearch() {
  const input = qs("#searchInput");
  const clearBtn = qs("#searchClearBtn");
  const dropdown = qs("#searchSuggestions");

  const handleInput = debounce(() => {
    state.searchQuery = input.value;
    clearBtn.classList.toggle("show", input.value.length > 0);
    renderSuggestions(input.value);
    renderList();
  }, 120);

  input.addEventListener("input", handleInput);
  input.addEventListener("focus", () => {
    if (input.value) renderSuggestions(input.value);
  });

  input.addEventListener("keydown", (e) => {
    if (!dropdown.classList.contains("show")) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      moveHighlight(1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      moveHighlight(-1);
    } else if (e.key === "Enter") {
      if (highlightIndex >= 0 && currentSuggestions[highlightIndex]) {
        e.preventDefault();
        selectSuggestion(currentSuggestions[highlightIndex].id);
      }
    } else if (e.key === "Escape") {
      closeDropdown();
      input.blur();
    }
  });

  clearBtn.addEventListener("click", () => {
    input.value = "";
    state.searchQuery = "";
    clearBtn.classList.remove("show");
    closeDropdown();
    renderList();
    input.focus();
  });

  document.addEventListener("click", (e) => {
    if (!e.target.closest(".search-box")) closeDropdown();
  });

  dropdown.addEventListener("click", (e) => {
    const item = e.target.closest("[data-suggest-id]");
    if (item) selectSuggestion(Number(item.dataset.suggestId));
  });
}

function selectSuggestion(songId) {
  closeDropdown();
  qs("#searchInput").blur();
  navigateToSong(songId);
}

function moveHighlight(delta) {
  if (!currentSuggestions.length) return;
  highlightIndex = (highlightIndex + delta + currentSuggestions.length) % currentSuggestions.length;
  reflectHighlight();
}

function reflectHighlight() {
  const items = qs("#searchSuggestions").querySelectorAll("[data-suggest-id]");
  items.forEach((el, i) => el.classList.toggle("is-highlighted", i === highlightIndex));
}

function renderSuggestions(query) {
  const dropdown = qs("#searchSuggestions");
  highlightIndex = -1;

  if (!query.trim()) {
    closeDropdown();
    return;
  }

  currentSuggestions = searchSuggestions(state.songs, query, 8);

  if (currentSuggestions.length === 0) {
    dropdown.innerHTML = `<div class="search-suggestions__empty">一致する楽曲がありません</div>`;
  } else {
    dropdown.innerHTML = currentSuggestions
      .map(
        (song) => `
        <button type="button" class="search-suggestions__item" data-suggest-id="${song.id}">
          <span class="search-suggestions__thumb"><img src="${jacketUrl(song.jacketAssetbundleName)}" alt="" loading="lazy"></span>
          <span class="search-suggestions__text">
            <span class="search-suggestions__title">${escapeHtml(song.title)}</span>
            <span class="search-suggestions__meta">${escapeHtml(song.pronunciation)}</span>
          </span>
        </button>`
      )
      .join("");
  }
  dropdown.classList.add("show");
}

function closeDropdown() {
  qs("#searchSuggestions").classList.remove("show");
}
