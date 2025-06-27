const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors({
  // Allow requests from any origin in production
  origin: process.env.NODE_ENV === 'production' 
    ? true 
    : ['http://localhost:3000', 'http://localhost:3001', 'http://127.0.0.1:3000', 'http://127.0.0.1:3001'],
  methods: ['GET', 'POST', 'DELETE'],
  credentials: true
}));
app.use(bodyParser.json({ limit: '10mb' })); // Increased limit for image URIs

// Database setup
const dbPath = path.join(__dirname, 'parking.db');
console.log('Database path:', dbPath);

const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Error opening database:', err);
    process.exit(1);
  }
  console.log('Connected to SQLite database');
});

// Initialize database
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS parking_spots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    latitude REAL NOT NULL,
    longitude REAL NOT NULL,
    address TEXT,
    notes TEXT,
    imageUri TEXT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
  )`, (err) => {
    if (err) {
      console.error('Error creating table:', err);
      process.exit(1);
    }
    console.log('Parking spots table ready');
  });
});

// API Routes

// Get current parking spot
app.get('/api/parking-spot', (req, res) => {
  console.log('GET /api/parking-spot');
  db.get(
    'SELECT * FROM parking_spots ORDER BY timestamp DESC LIMIT 1',
    (err, row) => {
      if (err) {
        console.error('Error getting parking spot:', err);
        res.status(500).json({ error: err.message });
        return;
      }
      console.log('Retrieved parking spot:', row);
      res.json(row || null);
    }
  );
});

// Save new parking spot
app.post('/api/parking-spot', (req, res) => {
  console.log('POST /api/parking-spot', req.body);
  const { latitude, longitude, address, notes, imageUri } = req.body;
  
  if (!latitude || !longitude) {
    console.error('Missing required fields:', { latitude, longitude });
    res.status(400).json({ error: 'Latitude and longitude are required' });
    return;
  }

  // Clear previous parking spots (only keep one at a time)
  db.run('DELETE FROM parking_spots', (err) => {
    if (err) {
      console.error('Error deleting old parking spots:', err);
      res.status(500).json({ error: err.message });
      return;
    }
    console.log('Cleared old parking spots');

    // Insert new parking spot
    const query = 'INSERT INTO parking_spots (latitude, longitude, address, notes, imageUri) VALUES (?, ?, ?, ?, ?)';
    const params = [latitude, longitude, address, notes, imageUri];
    console.log('Executing query:', query, 'with params:', params);
    
    db.run(query, params, function(err) {
      if (err) {
        console.error('Error inserting new parking spot:', err);
        res.status(500).json({ error: err.message });
        return;
      }
      const newSpot = {
        id: this.lastID,
        latitude,
        longitude,
        address,
        notes,
        imageUri,
        message: 'Parking spot saved successfully!'
      };
      console.log('Saved new parking spot:', newSpot);
      res.json(newSpot);
    });
  });
});

// Delete current parking spot
app.delete('/api/parking-spot', (req, res) => {
  console.log('DELETE /api/parking-spot');
  db.run('DELETE FROM parking_spots', function(err) {
    if (err) {
      console.error('Error deleting parking spot:', err);
      res.status(500).json({ error: err.message });
      return;
    }
    console.log('Deleted parking spot');
    res.json({ message: 'Parking spot cleared successfully!' });
  });
});

// Health check
app.get('/api/health', (req, res) => {
  console.log('GET /api/health');
  res.json({ status: 'OK', message: 'Parking API is running!' });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error', details: err.message });
});

const server = app.listen(PORT, () => {
  console.log(`🚗 Parking app server running on port ${PORT}`);
});

// Graceful shutdown
process.on('SIGINT', () => {
  server.close(() => {
    db.close((err) => {
      if (err) {
        console.error('Error closing database:', err);
      }
      console.log('Database connection closed.');
      process.exit(0);
    });
  });
}); 