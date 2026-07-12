/*
 * auth.js
 * -----------------------------------------------------------------------
 * Google へのログイン/ログアウト処理。ページ移動や再読み込みで
 * ログイン状態が途切れにくいように、短時間だけ有効なアクセストークンを
 * sessionStorage / localStorage の両方に退避して復元します。
 * sessionStorage を優先しつつ、settings.html を別タブで開いた場合でも
 * 元のログイン状態を維持できるようにしています。
 * -----------------------------------------------------------------------
 */

const AUTH_SESSION_KEY = 'prsk_auth_session_v1';

function gapiLoaded() { gapi.load('client', initializeGapiClient); }

async function initializeGapiClient() {
  await gapi.client.init({ apiKey: API_KEY, discoveryDocs: [DISCOVERY_DOC] });
  gapiInited = true;
  tryRestoreAuthSession();
}

function gisLoaded() {
  tokenClient = google.accounts.oauth2.initTokenClient({ client_id: CLIENT_ID, scope: SCOPES, callback: '' });
  gisInited = true;
  tryRestoreAuthSession();
}

function writeAuthSession(storage, value) {
  try {
    storage.setItem(AUTH_SESSION_KEY, JSON.stringify(value));
  } catch (e) {
    console.warn('認証情報の保存に失敗しました', e);
  }
}

function readAuthSession(storage) {
  try {
    const raw = storage.getItem(AUTH_SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !parsed.access_token || !parsed.expires_at) return null;
    if (Date.now() >= parsed.expires_at - 30 * 1000) return null;
    return parsed;
  } catch (e) {
    console.warn('認証情報の復元に失敗しました', e);
    return null;
  }
}

function persistAuthSession(resp) {
  try {
    if (!resp || !resp.access_token) return;
    const expiresInSec = Number(resp.expires_in);
    const expiresAt = Date.now() + (Number.isFinite(expiresInSec) && expiresInSec > 0 ? expiresInSec : 3600) * 1000;
    const payload = {
      access_token: resp.access_token,
      token_type: resp.token_type || 'Bearer',
      expires_at: expiresAt,
    };
    writeAuthSession(sessionStorage, payload);
    writeAuthSession(localStorage, payload);
  } catch (e) {
    console.warn('認証情報の保存に失敗しました', e);
  }
}

function clearPersistedAuthSession() {
  try {
    sessionStorage.removeItem(AUTH_SESSION_KEY);
  } catch (e) {
    console.warn('認証情報の削除に失敗しました', e);
  }
  try {
    localStorage.removeItem(AUTH_SESSION_KEY);
  } catch (e) {
    console.warn('認証情報の削除に失敗しました', e);
  }
}

function loadPersistedAuthSession() {
  return readAuthSession(sessionStorage) || readAuthSession(localStorage);
}

function tryRestoreAuthSession() {
  if (!gapiInited || !gisInited) return false;
  if (gapi.client.getToken()) return true;

  const saved = loadPersistedAuthSession();
  if (!saved) return false;

  gapi.client.setToken({
    access_token: saved.access_token,
    token_type: saved.token_type || 'Bearer',
  });
  setAuthUI(true);
  fetchDataFromDrive();
  return true;
}

function handleAuthClick() {
  tokenClient.callback = async (resp) => {
    if (resp.error !== undefined) throw (resp);
    persistAuthSession(resp);
    setAuthUI(true);
    await fetchDataFromDrive();
  };
  if (gapi.client.getToken() === null) tokenClient.requestAccessToken({ prompt: 'consent' });
  else tokenClient.requestAccessToken({ prompt: '' });
}

function handleSignoutClick() {
  const token = gapi.client.getToken();
  if (token !== null) {
    google.accounts.oauth2.revoke(token.access_token);
    gapi.client.setToken('');
    clearPersistedAuthSession();
    setAuthUI(false);
    document.getElementById('result-count').innerText = 'ログアウトしました';
    document.getElementById('grid').innerHTML = '';
    allRecords = [];
    selectedIds.clear();
    updateSelectionUI();
    resetDriveFolderCache();
    hideNotificationArea();
  }
}

function setAuthUI(isLoggedIn) {
  document.getElementById('signout_button').style.display = isLoggedIn ? 'inline-flex' : 'none';
  document.getElementById('upload_button').style.display = isLoggedIn ? 'inline-flex' : 'none';
  document.getElementById('authorize_button').style.display = isLoggedIn ? 'none' : 'inline-flex';
  document.getElementById('auth-status').innerText = isLoggedIn ? 'ログイン済み' : '未ログイン';
}
