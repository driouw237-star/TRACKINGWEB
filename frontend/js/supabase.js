// js/supabase.js
(function () {
  'use strict';

  var SUPABASE_URL  = 'https://yyhkljvxemxkzxbyjkvv.supabase.co';
  var SUPABASE_ANON = 'sb_publishable_fEvq2Jtnhh0dxTp67VmTfA_AMp05auc';

  if (!window.supabase || typeof window.supabase.createClient !== 'function') {
    console.error('[supabase] CDN not loaded. Make sure the script tag is before this file.');
    return;
  }

  window.supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true
    }
  });

  console.log('[supabase] Client initialized successfully for:', SUPABASE_URL);
})();