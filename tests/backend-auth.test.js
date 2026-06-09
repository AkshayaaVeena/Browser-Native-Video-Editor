const assert = require('node:assert/strict');
const { test, after } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'video-editor-auth-'));
process.env.JWT_SECRET = 'test-secret-for-auth-routes';
process.env.DATABASE_PATH = path.join(testDir, 'auth-test.db');

const { app, db } = require('../backend-server');

function listen() {
  return new Promise(resolve => {
    const server = app.listen(0, () => resolve(server));
  });
}

function close(server) {
  return new Promise(resolve => server.close(resolve));
}

function closeDb() {
  return new Promise(resolve => db.close(resolve));
}

after(async () => {
  await closeDb();
  fs.rmSync(testDir, { recursive: true, force: true });
});

test('register, login, validate, and profile auth flow', async () => {
  const server = await listen();
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  try {
    const registerRes = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'TestUser',
        email: 'TESTUSER@example.test',
        password: 'Password123'
      })
    });

    assert.equal(registerRes.status, 200);
    const registerBody = await registerRes.json();
    assert.equal(registerBody.success, true);
    assert.equal(registerBody.user.email, 'testuser@example.test');
    assert.ok(registerBody.token);

    const duplicateRes = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'AnotherUser',
        email: 'testuser@example.test',
        password: 'Password123'
      })
    });
    assert.equal(duplicateRes.status, 409);

    const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'testuser@example.test',
        password: 'Password123'
      })
    });

    assert.equal(loginRes.status, 200);
    const loginBody = await loginRes.json();
    assert.equal(loginBody.success, true);

    const validateRes = await fetch(`${baseUrl}/api/auth/validate`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${loginBody.token}` }
    });
    assert.equal(validateRes.status, 200);

    const profileRes = await fetch(`${baseUrl}/api/auth/profile`, {
      headers: { Authorization: `Bearer ${loginBody.token}` }
    });
    assert.equal(profileRes.status, 200);
    const profileBody = await profileRes.json();
    assert.equal(profileBody.user.username, 'TestUser');
  } finally {
    await close(server);
  }
});

test('register rejects invalid input', async () => {
  const server = await listen();
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  try {
    const res = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'ab',
        email: 'not-an-email',
        password: 'short'
      })
    });

    assert.equal(res.status, 400);
  } finally {
    await close(server);
  }
});
