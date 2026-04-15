// ==UserScript==
// @name         Crack 페르소나 순서 변경
// @namespace    http://tampermonkey.net/
// @version      1.0.0
// @description  crack.wrtn.ai 페르소나 순서 드래그 변경 + 페르소나 선택을 버튼 행 위로 이식
// @match        https://crack.wrtn.ai/*
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  const STORAGE_KEY   = 'crack_persona_order';
  const MOVED_ATTR    = 'data-crk-persona-moved';

  // ── Storage ───────────────────────────────────────────────────
  function getOrder() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); }
    catch { return []; }
  }
  function saveOrder(names) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(names));
  }

  // ── 공통 유틸 ─────────────────────────────────────────────────
  function isVisible(el) {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }

  function getPersonaName(itemEl) {
    return itemEl.querySelector('p.typo-text-base_leading-none_semibold')
      ?.textContent?.trim() ?? '';
  }

  function getPersonaItems(wrapperEl) {
    const byCursor = Array.from(
      wrapperEl.querySelectorAll(':scope > div[cursor="pointer"]')
    );
    return byCursor.length
      ? byCursor
      : Array.from(wrapperEl.querySelectorAll(':scope > div')).filter(
          d => d.querySelector('p.typo-text-base_leading-none_semibold')
        );
  }

  function findItemWrapper(root) {
    const first = root.querySelector('div[cursor="pointer"]');
    return first?.parentElement ?? null;
  }

  // ── A. 채팅 모달 (대화 프로필 팝업) ──────────────────────────
  function findChatModal() {
    for (const p of document.querySelectorAll('p.typo-text-xl_leading-none_semibold')) {
      if (p.textContent.trim() === '대화 프로필') {
        const modal = p.closest('div[width="444px"]');
        if (modal && isVisible(modal)) return modal;
      }
    }
    return null;
  }

  // ── B. setting/chat 목록 페이지 ──────────────────────────────
  function findSettingPage() {
    const page = document.getElementById('setting-page');
    if (!page || !isVisible(page)) return null;
    return findItemWrapper(page);
  }

  // ── 순서 복원 ─────────────────────────────────────────────────
  let innerObs = null;

  function applySavedOrder(wrapperEl) {
    const saved = getOrder();
    if (!saved.length) return;
    const items = getPersonaItems(wrapperEl);
    if (!items.length) return;
    const map = Object.fromEntries(items.map(el => [getPersonaName(el), el]));
    const sorted = [
      ...saved.filter(n => map[n]).map(n => map[n]),
      ...items.filter(el => !saved.includes(getPersonaName(el))),
    ];
    innerObs?.disconnect();
    sorted.forEach(el => wrapperEl.appendChild(el));
    reconnectInnerObs(wrapperEl);
  }

  function reconnectInnerObs(wrapperEl) {
    innerObs?.disconnect();
    innerObs = new MutationObserver(() => {
      const newItems = getPersonaItems(wrapperEl).filter(
        el => !el.querySelector('.crack-drag-handle')
      );
      if (!newItems.length) return;
      applySavedOrder(wrapperEl);
      getPersonaItems(wrapperEl).forEach(i => injectDragHandle(i, wrapperEl));
    });
    innerObs.observe(wrapperEl, { childList: true });
  }

  // ── 드래그 핸들 ───────────────────────────────────────────────
  let dragSrc = null;

  function injectDragHandle(item, wrapperEl) {
    if (item.querySelector('.crack-drag-handle')) return;
    const handle = Object.assign(document.createElement('span'), {
      className: 'crack-drag-handle',
      textContent: '⠿',
      title: '드래그하여 순서 변경',
    });
    Object.assign(handle.style, {
      cursor: 'grab', fontSize: '17px',
      color: 'var(--icon_primary, #888)', opacity: '0.4',
      padding: '0 8px 0 2px', flexShrink: '0',
      userSelect: 'none', transition: 'opacity .15s', alignSelf: 'center',
    });
    handle.addEventListener('mouseenter', () => { handle.style.opacity = '1'; });
    handle.addEventListener('mouseleave', () => { handle.style.opacity = '0.4'; });
    handle.addEventListener('mousedown', e => { e.stopPropagation(); item.draggable = true; });
    document.addEventListener('mouseup', () => { item.draggable = false; }, { capture: true });

    item.addEventListener('dragstart', e => {
      if (!item.draggable) { e.preventDefault(); return; }
      dragSrc = item;
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', '');
      requestAnimationFrame(() => { item.style.opacity = '0.35'; });
    });
    item.addEventListener('dragend', () => {
      item.style.opacity = '';
      item.style.outline = '';
      item.draggable = false;
      dragSrc = null;
      saveOrder(getPersonaItems(wrapperEl).map(getPersonaName));
    });
    item.addEventListener('dragover', e => { e.preventDefault(); });
    item.addEventListener('dragenter', e => {
      e.preventDefault();
      if (dragSrc && dragSrc !== item) item.style.outline = '2px solid #9c27b0';
    });
    item.addEventListener('dragleave', () => { item.style.outline = ''; });
    item.addEventListener('drop', e => {
      e.preventDefault(); e.stopPropagation();
      item.style.outline = '';
      if (!dragSrc || dragSrc === item) return;
      const items = getPersonaItems(wrapperEl);
      if (items.indexOf(dragSrc) < items.indexOf(item))
        wrapperEl.insertBefore(dragSrc, item.nextSibling);
      else
        wrapperEl.insertBefore(dragSrc, item);
    });

    const nameRow = item.querySelector('div[display="flex"]') ?? item.firstElementChild;
    if (nameRow) nameRow.insertBefore(handle, nameRow.firstChild);
  }

  // ── C. Combobox 드롭다운 순서 반영 ───────────────────────────
  function reorderListbox(listboxEl) {
    const saved = getOrder();
    if (!saved.length) return;
    const options = Array.from(listboxEl.querySelectorAll('[role="option"]'));
    if (!options.length) return;
    const getName = el => {
      const spans = el.querySelectorAll('span');
      for (const s of spans) { const t = s.textContent.trim(); if (t) return t; }
      return el.textContent.trim().split('\n')[0].trim();
    };
    const map = Object.fromEntries(options.map(el => [getName(el), el]));
    const sorted = [
      ...saved.filter(n => map[n]).map(n => map[n]),
      ...options.filter(el => !saved.includes(getName(el))),
    ];
    const parent = options[0].parentElement;
    if (!parent) return;
    sorted.forEach(el => parent.appendChild(el));
  }

  function watchRadixPortals() {
    new MutationObserver(mutations => {
      for (const m of mutations) {
        for (const node of m.addedNodes) {
          if (node.nodeType !== 1) continue;
          const listboxes = node.matches('[role="listbox"]')
            ? [node]
            : Array.from(node.querySelectorAll('[role="listbox"]'));
          for (const lb of listboxes) {
            const lbId = lb.id;
            const combobox = lbId ? document.querySelector(`[aria-controls="${lbId}"]`) : null;
            const isPersona = combobox
              ? isPersonaComboboxEl(combobox)
              : (() => {
                  const saved = getOrder();
                  if (!saved.length) return false;
                  const opts = Array.from(lb.querySelectorAll('[role="option"]'));
                  const names = opts.map(o => o.textContent.trim().split('\n')[0].trim());
                  return saved.some(n => names.includes(n));
                })();
            if (isPersona) {
              setTimeout(() => reorderListbox(lb), 30);
            }
          }
        }
      }
    }).observe(document.body, { childList: true, subtree: true });
  }

  function isPersonaComboboxEl(btn) {
    const row = btn.parentElement;
    if (!row) return false;
    for (const p of row.querySelectorAll('p')) {
      if (p.textContent.trim() === '대화 프로필') return true;
    }
    return false;
  }

  // ── D. 페르소나 행 이식 ───────────────────────────────────────
  // 핵심 전략: 가짜 드롭다운 없이, 실제 대화 프로필 행(label + combobox)을
  // DOM에서 잘라내어 버튼 행 바로 위에 이식.
  // React 재렌더로 원위치 복귀 시 MutationObserver가 감지하여 재이식.

  // 이식되지 않은 페르소나 행 탐색 (root 내에서)
  function findPersonaRow(root) {
    const all = root.querySelectorAll('p');
    for (const p of all) {
      if (p.textContent.trim() !== '대화 프로필') continue;
      const row = p.parentElement;
      if (!row) continue;
      if (row.getAttribute(MOVED_ATTR) === '1') continue; // 이미 이식된 행 제외
      if (row.querySelector('button[role="combobox"]')) return row;
    }
    return null;
  }

  // 버튼 행 탐색: 이어하기/새로하기/플레이 버튼을 포함하는 flex-row
  const ACTION_KEYWORDS = ['이어하기', '새로하기', '플레이'];

  function findActionButtonRow(root) {
    for (const btn of root.querySelectorAll('button')) {
      if (!isVisible(btn)) continue;
      if (!ACTION_KEYWORDS.includes(btn.textContent.trim())) continue;
      let el = btn.parentElement;
      while (el && el !== document.body) {
        if (el.classList.contains('flex-row')) return el;
        el = el.parentElement;
      }
    }
    return null;
  }

  // 이식 실행
  function transplantPersonaRow(root) {
    const buttonRow = findActionButtonRow(root);
    if (!buttonRow) return;

    // 이미 이식되어 있는지 확인
    const prev = buttonRow.previousElementSibling;
    if (prev && prev.getAttribute(MOVED_ATTR) === '1') {
      // 이식된 행이 여전히 유효한지 확인 (combobox 존재 여부)
      if (prev.querySelector('button[role="combobox"]')) return; // 정상
      // combobox 없음 → React가 이 노드를 재사용 안 한 것 → 제거 후 재이식
      prev.remove();
    }

    const personaRow = findPersonaRow(root);
    if (!personaRow) return;

    // 스타일 조정: 버튼바와 같은 좌우 패딩, 구분선
    personaRow.style.setProperty('padding', '10px 20px 8px', 'important');
    personaRow.style.setProperty('border-top', '1px solid var(--border-divider_primary, var(--outline_secondary, #2a2a2a))', 'important');

    personaRow.setAttribute(MOVED_ATTR, '1');
    buttonRow.parentElement?.insertBefore(personaRow, buttonRow);
  }

  // 스크롤 컨테이너 감시: React 재렌더 시 페르소나 행이 원위치로 복귀하면 재이식
  const watchedRoots = new WeakSet();

  function watchForRewire(root) {
    if (watchedRoots.has(root)) return;
    watchedRoots.add(root);

    // 감시 대상: 스크롤 컨테이너(모달) 또는 root 자체(페이지)
    const scrollBody = root.querySelector('[overflow="auto"]')
      ?? root.querySelector('.character-info-modal-content-body')
      ?? root;

    new MutationObserver(() => {
      // 이식되지 않은 페르소나 행이 스크롤 컨테이너 안에 새로 나타났으면 재이식
      if (findPersonaRow(scrollBody)) {
        transplantPersonaRow(root);
      }
    }).observe(scrollBody, { childList: true, subtree: true });
  }

  // 컨텍스트별 이식 진입점
  function transplantInContext(root) {
    transplantPersonaRow(root);
    watchForRewire(root);
  }

  // ── 주입 (A+B+D 컨텍스트) ─────────────────────────────────────
  const injectedWrappers = new WeakSet();

  function processWrapper(wrapperEl) {
    if (!wrapperEl) return;
    applySavedOrder(wrapperEl);
    getPersonaItems(wrapperEl).forEach(i => injectDragHandle(i, wrapperEl));
    if (!injectedWrappers.has(wrapperEl)) {
      injectedWrappers.add(wrapperEl);
      reconnectInnerObs(wrapperEl);
    }
  }

  function inject() {
    // A. 채팅 모달
    const chatModal = findChatModal();
    if (chatModal) processWrapper(findItemWrapper(chatModal));

    // B. setting/chat 목록 페이지
    const settingWrapper = findSettingPage();
    if (settingWrapper) processWrapper(settingWrapper);

    // D. 페르소나 행 이식
    const webModal = document.getElementById('web-modal');
    if (webModal && isVisible(webModal)) {
      // 모달 내부: 스크롤 컨테이너와 버튼바가 모두 webModal 안에 있음
      transplantInContext(webModal);
    } else {
      // 페이지 (비모달)
      transplantInContext(document.body);
    }
  }

  // ── Observer 설정 ─────────────────────────────────────────────
  const webModal = document.getElementById('web-modal');
  if (webModal) {
    new MutationObserver(() => inject())
      .observe(webModal, { childList: true, subtree: true, attributes: true });
  }
  new MutationObserver(() => inject())
    .observe(document.body, { childList: true, subtree: false });

  // C. Radix 포털 감시
  watchRadixPortals();

  // 안전망 폴링
  setInterval(inject, 500);

})();
