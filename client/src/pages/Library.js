import { api } from '../api/client.js';
import { toast } from '../modules/Toast.js';
import { formatFileSize, formatDate, formatRelativeDate } from '../modules/utils.js';

export function renderLibrary(container) {
  let parts = [];
  let searchQuery = '';
  let isUploading = false;

  async function loadParts() {
    try {
      parts = await api.getParts();
      renderPartGrid();
    } catch (err) {
      toast.error('Failed to load parts: ' + err.message);
    }
  }

  function renderPartGrid() {
    const grid = document.getElementById('parts-grid');
    if (!grid) return;

    const filtered = parts.filter(p =>
      !searchQuery ||
      p.displayName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.originalFilename.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (p.tags || []).some(t => t.toLowerCase().includes(searchQuery.toLowerCase()))
    );

    if (filtered.length === 0) {
      grid.innerHTML = `
        <div class="empty-state" style="grid-column:1/-1;">
          <div class="empty-state-icon">📦</div>
          <h3>${searchQuery ? 'No matching parts' : 'No parts yet'}</h3>
          <p>${searchQuery
            ? 'Try a different search term.'
            : 'Upload your first STEP file to get started.'
          }</p>
          ${!searchQuery ? `<button class="btn btn-primary" id="empty-upload-btn">Upload STEP File</button>` : ''}
        </div>
      `;
      document.getElementById('empty-upload-btn')?.addEventListener('click', openUploadModal);
      document.getElementById('library-count').textContent = '0 parts';
      return;
    }

    document.getElementById('library-count').textContent =
      `${filtered.length} part${filtered.length !== 1 ? 's' : ''}`;

    grid.innerHTML = filtered.map(p => `
      <div class="part-card fade-in" data-id="${p.id}">
        <div class="part-thumb">
          ${p.thumbnailUrl
            ? `<img src="${p.thumbnailUrl}" alt="${p.displayName}" loading="lazy" />`
            : `<div class="part-thumb-placeholder">
                 <span style="font-size:2.5rem">⚙️</span>
                 <span>No preview</span>
               </div>`
          }
        </div>
        <div class="part-card-body">
          <div class="part-name" title="${p.displayName}">${p.displayName}</div>
          <div class="part-meta">
            <span>${formatFileSize(p.fileSize)}</span>
            <span>·</span>
            <span>${formatRelativeDate(p.uploadedAt)}</span>
          </div>
          <div class="flex gap-2 mt-2" style="flex-wrap:wrap;">
            ${(p.tags || []).map(tag =>
              `<span class="badge badge-cyan">${tag}</span>`
            ).join('')}
          </div>
        </div>
        <div class="part-card-actions">
          <button class="btn btn-primary" style="flex:1;padding:7px 12px;font-size:0.8rem;" data-open="${p.id}">
            Open
          </button>
          <button class="btn btn-ghost btn-icon" title="Delete" data-delete="${p.id}" style="color:var(--danger)">
            🗑️
          </button>
        </div>
      </div>
    `).join('');

    // Open part
    grid.querySelectorAll('[data-open]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        location.hash = `#/editor/${btn.dataset.open}`;
      });
    });
    grid.querySelectorAll('.part-card').forEach(card => {
      card.addEventListener('click', (e) => {
        if (e.target.closest('[data-open]') || e.target.closest('[data-delete]')) return;
        location.hash = `#/editor/${card.dataset.id}`;
      });
    });

    // Delete part
    grid.querySelectorAll('[data-delete]').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (!confirm('Delete this part? This cannot be undone.')) return;
        try {
          await api.deletePart(btn.dataset.delete);
          parts = parts.filter(p => p.id !== btn.dataset.delete);
          renderPartGrid();
          toast.success('Part deleted');
        } catch (err) {
          toast.error('Delete failed: ' + err.message);
        }
      });
    });
  }

  function openUploadModal() {
    const overlay = document.createElement('div');
    overlay.className = 'overlay';
    overlay.innerHTML = `
      <div class="modal">
        <h3 style="font-size:1.2rem;font-weight:700;margin-bottom:6px;">Upload STEP File</h3>
        <p class="text-muted text-sm mb-4">Supported formats: .stp, .step — Max 200 MB</p>

        <div class="upload-zone" id="modal-drop-zone">
          <div class="upload-zone-icon">📁</div>
          <h3>Drop your STEP file here</h3>
          <p>or <strong>click to browse</strong></p>
          <input type="file" id="modal-file-input" accept=".stp,.step" style="display:none" />
        </div>

        <div id="modal-file-info" class="hidden" style="margin-top:12px;">
          <div class="flex items-center gap-2 p-3" style="background:var(--bg-3);border-radius:var(--r-sm);">
            <span>📄</span>
            <span id="modal-filename" class="flex-1 truncate text-sm"></span>
            <span id="modal-filesize" class="text-xs text-muted"></span>
          </div>
          <div class="input-group mt-4">
            <label>Display Name (optional)</label>
            <input class="input" id="modal-display-name" type="text" placeholder="e.g. Profile A — Door Frame" />
          </div>
        </div>

        <div id="modal-progress" class="hidden mt-4">
          <div class="flex items-center gap-3 mb-2">
            <div class="spinner"></div>
            <span class="text-sm text-muted">Uploading…</span>
          </div>
          <div class="progress-bar"><div class="progress-fill" style="width:60%"></div></div>
        </div>

        <div class="flex gap-3 mt-6 justify-between">
          <button class="btn btn-ghost" id="modal-cancel">Cancel</button>
          <button class="btn btn-primary" id="modal-upload-btn" disabled>
            Upload
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);
    let selectedFile = null;

    const dropZone = overlay.querySelector('#modal-drop-zone');
    const fileInput = overlay.querySelector('#modal-file-input');
    const fileInfo = overlay.querySelector('#modal-file-info');
    const uploadBtn = overlay.querySelector('#modal-upload-btn');

    dropZone.addEventListener('click', () => fileInput.click());

    dropZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropZone.classList.add('drag-over');
    });
    dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
    dropZone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropZone.classList.remove('drag-over');
      const f = e.dataTransfer.files[0];
      if (f) selectFile(f);
    });

    fileInput.addEventListener('change', () => {
      if (fileInput.files[0]) selectFile(fileInput.files[0]);
    });

    function selectFile(f) {
      const ext = f.name.split('.').pop().toLowerCase();
      if (!['stp', 'step'].includes(ext)) {
        toast.error('Only .stp and .step files are supported');
        return;
      }
      selectedFile = f;
      overlay.querySelector('#modal-filename').textContent = f.name;
      overlay.querySelector('#modal-filesize').textContent = formatFileSize(f.size);
      overlay.querySelector('#modal-display-name').value = f.name.replace(/\.(stp|step)$/i, '');
      fileInfo.classList.remove('hidden');
      uploadBtn.disabled = false;
    }

    overlay.querySelector('#modal-cancel').addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

    uploadBtn.addEventListener('click', async () => {
      if (!selectedFile) return;
      uploadBtn.disabled = true;
      overlay.querySelector('#modal-progress').classList.remove('hidden');

      try {
        const displayName = overlay.querySelector('#modal-display-name').value.trim();
        const result = await api.uploadPart(selectedFile, displayName);
        overlay.remove();
        toast.success('Part uploaded successfully!');
        await loadParts();
        // Open editor to trigger thumbnail generation
        location.hash = `#/editor/${result.id}`;
      } catch (err) {
        toast.error('Upload failed: ' + err.message);
        uploadBtn.disabled = false;
        overlay.querySelector('#modal-progress').classList.add('hidden');
      }
    });
  }

  // Main render
  container.innerHTML = `
    <div class="library-layout">
      <!-- Topbar -->
      <div class="topbar">
        <div class="logo">
          <div class="logo-icon">∞</div>
          <div class="logo-text">infini<span>CAM</span></div>
        </div>
        <div class="flex items-center gap-3">
          <button class="btn btn-primary" id="upload-btn">
            <span>＋</span> Upload STEP
          </button>
          <button class="btn btn-ghost btn-icon" id="logout-btn" title="Sign out">⎋</button>
        </div>
      </div>

      <div class="library-body">
        <!-- Sidebar -->
        <div class="library-sidebar">
          <div class="sidebar-section">
            <div class="sidebar-label">Library</div>
            <div class="sidebar-item active sidebar-icon">
              <span class="sidebar-icon">📦</span> All Parts
            </div>
          </div>
          <div class="divider" style="margin:8px 12px;"></div>
          <div class="sidebar-section">
            <div class="sidebar-label">Coming Soon</div>
            <div class="sidebar-item" style="opacity:0.4;pointer-events:none;">
              <span class="sidebar-icon">📁</span> Folders
            </div>
            <div class="sidebar-item" style="opacity:0.4;pointer-events:none;">
              <span class="sidebar-icon">🏷️</span> Tags
            </div>
          </div>
        </div>

        <!-- Main -->
        <div class="library-main">
          <!-- Toolbar -->
          <div class="library-toolbar">
            <div class="library-search flex-1" style="max-width:360px; position:relative;">
              <input
                class="input"
                id="search-input"
                type="text"
                placeholder="🔍  Search parts by name or tag…"
              />
            </div>
            <div class="library-count" id="library-count">Loading…</div>
          </div>

          <!-- Drop zone hint (when empty) + grid -->
          <div
            id="page-drop-zone"
            style="border:2px dashed transparent; border-radius:var(--r-lg); transition:border-color var(--transition); flex:1;"
          >
            <div class="parts-grid" id="parts-grid">
              <!-- Shimmer cards while loading -->
              ${Array(6).fill(0).map(() => `
                <div style="border-radius:var(--r-lg); overflow:hidden; border:1px solid var(--border);">
                  <div class="shimmer" style="height:160px;"></div>
                  <div style="padding:14px 16px; display:flex; flex-direction:column; gap:8px;">
                    <div class="shimmer" style="height:16px; width:70%;"></div>
                    <div class="shimmer" style="height:12px; width:50%;"></div>
                  </div>
                </div>
              `).join('')}
            </div>
          </div>
        </div>
      </div>
    </div>
  `;

  // Ensure toast container
  if (!document.getElementById('toast-container')) {
    const tc = document.createElement('div');
    tc.id = 'toast-container';
    document.body.appendChild(tc);
  }

  // Events
  document.getElementById('upload-btn').addEventListener('click', openUploadModal);

  document.getElementById('logout-btn').addEventListener('click', () => {
    api.logout();
    location.hash = '#/';
  });

  document.getElementById('search-input').addEventListener('input', (e) => {
    searchQuery = e.target.value;
    renderPartGrid();
  });

  // Page-level drag & drop
  const pageDrop = document.getElementById('page-drop-zone');
  document.addEventListener('dragover', (e) => {
    e.preventDefault();
    pageDrop.style.borderColor = 'var(--border-accent)';
    pageDrop.style.background = 'var(--accent-dim)';
  });
  document.addEventListener('dragleave', () => {
    pageDrop.style.borderColor = 'transparent';
    pageDrop.style.background = '';
  });
  document.addEventListener('drop', (e) => {
    e.preventDefault();
    pageDrop.style.borderColor = 'transparent';
    pageDrop.style.background = '';
    const f = e.dataTransfer.files[0];
    if (f) {
      openUploadModal();
      // Auto-select file after modal opens
      setTimeout(() => {
        const input = document.getElementById('modal-file-input');
        if (input) {
          const dt = new DataTransfer();
          dt.items.add(f);
          input.files = dt.files;
          input.dispatchEvent(new Event('change'));
        }
      }, 50);
    }
  });

  loadParts();
}
