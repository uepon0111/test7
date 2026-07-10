/**
 * drive-storage.js
 * ---------------------------------------------------------------------------
 * Google Drive 上でのリザルト画像の保存・取得・更新・削除を担当する。
 *
 * 【保存構造（新方式・フラット構造）】
 *   プロセカリザルト/            … アプリのルートフォルダ
 *     └ results/                … 全リザルト画像をフラットに格納（楽曲ごとのフォルダを作らない）
 *          ファイル名: "{level}{diffcode}_{曲名}_{yyyyMMdd-HHmmssff}.拡張子"
 *              例: "28EX_ワンダーランズ×ショウタイム_20260708-153045123.jpg"
 *              → Drive上で人が見てもひと目で内容が分かるように付与するが、
 *                アプリ自体はここから値をパースすることを前提にしない。
 *          appProperties（Driveのカスタムメタデータ。数値等はここが正）:
 *              schemaVersion, musicId, level, diff,
 *              perfect, great, good, bad, miss, missCount, combo, isFC
 *          「追加日」は自前でタイムスタンプを持たず、Drive標準の
 *          createdTime を利用する（常に正確・管理不要なため）。
 *
 * 【効率化について】
 *   旧バージョンは「楽曲ごとのフォルダ」を毎回名前検索し、無ければ作成する
 *   という処理をアップロードのたびに行っていたため、Drive APIの呼び出しが
 *   楽曲数に比例して増えていた。
 *   新バージョンは1つの results フォルダに全画像をまとめ、
 *   フォルダIDをセッション内でキャッシュすることで、
 *   一覧取得は「フォルダ検索 + ファイル一覧取得」の実質2回程度の通信で完了し、
 *   アップロード時も毎回のフォルダ検索が不要になる。
 * ---------------------------------------------------------------------------
 */
