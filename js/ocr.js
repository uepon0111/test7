
(() => {
  const { util, config } = window.PRSK;
  const { normalizeString } = util;

  async function imageToCanvas(image) {
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth || image.width;
    canvas.height = image.naturalHeight || image.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(image, 0, 0);
    return canvas;
  }

  async function cropImage(image, region) {
    const canvas = document.createElement('canvas');
    const sx = Math.round((region.x / 100) * image.naturalWidth);
    const sy = Math.round((region.y / 100) * image.naturalHeight);
    const sw = Math.round((region.w / 100) * image.naturalWidth);
    const sh = Math.round((region.h / 100) * image.naturalHeight);
    canvas.width = Math.max(1, sw);
    canvas.height = Math.max(1, sh);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(image, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
    return canvas;
  }

  async function canvasToBlob(canvas) {
    return await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
  }

  function parseJudgementLines(text) {
    const lines = String(text || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    let perfect = 0, great = 0, miss = 0;
    const findNumber = (line) => {
      const nums = line.match(/\d+/g);
      return nums ? parseInt(nums[nums.length - 1], 10) : 0;
    };
    for (const line of lines) {
      if (/PERFECT|PERECT|PFRFECT|P[0O]RFECT/i.test(line)) perfect = findNumber(line);
      else if (/GREAT|GRAET|GR EAT/i.test(line)) great = findNumber(line);
      else if (/MISS/i.test(line)) miss = findNumber(line);
      else if (/GOOD/i.test(line)) perfect = findNumber(line);
      else if (/BAD/i.test(line)) great = findNumber(line);
    }
    return { perfect, great, miss };
  }

  async function analyzeLoadedImage(imgElement, worker, profile) {
    try {
      const regions = profile?.regions || {};
      const diffRegion = regions.diff || { x: 20, y: 7, w: 10, h: 4 };
      const titleRegion = regions.title || { x: 18, y: 1, w: 34, h: 5 };
      const resultRegion = regions.result || { x: 8, y: 52, w: 34, h: 26 };
      const comboRegion = regions.combo || { x: 58, y: 32, w: 30, h: 10 };

      const diffBlob = await canvasToBlob(await cropImage(imgElement, diffRegion));
      const diffRet = await worker.recognize(diffBlob, { lang: 'eng' });
      const diffText = String(diffRet?.data?.text || '').toUpperCase();
      let dCode = 'EXPERT';
      if (/APPEND|APEND|A P P E N D|P{2}END/.test(diffText)) dCode = 'APPEND';
      else if (/MASTER/.test(diffText)) dCode = 'MASTER';
      else if (/EXPERT|EXPER|E X P E R T/.test(diffText)) dCode = 'EXPERT';
      else if (/HARD/.test(diffText)) dCode = 'HARD';
      else if (/NORMAL/.test(diffText)) dCode = 'NORMAL';
      else if (/EASY/.test(diffText)) dCode = 'EASY';

      const titleBlob = await canvasToBlob(await cropImage(imgElement, titleRegion));
      const titleRet = await worker.recognize(titleBlob, { lang: 'jpn' });
      const rawTitle = String(titleRet?.data?.text || '').replace(/\r?\n/g, ' ').trim();
      const matchedMusic = window.PRSK.app.findBestMatchMusic(rawTitle);
      const title = matchedMusic ? matchedMusic.title : rawTitle;
      const musicId = matchedMusic ? matchedMusic.id : null;

      let level = '';
      if (musicId) {
        level = window.PRSK.app.getLevelFromDb(musicId, dCode) || '';
      }

      const resultBlob = await canvasToBlob(await cropImage(imgElement, resultRegion));
      const resultRet = await worker.recognize(resultBlob, { lang: 'jpn' });
      const counts = parseJudgementLines(resultRet?.data?.text || '');

      const comboBlob = await canvasToBlob(await cropImage(imgElement, comboRegion));
      const comboRet = await worker.recognize(comboBlob, { lang: 'jpn' });
      const comboText = String(comboRet?.data?.text || '');
      const comboNums = comboText.match(/\d+/g);
      const combo = comboNums ? parseInt(comboNums[comboNums.length - 1], 10) : 0;

      return {
        title,
        level,
        diffRaw: dCode,
        perfect: counts.perfect,
        great: counts.great,
        missCount: counts.miss,
        totalMiss: counts.miss,
        combo,
        musicId,
      };
    } catch (e) {
      console.error('OCR failed', e);
      return null;
    }
  }

  async function createWorkerInstance() {
    // keep current CDN API compatible
    const worker = await Tesseract.createWorker(['jpn', 'eng']);
    return worker;
  }

  window.PRSK.ocr = {
    cropImage,
    analyzeLoadedImage,
    createWorkerInstance,
    parseJudgementLines,
  };
})();
