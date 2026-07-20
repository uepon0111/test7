// player.js — owns the single persistent <audio> element and everything
// that touches it: play/pause, +-5s seek, the draggable seek bar (used in
// both the detail view and the mini player), Media Session integration
// for background/lock-screen playback with artwork, and the intro-skip
// setting (start at 0:08 instead of 0:00).
//
// Audio is only ever requested here, and only via loadVocal(), which is
// only called once a person opens a song and picks a vocal option.

import { state } from "./state.js";
import { vocalAudioUrl, jacketUrl } from "./api.js";
import { qs, qsa, clamp, formatTime, showToast } from "./utils.js";
import { icon } from "./icons.js";
import { navigateToSong } from "./router.js";

let audioEl = null;
let currentSong = null;
let currentVocal = null;
let introSkipHandled = false;

export function initPlayer() {
  audioEl = qs("#audioEl");

  audioEl.addEventListener("loadedmetadata", () => {
    if (state.settings.introSkip && !introSkipHandled) {
      audioEl.currentTime = Math.min(8, audioEl.duration || 8);
    }
    introSkipHandled = true;
    updateSeekUI();
  });
  audioEl.addEventListener("timeupdate", updateSeekUI);
  audioEl.addEventListener("progress", updateBufferedUI);
  audioEl.addEventListener("play", onPlayStateChange);
  audioEl.addEventListener("pause", onPlayStateChange);
  audioEl.addEventListener("ended", () => {
    // Without this, currentTime stays at duration and a second press of
    // play would have nothing left to play. Respect intro-skip so a
    // replay starts at the same point a fresh selection would.
    audioEl.currentTime = state.settings.introSkip ? Math.min(8, audioEl.duration || 8) : 0;
    onPlayStateChange();
    updateSeekUI();
  });
  audioEl.addEventListener("error", () => {
    if (audioEl.src) showToast("音声の読み込みに失敗しました");
  });

  // Delegated controls so both the mini player (static) and the detail
  // view's playback card (re-rendered on every navigation) work without
  // needing to rebind listeners each time.
  document.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-player-action]");
    if (!btn) return;
    const action = btn.dataset.playerAction;
    if (action === "toggle-play") togglePlay();
    else if (action === "seek-back") seekBy(-5);
    else if (action === "seek-forward") seekBy(5);
  });

  bindSeekBar(qs("#miniPlayerSeek"));

  qs("#miniPlayerText").addEventListener("click", () => {
    if (currentSong) navigateToSong(currentSong.id);
  });

  if ("mediaSession" in navigator) {
    navigator.mediaSession.setActionHandler("play", () => togglePlay());
    navigator.mediaSession.setActionHandler("pause", () => togglePlay());
    navigator.mediaSession.setActionHandler("seekbackward", () => seekBy(-5));
    navigator.mediaSession.setActionHandler("seekforward", () => seekBy(5));
  }
}

/** Loads a vocal's audio (metadata fetch only, until play is pressed). Never autoplays. */
export function loadVocal(song, vocal) {
  if (currentSong && currentVocal && currentSong.id === song.id && currentVocal.id === vocal.id) {
    return; // already the active track — leave playback state untouched
  }
  audioEl.pause();
  currentSong = song;
  currentVocal = vocal;
  introSkipHandled = false;

  audioEl.preload = "metadata";
  audioEl.src = vocalAudioUrl(vocal.assetbundleName);
  audioEl.load();

  updateMediaSessionMetadata();
  showMiniPlayer();
  renderMiniPlayerInfo();
  updatePlayButtons();
  updateSeekUI();
}

export function togglePlay() {
  if (!audioEl || !audioEl.src) return;
  if (audioEl.paused) {
    audioEl.play().catch(() => showToast("再生を開始できませんでした"));
  } else {
    audioEl.pause();
  }
}

export function seekBy(delta) {
  if (!audioEl || !Number.isFinite(audioEl.duration)) return;
  audioEl.currentTime = clamp(audioEl.currentTime + delta, 0, audioEl.duration);
}

export function seekToFraction(frac) {
  if (!audioEl || !Number.isFinite(audioEl.duration)) return;
  audioEl.currentTime = clamp(frac, 0, 1) * audioEl.duration;
}

