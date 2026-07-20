// detail-view.js — renders the song detail screen in the exact section
// order specified: title, thumbnail, vocal selection, playback bar, id,
// title+reading, unit tag, lyricist, composer, arranger, publish date,
// original video, per-difficulty level/notes.

import { state } from "./state.js";
import { jacketUrl, DIFFICULTY_ORDER, DIFFICULTY_LABELS } from "./api.js";
import { getCharacter, avatarHtml } from "./characters.js";
import { unitChipHtml } from "./badges.js";
import { qs, escapeHtml, formatDateTime, showConfirmDialog } from "./utils.js";
import { icon } from "./icons.js";
import { navigateToList } from "./router.js";
import * as player from "./player.js";

export function renderDetailView(songId) {
  const song = state.songsById.get(songId);
  const container = qs("#detailView");

  if (!song) {
    container.innerHTML = `
      <div class="screen-state">
        <div class="screen-state__title">楽曲が見つかりませんでした</div>
        <button class="btn btn--ghost" id="detailNotFoundBackBtn" type="button">一覧に戻る</button>
      </div>`;
    qs("#detailNotFoundBackBtn").addEventListener("click", navigateToList);
    return;
  }

  const nowPlaying = player.getNowPlaying();
  const isActiveSong = !!nowPlaying.song && nowPlaying.song.id === song.id;
  const activeVocalId = isActiveSong && nowPlaying.vocal ? nowPlaying.vocal.id : null;

  container.innerHTML = [
    topbarHtml(song),
    `<h1 class="detail-hero-title">${escapeHtml(song.title)}</h1>`,
    jacketHtml(song),
    vocalSelectorHtml(song, activeVocalId),
    playbackCardHtml(isActiveSong),
    metaListHtml(song),
    originalVideoHtml(song),
    difficultyHtml(song),
  ].join("");

  bindDetailEvents(song);
  player.bindSeekBar(qs("#detailSeekBar"));
  player.refreshPlayerUI();
}

function topbarHtml(song) {
  return `
    <div class="detail-topbar">
      <button class="icon-btn" id="detailBackBtn" type="button" aria-label="一覧に戻る">${icon("back")}</button>
      <span class="detail-topbar__title">${escapeHtml(song.title)}</span>
    </div>`;
}

function jacketHtml(song) {
  const badge = song.isNewlyWrittenMusic
    ? `<span class="status-pill">${icon("check")}書き下ろし</span>`
    : "";
  return `
    <div class="detail-jacket-wrap">
      <img src="${jacketUrl(song.jacketAssetbundleName)}" alt="${escapeHtml(song.title)}" loading="lazy">
    </div>
    <div class="detail-badges">
      ${song.tags.map(unitChipHtml).join("")}
      ${badge}
    </div>`;
}

function vocalSelectorHtml(song, activeVocalId) {
  if (!song.vocals.length) {
    return `
      <div class="field-block">
        <div class="field-label">${icon("mic")}ボーカル</div>
        <div class="vocal-empty-note">利用可能なボーカルがありません</div>
      </div>`;
  }
  const options = song.vocals.map((v) => vocalOptionHtml(v, v.id === activeVocalId)).join("");
  return `
    <div class="field-block">
      <div class="field-label">${icon("mic")}ボーカル</div>
      <div class="vocal-selector">${options}</div>
    </div>`;
}

function vocalOptionHtml(vocal, isSelected) {
  const chars = vocal.characters.map((c) => getCharacter(c.type, c.id)).filter(Boolean);
  const shown = chars.slice(0, 4);
  const extra = chars.length - shown.length;
  const avatars =
    shown.map((c) => avatarHtml(c, 30)).join("") +
    (extra > 0 ? `<span class="avatar" style="width:30px;height:30px;font-size:10px">+${extra}</span>` : "");
  const names = chars.map((c) => c.shortName).join("・");

  return `
    <button type="button" class="vocal-option ${isSelected ? "is-selected" : ""}" data-vocal-id="${vocal.id}">
      <span class="vocal-option__avatars">${avatars}</span>
      <span class="vocal-option__caption">${escapeHtml(vocal.caption || "")}</span>
      <span class="vocal-option__names">${escapeHtml(names)}</span>
    </button>`;
}

