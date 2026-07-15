/*
 * ocr-analyzer.js
 * -----------------------------------------------------------------------
 * リザルト画像から Tesseract.js (OCR) を使って情報を読み取る処理。
 * 読み取る範囲(座標)は「機種プロファイル」(device-profiles.js)から与えられ、
 * 設定モーダルで自由に調整できます。
 *
 * 読み取る項目:
 *   - 難易度 (EASY/NORMAL/HARD/EXPERT/MASTER/APPEND)
 *   - レベル ※新規追加。数値だけを抽出する
 *   - 曲名 (マスターDBとのファジーマッチングで補正)
 *   - 判定内訳 (PERFECT/GREAT/GOOD/BAD/MISS)
 *   - コンボ数
 *
 * このファイルの役割は「画像の指定範囲を読み取りやすい形に加工し、Tesseractで文字に
 * 変換し、単純なパース(数値抽出など)を行う」ところまでです。読み取った複数の項目を
 * 突き合わせて最終的な曲名・難易度・レベルを決定する処理は result-resolver.js が担当します。
 *
 * 【二値化について】
 * 難易度バッジは難易度ごとに背景色が異なり(例: HARDは黄・MASTERは紫)、単純な固定しきい値
 * では明るい背景色(黄など)と白文字の区別がつかなくなる問題がありました。そこで、
 * クロップした画像ごとにヒストグラムから最適なしきい値を求める大津の二値化を使い、
 * さらに「画素数が少ない方(=文字)/多い方(=背景)」を都度自動判定することで、
 * バッジの配色によらず白背景+黒文字に統一しています(項目ごとに適切な二値化処理)。
 * -----------------------------------------------------------------------
 */

// ============================================================
// 大津の二値化 (Otsu's method) + 極性自動判定
// ============================================================

// ヒストグラム(256階調)から、クラス間分散が最大になるしきい値を求める。
function otsuThreshold(hist, total) {
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0, wB = 0, best = 127, bestVar = -1;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > bestVar) { bestVar = between; best = t; }
  }
  return best;
}

// ImageData をグレースケール化した上で大津の二値化を行い、白背景+黒文字に統一する。
// mode: 'auto'(多数派の画素=背景とみなす) / 'dark-text'(暗い側を文字とする) / 'light-text'(明るい側を文字とする)
// 戻り値はデバッグ表示用の { threshold, darkIsText }。
function binarizeImageData(imageData, mode) {
  const data = imageData.data;
  const n = data.length / 4;
  const gray = new Uint8ClampedArray(n);
  const hist = new Array(256).fill(0);
  for (let p = 0; p < n; p++) {
    const o = p * 4;
    const g = (0.299 * data[o] + 0.587 * data[o + 1] + 0.114 * data[o + 2]) | 0;
    gray[p] = g;
    hist[g]++;
  }
  const t = otsuThreshold(hist, n);
  let belowCount = 0;
  for (let g = 0; g <= t; g++) belowCount += hist[g];
  const aboveCount = n - belowCount;

  let darkIsText;
  if (mode === 'dark-text') darkIsText = true;
  else if (mode === 'light-text') darkIsText = false;
  else darkIsText = belowCount <= aboveCount; // auto: 少数派を文字とみなす

  for (let p = 0; p < n; p++) {
    const isDark = gray[p] <= t;
    const isText = darkIsText ? isDark : !isDark;
    const v = isText ? 0 : 255;
    const o = p * 4;
    data[o] = data[o + 1] = data[o + 2] = v;
    data[o + 3] = 255;
  }
  return { threshold: t, darkIsText };
}

// 二値化後に残る孤立した1px程度のノイズ(JPEG圧縮由来など)を除去する簡易デスペックル。
// 8近傍に同色(黒)の画素が1つも無い黒画素だけを背景(白)に戻す。文字のストロークは
// 通常どこかしら隣接する黒画素を持つため、これによって細い線や画数が消えることはない。
function despeckle(imageData) {
  const { data, width, height } = imageData;
  const n = width * height;
  const isBlack = new Uint8Array(n);
  for (let p = 0; p < n; p++) isBlack[p] = data[p * 4] === 0 ? 1 : 0;

  const toClear = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      if (!isBlack[idx]) continue;
      let neighbors = 0;
      for (let dy = -1; dy <= 1 && neighbors === 0; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          if (isBlack[ny * width + nx]) { neighbors = 1; break; }
        }
      }
      if (neighbors === 0) toClear.push(idx);
    }
  }
  toClear.forEach(idx => {
    const o = idx * 4;
    data[o] = data[o + 1] = data[o + 2] = 255;
  });
}

// ============================================================
// クロップ + 拡大 + 二値化 (項目ごとに適切な前処理を行う中心部分)
// ============================================================

const MIN_CROP_DIM = 220; // 二値化後にOCRしやすいよう、短辺がこのpx数以上になるまで拡大する
const MIN_SCALE = 2;
const MAX_SCALE = 6;
const CROP_PADDING = 10; // 文字が画像端に接しないための白余白(px, 拡大後の基準)

