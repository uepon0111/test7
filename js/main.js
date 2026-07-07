import { APP_CONFIG } from './config.js';
import { state } from './state.js';
import { initializeGoogleClient, initializeIdentityClient, hasToken, setLoggedInState } from './drive.js';
import { initializeUi, applyGlobalWindowBindings, refreshView } from './ui.js';
import { showToast } from './utils.js';

function injectScript(src, onload) {
  const existing = document.querySelector(`script[src="${src}"]`);
  if (existing) return existing;
  const script = document.createElement('script');
  script.src = src;
  script.async = true;
  script.defer = true;
  if (typeof onload === 'function') {
    script.addEventListener('load', onload, { once: true });
  }
  document.head.appendChild(script);
  return script;
}

async function loadDatabaseFiles() {
  try {
    const [musicsResp, diffsResp] = await Promise.all([
      fetch('https://sekai-world.github.io/sekai-master-db-diff/musics.json'),
      fetch('https://sekai-world.github.io/sekai-master-db-diff/musicDifficulties.json'),
    ]);
    state.dbMusics = await musicsResp.json();
    state.dbDiffs = await diffsResp.json();
  } catch (error) {
    console.error('DB Error', error);
    showToast('曲データの読み込みに失敗しました', 'error');
  }
}

function wireGoogleApiCallbacks() {
  window.gapiLoaded = async () => {
    try {
      await initializeGoogleClient();
      if (window.gapi?.client?.getToken?.()) {
        await setLoggedInState(true);
      }
    } catch (error) {
      console.error(error);
      showToast('Google API の初期化に失敗しました', 'error');
    }
  };

  window.gisLoaded = () => {
    try {
      initializeIdentityClient();
    } catch (error) {
      console.error(error);
      showToast('Google Identity の初期化に失敗しました', 'error');
    }
  };
}

function wireModalBackdrops() {
  for (const id of ['imageModal', 'batchModal', 'settingsModal']) {
    const modal = document.getElementById(id);
    if (!modal) continue;
    modal.addEventListener('click', (event) => {
      if (event.target !== modal) return;
      if (id === 'imageModal') window.closeImageModal?.();
      if (id === 'batchModal') window.closeBatchModal?.();
      if (id === 'settingsModal') window.closeSettingsModal?.();
    });
  }
}

async function bootstrap() {
  wireGoogleApiCallbacks();
  applyGlobalWindowBindings();
  initializeUi();
  wireModalBackdrops();
  await loadDatabaseFiles();
  refreshView();
  setLoggedInState(false);

  injectScript('https://apis.google.com/js/api.js', () => window.gapiLoaded?.());
  injectScript('https://accounts.google.com/gsi/client', () => window.gisLoaded?.());
}

document.addEventListener('DOMContentLoaded', bootstrap);
