const express = require('express');
const requireAuth = require('../middleware/auth');
const { getDB } = require('../db');
const storage = require('../services/StorageService');
const path = require('path');
const fs = require('fs');

const router = express.Router();
router.use(requireAuth);

// GET /api/machines — list available machine configs
router.get('/machines', (req, res) => {
  try {
    const configDir = path.join(__dirname, '../config/machines');
    if (!fs.existsSync(configDir)) return res.json([]);

    const files = fs.readdirSync(configDir).filter(f => f.endsWith('.json'));
    const machines = files.map(f => {
      try {
        const raw = fs.readFileSync(path.join(configDir, f), 'utf8');
        const cfg = JSON.parse(raw);
        return { id: f.replace('.json', ''), name: cfg.name || f, controller: cfg.controller };
      } catch { return null; }
    }).filter(Boolean);

    res.json(machines);
  } catch (err) {
    res.status(500).json({ error: 'Failed to list machines' });
  }
});

// GET /api/cam/machines/:id — get specific machine config
router.get('/machines/:id', (req, res) => {
  try {
    const configPath = path.join(__dirname, '../config/machines', `${req.params.id}.json`);
    if (!fs.existsSync(configPath)) return res.status(404).json({ error: 'Machine not found' });
    const raw = fs.readFileSync(configPath, 'utf8');
    res.json(JSON.parse(raw));
  } catch (err) {
    res.status(500).json({ error: 'Failed to read machine config' });
  }
});

// POST /api/cam/:partId/analyze — Feature recognition via Python engine
router.post('/:partId/analyze', async (req, res) => {
  const db = getDB();
  const part = db.prepare('SELECT id FROM parts WHERE id = ? AND user_id = ?')
    .get(req.params.partId, req.userId);
  if (!part) return res.status(404).json({ error: 'Part not found' });

  try {
    const filePath = storage.getFilePath(req.userId, req.params.partId, 'model.stp');
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'STP file not found on disk' });
    }

    // Call Python CAM Engine
    const engineUrl = process.env.CAM_ENGINE_URL || 'http://localhost:8000';
    const response = await fetch(`${engineUrl}/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ file_path: filePath })
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('Python CAM Error:', errText);
      return res.status(500).json({ error: 'CAM engine failed: ' + errText });
    }

    const result = await response.json();
    
    // Save features to .cam.json
    const camJsonPath = storage.getFilePath(req.userId, req.params.partId, 'annotations.cam.json');
    const annotations = {
      version: 1,
      extrusion_axis: result.extrusion_axis,
      annotations: result.features || []
    };
    fs.writeFileSync(camJsonPath, JSON.stringify(annotations, null, 2));

    // Save SVG as thumbnail
    if (result.cross_section_svg) {
      storage.saveFile(req.userId, req.params.partId, 'thumbnail.svg', Buffer.from(result.cross_section_svg));
      db.prepare("UPDATE parts SET has_thumbnail = 2, updated_at = datetime('now') WHERE id = ?")
        .run(req.params.partId);
    }

    res.json({
      status: 'success',
      extrusion_axis: result.extrusion_axis,
      features: result.features || []
    });

  } catch (err) {
    console.error('Analyze error:', err);
    res.status(500).json({ error: 'Failed to communicate with CAM engine.' });
  }
});

// POST /api/cam/:partId/generate — stub: G-code generation
router.post('/:partId/generate', (req, res) => {
  const db = getDB();
  const part = db.prepare('SELECT id FROM parts WHERE id = ? AND user_id = ?')
    .get(req.params.partId, req.userId);
  if (!part) return res.status(404).json({ error: 'Part not found' });

  res.json({
    status: 'pending',
    message: 'G-code generation will be available in the next release.',
    gcode: ''
  });
});

module.exports = router;
