/* 微信演示版 · 页面逻辑 */
(function () {
  'use strict';

  /* ===== AI 配置（智谱 GLM）===== */
  var API_CONFIG = {
    API_URL: 'https://open.bigmodel.cn/api/paas/v4/chat/completions',
    MODEL: 'glm-4.7-flash',
    API_KEYS: [
      '319acc34d3a749fe9dc335d7ffd70aba.GwuZ2qfbl4epViPL',
      'b8a6bad3b0b049e38d1b0bab354372d3.UE8Y87OGTEwELKkk',
      '5f42cb5187b04e2d939bdf79694e5d30.EKqhNiTJIFTW0xTw',
      'aec8d435c8ca4aa7bd1dbb767da946a2.VunBSAIasNS1Uup2',
      'd4e00a4b00484f3f84c3749885a70f05.dNp5jRqkwRgltgdj'
    ]
  };

  var DB_KEY = 'wx_demo_v1';
  var db = null;
  var ui = {
    view: 'splash',
    tab: 'chats',
    chatPeer: null,
    authTab: 'login',
    draft: {},
    aiBusy: false,
    modal: null,
    ai: { status: 'idle', reason: '' }
  };

  /* 部署 worker.js 之后，把它的地址填在这里（例如 https://wx-demo.example.workers.dev）。
     留空则直接请求智谱官方接口——浏览器跨域会拦下来，AI 会退到本地演示回复。
     也可以在页面「我 → AI 接口设置」里临时改，改了存在浏览器里，不用动代码。 */
  var PROXY_URL = '';

  /* 运行时配置：页面里改过的接口地址 / 模型 / Key 存这里，优先于上面的默认值 */
  var CFG_KEY = 'wx_demo_ai_v1';

  function loadAICfg() {
    var saved = null;
    try { saved = JSON.parse(localStorage.getItem(CFG_KEY) || 'null'); } catch (e) { saved = null; }
    return saved || {};
  }

  function aiCfg() {
    var c = loadAICfg();
    var keys = null;
    if (typeof c.keys === 'string') {
      keys = c.keys.split('\n').map(function (s) { return s.trim(); }).filter(Boolean);
    }
    return {
      url: c.url || PROXY_URL || API_CONFIG.API_URL,
      model: c.model || API_CONFIG.MODEL,
      // 存过空的 Key 就是「免 Key 接口」，不再回落到内置的智谱 Key
      keys: (keys !== null) ? keys : API_CONFIG.API_KEYS.slice()
    };
  }

  function byId(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function uid() { return Math.random().toString(36).slice(2, 9); }
  function nowTs() { return Date.now(); }

  /* ===== 数据 ===== */
  function loadDB() {
    var raw = null;
    try { raw = localStorage.getItem(DB_KEY); } catch (e) { raw = null; }
    if (raw) {
      try { db = JSON.parse(raw); } catch (e) { db = null; }
    }
    if (!db || typeof db !== 'object') db = {};
    if (!db.accounts) db.accounts = {};
    if (!db.chats) db.chats = {};
    if (!db.contacts) db.contacts = {};
    if (!db.moments) db.moments = {};
    if (!db.meta) db.meta = {};
    if (!('session' in db)) db.session = null;
    return db;
  }
  function saveDB() {
    try { localStorage.setItem(DB_KEY, JSON.stringify(db)); }
    catch (e) { toast('本机存储写入失败，本次操作可能无法保留'); }
  }
  function acct() { return db.session && db.accounts[db.session] ? db.accounts[db.session] : null; }
  function chatStore(key, peer) {
    if (!db.chats[key]) db.chats[key] = {};
    if (!db.chats[key][peer]) db.chats[key][peer] = { msgs: [], unread: 0 };
    return db.chats[key][peer];
  }
  function contactsOf(key) {
    if (!db.contacts[key]) db.contacts[key] = [];
    return db.contacts[key];
  }
  function momentsOf(key) {
    if (!db.moments[key]) db.moments[key] = [];
    return db.moments[key];
  }

  /* ===== 视图切换 ===== */
  var VIEW_IDS = { splash: 'v-splash', auth: 'v-auth', main: 'v-main', chat: 'v-chat', moments: 'v-moments' };
  function show(name) {
    Object.keys(VIEW_IDS).forEach(function (k) {
      var el = byId(VIEW_IDS[k]);
      if (el) el.classList.toggle('on', k === name);
    });
    ui.view = name;
  }

  /* ===== 轻提示 / 弹窗 ===== */
  var toastTimer = null;
  function toast(msg) {
    var t = byId('toast');
    t.textContent = msg;
    t.classList.add('on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('on'); }, 2000);
  }

  function openModal(opts) {
    var mask = byId('mask');
    var m = byId('modal');
    var actions = (opts.actions || []).map(function (a, i) {
      return '<button class="btn ' + (a.kind || 'plain') + '" type="button" data-act="modal" data-i="' + i + '">' + esc(a.label) + '</button>';
    }).join('');
    m.innerHTML =
      '<p class="modal-title">' + esc(opts.title) + '</p>' +
      '<div class="modal-body">' + (opts.body || '') + '</div>' +
      (actions ? '<div class="modal-actions">' + actions + '</div>' : '');
    ui.modal = opts;
    mask.classList.add('on');
    var first = m.querySelector('input,textarea');
    if (first) setTimeout(function () { try { first.focus(); } catch (e) {} }, 60);
  }
  function closeModal() {
    byId('mask').classList.remove('on');
    ui.modal = null;
  }

  /* ===== 启动页：加载条 ===== */
  var MIN_MS = 950;
  var ready = false, failed = false, shown = 0, done = false, t0 = performance.now();
  var IMG = 'icon/ODF-hd.png';

  function pctText(v) { return Math.max(0, Math.min(100, Math.floor(v))) + '%'; }

  function finishSplash() {
    if (done) return;
    done = true;
    var fill = byId('fill'), track = byId('track'), meta = byId('meta'), hint = byId('hint');
    fill.style.transform = 'scaleX(1)';
    meta.textContent = '100%';
    if (track) track.setAttribute('aria-valuenow', '100');
    if (failed) {
      meta.classList.add('failed');
      meta.textContent = '图标加载失败';
      hint.classList.add('failed');
      hint.textContent = '请检查 icon/ODF-hd.png 是否就位';
    }
    setTimeout(function () {
      byId('loader').classList.add('gone');
      byId('entryBtn').classList.add('on');
    }, 180);
  }

  function frame(ts) {
    if (done) return;
    var elapsed = ts - t0;
    var ramp = 1 - Math.pow(1 - Math.min(1, elapsed / 780), 2);
    var cap = ready ? 1 : 0.86;
    var target = Math.min(ramp, cap) * 100;
    shown += (target - shown) * 0.18;
    if (shown > 99.4 && elapsed > MIN_MS) { finishSplash(); return; }
    var view = Math.min(shown, 99.4);
    var fill = byId('fill'), meta = byId('meta'), track = byId('track');
    fill.style.transform = 'scaleX(' + (view / 100).toFixed(4) + ')';
    meta.textContent = pctText(view);
    if (track) track.setAttribute('aria-valuenow', String(Math.floor(view)));
    requestAnimationFrame(frame);
  }

  function bootSplash() {
    var probe = new Image();
    probe.onload = function () { ready = true; };
    probe.onerror = function () { failed = true; ready = true; };
    probe.src = IMG;
    if (probe.decode) probe.decode().then(function () { ready = true; }).catch(function () {});
    requestAnimationFrame(frame);
    setTimeout(function () { if (!ready) { ready = true; failed = true; } }, 6000);
    byId('icon').addEventListener('error', function () {
      byId('icon').style.display = 'none';
      var label = document.createElement('span');
      label.style.cssText = 'font-size:12px;color:#B0453B;letter-spacing:.02em;text-align:center;padding:0 10px;';
      label.textContent = '图标缺失';
      byId('icon').parentElement.appendChild(label);
    });
  }

  /* ===== 进入应用 ===== */
  function enterApp() {
    var a = acct();
    if (a) {
      show('main');
      setTab('chats');
      renderAll();
    } else {
      show('auth');
      renderAuth();
    }
  }

  /* ===== 登录 / 注册 ===== */
  function fieldHtml(label, id, type, ph) {
    return '<div class="field"><label for="' + id + '">' + label + '</label>' +
      '<input id="' + id + '" type="' + type + '" placeholder="' + ph + '" ' +
      (type === 'password' ? 'autocomplete="new-password" ' : 'autocomplete="off" ') +
      'maxlength="40"></div>';
  }

  function renderAuth() {
    var seg = byId('authSeg');
    Array.prototype.forEach.call(seg.querySelectorAll('button'), function (b) {
      b.classList.toggle('on', b.getAttribute('data-tab') === ui.authTab);
    });
    byId('aiNickBtn').style.display = ui.authTab === 'register' ? '' : 'none';
    byId('authDot').style.display = ui.authTab === 'register' ? '' : 'none';

    var form = byId('authForm');
    var html;
    if (ui.authTab === 'register') {
      html = fieldHtml('昵称', 'f-nick', 'text', '例如：林小满') +
        fieldHtml('账号', 'f-account', 'text', '3–20 位字母、数字或下划线') +
        fieldHtml('密码', 'f-pass', 'password', '至少 6 位') +
        fieldHtml('确认密码', 'f-pass2', 'password', '再输一次') +
        '<p class="err" id="authErr"></p>' +
        '<button class="btn block" type="submit">注册并登录</button>';
    } else {
      html = fieldHtml('账号', 'f-account', 'text', '你注册的演示账号') +
        fieldHtml('密码', 'f-pass', 'password', '登录密码') +
        '<p class="err" id="authErr"></p>' +
        '<button class="btn block" type="submit">登录</button>';
    }
    form.innerHTML = html;

    Object.keys(ui.draft).forEach(function (k) {
      var el = byId(k);
      if (el) el.value = ui.draft[k];
    });

    Array.prototype.forEach.call(form.querySelectorAll('input'), function (inp) {
      inp.addEventListener('input', function () {
        ui.draft[inp.id] = inp.value;
        var e = byId('authErr');
        if (e) e.textContent = '';
      });
    });
  }

  function authError(msg) {
    var e = byId('authErr');
    if (e) e.textContent = msg;
    return false;
  }

  function readAuth() {
    return {
      nick: (byId('f-nick') || {}).value || '',
      account: (byId('f-account') || {}).value || '',
      pass: (byId('f-pass') || {}).value || '',
      pass2: (byId('f-pass2') || {}).value || ''
    };
  }

  var COLORS = ['#4E8DF5', '#F2994A', '#27AE60', '#9B51E0', '#EB5757', '#2D9CDB', '#7A8C6F', '#C2703A'];
  function colorFor(seed) {
    var h = 0;
    for (var i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) % 997;
    return COLORS[h % COLORS.length];
  }

  function seedAccount(key, nick) {
    chatStore(key, 'wxteam').msgs.push({
      id: uid(), me: false, text: '欢迎使用微信演示版。这里只有你一个真实用户，其他会话都是演示内容。', ts: nowTs()
    });
    chatStore(key, 'ai').msgs.push({
      id: uid(), me: false, sys: true,
      text: 'AI 助手已就绪。可以问它怎么注册、帮你想昵称，也可以随便聊聊。',
      ts: nowTs()
    });
  }

  function doRegister() {
    var f = readAuth();
    var nick = f.nick.trim(), account = f.account.trim();
    if (!nick) return authError('昵称不能为空');
    if (nick.length > 12) return authError('昵称最多 12 个字');
    if (!/^[A-Za-z0-9_\-]{3,20}$/.test(account)) return authError('账号需 3–20 位，只能用字母、数字、下划线或短横线');
    if (f.pass.length < 6) return authError('密码至少 6 位');
    if (f.pass !== f.pass2) return authError('两次输入的密码不一致');
    if (db.accounts[account]) return authError('这个账号已被注册，换一个或直接登录');

    db.accounts[account] = {
      account: account,
      pass: f.pass,
      nick: nick,
      color: colorFor(account),
      wxid: 'wxid_' + uid(),
      sign: '这个人很懒，什么都没留下',
      created: nowTs()
    };
    db.session = account;
    seedAccount(account, nick);
    saveDB();
    ui.draft = {};
    show('main');
    setTab('chats');
    renderAll();
    toast('注册成功，已登录演示账号');
  }

  function doLogin() {
    var f = readAuth();
    var account = f.account.trim();
    if (!account) return authError('请输入账号');
    if (!f.pass) return authError('请输入密码');
    var a = db.accounts[account];
    if (!a) {
      if (Object.keys(db.accounts).length === 0) return authError('本机还没有演示账号，请先切到「注册」新建一个');
      return authError('没有这个账号，请检查后重试');
    }
    if (a.pass !== f.pass) return authError('密码不对，再试一次');
    db.session = account;
    saveDB();
    ui.draft = {};
    show('main');
    setTab('chats');
    renderAll();
    toast('已登录 ' + a.nick);
  }

  /* ===== 主界面 ===== */
  var TAB_TITLES = { chats: '微信', contacts: '通讯录', discover: '发现', me: '我' };

  function setTab(tab) {
    ui.tab = tab;
    ['chats', 'contacts', 'discover', 'me'].forEach(function (t) {
      var p = byId('panel-' + t);
      if (p) p.classList.toggle('on', t === tab);
    });
    Array.prototype.forEach.call(byId('tabbar').querySelectorAll('.tab'), function (b) {
      b.classList.toggle('on', b.getAttribute('data-tab') === tab);
    });
    byId('mainTitle').textContent = TAB_TITLES[tab] || '微信';
    var plus = document.querySelector('[data-act="plus"]');
    if (plus) plus.style.visibility = (tab === 'chats' || tab === 'contacts') ? 'visible' : 'hidden';
    var content = document.querySelector('.content');
    if (content) content.scrollTop = 0;
  }

  function renderAll() {
    renderChats();
    renderContacts();
    renderDiscover();
    renderMe();
  }

  function fmtTime(ts) {
    if (!ts) return '';
    var d = new Date(ts), n = new Date();
    var pad = function (x) { return x < 10 ? '0' + x : '' + x; };
    if (d.toDateString() === n.toDateString()) return pad(d.getHours()) + ':' + pad(d.getMinutes());
    var y = new Date(n.getTime() - 86400000);
    if (d.toDateString() === y.toDateString()) return '昨天';
    return (d.getMonth() + 1) + '月' + d.getDate() + '日';
  }

  function avatar(text, color, cls) {
    return '<span class="av ' + (cls || '') + '" style="background:' + color + '">' + esc(text) + '</span>';
  }

  function peerInfo(peer) {
    var a = acct();
    if (peer === 'ai') return { name: 'AI 助手', color: '#07C160', text: 'AI', sub: '智谱 GLM · 演示接入' };
    if (peer === 'wxteam') return { name: '微信团队', color: '#576B95', text: '微', sub: '系统通知' };
    var c = contactsOf(db.session).filter(function (x) { return x.id === peer; })[0];
    if (c) return { name: c.name, color: c.color, text: c.name.slice(0, 1), sub: c.sign || '演示联系人' };
    return { name: '未知联系人', color: '#8E978F', text: '?', sub: '' };
  }

  function preview(peer) {
    var st = db.chats[db.session] && db.chats[db.session][peer];
    if (!st || !st.msgs.length) return { text: '暂无消息', ts: 0, unread: 0 };
    var last = st.msgs[st.msgs.length - 1];
    var t = last.sys ? last.text : (last.me ? '我：' + last.text : last.text);
    if (t.length > 26) t = t.slice(0, 26) + '…';
    return { text: t, ts: last.ts, unread: st.unread || 0 };
  }

  function renderChats() {
    var key = db.session;
    var peers = ['ai', 'wxteam'];
    contactsOf(key).forEach(function (c) {
      if (db.chats[key] && db.chats[key][c.id]) peers.push(c.id);
    });
    var rows = peers.map(function (p) {
      var info = peerInfo(p), pv = preview(p);
      return '<div class="row" role="button" tabindex="0" data-act="open-chat" data-peer="' + esc(p) + '">' +
        avatar(info.text, info.color) +
        '<div class="row-main"><div class="row-top"><span class="row-name">' + esc(info.name) + '</span>' +
        '<span class="row-time">' + esc(fmtTime(pv.ts)) + '</span></div>' +
        '<p class="row-sub">' + esc(pv.text) + '</p></div>' +
        (pv.unread ? '<span class="badge">' + pv.unread + '</span>' : '') + '</div>';
    }).join('');
    byId('panel-chats').innerHTML = rows ||
      '<div class="empty"><p class="empty-t">还没有会话</p><p>去通讯录添加联系人，或和 AI 助手聊两句。</p></div>';
  }

  function renderContacts() {
    var key = db.session;
    var list = contactsOf(key);
    var star = ['ai', 'wxteam'].map(function (p) {
      var info = peerInfo(p);
      return '<div class="row" role="button" tabindex="0" data-act="open-chat" data-peer="' + p + '">' +
        avatar(info.text, info.color) + '<div class="row-main"><div class="row-top"><span class="row-name">' +
        esc(info.name) + '</span></div><p class="row-sub">' + esc(info.sub) + '</p></div></div>';
    }).join('');
    var mine = list.map(function (c) {
      return '<div class="row" role="button" tabindex="0" data-act="open-chat" data-peer="' + esc(c.id) + '">' +
        avatar(c.name.slice(0, 1), c.color) + '<div class="row-main"><div class="row-top"><span class="row-name">' +
        esc(c.name) + '</span></div><p class="row-sub">' + esc(c.sign || '演示联系人') + '</p></div></div>';
    }).join('');

    byId('panel-contacts').innerHTML =
      '<div class="cells"><button class="cell" type="button" data-act="contact-add">' +
      '<span class="cell-ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg></span>' +
      '<span class="cell-label">添加朋友</span>' +
      '<span class="cell-chev"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 5l7 7-7 7"/></svg></span></button></div>' +
      '<div class="group-label">特别关注</div><div class="cells">' + star + '</div>' +
      '<div class="group-label">我的联系人 · ' + list.length + '</div>' +
      (list.length ? '<div class="cells">' + mine + '</div>'
        : '<div class="empty"><p class="empty-t">还没有联系人</p><p>点上面的「添加朋友」新建一个本地演示联系人。</p></div>');
  }

  function renderDiscover() {
    var items = [
      { act: 'moments', label: '朋友圈', ico: '<path d="M4 8.5A2.5 2.5 0 0 1 6.5 6h11A2.5 2.5 0 0 1 20 8.5v7A2.5 2.5 0 0 1 17.5 18h-11A2.5 2.5 0 0 1 4 15.5z"/><circle cx="12" cy="12" r="3"/>' },
      { act: 'toast-scan', label: '扫一扫', ico: '<path d="M4 9V6a2 2 0 0 1 2-2h3M15 4h3a2 2 0 0 1 2 2v3M20 15v3a2 2 0 0 1-2 2h-3M9 20H6a2 2 0 0 1-2-2v-3"/><path d="M9 12h6"/>' },
      { act: 'toast-mini', label: '小程序', ico: '<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/>' },
      { act: 'toast-channel', label: '视频号', ico: '<rect x="3.5" y="6" width="17" height="12" rx="2.5"/><path d="m10 9.5 5 2.5-5 2.5z"/>' }
    ];
    byId('panel-discover').innerHTML = items.map(function (it) {
      return '<button class="cell" type="button" data-act="' + it.act + '">' +
        '<span class="cell-ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">' + it.ico + '</svg></span>' +
        '<span class="cell-label">' + it.label + '</span>' +
        '<span class="cell-chev"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 5l7 7-7 7"/></svg></span></button>';
    }).join('');
  }

  function renderMe() {
    var a = acct();
    if (!a) return;
    var cells = [
      { act: 'edit-profile', label: '个人信息', value: '' },
      { act: 'ai-cfg', label: 'AI 接口设置', value: '改地址 / Key' },
      { act: 'clear-chats', label: '清空聊天记录', value: '' },
      { act: 'about', label: '关于本演示', value: '不是真微信' },
      { act: 'logout', label: '退出登录', value: '' }
    ].map(function (c) {
      return '<button class="cell" type="button" data-act="' + c.act + '">' +
        '<span class="cell-label">' + c.label + '</span>' +
        '<span class="cell-value">' + esc(c.value) + '</span>' +
        '<span class="cell-chev"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 5l7 7-7 7"/></svg></span></button>';
    }).join('');
    byId('panel-me').innerHTML =
      '<div class="me-head">' + avatar(a.nick.slice(0, 1), a.color) +
      '<div class="me-info"><p class="me-name">' + esc(a.nick) + '</p><p class="me-id">微信号：' + esc(a.wxid) + '</p></div></div>' +
      '<div class="cells">' + cells + '</div>' +
      '<div style="padding:16px 18px"><button class="btn plain block" type="button" data-act="ai-status">AI 连接与接口设置：' +
      esc(aiStatusText()) + '</button></div>' +
      '<div style="padding:0 18px 24px;font-size:12px;line-height:1.7;color:#98A19A">演示版不连接腾讯服务器，账号、聊天、朋友圈都只存在这台电脑的浏览器里。</div>';
  }

  /* ===== 聊天 ===== */
  function openChat(peer) {
    var info = peerInfo(peer);
    ui.chatPeer = peer;
    byId('chatTitle').textContent = info.name;
    var st = chatStore(db.session, peer);
    st.unread = 0;
    saveDB();
    renderMsgs();
    renderChatHint();
    byId('chatInput').value = '';
    show('chat');
    renderChats();
    setTimeout(scrollMsgs, 40);
  }

  function scrollMsgs() {
    var m = byId('msgs');
    m.scrollTop = m.scrollHeight;
  }

  function renderMsgs() {
    var peer = ui.chatPeer;
    var a = acct();
    if (!peer || !a) return;
    var st = chatStore(db.session, peer);
    var info = peerInfo(peer);
    var html = st.msgs.map(function (m) {
      if (m.sys) return '<div class="msg"><div class="bubble sys">' + esc(m.text) + '</div></div>';
      var av = m.me ? avatar((a.nick || '?').slice(0, 1), a.color, 'sm') : avatar(info.text, info.color, 'sm');
      var cls = m.err ? 'bubble err' : 'bubble';
      return '<div class="msg' + (m.me ? ' me' : '') + '">' + av +
        '<div class="' + cls + '">' + esc(m.text).replace(/\n/g, '<br>') + '</div></div>';
    }).join('');

    if (peer === 'ai' && ui.aiBusy) {
      html += '<div class="msg">' + avatar('AI', '#07C160', 'sm') +
        '<div class="bubble"><span class="typing" aria-label="正在输入"><i></i><i></i><i></i></span></div></div>';
    }
    byId('msgs').innerHTML = html || '<div class="bubble sys">还没有消息</div>';
  }

  function renderChatHint() {
    var box = byId('aiHint');
    if (ui.chatPeer !== 'ai' || ui.ai.status === 'idle' || ui.ai.status === 'ok') {
      box.innerHTML = '';
      return;
    }
    box.innerHTML = '<div class="hint-bar"><span>AI 未连接：' + esc(ui.ai.reason) +
      '。到「我 → AI 接口设置」填转发地址就能连通，当前这句是本地回复。</span><button class="link" type="button" data-act="ai-retry">重试</button></div>';
  }

  function aiStatusText() {
    if (ui.ai.status === 'ok') return '已连接';
    if (ui.ai.status === 'error') return '未连接';
    return '尚未测试';
  }

  function sendMessage(text) {
    var peer = ui.chatPeer;
    if (!peer || !text) return;
    var st = chatStore(db.session, peer);
    st.msgs.push({ id: uid(), me: true, text: text, ts: nowTs() });
    saveDB();
    renderMsgs();
    renderChats();
    scrollMsgs();
    byId('chatInput').value = '';
    if (peer === 'ai') askAI();
    else if (peer === 'wxteam') {
      setTimeout(function () {
        var s2 = chatStore(db.session, 'wxteam');
        s2.msgs.push({ id: uid(), me: false, text: '这是本机的演示通知，没有更多内容。真实微信的公众号消息不会出现在这里。', ts: nowTs() });
        saveDB();
        if (ui.chatPeer === 'wxteam' && ui.view === 'chat') { renderMsgs(); scrollMsgs(); }
        renderChats();
      }, 900);
    }
  }

  /* ===== AI 调用 ===== */
  function aiReasonShort(code) {
    var map = {
      network: '跨域被浏览器拦截或无网络',
      timeout: '请求超时',
      key: 'Key 无效',
      rate: '模型访问量过大或限流',
      server: '服务端错误',
      empty: '模型只输出思考过程',
      bad: '模型名或参数不对',
      http: '接口返回异常',
      unknown: '未知错误'
    };
    if (code && code.indexOf('http:') === 0) return '接口返回 HTTP ' + code.slice(5);
    if (code && code.indexOf('bad:') === 0) return '接口返回 HTTP ' + code.slice(4);
    if (code && code.indexOf('server:') === 0) return '服务端错误（HTTP ' + code.slice(7) + '）';
    if (code && code.indexOf('empty:') === 0) return '接口通了但没返回正文';
    return map[code] || map.unknown;
  }

  /* 把服务端返回的正文压成一句人话，用来判断 404/405 这类问题 */
  function shortBody(t) {
    if (!t) return '';
    var s = '';
    try {
      var j = JSON.parse(t);
      var e = j && j.error;
      if (typeof e === 'string') s = e;
      else if (e && e.message) s = e.message;
      else if (j && j.message) s = j.message;
      else if (e) s = JSON.stringify(e);
    } catch (e2) { s = ''; }
    if (!s) s = String(t).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
    return s.replace(/[\r\n]+/g, ' ').trim().slice(0, 60);
  }


  async function callGLM(messages) {
    var cfg = aiCfg();
    var keys = cfg.keys.length ? cfg.keys : [''];
    var eps = [cfg.url];
    // 地址多写了一段路径（例如 .../api/chat）时，404/405 会退回站点根再试一次
    try {
      var origin = new URL(cfg.url).origin;
      if (origin !== cfg.url.replace(/\/+$/, '')) eps.push(origin);
    } catch (e0) {}
    var lastErr = 'unknown';
    for (var e = 0; e < eps.length; e++) {
      var endpoint = eps[e];
      for (var i = 0; i < keys.length; i++) {
        var ctrl = new AbortController();
        var timer = setTimeout(function () { ctrl.abort(); }, 55000);
        try {
          var res = await fetch(endpoint, {
            method: 'POST',
            headers: keys[i]
              ? { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + keys[i] }
              : { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              model: cfg.model,
              messages: messages,
              temperature: 0.7,
              max_tokens: 1400
            }),
            signal: ctrl.signal
          });
          clearTimeout(timer);
          if (res.ok) {
            var txt = await res.text();
            var j = null;
            try { j = JSON.parse(txt); } catch (e2) { j = null; }
            var c = j && j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
            if (c && c.trim()) return { ok: true, text: c.trim() };
            lastErr = 'empty:' + shortBody(txt);
            continue;
          }
          var note = '';
          try { note = shortBody(await res.text()); } catch (e3) { note = ''; }
          if (res.status === 401 || res.status === 403) { lastErr = 'key'; continue; }
          if (res.status === 429) { lastErr = 'rate'; continue; }
          if (res.status >= 500) { lastErr = 'server:' + res.status + (note ? ' ' + note : ''); continue; }
          if (res.status === 400) { lastErr = 'bad:' + res.status + (note ? ' ' + note : ''); break; }
          lastErr = 'http:' + res.status + (note ? ' ' + note : '');
        } catch (err) {
          clearTimeout(timer);
          lastErr = (err && err.name === 'AbortError') ? 'timeout' : 'network';
          if (lastErr === 'network') break;
        }
      }
      // 只有 404/405 值得换个地址再试；其他结果说明地址是对的
      if (lastErr.indexOf('http:404') !== 0 && lastErr.indexOf('http:405') !== 0) break;
    }
    return { ok: false, reason: lastErr };
  }

  function localReply(text) {
    var t = String(text || '');
    if (/注册|账号|登录|进不去/.test(t)) {
      return '注册很简单：回到登录页切到「注册」，填昵称、账号、密码，点「注册并登录」。账号只存在本机，和真微信没有关系。';
    }
    if (/昵称|名字|起名/.test(t)) {
      return '昵称建议 2–6 个字，好念好记：林小满、阿枝、小满不忙、山前。点登录页的「用 AI 起一个昵称」也能直接填。';
    }
    if (/你是谁|介绍|什么模型/.test(t)) {
      return '我是这个演示页里的 AI 助手，背后接的是智谱 GLM（glm-4.7-flash）。现在没连上服务，先按本地脚本回答。';
    }
    if (/你好|您好|hi|在吗|hello/i.test(t)) {
      return '在。只是暂时没连上 AI 服务，先用离线演示回复陪你聊。';
    }
    if (/朋友圈|动态/.test(t)) {
      return '在「发现 → 朋友圈」里能看到列表，右上角加号可以发布文字动态，每条都能点赞。';
    }
    return '（离线演示）我暂时连不上模型，只能按关键词回你。可以问「怎么注册」「帮我想昵称」，或点黄色提示条上的「重试」再连一次。';
  }

  async function askAI() {
    if (ui.aiBusy) return;
    var st = chatStore(db.session, 'ai');
    ui.aiBusy = true;
    renderMsgs();
    scrollMsgs();

    var history = st.msgs.filter(function (m) { return !m.sys; }).slice(-8).map(function (m) {
      return { role: m.me ? 'user' : 'assistant', content: m.text };
    });
    var messages = [{
      role: 'system',
      content: '你是这个「微信演示版」页面内置的 AI 助手。用简体中文、口语化、简短回答（一般不超过 80 字）。这个页面不是真正的微信，必须提醒用户真实微信账号无法登录、需要注册演示账号。不要编造腾讯或微信官方能力。'
    }].concat(history);

    var r = await callGLM(messages);
    ui.aiBusy = false;
    var viewing = (ui.view === 'chat' && ui.chatPeer === 'ai');

    if (r.ok) {
      ui.ai.status = 'ok';
      ui.ai.reason = '';
      st.msgs.push({ id: uid(), me: false, text: r.text, ts: nowTs() });
    } else {
      ui.ai.status = 'error';
      ui.ai.reason = aiReasonShort(r.reason);
      st.msgs.push({
        id: uid(), me: false, err: true,
        text: 'AI 服务连不上：' + ui.ai.reason + '。下面是本地演示回复。',
        ts: nowTs()
      });
      st.msgs.push({ id: uid(), me: false, text: localReply(history[history.length - 1] && history[history.length - 1].content || ''), ts: nowTs() });
    }
    if (!viewing) st.unread = (st.unread || 0) + 1;
    saveDB();
    if (viewing) {
      renderMsgs();
      renderChatHint();
      scrollMsgs();
    }
    renderChats();
    renderMe();
  }

  /* ===== 用 AI 起昵称 ===== */
  function localNick() {
    var a = ['林小满', '阿枝', '山前', '南风', '小满不忙', '早八人', '拾光', '木鱼'];
    return a[Math.floor(Math.random() * a.length)];
  }

  async function genNickname() {
    var btn = byId('aiNickBtn');
    if (btn.hasAttribute('disabled')) return;
    btn.setAttribute('disabled', 'disabled');
    var old = btn.textContent;
    btn.textContent = '正在问 AI…';

    var r = await callGLM([
      { role: 'system', content: '你是中文起名助手。只输出一个昵称，2 到 6 个汉字，不加引号、不加解释、不加标点。' },
      { role: 'user', content: '给我一个昵称' }
    ]);

    var nick = '';
    if (r.ok) {
      nick = r.text.replace(/["“”'.\s]/g, '').split('\n')[0].slice(0, 8);
      toast('AI 给了一个昵称，已填入');
    } else {
      nick = localNick();
      toast('AI 未连接（' + aiReasonShort(r.reason) + '），先用本地建议');
    }
    if (nick) {
      var el = byId('f-nick');
      if (el) {
        el.value = nick;
        ui.draft['f-nick'] = nick;
        el.focus();
      }
    }
    btn.removeAttribute('disabled');
    btn.textContent = old;
  }

  /* ===== 朋友圈 ===== */
  function openMoments() {
    renderMoments();
    show('moments');
  }

  function renderMoments() {
    var list = momentsOf(db.session).slice().sort(function (a, b) { return b.ts - a.ts; });
    if (!list.length) {
      byId('momentsList').innerHTML =
        '<div class="empty"><p class="empty-t">还没有动态</p><p>右上角的加号可以发布第一条文字动态。</p></div>' +
        '<div style="padding:0 22px"><button class="btn block" type="button" data-act="moments-new">发布第一条动态</button></div>';
      return;
    }
    var a = acct();
    byId('momentsList').innerHTML = list.map(function (p) {
      return '<article class="post">' + avatar(a.nick.slice(0, 1), a.color, 'sm') +
        '<div class="post-body"><p class="post-name">' + esc(a.nick) + '</p>' +
        '<p class="post-text">' + esc(p.text) + '</p>' +
        '<div class="post-foot">' +
        '<button class="like' + (p.liked ? ' on' : '') + '" type="button" data-act="like" data-id="' + p.id + '">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M12 20s-7-4.3-7-9a4 4 0 0 1 7-2.5A4 4 0 0 1 19 11c0 4.7-7 9-7 9z"/></svg>' +
        '<span>' + (p.likes || 0) + '</span></button>' +
        '<span class="post-time">' + esc(fmtTime(p.ts)) + '</span></div></div></article>';
    }).join('');
  }

  function publishMoment() {
    openModal({
      title: '发布动态',
      body: '<textarea class="sheet-in" id="momentText" maxlength="200" placeholder="这一刻的想法…"></textarea>' +
            '<p class="modal-error" id="momentErr"></p>',
      actions: [
        { label: '取消', kind: 'plain' },
        { label: '发布', kind: '', act: function () {
          var el = byId('momentText');
          var text = el ? el.value.trim() : '';
          if (!text) { byId('momentErr').textContent = '写点什么再发布'; return true; }
          momentsOf(db.session).push({ id: uid(), text: text, ts: nowTs(), likes: 0, liked: false });
          saveDB();
          closeModal();
          renderMoments();
          toast('已发布到本机');
          return false;
        } }
      ]
    });
  }

  function toggleLike(id) {
    var list = momentsOf(db.session);
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === id) {
        list[i].liked = !list[i].liked;
        list[i].likes = Math.max(0, (list[i].likes || 0) + (list[i].liked ? 1 : -1));
        break;
      }
    }
    saveDB();
    renderMoments();
  }

  /* ===== 各种弹窗 ===== */
  function showAbout() {
    openModal({
      title: '关于本演示',
      body: '<p style="margin:0">这是一个本地运行的微信界面演示，不是腾讯微信，也不连接任何微信服务。</p>' +
            '<p style="margin:8px 0 0">• 真实微信账号无法登录，请注册演示账号<br>' +
            '• 账号、聊天、朋友圈只存在这台电脑的浏览器里<br>' +
            '• AI 对话走智谱开放平台，需要联网；失败时会给出本地演示回复<br>' +
            '• 演示版不实现支付、视频通话、真实好友关系</p>',
      actions: [{ label: '知道了', kind: 'plain' }]
    });
  }

  function plusSheet() {
    var peers = ['ai', 'wxteam'].concat(contactsOf(db.session).map(function (c) { return c.id; }));
    var body = '<p style="margin:0 0 10px">选一个会话开始聊天：</p>' + peers.map(function (p) {
      var info = peerInfo(p);
      return '<button class="row" style="width:100%;border:1px solid var(--line);border-radius:10px;margin-bottom:8px;padding:8px 10px;background:#fff" type="button" data-act="open-chat" data-peer="' + esc(p) + '">' +
        avatar(info.text, info.color, 'sm') + '<span style="font-size:14.5px">' + esc(info.name) + '</span></button>';
    }).join('');
    openModal({ title: '发起聊天', body: body, actions: [{ label: '关闭', kind: 'plain' }] });
  }

  function addFriend() {
    openModal({
      title: '添加朋友',
      body: '<p style="margin:0 0 10px">演示版没有真实好友关系，这里只是在本机新建一个联系人。</p>' +
            '<input class="sheet-in" id="friendName" style="min-height:0;height:44px" maxlength="12" placeholder="联系人名字，例如：老周">' +
            '<p class="modal-error" id="friendErr"></p>',
      actions: [
        { label: '取消', kind: 'plain' },
        { label: '添加', kind: '', act: function () {
          var el = byId('friendName');
          var name = el ? el.value.trim() : '';
          if (!name) { byId('friendErr').textContent = '名字不能为空'; return true; }
          if (contactsOf(db.session).some(function (c) { return c.name === name; })) {
            byId('friendErr').textContent = '已经有同名联系人了';
            return true;
          }
          contactsOf(db.session).push({
            id: 'c_' + uid(),
            name: name,
            color: colorFor(name),
            sign: '本机演示联系人'
          });
          saveDB();
          closeModal();
          renderContacts();
          renderChats();
          toast('已添加 ' + name);
          return false;
        } }
      ]
    });
  }

  function editProfile() {
    var a = acct();
    if (!a) return;
    openModal({
      title: '个人信息',
      body: '<div class="field"><label for="pfNick">昵称</label><input id="pfNick" maxlength="12" value="' + esc(a.nick) + '"></div>' +
            '<div class="field"><label for="pfSign">个性签名</label><input id="pfSign" maxlength="40" value="' + esc(a.sign) + '"></div>' +
            '<p class="modal-error" id="pfErr"></p>' +
            '<p style="margin:0;font-size:12.5px;color:#98A19A">微信号 ' + esc(a.wxid) + ' 不可修改</p>',
      actions: [
        { label: '取消', kind: 'plain' },
        { label: '保存', kind: '', act: function () {
          var nick = byId('pfNick').value.trim();
          var sign = byId('pfSign').value.trim();
          if (!nick) { byId('pfErr').textContent = '昵称不能为空'; return true; }
          a.nick = nick;
          a.sign = sign;
          saveDB();
          closeModal();
          renderMe();
          renderChats();
          renderContacts();
          toast('已保存');
          return false;
        } }
      ]
    });
  }

  function clearChats() {
    openModal({
      title: '清空聊天记录',
      body: '<p style="margin:0">会删掉这台电脑上当前账号的所有聊天记录，账号本身保留。此操作不能撤销。</p>',
      actions: [
        { label: '取消', kind: 'plain' },
        { label: '清空', kind: 'danger', act: function () {
          db.chats[db.session] = {};
          seedAccount(db.session, (acct() || {}).nick || '');
          chatStore(db.session, 'ai').msgs[0].text = '聊天记录已清空。可以重新问我怎么注册、帮你想昵称。';
          saveDB();
          closeModal();
          renderChats();
          renderContacts();
          toast('聊天记录已清空');
          return false;
        } }
      ]
    });
  }

  function logout() {
    openModal({
      title: '退出登录',
      body: '<p style="margin:0">退出后回到登录页，演示账号和聊天记录仍留在本机。</p>',
      actions: [
        { label: '取消', kind: 'plain' },
        { label: '退出', kind: 'danger', act: function () {
          db.session = null;
          saveDB();
          ui.draft = {};
          ui.chatPeer = null;
          ui.authTab = 'login';
          closeModal();
          show('auth');
          renderAuth();
          toast('已退出登录');
          return false;
        } }
      ]
    });
  }

  /* ===== 事件 ===== */
  function aiSettings() {
    var cfg = aiCfg();
    openModal({
      title: 'AI 接口设置',
      body:
        '<p style="margin:0 0 8px;font-size:12.5px;line-height:1.6">直连会被跨域拦下。把 worker.js 部署后的<b>正式地址</b>（不带随机前缀的 workers.dev）填进「接口地址」。设置只存本机。</p>' +
        '<p style="margin:0 0 10px;font-size:12.5px;line-height:1.6">只上 GitHub Pages、不想部署转发：可以<button class="link" type="button" data-act="ai-preset" style="padding:0 2px">填入公共免费接口</button>，非智谱、免 Key。</p>' +
        '<div class="field" style="margin-bottom:10px"><label for="cfgUrl">接口地址</label><input id="cfgUrl" type="text" spellcheck="false" value="' + esc(cfg.url) + '"></div>' +
        '<div class="field" style="margin-bottom:10px"><label for="cfgModel">模型</label><input id="cfgModel" type="text" spellcheck="false" value="' + esc(cfg.model) + '"></div>' +
        '<div class="field" style="margin-bottom:8px"><label for="cfgKeys">API Key（每行一个，轮换使用）</label>' +
        '<textarea id="cfgKeys" rows="2" spellcheck="false">' + esc(cfg.keys.join('\n')) + '</textarea></div>' +
        '<p id="cfgTest" style="margin:0;font-size:12.5px;line-height:1.6;color:#98A19A">点「测试连接」会真发一次请求。</p>',
      actions: [
        { label: '测试连接', kind: 'plain', act: function () { testAICfg(); return true; } },
        { label: '保存', kind: 'primary', act: function () { saveAICfg(); } }
      ]
    });
  }

  function readCfgForm() {
    var url = byId('cfgUrl'), model = byId('cfgModel'), keys = byId('cfgKeys');
    return {
      url: url ? url.value.trim() : '',
      model: model ? (model.value.trim() || API_CONFIG.MODEL) : API_CONFIG.MODEL,
      keys: keys ? keys.value : ''
    };
  }

  function saveAICfg() {
    var f = readCfgForm();
    try { localStorage.setItem(CFG_KEY, JSON.stringify(f)); } catch (e) {}
    toast('AI 设置已保存');
    if (ui.tab === 'me') renderMe();
  }

  async function pingAI(url, model, key) {
    var ctrl = new AbortController();
    var timer = setTimeout(function () { ctrl.abort(); }, 25000);
    try {
      var res = await fetch(url, {
        method: 'POST',
        headers: key
          ? { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key }
          : { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: model,
          messages: [{ role: 'user', content: '只回复三个字：在的' }],
          temperature: 0.2,
          max_tokens: 600
        }),
        signal: ctrl.signal
      });
      clearTimeout(timer);
      var txt = '';
      try { txt = await res.text(); } catch (e4) { txt = ''; }
      return { status: res.status, ok: res.ok, text: txt };
    } catch (e) {
      clearTimeout(timer);
      return { error: (e && e.name === 'AbortError') ? 'timeout' : 'network' };
    }
  }

  async function testAICfg() {
    var f = readCfgForm();
    var keys = f.keys.split('\n').map(function (s) { return s.trim(); }).filter(Boolean);
    var el = byId('cfgTest');
    if (!el) return;
    var target = f.url || API_CONFIG.API_URL;
    var targets = [target];
    try {
      var o = new URL(target).origin;
      if (o !== target.replace(/\/+$/, '')) targets.push(o);
    } catch (e1) {}
    el.style.color = '#6C7570';
    el.textContent = '正在请求 ' + target + ' …';

    var r = null, used = target;
    for (var i = 0; i < targets.length; i++) {
      used = targets[i];
      r = await pingAI(targets[i], f.model, keys[0] || '');
      if (r.error) break;
      if (r.status !== 404 && r.status !== 405) break;
    }
    var where = '（请求 ' + used + '）';

    if (r.error === 'timeout') { el.style.color = '#C0392B'; el.textContent = '请求超时（25 秒），这个地址没有响应' + where; return; }
    if (r.error === 'network') { el.style.color = '#C0392B'; el.textContent = '连不上：这个地址多半没开跨域（CORS），浏览器把响应拦掉了' + where; return; }

    var txt = r.text || '';
    var j = null;
    try { j = JSON.parse(txt); } catch (e5) { j = null; }
    var note = shortBody(txt);

    if (r.ok) {
      var c = j && j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
      if (c && c.trim()) {
        el.style.color = '#049B4B';
        el.textContent = '连接成功，模型回复：' + c.trim().slice(0, 40) + where;
      } else {
        el.style.color = '#B4791A';
        el.textContent = '接口通了，但没返回正文：' + (note || '返回体里没有 choices[0].message.content') + where;
      }
      return;
    }
    if (r.status === 401 || r.status === 403) { el.style.color = '#C0392B'; el.textContent = 'Key 被拒绝（HTTP ' + r.status + '）' + (note ? '：' + note : '') + where; return; }
    if (r.status === 429) { el.style.color = '#B4791A'; el.textContent = '接口限流（HTTP 429），上游太忙，稍后再试' + where; return; }
    if (r.status === 404) {
      el.style.color = '#C0392B';
      el.textContent = 'HTTP 404：这个地址上没有接口在响应。' + (note ? '对方返回的是「' + note + '」。' : '') +
        '检查 worker 是否真的部署成功（浏览器直接打开这个地址，能看到 JSON 而不是 404 页面）。' + where;
      return;
    }
    if (r.status === 405) { el.style.color = '#C0392B'; el.textContent = 'HTTP 405：地址能通但拒收 POST，这是静态站点地址，不是转发服务' + where; return; }
    el.style.color = '#C0392B';
    el.textContent = '接口返回 HTTP ' + r.status + (note ? '：' + note : '') + where;
  }

  function handleModalAction(i) {
    var m = ui.modal;
    if (!m || !m.actions || !m.actions[i]) { closeModal(); return; }
    var a = m.actions[i];
    if (typeof a.act === 'function') {
      var keep = a.act();
      if (keep === true) return;
    }
    closeModal();
  }

  var ACTIONS = {
    'auth-tab': function (el) { ui.authTab = el.getAttribute('data-tab'); renderAuth(); },
    'ai-nick': function () { genNickname(); },
    'about': function () { showAbout(); },
    'tab': function (el) { setTab(el.getAttribute('data-tab')); },
    'open-chat': function (el) { closeModal(); openChat(el.getAttribute('data-peer')); },
    'chat-back': function () { show('main'); setTab('chats'); renderChats(); },
    'chat-more': function () {
      if (ui.chatPeer === 'ai') {
        openModal({
          title: 'AI 会话设置',
          body: '<p style="margin:0">模型：' + esc(aiCfg().model) + '<br>接口：' + esc(aiCfg().url) + '<br>连接状态：' + esc(aiStatusText()) + '</p>' +
                '<p style="margin:8px 0 0;font-size:12.5px;color:#98A19A">API Key 内置在页面里，任何人拿到这个文件都能看到；可在「我 → AI 接口设置」里换成自己的。</p>',
          actions: [
            { label: '接口设置', kind: 'plain', act: function () { setTimeout(aiSettings, 0); } },
            { label: '好', kind: 'plain' }
          ]
        });
      } else {
        openModal({
          title: '会话设置',
          body: '<p style="margin:0">演示版只支持清空全部聊天记录，没有单会话删除。</p>',
          actions: [
            { label: '关闭', kind: 'plain' },
            { label: '清空全部', kind: 'danger', act: function () { clearChats(); return true; } }
          ]
        });
      }
    },
    'plus': function () { plusSheet(); },
    'contact-add': function () { addFriend(); },
    'moments': function () { openMoments(); },
    'toast-scan': function () { toast('扫一扫是演示入口，没有接摄像头'); },
    'toast-mini': function () { toast('小程序是演示入口，本机没有小程序容器'); },
    'toast-channel': function () { toast('视频号是演示入口，没有接入视频流'); },
    'edit-profile': function () { editProfile(); },
    'clear-chats': function () { clearChats(); },
    'logout': function () { logout(); },
    'ai-status': function () { aiSettings(); },
    'ai-cfg': function () { aiSettings(); },
    'ai-preset': function () {
      var u = byId('cfgUrl'), m = byId('cfgModel'), k = byId('cfgKeys'), t = byId('cfgTest');
      if (u) u.value = 'https://text.pollinations.ai/openai';
      if (m) m.value = 'openai';
      if (k) k.value = '';
      if (t) { t.style.color = '#6C7570'; t.textContent = '已填入公共接口，点「测试连接」看它通不通，通了再保存。'; }
    },
    'ai-retry': function () { if (!ui.aiBusy) askAI(); },
    'modal': function (el) { handleModalAction(parseInt(el.getAttribute('data-i'), 10)); },
    'moments-back': function () { show('main'); setTab('discover'); },
    'moments-new': function () { publishMoment(); },
    'like': function (el) { toggleLike(el.getAttribute('data-id')); }
  };

  document.addEventListener('click', function (e) {
    var el = e.target.closest ? e.target.closest('[data-act]') : null;
    if (!el) return;
    var act = el.getAttribute('data-act');
    if (ACTIONS[act]) {
      e.preventDefault();
      ACTIONS[act](el);
    }
  });

  document.addEventListener('submit', function (e) {
    if (e.target.id === 'authForm') {
      e.preventDefault();
      if (ui.authTab === 'register') doRegister(); else doLogin();
    } else if (e.target.id === 'composer') {
      e.preventDefault();
      var v = byId('chatInput').value.trim();
      if (v) sendMessage(v);
    }
  });

  byId('mask').addEventListener('click', function (e) {
    if (e.target === byId('mask')) closeModal();
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && ui.modal) { closeModal(); return; }
    var t = e.target;
    if ((e.key === 'Enter' || e.key === ' ') && t && t.getAttribute && t.getAttribute('role') === 'button') {
      e.preventDefault();
      t.click();
    }
  });

  /* ===== 启动 ===== */
  bootSplash();
  loadDB();
  byId('entryBtn').addEventListener('click', function () {
    var a = acct();
    if (!a && !db.meta.ack) {
      openModal({
        title: '这不是真正的微信',
        body: '<p style="margin:0">这是本地演示程序，与腾讯微信无关，<b>真实微信账号无法登录</b>。</p>' +
              '<p style="margin:8px 0 0">请注册一个演示账号，数据只保存在这台电脑上。</p>',
        actions: [
          { label: '我知道了', kind: '', act: function () { db.meta.ack = true; saveDB(); closeModal(); enterApp(); } }
        ]
      });
      byId('mask').classList.add('on');
    } else {
      enterApp();
    }
  });
})();
