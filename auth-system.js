class AuthSystem {
  constructor(apiUrl = 'http://localhost:3001') {
    this.apiUrl = apiUrl;
    this.currentUser = null;
    this.authToken = localStorage.getItem('authToken');
    // FIX #3: Load the refresh token that was stored on login/register
    this.refreshToken = localStorage.getItem('refreshToken');
    this._refreshPromise = null; // deduplicate concurrent refresh calls
    this.loadUserFromStorage();
  }

  // Register new user
  async register(username, email, password) {
    try {
      const response = await fetch(`${this.apiUrl}/api/auth/register`, {
        method: 'POST',
        mode: 'cors',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, email, password })
      });

      const data = await response.json();

      if (!response.ok) {
        return { success: false, error: data.error || 'Registration failed' };
      }

      this._storeTokens(data.token, data.refreshToken, data.user);
      return { success: true, user: data.user };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  // Login user
  async login(email, password) {
    try {
      const response = await fetch(`${this.apiUrl}/api/auth/login`, {
        method: 'POST',
        mode: 'cors',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });

      const data = await response.json();

      if (!response.ok) {
        return { success: false, error: data.error || 'Login failed' };
      }

      this._storeTokens(data.token, data.refreshToken, data.user);
      return { success: true, user: data.user };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  // Logout user
  logout() {
    this.authToken = null;
    this.refreshToken = null;
    this.currentUser = null;
    localStorage.removeItem('authToken');
    localStorage.removeItem('refreshToken');
    localStorage.removeItem('currentUser');
  }

  // Load user from storage
  loadUserFromStorage() {
    const stored = localStorage.getItem('currentUser');
    if (stored) {
      try {
        this.currentUser = JSON.parse(stored);
      } catch (e) {
        console.error('Error loading user:', e);
      }
    }
  }

  // Get auth headers for API calls
  getAuthHeaders() {
    return {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${this.authToken}`
    };
  }

  // Check if user is authenticated (has tokens + user object in memory)
  isAuthenticated() {
    return !!this.authToken && !!this.currentUser;
  }

  // Get current user
  getUser() {
    return this.currentUser;
  }

  // FIX #3: Silently obtain a new access token using the stored refresh token.
  // Returns true if a new access token was obtained, false if the session is expired.
  // Deduplicates concurrent calls so only one refresh request is in-flight at a time.
  async silentRefresh() {
    if (!this.refreshToken) return false;

    // If a refresh is already in progress, wait for it instead of firing a second one
    if (this._refreshPromise) return this._refreshPromise;

    this._refreshPromise = (async () => {
      try {
        const response = await fetch(`${this.apiUrl}/api/auth/refresh`, {
          method: 'POST',
          mode: 'cors',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.refreshToken}`
          }
        });

        if (!response.ok) {
          // Refresh token itself is expired — force full logout
          this.logout();
          return false;
        }

        const data = await response.json();
        this.authToken = data.token;
        localStorage.setItem('authToken', this.authToken);
        return true;
      } catch {
        return false;
      } finally {
        this._refreshPromise = null;
      }
    })();

    return this._refreshPromise;
  }

  // FIX #3: Validate token with backend; if access token is expired, silently refresh
  // before returning false to the caller, so the page load auth check doesn't
  // kick users out simply because the 15-minute access token expired.
  async validateToken() {
    if (!this.authToken) {
      // No access token — try to recover via refresh token
      return this.silentRefresh();
    }

    try {
      const response = await fetch(`${this.apiUrl}/api/auth/validate`, {
        method: 'POST',
        mode: 'cors',
        headers: this.getAuthHeaders()
      });

      if (response.ok) return true;

      // 401 means the access token is expired — try to silently refresh
      if (response.status === 401) {
        return this.silentRefresh();
      }

      return false;
    } catch {
      return false;
    }
  }

  // FIX #3: Wrapper for authenticated fetch calls that automatically retries once
  // after a silent refresh if the server returns 401. Use this for any API call
  // that requires authentication instead of calling fetch directly.
  async authFetch(url, options = {}) {
    const makeRequest = () => fetch(url, {
      ...options,
      headers: { ...this.getAuthHeaders(), ...(options.headers || {}) }
    });

    let response = await makeRequest();

    if (response.status === 401) {
      const refreshed = await this.silentRefresh();
      if (refreshed) {
        // Retry once with the new access token
        response = await makeRequest();
      } else {
        // Refresh failed — session is gone, redirect to login
        this.logout();
        window.location.href = './login.html';
        return response;
      }
    }

    return response;
  }

  // --- private helpers ---

  _storeTokens(token, refreshToken, user) {
    this.authToken = token;
    // FIX #3: Persist the refresh token so sessions survive page reloads
    // and short-lived (15 min) access tokens can be transparently renewed.
    if (refreshToken) {
      this.refreshToken = refreshToken;
      localStorage.setItem('refreshToken', refreshToken);
    }
    this.currentUser = user;
    localStorage.setItem('authToken', token);
    localStorage.setItem('currentUser', JSON.stringify(user));
  }
}

const auth = new AuthSystem();