// js/supabase.js
(function () {
  'use strict';

  var SUPABASE_URL  = 'https://yyhkljvxemxkzxbyjkvv.supabase.co';
  var SUPABASE_ANON = 'sb_publishable_fEvq2Jtnhh0dxTp67VmTfA_AMp05auc';

  if (!window.supabase || typeof window.supabase.createClient !== 'function') {
    console.error('[supabase] CDN not loaded. Make sure the script tag is before this file.');
    return;
  }

  // Create the client and store it globally
  window.supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true
    }
  });

  // A quick health check
  (async function healthCheck() {
    try {
      const res = await fetch(SUPABASE_URL + '/auth/v1/health', {
        headers: { apikey: SUPABASE_ANON }
      });
      if (!res.ok) {
        console.error('[supabase] Health check FAILED — HTTP ' + res.status);
      } else {
        console.log('[supabase] Client initialized & Health OK');
      }
    } catch (err) {
      console.error('[supabase] Health check threw:', err);
    }
  })();

})();