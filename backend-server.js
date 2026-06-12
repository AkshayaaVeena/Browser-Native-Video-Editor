const express = require('express');
const app = express();
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const rateLimit = require('express-rate-limit'); // FIX #6: rate limiting

require('dotenv').config(); // Load environment variables from a .env file

if (!process.env.JWT_SECRET) {
  console.error("FATAL ERROR: JWT_SECRET env variable is not defined.");
  process.exit(1); // Crash immediately in production if insecure
}
const JWT_SECRET = process.env.JWT_SECRET;
const saltRounds = Number(process.env.BCRYPT_SALT_ROUNDS || 10);

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

// FIX #6: Rate limiter — max 20 auth attempts per IP per 15 minutes.
// This prevents brute-force attacks on login and register endpoints.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts, please try again later.' }
});

// Apply rate limiter to all /api/auth routes
app.use('/api/auth/', authLimiter);

// Initialize SQLite DB (file: veo.db)
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

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function normalizeUsername(username) {
  return String(username || '').trim();
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function getBearerToken(req) {
  const header = req.headers.authorization || '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : '';
}

async function hashPassword(password) {
  return await bcrypt.hash(password, saltRounds);
}

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

// FIX #3: Short-lived access token (15 min) + long-lived refresh token (30 days).
// The client calls /api/auth/refresh with the refresh token to get a new access token
// without forcing the user to log in again.
function signAccessToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email, username: user.username },
    JWT_SECRET,
    { expiresIn: '15m' }
  );
}

function signRefreshToken(user) {
  return jwt.sign(
    { id: user.id, sub: 'refresh' },
    JWT_SECRET,
    { expiresIn: '30d' }
  );
}

app.post('/api/auth/register', async (req, res) => {
  try {
    const username = normalizeUsername(req.body.username);
    const email = normalizeEmail(req.body.email);
    const { password } = req.body;

    if (!username || !email || !password) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    if (!isValidEmail(email)) {
      return res.status(400).json({ error: 'Enter a valid email address' });
    }

    if (username.length < 3 || username.length > 32) {
      return res.status(400).json({ error: 'Username must be 3 to 32 characters' });
    }

    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }

    db.get('SELECT id FROM users WHERE email = ?', [email], async (err, row) => {
      if (err) return res.status(500).json({ error: 'Unable to check account availability' });
      
      if (row) {
        return res.status(409).json({ error: 'Email already registered' });
      }

      try {
        const securePasswordHash = await hashPassword(password);

        db.run(
          `INSERT INTO users (email, username, passwordHash) VALUES (?, ?, ?)`,
          [email, username, securePasswordHash],
          function(err) {
            if (err) {
              if (err.message.includes('UNIQUE')) {
                return res.status(409).json({ error: 'Username already taken' });
              }
              return res.status(500).json({ error: 'Unable to create account' });
            }

            const user = { id: this.lastID, email, username };
            // FIX #3: Return both access token and refresh token on register
            const token = signAccessToken(user);
            const refreshToken = signRefreshToken(user);

            res.json({
              success: true,
              token,
              refreshToken,
              user
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
    const email = normalizeEmail(req.body.email);
    const { password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password required' });
    }

    db.get('SELECT * FROM users WHERE email = ?', [email], async (err, user) => {
      if (err) return res.status(500).json({ error: 'Unable to load account' });

      if (!user) {
        return res.status(401).json({ error: 'Invalid email or password' });
      }

      const isPasswordValid = await verifyPassword(password, user.passwordHash);
      if (!isPasswordValid) {
        return res.status(401).json({ error: 'Invalid email or password' });
      }

      // FIX #3: Return both access token and refresh token on login
      const token = signAccessToken(user);
      const refreshToken = signRefreshToken(user);

      res.json({
        success: true,
        token,
        refreshToken,
        user: { id: user.id, email: user.email, username: user.username }
      });
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// FIX #3: Refresh endpoint — accepts a valid refresh token and returns a new access token.
// The client should store the refresh token (e.g. localStorage) and call this endpoint
// when a 401 is received from any protected route, then retry the original request.
app.post('/api/auth/refresh', (req, res) => {
  try {
    const refreshToken = getBearerToken(req);
    if (!refreshToken) {
      return res.status(401).json({ error: 'No refresh token provided' });
    }

    const decoded = jwt.verify(refreshToken, JWT_SECRET);

    // Verify this is actually a refresh token (not an access token being reused)
    if (decoded.sub !== 'refresh') {
      return res.status(401).json({ error: 'Invalid token type' });
    }

    // Look up the user to make sure the account still exists
    db.get('SELECT id, email, username FROM users WHERE id = ?', [decoded.id], (err, user) => {
      if (err) return res.status(500).json({ error: 'Unable to verify account' });
      if (!user) return res.status(401).json({ error: 'Account not found' });

      const newToken = signAccessToken(user);
      res.json({ success: true, token: newToken });
    });
  } catch (error) {
    res.status(401).json({ error: 'Invalid or expired refresh token' });
  }
});

// Validate token endpoint
app.post('/api/auth/validate', (req, res) => {
  try {
    const token = getBearerToken(req);

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
    const token = getBearerToken(req);

    if (!token) {
      return res.status(401).json({ error: 'No token provided' });
    }

    const decoded = jwt.verify(token, JWT_SECRET);

    db.get('SELECT id, email, username, created_at FROM users WHERE id = ?', [decoded.id], (err, user) => {
      if (err) return res.status(500).json({ error: 'Unable to load profile' });
      if (!user) return res.status(404).json({ error: 'User not found' });

      res.json({ success: true, user });
    });
  } catch (error) {
    res.status(401).json({ error: 'Invalid token' });
  }
});

// Logout endpoint
app.post('/api/auth/logout', (req, res) => {
  // Client-side will handle token removal
  res.json({ success: true, message: 'Logged out' });
});

// Start server
const PORT = process.env.PORT || 3001;
if (require.main === module) {
  app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
}

module.exports = { app, db };