function computeCropScale(srcWpx, srcHpx) {
  const smaller = Math.min(srcWpx, srcHpx);
  if (smaller <= 0) return MIN_SCALE;
  return clamp(MIN_CROP_DIM / smaller, MIN_SCALE, MAX_SCALE);
}

// 画像の指定範囲(比率 x,y,w,h ∈ [0,1])を切り出し、拡大・グレースケール化・大津の二値化・
// デスペックル・白余白付与までを行った Canvas を返す。
// 戻り値: { canvas, dataUrl, pxRect(元画像上の実座標), scale, threshold, darkIsText }
async function cropAndBinarize(imageElement, region) {
  const naturalW = imageElement.naturalWidth;
  const naturalH = imageElement.naturalHeight;
  const srcX = Math.round(naturalW * region.x);
  const srcY = Math.round(naturalH * region.y);
  const srcW = Math.max(1, Math.round(naturalW * region.w));
  const srcH = Math.max(1, Math.round(naturalH * region.h));

  const scale = computeCropScale(srcW, srcH);
  const scaledW = Math.max(1, Math.round(srcW * scale));
  const scaledH = Math.max(1, Math.round(srcH * scale));

  const work = document.createElement('canvas');
  work.width = scaledW;
  work.height = scaledH;
  const wctx = work.getContext('2d');
  wctx.imageSmoothingEnabled = true;
  if ('imageSmoothingQuality' in wctx) wctx.imageSmoothingQuality = 'high';
  wctx.drawImage(imageElement, srcX, srcY, srcW, srcH, 0, 0, scaledW, scaledH);

  const imageData = wctx.getImageData(0, 0, scaledW, scaledH);
  const binInfo = binarizeImageData(imageData, region.binarize || 'auto');
  despeckle(imageData);
  wctx.putImageData(imageData, 0, 0);

  // 周囲に白い余白を付けて最終キャンバスへ(Tesseractは文字が端に接していない方が安定する)
  const final = document.createElement('canvas');
  final.width = scaledW + CROP_PADDING * 2;
  final.height = scaledH + CROP_PADDING * 2;
  const fctx = final.getContext('2d');
  fctx.fillStyle = '#fff';
  fctx.fillRect(0, 0, final.width, final.height);
  fctx.drawImage(work, CROP_PADDING, CROP_PADDING);

  return {
    canvas: final,
    dataUrl: final.toDataURL('image/png'),
    pxRect: { x: srcX, y: srcY, w: srcW, h: srcH },
    scale,
    threshold: binInfo.threshold,
    darkIsText: binInfo.darkIsText,
  };
}

