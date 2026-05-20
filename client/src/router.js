import { renderAuth } from './pages/Auth.js';
import { renderLibrary } from './pages/Library.js';
import { renderEditor } from './pages/Editor.js';
import { api } from './api/client.js';

const app = document.getElementById('app');

function getRoute() {
  const hash = location.hash || '#/';
  if (hash.startsWith('#/editor/')) return { name: 'editor', partId: hash.split('/')[2] };
  if (hash === '#/library') return { name: 'library' };
  return { name: 'auth' };
}

async function navigate() {
  const route = getRoute();

  // Protect library & editor — redirect to auth if not logged in
  if (route.name !== 'auth') {
    try {
      await api.getMe();
    } catch {
      location.hash = '#/';
      return;
    }
  }

  // If already logged in and on auth page, redirect to library
  if (route.name === 'auth') {
    try {
      await api.getMe();
      location.hash = '#/library';
      return;
    } catch { /* not logged in, show auth */ }
  }

  app.innerHTML = '';
  if (route.name === 'auth') renderAuth(app);
  else if (route.name === 'library') renderLibrary(app);
  else if (route.name === 'editor') renderEditor(app, route.partId);
}

export const router = {
  init() {
    window.addEventListener('hashchange', navigate);
    navigate();
  },
  push(hash) {
    location.hash = hash;
  }
};
