// badges.js — tiny shared HTML-fragment helpers for the two badge types
// that appear in both the list cards and the detail view: unit tags and
// difficulty level badges. Kept separate so list-view.js and
// detail-view.js can both use them without depending on each other.

import { DIFFICULTY_LABELS, UNIT_TAG_LABELS } from "./api.js";

export function unitChipHtml(tag) {
  return `<span class="unit-chip" style="--unit-color:var(--unit-${tag})">${UNIT_TAG_LABELS[tag]}</span>`;
}

export function diffBadgeHtml(diffInfo, short = false) {
  const label = short ? DIFFICULTY_LABELS[diffInfo.difficulty].slice(0, 3) : DIFFICULTY_LABELS[diffInfo.difficulty];
  return `<span class="diff-badge" data-diff="${diffInfo.difficulty}">${label} ${diffInfo.level}</span>`;
}
