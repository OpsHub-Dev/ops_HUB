/**
 * OpsHub v2 — core.js
 * Shared: Firebase init, session guard, layout shell, utilities
 * All role pages <script src="core.js"> BEFORE their own code
 */

/* ════════════════════════════════════════════════════
   FIREBASE CONFIG
════════════════════════════════════════════════════ */
var FB_CONFIG = {
  apiKey:            "AIzaSyB9DhSn5gDqAhpmLG9aVFAld1dSRYJWFDI",
  authDomain:        "opshub-f802f.firebaseapp.com",
  databaseURL:       "https://opshub-f802f-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId:         "opshub-f802f",
  storageBucket:     "opshub-f802f.firebasestorage.app",
  messagingSenderId: "84176854270",
  appId:             "1:84176854270:web:f7a66b3b38e98b630859af"
};

var db = null;
try {
  if (!firebase.apps.length) firebase.initializeApp(FB_CONFIG);
  db = firebase.database();
} catch(e) { console.warn('Firebase init:', e); }

/* ════════════════════════════════════════════════════
   SESSION
════════════════════════════════════════════════════ */
var NX = {
  session:  null,
  page:     null,
  theme:    'dark',
  branches: {}
};

/**
 * Call at top of each role page.
 * allowedRoles: array of role IDs allowed on this page.
 * If session missing or wrong role → redirect to index.html
 */
function requireSession(allowedRoles) {
  var raw = null;
  try { raw = sessionStorage.getItem('opshub_sess') || localStorage.getItem('opshub_sess'); } catch(e){}
  if (!raw) { window.location.href = 'index.html'; return null; }

  var sess = null;
  try { sess = JSON.parse(raw); } catch(e){}
  if (!sess || !sess.role) { window.location.href = 'index.html'; return null; }

  // Session expiry: 8 hours
  if ((Date.now() - (sess.loginAt||0)) > 28800000) {
    try { localStorage.removeItem('opshub_sess'); sessionStorage.removeItem('opshub_sess'); } catch(e){}
    window.location.href = 'index.html';
    return null;
  }

  // Role check
  if (allowedRoles && allowedRoles.length && allowedRoles.indexOf(sess.role) === -1) {
    window.location.href = 'index.html';
    return null;
  }

  NX.session = sess;
  NX.theme   = sess.theme || localStorage.getItem('alfa_theme') || 'dark';
  document.documentElement.setAttribute('data-theme', NX.theme);
  return sess;
}

function logout() {
  try { localStorage.removeItem('opshub_sess'); sessionStorage.removeItem('opshub_sess'); } catch(e){}
  window.location.href = 'index.html';
}

/* ════════════════════════════════════════════════════
   FIREBASE PATH HELPERS
════════════════════════════════════════════════════ */
function bPath(rel) {
  var s = NX.session;
  if (!s || !s.branchId) return rel;
  return 'branches/' + s.branchId + '/' + rel;
}

function bSave(rel, data, cb) {
  if (!db) return;
  db.ref(bPath(rel)).set(data, cb||null);
}

function bPush(rel, data, cb) {
  if (!db) return;
  db.ref(bPath(rel)).push(data, cb||null);
}

/* ════════════════════════════════════════════════════
   UTILITIES
════════════════════════════════════════════════════ */
function xe(s){ return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

function fmtSAR(n) {
  var v = parseFloat(n)||0;
  return 'SAR ' + v.toLocaleString('en-SA', {minimumFractionDigits:2, maximumFractionDigits:2});
}

function fmtDate(s) {
  if (!s) return '—';
  var d = new Date(s);
  if (isNaN(d)) return s;
  return d.toLocaleDateString('en-GB', {day:'2-digit', month:'short', year:'numeric'});
}

function today() {
  var d = new Date();
  return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
}

function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2,6); }

