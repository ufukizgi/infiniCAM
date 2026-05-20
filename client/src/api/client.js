// Use Vite's base URL (e.g., /cam/) to construct the API path dynamically
const BASE = import.meta.env.BASE_URL === '/' ? '/api' : `${import.meta.env.BASE_URL}api`;

function getToken() {
  return localStorage.getItem('infinicam_token');
}

function setToken(token) {
  localStorage.setItem('infinicam_token', token);
}

function clearToken() {
  localStorage.removeItem('infinicam_token');
}

async function request(method, path, body, isFormData = false) {
  const headers = {};
  const token = getToken();
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (!isFormData && body) headers['Content-Type'] = 'application/json';

  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: isFormData ? body : (body ? JSON.stringify(body) : undefined),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw Object.assign(new Error(err.error || 'Request failed'), { status: res.status });
  }

  const ct = res.headers.get('content-type') || '';
  if (ct.includes('application/json')) return res.json();
  return res;
}

export const api = {
  // Auth
  register: (email, password, displayName) =>
    request('POST', '/auth/register', { email, password, displayName }).then(d => {
      setToken(d.token); return d;
    }),

  login: (email, password) =>
    request('POST', '/auth/login', { email, password }).then(d => {
      setToken(d.token); return d;
    }),

  logout: () => clearToken(),

  getMe: () => request('GET', '/auth/me'),

  // Parts library
  getParts: () => request('GET', '/parts'),
  getPart: (id) => request('GET', `/parts/${id}`),

  uploadPart: (file, displayName) => {
    const fd = new FormData();
    fd.append('file', file);
    if (displayName) fd.append('displayName', displayName);
    return request('POST', '/parts/upload', fd, true);
  },

  uploadThumbnail: (partId, blob) => {
    const fd = new FormData();
    fd.append('thumbnail', blob, 'thumbnail.png');
    return request('PUT', `/parts/${partId}/thumbnail`, fd, true);
  },

  updatePart: (id, data) => request('PATCH', `/parts/${id}`, data),

  getAnnotations: (id) => request('GET', `/parts/${id}/annotations`),
  saveAnnotations: (id, data) => request('PUT', `/parts/${id}/annotations`, data),

  deletePart: (id) => request('DELETE', `/parts/${id}`),

  getStpUrl: (id) => `${BASE}/parts/${id}/files/stp`,

  // CAM
  getMachines: () => request('GET', '/cam/machines'),
  getMachine: (id) => request('GET', `/cam/machines/${id}`),
  analyze: (partId) => request('POST', `/cam/${partId}/analyze`),
  generateGCode: (partId, config) => request('POST', `/cam/${partId}/generate`, config),
};
