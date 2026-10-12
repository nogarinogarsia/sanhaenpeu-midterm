/*
 * 메인 화면: 기획 가지도.
 * 가로 캔버스(드래그 이동·휠 확대/축소) + 노드를 누르면 열리는 오른쪽 패널.
 * 패널 위쪽 = 흰색 창(외부 공유용, export에 포함될 내용), 아래쪽 = 회색 창(내부용).
 * 내부용 내용은 p.internal[노드id] 에 노드와 분리해서 저장한다.
 */
(function () {
  'use strict';

  var W = 210, H = 108, COLW = 290, ROWH = 170, PAD = 90, PANEL_W = 380, LANES = 8;
  var S = { active: false, p: null, A: null, selId: null, pos: {}, view: { x: 0, y: 0, s: 1 }, r: {} };
  var NS = 'http://www.w3.org/2000/svg';

  function el() { return S.A.el.apply(null, arguments); }
  function cur() {
    for (var i = 0; i < S.p.nodes.length; i++) if (S.p.nodes[i].id === S.selId) return S.p.nodes[i];
    return null;
  }
  function isRoot(n) { return n.parentId === null; }
  function wide() { return window.innerWidth > 720; }

  /* ---------- 배치 ---------- */
  function layout() {
    var nodes = S.p.nodes, by = {}, kids = {}, roots = [];
    nodes.forEach(function (n) { by[n.id] = n; kids[n.id] = []; });
    var cmp = function (a, b) { return (a.date || '').localeCompare(b.date || '') || a.createdAt - b.createdAt; };
    nodes.forEach(function (n) {
      if (n.parentId && by[n.parentId]) kids[n.parentId].push(n); else roots.push(n);
    });
    roots.sort(cmp);
    Object.keys(kids).forEach(function (k) { kids[k].sort(cmp); });

    var dates = {};
    nodes.forEach(function (n) { dates[n.date || ''] = true; });
    var rank = {};
    Object.keys(dates).sort().forEach(function (d, i) { rank[d] = i; });

    var colMemo = {};
    function col(n) {
      if (n.id in colMemo) return colMemo[n.id];
      var p = n.parentId && by[n.parentId];
      return (colMemo[n.id] = Math.max(rank[n.date || ''], p ? col(p) + 1 : 0));
    }

    var pos = {}, maxLane = -1;
    function dfs(n, lane, depth, newBranch) {
      pos[n.id] = { x: PAD + col(n) * COLW, y: PAD + lane * ROWH, lane: lane, depth: depth, c: lane % LANES, newBranch: newBranch };
      kids[n.id].forEach(function (c, i) {
        if (i === 0) dfs(c, lane, depth + 1, false);
        else dfs(c, ++maxLane, depth + 1, true);
      });
    }
    roots.forEach(function (r) { dfs(r, ++maxLane, 0, false); });
    S.pos = pos;
    return { by: by };
  }

  /* ---------- 캔버스 그리기 ---------- */
  function render() {
    var by = layout().by, pos = S.pos, world = S.r.world;
    world.textContent = '';

    var svg = document.createElementNS(NS, 'svg');
    var mx = 0, my = 0;
    Object.keys(pos).forEach(function (k) {
      mx = Math.max(mx, pos[k].x + W + PAD);
      my = Math.max(my, pos[k].y + H + PAD);
    });
    svg.setAttribute('width', mx);
    svg.setAttribute('height', my);
    S.p.nodes.forEach(function (n) {
      var par = by[n.parentId];
      if (!par) return;
      var a = pos[par.id], b = pos[n.id];
      var x1 = a.x + W, y1 = a.y + H / 2, x2 = b.x, y2 = b.y + H / 2, dx = Math.max(40, (x2 - x1) / 2);
      var path = document.createElementNS(NS, 'path');
      path.setAttribute('d', 'M' + x1 + ',' + y1 + ' C' + (x1 + dx) + ',' + y1 + ' ' + (x2 - dx) + ',' + y2 + ' ' + x2 + ',' + y2);
      path.setAttribute('fill', 'none');
      path.setAttribute('stroke-linecap', 'round');
      path.setAttribute('stroke-width', Math.max(3, 10 - b.depth * 1.4));
      path.setAttribute('style', 'stroke:var(--lane' + b.c + ')');
      if (n.status === 'dropped') path.setAttribute('stroke-dasharray', '2 9');
      path.setAttribute('opacity', n.status === 'dropped' ? 0.6 : 0.85);
      svg.appendChild(path);
    });
    world.appendChild(svg);

    S.p.nodes.forEach(function (n) {
      var p = pos[n.id];
      var t = n.title || '(제목 없음)';
      var card = el('div', {
        class: 'node' + (n.status === 'dropped' ? ' dropped' : '') + (n.status === 'adopted' ? ' adopted' : '') + (n.id === S.selId ? ' sel' : ''),
        'data-id': n.id,
        role: 'button', tabindex: '0',
        'aria-label': t + ', ' + S.A.STATUS[n.status] + (isRoot(n) ? ', 시작 노드' : '') + ', 눌러서 편집'
      });
      card.style.cssText = 'left:' + p.x + 'px;top:' + p.y + 'px;--c:var(--lane' + p.c + ')';

      var meta = el('div', { class: 'nm' }, [
        el('span', { class: 'chip s-' + n.status, text: S.A.STATUS[n.status] }),
        el('span', { text: n.date || '' })
      ]);
      if (isRoot(n)) meta.appendChild(el('span', { class: 'tag', text: '시작' }));
      else if (p.newBranch) meta.appendChild(el('span', { class: 'tag', text: '새 가지' }));
      card.appendChild(el('div', { class: 'body' }, [el('div', { class: 'nt', text: t }), meta]));

      if (n.images.length) {
        card.appendChild(el('img', { class: 'thumb', src: n.images[0], alt: '' }));
        if (n.images.length > 1) card.appendChild(el('span', { class: 'imgn', text: '이미지 ' + n.images.length }));
      }
      var add = el('button', { class: 'addb', type: 'button', title: '여기서 가지 치기', 'aria-label': t + '에서 가지 치기', text: '+' });
      add.addEventListener('click', function (e) { e.stopPropagation(); addChild(n.id); });
      add.addEventListener('pointerdown', function (e) { e.stopPropagation(); });
      card.appendChild(add);

      card.addEventListener('click', function (e) {
        if (isAdoptGesture(e, n, card)) return;
        select(n.id);
      });
      card.addEventListener('keydown', function (e) {
        if (e.target === card && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); select(n.id); }
      });
      card.addEventListener('pointerdown', function (e) { e.stopPropagation(); });
      world.appendChild(card);
    });
  }

  /* ---------- 이동·확대 ---------- */
  function applyView() {
    var v = S.view;
    S.r.world.style.transform = 'translate(' + v.x + 'px,' + v.y + 'px) scale(' + v.s + ')';
  }

  function fit() {
    var ps = Object.keys(S.pos).map(function (k) { return S.pos[k]; });
    var vp = S.r.viewport;
    if (!ps.length) { S.view = { x: 0, y: 0, s: 1 }; applyView(); return; }
    var x0 = Math.min.apply(null, ps.map(function (p) { return p.x; })) - 40;
    var y0 = Math.min.apply(null, ps.map(function (p) { return p.y; })) - 40;
    var x1 = Math.max.apply(null, ps.map(function (p) { return p.x + W; })) + 40;
    var y1 = Math.max.apply(null, ps.map(function (p) { return p.y + H; })) + 40;
    var r = vp.getBoundingClientRect(), avail = r.width - (S.selId && wide() ? PANEL_W : 0);
    var s = Math.min(1.1, avail / (x1 - x0), r.height / (y1 - y0));
    S.view.s = s;
    S.view.x = (avail - (x1 - x0) * s) / 2 - x0 * s;
    S.view.y = (r.height - (y1 - y0) * s) / 2 - y0 * s;
    applyView();
  }

  function centerOn(id) {
    var p = S.pos[id];
    if (!p) return;
    var r = S.r.viewport.getBoundingClientRect(), avail = r.width - (wide() ? PANEL_W : 0);
    S.view.x = avail / 2 - (p.x + W / 2) * S.view.s;
    S.view.y = r.height / 2 - (p.y + H / 2) * S.view.s;
    S.r.world.style.transition = 'transform .35s';
    applyView();
    setTimeout(function () { S.r.world.style.transition = ''; }, 380);
  }

  function bindPan(vp) {
    var drag = null;
    vp.addEventListener('pointerdown', function (e) {
      drag = { x: e.clientX, y: e.clientY, vx: S.view.x, vy: S.view.y };
      vp.classList.add('panning');
      vp.setPointerCapture(e.pointerId);
    });
    vp.addEventListener('pointermove', function (e) {
      if (!drag) return;
      S.view.x = drag.vx + e.clientX - drag.x;
      S.view.y = drag.vy + e.clientY - drag.y;
      applyView();
    });
    function end() { drag = null; vp.classList.remove('panning'); }
    vp.addEventListener('pointerup', end);
    vp.addEventListener('pointercancel', end);
    vp.addEventListener('wheel', function (e) {
      e.preventDefault();
      var r = vp.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top;
      var ns = Math.min(2.2, Math.max(0.25, S.view.s * Math.exp(-e.deltaY * 0.0015)));
      S.view.x = mx - (mx - S.view.x) * ns / S.view.s;
      S.view.y = my - (my - S.view.y) * ns / S.view.s;
      S.view.s = ns;
      applyView();
    }, { passive: false });
  }

  /* ---------- 패널 ---------- */
  function openLightbox(src) {
    S.r.lightbox.querySelector('img').src = src;
    S.r.lightbox.classList.add('open');
  }

  // 제목을 비운 채 다른 노드로 옮기거나 패널을 닫아도 기본 이름이 다시 적히게 한다.
  function fixTitle(n) {
    if (!n) return;
    var t = n.title.trim();
    var next = t || (isRoot(n) ? S.A.DEF.node : '새 기획');
    if (next !== n.title) { n.title = next; S.A.persist(); }
  }

  function select(id, focusTitle) {
    fixTitle(cur());
    S.selId = id;
    render();
    var n = cur(), r = S.r;
    if (!n) { closePanel(); return; }
    r.panel.classList.add('open');
    r.fTitle.value = n.title;
    r.fDate.value = n.date;
    r.fStatus.value = n.status;
    r.fText.value = n.text;
    r.fDiscuss.value = (S.p.internal[n.id] && S.p.internal[n.id].discuss) || '';
    var par = null;
    S.p.nodes.forEach(function (x) { if (x.id === n.parentId) par = x; });
    r.info.textContent = par ? '"' + (par.title || '제목 없음') + '" 에서 갈라져 나온 기획' : '시작 노드 (가지의 뿌리)';
    r.del.hidden = isRoot(n);
    r.delHint.hidden = !isRoot(n);
    renderImgs();
    if (focusTitle) { r.fTitle.focus(); r.fTitle.select(); }
  }

  function closePanel() {
    fixTitle(cur());
    S.selId = null;
    S.r.panel.classList.remove('open');
    render();
  }

  function renderImgs() {
    var n = cur(), box = S.r.imgs;
    box.textContent = '';
    if (!n) return;
    n.images.forEach(function (src, i) {
      var im = el('img', { src: src, alt: '첨부 이미지 ' + (i + 1) });
      im.addEventListener('click', function () { openLightbox(src); });
      var b = el('button', { type: 'button', title: '이미지 삭제', 'aria-label': '이미지 ' + (i + 1) + ' 삭제', text: '×' });
      b.addEventListener('click', function () {
        n.images.splice(i, 1);
        S.A.persist();
        renderImgs();
        render();
      });
      box.appendChild(el('div', { class: 'im' }, [im, b]));
    });
  }

  /* ---------- 이미지 ---------- */
  function compress(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file), img = new Image();
      img.onload = function () {
        var k = Math.min(1, 1400 / Math.max(img.width, img.height));
        var c = document.createElement('canvas');
        c.width = Math.round(img.width * k);
        c.height = Math.round(img.height * k);
        var g = c.getContext('2d');
        g.fillStyle = '#fff';
        g.fillRect(0, 0, c.width, c.height);
        g.drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        resolve(c.toDataURL('image/jpeg', 0.85));
      };
      img.onerror = function () { URL.revokeObjectURL(url); reject(); };
      img.src = url;
    });
  }

  function addFiles(files) {
    var n = cur();
    if (!n) return;
    var id = n.id, failed = 0;
    var chain = Promise.resolve();
    files.forEach(function (f) {
      if (!f.type || f.type.indexOf('image/') !== 0) return;
      chain = chain.then(function () {
        return compress(f).then(function (data) { n.images.push(data); }, function () { failed++; });
      });
    });
    chain.then(function () {
      if (failed) S.A.showAlert('읽지 못한 이미지 ' + failed + '개가 있습니다.');
      S.A.persist();
      if (S.selId === id) renderImgs();
      render();
    });
  }

  /* ---------- 동작: 수정 / 가지 치기 / 삭제 ---------- */
  function addChild(pid) {
    var par = null;
    S.p.nodes.forEach(function (x) { if (x.id === pid) par = x; });
    if (!par) return;
    var t = S.A.today();
    var n = {
      id: S.A.newId(), parentId: pid, title: '새 기획', date: t > par.date ? t : par.date,
      status: 'idea', text: '', images: [], createdAt: Date.now()
    };
    S.p.nodes.push(n);
    S.A.persist();
    select(n.id, true);
    centerOn(n.id);
  }

  function descendantIds(id) {
    var ids = {};
    ids[id] = true;
    var changed = true;
    while (changed) {
      changed = false;
      S.p.nodes.forEach(function (x) {
        if (x.parentId && ids[x.parentId] && !ids[x.id]) { ids[x.id] = true; changed = true; }
      });
    }
    return ids;
  }

  function deleteSelected() {
    var n = cur();
    if (!n || isRoot(n)) return;
    var ids = descendantIds(n.id);
    var below = S.p.nodes.filter(function (x) { return ids[x.id] && x.id !== n.id; });
    var name = '"' + (n.title || '제목 없음') + '"';
    var msg;
    if (below.length) {
      var shown = below.slice(0, 5).map(function (x) { return '· ' + (x.title || '제목 없음'); }).join('\n');
      if (below.length > 5) shown += '\n· 외 ' + (below.length - 5) + '개';
      msg = name + ' 와(과) 이어진 하위 기획 ' + below.length + '개도 함께 삭제됩니다.\n\n함께 삭제되는 기획:\n' + shown +
            '\n\n삭제하면 되돌릴 수 없습니다. 삭제할까요?';
    } else {
      msg = name + ' 을(를) 삭제할까요? 삭제하면 되돌릴 수 없습니다.';
    }
    if (!window.confirm(msg)) return;
    S.p.nodes = S.p.nodes.filter(function (x) { return !ids[x.id]; });
    Object.keys(ids).forEach(function (k) { delete S.p.internal[k]; });
    S.A.persist();
    closePanel();
  }

  // 카드 왼쪽의 굵은 선을 더블클릭하면 그 기획을 '채택'으로 바꾼다 (되돌리기는 상태 칸에서).
  // 첫 클릭에서 카드가 다시 그려져 기본 dblclick 이벤트가 오지 않으므로, 같은 선을 연달아 두 번 누른 것을 직접 센다.
  var lastLine = null;
  function isAdoptGesture(e, n, card) {
    var x = e.clientX - card.getBoundingClientRect().left;
    var inLine = x <= Math.max(8, 16 * S.view.s);   // 왼쪽 굵은 선 부근
    var now = Date.now();
    var twice = inLine && lastLine && lastLine.id === n.id && now - lastLine.t < 450;
    lastLine = inLine && !twice ? { id: n.id, t: now } : null;
    if (!twice) return false;
    if (n.status !== 'adopted') {
      n.status = 'adopted';
      S.A.persist();
      if (S.selId === n.id) S.r.fStatus.value = n.status;
      render();
    }
    return true;
  }

  /* ---------- 화면 구성 ---------- */
  function field(labelText, control) {
    return el('label', { class: 'f' }, [document.createTextNode(labelText), control]);
  }

  function buildPanel() {
    var r = S.r;
    r.fTitle = el('input', { class: 'in', type: 'text', maxlength: '80', placeholder: '기획 이름' });
    r.fDate = el('input', { class: 'in', type: 'date' });
    r.fStatus = el('select', { class: 'in' });
    Object.keys(S.A.STATUS).forEach(function (k) { r.fStatus.appendChild(el('option', { value: k, text: S.A.STATUS[k] })); });
    r.fText = el('textarea', { class: 'in', placeholder: '이 기획의 내용, 왜 이렇게 바뀌었는지 적어 보세요' });
    r.imgs = el('div', { class: 'imgs' });
    r.imgFile = el('input', { type: 'file', accept: 'image/*', multiple: 'multiple', hidden: 'hidden' });
    var pick = el('button', { type: 'button', class: 'btn', text: '파일 선택' });
    r.drop = el('div', { class: 'drop' }, [
      document.createTextNode('이미지를 끌어다 놓거나 붙여넣기(Ctrl+V)'), el('br'), pick
    ]);
    r.info = el('div', { class: 'hint' });
    var branch = el('button', { type: 'button', class: 'btn primary', text: '+ 이 기획에서 새 가지 치기' });
    r.del = el('button', { type: 'button', class: 'btn danger', text: '이 기획 삭제' });
    r.delHint = el('div', { class: 'hint', text: '시작 노드는 삭제할 수 없고, 이름만 바꿀 수 있어요.' });
    r.delHint.hidden = true;

    var pub = el('section', { class: 'win public', 'aria-label': '외부 공유용 창' }, [
      el('div', { class: 'win-head' }, [
        el('b', { text: '외부 공유용' }),
        el('span', { text: 'export 공유링크로 보여줄 내용' })
      ]),
      field('제목', r.fTitle),
      el('div', { class: 'row2' }, [field('날짜', r.fDate), field('상태', r.fStatus)]),
      field('내용 / 변경 이유', r.fText),
      el('div', {}, [el('div', { class: 'hint', text: '이미지' }), r.imgs, r.drop, r.imgFile]),
      r.info,
      el('div', { class: 'hint', text: '위 칸은 이 기획을 고치는 곳이고, 아래 버튼은 이 기획에서 새 방향을 갈라 내는 곳입니다.' }),
      branch, r.del, r.delHint
    ]);

    r.fDiscuss = el('textarea', { class: 'in', placeholder: '나중에 팀끼리 이야기할 내용을 적어 두세요' });
    var internal = el('section', { class: 'win internal', 'aria-label': '내부용 창' }, [
      el('div', { class: 'win-head' }, [
        el('b', { text: '내부용' }),
        el('span', { text: '팀원만 보는 메모 · export 공유링크에는 포함되지 않아요' })
      ]),
      field('추후 논의 사항', r.fDiscuss)
    ]);

    var close = el('button', { type: 'button', class: 'btn', text: '닫기' });
    close.addEventListener('click', closePanel);
    r.panel = el('aside', { class: 'panel', 'aria-label': '기획 편집' }, [
      el('div', { class: 'ph' }, [el('b', { text: '기획 편집' }), close]),
      el('div', { class: 'pb' }, [pub, internal])
    ]);

    // 입력 -> 데이터
    function bind(input, key, redraw) {
      input.addEventListener('input', function () {
        var n = cur();
        if (!n) return;
        n[key] = input.value;
        S.A.persist();
        if (redraw) render();
      });
    }
    bind(r.fTitle, 'title', true);
    bind(r.fText, 'text', false);
    r.fStatus.addEventListener('change', function () {
      var n = cur();
      if (!n) return;
      n.status = r.fStatus.value;
      S.A.persist();
      render();
    });
    r.fDate.addEventListener('input', function () {
      var n = cur();
      if (!n) return;
      n.date = r.fDate.value;
      S.A.persist();
      render();
    });
    r.fDate.addEventListener('change', function () {
      var n = cur();
      if (!n || r.fDate.value) return;
      n.date = S.A.today();
      r.fDate.value = n.date;
      S.A.persist();
      render();
    });
    // 제목을 비우면 기본 이름으로 다시 적는다
    r.fTitle.addEventListener('blur', function () {
      var n = cur();
      if (!n) return;
      fixTitle(n);
      r.fTitle.value = n.title;
      render();
    });
    r.fDiscuss.addEventListener('input', function () {
      var n = cur();
      if (!n) return;
      S.p.internal[n.id] = { discuss: r.fDiscuss.value };
      S.A.persist();
    });

    branch.addEventListener('click', function () { if (S.selId) addChild(S.selId); });
    r.del.addEventListener('click', deleteSelected);

    pick.addEventListener('click', function () { r.imgFile.click(); });
    r.imgFile.addEventListener('change', function (e) {
      addFiles([].slice.call(e.target.files));
      e.target.value = '';
    });
    ['dragenter', 'dragover'].forEach(function (t) {
      r.drop.addEventListener(t, function (e) { e.preventDefault(); r.drop.classList.add('over'); });
    });
    ['dragleave', 'drop'].forEach(function (t) {
      r.drop.addEventListener(t, function (e) { e.preventDefault(); r.drop.classList.remove('over'); });
    });
    r.drop.addEventListener('drop', function (e) { addFiles([].slice.call(e.dataTransfer.files)); });
  }

  function updateBottom() {
    if (!S.active) return;
    document.documentElement.style.setProperty('--bottom', S.r.bar.offsetHeight + 'px');
  }

  function mount(container, p, A) {
    S.A = A;
    S.p = p;
    S.selId = null;
    S.pos = {};
    S.view = { x: 0, y: 0, s: 1 };
    S.r = {};
    S.active = true;
    document.body.classList.add('is-main');
    container.textContent = '';
    var r = S.r;

    // 맨 위: 팀 이름·프로젝트 이름 (가장 중요)
    var team = A.editable({
      tag: 'p', cls: 'team-line', label: '팀 이름', max: 60, def: A.DEF.team,
      get: function () { return p.teamName; }, set: function (v) { p.teamName = v; }
    });
    var proj = A.editable({
      tag: 'h1', cls: 'proj-title', label: '프로젝트 이름', max: 80, def: A.DEF.proj,
      get: function () { return p.projectName; }, set: function (v) { p.projectName = v; }
    });
    var fitBtn = el('button', { type: 'button', class: 'btn', text: '화면 맞춤' });
    fitBtn.addEventListener('click', fit);
    var toolbar = el('header', { class: 'toolbar' }, [
      el('div', { class: 'titles' }, [team, proj]),
      el('div', { class: 'spacer' }),
      fitBtn
    ]);

    // 가운데: 가지 캔버스 (두 번째)
    r.world = el('div', { class: 'world' });
    r.viewport = el('div', { class: 'viewport', 'aria-label': '기획 가지도' }, [r.world]);
    bindPan(r.viewport);

    // 맨 아래: share 공유링크 (작게, 세 번째)
    var linkInput = el('input', { type: 'text', readonly: 'readonly', 'aria-label': 'share 공유링크' });
    // 자리 표시용 주소. 프로젝트 내용이 담기지 않으므로 다른 기기에서는 열리지 않는다.
    linkInput.value = location.origin + location.pathname + '#/share/' + p.id;
    var copyBtn = el('button', { type: 'button', class: 'btn', text: '복사' });
    var copyMsg = el('span', { class: 'copy-msg', role: 'status' });
    copyBtn.addEventListener('click', function () {
      linkInput.select();
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      copyMsg.textContent = ok ? '복사했습니다.' : '복사하지 못했습니다. 직접 선택해 복사해 주세요.';
    });
    // export 공유링크 (클라이언트용, 만든 시점 내용으로 고정)
    var exBtn = el('button', { type: 'button', class: 'btn', text: 'export 공유링크 만들기' });
    var exInput = el('input', { type: 'text', readonly: 'readonly', 'aria-label': 'export 공유링크' });
    var exCopy = el('button', { type: 'button', class: 'btn', text: '복사' });
    var exOpen = el('a', { class: 'btn', target: '_blank', rel: 'noopener', text: '미리보기' });
    var exMsg = el('span', { class: 'copy-msg', role: 'status' });
    var exOut = el('div', { class: 'link-row' }, [exInput, exCopy, exOpen]);
    exOut.hidden = true;
    exBtn.addEventListener('click', function () {
      exBtn.disabled = true;
      exMsg.textContent = '링크를 만드는 중...';
      exOut.hidden = true;
      window.Export.makeLink(p).then(function (res) {
        exInput.value = res.url;
        exOpen.href = res.url;
        exOut.hidden = false;
        exMsg.textContent = new Date(res.at).toLocaleString('ko-KR') + ' 기준으로 고정됨 · 링크 ' + res.length.toLocaleString('ko-KR') + '자' +
          (res.long ? ' (길어서 일부 메신저에서 잘릴 수 있어요)' : '');
        updateBottom();
      }, function () {
        exMsg.textContent = '링크가 너무 길어서 만들 수 없어요. 노드 내용을 줄여 주세요.';
        updateBottom();
      }).then(function () { exBtn.disabled = false; });
    });
    exCopy.addEventListener('click', function () {
      exInput.select();
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      exMsg.textContent = ok ? '복사했습니다.' : '복사하지 못했습니다. 직접 선택해 복사해 주세요.';
    });

    r.bar = el('footer', { class: 'bottombar' }, [
      el('div', { class: 'bar-row' }, [
        el('span', { class: 'share-title', text: 'share 공유링크 · 팀원 편집용' }),
        el('div', { class: 'link-row' }, [linkInput, copyBtn]),
        copyMsg,
        el('span', { class: 'notice-inline', text: '준비 중: 이 주소에는 프로젝트 내용이 담겨 있지 않아 다른 기기에서는 열리지 않고, 최신 내용 갱신도 아직 없어요.' })
      ]),
      el('div', { class: 'bar-row' }, [
        el('span', { class: 'share-title', text: 'export 공유링크 · 클라이언트용' }),
        exBtn, exOut, exMsg,
        el('span', { class: 'notice-inline', text: '누르는 시점의 내용으로 고정돼요. 이미지와 내부용 메모, 채택되지 않은 가지의 하위 가지는 담기지 않아요. 고친 내용은 새 링크로 만드세요.' }),
        el('span', { class: 'zoomhint', text: '드래그: 이동 · 휠: 확대/축소 · 카드 클릭: 편집 · +: 가지 치기 · 카드 왼쪽 굵은 선 더블클릭: 채택' })
      ])
    ]);

    r.lightbox = el('div', { class: 'lightbox' }, [el('img', { alt: '' })]);
    r.lightbox.addEventListener('click', function () { r.lightbox.classList.remove('open'); });

    buildPanel();
    [toolbar, r.viewport, r.panel, r.bar, r.lightbox].forEach(function (n) { container.appendChild(n); });

    render();
    requestAnimationFrame(function () { updateBottom(); fit(); });
  }

  function unmount() {
    S.active = false;
    S.selId = null;
  }

  /* ---------- 전역 이벤트 (한 번만 등록) ---------- */
  document.addEventListener('keydown', function (e) {
    if (!S.active || e.key !== 'Escape') return;
    if (S.r.lightbox.classList.contains('open')) S.r.lightbox.classList.remove('open');
    else if (S.selId) closePanel();
  });
  document.addEventListener('paste', function (e) {
    if (!S.active || !cur()) return;
    var fs = [].slice.call((e.clipboardData && e.clipboardData.files) || [])
      .filter(function (f) { return f.type.indexOf('image/') === 0; });
    if (fs.length) { e.preventDefault(); addFiles(fs); }
  });
  window.addEventListener('resize', updateBottom);

  window.Branch = { mount: mount, unmount: unmount };
})();