function playbackCardHtml(enabled) {
  return `
    <div class="playback-card ${enabled ? "" : "is-disabled"}" id="playbackCard">
      <div class="seek-bar js-seek-bar" id="detailSeekBar">
        <div class="seek-bar__track">
          <div class="seek-bar__ticks"></div>
          <div class="seek-bar__buffered"></div>
          <div class="seek-bar__fill"></div>
          <div class="seek-bar__handle"></div>
        </div>
        <div class="seek-bar__time-row">
          <span class="seek-bar__current mono">0:00</span>
          <span class="seek-bar__duration mono">0:00</span>
        </div>
      </div>
      <div class="transport">
        <button class="transport__seek" data-player-action="seek-back" type="button" aria-label="5秒戻る">
          ${icon("rewind5")}
          <span class="transport__seek-label">5s</span>
        </button>
        <button class="transport__play" data-player-action="toggle-play" type="button" aria-label="再生">${icon("play")}</button>
        <button class="transport__seek" data-player-action="seek-forward" type="button" aria-label="5秒進む">
          ${icon("forward5")}
          <span class="transport__seek-label">5s</span>
        </button>
      </div>
      ${enabled ? "" : `<div class="playback-hint" id="playbackHint">ボーカルを選択してください</div>`}
    </div>`;
}

function metaListHtml(song) {
  const rows = [
    ["楽曲ID", `<span class="mono">No.${song.id}</span>`],
    ["タイトル", escapeHtml(song.title)],
    ["よみがな", escapeHtml(song.pronunciation) || "-"],
    ["ユニット", song.tags.length ? song.tags.map(unitChipHtml).join(" ") : "-"],
    ["作詞", escapeHtml(song.lyricist)],
    ["作曲", escapeHtml(song.composer)],
    ["編曲", escapeHtml(song.arranger)],
    ["公開日時", `<span class="mono">${formatDateTime(song.publishedAt)}</span>`],
  ];
  return `
    <div class="meta-list">
      ${rows
        .map(
          ([label, value]) => `
        <div class="meta-row">
          <span class="meta-row__label">${label}</span>
          <span class="meta-row__value">${value}</span>
        </div>`
        )
        .join("")}
    </div>`;
}

function originalVideoHtml(song) {
  if (!song.original || !song.original.videoLink) {
    return `
      <div class="original-video-block">
        <div class="field-label">${icon("external")}オリジナルビデオ</div>
        <div class="vocal-empty-note">オリジナルビデオはありません</div>
      </div>`;
  }
  return `
    <div class="original-video-block">
      <div class="field-label">${icon("external")}オリジナルビデオ</div>
      <button class="btn btn--ghost original-video-btn" id="originalVideoBtn" type="button">
        ${icon("external")}オリジナルビデオを見る
      </button>
      <div class="original-video-note">ボタンを押すと外部サイトに移動します</div>
    </div>`;
}

function difficultyHtml(song) {
  const available = DIFFICULTY_ORDER.filter((d) => song.levelByDifficulty[d]);
  if (!available.length) {
    return `
      <div class="difficulty-section">
        <div class="field-label">${icon("tune")}難易度</div>
        <div class="vocal-empty-note">難易度情報がありません</div>
      </div>`;
  }
  const maxNotes = Math.max(...available.map((d) => song.levelByDifficulty[d].notes || 0), 1);

  const rows = available
    .map((d) => {
      const info = song.levelByDifficulty[d];
      const pct = Math.max(4, Math.round((info.notes / maxNotes) * 100));
      return `
        <div class="difficulty-row">
          <span class="diff-badge" data-diff="${d}">${DIFFICULTY_LABELS[d]}</span>
          <span class="difficulty-row__track"><span class="difficulty-row__fill" style="width:${pct}%;--fill-color:var(--diff-${d})"></span></span>
          <span class="difficulty-row__stats"><strong>Lv.${info.level}</strong> / ${info.notes} notes</span>
        </div>`;
    })
    .join("");

  return `
    <div class="difficulty-section">
      <div class="field-label">${icon("tune")}難易度ごとのレベル・ノーツ数</div>
      <div class="difficulty-rows">${rows}</div>
    </div>`;
}

function bindDetailEvents(song) {
  qs("#detailBackBtn").addEventListener("click", navigateToList);

  qs("#detailView")
    .querySelectorAll("[data-vocal-id]")
    .forEach((btn) => {
      btn.addEventListener("click", () => {
        const vocal = song.vocals.find((v) => v.id === Number(btn.dataset.vocalId));
        if (!vocal) return;

        player.loadVocal(song, vocal);

        qs("#detailView")
          .querySelectorAll("[data-vocal-id]")
          .forEach((b) => b.classList.toggle("is-selected", b === btn));

        const card = qs("#playbackCard");
        card.classList.remove("is-disabled");
        const hint = qs("#playbackHint");
        if (hint) hint.remove();

        player.refreshPlayerUI();
      });
    });

  const originalBtn = qs("#originalVideoBtn");
  if (originalBtn) {
    originalBtn.addEventListener("click", async () => {
      const ok = await showConfirmDialog({
        title: "外部サイトに移動します",
        message: "オリジナルビデオを見るために、このサイトを離れて外部サイトに移動します。よろしいですか?",
        confirmLabel: "移動する",
        cancelLabel: "キャンセル",
      });
      if (ok) window.open(song.original.videoLink, "_blank", "noopener,noreferrer");
    });
  }
}
