const crypto = require('crypto');
const fs = require('fs');

const HMAC_SECRET = process.env.HMAC_SECRET || 'dev-hmac-secret';

/**
 * Compute SHA-256 hash of a Buffer or file path.
 */
function hashBuffer(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function hashFile(filePath) {
  if (!fs.existsSync(filePath)) return null;
  const buffer = fs.readFileSync(filePath);
  return hashBuffer(buffer);
}

/**
 * Create an HMAC-SHA256 signature over the given fields.
 * This binds partId + file hashes + upload time together.
 */
function sign(partId, stpHash, uploadedAt) {
  const payload = `${partId}:${stpHash}:${uploadedAt}`;
  return crypto.createHmac('sha256', HMAC_SECRET).update(payload).digest('hex');
}

/**
 * Verify signature. Returns true if valid, false if tampered.
 */
function verify(partId, stpHash, uploadedAt, signature) {
  const expected = sign(partId, stpHash, uploadedAt);
  try {
    return crypto.timingSafeEqual(
      Buffer.from(expected, 'hex'),
      Buffer.from(signature, 'hex')
    );
  } catch {
    return false;
  }
}

module.exports = { hashBuffer, hashFile, sign, verify };
