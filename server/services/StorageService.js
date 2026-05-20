const fs = require('fs');
const path = require('path');

const STORAGE_ROOT = path.join(__dirname, '../../storage');

function getPartDir(userId, partId) {
  return path.join(STORAGE_ROOT, 'users', userId, 'parts', partId);
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function saveFile(userId, partId, filename, buffer) {
  const dir = getPartDir(userId, partId);
  ensureDir(dir);
  const filePath = path.join(dir, filename);
  fs.writeFileSync(filePath, buffer);
  return filePath;
}

function readFile(userId, partId, filename) {
  const filePath = path.join(getPartDir(userId, partId), filename);
  if (!fs.existsSync(filePath)) return null;
  return fs.readFileSync(filePath);
}

function fileExists(userId, partId, filename) {
  return fs.existsSync(path.join(getPartDir(userId, partId), filename));
}

function deletePartDir(userId, partId) {
  const dir = getPartDir(userId, partId);
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
}

function getFilePath(userId, partId, filename) {
  return path.join(getPartDir(userId, partId), filename);
}

// Public URL path (served via express static)
function getPublicPath(userId, partId, filename) {
  return `/storage/users/${userId}/parts/${partId}/${filename}`;
}

module.exports = {
  saveFile,
  readFile,
  fileExists,
  deletePartDir,
  getFilePath,
  getPublicPath,
  getPartDir,
};
