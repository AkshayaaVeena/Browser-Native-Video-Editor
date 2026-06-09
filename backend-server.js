const express = require('express');
const app = express();
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const jwt = require('jsonwebtoken');

require('dotenv').config(); // Load environment variables from a .env file

if (!process.env.JWT_SECRET) {
  console.error("FATAL ERROR: JWT_SECRET env variable is not defined.");
  process.exit(1); // Crash immediately in production if insecure
}
const JWT_SECRET = process.env.JWT_SECRET;

// Capture raw body for debugging JSON parse errors
app.use(express.json({
  limit: '1mb',
  verify: (req, res, buf) => {
    try {
      req.rawBody = buf && buf.toString();
    } catch (e) {
      req.rawBody = undefined;
    }
  }
}));

app.use(express.urlencoded({ extended: true }));

app.use((req, res, next) => {
  const allowedOrigins = (process.env.CORS_ORIGIN || 'http://localhost:3001,http://127.0.0.1:3001')
    .split(',')
    .map(origin => origin.trim());
  const requestOrigin = req.headers.origin;

  if (!requestOrigin || allowedOrigins.includes(requestOrigin)) {
    res.header('Access-Control-Allow-Origin', requestOrigin || allowedOrigins[0]);
  }

  res.header('Vary', 'Origin');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }
  next();
});

// Error handler for JSON parse errors from body-parser
app.use((err, req, res, next) => {
  if (err && err.type === 'entity.parse.failed') {
    console.error('JSON parse error on', req.method, req.url);
    console.error('Content-Type:', req.headers['content-type']);
    console.error('Raw body (truncated 2k):', (req.rawBody || '').slice(0, 2048));
    return res.status(400).json({ error: 'Invalid JSON payload' });
  }
  next(err);
});

// Initialize SQLite DB (file: veo.db)
// REPLACE your old dbFile line with this:
const dbFile = process.env.DATABASE_PATH 
  ? path.resolve(process.env.DATABASE_PATH) 
  : path.join(__dirname, 'veo.db');

const db = new sqlite3.Database(dbFile);

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE,
    username TEXT UNIQUE,
    passwordHash TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

});

app.get('/', (req, res) => {
  res.redirect('/video-editor.html');
});

app.use(express.static(__dirname));

const bcrypt = require('bcrypt');
const saltRounds = 10;

// Correctly returning a promise-based string hash
async function hashPassword(password) {
  return await bcrypt.hash(password, saltRounds);
}

// Correctly resolving the comparison asynchronously
async function verifyPassword(password, storedHash) {
  if (!storedHash) return false;
  return await bcrypt.compare(password, storedHash);
}

function signAuthToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email, username: user.username },
    JWT_SECRET,
    { expiresIn: '30d' }
  );
}

app.post('/api/auth/register', async (req, res) => {
  try {
    const { username, email, password } = req.body;

    if (!username || !email || !password) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }

    // Check if user exists
    db.get('SELECT id FROM users WHERE email = ?', [email], async (err, row) => {
      if (err) return res.status(500).json({ error: err.message });
      
      if (row) {
        return res.status(409).json({ error: 'Email already registered' });
      }

      try {
        // Await the generation of your bcrypt hash securely
        const securePasswordHash = await hashPassword(password);

        // Create user
        db.run(
          `INSERT INTO users (email, username, passwordHash) VALUES (?, ?, ?)`,
          [email, username, securePasswordHash],
          function(err) {
            if (err) {
              if (err.message.includes('UNIQUE')) {
                return res.status(409).json({ error: 'Username already taken' });
              }
              return res.status(500).json({ error: err.message });
            }

            const token = signAuthToken({ id: this.lastID, email, username });

            res.json({
              success: true,
              token,
              user: { id: this.lastID, email, username }
            });
          }
        );
      } catch (hashError) {
        res.status(500).json({ error: 'Error processing secure credential creation.' });
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Login endpoint
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password required' });
    }

    db.get('SELECT * FROM users WHERE email = ?', [email], async (err, user) => {
      if (err) return res.status(500).json({ error: err.message });

      if (!user) {
        return res.status(401).json({ error: 'Invalid email or password' });
      }

      // Securely evaluate the asynchronous bcrypt verification 
      const isPasswordValid = await verifyPassword(password, user.passwordHash);
      if (!isPasswordValid) {
        return res.status(401).json({ error: 'Invalid email or password' });
      }

      const token = signAuthToken(user);

      res.json({
        success: true,
        token,
        user: { id: user.id, email: user.email, username: user.username }
      });
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Validate token endpoint
app.post('/api/auth/validate', (req, res) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');

    if (!token) {
      return res.status(401).json({ error: 'No token provided' });
    }

    const decoded = jwt.verify(token, JWT_SECRET);

    res.json({ success: true, user: decoded });
  } catch (error) {
    res.status(401).json({ error: 'Invalid token' });
  }
});

// Get user profile
app.get('/api/auth/profile', (req, res) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');

    if (!token) {
      return res.status(401).json({ error: 'No token provided' });
    }

    const decoded = jwt.verify(token, JWT_SECRET);

    db.get('SELECT id, email, username, created_at FROM users WHERE id = ?', [decoded.id], (err, user) => {
      if (err) return res.status(500).json({ error: err.message });
      if (!user) return res.status(404).json({ error: 'User not found' });

      res.json({ success: true, user });
    });
  } catch (error) {
    res.status(401).json({ error: 'Invalid token' });
  }
});

// Logout endpoint (optional - just for cleanup)
app.post('/api/auth/logout', (req, res) => {
  // Client-side will handle token removal
  res.json({ success: true, message: 'Logged out' });
});

// Start server
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Server listening on http://localhost:${PORT}`));