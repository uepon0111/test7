/**
 * ocr-engine.js
 * ---------------------------------------------------------------------------
 * Tesseract.js を用いた画像解析（OCR）処理。
 * 機種プロファイルの読み取り範囲（比率）に従って画像を切り出し、
 * 曲名・難易度・PERFECT/GREAT/GOOD/BAD/MISS数・最大コンボ数を読み取る。
 *
 * Tesseractワーカーはこのモジュール内でキャッシュ・再利用する。
 * （毎回作成/破棄していた旧実装より、連続解析・再解析が高速になる）
 * ---------------------------------------------------------------------------
 */
const OcrEngine = (() => {
  let worker = null;
  let workerPromise = null;

  async function getWorker() {
    if (worker) return worker;
    if (!workerPromise) {
      workerPromise = Tesseract.createWorker(['jpn', 'eng']).then((w) => { worker = w; return w; });
    }
    return workerPromise;
  }

  async function terminateWorker() {
    const w = worker;
    worker = null;
    workerPromise = null;
    if (w) {
      try { await w.terminate(); } catch (e) { /* noop */ }
    }
  }

  // region: {x,y,w,h} 比率(0〜1)。type: 'filter-standard' | 'threshold-diff'
  async function cropImage(imageElement, region, type = 'filter-standard') {
    const canvas = document.createElement('canvas');
    const w = imageElement.naturalWidth;
    const h = imageElement.naturalHeight;
    const ctx = canvas.getContext('2d');
    const xRatio = region.x, yRatio = region.y, wRatio = region.w, hRatio = region.h;

    if (type === 'threshold-diff') {
      const scale = 1.5;
      canvas.width = Math.max(1, w * wRatio * scale);
      canvas.height = Math.max(1, h * hRatio * scale);
      ctx.drawImage(imageElement, w * xRatio, h * yRatio, w * wRatio, h * hRatio, 0, 0, canvas.width, canvas.height);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const data = imageData.data;
      for (let i = 0; i < data.length; i += 4) {
        const gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
        data[i] = data[i + 1] = data[i + 2] = (gray > 180) ? 0 : 255;
      }
      ctx.putImageData(imageData, 0, 0);
    } else {
      canvas.width = Math.max(1, w * wRatio);
      canvas.height = Math.max(1, h * hRatio);
      ctx.filter = 'grayscale(100%) contrast(150%)';
      ctx.drawImage(imageElement, w * xRatio, h * yRatio, w * wRatio, h * hRatio, 0, 0, canvas.width, canvas.height);
    }
    return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  }

  function _parseLine(line, regex) {
    if (regex.test(line)) {
      const nums = line.match(/\d+/g);
      if (nums) return parseInt(nums[nums.length - 1], 10);
    }
    return 0;
  }

  async function analyze(imgElement, profile) {
    const regions = (profile && profile.regions) || Config.DEFAULT_REGIONS;
    const w = await getWorker();
    try {
      // --- 難易度 ---
      const diffBlob = await cropImage(imgElement, regions.difficulty, 'threshold-diff');
      const diffRet = await w.recognize(diffBlob, { lang: 'eng' });
      const diffText = diffRet.data.text.toUpperCase();
      let diffKey = 'expert';
      if (diffText.match(/A?P{2}E?N?D?/)) diffKey = 'append';
      else if (diffText.includes('MASTER')) diffKey = 'master';
      else if (diffText.includes('EXPERT')) diffKey = 'expert';
      else if (diffText.includes('HARD')) diffKey = 'hard';
      else if (diffText.includes('NORMAL')) diffKey = 'normal';
      else if (diffText.includes('EASY')) diffKey = 'easy';

      // --- 曲名 ---
      const titleBlob = await cropImage(imgElement, regions.title, 'filter-standard');
      const titleRet = await w.recognize(titleBlob, { lang: 'jpn' });
      const matchedMusic = MusicDB.findBestMatchMusic(titleRet.data.text);
      const finalTitle = matchedMusic ? matchedMusic.title : titleRet.data.text.replace(/\r?\n/g, '').trim();
      const musicId = matchedMusic ? matchedMusic.id : null;

      // --- レベル ---
      let level = '';
      if (musicId != null) level = MusicDB.getLevelFromDb(musicId, diffKey) || '';

      // --- 判定内訳（PERFECT / GREAT / GOOD / BAD / MISS） ---
      const breakdownBlob = await cropImage(imgElement, regions.breakdown, 'filter-standard');
      const breakdownRet = await w.recognize(breakdownBlob, { lang: 'jpn' });
      const lines = breakdownRet.data.text.split('\n');
      let cPerfect = 0, cGreat = 0, cGood = 0, cBad = 0, cMiss = 0;
      lines.forEach((line) => {
        if (/PERFECT/i.test(line)) cPerfect = _parseLine(line, /PERFECT/i);
        if (/GREAT/i.test(line)) cGreat = _parseLine(line, /GREAT/i);
        if (/G[O0QD]{2}D/i.test(line)) cGood = _parseLine(line, /G[O0QD]{2}D/i);
        if (/BAD/i.test(line)) cBad = _parseLine(line, /BAD/i);
        if (/MISS/i.test(line)) cMiss = _parseLine(line, /MISS/i);
      });

      // --- 最大コンボ数 ---
      const comboBlob = await cropImage(imgElement, regions.combo, 'filter-standard');
      const comboRet = await w.recognize(comboBlob, { lang: 'eng' });
      const comboNums = comboRet.data.text.match(/\d+/g);
      const combo = comboNums && comboNums.length > 0 ? parseInt(comboNums[comboNums.length - 1], 10) : 0;

      return {
        title: finalTitle, level, diffKey, musicId,
        perfect: cPerfect, great: cGreat, good: cGood, bad: cBad, miss: cMiss,
        missCount: cGood + cBad + cMiss,
        combo,
      };
    } catch (e) {
      console.error('OCR analyze error', e);
      return null;
    }
  }

  return { getWorker, terminateWorker, cropImage, analyze };
})();
