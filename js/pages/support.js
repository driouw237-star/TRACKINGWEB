/* GlobalExpress - pages/support.js
   Support page connected to Supabase.
*/

(function (global) {
  'use strict';

  var Utils = global.Utils || {};
  var UI    = global.UI    || {};

  var esc = Utils.esc || function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c];
    });
  };
  var fmtDT = Utils.fmtDT || function (d) {
    return new Date(d || Date.now()).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true });
  };
  var toast = UI.toast || function (t, m, k) { console.log('[toast]', t, m || '', k || ''); };
  var openModal = UI.openModal || function () { return null; };
  var closeModal = UI.closeModal || function () {};

  // --- Constants ---
  var CATEGORIES = ['Shipping', 'Billing', 'Account', 'Technical', 'Other'];
  var PRIORITIES = ['Low', 'Normal', 'High', 'Urgent'];
  var PRIORITY_CLS = {
    Low:    'Pending',
    Normal: 'In-Transit',
    High:   'On-Hold',
    Urgent: 'Cancelled'
  };

  var FAQ_ITEMS = [
    { q: 'How do I deposit money?', a: 'Go to Wallet → Deposit, choose an amount and a payment method (MTN, Mobile Money, Card, or Crypto), then confirm.' },
    { q: 'How do I create a shipment?', a: 'Click Create Shipment in the sidebar, fill in the sender and recipient details, choose a service level, then pay from your wallet.' },
    { q: 'How do I share tracking with someone?', a: 'Open any shipment and click Share. You can copy the code or public tracking link. Recipients do not need an account.' },
    { q: 'Can I edit a shipment after creating it?', a: 'Yes. Open the shipment, click the Edit tab, change the details, then save. Changes appear in the timeline automatically.' },
    { q: 'How do I change my password?', a: 'Go to Security in the sidebar, enter your current password and the new one twice. The change is immediate.' },
    { q: 'Is my money safe?', a: 'Yes. All transactions are processed through encrypted connections. Your wallet balance is a ledger — every deposit and refund is recorded.' }
  ];

  // --- Module state ---
  var rawTickets = [];
  var searchQuery = '';
  var statusFilter = '';
  var isLoading = true;
  var handler = null;
  var container = null;

  // --- Helpers ---
  function currentUser(ctx) {
    return (ctx && ctx.user) || (global.App && global.App.state && global.App.state.user) || null;
  }

  async function fetchTickets(user) {
    if (!window.supabaseClient) return;
    isLoading = true;
    try {
      const { data, error } = await window.supabaseClient
        .schema('app')
        .from('tickets')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });

      if (error) throw error;
      rawTickets = data || [];
    } catch (err) {
      console.error('Failed to load tickets:', err);
    } finally {
      isLoading = false;
      if (container) {
        container.innerHTML = render({ user: user });
        bind({ user: user });
      }
    }
  }

  function matchesQuery(t, q) {
    if (!q) return true;
    var hay = [t.subject || '', t.message || '', t.status || ''].join(' ').toLowerCase();
    return hay.indexOf(q) >= 0;
  }

  function pipeline() {
    var list = rawTickets;
    var total = list.length;

    var q = searchQuery.trim().toLowerCase();
    if (q) list = list.filter(function (t) { return matchesQuery(t, q); });

    if (statusFilter) list = list.filter(function (t) { return t.status === statusFilter; });

    return { all: total, filtered: list.length, slice: list };
  }

  function contactPanel() {
    return `
      <div class="panel">
        <div class="panel-header"><h3><i class="fas fa-headset"></i> Get Help</h3></div>
        <div class="panel-body">
          <div class="quick-actions">
            ${contactTile('live-chat', 'fa-comments', 'Live Chat', 'Available 24/7')}
            ${contactTile('call-us', 'fa-phone', 'Call Us', 'Mon–Sun · 8am–8pm')}
            ${contactTile('email-us', 'fa-envelope', 'Email Us', 'support@globalexpress.test')}
            ${contactTile('new-ticket', 'fa-ticket', 'Open Ticket', 'Fastest for detailed issues')}
          </div>
          <p style="font-size:12.5px;color:var(--text-3);margin-top:14px;text-align:center">
            <i class="fas fa-circle-info"></i> Most tickets are answered within <strong style="color:var(--text-2)">24 hours</strong>.
          </p>
        </div>
      </div>
    `;
  }

  function contactTile(action, icon, title, desc) {
    return `
      <button type="button" class="qa-btn" data-action="${esc(action)}">
        <div class="qa-icon"><i class="fas ${esc(icon)}"></i></div>
        <h4>${esc(title)}</h4>
        <p>${esc(desc)}</p>
      </button>
    `;
  }

  function ticketRow(t) {
    var priorityCls = PRIORITY_CLS[t.priority] || 'Pending';
    var statusCls = t.status === 'Closed' ? 'Closed' : 'Open';
    var replyCount = (t.replies || []).length;

    return `
      <tr data-id="${esc(t.id)}" style="cursor:pointer">
        <td>
          <div style="font-weight:600;font-size:13.5px;color:var(--text)">${esc(t.subject || '—')}</div>
          <div style="font-size:11.5px;color:var(--text-3);margin-top:2px">
            ${esc(t.category || 'Other')} ${replyCount > 0 ? '· ' + replyCount + ' replies' : ''}
          </div>
        </td>
        <td><span class="pill ${esc(priorityCls)}" style="font-size:10px">${esc(t.priority || 'Normal')}</span></td>
        <td><span class="pill ${esc(statusCls)}">${esc(t.status || 'Open')}</span></td>
        <td style="font-size:12px;color:var(--text-3)">${new Date(t.created_at).toLocaleDateString()}</td>
        <td class="tbl-actions">
          <button type="button" class="btn btn-sm btn-outline" data-action="view" data-id="${esc(t.id)}" title="View"><i class="fas fa-eye"></i></button>
        </td>
      </tr>
    `;
  }

  function emptyTickets() {
    return `
      <div class="empty">
        <div class="empty-illustration"><i class="fas fa-ticket"></i></div>
        <h4>No tickets yet</h4>
        <p>If you have a question or an issue, open a ticket and our team will get back to you.</p>
        <button type="button" class="btn btn-primary" data-action="new-ticket"><i class="fas fa-plus"></i> Open Ticket</button>
      </div>
    `;
  }

  function emptyNoMatch() {
    return `
      <div class="empty">
        <div class="empty-illustration"><i class="fas fa-magnifying-glass"></i></div>
        <h4>No matching tickets</h4>
        <p>Try a different search term or clear the filter.</p>
        <button type="button" class="btn btn-outline" data-action="clear-filters"><i class="fas fa-rotate-left"></i> Clear filters</button>
      </div>
    `;
  }

  function ticketsPanel() {
    if (isLoading) return '<div class="panel-body" style="text-align:center;padding:40px;"><i class="fas fa-circle-notch fa-spin"></i> Loading tickets...</div>';

    var result = pipeline();
    var bodyHtml;

    if (result.all === 0) {
      bodyHtml = '<div class="panel-body">' + emptyTickets() + '</div>';
    } else if (result.filtered === 0) {
      bodyHtml = '<div class="panel-body">' + emptyNoMatch() + '</div>';
    } else {
      bodyHtml = `
        <div class="tbl-wrap">
          <table>
            <thead>
              <tr>
                <th>Subject</th>
                <th>Priority</th>
                <th>Status</th>
                <th>Created</th>
                <th class="tbl-actions"></th>
              </tr>
            </thead>
            <tbody>${result.slice.map(ticketRow).join('')}</tbody>
          </table>
        </div>
      `;
    }

    return `
      <div class="panel">
        <div class="panel-header">
          <h3><i class="fas fa-ticket"></i> My Tickets (${result.all})</h3>
          <button type="button" class="btn btn-sm btn-primary" data-action="new-ticket"><i class="fas fa-plus"></i> New Ticket</button>
        </div>
        ${result.all > 0 ? `
          <div class="toolbar">
            <div class="search-box">
              <i class="fas fa-search"></i>
              <input type="text" id="tkSearch" placeholder="Search subject..." value="${esc(searchQuery)}" />
            </div>
            <select id="tkStatus" aria-label="Filter by status">
              <option value="">All statuses</option>
              <option value="Open" ${statusFilter === 'Open' ? 'selected' : ''}>Open</option>
              <option value="Closed" ${statusFilter === 'Closed' ? 'selected' : ''}>Closed</option>
            </select>
          </div>
        ` : ''}
        ${bodyHtml}
      </div>
    `;
  }

  function faqPanel() {
    return `
      <div class="panel">
        <div class="panel-header"><h3><i class="fas fa-circle-question"></i> Frequently Asked Questions</h3></div>
        <div class="panel-body" style="padding:0">
          ${FAQ_ITEMS.map(function (item, i) {
            return `
              <details ${i === 0 ? 'open' : ''} style="padding:16px 22px;border-bottom:1px solid var(--border-2)">
                <summary style="font-weight:600;font-size:14px;cursor:pointer;list-style:none;display:flex;justify-content:space-between;align-items:center;gap:10px;color:var(--text)">
                  <span>${esc(item.q)}</span>
                  <i class="fas fa-chevron-down" style="color:var(--text-3);font-size:12px;transition:transform .2s"></i>
                </summary>
                <p style="margin-top:12px;font-size:13.5px;color:var(--text-2);line-height:1.65">${esc(item.a)}</p>
              </details>
            `;
          }).join('')}
        </div>
      </div>
    `;
  }

  function openNewTicketModal(ctx) {
    var modal = openModal(`
      <div class="modal">
        <div class="modal-head">
          <div><h3><i class="fas fa-ticket"></i> Open a Ticket</h3><div class="sub">Our team usually responds within 24 hours.</div></div>
          <button type="button" class="modal-close" data-close><i class="fas fa-times"></i></button>
        </div>
        <div class="modal-body">
          <div class="field" style="margin-bottom:14px">
            <label>Subject <span class="req">*</span></label>
            <input type="text" id="tkSubject" placeholder="Brief summary of your issue" maxlength="100" />
          </div>
          <div class="grid-2" style="margin-bottom:14px">
            <div class="field">
              <label>Category</label>
              <select id="tkCategory">
                ${CATEGORIES.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('')}
              </select>
            </div>
            <div class="field">
              <label>Priority</label>
              <select id="tkPriority">
                ${PRIORITIES.map(p => `<option value="${esc(p)}" ${p === 'Normal' ? 'selected' : ''}>${esc(p)}</option>`).join('')}
              </select>
            </div>
          </div>
          <div class="field">
            <label>Message <span class="req">*</span></label>
            <textarea id="tkMessage" placeholder="Describe what happened." style="min-height:140px"></textarea>
          </div>
        </div>
        <div class="modal-foot">
          <button type="button" class="btn btn-outline" data-close>Cancel</button>
          <button type="button" class="btn btn-primary" data-submit><i class="fas fa-paper-plane"></i> Submit Ticket</button>
        </div>
      </div>
    `);

    if (!modal) return;

    modal.addEventListener('click', function (e) {
      if (e.target.closest && e.target.closest('[data-close]')) { closeModal(modal); return; }
      if (e.target === modal) { closeModal(modal); return; }
      if (e.target.closest && e.target.closest('[data-submit]')) {
        submitTicket(ctx, modal);
      }
    });

    setTimeout(function () {
      var s = document.getElementById('tkSubject');
      if (s) s.focus();
    }, 60);
  }

  async function submitTicket(ctx, modal) {
    var user = currentUser(ctx);
    if (!user || !window.supabaseClient) return;

    var subject = document.getElementById('tkSubject').value.trim();
    var category = document.getElementById('tkCategory').value;
    var priority = document.getElementById('tkPriority').value;
    var message = document.getElementById('tkMessage').value.trim();

    if (!subject) { toast('Subject is required', '', 'error'); return; }
    if (!message || message.length < 10) { toast('Message is too short', 'Please add more detail.', 'error'); return; }

    var btn = modal.querySelector('[data-submit]');
    btn.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> Submitting...';
    btn.disabled = true;

    try {
      const { error } = await window.supabaseClient
        .schema('app')
        .from('tickets')
        .insert({
          user_id: user.id,
          subject: subject,
          message: message,
          priority: priority,
          category: category,
          status: 'Open',
          replies: []
        });

      if (error) throw error;

      closeModal(modal);
      toast('Ticket submitted', 'We will reply within 24 hours.', 'success');
      
      fetchTickets(user);

    } catch (err) {
      console.error('Submit failed:', err);
      toast('Error', 'Failed to submit ticket.', 'error');
      btn.innerHTML = '<i class="fas fa-paper-plane"></i> Submit Ticket';
      btn.disabled = false;
    }
  }

  function findTicket(id) {
    for (var i = 0; i < rawTickets.length; i++) if (rawTickets[i].id === id) return rawTickets[i];
    return null;
  }

  function openTicketModal(id, ctx) {
    var t = findTicket(id);
    if (!t) { toast('Ticket not found', '', 'error'); return; }

    var user = currentUser(ctx);
    var canReply = t.status !== 'Closed';
    var thread = buildThread(t, user);

    var modal = openModal(`
      <div class="modal wide">
        <div class="modal-head">
          <div>
            <h3><i class="fas fa-ticket"></i> ${esc(t.subject)}</h3>
            <div class="sub">
              ${esc(t.category || 'Other')} · 
              <span class="pill ${t.status === 'Closed' ? 'Closed' : 'Open'}" style="font-size:10px;margin-left:4px">${esc(t.status)}</span> · 
              ${new Date(t.created_at).toLocaleString()}
            </div>
          </div>
          <button type="button" class="modal-close" data-close><i class="fas fa-times"></i></button>
        </div>
        <div class="modal-body" style="background:var(--surface-2)">
          <div style="max-width:640px;margin:0 auto">
            ${thread}
            ${canReply ? `
              <div class="field" style="margin-top:20px">
                <label>Reply</label>
                <textarea id="tkReply" placeholder="Type your message…" style="min-height:100px;background:#fff"></textarea>
              </div>
            ` : `
              <div style="text-align:center;padding:20px;font-size:13px;color:var(--text-3);margin-top:16px">
                <i class="fas fa-lock"></i> This ticket is closed.
              </div>
            `}
          </div>
        </div>
        <div class="modal-foot">
          <button type="button" class="btn btn-outline" data-close>Close</button>
          ${canReply ? `<button type="button" class="btn btn-primary" data-reply data-id="${esc(t.id)}"><i class="fas fa-paper-plane"></i> Send Reply</button>` : ''}
        </div>
      </div>
    `);

    if (!modal) return;

    modal.addEventListener('click', function (e) {
      if (e.target.closest && e.target.closest('[data-close]')) { closeModal(modal); return; }
      if (e.target === modal) { closeModal(modal); return; }
      if (e.target.closest && e.target.closest('[data-reply]')) {
        sendReply(t.id, ctx, modal);
      }
    });
  }

  function buildThread(t, user) {
    var messages = [];
    messages.push({ at: t.created_at, from: 'user', author: user ? (user.name || user.email) : 'You', text: t.message });

    (t.replies || []).forEach(function (r) {
      var isUser = r.by === (user && user.email) || r.from === 'user';
      messages.push({
        at: r.at || r.created_at,
        from: isUser ? 'user' : 'admin',
        author: isUser ? (user ? (user.name || user.email) : 'You') : 'Support Team',
        text: r.message
      });
    });

    return `
      <div style="display:flex;flex-direction:column;gap:14px">
        ${messages.map(function (m) {
          var isUser = m.from === 'user';
          var alignment = isUser ? 'flex-end' : 'flex-start';
          var bubbleBg = isUser ? 'var(--accent)' : '#fff';
          var bubbleColor = isUser ? '#fff' : 'var(--text)';
          var bubbleBorder = isUser ? 'none' : '1px solid var(--border)';
          var radius = isUser ? '14px 14px 4px 14px' : '14px 14px 14px 4px';
          var authorColor = isUser ? 'rgba(255,255,255,.85)' : 'var(--text-3)';
          var timeColor = isUser ? 'rgba(255,255,255,.75)' : 'var(--text-3)';

          return `
            <div style="display:flex;flex-direction:column;align-items:${alignment}">
              <div style="font-size:11px;font-weight:600;color:${authorColor};margin-bottom:4px">${esc(m.author)}</div>
              <div style="max-width:min(520px,90%);padding:12px 16px;border-radius:${radius};background:${bubbleBg};color:${bubbleColor};border:${bubbleBorder};font-size:13.5px;line-height:1.55;box-shadow:0 1px 3px rgba(15,23,42,.05)">
                ${esc(m.text).replace(/\n/g, '<br>')}
              </div>
              <div style="font-size:10.5px;color:${timeColor};margin-top:4px">${esc(m.at || '')}</div>
            </div>
          `;
        }).join('')}
      </div>
    `;
  }

  async function sendReply(ticketId, ctx, modal) {
    var user = currentUser(ctx);
    if (!user || !window.supabaseClient) return;

    var text = document.getElementById('tkReply').value.trim();
    if (!text || text.length < 2) { toast('Write a reply first', '', 'error'); return; }

    var btn = modal.querySelector('[data-reply]');
    btn.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> Sending...';
    btn.disabled = true;

    try {
      var t = findTicket(ticketId);
      if (!t) throw new Error('Ticket not found');

      var newReplies = (t.replies || []).concat([{
        at: new Date().toISOString(),
        by: user.email,
        from: 'user',
        message: text
      }]);

      const { error } = await window.supabaseClient
        .schema('app')
        .from('tickets')
        .update({ replies: newReplies })
        .eq('id', ticketId);

      if (error) throw error;

      closeModal(modal);
      toast('Reply sent', 'Support will get back to you soon.', 'success');
      
      fetchTickets(user);

    } catch (err) {
      console.error('Reply failed:', err);
      toast('Error', 'Failed to send reply.', 'error');
      btn.innerHTML = '<i class="fas fa-paper-plane"></i> Send Reply';
      btn.disabled = false;
    }
  }

  function render(ctx) {
    var user = currentUser(ctx);
    if (!user) return '<div class="panel"><div class="panel-body">Not signed in.</div></div>';

    return `
      ${contactPanel()}
      <div id="tkPanelHost">${ticketsPanel()}</div>
      ${faqPanel()}
    `;
  }

  function bind(ctx) {
    container = document.getElementById('content');
    if (!container) return;

    var user = currentUser(ctx);
    if (isLoading && user) {
      fetchTickets(user);
      return;
    }

    if (handler) container.removeEventListener('click', handler);
    handler = function (e) {
      var btn = e.target.closest && e.target.closest('[data-action]');
      if (btn) {
        var action = btn.dataset.action;

        if (action === 'live-chat') { toast('Live chat', 'Connecting you to support…', 'info'); return; }
        if (action === 'call-us')   { toast('Call us', '+237 6XX XXX XXX', 'info'); return; }
        if (action === 'email-us')  { window.open('mailto:support@globalexpress.test'); return; }
        if (action === 'new-ticket'){ openNewTicketModal(ctx); return; }
        if (action === 'view')      { openTicketModal(btn.dataset.id, ctx); return; }
        if (action === 'clear-filters') {
          searchQuery = '';
          statusFilter = '';
          document.getElementById('tkSearch').value = '';
          document.getElementById('tkStatus').value = '';
          document.getElementById('tkPanelHost').innerHTML = ticketsPanel();
          return;
        }
      }

      var row = e.target.closest && e.target.closest('tr[data-id]');
      if (row && !e.target.closest('[data-action]')) {
        openTicketModal(row.dataset.id, ctx);
        return;
      }
    };
    container.addEventListener('click', handler);

    var searchEl = document.getElementById('tkSearch');
    if (searchEl) {
      var t = null;
      searchEl.addEventListener('input', function () {
        if (t) clearTimeout(t);
        t = setTimeout(function () {
          searchQuery = searchEl.value || '';
          document.getElementById('tkPanelHost').innerHTML = ticketsPanel();
        }, 140);
      });
    }

    var statusEl = document.getElementById('tkStatus');
    if (statusEl) {
      statusEl.addEventListener('change', function () {
        statusFilter = statusEl.value || '';
        document.getElementById('tkPanelHost').innerHTML = ticketsPanel();
      });
    }
  }

  function cleanup() {
    if (container && handler) container.removeEventListener('click', handler);
    container = null; handler = null;
    searchQuery = ''; statusFilter = '';
    rawTickets = []; isLoading = true;
  }

  var page = {
    title: 'Support',
    subtitle: 'Get help from our team',
    render: render,
    bind: bind,
    cleanup: cleanup
  };

  if (global.App && typeof global.App.register === 'function') {
    global.App.register('support', page);
  } else {
    global.Pages = global.Pages || {};
    global.Pages.support = page;
  }

})(window);