// ============================================================
// 項目ごとのOCRパラメータ (文字種ホワイトリスト・ページ分割モード)
// ============================================================
// 難易度・判定内訳・コンボ数は英字+数字のみで構成される(漢字を含まない)ことが
// 画面の実測から分かっているため、文字種を絞ることで誤認識を大きく減らせる。
// 曲名・レベル表示("楽曲Lv.")は漢字を含むためホワイトリストは付けない。
// pageseg_mode: 6=均一なブロック(複数行), 7=1行のテキスト, 8=単語1つ
const OCR_FIELD_PARAMS = {
  difficulty: { whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', psm: '8' },
  level: { whitelist: '', psm: '7' },
  title: { whitelist: '', psm: '7' },
  breakdown: { whitelist: '0123456789PERFCTGAODBMIS ', psm: '6' },
  combo: { whitelist: '0123456789COMB ', psm: '7' },
};

// ============================================================
// パース処理
// ============================================================

// OCRで読み取った文字列から難易度を判定する。完全一致(部分文字列として含む)を優先し、
// 見つからない場合はレーベンシュタイン距離で最も近い難易度名を採用する。
// exact/score を一緒に返すことで、呼び出し側(result-resolver.js)が
// 「この読み取り結果をどれだけ信頼してよいか」を判断できるようにしている。
const DIFF_WORD_TO_CODE = { EASY: 'EZ', NORMAL: 'NM', HARD: 'HD', EXPERT: 'EX', MASTER: 'MS', APPEND: 'AP' };

function detectDifficultyCode(diffText) {
  const cleaned = (diffText || '').toUpperCase().replace(/[^A-Z]/g, '');
  const words = Object.keys(DIFF_WORD_TO_CODE);
  if (!cleaned) return { code: 'EX', word: 'EXPERT', exact: false, score: 1 };

  for (const word of words) {
    if (cleaned.includes(word)) return { code: DIFF_WORD_TO_CODE[word], word, exact: true, score: 0 };
  }
  let bestWord = 'EXPERT', bestDist = Infinity;
  for (const word of words) {
    const dist = levenshtein(cleaned, word) / Math.max(cleaned.length, word.length);
    if (dist < bestDist) { bestDist = dist; bestWord = word; }
  }
  return { code: DIFF_WORD_TO_CODE[bestWord], word: bestWord, exact: false, score: bestDist };
}

// レベルのテキスト("楽曲Lv. APD34"など)から数値だけを抽出する。
// 明らかにレベルとしてあり得ない値(0以下・3桁以上)は読み取り失敗とみなしnullを返す。
function parseLevelText(text) {
  const n = extractLongestNumber(text);
  if (n === null || n <= 0 || n > 99) return null;
  return n;
}

// 判定内訳のテキストから PERFECT/GREAT/GOOD/BAD/MISS の数値を読み取る。
function parseBreakdownText(text) {
  const lines = (text || '').split('\n');
  let perfect = 0, great = 0, good = 0, bad = 0, miss = 0;
  const parseLine = (line, regex) => {
    if (regex.test(line)) {
      const nums = line.match(/\d+/g);
      if (nums) return parseInt(nums[nums.length - 1], 10);
    }
    return 0;
  };
  lines.forEach(line => {
    if (/PERFECT/i.test(line)) perfect = parseLine(line, /PERFECT/i);
    if (/GREAT/i.test(line)) great = parseLine(line, /GREAT/i);
    if (/G[O0QD]{2}D/i.test(line)) good = parseLine(line, /G[O0QD]{2}D/i);
    if (/BAD/i.test(line)) bad = parseLine(line, /BAD/i);
    if (/MISS/i.test(line)) miss = parseLine(line, /MISS/i);
  });
  return { perfect, great, good, bad, miss };
}

// コンボ数のテキストから最も桁数の多い数値を採用する(ラベル文字等の誤検出を避けるため)。
function parseComboText(text) {
  return extractLongestNumber(text) || 0;
}

// ============================================================
// 画像1枚の解析 (各項目のクロップ+OCR+パース → result-resolver.js で総合判断)
// ============================================================

// worker に対して、項目ごとに文字種ホワイトリスト・ページ分割モードを設定してから認識する。
// setParameters は呼び出すたびに完全に指定し直す(前の項目の設定が残らないようにするため)。
async function recognizeField(worker, canvas, fieldParams) {
  await worker.setParameters({
    tessedit_char_whitelist: fieldParams.whitelist || '',
    tessedit_pageseg_mode: fieldParams.psm || '3',
  });
  return await worker.recognize(canvas);
}

async function analyzeLoadedImage(imgElement, worker, regions) {
  const r = regions || DEFAULT_REGIONS;
  const debugLog = {};

  async function runField(key, label, fieldParams) {
    const region = r[key] || DEFAULT_REGIONS[key];
    const crop = await cropAndBinarize(imgElement, region);
    const ret = await recognizeField(worker, crop.canvas, fieldParams);
    const rawText = (ret && ret.data && ret.data.text) || '';
    debugLog[key] = {
      label,
      region: { x: region.x, y: region.y, w: region.w, h: region.h, binarize: region.binarize || 'auto' },
      pxRect: crop.pxRect,
      dataUrl: crop.dataUrl,
      rawText,
      confidence: (ret && ret.data && typeof ret.data.confidence === 'number') ? ret.data.confidence : null,
      threshold: crop.threshold,
      darkIsText: crop.darkIsText,
    };
    return rawText;
  }

  try {
    const diffText = await runField('difficulty', '難易度', OCR_FIELD_PARAMS.difficulty);
    const diffInfo = detectDifficultyCode(diffText.toUpperCase());
    debugLog.difficulty.parsed = `${getDiffLabel(diffInfo.code)} (${diffInfo.exact ? '完全一致' : 'あいまい一致 score=' + diffInfo.score.toFixed(2)})`;

    const levelText = await runField('level', 'レベル', OCR_FIELD_PARAMS.level);
    const levelOcr = parseLevelText(levelText);
    debugLog.level.parsed = (levelOcr !== null) ? String(levelOcr) : '(読み取れず)';

    const titleTextRaw = await runField('title', '曲名', OCR_FIELD_PARAMS.title);
    const titleTextClean = titleTextRaw.replace(/\r?\n/g, ' ').trim();
    debugLog.title.parsed = titleTextClean;

    const bdText = await runField('breakdown', '判定内訳', OCR_FIELD_PARAMS.breakdown);
    const breakdown = parseBreakdownText(bdText);
    debugLog.breakdown.parsed = `PERFECT ${breakdown.perfect} / GREAT ${breakdown.great} / GOOD ${breakdown.good} / BAD ${breakdown.bad} / MISS ${breakdown.miss}`;

    const comboText = await runField('combo', 'コンボ数', OCR_FIELD_PARAMS.combo);
    const combo = parseComboText(comboText);
    debugLog.combo.parsed = String(combo);

    const resolved = resolveAnalysisResult({
      titleText: titleTextClean,
      diff: diffInfo,
      level: levelOcr,
      perfect: breakdown.perfect, great: breakdown.great, good: breakdown.good, bad: breakdown.bad, miss: breakdown.miss,
      combo: combo,
    });

    return Object.assign({}, resolved, { debugLog });
  } catch (e) {
    console.error(e);
    return null;
  }
}