/* ════════════════════════════════════════════════════
   TOAST
════════════════════════════════════════════════════ */
function showToast(msg, type) {
  var c = document.getElementById('toasts');
  if (!c) {
    c = document.createElement('div');
    c.id = 'toasts';
    c.style.cssText = 'position:fixed;bottom:20px;right:20px;z-index:9999;display:flex;flex-direction:column;gap:8px';
    document.body.appendChild(c);
  }
  var t = document.createElement('div');
  var bg = type==='error'?'#ef4444':type==='warning'?'#f59e0b':'#22c55e';
  t.style.cssText = 'background:'+bg+';color:#fff;padding:10px 16px;border-radius:8px;font-family:Space Mono,monospace;font-size:11px;font-weight:700;box-shadow:0 4px 16px rgba(0,0,0,.3);animation:_tin .2s ease';
  t.textContent = msg;
  c.appendChild(t);
  setTimeout(function(){ if(t.parentNode) t.parentNode.removeChild(t); }, 2600);
}

/* ════════════════════════════════════════════════════
   THEME
════════════════════════════════════════════════════ */
function toggleTheme() {
  NX.theme = NX.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', NX.theme);
  localStorage.setItem('alfa_theme', NX.theme);
}

/* ════════════════════════════════════════════════════
   LAYOUT — renders sidebar + topbar shell
   Role page calls: renderShell(NAV_CONFIG, defaultPage)
════════════════════════════════════════════════════ */
function renderShell(navConfig, defaultPage) {
  var sess = NX.session;
  var html =
    '<div id="sidebar" class="sidebar">'+
      '<div class="sb-header">'+
        '<div class="sb-logo">'+
          '<img src="https://i.imgur.com/jeqtcE2.png" alt="ALFA.CO" class="sb-logo-img"/>'+
        '</div>'+
        '<button class="sb-toggle" onclick="toggleSidebar()" title="Collapse">'+
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>'+
        '</button>'+
      '</div>'+
      '<div class="sb-user">'+
        '<div class="sb-avatar">'+xe((sess.userName||'?').charAt(0).toUpperCase())+'</div>'+
        '<div class="sb-user-info">'+
          '<div class="sb-user-name">'+xe(sess.userName||'User')+'</div>'+
          (sess.branchName?'<div class="sb-user-role">'+xe(sess.branchName)+'</div>':'<div class="sb-user-role">'+xe(sess.role||'')+'</div>')+
        '</div>'+
      '</div>'+
      '<nav class="sb-nav" id="sbnav">';

  navConfig.forEach(function(section) {
    html += '<div class="sb-section">'+xe(section.section)+'</div>';
    section.items.forEach(function(item) {
      html += '<a class="sb-item" id="si-'+item.id+'" onclick="navTo(\''+item.id+'\')">'+
        '<span class="sb-item-icon">'+item.icon+'</span>'+
        '<span class="sb-item-label">'+xe(item.label)+'</span>'+
        (item.badge?'<span class="badge" id="b-'+item.badge+'"></span>':'')+
        '</a>';
    });
  });

  html +=
      '</nav>'+
      '<button class="sb-logout" onclick="logout()">'+
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>'+
        ' Logout'+
      '</button>'+
    '</div>'+

    '<div class="main" id="main">'+
      '<header class="topbar">'+
        '<button class="tb-menu" onclick="toggleSidebar()">'+
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="16" height="16"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>'+
        '</button>'+
        '<div class="tb-breadcrumb" id="tbc">'+
          '<span>ALFA.CO</span>'+
          (sess.brandName?'<span class="tbs"> › </span><span>'+xe(sess.brandName)+'</span>':'')+
          (sess.branchName?'<span class="tbs"> › </span><span>'+xe(sess.branchName)+'</span>':'')+
        '</div>'+
        '<div class="tb-actions">'+
          '<button class="tb-btn" onclick="toggleTheme()" title="Theme">'+
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" width="15" height="15"><circle cx="12" cy="12" r="4"/><line x1="12" y1="2" x2="12" y2="4"/><line x1="12" y1="20" x2="12" y2="22"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="2" y1="12" x2="4" y2="12"/><line x1="20" y1="12" x2="22" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>'+
          '</button>'+
          '<div class="cdot-wrap"><div class="cdot2" id="cdot2"></div></div>'+
        '</div>'+
      '</header>'+
      '<div class="page-area" id="page-area">'+
        '<div style="text-align:center;padding:60px;color:var(--text-3)"><div class="spin" style="margin:0 auto 14px"></div><div style="font-size:11px">Loading…</div></div>'+
      '</div>'+
    '</div>';

  document.getElementById('app').innerHTML = html;

  // Connection dot
  if (db) db.ref('.info/connected').on('value', function(s){
    var ok = !!s.val();
    var d = document.getElementById('cdot2');
    if(d) d.className='cdot2'+(ok?' on':'');
  });

  // Navigate to default page
  if (defaultPage) navTo(defaultPage);
}

