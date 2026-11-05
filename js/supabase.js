// js/supabase.js
(function () {
  'use strict';

  var SUPABASE_URL  = 'https://lhvylzpfkqsjbtbggfee.supabase.co';
  var SUPABASE_ANON = 'sb_publishable_jBwAPl3bDT0VOybqnORhlA_kbmaXPNW';

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
      schema: 'public'
    }
  });

  // ==========================================================================
  // THE FIX FOR THE "PARTIAL LOGOUT" RACE CONDITION
  // ==========================================================================
  // We create a "promise" that resolves only when Supabase has completely
  // finished loading the session from storage. We attach this to the client
  // so app.js and auth.js can wait for it.
  window.authReady = new Promise(function (resolve) {
    var resolved = false;

    // Listen for the first auth state change
    var { data: { subscription } } = window.supabaseClient.auth.onAuthStateChange(function (event, session) {
      if (!resolved && (event === 'INITIAL_SESSION' || event === 'SIGNED_IN' || event === 'SIGNED_OUT')) {
        resolved = true;
        resolve(session);
        if (subscription) subscription.unsubscribe();
      }
    });

    // Fallback: If no event fires within 800ms, just check the session manually
    // (This prevents the app from hanging forever if there is a network issue)
    setTimeout(function () {
      if (!resolved) {
        resolved = true;
        window.supabaseClient.auth.getSession().then(function (res) {
          resolve(res.data.session);
        });
        if (subscription) subscription.unsubscribe();
      }
    }, 800);
  });

  console.log('[supabase] Client initialized — waiting for auth sync');
})();