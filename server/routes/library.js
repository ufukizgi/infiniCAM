const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { getDB } = require('../db');
const requireAuth = require('../middleware/auth');
const { uploadSTP, uploadThumbnail } = require('../middleware/upload');
const storage = require('../services/StorageService');
const integrity = require('../services/IntegrityService');

const router = express.Router();
router.use(requireAuth);

// GET /api/parts — list user's parts
router.get('/', (req, res) => {
  try {
    const db = getDB();
    const parts = db.prepare(`
      SELECT id, original_filename, display_name, file_size, dimensions,
             feature_count, tags, notes, has_thumbnail, uploaded_at, updated_at
      FROM parts WHERE user_id = ? ORDER BY updated_at DESC
    `).all(req.userId);

    const result = parts.map(p => ({
      id: p.id,
      originalFilename: p.original_filename,
      displayName: p.display_name,
      fileSize: p.file_size,
      dimensions: JSON.parse(p.dimensions || '{}'),
      featureCount: JSON.parse(p.feature_count || '{}'),
      tags: JSON.parse(p.tags || '[]'),
      notes: p.notes,
      hasThumbnail: p.has_thumbnail,
      uploadedAt: p.uploaded_at,
      updatedAt: p.updated_at,
      thumbnailUrl: p.has_thumbnail
        ? storage.getPublicPath(req.userId, p.id, p.has_thumbnail === 2 ? 'thumbnail.svg' : 'thumbnail.png')
        : null,
    }));

    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch parts' });
  }
});

