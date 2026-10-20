// js/supabase.js
(function () {
  'use strict';

  var SUPABASE_URL  = 'https://yyhkljvxemxkzxbyjkvv.supabase.co';
  var SUPABASE_ANON = 'sb_publishable_fEvq2Jtnhh0dxTp67VmTfA_AMp05auc';

  if (!window.supabase || typeof window.supabase.createClient !== 'function') {
    console.error('[supabase] CDN not loaded. Make sure the script tag is before this file.');
    return;
  }

  window.supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true
    },
    db: {
      schema: 'public' // <--- CHANGED TO PUBLIC
    }
  });
  
  console.log('[supabase] Client initialized for public schema');
})();