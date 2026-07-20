// main.js — application entry point. Fetches the master data once, builds
// the song/character indexes, then wires up every UI module. This is the
// only file that knows about the overall startup sequence.

import { state, loadPersistedState } from "./state.js";
import { fetchAllMasterData, buildSongs } from "./api.js";
import { buildCharacterIndex } from "./characters.js";
import { injectIconSprite } from "./icons.js";
import { qs, initConfirmDialog } from "./utils.js";
import { initRouter } from "./router.js";
import { renderList, initListView } from "./list-view.js";
import { renderDetailView } from "./detail-view.js";
import { initFilterPanel } from "./filter.js";
import { initSortPanel } from "./sort.js";
import { initSearch } from "./search.js";
import { initSettings } from "./settings.js";
import { initPlayer } from "./player.js";

async function init() {
  injectIconSprite();
  initConfirmDialog();
  loadPersistedState();

  try {
    const raw = await fetchAllMasterData();
    const songs = buildSongs(raw);
    state.songs = songs;
    state.songsById = new Map(songs.map((s) => [s.id, s]));
    buildCharacterIndex(raw, songs);
  } catch (err) {
    console.error(err);
    showErrorScreen();
    return;
  }

  revealApp();

  initListView();
  initFilterPanel();
  initSortPanel();
  initSearch();
  initSettings();
  initPlayer();

  initRouter({
    onListShow: showListRoute,
    onDetailShow: showDetailRoute,
  });
}

function showListRoute() {
  qs("#appMain").hidden = false;
  qs("#listControls").hidden = false;
  qs("#detailView").hidden = true;
  renderList();
}

function showDetailRoute(songId) {
  qs("#appMain").hidden = true;
  qs("#listControls").hidden = true;
  qs("#detailView").hidden = false;
  renderDetailView(songId);
}

function revealApp() {
  qs("#loadingScreen").hidden = true;
  qs("#appShell").hidden = false;
}

function showErrorScreen() {
  qs("#loadingScreen").hidden = true;
  const screen = qs("#errorScreen");
  screen.hidden = false;
  qs("#retryBtn", screen).addEventListener("click", () => window.location.reload());
}

document.addEventListener("DOMContentLoaded", init);