function toggleSidebar() {
  var sb = document.getElementById('sidebar');
  var main = document.getElementById('main');
  if (!sb) return;
  sb.classList.toggle('collapsed');
  if (main) main.classList.toggle('sb-collapsed');
}

function setActiveSiItem(pageId) {
  document.querySelectorAll('.sb-item').forEach(function(el){ el.classList.remove('active'); });
  var el = document.getElementById('si-'+pageId);
  if (el) el.classList.add('active');
}

/* ════════════════════════════════════════════════════
   SHARED CSS (injected into <head> by role pages)
════════════════════════════════════════════════════ */
var SHARED_CSS = `
/* ── Design tokens ── */
:root {
  --surface:   #E7E5E4;
  --surface-2: #dddbd9;
  --surface-3: #d3d1cf;
  --text:      #1E2938;
  --text-2:    #4a5568;
  --text-3:    #718096;
  --primary:   #006666;
  --primary-h: #008080;
  --success:   #00A63D;
  --warning:   #FE9900;
  --danger:    #FF2157;
  --shadow-out: 6px 6px 14px #c8c6c4, -6px -6px 14px #ffffff;
  --shadow-in:  inset 4px 4px 10px #c8c6c4, inset -4px -4px 10px #ffffff;
  --shadow-btn: 4px 4px 10px #c8c6c4, -4px -4px 10px #ffffff;
  --shadow-press: inset 3px 3px 8px #c8c6c4, inset -3px -3px 8px #ffffff;
  --r: 14px; --r-sm: 8px; --r-xs: 5px;
}
[data-theme="dark"] {
  --surface:   #1e2028; --surface-2: #262830; --surface-3: #2e3038;
  --text:      #e8eaf0; --text-2:    #b0b8c8; --text-3:    #5b6478;
  --shadow-out: 6px 6px 16px #13141a, -6px -6px 16px #292b35;
  --shadow-in:  inset 4px 4px 10px #13141a, inset -4px -4px 10px #292b35;
  --shadow-btn: 4px 4px 10px #13141a, -4px -4px 10px #292b35;
  --shadow-press: inset 3px 3px 8px #13141a, inset -3px -3px 8px #292b35;
}
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Space Mono',monospace;background:var(--surface);color:var(--text);
  min-height:100vh;display:flex;transition:background .25s,color .25s;overflow:hidden}
#app{display:flex;width:100%;height:100vh;overflow:hidden}

/* ── Sidebar ── */
.sidebar{
  width:220px;min-width:220px;height:100vh;
  background:var(--surface);
  box-shadow:var(--shadow-out);
  display:flex;flex-direction:column;
  transition:width .2s,min-width .2s;
  z-index:100;position:relative;
  overflow-y:auto;overflow-x:hidden;
}
.sidebar.collapsed{width:56px;min-width:56px}
.sidebar.collapsed .sb-item-label,
.sidebar.collapsed .sb-user-info,
.sidebar.collapsed .sb-section,
.sidebar.collapsed .sb-logout span{display:none}
.sidebar.collapsed .sb-logo-img{display:none}
.sb-header{display:flex;align-items:center;justify-content:space-between;padding:14px 12px 10px;border-bottom:1px solid var(--surface-3)}
.sb-logo{display:flex;align-items:center}
.sb-logo-img{width:120px;height:auto;display:block}
.sb-toggle{background:none;border:none;cursor:pointer;color:var(--text-3);padding:4px;border-radius:5px;transition:color .12s}
.sb-toggle:hover{color:var(--primary)}
.sb-user{display:flex;align-items:center;gap:9px;padding:12px 12px 10px;border-bottom:1px solid var(--surface-3)}
.sb-avatar{
  width:32px;height:32px;border-radius:8px;
  background:var(--primary);color:#fff;flex-shrink:0;
  display:flex;align-items:center;justify-content:center;
  font-size:13px;font-weight:700;
}
.sb-user-name{font-size:11px;font-weight:700;color:var(--text)}
.sb-user-role{font-size:9px;color:var(--text-3);margin-top:1px}
.sb-nav{flex:1;padding:8px 0;overflow-y:auto;overflow-x:hidden}
.sb-section{font-size:8px;font-weight:700;letter-spacing:2px;color:var(--text-3);text-transform:uppercase;padding:10px 14px 4px}
.sb-item{
  display:flex;align-items:center;gap:9px;
  padding:9px 14px;cursor:pointer;
  font-size:11px;color:var(--text-2);
  border-radius:0;transition:all .12s;
  text-decoration:none;border-left:3px solid transparent;
  position:relative;
}
.sb-item:hover{background:var(--surface-2);color:var(--primary)}
.sb-item.active{background:var(--surface-2);color:var(--primary);border-left-color:var(--primary);font-weight:700}
.sb-item-icon{width:16px;height:16px;flex-shrink:0;display:flex;align-items:center;justify-content:center}
.sb-item-icon svg{width:15px;height:15px}
.sb-logout{
  background:none;border:none;border-top:1px solid var(--surface-3);
  cursor:pointer;font-family:'Space Mono',monospace;font-size:10px;
  color:var(--text-3);padding:12px 14px;
  display:flex;align-items:center;gap:8px;width:100%;transition:color .12s;
}
.sb-logout:hover{color:var(--danger)}
.badge{
  margin-left:auto;min-width:16px;height:16px;border-radius:8px;
  background:var(--danger);color:#fff;font-size:9px;font-weight:700;
  display:none;align-items:center;justify-content:center;padding:0 4px;
}
.badge.show{display:flex}

/* ── Main ── */
.main{flex:1;display:flex;flex-direction:column;height:100vh;overflow:hidden}
.main.sb-collapsed{flex:1}
.topbar{
  height:50px;min-height:50px;
  background:var(--surface);
  box-shadow:0 2px 8px rgba(0,0,0,.07);
  display:flex;align-items:center;gap:10px;
  padding:0 16px;z-index:50;
}
.tb-menu{background:none;border:none;cursor:pointer;color:var(--text-3);padding:4px;border-radius:5px;display:none}
@media(max-width:768px){.tb-menu{display:flex}}
.tb-breadcrumb{flex:1;font-size:10px;color:var(--text-3);overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
.tbs{opacity:.4}
.tb-actions{display:flex;align-items:center;gap:8px}
.tb-btn{
  background:var(--surface);box-shadow:var(--shadow-btn);
  border:none;border-radius:var(--r-xs);
  width:30px;height:30px;cursor:pointer;
  display:flex;align-items:center;justify-content:center;
  color:var(--text-3);transition:all .12s;
}
.tb-btn:hover{box-shadow:var(--shadow-out);color:var(--primary)}
.cdot-wrap{display:flex;align-items:center}
.cdot2{width:6px;height:6px;border-radius:50%;background:var(--danger)}
.cdot2.on{background:var(--success)}
.page-area{flex:1;overflow-y:auto;overflow-x:hidden;padding:18px}

/* ── Cards ── */
.kpi-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;margin-bottom:18px}
.kpi{
  background:var(--surface);box-shadow:var(--shadow-out);
  border-radius:var(--r);padding:14px 16px;
}
.kpi-label{font-size:9px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:var(--text-3);margin-bottom:6px}
.kpi-value{font-size:20px;font-weight:700;color:var(--text);line-height:1}
.kpi-sub{font-size:9px;color:var(--text-3);margin-top:4px}
.card{background:var(--surface);box-shadow:var(--shadow-out);border-radius:var(--r);padding:16px;margin-bottom:14px}
.card-title{font-size:11px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:var(--text-3);margin-bottom:12px;display:flex;align-items:center;gap:6px}

/* ── Tables ── */
.tbl-wrap{overflow-x:auto;border-radius:var(--r-sm)}
table{width:100%;border-collapse:collapse;font-size:11px}
th{font-size:9px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:var(--text-3);padding:8px 10px;border-bottom:1px solid var(--surface-3);text-align:left;white-space:nowrap}
td{padding:9px 10px;border-bottom:1px solid var(--surface-3);color:var(--text-2);vertical-align:middle}
tr:hover td{background:var(--surface-2)}
tr:last-child td{border-bottom:none}

/* ── Buttons ── */
.btn{
  display:inline-flex;align-items:center;justify-content:center;gap:5px;
  background:var(--surface);box-shadow:var(--shadow-btn);
  border:none;border-radius:var(--r-xs);
  font-family:'Space Mono',monospace;font-size:10px;font-weight:700;
  color:var(--text);padding:8px 14px;cursor:pointer;transition:all .12s;
}
.btn:hover{box-shadow:var(--shadow-out)}
.btn:active{box-shadow:var(--shadow-press)}
.btn-p{background:var(--primary);color:#fff;box-shadow:3px 3px 10px rgba(0,102,102,.35)}
.btn-p:hover{background:var(--primary-h)}
.btn-sm{padding:5px 10px;font-size:9px}
.btn-danger{background:var(--danger);color:#fff}

/* ── Forms ── */
.form-row{display:flex;flex-wrap:wrap;gap:10px;margin-bottom:10px}
.form-field{display:flex;flex-direction:column;gap:4px;flex:1;min-width:140px}
.form-field label{font-size:9px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:var(--text-3)}
input,select,textarea{
  background:var(--surface);box-shadow:var(--shadow-in);
  border:none;border-radius:var(--r-xs);
  font-family:'Space Mono',monospace;font-size:11px;color:var(--text);
  padding:9px 12px;outline:none;width:100%;
  transition:box-shadow .12s;
}
input:focus,select:focus,textarea:focus{box-shadow:var(--shadow-in),0 0 0 2px var(--primary)}
select option{background:var(--surface)}
textarea{resize:vertical;min-height:70px}

/* ── Chips/pills ── */
.chip{display:inline-block;padding:3px 8px;border-radius:20px;font-size:9px;font-weight:700}
.chip-g{background:rgba(0,166,61,.12);color:#00A63D}
.chip-r{background:rgba(255,33,87,.12);color:#FF2157}
.chip-y{background:rgba(254,153,0,.12);color:#FE9900}
.chip-b{background:rgba(0,102,102,.12);color:#006666}
.chip-n{background:var(--surface-3);color:var(--text-3)}

/* ── Modal ── */
.modal-overlay{
  position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:200;
  display:flex;align-items:center;justify-content:center;padding:20px;
}
.modal{
  background:var(--surface);border-radius:var(--r);
  box-shadow:var(--shadow-out);padding:22px 20px;
  width:100%;max-width:500px;max-height:85vh;overflow-y:auto;
}
.modal-title{font-size:12px;font-weight:700;letter-spacing:1px;margin-bottom:14px;display:flex;align-items:center;justify-content:space-between}
.modal-close{background:none;border:none;cursor:pointer;font-size:16px;color:var(--text-3);line-height:1}

/* ── Spinner ── */
.spin{display:inline-block;width:20px;height:20px;border:2px solid color-mix(in srgb,var(--primary) 25%,transparent);border-top-color:var(--primary);border-radius:50%;animation:_sp .7s linear infinite}
@keyframes _sp{to{transform:rotate(360deg)}}
@keyframes _tin{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}

/* ── Page header ── */
.page-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;flex-wrap:wrap;gap:10px}
.page-title{font-size:14px;font-weight:700;color:var(--text)}
.page-title-sub{font-size:10px;color:var(--text-3);margin-top:1px}

/* ── Empty state ── */
.empty{text-align:center;padding:44px 20px;color:var(--text-3);font-size:11px}
.empty svg{width:40px;height:40px;opacity:.3;margin:0 auto 10px;display:block}

/* ── Scrollbar ── */
::-webkit-scrollbar{width:4px;height:4px}
::-webkit-scrollbar-thumb{background:var(--text-3);border-radius:2px}
::-webkit-scrollbar-track{background:transparent}

/* ── Responsive ── */
@media(max-width:768px){
  .sidebar{position:fixed;left:-220px;z-index:300;transition:left .2s}
  .sidebar.mobile-open{left:0}
  .kpi-grid{grid-template-columns:1fr 1fr}
  .form-row{flex-direction:column}
}
`;

function injectCSS() {
  var style = document.createElement('style');
  style.textContent = SHARED_CSS;
  document.head.appendChild(style);
}
