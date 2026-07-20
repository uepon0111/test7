// router.js — minimal hash-based router. Two routes only:
//   '#/'            -> song list
//   '#/song/{id}'   -> song detail
// Using the hash (not the History API) keeps this a pure static site with
// no server-side rewrite rules needed, which matters for GitHub Pages.

import { state } from "./state.js";

let onListShow = () => {};
let onDetailShow = () => {};

export function initRouter(handlers) {
  onListShow = handlers.onListShow || onListShow;
  onDetailShow = handlers.onDetailShow || onDetailShow;
  window.addEventListener("hashchange", applyRoute);
  applyRoute();
}

function parseHash() {
  const hash = window.location.hash.replace(/^#\/?/, "");
  const match = hash.match(/^song\/(\d+)$/);
  if (match) return { name: "detail", songId: Number(match[1]) };
  return { name: "list", songId: null };
}

function applyRoute() {
  const route = parseHash();

  if (route.name === "detail" && state.songsById.has(route.songId)) {
    state.route = route;
    onDetailShow(route.songId);
    window.scrollTo(0, 0);
  } else {
    state.route = { name: "list", songId: null };
    onListShow();
  }
}

export function navigateToSong(id) {
  window.location.hash = `#/song/${id}`;
}

export function navigateToList() {
  if (window.location.hash && window.location.hash !== "#/") {
    window.history.back();
    // Fallback in case there is no meaningful history entry to return to
    // (e.g. the detail page was opened directly from a shared link).
    setTimeout(() => {
      if (state.route.name === "detail") window.location.hash = "#/";
    }, 60);
  } else {
    window.location.hash = "#/";
  }
}
