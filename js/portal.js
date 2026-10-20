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

  async function handleLogin(e) {
    e.preventDefault();
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

      // Query the 'public.users' table (no more schema() selector needed)
      const { data: profile, error: profileError } = await window.supabaseClient
        .from('users')
        .select('id, email, full_name, role, status')
        .eq('id', authData.user.id)
        .single();

      if (profileError) {
        console.error("Profile Error:", profileError);
        throw new Error('Could not find user profile. Check console.');
      }

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

  function init() {
    document.getElementById('tabLogin')?.addEventListener('click', () => switchTab('login'));
    document.getElementById('tabSignup')?.addEventListener('click', () => switchTab('signup'));
    document.getElementById('loginForm')?.addEventListener('submit', handleLogin);
    
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