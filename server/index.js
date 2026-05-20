require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

const { initDB } = require('./db');
const authRoutes = require('./routes/auth');
const libraryRoutes = require('./routes/library');
const camRoutes = require('./routes/cam');

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors({
  origin: process.env.CLIENT_ORIGIN || 'http://localhost:5173',
  credentials: true
}));
app.use(express.json({ limit: '10mb' }));

// Serve thumbnails as static files
app.use('/storage', express.static(path.join(__dirname, '../storage')));

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/parts', libraryRoutes);
app.use('/api/cam', camRoutes);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', name: 'infiniCAM', version: '1.0.0' });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
});

// Init DB then start server
initDB();
app.listen(PORT, () => {
  console.log(`\n  🚀 infiniCAM server running on http://localhost:${PORT}\n`);
});
