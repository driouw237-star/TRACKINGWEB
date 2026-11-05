/* ================================================================
   GlobalExpress — Customer Portal Bootstrap (Supabase Edition)
   ================================================================ */

(function () {
  'use strict';

  function showError(msg) {
    const box = document.getElementById('authError');
    const text = document.getElementById('authErrorText');
    if (!box || !text) return;
    text.textContent = msg;
    box.classList.add('show');
  }

  function hideError() {
    const box = document.getElementById('authError');
    if (box) box.classList.remove('show');
  }

  function switchTab(tab) {
    const isLogin = tab === 'login';
    document.getElementById('tabLogin')?.classList.toggle('active', isLogin);
    document.getElementById('tabSignup')?.classList.toggle('active', !isLogin);
    document.getElementById('loginForm')?.classList.toggle('hidden', !isLogin);
    document.getElementById('signupForm')?.classList.toggle('hidden', isLogin);
    hideError();
  }

  function togglePw(inputId, btn) {
    const input = document.getElementById(inputId);
    if (!input) return;
    const isPw = input.type === 'password';
    input.type = isPw ? 'text' : 'password';
    const icon = btn.querySelector('i');
    if (icon) icon.className = isPw ? 'fas fa-eye-slash' : 'fas fa-eye';
  }

  function showProcessing(title, msg) {
    const box = document.getElementById('processing');
    if (box) {
      document.getElementById('procTitle').textContent = title || 'Processing';
      document.getElementById('procMsg').textContent = msg || 'Please wait…';
      box.classList.add('show');
    }
  }

  function hideProcessing() {
    const box = document.getElementById('processing');
    if (box) box.classList.remove('show');
  }

  // -------------------------------------------------------------
  // LOGIN
  // -------------------------------------------------------------
  async function handleLogin(e) {
    e.preventDefault(); // Stops the URL from getting the password
    hideError();

    const email = (document.getElementById('loginEmail')?.value || '').trim().toLowerCase();
    const password = document.getElementById('loginPassword')?.value || '';

    if (!email || !password) return showError('Please enter your email and password.');

    showProcessing('Signing you in', 'Verifying credentials…');

    try {
      const { data: authData, error: authError } = await window.supabaseClient.auth.signInWithPassword({
        email: email,
        password: password
      });

      if (authError) throw authError;

      const { data: profile, error: profileError } = await window.supabaseClient
        .schema('app')
        .from('users')
        .select('id, email, full_name, role, status')
        .eq('id', authData.user.id)
        .single();

      if (profileError) throw new Error('Could not find user profile.');

      hideProcessing();

      if (profile.role === 'admin' || profile.role === 'super_admin') {
        window.location.href = 'admin.html';
      } else {
        window.location.href = 'app.html';
      }

    } catch (err) {
      hideProcessing();
      showError(err.message || 'Invalid email or password.');
    }
  }

  // -------------------------------------------------------------
  // SIGNUP
  // -------------------------------------------------------------
  async function handleSignup(e) {
    e.preventDefault(); // Stops the URL from getting the password
    hideError();

    const name = (document.getElementById('signupName')?.value || '').trim();
    const email = (document.getElementById('signupEmail')?.value || '').trim().toLowerCase();
    const password = document.getElementById('signupPassword')?.value || '';
    const agreed = document.getElementById('agreeTerms')?.checked;

    if (!name) return showError('Please enter your full name.');
    if (!email || !email.includes('@')) return showError('Please enter a valid email address.');
    if (password.length < 6) return showError('Password must be at least 6 characters.');
    if (!agreed) return showError('You must agree to the Terms.');

    showProcessing('Creating Account', 'Registering with Supabase…');

    try {
      // 1. Create the Auth user in Supabase
      const { data: authData, error: authError } = await window.supabaseClient.auth.signUp({
        email: email,
        password: password,
        options: {
          data: { full_name: name }
        }
      });

      if (authError) throw authError;

      // Note: If email confirmation is OFF, they are logged in immediately.
      // If email confirmation is ON, authData.session will be null.
      
      if (authData.session) {
        // If logged in, redirect to app
        window.location.href = 'app.html';
      } else {
        // If confirmation is required, show a message
        hideProcessing();
        showError('Account created! Please check your email to verify your account before logging in.');
      }

    } catch (err) {
      hideProcessing();
      showError(err.message || 'Failed to create account.');
    }
  }

  // -------------------------------------------------------------
  // INIT
  // -------------------------------------------------------------
  function init() {
    document.getElementById('tabLogin')?.addEventListener('click', () => switchTab('login'));
    document.getElementById('tabSignup')?.addEventListener('click', () => switchTab('signup'));
    
    // Attach the submit handlers
    document.getElementById('loginForm')?.addEventListener('submit', handleLogin);
    document.getElementById('signupForm')?.addEventListener('submit', handleSignup);
    
    document.querySelectorAll('.pw-toggle').forEach(btn => {
      btn.addEventListener('click', () => {
        const inputId = btn.previousElementSibling?.id;
        if (inputId) togglePw(inputId, btn);
      });
    });

    switchTab('login');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();