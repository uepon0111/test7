/**
 * google-auth.js
 * ---------------------------------------------------------------------------
 * Google OAuth (Google Identity Services) と Drive API (gapi) の初期化、
 * ログイン/ログアウト処理、認証状態に応じたUI切り替えを担当する。
 *
 * gapiLoaded() / gisLoaded() は index.html の <script onload> から
 * グローバル関数として呼ばれるため、window に公開する。
 * ---------------------------------------------------------------------------
 */
const GoogleAuth = (() => {
  let tokenClient = null;
  let gapiInited = false;
  let gisInited = false;
  let signedInCallback = null;
  let signedOutCallback = null;

  function init({ onSignedIn, onSignedOut }) {
    signedInCallback = onSignedIn;
    signedOutCallback = onSignedOut;
  }

  function gapiLoaded() { gapi.load('client', _initializeGapiClient); }

  async function _initializeGapiClient() {
    await gapi.client.init({ apiKey: Config.API_KEY, discoveryDocs: [Config.DISCOVERY_DOC] });
    gapiInited = true;
  }

  function gisLoaded() {
    tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: Config.CLIENT_ID,
      scope: Config.SCOPES,
      callback: '',
    });
    gisInited = true;
  }

  function handleAuthClick() {
    if (!tokenClient) return;
    tokenClient.callback = async (resp) => {
      if (resp.error !== undefined) throw resp;
      setAuthUI(true);
      if (signedInCallback) await signedInCallback();
    };
    if (gapi.client.getToken() === null) tokenClient.requestAccessToken({ prompt: 'consent' });
    else tokenClient.requestAccessToken({ prompt: '' });
  }

  function handleSignoutClick() {
    const token = gapi.client.getToken();
    if (token !== null) {
      google.accounts.oauth2.revoke(token.access_token);
      gapi.client.setToken('');
      setAuthUI(false);
      DriveStorage.resetCache();
      if (signedOutCallback) signedOutCallback();
    }
  }

  function setAuthUI(isLoggedIn) {
    document.getElementById('signout_button').style.display = isLoggedIn ? 'inline-flex' : 'none';
    document.getElementById('upload_button').style.display = isLoggedIn ? 'inline-flex' : 'none';
    document.getElementById('authorize_button').style.display = isLoggedIn ? 'none' : 'inline-flex';
    document.getElementById('auth-status').innerText = isLoggedIn ? 'ログイン済み' : '未ログイン';
  }

  function isReady() { return gapiInited && gisInited; }
  function isSignedIn() { return !!(window.gapi && gapi.client && gapi.client.getToken()); }

  return {
    init, gapiLoaded, gisLoaded, handleAuthClick, handleSignoutClick, setAuthUI,
    isReady, isSignedIn,
  };
})();

// index.html の <script async defer onload="..."> から直接呼ばれるためグローバル公開
function gapiLoaded() { GoogleAuth.gapiLoaded(); }
function gisLoaded() { GoogleAuth.gisLoaded(); }
