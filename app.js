(function () {
  'use strict';

  var STORAGE_KEY = 'planning-history-project';
  var app = document.getElementById('app');
  var alertBox = document.getElementById('alert');

  /* ---------- 저장소 ---------- */
  function showAlert(msg) {
    alertBox.textContent = msg;
    alertBox.hidden = !msg;
  }

  // 저장된 프로젝트 읽기. 손상된 데이터는 덮어쓰지 않고 알린다.
  function loadProject() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      var p = JSON.parse(raw);
      if (p && typeof p.teamName === 'string' && typeof p.projectName === 'string' &&
          typeof p.id === 'string' && Array.isArray(p.nodes) && p.nodes.length &&
          typeof p.nodes[0].title === 'string') return p;
      showAlert('저장된 데이터 형식이 올바르지 않아 불러오지 못했습니다. 기존 데이터는 삭제하지 않았습니다.');
      return null;
    } catch (e) {
      showAlert('저장된 데이터를 읽지 못했습니다. 브라우저 저장소 설정을 확인해 주세요.');
      return null;
    }
  }

  function saveProject(p) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(p));
      showAlert('');
      return true;
    } catch (e) {
      showAlert('저장에 실패했습니다. 변경 내용이 새로고침하면 사라질 수 있습니다.');
      return false;
    }
  }

  function newId() {
    var a = new Uint8Array(8);
    crypto.getRandomValues(a);
    return Array.prototype.map.call(a, function (b) {
      return ('0' + b.toString(16)).slice(-2);
    }).join('');
  }

  /* ---------- DOM 헬퍼 ---------- */
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

  function clear() { app.textContent = ''; }

  /*
   * 제자리 수정 위젯: 텍스트 + [수정] 버튼. 누르면 입력칸으로 바뀌고 저장/취소한다.
   * opts: tag, cls, label(접근성 이름), max, get(), set(v), formCls
   * 저장 실패 시 이전 값으로 되돌린다.
   */
  function editable(opts) {
    var wrap = el('div', { class: opts.wrapCls || 'project-line' });

    function view() {
      wrap.textContent = '';
      var text = el(opts.tag, { class: opts.cls || '', text: opts.get() });
      var btn = el('button', { type: 'button', class: 'btn', text: '수정', 'aria-label': opts.label + ' 수정' });
      btn.addEventListener('click', edit);
      wrap.appendChild(text);
      wrap.appendChild(btn);
      return btn;
    }

    function edit() {
      wrap.textContent = '';
      var input = el('input', { type: 'text', maxlength: String(opts.max), 'aria-label': opts.label });
      input.value = opts.get();
      var err = el('p', { class: 'field-error edit-err', role: 'alert' });
      var save = el('button', { type: 'submit', class: 'btn primary', text: '저장' });
      var cancel = el('button', { type: 'button', class: 'btn', text: '취소' });
      var form = el('form', { class: 'edit-form ' + (opts.formCls || ''), novalidate: 'novalidate' }, [input, save, cancel]);
      form.appendChild(err);
      wrap.appendChild(form);
      input.focus();
      input.select();
      cancel.addEventListener('click', function () { view().focus(); });
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        var v = input.value.trim();
        if (!v) { err.textContent = '비워 둘 수 없습니다. 내용을 입력해 주세요.'; input.focus(); return; }
        var prev = opts.get();
        opts.set(v);
        if (!saveProject(opts.project)) opts.set(prev);
        view().focus();
      });
    }

    view();
    return wrap;
  }

  /* ---------- 시작 화면 ---------- */
  function renderStart() {
    clear();
    var team = el('input', { type: 'text', id: 'team', maxlength: '60', autocomplete: 'off' });
    var proj = el('input', { type: 'text', id: 'proj', maxlength: '80', autocomplete: 'off' });
    var node = el('input', { type: 'text', id: 'node', maxlength: '80', autocomplete: 'off' });
    var err = el('p', { class: 'field-error', role: 'alert' });
    var play = el('button', { type: 'submit', class: 'play', 'aria-label': '시작하기: 메인 화면으로 이동', text: '▶' });

    var form = el('form', { class: 'fields', novalidate: 'novalidate' }, [
      el('label', { for: 'team', text: '팀 이름' }), team,
      el('label', { for: 'proj', text: '팀프로젝트 이름' }), proj,
      el('p', { class: 'hint', text: '가명이나 임시 이름이어도 됩니다. 나중에 바꿀 수 있어요.' }),
      el('label', { for: 'node', text: '첫 번째 기획(노드) 이름' }), node,
      el('p', { class: 'hint', text: '기획 가지의 출발점이 됩니다. 나중에 바꿀 수 있어요.' }),
      err,
      el('div', { class: 'play-row' }, [play, el('span', { class: 'play-label', text: '눌러서 시작하기' })])
    ]);

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var t = team.value.trim();
      var n = proj.value.trim();
      var f = node.value.trim();
      var fields = [[t, team], [n, proj], [f, node]];
      for (var i = 0; i < fields.length; i++) {
        if (!fields[i][0]) {
          err.textContent = '팀 이름, 프로젝트 이름, 첫 번째 기획 이름을 모두 입력해 주세요.';
          fields[i][1].focus();
          return;
        }
      }
      var p = {
        id: newId(),
        teamName: t,
        projectName: n,
        createdAt: new Date().toISOString(),
        // 가지(노드) 데이터는 다음 단계에서 확장한다. 지금은 첫 노드 1개.
        nodes: [{ id: newId(), title: f, parentId: null }]
      };
      if (saveProject(p)) location.hash = '#/main';
    });

    app.appendChild(el('header', { class: 'hero' }, [
      el('h1', { text: '우리 기획의 변화를 기록합니다' }),
      el('p', { class: 'lead', text: '팀프로젝트의 기획 방향이 어떻게 바뀌고 갈라졌는지, 한눈에 볼 수 있게 남겨 두세요.' }),
      form,
      el('div', { class: 'down', 'aria-hidden': 'true', text: '↓ 정보를 입력하고 ▶를 눌러 보세요' })
    ]));
    team.focus();
  }

  /* ---------- 메인 화면 ---------- */
  function shareUrl(p) {
    // 자리 표시용 주소. 데이터가 담기지 않으므로 다른 기기에서는 내용이 열리지 않는다.
    return location.origin + location.pathname + '#/share/' + p.id;
  }

  function renderMain(p) {
    clear();

    // 1순위: 팀 이름 · 프로젝트 이름
    var teamEdit = editable({
      project: p, tag: 'span', cls: 'name', label: '팀 이름', max: 60, wrapCls: 'team-line',
      get: function () { return p.teamName; },
      set: function (v) { p.teamName = v; }
    });
    var projEdit = editable({
      project: p, tag: 'h1', label: '프로젝트 이름', max: 80, formCls: 'big',
      get: function () { return p.projectName; },
      set: function (v) { p.projectName = v; }
    });
    var top = el('header', { class: 'main-hero' }, [
      el('p', { class: 'section-label', text: '팀 · 프로젝트' }),
      teamEdit,
      projEdit
    ]);

    // 2순위: 첫 번째 노드
    var first = p.nodes[0];
    var nodeEdit = editable({
      project: p, tag: 'h2', label: '첫 번째 기획 이름', max: 80, formCls: 'big', wrapCls: 'node-title-line',
      get: function () { return first.title; },
      set: function (v) { first.title = v; }
    });
    var nodeSec = el('section', { class: 'node-section', 'aria-label': '첫 번째 기획' }, [
      el('p', { class: 'section-label', text: '기획 방향' }),
      el('div', { class: 'node-card' }, [
        el('div', { class: 'node-meta' }, [el('span', { text: '01' }), el('span', { class: 'chip', text: '시작점' })]),
        nodeEdit,
        el('p', { class: 'note', text: '기획이 이어지고 갈라지는 흐름이 이 아래로 쌓입니다. 노드 추가는 다음 단계에서 만듭니다.' })
      ])
    ]);

    // 3순위: share 공유링크 (자리 표시, 작게)
    var linkInput = el('input', { type: 'text', readonly: 'readonly', id: 'share', 'aria-label': 'share 공유링크' });
    linkInput.value = shareUrl(p);
    var copyBtn = el('button', { type: 'button', class: 'btn', text: '복사' });
    var copyMsg = el('p', { class: 'copy-msg', role: 'status' });
    copyBtn.addEventListener('click', function () {
      linkInput.select();
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      copyMsg.textContent = ok ? '복사했습니다.' : '복사하지 못했습니다. 주소를 직접 선택해 복사해 주세요.';
    });
    var shareSec = el('section', { class: 'share-section', 'aria-label': 'share 공유링크' }, [
      el('p', { class: 'share-title', text: 'share 공유링크 · 팀원 편집용' }),
      el('div', { class: 'link-row' }, [linkInput, copyBtn]),
      copyMsg,
      el('p', { class: 'notice', text: '준비 중: 지금은 링크 표시와 복사만 가능합니다. 이 주소에는 프로젝트 내용이 담겨 있지 않아 다른 기기에서는 열리지 않으며, 최신 내용 갱신 기능도 아직 없습니다.' })
    ]);

    app.appendChild(top);
    app.appendChild(nodeSec);
    app.appendChild(shareSec);
    app.appendChild(el('p', { class: 'footnote', text: '이 기록은 이 브라우저에 저장됩니다. 브라우저 데이터를 삭제하면 사라질 수 있습니다.' }));
  }

  /* ---------- share 링크로 들어온 경우 (자리 표시) ---------- */
  function renderSharePlaceholder() {
    clear();
    var p = loadProject();
    var back = el('button', { type: 'button', class: 'btn primary', text: p ? '내 프로젝트 열기' : '시작 화면으로' });
    back.addEventListener('click', function () { location.hash = p ? '#/main' : '#/start'; });
    app.appendChild(el('div', { class: 'hero' }, [
      el('div', { class: 'card-plain' }, [
        el('h2', { text: 'share 공유링크 준비 중' }),
        el('p', { text: '이 링크로 다른 사람의 프로젝트를 여는 기능은 아직 만들지 않았습니다.' }),
        back
      ])
    ]));
  }

  /* ---------- 라우터 ---------- */
  function route() {
    var h = location.hash || '';
    if (h.indexOf('#/share/') === 0) return renderSharePlaceholder();
    var p = loadProject();
    if (p) {
      if (h !== '#/main') { location.hash = '#/main'; return; }
      return renderMain(p);
    }
    if (h !== '#/start') { location.hash = '#/start'; return; }
    renderStart();
  }

  window.addEventListener('hashchange', route);
  route();
})();
