const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5000;
const JWT_SECRET = process.env.JWT_SECRET || 'parkspot-secret-key';

// Middleware
app.use(cors({
  // Allow requests from any origin in production
  origin: process.env.NODE_ENV === 'production' 
    ? true 
    : ['http://localhost:3000', 'http://localhost:3001', 'http://127.0.0.1:3000', 'http://127.0.0.1:3001'],
  methods: ['GET', 'POST', 'DELETE', 'PUT'],
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
  // Create users table
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    email TEXT UNIQUE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`, (err) => {
    if (err) {
      console.error('Error creating users table:', err);
      process.exit(1);
    }
    console.log('Users table ready');
  });

  // Update parking_spots table to include user_id
  db.run(`CREATE TABLE IF NOT EXISTS parking_spots_new (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    latitude REAL NOT NULL,
    longitude REAL NOT NULL,
    address TEXT,
    notes TEXT,
    imageUri TEXT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
  )`, (err) => {
    if (err) {
      console.error('Error creating new parking spots table:', err);
      process.exit(1);
    }

    // Check if we need to migrate data from old table
    db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='parking_spots'", (err, row) => {
      if (err) {
        console.error('Error checking for old table:', err);
        return;
      }
      
      if (row) {
        // Migrate data - assign all existing spots to user_id 1 (default admin)
        db.run(`INSERT INTO parking_spots_new (user_id, latitude, longitude, address, notes, imageUri, timestamp)
                SELECT 1, latitude, longitude, address, notes, imageUri, timestamp FROM parking_spots`, (err) => {
          if (err) {
            console.error('Error migrating parking data:', err);
            return;
          }
          
          // Drop old table and rename new one
          db.run("DROP TABLE IF EXISTS parking_spots", (err) => {
            if (err) {
              console.error('Error dropping old table:', err);
              return;
            }
            
            db.run("ALTER TABLE parking_spots_new RENAME TO parking_spots", (err) => {
              if (err) {
                console.error('Error renaming table:', err);
                return;
              }
              console.log('Parking spots table migrated successfully');
            });
          });
        });
      } else {
        // If old table doesn't exist, just rename the new one
        db.run("ALTER TABLE parking_spots_new RENAME TO parking_spots", (err) => {
          if (err) {
            console.error('Error renaming table:', err);
            return;
          }
          console.log('Parking spots table ready');
        });
      }
    });
  });

  // Create a default admin user if none exists
  db.get("SELECT * FROM users LIMIT 1", (err, row) => {
    if (err) {
      console.error('Error checking for users:', err);
      return;
    }
    
    if (!row) {
      bcrypt.hash('admin123', 10, (err, hash) => {
        if (err) {
          console.error('Error hashing password:', err);
          return;
        }
        
        db.run("INSERT INTO users (username, password, email) VALUES (?, ?, ?)", 
          ['admin', hash, 'admin@parkspot.com'], (err) => {
          if (err) {
            console.error('Error creating default user:', err);
            return;
          }
          console.log('Default admin user created');
        });
      });
    }
  });
});

// Authentication middleware
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  
  if (!token) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  
  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Invalid or expired token' });
    }
    
    req.user = user;
    next();
  });
};

// API Routes

// User registration
app.post('/api/users/register', (req, res) => {
  const { username, password, email } = req.body;
  
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }
  
  bcrypt.hash(password, 10, (err, hash) => {
    if (err) {
      console.error('Error hashing password:', err);
      return res.status(500).json({ error: 'Server error' });
    }
    
    db.run("INSERT INTO users (username, password, email) VALUES (?, ?, ?)",
      [username, hash, email], function(err) {
      if (err) {
        if (err.message.includes('UNIQUE constraint failed')) {
          return res.status(409).json({ error: 'Username or email already exists' });
        }
        console.error('Error registering user:', err);
        return res.status(500).json({ error: 'Server error' });
      }
      
      const token = jwt.sign({ id: this.lastID, username }, JWT_SECRET, { expiresIn: '7d' });
      
      res.status(201).json({
        message: 'User registered successfully',
        user: { id: this.lastID, username, email },
        token
      });
    });
  });
});

// User login
app.post('/api/users/login', (req, res) => {
  const { username, password } = req.body;
  
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }
  
  db.get("SELECT * FROM users WHERE username = ?", [username], (err, user) => {
    if (err) {
      console.error('Error finding user:', err);
      return res.status(500).json({ error: 'Server error' });
    }
    
    if (!user) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }
    
    bcrypt.compare(password, user.password, (err, result) => {
      if (err) {
        console.error('Error comparing passwords:', err);
        return res.status(500).json({ error: 'Server error' });
      }
      
      if (!result) {
        return res.status(401).json({ error: 'Invalid username or password' });
      }
      
      const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '7d' });
      
      res.json({
        message: 'Login successful',
        user: { id: user.id, username: user.username, email: user.email },
        token
      });
    });
  });
});

// Get current user
app.get('/api/users/me', authenticateToken, (req, res) => {
  db.get("SELECT id, username, email, created_at FROM users WHERE id = ?", [req.user.id], (err, user) => {
    if (err) {
      console.error('Error getting user:', err);
      return res.status(500).json({ error: 'Server error' });
    }
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    res.json(user);
  });
});

// Get current parking spot for authenticated user
app.get('/api/parking-spot', authenticateToken, (req, res) => {
  console.log(`GET /api/parking-spot for user ${req.user.id}`);
  db.get(
    'SELECT * FROM parking_spots WHERE user_id = ? ORDER BY timestamp DESC LIMIT 1',
    [req.user.id],
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

// Save new parking spot for authenticated user
app.post('/api/parking-spot', authenticateToken, (req, res) => {
  console.log(`POST /api/parking-spot for user ${req.user.id}`, req.body);
  const { latitude, longitude, address, notes, imageUri, timestamp } = req.body;
  
  if (!latitude || !longitude) {
    console.error('Missing required fields:', { latitude, longitude });
    res.status(400).json({ error: 'Latitude and longitude are required' });
    return;
  }

  // Clear previous parking spots for this user only
  db.run('DELETE FROM parking_spots WHERE user_id = ?', [req.user.id], (err) => {
    if (err) {
      console.error('Error deleting old parking spots:', err);
      res.status(500).json({ error: err.message });
      return;
    }
    console.log(`Cleared old parking spots for user ${req.user.id}`);

    // Create a current timestamp with timezone offset included
    const now = new Date();
    const currentTimestamp = timestamp || 
      `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')} ${now.toString().match(/\(([^)]+)\)/)[1]}`;
    
    // Insert new parking spot with timestamp
    const query = 'INSERT INTO parking_spots (user_id, latitude, longitude, address, notes, imageUri, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?)';
    const params = [req.user.id, latitude, longitude, address, notes, imageUri, currentTimestamp];
    
    console.log('Executing query:', query, 'with params:', params);
    
    db.run(query, params, function(err) {
      if (err) {
        console.error('Error inserting new parking spot:', err);
        res.status(500).json({ error: err.message });
        return;
      }
      const newSpot = {
        id: this.lastID,
        user_id: req.user.id,
        latitude,
        longitude,
        address,
        notes,
        imageUri,
        timestamp: currentTimestamp,
        message: 'Parking spot saved successfully!'
      };
      console.log('Saved new parking spot:', newSpot);
      res.json(newSpot);
    });
  });
});

// Delete current parking spot for authenticated user
app.delete('/api/parking-spot', authenticateToken, (req, res) => {
  console.log(`DELETE /api/parking-spot for user ${req.user.id}`);
  db.run('DELETE FROM parking_spots WHERE user_id = ?', [req.user.id], function(err) {
    if (err) {
      console.error('Error deleting parking spot:', err);
      res.status(500).json({ error: err.message });
      return;
    }
    console.log(`Deleted parking spot for user ${req.user.id}`);
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