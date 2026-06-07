class AuthSystem {
  constructor(apiUrl = 'http://localhost:3001') {
    this.apiUrl = apiUrl;
    this.currentUser = null;
    this.authToken = localStorage.getItem('authToken');
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

      this.authToken = data.token;
      this.currentUser = data.user;
      localStorage.setItem('authToken', this.authToken);
      localStorage.setItem('currentUser', JSON.stringify(this.currentUser));

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

      this.authToken = data.token;
      this.currentUser = data.user;
      localStorage.setItem('authToken', this.authToken);
      localStorage.setItem('currentUser', JSON.stringify(this.currentUser));

      return { success: true, user: data.user };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  // Logout user
  logout() {
    this.authToken = null;
    this.currentUser = null;
    localStorage.removeItem('authToken');
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

  // Check if user is authenticated
  isAuthenticated() {
    return !!this.authToken && !!this.currentUser;
  }

  // Get current user
  getUser() {
    return this.currentUser;
  }

  // Validate token with backend
  async validateToken() {
    if (!this.authToken) return false;

    try {
      const response = await fetch(`${this.apiUrl}/api/auth/validate`, {
        method: 'POST',
        mode: 'cors',
        headers: this.getAuthHeaders()
      });

      return response.ok;
    } catch (error) {
      return false;
    }
  }
}

const auth = new AuthSystem();