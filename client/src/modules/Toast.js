/** Toast notification system */
const DURATION = 4000;

export const toast = {
  success: (msg) => show(msg, 'success', '✅'),
  error:   (msg) => show(msg, 'error',   '❌'),
  info:    (msg) => show(msg, 'info',    'ℹ️'),
  warning: (msg) => show(msg, 'warning', '⚠️'),
};

function show(message, type, icon) {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    document.body.appendChild(container);
  }

  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `<span>${icon}</span><span>${message}</span>`;
  container.appendChild(el);

  setTimeout(() => {
    el.style.animation = 'slideOut 250ms cubic-bezier(0.4,0,0.2,1) forwards';
    el.addEventListener('animationend', () => el.remove());
  }, DURATION);
}
