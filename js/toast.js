/**
 * toast.js
 * ---------------------------------------------------------------------------
 * 画面内に一時的な通知（トースト）を表示する汎用コンポーネント。
 * 自己ベスト更新時の通知や、各種完了メッセージに使用する。
 * index.html / settings.html の両方から利用可能。
 * ---------------------------------------------------------------------------
 */
const Toast = (() => {
  let container = null;

  function _ensureContainer() {
    container = document.getElementById('toast-container');
    if (!container) {
      container = document.createElement('div');
      container.id = 'toast-container';
      container.className = 'toast-container';
      document.body.appendChild(container);
    }
    return container;
  }

  // type: 'info' | 'success' | 'error'
  function show(message, type = 'info', duration = 5000) {
    const root = _ensureContainer();
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;

    const icon = document.createElement('span');
    icon.className = 'material-symbols-outlined toast-icon';
    icon.textContent = type === 'success' ? 'emoji_events' : (type === 'error' ? 'error' : 'info');

    const msg = document.createElement('span');
    msg.className = 'toast-msg';
    msg.textContent = message; // XSS対策として innerHTML ではなく textContent を使用

    const close = document.createElement('span');
    close.className = 'material-symbols-outlined toast-close';
    close.textContent = 'close';
    close.onclick = () => _dismiss(toast);

    toast.appendChild(icon);
    toast.appendChild(msg);
    toast.appendChild(close);
    root.appendChild(toast);

    // トランジション用に1フレーム後にshowクラスを付与
    requestAnimationFrame(() => requestAnimationFrame(() => toast.classList.add('show')));

    if (duration > 0) setTimeout(() => _dismiss(toast), duration);
    return toast;
  }

  function _dismiss(toast) {
    if (!toast || !toast.parentNode) return;
    toast.classList.remove('show');
    toast.classList.add('hide');
    setTimeout(() => { if (toast.parentNode) toast.remove(); }, 300);
  }

  return { show };
})();
