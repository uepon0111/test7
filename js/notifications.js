// js/notifications.js

const ICONS = {
  success: 'check_circle',
  error:   'error',
  warning: 'warning',
  info:    'info',
  record:  'workspace_premium',
};

export const Notifications = {
  _container: null,

  init() {
    this._container = document.getElementById('notif-container');
  },

  show(msg, type = 'info', duration = 4500) {
    if (!this._container) return;
    const el = document.createElement('div');
    el.className = `notif notif-${type}`;
    el.innerHTML = `
      <span class="material-symbols-outlined notif-icon">${ICONS[type] || 'info'}</span>
      <span class="notif-msg">${msg}</span>
      <button class="notif-close" aria-label="閉じる">
        <span class="material-symbols-outlined">close</span>
      </button>`;

    const close = () => {
      el.classList.add('notif-out');
      setTimeout(() => el.remove(), 280);
    };
    el.querySelector('.notif-close').onclick = close;
    this._container.appendChild(el);
    requestAnimationFrame(() => el.classList.add('notif-in'));
    if (duration > 0) setTimeout(close, duration);
    return el;
  },

  success(msg, d) { return this.show(msg, 'success', d); },
  error(msg, d)   { return this.show(msg, 'error',   d ?? 0); },
  warning(msg, d) { return this.show(msg, 'warning', d); },
  info(msg, d)    { return this.show(msg, 'info',    d); },
  record(msg, d)  { return this.show(msg, 'record',  d ?? 6000); },
};