/** Forces an immediate sync of seek bar / play buttons — call after
 * inserting new player DOM (e.g. the detail view re-rendering) so it
 * doesn't wait for the next timeupdate tick to reflect current state. */
export function refreshPlayerUI() {
  updateSeekUI();
  updateBufferedUI();
  updatePlayButtons();
}

export function getNowPlaying() {
  return {
    song: currentSong,
    vocal: currentVocal,
    isPlaying: !!audioEl && !audioEl.paused && !audioEl.ended,
    currentTime: audioEl ? audioEl.currentTime : 0,
    duration: audioEl ? audioEl.duration : 0,
  };
}

// ---- Seek bar (drag + click), used for both mini + detail instances ----
export function bindSeekBar(el) {
  if (!el) return;
  const track = qs(".seek-bar__track", el);
  if (!track) return;

  function fractionFromEvent(e) {
    const rect = track.getBoundingClientRect();
    const x = clamp(e.clientX - rect.left, 0, rect.width);
    return rect.width ? x / rect.width : 0;
  }

  function onMove(e) {
    seekToFraction(fractionFromEvent(e));
  }
  function onUp() {
    el.classList.remove("is-dragging");
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
  }

  track.addEventListener("pointerdown", (e) => {
    if (!audioEl || !Number.isFinite(audioEl.duration)) return;
    el.classList.add("is-dragging");
    seekToFraction(fractionFromEvent(e));
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  });
}

// ---- UI reflection ----
function updateSeekUI() {
  if (!audioEl) return;
  const duration = audioEl.duration || 0;
  const current = audioEl.currentTime || 0;
  const frac = duration ? current / duration : 0;
  qsa(".js-seek-bar").forEach((el) => {
    const fill = qs(".seek-bar__fill", el);
    const handle = qs(".seek-bar__handle", el);
    const curEl = qs(".seek-bar__current", el);
    const durEl = qs(".seek-bar__duration", el);
    if (fill) fill.style.width = `${frac * 100}%`;
    if (handle) handle.style.left = `${frac * 100}%`;
    if (curEl) curEl.textContent = formatTime(current);
    if (durEl) durEl.textContent = formatTime(duration);
  });
}

function updateBufferedUI() {
  if (!audioEl || !Number.isFinite(audioEl.duration) || !audioEl.duration) return;
  let end = 0;
  try {
    if (audioEl.buffered.length) end = audioEl.buffered.end(audioEl.buffered.length - 1);
  } catch (e) {
    /* ignore */
  }
  const frac = end / audioEl.duration;
  qsa(".js-seek-bar .seek-bar__buffered").forEach((el) => {
    el.style.width = `${frac * 100}%`;
  });
}

function updatePlayButtons() {
  const playing = !!audioEl && !audioEl.paused && !audioEl.ended;
  qsa('[data-player-action="toggle-play"]').forEach((btn) => {
    btn.innerHTML = playing ? icon("pause", "icon--pause") : icon("play");
    btn.setAttribute("aria-label", playing ? "一時停止" : "再生");
  });
}

function onPlayStateChange() {
  updatePlayButtons();
  if ("mediaSession" in navigator) {
    navigator.mediaSession.playbackState = audioEl.paused ? "paused" : "playing";
  }
}

function showMiniPlayer() {
  qs("#miniPlayer").classList.add("visible");
  const main = qs("#appMain");
  if (main) main.classList.add("app-main--with-player");
}

function renderMiniPlayerInfo() {
  if (!currentSong || !currentVocal) return;
  const thumb = qs("#miniPlayerThumb");
  thumb.src = jacketUrl(currentSong.jacketAssetbundleName);
  thumb.alt = currentSong.title;
  qs("#miniPlayerTitle").textContent = currentSong.title;
  qs("#miniPlayerCaption").textContent = currentVocal.caption || "";
}

function updateMediaSessionMetadata() {
  if (!("mediaSession" in navigator) || !currentSong || !currentVocal) return;
  try {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: currentSong.title,
      artist: currentVocal.caption || "PROJECT SEKAI",
      album: "楽曲ライブラリ",
      artwork: [
        { src: jacketUrl(currentSong.jacketAssetbundleName), sizes: "512x512", type: "image/png" },
      ],
    });
  } catch (e) {
    /* MediaMetadata unsupported — ignore */
  }
}