// GET /api/parts/:id — single part detail
router.get('/:id', (req, res) => {
  try {
    const db = getDB();
    const part = db.prepare(`
      SELECT * FROM parts WHERE id = ? AND user_id = ?
    `).get(req.params.id, req.userId);

    if (!part) return res.status(404).json({ error: 'Part not found' });

    res.json({
      id: part.id,
      originalFilename: part.original_filename,
      displayName: part.display_name,
      fileSize: part.file_size,
      dimensions: JSON.parse(part.dimensions || '{}'),
      featureCount: JSON.parse(part.feature_count || '{}'),
      tags: JSON.parse(part.tags || '[]'),
      notes: part.notes,
      hasThumbnail: part.has_thumbnail,
      stpSha256: part.stp_sha256,
      uploadedAt: part.uploaded_at,
      updatedAt: part.updated_at,
      thumbnailUrl: part.has_thumbnail
        ? storage.getPublicPath(req.userId, part.id, part.has_thumbnail === 2 ? 'thumbnail.svg' : 'thumbnail.png')
        : null,
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch part' });
  }
});

// POST /api/parts/upload — upload new STP file
router.post('/upload', uploadSTP.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file provided' });

    const partId = uuidv4();
    const uploadedAt = new Date().toISOString();
    const originalFilename = req.file.originalname;
    const displayName = req.body.displayName || originalFilename.replace(/\.(stp|step)$/i, '');

    // Save file to disk
    storage.saveFile(req.userId, partId, 'model.stp', req.file.buffer);

    // Compute integrity hash and sign
    const stpHash = integrity.hashBuffer(req.file.buffer);
    const signature = integrity.sign(partId, stpHash, uploadedAt);

    // Save empty .cam.json placeholder
    storage.saveFile(req.userId, partId, 'annotations.cam.json',
      Buffer.from(JSON.stringify({ version: 1, annotations: [] }, null, 2)));

    // Insert into DB
    const db = getDB();
    db.prepare(`
      INSERT INTO parts (id, user_id, original_filename, display_name, file_size,
                         stp_sha256, signature, uploaded_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(partId, req.userId, originalFilename, displayName, req.file.size,
           stpHash, signature, uploadedAt, uploadedAt);

    res.status(201).json({
      id: partId,
      originalFilename,
      displayName,
      fileSize: req.file.size,
      uploadedAt,
    });
  } catch (err) {
    console.error('Upload error:', err);
    res.status(500).json({ error: 'Upload failed' });
  }
});

// PUT /api/parts/:id/thumbnail — save thumbnail from client render
router.put('/:id/thumbnail', uploadThumbnail.single('thumbnail'), (req, res) => {
  try {
    const db = getDB();
    const part = db.prepare('SELECT id FROM parts WHERE id = ? AND user_id = ?')
      .get(req.params.id, req.userId);
    if (!part) return res.status(404).json({ error: 'Part not found' });
    if (!req.file) return res.status(400).json({ error: 'No thumbnail provided' });

    storage.saveFile(req.userId, req.params.id, 'thumbnail.png', req.file.buffer);
    // Don't overwrite if it's already an SVG (has_thumbnail = 2)
    db.prepare('UPDATE parts SET has_thumbnail = 1, updated_at = datetime(\'now\') WHERE id = ? AND has_thumbnail != 2')
      .run(req.params.id);

    res.json({ thumbnailUrl: storage.getPublicPath(req.userId, req.params.id, 'thumbnail.png') });
  } catch (err) {
    res.status(500).json({ error: 'Thumbnail save failed' });
  }
});

// PATCH /api/parts/:id — update display name, tags, notes
router.patch('/:id', (req, res) => {
  try {
    const db = getDB();
    const part = db.prepare('SELECT id FROM parts WHERE id = ? AND user_id = ?')
      .get(req.params.id, req.userId);
    if (!part) return res.status(404).json({ error: 'Part not found' });

    const { displayName, tags, notes } = req.body;
    db.prepare(`
      UPDATE parts SET
        display_name = COALESCE(?, display_name),
        tags = COALESCE(?, tags),
        notes = COALESCE(?, notes),
        updated_at = datetime('now')
      WHERE id = ?
    `).run(
      displayName ?? null,
      tags ? JSON.stringify(tags) : null,
      notes ?? null,
      req.params.id
    );

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Update failed' });
  }
});

// PUT /api/parts/:id/annotations — save .cam.json
router.put('/:id/annotations', (req, res) => {
  try {
    const db = getDB();
    const part = db.prepare('SELECT id, stp_sha256, signature, uploaded_at FROM parts WHERE id = ? AND user_id = ?')
      .get(req.params.id, req.userId);
    if (!part) return res.status(404).json({ error: 'Part not found' });

    const annotations = req.body;
    const buffer = Buffer.from(JSON.stringify(annotations, null, 2));
    storage.saveFile(req.userId, req.params.id, 'annotations.cam.json', buffer);

    const camHash = integrity.hashBuffer(buffer);
    db.prepare('UPDATE parts SET cam_sha256 = ?, updated_at = datetime(\'now\') WHERE id = ?')
      .run(camHash, req.params.id);

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Annotation save failed' });
  }
});

// GET /api/parts/:id/annotations
router.get('/:id/annotations', (req, res) => {
  try {
    const db = getDB();
    const part = db.prepare('SELECT id FROM parts WHERE id = ? AND user_id = ?')
      .get(req.params.id, req.userId);
    if (!part) return res.status(404).json({ error: 'Part not found' });

    const buf = storage.readFile(req.userId, req.params.id, 'annotations.cam.json');
    if (!buf) return res.json({ version: 1, annotations: [] });
    res.json(JSON.parse(buf.toString()));
  } catch (err) {
    res.status(500).json({ error: 'Failed to read annotations' });
  }
});

// GET /api/parts/:id/files/stp — stream the STP file
router.get('/:id/files/stp', (req, res) => {
  try {
    const db = getDB();
    const part = db.prepare('SELECT id, original_filename FROM parts WHERE id = ? AND user_id = ?')
      .get(req.params.id, req.userId);
    if (!part) return res.status(404).json({ error: 'Part not found' });

    const filePath = storage.getFilePath(req.userId, req.params.id, 'model.stp');
    if (!require('fs').existsSync(filePath)) {
      return res.status(404).json({ error: 'STP file not found on disk' });
    }

    // Must use absolute path with res.sendFile
    res.sendFile(require('path').resolve(filePath));
  } catch (err) {
    console.error('STP serve error:', err);
    res.status(500).json({ error: 'Failed to send file' });
  }
});

// DELETE /api/parts/:id
router.delete('/:id', (req, res) => {
  try {
    const db = getDB();
    const part = db.prepare('SELECT id FROM parts WHERE id = ? AND user_id = ?')
      .get(req.params.id, req.userId);
    if (!part) return res.status(404).json({ error: 'Part not found' });

    db.prepare('DELETE FROM parts WHERE id = ?').run(req.params.id);
    storage.deletePartDir(req.userId, req.params.id);

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Delete failed' });
  }
});

module.exports = router;
