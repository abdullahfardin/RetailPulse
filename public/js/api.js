// API Client with automatic JWT handling
const API = {
  getToken() {
    return localStorage.getItem('rp_token');
  },

  setToken(token) {
    localStorage.setItem('rp_token', token);
  },

  getUser() {
    const u = localStorage.getItem('rp_user');
    return u ? JSON.parse(u) : null;
  },

  setUser(user) {
    localStorage.setItem('rp_user', JSON.stringify(user));
  },

  getShop() {
    const s = localStorage.getItem('rp_shop');
    return s ? JSON.parse(s) : null;
  },

  setShop(shop) {
    localStorage.setItem('rp_shop', JSON.stringify(shop));
  },

  clearSession() {
    localStorage.removeItem('rp_token');
    localStorage.removeItem('rp_user');
    localStorage.removeItem('rp_shop');
  },

  async request(endpoint, options = {}) {
    const token = this.getToken();
    const headers = {
      'Content-Type': 'application/json',
      ...options.headers
    };

    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    try {
      const response = await fetch(endpoint, {
        ...options,
        headers
      });

      const data = await response.json();

      // If unauthorized, redirect to login
      if (response.status === 401 || response.status === 403) {
        if (!window.location.pathname.endsWith('login.html')) {
          this.clearSession();
          window.location.href = '/login.html';
        }
      }

      if (!response.ok) {
        throw new Error(data.error || 'Server request failed');
      }

      return data;
    } catch (error) {
      console.error(`API Error on [${options.method || 'GET'} ${endpoint}]:`, error);
      throw error;
    }
  },

  get(endpoint) {
    return this.request(endpoint, { method: 'GET' });
  },

  post(endpoint, body) {
    return this.request(endpoint, {
      method: 'POST',
      body: JSON.stringify(body)
    });
  },

  put(endpoint, body) {
    return this.request(endpoint, {
      method: 'PUT',
      body: JSON.stringify(body)
    });
  },

  delete(endpoint) {
    return this.request(endpoint, { method: 'DELETE' });
  }
};
