// ==UserScript==
// @name         Crack Image Token Renderer
// @namespace    http://tampermonkey.net/
// @version      1.0.1
// @description  {{분류::상황}} 및 {{img::분류::상황}} 토큰과 igx.kr URL을 이미지로 변환합니다.
// @author       -
// @match        https://crack.wrtn.ai/*
// @grant        GM_addStyle
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  // ============================================================
  //  ID / 상수
  // ============================================================
  const STORAGE_KEY = 'crk-img-token-settings';
  const BTN_ID      = 'crk-itr-btn';
  const OVERLAY_ID  = 'crk-itr-overlay';
  const FB_ATTR     = 'data-crk-itr-fb';   // 폴백 span 마킹 (무한 루프 방지)
  const SKIP_TAG    = new Set(['script', 'style', 'input', 'textarea', 'select', 'noscript']);

  // ============================================================
  //  기본 설정값
  // ============================================================
  const DEFAULTS = {
    urlTemplate : 'https://raw.githubusercontent.com/사용자명/{cat}/refs/heads/main/{sit}.png',
    maxWidth    : '100%',
    onError     : 'token',   // 'token' | 'hide'
    pollMs      : 1000,       // 전체 스캔 주기 (ms)
  };

  // ============================================================
  //  설정 로드 / 저장
  // ============================================================
  function loadSettings() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return { ...DEFAULTS, ...JSON.parse(raw) };
    } catch (_) {}
    return { ...DEFAULTS };
  }
  function saveSettings(s) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(s)); } catch (_) {}
  }

  let 설정 = loadSettings();

  // ============================================================
  //  스타일
  // ============================================================
  GM_addStyle(`
    #${BTN_ID} {
      color: hsl(var(--foreground));
      background-color: hsl(var(--background));
      font-weight: 500;
      font-size: 14px;
      border: solid 1px hsl(var(--border));
      border-radius: 8px;
      padding: .5em .625em .5em .75em;
      margin-right: 10px;
      cursor: pointer;
      white-space: nowrap;
      line-height: 1;
    }
    #${BTN_ID}:hover { background-color: var(--accent); }
    @media screen and (max-width: 600px) { #${BTN_ID} { display: none; } }

    #${OVERLAY_ID} {
      position: fixed; inset: 0; z-index: 99998;
      background: rgba(0,0,0,.45);
      display: flex; align-items: center; justify-content: center;
    }
    #${OVERLAY_ID} .crk-itr-modal {
      position: relative; z-index: 99999;
      background: hsl(var(--background)); color: hsl(var(--foreground));
      border: 1px solid hsl(var(--border)); border-radius: 12px;
      padding: 24px; width: 440px; max-width: 92vw;
      display: flex; flex-direction: column; gap: 18px; font-size: 14px;
    }
    #${OVERLAY_ID} .crk-itr-modal h2 { margin: 0; font-size: 16px; font-weight: 700; }
    #${OVERLAY_ID} .crk-itr-field { display: flex; flex-direction: column; gap: 6px; }
    #${OVERLAY_ID} .crk-itr-label { font-size: 12px; opacity: .6; font-weight: 600; }
    #${OVERLAY_ID} .crk-itr-hint  { font-size: 11px; opacity: .45; margin-top: -2px; }
    #${OVERLAY_ID} input[type="text"] {
      width: 100%; box-sizing: border-box;
      background: hsl(var(--background)); color: hsl(var(--foreground));
      border: 1px solid hsl(var(--border)); border-radius: 6px;
      padding: 7px 10px; font-size: 12px;
      font-family: 'Consolas','Courier New',monospace; outline: none;
    }
    #${OVERLAY_ID} input[type="text"]:focus { border-color: hsl(var(--foreground)/.4); }
    #${OVERLAY_ID} .crk-itr-radio-group { display: flex; gap: 16px; }
    #${OVERLAY_ID} .crk-itr-radio-group label { display: flex; align-items: center; gap: 6px; cursor: pointer; font-size: 13px; }
    #${OVERLAY_ID} .crk-itr-poll-row { display: flex; align-items: center; gap: 10px; }
    #${OVERLAY_ID} input[type="range"] { flex: 1; }
    #${OVERLAY_ID} .crk-itr-btn-row {
      display: flex; justify-content: flex-end; gap: 8px;
      padding-top: 4px; border-top: 1px solid hsl(var(--border));
    }
    #${OVERLAY_ID} .crk-itr-btn-row button {
      padding: 7px 18px; border-radius: 8px; font-size: 13px;
      font-weight: 500; cursor: pointer; border: 1px solid hsl(var(--border));
    }
    #${OVERLAY_ID} .crk-itr-save   { background: hsl(var(--foreground)); color: hsl(var(--background)); }
    #${OVERLAY_ID} .crk-itr-cancel { background: transparent; color: hsl(var(--foreground)); }
    #${OVERLAY_ID} .crk-itr-save:hover   { opacity: .85; }
    #${OVERLAY_ID} .crk-itr-cancel:hover { background: hsl(var(--foreground)/.06); }
  `);

  // ============================================================
  //  설정 모달
  // ============================================================
  function openModal() {
    if (document.getElementById(OVERLAY_ID)) return;
    const overlay = document.createElement('div');
    overlay.id = OVERLAY_ID;

    const modal = document.createElement('div');
    modal.className = 'crk-itr-modal';

    const safe = s => s.replace(/&/g,'&amp;').replace(/"/g,'&quot;');
    modal.innerHTML = `
      <h2>🖼 Image Token Renderer</h2>

      <div class="crk-itr-field">
        <span class="crk-itr-label">URL 템플릿</span>
        <span class="crk-itr-hint">{cat} = 분류, {sit} = 상황</span>
        <input type="text" id="crk-itr-url" value="${safe(설정.urlTemplate)}" />
      </div>

      <div class="crk-itr-field">
        <span class="crk-itr-label">이미지 최대 너비 (CSS)</span>
        <input type="text" id="crk-itr-width" value="${safe(설정.maxWidth)}" />
      </div>

      <div class="crk-itr-field">
        <span class="crk-itr-label">로드 실패 시</span>
        <div class="crk-itr-radio-group">
          <label><input type="radio" name="crk-itr-onerr" value="token" ${설정.onError==='token'?'checked':''}> 원문 복원</label>
          <label><input type="radio" name="crk-itr-onerr" value="hide"  ${설정.onError==='hide' ?'checked':''}> 숨김</label>
        </div>
      </div>

      <div class="crk-itr-field">
        <span class="crk-itr-label">스캔 주기: <span id="crk-itr-poll-val">${설정.pollMs}</span>ms</span>
        <span class="crk-itr-hint">낮을수록 빠르게 반응하지만 CPU 사용량 증가. 기본 500ms.</span>
        <div class="crk-itr-poll-row">
          <input type="range" id="crk-itr-poll" min="200" max="2000" step="100" value="${설정.pollMs}">
        </div>
      </div>

      <div class="crk-itr-btn-row">
        <button class="crk-itr-cancel">취소</button>
        <button class="crk-itr-save">저장</button>
      </div>
    `;

    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    const pollSlider = modal.querySelector('#crk-itr-poll');
    const pollLabel  = modal.querySelector('#crk-itr-poll-val');
    pollSlider.addEventListener('input', () => { pollLabel.textContent = pollSlider.value; });

    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
    modal.querySelector('.crk-itr-cancel').addEventListener('click', () => overlay.remove());
    modal.querySelector('.crk-itr-save').addEventListener('click', () => {
      const newUrl   = modal.querySelector('#crk-itr-url').value.trim();
      const newWidth = modal.querySelector('#crk-itr-width').value.trim();
      const newErr   = modal.querySelector('input[name="crk-itr-onerr"]:checked')?.value ?? 'token';
      const newPoll  = parseInt(pollSlider.value, 10) || 500;
      if (newUrl) {
        설정 = { urlTemplate: newUrl, maxWidth: newWidth || '100%', onError: newErr, pollMs: newPoll };
        saveSettings(설정);
        restartPoller();
      }
      overlay.remove();
    });
  }

  // ============================================================
  //  버튼 주입 — Chasm Ignitor .burner-button 좌측
  // ============================================================
  function injectButton() {
    if (document.getElementById(BTN_ID)) return;
    const ignitorBtn = document.querySelector('.burner-button');
    if (!ignitorBtn?.parentElement) return;
    const btn = document.createElement('button');
    btn.id = BTN_ID;
    btn.textContent = '🖼 Image Token';
    btn.addEventListener('click', openModal);
    ignitorBtn.parentElement.insertBefore(btn, ignitorBtn);
  }

  const btnObserver = new MutationObserver(() => {
    if (!document.getElementById(BTN_ID) && document.querySelector('.burner-button')) injectButton();
  });
  btnObserver.observe(document.body, { childList: true, subtree: true });
  setTimeout(injectButton, 600);

  // ============================================================
  //  정규식 (수정됨)
  // ============================================================
  // 그룹 [1][2] → {{cat::sit}} 또는 {{img::cat::sit}}, 그룹 [3] → igx.kr URL, 그룹 [4] → 확장자 기반 URL
  const COMBINED_RE = /\{\{(?:img::)?([^:{}\s]+)::([^:{}\s}]+)\}\}|(https?:\/\/igx\.kr\/[^\s<>"')\]]+)|(https?:\/\/[^\s<>"')\]]+\.(?:png|jpe?g|gif|webp|avif|svg)(?:[?#][^\s<>"')\]]*)?)/gi;

  function hasMatch(text) {
    COMBINED_RE.lastIndex = 0;
    const r = COMBINED_RE.test(text);
    COMBINED_RE.lastIndex = 0;
    return r;
  }

  function buildUrl(cat, sit) {
    return 설정.urlTemplate
      .replace('{cat}', encodeURIComponent(cat))
      .replace('{sit}', encodeURIComponent(sit));
  }

  function makeImg(src, fallbackText) {
    const img = document.createElement('img');
    img.src                = src;
    img.alt                = fallbackText;
    img.title              = fallbackText;
    img.style.maxWidth     = 설정.maxWidth;
    img.style.borderRadius = '8px';
    img.style.display      = 'inline-block';
    img.style.verticalAlign = 'middle';

    img.addEventListener('error', () => {
      if (설정.onError === 'token') {
        const span = document.createElement('span');
        span.setAttribute(FB_ATTR, '1');   // 폴링이 이 span을 재변환하지 않도록 마킹
        span.textContent      = fallbackText;
        span.style.opacity    = '0.55';
        span.style.fontFamily = 'monospace';
        span.style.fontSize   = '0.85em';
        img.replaceWith(span);
      } else {
        img.remove();
      }
    }, { once: true });

    return img;
  }

  // ============================================================
  //  핵심: 텍스트 노드 변환
  // ============================================================
  function processTextNode(textNode) {
    if (!textNode.parentNode) return;         // 이미 DOM에서 분리됨
    const text = textNode.textContent;
    if (!hasMatch(text)) return;

    COMBINED_RE.lastIndex = 0;
    const frag = document.createDocumentFragment();
    let lastIndex = 0, match;

    while ((match = COMBINED_RE.exec(text)) !== null) {
      if (match.index > lastIndex) {
        frag.appendChild(document.createTextNode(text.slice(lastIndex, match.index)));
      }

      let src, label;
      if (match[1] && match[2]) {
        src   = buildUrl(match[1], match[2]);
        label = match[0];
      } else {
        src   = match[3] ?? match[4];
        label = src;
      }

      frag.appendChild(makeImg(src, label));
      lastIndex = COMBINED_RE.lastIndex;
    }

    if (lastIndex < text.length) {
      frag.appendChild(document.createTextNode(text.slice(lastIndex)));
    }

    if (textNode.parentNode) {
      textNode.parentNode.replaceChild(frag, textNode);
    }
  }

  // ============================================================
  //  전체 스캔 — document.body를 직접 순회
  //  컨테이너 클래스에 의존하지 않으므로 어떤 구조에서도 작동
  // ============================================================
  function scanAll() {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        // FB_ATTR 마킹된 span 내부는 재처리 금지 (무한 루프 방지)
        if (node.parentElement?.hasAttribute?.(FB_ATTR)) return NodeFilter.FILTER_SKIP;

        const 꼬리표 = node.parentElement?.tagName?.toLowerCase();
        if (SKIP_TAG.has(꼬리표)) return NodeFilter.FILTER_REJECT;

        return hasMatch(node.textContent)
          ? NodeFilter.FILTER_ACCEPT
          : NodeFilter.FILTER_SKIP;
      }
    });

    const nodes = [];
    let n;
    while ((n = walker.nextNode())) nodes.push(n);
    nodes.forEach(processTextNode);
  }

  // ============================================================
  //  폴링 루프
  // ============================================================
  let pollTimer = null;

  function restartPoller() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(scanAll, 설정.pollMs);
  }

  restartPoller();

  // ============================================================
  //  SPA 라우팅 변경 감지 (버튼 재주입)
  // ============================================================
  let lastPath = location.pathname;
  setInterval(() => {
    if (location.pathname !== lastPath) {
      lastPath = location.pathname;
      setTimeout(injectButton, 800);
    }
  }, 500);

})();
