// Authentication logic (Login & Register)
document.addEventListener('DOMContentLoaded', () => {
  // If already logged in, redirect to main application
  if (API.getToken()) {
    window.location.href = '/index.html';
    return;
  }

  const alertBox = document.getElementById('authAlert');
  const formLogin = document.getElementById('formLogin');
  const formRegister = document.getElementById('formRegister');
  const btnFillDemo = document.getElementById('btnFillDemo');

  function showAlert(message, type = 'danger') {
    alertBox.className = `alert alert-${type} py-2 px-3 mb-3`;
    alertBox.textContent = message;
    alertBox.classList.remove('d-none');
  }

  function hideAlert() {
    alertBox.classList.add('d-none');
  }

  // Quick Demo Auto-fill for live assessment demonstration
  if (btnFillDemo) {
    btnFillDemo.addEventListener('click', () => {
      document.getElementById('loginEmail').value = 'owner@retailpulse.com';
      document.getElementById('loginPassword').value = 'password123';
      hideAlert();
      // Switch to login tab if on register
      const loginTab = new bootstrap.Tab(document.getElementById('tab-login'));
      loginTab.show();
    });
  }

  // Handle Login submission
  if (formLogin) {
    formLogin.addEventListener('submit', async (e) => {
      e.preventDefault();
      hideAlert();

      const email = document.getElementById('loginEmail').value.trim();
      const password = document.getElementById('loginPassword').value;
      const submitBtn = document.getElementById('btnLoginSubmit');

      if (!email || !password) {
        showAlert('Please enter both email and password.');
        return;
      }

      submitBtn.disabled = true;
      submitBtn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span> Authenticating...';

      try {
        const res = await API.post('/api/auth/login', { email, password });
        if (res.success && res.token) {
          API.setToken(res.token);
          API.setUser(res.user);
          API.setShop(res.shop);

          showAlert('Login successful! Redirecting...', 'success');
          setTimeout(() => {
            window.location.href = '/index.html';
          }, 600);
        } else {
          showAlert(res.error || 'Login failed. Please check credentials.');
        }
      } catch (err) {
        showAlert(err.message || 'Invalid email or password.');
      } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Sign In to Dashboard';
      }
    });
  }

  // Handle Registration submission
  if (formRegister) {
    formRegister.addEventListener('submit', async (e) => {
      e.preventDefault();
      hideAlert();

      const shop_name = document.getElementById('regShopName').value.trim();
      const name = document.getElementById('regName').value.trim();
      const email = document.getElementById('regEmail').value.trim();
      const password = document.getElementById('regPassword').value;
      const submitBtn = document.getElementById('btnRegisterSubmit');

      if (!shop_name || !name || !email || !password) {
        showAlert('All fields are required.');
        return;
      }

      if (password.length < 6) {
        showAlert('Password must be at least 6 characters.');
        return;
      }

      submitBtn.disabled = true;
      submitBtn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span> Registering...';

      try {
        const res = await API.post('/api/auth/register', {
          shop_name,
          name,
          email,
          password
        });

        if (res.success && res.token) {
          API.setToken(res.token);
          API.setUser(res.user);
          API.setShop(res.shop);

          showAlert('Registration successful! Redirecting...', 'success');
          setTimeout(() => {
            window.location.href = '/index.html';
          }, 600);
        } else {
          showAlert(res.error || 'Registration failed.');
        }
      } catch (err) {
        showAlert(err.message || 'Registration failed.');
      } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Create Account & Shop';
      }
    });
  }
});
