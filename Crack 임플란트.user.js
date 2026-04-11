// ==UserScript==
// @name         Crack 임플란트
// @namespace    https://crack.wrtn.ai
// @version      1.0.1
// @description  카드 이미지에 0.8초 호버 → 제목·제작자·옵션·한줄설명·태그·통계를 말풍선으로 표시 / 메인 페이지 플랫폼 기본 모달 억제
// @author       Tyme
// @match        https://crack.wrtn.ai/*
// @grant        none
// @run-at       document-start
// ==/UserScript==

(function () {
  'use strict';

  /* ══════════════════════════════════════════════════════════════
     § 0. 설정
     ══════════════════════════════════════════════════════════════ */
  const HOVER_DELAY  = 800;
  const BUBBLE_GAP   = 12;
  const BUBBLE_W     = 340;
  const BUBBLE_MAX_H = 650;
  const API_BASE     = 'https://crack-api.wrtn.ai/crack-api';

  /* ══════════════════════════════════════════════════════════════
     § 1. 캐시 + fetch/XHR 인터셉트
     ══════════════════════════════════════════════════════════════ */
  const cache = new Map();

  const _origFetch = window.fetch;
  window.fetch = async function (...args) {
    const res = await _origFetch.apply(this, args);
    try {
      const url = typeof args[0] === 'string' ? args[0] : (args[0]?.url ?? '');
      if (_isTargetUrl(url))
        res.clone().json().then(json => _digestJson(url, json)).catch(() => {});
    } catch (_) {}
    return res;
  };

  const _origOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (m, url, ...r) {
    this._crkUrl = url; return _origOpen.call(this, m, url, ...r);
  };
  const _origSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function (...a) {
    this.addEventListener('load', () => {
      try {
        const url = this._crkUrl ?? '';
        if (_isTargetUrl(url)) _digestJson(url, JSON.parse(this.responseText));
      } catch (_) {}
    });
    return _origSend.apply(this, a);
  };

  function _isTargetUrl(url) {
    return url.includes('crack-api.wrtn.ai') ||
           url.includes('/api/stories') || url.includes('/api/characters');
  }

  function _digestJson(url, json) {
    const visited = new WeakSet();

    function traverse(obj) {
      if (!obj || typeof obj !== 'object') return;
      if (visited.has(obj)) return;
      visited.add(obj);

      const id = obj._id ?? obj.id;
      if (id && /^[a-f0-9]{24}$/.test(String(id))) {
        if (obj.name || obj.title || obj.simpleDescription || obj.description) {
          if (!cache.has(id) || cache.get(id)._partial) {
            const info = _buildInfo(obj);
            if (info.title) cache.set(id, info);
          }
        }
      }

      if (Array.isArray(obj)) {
        for (let i = 0; i < obj.length; i++) traverse(obj[i]);
      } else {
        for (const key in obj) {
          if (Object.prototype.hasOwnProperty.call(obj, key)) traverse(obj[key]);
        }
      }
    }

    try { traverse(json); } catch(_) {}
  }

  /* ══════════════════════════════════════════════════════════════
     § 2. API 데이터 → CardInfo 변환
     ══════════════════════════════════════════════════════════════ */
  function _buildInfo(d) {
    const rawTags = d.hashtags ?? d.tags ?? [];
    const tags = rawTags.map(t => {
      const s = typeof t === 'string' ? t : (t?.name ?? t?.tag ?? t?.value ?? '');
      return s ? (s.startsWith('#') ? s : '#' + s) : null;
    }).filter(Boolean);

    const options = [];

    if (d.hasImage && d.imageCount > 0)
      options.push(`이미지 ${d.imageCount}장`);

    const tplName = typeof d.promptTemplate === 'string'
      ? d.promptTemplate
      : (d.promptTemplate?.name ?? d.promptTemplate?.type ?? null);
    if (tplName) options.push(String(tplName));

    const targetName = typeof d.target === 'string'
      ? d.target
      : (d.target?.name ?? null);
    if (targetName) options.push(String(targetName));

    const chatTypeName = typeof d.chatType === 'string'
      ? d.chatType
      : (d.chatType?.name ?? null);
    if (chatTypeName) options.push(String(chatTypeName));

    if (d.originContentTitle)
      options.push('2차 창작 : ' + String(d.originContentTitle));

    const intro =
      _str(d.simpleDescription) ??
      _str(d.intro) ??
      _str(d.tagline) ??
      _str(d.oneliner) ??
      null;

    const description = _str(d.detailDescription) ?? _str(d.description) ?? null;

    const isRich = !!(
      d.description || d.simpleDescription || d.detailDescription ||
      d.promptTemplate || d.target || d.chatType ||
      (d.imageCount > 0) || d.originContentTitle ||
      (d.tags?.length > 0) || (d.hashtags?.length > 0)
    );

    return {
      title:        _str(d.name ?? d.title),
      creator:      _str(d.creator?.nickname ?? d.author?.nickname ?? d.creator?.name),
      options,
      intro,
      description,
      tags,
      chatCount:    _fmt(d.chatCount ?? d.totalMessageCount ?? d.playCount),
      likeCount:    _fmt(d.likeCount),
      commentCount: _fmt(d.commentCount),
      _partial:     !isRich,
    };
  }

  function _str(v) {
    if (v == null) return null;
    if (typeof v === 'string') return v.trim() || null;
    if (typeof v === 'object') {
      const t = v.content ?? v.text ?? v.value ?? v.body ?? v.description
              ?? v.intro ?? v.summary ?? v.name;
      return typeof t === 'string' ? t.trim() || null : null;
    }
    const s = String(v).trim();
    return s === '[object Object]' ? null : s || null;
  }

  /* ══════════════════════════════════════════════════════════════
     § 3. __NEXT_DATA__ 초기 캐싱
     ══════════════════════════════════════════════════════════════ */
  function _tryNextData() {
    try {
      const pp = window.__NEXT_DATA__?.props?.pageProps;
      if (pp) _digestJson('__NEXT_DATA__', pp);
    } catch (_) {}
  }
  if (document.readyState === 'loading')
    document.addEventListener('DOMContentLoaded', _tryNextData);
  else setTimeout(_tryNextData, 0);

  /* ══════════════════════════════════════════════════════════════
     § 4. 모달 DOM 파싱
     ══════════════════════════════════════════════════════════════ */
  function _parseModal(root) {
    const titleEl =
      root.querySelector('[color="text_primary"][class*="typo-text-lg"]') ??
      root.querySelector('p.typo-text-lg_leading-paragraph_semibold');
    if (!titleEl?.textContent?.trim()) return null;
    const title = titleEl.textContent.trim();

    const creatorEl = root.querySelector('.text-line-gray-1, [class*="text-line-gray-1"]');
    const creator = creatorEl?.textContent?.trim() || null;

    const options = Array.from(root.querySelectorAll('[data-clipping="true"]'))
      .map(el => el.textContent.trim()).filter(Boolean);

    let intro = null;
    const ydEl = root.querySelector('.css-yd8sa2, [class*="css-yd8sa2"]');
    if (ydEl) {
      const firstP = ydEl.querySelector('p[color="text_primary"], p.css-ws11u4');
      intro = firstP?.textContent?.trim() || null;
    }
    if (!intro) {
      intro = root.querySelector('p.css-ws11u4')?.textContent?.trim() || null;
    }

    const mdEl = root.querySelector('.wrtn-markdown');
    const description = mdEl?.textContent?.trim() || null;

    const tags = Array.from(root.querySelectorAll('[color="text_secondary"]'))
      .map(el => el.textContent.trim()).filter(t => t.startsWith('#'));

    const statGroups = root.querySelectorAll('[class*="css-lcrd7a"]');
    let chatCount = null, likeCount = null, commentCount = null;
    statGroups.forEach((el, i) => {
      const txt = el.querySelector('p')?.textContent?.trim() ?? null;
      if (i === 0) chatCount    = txt;
      if (i === 1) likeCount    = txt;
      if (i === 2) commentCount = txt;
    });

    return { title, creator, options, intro, description,
             tags, chatCount, likeCount, commentCount, _fromDom: true };
  }

  /* ══════════════════════════════════════════════════════════════
     § 5. 카드 DOM 부분 파싱 (즉시 표시용)
     ══════════════════════════════════════════════════════════════ */
  function _parseCard(card) {
    const titleEl = card.querySelector(
      'p.typo-text-base_leading-paragraph_semibold, p[class*="typo-text-base"][class*="semibold"]'
    );
    const title = titleEl?.textContent?.trim() || null;
    if (!title) return null;

    const statEl = card.querySelector('p.text-line-gray-2, p[class*="text-line-gray-2"]');
    const chatCount = statEl?.textContent?.trim() || null;

    const creatorEl = card.querySelector('button[type="button"] p[class*="truncate"]');
    const creator = creatorEl?.textContent?.trim() || null;

    return {
      title, creator, options: [], intro: null, description: null,
      tags: [], chatCount, likeCount: null, commentCount: null, _partial: true,
    };
  }

  /* ══════════════════════════════════════════════════════════════
   § 6. 모달 자동 캐싱 + 메인 페이지 팝오버 억제
   ══════════════════════════════════════════════════════════════ */
new MutationObserver(muts => {
  for (const mut of muts) {
    mut.addedNodes.forEach(node => {
      if (node.nodeType !== 1) return;

      // ── 기존: 플랫폼 상세 모달 캐싱 ──
      const modal =
        (node.id === 'web-modal' ? node : null) ??
        node.querySelector?.('#web-modal') ??
        (node.className?.includes?.('css-jmmlw3') ? node : null) ??
        node.querySelector?.('[class*="css-jmmlw3"]');
      if (modal) {
        const tryExtract = () => {
          const link = modal.querySelector('a[href*="/detail/"]');
          if (!link) return;
          const m = link.getAttribute('href').match(/\/detail\/([a-f0-9]{24})/);
          if (!m) return;
          if (cache.has(m[1]) && !cache.get(m[1])._partial) return;
          const info = _parseModal(modal);
          if (info) cache.set(m[1], info);
        };
        setTimeout(tryExtract,  80);
        setTimeout(tryExtract, 350);
        setTimeout(tryExtract, 800);
      }

      // ── 신규: Floating UI 캐릭터 팝오버 억제 ──
      // data-floating-ui-portal 하위 .z-popover 중
      // img[alt="character_thumbnail"]을 포함한 것만 타겟
      const portals = node.hasAttribute?.('data-floating-ui-portal')
        ? [node]
        : Array.from(node.querySelectorAll?.('[data-floating-ui-portal]') ?? []);

      portals.forEach(portal => {
        const popover = portal.querySelector('.z-popover') ?? portal;
        const trySuppress = () => {
          if (popover.querySelector('img[alt="character_thumbnail"]') && _isMainPage())
            _suppressModal(popover);
        };
        setTimeout(trySuppress,   0);
        setTimeout(trySuppress, 150);
        setTimeout(trySuppress, 400);
      });
    });
  }
}).observe(document.documentElement, { childList: true, subtree: true });

  /* ══════════════════════════════════════════════════════════════
     § 6.5 메인 페이지 플랫폼 모달 억제
     - 메인 페이지('/')에서만 작동 / 좋아요·프로필 페이지는 그대로
     - 데이터 캐싱(§6)은 억제 전 setTimeout으로 이미 예약되므로 손실 없음
     ══════════════════════════════════════════════════════════════ */
  function _isMainPage() {
    const p = location.pathname;
    return p === '/' || p === '';
  }

  let _suppressedModal = null;
  let _suppressObs     = null;

  function _suppressModal(modal) {
    if (_suppressObs) { _suppressObs.disconnect(); _suppressObs = null; }
    _suppressedModal = modal;

    const hide = () => {
      modal.style.setProperty('display',        'none',   'important');
      modal.style.setProperty('visibility',     'hidden', 'important');
      modal.style.setProperty('pointer-events', 'none',   'important');
    };

    // 즉시 숨김 + 플랫폼이 style을 되돌리려 해도 재억제
    hide();
    _suppressObs = new MutationObserver(hide);
    _suppressObs.observe(modal, {
      attributes:      true,
      attributeFilter: ['style', 'class'],
    });
  }

  function _releaseSuppression() {
    if (_suppressObs) { _suppressObs.disconnect(); _suppressObs = null; }
    if (_suppressedModal) {
      _suppressedModal.style.removeProperty('display');
      _suppressedModal.style.removeProperty('visibility');
      _suppressedModal.style.removeProperty('pointer-events');
      _suppressedModal = null;
    }
  }

  /* ══════════════════════════════════════════════════════════════
     § 6.6 SPA 라우팅 감지 — 페이지 전환 시 억제 해제/재적용
     Next.js는 history.pushState를 내부적으로 래핑하므로 직접 훅 필요
     ══════════════════════════════════════════════════════════════ */
  (function _hookRouter() {
    const _origPush    = history.pushState;
    const _origReplace = history.replaceState;

    const onRoute = () => {
      if (!_isMainPage()) {
        // 메인 외 페이지 진입 → 억제 해제 (플랫폼 모달 정상 작동)
        _releaseSuppression();
      } else if (_suppressedModal) {
        // 메인으로 복귀 시 이미 열려있는 모달이 있으면 재억제
        _suppressModal(_suppressedModal);
      }
    };

    history.pushState = function (...a) {
      _origPush.apply(this, a); onRoute();
    };
    history.replaceState = function (...a) {
      _origReplace.apply(this, a); onRoute();
    };
    window.addEventListener('popstate', onRoute);
  })();

  /* ══════════════════════════════════════════════════════════════
     § 7. 직접 API 호출
     ══════════════════════════════════════════════════════════════ */
  function _fetchById(id) {
    return new Promise(resolve => {
      if (cache.has(id) && !cache.get(id)._partial) { resolve(cache.get(id)); return; }

      const fetchAs = (type) => _origFetch(`${API_BASE}/${type}/${id}`, { credentials: 'include' })
        .then(r => r.ok ? r.json() : Promise.reject());

      fetchAs('stories')
        .catch(() => fetchAs('characters'))
        .then(json => {
          _digestJson('direct_fetch', json);
          resolve(cache.get(id) ?? null);
        })
        .catch(() => resolve(null));
    });
  }

  /* ══════════════════════════════════════════════════════════════
     § 8. React Fiber에서 스토리 ID 추출
     ══════════════════════════════════════════════════════════════ */
  function _getIdFromFiber(el) {
    try {
      const fKey = Object.keys(el).find(k =>
        k.startsWith('__reactFiber') || k.startsWith('__reactInternalInstance'));
      if (!fKey) return null;
      let node = el[fKey];
      for (let i = 0; i < 80 && node; i++) {
        const props = node.memoizedProps ?? node.pendingProps ?? {};
        for (const k of ['characterId', 'storyId', 'sourceId', 'contentId', 'id', '_id', 'postId', 'itemId']) {
          if (props[k] && /^[a-f0-9]{24}$/.test(String(props[k]))) return String(props[k]);
        }
        for (const k of ['character', 'story', 'content', 'item', 'data', 'post',
                          'storyData', 'contentData', 'characterData', 'contentInfo']) {
          const obj = props[k];
          if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
            const id = obj.sourceId
                    ?? obj._id
                    ?? obj.id
                    ?? obj.storyId
                    ?? obj.characterId
                    ?? obj.contentId;
            if (id && /^[a-f0-9]{24}$/.test(String(id))) return String(id);
          }
        }
        node = node.return;
      }
    } catch (_) {}
    return null;
  }

  /* ══════════════════════════════════════════════════════════════
     § 9. 팝업 UI
     ══════════════════════════════════════════════════════════════ */
  let activePopup = null;
  let hideTimer   = null;

  function _showPopup(info, anchor) {
    _destroyPopup();
    clearTimeout(hideTimer);
    const pop = document.createElement('div');
    pop.id = 'crk-peek';
    pop.setAttribute('role', 'tooltip');
    pop.innerHTML = _buildHTML(info);
    pop.addEventListener('mouseenter', () => clearTimeout(hideTimer));
    pop.addEventListener('mouseleave', _scheduleHide);
    pop.addEventListener('click', e => {
      const btn = e.target.closest('.crk-expand-btn');
      if (!btn) return;
      const body = pop.querySelector('.crk-desc-body');
      if (!body) return;
      const open = body.style.display !== 'none';
      body.style.display = open ? 'none' : 'block';
      btn.textContent   = open ? '상세 설명 더보기 ▾' : '접기 ▴';
    });
    document.body.appendChild(pop);
    activePopup = pop;
    _position(pop, anchor);
  }

  function _buildHTML(info) {
    let h = '';

    h += `<div class="crk-title">${_esc(info.title)}`;
    if (info._partial) h += ` <span class="crk-partial">···</span>`;
    h += `</div>`;

    if (info.creator)
      h += `<div class="crk-creator">by ${_esc(info.creator)}</div>`;

    const hasBody = info.options?.length || info.intro || info.description || info.tags?.length;
    if (hasBody) h += `<hr class="crk-hr">`;

    if (info.options?.length) {
      h += `<div class="crk-options">`;
      info.options.forEach(o => { h += `<span class="crk-badge">${_esc(o)}</span>`; });
      h += `</div>`;
    }

    if (info.intro) {
      h += `<div class="crk-intro">${_md2html(info.intro)}</div>`;
    }

    if (info.description && info.description !== info.intro) {
      h += `<button class="crk-expand-btn">상세 설명 더보기 ▾</button>`;
      h += `<div class="crk-desc-body" style="display:none">${_md2html(info.description)}</div>`;
    }

    if (info.tags?.length) {
      h += `<div class="crk-tags">`;
      info.tags.slice(0, 10).forEach(t => { h += `<span class="crk-tag">${_esc(t)}</span>`; });
      h += `</div>`;
    }

    const hasStats = info.chatCount != null || info.likeCount != null || info.commentCount != null;
    if (hasStats) {
      h += `<div class="crk-stats">`;
      if (info.chatCount    != null) h += _chip('💬', info.chatCount);
      if (info.likeCount    != null) h += _chip('👍', info.likeCount);
      if (info.commentCount != null) h += _chip('💭', info.commentCount);
      h += `</div>`;
    }
    return h;
  }

  function _chip(icon, val) {
    return `<span class="crk-stat"><span class="crk-si">${icon}</span>${_esc(String(val))}</span>`;
  }

  function _md2html(text) {
    if (!text) return '';
    // 이미지는 이스케이프 전에 먼저 추출·치환
    const IMG_PLACEHOLDER = '\x00IMG\x00';
    const imgs = [];
    const pre = text.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_, alt, url) => {
      imgs.push(`<img src="${url}" alt="${_esc(alt)}" class="crk-md-img">`);
      return IMG_PLACEHOLDER;
    });

  // 나머지는 기존대로 이스케이프 후 마크다운 치환
  let html = _esc(pre)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g,     '<em>$1</em>')
    .replace(/\n/g,            '<br>');

  // 플레이스홀더를 실제 img 태그로 복원
  imgs.forEach(tag => { html = html.replace(_esc(IMG_PLACEHOLDER), tag); });
  return html;
}

  function _position(pop, anchor) {
    const ar = anchor.getBoundingClientRect();
    const vw = window.innerWidth;
    const sx = window.scrollX, sy = window.scrollY;

    let left, side;
    if (ar.right + BUBBLE_GAP + BUBBLE_W < vw - 8) {
      left = ar.right + sx + BUBBLE_GAP; side = 'left';
    } else {
      left = ar.left + sx - BUBBLE_W - BUBBLE_GAP; side = 'right';
    }
    left = Math.max(sx + 8, left);
    let top = ar.top + sy;

    pop.classList.remove('crk-arrow-left', 'crk-arrow-right');
    pop.classList.add(`crk-arrow-${side}`);
    pop.style.left = left + 'px';
    pop.style.top  = top  + 'px';

    requestAnimationFrame(() => {
      if (!pop.isConnected) return;
      const ph = pop.offsetHeight, vh = window.innerHeight;
      if (top + ph > sy + vh - 8)
        top = Math.max(sy + 8, sy + vh - ph - 8);
      pop.style.top = top + 'px';
      const arY = Math.max(16, Math.min(ph - 24, ar.top + ar.height / 2 + sy - top));
      pop.style.setProperty('--crk-arrow-y', arY + 'px');
    });
  }

  function _scheduleHide() { hideTimer = setTimeout(_destroyPopup, 200); }
  function _destroyPopup() { activePopup?.remove(); activePopup = null; }

  /* ══════════════════════════════════════════════════════════════
     § 10. 카드 후킹
     ══════════════════════════════════════════════════════════════ */
  let hoverTimer  = null;
  let hoveredCard = null;

  function _isCard(el) {
    return el.getAttribute?.('role') === 'button' &&
           el.getAttribute?.('tabindex') === '0' &&
           !!el.querySelector('img[alt="character_thumbnail"]');
  }

  async function _onEnter(e) {
    const card = e.currentTarget;
    hoveredCard = card;
    clearTimeout(hoverTimer);

    hoverTimer = setTimeout(async () => {
      if (hoveredCard !== card) return;

      let id = _getIdFromFiber(card);
      let domInfo = _parseCard(card);
      let info = null;

      if (!id && domInfo?.title) {
        for (const [cachedId, cachedInfo] of cache.entries()) {
          if (cachedInfo.title === domInfo.title && !cachedInfo._partial) {
            id = cachedId;
            break;
          }
        }
      }

      if (id && cache.has(id) && !cache.get(id)._partial) info = cache.get(id);
      if (!info && id) info = await _fetchById(id);
      if (!info) info = domInfo;

      if (!info || hoveredCard !== card) return;
      _showPopup(info, card);

      if (info._partial && id) {
        _fetchById(id).then(full => {
          if (full && !full._partial && activePopup?.isConnected && hoveredCard === card)
            activePopup.innerHTML = _buildHTML(full);
        });
      }
    }, HOVER_DELAY);
  }

  function _onLeave() {
    hoveredCard = null;
    clearTimeout(hoverTimer);
    _scheduleHide();
  }

  const _hookedCards = new WeakSet();

  function _hookCard(el) {
    if (!_isCard(el) || _hookedCards.has(el)) return;
    _hookedCards.add(el);
    el.dataset.crkPeek = '1';
    el.addEventListener('mouseenter', _onEnter);
    el.addEventListener('mouseleave',  _onLeave);
  }

  function _hookAll(root) {
    if (_isCard(root)) _hookCard(root);
    const q = root?.querySelectorAll ? root : document;
    q.querySelectorAll('[role="button"][tabindex="0"]').forEach(_hookCard);
  }

  _hookAll(document);
  new MutationObserver(muts => {
    muts.forEach(mut => {
      mut.addedNodes.forEach(node => {
        if (node.nodeType !== 1) return;
        _hookAll(node);
      });
    });
  }).observe(document.documentElement, { childList: true, subtree: true });

  /* ══════════════════════════════════════════════════════════════
     § 11. 스타일 (말풍선)
     ══════════════════════════════════════════════════════════════ */
  const _CSS = `
:root {
  --crk-bg:     #13131f;
  --crk-border: rgba(255,255,255,.12);
  --crk-text1:  #eef0ff;
  --crk-text2:  #b0b4cc;
  --crk-text3:  #6a6a90;
  --crk-accent: #7c74ff;
  --crk-arrow-y: 20px;
}
#crk-peek {
  position: absolute;
  z-index: 1000000;
  width: ${BUBBLE_W}px;
  max-width: calc(100vw - 24px);
  max-height: ${BUBBLE_MAX_H}px;
  overflow-y: auto;
  background: var(--crk-bg);
  border: 1px solid var(--crk-border);
  border-radius: 14px;
  padding: 14px 16px 12px;
  box-shadow: 0 4px 12px rgba(0,0,0,.5), 0 16px 48px rgba(0,0,0,.55);
  color: var(--crk-text1);
  font-family: inherit;
  font-size: 13px;
  line-height: 1.5;
  pointer-events: auto;
  animation: crkIn .14s cubic-bezier(.22,1,.36,1) both;
  scrollbar-width: thin;
  scrollbar-color: rgba(255,255,255,.15) transparent;
}
#crk-peek::-webkit-scrollbar { width: 4px; }
#crk-peek::-webkit-scrollbar-thumb { background: rgba(255,255,255,.15); border-radius: 2px; }
@keyframes crkIn {
  from { opacity:0; transform:scale(.96) translateY(4px); }
  to   { opacity:1; transform:scale(1)   translateY(0); }
}
#crk-peek::before {
  content:''; position:absolute;
  top:var(--crk-arrow-y,20px); margin-top:-8px;
  width:0; height:0; pointer-events:none;
}
#crk-peek.crk-arrow-left::before {
  left:-9px;
  border-top:8px solid transparent; border-bottom:8px solid transparent;
  border-right:9px solid var(--crk-bg);
  filter:drop-shadow(-1px 0 1px rgba(0,0,0,.35));
}
#crk-peek.crk-arrow-right::before {
  right:-9px;
  border-top:8px solid transparent; border-bottom:8px solid transparent;
  border-left:9px solid var(--crk-bg);
  filter:drop-shadow(1px 0 1px rgba(0,0,0,.35));
}
#crk-peek .crk-title { font-size:14px; font-weight:700; color:var(--crk-text1); margin:0 0 3px; line-height:1.35; }
#crk-peek .crk-partial { font-size:11px; font-weight:400; color:var(--crk-text3); margin-left:2px; }
#crk-peek .crk-creator { font-size:11px; color:var(--crk-text3); }
#crk-peek .crk-hr { border:none; border-top:1px solid var(--crk-border); margin:10px 0; }
#crk-peek .crk-options { display:flex; flex-wrap:wrap; gap:4px; margin-bottom:9px; }
#crk-peek .crk-badge {
  display:inline-flex; align-items:center; font-size:10.5px;
  padding:2px 7px; border-radius:5px; border:1px solid var(--crk-border);
  color:var(--crk-text3); white-space:nowrap;
  max-width:230px; overflow:hidden; text-overflow:ellipsis;
}
#crk-peek .crk-intro {
  font-size:13px; font-weight:500; color:var(--crk-text1);
  margin-bottom:9px; line-height:1.55;
}
#crk-peek .crk-intro strong { font-weight:700; }
#crk-peek .crk-intro em { font-style:italic; }
#crk-peek .crk-expand-btn {
  display:block; width:100%; text-align:left;
  font-size:11px; color:var(--crk-accent);
  background:none; border:none; padding:0 0 8px;
  cursor:pointer; opacity:.85;
}
#crk-peek .crk-expand-btn:hover { opacity:1; }
#crk-peek .crk-desc-body {
  font-size:12px; line-height:1.65; color:var(--crk-text2);
  margin-bottom:9px; border-top:1px solid var(--crk-border); padding-top:8px;
}
#crk-peek .crk-desc-body strong { font-weight:700; color:var(--crk-text1); }
#crk-peek .crk-desc-body em { font-style:italic; }
#crk-peek .crk-tags { display:flex; flex-wrap:wrap; gap:3px 6px; margin-bottom:9px; }
#crk-peek .crk-tag { font-size:11px; color:var(--crk-accent); opacity:.9; }
#crk-peek .crk-stats { display:flex; gap:14px; border-top:1px solid var(--crk-border); padding-top:9px; }
#crk-peek .crk-stat { display:flex; align-items:center; gap:4px; font-size:11px; color:var(--crk-text3); }
#crk-peek .crk-si { font-size:12px; line-height:1; }
#crk-peek .crk-md-img {
  max-width: 100%; border-radius: 6px; margin: 6px 0;
  display: block;
}
`;

  function _injectCSS() {
    if (document.getElementById('crk-peek-css')) return;
    const s = document.createElement('style');
    s.id = 'crk-peek-css'; s.textContent = _CSS;
    (document.head ?? document.documentElement).appendChild(s);
  }
  if (document.head) _injectCSS();
  else document.addEventListener('DOMContentLoaded', _injectCSS);

  /* ══════════════════════════════════════════════════════════════
     § 12. 유틸
     ══════════════════════════════════════════════════════════════ */
  function _esc(s) {
    return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }
  function _fmt(n) {
    if (n == null) return null;
    const v = Number(n);
    if (isNaN(v)) return String(n);
    if (v >= 1_000_000) return (v/1e6).toFixed(1).replace(/\.0$/,'')+'M';
    if (v >= 1_000)     return (v/1e3).toFixed(1).replace(/\.0$/,'')+'K';
    return String(v);
  }

})();