const DriveStorage = (() => {

  let resultsFolderCache = null;

  function resetCache() { resultsFolderCache = null; }

  function _escapeQuote(s) { return String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'"); }

  async function fetchAllDriveItems(query, fields) {
    let items = [];
    let pageToken = null;
    do {
      const response = await gapi.client.drive.files.list({
        q: query, fields: `nextPageToken, files(${fields})`, pageSize: 1000, pageToken,
      });
      if (response.result.files) items = items.concat(response.result.files);
      pageToken = response.result.nextPageToken;
    } while (pageToken);
    return items;
  }

  async function getFolderByName(name, parentId = null) {
    let query = `mimeType = 'application/vnd.google-apps.folder' and name = '${_escapeQuote(name)}' and trashed = false`;
    if (parentId) query += ` and '${parentId}' in parents`;
    const response = await gapi.client.drive.files.list({ q: query, fields: 'files(id, name)', pageSize: 1 });
    return (response.result.files && response.result.files.length > 0) ? response.result.files[0] : null;
  }

  async function findOrCreateFolder(name, parentId = null) {
    const existing = await getFolderByName(name, parentId);
    if (existing) return existing;
    const metadata = { name, mimeType: 'application/vnd.google-apps.folder' };
    if (parentId) metadata.parents = [parentId];
    const response = await gapi.client.drive.files.create({ resource: metadata, fields: 'id, name' });
    return response.result;
  }

  async function ensureResultsFolder() {
    if (resultsFolderCache) return resultsFolderCache;
    const root = await findOrCreateFolder(Config.ROOT_FOLDER_NAME);
    const results = await findOrCreateFolder(Config.RESULTS_FOLDER_NAME, root.id);
    resultsFolderCache = results;
    return results;
  }

  function buildFileName(data, ext) {
    const code = Config.codeFromKey(data.diffKey) || 'XX';
    const title = Utils.sanitizeForFileName(data.title) || '名称未設定';
    const level = data.level || '0';
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const ts = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}${pad(now.getMilliseconds()).slice(0, 2)}`;
    return `${level}${code}_${title}_${ts}.${ext || 'jpg'}`;
  }

  function buildAppProperties(data) {
    const perfect = parseInt(data.perfect, 10) || 0;
    const great = parseInt(data.great, 10) || 0;
    const good = parseInt(data.good, 10) || 0;
    const bad = parseInt(data.bad, 10) || 0;
    const miss = parseInt(data.miss, 10) || 0;
    const missCount = good + bad + miss;
    return {
      schemaVersion: '2',
      musicId: data.musicId != null ? String(data.musicId) : '',
      level: String(data.level || ''),
      diff: Config.codeFromKey(data.diffKey) || '',
      perfect: String(perfect),
      great: String(great),
      good: String(good),
      bad: String(bad),
      miss: String(miss),
      missCount: String(missCount),
      combo: String(parseInt(data.combo, 10) || 0),
      isFC: missCount === 0 ? '1' : '0',
    };
  }

  // ファイル名は補助的な手掛かりとしてのみ使用（曲名のフォールバック用）
  function parseFileName(name) {
    if (!name) return null;
    const m = name.match(/^(\d+)([A-Z]{2})_(.+)_\d{8}-\d{6,8}\.[a-zA-Z0-9]+$/);
    if (!m) return null;
    return { level: parseInt(m[1], 10), diffCode: m[2], title: m[3] };
  }

  function parseDriveFile(file) {
    const props = file.appProperties || {};
    const parsedName = parseFileName(file.name);

    const diffCode = props.diff || (parsedName && parsedName.diffCode) || 'MS';
    const diffKey = Config.keyFromCode(diffCode) || 'master';

    const perfect = parseInt(props.perfect, 10) || 0;
    const great = parseInt(props.great, 10) || 0;
    const good = parseInt(props.good, 10) || 0;
    const bad = parseInt(props.bad, 10) || 0;
    const miss = parseInt(props.miss, 10) || 0;
    const missCount = props.missCount !== undefined && props.missCount !== ''
      ? (parseInt(props.missCount, 10) || 0)
      : (good + bad + miss);
    const combo = parseInt(props.combo, 10) || 0;
    const level = parseInt(props.level || (parsedName && parsedName.level), 10) || 0;

    let musicId = null;
    if (props.musicId) {
      const n = Number(props.musicId);
      musicId = isNaN(n) ? props.musicId : n;
    }

    const title = (parsedName && parsedName.title)
      || (musicId != null && MusicDB.getTitleById(musicId))
      || '(不明な楽曲)';

    const createdTimestamp = file.createdTime ? new Date(file.createdTime).getTime() : Date.now();

    return {
      id: file.id,
      title,
      level,
      difficultyKey: diffKey,
      difficultyLabel: Config.labelFromKey(diffKey),
      diffCode: Config.codeFromKey(diffKey),
      perfect, great, good, bad, miss, missCount, combo,
      isFC: missCount === 0,
      musicId,
      thumbnail: file.thumbnailLink || null,
      createdTime: file.createdTime,
      createdTimestamp,
      raw: file,
    };
  }

  async function listAllResults() {
    const folder = await ensureResultsFolder();
    const fields = 'id, name, thumbnailLink, createdTime, appProperties';
    const query = `'${folder.id}' in parents and trashed = false`;
    const files = await fetchAllDriveItems(query, fields);
    return files.map(parseDriveFile);
  }

  async function uploadResult(file, data) {
    const folder = await ensureResultsFolder();
    const ext = (file.name && file.name.includes('.')) ? file.name.split('.').pop() : 'jpg';
    const name = buildFileName(data, ext);
    const meta = {
      name,
      parents: [folder.id],
      appProperties: buildAppProperties(data),
    };
    const accessToken = gapi.client.getToken().access_token;
    const form = new FormData();
    form.append('metadata', new Blob([JSON.stringify(meta)], { type: 'application/json' }));
    form.append('file', file);

    const res = await fetch(
      'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,thumbnailLink,createdTime,appProperties',
      { method: 'POST', headers: new Headers({ Authorization: 'Bearer ' + accessToken }), body: form }
    );
    if (!res.ok) throw new Error(res.statusText);
    const result = await res.json();
    return parseDriveFile(result);
  }

  async function updateResult(fileId, data) {
    const ext = data.existingExt || 'jpg';
    const name = buildFileName(data, ext);
    const params = {
      fileId,
      resource: { name, appProperties: buildAppProperties(data) },
      fields: 'id, name, thumbnailLink, createdTime, appProperties',
    };
    const res = await gapi.client.drive.files.update(params);
    return parseDriveFile(res.result);
  }

  async function deleteResult(fileId) {
    await gapi.client.drive.files.delete({ fileId });
  }

  async function deleteResults(fileIds) {
    for (const id of fileIds) await deleteResult(id);
  }

  return {
    resetCache, ensureResultsFolder, fetchAllDriveItems, getFolderByName, findOrCreateFolder,
    listAllResults, uploadResult, updateResult, deleteResult, deleteResults,
    parseDriveFile, parseFileName, buildFileName, buildAppProperties,
  };
})();
