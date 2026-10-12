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
          typeof p.id === 'string' && Array.isArray(p.nodes)) return p;
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

  /* ---------- 시작 화면 ---------- */
  function renderStart() {
    clear();
    var team = el('input', { type: 'text', id: 'team', maxlength: '60', autocomplete: 'off' });
    var proj = el('input', { type: 'text', id: 'proj', maxlength: '80', autocomplete: 'off' });
    var err = el('p', { class: 'field-error', role: 'alert' });
    var form = el('form', { novalidate: 'novalidate' }, [
      el('label', { for: 'team', text: '팀 이름' }), team,
      el('label', { for: 'proj', text: '팀프로젝트 이름' }), proj,
      el('p', { class: 'muted', text: '프로젝트 이름은 가명이나 임시 이름이어도 되고, 나중에 바꿀 수 있습니다.' }),
      err,
      el('button', { type: 'submit', class: 'primary', text: '시작하기' })
    ]);
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var t = team.value.trim();
      var n = proj.value.trim();
      if (!t || !n) {
        err.textContent = '팀 이름과 프로젝트 이름을 모두 입력해 주세요.';
        (t ? proj : team).focus();
        return;
      }
      var p = {
        id: newId(),
        teamName: t,
        projectName: n,
        createdAt: new Date().toISOString(),
        // 가지(노드) 데이터는 다음 단계에서 확장한다. 지금은 시작 노드 1개.
        nodes: [{ id: newId(), title: '시작', parentId: null }]
      };
      if (saveProject(p)) location.hash = '#/main';
    });
    app.appendChild(el('section', { class: 'card' }, [
      el('h1', { text: '팀프로젝트 기획 기록' }),
      el('p', { class: 'muted', text: '기획 방향이 어떻게 바뀌고 갈라졌는지 기록합니다.' }),
      form
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

    // 헤더: 팀 이름 + 프로젝트 이름(수정 가능)
    var titleH1 = el('h1', { text: p.projectName });
    var editBtn = el('button', { type: 'button', text: '이름 변경' });
    var titleRow = el('div', { class: 'title-row' }, [titleH1, editBtn]);
    var header = el('section', { class: 'card' }, [
      el('p', { class: 'muted', text: '팀: ' + p.teamName }),
      titleRow
    ]);

    editBtn.addEventListener('click', function () {
      var input = el('input', { type: 'text', maxlength: '80', 'aria-label': '새 프로젝트 이름' });
      input.value = p.projectName;
      var err = el('p', { class: 'field-error', role: 'alert' });
      var save = el('button', { type: 'submit', class: 'primary', text: '저장' });
      var cancel = el('button', { type: 'button', text: '취소' });
      var form = el('form', { class: 'title-edit', novalidate: 'novalidate' }, [input, save, cancel]);
      titleRow.replaceWith(form);
      header.appendChild(err);
      input.focus();
      cancel.addEventListener('click', function () { renderMain(p); });
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        var v = input.value.trim();
        if (!v) { err.textContent = '프로젝트 이름을 입력해 주세요.'; return; }
        var prev = p.projectName;
        p.projectName = v;
        if (!saveProject(p)) p.projectName = prev;
        renderMain(p);
      });
    });

    // share 공유링크 (자리 표시)
    var linkInput = el('input', { type: 'text', readonly: 'readonly', id: 'share', 'aria-label': 'share 공유링크' });
    linkInput.value = shareUrl(p);
    var copyBtn = el('button', { type: 'button', text: '복사' });
    var copyMsg = el('p', { class: 'muted', role: 'status' });
    copyBtn.addEventListener('click', function () {
      linkInput.select();
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      copyMsg.textContent = ok ? '복사했습니다.' : '복사하지 못했습니다. 주소를 직접 선택해 복사해 주세요.';
    });
    var share = el('section', { class: 'card' }, [
      el('h2', { text: 'share 공유링크' }),
      el('p', { class: 'muted', text: '팀원에게 편집 권한을 주는 링크입니다.' }),
      el('div', { class: 'link-row' }, [linkInput, copyBtn]),
      copyMsg,
      el('p', { class: 'notice', text: '준비 중: 지금은 링크 표시와 복사만 가능합니다. 이 주소에는 프로젝트 내용이 담겨 있지 않아 다른 기기에서는 내용이 열리지 않으며, 최신 내용 갱신 기능도 아직 없습니다.' })
    ]);

    // 가지 영역
    var list = el('ol', { class: 'branch', 'aria-label': '기획 가지' });
    p.nodes.forEach(function (n) {
      list.appendChild(el('li', {}, [
        el('div', { class: 'node' }, [
          el('span', { class: 'tag', text: '현재' }),
          el('span', { text: n.title })
        ])
      ]));
    });
    var branch = el('section', { class: 'card' }, [
      el('h2', { text: '기획 방향' }),
      el('p', { class: 'muted', text: '기획이 이어지고 갈라지는 흐름이 여기에 표시됩니다. 노드 추가는 다음 단계에서 만듭니다.' }),
      list
    ]);

    app.appendChild(header);
    app.appendChild(share);
    app.appendChild(branch);
    app.appendChild(el('p', { class: 'muted', text: '이 기록은 이 브라우저에 저장됩니다. 브라우저 데이터를 삭제하면 사라질 수 있습니다.' }));
  }

  /* ---------- share 링크로 들어온 경우 (자리 표시) ---------- */
  function renderSharePlaceholder() {
    clear();
    var p = loadProject();
    var actions = [];
    var back = el('button', { type: 'button', class: 'primary', text: p ? '내 프로젝트 열기' : '시작 화면으로' });
    back.addEventListener('click', function () { location.hash = p ? '#/main' : '#/start'; });
    actions.push(back);
    app.appendChild(el('section', { class: 'card' }, [
      el('h1', { text: 'share 공유링크 준비 중' }),
      el('p', { text: '이 링크로 다른 사람의 프로젝트를 여는 기능은 아직 만들지 않았습니다.' })
    ].concat(actions)));
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
