const express = require('express');
const app = express();
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

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
  res.header('Access-Control-Allow-Origin', '*');
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
const dbFile = path.join(__dirname, 'veo.db');
const db = new sqlite3.Database(dbFile);

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE,
    username TEXT UNIQUE,
    passwordHash TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS token_usage (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    tokens_used INTEGER,
    daily_limit INTEGER,
    used_date TEXT
  )`);
});

// Helper: consume tokens for a user
function consumeTokens(userId, amount) {
  return new Promise((resolve) => {
    db.get('SELECT tokens_used, daily_limit, used_date FROM token_usage WHERE user_id = ?', [userId], (err, row) => {
      if (err) return resolve({ success: false, message: err.message });

      const today = new Date().toISOString().split('T')[0];

      if (!row) {
        // initialize record
        db.run('INSERT INTO token_usage (user_id, tokens_used, daily_limit, used_date) VALUES (?, 0, 1000, ?)', [userId, today], function(insertErr) {
          if (insertErr) return resolve({ success: false, message: insertErr.message });
          return resolve({ success: true, tokens_remaining: 1000 });
        });
        return;
      }

      // reset daily usage if date changed
      if (row.used_date !== today) {
        row.tokens_used = 0;
        db.run('UPDATE token_usage SET tokens_used = 0, used_date = ? WHERE user_id = ?', [today, userId]);
      }

      if (row.tokens_used + amount > row.daily_limit) {
        return resolve({ success: false, message: 'Daily token limit exceeded' });
      }

      const newUsed = row.tokens_used + amount;
      db.run('UPDATE token_usage SET tokens_used = ? WHERE user_id = ?', [newUsed, userId], (updateErr) => {
        if (updateErr) return resolve({ success: false, message: updateErr.message });
        resolve({ success: true, tokens_remaining: row.daily_limit - newUsed });
      });
    });
  });
}

// Helper: get token balance
function getTokenBalance(userId) {
  return new Promise((resolve, reject) => {
    db.get('SELECT tokens_used, daily_limit, used_date FROM token_usage WHERE user_id = ?', [userId], (err, row) => {
      if (err) return reject(err);
      if (!row) return resolve({ tokens_used: 0, daily_limit: 1000 });
      resolve({ tokens_used: row.tokens_used, daily_limit: row.daily_limit });
    });
  });
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
    db.get('SELECT id FROM users WHERE email = ?', [email], (err, row) => {
      if (err) return res.status(500).json({ error: err.message });
      
      if (row) {
        return res.status(409).json({ error: 'Email already registered' });
      }

      // Hash password (in production, use bcrypt)
      const crypto = require('crypto');
      const passwordHash = crypto.createHash('sha256').update(password).digest('hex');

      // Create user
      db.run(
        `INSERT INTO users (email, username, passwordHash) VALUES (?, ?, ?)`,
        [email, username, passwordHash],
        function(err) {
          if (err) {
            if (err.message.includes('UNIQUE')) {
              return res.status(409).json({ error: 'Username already taken' });
            }
            return res.status(500).json({ error: err.message });
          }

          // Generate token
          const jwt = require('jsonwebtoken');
          const token = jwt.sign(
            { id: this.lastID, email, username },
            process.env.JWT_SECRET || 'dev_secret_key',
            { expiresIn: '30d' }
          );

          // Initialize token usage
          const today = new Date().toISOString().split('T')[0];
          db.run(
            `INSERT INTO token_usage (user_id, tokens_used, daily_limit, used_date) VALUES (?, 0, 1000, ?)`,
            [this.lastID, today],
            () => {
              res.json({
                success: true,
                token,
                user: { id: this.lastID, email, username }
              });
            }
          );
        }
      );
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

    db.get('SELECT * FROM users WHERE email = ?', [email], (err, user) => {
      if (err) return res.status(500).json({ error: err.message });

      if (!user) {
        return res.status(401).json({ error: 'Invalid email or password' });
      }

      // Verify password
      const crypto = require('crypto');
      const passwordHash = crypto.createHash('sha256').update(password).digest('hex');

      if (passwordHash !== user.passwordHash) {
        return res.status(401).json({ error: 'Invalid email or password' });
      }

      // Generate token
      const jwt = require('jsonwebtoken');
      const token = jwt.sign(
        { id: user.id, email: user.email, username: user.username },
        process.env.JWT_SECRET || 'dev_secret_key',
        { expiresIn: '30d' }
      );

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

    const jwt = require('jsonwebtoken');
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'dev_secret_key');

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

    const jwt = require('jsonwebtoken');
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'dev_secret_key');

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

// ===== AUTHENTICATION MIDDLEWARE =====

function verifyToken(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '');

  if (!token) {
    return res.status(401).json({ error: 'No token provided' });
  }

  try {
    const jwt = require('jsonwebtoken');
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'dev_secret_key');
    req.user = decoded;
    next();
  } catch (error) {
    res.status(401).json({ error: 'Invalid token' });
  }
}

// Apply middleware to protected routes
app.post('/api/ai/transition', verifyToken, async (req, res) => {
  // Token verified, userId available as req.user.id
  const userId = req.user.id;
  
  try {
    const { transitionType, videoUrl } = req.body;
    
    if (!transitionType || !videoUrl) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const tokenCost = 50;
    const tokenResult = await consumeTokens(userId, tokenCost);
    
    if (!tokenResult.success) {
      return res.status(402).json({ 
        error: tokenResult.message,
        tokens_remaining: 0
      });
    }

    // Rest of transition code...
    const result = {
      success: true,
      transition_type: transitionType,
      status: 'generated',
      tokens_used: tokenCost,
      tokens_remaining: tokenResult.tokens_remaining,
      message: `${transitionType} transition generated successfully`
    };

    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/ai/enhance', verifyToken, async (req, res) => {
  const userId = req.user.id;

  try {
    const { videoUrl } = req.body;
    
    if (!videoUrl) {
      return res.status(400).json({ error: 'Missing videoUrl' });
    }

    const tokenCost = 200;
    const tokenResult = await consumeTokens(userId, tokenCost);
    
    if (!tokenResult.success) {
      return res.status(402).json({ 
        error: tokenResult.message,
        tokens_remaining: 0
      });
    }

    const result = {
      success: true,
      operation: 'auto_enhance',
      status: 'processed',
      tokens_used: tokenCost,
      tokens_remaining: tokenResult.tokens_remaining,
      enhancements: {
        brightness: 1.15,
        contrast: 1.2,
        saturation: 1.15
      },
      message: 'Video enhancement completed'
    };

    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/tokens/balance', verifyToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const balance = await getTokenBalance(userId);
    
    res.json({
      tokens_used: balance.tokens_used,
      tokens_limit: balance.daily_limit,
      tokens_remaining: balance.daily_limit - balance.tokens_used
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Start server
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Server listening on http://localhost:${PORT}`));