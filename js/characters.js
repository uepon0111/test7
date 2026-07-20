// characters.js — resolves singing-character identity (name + icon) for
// both in-game characters (icon available) and outside characters
// (no official icon asset, so we render a generated initial-avatar).

import { gameCharacterIconUrl } from "./api.js";

const registry = new Map(); // key `${type}:${id}` -> character record
let filterList = []; // characters that actually sing on at least one song, for the filter grid

export function characterKey(type, id) {
  return `${type}:${id}`;
}

export function buildCharacterIndex({ gameCharacters, outsideCharacters }, songs) {
  registry.clear();

  for (const gc of gameCharacters) {
    const name = gc.firstName ? `${gc.firstName}${gc.givenName}` : gc.givenName;
    registry.set(characterKey("game_character", gc.id), {
      type: "game_character",
      id: gc.id,
      name,
      shortName: gc.givenName,
      iconUrl: gameCharacterIconUrl(gc.id),
      unit: gc.unit,
    });
  }

  for (const oc of outsideCharacters) {
    registry.set(characterKey("outside_character", oc.id), {
      type: "outside_character",
      id: oc.id,
      name: oc.name,
      shortName: oc.name,
      iconUrl: null,
      unit: null,
    });
  }

  const used = new Set();
  for (const song of songs) {
    for (const key of song.singerKeys) used.add(key);
  }

  filterList = Array.from(used)
    .map((key) => registry.get(key))
    .filter(Boolean)
    .sort((a, b) => {
      if (a.type !== b.type) return a.type === "game_character" ? -1 : 1;
      return a.id - b.id;
    });
}

export function getCharacter(type, id) {
  return registry.get(characterKey(type, id)) || null;
}

export function getCharacterByKey(key) {
  return registry.get(key) || null;
}

export function getFilterCharacterList() {
  return filterList;
}

/** Initials used for the generated outside-character avatar (1-2 chars). */
export function initialsFor(name) {
  if (!name) return "?";
  const trimmed = name.trim();
  // For Latin names show up to 2 letters (e.g. "GUMI" -> "GU"); for
  // Japanese/other scripts a single character reads more cleanly.
  if (/^[A-Za-z0-9]/.test(trimmed)) {
    return trimmed.slice(0, 2).toUpperCase();
  }
  return trimmed.slice(0, 1);
}

/**
 * Shared avatar markup for a character record: an <img> for in-game
 * characters (icon asset available), or a generated initials badge for
 * outside characters (no official icon asset exists for these).
 */
export function avatarHtml(character, size = 40) {
  const style = `width:${size}px;height:${size}px`;
  if (character.type === "game_character" && character.iconUrl) {
    const safeName = escapeAttr(character.name);
    return `<span class="avatar" style="${style}"><img src="${character.iconUrl}" alt="${safeName}" loading="lazy"></span>`;
  }
  const initials = escapeAttr(initialsFor(character.name));
  return `<span class="avatar avatar--outside" style="${style}">${initials}</span>`;
}

function escapeAttr(str) {
  return String(str || "").replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}
