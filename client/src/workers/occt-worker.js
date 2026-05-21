/**
 * occt-worker.js — Web Worker for STEP file parsing using occt-import-js (CDN).
 * Classic worker (no type:'module') — importScripts is supported.
 */

let occt = null;
let occtLoading = null;

function loadOcct(baseUrl) {
  if (occt) return Promise.resolve(occt);
  if (occtLoading) return occtLoading;

  occtLoading = new Promise(async (resolve, reject) => {
    try {
      // Ensure baseUrl ends with slash
      const base = baseUrl.endsWith('/') ? baseUrl : baseUrl + '/';
      
      importScripts(base + 'occt-import-js.js');
      
      // Fetch WASM manually to bypass Emscripten's internal path resolution issues
      const wasmResponse = await fetch(base + 'occt-import-js.wasm');
      if (!wasmResponse.ok) {
        throw new Error('Failed to load WASM binary');
      }
      const wasmBinary = await wasmResponse.arrayBuffer();

      occtimportjs({
        wasmBinary: wasmBinary
      }).then(instance => {
        occt = instance;
        resolve(occt);
      }).catch(reject);
    } catch (err) {
      reject(new Error('Failed to load occt-import-js: ' + err.message));
    }
  });

  return occtLoading;
}

self.onmessage = async (e) => {
  const { type, url, token, baseUrl } = e.data;
  if (type !== 'load') return;

  try {
    // Load OCCT (cached after first call)
    const oc = await loadOcct(baseUrl || '/');

    // Notify progress
    self.postMessage({ type: 'progress', message: 'Fetching STEP file…' });

    // Fetch the STP file
    const headers = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const response = await fetch(url, { headers });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const buffer = await response.arrayBuffer();
    const fileBuffer = new Uint8Array(buffer);

    self.postMessage({ type: 'progress', message: 'Parsing STEP geometry…' });

    // Parse STEP geometry directly from buffer
    const result = oc.ReadStepFile(fileBuffer, null);

    if (!result || !result.meshes || result.meshes.length === 0) {
      throw new Error('No geometry found in STEP file. The file may be empty or invalid.');
    }

    self.postMessage({ type: 'progress', message: `Transferring ${result.meshes.length} mesh(es)…` });

    // Build transferable mesh data
    const meshData = {
      meshes: result.meshes.map(m => ({
        vertices: Array.from(m.attributes.position.array),
        normals:  m.attributes.normal ? Array.from(m.attributes.normal.array) : [],
        indices:  m.index             ? Array.from(m.index.array)              : [],
        color:    m.color || null,
      }))
    };

    self.postMessage({ type: 'done', meshData });

  } catch (err) {
    self.postMessage({ type: 'error', error: err.message });
  }
};
