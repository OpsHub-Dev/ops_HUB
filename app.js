/* ══════════════════════════════════════════════════════
   ALFA.CO — CORE APPLICATION
══════════════════════════════════════════════════════ */

// ── Firebase Co)">nfig ──
var FB_CONFIG = {
  apiKey: "AIzaSyB9DhSn5gDqAhpmLG9aVFAld1dSRYJWFDI",
  authDomain: "opshub-f802f.firebaseapp.com",
  databaseURL: "https://opshub-f802f-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "opshub-f802f",
  storageBucket: "opshub-f802f.firebasestorage.app",
  messagingSenderId: "84176854270",
  appId: "1:84176854270:web:f7a66b3b38e98b630859af"
};

var db = null;
var NX = {
  session: null,    // current session
  page: null,       // current page id
  charts: {},       // chart instances keyed by id
  notifications: [],
  unreadCount: 0,
  theme: 'dark',
  sidebarOpen: true,
  sortState: {},    // table sort states
  liveListeners: [], // firebase .on() refs to clean up
  lastSync: null,
  demoMode: false
};

// Checklist module globals (must be declared at top level)
var clNxState = {};
var clNxRole  = null;

// ── Firebase Initialization ──────────────────────────────────────────────────
function initFirebase() {
  if (typeof firebase === 'undefined') return false;
  try {
    if (!firebase.apps.length) {
      firebase.initializeApp(FB_CONFIG);
    }
    db = firebase.database();
    // Real-time connection status from Firebase
    db.ref('.info/connected').on('value', function(snap) {
      var online = !!snap.val();
      setConnStatus(online);
      if (online) NX.lastSync = Date.now();
    });
    return true;
  } catch(e) {
    console.warn('Firebase init error:', e);
    return false;
  }
}

function tryInitFB() {
  // Firebase is bundled inline — always available immediately
  if (initFirebase()) {
    setConnStatus(true);
    console.log('Firebase connected');
    return;
  }
  // Fallback retry in case of init race (should not normally happen)
  var tries = 0;
  var interval = setInterval(function() {
    tries++;
    if (initFirebase()) {
      clearInterval(interval);
      setConnStatus(true);
      if (NX.session) { startLiveListeners(); loadBranchRegistry(); }
    } else if (tries >= 10) {
      clearInterval(interval);
      setConnStatus(false);
      var b = document.createElement('div');
      b.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:9999;background:#7f1d1d;color:#fca5a5;text-align:center;padding:14px;font-family:monospace;font-size:13px;font-weight:600';
      b.textContent = 'Firebase failed to initialise — check your Firebase config and database URL, then refresh.';
      document.body.appendChild(b);
    }
  }, 300);
}

function setConnStatus(online) {
  var dots  = document.querySelectorAll('.conn-dot');
  var label = document.getElementById('conn-label');
  var sbTxt = document.getElementById('sb-conn-text');
  dots.forEach(function(d) { d.classList.toggle('offline', !online); });
  if (label) label.textContent  = online ? 'Live'                   : 'Reconnecting\u2026';
  if (sbTxt) sbTxt.textContent  = online ? 'Connected to Firebase'  : 'Connecting\u2026';
}

// ── Session management ────────────────────────────────────────────────────────
var SESSION_KEY = 'nexus_session_v1';
var SESSION_TTL = 8 * 3600 * 1000; // 8 hours

function saveSession(sess) {
  try {
    sess.ts      = Date.now();
    sess.expires = Date.now() + SESSION_TTL;
    localStorage.setItem(SESSION_KEY, JSON.stringify(sess));
  } catch(e) { console.warn('saveSession error:', e); }
}

function loadSession() {
  try {
    var raw  = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    var sess = JSON.parse(raw);
    if (!sess || !sess.role) return null;
    if (sess.expires && sess.expires < Date.now()) {
      localStorage.removeItem(SESSION_KEY);
      return null;
    }
    return sess;
  } catch(e) { return null; }
}

function clearSession() {
  localStorage.removeItem(SESSION_KEY);
  NX.session = null;
}

function doLogout() {
  // Reset all branch state
  _bListenersAttached = false;
  _nxTransferListenerAttached = false;
  BS = { q:'', fd:'All', wo:0, tsTab:'att', tsLTab:'all', tsViewDate: TODAY_BS,
         staff:[], sales:[], waste:[], rem:[], pc:[], health:[], invoices:[],
         tsEmps:[], tsLeaves:[], sch:{}, tsAtt:{}, _branchConfig:{} };
  bItems = []; bLogs = []; bOrders = [];
  clNxRole = null;
  clNxState = {};
  NX.rev = null;
  NX.notifications = [];
  NX.unreadCount = 0;
  NX._notifFilter = 'all';

  // Stop all Firebase listeners
  clearLiveListeners();

  // Reset branch data cache so next login loads fresh data
  NX_BRANCH_SALES = {};
  NX_LOADED_SALES = {};

  // Clear session
  clearSession();

  // Show login screen
  var app = document.getElementById('app');
  var login = document.getElementById('login-screen');
  if (app)   { app.classList.remove('visible'); app.style.display = 'none'; }
  if (login) { login.style.display = ''; }

  // Reset login state and re-render login
  renderLogin(0);
  showToast('Signed out', 'success');
}

// ── Core utility functions ────────────────────────────────────────────────────

function xe(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

var SAR_SYM = 'SAR ';

function formatSAR(val) {
  if (isNaN(val) || val === null || val === undefined) return 'SAR 0.00';
  return 'SAR ' + Number(val).toLocaleString('en-SA', {minimumFractionDigits:2, maximumFractionDigits:2});
}

function formatNum(val) {
  if (isNaN(val)) return '0';
  return Number(val).toLocaleString('en-SA');
}

function fmtDate(d) {
  if (!d) return '';
  if (typeof d === 'string') d = new Date(d + 'T00:00:00');
  return d.toLocaleDateString('en-GB', {day:'2-digit', month:'short', year:'numeric'});
}

function rand(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// ── Navigation ───────────────────────────────────────────────────────────────

function navTo(pageId) {
  // Standalone portal links — open in new tab
  var portalMap = { '_staff-portal':'staff.html', '_leave-portal':'leave.html', '_checklist-portal':'checklists.html', '_server-drop':'server-drop.html', '_my-portal':'staff-portal.html' };
  if (portalMap[pageId]) { var _pbid=(NX.session||{}).branchId; var _purl=portalMap[pageId]+(_pbid?'?branch='+encodeURIComponent(_pbid):''); window.open(_purl, '_blank'); return; }

  NX.page = pageId;
  // Persist last page for refresh restore
  try { localStorage.setItem('nx_last_page', pageId); } catch(e) {}
  updateTopBar(pageId);
  renderSidebar();
  window.scrollTo(0, 0);
  // Auto-close sidebar on mobile after navigation
  if (window.innerWidth <= 768) {
    var sb = document.getElementById('sidebar');
    if (sb && !sb.classList.contains('collapsed')) {
      sb.classList.add('collapsed');
      NX.sidebarOpen = false;
      var mc = document.getElementById('main-content');
      if (mc) mc.classList.add('sidebar-collapsed');
    }
  }

  // If Firebase data not yet loaded, show a spinner and retry
  var needsBranches = ['exec-dash','brand-perf','brand-dash','brand-branches',
    'region-dash','region-branches','rev-analytics','headcount','food-cost',
    'alerts-center','brand-mgmt','access-ctrl','audit-log'];
  var area = document.getElementById('page-area');

  if (needsBranches.indexOf(pageId) >= 0 && !Object.keys(NX_BRANCHES).length) {
    if (area) area.innerHTML = '<div class="empty-state">' +
      '<div style="font-size:36px;margin-bottom:12px">⏳</div>' +
      '<h3 style="color:var(--text-primary)">Loading from Firebase…</h3>' +
      '<p style="color:var(--text-secondary)">Fetching branch data</p></div>';
    // Retry once data arrives
    var _retries = 0;
    var _wait = setInterval(function() {
      _retries++;
      if (Object.keys(NX_BRANCHES).length || _retries > 8) {
        clearInterval(_wait);
        if (NX.page === pageId) renderPage(pageId);
      }
    }, 300);
    return;
  }

  renderPage(pageId);
}

function toggleSidebar() {
  var sb = document.getElementById('sidebar');
  if (!sb) return;
  sb.classList.toggle('collapsed');
  NX.sidebarOpen = !sb.classList.contains('collapsed');
  var mainContent = document.getElementById('main-content');
  if (mainContent) mainContent.classList.toggle('sidebar-collapsed', !NX.sidebarOpen);
}

function updateTopBar(pageId) {
  var bc = document.getElementById('tb-breadcrumb');
  if (!bc) return;
  var s = NX.session || {};
  var parts = ['ALFA.CO'];
  if (s.brandName)  parts.push(xe(s.brandName));
  if (s.regionName) parts.push(xe(s.regionName));
  if (s.branchName && s.branchName !== s.brandName) parts.push(xe(s.branchName));

  var labels = {
    'exec-dash':'Executive Dashboard','brand-perf':'Brand Performance',
    'rev-analytics':'Revenue Analytics','headcount':'Headcount',
    'food-cost':'Food Cost','alerts-center':'Alerts Center',
    'brand-mgmt':'Brand Management','access-ctrl':'Access Control',
    'audit-log':'Audit Log','brand-dash':'Brand Dashboard',
    'brand-branches':'My Branches','region-dash':'Region Dashboard',
    'region-branches':'Region Branches','branch-dash':'Branch Dashboard',
    'inv-items':'Inventory','inv-moves':'Receiving',
    'inv-orders':'Purchase Orders','low-stock':'Low Stock',
    'inv-report':'Monthly Report','wastage':'Wastage Log',
    'staff':'Staff','schedule':'Schedule','timesheet':'Timesheet',
    'health-cards':'Health Cards','sales':'Sales','petty-cash':'Petty Cash','dsr':'Daily Sales Report',
    'checklists':'Checklists','qr-checkin':'QR Check-In'
  };
  if (pageId && labels[pageId]) parts.push(labels[pageId]);

  bc.innerHTML = parts.map(function(p, i) {
    return '<span>' + p + '</span>' + (i < parts.length - 1 ? '<span class="sep">›</span>' : '');
  }).join('');
}

function switchBranch(branchId) {
  // Switch view to a specific branch (for brand director / regional drill-down)
  var b = NX_BRANCHES[branchId];
  if (!b) { showToast('Branch not found', 'error'); return; }
  // Load its sales data then navigate to branch dashboard
  loadBranchSalesData(branchId, function() {
    var prev = NX.session || {};
    // Temporarily augment session with this branch's data
    NX.session = Object.assign({}, prev, {
      branchId: branchId,
      branchName: b.name,
      brandName: b.brand || b.name,
      regionName: b.location || ''
    });
    // Reset branch state
    _bListenersAttached = false;
    BS = { q:'', fd:'All', wo:0, tsTab:'att', tsLTab:'all', tsViewDate:TODAY_BS,
           staff:[], sales:[], waste:[], rem:[], pc:[], health:[], invoices:[],
           tsEmps:[], tsLeaves:[], sch:{}, tsAtt:{}, _branchConfig:{} };
    navTo('branch-dash');
  });
}

// ── Sidebar ──────────────────────────────────────────────────────────────────

function renderSidebar() {
  var s = NX.session;
  if (!s) return;
  var role  = s.role;
  var color = getRoleColor(role);

  var rb = document.getElementById('sb-role-badge');
  if (rb) {
    rb.style.color       = color;
    rb.style.borderColor = color + '40';
    rb.innerHTML = getRoleIcon(role) + ' ' + getRoleLabel(role);
  }
  var en = document.getElementById('sb-entity-name');
  if (en) en.textContent = s.branchName || s.entityName || 'ALFA.CO';

  var av = document.getElementById('user-avatar');
  if (av) {
    av.textContent = (s.branchName || s.entityName || 'U').charAt(0).toUpperCase();
    av.title = getRoleLabel(role) + (s.entityName ? ' — ' + s.entityName : '');
  }

  var navConf = NAV_CONFIG[role] || NAV_CONFIG.branch_mgr;
  var nav = document.getElementById('sb-nav');
  if (!nav) return;

  nav.innerHTML = navConf.map(function(section) {
    var items = section.items.map(function(item) {
      var active = NX.page === item.id;
      return '<div class="nav-item' + (active ? ' active' : '') + '" data-page="' + item.id + '" onclick="navTo(\'' + item.id + '\')">' +
        '<span class="ni-icon">' + item.icon + '</span>' +
        '<span class="ni-label">' + xe(item.label) + '</span>' +
        (item.badge ? '<span class="nav-badge" id="nb-' + item.badge + '" style="display:none">0</span>' : '') +
      '</div>';
    }).join('');
    return '<div class="nav-section-label">' + xe(section.section) + '</div>' + items;
  }).join('');
}

function getRoleColor(role) {
  var m = { super_admin:'#c0392b', ceo:'#b45309', brand_dir:'#5b21b6', regional:'#0057ff', branch_mgr:'#00875a', staff:'#94a3b8', hr_manager:'#a78bfa', finance_dir:'#d97706' };
  return m[role] || '#94a3b8';
}
function getRoleLabel(role) {
  var m = { super_admin:'Super Admin', ceo:'CEO', brand_dir:'Brand Director', regional:'Regional Manager', branch_mgr:'Branch Manager', staff:'Staff', hr_manager:'HR Manager', finance_dir:'Finance Director' };
  return m[role] || role;
}
function getRoleIcon(role) {
  var m = { super_admin:'🔑', ceo:'👑', brand_dir:'🎯', regional:'🗺️', branch_mgr:'🏪', staff:'👤', hr_manager:'🧑‍💼', finance_dir:'💰' };
  return m[role] || '👤';
}

var NAV_CONFIG = {
  ceo: [
    { section:'EXECUTIVE', items:[
      { id:'exec-dash',    icon:'📊', label:'Executive Dashboard' },
      { id:'brand-perf',   icon:'🏆', label:'Brand Performance' },
      { id:'rev-analytics',icon:'📈', label:'Revenue Analytics' },
      { id:'headcount',    icon:'👥', label:'Headcount Overview' },
      { id:'food-cost',    icon:'🍽️', label:'Food Cost Analysis' },
      { id:'alerts-center',icon:'⚠️', label:'Alerts Center', badge:'alerts' }
    ]},
    { section:'MANAGEMENT', items:[
      { id:'brand-mgmt',  icon:'🏢', label:'Brand Management' },
      { id:'access-ctrl', icon:'🔐', label:'Access Control' },
      { id:'audit-log',   icon:'📋', label:'Audit Log' }
    ]}
  ],
  super_admin: [
    { section:'EXECUTIVE', items:[
      { id:'exec-dash',    icon:'📊', label:'Executive Dashboard' },
      { id:'brand-perf',   icon:'🏆', label:'Brand Performance' },
      { id:'alerts-center',icon:'⚠️', label:'Alerts Center', badge:'alerts' }
    ]},
    { section:'SYSTEM', items:[
      { id:'brand-mgmt',    icon:'🏢', label:'Brand Management' },
      { id:'access-ctrl',   icon:'🔐', label:'Access Control' },
      { id:'audit-log',     icon:'📋', label:'Audit Log' }
    ]}
  ],
  brand_dir: [
    { section:'BRAND OPS', items:[
      { id:'brand-dash',     icon:'📊', label:'Brand Dashboard' },
      { id:'brand-branches', icon:'🏪', label:'My Branches' },
      { id:'rev-analytics',  icon:'📈', label:'Sales & Revenue' },
      { id:'food-cost',      icon:'🍽️', label:'Food Cost' },
      { id:'headcount',      icon:'👥', label:'Staff Overview' },
      { id:'alerts-center',  icon:'⚠️', label:'Compliance', badge:'alerts' }
    ]}
  ],
  regional: [
    { section:'REGION OPS', items:[
      { id:'region-dash',    icon:'📊', label:'Region Dashboard' },
      { id:'region-branches',icon:'🏪', label:'My Branches' },
      { id:'rev-analytics',  icon:'📊', label:'Sales Comparison' },
      { id:'headcount',      icon:'👥', label:'Staff Management', badge:'am-transfers-pending' },
      { id:'alerts-center',  icon:'⚠️', label:'Alerts', badge:'alerts' }
    ]}
  ],
  branch_mgr: [
    { section:'DASHBOARD', items:[
      { id:'branch-dash',       icon:'📊', label:'Dashboard' }
    ]},
    { section:'INVENTORY', items:[
      { id:'inv-items',         icon:'📦', label:'Items' },
      { id:'inv-moves',         icon:'🔄', label:'Receiving' },
      { id:'inv-orders',        icon:'🛒', label:'Purchase Orders' },
      { id:'low-stock',         icon:'🚨', label:'Low Stock', badge:'lowstock' },
      { id:'inv-report',        icon:'📅', label:'Monthly Report' },
      { id:'wastage',           icon:'🗑️', label:'Wastage Log' },
      { id:'bm-transfers',      icon:'🔀', label:'Transfer Requests', badge:'bm-transfers-pending' }
    ]},
    { section:'OPERATIONS', items:[
      { id:'staff',             icon:'👥', label:'Staff' },
      { id:'schedule',          icon:'🗓️', label:'Schedule' },
      { id:'timesheet',         icon:'⏱️', label:'Timesheet' },
      { id:'health-cards',      icon:'💳', label:'Health Cards' },
      { id:'sales',             icon:'💰', label:'Sales' },
      { id:'petty-cash',        icon:'🧾', label:'Petty Cash' },
      { id:'dsr',               icon:'📋', label:'DSR' },
      { id:'bm-leave',          icon:'🏖️', label:'Leave Management', badge:'bm-leave-pending' }
    ]},
    { section:'COMMUNICATIONS', items:[
      { id:'bm-compliance',      icon:'🏛️', label:'Compliance & Costs', badge:'bm-compliance-expiry' },
      { id:'bm-assets',           icon:'🗂️', label:'Asset Register' },
      { id:'bm-announcements',  icon:'📢', label:'Announcements', badge:'bm-ann-unread' },
      { id:'bm-music-player',   icon:'🎵', label:'Music Player' }
    ]}
  ],
  staff: [
    { section:'MY WORKSPACE', items:[
      { id:'branch-dash',    icon:'📊', label:'Dashboard' },
      { id:'_my-portal',     icon:'👤', label:'My Staff Portal' },
      { id:'checklists',     icon:'✅', label:'Checklists' },
      { id:'qr-checkin',     icon:'📱', label:'Check-In' }
    ]},
    { section:'PORTALS', items:[
      { id:'_leave-portal',      icon:'📝', label:'Leave Request' },
      { id:'_checklist-portal',  icon:'📋', label:'Checklist App' },
      { id:'_server-drop',       icon:'💰', label:'Server Drop' }
    ]}
  ],
  hr_manager: [
    { section:'HR OVERVIEW', items:[
      { id:'hrf-hr-dash',     icon:'📊', label:'HR Dashboard' },
      { id:'hrf-approvals',   icon:'✅', label:'Leave Approvals', badge:'hrf-pending' }
    ]},
    { section:'WORKFORCE', items:[
      { id:'hrf-employees',   icon:'👥', label:'All Employees' },
      { id:'hrf-attendance',  icon:'⏱️', label:'Attendance' },
      { id:'hrf-leave',       icon:'🏖️', label:'Leave Management' },
      { id:'hrf-health',      icon:'💳', label:'Health Cards' }
    ]},
    { section:'PAYROLL', items:[
      { id:'hrf-payroll',     icon:'💸', label:'Payroll Overview' },
      { id:'hrf-petty-cash',  icon:'🧾', label:'Petty Cash' }
    ]},
    { section:'REPORTS', items:[
      { id:'hrf-hr-report',   icon:'📋', label:'HR Reports' }
    ]}
  ],
  finance_dir: [
    { section:'FINANCE OVERVIEW', items:[
      { id:'hrf-fin-dash',    icon:'📊', label:'Finance Dashboard' },
      { id:'hrf-pnl',         icon:'📈', label:'P&L Statement' },
      { id:'hrf-approvals',   icon:'✅', label:'Expense Approvals', badge:'hrf-pending' }
    ]},
    { section:'REVENUE', items:[
      { id:'hrf-revenue',     icon:'💰', label:'Revenue & Sales' },
      { id:'hrf-dsr',         icon:'📑', label:'DSR Summary' }
    ]},
    { section:'COSTS & EXPENSES', items:[
      { id:'hrf-payroll',     icon:'💸', label:'Payroll Overview' },
      { id:'hrf-food-cost',   icon:'🍽️', label:'Food Cost & Wastage' },
      { id:'hrf-petty-cash',  icon:'💵', label:'Petty Cash' },
      { id:'hrf-expenses',    icon:'🧾', label:'Expenses' },
      { id:'hrf-compliance',  icon:'🏛️', label:'Fixed Costs & Permits' }
    ]},
    { section:'PROCUREMENT', items:[
      { id:'hrf-pos',         icon:'🛒', label:'Purchase Orders', badge:'hrf-po-pending' },
      { id:'hrf-invoices',    icon:'📋', label:'Supplier Invoices' }
    ]},
    { section:'REPORTS', items:[
      { id:'hrf-fin-report',  icon:'📄', label:'Financial Report' }
    ]}
  ]
};


// ══════════════════════════════════════════════════════
// REAL DATA LAYER — reads from same Firebase paths as OpsHub
// Paths:  admin/branches         → branch registry
//         branches/{id}/staff    → staff
//         branches/{id}/sales    → sales entries
//         branches/{id}/health   → health cards
//         branches/{id}/invoices → invoices
//         branches/{id}/waste    → wastage
//         branches/{id}/pc       → petty cash
//         branches/{id}/sch      → schedule
//         branches/{id}/tsAtt    → attendance
//         branches/{id}/tsLeaves → leave requests
//         branches/{id}/inv_orders → purchase orders
//         branches/{id}/inv_logs   → inventory movements
//         branches/{id}/cl_weeks   → checklists
//         shared/inv_items         → inventory catalog
//         branches/{id}/stock      → branch stock quantities
// ══════════════════════════════════════════════════════

// Users registry (directors, area managers) loaded from admin/users
var NX_USERS = {};  // { userId: {id, name, role, pin, branchIds:[], brandName, ...} }

function loadUserRegistry(cb) {
  if (!db) { setTimeout(function(){ loadUserRegistry(cb); }, 500); return; }
  db.ref('admin/users').on('value', function(snap) {
    var raw = snap.val() || {};
    NX_USERS = {};
    Object.values(raw).filter(Boolean).forEach(function(u) {
      if (u.id) NX_USERS[u.id] = u;
    });
    if (cb) cb(NX_USERS);
  });
}

function saveUser(user, cb) {
  if (!db) { showToast('No Firebase connection','error'); return; }
  db.ref('admin/users/' + user.id).set(user, function(err) {
    if (err) { showToast('Save failed: ' + err.message, 'error'); return; }
    NX_USERS[user.id] = user;
    if (cb) cb();
  });
}

function deleteUser(userId, cb) {
  if (!db) return;
  db.ref('admin/users/' + userId).remove(function(err) {
    if (err) { showToast('Delete failed','error'); return; }
    delete NX_USERS[userId];
    if (cb) cb();
  });
}

// Get all branches accessible to a session (supports multi-branch directors)
// This replaces getAccessibleBranches for session-aware filtering

// Live branch registry loaded from admin/branches
var NX_BRANCHES = {};    // { branchId: {id, name, brand, location, manager, color, icon, pin, ...} }
var NX_BRANCH_SALES = {}; // { branchId: [sales entries] } — loaded on demand
var NX_LOADED_SALES = {}; // track which branches have sales loaded

// Minimal SEED kept only for login UI structure (loaded from Firebase, see loadBranchRegistry)
var SEED = { brands: {} };

// Load branch registry from admin/branches (same path as OpsHub)
function loadBranchRegistry(cb) {
  if (!db) { setTimeout(function(){ loadBranchRegistry(cb); }, 500); return; }
  db.ref('admin/branches').on('value', function(snap) {
    var raw = snap.val() || {};
    NX_BRANCHES = {};
    SEED.brands = {};

    Object.values(raw).filter(Boolean).forEach(function(b) {
      if (!b.id) return;
      NX_BRANCHES[b.id] = b;

      // Reconstruct SEED.brands from real Firebase data so login/nav still works
      var brandKey = (b.brand || b.name || b.id).toLowerCase().replace(/\s+/g,'_').replace(/[^a-z0-9_]/g,'');
      if (!SEED.brands[brandKey]) {
        SEED.brands[brandKey] = {
          config: {
            name: b.brand || b.name || b.id,
            icon: b.icon || '🍽️',
            color: b.color || '#f0a500',
            cuisine: b.cuisine || '',
            director: b.manager || ''
          },
          regions: {}
        };
      }
      var regionKey = (b.location || 'main').toLowerCase().replace(/\s+/g,'_').replace(/[^a-z0-9_]/g,'');
      if (!SEED.brands[brandKey].regions[regionKey]) {
        SEED.brands[brandKey].regions[regionKey] = {
          config: { name: b.location || 'Main', manager: b.manager || '' },
          branches: {}
        };
      }
      SEED.brands[brandKey].regions[regionKey].branches[b.id] = {
        config: {
          name: b.name, location: b.location || '', manager: b.manager || '',
          tables: b.tables || 0, seats: b.seats || 0, pin: String(b.pin || '')
        }
      };
    });

    // Rebuild NXMon accessible paths cache
    if (NXMon && NXMon.invalidateCache) NXMon.invalidateCache();

    if (cb) cb(NX_BRANCHES);

    // Load brand targets for brand-perf page
    db.ref('admin/brandTargets').once('value', function(s2) {
      NX.brandTargets = s2.val() || {};
    });

    // Update sidebar if already logged in
    if (NX.session) {
      renderSidebar();
      updateTopBar(NX.page);
      setTimeout(function(){ if(typeof patchIcons==='function') patchIcons(); }, 150);
    }
  });
}

// Load sales for one branch into NX_BRANCH_SALES

// ── OFFLINE / CONNECTION STATUS ──
function initConnectionMonitor() {
  if (!db) return;
  db.ref('.info/connected').on('value', function(snap) {
    var connected = snap.val();
    var banner = document.getElementById('nx-offline-banner');
    if (!banner) {
      banner = document.createElement('div');
      banner.id = 'nx-offline-banner';
      banner.style.cssText = 'position:fixed;bottom:20px;left:50%;transform:translateX(-50%);padding:10px 20px;border-radius:20px;font-size:12px;font-weight:700;font-family:var(--font);z-index:9999;transition:all .4s;pointer-events:none;display:none';
      document.body.appendChild(banner);
    }
    if (connected) {
      banner.style.display = 'none';
    } else {
      banner.style.cssText += ';display:block;background:#c0392b;color:#fff;box-shadow:0 4px 20px rgba(248,113,113,.4)';
      banner.innerHTML = '&#x26A0;&#xFE0F; Offline — Firebase disconnected';
    }
  });
}


function loadBranchSalesData(branchId, cb) {
  if (!db) return;
  if (NX_LOADED_SALES[branchId]) { if (cb) cb(); return; }
  db.ref('branches/' + branchId + '/sales').once('value', function(snap) {
    var raw = snap.val() || {};
    var entries = Array.isArray(raw) ? raw.filter(Boolean) : Object.values(raw).filter(Boolean);
    NX_BRANCH_SALES[branchId] = entries;
    NX_LOADED_SALES[branchId] = true;
    if (cb) cb();
  });
}

// Get all branches accessible to current session
function getAccessibleBranches() {
  var s = NX.session || {};
  var all = Object.values(NX_BRANCHES);
  if (!all.length) return [];

  if (s.role === 'super_admin' || s.role === 'ceo') return all;

  // Branch manager and staff — single branch
  if (s.role === 'branch_mgr' || s.role === 'staff') {
    return all.filter(function(b) { return b.id === s.branchId; });
  }

  // Brand Director or Area Manager — multi-branch via branchIds array
  if (s.role === 'brand_dir' || s.role === 'regional') {
    if (s.branchIds && s.branchIds.length) {
      return all.filter(function(b) { return s.branchIds.indexOf(b.id) >= 0; });
    }
    // Fallback: single branch (legacy)
    if (s.branchId) return all.filter(function(b){ return b.id === s.branchId; });
    return [];
  }
  return all;
}

// Calculate sales total for a branch from NX_BRANCH_SALES within date range
function branchSalesInRange(branchId, startDate, endDate) {
  var entries = NX_BRANCH_SALES[branchId] || [];
  return entries.reduce(function(sum, e) {
    if (e.date && e.date >= startDate && e.date <= endDate) return sum + (parseFloat(e.actual)||0);
    return sum;
  }, 0);
}

// Today's sales for a branch
function branchSalesToday(branchId) {
  return branchSalesInRange(branchId, TODAY_BS, TODAY_BS);
}

// MTD sales for a branch — optionally pass 'YYYY-MM' for a historical month
function branchSalesMTD(branchId, monthKey) {
  var tm = new Date();
  if (monthKey) {
    // historical month: sum full month
    var start = monthKey + '-01';
    var d = new Date(monthKey + '-01');
    var lastDay = new Date(d.getFullYear(), d.getMonth()+1, 0).getDate();
    var end = monthKey + '-' + String(lastDay).padStart(2,'0');
    return branchSalesInRange(branchId, start, end);
  }
  var start = tm.getFullYear() + '-' + String(tm.getMonth()+1).padStart(2,'0') + '-01';
  return branchSalesInRange(branchId, start, TODAY_BS);
}

// Load sales for all accessible branches (used by executive dashboard)
function loadAllBranchesSales(cb) {
  var branches = getAccessibleBranches();
  if (!branches.length) { if (cb) cb(); return; }
  var pending = branches.length;
  branches.forEach(function(b) {
    loadBranchSalesData(b.id, function() {
      pending--;
      if (pending === 0 && cb) cb();
    });
  });
}

// Real-time KPI aggregation from live Firebase data
function calcExecKPIs() {
  var branches = getAccessibleBranches();
  var totalToday = 0, totalMTD = 0;
  branches.forEach(function(b) {
    totalToday += branchSalesToday(b.id);
    totalMTD   += branchSalesMTD(b.id);
  });
  return {
    totalToday: totalToday,
    totalMTD: totalMTD,
    branchCount: branches.length,
    branchesOnline: branches.length
  };
}

// DEMO_METRICS kept as fallback when sales data not yet loaded
var DEMO_METRICS = {
  totalToday: 0, totalMTD: 0, staffTotal: 0, branchesOnline: 0,
  brands: {}
};

// Refresh DEMO_METRICS from live NX_BRANCH_SALES data
function refreshDemoMetrics() {
  var branches = getAccessibleBranches();
  DEMO_METRICS.totalToday = 0;
  DEMO_METRICS.totalMTD   = 0;
  DEMO_METRICS.branchesOnline = branches.length;
  branches.forEach(function(b) {
    DEMO_METRICS.totalToday += branchSalesToday(b.id);
    DEMO_METRICS.totalMTD   += branchSalesMTD(b.id);
  });
}


var DEMO_NOTIFICATIONS = []; // Populated by NXMon from real Firebase data

function renderNotifItem(n) {
  var typeColors = { danger:'rgba(248,113,113,.15)', warning:'rgba(245,158,11,.15)', info:'rgba(96,165,250,.15)' };
  var textColors = { danger:'#c0392b', warning:'#b45309', info:'#0057ff' };
  var bg = typeColors[n.type] || 'var(--surface-2)';
  var col = textColors[n.type] || 'var(--text-primary)';
  var ago = '';
  if (n.ts) {
    var diffMs = Date.now() - n.ts;
    if (diffMs < 60000) ago = 'just now';
    else if (diffMs < 3600000) ago = Math.floor(diffMs/60000) + 'm ago';
    else if (diffMs < 86400000) ago = Math.floor(diffMs/3600000) + 'h ago';
    else ago = Math.floor(diffMs/86400000) + 'd ago';
  } else {
    ago = n.time || '';
  }
  return '<div class="notif-item ' + (n.read ? '' : 'unread') + '" onclick="notifClick(' + n.id + ')" style="cursor:pointer">' +
    '<div class="notif-ni" style="background:' + bg + ';color:' + col + '">' + (n.icon || '🔔') + '</div>' +
    '<div class="notif-body">' +
      '<div class="notif-title">' + xe(n.title) + '</div>' +
      '<div class="notif-msg">' + xe(n.msg) + '</div>' +
      '<div class="notif-time">' + xe(n.branch || '') + (n.branch ? ' · ' : '') + ago + '</div>' +
    '</div>' +
  '</div>';
}

function _updateBadge() {
  NX.unreadCount = NX.notifications.filter(function(n) { return !n.read; }).length;
  var badge = document.getElementById('notif-count');
  if (badge) {
    badge.style.display = NX.unreadCount > 0 ? 'flex' : 'none';
    badge.textContent = NX.unreadCount;
  }
}

function renderNotifications() {
  // Sort by timestamp descending
  NX.notifications.sort(function(a, b) {
    return (b.ts || 0) - (a.ts || 0);
  });

  NX.unreadCount = NX.notifications.filter(function(n) { return !n.read; }).length;
  _updateBadge();

  var list = document.getElementById('notif-list');
  if (!list) return;

  // Filter bar state
  var filt = NX._notifFilter || 'all';
  var filtered = NX.notifications.filter(function(n) {
    if (filt === 'all') return true;
    if (filt === 'stock') return n.dedupId && n.dedupId.indexOf('stock') === 0;
    if (filt === 'health') return n.dedupId && n.dedupId.indexOf('hc') === 0;
    if (filt === 'checklist') return n.dedupId && n.dedupId.indexOf('cl') === 0;
    if (filt === 'finance') return n.dedupId && (n.dedupId.indexOf('inv') === 0);
    return true;
  });

  // Group by time
  var now = Date.now();
  var todayMs  = 24 * 3600 * 1000;
  var weekMs   = 7 * todayMs;

  var groups = { 'Live': [], 'Today': [], 'Earlier': [] };
  filtered.forEach(function(n) {
    var age = now - (n.ts || now);
    if (age < 3600000)       groups['Live'].push(n);
    else if (age < todayMs)  groups['Today'].push(n);
    else                     groups['Earlier'].push(n);
  });

  // Filter tabs
  var tabs = [
    { id:'all', label:'All', count: NX.notifications.length },
    { id:'stock', label:'📦 Stock', count: NX.notifications.filter(function(n){return n.dedupId&&n.dedupId.indexOf('stock')===0;}).length },
    { id:'health', label:'💳 Health', count: NX.notifications.filter(function(n){return n.dedupId&&n.dedupId.indexOf('hc')===0;}).length },
    { id:'checklist', label:'📋 Lists', count: NX.notifications.filter(function(n){return n.dedupId&&n.dedupId.indexOf('cl')===0;}).length },
    { id:'finance', label:'💰 Finance', count: NX.notifications.filter(function(n){return n.dedupId&&n.dedupId.indexOf('inv')===0;}).length }
  ];

  var html = '<div style="display:flex;gap:4px;padding:8px 12px;border-bottom:1px solid var(--border);overflow-x:auto;flex-shrink:0">';
  tabs.forEach(function(t) {
    var active = filt === t.id;
    html += '<button onclick="NX._notifFilter=\''+t.id+'\';renderNotifications()" style="padding:4px 10px;border-radius:20px;border:1px solid '+(active?'var(--border-strong)':'var(--border)')+';background:'+(active?'var(--surface-3)':'transparent')+';color:'+(active?'var(--text-primary)':'var(--text-secondary)')+';font-size:11px;cursor:pointer;white-space:nowrap;font-family:var(--font)">'+t.label+(t.count?'<span style="margin-left:4px;background:var(--surface-3);padding:1px 5px;border-radius:10px;font-size:10px">'+t.count+'</span>':'')+'</button>';
  });
  html += '</div>';

  if (!filtered.length) {
    html += '<div style="text-align:center;padding:40px 20px;color:var(--text-tertiary)"><div style="font-size:32px;margin-bottom:10px">🔔</div><div style="font-size:13px">No notifications</div></div>';
    list.innerHTML = html;
    return;
  }

  Object.keys(groups).forEach(function(groupName) {
    var items = groups[groupName];
    if (!items.length) return;
    html += '<div class="notif-group-label">'+groupName+'</div>';
    html += items.map(renderNotifItem).join('');
  });

  list.innerHTML = html;
}


function notifClick(id) {
  var n = NX.notifications.find(function(x){ return x.id === id; });
  if (n) {
    n.read = true;
    toggleNotifPanel();
    if (n.page) navTo(n.page);
    updateNotifBadge();
  }
}

function updateNotifBadge() { _updateBadge(); }

function markAllRead() {
  NX.notifications.forEach(function(n){ n.read = true; });
  renderNotifications();
  toggleNotifPanel();
}

function toggleNotifPanel() {
  var panel = document.getElementById('notif-panel');
  if (panel) panel.classList.toggle('open');
  if (panel && panel.classList.contains('open')) {
    renderNotifications();
  }
}

// ── THEME ──
function toggleTheme() {
  NX.theme = NX.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', NX.theme);
  localStorage.setItem('alfa_theme', NX.theme);
  var btn = document.getElementById('theme-btn');
  if (btn) btn.textContent = NX.theme === 'dark' ? '🌙' : '☀️';
  // Update all chart backgrounds
  Object.keys(NX.charts).forEach(function(k) {
    if (NX.charts[k]) { try { NX.charts[k].update(); } catch(e){} }
  });
}

// ── TOAST ──
function showToast(msg, type) {
  type = type || 'info';
  var wrap = document.getElementById('toast-wrap');
  if (!wrap) return;
  var t = document.createElement('div');
  t.className = 'toast toast-' + type;
  t.textContent = msg;
  wrap.appendChild(t);
  setTimeout(function() { t.remove(); }, 3500);
}

// ── MODAL ──
function openModal(html) {
  var ov = document.getElementById('modal-overlay');
  var mb = document.getElementById('modal-body');
  if (mb) mb.innerHTML = html;
  if (ov) ov.classList.add('open');
}

function closeModal(ev) {
  if (!ev || ev.target.id === 'modal-overlay') {
    document.getElementById('modal-overlay').classList.remove('open');
  }
}

function closeModalForce() {
  document.getElementById('modal-overlay').classList.remove('open');
}

// ── CLOCK ──
function updateClock() {
  var d = new Date();
  var h = String(d.getHours()).padStart(2,'0');
  var m = String(d.getMinutes()).padStart(2,'0');
  var s = String(d.getSeconds()).padStart(2,'0');
  var cl = document.getElementById('sb-clock');
  if (cl) cl.textContent = h + ':' + m + ':' + s;
  var dt = document.getElementById('sb-date');
  if (dt) dt.textContent = fmtDate(d);
  // sync time
  var sync = document.getElementById('sb-sync');
  if (sync && NX.lastSync) {
    var diff = Math.floor((Date.now() - NX.lastSync) / 1000);
    sync.textContent = diff < 10 ? 'just now' : diff + 's ago';
  }
}

// ── CHART HELPERS ──
function destroyChart(id) {
  if (NX.charts[id]) {
    NX.charts[id].destroy();
    delete NX.charts[id];
  }
}

function chartDefaults() {
  // Read actual CSS variables so charts work on both light and dark themes
  var cs = getComputedStyle(document.documentElement);
  var isDark = (cs.getPropertyValue('--body-bg').trim() || '').indexOf('0,0') !== -1 || document.documentElement.classList.contains('dark');
  var tickCol = isDark ? 'rgba(255,255,255,.45)' : 'rgba(8,12,28,.50)';
  var gridCol = isDark ? 'rgba(255,255,255,.06)' : 'rgba(8,12,28,.06)';
  var legendCol = isDark ? 'rgba(255,255,255,.65)' : 'rgba(8,12,28,.75)';
  var tooltipBg = isDark ? 'rgba(10,12,20,.95)' : 'rgba(255,255,255,.97)';
  var tooltipBorder = isDark ? 'rgba(255,255,255,.15)' : 'rgba(8,12,28,.12)';
  var tooltipTitle = isDark ? 'rgba(255,255,255,.9)' : 'rgba(8,12,28,.9)';
  var tooltipBody = isDark ? 'rgba(255,255,255,.6)' : 'rgba(8,12,28,.65)';
  return {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        labels: {
          color: legendCol,
          font: { family:'DM Sans', size:12 },
          boxWidth: 10, boxHeight:10, borderRadius:3
        }
      },
      tooltip: {
        backgroundColor: tooltipBg,
        borderColor: tooltipBorder,
        borderWidth: 1,
        titleColor: tooltipTitle,
        bodyColor: tooltipBody,
        padding: 12,
        titleFont: { family:'Syne', size:13, weight:'700' },
        bodyFont: { family:'DM Sans', size:12 }
      }
    },
    scales: {
      x: {
        grid: { color: gridCol },
        ticks: { color: tickCol, font:{ family:'DM Sans', size:11 } }
      },
      y: {
        grid: { color: gridCol },
        ticks: { color: tickCol, font:{ family:'DM Sans', size:11 } }
      }
    }
  };
}

// ── LIVE LISTENERS ──
function clearLiveListeners() {
  NX.liveListeners.forEach(function(ref) { try { ref.off(); } catch(e){} });
  NX.liveListeners = [];
}


// ══════════════════════════════════════════════════════
// LOGIN USER MANAGER (LUM)
// ══════════════════════════════════════════════════════
var _lumPin = '', _lumAuthed = false;

function openLoginUserMgr() {
  _lumPin = ''; _lumAuthed = false;
  var ov = document.getElementById('lum-overlay');
  var gate = document.getElementById('lum-gate');
  var panel = document.getElementById('lum-panel');
  if (!ov) return;
  ov.style.display = 'block';
  gate.style.display = 'block';
  panel.style.display = 'none';
  _lumDots();
  var e = document.getElementById('lum-gate-err'); if (e) e.textContent = '';
}

function closeLoginUserMgr() {
  var ov = document.getElementById('lum-overlay');
  if (ov) ov.style.display = 'none';
  _lumPin = ''; _lumAuthed = false;
}

function _lumDots() {
  for (var i = 0; i < 4; i++) {
    var d = document.getElementById('lgd' + i);
    if (!d) continue;
    d.style.background = i < _lumPin.length ? '#f0a500' : 'transparent';
    d.style.borderColor = i < _lumPin.length ? '#f0a500' : 'rgba(255,255,255,.28)';
  }
}

function lumKey(n) {
  if (_lumAuthed || _lumPin.length >= 4) return;
  _lumPin += String(n);
  _lumDots();
  if (_lumPin.length === 4) setTimeout(_lumCheckPin, 200);
}

function lumKeyDel() {
  _lumPin = _lumPin.slice(0, -1);
  _lumDots();
}

function _lumCheckPin() {
  var correct = (typeof ACCESS !== 'undefined' && ACCESS.superAdmin) ? String(ACCESS.superAdmin.pin) : '0989';
  if (_lumPin === correct) {
    _lumAuthed = true;
    document.getElementById('lum-gate').style.display = 'none';
    document.getElementById('lum-panel').style.display = 'block';
    lumLoadUsers();
  } else {
    _lumPin = ''; _lumDots();
    var e = document.getElementById('lum-gate-err');
    if (e) { e.textContent = 'Incorrect PIN — try again'; setTimeout(function(){ e.textContent=''; }, 2000); }
  }
}

var LUM_ROLES = {
  brand_dir:   { label:'Brand Director', icon:'🎯', color:'#5b21b6' },
  regional:    { label:'Area Manager',   icon:'🗺️', color:'#0057ff' },
  branch_mgr:  { label:'Branch Manager', icon:'🏪', color:'#00875a' },
  ceo:         { label:'CEO',            icon:'👑', color:'#b45309' },
  hr_manager:  { label:'HR Manager',     icon:'🧑‍💼', color:'#94a3b8' },
  finance_dir: { label:'Finance Dir',    icon:'💰', color:'#b45309' }
};

function lumLoadUsers() {
  var el = document.getElementById('lum-list');
  if (!el) return;
  el.innerHTML = '<div style="text-align:center;padding:24px;color:rgba(255,255,255,.22);font-size:12px">Loading from Firebase\u2026</div>';
  if (!db) {
    el.innerHTML = '<div style="text-align:center;padding:24px;color:#c0392b;font-size:12px">Firebase not connected yet. Try again in a moment.</div>';
    return;
  }
  db.ref('admin/users').once('value', function(snap) {
    var users = [];
    var raw = snap.val() || {};
    Object.values(raw).forEach(function(u) { if (u && u.id) users.push(u); });
    if (typeof NX_USERS !== 'undefined') {
      NX_USERS = {};
      users.forEach(function(u) { NX_USERS[u.id] = u; });
    }
    if (!users.length) {
      el.innerHTML = '<div style="text-align:center;padding:28px;color:rgba(255,255,255,.22);font-size:12px;font-style:italic">No users yet \u2014 add one above</div>';
      return;
    }
    var h = '<div style="display:flex;flex-direction:column;gap:8px">';
    users.sort(function(a,b){ return (a.name||'').localeCompare(b.name||''); }).forEach(function(u) {
      var rm = LUM_ROLES[u.role] || { label: u.role||'User', icon:'👤', color:'#94a3b8' };
      var sid = _lxe(u.id), sname = _lxe(u.name||'');
      h += '<div style="background:rgba(255,255,255,.035);border:1px solid rgba(255,255,255,.07);border-radius:10px;padding:11px 14px;display:flex;align-items:center;gap:10px;flex-wrap:wrap">';
      h += '<div style="width:33px;height:33px;border-radius:8px;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:15px;background:'+rm.color+'1a">'+rm.icon+'</div>';
      h += '<div style="flex:1;min-width:100px"><div style="font-size:13px;font-weight:700;color:#fff">'+sname+'</div>';
      h += '<div style="font-size:10px;color:rgba(255,255,255,.38);margin-top:2px">'+rm.label+(u.branchIds&&u.branchIds.length?' &middot; '+u.branchIds.length+' branch(es)':'')+'</div></div>';
      h += '<div style="font-family:monospace;font-size:12px;color:'+rm.color+';background:'+rm.color+'18;padding:3px 9px;border-radius:6px;letter-spacing:2px">PIN\u00a0'+_lxe(String(u.pin||'\u2014'))+'</div>';
      h += '<div style="display:flex;gap:6px">';
      h += '<button onclick="lumOpenEdit(\''+sid+'\')" style="background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.1);color:rgba(255,255,255,.7);border-radius:7px;padding:5px 12px;cursor:pointer;font-size:11px;font-weight:600">Edit</button>';
      h += '<button onclick="lumDelUser(\''+sid+'\',\''+sname+'\')" style="background:rgba(248,113,113,.07);border:1px solid rgba(248,113,113,.25);color:#c0392b;border-radius:7px;padding:5px 12px;cursor:pointer;font-size:11px;font-weight:600">Delete</button>';
      h += '</div></div>';
    });
    h += '</div>';
    el.innerHTML = h;
  }, function(err) {
    el.innerHTML = '<div style="padding:16px;color:#c0392b;font-size:12px;text-align:center">Permission denied \u2014 set Firebase rules to allow read/write.</div>';
    console.error('lumLoadUsers:', err);
  });
}

function lumAddUser() {
  var name = (_gv('lum-name')||'').trim();
  var pin  = (_gv('lum-pin') ||'').trim();
  var role = _gv('lum-role') || 'brand_dir';
  var bid  = (_gv('lum-bid') ||'').trim();
  var errEl = document.getElementById('lum-add-err');
  function setErr(m){ if(errEl) errEl.textContent=m; }
  if (!name)                                          { setErr('Name is required'); return; }
  if (!pin||pin.length<4||!/^\d+$/.test(pin))         { setErr('PIN must be 4\u20138 digits'); return; }
  var conflict = typeof NX_USERS!=='undefined' && Object.values(NX_USERS).find(function(u){ return String(u.pin||'')===pin; });
  if (conflict)                                       { setErr('PIN already used by '+(conflict.name||conflict.id)); return; }
  if (!db)                                            { setErr('Firebase not connected'); return; }
  setErr('Saving\u2026');
  var uid = 'usr_'+Date.now();
  var user = { id:uid, name:name, pin:pin, role:role, active:true,
               createdAt:new Date().toISOString(),
               branchIds: bid ? bid.split(',').map(function(s){return s.trim();}).filter(Boolean) : [] };
  db.ref('admin/users/'+uid).set(user, function(err) {
    if (err) { setErr('Firebase error: '+err.message+' \u2014 check rules'); return; }
    if (typeof NX_USERS!=='undefined') NX_USERS[uid]=user;
    setErr('');
    ['lum-name','lum-pin','lum-bid'].forEach(function(id){ var e=document.getElementById(id); if(e) e.value=''; });
    lumLoadUsers();
    _lumToast('\u2705 User "'+name+'" created');
  });
}

function lumOpenEdit(uid) {
  if (!db) return;
  db.ref('admin/users/'+uid).once('value', function(snap) {
    var u = snap.val(); if (!u) { _lumToast('User not found',true); return; }
    var opts = Object.keys(LUM_ROLES).map(function(k){
      return '<option value="'+k+'"'+(u.role===k?' selected':'')+'>'+LUM_ROLES[k].icon+' '+LUM_ROLES[k].label+'</option>';
    }).join('');
    var INP = 'width:100%;box-sizing:border-box;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);border-radius:7px;color:#fff;padding:8px 10px;outline:none;';
    var form =
      '<div style="background:rgba(240,165,0,.06);border:1px solid rgba(240,165,0,.22);border-radius:11px;padding:16px;margin-bottom:10px">'+
      '<div style="font-size:10px;font-weight:700;color:#b45309;letter-spacing:.08em;text-transform:uppercase;margin-bottom:12px">&#x270F;&#xFE0F; Editing: '+_lxe(u.name||uid)+'</div>'+
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:9px;margin-bottom:9px">'+
        '<div><div style="font-size:10px;color:rgba(255,255,255,.4);margin-bottom:3px">Name</div>'+
        '<input id="lume-name" value="'+_lxe(u.name||'')+'" style="'+INP+'font-size:13px;font-family:inherit"></div>'+
        '<div><div style="font-size:10px;color:rgba(255,255,255,.4);margin-bottom:3px">PIN</div>'+
        '<input id="lume-pin" value="'+_lxe(String(u.pin||''))+'" maxlength="8" style="'+INP+'font-size:15px;font-family:monospace;letter-spacing:3px"></div>'+
      '</div>'+
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:9px;margin-bottom:11px">'+
        '<div><div style="font-size:10px;color:rgba(255,255,255,.4);margin-bottom:3px">Role</div>'+
        '<select id="lume-role" style="'+INP+'background:rgba(20,26,48,1);font-size:13px">'+opts+'</select></div>'+
        '<div><div style="font-size:10px;color:rgba(255,255,255,.4);margin-bottom:3px">Branch IDs</div>'+
        '<input id="lume-bid" value="'+_lxe((u.branchIds||[]).join(','))+'" style="'+INP+'font-size:12px;font-family:monospace"></div>'+
      '</div>'+
      '<div id="lume-err" style="color:#c0392b;font-size:11px;min-height:14px;margin-bottom:8px"></div>'+
      '<div style="display:flex;gap:8px">'+
        '<button onclick="lumSaveEdit(\''+_lxe(uid)+'\')" style="flex:1;background:linear-gradient(135deg,#f0a500,#f5be45);border:none;color:#000;font-size:12px;font-weight:700;padding:9px;border-radius:8px;cursor:pointer">&#x1F4BE; Save</button>'+
        '<button onclick="lumLoadUsers()" style="background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.1);color:rgba(255,255,255,.6);border-radius:8px;padding:9px 14px;cursor:pointer;font-size:12px">Cancel</button>'+
      '</div></div>';
    var el = document.getElementById('lum-list');
    if (el) el.innerHTML = form + el.innerHTML;
  });
}

function lumSaveEdit(uid) {
  var name = (_gv('lume-name')||'').trim();
  var pin  = (_gv('lume-pin') ||'').trim();
  var role = _gv('lume-role')||'brand_dir';
  var bid  = (_gv('lume-bid') ||'').trim();
  var errEl = document.getElementById('lume-err');
  function setErr(m){ if(errEl) errEl.textContent=m; }
  if (!name)                                         { setErr('Name required'); return; }
  if (!pin||pin.length<4||!/^\d+$/.test(pin))        { setErr('PIN must be 4-8 digits'); return; }
  var conflict = typeof NX_USERS!=='undefined' && Object.values(NX_USERS).find(function(u){ return u.id!==uid && String(u.pin||'')===pin; });
  if (conflict)                                      { setErr('PIN used by '+(conflict.name||conflict.id)); return; }
  if (!db)                                           { setErr('Firebase not connected'); return; }
  setErr('Saving\u2026');
  var branchIds = bid ? bid.split(',').map(function(s){return s.trim();}).filter(Boolean) : [];
  var updates = { name:name, pin:pin, role:role, branchIds:branchIds, updatedAt:new Date().toISOString() };
  db.ref('admin/users/'+uid).update(updates, function(err) {
    if (err) { setErr('Error: '+err.message); return; }
    if (typeof NX_USERS!=='undefined' && NX_USERS[uid]) Object.assign(NX_USERS[uid], updates);
    lumLoadUsers();
    _lumToast('\u2705 User updated');
  });
}

function lumDelUser(uid, name) {
  if (!confirm('Delete user "'+(name||uid)+'"? This cannot be undone.')) return;
  if (!db) { _lumToast('Firebase not connected',true); return; }
  db.ref('admin/users/'+uid).remove(function(err) {
    if (err) { _lumToast('Error: '+err.message,true); return; }
    if (typeof NX_USERS!=='undefined') delete NX_USERS[uid];
    lumLoadUsers();
    _lumToast('\u{1F5D1} User deleted');
  });
}

function _gv(id){ var e=document.getElementById(id); return e?e.value:''; }
function _lxe(s){ return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }
function _lumToast(msg, isErr) {
  var t=document.createElement('div');
  t.textContent=msg;
  t.style.cssText='position:fixed;bottom:74px;left:50%;transform:translateX(-50%);z-index:9999;pointer-events:none;'+
    'background:'+(isErr?'rgba(127,29,29,.97)':'rgba(20,83,45,.97)')+';color:#fff;padding:10px 22px;border-radius:11px;'+
    'font-size:13px;font-weight:600;box-shadow:0 4px 24px rgba(0,0,0,.5);white-space:nowrap';
  document.body.appendChild(t);
  setTimeout(function(){ if(t.parentNode) t.parentNode.removeChild(t); },2800);
}
// ── END LOGIN USER MANAGER ──────────────────────────────────────────────────

// ── LOGIN SYSTEM ──
var loginState = { step:0, role:null, pin:'', entityId:null, brandId:null, regionId:null, branchId:null };

function renderLogin(step) {
  loginState.step = step;
  var card = document.getElementById('login-card');
  if (!card) return;
  if (step === 0) renderLoginStep0(card);
  else if (step === 1) renderLoginStep1(card);
  else if (step === 2) renderLoginPIN(card);
}

function renderLoginStep0(card) {
  var roles = [
    { id:'super_admin', label:'Super Admin',      sub:'Full system control',           icon:'🔑', color:'#c0392b' },
    { id:'ceo',         label:'CEO / Executive',  sub:'Company-wide overview',         icon:'👑', color:'#b45309' },
    { id:'brand_dir',   label:'Brand Director',   sub:'Enter PIN → auto-login',        icon:'🎯', color:'#5b21b6' },
    { id:'regional',    label:'Area Manager',     sub:'Enter PIN → auto-login',        icon:'🗺️', color:'#0057ff' },
    { id:'branch_mgr',  label:'Branch Manager',   sub:'Select branch + enter PIN',     icon:'🏪', color:'#b45309' },
    { id:'hr_manager',  label:'HR Manager',        sub:'Enter PIN → auto-login',        icon:'🧑‍💼', color:'#94a3b8' },
    { id:'finance_dir', label:'Finance Director',  sub:'Enter PIN → auto-login',        icon:'💰', color:'#b45309' },
  ];
  card.innerHTML =
    '<div class="login-step-title">Select Your Role</div>' +
    '<div class="role-grid">' +
    roles.map(function(r) {
      return '<div class="role-card" onclick="selectRole(\'' + r.id + '\')" style="--role-color:' + r.color + '">' +
        '<div class="role-icon" style="background:' + r.color + '18;color:' + r.color + '">' + r.icon + '</div>' +
        '<div class="role-label"><strong>' + r.label + '</strong>' + r.sub + '</div>' +
      '</div>';
    }).join('') +
    '<div class="role-card" onclick="openStaffPortal()" style="--role-color:#006666">' +
      '<div class="role-icon" style="background:#00666618;color:#006666">👤</div>' +
      '<div class="role-label"><strong>Staff Member</strong>Login with SAP number + PIN</div>' +
    '</div>' +
    '</div>';
}

function openStaffPortal() {
  window.open('staff-portal.html', '_blank');
}

function selectRole(roleId) {
  // Reset any leftover state from previous selections
  loginState.role      = roleId;
  loginState.pin       = '';
  loginState.entityId  = null;
  loginState.branchId  = null;
  loginState.branchName= null;
  loginState.brandName = null;
  loginState.regionName= null;
  // super_admin, ceo, brand_dir, regional — go straight to PIN
  // Their branch/brand assignments are looked up from Firebase AFTER PIN verification
  if (roleId === 'super_admin' || roleId === 'ceo' ||
      roleId === 'brand_dir'   || roleId === 'regional' ||
      roleId === 'hr_manager'  || roleId === 'finance_dir') {
    renderLogin(2);
  } else if (roleId === 'branch_mgr') {
    renderLoginEntitySelect('branch');
  } else {
    // staff — pick branch then straight to dashboard
    renderLoginEntitySelect('branch');
  }
}

function renderLoginEntitySelect(type) {
  var card = document.getElementById('login-card');
  var typeLabel = { brand:'Brand', region:'Region', branch:'Branch' }[type];
  var branches = Object.values(NX_BRANCHES);

  // If Firebase hasn't loaded branches yet, show loading and retry
  if (!branches.length) {
    card.innerHTML = '<button class="login-back-btn" onclick="renderLogin(0)">← Back</button>' +
      '<div class="login-step-title">Select ' + typeLabel + '</div>' +
      '<div style="text-align:center;padding:40px 20px;color:var(--text-secondary)">' +
      '<div style="font-size:28px;margin-bottom:12px">⏳</div>' +
      '<div style="font-size:13px;margin-bottom:6px">Loading branches from Firebase…</div>' +
      '<div style="font-size:11px;color:var(--text-tertiary)">Please wait</div>' +
      '</div>';
    // Retry every 400ms until branches are loaded
    setTimeout(function() { renderLoginEntitySelect(type); }, 400);
    return;
  }

  var items = [];
  if (type === 'brand') {
    var seen = {};
    branches.forEach(function(b) {
      var bname = b.brand || b.name;
      if (!seen[bname]) {
        seen[bname] = true;
        items.push({ id: bname, name: bname, sub: b.location || '', icon: b.icon || '🍽️' });
      }
    });
  } else if (type === 'region') {
    var seen2 = {};
    branches.forEach(function(b) {
      var key = (b.brand||b.name) + '|' + (b.location||'Main');
      if (!seen2[key]) {
        seen2[key] = true;
        items.push({ id: key, name: (b.brand||b.name) + ' — ' + (b.location||'Main'), sub: b.manager || '', icon: b.icon || '🍽️' });
      }
    });
  } else {
    // All branches sorted by name
    branches.slice().sort(function(a,b){ return (a.name||'').localeCompare(b.name||''); }).forEach(function(b) {
      items.push({ id: b.id, name: b.name || b.id, sub: (b.brand||'') + (b.location?' · '+b.location:''), icon: b.icon || '🍽️' });
    });
  }

  card.innerHTML = '<button class="login-back-btn" onclick="renderLogin(0)">← Back</button>' +
    '<div class="login-step-title">Select ' + typeLabel + '</div>' +
    '<input class="login-input" type="text" placeholder="Search..." oninput="filterEntityList(this.value)" style="margin-bottom:8px">' +
    '<div class="entity-list" id="entity-list">' +
    (items.length ? items.map(function(item) {
      return '<div class="entity-item" data-id="' + xe(item.id) + '" onclick="selectEntity(\'' + xe(item.id) + '\',\'' + type + '\')">' +
        '<span style="font-size:20px">' + item.icon + '</span>' +
        '<div style="flex:1"><strong style="color:var(--text-primary)">' + xe(item.name) + '</strong>' +
        '<div style="font-size:11px;color:var(--text-tertiary);margin-top:2px">' + xe(item.sub) + '</div></div>' +
        '<span style="color:var(--text-tertiary);font-size:16px">›</span>' +
      '</div>';
    }).join('') : '<div style="text-align:center;padding:20px;color:var(--text-tertiary)">No ' + typeLabel + 's found</div>') +
  '</div>';
}

function filterEntityList(q) {
  var items = document.querySelectorAll('#entity-list .entity-item');
  var lq = q.toLowerCase();
  items.forEach(function(el) {
    el.style.display = el.textContent.toLowerCase().includes(lq) ? '' : 'none';
  });
}

function selectEntity(id, type) {
  loginState.entityId = id;
  if (type === 'brand') {
    loginState.brandName = id;
  } else if (type === 'region') {
    var parts = id.split('|');
    loginState.brandName = parts[0];
    loginState.regionName = parts[1];
  } else {
    // id is the branchId directly
    loginState.branchId = id;
    var b = NX_BRANCHES[id] || {};
    loginState.brandName  = b.brand || b.name || '';
    loginState.regionName = b.location || '';
    loginState.branchName = b.name || id;
  }
  renderLogin(2);
}

function renderLoginPIN(card) {
  loginState.pin = '';
  var role = loginState.role || '';
  var branch = loginState.branchId ? (NX_BRANCHES[loginState.branchId]||{}) : null;

  // Role-specific headings & hints
  var roleHints = {
    super_admin: { icon:'🔑', title:'Super Admin', hint:'Enter system PIN: ••••', color:'var(--super-admin)' },
    ceo:         { icon:'👑', title:'CEO Access',  hint:'Enter CEO PIN',         color:'var(--ceo)' },
    brand_dir:   { icon:'🎯', title:'Brand Director', hint:'Enter your personal Director PIN (set by Admin/CEO)', color:'var(--brand-dir)' },
    regional:    { icon:'🗺️', title:'Area Manager',   hint:'Enter your personal Area Manager PIN (set by Director)', color:'var(--regional)' },
    branch_mgr:  { icon:'🏪', title:branch ? xe(branch.name||'Branch') : 'Branch Manager', hint:'Enter branch PIN', color:'var(--branch-mgr)' },
    hr_manager:  { icon:'🧑‍💼', title:'HR Manager',       hint:'Enter your personal HR PIN (set by Admin)', color:'#94a3b8' },
    finance_dir: { icon:'💰', title:'Finance Director', hint:'Enter your personal Finance PIN (set by Admin)', color:'#b45309' },
    staff:       { icon:'👤', title:'Staff',        hint:'No PIN required — tap Login', color:'var(--staff)' }
  };
  var rh = roleHints[role] || roleHints.branch_mgr;

  card.innerHTML =
    '<button class="login-back-btn" onclick="renderLogin(0)">← Back</button>' +
    '<div style="text-align:center;margin-bottom:20px">' +
      '<div style="font-size:36px;margin-bottom:6px">' + rh.icon + '</div>' +
      '<div class="login-step-title" style="color:' + rh.color + '">' + rh.title + '</div>' +
      (branch && (role === 'branch_mgr' || role === 'staff') ? '<div style="font-size:12px;color:var(--text-secondary);margin-top:4px">' + xe(branch.name||'') + (branch.location?' · '+xe(branch.location):'') + '</div>' : '') +
      '<div style="font-size:11px;color:var(--text-tertiary);margin-top:8px">' + rh.hint + '</div>' +
    '</div>' +
    '<div class="pin-dots" id="pin-dots"><span id="pd0" class="pin-dot"></span><span id="pd1" class="pin-dot"></span><span id="pd2" class="pin-dot"></span><span id="pd3" class="pin-dot"></span></div>' +
    '<div id="pin-error" style="color:var(--danger);font-size:12px;text-align:center;min-height:18px;margin:4px 0 10px"></div>' +
    (role === 'staff' ?
      '<button class="btn btn-primary" style="width:100%;margin-top:8px" onclick="verifyPIN()">Login →</button>' :
      '<div class="pin-pad">' +
        [1,2,3,4,5,6,7,8,9,'',0,'⌫'].map(function(k) {
          return k === '' ?
            '<div style="visibility:hidden"></div>' :
            '<button class="pin-btn" onclick="' + (k==='⌫' ? 'pinBackspace()' : 'pinDigit(' + k + ')') + '">' + k + '</button>';
        }).join('') +
      '</div>'
    );
}

function pinPress(n) {
  if (loginState.pin.length >= 4) return;
  loginState.pin += n;
  updatePinDots();
  if (loginState.pin.length === 4) verifyPIN();
}

function pinDel() {
  loginState.pin = loginState.pin.slice(0,-1);
  updatePinDots();
}

function pinDigit(d) {
  if (loginState.pin.length >= 8) return;
  loginState.pin += String(d);
  updatePinDots();
  // Auto-submit when 4 digits entered (most PINs are 4 digits)
  if (loginState.pin.length >= 4) {
    // Small delay so user sees the last dot fill
    setTimeout(verifyPIN, 180);
  }
}

function pinBackspace() {
  loginState.pin = loginState.pin.slice(0, -1);
  updatePinDots();
}

function updatePinDots() {
  for (var i = 0; i < 4; i++) {
    var d = document.getElementById('pd' + i);
    if (d) d.classList.toggle('filled', i < loginState.pin.length);
  }
}

// System-level PINs (branch manager PINs come from admin/branches in Firebase)
var ACCESS = {
  superAdmin: { pin: '0989' },
  ceo:        { pin: '0090' },
  brandDir:   { pin: '2222' },
  regional:   { pin: '3333' }
};

function verifyPIN() {
  var role  = loginState.role;
  var pin   = loginState.pin;
  var valid = false;

  // ── System PINs ──────────────────────────────────────────────────────────
  if (role === 'super_admin' && pin === ACCESS.superAdmin.pin) {
    valid = true;
  } else if (role === 'ceo' && pin === ACCESS.ceo.pin) {
    valid = true;

  // ── Branch Manager: PIN from admin/branches ───────────────────────────────
  } else if (role === 'branch_mgr') {
    var brObj   = NX_BRANCHES[loginState.branchId] || {};
    var realPin = String(brObj.pin || '');
    valid = realPin.length > 0 && pin === realPin;
    if (!valid && !realPin.length) {
      var errEl = document.getElementById('pin-error');
      if (errEl) errEl.textContent = 'Branch data not yet loaded — please wait and retry.';
      loginState.pin = ''; updatePinDots(); return;
    }

  // ── Staff: no PIN ─────────────────────────────────────────────────────────
  } else if (role === 'staff') {
    valid = true;

  // ── Brand Director / Area Manager: PIN from admin/users ──────────────────
  // admin/users/{id} = {id, name, role, pin, branchIds:[...], ...}
  } else if (role === 'brand_dir' || role === 'regional' || role === 'hr_manager' || role === 'finance_dir') {
    // Search admin/users for a user with matching role + PIN
    var matchedUser = null;
    Object.values(NX_USERS).forEach(function(u) {
      if (u.role === role && String(u.pin || '') === pin && u.active !== false) {
        matchedUser = u;
      }
    });

    if (matchedUser) {
      valid = true;
      loginState.userId     = matchedUser.id;
      loginState.userName   = matchedUser.name || '';
      loginState.branchIds  = matchedUser.branchIds || Object.keys(NX_BRANCHES);
      loginState.brandName  = matchedUser.brandName  || '';
      loginState.regionName = matchedUser.regionName || '';
      if (loginState.branchIds.length === 1) {
        loginState.branchId = loginState.branchIds[0];
      }
    } else if (!Object.keys(NX_USERS).length) {
      var errEl2 = document.getElementById('pin-error');
      if (errEl2) errEl2.textContent = 'User data loading… please wait and try again.';
      loginState.pin = ''; updatePinDots(); return;
    }
  }

  if (!valid) {
    var errEl3 = document.getElementById('pin-error');
    if (errEl3) errEl3.textContent = 'Incorrect PIN — please try again.';
    loginState.pin = ''; updatePinDots(); return;
  }

  // ── Build session ─────────────────────────────────────────────────────────
  var sess = { role: role };
  if (role === 'super_admin' || role === 'ceo') {
    sess.entityName = 'ALFA.CO';

  } else if (role === 'brand_dir' || role === 'regional') {
    sess.userId     = loginState.userId    || '';
    sess.userName   = loginState.userName  || '';
    sess.branchIds  = loginState.branchIds || [];
    sess.branchId   = loginState.branchId  || (loginState.branchIds[0] || '');
    sess.brandName  = loginState.brandName  || '';
    sess.regionName = loginState.regionName || '';
    var firstBranch = NX_BRANCHES[sess.branchId] || {};
    sess.branchName = firstBranch.name || '';
    sess.entityName = loginState.userName || (role === 'brand_dir' ? 'Brand Director' : 'Area Manager');

  } else if (role === 'hr_manager' || role === 'finance_dir') {
    sess.userId     = loginState.userId   || '';
    sess.userName   = loginState.userName || (role === 'hr_manager' ? 'HR Manager' : 'Finance Director');
    sess.entityName = sess.userName;
    sess.branchIds  = loginState.branchIds || Object.keys(NX_BRANCHES);

  } else if (role === 'branch_mgr' || role === 'staff') {
    var branchId4 = loginState.branchId;
    var bObj4     = NX_BRANCHES[branchId4] || {};
    sess.branchId   = branchId4;
    sess.branchIds  = [branchId4];
    sess.branchName = bObj4.name     || loginState.branchName || branchId4;
    sess.brandName  = bObj4.brand    || loginState.brandName  || '';
    sess.regionName = bObj4.location || loginState.regionName || '';
    sess.entityName = sess.branchName;
  }

  saveSession(sess);
  launchApp();
}

// ── APP LAUNCH ──
function launchApp() {
  var login = document.getElementById('login-screen');
  if (login) login.style.display = 'none';
  var app = document.getElementById('app');
  if (app) { app.style.display = ''; app.classList.add('visible'); }
  renderSidebar();
  renderNotifications();

  // Load theme
  var savedTheme = localStorage.getItem('alfa_theme') || 'dark';
  NX.theme = savedTheme;
  document.documentElement.setAttribute('data-theme', savedTheme);
  var tb = document.getElementById('theme-btn');
  if (tb) tb.textContent = savedTheme === 'dark' ? '🌙' : '☀️';

  // Nav to default page
  var role = NX.session && NX.session.role;
  if (!role) {
    // No valid session — return to login screen
    var _appEl = document.getElementById('app');
    var _loginEl = document.getElementById('login-screen');
    if (_appEl) { _appEl.classList.remove('visible'); _appEl.style.display = 'none'; }
    if (_loginEl) { _loginEl.style.display = ''; }
    renderLogin(0);
    return;
  }
  var defaultPages = {
    'super_admin':'exec-dash','ceo':'exec-dash','brand_dir':'brand-dash',
    'regional':'region-dash','branch_mgr':'branch-dash','staff':'branch-dash',
    'hr_manager':'hrf-hr-dash','finance_dir':'hrf-fin-dash'
  };
  // Restore last visited page if it belongs to this role
  var lastPage = null;
  try { lastPage = localStorage.getItem('nx_last_page'); } catch(e) {}
  var restored = false;
  if (lastPage) {
    var roleNav = NAV_CONFIG[role] || [];
    var allNavIds = [];
    roleNav.forEach(function(sec){ (sec.items||[]).forEach(function(it){ allNavIds.push(it.id); }); });
    if (allNavIds.indexOf(lastPage) >= 0) {
      navTo(lastPage);
      restored = true;
    }
  }
  if (!restored) navTo(defaultPages[role] || 'exec-dash');
  NX.lastSync = Date.now();
}

// ══════════════════════════════════════════════════════
// PAGE RENDERERS
// ══════════════════════════════════════════════════════

function renderPage(pageId) {
  var area = document.getElementById('page-area');
  if (!area) return;
  // Destroy all existing charts
  Object.keys(NX.charts).forEach(function(k) {
    if (NX.charts[k]) { try { NX.charts[k].destroy(); } catch(e){} }
  });
  NX.charts = {};

  var fns = {
    'exec-dash': pExecDash,
    'brand-perf': pBrandPerf,
    'rev-analytics': pRevAnalytics,
    'headcount': pHeadcount,
    'food-cost': pFoodCost,
    'alerts-center': pAlerts,
    'brand-mgmt': pBrandMgmt,
    'access-ctrl': pAccessCtrl,
    'audit-log': pAuditLog,
    'shared-ingredients': pSharedIngredients,
    'brand-dash': pBrandDash,
    'brand-branches': pBrandBranches,
    'region-dash': pRegionDash,
    'region-branches': pRegionBranches,
    'branch-dash': pBranchDash,
    'inv-items': pInvItems,
    'inv-moves': pInvMoves,
    'inv-orders': pInvOrders,
    'low-stock': pLowStock,
    'inv-report': pInvReport,
    'wastage': pWastage,
    'staff': pStaff,
    'schedule': pSchedule,
    'timesheet': pTimesheet,
    'health-cards': pHealthCards,
    'sales': pSales,
    'petty-cash': pPettyCash,
    'dsr': pDSR,
    'checklists':        pChecklists,
    'qr-checkin':        pQRCheckin,
    // ── Branch Manager new pages ──
    'bm-invoices':       pBmInvoices,
    'bm-leave':          pBmLeave,
    'bm-payroll':        pBmPayroll,
    'bm-transfers':      pBmTransfers,
    'bm-compliance':      pBmCompliance,
    'bm-assets':          pBmAssets,
    'bm-announcements':  pBmAnnouncements,
    'bm-music-player':   function(){
      var s=NX.session||{};
      var url='music-player.html'+(s.branchId?'?branch='+encodeURIComponent(s.branchId):'');
      window.open(url,'_blank');
      return '<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:60vh;text-align:center;padding:40px">' +
        '<div style="font-size:56px;margin-bottom:20px">&#x1F3B5;</div>' +
        '<div style="font-size:20px;font-weight:800;color:var(--text-primary);margin-bottom:8px">Music Player</div>' +
        '<div style="font-size:13px;color:var(--text-secondary);margin-bottom:24px;max-width:360px;line-height:1.7">The music player has opened in a new tab. Use it to manage your branch playlist and prayer-aware auto-pause.</div>' +
        '<a href="'+url+'" target="_blank" style="text-decoration:none"><button class="btn btn-primary" style="padding:12px 28px;font-size:13px">&#x1F3B5; Open Music Player</button></a>' +
        '</div>';
    },
    // ── HR & Finance Manager pages ──
    'hrf-hr-dash':    pHrfHrDash,
    'hrf-fin-dash':   pHrfFinDash,
    'hrf-employees':  pHrfEmployees,
    'hrf-attendance': pHrfAttendance,
    'hrf-leave':      pHrfLeave,
    'hrf-schedule':   pHrfSchedule,
    'hrf-health':     pHrfHealth,
    'hrf-payroll':    pHrfPayroll,
    'hrf-petty-cash': pHrfPettyCash,
    'hrf-revenue':    pHrfRevenue,
    'hrf-pnl':        pHrfPnL,
    'hrf-compliance': pHrfCompliance,
    'hrf-food-cost':  pHrfFoodCost,
    'hrf-expenses':   pHrfExpenses,
    'hrf-invoices':   pHrfInvoices,
    'hrf-pos':        pHrfPurchaseOrders,
    'hrf-dsr':        pHrfDsr,
    'hrf-approvals':  pHrfApprovals,
    'hrf-hr-report':  pHrfHrReport,
    'hrf-fin-report': pHrfFinReport
  };

  var fn = fns[pageId];
  if (fn) {
    try {
      area.innerHTML = fn();
      if (typeof window['after_' + pageId.replace(/-/g,'_')] === 'function') {
        window['after_' + pageId.replace(/-/g,'_')]();
      }
      // Auto-init charts after render
      setTimeout(function() { initPageCharts(pageId); }, 50);
    } catch(e) {
      area.innerHTML = '<div class="empty-state"><div class="es-icon">⚠️</div><h3>Page Error</h3>' +
        '<p style="color:var(--text-secondary);margin-bottom:12px">' + xe(e.message) + '</p>' +
        '<button class="btn" onclick="navTo(\'' + pageId + '\')">↺ Retry</button></div>';
      console.error('Page render error:', e);
    }
  } else {
    area.innerHTML = '<div class="empty-state"><div class="es-icon">🚧</div><h3>' + xe(pageId) + '</h3><p>This page is under construction.</p></div>';
  }
}

// ── PAGE: EXECUTIVE DASHBOARD ──
function pExecDash() {
  // Use live data from Firebase
  refreshDemoMetrics();
  var branches = getAccessibleBranches();
  if (!branches.length) {
    var _es = "<div style='display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:60vh;text-align:center;padding:40px'>";
    _es += "<div style='font-size:54px;margin-bottom:18px'>&#x1F3D7;&#xFE0F;</div>";
    _es += "<div style='font-size:21px;font-weight:800;color:var(--text-primary);margin-bottom:8px'>No Branches Found</div>";
    _es += "<div style='font-size:13px;color:var(--text-secondary);max-width:420px;line-height:1.7;margin-bottom:28px'>Firebase is connected but no branches loaded. Check Firebase Rules.</div>";
    _es += "<div style='display:flex;gap:12px;flex-wrap:wrap;justify-content:center'>";
    _es += '<button class="btn btn-primary" style="padding:12px 28px" onclick="navTo(&quot;access-ctrl&quot;)">&#x2795; Add Branch</button>';
    _es += '<button class="btn" style="padding:12px 28px" onclick="location.reload()">&#x21BB; Refresh</button>';
    _es += "</div></div>";
    return _es;
  }
  var totalToday = 0, totalMTD = 0;
  branches.forEach(function(b) {
    totalToday += branchSalesToday(b.id);
    totalMTD   += branchSalesMTD(b.id);
  });
  var loadedCount = Object.keys(NX_LOADED_SALES).length;

  // If no branches loaded yet, show live loading card
  if (!branches.length) {
    return '<div class="page-header"><h1>Executive Dashboard</h1><p>Loading from Firebase…</p></div>' +
      '<div style="text-align:center;padding:60px 20px">' +
      '<div style="font-size:48px;margin-bottom:16px">⏳</div>' +
      '<h3 style="color:var(--text-primary);margin-bottom:8px">Fetching branch data…</h3>' +
      '<p style="color:var(--text-secondary);margin-bottom:20px">Connecting to admin/branches in Firebase</p>' +
      '<button class="btn btn-primary" onclick="navTo(\'exec-dash\')">↺ Refresh</button></div>';
  }

  return '<div class="page-header"><h1>Executive Dashboard</h1><p>Live data from Firebase — ' + fmtDate(new Date()) + '</p></div>' +
    '<div class="kpi-grid section">' +
    kpiCard('💰','Today\'s Revenue', formatSAR(totalToday), branches.length + ' branch(es)', 'var(--ceo)', 'Live from Firebase', '') +
    kpiCard('📅','MTD Revenue', formatSAR(totalMTD), 'Month to date', 'var(--brand-dir)', new Date().toLocaleDateString('en-GB',{month:'short',year:'numeric'}), '') +
    kpiCard('🏢','Branches', branches.length + ' registered', 'From admin/branches', 'var(--info)', 'Firebase live', '') +
    kpiCard('📊','Sales Loaded', loadedCount + ' / ' + branches.length, 'Branches with sales data', 'var(--branch-mgr)', loadedCount < branches.length ? 'Loading\u2026' : 'All loaded', '') +
    '</div>' +
    // Brand Leaderboard
    '<div class="section">' +
    '<div class="card">' +
    '<div class="chart-header"><div class="chart-title">Brand Performance Leaderboard</div>' +
    '<div style="display:flex;gap:8px">' +
    '<select class="form-select" style="width:auto" onchange="sortLeaderboard(this.value)" id="lb-sort">' +
    '<option value="today">Sort: Today Sales</option><option value="mtd">Sort: MTD Sales</option>' +
    '<option value="fc">Sort: Food Cost</option>' +
    '</select>' +
    '<button class="btn btn-sm" onclick="exportLeaderboard()">⬇ Export</button>' +
    '</div></div>' +
    '<div class="table-wrap" id="lb-table-wrap">' + buildLeaderboardTable() + '</div>' +
    '</div></div>' +
    // Split: chart + rankings
    '<div class="grid-60-40 section">' +
    '<div class="chart-card">' +
    '<div class="chart-header"><div class="chart-title">Revenue Last 30 Days</div>' +
    '<div class="date-pills">' +
    '<button class="date-pill active" onclick="changeSalesChart(\'all\',this)">All Brands</button>' +
    '<button class="date-pill" onclick="changeSalesChart(\'piatto\',this)">Piatto</button>' +
    // brand pills generated dynamically from Firebase registry
    (Object.values(NX_BRANCHES).reduce(function(acc,b){ var bn=b.brand||b.name; if(acc.indexOf(bn)<0)acc.push(bn); return acc;},[])).map(function(bn){ return '<button class="date-pill" onclick="changeSalesChart(\'' + xe(bn) + '\',this)">' + xe(bn) + '</button>'; }).join('') +
    '</div></div>' +
    '<div style="height:280px"><canvas id="chart-revenue30"></canvas></div>' +
    '</div>' +
    '<div class="card">' +
    '<div class="chart-header"><div class="chart-title">Branch Rankings</div></div>' +
    '<div style="margin-bottom:16px"><div style="font-size:11px;color:var(--text-tertiary);text-transform:uppercase;letter-spacing:.1em;margin-bottom:8px">🥇 Top 3 Today</div>' +
    buildTopBranches(true) + '</div>' +
    '<div class="divider"></div>' +
    '<div><div style="font-size:11px;color:var(--text-tertiary);text-transform:uppercase;letter-spacing:.1em;margin-bottom:8px">⚠️ Bottom 3 Today</div>' +
    buildTopBranches(false) + '</div>' +
    '</div></div>' +
    // Alert Cards Row
    '<div class="grid-3 section">' +
    '<div class="card"><div class="chart-title" style="margin-bottom:14px">👥 Staff Alerts</div>' + buildStaffAlerts() + '</div>' +
    '<div class="card"><div class="chart-title" style="margin-bottom:14px">💳 Health Cards</div>' + buildHealthAlerts() + '</div>' +
    '<div class="card"><div class="chart-title" style="margin-bottom:14px">📦 Low Stock</div>' + buildStockAlerts() + '</div>' +
    '</div>';
}

function kpiCard(icon, label, value, sub, color, meta, trend) {
  return '<div class="kpi-card" style="--accent-color:' + color + '">' +
    '<div class="kpi-icon" style="background:' + color + '18;color:' + color + '">' + icon + '</div>' +
    '<div class="kpi-label">' + xe(label) + '</div>' +
    '<div class="kpi-value mono">' + xe(value) + '</div>' +
    '<div class="kpi-meta">' +
    (trend === 'pos' ? '<span class="delta-pos">▲</span>' : trend === 'neg' ? '<span class="delta-neg">▼</span>' : '<span style="color:var(--text-tertiary)">●</span>') +
    xe(meta) +
    '</div>' +
    '<div style="font-size:11px;color:var(--text-tertiary);margin-top:4px">' + xe(sub) + '</div>' +
    '</div>';
}

function buildLeaderboardTable() {
  // Real data from NX_BRANCHES + NX_BRANCH_SALES
  var branches = getAccessibleBranches();
  var brandMap = {};
  branches.forEach(function(b) {
    var bname = b.brand || b.name;
    if (!brandMap[bname]) brandMap[bname] = { brand:bname, icon:b.icon||'🍽️', color:b.color||'#f0a500', branchList:[], today:0, mtd:0 };
    brandMap[bname].branchList.push(b);
    brandMap[bname].today += branchSalesToday(b.id);
    brandMap[bname].mtd   += branchSalesMTD(b.id);
  });
  var rows = Object.values(brandMap).sort(function(a,b){ return b.today - a.today; });
  if (!rows.length) return '<tr><td colspan="6" style="text-align:center;color:var(--text-tertiary);padding:24px">Loading from Firebase…</td></tr>';
  return rows.map(function(r, i) {
    var rankColors = ['#b45309','#6b7280','#b45309'];
    var rank = i < 3 ? '<span style="color:' + rankColors[i] + ';font-size:16px">' + ['🥇','🥈','🥉'][i] + '</span>' : '<span style="color:var(--text-tertiary)">' + (i+1) + '</span>';
    return '<tr>' +
      '<td>' + rank + '</td>' +
      '<td><div style="display:flex;align-items:center;gap:8px"><span style="font-size:20px">' + r.icon + '</span><strong style="color:var(--text-primary)">' + xe(r.brand) + '</strong></div></td>' +
      '<td class="mono">' + formatSAR(r.today) + '</td>' +
      '<td class="mono">' + formatSAR(r.mtd) + '</td>' +
      '<td class="mono">' + r.branchList.length + '</td>' +
      '<td>—</td>' +
    '</tr>';
  }).join('');
}

function buildTopBranches(top) {
  // Real data from NX_BRANCHES + NX_BRANCH_SALES
  var branches = getAccessibleBranches().map(function(b) {
    return { name:b.name, brand:b.brand||b.name, icon:b.icon||'🍽️', color:b.color||'#f0a500', today:branchSalesToday(b.id), id:b.id };
  });
  branches.sort(function(a,b){ return b.today - a.today; });
  var list = top ? branches.slice(0, Math.ceil(branches.length/2)) : branches.slice(Math.ceil(branches.length/2)).reverse();
  if (!list.length) return '<div style="color:var(--text-tertiary);font-size:12px;text-align:center;padding:16px">No data yet</div>';
  return list.map(function(b) {
    var maxT = branches.length ? branches[0].today || 1 : 1;
    var pct = Math.round(b.today / maxT * 100);
    return '<div class="branch-perf-row"><div class="bpr-meta">' +
      '<span style="font-size:16px">' + b.icon + '</span>' +
      '<div><div style="font-size:12px;font-weight:600;color:var(--text-primary)">' + xe(b.name) + '</div>' +
      '<div style="font-size:10px;color:var(--text-tertiary)">' + xe(b.brand) + '</div></div></div>' +
      '<div class="bpr-bar"><div class="bpr-fill" style="width:' + pct + '%;background:' + b.color + '"></div></div>' +
      '<div class="bpr-val mono">' + formatSAR(b.today) + '</div>' +
    '</div>';
  }).join('');
}

function buildStaffAlerts() {
  // Real alerts from NXMon
  var alerts = (NX.notifications||[]).filter(function(n){ return n.dedupId&&(n.dedupId.indexOf('leave')===0); });
  if (!alerts.length) return '<div class="alert-item"><div class="alert-dot" style="background:var(--success)"></div><div class="alert-content"><div class="alert-title">No staff alerts</div><div class="alert-meta">All clear</div></div></div>';
  return alerts.slice(0,3).map(function(n){
    return '<div class="alert-item"><div class="alert-dot" style="background:var(--info)"></div><div class="alert-content"><div class="alert-title">' + xe(n.title) + '</div><div class="alert-meta">' + xe(n.branch||'') + '</div></div></div>';
  }).join('');
}

function buildHealthAlerts() {
  return '<div class="alert-item"><div class="alert-dot" style="background:var(--danger)"></div><div class="alert-content"><div class="alert-title">2 expired cards</div><div class="alert-meta">Immediate action required</div></div></div>' +
    '<div class="alert-item"><div class="alert-dot" style="background:var(--warning)"></div><div class="alert-content"><div class="alert-title">5 expiring this month</div><div class="alert-meta">Schedule renewals</div></div></div>' +
    '<div class="alert-item"><div class="alert-dot" style="background:var(--success)"></div><div class="alert-content"><div class="alert-title">47 cards valid</div><div class="alert-meta">All other staff clear</div></div></div>';
}

function buildStockAlerts() {
  // Real alerts from NXMon
  var alerts = (NX.notifications||[]).filter(function(n){ return n.dedupId&&n.dedupId.indexOf('stock')===0; });
  if (!alerts.length) return '<div class="alert-item"><div class="alert-dot" style="background:var(--success)"></div><div class="alert-content"><div class="alert-title">No stock alerts</div><div class="alert-meta">All stock levels OK</div></div></div>';
  return alerts.slice(0,3).map(function(n){
    return '<div class="alert-item"><div class="alert-dot" style="background:'+(n.type==='danger'?'var(--danger)':'var(--warning)')+'"></div><div class="alert-content"><div class="alert-title">' + xe(n.title) + '</div><div class="alert-meta">' + xe(n.msg) + '</div></div></div>';
  }).join('');
}

function drillBrand(brand) {
  showToast('Drilling into ' + brand + ' data...', 'info');
}

function sortLB(col) { showToast('Sorted by ' + col, 'info'); }
function exportLeaderboard() { showToast('Exporting leaderboard CSV...', 'success'); }
function sortLeaderboard(val) { showToast('Sorting by ' + val, 'info'); }
function changeSalesChart(brand, btn) {
  document.querySelectorAll('.date-pill').forEach(function(b){ b.classList.remove('active'); });
  btn.classList.add('active');
  initRevChart(brand);
}

// ── PAGE: BRAND PERFORMANCE ──
function pBrandPerf() {
  if (!NX.bp) NX.bp = { period:'today' };
  var s = NX.session || {};
  var canSetTarget = (s.role==='super_admin'||s.role==='ceo');
  var periods = [['today','Today'],['week','This Week'],['month','This Month'],['quarter','Quarter']];
  var pills = periods.map(function(p){
    return '<button class="date-pill'+(NX.bp.period===p[0]?' active':'')+'" onclick="NX.bp.period=\''+p[0]+'\';navTo(\'brand-perf\')">'+p[1]+'</button>';
  }).join('');
  var h = '<div class="page-header"><h1>Brand Performance</h1><p>Real-time brand comparison from Firebase</p></div>';
  h += '<div class="header-actions"><div class="date-pills">'+pills+'</div>';
  h += '<div style="display:flex;gap:8px">';
  if (canSetTarget) h += '<button class="btn" onclick="openBrandTargetModal()">🎯 Set Targets</button>';
  h += '<button class="btn" onclick="exportBrandPerf()">⬇ Export CSV</button>';
  h += '</div></div>';
  h += '<div class="table-wrap section"><table class="data-table"><thead><tr><th>Brand</th><th>Branches</th><th>Revenue</th><th>Daily Avg</th><th>Target</th><th>vs Target</th><th>YoY %</th><th>Status</th></tr></thead><tbody>';
  h += buildBrandPerfTable();
  h += '</tbody></table></div>';
  h += '<div class="grid-2 section">';
  h += '<div class="chart-card"><div class="chart-header"><div class="chart-title">Brand Revenue Share</div></div><div style="height:260px"><canvas id="chart-brand-pie"></canvas></div></div>';
  h += '<div class="chart-card"><div class="chart-header"><div class="chart-title">Food Cost % by Branch</div></div><div style="height:260px"><canvas id="chart-fc-bar"></canvas></div></div>';
  h += '</div>';
  return h;
}

function openBrandTargetModal() {
  var branches = getAccessibleBranches();
  var brandMap = {};
  branches.forEach(function(b){ var bn=b.brand||b.name; if(!brandMap[bn])brandMap[bn]={name:bn,id:bn.toLowerCase().replace(/\s+/g,'_')}; });
  var fields = Object.values(brandMap).map(function(bm){
    var stored = (NX.brandTargets||{})[bm.id] || 0;
    return '<div class="form-group"><label class="form-label">'+xe(bm.name)+' Monthly Target (‫SAR ‬)</label>'+
      '<input class="form-input" id="bt-'+xe(bm.id)+'" type="number" value="'+stored+'" placeholder="e.g. 250000"></div>';
  }).join('');
  openModal('<div class="modal-head"><h2>🎯 Set Brand Targets</h2><button class="modal-close" onclick="closeModalForce()">&#x2715;</button></div>'+
    fields+
    '<button class="btn btn-primary" style="width:100%;margin-top:8px" onclick="saveBrandTargets('+JSON.stringify(Object.values(brandMap).map(function(bm){return bm.id;}))+')">Save Targets</button>');
}

function saveBrandTargets(ids) {
  if (!NX.brandTargets) NX.brandTargets = {};
  ids.forEach(function(id){
    var el = document.getElementById('bt-'+id);
    if (el) NX.brandTargets[id] = parseFloat(el.value)||0;
  });
  if (db) db.ref('admin/brandTargets').set(NX.brandTargets);
  closeModalForce();
  showToast('Targets saved','success');
  navTo('brand-perf');
}

function buildBrandPerfTable() {
  var branches = getAccessibleBranches();
  if (!branches.length) {
    return '<tr><td colspan="8" style="text-align:center;color:var(--text-tertiary);padding:32px">No branches loaded yet — waiting for Firebase</td></tr>';
  }
  if (!NX.bp) NX.bp = { period:'today' };
  var period = NX.bp.period || 'today';
  // Group branches by brand
  var brandMap = {};
  branches.forEach(function(b) {
    var bname = b.brand || b.name;
    var bid = bname.toLowerCase().replace(/\s+/g,'_');
    if (!brandMap[bname]) brandMap[bname] = { name:bname, icon:b.icon||'🍽️', color:b.color||'#f0a500', id:bid, branches:[] };
    brandMap[bname].branches.push(b);
  });
  var now = new Date();
  var cy = now.getFullYear(), ly = cy-1;
  var tm = cy+'-'+String(now.getMonth()+1).padStart(2,'0');
  var lym = ly+'-'+String(now.getMonth()+1).padStart(2,'0');

  return Object.values(brandMap).map(function(bm) {
    var revenue = 0, lyRevenue = 0;
    bm.branches.forEach(function(b) {
      var entries = NX_BRANCH_SALES[b.id] || [];
      entries.forEach(function(e) {
        var a = parseFloat(e.actual)||0;
        if (period==='today') { if(e.date===TODAY_BS) revenue+=a; }
        else if (period==='week') {
          var ws=new Date(now); ws.setDate(now.getDate()-now.getDay()); ws.setHours(0,0,0,0);
          var wsStr=ws.getFullYear()+'-'+String(ws.getMonth()+1).padStart(2,'0')+'-'+String(ws.getDate()).padStart(2,'0');
          if(e.date>=wsStr&&e.date<=TODAY_BS) revenue+=a;
        }
        else if (period==='month') { if((e.date||'').indexOf(tm)===0) revenue+=a; }
        else if (period==='quarter') {
          var qm=Math.floor(now.getMonth()/3)*3;
          var qs=cy+'-'+String(qm+1).padStart(2,'0');
          var qe=cy+'-'+String(qm+3).padStart(2,'0')+'-31';
          if(e.date>=qs&&e.date<=qe) revenue+=a;
        }
        if (period==='month'&&(e.date||'').indexOf(lym)===0) lyRevenue+=a;
        else if (period==='today'&&e.date===(ly+'-'+TODAY_BS.slice(5))) lyRevenue+=a;
      });
    });
    var branchCount = bm.branches.length;
    var dayNum = period==='month'?Math.max(1,now.getDate()):period==='week'?Math.max(1,now.getDay()||7):1;
    var dayAvg = revenue / dayNum;
    var target = ((NX.brandTargets||{})[bm.id]||0);
    if (period==='today') target = target/30;
    else if (period==='week') target = target*7/30;
    else if (period==='quarter') target = target*3;
    var vsTarget = target>0 ? ((revenue-target)/target*100).toFixed(1) : null;
    var yoy = lyRevenue>0 ? ((revenue-lyRevenue)/lyRevenue*100).toFixed(1) : null;
    var vsCol = vsTarget===null?'var(--text-tertiary)':parseFloat(vsTarget)>=0?'#00875a':'#c0392b';
    var yoyCol = yoy===null?'var(--text-tertiary)':parseFloat(yoy)>=0?'#00875a':'#c0392b';
    var status = revenue===0?'No Data':vsTarget===null?'No Target':parseFloat(vsTarget)>=0?'On Track':'Below Target';
    var statBadge = status==='On Track'?'badge-green':status==='Below Target'?'badge-red':'badge-blue';
    return '<tr>'+
      '<td><div style="display:flex;align-items:center;gap:10px"><span style="font-size:22px">'+bm.icon+'</span>'+
        '<div><strong style="color:var(--text-primary)">'+xe(bm.name)+'</strong>'+
        '<div style="font-size:11px;color:var(--text-tertiary)">'+branchCount+' branch'+(branchCount!==1?'es':'')+'</div></div></div></td>'+
      '<td style="text-align:center;font-size:13px;font-weight:700">'+branchCount+'</td>'+
      '<td class="mono" style="color:var(--ceo);font-weight:700">'+formatSAR(revenue)+'</td>'+
      '<td class="mono">'+formatSAR(dayAvg)+'</td>'+
      '<td class="mono" style="color:var(--text-secondary)">'+( target>0?formatSAR(target):'<span style="color:var(--text-tertiary)">—</span>')+'</td>'+
      '<td class="mono" style="color:'+vsCol+';font-weight:700">'+(vsTarget!==null?(parseFloat(vsTarget)>=0?'+':'')+vsTarget+'%':'<span style="color:var(--text-tertiary)">—</span>')+'</td>'+
      '<td class="mono" style="color:'+yoyCol+';font-weight:700">'+(yoy!==null?(parseFloat(yoy)>=0?'+':'')+yoy+'%':'<span style="color:var(--text-tertiary)">—</span>')+'</td>'+
      '<td><span class="badge '+statBadge+'">'+status+'</span></td>'+
    '</tr>';
  }).join('') || '<tr><td colspan="8" style="text-align:center;color:var(--text-tertiary);padding:20px">No data yet</td></tr>';
}

function buildSparkline(branchId) {
  // Get last 7 days of real sales for the given branch (or aggregate all)
  var bars;
  if (branchId) {
    bars = getSalesData30(branchId).slice(-7);
  } else {
    // Aggregate all accessible branches
    var totals = Array(7).fill(0);
    getAccessibleBranches().forEach(function(b) {
      var d = getSalesData30(b.id).slice(-7);
      d.forEach(function(v, i) { totals[i] += v; });
    });
    bars = totals;
  }
  var max = Math.max.apply(null, bars) || 1;
  return '<div class="sparkline">' +
    bars.map(function(v) {
      var h = Math.round(v / max * 20) + 2;
      var col = v / max > .7 ? 'var(--success)' : v / max > .3 ? 'var(--warning)' : 'var(--danger)';
      return '<div class="spark-bar" style="height:' + h + 'px;background:' + col + '"></div>';
    }).join('') +
  '</div>';
}

function exportBrandPerf() {
  var branches = getAccessibleBranches();
  var brandMap = {};
  branches.forEach(function(b){ var bn=b.brand||b.name; if(!brandMap[bn])brandMap[bn]={name:bn,branches:[]}; brandMap[bn].branches.push(b); });
  var rows = [['Brand','Branches','Revenue','Daily Avg','Target','vs Target %','Status']];
  Object.values(brandMap).forEach(function(bm){
    var rev=0; bm.branches.forEach(function(b){ rev+=branchSalesMTD(b.id); });
    var tid=bm.name.toLowerCase().replace(/\s+/g,'_'); var tgt=(NX.brandTargets||{})[tid]||0;
    var vs=tgt>0?((rev-tgt)/tgt*100).toFixed(1)+'%':'—';
    rows.push([bm.name,bm.branches.length,rev.toFixed(2),(rev/Math.max(1,new Date().getDate())).toFixed(2),tgt||'—',vs,rev>=tgt&&tgt>0?'On Track':'Below Target']);
  });
  var csv = rows.map(function(r){return r.map(function(c){return '"'+String(c).replace(/"/g,'""')+'"';}).join(',');}).join('\n');
  var a=document.createElement('a'); a.href='data:text/csv;charset=utf-8,'+encodeURIComponent(csv);
  a.download='brand-performance-'+TODAY_BS+'.csv'; a.click();
  showToast('CSV exported','success');
}

// ── PAGE: REVENUE ANALYTICS ──
function pRevAnalytics() {
  // Initialise filter state on NX object
  if (!NX.rev) NX.rev = { period:'month', group:'brand', yoy:false, brand:'all', region:'all', branch:'all' };

  // Ensure live sales data is loaded — if not, kick off load and show placeholder
  var branches = getAccessibleBranches();
  var allLoaded = branches.every(function(b){ return NX_BRANCH_SALES[b.id] !== undefined; });
  if (!allLoaded) {
    loadAllBranchesSales(function(){ navTo('rev-analytics'); });
    return '<div style="padding:48px;text-align:center;color:var(--text-tertiary)"><div style="font-size:32px;margin-bottom:12px">\u23F3</div><div>Loading live sales data from Firebase\u2026</div></div>';
  }

  var s = NX.session || {};
  var role = s.role || 'ceo';

  // Build live brand→region→branch tree from accessible branches
  var liveTree = {};
  branches.forEach(function(b){
    var brandName = b.brand || 'Unknown';
    var brandId = brandName.toLowerCase().replace(/\s+/g,'_');
    var regionName = b.region || (b.location || 'Unknown');
    var regionId = regionName.toLowerCase().replace(/\s+/g,'_');
    if (!liveTree[brandId]) liveTree[brandId] = { name:brandName, regions:{} };
    if (!liveTree[brandId].regions[regionId]) liveTree[brandId].regions[regionId] = { name:regionName, branches:[] };
    liveTree[brandId].regions[regionId].branches.push(b);
  });

  // Build entity selector options based on live data
  var brandOpts = '<option value="all">All Brands</option>';
  Object.keys(liveTree).sort().forEach(function(bk) {
    brandOpts += '<option value="' + bk + '"' + (NX.rev.brand===bk?' selected':'') + '>' + xe(liveTree[bk].name) + '</option>';
  });

  var regionOpts = '<option value="all">All Regions</option>';
  Object.keys(liveTree).sort().forEach(function(bk) {
    Object.keys(liveTree[bk].regions).sort().forEach(function(rk) {
      regionOpts += '<option value="' + bk + '|' + rk + '"' + (NX.rev.region===bk+'|'+rk?' selected':'') + '>' + xe(liveTree[bk].name) + ' \u2014 ' + xe(liveTree[bk].regions[rk].name) + '</option>';
    });
  });

  var branchOpts = '<option value="all">All Branches</option>';
  Object.keys(liveTree).sort().forEach(function(bk) {
    Object.keys(liveTree[bk].regions).sort().forEach(function(rk) {
      liveTree[bk].regions[rk].branches.forEach(function(br) {
        branchOpts += '<option value="' + bk + '|' + rk + '|' + br.id + '"' + (NX.rev.branch===bk+'|'+rk+'|'+br.id?' selected':'') + '>' + xe(br.name) + '</option>';
      });
    });
  });

  var p = NX.rev.period;
  var g = NX.rev.group;

  var h = '<div class="page-header"><h1>Revenue Analytics</h1><p>Multi-dimensional revenue analysis — filterable by period and entity</p></div>';

  // ── Controls row ──
  h += '<div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;margin-bottom:20px">';
  h += '<div class="date-pills" id="rev-period-pills">';
  var periods = [['today','Today'],['week','This Week'],['month','This Month'],['quarter','Quarter'],['year','Year'],['30d','Last 30 Days'],['90d','Last 90 Days']];
  periods.forEach(function(pair) {
    h += '<button class="date-pill' + (p===pair[0]?' active':'') + '" onclick="revSetPeriod(\'' + pair[0] + '\')">' + pair[1] + '</button>';
  });
  h += '</div>';
  h += '<div style="display:flex;gap:8px;align-items:center">';
  h += '<label style="font-size:11px;color:var(--text-secondary);white-space:nowrap">Compare YoY</label>';
  h += '<input type="checkbox" id="rev-yoy-toggle" ' + (NX.rev.yoy?'checked':'') + ' onchange="revToggleYoY(this.checked)" style="width:16px;height:16px;cursor:pointer">';
  h += '<button class="btn" onclick="revExportCSV()"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg> Export CSV</button>';
  h += '</div></div>';

  // ── Entity grouping row ──
  h += '<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:20px;padding:14px 16px;background:var(--surface-1);border:1px solid var(--border);border-radius:10px">';
  h += '<span style="font-size:11px;font-weight:600;color:var(--text-tertiary);text-transform:uppercase;letter-spacing:.1em">View By</span>';
  var groups = [['brand','Brands'],['region','Regions'],['branch','Branches']];
  groups.forEach(function(pair) {
    h += '<button class="bfbt' + (g===pair[0]?' on':'') + '" onclick="revSetGroup(\'' + pair[0] + '\')" style="padding:5px 14px">' + pair[1] + '</button>';
  });
  h += '<div style="width:1px;height:20px;background:var(--border);margin:0 4px"></div>';
  if (g === 'brand' || g === 'region' || g === 'branch') {
    h += '<span style="font-size:11px;color:var(--text-secondary)">Filter Brand:</span>';
    h += '<select class="bfi" style="width:auto" onchange="revSetBrand(this.value)">' + brandOpts + '</select>';
  }
  if (g === 'region' || g === 'branch') {
    h += '<span style="font-size:11px;color:var(--text-secondary)">Region:</span>';
    h += '<select class="bfi" style="width:auto" onchange="revSetRegion(this.value)">' + regionOpts + '</select>';
  }
  if (g === 'branch') {
    h += '<span style="font-size:11px;color:var(--text-secondary)">Branch:</span>';
    h += '<select class="bfi" style="width:auto" onchange="revSetBranch(this.value)">' + branchOpts + '</select>';
  }
  h += '</div>';

  // ── KPI summary row ──
  var kpis = revCalcKPIs();
  h += '<div class="bgrid-4" style="margin-bottom:20px">';
  h += '<div class="bsc"><div class="bsc-lbl">Period Total</div><div class="bsc-val bcgold" style="font-size:22px">' + formatSAR(kpis.total) + '</div><div class="bsc-sub">' + revPeriodLabel() + '</div></div>';
  h += '<div class="bsc"><div class="bsc-lbl">vs Previous Period</div><div class="bsc-val" style="font-size:22px;color:' + (kpis.vsPrev >= 0 ? 'var(--success)' : 'var(--danger)') + '">' + (kpis.vsPrev >= 0 ? '▲' : '▼') + ' ' + Math.abs(kpis.vsPrev).toFixed(1) + '%</div><div class="bsc-sub">Prev: ' + formatSAR(kpis.prevTotal) + '</div></div>';
  h += '<div class="bsc"><div class="bsc-lbl">Daily Average</div><div class="bsc-val bcgold" style="font-size:22px">' + formatSAR(kpis.dailyAvg) + '</div><div class="bsc-sub">Per operating day</div></div>';
  h += '<div class="bsc"><div class="bsc-lbl">Top Performer</div><div class="bsc-val" style="font-size:16px;color:var(--text-primary);margin-top:4px">' + xe(kpis.topName) + '</div><div class="bsc-sub">' + formatSAR(kpis.topVal) + '</div></div>';
  h += '</div>';

  // ── Chart: Line (trend) ──
  h += '<div class="chart-card section" style="margin-bottom:20px">';
  h += '<div class="chart-header">';
  h += '<div><div class="chart-title">Revenue Trend</div><div style="font-size:11px;color:var(--text-tertiary);margin-top:2px">' + revGroupLabel() + ' · ' + revPeriodLabel() + (NX.rev.yoy ? ' + Previous Year' : '') + '</div></div>';
  h += '<div style="display:flex;gap:8px;align-items:center">';
  h += '<div id="rev-legend" style="display:flex;gap:12px;flex-wrap:wrap"></div>';
  h += '</div></div>';
  h += '<div style="height:320px;position:relative"><canvas id="chart-rev-trend"></canvas></div>';
  h += '<div id="rev-crosshair-label" style="position:absolute;top:12px;right:12px;font-family:JetBrains Mono,monospace;font-size:11px;color:var(--text-secondary);display:none"></div>';
  h += '</div>';

  // ── Charts row: Pie + Bar ──
  h += '<div class="grid-60-40 section" style="margin-bottom:20px">';

  // Bar chart (comparison)
  h += '<div class="chart-card">';
  h += '<div class="chart-header"><div><div class="chart-title">Entity Comparison</div><div style="font-size:11px;color:var(--text-tertiary);margin-top:2px">Sorted by revenue · ' + revPeriodLabel() + '</div></div>';
  h += '<div id="rev-bar-sort" style="display:flex;gap:4px">';
  h += '<button class="date-pill active" onclick="revBarSort(\'revenue\',this)">Revenue</button>';
  h += '<button class="date-pill" onclick="revBarSort(\'growth\',this)">Growth</button>';
  h += '</div></div>';
  h += '<div style="height:260px"><canvas id="chart-rev-bar"></canvas></div>';
  h += '</div>';

  // Pie / doughnut (share)
  h += '<div class="chart-card">';
  h += '<div class="chart-header"><div><div class="chart-title">Revenue Share</div><div style="font-size:11px;color:var(--text-tertiary);margin-top:2px">% of total · ' + revPeriodLabel() + '</div></div>';
  h += '<div style="display:flex;gap:4px">';
  h += '<button class="date-pill active" id="pie-btn-doughnut" onclick="revPieType(\'doughnut\',this)">Donut</button>';
  h += '<button class="date-pill" id="pie-btn-pie" onclick="revPieType(\'pie\',this)">Pie</button>';
  h += '</div></div>';
  h += '<div style="height:260px"><canvas id="chart-rev-pie"></canvas></div>';
  h += '<div id="rev-pie-legend" style="margin-top:10px;display:flex;flex-direction:column;gap:4px"></div>';
  h += '</div></div>';

  // ── Summary table ──
  h += '<div class="btw section"><div class="bttb" style="justify-content:space-between"><span style="font-weight:700;font-size:13px">Detailed Breakdown</span>';
  h += '<button class="btn btn-sm" onclick="revExportCSV()">⬇ CSV</button></div>';
  h += '<div class="btw-s"><table class="btbl" id="rev-table"><thead><tr>';
  h += '<th>Entity</th><th style="text-align:right" onclick="revSortTable(\'period\')" class="sort-active">Period Revenue <span class="sort-arrow">↓</span></th>';
  h += '<th style="text-align:right" onclick="revSortTable(\'prev\')">Prev Period <span class="sort-arrow">↕</span></th>';
  h += '<th style="text-align:right" onclick="revSortTable(\'change\')">Change <span class="sort-arrow">↕</span></th>';
  h += '<th style="text-align:right" onclick="revSortTable(\'daily\')">Daily Avg <span class="sort-arrow">↕</span></th>';
  h += '<th style="text-align:center">Share %</th>';
  h += '<th style="text-align:center">Sparkline</th>';
  h += '</tr></thead><tbody>' + revBuildTableRows() + '</tbody></table></div></div>';

  return h;
}

// ── Revenue Analytics State & Data Engine ──────────────────────────────────

var NX_REV_SORT = 'period';  // current table sort column

// Get date range for current period selection
function revDateRange() {
  var p = (NX.rev || {}).period || 'month';
  var now = new Date();
  var end = new Date(now);
  end.setHours(23,59,59,999);
  var start = new Date(now);

  if (p === 'today') {
    start.setHours(0,0,0,0);
  } else if (p === 'week') {
    start.setDate(now.getDate() - now.getDay()); start.setHours(0,0,0,0);
  } else if (p === 'month') {
    start = new Date(now.getFullYear(), now.getMonth(), 1);
  } else if (p === 'quarter') {
    var qm = Math.floor(now.getMonth() / 3) * 3;
    start = new Date(now.getFullYear(), qm, 1);
  } else if (p === 'year') {
    start = new Date(now.getFullYear(), 0, 1);
  } else if (p === '30d') {
    start.setDate(now.getDate() - 29); start.setHours(0,0,0,0);
  } else if (p === '90d') {
    start.setDate(now.getDate() - 89); start.setHours(0,0,0,0);
  }

  function ds(d) {
    return d.getFullYear() + '-' +
           String(d.getMonth()+1).padStart(2,'0') + '-' +
           String(d.getDate()).padStart(2,'0');
  }
  var days = Math.round((end - start) / 86400000) + 1;

  // Previous period of same length
  var prevEnd = new Date(start.getTime() - 86400000);
  prevEnd.setHours(23,59,59,999);
  var prevStart = new Date(prevEnd.getTime() - (days - 1) * 86400000);
  prevStart.setHours(0,0,0,0);

  return {
    start: ds(start), end: ds(end), days: days,
    prevStart: ds(prevStart), prevEnd: ds(prevEnd)
  };
}

function revPeriodLabel() {
  var labels = { today:'Today', week:'This Week', month:'This Month',
    quarter:'This Quarter', year:'This Year', '30d':'Last 30 Days', '90d':'Last 90 Days' };
  return labels[(NX.rev||{}).period] || 'Period';
}

function revGroupLabel() {
  var labels = { brand:'By Brand', region:'By Region', branch:'By Branch' };
  return labels[(NX.rev||{}).group] || 'By Brand';
}

// Get all entities based on current group + filters — LIVE from NX_BRANCHES
function revGetEntities() {
  var g = (NX.rev||{}).group || 'brand';
  var brandFilter = (NX.rev||{}).brand || 'all';
  var regionFilter = (NX.rev||{}).region || 'all';
  var entities = [];
  var BRAND_COLORS = { piatto:'#5b21b6', hybrid:'#0057ff', cafex:'#b45309', steakhouse:'#ef4444', firegrill:'#b45309' };
  var iconFor = function(bn){var l=(bn||'').toLowerCase();if(l.indexOf('piatto')>=0)return '\uD83C\uDF55';if(l.indexOf('hybrid')>=0)return '\uD83C\uDFEA';if(l.indexOf('steak')>=0)return '\uD83E\uDD69';if(l.indexOf('fire')>=0||l.indexOf('grill')>=0)return '\uD83D\uDD25';return '\uD83C\uDFEA';};

  var branches = getAccessibleBranches();
  // Build brand→region→branch tree from live NX_BRANCHES
  var tree = {};
  branches.forEach(function(b){
    var brandName = b.brand || 'Unknown';
    var brandId = brandName.toLowerCase().replace(/\s+/g,'_');
    var regionName = b.region || (b.location||'Unknown');
    var regionId = regionName.toLowerCase().replace(/\s+/g,'_');
    if (!tree[brandId]) tree[brandId] = { id:brandId, name:brandName, regions:{} };
    if (!tree[brandId].regions[regionId]) tree[brandId].regions[regionId] = { id:regionId, name:regionName, branches:[] };
    tree[brandId].regions[regionId].branches.push(b);
  });

  if (g === 'brand') {
    Object.keys(tree).forEach(function(bk) {
      if (brandFilter !== 'all' && bk !== brandFilter) return;
      var brand = tree[bk];
      entities.push({
        id: bk, name: iconFor(brand.name) + ' ' + brand.name,
        color: BRAND_COLORS[bk] || '#94a3b8',
        brandId: bk
      });
    });
  } else if (g === 'region') {
    Object.keys(tree).forEach(function(bk) {
      if (brandFilter !== 'all' && bk !== brandFilter) return;
      Object.keys(tree[bk].regions).forEach(function(rk) {
        entities.push({
          id: bk+'|'+rk, name: tree[bk].name + ' \u00b7 ' + tree[bk].regions[rk].name,
          color: BRAND_COLORS[bk] || '#94a3b8',
          brandId: bk, regionId: rk
        });
      });
    });
  } else {
    Object.keys(tree).forEach(function(bk) {
      if (brandFilter !== 'all' && bk !== brandFilter) return;
      Object.keys(tree[bk].regions).forEach(function(rk) {
        if (regionFilter !== 'all' && bk+'|'+rk !== regionFilter) return;
        tree[bk].regions[rk].branches.forEach(function(br) {
          entities.push({
            id: bk+'|'+rk+'|'+br.id,
            name: br.name,
            color: BRAND_COLORS[bk] || '#94a3b8',
            brandId: bk, regionId: rk, branchId: br.id
          });
        });
      });
    });
  }
  return entities;
}

// Get revenue for an entity within a date range — LIVE Firebase data
function revGetEntityRevenue(entity, startDate, endDate) {
  var total = 0;
  var branches = getAccessibleBranches();
  branches.forEach(function(b){
    if (!_revBranchMatchesEntity(b, entity)) return;
    var entries = NX_BRANCH_SALES[b.id] || [];
    entries.forEach(function(d){
      if (d.date >= startDate && d.date <= endDate) {
        total += parseFloat(d.actual||d.amount||0)||0;
      }
    });
  });
  return total;
}

// Get daily revenue series for an entity — LIVE Firebase data
function revGetDailySeries(entity, startDate, endDate) {
  var byDate = {};
  var branches = getAccessibleBranches();
  branches.forEach(function(b){
    if (!_revBranchMatchesEntity(b, entity)) return;
    var entries = NX_BRANCH_SALES[b.id] || [];
    entries.forEach(function(d){
      if (d.date >= startDate && d.date <= endDate) {
        var amt = parseFloat(d.actual||d.amount||0)||0;
        byDate[d.date] = (byDate[d.date] || 0) + amt;
      }
    });
  });
  // Generate all dates in range
  var result = [];
  var cur = new Date(startDate + 'T00:00:00');
  var endD = new Date(endDate + 'T00:00:00');
  while (cur <= endD) {
    var ds = cur.getFullYear()+'-'+String(cur.getMonth()+1).padStart(2,'0')+'-'+String(cur.getDate()).padStart(2,'0');
    result.push({ date: ds, amount: byDate[ds] || 0 });
    cur.setDate(cur.getDate() + 1);
  }
  return result;
}

// Helper: does this Firebase branch match the entity scope?
function _revBranchMatchesEntity(b, entity){
  if (entity.branchId) return b.id === entity.branchId;
  var brandId = (b.brand||'').toLowerCase().replace(/\s+/g,'_');
  var regionId = (b.region||'').toLowerCase().replace(/\s+/g,'_');
  if (entity.regionId && entity.brandId) {
    return brandId === entity.brandId && regionId === entity.regionId;
  }
  if (entity.brandId) {
    return brandId === entity.brandId;
  }
  return true;
}

// Generate date labels for x-axis (smart formatting based on range)
function revGetLabels(startDate, endDate, days) {
  var labels = [];
  var cur = new Date(startDate + 'T00:00:00');
  var endD = new Date(endDate + 'T00:00:00');
  var monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  while (cur <= endD) {
    var label = '';
    if (days <= 14) {
      label = monthNames[cur.getMonth()] + ' ' + cur.getDate();
    } else if (days <= 60) {
      label = (cur.getDate() === 1 || cur.getDay() === 0) ? monthNames[cur.getMonth()] + ' ' + cur.getDate() : '';
    } else {
      label = cur.getDate() === 1 ? monthNames[cur.getMonth()] : '';
    }
    labels.push(label);
    cur.setDate(cur.getDate() + 1);
  }
  return labels;
}

// Calculate KPI summary for current filters
function revCalcKPIs() {
  var range = revDateRange();
  var entities = revGetEntities();
  var total = 0, prevTotal = 0, topVal = 0, topName = '-';

  entities.forEach(function(ent) {
    var v = revGetEntityRevenue(ent, range.start, range.end);
    var pv = revGetEntityRevenue(ent, range.prevStart, range.prevEnd);
    total += v; prevTotal += pv;
    if (v > topVal) { topVal = v; topName = ent.name.replace(/^\S+\s/, ''); }
  });

  var vsPrev = prevTotal > 0 ? ((total - prevTotal) / prevTotal * 100) : 0;
  var dailyAvg = range.days > 0 ? total / range.days : 0;
  return { total: total, prevTotal: prevTotal, vsPrev: vsPrev, dailyAvg: dailyAvg, topVal: topVal, topName: topName };
}

// Build summary table rows
function revBuildTableRows() {
  var range = revDateRange();
  var entities = revGetEntities();
  var grandTotal = 0;

  var rows = entities.map(function(ent) {
    var v  = revGetEntityRevenue(ent, range.start, range.end);
    var pv = revGetEntityRevenue(ent, range.prevStart, range.prevEnd);
    var chg = pv > 0 ? ((v - pv) / pv * 100) : 0;
    var daily = range.days > 0 ? v / range.days : 0;
    grandTotal += v;
    // Mini sparkline (7 most recent days from the period)
    var spark7 = revGetDailySeries(ent, range.start, range.end).slice(-7);
    var maxSp = Math.max.apply(null, spark7.map(function(d){ return d.amount; })) || 1;
    var sparkHtml = '<div style="display:flex;align-items:flex-end;gap:2px;height:22px">';
    spark7.forEach(function(d) {
      var h = Math.max(2, Math.round(d.amount / maxSp * 20));
      var col = chg >= 0 ? 'var(--success)' : 'var(--warning)';
      sparkHtml += '<div style="width:4px;height:' + h + 'px;background:' + col + ';border-radius:2px 2px 0 0;opacity:.8"></div>';
    });
    sparkHtml += '</div>';
    return { ent: ent, v: v, pv: pv, chg: chg, daily: daily, sparkHtml: sparkHtml };
  });

  // Sort
  rows.sort(function(a, b) {
    if (NX_REV_SORT === 'period')  return b.v - a.v;
    if (NX_REV_SORT === 'prev')    return b.pv - a.pv;
    if (NX_REV_SORT === 'change')  return b.chg - a.chg;
    if (NX_REV_SORT === 'daily')   return b.daily - a.daily;
    return b.v - a.v;
  });

  return rows.map(function(row, idx) {
    var share = grandTotal > 0 ? (row.v / grandTotal * 100).toFixed(1) : '0.0';
    var chgCol = row.chg >= 0 ? 'var(--success)' : 'var(--danger)';
    var chgArrow = row.chg >= 0 ? '▲' : '▼';
    return '<tr>' +
      '<td><div style="display:flex;align-items:center;gap:8px">' +
        '<div style="width:8px;height:8px;border-radius:50%;background:' + row.ent.color + ';flex-shrink:0"></div>' +
        '<span style="font-weight:600;color:var(--text-primary)">' + xe(row.ent.name) + '</span>' +
      '</div></td>' +
      '<td class="bmono" style="text-align:right;color:var(--ceo);font-weight:700">' + formatSAR(row.v) + '</td>' +
      '<td class="bmono" style="text-align:right;color:var(--text-secondary)">' + formatSAR(row.pv) + '</td>' +
      '<td class="bmono" style="text-align:right;color:' + chgCol + ';font-weight:600">' + chgArrow + ' ' + Math.abs(row.chg).toFixed(1) + '%</td>' +
      '<td class="bmono" style="text-align:right;color:var(--text-secondary)">' + formatSAR(row.daily) + '</td>' +
      '<td style="text-align:center">' +
        '<div style="display:flex;align-items:center;gap:6px;justify-content:center">' +
          '<div style="width:60px;height:5px;background:var(--surface-3);border-radius:3px;overflow:hidden">' +
            '<div style="height:100%;width:' + share + '%;background:' + row.ent.color + ';border-radius:3px"></div>' +
          '</div>' +
          '<span class="bmono" style="font-size:11px;color:var(--text-secondary)">' + share + '%</span>' +
        '</div>' +
      '</td>' +
      '<td>' + row.sparkHtml + '</td>' +
    '</tr>';
  }).join('') || '<tr><td colspan="7" style="text-align:center;color:var(--text-tertiary);padding:24px">No data for this period</td></tr>';
}

// ── Filter setters (each triggers full page re-render) ──
function revSetPeriod(p) {
  if (!NX.rev) NX.rev = {};
  NX.rev.period = p;
  navTo('rev-analytics');
}
function revSetGroup(g) {
  if (!NX.rev) NX.rev = {};
  NX.rev.group = g;
  navTo('rev-analytics');
}
function revSetBrand(v) {
  if (!NX.rev) NX.rev = {};
  NX.rev.brand = v;
  navTo('rev-analytics');
}
function revSetRegion(v) {
  if (!NX.rev) NX.rev = {};
  NX.rev.region = v;
  navTo('rev-analytics');
}
function revSetBranch(v) {
  if (!NX.rev) NX.rev = {};
  NX.rev.branch = v;
  navTo('rev-analytics');
}
function revToggleYoY(on) {
  if (!NX.rev) NX.rev = {};
  NX.rev.yoy = on;
  // Just re-render charts, not full page
  var ctx = NX.charts.revTrend;
  if (ctx) { try { ctx.destroy(); } catch(e) {} delete NX.charts.revTrend; }
  setTimeout(function() { initRevTrendChart(); }, 10);
}
function revSortTable(col) {
  NX_REV_SORT = col;
  var tbody = document.querySelector('#rev-table tbody');
  if (tbody) tbody.innerHTML = revBuildTableRows();
  // Update sort arrows
  document.querySelectorAll('#rev-table th').forEach(function(th) {
    var arrow = th.querySelector('.sort-arrow');
    if (arrow) arrow.textContent = '↕';
    th.classList.remove('sort-active');
  });
}
function revBarSort(by, btn) {
  document.querySelectorAll('#rev-bar-sort .date-pill').forEach(function(b){ b.classList.remove('active'); });
  btn.classList.add('active');
  NX.rev._barSort = by;
  if (NX.charts.revBar) { try { NX.charts.revBar.destroy(); } catch(e){} delete NX.charts.revBar; }
  setTimeout(initRevBarChart, 10);
}
function revPieType(type, btn) {
  document.querySelectorAll('[id^="pie-btn-"]').forEach(function(b){ b.classList.remove('active'); });
  btn.classList.add('active');
  NX.rev._pieType = type;
  if (NX.charts.revPie) { try { NX.charts.revPie.destroy(); } catch(e){} delete NX.charts.revPie; }
  setTimeout(initRevPieChart, 10);
}
function revExportCSV() {
  var range = revDateRange();
  var entities = revGetEntities();
  var rows = [['Entity','Period Revenue SAR ','Prev Period SAR ','Change %','Daily Avg SAR ']];
  entities.forEach(function(ent) {
    var v  = revGetEntityRevenue(ent, range.start, range.end);
    var pv = revGetEntityRevenue(ent, range.prevStart, range.prevEnd);
    var chg = pv > 0 ? ((v - pv) / pv * 100).toFixed(1) : '—';
    rows.push([ent.name, v.toFixed(2), pv.toFixed(2), chg, (v/Math.max(1,range.days)).toFixed(2)]);
  });
  var csv = rows.map(function(r){ return r.map(function(v){ return '"' + String(v).replace(/"/g, '""') + '"'; }).join(','); }).join('\n');
  var a = document.createElement('a');
  a.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv);
  a.download = 'nexus_revenue_' + range.start + '_' + range.end + '.csv';
  a.click();
  showToast('CSV exported', 'success');
}

// Stubs for backward compat
function setRevPeriod(p, btn) { revSetPeriod(p); }
function setRevGroup(v) { revSetGroup(v === 'By Brand' ? 'brand' : v === 'By Region' ? 'region' : 'branch'); }
function toggleYoY(on) { revToggleYoY(on); }



// ── PAGE: HEADCOUNT ──
function pHeadcount() {
  var branches = getAccessibleBranches();
  var s = NX.session || {};
  var h = '<div class="page-header"><h1>Headcount Overview</h1><p>Live staff data · ' + branches.length + ' branch(es)</p></div>';

  if (s.role === 'branch_mgr') {
    var staffList = BS.staff;
    var act  = staffList.filter(function(m){ return (m.status||'Active')==='Active'; }).length;
    var lv   = staffList.filter(function(m){ return m.status==='On Leave'; }).length;
    var res  = staffList.filter(function(m){ return m.status==='Resigned'; }).length;
    var depts = {}; staffList.forEach(function(m){ var d=m.dept||'Other'; depts[d]=(depts[d]||0)+1; });
    h += '<div class="kpi-grid section">';
    h += kpiCard('&#x1F465;','Total Staff', staffList.length, s.branchName||'Your branch', 'var(--ceo)', '', '');
    h += kpiCard('&#x2705;','Active', act, 'Currently working', 'var(--success)', '', '');
    h += kpiCard('&#x1F3D6;&#xFE0F;','On Leave', lv, 'Approved leave', 'var(--warning)', '', '');
    h += kpiCard('&#x1F6AA;','Resigned', res, 'Separated', 'var(--danger)', '', '');
    h += '</div>';
    h += '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:10px;margin-bottom:16px">';
    Object.keys(depts).forEach(function(d) {
      var col = d==='Manager'?'#b45309':d==='Kitchen'?'#0057ff':'#00875a';
      h += '<div style="background:var(--surface-2);border:1px solid '+col+'30;border-radius:10px;padding:14px;text-align:center">';
      h += '<div class="mono" style="font-size:24px;font-weight:300;color:'+col+'">'+depts[d]+'</div>';
      h += '<div style="font-size:11px;color:var(--text-secondary);margin-top:4px">'+xe(d)+'</div></div>';
    });
    h += '</div>';
    h += '<div class="table-wrap section"><table class="data-table"><thead><tr><th>Name</th><th>Department</th><th>Role</th><th>Status</th><th>Phone</th></tr></thead><tbody>';
    staffList.slice().sort(function(a,b){ return (a.dept||'').localeCompare(b.dept||'')||a.name.localeCompare(b.name); }).forEach(function(m) {
      var stc = (m.status||'Active')==='Active'?'#00875a':m.status==='On Leave'?'#b45309':'#c0392b';
      h += '<tr><td><strong>'+xe(m.name)+'</strong></td><td>'+xe(m.dept||'—')+'</td><td>'+xe(m.role||'—')+'</td>';
      h += '<td><span style="color:'+stc+';font-weight:600">'+xe(m.status||'Active')+'</span></td><td>'+xe(m.phone||'—')+'</td></tr>';
    });
    h += '</tbody></table></div>';
    return h;
  }

  // ── Area Manager: show transfer requests for approval ────────────────────
  if (s.role === 'regional') {
    h += '<div class="card section">';
    h += '<div style="font-size:11px;font-weight:700;color:#5b21b6;text-transform:uppercase;letter-spacing:.08em;margin-bottom:12px">&#x1F500; Pending Staff Transfer Requests</div>';
    h += '<div id="am-transfer-list"><div style="text-align:center;padding:14px;color:var(--text-tertiary);font-size:12px">Loading…</div></div>';
    h += '</div>';
    if (db) {
      setTimeout(function() {
        var container = document.getElementById('am-transfer-list');
        if (!container) return;
        db.ref('admin/transfer_requests').once('value', function(snap) {
          var raw = snap.val() || {};
          var myBranchIds = s.branchIds || [];
          var reqs = Object.values(raw).filter(function(r) {
            if (!r || r.status !== 'pending') return false;
            // Show if either source or destination branch belongs to this area manager
            return myBranchIds.length === 0 ||
              myBranchIds.indexOf(r.fromBranch) >= 0 ||
              myBranchIds.indexOf(r.toBranch) >= 0;
          });
          if (!reqs.length) {
            container.innerHTML = '<div style="text-align:center;padding:14px;color:var(--text-tertiary);font-size:12px;font-style:italic">No pending transfer requests</div>';
            return;
          }
          var htm = reqs.map(function(r) {
            var toName = r.toBranchName || (NX_BRANCHES[r.toBranch] && NX_BRANCHES[r.toBranch].name) || r.toBranch;
            var enc = encodeURIComponent(JSON.stringify(r)).replace(/'/g,'%27');
            return '<div style="background:var(--surface-2);border:1px solid rgba(192,132,252,.2);border-radius:10px;padding:12px;margin-bottom:8px;display:flex;align-items:center;gap:10px;flex-wrap:wrap">' +
              '<div style="flex:1;min-width:0">' +
                '<div style="font-size:13px;font-weight:700">' + xe(r.staffName) + '</div>' +
                '<div style="font-size:11px;color:var(--text-tertiary)">' + xe(r.staffDept||r.staffRole||'') + ' &middot; From: <strong>' + xe(r.fromBranchName||r.fromBranch) + '</strong> &rarr; <strong>' + xe(toName) + '</strong></div>' +
                (r.note ? '<div style="font-size:11px;color:var(--text-secondary);margin-top:2px">' + xe(r.note) + '</div>' : '') +
                '<div style="font-size:10px;color:var(--text-tertiary);margin-top:2px">' + xe(r.id) + ' &middot; ' + xe(r.date) + '</div>' +
              '</div>' +
              '<div style="display:flex;gap:6px;flex-shrink:0">' +
                '<button class="btn btn-primary btn-sm" onclick="approveStaffTransfer(\'' + xe(r.id) + '\',\'' + enc + '\')">&#x2705; Approve</button>' +
                '<button class="btn btn-sm" style="color:var(--danger)" onclick="rejectStaffTransfer(\'' + xe(r.id) + '\')">&#x2715; Reject</button>' +
              '</div>' +
            '</div>';
          }).join('');
          container.innerHTML = htm;
        });
      }, 150);
    }
  }

  // CEO/Admin: load all branches
  if (!NX._hcCache) NX._hcCache = {};
  var cached = branches.filter(function(b){ return NX._hcCache[b.id]; });
  if (cached.length === branches.length && branches.length > 0) {
    var totAll=0,totAct=0,totLv=0,totRes=0;
    branches.forEach(function(b){
      var list=NX._hcCache[b.id]||[];
      totAll+=list.length;
      totAct+=list.filter(function(m){return (m.status||'Active')==='Active';}).length;
      totLv +=list.filter(function(m){return m.status==='On Leave';}).length;
      totRes+=list.filter(function(m){return m.status==='Resigned';}).length;
    });
    h += '<div class="kpi-grid section">';
    h += kpiCard('&#x1F465;','Total Headcount', totAll, branches.length+' branches', 'var(--ceo)', 'Firebase', '');
    h += kpiCard('&#x2705;','Active', totAct, 'Working staff', 'var(--success)', '', '');
    h += kpiCard('&#x1F3D6;&#xFE0F;','On Leave', totLv, 'Approved leave', 'var(--warning)', '', '');
    h += kpiCard('&#x1F6AA;','Resigned', totRes, 'Separated', 'var(--danger)', '', '');
    h += '</div>';
    h += '<div class="table-wrap section"><table class="data-table"><thead><tr><th>Branch</th><th>Brand</th><th style="text-align:center">Total</th><th style="text-align:center">Active</th><th style="text-align:center">On Leave</th><th style="text-align:center">Resigned</th></tr></thead><tbody>';
    branches.forEach(function(b){
      var list=NX._hcCache[b.id]||[];
      var act=list.filter(function(m){return (m.status||'Active')==='Active';}).length;
      var lv =list.filter(function(m){return m.status==='On Leave';}).length;
      var rs =list.filter(function(m){return m.status==='Resigned';}).length;
      h+='<tr><td><strong>'+(b.icon||'&#x1F37D;&#xFE0F;')+' '+xe(b.name)+'</strong></td>';
      h+='<td style="font-size:11px;color:var(--text-secondary)">'+xe(b.brand||'—')+'</td>';
      h+='<td class="mono" style="text-align:center;color:var(--ceo);font-weight:700">'+list.length+'</td>';
      h+='<td class="mono" style="text-align:center;color:#00875a;font-weight:600">'+act+'</td>';
      h+='<td class="mono" style="text-align:center;color:#b45309;font-weight:600">'+lv+'</td>';
      h+='<td class="mono" style="text-align:center;color:#c0392b;font-weight:600">'+rs+'</td></tr>';
    });
    h+='</tbody></table></div>';
    h+='<div style="text-align:right;margin-top:8px"><button class="btn btn-sm" onclick="NX._hcCache={};navTo(\'headcount\')">&#x21BA; Refresh</button></div>';
  } else {
    h += '<div class="empty-state"><div style="font-size:36px;margin-bottom:12px">&#x23F3;</div><h3>Loading staff data…</h3><p style="color:var(--text-secondary)">Reading branches/*/staff from Firebase</p></div>';
    h += '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:10px;margin-top:16px" id="hc-cards">';
    branches.forEach(function(b){
      h += '<div id="hc-b-'+xe(b.id)+'" style="background:var(--surface-2);border:1px solid var(--border);border-radius:10px;padding:14px">';
      h += '<div style="font-weight:700;margin-bottom:4px">'+(b.icon||'&#x1F37D;&#xFE0F;')+' '+xe(b.name)+'</div>';
      h += '<div style="font-size:11px;color:var(--text-tertiary)">Loading…</div></div>';
    });
    h += '</div>';
    if (db) {
      var loaded = 0;
      branches.forEach(function(b) {
        db.ref('branches/'+b.id+'/staff').once('value', function(snap) {
          var raw = snap.val()||{};
          var list = Array.isArray(raw)?raw.filter(Boolean):Object.values(raw).filter(Boolean);
          if (!NX._hcCache) NX._hcCache={};
          NX._hcCache[b.id] = list;
          loaded++;
          var card = document.getElementById('hc-b-'+b.id);
          if (card) {
            var act=list.filter(function(m){return (m.status||'Active')==='Active';}).length;
            var lv =list.filter(function(m){return m.status==='On Leave';}).length;
            card.innerHTML='<div style="font-weight:700;margin-bottom:6px">'+(b.icon||'&#x1F37D;&#xFE0F;')+' '+xe(b.name)+'</div>'+
              '<div style="font-size:11px;display:flex;gap:8px">'+
              '<span style="color:#00875a">&#x2705; '+act+'</span>'+
              '<span style="color:#b45309">&#x1F3D6;&#xFE0F; '+lv+'</span>'+
              '<span style="color:var(--text-tertiary)">Total: '+list.length+'</span></div>';
          }
          if (loaded===branches.length) setTimeout(function(){ if(NX.page==='headcount') navTo('headcount'); },300);
        });
      });
    }
    // ── Area Manager Petty Cash Review ─────────────────────────────────────
    h += '<div class="card section" style="margin-top:14px">';
    h += '<div style="font-size:11px;font-weight:700;color:#b45309;text-transform:uppercase;letter-spacing:.08em;margin-bottom:12px">💰 Petty Cash — Awaiting Your Review</div>';
    h += '<div id="am-pc-list"><div style="text-align:center;padding:14px;color:var(--text-tertiary);font-size:12px">Loading…</div></div>';
    h += '</div>';
    if (db) {
      setTimeout(function() {
        var container = document.getElementById('am-pc-list');
        if (!container) return;
        db.ref('admin/petty_cash_reviews').once('value', function(snap) {
          var raw = snap.val() || {};
          var myBranchIds = s.branchIds || [];
          var cycles = Object.values(raw).filter(function(c) {
            if (!c || c.status !== 'pending_am') return false;
            return myBranchIds.length === 0 || myBranchIds.indexOf(c.branchId) >= 0;
          });
          if (!cycles.length) {
            container.innerHTML = '<div style="text-align:center;padding:14px;color:var(--text-tertiary);font-size:12px;font-style:italic">No petty cash cycles awaiting review</div>';
            return;
          }
          var htm = cycles.map(function(cy) {
            var invCount=0;(cy.entries||[]).forEach(function(e){invCount+=(e.invoices||[]).length;});
            return '<div style="background:var(--surface-2);border:1px solid rgba(180,83,9,.2);border-radius:10px;padding:14px;margin-bottom:10px">' +
              '<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:6px">' +
                '<div style="font-size:20px">💰</div>' +
                '<div style="flex:1">' +
                  '<div style="font-weight:700;font-size:13px">' + xe(cy.branchName||cy.branchId) + ' — Cycle #' + cy.cycleNo + '</div>' +
                  '<div style="font-size:12px;color:var(--text-secondary)">Total: <strong>' + (cy.total||0).toLocaleString('en',{minimumFractionDigits:2}) + ' SAR </strong> · ' + (cy.entries||[]).length + ' entries · ' + (invCount?'📎 '+invCount+' invoice(s)':'no invoices') + '</div>' +
                  '<div style="font-size:11px;color:var(--text-tertiary)">Closed by: ' + xe(cy.closedBy||'—') + ' · ' + (cy.closedAt?new Date(cy.closedAt).toLocaleDateString():'') + '</div>' +
                '</div>' +
              '</div>' +
              '<div style="display:flex;gap:8px;flex-wrap:wrap">' +
                '<button class="btn btn-sm" onclick="pcAMExportReview(\'' + cy.id + '\')">📄 View PDF</button>' +
                '<button class="btn btn-sm" style="background:rgba(220,38,38,.1);border-color:rgba(220,38,38,.3);color:#c0392b" onclick="pcAMReject(\'' + cy.id + '\')">✕ Reject</button>' +
                '<button class="btn btn-primary btn-sm" onclick="pcAMApprove(\'' + cy.id + '\')">✓ Approve</button>' +
              '</div>' +
            '</div>';
          }).join('');
          container.innerHTML = htm;
        });
      }, 300);
    }
  }
  return h;
}

// ── PAGE: FOOD COST ──
function pFoodCost() {
  var branches = getAccessibleBranches();
  var s = NX.session || {};
  var now = new Date();
  var tm = now.getFullYear()+'-'+(now.getMonth()<9?'0':'')+(now.getMonth()+1);

  if (s.role === 'branch_mgr') {
    var fcTarget = parseFloat((BS._branchConfig||{}).fcTarget)||30;

    function calcFC(monthPrefix) {
      var issueCost = bLogs.reduce(function(s,l){
        if(l.type!=='issue') return s;
        if(!(l.date||'').startsWith(monthPrefix)) return s;
        if(l.cost) return s+l.cost;
        var it=bfindItem(l.code); return s+(l.qty*(it?parseFloat(it.price||0):0));
      },0);
      var wasteCost = BS.waste.reduce(function(s,w){
        return (w.date||'').startsWith(monthPrefix)?s+(+w.value||0):s;
      },0);
      return {issue:issueCost,waste:wasteCost,total:issueCost+wasteCost};
    }

    var fc = calcFC(tm);
    var mtd = branchSalesMTD(s.branchId||'');
    var pctNum = mtd>0?(fc.total/mtd*100):0;
    var fcPct = mtd>0?pctNum.toFixed(1):'—';
    var fcOk = pctNum>0&&pctNum<=fcTarget;
    var fcHigh = pctNum>fcTarget&&pctNum<=fcTarget*1.1;
    var fcColor = pctNum===0?'var(--text-tertiary)':fcOk?'#00875a':fcHigh?'#b45309':'#c0392b';
    var issuePct = mtd>0?(fc.issue/mtd*100):0;
    var wastePct = mtd>0?(fc.waste/mtd*100):0;
    var barW = Math.min(100,pctNum).toFixed(1);
    var targetPos = Math.min(99,fcTarget).toFixed(1);
    var MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

    // ── PAGE HEADER ROW ──
    var h = '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:24px">';
    h += '<div style="display:flex;align-items:center;gap:10px">';
    h += '<span style="font-size:20px">🍽️</span>';
    h += '<span style="font-size:20px;font-weight:700;color:var(--text-primary);font-family:var(--font);letter-spacing:-0.5px">Food Cost</span>';
    // Month badge — raised nm pill
    h += '<span style="background:var(--nm-base,#E7E5E4);border-radius:20px;padding:5px 14px;font-size:12px;font-weight:600;color:var(--text-secondary);box-shadow:3px 3px 8px rgba(0,0,0,0.14),-3px -3px 8px rgba(255,255,255,0.84);font-family:var(--mono)">'+tm+'</span>';
    h += '</div>';
    // Target button — raised nm pill
    h += '<button onclick="openFCTargetModal()" style="display:inline-flex;align-items:center;gap:6px;background:var(--nm-base,#E7E5E4);border:none;border-radius:20px;padding:7px 18px;font-size:12px;font-weight:700;color:var(--text-secondary);cursor:pointer;box-shadow:3px 3px 8px rgba(0,0,0,0.14),-3px -3px 8px rgba(255,255,255,0.84);font-family:var(--font);transition:all .15s">⚙️ Target: '+fcTarget+'%</button>';
    h += '</div>';

    // ── MAIN GRID ──
    h += '<div style="display:grid;grid-template-columns:1fr 260px;gap:18px;align-items:start">';
    h += '<div>'; // left col

    // ── LEFT TOP: big % + status ──
    h += '<div style="display:flex;align-items:center;gap:24px;margin-bottom:20px">';
    // Circle indicator
    h += '<div style="display:flex;flex-direction:column;align-items:center;gap:6px">';
    h += '<div style="width:54px;height:54px;border-radius:50%;background:var(--nm-base,#E7E5E4);box-shadow:'+
         '4px 4px 12px rgba(0,0,0,0.16),-4px -4px 12px rgba(255,255,255,0.86);'+
         'display:flex;align-items:center;justify-content:center">';
    h += '<div style="width:24px;height:24px;border-radius:50%;background:'+fcColor+';box-shadow:0 0 8px '+fcColor+'66"></div>';
    h += '</div>';
    h += '<div style="font-size:22px;font-weight:700;font-family:var(--mono);color:'+fcColor+'">'+fcPct+(fcPct!=='—'?'%':'')+'</div>';
    h += '<div style="font-size:9px;font-weight:700;color:var(--text-tertiary);letter-spacing:.1em;text-transform:uppercase;font-family:var(--mono)">FOOD COST</div>';
    // Decorative accent blob
    h += '<div style="width:14px;height:24px;border-radius:99px;background:#b45309;opacity:0.45;box-shadow:0 0 6px rgba(254,153,0,0.4)"></div>';
    h += '</div>';
    // Status badge — nm inset pill
    h += '<div style="background:var(--nm-base,#E7E5E4);border-radius:24px;padding:10px 20px;box-shadow:inset 3px 3px 8px rgba(0,0,0,0.11),inset -3px -3px 8px rgba(255,255,255,0.72);display:inline-flex;align-items:center;gap:8px">';
    h += '<span style="width:16px;height:16px;border-radius:4px;background:'+fcColor+'22;display:inline-flex;align-items:center;justify-content:center;font-size:11px;color:'+fcColor+';font-weight:700">'+(fcOk?'✓':fcHigh?'!':'✕')+'</span>';
    h += '<span style="font-size:13px;font-weight:700;color:'+fcColor+';font-family:var(--font)">'+(pctNum===0?'No Data':fcOk?'On Track':fcHigh?'Caution':'Over Target')+'</span>';
    h += '</div>';
    h += '</div>'; // end top row

    // CARD 1 — Food Invoices: raised nm card
    h += '<div style="background:var(--nm-base,#E7E5E4);border:none;border-radius:20px;padding:26px 28px;margin-bottom:14px;position:relative;box-shadow:6px 6px 16px rgba(0,0,0,0.17),-6px -6px 16px rgba(255,255,255,0.87)">';
    h += '<div style="font-size:10px;font-weight:700;color:var(--text-tertiary);letter-spacing:.14em;text-transform:uppercase;margin-bottom:12px;font-family:var(--mono)">FOOD INVOICES THIS MONTH</div>';
    h += '<div style="font-size:30px;font-weight:700;font-family:var(--mono);color:var(--text-primary);margin-bottom:6px;letter-spacing:-1px">'+formatSAR(fc.issue)+'</div>';
    h += '<div style="font-size:12px;color:var(--text-tertiary);font-family:var(--mono)">'+(mtd>0?issuePct.toFixed(1)+'% of sales':'No sales data')+'</div>';
    // Play triangle decoration
    h += '<div style="position:absolute;top:50%;right:28px;transform:translateY(-50%);width:0;height:0;border-style:solid;border-width:11px 0 11px 18px;border-color:transparent transparent transparent var(--text-tertiary);opacity:0.2"></div>';
    h += '</div>';

    // CARD 2 — Wastage: raised nm card
    h += '<div style="background:var(--nm-base,#E7E5E4);border:none;border-radius:20px;padding:26px 28px;margin-bottom:14px;box-shadow:6px 6px 16px rgba(0,0,0,0.17),-6px -6px 16px rgba(255,255,255,0.87)">';
    h += '<div style="font-size:10px;font-weight:700;color:var(--text-tertiary);letter-spacing:.14em;text-transform:uppercase;margin-bottom:12px;font-family:var(--mono)">WASTAGE THIS MONTH</div>';
    h += '<div style="font-size:30px;font-weight:700;font-family:var(--mono);color:#c0392b;margin-bottom:6px;letter-spacing:-1px">'+formatSAR(fc.waste)+'</div>';
    h += '<div style="font-size:12px;color:var(--text-tertiary);font-family:var(--mono)">'+(mtd>0?wastePct.toFixed(1)+'% of sales':'—')+'</div>';
    h += '</div>';

    // CARD 3 — Total vs Sales: raised nm card with nm inset progress bar
    h += '<div style="background:var(--nm-base,#E7E5E4);border:none;border-radius:20px;padding:26px 28px;margin-bottom:14px;box-shadow:6px 6px 16px rgba(0,0,0,0.17),-6px -6px 16px rgba(255,255,255,0.87)">';
    h += '<div style="font-size:10px;font-weight:700;color:var(--text-tertiary);letter-spacing:.14em;text-transform:uppercase;margin-bottom:12px;font-family:var(--mono)">TOTAL FOOD COST VS SALES</div>';
    h += '<div style="margin-bottom:18px">';
    h += '<span style="font-size:26px;font-weight:700;font-family:var(--mono);color:'+fcColor+';letter-spacing:-1px">'+formatSAR(fc.total)+'</span>';
    h += '<span style="font-size:13px;font-weight:500;color:var(--text-tertiary);font-family:var(--mono);margin-left:10px">/ '+formatSAR(mtd)+' sales</span>';
    h += '</div>';
    // Inset progress bar channel
    h += '<div style="position:relative;height:10px;background:var(--nm-base,#E7E5E4);border-radius:99px;overflow:visible;margin-bottom:8px;'+
         'box-shadow:inset 3px 3px 7px rgba(0,0,0,0.12),inset -3px -3px 7px rgba(255,255,255,0.72)">';
    h += '<div style="height:100%;width:'+barW+'%;background:'+fcColor+';border-radius:99px;transition:width .5s;box-shadow:0 0 6px '+fcColor+'77"></div>';
    // Target pin
    h += '<div style="position:absolute;top:-4px;left:'+targetPos+'%;transform:translateX(-50%);width:2px;height:18px;background:#b45309;border-radius:2px;opacity:.85"></div>';
    h += '</div>';
    h += '<div style="display:flex;justify-content:space-between;font-size:10px;color:var(--text-tertiary);font-family:var(--mono)">';
    h += '<span>0%</span><span style="color:#b45309;font-weight:700">Target '+fcTarget+'%</span><span>100%</span></div>';
    h += '</div>';

    // Wastage log table — inside nm card
    h += '<div style="background:var(--nm-base,#E7E5E4);border:none;border-radius:20px;overflow:hidden;box-shadow:6px 6px 16px rgba(0,0,0,0.17),-6px -6px 16px rgba(255,255,255,0.87)">';
    h += '<div style="padding:13px 18px;border-bottom:1px solid rgba(0,0,0,0.06);box-shadow:0 1px 0 rgba(255,255,255,0.8);display:flex;align-items:center;justify-content:space-between">';
    h += '<span style="font-size:12px;font-weight:700;font-family:var(--font);color:var(--text-primary)">Wastage Log</span>';
    h += '<button class="btn btn-sm btn-primary" onclick="navTo(\'wastage\')">+ Log Wastage</button></div>';
    h += '<div class="table-wrap"><table class="data-table"><thead><tr><th>Date</th><th>Item</th><th>Qty</th><th>Reason</th><th>By</th><th style="text-align:right">Loss</th></tr></thead><tbody>';
    var wSorted = BS.waste.slice().sort(function(a,b){return(b.date||'').localeCompare(a.date||'');});
    wSorted.forEach(function(w){
      h+='<tr><td class="mono" style="font-size:11px">'+xe(w.date||'—')+'</td>';
      h+='<td style="font-weight:600">'+xe(w.item||'—')+'</td>';
      h+='<td class="mono">'+xe(String(w.qty||'—'))+'</td>';
      h+='<td style="font-size:11px">'+xe(w.reason||'—')+'</td>';
      h+='<td style="font-size:11px;color:var(--text-secondary)">'+xe(w.by||'—')+'</td>';
      h+='<td class="mono" style="text-align:right;color:#c0392b;font-weight:600">'+formatSAR(w.value||0)+'</td></tr>';
    });
    if(!wSorted.length) h+='<tr><td colspan="6" style="text-align:center;color:var(--text-tertiary);padding:22px;font-family:var(--mono);font-size:11px">No wastage entries yet</td></tr>';
    h+='</tbody></table></div></div>';
    h += '</div>'; // end left col

    // ── RIGHT SIDEBAR: 3-Month Trend ──
    h += '<div>';
    h += '<div style="background:var(--nm-base,#E7E5E4);border:none;border-radius:20px;padding:22px;box-shadow:6px 6px 16px rgba(0,0,0,0.17),-6px -6px 16px rgba(255,255,255,0.87)">';
    h += '<div style="font-size:9px;font-weight:700;color:var(--text-tertiary);letter-spacing:.14em;text-transform:uppercase;margin-bottom:18px;font-family:var(--mono)">3-MONTH TREND</div>';

    for (var mi=-2; mi<=0; mi++) {
      var d2 = new Date(now.getFullYear(), now.getMonth()+mi, 1);
      var mkey = d2.getFullYear()+'-'+(d2.getMonth()<9?'0':'')+(d2.getMonth()+1);
      var mLbl = MONTHS[d2.getMonth()];
      var mFC = calcFC(mkey);
      var mSales = branchSalesMTD(s.branchId||'', mkey);
      var mPct = mSales>0?(mFC.total/mSales*100):0;
      var isCurr = (mi===0);
      var mCol = mPct===0?'var(--text-tertiary)':mPct<=fcTarget?'#00875a':mPct<=fcTarget*1.1?'#b45309':'#c0392b';
      var barWm = mPct>0?Math.min(100,mPct/Math.max(fcTarget*1.5,mPct)*100).toFixed(0):0;
      var tgtPos = Math.min(99,fcTarget/Math.max(fcTarget*1.5,mPct||1)*100).toFixed(0);

      h += '<div style="display:flex;align-items:center;gap:10px;margin-bottom:16px">';
      h += '<div style="width:34px;font-size:11px;font-weight:'+(isCurr?'700':'400')+';color:'+(isCurr?'var(--text-primary)':'var(--text-tertiary)')+';font-family:var(--mono)">'+mLbl+'</div>';
      // Inset track
      h += '<div style="flex:1;height:8px;background:var(--nm-base,#E7E5E4);border-radius:99px;position:relative;'+
           'box-shadow:inset 2px 2px 5px rgba(0,0,0,0.11),inset -2px -2px 5px rgba(255,255,255,0.70)">';
      if(mPct>0) h += '<div style="height:100%;width:'+barWm+'%;background:'+mCol+';border-radius:99px;box-shadow:0 0 4px '+mCol+'55"></div>';
      // Target pin
      h += '<div style="position:absolute;top:-2px;left:'+tgtPos+'%;transform:translateX(-50%);width:2px;height:12px;background:#b45309;border-radius:1px;opacity:.8"></div>';
      h += '</div>';
      h += '<div style="width:40px;font-size:11px;font-family:var(--mono);font-weight:700;color:'+mCol+';text-align:right">'+(mPct>0?mPct.toFixed(1)+'%':'—')+'</div>';
      h += '</div>';
    }

    // Target legend
    h += '<div style="display:flex;align-items:center;gap:8px;padding-top:12px;border-top:1px solid rgba(0,0,0,0.06);box-shadow:0 -1px 0 rgba(255,255,255,0.8);font-size:10px;color:#b45309;font-weight:700;font-family:var(--mono)">';
    h += '<div style="width:14px;height:2px;background:#b45309;border-radius:1px;flex-shrink:0"></div>';
    h += 'Target '+fcTarget+'%</div>';

    // Inline target editor
    h += '<div style="margin-top:16px;border-top:1px solid rgba(0,0,0,0.06);box-shadow:0 -1px 0 rgba(255,255,255,0.8);padding-top:14px">';
    h += '<div style="font-size:9px;font-weight:700;color:var(--text-tertiary);letter-spacing:.12em;text-transform:uppercase;margin-bottom:8px;font-family:var(--mono)">Set Target</div>';
    h += '<div style="display:flex;gap:8px;align-items:center">';
    h += '<input type="number" id="fc-target-input" value="'+fcTarget+'" min="1" max="100" '+
         'style="flex:1;background:var(--nm-base,#E7E5E4);border:none;border-radius:10px;padding:8px 10px;'+
         'color:var(--text-primary);font-size:14px;font-weight:700;font-family:var(--mono);text-align:center;outline:none;'+
         'box-shadow:inset 3px 3px 7px rgba(0,0,0,0.12),inset -3px -3px 7px rgba(255,255,255,0.72)">%';
    h += '<button class="btn btn-primary btn-sm" onclick="saveFCTarget()">Save</button>';
    h += '</div></div>';
    h += '</div>'; // end card
    h += '</div>'; // end right col
    h += '</div>'; // end grid
    return h;
  }

  // ── CEO/Admin multi-branch (unchanged) ──
  var h = '<div class="page-header"><h1>🍽️ Food Cost</h1><p style="font-family:var(--mono);font-size:11px;opacity:.6">'+tm+'</p></div>';
  if (!NX._fcCache) NX._fcCache = {};
  var cached = branches.filter(function(b){ return NX._fcCache[b.id]; });
  if (cached.length === branches.length && branches.length > 0) {
    var grandW=0,grandS=0,rows=[];
    branches.forEach(function(b){
      var fc=NX._fcCache[b.id]||{waste:[],mtdSales:0};
      var w=0; fc.waste.forEach(function(e){if((e.date||'').indexOf(tm)===0)w+=(+e.value||0);});
      var sales=fc.mtdSales||branchSalesMTD(b.id);
      var pct=sales>0?(w/sales*100):0;
      grandW+=w; grandS+=sales;
      rows.push({b:b,w:w,sales:sales,pct:pct});
    });
    var grandPct=grandS>0?(grandW/grandS*100).toFixed(1):'—';
    var gcol=grandS>0&&grandW/grandS>0.35?'var(--danger)':grandS>0&&grandW/grandS>0.25?'var(--warning)':'var(--success)';
    h += '<div class="kpi-grid section">';
    h += kpiCard('&#x1F5D1;&#xFE0F;','Total MTD Wastage', formatSAR(grandW), 'All branches', 'var(--danger)', tm, '');
    h += kpiCard('&#x1F4B0;','Total MTD Sales', formatSAR(grandS), 'All branches', 'var(--ceo)', '', '');
    h += kpiCard('&#x1F4CA;','Avg Food Cost %', grandPct!=='—'?grandPct+'%':'—', 'Combined', gcol, 'Target: ≤30%', '');
    h += kpiCard('&#x1F3E2;','Branches Loaded', cached.length+'/'+branches.length, 'Firebase', 'var(--info)', '', '');
    h += '</div>';
    rows.sort(function(a,b){return b.pct-a.pct;});
    h += '<div class="table-wrap section"><table class="data-table"><thead><tr><th>Branch</th><th>Brand</th><th style="text-align:right">MTD Wastage</th><th style="text-align:right">MTD Sales</th><th style="text-align:center">Food Cost %</th><th style="text-align:center">vs Target</th></tr></thead><tbody>';
    rows.forEach(function(row){
      var pctStr=row.sales>0?row.pct.toFixed(1)+'%':'—';
      var col=row.pct>35?'#c0392b':row.pct>25?'#b45309':'#00875a';
      var bw=Math.min(100,row.pct).toFixed(0);
      var diff=row.pct-30;
      var diffStr=row.sales>0?(diff>0?'<span style="color:#c0392b">+'+diff.toFixed(1)+'%</span>':'<span style="color:#b45309">'+diff.toFixed(1)+'%</span>'):'—';
      h+='<tr><td><strong>'+(row.b.icon||'&#x1F37D;&#xFE0F;')+' '+xe(row.b.name)+'</strong></td>';
      h+='<td style="font-size:11px;color:var(--text-secondary)">'+xe(row.b.brand||'—')+'</td>';
      h+='<td class="mono" style="text-align:right;color:var(--danger)">'+formatSAR(row.w)+'</td>';
      h+='<td class="mono" style="text-align:right;color:var(--ceo)">'+formatSAR(row.sales)+'</td>';
      h+='<td style="text-align:center"><div style="display:flex;align-items:center;gap:6px;justify-content:center">';
      h+='<div style="width:50px;height:5px;background:var(--nm-base,#E7E5E4);border-radius:3px;box-shadow:inset 1px 1px 3px rgba(0,0,0,0.10),inset -1px -1px 2px rgba(255,255,255,0.65)"><div style="height:100%;width:'+bw+'%;background:'+col+';border-radius:3px"></div></div>';
      h+='<span class="mono" style="color:'+col+';font-weight:700">'+pctStr+'</span></div></td>';
      h+='<td style="text-align:center">'+diffStr+'</td></tr>';
    });
    h+='</tbody></table></div>';
    h+='<div style="text-align:right;margin-top:8px"><button class="btn btn-sm" onclick="NX._fcCache={};navTo(\'food-cost\')">&#x21BA; Refresh</button></div>';
  } else {
    h += '<div class="empty-state"><div style="font-size:36px;margin-bottom:12px">&#x23F3;</div><h3>Loading food cost data\u2026</h3></div>';
  }
  return h;
}


// ── PAGE: ALERTS CENTER ──
function pAlerts() {
  // Shows all live notifications from NXMon engine — no hardcoded data
  var all = (NX.notifications || []).slice(0, 50);
  var danger  = all.filter(function(n){ return n.type==='danger'; });
  var warning = all.filter(function(n){ return n.type==='warning'; });
  var info    = all.filter(function(n){ return n.type==='info'; });

  var h = '<div class="page-header"><h1>Alerts Center</h1><p>Live alerts from Firebase across ' + getAccessibleBranches().length + ' branch(es)</p></div>';
  h += '<div class="kpi-grid section">';
  h += kpiCard('🚨','Critical', danger.length, 'Requires immediate action', 'var(--danger)', danger.length ? 'Action needed' : 'All clear', danger.length ? 'neg' : '');
  h += kpiCard('⚠️','Warnings', warning.length, 'Needs attention soon', 'var(--warning)', '', '');
  h += kpiCard('ℹ️','Info', info.length, 'Informational alerts', 'var(--info)', '', '');
  h += kpiCard('✅','Total Alerts', all.length, 'From all monitors', 'var(--success)', 'NXMon live', '');
  h += '</div>';

  if (!all.length) {
    h += '<div class="empty-state section"><div style="font-size:48px;margin-bottom:16px">✅</div>';
    h += '<h3>No alerts</h3><p style="color:var(--text-secondary)">NXMon is monitoring Firebase in real-time. All clear.</p></div>';
    return h;
  }

  // Group by type
  [['danger','🚨 Critical',danger],['warning','⚠️ Warnings',warning],['info','ℹ️ Info',info]].forEach(function(g) {
    if (!g[2].length) return;
    h += '<div class="section"><h3 style="font-size:13px;font-weight:700;margin-bottom:14px;color:var(--text-secondary)">' + g[1] + '</h3>';
    h += '<div style="display:flex;flex-direction:column;gap:8px">';
    g[2].forEach(function(n) {
      var typeColors = { danger:'rgba(248,113,113,.12)', warning:'rgba(245,158,11,.12)', info:'rgba(96,165,250,.12)' };
      var textColors = { danger:'#c0392b', warning:'#b45309', info:'#0057ff' };
      var ago = '';
      if (n.ts) {
        var d = Date.now() - n.ts;
        ago = d < 60000 ? 'just now' : d < 3600000 ? Math.floor(d/60000)+'m ago' : Math.floor(d/3600000)+'h ago';
      } else { ago = n.time || ''; }
      h += '<div class="alert-item" style="background:' + (typeColors[n.type]||'var(--surface-2)') + ';border:1px solid ' + (textColors[n.type]||'var(--border)') + '30;border-radius:10px;padding:12px 14px;cursor:pointer" onclick="notifClick(' + n.id + ')">';
      h += '<div class="alert-dot" style="background:' + (textColors[n.type]||'#94a3b8') + '"></div>';
      h += '<div class="alert-content">';
      h += '<div class="alert-title">' + (n.icon||'') + ' ' + xe(n.title) + '</div>';
      h += '<div class="alert-meta">' + xe(n.msg) + '</div>';
      h += '<div class="alert-meta" style="margin-top:4px;color:var(--text-tertiary)">' + xe(n.branch||'') + (n.branch && ago ? ' · ' : '') + ago + '</div>';
      h += '</div></div>';
    });
    h += '</div></div>';
  });

  h += '<div style="text-align:center;padding:20px"><button class="btn" onclick="NX.notifications=[];_updateBadge();renderNotifications();navTo(\'alerts-center\')">Clear All Alerts</button></div>';
  return h;
}

function filterAlerts(level, btn) {
  var items = document.querySelectorAll('#alerts-list .alert-item');
  items.forEach(function(el) {
    el.style.display = (level === 'all' || el.dataset.level === level) ? '' : 'none';
  });
}

// ── PAGE: BRAND MANAGEMENT ──
function pBrandMgmt() {
  var branches = Object.values(NX_BRANCHES);
  var tab = (NX._bmTab || 'brands');
  var h = '<div class="page-header"><h1>Brand Management</h1><p>Firebase · admin/branches · ' + branches.length + ' branch(es)</p></div>';
  h += '<div style="display:flex;gap:0;margin-bottom:16px;background:var(--surface-1);border:1px solid var(--border);border-radius:11px;padding:3px">';
  h += '<button onclick="NX._bmTab=\'brands\';navTo(\'brand-mgmt\')" style="flex:1;padding:9px;border-radius:8px;border:none;cursor:pointer;font-size:12px;font-weight:700;font-family:var(--font);background:'+(tab==='brands'?'var(--accent)':'transparent')+';color:'+(tab==='brands'?'#000':'var(--text-secondary)')+'">🏢 Brands</button>';
  h += '<button onclick="NX._bmTab=\'branches\';navTo(\'brand-mgmt\')" style="flex:1;padding:9px;border-radius:8px;border:none;cursor:pointer;font-size:12px;font-weight:700;font-family:var(--font);background:'+(tab==='branches'?'var(--accent)':'transparent')+';color:'+(tab==='branches'?'#000':'var(--text-secondary)')+'">&#x1F3EA; All Branches ('+branches.length+')</button>';
  h += '</div>';
  h += '<div class="header-actions" style="margin-bottom:16px"><div></div><div style="display:flex;gap:8px"><button class="btn" onclick="openAddBrandModal()">+ Add Brand</button><button class="btn btn-primary" onclick="openAddBranchModal()">+ Add Branch</button></div></div>';
  if (!branches.length) {
    h += '<div class="empty-state"><div class="es-icon">&#x1F3E2;</div><h3>No branches yet</h3><p>Add your first branch to get started</p></div>';
    return h;
  }
  if (tab === 'brands') {
    var brandMap = {};
    branches.forEach(function(b) {
      var bkey = b.brand || b.name || b.id;
      if (!brandMap[bkey]) brandMap[bkey] = { name:bkey, icon:b.icon||'&#x1F37D;&#xFE0F;', color:b.color||'#f0a500', branches:[] };
      brandMap[bkey].branches.push(b);
    });
    h += '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:16px">';
    Object.values(brandMap).forEach(function(bm) {
      var today=0, mtd=0;
      bm.branches.forEach(function(b){ today+=branchSalesToday(b.id); mtd+=branchSalesMTD(b.id); });
      h += '<div class="card" style="border-top:3px solid '+bm.color+'">';
      h += '<div style="display:flex;align-items:center;gap:12px;margin-bottom:14px">';
      h += '<div style="width:44px;height:44px;border-radius:12px;background:'+bm.color+'20;display:flex;align-items:center;justify-content:center;font-size:22px">'+bm.icon+'</div>';
      h += '<div style="flex:1"><div style="font-size:16px;font-weight:700">'+xe(bm.name)+'</div>';
      h += '<div style="font-size:11px;color:var(--text-tertiary)">'+bm.branches.length+' branch'+(bm.branches.length!==1?'es':'')+'</div></div>';
      h += '<button class="btn btn-sm" onclick="openEditBrandModal(\'' + xe(bm.name) + '\',\'' + xe(bm.color) + '\',\'' + xe(bm.icon) + '\')">&#x2699; Edit</button>';
      h += '</div>';
      h += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:14px">';
      h += '<div style="background:var(--surface-2);border-radius:8px;padding:10px"><div style="font-size:10px;color:var(--text-tertiary);text-transform:uppercase;letter-spacing:.08em">Today</div>';
      h += '<div class="mono" style="font-size:14px;font-weight:700;color:var(--ceo)">'+formatSAR(today)+'</div></div>';
      h += '<div style="background:var(--surface-2);border-radius:8px;padding:10px"><div style="font-size:10px;color:var(--text-tertiary);text-transform:uppercase;letter-spacing:.08em">MTD</div>';
      h += '<div class="mono" style="font-size:14px;font-weight:700;color:var(--brand-dir)">'+formatSAR(mtd)+'</div></div></div>';
      h += '<div style="border-top:1px solid var(--border);padding-top:12px">';
      bm.branches.forEach(function(b) {
        h += '<div style="display:flex;align-items:center;justify-content:space-between;padding:5px 0;font-size:12px;border-bottom:1px solid var(--border)">';
        h += '<span style="color:var(--text-primary);font-weight:600">'+xe(b.name)+'</span>';
        h += '<div style="display:flex;gap:4px"><button class="btn btn-sm" onclick="switchBranch(\''+xe(b.id)+'\')">View</button>';
        h += '<button class="btn btn-sm" onclick="openEditBranchModal(\''+xe(b.id)+'\')">Edit</button></div></div>';
      });
      h += '</div></div>';
    });
    h += '</div>';
  } else {
    h += '<div class="table-wrap"><table class="data-table"><thead><tr><th>Branch</th><th>Brand</th><th>Location</th><th>Manager</th><th style="text-align:right">Today Sales</th><th></th></tr></thead><tbody>';
    branches.slice().sort(function(a,b){ return (a.brand||a.name||'').localeCompare(b.brand||b.name||''); }).forEach(function(b) {
      h += '<tr><td><div style="display:flex;align-items:center;gap:8px"><span style="font-size:16px">'+(b.icon||'&#x1F37D;&#xFE0F;')+'</span><strong>'+xe(b.name)+'</strong></div></td>';
      h += '<td style="font-size:11px;color:var(--text-secondary)">'+xe(b.brand||'—')+'</td>';
      h += '<td style="font-size:11px;color:var(--text-secondary)">'+xe(b.location||'—')+'</td>';
      h += '<td style="font-size:11px;color:var(--text-secondary)">'+xe(b.manager||'—')+'</td>';
      h += '<td class="mono" style="text-align:right;color:var(--ceo)">'+formatSAR(branchSalesToday(b.id))+'</td>';
      h += '<td><div style="display:flex;gap:4px;justify-content:flex-end"><button class="btn btn-sm" onclick="switchBranch(\''+xe(b.id)+'\')">View</button>';
      h += '<button class="btn btn-sm" onclick="openEditBranchModal(\''+xe(b.id)+'\')">Edit</button></div></td></tr>';
    });
    h += '</tbody></table></div>';
  }
  return h;
}

function openAddBrandModal() {
  openModal(
    '<div class="modal-head"><h2>Add New Brand</h2><button class="modal-close" onclick="closeModalForce()">&#x2715;</button></div>' +
    '<div class="form-group"><label class="form-label">Brand Name *</label><input class="form-input" id="nb2-name" placeholder="e.g. Piatto"></div>' +
    '<div class="form-row"><div class="form-group"><label class="form-label">Icon</label><input class="form-input" id="nb2-icon" placeholder="&#x1F35D;" maxlength="4" value="&#x1F37D;&#xFE0F;"></div>' +
    '<div class="form-group"><label class="form-label">Color</label><input class="form-input" id="nb2-color" type="color" value="#5b21b6" style="height:40px"></div></div>' +
    '<div style="border-top:1px solid var(--border);padding-top:14px;margin-top:4px">' +
    '<div style="font-size:12px;font-weight:700;color:var(--text-secondary);margin-bottom:10px">First Branch</div>' +
    '<div class="form-group"><label class="form-label">Branch Name *</label><input class="form-input" id="nb2-bname" placeholder="e.g. Piatto MOA"></div>' +
    '<div class="form-group"><label class="form-label">Location</label><input class="form-input" id="nb2-loc" placeholder="e.g. Mall of Arabia"></div>' +
    '<div class="form-group"><label class="form-label">Manager</label><input class="form-input" id="nb2-mgr" placeholder="Manager name"></div>' +
    '<div class="form-group"><label class="form-label">PIN (4+ digits) *</label><input class="form-input" type="password" id="nb2-pin" placeholder="e.g. 5555" maxlength="8"></div>' +
    '</div>' +
    '<button class="btn btn-primary" style="width:100%;margin-top:8px" onclick="saveNewBrandWithBranch()">Create Brand + Branch</button>'
  );
}

function openEditBrandModal(brandName, brandColor, brandIcon) {
  var enc = xe(brandName);
  openModal(
    '<div class="modal-head"><h2>&#x2699; Edit Brand</h2><button class="modal-close" onclick="closeModalForce()">&#x2715;</button></div>' +
    '<div class="form-group"><label class="form-label">Brand Name</label>' +
      '<input class="form-input" id="eb-name" value="' + enc + '" placeholder="e.g. Hybrid"></div>' +
    '<div class="form-row">' +
      '<div class="form-group"><label class="form-label">Icon (emoji)</label>' +
        '<input class="form-input" id="eb-icon" value="' + xe(brandIcon) + '" maxlength="4" style="font-size:20px"></div>' +
      '<div class="form-group"><label class="form-label">Accent Color</label>' +
        '<input class="form-input" id="eb-color" type="color" value="' + xe(brandColor||'#f0a500') + '" style="height:40px;padding:4px"></div>' +
    '</div>' +
    '<div style="background:rgba(245,158,11,.08);border:1px solid rgba(245,158,11,.2);border-radius:8px;padding:10px;font-size:11px;color:#b45309;margin-bottom:14px">' +
      '&#x26A0;&#xFE0F; Changing brand name will rename it across all branches in Firebase.' +
    '</div>' +
    '<div style="display:flex;gap:8px">' +
      '<button class="btn" style="flex:1" onclick="closeModalForce()">Cancel</button>' +
      '<button class="btn btn-primary" style="flex:2" onclick="saveEditBrand(\'' + enc + '\')">&#x1F4BE; Save Brand</button>' +
    '</div>'
  );
}

function saveEditBrand(oldName) {
  if (!db) { showToast('Not connected','error'); return; }
  var newName = document.getElementById('eb-name').value.trim();
  var newIcon = document.getElementById('eb-icon').value.trim();
  var newColor = document.getElementById('eb-color').value;
  if (!newName) { showToast('Brand name required','error'); return; }

  // Update all branches that have this brand name
  var updates = {};
  Object.values(NX_BRANCHES).forEach(function(b) {
    if ((b.brand || b.name) === oldName) {
      updates['admin/branches/' + b.id + '/brand'] = newName;
      updates['admin/branches/' + b.id + '/color'] = newColor;
      updates['admin/branches/' + b.id + '/icon'] = newIcon;
    }
  });
  if (!Object.keys(updates).length) { showToast('No branches found for this brand','error'); return; }
  db.ref('/').update(updates, function(err) {
    if (err) { showToast('Update failed: ' + err.message,'error'); return; }
    closeModalForce();
    showToast('Brand updated across ' + Object.keys(updates).length/3 + ' branches','success');
    navTo('brand-mgmt');
  });
}


function saveNewBrandWithBranch() {
  var brandName = (document.getElementById('nb2-name')||{}).value||'';
  var icon      = (document.getElementById('nb2-icon')||{}).value||'';
  var color     = (document.getElementById('nb2-color')||{}).value||'#5b21b6';
  var bname     = (document.getElementById('nb2-bname')||{}).value||'';
  var loc       = (document.getElementById('nb2-loc')||{}).value||'';
  var mgr       = (document.getElementById('nb2-mgr')||{}).value||'';
  var pin       = (document.getElementById('nb2-pin')||{}).value||'';
  if (!brandName.trim()) { showToast('Brand name required','error'); return; }
  if (!bname.trim())     { showToast('Branch name required','error'); return; }
  if (pin.length < 4)    { showToast('PIN must be at least 4 digits','error'); return; }
  var id = bname.toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_|_$/g,'');
  var branch = { id:id, name:bname, brand:brandName, location:loc, manager:mgr,
                 pin:pin, icon:icon, color:color, active:true,
                 createdAt: new Date().toISOString().split('T')[0] };
  if (db) {
    db.ref('admin/branches/'+id).set(branch, function(err) {
      if (err) { showToast('Firebase error: '+err.message,'error'); return; }
      NX_BRANCHES[id] = branch;
      closeModalForce();
      showToast('Brand "'+brandName+'" + Branch "'+bname+'" created!','success');
      navTo('brand-mgmt');
    });
  } else {
    NX_BRANCHES[id] = branch;
    closeModalForce();
    showToast('Created (offline)','success');
    navTo('brand-mgmt');
  }
}

function editBrand(k) {
  var b = SEED.brands[k];
  openModal('<div class="modal-head"><h2>Edit ' + xe(b.config.name) + '</h2><button class="modal-close" onclick="closeModalForce()">✕</button></div>' +
    '<div class="form-group"><label class="form-label">Brand Name</label><input class="form-input" value="' + xe(b.config.name) + '"></div>' +
    '<div class="form-group"><label class="form-label">Cuisine</label><input class="form-input" value="' + xe(b.config.cuisine) + '"></div>' +
    '<div class="form-group"><label class="form-label">Director</label><input class="form-input" value="' + xe(b.config.director) + '"></div>' +
    '<button class="btn btn-primary" style="width:100%;margin-top:8px" onclick="showToast(\'Brand updated!\',\'success\');closeModalForce()">Save Changes</button>');
}

function openBrandDetail(k) { navTo('brand-dash'); }
function manageBranches(k) { showToast('Managing ' + SEED.brands[k].config.name + ' branches', 'info'); }

// ── PAGE: ACCESS CONTROL ──

function saveNewUser() {
  var name = (document.getElementById('nxu-name')||{}).value||'';
  var pin  = (document.getElementById('nxu-pin') ||{}).value||'';
  var role = (document.getElementById('nxu-role')||{}).value||'brand_dir';
  var err  = document.getElementById('nxu-err');

  if (!name.trim()) { if(err)err.textContent='Name is required'; return; }
  if (pin.length < 4) { if(err)err.textContent='PIN must be at least 4 digits'; return; }

  // Check PIN uniqueness
  var pinConflict = Object.values(NX_USERS).find(function(u){ return String(u.pin||'') === pin; });
  if (pinConflict) { if(err)err.textContent='PIN already used by "' + (pinConflict.name||pinConflict.id) + '"'; return; }

  // Collect checked branches
  var checkboxes = document.querySelectorAll('.nxu-branch:checked');
  var branchIds = [];
  checkboxes.forEach(function(cb){ branchIds.push(cb.value); });

  var userId = 'u_' + Date.now();
  var user = {
    id: userId,
    name: name.trim(),
    role: role,
    pin: pin,
    branchIds: branchIds,
    brandName: branchIds.length && NX_BRANCHES[branchIds[0]] ? NX_BRANCHES[branchIds[0]].brand || '' : '',
    active: true,
    createdAt: TODAY_BS
  };

  saveUser(user, function() {
    closeModalForce();
    showToast('"' + user.name + '" created with ' + branchIds.length + ' branch(es)','success');
    navTo('access-ctrl');
  });
}

function updateUser(userId) {
  var u = NX_USERS[userId];
  if (!u) return;
  var name = (document.getElementById('nxu-name')||{}).value||'';
  var pin  = (document.getElementById('nxu-pin') ||{}).value||'';
  var role = (document.getElementById('nxu-role')||{}).value||u.role;
  var err  = document.getElementById('nxu-err');

  if (!name.trim()) { if(err)err.textContent='Name is required'; return; }
  if (pin.length < 4) { if(err)err.textContent='PIN must be at least 4 digits'; return; }

  // Check PIN uniqueness (excluding self)
  var pinConflict = Object.values(NX_USERS).find(function(x){ return x.id !== userId && String(x.pin||'') === pin; });
  if (pinConflict) { if(err)err.textContent='PIN already used by "' + (pinConflict.name||pinConflict.id) + '"'; return; }

  var checkboxes = document.querySelectorAll('.nxu-branch:checked');
  var branchIds = [];
  checkboxes.forEach(function(cb){ branchIds.push(cb.value); });

  var updates = {
    id: userId,
    name: name.trim(),
    role: role,
    pin: pin,
    branchIds: branchIds,
    brandName: branchIds.length && NX_BRANCHES[branchIds[0]] ? NX_BRANCHES[branchIds[0]].brand || '' : '',
    active: u.active !== false,
    createdAt: u.createdAt || TODAY_BS
  };

  saveUser(updates, function() {
    closeModalForce();
    showToast('"' + updates.name + '" updated — ' + branchIds.length + ' branch(es) assigned','success');
    navTo('access-ctrl');
  });
}

function confirmDeleteUser(userId, name) {
  if (!confirm('Delete user "' + name + '"? They will no longer be able to log in.')) return;
  deleteUser(userId, function() {
    closeModalForce();
    showToast('"' + name + '" deleted','success');
    navTo('access-ctrl');
  });
}

function openAddBranchModal() {
  openModal(
    '<div class="modal-head"><h2>Add Branch</h2><button class="modal-close" onclick="closeModalForce()">✕</button></div>' +
    '<div class="form-group"><label class="form-label">Branch Name *</label>' +
    '<input class="form-input" id="nb-name" placeholder="e.g. Piatto MOA"></div>' +
    '<div class="form-group"><label class="form-label">Brand *</label>' +
    '<input class="form-input" id="nb-brand" placeholder="e.g. Piatto"></div>' +
    '<div class="form-group"><label class="form-label">Location</label>' +
    '<input class="form-input" id="nb-loc" placeholder="e.g. Mall of Arabia, Jeddah"></div>' +
    '<div class="form-group"><label class="form-label">Manager Name</label>' +
    '<input class="form-input" id="nb-mgr" placeholder="Manager full name"></div>' +
    '<div class="form-row"><div class="form-group"><label class="form-label">PIN (4+ digits) *</label>' +
    '<input class="form-input" type="password" id="nb-pin" placeholder="e.g. 3333" maxlength="8"></div>' +
    '<div class="form-group"><label class="form-label">Icon (emoji)</label>' +
    '<input class="form-input" id="nb-icon" placeholder="🍝" maxlength="4" value="🍽️"></div></div>' +
    '<div class="form-group"><label class="form-label">Color</label>' +
    '<input class="form-input" id="nb-color" type="color" value="#f0a500" style="height:40px"></div>' +
    '<button class="btn btn-primary" style="width:100%;margin-top:8px" onclick="saveNewBranch()">Create Branch</button>'
  );
}

function saveNewBranch() {
  var name  = (document.getElementById('nb-name') ||{}).value||'';
  var brand = (document.getElementById('nb-brand')||{}).value||'';
  var loc   = (document.getElementById('nb-loc')  ||{}).value||'';
  var mgr   = (document.getElementById('nb-mgr')  ||{}).value||'';
  var pin   = (document.getElementById('nb-pin')  ||{}).value||'';
  var icon  = (document.getElementById('nb-icon') ||{}).value||'🍽️';
  var color = (document.getElementById('nb-color')||{}).value||'#f0a500';
  if (!name.trim()) { showToast('Branch name required','error'); return; }
  if (pin.length < 4) { showToast('PIN must be at least 4 digits','error'); return; }
  // Generate ID from name
  var id = name.toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_|_$/g,'');
  var branch = { id:id, name:name, brand:brand, location:loc, manager:mgr,
                 pin:pin, icon:icon, color:color, active:true,
                 createdAt: new Date().toISOString().split('T')[0] };
  if (db) {
    db.ref('admin/branches/' + id).set(branch, function(err) {
      if (err) { showToast('Firebase error: ' + err.message, 'error'); return; }
      NX_BRANCHES[id] = branch;
      closeModalForce();
      showToast('Branch "' + name + '" created!', 'success');
      navTo('brand-mgmt');
    });
  } else {
    NX_BRANCHES[id] = branch;
    closeModalForce();
    showToast('Branch created (offline — will sync when connected)', 'success');
    navTo('brand-mgmt');
  }
}

function openEditBranchModal(branchId) {
  var b = NX_BRANCHES[branchId];
  if (!b) { showToast('Branch not found','error'); return; }
  openModal(
    '<div class="modal-head"><h2>Edit: ' + xe(b.name) + '</h2><button class="modal-close" onclick="closeModalForce()">✕</button></div>' +
    '<div class="form-group"><label class="form-label">Branch Name</label>' +
    '<input class="form-input" id="eb-name" value="' + xe(b.name||'') + '"></div>' +
    '<div class="form-group"><label class="form-label">Brand</label>' +
    '<input class="form-input" id="eb-brand" value="' + xe(b.brand||'') + '"></div>' +
    '<div class="form-group"><label class="form-label">Location</label>' +
    '<input class="form-input" id="eb-loc" value="' + xe(b.location||'') + '"></div>' +
    '<div class="form-group"><label class="form-label">Manager</label>' +
    '<input class="form-input" id="eb-mgr" value="' + xe(b.manager||'') + '"></div>' +
    '<div class="form-row"><div class="form-group"><label class="form-label">PIN</label>' +
    '<input class="form-input" type="password" id="eb-pin" value="' + xe(String(b.pin||'')) + '" maxlength="8"></div>' +
    '<div class="form-group"><label class="form-label">Icon</label>' +
    '<input class="form-input" id="eb-icon" value="' + xe(b.icon||'🍽️') + '" maxlength="4"></div></div>' +
    '<div class="form-group"><label class="form-label">Color</label>' +
    '<input class="form-input" id="eb-color" type="color" value="' + xe(b.color||'#f0a500') + '" style="height:40px"></div>' +
    '<div style="display:flex;gap:8px;margin-top:8px">' +
    '<button class="btn btn-primary" style="flex:1" onclick="saveEditBranch(\'' + xe(branchId) + '\')">Save Changes</button>' +
    '<button class="btn" style="color:var(--danger);border-color:rgba(248,113,113,.3)" onclick="deleteBranch(\'' + xe(branchId) + '\')">Delete</button>' +
    '</div>'
  );
}

function saveEditBranch(branchId) {
  var b = NX_BRANCHES[branchId];
  if (!b) return;
  var updates = {
    name:     (document.getElementById('eb-name') ||{}).value || b.name,
    brand:    (document.getElementById('eb-brand')||{}).value || b.brand||'',
    location: (document.getElementById('eb-loc')  ||{}).value || b.location||'',
    manager:  (document.getElementById('eb-mgr')  ||{}).value || b.manager||'',
    pin:      (document.getElementById('eb-pin')  ||{}).value || String(b.pin||''),
    icon:     (document.getElementById('eb-icon') ||{}).value || b.icon||'🍽️',
    color:    (document.getElementById('eb-color')||{}).value || b.color||'#f0a500'
  };
  Object.assign(b, updates);
  if (db) {
    db.ref('admin/branches/' + branchId).update(updates, function(err) {
      if (err) { showToast('Firebase error: ' + err.message, 'error'); return; }
      closeModalForce();
      showToast('Branch updated', 'success');
      navTo('brand-mgmt');
    });
  } else {
    closeModalForce();
    showToast('Saved locally (offline)', 'success');
    navTo('brand-mgmt');
  }
}

function deleteBranch(branchId) {
  var b = NX_BRANCHES[branchId];
  if (!b) return;
  if (!confirm('Delete branch "' + b.name + '"? This only removes access — branch data remains in Firebase.')) return;
  if (db) db.ref('admin/branches/' + branchId).remove();
  delete NX_BRANCHES[branchId];
  closeModalForce();
  showToast('Branch removed', 'success');
  navTo('brand-mgmt');
}

function pAccessCtrl() {
  var branches = Object.values(NX_BRANCHES);
  var branches  = Object.values(NX_BRANCHES);
  var users     = Object.values(NX_USERS);
  var directors = users.filter(function(u){ return u.role === 'brand_dir'; });
  var areaMgrs  = users.filter(function(u){ return u.role === 'regional'; });
  var hrMgrs    = users.filter(function(u){ return u.role === 'hr_manager'; });
  var finDirs   = users.filter(function(u){ return u.role === 'finance_dir'; });

  var h = '<div class="page-header"><h1>Access Control</h1>';
  h += '<p>Manage all system users and branch access · ' + branches.length + ' branch(es) registered</p></div>';

  h += '<div class="header-actions"><div></div>';
  h += '<button class="btn" style="margin-right:6px" onclick="openAddUserModal(\'brand_dir\')">+ Director</button>';
  h += '<button class="btn" style="margin-right:6px" onclick="openAddUserModal(\'regional\')">+ Area Mgr</button>';
  h += '<button class="btn" style="margin-right:6px" onclick="openAddUserModal(\'hr_manager\')">+ HR</button>';
  h += '<button class="btn" style="margin-right:6px" onclick="openAddUserModal(\'finance_dir\')">+ Finance</button>';
  h += '<button class="btn btn-primary" onclick="openAddBranchModal()">+ Branch</button>';
  h += '</div>';

  // ── System PINs ──────────────────────────────────────────────────────────
  h += '<div class="card section"><div style="font-size:11px;font-weight:700;color:var(--text-secondary);text-transform:uppercase;letter-spacing:.08em;margin-bottom:12px">System Access</div>';
  h += '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px">';
  [['🔑','Super Admin', ACCESS.superAdmin.pin, 'var(--super-admin)'],['👑','CEO', ACCESS.ceo.pin, 'var(--ceo)']].forEach(function(r){
    h += '<div style="background:var(--surface-3);border-radius:10px;padding:12px;border-left:3px solid '+r[3]+'">';
    h += '<div style="font-size:10px;color:'+r[3]+';font-weight:700;margin-bottom:4px">'+r[0]+' '+r[1]+'</div>';
    h += '<div style="font-family:var(--mono);font-size:20px;letter-spacing:4px;font-weight:600">'+r[2]+'</div></div>';
  });
  h += '</div></div>';

  // ── Brand Directors ───────────────────────────────────────────────────────
  h += '<div class="card section"><div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">';
  h += '<div style="font-size:11px;font-weight:700;color:var(--brand-dir);text-transform:uppercase;letter-spacing:.08em">🎯 Brand Directors</div>';
  h += '<button class="btn btn-sm" onclick="openAddUserModal(\'brand_dir\')">+ Add</button></div>';
  if (!directors.length) {
    h += '<div style="text-align:center;padding:20px;color:var(--text-tertiary);font-size:12px">No directors yet — click "+ Add" to create one</div>';
  } else {
    h += '<div style="display:flex;flex-direction:column;gap:8px">';
    directors.forEach(function(u) {
      var assignedBranches = (u.branchIds||[]).map(function(bid){
        return NX_BRANCHES[bid] ? NX_BRANCHES[bid].name : bid;
      });
      h += '<div style="background:var(--surface-3);border-radius:10px;padding:12px 14px;display:flex;align-items:center;gap:12px;flex-wrap:wrap">';
      h += '<div style="width:36px;height:36px;border-radius:9px;background:var(--brand-dir)18;display:flex;align-items:center;justify-content:center;font-size:16px;flex-shrink:0">🎯</div>';
      h += '<div style="flex:1;min-width:120px">';
      h += '<div style="font-size:13px;font-weight:700;color:var(--text-primary)">' + xe(u.name||u.id) + '</div>';
      h += '<div style="font-size:10px;color:var(--text-secondary);margin-top:2px">';
      h += assignedBranches.length ? assignedBranches.map(xe).join(' · ') : '<span style="color:var(--text-tertiary)">No branches assigned</span>';
      h += '</div></div>';
      h += '<div style="font-family:var(--mono);font-size:11px;color:var(--brand-dir);background:var(--brand-dir)12;padding:4px 10px;border-radius:6px">PIN: ' + xe(String(u.pin||'—')) + '</div>';
      h += '<div style="display:flex;gap:6px">';
      h += '<button class="btn btn-sm" onclick="openEditUserModal(\'' + xe(u.id) + '\')">Edit</button>';
      h += '<button class="btn btn-sm" style="color:var(--danger);border-color:rgba(248,113,113,.3)" onclick="confirmDeleteUser(\'' + xe(u.id) + '\',\'' + xe(u.name||'') + '\')">Delete</button>';
      h += '</div></div>';
    });
    h += '</div>';
  }
  h += '</div>';

  // ── Area Managers ─────────────────────────────────────────────────────────
  h += '<div class="card section"><div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">';
  h += '<div style="font-size:11px;font-weight:700;color:var(--regional);text-transform:uppercase;letter-spacing:.08em">🗺️ Area Managers</div>';
  h += '<button class="btn btn-sm" onclick="openAddUserModal(\'regional\')">+ Add</button></div>';
  if (!areaMgrs.length) {
    h += '<div style="text-align:center;padding:20px;color:var(--text-tertiary);font-size:12px">No area managers yet</div>';
  } else {
    h += '<div style="display:flex;flex-direction:column;gap:8px">';
    areaMgrs.forEach(function(u) {
      var assignedBranches = (u.branchIds||[]).map(function(bid){
        return NX_BRANCHES[bid] ? NX_BRANCHES[bid].name : bid;
      });
      h += '<div style="background:var(--surface-3);border-radius:10px;padding:12px 14px;display:flex;align-items:center;gap:12px;flex-wrap:wrap">';
      h += '<div style="width:36px;height:36px;border-radius:9px;background:var(--regional)18;display:flex;align-items:center;justify-content:center;font-size:16px;flex-shrink:0">🗺️</div>';
      h += '<div style="flex:1;min-width:120px">';
      h += '<div style="font-size:13px;font-weight:700;color:var(--text-primary)">' + xe(u.name||u.id) + '</div>';
      h += '<div style="font-size:10px;color:var(--text-secondary);margin-top:2px">';
      h += assignedBranches.length ? assignedBranches.map(xe).join(' · ') : '<span style="color:var(--text-tertiary)">No branches assigned</span>';
      h += '</div></div>';
      h += '<div style="font-family:var(--mono);font-size:11px;color:var(--regional);background:var(--regional)12;padding:4px 10px;border-radius:6px">PIN: ' + xe(String(u.pin||'—')) + '</div>';
      h += '<div style="display:flex;gap:6px">';
      h += '<button class="btn btn-sm" onclick="openEditUserModal(\'' + xe(u.id) + '\')">Edit</button>';
      h += '<button class="btn btn-sm" style="color:var(--danger);border-color:rgba(248,113,113,.3)" onclick="confirmDeleteUser(\'' + xe(u.id) + '\',\'' + xe(u.name||'') + '\')">Delete</button>';
      h += '</div></div>';
    });
    h += '</div>';
  }
  h += '</div>';

  // ── HR Managers ───────────────────────────────────────────────────────────
  h += '<div class="card section"><div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">';
  h += '<div style="font-size:11px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:.08em">&#x1F9D1;&#x200D;&#x1F4BC; HR Managers</div>';
  h += '<button class="btn btn-sm" onclick="openAddUserModal(\'hr_manager\')">+ Add</button></div>';
  if (!hrMgrs.length) {
    h += '<div style="text-align:center;padding:20px;color:var(--text-tertiary);font-size:12px">No HR managers yet — click "+ Add" to create one</div>';
  } else {
    h += '<div style="display:flex;flex-direction:column;gap:8px">';
    hrMgrs.forEach(function(u) {
      h += '<div style="background:var(--surface-3);border-radius:10px;padding:12px 14px;display:flex;align-items:center;gap:12px;flex-wrap:wrap">';
      h += '<div style="width:36px;height:36px;border-radius:9px;background:#94a3b818;display:flex;align-items:center;justify-content:center;font-size:16px;flex-shrink:0">&#x1F9D1;&#x200D;&#x1F4BC;</div>';
      h += '<div style="flex:1;min-width:120px"><div style="font-size:13px;font-weight:700;color:var(--text-primary)">' + xe(u.name||u.id) + '</div>';
      h += '<div style="font-size:10px;color:var(--text-secondary);margin-top:2px">HR Manager · All branches access</div></div>';
      h += '<div style="font-family:var(--mono);font-size:11px;color:#94a3b8;background:#94a3b812;padding:4px 10px;border-radius:6px">PIN: ' + xe(String(u.pin||'—')) + '</div>';
      h += '<div style="display:flex;gap:6px">';
      h += '<button class="btn btn-sm" onclick="openEditUserModal(\'' + xe(u.id) + '\')">Edit</button>';
      h += '<button class="btn btn-sm" style="color:var(--danger);border-color:rgba(248,113,113,.3)" onclick="confirmDeleteUser(\'' + xe(u.id) + '\',\'' + xe(u.name||'') + '\')">Delete</button>';
      h += '</div></div>';
    });
    h += '</div>';
  }
  h += '</div>';

  // ── Finance Directors ─────────────────────────────────────────────────────
  h += '<div class="card section"><div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">';
  h += '<div style="font-size:11px;font-weight:700;color:#b45309;text-transform:uppercase;letter-spacing:.08em">&#x1F4B0; Finance Directors</div>';
  h += '<button class="btn btn-sm" onclick="openAddUserModal(\'finance_dir\')">+ Add</button></div>';
  if (!finDirs.length) {
    h += '<div style="text-align:center;padding:20px;color:var(--text-tertiary);font-size:12px">No finance directors yet — click "+ Add" to create one</div>';
  } else {
    h += '<div style="display:flex;flex-direction:column;gap:8px">';
    finDirs.forEach(function(u) {
      h += '<div style="background:var(--surface-3);border-radius:10px;padding:12px 14px;display:flex;align-items:center;gap:12px;flex-wrap:wrap">';
      h += '<div style="width:36px;height:36px;border-radius:9px;background:#b4530918;display:flex;align-items:center;justify-content:center;font-size:16px;flex-shrink:0">&#x1F4B0;</div>';
      h += '<div style="flex:1;min-width:120px"><div style="font-size:13px;font-weight:700;color:var(--text-primary)">' + xe(u.name||u.id) + '</div>';
      h += '<div style="font-size:10px;color:var(--text-secondary);margin-top:2px">Finance Director · All branches access</div></div>';
      h += '<div style="font-family:var(--mono);font-size:11px;color:#b45309;background:#b4530912;padding:4px 10px;border-radius:6px">PIN: ' + xe(String(u.pin||'—')) + '</div>';
      h += '<div style="display:flex;gap:6px">';
      h += '<button class="btn btn-sm" onclick="openEditUserModal(\'' + xe(u.id) + '\')">Edit</button>';
      h += '<button class="btn btn-sm" style="color:var(--danger);border-color:rgba(248,113,113,.3)" onclick="confirmDeleteUser(\'' + xe(u.id) + '\',\'' + xe(u.name||'') + '\')">Delete</button>';
      h += '</div></div>';
    });
    h += '</div>';
  }
  h += '</div>';

  // ── Branch Managers ───────────────────────────────────────────────────────
  h += '<div class="card section"><div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">';
  h += '<div style="font-size:11px;font-weight:700;color:var(--branch-mgr);text-transform:uppercase;letter-spacing:.08em">🏪 Branch Managers</div>';
  h += '<button class="btn btn-sm" onclick="openAddBranchModal()">+ Add Branch</button></div>';
  if (!branches.length) {
    h += '<div style="text-align:center;padding:20px;color:var(--text-tertiary);font-size:12px">No branches yet</div>';
  } else {
    h += '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:8px">';
    branches.forEach(function(b) {
      h += '<div style="background:var(--surface-3);border-radius:10px;padding:12px 14px;border-left:3px solid ' + (b.color||'#f0a500') + '">';
      h += '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px">';
      h += '<div style="flex:1;min-width:0">';
      h += '<div style="font-size:13px;font-weight:700;color:var(--text-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + (b.icon||'🍽️') + ' ' + xe(b.name||b.id) + '</div>';
      h += '<div style="font-size:10px;color:var(--text-secondary);margin-top:2px">' + xe(b.brand||'') + (b.location ? ' · ' + xe(b.location) : '') + '</div>';
      h += '<div style="font-size:10px;color:var(--text-tertiary);margin-top:2px">Manager: ' + xe(b.manager||'—') + '</div></div>';
      h += '<div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px">';
      h += '<div style="font-family:var(--mono);font-size:11px;color:var(--branch-mgr);background:var(--branch-mgr)15;padding:3px 8px;border-radius:5px">PIN: ' + xe(String(b.pin||'—')) + '</div>';
      h += '<button class="btn btn-sm" onclick="openManageBranchModal(\'' + xe(b.id) + '\')">Edit</button>';
      h += '</div></div></div>';
    });
    h += '</div>';
  }
  h += '</div>';

  // Staff Transfer Requests - Area Manager Approval
  h += '<div class="card section">';
  h += '<div style="font-size:11px;font-weight:700;color:#5b21b6;text-transform:uppercase;letter-spacing:.08em;margin-bottom:12px">&#x1F500; Staff Transfer Requests</div>';
  h += '<div id="staff-transfer-list"><div style="text-align:center;padding:14px;color:var(--text-tertiary);font-size:12px">Loading...</div></div>';
  h += '</div>';
  if (db) {
    setTimeout(function() {
      db.ref('admin/transfer_requests').once('value', function(snap) {
        var container = document.getElementById('staff-transfer-list');
        if (!container) return;
        var raw = snap.val() || {};
        var reqs = Object.values(raw).filter(function(r){ return r && r.status === 'pending'; });
        if (!reqs.length) {
          container.innerHTML = '<div style="text-align:center;padding:14px;color:var(--text-tertiary);font-size:12px;font-style:italic">No pending transfer requests</div>';
          return;
        }
        var htm = reqs.map(function(r) {
          var enc = encodeURIComponent(JSON.stringify(r)).replace(/'/g,'%27');
          return '<div style="background:var(--surface-2);border:1px solid rgba(192,132,252,.2);border-radius:10px;padding:12px;margin-bottom:8px;display:flex;align-items:center;gap:10px;flex-wrap:wrap">' +
            '<div style="flex:1">' +
              '<div style="font-size:13px;font-weight:700">' + xe(r.staffName) + '</div>' +
              '<div style="font-size:11px;color:var(--text-tertiary)">' + xe(r.staffDept||r.staffRole||'') + ' \xb7 From: <strong>' + xe(r.fromBranchName||r.fromBranch) + '</strong> \u2192 <strong>' + xe(r.toBranchName||NX_BRANCHES[r.toBranch]&&NX_BRANCHES[r.toBranch].name||r.toBranch) + '</strong></div>' +
              (r.note ? '<div style="font-size:11px;color:var(--text-secondary)">' + xe(r.note) + '</div>' : '') +
              '<div style="font-size:10px;color:var(--text-tertiary)">' + xe(r.id) + ' \xb7 ' + xe(r.date) + '</div>' +
            '</div>' +
            '<div style="display:flex;gap:6px">' +
              '<button class="btn btn-primary btn-sm" onclick="approveStaffTransfer(\'' + xe(r.id) + '\',\'' + enc + '\')">&#x2705; Approve</button>' +
              '<button class="btn btn-sm" style="color:var(--danger)" onclick="rejectStaffTransfer(\'' + xe(r.id) + '\')">\u2715 Reject</button>' +
            '</div>' +
          '</div>';
        }).join('');
        container.innerHTML = htm;
      });
    }, 150);
  }
  return h;
}

function openManageBranchModal(branchId) {
  var b = NX_BRANCHES[branchId];
  if (!b) { showToast('Branch not found','error'); return; }

  openModal(
    '<div class="modal-head"><h2 style="display:flex;align-items:center;gap:8px">' +
    '<span style="font-size:20px">' + (b.icon||'🏪') + '</span>' + xe(b.name) + '</h2>' +
    '<button class="modal-close" onclick="closeModalForce()">✕</button></div>' +

    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">' +

    '<div class="form-group"><label class="form-label">Branch Name</label>' +
    '<input class="form-input" id="mb-name" value="' + xe(b.name||'') + '"></div>' +

    '<div class="form-group"><label class="form-label">Brand</label>' +
    '<input class="form-input" id="mb-brand" value="' + xe(b.brand||'') + '"></div>' +

    '<div class="form-group"><label class="form-label">Location</label>' +
    '<input class="form-input" id="mb-loc" value="' + xe(b.location||'') + '"></div>' +

    '<div class="form-group"><label class="form-label">Manager Name</label>' +
    '<input class="form-input" id="mb-mgr" value="' + xe(b.manager||'') + '"></div>' +

    '</div>' +

    '<div style="background:var(--surface-3);border-radius:10px;padding:14px;margin:12px 0">' +
    '<div style="font-size:11px;font-weight:700;color:var(--text-secondary);margin-bottom:12px;text-transform:uppercase;letter-spacing:.08em">PINs & Access</div>' +
    '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px">' +

    '<div><div style="font-size:10px;color:var(--branch-mgr);font-weight:600;margin-bottom:4px">🏪 Branch Manager PIN</div>' +
    '<input class="form-input" id="mb-pin" type="text" value="' + xe(String(b.pin||'')) + '" placeholder="e.g. 3333" maxlength="8" style="font-family:var(--mono);letter-spacing:3px;font-size:16px"></div>' +

    '<div><div style="font-size:10px;color:var(--brand-dir);font-weight:600;margin-bottom:4px">🎯 Brand Director PIN</div>' +
    '<input class="form-input" id="mb-dirpin" type="text" value="' + xe(String(b.directorPin||'')) + '" placeholder="e.g. 2201" maxlength="8" style="font-family:var(--mono);letter-spacing:3px;font-size:16px"></div>' +

    '<div><div style="font-size:10px;color:var(--regional);font-weight:600;margin-bottom:4px">🗺️ Area Manager PIN</div>' +
    '<input class="form-input" id="mb-regpin" type="text" value="' + xe(String(b.regionalPin||'')) + '" placeholder="e.g. 3301" maxlength="8" style="font-family:var(--mono);letter-spacing:3px;font-size:16px"></div>' +

    '</div><p style="font-size:10px;color:var(--text-tertiary);margin-top:10px">💡 Each person enters their own PIN to auto-login to this branch. Director/Area Manager PINs override the branch selection step.</p>' +
    '</div>' +

    '<div style="display:flex;gap:8px;margin-top:8px">' +
    '<div class="form-group" style="flex:1"><label class="form-label">Icon (emoji)</label>' +
    '<input class="form-input" id="mb-icon" value="' + xe(b.icon||'🍽️') + '" maxlength="4"></div>' +
    '<div class="form-group" style="flex:1"><label class="form-label">Color</label>' +
    '<input class="form-input" id="mb-color" type="color" value="' + xe(b.color||'#f0a500') + '" style="height:40px;padding:4px 8px"></div>' +
    '</div>' +

    '<div style="display:flex;gap:8px;margin-top:4px">' +
    '<button class="btn btn-primary" style="flex:1" onclick="saveManageBranch(\'' + xe(branchId) + '\')">💾 Save Changes</button>' +
    '<button class="btn" style="color:var(--danger);border-color:rgba(248,113,113,.25)" onclick="deleteBranch(\'' + xe(branchId) + '\')">Delete</button>' +
    '</div>'
  );
}

function saveManageBranch(branchId) {
  var b = NX_BRANCHES[branchId];
  if (!b) return;
  var get = function(id) { var el=document.getElementById(id); return el ? el.value.trim() : ''; };

  var updates = {
    name:        get('mb-name')   || b.name,
    brand:       get('mb-brand')  || b.brand||'',
    location:    get('mb-loc')    || b.location||'',
    manager:     get('mb-mgr')    || b.manager||'',
    pin:         get('mb-pin')    || String(b.pin||''),
    directorPin: get('mb-dirpin'),
    regionalPin: get('mb-regpin'),
    icon:        get('mb-icon')   || b.icon||'🍽️',
    color:       get('mb-color')  || b.color||'#f0a500'
  };

  Object.assign(b, updates);

  if (db) {
    db.ref('admin/branches/' + branchId).update(updates, function(err) {
      if (err) { showToast('Firebase error: ' + err.message,'error'); return; }
      closeModalForce();
      showToast('Branch "' + updates.name + '" updated','success');
      navTo('access-ctrl');
    });
  } else {
    closeModalForce();
    showToast('Saved locally','success');
    navTo('access-ctrl');
  }
}

function openAddUserModal(presetRole) {
  var branches = Object.values(NX_BRANCHES);
  var _ROLE_META = {
    brand_dir:   { label:'Brand Director',   color:'var(--brand-dir)',  icon:'🎯' },
    regional:    { label:'Area Manager',     color:'var(--regional)',   icon:'🗺️' },
    hr_manager:  { label:'HR Manager',       color:'#94a3b8',           icon:'🧑‍💼' },
    finance_dir: { label:'Finance Director', color:'#b45309',           icon:'💰' }
  };
  var _rm = _ROLE_META[presetRole] || _ROLE_META['brand_dir'];
  var roleLabel = _rm.label;
  var roleColor = _rm.color;
  var roleIcon  = _rm.icon;

  // Build branch checkboxes
  var branchList = '';
  if (!branches.length) {
    branchList = '<div style="color:var(--text-tertiary);font-size:12px;text-align:center;padding:16px">No branches registered yet — add branches first</div>';
  } else {
    branchList = '<div style="display:flex;flex-direction:column;gap:6px;max-height:280px;overflow-y:auto;padding-right:4px">' +
      branches.map(function(b) {
        return '<label style="display:flex;align-items:center;gap:10px;padding:9px 12px;background:var(--surface-3);border-radius:9px;cursor:pointer;border:1.5px solid transparent;transition:border-color .12s" class="branch-check-row">' +
          '<input type="checkbox" class="nxu-branch" value="' + xe(b.id) + '" style="width:16px;height:16px;accent-color:' + roleColor + ';cursor:pointer">' +
          '<span style="font-size:16px">' + (b.icon||'🍽️') + '</span>' +
          '<div style="flex:1"><div style="font-size:13px;font-weight:600;color:var(--text-primary)">' + xe(b.name) + '</div>' +
          '<div style="font-size:10px;color:var(--text-secondary)">' + xe(b.brand||'') + (b.location?' · '+xe(b.location):'') + '</div></div>' +
          '<div style="font-family:var(--mono);font-size:10px;color:var(--text-tertiary)">PIN ' + xe(String(b.pin||'')) + '</div>' +
        '</label>';
      }).join('') + '</div>';
  }

  openModal(
    '<div class="modal-head"><h2>' + roleIcon + ' Add ' + roleLabel + '</h2>' +
    '<button class="modal-close" onclick="closeModalForce()">✕</button></div>' +

    '<div class="form-group"><label class="form-label">Full Name *</label>' +
    '<input class="form-input" id="nxu-name" placeholder="e.g. Ahmed Lotfy"></div>' +

    '<div class="form-row"><div class="form-group"><label class="form-label">Personal PIN * (4–8 digits)</label>' +
    '<input class="form-input" id="nxu-pin" type="text" placeholder="e.g. 2201" maxlength="8" style="font-family:var(--mono);letter-spacing:3px;font-size:16px"></div>' +
    '<div class="form-group"><label class="form-label">Role</label>' +
    '<select class="form-input" id="nxu-role">' +
    '<option value="brand_dir"'   + (presetRole==='brand_dir'  ?' selected':'') + '>🎯 Brand Director</option>' +
    '<option value="regional"'    + (presetRole==='regional'   ?' selected':'') + '>🗺️ Area Manager</option>' +
    '<option value="hr_manager"'  + (presetRole==='hr_manager' ?' selected':'') + '>🧑‍💼 HR Manager</option>' +
    '<option value="finance_dir"' + (presetRole==='finance_dir'?' selected':'') + '>💰 Finance Director</option>' +
    '</select></div></div>' +

    '<div class="form-group"><label class="form-label">Assign Branches</label>' +
    '<div style="font-size:10px;color:var(--text-tertiary);margin-bottom:8px">Select all branches this person is responsible for — they will see performance data for all of them</div>' +
    branchList + '</div>' +

    '<div id="nxu-err" style="color:var(--danger);font-size:12px;min-height:16px;margin:4px 0"></div>' +
    '<button class="btn btn-primary" style="width:100%" onclick="saveNewUser()">Create User</button>'
  );
}

function openEditUserModal(userId) {
  var u = NX_USERS[userId];
  if (!u) { showToast('User not found','error'); return; }
  var branches = Object.values(NX_BRANCHES);
  var assigned = u.branchIds || [];
  var roleLabel = u.role === 'brand_dir' ? 'Brand Director' : 'Area Manager';
  var roleColor = u.role === 'brand_dir' ? 'var(--brand-dir)' : 'var(--regional)';

  var branchList = '<div style="display:flex;flex-direction:column;gap:6px;max-height:280px;overflow-y:auto;padding-right:4px">' +
    branches.map(function(b) {
      var checked = assigned.indexOf(b.id) >= 0;
      return '<label style="display:flex;align-items:center;gap:10px;padding:9px 12px;background:var(--surface-3);border-radius:9px;cursor:pointer">' +
        '<input type="checkbox" class="nxu-branch" value="' + xe(b.id) + '"' + (checked?' checked':'') + ' style="width:16px;height:16px;accent-color:' + roleColor + ';cursor:pointer">' +
        '<span style="font-size:16px">' + (b.icon||'🍽️') + '</span>' +
        '<div style="flex:1"><div style="font-size:13px;font-weight:600;color:var(--text-primary)">' + xe(b.name) + '</div>' +
        '<div style="font-size:10px;color:var(--text-secondary)">' + xe(b.brand||'') + (b.location?' · '+xe(b.location):'') + '</div></div>' +
      '</label>';
    }).join('') + '</div>';

  openModal(
    '<div class="modal-head"><h2>Edit: ' + xe(u.name||userId) + '</h2>' +
    '<button class="modal-close" onclick="closeModalForce()">✕</button></div>' +

    '<div class="form-group"><label class="form-label">Full Name</label>' +
    '<input class="form-input" id="nxu-name" value="' + xe(u.name||'') + '"></div>' +

    '<div class="form-row"><div class="form-group"><label class="form-label">Personal PIN</label>' +
    '<input class="form-input" id="nxu-pin" type="text" value="' + xe(String(u.pin||'')) + '" maxlength="8" style="font-family:var(--mono);letter-spacing:3px;font-size:16px"></div>' +
    '<div class="form-group"><label class="form-label">Role</label>' +
    '<select class="form-input" id="nxu-role">' +
    '<option value="brand_dir"' + (u.role==='brand_dir'?' selected':'') + '>🎯 Brand Director</option>' +
    '<option value="regional"' + (u.role==='regional'?' selected':'') + '>🗺️ Area Manager</option>' +
    '</select></div></div>' +

    '<div class="form-group"><label class="form-label">Assigned Branches</label>' +
    branchList + '</div>' +

    '<div id="nxu-err" style="color:var(--danger);font-size:12px;min-height:16px;margin:4px 0"></div>' +
    '<div style="display:flex;gap:8px">' +
    '<button class="btn btn-primary" style="flex:1" onclick="updateUser(\'' + xe(userId) + '\')">Save Changes</button>' +
    '<button class="btn" style="color:var(--danger);border-color:rgba(248,113,113,.3)" onclick="confirmDeleteUser(\'' + xe(userId) + '\',\'' + xe(u.name||'') + '\')">Delete</button>' +
    '</div>'
  );
}





// ── PAGE: AUDIT LOG ──
function pSharedIngredients() {
  var sess=NX.session||{};
  var h='<div class="page-header"><h1>🧂 Shared Ingredients</h1><p>Global ingredient catalog for Recipe Builder — shared/inv_items</p></div>';
  h+='<div class="header-actions"><div></div><div style="display:flex;gap:8px">';
  h+='<button class="btn" onclick="openImportPricesModal()">📥 Import Prices from Branch</button>';
  h+='<button class="btn btn-primary" onclick="openSharedIngModal(null)">+ Add Ingredient</button>';
  h+='</div></div>';
  // Search
  h+='<div class="bcard" style="margin-bottom:14px"><input class="form-input" id="si-search" placeholder="Search by code or name..." oninput="renderSharedIngTable(this.value)" style="max-width:340px"></div>';
  h+='<div id="si-table-wrap">';
  h+=renderSharedIngTable_inner('');
  h+='</div>';
  setTimeout(function(){
    var inp=document.getElementById('si-search');
    if(inp) inp.oninput=function(){renderSharedIngTable(this.value);};
  },0);
  return h;
}
function renderSharedIngTable(q) {
  var wrap=document.getElementById('si-table-wrap');
  if(wrap) wrap.innerHTML=renderSharedIngTable_inner(q||'');
}
function renderSharedIngTable_inner(q) {
  q=(q||'').toLowerCase().trim();
  if(!db) return '<div class="empty-state">Not connected to Firebase</div>';
  // Read fresh from Firebase each render
  var cached=window._SI_ITEMS||[];
  if(!cached.length){
    db.ref('shared/inv_items').once('value',function(snap){
      var raw=snap.val();
      if(raw){
        var arr=Array.isArray(raw)?raw.filter(Boolean):Object.values(raw).filter(Boolean);
        window._SI_ITEMS=arr.filter(function(i){return i&&i.name;});
      } else { window._SI_ITEMS=[]; }
      renderSharedIngTable('');
    });
    return '<div style="text-align:center;padding:30px;color:var(--text-secondary)">⏳ Loading...</div>';
  }
  var filtered=q?cached.filter(function(i){
    return String(i.code||'').toLowerCase().indexOf(q)>=0||String(i.name||'').toLowerCase().indexOf(q)>=0||String(i.category||'').toLowerCase().indexOf(q)>=0;
  }):cached;
  filtered=filtered.slice().sort(function(a,b){return String(a.code||'').localeCompare(String(b.code||''));});
  if(!filtered.length) return '<div class="bcard"><div style="text-align:center;padding:30px;color:var(--text-secondary)">'+(q?'No items match — try a different search':'No shared ingredients yet. Click + Add Ingredient to start.')+'</div></div>';
  var rows=filtered.map(function(it){
    return '<tr>'+
      '<td class="bmono" style="font-weight:700;color:var(--ceo);font-size:10px">'+bxe(it.code||'—')+'</td>'+
      '<td style="font-weight:600">'+bxe(it.name||'—')+'</td>'+
      '<td>'+bxe(it.category||'—')+'</td>'+
      '<td class="bmono">'+bxe(it.unit&&it.unit!==it.location?it.unit:(it.uom||'EA'))+'</td>'+
      '<td class="bmono" style="color:var(--text-secondary)">'+parseFloat(it.price||0).toFixed(4)+' SAR</td>'+
      '<td><div style="display:flex;gap:4px">'+
        '<button class="btn btn-sm" onclick="openSharedIngModal(\''+bxe(String(it.code||''))+'\')" >Edit</button>'+
        '<button class="btn btn-sm" style="color:var(--danger)" onclick="delSharedIng(\''+bxe(String(it.code||''))+'\')" >Del</button>'+
      '</div></td>'+
    '</tr>';
  }).join('');
  return '<div class="bcard" style="padding:0;overflow:auto"><table class="btbl"><thead><tr><th>Code</th><th>Name</th><th>Category</th><th>Unit</th><th>Cost/Unit</th><th>Actions</th></tr></thead><tbody>'+rows+'</tbody></table></div>'+
    '<div style="font-size:10px;color:var(--text-tertiary);margin-top:8px;font-family:var(--mono)">'+filtered.length+' ingredient(s) in shared catalog</div>';
}
function openSharedIngModal(code) {
  var it=null;
  if(code) it=(window._SI_ITEMS||[]).find(function(i){return String(i.code)===String(code);});
  var UNITS=['g','kg','ml','L','pc','pcs','oz','tbsp','tsp','cup','slice','portion','bunch','pack','can','bottle','bag','box'];
  var CATS=['Meat','Seafood','Vegetable','Dairy','Bakery','Sauce','Spice','Grain','Beverage','Other'];
  var uOpts=UNITS.map(function(u){return '<option'+(it&&it.unit===u?' selected':'')+'>'+u+'</option>';}).join('');
  var cOpts=CATS.map(function(c){return '<option'+(it&&it.category===c?' selected':'')+'>'+c+'</option>';}).join('');
  var html='<div class="modal-head"><h2>'+(it?'Edit':'Add')+' Shared Ingredient</h2><button class="modal-close" onclick="closeModalForce()">✕</button></div>';
  html+='<div class="form-row">';
  html+='<div class="bfg"><label class="form-label">Code *</label><input class="form-input" id="si-code" value="'+bxe(it?it.code:'')+'" '+(it?'readonly':'')+'placeholder="e.g. BEV-01"></div>';
  html+='<div class="bfg"><label class="form-label">Category</label><select class="form-input form-select" id="si-cat">'+cOpts+'</select></div>';
  html+='</div>';
  html+='<div class="bfg"><label class="form-label">Name *</label><input class="form-input" id="si-name" value="'+bxe(it?it.name:'')+'" placeholder="Ingredient name"></div>';
  html+='<div class="form-row">';
  html+='<div class="bfg"><label class="form-label">Unit</label><select class="form-input form-select" id="si-unit">'+uOpts+'</select></div>';
  html+='<div class="bfg"><label class="form-label">Cost per Unit (SAR) *</label><input class="form-input" type="number" step="0.0001" id="si-price" value="'+bxe(it?it.price||'':'')+'" placeholder="0.0000"></div>';
  html+='</div>';
  html+='<div class="bfg"><label class="form-label">Supplier</label><input class="form-input" id="si-supplier" value="'+bxe(it?it.supplier||'':'')+'" placeholder="Optional"></div>';
  html+='<button class="btn btn-primary" style="width:100%;margin-top:8px" onclick="saveSharedIng()">💾 Save Ingredient</button>';
  openModal(html);
}
function saveSharedIng() {
  var code=(document.getElementById('si-code').value||'').trim();
  var name=(document.getElementById('si-name').value||'').trim();
  var price=parseFloat(document.getElementById('si-price').value)||0;
  if(!code||!name){showToast('Code and Name are required','error');return;}
  var it={code:code,name:name,category:document.getElementById('si-cat').value,unit:document.getElementById('si-unit').value,price:price,supplier:(document.getElementById('si-supplier').value||'').trim()};
  var k=code.replace(/[.#$\[\]\/]/g,'_');
  db.ref('shared/inv_items/'+k).set(it,function(err){
    if(err){showToast('Save error: '+err,'error');return;}
    // Update local cache
    var idx=(window._SI_ITEMS||[]).findIndex(function(i){return String(i.code)===String(code);});
    if(idx>=0) window._SI_ITEMS[idx]=it; else (window._SI_ITEMS=window._SI_ITEMS||[]).push(it);
    showToast(name+' saved ✓','success');
    closeModalForce();
    renderSharedIngTable(document.getElementById('si-search')?document.getElementById('si-search').value:'');
  });
}
function openImportPricesModal() {
  // Load available branches
  var html='<div class="modal-head"><h2>📥 Import Prices from Branch</h2><button class="modal-close" onclick="closeModalForce()">✕</button></div>';
  html+='<p style="font-size:12px;color:var(--text-secondary);margin-bottom:16px">Reads prices from a branch inventory and updates matching items in the shared catalog by code.</p>';
  html+='<div class="bfg"><label class="form-label">Select Branch</label><select class="form-input form-select" id="imp-branch-sel"><option value="">Loading branches...</option></select></div>';
  html+='<div id="imp-status" style="font-size:11px;color:var(--text-secondary);font-family:var(--mono);margin:8px 0;min-height:18px"></div>';
  html+='<div style="display:flex;gap:8px;margin-top:12px">';
  html+='<button class="btn btn-primary" style="flex:1" onclick="importPricesFromBranch()">📥 Import Prices</button>';
  html+='<button class="btn" onclick="closeModalForce()">Cancel</button>';
  html+='</div>';
  openModal(html);
  // Load branches
  db.ref('admin/branches').once('value',function(snap){
    var sel=document.getElementById('imp-branch-sel');
    if(!sel) return;
    var braw=snap.val()||{};
    var opts=Object.entries(braw).filter(function(e){return e[1]&&e[1].active!==false;}).map(function(e){
      var b=e[1]; return '<option value="'+bxe(e[0])+'">'+bxe(b.name||e[0])+(b.city?' ('+b.city+')':'')+'</option>';
    });
    sel.innerHTML=opts.length?opts.join(''):'<option value="">No branches found</option>';
  });
}

function importPricesFromBranch() {
  var sel=document.getElementById('imp-branch-sel');
  var bid=sel?sel.value:'';
  if(!bid){showToast('Select a branch first','error');return;}
  var status=document.getElementById('imp-status');
  if(status) status.textContent='Loading branch inventory...';
  db.ref('branches/'+bid+'/inv_items').once('value',function(snap){
    var raw=snap.val();
    if(!raw){if(status)status.textContent='No inventory found in this branch.';return;}
    var arr=Array.isArray(raw)?raw.filter(Boolean):Object.values(raw).filter(Boolean);
    // Build price map by code
    var priceMap={};
    arr.forEach(function(it){
      if(it&&it.code&&(it.price||it.cost)) {
        priceMap[String(it.code)]={price:parseFloat(it.price||it.cost)||0, unit:it.unit||it.uom||'EA'};
      }
    });
    // Update shared/inv_items matching by code
    var shared=window._SI_ITEMS||[];
    var updated=0, missing=0;
    var updates={};
    shared.forEach(function(it){
      var code=String(it.code||'');
      var match=priceMap[code];
      if(match&&match.price>0){
        var k=code.replace(/[.#$\[\]\/]/g,'_');
        updates['shared/inv_items/'+k+'/price']=match.price;
        if(!it.unit||it.unit===it.location) updates['shared/inv_items/'+k+'/unit']=match.unit;
        it.price=match.price;
        if(!it.unit||it.unit===it.location) it.unit=match.unit;
        updated++;
      } else { missing++; }
    });
    if(!updated){
      if(status)status.textContent='No matching codes found with prices. Check codes match.';
      return;
    }
    db.ref('/').update(updates,function(err){
      if(err){if(status)status.textContent='Error: '+err;return;}
      window._SI_ITEMS=shared;
      if(status)status.textContent='✓ Updated '+updated+' items. '+missing+' not found in branch.';
      showToast('✓ '+updated+' prices imported','success');
      renderSharedIngTable(document.getElementById('si-search')?document.getElementById('si-search').value:'');
    });
  });
}

function delSharedIng(code) {
  var it=(window._SI_ITEMS||[]).find(function(i){return String(i.code)===String(code);});
  if(!confirm('Delete '+((it&&it.name)||code)+' from shared catalog?'))return;
  var k=String(code).replace(/[.#$\[\]\/]/g,'_');
  db.ref('shared/inv_items/'+k).remove(function(err){
    if(err){showToast('Error: '+err,'error');return;}
    window._SI_ITEMS=(window._SI_ITEMS||[]).filter(function(i){return String(i.code)!==String(code);});
    showToast('Deleted ✓','success');
    renderSharedIngTable(document.getElementById('si-search')?document.getElementById('si-search').value:'');
  });
}

function pAuditLog() {
  var h = '<div class="page-header"><h1>Activity Log</h1><p>System events from NXMon · ' + getAccessibleBranches().length + ' branch(es) monitored</p></div>';
  h += '<div class="header-actions"><div></div><div style="display:flex;gap:8px">';
  h += '<button class="btn" onclick="auditExportCSV()">&#x2B07; Export CSV</button>';
  if ((NX.session||{}).role === 'super_admin') h += '<button class="btn" style="color:var(--danger);border-color:rgba(248,113,113,.3)" onclick="auditClearOld()">&#x1F5D1; Clear Old (30d+)</button>';
  h += '</div></div>';

  // Use real notifications as the activity feed
  var events = (NX.notifications||[]).slice(0,30);
  if (!events.length) {
    h += '<div class="empty-state section"><div style="font-size:40px;margin-bottom:12px">📋</div><h3>No activity yet</h3><p style="color:var(--text-secondary)">Activity appears here as NXMon detects events from Firebase</p></div>';
    return h;
  }

  h += '<div class="table-wrap section"><table class="data-table"><thead><tr>';
  h += '<th>Time</th><th>Event</th><th>Branch</th><th>Type</th>';
  h += '</tr></thead><tbody>';
  events.forEach(function(n) {
    var ago = '';
    if (n.ts) {
      var d = Date.now()-n.ts;
      ago = d<60000?'just now':d<3600000?Math.floor(d/60000)+'m ago':Math.floor(d/3600000)+'h ago';
    }
    var typeColors = { danger:'#c0392b', warning:'#b45309', info:'#0057ff' };
    h += '<tr>';
    h += '<td class="mono" style="color:var(--text-tertiary);font-size:11px">' + ago + '</td>';
    h += '<td><strong style="color:var(--text-primary)">' + (n.icon||'') + ' ' + xe(n.title) + '</strong><div style="font-size:11px;color:var(--text-secondary)">' + xe(n.msg||'') + '</div></td>';
    h += '<td style="font-size:12px">' + xe(n.branch||'—') + '</td>';
    h += '<td><span style="color:' + (typeColors[n.type]||'var(--text-tertiary)') + ';font-weight:600;font-size:11px">' + xe(n.type||'info') + '</span></td>';
    h += '</tr>';
  });
  h += '</tbody></table></div>';
  return h;
}

// ── PAGE: BRAND DASHBOARD ──
function auditExportCSV() {
  var events = (NX.notifications||[]).slice(0,200);
  var rows = [['Time','Event','Message','Branch','Type']];
  events.forEach(function(n){
    var ago='';
    if(n.ts){var d=Date.now()-n.ts;ago=d<60000?'just now':d<3600000?Math.floor(d/60000)+'m ago':Math.floor(d/3600000)+'h ago';}
    rows.push([ago,n.title||'',n.msg||'',n.branch||'',n.type||'info']);
  });
  var csv=rows.map(function(r){return r.map(function(c){return '"'+String(c).replace(/"/g,'""')+'"';}).join(',');}).join('\n');
  var a=document.createElement('a');a.href='data:text/csv;charset=utf-8,'+encodeURIComponent(csv);a.download='audit-log-'+TODAY_BS+'.csv';a.click();
  showToast('Log exported','success');
}

function auditClearOld() {
  if(!confirm('Remove all notifications older than 30 days? This only clears the in-memory list.'))return;
  var cutoff=Date.now()-30*24*3600000;
  NX.notifications=(NX.notifications||[]).filter(function(n){return (n.ts||0)>cutoff;});
  showToast('Old entries cleared','success');
  navTo('audit-log');
}


function pBrandDash() {
  var s = NX.session || {};
  var branches = getAccessibleBranches();
  var totalToday = 0, totalMTD = 0;
  branches.forEach(function(b) { totalToday += branchSalesToday(b.id); totalMTD += branchSalesMTD(b.id); });
  var userName = s.userName || s.entityName || (s.role === 'brand_dir' ? 'Brand Director' : 'Area Manager');
  var roleLabel = s.role === 'brand_dir' ? 'Brand Director' : 'Area Manager';

  var h = '<div class="page-header"><h1>' + xe(userName) + '</h1>';
  h += '<p>' + roleLabel + ' · ' + branches.length + ' branch(es) assigned · ' + fmtDate(new Date()) + '</p></div>';

  if (!branches.length) {
    h += '<div class="empty-state"><div class="es-icon">🏪</div>';
    h += '<h3>No branches assigned</h3>';
    h += '<p style="color:var(--text-secondary)">Ask the CEO or Super Admin to assign branches to your account in Access Control.</p></div>';
    return h;
  }

  // KPI summary across all assigned branches
  h += '<div class="kpi-grid section">';
  h += kpiCard('💰','Today — All Branches', formatSAR(totalToday), branches.length + ' branch(es)', 'var(--ceo)', 'Live from Firebase', '');
  h += kpiCard('📅','MTD — All Branches', formatSAR(totalMTD), new Date().toLocaleDateString('en-GB',{month:'long',year:'numeric'}), 'var(--brand-dir)', '', '');
  h += kpiCard('🏢','Branches', branches.length, 'Assigned to you', 'var(--info)', '', '');
  h += kpiCard('📊','Daily Avg', formatSAR(totalMTD / Math.max(1, new Date().getDate())), 'This month', 'var(--branch-mgr)', '', '');
  h += '</div>';

  // Per-branch breakdown cards
  h += '<div class="section"><h3 style="font-size:12px;font-weight:700;color:var(--text-secondary);text-transform:uppercase;letter-spacing:.08em;margin-bottom:14px">Branch Breakdown</h3>';
  h += '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:14px">';
  branches.forEach(function(b) {
    var bt = branchSalesToday(b.id), bm = branchSalesMTD(b.id);
    var dayAvg = bm / Math.max(1, new Date().getDate());
    h += '<div class="card" style="border-left:3px solid ' + (b.color||'#f0a500') + '">';
    h += '<div style="display:flex;align-items:center;gap:10px;margin-bottom:14px">';
    h += '<div style="width:38px;height:38px;border-radius:9px;background:' + (b.color||'#f0a500') + '20;display:flex;align-items:center;justify-content:center;font-size:18px;flex-shrink:0">' + (b.icon||'🍽️') + '</div>';
    h += '<div><div style="font-size:14px;font-weight:700;color:var(--text-primary)">' + xe(b.name) + '</div>';
    h += '<div style="font-size:10px;color:var(--text-secondary)">' + xe(b.brand||'') + (b.location?' · '+xe(b.location):'') + '</div></div>';
    h += '<button class="btn btn-sm" style="margin-left:auto" onclick="switchBranch(\'' + xe(b.id) + '\')">Open →</button></div>';
    h += '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px">';
    [['Today',formatSAR(bt),'var(--ceo)'],['MTD',formatSAR(bm),'var(--brand-dir)'],['Daily Avg',formatSAR(dayAvg),'var(--info)']].forEach(function(m){
      h += '<div style="background:var(--surface-3);border-radius:8px;padding:9px">';
      h += '<div style="font-size:9px;color:var(--text-tertiary);text-transform:uppercase;letter-spacing:.06em">' + m[0] + '</div>';
      h += '<div style="font-size:13px;font-weight:700;color:' + m[2] + ';font-family:var(--mono);margin-top:2px">' + m[1] + '</div></div>';
    });
    h += '</div>';
    h += '<div style="margin-top:10px;font-size:11px;color:var(--text-tertiary)">Manager: ' + xe(b.manager||'—') + '</div>';
    h += '</div>';
  });
  h += '</div></div>';
  return h;
}

// ── PAGE: BRAND BRANCHES ──
function pBrandBranches() {
  var s = NX.session || {};
  var canEdit = (s.role==='super_admin'||s.role==='ceo'||s.role==='brand_dir');
  var branches = getAccessibleBranches().filter(function(b) {
    return !s.brandName || (b.brand||b.name) === s.brandName;
  });
  var h = '<div class="page-header"><h1>My Branches</h1><p>' + branches.length + ' branch(es)</p></div>';
  h += '<div class="table-wrap section"><table class="data-table"><thead><tr>';
  h += '<th>Branch</th><th>Location</th><th>Manager</th><th>FC Target</th><th>Monthly Target</th><th>Today</th><th>MTD</th><th>Actions</th>';
  h += '</tr></thead><tbody>';
  branches.forEach(function(b) {
    var mtd = branchSalesMTD(b.id); var tgt = b.monthlyTarget||0;
    var vsT = tgt>0?((mtd/tgt)*100).toFixed(0)+'%':'—';
    var tCol = tgt>0&&mtd>=tgt?'#00875a':tgt>0?'#c0392b':'var(--text-tertiary)';
    h += '<tr>';
    h += '<td><div style="display:flex;align-items:center;gap:8px"><span style="font-size:18px">' + (b.icon||'\u{1F374}') + '</span><strong>' + xe(b.name) + '</strong></div></td>';
    h += '<td>' + xe(b.location||'—') + '</td>';
    h += '<td>' + xe(b.manager||'—') + '</td>';
    h += '<td class="mono">' + (b.fcTarget?b.fcTarget+'%':'—') + '</td>';
    h += '<td class="mono" style="color:'+tCol+'">' + (tgt?formatSAR(tgt)+' ('+vsT+')':'—') + '</td>';
    h += '<td class="mono">' + formatSAR(branchSalesToday(b.id)) + '</td>';
    h += '<td class="mono">' + formatSAR(mtd) + '</td>';
    h += '<td><div style="display:flex;gap:4px">';
    h += '<button class="btn btn-sm" onclick="switchBranch(\'' + xe(b.id) + '\')">View</button>';
    if (canEdit) h += '<button class="btn btn-sm" onclick="openDirectorBranchEdit(\'' + xe(b.id) + '\')">&#x2699; Edit</button>';
    h += '</div></td></tr>';
  });
  if (!branches.length) h += '<tr><td colspan="8" style="text-align:center;color:var(--text-tertiary);padding:24px">No branches assigned</td></tr>';
  h += '</tbody></table></div>';
  return h;
}

function openDirectorBranchEdit(branchId) {
  if (!db) { showToast('Not connected','error'); return; }
  db.ref('admin/branches/' + branchId).once('value', function(snap) {
    var b = snap.val() || {};
    openModal(
      '<div class="modal-head"><h2>&#x2699; Edit Branch Config</h2><button class="modal-close" onclick="closeModalForce()">&#x2715;</button></div>' +
      '<div class="form-row"><div class="form-group"><label class="form-label">Branch Name</label>' +
        '<input class="form-input" id="dbe-name" value="' + xe(b.name||'') + '"></div>' +
        '<div class="form-group"><label class="form-label">Location</label>' +
        '<input class="form-input" id="dbe-loc" value="' + xe(b.location||'') + '"></div></div>' +
      '<div class="form-row"><div class="form-group"><label class="form-label">Manager</label>' +
        '<input class="form-input" id="dbe-mgr" value="' + xe(b.manager||'') + '"></div>' +
        '<div class="form-group"><label class="form-label">FC Target (%)</label>' +
        '<input class="form-input" type="number" id="dbe-fc" value="' + (b.fcTarget||30) + '" min="0" max="100"></div></div>' +
      '<div class="form-row"><div class="form-group"><label class="form-label">Seating Capacity</label>' +
        '<input class="form-input" type="number" id="dbe-seats" value="' + (b.seats||0) + '"></div>' +
        '<div class="form-group"><label class="form-label">Monthly Sales Target (‫SAR ‬)</label>' +
        '<input class="form-input" type="number" id="dbe-tgt" value="' + (b.monthlyTarget||0) + '" placeholder="0"></div></div>' +
      '<div style="display:flex;gap:8px;margin-top:8px">' +
        '<button class="btn" style="flex:1" onclick="closeModalForce()">Cancel</button>' +
        '<button class="btn btn-primary" style="flex:2" onclick="saveDirectorBranchEdit(\'' + xe(branchId) + '\')">&#x1F4BE; Save Changes</button>' +
      '</div>'
    );
  });
}

function saveDirectorBranchEdit(branchId) {
  var name = document.getElementById('dbe-name').value.trim();
  if (!name) { showToast('Name required','error'); return; }
  var updates = {
    name: name,
    location: document.getElementById('dbe-loc').value.trim(),
    manager: document.getElementById('dbe-mgr').value.trim(),
    fcTarget: parseFloat(document.getElementById('dbe-fc').value)||30,
    seats: parseInt(document.getElementById('dbe-seats').value)||0,
    monthlyTarget: parseFloat(document.getElementById('dbe-tgt').value)||0
  };
  db.ref('admin/branches/' + branchId).update(updates, function(err) {
    if (err) { showToast('Save failed: ' + err.message,'error'); return; }
    closeModalForce(); showToast('Branch updated','success');
    navTo('brand-branches');
  });
}

// ── PAGE: REGION DASHBOARD ──
function pRegionDash() {
  var s = NX.session || {};
  var branches = getAccessibleBranches();
  var totalToday = 0, totalMTD = 0;
  branches.forEach(function(b) { totalToday += branchSalesToday(b.id); totalMTD += branchSalesMTD(b.id); });
  var userName = s.userName || s.entityName || 'Area Manager';

  var h = '<div class="page-header"><h1>' + xe(userName) + '</h1>';
  h += '<p>Area Manager · ' + branches.length + ' branch(es) · ' + fmtDate(new Date()) + '</p></div>';

  if (!branches.length) {
    h += '<div class="empty-state"><div class="es-icon">🗺️</div>';
    h += '<h3>No branches assigned</h3>';
    h += '<p style="color:var(--text-secondary)">Ask the Director or CEO to assign branches to your account in Access Control.</p></div>';
    return h;
  }

  h += '<div class="kpi-grid section">';
  h += kpiCard('💰','Today', formatSAR(totalToday), branches.length + ' branch(es)', 'var(--regional)', '', '');
  h += kpiCard('📅','MTD', formatSAR(totalMTD), 'This month', 'var(--ceo)', '', '');
  h += kpiCard('🏢','Branches', branches.length, 'Under your supervision', 'var(--info)', '', '');
  h += kpiCard('📊','Daily Avg', formatSAR(totalMTD / Math.max(1, new Date().getDate())), 'Per day this month', 'var(--branch-mgr)', '', '');
  h += '</div>';

  // Sales comparison table
  h += '<div class="card section">';
  h += '<div style="font-size:11px;font-weight:700;color:var(--text-secondary);text-transform:uppercase;letter-spacing:.08em;margin-bottom:14px">Sales Comparison</div>';
  h += '<table class="data-table"><thead><tr><th>Branch</th><th>Brand</th><th>Today</th><th>MTD</th><th>Daily Avg</th><th>Actions</th></tr></thead><tbody>';
  // Sort by today descending
  var sorted = branches.slice().sort(function(a,b){ return branchSalesToday(b.id)-branchSalesToday(a.id); });
  sorted.forEach(function(b, rank) {
    var bt = branchSalesToday(b.id), bm = branchSalesMTD(b.id);
    var dayAvg = bm / Math.max(1, new Date().getDate());
    var medal = rank===0?'🥇':rank===1?'🥈':rank===2?'🥉':'';
    h += '<tr>';
    h += '<td><div style="display:flex;align-items:center;gap:8px">' + medal + ' <span>' + (b.icon||'🍽️') + '</span><strong>' + xe(b.name) + '</strong></div></td>';
    h += '<td style="color:var(--text-secondary)">' + xe(b.brand||'—') + '</td>';
    h += '<td class="mono" style="color:var(--ceo)">' + formatSAR(bt) + '</td>';
    h += '<td class="mono" style="color:var(--brand-dir)">' + formatSAR(bm) + '</td>';
    h += '<td class="mono">' + formatSAR(dayAvg) + '</td>';
    h += '<td><button class="btn btn-sm" onclick="switchBranch(\'' + xe(b.id) + '\')">Open</button></td>';
    h += '</tr>';
  });
  h += '</tbody></table></div>';

  // Per-branch cards
  h += '<div class="section"><div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:12px">';
  sorted.forEach(function(b) {
    var bt = branchSalesToday(b.id), bm = branchSalesMTD(b.id);
    h += '<div class="card" style="border-left:3px solid ' + (b.color||'#f0a500') + '">';
    h += '<div style="display:flex;align-items:center;gap:8px;margin-bottom:10px">';
    h += '<span style="font-size:18px">' + (b.icon||'🍽️') + '</span>';
    h += '<div><div style="font-size:13px;font-weight:700">' + xe(b.name) + '</div>';
    h += '<div style="font-size:10px;color:var(--text-secondary)">' + xe(b.location||'') + '</div></div>';
    h += '<button class="btn btn-sm" style="margin-left:auto" onclick="switchBranch(\'' + xe(b.id) + '\')">→</button></div>';
    h += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">';
    h += '<div style="background:var(--surface-3);border-radius:8px;padding:8px"><div style="font-size:9px;color:var(--text-tertiary)">TODAY</div><div style="font-size:13px;font-weight:700;color:var(--ceo);font-family:var(--mono)">' + formatSAR(bt) + '</div></div>';
    h += '<div style="background:var(--surface-3);border-radius:8px;padding:8px"><div style="font-size:9px;color:var(--text-tertiary)">MTD</div><div style="font-size:13px;font-weight:700;color:var(--brand-dir);font-family:var(--mono)">' + formatSAR(bm) + '</div></div>';
    h += '</div></div>';
  });
  h += '</div></div>';
  return h;
}

// ── PAGE: REGION BRANCHES ──
function pRegionBranches() {
  var s = NX.session || {};
  var canEdit = (s.role==='super_admin'||s.role==='ceo'||s.role==='brand_dir'||s.role==='regional');
  var branches = getAccessibleBranches().filter(function(b) {
    if (s.brandName && (b.brand||b.name) !== s.brandName) return false;
    if (s.regionName && b.location !== s.regionName) return false;
    return true;
  });
  var h = '<div class="page-header"><h1>Region Branches</h1><p>' + branches.length + ' branch(es) under supervision</p></div>';
  h += '<div class="table-wrap section"><table class="data-table"><thead><tr>';
  h += '<th>Branch</th><th>Manager</th><th>FC Target</th><th>Today</th><th>MTD</th><th>vs Target</th><th>Actions</th>';
  h += '</tr></thead><tbody>';
  var sorted = branches.slice().sort(function(a,b){ return branchSalesToday(b.id)-branchSalesToday(a.id); });
  sorted.forEach(function(b, rank) {
    var medal = rank===0?'\uD83E\uDD47':rank===1?'\uD83E\uDD48':rank===2?'\uD83E\uDD49':'';
    var mtd = branchSalesMTD(b.id); var tgt = b.monthlyTarget||0;
    var vsT = tgt>0?((mtd/tgt)*100).toFixed(0)+'%':'—';
    var tCol = tgt>0&&mtd>=tgt?'#00875a':tgt>0?'#c0392b':'var(--text-tertiary)';
    h += '<tr>';
    h += '<td><div style="display:flex;align-items:center;gap:6px">' + medal + ' <span>' + (b.icon||'\uD83C\uDF74') + '</span><strong>' + xe(b.name) + '</strong></div></td>';
    h += '<td>' + xe(b.manager||'—') + '</td>';
    h += '<td class="mono">' + (b.fcTarget?b.fcTarget+'%':'—') + '</td>';
    h += '<td class="mono" style="color:var(--ceo)">' + formatSAR(branchSalesToday(b.id)) + '</td>';
    h += '<td class="mono">' + formatSAR(mtd) + '</td>';
    h += '<td class="mono" style="color:'+tCol+';font-weight:600">' + (tgt?vsT+' of '+formatSAR(tgt):'<span style="color:var(--text-tertiary)">No target</span>') + '</td>';
    h += '<td><div style="display:flex;gap:4px">';
    h += '<button class="btn btn-sm" onclick="switchBranch(\'' + xe(b.id) + '\')">View</button>';
    if (canEdit) h += '<button class="btn btn-sm" onclick="openDirectorBranchEdit(\'' + xe(b.id) + '\')">&#x2699; Edit</button>';
    h += '</div></td></tr>';
  });
  if (!branches.length) h += '<tr><td colspan="7" style="text-align:center;color:var(--text-tertiary);padding:24px">No branches assigned</td></tr>';
  h += '</tbody></table></div>';
  return h;
}

// ── PAGE: BRANCH DASHBOARD ──
// ══════════════════════════════════════════════════════
// BRANCH MANAGER ENGINE — ported from OpsHub
// Full Firebase-connected operations management
// ══════════════════════════════════════════════════════

// ── Branch-scoped Firebase path helper ──
function bPath(rel) {
  // Uses same flat path as OpsHub: branches/{branchId}/{collection}
  var s = NX.session;
  if (!s || !s.branchId) return rel;
  return 'branches/' + s.branchId + '/' + rel;
}

// ── Branch state (mirrors OpsHub S) ──
var BS = {
  staff:[], sch:{}, sales:[], waste:[], wares:[], rem:[], pc:[], health:[], invoices:[],
  tsEmps:[], tsAtt:{}, tsLeaves:[],
  tsTab:'att', tsLTab:'all', tsSt:'present', tsViewDate:'', attFilt:'all', fd:'All', _roleFilter:'All',
  inv_loc:'', inv_sts:'', inv_uom:'', inv_page:0, waresFilter:'all', q:'',
  _branchConfig:{}, recipes:[]
};
var bItems = [], bLogs = [], bOrders = [];
var _bListenersAttached = false;

// ── Data constants (same as OpsHub) ──
var DEPTS = ['Management','Kitchen','FOH','Bar','Maintenance','Other'];
var _deptAliases = {
  'manager':'Management','managers':'Management','management':'Management',
  'kitchen':'Kitchen','foh':'FOH','front of house':'FOH',
  'bar':'Bar','maintenance':'Maintenance','other':'Other'
};
// ── Dept alias normalizer — dynamically updated when DEPTS changes ──
function normalizeDept(d) {
  if (!d) return '';
  var dStr = String(d).trim();
  return _deptAliases[dStr.toLowerCase()] || dStr;
}
var ROLES = ['Restaurant Manager','Assistant Manager','Senior Supervisor','Supervisor','Kitchen Manager','Assistant Kitchen Manager','Captain','Server','Host','Barista','Busser','Line Cook','Prep Cook','Dishwasher'];
var STATS = ['Active','Off Today','On Leave','Training'];
var ACC_LEVELS = ['Admin','Manager','Staff'];
var WR = ['Expired','Over-produced','Spoiled','Dropped','Contaminated','Over-portioned','Plate return','Quality reject'];
var PCC = ['Kitchen','FOH','Bar','Management','Maintenance','Transport','Office','Miscellaneous'];
var INV_S = ['Pending','Received','Approved','Paid','Overdue','Disputed'];
var INV_SC = {Pending:'#b45309',Received:'#0057ff',Approved:'#5b21b6',Paid:'#00875a',Overdue:'#e55',Disputed:'#b45309'};
var INV_CAT = ['Food & Beverage','Cleaning Supplies','Kitchen Equipment','Maintenance','Packaging','Uniforms','Marketing','Other'];
var TS_ST_BRANCH = {present:{l:'P — Present',c:'#00875a'},late:{l:'L — Late',c:'#b45309'},absent:{l:'A — Absent',c:'#c0392b'},sick:{l:'S — Sick',c:'#b45309'},holiday:{l:'H — Holiday',c:'#5b21b6'},dayoff:{l:'O — OFF',c:'#b45309'}};
var TS_LT_BRANCH = {sick:{l:'Sick Leave',c:'#b45309'},holiday:{l:'Annual Holiday',c:'#5b21b6'},dayoff:{l:'OFF',c:'#00875a'}};
var MONTHS_FULL = ['January','February','March','April','May','June','July','August','September','October','November','December'];
var DAYS_WEEK = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
var TODAY_BS = (function(){var d=new Date();return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');})();
var DEFAULT_SUPPLIERS = ['Al Safi','Al Jazira Foods','Masdar Al Hayat','Modern Business Makers Company','Pepsi Co','Sitaf'];
var DEFAULT_LOCATIONS = ['Dry Storage','Beverage Storage','Production Cooler','Walk-in Chiller','Walk-in Freezer','Chemical Storage','Paper & Chemical','Freezer','Fridge','Small Wares','Front Line','General Storage','Unassigned'];

function getLocations(){return (BS.locations&&BS.locations.length)?BS.locations:DEFAULT_LOCATIONS.slice();}
function getSuppliers(){return (BS.suppliers&&BS.suppliers.length)?BS.suppliers:DEFAULT_SUPPLIERS.slice();}

// ── Helpers (scoped to branch engine) ──
function buid() { return Date.now().toString(36) + Math.random().toString(36).slice(2); }
function bxe(s) { return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function bini(n) { var p=String(n||'').split(' '),r='';for(var i=0;i<p.length&&r.length<2;i++)if(p[i])r+=p[i][0].toUpperCase();return r; }
function bfdate(d) { return d?new Date(d+'T00:00:00').toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'}):'—'; }
function bfsar(v) { return 'SAR '+parseFloat(v||0).toLocaleString('en',{minimumFractionDigits:2,maximumFractionDigits:2}); }
function bpl(l,c) { return '<span style="background:'+c+'18;color:'+c+';border:1px solid '+c+'30;padding:2px 8px;border-radius:12px;font-size:11px;font-weight:500">'+bxe(l)+'</span>'; }
function bmthKey(off) { var d=new Date();if(off)d.setMonth(d.getMonth()+off);return d.getFullYear()+'-'+(d.getMonth()<9?'0':'')+(d.getMonth()+1); }
function bselOpts(arr,sel) { var h='';for(var i=0;i<arr.length;i++)h+='<option value="'+bxe(arr[i])+'"'+(arr[i]===sel?' selected':'')+'>'+bxe(arr[i])+'</option>';return h; }
function bgv(id) { var e=document.getElementById(id);return e?e.value.trim():''; }
function bdrem(ds) { if(!ds)return null;return Math.ceil((new Date(ds+'T00:00:00')-new Date(TODAY_BS+'T00:00:00'))/86400000); }
function bremBadge(days) {
  if(days===null)return '<span style="color:var(--text-tertiary)">—</span>';
  if(days<0) return bpl('Expired '+Math.abs(days)+'d','#c0392b');
  if(days<=30) return bpl(days+'d left','#b45309');
  if(days<=60) return bpl(days+'d left','#d97706');
  return bpl(days+'d left','#059669');
}
function bdc(d) { var dn=normalizeDept(d||''); return dn==='Management'?'#b45309':dn==='Kitchen'?'#0057ff':dn==='Bar'?'#5b21b6':dn==='Maintenance'?'#c0392b':'#00875a'; }
function btsHrs(a,b) { if(!a||!b)return '—';var x=a.split(':').map(Number),y=b.split(':').map(Number),d=(y[0]*60+y[1])-(x[0]*60+x[1]);if(d<0)d+=24*60;return d<=0?'—':Math.floor(d/60)+'h '+d%60+'m'; }
function btsBadge(s) { var c=TS_ST_BRANCH[s]||TS_ST_BRANCH.absent;return bpl(c.l,c.c); }
function bweekKey() {
  var d=new Date();d.setDate(d.getDate()+(BS.wo||0)*7);
  var y=d.getFullYear(),j=new Date(y,0,1),w=Math.ceil(((d-j)/86400000+j.getDay()+1)/7);
  return y+'-W'+(w<10?'0':'')+w;
}
function bweekDates() {
  var d=new Date();d.setDate(d.getDate()+(BS.wo||0)*7);
  var sun=new Date(d);sun.setDate(d.getDate()-d.getDay());
  var o=[];
  for(var i=0;i<7;i++){var dd=new Date(sun);dd.setDate(sun.getDate()+i);o.push(dd.getFullYear()+'-'+String(dd.getMonth()+1).padStart(2,'0')+'-'+String(dd.getDate()).padStart(2,'0'));}
  return o;
}
function bfindItem(code) { for(var i=0;i<bItems.length;i++) if(bItems[i].code===code) return bItems[i]; return null; }
function bfindOrder(id) { for(var i=0;i<bOrders.length;i++) if(bOrders[i].id===id) return bOrders[i]; return null; }
// ── Real staff seed data (from OpsHub) ──────────────────────────────────────
function defStaff() {
  var d = [
    ['1','KHALED AHMED','Manager','Manager'],
    ['2','Raymond Buenavista','Kitchen','Staff'],
    ['3','Raed Abdullah Al Ghamdi','FOH','Staff'],
    ['4','Yam RANA','Kitchen','Staff'],
    ['5','ANTONIO JR DUMAYAS','Kitchen','Staff'],
    ['6','SABIN GURUNG','Kitchen','Staff'],
    ['7','LESTER ALCABASA','FOH','Staff'],
    ['8','Gabby Dolete','FOH','Staff'],
    ['9','KRISHNA THAPA','Kitchen','Staff'],
    ['10','MUHAMMAD ISTIYAQUE ANSARI','Kitchen','Staff'],
    ['11','Mohammed Zubair Mohamed Yakub','Kitchen','Staff'],
    ['12','Regino Yadao','FOH','Staff'],
    ['13','WEJDAN SULEMAN ALEMAYRI','FOH','Staff'],
    ['14','Ifurung Michael','Kitchen','Staff'],
    ['15','Jennifer Balagtas','FOH','Staff'],
    ['16','Roselyn Arceo','FOH','Staff'],
    ['17','Gyanu Poudel','Kitchen','Staff'],
    ['18','KASHIRAM PAUDEL','Kitchen','Staff'],
    ['19','Birendra Chaudhari','Kitchen','Staff'],
    ['20','CHITRA BAHADUR KUNWAR','Kitchen','Staff'],
    ['21','ASHOK RAJBANSHI','Kitchen','Staff'],
    ['22','Yogesh Pathak','Kitchen','Staff'],
    ['23','Boy Gorge','FOH','Staff'],
    ['24','Rabindra Malla','Kitchen','Staff'],
    ['25','Edwin Castro','Kitchen','Staff'],
    ['26','Rommel Santocildes','FOH','Staff'],
    ['27','VALENTINO HOLZINGER','Manager','Manager'],
    ['28','Isaac Hugo','FOH','Staff'],
    ['29','Ashok Rai','Kitchen','Staff'],
    ['30','Prem Bahadur','Kitchen','Staff'],
    ['31','Ansari Sarfaraj','Kitchen','Staff'],
    ['32','JHESS MINAS','FOH','Staff'],
    ['33','MARK ORIBELLO','FOH','Staff'],
    ['34','ATHEER MOHAMMED ALJOHANI','Manager','Manager'],
    ['35','Razan Hassan','FOH','Staff'],
    ['36','SHUKAT MANSUR','Kitchen','Staff'],
    ['37','MARIANE HIPE','FOH','Staff'],
    ['38','SUMAN MAJAKUTY','Kitchen','Staff'],
    ['39','Khaled Al Halafi','Manager','Admin'],
    ['40','Nawal Al Ghamdi','FOH','Staff'],
    ['41','ABDULRHMAN ALZHRANI','Kitchen','Staff'],
    ['42','JAWAD KHAN','Kitchen','Staff']
  ];
  return d.map(function(r) {
    return { id:r[0], name:r[1], dept:r[2], access:r[3],
             role:'', shift:'', status:'Active', phone:'', sap:'' };
  });
}

// Seed staff to Firebase if branch has no staff yet
function seedIfEmpty() {
  if (!db || !NX.session || !NX.session.branchId) return;
  db.ref(bPath('staff')).once('value', function(snap) {
    if (!snap.val()) {
      var obj = {};
      defStaff().forEach(function(m) { obj[m.id] = m; });
      db.ref(bPath('staff')).set(obj);
      console.log('Staff seeded from defStaff for branch:', NX.session.branchId);
    }
  });
}


// ── SAP-first attendance resolution helper ──────────────────────────
function hrResolveAttId(m, att, tsEmps) {
  var mSap = String(m.sap || '').trim();
  var mName = (m.name || '').toLowerCase().trim();
  var tsArr = Array.isArray(tsEmps) ? tsEmps : Object.values(tsEmps || {});

  // 1. Scan actual att records for matching SAP field (most reliable — set by staff.html)
  if (mSap) {
    var attKeys = Object.keys(att);
    for (var ai = 0; ai < attKeys.length; ai++) {
      var ak = attKeys[ai];
      if (/^\d{4}-\d{2}$/.test(ak)) continue; // skip YYYY-MM keys
      var entry = att[ak];
      if (!entry || typeof entry !== 'object') continue;
      var monthKeys = Object.keys(entry);
      for (var mi2 = 0; mi2 < monthKeys.length; mi2++) {
        var recs = entry[monthKeys[mi2]];
        if (!Array.isArray(recs) || !recs.length) continue;
        for (var ri = 0; ri < recs.length; ri++) {
          if (recs[ri] && String(recs[ri].sap || '').trim() === mSap) return ak;
        }
        break; // only check first month's records for speed
      }
    }
  }

  // 2. SAP match via tsEmps list
  if (mSap) {
    for (var i = 0; i < tsArr.length; i++) {
      var e = tsArr[i];
      if (e && String(e.sap || '').trim() === mSap) return String(e.id || '');
    }
  }

  // 3. Direct ID match in att
  if (att[String(m.id)]) return String(m.id);

  // 4. Name match via tsEmps
  for (var j = 0; j < tsArr.length; j++) {
    var e2 = tsArr[j];
    if (e2 && e2.name && e2.name.toLowerCase().trim() === mName) return String(e2.id || '');
  }

  // 5. Name match in att records
  var attKeys2 = Object.keys(att);
  for (var ai2 = 0; ai2 < attKeys2.length; ai2++) {
    var ak2 = attKeys2[ai2];
    if (/^\d{4}-\d{2}$/.test(ak2)) continue;
    var entry2 = att[ak2];
    if (!entry2 || typeof entry2 !== 'object') continue;
    var mKeys2 = Object.keys(entry2);
    for (var mi3 = 0; mi3 < mKeys2.length; mi3++) {
      var recs2 = entry2[mKeys2[mi3]];
      if (!Array.isArray(recs2) || !recs2.length) continue;
      var r0 = recs2[0];
      if (r0 && r0.empName && r0.empName.toLowerCase().trim() === mName) return ak2;
      break;
    }
  }

  return String(m.id);
}
function bsyncTSFromStaff() {
  BS.staff.forEach(function(m){
    var sid=String(m.id),ex=null;
    for(var i=0;i<BS.tsEmps.length;i++) if(BS.tsEmps[i].id===sid){ex=BS.tsEmps[i];break;}
    if(!ex){BS.tsEmps.push({id:sid,name:m.name,dept:m.dept,pos:m.role||'',phone:m.phone||'',sap:m.sap||'',leaveBalance:21});}
    else{ex.name=m.name;ex.dept=m.dept;if(m.role)ex.pos=m.role;ex.phone=m.phone||'';ex.sap=m.sap||'';;}
  });
  var ids=BS.staff.map(function(m){return String(m.id);});
  BS.tsEmps=BS.tsEmps.filter(function(e){return ids.indexOf(e.id)>=0;});
}
function bmatch(item,ff) { if(!BS.q)return true;var q=BS.q.toLowerCase();for(var i=0;i<ff.length;i++)if(String(item[ff[i]]||'').toLowerCase().indexOf(q)>=0)return true;return false; }

// ── Firebase save helpers ──
function bSaveColl(key,arr) {
  if(!db) return;
  var obj={};arr.forEach(function(item,idx){var k=item.id?String(item.id).replace(/[.#$\[\]\/]/g,'_'):'item_'+idx;obj[k]=item;});
  db.ref(bPath(key)).set(obj);
}
function bSaveItems() {
  if(!db) return;
  var branchPath = NX.session && NX.session.branchId ? 'branches/' + NX.session.branchId : null;
  if(!branchPath) return;
  var catObj={},stockObj={};
  bItems.forEach(function(item){
    var k=String(item.code||'').replace(/[.#$\[\]\/]/g,'_');if(!k)return;
    catObj[k]={code:item.code,name:item.name,unit:item.unit||'EA',location:item.location||'Dry Storage',min:parseFloat(item.min)||0,price:parseFloat(item.price)||0,supplier:item.supplier||''};
    stockObj[k]={qty:parseFloat(item.qty)||0};
  });
  // Save catalog per-branch — each branch is fully independent
  db.ref(branchPath+'/inv_items').set(catObj);
  db.ref(branchPath+'/stock').set(stockObj);
}
function bSaveStock(code,qty) {
  if(!db||!NX.session) return;
  var k=String(code||'').replace(/[.#$\[\]\/]/g,'_');
  var branchPath = 'branches/' + NX.session.branchId;
  db.ref(branchPath+'/stock/'+k).set({qty:parseFloat(qty)||0});
}
function bSaveLogs() {
  if(!db) return;
  var obj={};bLogs.forEach(function(l,i){var k='log_'+(l.date||'x')+'_'+(l.code||'x')+'_'+i;k=k.replace(/[.#$\[\]\/]/g,'_');obj[k]=l;});
  db.ref(bPath('inv_logs')).set(obj);
}
function bSaveOrders() {
  if(!db) return;
  var obj={};bOrders.forEach(function(o){obj[String(o.id).replace(/[.#$\[\]\/]/g,'_')]=o;});
  db.ref(bPath('inv_orders')).set(obj);
}
function bSaveSch() {
  if(!db) return;
  db.ref(bPath('sch')).set(BS.sch);
  // Rebuild sapIndex on every schedule save so Staff Portal always stays in sync
  if (NX.session && NX.session.branchId) {
    var sapIdx = {};
    BS.staff.forEach(function(m) {
      var sap = String(m.sap || '').trim();
      if (sap) sapIdx[sap] = { staffId: String(m.id), name: m.name, dept: m.dept || '' };
    });
    if (Object.keys(sapIdx).length) {
      db.ref('branches/' + NX.session.branchId + '/sapIndex').set(sapIdx);
    }
  }
}
function bSaveTsAtt() { if(db) db.ref(bPath('tsAtt')).set(BS.tsAtt); }

// ── Attach Firebase listeners when entering branch pages ──
function attachBranchListeners() {
  if (!db) {
    // db not ready yet — retry in 600ms
    setTimeout(attachBranchListeners, 600);
    return;
  }
  if (_bListenersAttached) return;
  _bListenersAttached = true;
  BS.tsViewDate = BS.tsViewDate || TODAY_BS;

  var collections = ['staff','sales','waste','rem','pc','health','invoices','tsEmps','tsLeaves'];
  collections.forEach(function(key){
    db.ref(bPath(key)).on('value', function(snap){
      var raw=snap.val();
      var arr;
      if(raw===null) arr=[];
      else if(Array.isArray(raw)) arr=raw.filter(Boolean);
      else arr=Object.values(raw).filter(Boolean);
      // Normalize dept names so HR data always matches Branch Manager schedule
      if(key==='staff'||key==='tsEmps'){
        arr.forEach(function(m){ if(m&&m.dept) m.dept=normalizeDept(m.dept); });
      }
      BS[key]=arr;
      bsyncTSFromStaff();
      // Auto-save tsEmps to Firebase so portals always stay in sync
      if(key==='staff'&&db&&NX.session&&NX.session.branchId){
        var _tsObj={};BS.tsEmps.forEach(function(e,i){var k=String(e.id||i).replace(/[.#$\[\]\/]/g,'_');_tsObj[k]=e;});
        db.ref('branches/'+NX.session.branchId+'/tsEmps').set(_tsObj);
      }
      NX.lastSync=Date.now();
      if(['branch-dash','staff','timesheet','health-cards','sales','petty-cash','wastage','schedule'].indexOf(NX.page)>=0) {
        var area=document.getElementById('page-area'); if(area){area.innerHTML=renderPage_(NX.page);setTimeout(function(){initPageCharts(NX.page);},50);}
      }
    });
  });

  db.ref(bPath('sch')).on('value', function(snap){ BS.sch=snap.val()||{}; });
  db.ref(bPath('tsAtt')).on('value', function(snap){ BS.tsAtt=snap.val()||{}; });

  // Staff Portal Check-In Notifications -> branch manager bell
  db.ref(bPath('notifications')).on('child_added', function(snap) {
    var n = snap.val(); if (!n) return;
    var labels = { 'in':'Checked In', 'out':'Checked Out', 'break-start':'Break Started', 'break-end':'Break Ended', 'training_published':'Module Published' };
    var colors = { 'in':'success', 'out':'warning', 'break-start':'info', 'break-end':'info', 'training_published':'info' };
    var icons  = { 'in':'\u2705', 'out':'\ud83d\udeaa', 'break-start':'\u2615', 'break-end':'\u25b6', 'training_published':'\ud83d\udcda' };
    var notif = {
      id: snap.key, dedupId: 'ci_' + snap.key,
      type:  colors[n.type]  || 'info',
      icon:  icons[n.type]   || '\ud83d\udccd',
      title: (n.staffName || 'Staff') + ' -- ' + (labels[n.type] || n.type),
      body:  (n.time || '') + (n.location ? ' | ' + n.location : ''),
      ts: n.ts || Date.now(), read: false, page: 'timesheet'
    };
    var todayStart = new Date(); todayStart.setHours(0,0,0,0);
    if ((n.ts || 0) >= todayStart.getTime() && typeof push === 'function') push(notif);
    if (!n.read) snap.ref.update({ read: true });
  });
  db.ref(bPath('config')).on('value', function(snap){ BS._branchConfig=snap.val()||{}; });
  db.ref(bPath('pcBudget')).once('value', function(snap){ BS.pcBudget=snap.val()||0; });
  db.ref('admin/branchPermissions/'+NX.session.branchId).once('value', function(snap){ BS._branchPerms=snap.val()||{}; });
  db.ref(bPath('pcCostCenters')).on('value', function(snap){ var v=snap.val(); if(v&&v.length)BS.pcCostCenters=v; });
  db.ref(bPath('pcGLs')).on('value', function(snap){ var v=snap.val(); if(v&&v.length)BS.pcGLs=v; });
  db.ref(bPath('pcCycleNo')).on('value', function(snap){ var v=snap.val(); if(v!==null&&v!==undefined)BS.pcCycleNo=v; });
  db.ref(bPath('pcArchive')).on('value', function(snap){ BS.pcArchive=snap.val()||[]; });
  // Load new BM data (transfers + announcements) once on attach, then update badges
  if(NX.session&&(NX.session.role==='branch_mgr'||NX.session.role==='staff')){
    bmLoadTransfers(null);
    bmLoadAnnouncements(null);
  }

  // Locations — same as index.html: stored at branches/{id}/locations
  db.ref(bPath('locations')).on('value', function(snap){
    var v=snap.val();
    BS.locations=(v&&Array.isArray(v))?v:DEFAULT_LOCATIONS.slice();
  });
  // Suppliers — stored at branches/{id}/suppliers
  db.ref(bPath('suppliers')).on('value', function(snap){
    var v=snap.val();
    BS.suppliers=(v&&Array.isArray(v))?v:DEFAULT_SUPPLIERS.slice();
  });

  // Inventory: shared catalog + branch stock
  // _cat and _stock attached to BS so they survive across re-renders and are visible for debugging
  if(!BS._cat)BS._cat={};
  if(!BS._stock)BS._stock={};
  function _merge() {
    var merged=[];
    var skipped=0;
    Object.keys(BS._cat).forEach(function(k){
      var c=BS._cat[k];
      if(!c||typeof c!=='object'){skipped++;return;}
      // Tolerate varying field names: name | itemName | description | label
      var name=c.name||c.itemName||c.description||c.label||'';
      // If still no name, fall back to using the key itself so the item is at least visible
      if(!name)name=k;
      var s=BS._stock[k]||{};
      merged.push({
        code:c.code||k,
        name:name,
        unit:c.unit||c.uom||'EA',
        location:c.location||c.loc||c.storageLocation||'Dry Storage',
        min:parseFloat(c.min||c.minQty||c.minimum||0)||0,
        price:parseFloat(c.price||c.unitPrice||c.cost||0)||0,
        supplier:c.supplier||c.vendor||'',
        qty:parseFloat((typeof s==='object'?s.qty:s)||0)||0
      });
    });
    bItems=merged;
    BS._invDebug={catKeys:Object.keys(BS._cat).length,stockKeys:Object.keys(BS._stock).length,merged:merged.length,skipped:skipped};
    console.log('[NEXUS inv] cat='+Object.keys(BS._cat).length+' stock='+Object.keys(BS._stock).length+' merged='+merged.length+' skipped='+skipped);
    if(NX.page==='inv-items'||NX.page==='branch-dash'||NX.page==='low-stock'||NX.page==='inv-report'||NX.page==='inv-orders') {
      var area=document.getElementById('page-area');if(area){area.innerHTML=renderPage_(NX.page);setTimeout(function(){initPageCharts(NX.page);},50);}
    }
  }
  // Per-branch inventory catalog — each branch manages its own items independently
  var _invCatPath = 'branches/' + NX.session.branchId + '/inv_items';
  db.ref(_invCatPath).on('value', function(snap){
    var v=snap.val()||{};
    // Tolerate array-shaped catalogs (some legacy writes save arrays not objects)
    if(Array.isArray(v)){
      var obj={};
      v.forEach(function(it,i){if(!it)return;var k=String(it.code||i).replace(/[.#$\[\]\/]/g,'_');obj[k]=it;});
      BS._cat=obj;
    } else {
      BS._cat=v;
    }
    _merge();
  });
  var branchPath = 'branches/' + NX.session.branchId;
  db.ref(branchPath+'/stock').on('value', function(snap){ BS._stock=snap.val()||{}; _merge(); });

  db.ref(bPath('inv_logs')).on('value', function(snap){
    var raw=snap.val();
    if(!raw) bLogs=[];
    else if(Array.isArray(raw)) bLogs=raw.filter(Boolean);
    else bLogs=Object.values(raw).filter(Boolean).sort(function(a,b){return (a.date||'').localeCompare(b.date||'');});
  });
  db.ref(bPath('inv_orders')).on('value', function(snap){
    var raw=snap.val();
    if(!raw) bOrders=[];
    else if(Array.isArray(raw)) bOrders=raw.filter(Boolean).sort(function(a,b){return (b.date||'').localeCompare(a.date||'');});
    else bOrders=Object.values(raw).filter(Boolean).sort(function(a,b){return (b.date||'').localeCompare(a.date||'');});
  });

  showToast('Branch data syncing live', 'success');
}

// Helper to re-render current page without destroying charts (used by listeners)
function renderPage_(pageId) {
  try {
    var fns = {
      'branch-dash':pBranchDash,'inv-items':pInvItems,'inv-moves':pInvMoves,'inv-orders':pInvOrders,
      'low-stock':pLowStock,'inv-report':pInvReport,'wastage':pWastage,'staff':pStaff,
      'schedule':pSchedule,'timesheet':pTimesheet,'health-cards':pHealthCards,
      'sales':pSales,'petty-cash':pPettyCash,'dsr':pDSR,'checklists':pChecklists,'qr-checkin':pQRCheckin
    };
    return fns[pageId] ? fns[pageId]() : '';
  } catch(e) { return '<div class="empty-state"><div class="es-icon">&#x26A0;&#xFE0F;</div><p>' + bxe(e.message) + '</p></div>'; }
}

// ── CSS for branch pages (OpsHub style, scoped) ──
(function injectBranchCSS(){
  if(document.getElementById('branch-css')) return;
  var s=document.createElement('style');s.id='branch-css';
  s.textContent = [
    '.bav{width:32px;height:32px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;flex-shrink:0;background:var(--surface-3);color:var(--text-primary)}',
    '.bsc{background:var(--surface-1);border:1px solid var(--border);border-radius:10px;padding:16px}',
    '.bsc-lbl{font-size:10px;color:var(--text-tertiary);text-transform:uppercase;letter-spacing:.1em;margin-bottom:6px}',
    '.bsc-val{font-family:"JetBrains Mono",monospace;font-size:28px;font-weight:300;color:var(--text-primary)}',
    '.bsc-sub{font-size:11px;color:var(--text-secondary);margin-top:4px}',
    '.btw{border:1px solid var(--border);border-radius:10px;overflow:hidden;background:var(--surface-1)}',
    '.btw-s{overflow-x:auto}',
    '.btbl{width:100%;border-collapse:collapse;font-size:13px}',
    '.btbl th{padding:9px 12px;font-size:10px;text-transform:uppercase;letter-spacing:.08em;color:var(--text-tertiary);border-bottom:1px solid var(--border);text-align:left;background:var(--surface-2)}',
    '.btbl td{padding:11px 12px;border-bottom:1px solid var(--border);color:var(--text-secondary);vertical-align:middle}',
    '.btbl tbody tr:hover td{background:var(--surface-2)}',
    '.btbl tbody tr:last-child td{border-bottom:none}',
    '.bfi{background:var(--surface-2);border:1px solid var(--border);border-radius:8px;padding:9px 12px;color:var(--text-primary);font-family:"DM Sans",sans-serif;font-size:13px;outline:none;width:100%;transition:border .2s}',
    '.bfi:focus{border-color:var(--border-strong)}',
    '.bfg{margin-bottom:14px}',
    '.bfg label{display:block;font-size:11px;color:var(--text-secondary);margin-bottom:5px}',
    '.bttb{padding:12px 14px;display:flex;align-items:center;gap:10px;flex-wrap:wrap;border-bottom:1px solid var(--border);background:var(--surface-2)}',
    '.bfbt{padding:5px 12px;border-radius:20px;border:1px solid var(--border);background:none;color:var(--text-secondary);font-size:12px;cursor:pointer;transition:all .15s}',
    '.bfbt.on,.bfbt:hover{background:var(--text-primary);color:#fff;border-color:var(--text-primary)}',
    '.bwnav{display:flex;align-items:center;gap:8px;margin-bottom:14px;flex-wrap:wrap}',
    '.bswrap{overflow-x:auto;border:1px solid var(--border);border-radius:10px}',
    '.bstbl{width:100%;border-collapse:collapse;font-size:12px;min-width:700px}',
    '.bstbl th{padding:9px 10px;font-size:10px;text-transform:uppercase;letter-spacing:.08em;color:var(--text-tertiary);border-bottom:1px solid var(--border);background:var(--surface-2)}',
    '.bstbl td{padding:8px 10px;border-bottom:1px solid var(--border);vertical-align:middle}',
    '.bstbl .bdr td{background:var(--surface-2);font-size:10px;text-transform:uppercase;letter-spacing:.1em;color:var(--text-tertiary);font-weight:600;padding:6px 12px}',
    '.bsinp{width:100%;background:var(--surface-2);border:1px solid var(--border);border-radius:5px;padding:4px 7px;color:var(--text-primary);font-size:11px;font-family:"DM Sans",sans-serif;outline:none;text-align:center}',
    '.bstb{display:flex;gap:4px;margin-bottom:16px;border-bottom:1px solid var(--border)}',
    '.bstb button{padding:8px 16px;border:none;border-bottom:2px solid transparent;background:none;color:var(--text-secondary);font-size:13px;cursor:pointer;margin-bottom:-1px;transition:all .15s}',
    '.bstb button.on{color:var(--text-primary);border-bottom-color:var(--text-primary)}',
    '.bts-st-btn{padding:5px 10px;border-radius:6px;font-size:11px;font-weight:600;cursor:pointer;font-family:"DM Sans",sans-serif;transition:all .15s}',
    '.bcg{color:#00875a}.bcr{color:#c0392b}.bca{color:#0057ff}.bcgold{color:#b45309}',
    '.bmono{font-family:"JetBrains Mono",monospace}',
    '.bgrid-2{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:14px}',
    '.bgrid-3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-bottom:14px}',
    '.bgrid-4{display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:10px;margin-bottom:14px}',
    '.bcard{background:var(--surface-1);border:1px solid var(--border);border-radius:10px;padding:18px}'
  ].join('\n');
  document.head.appendChild(s);
})();

// ══════════════════════════════════════════════════════
// BRANCH DASHBOARD
// ══════════════════════════════════════════════════════
function pBranchDash() {
  attachBranchListeners();
  var s = NX.session || {};
  var isStaff = s.role === 'staff';
  var branchName = s.branchName || s.entityName || 'Branch';
  var b = NX_BRANCHES[s.branchId] || {};
  var today = TODAY_BS;
  var now2 = new Date();
  var cy = now2.getFullYear(), ly = cy - 1;

  function fsar(v) { return formatSAR(v||0); }
  function mthKeyD(off) { var d=new Date(now2.getFullYear(),now2.getMonth()+off,1); return d.getFullYear()+'-'+(d.getMonth()<9?'0':'')+(d.getMonth()+1); }
  function dsLocal(d) { return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); }
  function chgArrow(v) {
    if (v===null||v===undefined) return '';
    var up=parseFloat(v)>=0;
    return '<span style="color:'+(up?'#00875a':'#c0392b')+'">'+(up?'\u25b2':'\u25bc')+' '+Math.abs(v)+'%</span>';
  }
  function pbar(val,tot,col) {
    var w=tot>0?Math.min(100,val/tot*100):0;
    return '<div style="height:5px;background:var(--surface-3);border-radius:99px;overflow:hidden;margin-top:6px">'+
      '<div style="height:100%;width:'+w.toFixed(1)+'%;background:'+col+';border-radius:99px"></div></div>'+
      '<div style="font-size:9px;color:var(--text-tertiary);font-family:var(--mono);margin-top:3px">'+fsar(val)+' / '+fsar(tot)+'</div>';
  }

  // ── STAFF ROLE VIEW ──────────────────────────────────────────────────────
  if (isStaff) {
    var h = '<div class="page-header"><h1>' + (b.icon||'\ud83c\udfea') + ' ' + xe(branchName) + '</h1>';
    h += '<p>' + xe(b.brand||'') + (b.location?' \xb7 '+xe(b.location):'') + ' \xb7 ' + fmtDate(now2) + '</p></div>';
    // Hero quick actions — 4 cards
    h += '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:12px;margin-bottom:18px">';
    var _bId = s.branchId || '';
    var heroes = [
      {icon:'\ud83d\udcf1', label:'Check-In', sub:'Clock in / out', accent:'#00875a', href:'staff.html'},
      {icon:'\u2705', label:'Checklists', sub:'Today\'s tasks',  accent:'#0057ff', href:'checklists.html'},
      {icon:'\ud83d\udcb0', label:'Server Drop', sub:'Submit drops',  accent:'#b45309', href:'server-drop.html'},
      {icon:'\ud83d\udcdd', label:'Leave Request', sub:'Submit / view', accent:'#5b21b6', href:'leave.html'}
    ];
    heroes.forEach(function(c){
      var _href = _bId ? c.href + '?branch=' + encodeURIComponent(_bId) : c.href;
      h += '<a href="'+_href+'" target="_blank" style="text-decoration:none;color:inherit"><div class="card" style="text-align:center;padding:20px 14px;cursor:pointer;border:1px solid var(--border);transition:all .15s;border-top:3px solid '+c.accent+'">';
      h += '<div style="font-size:36px;margin-bottom:10px">'+c.icon+'</div>';
      h += '<div style="font-size:14px;font-weight:700;margin-bottom:4px">'+c.label+'</div>';
      h += '<div style="font-size:11px;color:var(--text-secondary)">'+c.sub+'</div>';
      h += '</div></a>';
    });
    h += '</div>';
    // Quick info row — branch info
    h += '<div class="card" style="padding:14px 18px;display:flex;gap:18px;flex-wrap:wrap;align-items:center;background:var(--surface-1)">';
    h += '<div style="display:flex;flex-direction:column;gap:2px"><span style="font-size:9px;text-transform:uppercase;letter-spacing:.08em;color:var(--text-tertiary)">Branch</span><span style="font-size:13px;font-weight:600">'+xe(branchName)+'</span></div>';
    h += '<div style="display:flex;flex-direction:column;gap:2px"><span style="font-size:9px;text-transform:uppercase;letter-spacing:.08em;color:var(--text-tertiary)">Brand</span><span style="font-size:13px;font-weight:600">'+xe(b.brand||'\u2014')+'</span></div>';
    h += '<div style="display:flex;flex-direction:column;gap:2px"><span style="font-size:9px;text-transform:uppercase;letter-spacing:.08em;color:var(--text-tertiary)">Location</span><span style="font-size:13px;font-weight:600">'+xe(b.location||'\u2014')+'</span></div>';
    h += '<div style="display:flex;flex-direction:column;gap:2px"><span style="font-size:9px;text-transform:uppercase;letter-spacing:.08em;color:var(--text-tertiary)">Today</span><span style="font-size:13px;font-weight:600">'+fmtDate(now2)+'</span></div>';
    h += '</div>';
    return h;
  }

  // ── BRANCH MANAGER VIEW ────────────────────────────────────────────────────
  var tm = mthKeyD(0), lm = mthKeyD(-1);
  var _dow = now2.getDay();
  var tws = new Date(now2); tws.setDate(now2.getDate()-_dow); tws.setHours(0,0,0,0);
  var lws = new Date(tws); lws.setDate(tws.getDate()-7);
  var lwe = new Date(tws); lwe.setDate(tws.getDate()-1);
  var todayStr=dsLocal(now2), twsStr=dsLocal(tws), lwsStr=dsLocal(lws), lweStr=dsLocal(lwe);
  var lwDayStr=dsLocal(new Date(now2.getTime()-7*86400000));
  var tA=0,tT=0,lmA=0,thisWk=0,lastWk=0,todaySales=0,lwSameDay=0,ytdA=0,ytdLY=0,ytdT=0,wkT=0;
  BS.sales.forEach(function(e){
    if(!e.date)return;
    var a=+e.actual||0,t=+e.target||0;
    if(e.date.indexOf(tm)===0){tA+=a;tT+=t;}
    if(e.date.indexOf(lm)===0) lmA+=a;
    if(e.date>=twsStr&&e.date<=todayStr){thisWk+=a;wkT+=t;}
    if(e.date>=lwsStr&&e.date<=lweStr) lastWk+=a;
    if(e.date===todayStr) todaySales+=a;
    if(e.date===lwDayStr) lwSameDay+=a;
    if(e.date.slice(0,4)===String(cy)){ytdA+=a;ytdT+=t;}
    if(e.date.slice(0,4)===String(ly)) ytdLY+=a;
  });
  function pct(a,_b){if(!_b)return null;return(((a-_b)/_b)*100).toFixed(1);}
  var tdChg=pct(todaySales,lwSameDay), mChg=pct(tA,lmA), wChg=pct(thisWk,lastWk), ytdChg=pct(ytdA,ytdLY);

  var act2=0,onL2=0,onLeaveList=[];
  BS.staff.forEach(function(m){ if(m.status==='Active')act2++; else if(m.status==='On Leave'){onL2++;onLeaveList.push(m);} });
  var deptCount={Management:0,Kitchen:0,FOH:0};
  BS.staff.forEach(function(m){var nd=normalizeDept(m.dept||'');if(deptCount[nd]!==undefined)deptCount[nd]++;});
  var hExp=0,hSoon=0,hNear=0,hOk=0,hExpList=[];
  BS.health.forEach(function(hc){
    if(!hc.medExp)return;
    var d=Math.ceil((new Date(hc.medExp+'T00:00:00')-now2)/86400000);
    if(d<0){hExp++;hExpList.push(hc);}else if(d<=30){hSoon++;}else if(d<=60){hNear++;}else hOk++;
  });
  function remBadge(d){
    if(d===null||d===undefined)return '<span style="color:var(--text-tertiary);font-size:10px">\u2014</span>';
    if(d<0)return '<span style="background:rgba(192,57,43,.15);color:#c0392b;border-radius:4px;padding:2px 7px;font-size:10px;font-weight:700">Expired</span>';
    if(d<=30)return '<span style="background:rgba(245,158,11,.12);color:#b45309;border-radius:4px;padding:2px 7px;font-size:10px;font-weight:700">'+d+'d left</span>';
    if(d<=60)return '<span style="background:rgba(251,191,36,.10);color:#fbbf24;border-radius:4px;padding:2px 7px;font-size:10px;font-weight:700">'+d+'d left</span>';
    return '<span style="background:rgba(5,150,105,.12);color:#059669;border-radius:4px;padding:2px 7px;font-size:10px;font-weight:700">'+d+'d left</span>';
  }
  var wv=0; BS.waste.forEach(function(w){if(w.date===todayStr)wv+=(+w.value||0);});
  var fcTarget=parseFloat((BS._branchConfig||{}).fcTarget)||30;
  var wasteM=0;
  BS.waste.forEach(function(w){if(w.date&&w.date.indexOf(tm)===0)wasteM+=(+w.value||0);});
  // Issues cost = qty × price from movement logs
  var issueCostM=bLogs.reduce(function(s,l){
    if(l.type!=='issue')return s;
    if(!(l.date||'').startsWith(tm))return s;
    if(l.cost)return s+l.cost;
    var it=bfindItem(l.code);
    return s+(l.qty*(it?parseFloat(it.price||0):0));
  },0);
  var totalFCM=issueCostM+wasteM;
  var fcPct=tA>0?(totalFCM/tA*100):0;
  var fcOk=fcPct>0&&fcPct<=fcTarget,fcHigh=fcPct>fcTarget&&fcPct<=fcTarget*1.1;
  var fcColor=fcPct===0?'var(--text-tertiary)':fcOk?'#00875a':fcHigh?'#b45309':'#c0392b';
  var low=bItems.filter(function(i){return i.min>0&&i.qty<=i.min;}).length;
  var invValue=bItems.reduce(function(acc,i){return acc+(i.qty*(parseFloat(i.price)||0));},0);
  var pendOrders=bOrders.filter(function(o){return o.status==='pending'||o.status==='partial';}).length;

  var monthlyBars='';
  var monthVals=[];
  for(var mi2=11;mi2>=0;mi2--){var mpfx=mthKeyD(-mi2);monthVals.push(BS.sales.reduce(function(acc2,e){return e.date&&e.date.indexOf(mpfx)===0?acc2+(+e.actual||0):acc2;},0));}
  var mxM=Math.max.apply(null,monthVals)||1;
  for(var mi3=0;mi3<12;mi3++){
    var mv=monthVals[mi3];
    var isCurrentMonth=(mi3===11);
    var bh2=mv>0?Math.max(4,Math.round(mv/mxM*56)):4;
    var bc2=isCurrentMonth?'#4a5568':'#b45309';
    var mLabel=mthKeyD(-(11-mi3));
    monthlyBars+='<div title="'+mLabel+': '+formatSAR(mv)+'" style="flex:1;height:'+bh2+'px;background:'+bc2+';border-radius:2px 2px 0 0;opacity:'+(isCurrentMonth?1:.65)+';cursor:default;transition:height .3s"></div>';
  }

  var h = '<div class="page-header"><h1>'+(b.icon||'\ud83c\udfea')+' '+xe(branchName)+' Dashboard</h1>';
  h += '<p>'+xe(b.brand||'')+(b.location?' \xb7 '+xe(b.location):'')+' \xb7 '+fmtDate(now2)+'</p></div>';

  // ROW 1: Today vs LW | Month vs LM | Week vs LW | YTD — sales-dashboard sizing
  h += '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin-bottom:14px">';
  h += '<div class="card" style="padding:18px"><div class="kpi-label">Today vs Last Week</div>';
  h += '<div class="kpi-value mono" style="color:'+(tdChg===null?'var(--ceo)':tdChg>=0?'#00875a':'#c0392b')+';white-space:nowrap;overflow:hidden;text-overflow:ellipsis">'+fsar(todaySales)+'</div>';
  h += '<div style="font-size:12px;color:var(--text-secondary);margin-top:8px">'+chgArrow(tdChg)+' vs '+fsar(lwSameDay)+'</div></div>';
  h += '<div class="card" style="padding:18px"><div class="kpi-label">This Month vs Last</div>';
  h += '<div class="kpi-value mono" style="color:'+(mChg===null?'var(--ceo)':mChg>=0?'#00875a':'#c0392b')+';white-space:nowrap;overflow:hidden;text-overflow:ellipsis">'+fsar(tA)+'</div>';
  h += '<div style="font-size:12px;color:var(--text-secondary);margin-top:8px">'+chgArrow(mChg)+' vs '+fsar(lmA)+'</div></div>';
  h += '<div class="card" style="padding:18px"><div class="kpi-label">This Week vs Last</div>';
  h += '<div class="kpi-value mono" style="color:'+(wChg===null?'var(--ceo)':wChg>=0?'#00875a':'#c0392b')+';white-space:nowrap;overflow:hidden;text-overflow:ellipsis">'+fsar(thisWk)+'</div>';
  h += '<div style="font-size:12px;color:var(--text-secondary);margin-top:8px">'+chgArrow(wChg)+' vs '+fsar(lastWk)+'</div></div>';
  h += '<div class="card" style="padding:18px"><div class="kpi-label">YTD '+cy+'</div>';
  h += '<div class="kpi-value mono" style="color:'+(ytdChg===null?'var(--ceo)':ytdChg>=0?'#00875a':'#c0392b')+';white-space:nowrap;overflow:hidden;text-overflow:ellipsis">'+fsar(ytdA)+'</div>';
  h += '<div style="font-size:12px;color:var(--text-secondary);margin-top:8px">'+chgArrow(ytdChg)+' vs '+ly+' YTD</div></div>';
  h += '</div>';

  // ROW 2: Active Staff | Low Stock | Wastage Today | Stock Value — sales-dashboard sizing
  h += '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin-bottom:14px">';
  h += '<div class="card" style="padding:18px"><div class="kpi-label">Active Staff</div>';
  h += '<div class="kpi-value mono" style="color:#00875a">'+act2+'</div>';
  h += '<div style="font-size:12px;color:var(--text-secondary);margin-top:8px">of '+BS.staff.length+' \xb7 '+onL2+' on leave</div></div>';
  h += '<div class="card" style="padding:18px;'+(low>0?'border-color:rgba(248,113,113,.3)':'')+'"><div class="kpi-label">Low Stock Items</div>';
  h += '<div class="kpi-value mono" style="color:#c0392b">'+low+'</div>';
  h += '<div style="font-size:12px;color:var(--text-secondary);margin-top:8px">'+pendOrders+' orders open</div></div>';
  h += '<div class="card" style="padding:18px"><div class="kpi-label">Wastage Today</div>';
  h += '<div class="kpi-value mono" style="color:var(--text-primary)">'+fsar(wv)+'</div>';
  h += '<div style="font-size:12px;color:var(--text-secondary);margin-top:8px">'+BS.waste.filter(function(w){return w.date===todayStr;}).length+' entries</div></div>';
  h += '<div class="card" style="padding:18px"><div class="kpi-label">Stock Value</div>';
  h += '<div class="kpi-value mono" style="color:#0057ff">'+fsar(invValue)+'</div>';
  h += '<div style="font-size:12px;color:var(--text-secondary);margin-top:8px">'+bItems.length+' items</div></div>';
  h += '</div>';

  // FOOD COST PANEL
  // ── Tables / Seats + Branch Info (same as index.html dashboard) ──────────
  var _bc2=BS._branchConfig||{};
  var _bcolor2=b.color||'#f0a500';
  var act2str=act2+' active';
  h += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px">';
  // Left: Tables & Seats
  h += '<div class="card" style="padding:16px;cursor:pointer;border-color:'+_bcolor2+'33" onclick="openBranchConfigModal()" title="Click to edit tables & seats">';
  h += '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">';
  h += '<div style="display:flex;align-items:center;gap:8px">';
  h += '<div style="width:10px;height:10px;border-radius:50%;background:'+_bcolor2+';box-shadow:0 0 8px '+_bcolor2+'"></div>';
  h += '<span style="font-size:13px;font-weight:700">'+xe(b.icon||'\ud83c\udfea')+' '+xe(branchName)+'</span>';
  if(b.brand)h += '<span style="font-size:10px;background:var(--surface-2);border:1px solid var(--border);border-radius:20px;padding:1px 8px;color:var(--text-tertiary)">'+xe(b.brand)+'</span>';
  h += '</div><span style="font-size:10px;color:var(--text-tertiary);opacity:.7">✏️ edit</span></div>';
  h += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">';
  h += '<div style="background:var(--surface-2);border:1px solid var(--border);border-radius:10px;padding:16px;text-align:center">';
  h += '<div style="font-size:9px;color:var(--text-tertiary);text-transform:uppercase;letter-spacing:1.5px;margin-bottom:8px;font-family:var(--mono)">Tables</div>';
  h += '<div style="font-size:28px;font-weight:300;color:var(--ceo);font-family:var(--mono)">'+(_bc2.tables||b.tables||'—')+'</div></div>';
  h += '<div style="background:var(--surface-2);border:1px solid var(--border);border-radius:10px;padding:16px;text-align:center">';
  h += '<div style="font-size:9px;color:var(--text-tertiary);text-transform:uppercase;letter-spacing:1.5px;margin-bottom:8px;font-family:var(--mono)">Seats</div>';
  h += '<div style="font-size:28px;font-weight:300;color:#0057ff;font-family:var(--mono)">'+(_bc2.seats||b.seats||'—')+'</div></div>';
  h += '</div></div>';
  // Right: Branch Info
  h += '<div class="card" style="padding:16px">';
  h += '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">';
  h += '<span style="font-size:12px;font-weight:700;color:var(--text-secondary)">Branch Info</span>';
  h += '<button class="btn btn-sm" onclick="openBranchConfigModal()">✏️ Edit</button></div>';
  h += '<div style="display:flex;flex-direction:column;gap:9px">';
  h += '<div style="display:flex;justify-content:space-between;align-items:center;font-size:11px"><span style="color:var(--text-tertiary)">Brand</span><span style="font-weight:700;color:var(--text-primary)">'+xe(b.brand||'—')+'</span></div>';
  h += '<div style="display:flex;justify-content:space-between;align-items:center;font-size:11px"><span style="color:var(--text-tertiary)">Location</span><span style="color:var(--text-secondary);text-align:right;max-width:200px">'+xe(b.location||'—')+'</span></div>';
  h += '<div style="display:flex;justify-content:space-between;align-items:center;font-size:11px"><span style="color:var(--text-tertiary)">Manager</span><span style="font-weight:600;color:var(--text-secondary)">'+xe(b.manager||'—')+'</span></div>';
  h += '<div style="display:flex;justify-content:space-between;align-items:center;font-size:11px"><span style="color:var(--text-tertiary)">Active Staff</span><span style="font-weight:700;color:#b45309">'+act2+'</span></div>';
  if(_bc2.area)h += '<div style="display:flex;justify-content:space-between;align-items:center;font-size:11px"><span style="color:var(--text-tertiary)">Dining Area</span><span style="color:var(--text-secondary)">'+xe(_bc2.area)+'</span></div>';
  h += '</div></div>';
  h += '</div>';

  // ── FOOD COST WIDGET ─────────────────────────────────────────────────────
  var fcBarW = Math.min(100,fcPct).toFixed(1);
  var fcTargetPos = Math.min(99,fcTarget).toFixed(1);
  var fcStatusLbl = fcPct===0?'No Data':fcOk?'On Track':fcHigh?'Caution':'Over Target';
  var MONTHS_FC=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  var fcTrend3=[];
  for(var fmi=-2;fmi<=0;fmi++){
    var fd2=new Date(now2.getFullYear(),now2.getMonth()+fmi,1);
    var fmkey=fd2.getFullYear()+'-'+(fd2.getMonth()<9?'0':'')+(fd2.getMonth()+1);
    var fmLbl=MONTHS_FC[fd2.getMonth()];
    var fmIssue=bLogs.reduce(function(acc,l){if(l.type!=='issue'||(l.date||'').indexOf(fmkey)!==0)return acc;var it=bfindItem(l.code);return acc+(l.cost||l.qty*(it?parseFloat(it.price||0):0));},0);
    var fmWaste=BS.waste.reduce(function(acc,w){return(w.date||'').indexOf(fmkey)===0?acc+(+w.value||0):acc;},0);
    var fmSales=branchSalesMTD(s.branchId||'',fmkey);
    var fmPct=fmSales>0?((fmIssue+fmWaste)/fmSales*100):0;
    var fmCol=fmPct===0?'var(--text-tertiary)':fmPct<=fcTarget?'#00875a':fmPct<=fcTarget*1.1?'#b45309':'#c0392b';
    fcTrend3.push({lbl:fmLbl,pct:fmPct,col:fmCol,key:fmkey});
  }
  var maxTrendPct=Math.max.apply(null,fcTrend3.map(function(x){return Math.max(x.pct,fcTarget);}));

  // Outer card
  h += '<div class="card" style="padding:0;overflow:hidden;margin-bottom:10px">';

  // ── Card header ──────────────────────────────────────────────────────────
  h += '<div style="display:flex;align-items:center;justify-content:space-between;padding:12px 16px;border-bottom:1px solid rgba(0,0,0,0.05);box-shadow:0 1px 0 rgba(255,255,255,0.8)">';
  h += '<div style="display:flex;align-items:center;gap:8px">';
  h += '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" style="color:var(--text-tertiary)"><path d="M3 4h18M3 8h18M5 12h14M7 16h10M9 20h6"/></svg>';
  h += '<span style="font-size:12px;font-weight:700;color:var(--text-primary);letter-spacing:-0.02em">Food Cost</span>';
  h += '<span style="font-size:9px;font-weight:600;color:var(--text-tertiary);font-family:var(--mono);background:var(--surface-2);border-radius:20px;padding:2px 8px">'+tm+'</span>';
  h += '</div>';
  h += '<button onclick="openFCTargetModal()" style="display:inline-flex;align-items:center;gap:4px;background:transparent;border:none;border-radius:20px;padding:4px 10px;font-size:10px;font-weight:600;color:var(--text-tertiary);cursor:pointer;font-family:var(--font);transition:all .15s">⚙ Target: '+fcTarget+'%</button>';
  h += '</div>';

  // ── 3-column body ─────────────────────────────────────────────────────────
  h += '<div style="display:grid;grid-template-columns:auto 1fr auto;gap:0">';

  // COL 1 — % gauge + status
  h += '<div style="padding:16px 14px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;border-right:1px solid rgba(0,0,0,0.05);min-width:90px">';
  // Gauge circle
  h += '<div style="position:relative;width:56px;height:56px">';
  var _r=24,_c=2*Math.PI*_r;
  var _f=fcPct>0?Math.min(100,fcPct)/100*_c:0;
  h += '<svg width="56" height="56" viewBox="0 0 56 56">';
  h += '<circle cx="28" cy="28" r="'+_r+'" fill="none" stroke="rgba(0,0,0,0.07)" stroke-width="5"/>';
  if(fcPct>0)h += '<circle cx="28" cy="28" r="'+_r+'" fill="none" stroke="'+fcColor+'" stroke-width="5" stroke-dasharray="'+_f.toFixed(1)+' '+_c.toFixed(1)+'" stroke-dashoffset="'+(_c/4).toFixed(1)+'" stroke-linecap="round"/>';
  h += '<text x="28" y="33" text-anchor="middle" fill="'+fcColor+'" font-size="11" font-weight="700" font-family="var(--mono)">'+fcPct.toFixed(1)+'%</text>';
  h += '</svg>';
  h += '</div>';
  // Status pill
  h += '<div style="background:'+fcColor+'15;border-radius:20px;padding:3px 10px;display:flex;align-items:center;gap:4px">';
  h += '<div style="width:5px;height:5px;border-radius:50%;background:'+fcColor+'"></div>';
  h += '<span style="font-size:9px;font-weight:700;color:'+fcColor+';font-family:var(--font)">'+fcStatusLbl+'</span>';
  h += '</div>';
  h += '</div>';

  // COL 2 — 3 metric rows + progress bar
  h += '<div style="padding:12px 16px;display:flex;flex-direction:column;gap:0">';

  // Row 1
  h += '<div style="padding:8px 0;border-bottom:1px solid rgba(0,0,0,0.04)">';
  h += '<div style="font-size:8px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:var(--text-tertiary);margin-bottom:3px;font-family:var(--mono)">FOOD INVOICES</div>';
  h += '<div style="display:flex;align-items:baseline;gap:6px">';
  h += '<span style="font-size:16px;font-weight:700;font-family:var(--mono);color:var(--text-primary);letter-spacing:-0.03em">'+fsar(issueCostM)+'</span>';
  h += '<span style="font-size:10px;color:var(--text-tertiary);font-family:var(--mono)">'+(tA>0?(issueCostM/tA*100).toFixed(1)+'% of sales':'—')+'</span>';
  h += '</div></div>';

  // Row 2
  h += '<div style="padding:8px 0;border-bottom:1px solid rgba(0,0,0,0.04)">';
  h += '<div style="font-size:8px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:var(--text-tertiary);margin-bottom:3px;font-family:var(--mono)">WASTAGE</div>';
  h += '<div style="display:flex;align-items:baseline;gap:6px">';
  h += '<span style="font-size:16px;font-weight:700;font-family:var(--mono);color:#c0392b;letter-spacing:-0.03em">'+fsar(wasteM)+'</span>';
  h += '<span style="font-size:10px;color:var(--text-tertiary);font-family:var(--mono)">'+(tA>0?(wasteM/tA*100).toFixed(1)+'% of sales':'—')+'</span>';
  h += '</div></div>';

  // Row 3 — total + bar
  h += '<div style="padding:8px 0">';
  h += '<div style="font-size:8px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:var(--text-tertiary);margin-bottom:3px;font-family:var(--mono)">TOTAL VS SALES</div>';
  h += '<div style="display:flex;align-items:baseline;gap:6px;margin-bottom:8px">';
  h += '<span style="font-size:16px;font-weight:700;font-family:var(--mono);color:'+fcColor+';letter-spacing:-0.03em">'+fsar(totalFCM)+'</span>';
  h += '<span style="font-size:10px;color:var(--text-tertiary);font-family:var(--mono)">/ '+fsar(tA)+'</span>';
  h += '</div>';
  // Progress bar — inset
  h += '<div style="position:relative;height:7px;background:var(--surface-2);border-radius:99px;box-shadow:inset 1px 1px 4px rgba(0,0,0,0.09),inset -1px -1px 3px rgba(255,255,255,0.7)">';
  h += '<div style="height:100%;width:'+fcBarW+'%;background:'+fcColor+';border-radius:99px;transition:width .6s"></div>';
  h += '<div style="position:absolute;top:-3px;left:'+fcTargetPos+'%;transform:translateX(-50%);width:1.5px;height:13px;background:#b45309;border-radius:2px"></div>';
  h += '</div>';
  h += '<div style="display:flex;justify-content:space-between;margin-top:4px;font-size:8px;color:var(--text-tertiary);font-family:var(--mono)">';
  h += '<span>0%</span><span style="color:#b45309;font-weight:700">▲ '+fcTarget+'%</span><span>100%</span>';
  h += '</div>';
  h += '</div>';
  h += '</div>'; // end col 2

  // COL 3 — 3-month trend
  h += '<div style="padding:12px 14px;border-left:1px solid rgba(0,0,0,0.05);min-width:130px">';
  h += '<div style="font-size:8px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:var(--text-tertiary);margin-bottom:10px;font-family:var(--mono)">3-MONTH TREND</div>';
  fcTrend3.forEach(function(row){
    var bwt=row.pct>0?Math.min(100,row.pct/Math.max(maxTrendPct,1)*100).toFixed(0):0;
    var isCur=(row.key===tm);
    h += '<div style="display:flex;align-items:center;gap:6px;margin-bottom:8px">';
    h += '<span style="font-size:9px;font-weight:'+(isCur?'700':'400')+';color:'+(isCur?'var(--text-primary)':'var(--text-tertiary)')+';font-family:var(--mono);width:24px;flex-shrink:0">'+row.lbl+'</span>';
    h += '<div style="flex:1;height:6px;background:var(--surface-2);border-radius:99px;overflow:hidden;box-shadow:inset 1px 1px 3px rgba(0,0,0,0.08)">';
    h += '<div style="height:100%;width:'+bwt+'%;background:'+row.col+';border-radius:99px"></div>';
    h += '</div>';
    h += '<span style="font-size:9px;font-weight:700;color:'+row.col+';font-family:var(--mono);width:32px;text-align:right;flex-shrink:0">'+(row.pct>0?row.pct.toFixed(1)+'%':'—')+'</span>';
    h += '</div>';
  });
  h += '<div style="display:flex;align-items:center;gap:5px;margin-top:6px">';
  h += '<div style="width:14px;height:1.5px;background:#b45309;border-radius:1px"></div>';
  h += '<span style="font-size:8px;color:#b45309;font-family:var(--mono)">Target '+fcTarget+'%</span>';
  h += '</div>';
  h += '</div>'; // end col 3

  h += '</div>'; // end 3-col body
  h += '</div>'; // end food cost card


  // ROW 3: Health Cards | On Leave | By Department
  h += '<div style="display:grid;grid-template-columns:2fr 1fr 1fr;gap:10px;margin-bottom:10px">';
  var hRows=hExpList.concat(BS.health.filter(function(hc){
    if(!hc.medExp)return false;
    var d=Math.ceil((new Date(hc.medExp+'T00:00:00')-now2)/86400000);return d>=0&&d<=60;
  })).reduce(function(arr,hc){if(arr.findIndex(function(x){return x.id===hc.id;})>=0)return arr;arr.push(hc);return arr;},[]).slice(0,8).map(function(hc){
    var d=Math.ceil((new Date(hc.medExp+'T00:00:00')-now2)/86400000);
    return '<tr><td style="padding:7px 10px;font-weight:600;font-size:12px">'+xe(hc.name)+'</td>'+
      '<td style="padding:7px 10px;font-size:11px;color:var(--text-tertiary);font-family:var(--mono)">'+xe(hc.cardNo||'\u2014')+'</td>'+
      '<td style="padding:7px 10px;font-size:11px;font-family:var(--mono)">'+xe(hc.medExp||'\u2014')+'</td>'+
      '<td style="padding:7px 10px">'+remBadge(d)+'</td></tr>';
  }).join('');
  h += '<div class="card" style="padding:0;overflow:hidden">';
  h += '<div style="padding:12px 14px;display:flex;align-items:center;gap:8px;border-bottom:1px solid var(--border)">';
  h += '<span style="font-size:13px;font-weight:700">Health Cards</span>';
  if(hExp>0) h+='<span style="background:rgba(192,57,43,.15);color:#c0392b;border:1px solid rgba(192,57,43,.3);border-radius:20px;padding:2px 8px;font-size:10px;font-weight:700">'+hExp+' Expired</span>';
  if(hSoon>0) h+='<span style="background:rgba(240,165,0,.15);color:#b45309;border:1px solid rgba(240,165,0,.25);border-radius:20px;padding:2px 8px;font-size:10px;font-weight:700">'+hSoon+' &lt;30d</span>';
  if(hNear>0) h+='<span style="background:rgba(251,191,36,.12);color:#fbbf24;border:1px solid rgba(251,191,36,.25);border-radius:20px;padding:2px 8px;font-size:10px;font-weight:700">'+hNear+' &lt;60d</span>';
  if(hOk>0) h+='<span style="background:rgba(5,150,105,.12);color:#059669;border:1px solid rgba(5,150,105,.3);border-radius:20px;padding:2px 8px;font-size:10px;font-weight:700">'+hOk+' Valid</span>';
  h += '<button class="btn btn-sm" style="margin-left:auto" onclick="navTo(\'health-cards\')">All \u2192</button></div>';
  if(hRows){
    h+='<table style="width:100%;border-collapse:collapse"><thead><tr style="background:var(--surface-2)">';
    h+='<th style="padding:6px 10px;font-size:9px;text-transform:uppercase;color:var(--text-tertiary);text-align:left">Name</th>';
    h+='<th style="padding:6px 10px;font-size:9px;text-transform:uppercase;color:var(--text-tertiary);text-align:left">Card #</th>';
    h+='<th style="padding:6px 10px;font-size:9px;text-transform:uppercase;color:var(--text-tertiary);text-align:left">Expiry</th>';
    h+='<th style="padding:6px 10px;font-size:9px;text-transform:uppercase;color:var(--text-tertiary);text-align:left">Status</th>';
    h+='</tr></thead><tbody style="border-top:1px solid var(--border)">'+hRows+'</tbody></table>';
  } else {
    h+='<div style="padding:20px;text-align:center;color:var(--text-tertiary);font-size:11px;font-style:italic">All health cards valid \u2705</div>';
  }
  h+='</div>';
  h += '<div class="card" style="padding:0;overflow:hidden">';
  h += '<div style="padding:12px 14px;border-bottom:1px solid var(--border)"><span style="font-size:13px;font-weight:700">On Leave</span></div>';
  if(onLeaveList.length){
    onLeaveList.slice(0,5).forEach(function(m){
      var dc2=m.dept==='Manager'?'#b45309':m.dept==='Kitchen'?'#0057ff':'#00875a';
      h+='<div style="display:flex;align-items:center;gap:8px;padding:8px 14px;border-bottom:1px solid var(--border)">';
      h+='<div style="width:30px;height:30px;border-radius:50%;background:'+dc2+'22;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;color:'+dc2+'">'+xe(m.name).slice(0,2).toUpperCase()+'</div>';
      h+='<div><div style="font-size:12px;font-weight:600">'+xe(m.name)+'</div>';
      h+='<div style="font-size:10px;color:'+dc2+';font-family:var(--mono)">'+xe(m.dept||'')+'</div></div></div>';
    });
  } else {
    h+='<div style="padding:20px;text-align:center;color:var(--text-tertiary);font-size:11px;font-style:italic">No staff on leave</div>';
  }
  h+='</div>';
  h += '<div class="card" style="padding:0;overflow:hidden">';
  h += '<div style="padding:12px 14px;border-bottom:1px solid var(--border)"><span style="font-size:13px;font-weight:700">By Department</span></div>';
  h += '<div style="padding:10px 14px">';
  [['Management','#b45309'],['Kitchen','#0057ff'],['FOH','#00875a']].forEach(function(pair){
    h+='<div style="display:flex;align-items:center;gap:10px;padding:9px 0;border-bottom:1px solid var(--border)">';
    h+='<div style="width:8px;height:8px;border-radius:50%;background:'+pair[1]+';flex-shrink:0"></div>';
    h+='<span style="font-size:13px;font-weight:500;flex:1">'+pair[0]+'</span>';
    h+='<span class="mono" style="font-size:16px;font-weight:600">'+( deptCount[pair[0]]||0)+'</span></div>';
  });
  h+='</div></div>';
  h+='</div>';

  // ROW 4: Sales Progress + YTD
  h += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px">';
  h += '<div class="card"><div style="font-size:11px;font-weight:700;margin-bottom:8px">Monthly Progress '+tm+'</div>';
  h += pbar(tA,tT,'linear-gradient(90deg,#92400e,#065f46)');
  h += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:12px">';
  h += '<div style="background:var(--surface-2);border-radius:7px;padding:10px"><div style="font-size:9px;color:var(--text-tertiary);text-transform:uppercase;margin-bottom:4px">This Week</div>';
  h += '<div class="mono" style="font-size:16px;font-weight:700;color:var(--ceo)">'+fsar(thisWk)+'</div>';
  h += '<div style="font-size:9px;color:var(--text-tertiary)">Target: '+fsar(wkT)+'</div></div>';
  h += '<div style="background:var(--surface-2);border-radius:7px;padding:10px"><div style="font-size:9px;color:var(--text-tertiary);text-transform:uppercase;margin-bottom:4px">Last Week</div>';
  h += '<div class="mono" style="font-size:16px;font-weight:700;color:var(--text-secondary)">'+fsar(lastWk)+'</div></div>';
  h += '</div></div>';
  // Build YTD comparison: this year vs last year, by month
  var ytdThisYr=[],ytdLastYr=[];
  var nowD=new Date(); nowD.setHours(nowD.getHours()+3);
  var thisYr=nowD.getFullYear(),lastYr=thisYr-1;
  var thisMonthIdx=nowD.getMonth();
  for(var ymi=0;ymi<12;ymi++){
    var mPad=(ymi+1<10?'0':'')+(ymi+1);
    var thisKey=thisYr+'-'+mPad;
    var lastKey=lastYr+'-'+mPad;
    var thisV=BS.sales.reduce(function(a,e){return e.date&&e.date.indexOf(thisKey)===0?a+(+e.actual||0):a;},0);
    var lastV=BS.sales.reduce(function(a,e){return e.date&&e.date.indexOf(lastKey)===0?a+(+e.actual||0):a;},0);
    ytdThisYr.push(thisV);
    ytdLastYr.push(lastV);
  }
  var maxYtdM=Math.max.apply(null,ytdThisYr.concat(ytdLastYr))||1;
  var ytdLastTotal=ytdLastYr.slice(0,thisMonthIdx+1).reduce(function(a,b){return a+b;},0);
  var ytdThisTotal=ytdThisYr.slice(0,thisMonthIdx+1).reduce(function(a,b){return a+b;},0);
  var ytdYoY=ytdLastTotal>0?((ytdThisTotal-ytdLastTotal)/ytdLastTotal)*100:0;
  var yoyCol=ytdYoY>=0?'#00875a':'#c0392b';
  var yoyArrow=ytdYoY>=0?'\u25B2':'\u25BC';

  var monthsShort=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  var ytdBars='';
  for(var ymj=0;ymj<12;ymj++){
    var isFuture=ymj>thisMonthIdx;
    var thisV2=ytdThisYr[ymj]||0, lastV2=ytdLastYr[ymj]||0;
    var hT=thisV2>0?Math.max(4,Math.round(thisV2/maxYtdM*60)):0;
    var hL=lastV2>0?Math.max(4,Math.round(lastV2/maxYtdM*60)):0;
    ytdBars+='<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:4px;min-width:0">'+
      '<div style="display:flex;align-items:flex-end;gap:2px;height:60px;width:100%;justify-content:center">'+
        '<div title="'+monthsShort[ymj]+' '+thisYr+': '+formatSAR(thisV2)+'" style="width:10px;height:'+(hT||0)+'px;background:#4a5568;border-radius:2px 2px 0 0;opacity:'+(isFuture?0:1)+'"></div>'+
        '<div title="'+monthsShort[ymj]+' '+lastYr+': '+formatSAR(lastV2)+'" style="width:10px;height:'+(hL||0)+'px;background:#b45309;border-radius:2px 2px 0 0;opacity:'+(isFuture?0.35:0.85)+'"></div>'+
      '</div>'+
      '<div style="font-size:9px;color:var(--text-secondary)">'+monthsShort[ymj]+'</div>'+
      '</div>';
  }
  h += '<div class="card"><div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px"><span style="font-size:11px;font-weight:700">YTD '+thisYr+' vs '+lastYr+'</span>';
  h += '<span style="font-size:11px;color:'+yoyCol+';font-weight:700;font-family:var(--mono)">'+yoyArrow+' '+(Math.abs(ytdYoY)).toFixed(1)+'%</span></div>';
  h += '<div style="display:flex;gap:14px;font-size:10px;color:var(--text-secondary);margin-bottom:8px">';
  h += '<div style="display:flex;align-items:center;gap:6px"><span style="display:inline-block;width:10px;height:10px;background:#4a5568;border-radius:2px"></span>'+thisYr+': <strong style="color:var(--text-primary)">'+fsar(ytdThisTotal)+'</strong></div>';
  h += '<div style="display:flex;align-items:center;gap:6px"><span style="display:inline-block;width:10px;height:10px;background:#b45309;border-radius:2px"></span>'+lastYr+': <strong style="color:#b45309">'+fsar(ytdLastTotal)+'</strong></div>';
  h += '</div>';
  h += '<div style="display:flex;align-items:flex-end;gap:2px;height:80px;margin-top:8px">'+ytdBars+'</div></div>';
  h += '</div>';

  // ROW 5: Recent Orders | Activity | Reminders
  var stColors={pending:'rgba(245,158,11,.15);color:#b45309',partial:'rgba(96,165,250,.15);color:#0057ff',done:'rgba(52,211,153,.15);color:#b45309',cancelled:'rgba(100,100,100,.15);color:#94a3b8'};
  var stLabels={pending:'Pending',partial:'Partial',done:'Done',cancelled:'Cancelled'};
  var ordH=bOrders.slice(-5).reverse().map(function(o){
    var sty=stColors[o.status]||stColors.pending;
    return '<div style="padding:8px 0;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:8px">'+
      '<div style="flex:1;min-width:0"><div class="mono" style="font-size:10px;color:var(--ceo);font-weight:700">'+xe(o.id)+'</div>'+
      '<div style="font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+xe(o.supplier||'No supplier')+'</div></div>'+
      '<span style="font-size:10px;border-radius:4px;padding:2px 7px;background:'+sty+';font-weight:700">'+(stLabels[o.status]||o.status)+'</span></div>';
  }).join('')||'<div style="color:var(--text-tertiary);font-size:11px;font-style:italic;padding:8px 0">No orders yet</div>';
  var logH=(bLogs||[]).slice().reverse().slice(0,5).map(function(l){
    var isR=l.type==='receive',isTI=l.type==='transfer-in',isTO=l.type==='transfer-out';
    var bgc=isTO||isTI?'rgba(192,132,252,.15);color:#c084fc':isR?'rgba(52,211,153,.15);color:#b45309':'rgba(248,113,113,.15);color:#c0392b';
    var lbl=isTO?'Tr\u2192':isTI?'\u2190Tr':isR?'In':'Out';
    return '<div style="padding:8px 0;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:8px">'+
      '<span style="font-size:10px;border-radius:4px;padding:2px 7px;font-weight:700;background:'+bgc+';flex-shrink:0">'+lbl+'</span>'+
      '<div style="flex:1;min-width:0"><div style="font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+xe(l.name)+'</div>'+
      '<div class="mono" style="font-size:9px;color:var(--text-tertiary)">'+xe(l.code)+' \xb7 '+xe(l.date)+'</div></div>'+
      '<span class="mono" style="font-weight:700;color:'+(isR||isTI?'#00875a':'#c0392b')+'">'+(isR||isTI?'+':'-')+l.qty+'</span></div>';
  }).join('')||'<div style="color:var(--text-tertiary);font-size:11px;font-style:italic;padding:8px 0">No movements yet</div>';
  var pendRem=(BS.rem||[]).filter(function(r){return !r.done;});
  var remR=pendRem.length?pendRem.slice(0,4).map(function(r){
    var pc=r.priority==='high'?'#c0392b':r.priority==='medium'?'#b45309':'#00875a';
    return '<div style="display:flex;gap:8px;padding:8px 0;border-bottom:1px solid var(--border);align-items:center">'+
      '<div style="width:3px;background:'+pc+';border-radius:2px;align-self:stretch;flex-shrink:0"></div>'+
      '<div style="flex:1;min-width:0;cursor:pointer" data-rid="'+xe(r.id||'')+'" onclick="openReminderModal(this.dataset.rid)"><div style="font-size:12px;font-weight:600;overflow:hidden;text-overflow:ellipsis">'+xe(r.text)+'</div>'+
      '<div class="mono" style="font-size:10px;color:var(--text-tertiary)">'+xe(r.date||'')+'</div></div>'+
      '<button class="btn btn-sm" style="padding:2px 6px;font-size:10px" data-rid="'+xe(r.id||'')+'" onclick="toggleReminder(this.dataset.rid)" title="Mark done">\u2713</button>'+
      '<button class="btn btn-sm" style="padding:2px 6px;font-size:10px;color:var(--danger)" data-rid="'+xe(r.id||'')+'" onclick="delReminder(this.dataset.rid)" title="Delete">\u2715</button>'+
      '</div>';
  }).join(''):'<div style="color:var(--text-tertiary);font-size:11px;font-style:italic;padding:8px 0">No pending reminders</div>';
  h += '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-bottom:16px">';
  h += '<div class="card" style="padding:0;overflow:hidden"><div style="padding:12px 14px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid var(--border)"><span style="font-size:13px;font-weight:700">Recent Orders</span><button class="btn btn-sm" onclick="navTo(\'inv-orders\')">All \u2192</button></div><div style="padding:2px 14px">'+ordH+'</div></div>';
  h += '<div class="card" style="padding:0;overflow:hidden"><div style="padding:12px 14px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid var(--border)"><span style="font-size:13px;font-weight:700">Recent Activity</span><button class="btn btn-sm" onclick="navTo(\'inv-moves\')">All \u2192</button></div><div style="padding:2px 14px">'+logH+'</div></div>';
  h += '<div class="card" style="padding:0;overflow:hidden"><div style="padding:12px 14px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid var(--border)"><span style="font-size:13px;font-weight:700">Reminders</span><button class="btn btn-sm" onclick="openReminderModal()">+ Add</button></div><div style="padding:2px 14px">'+remR+'</div></div>';
  h += '</div>';

  // Quick Actions
  h += '<div class="section"><h3 style="font-size:12px;font-weight:700;color:var(--text-secondary);text-transform:uppercase;letter-spacing:.08em;margin-bottom:12px">Quick Actions</h3>';
  h += '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(110px,1fr));gap:10px">';
  [['inv-orders','\ud83d\uded2','Purchase Orders'],['inv-moves','\ud83d\udce6','Receive Stock'],['staff','\ud83d\udc65','Staff'],['sales','\ud83d\udcb0','Sales'],['timesheet','\u23f1\ufe0f','Timesheet'],['wastage','\ud83d\uddd1\ufe0f','Wastage'],['health-cards','\ud83d\udcb3','Health Cards'],['petty-cash','\ud83e\uddfe','Petty Cash'],['bm-music-player','\ud83c\udfb5','Music Player']].forEach(function(a){
    h += '<div class="card" style="text-align:center;padding:14px 10px;cursor:pointer" onclick="navTo(\''+a[0]+'\')">';
    h += '<div style="font-size:24px;margin-bottom:6px">'+a[1]+'</div>';
    h += '<div style="font-size:11px;font-weight:600">'+a[2]+'</div></div>';
  });
  h += '</div></div>';

  // Staff Portals
  var _bid=encodeURIComponent(s.branchId||'');
  var _portals=[
    ['staff.html','📱','Check-In','staff.html'],
    ['leave.html','📝','Leave Request','leave.html'],
    ['checklists.html','✅','Checklists','checklists.html'],
    ['server-drop.html','💰','Server Drop','server-drop.html']
  ];
  h += '<div class="card section"><h3 style="font-size:12px;font-weight:700;color:var(--text-secondary);text-transform:uppercase;letter-spacing:.08em;margin-bottom:12px">Staff Portals (Standalone)</h3>';
  h += '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px">';
  _portals.forEach(function(p){
    var url=p[0]+(s.branchId?'?branch='+_bid:'');
    h += '<a href="'+url+'" target="_blank" style="text-decoration:none">';
    h += '<div class="card" style="text-align:center;padding:16px 10px;cursor:pointer;transition:all .15s" onmouseover="this.style.borderColor=\'var(--accent)\'" onmouseout="this.style.borderColor=\'\'">';
    h += '<div style="font-size:28px;margin-bottom:8px">'+p[1]+'</div>';
    h += '<div style="font-size:12px;font-weight:700;color:var(--text-primary);margin-bottom:3px">'+p[2]+'</div>';
    h += '<div style="font-size:9px;color:var(--text-tertiary)">'+p[3]+'</div></div></a>';
  });
  h += '</div></div>';

  // ── NEW: Pending alerts row ──
  (function(){
    var pt=(BS._bmTransfers||[]).filter(function(t){return t.status==='pending';});
    var pl=(BS.tsLeaves||[]).filter(function(l){return l.status==='pending';});
    var ua=(BS._bmAnns||[]).filter(function(a){return !(BS._bmAcks||{})[a.id];});
    if(!pt.length&&!pl.length&&!ua.length) return;
    h+='<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:10px;margin-bottom:16px">';
    if(pt.length) h+='<div class="card" style="border-color:rgba(91,33,182,.4);cursor:pointer;padding:14px" onclick="navTo(&quot;bm-transfers&quot;)"><div style="display:flex;align-items:center;gap:10px"><div style="font-size:26px">&#x1F500;</div><div><div style="font-size:13px;font-weight:700;color:#5b21b6">'+pt.length+' Transfer Request'+(pt.length>1?'s':'')+'</div><div style="font-size:11px;color:var(--text-secondary)">Awaiting approval</div></div></div></div>';
    if(pl.length) h+='<div class="card" style="border-color:rgba(245,158,11,.4);cursor:pointer;padding:14px" onclick="navTo(&quot;bm-leave&quot;)"><div style="display:flex;align-items:center;gap:10px"><div style="font-size:26px">&#x1F3D6;&#xFE0F;</div><div><div style="font-size:13px;font-weight:700;color:#b45309">'+pl.length+' Leave Request'+(pl.length>1?'s':'')+'</div><div style="font-size:11px;color:var(--text-secondary)">Pending your decision</div></div></div></div>';
    if(ua.length) h+='<div class="card" style="border-color:rgba(248,113,113,.4);cursor:pointer;padding:14px" onclick="navTo(&quot;bm-announcements&quot;)"><div style="display:flex;align-items:center;gap:10px"><div style="font-size:26px">&#x1F4E2;</div><div><div style="font-size:13px;font-weight:700;color:#c0392b">'+ua.length+' Announcement'+(ua.length>1?'s':'')+'</div><div style="font-size:11px;color:var(--text-secondary)">From HR — needs acknowledgement</div></div></div></div>';
    h+='</div>';
  })();

  return h;
}

// ── Inventory Items ──────────────────────────────────
function pInvItems() {
  attachBranchListeners();
  var q=(BS.q||'').toLowerCase(),loc=BS.inv_loc||'',sts=BS.inv_sts||'';
  var filtered=bItems.filter(function(i){if(q&&String(i.code).toLowerCase().indexOf(q)<0&&i.name.toLowerCase().indexOf(q)<0)return false;if(loc&&i.location!==loc)return false;if(sts==='ok'&&i.min>0&&i.qty<=i.min)return false;if(sts==='low'&&!(i.min>0&&i.qty<=i.min))return false;return true;});
  var rows=filtered.map(function(it){var isLow=it.min>0&&it.qty<=it.min;return '<tr><td class="bmono" style="color:var(--ceo);font-size:10px">'+bxe(it.code)+'</td><td style="font-weight:600;color:var(--text-primary)">'+bxe(it.name)+'</td><td><span class="chip">'+bxe(it.location||'\u2014')+'</span></td><td class="bmono" style="font-weight:700;font-size:14px;color:'+(isLow?'var(--danger)':'var(--text-primary)')+'">'+it.qty+'</td><td class="bmono">'+bxe(it.unit)+'</td><td class="bmono" style="color:var(--text-secondary)">'+it.min+'</td><td class="bmono" style="color:var(--text-secondary)">'+parseFloat(it.price||0).toFixed(2)+'</td><td>'+bpl(isLow?'Low':'OK',isLow?'#c0392b':'#00875a')+'</td><td><div style="display:flex;gap:4px"><button class="btn btn-sm" onclick="openBranchItemModal(\''+bxe(it.code)+'\')">Edit</button><button class="btn btn-sm" style="color:var(--danger)" onclick="delBranchItem(\''+bxe(it.code)+'\')">Del</button></div></td></tr>';}).join('');
  var h='<div class="page-header"><h1>Inventory Items</h1><p>'+filtered.length+' of '+bItems.length+' items</p></div>';
  h+='<div class="bttb" style="border-radius:10px 10px 0 0;border:1px solid var(--border)"><input class="bfi" style="width:200px" id="binv-q" placeholder="Search items\u2026" value="'+bxe(BS.q||'')+'"><select class="bfi" style="width:auto" id="binv-loc"><option value="">All Locations</option>';
  getLocations().slice().sort().forEach(function(l){h+='<option value="'+bxe(l)+'"'+(loc===l?' selected':'')+'>'+bxe(l)+'</option>';});
  h+='</select><select class="bfi" style="width:auto" id="binv-sts"><option value="">All Status</option><option value="ok"'+(sts==='ok'?' selected':'')+'>OK</option><option value="low"'+(sts==='low'?' selected':'')+'>Low</option></select>';
  h+='<div style="margin-left:auto;display:flex;gap:8px"><button class="btn btn-sm" onclick="diagInventory()">\uD83D\uDD0D Debug</button><button class="btn btn-sm btn-primary" onclick="openInvImportModal()">\u2b06 Import CSV</button><button class="btn btn-sm btn-primary" onclick="openBranchItemModal(null)">+ Add Item</button><button class="btn btn-sm" onclick="exportBranchItemsCSV()">\u2b07 CSV</button></div></div>';
  h+='<div class="btw"><div class="btw-s"><table class="btbl"><thead><tr><th>Code</th><th>Name</th><th>Location</th><th>Qty</th><th>Unit</th><th>Min</th><th>Price</th><th>Status</th><th></th></tr></thead><tbody>'+(rows||'<tr><td colspan="9" style="text-align:center;color:var(--text-tertiary);padding:24px">No items found</td></tr>')+'</tbody></table></div></div>';
  setTimeout(function(){
    var q2=document.getElementById('binv-q');
    var l2=document.getElementById('binv-loc');
    var s2=document.getElementById('binv-sts');
    function applyInvFilter(){
      var q=(BS.q||'').toLowerCase(),loc=BS.inv_loc||'',sts=BS.inv_sts||'';
      var filtered=bItems.filter(function(i){
        if(q&&String(i.code).toLowerCase().indexOf(q)<0&&i.name.toLowerCase().indexOf(q)<0)return false;
        if(loc&&i.location!==loc)return false;
        if(sts==='ok'&&i.min>0&&i.qty<=i.min)return false;
        if(sts==='low'&&!(i.min>0&&i.qty<=i.min))return false;
        return true;
      });
      var rows=filtered.map(function(it){var isLow=it.min>0&&it.qty<=it.min;return '<tr><td class="bmono" style="color:var(--ceo);font-size:10px">'+bxe(it.code)+'</td><td style="font-weight:600;color:var(--text-primary)">'+bxe(it.name)+'</td><td><span class="chip">'+bxe(it.location||'\u2014')+'</span></td><td class="bmono" style="font-weight:700;font-size:14px;color:'+(isLow?'var(--danger)':'var(--text-primary)')+'">'+it.qty+'</td><td class="bmono">'+bxe(it.unit)+'</td><td class="bmono" style="color:var(--text-secondary)">'+it.min+'</td><td class="bmono" style="color:var(--text-secondary)">'+parseFloat(it.price||0).toFixed(2)+'</td><td>'+bpl(isLow?'Low':'OK',isLow?'#c0392b':'#00875a')+'</td><td><div style="display:flex;gap:4px"><button class="btn btn-sm" onclick="openBranchItemModal(\''+bxe(it.code)+'\')">Edit</button><button class="btn btn-sm" style="color:var(--danger)" onclick="delBranchItem(\''+bxe(it.code)+'\')">Del</button></div></td></tr>';}).join('');
      var tbody=document.querySelector('.btbl tbody');
      if(tbody)tbody.innerHTML=rows||'<tr><td colspan="9" style="text-align:center;color:var(--text-tertiary);padding:24px">No items found</td></tr>';
      var hdr=document.querySelector('.page-header p');
      if(hdr)hdr.textContent=filtered.length+' of '+bItems.length+' items';
    }
    if(q2){q2.oninput=function(){BS.q=this.value;applyInvFilter();};}
    if(l2){l2.onchange=function(){BS.inv_loc=this.value;applyInvFilter();};}
    if(s2){s2.onchange=function(){BS.inv_sts=this.value;applyInvFilter();};}
  },0);
  return h;
}
function openBranchItemModal(code){
  var it=code?bfindItem(code):null;
  var locs=getLocations().slice().sort();
  var sups=getSuppliers().slice().sort();
  var locOpts=locs.map(function(l){return '<option'+(it&&it.location===l?' selected':'')+'>'+bxe(l)+'</option>';}).join('');
  var supOpts='<option value="">None</option>'+sups.map(function(s2){return '<option'+(it&&it.supplier===s2?' selected':'')+'>'+bxe(s2)+'</option>';}).join('');
  var html='<div class="modal-head"><h2>'+(it?'Edit Item':'Add Item')+'</h2><button class="modal-close" onclick="closeModalForce()">&#x2715;</button></div>';
  html+='<div class="bfg"><label class="form-label">Code *</label><input class="form-input" id="bi-code" value="'+bxe(it?it.code:'')+'" '+(it?'readonly':'')+'></div>';
  html+='<div class="bfg"><label class="form-label">Name *</label><input class="form-input" id="bi-name" value="'+bxe(it?it.name:'')+'"></div>';
  html+='<div class="form-row"><div class="bfg"><label class="form-label">Unit</label><input class="form-input" id="bi-unit" value="'+bxe(it?it.unit:'EA')+'"></div><div class="bfg"><label class="form-label">Min Stock</label><input class="form-input" type="number" id="bi-min" value="'+(it?it.min:0)+'"></div></div>';
  html+='<div class="form-row"><div class="bfg"><label class="form-label">Price (‫SAR ‬)</label><input class="form-input" type="number" id="bi-price" value="'+(it?it.price:0)+'"></div></div>';
  // Location row with + New and 🗑 buttons
  html+='<div class="bfg"><label class="form-label" style="display:flex;align-items:center;gap:8px">Location <button type="button" class="btn btn-sm" style="padding:2px 8px;font-size:10px" onclick="nxAddLocationModal()">+ New</button><button type="button" class="btn btn-sm" style="padding:2px 8px;font-size:10px;color:var(--danger);border-color:rgba(248,113,113,.3)" onclick="nxDelLocationModal()">🗑 Delete</button></label>';
  html+='<select class="form-input form-select" id="bi-loc">'+locOpts+'</select></div>';
  // Supplier row with + New and 🗑 buttons
  html+='<div class="bfg"><label class="form-label" style="display:flex;align-items:center;gap:8px">Supplier <button type="button" class="btn btn-sm" style="padding:2px 8px;font-size:10px" onclick="nxAddSupplierModal()">+ New</button><button type="button" class="btn btn-sm" style="padding:2px 8px;font-size:10px;color:var(--danger);border-color:rgba(248,113,113,.3)" onclick="nxDelSupplierModal()">🗑 Delete</button></label>';
  html+='<select class="form-input form-select" id="bi-sup">'+supOpts+'</select></div>';
  if(!it)html+='<div class="bfg"><label class="form-label">Opening Qty</label><input class="form-input" type="number" id="bi-qty" value="0"></div>';
  html+='<button class="btn btn-primary" style="width:100%;margin-top:8px" onclick="saveBranchItem(\''+bxe(code||'')+'\')">Save</button>';
  openModal(html);
}

// ── Location management (Firebase-backed, same as index.html) ──────────────
function openBranchConfigModal(){
  var cfg=BS._branchConfig||{};
  var html='<div class="modal-head"><h2>Branch Configuration</h2><button class="modal-close" onclick="closeModalForce()">&#x2715;</button></div>';
  html+='<div class="form-row"><div class="bfg"><label class="form-label">Number of Tables</label><input class="form-input" type="number" id="bcfg-tables" min="0" value="'+(cfg.tables||0)+'" style="font-size:22px;font-weight:300;text-align:center;font-family:var(--mono)"></div>';
  html+='<div class="bfg"><label class="form-label">Number of Seats</label><input class="form-input" type="number" id="bcfg-seats" min="0" value="'+(cfg.seats||0)+'" style="font-size:22px;font-weight:300;text-align:center;font-family:var(--mono)"></div></div>';
  html+='<div class="bfg"><label class="form-label">Dining Area (optional)</label><input class="form-input" id="bcfg-area" value="'+bxe(cfg.area||'')+'" placeholder="e.g. Piatto Tables 21 Seats 86 — SH Tables 16 Seats 74"></div>';
  html+='<div class="bfg"><label class="form-label">Food Cost Target (%)</label><input class="form-input" type="number" id="bcfg-fc" min="0" max="100" value="'+(cfg.fcTarget||30)+'" placeholder="30"></div>';
  html+='<button class="btn btn-primary" style="width:100%;margin-top:8px" onclick="saveBranchConfig()">Save</button>';
  openModal(html);
}
function saveBranchConfig(){
  var tables=parseInt(bgv('bcfg-tables'))||0;
  var seats=parseInt(bgv('bcfg-seats'))||0;
  var area=bgv('bcfg-area');
  var fcTarget=parseFloat(bgv('bcfg-fc'))||30;
  var cfg=Object.assign({},BS._branchConfig||{},{tables:tables,seats:seats,area:area,fcTarget:fcTarget});
  BS._branchConfig=cfg;
  if(db)db.ref(bPath('config')).set(cfg,function(err){
    if(err)showToast('Save failed: '+err.message,'error');
    else{showToast('Branch config saved \u2713','success');closeModalForce();navTo('branch-dash');}
  });
}

function openFCTargetModal() {
  var fcTarget = parseFloat((BS._branchConfig||{}).fcTarget)||30;
  openModal(
    '<div class="modal-head"><h2>⚙️ Food Cost Target</h2><button class="modal-close" onclick="closeModalForce()">✕</button></div>' +
    '<div style="padding:20px 24px">' +
    '<p style="font-size:13px;color:var(--text-secondary);margin-bottom:16px">Set the monthly food cost % target for this branch. You will see alerts when actual cost exceeds this.</p>' +
    '<div style="display:flex;align-items:center;gap:10px;margin-bottom:20px">' +
    '<input type="number" id="fc-target-input" value="'+fcTarget+'" min="1" max="100" style="flex:1;background:var(--surface-3);border:1px solid var(--border);border-radius:10px;padding:10px 14px;color:var(--text-primary);font-size:22px;font-weight:700;font-family:var(--mono);text-align:center;outline:none">' +
    '<span style="font-size:22px;color:var(--text-secondary);font-weight:700">%</span></div>' +
    '<div style="display:flex;gap:10px">' +
    '<button class="btn btn-primary" style="flex:1" onclick="saveFCTarget()">Save Target</button>' +
    '<button class="btn" onclick="closeModalForce()">Cancel</button>' +
    '</div></div>'
  );
}

function saveFCTarget() {
  var val = parseFloat((document.getElementById('fc-target-input')||{}).value);
  if (isNaN(val) || val <= 0 || val > 100) { showToast('Enter a valid % between 1–100', 'warning'); return; }
  var cfg = Object.assign({}, BS._branchConfig||{}, { fcTarget: val });
  BS._branchConfig = cfg;
  if (db) {
    db.ref(bPath('config')).set(cfg, function(err) {
      if (err) { showToast('Save failed: '+err.message, 'error'); return; }
      showToast('✅ FC Target set to ' + val + '%', 'success');
      navTo('food-cost');
    });
  } else {
    showToast('✅ FC Target set to ' + val + '% (offline)', 'success');
    navTo('food-cost');
  }
}

function nxAddLocationModal(){
  var html='<div class="modal-head"><h2>Add Location</h2><button class="modal-close" onclick="closeModalForce()">&#x2715;</button></div>';
  html+='<div class="bfg"><label class="form-label">Location Name *</label><input class="form-input" id="nx-new-loc" placeholder="e.g. Walk-in Chiller"></div>';
  html+='<button class="btn btn-primary" style="width:100%;margin-top:8px" onclick="nxConfirmAddLocation()">Add Location</button>';
  openModal(html);
  setTimeout(function(){var el=document.getElementById('nx-new-loc');if(el)el.focus();},80);
}
function nxConfirmAddLocation(){
  var name=(bgv('nx-new-loc')||'').trim();
  if(!name){showToast('Enter a location name','warning');return;}
  if(!BS.locations)BS.locations=getLocations().slice();
  if(BS.locations.indexOf(name)>=0){showToast('Location already exists','warning');return;}
  BS.locations.push(name);
  if(db)db.ref(bPath('locations')).set(BS.locations);
  closeModalForce();
  showToast('"'+name+'" added ✓','success');
}
function nxDelLocationModal(){
  var locs=getLocations().slice().sort();
  if(!locs.length){showToast('No locations','warning');return;}
  var opts=locs.map(function(l){return '<option value="'+bxe(l)+'">'+bxe(l)+'</option>';}).join('');
  var html='<div class="modal-head"><h2>Delete Location</h2><button class="modal-close" onclick="closeModalForce()">&#x2715;</button></div>';
  html+='<div class="bfg"><label class="form-label">Select Location to Delete</label><select class="form-input form-select" id="nx-del-loc"><option value="">— Choose —</option>'+opts+'</select></div>';
  html+='<div style="background:rgba(248,113,113,.08);border:1px solid rgba(248,113,113,.2);border-radius:8px;padding:10px;font-size:11px;color:#c0392b;margin-bottom:12px">⚠️ Items in this location will be moved to <strong>Dry Storage</strong>.</div>';
  html+='<button class="btn btn-primary" style="width:100%;background:var(--danger);border-color:var(--danger)" onclick="nxConfirmDelLocation()">Delete</button>';
  openModal(html);
}
function nxConfirmDelLocation(){
  var name=bgv('nx-del-loc');
  if(!name){showToast('Select a location','warning');return;}
  if(!confirm('Delete location "'+name+'"? Items will move to Dry Storage.'))return;
  if(!BS.locations)BS.locations=getLocations().slice();
  var i=BS.locations.indexOf(name);
  if(i<0){showToast('Not found','error');return;}
  BS.locations.splice(i,1);
  if(db)db.ref(bPath('locations')).set(BS.locations);
  // Move items from deleted location to Dry Storage
  var fallback=BS.locations.indexOf('Dry Storage')>=0?'Dry Storage':(BS.locations[0]||'Dry Storage');
  var updates={};
  var bLocPath='branches/'+(NX.session&&NX.session.branchId)+'/inv_items/';
  bItems.forEach(function(it){
    if(it.location===name){
      it.location=fallback;
      updates[bLocPath+String(it.code).replace(/[.#$\[\]\/]/g,'_')+'/location']=fallback;
    }
  });
  if(db&&Object.keys(updates).length)db.ref().update(updates);
  closeModalForce();
  showToast('"'+name+'" deleted — items moved to "'+fallback+'"','success');
}

// ── Supplier management (Firebase-backed, same as index.html) ──────────────
function nxAddSupplierModal(){
  var html='<div class="modal-head"><h2>Add Supplier</h2><button class="modal-close" onclick="closeModalForce()">&#x2715;</button></div>';
  html+='<div class="bfg"><label class="form-label">Supplier Name *</label><input class="form-input" id="nx-new-sup" placeholder="e.g. Al Safi"></div>';
  html+='<button class="btn btn-primary" style="width:100%;margin-top:8px" onclick="nxConfirmAddSupplier()">Add Supplier</button>';
  openModal(html);
  setTimeout(function(){var el=document.getElementById('nx-new-sup');if(el)el.focus();},80);
}
function nxConfirmAddSupplier(){
  var name=(bgv('nx-new-sup')||'').trim();
  if(!name){showToast('Enter a supplier name','warning');return;}
  if(!BS.suppliers)BS.suppliers=getSuppliers().slice();
  if(BS.suppliers.indexOf(name)>=0){showToast('Supplier already exists','warning');return;}
  BS.suppliers.push(name);
  if(db)db.ref(bPath('suppliers')).set(BS.suppliers);
  closeModalForce();
  showToast('"'+name+'" added ✓','success');
}
function nxDelSupplierModal(){
  var sups=getSuppliers().slice().sort();
  if(!sups.length){showToast('No suppliers','warning');return;}
  var opts=sups.map(function(s2){return '<option value="'+bxe(s2)+'">'+bxe(s2)+'</option>';}).join('');
  var html='<div class="modal-head"><h2>Delete Supplier</h2><button class="modal-close" onclick="closeModalForce()">&#x2715;</button></div>';
  html+='<div class="bfg"><label class="form-label">Select Supplier to Delete</label><select class="form-input form-select" id="nx-del-sup"><option value="">— Choose —</option>'+opts+'</select></div>';
  html+='<button class="btn btn-primary" style="width:100%;background:var(--danger);border-color:var(--danger)" onclick="nxConfirmDelSupplier()">Delete</button>';
  openModal(html);
}
function nxConfirmDelSupplier(){
  var name=bgv('nx-del-sup');
  if(!name){showToast('Select a supplier','warning');return;}
  if(!confirm('Delete supplier "'+name+'"?'))return;
  if(!BS.suppliers)BS.suppliers=getSuppliers().slice();
  var i=BS.suppliers.indexOf(name);
  if(i<0){showToast('Not found','error');return;}
  BS.suppliers.splice(i,1);
  if(db)db.ref(bPath('suppliers')).set(BS.suppliers);
  closeModalForce();
  showToast('"'+name+'" deleted','success');
}
function saveBranchItem(origCode){var code=bgv('bi-code'),name=bgv('bi-name');if(!code||!name){showToast('Code and name required','error');return;}var unit=bgv('bi-unit')||'EA',loc=bgv('bi-loc')||'Dry Storage',min=parseFloat(bgv('bi-min'))||0,price=parseFloat(bgv('bi-price'))||0,sup=bgv('bi-sup')||'';var bPath_='branches/'+(NX.session&&NX.session.branchId)+'/inv_items/';if(origCode){var it=bfindItem(origCode);if(!it)return;it.code=code;it.name=name;it.unit=unit;it.location=loc;it.min=min;it.price=price;it.supplier=sup;if(db)db.ref(bPath_+code.replace(/[.#$\[\]\/]/g,'_')).set({code:code,name:name,unit:unit,location:loc,min:min,price:price,supplier:sup});}else{if(bfindItem(code)){showToast('Duplicate code','error');return;}var qty=parseFloat(bgv('bi-qty'))||0;bItems.push({code:code,name:name,unit:unit,location:loc,min:min,price:price,qty:qty,supplier:sup});if(db){db.ref(bPath_+code.replace(/[.#$\[\]\/]/g,'_')).set({code:code,name:name,unit:unit,location:loc,min:min,price:price,supplier:sup});if(qty>0)bSaveStock(code,qty);}}closeModalForce();showToast('Item saved','success');navTo('inv-items');}
function delBranchItem(code){if(!confirm('Delete '+code+'?'))return;bItems=bItems.filter(function(x){return x.code!==code;});if(db){var bPath_='branches/'+(NX.session&&NX.session.branchId)+'/inv_items/';db.ref(bPath_+code.replace(/[.#$\[\]\/]/g,'_')).remove();db.ref('branches/'+(NX.session&&NX.session.branchId)+'/stock/'+code.replace(/[.#$\[\]\/]/g,'_')).remove();}showToast('Deleted');navTo('inv-items');}

// ── Inventory Diagnostic Tool ──
function diagInventory(){
  if(!db){
    openModal('<div class="modal-head"><h2>\uD83D\uDD0D Inventory Diagnostics</h2><button class="modal-close" onclick="closeModalForce()">\u2715</button></div><div style="color:var(--danger);padding:14px">Firebase not connected.</div>');
    return;
  }
  openModal('<div class="modal-head"><h2>\uD83D\uDD0D Inventory Diagnostics</h2><button class="modal-close" onclick="closeModalForce()">\u2715</button></div><div id="inv-diag-out" style="font-family:var(--mono);font-size:11px;line-height:1.6;color:var(--text-secondary)">Reading <code>shared/inv_items</code>\u2026</div>');
  db.ref('shared/inv_items').once('value',function(snap){
    var raw=snap.val();
    var s=NX.session||{};
    var stockPath='branches/'+(s.branchId||'?')+'/stock';
    db.ref(stockPath).once('value',function(stockSnap){
      var stockRaw=stockSnap.val();
      var box=document.getElementById('inv-diag-out');if(!box)return;
      var rawType=Array.isArray(raw)?'array':(raw===null?'null':typeof raw);
      var stockType=Array.isArray(stockRaw)?'array':(stockRaw===null?'null':typeof stockRaw);
      var rawKeys=raw&&typeof raw==='object'?Object.keys(raw):[];
      var stockKeys=stockRaw&&typeof stockRaw==='object'?Object.keys(stockRaw):[];
      var sample='';
      if(rawKeys.length){
        var sampleKey=rawKeys[0];
        var sampleVal=raw[sampleKey];
        sample='<div style="background:var(--surface-2);padding:10px;border-radius:6px;margin-top:10px"><div style="color:var(--ceo);font-weight:700;margin-bottom:4px">Sample item (key: '+xe(sampleKey)+'):</div><pre style="white-space:pre-wrap;font-size:10px;color:var(--text-primary);margin:0">'+xe(JSON.stringify(sampleVal,null,2))+'</pre></div>';
      }
      var dbg=BS._invDebug||{};
      var html='';
      html+='<div style="background:var(--surface-2);padding:10px;border-radius:6px;margin-bottom:8px">';
      html+='<div><span style="color:var(--text-tertiary)">Branch:</span> '+xe(s.branchName||s.branchId||'?')+'</div>';
      html+='<div><span style="color:var(--text-tertiary)">Catalog path:</span> shared/inv_items</div>';
      html+='<div><span style="color:var(--text-tertiary)">Catalog raw type:</span> <strong style="color:'+(raw?'#b45309':'#c0392b')+'">'+rawType+'</strong></div>';
      html+='<div><span style="color:var(--text-tertiary)">Catalog entry count:</span> <strong style="color:'+(rawKeys.length?'#b45309':'#c0392b')+'">'+rawKeys.length+'</strong></div>';
      html+='<div><span style="color:var(--text-tertiary)">Stock path:</span> '+xe(stockPath)+'</div>';
      html+='<div><span style="color:var(--text-tertiary)">Stock raw type:</span> '+stockType+'</div>';
      html+='<div><span style="color:var(--text-tertiary)">Stock entry count:</span> '+stockKeys.length+'</div>';
      html+='<div><span style="color:var(--text-tertiary)">Merged into bItems:</span> <strong style="color:'+(bItems.length?'#b45309':'#c0392b')+'">'+bItems.length+'</strong></div>';
      if(dbg.skipped)html+='<div style="color:#b45309">Skipped during merge: '+dbg.skipped+'</div>';
      html+='</div>';
      html+=sample;
      if(rawKeys.length===0){
        html+='<div style="background:rgba(248,113,113,.1);border:1px solid rgba(248,113,113,.3);padding:10px;border-radius:6px;margin-top:10px;color:#c0392b">'+
          '<strong>The catalog at <code>shared/inv_items</code> is genuinely empty.</strong><br><br>'+
          'Items were never written there, or were written to a different path. Use <strong>Import CSV</strong> to populate it.'+
        '</div>';
      } else if(bItems.length===0){
        html+='<div style="background:rgba(245,158,11,.1);border:1px solid rgba(245,158,11,.3);padding:10px;border-radius:6px;margin-top:10px;color:#b45309">'+
          '<strong>'+rawKeys.length+' entries found but 0 merged into the table.</strong><br><br>'+
          'Items are present but missing required fields (name). Check the sample above \u2014 the field name might be unusual.'+
        '</div>';
      } else {
        html+='<div style="background:rgba(52,211,153,.1);border:1px solid rgba(52,211,153,.3);padding:10px;border-radius:6px;margin-top:10px;color:#b45309">'+
          '\u2713 Catalog loaded successfully. '+bItems.length+' items showing in the table.'+
        '</div>';
      }
      box.innerHTML=html;
    });
  },function(err){
    var box=document.getElementById('inv-diag-out');if(box)box.innerHTML='<div style="color:var(--danger)">Read failed: '+xe(err.message||String(err))+'</div>';
  });
}

// ── Inventory CSV Import (bulk-load 1000s of items into shared/inv_items) ──
function openInvImportModal(){
  openModal(
    '<div class="modal-head"><h2>\u2B06 Import Inventory Items</h2><button class="modal-close" onclick="closeModalForce()">\u2715</button></div>'+
    '<div style="font-size:12px;color:var(--text-secondary);margin-bottom:12px">Paste CSV data with columns: <code style="background:var(--surface-2);padding:2px 6px;border-radius:4px">code,name,unit,location,min,price,supplier</code></div>'+
    '<div style="background:var(--surface-2);border:1px solid var(--border);border-radius:8px;padding:10px;margin-bottom:12px;font-size:11px;color:var(--text-secondary);font-family:var(--mono);line-height:1.7">'+
      'code,name,unit,location,min,price,supplier<br>'+
      'TOMATO-01,Tomato,KG,Walk-in Chiller,5,2.50,Al Jazira Foods<br>'+
      'CHICKEN-A,Chicken Breast,KG,Freezer,10,18.00,Al Safi'+
    '</div>'+
    '<div class="bfg"><label class="form-label">CSV Data (paste below)</label>'+
      '<textarea class="form-input" id="inv-csv-data" rows="10" style="font-family:var(--mono);font-size:12px;resize:vertical" placeholder="code,name,unit,location,min,price,supplier\nTOMATO-01,Tomato,KG,Walk-in Chiller,5,2.50,Al Jazira"></textarea>'+
    '</div>'+
    '<div style="display:flex;gap:8px;margin-bottom:12px">'+
      '<input type="file" id="inv-csv-file" accept=".csv,.txt" style="flex:1;padding:8px;background:var(--surface-2);border:1px solid var(--border);border-radius:8px;font-size:12px" onchange="loadInvCSVFile(this)">'+
      '<button class="btn btn-sm" onclick="document.getElementById(\'inv-csv-data\').value=\'\'">Clear</button>'+
    '</div>'+
    '<div id="inv-import-preview" style="font-size:11px;color:var(--text-secondary);margin-bottom:12px"></div>'+
    '<div style="display:flex;gap:8px">'+
      '<button class="btn" style="flex:1" onclick="previewInvImport()">\u26A0 Preview</button>'+
      '<button class="btn btn-primary" style="flex:1" onclick="runInvImport()">\u2705 Import All</button>'+
    '</div>'
  );
}
function loadInvCSVFile(input){
  if(!input.files||!input.files[0])return;
  var reader=new FileReader();
  reader.onload=function(e){var ta=document.getElementById('inv-csv-data');if(ta)ta.value=e.target.result;previewInvImport();};
  reader.readAsText(input.files[0]);
}
function _parseInvCSV(txt){
  var lines=txt.split(/\r?\n/).map(function(l){return l.trim();}).filter(Boolean);
  if(!lines.length)return {items:[],errors:['No data']};

  // Robust CSV field splitter (handles quoted fields containing commas)
  function splitCSVLine(ln){
    var fields=[],cur='',inQ=false;
    for(var c=0;c<ln.length;c++){
      var ch=ln[c];
      if(ch==='"'){
        if(inQ&&ln[c+1]==='"'){cur+='"';c++;}  // escaped quote
        else inQ=!inQ;
        continue;
      }
      if(ch===','&&!inQ){fields.push(cur.trim());cur='';continue;}
      cur+=ch;
    }
    fields.push(cur.trim());
    return fields;
  }

  var headerLine=lines[0].toLowerCase();
  var hasHeader=headerLine.indexOf('code')>=0&&headerLine.indexOf('name')>=0;
  var dataLines=hasHeader?lines.slice(1):lines;

  // Build column index map from header (case-insensitive)
  var colMap={code:0,name:1,location:2,qty:3,unit:4,min:5,price:6,supplier:7};
  if(hasHeader){
    var hFields=splitCSVLine(lines[0]);
    hFields.forEach(function(h,i){
      var hl=h.toLowerCase().replace(/[^a-z]/g,'');
      if(hl==='code')colMap.code=i;
      else if(hl==='name')colMap.name=i;
      else if(hl==='location'||hl==='loc')colMap.location=i;
      else if(hl==='qty'||hl==='quantity'||hl==='stock')colMap.qty=i;
      else if(hl==='unit')colMap.unit=i;
      else if(hl==='min'||hl==='minimum'||hl==='minstock')colMap.min=i;
      else if(hl==='price'||hl==='cost'||hl==='unitprice')colMap.price=i;
      else if(hl==='supplier'||hl==='vendor')colMap.supplier=i;
    });
  }

  var items=[],errors=[];
  dataLines.forEach(function(ln,idx){
    var fields=splitCSVLine(ln);
    if(fields.length<2){errors.push('Line '+(idx+1)+': not enough fields');return;}
    var get=function(key,def){
      var i=colMap[key];
      return (i!=null&&i<fields.length)?fields[i]:(def||'');
    };
    var code=get('code'),name=get('name');
    if(!code||!name){errors.push('Line '+(idx+1)+': code and name required');return;}
    items.push({
      code:    code,
      name:    name,
      location:get('location','Dry Storage')||'Dry Storage',
      qty:     parseFloat(get('qty','0'))||0,
      unit:    get('unit','EA')||'EA',
      min:     parseFloat(get('min','0'))||0,
      price:   parseFloat(get('price','0'))||0,
      supplier:get('supplier','')
    });
  });
  return {items:items,errors:errors};
}
function previewInvImport(){
  var ta=document.getElementById('inv-csv-data');if(!ta)return;
  var res=_parseInvCSV(ta.value);
  var box=document.getElementById('inv-import-preview');if(!box)return;
  var dups=res.items.filter(function(it){return bfindItem(it.code);}).length;
  var html='<div style="background:var(--surface-2);border:1px solid var(--border);border-radius:8px;padding:10px">';
  html+='<div style="color:var(--ceo);font-weight:700;font-size:12px;margin-bottom:6px">Preview: '+res.items.length+' items ready, '+dups+' duplicates (will overwrite), '+res.errors.length+' errors</div>';
  if(res.errors.length){html+='<div style="color:var(--danger);font-size:11px;max-height:80px;overflow:auto">'+res.errors.slice(0,5).join('<br>')+'</div>';}
  if(res.items.length){html+='<div style="color:var(--text-tertiary);font-size:11px;font-family:var(--mono);max-height:80px;overflow:auto;margin-top:6px">First 3: '+res.items.slice(0,3).map(function(i){return i.code+' — '+i.name+' | SAR '+i.price+' | Qty:'+i.qty;}).join('<br>')+'</div>';}
  html+='</div>';
  box.innerHTML=html;
}
function runInvImport(){
  var ta=document.getElementById('inv-csv-data');if(!ta){showToast('No data','error');return;}
  var res=_parseInvCSV(ta.value);
  if(!res.items.length){showToast('Nothing to import','error');return;}
  if(res.errors.length){if(!confirm(res.items.length+' items will be imported, '+res.errors.length+' lines will be skipped due to errors. Proceed?'))return;}
  else {if(!confirm('Import '+res.items.length+' items into this branch catalog?\n\nDuplicates (matching code) will be overwritten.'))return;}
  if(!db){showToast('Firebase not connected','error');return;}
  var branchId=NX.session&&NX.session.branchId;
  var bImportPath='branches/'+branchId+'/inv_items/';
  var bStockPath='branches/'+branchId+'/stock/';
  var updates={};
  res.items.forEach(function(it){
    var ck=String(it.code).replace(/[.#$\[\]\/]/g,'_');
    // Catalog fields
    updates[bImportPath+ck]={code:it.code,name:it.name,unit:it.unit,location:it.location,min:it.min,price:it.price,supplier:it.supplier||''};
    // Stock qty (only if non-zero — don't overwrite live stock with zero)
    if(it.qty>0) updates[bStockPath+ck]={qty:it.qty};
  });
  db.ref().update(updates,function(err){
    if(err){showToast('Import failed: '+err.message,'error');return;}
    showToast(res.items.length+' items imported \u2713','success');
    closeModalForce();
    setTimeout(function(){navTo('inv-items');},500);
  });
}
function exportBranchItemsCSV(){
  if(!bItems||!bItems.length){
    var dbg=BS._invDebug||{};
    showToast('No items to export. Catalog has '+(dbg.catKeys||0)+' raw entries; '+(dbg.skipped||0)+' skipped during merge.','error');
    console.warn('[NEXUS] CSV export aborted — empty bItems. Debug:',dbg,'BS._cat sample:',Object.keys(BS._cat||{}).slice(0,3).map(function(k){return [k,BS._cat[k]];}));
    return;
  }
  var rows=[['Code','Name','Location','Qty','Unit','Min','Price','Supplier']];
  bItems.forEach(function(i){rows.push([i.code,i.name,i.location,i.qty,i.unit,i.min,i.price,i.supplier||'']);});
  var csv=rows.map(function(r){return r.map(function(v){return '"'+String(v==null?'':v).replace(/"/g,'""')+'"';}).join(',');}).join('\n');
  // Use Blob for reliable download (data URIs fail above ~2MB in some browsers)
  var blob=new Blob([csv],{type:'text/csv;charset=utf-8;'});
  var url=URL.createObjectURL(blob);
  var a=document.createElement('a');a.href=url;a.download='inventory-'+(NX.session&&NX.session.branchName||'branch').replace(/\s+/g,'_')+'-'+TODAY_BS+'.csv';
  document.body.appendChild(a);a.click();
  setTimeout(function(){document.body.removeChild(a);URL.revokeObjectURL(url);},100);
  showToast('Exported '+bItems.length+' items','success');
}

// ── Receiving ──────────────────────────────────
function pInvMoves() {
  attachBranchListeners();
  attachNXTransferListener();
  var logRows=bLogs.slice().reverse().slice(0,30).map(function(l){
    var isR=l.type==='receive',isTO=l.type==='transfer-out',isTI=l.type==='transfer-in';
    var tc=isR?'#b45309':isTO||isTI?'#c084fc':'#c0392b';
    var tlbl=isR?'In':isTO?'Tr\u2192':isTI?'\u2190Tr':'Out';
    return '<tr><td class="bmono" style="font-size:10px;color:var(--ceo)">'+bxe(l.code)+'</td>'+
      '<td style="font-weight:600;color:var(--text-primary)">'+bxe(l.name)+'</td>'+
      '<td>'+bpl(tlbl,tc)+'</td>'+
      '<td class="bmono" style="font-weight:700;color:'+(isR||isTI?'var(--success)':'var(--danger)')+'">'+((isR||isTI)?'+':'-')+l.qty+'</td>'+
      '<td style="color:var(--text-secondary);font-size:11px">'+bxe(l.note||'\u2014')+'</td>'+
      '<td class="bmono" style="color:var(--text-tertiary);font-size:11px">'+bxe(l.date)+'</td></tr>';
  }).join('');

  // Shared searchable item input style
  var si='background:var(--surface-2);border:1px solid var(--border);border-radius:8px;padding:8px 10px;color:var(--text-primary);font-size:13px;outline:none;width:100%;font-family:var(--font)';
  var drop='position:absolute;top:100%;left:0;right:0;z-index:200;background:var(--body-bg);border:1px solid var(--border);border-radius:8px;max-height:220px;overflow-y:auto;box-shadow:0 8px 24px rgba(0,0,0,.5)';

  var h='<div class="page-header"><h1>Receiving</h1></div>';
  h+='<div class="bgrid-2" style="margin-bottom:14px">';

  // RECEIVE
  h+='<div class="bcard"><div style="font-size:13px;font-weight:700;color:var(--success);margin-bottom:12px">\u2705 Receive Stock</div>';
  h+='<div class="bfg"><label class="form-label">Item</label><div style="position:relative">';
  h+='<input class="form-input" id="recv-search" placeholder="\ud83d\udd0d Search by code or name\u2026" oninput="invSearch(this,\'recv-code\',\'recv-drop\')" autocomplete="off" style="'+si+'">';
  h+='<input type="hidden" id="recv-code">';
  h+='<div id="recv-drop" style="'+drop+';display:none"></div></div></div>';
  h+='<div id="recv-sel-info" style="font-size:11px;color:var(--ceo);font-family:var(--mono);margin-top:-6px;margin-bottom:10px;padding:0 2px"></div>';
  h+='<div class="bfg"><label class="form-label">Quantity</label><input class="form-input" type="number" id="recv-qty" min="0.01" step="0.01" placeholder="0"></div>';
  h+='<div class="bfg"><label class="form-label">Note</label><input class="form-input" id="recv-note" placeholder="Delivery note, PO ref\u2026"></div>';
  h+='<button class="btn btn-primary" style="width:100%" onclick="doReceive()">Confirm Receive</button></div>';

  // ISSUE
  h+='<div class="bcard"><div style="font-size:13px;font-weight:700;color:var(--danger);margin-bottom:12px">\ud83d\udce4 Issue / Pull-Out</div>';
  h+='<div class="bfg"><label class="form-label">Item</label><div style="position:relative">';
  h+='<input class="form-input" id="pull-search" placeholder="\ud83d\udd0d Search by code or name\u2026" oninput="invSearch(this,\'pull-code\',\'pull-drop\')" autocomplete="off" style="'+si+'">';
  h+='<input type="hidden" id="pull-code">';
  h+='<div id="pull-drop" style="'+drop+';display:none"></div></div></div>';
  h+='<div id="pull-sel-info" style="font-size:11px;color:var(--danger);font-family:var(--mono);margin-top:-6px;margin-bottom:10px;padding:0 2px"></div>';
  h+='<div class="bfg"><label class="form-label">Quantity</label><input class="form-input" type="number" id="pull-qty" min="0.01" step="0.01" placeholder="0"></div>';
  h+='<div class="bfg"><label class="form-label">Note</label><input class="form-input" id="pull-note" placeholder="Reason\u2026"></div>';
  h+='<button class="btn btn-primary" style="width:100%" onclick="doPull()">Confirm Issue</button></div>';
  h+='</div>';

  // TRANSFER
  h+='<div class="bcard" style="margin-bottom:14px;border-color:rgba(192,132,252,.25);background:rgba(192,132,252,.03)">';
  h+='<div style="font-size:13px;font-weight:700;color:#c084fc;margin-bottom:12px">\ud83d\udd00 Transfer Stock to Another Branch</div>';
  h+='<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px">';
  h+='<div class="bfg" style="margin-bottom:0"><label class="form-label">Item</label><div style="position:relative">';
  h+='<input class="form-input" id="tr-search" placeholder="\ud83d\udd0d Search item\u2026" oninput="invSearch(this,\'tr-code\',\'tr-drop\')" autocomplete="off" style="'+si+'">';
  h+='<input type="hidden" id="tr-code">';
  h+='<div id="tr-drop" style="'+drop+';display:none"></div></div></div>';
  h+='<div class="bfg" style="margin-bottom:0"><label class="form-label">Quantity</label><input class="form-input" type="number" id="tr-qty" min="0.01" step="0.01" placeholder="0"></div>';
  h+='</div>';
  h+='<div id="tr-sel-info" style="font-size:11px;color:#c084fc;font-family:var(--mono);margin-bottom:10px;padding:0 2px"></div>';
  h+='<div class="bfg" style="margin-bottom:10px"><label class="form-label">Destination Branch</label><select class="form-input form-select" id="tr-dest-branch"><option value="">\u2014 Select branch \u2014</option></select></div>';
  h+='<div class="bfg" style="margin-bottom:12px"><label class="form-label">Note</label><input class="form-input" id="tr-note" placeholder="Reason\u2026"></div>';
  h+='<div style="background:rgba(245,158,11,.07);border:1px solid rgba(245,158,11,.2);border-radius:8px;padding:10px;font-size:11px;color:rgba(245,158,11,.9);margin-bottom:12px">';
  h+='\u26a0\ufe0f Stock deducted immediately. Destination must accept the request.</div>';
  h+='<button class="btn btn-primary" style="width:100%" id="btn-nx-transfer">⇄ Send Transfer Request</button>';
  h+='</div>';
  h+='<div id="nx-incoming-transfers"></div>';
  h+='<div class="btw"><div class="bttb"><span style="font-weight:700">Movement Log</span>';
  h+='<button class="btn btn-sm" style="margin-left:auto" onclick="exportBranchLogsCSV()">\u2b07 CSV</button></div>';
  h+='<div class="btw-s"><table class="btbl"><thead><tr><th>Code</th><th>Item</th><th>Type</th><th>Qty</th><th>Note</th><th>Date</th></tr></thead>';
  h+='<tbody>'+(logRows||'<tr><td colspan="6" style="text-align:center;color:var(--text-tertiary);padding:24px">No movements yet</td></tr>')+'</tbody></table></div></div>';
  setTimeout(function(){
    var sel=document.getElementById('tr-dest-branch');
    if(sel&&db){
      db.ref('admin/branches').once('value',function(snap){
        var raw=snap.val()||{};
        Object.values(raw).filter(Boolean).forEach(function(b){
          if(NX.session&&b.id===NX.session.branchId)return;
          var o=document.createElement('option');
          o.value=b.id; o.textContent=(b.icon||'')+(b.name||b.id)+(b.location?' \u2014 '+b.location:'');
          sel.appendChild(o);
        });
      });
    }
    var btn=document.getElementById('btn-nx-transfer');
    if(btn) btn.onclick=function(){
      var code=((document.getElementById('tr-code')||{}).value||'').trim();
      var qty=parseFloat((document.getElementById('tr-qty')||{}).value||0);
      var dest=((document.getElementById('tr-dest-branch')||{}).value||'').trim();
      var note=((document.getElementById('tr-note')||{}).value||'').trim();
      if(!code){showToast('Select an item','warning');return;}
      if(qty<=0){showToast('Enter quantity > 0','warning');return;}
      if(!dest){showToast('Select destination branch','warning');return;}
      var item=bfindItem(code);
      if(!item){showToast('Item not found','error');return;}
      if(item.qty<qty){showToast('Not enough stock (have: '+item.qty+' '+item.unit+')','error');return;}
      if(!confirm('Transfer '+qty+' '+item.unit+' of "'+item.name+'" to selected branch?'))return;
      doNXTransferStock(code,item,qty,dest,note);
    };
    renderNXIncomingTransfers();
  },50);
  return h;
}

function doNXTransferStock(code,item,qty,destBranchId,note){
  if(!db){showToast('Not connected','error');return;}
  var s=NX.session||{};
  var tid='TRF-'+TODAY_BS+'-'+String(Date.now()).slice(-4);
  var transfer={id:tid,code:code,name:item.name,unit:item.unit,qty:qty,
    fromBranch:s.branchId||'unknown',fromBranchName:s.branchName||'Unknown',
    toBranch:destBranchId,note:note||'',status:'pending',date:TODAY_BS,createdAt:Date.now()};
  item.qty-=qty;
  bSaveStock(code,item.qty);
  bLogs.push({code:code,name:item.name,type:'transfer-out',qty:qty,note:'Transfer to '+destBranchId+(note?' \u2014 '+note:''),date:TODAY_BS});
  bSaveLogs();
  db.ref('branches/'+destBranchId+'/transfer_requests/'+tid).set(transfer,function(err){
    if(err){showToast('Transfer write failed','error');return;}
    showToast('\u2705 Transfer sent! Waiting for '+destBranchId+' to accept','success');
    navTo('inv-moves');
  });
}

var _nxTransferListenerAttached=false;
function attachNXTransferListener(){
  if(!db||!NX.session||!NX.session.branchId||_nxTransferListenerAttached)return;
  _nxTransferListenerAttached=true;
  db.ref('branches/'+NX.session.branchId+'/transfer_requests').on('value',function(snap){
    var raw=snap.val();if(!raw)return;
    var pending=Object.values(raw).filter(function(t){return t&&t.status==='pending';});
    if(pending.length>0) renderNXIncomingTransfers();
  });
}

function renderNXIncomingTransfers(){
  if(!db||!NX.session||!NX.session.branchId)return;
  db.ref('branches/'+NX.session.branchId+'/transfer_requests').once('value',function(snap){
    var raw=snap.val()||{};
    var pending=Object.values(raw).filter(function(t){return t&&t.status==='pending';});
    var container=document.getElementById('nx-incoming-transfers');
    if(!container)return;
    if(!pending.length){container.innerHTML='';return;}
    var h='<div style="background:rgba(192,132,252,.06);border:1px solid rgba(192,132,252,.2);border-radius:12px;padding:14px;margin-bottom:14px">';
    h+='<div style="font-size:13px;font-weight:700;color:#c084fc;margin-bottom:10px">\ud83d\udce8 Incoming Transfers ('+pending.length+')</div>';
    pending.forEach(function(t){
      var tdata=encodeURIComponent(JSON.stringify(t)).replace(/'/g,'%27');
      h+='<div style="background:var(--surface-2);border:1px solid var(--border);border-radius:9px;padding:12px;margin-bottom:8px;display:flex;align-items:center;gap:10px;flex-wrap:wrap">';
      h+='<div style="flex:1;min-width:0"><div style="font-size:13px;font-weight:700">'+xe(t.name)+'</div>';
      h+='<div class="mono" style="font-size:11px;color:var(--text-tertiary);margin-top:2px">'+xe(t.code)+' \xb7 <strong style="color:#c084fc">'+t.qty+' '+t.unit+'</strong> from <strong>'+xe(t.fromBranchName||t.fromBranch)+'</strong></div>';
      if(t.note) h+='<div style="font-size:11px;color:var(--text-secondary);margin-top:2px">'+xe(t.note)+'</div>';
      h+='<div class="mono" style="font-size:10px;color:var(--text-tertiary)">'+xe(t.id)+' \xb7 '+xe(t.date)+'</div></div>';
      h+='<div style="display:flex;gap:6px;flex-shrink:0">';
      h+='<button class="btn btn-primary btn-sm" onclick="nxAcceptTransfer(\''+xe(t.id)+'\',\''+tdata+'\')"> Accept</button>';
      h+='<button class="btn btn-sm" style="color:var(--danger)" onclick="nxRejectTransfer(\''+xe(t.id)+'\')">\u2715 Reject</button>';
      h+='</div></div>';
    });
    h+='</div>';
    container.innerHTML=h;
  });
}

function nxAcceptTransfer(id,tEncoded){
  if(!db||!NX.session)return;
  var t;try{t=JSON.parse(decodeURIComponent(tEncoded));}catch(e){showToast('Invalid data','error');return;}
  var item=bfindItem(t.code);
  if(item){item.qty+=(t.qty||0);bSaveStock(t.code,item.qty);}
  bLogs.push({code:t.code,name:t.name,type:'transfer-in',qty:t.qty,note:'From '+xe(t.fromBranchName||t.fromBranch),date:TODAY_BS});
  bSaveLogs();
  db.ref('branches/'+NX.session.branchId+'/transfer_requests/'+id+'/status').set('accepted',function(){
    showToast('\u2705 Transfer accepted \u2014 stock added','success');
    navTo('inv-moves');
  });
}

function nxRejectTransfer(id){
  if(!db||!NX.session)return;
  if(!confirm('Reject this transfer?'))return;
  db.ref('branches/'+NX.session.branchId+'/transfer_requests/'+id+'/status').set('rejected',function(){
    showToast('Transfer rejected','warning');
    renderNXIncomingTransfers();
  });
}
function invSearch(inp,hiddenId,dropId){
  var q=(inp.value||'').toLowerCase().trim();
  var drop=document.getElementById(dropId);
  var hidden=document.getElementById(hiddenId);
  if(!drop)return;
  if(!q){drop.style.display='none';if(hidden)hidden.value='';return;}
  var matches=bItems.filter(function(i){
    return String(i.code||'').toLowerCase().indexOf(q)>=0||String(i.name||'').toLowerCase().indexOf(q)>=0;
  }).slice(0,40);
  if(!matches.length){drop.innerHTML='<div style="padding:10px 12px;font-size:12px;color:var(--text-tertiary)">No items found</div>';drop.style.display='block';return;}
  drop.innerHTML=matches.map(function(i){
    var isLow=i.min>0&&i.qty<=i.min;
    return '<div onclick="invSelect(\''+bxe(i.code)+'\',\''+hiddenId+'\',\''+dropId+'\',\''+bxe(inp.id)+'\')" style="padding:9px 12px;cursor:pointer;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center;gap:8px" onmouseover="this.style.background=\'var(--surface-2)\'" onmouseout="this.style.background=\'\'">'+
      '<div><div style="font-size:12px;font-weight:600;color:var(--text-primary)">'+bxe(i.name)+'</div><div style="font-size:10px;color:var(--text-tertiary);font-family:var(--mono)">'+bxe(i.code)+' · '+bxe(i.unit)+'</div></div>'+
      '<div style="text-align:right;flex-shrink:0"><div style="font-size:12px;font-weight:700;color:'+(isLow?'var(--danger)':'var(--ceo)')+'">'+i.qty+'</div><div style="font-size:9px;color:var(--text-tertiary)">'+(isLow?'LOW':'in stock')+'</div></div>'+
      '</div>';
  }).join('');
  drop.style.display='block';
  // Close dropdown when clicking outside
  setTimeout(function(){document.addEventListener('click',function cl(e){if(!drop.contains(e.target)&&e.target!==inp){drop.style.display='none';document.removeEventListener('click',cl);}});},0);
}
function invSelect(code,hiddenId,dropId,inputId){
  var it=bfindItem(code);if(!it)return;
  var hidden=document.getElementById(hiddenId);
  var inp=document.getElementById(inputId);
  var drop=document.getElementById(dropId);
  if(hidden)hidden.value=code;
  if(inp)inp.value=it.code+' — '+it.name;
  if(drop)drop.style.display='none';
  // Update info line
  var prefix=hiddenId.replace('-code','');
  var info=document.getElementById(prefix+'-sel-info');
  if(info)info.textContent=bxe(it.name)+' · '+it.qty+' '+bxe(it.unit||'')+' in stock'+(it.min>0&&it.qty<=it.min?' ⚠ LOW':'');
}
function doReceive(){var code=bgv('recv-code'),qty=parseFloat(bgv('recv-qty'))||0,note=bgv('recv-note');if(!code||qty<=0){showToast('Select item and enter quantity','error');return;}var it=bfindItem(code);if(!it){showToast('Item not found','error');return;}it.qty=parseFloat(it.qty||0)+qty;bSaveStock(code,it.qty);bLogs.push({code:code,name:it.name,type:'receive',qty:qty,cost:qty*(parseFloat(it.price)||0),note:note,date:TODAY_BS});bSaveLogs();showToast(it.name+' +'+qty+' received','success');navTo('inv-moves');}
function doPull(){var code=bgv('pull-code'),qty=parseFloat(bgv('pull-qty'))||0,note=bgv('pull-note');if(!code||qty<=0){showToast('Select item and enter quantity','error');return;}var it=bfindItem(code);if(!it){showToast('Item not found','error');return;}if(qty>it.qty){showToast('Insufficient stock ('+it.qty+' '+it.unit+' available)','error');return;}it.qty=parseFloat(it.qty||0)-qty;bSaveStock(code,it.qty);bLogs.push({code:code,name:it.name,type:'issue',qty:qty,cost:qty*(parseFloat(it.price)||0),note:note,date:TODAY_BS});bSaveLogs();showToast(it.name+' -'+qty+' issued to kitchen','success');navTo('inv-moves');}
function exportBranchLogsCSV(){var rows=[['Code','Name','Type','Qty','Note','Date']];bLogs.forEach(function(l){rows.push([l.code,l.name,l.type,l.qty,l.note||'',l.date]);});var csv=rows.map(function(r){return r.map(function(v){return '"'+String(v).replace(/"/g,'""')+'"';}).join(',');}).join('\n');var a=document.createElement('a');a.href='data:text/csv;charset=utf-8,'+encodeURIComponent(csv);a.download='movements.csv';a.click();}

// ── Purchase Orders ──────────────────────────────────
var bOrdItems=[];
function bGenOrdId(){var d=new Date();return 'ORD-'+d.getFullYear()+String(d.getMonth()+1).padStart(2,'0')+String(d.getDate()).padStart(2,'0')+'-'+String(bOrders.length+1).padStart(3,'0');}
// ── Basket state ──────────────────────────────────────────────────────────────
var _basket = {};  // code → {item, qty}

function pInvOrders() {
  attachBranchListeners();
  var tab = BS.ordTab || 'market';
  var tabStyle = 'flex:1;padding:9px;border-radius:8px;border:none;cursor:pointer;font-size:12px;font-weight:700;font-family:var(--font);transition:all .15s';
  var h = '<div style="display:flex;gap:0;margin-bottom:16px;background:var(--surface-1);border:1px solid var(--border);border-radius:11px;padding:3px">';
  h += '<button onclick="BS.ordTab=\'market\';navTo(\'inv-orders\')" style="' + tabStyle + ';background:' + (tab==='market'?'var(--primary)':'transparent') + ';color:' + (tab==='market'?'#fff':'var(--text-secondary)') + ';box-shadow:' + (tab==='market'?'3px 3px 10px rgba(0,102,102,0.35)':'none') + '">🛒 Market</button>';
  var ordCount = bOrders.length;
  h += '<button onclick="BS.ordTab=\'orders\';navTo(\'inv-orders\')" style="' + tabStyle + ';background:' + (tab==='orders'?'var(--primary)':'transparent') + ';color:' + (tab==='orders'?'#fff':'var(--text-secondary)') + ';box-shadow:' + (tab==='orders'?'3px 3px 10px rgba(0,102,102,0.35)':'none') + '">📋 Orders' + (ordCount ? ' (' + ordCount + ')' : '') + '</button>';
  h += '</div>';
  return h + (tab === 'market' ? pOrdersMarketNX() : pOrdersHistoryNX());
}

function pOrdersMarketNX() {
  var suppliers = getSuppliers().slice().sort();
  var locations = getLocations().slice().sort();
  var selSup = BS.mktSup || '';
  var selLoc = BS.mktLoc || '';
  var q = (BS.mktQ || '').toLowerCase();
  var basketCount = Object.keys(_basket).length;
  var basketTotal = Object.values(_basket).reduce(function(s,e){ return s + (e.qty * (parseFloat(e.item.price)||0)); }, 0);

  var h = '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:14px">';
  h += '<select id="mkt-sup" onchange="BS.mktSup=this.value;navTo(\'inv-orders\')" style="background:var(--surface-3);border:1px solid var(--border);border-radius:8px;padding:7px 10px;color:var(--text-primary);font-size:12px;outline:none;font-family:var(--font)">';
  h += '<option value="">All Suppliers</option>';
  suppliers.forEach(function(s) { h += '<option value="' + xe(s) + '"' + (selSup===s?' selected':'') + '>' + xe(s) + '</option>'; });
  h += '</select>';
  h += '<select id="mkt-loc" onchange="BS.mktLoc=this.value;navTo(\'inv-orders\')" style="background:var(--surface-3);border:1px solid var(--border);border-radius:8px;padding:7px 10px;color:var(--text-primary);font-size:12px;outline:none;font-family:var(--font)">';
  h += '<option value="">All Locations</option>';
  locations.forEach(function(l) { h += '<option value="' + xe(l) + '"' + (selLoc===l?' selected':'') + '>' + xe(l) + '</option>'; });
  h += '</select>';
  h += '<input id="mkt-srch" placeholder="🔍 Search items…" value="' + xe(BS.mktQ||'') + '" oninput="BS.mktQ=this.value;navTo(\'inv-orders\')" style="flex:1;min-width:140px;background:var(--surface-3);border:1px solid var(--border);border-radius:8px;padding:7px 10px;color:var(--text-primary);font-size:12px;outline:none;font-family:var(--font)">';
  h += '</div>';

  if (basketCount > 0) {
    h += '<div style="background:rgba(240,165,0,.10);border:1px solid rgba(240,165,0,.28);border-radius:11px;padding:12px 16px;margin-bottom:14px;display:flex;align-items:center;gap:12px">';
    h += '<span style="font-size:20px">🧺</span>';
    h += '<div style="flex:1"><div style="font-size:13px;font-weight:700;color:var(--accent)">' + basketCount + ' item' + (basketCount!==1?'s':'') + ' · ' + formatSAR(basketTotal) + '</div>';
    h += '<div style="font-size:10px;color:var(--text-secondary)">One PO per supplier will be created</div></div>';
    h += '<button class="btn btn-primary" onclick="openBasketModalNX()" style="background:var(--accent);color:#000;font-weight:700">🧺 Checkout</button></div>';
  }

  var filtered = bItems.filter(function(it) {
    if (selSup && it.supplier !== selSup) return false;
    if (selLoc && it.location !== selLoc) return false;
    if (q && String(it.code||'').toLowerCase().indexOf(q) < 0 && (it.name||'').toLowerCase().indexOf(q) < 0) return false;
    return true;
  }).sort(function(a,b){ return (a.name||'').localeCompare(b.name||''); });

  if (!bItems.length) {
    h += '<div style="text-align:center;padding:60px 20px;color:var(--text-tertiary)">';
    h += '<div style="font-size:36px;margin-bottom:10px">&#x1F4E6;</div>';
    h += '<div style="font-size:14px;font-weight:600;margin-bottom:6px;color:var(--text-primary)">No inventory items available</div>';
    h += '<div style="font-size:12px;line-height:1.6;max-width:420px;margin:0 auto 16px">The shared inventory catalog (<code style="background:var(--surface-2);padding:2px 6px;border-radius:4px;font-family:var(--mono)">shared/inv_items</code>) is empty. Import items via CSV or add them one by one.</div>';
    h += '<div style="display:flex;gap:8px;justify-content:center;flex-wrap:wrap">';
    h += '<button onclick="navTo(\'inv-orders\')" style="padding:8px 18px;border-radius:8px;border:1px solid var(--border);background:var(--surface-2);color:var(--text-primary);font-size:12px;font-weight:600;cursor:pointer">&#x21BB; Reload</button>';
    h += '<button onclick="navTo(\'inv-items\');setTimeout(openInvImportModal,300)" style="padding:8px 18px;border-radius:8px;border:1px solid var(--accent);background:var(--accent);color:#000;font-size:12px;font-weight:700;cursor:pointer">\u2B06 Import CSV</button>';
    h += '<button onclick="navTo(\'inv-items\')" style="padding:8px 18px;border-radius:8px;border:1px solid var(--border);background:var(--surface-2);color:var(--text-primary);font-size:12px;font-weight:600;cursor:pointer">+ Add Items</button>';
    h += '</div></div>';
    return h;
  }
  if (!filtered.length) {
    h += '<div style="text-align:center;padding:60px;color:var(--text-tertiary)"><div style="font-size:36px;margin-bottom:10px">&#x1F6D2;</div><div>No items match your filters. Try clearing the search or supplier filter.</div></div>';
    return h;
  }

  // Group by supplier
  var bySup = {};
  filtered.forEach(function(it) {
    var sup = it.supplier || 'Unassigned';
    if (!bySup[sup]) bySup[sup] = [];
    bySup[sup].push(it);
  });

  Object.keys(bySup).sort().forEach(function(sup) {
    h += '<div style="margin-bottom:20px">';
    h += '<div style="font-size:10px;font-weight:700;color:var(--text-tertiary);text-transform:uppercase;letter-spacing:2px;font-family:var(--mono);padding:0 2px;margin-bottom:8px">🏢 ' + xe(sup) + '</div>';
    h += '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:8px">';
    bySup[sup].forEach(function(it) {
      var inBasket = _basket[it.code];
      var isLow = it.min > 0 && it.qty <= it.min;
      h += '<div style="background:var(--surface-2);border:1.5px solid ' + (inBasket ? 'var(--accent)' : 'var(--border)') + ';border-radius:11px;padding:12px;position:relative;transition:border-color .15s">';
      if (isLow) h += '<div style="position:absolute;top:8px;right:8px;font-size:8px;background:rgba(248,113,113,.15);color:var(--danger);border-radius:4px;padding:2px 5px;font-weight:700">LOW</div>';
      h += '<div style="font-size:10px;color:var(--accent);font-weight:700;font-family:var(--mono);margin-bottom:3px">' + xe(it.code||'') + '</div>';
      h += '<div style="font-size:12px;font-weight:600;color:var(--text-primary);margin-bottom:4px;line-height:1.3">' + xe(it.name) + '</div>';
      h += '<div style="font-size:9px;color:var(--text-tertiary);margin-bottom:8px">Stock: ' + it.qty + ' ' + (it.unit||'') + (it.min?' · Min:'+it.min:'') + '</div>';
      if (inBasket) {
        h += '<div style="display:flex;align-items:center;gap:6px">';
        h += '<button onclick="bktDec(\'' + xe(it.code) + '\')" style="width:26px;height:26px;border-radius:6px;border:1px solid var(--border);background:var(--surface-3);color:var(--text-primary);cursor:pointer;font-size:14px;font-weight:700">−</button>';
        h += '<div style="flex:1;text-align:center;font-size:14px;font-weight:700;color:var(--accent);font-family:var(--mono)">' + inBasket.qty + '</div>';
        h += '<button onclick="bktInc(\'' + xe(it.code) + '\')" style="width:26px;height:26px;border-radius:6px;border:1px solid var(--border);background:var(--surface-3);color:var(--text-primary);cursor:pointer;font-size:14px;font-weight:700">+</button>';
        h += '<button onclick="bktRemove(\'' + xe(it.code) + '\')" style="width:26px;height:26px;border-radius:6px;border:1px solid rgba(248,113,113,.3);background:rgba(248,113,113,.1);color:var(--danger);cursor:pointer;font-size:11px">✕</button>';
        h += '</div>';
      } else {
        h += '<button onclick="bktAdd(\'' + xe(it.code) + '\')" style="width:100%;padding:7px;border-radius:8px;border:none;background:var(--accent);color:#000;cursor:pointer;font-size:11px;font-weight:700;font-family:var(--font)">+ Add to Basket</button>';
      }
      h += '</div>';
    });
    h += '</div></div>';
  });
  return h;
}

function pOrdersHistoryNX() {
  var q = (BS.ordQ||'').toLowerCase();
  var sf = BS.ordSF || '';
  var filtered = bOrders.filter(function(o) {
    if (sf && o.status !== sf) return false;
    if (q) {
      var m = (o.id||'').toLowerCase().indexOf(q) >= 0 || (o.supplier||'').toLowerCase().indexOf(q) >= 0;
      if (!m) return false;
    }
    return true;
  });
  var stC = {pending:'var(--warning)',partial:'var(--info)',done:'var(--success)',cancelled:'var(--danger)'};
  var h = '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:14px">';
  h += '<input placeholder="🔍 Search orders…" value="' + xe(BS.ordQ||'') + '" oninput="BS.ordQ=this.value;navTo(\'inv-orders\')" style="flex:1;background:var(--surface-3);border:1px solid var(--border);border-radius:8px;padding:7px 10px;color:var(--text-primary);font-size:12px;outline:none;font-family:var(--font)">';
  h += '<select onchange="BS.ordSF=this.value;navTo(\'inv-orders\')" style="background:var(--surface-3);border:1px solid var(--border);border-radius:8px;padding:7px 10px;color:var(--text-primary);font-size:12px;outline:none;font-family:var(--font)">';
  h += '<option value="">All Status</option><option value="pending"' + (sf==='pending'?' selected':'') + '>Pending</option><option value="done"' + (sf==='done'?' selected':'') + '>Done</option><option value="cancelled"' + (sf==='cancelled'?' selected':'') + '>Cancelled</option></select>';
  h += '</div>';
  if (!filtered.length) { return h + '<div style="text-align:center;padding:60px;color:var(--text-tertiary)">No orders found</div>'; }
  filtered.forEach(function(o) {
    var recvd = (o.items||[]).filter(function(x){ return (x.received||0) >= x.qty; }).length;
    var pct = o.items&&o.items.length ? Math.round(recvd/o.items.length*100) : 0;
    h += '<div style="background:var(--surface-2);border:1px solid var(--border);border-radius:12px;margin-bottom:10px;overflow:hidden">';
    h += '<div style="display:flex;align-items:center;gap:12px;padding:12px 14px;cursor:pointer" onclick="this.nextElementSibling.style.display=this.nextElementSibling.style.display===\'none\'?\'block\':\'none\'">';
    h += '<div style="flex:1"><div style="font-size:11px;font-weight:700;color:var(--text-primary)">📋 ' + xe(o.id||'') + ' · ' + xe(o.supplier||'No supplier') + '</div>';
    h += '<div style="font-size:10px;color:var(--text-secondary);margin-top:2px">📅 ' + xe(o.date||'') + (o.note?' · '+xe(o.note):'') + '</div></div>';
    h += '<div style="font-size:11px;font-weight:700;color:' + (stC[o.status]||'var(--text-secondary)') + '">' + xe(o.status||'pending') + '</div>';
    if (o.status === 'pending' || o.status === 'partial') {
      h += '<button class="btn btn-sm" style="background:rgba(248,113,113,.12);color:#c0392b;border-color:rgba(248,113,113,.35);flex-shrink:0;font-size:11px" onclick="event.stopPropagation();deleteOrder(\'' + xe(o.id) + '\')">🗑️ Delete</button>';
    }
    h += '<span style="color:var(--text-tertiary)">▾</span></div>';
    h += '<div style="display:none;padding:0 14px 12px">';
    h += '<div style="display:flex;justify-content:flex-end;margin-bottom:8px">';
    h += '<button class="btn btn-sm" onclick="printPurchaseOrder(\'' + xe(o.id) + '\')" style="font-size:11px;gap:4px">🖨️ Print Order</button>';
    h += '</div>';
    (o.items||[]).forEach(function(it) {
      var rv = it.received||0, done = rv >= it.qty, notRecv = it.notReceived;
      h += '<div style="display:flex;align-items:center;justify-content:space-between;padding:7px 0;border-bottom:1px solid var(--border);font-size:12px;gap:8px;flex-wrap:wrap">';
      h += '<span style="flex:1;min-width:0">' + xe(it.name) + ' <span style="font-family:var(--mono);color:var(--text-tertiary);font-size:10px">'+xe(it.code)+'</span></span>';
      h += '<span style="font-family:var(--mono);color:' + (done?'var(--success)':notRecv?'var(--warning)':'var(--text-primary)') + '">' + (it.received||0) + '/' + it.qty + ' ' + (it.unit||'') + (notRecv?' ⚠️':'') + '</span>';
      if (!done && !notRecv && o.status !== 'done' && o.status !== 'cancelled') {
        h += '<div style="display:flex;gap:4px;flex-shrink:0">';
        h += '<button class="btn btn-sm" style="background:rgba(52,211,153,.15);color:#b45309;border-color:rgba(52,211,153,.3)" onclick="bktReceiveItem(\'' + xe(o.id) + '\',\'' + xe(it.code) + '\')">✅ Receive</button>';
        h += '<button class="btn btn-sm" style="background:rgba(248,113,113,.1);color:#c0392b;border-color:rgba(248,113,113,.3)" onclick="bktMarkNotReceived(\'' + xe(o.id) + '\',\'' + xe(it.code) + '\')">✗ Not Received</button>';
        h += '</div>';
      } else if (done) {
        h += '<span style="font-size:10px;font-weight:700;color:#00875a;flex-shrink:0">✅ Done</span>';
      } else if (notRecv) {
        h += '<span style="font-size:10px;font-weight:700;color:#b45309;flex-shrink:0">⚠️ Not Received</span>';
      }
      h += '</div>';
    });
    h += '</div></div>';
  });
  return h;
}

// Basket helpers (nexus version)
function bktAdd(code) {
  var it = bItems.find(function(x){ return x.code===code; });
  if (!it) return;
  if (!_basket[code]) _basket[code] = {item:it, qty:1};
  else _basket[code].qty++;
  navTo('inv-orders');
}
function bktInc(code) { if (_basket[code]) { _basket[code].qty++; navTo('inv-orders'); } }
function bktDec(code) { if (_basket[code]) { _basket[code].qty--; if (_basket[code].qty<=0) delete _basket[code]; navTo('inv-orders'); } }
function bktRemove(code) { delete _basket[code]; navTo('inv-orders'); }

function deleteOrder(ordId) {
  var o = bOrders.find(function(x){ return x.id === ordId; });
  if (!o) return;
  if (!confirm('Delete order ' + ordId + '?\n\nThis cannot be undone.')) return;
  bOrders = bOrders.filter(function(x){ return x.id !== ordId; });
  if (db) {
    var key = String(ordId).replace(/[.#$\[\]\/]/g, '_');
    db.ref(bPath('inv_orders') + '/' + key).remove();
  }
  showToast('Order ' + ordId + ' deleted', 'success');
  navTo('inv-orders');
}

function bktReceiveItem(ordId, code) {
  var o = bOrders.find(function(x){ return x.id===ordId; });
  if (!o) return;
  var it = (o.items||[]).find(function(x){ return x.code===code; });
  if (!it) return;
  var prevReceived = it.received || 0;
  var addQty = it.qty - prevReceived;
  it.received = it.qty;
  // Update item QTY in inventory
  if (addQty > 0) {
    var invItem = bfindItem(code);
    if (invItem) {
      invItem.qty = parseFloat(invItem.qty || 0) + addQty;
      bSaveStock(code, invItem.qty);
      bLogs.push({code: code, name: invItem.name, type: 'receive', qty: addQty, cost: addQty*(parseFloat(invItem.price)||0), note: 'From PO: ' + ordId, date: TODAY_BS});
      bSaveLogs();
    }
  }
  var allDone = (o.items||[]).every(function(x){ return (x.received||0)>=x.qty; });
  if (allDone) o.status = 'done';
  else o.status = 'partial';
  bSaveColl('inv_orders', bOrders);
  showToast('✅ Received — stock updated', 'success');
  navTo('inv-orders');
}

function bktMarkNotReceived(ordId, code) {
  var o = bOrders.find(function(x){ return x.id===ordId; });
  if (!o) return;
  var it = (o.items||[]).find(function(x){ return x.code===code; });
  if (!it) return;
  it.notReceived = true;
  it.received = it.received || 0;
  // Check if all items are either received or marked not-received
  var allSettled = (o.items||[]).every(function(x){ return (x.received||0)>=x.qty || x.notReceived; });
  var anyReceived = (o.items||[]).some(function(x){ return (x.received||0)>0; });
  if (allSettled) o.status = anyReceived ? 'partial' : 'cancelled';
  bSaveColl('inv_orders', bOrders);
  showToast('⚠️ Marked as not received', 'warning');
  navTo('inv-orders');
}

function printPurchaseOrder(ordId) {
  var o = bOrders.find(function(x){ return x.id===ordId; });
  if (!o) { showToast('Order not found', 'error'); return; }
  var s = NX.session || {};
  var rows = (o.items||[]).map(function(it, i) {
    var done = (it.received||0) >= it.qty;
    var notRecv = it.notReceived;
    var statusLabel = done ? '✅ Received' : notRecv ? '⚠️ Not Received' : '⏳ Pending';
    return '<tr style="border-bottom:1px solid #e2e8f0">' +
      '<td style="padding:10px 12px;font-size:12px;font-weight:600;color:#111">' + (i+1) + '</td>' +
      '<td style="padding:10px 12px"><div style="font-size:12px;font-weight:700;color:#111">' + (it.name||'') + '</div><div style="font-size:10px;color:#64748b;font-family:monospace">' + (it.code||'') + '</div></td>' +
      '<td style="padding:10px 12px;text-align:center;font-size:13px;font-weight:700;color:#1a2340;font-family:monospace">' + it.qty + '</td>' +
      '<td style="padding:10px 12px;text-align:center;font-size:12px;color:#64748b">' + (it.unit||'') + '</td>' +
      '<td style="padding:10px 12px;text-align:center;font-size:11px;font-weight:600;color:' + (done?'#00875a':notRecv?'#b45309':'#64748b') + '">' + statusLabel + '</td>' +
      '<td style="padding:10px 12px;font-family:monospace;font-size:11px;color:#94a3b8;border:1px solid #e2e8f0;min-width:120px">&nbsp;</td>' +
    '</tr>';
  }).join('');
  var total = (o.items||[]).reduce(function(s,it){ return s + (it.qty * (parseFloat(it.price)||0)); }, 0);
  var html = '<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Purchase Order - ' + o.id + '</title>' +
    '<style>@page{size:A4;margin:12mm}*{box-sizing:border-box;margin:0;padding:0;font-family:Arial,Helvetica,sans-serif}' +
    'body{background:#fff;color:#111;font-size:12px}' +
    'table{width:100%;border-collapse:collapse}' +
    '.hdr{display:flex;justify-content:space-between;align-items:flex-start;padding-bottom:14px;margin-bottom:18px;border-bottom:3px solid #1a2340}' +
    '.po-badge{background:#1a2340;color:#fff;padding:6px 16px;border-radius:6px;font-size:11px;font-weight:700;letter-spacing:1px}' +
    '.info-grid{display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-bottom:18px}' +
    '.info-box{background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:10px 12px}' +
    '.info-box .lbl{font-size:9px;text-transform:uppercase;letter-spacing:1px;color:#64748b;margin-bottom:3px}' +
    '.info-box .val{font-size:13px;font-weight:700;color:#1a2340}' +
    'thead th{background:#1a2340;color:#fff;padding:10px 12px;text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:1px}' +
    'tbody tr:nth-child(even){background:#f8fafc}' +
    '.foot{margin-top:24px;display:grid;grid-template-columns:1fr 1fr 1fr;gap:30px}' +
    '.foot-cell{border-top:2px solid #1a2340;padding-top:6px;text-align:center;font-size:9px;color:#64748b;font-weight:600}' +
    '@media print{.np{display:none!important}}' +
    '</style></head><body>' +
    '<div class="hdr">' +
      '<div><img src="https://i.imgur.com/jeqtcE2.png" alt="ALFA.CO" style="height:44px;width:auto;display:block">' +
      '<div style="font-size:11px;color:#64748b;margin-top:2px">' + (s.branchName||s.entityName||'') + '</div></div>' +
      '<div style="text-align:center"><h1 style="font-size:18px;font-weight:900;color:#1a2340;letter-spacing:2px">PURCHASE ORDER</h1>' +
      '<div class="po-badge" style="margin-top:6px;display:inline-block">' + o.id + '</div></div>' +
      '<div style="text-align:right;font-size:10px;color:#64748b"><div>Date: <strong>' + o.date + '</strong></div>' +
      '<div style="margin-top:4px">Printed: ' + new Date().toLocaleDateString('en-GB') + '</div></div>' +
    '</div>' +
    '<div class="info-grid">' +
      '<div class="info-box"><div class="lbl">Supplier</div><div class="val">' + (o.supplier||'—') + '</div></div>' +
      '<div class="info-box"><div class="lbl">Status</div><div class="val" style="text-transform:capitalize">' + (o.status||'pending') + '</div></div>' +
      '<div class="info-box"><div class="lbl">Note</div><div class="val" style="font-size:11px;font-weight:500">' + (o.note||'—') + '</div></div>' +
    '</div>' +
    '<table><thead><tr>' +
      '<th style="width:40px">#</th><th>Item</th><th style="text-align:center;width:80px">Qty</th>' +
      '<th style="text-align:center;width:60px">Unit</th><th style="text-align:center;width:120px">Status</th>' +
      '<th style="width:140px">Supplier Signature</th>' +
    '</tr></thead><tbody>' + rows + '</tbody></table>' +
    (total > 0 ? '<div style="text-align:right;margin-top:12px;font-size:13px;font-weight:700;color:#1a2340">Total Estimated: SAR ' + total.toLocaleString('en',{minimumFractionDigits:2,maximumFractionDigits:2}) + '</div>' : '') +
    '<div class="foot">' +
      '<div class="foot-cell">Prepared by</div>' +
      '<div class="foot-cell">Approved by Manager</div>' +
      '<div class="foot-cell">Supplier Representative</div>' +
    '</div>' +
    '<div class="np" style="text-align:center;margin-top:20px">' +
      '<button onclick="window.print()" style="background:#1a2340;color:#fff;border:none;border-radius:8px;padding:10px 28px;font-size:13px;font-weight:700;cursor:pointer">🖨️ Print / Save PDF</button>' +
    '</div>' +
    '</body></html>';
  var w = window.open('', '_blank', 'width=900,height=700');
  if (w) { w.document.write(html); w.document.close(); }
  else showToast('Allow pop-ups to print', 'error');
}

function openBasketModalNX() {
  var bItems2 = Object.values(_basket);
  if (!bItems2.length) { showToast('Basket is empty','error'); return; }
  var bySup = {};
  bItems2.forEach(function(e) {
    var sup = e.item.supplier || 'No Supplier';
    if (!bySup[sup]) bySup[sup] = [];
    bySup[sup].push(e);
  });
  var grandTotal = bItems2.reduce(function(s,e){ return s + (e.qty*(parseFloat(e.item.price)||0)); }, 0);

  var html = '<div style="display:flex;flex-direction:column;gap:14px">';
  html += '<div style="font-size:11px;color:var(--text-secondary);background:var(--surface-3);border-radius:8px;padding:10px 12px">One <strong>purchase order per supplier</strong> will be created.</div>';
  Object.keys(bySup).sort().forEach(function(sup) {
    var sItems = bySup[sup];
    var supTotal = sItems.reduce(function(s,e){ return s+(e.qty*(parseFloat(e.item.price)||0)); }, 0);
    html += '<div style="background:var(--surface-2);border:1px solid var(--border);border-radius:11px;overflow:hidden">';
    html += '<div style="padding:10px 14px;background:var(--surface-3);border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center">';
    html += '<div style="font-size:12px;font-weight:700">🏢 ' + xe(sup) + '</div>';
    html += '<div style="font-size:11px;color:var(--accent);font-weight:700;font-family:var(--mono)">' + formatSAR(supTotal) + '</div></div>';
    html += '<table style="width:100%;border-collapse:collapse">';
    sItems.forEach(function(e) {
      html += '<tr style="border-bottom:1px solid var(--border)">';
      html += '<td style="padding:8px 14px;font-size:11px"><div style="font-weight:600">' + xe(e.item.name) + '</div><div style="font-size:9px;color:var(--text-tertiary);font-family:var(--mono)">' + xe(e.item.code||'') + '</div></td>';
      html += '<td style="padding:8px 14px;text-align:center"><div style="display:flex;align-items:center;gap:4px;justify-content:center">';
      html += '<button onclick="bktDecModal(\'' + xe(e.item.code) + '\')" style="width:22px;height:22px;border-radius:4px;border:1px solid var(--border);background:var(--surface-3);color:var(--text-primary);cursor:pointer">−</button>';
      html += '<span id="bqnx-' + xe(e.item.code) + '" style="font-weight:700;min-width:28px;text-align:center;font-family:var(--mono)">' + e.qty + '</span>';
      html += '<button onclick="bktIncModal(\'' + xe(e.item.code) + '\')" style="width:22px;height:22px;border-radius:4px;border:1px solid var(--border);background:var(--surface-3);color:var(--text-primary);cursor:pointer">+</button>';
      html += '</div></td>';
      html += '<td style="padding:8px 14px;font-size:10px;color:var(--text-tertiary);font-family:var(--mono)">' + (e.item.unit||'') + '</td>';
      html += '<td style="padding:8px 14px"><button onclick="bktRemoveModal(\'' + xe(e.item.code) + '\')" style="background:none;border:none;color:var(--danger);cursor:pointer;font-size:14px">✕</button></td>';
      html += '</tr>';
    });
    html += '</table></div>';
  });
  html += '<div style="display:flex;justify-content:space-between;align-items:center">';
  html += '<div style="font-size:13px;font-weight:700">Total: <span style="color:var(--accent);font-family:var(--mono)">' + formatSAR(grandTotal) + '</span></div></div>';
  html += '<div class="form-group"><label class="form-label">Note (optional)</label>';
  html += '<input class="form-input" id="basket-note-nx" placeholder="e.g. Weekly order — urgent"></div>';
  html += '<div style="display:flex;gap:8px">';
  html += '<button class="btn" onclick="closeModalForce()">Cancel</button>';
  html += '<button class="btn btn-primary" onclick="submitBasketNX()">✅ Submit Orders</button></div>';
  html += '</div>';
  openModal('<div class="modal-head"><h2>🧺 Review Basket</h2><button class="modal-close" onclick="closeModalForce()">✕</button></div>' + html);
}
function bktDecModal(code){if(_basket[code]){_basket[code].qty--;if(_basket[code].qty<=0){delete _basket[code];closeModalForce();openBasketModalNX();}else{var el=document.getElementById('bqnx-'+code);if(el)el.textContent=_basket[code].qty;}}}
function bktIncModal(code){if(_basket[code]){_basket[code].qty++;var el=document.getElementById('bqnx-'+code);if(el)el.textContent=_basket[code].qty;}}
function bktRemoveModal(code){delete _basket[code];closeModalForce();if(Object.keys(_basket).length)openBasketModalNX();}
function submitBasketNX(){
  var bItems3=Object.values(_basket);
  if(!bItems3.length){showToast('Basket is empty','error');return;}
  var note=(document.getElementById('basket-note-nx')||{}).value||'';
  var bySup={};
  bItems3.forEach(function(e){var sup=e.item.supplier||'No Supplier';if(!bySup[sup])bySup[sup]=[];bySup[sup].push(e);});
  var created=0;
  Object.keys(bySup).forEach(function(sup){
    var sItems=bySup[sup];
    var ordId='PO-'+Date.now()+'-'+Math.random().toString(36).slice(2,6).toUpperCase();
    var ord={id:ordId,supplier:sup,date:TODAY_BS,status:'pending',note:note,
             items:sItems.map(function(e){return{code:e.item.code,name:e.item.name,unit:e.item.unit||'',qty:e.qty,received:0};})};
    bOrders.unshift(ord);
    created++;
  });
  bSaveColl('inv_orders',bOrders);
  _basket={};
  closeModalForce();
  BS.ordTab='orders';
  showToast('✅ '+created+' purchase order'+(created!==1?'s':'')+' created!','success');
  navTo('inv-orders');
}
function openBranchOrderModal(){bOrdItems=[];var html='<div class="modal-head"><h2>New Purchase Order</h2><button class="modal-close" onclick="closeModalForce()">&#x2715;</button></div>';html+='<div class="bfg"><label class="form-label">Supplier *</label><select class="form-input form-select" id="bord-sup" onchange="bOrdSupChange(this.value)"><option value="">Select supplier</option>'+DEFAULT_SUPPLIERS.map(function(s2){return '<option>'+bxe(s2)+'</option>';}).join('')+'</select></div>';html+='<div id="bord-sup-chips" style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:12px;min-height:4px"></div>';html+='<div class="form-row"><div class="bfg"><label class="form-label">Add Any Item</label><div style="position:relative"><input class="form-input" id="bord-item-search" placeholder="Search item code or name..." oninput="invSearch(this,&apos;bord-item-sel&apos;,&apos;bord-item-drop&apos;)" autocomplete="off"><input type="hidden" id="bord-item-sel"><div id="bord-item-drop" style="position:absolute;top:100%;left:0;right:0;z-index:300;background:var(--body-bg);border:1px solid var(--border);border-radius:8px;max-height:200px;overflow-y:auto;box-shadow:0 8px 24px rgba(0,0,0,.5);display:none"></div></div></div><div class="bfg"><label class="form-label">Qty</label><input class="form-input" type="number" id="bord-qty" value="1" min="1"></div></div>';html+='<button class="btn" style="width:100%;margin-bottom:12px" onclick="bOrdAddItem()">+ Add to Order</button>';html+='<div class="bfg"><label class="form-label">Note</label><input class="form-input" id="bord-note" placeholder="Order note..."></div>';html+='<div id="bord-items-wrap" style="margin-bottom:14px"><div style="color:var(--text-tertiary);font-size:12px;text-align:center;padding:12px" id="bord-empty">No items added yet</div><table class="btbl" id="bord-tbl" style="display:none"><thead><tr><th>Code</th><th>Name</th><th>Unit</th><th>Qty</th><th></th></tr></thead><tbody id="bord-tbody"></tbody></table></div>';html+='<button class="btn btn-primary" style="width:100%" onclick="submitBranchOrder()">Create Purchase Order</button>';openModal(html);}
function bOrdSupChange(sup){var chips=document.getElementById('bord-sup-chips');if(!chips)return;chips.innerHTML='';bItems.filter(function(i){return i.supplier===sup;}).forEach(function(it){var btn=document.createElement('button');btn.className='chip';btn.style.cursor='pointer';btn.textContent=it.code+' \u2014 '+it.name;btn.onclick=function(){bOrdItems.push({code:it.code,name:it.name,unit:it.unit,qty:1,price:it.price||0,received:0});bOrdRenderTable();showToast(it.name+' added','success');};chips.appendChild(btn);});}
function bOrdAddItem(){var code=bgv('bord-item-sel'),qty=parseInt(bgv('bord-qty'))||1;var it=bfindItem(code);if(!it){showToast('Select an item first','error');return;}var ex=bOrdItems.find(function(o2){return o2.code===code;});if(ex)ex.qty+=qty;else bOrdItems.push({code:it.code,name:it.name,unit:it.unit,qty:qty,price:it.price||0,received:0});bOrdRenderTable();}
function bOrdRenderTable(){var tbl=document.getElementById('bord-tbl'),em=document.getElementById('bord-empty'),tbody=document.getElementById('bord-tbody');if(!tbl||!tbody)return;if(!bOrdItems.length){tbl.style.display='none';if(em)em.style.display='';return;}tbl.style.display='';if(em)em.style.display='none';tbody.innerHTML=bOrdItems.map(function(it,i){return '<tr><td class="bmono" style="font-size:10px;color:#228b22">'+bxe(it.code)+'</td><td>'+bxe(it.name)+'</td><td class="bmono">'+bxe(it.unit)+'</td><td class="bmono" style="font-weight:700">'+it.qty+'</td><td><button class="btn btn-sm" style="color:var(--danger)" onclick="bOrdRemove('+i+')">&#x2715;</button></td></tr>';}).join('');}
function bOrdRemove(i){bOrdItems.splice(i,1);bOrdRenderTable();}
function submitBranchOrder(){if(!bOrdItems.length){showToast('Add at least one item','error');return;}var sup=bgv('bord-sup');if(!sup){showToast('Select a supplier','error');return;}var o={id:bGenOrdId(),supplier:sup,note:bgv('bord-note'),date:TODAY_BS,status:'pending',items:bOrdItems.slice()};bOrders.unshift(o);bSaveOrders();closeModalForce();showToast('Order '+o.id+' created','success');navTo('inv-orders');}
function viewBranchOrder(id){var o=bfindOrder(id);if(!o)return;var html='<div class="modal-head"><h2>'+bxe(o.id)+'</h2><button class="modal-close" onclick="closeModalForce()">&#x2715;</button></div>';html+='<div style="margin-bottom:14px"><strong>Supplier:</strong> '+bxe(o.supplier)+'&nbsp;&nbsp;<strong>Date:</strong> '+bxe(o.date)+'&nbsp;&nbsp;'+bpl(o.status,'var(--warning)')+'</div>';html+='<table class="btbl"><thead><tr><th>Code</th><th>Name</th><th>Unit</th><th>Qty</th><th>Received</th></tr></thead><tbody>';(o.items||[]).forEach(function(it){html+='<tr><td class="bmono" style="font-size:10px;color:var(--ceo)">'+bxe(it.code)+'</td><td>'+bxe(it.name)+'</td><td class="bmono">'+bxe(it.unit)+'</td><td class="bmono" style="font-weight:700">'+it.qty+'</td><td class="bmono">'+(it.received||0)+'</td></tr>';});html+='</tbody></table>';if(o.status==='pending')html+='<button class="btn btn-primary" style="width:100%;margin-top:14px" onclick="markBranchOrderDone(\''+bxe(o.id)+'\')">Mark as Received</button>';openModal(html);}
function markBranchOrderDone(id){
  var o=bfindOrder(id);if(!o)return;
  o.status='done';
  o.completedAt=new Date().toISOString();
  (o.items||[]).forEach(function(it){it.received=it.qty;var inv=bfindItem(it.code);if(inv){inv.qty=(parseFloat(inv.qty)||0)+it.qty;bSaveStock(it.code,inv.qty);}});
  bSaveOrders();
  // ── Send to Finance: push a finance-pending invoice record ──
  if(db&&NX.session&&NX.session.branchId){
    var s=NX.session||{};
    var totalValue=0;
    (o.items||[]).forEach(function(it){
      var inv=bfindItem(it.code);
      var price=inv?parseFloat(inv.price||0):0;
      totalValue+=price*it.qty;
    });
    var finRec={
      id:o.id,
      type:'purchase_order',
      branchId:s.branchId,
      branchName:s.branchName||s.entityName||'',
      supplier:o.supplier||'',
      orderDate:o.date||TODAY_BS,
      receivedAt:o.completedAt,
      receivedBy:s.entityName||s.userName||'',
      items:(o.items||[]).map(function(it){var inv=bfindItem(it.code);return{code:it.code,name:it.name,unit:it.unit,qty:it.qty,price:inv?parseFloat(inv.price||0):0,total:(inv?parseFloat(inv.price||0):0)*it.qty};}),
      totalValue:totalValue,
      status:'pending_finance_review',
      note:o.note||''
    };
    db.ref('shared/finance_invoices/'+o.id).set(finRec,function(err){
      if(err){console.warn('Finance push failed:',err);}
    });
  }
  closeModalForce();
  showToast('Order received \u2192 stock updated \u2192 sent to Finance \u2713','success');
  navTo('inv-orders');
}
function delBranchOrder(id){if(!confirm('Delete order '+id+'?'))return;bOrders=bOrders.filter(function(o){return o.id!==id;});bSaveOrders();showToast('Deleted');navTo('inv-orders');}
function printBranchOrderPDF(id){var o=bfindOrder(id);if(!o)return;var s=NX.session||{};var rows=(o.items||[]).map(function(it,i){return '<tr style="background:'+(i%2===0?'#f9f9f9':'#fff')+'"><td style="padding:8px 10px;border:1px solid #ddd;font-family:monospace;font-size:11px">'+bxe(it.code)+'</td><td style="padding:8px 10px;border:1px solid #ddd;font-weight:600">'+bxe(it.name)+'</td><td style="padding:8px 10px;border:1px solid #ddd;text-align:center">'+bxe(it.unit)+'</td><td style="padding:8px 10px;border:1px solid #ddd;text-align:center;font-weight:700;color:#1a56c4">'+it.qty+'</td></tr>';}).join('');var html='<!DOCTYPE html><html><head><meta charset="UTF-8"><title>PO '+bxe(o.id)+'</title><style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:Arial,sans-serif;padding:20px;color:#111}@media print{button{display:none!important}@page{size:A4;margin:10mm}}</style></head><body><div style="display:flex;justify-content:space-between;border-bottom:3px solid #1a2340;padding-bottom:12px;margin-bottom:20px"><div><img src="https://i.imgur.com/jeqtcE2.png" alt="ALFA.CO" style="height:44px;width:auto;display:block"><div style="font-size:11px;color:#888">'+bxe(s.branchName||s.entityName||'')+'</div></div><div style="text-align:right"><div style="font-size:18px;font-weight:700;color:#1a56c4">PURCHASE ORDER</div><div style="font-family:monospace;font-size:13px">'+bxe(o.id)+'</div></div></div><p style="margin-bottom:16px"><strong>Supplier:</strong> '+bxe(o.supplier)+'&nbsp;&nbsp;<strong>Date:</strong> '+bxe(o.date)+'</p><table style="width:100%;border-collapse:collapse;margin-bottom:20px"><thead><tr style="background:#1a2340;color:#fff"><th style="padding:8px 10px;text-align:left">Code</th><th style="padding:8px 10px;text-align:left">Item</th><th style="padding:8px 10px;text-align:center">Unit</th><th style="padding:8px 10px;text-align:center">Qty</th></tr></thead><tbody>'+rows+'</tbody></table><div style="margin-top:30px;display:grid;grid-template-columns:1fr 1fr;gap:40px"><div style="border-top:1px solid #333;padding-top:6px;text-align:center;font-size:10px;color:#64748b">Received By / Date</div><div style="border-top:1px solid #333;padding-top:6px;text-align:center;font-size:10px;color:#64748b">Authorized By</div></div><div style="text-align:center;margin-top:20px"><button onclick="window.print()" style="background:#1a2340;color:#fff;border:none;border-radius:8px;padding:10px 28px;font-size:13px;font-weight:700;cursor:pointer">Print / Save PDF</button></div></body></html>';var w=window.open('','_blank','width=900,height=700');if(w){w.document.write(html);w.document.close();}else showToast('Allow pop-ups to print','error');}

// ── Low Stock ────────────────────────────────────────
function pLowStock(){attachBranchListeners();var low=bItems.filter(function(i){return i.min>0&&i.qty<=i.min;}).sort(function(a,b){return a.qty-b.qty;});var h='<div class="page-header"><h1>Low Stock Alerts</h1><p>'+low.length+' items at or below minimum</p></div>';if(!low.length)return h+'<div class="empty-state"><div class="es-icon">\u2705</div><h3>All stock levels OK</h3></div>';var rows=low.map(function(it){var isCrit=it.qty===0;return '<tr><td style="font-weight:600;color:var(--text-primary)">'+bxe(it.name)+'</td><td class="bmono" style="color:var(--ceo);font-size:11px">'+bxe(it.code)+'</td><td class="bmono" style="font-size:16px;font-weight:700;color:'+(isCrit?'var(--danger)':'var(--warning)')+'">'+it.qty+'</td><td class="bmono" style="color:var(--text-secondary)">'+it.min+'</td><td class="bmono">'+bxe(it.unit)+'</td><td>'+bxe(it.location||'\u2014')+'</td><td>'+bpl(isCrit?'Out':'Low',isCrit?'#c0392b':'#b45309')+'</td><td><button class="btn btn-sm btn-primary" onclick="navTo(\'inv-orders\')">Order</button></td></tr>';}).join('');return h+'<div class="btw"><div class="btw-s"><table class="btbl"><thead><tr><th>Name</th><th>Code</th><th>Qty</th><th>Min</th><th>Unit</th><th>Location</th><th>Status</th><th>Action</th></tr></thead><tbody>'+rows+'</tbody></table></div></div>';}

// ── Monthly Report ───────────────────────────────────
function pInvReport(){
  attachBranchListeners();
  var mo=BS._invReportMo||0;
  var tm=bmthKey(mo);
  var moLabel=new Date(tm+'-01').toLocaleDateString('en-GB',{month:'long',year:'numeric'});
  var totalValue=bItems.reduce(function(a,i){return a+(i.qty*(parseFloat(i.price)||0));},0);
  var received=bLogs.filter(function(l){return l.type==='receive'&&(l.date||'').indexOf(tm)===0;}).reduce(function(a,l){return a+(+l.qty||0);},0);
  var issued=bLogs.filter(function(l){return l.type==='issue'&&(l.date||'').indexOf(tm)===0;}).reduce(function(a,l){return a+(+l.qty||0);},0);
  var wasteVal=BS.waste.filter(function(w){return(w.date||'').indexOf(tm)===0;}).reduce(function(a,w){return a+(+w.value||0);},0);
  var h='<div class="page-header"><h1>Monthly Inventory Report</h1><p>'+moLabel+'</p></div>';
  h+='<div class="header-actions" style="margin-bottom:14px">';
  h+='<button class="btn btn-sm" onclick="BS._invReportMo=(BS._invReportMo||0)-1;navTo(\'inv-report\')">← Prev</button>';
  h+='<span class="bmono" style="font-size:12px;padding:0 12px;color:var(--text-secondary)">'+moLabel+'</span>';
  h+='<button class="btn btn-sm" onclick="BS._invReportMo=Math.min(0,(BS._invReportMo||0)+1);navTo(\'inv-report\')">Next →</button>';
  h+='<button class="btn" onclick="showToast(\'Exporting\u2026\',\'success\')">\u2b07 Export PDF</button>';
  h+='</div>';
  h+='<div class="bgrid-4" style="margin-bottom:20px">';
  h+='<div class="bsc"><div class="bsc-lbl">Stock Value</div><div class="bsc-val bcgold">'+bfsar(totalValue)+'</div><div class="bsc-sub">'+bItems.length+' items</div></div>';
  h+='<div class="bsc"><div class="bsc-lbl">Received</div><div class="bsc-val bcg">'+received+' units</div></div>';
  h+='<div class="bsc"><div class="bsc-lbl">Issued / Pull-Out</div><div class="bsc-val bca">'+issued+' units</div></div>';
  h+='<div class="bsc"><div class="bsc-lbl">Wastage Value</div><div class="bsc-val bcr">'+bfsar(wasteVal)+'</div></div>';
  h+='</div>';
  var card='background:var(--surface-1);border-radius:12px;padding:16px;margin-bottom:16px;border:1px solid var(--border)';
  var secHdr='font-size:11px;font-weight:700;color:var(--text-secondary);text-transform:uppercase;letter-spacing:.08em;margin-bottom:12px';
  h+='<div style="'+card+'">';
  h+='<div style="'+secHdr+'">\ud83d\udccb Item Reconciliation \u2014 '+moLabel+'</div>';
  h+='<div style="font-size:11px;color:var(--text-tertiary);margin-bottom:12px">Opening + Received + PO \u2212 Wastage \u2212 Pull-Out = Calculated Ending &nbsp;|\u00a0 Enter physical count to see variance</div>';
  h+='<div class="btw"><div class="btw-s"><table class="btbl"><thead><tr>';
  h+='<th>Code</th><th>Item</th><th>Unit</th>';
  h+='<th style="text-align:right;color:#0057ff">Opening</th>';
  h+='<th style="text-align:right;color:#00875a">+Received</th>';
  h+='<th style="text-align:right;color:#00875a">+PO</th>';
  h+='<th style="text-align:right;color:#c0392b">\u2212Wastage</th>';
  h+='<th style="text-align:right;color:#c0392b">\u2212Pull-Out</th>';
  h+='<th style="text-align:right;color:var(--ceo)">=Calculated</th>';
  h+='<th style="text-align:center;min-width:110px">Physical Count</th>';
  h+='<th style="text-align:center">Variance</th>';
  h+='</tr></thead><tbody>';
  var ec=BS.endingCounts||(BS.endingCounts={});
  var moEC=ec[tm]||(ec[tm]={});
  var allTally=true;
  bItems.forEach(function(it){
    var iid=it.id||it.code;
    var prevMo=bmthKey(mo-1);
    var prevEC=ec[prevMo]&&ec[prevMo][iid];
    var prevEndQty=prevEC!=null?parseFloat(prevEC):null;
    var recvQty=bLogs.filter(function(l){return l.type==='receive'&&l.itemId===iid&&(l.date||'').indexOf(tm)===0;}).reduce(function(a,l){return a+(+l.qty||0);},0);
    var poQty=bLogs.filter(function(l){return l.type==='po'&&l.itemId===iid&&(l.date||'').indexOf(tm)===0;}).reduce(function(a,l){return a+(+l.qty||0);},0);
    var wasteQty=BS.waste.filter(function(w){return w.itemId===iid&&(w.date||'').indexOf(tm)===0;}).reduce(function(a,w){return a+(+w.qty||0);},0);
    var pullQty=bLogs.filter(function(l){return l.type==='issue'&&l.itemId===iid&&(l.date||'').indexOf(tm)===0;}).reduce(function(a,l){return a+(+l.qty||0);},0);
    var openQty=prevEndQty!=null?prevEndQty:Math.max(0,Math.round((it.qty-recvQty-poQty+wasteQty+pullQty)*100)/100);
    var calcEnd=Math.round((openQty+recvQty+poQty-wasteQty-pullQty)*100)/100;
    var physVal=moEC[iid];
    var physQty=physVal!=null?parseFloat(physVal):null;
    var variance=physQty!=null?Math.round((physQty-calcEnd)*100)/100:null;
    var isTally=variance!=null&&Math.abs(variance)<0.01;
    if(physQty!=null&&!isTally)allTally=false;
    var varCell='<span style="color:var(--text-tertiary);font-size:11px">\u2014</span>';
    if(variance!=null){
      var vc=isTally?'#00875a':Math.abs(variance)<1?'#b45309':'#c0392b';
      var vl=isTally?'\u2713 Tally':(variance>0?'+':'')+variance+' '+(it.unit||'');
      varCell='<span style="font-weight:700;color:'+vc+'">'+vl+'</span>';
    }
    h+='<tr>';
    h+='<td class="bmono" style="font-size:10px;color:#228b22">'+bxe(it.code)+'</td>';
    h+='<td style="color:var(--text-primary);font-weight:600">'+bxe(it.name)+'</td>';
    h+='<td style="color:var(--text-tertiary);font-size:11px">'+bxe(it.unit||'\u2014')+'</td>';
    h+='<td class="bmono" style="text-align:right;color:#0057ff">'+openQty+'</td>';
    h+='<td class="bmono" style="text-align:right;color:#00875a">'+recvQty+'</td>';
    h+='<td class="bmono" style="text-align:right;color:#00875a">'+poQty+'</td>';
    h+='<td class="bmono" style="text-align:right;color:#c0392b">'+wasteQty+'</td>';
    h+='<td class="bmono" style="text-align:right;color:#c0392b">'+pullQty+'</td>';
    h+='<td class="bmono" style="text-align:right;font-weight:700;color:var(--ceo)">'+calcEnd+'</td>';
    h+='<td style="text-align:center"><input type="number" min="0" step="0.01" value="'+(physQty!=null?physQty:'')+'" placeholder="Count" onchange="invSaveEndingCount(\''+iid+'\',\''+tm+'\',this.value)" style="width:84px;text-align:center;background:var(--surface-2);border:1px solid var(--border);border-radius:6px;padding:4px 6px;color:var(--text-primary);font-size:12px;font-family:var(--mono);outline:none"></td>';
    h+='<td style="text-align:center">'+varCell+'</td>';
    h+='</tr>';
  });
  h+='</tbody></table></div></div>';
  if(bItems.length>0){
    var counted=bItems.filter(function(it){return moEC[it.id||it.code]!=null;}).length;
    var sc=counted<bItems.length?'#b45309':allTally?'#b45309':'#c0392b';
    var sl=counted<bItems.length?(counted+'/'+bItems.length+' items counted'):allTally?'\u2713 All items tally':('\u26a0 Variance found in some items');
    var si=counted<bItems.length?'\ud83d\udcca':allTally?'\u2705':'\u26a0\ufe0f';
    h+='<div style="margin-top:10px;padding:12px 16px;border-radius:10px;background:'+sc+'18;border:1px solid '+sc+'40;display:flex;align-items:center;gap:10px">';
    h+='<span style="font-size:18px">'+si+'</span>';
    h+='<div><div style="font-weight:700;color:'+sc+'">'+sl+'</div>';
    h+='<div style="font-size:11px;color:var(--text-tertiary);margin-top:2px">'+counted+' of '+bItems.length+' items physically counted this month</div></div></div>';
  }
  h+='</div>';
  h+='<div style="'+card+'">';
  h+='<div style="'+secHdr+'">\ud83d\udce6 Current Stock Levels</div>';
  h+='<div class="btw"><div class="btw-s"><table class="btbl"><thead><tr><th>Code</th><th>Name</th><th>Location</th><th>Qty</th><th>Unit</th><th>Min</th><th>Value SAR </th><th>Status</th></tr></thead><tbody>';
  bItems.forEach(function(it){
    var isLow=it.min>0&&it.qty<=it.min;
    h+='<tr><td class="bmono" style="font-size:10px;color:var(--ceo)">'+bxe(it.code)+'</td><td style="color:var(--text-primary)">'+bxe(it.name)+'</td><td>'+bxe(it.location||'\u2014')+'</td><td class="bmono" style="font-weight:700;color:'+(isLow?'var(--danger)':'var(--text-primary)')+'">'+it.qty+'</td><td class="bmono">'+bxe(it.unit)+'</td><td class="bmono" style="color:var(--text-tertiary)">'+it.min+'</td><td class="bmono">'+bfsar(it.qty*parseFloat(it.price||0))+'</td><td>'+bpl(isLow?'Low':'OK',isLow?'#c0392b':'#00875a')+'</td></tr>';
  });
  h+='</tbody></table></div></div></div>';
  return h;
}
function invSaveEndingCount(id,month,val){
  if(!BS.endingCounts)BS.endingCounts={};
  if(!BS.endingCounts[month])BS.endingCounts[month]={};
  var n=parseFloat(val);
  if(isNaN(n)||val===''){delete BS.endingCounts[month][id];}
  else{BS.endingCounts[month][id]=n;}
  if(db&&NX.session&&NX.session.branchId){
    db.ref(bPath('endingCounts')+'/'+month+'/'+id).set(isNaN(n)||val===''?null:n);
  }
  navTo('inv-report');
}

// ── Wastage ──────────────────────────────────────────
function pWastage(){
  attachBranchListeners();
  var data=BS.waste.filter(function(w){return bmatch(w,['item','by','reason']);}).slice().sort(function(a,b){return(b.date||'').localeCompare(a.date||'');});
  var tot=0;data.forEach(function(w){tot+=(+w.value||0);});
  var tc=BS.waste.filter(function(w){return w.date===TODAY_BS;}).length;
  var rows=data.map(function(w){
    var hasRecipe=!!(w.recipeId);
    var costBadge=hasRecipe
      ?'<span style="font-size:9px;background:rgba(0,102,102,.12);color:#006666;padding:1px 6px;border-radius:10px;font-weight:700">AUTO</span>'
      :'<span style="font-size:9px;background:rgba(180,83,9,.1);color:#b45309;padding:1px 6px;border-radius:10px">EST</span>';
    return '<tr>'+
      '<td class="bmono" style="color:var(--text-tertiary);font-size:11px">'+bfdate(w.date)+'</td>'+
      '<td style="font-weight:600;color:var(--text-primary)">'+bxe(w.item)+(w.recipeCode?'<div style="font-size:9px;color:var(--text-tertiary);font-family:monospace">'+bxe(w.recipeCode)+'</div>':'')+'</td>'+
      '<td class="bmono">'+bxe(w.qty)+' '+bxe(w.unit||'')+'</td>'+
      '<td>'+bpl(w.reason||'\u2014','#c0392b')+'</td>'+
      '<td class="bmono" style="color:var(--danger);font-weight:600">'+bfsar(w.value)+' '+costBadge+'</td>'+
      '<td style="color:var(--text-secondary)">'+bxe(w.by||'\u2014')+'</td>'+
      '<td><button class="btn btn-sm" style="color:var(--danger)" onclick="delBranchWaste(\''+bxe(w.id)+'\')">Del</button></td>'+
    '</tr>';
  }).join('');
  var h='<div class="page-header"><h1>Wastage Log</h1></div>';
  h+='<div class="bgrid-3" style="margin-bottom:16px">';
  h+='<div class="bsc"><div class="bsc-lbl">Total Entries</div><div class="bsc-val bca">'+BS.waste.length+'</div></div>';
  h+='<div class="bsc"><div class="bsc-lbl">Today</div><div class="bsc-val" style="color:#b45309">'+tc+'</div></div>';
  h+='<div class="bsc"><div class="bsc-lbl">Cumulative Loss</div><div class="bsc-val bcr">'+bfsar(tot)+'</div></div>';
  h+='</div>';
  h+='<div class="header-actions"><div></div><button class="btn btn-primary" onclick="openBranchWastageModal()">+ Log Wastage</button></div>';
  return h+'<div class="btw"><div class="btw-s"><table class="btbl"><thead><tr><th>Date</th><th>Item</th><th>Qty</th><th>Reason</th><th>Cost</th><th>By</th><th></th></tr></thead><tbody>'+(rows||'<tr><td colspan="7" style="text-align:center;color:var(--text-tertiary);padding:28px">No wastage entries</td></tr>')+'</tbody></table></div></div>';
}
function openBranchWastageModal(){
  var so='<option value="">\u2014</option>'+BS.staff.map(function(s2){return '<option>'+bxe(s2.name)+'</option>';}).join('');
  var html='<div class="modal-head"><h2>Log Wastage</h2><button class="modal-close" onclick="closeModalForce()">&#x2715;</button></div>';
  html+='<div class="form-row">';
  html+='<div class="bfg"><label class="form-label">Date</label><input class="form-input" type="date" id="bw-date" value="'+TODAY_BS+'"></div>';
  html+='<div class="bfg"><label class="form-label">Reported By</label><select class="form-input form-select" id="bw-by">'+so+'</select></div>';
  html+='</div>';
  html+='<div class="bfg" style="position:relative">';
  html+='<label class="form-label">Item Name * <span id="bw-inv-tag" style="display:none;background:rgba(0,102,102,.12);color:#006666;font-size:9px;padding:2px 7px;border-radius:6px;font-family:monospace;margin-left:6px"></span></label>';
  html+='<input class="form-input" id="bw-item" placeholder="Type to search inventory\u2026" autocomplete="off" oninput="bwFilterInv(this.value)">';
  html+='<div id="bw-inv-drop" style="display:none;position:absolute;left:0;right:0;top:100%;background:var(--surface-1,#f4f2f1);border-radius:10px;box-shadow:0 8px 28px rgba(0,0,0,.18);z-index:999;max-height:220px;overflow-y:auto;margin-top:3px"></div>';
  html+='<input type="hidden" id="bw-inv-code">';
  html+='</div>';
  html+='<div class="form-row">';
  html+='<div class="bfg"><label class="form-label">Reason</label><select class="form-input form-select" id="bw-reason"><option value="">\u2014</option>'+WR.map(function(r){return '<option>'+bxe(r)+'</option>';}).join('')+'</select></div>';
  html+='<div class="bfg"><label class="form-label">Unit</label><input class="form-input" id="bw-unit" placeholder="kg, pcs\u2026" readonly style="color:var(--text-secondary)"></div>';
  html+='</div>';
  html+='<div class="form-row">';
  html+='<div class="bfg"><label class="form-label">Qty Wasted *</label><input class="form-input" type="number" id="bw-qty" step="0.001" placeholder="0" oninput="bwRecalcCost()"></div>';
  html+='<div class="bfg"><label class="form-label">Unit Cost (SAR)</label><input class="form-input" type="number" id="bw-unit-cost" step="0.0001" placeholder="Auto from inventory" oninput="bwRecalcCost()"></div>';
  html+='</div>';
  html+='<div style="background:var(--surface-2);border-radius:10px;padding:12px 14px;margin-bottom:12px;display:flex;gap:14px;flex-wrap:wrap;align-items:center">';
  html+='<div style="flex:1;min-width:130px"><div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:var(--text-tertiary);margin-bottom:3px">Auto-Calculated Cost</div>';
  html+='<div id="bw-cost-display" style="font-size:22px;font-weight:700;font-family:var(--mono);color:var(--danger)">SAR 0.00</div>';
  html+='<div id="bw-cost-note" style="font-size:10px;color:var(--text-tertiary);font-family:var(--mono);margin-top:2px">Select item &amp; enter qty</div></div>';
  html+='<div style="flex:1;min-width:130px"><div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:var(--text-tertiary);margin-bottom:3px">Override Total (SAR)</div>';
  html+='<input class="form-input" type="number" id="bw-val" step="0.01" placeholder="Leave blank \u2013 use auto" oninput="bwUpdateDisplay()"></div>';
  html+='</div>';
  html+='<button class="btn btn-primary" style="width:100%" onclick="saveBranchWastage()">Log Wastage</button>';
  openModal(html);
  setTimeout(function(){
    document.addEventListener('click',function _bwOuter(e){
      var drop=document.getElementById('bw-inv-drop');
      if(drop&&!drop.contains(e.target)&&e.target.id!=='bw-item')drop.style.display='none';
      if(!document.getElementById('bw-item'))document.removeEventListener('click',_bwOuter);
    });
  },100);
}
function bwFilterInv(q){
  var drop=document.getElementById('bw-inv-drop');
  if(!drop)return;
  q=(q||'').toLowerCase().trim();
  if(!q){drop.style.display='none';return;}
  var src=bItems&&bItems.length?bItems:[];
  var filtered=src.filter(function(i){
    return i&&((i.name||'').toLowerCase().indexOf(q)>=0||(i.code||'').toLowerCase().indexOf(q)>=0);
  }).slice(0,12);
  if(!filtered.length){
    drop.innerHTML='<div style="padding:14px;text-align:center;font-size:11px;color:var(--text-tertiary)">No items found</div>';
    drop.style.display='block';return;
  }
  window._bwDropItems=filtered;
  drop.innerHTML=filtered.map(function(it,idx){
    var price=parseFloat(it.price||0);
    return '<div onclick="bwPickInvItem('+idx+')" style="padding:10px 14px;cursor:pointer;border-bottom:1px solid rgba(0,0,0,.06);transition:background .1s" onmouseover="this.style.background=\'rgba(0,102,102,.07)\'" onmouseout="this.style.background=\'\'">'
      +'<div style="font-weight:700;font-size:12px;color:var(--text-primary)">'+bxe(it.name||'')+'</div>'
      +'<div style="font-size:10px;color:var(--text-tertiary);font-family:monospace;margin-top:2px">'+bxe(it.code||'\u2014')+' \u00b7 '+bxe(it.unit||'ea')+' \u00b7 SAR\xa0'+price.toFixed(4)+'/unit</div>'
      +'</div>';
  }).join('');
  drop.style.display='block';
}
function bwPickInvItem(idx){
  var it=(window._bwDropItems||[])[idx];
  if(!it)return;
  var nameEl=document.getElementById('bw-item');
  var unitEl=document.getElementById('bw-unit');
  var costEl=document.getElementById('bw-unit-cost');
  var codeEl=document.getElementById('bw-inv-code');
  var tagEl=document.getElementById('bw-inv-tag');
  if(nameEl)nameEl.value=it.name||'';
  if(unitEl)unitEl.value=it.unit||'ea';
  if(costEl)costEl.value=parseFloat(it.price||0).toFixed(4);
  if(codeEl)codeEl.value=String(it.code||'');
  if(tagEl){tagEl.textContent=it.code||'';tagEl.style.display='inline';}
  var drop=document.getElementById('bw-inv-drop');
  if(drop)drop.style.display='none';
  bwRecalcCost();
}
function bwRecalcCost(){
  var qty=parseFloat((document.getElementById('bw-qty')||{}).value)||0;
  var unitCost=parseFloat((document.getElementById('bw-unit-cost')||{}).value)||0;
  var disp=document.getElementById('bw-cost-display');
  var noteEl=document.getElementById('bw-cost-note');
  var total=qty*unitCost;
  if(disp)disp.textContent='SAR\xa0'+total.toFixed(2);
  if(noteEl){
    if(qty>0&&unitCost>0)noteEl.textContent=qty+' \u00d7 SAR\xa0'+unitCost.toFixed(4)+' = SAR\xa0'+total.toFixed(2);
    else noteEl.textContent='Select item & enter qty';
  }
  var ov=document.getElementById('bw-val');
  if(ov&&!ov.value&&total>0)ov.value=total.toFixed(2);
}
function bwUpdateDisplay(){var v=parseFloat((document.getElementById('bw-val')||{}).value)||0;var disp=document.getElementById('bw-cost-display');if(disp)disp.textContent='SAR\xa0'+v.toFixed(2);}
function saveBranchWastage(){
  var item=bgv('bw-item'),qty=parseFloat(bgv('bw-qty'))||0;
  if(!item||qty<=0){showToast('Item and quantity required','error');return;}
  var unitCost=parseFloat(bgv('bw-unit-cost'))||0;
  var autoCost=qty*unitCost;
  var overrideVal=parseFloat(bgv('bw-val'))||0;
  var finalCost=overrideVal>0?overrideVal:autoCost;
  var invCode=bgv('bw-inv-code')||'';
  BS.waste.push({id:buid(),date:bgv('bw-date')||TODAY_BS,item:item,qty:qty,unit:bgv('bw-unit'),reason:bgv('bw-reason'),value:finalCost,unitCost:unitCost,invCode:invCode,by:bgv('bw-by')});
  if(invCode&&db&&NX.session&&NX.session.branchId){
    var safeCode=String(invCode).replace(/[.#$\[\]\/]/g,'_');
    var stockRef=db.ref('branches/'+NX.session.branchId+'/stock/'+safeCode);
    stockRef.once('value',function(snap){
      var cur=parseFloat((snap.val()||{}).qty||0)||0;
      stockRef.update({qty:Math.max(0,parseFloat((cur-qty).toFixed(4)))});
    });
  }
  bSaveColl('waste',BS.waste);
  closeModalForce();
  showToast('Wastage logged \u2014 Cost: '+bfsar(finalCost),'success');
  navTo('wastage');
}

function delBranchWaste(id){if(!confirm('Delete this wastage entry?'))return;BS.waste=BS.waste.filter(function(w){return w.id!==id;});bSaveColl('waste',BS.waste);showToast('Deleted');navTo('wastage');}

// ── Staff ─────────────────────────────────────────────
function pStaff() {
  attachBranchListeners();
  var sess=NX.session||{};
  var canEdit=(sess.role==='hr_manager'||sess.role==='super_admin'||sess.role==='ceo');
  // Branch Managers can add if HR has granted permission for this branch
  var bmCanAdd=false;
  if(sess.role==='branch_mgr'&&sess.branchId){
    var _perms=(typeof HRF_BRANCH_PERMS!=='undefined'?HRF_BRANCH_PERMS:{});
    bmCanAdd=!!(_perms[sess.branchId]&&_perms[sess.branchId].canAddStaff);
    // Also check live from Firebase cache in BS
    if(!bmCanAdd&&BS._branchPerms)bmCanAdd=!!(BS._branchPerms.canAddStaff);
  }
  var now=new Date(),todayName=DAYS_WEEK[now.getDay()];
  var act=0,lv=0,oth=0;BS.staff.forEach(function(m){if(m.status==='Active')act++;else if(m.status==='On Leave')lv++;else oth++;});
  var dbt='';['All'].concat(DEPTS).forEach(function(d){dbt+='<button class="bfbt'+(BS.fd===d?' on':'')+'" onclick="BS.fd=\''+d+'\';navTo(\'staff\')">'+bxe(d)+'</button>';});
  var rows='';
  BS.staff.forEach(function(m){
    if(BS.fd!=='All'&&normalizeDept(m.dept)!==BS.fd)return;
    if(BS._roleFilter&&BS._roleFilter!=='All'&&m.role!==BS._roleFilter)return;
    if(!bmatch(m,['name','role','phone','sap']))return;
    var sc=m.status==='Active'?'#00875a':m.status==='On Leave'?'#c0392b':'#94a3b8';
    var wk2=bweekKey(),sc2=BS.sch[wk2]||{},ms=sc2[m.id]||{};
    var todayShift=ms[todayName]||m.shift||'\u2014';
    var shCol=todayShift.toUpperCase()==='OFF'||todayShift.toUpperCase()==='DAY OFF'?'#b45309':'var(--ceo)';
    var actionsHtml;
    if(canEdit){
      actionsHtml='<div style="display:flex;gap:4px"><button class="btn btn-sm" onclick="openBranchStaffModal(\''+bxe(m.id)+'\')">Edit</button><button class="btn btn-sm" style="color:var(--danger)" onclick="delBranchStaff(\''+bxe(m.id)+'\')">Del</button><button class="btn btn-sm" style="color:#c084fc" data-staffid="'+bxe(m.id)+'" onclick="openNXTransferStaffModal(this.dataset.staffid)">Transfer</button></div>';
    } else {
      // Branch Manager: read-only + transfer request only
      actionsHtml='<div style="display:flex;gap:4px"><button class="btn btn-sm" style="color:#c084fc" data-staffid="'+bxe(m.id)+'" onclick="openNXTransferStaffModal(this.dataset.staffid)">Transfer</button></div>';
    }
    rows+='<tr><td><div style="display:flex;align-items:center;gap:10px"><div class="bav">'+bini(m.name)+'</div><div><div style="font-weight:600;font-size:12px">'+bxe(m.name)+'</div><div style="font-size:10px;color:var(--text-tertiary)">'+bxe(m.role||'No role')+'</div></div></div></td><td>'+bpl(m.dept||'\u2014',bdc(m.dept||'FOH'))+'</td><td class="bmono" style="color:'+shCol+';font-size:12px;font-weight:600">'+bxe(todayShift)+'</td><td>'+bpl(m.status,sc)+'</td><td class="bmono" style="color:var(--text-tertiary);font-size:11px">'+bxe(m.sap||'\u2014')+'</td><td style="font-size:11px">'+(m.phone?'<a href="tel:'+bxe(m.phone)+'" style="color:var(--ceo);text-decoration:none">'+bxe(m.phone)+'</a>':'<span style="color:var(--text-tertiary)">\u2014</span>')+'</td><td>'+actionsHtml+'</td></tr>';
  });
  var h='<div style="display:flex;align-items:center;gap:10px;margin-bottom:14px;flex-wrap:wrap"><span style="font-size:10px;color:var(--text-tertiary);text-transform:uppercase;letter-spacing:.1em">Dept</span><div style="display:flex;gap:4px">'+dbt+'</div>';
  h+='<select class="bfi" style="width:auto" id="bstaff-rf"><option value="All">All Roles</option>'+ROLES.map(function(r){return '<option value="'+bxe(r)+'"'+(BS._roleFilter===r?' selected':'')+'>'+bxe(r)+'</option>';}).join('')+'</select>';
  h+='<button class="btn btn-sm" onclick="BS._roleFilter=\'All\';navTo(\'staff\')">Clear</button></div>';
  h+='<div class="bgrid-4" style="margin-bottom:14px"><div class="bsc"><div class="bsc-lbl">Total</div><div class="bsc-val bca">'+BS.staff.length+'</div></div><div class="bsc"><div class="bsc-lbl">Active</div><div class="bsc-val bcg">'+act+'</div></div><div class="bsc"><div class="bsc-lbl">On Leave</div><div class="bsc-val bcr">'+lv+'</div></div><div class="bsc"><div class="bsc-lbl">Other</div><div class="bsc-val" style="color:var(--text-secondary)">'+oth+'</div></div></div>';
  if(canEdit){
    h+='<div class="header-actions"><div></div><button class="btn btn-primary" onclick="openBranchStaffModal(null)">+ Add Staff</button></div>';
  } else if(bmCanAdd) {
    h+='<div class="header-actions"><div></div><button class="btn btn-primary" onclick="openBranchStaffModal(null)">+ Add Staff</button></div>';
  } else {
    h+='<div style="background:rgba(167,139,250,.08);border:1px solid rgba(167,139,250,.25);border-radius:9px;padding:10px 14px;margin-bottom:14px;font-size:12px;color:var(--text-secondary);display:flex;align-items:center;gap:10px"><span style="font-size:16px">&#x1F512;</span><div>Adding, editing, and removing staff is managed by HR. Use <strong>Transfer</strong> to request a staff move between branches.</div></div>';
  }
  h+='<div class="btw"><div class="btw-s"><table class="btbl"><thead><tr><th>Name / Role</th><th>Dept</th><th>Shift ('+bxe(todayName)+')</th><th>Status</th><th>SAP #</th><th>Phone</th><th>Actions</th></tr></thead><tbody>'+(rows||'<tr><td colspan="7" style="text-align:center;color:var(--text-tertiary);padding:28px">No staff found</td></tr>')+'</tbody></table></div></div>';
  setTimeout(function(){var rf=document.getElementById('bstaff-rf');if(rf)rf.onchange=function(){BS._roleFilter=this.value;navTo('staff');};},0);
  // Firebase Check-In Staff Manager (admin only)
  if(canEdit&&sess.branchId){
    h+='<div class="card section" style="margin-top:18px">';
    h+='<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">';
    h+='<div><h3 style="font-size:13px;font-weight:700;color:var(--text-primary);margin:0">&#x1F527; Firebase Check-In Staff List</h3>';
    h+='<p style="font-size:11px;color:var(--text-secondary);margin:2px 0 0">Staff visible in Check-In &amp; Leave Request portals</p></div>';
    h+='<button class="btn btn-sm" onclick="fbStaffMgrLoad()">&#x21BB; Refresh</button>';
    h+='</div>';
    h+='<div id="fb-staff-mgr-wrap"><div style="text-align:center;padding:20px;color:var(--text-secondary);font-size:12px">Loading...</div></div>';
    h+='</div>';
    setTimeout(fbStaffMgrLoad, 100);
  }
  return h;
}
function fbStaffMgrLoad(){
  var sess=NX.session||{};
  if(!sess.branchId||!db)return;
  var wrap=document.getElementById('fb-staff-mgr-wrap');
  if(!wrap)return;
  wrap.innerHTML='<div style="text-align:center;padding:16px;color:var(--text-secondary);font-size:12px">&#x23F3; Loading Firebase staff...</div>';
  db.ref('branches/'+sess.branchId+'/tsEmps').once('value',function(snap){
    var raw=snap.val();
    var emps=!raw?[]:(Array.isArray(raw)?raw.filter(Boolean):Object.values(raw).filter(Boolean));
    emps.sort(function(a,b){return (a.name||'').localeCompare(b.name||'');});
    if(!emps.length){wrap.innerHTML='<div style="text-align:center;padding:20px;color:var(--text-secondary);font-size:12px">No staff found in Firebase Check-In list.</div>';return;}
    var tbl='<table class="btbl"><thead><tr><th>Name</th><th>Dept</th><th>ID</th><th style="text-align:center">Remove from Portal</th></tr></thead><tbody>';
    emps.forEach(function(e){
      var eid=String(e.id||'');
      var ename=String(e.name||'');
      tbl+='<tr><td style="font-weight:600">'+bxe(ename)+'</td><td>'+bxe(e.dept||'—')+'</td><td style="font-family:var(--mono);font-size:11px;color:var(--text-secondary)">'+bxe(eid)+'</td>';
      tbl+='<td style="text-align:center"><button class="btn btn-sm" style="color:var(--danger)" data-eid="'+bxe(eid)+'" data-ename="'+bxe(ename)+'" onclick="fbStaffMgrDel(this.dataset.eid,this.dataset.ename)" title="Remove from Firebase Check-In list">&#x1F5D1; Delete</button></td></tr>';
    });
    tbl+='</tbody></table>';
    tbl+='<p style="font-size:10px;color:var(--text-secondary);margin-top:8px">Deleting here removes the person from the Check-In and Leave Request portals immediately.</p>';
    wrap.innerHTML=tbl;
  },function(err){wrap.innerHTML='<div style="color:var(--danger);font-size:12px;padding:12px">Error loading Firebase staff: '+bxe(String(err))+'</div>';});
}
function fbStaffMgrDel(empId,empName){
  var sess=NX.session||{};
  if(!sess.branchId||!db)return;
  if(!confirm('Remove '+empName+' from the Check-In and Leave Request portal?\n\nThis does NOT delete them from the Staff Directory.'))return;
  db.ref('branches/'+sess.branchId+'/tsEmps').once('value',function(snap){
    var raw=snap.val();
    var emps=!raw?[]:(Array.isArray(raw)?raw.filter(Boolean):Object.values(raw).filter(Boolean));
    var filtered=emps.filter(function(e){return String(e.id)!==String(empId);});
    db.ref('branches/'+sess.branchId+'/tsEmps').set(filtered.length?filtered:null,function(err){
      if(err){showToast('Error: '+err,'error');return;}
      // Also update local BS state
      BS.tsEmps=BS.tsEmps.filter(function(e){return String(e.id)!==String(empId);});
      showToast(empName+' removed from portal ✓','success');
      fbStaffMgrLoad();
    });
  });
}
function openBranchStaffModal(id){
  var sess=NX.session||{};
  var allowedRoles=['hr_manager','super_admin','ceo','branch_mgr'];
  if(allowedRoles.indexOf(sess.role)<0){
    showToast('You do not have permission to add or edit staff','error');return;
  }
  var m=id?BS.staff.find(function(x){return x.id===id;}):null;
  var now=new Date(); var mkey=now.getFullYear()+'-'+String(now.getMonth()+1).padStart(2,'0');
  var kpi=m&&m.kpiScores&&m.kpiScores[mkey]!==undefined?m.kpiScores[mkey]:'';
  var html='<div class="modal-head"><h2>'+(m?'Edit Staff':'Add Staff')+'</h2><button class="modal-close" onclick="closeModalForce()">&#x2715;</button></div>';
  html+='<div class="form-row"><div class="bfg"><label class="form-label">Full Name *</label><input class="form-input" id="bst-name" value="'+bxe(m?m.name:'')+'" dir="auto"></div><div class="bfg"><label class="form-label">SAP #</label><input class="form-input" id="bst-sap" value="'+bxe(m?m.sap||'':'')+'"></div></div>';
  html+='<div class="form-row"><div class="bfg"><label class="form-label">Department *</label><select class="form-input form-select" id="bst-dept"><option value="">\u2026</option>'+bselOpts(DEPTS,m?m.dept:'')+'</select></div><div class="bfg"><label class="form-label">Role</label><select class="form-input form-select" id="bst-role"><option value="">\u2026</option>'+bselOpts(ROLES,m?m.role:'')+'</select></div></div>';
  html+='<div class="form-row"><div class="bfg"><label class="form-label">Status</label><select class="form-input form-select" id="bst-status"><option value="">\u2026</option>'+bselOpts(STATS,m?m.status:'Active')+'</select></div><div class="bfg"><label class="form-label">Phone</label><input class="form-input" type="tel" id="bst-phone" value="'+bxe(m?m.phone||'':'')+'" placeholder="+966\u2026"></div></div>';
  html+='<div class="form-row"><div class="bfg"><label class="form-label">Email</label><input class="form-input" type="email" id="bst-email" value="'+bxe(m?m.email||'':'')+'" placeholder="name@example.com"></div><div class="bfg"><label class="form-label">Default Shift</label><input class="form-input" id="bst-shift" value="'+bxe(m?m.shift||'':'')+'" placeholder="e.g. 9AM\u20135PM"></div></div>';
  html+='<div class="form-row"><div class="bfg"><label class="form-label">Contract Type</label><select class="form-input form-select" id="bst-contract"><option value="">\u2026</option>'+bselOpts(['Full-time','Part-time','Seasonal','Trainee'],m?m.contractType||'':'')+'</select></div><div class="bfg"><label class="form-label">Join Date</label><input class="form-input" type="date" id="bst-join" value="'+bxe(m?m.joinDate||'':'')+'"></div></div>';
  html+='<div class="form-row"><div class="bfg"><label class="form-label">KPI Score '+mkey+' (0\u2013100)</label><input class="form-input" type="number" id="bst-kpi" min="0" max="100" value="'+bxe(String(kpi))+'" placeholder="Score this month"></div><div class="bfg"><label class="form-label">Probation Status</label><select class="form-input form-select" id="bst-prob"><option value="">None</option>'+bselOpts(['On Probation','Probation Passed','Probation Failed'],m?m.probationStatus||'':'')+'</select></div></div>';
  html+='<div class="bfg"><label class="form-label">Notes</label><input class="form-input" id="bst-notes" value="'+bxe(m?m.notes||'':'')+'" placeholder="Internal notes\u2026"></div>';
  html+='<button class="btn btn-primary" style="width:100%;margin-top:10px" onclick="saveBranchStaff(\''+bxe(id||'')+'\')">'+(m?'Save Changes':'Add Staff Member')+'</button>';
  openModal(html);
}
function saveBranchStaff(id){
  var sess=NX.session||{};
  var allowedRoles=['hr_manager','super_admin','ceo','branch_mgr'];
  if(allowedRoles.indexOf(sess.role)<0){
    showToast('You do not have permission to save staff changes','error');closeModalForce();return;
  }
  var name=bgv('bst-name'),dept=normalizeDept(bgv('bst-dept'));
  if(!name||!dept){showToast('Name and department required','error');return;}
  var now=new Date(); var mkey=now.getFullYear()+'-'+String(now.getMonth()+1).padStart(2,'0');
  var kpiVal=bgv('bst-kpi');
  var base={name:name,sap:bgv('bst-sap'),dept:dept,role:bgv('bst-role'),status:bgv('bst-status')||'Active',phone:bgv('bst-phone'),email:bgv('bst-email'),shift:bgv('bst-shift'),contractType:bgv('bst-contract'),joinDate:bgv('bst-join'),probationStatus:bgv('bst-prob'),notes:bgv('bst-notes')};
  if(id){
    var m=BS.staff.find(function(x){return x.id===id;});
    if(m){
      Object.assign(m,base);
      if(kpiVal!==''){if(!m.kpiScores)m.kpiScores={};m.kpiScores[mkey]=parseFloat(kpiVal);}
    }
    showToast('Staff updated','success');
  } else {
    var entry=Object.assign({id:buid()},base);
    if(kpiVal!==''){entry.kpiScores={};entry.kpiScores[mkey]=parseFloat(kpiVal);}
    BS.staff.push(entry);
    showToast('Staff added','success');
  }
  bSaveColl('staff',BS.staff);bsyncTSFromStaff();

  // Write SAP→staffId index so Staff Portal can find schedule by SAP
  // Path: branches/{branchId}/sapIndex/{sap} = { staffId, name }
  if (db && NX.session && NX.session.branchId) {
    var sapIdx = {};
    BS.staff.forEach(function(m) {
      var sap = String(m.sap || '').trim();
      if (sap) sapIdx[sap] = { staffId: String(m.id), name: m.name, dept: m.dept };
    });
    db.ref('branches/' + NX.session.branchId + '/sapIndex').set(sapIdx);
  }

  closeModalForce();navTo('staff');
}
function delBranchStaff(id){var sess=NX.session||{};var allowedRoles=['hr_manager','super_admin','ceo','branch_mgr'];if(allowedRoles.indexOf(sess.role)<0){showToast('You do not have permission to delete staff','error');return;}var staffMember=BS.staff.find(function(m){return m.id===id;});var staffName=staffMember?staffMember.name:'this staff member';if(!confirm('Delete '+staffName+'?\n\nThis will also remove them from Check-In and Leave Request lists.'))return;
  // Remove from main staff list
  BS.staff=BS.staff.filter(function(m){return m.id!==id;});
  bSaveColl('staff',BS.staff);
  // Remove from tsEmps (Check-In & Leave Request employee list) — find and remove by matching id
  var tsEmpsFiltered=BS.tsEmps.filter(function(e){return String(e.id)!==String(id);});
  BS.tsEmps=tsEmpsFiltered;
  bSaveColl('tsEmps',tsEmpsFiltered);
  // Also remove their pending leave requests from tsLeaves
  if(BS.tsLeaves&&BS.tsLeaves.length){
    BS.tsLeaves=BS.tsLeaves.filter(function(l){return String(l.empId)!==String(id);});
    bSaveColl('tsLeaves',BS.tsLeaves);
  }
  // Remove from Firebase directly to ensure branch-level cleanup
  if(db&&sess.branchId){
    var branchBase='branches/'+sess.branchId;
    // Re-save tsEmps as array to Firebase
    db.ref(branchBase+'/tsEmps').set(tsEmpsFiltered.length?tsEmpsFiltered:null);
    // Remove their attendance records (optional — keeps history but removes name)
    // db.ref(branchBase+'/tsAtt/'+id).remove(); // uncomment if you want to purge attendance too
  }
  showToast(staffName+' removed from all lists ✓','success');navTo('staff');}
function openNXTransferStaffModal(staffId) {
  var staff = BS.staff.find(function(m){ return m.id === staffId; });
  if (!staff) { showToast('Staff not found','error'); return; }
  if (!db) { showToast('Not connected','error'); return; }
  db.ref('admin/branches').once('value', function(snap) {
    var raw = snap.val() || {};
    var branches = Object.values(raw).filter(function(b){ return b && b.id !== (NX.session||{}).branchId; });
    var opts = '<option value="">\u2014 Select branch \u2014</option>';
    branches.forEach(function(b) {
      opts += '<option value="' + xe(b.id) + '">' + xe(b.name) + (b.location?' \u2014 '+xe(b.location):'') + '</option>';
    });
    openModal(
      '<div class="modal-head"><h2>Transfer Staff</h2><button class="modal-close" onclick="closeModalForce()">&#x2715;</button></div>' +
      '<div style="background:var(--surface-2);border-radius:9px;padding:12px;margin-bottom:14px">' +
        '<div style="font-size:13px;font-weight:700">' + xe(staff.name) + '</div>' +
        '<div style="font-size:11px;color:var(--text-secondary)">' + xe(staff.dept||'') + ' \xb7 ' + xe(staff.role||'') + '</div>' +
      '</div>' +
      '<div class="form-group"><label class="form-label">Transfer To Branch *</label>' +
        '<select class="form-input form-select" id="nxt-dest">' + opts + '</select></div>' +
      '<div class="form-group"><label class="form-label">Reason / Note</label>' +
        '<input class="form-input" id="nxt-note" placeholder="e.g. Temporary assignment"></div>' +
      '<div style="background:rgba(245,158,11,.07);border:1px solid rgba(245,158,11,.2);border-radius:8px;padding:10px;font-size:11px;color:rgba(245,158,11,.9);margin-bottom:14px">' +
        '&#x26A0;&#xFE0F; Requires Area Manager approval.' +
      '</div>' +
      '<div style="display:flex;gap:8px">' +
        '<button class="btn" style="flex:1" onclick="closeModalForce()">Cancel</button>' +
        '<button class="btn btn-primary" style="flex:2" onclick="doNXTransferStaff(\'' + xe(staffId) + '\')">&#x1F500; Submit Request</button>' +
      '</div>'
    );
  });
}

function doNXTransferStaff(staffId) {
  var staff = BS.staff.find(function(m){ return m.id === staffId; });
  if (!staff || !db) return;
  var dest = ((document.getElementById('nxt-dest')||{}).value||'').trim();
  var note = ((document.getElementById('nxt-note')||{}).value||'').trim();
  if (!dest) { showToast('Select destination branch','warning'); return; }
  var s = NX.session || {};
  var destBranch = NX_BRANCHES[dest];
  var destBranchName = destBranch ? (destBranch.name || dest) : dest;
  var reqId = 'STRF-' + TODAY_BS + '-' + String(Date.now()).slice(-4);
  var req = {
    id:reqId, type:'staff_transfer', staffId:staffId,
    staffName:staff.name, staffDept:staff.dept||'', staffRole:staff.role||'',
    fromBranch:s.branchId||'', fromBranchName:s.branchName||'',
    toBranch:dest, toBranchName:destBranchName, note:note, status:'pending', date:TODAY_BS, createdAt:Date.now()
  };
  db.ref('admin/transfer_requests/' + reqId).set(req, function(err) {
    if (err) { showToast('Request failed: ' + err.message, 'error'); return; }
    db.ref('branches/' + dest + '/staff_transfer_requests/' + reqId).set(req);
    closeModalForce();
    showToast('Transfer request submitted - awaiting Area Manager approval', 'success');
  });
}

function approveStaffTransfer(reqId, reqEncoded) {
  if (!db) { showToast('Not connected','error'); return; }
  var req; try { req = JSON.parse(decodeURIComponent(reqEncoded)); } catch(e) { showToast('Invalid data','error'); return; }
  var toName = req.toBranchName || (NX_BRANCHES[req.toBranch] && NX_BRANCHES[req.toBranch].name) || req.toBranch;
  if (!confirm('Approve transfer of "' + req.staffName + '" to ' + toName + '?')) return;
  var srcBase = 'branches/' + req.fromBranch;
  var destBase = 'branches/' + req.toBranch;
  var staffKey = String(req.staffId).replace(/[.#$[\]\/]/g, '_');
  var srcBranch = Object.values(NX_BRANCHES).find(function(b){ return b.id === req.fromBranch; });
  var srcName = (srcBranch&&srcBranch.name||req.fromBranchName||'').toLowerCase();
  var destBranch = Object.values(NX_BRANCHES).find(function(b){ return b.id === req.toBranch; });
  var destName = (destBranch&&destBranch.name||req.toBranchName||'').toLowerCase();
  // Keep at source ONLY if source is Hybrid AND destination is NOT also Hybrid
  // (Hybrid2192Hybrid = real transfer, so always remove from source)
  var keepAtSource = srcName.indexOf('hybrid') >= 0 && destName.indexOf('hybrid') < 0;
  var role = (NX.session||{}).role;
  var nextPage = role === 'regional' ? 'headcount' : 'access-ctrl';

  // Step 1: Load source staff node
  db.ref(srcBase + '/staff').once('value', function(snap) {
    var raw = snap.val();
    if (!raw) { showToast('Staff not found at source', 'error'); return; }

    // Find staff by id or name (handles both array and keyed object)
    var foundKey = null, staffData = null;
    var entries = typeof raw === 'object' ? Object.entries(raw) : [];
    for (var i = 0; i < entries.length; i++) {
      var k = entries[i][0], v = entries[i][1];
      if (!v) continue;
      if (String(v.id) === String(req.staffId) || (v.name && v.name === req.staffName)) {
        foundKey = k; staffData = v; break;
      }
    }
    if (!staffData && raw[staffKey]) { foundKey = staffKey; staffData = raw[staffKey]; }
    if (!staffData) { showToast('Staff not found at source', 'error'); return; }

    var staffId = String(staffData.id || req.staffId);
    var updated = Object.assign({}, staffData, {
      transferredFrom: req.fromBranchName||req.fromBranch,
      transferNote: req.note||'', transferDate: TODAY_BS,
      approvedBy: (NX.session||{}).userName||'Area Manager'
    });

    // Collect all async ops then finalize
    var pending = 0;
    function done() { if (--pending > 0) return; finalize(); }

    function finalize() {
      // Mark request approved
      db.ref('admin/transfer_requests/' + reqId + '/status').set('approved', function() {
        showToast('✅ Transfer complete — Staff, Schedule, Timesheet & Health Card moved', 'success');
        if (typeof amUpdateTransferBadge === 'function') amUpdateTransferBadge();
        navTo(nextPage);
      });
    }

    // Step 2: Write staff to destination
    pending++;
    db.ref(destBase + '/staff/' + foundKey).set(updated, function(err) {
      if (err) { showToast('Failed writing staff: '+err.message,'error'); return; }
      if (!keepAtSource) db.ref(srcBase + '/staff/' + foundKey).remove();
      done();
    });

    // Step 3: Transfer tsEmps (timesheet employee record)
    pending++;
    db.ref(srcBase + '/tsEmps').once('value', function(snap2) {
      var tsRaw = snap2.val();
      var tsEntries = tsRaw ? (Array.isArray(tsRaw) ? tsRaw : Object.values(tsRaw)) : [];
      var tsEmp = tsEntries.find(function(e){ return e && String(e.id) === staffId; });
      if (tsEmp) {
        var tsKey = String(tsEmp.id).replace(/[.#$[\]\/]/g,'_');
        var tsUpdated = Object.assign({}, tsEmp, { branchTransferDate: TODAY_BS });
        db.ref(destBase + '/tsEmps/' + tsKey).set(tsUpdated, function() {
          if (!keepAtSource) {
            // Remove from source tsEmps — handle array or object
            if (Array.isArray(tsRaw)) {
              var newArr = tsEntries.filter(function(e){ return e && String(e.id) !== staffId; });
              db.ref(srcBase + '/tsEmps').set(newArr, function(){ done(); });
            } else {
              db.ref(srcBase + '/tsEmps/' + tsKey).remove(function(){ done(); });
            }
          } else { done(); }
        });
      } else { done(); }
    });

    // Step 4: Transfer tsAtt (attendance records)
    pending++;
    db.ref(srcBase + '/tsAtt/' + staffId).once('value', function(snap3) {
      var attData = snap3.val();
      if (attData) {
        db.ref(destBase + '/tsAtt/' + staffId).set(attData, function() {
          if (!keepAtSource) db.ref(srcBase + '/tsAtt/' + staffId).remove();
          done();
        });
      } else { done(); }
    });

    // Step 5: Remove staff from source schedule (sch) — all weeks
    pending++;
    db.ref(srcBase + '/sch').once('value', function(snap4) {
      var schData = snap4.val();
      if (schData && !keepAtSource) {
        // Remove this staff's shifts from every week
        var schUpdates = {};
        Object.keys(schData).forEach(function(week) {
          if (schData[week] && schData[week][staffId] !== undefined) {
            schUpdates[srcBase + '/sch/' + week + '/' + staffId] = null;
          }
        });
        if (Object.keys(schUpdates).length) {
          db.ref().update(schUpdates, function(){ done(); });
        } else { done(); }
      } else { done(); }
    });

    // Step 6: Transfer health card
    pending++;
    db.ref(srcBase + '/health').once('value', function(snap5) {
      var hRaw = snap5.val();
      if (!hRaw) { done(); return; }
      var hEntries = typeof hRaw === 'object' ? Object.values(hRaw) : [];
      var hc = hEntries.find(function(h){
        return h && (h.name === req.staffName || (h.staffId && String(h.staffId) === staffId));
      });
      if (!hc) { done(); return; }
      var hcKey = String(hc.id || hc.name).replace(/[.#$[\]\/]/g,'_');
      var hcCopy = Object.assign({}, hc, { transferredFrom: req.fromBranchName||req.fromBranch, transferDate: TODAY_BS });
      db.ref(destBase + '/health/' + hcKey).set(hcCopy, function() {
        if (!keepAtSource) db.ref(srcBase + '/health/' + hcKey).remove();
        done();
      });
    });
  });
}

function rejectStaffTransfer(reqId) {
  if (!db) return;
  if (!confirm('Reject this transfer request?')) return;
  db.ref('admin/transfer_requests/' + reqId + '/status').set('rejected', function() {
    showToast('Transfer rejected','warning');
    if (typeof amUpdateTransferBadge === 'function') amUpdateTransferBadge();
    var role = (NX.session||{}).role;
    navTo(role === 'regional' ? 'headcount' : 'access-ctrl');
  });
}



// ── Schedule ─────────────────────────────────────────
function pSchedule() {
  attachBranchListeners();
  if(!BS.wo)BS.wo=0;
  var wk=bweekKey(),dates=bweekDates(),sc=BS.sch[wk]||{};
  var d0=new Date(dates[0]+'T00:00:00').toLocaleDateString('en-GB',{day:'2-digit',month:'short'});
  var d6=new Date(dates[6]+'T00:00:00').toLocaleDateString('en-GB',{day:'2-digit',month:'short'});
  var th='<tr><th>Staff</th>';
  dates.forEach(function(dt,i){var it=dt===TODAY_BS;th+='<th style="'+(it?'color:var(--ceo)':'')+';text-align:center">'+DAYS_WEEK[i]+'<br><span style="font-weight:400;font-size:9px;opacity:.7">'+new Date(dt+'T00:00:00').toLocaleDateString('en-GB',{day:'2-digit',month:'short'})+'</span></th>';});
  th+='</tr>';
  var tb='';
  DEPTS.forEach(function(dep){var mem=BS.staff.filter(function(m){return normalizeDept(m.dept)===dep;});if(!mem.length)return;tb+='<tr class="bdr"><td colspan="8">'+bxe(dep)+'</td></tr>';mem.forEach(function(m){var ms=(sc[m.id]||{});tb+='<tr><td><div style="display:flex;align-items:center;gap:8px"><div class="bav" style="width:24px;height:24px;font-size:9px">'+bini(m.name)+'</div><span style="font-size:12px;font-weight:500">'+bxe(m.name)+'</span>'+(m.sap?'<div style="font-size:9px;color:#94a3b8;font-family:monospace">'+bxe(m.sap)+'</div>':'')+' </div></div></td>';DAYS_WEEK.forEach(function(day){tb+='<td style="padding:4px"><input class="bsinp bsc-inp" data-id="'+bxe(m.id)+'" data-day="'+bxe(day)+'" value="'+bxe(ms[day]||'')+'" placeholder="\u2014"></td>';});tb+='</tr>';});});
  var h='<div class="page-header"><h1>Weekly Schedule</h1></div>';
  h+='<div class="bwnav"><button class="btn btn-sm" onclick="BS.wo=(BS.wo||0)-1;navTo(\'schedule\')">\u2190 Prev</button><span class="bmono" style="font-size:12px;color:var(--text-secondary)">'+bxe(wk)+' \u00b7 '+d0+' \u2014 '+d6+'</span><button class="btn btn-sm" onclick="BS.wo=(BS.wo||0)+1;navTo(\'schedule\')">Next \u2192</button><span style="margin-left:auto;font-size:11px;color:var(--success);opacity:.8">\u25cf Auto-saves</span><button class="btn btn-sm" onclick="printBranchSched(\'All\')">Print All</button><button class="btn btn-sm" onclick="printBranchSched(\'Management\')">Print Mgmt</button><button class="btn btn-sm" onclick="printBranchSched(\'Kitchen\')">Print Kitchen</button><button class="btn btn-sm" onclick="printBranchSched(\'FOH\')">Print FOH</button></div>';
  h+='<div class="bswrap"><table class="bstbl"><thead>'+th+'</thead><tbody>'+tb+'</tbody></table></div>';
  setTimeout(function(){
    document.querySelectorAll('.bsc-inp').forEach(function(inp){
      inp.addEventListener('input',function(){
        var wk2=bweekKey();
        if(!BS.sch[wk2])BS.sch[wk2]={};
        var id=inp.dataset.id,day=inp.dataset.day;
        if(!BS.sch[wk2][id])BS.sch[wk2][id]={};
        BS.sch[wk2][id][day]=inp.value;
        clearTimeout(inp._saveTimer);
        inp._saveTimer=setTimeout(function(){bSaveSch();},800);
      });
    });
  },0);
  return h;
}
function printBranchSched(dept){var wk=bweekKey(),dates=bweekDates(),sc=BS.sch[wk]||{};var d0=new Date(dates[0]+'T00:00:00').toLocaleDateString('en-GB',{day:'2-digit',month:'short'});var d6=new Date(dates[6]+'T00:00:00').toLocaleDateString('en-GB',{day:'2-digit',month:'short'});var s=NX.session||{};var th='<tr style="background:#1a2340;color:#fff"><th style="padding:10px 14px;text-align:left;min-width:180px">Staff Member</th>';dates.forEach(function(dt,i){var it=dt===TODAY_BS;th+='<th style="padding:10px 8px;text-align:center;min-width:80px'+(it?';color:#b45309':'')+' ">'+DAYS_WEEK[i]+'<br><span style="font-size:9px;font-weight:400;opacity:.8">'+new Date(dt+'T00:00:00').toLocaleDateString('en-GB',{day:'2-digit',month:'short'})+'</span></th>';});th+='</tr>';var tb='';var deptsR=dept==='All'?DEPTS:[dept];deptsR.forEach(function(dep){var mem=BS.staff.filter(function(m){return normalizeDept(m.dept)===dep;});if(!mem.length)return;tb+='<tr><td colspan="8" style="background:#f1f5f9;font-size:9px;text-transform:uppercase;letter-spacing:2px;color:#64748b;font-weight:700;padding:6px 14px">'+dep+'</td></tr>';mem.forEach(function(m){var ms=(sc[m.id]||{});var ini2='';String(m.name||'').split(' ').forEach(function(p){if(p&&ini2.length<2)ini2+=p[0].toUpperCase();});tb+='<tr><td style="padding:8px 14px;font-size:12px;font-weight:600;border-bottom:1px solid #f1f5f9"><div style="display:flex;align-items:center;gap:8px"><div style="width:24px;height:24px;border-radius:50%;background:#e2e8f0;display:flex;align-items:center;justify-content:center;font-size:9px;font-weight:700">'+ini2+'</div>'+bxe(m.name)+'</div></td>';dates.forEach(function(dt,di){var val=(ms[DAYS_WEEK[di]]||'');var isOff=val.toUpperCase()==='OFF'||val.toUpperCase()==='DAY OFF';var it=dt===TODAY_BS;tb+='<td style="padding:8px 6px;text-align:center;font-size:11px;font-weight:600;color:'+(val?isOff?'#b45309':'#1a2340':'#cbd5e1')+';background:'+(it?'#fffbeb':isOff?'#f8fafc':'#fff')+';border-bottom:1px solid #f1f5f9;border-left:1px solid #f1f5f9">'+bxe(val||'\u2014')+'</td>';});tb+='</tr>';});});var html='<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Schedule</title><style>@page{size:A4 landscape;margin:8mm}*{box-sizing:border-box;margin:0;padding:0;font-family:Arial,Helvetica,sans-serif}body{background:#fff;color:#111;font-size:12px}table{width:100%;border-collapse:collapse}.hdr{display:flex;justify-content:space-between;align-items:flex-start;padding-bottom:10px;margin-bottom:14px;border-bottom:3px solid #1a2340}.foot{margin-top:20px;display:grid;grid-template-columns:1fr 1fr 1fr;gap:30px}.foot-cell{border-top:1px solid #333;padding-top:5px;text-align:center;font-size:9px;color:#64748b}@media print{.np{display:none!important}}</style></head><body><div class="hdr"><div><img src="https://i.imgur.com/jeqtcE2.png" alt="ALFA.CO" style="height:44px;width:auto;display:block"><div style="font-size:10px;color:#888">'+bxe(s.branchName||s.entityName||'')+'</div></div><div style="text-align:center"><h1 style="font-size:16px;font-weight:800;color:#1a2340">Weekly Schedule</h1><p style="font-size:10px;color:#64748b">'+bxe(dept)+' \u00b7 '+bxe(wk)+' \u00b7 '+d0+' \u2013 '+d6+'</p></div><div style="text-align:right;font-size:10px;color:#64748b"><div>Printed: '+new Date().toLocaleDateString('en-GB')+'</div></div></div><table><thead>'+th+'</thead><tbody>'+tb+'</tbody></table><div class="foot"><div class="foot-cell">Prepared by</div><div class="foot-cell">Approved by Manager</div><div class="foot-cell">Date &amp; Signature</div></div><div class="np" style="text-align:center;margin-top:20px"><button onclick="window.print()" style="background:#1a2340;color:#fff;border:none;border-radius:8px;padding:10px 28px;font-size:13px;font-weight:700;cursor:pointer">Print / Save PDF</button></div></body></html>';var w=window.open('','_blank','width=1100,height=700');if(w){w.document.write(html);w.document.close();}else showToast('Allow pop-ups to print','error');}

// ── Timesheet ─────────────────────────────────────────
function pTimesheet() {
  attachBranchListeners();
  BS.tsViewDate=BS.tsViewDate||TODAY_BS;
  var bar='<div class="bstb">'+['att','report','leave','emps'].map(function(t){var l={att:'Attendance',report:'Reports',leave:'Leave',emps:'Employees'};return '<button class="'+(BS.tsTab===t?'on':'')+'" onclick="BS.tsTab=\''+t+'\';navTo(\'timesheet\')">'+l[t]+'</button>';}).join('')+'</div>';
  if(BS.tsTab==='att')return bar+btsPgAtt();
  if(BS.tsTab==='report')return bar+btsPgReport();
  if(BS.tsTab==='leave')return bar+btsPgLeave();
  return bar+btsPgEmps();
}
function btsPgAtt(){
  var vd=BS.tsViewDate||TODAY_BS;
  // Status buttons — use data-st + setTimeout wiring (same pattern as index.html ts-st-btn)
  var stBtns=Object.keys(TS_ST_BRANCH).map(function(s2){
    var c2=TS_ST_BRANCH[s2];
    var isOn=BS.tsSt===s2;
    return '<button class="bts-st-btn" data-st="'+s2+'" style="padding:6px 14px;border-radius:7px;border:1px solid '+(isOn?c2.c:'var(--border)')+';background:'+(isOn?c2.c+'22':'transparent')+';color:'+(isOn?c2.c:'var(--text-secondary)')+';font-size:12px;font-weight:'+(isOn?'700':'500')+';cursor:pointer;font-family:var(--font);transition:all .15s">'+c2.l+'</button>';
  }).join('');
  var attFilts=['all'].concat(Object.keys(TS_ST_BRANCH));
  var afBtns=attFilts.map(function(f){
    var lbl=f==='all'?'All':(TS_ST_BRANCH[f]?TS_ST_BRANCH[f].l:f);
    var ac=f==='all'?'var(--text-primary)':(TS_ST_BRANCH[f]?TS_ST_BRANCH[f].c:'#888');
    var isOn=BS.attFilt===f;
    return '<button class="bfbt'+(isOn?' on':'')+'" style="'+(isOn?'border-color:'+ac+';background:'+ac+'22;color:'+ac:'')+'" onclick="BS.attFilt=\''+f+'\';navTo(\'timesheet\')">'+lbl+'</button>';
  }).join('');
  var sorted=BS.tsEmps.slice().sort(function(a,b){return(a.dept||'').localeCompare(b.dept||'')||a.name.localeCompare(b.name);});
  var eo='<option value="">Select Employee</option>';
  var ld='';
  sorted.forEach(function(e){
    if(e.dept!==ld){if(ld)eo+='</optgroup>';eo+='<optgroup label="'+bxe(e.dept||'Other')+'">';ld=e.dept;}
    eo+='<option value="'+bxe(e.id)+'">'+bxe(e.name)+'</option>';
  });
  if(ld)eo+='</optgroup>';
  var pCt=0,aCt=0,oCt=0;
  var attRows=BS.tsEmps.slice().sort(function(a,b){return a.name.localeCompare(b.name);}).filter(function(e){
    if(!BS.attFilt||BS.attFilt==='all')return true;
    var key=vd.slice(0,7),recs=(BS.tsAtt[e.id]&&BS.tsAtt[e.id][key])||[],r=null;
    for(var i=0;i<recs.length;i++)if(recs[i].date===vd){r=recs[i];break;}
    return r?r.st===BS.attFilt:false;
  }).map(function(e){
    var key=vd.slice(0,7),recs=(BS.tsAtt[e.id]&&BS.tsAtt[e.id][key])||[],r=null;
    for(var i=0;i<recs.length;i++)if(recs[i].date===vd){r=recs[i];break;}
    if(r){if(r.st==='present'||r.st==='late')pCt++;else if(r.st==='absent')aCt++;else oCt++;}
    return '<tr><td><div style="display:flex;align-items:center;gap:8px"><div class="bav">'+bini(e.name)+'</div><strong style="font-size:12px">'+bxe(e.name)+'</strong></div></td><td>'+bpl(e.dept||'\u2014',bdc(e.dept||'FOH'))+'</td><td class="bmono" style="font-size:11px">'+(r&&r.ci||'\u2014')+'</td><td class="bmono" style="font-size:11px">'+(r&&r.co||'\u2014')+'</td><td class="bmono" style="font-size:11px;color:var(--info);font-weight:600">'+(r&&r.brk||'\u2014')+'</td><td class="bmono" style="font-size:11px">'+(r?btsHrs(r.ci,r.co):'\u2014')+'</td><td>'+(r?btsBadge(r.st):'<span style="color:var(--text-tertiary);font-size:10px;font-style:italic">Not recorded</span>')+'</td><td style="font-size:11px;color:var(--text-secondary)">'+(r&&r.note||'')+'</td></tr>';
  }).join('');
  var dateLbl=vd===TODAY_BS?'Today \u2014 '+TODAY_BS:new Date(vd+'T00:00:00').toLocaleDateString('en-GB',{weekday:'short',day:'2-digit',month:'short',year:'numeric'});
  var h='<div class="bcard" style="margin-bottom:16px">';
  h+='<div style="font-size:13px;font-weight:700;color:var(--ceo);margin-bottom:14px">Manual Entry</div>';
  h+='<div style="display:grid;grid-template-columns:2fr 1fr 1fr 1fr;gap:10px;margin-bottom:10px">';
  h+='<div class="bfg" style="margin-bottom:0"><label class="form-label">Employee</label><select class="form-input form-select" id="bts-emp" onchange="btsOnEmpChange(this.value,\''+vd+'\')" >'+eo+'</select></div>';
  h+='<div class="bfg" style="margin-bottom:0"><label class="form-label">Date</label><input class="form-input" type="date" id="bts-date" value="'+vd+'"></div>';
  h+='<div class="bfg" style="margin-bottom:0"><label class="form-label">Check In</label><input class="form-input" type="time" id="bts-in"></div>';
  h+='<div class="bfg" style="margin-bottom:0"><label class="form-label">Check Out</label><input class="form-input" type="time" id="bts-out"></div>';
  h+='</div>';
  h+='<div style="display:grid;grid-template-columns:2fr 1fr auto auto;gap:10px;align-items:flex-end;margin-bottom:10px">';
  h+='<div class="bfg" style="margin-bottom:0"><label class="form-label">Note</label><input class="form-input" id="bts-note" placeholder="Optional"></div>';
  h+='<div class="bfg" style="margin-bottom:0"><label class="form-label">Break Total</label><input class="form-input" id="bts-brk" placeholder="Auto-calculated" readonly style="background:var(--surface-2);color:var(--text-secondary)"></div>';
  h+='<div style="display:flex;flex-direction:column;gap:4px">';
  h+='<label class="form-label">Break</label>';
  h+='<div style="display:flex;gap:6px">';
  h+='<button id="bts-brk-start" class="btn btn-sm" style="white-space:nowrap;background:rgba(245,158,11,.12);border-color:rgba(245,158,11,.4);color:#b45309;font-weight:700" onclick="btsStartBreak()">☕ Start</button>';
  h+='<button id="bts-brk-end" class="btn btn-sm" style="white-space:nowrap;background:rgba(0,135,90,.12);border-color:rgba(0,135,90,.4);color:#00875a;font-weight:700;display:none" onclick="btsEndBreak()">▶ End</button>';
  h+='<span id="bts-brk-timer" style="font-size:11px;font-family:var(--mono);color:#b45309;display:none;align-self:center"></span>';
  h+='</div></div>';
  h+='<button class="btn btn-primary" style="align-self:flex-end" id="bts-save-att">Save Attendance</button>';
  h+='</div>';
  h+='<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">';
  h+='<span class="form-label" style="margin:0">Status:</span>';
  h+='<div id="bts-st-wrap" style="display:flex;flex-wrap:wrap;gap:6px">'+stBtns+'</div>';
  h+='</div>';
  h+='<div id="bts-brk-log" style="margin-top:8px;display:none"><div style="font-size:10px;color:var(--text-tertiary);text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px">Break Log</div><div id="bts-brk-log-items" style="font-size:11px;font-family:var(--mono);color:var(--text-secondary)"></div></div>';
  h+='</div>';
  h+='<div class="btw"><div class="bttb" style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">';
  h+='<label class="form-label" style="margin:0">Date:</label>';
  h+='<input class="bfi" type="date" id="bts-view-date" value="'+vd+'" max="'+TODAY_BS+'" style="width:auto">';
  h+='<button class="btn btn-sm" onclick="BS.tsViewDate=document.getElementById(\'bts-view-date\').value;navTo(\'timesheet\')">View</button>';
  h+=(vd!==TODAY_BS?'<button class="btn btn-sm" onclick="BS.tsViewDate=\''+TODAY_BS+'\';navTo(\'timesheet\')">Today</button>':'');
  h+='<span style="flex:1"></span>';
  h+='<strong style="color:'+(vd===TODAY_BS?'var(--ceo)':'var(--brand-dir)')+'">'+bxe(dateLbl)+'</strong>';
  h+='<span class="bmono" style="font-size:10px;color:var(--text-tertiary)">'+pCt+' present \u00b7 '+aCt+' absent \u00b7 '+oCt+' other</span></div>';
  h+='<div style="display:flex;gap:5px;flex-wrap:wrap;padding:8px 14px;border-bottom:1px solid var(--border);background:var(--surface-2)">'+afBtns+'</div>';
  h+='<div class="btw-s"><table class="btbl"><thead><tr><th>Name</th><th>Dept</th><th>In</th><th>Out</th><th>Break</th><th>Hours</th><th>Status</th><th>Note</th></tr></thead>';
  h+='<tbody>'+(attRows||'<tr><td colspan="8" style="text-align:center;color:var(--text-tertiary);padding:24px">No records for this date</td></tr>')+'</tbody></table></div></div>';

  // Wire up status buttons and save button AFTER render via setTimeout
  setTimeout(function(){
    // Status buttons — clicking updates BS.tsSt and refreshes button styles immediately
    document.querySelectorAll('.bts-st-btn').forEach(function(btn){
      btn.onclick=function(){
        BS.tsSt=this.dataset.st;
        // Visually update all buttons immediately without full re-render
        document.querySelectorAll('.bts-st-btn').forEach(function(b){
          var st2=b.dataset.st;
          var c2=TS_ST_BRANCH[st2];
          var isOn=BS.tsSt===st2;
          b.style.border='1px solid '+(isOn?c2.c:'var(--border)');
          b.style.background=isOn?c2.c+'22':'transparent';
          b.style.color=isOn?c2.c:'var(--text-secondary)';
          b.style.fontWeight=isOn?'700':'500';
        });
      };
    });
    // Save button
    var saveBtn=document.getElementById('bts-save-att');
    if(saveBtn)saveBtn.onclick=saveBranchAttendance;
  },0);

  return h;
}
function nxSetTsSt(st) {
  BS.tsSt = st;
  Object.keys(TS_ST_BRANCH).forEach(function(k) {
    var btn=document.getElementById('tsst-'+k);
    if(!btn)return;
    var c=TS_ST_BRANCH[k], isAct=(k===st);
    btn.style.borderColor=isAct?c.c:'var(--border)';
    btn.style.background=isAct?c.c+'22':'transparent';
    btn.style.color=isAct?c.c:'var(--text-secondary)';
    btn.style.fontWeight=isAct?'700':'500';
  });
}
function saveBranchAttendance(){
  var eid=bgv('bts-emp'),dt=bgv('bts-date')||TODAY_BS;
  var ci=(document.getElementById('bts-in')||{}).value||'';
  var co=(document.getElementById('bts-out')||{}).value||'';
  var brk=bgv('bts-brk'),note=bgv('bts-note'),st=BS.tsSt||'present';
  if(!eid){showToast('Select an employee','error');return;}
  var key=dt.slice(0,7);
  if(!BS.tsAtt[eid])BS.tsAtt[eid]={};
  if(!BS.tsAtt[eid][key])BS.tsAtt[eid][key]=[];
  var recs=BS.tsAtt[eid][key];
  var ex=recs.findIndex(function(r){return r.date===dt;});
  var rec={date:dt,ci:ci,co:co,brk:brk,note:note,st:st,brkLogs:(_btsBreak?_btsBreak.logs||[]:[])};
  if(ex>=0)recs[ex]=rec;else recs.push(rec);
  // Save to Firebase using targeted path (not full set) to avoid overwriting other employees
  if(db){
    var path=bPath('tsAtt')+'/'+eid+'/'+key;
    db.ref(path).set(recs,function(err){
      if(err){showToast('Save failed: '+err.message,'error');return;}
      showToast('Attendance saved \u2713','success');
      if(typeof btsResetBreak==='function') btsResetBreak();
      // Refresh just the view date table without full page re-render
      var vd=BS.tsViewDate||TODAY_BS;
      if(vd===dt)_refreshAttTable(vd);
    });
  } else {
    showToast('Not connected','error');
    return;
  }
  // WhatsApp alert for absent/sick
  if((st==='absent'||st==='sick')&&dt===TODAY_BS){
    var emp=BS.tsEmps.find(function(e){return e.id===eid;});
    if(emp&&emp.phone){
      var msg=encodeURIComponent('\ud83d\udea8 \u063a\u064a\u0627\u0628\nEmployee: '+emp.name+'\nDate: '+dt+'\nStatus: '+st.toUpperCase()+'\nBranch: '+(NX.session&&NX.session.branchName||''));
      setTimeout(function(){window.location.href='https://wa.me/'+emp.phone.replace(/[^0-9]/g,'')+'?text='+msg;},300);
    }
  }
}

// ── Break Tracking State ──
var _btsBreak = { active:false, startMs:null, logs:[], timerInt:null };

function btsOnEmpChange(eid, vd) {
  btsResetBreak();
  if(!eid||!BS.tsAtt[eid]) return;
  var key=vd.slice(0,7), recs=(BS.tsAtt[eid][key]||[]);
  var r=recs.find(function(x){return x.date===vd;});
  if(!r) return;
  var ci=document.getElementById('bts-in'), co=document.getElementById('bts-out');
  var brk=document.getElementById('bts-brk'), note=document.getElementById('bts-note');
  if(ci&&r.ci) ci.value=r.ci;
  if(co&&r.co) co.value=r.co;
  if(brk&&r.brk) brk.value=r.brk;
  if(note&&r.note) note.value=r.note;
  if(r.st) BS.tsSt=r.st;
  if(r.brkLogs&&r.brkLogs.length){ _btsBreak.logs=r.brkLogs.slice(); btsRenderBreakLog(); }
}

function btsStartBreak() {
  if(_btsBreak.active) return;
  _btsBreak.active=true;
  _btsBreak.startMs=Date.now();
  var s=document.getElementById('bts-brk-start');
  var e=document.getElementById('bts-brk-end');
  var t=document.getElementById('bts-brk-timer');
  if(s) s.style.display='none';
  if(e) e.style.display='inline-flex';
  if(t) t.style.display='inline';
  _btsBreak.timerInt=setInterval(function(){
    var el=document.getElementById('bts-brk-timer');
    if(el){ var sec=Math.floor((Date.now()-_btsBreak.startMs)/1000); el.textContent=Math.floor(sec/60)+'m '+(sec%60<10?'0':'')+sec%60+'s'; }
  },1000);
  showToast('☕ Break started','success');
}

function btsEndBreak() {
  if(!_btsBreak.active) return;
  clearInterval(_btsBreak.timerInt);
  _btsBreak.active=false;
  var endMs=Date.now(), durSec=Math.floor((endMs-_btsBreak.startMs)/1000);
  var startTime=new Date(_btsBreak.startMs).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'});
  var endTime=new Date(endMs).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'});
  _btsBreak.logs.push({start:startTime,end:endTime,sec:durSec});
  var s=document.getElementById('bts-brk-start'); if(s) s.style.display='inline-flex';
  var e=document.getElementById('bts-brk-end');   if(e) e.style.display='none';
  var t=document.getElementById('bts-brk-timer'); if(t){t.style.display='none';t.textContent='';}
  btsUpdateBrkTotal();
  btsRenderBreakLog();
  showToast('Break ended: '+Math.floor(durSec/60)+'m','success');
}

function btsUpdateBrkTotal() {
  var total=_btsBreak.logs.reduce(function(s,l){return s+l.sec;},0);
  var el=document.getElementById('bts-brk');
  if(el) el.value=Math.floor(total/60)+'m'+(total%60>0?(total%60<10?'0':'')+total%60+'s':'');
}

function btsRenderBreakLog() {
  var logDiv=document.getElementById('bts-brk-log');
  var logItems=document.getElementById('bts-brk-log-items');
  if(!logDiv||!logItems) return;
  if(!_btsBreak.logs.length){logDiv.style.display='none';return;}
  logDiv.style.display='block';
  var total=_btsBreak.logs.reduce(function(s,l){return s+l.sec;},0);
  logItems.innerHTML=_btsBreak.logs.map(function(l,i){
    return '<div style="display:flex;justify-content:space-between;padding:2px 0;border-bottom:1px solid var(--border)">' +
      '<span style="color:var(--text-tertiary)">#'+(i+1)+'</span>' +
      '<span>'+l.start+' → '+l.end+'</span>' +
      '<span style="color:#b45309;font-weight:700">'+Math.floor(l.sec/60)+'m'+(l.sec%60>0?l.sec%60+'s':'')+'</span>' +
    '</div>';
  }).join('')+'<div style="text-align:right;padding-top:3px;font-weight:700;color:#b45309">Total: '+Math.floor(total/60)+'m'+(total%60>0?total%60+'s':'')+'</div>';
}

function btsResetBreak() {
  clearInterval(_btsBreak.timerInt);
  _btsBreak={active:false,startMs:null,logs:[],timerInt:null};
  var s=document.getElementById('bts-brk-start'); if(s) s.style.display='inline-flex';
  var e=document.getElementById('bts-brk-end');   if(e) e.style.display='none';
  var t=document.getElementById('bts-brk-timer'); if(t){t.style.display='none';t.textContent='';}
  var logDiv=document.getElementById('bts-brk-log'); if(logDiv) logDiv.style.display='none';
  var brk=document.getElementById('bts-brk'); if(brk) brk.value='';
}

// Refresh just the attendance table rows without full page re-render
function _refreshAttTable(vd){
  var tbody=document.querySelector('.btw .btw-s table tbody');
  if(!tbody)return;
  var pCt=0,aCt=0,oCt=0;
  var rows=BS.tsEmps.slice().sort(function(a,b){return a.name.localeCompare(b.name);}).filter(function(e){
    if(!BS.attFilt||BS.attFilt==='all')return true;
    var key=vd.slice(0,7),recs=(BS.tsAtt[e.id]&&BS.tsAtt[e.id][key])||[],r=null;
    for(var i=0;i<recs.length;i++)if(recs[i].date===vd){r=recs[i];break;}
    return r?r.st===BS.attFilt:false;
  }).map(function(e){
    var key=vd.slice(0,7),recs=(BS.tsAtt[e.id]&&BS.tsAtt[e.id][key])||[],r=null;
    for(var i=0;i<recs.length;i++)if(recs[i].date===vd){r=recs[i];break;}
    if(r){if(r.st==='present'||r.st==='late')pCt++;else if(r.st==='absent')aCt++;else oCt++;}
    return '<tr><td><div style="display:flex;align-items:center;gap:8px"><div class="bav">'+bini(e.name)+'</div><strong style="font-size:12px">'+bxe(e.name)+'</strong></div></td><td>'+bpl(e.dept||'\u2014',bdc(e.dept||'FOH'))+'</td><td class="bmono" style="font-size:11px">'+(r&&r.ci||'\u2014')+'</td><td class="bmono" style="font-size:11px">'+(r&&r.co||'\u2014')+'</td><td class="bmono" style="font-size:11px;color:var(--info);font-weight:600">'+(r&&r.brk||'\u2014')+'</td><td class="bmono" style="font-size:11px">'+(r?btsHrs(r.ci,r.co):'\u2014')+'</td><td>'+(r?btsBadge(r.st):'<span style="color:var(--text-tertiary);font-size:10px;font-style:italic">Not recorded</span>')+'</td><td style="font-size:11px;color:var(--text-secondary)">'+(r&&r.note||'')+'</td></tr>';
  }).join('');
  tbody.innerHTML=rows||'<tr><td colspan="8" style="text-align:center;color:var(--text-tertiary);padding:24px">No records for this date</td></tr>';
  // Update counter line
  var ctr=document.querySelector('.bttb .bmono');
  if(ctr)ctr.textContent=pCt+' present \u00b7 '+aCt+' absent \u00b7 '+oCt+' other';
}
function btsPgReport(){var mo=new Date().getMonth()+1,yr=new Date().getFullYear();var moOpts='<option value="0">All Months</option>'+MONTHS_FULL.map(function(m2,i){return '<option value="'+(i+1)+'"'+(i+1===mo?' selected':'')+'>'+bxe(m2)+'</option>';}).join('');var eo='<option value="">All Staff</option>'+BS.tsEmps.slice().sort(function(a,b){return a.name.localeCompare(b.name);}).map(function(e){return '<option value="'+bxe(e.id)+'">'+bxe(e.name)+' ('+bxe(e.dept||'')+')</option>';}).join('');return '<div class="bcard" style="margin-bottom:16px"><div style="display:flex;gap:12px;flex-wrap:wrap;align-items:flex-end"><div class="bfg" style="flex:2 1 160px;margin-bottom:0"><label class="form-label">Employee</label><select class="form-input form-select" id="bts-r-emp">'+eo+'</select></div><div class="bfg" style="flex:1 1 120px;margin-bottom:0"><label class="form-label">Month</label><select class="form-input form-select" id="bts-r-mo">'+moOpts+'</select></div><div class="bfg" style="flex:1 1 90px;margin-bottom:0"><label class="form-label">Year</label><select class="form-input form-select" id="bts-r-yr"><option '+(yr===2024?'selected':'')+'>2024</option><option '+(yr===2025?'selected':'')+'>2025</option><option '+(yr===2026?'selected':'')+'>2026</option></select></div><button class="btn btn-primary" onclick="runBranchTsReport()">Generate</button><button class="btn" id="bts-print-btn" style="display:none" onclick="printBranchTsReport()">Print</button></div></div><div id="bts-report-out"></div>';}
function runBranchTsReport(){var eid=bgv('bts-r-emp'),mo=parseInt(bgv('bts-r-mo')),yr=bgv('bts-r-yr'),out=document.getElementById('bts-report-out');if(!out)return;function getRecs(empId){var recs=[];if(mo===0){for(var mi=1;mi<=12;mi++){var key2=yr+'-'+(mi<10?'0':'')+mi;recs=recs.concat((BS.tsAtt[empId]&&BS.tsAtt[empId][key2])||[]);}}else{var key2=yr+'-'+(mo<10?'0':'')+mo;recs=(BS.tsAtt[empId]&&BS.tsAtt[empId][key2])||[];}return recs;}function countSt(recs){var c={present:0,late:0,absent:0,sick:0,holiday:0,dayoff:0};recs.forEach(function(r){if(c[r.st]!==undefined)c[r.st]++;});return c;}var pb=document.getElementById('bts-print-btn');if(pb)pb.style.display='none';if(!eid){
  // ── ALL STAFF: Day-by-day matrix for the month ──
  if(mo===0){
    // Year view stays as summary
    var allRows='';BS.tsEmps.slice().sort(function(a,b){return a.name.localeCompare(b.name);}).forEach(function(emp){var recs=getRecs(emp.id),cnt=countSt(recs),tot=recs.length,worked=cnt.present+cnt.late,pct=tot?Math.round(worked/tot*100)+'%':'\u2014';allRows+='<tr><td><div style="display:flex;align-items:center;gap:8px"><div class="bav">'+bini(emp.name)+'</div><div><div style="font-size:12px;font-weight:600">'+bxe(emp.name)+'</div><div style="font-size:10px;color:'+bdc(emp.dept||'FOH')+'">'+bxe(emp.dept||'')+'</div></div></div></td><td class="bmono" style="text-align:center">'+tot+'</td><td class="bmono" style="text-align:center;color:#00875a;font-weight:700">'+cnt.present+'</td><td class="bmono" style="text-align:center;color:#b45309;font-weight:700">'+cnt.late+'</td><td class="bmono" style="text-align:center;color:#c0392b;font-weight:700">'+cnt.absent+'</td><td class="bmono" style="text-align:center;color:#b45309;font-weight:700">'+cnt.sick+'</td><td class="bmono" style="text-align:center;color:#5b21b6;font-weight:700">'+cnt.holiday+'</td><td class="bmono" style="text-align:center;color:#b45309;font-weight:700">'+cnt.dayoff+'</td><td class="bmono" style="text-align:center">'+pct+'</td></tr>';});
    out.innerHTML='<div class="btw"><div class="btw-s"><table class="btbl"><thead><tr><th>Employee</th><th style="text-align:center">Total</th><th style="text-align:center;color:#00875a">P</th><th style="text-align:center;color:#b45309">L</th><th style="text-align:center;color:#c0392b">A</th><th style="text-align:center;color:#b45309">S</th><th style="text-align:center;color:#5b21b6">H</th><th style="text-align:center;color:#b45309">O</th><th style="text-align:center">Rate</th></tr></thead><tbody>'+(allRows||'<tr><td colspan="9" style="text-align:center;color:var(--text-tertiary);padding:20px">No records</td></tr>')+'</tbody></table></div></div>';
    return;
  }
  // Month view: show 1..N daily grid + summary
  var ymKey=yr+'-'+(mo<10?'0':'')+mo;
  var daysInMo=new Date(parseInt(yr),mo,0).getDate();
  var SC={present:'#00875a',late:'#b45309',absent:'#c0392b',sick:'#b45309',holiday:'#5b21b6',dayoff:'#94a3b8'};
  var SLAB={present:'P',late:'L',absent:'A',sick:'S',holiday:'H',dayoff:'O'};
  // Day header row
  var dayHdrs='';
  for(var di=1;di<=daysInMo;di++){
    var dt=new Date(parseInt(yr),mo-1,di);
    var dn=['Su','Mo','Tu','We','Th','Fr','Sa'][dt.getDay()];
    var isWeekend=dt.getDay()===5||dt.getDay()===6;
    dayHdrs+='<th style="text-align:center;font-size:9px;padding:4px 2px;min-width:24px'+(isWeekend?';color:#b45309':'')+'"><div style="font-weight:700">'+di+'</div><div style="font-size:8px;font-weight:400;color:var(--text-tertiary)">'+dn+'</div></th>';
  }
  var matrixRows='';
  BS.tsEmps.slice().sort(function(a,b){return a.name.localeCompare(b.name);}).forEach(function(emp){
    var recs=(BS.tsAtt[emp.id]&&BS.tsAtt[emp.id][ymKey])||[];
    var dayMap={};
    recs.forEach(function(r){if(r.date){var dd=r.date.slice(-2);dayMap[dd]=r.st;}});
    var cnt=countSt(recs);
    var dayCells='';
    for(var dj=1;dj<=daysInMo;dj++){
      var dStr=String(dj<10?'0'+dj:dj);
      var st=dayMap[dStr];
      if(st){
        var col=SC[st]||'#888';
        dayCells+='<td style="text-align:center;padding:3px 2px"><span style="display:inline-block;width:20px;height:20px;line-height:20px;border-radius:4px;background:'+col+'25;color:'+col+';font-size:10px;font-weight:700">'+(SLAB[st]||'?')+'</span></td>';
      } else {
        dayCells+='<td style="text-align:center;color:var(--text-tertiary);font-size:10px">\u2014</td>';
      }
    }
    matrixRows+='<tr><td style="position:sticky;left:0;background:var(--surface-1);z-index:1;min-width:160px"><div style="display:flex;align-items:center;gap:8px"><div class="bav">'+bini(emp.name)+'</div><div><div style="font-size:11px;font-weight:600">'+bxe(emp.name)+'</div><div style="font-size:9px;color:'+bdc(emp.dept||'FOH')+'">'+bxe(emp.dept||'')+'</div></div></div></td>'+dayCells+'<td style="text-align:center;font-family:var(--mono);color:#b45309;font-weight:700;background:var(--surface-1)">'+cnt.present+'</td><td style="text-align:center;font-family:var(--mono);color:#b45309">'+cnt.late+'</td><td style="text-align:center;font-family:var(--mono);color:#c0392b">'+cnt.absent+'</td></tr>';
  });
  // Legend
  var legend='<div style="display:flex;gap:14px;flex-wrap:wrap;margin-bottom:14px;font-size:11px;color:var(--text-secondary)">'+
    Object.keys(SC).map(function(k){return '<div style="display:flex;align-items:center;gap:6px"><span style="display:inline-block;width:18px;height:18px;line-height:18px;text-align:center;border-radius:4px;background:'+SC[k]+'25;color:'+SC[k]+';font-size:10px;font-weight:700">'+SLAB[k]+'</span> '+k.charAt(0).toUpperCase()+k.slice(1)+'</div>';}).join('')+'</div>';
  out.innerHTML=legend+'<div class="btw" style="overflow-x:auto"><table class="btbl" style="font-size:11px"><thead><tr><th style="position:sticky;left:0;background:var(--surface-2);z-index:2;min-width:160px">Employee</th>'+dayHdrs+'<th style="text-align:center;background:var(--surface-2);color:#b45309">P</th><th style="text-align:center;background:var(--surface-2);color:#b45309">L</th><th style="text-align:center;background:var(--surface-2);color:#c0392b">A</th></tr></thead><tbody>'+(matrixRows||'<tr><td colspan="'+(daysInMo+4)+'" style="text-align:center;color:var(--text-tertiary);padding:20px">No staff or no records</td></tr>')+'</tbody></table></div>';
  return;
}var emp=BS.tsEmps.find(function(e){return e.id===eid;});if(!emp){out.innerHTML='<div style="color:var(--danger);padding:12px">Employee not found.</div>';return;}var recs=getRecs(emp.id),cnt=countSt(recs),tot=recs.length,worked=cnt.present+cnt.late,pct=tot?Math.round(worked/tot*100)+'%':'\u2014';if(pb)pb.style.display='';var rows=recs.map(function(r){return '<tr><td class="bmono">'+bxe(r.date)+'</td><td class="bmono" style="text-align:center">'+(r.ci||'\u2014')+'</td><td class="bmono" style="text-align:center">'+(r.co||'\u2014')+'</td><td class="bmono" style="text-align:center;color:var(--info);font-weight:600">'+(r.brk||'\u2014')+'</td><td class="bmono" style="text-align:center">'+btsHrs(r.ci,r.co)+'</td><td>'+btsBadge(r.st)+'</td><td style="font-size:11px;color:var(--text-secondary)">'+(r.note||'')+'</td></tr>';}).join('');out.innerHTML='<div class="bcard" style="margin-bottom:14px"><div style="font-size:15px;font-weight:700">'+bxe(emp.name)+'</div><div style="font-size:11px;color:var(--ceo);margin-top:3px">'+bxe(emp.dept||'')+' \u00b7 '+(mo===0?'Full Year':MONTHS_FULL[mo-1])+' '+yr+'</div></div><div class="bgrid-4" style="margin-bottom:14px">'+[['Total',tot,'var(--text-primary)'],['Present',cnt.present,'#00875a'],['Absent',cnt.absent,'#c0392b'],['Rate',pct,'#00875a']].map(function(x){return '<div style="text-align:center;background:var(--surface-2);border:1px solid var(--border);border-radius:8px;padding:12px"><div class="bmono" style="font-size:22px;font-weight:300;color:'+x[2]+'">'+bxe(String(x[1]))+'</div><div style="font-size:9px;color:var(--text-tertiary);text-transform:uppercase;letter-spacing:1px;margin-top:3px">'+x[0]+'</div></div>';}).join('')+'</div>'+(recs.length?'<div class="btw"><div class="btw-s"><table class="btbl"><thead><tr><th>Date</th><th style="text-align:center">In</th><th style="text-align:center">Out</th><th style="text-align:center">Break</th><th style="text-align:center">Hours</th><th>Status</th><th>Note</th></tr></thead><tbody>'+rows+'</tbody></table></div></div>':'<div style="color:var(--text-tertiary);text-align:center;padding:28px;font-style:italic">No records for this period.</div>');}
function printBranchTsReport(){var eid=bgv('bts-r-emp'),mo=parseInt(bgv('bts-r-mo')),yr=bgv('bts-r-yr');if(!eid){showToast('Select an employee first','error');return;}var emp=BS.tsEmps.find(function(e){return e.id===eid;});if(!emp)return;var recs=[];if(mo===0){for(var mi=1;mi<=12;mi++){var k=yr+'-'+(mi<10?'0':'')+mi;recs=recs.concat((BS.tsAtt[emp.id]&&BS.tsAtt[emp.id][k])||[]);}}else{var k=yr+'-'+(mo<10?'0':'')+mo;recs=(BS.tsAtt[emp.id]&&BS.tsAtt[emp.id][k])||[];}var cnt={present:0,late:0,absent:0,sick:0,holiday:0,dayoff:0};recs.forEach(function(r){if(cnt[r.st]!==undefined)cnt[r.st]++;});var tot=recs.length,worked=cnt.present+cnt.late,pct=tot?Math.round(worked/tot*100)+'%':'\u2014';var TC={present:'#00875a',late:'#b45309',absent:'#c0392b',sick:'#b45309',holiday:'#5b21b6',dayoff:'#b45309'};var TL={present:'Present',late:'Late',absent:'Absent',sick:'Sick Leave',holiday:'Holiday',dayoff:'OFF'};var rows=recs.map(function(r,i){var col=TC[r.st]||'#888';return '<tr style="background:'+(i%2===0?'#fff':'#f8fafc')+'"><td style="padding:7px 10px;font-family:monospace;font-size:11px;color:#64748b">'+bxe(r.date)+'</td><td style="padding:7px 10px;text-align:center;font-weight:600;font-family:monospace">'+(r.ci||'\u2014')+'</td><td style="padding:7px 10px;text-align:center;font-weight:600;font-family:monospace">'+(r.co||'\u2014')+'</td><td style="padding:7px 10px;text-align:center;font-weight:600;font-family:monospace;color:#0057ff">'+(r.brk||'\u2014')+'</td><td style="padding:7px 10px;text-align:center;font-weight:700;font-family:monospace">'+btsHrs(r.ci,r.co)+'</td><td style="padding:7px 10px;text-align:center"><span style="background:'+col+'20;color:'+col+';border:1px solid '+col+'40;border-radius:20px;padding:2px 9px;font-size:10px;font-weight:700">'+(TL[r.st]||r.st)+'</span></td><td style="padding:7px 10px;font-size:11px;color:#64748b">'+(r.note||'')+'</td></tr>';}).join('');var s=NX.session||{};var moLabel=mo===0?'Full Year '+yr:MONTHS_FULL[mo-1]+' '+yr;var html='<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Timesheet \u2014 '+bxe(emp.name)+'</title><style>@page{size:A4;margin:10mm}*{box-sizing:border-box;margin:0;padding:0;font-family:Arial,Helvetica,sans-serif}body{background:#fff;color:#111;font-size:12px}table{width:100%;border-collapse:collapse}th{background:#1a2340;color:#fff;padding:8px 10px;text-align:left;font-size:9px;text-transform:uppercase;letter-spacing:1px}.c{text-align:center}.stats{display:grid;grid-template-columns:repeat(6,1fr);gap:8px;margin-bottom:16px}.stat{background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:10px 8px;text-align:center}.stat-n{font-size:22px;font-weight:300;font-family:monospace}.stat-l{font-size:9px;color:#64748b;text-transform:uppercase;letter-spacing:1px;margin-top:3px}.foot{margin-top:20px;display:grid;grid-template-columns:1fr 1fr 1fr;gap:30px}.foot-cell{border-top:1px solid #333;padding-top:5px;text-align:center;font-size:9px;color:#64748b}@media print{.np{display:none!important}}</style></head><body>';html+='<div style="display:flex;justify-content:space-between;align-items:flex-start;padding-bottom:10px;margin-bottom:16px;border-bottom:3px solid #1a2340"><div><img src="https://i.imgur.com/jeqtcE2.png" alt="ALFA.CO" style="height:44px;width:auto;display:block"><div style="font-size:10px;color:#64748b">'+bxe(s.branchName||s.entityName||'')+'</div></div><div style="text-align:center"><h1 style="font-size:16px;font-weight:800;color:#1a2340">Employee Timesheet</h1><p style="font-size:11px;color:#64748b">'+bxe(emp.name)+' \u00b7 '+bxe(emp.dept||'')+' \u00b7 '+bxe(moLabel)+'</p></div><div style="text-align:right;font-size:10px;color:#64748b"><div>Printed: '+new Date().toLocaleDateString('en-GB')+'</div><div>Work Rate: '+pct+'</div></div></div>';html+='<div class="stats"><div class="stat"><div class="stat-n" style="color:#1a2340">'+tot+'</div><div class="stat-l">Total</div></div><div class="stat"><div class="stat-n" style="color:#00875a">'+cnt.present+'</div><div class="stat-l">Present</div></div><div class="stat"><div class="stat-n" style="color:#b45309">'+cnt.late+'</div><div class="stat-l">Late</div></div><div class="stat"><div class="stat-n" style="color:#c0392b">'+cnt.absent+'</div><div class="stat-l">Absent</div></div><div class="stat"><div class="stat-n" style="color:#b45309">'+cnt.sick+'</div><div class="stat-l">Sick</div></div><div class="stat"><div class="stat-n" style="color:#00875a">'+pct+'</div><div class="stat-l">Rate</div></div></div>';html+=(recs.length?'<table><thead><tr><th>Date</th><th class="c">In</th><th class="c">Out</th><th class="c">Break</th><th class="c">Hours</th><th class="c">Status</th><th>Note</th></tr></thead><tbody>'+rows+'</tbody></table>':'<div style="text-align:center;padding:30px;color:#94a3b8;font-style:italic">No records.</div>');html+='<div class="foot"><div class="foot-cell">Employee Signature</div><div class="foot-cell">HR / Manager</div><div class="foot-cell">Date &amp; Stamp</div></div><div class="np" style="text-align:center;margin-top:20px"><button onclick="window.print()" style="background:#1a2340;color:#fff;border:none;border-radius:8px;padding:10px 28px;font-size:13px;font-weight:700;cursor:pointer">Print / Save PDF</button></div></body></html>';var w=window.open('','_blank','width=900,height=700');if(w){w.document.write(html);w.document.close();}else showToast('Allow pop-ups to print','error');}
function btsPgLeave(){var filt=BS.tsLTab==='all'?BS.tsLeaves:BS.tsLeaves.filter(function(l){return l.type===BS.tsLTab;});var pend=0,appr=0,rej=0;filt.forEach(function(l){if(l.status==='pending')pend++;else if(l.status==='approved')appr++;else rej++;});var eo='<option value="">Select</option>'+BS.tsEmps.slice().sort(function(a,b){return a.name.localeCompare(b.name);}).map(function(e){return '<option value="'+bxe(e.id)+'">'+bxe(e.name)+' ('+bxe(e.dept||'')+')</option>';}).join('');var lbar='<div style="display:flex;gap:6px;margin-bottom:16px">'+['all','sick','holiday','dayoff'].map(function(t){var l={all:'All',sick:'Sick',holiday:'Holiday',dayoff:'OFF'};return '<button class="bfbt'+(BS.tsLTab===t?' on':'')+'" onclick="BS.tsLTab=\''+t+'\';navTo(\'timesheet\')">'+l[t]+'</button>';}).join('')+'</div>';var rows=filt.slice().sort(function(a,b){return(b.start||'').localeCompare(a.start||'');}).map(function(l){var lt=TS_LT_BRANCH[l.type]||{l:l.type,c:'#888'};var emp=BS.tsEmps.find(function(e){return e.id===l.empId;});var sc=l.status==='approved'?'#00875a':l.status==='rejected'?'#c0392b':'#b45309';return '<tr><td style="font-weight:600;color:var(--text-primary)">'+bxe(emp?emp.name:'Unknown')+'</td><td>'+bpl(lt.l,lt.c)+'</td><td class="bmono">'+bxe(l.start)+'</td><td class="bmono">'+bxe(l.end)+'</td><td class="bmono" style="font-weight:600">'+bxe(l.days)+'d</td><td>'+bpl(l.status,sc)+'</td><td><div style="display:flex;gap:4px">'+(l.status==='pending'?'<button class="btn btn-sm" style="color:var(--success)" onclick="approveBranchLeave(\''+bxe(l.id)+'\')">Approve</button><button class="btn btn-sm" style="color:var(--danger)" onclick="rejectBranchLeave(\''+bxe(l.id)+'\')">Reject</button>':'')+'<button class="btn btn-sm" style="color:var(--danger)" onclick="delBranchLeave(\''+bxe(l.id)+'\')">Del</button></div></td></tr>';}).join('');var h='<div class="bcard" style="margin-bottom:16px"><div style="font-size:13px;font-weight:700;color:var(--ceo);margin-bottom:14px">New Leave Request</div><div class="bgrid-2" style="margin-bottom:12px"><div class="bfg" style="margin-bottom:0"><label class="form-label">Employee *</label><select class="form-input form-select" id="blf-emp">'+eo+'</select></div><div class="bfg" style="margin-bottom:0"><label class="form-label">Leave Type *</label><select class="form-input form-select" id="blf-type"><option value="sick">Sick Leave</option><option value="holiday">Annual Holiday</option><option value="dayoff">Day Off</option></select></div><div class="bfg" style="margin-bottom:0"><label class="form-label">Start Date *</label><input class="form-input" type="date" id="blf-start"></div><div class="bfg" style="margin-bottom:0"><label class="form-label">End Date *</label><input class="form-input" type="date" id="blf-end"></div></div><div class="bfg"><label class="form-label">Notes</label><input class="form-input" id="blf-note" placeholder="Optional reason"></div><button class="btn btn-primary" onclick="saveBranchLeave()">Submit Leave Request</button></div>'+lbar;h+='<div class="bgrid-4" style="margin-bottom:16px">'+[['Pending',pend,'#b45309'],['Approved',appr,'#00875a'],['Rejected',rej,'#c0392b'],['Total',filt.length,'var(--text-primary)']].map(function(x){return '<div style="text-align:center;background:var(--surface-2);border:1px solid '+x[2]+'30;border-radius:9px;padding:12px"><div class="bmono" style="font-size:24px;font-weight:300;color:'+x[2]+'">'+x[1]+'</div><div style="font-size:9px;color:var(--text-tertiary);margin-top:3px;text-transform:uppercase;letter-spacing:1px">'+x[0]+'</div></div>';}).join('')+'</div>';return h+'<div class="btw"><div class="btw-s"><table class="btbl"><thead><tr><th>Employee</th><th>Type</th><th>Start</th><th>End</th><th>Days</th><th>Status</th><th>Actions</th></tr></thead><tbody>'+(rows||'<tr><td colspan="7" style="text-align:center;color:var(--text-tertiary);padding:24px">No leave requests yet</td></tr>')+'</tbody></table></div></div>';}
function saveBranchLeave(){var eid=bgv('blf-emp'),type=bgv('blf-type'),start=bgv('blf-start'),end=bgv('blf-end');if(!eid||!start||!end){showToast('Fill all required fields','error');return;}var days=Math.max(1,Math.ceil((new Date(end+'T00:00:00')-new Date(start+'T00:00:00'))/86400000)+1);BS.tsLeaves.push({id:buid(),empId:eid,type:type,start:start,end:end,days:days,note:bgv('blf-note'),status:'pending'});bSaveColl('tsLeaves',BS.tsLeaves);showToast('Leave request submitted','success');BS.tsTab='leave';navTo('timesheet');}
function approveBranchLeave(id){var l=BS.tsLeaves.find(function(x){return x.id===id;});if(l)l.status='approved';bSaveColl('tsLeaves',BS.tsLeaves);showToast('Leave approved','success');navTo('timesheet');}
function rejectBranchLeave(id){var l=BS.tsLeaves.find(function(x){return x.id===id;});if(l)l.status='rejected';bSaveColl('tsLeaves',BS.tsLeaves);showToast('Leave rejected');navTo('timesheet');}
function delBranchLeave(id){if(!confirm('Delete this leave request?'))return;BS.tsLeaves=BS.tsLeaves.filter(function(x){return x.id!==id;});bSaveColl('tsLeaves',BS.tsLeaves);navTo('timesheet');}
function btsEditLeave(empId){
  var e=BS.tsEmps.find(function(x){return x.id===empId;});
  if(!e)return;
  var cur=e.leaveBalance||21;
  var v=prompt('Edit annual leave balance for '+e.name+'\nCurrent: '+cur+' days\n\nEnter new total (annual entitlement in days):',cur);
  if(v===null)return;
  var n=parseInt(v);
  if(isNaN(n)||n<0||n>365){showToast('Invalid value (must be 0–365)','error');return;}
  e.leaveBalance=n;
  if(db&&NX.session&&NX.session.branchId){
    db.ref(bPath('tsEmps')+'/'+empId+'/leaveBalance').set(n,function(err){
      if(err)showToast('Save failed','error');
      else showToast('Leave balance updated to '+n+' days ✓','success');
    });
  } else {
    showToast('Leave balance updated locally to '+n+' days','success');
  }
  navTo(NX.page);
}
function btsPgEmps(){var sorted=BS.tsEmps.slice().sort(function(a,b){return(a.dept||'').localeCompare(b.dept||'')||a.name.localeCompare(b.name);});var rows=sorted.map(function(e){var used=0;BS.tsLeaves.forEach(function(l){if(l.empId===e.id&&l.type==='holiday'&&l.status==='approved')used+=l.days;});var rem=(e.leaveBalance||21)-used;return '<tr><td><div style="display:flex;align-items:center;gap:10px"><div class="bav">'+bini(e.name)+'</div><div><div style="font-weight:600;font-size:12px">'+bxe(e.name)+'</div><div class="bmono" style="font-size:10px;color:var(--text-tertiary)">'+bxe(e.id)+'</div></div></div></td><td>'+bpl(e.dept||'\u2014',bdc(e.dept||'FOH'))+'</td><td style="font-size:11px">'+(e.phone?'<a href="tel:'+bxe(e.phone)+'" style="color:var(--ceo);text-decoration:none">'+bxe(e.phone)+'</a>':'<span style="color:var(--text-tertiary)">\u2014</span>')+'</td><td class="bmono" style="font-weight:600;color:'+(rem>5?'#00875a':rem>0?'#b45309':'#c0392b')+'">'+rem+' / '+(e.leaveBalance||21)+' days</td><td><button data-eid=\"'+bxe(e.id)+'\" onclick=\"btsEditLeave(this.dataset.eid)\" style=\"padding:3px 10px;border-radius:6px;border:1px solid var(--border);background:var(--surface-2);color:var(--text-secondary);font-size:11px;cursor:pointer\">✏ Edit</button></td></tr>';}).join('');return '<div class="bcard" style="margin-bottom:16px;border-color:rgba(52,211,153,.2)"><div style="font-weight:600;color:#b45309;margin-bottom:6px">Auto-Sync with Staff Page</div><div style="font-size:11px;color:var(--text-secondary)">'+BS.tsEmps.length+' / '+BS.staff.length+' staff synced.</div></div><div class="btw"><div class="btw-s"><table class="btbl"><thead><tr><th>Employee</th><th>Department</th><th>Phone</th><th>Leave Balance</th><th></th></tr></thead><tbody>'+(rows||'<tr><td colspan="5" style="text-align:center;color:var(--text-tertiary);padding:24px">No employees yet</td></tr>')+'</tbody></table></div></div>';}

// ── Health Cards ──────────────────────────────────────
function pHealthCards(){
  attachBranchListeners();
  var data=BS.health.filter(function(h2){return bmatch(h2,['name','sap','cardNo']);})
    .slice().sort(function(a,b){var da=bdrem(a.medExp),db=bdrem(b.medExp);if(da===null)return 1;if(db===null)return -1;return da-db;});
  var exp=0,soon=0,ok=0;
  BS.health.forEach(function(h2){var d=bdrem(h2.medExp);if(d===null)return;if(d<0)exp++;else if(d<=30)soon++;else ok++;});
  var rows=data.map(function(h2){
    return '<tr>'+
      '<td style="font-weight:600;color:var(--text-primary)">'+bxe(h2.name)+'</td>'+
      '<td class="bmono" style="color:var(--text-secondary);font-size:11px">'+bxe(h2.sap||'\u2014')+'</td>'+
      '<td class="bmono" style="color:var(--ceo);font-weight:600">'+bxe(h2.cardNo||'\u2014')+'</td>'+
      '<td class="bmono" style="color:var(--text-secondary);font-size:11px">'+bfdate(h2.medExp)+'</td>'+
      '<td>'+bremBadge(bdrem(h2.medExp))+'</td>'+
      '<td class="bmono" style="color:var(--text-secondary);font-size:11px">'+bfdate(h2.trainExp)+'</td>'+
      '<td>'+bremBadge(bdrem(h2.trainExp))+'</td>'+
      '<td><div style="display:flex;gap:4px">'+
        '<button class="btn btn-sm" onclick="openBranchHealthModal(\''+bxe(h2.id)+'\')">Edit</button>'+
        '<button class="btn btn-sm" style="color:var(--danger)" onclick="delBranchHealth(\''+bxe(h2.id)+'\')">Del</button>'+
      '</div></td></tr>';
  }).join('');
  var h='<div class="page-header"><h1>Health Cards</h1></div>';
  // Hijri ↔ Gregorian converter tool
  h+='<div class="bcard" style="margin-bottom:16px">';
  h+='<div style="font-size:12px;font-weight:700;color:var(--ceo);margin-bottom:10px;display:flex;align-items:center;gap:6px">🗓 Hijri ↔ Gregorian Date Converter</div>';
  h+='<div style="display:grid;grid-template-columns:1fr auto 1fr;gap:10px;align-items:end">';
  h+='<div><div style="font-size:10px;color:var(--text-tertiary);text-transform:uppercase;letter-spacing:.06em;margin-bottom:4px">Hijri Date (e.g. 1446-07-15)</div>';
  h+='<input id="conv-hijri" type="text" placeholder="YYYY-MM-DD" style="background:var(--surface-2);border:1px solid var(--border);border-radius:8px;padding:8px 10px;color:var(--text-primary);font-size:13px;font-family:var(--mono);outline:none;width:100%"></div>';
  h+='<div style="display:flex;flex-direction:column;gap:6px;padding-bottom:2px">';
  h+='<button onclick="convHijriToGreg()" style="padding:7px 14px;border-radius:8px;background:var(--ceo);border:none;color:#000;font-size:11px;font-weight:700;cursor:pointer">→ Greg</button>';
  h+='<button onclick="convGregToHijri()" style="padding:7px 14px;border-radius:8px;background:var(--surface-2);border:1px solid var(--border);color:var(--text-primary);font-size:11px;font-weight:700;cursor:pointer">← Hijri</button>';
  h+='</div>';
  h+='<div><div style="font-size:10px;color:var(--text-tertiary);text-transform:uppercase;letter-spacing:.06em;margin-bottom:4px">Gregorian Date</div>';
  h+='<input id="conv-greg" type="date" style="background:var(--surface-2);border:1px solid var(--border);border-radius:8px;padding:8px 10px;color:var(--text-primary);font-size:13px;font-family:var(--mono);outline:none;width:100%"></div>';
  h+='</div>';
  h+='<div id="conv-result" style="margin-top:8px;font-size:12px;color:var(--text-secondary);min-height:18px"></div>';
  h+='</div>';
  h+='<div class="bgrid-4" style="margin-bottom:16px">'+
    [['Total',BS.health.length,'var(--info)'],['Expired',exp,'#c0392b'],['Expiring Soon',soon,'#b45309'],['Valid',ok,'#00875a']]
    .map(function(x){return '<div class="bsc"><div class="bsc-lbl">'+x[0]+'</div><div class="bsc-val bmono" style="color:'+x[2]+'">'+x[1]+'</div></div>';}).join('')+'</div>';
  h+='<div class="header-actions"><div></div><div style="display:flex;gap:8px;flex-wrap:wrap">';
  h+='<button class="btn" onclick="exportHealthCards()" style="display:flex;align-items:center;gap:6px">'+
    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>Export CSV</button>';
  h+='<button class="btn" onclick="importHealthCardsClick()" style="display:flex;align-items:center;gap:6px">'+
    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>Import CSV</button>';
  h+='<input type="file" id="hc-import-file" accept=".csv" style="display:none" onchange="handleHealthImport(this)">';
  h+='<button class="btn" onclick="openBulkHealthModal()" style="display:flex;align-items:center;gap:6px">'+
    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>Bulk Add from Staff</button>';
  h+='<button class="btn btn-primary" onclick="openBranchHealthModal(null)" style="display:flex;align-items:center;gap:6px">'+
    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>Add Card</button>';
  h+='</div></div>';
  h+='<div class="btw"><div class="btw-s"><table class="btbl"><thead><tr><th>Employee</th><th>SAP #</th><th>Card #</th><th>Med Expiry</th><th>Med Left</th><th>Train Expiry</th><th>Train Left</th><th>Actions</th></tr></thead>'+
    '<tbody>'+(rows||'<tr><td colspan="8" style="text-align:center;color:var(--text-tertiary);padding:28px">\uD83D\uDCC4 No health cards yet \u2014 add one or bulk-import from staff list</td></tr>')+'</tbody></table></div></div>';
  return h;
}
function openBulkHealthModal(){
  var existing=BS.health.map(function(h){return h.name;});
  var missing=BS.staff.filter(function(m){return !existing.includes(m.name);});
  if(!missing.length){showToast('All staff already have health cards','success');return;}
  var rows=missing.map(function(m){
    return '<tr>'+
      '<td><input type="checkbox" class="bhb-chk" value="'+bxe(m.id)+'" checked style="width:16px;height:16px"></td>'+
      '<td style="font-weight:600">'+bxe(m.name)+'</td>'+
      '<td class="bmono" style="font-size:11px">'+bxe(m.sap||'\u2014')+'</td>'+
    '</tr>';
  }).join('');
  openModal('<div class="modal-head"><h2>\uD83D\uDCCB Bulk Add Health Cards</h2><button class="modal-close" onclick="closeModalForce()">\u2715</button></div>'+
    '<div style="font-size:12px;color:var(--text-secondary);margin-bottom:12px">'+missing.length+' staff without health cards. Select to create records:</div>'+
    '<div style="max-height:260px;overflow-y:auto;margin-bottom:14px"><table class="btbl"><thead><tr><th></th><th>Name</th><th>SAP</th></tr></thead><tbody>'+rows+'</tbody></table></div>'+
    '<div class="form-row"><div class="bfg"><label class="form-label">Medical Expiry (for all selected)</label><input class="form-input" type="date" id="bhb-med"></div>'+
      '<div class="bfg"><label class="form-label">Training Expiry</label><input class="form-input" type="date" id="bhb-train"></div></div>'+
    '<button class="btn btn-primary" style="width:100%;margin-top:8px" onclick="saveBulkHealth()">Create Health Cards</button>');
}
function saveBulkHealth(){
  var med=document.getElementById('bhb-med').value;
  var train=document.getElementById('bhb-train').value;
  if(!med){showToast('Medical expiry required','error');return;}
  var chks=document.querySelectorAll('.bhb-chk:checked');
  var count=0;
  chks.forEach(function(c){
    var m=BS.staff.find(function(x){return x.id===c.value;});
    if(m&&!BS.health.find(function(h){return h.name===m.name;})){
      BS.health.push({id:buid(),name:m.name,sap:m.sap||'',cardNo:'',medExp:med,trainExp:train});
      count++;
    }
  });
  bSaveColl('health',BS.health);closeModalForce();
  showToast(count+' health cards created','success');navTo('health-cards');
}
function openBranchHealthModal(id){var h2=id?BS.health.find(function(x){return x.id===id;}):null;var staffOpts='<option value="">Select\u2026</option>'+BS.staff.map(function(s2){return '<option value="'+bxe(s2.name)+'"'+(h2&&h2.name===s2.name?' selected':'')+'>'+bxe(s2.name)+'</option>';}).join('');var html='<div class="modal-head"><h2>'+(h2?'Edit Health Card':'Add Health Card')+'</h2><button class="modal-close" onclick="closeModalForce()">&#x2715;</button></div><div class="bfg"><label class="form-label">Employee *</label><select class="form-input form-select" id="bhc-name">'+staffOpts+'</select></div><div class="form-row"><div class="bfg"><label class="form-label">SAP #</label><input class="form-input" id="bhc-sap" value="'+bxe(h2?h2.sap:'')+'"></div><div class="bfg"><label class="form-label">Card # *</label><input class="form-input" id="bhc-card" value="'+bxe(h2?h2.cardNo:'')+'"></div></div><div class="form-row"><div class="bfg"><label class="form-label">Medical Expiry *</label><input class="form-input" type="date" id="bhc-med" value="'+bxe(h2?h2.medExp:'')+'"></div><div class="bfg"><label class="form-label">Training Expiry</label><input class="form-input" type="date" id="bhc-train" value="'+bxe(h2?h2.trainExp:'')+'"></div></div><button class="btn btn-primary" style="width:100%;margin-top:8px" onclick="saveBranchHealth(\''+bxe(id||'')+'\')">Save</button>';openModal(html);}
function saveBranchHealth(id){
  var name=bgv('bhc-name'),card=bgv('bhc-card'),med=bgv('bhc-med');
  if(!name||!card||!med){showToast('Name, card # and expiry required','error');return;}
  // Duplicate guard — prevent same name added twice
  if(!id && BS.health.find(function(h){return h.name===name;})){
    showToast('Health card already exists for '+name,'error');return;
  }
  var e={id:id||buid(),name:name,sap:bgv('bhc-sap'),cardNo:card,medExp:med,trainExp:bgv('bhc-train')};
  if(id){var i=BS.health.findIndex(function(x){return x.id===id;});if(i>=0)BS.health[i]=e;}
  else BS.health.push(e);
  bSaveColl('health',BS.health);closeModalForce();showToast('Health card saved','success');navTo('health-cards');
}
function delBranchHealth(id){if(!confirm('Delete this health card?'))return;BS.health=BS.health.filter(function(x){return x.id!==id;});bSaveColl('health',BS.health);showToast('Deleted');navTo('health-cards');}

// ── Health Cards Export ──────────────────────────────
function exportHealthCards(){
  var rows=BS.health;
  if(!rows.length){showToast('No health cards to export','error');return;}
  function normD(val){
    if(!val)return '';
    val=String(val).trim();
    if(/^\d{4}-\d{2}-\d{2}$/.test(val))return val;
    var p=val.split('/');
    if(p.length===3){var mo=parseInt(p[0],10),dy=parseInt(p[1],10),yr=parseInt(p[2],10);if(yr<100)yr+=2000;if(!isNaN(mo)&&!isNaN(dy)&&!isNaN(yr))return yr+'-'+String(mo).padStart(2,'0')+'-'+String(dy).padStart(2,'0');}
    return val;
  }
  var headers=['Name','SAP','Card No','Medical Expiry','Training Expiry'];
  var csv=headers.join(',')+'\n';
  rows.forEach(function(h2){
    csv+=[
      '"'+(h2.name||'').replace(/"/g,'""')+'"',
      '"'+(h2.sap||'').replace(/"/g,'""')+'"',
      '"'+(h2.cardNo||'').replace(/"/g,'""')+'"',
      '"'+normD(h2.medExp)+'"',
      '"'+normD(h2.trainExp)+'"'
    ].join(',')+'\n';
  });
  var blob=new Blob([csv],{type:'text/csv'});
  var url=URL.createObjectURL(blob);
  var a=document.createElement('a');
  var s=NX.session||{};
  var bname=(s.branchName||s.branchId||'branch').replace(/\s+/g,'_');
  a.href=url;a.download='health_cards_'+bname+'_'+new Date().toISOString().slice(0,10)+'.csv';
  a.click();URL.revokeObjectURL(url);
  showToast('Exported '+rows.length+' cards','success');
}

function importHealthCardsClick(){
  var el=document.getElementById('hc-import-file');
  if(el){el.value='';el.click();}
}

function handleHealthImport(input){
  var file=input.files[0];
  if(!file)return;
  var reader=new FileReader();
  reader.onload=function(e){
    var text=e.target.result;
    var lines=text.split(/\r?\n/).filter(function(l){return l.trim();});
    if(!lines.length){showToast('Empty file','error');return;}
    // Parse CSV header
    var header=lines[0].split(',').map(function(h2){return h2.replace(/^"|"$/g,'').trim().toLowerCase();});
    var iName=header.indexOf('name');
    var iSap=header.findIndex(function(h2){return h2==='sap'||h2==='sap #'||h2==='sap#';});
    var iCard=header.findIndex(function(h2){return h2==='card no'||h2==='card#'||h2==='cardno'||h2==='card number';});
    var iMed=header.findIndex(function(h2){return h2==='medical expiry'||h2==='med expiry'||h2==='medexp'||h2==='med exp';});
    var iTrain=header.findIndex(function(h2){return h2==='training expiry'||h2==='train expiry'||h2==='trainexp'||h2==='train exp';});
    if(iName<0||iMed<0){showToast('CSV must have Name and Medical Expiry columns','error');return;}
    function normalizeDate(val){
      if(!val)return '';
      val=val.trim();
      // Already YYYY-MM-DD
      if(/^\d{4}-\d{2}-\d{2}$/.test(val))return val;
      // M/D/YYYY or MM/DD/YYYY or M/D/YY
      var slashParts=val.split('/');
      if(slashParts.length===3){
        var mo=parseInt(slashParts[0],10),dy=parseInt(slashParts[1],10),yr=parseInt(slashParts[2],10);
        if(yr<100)yr+=2000;
        if(!isNaN(mo)&&!isNaN(dy)&&!isNaN(yr))
          return yr+'-'+String(mo).padStart(2,'0')+'-'+String(dy).padStart(2,'0');
      }
      // D-M-YYYY or M-D-YYYY with dashes
      var dashParts=val.split('-');
      if(dashParts.length===3&&dashParts[0].length<=2){
        var p0=parseInt(dashParts[0],10),p1=parseInt(dashParts[1],10),p2=parseInt(dashParts[2],10);
        if(!isNaN(p0)&&!isNaN(p1)&&!isNaN(p2))
          return p2+'-'+String(p0).padStart(2,'0')+'-'+String(p1).padStart(2,'0');
      }
      return val; // return as-is, let Firebase store it
    }
    var added=0,updated=0,skipped=0,errors=[];
    function parseCsvLine(line){
      var result=[],cur='',inQ=false;
      for(var i=0;i<line.length;i++){
        var ch=line[i];
        if(ch==='"'){if(inQ&&line[i+1]==='"'){cur+='"';i++;}else inQ=!inQ;}
        else if(ch===','&&!inQ){result.push(cur);cur='';}
        else cur+=ch;
      }
      result.push(cur);return result;
    }
    var newCards=[];
    for(var li=1;li<lines.length;li++){
      var cols=parseCsvLine(lines[li]);
      var name=(cols[iName]||'').replace(/^"|"$/g,'').trim();
      if(!name)continue;
      var medRaw=(iMed>=0?(cols[iMed]||''):'').replace(/^"|"$/g,'').trim();
      var medExp=normalizeDate(medRaw);
      var trainRaw=(iTrain>=0?(cols[iTrain]||''):'').replace(/^"|"$/g,'').trim();
      var trainExp=normalizeDate(trainRaw);
      var sap=(iSap>=0?(cols[iSap]||''):'').replace(/^"|"$/g,'').trim();
      var cardNo=(iCard>=0?(cols[iCard]||''):'').replace(/^"|"$/g,'').trim();
      newCards.push({name:name,sap:sap,cardNo:cardNo,medExp:medExp,trainExp:trainExp});
    }
    if(!newCards.length){showToast('No valid rows found in CSV','error');return;}
    // Show preview modal before saving
    var previewRows=newCards.slice(0,8).map(function(c){
      var existing=BS.health.find(function(h2){return h2.name===c.name;});
      var action=existing?'<span style="color:#b45309;font-size:10px;font-weight:700">UPDATE</span>':'<span style="color:#00875a;font-size:10px;font-weight:700">NEW</span>';
      return '<tr><td>'+bxe(c.name)+'</td><td class="bmono" style="font-size:11px">'+bxe(c.sap||'—')+'</td>'+
        '<td class="bmono" style="font-size:11px">'+bxe(c.cardNo||'—')+'</td>'+
        '<td class="bmono" style="font-size:11px">'+bxe(c.medExp||'—')+'</td>'+
        '<td class="bmono" style="font-size:11px">'+bxe(c.trainExp||'—')+'</td>'+
        '<td>'+action+'</td></tr>';
    }).join('');
    // Store for confirm button — avoid JSON-in-onclick issues with special chars
    window._hcImportPending=newCards;
    var moreMsg=newCards.length>8?'<div style="font-size:11px;color:var(--text-tertiary);margin-top:6px">…and '+(newCards.length-8)+' more rows</div>':'';
    var errMsg=errors.length?'<div style="background:rgba(192,57,43,.08);border:1px solid rgba(192,57,43,.2);border-radius:8px;padding:10px;margin-top:10px;font-size:11px;color:#c0392b">'+errors.join('<br>')+'</div>':'';
    openModal(
      '<div class="modal-head"><h2>'+
        '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;margin-right:6px"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>'+
        'Import Preview — '+newCards.length+' rows</h2>'+
        '<button class="modal-close" onclick="closeModalForce()">&#x2715;</button></div>'+
      '<div style="font-size:12px;color:var(--text-secondary);margin-bottom:10px">Review before saving. Existing records with same name will be updated.</div>'+
      '<div style="overflow-x:auto;max-height:260px;overflow-y:auto"><table class="btbl"><thead><tr><th>Name</th><th>SAP</th><th>Card No</th><th>Med Expiry</th><th>Train Expiry</th><th>Action</th></tr></thead><tbody>'+previewRows+'</tbody></table></div>'+
      moreMsg+errMsg+
      '<div style="display:flex;gap:8px;margin-top:14px">'+
        '<button class="btn" style="flex:1" onclick="closeModalForce()">Cancel</button>'+
        '<button class="btn btn-primary" style="flex:2" onclick="confirmHealthImport()">'+
          '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-1px;margin-right:5px"><polyline points="20 6 9 17 4 12"/></svg>'+
          'Confirm Import ('+newCards.length+' rows)</button>'+
      '</div>'
    );
  };
  reader.readAsText(file);
}

function confirmHealthImport(){
  var newCards=window._hcImportPending||[];
  if(!newCards.length){showToast('Nothing to import','error');return;}
  var added=0,updated=0;
  newCards.forEach(function(c){
    var idx=BS.health.findIndex(function(h2){return h2.name===c.name;});
    if(idx>=0){
      // Update existing — preserve id, update fields
      BS.health[idx]=Object.assign({},BS.health[idx],{
        sap:c.sap||BS.health[idx].sap,
        cardNo:c.cardNo||BS.health[idx].cardNo,
        medExp:c.medExp||BS.health[idx].medExp,
        trainExp:c.trainExp||BS.health[idx].trainExp
      });
      updated++;
    } else {
      BS.health.push({id:buid(),name:c.name,sap:c.sap||'',cardNo:c.cardNo||'',medExp:c.medExp||'',trainExp:c.trainExp||''});
      added++;
    }
  });
  bSaveColl('health',BS.health);
  window._hcImportPending=null;
  closeModalForce();
  showToast(added+' added, '+updated+' updated','success');
  navTo('health-cards');
}

// ── Hijri ↔ Gregorian converter ──────────────────────
function hijriToGregorian(hy,hm,hd){
  // Approximate Hijri to Gregorian conversion
  var jd=Math.floor((11*hy+3)/30)+354*hy+30*hm-Math.floor((hm-1)/2)+hd+1948440-385;
  var l=jd+68569;
  var n=Math.floor(4*l/146097);
  l=l-Math.floor((146097*n+3)/4);
  var i=Math.floor(4000*(l+1)/1461001);
  l=l-Math.floor(1461*i/4)+31;
  var j=Math.floor(80*l/2447);
  var day=l-Math.floor(2447*j/80);
  l=Math.floor(j/11);
  var month=j+2-12*l;
  var year=100*(n-49)+i+l;
  return {y:year,m:month,d:day};
}
function gregorianToHijri(gy,gm,gd){
  // Approximate Gregorian to Hijri conversion
  var jd=Math.floor((1461*(gy+4800+Math.floor((gm-14)/12)))/4)+Math.floor((367*(gm-2-12*Math.floor((gm-14)/12)))/12)-Math.floor((3*Math.floor((gy+4900+Math.floor((gm-14)/12))/100))/4)+gd-32075;
  var l=jd-1948440+10632;
  var n=Math.floor((l-1)/10631);
  l=l-10631*n+354;
  var j=(Math.floor((10985-l)/5316))*(Math.floor((50*l)/17719))+(Math.floor(l/5670))*(Math.floor((43*l)/15238));
  l=l-(Math.floor((30-j)/15))*(Math.floor((17719*j)/50))-(Math.floor(j/16))*(Math.floor((15238*j)/43))+29;
  var month=Math.floor((24*(l-29))/709);
  var day=l-Math.floor((709*month)/24);
  var year=30*n+j-100;
  return {y:year,m:month,d:day};
}
function convHijriToGreg(){
  var val=(document.getElementById('conv-hijri')||{}).value||'';
  var parts=val.trim().split('-');
  if(parts.length!==3){document.getElementById('conv-result').textContent='Please enter Hijri date as YYYY-MM-DD';return;}
  var hy=parseInt(parts[0]),hm=parseInt(parts[1]),hd=parseInt(parts[2]);
  if(isNaN(hy)||isNaN(hm)||isNaN(hd)||hm<1||hm>12||hd<1||hd>30){document.getElementById('conv-result').textContent='Invalid Hijri date';return;}
  var g=hijriToGregorian(hy,hm,hd);
  var gStr=g.y+'-'+String(g.m).padStart(2,'0')+'-'+String(g.d).padStart(2,'0');
  var el=document.getElementById('conv-greg');if(el)el.value=gStr;
  document.getElementById('conv-result').textContent='✓ '+hy+'/'+hm+'/'+hd+' Hijri = '+gStr+' Gregorian';
}
function convGregToHijri(){
  var val=(document.getElementById('conv-greg')||{}).value||'';
  if(!val){document.getElementById('conv-result').textContent='Please pick a Gregorian date';return;}
  var parts=val.split('-');
  var gy=parseInt(parts[0]),gm=parseInt(parts[1]),gd=parseInt(parts[2]);
  var h=gregorianToHijri(gy,gm,gd);
  var hStr=h.y+'-'+String(h.m).padStart(2,'0')+'-'+String(h.d).padStart(2,'0');
  var el=document.getElementById('conv-hijri');if(el)el.value=hStr;
  document.getElementById('conv-result').textContent='✓ '+val+' Gregorian = '+hStr+' Hijri';
}

// ── Sales ─────────────────────────────────────────────
function pSales() {
  attachBranchListeners();
  var now=new Date(),cy=now.getFullYear(),ly=cy-1,tm=bmthKey(0),lm=bmthKey(-1);
  var dow=now.getDay();
  function dsOf(d){return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');}
  var thisWkStart=new Date(now);thisWkStart.setDate(now.getDate()-dow);thisWkStart.setHours(0,0,0,0);
  var lastWkStart=new Date(thisWkStart);lastWkStart.setDate(thisWkStart.getDate()-7);
  var lastWkEnd=new Date(thisWkStart);lastWkEnd.setDate(thisWkStart.getDate()-1);
  var todayStr=dsOf(now),twsStr=dsOf(thisWkStart),lwsStr=dsOf(lastWkStart),lweStr=dsOf(lastWkEnd);
  var lwDayStr=dsOf(new Date(now.getTime()-7*86400000));
  var tA=0,tT=0,lmA=0,lmT=0,thisWk=0,lastWk=0,wkT=0,lastWkT=0,ytdA=0,ytdT=0,ytdLY=0;
  BS.sales.forEach(function(e){
    if(!e.date)return;
    var a=+e.actual||0,t=+e.target||0;
    if(e.date.indexOf(tm)===0){tA+=a;tT+=t;}
    if(e.date.indexOf(lm)===0){lmA+=a;lmT+=t;}
    if(e.date>=twsStr&&e.date<=todayStr){thisWk+=a;wkT+=t;}
    if(e.date>=lwsStr&&e.date<=lweStr){lastWk+=a;lastWkT+=t;}
    if(e.date.slice(0,4)===String(cy)){ytdA+=a;ytdT+=t;}
    if(e.date.slice(0,4)===String(ly))ytdLY+=a;
  });

  function pct(a,b){if(!b)return null;return((a-b)/b*100).toFixed(1);}
  function arrow(v,sz){
    if(v===null)return '<span style="color:var(--text-tertiary)">—</span>';
    sz=sz||'22px';
    var up=parseFloat(v)>=0;
    return '<span style="color:'+(up?'#00875a':'#c0392b')+';font-size:'+sz+';font-weight:700;font-family:var(--mono)">'+(up?'+':'')+v+'%</span>';
  }
  function pbar(val,tot,col){
    var w=tot>0?Math.min(100,val/tot*100):0;
    return '<div style="height:5px;background:var(--surface-3);border-radius:99px;overflow:hidden;margin-top:6px"><div style="height:100%;width:'+w.toFixed(1)+'%;background:'+col+';border-radius:99px;transition:width .6s"></div></div>'
      +'<div style="font-size:9px;color:var(--text-tertiary);font-family:var(--mono);margin-top:3px">'+bfsar(val)+' / '+bfsar(tot)+' ('+(tot>0?(val/tot*100).toFixed(1):0)+'%)</div>';
  }

  var s=NX.session||{};
  var h='<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">';
  h+='<div style="font-size:11px;font-weight:700;color:var(--text-tertiary);text-transform:uppercase;letter-spacing:.08em;font-family:var(--mono)">All Entries</div>';
  h+='<div style="display:flex;gap:8px"><button class="btn" onclick="openSalesBulkModal()" style="display:flex;align-items:center;gap:6px"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg> Bulk Import</button><button class="btn btn-primary" onclick="openBranchSalesModal(null)">+ Add Sales</button></div></div>';

  // ── ROW 1: 4 KPI cards ──
  h+='<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:10px">';
  h+='<div class="card"><div class="bsc-lbl">THIS MONTH</div><div class="bsc-val bcgold" style="font-size:24px;font-weight:300">'+bfsar(tA)+'</div><div class="bsc-sub">'+(tT>0?(tA/tT*100).toFixed(1)+'% of target':'No target set')+'</div></div>';
  h+='<div class="card"><div class="bsc-lbl">MONTHLY TARGET</div><div class="bsc-val" style="font-size:24px;font-weight:300;color:var(--text-secondary)">'+bfsar(tT)+'</div><div class="bsc-sub">'+tm+'</div></div>';
  h+='<div class="card"><div class="bsc-lbl">VS LAST MONTH</div>'+arrow(pct(tA,lmA),'28px')+'<div class="bsc-sub" style="margin-top:4px">Last: '+bfsar(lmA)+'</div></div>';
  h+='<div class="card"><div class="bsc-lbl">WEEK VS LAST WEEK</div>'+arrow(pct(thisWk,lastWk),'28px')+'<div class="bsc-sub" style="margin-top:4px">Last: '+bfsar(lastWk)+'</div></div>';
  h+='</div>';

  // ── ROW 2: YTD large / YTD Target / Year vs Year ──
  h+='<div style="display:grid;grid-template-columns:2fr 1fr 1fr;gap:10px;margin-bottom:10px">';
  h+='<div class="card"><div class="bsc-lbl">YEAR TO DATE '+cy+'</div><div class="bsc-val bcgold" style="font-size:28px;font-weight:300">'+bfsar(ytdA)+'</div><div class="bsc-sub">'+(ytdT>0?(ytdA/ytdT*100).toFixed(1)+'% of YTD target':'')+'</div></div>';
  h+='<div class="card"><div class="bsc-lbl">YTD TARGET '+cy+'</div><div class="bsc-val" style="font-size:22px;font-weight:300;color:var(--text-secondary)">'+bfsar(ytdT)+'</div><div class="bsc-sub">Sum of monthly targets</div></div>';
  h+='<div class="card"><div class="bsc-lbl">'+cy+' VS '+ly+'</div>'+arrow(pct(ytdA,ytdLY),'28px')+'<div class="bsc-sub" style="margin-top:4px">Last year: '+bfsar(ytdLY)+'</div></div>';
  h+='</div>';

  // ── ROW 3: Last 7 Days + Year Monthly Comparison ──
  // Last 7 days bars with budget comparison
  var chartDays=[];
  for(var dd=6;dd>=0;dd--){var d2=new Date(now.getTime()-dd*86400000);chartDays.push({date:d2,ds:dsOf(d2),sales:0,budget:0});}
  BS.sales.forEach(function(e){chartDays.forEach(function(d2){if(e.date===d2.ds){d2.sales+=(+e.actual||0);d2.budget+=(+e.target||0);}});});
  var maxSales=Math.max.apply(null,chartDays.map(function(d2){return Math.max(d2.sales,d2.budget);}))||1;
  var bars7=chartDays.map(function(d2){
    var bh=Math.max(4,Math.round(d2.sales/maxSales*80));
    var bBudget=Math.max(2,Math.round(d2.budget/maxSales*80));
    var isToday=d2.ds===todayStr;
    return '<div style="display:flex;flex-direction:column;align-items:center;gap:4px;flex:1">'
      +'<div style="height:80px;display:flex;align-items:flex-end;gap:1px;width:100%">'
      +'<div style="flex:1;height:'+bh+'px;background:#4a5568;border-radius:2px 2px 0 0;min-height:4px"></div>'
      +'<div style="flex:1;height:'+bBudget+'px;background:#b45309;border-radius:2px 2px 0 0;min-height:2px;opacity:.85"></div>'
      +'</div>'
      +'<div style="font-size:9px;color:'+(isToday?'var(--ceo)':'var(--text-secondary)')+';font-family:var(--mono);white-space:nowrap;font-weight:'+(isToday?'700':'400')+'">'+d2.ds.slice(5).replace('-',' ')+'</div>'
      +'</div>';
  }).join('');
  // Monthly comparison bars
  var MONTHS=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  var cyData={},lyData={};
  BS.sales.forEach(function(e){
    if(!e.date)return;
    var yr=e.date.slice(0,4),mo=e.date.slice(5,7);
    if(yr===String(cy)){if(!cyData[mo])cyData[mo]=0;cyData[mo]+=(+e.actual||0);}
    if(yr===String(ly)){if(!lyData[mo])lyData[mo]=0;lyData[mo]+=(+e.actual||0);}
  });
  var allVals=[];MONTHS.forEach(function(_,i){var m=String(i+1).padStart(2,'0');allVals.push(cyData[m]||0,lyData[m]||0);});
  var maxM=Math.max.apply(null,allVals)||1;
  var monthlyBars=MONTHS.map(function(mn,i){
    var m=String(i+1).padStart(2,'0');var cy2=cyData[m]||0;var ly2=lyData[m]||0;
    var hc=Math.max(2,Math.round(cy2/maxM*70));var hl=Math.max(2,Math.round(ly2/maxM*70));
    return '<div style="display:flex;flex-direction:column;align-items:center;gap:2px;flex:1">'
      +'<div style="height:70px;display:flex;align-items:flex-end;gap:1px;width:100%">'
      +'<div style="flex:1;height:'+hc+'px;background:#4a5568;border-radius:2px 2px 0 0;min-height:2px"></div>'
      +'<div style="flex:1;height:'+hl+'px;background:#b45309;border-radius:2px 2px 0 0;min-height:2px;opacity:.85"></div>'
      +'</div><div style="font-size:8px;color:var(--text-secondary);font-family:var(--mono)">'+mn+'</div></div>';
  }).join('');

  h+='<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px">';
  h+='<div class="card"><div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px"><div style="font-size:11px;font-weight:700">Last 7 Days</div><div style="display:flex;gap:8px;font-size:9px"><span style="color:#4a5568">■ Sales</span><span style="color:#b45309">■ Budget</span></div></div>';
  h+='<div style="display:flex;align-items:flex-end;gap:3px;height:96px">'+bars7+'</div></div>';
  h+='<div class="card"><div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">';
  h+='<div style="font-size:11px;font-weight:700">'+cy+' vs '+ly+' — Monthly</div>';
  h+='<div style="display:flex;gap:8px;font-size:9px"><span style="color:#4a5568">■ '+cy+'</span><span style="color:#b45309">■ '+ly+'</span></div></div>';
  h+='<div style="display:flex;align-items:flex-end;gap:2px;height:80px">'+monthlyBars+'</div></div>';
  h+='</div>';

  // ── ROW 4: Progress + YTD Progress (identical to index.html) ──
  h+='<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px">';
  // Monthly Progress card
  h+='<div class="card"><div style="font-size:11px;font-weight:700;margin-bottom:10px">Progress</div>';
  h+='<div style="font-size:10px;color:var(--text-tertiary);font-weight:600;margin-bottom:4px">Monthly Progress</div>';
  h+=pbar(tA,tT,'linear-gradient(90deg,#92400e,#065f46)');
  h+='<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:12px">';
  h+='<div style="background:var(--surface-2);border-radius:7px;padding:10px"><div class="bmono" style="font-size:9px;color:var(--text-tertiary);text-transform:uppercase;letter-spacing:.5px">THIS WEEK</div>';
  h+='<div class="bmono" style="font-size:18px;font-weight:700;color:var(--ceo)">'+bfsar(thisWk)+'</div>';
  h+='<div style="font-size:9px;color:var(--text-tertiary)">Target: '+bfsar(wkT)+'</div></div>';
  h+='<div style="background:var(--surface-2);border-radius:7px;padding:10px"><div class="bmono" style="font-size:9px;color:var(--text-tertiary);text-transform:uppercase;letter-spacing:.5px">LAST WEEK</div>';
  h+='<div class="bmono" style="font-size:18px;font-weight:700;color:var(--text-secondary)">'+bfsar(lastWk)+'</div>';
  h+='<div style="font-size:9px;color:var(--text-tertiary)">Target: '+bfsar(lastWkT)+'</div></div>';
  h+='</div></div>';
  // YTD Progress card
  h+='<div class="card"><div style="font-size:11px;font-weight:700;margin-bottom:10px">YTD Progress '+cy+'</div>';
  h+='<div style="font-size:10px;color:var(--text-tertiary);font-weight:600;margin-bottom:4px">Year to Date</div>';
  h+=pbar(ytdA,ytdT,'linear-gradient(90deg,#f59e0b,var(--ceo))');
  h+='<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:12px">';
  h+='<div style="background:var(--surface-2);border-radius:7px;padding:10px"><div class="bmono" style="font-size:9px;color:var(--text-tertiary);text-transform:uppercase;letter-spacing:.5px">YTD ACTUAL</div>';
  h+='<div class="bmono" style="font-size:18px;font-weight:700;color:var(--ceo)">'+bfsar(ytdA)+'</div>';
  h+='<div style="font-size:9px;color:var(--text-tertiary)">'+arrow(pct(ytdA,ytdLY))+' vs '+ly+'</div></div>';
  h+='<div style="background:var(--surface-2);border-radius:7px;padding:10px"><div class="bmono" style="font-size:9px;color:var(--text-tertiary);text-transform:uppercase;letter-spacing:.5px">YTD TARGET</div>';
  h+='<div class="bmono" style="font-size:18px;font-weight:700;color:var(--text-secondary)">'+bfsar(ytdT)+'</div>';
  h+='<div style="font-size:9px;color:var(--text-tertiary)">'+cy+' plan</div></div>';
  h+='</div></div>';
  h+='</div>';

  // -- Delivery KPI row --
  var totDel=0;
  BS.sales.forEach(function(e){if(e.date&&e.date.indexOf(tm)===0){totDel+=(+e.delivery||0);}});
  var totDinein=tA-totDel;
  h+='<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px">';
  h+='<div class="card" style="border-left:3px solid #f97316"><div class="bsc-lbl">DELIVERY MTD</div><div class="bsc-val" style="font-size:22px;font-weight:300;color:#f97316">'+bfsar(totDel)+'</div><div class="bsc-sub">'+(tA>0?(totDel/tA*100).toFixed(1)+'% of total sales':'No sales yet')+'</div></div>';
  h+='<div class="card" style="border-left:3px solid var(--ceo)"><div class="bsc-lbl">DINE-IN MTD</div><div class="bsc-val" style="font-size:22px;font-weight:300;color:var(--ceo)">'+bfsar(totDinein)+'</div><div class="bsc-sub">'+(tA>0?(totDinein/tA*100).toFixed(1)+'% of total sales':'No sales yet')+'</div></div>';
  h+='</div>';

  // -- Entries table --
  var rows=BS.sales.slice().sort(function(a,b){return(b.date||'').localeCompare(a.date||'');}).map(function(e){
    var df=(+e.actual||0)-(+e.target||0);var dfc=df>=0?'#00875a':'#c0392b';var p=e.target>0?((+e.actual||0)/(+e.target||0)*100).toFixed(1)+'%':'\u2014';
    var del=+e.delivery||0;var delTxt=del>0?'<span style="color:#f97316;font-family:var(--mono)">'+bfsar(del)+'</span>':'<span style="color:var(--text-tertiary)">\u2014</span>';
    return '<tr><td class="bmono" style="color:var(--text-tertiary);font-size:11px">'+bfdate(e.date)+'</td>'
      +'<td class="bmono" style="font-weight:700;color:var(--ceo)">'+bfsar(e.actual)+'</td>'
      +'<td class="bmono" style="color:var(--text-secondary)">'+bfsar(e.target)+'</td>'
      +'<td>'+delTxt+'</td>'
      +'<td class="bmono"><span style="color:'+dfc+' !important;font-weight:700">'+(df>=0?'+':'')+bfsar(df)+'</span></td>'
      +'<td class="bmono"><span style="color:'+dfc+' !important;font-weight:700">'+bxe(p)+'</span></td>'
      +'<td><div style="display:flex;gap:4px"><button class="btn btn-sm" onclick="openBranchSalesModal(\''+bxe(e.id)+'\')">Edit</button><button class="btn btn-sm" style="color:var(--danger)" onclick="delBranchSales(\''+bxe(e.id)+'\')">Del</button></div></td></tr>';
  }).join('');
  h+='<div style="font-size:11px;font-weight:700;color:var(--text-tertiary);text-transform:uppercase;letter-spacing:.08em;font-family:var(--mono);margin-bottom:6px">All Entries</div>';
  h+='<div class="btw"><div class="btw-s"><table class="btbl"><thead><tr><th>Date</th><th>Actual</th><th>Target</th><th style="color:#f97316">Delivery</th><th>Variance</th><th>Achievement</th><th></th></tr></thead>';
  h+='<tbody>'+(rows||'<tr><td colspan="7" style="text-align:center;color:var(--text-tertiary);padding:24px">No entries yet</td></tr>')+'</tbody></table></div></div>';
  return h;
}

function openBranchSalesModal(id){
  var e=id?BS.sales.find(function(x){return x.id===id;}):null;
  var html='<div class="modal-head"><h2>'+(e?'Edit Sales Entry':'Add Sales Entry')+'</h2>'
    +'<button class="modal-close" onclick="closeModalForce()">&#x2715;</button></div>'
    +'<div class="bfg"><label class="form-label">Date *</label>'
    +'<input class="form-input" type="date" id="bsl-date" value="'+(e?e.date:TODAY_BS)+'"></div>'
    +'<div class="form-row">'
    +'<div class="bfg"><label class="form-label">Actual Sales (SAR) *</label>'
    +'<input class="form-input" type="number" step="0.01" id="bsl-actual" value="'+(e?e.actual:'')+"" +' placeholder="0.00"></div>'
    +'<div class="bfg"><label class="form-label">Sales Target (SAR) *</label>'
    +'<input class="form-input" type="number" step="0.01" id="bsl-target" value="'+(e?e.target:'')+"" +' placeholder="0.00"></div></div>'
    +'<div class="bfg"><label class="form-label">Delivery Sales (SAR) '
    +'<span style="color:var(--text-tertiary);font-weight:400;font-size:10px">optional · auto-filled from DSR</span></label>'
    +'<input class="form-input" type="number" step="0.01" id="bsl-delivery" value="'+(e&&e.delivery?e.delivery:'')+"" +' placeholder="0.00"></div>'
    +'<button class="btn btn-primary" style="width:100%;margin-top:8px"'
    +' onclick="saveBranchSales(\''+bxe(id||'')+'\')">' +'Save Entry</button>';
  openModal(html);
}

function openSalesBulkModal(){
  var html='<div class="modal-head"><h2>📥 Bulk Sales Import</h2><button class="modal-close" onclick="closeModalForce()">✕</button></div>';
  html+='<p style="font-size:11px;color:var(--text-secondary);margin-bottom:12px">Drag & drop a CSV file or paste data below. Format: <code style="background:var(--surface-2);padding:1px 5px;border-radius:4px">Date, Actual, Target</code> — one row per day.</p>';
  
  // Drop zone
  html+='<div id="sales-drop-zone" style="border:2px dashed var(--border);border-radius:12px;padding:28px;text-align:center;cursor:pointer;transition:all .2s;margin-bottom:12px;background:var(--surface-2)" onclick="document.getElementById(\'sales-file-inp\').click()" ondragover="event.preventDefault();this.style.borderColor=\'var(--primary)\';this.style.background=\'rgba(0,102,102,.06)\'" ondragleave="this.style.borderColor=\'var(--border)\';this.style.background=\'var(--surface-2)\'" ondrop="handleSalesDrop(event)">';
  html+='<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--primary)" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" style="margin:0 auto 8px;display:block"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>';
  html+='<div style="font-size:13px;font-weight:700;color:var(--text-primary);font-family:var(--font)">Drop CSV file here</div>';
  html+='<div style="font-size:11px;color:var(--text-secondary);margin-top:4px">or click to browse · .csv or .txt</div>';
  html+='<input type="file" id="sales-file-inp" accept=".csv,.txt" style="display:none" onchange="handleSalesFile(this.files[0])">';
  html+='</div>';

  // Paste area
  html+='<div style="margin-bottom:10px">';
  html+='<label style="font-size:10px;font-weight:700;color:var(--text-secondary);text-transform:uppercase;letter-spacing:.08em;display:block;margin-bottom:4px">Or paste data directly</label>';
  html+='<textarea id="sales-paste-area" rows="5" style="width:100%;background:var(--surface-2);border:1px solid var(--border);border-radius:8px;padding:10px;font-family:var(--mono);font-size:11px;color:var(--text-primary);resize:vertical;box-sizing:border-box" placeholder="2026-01-01, 15000, 18000&#10;2026-01-02, 12500, 18000&#10;2026-01-03, 17200, 18000"></textarea>';
  html+='</div>';

  // Preview table
  html+='<div id="sales-import-preview" style="margin-bottom:12px"></div>';

  html+='<div style="display:flex;gap:8px">';
  html+='<button class="btn" style="flex:1" onclick="previewSalesImport()">👁 Preview</button>';
  html+='<button class="btn btn-primary" style="flex:2" onclick="confirmSalesImport()">✓ Import All</button>';
  html+='</div>';
  
  openModal(html);
  window._salesImportRows=[];
}

function handleSalesDrop(e){
  e.preventDefault();
  var dz=document.getElementById('sales-drop-zone');
  dz.style.borderColor='var(--border)';dz.style.background='var(--surface-2)';
  var f=e.dataTransfer.files[0];
  if(f) handleSalesFile(f);
}

function handleSalesFile(f){
  if(!f)return;
  var reader=new FileReader();
  reader.onload=function(ev){
    var txt=ev.target.result;
    document.getElementById('sales-paste-area').value=txt;
    previewSalesImport();
  };
  reader.readAsText(f);
}

function parseSalesCSV(txt){
  var rows=[];
  var lines=txt.split(/\r?\n/).filter(function(l){return l.trim();});
  lines.forEach(function(line,idx){
    // Skip header row
    if(idx===0&&isNaN(parseFloat(line.split(/[,\t]/)[1])))return;
    var parts=line.split(/[,\t]/).map(function(p){return p.trim().replace(/["']/g,'');});
    if(parts.length<2)return;
    var date=parts[0];
    // Validate date format
    if(!/^\d{4}-\d{2}-\d{2}$/.test(date))return;
    var actual=parseFloat(parts[1])||0;
    var target=parseFloat(parts[2])||0;
    if(actual>0) rows.push({date:date,actual:actual,target:target});
  });
  return rows;
}

function previewSalesImport(){
  var txt=document.getElementById('sales-paste-area').value||'';
  var rows=parseSalesCSV(txt);
  window._salesImportRows=rows;
  var prev=document.getElementById('sales-import-preview');
  if(!prev)return;
  if(!rows.length){
    prev.innerHTML='<div style="text-align:center;padding:12px;color:var(--text-secondary);font-size:11px">No valid rows found. Check format: YYYY-MM-DD, Actual, Target</div>';
    return;
  }
  // Check for duplicates
  var tbl='<div style="max-height:200px;overflow-y:auto;border-radius:8px;border:1px solid var(--border)">';
  tbl+='<table class="btbl" style="margin:0"><thead><tr><th>Date</th><th>Actual</th><th>Target</th><th>Status</th></tr></thead><tbody>';
  rows.forEach(function(r){
    var exists=BS.sales.some(function(s){return s.date===r.date;});
    tbl+='<tr style="'+(exists?'background:rgba(254,153,0,.08)':'')+'">'+
      '<td style="font-family:var(--mono);font-size:11px">'+bxe(r.date)+'</td>'+
      '<td style="font-family:var(--mono)">'+bfsar(r.actual)+'</td>'+
      '<td style="font-family:var(--mono);color:var(--text-secondary)">'+bfsar(r.target)+'</td>'+
      '<td style="font-size:10px">'+(exists?'<span style="color:#b45309">⚠ Will overwrite</span>':'<span style="color:#00875a">✓ New</span>')+'</td>'+
    '</tr>';
  });
  tbl+='</tbody></table></div>';
  tbl+='<div style="font-size:10px;color:var(--text-secondary);margin-top:6px;font-family:var(--mono)">'+rows.length+' row(s) ready to import</div>';
  prev.innerHTML=tbl;
}

function confirmSalesImport(){
  var rows=window._salesImportRows||[];
  if(!rows.length){showToast('Nothing to import — click Preview first','error');return;}
  var added=0,updated=0;
  rows.forEach(function(r){
    var idx=BS.sales.findIndex(function(s){return s.date===r.date;});
    if(idx>=0){BS.sales[idx].actual=r.actual;BS.sales[idx].target=r.target;updated++;}
    else{BS.sales.push({id:buid(),date:r.date,actual:r.actual,target:r.target});added++;}
  });
  bSaveColl('sales',BS.sales);
  closeModalForce();
  showToast('✓ Imported '+added+' new, updated '+updated,'success');
  navTo('sales');
}

function saveBranchSales(id){
  var dt=bgv('bsl-date'),a=bgv('bsl-actual'),t=bgv('bsl-target');
  if(!dt||!a||!t){showToast('All fields required','error');return;}
  var del=parseFloat(bgv('bsl-delivery')||0)||0;
  if(id){
    var i=BS.sales.findIndex(function(x){return x.id===id;});
    if(i>=0){
      BS.sales[i].date=dt;BS.sales[i].actual=parseFloat(a);BS.sales[i].target=parseFloat(t);
      if(del>0)BS.sales[i].delivery=del;else delete BS.sales[i].delivery;
    }
  }else{
    BS.sales=BS.sales.filter(function(s2){return s2.date!==dt;});
    var entry={id:buid(),date:dt,actual:parseFloat(a),target:parseFloat(t)};
    if(del>0)entry.delivery=del;
    BS.sales.push(entry);
  }
  bSaveColl('sales',BS.sales);closeModalForce();showToast('Sales saved','success');navTo('sales');
}
function delBranchSales(id){if(!confirm('Delete this sales entry?'))return;BS.sales=BS.sales.filter(function(x){return x.id!==id;});bSaveColl('sales',BS.sales);showToast('Deleted');navTo('sales');}

// ── Petty Cash ────────────────────────────────────────
function pPettyCash(){
  attachBranchListeners();
  // Ensure cost centers and GL accounts are arrays in BS
  if(!BS.pcCostCenters||!BS.pcCostCenters.length) BS.pcCostCenters = (typeof PCC!=='undefined'&&PCC.slice)?PCC.slice():['Kitchen','FOH','Bar','Management','Maintenance','Transport','Office','Miscellaneous'];
  if(!BS.pcGLs||!BS.pcGLs.length) BS.pcGLs = ['Food Cost','Beverage Cost','Cleaning Supplies','Office Supplies','Repairs & Maintenance','Transportation','Utilities','Marketing','Staff Welfare','Other'];
  // Ensure current cycle number exists
  if(!BS.pcCycleNo) BS.pcCycleNo = 1;
  var tot=0,mTot=0,tm=bmthKey(0);
  BS.pc.forEach(function(p){tot+=(+p.amount||0);if(p.date&&p.date.indexOf(tm)===0)mTot+=(+p.amount||0);});
  var budget=BS.pcBudget||0;
  var rows=BS.pc.filter(function(p){return bmatch(p,['description','forwhat','category','gl']);})
    .slice().sort(function(a,b){return(b.date||'').localeCompare(a.date||'');})
    .map(function(p){
      return '<tr>'+
        '<td class="bmono" style="color:var(--text-tertiary);font-size:11px">'+bfdate(p.date)+'</td>'+
        '<td style="font-weight:600;color:var(--text-primary)">'+bxe(p.description)+'</td>'+
        '<td style="color:var(--text-secondary)">'+bxe(p.forwhat||'\u2014')+'</td>'+
        '<td style="color:var(--text-secondary)">'+bxe(p.remarks||'\u2014')+'</td>'+
        '<td>'+bpl(p.category||'\u2014','#b45309')+'</td>'+
        '<td>'+bpl(p.gl||'\u2014','#5b21b6')+'</td>'+
        '<td class="bmono" style="color:#c0392b;font-weight:600">'+bfsar(p.amount)+'</td>'+
        '<td>'+(p.invoices&&p.invoices.length?'<span style="cursor:pointer;color:var(--primary)" onclick="pcViewInvoices('+JSON.stringify(p.invoices)+')" title="'+p.invoices.length+' invoice(s)">📎 '+p.invoices.length+'</span>':'—')+'</td>'+
        '<td><div style="display:flex;gap:4px">'+
          '<button class="btn btn-sm" data-pcid="'+bxe(p.id)+'" onclick="openBranchPCModal(this.dataset.pcid)">Edit</button>'+
          '<button class="btn btn-sm" style="color:var(--danger)" data-pcid="'+bxe(p.id)+'" onclick="delBranchPC(this.dataset.pcid)">Del</button>'+
        '</div></td></tr>';
    }).join('');
  var budgetBanner='';
  if(budget>0){
    var pctUsed=Math.min(100,mTot/budget*100);
    var bc=pctUsed>=90?'#c0392b':pctUsed>=70?'#b45309':'#00875a';
    budgetBanner='<div style="background:var(--surface-1);border:1px solid var(--border);border-radius:10px;padding:12px 16px;margin-bottom:14px;display:flex;align-items:center;gap:12px">'+
      '<span style="font-size:11px;color:var(--text-tertiary);text-transform:uppercase;letter-spacing:.08em;white-space:nowrap">Monthly Budget</span>'+
      '<div style="flex:1;height:8px;background:var(--surface-3);border-radius:4px;overflow:hidden">'+
        '<div style="height:100%;width:'+pctUsed.toFixed(1)+'%;background:'+bc+';border-radius:4px;transition:width .5s"></div>'+
      '</div>'+
      '<span class="mono" style="font-size:13px;font-weight:700;color:'+bc+'">'+bfsar(mTot)+' / '+bfsar(budget)+'</span>'+
      '<span style="font-size:10px;color:var(--text-tertiary)">'+pctUsed.toFixed(0)+'%</span>'+
    '</div>';
  }
  // Petty Cash # banner at top
  var pcNoBanner='<div style="display:flex;align-items:center;gap:14px;background:var(--surface-1);border:1px solid var(--border);border-radius:10px;padding:12px 16px;margin-bottom:16px;flex-wrap:wrap">'+
    '<div style="display:flex;align-items:center;gap:8px"><span style="font-size:11px;color:var(--text-tertiary);text-transform:uppercase;letter-spacing:.08em">Petty Cash #</span>'+
    '<input id="pc-cycle-no" type="text" value="'+bxe(String(BS.pcCycleNo||1))+'" oninput="BS.pcCycleNo=this.value;if(db&&NX.session&&NX.session.branchId)db.ref(\'branches/\'+NX.session.branchId+\'/pcCycleNo\').set(this.value)" style="background:var(--surface-3);border:1px solid var(--border);border-radius:7px;padding:6px 10px;color:var(--accent);font-family:var(--mono);font-weight:700;font-size:14px;width:90px;outline:none"></div>'+
    '<div style="display:flex;align-items:center;gap:8px;color:var(--text-tertiary);font-size:11px"><span style="width:6px;height:6px;border-radius:50%;background:#00875a"></span>Active cycle</div>'+
    '<div style="flex:1"></div>'+
    '<button class="btn" onclick="pcStartNewCycle()">\uD83D\uDD04 New Petty Cash</button>'+
    '<button class="btn" onclick="pcPrintCycle()">\uD83D\uDDA8\uFE0F Print</button>'+
  '</div>';
  return '<div class="page-header"><h1>Petty Cash</h1></div>'+
    pcNoBanner+
    '<div class="bgrid-3" style="margin-bottom:16px">'+
      '<div class="bsc"><div class="bsc-lbl">Total Spent</div><div class="bsc-val bcr" style="font-size:22px">'+bfsar(tot)+'</div></div>'+
      '<div class="bsc"><div class="bsc-lbl">This Month</div><div class="bsc-val" style="font-size:22px;color:#b45309">'+bfsar(mTot)+'</div><div class="bsc-sub">'+bxe(tm)+'</div></div>'+
      '<div class="bsc"><div class="bsc-lbl">Total Entries</div><div class="bsc-val bca">'+BS.pc.length+'</div></div>'+
    '</div>'+
    budgetBanner+
    '<div class="header-actions"><div></div><div style="display:flex;gap:8px;flex-wrap:wrap">'+
      '<button class="btn" onclick="openPCCostCenterMgr()">\u2699\uFE0F Cost Centers</button>'+
      '<button class="btn" onclick="openPCGLMgr()">\u2699\uFE0F GL Accounts</button>'+
      '<button class="btn" onclick="openPCBudgetModal()">\uD83D\uDCB0 Set Budget</button>'+
      '<button class="btn btn-primary" onclick="openBranchPCModal(null)">+ Add Entry</button>'+
    '</div></div>'+
    '<div class="btw"><div class="btw-s"><table class="btbl"><thead><tr><th>Date</th><th>Item Purchased</th><th>For Who</th><th>Remarks</th><th>Cost Center</th><th>GL</th><th>Amount</th><th>📎</th><th></th></tr></thead>'+
    '<tbody>'+(rows||'<tr><td colspan="8" style="text-align:center;color:var(--text-tertiary);padding:28px">\uD83E\uDDFE No entries yet \u2014 click \u201c+ Add Entry\u201d to start</td></tr>')+'</tbody></table></div></div>'+
  (function(){
    var arch=(BS.pcArchive||[]).slice().sort(function(a,b){return(b.closedAt||'').localeCompare(a.closedAt||'');});
    if(!arch.length)return '';
    var sC={pending_am:'#b45309',pending_finance:'#0057ff',finance_processing:'#5b21b6',money_sent:'#00875a',received:'#6b7280'};
    var sL={pending_am:'⏳ Awaiting AM Review',pending_finance:'✅ AM Approved · Awaiting Finance',finance_processing:'🔄 Finance Processing',money_sent:'💰 Money Sent — Confirm Receipt',received:'✔ Received & Closed'};
    var h='<div style="margin-top:22px;padding:16px 18px;background:var(--surface-1);border:1px solid var(--border);border-radius:12px"><div style="font-size:13px;font-weight:700;margin-bottom:14px;color:var(--text-primary)">📚 Closed Cycles</div>';
    arch.forEach(function(cy){
      var sc=sC[cy.status]||'#94a3b8';var sl=sL[cy.status]||cy.status;
      var invCount=0;(cy.entries||[]).forEach(function(e){invCount+=(e.invoices||[]).length;});
      h+='<div style="background:var(--surface-2);border:1px solid var(--border);border-radius:10px;padding:14px 16px;margin-bottom:10px">';
      h+='<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:6px">';
      h+='<span style="font-weight:700;color:var(--text-primary)">Cycle #'+cy.cycleNo+'</span>';
      h+='<span style="font-family:var(--mono);font-size:13px;color:#c0392b;font-weight:700">'+bfsar(cy.total||0)+'</span>';
      h+='<span style="background:'+sc+'18;color:'+sc+';border:1px solid '+sc+'30;border-radius:12px;padding:2px 10px;font-size:11px;font-weight:600">'+sl+'</span>';
      h+='<span style="font-size:11px;color:var(--text-tertiary)">Closed: '+bfdate((cy.closedAt||'').slice(0,10))+'</span>';
      h+='<div style="flex:1"></div>';
      h+='<button class="btn btn-sm" onclick="pcExportCyclePDF(\''+cy.id+'\')" >📄 Export PDF</button>';
      if(cy.status==="money_sent"){h+='<button class="btn btn-primary btn-sm" onclick="pcConfirmReceived(\''+cy.id+'\')">✅ Confirm Received</button>';}
      h+='</div>';
      h+='<div style="font-size:11px;color:var(--text-tertiary)">'+(cy.entries||[]).length+' entries · '+(invCount?'📎 '+invCount+' invoice(s)':'no invoices')+'</div>';
      h+='</div>';
    });
    return h+'</div>';
  })();
}
function openPCBudgetModal(){
  var cur=BS.pcBudget||0;
  openModal('<div class="modal-head"><h2>\uD83D\uDCB0 Monthly Budget Cap</h2><button class="modal-close" onclick="closeModalForce()">\u2715</button></div>'+
    '<div class="bfg"><label class="form-label">Monthly Petty Cash Budget (‫SAR ‬)</label>'+
      '<input class="form-input" type="number" id="pcb-val" value="'+cur+'" placeholder="e.g. 5000" step="100"></div>'+
    '<div style="font-size:11px;color:var(--text-tertiary);margin-bottom:14px">A warning banner appears at 70% and 90% of this limit.</div>'+
    '<button class="btn btn-primary" style="width:100%" onclick="savePCBudget()">\uD83D\uDCBE Save Budget</button>');
}
function savePCBudget(){
  var v=parseFloat(document.getElementById('pcb-val').value)||0;
  BS.pcBudget=v;
  if(db&&NX.session&&NX.session.branchId) db.ref('branches/'+NX.session.branchId+'/pcBudget').set(v);
  closeModalForce();showToast('Budget saved','success');navTo('petty-cash');
}
function openBranchPCModal(id){
  var p=id?BS.pc.find(function(x){return x.id===id;}):null;
  var ccList=BS.pcCostCenters||PCC||[];
  var glList=BS.pcGLs||[];
  var html='<div class="modal-head"><h2>'+(p?'Edit Petty Cash':'Add Petty Cash')+'</h2><button class="modal-close" onclick="closeModalForce()">\u2715</button></div>';
  html+='<div class="bfg"><label class="form-label">Date *</label><input class="form-input" type="date" id="bpc-date" value="'+(p?p.date:TODAY_BS)+'"></div>';
  html+='<div class="bfg"><label class="form-label">Item Purchased *</label><input class="form-input" id="bpc-desc" maxlength="80" value="'+bxe(p?p.description||'':'')+'" placeholder="What was purchased?"></div>';
  html+='<div class="form-row"><div class="bfg"><label class="form-label">For Who / Dept *</label><input class="form-input" id="bpc-for" value="'+bxe(p?p.forwhat||'':'')+'"></div>'+
    '<div class="bfg"><label class="form-label">Cost Center</label><select class="form-input form-select" id="bpc-cat"><option value="">\u2014</option>'+ccList.map(function(c){return '<option'+(p&&p.category===c?' selected':'')+'>'+bxe(c)+'</option>';}).join('')+'</select></div></div>';
  html+='<div class="form-row"><div class="bfg"><label class="form-label">Choose the Proper GL</label><select class="form-input form-select" id="bpc-gl"><option value="">\u2014</option>'+glList.map(function(g){return '<option'+(p&&p.gl===g?' selected':'')+'>'+bxe(g)+'</option>';}).join('')+'</select></div>'+
    '<div class="bfg"><label class="form-label">Amount (‫SAR ‬) *</label><input class="form-input" type="number" step="0.01" id="bpc-amt" value="'+(p?p.amount:'')+'" placeholder="0.00"></div></div>';
  html+='<div class="bfg"><label class="form-label">Remarks</label><input class="form-input" id="bpc-rem" value="'+bxe(p?p.remarks||'':'')+'"></div>';
  html+='<button class="btn btn-primary" style="width:100%;margin-top:8px" data-pcid="'+bxe(id||'')+'" onclick="saveBranchPC(this.dataset.pcid)">'+(p?'Save Changes':'Save Entry')+'</button>';
  // Invoice attachment UI
  var existingInv=(p&&p.invoices)?p.invoices:[];
  html+='<div class="bfg" style="margin-top:6px"><label class="form-label">📎 Attach Invoice(s)</label>';
  html+='<input type="file" id="bpc-inv-file" accept="image/*,application/pdf" multiple style="display:none" onchange="pcHandleInvoiceUpload(this)">';
  html+='<button type="button" class="btn btn-sm" style="margin-bottom:8px" onclick="document.getElementById(\'bpc-inv-file\').click()">📷 Add Invoice</button>';
  html+='<div id="bpc-inv-preview" style="display:flex;flex-wrap:wrap;gap:8px">';
  existingInv.forEach(function(inv,i){
    if(inv.type==='pdf'){html+='<div style="display:inline-flex;align-items:center;gap:4px;background:var(--surface-2);border:1px solid var(--border);border-radius:6px;padding:4px 8px;font-size:11px;cursor:pointer" onclick="pcViewInvoicePDF(window._pcModalInvoices['+i+'].data)"><span>📄 '+bxe(inv.name||'PDF')+'</span><button type="button" onclick="event.stopPropagation();pcRemoveInv('+i+')" style="background:none;border:none;color:var(--danger);cursor:pointer;font-size:14px;margin-left:4px">×</button></div>';}
    else{html+='<div style="position:relative;display:inline-block"><img src="'+inv.data+'" style="width:72px;height:72px;object-fit:cover;border-radius:6px;border:1px solid var(--border);cursor:pointer" onclick="pcViewInvoice(this.src)"><button type="button" onclick="event.stopPropagation();pcRemoveInv('+i+')" style="position:absolute;top:-5px;right:-5px;background:#c0392b;border:none;color:#fff;border-radius:50%;width:18px;height:18px;cursor:pointer;font-size:11px;line-height:18px;text-align:center;padding:0">×</button></div>';}
  });
  html+='</div></div>';
  openModal(html);
  window._pcModalInvoices=(p&&p.invoices)?p.invoices.slice():[];
}
function saveBranchPC(id){
  var dt=bgv('bpc-date'),desc=bgv('bpc-desc'),forw=bgv('bpc-for'),amt=bgv('bpc-amt');
  if(!dt||!desc||!forw||!amt){showToast('Required fields missing','error');return;}
  if(id){
    var i=BS.pc.findIndex(function(x){return x.id===id;});
    if(i>=0){BS.pc[i].date=dt;BS.pc[i].description=desc;BS.pc[i].forwhat=forw;BS.pc[i].category=bgv('bpc-cat');BS.pc[i].gl=bgv('bpc-gl');BS.pc[i].remarks=bgv('bpc-rem');BS.pc[i].amount=parseFloat(amt)||0;BS.pc[i].cycleNo=BS.pcCycleNo||1;BS.pc[i].invoices=window._pcModalInvoices||[];}
  } else {
    // Duplicate guard — same date + same description
    if(BS.pc.find(function(p){return p.date===dt&&(p.description||'').toLowerCase()===desc.toLowerCase();})){
      if(!confirm('A similar entry exists for this date. Add anyway?'))return;
    }
    BS.pc.push({id:buid(),date:dt,description:desc,forwhat:forw,category:bgv('bpc-cat'),gl:bgv('bpc-gl'),remarks:bgv('bpc-rem'),amount:parseFloat(amt)||0,cycleNo:BS.pcCycleNo||1,invoices:window._pcModalInvoices||[]});
  }
  bSaveColl('pc',BS.pc);closeModalForce();showToast('Entry saved','success');navTo('petty-cash');
}
function delBranchPC(id){if(!confirm('Delete this petty cash entry?'))return;BS.pc=BS.pc.filter(function(x){return x.id!==id;});bSaveColl('pc',BS.pc);showToast('Deleted');navTo('petty-cash');}

// ── Cost Center CRUD ──
function openPCCostCenterMgr(){
  var list=BS.pcCostCenters||[];
  var rows=list.map(function(c,i){return '<tr><td style="font-weight:600">'+bxe(c)+'</td><td style="text-align:right"><button class="btn btn-sm" data-cc="'+bxe(c)+'" onclick="renamePCCostCenter(this.dataset.cc)">Edit</button> <button class="btn btn-sm" style="color:var(--danger)" data-cc="'+bxe(c)+'" onclick="deletePCCostCenter(this.dataset.cc)">Del</button></td></tr>';}).join('');
  openModal('<div class="modal-head"><h2>\u2699\uFE0F Cost Centers</h2><button class="modal-close" onclick="closeModalForce()">\u2715</button></div>'+
    '<div class="bfg"><label class="form-label">Add new cost center</label><div style="display:flex;gap:8px"><input class="form-input" id="cc-new" placeholder="e.g. Marketing"><button class="btn btn-primary" onclick="addPCCostCenter()">+ Add</button></div></div>'+
    '<table class="btbl" style="margin-top:10px"><thead><tr><th>Cost Center</th><th></th></tr></thead><tbody>'+(rows||'<tr><td colspan="2" style="text-align:center;color:var(--text-tertiary);padding:18px">No cost centers yet</td></tr>')+'</tbody></table>');
}
function addPCCostCenter(){
  var v=bgv('cc-new');if(!v){showToast('Enter a name','error');return;}
  if(!BS.pcCostCenters)BS.pcCostCenters=[];
  if(BS.pcCostCenters.indexOf(v)>=0){showToast('Already exists','error');return;}
  BS.pcCostCenters.push(v);
  if(db&&NX.session&&NX.session.branchId)db.ref('branches/'+NX.session.branchId+'/pcCostCenters').set(BS.pcCostCenters);
  showToast('Cost center added','success');openPCCostCenterMgr();
}
function renamePCCostCenter(cc){
  var v=prompt('Rename cost center "'+cc+'" to:',cc);if(!v||v===cc)return;
  var i=BS.pcCostCenters.indexOf(cc);if(i<0)return;
  BS.pcCostCenters[i]=v;
  // Update existing entries
  BS.pc.forEach(function(p){if(p.category===cc)p.category=v;});
  if(db&&NX.session&&NX.session.branchId){
    db.ref('branches/'+NX.session.branchId+'/pcCostCenters').set(BS.pcCostCenters);
    bSaveColl('pc',BS.pc);
  }
  showToast('Renamed','success');openPCCostCenterMgr();
}
function deletePCCostCenter(cc){
  var inUse=BS.pc.filter(function(p){return p.category===cc;}).length;
  if(inUse>0){if(!confirm(cc+' is used by '+inUse+' entries. Delete anyway? (entries will keep the name)'))return;}
  BS.pcCostCenters=BS.pcCostCenters.filter(function(x){return x!==cc;});
  if(db&&NX.session&&NX.session.branchId)db.ref('branches/'+NX.session.branchId+'/pcCostCenters').set(BS.pcCostCenters);
  showToast('Deleted','success');openPCCostCenterMgr();
}

// ── GL Account CRUD ──
function openPCGLMgr(){
  var list=BS.pcGLs||[];
  var rows=list.map(function(g){return '<tr><td style="font-weight:600">'+bxe(g)+'</td><td style="text-align:right"><button class="btn btn-sm" data-gl="'+bxe(g)+'" onclick="renamePCGL(this.dataset.gl)">Edit</button> <button class="btn btn-sm" style="color:var(--danger)" data-gl="'+bxe(g)+'" onclick="deletePCGL(this.dataset.gl)">Del</button></td></tr>';}).join('');
  openModal('<div class="modal-head"><h2>\u2699\uFE0F GL Accounts</h2><button class="modal-close" onclick="closeModalForce()">\u2715</button></div>'+
    '<div style="font-size:11px;color:var(--text-tertiary);margin-bottom:10px">General Ledger accounts used in the \u201cChoose the Proper GL\u201d dropdown.</div>'+
    '<div class="bfg"><label class="form-label">Add new GL account</label><div style="display:flex;gap:8px"><input class="form-input" id="gl-new" placeholder="e.g. Repairs & Maintenance"><button class="btn btn-primary" onclick="addPCGL()">+ Add</button></div></div>'+
    '<table class="btbl" style="margin-top:10px"><thead><tr><th>GL Account</th><th></th></tr></thead><tbody>'+(rows||'<tr><td colspan="2" style="text-align:center;color:var(--text-tertiary);padding:18px">No GL accounts yet</td></tr>')+'</tbody></table>');
}
function addPCGL(){
  var v=bgv('gl-new');if(!v){showToast('Enter a name','error');return;}
  if(!BS.pcGLs)BS.pcGLs=[];
  if(BS.pcGLs.indexOf(v)>=0){showToast('Already exists','error');return;}
  BS.pcGLs.push(v);
  if(db&&NX.session&&NX.session.branchId)db.ref('branches/'+NX.session.branchId+'/pcGLs').set(BS.pcGLs);
  showToast('GL account added','success');openPCGLMgr();
}
function renamePCGL(gl){
  var v=prompt('Rename GL "'+gl+'" to:',gl);if(!v||v===gl)return;
  var i=BS.pcGLs.indexOf(gl);if(i<0)return;
  BS.pcGLs[i]=v;
  BS.pc.forEach(function(p){if(p.gl===gl)p.gl=v;});
  if(db&&NX.session&&NX.session.branchId){
    db.ref('branches/'+NX.session.branchId+'/pcGLs').set(BS.pcGLs);
    bSaveColl('pc',BS.pc);
  }
  showToast('Renamed','success');openPCGLMgr();
}
function deletePCGL(gl){
  var inUse=BS.pc.filter(function(p){return p.gl===gl;}).length;
  if(inUse>0){if(!confirm(gl+' is used by '+inUse+' entries. Delete anyway? (entries will keep the name)'))return;}
  BS.pcGLs=BS.pcGLs.filter(function(x){return x!==gl;});
  if(db&&NX.session&&NX.session.branchId)db.ref('branches/'+NX.session.branchId+'/pcGLs').set(BS.pcGLs);
  showToast('Deleted','success');openPCGLMgr();
}

// ── New Cycle / Print ──
function pcStartNewCycle(){
  var curNo=BS.pcCycleNo||1;
  var entries=(BS.pc||[]).filter(function(p){return (p.cycleNo||1)===curNo;});
  if(!entries.length){
    if(!confirm('No entries in cycle #'+curNo+'. Start a new cycle anyway?'))return;
  } else {
    if(!confirm('Close cycle #'+curNo+' with '+entries.length+' entries ('+bfsar(entries.reduce(function(s,p){return s+(+p.amount||0);},0))+')?\n\nThe current cycle will be archived and a new cycle # will start.\nClosed cycle will appear in DSR Closed Petty Cash.'))return;
  }
  // Archive current cycle
  if(!BS.pcArchive)BS.pcArchive=[];
  var total=entries.reduce(function(s,p){return s+(+p.amount||0);},0);
  var branchId=(NX.session&&NX.session.branchId)||'';
  var branchName=(NX.session&&NX.session.branchName)||branchId;
  var archived={
    id:'pc-'+branchId+'-'+curNo+'-'+Date.now(),
    cycleNo:curNo,
    closedAt:new Date().toISOString(),
    total:total,
    entries:entries.slice(),
    status:'pending_am',
    closedBy:(NX.session&&NX.session.userName)||(NX.session&&NX.session.entityName)||'',
    branchId:branchId,
    branchName:branchName
  };
  BS.pcArchive.push(archived);
  // Also push to global admin/petty_cash_reviews for AM + Finance
  if(db){
    db.ref('admin/petty_cash_reviews/'+archived.id).set(archived);
  }
  // Bump cycle number
  var nextNo=parseInt(curNo,10);if(isNaN(nextNo))nextNo=1;nextNo++;
  BS.pcCycleNo=nextNo;
  // Persist
  if(db&&branchId){
    var br='branches/'+branchId;
    db.ref(br+'/pcCycleNo').set(nextNo);
    db.ref(br+'/pcArchive').set(BS.pcArchive);
  }
  showToast('Cycle #'+curNo+' submitted for Area Manager review ✓','success');
  navTo('petty-cash');
}
function pcPrintCycle(){
  var curNo=BS.pcCycleNo||1;
  var entries=(BS.pc||[]).filter(function(p){return (p.cycleNo||1)===curNo;}).slice().sort(function(a,b){return (a.date||'').localeCompare(b.date||'');});
  if(!entries.length){showToast('No entries in current cycle','error');return;}
  var s=NX.session||{};
  var w=window.open('','_blank','width=900,height=700');
  if(!w){showToast('Popup blocked','error');return;}
  var total=entries.reduce(function(sm,p){return sm+(+p.amount||0);},0);
  var rowsHtml=entries.map(function(p,i){return '<tr><td>'+(i+1)+'</td><td>'+bxe(p.date||'')+'</td><td>'+bxe(p.description||'')+'</td><td>'+bxe(p.forwhat||'')+'</td><td>'+bxe(p.category||'')+'</td><td>'+bxe(p.gl||'')+'</td><td>'+bxe(p.remarks||'')+'</td><td style="text-align:right;font-family:monospace">'+(+p.amount||0).toFixed(2)+'</td></tr>';}).join('');
  w.document.write('<!doctype html><html><head><meta charset="utf-8"><title>Petty Cash #'+curNo+' \u2014 '+bxe(s.branchName||'')+'</title><style>body{font-family:-apple-system,sans-serif;padding:20px;color:#111}h1{margin:0 0 4px}.h{color:#666;font-size:12px;margin-bottom:18px}table{width:100%;border-collapse:collapse;font-size:12px}th,td{border:1px solid #ccc;padding:6px 8px;text-align:left}th{background:#f4f4f4}tfoot td{font-weight:700;background:#fafafa}.tot{text-align:right;font-family:monospace}.sig{margin-top:32px;display:flex;gap:40px;font-size:12px}.sig div{flex:1;border-top:1px solid #888;padding-top:6px;text-align:center}@media print{.np{display:none}}</style></head><body>'+
    '<img src="https://i.imgur.com/jeqtcE2.png" alt="ALFA.CO" style="height:44px;width:auto;display:block;margin-bottom:8px">'+
    '<h1>Petty Cash Report \u2014 Cycle #'+curNo+'</h1>'+
    '<div class="h">Branch: '+bxe(s.branchName||'')+' \u00b7 Generated: '+new Date().toLocaleString()+' \u00b7 Entries: '+entries.length+'</div>'+
    '<table><thead><tr><th>#</th><th>Date</th><th>Item</th><th>For / Dept</th><th>Cost Center</th><th>GL</th><th>Remarks</th><th>Amount (‫SAR ‬)</th></tr></thead>'+
    '<tbody>'+rowsHtml+'</tbody>'+
    '<tfoot><tr><td colspan="7" style="text-align:right">Total</td><td class="tot">'+total.toFixed(2)+'</td></tr></tfoot></table>'+
    '<div class="sig"><div>Prepared by</div><div>Approved by</div><div>Received by</div></div>'+
    '<div class="np" style="margin-top:18px;text-align:right"><button onclick="window.print()" style="padding:8px 18px;font-size:13px">Print</button></div>'+
    '</body></html>');
  w.document.close();
}

// ── Reminder CRUD ──
// ── Petty Cash Invoice Helpers ─────────────────────────────────────────────
function pcHandleInvoiceUpload(input){
  var files=Array.from(input.files);
  if(!window._pcModalInvoices) window._pcModalInvoices=[];
  var remaining=10-(window._pcModalInvoices.length);
  if(files.length>remaining){showToast('Max 10 invoices per entry','error');files=files.slice(0,remaining);}
  var preview=document.getElementById('bpc-inv-preview');
  files.forEach(function(file){
    var reader=new FileReader();
    reader.onload=function(e){
      var isPDF=file.type==='application/pdf';
      var inv={id:buid(),name:file.name,type:isPDF?'pdf':'image',data:e.target.result};
      window._pcModalInvoices.push(inv);
      var idx=window._pcModalInvoices.length-1;
      var el=document.createElement('div');
      if(isPDF){
        el.style.cssText='display:inline-flex;align-items:center;gap:4px;background:var(--surface-2);border:1px solid var(--border);border-radius:6px;padding:4px 8px;font-size:11px;cursor:pointer';
        el.dataset.idx=idx;el.onclick=function(){pcViewInvoicePDF(window._pcModalInvoices[parseInt(this.dataset.idx)].data);};
        el.innerHTML='📄 '+inv.name+'<button type="button" onclick="event.stopPropagation();pcRemoveInv('+idx+')" style="background:none;border:none;color:var(--danger);cursor:pointer;font-size:14px;margin-left:4px">×</button>';
      } else {
        el.style.cssText='position:relative;display:inline-block';
        el.innerHTML='<img src="'+inv.data+'" style="width:72px;height:72px;object-fit:cover;border-radius:6px;border:1px solid var(--border);cursor:pointer" onclick="pcViewInvoice(this.src)"><button type="button" onclick="event.stopPropagation();pcRemoveInv('+idx+')" style="position:absolute;top:-5px;right:-5px;background:#c0392b;border:none;color:#fff;border-radius:50%;width:18px;height:18px;cursor:pointer;font-size:11px;line-height:18px;text-align:center;padding:0">×</button>';
      }
      if(preview) preview.appendChild(el);
    };
    reader.readAsDataURL(file);
  });
  input.value='';
}
function pcRemoveInv(i){
  if(!window._pcModalInvoices) return;
  window._pcModalInvoices.splice(i,1);
  var preview=document.getElementById('bpc-inv-preview');
  if(preview) { var items=preview.children; if(items[i]) preview.removeChild(items[i]); }
  // Re-render preview from scratch
  if(preview){
    preview.innerHTML='';
    (window._pcModalInvoices||[]).forEach(function(inv,idx){
      var el=document.createElement('div');
      if(inv.type==='pdf'){
        el.style.cssText='display:inline-flex;align-items:center;gap:4px;background:var(--surface-2);border:1px solid var(--border);border-radius:6px;padding:4px 8px;font-size:11px;cursor:pointer';
        el.dataset.invIdx=idx;el.onclick=function(){pcViewInvoicePDF(window._pcModalInvoices[parseInt(this.dataset.invIdx)].data);};
        el.innerHTML='📄 '+bxe(inv.name)+'<button type="button" onclick="event.stopPropagation();pcRemoveInv('+idx+')" style="background:none;border:none;color:var(--danger);cursor:pointer;font-size:14px;margin-left:4px">×</button>';
      } else {
        el.style.cssText='position:relative;display:inline-block';
        el.innerHTML='<img src="'+inv.data+'" style="width:72px;height:72px;object-fit:cover;border-radius:6px;border:1px solid var(--border);cursor:pointer" onclick="pcViewInvoice(this.src)"><button type="button" onclick="event.stopPropagation();pcRemoveInv('+idx+')" style="position:absolute;top:-5px;right:-5px;background:#c0392b;border:none;color:#fff;border-radius:50%;width:18px;height:18px;cursor:pointer;font-size:11px;line-height:18px;text-align:center;padding:0">×</button>';
      }
      preview.appendChild(el);
    });
  }
}
function pcViewInvoice(src){
  openModal('<div class="modal-head"><h2>Invoice</h2><button class="modal-close" onclick="closeModalForce()">✕</button></div><div style="text-align:center"><img src="'+src+'" style="max-width:100%;max-height:70vh;border-radius:8px"></div>');
}
function pcViewInvoicePDF(data){
  var w=window.open('','_blank');if(!w)return;
  w.document.write('<iframe src="'+data+'" style="width:100%;height:100vh;border:none"></iframe>');
}
function pcViewInvoices(invArr){
  if(!invArr||!invArr.length){showToast('No invoices attached','error');return;}
  window._pcViewInvCache=invArr;
  var h='<div class="modal-head"><h2>📎 Invoices ('+invArr.length+')</h2><button class="modal-close" onclick="closeModalForce()">✕</button></div>';
  h+='<div style="display:flex;flex-wrap:wrap;gap:10px;padding:4px">';
  invArr.forEach(function(inv,i){
    if(inv.type==='pdf'){
      h+='<div style="display:inline-flex;align-items:center;gap:6px;background:var(--surface-2);border:1px solid var(--border);border-radius:8px;padding:8px 12px;cursor:pointer" onclick="pcViewInvoicePDF(window._pcViewInvCache['+i+'].data)">📄 '+bxe(inv.name||'PDF')+'</div>';
    } else {
      h+='<img src="'+inv.data+'" style="width:120px;height:120px;object-fit:cover;border-radius:8px;border:1px solid var(--border);cursor:pointer" onclick="pcViewInvoice(this.src)">';
    }
  });
  h+='</div>';
  openModal(h);
}

// Export cycle as PDF with embedded invoices
function pcExportCyclePDF(cycleId){
  var cy=(BS.pcArchive||[]).find(function(c){return c.id===cycleId;});
  if(!cy){showToast('Cycle not found','error');return;}
  var s=NX.session||{};
  var w=window.open('','_blank','width=1000,height=800');
  if(!w){showToast('Popup blocked — allow popups to export PDF','error');return;}
  var entries=(cy.entries||[]).slice().sort(function(a,b){return(a.date||'').localeCompare(b.date||'');});
  var total=cy.total||entries.reduce(function(s,p){return s+(+p.amount||0);},0);
  var rowsHtml=entries.map(function(p,i){
    var invHTML='';
    if(p.invoices&&p.invoices.length){
      invHTML='<div style="margin-top:4px;display:flex;flex-wrap:wrap;gap:4px">';
      p.invoices.forEach(function(inv){
        if(inv.type==='image')invHTML+='<img src="'+inv.data+'" style="width:60px;height:60px;object-fit:cover;border-radius:4px;border:1px solid #ccc">';
        else invHTML+='<span style="font-size:10px;background:#f4f4f4;border:1px solid #ccc;border-radius:4px;padding:2px 6px">📄 '+inv.name+'</span>';
      });
      invHTML+='</div>';
    }
    return '<tr><td>'+(i+1)+'</td><td>'+p.date+'</td><td><strong>'+p.description+'</strong>'+invHTML+'</td><td>'+(p.forwhat||'')+'</td><td>'+(p.category||'')+'</td><td>'+(p.gl||'')+'</td><td>'+(p.remarks||'')+'</td><td style="text-align:right;font-family:monospace">'+(+p.amount||0).toFixed(2)+'</td></tr>';
  }).join('');
  var statLabels={pending_am:'Pending AM Review',pending_finance:'Pending Finance',finance_processing:'Finance Processing',money_sent:'Money Sent',received:'Received & Closed'};
  var statLabel=statLabels[cy.status]||cy.status||'';
  w.document.write('<!doctype html><html><head><meta charset="utf-8"><title>Petty Cash Cycle #'+cy.cycleNo+'</title>'+
    '<style>body{font-family:-apple-system,Arial,sans-serif;padding:24px;color:#111;font-size:12px}h1{margin:0 0 4px;font-size:18px}.meta{color:#666;font-size:11px;margin-bottom:20px}table{width:100%;border-collapse:collapse;margin-bottom:20px}th,td{border:1px solid #ddd;padding:7px 9px;text-align:left;vertical-align:top}th{background:#f5f5f5;font-weight:700;font-size:11px;text-transform:uppercase;letter-spacing:.06em}tfoot td{font-weight:700;background:#fafafa}.status-badge{display:inline-block;padding:2px 10px;border-radius:12px;font-size:11px;font-weight:600;background:#f0fdf4;color:#166534;border:1px solid #bbf7d0}.inv-section{margin-top:30px;page-break-inside:avoid}.inv-section h3{font-size:13px;margin-bottom:10px}.inv-grid{display:flex;flex-wrap:wrap;gap:10px}.inv-img{width:150px;height:150px;object-fit:cover;border-radius:6px;border:1px solid #ddd}.sig{margin-top:40px;display:flex;gap:60px}.sig div{flex:1;border-top:1px solid #999;padding-top:8px;text-align:center;font-size:11px;color:#555}@media print{button{display:none}}</style>'+
    '</head><body>'+
    '<img src="https://i.imgur.com/jeqtcE2.png" alt="Logo" style="height:44px;margin-bottom:12px;display:block">'+
    '<h1>Petty Cash Report — Cycle #'+cy.cycleNo+'</h1>'+
    '<div class="meta">Branch: <strong>'+cy.branchName+'</strong> &nbsp;·&nbsp; Closed: '+new Date(cy.closedAt||Date.now()).toLocaleString()+' &nbsp;·&nbsp; Closed by: '+(cy.closedBy||'—')+' &nbsp;·&nbsp; Status: <span class="status-badge">'+statLabel+'</span></div>'+
    '<table><thead><tr><th>#</th><th>Date</th><th>Item / Invoices</th><th>For / Dept</th><th>Cost Center</th><th>GL</th><th>Remarks</th><th>Amount (‫SAR ‬)</th></tr></thead>'+
    '<tbody>'+rowsHtml+'</tbody>'+
    '<tfoot><tr><td colspan="7" style="text-align:right">TOTAL</td><td style="text-align:right;font-family:monospace">'+total.toFixed(2)+'</td></tr></tfoot></table>'+
    // Embedded invoice gallery
    (function(){
      var allInv=[];
      entries.forEach(function(p){(p.invoices||[]).forEach(function(inv){allInv.push({entry:p.description,inv:inv});});});
      if(!allInv.length)return '';
      var g='<div class="inv-section"><h3>📎 Attached Invoices ('+allInv.length+')</h3><div class="inv-grid">';
      allInv.forEach(function(x){
        if(x.inv.type==='image'){g+='<div style="text-align:center"><img class="inv-img" src="'+x.inv.data+'"><div style="font-size:9px;color:#666;margin-top:3px">'+x.entry+'</div></div>';}
        else{g+='<div style="text-align:center;width:150px"><div style="background:#f4f4f4;border:1px solid #ddd;border-radius:6px;padding:20px;font-size:11px">📄<br>'+x.inv.name+'</div><div style="font-size:9px;color:#666;margin-top:3px">'+x.entry+'</div></div>';}
      });
      g+='</div></div>';
      return g;
    })()+
    '<div class="sig"><div>Branch Manager Signature</div><div>Area Manager Signature</div><div>Finance Director Signature</div></div>'+
    '<div style="text-align:center;margin-top:20px;font-size:9px;color:#aaa">Generated '+new Date().toLocaleString()+' · ALFA.CO</div>'+
    '<script>setTimeout(function(){window.print();},800);<\/script></body></html>');
  w.document.close();
}

// Confirm received — Branch Manager marks money received
function pcConfirmReceived(cycleId){
  if(!confirm('Confirm that you have received the cash for this cycle?'))return;
  var idx=(BS.pcArchive||[]).findIndex(function(c){return c.id===cycleId;});
  if(idx<0){showToast('Cycle not found','error');return;}
  BS.pcArchive[idx].status='received';
  BS.pcArchive[idx].receivedAt=new Date().toISOString();
  BS.pcArchive[idx].receivedBy=(NX.session&&NX.session.userName)||'';
  // Update Firebase
  if(db){
    var branchId=(NX.session&&NX.session.branchId)||'';
    if(branchId) db.ref('branches/'+branchId+'/pcArchive').set(BS.pcArchive);
    db.ref('admin/petty_cash_reviews/'+cycleId+'/status').set('received');
    db.ref('admin/petty_cash_reviews/'+cycleId+'/receivedAt').set(BS.pcArchive[idx].receivedAt);
  }
  showToast('Cash receipt confirmed ✓ Cycle archived','success');
  navTo('petty-cash');
}


// ── AM Petty Cash Approve/Reject ──────────────────────────────────────────
function pcAMApprove(cycleId){
  if(!confirm('Approve this petty cash cycle and forward to Finance?'))return;
  if(db){
    db.ref('admin/petty_cash_reviews/'+cycleId+'/status').set('pending_finance');
    db.ref('admin/petty_cash_reviews/'+cycleId+'/amApprovedAt').set(new Date().toISOString());
    db.ref('admin/petty_cash_reviews/'+cycleId+'/amApprovedBy').set((NX.session&&NX.session.userName)||'AM');
  }
  // Update branch copy
  var cycle=null;
  if(db){
    db.ref('admin/petty_cash_reviews/'+cycleId).once('value',function(snap){
      var cy=snap.val();if(!cy)return;
      db.ref('branches/'+cy.branchId+'/pcArchive').once('value',function(s2){
        var arr=s2.val()||[];
        var i=arr.findIndex?arr.findIndex(function(c){return c.id===cycleId;}):arr.map(function(c,j){return c.id===cycleId?j:-1;}).find(function(j){return j>=0;});
        if(i>=0){arr[i].status='pending_finance';db.ref('branches/'+cy.branchId+'/pcArchive').set(arr);}
      });
    });
  }
  showToast('Cycle approved — forwarded to Finance ✓','success');
  setTimeout(function(){var c=document.getElementById('am-pc-list');if(c)c.innerHTML='<div style="text-align:center;padding:14px;color:var(--text-tertiary);font-size:12px;font-style:italic">No petty cash cycles awaiting review</div>';},300);
}
function pcAMReject(cycleId){
  var reason=prompt('Reason for rejection (optional):');
  if(reason===null)return;
  if(db){
    db.ref('admin/petty_cash_reviews/'+cycleId+'/status').set('rejected');
    db.ref('admin/petty_cash_reviews/'+cycleId+'/rejectedAt').set(new Date().toISOString());
    db.ref('admin/petty_cash_reviews/'+cycleId+'/rejectedBy').set((NX.session&&NX.session.userName)||'AM');
    db.ref('admin/petty_cash_reviews/'+cycleId+'/rejectReason').set(reason||'');
    // Update branch copy
    db.ref('admin/petty_cash_reviews/'+cycleId).once('value',function(snap){
      var cy=snap.val();if(!cy)return;
      db.ref('branches/'+cy.branchId+'/pcArchive').once('value',function(s2){
        var arr=s2.val()||[];
        var i=arr.findIndex?arr.findIndex(function(c){return c.id===cycleId;}):arr.map(function(c,j){return c.id===cycleId?j:-1;}).find(function(j){return j>=0;});
        if(i>=0){arr[i].status='rejected';arr[i].rejectReason=reason||'';db.ref('branches/'+cy.branchId+'/pcArchive').set(arr);}
      });
    });
  }
  showToast('Cycle rejected','error');
  setTimeout(function(){var c=document.getElementById('am-pc-list');if(c)c.innerHTML='<div style="text-align:center;padding:14px;color:var(--text-tertiary);font-size:12px;font-style:italic">No petty cash cycles awaiting review</div>';},300);
}
function pcAMExportReview(cycleId){
  if(!db){showToast('Database not available','error');return;}
  db.ref('admin/petty_cash_reviews/'+cycleId).once('value',function(snap){
    var cy=snap.val();
    if(!cy){showToast('Cycle not found','error');return;}
    // Use the same export function - temporarily load cycle
    var fakeBS={pcArchive:[cy]};
    var origBS=window.BS;
    window.BS=fakeBS;
    pcExportCyclePDF(cycleId);
    window.BS=origBS;
  });
}

// ── Finance Petty Cash: Mark Money Sent ──────────────────────────────────
function pcFinanceMarkProcessing(cycleId){
  if(db){
    db.ref('admin/petty_cash_reviews/'+cycleId+'/status').set('finance_processing');
    db.ref('admin/petty_cash_reviews/'+cycleId+'/processingAt').set(new Date().toISOString());
    db.ref('admin/petty_cash_reviews/'+cycleId+'/processingBy').set((NX.session&&NX.session.userName)||'Finance');
    db.ref('admin/petty_cash_reviews/'+cycleId).once('value',function(snap){
      var cy=snap.val();if(!cy)return;
      db.ref('branches/'+cy.branchId+'/pcArchive').once('value',function(s2){
        var arr=s2.val()||[];
        var i=arr.findIndex?arr.findIndex(function(c){return c.id===cycleId;}):arr.map(function(c,j){return c.id===cycleId?j:-1;}).find(function(j){return j>=0;});
        if(i>=0){arr[i].status='finance_processing';db.ref('branches/'+cy.branchId+'/pcArchive').set(arr);}
      });
    });
  }
  showToast('Marked as processing','success');
  setTimeout(function(){navTo(NX.page||'hrf-approvals');},800);
}
function pcFinanceMarkSent(cycleId){
  if(!confirm('Confirm that money has been sent to the branch?'))return;
  if(db){
    db.ref('admin/petty_cash_reviews/'+cycleId+'/status').set('money_sent');
    db.ref('admin/petty_cash_reviews/'+cycleId+'/sentAt').set(new Date().toISOString());
    db.ref('admin/petty_cash_reviews/'+cycleId+'/sentBy').set((NX.session&&NX.session.userName)||'Finance');
    // Update branch copy
    db.ref('admin/petty_cash_reviews/'+cycleId).once('value',function(snap){
      var cy=snap.val();if(!cy)return;
      db.ref('branches/'+cy.branchId+'/pcArchive').once('value',function(s2){
        var arr=s2.val()||[];
        var i=arr.findIndex?arr.findIndex(function(c){return c.id===cycleId;}):arr.map(function(c,j){return c.id===cycleId?j:-1;}).find(function(j){return j>=0;});
        if(i>=0){arr[i].status='money_sent';db.ref('branches/'+cy.branchId+'/pcArchive').set(arr);}
      });
    });
  }
  showToast('Money sent confirmed — Branch notified ✓','success');
  var c=document.getElementById('fin-pc-list');
  if(c)c.innerHTML='<div style="text-align:center;padding:14px;color:var(--text-tertiary);font-size:12px;font-style:italic">Refreshing…</div>';
  setTimeout(function(){navTo(NX.page||'hrf-fin-dash');},1000);
}
function pcFinanceExport(cycleId){
  if(!db){showToast('Database not available','error');return;}
  db.ref('admin/petty_cash_reviews/'+cycleId).once('value',function(snap){
    var cy=snap.val();
    if(!cy){showToast('Cycle not found','error');return;}
    var fakeBS={pcArchive:[cy]};
    var origBS=window.BS;
    window.BS=fakeBS;
    pcExportCyclePDF(cycleId);
    window.BS=origBS;
  });
}


function openReminderModal(id){
  var r=id?(BS.rem||[]).find(function(x){return x.id===id;}):null;
  var html='<div class="modal-head"><h2>'+(r?'Edit Reminder':'Add Reminder')+'</h2><button class="modal-close" onclick="closeModalForce()">\u2715</button></div>';
  html+='<div class="bfg"><label class="form-label">What to remember *</label><input class="form-input" id="rem-text" value="'+bxe(r?r.text||'':'')+'" placeholder="e.g. follow up fire system" maxlength="120"></div>';
  html+='<div class="form-row"><div class="bfg"><label class="form-label">Due Date</label><input class="form-input" type="date" id="rem-date" value="'+bxe(r?r.date||TODAY_BS:TODAY_BS)+'"></div>'+
    '<div class="bfg"><label class="form-label">Priority</label><select class="form-input form-select" id="rem-prio"><option value="low"'+(r&&r.priority==='low'?' selected':'')+'>Low</option><option value="medium"'+(r&&r.priority==='medium'?' selected':'')+'>Medium</option><option value="high"'+(r&&r.priority==='high'?' selected':(!r?' selected':''))+'>High</option></select></div></div>';
  html+='<button class="btn btn-primary" style="width:100%;margin-top:8px" data-rid="'+bxe(id||'')+'" onclick="saveReminder(this.dataset.rid)">'+(r?'Save Changes':'Add Reminder')+'</button>';
  openModal(html);
}
function saveReminder(id){
  var t=bgv('rem-text');if(!t){showToast('Reminder text required','error');return;}
  if(!BS.rem)BS.rem=[];
  if(id){
    var i=BS.rem.findIndex(function(x){return x.id===id;});
    if(i>=0){BS.rem[i].text=t;BS.rem[i].date=bgv('rem-date');BS.rem[i].priority=bgv('rem-prio');}
  } else {
    BS.rem.push({id:buid(),text:t,date:bgv('rem-date'),priority:bgv('rem-prio')||'medium',done:false,createdAt:Date.now()});
  }
  bSaveColl('rem',BS.rem);closeModalForce();showToast('Reminder saved','success');
  if(NX.page==='branch-dash')navTo('branch-dash');
}
function delReminder(id){if(!confirm('Delete this reminder?'))return;BS.rem=(BS.rem||[]).filter(function(r){return r.id!==id;});bSaveColl('rem',BS.rem);showToast('Reminder deleted','success');if(NX.page==='branch-dash')navTo('branch-dash');}
function toggleReminder(id){var r=(BS.rem||[]).find(function(x){return x.id===id;});if(!r)return;r.done=!r.done;bSaveColl('rem',BS.rem);if(NX.page==='branch-dash')navTo('branch-dash');}


function pDSR(){
  attachBranchListeners();
  var s=NX.session||{};
  var branchName=xe(s.branchName||s.entityName||'Branch');
  // Initialize active date to today if not set
  if(!BS.dsrActiveDate)BS.dsrActiveDate=TODAY_BS;
  var today=BS.dsrActiveDate;

  // Init DSR state if not exists
  if(!BS.dsrState)BS.dsrState={};
  if(!BS.dsrState[today])BS.dsrState[today]={
    date:today,restName:branchName,
    food:'',bev:'',misc:'',vat:'',vatAlfa:'',guests:'',
    discounts:[],payments:[{id:'p1',method:'Cash',amount:''},{id:'p2',method:'MADA',amount:''},{id:'p3',method:'VISA',amount:''},{id:'p4',method:'Qlub',amount:''}],
    delivery:[],servers:[],
    closedPetty:[],ongoingPetty:[],safeItems:[],
    denoms:{},tab:'overview'
  };
  var D=BS.dsrState[today];
  if(!D.tab)D.tab='overview';

  var tabs=[['overview','◈ Overview'],['deposit','◎ Deposit'],['income','◇ Income'],['payments','◫ Payments'],['delivery','◻ Delivery'],['server','◉ Server Drops'],['manager','▲ Manager'],['masterfile','⊞ Master File']];
  // Date picker
  var isToday=today===TODAY_BS;
  var datePicker='<div style="display:flex;align-items:center;gap:10px;margin-bottom:14px;padding:10px 14px;background:var(--surface-1);border:1px solid var(--border);border-radius:10px">';
  datePicker+='<span style="font-size:11px;color:var(--text-tertiary);font-weight:600;text-transform:uppercase;letter-spacing:.08em;flex-shrink:0">Report Date</span>';
  datePicker+='<input type="date" value="'+today+'" max="'+TODAY_BS+'" onchange="dsrChangeDate(this.value)" style="background:var(--surface-2);border:1px solid var(--border);border-radius:7px;padding:5px 10px;color:var(--text-primary);font-size:13px;font-family:var(--font);outline:none;cursor:pointer">';
  if(!isToday)datePicker+='<span style="font-size:11px;font-weight:700;color:#b45309;padding:2px 10px;background:rgba(245,158,11,.12);border-radius:20px">Viewing: '+today+'</span>';
  datePicker+='<button onclick="dsrChangeDate(\''+TODAY_BS+'\')" style="padding:5px 12px;border-radius:7px;border:1px solid var(--border);background:var(--surface-2);color:var(--text-secondary);font-size:11px;cursor:pointer;font-family:var(--font)">Today</button>';
  datePicker+='</div>';
  var tabBar='<div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-bottom:10px">';
  tabBar+='<button onclick="dsrSave()" style="padding:6px 14px;border-radius:8px;border:1px solid var(--border);background:var(--surface-2);color:var(--text-secondary);font-size:11px;cursor:pointer">💾 Save</button>';
  tabBar+='<button onclick="dsrEndShift()" style="padding:6px 14px;border-radius:8px;border:1px solid rgba(245,158,11,.5);background:rgba(245,158,11,.1);color:#b45309;font-size:11px;font-weight:700;cursor:pointer">🌙 End Shift</button>';
  tabBar+='<button onclick="dsrClear()" style="padding:6px 14px;border-radius:8px;border:1px solid rgba(239,68,68,.4);background:rgba(239,68,68,.06);color:var(--danger);font-size:11px;font-weight:600;cursor:pointer">⊗ Clear</button>';
  tabBar+='</div>';
  tabBar+='<div style="display:flex;gap:4px;flex-wrap:wrap;margin-bottom:18px;border-bottom:1px solid var(--border);padding-bottom:12px">';
  tabs.forEach(function(t){
    var act=D.tab===t[0];
    tabBar+='<button onclick="dsrNav(\''+t[0]+'\')" style="padding:6px 14px;border-radius:8px;border:1px solid '+(act?'var(--accent)':'var(--border)')+';background:'+(act?'var(--accent)':'transparent')+';color:'+(act?'#000':'var(--text-secondary)')+';font-size:11px;font-weight:'+(act?'700':'500')+';cursor:pointer;font-family:var(--font)">'+t[1]+'</button>';
  });
  tabBar+='</div>';

  var body='';
  var fi='background:var(--surface-2);border:1px solid var(--border);border-radius:8px;padding:8px 10px;color:var(--text-primary);font-size:13px;outline:none;width:100%;font-family:var(--font);';
  var flab='display:block;font-size:10px;color:var(--text-tertiary);text-transform:uppercase;letter-spacing:.08em;margin-bottom:4px;';
  var fg='margin-bottom:12px;';
  var grid2='display:grid;grid-template-columns:1fr 1fr;gap:12px;';
  var grid3='display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;';
  var secHdr='font-size:12px;font-weight:700;color:var(--text-secondary);text-transform:uppercase;letter-spacing:.08em;margin-bottom:10px;padding-bottom:6px;border-bottom:1px solid var(--border);';
  var card='background:var(--surface-1);border:1px solid var(--border);border-radius:11px;padding:16px;margin-bottom:14px;';
  var sline='display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid var(--border);font-size:12px;';
  var mono='font-family:var(--mono);font-weight:700;font-size:13px;';

  // Helper: number input
  function fi_n(id,val,ph,cb){return '<input type="number" step="0.01" placeholder="'+ph+'" value="'+(val||'')+'" oninput="dsrUp(\''+id+'\',this.value);'+cb+'" style="'+fi+'">';}
  function fi_t(id,val,ph,cb){return '<input type="text" placeholder="'+ph+'" value="'+(bxe(val||''))+'" oninput="dsrUp(\''+id+'\',this.value);'+cb+'" style="'+fi+'">';}
  function lbl(t){return '<label style="'+flab+'">'+t+'</label>';}
  function grp(l,inp){return '<div style="'+fg+'">'+lbl(l)+inp+'</div>';}

  if(D.tab==='overview'){
    // Calculate all values
    var food=parseFloat(D.food)||0,bev=parseFloat(D.bev)||0,misc=parseFloat(D.misc)||0;
    var vat=parseFloat(D.vat)||0,guests=parseInt(D.guests)||0;
    var totalDisc=(D.discounts||[]).reduce(function(a,d){return a+(parseFloat(d.amount)||0);},0);
    var totalDelivery=(D.delivery||[]).reduce(function(a,d){return a+(parseFloat(d.amount)||0);},0);
    var totalPay=(D.payments||[]).reduce(function(a,p){return a+(parseFloat(p.amount)||0);},0);
    var netSales=(food+bev+misc)-totalDisc;
    var totalSales=netSales+vat;
    var serverCash=(D.servers||[]).reduce(function(a,s){return a+(parseFloat(s.cashSales)||0);},0);
    var approvedTips=(D.servers||[]).reduce(function(a,s){return a+(s.tips||[]).filter(function(t){return t.status==='approved';}).reduce(function(b,t){return b+(parseFloat(t.amount)||0);},0);},0);
    var toDeposit=serverCash-approvedTips;
    var approvedVoids=(D.servers||[]).reduce(function(a,s){return a+(s.voids||[]).filter(function(v){return v.status==='approved';}).reduce(function(b,v){return b+(parseFloat(v.amount)||0);},0);},0);
    var approvedRets=(D.servers||[]).reduce(function(a,s){return a+(s.returns||[]).filter(function(v){return v.status==='approved';}).reduce(function(b,v){return b+(parseFloat(v.amount)||0);},0);},0);
    var checkAvg=guests>0?netSales/guests:0;
    function sv(v,c){return '<span style="'+mono+'color:'+(c||'var(--ceo)')+'">'+bfsar(v)+'</span>';}
    function sline_r(l,v,c){return '<div style="'+sline+'"><span>'+l+'</span>'+sv(v,c)+'</div>';}
    body+='<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:10px;margin-bottom:16px">';
    [['Total Sales',totalSales,'var(--ceo)'],['Net Sales',netSales,'#00875a'],['Guest Count',guests,'#0057ff'],['Check Avg',checkAvg,'var(--text-primary)'],['Server Cash',serverCash,'var(--ceo)'],['To Deposit',toDeposit,'#00875a'],['Delivery',totalDelivery,'#5b21b6'],['Returns',approvedRets,'#c0392b']].forEach(function(k){
      body+='<div class="bsc"><div class="bsc-lbl">'+k[0]+'</div><div class="bsc-val bmono" style="font-size:18px;color:'+k[2]+'">'+(k[0]==='Guest Count'?k[1]:bfsar(k[1]))+'</div></div>';
    });
    body+='</div>';
    body+='<div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">';
    body+='<div style="'+card+'"><div style="'+secHdr+'">Sales Calculation</div>';
    body+=sline_r('Food + Bev + MISC',food+bev+misc);
    body+=sline_r('(-) Discounts',totalDisc,'#c0392b');
    body+='<div style="'+sline+'font-weight:700"><span>= Net Sales</span>'+sv(netSales,'#00875a')+'</div>';
    body+=sline_r('+ System VAT',vat,'var(--text-secondary)');
    body+='<div style="'+sline+'font-weight:700"><span>= Total Sales Revenue</span>'+sv(totalSales,'var(--ceo)')+'</div>';
    body+=sline_r('Voids (info)',approvedVoids,'#b45309');
    body+=sline_r('Returns (info)',approvedRets,'#b45309');
    body+='</div>';
    body+='<div style="'+card+'"><div style="'+secHdr+'">Cash Reconciliation</div>';
    body+=sline_r('Server Cash Total',serverCash);
    body+=sline_r('(-) Approved Tips Paid',approvedTips,'#c0392b');
    body+='<div style="'+sline+'font-weight:700"><span>Expected Deposit</span>'+sv(toDeposit,'#00875a')+'</div>';
    body+=sline_r('MADA',( D.payments||[]).filter(function(p){return p.method==='MADA';}).reduce(function(a,p){return a+(parseFloat(p.amount)||0);},0),'#0057ff');
    body+=sline_r('VISA',(D.payments||[]).filter(function(p){return p.method==='VISA';}).reduce(function(a,p){return a+(parseFloat(p.amount)||0);},0),'#0057ff');
    body+=sline_r('Qlub',(D.payments||[]).filter(function(p){return p.method==='Qlub';}).reduce(function(a,p){return a+(parseFloat(p.amount)||0);},0),'#5b21b6');
    body+='</div></div>';

  } else if(D.tab==='income'){
    body+='<div style="'+card+'"><div style="'+secHdr+'">Income Categories</div>';
    body+='<div style="'+grid3+'">';
    body+=grp('Food Sales (‫SAR ‬)',fi_n('food',D.food,'0.00','dsrRecalc()'));
    body+=grp('Beverage Sales (‫SAR ‬)',fi_n('bev',D.bev,'0.00','dsrRecalc()'));
    body+=grp('MISC / Other (‫SAR ‬)',fi_n('misc',D.misc,'0.00','dsrRecalc()'));
    body+=grp('Guest Count',fi_n('guests',D.guests,'0','dsrRecalc()'));
    body+=grp('System VAT (‫SAR ‬)',fi_n('vat',D.vat,'0.00','dsrRecalc()'));
    body+=grp('VAT on ALFA (info)',fi_n('vatAlfa',D.vatAlfa,'0.00','dsrRecalc()'));
    body+='</div></div>';
    body+='<div style="'+card+'"><div style="'+secHdr+'">Discounts</div>';
    (D.discounts||[]).forEach(function(d,i){
      body+='<div style="display:flex;gap:8px;margin-bottom:8px;align-items:center">';
      body+='<input type="text" placeholder="Discount type" value="'+bxe(d.type||'')+'" oninput="dsrUpdArr(\'discounts\','+i+',\'type\',this.value)" style="'+fi+'flex:2">';
      body+='<input type="number" step="0.01" placeholder="SAR " value="'+(d.amount||'')+'" oninput="dsrUpdArr(\'discounts\','+i+',\'amount\',this.value);dsrRecalc()" style="'+fi+'flex:1">';
      body+='<button onclick="dsrRmArr(\'discounts\','+i+')" style="color:var(--danger);background:transparent;border:none;cursor:pointer;font-size:18px;line-height:1">×</button>';
      body+='</div>';
    });
    body+='<button onclick="dsrAddDisc()" style="padding:7px 16px;border-radius:8px;border:1px solid var(--border);background:var(--surface-2);color:var(--text-primary);font-size:12px;cursor:pointer;margin-top:4px">+ Add Discount</button>';
    body+='</div>';

  } else if(D.tab==='payments'){
    body+='<div style="'+card+'"><div style="'+secHdr+'">Sales by Payment Method</div>';
    var payMethods=['Cash','MADA','VISA','AMEX','Master Card','Qlub','Loyalty Point','Gift Card'];
    (D.payments||[]).forEach(function(p,i){
      body+='<div style="display:flex;gap:8px;margin-bottom:8px;align-items:center">';
      body+='<select oninput="dsrUpdArr(\'payments\','+i+',\'method\',this.value)" style="'+fi+'flex:1.5">';
      payMethods.forEach(function(m){body+='<option'+(p.method===m?' selected':'')+'>'+m+'</option>';});
      body+='</select>';
      body+='<input type="number" step="0.01" placeholder="SAR " value="'+(p.amount||'')+'" oninput="dsrUpdArr(\'payments\','+i+',\'amount\',this.value);dsrRecalc()" style="'+fi+'flex:1">';
      body+='<button onclick="dsrRmArr(\'payments\','+i+')" style="color:var(--danger);background:transparent;border:none;cursor:pointer;font-size:18px;line-height:1">×</button>';
      body+='</div>';
    });
    body+='<button onclick="dsrAddPay()" style="padding:7px 16px;border-radius:8px;border:1px solid var(--border);background:var(--surface-2);color:var(--text-primary);font-size:12px;cursor:pointer;margin-top:4px">+ Add Method</button>';
    body+='</div>';
    // Tip approval
    var allTips=[];
    (D.servers||[]).forEach(function(s,si){(s.tips||[]).forEach(function(t,ti){allTips.push({s:s,si:si,t:t,ti:ti});});});
    if(allTips.length){
      body+='<div style="'+card+'"><div style="'+secHdr+'">Credit Tips — Manager Approval</div>';
      allTips.forEach(function(x){
        var tc=x.t.status==='approved'?'#00875a':x.t.status==='rejected'?'#c0392b':'#b45309';
        body+='<div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--border)">';
        body+='<div style="flex:1"><div style="font-size:12px;font-weight:600">'+bxe(x.s.name||'Server '+(x.si+1))+'</div><div style="font-size:10px;color:var(--text-secondary)">'+x.t.method+' — '+bfsar(x.t.amount)+'</div></div>';
        body+='<span style="background:'+tc+'18;color:'+tc+';border-radius:20px;padding:2px 10px;font-size:10px;font-weight:700">'+x.t.status.toUpperCase()+'</span>';
        if(x.t.status==='pending'){
          body+='<button onclick="dsrTipApprove('+x.si+',\''+x.t.id+'\')" style="padding:4px 10px;border-radius:6px;background:rgba(52,211,153,.15);border:1px solid rgba(52,211,153,.3);color:#b45309;font-size:11px;cursor:pointer">✓</button>';
          body+='<button onclick="dsrTipReject('+x.si+',\''+x.t.id+'\')" style="padding:4px 10px;border-radius:6px;background:rgba(248,113,113,.15);border:1px solid rgba(248,113,113,.3);color:#c0392b;font-size:11px;cursor:pointer">✕</button>';
        }
        body+='</div>';
      });
      body+='</div>';
    }

  } else if(D.tab==='delivery'){
    body+='<div style="'+card+'"><div style="'+secHdr+'">Delivery Platforms</div>';
    (D.delivery||[]).forEach(function(d,i){
      body+='<div style="display:flex;gap:8px;margin-bottom:8px;align-items:center">';
      body+='<input type="text" placeholder="Platform (HungerStation, Jahez...)" value="'+bxe(d.platform||'')+'" oninput="dsrUpdArr(\'delivery\','+i+',\'platform\',this.value)" style="'+fi+'flex:2">';
      body+='<input type="number" step="0.01" placeholder="SAR " value="'+(d.amount||'')+'" oninput="dsrUpdArr(\'delivery\','+i+',\'amount\',this.value);dsrRecalc()" style="'+fi+'flex:1">';
      body+='<input type="number" placeholder="Orders" value="'+(d.orders||'')+'" oninput="dsrUpdArr(\'delivery\','+i+',\'orders\',this.value)" style="'+fi+'width:80px;flex:none">';
      body+='<button onclick="dsrRmArr(\'delivery\','+i+')" style="color:var(--danger);background:transparent;border:none;cursor:pointer;font-size:18px;line-height:1">×</button>';
      body+='</div>';
    });
    body+='<button onclick="dsrAddDeliv()" style="padding:7px 16px;border-radius:8px;border:1px solid var(--border);background:var(--surface-2);color:var(--text-primary);font-size:12px;cursor:pointer;margin-top:4px">+ Add Platform</button>';
    body+='</div>';

  } else if(D.tab==='server'){
    body+='<div style="display:flex;gap:8px;margin-bottom:14px">';
    body+='<button onclick="dsrAddServer()" style="padding:8px 18px;border-radius:8px;border:1px solid var(--border);background:var(--surface-2);color:var(--text-primary);font-size:12px;font-weight:600;cursor:pointer">+ Add Server</button>';
    body+='<div style="flex:1"></div>';
    body+='<div style="font-size:11px;color:var(--text-secondary);padding:8px 0">Server Drop entry also available as <a href="server-drop.html" target="_blank" style="color:var(--ceo);text-decoration:none;font-weight:600">standalone page →</a></div>';
    body+='</div>';
    (D.servers||[]).forEach(function(s,si){
      var approvedT=(s.tips||[]).filter(function(t){return t.status==='approved';}).reduce(function(a,t){return a+(parseFloat(t.amount)||0);},0);
      var cashDrop=(parseFloat(s.cashSales)||0)-approvedT;
      var sumPayments=(parseFloat(s.cashSales)||0)+(parseFloat(s.madaSales)||0)+(parseFloat(s.visaSales)||0)+(parseFloat(s.mcSales)||0)+(parseFloat(s.amexSales)||0)+(parseFloat(s.qlubSales)||0)+(parseFloat(s.loyaltySales)||0)+(parseFloat(s.deliverySales)||0)+(parseFloat(s.vatAlfaSales)||0);
      var diff=(parseFloat(s.totalSales)||0)-sumPayments;
      var dc=Math.abs(diff)<0.01?'#00875a':diff>0?'#c0392b':'#b45309';
      var dl=Math.abs(diff)<0.01?'✓ Balanced':diff>0?'Short '+bfsar(Math.abs(diff)):'Over '+bfsar(Math.abs(diff));
      var pend=(s.voids||[]).filter(function(v){return v.status==='pending';}).length+(s.returns||[]).filter(function(v){return v.status==='pending';}).length+(s.tips||[]).filter(function(t){return t.status==='pending';}).length;
      body+='<div style="'+card+'">';
      body+='<div style="display:flex;align-items:center;gap:10px;margin-bottom:14px">';
      body+='<div style="font-size:13px;font-weight:700;flex:1">'+bxe(s.name||'Server '+(si+1))+(s.sap?' <span style="color:var(--text-tertiary);font-size:10px">'+bxe(s.sap)+'</span>':'')+'</div>';
      if(pend>0)body+='<span style="background:rgba(245,158,11,.15);color:#b45309;border-radius:20px;padding:2px 8px;font-size:10px;font-weight:700">'+pend+' pending</span>';
      body+='<span id="srv-tally-'+si+'" style="background:'+dc+'18;color:'+dc+';border-radius:20px;padding:2px 10px;font-size:10px;font-weight:700">'+dl+'</span>';
      body+='<button onclick="dsrRmServer('+si+')" style="color:var(--danger);background:transparent;border:1px solid rgba(248,113,113,.3);border-radius:6px;padding:3px 9px;cursor:pointer;font-size:12px">×</button>';
      body+='</div>';
      body+='<div style="'+grid3+'margin-bottom:12px">';
      body+=grp('Server Name',fi_t('srv_name_'+si,s.name,'Full name','dsrUpdSrv('+si+',\'name\',this.value)'));
      body+=grp('SAP Number',fi_t('srv_sap_'+si,s.sap,'SAP-XXXX','dsrUpdSrv('+si+',\'sap\',this.value)'));
      body+=grp('Total Sales (‫SAR ‬)',fi_n('srv_tot_'+si,s.totalSales,'0.00','dsrUpdSrv('+si+',\'totalSales\',this.value);dsrRecalc('+si+')'));
      body+=grp('Cash Sales (‫SAR ‬)',fi_n('srv_cash_'+si,s.cashSales,'0.00','dsrUpdSrv('+si+',\'cashSales\',this.value);dsrRecalc('+si+')'));
      body+=grp('MADA (‫SAR ‬)',fi_n('srv_mada_'+si,s.madaSales,'0.00','dsrUpdSrv('+si+',\'madaSales\',this.value);dsrRecalc('+si+')'));
      body+=grp('VISA (‫SAR ‬)',fi_n('srv_visa_'+si,s.visaSales,'0.00','dsrUpdSrv('+si+',\'visaSales\',this.value);dsrRecalc('+si+')'));
      body+=grp('Master Card (‫SAR ‬)',fi_n('srv_mc_'+si,s.mcSales,'0.00','dsrUpdSrv('+si+',\'mcSales\',this.value);dsrRecalc('+si+')'));
      body+=grp('AMEX (‫SAR ‬)',fi_n('srv_amex_'+si,s.amexSales,'0.00','dsrUpdSrv('+si+',\'amexSales\',this.value);dsrRecalc('+si+')'));
      body+=grp('Qlub (‫SAR ‬)',fi_n('srv_qlub_'+si,s.qlubSales,'0.00','dsrUpdSrv('+si+',\'qlubSales\',this.value);dsrRecalc('+si+')'));
      body+=grp('Loyalty Point (‫SAR ‬)',fi_n('srv_loy_'+si,s.loyaltySales,'0.00','dsrUpdSrv('+si+',\'loyaltySales\',this.value);dsrRecalc('+si+')'));
      body+=grp('Delivery (‫SAR ‬)',fi_n('srv_del_'+si,s.deliverySales,'0.00','dsrUpdSrv('+si+',\'deliverySales\',this.value);dsrRecalc('+si+')'));
      body+=grp('VAT on ALFA (‫SAR ‬)',fi_n('srv_vatalfa_'+si,s.vatAlfaSales,'0.00','dsrUpdSrv('+si+',\'vatAlfaSales\',this.value);dsrRecalc('+si+')'));
      body+='</div>';
      // Tips
      body+='<div style="margin-bottom:12px;padding-top:10px;border-top:1px solid var(--border)">';
      body+='<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px"><span style="font-size:10px;color:var(--ceo);font-weight:700;text-transform:uppercase">Tips by Card</span><button onclick="dsrAddTip('+si+')" style="padding:3px 10px;border-radius:6px;border:1px solid var(--border);background:var(--surface-2);color:var(--text-primary);font-size:11px;cursor:pointer">+ Tip</button></div>';
      (s.tips||[]).forEach(function(t,ti){
        var tc=t.status==='approved'?'#00875a':t.status==='rejected'?'#c0392b':'#b45309';
        var CARDM=['MADA','VISA','Master Card','AMEX','Qlub'];
        body+='<div style="display:flex;gap:6px;margin-bottom:6px;align-items:center;background:rgba(240,165,0,.04);border-radius:8px;padding:8px;border:1px solid '+(t.status==='pending'?'rgba(245,158,11,.25)':t.status==='approved'?'rgba(52,211,153,.2)':'rgba(248,113,113,.2)')+'">';
        body+='<select oninput="dsrUpdTip('+si+',\''+t.id+'\',\'method\',this.value)" style="'+fi+'flex:1;font-size:11px">';
        CARDM.forEach(function(m){body+='<option'+(t.method===m?' selected':'')+'>'+m+'</option>';});
        body+='</select>';
        body+='<input type="number" step="0.01" placeholder="SAR " value="'+(t.amount||'')+'" oninput="dsrUpdTip('+si+',\''+t.id+'\',\'amount\',this.value)" style="'+fi+'width:90px;flex:none;font-size:11px">';
        body+='<input type="text" placeholder="Approval Code" value="'+bxe(t.approval||'')+'" oninput="dsrUpdTip('+si+',\''+t.id+'\',\'approval\',this.value)" style="'+fi+'width:100px;flex:none;font-size:11px">';
        body+='<span style="background:'+tc+'18;color:'+tc+';border:1px solid '+tc+'40;border-radius:20px;padding:2px 10px;font-size:10px;font-weight:700;flex:none;white-space:nowrap">'+t.status.toUpperCase()+'</span>';
        if(t.status==='pending'){
          body+='<button onclick="dsrTipApprove('+si+',\''+t.id+'\')" title="Approve tip" style="padding:5px 12px;border-radius:7px;background:rgba(52,211,153,.15);border:1px solid rgba(52,211,153,.35);color:#b45309;font-size:12px;font-weight:700;cursor:pointer;flex:none;white-space:nowrap">✓ Approve</button>';
          body+='<button onclick="dsrTipReject('+si+',\''+t.id+'\')" title="Reject tip" style="padding:5px 12px;border-radius:7px;background:rgba(248,113,113,.15);border:1px solid rgba(248,113,113,.35);color:#c0392b;font-size:12px;font-weight:700;cursor:pointer;flex:none">✕</button>';
        } else if(t.status==='approved'||t.status==='rejected'){
          body+='<button onclick="dsrTipReset('+si+',\''+t.id+'\')" title="Reset to pending" style="padding:4px 8px;border-radius:6px;background:var(--surface-2);border:1px solid var(--border);color:var(--text-secondary);font-size:10px;cursor:pointer;flex:none">↩</button>';
        }
        body+='<button onclick="dsrRmTip('+si+',\''+t.id+'\')" style="color:var(--danger);background:transparent;border:none;cursor:pointer;font-size:18px;line-height:1;flex:none">×</button>';
        body+='</div>';
      });
      body+='</div>';
      // Voids
      body+='<div style="margin-bottom:10px;padding-top:10px;border-top:1px solid var(--border)">';
      body+='<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px"><span style="font-size:10px;color:#c0392b;font-weight:700;text-transform:uppercase">⊗ Voids</span><button onclick="dsrAddVoid('+si+')" style="padding:3px 10px;border-radius:6px;border:1px solid rgba(248,113,113,.3);background:rgba(248,113,113,.08);color:#c0392b;font-size:11px;cursor:pointer">+ Void</button></div>';
      (s.voids||[]).forEach(function(v,vi){
        var vc=v.status==='approved'?'#00875a':v.status==='rejected'?'#94a3b8':'#c0392b';
        var VRR=['Customer Complaint','Wrong Order','Burnt/Overcooked','Out of Stock','Manager Courtesy','Pricing Error','Other'];
        body+='<div style="display:flex;gap:6px;margin-bottom:6px;align-items:center;background:rgba(248,113,113,.05);border-radius:7px;padding:6px">';
        body+='<input type="text" placeholder="Item" value="'+bxe(v.item||'')+'" oninput="dsrUpdVR('+si+',\'voids\',\''+v.id+'\',\'item\',this.value)" style="'+fi+'flex:1.5;font-size:11px">';
        body+='<select oninput="dsrUpdVR('+si+',\'voids\',\''+v.id+'\',\'reason\',this.value)" style="'+fi+'flex:1;font-size:11px"><option value="">Reason</option>';
        VRR.forEach(function(r){body+='<option'+(v.reason===r?' selected':'')+'>'+r+'</option>';});
        body+='</select>';
        body+='<input type="text" placeholder="Check#" value="'+bxe(v.check||'')+'" oninput="dsrUpdVR('+si+',\'voids\',\''+v.id+'\',\'check\',this.value)" style="'+fi+'width:70px;flex:none;font-size:11px">';
        body+='<input type="number" step="0.01" placeholder="SAR " value="'+(v.amount||'')+'" oninput="dsrUpdVR('+si+',\'voids\',\''+v.id+'\',\'amount\',this.value);dsrRecalc('+si+')" style="'+fi+'width:80px;flex:none;font-size:11px">';
        body+='<span style="background:'+vc+'18;color:'+vc+';border:1px solid '+vc+'40;border-radius:20px;padding:2px 10px;font-size:10px;font-weight:700;flex:none;white-space:nowrap">'+v.status.toUpperCase()+'</span>';
        if(v.status==='pending'){
          body+='<button onclick="dsrApprVR('+si+',\'voids\',\''+v.id+'\')" style="padding:5px 12px;border-radius:7px;background:rgba(52,211,153,.15);border:1px solid rgba(52,211,153,.35);color:#b45309;font-size:12px;font-weight:700;cursor:pointer;flex:none;white-space:nowrap">✓ OK</button>';
          body+='<button onclick="dsrRejVR('+si+',\'voids\',\''+v.id+'\')" style="padding:5px 10px;border-radius:7px;background:rgba(248,113,113,.15);border:1px solid rgba(248,113,113,.35);color:#c0392b;font-size:12px;font-weight:700;cursor:pointer;flex:none">✕</button>';
        } else {
          body+='<button onclick="dsrApprVR('+si+',\'voids\',\''+v.id+'\')" style="padding:3px 8px;border-radius:6px;background:var(--surface-2);border:1px solid var(--border);color:var(--text-secondary);font-size:10px;cursor:pointer;flex:none">↩</button>';
        }
        body+='<button onclick="dsrRmVR('+si+',\'voids\',\''+v.id+'\')" style="color:var(--danger);background:transparent;border:none;cursor:pointer;font-size:16px">×</button>';
        body+='</div>';
      });
      body+='</div>';
      // Returns
      body+='<div style="padding-top:10px;border-top:1px solid var(--border)">';
      body+='<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px"><span style="font-size:10px;color:#b45309;font-weight:700;text-transform:uppercase">↩ Returns</span><button onclick="dsrAddRet('+si+')" style="padding:3px 10px;border-radius:6px;border:1px solid rgba(245,158,11,.3);background:rgba(245,158,11,.08);color:#b45309;font-size:11px;cursor:pointer">+ Return</button></div>';
      (s.returns||[]).forEach(function(v,vi){
        var vc=v.status==='approved'?'#00875a':v.status==='rejected'?'#94a3b8':'#b45309';
        var VRR=['Customer Complaint','Wrong Order','Burnt/Overcooked','Out of Stock','Manager Courtesy','Pricing Error','Other'];
        body+='<div style="display:flex;gap:6px;margin-bottom:6px;align-items:center;background:rgba(245,158,11,.05);border-radius:7px;padding:6px">';
        body+='<input type="text" placeholder="Item" value="'+bxe(v.item||'')+'" oninput="dsrUpdVR('+si+',\'returns\',\''+v.id+'\',\'item\',this.value)" style="'+fi+'flex:1.5;font-size:11px">';
        body+='<select oninput="dsrUpdVR('+si+',\'returns\',\''+v.id+'\',\'reason\',this.value)" style="'+fi+'flex:1;font-size:11px"><option value="">Reason</option>';
        VRR.forEach(function(r){body+='<option'+(v.reason===r?' selected':'')+'>'+r+'</option>';});
        body+='</select>';
        body+='<input type="text" placeholder="Check#" value="'+bxe(v.check||'')+'" oninput="dsrUpdVR('+si+',\'returns\',\''+v.id+'\',\'check\',this.value)" style="'+fi+'width:70px;flex:none;font-size:11px">';
        body+='<input type="number" step="0.01" placeholder="SAR " value="'+(v.amount||'')+'" oninput="dsrUpdVR('+si+',\'returns\',\''+v.id+'\',\'amount\',this.value);dsrRecalc('+si+')" style="'+fi+'width:80px;flex:none;font-size:11px">';
        body+='<span style="background:'+vc+'18;color:'+vc+';border:1px solid '+vc+'40;border-radius:20px;padding:2px 10px;font-size:10px;font-weight:700;flex:none;white-space:nowrap">'+v.status.toUpperCase()+'</span>';
        if(v.status==='pending'){
          body+='<button onclick="dsrApprVR('+si+',\'returns\',\''+v.id+'\')" style="padding:5px 12px;border-radius:7px;background:rgba(52,211,153,.15);border:1px solid rgba(52,211,153,.35);color:#b45309;font-size:12px;font-weight:700;cursor:pointer;flex:none;white-space:nowrap">✓ OK</button>';
          body+='<button onclick="dsrRejVR('+si+',\'returns\',\''+v.id+'\')" style="padding:5px 10px;border-radius:7px;background:rgba(248,113,113,.15);border:1px solid rgba(248,113,113,.35);color:#c0392b;font-size:12px;font-weight:700;cursor:pointer;flex:none">✕</button>';
        } else {
          body+='<button onclick="dsrApprVR('+si+',\'returns\',\''+v.id+'\')" style="padding:3px 8px;border-radius:6px;background:var(--surface-2);border:1px solid var(--border);color:var(--text-secondary);font-size:10px;cursor:pointer;flex:none">↩</button>';
        }
        body+='<button onclick="dsrRmVR('+si+',\'returns\',\''+v.id+'\')" style="color:var(--danger);background:transparent;border:none;cursor:pointer;font-size:16px">×</button>';
        body+='</div>';
      });
      body+='</div>';
      body+='<div id="srv-footer-'+si+'" style="display:flex;gap:12px;padding-top:10px;border-top:1px solid var(--border);margin-top:8px">';
      body+='<span style="font-size:11px;color:var(--text-secondary)">Cash: <span id="srv-fc-'+si+'">'+bfsar(parseFloat(s.cashSales)||0)+'</span></span>';
      body+='<span style="font-size:11px;color:var(--text-secondary)">Tips: <span id="srv-ft-'+si+'">'+bfsar(approvedT)+'</span></span>';
      body+='<span style="font-size:11px;color:var(--text-secondary)">Drop: <span id="srv-fd-'+si+'">'+bfsar(cashDrop)+'</span></span>';
      body+='<span id="srv-fs-'+si+'" style="margin-left:auto;font-size:11px;font-weight:700;color:'+dc+'">'+dl+'</span>';
      body+='</div>';
      body+='</div>';
    });
    if(!(D.servers||[]).length){body+='<div style="text-align:center;padding:48px;color:var(--text-tertiary)"><div style="font-size:36px;margin-bottom:10px">◉</div><p style="font-size:13px">No servers yet — click "+ Add Server" to begin</p></div>';}

  } else if(D.tab==='deposit'){
    var DENOMS_DEP=[{v:'500',l:'500'},{v:'200',l:'200'},{v:'100',l:'100'},{v:'50',l:'50'},{v:'20',l:'20'},{v:'10',l:'10'},{v:'5',l:'5'},{v:'1',l:'1.00'},{v:'0.5',l:'0.50'},{v:'0.25',l:'0.25'}];
    var serverCash2=(D.servers||[]).reduce(function(a,s){return a+(parseFloat(s.cashSales)||0);},0);
    var approvedTips2=(D.servers||[]).reduce(function(a,s){return a+(s.tips||[]).filter(function(t){return t.status==='approved';}).reduce(function(b,t){return b+(parseFloat(t.amount)||0);},0);},0);
    var toDeposit2=serverCash2-approvedTips2;
    var physTotal=DENOMS_DEP.reduce(function(a,d){return a+(parseFloat((D.denoms||{})['dep_'+d.v.replace('.','_')])||0)*parseFloat(d.v);},0);
    var depDiff=physTotal-toDeposit2;
    body+='<div style="display:flex;gap:16px;flex-wrap:wrap;background:var(--surface-1);border:1px solid var(--border);border-radius:11px;padding:14px;margin-bottom:16px;align-items:center">';
    body+='<div><div style="font-size:9px;color:var(--text-tertiary);text-transform:uppercase;letter-spacing:.08em;margin-bottom:2px">Server Cash Total</div><div class="bmono" style="font-size:20px;color:var(--ceo)">'+bfsar(serverCash2)+'</div></div>';
    body+='<div style="font-size:20px;color:var(--text-tertiary)">−</div>';
    body+='<div><div style="font-size:9px;color:var(--text-tertiary);text-transform:uppercase;letter-spacing:.08em;margin-bottom:2px">Credit Tips to Pay</div><div class="bmono" style="font-size:20px;color:#c0392b">'+bfsar(approvedTips2)+'</div></div>';
    body+='<div style="font-size:20px;color:var(--text-tertiary)">=</div>';
    body+='<div><div style="font-size:9px;color:var(--ceo);text-transform:uppercase;letter-spacing:.08em;margin-bottom:2px">Amount to Deposit</div><div class="bmono" style="font-size:24px;font-weight:700;color:var(--ceo)">'+bfsar(toDeposit2)+'</div></div>';
    body+='<div style="margin-left:auto;text-align:right"><div style="font-size:9px;color:var(--text-tertiary);text-transform:uppercase;margin-bottom:2px">Physical Counted</div><div class="bmono" style="font-size:20px;color:'+(Math.abs(depDiff)<0.01?'#00875a':depDiff<0?'#c0392b':'#b45309')+'">'+bfsar(physTotal)+'</div><div style="font-size:10px;color:var(--text-secondary)">Diff: '+(depDiff>=0?'+':'')+bfsar(depDiff)+'</div></div>';
    body+='</div>';
    body+='<div style="'+card+'"><div style="'+secHdr+'">Count Physical Cash — Enter Quantities</div>';
    body+='<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:10px">';
    DENOMS_DEP.forEach(function(d){
      var dk='dep_'+d.v.replace('.','_');
      var qty=parseFloat((D.denoms||{})[dk])||0;
      var sub=qty*parseFloat(d.v);
      body+='<div style="background:var(--surface-2);border:1px solid var(--border);border-radius:9px;padding:10px;text-align:center">';
      body+='<div style="font-size:12px;color:var(--text-primary);margin-bottom:6px;font-weight:700">SAR '+d.l+'</div>';
      body+='<input type="number" min="0" value="'+(qty||'')+'" placeholder="0" oninput="dsrUpdDenom(\''+dk+'\',this.value)" style="'+fi+'text-align:center;font-size:15px;font-weight:700;margin-bottom:5px">';
      body+='<div id="denom-sub-'+dk+'" style="font-size:12px;color:var(--ceo);font-family:var(--mono);font-weight:700">='+sub.toFixed(2)+'</div>';
      body+='</div>';
    });
    body+='</div>';
    var physRunning=Object.keys(D.denoms||{}).filter(function(k){return k.indexOf('dep_')===0;}).reduce(function(a,k){var v=parseFloat(k.replace('dep_','').replace('_','.'));return a+(parseFloat((D.denoms||{})[k])||0)*v;},0);
    body+='<div id="denom-total" style="margin-top:12px;font-size:16px;font-weight:700;color:var(--ceo);font-family:var(--mono);text-align:right">SAR '+physRunning.toLocaleString('en',{minimumFractionDigits:2,maximumFractionDigits:2})+'</div>';
    body+='</div>';
    body+='<button onclick="dsrPrintDeposit()" style="padding:10px 28px;border-radius:9px;background:var(--surface-2);border:1px solid var(--border);color:var(--text-primary);font-size:13px;font-weight:600;cursor:pointer">⎙ Print Deposit Sheet</button>';

  } else if(D.tab==='manager'){
    var food2=parseFloat(D.food)||0,bev2=parseFloat(D.bev)||0,misc2=parseFloat(D.misc)||0;
    var vat2=parseFloat(D.vat)||0;
    var totalDisc2=(D.discounts||[]).reduce(function(a,d){return a+(parseFloat(d.amount)||0);},0);
    var netSales2=(food2+bev2+misc2)-totalDisc2;
    var totalSales2=netSales2+vat2;
    var serverCash3=(D.servers||[]).reduce(function(a,s){return a+(parseFloat(s.cashSales)||0);},0);
    var approvedTips3=(D.servers||[]).reduce(function(a,s){return a+(s.tips||[]).filter(function(t){return t.status==='approved';}).reduce(function(b,t){return b+(parseFloat(t.amount)||0);},0);},0);
    var toDeposit3=serverCash3-approvedTips3;
    var physTotal3=Object.keys(D.denoms||{}).filter(function(k){return k.indexOf('dep_')===0;}).reduce(function(a,k){var v=k.replace('dep_','').replace('_','.');return a+(parseFloat((D.denoms||{})[k])||0)*parseFloat(v);},0);
    var variance3=physTotal3-toDeposit3;
    var approvedVoids3=(D.servers||[]).reduce(function(a,s){return a+(s.voids||[]).filter(function(v){return v.status==='approved';}).reduce(function(b,v){return b+(parseFloat(v.amount)||0);},0);},0);
    var approvedRets3=(D.servers||[]).reduce(function(a,s){return a+(s.returns||[]).filter(function(v){return v.status==='approved';}).reduce(function(b,v){return b+(parseFloat(v.amount)||0);},0);},0);
    // Alerts
    var alerts=[];
    if(Math.abs(variance3)>5)alerts.push({c:'#c0392b',i:'⛔',t:'Deposit '+(variance3<0?'SHORT':'OVER')+' by '+bfsar(Math.abs(variance3)),d:'Expected: '+bfsar(toDeposit3)+' | Physical: '+bfsar(physTotal3)});
    (D.servers||[]).forEach(function(s){
      var approvedT2=(s.tips||[]).filter(function(t){return t.status==='approved';}).reduce(function(a,t){return a+(parseFloat(t.amount)||0);},0);
      var sumPay2=(parseFloat(s.cashSales)||0)+(parseFloat(s.madaSales)||0)+(parseFloat(s.visaSales)||0)+(parseFloat(s.mcSales)||0)+(parseFloat(s.amexSales)||0)+(parseFloat(s.qlubSales)||0)+(parseFloat(s.loyaltySales)||0)+(parseFloat(s.deliverySales)||0)+(parseFloat(s.vatAlfaSales)||0);
      var diff2=(parseFloat(s.totalSales)||0)-sumPay2;
      if(Math.abs(diff2)>0.01)alerts.push({c:diff2>0?'#c0392b':'#b45309',i:diff2>0?'⛔':'⚡',t:(s.name||'Server')+': '+(diff2>0?'SHORT':'OVER')+' '+bfsar(Math.abs(diff2)),d:'Total Sales: '+bfsar(s.totalSales)+' | Sum of Payments: '+bfsar(sumPay2)});
      var pend2=(s.voids||[]).filter(function(v){return v.status==='pending';}).length+(s.returns||[]).filter(function(v){return v.status==='pending';}).length+(s.tips||[]).filter(function(t){return t.status==='pending';}).length;
      if(pend2>0)alerts.push({c:'#b45309',i:'⏳',t:(s.name||'Server')+': '+pend2+' pending approval',d:'Go to Server Drops tab'});
    });
    body+='<div style="margin-bottom:16px">';
    if(!alerts.length){body+='<div style="background:rgba(52,211,153,.1);border:1px solid rgba(52,211,153,.3);border-radius:10px;padding:14px 18px;display:flex;gap:12px;align-items:center"><span style="font-size:24px">✓</span><div><div style="font-weight:700;color:#b45309">All checks passed</div><div style="font-size:11px;color:var(--text-secondary)">No discrepancies found</div></div></div>';}
    else alerts.forEach(function(a){body+='<div style="background:'+a.c+'18;border:1px solid '+a.c+'40;border-radius:10px;padding:12px 16px;display:flex;gap:12px;align-items:center;margin-bottom:8px"><span style="font-size:20px">'+a.i+'</span><div><div style="font-weight:700;color:'+a.c+'">'+a.t+'</div><div style="font-size:11px;color:var(--text-secondary)">'+a.d+'</div></div></div>';});
    body+='</div>';
    body+='<div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">';
    body+='<div style="'+card+'"><div style="'+secHdr+'">Server Reconciliation</div>';
    body+='<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:11px"><thead><tr style="background:var(--surface-2)"><th style="padding:7px 10px;text-align:left;color:var(--text-tertiary)">Server</th><th style="padding:7px 10px;text-align:right;color:var(--text-tertiary)">Reported</th><th style="padding:7px 10px;text-align:right;color:var(--text-tertiary)">Cash</th><th style="padding:7px 10px;text-align:right;color:var(--text-tertiary)">Tips</th><th style="padding:7px 10px;text-align:center;color:var(--text-tertiary)">Status</th></tr></thead><tbody>';
    (D.servers||[]).forEach(function(s){
      var approvedT4=(s.tips||[]).filter(function(t){return t.status==='approved';}).reduce(function(a,t){return a+(parseFloat(t.amount)||0);},0);
      var drop=(parseFloat(s.cashSales)||0)+approvedT4;
      var diff3=drop-(parseFloat(s.totalSales)||0);
      var dc=Math.abs(diff3)<0.01?'#00875a':diff3<0?'#c0392b':'#b45309';
      var dl=Math.abs(diff3)<0.01?'OK':diff3<0?'Short':'Over';
      body+='<tr style="border-top:1px solid var(--border)"><td style="padding:7px 10px;font-weight:600">'+bxe(s.name||'—')+'</td><td style="padding:7px 10px;text-align:right;font-family:var(--mono)">'+bfsar(s.totalSales)+'</td><td style="padding:7px 10px;text-align:right;font-family:var(--mono)">'+bfsar(s.cashSales)+'</td><td style="padding:7px 10px;text-align:right;font-family:var(--mono)">'+bfsar(approvedT4)+'</td><td style="padding:7px 10px;text-align:center"><span style="background:'+dc+'18;color:'+dc+';border-radius:20px;padding:1px 8px;font-size:10px;font-weight:700">'+dl+'</span></td></tr>';
    });
    body+='</tbody></table></div></div>';
    body+='<div style="'+card+'"><div style="'+secHdr+'">Daily Balance</div>';
    function sl3(l,v,c,bold){return '<div style="'+sline+(bold?'font-weight:700':'')+'"><span>'+l+'</span><span style="'+mono+'color:'+(c||'var(--ceo)')+'">'+bfsar(v)+'</span></div>';}
    body+=sl3('Food + Bev + MISC',food2+bev2+misc2);
    body+=sl3('(-) Discounts',totalDisc2,'#c0392b');
    body+=sl3('= Net Sales',netSales2,'#00875a',true);
    body+=sl3('+ System VAT',vat2);
    body+=sl3('= Total Sales',totalSales2,'var(--ceo)',true);
    body+=sl3('Server Cash Total',serverCash3);
    body+=sl3('(-) Credit Tips',approvedTips3,'#c0392b');
    body+=sl3('Expected Deposit',toDeposit3,'#00875a',true);
    body+=sl3('Physical Counted',physTotal3);
    var vcolor=Math.abs(variance3)<0.01?'#00875a':variance3<0?'#c0392b':'#b45309';
    body+='<div style="'+sline+'font-weight:700"><span>Deposit Variance</span><span style="'+mono+'color:'+vcolor+'">'+(variance3>=0?'+':'')+bfsar(Math.abs(variance3))+'</span></div>';
    body+=sl3('Voids (info)',approvedVoids3,'#b45309');
    body+=sl3('Returns (info)',approvedRets3,'#b45309');
    body+='</div></div>';
    body+='<div style="margin-top:14px;display:flex;gap:10px">';
    body+='<button onclick="dsrPrintFull()" style="padding:10px 28px;border-radius:9px;background:var(--accent);border:none;color:#000;font-size:13px;font-weight:700;cursor:pointer">⎙ Print Full DSR</button>';
    body+='<button onclick="dsrPrintVR()" style="padding:10px 24px;border-radius:9px;background:var(--surface-2);border:1px solid var(--border);color:var(--text-primary);font-size:13px;font-weight:600;cursor:pointer">⎙ Voids & Returns</button>';
    body+='<button onclick="dsrPrintTips()" style="padding:10px 24px;border-radius:9px;background:var(--surface-2);border:1px solid var(--border);color:var(--text-primary);font-size:13px;font-weight:600;cursor:pointer">⎙ Tips Report</button>';
    body+='</div>';

  } else if(D.tab==='masterfile'){
    var DENOMS_MF={have:[{v:'500',l:'500'},{v:'200',l:'200'},{v:'100',l:'100'},{v:'50',l:'50'},{v:'20',l:'20'},{v:'10',l:'10'},{v:'5',l:'5'},{v:'1',l:'1.00'},{v:'0.5',l:'0.50'},{v:'0.25',l:'0.25'}],change:[{v:'100',l:'100'},{v:'50',l:'50'},{v:'20',l:'20'},{v:'10',l:'10'},{v:'5',l:'5'},{v:'1',l:'1.00'}]};
    function denomGrid(type,denoms){
      var ht='<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(110px,1fr));gap:8px">';
      denoms.forEach(function(d){var dk=type+'_'+d.v.replace('.','_');var qty=parseFloat((D.denoms||{})[dk])||0;var sub=qty*parseFloat(d.v);ht+='<div style="background:var(--surface-2);border:1px solid var(--border);border-radius:8px;padding:10px;text-align:center"><div style="font-size:12px;color:var(--text-primary);margin-bottom:6px;font-weight:700">SAR '+d.l+'</div><input type="number" min="0" value="'+(qty||'')+'" placeholder="0" oninput="dsrUpdDenom(\''+dk+'\',this.value)" style="'+fi+'text-align:center;font-size:15px;font-weight:700;margin-bottom:5px"><div style="font-size:12px;color:var(--ceo);font-family:var(--mono);font-weight:700">='+sub.toFixed(2)+'</div></div>';});
      return ht+'</div>';
    }
    var haveTotal=DENOMS_MF.have.reduce(function(a,d){return a+(parseFloat((D.denoms||{})['mfh_'+d.v.replace('.','_')])||0)*parseFloat(d.v);},0);
    var changeTotal=DENOMS_MF.change.reduce(function(a,d){return a+(parseFloat((D.denoms||{})['mfc_'+d.v.replace('.','_')])||0)*parseFloat(d.v);},0);
    // Auto-pull from Petty Cash current cycle
  var pcCurCycle=BS.pcCycleNo||1;
  var pcCurTotal=(BS.pc||[]).filter(function(p){return (p.cycleNo||1)===pcCurCycle;}).reduce(function(s,p){return s+(+p.amount||0);},0);
  var ongoingPC=pcCurTotal||(D.ongoingPetty||[]).reduce(function(a,p){return a+(parseFloat(p.amount)||0);},0);
  // Auto-pull closed petty cash from pcArchive
  var closedArchive=(BS.pcArchive||[]).filter(function(c){return c.status&&c.status!=='received';});
  var closedPC_auto=closedArchive.reduce(function(s,c){return s+(c.total||0);},0);
  var closedPC=closedPC_auto||(D.closedPetty||[]).reduce(function(a,p){return a+(parseFloat(p.amount)||0);},0);
    var mfCompany=parseFloat(D.mfCompany)||0;
    var mfTotal=haveTotal+changeTotal+closedPC+ongoingPC;
    var mfDiff=mfTotal-mfCompany;
    body+='<div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:14px">';
    body+='<div style="'+card+'"><div style="'+secHdr+'">Company Float</div>';
    body+=grp('Company Provides (‫SAR ‬)','<input type="number" step="0.01" placeholder="e.g. 10000" value="'+(D.mfCompany||'')+'" oninput="dsrUp(\'mfCompany\',this.value)" style="'+fi+'font-size:18px;padding:9px 12px;color:var(--ceo)">');
    body+='<div style="background:var(--surface-2);border-radius:9px;padding:12px;margin-top:8px">';
    function msl(l,v,c,bold){return '<div style="'+sline+(bold?'font-weight:700':'')+'"><span style="color:var(--text-secondary)">'+l+'</span><span style="font-family:var(--mono);color:'+(c||'var(--text-primary)')+'">'+v.toFixed(2)+'</span></div>';}
    body+=msl('Cash',haveTotal);body+=msl('Change in Safe',changeTotal);body+=msl('Closed Petty Cash',closedPC);body+=msl('Ongoing Petty Cash',ongoingPC);
    body+=msl('Total I Account For',mfTotal,'var(--ceo)',true);
    body+=msl('Difference vs Company',mfDiff,Math.abs(mfDiff)<0.01?'#00875a':mfDiff<0?'#c0392b':'#b45309',true);
    body+='</div></div>';
    body+='<div style="'+card+'"><div style="'+secHdr+'">Cash</div>'+denomGrid('mfh',DENOMS_MF.have)+'<div style="font-size:11px;color:var(--ceo);font-family:var(--mono);margin-top:8px;font-weight:700">Total: '+bfsar(haveTotal)+'</div></div>';
    body+='</div>';
    body+='<div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:14px">';
    body+='<div style="'+card+'"><div style="'+secHdr+'">Change in Safe</div>'+denomGrid('mfc',DENOMS_MF.change)+'<div style="font-size:11px;color:var(--ceo);font-family:var(--mono);margin-top:8px;font-weight:700">Total: '+bfsar(changeTotal)+'</div></div>';
    body+='</div>';
    body+='<div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">';
    body+='<div style="'+card+'"><div style="'+secHdr+'">Closed Petty Cash</div>';
    (D.closedPetty||[]).forEach(function(p,i){body+='<div style="display:flex;gap:8px;margin-bottom:8px;align-items:center"><input type="text" placeholder="Description" value="'+bxe(p.desc||'')+'" oninput="dsrUpdArr(\'closedPetty\','+i+',\'desc\',this.value)" style="'+fi+'flex:2"><input type="number" step="0.01" placeholder="SAR " value="'+(p.amount||'')+'" oninput="dsrUpdArr(\'closedPetty\','+i+',\'amount\',this.value)" style="'+fi+'flex:1"><button onclick="dsrRmArr(\'closedPetty\','+i+')" style="color:var(--danger);background:transparent;border:none;cursor:pointer;font-size:18px">×</button></div>';});
    body+='<button onclick="dsrAddArr(\'closedPetty\')" style="padding:6px 14px;border-radius:7px;border:1px solid var(--border);background:var(--surface-2);color:var(--text-primary);font-size:11px;cursor:pointer;margin-top:4px">+ Add</button>';
    body+='<div style="font-size:11px;color:#c0392b;font-family:var(--mono);margin-top:10px;font-weight:700">Total: '+bfsar(closedPC)+'</div></div>';
    body+='<div style="'+card+'"><div style="'+secHdr+'">Ongoing Petty Cash</div>';
    (D.ongoingPetty||[]).forEach(function(p,i){body+='<div style="display:flex;gap:8px;margin-bottom:8px;align-items:center"><input type="text" placeholder="Description" value="'+bxe(p.desc||'')+'" oninput="dsrUpdArr(\'ongoingPetty\','+i+',\'desc\',this.value)" style="'+fi+'flex:2"><input type="number" step="0.01" placeholder="SAR " value="'+(p.amount||'')+'" oninput="dsrUpdArr(\'ongoingPetty\','+i+',\'amount\',this.value)" style="'+fi+'flex:1"><button onclick="dsrRmArr(\'ongoingPetty\','+i+')" style="color:var(--danger);background:transparent;border:none;cursor:pointer;font-size:18px">×</button></div>';});
    body+='<button onclick="dsrAddArr(\'ongoingPetty\')" style="padding:6px 14px;border-radius:7px;border:1px solid var(--border);background:var(--surface-2);color:var(--text-primary);font-size:11px;cursor:pointer;margin-top:4px">+ Add</button>';
    body+='<div style="font-size:11px;color:#c0392b;font-family:var(--mono);margin-top:10px;font-weight:700">Total: '+bfsar(ongoingPC)+'</div></div>';
    body+='</div>';
    body+='<div style="'+card+'"><div style="'+secHdr+'">Safe Contents</div>';
    (D.safeItems||[]).forEach(function(s3,i){body+='<div style="display:flex;gap:8px;margin-bottom:8px;align-items:center"><input type="text" placeholder="Item" value="'+bxe(s3.item||'')+'" oninput="dsrUpdArr(\'safeItems\','+i+',\'item\',this.value)" style="'+fi+'flex:1"><input type="text" placeholder="Remark" value="'+bxe(s3.remark||'')+'" oninput="dsrUpdArr(\'safeItems\','+i+',\'remark\',this.value)" style="'+fi+'flex:2"><button onclick="dsrRmArr(\'safeItems\','+i+')" style="color:var(--danger);background:transparent;border:none;cursor:pointer;font-size:18px">×</button></div>';});
    body+='<button onclick="dsrAddArr(\'safeItems\')" style="padding:6px 14px;border-radius:7px;border:1px solid var(--border);background:var(--surface-2);color:var(--text-primary);font-size:11px;cursor:pointer;margin-top:4px">+ Add Item</button>';
    body+='</div>';
  }

  return '<div class="page-header"><h1>📋 Daily Sales Report</h1><p>'+branchName+'</p></div>'+datePicker+tabBar+body;
}

// ── DSR Helper Functions ──────────────────────────────────────────────────────
function _dsrActiveDate(){return BS.dsrActiveDate||TODAY_BS;}
function _dsrD(){var today=_dsrActiveDate();if(!BS.dsrState)BS.dsrState={};if(!BS.dsrState[today])BS.dsrState[today]={date:today,food:'',bev:'',misc:'',vat:'',vatAlfa:'',guests:'',mfCompany:'',discounts:[],payments:[{id:'p1',method:'Cash',amount:''},{id:'p2',method:'MADA',amount:''},{id:'p3',method:'VISA',amount:''},{id:'p4',method:'Qlub',amount:''}],delivery:[],servers:[],closedPetty:[],ongoingPetty:[],safeItems:[],denoms:{},tab:'overview'};return BS.dsrState[today];}
function dsrChangeDate(val){if(!val)return;BS.dsrActiveDate=val;BS._dsrLoaded=false;dsrLoadFromFirebase(function(){navTo('dsr');});}
function dsrFbPath(dateStr){return 'branches/'+(NX.session&&NX.session.branchId)+'/dsr/'+(dateStr||_dsrActiveDate());}
function dsrNav(tab){var D=_dsrD();D.tab=tab;navTo('dsr');}
function dsrUp(k,v){var D=_dsrD();D[k]=v;}
function dsrRecalc(si){
  // If si provided, update just that server card; otherwise update all
  var D=_dsrD();
  var servers=D.servers||[];
  var indices=(si!==undefined)?[si]:servers.map(function(_,i){return i;});
  indices.forEach(function(i){
    var s=servers[i];if(!s)return;
    // Read live values from DOM (user may be mid-typing)
    function fv(id){var el=document.getElementById(id);return el?parseFloat(el.value)||0:parseFloat(s[{
      'srv_tot_':  'totalSales','srv_cash_': 'cashSales','srv_mada_': 'madaSales',
      'srv_visa_': 'visaSales','srv_mc_':   'mcSales',  'srv_amex_': 'amexSales',
      'srv_qlub_': 'qlubSales','srv_loy_':  'loyaltySales','srv_del_': 'deliverySales',
      'srv_vatalfa_':'vatAlfaSales'
    }[id.replace(String(i),'')]])||0;}
    var total   =parseFloat((document.getElementById('srv_tot_'+i)||{}).value)||parseFloat(s.totalSales)||0;
    var cash    =parseFloat((document.getElementById('srv_cash_'+i)||{}).value)||parseFloat(s.cashSales)||0;
    var mada    =parseFloat((document.getElementById('srv_mada_'+i)||{}).value)||parseFloat(s.madaSales)||0;
    var visa    =parseFloat((document.getElementById('srv_visa_'+i)||{}).value)||parseFloat(s.visaSales)||0;
    var mc      =parseFloat((document.getElementById('srv_mc_'+i)||{}).value)||parseFloat(s.mcSales)||0;
    var amex    =parseFloat((document.getElementById('srv_amex_'+i)||{}).value)||parseFloat(s.amexSales)||0;
    var qlub    =parseFloat((document.getElementById('srv_qlub_'+i)||{}).value)||parseFloat(s.qlubSales)||0;
    var loy     =parseFloat((document.getElementById('srv_loy_'+i)||{}).value)||parseFloat(s.loyaltySales)||0;
    var delivery=parseFloat((document.getElementById('srv_del_'+i)||{}).value)||parseFloat(s.deliverySales)||0;
    var vatAlfa =parseFloat((document.getElementById('srv_vatalfa_'+i)||{}).value)||parseFloat(s.vatAlfaSales)||0;
    var approvedT=(s.tips||[]).filter(function(t){return t.status==='approved';}).reduce(function(a,t){return a+(parseFloat(t.amount)||0);},0);
    var cashDrop=cash-approvedT;
    var sumPayments=cash+mada+visa+mc+amex+qlub+loy+delivery+vatAlfa;
    var diff=total-sumPayments;
    var dc=Math.abs(diff)<0.01?'#00875a':diff>0?'#c0392b':'#b45309';
    var dl=Math.abs(diff)<0.01?'✓ Balanced':diff>0?'Short '+bfsar(Math.abs(diff)):'Over '+bfsar(Math.abs(diff));
    // Update tally badge
    var badge=document.getElementById('srv-tally-'+i);
    if(badge){badge.textContent=dl;badge.style.color=dc;badge.style.background=dc+'18';}
    // Update footer
    var fc=document.getElementById('srv-fc-'+i);if(fc)fc.textContent=bfsar(cash);
    var ft=document.getElementById('srv-ft-'+i);if(ft)ft.textContent=bfsar(approvedT);
    var fd=document.getElementById('srv-fd-'+i);if(fd)fd.textContent=bfsar(cashDrop);
    var fs=document.getElementById('srv-fs-'+i);if(fs){fs.textContent=dl;fs.style.color=dc;}
  });
}
function dsrUpdArr(arr,idx,key,val){var D=_dsrD();if(D[arr]&&D[arr][idx])D[arr][idx][key]=val;}
function dsrRmArr(arr,idx){var D=_dsrD();if(D[arr])D[arr].splice(idx,1);navTo('dsr');}
function dsrAddArr(arr){var D=_dsrD();var defaults={closedPetty:{id:buid(),desc:'',amount:''},ongoingPetty:{id:buid(),desc:'',amount:''},safeItems:{id:buid(),item:'',remark:''}};D[arr].push(defaults[arr]||{id:buid()});navTo('dsr');}
function dsrAddDisc(){var D=_dsrD();D.discounts.push({id:buid(),type:'',amount:''});navTo('dsr');}
function dsrAddPay(){var D=_dsrD();D.payments.push({id:buid(),method:'Cash',amount:''});navTo('dsr');}
function dsrAddDeliv(){var D=_dsrD();D.delivery.push({id:buid(),platform:'',amount:'',orders:''});navTo('dsr');}
function dsrAddServer(){var D=_dsrD();D.servers.push({id:buid(),name:'',sap:'',totalSales:'',cashSales:'',madaSales:'',visaSales:'',mcSales:'',amexSales:'',qlubSales:'',loyaltySales:'',deliverySales:'',vatAlfaSales:'',tips:[],voids:[],returns:[]});navTo('dsr');}
function dsrRmServer(si){var D=_dsrD();if(!confirm('Remove this server?'))return;D.servers.splice(si,1);var activeDate=_dsrActiveDate();if(db&&NX.session&&NX.session.branchId){db.ref(dsrFbPath(activeDate)).set(D,function(err){if(err)showToast('Save failed','error');});}navTo('dsr');}
function dsrUpdSrv(si,k,v){var D=_dsrD();if(D.servers[si])D.servers[si][k]=v;}
function dsrAddTip(si){var D=_dsrD();if(!D.servers[si])return;D.servers[si].tips.push({id:buid(),method:'MADA',amount:'',approval:'',guest:'',status:'pending'});navTo('dsr');}
function dsrRmTip(si,id){var D=_dsrD();if(!D.servers[si])return;D.servers[si].tips=D.servers[si].tips.filter(function(t){return t.id!==id;});navTo('dsr');}
function dsrUpdTip(si,id,k,v){var D=_dsrD();var t=(D.servers[si]&&D.servers[si].tips||[]).find(function(x){return x.id===id;});if(t)t[k]=v;}
function dsrTipApprove(si,id){var D=_dsrD();var t=(D.servers[si]&&D.servers[si].tips||[]).find(function(x){return x.id===id;});if(t)t.status='approved';navTo('dsr');}
function dsrTipReject(si,id){var D=_dsrD();var t=(D.servers[si]&&D.servers[si].tips||[]).find(function(x){return x.id===id;});if(t)t.status='rejected';navTo('dsr');}
function dsrTipReset(si,id){var D=_dsrD();var t=(D.servers[si]&&D.servers[si].tips||[]).find(function(x){return x.id===id;});if(t)t.status='pending';navTo('dsr');}
function dsrAddVoid(si){var D=_dsrD();if(!D.servers[si])return;D.servers[si].voids.push({id:buid(),item:'',reason:'',check:'',manager:'',amount:'',status:'pending'});navTo('dsr');}
function dsrAddRet(si){var D=_dsrD();if(!D.servers[si])return;D.servers[si].returns.push({id:buid(),item:'',reason:'',check:'',manager:'',amount:'',status:'pending'});navTo('dsr');}
function dsrRmVR(si,arr,id){var D=_dsrD();if(!D.servers[si])return;D.servers[si][arr]=D.servers[si][arr].filter(function(v){return v.id!==id;});navTo('dsr');}
function dsrUpdVR(si,arr,id,k,v){var D=_dsrD();var item=(D.servers[si]&&D.servers[si][arr]||[]).find(function(x){return x.id===id;});if(item)item[k]=v;}
function dsrApprVR(si,arr,id){var D=_dsrD();var item=(D.servers[si]&&D.servers[si][arr]||[]).find(function(x){return x.id===id;});if(item){if(item.status==='pending')item.status='approved';else item.status='pending';}navTo('dsr');}
function dsrRejVR(si,arr,id){var D=_dsrD();var item=(D.servers[si]&&D.servers[si][arr]||[]).find(function(x){return x.id===id;});if(item)item.status='rejected';navTo('dsr');}
function dsrUpdDenom(k,v){
  var D=_dsrD();
  if(!D.denoms)D.denoms={};
  D.denoms[k]=parseFloat(v)||0;
  // Update this denom's subtotal in-place
  var denomVal=parseFloat(k.replace('dep_','').replace('_','.'))||0;
  var sub=D.denoms[k]*denomVal;
  var subEl=document.getElementById('denom-sub-'+k);
  if(subEl)subEl.textContent='='+sub.toFixed(2);
  // Update running total in-place
  var total=Object.keys(D.denoms).filter(function(dk){return dk.indexOf('dep_')===0;}).reduce(function(s,dk){
    var dv=parseFloat(dk.replace('dep_','').replace('_','.'))||0;
    return s+(D.denoms[dk]*dv);
  },0);
  var el=document.getElementById('denom-total');
  if(el)el.textContent='SAR '+total.toLocaleString('en',{minimumFractionDigits:2,maximumFractionDigits:2});
}
function dsrSave(){var D=_dsrD();var activeDate=_dsrActiveDate();if(db&&NX.session&&NX.session.branchId){db.ref(dsrFbPath(activeDate)).set(D,function(err){if(err)showToast('Save failed','error');else showToast('DSR saved to Firebase ✓','success');});}else{try{localStorage.setItem('dsr_nexus_'+activeDate,JSON.stringify(D));showToast('DSR saved locally ✓','success');}catch(e){showToast('Save failed','error');}}}
function dsrClear(){
  var activeDate=_dsrActiveDate();
  openModal('<div class="modal-head"><h2>⊗ Clear DSR</h2><button class="modal-close" onclick="closeModalForce()">&#x2715;</button></div>'+
    '<p style="margin-bottom:16px;color:var(--text-secondary);font-size:13px">Clear all DSR data for <strong>'+activeDate+'</strong>?<br><br>This resets all tabs <u>except Master File</u>. Cash counts, petty cash and safe items are preserved.</p>'+
    '<div style="display:flex;gap:10px"><button class="btn" style="flex:1" onclick="closeModalForce()">Cancel</button>'+
    '<button class="btn btn-danger" style="flex:1;background:#ef4444;color:#fff;border-color:#ef4444" onclick="closeModalForce();dsrClearConfirmed()">Clear DSR</button></div>');
}
function dsrClearConfirmed(){
  var activeDate=_dsrActiveDate();
  {
  var s=NX.session||{};
  var current=BS.dsrState[activeDate]||{};
  // Preserve ALL Master File data — mfCompany, all denoms (mfh_*/mfc_*), closedPetty, ongoingPetty, safeItems
  var preservedDenoms={};
  Object.keys(current.denoms||{}).forEach(function(k){
    if(k.indexOf('mfh_')===0||k.indexOf('mfc_')===0) preservedDenoms[k]=(current.denoms||{})[k];
  });
  var blank={
    date:activeDate,
    restName:current.restName||s.branchName||'',
    food:'',bev:'',misc:'',vat:'',vatAlfa:'',guests:'',
    // ── Master File preserved ──
    mfCompany:current.mfCompany||'',
    closedPetty:current.closedPetty||[],
    ongoingPetty:current.ongoingPetty||[],
    safeItems:current.safeItems||[],
    denoms:Object.assign({},preservedDenoms),
    // ── Reset everything else ──
    discounts:[],
    payments:[{id:'p1',method:'Cash',amount:''},{id:'p2',method:'MADA',amount:''},{id:'p3',method:'VISA',amount:''},{id:'p4',method:'Qlub',amount:''}],
    delivery:[],servers:[],tab:'overview'
  };
  BS.dsrState[activeDate]=blank;
  if(db&&NX.session&&NX.session.branchId){
    db.ref(dsrFbPath(activeDate)).set(blank,function(err){
      if(err)showToast('Firebase save failed: '+err.message,'error');
      else showToast('DSR cleared — Master File preserved ✓','success');
    });
  }
  navTo('dsr');
  }
}
function dsrEndShift(){
  var activeDate=_dsrActiveDate();
  openModal('<div class="modal-head"><h2>🌙 End Shift</h2><button class="modal-close" onclick="closeModalForce()">&#x2715;</button></div>'+
    '<p style="margin-bottom:16px;color:var(--text-secondary);font-size:13px">End shift for <strong>'+activeDate+'</strong>?<br><br>This will save the DSR, mark shift closed, and advance to the next day. No data will be deleted.</p>'+
    '<div style="display:flex;gap:10px"><button class="btn" style="flex:1" onclick="closeModalForce()">Cancel</button>'+
    '<button class="btn" style="flex:1;background:#b45309;color:#fff;border-color:#b45309;font-weight:700" onclick="closeModalForce();dsrEndShiftConfirmed()">End Shift</button></div>');
}
function dsrEndShiftConfirmed(){
  var activeDate=_dsrActiveDate();
  var D=BS.dsrState[activeDate]||{};
  {
  // Mark shift as closed
  D.shiftClosed=true;
  D.shiftClosedAt=new Date().toISOString();
  D.shiftClosedBy=(NX.session&&NX.session.userName)||(NX.session&&NX.session.entityName)||'';
  BS.dsrState[activeDate]=D;
  // Save to Firebase
  if(db&&NX.session&&NX.session.branchId){
    db.ref(dsrFbPath(activeDate)).set(D,function(err){
      if(err){showToast('End shift save failed: '+err.message,'error');return;}
      // Sync delivery+cash+card into sales collection for Finance/CEO
      var _dd=(D.delivery||[]).reduce(function(s,d){return s+(parseFloat(d.amount)||0);},0);
      var _dc=(D.servers||[]).reduce(function(s,sv){return s+(parseFloat(sv.cashSales)||0);},0);
      var _dcard=(D.payments||[]).filter(function(p){var m=(p.method||'').toLowerCase();return m!=='cash';}).reduce(function(s,p){return s+(parseFloat(p.amount)||0);},0);
      if((_dd>0||_dc>0||_dcard>0)&&db&&NX.session&&NX.session.branchId){
        (function(){var _sr=db.ref('branches/'+NX.session.branchId+'/sales');
        _sr.once('value',function(snap){
          var _raw=snap.val()||{},_arr=Array.isArray(_raw)?_raw:Object.values(_raw).filter(Boolean);
          var _ex=_arr.find(function(e){return e&&e.date===activeDate;});
          if(_ex&&_ex.id){
            var _k=String(_ex.id).replace(/[.#$\[\]\/]/g,'_'),_u={};
            if(_dd>0)_u.delivery=_dd;
            if(_dc>0)_u.cash=_dc;
            if(_dcard>0)_u.card=_dcard;
            _sr.child(_k).update(_u);
          }
        });})();
      }
      // Advance to next day
      var nextDate=new Date(activeDate+'T00:00:00');
      nextDate.setDate(nextDate.getDate()+1);
      var nextStr=nextDate.getFullYear()+'-'+String(nextDate.getMonth()+1).padStart(2,'0')+'-'+String(nextDate.getDate()).padStart(2,'0');
      // Initialize next day — carry forward ALL Master File data
      var s=NX.session||{};
      var nextDenoms={};
      Object.keys(D.denoms||{}).forEach(function(k){
        if(k.indexOf('mfh_')===0||k.indexOf('mfc_')===0) nextDenoms[k]=(D.denoms||{})[k];
      });
      BS.dsrState[nextStr]={
        date:nextStr,restName:D.restName||s.branchName||'',food:'',bev:'',misc:'',vat:'',vatAlfa:'',guests:'',
        // ── Master File carried forward ──
        mfCompany:D.mfCompany||'',
        closedPetty:D.closedPetty||[],
        ongoingPetty:D.ongoingPetty||[],
        safeItems:D.safeItems||[],
        denoms:nextDenoms,
        // ── Fresh day data ──
        discounts:[],payments:[{id:'p1',method:'Cash',amount:''},{id:'p2',method:'MADA',amount:''},{id:'p3',method:'VISA',amount:''},{id:'p4',method:'Qlub',amount:''}],
        delivery:[],servers:[],tab:'overview'
      };
      BS.dsrActiveDate=nextStr;
      BS._dsrDateChanged=true;
      showToast('Shift ended. Now editing '+nextStr,'success');
      navTo('dsr');
    });
  } else {
    showToast('Firebase not connected','error');
  }
  }
}
function dsrPrintFull(){var D=_dsrD();var food=parseFloat(D.food)||0,bev=parseFloat(D.bev)||0,misc=parseFloat(D.misc)||0,vat=parseFloat(D.vat)||0;var totalDisc=(D.discounts||[]).reduce(function(a,d){return a+(parseFloat(d.amount)||0);},0);var netSales=(food+bev+misc)-totalDisc;var totalSales=netSales+vat;var serverCash=(D.servers||[]).reduce(function(a,s){return a+(parseFloat(s.cashSales)||0);},0);var approvedTips=(D.servers||[]).reduce(function(a,s){return a+(s.tips||[]).filter(function(t){return t.status==='approved';}).reduce(function(b,t){return b+(parseFloat(t.amount)||0);},0);},0);var toDeposit=serverCash-approvedTips;var guests=parseInt(D.guests)||0;var checkAvg=guests>0?netSales/guests:0;var dateStr=new Date(D.date+'T00:00:00').toLocaleDateString('en-US',{weekday:'long',year:'numeric',month:'long',day:'numeric'});var payRows=(D.payments||[]).map(function(p){return '<tr><td>'+bxe(p.method)+'</td><td style="text-align:right">'+(parseFloat(p.amount||0)).toFixed(2)+'</td></tr>';}).join('');var delivRows=(D.delivery||[]).map(function(d){return '<tr><td>'+bxe(d.platform||'—')+'</td><td>'+(d.orders||0)+' orders</td><td style="text-align:right">'+(parseFloat(d.amount||0)).toFixed(2)+'</td></tr>';}).join('');var discRows=(D.discounts||[]).map(function(d){return '<tr><td>'+bxe(d.type||'—')+'</td><td style="text-align:right">'+(parseFloat(d.amount||0)).toFixed(2)+'</td></tr>';}).join('');var html='<!DOCTYPE html><html><head><meta charset="UTF-8"><title>DSR - '+(D.restName||'')+'</title><style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:Arial,sans-serif;padding:20px;color:#111;font-size:11px}@page{size:A4;margin:8mm}@media print{button{display:none!important}}h2{font-size:18px;font-weight:800;color:#1a2340}table{width:100%;border-collapse:collapse;margin-bottom:10px}th{background:#1a2340;color:#fff;padding:6px 8px;text-align:left;font-size:9px;text-transform:uppercase}td{padding:6px 8px;border-bottom:1px solid #eee}.amt{text-align:right;font-family:monospace;font-weight:600}.sig-row{display:grid;grid-template-columns:repeat(3,1fr);gap:30px;margin-top:24px}.sig-box{border-top:1px solid #333;padding-top:4px;text-align:center;font-size:9px;color:#666}</style></head><body>';html+='<div style="display:flex;justify-content:space-between;border-bottom:3px solid #1a2340;padding-bottom:10px;margin-bottom:16px"><div><img src="https://i.imgur.com/jeqtcE2.png" alt="ALFA.CO" style="height:44px;width:auto;display:block"><div style="font-size:11px;color:#888">'+bxe(D.restName||'')+'</div></div><div style="text-align:right"><div style="font-size:16px;font-weight:800;color:#1a2340">DAILY SALES REPORT</div><div style="font-size:10px;color:#666">'+dateStr+'</div></div></div>';html+='<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:14px"><table><thead><tr><th colspan="2">Sales Summary</th></tr></thead><tbody><tr><td>Food + Bev + MISC</td><td class="amt">'+(food+bev+misc).toFixed(2)+'</td></tr><tr><td>(-) Discounts</td><td class="amt">('+totalDisc.toFixed(2)+')</td></tr><tr style="font-weight:700;background:#f5f5f5"><td>= Net Sales</td><td class="amt">'+netSales.toFixed(2)+'</td></tr><tr><td>+ System VAT</td><td class="amt">'+vat.toFixed(2)+'</td></tr><tr style="font-weight:700;background:#e8f0fe"><td>= Total Sales</td><td class="amt">'+totalSales.toFixed(2)+'</td></tr></tbody></table>';html+='<table><thead><tr><th colspan="2">Cash Reconciliation</th></tr></thead><tbody><tr><td>Guest Count</td><td class="amt">'+guests+'</td></tr><tr><td>Check Average</td><td class="amt">'+checkAvg.toFixed(2)+'</td></tr><tr><td>Server Cash Total</td><td class="amt">'+serverCash.toFixed(2)+'</td></tr><tr><td>(-) Credit Tips Paid</td><td class="amt">('+approvedTips.toFixed(2)+')</td></tr><tr style="font-weight:700;background:#e8f5e9"><td>Amount to Deposit</td><td class="amt">'+toDeposit.toFixed(2)+'</td></tr></tbody></table></div>';html+='<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-bottom:14px"><table><thead><tr><th colspan="2">Payment Methods</th></tr></thead><tbody>'+(payRows||'<tr><td colspan="2">None</td></tr>')+'</tbody></table><table><thead><tr><th colspan="3">Delivery</th></tr></thead><tbody>'+(delivRows||'<tr><td colspan="3">None</td></tr>')+'</tbody></table><table><thead><tr><th colspan="2">Discounts</th></tr></thead><tbody>'+(discRows||'<tr><td colspan="2">None</td></tr>')+'</tbody></table></div>';html+='<div class="sig-row"><div class="sig-box">Manager</div><div class="sig-box">Cashier / Supervisor</div><div class="sig-box">Date & Stamp</div></div>';html+='<div style="text-align:center;margin-top:16px"><button onclick="window.print()" style="background:#1a2340;color:#fff;border:none;border-radius:8px;padding:10px 28px;font-size:13px;font-weight:700;cursor:pointer">Print / Save PDF</button></div></body></html>';var w=window.open('','_blank','width=900,height=700');if(w){w.document.write(html);w.document.close();}else showToast('Allow pop-ups to print','error');}
function dsrPrintVR(){var D=_dsrD();var rows=[];(D.servers||[]).forEach(function(s){(s.voids||[]).filter(function(v){return v.status==='approved';}).forEach(function(v){rows.push({server:s.name,sap:s.sap,type:'Void',item:v.item,check:v.check,reason:v.reason,manager:v.manager,amount:v.amount});});(s.returns||[]).filter(function(v){return v.status==='approved';}).forEach(function(v){rows.push({server:s.name,sap:s.sap,type:'Return',item:v.item,check:v.check,reason:v.reason,manager:v.manager,amount:v.amount});});});var tot=rows.reduce(function(a,v){return a+(parseFloat(v.amount)||0);},0);var dateStr=new Date(D.date+'T00:00:00').toLocaleDateString('en-US',{weekday:'long',year:'numeric',month:'long',day:'numeric'});var html='<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Voids & Returns</title><style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:Arial,sans-serif;padding:20px;color:#111;font-size:11px}@media print{button{display:none!important}@page{size:A4;margin:8mm}}table{width:100%;border-collapse:collapse}th{background:#1a2340;color:#fff;padding:6px 8px;text-align:left;font-size:9px;text-transform:uppercase}td{padding:7px 8px;border-bottom:1px solid #eee}.amt{text-align:right;font-family:monospace;font-weight:600}</style></head><body><div style="display:flex;justify-content:space-between;border-bottom:3px solid #1a2340;padding-bottom:10px;margin-bottom:16px"><div><img src="https://i.imgur.com/jeqtcE2.png" alt="ALFA.CO" style="height:44px;width:auto;display:block"><div>'+bxe(D.restName||'')+'</div></div><div style="text-align:right"><div style="font-size:16px;font-weight:700">VOIDS & RETURNS REPORT</div><div style="font-size:10px;color:#666">'+dateStr+'</div></div></div><table><thead><tr><th>Server</th><th>SAP</th><th>Type</th><th>Item</th><th>Check #</th><th>Reason</th><th>Manager</th><th class="amt">Amount SAR </th></tr></thead><tbody>'+(rows.length?rows.map(function(v){return '<tr><td>'+bxe(v.server||'—')+'</td><td>'+bxe(v.sap||'—')+'</td><td>'+v.type+'</td><td>'+bxe(v.item||'—')+'</td><td>'+bxe(v.check||'—')+'</td><td>'+bxe(v.reason||'—')+'</td><td>'+bxe(v.manager||'—')+'</td><td class="amt">'+(parseFloat(v.amount||0)).toFixed(2)+'</td></tr>';}).join(''):'<tr><td colspan="8" style="text-align:center;padding:16px;color:#999">No approved voids or returns</td></tr>')+'<tr style="font-weight:700;background:#f5f5f5"><td colspan="7">TOTAL</td><td class="amt">'+tot.toFixed(2)+'</td></tr></tbody></table><div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:30px;margin-top:24px"><div style="border-top:1px solid #333;padding-top:4px;text-align:center;font-size:9px;color:#666">Manager</div><div style="border-top:1px solid #333;padding-top:4px;text-align:center;font-size:9px;color:#666">Date</div><div style="border-top:1px solid #333;padding-top:4px;text-align:center;font-size:9px;color:#666">Verified By</div></div><div style="text-align:center;margin-top:14px"><button onclick="window.print()" style="background:#1a2340;color:#fff;border:none;border-radius:8px;padding:10px 24px;font-size:13px;font-weight:700;cursor:pointer">Print</button></div></body></html>';var w=window.open('','_blank','width=900,height=600');if(w){w.document.write(html);w.document.close();}else showToast('Allow pop-ups','error');}
function dsrPrintTips(){var D=_dsrD();var rows=[];(D.servers||[]).forEach(function(s){(s.tips||[]).filter(function(t){return t.status==='approved';}).forEach(function(t){rows.push({server:s.name,sap:s.sap,method:t.method,amount:t.amount,approval:t.approval,guest:t.guest});});});var tot=rows.reduce(function(a,t){return a+(parseFloat(t.amount)||0);},0);var dateStr=new Date(D.date+'T00:00:00').toLocaleDateString('en-US',{weekday:'long',year:'numeric',month:'long',day:'numeric'});var html='<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Tips Report</title><style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:Arial,sans-serif;padding:20px;color:#111;font-size:11px}@media print{button{display:none!important}@page{size:A4;margin:8mm}}table{width:100%;border-collapse:collapse}th{background:#1a2340;color:#fff;padding:6px 8px;text-align:left;font-size:9px;text-transform:uppercase}td{padding:7px 8px;border-bottom:1px solid #eee}.amt{text-align:right;font-family:monospace;font-weight:600}</style></head><body><div style="display:flex;justify-content:space-between;border-bottom:3px solid #1a2340;padding-bottom:10px;margin-bottom:16px"><div><img src="https://i.imgur.com/jeqtcE2.png" alt="ALFA.CO" style="height:44px;width:auto;display:block"><div>'+bxe(D.restName||'')+'</div></div><div style="text-align:right"><div style="font-size:16px;font-weight:700">TIPS REPORT</div><div style="font-size:10px;color:#666">'+dateStr+'</div></div></div><table><thead><tr><th>Server</th><th>SAP</th><th>Card Method</th><th class="amt">Amount SAR </th><th>Approval Code</th><th>Guest #</th></tr></thead><tbody>'+(rows.length?rows.map(function(t){return '<tr><td>'+bxe(t.server||'—')+'</td><td>'+bxe(t.sap||'—')+'</td><td>'+bxe(t.method)+'</td><td class="amt">'+(parseFloat(t.amount||0)).toFixed(2)+'</td><td>'+bxe(t.approval||'—')+'</td><td>'+bxe(t.guest||'—')+'</td></tr>';}).join(''):'<tr><td colspan="6" style="text-align:center;padding:16px;color:#999">No approved tips</td></tr>')+'<tr style="font-weight:700;background:#f5f5f5"><td colspan="3">TOTAL TIPS</td><td class="amt">'+tot.toFixed(2)+'</td><td colspan="2"></td></tr></tbody></table><div style="text-align:center;margin-top:14px"><button onclick="window.print()" style="background:#1a2340;color:#fff;border:none;border-radius:8px;padding:10px 24px;font-size:13px;font-weight:700;cursor:pointer">Print</button></div></body></html>';var w=window.open('','_blank','width=900,height=600');if(w){w.document.write(html);w.document.close();}else showToast('Allow pop-ups','error');}
function dsrPrintDeposit(){var D=_dsrD();var DENOMS_DEP2=[{v:'500',l:'500'},{v:'200',l:'200'},{v:'100',l:'100'},{v:'50',l:'50'},{v:'20',l:'20'},{v:'10',l:'10'},{v:'5',l:'5'},{v:'1',l:'1.00'},{v:'0.5',l:'0.50'},{v:'0.25',l:'0.25'}];var serverCash4=(D.servers||[]).reduce(function(a,s){return a+(parseFloat(s.cashSales)||0);},0);var approvedTips4=(D.servers||[]).reduce(function(a,s){return a+(s.tips||[]).filter(function(t){return t.status==='approved';}).reduce(function(b,t){return b+(parseFloat(t.amount)||0);},0);},0);var toDeposit4=serverCash4-approvedTips4;var notes=0,coins=0;var denomRows='';DENOMS_DEP2.forEach(function(d){var qty=parseFloat((D.denoms||{})['dep_'+d.v.replace('.','_')])||0;var sub=qty*parseFloat(d.v);if(qty>0){denomRows+='<tr><td>SAR '+d.l+'</td><td style="text-align:center">'+qty+'</td><td style="text-align:right">'+sub.toFixed(2)+'</td></tr>';}if(parseFloat(d.v)>=5)notes+=sub;else coins+=sub;});var physical=notes+coins;var diff=physical-toDeposit4;var dateStr=new Date(D.date+'T00:00:00').toLocaleDateString('en-US',{weekday:'long',year:'numeric',month:'long',day:'numeric'});var html='<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Deposit Sheet</title><style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:Arial,sans-serif;padding:20px;color:#111;font-size:11px}@media print{button{display:none!important}@page{size:A4;margin:8mm}}table{width:100%;border-collapse:collapse}th{background:#1a2340;color:#fff;padding:6px 8px;text-align:left;font-size:9px;text-transform:uppercase}td{padding:7px 8px;border-bottom:1px solid #eee}.amt{text-align:right;font-family:monospace;font-weight:600}</style></head><body><div style="display:flex;justify-content:space-between;border-bottom:3px solid #1a2340;padding-bottom:10px;margin-bottom:16px"><div><img src="https://i.imgur.com/jeqtcE2.png" alt="ALFA.CO" style="height:44px;width:auto;display:block"><div>'+bxe(D.restName||'')+'</div></div><div style="text-align:right"><div style="font-size:16px;font-weight:700">DAILY DEPOSIT SHEET</div><div style="font-size:10px;color:#666">'+dateStr+'</div></div></div><div style="display:grid;grid-template-columns:1fr 1fr;gap:20px"><table><thead><tr><th>Denomination</th><th style="text-align:center">Qty</th><th style="text-align:right">Amount SAR </th></tr></thead><tbody>'+(denomRows||'<tr><td colspan="3" style="text-align:center;color:#999">No denominations entered</td></tr>')+'<tr style="background:#f0f0f0"><td>Notes</td><td></td><td style="text-align:right">'+notes.toFixed(2)+'</td></tr><tr style="background:#f0f0f0"><td>Coins</td><td></td><td style="text-align:right">'+coins.toFixed(2)+'</td></tr><tr style="font-weight:700;background:#e8e8e8"><td>TOTAL PHYSICAL</td><td></td><td style="text-align:right">'+physical.toFixed(2)+'</td></tr></tbody></table><table><thead><tr><th colspan="2">Deposit Calculation</th></tr></thead><tbody><tr><td>Server Cash Total</td><td class="amt">'+serverCash4.toFixed(2)+'</td></tr><tr><td>(-) Credit Tips Paid</td><td class="amt">('+approvedTips4.toFixed(2)+')</td></tr><tr style="font-weight:700;background:#e8f5e9"><td>Amount to Deposit</td><td class="amt">'+toDeposit4.toFixed(2)+'</td></tr><tr><td>Physical Cash Counted</td><td class="amt">'+physical.toFixed(2)+'</td></tr><tr style="font-weight:700;background:'+(Math.abs(diff)<0.01?'#e8f5e9':'#ffebee')+'"><td>Variance</td><td class="amt">'+(diff>=0?'+':'')+diff.toFixed(2)+'</td></tr></tbody></table></div><div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:30px;margin-top:28px"><div style="border-top:1px solid #333;padding-top:4px;text-align:center;font-size:9px;color:#666">Cashier / Supervisor</div><div style="border-top:1px solid #333;padding-top:4px;text-align:center;font-size:9px;color:#666">Manager</div><div style="border-top:1px solid #333;padding-top:4px;text-align:center;font-size:9px;color:#666">Date & Stamp</div></div><div style="text-align:center;margin-top:14px"><button onclick="window.print()" style="background:#1a2340;color:#fff;border:none;border-radius:8px;padding:10px 24px;font-size:13px;font-weight:700;cursor:pointer">Print</button></div></body></html>';var w=window.open('','_blank','width=900,height=600');if(w){w.document.write(html);w.document.close();}else showToast('Allow pop-ups','error');}
// Load DSR from Firebase when entering DSR page — also picks up server drops from standalone page
function dsrLoadFromFirebase(cb){
  var activeDate=_dsrActiveDate();
  if(!db||!NX.session||!NX.session.branchId){if(cb)cb();return;}
  db.ref(dsrFbPath(activeDate)).once('value',function(snap){
    var data=snap.val()||{};
    if(!BS.dsrState)BS.dsrState={};
    if(data.date){
      // Always load from Firebase when explicitly called (date change or page load)
      BS.dsrState[activeDate]=Object.assign({tab:(BS.dsrState[activeDate]&&BS.dsrState[activeDate].tab)||'overview'},data);
    }
    // Merge server drops from standalone server-drop.html
    var drops=data.server_drops?Object.values(data.server_drops):[];
    if(drops.length){
      var D=BS.dsrState[activeDate];if(!D)return;
      var existingIds=(D.servers||[]).map(function(s){return s.id;});
      drops.forEach(function(d){if(existingIds.indexOf(d.id)<0){D.servers=(D.servers||[]);D.servers.push(d);}});
      showToast(drops.length+' server drop(s) loaded from field','success');
    }
    if(cb)cb();else navTo('dsr');
  });
}
window['after_dsr']=function(){if(!BS._dsrLoaded){BS._dsrLoaded=true;dsrLoadFromFirebase();} else if(BS._dsrDateChanged){BS._dsrDateChanged=false;dsrLoadFromFirebase();}};

window['after_food_cost']=function(){
  var s=NX.session||{};
  if(s.role==='branch_mgr')return; // branch manager uses live BS data, no loading needed
  if(!db)return;
  if(!NX._fcCache)NX._fcCache={};
  var branches=getAccessibleBranches();
  if(!branches.length)return;
  var loaded=0;
  var now=new Date();
  var tm=now.getFullYear()+'-'+(now.getMonth()<9?'0':'')+(now.getMonth()+1);
  branches.forEach(function(b){
    if(NX._fcCache[b.id])return; // already loaded
    loaded++;
    db.ref('branches/'+b.id+'/waste').once('value',function(snap){
      var raw=snap.val()||{};
      var arr=Array.isArray(raw)?raw.filter(Boolean):Object.values(raw).filter(Boolean);
      // Load sales too
      loadBranchSalesData(b.id,function(){
        NX._fcCache[b.id]={waste:arr,mtdSales:branchSalesMTD(b.id)};
        loaded--;
        if(loaded===0)navTo('food-cost');
      });
    });
  });
  if(loaded===0)navTo('food-cost'); // all cached, refresh view
};

function clNxWk(){var now=new Date(),dow=now.getDay(),sun=new Date(now);sun.setDate(now.getDate()-dow);return sun.getFullYear()+'-'+String(sun.getMonth()+1).padStart(2,'0')+'-'+String(sun.getDate()).padStart(2,'0');}
function clNxEnsureST(){var wk=clNxWk();if(!clNxState[wk])clNxState[wk]={};var state=clNxState[wk];['mod','foh','boh'].forEach(function(sec){(CL_DATA_NX[sec]||[]).forEach(function(cl){if(!state[cl.id])state[cl.id]={};var days=clNxWeekDates.length||7;for(var di=0;di<days;di++){if(!state[cl.id][di])state[cl.id][di]={};(cl.groups||[]).forEach(function(g){(g.items||[]).forEach(function(item){if(!state[cl.id][di][item.id])state[cl.id][di][item.id]={yn:'',temp:'',comment:'',flagged:false};});});}});});}
var _clNxST=null;
function clNxSave(){clearTimeout(_clNxST);_clNxST=setTimeout(function(){if(!db)return;var wk=clNxWk();var fbKey=wk.replace(/[.#$\[\]\/]/g,'_');db.ref(bPath('cl_weeks')+'/'+fbKey).set({state:clNxState[wk]||{},meta:{branch:NX.session&&NX.session.branchName||'',updatedAt:Date.now()}});},700);}
function clNxSaveNow(){clNxSave();showToast('Checklist saved','success');}
function clNxInitFBSync(){if(!db){setTimeout(clNxInitFBSync,800);return;}var wk=clNxWk(),fbKey=wk.replace(/[.#$\[\]\/]/g,'_');db.ref(bPath('cl_weeks')+'/'+fbKey).once('value',function(snap){var d=snap.val();if(d&&d.state)clNxState[wk]=d.state;clNxEnsureST();var wrap=document.getElementById('cl-nx-cards');if(wrap)clNxRenderContent();});}
function pChecklists() {
  attachBranchListeners();
  clNxWeekDates=[];
  var now=new Date(),dow=now.getDay(),sun=new Date(now);sun.setDate(now.getDate()-dow);
  for(var i=0;i<7;i++){var dd=new Date(sun);dd.setDate(sun.getDate()+i);clNxWeekDates.push(dd.getFullYear()+'-'+String(dd.getMonth()+1).padStart(2,'0')+'-'+String(dd.getDate()).padStart(2,'0'));}
  clNxInitFBSync();
  var h='<div class="page-header"><h1>Operations Checklists</h1><p>Week of '+bxe(clNxWk())+'</p></div>';
  if(!clNxRole){return h+'<div class="bcard" style="max-width:420px;margin:0 auto"><div style="font-size:16px;font-weight:700;font-family:var(--font-display);margin-bottom:16px;text-align:center">Sign In</div><div style="display:flex;gap:10px;margin-bottom:16px"><button class="btn" style="flex:1" onclick="clNxRole=\'staff\';navTo(\'checklists\')">Staff Access</button><button class="btn" style="flex:1" onclick="clNxShowAdminPin()">Admin Access</button></div><div id="cl-nx-pin-area"></div></div>';}
  var secs=['mod','foh','boh'],secLabels={mod:'MOD',foh:'FOH',boh:'BOH'};
  var secTabs=secs.map(function(s){return '<button class="tab-btn'+(clNxSec===s?' active':'')+'" onclick="clNxSec=\''+s+'\';clNxCl[clNxSec]=0;clNxRenderContent()">'+secLabels[s]+'</button>';}).join('');
  h+='<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px"><div class="tab-row" style="margin-bottom:0">'+secTabs+'</div><div style="display:flex;gap:8px">';
  if(clNxRole==='admin')h+='<button class="btn btn-sm" onclick="clNxOpenPrint()">Print</button>';
  h+='<button class="btn btn-sm" onclick="clNxRole=null;navTo(\'checklists\')">Sign Out</button>';
  h+='<span class="badge '+(clNxRole==='admin'?'badge-purple':'badge-green')+'" style="align-self:center">'+(clNxRole==='admin'?'Admin':'Staff')+'</span></div></div>';
  h+='<div id="cl-nx-cards">Loading\u2026</div>';
  setTimeout(function(){clNxEnsureST();clNxRenderContent();},50);
  return h;
}
function clNxShowAdminPin(){var area=document.getElementById('cl-nx-pin-area');if(!area)return;area.innerHTML='<div style="font-size:12px;color:var(--text-secondary);margin-bottom:8px">Enter admin PIN:</div><div style="display:flex;gap:8px"><input class="form-input" type="password" id="cl-nx-pin" placeholder="\u2022\u2022\u2022\u2022" maxlength="4" style="flex:1"><button class="btn btn-primary" onclick="clNxCheckPin()">Enter</button></div><div id="cl-nx-pin-err" style="color:var(--danger);font-size:11px;margin-top:6px;min-height:16px"></div>';}
function clNxCheckPin(){var pin=bgv('cl-nx-pin');if(pin===CL_NX_ADMIN_PIN){clNxRole='admin';navTo('checklists');}else{var err=document.getElementById('cl-nx-pin-err');if(err)err.textContent='Incorrect PIN';}}
function clNxRenderContent(){var wrap=document.getElementById('cl-nx-cards');if(!wrap)return;if(typeof CL_DATA_NX==='undefined'||!CL_DATA_NX){wrap.innerHTML='<div style="text-align:center;padding:40px;color:var(--text-secondary)"><div style="font-size:28px;margin-bottom:12px">✅</div><div style="font-size:13px;font-weight:600">Loading checklists…</div></div>';return;}var sec=clNxSec,cls=CL_DATA_NX[sec]||[];if(!cls.length){wrap.innerHTML='<div class="empty-state"><div class="es-icon">\ud83d\udccb</div><h3>No checklists for this section</h3></div>';return;}var ci=clNxCl[sec]||0;if(ci>=cls.length)ci=0;var ctabs=cls.map(function(cl,i){return '<button class="tab-btn'+(ci===i?' active':'')+'" onclick="clNxCl[clNxSec]='+i+';clNxRenderContent()">'+bxe(cl.name)+'</button>';}).join('');var today2=TODAY_BS;var dtabs=clNxWeekDates.map(function(dt,i){var d2=new Date(dt+'T00:00:00');var isToday=dt===today2;return '<button class="tab-btn'+(isToday?' active':'')+'" id="cl-nx-day-'+i+'">'+DAYS_WEEK[d2.getDay()]+' '+d2.getDate()+'</button>';}).join('');var todayDi=clNxWeekDates.indexOf(today2);if(todayDi<0)todayDi=0;var cl=cls[ci];wrap.innerHTML='<div class="tab-row" style="margin-bottom:4px">'+ctabs+'</div><div class="tab-row" style="margin-bottom:20px" id="cl-nx-day-tabs">'+dtabs+'</div><div id="cl-nx-day-content">'+clNxBuildCards(cl,todayDi)+'</div>';clNxWeekDates.forEach(function(dt,i){var btn=document.getElementById('cl-nx-day-'+i);if(btn)btn.onclick=function(){clNxSelectDay(i);};});var content=document.getElementById('cl-nx-day-content');if(content){content.addEventListener('click',function(e){var btn=e.target.closest('[data-clnx-id][data-clnx-val]');if(btn){var d=btn.dataset;clNxSetItem(d.clnxId,parseInt(d.clnxDi),d.clnxItem,d.clnxField,d.clnxVal);clNxUpdateCard(d.clnxId,parseInt(d.clnxDi),d.clnxItem,d.clnxVal);}});content.addEventListener('input',function(e){if(e.target.dataset.clnxTemp){var d=e.target.dataset;clNxSetItem(d.clnxId,parseInt(d.clnxDi),d.clnxItem,'temp',e.target.value);}if(e.target.dataset.clnxComment){var d=e.target.dataset;clNxSetItem(d.clnxId,parseInt(d.clnxDi),d.clnxItem,'comment',e.target.value);}});}}
function clNxSetItem(clId,di,itemId,field,val){clNxEnsureST();var wk=clNxWk();try{clNxState[wk][clId][di][itemId][field]=val;}catch(e){}clNxSave();}
function clNxSelectDay(di){document.querySelectorAll('#cl-nx-day-tabs .tab-btn').forEach(function(b,i){b.classList.toggle('active',i===di);});var sec=clNxSec,ci=clNxCl[sec]||0,cl=CL_DATA_NX[sec][ci];var content=document.getElementById('cl-nx-day-content');if(content)content.innerHTML=clNxBuildCards(cl,di);}
function clNxBuildCards(cl,di){var wk=clNxWk();clNxEnsureST();var state=(clNxState[wk]&&clNxState[wk][cl.id]&&clNxState[wk][cl.id][di])||{};var h='<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(340px,1fr));gap:16px">';(cl.groups||[]).forEach(function(grp){var total=grp.items.length;var done=grp.items.filter(function(item){var st=state[item.id]||{};return st.yn==='Y';}).length;var pct=total?Math.round(done/total*100):0;h+='<div class="bcard"><div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px"><div style="font-size:13px;font-weight:700">'+bxe(grp.name)+'</div><span class="badge '+(pct===100?'badge-green':pct>0?'badge-amber':'')+'">'+done+'/'+total+'</span></div><div style="height:3px;background:var(--surface-3);border-radius:2px;margin-bottom:14px"><div style="height:100%;width:'+pct+'%;background:'+(pct===100?'var(--success)':pct>50?'var(--warning)':'var(--text-tertiary)')+';border-radius:2px;transition:width .4s"></div></div>';(grp.items||[]).forEach(function(item){var st=state[item.id]||{};h+='<div style="padding:9px 0;border-bottom:1px solid var(--border);display:flex;align-items:flex-start;gap:10px"><div style="flex:1"><div style="font-size:12px;font-weight:500;color:var(--text-primary);margin-bottom:6px">'+(item.yellow?'<span style="color:var(--ceo);margin-right:4px">\u2b50</span>':'')+bxe(item.label)+'</div><div style="display:flex;gap:6px">';['Y','N'].forEach(function(v){var active=st.yn===v;var col=v==='Y'?'#b45309':'#c0392b';h+='<button data-clnx-id="'+bxe(cl.id)+'" data-clnx-di="'+di+'" data-clnx-item="'+bxe(item.id)+'" data-clnx-field="yn" data-clnx-val="'+v+'" style="padding:4px 14px;border-radius:6px;border:1px solid '+(active?col:'var(--border)')+';background:'+(active?col+'18':'transparent')+';color:'+(active?col:'var(--text-tertiary)')+';font-size:11px;font-weight:600;cursor:pointer;transition:all .15s">'+v+'</button>';});if(item.hasTemp){h+='<input class="bfi" data-clnx-id="'+bxe(cl.id)+'" data-clnx-di="'+di+'" data-clnx-item="'+bxe(item.id)+'" data-clnx-temp="1" value="'+bxe(st.temp||'')+'" placeholder="\u00b0C" style="width:60px;text-align:center;padding:4px 8px">';}h+='</div>';if(st.yn==='N'||st.comment){h+='<input class="bfi" data-clnx-id="'+bxe(cl.id)+'" data-clnx-di="'+di+'" data-clnx-item="'+bxe(item.id)+'" data-clnx-comment="1" value="'+bxe(st.comment||'')+'" placeholder="Add comment\u2026" style="margin-top:6px;font-size:11px">';}h+='</div></div>';});h+='<div style="margin-top:12px;text-align:right"><button class="btn btn-sm btn-primary" onclick="clNxSaveNow()">Save</button></div></div>';});return h+'</div>';}
function clNxUpdateCard(clId,di,itemId,val){document.querySelectorAll('[data-clnx-id="'+clId+'"][data-clnx-di="'+di+'"][data-clnx-item="'+itemId+'"][data-clnx-field="yn"]').forEach(function(btn){var isActive=btn.dataset.clnxVal===val;var col=btn.dataset.clnxVal==='Y'?'#b45309':'#c0392b';btn.style.borderColor=isActive?col:'var(--border)';btn.style.background=isActive?col+'18':'transparent';btn.style.color=isActive?col:'var(--text-tertiary)';});}
function clNxOpenPrint(){var sec=clNxSec,ci=clNxCl[sec]||0,cl=CL_DATA_NX[sec][ci];var s=NX.session||{};var wk=clNxWk();clNxEnsureST();var html='<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Checklist \u2014 '+bxe(cl.name)+'</title><style>@page{size:A4 landscape;margin:8mm}*{box-sizing:border-box;margin:0;padding:0;font-family:Arial,Helvetica,sans-serif}body{background:#fff;color:#111;font-size:11px}table{width:100%;border-collapse:collapse}th{background:#1a2340;color:#fff;padding:6px 8px;font-size:9px;text-transform:uppercase;letter-spacing:1px}td{padding:6px 8px;border:1px solid #e2e8f0;font-size:10px}.hdr{display:flex;justify-content:space-between;margin-bottom:12px;padding-bottom:8px;border-bottom:3px solid #1a2340}@media print{.np{display:none}}</style></head><body>';html+='<div class="hdr"><div><img src="https://i.imgur.com/jeqtcE2.png" alt="ALFA.CO" style="height:44px;width:auto;display:block"><div style="font-size:10px;color:#888">'+bxe(s.branchName||s.entityName||'')+'</div></div><div style="text-align:center"><h1 style="font-size:14px;font-weight:800;color:#1a2340">'+bxe(cl.name)+'</h1><div style="font-size:10px;color:#64748b">Week of '+bxe(wk)+'</div></div><div style="text-align:right;font-size:10px;color:#888">Printed: '+new Date().toLocaleDateString('en-GB')+'</div></div>';html+='<table><thead><tr><th>Item</th>';clNxWeekDates.forEach(function(dt){html+='<th style="text-align:center;min-width:60px">'+DAYS_WEEK[new Date(dt+'T00:00:00').getDay()]+'<br>'+new Date(dt+'T00:00:00').getDate()+'</th>';});html+='</tr></thead><tbody>';(cl.groups||[]).forEach(function(grp){html+='<tr><td colspan="'+(clNxWeekDates.length+1)+'" style="background:#f1f5f9;font-weight:700;font-size:9px;text-transform:uppercase;letter-spacing:1px;color:#64748b">'+bxe(grp.name)+'</td></tr>';(grp.items||[]).forEach(function(item){html+='<tr><td>'+(item.yellow?'\u2b50 ':'')+bxe(item.label)+'</td>';clNxWeekDates.forEach(function(dt,i){var st=((clNxState[wk]&&clNxState[wk][cl.id]&&clNxState[wk][cl.id][i]&&clNxState[wk][cl.id][i][item.id])||{});var yn=st.yn||'';html+='<td style="text-align:center;color:'+(yn==='Y'?'#00875a':yn==='N'?'#c0392b':'#94a3b8')+';font-weight:700">'+(yn||'\u2014')+'</td>';});html+='</tr>';});});html+='</tbody></table><div class="np" style="text-align:center;margin-top:20px"><button onclick="window.print()" style="background:#1a2340;color:#fff;border:none;border-radius:8px;padding:10px 28px;font-size:13px;font-weight:700;cursor:pointer">Print / Save PDF</button></div></body></html>';var w=window.open('','_blank','width=1100,height=700');if(w){w.document.write(html);w.document.close();}else showToast('Allow pop-ups to print','error');}

// ── QR Check-In ───────────────────────────────────────
function pQRCheckin() {
  attachBranchListeners();bsyncTSFromStaff();
  var sorted=BS.tsEmps.slice().sort(function(a,b){return a.name.localeCompare(b.name);});
  var s=NX.session||{};
  var now=new Date(),todayStr=TODAY_BS;
  var hi=String(now.getHours()).padStart(2,'0'),mi=String(now.getMinutes()).padStart(2,'0'),currentTime=hi+':'+mi;
  var h='<div class="page-header"><h1>QR Check-In</h1><p>'+bxe(s.branchName||s.entityName||'Branch')+' \u00b7 Staff attendance</p></div>';
  h+='<div class="bgrid-2" style="margin-bottom:20px">';
  h+='<div class="bcard"><div style="font-size:13px;font-weight:700;color:var(--ceo);margin-bottom:14px">Quick Check-In</div>';
  h+='<div class="bfg"><label class="form-label">Staff Member</label><select class="form-input form-select" id="qr-emp"><option value="">Select staff member</option>';
  var ld2='';
  sorted.forEach(function(e){if(e.dept!==ld2){if(ld2)h+='</optgroup>';h+='<optgroup label="'+bxe(e.dept||'Other')+'">';ld2=e.dept;}var key2=todayStr.slice(0,7),recs2=(BS.tsAtt[e.id]&&BS.tsAtt[e.id][key2])||[];var todayRec=recs2.find(function(r){return r.date===todayStr;});var status=todayRec?(' \u2014 '+TS_ST_BRANCH[todayRec.st].l):'';h+='<option value="'+bxe(e.id)+'">'+bxe(e.name)+bxe(status)+'</option>';});
  if(ld2)h+='</optgroup>';
  h+='</select></div>';
  h+='<div class="form-row"><div class="bfg"><label class="form-label">Time</label><input class="form-input" type="time" id="qr-time" value="'+currentTime+'"></div><div class="bfg"><label class="form-label">Type</label><select class="form-input form-select" id="qr-type"><option value="ci">Check In</option><option value="co">Check Out</option></select></div></div>';
  h+='<button class="btn btn-primary" style="width:100%;margin-top:4px" onclick="doQRCheckin()">Record Attendance</button></div>';
  h+='<div class="bcard"><div style="font-size:13px;font-weight:700;margin-bottom:14px">Today\'s Status</div>';
  var pCount=0,aCount=0;
  var statusRows=sorted.slice(0,8).map(function(e){var key2=todayStr.slice(0,7),recs2=(BS.tsAtt[e.id]&&BS.tsAtt[e.id][key2])||[];var r=recs2.find(function(x){return x.date===todayStr;});if(r&&(r.st==='present'||r.st==='late'))pCount++;else if(r&&r.st==='absent')aCount++;var ci=r?r.ci:'\u2014',co=r?r.co:'\u2014';var stCol=r&&TS_ST_BRANCH[r.st]?TS_ST_BRANCH[r.st].c:'var(--text-tertiary)';return '<div style="display:flex;align-items:center;gap:8px;padding:7px 0;border-bottom:1px solid var(--border)"><div class="bav" style="width:28px;height:28px;font-size:10px">'+bini(e.name)+'</div><div style="flex:1;font-size:12px;font-weight:500">'+bxe(e.name)+'</div><span class="bmono" style="font-size:10px;color:var(--text-secondary)">'+bxe(ci)+(co!=='\u2014'?' \u2192 '+co:'')+'</span>'+(r?'<span style="color:'+stCol+';font-size:10px;font-weight:600">'+TS_ST_BRANCH[r.st].l+'</span>':'<span style="color:var(--text-tertiary);font-size:10px">\u2014</span>')+'</div>';}).join('');
  h+=statusRows;
  if(sorted.length>8)h+='<div style="font-size:11px;color:var(--text-tertiary);text-align:center;padding:8px">+'+(sorted.length-8)+' more staff</div>';
  h+='<div style="margin-top:12px;display:flex;gap:10px;padding-top:10px;border-top:1px solid var(--border)"><div style="flex:1;text-align:center"><div class="bmono" style="font-size:22px;color:#b45309;font-weight:300">'+pCount+'</div><div style="font-size:9px;color:var(--text-tertiary);text-transform:uppercase;letter-spacing:1px">Present</div></div><div style="flex:1;text-align:center"><div class="bmono" style="font-size:22px;color:#c0392b;font-weight:300">'+aCount+'</div><div style="font-size:9px;color:var(--text-tertiary);text-transform:uppercase;letter-spacing:1px">Absent</div></div><div style="flex:1;text-align:center"><div class="bmono" style="font-size:22px;color:var(--text-secondary);font-weight:300">'+(sorted.length-pCount-aCount)+'</div><div style="font-size:9px;color:var(--text-tertiary);text-transform:uppercase;letter-spacing:1px">Not Recorded</div></div></div></div></div>';
  return h;
}
function doQRCheckin(){var eid=bgv('qr-emp'),time=bgv('qr-time'),type=bgv('qr-type');if(!eid){showToast('Select a staff member','error');return;}var key=TODAY_BS.slice(0,7);if(!BS.tsAtt[eid])BS.tsAtt[eid]={};if(!BS.tsAtt[eid][key])BS.tsAtt[eid][key]=[];var recs=BS.tsAtt[eid][key];var ex=recs.find(function(r){return r.date===TODAY_BS;});if(type==='ci'){if(ex){ex.ci=time;if(!ex.st)ex.st='present';}else recs.push({date:TODAY_BS,ci:time,co:'',brk:'',note:'',st:'present'});showToast('Check-in recorded: '+time,'success');}else{if(ex)ex.co=time;else recs.push({date:TODAY_BS,ci:'',co:time,brk:'',note:'',st:'present'});showToast('Check-out recorded: '+time,'success');}bSaveTsAtt();navTo('qr-checkin');}

// ══════════════════════════════════════════════════════

// ── Missing branch helper stubs ──
function clNxGetItem(clId,di,itemId){ clNxEnsureST(); try{return clNxState[clNxWk()][clId][di][itemId]||{};}catch(e){return {};} }
function clNxLogin(role){ clNxRole=role; navTo('checklists'); }

// ── pTimesheet now delegates to btsPg* which exist ──
// ── pStaff role filter is handled inline ──
// ── pSales uses openBranchSalesModal which is defined below pSales ──

// CHART INITIALIZATION
// ══════════════════════════════════════════════════════

function initPageCharts(pageId) {
  var chartFns = {
    'exec-dash': function() { initRevChart('all'); },
    'brand-perf': function() { initBrandPieChart(); initFCBarChart(); },
    'rev-analytics': function() { initRevTrendChart(); initRevPieChart(); initRevBarChart(); },
    'headcount': function() { initHcBrandChart(); initHcDeptChart(); },
    'food-cost': function() { initFCTrendChart(); drawFCGauge(); },
    'brand-dash': function() { initBranchRevChart(); initBrandTrendChart(); },
    'region-dash': function() { initRegionCompChart(); },
    'branch-dash': function() { initBranchSalesChart(); },
    'hrf-hr-dash':  function() { hrfInitDeptChart(); hrfInitAttTrendChart(); },
    'hrf-fin-dash': function() { hrfInitRevCostChart(); hrfInitCostPieChart(); },
    'hrf-revenue':  function() { hrfInitRevMonthlyChart(); },
    'hrf-pnl':      function() { hrfInitPnLChart(); },
    'hrf-food-cost':function() { hrfInitFoodCostChart(); }
  };
  var fn = chartFns[pageId];
  if (fn) { try { fn(); } catch(e) { console.warn('Chart init error:', e); } }
}

function getLabels30() {
  var labels = [];
  for (var i = 29; i >= 0; i--) {
    var d = new Date(); d.setDate(d.getDate() - i);
    labels.push((d.getMonth()+1) + '/' + d.getDate());
  }
  return labels;
}

function getSalesData30(entityId) {
  // entityId is a branchId - return last 30 days of sales from NX_BRANCH_SALES
  var entries = NX_BRANCH_SALES[entityId] || [];
  var result = [];
  for (var i = 29; i >= 0; i--) {
    var d = new Date(); d.setDate(d.getDate() - i);
    var ds = d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
    var found = entries.find(function(e){ return e.date === ds; });
    result.push(found ? (parseFloat(found.actual)||0) : 0);
  }
  return result;
}

function initRevChart(filter) {
  destroyChart('revenue30');
  var ctx = document.getElementById('chart-revenue30');
  if (!ctx) return;
  var labels = getLabels30();
  var datasets = [];
  var branches = getAccessibleBranches();

  // Group by brand or show all branches
  if (filter === 'all') {
    // Aggregate all accessible branches by day
    var totals = Array(30).fill(0);
    branches.forEach(function(b) {
      var d = getSalesData30(b.id);
      d.forEach(function(v,i){ totals[i] += v; });
    });
    datasets.push({ label:'All Branches', data:totals, borderColor:'var(--ceo)', backgroundColor:'rgba(240,165,0,.08)', tension:.4, pointRadius:0, borderWidth:2, fill:true });
  } else {
    // Show only branches matching filter (brand name)
    branches.filter(function(b){ return (b.brand||b.name)===filter; }).forEach(function(b) {
      datasets.push({ label:b.name, data:getSalesData30(b.id), borderColor:b.color||'#f0a500', backgroundColor:(b.color||'#f0a500')+'15', tension:.4, pointRadius:0, borderWidth:2, fill:false });
    });
  }

  if (!datasets.length) {
    datasets.push({ label:'No data', data:Array(30).fill(0), borderColor:'#94a3b8', tension:.4, pointRadius:0, borderWidth:1 });
  }

  var opts = chartDefaults();
  opts.plugins.legend.display = datasets.length > 1;
  opts.scales.y.ticks.callback = function(v){ return v>=1000?'SAR '+(v/1000).toFixed(0)+'K':'SAR '+v; };
  NX.charts.revenue30 = new Chart(ctx, { type:'line', data:{ labels:labels, datasets:datasets }, options:opts });
}

function initBrandPieChart() {
  destroyChart('revPie');
  var ctx = document.getElementById('chart-brand-pie');
  if (!ctx) return;
  var branches = getAccessibleBranches();

  // Group by brand
  var brandMap = {};
  branches.forEach(function(b) {
    var bname = b.brand || b.name;
    if (!brandMap[bname]) brandMap[bname] = { name:bname, color:b.color||'#f0a500', total:0 };
    brandMap[bname].total += branchSalesToday(b.id);
  });
  var items = Object.values(brandMap);

  var opts = chartDefaults();
  delete opts.scales;
  opts.plugins.legend.position = 'bottom';
  NX.charts.revPie = new Chart(ctx, {
    type:'doughnut',
    data:{
      labels: items.map(function(b){ return b.name; }),
      datasets:[{ data: items.map(function(b){ return b.total; }),
        backgroundColor: items.map(function(b){ return b.color+'80'; }),
        borderColor: items.map(function(b){ return b.color; }),
        borderWidth:2 }]
    }, options:opts
  });
}

function initFCBarChart() {
  destroyChart('fcBar');
  var ctx = document.getElementById('chart-fc-bar');
  if (!ctx) return;
  var branches = getAccessibleBranches();
  // Wastage data only available per-branch via BS.waste (branch-manager context)
  // For CEO view show branch names with 0 (data loads when branch is selected)
  var labels = branches.map(function(b){ return b.name.replace(/^.+\s/,''); });
  var values = branches.map(function(b){ return 0; }); // real data at branch level
  var colors = branches.map(function(b){ return b.color||'#f0a500'; });

  var opts = chartDefaults();
  opts.plugins.legend.display = false;
  opts.scales.y.ticks.callback = function(v){ return v+'%'; };
  NX.charts.fcBar = new Chart(ctx, {
    type:'bar',
    data:{ labels:labels, datasets:[{ data:values, backgroundColor:colors.map(function(c){return c+'60';}), borderColor:colors, borderWidth:2, borderRadius:4 }] },
    options:opts
  });
}

function initRevTrendChart() {
  destroyChart('revTrend');
  var ctx = document.getElementById('chart-rev-trend');
  if (!ctx) return;
  if (!NX.rev) NX.rev = { period:'month', group:'brand', yoy:false };

  var range = revDateRange();
  var entities = revGetEntities();
  var labels = revGetLabels(range.start, range.end, range.days);
  var datasets = [];

  // Previous year same period labels (for YoY)
  var prevLabels = NX.rev.yoy ? revGetLabels(range.prevStart, range.prevEnd, range.days) : [];

  entities.forEach(function(ent) {
    var series = revGetDailySeries(ent, range.start, range.end);
    datasets.push({
      label: ent.name,
      data: series.map(function(d){ return d.amount; }),
      borderColor: ent.color,
      backgroundColor: ent.color + '12',
      tension: 0.35,
      pointRadius: range.days <= 14 ? 4 : 0,
      pointHoverRadius: 6,
      pointBackgroundColor: ent.color,
      borderWidth: 2,
      fill: entities.length === 1  // only fill when single entity
    });

    if (NX.rev.yoy) {
      var prevSeries = revGetDailySeries(ent, range.prevStart, range.prevEnd);
      datasets.push({
        label: ent.name + ' (prev year)',
        data: prevSeries.map(function(d){ return d.amount; }),
        borderColor: ent.color,
        backgroundColor: 'transparent',
        tension: 0.35,
        pointRadius: 0,
        borderWidth: 1.5,
        borderDash: [4, 4],
        fill: false
      });
    }
  });

  var opts = chartDefaults();
  opts.plugins.legend.display = entities.length > 1;
  opts.plugins.legend.position = 'top';
  opts.plugins.tooltip.mode = 'index';
  opts.plugins.tooltip.intersect = false;
  opts.plugins.tooltip.callbacks = {
    label: function(ctx2) {
      return ' ' + ctx2.dataset.label + ': ' + formatSAR(ctx2.parsed.y);
    },
    title: function(items) {
      return labels[items[0].dataIndex] || '';
    }
  };
  opts.scales.x.ticks.maxRotation = 0;
  opts.scales.x.ticks.autoSkip = true;
  opts.scales.x.ticks.maxTicksLimit = range.days <= 14 ? range.days : (range.days <= 60 ? 10 : 8);
  opts.scales.y.ticks.callback = function(val) {
    if (val >= 1000000) return 'SAR ' + (val/1000000).toFixed(1) + 'M';
    if (val >= 1000) return 'SAR ' + (val/1000).toFixed(0) + 'K';
    return 'SAR ' + val;
  };
  opts.interaction = { mode: 'index', intersect: false };

  NX.charts.revTrend = new Chart(ctx, { type:'line', data:{ labels:labels, datasets:datasets }, options:opts });

  // Build custom legend
  var legEl = document.getElementById('rev-legend');
  if (legEl && entities.length > 1) {
    legEl.innerHTML = entities.map(function(ent) {
      return '<div style="display:flex;align-items:center;gap:5px;font-size:11px;color:var(--text-secondary)">' +
        '<div style="width:16px;height:2px;background:' + ent.color + ';border-radius:1px"></div>' +
        xe(ent.name) + '</div>';
    }).join('');
  }
}

function initRevPieChart() {
  destroyChart('revPie');
  var ctx = document.getElementById('chart-rev-pie');
  if (!ctx) return;
  if (!NX.rev) NX.rev = {};

  var range = revDateRange();
  var entities = revGetEntities();
  var vals = entities.map(function(ent) { return revGetEntityRevenue(ent, range.start, range.end); });
  var total = vals.reduce(function(s,v){ return s+v; }, 0);

  var opts = chartDefaults();
  delete opts.scales;
  opts.plugins.legend.display = false;
  opts.plugins.tooltip.callbacks = {
    label: function(ctx2) {
      var pct = total > 0 ? (ctx2.parsed / total * 100).toFixed(1) : '0.0';
      return ' ' + ctx2.label + ': ' + formatSAR(ctx2.parsed) + ' (' + pct + '%)';
    }
  };
  opts.cutout = (NX.rev._pieType || 'doughnut') === 'doughnut' ? '60%' : '0%';

  var type = (NX.rev._pieType || 'doughnut');
  NX.charts.revPie = new Chart(ctx, {
    type: type === 'pie' ? 'pie' : 'doughnut',
    data: {
      labels: entities.map(function(e){ return e.name; }),
      datasets: [{
        data: vals,
        backgroundColor: entities.map(function(e){ return e.color + '80'; }),
        borderColor: entities.map(function(e){ return e.color; }),
        borderWidth: 2,
        hoverOffset: 8
      }]
    },
    options: opts
  });

  // Build custom legend below chart
  var legEl = document.getElementById('rev-pie-legend');
  if (legEl) {
    legEl.innerHTML = entities.map(function(ent, i) {
      var v = vals[i];
      var pct = total > 0 ? (v / total * 100).toFixed(1) : '0.0';
      return '<div style="display:flex;align-items:center;gap:8px;font-size:11px">' +
        '<div style="width:10px;height:10px;border-radius:2px;background:' + ent.color + ';flex-shrink:0"></div>' +
        '<span style="flex:1;color:var(--text-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + xe(ent.name) + '</span>' +
        '<span class="bmono" style="color:var(--text-tertiary)">' + pct + '%</span>' +
      '</div>';
    }).join('');
  }
}

function initRevBarChart() {
  destroyChart('revBar');
  var ctx = document.getElementById('chart-rev-bar');
  if (!ctx) return;
  if (!NX.rev) NX.rev = {};

  var range = revDateRange();
  var entities = revGetEntities();
  var sortBy = NX.rev._barSort || 'revenue';

  // Build data
  var barData = entities.map(function(ent) {
    var v  = revGetEntityRevenue(ent, range.start, range.end);
    var pv = revGetEntityRevenue(ent, range.prevStart, range.prevEnd);
    var chg = pv > 0 ? ((v - pv) / pv * 100) : 0;
    return { ent: ent, v: v, pv: pv, chg: chg };
  });

  // Sort
  barData.sort(function(a, b) {
    return sortBy === 'growth' ? b.chg - a.chg : b.v - a.v;
  });

  var labels  = barData.map(function(d) { return d.ent.name.replace(/^\S+\s/, ''); });
  var values  = barData.map(function(d) { return sortBy === 'growth' ? d.chg : d.v; });
  var colors  = barData.map(function(d) { return d.ent.color; });
  var bgs     = barData.map(function(d) { return d.ent.color + '60'; });

  var opts = chartDefaults();
  opts.plugins.legend.display = false;
  opts.plugins.tooltip.callbacks = {
    label: function(ctx2) {
      if (sortBy === 'growth') return ' ' + ctx2.label + ': ' + (ctx2.parsed.y >= 0 ? '+' : '') + ctx2.parsed.y.toFixed(1) + '%';
      return ' ' + formatSAR(ctx2.parsed.y);
    }
  };
  opts.scales.x.ticks.maxRotation = labels.length > 4 ? 30 : 0;
  opts.scales.y.ticks.callback = function(val) {
    if (sortBy === 'growth') return (val >= 0 ? '+' : '') + val.toFixed(0) + '%';
    if (val >= 1000000) return (val/1000000).toFixed(1) + 'M';
    if (val >= 1000) return (val/1000).toFixed(0) + 'K';
    return val;
  };

  // Add a target line for growth mode
  var plugins = [];
  if (sortBy === 'growth') {
    plugins.push({
      id: 'zeroLine',
      afterDatasetsDraw: function(chart) {
        var yScale = chart.scales.y;
        var xScale = chart.scales.x;
        if (!yScale || !xScale) return;
        var y0 = yScale.getPixelForValue(0);
        var ctx3 = chart.ctx;
        ctx3.save();
        ctx3.strokeStyle = 'rgba(255,255,255,.2)';
        ctx3.lineWidth = 1;
        ctx3.setLineDash([4, 4]);
        ctx3.beginPath();
        ctx3.moveTo(xScale.left, y0);
        ctx3.lineTo(xScale.right, y0);
        ctx3.stroke();
        ctx3.restore();
      }
    });
  }

  NX.charts.revBar = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: labels,
      datasets: [{
        data: values,
        backgroundColor: sortBy === 'growth'
          ? barData.map(function(d){ return d.chg >= 0 ? 'rgba(52,211,153,.6)' : 'rgba(248,113,113,.6)'; })
          : bgs,
        borderColor: sortBy === 'growth'
          ? barData.map(function(d){ return d.chg >= 0 ? '#00875a' : '#c0392b'; })
          : colors,
        borderWidth: 2,
        borderRadius: 6,
        borderSkipped: false
      }]
    },
    options: opts,
    plugins: plugins
  });
}


function initHcBrandChart() {
  destroyChart('hcBrand');
  var ctx = document.getElementById('chart-hc-brand');
  if (!ctx) return;
  var branches = getAccessibleBranches();
  var brandMap = {};
  branches.forEach(function(b) {
    var bname = b.brand || b.name;
    if (!brandMap[bname]) brandMap[bname] = { name:bname, color:b.color||'#f0a500', count:parseInt(b.staffCount)||0 };
    else brandMap[bname].count += parseInt(b.staffCount)||0;
  });
  var items = Object.values(brandMap);

  var opts = chartDefaults();
  delete opts.scales;
  opts.plugins.legend.position = 'bottom';
  NX.charts.hcBrand = new Chart(ctx, {
    type:'doughnut',
    data:{ labels:items.map(function(b){return b.name;}), datasets:[{ data:items.map(function(b){return b.count||1;}), backgroundColor:items.map(function(b){return b.color+'80';}), borderColor:items.map(function(b){return b.color;}), borderWidth:2 }] },
    options:opts
  });
}

function initHcDeptChart() {
  destroyChart('hcDept');
  var ctx = document.getElementById('chart-hc-dept');
  if (!ctx) return;
  // Use BS.staff if available (branch manager), otherwise show empty
  var mgr = BS.staff.filter(function(m){return normalizeDept(m.dept||'')==='Management';}).length;
  var kit = BS.staff.filter(function(m){return m.dept==='Kitchen';}).length;
  var foh = BS.staff.filter(function(m){return m.dept==='FOH';}).length;
  var total = BS.staff.length;

  var opts = chartDefaults();
  delete opts.scales;
  NX.charts.hcDept = new Chart(ctx, {
    type:'doughnut',
    data:{ labels:['Management','Kitchen','FOH'], datasets:[{ data:[mgr||1,kit||1,foh||1], backgroundColor:['#92400e80','#3b9eff80','#05966980'], borderColor:['#b45309','#0057ff','#00875a'], borderWidth:2 }] },
    options:opts
  });
}

function initFCTrendChart() {
  destroyChart('fcTrend');
  var ctx = document.getElementById('chart-fc-trend');
  if (!ctx) return;
  var labels = getLabels30();
  var data = Array(30).fill(0);
  for (var i = 29; i >= 0; i--) {
    var d = new Date(); d.setDate(d.getDate()-i);
    var ds = d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
    var dayWaste = BS.waste.filter(function(w){return w.date===ds;}).reduce(function(s,w){return s+(+w.value||0);},0);
    var dayIssue = bLogs.filter(function(l){return l.type==='issue'&&l.date===ds;}).reduce(function(s,l){
      if(l.cost)return s+l.cost;
      var it=bfindItem(l.code); return s+(l.qty*(it?parseFloat(it.price||0):0));
    },0);
    data[29-i] = dayWaste+dayIssue;
  }
  var opts = chartDefaults();
  opts.plugins.legend.display = false;
  opts.scales.y.ticks.callback = function(v){ return 'SAR '+(v>=1000?(v/1000).toFixed(1)+'K':v); };
  NX.charts.fcTrend = new Chart(ctx, { type:'bar', data:{ labels:labels, datasets:[{ data:data, backgroundColor:'rgba(248,113,113,.4)', borderColor:'#c0392b', borderWidth:1, borderRadius:3 }] }, options:opts });
}

function drawFCGauge() {
  var canvas = document.getElementById('fc-gauge');
  if (!canvas) return;
  var ctx2 = canvas.getContext('2d');
  if (!ctx2) return;
  var s = NX.session||{};
  var mtd = branchSalesMTD(s.branchId||'');
  var fcTarget = parseFloat((BS._branchConfig||{}).fcTarget)||30;
  var tm = new Date(), mkey = tm.getFullYear()+'-'+String(tm.getMonth()+1).padStart(2,'0');
  // Issues cost
  var issueCost = bLogs.reduce(function(sum,l){
    if(l.type!=='issue'||!(l.date||'').startsWith(mkey))return sum;
    if(l.cost)return sum+l.cost;
    var it=bfindItem(l.code); return sum+(l.qty*(it?parseFloat(it.price||0):0));
  },0);
  var wastage = BS.waste.reduce(function(sum,w){
    return (w.date||'').startsWith(mkey)?sum+(+w.value||0):sum;
  },0);
  var totalFC = issueCost+wastage;
  var fc = mtd > 0 ? (totalFC/mtd*100) : 0;
  var pct = Math.min(fc / Math.max(fcTarget*2,50), 1);
  var W = canvas.width, H = canvas.height;
  ctx2.clearRect(0,0,W,H);
  var cx = W/2, cy = H*0.7, r = Math.min(cx,cy)*0.85;
  var startAngle = Math.PI, endAngle = 2*Math.PI;
  var valueAngle = startAngle + pct*(endAngle-startAngle);
  ctx2.beginPath(); ctx2.arc(cx,cy,r,startAngle,endAngle);
  ctx2.strokeStyle='rgba(255,255,255,.08)'; ctx2.lineWidth=18; ctx2.lineCap='round'; ctx2.stroke();
  var grad = ctx2.createLinearGradient(0,0,W,0);
  grad.addColorStop(0,'#00875a'); grad.addColorStop(0.5,'#b45309'); grad.addColorStop(1,'#c0392b');
  ctx2.beginPath(); ctx2.arc(cx,cy,r,startAngle,valueAngle);
  ctx2.strokeStyle=grad; ctx2.lineWidth=18; ctx2.lineCap='round'; ctx2.stroke();
  ctx2.textAlign='center'; ctx2.fillStyle='rgba(255,255,255,.9)';
  ctx2.font='700 28px DM Sans'; ctx2.fillText(fc.toFixed(1)+'%', cx, cy-10);
  ctx2.font='12px DM Sans'; ctx2.fillStyle='rgba(255,255,255,.4)';
  ctx2.fillText(mtd>0?'of MTD sales':'No sales data', cx, cy+16);
}

function initBranchRevChart() {
  destroyChart('branchRev');
  var ctx = document.getElementById('chart-branch-sales');
  if (!ctx) return;
  var labels = getLabels30();
  var s = NX.session || {};
  var data = s.branchId ? getSalesData30(s.branchId) : Array(30).fill(0);
  var opts = chartDefaults();
  opts.plugins.legend.display = false;
  opts.scales.y.ticks.callback = function(v){ return v>=1000?'SAR '+(v/1000).toFixed(0)+'K':'SAR '+v; };
  NX.charts.branchRev = new Chart(ctx, { type:'line', data:{ labels:labels, datasets:[{ data:data, borderColor:'var(--ceo)', backgroundColor:'rgba(240,165,0,.08)', tension:.4, pointRadius:0, borderWidth:2, fill:true }] }, options:opts });
}

function initBrandTrendChart() {
  destroyChart('brandTrend');
  var ctx = document.getElementById('chart-brand-trend');
  if (!ctx) return;
  var labels = getLabels30();
  var s = NX.session || {};
  var branches = getAccessibleBranches().filter(function(b){ return !s.brandName||(b.brand||b.name)===s.brandName; });
  var totals = Array(30).fill(0);
  branches.forEach(function(b){
    var d=getSalesData30(b.id); d.forEach(function(v,i){totals[i]+=v;});
  });
  var opts = chartDefaults();
  opts.plugins.legend.display = false;
  opts.scales.y.ticks.callback = function(v){ return v>=1000?'SAR '+(v/1000).toFixed(0)+'K':'SAR '+v; };
  NX.charts.brandTrend = new Chart(ctx, { type:'line', data:{ labels:labels, datasets:[{ data:totals, borderColor:'var(--brand-dir)', backgroundColor:'rgba(124,111,247,.08)', tension:.4, pointRadius:0, borderWidth:2, fill:true }] }, options:opts });
}

function initRegionCompChart() {
  destroyChart('regionComp');
  var ctx = document.getElementById('chart-region-comp');
  if (!ctx) return;
  var s = NX.session || {};
  var branches = getAccessibleBranches().filter(function(b){ return !s.brandName||(b.brand||b.name)===s.brandName; });
  var labels = branches.map(function(b){return b.name.replace(/^.+\s/,'');});
  var values = branches.map(function(b){return branchSalesToday(b.id);});
  var colors = branches.map(function(b){return b.color||'#f0a500';});
  var opts = chartDefaults();
  opts.plugins.legend.display = false;
  opts.scales.y.ticks.callback = function(v){ return v>=1000?'SAR '+(v/1000).toFixed(0)+'K':'SAR '+v; };
  NX.charts.regionComp = new Chart(ctx, { type:'bar', data:{ labels:labels, datasets:[{ data:values, backgroundColor:colors.map(function(c){return c+'60';}), borderColor:colors, borderWidth:2, borderRadius:4 }] }, options:opts });
}

function initBranchSalesChart() {
  destroyChart('branchSales');
  var ctx = document.getElementById('chart-branch-sales');
  if (!ctx) return;
  var s = NX.session || {};
  // Use real sales from NX_BRANCH_SALES (loaded from branches/{id}/sales)
  var labels = getLabels30();
  var data = s.branchId ? getSalesData30(s.branchId) : Array(30).fill(0);
  var opts = chartDefaults();
  opts.plugins.legend.display = false;
  opts.scales.y.ticks.callback = function(v){ return v>=1000?'SAR '+(v/1000).toFixed(0)+'K':'SAR '+v; };
  opts.plugins.tooltip.callbacks = { label: function(ctx2){ return ' ' + formatSAR(ctx2.parsed.y); } };
  NX.charts.branchSales = new Chart(ctx, {
    type:'line',
    data:{ labels:labels, datasets:[{ data:data, borderColor:'var(--ceo)', backgroundColor:'rgba(240,165,0,.08)', tension:.4, pointRadius:2, pointHoverRadius:5, borderWidth:2, fill:true }] },
    options:opts
  });
}

// ══════════════════════════════════════════════════════
// FIREBASE SEED DATA WRITER
// ══════════════════════════════════════════════════════
function seedFirebase() {
  // seedFirebase writes system config to admin/nexusConfig (covered by Firebase rules).
  if (!db) { console.warn('seedFirebase: db not ready'); return; }
  var seeded = localStorage.getItem('nexus_seeded_v1');
  if (seeded) return;

  // Mark seeded immediately so we never retry even if write fails
  localStorage.setItem('nexus_seeded_v1', '1');

  // Write to admin/nexusConfig — covered by "admin": {".read":true,".write":true} rule
  db.ref('admin/nexusConfig').set({
    name: 'ALFA.CO',
    currency: 'SAR',
    timezone: 'Asia/Riyadh',
    seededAt: Date.now(),
    version: '2.0'
  }).then(function() {
    console.log('NEXUS system config written to Firebase');
  }).catch(function(e) {
    console.warn('seedFirebase error:', e.message);
  });
}

function startLiveListeners() {
  if (!db) {
    // db not ready yet — retry in 600ms
    setTimeout(startLiveListeners, 600);
    return;
  }
  clearLiveListeners();
  NXMon.start();
}


// ══════════════════════════════════════════════════════
// NEXUS REAL-TIME MONITOR ENGINE
// Watches Firebase across all accessible branches for
// low stock, expired health cards, missed checklists
// ══════════════════════════════════════════════════════
var NXMon = (function() {

  // ── Determine which branch paths this session can see ──
  // Uses OpsHub flat paths: branches/{branchId}/...
  var _pathsCache = null;

  function invalidateCache() { _pathsCache = null; }

  function getAccessiblePaths() {
    if (_pathsCache) return _pathsCache;
    var accessible = getAccessibleBranches();
    _pathsCache = accessible.map(function(b) {
      return {
        path: 'branches/' + b.id,
        branchId: b.id,
        branchName: b.name || b.id,
        brandName: b.brand || '',
        brandIcon: b.icon || '🍽️'
      };
    });
    return _pathsCache;
  }

  // ── Deduplication: track which alerts we've already fired ──
  var _seen = {};
  function seenKey(type, id) { return type + '::' + id; }
  function wasSeen(type, id) { return !!_seen[seenKey(type, id)]; }
  function markSeen(type, id) { _seen[seenKey(type, id)] = true; }

  // ── Push a notification into the panel ──
  function push(notif) {
    var key = seenKey(notif.type, notif.dedupId || notif.title);
    if (wasSeen(notif.type, notif.dedupId || notif.title)) return;
    markSeen(notif.type, notif.dedupId || notif.title);

    notif.id    = notif.id || Date.now() + Math.random();
    notif.ts    = notif.ts || Date.now();
    notif.read  = false;

    // Insert at front, keep newest first
    NX.notifications.unshift(notif);
    // Cap at 50
    if (NX.notifications.length > 50) NX.notifications.pop();

    NX.unreadCount++;
    _updateBadge();

    // Toast for critical only (avoid notification storm)
    if (notif.type === 'danger') {
      showToast(notif.icon + ' ' + notif.title, 'error');
    }

    // Refresh panel if open
    var panel = document.getElementById('notif-panel');
    if (panel && panel.classList.contains('open')) renderNotifications();
  }

  // ── LOW STOCK MONITOR ──
  function watchStock(branch) {
    var ref = db.ref('shared/inv_items');
    var stockRef = db.ref(branch.path + '/stock');

    // We watch branch stock quantities against shared catalog mins
    stockRef.on('value', function(stockSnap) {
      var stock = stockSnap.val() || {};
      // Get catalog to compare
      db.ref('shared/inv_items').once('value', function(catSnap) {
        var catalog = catSnap.val() || {};
        Object.keys(catalog).forEach(function(k) {
          var cat = catalog[k];
          var stk = stock[k] || {};
          var qty = parseFloat(stk.qty) || 0;
          var min = parseFloat(cat.min) || 0;
          if (min <= 0) return;

          if (qty === 0) {
            push({
              type: 'danger', icon: '🚫',
              title: 'Out of Stock: ' + cat.name,
              msg: '0 ' + (cat.unit || 'units') + ' remaining — ' + branch.branchName,
              branch: branch.brandIcon + ' ' + branch.branchName,
              page: 'low-stock',
              dedupId: 'stock-out-' + branch.branchId + '-' + k,
              ts: Date.now()
            });
          } else if (qty <= min) {
            push({
              type: 'warning', icon: '📦',
              title: 'Low Stock: ' + cat.name,
              msg: qty + ' ' + (cat.unit || 'units') + ' left (min ' + min + ') — ' + branch.branchName,
              branch: branch.brandIcon + ' ' + branch.branchName,
              page: 'low-stock',
              dedupId: 'stock-low-' + branch.branchId + '-' + k,
              ts: Date.now()
            });
          }
        });
      });
    });
    return stockRef;
  }

  // ── HEALTH CARD MONITOR ──
  function watchHealthCards(branch) {
    var ref = db.ref(branch.path + '/health');
    ref.on('value', function(snap) {
      var raw = snap.val();
      if (!raw) return;
      var cards = Array.isArray(raw) ? raw.filter(Boolean) : Object.values(raw).filter(Boolean);
      var today = new Date();

      cards.forEach(function(card) {
        if (!card.medExp) return;
        var exp = new Date(card.medExp + 'T00:00:00');
        var diffMs  = exp - today;
        var diffDays = Math.ceil(diffMs / 86400000);

        if (diffDays < 0) {
          push({
            type: 'danger', icon: '🆘',
            title: 'Health Card EXPIRED',
            msg: (card.name || 'Unknown') + ' — expired ' + Math.abs(diffDays) + ' day' + (Math.abs(diffDays)===1?'':'s') + ' ago',
            branch: branch.brandIcon + ' ' + branch.branchName,
            page: 'health-cards',
            dedupId: 'hc-expired-' + branch.branchId + '-' + (card.id || card.name),
            ts: Date.now()
          });
        } else if (diffDays <= 7) {
          push({
            type: 'danger', icon: '⚠️',
            title: 'Health Card: ' + diffDays + ' days left',
            msg: (card.name || 'Unknown') + ' — expires ' + card.medExp,
            branch: branch.brandIcon + ' ' + branch.branchName,
            page: 'health-cards',
            dedupId: 'hc-critical-' + branch.branchId + '-' + (card.id || card.name),
            ts: Date.now()
          });
        } else if (diffDays <= 30) {
          push({
            type: 'warning', icon: '💳',
            title: 'Health Card Expiring Soon',
            msg: (card.name || 'Unknown') + ' — ' + diffDays + ' days left',
            branch: branch.brandIcon + ' ' + branch.branchName,
            page: 'health-cards',
            dedupId: 'hc-soon-' + branch.branchId + '-' + (card.id || card.name),
            ts: Date.now()
          });
        }
      });
    });
    return ref;
  }

  // ── CHECKLIST MONITOR ──
  // A checklist is "missed" if today's slot has no Y entries by shift cutoff time
  function watchChecklists(branch) {
    var now = new Date();
    var dow = now.getDay();
    var sun = new Date(now); sun.setDate(now.getDate() - dow);
    var wkKey = sun.getFullYear() + '-' +
                String(sun.getMonth()+1).padStart(2,'0') + '-' +
                String(sun.getDate()).padStart(2,'0');
    var fbKey = wkKey.replace(/[.#$\[\]\/]/g, '_');
    var todayIdx = dow; // Sunday=0 … Saturday=6

    var ref = db.ref(branch.path + '/cl_weeks/' + fbKey);
    ref.on('value', function(snap) {
      var data = snap.val();

      // Only check if it's past the morning cutoff (10:00 AM local)
      var localHour = new Date().getHours();
      if (localHour < 10) return;

      var CL_IDS = {
        mod: ['mod_salad', 'mod_pastry', 'mod_fryer'],
        foh: ['foh_waiter', 'foh_hygiene', 'foh_barista'],
        boh: ['boh_pizza', 'boh_grill', 'boh_dishwash']
      };

      var state = (data && data.state) ? data.state : {};
      var secs = Object.keys(CL_IDS);

      secs.forEach(function(sec) {
        var ids = CL_IDS[sec];
        ids.forEach(function(clId) {
          var dayState = (state[clId] && state[clId][todayIdx]) ? state[clId][todayIdx] : null;
          var hasAnyY = false;

          if (dayState) {
            Object.keys(dayState).forEach(function(itemId) {
              if (dayState[itemId] && dayState[itemId].yn === 'Y') hasAnyY = true;
            });
          }

          // Determine checklist display name
          var secLabel = sec.toUpperCase();
          var clName   = clId.replace(sec + '_', '').replace(/_/g, ' ');
          clName = clName.charAt(0).toUpperCase() + clName.slice(1);

          if (!hasAnyY) {
            // Only alert past the appropriate cutoff
            var isMorning = localHour >= 10 && localHour < 14;
            var isEvening = localHour >= 17;
            if (!isMorning && !isEvening) return;

            push({
              type: 'warning', icon: '📋',
              title: 'Checklist Incomplete: ' + secLabel,
              msg: clName + ' — today\'s entries missing at ' + branch.branchName,
              branch: branch.brandIcon + ' ' + branch.branchName,
              page: 'checklists',
              dedupId: 'cl-miss-' + branch.branchId + '-' + clId + '-' + wkKey + '-' + (isMorning?'am':'pm'),
              ts: Date.now()
            });
          }
        });
      });
    });
    return ref;
  }

  // ── PENDING LARGE INVOICES ──
  function watchInvoices(branch) {
    var ref = db.ref(branch.path + '/invoices');
    ref.on('value', function(snap) {
      var raw = snap.val();
      if (!raw) return;
      var invs = Array.isArray(raw) ? raw.filter(Boolean) : Object.values(raw).filter(Boolean);
      invs.forEach(function(inv) {
        if (inv.status !== 'Pending' && inv.status !== 'Overdue') return;
        var amount = parseFloat(inv.amount) || 0;
        if (amount < 5000) return; // Only flag large invoices

        var isOverdue = inv.status === 'Overdue';
        push({
          type: isOverdue ? 'danger' : 'warning',
          icon: isOverdue ? '🔴' : '💰',
          title: isOverdue ? 'Overdue Invoice: ' + formatSAR(amount) : 'Large Invoice Pending: ' + formatSAR(amount),
          msg: (inv.supplier || 'Unknown supplier') + (inv.invNo ? ' #' + inv.invNo : '') + ' — ' + branch.branchName,
          branch: branch.brandIcon + ' ' + branch.branchName,
          page: 'inv-orders',
          dedupId: 'inv-' + branch.branchId + '-' + (inv.id || inv.invNo),
          ts: Date.now()
        });
      });
    });
    return ref;
  }

  // ── LEAVE REQUESTS (info-level) ──
  function watchLeave(branch) {
    var ref = db.ref(branch.path + '/tsLeaves');
    ref.on('child_added', function(snap) {
      var leave = snap.val();
      if (!leave || leave.status !== 'pending') return;
      // Find employee name from BS or snap key
      push({
        type: 'info', icon: '📝',
        title: 'New Leave Request',
        msg: (leave.type || 'Leave') + ' request — ' + branch.branchName,
        branch: branch.brandIcon + ' ' + branch.branchName,
        page: 'timesheet',
        dedupId: 'leave-' + branch.branchId + '-' + snap.key,
        ts: Date.now()
      });
    });
    return ref;
  }

  // ── MAIN START ──
  function start() {
    if (!db) {
      // db not ready — retry in 800ms (called from startLiveListeners which already retries,
      // but guard here too in case NXMon.start() is called directly)
      setTimeout(start, 800);
      return;
    }
    clearLiveListeners();
    _seen = {}; // reset dedup on re-start

    var paths = getAccessiblePaths();
    if (!paths.length) { console.log('NXMon: no accessible paths'); return; }

    console.log('NXMon: monitoring', paths.length, 'branch(es)');

    paths.forEach(function(branch) {
      // Stagger listeners slightly to avoid hammering Firebase on startup
      setTimeout(function() {
        var refs = [
          watchStock(branch),
          watchHealthCards(branch),
          watchChecklists(branch),
          watchInvoices(branch),
          watchLeave(branch)
        ];
        refs.forEach(function(r) { if (r) NX.liveListeners.push(r); });
      }, Math.random() * 500); // 0–500ms stagger
    });

    // Periodic re-check every 5 minutes (catches missed checklists as time passes)
    var _recheckTimer = setInterval(function() {
      if (!NX.session) { clearInterval(_recheckTimer); return; }
      paths.forEach(function(branch) {
        // Re-check checklists only (stock/health use .on() which is already live)
        var now = new Date();
        var dow = now.getDay();
        var sun = new Date(now); sun.setDate(now.getDate() - dow);
        var wkKey = sun.getFullYear() + '-' +
                    String(sun.getMonth()+1).padStart(2,'0') + '-' +
                    String(sun.getDate()).padStart(2,'0');
        var fbKey = wkKey.replace(/[.#$\[\]\/]/g, '_');
        db.ref(branch.path + '/cl_weeks/' + fbKey).once('value', function(snap) {
          // Allow re-alert for new time slot (AM/PM) by clearing pm dedup keys
          var hour = new Date().getHours();
          var slot = hour >= 17 ? 'pm' : 'am';
          // watchChecklists will push if needed (called via .once so no listener leak)
        });
      });
    }, 5 * 60 * 1000); // every 5 min
  }

  // ── PUBLIC API ──
  return { start: start, push: push, invalidateCache: invalidateCache };
})();

var SEARCH_INDEX = [
  { label:'Executive Dashboard', page:'exec-dash', keywords:'dashboard revenue sales overview' },
  { label:'Brand Performance', page:'brand-perf', keywords:'brand performance leaderboard comparison' },
  { label:'Revenue Analytics', page:'rev-analytics', keywords:'revenue analytics charts trends' },
  { label:'Headcount Overview', page:'headcount', keywords:'staff headcount attendance hr people' },
  { label:'Food Cost Analysis', page:'food-cost', keywords:'food cost analysis wastage percentage' },
  { label:'Alerts Center', page:'alerts-center', keywords:'alerts notifications critical warnings' },
  { label:'Brand Management', page:'brand-mgmt', keywords:'brands manage edit add piatto hybrid cafe' },
{ label:'Access Control', page:'access-ctrl', keywords:'access users pins roles permissions security' },
  { label:'Audit Log', page:'audit-log', keywords:'audit log history trail activity' },
  { label:'Shared Ingredients', page:'shared-ingredients', keywords:'shared ingredients catalog recipe cost inv items global' },
  { label:'Inventory Items', page:'inv-items', keywords:'inventory items stock list' },
  { label:'Receive / Issue Stock', page:'inv-moves', keywords:'receive issue stock transfer moves' },
  { label:'Purchase Orders', page:'inv-orders', keywords:'purchase orders PO supplier' },
  { label:'Low Stock Alerts', page:'low-stock', keywords:'low stock out of stock alerts critical' },
  { label:'Monthly Report', page:'inv-report', keywords:'monthly report inventory summary' },
  { label:'Wastage Log', page:'wastage', keywords:'wastage waste log spoilage' },
  { label:'Staff', page:'staff', keywords:'staff employees workers team people' },
  { label:'Schedule', page:'schedule', keywords:'schedule shifts rota planning week' },
  { label:'Time Sheet', page:'timesheet', keywords:'timesheet attendance clock in out hours' },
  { label:'Health Cards', page:'health-cards', keywords:'health cards medical expiry compliance' },
  { label:'Sales', page:'sales', keywords:'sales revenue daily covers check average' },
  { label:'Petty Cash', page:'petty-cash', keywords:'petty cash expenses float finance' },
  { label:'Checklists', page:'checklists', keywords:'checklists tasks compliance operations' },
  { label:'QR Check-In', page:'qr-checkin', keywords:'qr checkin attendance mobile scan' }
];

var searchTimeout = null;
var searchResultsEl = null;

function initGlobalSearch() {
  var input = document.getElementById('global-search');
  if (!input) return;

  // Create results dropdown
  searchResultsEl = document.createElement('div');
  searchResultsEl.id = 'search-results';
  searchResultsEl.style.cssText = [
    'position:absolute','top:calc(100% + 6px)','right:0',
    'width:280px','background:var(--body-bg)',
    'border:1px solid var(--border-strong)','border-radius:10px',
    'box-shadow:0 16px 48px rgba(0,0,0,.6)','z-index:500',
    'overflow:hidden','display:none','max-height:320px','overflow-y:auto'
  ].join(';');
  input.parentNode.style.position = 'relative';
  input.parentNode.appendChild(searchResultsEl);

  input.addEventListener('input', function() {
    clearTimeout(searchTimeout);
    var q = this.value.trim();
    if (!q) { searchResultsEl.style.display = 'none'; return; }
    searchTimeout = setTimeout(function() { showSearchResults(q); }, 150);
  });

  input.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') { searchResultsEl.style.display = 'none'; this.value = ''; }
  });

  document.addEventListener('click', function(e) {
    if (!input.contains(e.target) && !searchResultsEl.contains(e.target)) {
      searchResultsEl.style.display = 'none';
    }
  });
}

function showSearchResults(q) {
  if (!searchResultsEl) return;
  var lq = q.toLowerCase();
  var matches = SEARCH_INDEX.filter(function(item) {
    return item.label.toLowerCase().includes(lq) || item.keywords.includes(lq);
  }).slice(0, 8);

  if (!matches.length) {
    searchResultsEl.innerHTML = '<div style="padding:16px;text-align:center;color:var(--text-tertiary);font-size:13px">No results for "' + xe(q) + '"</div>';
  } else {
    searchResultsEl.innerHTML = '<div style="padding:6px 12px 4px;font-size:10px;color:var(--text-tertiary);text-transform:uppercase;letter-spacing:.1em">Pages</div>' +
      matches.map(function(m) {
        var highlighted = m.label.replace(new RegExp('(' + q + ')', 'gi'), '<strong style="color:var(--text-primary)">$1</strong>');
        return '<div onclick="searchGo(\'' + m.page + '\')" style="padding:10px 14px;cursor:pointer;transition:background .1s;display:flex;align-items:center;gap:10px;font-size:13px" onmouseover="this.style.background=\'var(--surface-2)\'" onmouseout="this.style.background=\'\'">' +
          '<span style="color:var(--text-tertiary)">→</span>' +
          '<span style="color:var(--text-secondary)">' + highlighted + '</span>' +
          '</div>';
      }).join('');
  }
  searchResultsEl.style.display = 'block';
}

function searchGo(pageId) {
  searchResultsEl.style.display = 'none';
  var input = document.getElementById('global-search');
  if (input) input.value = '';
  navTo(pageId);
}

// ══════════════════════════════════════════════════════
// MOBILE BOTTOM NAVIGATION
// ══════════════════════════════════════════════════════
function buildMobileNav() {
  var existing = document.getElementById('mobile-nav');
  if (existing) existing.remove();

  var s = NX.session;
  if (!s) return;

  var mobileItems = {
    ceo: [
      { id:'exec-dash', icon:'📊', label:'Dashboard' },
      { id:'brand-perf', icon:'🏆', label:'Brands' },
      { id:'rev-analytics', icon:'📈', label:'Revenue' },
      { id:'alerts-center', icon:'⚠️', label:'Alerts' }
    ],
    super_admin: [
      { id:'exec-dash', icon:'📊', label:'Dashboard' },
      { id:'brand-mgmt', icon:'🏢', label:'Brands' },
      { id:'alerts-center', icon:'⚠️', label:'Alerts' },
      { id:'access-ctrl', icon:'🔐', label:'Access' }
    ],
    brand_dir: [
      { id:'brand-dash', icon:'📊', label:'Dashboard' },
      { id:'brand-branches', icon:'🏪', label:'Branches' },
      { id:'food-cost', icon:'🍽️', label:'Food Cost' },
      { id:'alerts-center', icon:'⚠️', label:'Alerts' }
    ],
    regional: [
      { id:'region-dash', icon:'📊', label:'Dashboard' },
      { id:'region-branches', icon:'🏪', label:'Branches' },
      { id:'headcount', icon:'👥', label:'Staff' },
      { id:'alerts-center', icon:'⚠️', label:'Alerts' }
    ],
    branch_mgr: [
      { id:'branch-dash',   icon:'📊', label:'Dashboard' },
      { id:'inv-items',     icon:'📦', label:'Inventory' },
      { id:'staff',         icon:'👥', label:'Staff' },
      { id:'_staff-portal', icon:'📱', label:'Daily Task' }
    ],
    staff: [
      { id:'branch-dash',   icon:'📊', label:'Dashboard' },
      { id:'_staff-portal', icon:'📱', label:'Daily Task' }
    ]
  };

  var items = mobileItems[s.role] || mobileItems.branch_mgr;
  var nav = document.createElement('div');
  nav.id = 'mobile-nav';
  nav.style.cssText = [
    'display:none','position:fixed','bottom:0','left:0','right:0',
    'height:60px','background:rgba(3,5,8,.97)',
    'border-top:1px solid var(--border)',
    'backdrop-filter:blur(20px)',
    'z-index:150','align-items:stretch'
  ].join(';');

  nav.innerHTML = items.map(function(item) {
    return '<div onclick="navTo(\'' + item.id + '\');updateMobileNav(\'' + item.id + '\')" ' +
      'data-page="' + item.id + '" ' +
      'style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;cursor:pointer;transition:all .15s;color:var(--text-tertiary);font-size:10px;font-family:var(--font);padding:6px 0" ' +
      'onmouseover="this.style.color=\'var(--text-primary)\'" onmouseout="updateMobileNavStyle()">' +
      '<span style="font-size:20px">' + item.icon + '</span>' +
      '<span>' + item.label + '</span>' +
      '</div>';
  }).join('');

  document.getElementById('app').appendChild(nav);

  // Show on mobile
  function applyMobileLayout() {
    if (window.innerWidth <= 768) {
      nav.style.display = 'flex';
      document.querySelector('.main-content').style.paddingBottom = '76px';
      document.querySelector('.statusbar').style.display = 'none';
    } else {
      nav.style.display = 'none';
      document.querySelector('.main-content').style.paddingBottom = '24px';
      var sb = document.querySelector('.statusbar');
      if (sb) sb.style.display = 'flex';
    }
  }

  applyMobileLayout();
  window.removeEventListener('resize', applyMobileLayout);
  window.addEventListener('resize', applyMobileLayout);
}

function updateMobileNav(activeId) {
  var items = document.querySelectorAll('#mobile-nav > div');
  items.forEach(function(el) {
    var isActive = el.dataset.page === activeId;
    el.style.color = isActive ? 'var(--text-primary)' : 'var(--text-tertiary)';
  });
}

function updateMobileNavStyle() {
  if (!NX.page) return;
  updateMobileNav(NX.page);
}

// ══════════════════════════════════════════════════════
// ANIMATED NUMBER COUNTER
// ══════════════════════════════════════════════════════
function animateNumber(el, target, duration, prefix, suffix) {
  if (!el) return;
  prefix = prefix || '';
  suffix = suffix || '';
  duration = duration || 800;
  var start = 0;
  var startTime = null;
  function step(ts) {
    if (!startTime) startTime = ts;
    var progress = Math.min((ts - startTime) / duration, 1);
    var ease = 1 - Math.pow(1 - progress, 3);
    el.textContent = prefix + formatNum(Math.round(start + (target - start) * ease)) + suffix;
    if (progress < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

// ══════════════════════════════════════════════════════
// DATA HELPER FUNCTIONS (spec requirement)
// ══════════════════════════════════════════════════════
function getCompanyData() {
  return {
    brands: SEED.brands,
    metrics: DEMO_METRICS
  };
}

function getBrandSales(brandId, period) {
  var b = DEMO_METRICS.brands[brandId];
  if (!b) return 0;
  if (period === 'today') return b.todaySales;
  if (period === 'mtd') return b.mtdSales;
  if (period === 'week') return Math.round(b.mtdSales * 0.23);
  return b.mtdSales;
}

function getCompanyHeadcount() {
  return Object.values(DEMO_METRICS.brands).reduce(function(s, b) { return s + b.staff; }, 0);
}

function getCompanyFoodCost() {
  var brands = Object.values(DEMO_METRICS.brands);
  return (brands.reduce(function(s, b) { return s + b.foodCostPct; }, 0) / brands.length).toFixed(1);
}

function getAlerts(role, entityId) {
  return DEMO_NOTIFICATIONS.filter(function(n) {
    if (role === 'ceo' || role === 'super_admin') return true;
    if (role === 'brand_dir') return n.branch.toLowerCase().includes(entityId || '');
    return true;
  });
}

function aggregateSales(branchIds, dateRange) {
  var total = 0;
  branchIds.forEach(function(bid) {
    Object.keys(DEMO_METRICS.brands).forEach(function(bk) {
      if (DEMO_METRICS.brands[bk].branches[bid]) {
        total += DEMO_METRICS.brands[bk].branches[bid].todaySales;
      }
    });
  });
  return total;
}

function getEntityPath(role, id) {
  // Uses OpsHub-compatible flat Firebase paths
  if (role === 'super_admin' || role === 'ceo') return 'admin';
  if (role === 'branch_mgr' || role === 'staff') {
    return id ? 'branches/' + id : 'admin';
  }
  // For brand_dir and regional, we read from admin/branches filtered by brand/region
  return 'admin/branches';
}

// ══════════════════════════════════════════════════════
// OFFLINE BANNER
// ══════════════════════════════════════════════════════
function showOfflineBanner() {
  var existing = document.getElementById('offline-banner');
  if (existing) return;
  var banner = document.createElement('div');
  banner.id = 'offline-banner';
  banner.style.cssText = [
    'position:fixed','top:' + getComputedStyle(document.documentElement).getPropertyValue('--topbar-h'),
    'left:0','right:0','z-index:200',
    'background:rgba(248,113,113,.15)',
    'border-bottom:1px solid rgba(248,113,113,.3)',
    'padding:8px 20px',
    'display:flex','align-items:center','justify-content:center','gap:10px',
    'font-size:12px','color:#c0392b',
    'backdrop-filter:blur(10px)'
  ].join(';');
  banner.innerHTML = '⚡ Offline mode — showing demo data. Changes will not be saved. <button onclick="document.getElementById(\'offline-banner\').remove()" style="background:none;border:none;color:#c0392b;cursor:pointer;margin-left:10px;font-size:16px;line-height:1">✕</button>';
  document.getElementById('app').insertBefore(banner, document.querySelector('.body-wrap'));
}

// ══════════════════════════════════════════════════════
// KEYBOARD SHORTCUTS
// ══════════════════════════════════════════════════════
document.addEventListener('keydown', function(e) {
  // Cmd/Ctrl+K → focus search
  if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
    e.preventDefault();
    var si = document.getElementById('global-search');
    if (si) si.focus();
  }
  // Cmd/Ctrl+\ → toggle sidebar
  if ((e.metaKey || e.ctrlKey) && e.key === '\\') {
    e.preventDefault();
    toggleSidebar();
  }
  // Escape → close modals / notif panel
  if (e.key === 'Escape') {
    var notifPanel = document.getElementById('notif-panel');
    if (notifPanel && notifPanel.classList.contains('open')) toggleNotifPanel();
    closeModal({ target: { id: 'modal-overlay' } });
  }
});

// ══════════════════════════════════════════════════════
// NAV OVERRIDE — hook mobile nav update into navTo
// ══════════════════════════════════════════════════════
var _origNavTo = navTo;
navTo = function(pageId) {
  _origNavTo(pageId);
  updateMobileNav(pageId);
};

// ══════════════════════════════════════════════════════
// STARTUP
// ══════════════════════════════════════════════════════
window.onload = function() {
  // Theme
  var savedTheme = localStorage.getItem('alfa_theme') || 'dark';
  document.documentElement.setAttribute('data-theme', savedTheme);
  NX.theme = savedTheme;
  var tb = document.getElementById('theme-btn');
  if (tb) tb.textContent = savedTheme === 'dark' ? '🌙' : '☀️';

  // Start clock
  setInterval(updateClock, 1000);
  updateClock();

  // Init Firebase — bundled inline so always sync
  tryInitFB();

  // ── Critical: load branches + users FIRST, then restore session or render login ──
  // This prevents the race condition where PIN check runs before NX_USERS is populated.
  function _startApp() {
    var sess = loadSession();
    if (sess) {
      NX.session = sess;
      launchApp();
    } else {
      requestAnimationFrame(function() {
        try {
          renderLogin(0);
        } catch(err) {
          console.error('renderLogin failed:', err);
          var c = document.getElementById('login-card');
          if (c) c.innerHTML = '<div style="color:#c0392b;padding:20px;font-size:13px;text-align:center">Login render error: '+ (err.message||err) +'<br><button onclick="location.reload()" style="margin-top:14px;padding:8px 18px;background:#f0a500;border:none;color:#000;border-radius:7px;font-weight:700;cursor:pointer">Reload</button></div>';
        }
      });
    }
  }

  if (db) {
    loadBranchRegistry(function() {
      loadUserRegistry(function() {
        // Both registries loaded — now safe to check session or render login
        _startApp();
      });
    });
  } else {
    // No Firebase — render login immediately
    _startApp();
  }
};

// Override launchApp to also init extra features
var _origLaunchApp = launchApp;
launchApp = function() {
  // Clear HRF data cache on every login so fresh Firebase data is fetched
  if (typeof HRF !== 'undefined') {
    HRF.staff = {}; HRF.att = {}; HRF.leaves = {}; HRF.sch = {}; HRF.tsEmps = {};
    HRF.health = {}; HRF.pc = {}; HRF.sales = {}; HRF.invoices = {}; HRF.waste = {}; HRF.compliance = null; HRF.assets = {};
  }
  _origLaunchApp();
  var role = NX.session && NX.session.role;
  // For HR/Finance roles, the HRF page functions load their own data via Firebase.
  // Just ensure branches registry is loaded, then re-render the current page.
  loadBranchRegistry(function() {
    if (role === 'hr_manager' || role === 'finance_dir') {
      // HRF pages self-load from Firebase — just re-render to trigger fresh load
      if (NX.page) { setTimeout(function(){ renderPage(NX.page); }, 100); }
    } else {
      loadAllBranchesSales(function() {
        refreshDemoMetrics();
        if (NX.page) { renderPage(NX.page); }
      });
    }
  });
  setTimeout(function() {
    initGlobalSearch();
    buildMobileNav();
    startLiveListeners();
    // Seed Firebase — wait until db is ready
    var seedTries = 0;
    var seedInterval = setInterval(function() {
      seedTries++;
      if (db) {
        clearInterval(seedInterval);
        seedFirebase();
      } else if (seedTries >= 30) {
        clearInterval(seedInterval);
        console.warn('seedFirebase: db never became ready');
      }
    }, 300);
    // Update alert badge
    var nb = document.getElementById('nb-alerts');
    if (nb) { nb.style.display = 'flex'; nb.textContent = '3'; }
    // Update Area Manager transfer pending badge
    if (NX.session && NX.session.role === 'regional') {
      setTimeout(amUpdateTransferBadge, 500);
    }
    // ── Defensive: ensure page-area has content; if empty, force re-render ──
    var _pa = document.getElementById('page-area');
    if (_pa && (!_pa.innerHTML || _pa.innerHTML.trim().length < 20) && NX.page) {
      try { renderPage(NX.page); } catch(e) { console.error('Forced re-render failed:', e); }
    }
    // Also: ensure login screen is fully hidden and app fully visible
    var _ls = document.getElementById('login-screen');
    var _ap = document.getElementById('app');
    if (_ls && _ls.style.display !== 'none') _ls.style.display = 'none';
    if (_ap) { _ap.style.display = ''; _ap.classList.add('visible'); }
  }, 200);
};

// ════════════════════════════════════════════════════════════════
// HR & FINANCE MODULE — REAL FIREBASE DATA
// Firebase paths:
//   branches/{id}/staff    → employees per branch
//   branches/{id}/tsAtt    → attendance records
//   branches/{id}/tsLeaves → leave requests
//   branches/{id}/sch      → schedules
//   branches/{id}/health   → health cards
//   branches/{id}/pc       → petty cash entries
//   branches/{id}/sales    → daily sales entries
//   branches/{id}/invoices → supplier invoices
//   branches/{id}/waste    → wastage logs
// ════════════════════════════════════════════════════════════════

var HRF = {
  staff:{}, att:{}, leaves:{}, sch:{}, health:{},
  pc:{}, sales:{}, invoices:{}, waste:{}, _listeners:{}
};

function hrfBranches() {
  var s = NX.session || {};
  var all = Object.values(NX_BRANCHES || {});
  if (!all.length) return [];
  if (s.role === 'hr_manager' || s.role === 'finance_dir') {
    var ids = s.branchIds || [];
    return ids.length ? all.filter(function(b){ return ids.indexOf(b.id) >= 0; }) : all;
  }
  return all;
}

function hrfLoadAll(coll, cacheKey, cb) {
  if (!db) { cb({}); return; }
  var branches = hrfBranches();
  if (!branches.length) { cb({}); return; }
  var loaded = 0;
  branches.forEach(function(b) {
    db.ref('branches/' + b.id + '/' + coll).once('value', function(snap) {
      var raw = snap.val() || {};
      // tsAtt must stay as keyed object {eid: {month: [records]}} — never convert to array
      if (coll === 'tsAtt') {
        HRF[cacheKey][b.id] = raw;
      } else {
        var arr = Array.isArray(raw) ? raw.filter(Boolean) : Object.values(raw).filter(Boolean);
        if (!Array.isArray(raw)) {
          Object.keys(raw).forEach(function(k,i){ if(arr[i]) arr[i]._key = k; });
        }
        HRF[cacheKey][b.id] = arr;
      }
      loaded++;
      if (loaded === branches.length) cb(HRF[cacheKey]);
    });
  });
}

function hxe(s) { return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function hfsar(n) { return 'SAR ' + parseFloat(n||0).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}); }
function hfnum(n) { return parseFloat(n||0).toLocaleString('en-US',{minimumFractionDigits:0,maximumFractionDigits:0}); }
function hini(name) { return String(name||'').split(' ').map(function(w){return w[0]||'';}).join('').slice(0,2).toUpperCase(); }

function hrfKpi(icon, label, value, sub, color) {
  var c = color || 'var(--hr-color)';
  return '<div class="hrf-kpi-card" style="--kpi-color:' + c + '">' +
    '<div style="width:38px;height:38px;border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:17px;background:' + c + '18;margin-bottom:12px">' + icon + '</div>' +
    '<div style="font-size:10px;color:var(--text-tertiary);text-transform:uppercase;letter-spacing:.1em;margin-bottom:5px;font-weight:600">' + hxe(label) + '</div>' +
    '<div style="font-family:var(--mono);font-size:26px;font-weight:300;letter-spacing:-1px;color:var(--text-primary);line-height:1">' + hxe(String(value)) + '</div>' +
    '<div style="margin-top:6px;font-size:11px;color:var(--text-secondary)">' + hxe(sub) + '</div>' +
    '</div>';
}

function hrfHeader(title, sub, btns) {
  return '<div class="page-header" style="display:flex;align-items:flex-start;justify-content:space-between;flex-wrap:wrap;gap:12px;margin-bottom:20px;padding-bottom:16px;border-bottom:1px solid var(--border)">' +
    '<div><h1 style="font-size:22px;font-weight:700;letter-spacing:-.03em;margin-bottom:3px">' + hxe(title) + '</h1>' +
    '<p style="font-size:13px;color:var(--text-secondary);margin-top:4px">' + hxe(sub) + '</p></div>' +
    '<div style="display:flex;gap:8px;align-items:center">' + (btns||'') + '</div></div>';
}

function hrfLoading(msg) {
  return '<div class="empty-state"><div style="font-size:36px;margin-bottom:12px">\u23f3</div><h3>' + hxe(msg||'Loading\u2026') + '</h3><p style="color:var(--text-secondary)">Reading live data from Firebase</p></div>';
}

function hrfTable(headers, rows, tableId) {
  var ths = headers.map(function(h){ return '<th style="padding:9px 14px;text-align:left;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--text-tertiary);border-bottom:1px solid var(--border);background:var(--surface-2)">' + hxe(h) + '</th>'; }).join('');
  return '<div style="border:1px solid var(--border);border-radius:12px;overflow:hidden;background:var(--surface-1)">' +
    '<table'+(tableId?' id="'+tableId+'"':'')+' style="width:100%;border-collapse:collapse;font-size:12.5px">' +
    '<thead><tr>' + ths + '</tr></thead>' +
    '<tbody>' + rows + '</tbody></table></div>';
}

function hrfBadge(text, color) {
  return '<span style="background:' + color + '18;color:' + color + ';border:1px solid ' + color + '30;padding:3px 9px;border-radius:20px;font-size:11px;font-weight:600">' + hxe(text) + '</span>';
}

var HRF_TODAY = (function(){
  var d = new Date(new Date().getTime() + 3*3600000);
  return d.toISOString().slice(0,7);
})();
var HRF_MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

// ── HR DASHBOARD ──
function pHrfHrDash() {
  var branches = hrfBranches();
  function renderDash() {
    var allStaff=[],allLeaves=[],totPresent=0,totLate=0;
    var todayKey=(function(){var d=new Date(new Date().getTime()+3*3600000);return d.toISOString().slice(0,10);})();
    var d=new Date(new Date().getTime()+3*3600000);
    var payMonth=d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0');

    branches.forEach(function(b){
      var st=HRF.staff[b.id]||[]; allStaff=allStaff.concat(st);
      var lv=HRF.leaves[b.id]||[]; allLeaves=allLeaves.concat(lv);
      var dayAtt=(HRF.att[b.id]||{})[todayKey]||{};
      Object.values(dayAtt).forEach(function(a){ if(a.status==='present')totPresent++; else if(a.status==='late')totLate++; });
    });

    var active   = allStaff.filter(function(m){return (m.status||'Active')==='Active';});
    var onLeave  = allStaff.filter(function(m){return m.status==='On Leave';});
    var pendLeaves = allLeaves.filter(function(l){return (l.status||'pending')==='pending';});

    // ── Sponsor breakdown ──────────────────────────────────────────────────
    var alfaStaff    = allStaff.filter(function(m){return (m.workerType||'company')!=='3rdparty';});
    var thirdStaff   = allStaff.filter(function(m){return m.workerType==='3rdparty';});
    // Group 3rd party by company name
    var byCompany = {};
    thirdStaff.forEach(function(m){
      var co = m.companyId || 'Unknown';
      // Resolve if it's still a raw ID
      if(HRF_COMPANIES && HRF_COMPANIES.length){
        var found = HRF_COMPANIES.find(function(c){return c.id===co||c.name===co;});
        if(found) co = found.name;
      }
      byCompany[co] = (byCompany[co]||[]);
      byCompany[co].push(m);
    });

    // ── Payroll totals for current month ─────────────────────────────────
    var payGross=0,payNet=0,payGosi=0,paySaned=0,payPending=0,payReleased=0;
    branches.forEach(function(b){
      var payData=(HRF.payroll&&HRF.payroll[b.id]&&HRF.payroll[b.id][payMonth])||{};
      Object.values(payData).forEach(function(p){
        payGross += parseFloat(p.gross||0);
        payNet   += parseFloat(p.net||0);
        payGosi  += parseFloat(p.gosi||0);
        paySaned += parseFloat(p.saned||0);
        if(p.status==='released') payReleased++;
        else if((p.status||'').indexOf('pending')===0) payPending++;
      });
    });
    // Estimate from staff if no payroll run yet
    if(!payGross){
      allStaff.forEach(function(m){
        var basic=parseFloat(m.basicSalary||m.salary||0);
        var gross=basic+parseFloat(m.housingAllowance||0)+parseFloat(m.transportAllowance||0)+parseFloat(m.otherAllowances||0);
        payGross+=gross;
        var gosiYes=(m.gosiEnrolled||'yes')!=='no';
        var gosi=gosiYes?Math.round(basic*0.09):0;
        var isSaudi=(m.nationality||'').toLowerCase().indexOf('saudi')>=0;
        var saned=(isSaudi&&gosiYes)?Math.round(basic*0.01):0;
        payNet+=gross-gosi-saned;
        payGosi+=gosi; paySaned+=saned;
      });
    }

    // ── Iqama expiry alerts ──────────────────────────────────────────────
    var today30=new Date(new Date().getTime()+3*3600000);
    today30.setDate(today30.getDate()+30);
    var todayStr=new Date(new Date().getTime()+3*3600000).toISOString().slice(0,10);
    var iqamaAlerts=allStaff.filter(function(m){
      if(!m.iqamaExpiry)return false;
      return m.iqamaExpiry>=todayStr&&m.iqamaExpiry<=today30.toISOString().slice(0,10);
    }).sort(function(a,b){return a.iqamaExpiry.localeCompare(b.iqamaExpiry);});

    var curMonth=HRF_MONTHS[d.getMonth()]+' '+d.getFullYear();

    var h=hrfHeader('HR Dashboard','Live workforce · '+curMonth,
      '<button class="btn" onclick="navTo(\'hrf-approvals\')">✅ Approvals'+(pendLeaves.length?' <span style="background:#b45309;color:#fff;border-radius:10px;padding:1px 7px;font-size:10px;margin-left:4px">'+pendLeaves.length+'</span>':'')+'</button>'+
      '<button class="btn btn-primary" onclick="navTo(\'hrf-payroll\')">💸 Payroll</button>'+
      '<button class="btn" onclick="navTo(\'hrf-employees\')">👥 All Staff</button>');

    // ── Row 1: Workforce KPIs ─────────────────────────────────────────────
    h+='<div style="margin-bottom:6px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:var(--text-tertiary)">Workforce</div>';
    h+='<div class="hrf-kpi-grid" style="grid-template-columns:repeat(5,1fr);margin-bottom:20px">';
    h+=hrfKpi('👥','Total Headcount',allStaff.length,branches.length+' branches','var(--hr-color)');
    h+=hrfKpi('✅','Active',active.length,'Currently employed','var(--success)');
    h+=hrfKpi('🏖️','On Leave',onLeave.length,'Approved leave','var(--warning)');
    h+=hrfKpi('🟢','Present Today',totPresent,totLate+' late today','#0057ff');
    h+=hrfKpi('⏳','Pending Leaves',pendLeaves.length,'Awaiting approval','var(--info)');
    h+='</div>';

    // ── Row 2: Sponsor breakdown ──────────────────────────────────────────
    h+='<div style="margin-bottom:6px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:var(--text-tertiary)">Workforce by Sponsor</div>';
    h+='<div class="hrf-kpi-grid" style="margin-bottom:20px">';
    // ALFA card
    h+='<div class="hrf-kpi-card" style="border-left:3px solid #00875a;cursor:pointer" onclick="NX._hrfSponsorFilter=\'alfa\';navTo(\'hrf-employees\')">';
    h+='<div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">';
    h+='<div style="width:38px;height:38px;border-radius:10px;background:rgba(0,135,90,.12);display:flex;align-items:center;justify-content:center;font-size:18px">🏢</div>';
    h+='<div><div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--text-tertiary)">ALFA Staff</div>';
    h+='<div style="font-size:26px;font-weight:800;color:#00875a;font-family:var(--mono);line-height:1.1">'+alfaStaff.length+'</div></div></div>';
    var alfaPct=allStaff.length?Math.round(alfaStaff.length/allStaff.length*100):0;
    h+='<div style="height:4px;background:var(--surface-3);border-radius:2px"><div style="height:100%;width:'+alfaPct+'%;background:#00875a;border-radius:2px"></div></div>';
    h+='<div style="font-size:10px;color:var(--text-tertiary);margin-top:6px">'+alfaPct+'% of total workforce</div>';
    h+='</div>';
    // 3rd party companies
    Object.keys(byCompany).sort().forEach(function(co){
      var coStaff=byCompany[co];
      var pct=allStaff.length?Math.round(coStaff.length/allStaff.length*100):0;
      var coActive=coStaff.filter(function(m){return (m.status||'Active')==='Active';}).length;
      h+='<div class="hrf-kpi-card" style="border-left:3px solid #5b21b6;cursor:pointer" onclick="NX._hrfQ=\''+hxe(co)+'\';navTo(\'hrf-employees\')">';
      h+='<div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">';
      h+='<div style="width:38px;height:38px;border-radius:10px;background:rgba(91,33,182,.1);display:flex;align-items:center;justify-content:center;font-size:18px">🤝</div>';
      h+='<div style="min-width:0"><div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#5b21b6;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+hxe(co)+'</div>';
      h+='<div style="font-size:26px;font-weight:800;color:#5b21b6;font-family:var(--mono);line-height:1.1">'+coStaff.length+'</div></div></div>';
      h+='<div style="height:4px;background:var(--surface-3);border-radius:2px"><div style="height:100%;width:'+pct+'%;background:#5b21b6;border-radius:2px"></div></div>';
      h+='<div style="font-size:10px;color:var(--text-tertiary);margin-top:6px">'+coActive+' active · '+pct+'% of workforce</div>';
      h+='</div>';
    });
    if(!thirdStaff.length){
      h+='<div class="hrf-kpi-card" style="opacity:.5"><div style="font-size:20px;margin-bottom:8px">🤝</div><div style="font-size:13px;color:var(--text-tertiary)">No 3rd party staff</div></div>';
    }
    h+='</div>';

    // ── Row 3: Payroll Summary ────────────────────────────────────────────
    h+='<div style="margin-bottom:6px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:var(--text-tertiary)">Payroll — '+curMonth+(payGross&&payReleased+payPending===0?' (Estimated from HR Records)':'')+' <button class="btn btn-sm" onclick="navTo(\'hrf-payroll\')" style="margin-left:10px;font-size:10px">Open Payroll →</button></div>';
    h+='<div class="hrf-kpi-grid" style="grid-template-columns:repeat(5,1fr);margin-bottom:20px">';
    h+=hrfKpi('💰','Gross Payroll',hfsar(payGross),'All allowances included','var(--payroll-color)');
    h+=hrfKpi('📤','Net Payroll',hfsar(payNet),'After all deductions','#00875a');
    h+=hrfKpi('🏛️','GOSI Total',hfsar(payGosi),'9% employer share','#c0392b');
    h+=hrfKpi('🛡️','Saned Total',hfsar(paySaned),'1% Saudi nationals','#b45309');
    h+=hrfKpi('✅','Released',payReleased+' / '+(payReleased+payPending+(payGross&&payReleased+payPending===0?allStaff.filter(function(m){return parseFloat(m.basicSalary||m.salary||0)>0;}).length:0)),'Payments processed','var(--success)');
    h+='</div>';

    // ── Branch breakdown table ────────────────────────────────────────────
    var rows='';
    branches.forEach(function(b){
      var st=HRF.staff[b.id]||[];
      var act=st.filter(function(m){return (m.status||'Active')==='Active';}).length;
      var lv=st.filter(function(m){return m.status==='On Leave';}).length;
      var alfa3=st.filter(function(m){return (m.workerType||'company')!=='3rdparty';}).length;
      var third=st.filter(function(m){return m.workerType==='3rdparty';}).length;
      var payData=(HRF.payroll&&HRF.payroll[b.id]&&HRF.payroll[b.id][payMonth])||{};
      var bNet=0;
      Object.values(payData).forEach(function(p){bNet+=parseFloat(p.net||0);});
      if(!bNet) st.forEach(function(m){
        var basic=parseFloat(m.basicSalary||m.salary||0);
        var h2=parseFloat(m.housingAllowance||0),t2=parseFloat(m.transportAllowance||0),o2=parseFloat(m.otherAllowances||0);
        var gross=basic+h2+t2+o2;
        var gosiYes=(m.gosiEnrolled||'yes')!=='no';
        var gosi=gosiYes?Math.round(basic*0.09):0;
        var isSaudi=(m.nationality||'').toLowerCase().indexOf('saudi')>=0;
        var saned=(isSaudi&&gosiYes)?Math.round(basic*0.01):0;
        bNet+=gross-gosi-saned;
      });
      rows+='<tr style="cursor:pointer" onclick="NX._hrfBranch=\''+hxe(b.id)+'\';navTo(\'hrf-employees\')">'+
        '<td><strong>'+(b.icon||'🍽️')+' '+hxe(b.name)+'</strong></td>'+
        '<td style="text-align:center;font-family:var(--mono);color:var(--hr-color);font-weight:700">'+st.length+'</td>'+
        '<td style="text-align:center;font-family:var(--mono);color:#00875a">'+alfa3+'</td>'+
        '<td style="text-align:center;font-family:var(--mono);color:#5b21b6">'+third+'</td>'+
        '<td style="text-align:center;font-family:var(--mono);color:#00875a">'+act+'</td>'+
        '<td style="text-align:center;font-family:var(--mono);color:#b45309">'+lv+'</td>'+
        '<td style="font-family:var(--mono);color:var(--payroll-color);font-weight:700">'+hfsar(bNet)+'</td></tr>';
    });
    h+='<div class="hrf-section">';
    h+='<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">';
    h+='<span style="font-size:14px;font-weight:700">Branch Summary</span>';
    h+='<button class="btn btn-sm" onclick="navTo(\'hrf-employees\')">View All →</button></div>';
    h+=hrfTable(['Branch','Total','ALFA','3rd Party','Active','On Leave','Est. Net Pay'],rows);
    h+='</div>';

    // ── Iqama expiry alerts ───────────────────────────────────────────────
    if(iqamaAlerts.length){
      h+='<div class="hrf-section">';
      h+='<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">';
      h+='<span style="font-size:14px;font-weight:700">⚠️ Iqama Expiring Within 30 Days</span>';
      h+='<span style="font-size:11px;font-weight:700;background:#fef3f2;color:#b42318;padding:3px 10px;border-radius:10px">'+iqamaAlerts.length+' staff</span></div>';
      var irows='';
      iqamaAlerts.slice(0,8).forEach(function(m){
        var daysLeft=Math.ceil((new Date(m.iqamaExpiry)-new Date(todayStr))/(1000*60*60*24));
        var col=daysLeft<=7?'#b42318':daysLeft<=14?'#b45309':'#92400e';
        irows+='<tr>'+
          '<td><strong>'+hxe(m.name)+'</strong></td>'+
          '<td>'+hxe(m.dept||'—')+'</td>'+
          '<td>'+hxe(m.iqama||'—')+'</td>'+
          '<td style="font-family:var(--mono)">'+hxe(m.iqamaExpiry)+'</td>'+
          '<td style="font-weight:700;color:'+col+'">'+daysLeft+' days</td>'+
          '<td><button class="btn btn-sm" onclick="NX._hrfQ=\''+hxe(m.sap||m.id||'')+'\';navTo(\'hrf-employees\')">View</button></td>'+
        '</tr>';
      });
      h+=hrfTable(['Name','Dept','Iqama #','Expiry','Days Left',''],irows);
      h+='</div>';
    }

    // ── Pending leaves ────────────────────────────────────────────────────
    if(pendLeaves.length){
      h+='<div class="hrf-section"><div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px"><span style="font-size:14px;font-weight:700">⏳ Pending Leave Requests</span><button class="btn btn-sm" onclick="navTo(\'hrf-leave\')">View All →</button></div>';
      pendLeaves.slice(0,5).forEach(function(lv){
        h+='<div class="hrf-approval-card">'+
          '<div style="width:40px;height:40px;border-radius:10px;background:rgba(96,165,250,.15);display:flex;align-items:center;justify-content:center;font-size:18px;flex-shrink:0">🏖️</div>'+
          '<div style="flex:1"><div style="font-size:13px;font-weight:700;color:var(--text-primary);margin-bottom:3px">'+hxe(lv.empName||lv.name||'Staff Member')+'</div>'+
          '<div style="font-size:12px;color:var(--text-secondary);margin-bottom:8px">'+hxe(lv.type||'Leave')+' · '+hxe(lv.from||'')+' → '+hxe(lv.to||'')+(lv.days?' ('+lv.days+' days)':'')+'</div>'+
          '<div style="display:flex;gap:6px">'+
          '<button class="btn btn-sm" style="background:rgba(52,211,153,.15);border-color:rgba(52,211,153,.3);color:#065f46" onclick="hrfApproveLeave(\''+hxe(lv._branchId)+'\',\''+hxe(lv._key||lv.id||'')+'\')">✓ Approve</button>'+
          '<button class="btn btn-sm" style="background:rgba(248,113,113,.1);border-color:rgba(248,113,113,.25);color:#c0392b" onclick="hrfRejectLeave(\''+hxe(lv._branchId)+'\',\''+hxe(lv._key||lv.id||'')+'\')">✕ Reject</button>'+
          '</div></div></div>';
      });
      h+='</div>';
    }

    // ── Charts ────────────────────────────────────────────────────────────
    h+='<div class="hrf-grid-2">'+
      '<div class="hrf-chart-card"><div style="font-size:14px;font-weight:700;margin-bottom:16px">Staff by Department</div><div style="height:220px"><canvas id="hrf-chart-dept"></canvas></div></div>'+
      '<div class="hrf-chart-card"><div style="font-size:14px;font-weight:700;margin-bottom:16px">Attendance (Last 7 Days)</div><div style="height:220px"><canvas id="hrf-chart-att-trend"></canvas></div></div></div>';

    NX._hrfAllStaff=allStaff; NX._hrfAllAtt=HRF.att;
    var area=document.getElementById('page-area');
    if(area){area.innerHTML=h;setTimeout(function(){initPageCharts('hrf-hr-dash');},80);}
  }

  var cached=branches.filter(function(b){return HRF.staff[b.id];});
  if(cached.length===branches.length&&branches.length>0){setTimeout(renderDash,0);return hrfLoading('Refreshing…');}
  var done=0;
  function check(){done++;if(done>=4)renderDash();}
  hrfLoadAll('staff','staff',check);
  hrfLoadAll('tsLeaves','leaves',function(){branches.forEach(function(b){(HRF.leaves[b.id]||[]).forEach(function(l){l._branchId=b.id;});});check();});
  hrfLoadAll('tsAtt','att',function(){hrfLoadAll('tsEmps','tsEmps',check);});
  // Load payroll for current month
  var d2=new Date(new Date().getTime()+3*3600000);
  var pm=d2.getFullYear()+'-'+String(d2.getMonth()+1).padStart(2,'0');
  if(!HRF.payroll)HRF.payroll={};
  if(branches.length){var pdone=0;branches.forEach(function(b){db.ref('branches/'+b.id+'/payroll/'+pm).once('value',function(snap){if(!HRF.payroll[b.id])HRF.payroll[b.id]={};HRF.payroll[b.id][pm]=snap.val()||{};pdone++;if(pdone===branches.length)check();});});}else{check();}
  return hrfLoading('Loading HR data…');
}

// ── FINANCE DASHBOARD ──
function pHrfFinDash() {
  var branches=hrfBranches();
  function renderFinDash(){
    var d=new Date(new Date().getTime()+3*3600000);
    var curMonth=HRF_MONTHS[d.getMonth()]+' '+d.getFullYear();
    var curMoPfx=d.getFullYear()+'-'+(d.getMonth()<9?'0':'')+(d.getMonth()+1);
    var selYear=d.getFullYear();

    // ── Revenue & payment breakdown MTD ──
    var totRev=0,totCash=0,totCard=0,totDel=0;
    var revByBranch={};
    var revByMo=new Array(12).fill(0);
    branches.forEach(function(b){
      var bname=(NX_BRANCHES[b.id]||{}).name||b.id;
      var brev=0;
      (HRF.sales[b.id]||[]).forEach(function(e){
        var amt=parseFloat(e.actual||e.total||e.amount||0);
        // YTD monthly
        if(e.date&&e.date.startsWith(String(selYear))){var mo=parseInt(e.date.slice(5,7),10)-1;if(mo>=0&&mo<12)revByMo[mo]+=amt;}
        // MTD only
        if(!e.date||e.date.slice(0,7)!==curMoPfx)return;
        brev+=amt;totRev+=amt;
        totCash+=parseFloat(e.cash||0);
        totCard+=parseFloat(e.card||e.mada||0)+parseFloat(e.visa||0)+parseFloat(e.amex||0);
        totDel+=parseFloat(e.delivery||0);
      });
      revByBranch[bname]=(revByBranch[bname]||0)+brev;
    });

    // ── Costs MTD ──
    var totPC=0,totWaste=0;
    var wasteByMo=new Array(12).fill(0);
    var pcByMo=new Array(12).fill(0);
    branches.forEach(function(b){
      (HRF.pc[b.id]||[]).forEach(function(p){
        var amt=parseFloat(p.amount||0);
        if(p.date&&p.date.slice(0,7)===curMoPfx)totPC+=amt;
        if(p.date&&p.date.startsWith(String(selYear))){var mo=parseInt(p.date.slice(5,7),10)-1;if(mo>=0&&mo<12)pcByMo[mo]+=amt;}
      });
      (HRF.waste[b.id]||[]).forEach(function(w){
        var amt=parseFloat(w.value||w.cost||w.amount||0);
        if(w.date&&w.date.slice(0,7)===curMoPfx)totWaste+=amt;
        if(w.date&&w.date.startsWith(String(selYear))){var mo=parseInt(w.date.slice(5,7),10)-1;if(mo>=0&&mo<12)wasteByMo[mo]+=amt;}
      });
    });

    // ── Labour MTD (from payroll staff records × months) ──
    var totLabour=0;
    branches.forEach(function(b){
      (HRF.staff[b.id]||[]).forEach(function(m){
        var base=parseFloat(m.basicSalary||m.salary||0);
        var h_allow=Math.round(base*0.25);
        var t_allow=Math.round(base*0.10);
        var gross=base+h_allow+t_allow;
        totLabour+=gross+Math.round(gross*0.09);
      });
    });

    // ── Fixed costs MTD (from compliance module) ──
    var totFixed=0;
    branches.forEach(function(b){
      var comp=HRF.compliance&&HRF.compliance[b.id];if(!comp)return;
      totFixed+=(comp.recurring||[]).reduce(function(s,r){return s+(parseFloat(r.monthlyCost)||0);},0);
      totFixed+=(comp.services||[]).reduce(function(s,r){return s+(parseFloat(r.monthlyCost)||0);},0);
      totFixed+=(comp.permits||[]).reduce(function(s,p){return s+(parseFloat(p.monthlyCost)||0);},0)/12;
    });

    // ── Invoices ──
    var pendInv=0,pendInvAmt=0,overdueInv=0;
    var allInv=[];
    branches.forEach(function(b){
      (HRF.invoices[b.id]||[]).forEach(function(i){
        i._branchName=(NX_BRANCHES[b.id]||{}).name||b.id;
        allInv.push(i);
        if(i.status==='Pending'){pendInv++;pendInvAmt+=parseFloat(i.amount||i.total||0);}
        if(i.status==='Overdue'){overdueInv++;pendInvAmt+=parseFloat(i.amount||i.total||0);}
      });
    });

    // ── Computed KPIs ──
    var grossProfit=totRev-totWaste;
    var totCosts=totWaste+totLabour+totFixed+totPC;
    var netProfit=totRev-totCosts;
    var grossMargin=totRev>0?(grossProfit/totRev*100):0;
    var netMargin=totRev>0?(netProfit/totRev*100):0;
    var foodCostPct=totRev>0?(totWaste/totRev*100):0;
    var labourPct=totRev>0?(totLabour/totRev*100):0;

    // ── Header ──
    var h=hrfHeader('Finance Dashboard',
      'Live consolidated data \u00b7 '+curMonth,
      '<button class="btn" onclick="navTo(\'hrf-invoices\')">'+
        '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" style="margin-right:5px;vertical-align:-2px"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>'+
        'Invoices'+(overdueInv>0?'<span style="background:#c0392b;color:#fff;border-radius:9px;padding:1px 6px;font-size:10px;font-weight:700;margin-left:5px">'+overdueInv+' overdue</span>':'')+'</button>'+
      '<button class="btn btn-primary" onclick="navTo(\'hrf-pnl\')">'+
        '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" style="margin-right:5px;vertical-align:-2px"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>'+
        'P&amp;L Statement</button>');

    // ── TOP ROW: Revenue KPIs ──
    h+='<div style="font-size:10px;font-weight:700;color:var(--text-tertiary);text-transform:uppercase;letter-spacing:.1em;margin-bottom:10px;padding-top:4px">Revenue — '+curMonth+'</div>';
    h+='<div class="hrf-kpi-grid" style="grid-template-columns:repeat(4,1fr);margin-bottom:20px">';
    h+=hrfKpi('<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8"/><line x1="12" y1="6" x2="12" y2="18"/></svg>',
      'Net Revenue',hfsar(totRev),curMonth,'var(--fin-color)');
    h+=hrfKpi('<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></svg>',
      'Cash',hfsar(totCash),'POS cash','#10b981');
    h+=hrfKpi('<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="5" width="20" height="14" rx="2"/><circle cx="16" cy="13" r="2"/></svg>',
      'Card',hfsar(totCard),'MADA+VISA+AMEX','var(--info)');
    h+=hrfKpi('<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M12 5l7 7-7 7"/></svg>',
      'Delivery',hfsar(totDel),'Aggregators','#f97316');
    h+='</div>';

    // ── SECOND ROW: Profitability KPIs ──
    h+='<div style="font-size:10px;font-weight:700;color:var(--text-tertiary);text-transform:uppercase;letter-spacing:.1em;margin-bottom:10px">Profitability — '+curMonth+'</div>';
    h+='<div class="hrf-kpi-grid" style="grid-template-columns:repeat(4,1fr);margin-bottom:20px">';
    var gpColor=grossProfit>=0?'#00875a':'#c0392b';
    var npColor=netProfit>=0?'#00875a':'#c0392b';
    h+=hrfKpi('<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>',
      'Gross Profit',hfsar(grossProfit),'Margin: '+grossMargin.toFixed(1)+'%',gpColor);
    h+=hrfKpi('<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>',
      'Net Profit',hfsar(netProfit),'Margin: '+netMargin.toFixed(1)+'%',npColor);
    h+=hrfKpi('<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
      'Labour Cost',hfsar(totLabour),labourPct.toFixed(1)+'% of revenue','#a78bfa');
    h+=hrfKpi('<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/></svg>',
      'Food Cost',hfsar(totWaste),foodCostPct.toFixed(1)+'% of revenue',foodCostPct>10?'#c0392b':foodCostPct>5?'#b45309':'#00875a');
    h+='</div>';

    // ── THIRD ROW: Cost breakdown + Invoices alert ──
    h+='<div class="hrf-grid-2" style="margin-bottom:20px">';

    // Cost Breakdown Card
    h+='<div class="hrf-chart-card" style="padding:20px">';
    h+='<div style="font-size:13px;font-weight:700;margin-bottom:16px;display:flex;align-items:center;gap:8px">'+
      '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--fin-color)" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M21.21 15.89A10 10 0 1 1 8 2.83"/><path d="M22 12A10 10 0 0 0 12 2v10z"/></svg>'+
      'Cost Structure — '+curMonth+'</div>';
    var costItems=[
      {label:'Food Cost (COGS)',val:totWaste,pct:totRev>0?totWaste/totRev*100:0,col:'#c0392b'},
      {label:'Labour & GOSI',val:totLabour,pct:totRev>0?totLabour/totRev*100:0,col:'#a78bfa'},
      {label:'Fixed Opex',val:totFixed,pct:totRev>0?totFixed/totRev*100:0,col:'#f97316'},
      {label:'Petty Cash',val:totPC,pct:totRev>0?totPC/totRev*100:0,col:'#fbbf24'}
    ];
    costItems.forEach(function(ci){
      h+='<div style="margin-bottom:10px">'+
        '<div style="display:flex;justify-content:space-between;margin-bottom:4px">'+
          '<span style="font-size:12px;color:var(--text-secondary)">'+ci.label+'</span>'+
          '<span style="font-family:var(--mono);font-size:12px;color:var(--text-primary);font-weight:600">'+hfsar(ci.val)+' <span style="color:'+ci.col+';font-size:10px">('+ci.pct.toFixed(1)+'%)</span></span>'+
        '</div>'+
        '<div style="height:5px;background:var(--surface-3);border-radius:3px">'+
          '<div style="height:100%;width:'+Math.min(ci.pct,100)+'%;background:'+ci.col+';border-radius:3px;transition:width .4s ease"></div>'+
        '</div></div>';
    });
    h+='<div style="border-top:1px solid var(--border);margin-top:14px;padding-top:10px;display:flex;justify-content:space-between">'+
      '<span style="font-size:12px;font-weight:700;color:var(--text-primary)">Total Costs</span>'+
      '<span style="font-family:var(--mono);font-size:13px;font-weight:800;color:#c0392b">'+hfsar(totCosts)+'</span></div>';
    h+='</div>';

    // Revenue by Branch Card
    h+='<div class="hrf-chart-card" style="padding:20px">';
    h+='<div style="font-size:13px;font-weight:700;margin-bottom:16px;display:flex;align-items:center;gap:8px">'+
      '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--fin-color)" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/></svg>'+
      'Revenue by Branch — '+curMonth+'</div>';
    var maxRev=Math.max.apply(null,Object.values(revByBranch).concat([1]));
    var totalBrRev=Object.values(revByBranch).reduce(function(s,v){return s+v;},0)||1;
    Object.keys(revByBranch).sort(function(a,b){return revByBranch[b]-revByBranch[a];}).forEach(function(bn){
      var rev=revByBranch[bn];
      var barPct=Math.round(rev/maxRev*100);
      var sharePct=(rev/totalBrRev*100).toFixed(1);
      h+='<div style="margin-bottom:10px">'+
        '<div style="display:flex;justify-content:space-between;margin-bottom:4px">'+
          '<span style="font-size:12px;color:var(--text-secondary);font-weight:600">'+hxe(bn)+'</span>'+
          '<span style="font-family:var(--mono);font-size:12px;color:var(--fin-color);font-weight:600">'+hfsar(rev)+' <span style="color:var(--text-tertiary);font-size:10px">('+sharePct+'%)</span></span>'+
        '</div>'+
        '<div style="height:5px;background:var(--surface-3);border-radius:3px">'+
          '<div style="height:100%;width:'+barPct+'%;background:var(--fin-color);border-radius:3px;transition:width .4s ease"></div>'+
        '</div></div>';
    });
    if(!Object.keys(revByBranch).length)h+='<div style="text-align:center;color:var(--text-tertiary);font-size:12px;padding:20px">No revenue recorded this month</div>';
    h+='</div>';
    h+='</div>'; // end hrf-grid-2

    // ── CHART: 6-month Revenue vs Costs trend ──
    h+='<div class="hrf-grid-2" style="margin-bottom:20px">';
    h+='<div class="hrf-chart-card"><div style="font-size:13px;font-weight:700;margin-bottom:12px">Revenue vs Costs — YTD '+selYear+'</div><div style="height:220px"><canvas id="hrf-chart-rev-cost"></canvas></div></div>';
    h+='<div class="hrf-chart-card"><div style="font-size:13px;font-weight:700;margin-bottom:12px">Revenue Mix — '+curMonth+'</div><div style="height:220px"><canvas id="hrf-chart-cost-pie"></canvas></div></div>';
    h+='</div>';

    // ── Pending/Overdue Invoices ──
    var actionInv=allInv.filter(function(i){return i.status==='Overdue'||i.status==='Pending';}).sort(function(a,b){return (b.date||'').localeCompare(a.date||'');}).slice(0,8);
    if(actionInv.length){
      h+='<div class="hrf-section" style="border-left:3px solid #c0392b">';
      h+='<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">'+
        '<div style="font-size:13px;font-weight:700;display:flex;align-items:center;gap:8px">'+
          '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#c0392b" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>'+
          'Action Required — '+(pendInv+overdueInv)+' Invoices Pending/Overdue</div>'+
        '<button class="btn btn-sm" onclick="navTo(\'hrf-invoices\')">View All</button></div>';
      var invRows='';
      actionInv.forEach(function(inv){
        var sc=inv.status==='Overdue'?'#c0392b':'#b45309';
        invRows+='<tr><td><strong>'+hxe(inv.supplier||inv.vendor||'—')+'</strong></td><td>'+hxe(inv._branchName)+'</td>'+
          '<td style="font-family:var(--mono);color:var(--fin-color)">'+hfsar(inv.amount||inv.total||0)+'</td>'+
          '<td>'+hxe(inv.date||'—')+'</td><td>'+hrfBadge(inv.status,sc)+'</td></tr>';
      });
      h+=hrfTable(['Supplier','Branch','Amount','Date','Status'],invRows);
      h+='</div>';
    }

    // ── Quick links to modules ──
    h+='<div style="display:flex;flex-wrap:wrap;gap:10px;margin-top:8px;padding:16px;background:var(--surface-2);border-radius:12px;border:1px solid var(--border)">';
    var qlinks=[
      {icon:'📈',label:'P&L Statement',page:'hrf-pnl'},
      {icon:'💰',label:'Revenue',page:'hrf-revenue'},
      {icon:'💸',label:'Payroll',page:'hrf-payroll'},
      {icon:'🍽️',label:'Food Cost',page:'hrf-food-cost'},
      {icon:'🏛️',label:'Fixed Costs',page:'hrf-compliance'},
      {icon:'🛒',label:'Purchase Orders',page:'hrf-pos'},
      {icon:'📋',label:'Invoices',page:'hrf-invoices'},
      {icon:'📑',label:'DSR',page:'hrf-dsr'},
      {icon:'📄',label:'Finance Report',page:'hrf-fin-report'}
    ];
    qlinks.forEach(function(q){
      h+='<button class="btn" onclick="navTo(\''+q.page+'\')" style="font-size:12px;gap:6px;display:flex;align-items:center">'+q.icon+' '+q.label+'</button>';
    });
    h+='</div>';

    // Store for chart init
    NX._hrfRevByBranch=revByBranch;
    NX._hrfRevByMo=revByMo;
    NX._hrfCostsByMo=revByMo.map(function(_,i){return wasteByMo[i]+pcByMo[i];});
    NX._hrfCashCardDel=[totCash,totCard,totDel,Math.max(0,totRev-totCash-totCard-totDel)];
    NX._hrfSales=HRF.sales;

    var area=document.getElementById('page-area');
    if(area){area.innerHTML=h;setTimeout(function(){initPageCharts('hrf-fin-dash');},80);}
  }

  // Load all needed data in parallel
  var needLoad=0,doneLoad=0;
  function check(){doneLoad++;if(doneLoad>=needLoad)renderFinDash();}
  var hasSales=branches.every(function(b){return HRF.sales[b.id];});
  var hasPC=branches.every(function(b){return HRF.pc[b.id];});
  var hasInv=branches.every(function(b){return HRF.invoices[b.id];});
  var hasWaste=branches.every(function(b){return HRF.waste[b.id];});
  var hasStaff=branches.every(function(b){return HRF.staff[b.id];});
  var hasComp=!!HRF.compliance;
  if(!hasSales){needLoad++;hrfLoadAll('sales','sales',check);}
  if(!hasPC){needLoad++;hrfLoadAll('pc','pc',check);}
  if(!hasInv){needLoad++;hrfLoadAll('invoices','invoices',check);}
  if(!hasWaste){needLoad++;hrfLoadAll('waste','waste',check);}
  if(!hasStaff){needLoad++;hrfLoadAll('staff','staff',check);}
  if(!hasComp&&db){
    needLoad++;
    HRF.compliance={};
    var brs2=branches;var cloaded=0;
    brs2.forEach(function(b){db.ref('branches/'+b.id+'/compliance').once('value',function(snap){if(snap.val())HRF.compliance[b.id]=snap.val();if(++cloaded===brs2.length)check();});});
  }
  if(needLoad===0){setTimeout(renderFinDash,0);return hrfLoading('Refreshing\u2026');}
  return hrfLoading('Loading finance data\u2026');
}

// ── ALL EMPLOYEES ──
function pHrfEmployees(){
  var branches=hrfBranches();
  var filterBranch=NX._hrfBranch||'',filterDept=NX._hrfDept||'',filterQ=NX._hrfQ||'';
  function renderEmps(){
    var allStaff=[];
    branches.forEach(function(b){
      (HRF.staff[b.id]||[]).forEach(function(m){
        m._branchId=b.id;m._branchName=(NX_BRANCHES[b.id]||{}).name||b.id;
        allStaff.push(m);
      });
    });
    var filtered=allStaff.filter(function(m){
      if(filterBranch&&m._branchId!==filterBranch)return false;
      if(filterDept&&normalizeDept(m.dept||'')!==normalizeDept(filterDept))return false;
      if(filterQ){var q=filterQ.toLowerCase();if((m.name||'').toLowerCase().indexOf(q)<0&&(m.sap||'').toLowerCase().indexOf(q)<0)return false;}
      return true;
    });
    var depts=[''].concat(DEPTS);
    var brOpts='<option value="">All Branches</option>'+branches.map(function(b){return '<option value="'+hxe(b.id)+'"'+(filterBranch===b.id?' selected':'')+'>'+hxe(b.name)+'</option>';}).join('');
    var depOpts=depts.map(function(d){return '<option value="'+hxe(d)+'"'+(filterDept===d?' selected':'')+'>'+(d||'All Departments')+'</option>';}).join('');
    var INP='padding:7px 10px;background:var(--surface-2);border:1px solid var(--border);border-radius:8px;color:var(--text-primary);font-family:var(--font);font-size:13px;outline:none';
    var h=hrfHeader('Employee Directory',filtered.length+' of '+allStaff.length+' staff',
      '<button class="btn" onclick="openHrfBranchAccessMgr()">\uD83D\uDD11 Branch Access</button>'+
      '<button class="btn" onclick="hrfMigrateCompanyIds()" title="Fix 3rd party company names in existing records" style="background:rgba(91,33,182,.08);color:#5b21b6;border:1px solid rgba(91,33,182,.2)">🔧 Fix Companies</button>'+
      '<button class="btn" onclick="hrfExportEmployees()">&#x2B07; Export CSV</button>'+
      '<button class="btn" onclick="hrfOpenImportModal()">&#x2B06; Import CSV</button>'+
      '<button class="btn btn-primary" onclick="openHrfEmpModal(null,null)">+ Add Employee</button>'+
      '<button class="btn" style="background:rgba(0,102,102,.1);color:#006666;border:1px solid rgba(0,102,102,.2)" onclick="hrfSyncAllSapIndex()" title="Sync SAP numbers to branch schedule index">🔗 Sync SAP to Schedule</button>');
    // ── Search: uses id="hrf-emp-search" and filters in-place (no navTo on every keystroke) ──
    h+='<div style="display:flex;gap:8px;padding:12px 0;flex-wrap:wrap;border-bottom:1px solid var(--border);margin-bottom:16px">'+
      '<input id="hrf-emp-search" style="flex:1;min-width:200px;'+INP+'" placeholder="Search name or SAP\u2026" value="'+hxe(filterQ)+'">'+
      '<select id="hrf-emp-branch" style="'+INP+'">'+brOpts+'</select>'+
      '<select id="hrf-emp-dept" style="'+INP+'">'+depOpts+'</select></div>';
    var rows='';
    filtered.forEach(function(m){
      var stCol=(m.status||'Active')==='Active'?'#00875a':m.status==='On Leave'?'#b45309':'#c0392b';
      // Resolve 3rd party company name (use name not raw id)
      var sponsorCompanyName = '';
      if (m.workerType === '3rdparty' && m.companyId) {
        var matchedCo = HRF_COMPANIES.find(function(c){ return c.name === m.companyId || c.id === m.companyId; });
        sponsorCompanyName = matchedCo ? matchedCo.name : m.companyId;
      }
      var sponsorLabel=m.workerType==='3rdparty'?
        ('<span style="font-size:10px;color:#5b21b6;background:rgba(167,139,250,.12);padding:2px 7px;border-radius:10px;font-weight:600">'+hxe(sponsorCompanyName||'3rd Party')+'</span>'):
        '<span style="font-size:10px;color:#00875a;background:rgba(0,102,102,.1);padding:2px 7px;border-radius:10px;font-weight:600">ALFA</span>';
      rows+='<tr data-name="'+hxe((m.name||'').toLowerCase())+'" data-sap="'+hxe((m.sap||'').toLowerCase())+'" data-branch="'+hxe(m._branchId||'')+'" data-dept="'+hxe(m.dept||'')+'"><td><div style="display:flex;align-items:center;gap:10px"><div class="hrf-emp-avatar" style="width:32px;height:32px;font-size:11px">'+hini(m.name)+'</div>'+
        '<div><div style="font-weight:600;color:var(--text-primary)">'+hxe(m.name)+'</div>'+
        '<div style="font-size:11px;color:var(--text-tertiary)">'+hxe(m.sap||m.id||'\u2014')+'</div></div></div></td>'+
        '<td>'+hxe(m.dept||'\u2014')+'</td><td>'+hxe(m.role||'\u2014')+'</td>'+
        '<td><strong>'+hxe(m._branchName)+'</strong></td>'+
        '<td>'+hrfBadge(m.status||'Active',stCol)+'</td>'+
        '<td>'+sponsorLabel+'</td>'+
        '<td>'+hxe(m.phone||'\u2014')+'</td>'+
        '<td><div style="display:flex;gap:4px">'+
          '<button class="btn btn-sm" data-eid="'+hxe(m.id||'')+'" data-bid="'+hxe(m._branchId||'')+'" onclick="openHrfEmpModal(this.dataset.eid,this.dataset.bid)">Edit</button>'+
          '<button class="btn btn-sm" style="color:#5b21b6" data-eid="'+hxe(m.id||'')+'" data-bid="'+hxe(m._branchId||'')+'" onclick="openHrfReassignModal(this.dataset.eid,this.dataset.bid)">Move</button>'+
          '<button class="btn btn-sm" style="color:var(--danger)" data-eid="'+hxe(m.id||'')+'" data-bid="'+hxe(m._branchId||'')+'" onclick="hrfDeleteEmp(this.dataset.eid,this.dataset.bid)">Del</button>'+
        '</div></td></tr>';
    });
    if(!filtered.length)h+='<div class="empty-state"><div class="es-icon">&#x1F465;</div><h3>No staff found</h3><p>Try adjusting filters</p></div>';
    else h+=hrfTable(['Name','Dept','Role','Branch','Status','Sponsor','Phone','Actions'],rows,'hrf-emp-table');
    // Wire up in-place filtering AFTER render (no re-render on keystroke = no focus loss)
    setTimeout(function(){
      var si=document.getElementById('hrf-emp-search');
      var sb=document.getElementById('hrf-emp-branch');
      var sd=document.getElementById('hrf-emp-dept');
      function applyFilter(){
        NX._hrfQ=si?si.value:'';
        NX._hrfBranch=sb?sb.value:'';
        NX._hrfDept=sd?sd.value:'';
        // Filter table rows in-place without full page re-render
        var q=(NX._hrfQ||'').toLowerCase();
        var bd=NX._hrfBranch||'';
        var dd=NX._hrfDept||'';
        document.querySelectorAll('#hrf-emp-table tbody tr').forEach(function(row){
          var name=(row.dataset.name||'').toLowerCase();
          var sap=(row.dataset.sap||'').toLowerCase();
          var branch=row.dataset.branch||'';
          var dept=row.dataset.dept||'';
          var show=true;
          if(q&&name.indexOf(q)<0&&sap.indexOf(q)<0)show=false;
          if(bd&&branch!==bd)show=false;
          if(dd&&normalizeDept(dept)!==normalizeDept(dd))show=false;
          row.style.display=show?'':'none';
        });
      }
      if(si)si.addEventListener('input',applyFilter);
      if(sb)sb.addEventListener('change',applyFilter);
      if(sd)sd.addEventListener('change',applyFilter);
    },0);
    return h;
  }
  var cached=branches.filter(function(b){return HRF.staff[b.id];});
  if(cached.length===branches.length&&branches.length>0)return renderEmps();
  hrfLoadAll('staff','staff',function(){navTo('hrf-employees');});
  return hrfLoading('Loading staff\u2026');
}

function hrfSyncAllSapIndex() {
  if (!db) { showToast('Firebase not connected', 'error'); return; }
  var branches = hrfBranches();
  if (!branches.length) { showToast('No branches loaded', 'error'); return; }
  showToast('Syncing SAP index…');
  var done = 0;
  var total = branches.length;
  branches.forEach(function(b) {
    var hrArr = HRF.staff[b.id] || [];
    // Load branch schedule staff (object keyed by schedule ID)
    db.ref('branches/' + b.id + '/staff').once('value', function(snap) {
      var raw = snap.val();
      var nameToSchId = {};
      if (raw) {
        if (Array.isArray(raw)) {
          raw.forEach(function(m) { if (m && m.name) nameToSchId[m.name.toLowerCase().trim()] = String(m.id || ''); });
        } else {
          Object.keys(raw).forEach(function(sid) {
            var m = raw[sid];
            if (m && m.name) nameToSchId[m.name.toLowerCase().trim()] = sid;
          });
        }
      }
      // Build sapIndex from HR staff for this branch
      var sapIdx = {};
      hrArr.forEach(function(m) {
        var sap = String(m.sap || '').trim();
        if (!sap) return;
        var mNameNorm = String(m.name || '').toLowerCase().trim();
        var staffId = nameToSchId[mNameNorm] || '';
        // Try partial match if exact fails
        if (!staffId) {
          Object.keys(nameToSchId).forEach(function(schName) {
            if (staffId) return;
            var sParts = schName.split(' ').filter(Boolean);
            var mParts = mNameNorm.split(' ').filter(Boolean);
            if (mParts.length > 0 && sParts.length > 0 && mParts[0] === sParts[0] &&
                mParts[mParts.length-1] === sParts[sParts.length-1]) {
              staffId = nameToSchId[schName];
            }
          });
        }
        sapIdx[sap] = { staffId: staffId, name: m.name, dept: m.dept || '', branchId: b.id };
      });
      if (Object.keys(sapIdx).length > 0) {
        db.ref('branches/' + b.id + '/sapIndex').set(sapIdx);
        console.log('[HR Sync] branch', b.id, '(', b.name, ') sapIndex:', JSON.stringify(sapIdx));
      }
      done++;
      if (done === total) showToast('SAP index synced for ' + total + ' branches ✅', 'success');
    });
  });
}

// ── HR Employee Add/Edit Modal ──
// ── HR Managed Roles & Companies (stored in shared Firebase) ──
var HRF_ROLES = ['Restaurant Manager','Supervisor','Kitchen Manager','Assistant Kitchen Manager','Captain','Server','Host','Barista','Busser','Line Cook','Prep Cook','Dishwasher','Maintenance','Driver'];
var HRF_COMPANIES = []; // 3rd-party staffing companies

function hrfLoadRolesAndCompanies(cb){
  if(!db){if(cb)cb();return;}
  var done=0;
  function check(){done++;if(done>=3&&cb)cb();}
  db.ref('shared/hr_roles').once('value',function(snap){var v=snap.val();if(v&&v.length)HRF_ROLES=v;check();});
  db.ref('shared/hr_companies').once('value',function(snap){var v=snap.val();if(v)HRF_COMPANIES=Array.isArray(v)?v:Object.values(v);else HRF_COMPANIES=[];check();});
  // Also load managed departments so DEPTS stays in sync with Firebase
  db.ref('shared/departments').once('value',function(snap){
    var v=snap.val();
    if(v&&Array.isArray(v)&&v.length){
      DEPTS=v;
      // Rebuild normalizeDept aliases dynamically
      DEPTS.forEach(function(d){ if(d) _deptAliases[d.toLowerCase()]=d; });
    } else if(!v) {
      // Seed defaults on first run
      db.ref('shared/departments').set(DEPTS);
    }
    check();
  });
}

// ── Dept Aliases cache (updated when DEPTS changes) ──

function openHrfEmpModal(empId,branchId){
  hrfLoadRolesAndCompanies(function(){
    var m=null;
    if(empId&&branchId){var arr=HRF.staff[branchId]||[];m=arr.find(function(x){return x.id===empId;});}
    var branches=hrfBranches();
    var brOpts=branches.map(function(b){return '<option value="'+hxe(b.id)+'"'+(m&&m._branchId===b.id?' selected':(branchId===b.id?' selected':''))+'>'+hxe(b.name)+'</option>';}).join('');
    var deps=DEPTS; // ← use canonical DEPTS (shared with Branch Manager schedule)
    var depOpts=deps.map(function(d){return '<option'+(m&&m.dept===d?' selected':'')+'>'+d+'</option>';}).join('');
    var statuses=['Active','On Leave','Resigned','Terminated'];
    var stOpts=statuses.map(function(s){return '<option'+(m&&m.status===s?' selected':(!m&&s==='Active'?' selected':''))+'>'+s+'</option>';}).join('');
    var roleOpts='<option value="">— Select role —</option>'+HRF_ROLES.map(function(r){return '<option value="'+hxe(r)+'"'+(m&&m.role===r?' selected':'')+'>'+hxe(r)+'</option>';}).join('');
    var wType=m?m.workerType||'company':'company';
    var compOpts='<option value="">— None —</option>'+HRF_COMPANIES.map(function(c){return '<option value="'+hxe(c.name)+'"'+(m&&(m.companyId===c.name||m.companyId===c.id)?' selected':'')+'>'+hxe(c.name)+'</option>';}).join('');

    openModal(
      '<div class="modal-head"><h2>'+(m?'Edit Employee':'Add Employee')+'</h2>'+
      '<div style="display:flex;gap:8px">'+
        '<button class="btn btn-sm" onclick="openHrfRolesMgr()" title="Manage Roles">\u2699\uFE0F Roles</button>'+
        '<button class="btn btn-sm" onclick="openHrfDeptsMgr()" title="Manage Departments">\u2699\uFE0F Depts</button>'+
        '<button class="btn btn-sm" onclick="openHrfCompaniesMgr()" title="Manage Companies">\u2699\uFE0F Companies</button>'+
        '<button class="modal-close" onclick="closeModalForce()">\u2715</button>'+
      '</div></div>'+

      // Row 1: Name + SAP
      '<div class="form-row"><div class="bfg"><label class="form-label">Full Name *</label>'+
      '<input class="form-input" id="hrfemp-name" value="'+bxe(m?m.name||'':'')+'"></div>'+
      '<div class="bfg"><label class="form-label">SAP #</label>'+
      '<input class="form-input" id="hrfemp-sap" value="'+bxe(m?m.sap||'':'')+'"></div></div>'+

      // Row 2: Email + Phone
      '<div class="form-row"><div class="bfg"><label class="form-label">Email</label>'+
      '<input class="form-input" type="email" id="hrfemp-email" value="'+bxe(m?m.email||'':'')+'" placeholder="employee@example.com"></div>'+
      '<div class="bfg"><label class="form-label">Phone</label>'+
      '<input class="form-input" id="hrfemp-phone" value="'+bxe(m?m.phone||'':'')+'"></div></div>'+

      // Row 3: Branch + Dept
      '<div class="form-row"><div class="bfg"><label class="form-label">Branch *</label>'+
      '<select class="form-input form-select" id="hrfemp-branch">'+brOpts+'</select></div>'+
      '<div class="bfg"><label class="form-label">Department</label>'+
      '<select class="form-input form-select" id="hrfemp-dept">'+depOpts+'</select></div></div>'+

      // Row 4: Role (managed dropdown) + Status
      '<div class="form-row"><div class="bfg"><label class="form-label">Role / Position</label>'+
      '<select class="form-input form-select" id="hrfemp-role">'+roleOpts+'</select></div>'+
      '<div class="bfg"><label class="form-label">Status</label>'+
      '<select class="form-input form-select" id="hrfemp-status">'+stOpts+'</select></div></div>'+

      // Row 5: Worker Sponsor + Company
      '<div class="form-row">'+
        '<div class="bfg"><label class="form-label">Worker Sponsor</label>'+
        '<select class="form-input form-select" id="hrfemp-workertype" onchange="hrfToggleWorkerType(this.value)">'+
          '<option value="company"'+(wType==='company'?' selected':'')+'>Company Staff</option>'+
          '<option value="3rdparty"'+(wType==='3rdparty'?' selected':'')+'>3rd Party</option>'+
        '</select></div>'+
        '<div class="bfg" id="hrfemp-company-row" style="'+(wType==='3rdparty'?'':'visibility:hidden')+'"><label class="form-label">Staffing Company</label>'+
        '<select class="form-input form-select" id="hrfemp-company">'+compOpts+'</select></div>'+
      '</div>'+

      // Row 7: Nationality + Hire Date
      '<div class="form-row"><div class="bfg"><label class="form-label">Nationality</label>'+
      '<input class="form-input" id="hrfemp-nat" value="'+bxe(m?m.nationality||'':'')+'"></div>'+
      '<div class="bfg"><label class="form-label">Hire / Join Date</label>'+
      '<input class="form-input" type="date" id="hrfemp-hire" value="'+bxe(m?m.hireDate||m.joinDate||'':'')+'"></div></div>'+

      // Row 8: IQAMA + Expiry
      '<div class="form-row"><div class="bfg"><label class="form-label">IQAMA / ID Number</label>'+
      '<input class="form-input" id="hrfemp-iqama" value="'+bxe(m?m.iqama||'':'')+'"></div>'+
      '<div class="bfg"><label class="form-label">IQAMA Expiry</label>'+
      '<input class="form-input" type="date" id="hrfemp-iqama-exp" value="'+bxe(m?m.iqamaExpiry||'':'')+'"></div></div>'+

      // Row 9: Contract Type + Contract End Date
      '<div class="form-row"><div class="bfg"><label class="form-label">Contract Type</label>'+
      '<select class="form-input form-select" id="hrfemp-contract">'+
        ['Full-Time','Part-Time','Temporary','Probation','Fixed-Term','Freelance'].map(function(ct){return '<option value="'+ct+'"'+(m&&m.contractType===ct?' selected':'')+'>'+ct+'</option>';}).join('')+
      '</select></div>'+
      '<div class="bfg"><label class="form-label">Contract End Date</label>'+
      '<input class="form-input" type="date" id="hrfemp-contract-end" value="'+bxe(m?m.contractEndDate||'':'')+'"></div></div>'+

      // Row 10: Probation End + Default Shift
      '<div class="form-row"><div class="bfg"><label class="form-label">Probation End Date</label>'+
      '<input class="form-input" type="date" id="hrfemp-prob" value="'+bxe(m?m.probationEnd||'':'')+'"></div>'+
      '<div class="bfg"><label class="form-label">Default Shift</label>'+
      '<input class="form-input" id="hrfemp-shift" placeholder="e.g. 8 AM, 5 PM, OFF" value="'+bxe(m?m.shift||m.defaultShift||'':'')+'"></div></div>'+

      // ── SALARY SECTION ──
      '<div style="margin:16px 0 8px;padding:8px 12px;background:rgba(0,102,102,.06);border-left:3px solid var(--primary);border-radius:0 8px 8px 0;font-size:11px;font-weight:700;color:var(--primary);text-transform:uppercase;letter-spacing:.08em">💰 Salary & Compensation</div>'+

      // Row 11: Basic Salary + Housing Allowance
      '<div class="form-row"><div class="bfg"><label class="form-label">Basic Salary (SAR) *</label>'+
      '<input class="form-input" type="number" step="0.01" id="hrfemp-salary" value="'+(m?m.basicSalary||m.salary||'':'')+'"></div>'+
      '<div class="bfg"><label class="form-label">Housing Allowance (SAR)</label>'+
      '<input class="form-input" type="number" step="0.01" id="hrfemp-housing" value="'+(m?m.housingAllowance||'':'')+'"></div></div>'+

      // Row 12: Transport + Other Allowance
      '<div class="form-row"><div class="bfg"><label class="form-label">Transport Allowance (SAR)</label>'+
      '<input class="form-input" type="number" step="0.01" id="hrfemp-transport" value="'+(m?m.transportAllowance||'':'')+'"></div>'+
      '<div class="bfg"><label class="form-label">Other Allowances (SAR)</label>'+
      '<input class="form-input" type="number" step="0.01" id="hrfemp-other-allow" value="'+(m?m.otherAllowances||'':'')+'"></div></div>'+

      // Row 13: GOSI + Leave Balance
      '<div class="form-row"><div class="bfg"><label class="form-label">GOSI Enrolled</label>'+
      '<select class="form-input form-select" id="hrfemp-gosi">'+
        '<option value="yes"'+(m&&m.gosiEnrolled!=='no'?' selected':'')+'>Yes</option>'+
        '<option value="no"'+(m&&m.gosiEnrolled==='no'?' selected':'')+'>No</option>'+
      '</select></div>'+
      '<div class="bfg"><label class="form-label">Annual Leave Balance (days)</label>'+
      '<input class="form-input" type="number" id="hrfemp-leave-bal" value="'+(m?m.leaveBalance||m.annualLeave||21:'21')+'" min="0" max="365"></div></div>'+

      // ── BANK & EMERGENCY SECTION ──
      '<div style="margin:16px 0 8px;padding:8px 12px;background:rgba(0,102,102,.06);border-left:3px solid var(--primary);border-radius:0 8px 8px 0;font-size:11px;font-weight:700;color:var(--primary);text-transform:uppercase;letter-spacing:.08em">🏦 Bank & Emergency Contact</div>'+

      // Row 14: Bank Name + Account Number
      '<div class="form-row"><div class="bfg"><label class="form-label">Bank Name</label>'+
      '<input class="form-input" id="hrfemp-bank" value="'+bxe(m?m.bankName||'':'')+'"></div>'+
      '<div class="bfg"><label class="form-label">IBAN / Account No.</label>'+
      '<input class="form-input" id="hrfemp-iban" value="'+bxe(m?m.iban||'':'')+'"></div></div>'+

      // Row 15: Emergency Contact Name + Phone
      '<div class="form-row"><div class="bfg"><label class="form-label">Emergency Contact Name</label>'+
      '<input class="form-input" id="hrfemp-emg-name" value="'+bxe(m?m.emergencyName||'':'')+'"></div>'+
      '<div class="bfg"><label class="form-label">Emergency Contact Phone</label>'+
      '<input class="form-input" id="hrfemp-emg-phone" value="'+bxe(m?m.emergencyPhone||'':'')+'"></div></div>'+

      // Row 16: Notes
      '<div class="bfg"><label class="form-label">HR Notes</label>'+
      '<textarea class="form-input" id="hrfemp-notes" rows="2" style="resize:vertical" placeholder="Internal notes (not visible to staff)…">'+bxe(m?m.hrNotes||'':'')+'</textarea></div>'+

      '<button class="btn btn-primary" style="width:100%;margin-top:14px" data-eid="'+bxe(empId||'')+'" data-bid="'+bxe(branchId||'')+'" onclick="saveHrfEmp(this.dataset.eid,this.dataset.bid)">'+(m?'Save Changes':'Add Employee')+'</button>'
    );
  });
}

function hrfToggleWorkerType(type){
  var compRow=document.getElementById('hrfemp-company-row');
  if(compRow)compRow.style.visibility=type==='3rdparty'?'visible':'hidden';
}

function saveHrfEmp(empId,oldBranchId){
  var name=bgv('hrfemp-name'),branchId=bgv('hrfemp-branch');
  if(!name||!branchId){showToast('Name and Branch are required','error');return;}
  var wType=bgv('hrfemp-workertype')||'company';
  // Ensure stable id — same id used as schedule key
  var newId = empId || buid();
  var rec={
    id:newId,
    name:name,
    sap:bgv('hrfemp-sap'),
    email:bgv('hrfemp-email'),
    dept:normalizeDept(bgv('hrfemp-dept')),
    role:bgv('hrfemp-role'),
    status:bgv('hrfemp-status')||'Active',
    phone:bgv('hrfemp-phone'),
    nationality:bgv('hrfemp-nat'),
    basicSalary:parseFloat(bgv('hrfemp-salary'))||0,
    salary:parseFloat(bgv('hrfemp-salary'))||0,
    housingAllowance:parseFloat(bgv('hrfemp-housing'))||0,
    transportAllowance:parseFloat(bgv('hrfemp-transport'))||0,
    otherAllowances:parseFloat(bgv('hrfemp-other-allow'))||0,
    gosiEnrolled:bgv('hrfemp-gosi')||'yes',
    leaveBalance:parseInt(bgv('hrfemp-leave-bal'))||21,
    annualLeave:parseInt(bgv('hrfemp-leave-bal'))||21,
    hireDate:bgv('hrfemp-hire'),
    joinDate:bgv('hrfemp-hire'),
    iqama:bgv('hrfemp-iqama'),
    iqamaExpiry:bgv('hrfemp-iqama-exp'),
    contractType:bgv('hrfemp-contract')||'Full-Time',
    contractEndDate:bgv('hrfemp-contract-end'),
    probationEnd:bgv('hrfemp-prob'),
    shift:bgv('hrfemp-shift'),
    defaultShift:bgv('hrfemp-shift'),
    bankName:bgv('hrfemp-bank'),
    iban:bgv('hrfemp-iban'),
    emergencyName:bgv('hrfemp-emg-name'),
    emergencyPhone:bgv('hrfemp-emg-phone'),
    hrNotes:bgv('hrfemp-notes'),
    workerType:wType,
    companyId:wType==='3rdparty'?(bgv('hrfemp-company')||''):'',
    branchId:branchId
  };
  // ── Convert array to keyed-object (same format as bSaveColl) ──
  function toObj(arr) {
    var obj={};
    arr.forEach(function(item){
      if(!item)return;
      var k=String(item.id||'').replace(/[.#$\[\]\/]/g,'_')||'item_'+Math.random().toString(36).slice(2);
      obj[k]=item;
    });
    return obj;
  }
  if(!db){showToast('Firebase not connected','error');return;}
  if(empId&&oldBranchId&&oldBranchId!==branchId){
    var oldArr=(HRF.staff[oldBranchId]||[]).filter(function(x){return x.id!==empId;});
    db.ref('branches/'+oldBranchId+'/staff').set(toObj(oldArr),function(err){
      if(err){showToast('Move failed: '+err.message,'error');return;}
      var newArr=(HRF.staff[branchId]||[]).slice();newArr.push(rec);
      db.ref('branches/'+branchId+'/staff').set(toObj(newArr),function(e2){
        if(e2){showToast('Save failed: '+e2.message,'error');return;}
        HRF.staff[oldBranchId]=oldArr;HRF.staff[branchId]=newArr;
        _hrfWriteSapIndex(oldBranchId, oldArr);
        _hrfWriteSapIndex(branchId, newArr);
        closeModalForce();showToast('Employee moved & updated','success');navTo('hrf-employees');
      });
    });
  } else {
    var arr=(HRF.staff[branchId]||[]).slice();
    if(empId){var i=arr.findIndex(function(x){return x.id===empId;});if(i>=0)arr[i]=rec;else arr.push(rec);}
    else arr.push(rec);
    db.ref('branches/'+branchId+'/staff').set(toObj(arr),function(err){
      if(err){showToast('Save failed: '+err.message,'error');return;}
      HRF.staff[branchId]=arr;
      _hrfWriteSapIndex(branchId, arr);
      closeModalForce();showToast(empId?'Employee updated':'Employee added','success');navTo('hrf-employees');
    });
  }
}

// ── Managed Roles CRUD ──
function _hrfWriteSapIndex(branchId, hrStaffArr) {
  // Bridge HR staff (has SAP numbers) → Branch schedule staff (has numeric IDs from defStaff)
  // Reads branches/{branchId}/staff as OBJECT (keyed by numeric id from defStaff)
  // to find each person's schedule id, then writes sapIndex for the portal
  if (!db || !branchId) return;
  db.ref('branches/' + branchId + '/staff').once('value', function(snap) {
    var raw = snap.val();
    if (!raw) return;
    // Build name→scheduleId map from branch staff object
    var nameToSchId = {};
    if (Array.isArray(raw)) {
      // Branch manager saved as array — use array index+1 or item.id
      raw.forEach(function(m) {
        if (m && m.name) nameToSchId[m.name.toLowerCase().trim()] = String(m.id || '');
      });
    } else {
      // Branch manager saved as object keyed by id (defStaff format)
      Object.keys(raw).forEach(function(sid) {
        var m = raw[sid];
        if (m && m.name) nameToSchId[m.name.toLowerCase().trim()] = sid;
      });
    }
    // Now build sapIndex from HR staff array
    var sapIdx = {};
    var hrArr = Array.isArray(hrStaffArr) ? hrStaffArr : Object.values(hrStaffArr || {});
    hrArr.forEach(function(m) {
      var sap = String(m.sap || '').trim();
      if (!sap) return;
      var staffId = nameToSchId[String(m.name || '').toLowerCase().trim()] || '';
      sapIdx[sap] = { staffId: staffId, name: m.name, dept: m.dept, branchId: branchId };
    });
    if (Object.keys(sapIdx).length > 0) {
      db.ref('branches/' + branchId + '/sapIndex').set(sapIdx);
      console.log('[HR] sapIndex written for branch', branchId, ':', Object.keys(sapIdx).length, 'entries');
    }
  });
}

function openHrfRolesMgr(){
  var rows=HRF_ROLES.map(function(r,i){return '<tr><td style="font-weight:600">'+hxe(r)+'</td><td style="text-align:right;white-space:nowrap">'+
    '<button class="btn btn-sm" data-ri="'+i+'" onclick="renameHrfRole(parseInt(this.dataset.ri))">Edit</button> '+
    '<button class="btn btn-sm" style="color:var(--danger)" data-ri="'+i+'" onclick="deleteHrfRole(parseInt(this.dataset.ri))">Del</button></td></tr>';}).join('');
  openModal('<div class="modal-head"><h2>\u2699\uFE0F Manage Roles</h2><button class="modal-close" onclick="closeModalForce()">\u2715</button></div>'+
    '<div class="bfg"><label class="form-label">Add new role</label><div style="display:flex;gap:8px"><input class="form-input" id="hrf-role-new" placeholder="e.g. Shift Leader"><button class="btn btn-primary" onclick="addHrfRole()">+ Add</button></div></div>'+
    '<div class="btw" style="max-height:320px;overflow-y:auto;margin-top:10px"><table class="btbl"><thead><tr><th>Role</th><th></th></tr></thead><tbody>'+
    (rows||'<tr><td colspan="2" style="text-align:center;color:var(--text-tertiary);padding:14px">No roles defined</td></tr>')+
    '</tbody></table></div>');
}
function addHrfRole(){var v=bgv('hrf-role-new');if(!v){showToast('Enter a role name','error');return;}if(HRF_ROLES.indexOf(v)>=0){showToast('Already exists','error');return;}HRF_ROLES.push(v);db.ref('shared/hr_roles').set(HRF_ROLES);showToast('Role added','success');openHrfRolesMgr();}
function renameHrfRole(i){var v=prompt('Rename "'+HRF_ROLES[i]+'" to:',HRF_ROLES[i]);if(!v||v===HRF_ROLES[i])return;HRF_ROLES[i]=v;db.ref('shared/hr_roles').set(HRF_ROLES);showToast('Renamed','success');openHrfRolesMgr();}
function deleteHrfRole(i){if(!confirm('Delete role "'+HRF_ROLES[i]+'"?'))return;HRF_ROLES.splice(i,1);db.ref('shared/hr_roles').set(HRF_ROLES);showToast('Deleted','success');openHrfRolesMgr();}

// ── Managed Departments CRUD ──
// Stored at shared/departments — same array feeds DEPTS used by HR + Branch Manager schedule
function openHrfDeptsMgr(){
  var rows=DEPTS.map(function(d,i){
    var isCore=(i<3); // Management/Kitchen/FOH are core — warn before delete
    return '<tr>'+
      '<td style="font-weight:600;color:var(--text-primary)">'+hxe(d)+'</td>'+
      '<td style="text-align:right;white-space:nowrap">'+
        '<button class="btn btn-sm" data-di="'+i+'" onclick="renameHrfDept(parseInt(this.dataset.di))">Rename</button> '+
        '<button class="btn btn-sm" style="color:var(--danger)" data-di="'+i+'" data-core="'+(isCore?'1':'0')+'" onclick="deleteHrfDept(parseInt(this.dataset.di),this.dataset.core===\'1\')">Del</button>'+
      '</td></tr>';
  }).join('');
  openModal(
    '<div class="modal-head"><h2>\u2699\uFE0F Manage Departments</h2><button class="modal-close" onclick="closeModalForce()">\u2715</button></div>'+
    '<div style="font-size:11px;color:var(--text-tertiary);background:var(--surface-2);padding:9px 12px;border-radius:8px;margin-bottom:12px">'+
      'Departments are shared across HR and Branch Manager schedule. Changes apply everywhere instantly.'+
    '</div>'+
    '<div class="bfg"><label class="form-label">Add new department</label>'+
    '<div style="display:flex;gap:8px">'+
      '<input class="form-input" id="hrf-dept-new" placeholder="e.g. Bar, Delivery, Events\u2026">'+
      '<button class="btn btn-primary" onclick="addHrfDept()">+ Add</button>'+
    '</div></div>'+
    '<div class="btw" style="max-height:320px;overflow-y:auto;margin-top:12px">'+
    '<table class="btbl"><thead><tr><th>Department</th><th style="text-align:right">Actions</th></tr></thead>'+
    '<tbody>'+(rows||'<tr><td colspan="2" style="text-align:center;color:var(--text-tertiary);padding:14px">No departments</td></tr>')+'</tbody></table></div>'
  );
}
function _saveDepts(cb){
  if(!db)return;
  db.ref('shared/departments').set(DEPTS,function(){
    // Rebuild alias map
    DEPTS.forEach(function(d){ if(d) _deptAliases[d.toLowerCase()]=d; });
    if(cb)cb();
  });
}
function addHrfDept(){
  var v=bgv('hrf-dept-new').trim();
  if(!v){showToast('Enter a department name','error');return;}
  if(DEPTS.indexOf(v)>=0){showToast('Already exists','error');return;}
  DEPTS.push(v);
  _saveDepts(function(){showToast('Department added','success');openHrfDeptsMgr();_refreshDeptDropdown();});
}
function renameHrfDept(i){
  var v=prompt('Rename "'+DEPTS[i]+'" to:',DEPTS[i]);
  if(!v||v===DEPTS[i])return;
  var old=DEPTS[i];
  DEPTS[i]=v;
  _deptAliases[old.toLowerCase()]=v; // alias old → new for existing data
  _deptAliases[v.toLowerCase()]=v;
  _saveDepts(function(){showToast('Renamed','success');openHrfDeptsMgr();_refreshDeptDropdown();});
}
function deleteHrfDept(i,isCore){
  if(isCore&&!confirm('"'+DEPTS[i]+'" is a core department used by the schedule. Deleting it may affect existing staff grouping.\n\nContinue?'))return;
  if(!isCore&&!confirm('Delete "'+DEPTS[i]+'"?'))return;
  DEPTS.splice(i,1);
  _saveDepts(function(){showToast('Deleted','success');openHrfDeptsMgr();_refreshDeptDropdown();});
}
// Refresh the dept dropdown in the open employee modal (if visible)
function _refreshDeptDropdown(){
  var sel=document.getElementById('hrfemp-dept');
  if(!sel)return;
  var cur=sel.value;
  sel.innerHTML=DEPTS.map(function(d){return '<option value="'+hxe(d)+'"'+(d===cur?' selected':'')+'>'+hxe(d)+'</option>';}).join('');
}

// ── Managed Companies CRUD ──
function openHrfCompaniesMgr(){
  var rows=HRF_COMPANIES.map(function(c,i){return '<tr>'+
    '<td style="font-weight:600">'+hxe(c.name)+'</td>'+
    '<td style="color:var(--text-tertiary);font-size:11px">'+hxe(c.contact||'')+'</td>'+
    '<td style="text-align:right;white-space:nowrap">'+
      '<button class="btn btn-sm" data-ci="'+i+'" onclick="editHrfCompany(parseInt(this.dataset.ci))">Edit</button> '+
      '<button class="btn btn-sm" style="color:var(--danger)" data-ci="'+i+'" onclick="deleteHrfCompany(parseInt(this.dataset.ci))">Del</button>'+
    '</td></tr>';}).join('');
  openModal('<div class="modal-head"><h2>\u2699\uFE0F Staffing Companies</h2><button class="modal-close" onclick="closeModalForce()">\u2715</button></div>'+
    '<div style="font-size:11px;color:var(--text-tertiary);margin-bottom:10px">Companies used for 3rd party staffing assignments.</div>'+
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px">'+
      '<input class="form-input" id="hrf-co-name" placeholder="Company name *">'+
      '<input class="form-input" id="hrf-co-contact" placeholder="Contact person"></div>'+
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:12px">'+
      '<input class="form-input" id="hrf-co-phone" placeholder="Phone">'+
      '<input class="form-input" id="hrf-co-email" placeholder="Email"></div>'+
    '<button class="btn btn-primary" style="width:100%;margin-bottom:14px" onclick="addHrfCompany()">+ Add Company</button>'+
    '<table class="btbl"><thead><tr><th>Company</th><th>Contact</th><th></th></tr></thead><tbody>'+
    (rows||'<tr><td colspan="3" style="text-align:center;color:var(--text-tertiary);padding:14px">No companies added</td></tr>')+
    '</tbody></table>');
}
function addHrfCompany(){
  var name=bgv('hrf-co-name');if(!name){showToast('Company name required','error');return;}
  if(HRF_COMPANIES.find(function(c){return c.name===name;})){showToast('Already exists','error');return;}
  var co={id:buid(),name:name,contact:bgv('hrf-co-contact'),phone:bgv('hrf-co-phone'),email:bgv('hrf-co-email')};
  HRF_COMPANIES.push(co);
  db.ref('shared/hr_companies').set(HRF_COMPANIES,function(){
    showToast('Company added','success');
    openHrfCompaniesMgr();
    // If the employee modal's company dropdown is present in the DOM, refresh it
    // (it lives behind the companies manager modal)
    var sel=document.getElementById('hrfemp-company');
    if(sel){
      var currentVal=sel.value;
      sel.innerHTML='<option value="">— None —</option>'+HRF_COMPANIES.map(function(c){
        var id=c.id||c.name;
        return '<option value="'+hxe(id)+'"'+(currentVal===id?' selected':'')+'>'+hxe(c.name)+'</option>';
      }).join('');
    }
  });
}
function editHrfCompany(i){
  var c=HRF_COMPANIES[i];
  var name=prompt('Company name:',c.name);if(!name)return;
  var contact=prompt('Contact person:',c.contact||'');
  HRF_COMPANIES[i]=Object.assign({},c,{name:name,contact:contact||''});
  db.ref('shared/hr_companies').set(HRF_COMPANIES);showToast('Updated','success');openHrfCompaniesMgr();
}
function deleteHrfCompany(i){if(!confirm('Delete "'+HRF_COMPANIES[i].name+'"?'))return;HRF_COMPANIES.splice(i,1);db.ref('shared/hr_companies').set(HRF_COMPANIES);showToast('Deleted','success');openHrfCompaniesMgr();}

// ── Branch Add-Employee Access Control ──
// HR can grant/revoke per-branch permission to add staff
// Stored at admin/branchPermissions/{branchId}/canAddStaff
var HRF_BRANCH_PERMS = {};
function hrfLoadBranchPerms(cb){
  if(!db){if(cb)cb();return;}
  db.ref('admin/branchPermissions').once('value',function(snap){HRF_BRANCH_PERMS=snap.val()||{};if(cb)cb();});
}

// ── One-time migration: replace raw companyId keys with company names ──────
function hrfMigrateCompanyIds(){
  if(!db){showToast('Not connected','error');return;}
  if(!HRF_COMPANIES.length){showToast('Companies not loaded yet','error');return;}
  var branches=hrfBranches();
  var fixed=0,total=0;
  var pending=branches.length;
  if(!pending){showToast('No branches to migrate','info');return;}
  branches.forEach(function(b){
    db.ref('branches/'+b.id+'/staff').once('value',function(snap){
      var raw=snap.val();
      if(!raw){pending--;if(!pending)showToast('Migration done. Fixed '+fixed+' of '+total+' staff','success');return;}
      var arr=Array.isArray(raw)?raw.filter(Boolean):Object.values(raw).filter(Boolean);
      var changed=false;
      arr.forEach(function(m){
        if(!m||m.workerType!=='3rdparty'||!m.companyId)return;
        total++;
        // Check if companyId is already a name (exists in HRF_COMPANIES by name)
        var alreadyName=HRF_COMPANIES.find(function(c){return c.name===m.companyId;});
        if(alreadyName)return; // already correct
        // Find by id
        var byId=HRF_COMPANIES.find(function(c){return c.id===m.companyId;});
        if(byId){m.companyId=byId.name;fixed++;changed=true;}
      });
      if(changed){
        // Rebuild keyed object same as toObj
        var obj={};
        arr.forEach(function(item){
          if(!item)return;
          var k=String(item.id||'').replace(/[.#$\[\]\/]/g,'_')||'item_'+Math.random().toString(36).slice(2);
          obj[k]=item;
        });
        db.ref('branches/'+b.id+'/staff').set(obj);
        HRF.staff[b.id]=arr;
      }
      pending--;
      if(!pending){
        showToast('Migration done. Fixed '+fixed+'/'+total+' 3rd party staff','success');
        navTo('hrf-employees');
      }
    });
  });
}

function openHrfBranchAccessMgr(){
  hrfLoadBranchPerms(function(){
    var branches=hrfBranches();
    var rows=branches.map(function(b){
      var allowed=!!(HRF_BRANCH_PERMS[b.id]&&HRF_BRANCH_PERMS[b.id].canAddStaff);
      return '<tr><td style="font-weight:600">'+hxe(b.name)+'</td>'+
        '<td style="color:var(--text-tertiary);font-size:11px">'+hxe(b.brand||'')+'</td>'+
        '<td style="text-align:right">'+
          '<button class="btn btn-sm'+(allowed?' btn-primary':'')+'" data-bid="'+hxe(b.id)+'" data-allowed="'+(allowed?'1':'0')+'" onclick="hrfToggleBranchAccess(this.dataset.bid,this.dataset.allowed===\'1\')">'+
            (allowed?'\u2705 Can Add':'&#x1F512; Locked')+
          '</button>'+
        '</td></tr>';
    }).join('');
    openModal('<div class="modal-head"><h2>\uD83D\uDD11 Branch Staff Access</h2><button class="modal-close" onclick="closeModalForce()">\u2715</button></div>'+
      '<div style="font-size:12px;color:var(--text-secondary);background:var(--surface-2);padding:10px 14px;border-radius:8px;margin-bottom:14px">'+
        'When a branch has <strong>Can Add</strong> permission, its Branch Manager can add new staff members from the Staff page. Otherwise only HR can.'+
      '</div>'+
      '<table class="btbl"><thead><tr><th>Branch</th><th>Brand</th><th style="text-align:right">Add Staff</th></tr></thead><tbody>'+
      rows+'</tbody></table>');
  });
}
function hrfToggleBranchAccess(branchId,currentlyAllowed){
  if(!db)return;
  var newVal=!currentlyAllowed;
  db.ref('admin/branchPermissions/'+branchId+'/canAddStaff').set(newVal,function(err){
    if(err){showToast('Update failed','error');return;}
    if(!HRF_BRANCH_PERMS[branchId])HRF_BRANCH_PERMS[branchId]={};
    HRF_BRANCH_PERMS[branchId].canAddStaff=newVal;
    showToast((newVal?'Branch can now add staff':'Branch access revoked'),'success');
    openHrfBranchAccessMgr();
  });
}
function openHrfReassignModal(empId,fromBranchId){
  var arr=HRF.staff[fromBranchId]||[];
  var m=arr.find(function(x){return x.id===empId;});
  if(!m){showToast('Employee not found','error');return;}
  var branches=hrfBranches();
  var brOpts=branches.filter(function(b){return b.id!==fromBranchId;}).map(function(b){return '<option value="'+hxe(b.id)+'">'+hxe(b.name)+'</option>';}).join('');
  if(!brOpts){showToast('No other branches available','error');return;}
  openModal(
    '<div class="modal-head"><h2>Move '+hxe(m.name)+'</h2><button class="modal-close" onclick="closeModalForce()">\u2715</button></div>'+
    '<div style="font-size:12px;color:var(--text-secondary);margin-bottom:14px">Currently at: <strong>'+hxe((NX_BRANCHES[fromBranchId]||{}).name||fromBranchId)+'</strong></div>'+
    '<div class="bfg"><label class="form-label">Move to Branch *</label><select class="form-input form-select" id="hrfreas-branch">'+brOpts+'</select></div>'+
    '<button class="btn btn-primary" style="width:100%" data-eid="'+bxe(empId)+'" data-from="'+bxe(fromBranchId)+'" onclick="hrfDoReassign(this.dataset.eid,this.dataset.from)">Move Employee</button>'
  );
}
function hrfDoReassign(empId,fromBranchId){
  var toBranchId=bgv('hrfreas-branch');
  if(!toBranchId||!db)return;
  var oldArr=HRF.staff[fromBranchId]||[];
  var emp=oldArr.find(function(x){return x.id===empId;});
  if(!emp){showToast('Employee not found','error');return;}
  var newOldArr=oldArr.filter(function(x){return x.id!==empId;});
  emp.branchId=toBranchId;
  var newToArr=(HRF.staff[toBranchId]||[]).slice();
  newToArr.push(emp);
  function toObj(arr){var obj={};arr.forEach(function(item){if(!item)return;var k=String(item.id||'').replace(/[.#$\[\]\/]/g,'_')||'item_'+Math.random().toString(36).slice(2);obj[k]=item;});return obj;}
  db.ref('branches/'+fromBranchId+'/staff').set(toObj(newOldArr),function(e1){
    if(e1){showToast('Remove failed: '+e1.message,'error');return;}
    db.ref('branches/'+toBranchId+'/staff').set(toObj(newToArr),function(e2){
      if(e2){showToast('Add failed: '+e2.message,'error');return;}
      HRF.staff[fromBranchId]=newOldArr;HRF.staff[toBranchId]=newToArr;
      closeModalForce();showToast('Employee moved \u2713','success');navTo('hrf-employees');
    });
  });
}
function hrfDeleteEmp(empId,branchId){
  if(!confirm('Delete this employee permanently?\n\nThis removes them from the branch staff list.'))return;
  if(!db){showToast('Not connected','error');return;}
  // Try _key from cache first (set by hrfLoadAll), fallback to full Firebase scan
  var cached=(HRF.staff[branchId]||[]);
  var emp=cached.find(function(x){return String(x.id)===String(empId);});
  var fbKey=emp&&emp._key?emp._key:null;
  console.log('[DELETE] empId='+empId+' branchId='+branchId+' fbKey='+fbKey+' empFound='+(!!emp));
  function doDelete(key){
    if(key){
      // Targeted remove — only deletes this one record
      db.ref('branches/'+branchId+'/staff/'+key).remove(function(err){
        if(err){showToast('Delete failed: '+err.message,'error');return;}
        HRF.staff[branchId]=(HRF.staff[branchId]||[]).filter(function(x){return String(x.id)!==String(empId);});
        showToast('Employee deleted \u2713','success');navTo('hrf-employees');
      });
    } else {
      // Fallback: read full node from Firebase, find key, then remove
      db.ref('branches/'+branchId+'/staff').once('value',function(snap){
        var raw=snap.val();
        if(!raw){showToast('Staff not found in Firebase','error');return;}
        var foundKey=null;
        if(Array.isArray(raw)){
          var idx=raw.findIndex(function(x){return x&&String(x.id)===String(empId);});
          if(idx>=0){raw.splice(idx,1);db.ref('branches/'+branchId+'/staff').set(raw,function(e){if(e){showToast('Delete failed: '+e.message,'error');return;}HRF.staff[branchId]=(HRF.staff[branchId]||[]).filter(function(x){return String(x.id)!==String(empId);});showToast('Employee deleted \u2713','success');navTo('hrf-employees');});}
          else showToast('Employee not found','error');
        } else {
          Object.keys(raw).forEach(function(k){if(raw[k]&&String(raw[k].id)===String(empId))foundKey=k;});
          if(!foundKey){showToast('Employee not found','error');return;}
          db.ref('branches/'+branchId+'/staff/'+foundKey).remove(function(e){if(e){showToast('Delete failed: '+e.message,'error');return;}HRF.staff[branchId]=(HRF.staff[branchId]||[]).filter(function(x){return String(x.id)!==String(empId);});showToast('Employee deleted \u2713','success');navTo('hrf-employees');});
        }
      });
    }
  }
  doDelete(fbKey);
}

// ── ATTENDANCE ──
function pHrfAttendance(){
  var branches=hrfBranches();
  var now=new Date(new Date().getTime()+3*3600000);
  var curYear=now.getFullYear();
  var curMonth=now.getMonth()+1;
  var selMonth=NX._hrfAttMonth||(curYear+'-'+(curMonth<10?'0':'')+curMonth);
  var filterMode=NX._hrfAttFilter||'deductions'; // 'deductions' = absent+late only, 'all' = everyone

  function daysInMonth(ym){var p=ym.split('-');return new Date(parseInt(p[0]),parseInt(p[1]),0).getDate();}
  function dayLabel(ym,d){var p=ym.split('-');var day=new Date(parseInt(p[0]),parseInt(p[1]-1),d);return ['Su','Mo','Tu','We','Th','Fr','Sa'][day.getDay()];}

  function renderAtt(){
    var moLabel=(function(){var p=selMonth.split('-');var mn=['January','February','March','April','May','June','July','August','September','October','November','December'];return mn[parseInt(p[1])-1]+' '+p[0];})();
    var totalDays=daysInMonth(selMonth);
    var SC={present:'#0057ff',late:'#b45309',absent:'#c0392b',sick:'#b45309',holiday:'#5b21b6',dayoff:'#00875a'};
    var SLAB={present:'P',late:'L',absent:'A',sick:'S',holiday:'H',dayoff:'O'};

    // Collect all staff with their monthly data
    var empRows=[];
    branches.forEach(function(b){
      var staff=HRF.staff[b.id]||[],att=HRF.att[b.id]||{};
      var bname=(NX_BRANCHES[b.id]||{}).name||b.id;
      staff.forEach(function(m){
        var dayMap={};
        // att is now a proper keyed object {eid: {month:[records]}}
        // Try m.id directly, then SAP→eid via tsEmps, then name
        var resolvedId=null;
        if(att[String(m.id)]) {
          resolvedId=String(m.id);
        } else {
          // Build SAP→eid and name→eid maps from tsEmps
          var tsEmpsList2=HRF.tsEmps&&HRF.tsEmps[b.id]||{};
          var tsArr2=Array.isArray(tsEmpsList2)?tsEmpsList2:Object.values(tsEmpsList2);
          var mSap=String(m.sap||'').trim();
          var mNameN=(m.name||'').toLowerCase().trim();
          for(var ti=0;ti<tsArr2.length;ti++){
            var te=tsArr2[ti];if(!te)continue;
            if(mSap&&String(te.sap||'').trim()===mSap){resolvedId=String(te.id||'');break;}
          }
          if(!resolvedId){
            for(var ti2=0;ti2<tsArr2.length;ti2++){
              var te2=tsArr2[ti2];if(!te2)continue;
              if(te2.name&&te2.name.toLowerCase().trim()===mNameN){resolvedId=String(te2.id||'');break;}
            }
          }
          if(!resolvedId) resolvedId=String(m.id);
        }
        var empAtt=att[resolvedId]||{};
        var moRecs=empAtt[selMonth]||[];
        moRecs.forEach(function(r){
          if(!r.date)return;
          // Normalize: staff.html saves as r.st, HR expects r.status
          if(r.st&&!r.status) r.status=r.st;
          dayMap[r.date.slice(-2)]=r;
        });
        // Also check flat day keys under att[YYYY-MM][empId]
        var dayKeys=att[selMonth]||{};
        var flatRec=dayKeys[String(m.id)]||dayKeys[m.name];
        if(flatRec&&flatRec.status){var dd=selMonth+'-01';dayMap['01']=flatRec;}

        // Overlay approved sick/leave records from tsLeaves
        var empLeaves=HRF.leaves[b.id]||[];
        empLeaves.forEach(function(lv){
          if((lv.status||'pending')!=='approved')return;
          if(String(lv.empId||lv.employeeId)!==String(m.id)&&(lv.empName||lv.name||'')!==m.name)return;
          var lvType=(lv.type||'').toLowerCase();
          var lvSt=lvType.indexOf('sick')>=0?'sick':'dayoff';
          // Fill each day of the leave range
          var from=lv.from||lv.startDate||'';
          var to=lv.to||lv.endDate||from;
          if(!from||from.slice(0,7)!==selMonth)return;
          var cur=new Date(from);
          var end=new Date(to);
          while(cur<=end){
            var ds2=String(cur.getDate()<10?'0'+cur.getDate():cur.getDate());
            if(!dayMap[ds2]){dayMap[ds2]={date:selMonth+'-'+ds2,status:lvSt,_fromLeave:true};}
            cur.setDate(cur.getDate()+1);
          }
        });
        var totP=0,totL=0,totA=0,totAbsent=0,totSick=0,totHol=0,totOff=0;
        for(var di=1;di<=totalDays;di++){
          var ds=String(di<10?'0'+di:di);
          var r=dayMap[ds];
          var st=r?r.status:'';
          if(st==='present')totP++;
          else if(st==='late')totL++;
          else if(st==='absent')totAbsent++;
          else if(st==='sick')totSick++;
          else if(st==='holiday')totHol++;
          else if(st==='dayoff')totOff++;
        }
        var totalRecorded=totP+totL+totAbsent+totSick+totHol+totOff;
        var deductDays=totAbsent+totL; // days to potentially deduct
        empRows.push({m:m,bname:bname,branchId:b.id,dayMap:dayMap,totP:totP,totL:totL,totAbsent:totAbsent,totSick:totSick,totHol:totHol,totOff:totOff,totalRecorded:totalRecorded,deductDays:deductDays});
      });
    });

    // Summary totals
    var grandP=0,grandL=0,grandA=0,grandS=0,grandOff=0;
    empRows.forEach(function(r){grandP+=r.totP;grandL+=r.totL;grandA+=r.totAbsent;grandS+=r.totSick;grandOff+=r.totOff+r.totHol;});
    var deductionList=empRows.filter(function(r){return r.totAbsent>0||r.totL>0;});

    var INP='padding:7px 10px;background:var(--surface-2);border:1px solid var(--border);border-radius:8px;color:var(--text-primary);font-family:var(--font);font-size:13px;outline:none';

    // Build month picker options (last 12 months)
    var moOpts='';
    for(var mi=0;mi<12;mi++){
      var d2=new Date(curYear,curMonth-1-mi,1);
      var ym=d2.getFullYear()+'-'+(d2.getMonth()+1<10?'0':'')+(d2.getMonth()+1);
      var lbl=['January','February','March','April','May','June','July','August','September','October','November','December'][d2.getMonth()]+' '+d2.getFullYear();
      moOpts+='<option value="'+ym+'"'+(ym===selMonth?' selected':'')+'>'+lbl+'</option>';
    }
    var h=hrfHeader('Attendance \u2014 Monthly Report',moLabel+' \u00b7 All branches',
      '<select style="'+INP+'" onchange="NX._hrfAttMonth=this.value;navTo(\'hrf-attendance\')">'+moOpts+'</select>');

    // KPI row
    h+='<div class="hrf-kpi-grid" style="grid-template-columns:repeat(5,1fr);margin-bottom:20px">';
    h+=hrfKpi('\u2705','Present',grandP,'Days worked','#0057ff');
    h+=hrfKpi('\u23f0','Late',grandL,'Late arrivals','#b45309');
    h+=hrfKpi('\u274c','Absent',grandA,'Unexcused absent','#c0392b');
    h+=hrfKpi('\ud83e\udd12','Sick Leave',grandS,'Medical leave','#b45309');
    h+=hrfKpi('\ud83d\udcb8','For Deduction',deductionList.length,'Staff with cuts','#e879f9');
    h+='</div>';

    // ── EMPLOYEE STATUS LISTS (Absent / Late / Sick) ──
    var absentList=empRows.filter(function(r){return r.totAbsent>0;});
    var lateList=empRows.filter(function(r){return r.totL>0;});
    var sickList=empRows.filter(function(r){return r.totSick>0;});
    if(absentList.length||lateList.length||sickList.length){
      h+='<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:14px;margin-bottom:20px">';
      // Absent
      if(absentList.length){
        h+='<div style="background:rgba(248,113,113,.07);border:1px solid rgba(248,113,113,.25);border-radius:12px;padding:14px">';
        h+='<div style="font-size:11px;font-weight:700;color:#c0392b;text-transform:uppercase;letter-spacing:.1em;margin-bottom:10px">❌ Absent ('+absentList.length+' staff)</div>';
        absentList.forEach(function(row){
          h+='<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 8px;background:rgba(248,113,113,.05);border-radius:7px;margin-bottom:5px">';
          h+='<div><div style="font-weight:600;font-size:12px;color:var(--text-primary)">'+hxe(row.m.name)+'</div><div style="font-size:10px;color:var(--text-tertiary)">'+hxe(row.bname)+'</div></div>';
          h+='<span style="background:rgba(248,113,113,.2);color:#c0392b;font-family:var(--mono);font-weight:700;font-size:12px;border-radius:5px;padding:2px 8px">'+row.totAbsent+'d</span>';
          h+='</div>';
        });
        h+='</div>';
      }
      // Late
      if(lateList.length){
        h+='<div style="background:rgba(255,209,102,.07);border:1px solid rgba(255,209,102,.25);border-radius:12px;padding:14px">';
        h+='<div style="font-size:11px;font-weight:700;color:#b45309;text-transform:uppercase;letter-spacing:.1em;margin-bottom:10px">⏰ Late ('+lateList.length+' staff)</div>';
        lateList.forEach(function(row){
          h+='<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 8px;background:rgba(255,209,102,.05);border-radius:7px;margin-bottom:5px">';
          h+='<div><div style="font-weight:600;font-size:12px;color:var(--text-primary)">'+hxe(row.m.name)+'</div><div style="font-size:10px;color:var(--text-tertiary)">'+hxe(row.bname)+'</div></div>';
          h+='<span style="background:rgba(255,209,102,.2);color:#b45309;font-family:var(--mono);font-weight:700;font-size:12px;border-radius:5px;padding:2px 8px">'+row.totL+'d</span>';
          h+='</div>';
        });
        h+='</div>';
      }
      // Sick
      if(sickList.length){
        h+='<div style="background:rgba(249,115,22,.07);border:1px solid rgba(249,115,22,.25);border-radius:12px;padding:14px">';
        h+='<div style="font-size:11px;font-weight:700;color:#b45309;text-transform:uppercase;letter-spacing:.1em;margin-bottom:10px">🤒 Sick Leave ('+sickList.length+' staff)</div>';
        sickList.forEach(function(row){
          h+='<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 8px;background:rgba(249,115,22,.05);border-radius:7px;margin-bottom:5px">';
          h+='<div><div style="font-weight:600;font-size:12px;color:var(--text-primary)">'+hxe(row.m.name)+'</div><div style="font-size:10px;color:var(--text-tertiary)">'+hxe(row.bname)+'</div></div>';
          h+='<span style="background:rgba(249,115,22,.2);color:#b45309;font-family:var(--mono);font-weight:700;font-size:12px;border-radius:5px;padding:2px 8px">'+row.totSick+'d</span>';
          h+='</div>';
        });
        h+='</div>';
      }
      h+='</div>';
    }

    // View toggle tabs
    h+='<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;flex-wrap:wrap;gap:10px">';
    h+='<div class="hrf-tab-bar" style="margin-bottom:0">';
    h+='<button class="hrf-tab-btn hr-tab'+(filterMode==='deductions'?' active':'')+'" onclick="NX._hrfAttFilter=\'deductions\';navTo(\'hrf-attendance\')">&#x1F4B8; Deductions Only ('+deductionList.length+')</button>';
    h+='<button class="hrf-tab-btn hr-tab'+(filterMode==='all'?' active':'')+'" onclick="NX._hrfAttFilter=\'all\';navTo(\'hrf-attendance\')">&#x1F4CB; All Staff ('+empRows.length+')</button>';
    h+='</div>';

    // Send to Finance button
    if(filterMode==='deductions'&&deductionList.length>0){
      h+='<button class="btn btn-primary" style="background:linear-gradient(135deg,#7c3aed,#a855f7);border-color:#5b21b6" onclick="hrfSendPayrollToFinance(\''+hxe(selMonth)+'\',\''+hxe(moLabel)+'\')">&#x1F4E4; Send to Finance</button>';
    }
    h+='</div>';

    var displayRows=filterMode==='deductions'?deductionList:empRows;

    if(!displayRows.length){
      h+='<div class="empty-state"><div class="es-icon">'+(filterMode==='deductions'?'\u2705':'\ud83d\udcc5')+'</div><h3>'+(filterMode==='deductions'?'No deductions this month \u2014 all staff present!':'No attendance data for '+moLabel)+'</h3></div>';
      return h;
    }

    // ── DEDUCTIONS VIEW: clean payroll-cut table ──
    if(filterMode==='deductions'){
      h+='<div style="background:rgba(248,113,113,.06);border:1px solid rgba(248,113,113,.2);border-radius:12px;padding:16px;margin-bottom:16px">';
      h+='<div style="font-size:11px;font-weight:700;color:#c0392b;text-transform:uppercase;letter-spacing:.1em;margin-bottom:10px">&#x26A0;&#xFE0F; Payroll Deduction Summary \u2014 '+hxe(moLabel)+'</div>';
      h+='<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:12px">';
      h+='<thead><tr style="background:rgba(248,113,113,.1)">';
      ['#','Employee','Department','Branch','Absent Days','Late Days','Total Days to Review','Salary (if set)','Deduction Basis'].forEach(function(col,i){
        h+='<th style="padding:9px 10px;text-align:'+(i>3?'center':'left')+';font-size:10px;text-transform:uppercase;letter-spacing:.07em;color:var(--text-secondary);border-bottom:1px solid rgba(248,113,113,.2);white-space:nowrap">'+col+'</th>';
      });
      h+='</tr></thead><tbody>';
      deductionList.forEach(function(row,idx){
        var salary=row.m.salary||row.m.basicSalary||0;
        var perDay=salary?Math.round(salary/30):0;
        var deductAmt=perDay?(row.totAbsent+row.totL)*perDay:0;
        var evenRow=idx%2===0;
        h+='<tr style="background:'+(evenRow?'transparent':'rgba(248,113,113,.03)')+';transition:background .15s" onmouseover="this.style.background=\'rgba(248,113,113,.08)\'" onmouseout="this.style.background=\''+(evenRow?'transparent':'rgba(248,113,113,.03)')+'\'">'+
          '<td style="padding:9px 10px;color:var(--text-tertiary);font-size:11px">'+( idx+1)+'</td>'+
          '<td style="padding:9px 10px"><strong style="color:var(--text-primary)">'+hxe(row.m.name)+'</strong></td>'+
          '<td style="padding:9px 10px;color:var(--text-secondary)">'+hxe(row.m.dept||'\u2014')+'</td>'+
          '<td style="padding:9px 10px;color:var(--text-secondary)">'+hxe(row.bname)+'</td>'+
          '<td style="padding:9px 10px;text-align:center">'+(row.totAbsent>0?'<span style="display:inline-flex;align-items:center;justify-content:center;background:rgba(248,113,113,.15);color:#c0392b;font-family:var(--mono);font-weight:700;font-size:13px;border-radius:6px;min-width:28px;height:26px;padding:0 6px">'+row.totAbsent+'</span>':'<span style="color:var(--text-tertiary)">\u2014</span>')+'</td>'+
          '<td style="padding:9px 10px;text-align:center">'+(row.totL>0?'<span style="display:inline-flex;align-items:center;justify-content:center;background:rgba(255,209,102,.15);color:#b45309;font-family:var(--mono);font-weight:700;font-size:13px;border-radius:6px;min-width:28px;height:26px;padding:0 6px">'+row.totL+'</span>':'<span style="color:var(--text-tertiary)">\u2014</span>')+'</td>'+
          '<td style="padding:9px 10px;text-align:center"><span style="display:inline-flex;align-items:center;justify-content:center;background:rgba(232,121,249,.12);color:#e879f9;font-family:var(--mono);font-weight:700;font-size:14px;border-radius:6px;min-width:28px;height:26px;padding:0 8px">'+(row.totAbsent+row.totL)+'</span></td>'+
          '<td style="padding:9px 10px;text-align:center;font-family:var(--mono);color:var(--payroll-color);font-size:12px">'+(salary?hfsar(salary):'\u2014')+'</td>'+
          '<td style="padding:9px 10px;text-align:center">'+(deductAmt?'<span style="color:#c0392b;font-family:var(--mono);font-weight:700">-'+hfsar(deductAmt)+'</span>':'<span style="color:var(--text-tertiary);font-size:11px">Review needed</span>')+'</td>'+
          '</tr>';
      });
      h+='</tbody></table></div>';
      h+='<div style="margin-top:10px;font-size:11px;color:var(--text-tertiary)">&#x2139;&#xFE0F; Deduction amounts are estimates based on salary \u00f7 30 per day. Final payroll amounts must be confirmed by HR before sending to Finance.</div>';
      h+='</div>';

      // HR Approval + send section
      h+='<div style="background:var(--surface-2);border:1px solid var(--border);border-radius:12px;padding:16px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px">';
      h+='<div><div style="font-weight:700;color:var(--text-primary);margin-bottom:3px">Ready for Payroll Processing?</div><div style="font-size:12px;color:var(--text-tertiary)">Review the deductions above, then send to Finance to process salary deposits.</div></div>';
      h+='<div style="display:flex;gap:8px">';
      h+='<button class="btn" onclick="hrfPrintPayrollReport(\''+hxe(selMonth)+'\',\''+hxe(moLabel)+'\')" style="gap:6px">&#x1F5A8;&#xFE0F; Print Report</button>';
      h+='<button class="btn btn-primary" style="background:linear-gradient(135deg,#7c3aed,#a855f7);border-color:#5b21b6;gap:6px" onclick="hrfSendPayrollToFinance(\''+hxe(selMonth)+'\',\''+hxe(moLabel)+'\')">&#x1F4E4; Send to Finance</button>';
      h+='</div></div>';
      return h;
    }

    // ── ALL STAFF VIEW: monthly calendar grid ──
    // Header row with day numbers
    var colW=Math.max(22,Math.floor(480/totalDays));
    h+='<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:11px;min-width:700px">';
    h+='<thead><tr style="background:var(--surface-2)">';
    h+='<th style="padding:9px 12px;text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:.07em;color:var(--text-tertiary);border-bottom:1px solid var(--border);white-space:nowrap;min-width:140px">Employee</th>';
    h+='<th style="padding:9px 8px;text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:.07em;color:var(--text-tertiary);border-bottom:1px solid var(--border);white-space:nowrap">Branch</th>';
    for(var di=1;di<=totalDays;di++){
      var ds=String(di<10?'0'+di:di);
      var dl=dayLabel(selMonth,di);
      var isWknd=(dl==='Fr'||dl==='Sa');
      h+='<th style="padding:5px 2px;text-align:center;font-size:9px;color:'+(isWknd?'var(--text-secondary)':'var(--text-tertiary)')+';border-bottom:1px solid var(--border);width:'+colW+'px;min-width:'+colW+'px">'+
        '<div style="font-weight:700;line-height:1.1">'+di+'</div><div style="font-size:8px;opacity:.7">'+dl+'</div></th>';
    }
    h+='<th style="padding:9px 6px;text-align:center;font-size:10px;text-transform:uppercase;letter-spacing:.07em;color:#0057ff;border-bottom:1px solid var(--border);white-space:nowrap">P</th>';
    h+='<th style="padding:9px 6px;text-align:center;font-size:10px;text-transform:uppercase;letter-spacing:.07em;color:#b45309;border-bottom:1px solid var(--border);white-space:nowrap">L</th>';
    h+='<th style="padding:9px 6px;text-align:center;font-size:10px;text-transform:uppercase;letter-spacing:.07em;color:#c0392b;border-bottom:1px solid var(--border);white-space:nowrap">A</th>';
    h+='</tr></thead><tbody>';

    displayRows.forEach(function(row,idx){
      var evenRow=idx%2===0;
      h+='<tr style="background:'+(evenRow?'transparent':'rgba(255,255,255,.02)')+'" onmouseover="this.style.background=\'rgba(255,255,255,.05)\'" onmouseout="this.style.background=\''+(evenRow?'transparent':'rgba(255,255,255,.02)')+'\'">'+
        '<td style="padding:7px 12px;border-bottom:1px solid var(--border)"><div style="font-weight:600;color:var(--text-primary);white-space:nowrap">'+hxe(row.m.name)+'</div><div style="font-size:9px;color:var(--text-tertiary)">'+hxe(row.m.dept||'')+'</div></td>'+
        '<td style="padding:7px 8px;border-bottom:1px solid var(--border);font-size:10px;color:var(--text-secondary);white-space:nowrap">'+hxe(row.bname)+'</td>';
      for(var di=1;di<=totalDays;di++){
        var ds=String(di<10?'0'+di:di);
        var r=row.dayMap[ds];
        var st=r?r.status:'';
        var dl2=dayLabel(selMonth,di);
        var isWknd2=(dl2==='Fr'||dl2==='Sa');
        var cellBg=isWknd2?'rgba(255,255,255,.03)':'transparent';
        if(st){var col=SC[st]||'#94a3b8';var lbl=SLAB[st]||'?';
          h+='<td style="padding:3px 2px;text-align:center;border-bottom:1px solid var(--border);background:'+cellBg+'"><span style="display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;border-radius:4px;background:'+col+'22;color:'+col+';font-size:9px;font-weight:800">'+lbl+'</span></td>';
        }else{
          h+='<td style="padding:3px 2px;text-align:center;border-bottom:1px solid var(--border);background:'+cellBg+';color:var(--text-tertiary);font-size:9px">\u2013</td>';
        }
      }
      h+='<td style="padding:7px 6px;text-align:center;border-bottom:1px solid var(--border);font-family:var(--mono);color:#0057ff;font-weight:700;font-size:11px">'+row.totP+'</td>';
      h+='<td style="padding:7px 6px;text-align:center;border-bottom:1px solid var(--border);font-family:var(--mono);color:#b45309;font-weight:700;font-size:11px">'+(row.totL||'\u2014')+'</td>';
      h+='<td style="padding:7px 6px;text-align:center;border-bottom:1px solid var(--border);font-family:var(--mono);color:#c0392b;font-weight:700;font-size:11px">'+(row.totAbsent||'\u2014')+'</td>';
      h+='</tr>';
    });
    h+='</tbody></table></div>';
    h+='<div style="margin-top:10px;display:flex;gap:12px;flex-wrap:wrap;font-size:11px;color:var(--text-tertiary)">';
    [{l:'P = Present',c:'#0057ff'},{l:'L = Late',c:'#b45309'},{l:'A = Absent',c:'#c0392b'},{l:'S = Sick',c:'#b45309'},{l:'H = Holiday',c:'#5b21b6'},{l:'D = OFF',c:'#00875a'}].forEach(function(x){
      h+='<span style="display:inline-flex;align-items:center;gap:4px"><span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:'+x.c+'44;border:1px solid '+x.c+'66"></span>'+x.l+'</span>';
    });
    h+='</div>';
    return h;
  }

  var cSt=branches.filter(function(b){return HRF.staff[b.id];}).length;
  var cAt=branches.filter(function(b){return HRF.att[b.id];}).length;
  if(cSt===branches.length&&cAt===branches.length)return renderAtt();
  var done=0;function check(){done++;if(done>=2)navTo('hrf-attendance');}
  if(cSt<branches.length)hrfLoadAll('staff','staff',check);else check();
  if(cAt<branches.length)hrfLoadAll('tsAtt','att',function(){hrfLoadAll('tsEmps','tsEmps',function(){branches.forEach(function(b){b._attNameMap=null;b._attSapMap=null;});check();});});else check();
  return hrfLoading('Loading attendance\u2026');
}

function hrfSendPayrollToFinance(month,moLabel){
  var branches=hrfBranches();
  var deductions=[];
  branches.forEach(function(b){
    var staff=HRF.staff[b.id]||[],att=HRF.att[b.id]||{};
    var bname=(NX_BRANCHES[b.id]||{}).name||b.id;
    staff.forEach(function(m){
      var _rid1=String(m.id);
      if(!att[_rid1]){
        var _te1=HRF.tsEmps&&HRF.tsEmps[b.id]||{};
        var _ta1=Array.isArray(_te1)?_te1:Object.values(_te1);
        var _ms1=String(m.sap||'').trim(),_mn1=(m.name||'').toLowerCase().trim();
        for(var _i1=0;_i1<_ta1.length;_i1++){var _e1=_ta1[_i1];if(!_e1)continue;if(_ms1&&String(_e1.sap||'').trim()===_ms1){_rid1=String(_e1.id||'');break;}if(!_ms1&&_e1.name&&_e1.name.toLowerCase().trim()===_mn1){_rid1=String(_e1.id||'');}}
      }
      var empAtt=att[_rid1]||{};
      var moRecs=empAtt[month]||[];
      var totL=0,totA=0;
      moRecs.forEach(function(r){var st=r.status||r.st||'';if(st==='absent')totA++;else if(st==='late')totL++;});
      if(totA>0||totL>0)deductions.push({name:m.name,dept:m.dept||'',branch:bname,absent:totA,late:totL,salary:m.salary||m.basicSalary||0});
    });
  });
  var payload={month:month,label:moLabel,submittedBy:NX.session&&NX.session.userName||'HR',submittedAt:new Date().toISOString(),deductions:deductions,status:'pending_finance'};
  var db=firebase.database();
  db.ref('admin/payrollReports/'+month).set(payload).then(function(){
    showToast('\u2705 Payroll report sent to Finance for '+moLabel,'success');
  }).catch(function(e){showToast('Error: '+e.message,'error');});
}

function hrfPrintPayrollReport(month,moLabel){
  var branches=hrfBranches();
  var deductions=[];
  branches.forEach(function(b){
    var staff=HRF.staff[b.id]||[],att=HRF.att[b.id]||{};
    var bname=(NX_BRANCHES[b.id]||{}).name||b.id;
    staff.forEach(function(m){
      var _rid2=String(m.id);
      if(!att[_rid2]){
        var _te2=HRF.tsEmps&&HRF.tsEmps[b.id]||{};
        var _ta2=Array.isArray(_te2)?_te2:Object.values(_te2);
        var _ms2=String(m.sap||'').trim(),_mn2=(m.name||'').toLowerCase().trim();
        for(var _i2=0;_i2<_ta2.length;_i2++){var _e2=_ta2[_i2];if(!_e2)continue;if(_ms2&&String(_e2.sap||'').trim()===_ms2){_rid2=String(_e2.id||'');break;}if(!_ms2&&_e2.name&&_e2.name.toLowerCase().trim()===_mn2){_rid2=String(_e2.id||'');}}
      }
      var empAtt=att[_rid2]||{};
      var moRecs=empAtt[month]||[];
      var totL=0,totA=0;
      moRecs.forEach(function(r){var st=r.status||r.st||'';if(st==='absent')totA++;else if(st==='late')totL++;});
      if(totA>0||totL>0){var sal=m.salary||m.basicSalary||0;var perDay=sal?Math.round(sal/30):0;deductions.push({name:m.name,dept:m.dept||'',branch:bname,absent:totA,late:totL,salary:sal,est:perDay?(totA+totL)*perDay:0});}
    });
  });
  var rows=deductions.map(function(r,i){return '<tr style="background:'+(i%2===0?'#fff':'#f8fafc')+'"><td style="padding:8px 10px">'+i+1+'</td><td style="padding:8px 10px;font-weight:600">'+r.name+'</td><td style="padding:8px 10px">'+r.dept+'</td><td style="padding:8px 10px">'+r.branch+'</td><td style="padding:8px 10px;text-align:center;color:#c0392b;font-weight:700">'+r.absent+'</td><td style="padding:8px 10px;text-align:center;color:#b45309;font-weight:700">'+r.late+'</td><td style="padding:8px 10px;text-align:center;font-weight:700;color:#5b21b6">'+(r.absent+r.late)+'</td><td style="padding:8px 10px;font-family:monospace">'+( r.salary?'SAR '+r.salary.toLocaleString():'\u2014')+'</td><td style="padding:8px 10px;color:#c0392b;font-weight:700;font-family:monospace">'+(r.est?'-SAR '+r.est.toLocaleString():'Review')+'</td></tr>';}).join('');
  var sess=NX.session||{};
  var html='<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Payroll Deduction Report \u2014 '+moLabel+'</title><style>@page{size:A4 landscape;margin:10mm}*{box-sizing:border-box;margin:0;padding:0;font-family:Arial,Helvetica,sans-serif}body{background:#fff;color:#111;font-size:12px}table{width:100%;border-collapse:collapse}th{background:#1a2340;color:#fff;padding:8px 10px;text-align:left;font-size:9px;text-transform:uppercase;letter-spacing:1px}.c{text-align:center}.foot{margin-top:24px;display:grid;grid-template-columns:1fr 1fr 1fr;gap:40px}.foot-cell{border-top:1px solid #333;padding-top:6px;text-align:center;font-size:9px;color:#64748b}</style></head><body>';
  html+='<div style="display:flex;justify-content:space-between;align-items:flex-start;padding-bottom:10px;margin-bottom:18px;border-bottom:3px solid #1a2340"><div><img src="https://i.imgur.com/jeqtcE2.png" alt="ALFA.CO" style="height:44px;width:auto;display:block"><div style="font-size:11px;color:#64748b">Human Resources</div></div><div style="text-align:center"><h1 style="font-size:18px;font-weight:900;color:#c0392b">PAYROLL DEDUCTION REPORT</h1><p style="font-size:12px;color:#64748b;margin-top:3px">'+moLabel+' \u00b7 Submitted by '+sess.userName+'</p></div><div style="text-align:right;font-size:10px;color:#64748b"><div>Printed: '+new Date().toLocaleDateString('en-GB')+'</div><div style="margin-top:3px;color:#c0392b;font-weight:700">CONFIDENTIAL</div></div></div>';
  html+='<table><thead><tr><th>#</th><th>Employee</th><th>Dept</th><th>Branch</th><th class="c">Absent Days</th><th class="c">Late Days</th><th class="c">Total</th><th>Basic Salary</th><th>Est. Deduction</th></tr></thead><tbody>'+(rows||'<tr><td colspan="9" style="padding:20px;text-align:center;color:#94a3b8">No deductions this month</td></tr>')+'</tbody></table>';
  html+='<div class="foot"><div class="foot-cell">HR Manager Signature &amp; Date</div><div class="foot-cell">Finance Director Signature &amp; Date</div><div class="foot-cell">CEO Approval</div></div>';
  html+='<div style="text-align:center;margin-top:20px"><button onclick="window.print()" style="background:#1a2340;color:#fff;border:none;border-radius:8px;padding:10px 28px;font-size:13px;font-weight:700;cursor:pointer">Print / Save PDF</button></div></body></html>';
  var w=window.open('','_blank','width=1050,height=700');if(w){w.document.write(html);w.document.close();}else showToast('Allow pop-ups to print','error');
}

// ── LEAVE MANAGEMENT ──
function pHrfLeave(){
  var branches=hrfBranches();
  var filterStatus=NX._hrfLeaveStatus||'all';
  function renderLeave(){
    var allLeaves=[];
    branches.forEach(function(b){
      (HRF.leaves[b.id]||[]).forEach(function(l){
        l._branchId=b.id;l._branchName=(NX_BRANCHES[b.id]||{}).name||b.id;
        allLeaves.push(l);
      });
    });
    var filtered=allLeaves.filter(function(l){return filterStatus==='all'||(l.status||'pending')===filterStatus;});
    var pend=allLeaves.filter(function(l){return (l.status||'pending')==='pending';}).length;
    var appr=allLeaves.filter(function(l){return l.status==='approved';}).length;
    var rej=allLeaves.filter(function(l){return l.status==='rejected';}).length;
    var h=hrfHeader('Leave Management',allLeaves.length+' total requests',
      '<button class="btn btn-primary" onclick="hrfOpenLeaveModal()">+ New Leave</button>');
    h+='<div class="hrf-kpi-grid" style="grid-template-columns:repeat(4,1fr)">';
    h+=hrfKpi('&#x23F3;','Pending',pend,'Awaiting','#b45309');
    h+=hrfKpi('&#x2705;','Approved',appr,'This year','#00875a');
    h+=hrfKpi('&#x274C;','Rejected',rej,'This year','#c0392b');
    h+=hrfKpi('&#x1F4CB;','Total',allLeaves.length,'All time','var(--hr-color)');
    h+='</div>';
    h+='<div class="hrf-tab-bar">';
    [['all','All'],['pending','Pending'],['approved','Approved'],['rejected','Rejected']].forEach(function(t){
      h+='<button class="hrf-tab-btn hr-tab'+(filterStatus===t[0]?' active':'')+'" onclick="NX._hrfLeaveStatus=\''+t[0]+'\';navTo(\'hrf-leave\')">'+t[1]+'</button>';
    });
    h+='</div>';
    var rows='';
    filtered.sort(function(a,b){return (b.from||'').localeCompare(a.from||'');}).forEach(function(l){
      var st=l.status||'pending';
      var sc=st==='approved'?'#00875a':st==='rejected'?'#c0392b':'#b45309';
      rows+='<tr><td><strong>'+hxe(l.empName||l.name||'—')+'</strong></td>'+
        '<td>'+hxe(l._branchName)+'</td><td>'+hxe(l.type||'Leave')+'</td>'+
        '<td>'+hxe(l.from||'—')+'</td><td>'+hxe(l.to||'—')+'</td>'+
        '<td style="text-align:center">'+hxe(l.days||'—')+'</td>'+
        '<td>'+hrfBadge(st.charAt(0).toUpperCase()+st.slice(1),sc)+'</td>'+
        '<td>'+(st==='pending'?
          '<button class="btn btn-sm" style="background:rgba(52,211,153,.15);border-color:rgba(52,211,153,.3);color:#b45309;margin-right:4px" onclick="hrfApproveLeave(\''+hxe(l._branchId)+'\',\''+hxe(l._key||l.id||'')+'\')">&#x2713;</button>'+
          '<button class="btn btn-sm" style="background:rgba(248,113,113,.1);border-color:rgba(248,113,113,.25);color:#c0392b" onclick="hrfRejectLeave(\''+hxe(l._branchId)+'\',\''+hxe(l._key||l.id||'')+'\')">&#x2715;</button>'
          :'—')+'</td></tr>';
    });
    if(!rows)h+='<div class="empty-state"><div class="es-icon">&#x1F3D6;&#xFE0F;</div><h3>No leave requests</h3></div>';
    else h+=hrfTable(['Name','Branch','Type','From','To','Days','Status','Actions'],rows);
    return h;
  }
  var cached=branches.filter(function(b){return HRF.leaves[b.id];});
  if(cached.length===branches.length)return renderLeave();
  hrfLoadAll('tsLeaves','leaves',function(){
    branches.forEach(function(b){(HRF.leaves[b.id]||[]).forEach(function(l){l._branchId=b.id;});});
    navTo('hrf-leave');
  });
  return hrfLoading('Loading leave records\u2026');
}

// ── SCHEDULES ──
function pHrfSchedule(){
  var branches=hrfBranches();
  var selBranch=NX._hrfSchBranch||(branches[0]&&branches[0].id)||'';
  function renderSch(){
    var brObj=branches.find(function(b){return b.id===selBranch;})||branches[0]||{};
    var sch=HRF.sch[brObj.id]||{},staff=HRF.staff[brObj.id]||[];
    var weekKeys=Object.keys(sch).filter(function(k){return /\d{4}-W\d{2}/.test(k);});
    var weekKey=NX._hrfSchWeek||weekKeys[weekKeys.length-1]||'';
    var weekSch=weekKey?(sch[weekKey]||{}):{};
    var DAYS=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    var INP='padding:7px 10px;background:var(--surface-2);border:1px solid var(--border);border-radius:8px;color:var(--text-primary);font-family:var(--font);font-size:13px;outline:none';
    var brOpts=branches.map(function(b){return '<option value="'+hxe(b.id)+'"'+(selBranch===b.id?' selected':'')+'>'+hxe(b.name)+'</option>';}).join('');
    var h=hrfHeader('Work Schedules',(brObj.name||'')+' \u00b7 '+(weekKey||'No data'),
      '<select style="'+INP+'" onchange="NX._hrfSchBranch=this.value;navTo(\'hrf-schedule\')">'+brOpts+'</select>');
    if(!staff.length)return h+'<div class="empty-state"><div class="es-icon">&#x1F4C5;</div><h3>No staff data</h3></div>';
    if(weekKeys.length>1){
      h+='<div style="display:flex;gap:6px;margin-bottom:16px;flex-wrap:wrap">';
      weekKeys.slice(-4).forEach(function(wk){
        h+='<button class="btn btn-sm'+(wk===weekKey?' btn-primary':'')+'" onclick="NX._hrfSchWeek=\''+hxe(wk)+'\';navTo(\'hrf-schedule\')">'+hxe(wk)+'</button>';
      });
      h+='</div>';
    }
    h+='<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:12px;min-width:640px">';
    h+='<thead><tr style="background:var(--surface-2)"><th style="padding:9px 12px;text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:.08em;color:var(--text-tertiary);border-bottom:1px solid var(--border)">Staff</th>';
    DAYS.forEach(function(d){h+='<th style="padding:9px 8px;text-align:center;font-size:10px;text-transform:uppercase;letter-spacing:.08em;color:var(--text-tertiary);border-bottom:1px solid var(--border)">'+d+'</th>';});
    h+='</tr></thead><tbody>';
    staff.forEach(function(m){
      var ms=weekSch[String(m.id)]||{};
      h+='<tr><td style="padding:8px 12px;border-bottom:1px solid var(--border)"><strong style="color:var(--text-primary)">'+hxe(m.name)+'</strong><div style="font-size:10px;color:var(--text-tertiary)">'+hxe(m.dept||'')+'</div></td>';
      DAYS.forEach(function(d){var v=ms[d]||'—';var col=v&&v!=='—'?'var(--fin-color)':'var(--text-tertiary)';
        h+='<td style="padding:8px;text-align:center;border-bottom:1px solid var(--border);font-family:var(--mono);font-size:11px;color:'+col+'">'+hxe(v)+'</td>';});
      h+='</tr>';
    });
    h+='</tbody></table></div>';
    // Finance Petty Cash section
    if(!isHR){
      h+='<div class="hrf-section"><div style="font-size:14px;font-weight:700;margin-bottom:14px">💰 Petty Cash — Pending Finance Processing</div>';
      h+='<div id="fin-pc-list"><div style="text-align:center;padding:18px;color:var(--text-tertiary);font-size:12px">Loading…</div></div>';
      h+='</div>';
      setTimeout(function(){
        var cont=document.getElementById('fin-pc-list');
        if(!cont||!db)return;
        db.ref('admin/petty_cash_reviews').once('value',function(snap){
          var raw=snap.val()||{};
          var cycles=Object.values(raw).filter(function(c){
            return c&&(c.status==='pending_finance'||c.status==='finance_processing');
          });
          if(!cycles.length){
            cont.innerHTML='<div style="text-align:center;padding:18px;color:var(--text-tertiary);font-size:12px;font-style:italic">No petty cash cycles pending finance action</div>';
            return;
          }
          var htm=cycles.map(function(cy){
            var invCount=0;(cy.entries||[]).forEach(function(e){invCount+=(e.invoices||[]).length;});
            var isPending=cy.status==='pending_finance';
            return '<div class="hrf-approval-card" style="flex-direction:column;align-items:stretch">'+
              '<div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">'+
                '<div style="width:40px;height:40px;border-radius:10px;background:rgba(180,83,9,.12);display:flex;align-items:center;justify-content:center;font-size:18px;flex-shrink:0">💰</div>'+
                '<div style="flex:1">'+
                  '<div style="font-weight:700;font-size:13px">'+hxe(cy.branchName||cy.branchId)+' — Cycle #'+cy.cycleNo+'</div>'+
                  '<div style="font-size:12px;color:var(--text-secondary)">Total: <strong>SAR '+(cy.total||0).toLocaleString('en',{minimumFractionDigits:2})+'</strong> · '+(cy.entries||[]).length+' entries · '+(invCount?'📎 '+invCount+' inv.':'no invoices')+'</div>'+
                  '<div style="font-size:11px;color:var(--text-tertiary)">AM Approved by '+hxe(cy.amApprovedBy||'—')+' · '+( cy.amApprovedAt?new Date(cy.amApprovedAt).toLocaleDateString():'' )+'</div>'+
                '</div>'+
                '<span style="background:'+(isPending?'rgba(0,87,255,.1)':'rgba(91,33,182,.1)')+';color:'+(isPending?'#0057ff':'#5b21b6')+';border:1px solid '+(isPending?'rgba(0,87,255,.2)':'rgba(91,33,182,.2)')+';border-radius:12px;padding:2px 10px;font-size:11px;font-weight:600">'+(isPending?'Pending Finance':'🔄 Processing')+'</span>'+
              '</div>'+
              '<div style="display:flex;gap:8px;flex-wrap:wrap">'+
                '<button class="btn btn-sm" onclick="pcFinanceExport(\''+cy.id+'\')">📄 View / Export PDF</button>'+
                (isPending?'<button class="btn btn-sm" style="background:rgba(91,33,182,.1);border-color:rgba(91,33,182,.3);color:#5b21b6" onclick="pcFinanceMarkProcessing(\''+cy.id+'\')">🔄 Mark Processing</button>':'')+
                '<button class="btn btn-primary btn-sm" onclick="pcFinanceMarkSent(\''+cy.id+'\')">💸 Confirm Money Sent</button>'+
              '</div>'+
            '</div>';
          }).join('');
          cont.innerHTML=htm;
        });
      },400);
    }
    return h;
  }
  var c1=branches.filter(function(b){return HRF.staff[b.id];}).length;
  var c2=branches.filter(function(b){return HRF.sch[b.id];}).length;
  if(c1===branches.length&&c2===branches.length)return renderSch();
  var done=0;function check(){done++;if(done>=2)navTo('hrf-schedule');}
  if(c1<branches.length)hrfLoadAll('staff','staff',check);else check();
  if(c2<branches.length)hrfLoadAll('sch','sch',check);else check();
  return hrfLoading('Loading schedules\u2026');
}

// ── HEALTH CARDS ──
function pHrfHealth(){
  var branches=hrfBranches();
  function renderHealth(){
    var all=[],expiring=0,expired=0,todayMs=Date.now();
    branches.forEach(function(b){
      (HRF.health[b.id]||[]).forEach(function(h2){
        h2._branchName=(NX_BRANCHES[b.id]||{}).name||b.id;
        all.push(h2);
        // OpsHub stores medical expiry as medExp; fallbacks for older shapes
        var exp=h2.medExp||h2.expiry||h2.expiryDate||h2.exp||'';
        if(exp){var ms=new Date(exp+'T00:00:00').getTime();var days=Math.ceil((ms-todayMs)/86400000);if(days<0)expired++;else if(days<=30)expiring++;}
      });
    });
    var h=hrfHeader('Health Cards',all.length+' cards across '+branches.length+' branches','');
    h+='<div class="hrf-kpi-grid" style="grid-template-columns:repeat(3,1fr)">';
    h+=hrfKpi('&#x1F4B3;','Total Cards',all.length,'All staff','var(--hr-color)');
    h+=hrfKpi('&#x26A0;&#xFE0F;','Expiring Soon',expiring,'Within 30 days','#b45309');
    h+=hrfKpi('&#x274C;','Expired',expired,'Needs renewal','#c0392b');
    h+='</div>';
    var rows='';
    all.forEach(function(card){
      var exp=card.medExp||card.expiry||card.expiryDate||card.exp||'';
      var deptVal=card.dept||'';
      // If dept is missing on the card, look up the staff member from branch staff list
      if(!deptVal&&card.staffId){
        var staffArr=HRF.staff[card._branchId]||[];
        // try all branches if branch wasn't tagged
        if(!staffArr.length){branches.forEach(function(b){(HRF.staff[b.id]||[]).forEach(function(m){if(m.id===card.staffId)deptVal=m.dept||deptVal;});});}
        else{staffArr.forEach(function(m){if(m.id===card.staffId)deptVal=m.dept||deptVal;});}
      }
      if(!deptVal&&card.name){
        branches.forEach(function(b){(HRF.staff[b.id]||[]).forEach(function(m){if(m.name===card.name)deptVal=m.dept||deptVal;});});
      }
      var badge='\u2014',daysCell='\u2014';
      if(exp){var ms=new Date(exp+'T00:00:00').getTime();var days=Math.ceil((ms-Date.now())/86400000);
        var col=days<0?'#c0392b':days<=30?'#b45309':days<=60?'#d97706':'#059669';
        badge=hrfBadge(days<0?'Expired':days+'d left',col);
        daysCell='<span style="color:'+col+';font-weight:600">'+(days<0?'Expired':days+'d')+'</span>';
      }
      rows+='<tr><td><strong>'+hxe(card.name||card.empName||'\u2014')+'</strong></td>'+
        '<td>'+hxe(card._branchName)+'</td><td>'+hxe(deptVal||'\u2014')+'</td>'+
        '<td style="font-family:var(--mono)">'+hxe(card.cardNo||card.id||'\u2014')+'</td>'+
        '<td>'+hxe(exp||'\u2014')+'</td><td>'+daysCell+'</td></tr>';
    });
    if(!rows)h+='<div class="empty-state"><div class="es-icon">&#x1F4B3;</div><h3>No health cards</h3></div>';
    else h+=hrfTable(['Name','Branch','Dept','Card No.','Expiry Date','Days Left'],rows);
    return h;
  }
  var cachedH=branches.filter(function(b){return HRF.health[b.id];});
  var cachedS=branches.filter(function(b){return HRF.staff[b.id];});
  if(cachedH.length===branches.length&&cachedS.length===branches.length)return renderHealth();
  // Need both health AND staff (for dept lookup)
  var done=0;function check(){done++;if(done>=2)navTo('hrf-health');}
  if(cachedH.length<branches.length)hrfLoadAll('health','health',check);else check();
  if(cachedS.length<branches.length)hrfLoadAll('staff','staff',check);else check();
  return hrfLoading('Loading health cards\u2026');
}

// ── PAYROLL ──
function pHrfPayroll(){
  var branches=hrfBranches();
  if(!NX._hrfPayMonth){var d=new Date(new Date().getTime()+3*3600000);NX._hrfPayMonth=d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0');}
  var payMonth=NX._hrfPayMonth;

  function renderPayroll(){
    var allStaff=[],deptTotals={},branchTotals={},grandTotal=0,pendingCount=0,releasedCount=0;
    branches.forEach(function(b){
      var payData=(HRF.payroll&&HRF.payroll[b.id]&&HRF.payroll[b.id][payMonth])||{};
      (HRF.staff[b.id]||[]).forEach(function(m){
        m._branchName=(NX_BRANCHES[b.id]||{}).name||b.id;
        m._branchId=b.id;
        var pay=payData[m.id]||{};
        m._payStatus=pay.status||'draft';
        m._basic=parseFloat(pay.basicSalary||m.salary||m.basicSalary||0);
        m._allow=parseFloat(pay.allowances||0);
        m._ded=parseFloat(pay.deductions||0);
        m._net=m._basic+m._allow-m._ded;
        allStaff.push(m);
        grandTotal+=m._net;
        deptTotals[m.dept||'Other']=(deptTotals[m.dept||'Other']||0)+m._net;
        branchTotals[m._branchName]=(branchTotals[m._branchName]||0)+m._net;
        if(m._payStatus==='pending_finance'||m._payStatus==='pending_hr')pendingCount++;
        if(m._payStatus==='released')releasedCount++;
      });
    });
    var h=hrfHeader('Payroll Overview',payMonth+' \u00b7 '+allStaff.length+' employees','');
    h+='<div style="display:flex;align-items:center;gap:10px;margin-bottom:18px;padding:10px 14px;background:var(--surface-1);border:1px solid var(--border);border-radius:10px">';
    h+='<span style="font-size:11px;color:var(--text-tertiary);text-transform:uppercase;letter-spacing:.08em">Payroll Month</span>';
    h+='<input type="month" value="'+payMonth+'" onchange="NX._hrfPayMonth=this.value;navTo(\'hrf-payroll\')" style="background:var(--surface-2);border:1px solid var(--border);border-radius:7px;padding:5px 10px;color:var(--text-primary);font-size:13px;font-family:var(--font);outline:none;cursor:pointer">';
    h+='<button class="btn btn-sm btn-primary" onclick="hrfRunPayroll(\''+payMonth+'\')">&#x25B6; Process All</button>';
    h+='<button class="btn btn-sm" onclick="hrfExportPayroll(\''+payMonth+'\')">&#x2B07; Export CSV</button>';
    h+='</div>';
    h+='<div class="hrf-kpi-grid" style="grid-template-columns:repeat(4,1fr)">';
    h+=hrfKpi('&#x1F4B8;','Total Net',hfsar(grandTotal),'All branches','var(--payroll-color)');
    h+=hrfKpi('&#x1F465;','Headcount',allStaff.length,payMonth,'var(--hr-color)');
    h+=hrfKpi('&#x23F3;','Pending',pendingCount,'Awaiting approval','#b45309');
    h+=hrfKpi('&#x2705;','Released',releasedCount,'Paid out','#00875a');
    h+='</div>';
    h+='<div class="hrf-grid-2">';
    h+='<div class="hrf-chart-card"><div style="font-size:13px;font-weight:700;margin-bottom:14px">By Department</div>';
    Object.keys(deptTotals).sort().forEach(function(dept){
      var pct=grandTotal?Math.round(deptTotals[dept]/grandTotal*100):0;
      h+='<div class="hrf-budget-item"><div style="display:flex;justify-content:space-between;margin-bottom:6px">'+
        '<span style="font-size:13px">'+hxe(dept)+'</span>'+
        '<span style="font-family:var(--mono);font-size:12px;color:var(--payroll-color)">'+hfsar(deptTotals[dept])+'</span></div>'+
        '<div style="height:5px;background:var(--surface-3);border-radius:3px"><div style="height:100%;width:'+pct+'%;background:var(--payroll-color);border-radius:3px"></div></div></div>';
    });
    h+='</div>';
    h+='<div class="hrf-chart-card"><div style="font-size:13px;font-weight:700;margin-bottom:14px">By Branch</div>';
    Object.keys(branchTotals).sort().forEach(function(bn){
      var pct=grandTotal?Math.round(branchTotals[bn]/grandTotal*100):0;
      h+='<div class="hrf-budget-item"><div style="display:flex;justify-content:space-between;margin-bottom:6px">'+
        '<span style="font-size:13px">'+hxe(bn)+'</span>'+
        '<span style="font-family:var(--mono);font-size:12px;color:var(--hr-color)">'+hfsar(branchTotals[bn])+'</span></div>'+
        '<div style="height:5px;background:var(--surface-3);border-radius:3px"><div style="height:100%;width:'+pct+'%;background:var(--hr-color);border-radius:3px"></div></div></div>';
    });
    h+='</div></div>';
    var rows='';
    allStaff.filter(function(m){return m._basic>0||m._net>0;})
      .sort(function(a,b){return b._net-a._net;})
      .forEach(function(m){
        var sc=m._payStatus==='released'?'#00875a':m._payStatus.indexOf('pending')===0?'#b45309':'var(--text-tertiary)';
        rows+='<tr>'+
          '<td><strong>'+hxe(m.name)+'</strong><div style="font-size:10px;color:var(--text-tertiary)">'+hxe(m._branchName)+'</div></td>'+
          '<td>'+hxe(m.dept||'\u2014')+'</td>'+
          '<td class="mono">'+hfsar(m._basic)+'</td>'+
          '<td class="mono" style="color:#b45309">+'+hfsar(m._allow)+'</td>'+
          '<td class="mono" style="color:#c0392b">-'+hfsar(m._ded)+'</td>'+
          '<td class="mono" style="font-weight:700;color:var(--payroll-color)">'+hfsar(m._net)+'</td>'+
          '<td><span style="font-size:11px;font-weight:600;color:'+sc+'">'+m._payStatus.replace(/_/g,' ')+'</span></td>'+
          '<td><button class="btn btn-sm" onclick="hrfEditPayRow(\''+hxe(m._branchId)+'\',\''+hxe(m.id)+'\',\''+payMonth+'\')">Edit</button></td>'+
        '</tr>';
      });
    h+='<div class="hrf-section" style="margin-top:20px">';
    h+='<div style="font-size:13px;font-weight:700;margin-bottom:12px">Staff Payroll Detail</div>';
    if(rows)h+=hrfTable(['Name','Dept','Basic','Allowances','Deductions','Net','Status',''],rows);
    else h+='<div class="empty-state"><div class="es-icon">&#x1F4B8;</div><h3>No payroll data for '+payMonth+'</h3><p>Click \u201cProcess All\u201d to generate from staff salary records</p></div>';
    h+='</div>';
    return h;
  }

  var cached=branches.filter(function(b){return HRF.staff[b.id];});
  if(cached.length===branches.length)return renderPayroll();
  hrfLoadAll('staff','staff',function(){navTo('hrf-payroll');});
  return hrfLoading('Loading payroll data\u2026');
}

function hrfRunPayroll(month){
  if(!db){showToast('Not connected','error');return;}
  var branches=hrfBranches();var count=0;
  branches.forEach(function(b){
    (HRF.staff[b.id]||[]).forEach(function(m){
      var sal=parseFloat(m.salary||m.basicSalary||0);if(!sal)return;
      var path='branches/'+b.id+'/payroll/'+month+'/'+m.id;
      db.ref(path).once('value',function(snap){
        if(!snap.val()){
          db.ref(path).set({basicSalary:sal,allowances:0,deductions:0,status:'pending_hr',processedAt:Date.now()});
          count++;
        }
      });
    });
  });
  setTimeout(function(){showToast('Payroll processed','success');navTo('hrf-payroll');},900);
}

function hrfEditPayRow(branchId,empId,month){
  if(!db){showToast('Not connected','error');return;}
  db.ref('branches/'+branchId+'/payroll/'+month+'/'+empId).once('value',function(snap){
    var pay=snap.val()||{};
    var staff=(HRF.staff[branchId]||[]).find(function(m){return m.id===empId;})||{};
    openModal('<div class="modal-head"><h2>Edit Payroll \u2014 '+hxe(staff.name||empId)+'</h2><button class="modal-close" onclick="closeModalForce()">\u2715</button></div>'+
      '<div class="form-row">'+
        '<div class="form-group"><label class="form-label">Basic Salary (‫SAR ‬)</label><input class="form-input" type="number" id="hpe-basic" value="'+(pay.basicSalary||staff.salary||0)+'"></div>'+
        '<div class="form-group"><label class="form-label">Allowances (‫SAR ‬)</label><input class="form-input" type="number" id="hpe-allow" value="'+(pay.allowances||0)+'"></div>'+
      '</div>'+
      '<div class="form-row">'+
        '<div class="form-group"><label class="form-label">Deductions (‫SAR ‬)</label><input class="form-input" type="number" id="hpe-ded" value="'+(pay.deductions||0)+'"></div>'+
        '<div class="form-group"><label class="form-label">Status</label><select class="form-input form-select" id="hpe-status">'+
          ['draft','pending_hr','pending_finance','released'].map(function(s2){return '<option value="'+s2+'"'+(pay.status===s2?' selected':'')+'>'+s2.replace(/_/g,' ')+'</option>';}).join('')+
        '</select></div>'+
      '</div>'+
      '<div class="form-group"><label class="form-label">Notes</label><input class="form-input" id="hpe-notes" value="'+hxe(pay.notes||'')+'"></div>'+
      '<button class="btn btn-primary" style="width:100%;margin-top:8px" onclick="hrfSavePayRow(\''+hxe(branchId)+'\',\''+hxe(empId)+'\',\''+hxe(month)+'\')">Save Changes</button>');
  });
}

function hrfSavePayRow(branchId,empId,month){
  var basic=parseFloat(document.getElementById('hpe-basic').value)||0;
  var allow=parseFloat(document.getElementById('hpe-allow').value)||0;
  var ded=parseFloat(document.getElementById('hpe-ded').value)||0;
  db.ref('branches/'+branchId+'/payroll/'+month+'/'+empId).update({
    basicSalary:basic,allowances:allow,deductions:ded,net:basic+allow-ded,
    status:document.getElementById('hpe-status').value,
    notes:document.getElementById('hpe-notes').value,
    updatedAt:Date.now()
  },function(err){
    if(err){showToast('Save failed','error');return;}
    closeModalForce();showToast('Payroll updated','success');navTo('hrf-payroll');
  });
}

function hrfExportPayroll(month){
  var rows=[['Name','Branch','Dept','Role','Basic','Allowances','Deductions','Net','Status']];
  hrfBranches().forEach(function(b){
    (HRF.staff[b.id]||[]).forEach(function(m){
      var pay=(HRF.payroll&&HRF.payroll[b.id]&&HRF.payroll[b.id][month]&&HRF.payroll[b.id][month][m.id])||{};
      var basic=parseFloat(pay.basicSalary||m.salary||0);if(!basic)return;
      var allow=parseFloat(pay.allowances||0),ded=parseFloat(pay.deductions||0);
      rows.push([m.name,(NX_BRANCHES[b.id]||{}).name||b.id,m.dept||'',m.role||'',basic,allow,ded,basic+allow-ded,pay.status||'draft']);
    });
  });
  var csv=rows.map(function(r){return r.map(function(c){return '"'+String(c).replace(/"/g,'""')+'"';}).join(',');}).join('\n');
  var a=document.createElement('a');a.href='data:text/csv;charset=utf-8,'+encodeURIComponent(csv);a.download='payroll-'+month+'.csv';a.click();
  showToast('CSV exported','success');
}


// ── PETTY CASH (cross-branch) ──
function pHrfPettyCash(){
  var branches=hrfBranches();var filterBranch=NX._hrfPcBranch||'';
  function renderPC(){
    var allPC=[];
    branches.forEach(function(b){(HRF.pc[b.id]||[]).forEach(function(p){p._branchName=(NX_BRANCHES[b.id]||{}).name||b.id;p._branchId=b.id;allPC.push(p);});});
    var filtered=filterBranch?allPC.filter(function(p){return p._branchId===filterBranch;}):allPC;
    var total=filtered.reduce(function(s,p){return s+parseFloat(p.amount||0);},0);
    var approved=filtered.filter(function(p){return p.status==='approved'||p.approved;});
    var pending=filtered.filter(function(p){return !p.approved&&(!p.status||p.status==='pending');});
    var INP='padding:7px 10px;background:var(--surface-2);border:1px solid var(--border);border-radius:8px;color:var(--text-primary);font-family:var(--font);font-size:13px;outline:none';
    var brOpts='<option value="">All Branches</option>'+branches.map(function(b){return '<option value="'+hxe(b.id)+'"'+(filterBranch===b.id?' selected':'')+'>'+hxe(b.name)+'</option>';}).join('');
    var h=hrfHeader('Petty Cash',filtered.length+' entries \u00b7 '+hfsar(total),
      '<select style="'+INP+'" onchange="NX._hrfPcBranch=this.value;navTo(\'hrf-petty-cash\')">'+brOpts+'</select>');
    h+='<div class="hrf-kpi-grid" style="grid-template-columns:repeat(3,1fr)">';
    h+=hrfKpi('&#x1F4B5;','Total Spent',hfsar(total),'All entries','var(--fin-color)');
    h+=hrfKpi('&#x2705;','Approved',hfsar(approved.reduce(function(s,p){return s+parseFloat(p.amount||0);},0)),approved.length+' entries','#00875a');
    h+=hrfKpi('&#x23F3;','Pending',hfsar(pending.reduce(function(s,p){return s+parseFloat(p.amount||0);},0)),pending.length+' entries','#b45309');
    h+='</div>';
    var rows='';
    filtered.sort(function(a,b){return (b.date||'').localeCompare(a.date||'');}).slice(0,60).forEach(function(p){
      var st=p.status||(p.approved?'approved':'pending');
      var sc=st==='approved'?'#00875a':st==='rejected'?'#c0392b':'#b45309';
      rows+='<tr><td>'+hxe(p.date||'—')+'</td><td>'+hxe(p._branchName)+'</td>'+
        '<td>'+hxe(p.category||p.cat||'—')+'</td><td>'+hxe(p.description||p.desc||p.note||'—')+'</td>'+
        '<td style="font-family:var(--mono);color:var(--fin-color)">'+hfsar(p.amount||0)+'</td>'+
        '<td>'+hxe(p.requestedBy||p.by||'—')+'</td><td>'+hrfBadge(st.charAt(0).toUpperCase()+st.slice(1),sc)+'</td></tr>';
    });
    if(!rows)h+='<div class="empty-state"><div class="es-icon">&#x1F9FE;</div><h3>No petty cash entries</h3></div>';
    else h+=hrfTable(['Date','Branch','Category','Description','Amount','By','Status'],rows);
    return h;
  }
  var cached=branches.filter(function(b){return HRF.pc[b.id];});
  if(cached.length===branches.length)return renderPC();
  hrfLoadAll('pc','pc',function(){navTo('hrf-petty-cash');});
  return hrfLoading('Loading petty cash\u2026');
}

// ── REVENUE ──
function pHrfRevenue(){
  var branches=hrfBranches();
  function renderRev(){
    var d=new Date(new Date().getTime()+3*3600000);var curYear=d.getFullYear();
    var monthlyTotals=new Array(12).fill(0);
    branches.forEach(function(b){
      (HRF.sales[b.id]||[]).forEach(function(e){
        if(!e.date||!e.date.startsWith(String(curYear)))return;
        var mo=parseInt(e.date.slice(5,7),10)-1;
        if(mo>=0&&mo<12)monthlyTotals[mo]+=parseFloat(e.actual||e.total||e.amount||0);
      });
    });
    var ytd=monthlyTotals.slice(0,d.getMonth()+1).reduce(function(s,v){return s+v;},0);
    var curMo=monthlyTotals[d.getMonth()];
    var h=hrfHeader('Revenue',curYear+' \u00b7 Real sales from Firebase','');
    h+='<div class="hrf-kpi-grid" style="grid-template-columns:repeat(3,1fr)">';
    h+=hrfKpi('&#x1F4B0;','YTD Revenue',hfsar(ytd),curYear+' to date','var(--fin-color)');
    h+=hrfKpi('&#x1F4C5;','Current Month',hfsar(curMo),HRF_MONTHS[d.getMonth()]+' '+curYear,'var(--payroll-color)');
    h+=hrfKpi('&#x1F3EA;','Branches',branches.length,'Contributing','var(--info)');
    h+='</div>';
    h+='<div class="hrf-chart-card hrf-section"><div style="font-size:14px;font-weight:700;margin-bottom:16px">Monthly Revenue \u2014 '+curYear+'</div><div style="height:260px"><canvas id="hrf-chart-revenue-monthly"></canvas></div></div>';
    var rows='';
    for(var mo=0;mo<=d.getMonth();mo++){
      rows+='<tr><td><strong>'+HRF_MONTHS[mo]+' '+curYear+'</strong></td>'+
        '<td style="font-family:var(--mono);color:var(--fin-color)">'+hfsar(monthlyTotals[mo])+'</td>'+
        '<td style="font-family:var(--mono);color:var(--text-secondary)">'+(ytd?(monthlyTotals[mo]/ytd*100).toFixed(1)+'%':'—')+'</td></tr>';
    }
    h+='<div class="hrf-section" style="margin-top:20px"><div style="font-size:13px;font-weight:700;margin-bottom:12px">Monthly Breakdown</div>';
    h+=hrfTable(['Month','Revenue','% of YTD'],rows)+'</div>';
    NX._hrfMonthlyRev=monthlyTotals;
    return h;
  }
  var cached=branches.filter(function(b){return HRF.sales[b.id];});
  if(cached.length===branches.length)return renderRev();
  hrfLoadAll('sales','sales',function(){navTo('hrf-revenue');});
  return hrfLoading('Loading revenue\u2026');
}


// ── FINANCE: COMPLIANCE & PERMITS VIEW ──────────────────────────────────────
function pHrfCompliance(){
  var branches=hrfBranches();
  function render(){
    var now=new Date();
    function daysUntil(d){if(!d)return 9999;return Math.ceil((new Date(d)-now)/86400000);}
    function urgBadge(d){var du=daysUntil(d);if(du<0)return'<span style="background:rgba(192,57,43,.15);color:#c0392b;border-radius:10px;padding:1px 6px;font-size:10px;font-weight:700">EXPIRED</span>';if(du<=7)return'<span style="background:rgba(192,57,43,.12);color:#c0392b;border-radius:10px;padding:1px 6px;font-size:10px;font-weight:700">'+du+'d</span>';if(du<=30)return'<span style="background:rgba(180,83,17,.12);color:#b45309;border-radius:10px;padding:1px 6px;font-size:10px">'+du+'d</span>';return'';}
    var allItems=[],totalFixed=0,totalServices=0;
    branches.forEach(function(b){
      var bname=(NX_BRANCHES[b.id]||{}).name||b.id;
      var comp=HRF.compliance&&HRF.compliance[b.id];
      if(!comp)return;
      (comp.recurring||[]).forEach(function(r){r._branch=bname;r._branchId=b.id;r._kind='recurring';allItems.push(r);totalFixed+=parseFloat(r.monthlyCost)||0;});
      (comp.services||[]).forEach(function(r){r._branch=bname;r._branchId=b.id;r._kind='service';allItems.push(r);totalServices+=parseFloat(r.monthlyCost)||0;});
      (comp.permits||[]).forEach(function(r){r._branch=bname;r._branchId=b.id;r._kind='permit';allItems.push(r);});
    });
    var expired=allItems.filter(function(x){return daysUntil(x.expiry||x.renewalDate)<=0;}).length;
    var warn7=allItems.filter(function(x){var du=daysUntil(x.expiry||x.renewalDate);return du>0&&du<=7;}).length;
    var warn30=allItems.filter(function(x){var du=daysUntil(x.expiry||x.renewalDate);return du>7&&du<=30;}).length;
    var h=hrfHeader('Fixed Costs \u0026 Permits','Across all branches \u2014 synced from branch managers','');
    if(expired||warn7||warn30){h+='<div style="background:rgba(192,57,43,.08);border:1px solid rgba(192,57,43,.25);border-radius:10px;padding:12px 16px;margin-bottom:16px;display:flex;gap:20px;align-items:center;flex-wrap:wrap"><span style="font-size:16px">\u26a0\ufe0f</span>';if(expired)h+='<span style="color:#c0392b;font-weight:700;font-size:13px">'+expired+' records EXPIRED</span>';if(warn7)h+='<span style="color:#c0392b;font-weight:700;font-size:13px">'+warn7+' expire within 7 days</span>';if(warn30)h+='<span style="color:#b45309;font-size:13px">'+warn30+' expire within 30 days</span>';h+='</div>';}
    h+='<div class="hrf-kpi-grid" style="margin-bottom:20px">';
    h+=hrfKpi('\ud83c\udfe0','Monthly Fixed',hfsar(totalFixed),'Rent \u00b7 elec \u00b7 water','var(--fin-color)');
    h+=hrfKpi('\ud83d\udd27','Monthly Services',hfsar(totalServices),'Maint \u00b7 cleaning','var(--payroll-color)');
    h+=hrfKpi('\ud83e\udeb7','Active Permits',allItems.filter(function(x){return x._kind==='permit';}).length,'Licences tracked','var(--info)');
    h+=hrfKpi('\u26a0\ufe0f','Expiry Alerts',expired+warn7+warn30,'Expired or <30d','var(--danger)');
    h+='</div>';
    var sorted=allItems.slice().sort(function(a,b){return daysUntil(a.expiry||a.renewalDate)-daysUntil(b.expiry||b.renewalDate);});
    var rows='';
    sorted.forEach(function(item){
      var expD=item.expiry||item.renewalDate||'';
      var kindMap={recurring:'<span style="background:rgba(29,158,117,.12);color:#0F6E56;border-radius:8px;padding:1px 7px;font-size:10px">Fixed</span>',service:'<span style="background:rgba(91,33,182,.12);color:#5b21b6;border-radius:8px;padding:1px 7px;font-size:10px">Service</span>',permit:'<span style="background:rgba(0,87,255,.12);color:#0057ff;border-radius:8px;padding:1px 7px;font-size:10px">Permit</span>'};
      rows+='<tr><td><div style="font-weight:600">'+hxe(item.name||'\u2014')+'</div><div style="font-size:10px;color:var(--text-tertiary)">'+hxe(item._branch)+'</div></td><td>'+(kindMap[item._kind]||'')+'</td><td style="font-size:12px">'+hxe(item.type||item.authority||'\u2014')+'</td><td style="font-family:var(--mono)">'+(item.monthlyCost?hfsar(parseFloat(item.monthlyCost)):'\u2014')+'</td><td style="font-family:var(--mono);font-size:12px">'+hxe(expD||'\u2014')+' '+urgBadge(expD)+'</td></tr>';
    });
    if(!rows)h+='<div style="text-align:center;padding:32px;color:var(--text-tertiary)">No compliance data yet. Branch managers need to add records and click Send to Finance.</div>';
    else h+=hrfTable(['Name / Branch','Type','Category','Monthly SAR','Expiry'],rows);
    return h;
  }
  if(!HRF.compliance){
    HRF.compliance={};
    var brs=hrfBranches();var loaded=0;
    brs.forEach(function(b){db.ref('branches/'+b.id+'/compliance').once('value',function(snap){if(snap.val())HRF.compliance[b.id]=snap.val();if(++loaded===brs.length)navTo('hrf-compliance');});});
    return hrfLoading('Loading compliance data\u2026');
  }
  return render();
}

// ── P&L ──
function pHrfPnL(){
  var branches=hrfBranches();
  function renderPnL(){
    var d=new Date(new Date().getTime()+3*3600000);var curYear=d.getFullYear();
    var selMonth=NX._pnlMonth||(curYear+'-'+(d.getMonth()<9?'0':'')+(d.getMonth()+1));
    var selYear=parseInt(selMonth.slice(0,4));
    var moIdx=parseInt(selMonth.slice(5,7))-1;

    // Revenue from sales/DSR
    var revByMo=new Array(12).fill(0);
    branches.forEach(function(b){
      (HRF.sales[b.id]||[]).forEach(function(e){if(!e.date||!e.date.startsWith(String(selYear)))return;var mo=parseInt(e.date.slice(5,7),10)-1;if(mo>=0&&mo<12)revByMo[mo]+=parseFloat(e.actual||e.total||e.amount||0);});
    });

    // COGS: wastage
    var wasteByMo=new Array(12).fill(0);
    branches.forEach(function(b){(HRF.waste[b.id]||[]).forEach(function(w){if(!w.date||!w.date.startsWith(String(selYear)))return;var mo=parseInt(w.date.slice(5,7),10)-1;if(mo>=0&&mo<12)wasteByMo[mo]+=parseFloat(w.value||w.cost||w.amount||0);});});

    // Labour: payroll
    var payByMo=new Array(12).fill(0);
    branches.forEach(function(b){
      var staff=HRF.staff[b.id]||[];
      var monthlyPay=staff.reduce(function(s,m){var base=parseFloat(m.basicSalary||m.salary||0);var h=Math.round(base*0.25);var t=Math.round(base*0.10);var gross=base+h+t;var gosi=Math.round(gross*0.09);return s+gross+gosi;},0);
      for(var mi=0;mi<12;mi++)payByMo[mi]+=monthlyPay;
    });

    // Fixed costs & services from compliance
    var fixedByMo=new Array(12).fill(0);
    var permitAnnual=0;
    branches.forEach(function(b){
      var comp=HRF.compliance&&HRF.compliance[b.id];if(!comp)return;
      var monthlyFixed=(comp.recurring||[]).reduce(function(s,r){return s+(parseFloat(r.monthlyCost)||0);},0);
      var monthlyServices=(comp.services||[]).reduce(function(s,r){return s+(parseFloat(r.monthlyCost)||0);},0);
      for(var mi=0;mi<12;mi++)fixedByMo[mi]+=monthlyFixed+monthlyServices;
      permitAnnual+=(comp.permits||[]).reduce(function(s,p){return s+(parseFloat(p.monthlyCost)||0);},0);
      for(var mi2=0;mi2<12;mi2++)fixedByMo[mi2]+=permitAnnual/12;
    });

    // Petty cash (operational / admin)
    var pcByMo=new Array(12).fill(0);
    branches.forEach(function(b){(HRF.pc[b.id]||[]).forEach(function(p){if(!p.date||!p.date.startsWith(String(selYear)))return;var mo=parseInt(p.date.slice(5,7),10)-1;if(mo>=0&&mo<12)pcByMo[mo]+=parseFloat(p.amount||0);});});

    // YTD totals
    var ytdRev=0,ytdWaste=0,ytdPay=0,ytdFixed=0,ytdPC=0;
    for(var mi=0;mi<=Math.min(moIdx,d.getMonth());mi++){ytdRev+=revByMo[mi];ytdWaste+=wasteByMo[mi];ytdPay+=payByMo[mi];ytdFixed+=fixedByMo[mi];ytdPC+=pcByMo[mi];}
    var ytdGross=ytdRev-ytdWaste;
    var ytdEBITDA=ytdGross-ytdPay;
    var ytdNet=ytdEBITDA-ytdFixed-ytdPC;
    var margin=ytdRev>0?(ytdNet/ytdRev*100):0;

    // Month picker
    var moOpts='';for(var mi2=0;mi2<=d.getMonth();mi2++){var ym=selYear+'-'+(mi2<9?'0':'')+(mi2+1);var lbl=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][mi2]+' '+selYear;moOpts+='<option value="'+ym+'"'+(ym===selMonth?' selected':'')+'>'+lbl+'</option>';}

    var INP='padding:7px 10px;background:var(--surface-2);border:1px solid var(--border);border-radius:8px;color:var(--text-primary);font-family:var(--font);font-size:13px;outline:none';
    var h=hrfHeader('P\u0026L Statement','Full Profit \u0026 Loss \u00b7 '+selYear,
      '<select style="'+INP+'" onchange="NX._pnlMonth=this.value;navTo(\'hrf-pnl\')">'+moOpts+'</select>'+
      '<button class="btn btn-primary" onclick="navTo(\'hrf-compliance\')">View Fixed Costs</button>');

    // Top KPI row
    h+='<div class="hrf-kpi-grid" style="grid-template-columns:repeat(5,1fr)">';
    h+=hrfKpi('\ud83d\udcb0','YTD Revenue',hfsar(ytdRev),'Top line','var(--fin-color)');
    h+=hrfKpi('\ud83e\ude96','Gross Profit',hfsar(ytdGross),'After food cost',(ytdGross>=0?'#00875a':'#c0392b'));
    h+=hrfKpi('\ud83e\uddd1\u200d\ud83d\udcbc','EBITDA',hfsar(ytdEBITDA),'After labour',(ytdEBITDA>=0?'#00875a':'#c0392b'));
    h+=hrfKpi('\ud83d\udcc8','Net Profit',hfsar(ytdNet),(margin.toFixed(1)+'% margin'),(ytdNet>=0?'#00875a':'#c0392b'));
    h+=hrfKpi('\ud83d\udce6','Fixed Costs',hfsar(ytdFixed),'Rent \u00b7 permits \u00b7 svcs','var(--warning)');
    h+='</div>';

    // P&L waterfall for selected month
    var mRev=revByMo[moIdx]||0,mWaste=wasteByMo[moIdx]||0,mPay=payByMo[moIdx]||0,mFixed=fixedByMo[moIdx]||0,mPC=pcByMo[moIdx]||0;
    var mGross=mRev-mWaste,mEBITDA=mGross-mPay,mNet=mEBITDA-mFixed-mPC;
    var moName=['January','February','March','April','May','June','July','August','September','October','November','December'][moIdx]+' '+selYear;

    h+='<div class="hrf-section" style="margin-bottom:20px"><div style="font-size:14px;font-weight:700;margin-bottom:14px">'+moName+' \u2014 P\u0026L Statement</div>';
    function pl(l,v,indent,bold,color){var c=color||(v>=0?'var(--fin-color)':'#c0392b');return '<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--border);'+(bold?'font-weight:700':'')+'"><span style="padding-left:'+(indent?'20px':'0')+';color:var(--text-secondary)">'+l+'</span><span style="font-family:var(--mono);color:'+c+'">'+hfsar(v)+'</span></div>';}
    function plsec(t){return '<div style="font-size:10px;font-weight:700;color:var(--text-tertiary);text-transform:uppercase;letter-spacing:.1em;padding:12px 0 4px">'+t+'</div>';}

    h+=plsec('Revenue');
    h+=pl('Net Sales Revenue',mRev,false,false,'var(--fin-color)');
    h+=plsec('Cost of Goods Sold');
    h+=pl('Food & Beverage Cost (Wastage)',-mWaste,true,false,'#c0392b');
    h+=pl('= Gross Profit',mGross,false,true,(mGross>=0?'#00875a':'#c0392b'));
    h+=plsec('Labour');
    h+=pl('Payroll + Allowances + GOSI',-mPay,true,false,'#c0392b');
    h+=pl('= EBITDA',mEBITDA,false,true,(mEBITDA>=0?'#00875a':'#c0392b'));
    h+=plsec('Fixed Operating Expenses');
    h+=pl('Rent, Electricity, Water, Gas',-mFixed,true,false,'#c0392b');
    h+=plsec('Admin & Other');
    h+=pl('Petty Cash / Operational',-mPC,true,false,'#c0392b');
    h+=pl('= NET PROFIT / (LOSS)',mNet,false,true,(mNet>=0?'#00875a':'#c0392b'));
    if(mRev>0)h+='<div style="text-align:right;font-size:11px;color:var(--text-tertiary);padding-top:6px">Net margin: <strong style="color:'+(mNet>=0?'#00875a':'#c0392b')+'">'+(mNet/mRev*100).toFixed(1)+'%</strong></div>';
    h+='</div>';

    // Monthly table
    var rows='';
    for(var mi3=0;mi3<=Math.min(moIdx,d.getMonth());mi3++){
      var r=revByMo[mi3],w=wasteByMo[mi3],p=payByMo[mi3],f=fixedByMo[mi3],pc=pcByMo[mi3];
      var net=r-w-p-f-pc;var nc=net>=0?'#00875a':'#c0392b';
      rows+='<tr><td><strong>'+['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][mi3]+' '+selYear+'</strong></td>'+
        '<td style="font-family:var(--mono);color:var(--fin-color)">'+hfsar(r)+'</td>'+
        '<td style="font-family:var(--mono);color:#c0392b">'+hfsar(w)+'</td>'+
        '<td style="font-family:var(--mono);color:#c0392b">'+hfsar(p)+'</td>'+
        '<td style="font-family:var(--mono);color:#c0392b">'+hfsar(f)+'</td>'+
        '<td style="font-family:var(--mono);color:'+nc+';font-weight:700">'+hfsar(net)+'</td>'+
        '<td style="font-family:var(--mono);color:var(--text-secondary)">'+(r>0?(net/r*100).toFixed(1)+'%':'—')+'</td></tr>';
    }
    h+=hrfTable(['Month','Revenue','Food Cost','Labour','Fixed Opex','Net Profit','Margin'],rows);
    h+='<p style="font-size:11px;color:var(--text-tertiary);margin-top:8px">\u2139\ufe0f Labour = gross payroll + allowances + GOSI (9%). Fixed Opex from Compliance module. Add compliance records for full accuracy.</p>';
    return h;
  }

  // Load everything in parallel
  var needs=[];
  var c1=branches.filter(function(b){return HRF.sales[b.id];}).length;
  var c2=branches.filter(function(b){return HRF.waste[b.id];}).length;
  var c3=branches.filter(function(b){return HRF.pc[b.id];}).length;
  var c4=branches.filter(function(b){return HRF.staff[b.id];}).length;
  if(c1===branches.length&&c2===branches.length&&c3===branches.length&&c4===branches.length){
    if(!HRF.compliance){
      HRF.compliance={};
      var brs=hrfBranches();var loaded=0;
      brs.forEach(function(b){db.ref('branches/'+b.id+'/compliance').once('value',function(snap){if(snap.val())HRF.compliance[b.id]=snap.val();if(++loaded===brs.length)navTo('hrf-pnl');});});
      return hrfLoading('Loading P\u0026L data\u2026');
    }
    return renderPnL();
  }
  var done=0;var total=0;
  function check(){if(++done>=total)navTo('hrf-pnl');}
  if(c1<branches.length){total++;hrfLoadAll('sales','sales',check);}
  if(c2<branches.length){total++;hrfLoadAll('waste','waste',check);}
  if(c3<branches.length){total++;hrfLoadAll('pc','pc',check);}
  if(c4<branches.length){total++;hrfLoadAll('staff','staff',check);}
  if(!total)navTo('hrf-pnl');
  return hrfLoading('Loading P\u0026L data\u2026');
}


// ── FOOD COST ──
function pHrfFoodCost(){
  var branches=hrfBranches();
  function renderFC(){
    var d=new Date(new Date().getTime()+3*3600000);var curYear=d.getFullYear();
    var wasteByBranch={},wasteByMo=new Array(12).fill(0),totalWaste=0,totalRev=0;
    branches.forEach(function(b){
      var bname=(NX_BRANCHES[b.id]||{}).name||b.id;var bw=0;
      (HRF.waste[b.id]||[]).forEach(function(w){var amt=parseFloat(w.value||w.cost||w.amount||0);bw+=amt;totalWaste+=amt;if(w.date&&w.date.startsWith(String(curYear))){var mo=parseInt(w.date.slice(5,7),10)-1;if(mo>=0&&mo<12)wasteByMo[mo]+=amt;}});
      wasteByBranch[bname]=bw;
      (HRF.sales[b.id]||[]).forEach(function(e){totalRev+=parseFloat(e.actual||e.total||e.amount||0);});
    });
    var fcPct=totalRev>0?(totalWaste/totalRev*100):0;
    var h=hrfHeader('Food Cost Analysis','Wastage data \u00b7 Real Firebase','');
    h+='<div class="hrf-kpi-grid" style="grid-template-columns:repeat(3,1fr)">';
    h+=hrfKpi('&#x1F5D1;&#xFE0F;','Total Wastage',hfsar(totalWaste),'All branches','var(--danger)');
    h+=hrfKpi('&#x1F4CA;','Wastage %',fcPct.toFixed(2)+'%','vs revenue',fcPct>10?'#c0392b':fcPct>5?'#b45309':'#00875a');
    h+=hrfKpi('&#x1F4B0;','Total Revenue',hfsar(totalRev),'For context','var(--fin-color)');
    h+='</div>';
    h+='<div class="hrf-chart-card hrf-section"><div style="font-size:14px;font-weight:700;margin-bottom:16px">Wastage Trend (Monthly)</div><div style="height:240px"><canvas id="hrf-chart-foodcost"></canvas></div></div>';
    var rows='';
    Object.keys(wasteByBranch).sort(function(a,b2){return wasteByBranch[b2]-wasteByBranch[a];}).forEach(function(bname){
      var w=wasteByBranch[bname];
      var brRev=0;
      branches.forEach(function(b){if((NX_BRANCHES[b.id]||{}).name===bname)(HRF.sales[b.id]||[]).forEach(function(e){brRev+=parseFloat(e.actual||e.total||e.amount||0);});});
      var pct=brRev>0?(w/brRev*100):0;var col=pct>10?'#c0392b':pct>5?'#b45309':'#00875a';
      rows+='<tr><td><strong>'+hxe(bname)+'</strong></td>'+
        '<td style="font-family:var(--mono);color:var(--danger)">'+hfsar(w)+'</td>'+
        '<td style="font-family:var(--mono);color:'+col+'">'+pct.toFixed(2)+'%</td>'+
        '<td style="font-family:var(--mono);color:var(--text-secondary)">'+hfsar(brRev)+'</td></tr>';
    });
    h+='<div class="hrf-section" style="margin-top:20px"><div style="font-size:13px;font-weight:700;margin-bottom:12px">Wastage by Branch</div>';
    h+=hrfTable(['Branch','Wastage Cost','% of Revenue','Revenue'],rows)+'</div>';
    NX._hrfWasteByMo=wasteByMo;
    return h;
  }
  var c1=branches.filter(function(b){return HRF.waste[b.id];}).length;
  var c2=branches.filter(function(b){return HRF.sales[b.id];}).length;
  if(c1===branches.length&&c2===branches.length)return renderFC();
  var done=0;function check(){done++;if(done>=2)navTo('hrf-food-cost');}
  if(c1<branches.length)hrfLoadAll('waste','waste',check);else check();
  if(c2<branches.length)hrfLoadAll('sales','sales',check);else check();
  return hrfLoading('Loading food cost\u2026');
}

// ── EXPENSES (wastage cross-branch) ──
function pHrfExpenses(){
  var branches=hrfBranches();var filterBranch=NX._hrfExpBranch||'';
  function renderExp(){
    var all=[];
    branches.forEach(function(b){(HRF.waste[b.id]||[]).forEach(function(w){w._branchName=(NX_BRANCHES[b.id]||{}).name||b.id;w._branchId=b.id;all.push(w);});});
    var filtered=filterBranch?all.filter(function(w){return w._branchId===filterBranch;}):all;
    var total=filtered.reduce(function(s,w){return s+parseFloat(w.value||w.cost||w.amount||0);},0);
    var INP='padding:7px 10px;background:var(--surface-2);border:1px solid var(--border);border-radius:8px;color:var(--text-primary);font-family:var(--font);font-size:13px;outline:none';
    var brOpts='<option value="">All Branches</option>'+branches.map(function(b){return '<option value="'+hxe(b.id)+'"'+(filterBranch===b.id?' selected':'')+'>'+hxe(b.name)+'</option>';}).join('');
    var h=hrfHeader('Expenses / Wastage',filtered.length+' entries \u00b7 '+hfsar(total),
      '<select style="'+INP+'" onchange="NX._hrfExpBranch=this.value;navTo(\'hrf-expenses\')">'+brOpts+'</select>');
    var rows='';
    filtered.sort(function(a,b){return (b.date||'').localeCompare(a.date||'');}).slice(0,60).forEach(function(w){
      rows+='<tr><td>'+hxe(w.date||'—')+'</td><td>'+hxe(w._branchName)+'</td>'+
        '<td>'+hxe(w.item||w.name||'—')+'</td><td>'+hxe(w.qty||'—')+' '+hxe(w.unit||'')+'</td>'+
        '<td>'+hxe(w.reason||w.category||'—')+'</td>'+
        '<td style="font-family:var(--mono);color:var(--danger)">'+hfsar(w.value||w.cost||w.amount||0)+'</td>'+
        '<td>'+hxe(w.by||w.reportedBy||'—')+'</td></tr>';
    });
    if(!rows)h+='<div class="empty-state"><div class="es-icon">&#x1F5D1;&#xFE0F;</div><h3>No expense records</h3></div>';
    else h+=hrfTable(['Date','Branch','Item','Qty','Reason','Value','By'],rows);
    return h;
  }
  var cached=branches.filter(function(b){return HRF.waste[b.id];});
  if(cached.length===branches.length)return renderExp();
  hrfLoadAll('waste','waste',function(){navTo('hrf-expenses');});
  return hrfLoading('Loading expenses\u2026');
}

// ── INVOICES ──
function pHrfInvoices(){
  var branches=hrfBranches();
  var filterBranch=NX._hrfInvBranch||'',filterStatus=NX._hrfInvStatus||'all';
  var SC={Pending:'#b45309',Received:'#0057ff',Approved:'#5b21b6',Paid:'#00875a',Overdue:'#c0392b',Disputed:'#b45309'};
  function renderInv(){
    var all=[];
    branches.forEach(function(b){(HRF.invoices[b.id]||[]).forEach(function(i){i._branchName=(NX_BRANCHES[b.id]||{}).name||b.id;i._branchId=b.id;all.push(i);});});
    var filtered=all.filter(function(i){
      if(filterBranch&&i._branchId!==filterBranch)return false;
      if(filterStatus!=='all'&&(i.status||'Pending')!==filterStatus)return false;
      return true;
    });
    var totalAmt=filtered.reduce(function(s,i){return s+parseFloat(i.amount||i.total||0);},0);
    var pending=all.filter(function(i){return i.status==='Pending'||i.status==='Overdue';});
    var INP='padding:7px 10px;background:var(--surface-2);border:1px solid var(--border);border-radius:8px;color:var(--text-primary);font-family:var(--font);font-size:13px;outline:none';
    var brOpts='<option value="">All Branches</option>'+branches.map(function(b){return '<option value="'+hxe(b.id)+'"'+(filterBranch===b.id?' selected':'')+'>'+hxe(b.name)+'</option>';}).join('');
    var stOpts=['all','Pending','Received','Approved','Paid','Overdue','Disputed'].map(function(s){return '<option value="'+s+'"'+(filterStatus===s?' selected':'')+'>'+s+'</option>';}).join('');
    var h=hrfHeader('Supplier Invoices',filtered.length+' invoices \u00b7 '+hfsar(totalAmt),
      '<select style="'+INP+'" onchange="NX._hrfInvBranch=this.value;navTo(\'hrf-invoices\')">'+brOpts+'</select>'+
      '<select style="'+INP+'" onchange="NX._hrfInvStatus=this.value;navTo(\'hrf-invoices\')">'+stOpts+'</select>');
    if(pending.length)h+='<div style="background:rgba(248,113,113,.08);border:1px solid rgba(248,113,113,.25);border-radius:10px;padding:12px 16px;margin-bottom:16px;font-size:13px;color:#c0392b">&#x26A0;&#xFE0F; '+pending.length+' pending/overdue totalling '+hfsar(pending.reduce(function(s,i){return s+parseFloat(i.amount||i.total||0);},0))+'</div>';
    var rows='';
    filtered.sort(function(a,b){return (b.date||'').localeCompare(a.date||'');}).slice(0,50).forEach(function(inv){
      var st=inv.status||'Pending';var col=SC[st]||'#94a3b8';
      rows+='<tr><td><strong>'+hxe(inv.supplier||inv.vendor||'—')+'</strong></td><td>'+hxe(inv._branchName)+'</td>'+
        '<td>'+hxe(inv.category||inv.cat||'—')+'</td><td>'+hxe(inv.date||'—')+'</td>'+
        '<td style="font-family:var(--mono);color:var(--fin-color)">'+hfsar(inv.amount||inv.total||0)+'</td>'+
        '<td>'+hrfBadge(st,col)+'</td><td>'+hxe(inv.ref||inv.poNo||'—')+'</td></tr>';
    });
    if(!rows)h+='<div class="empty-state"><div class="es-icon">&#x1F4CB;</div><h3>No invoices found</h3></div>';
    else h+=hrfTable(['Supplier','Branch','Category','Date','Amount','Status','Ref'],rows);
    return h;
  }
  var cached=branches.filter(function(b){return HRF.invoices[b.id];});
  if(cached.length===branches.length)return renderInv();
  hrfLoadAll('invoices','invoices',function(){navTo('hrf-invoices');});
  return hrfLoading('Loading invoices\u2026');
}

// ── PURCHASE ORDERS (Finance review of received POs from branches) ──
function pHrfPurchaseOrders(){
  function renderPOs(){
    var pos=HRF.financePOs||{};
    var rows=Object.keys(pos).map(function(k){return pos[k];}).sort(function(a,b){return (b.receivedAt||'').localeCompare(a.receivedAt||'');});
    var statusFilter=NX._hrfPOStatus||'pending_finance_review';
    var filtered=rows.filter(function(p){if(!statusFilter)return true;return (p.status||'pending_finance_review')===statusFilter;});
    var totalPending=rows.filter(function(p){return (p.status||'pending_finance_review')==='pending_finance_review';}).length;
    var totalApproved=rows.filter(function(p){return p.status==='finance_approved';}).length;
    var totalRejected=rows.filter(function(p){return p.status==='finance_rejected';}).length;
    var grandTotal=rows.reduce(function(s,p){return s+(parseFloat(p.totalValue)||0);},0);
    var INP='padding:7px 10px;background:var(--surface-2);border:1px solid var(--border);border-radius:8px;color:var(--text-primary);font-family:var(--font);font-size:13px;outline:none';
    var stOpts=['','pending_finance_review','finance_approved','finance_rejected'].map(function(s){
      var lbl=s===''?'All Statuses':s==='pending_finance_review'?'Pending Review':s==='finance_approved'?'Approved':'Rejected';
      return '<option value="'+s+'"'+(statusFilter===s?' selected':'')+'>'+lbl+'</option>';
    }).join('');
    var h=hrfHeader('Purchase Orders \u2014 Finance Review','POs sent from branches awaiting finance verification',
      '<select style="'+INP+'" onchange="NX._hrfPOStatus=this.value;navTo(\'hrf-pos\')">'+stOpts+'</select>');
    h+='<div class="hrf-kpi-grid" style="grid-template-columns:repeat(4,1fr)">';
    h+=hrfKpi('\u23F3','Pending Review',totalPending,'Awaiting finance','#b45309');
    h+=hrfKpi('\u2705','Approved',totalApproved,'Finance approved','#00875a');
    h+=hrfKpi('\u2715','Rejected',totalRejected,'Returned to branch','#c0392b');
    h+=hrfKpi('\uD83D\uDCB0','Total Value',hfsar(grandTotal),'All POs','var(--accent)');
    h+='</div>';
    var tableRows='';
    filtered.forEach(function(p){
      var st=p.status||'pending_finance_review';
      var stCol=st==='finance_approved'?'#00875a':st==='finance_rejected'?'#c0392b':'#b45309';
      var stLbl=st==='finance_approved'?'Approved':st==='finance_rejected'?'Rejected':'Pending';
      var actions='';
      if(st==='pending_finance_review'){
        actions='<button class="btn btn-sm" style="color:#b45309" data-poid="'+hxe(p.id||'')+'" onclick="hrfApprovePO(this.dataset.poid)">\u2713 Approve</button>'+
                ' <button class="btn btn-sm" style="color:var(--danger)" data-poid="'+hxe(p.id||'')+'" onclick="hrfRejectPO(this.dataset.poid)">\u2715 Reject</button>';
      }
      actions+=' <button class="btn btn-sm" data-poid="'+hxe(p.id||'')+'" onclick="hrfViewPO(this.dataset.poid)">View</button>';
      tableRows+='<tr><td style="font-family:var(--mono);font-size:11px;color:var(--ceo)">'+hxe(p.id||'')+'</td>'+
        '<td><strong>'+hxe(p.branchName||'')+'</strong></td>'+
        '<td>'+hxe(p.supplier||'\u2014')+'</td>'+
        '<td style="font-family:var(--mono);font-size:11px">'+hxe((p.receivedAt||'').slice(0,10))+'</td>'+
        '<td style="text-align:center;font-family:var(--mono)">'+(p.items||[]).length+'</td>'+
        '<td style="text-align:right;font-family:var(--mono);font-weight:700">'+hfsar(p.totalValue||0)+'</td>'+
        '<td>'+hrfBadge(stLbl,stCol)+'</td>'+
        '<td><div style="display:flex;gap:4px;justify-content:flex-end">'+actions+'</div></td></tr>';
    });
    if(!tableRows){
      h+='<div class="empty-state"><div class="es-icon">\uD83D\uDED2</div><h3>No purchase orders</h3><p>POs received by branches will appear here automatically</p></div>';
    } else {
      h+=hrfTable(['PO ID','Branch','Supplier','Received','Items','Total','Status','Actions'],tableRows);
    }
    return h;
  }
  if(!db){return '<div class="empty-state"><h3>Firebase not connected</h3></div>';}
  if(!HRF.financePOs){
    db.ref('shared/finance_invoices').once('value',function(snap){
      HRF.financePOs=snap.val()||{};
      navTo('hrf-pos');
    });
    return hrfLoading('Loading purchase orders\u2026');
  }
  return renderPOs();
}
function hrfApprovePO(poId){
  if(!db||!poId)return;
  if(!confirm('Approve this PO and mark as finance-verified?'))return;
  var updates={};
  updates['shared/finance_invoices/'+poId+'/status']='finance_approved';
  updates['shared/finance_invoices/'+poId+'/financeApprovedAt']=new Date().toISOString();
  updates['shared/finance_invoices/'+poId+'/financeApprovedBy']=(NX.session&&NX.session.entityName)||(NX.session&&NX.session.userName)||'';
  db.ref().update(updates,function(err){
    if(err){showToast('Approval failed: '+err.message,'error');return;}
    if(HRF.financePOs&&HRF.financePOs[poId]){
      HRF.financePOs[poId].status='finance_approved';
      HRF.financePOs[poId].financeApprovedAt=updates['shared/finance_invoices/'+poId+'/financeApprovedAt'];
    }
    showToast('PO approved \u2713','success');navTo('hrf-pos');
  });
}
function hrfRejectPO(poId){
  if(!db||!poId)return;
  var reason=prompt('Reason for rejection (visible to branch):','');
  if(reason===null)return;
  var updates={};
  updates['shared/finance_invoices/'+poId+'/status']='finance_rejected';
  updates['shared/finance_invoices/'+poId+'/financeRejectedAt']=new Date().toISOString();
  updates['shared/finance_invoices/'+poId+'/financeRejectedBy']=(NX.session&&NX.session.entityName)||(NX.session&&NX.session.userName)||'';
  updates['shared/finance_invoices/'+poId+'/financeRejectionReason']=reason;
  db.ref().update(updates,function(err){
    if(err){showToast('Rejection failed: '+err.message,'error');return;}
    if(HRF.financePOs&&HRF.financePOs[poId]){
      HRF.financePOs[poId].status='finance_rejected';
      HRF.financePOs[poId].financeRejectionReason=reason;
    }
    showToast('PO rejected','success');navTo('hrf-pos');
  });
}
function hrfViewPO(poId){
  var p=(HRF.financePOs||{})[poId];if(!p){showToast('PO not found','error');return;}
  var rows=(p.items||[]).map(function(it){return '<tr><td style="font-family:var(--mono);font-size:11px;color:var(--ceo)">'+hxe(it.code||'')+'</td><td>'+hxe(it.name||'')+'</td><td style="text-align:center">'+hxe(it.unit||'')+'</td><td style="text-align:right;font-family:var(--mono)">'+(it.qty||0)+'</td><td style="text-align:right;font-family:var(--mono)">'+hfsar(it.price||0)+'</td><td style="text-align:right;font-family:var(--mono);font-weight:700">'+hfsar(it.total||0)+'</td></tr>';}).join('');
  openModal(
    '<div class="modal-head"><h2>'+hxe(p.id||'')+' \u00b7 '+hxe(p.branchName||'')+'</h2><button class="modal-close" onclick="closeModalForce()">\u2715</button></div>'+
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:14px;font-size:12px">'+
      '<div><strong>Supplier:</strong> '+hxe(p.supplier||'\u2014')+'</div>'+
      '<div><strong>Order Date:</strong> '+hxe(p.orderDate||'\u2014')+'</div>'+
      '<div><strong>Received:</strong> '+hxe((p.receivedAt||'').slice(0,16).replace('T',' '))+'</div>'+
      '<div><strong>Received By:</strong> '+hxe(p.receivedBy||'\u2014')+'</div>'+
    '</div>'+
    (p.note?'<div style="font-size:11px;color:var(--text-secondary);background:var(--surface-2);padding:8px 12px;border-radius:8px;margin-bottom:12px"><strong>Note:</strong> '+hxe(p.note)+'</div>':'')+
    '<table class="btbl" style="margin-bottom:12px"><thead><tr><th>Code</th><th>Item</th><th style="text-align:center">Unit</th><th style="text-align:right">Qty</th><th style="text-align:right">Unit Price</th><th style="text-align:right">Total</th></tr></thead><tbody>'+rows+'</tbody><tfoot><tr style="background:var(--surface-2);font-weight:700"><td colspan="5" style="text-align:right">Grand Total</td><td style="text-align:right;font-family:var(--mono);color:var(--accent)">'+hfsar(p.totalValue||0)+'</td></tr></tfoot></table>'+
    (p.financeRejectionReason?'<div style="background:rgba(248,113,113,.1);border:1px solid rgba(248,113,113,.3);padding:10px 14px;border-radius:8px;margin-bottom:10px;font-size:12px"><strong>Rejection reason:</strong> '+hxe(p.financeRejectionReason)+'</div>':'')+
    '<div style="font-size:11px;color:var(--text-tertiary)">Status: <strong>'+hxe(p.status||'pending')+'</strong></div>'
  );
}

// ── DSR SUMMARY ──
function pHrfDsr(){
  var branches=hrfBranches();
  var viewDate=NX._hrfDsrDate||(function(){var d=new Date(new Date().getTime()+3*3600000);return d.toISOString().slice(0,10);})();
  function renderDsr(){
    var rows='',totCash=0,totCard=0,totDel=0,totTotal=0;
    branches.forEach(function(b){
      var bname=(NX_BRANCHES[b.id]||{}).name||b.id;
      var dayRec=(HRF.sales[b.id]||[]).filter(function(e){return e.date===viewDate;});
      if(!dayRec.length){rows+='<tr><td><strong>'+hxe(bname)+'</strong></td><td colspan="5" style="color:var(--text-tertiary);font-style:italic">No data</td></tr>';return;}
      var cash=0,card=0,del=0,total=0;
      dayRec.forEach(function(e){
        cash+=parseFloat(e.cash||0);
        card+=parseFloat(e.card||e.mada||0)+parseFloat(e.visa||0)+parseFloat(e.amex||0);
        del+=parseFloat(e.delivery||0);
        total+=parseFloat(e.actual||e.total||e.amount||0);
      });
      totCash+=cash;totCard+=card;totDel+=del;totTotal+=total;
      rows+='<tr><td><strong>'+hxe(bname)+'</strong></td>'+
        '<td style="font-family:var(--mono);color:var(--fin-color)">'+hfsar(total)+'</td>'+
        '<td style="font-family:var(--mono)">'+hfsar(cash)+'</td>'+
        '<td style="font-family:var(--mono)">'+hfsar(card)+'</td>'+
        '<td style="font-family:var(--mono)">'+hfsar(del)+'</td>'+
        '<td>'+dayRec.length+'</td></tr>';
    });
    rows+='<tr style="background:var(--surface-2);font-weight:700"><td>TOTAL</td>'+
      '<td style="font-family:var(--mono);color:var(--fin-color)">'+hfsar(totTotal)+'</td>'+
      '<td style="font-family:var(--mono)">'+hfsar(totCash)+'</td>'+
      '<td style="font-family:var(--mono)">'+hfsar(totCard)+'</td>'+
      '<td style="font-family:var(--mono)">'+hfsar(totDel)+'</td><td>—</td></tr>';
    var INP='padding:7px 10px;background:var(--surface-2);border:1px solid var(--border);border-radius:8px;color:var(--text-primary);font-family:var(--font);font-size:13px;outline:none';
    var h=hrfHeader('DSR Summary','Daily Sales Report \u00b7 '+viewDate,
      '<input type="date" value="'+hxe(viewDate)+'" style="'+INP+'" onchange="NX._hrfDsrDate=this.value;navTo(\'hrf-dsr\')">');
    h+='<div class="hrf-kpi-grid">';
    h+=hrfKpi('&#x1F4B0;','Total Sales',hfsar(totTotal),viewDate,'var(--fin-color)');
    h+=hrfKpi('&#x1F4B5;','Cash',hfsar(totCash),'Cash sales','var(--payroll-color)');
    h+=hrfKpi('&#x1F4B3;','Card',hfsar(totCard),'MADA/VISA/AMEX','var(--info)');
    h+=hrfKpi('&#x1F6F5;','Delivery',hfsar(totDel),'Aggregators','#b45309');
    h+='</div>';
    h+=hrfTable(['Branch','Total Sales','Cash','Card','Delivery','Entries'],rows);
    return h;
  }
  var cached=branches.filter(function(b){return HRF.sales[b.id];});
  if(cached.length===branches.length)return renderDsr();
  hrfLoadAll('sales','sales',function(){navTo('hrf-dsr');});
  return hrfLoading('Loading DSR data\u2026');
}

// ── APPROVALS ──
function pHrfApprovals(){
  var branches=hrfBranches();
  var s=NX.session||{};
  var isHR=s.role==='hr_manager';
  function renderApprovals(){
    var pendLeaves=[],pendExpenses=[];
    branches.forEach(function(b){
      (HRF.leaves[b.id]||[]).forEach(function(l){
        if((l.status||'pending')==='pending'){l._branchId=b.id;l._branchName=(NX_BRANCHES[b.id]||{}).name||b.id;pendLeaves.push(l);}
      });
      (HRF.waste[b.id]||[]).forEach(function(w){
        if(!w.approved&&(!w.status||w.status==='pending')){w._branchId=b.id;w._branchName=(NX_BRANCHES[b.id]||{}).name||b.id;pendExpenses.push(w);}
      });
    });
    var h=hrfHeader('Approvals',(pendLeaves.length+pendExpenses.length)+' items pending','');
    if(isHR&&pendLeaves.length){
      h+='<div class="hrf-section"><div style="font-size:14px;font-weight:700;margin-bottom:14px">&#x1F3D6;&#xFE0F; Leave Requests ('+pendLeaves.length+')</div>';
      pendLeaves.forEach(function(lv){
        h+='<div class="hrf-approval-card">'+
          '<div style="width:40px;height:40px;border-radius:10px;background:rgba(96,165,250,.15);display:flex;align-items:center;justify-content:center;font-size:18px;flex-shrink:0">&#x1F3D6;&#xFE0F;</div>'+
          '<div style="flex:1"><div style="font-size:13px;font-weight:700;color:var(--text-primary)">'+hxe(lv.empName||lv.name||'—')+'</div>'+
          '<div style="font-size:12px;color:var(--text-secondary);margin-bottom:4px">'+hxe(lv._branchName)+' \u00b7 '+hxe(lv.type||'Leave')+' \u00b7 '+hxe(lv.from||'')+' &rarr; '+hxe(lv.to||'')+'</div>'+
          '<div style="display:flex;gap:6px">'+
          '<button class="btn btn-sm" style="background:rgba(52,211,153,.15);border-color:rgba(52,211,153,.3);color:#b45309" onclick="hrfApproveLeave(\''+hxe(lv._branchId)+'\',\''+hxe(lv._key||lv.id||'')+'\')">&#x2713; Approve</button>'+
          '<button class="btn btn-sm" style="background:rgba(248,113,113,.1);border-color:rgba(248,113,113,.25);color:#c0392b" onclick="hrfRejectLeave(\''+hxe(lv._branchId)+'\',\''+hxe(lv._key||lv.id||'')+'\')">&#x2715; Reject</button>'+
          '</div></div></div>';
      });
      h+='</div>';
    }
    if(!isHR&&pendExpenses.length){
      h+='<div class="hrf-section"><div style="font-size:14px;font-weight:700;margin-bottom:14px">&#x1F9FE; Pending Expenses ('+pendExpenses.length+')</div>';
      pendExpenses.slice(0,10).forEach(function(w){
        h+='<div class="hrf-approval-card">'+
          '<div style="width:40px;height:40px;border-radius:10px;background:rgba(245,158,11,.15);display:flex;align-items:center;justify-content:center;font-size:18px;flex-shrink:0">&#x1F9FE;</div>'+
          '<div style="flex:1"><div style="font-size:13px;font-weight:700;color:var(--text-primary)">'+hxe(w.item||w.name||'Wastage Entry')+'</div>'+
          '<div style="font-size:12px;color:var(--text-secondary);margin-bottom:4px">'+hxe(w._branchName)+' \u00b7 '+hxe(w.date||'')+' \u00b7 '+hfsar(w.value||w.amount||0)+'</div>'+
          '<div style="display:flex;gap:6px">'+
          '<button class="btn btn-sm" style="background:rgba(52,211,153,.15);border-color:rgba(52,211,153,.3);color:#b45309" onclick="hrfApproveExpense(\''+hxe(w._branchId)+'\',\''+hxe(w._key||w.id||'')+'\')">&#x2713; Approve</button>'+
          '<button class="btn btn-sm" style="background:rgba(248,113,113,.1);border-color:rgba(248,113,113,.25);color:#c0392b" onclick="hrfRejectExpense(\''+hxe(w._branchId)+'\',\''+hxe(w._key||w.id||'')+'\')">&#x2715; Reject</button>'+
          '</div></div></div>';
      });
      h+='</div>';
    }
    if(!pendLeaves.length&&!pendExpenses.length)h+='<div class="empty-state"><div class="es-icon">&#x2705;</div><h3>All clear!</h3><p>No pending approvals</p></div>';
    return h;
  }
  var c1=branches.filter(function(b){return HRF.leaves[b.id];}).length;
  var c2=branches.filter(function(b){return HRF.waste[b.id];}).length;
  if(c1===branches.length&&c2===branches.length)return renderApprovals();
  var done=0;function check(){done++;if(done>=2)navTo('hrf-approvals');}
  if(c1<branches.length)hrfLoadAll('tsLeaves','leaves',function(){branches.forEach(function(b){(HRF.leaves[b.id]||[]).forEach(function(l){l._branchId=b.id;});});check();});else check();
  if(c2<branches.length)hrfLoadAll('waste','waste',check);else check();
  return hrfLoading('Loading approvals\u2026');
}

// ── HR REPORT ──
function pHrfHrReport(){
  var branches=hrfBranches();
  function renderHRR(){
    var allStaff=[],allLeaves=[];
    branches.forEach(function(b){
      (HRF.staff[b.id]||[]).forEach(function(m){m._branchName=(NX_BRANCHES[b.id]||{}).name||b.id;allStaff.push(m);});
      allLeaves=allLeaves.concat(HRF.leaves[b.id]||[]);
    });
    var active=allStaff.filter(function(m){return (m.status||'Active')==='Active';});
    var onLeave=allStaff.filter(function(m){return m.status==='On Leave';});
    var resigned=allStaff.filter(function(m){return m.status==='Resigned';});
    var appr=allLeaves.filter(function(l){return l.status==='approved';});
    var pend=allLeaves.filter(function(l){return (l.status||'pending')==='pending';});
    var deptCounts={},natCounts={};
    allStaff.forEach(function(m){
      var d=m.dept||'Other';deptCounts[d]=(deptCounts[d]||0)+1;
      var n=m.nationality||'Unknown';natCounts[n]=(natCounts[n]||0)+1;
    });
    var h=hrfHeader('HR Report','Live summary \u00b7 All branches','<button class="btn" onclick="window.print()">&#x1F5A8;&#xFE0F; Print</button>');
    h+='<div class="hrf-kpi-grid">';
    h+=hrfKpi('&#x1F465;','Total Staff',allStaff.length,branches.length+' branches','var(--hr-color)');
    h+=hrfKpi('&#x2705;','Active',active.length,'Currently employed','#00875a');
    h+=hrfKpi('&#x1F3D6;&#xFE0F;','On Leave',onLeave.length,'Approved leave','#b45309');
    h+=hrfKpi('&#x1F6AA;','Resigned',resigned.length,'Separated','#c0392b');
    h+=hrfKpi('&#x1F4CB;','Leaves Approved',appr.length,'All time','var(--info)');
    h+=hrfKpi('&#x23F3;','Leave Pending',pend.length,'Awaiting decision','var(--warning)');
    h+='</div>';
    var deptRows='';
    Object.keys(deptCounts).sort().forEach(function(dept){
      deptRows+='<tr><td><strong>'+hxe(dept)+'</strong></td>'+
        '<td style="font-family:var(--mono);color:var(--hr-color)">'+deptCounts[dept]+'</td>'+
        '<td style="font-family:var(--mono);color:var(--text-secondary)">'+(allStaff.length?(deptCounts[dept]/allStaff.length*100).toFixed(1)+'%':'—')+'</td></tr>';
    });
    h+='<div class="hrf-section"><div style="font-size:14px;font-weight:700;margin-bottom:14px">By Department</div>';
    h+=hrfTable(['Department','Count','% of Total'],deptRows)+'</div>';
    var natRows='';
    Object.keys(natCounts).sort(function(a,b){return natCounts[b]-natCounts[a];}).forEach(function(nat){
      natRows+='<tr><td>'+hxe(nat)+'</td>'+
        '<td style="font-family:var(--mono)">'+natCounts[nat]+'</td>'+
        '<td style="font-family:var(--mono);color:var(--text-secondary)">'+(allStaff.length?(natCounts[nat]/allStaff.length*100).toFixed(1)+'%':'—')+'</td></tr>';
    });
    h+='<div class="hrf-section"><div style="font-size:14px;font-weight:700;margin-bottom:14px">Nationality Breakdown</div>';
    h+=hrfTable(['Nationality','Count','%'],natRows)+'</div>';
    return h;
  }
  var c1=branches.filter(function(b){return HRF.staff[b.id];}).length;
  var c2=branches.filter(function(b){return HRF.leaves[b.id];}).length;
  if(c1===branches.length&&c2===branches.length)return renderHRR();
  var done=0;function check(){done++;if(done>=2)navTo('hrf-hr-report');}
  if(c1<branches.length)hrfLoadAll('staff','staff',check);else check();
  if(c2<branches.length)hrfLoadAll('tsLeaves','leaves',check);else check();
  return hrfLoading('Building HR report\u2026');
}

// ── FINANCE REPORT ──
function pHrfFinReport(){
  var branches=hrfBranches();
  function renderFinR(){
    var d=new Date(new Date().getTime()+3*3600000);var curYear=d.getFullYear();
    var revB={},wasteB={},pcB={},invB={};
    var totRev=0,totWaste=0,totPC=0,totInv=0;
    branches.forEach(function(b){
      var bname=(NX_BRANCHES[b.id]||{}).name||b.id;
      var r=0,w=0,p=0,i=0;
      (HRF.sales[b.id]||[]).forEach(function(e){r+=parseFloat(e.actual||e.total||e.amount||0);});
      (HRF.waste[b.id]||[]).forEach(function(x){w+=parseFloat(x.value||x.cost||x.amount||0);});
      (HRF.pc[b.id]||[]).forEach(function(x){p+=parseFloat(x.amount||0);});
      (HRF.invoices[b.id]||[]).forEach(function(x){i+=parseFloat(x.amount||x.total||0);});
      revB[bname]=r;wasteB[bname]=w;pcB[bname]=p;invB[bname]=i;
      totRev+=r;totWaste+=w;totPC+=p;totInv+=i;
    });
    var h=hrfHeader('Finance Report',curYear+' \u00b7 All branches \u00b7 Real Firebase data','<button class="btn" onclick="window.print()">&#x1F5A8;&#xFE0F; Print</button>');
    h+='<div class="hrf-kpi-grid">';
    h+=hrfKpi('&#x1F4B0;','Total Revenue',hfsar(totRev),'All time in DB','var(--fin-color)');
    h+=hrfKpi('&#x1F5D1;&#xFE0F;','Total Wastage',hfsar(totWaste),'Recorded losses','var(--danger)');
    h+=hrfKpi('&#x1F4B5;','Petty Cash',hfsar(totPC),'Operational spend','var(--warning)');
    h+=hrfKpi('&#x1F4CB;','Invoice Total',hfsar(totInv),'Supplier invoices','var(--info)');
    h+='</div>';
    var rows='';
    Object.keys(revB).sort().forEach(function(bname){
      var rev=revB[bname],costs=wasteB[bname]+pcB[bname],net=rev-costs;
      var nc=net>=0?'#00875a':'#c0392b';
      rows+='<tr><td><strong>'+hxe(bname)+'</strong></td>'+
        '<td style="font-family:var(--mono);color:var(--fin-color)">'+hfsar(rev)+'</td>'+
        '<td style="font-family:var(--mono);color:var(--danger)">'+hfsar(wasteB[bname])+'</td>'+
        '<td style="font-family:var(--mono);color:var(--warning)">'+hfsar(pcB[bname])+'</td>'+
        '<td style="font-family:var(--mono);color:var(--info)">'+hfsar(invB[bname])+'</td>'+
        '<td style="font-family:var(--mono);color:'+nc+';font-weight:700">'+hfsar(net)+'</td></tr>';
    });
    h+='<div class="hrf-section" style="margin-top:20px"><div style="font-size:13px;font-weight:700;margin-bottom:12px">Branch Financial Summary</div>';
    h+=hrfTable(['Branch','Revenue','Wastage','Petty Cash','Invoices','Net (approx.)'],rows)+'</div>';
    h+='<p style="font-size:11px;color:var(--text-tertiary);margin-top:8px">&#x26A0;&#xFE0F; Net is approximate. Full P&amp;L requires payroll, depreciation, and overhead data.</p>';
    return h;
  }
  var c1=branches.filter(function(b){return HRF.sales[b.id];}).length;
  var c2=branches.filter(function(b){return HRF.waste[b.id];}).length;
  var c3=branches.filter(function(b){return HRF.pc[b.id];}).length;
  var c4=branches.filter(function(b){return HRF.invoices[b.id];}).length;
  if(c1===branches.length&&c2===branches.length&&c3===branches.length&&c4===branches.length)return renderFinR();
  var done=0;function check(){done++;if(done>=4)navTo('hrf-fin-report');}
  if(c1<branches.length)hrfLoadAll('sales','sales',check);else check();
  if(c2<branches.length)hrfLoadAll('waste','waste',check);else check();
  if(c3<branches.length)hrfLoadAll('pc','pc',check);else check();
  if(c4<branches.length)hrfLoadAll('invoices','invoices',check);else check();
  return hrfLoading('Building finance report\u2026');
}

// ── ACTION HANDLERS ──
function hrfApproveLeave(branchId,key){
  if(!key){showToast('Cannot approve: missing record key','error');return;}
  if(db){
    db.ref('branches/'+branchId+'/tsLeaves/'+key+'/status').set('approved',function(err){
      if(err){showToast('Error: '+err.message,'error');return;}
      if(HRF.leaves[branchId])HRF.leaves[branchId].forEach(function(l){if((l._key||l.id||'')===key)l.status='approved';});
      showToast('Leave approved \u2713','success');navTo(NX.page);
    });
  } else {
    if(HRF.leaves[branchId])HRF.leaves[branchId].forEach(function(l){if((l._key||l.id||'')===key)l.status='approved';});
    showToast('Approved (offline)','success');navTo(NX.page);
  }
}

function hrfRejectLeave(branchId,key){
  if(!key){showToast('Cannot reject: missing record key','error');return;}
  if(db){
    db.ref('branches/'+branchId+'/tsLeaves/'+key+'/status').set('rejected',function(err){
      if(err){showToast('Error: '+err.message,'error');return;}
      if(HRF.leaves[branchId])HRF.leaves[branchId].forEach(function(l){if((l._key||l.id||'')===key)l.status='rejected';});
      showToast('Leave rejected','warning');navTo(NX.page);
    });
  } else {
    if(HRF.leaves[branchId])HRF.leaves[branchId].forEach(function(l){if((l._key||l.id||'')===key)l.status='rejected';});
    showToast('Rejected (offline)','warning');navTo(NX.page);
  }
}

function hrfApproveExpense(branchId,key){
  if(!key){showToast('Cannot approve: missing key','error');return;}
  if(db){db.ref('branches/'+branchId+'/waste/'+key+'/approved').set(true,function(err){if(!err){showToast('Expense approved \u2713','success');navTo(NX.page);}});}
  else showToast('Approved (offline)','success');
}

function hrfRejectExpense(branchId,key){
  if(!key){showToast('Cannot reject: missing key','error');return;}
  if(db){db.ref('branches/'+branchId+'/waste/'+key+'/status').set('rejected',function(err){if(!err){showToast('Expense rejected','warning');navTo(NX.page);}});}
  else showToast('Rejected (offline)','warning');
}

function hrfOpenLeaveModal(){
  var branches=hrfBranches();
  var brOpts=branches.map(function(b){return '<option value="'+hxe(b.id)+'">'+hxe(b.name)+'</option>';}).join('');
  var html='<div class="modal-head"><h2>New Leave Request</h2><button class="modal-close" onclick="closeModalForce()">&#x2715;</button></div>';
  html+='<div class="form-row"><div class="form-group"><label class="form-label">Branch</label><select class="form-input form-select" id="hrf-lv-branch">'+brOpts+'</select></div>'+
    '<div class="form-group"><label class="form-label">Employee Name</label><input class="form-input" id="hrf-lv-name" placeholder="Staff name\u2026"></div></div>';
  html+='<div class="form-row"><div class="form-group"><label class="form-label">Leave Type</label><select class="form-input form-select" id="hrf-lv-type"><option>Annual Leave</option><option>Sick Leave</option><option>Emergency Leave</option><option>Unpaid Leave</option></select></div>'+
    '<div class="form-group"><label class="form-label">Days</label><input class="form-input" type="number" id="hrf-lv-days" min="1" placeholder="1"></div></div>';
  html+='<div class="form-row"><div class="form-group"><label class="form-label">From</label><input class="form-input" type="date" id="hrf-lv-from"></div>'+
    '<div class="form-group"><label class="form-label">To</label><input class="form-input" type="date" id="hrf-lv-to"></div></div>';
  html+='<div class="modal-actions"><button class="btn" onclick="closeModalForce()">Cancel</button><button class="btn btn-primary" onclick="hrfSubmitLeave()">Submit</button></div>';
  openModal(html);
}

function hrfSubmitLeave(){
  var bid=document.getElementById('hrf-lv-branch')&&document.getElementById('hrf-lv-branch').value;
  var name=document.getElementById('hrf-lv-name')&&document.getElementById('hrf-lv-name').value.trim();
  var type=document.getElementById('hrf-lv-type')&&document.getElementById('hrf-lv-type').value;
  var from=document.getElementById('hrf-lv-from')&&document.getElementById('hrf-lv-from').value;
  var to=document.getElementById('hrf-lv-to')&&document.getElementById('hrf-lv-to').value;
  var days=parseInt((document.getElementById('hrf-lv-days')&&document.getElementById('hrf-lv-days').value)||1,10);
  if(!name||!from||!to){showToast('Fill all required fields','error');return;}
  var rec={empName:name,type:type,from:from,to:to,days:days,status:'pending',createdAt:new Date().toISOString()};
  if(db){
    db.ref('branches/'+bid+'/tsLeaves').push(rec,function(err){
      if(err){showToast('Error: '+err.message,'error');return;}
      HRF.leaves[bid]=null;
      showToast('Leave request submitted \u2713','success');
      closeModalForce();navTo('hrf-leave');
    });
  } else showToast('Offline \u2014 cannot save','error');
}

function hrfExportEmployees(){
  var branches=hrfBranches();
  var HEADERS=[
    'name','sap','email','phone','dept','role','status','nationality',
    'branch','workerType','companyId',
    'hireDate','contractType','contractEndDate','probationEnd','shift',
    'basicSalary','housingAllowance','transportAllowance','otherAllowances','gosiEnrolled',
    'leaveBalance','annualLeave',
    'iqama','iqamaExpiry',
    'bankName','iban',
    'emergencyName','emergencyPhone',
    'hrNotes'
  ];
  var rows=[HEADERS.join(',')];
  branches.forEach(function(b){
    var bname=(NX_BRANCHES[b.id]||{}).name||b.id;
    (HRF.staff[b.id]||[]).forEach(function(m){
      var vals=HEADERS.map(function(h){
        var v=h==='branch'?bname:(m[h]!==undefined&&m[h]!==null?m[h]:'');
        return '"'+String(v).replace(/"/g,'""')+'"';
      });
      rows.push(vals.join(','));
    });
  });
  var blob=new Blob([rows.join('\n')],{type:'text/csv'});
  var a=document.createElement('a');
  a.href=URL.createObjectURL(blob);
  a.download='employees_'+new Date().toISOString().slice(0,10)+'.csv';
  a.click();
  showToast('Export complete — '+( rows.length-1)+' employees','success');
}

function hrfOpenImportModal(){
  var h='<div class="modal-head"><h2>⬆ Import Employees (CSV)</h2><button class="modal-close" onclick="closeModalForce()">✕</button></div>';
  h+='<div style="background:var(--surface-2);border-radius:10px;padding:12px 14px;margin-bottom:14px;font-size:11px;color:var(--text-secondary);line-height:1.8">';
  h+='<strong style="color:var(--text-primary)">Required columns:</strong> <code>name, sap, branch</code><br>';
  h+='<strong style="color:var(--text-primary)">Optional columns:</strong> email, phone, dept, role, status, nationality, workerType, hireDate, contractType, contractEndDate, probationEnd, shift, basicSalary, housingAllowance, transportAllowance, otherAllowances, gosiEnrolled, leaveBalance, iqama, iqamaExpiry, bankName, iban, emergencyName, emergencyPhone, hrNotes<br>';
  h+='<strong style="color:var(--text-primary)">Tip:</strong> Use the Export CSV first to get the exact format, fill it in Excel, then import.';
  h+='</div>';
  h+='<div class="bfg"><label class="form-label">Select CSV File</label>';
  h+='<input type="file" id="hrf-imp-file" accept=".csv,.txt" style="width:100%;background:var(--surface-2);border:1px solid var(--border);border-radius:8px;padding:10px;font-family:var(--font);font-size:12px;color:var(--text-primary)" onchange="hrfPreviewImport(this)"></div>';
  h+='<div id="hrf-imp-preview" style="margin-top:12px"></div>';
  h+='<div style="display:flex;gap:10px;justify-content:flex-end;margin-top:14px">';
  h+='<button class="btn" onclick="closeModalForce()">Cancel</button>';
  h+='<button class="btn btn-primary" id="hrf-imp-btn" disabled onclick="hrfDoImport()">⬆ Import All</button>';
  h+='</div>';
  openModal(h);
}

window._hrfImportRows=[];

function hrfPreviewImport(input){
  var file=input.files[0];if(!file)return;
  var reader=new FileReader();
  reader.onload=function(e){
    var txt=e.target.result;
    var parsed=hrfParseCSV(txt);
    window._hrfImportRows=parsed.rows;
    var prev=document.getElementById('hrf-imp-preview');
    var btn=document.getElementById('hrf-imp-btn');
    if(!parsed.rows.length){
      if(prev)prev.innerHTML='<div style="color:var(--danger);font-size:12px;padding:10px">No valid rows found. Check your CSV format.</div>';
      if(btn)btn.disabled=true;return;
    }
    // Show preview table — first 5 rows
    var cols=['name','sap','branch','dept','role','status','basicSalary'];
    var tbl='<div style="font-size:11px;font-weight:700;color:var(--text-secondary);margin-bottom:6px">Preview — '+parsed.rows.length+' rows found (showing first 5)</div>';
    tbl+='<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:11px">';
    tbl+='<thead><tr>'+cols.map(function(c){return '<th style="padding:5px 8px;text-align:left;background:var(--surface-2);border:1px solid var(--border);font-weight:700;color:var(--text-secondary)">'+c+'</th>';}).join('')+'</tr></thead><tbody>';
    parsed.rows.slice(0,5).forEach(function(r,ri){
      tbl+='<tr>'+cols.map(function(c){return '<td style="padding:5px 8px;border:1px solid var(--border);color:var(--text-primary)'+(ri%2?';background:var(--surface-2)':'')+'">'+(r[c]||'—')+'</td>';}).join('')+'</tr>';
    });
    tbl+='</tbody></table></div>';
    if(prev)prev.innerHTML=tbl;
    if(btn)btn.disabled=false;
  };
  reader.readAsText(file);
}

function hrfParseCSV(txt){
  var lines=txt.split(/\r?\n/).filter(function(l){return l.trim();});
  if(!lines.length)return{headers:[],rows:[]};
  function splitLine(l){
    var res=[],cur='',inQ=false;
    for(var i=0;i<l.length;i++){
      var c=l[i];
      if(c==='"'){if(inQ&&l[i+1]==='"'){cur+='"';i++;}else inQ=!inQ;}
      else if(c===','&&!inQ){res.push(cur.trim());cur='';}
      else cur+=c;
    }
    res.push(cur.trim());return res;
  }
  var headers=splitLine(lines[0]).map(function(h){return h.toLowerCase().replace(/[^a-z0-9]/g,'');});
  var rows=[];
  lines.slice(1).forEach(function(l){
    if(!l.trim())return;
    var vals=splitLine(l);
    var row={};
    headers.forEach(function(h,i){row[h]=vals[i]||'';});
    if(row.name)rows.push(row);
  });
  return{headers:headers,rows:rows};
}

function hrfDoImport(){
  var rows=window._hrfImportRows||[];
  if(!rows.length){showToast('No rows to import','error');return;}
  if(!db){showToast('Firebase not connected','error');return;}
  var branches=hrfBranches();
  // Group rows by branch name
  var byBranch={};
  rows.forEach(function(r){
    var bname=(r.branch||'').toLowerCase().trim();
    var branch=branches.find(function(b){
      return (NX_BRANCHES[b.id]||{}).name.toLowerCase()===bname||b.id.toLowerCase()===bname;
    });
    if(!branch){showToast('Branch not found for: '+r.name+' ('+r.branch+')','warning');return;}
    if(!byBranch[branch.id])byBranch[branch.id]=[];
    byBranch[branch.id].push(r);
  });
  var branchIds=Object.keys(byBranch);
  if(!branchIds.length){showToast('No valid branch matches found','error');return;}
  var done=0,total=branchIds.length;
  function toObj(arr){
    var obj={};
    arr.forEach(function(item){
      if(!item)return;
      var k=String(item.id||'').replace(/[.#$\[\]\/]/g,'_')||'item_'+Math.random().toString(36).slice(2);
      obj[k]=item;
    });
    return obj;
  }
  branchIds.forEach(function(bid){
    var existing=(HRF.staff[bid]||[]).slice();
    byBranch[bid].forEach(function(r){
      var newRec={
        id:buid(),
        name:r.name||'',
        sap:r.sap||'',
        email:r.email||'',
        phone:r.phone||'',
        dept:normalizeDept(r.dept||''),
        role:r.role||'',
        status:r.status||'Active',
        nationality:r.nationality||'',
        workerType:r.workertype||r.workerType||'company',
        companyId:r.companyid||r.companyId||'',
        hireDate:r.hiredate||r.hireDate||'',
        joinDate:r.hiredate||r.hireDate||'',
        contractType:r.contracttype||r.contractType||'Full-Time',
        contractEndDate:r.contractenddate||r.contractEndDate||'',
        probationEnd:r.probationend||r.probationEnd||'',
        shift:r.shift||'',
        defaultShift:r.shift||'',
        basicSalary:parseFloat(r.basicsalary||r.basicSalary)||0,
        salary:parseFloat(r.basicsalary||r.basicSalary)||0,
        housingAllowance:parseFloat(r.housingallowance||r.housingAllowance)||0,
        transportAllowance:parseFloat(r.transportallowance||r.transportAllowance)||0,
        otherAllowances:parseFloat(r.otherallowances||r.otherAllowances)||0,
        gosiEnrolled:r.gosienrolled||r.gosiEnrolled||'yes',
        leaveBalance:parseInt(r.leavebalance||r.leaveBalance)||21,
        annualLeave:parseInt(r.leavebalance||r.leaveBalance)||21,
        iqama:r.iqama||'',
        iqamaExpiry:r.iqamaexpiry||r.iqamaExpiry||'',
        bankName:r.bankname||r.bankName||'',
        iban:r.iban||'',
        emergencyName:r.emergencyname||r.emergencyName||'',
        emergencyPhone:r.emergencyphone||r.emergencyPhone||'',
        hrNotes:r.hrnotes||r.hrNotes||'',
        branchId:bid
      };
      // If SAP already exists — update, else add
      var idx=existing.findIndex(function(x){return x.sap&&x.sap===newRec.sap;});
      if(idx>=0)existing[idx]=Object.assign({},existing[idx],newRec,{id:existing[idx].id});
      else existing.push(newRec);
    });
    HRF.staff[bid]=existing;
    db.ref('branches/'+bid+'/staff').set(toObj(existing),function(err){
      if(err){showToast('Error saving to '+bid+': '+err.message,'error');return;}
      _hrfWriteSapIndex(bid,existing);
      done++;
      if(done===total){
        closeModalForce();
        showToast('✓ Imported '+rows.length+' employees across '+total+' branch(es)','success');
        navTo('hrf-employees');
      }
    });
  });
}

// ── CHART RENDERERS ──
function hrfChartDefaults(){
  var dark=(NX.theme||'dark')!=='light';
  return {grid:dark?'rgba(255,255,255,.04)':'rgba(0,0,0,.05)',tick:dark?'rgba(255,255,255,.32)':'rgba(0,0,0,.38)',tooltip:dark?'rgba(10,12,20,.95)':'rgba(255,255,255,.95)'};
}

function hrfMkChart(id,config){
  var el=document.getElementById(id);if(!el)return;
  try{if(NX.charts[id]){NX.charts[id].destroy();}NX.charts[id]=new Chart(el.getContext('2d'),config);}
  catch(e){console.warn('HRF chart error:',id,e);}
}

function hrfBaseOpts(extra){
  var c=hrfChartDefaults();
  var base={responsive:true,maintainAspectRatio:false,
    plugins:{legend:{labels:{color:c.tick,font:{family:'Plus Jakarta Sans',size:11},boxWidth:10,boxHeight:10,borderRadius:3}},
      tooltip:{backgroundColor:c.tooltip,borderColor:'rgba(255,255,255,.12)',borderWidth:1,titleColor:c.tick,bodyColor:c.tick,padding:10}},
    scales:{x:{grid:{color:c.grid},ticks:{color:c.tick,font:{family:'Plus Jakarta Sans',size:10}}},
      y:{grid:{color:c.grid},ticks:{color:c.tick,font:{family:'Plus Jakarta Sans',size:10}}}}};
  if(extra)Object.assign(base,extra);
  return base;
}

function hrfInitDeptChart(){
  var allStaff=NX._hrfAllStaff||[];
  var depts={};allStaff.forEach(function(m){var d=m.dept||'Other';depts[d]=(depts[d]||0)+1;});
  var labels=Object.keys(depts);
  var colors=['#5b21b6','#00875a','#0057ff','#b45309','#c0392b','#94a3b8','#b45309'];
  hrfMkChart('hrf-chart-dept',{type:'doughnut',
    data:{labels:labels,datasets:[{data:Object.values(depts),backgroundColor:colors.map(function(c){return c+'88';}),borderColor:colors,borderWidth:2,hoverOffset:6}]},
    options:{responsive:true,maintainAspectRatio:false,cutout:'65%',
      plugins:{legend:{position:'right',labels:{color:hrfChartDefaults().tick,font:{family:'Plus Jakarta Sans',size:11},padding:12,boxWidth:10,boxHeight:10}}}}});
}

function hrfInitAttTrendChart(){
  var c=hrfChartDefaults();var branches=hrfBranches();
  var days=[];
  for(var i=6;i>=0;i--){var d=new Date(new Date().getTime()+3*3600000);d.setDate(d.getDate()-i);days.push(d.toISOString().slice(0,10));}
  var present=[],late=[],absent=[];
  days.forEach(function(day){
    var p=0,l=0,a=0;
    branches.forEach(function(b){var att=(HRF.att[b.id]||{})[day]||{};Object.values(att).forEach(function(r){if(r.status==='present')p++;else if(r.status==='late')l++;else a++;});});
    present.push(p);late.push(l);absent.push(a);
  });
  hrfMkChart('hrf-chart-att-trend',{type:'bar',
    data:{labels:days.map(function(d){return d.slice(5);}),datasets:[
      {label:'Present',data:present,backgroundColor:'rgba(0,229,255,.3)',borderColor:'#0057ff',borderWidth:2,borderRadius:4},
      {label:'Late',data:late,backgroundColor:'rgba(255,209,102,.3)',borderColor:'#b45309',borderWidth:2,borderRadius:4},
      {label:'Absent',data:absent,backgroundColor:'rgba(248,113,113,.2)',borderColor:'#c0392b',borderWidth:2,borderRadius:4}
    ]},options:hrfBaseOpts()});
}

function hrfInitRevCostChart(){
  var d=new Date(new Date().getTime()+3*3600000);
  var curMo=d.getMonth();
  // Use pre-computed YTD data if available (set by new finance dashboard)
  if(NX._hrfRevByMo&&NX._hrfCostsByMo){
    var labels=HRF_MONTHS.slice(0,curMo+1);
    hrfMkChart('hrf-chart-rev-cost',{type:'bar',
      data:{labels:labels,datasets:[
        {label:'Revenue',data:NX._hrfRevByMo.slice(0,curMo+1),backgroundColor:'rgba(52,211,153,.25)',borderColor:'#00875a',borderWidth:2,borderRadius:4},
        {label:'Costs',data:NX._hrfCostsByMo.slice(0,curMo+1),backgroundColor:'rgba(248,113,113,.2)',borderColor:'#c0392b',borderWidth:2,borderRadius:4}
      ]},options:hrfBaseOpts()});
    return;
  }
  // Fallback: compute from raw data (last 6 months)
  var months=[];for(var i=5;i>=0;i--){var mo=(d.getMonth()-i+12)%12;months.push({mo:mo,label:HRF_MONTHS[mo]});}
  var rev=[],costs=[];
  months.forEach(function(m){
    var r=0,wc=0,pc=0;
    hrfBranches().forEach(function(b){
      (HRF.sales[b.id]||[]).forEach(function(e){if(e.date&&parseInt(e.date.slice(5,7),10)-1===m.mo)r+=parseFloat(e.actual||e.total||e.amount||0);});
      (HRF.waste[b.id]||[]).forEach(function(w){if(w.date&&parseInt(w.date.slice(5,7),10)-1===m.mo)wc+=parseFloat(w.value||w.cost||w.amount||0);});
      (HRF.pc[b.id]||[]).forEach(function(p){if(p.date&&parseInt(p.date.slice(5,7),10)-1===m.mo)pc+=parseFloat(p.amount||0);});
    });
    rev.push(r);costs.push(wc+pc);
  });
  hrfMkChart('hrf-chart-rev-cost',{type:'bar',
    data:{labels:months.map(function(m){return m.label;}),datasets:[
      {label:'Revenue',data:rev,backgroundColor:'rgba(52,211,153,.25)',borderColor:'#00875a',borderWidth:2,borderRadius:4},
      {label:'Costs',data:costs,backgroundColor:'rgba(248,113,113,.2)',borderColor:'#c0392b',borderWidth:2,borderRadius:4}
    ]},options:hrfBaseOpts()});
}

function hrfInitCostPieChart(){
  var c=hrfChartDefaults();
  // Show payment method breakdown (Cash / Card / Delivery / Other)
  var cashCardDel=NX._hrfCashCardDel||[];
  if(cashCardDel.length===4&&cashCardDel.some(function(v){return v>0;})){
    hrfMkChart('hrf-chart-cost-pie',{type:'doughnut',
      data:{labels:['Cash','Card','Delivery','Other'],
        datasets:[{data:cashCardDel,backgroundColor:['rgba(52,211,153,.7)','rgba(96,165,250,.7)','rgba(251,146,60,.7)','rgba(148,163,184,.4)'],borderColor:['#00875a','#3b82f6','#f97316','#94a3b8'],borderWidth:2}]},
      options:{responsive:true,maintainAspectRatio:false,cutout:'60%',
        plugins:{legend:{position:'right',labels:{color:c.tick,font:{family:'Plus Jakarta Sans',size:11},padding:10,boxWidth:10}}}}}); 
  } else {
    // Fallback to branch breakdown
    var revByBranch=NX._hrfRevByBranch||{};
    var labels=Object.keys(revByBranch);
    var colors=['#00875a','#0057ff','#5b21b6','#b45309','#c0392b','#f97316','#94a3b8','#0057ff'];
    hrfMkChart('hrf-chart-cost-pie',{type:'doughnut',
      data:{labels:labels,datasets:[{data:labels.map(function(k){return revByBranch[k];}),backgroundColor:colors.map(function(c2){return c2+'aa';}),borderColor:colors,borderWidth:2}]},
      options:{responsive:true,maintainAspectRatio:false,cutout:'60%',
        plugins:{legend:{position:'right',labels:{color:c.tick,font:{family:'Plus Jakarta Sans',size:11},padding:10,boxWidth:10}}}}});
  }
}

function hrfInitRevMonthlyChart(){
  var mo=NX._hrfMonthlyRev||new Array(12).fill(0);
  var d=new Date(new Date().getTime()+3*3600000);
  var labels=HRF_MONTHS.slice(0,d.getMonth()+1);
  hrfMkChart('hrf-chart-revenue-monthly',{type:'line',
    data:{labels:labels,datasets:[{label:'Revenue',data:mo.slice(0,d.getMonth()+1),
      borderColor:'#00875a',backgroundColor:'rgba(52,211,153,.1)',tension:.4,fill:true,pointRadius:4,pointHoverRadius:6,borderWidth:2}]},
    options:hrfBaseOpts()});
}

function hrfInitPnLChart(){
  var rev=NX._hrfPnLRev||new Array(12).fill(0);
  var costs=NX._hrfPnLCosts||new Array(12).fill(0);
  var d=new Date(new Date().getTime()+3*3600000);
  var labels=HRF_MONTHS.slice(0,d.getMonth()+1);
  hrfMkChart('hrf-chart-pnl',{type:'bar',
    data:{labels:labels,datasets:[
      {label:'Revenue',data:rev.slice(0,d.getMonth()+1),backgroundColor:'rgba(52,211,153,.25)',borderColor:'#00875a',borderWidth:2,borderRadius:4},
      {label:'Costs',data:costs.slice(0,d.getMonth()+1),backgroundColor:'rgba(248,113,113,.2)',borderColor:'#c0392b',borderWidth:2,borderRadius:4}
    ]},options:hrfBaseOpts()});
}

function hrfInitFoodCostChart(){
  var wasteByMo=NX._hrfWasteByMo||new Array(12).fill(0);
  var d=new Date(new Date().getTime()+3*3600000);
  var labels=HRF_MONTHS.slice(0,d.getMonth()+1);
  hrfMkChart('hrf-chart-foodcost',{type:'bar',
    data:{labels:labels,datasets:[{label:'Wastage Cost',data:wasteByMo.slice(0,d.getMonth()+1),
      backgroundColor:'rgba(248,113,113,.3)',borderColor:'#c0392b',borderWidth:2,borderRadius:4}]},
    options:hrfBaseOpts()});
}


// ════════════════════════════════════════════════════════════════
// BRANCH MANAGER — NEW MODULES
// ════════════════════════════════════════════════════════════════

// ── Shared badge updater for BM new pages ──
function bmUpdateBadges() {
  // Transfer requests pending
  var pt = (BS._bmTransfers||[]).filter(function(t){return t.status==='pending';});
  var nb1 = document.getElementById('nb-bm-transfers-pending');
  if(nb1){nb1.style.display=pt.length?'flex':'none';nb1.textContent=pt.length;}
  // Leave requests pending
  var pl = (BS.tsLeaves||[]).filter(function(l){return l.status==='pending';});
  var nb2 = document.getElementById('nb-bm-leave-pending');
  if(nb2){nb2.style.display=pl.length?'flex':'none';nb2.textContent=pl.length;}
  // Unread announcements
  var ua = (BS._bmAnns||[]).filter(function(a){return !(BS._bmAcks||{})[a.id];});
  var nb3 = document.getElementById('nb-bm-ann-unread');
  if(nb3){nb3.style.display=ua.length?'flex':'none';nb3.textContent=ua.length;}
}

// ── Area Manager transfer badge updater ──
function amUpdateTransferBadge() {
  if (!db) return;
  var s = NX.session || {};
  if (s.role !== 'regional') return;
  db.ref('admin/transfer_requests').once('value', function(snap) {
    var raw = snap.val() || {};
    var myBranchIds = s.branchIds || [];
    var pending = Object.values(raw).filter(function(r) {
      if (!r || r.status !== 'pending') return false;
      return myBranchIds.length === 0 ||
        myBranchIds.indexOf(r.fromBranch) >= 0 ||
        myBranchIds.indexOf(r.toBranch) >= 0;
    });
    var nb = document.getElementById('nb-am-transfers-pending');
    if (nb) { nb.style.display = pending.length ? 'flex' : 'none'; nb.textContent = pending.length; }
  });
}

// Load announcements + acks for branch manager
function bmLoadAnnouncements(cb) {
  if(!db){cb();return;}
  var s = NX.session||{};
  var done = 0;
  function check(){if(++done>=2){bmUpdateBadges();if(cb)cb();}}
  db.ref('admin/announcements').once('value',function(snap){
    var raw=snap.val()||{};
    BS._bmAnns=Object.values(raw).filter(Boolean).sort(function(a,b){return (b.date||'').localeCompare(a.date||'');});
    check();
  });
  if(s.branchId){
    db.ref('branches/'+s.branchId+'/annAcks').once('value',function(snap){
      BS._bmAcks=snap.val()||{};
      check();
    });
  } else {BS._bmAcks={};check();}
}

// Load incoming transfer requests
function bmLoadTransfers(cb) {
  if(!db){if(cb)cb();return;}
  var s = NX.session||{};
  if(!s.branchId){BS._bmTransfers=[];if(cb)cb();return;}
  db.ref('branches/'+s.branchId+'/transfer_requests').once('value',function(snap){
    var raw=snap.val()||{};
    BS._bmTransfers=Object.values(raw).filter(Boolean).sort(function(a,b){return (b.createdAt||0)-(a.createdAt||0);});
    bmUpdateBadges();
    if(cb)cb();
  });
}

// ── BRANCH: COMPLIANCE & FIXED COSTS ─────────────────────────────────────────
function pBmCompliance() {
  attachBranchListeners();
  var s = NX.session||{};
  var branchId = s.branchId||'';
  var tab = BS._compTab||'recurring';
  if(!BS._compData){
    BS._compData={recurring:[],permits:[],services:[]};
    if(db&&branchId){
      db.ref('branches/'+branchId+'/compliance').once('value',function(snap){
        var v=snap.val()||{};
        BS._compData={recurring:Array.isArray(v.recurring)?v.recurring:(v.recurring?Object.values(v.recurring):[]),permits:Array.isArray(v.permits)?v.permits:(v.permits?Object.values(v.permits):[]),services:Array.isArray(v.services)?v.services:(v.services?Object.values(v.services):[])};
        navTo('bm-compliance');
      });
      return '<div style="text-align:center;padding:40px;color:var(--text-tertiary)">Loading\u2026</div>';
    }
  }
  var D=BS._compData;
  var now=new Date();
  function daysUntil(d){if(!d)return 9999;return Math.ceil((new Date(d)-now)/86400000);}
  function urgBadge(d){var du=daysUntil(d);if(du<0)return'<span style="background:rgba(192,57,43,.15);color:#c0392b;border-radius:10px;padding:1px 6px;font-size:10px;font-weight:700">EXPIRED</span>';if(du<=7)return'<span style="background:rgba(192,57,43,.12);color:#c0392b;border-radius:10px;padding:1px 6px;font-size:10px;font-weight:700">'+du+'d</span>';if(du<=30)return'<span style="background:rgba(180,83,17,.12);color:#b45309;border-radius:10px;padding:1px 6px;font-size:10px">'+du+'d</span>';if(du<=90)return'<span style="background:var(--surface-2);color:var(--text-tertiary);border-radius:10px;padding:1px 6px;font-size:10px">'+du+'d</span>';return'';}
  var allItems=D.recurring.concat(D.permits).concat(D.services);
  var expired=allItems.filter(function(x){return daysUntil(x.expiry||x.renewalDate)<=0;}).length;
  var warn7=allItems.filter(function(x){var du=daysUntil(x.expiry||x.renewalDate);return du>0&&du<=7;}).length;
  var warn30=allItems.filter(function(x){var du=daysUntil(x.expiry||x.renewalDate);return du>7&&du<=30;}).length;
  var totRecurring=D.recurring.reduce(function(s,r){return s+(parseFloat(r.monthlyCost)||0);},0);
  var totServices=D.services.reduce(function(s,r){return s+(parseFloat(r.monthlyCost)||0);},0);

  var h='<div class="page-header"><h1>\ud83c\udfd9\ufe0f Compliance & Fixed Costs</h1><p>Recurring expenses, permits, and service contracts \u2014 all expiry tracked</p></div>';
  if(expired||warn7||warn30){h+='<div style="background:rgba(192,57,43,.08);border:1px solid rgba(192,57,43,.25);border-radius:10px;padding:12px 16px;margin-bottom:16px;display:flex;gap:16px;align-items:center;flex-wrap:wrap"><span style="font-size:18px">\u26a0\ufe0f</span>';if(expired)h+='<span style="font-size:12px;color:#c0392b;font-weight:700">'+expired+' EXPIRED</span>';if(warn7)h+='<span style="font-size:12px;color:#c0392b;font-weight:700">'+warn7+' expire in 7 days</span>';if(warn30)h+='<span style="font-size:12px;color:#b45309">'+warn30+' expire in 30 days</span>';h+='</div>';}

  h+='<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:10px;margin-bottom:16px">';
  h+='<div class="bsc"><div class="bsc-lbl">Fixed costs/mo</div><div class="bsc-val bmono" style="font-size:16px">'+bfsar(totRecurring)+'</div></div>';
  h+='<div class="bsc"><div class="bsc-lbl">Services/mo</div><div class="bsc-val bmono" style="font-size:16px">'+bfsar(totServices)+'</div></div>';
  h+='<div class="bsc"><div class="bsc-lbl">Total/mo</div><div class="bsc-val bmono" style="font-size:16px">'+bfsar(totRecurring+totServices)+'</div></div>';
  h+='<div class="bsc"><div class="bsc-lbl">Permits</div><div class="bsc-val bmono" style="font-size:18px">'+D.permits.length+'</div></div>';
  h+='</div>';

  var tabs=[['recurring','\ud83c\udfe0 Fixed Costs'],['permits','\ud83e\udeb7 Permits'],['services','\ud83d\udd27 Services']];
  h+='<div style="display:flex;gap:6px;margin-bottom:14px;flex-wrap:wrap">';
  tabs.forEach(function(t){h+='<button class="btn'+(tab===t[0]?' btn-primary':'')+'" onclick="BS._compTab=\''+t[0]+'\';BS._compData=BS._compData;navTo(\'bm-compliance\')">'+t[1]+'</button>';});
  h+='<button class="btn btn-primary" style="margin-left:auto;background:var(--accent);color:#000" onclick="bmCompAddModal(\''+tab+'\')">+ Add</button>';
  h+='<button class="btn" onclick="bmCompSendToFinance()">\ud83d\udce4 Send to Finance</button>';
  h+='</div>';

  function costTable(items,type){
    if(!items.length)return'<div style="text-align:center;padding:32px;color:var(--text-tertiary);font-size:13px">No records yet \u2014 click <strong>+ Add</strong> to start</div>';
    var cols=type==='permits'?['Name','Authority / Reference','Issue Date','Expiry','Status','Actions']:['Name','Category','Monthly SAR','Renewal Date','Vendor','Actions'];
    var rows='';
    items.forEach(function(item,i){
      var expD=item.expiry||item.renewalDate||'';
      rows+='<tr><td><div style="font-weight:600">'+hxe(item.name||'\u2014')+'</div>'+(item.reference?'<div style="font-size:10px;color:var(--text-tertiary)">'+hxe(item.reference)+'</div>':'')+('</td>');
      if(type==='permits'){rows+='<td style="font-size:12px">'+hxe(item.authority||'\u2014')+'</td><td style="font-family:var(--mono);font-size:12px">'+hxe(item.issueDate||'\u2014')+'</td>';}
      else{rows+='<td><span style="background:var(--surface-2);border-radius:8px;padding:2px 8px;font-size:10px">'+hxe(item.type||item.category||'\u2014')+'</span></td><td style="font-family:var(--mono);font-weight:700">'+bfsar(parseFloat(item.monthlyCost)||0)+'</td>';}
      rows+='<td style="font-family:var(--mono);font-size:12px">'+hxe(expD||'\u2014')+' '+urgBadge(expD)+'</td>';
      if(type==='permits')rows+='<td>'+urgBadge(expD)+'</td>';
      else rows+='<td style="font-size:12px">'+hxe(item.vendor||'\u2014')+'</td>';
      rows+='<td><div style="display:flex;gap:4px"><button class="btn btn-sm" onclick="bmCompEdit(\''+type+'\','+i+')">Edit</button><button class="btn btn-sm" style="color:var(--danger)" onclick="bmCompDel(\''+type+'\','+i+')">Del</button></div></td></tr>';
    });
    return hrfTable(cols,rows);
  }
  if(tab==='recurring') h+=costTable(D.recurring,'recurring');
  if(tab==='permits')   h+=costTable(D.permits,'permits');
  if(tab==='services')  h+=costTable(D.services,'services');
  return h;
}
function bmCompAddModal(type){
  var titles={recurring:'Add Fixed Cost',permits:'Add Permit / Licence',services:'Add Service Contract'};
  var fi='background:var(--surface-2);border:1px solid var(--border);border-radius:8px;padding:8px 10px;color:var(--text-primary);font-size:13px;outline:none;width:100%;font-family:var(--font);margin-bottom:10px';
  var fl='display:block;font-size:10px;color:var(--text-tertiary);text-transform:uppercase;letter-spacing:.08em;margin-bottom:3px';
  function fi2(l,id,t,ph,v){return'<div><label style="'+fl+'">'+l+'</label><input style="'+fi+'" type="'+(t||'text')+'" id="bc-'+id+'" placeholder="'+(ph||'')+'" value="'+(v||'')+'"></div>';}
  function sel(l,id,opts,v){return'<div><label style="'+fl+'">'+l+'</label><select style="'+fi+'" id="bc-'+id+'">'+opts.map(function(o){return'<option value="'+o+'"'+(o===v?' selected':'')+'>'+o+'</option>';}).join('')+'</select></div>';}
  var body='';
  if(type==='permits'){
    body+=fi2('Permit / Licence Name','name','text','e.g. Municipal Trading Licence','');
    body+=sel('Issuing Authority','authority',['Municipality','Civil Defence','Ministry of Commerce','Ministry of Health','Ministry of Labor','SAMA','ZATCA','Food Authority','Other'],'');
    body+=fi2('Reference / Licence Number','reference','text','Licence No.','');
    body+=fi2('Issue Date','issueDate','date','','');
    body+=fi2('Expiry Date','expiry','date','','');
    body+=fi2('Renewal Cost (SAR)','monthlyCost','number','Annual renewal fee','');
    body+=fi2('Notes','notes','text','Responsible person, notes','');
  } else {
    var typeOpts=type==='recurring'?['Rent','Electricity','Water','Gas','Internet','Municipal fees','Insurance','Other fixed']:['HVAC maintenance','Pest control','Fire system check','Elevator service','Cleaning service','IT support','Uniform service','Waste disposal','Security','Other service'];
    body+=fi2('Name / Description','name','text','e.g. Monthly Rent','');
    body+=sel('Category','type',typeOpts,'');
    body+=fi2('Monthly Cost (SAR)','monthlyCost','number','e.g. 15000','');
    body+=fi2('Vendor / Supplier','vendor','text','Company name','');
    body+=fi2('Contract Start','startDate','date','','');
    body+=fi2('Renewal / Expiry Date','renewalDate','date','','');
    body+=fi2('Notes','notes','text','Contract number, remarks','');
  }
  body+='<button class="btn btn-primary" style="width:100%;margin-top:8px" onclick="bmCompSave(\''+type+'\',null)">Add Record</button>';
  openModal('<div class="modal-head"><h2>'+titles[type]+'</h2><button class="modal-close" onclick="closeModalForce()">\u00d7</button></div>'+body);
}
function bmCompEdit(type,idx){
  var item=(BS._compData||{})[type][idx];if(!item)return;
  bmCompAddModal(type);
  ['name','type','monthlyCost','vendor','startDate','renewalDate','notes','reference','authority','issueDate','expiry'].forEach(function(k){var el=document.getElementById('bc-'+k);if(el&&item[k]!==undefined)el.value=item[k];});
  var btn=document.querySelector('#modal .btn.btn-primary');if(btn){btn.setAttribute('onclick','bmCompSave(\''+type+'\','+idx+')');btn.textContent='Save Changes';}
}
function bmCompSave(type,idx){
  if(!BS._compData)BS._compData={recurring:[],permits:[],services:[]};
  var arr=BS._compData[type];
  function gv(id){var el=document.getElementById('bc-'+id);return el?el.value.trim():'';}
  var rec={name:gv('name'),type:gv('type'),monthlyCost:parseFloat(gv('monthlyCost'))||0,vendor:gv('vendor'),startDate:gv('startDate'),renewalDate:gv('renewalDate'),notes:gv('notes'),reference:gv('reference'),authority:gv('authority'),issueDate:gv('issueDate'),expiry:gv('expiry'),updatedAt:new Date().toISOString()};
  if(!rec.name){showToast('Name is required','error');return;}
  if(idx===null)arr.push(rec);else arr[idx]=rec;
  BS._compData[type]=arr;
  var s=NX.session||{};
  if(db&&s.branchId){db.ref('branches/'+s.branchId+'/compliance/'+type).set(arr,function(err){if(err)showToast('Save failed: '+err.message,'error');else{closeModalForce();showToast('Saved \u2713','success');navTo('bm-compliance');}});}
  else{closeModalForce();showToast('Saved','success');navTo('bm-compliance');}
}
function bmCompDel(type,idx){
  if(!confirm('Delete this record?'))return;
  BS._compData[type].splice(idx,1);
  var s=NX.session||{};
  if(db&&s.branchId)db.ref('branches/'+s.branchId+'/compliance/'+type).set(BS._compData[type]);
  navTo('bm-compliance');
}
function bmCompSendToFinance(){
  var s=NX.session||{};if(!db||!s.branchId){showToast('No connection','error');return;}
  db.ref('shared/compliance/'+s.branchId).set({branchId:s.branchId,branchName:s.branchName||s.entityName||'',recurring:BS._compData.recurring||[],permits:BS._compData.permits||[],services:BS._compData.services||[],sentAt:new Date().toISOString()},function(err){if(err)showToast('Failed','error');else showToast('Sent to Finance \u2713','success');});
}

// ── BRANCH: ASSET REGISTER ───────────────────────────────────────────────────
function pBmAssets(){
  attachBranchListeners();
  var s=NX.session||{};var branchId=s.branchId||'';
  if(!BS._assetData){
    BS._assetData=[];
    if(db&&branchId){
      db.ref('branches/'+branchId+'/assets').once('value',function(snap){var v=snap.val();BS._assetData=Array.isArray(v)?v:(v?Object.values(v).filter(Boolean):[]);navTo('bm-assets');});
      return'<div style="text-align:center;padding:40px;color:var(--text-tertiary)">Loading assets\u2026</div>';
    }
  }
  var assets=BS._assetData;
  var now=new Date();
  function daysUntil(d){if(!d)return 9999;return Math.ceil((new Date(d)-now)/86400000);}
  function urgBadge(d){var du=daysUntil(d);if(du<0)return'<span style="background:rgba(192,57,43,.15);color:#c0392b;border-radius:10px;padding:1px 6px;font-size:10px;font-weight:700">EXP</span>';if(du<=30)return'<span style="background:rgba(180,83,17,.12);color:#b45309;border-radius:10px;padding:1px 6px;font-size:10px;font-weight:700">'+du+'d</span>';return'';}
  var totalValue=assets.reduce(function(s,a){return s+(parseFloat(a.value)||0);},0);
  var needsMaint=assets.filter(function(a){return daysUntil(a.nextService)<=30;}).length;
  var h='<div class="page-header"><h1>\ud83d\uddc2\ufe0f Asset Register</h1><p>All branch equipment, value tracking, and maintenance schedules</p></div>';
  h+='<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:10px;margin-bottom:16px">';
  h+='<div class="bsc"><div class="bsc-lbl">Total assets</div><div class="bsc-val bmono" style="font-size:18px">'+assets.length+'</div></div>';
  h+='<div class="bsc"><div class="bsc-lbl">Total value</div><div class="bsc-val bmono" style="font-size:16px">'+bfsar(totalValue)+'</div></div>';
  h+='<div class="bsc"><div class="bsc-lbl">Need service</div><div class="bsc-val bmono" style="font-size:18px;color:#b45309">'+needsMaint+'</div></div>';
  h+='</div>';
  h+='<div style="display:flex;gap:8px;margin-bottom:12px"><button class="btn btn-primary" style="background:var(--accent);color:#000" onclick="bmAssetModal(null)">+ Add Asset</button><button class="btn" onclick="bmAssetToFinance()">\ud83d\udce4 Send to Finance</button></div>';
  if(!assets.length)return h+'<div style="text-align:center;padding:40px;color:var(--text-tertiary);font-size:13px">No assets recorded \u2014 click <strong>+ Add Asset</strong> to start</div>';
  var rows='';
  assets.forEach(function(a,i){
    rows+='<tr><td><div style="font-weight:600">'+hxe(a.name||'\u2014')+'</div><div style="font-size:10px;color:var(--text-tertiary)">'+hxe(a.assetId||'')+'</div></td>';
    rows+='<td><span style="background:var(--surface-2);border-radius:8px;padding:2px 8px;font-size:10px">'+hxe(a.category||'\u2014')+'</span></td>';
    rows+='<td style="font-family:var(--mono)">'+bfsar(parseFloat(a.value)||0)+'</td>';
    rows+='<td style="font-size:12px">'+hxe(a.purchaseDate||'\u2014')+'</td>';
    rows+='<td style="font-size:12px">'+hxe(a.nextService||'\u2014')+' '+urgBadge(a.nextService)+'</td>';
    rows+='<td style="font-size:12px"><span style="background:var(--surface-2);border-radius:8px;padding:2px 7px;font-size:10px">'+hxe(a.condition||'\u2014')+'</span></td>';
    rows+='<td><div style="display:flex;gap:4px"><button class="btn btn-sm" onclick="bmAssetModal('+i+')">Edit</button><button class="btn btn-sm" style="color:var(--danger)" onclick="bmAssetDel('+i+')">Del</button></div></td></tr>';
  });
  h+=hrfTable(['Asset','Category','Value SAR','Purchase Date','Next Service','Condition','Actions'],rows);
  return h;
}
function bmAssetModal(idx){
  var a=idx!==null?(BS._assetData||[])[idx]:{};
  var fi='background:var(--surface-2);border:1px solid var(--border);border-radius:8px;padding:8px 10px;color:var(--text-primary);font-size:13px;outline:none;width:100%;font-family:var(--font);margin-bottom:10px';
  var fl='display:block;font-size:10px;color:var(--text-tertiary);text-transform:uppercase;letter-spacing:.08em;margin-bottom:3px';
  function fi2(l,id,t,ph,v){return'<div><label style="'+fl+'">'+l+'</label><input style="'+fi+'" type="'+(t||'text')+'" id="ba-'+id+'" placeholder="'+(ph||'')+'" value="'+(v||'')+'"></div>';}
  function sel2(l,id,opts,v){return'<div><label style="'+fl+'">'+l+'</label><select style="'+fi+'" id="ba-'+id+'">'+opts.map(function(o){return'<option value="'+o+'"'+(o===v?' selected':'')+'>'+o+'</option>';}).join('')+'</select></div>';}
  var body='';
  body+=fi2('Asset Name','name','text','e.g. Walk-in Chiller',a.name||'');
  body+=sel2('Category','category',['Kitchen Equipment','HVAC','Refrigeration','Furniture','POS & IT','Vehicle','Safety Equipment','Signage','Generator','Other'],a.category||'');
  body+=fi2('Asset ID / Serial','assetId','text','e.g. KIT-001',a.assetId||'');
  body+='<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">'+fi2('Purchase Value (SAR)','value','number','',a.value||'')+sel2('Condition','condition',['Excellent','Good','Fair','Needs repair','Out of service'],a.condition||'Good')+'</div>';
  body+='<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">'+fi2('Purchase Date','purchaseDate','date','',a.purchaseDate||'')+fi2('Warranty Expiry','warrantyExpiry','date','',a.warrantyExpiry||'')+'</div>';
  body+='<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">'+fi2('Last Service','lastService','date','',a.lastService||'')+fi2('Next Service Due','nextService','date','',a.nextService||'')+'</div>';
  body+=fi2('Vendor / Supplier','vendor','text','',a.vendor||'')+fi2('Notes','notes','text','',a.notes||'');
  body+='<button class="btn btn-primary" style="width:100%;margin-top:8px" onclick="bmAssetSave('+(idx===null?'null':idx)+')">'+(idx===null?'Add Asset':'Save Changes')+'</button>';
  openModal('<div class="modal-head"><h2>'+(idx===null?'Add Asset':'Edit Asset')+'</h2><button class="modal-close" onclick="closeModalForce()">\u00d7</button></div>'+body);
}
function bmAssetSave(idx){
  if(!BS._assetData)BS._assetData=[];
  function gv(id){var el=document.getElementById('ba-'+id);return el?el.value.trim():'';}
  var rec={name:gv('name'),category:gv('category'),assetId:gv('assetId'),value:parseFloat(gv('value'))||0,condition:gv('condition'),purchaseDate:gv('purchaseDate'),warrantyExpiry:gv('warrantyExpiry'),lastService:gv('lastService'),nextService:gv('nextService'),vendor:gv('vendor'),notes:gv('notes'),updatedAt:new Date().toISOString()};
  if(!rec.name){showToast('Asset name required','error');return;}
  if(idx===null)BS._assetData.push(rec);else BS._assetData[idx]=rec;
  var s=NX.session||{};
  if(db&&s.branchId){db.ref('branches/'+s.branchId+'/assets').set(BS._assetData,function(err){if(err)showToast('Save failed: '+err.message,'error');else{closeModalForce();showToast('Saved \u2713','success');BS._assetData=null;navTo('bm-assets');}});}
  else{closeModalForce();showToast('Saved','success');navTo('bm-assets');}
}
function bmAssetDel(idx){
  if(!confirm('Delete this asset?'))return;
  BS._assetData.splice(idx,1);
  var s=NX.session||{};
  if(db&&s.branchId)db.ref('branches/'+s.branchId+'/assets').set(BS._assetData);
  navTo('bm-assets');
}
function bmAssetToFinance(){
  var s=NX.session||{};if(!db||!s.branchId){showToast('No connection','error');return;}
  db.ref('shared/assets/'+s.branchId).set({branchId:s.branchId,branchName:s.branchName||'',assets:BS._assetData||[],sentAt:new Date().toISOString()},function(err){if(err)showToast('Failed','error');else showToast('Asset register sent to Finance \u2713','success');});
}


// ── 1. INVOICES ──────────────────────────────────────────────
function pBmInvoices() {
  attachBranchListeners();
  var s = NX.session||{};
  var filt = BS._bmInvFilt||'all';
  var data = BS.invoices.filter(function(inv){
    if(filt==='pending') return !inv.status||inv.status==='draft'||inv.status==='pending';
    if(filt==='approved') return inv.status==='approved';
    if(filt==='paid') return inv.status==='paid';
    return true;
  }).slice().sort(function(a,b){return (b.invoiceDate||'').localeCompare(a.invoiceDate||'');});

  var total = data.reduce(function(a,inv){return a+parseFloat(inv.amount||0);},0);
  var pending = BS.invoices.filter(function(i){return !i.status||i.status==='draft'||i.status==='pending';}).length;
  var paid = BS.invoices.filter(function(i){return i.status==='paid';}).length;

  var h = '<div class="page-header"><h1>&#x1F4C4; Supplier Invoices</h1><p>Log and track supplier invoices &mdash; submitted to Finance for approval</p></div>';
  h += '<div class="header-actions"><div style="display:flex;gap:6px">';
  ['all','pending','approved','paid'].forEach(function(f){
    var lbl = {all:'All',pending:'Pending',approved:'Approved',paid:'Paid'}[f];
    h += '<button class="btn'+(filt===f?' btn-primary':'')+'" onclick="BS._bmInvFilt=\''+f+'\';navTo(\'bm-invoices\')">'+lbl+'</button>';
  });
  h += '</div><button class="btn btn-primary" onclick="openBmInvoiceModal()">+ Add Invoice</button></div>';

  h += '<div class="bgrid-4" style="margin-bottom:16px">';
  h += '<div class="bsc"><div class="bsc-lbl">Total Invoices</div><div class="bsc-val bca">'+BS.invoices.length+'</div></div>';
  h += '<div class="bsc"><div class="bsc-lbl">Pending Finance</div><div class="bsc-val" style="color:#b45309">'+pending+'</div></div>';
  h += '<div class="bsc"><div class="bsc-lbl">Paid</div><div class="bsc-val" style="color:#00875a">'+paid+'</div></div>';
  h += '<div class="bsc"><div class="bsc-lbl">Total Value</div><div class="bsc-val bcr">'+bfsar(total)+'</div></div>';
  h += '</div>';

  var statusColor = {draft:'#94a3b8',pending:'#b45309',approved:'#0057ff',paid:'#00875a'};
  var rows = data.map(function(inv){
    var sc = statusColor[inv.status||'draft']||'#94a3b8';
    return '<tr>'+
      '<td class="bmono" style="font-size:11px;color:var(--text-tertiary)">'+bfdate(inv.invoiceDate)+'</td>'+
      '<td style="font-weight:600;color:var(--text-primary)">'+bxe(inv.supplier||'—')+'</td>'+
      '<td>'+bpl(inv.category||'—','#0057ff')+'</td>'+
      '<td class="bmono" style="font-weight:700;color:#c0392b">'+bfsar(inv.amount)+'</td>'+
      '<td style="font-size:11px;color:var(--text-secondary)">'+bxe((inv.note||'').slice(0,40))+'</td>'+
      '<td><span style="color:'+sc+';font-weight:700;font-size:11px">'+bxe(inv.status||'draft')+'</span></td>'+
      '<td><div style="display:flex;gap:4px">'+
        ((!inv.status||inv.status==='draft')?'<button class="btn btn-sm btn-primary" onclick="bmSubmitInvoice(\''+bxe(inv.id)+'\')">Submit</button>':'')+
        '<button class="btn btn-sm" style="color:var(--danger)" onclick="bmDeleteInvoice(\''+bxe(inv.id)+'\')">Del</button>'+
      '</div></td>'+
    '</tr>';
  }).join('');

  h += '<div class="btw"><div class="btw-s"><table class="btbl"><thead><tr>'+
    '<th>Date</th><th>Supplier</th><th>Category</th><th>Amount</th><th>Note</th><th>Status</th><th>Actions</th>'+
    '</tr></thead><tbody>'+(rows||'<tr><td colspan="7" style="text-align:center;color:var(--text-tertiary);padding:28px">No invoices yet. Click <strong>+ Add Invoice</strong> to log one.</td></tr>')+'</tbody></table></div></div>';
  return h;
}

function openBmInvoiceModal() {
  var sups = getSuppliers();
  var supOpts = sups.map(function(s){return '<option>'+bxe(s)+'</option>';}).join('');
  var catOpts = ['Food & Beverage','Utilities','Maintenance','Supplies','Equipment','Cleaning','Other'].map(function(c){return '<option>'+c+'</option>';}).join('');
  var html = '<div class="modal-head"><h2>&#x1F4C4; Add Supplier Invoice</h2><button class="modal-close" onclick="closeModalForce()">&#x2715;</button></div>';
  html += '<div class="form-row"><div class="bfg"><label class="form-label">Supplier *</label><select class="form-input form-select" id="bmi-sup"><option value="">Select...</option>'+supOpts+'</select></div>'+
    '<div class="bfg"><label class="form-label">Invoice Date *</label><input class="form-input" type="date" id="bmi-date" value="'+TODAY_BS+'"></div></div>';
  html += '<div class="form-row"><div class="bfg"><label class="form-label">Amount (‫SAR ‬) *</label><input class="form-input" type="number" id="bmi-amount" placeholder="0.00" step="0.01"></div>'+
    '<div class="bfg"><label class="form-label">Category</label><select class="form-input form-select" id="bmi-cat">'+catOpts+'</select></div></div>';
  html += '<div class="form-row"><div class="bfg"><label class="form-label">Invoice #</label><input class="form-input" id="bmi-ref" placeholder="INV-2025-001"></div>'+
    '<div class="bfg"><label class="form-label">VAT Amount (‫SAR ‬)</label><input class="form-input" type="number" id="bmi-vat" placeholder="0.00" step="0.01"></div></div>';
  html += '<div class="bfg"><label class="form-label">Note</label><textarea class="form-input" id="bmi-note" rows="2" placeholder="Description or items..."></textarea></div>';
  html += '<div class="modal-actions"><button class="btn" onclick="closeModalForce()">Cancel</button><button class="btn btn-primary" onclick="saveBmInvoice()">Save Invoice</button></div>';
  openModal(html);
}

function saveBmInvoice() {
  var sup = bgv('bmi-sup'), date = bgv('bmi-date'), amount = parseFloat(bgv('bmi-amount'))||0;
  if(!sup||!date||amount<=0){showToast('Supplier, date and amount required','error');return;}
  var inv = {id:buid(),supplier:sup,invoiceDate:date,amount:amount,category:bgv('bmi-cat'),
    invoiceRef:bgv('bmi-ref'),vatAmount:parseFloat(bgv('bmi-vat'))||0,note:bgv('bmi-note'),
    status:'draft',createdAt:Date.now()};
  BS.invoices.push(inv);
  bSaveColl('invoices',BS.invoices);
  closeModalForce();
  showToast('Invoice saved \u2713','success');
  navTo('bm-invoices');
}

function bmSubmitInvoice(id) {
  var inv = BS.invoices.find(function(i){return i.id===id;});
  if(!inv)return;
  inv.status='pending';
  bSaveColl('invoices',BS.invoices);
  showToast('Invoice submitted to Finance \u2713','success');
  navTo('bm-invoices');
}

function bmDeleteInvoice(id) {
  if(!confirm('Delete this invoice?'))return;
  BS.invoices = BS.invoices.filter(function(i){return i.id!==id;});
  bSaveColl('invoices',BS.invoices);
  showToast('Deleted');
  navTo('bm-invoices');
}

// ── 2. LEAVE MANAGEMENT ──────────────────────────────────────
function pBmLeave() {
  attachBranchListeners();
  var filt = BS._bmLeaveFilt||'all';
  var data = BS.tsLeaves.filter(function(l){
    if(filt==='pending') return l.status==='pending';
    if(filt==='approved') return l.status==='approved';
    if(filt==='rejected') return l.status==='rejected';
    return true;
  }).slice().sort(function(a,b){return (b.start||'').localeCompare(a.start||'');});

  var pend = BS.tsLeaves.filter(function(l){return l.status==='pending';}).length;
  var appr = BS.tsLeaves.filter(function(l){return l.status==='approved';}).length;
  var rej  = BS.tsLeaves.filter(function(l){return l.status==='rejected';}).length;

  var eo = '<option value="">Select employee...</option>'+BS.tsEmps.slice().sort(function(a,b){return a.name.localeCompare(b.name);}).map(function(e){return '<option value="'+bxe(e.id)+'">'+bxe(e.name)+' ('+bxe(e.dept||'')+')</option>';}).join('');

  var h = '<div class="page-header"><h1>&#x1F3D6;&#xFE0F; Leave Management</h1><p>Submit and manage leave requests for your team</p></div>';

  // Submit form
  h += '<div class="bcard" style="margin-bottom:16px;border-color:rgba(52,211,153,.2)">';
  h += '<div style="font-size:13px;font-weight:700;color:var(--success);margin-bottom:14px">New Leave Request</div>';
  h += '<div class="bgrid-2" style="margin-bottom:12px">';
  h += '<div class="bfg" style="margin-bottom:0"><label class="form-label">Employee *</label><select class="form-input form-select" id="bmlv-emp">'+eo+'</select></div>';
  h += '<div class="bfg" style="margin-bottom:0"><label class="form-label">Type *</label><select class="form-input form-select" id="bmlv-type"><option value="annual">Annual Leave</option><option value="sick">Sick Leave</option><option value="emergency">Emergency Leave</option><option value="unpaid">Unpaid Leave</option></select></div>';
  h += '<div class="bfg" style="margin-bottom:0"><label class="form-label">From *</label><input class="form-input" type="date" id="bmlv-from"></div>';
  h += '<div class="bfg" style="margin-bottom:0"><label class="form-label">To *</label><input class="form-input" type="date" id="bmlv-to"></div>';
  h += '</div>';
  h += '<div class="bfg" style="margin-bottom:12px"><label class="form-label">Notes</label><input class="form-input" id="bmlv-note" placeholder="Reason (optional)"></div>';
  h += '<button class="btn btn-primary" onclick="saveBmLeaveRequest()">Submit Request &#x2192; HR</button>';
  h += '</div>';

  // Filter tabs
  h += '<div style="display:flex;gap:6px;margin-bottom:14px">';
  [{k:'all',l:'All'},{k:'pending',l:'Pending'},{k:'approved',l:'Approved'},{k:'rejected',l:'Rejected'}].forEach(function(f){
    h += '<button class="btn'+(filt===f.k?' btn-primary':'')+'" onclick="BS._bmLeaveFilt=\''+f.k+'\';navTo(\'bm-leave\')">'+f.l+'</button>';
  });
  h += '</div>';

  // KPI cards
  h += '<div class="bgrid-4" style="margin-bottom:16px">';
  [{l:'Pending',v:pend,c:'#b45309'},{l:'Approved',v:appr,c:'#00875a'},{l:'Rejected',v:rej,c:'#c0392b'},{l:'Total',v:BS.tsLeaves.length,c:'var(--text-primary)'}].forEach(function(x){
    h += '<div style="text-align:center;background:var(--surface-2);border:1px solid '+x.c+'30;border-radius:9px;padding:12px"><div class="bmono" style="font-size:24px;font-weight:300;color:'+x.c+'">'+x.v+'</div><div style="font-size:9px;color:var(--text-tertiary);margin-top:3px;text-transform:uppercase;letter-spacing:1px">'+x.l+'</div></div>';
  });
  h += '</div>';

  var typeColors = {annual:'#00875a',sick:'#c0392b',emergency:'#b45309',unpaid:'#94a3b8'};
  var statusColor = {pending:'#b45309',approved:'#00875a',rejected:'#c0392b'};
  var rows = data.map(function(l){
    var emp = BS.tsEmps.find(function(e){return e.id===l.empId;});
    var tc = typeColors[l.type]||'#888';
    var sc = statusColor[l.status]||'#888';
    return '<tr>'+
      '<td style="font-weight:600;color:var(--text-primary)">'+bxe(emp?emp.name:'Unknown')+'</td>'+
      '<td>'+bpl((l.type||'').replace(/_/g,' '),tc)+'</td>'+
      '<td class="bmono">'+bxe(l.start||l.from||'')+'</td>'+
      '<td class="bmono">'+bxe(l.end||l.to||'')+'</td>'+
      '<td class="bmono" style="font-weight:600">'+bxe(l.days||1)+'d</td>'+
      '<td><span style="color:'+sc+';font-weight:700;font-size:11px">'+bxe(l.status||'pending')+'</span></td>'+
      '<td><div style="display:flex;gap:4px">'+
        (l.status==='pending'?
          '<button class="btn btn-sm" style="color:var(--success);background:rgba(52,211,153,.1)" onclick="bmApproveLeave(\''+bxe(l.id)+'\')">&#x2713; Approve</button>'+
          '<button class="btn btn-sm" style="color:var(--danger);background:rgba(248,113,113,.1)" onclick="bmRejectLeave(\''+bxe(l.id)+'\')">&#x2715; Reject</button>':'')+'</div></td>'+
    '</tr>';
  }).join('');

  h += '<div class="btw"><div class="btw-s"><table class="btbl"><thead><tr><th>Employee</th><th>Type</th><th>From</th><th>To</th><th>Days</th><th>Status</th><th>Action</th></tr></thead><tbody>'+
    (rows||'<tr><td colspan="7" style="text-align:center;color:var(--text-tertiary);padding:28px">No leave requests yet.</td></tr>')+
    '</tbody></table></div></div>';
  return h;
}

function saveBmLeaveRequest() {
  var eid = bgv('bmlv-emp'), type = bgv('bmlv-type'), from = bgv('bmlv-from'), to = bgv('bmlv-to');
  if(!eid||!from||!to){showToast('Select employee and dates','error');return;}
  if(from > to){showToast('Start date cannot be after end date','error');return;}
  // Guard against double-submit
  if(BS._submittingLeave){return;} BS._submittingLeave=true;
  setTimeout(function(){BS._submittingLeave=false;},2000);
  // Duplicate guard: same employee + same dates within last 60s
  var nowTs=Date.now();
  var dup=(BS.tsLeaves||[]).find(function(x){return x.empId===eid&&x.from===from&&x.to===to&&(nowTs-(x.createdAt||0)<60000);});
  if(dup){showToast('Duplicate leave request prevented','error');BS._submittingLeave=false;return;}
  var days = Math.max(1,Math.ceil((new Date(to+'T00:00:00')-new Date(from+'T00:00:00'))/86400000)+1);
  var s = NX.session||{};
  var rec = {id:buid(),empId:eid,type:type,start:from,from:from,end:to,to:to,days:days,
    note:bgv('bmlv-note'),status:'pending',branchId:s.branchId||'',branchName:s.branchName||'',
    submittedBy:s.entityName||'Branch Manager',createdAt:nowTs};
  // Single write path: if Firebase available, push there and let listener update BS.tsLeaves
  // Otherwise, write locally only
  if(db&&s.branchId){
    db.ref('branches/'+s.branchId+'/tsLeaves/'+rec.id).set(rec,function(err){
      if(err){showToast('Submit failed: '+err.message,'error');BS._submittingLeave=false;return;}
      bmUpdateBadges();
      showToast('Leave request submitted \u2713','success');
      navTo('bm-leave');
    });
  } else {
    BS.tsLeaves.push(rec);
    bSaveColl('tsLeaves',BS.tsLeaves);
    bmUpdateBadges();
    showToast('Leave request submitted \u2713','success');
    navTo('bm-leave');
  }
}

function bmApproveLeave(id) {
  var l = BS.tsLeaves.find(function(x){return x.id===id;});
  if(!l)return;
  l.status='approved';l.approvedAt=Date.now();
  bSaveColl('tsLeaves',BS.tsLeaves);
  bmUpdateBadges();
  showToast('Leave approved \u2713','success');
  navTo('bm-leave');
}

function bmRejectLeave(id) {
  var l = BS.tsLeaves.find(function(x){return x.id===id;});
  if(!l)return;
  l.status='rejected';
  bSaveColl('tsLeaves',BS.tsLeaves);
  bmUpdateBadges();
  showToast('Leave rejected','success');
  navTo('bm-leave');
}

// ── 3. PAYROLL SUBMIT ────────────────────────────────────────
function pBmPayroll() {
  attachBranchListeners();
  var s = NX.session||{};
  var now = new Date(new Date().getTime()+3*3600000);
  var monthKey = now.getFullYear()+'-'+String(now.getMonth()+1).padStart(2,'0');
  var h = '<div class="page-header"><h1>&#x1F4B8; Payroll Submit</h1><p>Enter monthly payroll for '+bxe(monthKey)+' &mdash; sent to HR for approval</p></div>';
  h += '<div id="bm-payroll-area">'+bxe('Loading payroll data...')+'</div>';
  if(db&&s.branchId){
    db.ref('branches/'+s.branchId+'/payroll/'+monthKey).once('value',function(snap){
      var existing = snap.val()||{};
      var area = document.getElementById('bm-payroll-area');
      if(!area)return;
      var staff = BS.staff.filter(function(m){return m.status==='Active'||m.status==='active';});
      if(!staff.length){area.innerHTML='<div style="text-align:center;padding:40px;color:var(--text-tertiary)">No active staff found. Add staff first.</div>';return;}

      // Check if already submitted
      var statuses = Object.values(existing).map(function(e){return (e||{}).status||'draft';});
      var submitted = statuses.some(function(st){return st==='pending_hr'||st==='pending_finance'||st==='released';});
      if(submitted){
        var st = statuses[0]||'pending_hr';
        var stColor = {pending_hr:'#b45309',pending_finance:'#0057ff',released:'#00875a'}[st]||'#94a3b8';
        area.innerHTML = '<div class="bcard" style="text-align:center;padding:32px;border-color:'+stColor+'40">'+
          '<div style="font-size:48px;margin-bottom:12px">&#x2705;</div>'+
          '<div style="font-size:16px;font-weight:700;margin-bottom:6px">Payroll Submitted</div>'+
          '<div style="font-size:12px;color:var(--text-secondary);margin-bottom:12px">Status: <span style="color:'+stColor+';font-weight:700">'+st+'</span></div>'+
          '<div style="font-size:11px;color:var(--text-tertiary)">'+monthKey+' &mdash; Awaiting HR approval</div></div>';
        return;
      }

      var rows = staff.map(function(m){
        var ex = existing[m.id]||{};
        return '<tr>'+
          '<td><div style="display:flex;align-items:center;gap:8px"><div class="bav">'+bini(m.name)+'</div>'+
          '<div><div style="font-size:12px;font-weight:600">'+bxe(m.name)+'</div>'+
          '<div style="font-size:10px;color:var(--text-tertiary)">'+bxe(m.role||m.dept||'')+'</div></div></div></td>'+
          '<td><input class="form-input" style="width:110px" type="number" id="bpay-base-'+bxe(m.id)+'" value="'+(ex.base||0)+'" placeholder="0"></td>'+
          '<td><input class="form-input" style="width:90px" type="number" id="bpay-allow-'+bxe(m.id)+'" value="'+(ex.allowances||0)+'" placeholder="0"></td>'+
          '<td><input class="form-input" style="width:90px" type="number" id="bpay-ded-'+bxe(m.id)+'" value="'+(ex.deductions||0)+'" placeholder="0"></td>'+
          '<td><input class="form-input" style="width:90px" type="number" id="bpay-ot-'+bxe(m.id)+'" value="'+(ex.overtime||0)+'" placeholder="0"></td>'+
          '<td class="bmono" style="font-weight:700;color:#00875a" id="bpay-net-'+bxe(m.id)+'">'+bfsar((ex.base||0)+(ex.allowances||0)-(ex.deductions||0)+(ex.overtime||0))+'</td>'+
          '</tr>';
      }).join('');

      area.innerHTML = '<div style="margin-bottom:12px;font-size:12px;color:var(--text-secondary)">&#x1F4A1; Enter base salary and adjust allowances / deductions. Overtime auto-calculated from timesheet if available.</div>'+
        '<div class="btw"><div class="btw-s"><table class="btbl"><thead><tr><th>Employee</th><th>Base (‫SAR ‬)</th><th>Allowances</th><th>Deductions</th><th>Overtime</th><th>Net Pay</th></tr></thead><tbody>'+rows+'</tbody></table></div></div>'+
        '<div style="display:flex;justify-content:flex-end;gap:10px;margin-top:16px">'+
        '<button class="btn" onclick="bmCalcPayrollNetPay()">&#x1F5A9;&#xFE0F; Recalculate</button>'+
        '<button class="btn btn-primary" onclick="bmSubmitPayroll(\''+bxe(s.branchId)+'\',\''+bxe(monthKey)+'\')">Submit to HR &#x2192;</button>'+
        '</div>';
    });
  } else {
    document.getElementById('bm-payroll-area').innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-tertiary)">Offline &mdash; cannot load payroll.</div>';
  }
  return h;
}

function bmCalcPayrollNetPay() {
  var staff = BS.staff.filter(function(m){return m.status==='Active'||m.status==='active';});
  staff.forEach(function(m){
    var base=parseFloat((document.getElementById('bpay-base-'+m.id)||{}).value)||0;
    var allow=parseFloat((document.getElementById('bpay-allow-'+m.id)||{}).value)||0;
    var ded=parseFloat((document.getElementById('bpay-ded-'+m.id)||{}).value)||0;
    var ot=parseFloat((document.getElementById('bpay-ot-'+m.id)||{}).value)||0;
    var net=base+allow-ded+ot;
    var el=document.getElementById('bpay-net-'+m.id);
    if(el)el.textContent=bfsar(net);
  });
  showToast('Recalculated \u2713','success');
}

function bmSubmitPayroll(branchId,monthKey) {
  if(!db||!NX.session)return;
  var staff = BS.staff.filter(function(m){return m.status==='Active'||m.status==='active';});
  if(!staff.length){showToast('No active staff','error');return;}
  if(!confirm('Submit payroll for '+monthKey+' to HR?'))return;
  var updates={};
  staff.forEach(function(m){
    var base=parseFloat((document.getElementById('bpay-base-'+m.id)||{}).value)||0;
    var allow=parseFloat((document.getElementById('bpay-allow-'+m.id)||{}).value)||0;
    var ded=parseFloat((document.getElementById('bpay-ded-'+m.id)||{}).value)||0;
    var ot=parseFloat((document.getElementById('bpay-ot-'+m.id)||{}).value)||0;
    var gross=base+allow+ot;var net=gross-ded;
    updates[m.id]={empId:m.id,empName:m.name,dept:m.dept||'',role:m.role||'',
      base:base,allowances:allow,deductions:ded,overtime:ot,grossPay:gross,netPay:net,
      status:'pending_hr',submittedBy:NX.session.entityName||'Branch Manager',submittedAt:Date.now()};
  });
  db.ref('branches/'+branchId+'/payroll/'+monthKey).set(updates,function(err){
    if(err){showToast('Submit failed: '+err.message,'error');return;}
    showToast('Payroll submitted to HR \u2713','success');
    navTo('bm-payroll');
  });
}

// ── 4. TRANSFER REQUESTS ─────────────────────────────────────
function pBmTransfers() {
  attachBranchListeners();
  var area = document.getElementById('page-area');
  if(area) area.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-secondary)"><div style="font-size:28px;margin-bottom:12px">🔀</div><div style="font-size:13px;font-weight:600">Loading requests…</div></div>';
  bmLoadTransfers(function(){
    var area = document.getElementById('page-area');
    if(!area)return;
    var pending = (BS._bmTransfers||[]).filter(function(t){return t.status==='pending';});
    var history = (BS._bmTransfers||[]).filter(function(t){return t.status!=='pending';});
    var h = '<div class="page-header"><h1>&#x1F500; Transfer Requests</h1><p>Incoming stock transfer requests from other branches</p></div>';
    h += '<div class="bgrid-3" style="margin-bottom:16px">';
    h += '<div class="bsc"><div class="bsc-lbl">Pending</div><div class="bsc-val" style="color:#b45309">'+pending.length+'</div></div>';
    h += '<div class="bsc"><div class="bsc-lbl">Accepted</div><div class="bsc-val" style="color:#00875a">'+((BS._bmTransfers||[]).filter(function(t){return t.status==='accepted';}).length)+'</div></div>';
    h += '<div class="bsc"><div class="bsc-lbl">Total</div><div class="bsc-val bca">'+((BS._bmTransfers||[]).length)+'</div></div>';
    h += '</div>';

    if(pending.length){
      h += '<div style="font-size:13px;font-weight:700;margin-bottom:10px;color:#b45309">&#x23F3; Pending Approval ('+pending.length+')</div>';
      pending.forEach(function(t){
        h += '<div class="bcard" style="margin-bottom:10px;border-color:rgba(245,158,11,.3)">';
        h += '<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px">';
        h += '<div style="flex:1"><div style="font-size:13px;font-weight:700;margin-bottom:4px">'+bxe(t.name||t.code||'Unknown Item')+'</div>';
        h += '<div style="font-size:12px;color:var(--text-secondary);margin-bottom:6px">'+
          '<span class="bmono" style="color:var(--ceo)">'+bxe(t.code||'')+'</span> &mdash; '+
          '<strong style="color:#5b21b6">'+bxe(t.qty)+' '+bxe(t.unit||'units')+'</strong> from '+
          '<strong>'+bxe(t.fromBranchName||t.fromBranch||'')+'</strong></div>';
        h += '<div style="font-size:11px;color:var(--text-tertiary)">Requested: '+bfdate(t.date)+(t.note?' &mdash; '+bxe(t.note):'')+'</div></div>';
        h += '<div style="display:flex;flex-direction:column;gap:6px">'+
          '<button class="btn btn-sm btn-primary" onclick="bmAcceptTransfer(\''+bxe(t.id)+'\')">&#x2713; Accept</button>'+
          '<button class="btn btn-sm" style="color:var(--danger);background:rgba(248,113,113,.1)" onclick="bmRejectTransfer(\''+bxe(t.id)+'\')">&#x2715; Reject</button>'+
          '</div>';
        h += '</div></div>';
      });
    }

    if(history.length){
      h += '<div style="font-size:13px;font-weight:700;margin-bottom:10px;margin-top:20px;color:var(--text-secondary)">History</div>';
      var rows = history.map(function(t){
        var sc = t.status==='accepted'?'#b45309':'#c0392b';
        return '<tr>'+
          '<td class="bmono" style="font-size:11px;color:var(--text-tertiary)">'+bfdate(t.date)+'</td>'+
          '<td style="font-weight:600;color:var(--text-primary)">'+bxe(t.name||t.code||'')+'</td>'+
          '<td class="bmono" style="color:#5b21b6">'+bxe(t.qty)+' '+bxe(t.unit||'')+'</td>'+
          '<td style="font-size:11px">'+bxe(t.fromBranchName||t.fromBranch||'')+'</td>'+
          '<td><span style="color:'+sc+';font-weight:700;font-size:11px">'+bxe(t.status)+'</span></td>'+
          '</tr>';
      }).join('');
      h += '<div class="btw"><div class="btw-s"><table class="btbl"><thead><tr><th>Date</th><th>Item</th><th>Qty</th><th>From</th><th>Status</th></tr></thead><tbody>'+rows+'</tbody></table></div></div>';
    }

    if(!(BS._bmTransfers||[]).length){
      h += '<div style="text-align:center;padding:48px;color:var(--text-tertiary)"><div style="font-size:48px;margin-bottom:12px">&#x1F4E5;</div><div style="font-size:14px;font-weight:600;margin-bottom:6px">No Transfer Requests</div><div style="font-size:12px">Transfer requests from other branches will appear here.</div></div>';
    }

    area.innerHTML = h;
    bmUpdateBadges();
  });
  return '<div class="page-header"><h1>&#x1F500; Transfer Requests</h1></div>'+
    '<div style="display:flex;align-items:center;gap:12px;padding:32px;color:var(--text-secondary)">'+
    '<div style="font-size:24px;animation:spin 1s linear infinite">&#x21BB;</div> Loading requests...</div>';
}

function bmAcceptTransfer(transferId) {
  var t = (BS._bmTransfers||[]).find(function(x){return x.id===transferId;});
  if(!t)return;
  var s = NX.session||{};
  if(!confirm('Accept '+t.qty+' '+bxe(t.unit||'units')+' of "'+bxe(t.name||t.code)+'" from '+bxe(t.fromBranchName||t.fromBranch)+'?'))return;
  // Update transfer status
  db.ref('branches/'+s.branchId+'/transfer_requests/'+transferId).update({status:'accepted',acceptedAt:Date.now(),acceptedBy:s.entityName||'Branch Manager'},function(err){
    if(err){showToast('Failed: '+err.message,'error');return;}
    // Add stock to this branch
    var item = bfindItem(t.code);
    if(item){
      item.qty = parseFloat(item.qty||0)+parseFloat(t.qty||0);
      bSaveStock(t.code,item.qty);
    }
    bLogs.push({code:t.code,name:t.name||t.code,type:'transfer-in',qty:t.qty,
      note:'Transfer accepted from '+bxe(t.fromBranchName||t.fromBranch),date:TODAY_BS});
    bSaveLogs();
    t.status='accepted';
    bmUpdateBadges();
    showToast('Transfer accepted \u2713 Stock updated','success');
    navTo('bm-transfers');
  });
}

function bmRejectTransfer(transferId) {
  var t = (BS._bmTransfers||[]).find(function(x){return x.id===transferId;});
  if(!t)return;
  var s = NX.session||{};
  if(!confirm('Reject this transfer request?'))return;
  db.ref('branches/'+s.branchId+'/transfer_requests/'+transferId).update({status:'rejected',rejectedAt:Date.now()},function(err){
    if(!err){
      t.status='rejected';
      bmUpdateBadges();
      showToast('Transfer rejected','success');
      navTo('bm-transfers');
    }
  });
}

// ── 5. ANNOUNCEMENTS ─────────────────────────────────────────
function pBmAnnouncements() {
  attachBranchListeners();
  var s = NX.session||{};
  bmLoadAnnouncements(function(){
    var area = document.getElementById('page-area');
    if(!area)return;
    var anns = BS._bmAnns||[];
    var acks = BS._bmAcks||{};
    var unread = anns.filter(function(a){return !acks[a.id];});
    var h = '<div class="page-header"><h1>&#x1F4E2; Announcements</h1><p>'+anns.length+' total &mdash; '+unread.length+' unread</p></div>';
    h += '<div class="bgrid-3" style="margin-bottom:16px">';
    h += '<div class="bsc"><div class="bsc-lbl">Total</div><div class="bsc-val bca">'+anns.length+'</div></div>';
    h += '<div class="bsc"><div class="bsc-lbl">Unread</div><div class="bsc-val" style="color:#c0392b">'+unread.length+'</div></div>';
    h += '<div class="bsc"><div class="bsc-lbl">Acknowledged</div><div class="bsc-val" style="color:#00875a">'+Object.keys(acks).length+'</div></div>';
    h += '</div>';
    if(!anns.length){
      h += '<div style="text-align:center;padding:48px;color:var(--text-tertiary)"><div style="font-size:48px;margin-bottom:12px">&#x1F4EC;</div><div style="font-size:14px;font-weight:600;margin-bottom:6px">No Announcements</div><div style="font-size:12px">HR announcements will appear here.</div></div>';
    } else {
      anns.forEach(function(a){
        var isRead = !!acks[a.id];
        var isUrgent = a.priority==='urgent';
        var borderCol = isUrgent?'#c0392b':isRead?'var(--border)':'#5b21b6';
        h += '<div style="background:var(--surface-2);border:1px solid '+borderCol+';border-left:3px solid '+borderCol+';border-radius:0 10px 10px 0;padding:14px 16px;margin-bottom:10px;opacity:'+(isRead?0.7:1)+'">';
        h += '<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px">';
        h += '<div style="flex:1">';
        h += '<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">'+
          '<strong style="font-size:13px">'+bxe(a.title||'')+'</strong>'+
          (isUrgent?'<span style="background:rgba(248,113,113,.15);color:#c0392b;border:1px solid rgba(248,113,113,.3);font-size:9px;font-weight:700;padding:2px 7px;border-radius:4px;text-transform:uppercase">URGENT</span>':'')+
          (a.requiresAck&&!isRead?'<span style="background:rgba(167,139,250,.15);color:#5b21b6;border:1px solid rgba(167,139,250,.3);font-size:9px;font-weight:700;padding:2px 7px;border-radius:4px;text-transform:uppercase">ACK REQUIRED</span>':'')+
          '</div>';
        h += '<div style="font-size:12px;color:var(--text-secondary);margin-bottom:8px;line-height:1.6">'+bxe(a.body||'')+'</div>';
        h += '<div style="font-size:11px;color:var(--text-tertiary)">Posted by '+bxe(a.postedBy||'HR')+' &middot; '+bxe(a.date||'')+'</div>';
        h += '</div>';
        if(!isRead){
          h += '<button class="btn btn-sm btn-primary" onclick="bmAcknowledge(\''+bxe(a.id)+'\')">&#x2713; Acknowledge</button>';
        } else {
          h += '<span style="color:#00875a;font-size:11px;font-weight:700;white-space:nowrap">&#x2713; Read</span>';
        }
        h += '</div></div>';
      });
    }
    area.innerHTML = h;
    bmUpdateBadges();
  });
  return '<div class="page-header"><h1>&#x1F4E2; Announcements</h1></div>'+
    '<div style="display:flex;align-items:center;gap:12px;padding:32px;color:var(--text-secondary)">'+
    '<div style="font-size:24px">&#x1F504;</div> Loading announcements...</div>';
}

function bmAcknowledge(annId) {
  var s = NX.session||{};
  if(!s.branchId||!db)return;
  var ts = Date.now();
  db.ref('branches/'+s.branchId+'/annAcks/'+annId).set(ts,function(err){
    if(!err){
      if(!BS._bmAcks)BS._bmAcks={};
      BS._bmAcks[annId]=ts;
      bmUpdateBadges();
      showToast('Acknowledged \u2713','success');
      navTo('bm-announcements');
    }
  });
}




/* ═══════════════════════════════════════════════════════════
   NEXUS SVG ICON SYSTEM — skill: Modern Outline · 1.6px
   stroke=currentColor fill=none · round caps & joins
   Geometric precision · negative space · currentColor
═══════════════════════════════════════════════════════════ */
var NX_SVG = {
  '👑': '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3 18h18M5 18l-1-9 4.5 4L12 5l3.5 8L20 9l-1 9H5z"/><circle cx="12" cy="4.2" r="1.1" fill="currentColor" stroke="none"/><circle cx="5" cy="9" r="1.1" fill="currentColor" stroke="none"/><circle cx="19" cy="9" r="1.1" fill="currentColor" stroke="none"/></svg>',
  '🎯': '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5.5"/><circle cx="12" cy="12" r="2"/></svg>',
  '👤': '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="3.5"/><path d="M4 20c0-4.418 3.582-7 8-7s8 2.582 8 7"/></svg>',
  '👥': '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="8" r="3"/><path d="M2 20c0-3.5 3.134-6 7-6M15 20c0-3.5-3.134-6-7-6M16 8a4 4 0 0 1 4 4"/><circle cx="16" cy="7" r="3"/><path d="M22 20c0-3.5-3.134-6-7-6"/></svg>',
  '🧑\u200d💼': '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="7.5" r="3"/><path d="M4 20c0-4 3.582-6.5 8-6.5s8 2.5 8 6.5"/><path d="M9.5 3.5h5a1 1 0 0 1 1 1V5a1 1 0 0 1-1 1h-5a1 1 0 0 1-1-1v-.5a1 1 0 0 1 1-1z"/></svg>',
  '📋': '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 3a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2"/><path d="M8 11h8M8 15h6"/></svg>',
  '📝': '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H6a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-5"/><path d="M8 10h7M8 14h4"/><path d="M17.5 3.5a2 2 0 0 1 2.8 2.8L13 13l-4 1 1-4 7.5-6.5z"/></svg>',
  '📄': '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><polyline points="14 3 14 9 20 9"/><path d="M8 13h8M8 17h5"/></svg>',
  '📑': '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><polyline points="14 3 14 9 20 9"/><path d="M8 13h8M8 17h8"/></svg>',
  '✅': '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="3"/><path d="M8 12l3 3 5-5"/></svg>',
  '⚠️': '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><circle cx="12" cy="17" r="0.8" fill="currentColor" stroke="none"/></svg>',
  '🚨': '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M18.36 5.64a9 9 0 1 1-12.73 0"/><path d="M12 2v5"/><circle cx="12" cy="13" r="2.5"/><line x1="12" y1="15.5" x2="12" y2="20"/></svg>',
  '🔐': '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/><circle cx="12" cy="16" r="1.2" fill="currentColor" stroke="none"/></svg>',
  '🔑': '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="8.5" cy="9" r="5"/><path d="M13 9h7.5M17 9v3"/></svg>',
  '🔄': '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M21 2v6h-6"/><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M3 22v-6h6"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/></svg>',
  '🔀': '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 3 21 3 21 8"/><line x1="4" y1="20" x2="21" y2="3"/><polyline points="21 16 21 21 16 21"/><line x1="15" y1="15" x2="21" y2="21"/><line x1="4" y1="4" x2="9" y2="9"/></svg>',
  '💰': '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="7" width="20" height="13" rx="2"/><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/><circle cx="12" cy="13.5" r="2.5"/><line x1="7" y1="13.5" x2="8" y2="13.5"/><line x1="16" y1="13.5" x2="17" y2="13.5"/></svg>',
  '💳': '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/><line x1="6" y1="15" x2="9" y2="15"/><line x1="12" y1="15" x2="16" y2="15"/></svg>',
  '💵': '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="6" width="20" height="12" rx="1.5"/><circle cx="12" cy="12" r="2.5"/><path d="M2 9a3 3 0 0 0 3-3M19 9a3 3 0 0 1 3-3M2 15a3 3 0 0 1 3 3M19 15a3 3 0 0 0 3 3"/></svg>',
  '💸': '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="8" width="20" height="12" rx="1.5"/><circle cx="12" cy="14" r="2.5"/><path d="M5 8V6M10 8V5M15 8V6M19 8V5"/></svg>',
  '🧾': '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 2h16v20l-2-1.5-2 1.5-2-1.5-2 1.5-2-1.5-2 1.5-2-1.5V2z"/><path d="M8 8h8M8 12h8M8 16h5"/></svg>',
  '📈': '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/></svg>',
  '📊': '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="12" width="4" height="9" rx="1"/><rect x="10" y="7" width="4" height="14" rx="1"/><rect x="17" y="4" width="4" height="17" rx="1"/><line x1="2" y1="21" x2="22" y2="21"/></svg>',
  '🍽️': '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3 2v6c0 1.9.98 3.5 2.5 4.47V22h3V12.47A5 5 0 0 0 11 7V2"/><line x1="7" y1="2" x2="7" y2="7"/><path d="M18 2c0 0 3 2.5 3 7s-3 7-3 7v6h-3V2h3z"/></svg>',
  '📦': '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M20.9 8.84L12 4 3.1 8.84"/><path d="M12 22V12"/><path d="M20.9 8.84v6.32L12 20.16l-8.9-5V8.84"/><path d="M7.5 11.4L12 14l4.5-2.6"/></svg>',
  '🛒': '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 0 1-8 0"/></svg>',
  '🗑️': '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>',
  '📢': '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8c1 .9 2 2.3 2 4s-1 3.1-2 4"/><path d="M5 12H3a2 2 0 0 1 0-4h2l8-5v14L5 12z"/><path d="M3 14a8 8 0 0 0 8 6"/></svg>',
  '🚫': '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><line x1="5.6" y1="5.6" x2="18.4" y2="18.4"/></svg>',
  '📅': '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/><path d="M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01"/></svg>',
  '🗓️': '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/><rect x="7" y="13" width="3" height="3" rx="0.5"/></svg>',
  '⏱️': '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="13" r="8"/><polyline points="12 9 12 13 15 15"/><path d="M9 2h6M12 2v3"/></svg>',
  '🏃': '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="15" cy="4" r="1.8"/><path d="M7 17l2.5-5L13 14l2-4"/><path d="M9 12L7 17M15 10l2.5 5"/><path d="M7 22l2-3M17 22l-2-3"/></svg>',
  '🏖️': '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M17 8c0 4-5 9-5 9S7 12 7 8a5 5 0 0 1 10 0z"/><circle cx="12" cy="8" r="2"/><line x1="2" y1="20" x2="22" y2="20"/></svg>',
  '🏪': '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l1-5h16l1 5"/><rect x="3" y="9" width="18" height="12" rx="1"/><path d="M9 21V14a3 3 0 0 1 6 0v7"/><line x1="3" y1="9" x2="21" y2="9"/></svg>',
  '🏢': '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="2" width="16" height="20" rx="1"/><path d="M9 22V12h6v10"/><path d="M8 6h.01M12 6h.01M16 6h.01M8 10h.01M12 10h.01M16 10h.01"/></svg>',
  '🗺️': '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><polygon points="3 6 9 3 15 6 21 3 21 18 15 21 9 18 3 21 3 6"/><line x1="9" y1="3" x2="9" y2="18"/><line x1="15" y1="6" x2="15" y2="21"/></svg>',
  '📱': '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="2" width="12" height="20" rx="2"/><circle cx="12" cy="18" r="1" fill="currentColor" stroke="none"/><line x1="9" y1="6" x2="15" y2="6"/></svg>',
  '🏆': '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2h12v9a6 6 0 0 1-12 0V2z"/><path d="M6 6H3a2 2 0 1 0 2 2"/><path d="M18 6h3a2 2 0 1 1-2 2"/><path d="M12 17v4M8 21h8"/></svg>',
  '🆘': '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M9 9a3 3 0 1 1 3 3v2"/><circle cx="12" cy="17.5" r="0.8" fill="currentColor" stroke="none"/></svg>',
  '🔴': '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8"/><path d="M8 12h8M12 8v8"/></svg>',
};

/* renderIcon(emoji, size) — returns SVG or falls back to emoji span */
function renderIcon(e, sz) {
  sz = sz || 18;
  var s = NX_SVG[e] || NX_SVG[e && e.replace(/\uFE0F/g,'')];
  if (!s) return '<span style="font-size:'+(sz*0.9)+'px;line-height:1;display:inline-flex;align-items:center">'+e+'</span>';
  return s.replace(/width="20"/g,'width="'+sz+'"').replace(/height="20"/g,'height="'+sz+'"');
}

/* patchIcons() — scan DOM after render and replace emoji in icon slots */
function patchIcons() {
  // Role icon divs in login
  document.querySelectorAll('.role-icon').forEach(function(el) {
    var t = el.textContent.trim();
    var s = NX_SVG[t] || NX_SVG[t.replace(/\uFE0F/g,'')];
    if (s) { el.innerHTML = s.replace(/width="20"/g,'width="26"').replace(/height="20"/g,'height="26"'); el.style.display='flex'; el.style.alignItems='center'; el.style.justifyContent='center'; }
  });
  // KPI icons
  document.querySelectorAll('.kpi-icon').forEach(function(el) {
    var t = el.textContent.trim();
    var s = NX_SVG[t] || NX_SVG[t.replace(/\uFE0F/g,'')];
    if (s) { el.innerHTML = s.replace(/width="20"/g,'width="22"').replace(/height="20"/g,'height="22"'); el.style.display='flex'; el.style.alignItems='center'; el.style.justifyContent='center'; }
  });
  // Nav items — icon span is first text node
  document.querySelectorAll('.nav-item .nav-icon, [class*="nav-item"] > span:first-child').forEach(function(el) {
    var t = el.textContent.trim();
    var s = NX_SVG[t] || NX_SVG[t.replace(/\uFE0F/g,'')];
    if (s) { el.innerHTML = s.replace(/width="20"/g,'width="16"').replace(/height="20"/g,'height="16"'); el.style.display='inline-flex'; el.style.alignItems='center'; }
  });
  // Branch selector icons
  document.querySelectorAll('.bs-btn .bs-icon, .bs-btn [class*="icon"]').forEach(function(el) {
    var t = el.textContent.trim();
    var s = NX_SVG[t] || NX_SVG[t.replace(/\uFE0F/g,'')];
    if (s) { el.innerHTML = s.replace(/width="20"/g,'width="20"').replace(/height="20"/g,'height="20"'); el.style.display='flex'; el.style.alignItems='center'; el.style.justifyContent='center'; }
  });
  // Hdr logo
  document.querySelectorAll('.hdr-logo, .header-logo, .load-icon, .hdr-logo-icon').forEach(function(el) {
    var t = el.textContent.trim();
    var s = NX_SVG[t] || NX_SVG[t.replace(/\uFE0F/g,'')];
    if (s) { el.innerHTML = s.replace(/width="20"/g,'width="24"').replace(/height="20"/g,'height="24"'); el.style.display='flex'; el.style.alignItems='center'; el.style.justifyContent='center'; }
  });
  // Standalone data-icon attributes
  document.querySelectorAll('[data-nx-icon]').forEach(function(el) {
    var ico = el.getAttribute('data-nx-icon');
    var sz = parseInt(el.getAttribute('data-nx-size')) || 20;
    var s = NX_SVG[ico];
    if (s) el.innerHTML = s.replace(/width="20"/g,'width="'+sz+'"').replace(/height="20"/g,'height="'+sz+'"');
  });
  // ── Broad sweep: any span/div that contains ONLY an emoji we have an SVG for ──
  // Covers branch cards, dashboard panels, login role cards, etc.
  var emojiOnlyRe = /^[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE00}-\u{FE0F}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}️✅⭐🔑🗺️📊📋📦📈📉💡⚠️✓🏪]+$/u;
  document.querySelectorAll('span, div').forEach(function(el) {
    if (el.children.length > 0) return; // skip elements with child elements
    var t = (el.textContent || '').trim();
    if (!t || t.length > 6) return;
    var s = NX_SVG[t] || NX_SVG[t.replace(/\uFE0F/g,'')];
    if (!s) return;
    // Only replace if this element looks like an icon slot (small, no big text context)
    var fs = parseFloat(window.getComputedStyle(el).fontSize) || 14;
    if (fs > 10 && fs < 40) {
      el.innerHTML = s.replace(/width="20"/g,'width="'+Math.round(fs)+'\"').replace(/height="20"/g,'height="'+Math.round(fs)+'"');
      el.style.display = el.style.display || 'inline-flex';
      el.style.alignItems = 'center';
      el.style.justifyContent = 'center';
    }
  });
}

/* Patch iconHTML() helper used in pBranchDash, pBranchMgmt etc. */
var _origKpiCard = (typeof kpiCard === 'function') ? kpiCard : null;

/* Hook navTo so icons are patched after every page render */
(function() {
  var _nt = window.navTo;
  if (typeof _nt === 'function') {
    window.navTo = function() {
      _nt.apply(this, arguments);
      setTimeout(patchIcons, 120);
    };
  }
  document.addEventListener('DOMContentLoaded', function() { setTimeout(patchIcons, 300); });
  // Also patch after 1s in case of async login render
  setTimeout(patchIcons, 1000);
  setTimeout(patchIcons, 2500);
})();

