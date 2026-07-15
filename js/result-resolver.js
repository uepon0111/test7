/*
 * result-resolver.js
 * -----------------------------------------------------------------------
 * OCRで読み取った各項目(曲名・難易度・レベル・判定内訳・コンボ数)を、
 * 楽曲マスターDB(music-db.js)の情報と突き合わせて最終的な値を決定する「判断」レイヤーです。
 * ocr-analyzer.js (画像→文字を読み取る) と music-db.js (DBを検索する) の間に立ち、
 * 次のようなことを行います。
 *
 *   1. 曲名の読み取りに自信が持てない場合、難易度・レベル・総ノーツ数(PERFECT+GREAT+
 *      GOOD+BAD+MISS)から楽曲を逆算する。「その難易度でその総ノーツ数のものをリスト
 *      アップし、最も近いものを採用する」という要求仕様をそのまま実装しています。
 *   2. 曲名が特定できた場合でも、難易度の読み取りに自信が持てなければ、同じ楽曲の中で
 *      総ノーツ数が最も近い難易度を採用し直す(難易度の誤読を補正)。
 *   3. 特定した楽曲の総ノーツ数・レベルと、実際に読み取った値が食い違っていないかを検証し、
 *      食い違いがあれば警告として残す(黙って数値を書き換えたりはしない)。
 *   4. コンボ数が総ノーツ数を超えているような、物理的にあり得ない値を警告する
 *      (コンボは最大でも総ノーツ数を超えられないため、超えている場合は何らかの誤読や
 *      画像の想定外の写り込みを疑うべき、という要求仕様どおりの検証です)。
 *
 * 判定内訳(PERFECT/GREAT/GOOD/BAD/MISS)とコンボ数は「実際のプレイ結果の実測値」なので、
 * DBの値で上書きすることはありません。DBに問い合わせて確定させるのは、楽曲マスターに
 * 紐づく固定情報である曲名・難易度・レベルのみです。
 * -----------------------------------------------------------------------
 */

// 曲名マッチのスコア(正規化レーベンシュタイン距離)がこの値以下なら「信頼できる」とみなす。
// Tesseract.jsのjpn認識は誤読が出やすいため、多少緩めに設定しています。
const TITLE_CONFIDENT_SCORE = 0.28;
// 難易度の判定が完全一致(exact)でない場合、このスコアより悪ければ「不確実」とみなす。
const DIFF_CONFIDENT_SCORE = 0.34;

