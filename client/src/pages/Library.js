import { api } from '../api/client.js';
import { toast } from '../modules/Toast.js';
import { formatFileSize, formatDate, formatRelativeDate } from '../modules/utils.js';

export function renderLibrary(container, initialFolderId = null) {
  let parts = [];
  let folders = [];
  let currentFolderId = initialFolderId;
  let searchQuery = '';
  let activeTag = null;
  
  async function loadData() {
    try {
      [parts, folders] = await Promise.all([
        api.getParts(),
        api.getFolders()
      ]);
      renderSidebar();
      renderMainGrid();
    } catch (err) {
      toast.error('Failed to load data: ' + err.message);
    }
  }

  function getFolderPath(folderId) {
    if (!folderId) return [];
    const path = [];
    let curr = folders.find(f => f.id === folderId);
    while (curr) {
      path.unshift(curr);
      curr = folders.find(f => f.id === curr.parentId);
    }
    return path;
  }

  function renderSidebar() {
    const sidebar = document.getElementById('library-sidebar-content');
    if (!sidebar) return;

    // Unique tags
    const allTags = [...new Set(parts.flatMap(p => p.tags || []))].sort();

    function renderTree(parentId, level = 0) {
      const children = folders.filter(f => f.parentId === parentId).sort((a,b) => a.name.localeCompare(b.name));
      return children.map(f => `
        <div class="sidebar-item ${currentFolderId === f.id ? 'active' : ''} folder-drop-target" 
             style="padding-left: ${12 + level * 16}px;" 
             data-nav-folder="${f.id}" data-folder-id="${f.id}">
          <span class="sidebar-icon">📁</span> <span class="truncate" style="flex:1;">${f.name}</span>
        </div>
        ${renderTree(f.id, level + 1)}
      `).join('');
    }

    sidebar.innerHTML = `
      <div class="sidebar-section">
        <div class="sidebar-label">Library</div>
        <div class="sidebar-item ${!currentFolderId && !activeTag ? 'active' : ''} folder-drop-target" data-nav-folder="root" data-folder-id="root">
          <span class="sidebar-icon">📦</span> <span style="flex:1;">All Parts (Root)</span>
        </div>
        ${renderTree(null, 1)}
      </div>
      
      ${allTags.length > 0 ? `
        <div class="divider" style="margin:8px 12px;"></div>
        <div class="sidebar-section">
          <div class="sidebar-label">Tags</div>
          ${allTags.map(tag => `
            <div class="sidebar-item ${activeTag === tag ? 'active' : ''}" data-nav-tag="${tag}">
              <span class="sidebar-icon" style="color:var(--accent)">🏷️</span> <span class="truncate">${tag}</span>
            </div>
          `).join('')}
        </div>
      ` : ''}
    `;

    // Attach sidebar events
    sidebar.querySelectorAll('[data-nav-folder]').forEach(el => {
      el.addEventListener('click', () => {
        const target = el.dataset.navFolder === 'root' ? '' : '/' + el.dataset.navFolder;
        location.hash = '#/library' + target;
      });
    });

    sidebar.querySelectorAll('[data-nav-tag]').forEach(el => {
      el.addEventListener('click', () => {
        activeTag = activeTag === el.dataset.navTag ? null : el.dataset.navTag;
        renderSidebar();
        renderMainGrid();
      });
    });

    attachDropTargets(sidebar);
  }

  function renderMainGrid() {
    const grid = document.getElementById('parts-grid');
    const breadcrumbContainer = document.getElementById('breadcrumb-container');
    const libraryCount = document.getElementById('library-count');
    if (!grid) return;

    // Render Breadcrumbs
    const path = getFolderPath(currentFolderId);
    breadcrumbContainer.innerHTML = `
      <div class="breadcrumb">
        <div class="breadcrumb-item" data-nav-bc="root">Library</div>
        ${path.map(f => `
          <div class="breadcrumb-separator">/</div>
          <div class="breadcrumb-item" data-nav-bc="${f.id}">${f.name}</div>
        `).join('')}
        ${activeTag ? `<div class="breadcrumb-separator">/</div><div style="color:var(--accent)">Tag: ${activeTag}</div>` : ''}
      </div>
    `;

    breadcrumbContainer.querySelectorAll('[data-nav-bc]').forEach(el => {
      el.addEventListener('click', () => {
        const target = el.dataset.navBc === 'root' ? '' : '/' + el.dataset.navBc;
        location.hash = '#/library' + target;
      });
    });

    // Filter subfolders and parts
    const subfolders = (searchQuery || activeTag) ? [] : folders.filter(f => f.parentId === currentFolderId).sort((a,b) => a.name.localeCompare(b.name));
    
    let filteredParts = parts;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      filteredParts = parts.filter(p => 
        p.displayName.toLowerCase().includes(q) || 
        p.originalFilename.toLowerCase().includes(q) ||
        (p.tags || []).some(t => t.toLowerCase().includes(q))
      );
    } else if (activeTag) {
      filteredParts = parts.filter(p => (p.tags || []).includes(activeTag));
    } else {
      filteredParts = parts.filter(p => p.folderId === currentFolderId);
    }

    if (subfolders.length === 0 && filteredParts.length === 0) {
      grid.innerHTML = `
        <div class="empty-state" style="grid-column:1/-1;">
          <div class="empty-state-icon">${searchQuery ? '🔍' : '📁'}</div>
          <h3>${searchQuery ? 'No matching results' : 'This folder is empty'}</h3>
          <p>${searchQuery ? 'Try a different search term.' : 'Upload a STEP file or create a subfolder.'}</p>
          ${!searchQuery ? `<button class="btn btn-primary" id="empty-upload-btn">Upload STEP File</button>` : ''}
        </div>
      `;
      document.getElementById('empty-upload-btn')?.addEventListener('click', openUploadModal);
      libraryCount.textContent = '0 items';
      return;
    }

    libraryCount.textContent = `${subfolders.length} folder${subfolders.length !== 1 ? 's' : ''}, ${filteredParts.length} part${filteredParts.length !== 1 ? 's' : ''}`;

    grid.innerHTML = `
      ${subfolders.map(f => `
        <div class="folder-card folder-drop-target fade-in" data-nav-folder="${f.id}" data-folder-id="${f.id}">
          <div style="font-size:3rem; margin-bottom:12px;">📁</div>
          <div class="font-medium text-lg truncate w-full text-center" title="${f.name}">${f.name}</div>
          <button class="btn btn-ghost btn-icon absolute" style="top:8px; right:8px; opacity:0.5;" data-delete-folder="${f.id}">🗑️</button>
        </div>
      `).join('')}
      
      ${filteredParts.map(p => `
        <div class="part-card fade-in" data-id="${p.id}" draggable="true">
          <div class="part-thumb">
            ${p.thumbnailUrl
              ? `<img src="${api.getFileUrl(p.thumbnailUrl)}" alt="${p.displayName}" loading="lazy" />`
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
      `).join('')}
    `;

    // Folder navigation
    grid.querySelectorAll('[data-nav-folder]').forEach(el => {
      el.addEventListener('click', (e) => {
        if (e.target.closest('[data-delete-folder]')) return;
        location.hash = '#/library/' + el.dataset.navFolder;
      });
    });

    // Delete folder
    grid.querySelectorAll('[data-delete-folder]').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (!confirm('Delete this folder? Parts inside will be moved to the root library.')) return;
        try {
          await api.deleteFolder(btn.dataset.deleteFolder);
          await loadData();
          toast.success('Folder deleted');
        } catch (err) {
          toast.error('Failed to delete folder: ' + err.message);
        }
      });
    });

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

      // DRAG START
      card.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('text/plain', card.dataset.id);
        e.dataTransfer.effectAllowed = 'move';
        card.style.opacity = '0.5';
      });
      card.addEventListener('dragend', () => {
        card.style.opacity = '1';
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
          renderSidebar();
          renderMainGrid();
          toast.success('Part deleted');
        } catch (err) {
          toast.error('Delete failed: ' + err.message);
        }
      });
    });

    attachDropTargets(grid);
  }

  function attachDropTargets(containerEl) {
    containerEl.querySelectorAll('.folder-drop-target').forEach(target => {
      target.addEventListener('dragover', (e) => {
        e.preventDefault(); // allow drop
        target.classList.add('drag-over');
      });
      target.addEventListener('dragleave', () => {
        target.classList.remove('drag-over');
      });
      target.addEventListener('drop', async (e) => {
        e.preventDefault();
        target.classList.remove('drag-over');
        const partId = e.dataTransfer.getData('text/plain');
        if (!partId) return; // Ignore file drops here

        const destFolderId = target.dataset.folderId === 'root' ? null : target.dataset.folderId;
        const part = parts.find(p => p.id === partId);
        
        // Prevent moving to same folder
        if (part && part.folderId === destFolderId) return;

        try {
          await api.updatePartFolder(partId, destFolderId);
          if (part) part.folderId = destFolderId;
          renderSidebar();
          renderMainGrid();
          toast.success('Part moved successfully');
        } catch(err) {
          toast.error('Failed to move part: ' + err.message);
        }
      });
    });
  }

  function openNewFolderModal() {
    const name = prompt('Enter new folder name:');
    if (!name || name.trim() === '') return;
    
    api.createFolder(name, currentFolderId).then(() => {
      toast.success('Folder created');
      loadData();
    }).catch(err => {
      toast.error('Failed to create folder: ' + err.message);
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
          <div class="input-group mt-3">
            <label>Tags (comma separated)</label>
            <input class="input" id="modal-tags" type="text" placeholder="e.g. CNC, Urgent, Door" />
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
      e.stopPropagation();
      dropZone.classList.add('drag-over');
    });
    dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
    dropZone.addEventListener('drop', (e) => {
      e.preventDefault();
      e.stopPropagation();
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
      dropZone.style.display = 'none';
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
        const tagsInput = overlay.querySelector('#modal-tags').value.trim();
        const tags = tagsInput ? tagsInput.split(',').map(t => t.trim()).filter(Boolean) : [];
        
        const result = await api.uploadPart(selectedFile, displayName);
        
        // If we uploaded into a folder or added tags, update it immediately
        if (currentFolderId || tags.length > 0) {
          if (currentFolderId) {
            await api.updatePartFolder(result.id, currentFolderId);
          }
          if (tags.length > 0) {
            await api.updatePart(result.id, { tags });
          }
        }

        overlay.remove();
        toast.success('Part uploaded successfully!');
        
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
          <button class="btn btn-secondary" id="new-folder-btn">
            <span>📁</span> New Folder
          </button>
          <button class="btn btn-primary" id="upload-btn">
            <span>＋</span> Upload STEP
          </button>
          <button class="btn btn-ghost btn-icon" id="logout-btn" title="Sign out">⎋</button>
        </div>
      </div>

      <div class="library-body">
        <!-- Sidebar -->
        <div class="library-sidebar" id="library-sidebar-content">
          <!-- Populated dynamically -->
        </div>

        <!-- Main -->
        <div class="library-main">
          <!-- Toolbar -->
          <div class="library-toolbar">
            <div id="breadcrumb-container" class="flex-1"></div>
            <div class="library-search" style="max-width:300px;">
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
  document.getElementById('new-folder-btn').addEventListener('click', openNewFolderModal);

  document.getElementById('logout-btn').addEventListener('click', () => {
    api.logout();
    location.hash = '#/';
  });

  document.getElementById('search-input').addEventListener('input', (e) => {
    searchQuery = e.target.value;
    renderMainGrid();
  });

  // Page-level drag & drop for file upload (not part moving)
  const pageDrop = document.getElementById('page-drop-zone');
  document.addEventListener('dragover', (e) => {
    // Check if dragging a part (string data) or a file
    const isFile = e.dataTransfer.types.includes('Files');
    if (!isFile) return;
    
    e.preventDefault();
    pageDrop.style.borderColor = 'var(--border-accent)';
    pageDrop.style.background = 'var(--accent-dim)';
  });
  document.addEventListener('dragleave', (e) => {
    pageDrop.style.borderColor = 'transparent';
    pageDrop.style.background = '';
  });
  document.addEventListener('drop', (e) => {
    pageDrop.style.borderColor = 'transparent';
    pageDrop.style.background = '';
    const isFile = e.dataTransfer.types.includes('Files');
    if (!isFile) return;
    
    e.preventDefault();
    if (document.querySelector('.overlay')) return; // Prevent double modal

    const f = e.dataTransfer.files[0];
    if (f) {
      openUploadModal();
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

  loadData();
}
