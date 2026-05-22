const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { getDB } = require('../db');
const requireAuth = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

// GET /api/folders — list user's folders
router.get('/', (req, res) => {
  try {
    const db = getDB();
    const folders = db.prepare(`
      SELECT id, name, parent_id, created_at
      FROM folders WHERE user_id = ? ORDER BY name ASC
    `).all(req.userId);

    const result = folders.map(f => ({
      id: f.id,
      name: f.name,
      parentId: f.parent_id,
      createdAt: f.created_at
    }));

    res.json(result);
  } catch (err) {
    console.error('Fetch folders error:', err);
    res.status(500).json({ error: 'Failed to fetch folders' });
  }
});

// POST /api/folders — create new folder
router.post('/', (req, res) => {
  try {
    const { name, parentId } = req.body;
    if (!name || name.trim() === '') {
      return res.status(400).json({ error: 'Folder name is required' });
    }

    const folderId = uuidv4();
    const db = getDB();
    
    // Verify parent exists if provided
    if (parentId) {
      const parent = db.prepare('SELECT id FROM folders WHERE id = ? AND user_id = ?').get(parentId, req.userId);
      if (!parent) return res.status(404).json({ error: 'Parent folder not found' });
    }

    db.prepare(`
      INSERT INTO folders (id, user_id, name, parent_id)
      VALUES (?, ?, ?, ?)
    `).run(folderId, req.userId, name.trim(), parentId || null);

    res.status(201).json({
      id: folderId,
      name: name.trim(),
      parentId: parentId || null
    });
  } catch (err) {
    console.error('Create folder error:', err);
    res.status(500).json({ error: 'Failed to create folder' });
  }
});

// PUT /api/folders/:id — rename or move folder
router.put('/:id', (req, res) => {
  try {
    const { name, parentId } = req.body;
    const db = getDB();
    
    const folder = db.prepare('SELECT id FROM folders WHERE id = ? AND user_id = ?').get(req.params.id, req.userId);
    if (!folder) return res.status(404).json({ error: 'Folder not found' });

    // Verify parent exists if provided and is not itself to prevent cycles (basic check)
    if (parentId) {
      if (parentId === req.params.id) return res.status(400).json({ error: 'Folder cannot be its own parent' });
      const parent = db.prepare('SELECT id FROM folders WHERE id = ? AND user_id = ?').get(parentId, req.userId);
      if (!parent) return res.status(404).json({ error: 'Parent folder not found' });
    }

    if (name !== undefined) {
      db.prepare('UPDATE folders SET name = ? WHERE id = ?').run(name.trim(), req.params.id);
    }
    if (parentId !== undefined) {
      // Allow moving to root by passing null
      db.prepare('UPDATE folders SET parent_id = ? WHERE id = ?').run(parentId || null, req.params.id);
    }

    res.json({ success: true });
  } catch (err) {
    console.error('Update folder error:', err);
    res.status(500).json({ error: 'Update failed' });
  }
});

// DELETE /api/folders/:id — delete folder
router.delete('/:id', (req, res) => {
  try {
    const db = getDB();
    const folder = db.prepare('SELECT id FROM folders WHERE id = ? AND user_id = ?').get(req.params.id, req.userId);
    if (!folder) return res.status(404).json({ error: 'Folder not found' });

    // SQLite FOREIGN KEY ON DELETE CASCADE will delete part_folders mapping and subfolders (if we added cascade, wait!)
    // Let's check schema. 
    // folders parent_id has ON DELETE SET NULL. So subfolders become root folders! This is safer than cascading deletion of subfolders.
    // part_folders folder_id has ON DELETE CASCADE. So parts will lose their folder association and become root parts. This is also safe.
    
    db.prepare('DELETE FROM folders WHERE id = ?').run(req.params.id);

    res.json({ success: true });
  } catch (err) {
    console.error('Delete folder error:', err);
    res.status(500).json({ error: 'Delete failed' });
  }
});

module.exports = router;