function resolveAnalysisResult(raw) {
  // raw = {
  //   titleText: string,               // 曲名OCRの生テキスト(改行等はここでは未整形でも可)
  //   diff: { code, word, exact, score }, // detectDifficultyCode() の戻り値
  //   level: number|null,               // レベルOCRの結果(読み取れなければnull)
  //   perfect, great, good, bad, miss,  // 判定内訳(実測値、そのまま採用する)
  //   combo: number,
  // }
  const totalNoteCountOcr = raw.perfect + raw.great + raw.good + raw.bad + raw.miss;
  const warnings = []; // [{code, message}] 画面表示・ログ表示用の警告
  const notes = [];    // 参考情報(警告ほど強くないメモ)

  const titleMatch = findBestMatchMusicWithScore(raw.titleText); // {music, score} | null
  const titleConfident = !!titleMatch && titleMatch.score <= TITLE_CONFIDENT_SCORE;
  const diffConfident = raw.diff.exact || raw.diff.score <= DIFF_CONFIDENT_SCORE;

  let resolvedMusic = null;    // dbMusics のエントリ
  let resolvedDiffRow = null;  // dbDiffs のエントリ (musicId/musicDifficulty/playLevel/totalNoteCount)
  let method = 'unresolved';   // 'title' | 'stats' | 'unresolved'
  let candidates = [];         // method==='stats' のときの逆算候補一覧(手動選択用に保持)

  if (titleConfident) {
    // --- 曲名を信頼できる場合: その楽曲の中で難易度・総ノーツ数の整合性を確認する ---
    resolvedMusic = titleMatch.music;
    const rowsForMusic = getDiffRowsForMusic(resolvedMusic.id);
    const diffDbKey = getDiffDbKey(raw.diff.code);
    const directRow = diffDbKey ? rowsForMusic.find(r => r.musicDifficulty === diffDbKey) : null;

    if (diffConfident && directRow) {
      // 難易度も確信を持って読めている: そのまま採用しつつ、総ノーツ数だけ検証する
      resolvedDiffRow = directRow;
      method = 'title';
      if (directRow.totalNoteCount !== totalNoteCountOcr) {
        warnings.push({
          code: 'note-count-mismatch',
          message: `総ノーツ数が一致しません(読み取り値: ${totalNoteCountOcr} / DB: ${directRow.totalNoteCount})。判定内訳(PERFECT/GREAT/GOOD/BAD/MISS)の読み取りに誤りがある可能性があります。`,
        });
      }
    } else if (rowsForMusic.length > 0) {
      // 難易度の読み取りに自信が無い(あいまい一致) → 同じ楽曲の中で総ノーツ数が
      // 最も近い難易度を採用し直す。誤読していた難易度をここで補正する。
      let best = rowsForMusic[0], bestDiff = Math.abs(rowsForMusic[0].totalNoteCount - totalNoteCountOcr);
      rowsForMusic.forEach(r => {
        const d = Math.abs(r.totalNoteCount - totalNoteCountOcr);
        if (d < bestDiff) { bestDiff = d; best = r; }
      });
      resolvedDiffRow = best;
      method = 'title';
      if (!directRow || best.musicDifficulty !== directRow.musicDifficulty) {
        notes.push(`難易度の読み取りが不明瞭だったため、総ノーツ数から「${getDiffLabel(getCodeFromDbKey(best.musicDifficulty))}」と判断しました。`);
      }
      if (bestDiff > 0) {
        warnings.push({
          code: 'note-count-mismatch',
          message: `総ノーツ数が一致しません(読み取り値: ${totalNoteCountOcr} / DB: ${best.totalNoteCount})。判定内訳の読み取りに誤りがある可能性があります。`,
        });
      }
    } else {
      warnings.push({ code: 'no-chart-data', message: 'この楽曲の譜面データがマスターDBに見つかりませんでした。難易度・レベルは読み取り値をそのまま使用します。' });
    }
  }

  if (!resolvedMusic) {
    // --- 曲名の読み取りに自信が持てない: 難易度・レベル・総ノーツ数から楽曲を逆算する ---
    const diffKeyForSearch = diffConfident ? getDiffDbKey(raw.diff.code) : null;
    candidates = findCandidatesByStats({
      diffKey: diffKeyForSearch,
      totalNoteCount: totalNoteCountOcr,
      level: raw.level,
      titleText: raw.titleText,
      limit: 5,
    });

    if (candidates.length > 0) {
      const top = candidates[0];
      resolvedMusic = top.music;
      resolvedDiffRow = top.row;
      method = 'stats';
      notes.push('曲名の読み取り精度が低かったため、難易度・レベル・総ノーツ数からもっとも近い楽曲を自動推定しました。誤っている場合は候補一覧から選び直すか、手動で修正してください。');
      if (top.noteDiff > 0) {
        warnings.push({
          code: 'note-count-mismatch',
          message: `推定した楽曲の総ノーツ数(${top.row.totalNoteCount})と読み取った総ノーツ数(${totalNoteCountOcr})が一致しません。判定内訳や楽曲の推定に誤りがある可能性があります。`,
        });
      }
    } else {
      warnings.push({ code: 'unresolved', message: '楽曲を自動特定できませんでした。曲名・レベル・難易度を手動で確認・修正してください。' });
    }
  }

  const finalTitle = resolvedMusic ? resolvedMusic.title : (raw.titleText || '').replace(/\r?\n/g, ' ').trim();
  const finalLevel = resolvedDiffRow ? resolvedDiffRow.playLevel : ((typeof raw.level === 'number' && raw.level !== null) ? raw.level : '');
  const finalDiffCode = resolvedDiffRow ? (getCodeFromDbKey(resolvedDiffRow.musicDifficulty) || raw.diff.code) : raw.diff.code;
  const finalMusicId = resolvedMusic ? resolvedMusic.id : null;
  const finalTotalNoteCount = resolvedDiffRow ? resolvedDiffRow.totalNoteCount : totalNoteCountOcr;

  // レベルOCRの結果とDB側のレベルが食い違う場合の診断(楽曲の特定自体は総ノーツ数などで
  // 既に行われているので、ここは主に「レベルの読み取り自体がズレていた」ことを示す情報)。
  if (resolvedDiffRow && typeof raw.level === 'number' && raw.level !== null && raw.level !== resolvedDiffRow.playLevel) {
    warnings.push({
      code: 'level-mismatch',
      message: `読み取ったレベル(${raw.level})が特定した楽曲のレベル(${resolvedDiffRow.playLevel})と異なります。レベルの読み取り範囲・二値化を確認してください。`,
    });
  }

  // コンボ数は総ノーツ数を絶対に超えない、という物理的な制約に基づくチェック。
  // 超えている場合はコンボ数の誤読、または範囲に別の数字が写り込んでいる可能性が高い。
  if (raw.combo > finalTotalNoteCount) {
    warnings.push({
      code: 'combo-exceeds-notes',
      message: `コンボ数(${raw.combo})が総ノーツ数(${finalTotalNoteCount})を超えています。コンボ数の誤読、または範囲内に別の数値が写り込んでいる可能性があります。`,
    });
  }

  return {
    title: finalTitle,
    level: finalLevel,
    diff: finalDiffCode,
    musicId: finalMusicId,
    perfect: raw.perfect, great: raw.great, good: raw.good, bad: raw.bad, miss: raw.miss,
    combo: raw.combo,
    totalNoteCount: totalNoteCountOcr,
    totalNoteCountDb: resolvedDiffRow ? resolvedDiffRow.totalNoteCount : null,
    identification: {
      method,
      titleMatchScore: titleMatch ? titleMatch.score : null,
      titleConfident,
      diffConfident,
      candidates: candidates.map(c => ({
        musicId: c.music.id,
        title: c.music.title,
        diff: getCodeFromDbKey(c.row.musicDifficulty),
        level: c.row.playLevel,
        totalNoteCount: c.row.totalNoteCount,
        noteDiff: c.noteDiff,
      })),
    },
    warnings,
    notes,
  };
}
