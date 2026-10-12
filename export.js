/*
 * export 공유링크: 만들기(buildPayload/makeLink) + 결과물 화면(show).
 * - 링크는 주소의 # 뒤에 "화면에 보이는 공개 내용"만 압축해서 담는다(서버 없음, 만든 시점 내용으로 고정).
 * - 내부용 내용, 이미지, 보이지 않는 하위 가지는 담지 않는다.
 * - 결과물 화면: 아래로 뻗는 가계도 하나를 그리고, 스크롤하면 카메라가 전체 → 시작 노드 →
 *   갈라진 가지들 → 간선을 따라 채택된 노드(줌인) → … 순서로 움직인다. 모션 줄이기에서는 문서형으로 보여준다.
 */
(function () {
  'use strict';

  var STATUS = { idea: '아이디어', active: '진행중', adopted: '채택', dropped: '폐기' };
  var MAX_NODES = 300;
  var WARN_LEN = 8000;      // 이보다 길면 일부 메신저에서 잘릴 수 있다고 안내
  var MAX_LEN = 150000;     // 이보다 길면 만들지 않는다
  var E = { handlers: [] };

  /* ---------- 장면 순서 계산 (만들기·보기 공통) ---------- */
  function cmp(a, b) { return (a.date || '').localeCompare(b.date || '') || a.ord - b.ord; }

  // nodes: [{id,parentId,title,date,status,text,ord}]
  function walk(nodes) {
    var by = {}, kids = {}, root = null;
    nodes.forEach(function (n) { by[n.id] = n; kids[n.id] = []; });
    nodes.forEach(function (n) {
      if (n.parentId !== null && by[n.parentId]) kids[n.parentId].push(n);
      else if (!root) root = n;
    });
    Object.keys(kids).forEach(function (k) { kids[k].sort(cmp); });
    var steps = [], cur = root, depth = 0, end = 'leaf';
    while (cur) {
      steps.push({ type: 'node', node: cur, depth: depth });
      var ks = kids[cur.id];
      if (!ks.length) { end = 'leaf'; break; }
      steps.push({ type: 'fork', node: cur, kids: ks });
      var adopted = ks.filter(function (k) { return k.status === 'adopted'; });
      if (adopted.length === 1) { cur = adopted[0]; depth++; }
      else { end = adopted.length ? 'multi' : 'none'; break; }
    }
    return { steps: steps, end: end };
  }

  /* ---------- 링크 만들기 ---------- */
  function buildPayload(p) {
    var list = p.nodes.map(function (n) {
      return { id: n.id, parentId: n.parentId, title: n.title, date: n.date, status: n.status, text: n.text, ord: n.createdAt };
    });
    var w = walk(list), picked = [], seen = {};
    function add(n) { if (!seen[n.id]) { seen[n.id] = true; picked.push(n); } }
    w.steps.forEach(function (s) {
      if (s.type === 'node') add(s.node);
      else s.kids.forEach(add);
    });
    var idx = {};
    picked.forEach(function (n, i) { idx[n.id] = i; });
    return {
      v: 1, t: p.projectName, m: p.teamName, d: new Date().toISOString(),
      n: picked.map(function (n) {
        return [n.parentId !== null && idx[n.parentId] !== undefined ? idx[n.parentId] : -1, n.title, n.date, n.status, n.text];
      })
    };
  }

  function toB64Url(bytes) {
    var s = '';
    for (var i = 0; i < bytes.length; i += 0x8000) {
      s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    }
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function fromB64Url(str) {
    var b = str.replace(/-/g, '+').replace(/_/g, '/');
    while (b.length % 4) b += '=';
    var s = atob(b), out = new Uint8Array(s.length);
    for (var i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
  }

  function pipe(bytes, stream) {
    var w = stream.writable.getWriter();
    // 잘린 데이터의 오류는 아래 읽기 쪽에서 한 번만 처리한다
    w.write(bytes).catch(function () {});
    w.close().catch(function () {});
    return new Response(stream.readable).arrayBuffer().then(function (b) { return new Uint8Array(b); });
  }

  function encode(obj) {
    var bytes = new TextEncoder().encode(JSON.stringify(obj));
    if (typeof CompressionStream === 'undefined') return Promise.resolve('r.' + toB64Url(bytes));
    return pipe(bytes, new CompressionStream('deflate-raw')).then(
      function (z) { return 'z.' + toB64Url(z); },
      function () { return 'r.' + toB64Url(bytes); }
    );
  }

  function decode(str) {
    var m = /^([zr])\.([A-Za-z0-9_-]+)$/.exec(str);
    if (!m) return Promise.reject(new Error('bad'));
    var bytes;
    try { bytes = fromB64Url(m[2]); } catch (e) { return Promise.reject(e); }
    var p;
    if (m[1] === 'r') p = Promise.resolve(bytes);
    else if (typeof DecompressionStream === 'undefined') return Promise.reject(new Error('unsupported'));
    else p = pipe(bytes, new DecompressionStream('deflate-raw'));
    return p.then(function (b) { return JSON.parse(new TextDecoder().decode(b)); });
  }

  // 만들어 낸 링크 정보. 너무 길면 거부한다.
  function makeLink(p) {
    var payload = buildPayload(p);
    return encode(payload).then(function (s) {
      var url = location.origin + location.pathname + '#/export/' + s;
      if (url.length > MAX_LEN) throw new Error('too-long');
      return { url: url, length: url.length, long: url.length > WARN_LEN, nodes: payload.n.length, at: payload.d };
    });
  }

  /* ---------- 링크로 받은 데이터 검증 ---------- */
  function fromPayload(d) {
    function str(v, max) { return typeof v === 'string' && v.length <= max; }
    if (!d || d.v !== 1 || !str(d.t, 200) || !str(d.m, 200) || !Array.isArray(d.n) ||
        !d.n.length || d.n.length > MAX_NODES) return null;
    var nodes = [];
    for (var i = 0; i < d.n.length; i++) {
      var a = d.n[i];
      if (!Array.isArray(a) || a.length !== 5 || typeof a[0] !== 'number' || a[0] < -1 || a[0] >= i ||
          !str(a[1], 400) || !str(a[2], 20) || !STATUS[a[3]] || !str(a[4], 50000)) return null;
      nodes.push({ id: String(i), parentId: a[0] < 0 ? null : String(a[0]), title: a[1], date: a[2], status: a[3], text: a[4], ord: i });
    }
    if (nodes[0].parentId !== null) return null;
    return { title: d.t, team: d.m, date: typeof d.d === 'string' ? d.d.slice(0, 10) : '', nodes: nodes };
  }

  /* ---------- 결과물 화면 ---------- */
  function el(tag, attrs, kids) {
    var n = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === 'text') n.textContent = attrs[k];
      else if (k === 'class') n.className = attrs[k];
      else n.setAttribute(k, attrs[k]);
    });
    (kids || []).forEach(function (c) { n.appendChild(c); });
    return n;
  }

  function chip(status) { return el('span', { class: 'chip s-' + status, text: STATUS[status] }); }
  function pad(n) { return ('0' + n).slice(-2); }
  function note(text) { return el('p', { class: 'ex-note', text: text }); }

  function titleScene(data) {
    var inner = el('div', { class: 'scene-in' }, [
      el('p', { class: 'ex-team', text: data.team }),
      el('h1', { class: 'ex-title', text: data.title }),
      el('p', { class: 'ex-sub', text: '기획이 어떻게 이어지고 갈라졌는지 따라가 보세요.' + (data.date ? ' (' + data.date + ' 기준)' : '') }),
      el('div', { class: 'down', 'aria-hidden': 'true', text: '↓ 스크롤해서 따라가 보세요' })
    ]);
    return { kind: 'title', el: el('section', { class: 'scene scene-title' }, [inner]) };
  }

  function nodeScene(step, isLast) {
    var n = step.node;
    var card = el('article', { class: 'ex-card' }, [
      el('div', { class: 'ex-meta' }, [chip(n.status), el('span', { text: n.date })]),
      el('h2', { text: n.title || '(제목 없음)' }),
      el('p', { class: n.text ? 'ex-body' : 'ex-body empty', text: n.text || '작성된 내용이 없어요.' })
    ]);
    var kids = [
      el('p', { class: 'ex-label', text: pad(step.depth + 1) + ' · ' + (step.depth === 0 ? '시작 노드' : '채택된 방향') }),
      card
    ];
    if (isLast) kids.push(note('— 현재 기준의 방향 —'));
    return { kind: 'node', id: step.node.id, el: el('section', { class: 'scene scene-node' }, [el('div', { class: 'scene-in' }, kids)]) };
  }

  function forkScene(step, endKind) {
    var list = el('ul', { class: 'fork-kids' });
    step.kids.forEach(function (k) {
      var adopted = k.status === 'adopted';
      list.appendChild(el('li', { class: 'kid ' + (adopted ? 'adopted' : 'faded'), 'data-id': k.id }, [
        el('div', { class: 'kid-card' }, [
          el('div', { class: 'ex-meta' }, [chip(k.status), el('span', { text: k.date })]),
          el('h3', { text: k.title || '(제목 없음)' }),
          k.text ? el('p', { class: 'kid-text', text: k.text }) : el('span')
        ])
      ]));
    });
    var kids = [
      el('p', { class: 'ex-label', text: '여기서 갈라진 방향 ' + step.kids.length + '개' }),
      el('div', { class: 'fork' }, [el('div', { class: 'fork-parent', text: step.node.title || '(제목 없음)' }), list])
    ];
    if (endKind === 'multi') kids.push(note('여러 갈래가 함께 채택되어, 여기까지를 현재 기준으로 보여드려요.'));
    if (endKind === 'none') kids.push(note('아직 채택된 방향이 없어요. 현재까지 갈라진 가지예요.'));
    return { kind: 'fork', el: el('section', { class: 'scene scene-fork' }, [el('div', { class: 'scene-in' }, kids)]) };
  }

  function on(target, ev, fn, opt) {
    target.addEventListener(ev, fn, opt);
    E.handlers.push([target, ev, fn, opt]);
  }

  function unmount() {
    E.handlers.forEach(function (h) { h[0].removeEventListener(h[1], h[2], h[3]); });
    E.handlers = [];
    document.body.classList.remove('is-export');
  }

  var END_TEXT = {
    leaf: '— 현재 기준의 방향 —',
    multi: '여러 갈래가 함께 채택되어, 여기까지를 현재 기준으로 보여드려요.',
    none: '아직 채택된 방향이 없어요. 현재까지 갈라진 가지예요.'
  };

  function ease(t) { return t * t * (3 - 2 * t); }
  function clamp(v) { return Math.max(0, Math.min(1, v)); }

  /* 모션 줄이기: 카메라 없이 위에서 아래로 읽는 문서 */
  function renderStatic(container, data, w) {
    var scenes = [titleScene(data)];
    w.steps.forEach(function (s, i) {
      var last = i === w.steps.length - 1;
      scenes.push(s.type === 'node' ? nodeScene(s, last) : forkScene(s, last ? w.end : null));
    });
    container.appendChild(el('div', { class: 'ex static' }, scenes.map(function (s) { return s.el; })));
  }

  /*
   * 가계도 하나를 아래로 그리고, 스크롤에 따라 카메라가 움직인다.
   * 카메라 자세(pose): 전체 → 시작 노드 → (갈라진 가지 전체) → 간선을 따라 채택된 노드 → … 반복
   */
  function renderTree(container, data, w) {
    var path = [], levels = [];
    w.steps.forEach(function (s) {
      if (s.type === 'node') path.push(s.node); else levels.push(s.kids);
    });
    levels.unshift([path[0]]);   // levels[0] = 시작 노드, levels[i+1] = path[i]에서 갈라진 가지들
    var onPath = {};
    path.forEach(function (n) { onPath[n.id] = true; });

    var els = {};
    function makeNode(n) {
      var isPath = !!onPath[n.id];
      var kids = [];
      if (isPath) {
        var d = path.indexOf(n);
        kids.push(el('p', { class: 'tlabel', text: pad(d + 1) + ' · ' + (d === 0 ? '시작 노드' : '채택된 방향') }));
      }
      kids.push(el('div', { class: 'ex-meta' }, [chip(n.status), el('span', { text: n.date })]));
      kids.push(el('h3', { text: n.title || '(제목 없음)' }));
      kids.push(el('p', { class: n.text ? 'tbody' : 'tbody empty', text: n.text || '작성된 내용이 없어요.' }));
      var e = el('div', { class: 'tnode ' + (isPath ? 'path' : 'faded') }, kids);
      els[n.id] = e;
      return e;
    }

    var NS = 'http://www.w3.org/2000/svg';
    var svg = document.createElementNS(NS, 'svg');
    var world = el('div', { class: 'ex-world' }, [svg]);
    levels.forEach(function (row) { row.forEach(function (n) { world.appendChild(makeNode(n)); }); });

    var bar = el('i');
    var overlay = el('div', { class: 'ex-title-overlay' }, [el('div', { class: 'ex-title-inner' }, [
      el('p', { class: 'ex-team', text: data.team }),
      el('h1', { class: 'ex-title', text: data.title }),
      el('p', { class: 'ex-sub', text: '기획이 어떻게 이어지고 갈라졌는지 따라가 보세요.' + (data.date ? ' (' + data.date + ' 기준)' : '') }),
      el('div', { class: 'down', 'aria-hidden': 'true', text: '↓ 스크롤해서 따라가 보세요' })
    ])]);
    var endNote = el('div', { class: 'ex-end', role: 'status' }, [el('span', { text: END_TEXT[w.end] })]);
    var stage = el('div', { class: 'ex-stage' }, [world, overlay, endNote]);
    var track = el('div', { class: 'ex-track' }, [stage]);
    container.appendChild(el('div', { class: 'ex' }, [el('div', { class: 'ex-progress' }, [bar]), track]));

    var pos = {}, edges = [], poses = [];

    // 카드 실제 높이를 재서 줄별로 배치한다 (아래로 뻗는 가계도)
    function layoutTree() {
      var CW = 320, HG = 48, VG = 190, y = 0, cx = 0;
      pos = {};
      levels.forEach(function (row, L) {
        var width = row.length * CW + (row.length - 1) * HG, start = cx - width / 2, rowH = 0;
        row.forEach(function (n, k) {
          var e = els[n.id], left = start + k * (CW + HG), h = e.offsetHeight;
          e.style.left = left + 'px';
          e.style.top = y + 'px';
          pos[n.id] = { l: left, t: y, w: CW, h: h };
          rowH = Math.max(rowH, h);
        });
        if (path[L]) cx = pos[path[L].id].l + CW / 2;
        y += rowH + VG;
      });

      // 간선
      svg.textContent = '';
      edges = [];
      var maxX = 0, maxY = 0;
      Object.keys(pos).forEach(function (k) { maxX = Math.max(maxX, pos[k].l + pos[k].w); maxY = Math.max(maxY, pos[k].t + pos[k].h); });
      svg.setAttribute('width', maxX);
      svg.setAttribute('height', maxY);
      // 가계도처럼 직선만 쓴다: 부모 아래로 수직선 → 가로 줄 → 각 자식으로 수직선
      function line(d, on) {
        var pa = document.createElementNS(NS, 'path');
        pa.setAttribute('d', d);
        pa.setAttribute('class', 'tedge ' + (on ? 'on' : 'off'));
        svg.appendChild(pa);
      }
      path.forEach(function (par, L) {
        var kids = levels[L + 1];
        if (!kids) return;
        var p = pos[par.id];
        var x1 = p.l + p.w / 2, y1 = p.t + p.h;
        var childTop = Math.min.apply(null, kids.map(function (k) { return pos[k.id].t; }));
        var busY = y1 + (childTop - y1) / 2;
        var hasAdopted = kids.some(function (k) { return onPath[k.id]; });
        // 채택되지 않은 줄을 먼저 그려서, 채택된 검은 선이 위에 오게 한다
        kids.filter(function (k) { return !onPath[k.id]; }).forEach(function (k) {
          var c = pos[k.id], x2 = c.l + c.w / 2;
          line('M' + x1 + ',' + busY + ' H' + x2 + ' V' + c.t, false);
        });
        line('M' + x1 + ',' + y1 + ' V' + busY, hasAdopted);
        kids.filter(function (k) { return onPath[k.id]; }).forEach(function (k) {
          var c = pos[k.id], x2 = c.l + c.w / 2;
          line('M' + x1 + ',' + busY + ' H' + x2 + ' V' + c.t, true);
          edges[L] = { x1: x1, x2: x2, busY: busY };
        });
      });
    }

    function fitBox(minx, miny, maxx, maxy, padding, cap, vw, vh) {
      var bw = maxx - minx + padding * 2, bh = maxy - miny + padding * 2;
      return { cx: (minx + maxx) / 2, cy: (miny + maxy) / 2, s: Math.min(vw / bw, vh / bh, cap) };
    }

    function computePoses() {
      var vw = stage.clientWidth, vh = stage.clientHeight;
      poses = [];
      var ids = Object.keys(pos);
      var a = fitBox(
        Math.min.apply(null, ids.map(function (k) { return pos[k].l; })),
        Math.min.apply(null, ids.map(function (k) { return pos[k].t; })),
        Math.max.apply(null, ids.map(function (k) { return pos[k].l + pos[k].w; })),
        Math.max.apply(null, ids.map(function (k) { return pos[k].t + pos[k].h; })),
        60, 1, vw, vh);
      a.kind = 'title';
      poses.push(a);
      path.forEach(function (n, i) {
        var p = pos[n.id];
        poses.push({ kind: 'node', i: i, cx: p.l + p.w / 2, cy: p.t + p.h / 2, s: Math.min(vw * 0.84 / p.w, vh * 0.8 / p.h, 1.5) });
        var kids = levels[i + 1];
        if (kids) {
          var minx = p.l, maxx = p.l + p.w, miny = p.t, maxy = p.t + p.h;
          kids.forEach(function (k) {
            var c = pos[k.id];
            minx = Math.min(minx, c.l); maxx = Math.max(maxx, c.l + c.w); maxy = Math.max(maxy, c.t + c.h);
          });
          if (i === path.length - 1) maxy += 80;   // 마지막 장면은 안내 문구가 들어갈 자리를 남긴다
          var f = fitBox(minx, miny, maxx, maxy, 50, 1.2, vw, vh);
          f.kind = 'fork';
          f.i = i;
          poses.push(f);
        }
      });
      track.style.setProperty('--m', poses.length);
    }

    function update() {
      var rect = track.getBoundingClientRect();
      var range = track.offsetHeight - window.innerHeight;
      var prog = range > 0 ? clamp(-rect.top / range) : 0;
      bar.style.width = (prog * 100) + '%';
      var M = poses.length, u = prog * (M - 1);
      var j = Math.min(M - 2, Math.max(0, Math.floor(u)));
      var t = ease(clamp((u - j - 0.2) / 0.6));
      var A = poses[j], B = poses[j + 1], cx, cy;
      if (A.kind === 'fork' && B.kind === 'node' && edges[A.i]) {
        // 직각 간선(아래로 → 옆으로 → 아래로)을 따라가는 카메라
        var ed = edges[A.i];
        var pts = [[A.cx, A.cy], [ed.x1, ed.busY], [ed.x2, ed.busY], [B.cx, B.cy]];
        var lens = [], total = 0;
        for (var n = 0; n < 3; n++) {
          var len = Math.abs(pts[n + 1][0] - pts[n][0]) + Math.abs(pts[n + 1][1] - pts[n][1]);
          lens.push(len);
          total += len;
        }
        var d = t * total, seg = 0;
        while (seg < 2 && d > lens[seg]) { d -= lens[seg]; seg++; }
        var r = lens[seg] ? d / lens[seg] : 1;
        cx = pts[seg][0] + (pts[seg + 1][0] - pts[seg][0]) * r;
        cy = pts[seg][1] + (pts[seg + 1][1] - pts[seg][1]) * r;
      } else {
        cx = A.cx + (B.cx - A.cx) * t;
        cy = A.cy + (B.cy - A.cy) * t;
      }
      var s = Math.exp(Math.log(A.s) + (Math.log(B.s) - Math.log(A.s)) * t);
      var vw = stage.clientWidth, vh = stage.clientHeight;
      world.style.transform = 'translate(' + (vw / 2 - cx * s) + 'px,' + (vh / 2 - cy * s) + 'px) scale(' + s + ')';
      overlay.style.opacity = j === 0 ? 1 - clamp(t * 1.6) : 0;
      endNote.style.opacity = clamp((u - (M - 1 - 0.45)) / 0.25);
    }

    function relayout() { layoutTree(); computePoses(); update(); }

    var queued = false;
    function onScroll() {
      if (queued) return;
      queued = true;
      requestAnimationFrame(function () { queued = false; update(); });
    }
    on(window, 'scroll', onScroll, { passive: true });
    on(window, 'resize', relayout);
    window.scrollTo(0, 0);
    requestAnimationFrame(relayout);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(relayout);
  }

  function render(container, data) {
    container.textContent = '';
    document.body.classList.add('is-export');
    document.title = data.title + ' · 기획 변화 기록';
    var w = walk(data.nodes);
    var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) renderStatic(container, data, w); else renderTree(container, data, w);
  }

  function errorView(container, msg) {
    container.textContent = '';
    container.className = 'page';
    container.appendChild(el('div', { class: 'hero' }, [
      el('div', { class: 'card-plain' }, [
        el('h2', { text: '결과물을 열 수 없어요' }),
        el('p', { text: msg })
      ])
    ]));
  }

  // 주소의 # 뒤 데이터를 풀어 결과물 화면을 그린다.
  function show(container, payload) {
    decode(payload).then(function (raw) {
      var data = fromPayload(raw);
      if (!data) { errorView(container, '링크의 내용이 올바르지 않아요. 링크를 만든 사람에게 새 링크를 요청해 주세요.'); return; }
      container.className = 'export-root';
      render(container, data);
    }, function (e) {
      errorView(container, e && e.message === 'unsupported'
        ? '이 브라우저에서는 링크를 열 수 없어요. 최신 버전의 브라우저로 열어 주세요.'
        : '링크가 잘렸거나 올바르지 않아요. 링크 전체를 복사했는지 확인해 주세요.');
    });
  }

  window.Export = { makeLink: makeLink, show: show, unmount: unmount, _walk: walk };
})();
