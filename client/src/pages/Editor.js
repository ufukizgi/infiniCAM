import { api } from '../api/client.js';
import { toast } from '../modules/Toast.js';
import { Viewer3D } from '../modules/Viewer3D.js';
import { formatFileSize, formatDate } from '../modules/utils.js';

export async function renderEditor(container, partId) {
  let part = null;
  let viewer = null;
  let activeTab = 'properties';

  // Render the shell immediately
  container.innerHTML = `
    <div class="editor-layout">
      <!-- Topbar -->
      <div class="topbar">
        <div class="breadcrumb">
          <a id="back-to-library">◀ Library</a>
          <span class="breadcrumb-sep">/</span>
          <span class="breadcrumb-current" id="part-name-crumb">Loading…</span>
        </div>
        <div class="flex items-center gap-2">
          <button class="btn btn-secondary" id="btn-analyze" disabled>
            ⚡ Analyze Features
          </button>
          <button class="btn btn-success" id="btn-save-features" style="display:none;">
            💾 Save Features
          </button>
          <button class="btn btn-primary" id="btn-generate" disabled>
            ⚙ Generate G-Code
          </button>
        </div>
      </div>

      <div class="editor-body">
        <!-- Left: Operations panel -->
        <div class="editor-left">
          <div class="editor-left-header">
            <span>Operations</span>
            <span class="badge badge-cyan" id="op-count">0</span>
          </div>
          <div id="operations-list" style="padding:12px; overflow-y:auto; flex:1;">
            <div class="empty-state" style="padding:40px 16px;">
              <div class="empty-state-icon" style="font-size:2rem;">🔍</div>
              <p style="font-size:0.8rem;">Run "Analyze Features" to detect operations automatically.</p>
            </div>
          </div>
        </div>

        <!-- Center: 3D Viewer -->
        <div class="editor-center">
          <div id="viewer-loading" class="viewer-overlay">
            <div class="spinner" style="width:40px;height:40px;border-width:3px;"></div>
            <p class="text-muted text-sm">Loading model…</p>
          </div>
          <canvas id="viewer-canvas" style="display:none;"></canvas>
          <div class="viewer-controls" id="viewer-controls" style="display:none;">
            <button class="btn btn-secondary btn-icon" id="btn-reset-cam" title="Reset camera">🎯</button>
            <button class="btn btn-secondary btn-icon" id="btn-wireframe" title="Toggle wireframe">🔲</button>
          </div>
        </div>

        <!-- Right: Properties / G-code -->
        <div class="editor-right">
          <div class="editor-right-tabs">
            <div class="editor-tab active" data-tab="properties">Properties</div>
            <div class="editor-tab" data-tab="gcode">G-Code</div>
          </div>
          <div class="editor-tab-content" id="tab-content">
            <div class="shimmer" style="height:16px; width:60%; margin-bottom:8px;"></div>
            <div class="shimmer" style="height:12px; width:40%;"></div>
          </div>
        </div>
      </div>

      <!-- Status bar -->
      <div class="status-bar">
        <div class="status-dot"></div>
        <span id="status-text">Loading part…</span>
        <span style="margin-left:auto;" id="status-machine">No machine selected</span>
      </div>
      
      <!-- Bug Report Modal -->
      <div id="bug-modal" class="modal-overlay" style="display:none; position:fixed; top:0; left:0; right:0; bottom:0; background:rgba(0,0,0,0.5); z-index:100; align-items:center; justify-content:center;">
        <div class="modal-content" style="background:var(--bg-1); width:500px; border-radius:var(--r-lg); padding:24px; box-shadow:0 10px 30px rgba(0,0,0,0.5); border:1px solid var(--border);">
          <h3 style="margin-bottom:12px; font-size:1.1rem; color:var(--danger);">Report Incorrect Feature</h3>
          <p style="font-size:0.8rem; color:var(--text-muted); margin-bottom:16px;">Copy the details below and send them to the AI for debugging.</p>
          
          <div class="sidebar-label mb-1">Debug Data</div>
          <textarea id="bug-data" class="input" style="height:250px; font-family:var(--font-mono); font-size:0.75rem; resize:vertical;" readonly></textarea>
          
          <div class="flex justify-end gap-2 mt-4">
            <button class="btn btn-secondary" id="bug-close-btn">Cancel</button>
            <button class="btn btn-primary" id="bug-copy-btn">📋 Copy to Clipboard</button>
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

  document.getElementById('back-to-library').addEventListener('click', () => {
    location.hash = '#/library';
  });

  // Tab switching
  document.querySelectorAll('.editor-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      activeTab = tab.dataset.tab;
      document.querySelectorAll('.editor-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      renderTabContent();
    });
  });

  // Bug modal logic
  window.infinicam_bugs = {};
  
  const bugModal = document.getElementById('bug-modal');
  document.getElementById('bug-close-btn').addEventListener('click', () => {
    bugModal.style.display = 'none';
  });
  document.getElementById('bug-copy-btn').addEventListener('click', () => {
    const dataField = document.getElementById('bug-data');
    navigator.clipboard.writeText(dataField.value);
    toast.success('Bug report copied to clipboard!');
    bugModal.style.display = 'none';
  });
  
  window.toggleBugState = (index, isBug) => {
    window.infinicam_bugs[index] = isBug;
    
    // Update button styles for this row
    const btnOk = document.getElementById(`btn-ok-${index}`);
    const btnBug = document.getElementById(`btn-bug-${index}`);
    const noteContainer = document.getElementById(`bug-note-container-${index}`);
    
    if (isBug) {
      btnBug.style.background = 'var(--danger)';
      btnBug.style.color = '#fff';
      btnOk.style.background = 'transparent';
      btnOk.style.color = 'var(--success)';
      noteContainer.style.display = 'block';
    } else {
      btnOk.style.background = 'var(--success)';
      btnOk.style.color = '#fff';
      btnBug.style.background = 'transparent';
      btnBug.style.color = 'var(--danger)';
      noteContainer.style.display = 'none';
    }
    
    // Check if report button should be visible
    const hasBugs = Object.values(window.infinicam_bugs).includes(true);
    const reportBtn = document.getElementById('generate-report-btn');
    if (reportBtn) {
      reportBtn.style.display = hasBugs ? 'block' : 'none';
    }
  };
  
  window.generateBugReport = () => {
    if (!part || !window.infinicam_features) return;
    
    const buggyFeatures = [];
    Object.keys(window.infinicam_bugs).forEach(idx => {
      if (window.infinicam_bugs[idx]) {
        const feat = JSON.parse(JSON.stringify(window.infinicam_features[idx]));
        const noteInput = document.getElementById(`bug-note-input-${idx}`);
        feat.userNote = noteInput ? noteInput.value : '';
        buggyFeatures.push(feat);
      }
    });
    
    const debugData = {
      filename: part.originalFilename,
      extrusionAxis: window.infinicam_axis || 'Unknown',
      dimensions: part.dimensions || {},
      incorrectFeaturesCount: buggyFeatures.length,
      incorrectFeatures: buggyFeatures
    };
    
    document.getElementById('bug-data').value = JSON.stringify(debugData, null, 2);
    bugModal.style.display = 'flex';
  };

  // Operations List rendering (defined early to avoid async timing issues)
  window.renderOperationsList = () => {
    const opsList = document.getElementById('operations-list');
    const countBadge = document.getElementById('op-count');
    
    const axisInfo = window.infinicam_axis;
    const features = window.infinicam_features || [];
    
    if (countBadge) countBadge.textContent = features.length;
    
    if (!axisInfo) return;
    
    let opsHtml = `
      <div class="mb-4" style="background:var(--bg-3); padding:8px 12px; border-radius:var(--r-md); font-size:0.8rem;">
        <div style="color:var(--text-muted); font-size:0.7rem; text-transform:uppercase; margin-bottom:4px;">Extrusion Axis</div>
        <div class="flex items-center gap-2">
          <span class="badge badge-cyan">${axisInfo.name || 'Unknown'}</span>
          <span style="font-family:var(--font-mono); color:var(--text-3);">[${axisInfo.vector ? axisInfo.vector.join(', ') : '?'}]</span>
        </div>
      </div>
    `;
    
    if (features.length === 0) {
      opsHtml += `
        <div class="empty-state" style="padding:20px 10px;">
          <div class="empty-state-icon" style="font-size:1.5rem;">✨</div>
          <p style="font-size:0.8rem;">No machining features detected.</p>
        </div>
      `;
    } else {
      opsHtml += '<div class="flex-col gap-2">';
      features.forEach((feat, i) => {
        let icon = '⚙️';
        let details = '';
        if (feat.type === 'drill') {
          icon = '🕳️';
          details = `Ø${(feat.radius * 2).toFixed(1)} x ${feat.depth.toFixed(1)}mm`;
        } else if (feat.type === 'slot') {
          icon = '🔲';
          details = `${feat.width.toFixed(1)} x ${feat.length.toFixed(1)} x ${feat.depth.toFixed(1)}mm`;
        } else if (feat.type === 'pocket') {
          icon = '🧊';
          details = `Pocket: ${feat.width.toFixed(1)} x ${feat.length.toFixed(1)} x ${feat.depth.toFixed(1)}mm (R${feat.radius.toFixed(1)})`;
        } else if (feat.type === 'cut_angled' || feat.type === 'cut') {
          icon = '📐';
          details = `Angled Saw Cut (Area: ${feat.area || 'N/A'})`;
        } else if (feat.type === 'cut_flat') {
          icon = '🔪';
          details = `Flat End Cut (Area: ${feat.area || 'N/A'})`;
        }
        let unmilleableWarning = '';
        if ((feat.type === 'pocket' || feat.type === 'contour' || feat.type === 'slot') && (!feat.radius || feat.radius < 0.001)) {
          unmilleableWarning = `<span title="Sharp Corner, Unmilleable" style="cursor:help; color:var(--danger); font-size:1.1em;">❗</span>`;
        }

        opsHtml += `
          <div style="background:var(--bg-1); border:1px solid var(--border); padding:10px; border-radius:var(--r-md); transition:border-color 0.2s;" onmouseover="this.style.borderColor='var(--primary)'" onmouseout="this.style.borderColor='var(--border)'">
            <div class="flex items-center justify-between mb-1">
              <div class="flex items-center gap-2" style="cursor:pointer;" onclick="if(window.viewer) window.viewer.highlightFeature(window.infinicam_features[${i}])">
                <span>${icon}</span>
                <div class="flex items-center gap-1">
                  <span style="font-weight:600; font-size:0.85rem; text-transform:capitalize;">${feat.type.replace('_', ' ')} OP ${i+1}</span>
                  ${unmilleableWarning}
                </div>
              </div>
              <div class="flex items-center gap-1">
                <button id="btn-ok-${i}" class="btn btn-icon" style="padding:2px 6px; font-size:0.75rem; background:transparent; color:var(--success); border:1px solid var(--success); transition:all 0.2s;" onclick="window.toggleBugState(${i}, false)" title="Mark as Correct">✔</button>
                <button id="btn-bug-${i}" class="btn btn-icon" style="padding:2px 6px; font-size:0.75rem; background:transparent; color:var(--danger); border:1px solid var(--danger); transition:all 0.2s;" onclick="window.toggleBugState(${i}, true)" title="Report Incorrect">❌</button>
              </div>
            </div>
            <div style="font-family:var(--font-mono); font-size:0.75rem; color:var(--text-muted); cursor:pointer;" onclick="if(window.viewer) window.viewer.highlightFeature(window.infinicam_features[${i}])">
              ${details}
            </div>
            <div style="font-family:var(--font-mono); font-size:0.7rem; color:var(--text-3); margin-top:4px;">
              Pos: [${feat.position ? feat.position.join(', ') : '?'}]
            </div>
            <div id="bug-note-container-${i}" style="display:none; margin-top:8px;">
              <input type="text" id="bug-note-input-${i}" class="input" placeholder="Type a note (e.g., this is a slot)" style="font-size:0.75rem; padding:4px 8px; width:100%;" />
            </div>
          </div>
        `;
      });
      
      opsHtml += `
        <button id="generate-report-btn" class="btn btn-danger" style="display:none; width:100%; margin-top:16px;" onclick="window.generateBugReport()">
          📋 Generate Error Report
        </button>
      `;
      
      opsHtml += '</div>';
    }
    
    opsList.innerHTML = opsHtml;
  };

  // Load part data
  try {
    const [partData, foldersData, annotationsData] = await Promise.all([
      api.getPart(partId),
      api.getFolders(),
      api.getAnnotations(partId).catch(() => null)
    ]);
    part = partData;
    
    let pathHtml = '';
    if (part.folderId) {
      let curr = foldersData.find(f => f.id === part.folderId);
      const pathArr = [];
      while (curr) {
        pathArr.unshift(curr);
        curr = foldersData.find(f => f.id === curr.parentId);
      }
      pathHtml = pathArr.map(f => `<span class="breadcrumb-sep" style="opacity:0.5;margin:0 8px;">/</span><a href="#/library/${f.id}" style="cursor:pointer; transition:color 0.2s;">${f.name}</a>`).join('');
    }

    const breadcrumb = document.querySelector('.breadcrumb');
    breadcrumb.innerHTML = `
      <a href="#/library" style="cursor:pointer; transition:color 0.2s;">◀ Library</a>
      ${pathHtml}
      <span class="breadcrumb-sep" style="opacity:0.5;margin:0 8px;">/</span>
      <span class="breadcrumb-current" id="part-name-crumb" style="color:var(--text-1);">${part.displayName}</span>
    `;

    document.getElementById('status-text').textContent = part.displayName;
    
    // Load existing annotations if available
    if (annotationsData && annotationsData.annotations && annotationsData.annotations.length > 0) {
      window.infinicam_features = annotationsData.annotations;
      window.infinicam_axis = annotationsData.extrusion_axis;
      window.infinicam_bugs = {};
      
      // If we have an SVG thumbnail, load it to display in properties
      if (part.hasThumbnail === 2 && part.thumbnailUrl) {
        try {
          const svgText = await fetch(api.getFileUrl(part.thumbnailUrl)).then(r => r.text());
          window.infinicam_svg = svgText;
        } catch (e) { console.error('Failed to load SVG thumbnail', e); }
      }
      
      // Delay render until the function is defined (it's defined further down)
      setTimeout(() => window.renderOperationsList(), 0);
    }
    
    renderTabContent();
  } catch (err) {
    toast.error('Failed to load part: ' + err.message);
    setTimeout(() => { location.hash = '#/library'; }, 1500);
    return;
  }

  // Initialize 3D viewer
  const canvas = document.getElementById('viewer-canvas');

  try {
    viewer = new Viewer3D(canvas);
    window.viewer = viewer; // Expose to global scope for inline onclick handlers
    
    // Auto-dispose viewer when Editor is removed from DOM
    const editorLayout = container.firstElementChild;
    const observer = new MutationObserver(() => {
      if (!document.body.contains(editorLayout)) {
        viewer.dispose();
        observer.disconnect();
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });

    const stpUrl = api.getStpUrl(partId);

    await viewer.loadSTP(stpUrl, (msg) => {
      const loadingMsg = document.querySelector('#viewer-loading p');
      if (loadingMsg) loadingMsg.textContent = msg;
    });

    const loadingOverlay = document.getElementById('viewer-loading');
    if (loadingOverlay) loadingOverlay.style.display = 'none';
    if (canvas) canvas.style.display = 'block';
    
    const controlsMenu = document.getElementById('viewer-controls');
    if (controlsMenu) controlsMenu.style.display = 'flex';
    
    const statusText = document.getElementById('status-text');
    if (statusText) statusText.textContent = `${part.displayName} — Ready`;

    // Capture thumbnail after render
    setTimeout(async () => {
      try {
        const blob = await viewer.captureScreenshot();
        if (blob && !part.thumbnailUrl) {
          await api.uploadThumbnail(partId, blob);
        }
      } catch { /* thumbnail is non-critical */ }
    }, 1000);

    // Viewer control buttons
    const btnReset = document.getElementById('btn-reset-cam');
    if (btnReset) btnReset.addEventListener('click', () => viewer.resetCamera());
    
    const btnWire = document.getElementById('btn-wireframe');
    if (btnWire) btnWire.addEventListener('click', () => viewer.toggleWireframe());

  } catch (err) {
    if (err.message === 'Disposed') return; // Ignore intentional disposal
    console.error('Viewer error:', err);
    const loadingOverlay = document.getElementById('viewer-loading');
    if (loadingOverlay) {
      loadingOverlay.innerHTML = `
        <div style="text-align:center; padding:24px;">
          <div style="font-size:2rem; margin-bottom:12px;">⚠️</div>
          <p class="text-muted text-sm">Could not load 3D model.<br/>${err.message}</p>
        </div>
      `;
    }
  }


  // Analyze button
  document.getElementById('btn-analyze').disabled = false;
  document.getElementById('btn-analyze').addEventListener('click', async () => {
    const btn = document.getElementById('btn-analyze');
    const opsList = document.getElementById('operations-list');
    
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner" style="width:14px;height:14px;border-width:2px;"></span> Analyzing...';
    
    try {
      const data = await api.analyze(partId);
      
      toast.success('Analysis complete. Please save if correct.');
      
      // Extract features and SVG
      window.infinicam_axis = data.extrusion_axis;
      window.infinicam_features = data.features || [];
      if (data.cross_section_svg) {
        window.infinicam_svg = data.cross_section_svg;
      }
      window.infinicam_bugs = {}; // Reset bugs
      
      // Force re-render of active tab to show SVG
      if (typeof renderTabContent === 'function') renderTabContent();
      
      // Render operations list
      window.renderOperationsList();
      
      // Show save button
      document.getElementById('btn-save-features').style.display = 'inline-flex';
      
    } catch (err) {
      toast.error(err.message);
      opsList.innerHTML = `
        <div class="empty-state" style="padding:20px 10px; color:var(--danger);">
          <div class="empty-state-icon" style="font-size:1.5rem;">⚠️</div>
          <p style="font-size:0.8rem;">Analysis failed.</p>
        </div>
      `;
    } finally {
      btn.disabled = false;
      btn.innerHTML = '⚡ Analyze Features';
    }
  });

  // Save Features button
  document.getElementById('btn-save-features').addEventListener('click', async () => {
    const btn = document.getElementById('btn-save-features');
    btn.disabled = true;
    btn.innerHTML = 'Saving...';
    
    try {
      await api.saveAnnotations(partId, {
        version: 1,
        extrusion_axis: window.infinicam_axis,
        annotations: window.infinicam_features
      });
      toast.success('Features saved successfully');
      btn.style.display = 'none'; // Hide after successful save
    } catch (err) {
      toast.error('Failed to save features');
    } finally {
      btn.disabled = false;
      btn.innerHTML = '💾 Save Features';
    }
  });

  // Generate button (Faz 2 stub)
  document.getElementById('btn-generate').disabled = false;
  document.getElementById('btn-generate').addEventListener('click', () => {
    toast.info('G-code generation coming in next release.');
  });

  function renderTabContent() {
    const content = document.getElementById('tab-content');
    if (!part) return;

    if (activeTab === 'properties') {
      content.innerHTML = `
        <div class="flex-col gap-4 fade-in">
          <div>
            <div class="sidebar-label mb-2">Part Info</div>
            <div class="flex-col gap-2">
              ${row('📄 Filename', part.originalFilename)}
              ${row('📦 Size', formatFileSize(part.fileSize))}
              ${row('📅 Uploaded', formatDate(part.uploadedAt))}
            </div>
          </div>

          <div class="divider"></div>

          <div>
            <div class="sidebar-label mb-2">Display Name</div>
            <input class="input" id="edit-display-name" type="text" value="${part.displayName}" />
            <button class="btn btn-secondary w-full mt-2" id="save-name-btn" style="font-size:0.8rem;padding:7px;">
              Save Name
            </button>
          </div>

          <div class="divider"></div>

          <div>
            <div class="sidebar-label mb-2">Notes</div>
            <textarea class="input" id="edit-notes" rows="4" placeholder="Add notes…" style="resize:vertical;">${part.notes || ''}</textarea>
            <button class="btn btn-secondary w-full mt-2" id="save-notes-btn" style="font-size:0.8rem;padding:7px;">
              Save Notes
            </button>
          </div>

          <div class="divider"></div>

          <div>
            <div class="sidebar-label mb-2">Dimensions (from STP)</div>
            <div id="dimensions-panel">
              ${window.infinicam_svg 
                ? `<div style="width:100%; height:180px; display:flex; align-items:center; justify-content:center; overflow:hidden;">
                     ${window.infinicam_svg}
                   </div>
                   <div style="text-align:center; color:var(--text-muted); font-size:0.75rem; margin-top:8px;">
                     Extrusion Profile Cross-Section
                   </div>
                   <style>#dimensions-panel svg { width:100%; height:100%; object-fit:contain; }</style>`
                : (Object.keys(part.dimensions || {}).length
                    ? Object.entries(part.dimensions).map(([k,v]) => row(k.toUpperCase(), v + ' mm')).join('')
                    : '<p class="text-muted text-sm">Not yet extracted — analyze first.</p>')
              }
            </div>
          </div>
        </div>
      `;

      document.getElementById('save-name-btn').addEventListener('click', async () => {
        const name = document.getElementById('edit-display-name').value.trim();
        if (!name) return;
        try {
          await api.updatePart(partId, { displayName: name });
          part.displayName = name;
          document.getElementById('part-name-crumb').textContent = name;
          toast.success('Name saved');
        } catch { toast.error('Save failed'); }
      });

      document.getElementById('save-notes-btn').addEventListener('click', async () => {
        const notes = document.getElementById('edit-notes').value;
        try {
          await api.updatePart(partId, { notes });
          part.notes = notes;
          toast.success('Notes saved');
        } catch { toast.error('Save failed'); }
      });

    } else if (activeTab === 'gcode') {
      content.innerHTML = `
        <div class="flex-col gap-4 fade-in">
          <p class="text-muted text-sm">G-code generation requires feature analysis. This will be available in Faz 2.</p>
          <div style="background:var(--bg-0); border:1px solid var(--border); border-radius:var(--r-md); padding:16px; font-family:var(--font-mono); font-size:0.75rem; color:var(--text-3); min-height:200px;">
            ; No G-code generated yet.<br/>
            ; Run "Analyze Features" first.
          </div>
          <button class="btn btn-secondary w-full" disabled>
            📥 Download .nc
          </button>
        </div>
      `;
    }
  }

  function row(label, value) {
    return `
      <div class="flex justify-between items-center" style="padding:6px 0; border-bottom:1px solid var(--border);">
        <span class="text-muted text-xs">${label}</span>
        <span class="text-sm font-medium" style="max-width:160px; text-align:right; word-break:break-all;">${value}</span>
      </div>
    `;
  }
}
