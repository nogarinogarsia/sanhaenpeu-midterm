(function () {
  'use strict';

  var LEGACY_KEY = 'planning-history-project'; // 이전 버전(localStorage) 데이터
  var DB_NAME = 'planning-history';
  var STORE = 'kv';
  var KEY = 'project';
  var DEF = { team: '팀이름', proj: '프로젝트명', node: '시작노드' };
  var STATUS = { idea: '아이디어', active: '진행중', adopted: '채택', dropped: '폐기' };

  var app = document.getElementById('app');
  var alertBox = document.getElementById('alert');
  var current = null;   // 지금 열려 있는 프로젝트
  var corrupt = false;  // 저장된 데이터를 읽었지만 형식이 올바르지 않았는지

  /* ---------- 공용 헬퍼 ---------- */
  function showAlert(msg) {
    alertBox.textContent = msg;
    alertBox.hidden = !msg;
  }

  function el(tag, attrs, children) {
    var n = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === 'text') n.textContent = attrs[k];
      else if (k === 'class') n.className = attrs[k];
      else n.setAttribute(k, attrs[k]);
    });
    (children || []).forEach(function (c) { n.appendChild(c); });
    return n;
  }

  function newId() {
    var a = new Uint8Array(8);
    crypto.getRandomValues(a);
    return Array.prototype.map.call(a, function (b) {
      return ('0' + b.toString(16)).slice(-2);
    }).join('');
  }

  function today() {
    var d = new Date();
    return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
  }

  function withTimeout(promise, ms) {
    return new Promise(function (resolve, reject) {
      var t = setTimeout(function () { reject(new Error('timeout')); }, ms);
      promise.then(function (v) { clearTimeout(t); resolve(v); },
                   function (e) { clearTimeout(t); reject(e); });
    });
  }

  function clear() {
    if (window.Branch) window.Branch.unmount();
    if (window.Export) window.Export.unmount();
    document.title = '기획 변화 기록';
    document.body.classList.remove('is-main');
    app.textContent = '';
  }

  /* ---------- 저장소 (IndexedDB, 실패 시 localStorage) ---------- */
  var dbp = null;
  function openDb() {
    if (!dbp) {
      dbp = new Promise(function (resolve, reject) {
        try {
          var r = indexedDB.open(DB_NAME, 1);
          r.onupgradeneeded = function () { r.result.createObjectStore(STORE); };
          r.onsuccess = function () { resolve(r.result); };
          r.onerror = function () { reject(r.error); };
        } catch (e) { reject(e); }
      });
    }
    return dbp;
  }

  function idbGet() {
    return openDb().then(function (d) {
      return new Promise(function (resolve, reject) {
        var q = d.transaction(STORE).objectStore(STORE).get(KEY);
        q.onsuccess = function () { resolve(q.result); };
        q.onerror = function () { reject(q.error); };
      });
    });
  }

  function idbPut(value) {
    return openDb().then(function (d) {
      return new Promise(function (resolve, reject) {
        var t = d.transaction(STORE, 'readwrite');
        t.objectStore(STORE).put(value, KEY);
        t.oncomplete = function () { resolve(); };
        t.onerror = function () { reject(t.error); };
        t.onabort = function () { reject(t.error); };
      });
    });
  }

  // 저장된 값을 검증·보정한다. 형식이 올바르지 않으면 null.
  function normalize(p) {
    if (!p || typeof p !== 'object' || typeof p.id !== 'string' ||
        typeof p.teamName !== 'string' || typeof p.projectName !== 'string' ||
        !Array.isArray(p.nodes) || !p.nodes.length) return null;
    var created = typeof p.createdAt === 'string' && p.createdAt ? p.createdAt.slice(0, 10) : today();
    var ids = {};
    var nodes = [];
    for (var i = 0; i < p.nodes.length; i++) {
      var n = p.nodes[i];
      if (!n || typeof n.id !== 'string' || typeof n.title !== 'string') return null;
      ids[n.id] = true;
      nodes.push({
        id: n.id,
        parentId: typeof n.parentId === 'string' ? n.parentId : null,
        title: n.title,
        date: typeof n.date === 'string' && n.date ? n.date : created,
        status: STATUS[n.status] ? n.status : 'idea',
        text: typeof n.text === 'string' ? n.text : '',
        images: Array.isArray(n.images) ? n.images.filter(function (s) { return typeof s === 'string'; }) : [],
        createdAt: typeof n.createdAt === 'number' ? n.createdAt : i
      });
    }
    var hasRoot = false;
    for (var j = 0; j < nodes.length; j++) {
      if (nodes[j].parentId === null) hasRoot = true;
      else if (!ids[nodes[j].parentId]) return null;
    }
    if (!hasRoot) return null;
    // 내부용 내용은 노드와 분리해서 보관한다.
    var internal = {};
    if (p.internal && typeof p.internal === 'object') {
      Object.keys(p.internal).forEach(function (k) {
        var v = p.internal[k];
        if (ids[k] && v && typeof v.discuss === 'string') internal[k] = { discuss: v.discuss };
      });
    }
    return { id: p.id, teamName: p.teamName, projectName: p.projectName, createdAt: p.createdAt || new Date().toISOString(), nodes: nodes, internal: internal };
  }

  function loadProject() {
    return withTimeout(idbGet(), 3000).then(function (v) { return v; }, function () { return undefined; })
      .then(function (raw) {
        if (raw === undefined) {
          try {
            var s = localStorage.getItem(LEGACY_KEY);
            raw = s ? JSON.parse(s) : null;
          } catch (e) {
            corrupt = true;
            showAlert('저장된 데이터를 읽지 못했습니다. 기존 데이터는 삭제하지 않았습니다.');
            return null;
          }
        }
        if (raw == null) return null;
        var p = normalize(raw);
        if (!p) {
          corrupt = true;
          showAlert('저장된 데이터 형식이 올바르지 않아 불러오지 못했습니다. 기존 데이터는 삭제하지 않았습니다.');
          return null;
        }
        return p;
      });
  }

  var saveTimer = null;
  var saveChain = Promise.resolve(true);

  function doSave(p) {
    return idbPut(p).then(function () {
      showAlert('');
      return true;
    }, function () {
      try {
        localStorage.setItem(LEGACY_KEY, JSON.stringify(p));
        showAlert('');
        return true;
      } catch (e) {
        showAlert('저장에 실패했습니다. 변경 내용이 새로고침하면 사라질 수 있습니다. (이미지가 너무 크거나 브라우저 저장 공간이 부족할 수 있어요)');
        return false;
      }
    });
  }

  // 즉시 저장 (Promise<boolean>)
  function saveNow() {
    clearTimeout(saveTimer);
    saveTimer = null;
    var p = current;
    if (!p) return Promise.resolve(false);
    saveChain = saveChain.then(function () { return doSave(p); });
    return saveChain;
  }

  // 입력 중에는 잠깐 모아서 저장
  function persist() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, 300);
  }

  window.addEventListener('pagehide', function () { if (saveTimer) saveNow(); });

  /*
   * 글자를 눌러(또는 Tab 후 Enter) 바로 수정하는 위젯. 수정 버튼은 없다.
   * Enter·바깥 클릭 = 저장, Esc = 취소. 비우면 기본 이름(def)이 다시 적힌다.
   * opts: tag, cls, label(접근성 이름), max, def, get(), set(v)
   */
  function editable(opts) {
    var wrap = el(opts.tag, { class: opts.cls || '' });

    function view() {
      wrap.textContent = '';
      var t = el('span', {
        class: 'editable', tabindex: '0', role: 'button',
        title: '클릭해서 수정',
        'aria-label': opts.label + ': ' + opts.get() + ' (눌러서 수정)',
        text: opts.get()
      });
      t.addEventListener('click', edit);
      t.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); edit(); }
      });
      wrap.appendChild(t);
      return t;
    }

    function edit() {
      wrap.textContent = '';
      var input = el('input', { type: 'text', class: 'inline-input', maxlength: String(opts.max), 'aria-label': opts.label });
      input.value = opts.get();
      wrap.appendChild(input);
      input.focus();
      input.select();
      var done = false;
      function finish(save) {
        if (done) return;
        done = true;
        if (save) {
          opts.set(input.value.trim() || opts.def);
          persist();
        }
        view().focus();
      }
      input.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); finish(true); }
        else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(false); }
      });
      input.addEventListener('blur', function () { finish(true); });
    }

    view();
    return wrap;
  }

  window.App = {
    el: el, editable: editable, persist: persist, saveNow: saveNow, showAlert: showAlert,
    newId: newId, today: today, DEF: DEF, STATUS: STATUS
  };

  /* ---------- 시작 화면 ---------- */
  function renderStart() {
    clear();
    app.className = 'page';
    var team = el('input', { type: 'text', id: 'team', maxlength: '60', autocomplete: 'off', placeholder: DEF.team });
    var proj = el('input', { type: 'text', id: 'proj', maxlength: '80', autocomplete: 'off', placeholder: DEF.proj });
    var node = el('input', { type: 'text', id: 'node', maxlength: '80', autocomplete: 'off', placeholder: DEF.node });
    var play = el('button', { type: 'submit', class: 'play', 'aria-label': '시작하기: 메인 화면으로 이동', title: '시작하기', text: '▶' });

    var form = el('form', { class: 'fields', novalidate: 'novalidate' }, [
      el('label', { for: 'team', text: '팀 이름' }), team,
      el('label', { for: 'proj', text: '팀프로젝트 이름' }), proj,
      el('p', { class: 'hint', text: '가명이나 임시 이름이어도 됩니다. 비워 두면 기본 이름이 들어가고, 나중에 바꿀 수 있어요.' }),
      el('label', { for: 'node', text: '시작 노드 이름' }),
      el('div', { class: 'node-row' }, [node, play]),
      el('p', { class: 'hint', text: '기획 가지의 출발점입니다. 입력하고 오른쪽 ▶를 누르면 메인 화면으로 이동합니다.' })
    ]);

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      if (corrupt && !window.confirm('저장된 기존 데이터를 읽지 못한 상태입니다. 새로 시작하면 기존 데이터를 덮어씁니다. 계속할까요?')) return;
      play.disabled = true;
      var d = today();
      current = {
        id: newId(),
        teamName: team.value.trim() || DEF.team,
        projectName: proj.value.trim() || DEF.proj,
        createdAt: new Date().toISOString(),
        nodes: [{
          id: newId(), parentId: null, title: node.value.trim() || DEF.node,
          date: d, status: 'idea', text: '', images: [], createdAt: Date.now()
        }],
        internal: {}
      };
      saveNow().then(function (ok) {
        play.disabled = false;
        if (ok) { corrupt = false; location.hash = '#/main'; }
      });
    });

    app.appendChild(el('header', { class: 'hero' }, [
      el('h1', { text: '우리 기획의 변화를 기록합니다' }),
      el('p', { class: 'lead', text: '팀프로젝트의 기획 방향이 어떻게 바뀌고 갈라졌는지, 한눈에 볼 수 있게 남겨 두세요.' }),
      form,
      el('div', { class: 'down', 'aria-hidden': 'true', text: '↓ 정보를 입력하고 ▶를 눌러 보세요' })
    ]));
    team.focus();
  }

  /* ---------- 메인 화면 (가지도) ---------- */
  function renderMain(p) {
    clear();
    app.className = 'main-root';
    window.Branch.mount(app, p, window.App);
  }

  /* ---------- share 링크로 들어온 경우 (자리 표시) ---------- */
  function renderSharePlaceholder() {
    clear();
    app.className = 'page';
    var back = el('button', { type: 'button', class: 'btn primary', text: current ? '내 프로젝트 열기' : '시작 화면으로' });
    back.addEventListener('click', function () { location.hash = current ? '#/main' : '#/start'; });
    app.appendChild(el('div', { class: 'hero' }, [
      el('div', { class: 'card-plain' }, [
        el('h2', { text: 'share 공유링크 준비 중' }),
        el('p', { text: '이 링크로 다른 사람의 프로젝트를 여는 기능은 아직 만들지 않았습니다.' }),
        back
      ])
    ]));
  }

  /* ---------- export 결과물 화면 (링크 안의 데이터로만 그린다) ---------- */
  function renderExport(payload) {
    clear();
    app.className = 'export-root';
    window.Export.show(app, payload);
  }

  /* ---------- 라우터 ---------- */
  function route() {
    var h = location.hash || '';
    if (h.indexOf('#/export/') === 0) return renderExport(h.slice('#/export/'.length));
    if (h.indexOf('#/share/') === 0) return renderSharePlaceholder();
    if (current) {
      if (h !== '#/main') { location.hash = '#/main'; return; }
      return renderMain(current);
    }
    if (h !== '#/start') { location.hash = '#/start'; return; }
    renderStart();
  }

  loadProject().then(function (p) {
    current = p;
    window.addEventListener('hashchange', route);
    route();
  });
})();
