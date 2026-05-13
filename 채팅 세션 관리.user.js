// ==UserScript==
// @name         채팅 세션 관리
// @namespace    https://github.com/workforomg/Utill
// @version      3.0.0
// @description  보관함/채팅 목록 탭 분리 + 검색/메모/이어하기/이름 애니메이션 통합
// @match        https://crack.wrtn.ai/*
// @grant        GM_addStyle
// @run-at       document-end
// ==/UserScript==

(function () {
    'use strict';

    /* ================================================================
       상수 / 셀렉터
    ================================================================ */
    const MEMO_KEY  = 'crack_session_memos_v1';
    const CACHE_KEY = 'crack_session_cache_v1';
    const HIER_KEY  = 'crack_archive_parent_v1'; // {자식이름: 부모이름}
    const ANAME_KEY = 'crack_archive_names_v1';  // 보관함 이름 캐시 (string[])

    const SEL_LINK     = 'a[href*="/stories/"][href*="/episodes/"]';
    const SEL_NAME     = 'span.typo-text-sm_leading-none_medium';
    const SEL_MORE_BTN = 'button[aria-label="채팅방 메뉴"]';
    const SEL_VSCROLL  = '[data-testid="virtuoso-scroller"]';
    const SEL_VLIST    = '[data-testid="virtuoso-item-list"]';

    /* ================================================================
       0. 데이터 레이어
    ================================================================ */

    // ── 세션 캐시 ───────────────────────────────────────────────────
    function getCache()               { try { return JSON.parse(localStorage.getItem(CACHE_KEY)) || {}; } catch { return {}; } }
    function cacheSession(href, title) {
        if (!href || !title) return;
        const c = getCache();
        if (!c[href] || c[href].title !== title) {
            c[href] = { title, ts: Date.지금() };
            localStorage.setItem(CACHE_KEY, JSON.stringify(c));
        }
    }

    // ── 메모 ────────────────────────────────────────────────────────
    function getMemo(href) { try { return (JSON.parse(localStorage.getItem(MEMO_KEY)) || {})[href] || ''; } catch { return ''; } }
    function saveMemo(href, txt) {
        try {
            const m = JSON.parse(localStorage.getItem(MEMO_KEY)) || {};
            if (txt.trim()) m[href] = txt.trim(); else delete m[href];
            localStorage.setItem(MEMO_KEY, JSON.stringify(m));
        } catch {}
    }

    // ── 보관함 계층 ─────────────────────────────────────────────────
    function getHierarchy()              { try { return JSON.parse(localStorage.getItem(HIER_KEY)) || {}; } catch { return {}; } }
    function saveHierarchy(h)            { localStorage.setItem(HIER_KEY, JSON.stringify(h)); }
    function getArchiveParent(name)      { return getHierarchy()[name] || null; }
    function setArchiveParent(name, par) {
        const h = getHierarchy();
        if (par) h[name] = par; else delete h[name];
        saveHierarchy(h);
    }
    function getArchiveChildren(par) {
        return Object.entries(getHierarchy()).filter(([, v]) => v === par).map(([k]) => k);
    }
    // DOM에서 현재 보이는 보관함 이름 수집 (이동 모달용)
    function collectVisibleArchiveNames() {
        return [...document.querySelectorAll(`${SEL_VLIST} ${SEL_NAME}`)]
            .map(s => s.textContent.trim()).filter(Boolean);
    }
    // 보관함 이름 캐시 — archive-list/edit 뷰의 보관함 버튼에서만 수집
    function getArchiveNames()  { try { return JSON.parse(localStorage.getItem(ANAME_KEY)) || []; } catch { return []; } }
    function cacheArchiveNames() {
        // 보관함 버튼(button.flex.items-center.gap-2)의 이름만 수집 (채팅 세션 a 태그 제외)
        const fresh = [...document.querySelectorAll(`${SEL_VLIST} div[data-index] button.flex.items-center ${SEL_NAME}`)]
            .map(s => s.textContent.trim()).filter(Boolean);
        if (!fresh.length) return;
        // 계층에 이미 등록된 이름(숨겨진 하위 보관함)도 포함하여 유지
        const h = getHierarchy();
        const fromHier = [...new Set([...Object.keys(h), ...Object.values(h)])];
        // 현재 보이는 것 + 계층 데이터 합산; 이전 캐시는 사용 안 함 (이름 변경 대응)
        const merged = [...new Set([...fresh, ...fromHier])];
        localStorage.setItem(ANAME_KEY, JSON.stringify(merged));
    }

    /* ================================================================
       1. 뷰 감지 (5종)
    ================================================================ */
    function detectView() {
        // 편집 종료 버튼이 있으면 편집 모드 (가장 먼저 체크)
        if (document.querySelector('button[aria-label="편집 종료"]')) return 'archive-edit';
        // 보관함 전체보기 버튼이 있으면 메인 뷰
        if (document.querySelector('button[aria-label="보관함 전체보기"]')) return 'main';
        // 뒤로가기가 없으면 메인 (fallback)
        const backBtn = document.querySelector('button[aria-label="뒤로가기"]');
        if (!backBtn) return 'main';
        // 헤더 타이틀로 전체 보관함 / 개별 보관함 구분
        const titleSpan = document.querySelector('div.shrink-0.flex.items-center.gap-2.h-12 span.flex-1');
        return (titleSpan?.textContent?.trim() === '보관함') ? 'archive-list' : 'archive-inner';
    }

    /* ================================================================
       2. 유틸
    ================================================================ */
    function extractTitle(a) {
        const n = a.querySelector(SEL_NAME);
        if (n?.innerText.trim()) return n.innerText.trim();
        const img = a.querySelector('img[alt]');
        if (img?.alt.trim()) return img.alt.trim();
        return (a.innerText || '').split('\n')[0].trim() || '이름 없는 세션';
    }

    const delay = ms => new Promise(r => setTimeout(r, ms));

    async function waitForEl(sel, timeout = 2000) {
        const end = Date.지금() + timeout;
        while (Date.지금() < end) {
            const el = document.querySelector(sel);
            if (el) return el;
            await delay(80);
        }
        return null;
    }

    /* ================================================================
       2-b. Virtuoso 스크롤러 높이 보정
            검색창·자식 패널이 scroller 앞에 삽입되면
            Virtuoso의 inline "height:100%" 와 합산되어 넘침.
            CSS !important 로 calc(100% - Npx) 를 강제 적용.
            (CSS specificity: 동적 stylesheet !important > 인라인 style)
    ================================================================ */
    function _getDynStyle() {
        let s = document.getElementById('crack-dyn-style');
        if (!s) {
            s = document.createElement('style');
            s.id = 'crack-dyn-style';
            document.head.appendChild(s);
        }
        return s;
    }

    function adjustScrollerHeight() {
        const scroller = document.querySelector(SEL_VSCROLL);
        if (!scroller) { _getDynStyle().textContent = ''; return; }

        let offset = 0;
        const search = document.getElementById('crack-search-container');
        const child  = document.getElementById('crack-child-archives');
        if (search) offset += search.getBoundingClientRect().height;
        if (child)  offset += child.getBoundingClientRect().height;

        _getDynStyle().textContent = offset > 0
            ? `[data-testid="virtuoso-scroller"]{height:calc(100% - ${Math.ceil(offset)}px)!important;}`
            : '';
    }

    /* ================================================================
       3. 메인 뷰: 보관함 섹션 숨김
          data-attribute 방식: CSS가 선택자로 직접 제어하므로
          React 재조정(reconciliation)으로 inline style이 초기화돼도 유지됨
    ================================================================ */
    function hideNativeArchiveSection() {
        const trigger = document.querySelector('button[aria-label="보관함 전체보기"]');
        if (!trigger) return;

        // trigger → 조상 중 class="relative"인 div 탐색
        let rel = trigger.parentElement;
        while (rel && rel !== document.body) {
            if (rel.tagName === 'DIV' && rel.classList.contains('relative')) break;
            rel = rel.parentElement;
        }
        if (!rel || rel === document.body) return;

        // data attribute 마킹 (GM_addStyle의 CSS가 이 attribute로 숨김 처리)
        rel.setAttribute('data-crack-arch-section', '1');
        const divider = rel.nextElementSibling;
        if (divider) divider.setAttribute('data-crack-arch-divider', '1');
        const chatHdr = divider?.nextElementSibling;
        if (chatHdr) chatHdr.setAttribute('data-crack-chat-hdr', '1');
    }

    /* ================================================================
       4. 보관함 / 채팅 목록 탭 (main + archive-list 양 뷰에서 유지)
    ================================================================ */
    function injectViewTabs() {
        if (document.getElementById('crack-view-tabs')) return;

        const view = detectView();
        // archive-inner / archive-edit 에서는 탭 불필요
        if (view !== 'main' && view !== 'archive-list') return;

        // 삽입 위치: virtuoso 컨테이너(pl-2 div) 바로 앞
        // 메인 뷰:          div.flex-1.min-h-0.overflow-hidden.pl-2          (min-w-0 없음)
        // archive-list 뷰:  div.flex-1.min-w-0.min-h-0.overflow-hidden.pl-2  (min-w-0 있음)
        const inner = document.querySelector('div.flex-1.min-w-0.min-h-0.overflow-hidden.pl-2')
                   || document.querySelector('div.flex-1.min-h-0.overflow-hidden.pl-2');
        if (!inner || !inner.parentElement) return;

        const isArchive = (view === 'archive-list');

        const tabs = document.createElement('div');
        tabs.id = 'crack-view-tabs';
        tabs.innerHTML = `
            <button class="crack-tab-btn ${isArchive ? 'crack-tab-active' : ''}" data-tab="archive">보관함</button>
            <button class="crack-tab-btn ${!isArchive ? 'crack-tab-active' : ''}" data-tab="chatlist">채팅 목록</button>`;

        // 보관함 탭 클릭
        tabs.querySelector('[data-tab="archive"]').addEventListener('click', () => {
            const v = detectView();
            if (v === 'main') {
                // 메인 → 보관함 전체 뷰
                document.querySelector('button[aria-label="보관함 전체보기"]')?.click();
            }
            // archive-list에서는 이미 보관함 뷰이므로 아무것도 하지 않음
        });

        // 채팅 목록 탭 클릭
        tabs.querySelector('[data-tab="chatlist"]').addEventListener('click', () => {
            const v = detectView();
            if (v === 'archive-list') {
                // 보관함 전체 → 메인 뷰 (뒤로가기)
                document.querySelector('button[aria-label="뒤로가기"]')?.click();
            }
            // main에서는 이미 채팅 목록 뷰이므로 아무것도 하지 않음
        });

        inner.parentElement.insertBefore(tabs, inner);
    }

    /* ================================================================
       5. 검색창 (main 제외, 공통)
    ================================================================ */
    function injectSearchBar() {
        if (document.getElementById('crack-search-container')) return;
        const scroller = document.querySelector(SEL_VSCROLL);
        if (!scroller?.parentElement) return;
        const wrap = document.createElement('div');
        wrap.id = 'crack-search-container';
        wrap.innerHTML = `
            <div id="crack-search-inner">
                <span class="crack-search-icon">🔍</span>
                <input type="text" id="crack-search-input" placeholder="검색...">
            </div>`;
        scroller.parentElement.insertBefore(wrap, scroller);
        document.getElementById('crack-search-input').addEventListener('input', e => filterSessions(e.target.value));
        // 삽입 후 레이아웃이 확정되면 높이 보정
        requestAnimationFrame(adjustScrollerHeight);
    }

    function filterSessions(raw) {
        const kw   = raw.toLowerCase().replace(/\s+/g, '');
        const view = detectView();

        document.querySelectorAll(`${SEL_VLIST} div[data-index]`).forEach(wrapper => {
            // 보관함 계층으로 이미 숨긴 아이템은 건드리지 않음
            if (wrapper.dataset.crackHierHide === '1') return;

            let text = '';
            if (view === 'archive-list' || view === 'archive-edit') {
                text = (wrapper.querySelector(SEL_NAME)?.textContent || '').trim().toLowerCase().replace(/\s+/g, '');
                wrapper.style.display = (!kw || text.includes(kw)) ? '' : 'none';
            } else {
                const a = wrapper.querySelector(SEL_LINK);
                if (!a) return;
                text = extractTitle(a).toLowerCase().replace(/\s+/g, '');
                const memo = getMemo(a.getAttribute('href') || '').toLowerCase().replace(/\s+/g, '');
                wrapper.style.display = (!kw || text.includes(kw) || memo.includes(kw)) ? '' : 'none';
            }
        });
    }

    /* ================================================================
       6. 보관함 계층: 전체/편집 뷰에서 자식 보관함 숨김
    ================================================================ */
    function applyArchiveHierarchy() {
        const h = getHierarchy();
        const childSet = new Set(Object.keys(h));
        if (!childSet.size) return;

        document.querySelectorAll(`${SEL_VLIST} div[data-index]`).forEach(wrapper => {
            const name = wrapper.querySelector(SEL_NAME)?.textContent.trim();
            if (!name) return;
            if (childSet.has(name)) {
                wrapper.style.setProperty('display', 'none', 'important');
                wrapper.dataset.crackHierHide = '1';
            } else {
                wrapper.style.removeProperty('display');
                delete wrapper.dataset.crackHierHide;
            }
        });
    }

    /* ================================================================
       7. 편집 뷰: 이동 버튼 주입
    ================================================================ */
    function injectMoveButtons() {
        document.querySelectorAll(`${SEL_VLIST} div[data-index]:not([data-crack-move])`).forEach(wrapper => {
            wrapper.dataset.crackMove = '1';
            const absDiv  = wrapper.querySelector('.absolute.top-3.right-3');
            const nameSpan = wrapper.querySelector(SEL_NAME);
            const archiveName = nameSpan?.textContent.trim();
            if (!archiveName || !absDiv) return;
            if (absDiv.querySelector('.crack-move-btn')) return;

            const btn = document.createElement('button');
            btn.className = 'crack-move-btn';
            btn.title = '다른 보관함으로 이동';
            btn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="14" height="14"><path d="M19 3H5a2 2 0 0 0-2 2v4h2V5h14v14H5v-4H3v4a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2zM3 13h8.586l-2.293 2.293 1.414 1.414L15.414 12l-4.707-4.707-1.414 1.414L11.586 11H3v2z"/></svg>`;
            btn.addEventListener('click', e => {
                e.stopPropagation();
                openMoveModal(archiveName);
            });
            absDiv.insertBefore(btn, absDiv.firstChild);
        });
    }

    function openMoveModal(archiveName) {
        document.getElementById('crack-move-modal')?.remove();
        const allNames    = collectVisibleArchiveNames().filter(n => n !== archiveName);
        const curParent   = getArchiveParent(archiveName);

        const modal = document.createElement('div');
        modal.id = 'crack-move-modal';
        modal.innerHTML = `
            <div class="cmove-box">
                <div class="cmove-header">
                    <span>↗ 이동</span>
                    <span class="cmove-target">"${archiveName}"</span>
                </div>
                <div class="cmove-list">
                    <div class="cmove-item ${!curParent ? 'cmove-active' : ''}" data-name="">
                        🏠 최상위 (이동 해제)
                    </div>
                    ${allNames.map(n => `
                        <div class="cmove-item ${curParent === n ? 'cmove-active' : ''}" data-name="${n}">
                            📂 ${n}
                        </div>`).join('')}
                </div>
                <div class="cmove-footer">
                    <button id="cmove-cancel" class="cmove-btn">취소</button>
                </div>
            </div>`;
        document.body.appendChild(modal);

        modal.querySelectorAll('.cmove-item').forEach(item => {
            item.addEventListener('click', () => {
                const par = item.dataset.name || null;
                setArchiveParent(archiveName, par);
                modal.remove();
                applyArchiveHierarchy();
            });
        });
        modal.querySelector('#cmove-cancel').onclick = () => modal.remove();
        modal.onclick = e => { if (e.target === modal) modal.remove(); };
        const onKey = e => { if (e.key === 'Escape') { modal.remove(); document.removeEventListener('keydown', onKey); } };
        document.addEventListener('keydown', onKey);
    }

    /* ================================================================
       8. 개별 보관함 내부: 자식 보관함 패널
    ================================================================ */
    function injectChildArchivesPanel() {
        const titleSpan = document.querySelector('div.shrink-0.flex.items-center.gap-2.h-12 span.flex-1');
        const curName   = titleSpan?.textContent.trim();
        if (!curName) return;

        const children = getArchiveChildren(curName);
        let panel = document.getElementById('crack-child-archives');

        if (!children.length) {
            panel?.remove();
            return;
        }

        const scroller = document.querySelector(SEL_VSCROLL);
        if (!scroller?.parentElement) return;

        if (!panel) {
            panel = document.createElement('div');
            panel.id = 'crack-child-archives';
            scroller.parentElement.insertBefore(panel, scroller);
        }

        // 자식 목록 업데이트
        const sig = children.join(',');
        if (panel.dataset.sig === sig) return;
        panel.dataset.sig = sig;

        panel.innerHTML = `
            <div class="cca-header">하위 보관함</div>
            ${children.map(name => `
                <button class="cca-item" data-target="${name}">
                    <div class="cca-thumb">
                        <svg xmlns="http://www.w3.org/2000/svg" fill="currentColor" viewBox="0 0 24 24" width="26" height="26">
                            <path fill-rule="evenodd" d="M2 6a2 2 0 0 1 2-2h4.586A2 2 0 0 1 10 4.586L11.414 6H20a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2z" clip-rule="evenodd"/>
                        </svg>
                    </div>
                    <div class="cca-info">
                        <span class="cca-name">${name}</span>
                    </div>
                </button>
            `).join('')}`;

        panel.querySelectorAll('.cca-item').forEach(btn => {
            const targetName = btn.dataset.target;
            btn.addEventListener('click', async () => {
                // 뒤로가기 → 전체 보관함 뷰 → 숨겨진 해당 보관함 버튼 클릭
                const backBtn = document.querySelector('button[aria-label="뒤로가기"]');
                if (!backBtn) return;
                backBtn.click();
                await delay(400);
                // 전체 보관함 뷰에서 해당 이름의 아이템 찾기 (숨김 해제 후 클릭)
                const items = document.querySelectorAll(`${SEL_VLIST} div[data-index]`);
                for (const wrapper of items) {
                    const span = wrapper.querySelector(SEL_NAME);
                    if (span?.textContent.trim() !== targetName) continue;
                    wrapper.style.removeProperty('display');
                    delete wrapper.dataset.crackHierHide;
                    wrapper.querySelector('button.flex.items-center.gap-2')
                        ?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
                    return;
                }
                alert(`"${targetName}" 보관함을 찾을 수 없습니다.\n스크롤을 내려 목록을 로드 후 다시 시도해 주세요.`);
            });
        });
        requestAnimationFrame(adjustScrollerHeight);
    }

    /* ================================================================
       9. 개별 보관함 내부: 하위 보관함 관리 버튼 + 모달
    ================================================================ */
    function injectCreateArchiveBtn() {
        const hdr = document.querySelector('div.shrink-0.flex.items-center.gap-2.h-12.px-2');
        if (!hdr || hdr.querySelector('#crack-create-arch-btn')) return;

        const titleSpan = hdr.querySelector('span.flex-1');
        const curName   = titleSpan?.textContent.trim();
        if (!curName) return;

        const btn = document.createElement('button');
        btn.id        = 'crack-create-arch-btn';
        btn.className = 'crack-icon-action-btn';
        btn.title     = '하위 보관함 관리';
        btn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" fill="currentColor" viewBox="0 0 24 24" width="18" height="18">
            <path d="M18.9 17.32h3.07v1.6H18.9v3.06h-1.6v-3.06h-3.06v-1.6h3.07v-3.07h1.6z"/>
            <path fill-rule="evenodd" d="M20.7 4c.7 0 1.25.56 1.25 1.25v4.6c0 .6-.43 1.09-.99 1.2V13h-1.6v-1.9H4.61v6.69h7.37v1.6H4.24a1.23 1.23 0 0 1-1.23-1.23v-7.1a1.2 1.2 0 0 1-.98-1.2v-4.6c0-.7.55-1.25 1.24-1.25zM3.62 9.5h16.73V5.6H3.62z" clip-rule="evenodd"/>
            <path d="M14.98 13.2v1.6h-6v-1.6z"/></svg>`;
        btn.addEventListener('click', () => openSubArchiveModal(curName));

        const menuBtn = hdr.querySelector('button[aria-label="보관함 메뉴"]');
        if (menuBtn) hdr.insertBefore(btn, menuBtn);
        else hdr.appendChild(btn);
    }

    /* ================================================================
       9-b. 하위 보관함 뒤로가기 인터셉트
            부모 보관함이 지정된 경우: 뒤로가기 → 전체 보관함 → 부모 클릭
    ================================================================ */
    function injectBackIntercept() {
        const titleSpan = document.querySelector('div.shrink-0.flex.items-center.gap-2.h-12 span.flex-1');
        const curName   = titleSpan?.textContent.trim();
        if (!curName) return;

        const parentName = getArchiveParent(curName);
        if (!parentName) return; // 부모 없으면 인터셉트 불필요

        const backBtn = document.querySelector('button[aria-label="뒤로가기"]');
        if (!backBtn || backBtn.dataset.crackBackIntercepted) return;
        backBtn.dataset.crackBackIntercepted = '1';

        backBtn.addEventListener('click', async () => {
            // 플랫폼이 전체 보관함으로 이동한 뒤 상위 보관함을 찾아 클릭
            const end = Date.지금() + 2500;
            while (Date.지금() < end) {
                await delay(120);
                if (detectView() !== 'archive-list') continue;
                const items = document.querySelectorAll(`${SEL_VLIST} div[data-index]`);
                for (const wrapper of items) {
                    if (wrapper.querySelector(SEL_NAME)?.textContent.trim() !== parentName) continue;
                    wrapper.style.removeProperty('display');
                    delete wrapper.dataset.crackHierHide;
                    wrapper.querySelector('button.flex.items-center.gap-2')
                        ?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
                    return;
                }
            }
            // 타임아웃: 전체 보관함 뷰에 그대로 머묾 (플랫폼 기본 동작)
        });
    }

    function openSubArchiveModal(curName) {
        document.getElementById('crack-sub-modal')?.remove();

        const children  = getArchiveChildren(curName);
        // getArchiveNames()는 archive-list/edit 뷰에서만 캐싱 → 보관함 이름만 포함
        // collectVisibleArchiveNames()는 archive-inner 뷰에서 채팅 세션까지 수집하므로 제외
        const allNames  = getArchiveNames()
            .filter(n =>
                n !== curName &&                 // 자기 자신 제외
                !children.includes(n) &&         // 이미 현재의 자식 제외
                getArchiveParent(n) === null      // 이미 다른 보관함의 자식 제외
            );

        const modal = document.createElement('div');
        modal.id = 'crack-sub-modal';
        modal.innerHTML = `
            <div class="csub-box">
                <div class="csub-header">📂 "${curName}" 하위 보관함</div>

                <div class="csub-section-title">현재 하위 보관함</div>
                <div class="csub-children" id="csub-children-list">
                    ${children.length
                        ? children.map(n => `
                            <div class="csub-child-row">
                                <span>📂 ${n}</span>
                                <button class="csub-remove-btn" data-name="${n}" title="연결 해제">✕</button>
                            </div>`).join('')
                        : '<div class="csub-empty">없음</div>'}
                </div>

                <div class="csub-section-title">기존 보관함을 하위로 등록</div>
                <div class="csub-assign-row">
                    <select id="csub-select" class="csub-select">
                        <option value="">— 선택 —</option>
                        ${allNames.map(n => `<option value="${n}">📂 ${n}</option>`).join('')}
                    </select>
                    <button id="csub-assign-btn" class="csub-btn" style="background:#FF4432;color:#fff;border-color:#FF4432;flex-shrink:0">등록</button>
                </div>
                ${!allNames.length ? '<div class="csub-hint">※ 등록 가능한 보관함이 없습니다.<br>전체 보관함 목록을 먼저 방문하면 목록이 채워집니다.</div>' : ''}

                <div class="csub-footer">
                    <button id="csub-close" class="csub-btn">닫기</button>
                </div>
            </div>`;
        document.body.appendChild(modal);

        // 연결 해제
        modal.querySelectorAll('.csub-remove-btn').forEach(b => {
            b.addEventListener('click', () => {
                setArchiveParent(b.dataset.name, null);
                openSubArchiveModal(curName);
            });
        });

        // 기존 보관함 등록
        modal.querySelector('#csub-assign-btn').onclick = () => {
            const name = modal.querySelector('#csub-select').value;
            if (!name) return;
            setArchiveParent(name, curName);
            openSubArchiveModal(curName);
        };

        modal.querySelector('#csub-close').onclick = () => modal.remove();
        modal.onclick = e => { if (e.target === modal) modal.remove(); };
        const onKey = e => { if (e.key === 'Escape') { modal.remove(); document.removeEventListener('keydown', onKey); } };
        document.addEventListener('keydown', onKey);
    }

    /* ================================================================
       10. 메모 UI (모든 뷰 공통)
    ================================================================ */
    function injectMemoUI() {
        document.querySelectorAll(`${SEL_LINK}:not([data-crack-memo])`).forEach(link => {
            const href = link.getAttribute('href');
            if (!href) return;
            cacheSession(href, extractTitle(link));

            const moreBtn = link.querySelector(SEL_MORE_BTN);
            if (!moreBtn) return;
            const titleRow = moreBtn.parentElement;

            if (!titleRow.querySelector('.crack-memo-btn')) {
                const memoBtn = document.createElement('button');
                memoBtn.className = 'crack-memo-btn';
                memoBtn.setAttribute('type', 'button');
                memoBtn.title = '메모';
                memoBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" fill="currentColor" viewBox="0 0 24 24" width="14" height="14">
                    <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>`;
                memoBtn.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); openMemoModal(href); });
                titleRow.insertBefore(memoBtn, moreBtn);
            }

            const contentArea = link.querySelector('div[class*="flex-col"][class*="flex-1"]');
            if (contentArea && !contentArea.querySelector('.crack-memo-preview')) {
                const preview = document.createElement('div');
                preview.className        = 'crack-memo-preview';
                preview.dataset.memoHref = href;
                preview.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); openMemoModal(href); });
                contentArea.appendChild(preview);
            }

            link.setAttribute('data-crack-memo', '1');
        });

        refreshPreviews();
        injectNameAnimation();
    }

    function refreshPreviews() {
        document.querySelectorAll('.crack-memo-preview').forEach(el => {
            const text = getMemo(el.dataset.memoHref);
            el.textContent = text ? '📝 ' + text : '';
            el.style.display = text ? 'block' : 'none';
        });
    }

    /* ================================================================
       11. 이름 팝업 & 애니메이션
    ================================================================ */
    function injectNameAnimation() {
        document.querySelectorAll(`${SEL_LINK} ${SEL_NAME}:not([data-crack-anim])`).forEach(span => {
            span.setAttribute('data-crack-anim', '1');
            requestAnimationFrame(() => {
                const sw = span.scrollWidth, cw = span.clientWidth;
                if (sw > cw) {
                    span.classList.add('crack-can-animate');
                    span.style.setProperty('--crack-move-dist', `${(sw - cw + 7) * -1}px`);
                    if (!span.hasAttribute('title')) span.setAttribute('title', span.textContent.trim());
                } else {
                    span.classList.remove('crack-can-animate');
                    span.style.removeProperty('--crack-move-dist');
                }
            });
        });
    }

    /* ================================================================
       12. 이어하기 인터셉트
    ================================================================ */
    function getSessionsForStory(storyId) {
        const pattern = `/stories/${storyId}/episodes/`;
        const seen = new Set(), results = [];
        Object.entries(getCache()).forEach(([href, info]) => {
            if (href.includes(pattern) && !seen.has(href)) {
                seen.add(href);
                results.push({ href, name: info.title || href.split('/').pop() });
            }
        });
        document.querySelectorAll(`a[href*="${pattern}"]`).forEach(a => {
            const h = a.getAttribute('href');
            if (!h || seen.has(h)) return;
            seen.add(h);
            results.push({ href: h, name: extractTitle(a) });
        });
        return results;
    }

    function interceptContinueButtons() {
        document.querySelectorAll('a:not([data-csp-done]), button:not([data-csp-done])').forEach(el => {
            if ((el.innerText || el.textContent || '').trim() !== '이어하기') return;
            el.setAttribute('data-csp-done', '1');
            el.addEventListener('click', e => {
                let storyId = null, m;
                m = (el.getAttribute('href') || '').match(/\/stories\/([^/?#]+)/);
                if (m) storyId = m[1];
                if (!storyId) {
                    let node = el.parentElement;
                    while (node && node !== document.body) {
                        m = (node.getAttribute?.('href') || '').match(/\/stories\/([^/?#]+)/);
                        if (m) { storyId = m[1]; break; }
                        const ds = node.dataset?.storyId || node.dataset?.story;
                        if (ds) { storyId = ds; break; }
                        node = node.parentElement;
                    }
                }
                if (!storyId) { m = window.location.pathname.match(/\/stories\/([^/?#]+)/);   if (m) storyId = m[1]; }
                if (!storyId) { m = window.location.pathname.match(/\/detail\/([^/?#]+)/);    if (m) storyId = m[1]; }
                if (!storyId) return;
                const sessions = getSessionsForStory(storyId);
                if (sessions.length <= 1) return;
                e.preventDefault(); e.stopPropagation();
                openSessionPickerModal(sessions);
            }, true);
        });
    }

    /* ================================================================
       13. 메모 모달
    ================================================================ */
    function openMemoModal(href) {
        document.getElementById('crack-memo-modal')?.remove();
        const current = getMemo(href);
        const title   = getCache()[href]?.title || href;
        const modal   = document.createElement('div');
        modal.id      = 'crack-memo-modal';
        modal.innerHTML = `
            <div class="cmemo-box">
                <div class="cmemo-header">
                    <span class="cmemo-icon">📝</span>
                    <span class="cmemo-title" title="${title}">${title}</span>
                </div>
                <textarea id="cmemo-ta" placeholder="이 세션에 대한 메모를 입력하세요...">${current}</textarea>
                <div class="cmemo-footer">
                    <button id="cmemo-del" class="cmemo-btn cmemo-btn-danger" ${current ? '' : 'style="display:none"'}>삭제</button>
                    <div style="flex:1"></div>
                    <button id="cmemo-cancel" class="cmemo-btn">취소</button>
                    <button id="cmemo-save" class="cmemo-btn cmemo-btn-primary">저장</button>
                </div>
            </div>`;
        document.body.appendChild(modal);
        const ta = modal.querySelector('#cmemo-ta');
        ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length);
        modal.querySelector('#cmemo-save').onclick   = () => { saveMemo(href, ta.value); refreshPreviews(); modal.remove(); };
        modal.querySelector('#cmemo-cancel').onclick = () => modal.remove();
        modal.querySelector('#cmemo-del').onclick    = () => {
            if (confirm('메모를 삭제하시겠습니까?')) { saveMemo(href, ''); refreshPreviews(); modal.remove(); }
        };
        modal.onclick = e => { if (e.target === modal) modal.remove(); };
        const onKey = e => { if (e.key === 'Escape') { modal.remove(); document.removeEventListener('keydown', onKey); } };
        document.addEventListener('keydown', onKey);
    }

    /* ================================================================
       14. 이어하기 세션 선택 모달
    ================================================================ */
    function openSessionPickerModal(sessions) {
        document.getElementById('crack-picker-modal')?.remove();
        const modal = document.createElement('div');
        modal.id = 'crack-picker-modal';
        modal.innerHTML = `
            <div class="csp-box">
                <div class="csp-header">
                    <span class="csp-icon">▶</span>
                    <span class="csp-title">이어할 세션을 선택하세요</span>
                    <span class="csp-count">${sessions.length}개</span>
                </div>
                <div class="csp-list">
                    ${sessions.map(s => {
                        const memo = getMemo(s.href);
                        return `<a class="csp-item" href="${s.href}">
                                    <span class="csp-name">${s.name}</span>
                                    ${memo ? `<span class="csp-memo">📝 ${memo.length > 30 ? memo.slice(0,30)+'…' : memo}</span>` : ''}
                                </a>`;
                    }).join('')}
                </div>
                <div class="csp-footer"><button class="csp-btn" id="csp-cancel">취소</button></div>
            </div>`;
        document.body.appendChild(modal);
        modal.querySelectorAll('.csp-item').forEach(a => {
            a.addEventListener('click', e => { e.preventDefault(); modal.remove(); window.location.href = a.getAttribute('href'); });
        });
        modal.querySelector('#csp-cancel').onclick = () => modal.remove();
        modal.onclick = e => { if (e.target === modal) modal.remove(); };
        const onKey = e => { if (e.key === 'Escape') { modal.remove(); document.removeEventListener('keydown', onKey); } };
        document.addEventListener('keydown', onKey);
    }

    /* ================================================================
       15. 메인 루프
    ================================================================ */
    function tick() {
        const view = detectView();

        // ── 뷰별 UI ─────────────────────────────────────────────
        if (view === 'main') {
            hideNativeArchiveSection();
            injectViewTabs();
            injectSearchBar();
            document.getElementById('crack-create-arch-btn')?.remove();
            document.getElementById('crack-child-archives')?.remove();
            _getDynStyle().textContent = '';

        } else if (view === 'archive-list') {
            cacheArchiveNames();
            injectViewTabs();
            injectSearchBar();
            applyArchiveHierarchy();
            document.getElementById('crack-create-arch-btn')?.remove();
            document.getElementById('crack-child-archives')?.remove();

        } else if (view === 'archive-edit') {
            cacheArchiveNames();
            document.getElementById('crack-view-tabs')?.remove();
            document.getElementById('crack-search-container')?.remove();
            injectMoveButtons();
            applyArchiveHierarchy();
            document.getElementById('crack-create-arch-btn')?.remove();
            document.getElementById('crack-child-archives')?.remove();
            _getDynStyle().textContent = '';

        } else if (view === 'archive-inner') {
            document.getElementById('crack-view-tabs')?.remove();
            injectCreateArchiveBtn();
            injectBackIntercept();       // 부모 보관함 있을 때 뒤로가기 인터셉트
            injectChildArchivesPanel();
            injectSearchBar();
        }

        // ── 공통 ─────────────────────────────────────────────────
        injectMemoUI();
        interceptContinueButtons();
        adjustScrollerHeight();
    }

    setInterval(tick, 3000);

    let _debounce = null;
    new MutationObserver(mutations => {
        const allInternal = mutations.every(m =>
            m.target.closest?.('#crack-memo-modal')   ||
            m.target.closest?.('#crack-picker-modal') ||
            m.target.closest?.('#crack-move-modal')   ||
            m.target.closest?.('#crack-sub-modal')    ||
            m.target.closest?.('#crack-search-container')
        );
        if (allInternal) return;
        clearTimeout(_debounce);
        _debounce = setTimeout(tick, 250);
    }).observe(document.body, { childList: true, subtree: true });

    tick();

    /* ================================================================
       16. 스타일
    ================================================================ */
    GM_addStyle(`
        /* ── 보관함 섹션 강제 숨김 (data-attribute CSS 방식) ── */
        /* inline style 대신 CSS를 사용해 React 재조정에 의한 초기화 방지 */
        [data-crack-arch-section]  { display: none !important; }
        [data-crack-arch-divider]  { display: none !important; }
        [data-crack-chat-hdr]      { display: none !important; }

        /* ── 이름 애니메이션 ── */
        ${SEL_NAME} {
            display: inline-block !important;
            max-width: 100%;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            transition: transform 0.3s;
        }
        ${SEL_NAME}.crack-can-animate:hover {
            text-overflow: clip !important;
            overflow: visible !important;
            animation: crack-name-scroll 5s linear infinite;
            padding-right: 50px;
            position: relative; z-index: 1;
        }
        @keyframes crack-name-scroll {
            0%   { transform: translateX(0); }
            45%  { transform: translateX(var(--crack-move-dist)); }
            55%  { transform: translateX(var(--crack-move-dist)); }
            100% { transform: translateX(0); }
        }

        /* ── 뷰 탭 ── */
        #crack-view-tabs {
            display: flex;
            flex-shrink: 0;
            border-bottom: 1px solid var(--border, rgba(128,128,128,0.2));
        }
        .crack-tab-btn {
            flex: 1; padding: 8px 4px;
            border: none; background: transparent;
            color: var(--muted-foreground, #888);
            font-size: 13px; font-weight: 600; cursor: pointer;
            border-bottom: 2px solid transparent;
            margin-bottom: -1px;
            transition: color .15s, border-color .15s;
        }
        .crack-tab-btn:hover { color: var(--foreground, #eee); }
        .crack-tab-active { color: var(--primary, #FF4432) !important; border-bottom-color: var(--primary, #FF4432) !important; }

        /* ── 검색창 ── */
        #crack-search-container {
            display: flex; flex-shrink: 0;
            padding: 6px 8px;
            border-bottom: 1px solid var(--border, rgba(128,128,128,0.15));
        }
        #crack-search-inner {
            display: flex; align-items: center; width: 100%;
            background: rgba(128,128,128,0.1);
            border-radius: 6px; padding: 4px 8px;
            border: 1px solid transparent; transition: border-color .2s;
        }
        #crack-search-inner:focus-within { border-color: var(--primary, #FF4432); }
        #crack-search-input {
            border: none; background: none; outline: none;
            color: inherit; font-size: 13px; width: 100%; margin-left: 4px;
        }
        .crack-search-icon { font-size: 12px; opacity: .55; flex-shrink: 0; }

        /* ── 메모 버튼 ── */
        .crack-memo-btn {
            display: inline-flex !important;
            align-items: center; justify-content: center;
            width: 1rem; height: 1rem; flex-shrink: 0;
            background: none; border: none; cursor: pointer;
            color: var(--icon_tertiary, currentColor);
            opacity: 0; transition: opacity .15s; padding: 0;
        }
        a:hover .crack-memo-btn, .crack-memo-btn:hover { opacity: 1 !important; }

        /* ── 메모 미리보기 ── */
        .crack-memo-preview {
            display: none; font-size: 11px; line-height: 1.4;
            color: var(--muted-foreground, #999);
            overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
            width: 100%; cursor: pointer;
        }

        /* ── 편집 뷰 이동 버튼 ── */
        .crack-move-btn {
            display: inline-flex; align-items: center; justify-content: center;
            width: 16px; height: 16px;
            background: none; border: none; cursor: pointer;
            color: var(--line_gray_2, #888);
            border-radius: 3px; opacity: .5;
            transition: opacity .15s, background .15s;
        }
        .crack-move-btn:hover { opacity: 1; background: var(--accent, rgba(128,128,128,0.15)); }

        /* ── 보관함 만들기 버튼 (내부 뷰) ── */
        .crack-icon-action-btn {
            display: inline-flex; align-items: center; justify-content: center;
            width: 24px; height: 24px;
            background: none; border: none; cursor: pointer;
            color: var(--line_gray_2, #888); border-radius: 4px; flex-shrink: 0;
            opacity: .6; transition: opacity .15s, background .15s;
        }
        .crack-icon-action-btn:hover { opacity: 1; background: var(--accent, rgba(128,128,128,0.15)); }

        /* ── 자식 보관함 패널 ── */
        #crack-child-archives {
            flex-shrink: 0;
            border-bottom: 1px solid var(--border, rgba(128,128,128,0.15));
            padding: 2px 0 4px;
        }
        .cca-header {
            font-size: 11px; font-weight: 600; padding: 6px 10px 2px;
            color: var(--muted-foreground, #888); letter-spacing: .04em; text-transform: uppercase;
        }
        .cca-item {
            display: flex; align-items: center; gap: 8px;
            width: 100%; padding: 8px 8px;
            border: none; background: none; text-align: left;
            cursor: pointer; color: inherit;
            transition: background .12s;
        }
        .cca-item:hover { background: var(--accent, rgba(128,128,128,.1)); }
        .cca-thumb {
            width: 48px; height: 48px; flex-shrink: 0;
            border-radius: 8px;
            border: 1px solid var(--border, rgba(128,128,128,.25));
            background: var(--surface-secondary, rgba(128,128,128,.1));
            display: flex; align-items: center; justify-content: center;
            color: var(--muted-foreground, #888);
        }
        .cca-info { flex: 1; min-width: 0; overflow: hidden; }
        .cca-name {
            display: block; font-size: 13px; font-weight: 500;
            white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        }

        /* ── 이동 모달 ── */
        #crack-move-modal {
            position: fixed; inset: 0;
            background: rgba(0,0,0,.55);
            display: flex; align-items: center; justify-content: center;
            z-index: 99999;
        }
        .cmove-box {
            background: var(--surface_secondary, #1e1e1e);
            color: var(--text_primary, #eee);
            border-radius: 12px; width: 360px; max-width: 93vw; max-height: 70vh;
            display: flex; flex-direction: column;
            box-shadow: 0 12px 32px rgba(0,0,0,.7);
            border: 1px solid rgba(255,255,255,.08); overflow: hidden;
        }
        .cmove-header {
            display: flex; align-items: center; gap: 8px;
            padding: 14px 16px; font-size: 14px; font-weight: 700;
            border-bottom: 1px solid rgba(255,255,255,.08); flex-shrink: 0;
        }
        .cmove-target { opacity: .7; font-weight: normal; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .cmove-list   { flex: 1; overflow-y: auto; padding: 6px 0; }
        .cmove-item   {
            padding: 10px 16px; cursor: pointer; font-size: 13px;
            transition: background .12s;
            border-bottom: 1px solid rgba(255,255,255,.04);
        }
        .cmove-item:last-child { border-bottom: none; }
        .cmove-item:hover  { background: rgba(255,255,255,.07); }
        .cmove-active      { color: var(--primary, #FF4432); font-weight: 600; }
        .cmove-footer { padding: 10px 16px; border-top: 1px solid rgba(255,255,255,.08); flex-shrink: 0; display: flex; justify-content: flex-end; }
        .cmove-btn {
            padding: 6px 16px; border-radius: 6px;
            border: 1px solid rgba(255,255,255,.15);
            background: rgba(255,255,255,.06); color: inherit;
            font-size: 13px; cursor: pointer;
        }
        .cmove-btn:hover { background: rgba(255,255,255,.12); }

        /* ── 메모 모달 ── */
        #crack-memo-modal {
            position: fixed; inset: 0; background: rgba(0,0,0,.55);
            display: flex; align-items: center; justify-content: center;
            z-index: 99999;
        }
        .cmemo-box {
            background: #e8e8e8; color: #2a2a2a;
            border-radius: 12px; padding: 20px;
            width: 420px; max-width: 92vw;
            display: flex; flex-direction: column; gap: 14px;
            box-shadow: 0 12px 32px rgba(0,0,0,.6);
        }
        .cmemo-header { display: flex; align-items: center; gap: 8px; font-size: 14px; font-weight: 600; }
        .cmemo-icon   { font-size: 18px; flex-shrink: 0; }
        .cmemo-title  { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; opacity: .75; }
        #cmemo-ta {
            width: 100%; min-height: 120px; max-height: 300px; resize: vertical;
            padding: 10px 12px; border: 1px solid rgba(0,0,0,.5); border-radius: 8px;
            background: #e8e8e8; color: #1e1e1e; font-size: 13px; line-height: 1.6;
            box-sizing: border-box; outline: none; font-family: inherit;
        }
        #cmemo-ta:focus { border-color: #FF4432; }
        #cmemo-ta::placeholder { color: rgba(0,0,0,.4); }
        .cmemo-footer { display: flex; gap: 8px; align-items: center; }
        .cmemo-btn { padding: 7px 14px; border-radius: 6px; border: 1px solid rgba(0,0,0,.4); background: transparent; color: #1e1e1e; font-size: 13px; cursor: pointer; }
        .cmemo-btn:hover         { background: rgba(0,0,0,.07); }
        .cmemo-btn-primary       { background: #FF4432; color: #fff; border-color: #FF4432; }
        .cmemo-btn-primary:hover { background: #e03a29; }
        .cmemo-btn-danger        { color: #ff6b6b; border-color: rgba(255,59,48,.4); }
        .cmemo-btn-danger:hover  { background: rgba(255,59,48,.1); }

        /* ── 이어하기 모달 ── */
        #crack-picker-modal {
            position: fixed; inset: 0; background: rgba(0,0,0,.6);
            display: flex; align-items: center; justify-content: center;
            z-index: 99999;
        }
        .csp-box {
            background: var(--surface_secondary, #1e1e1e); color: var(--text_primary, #eee);
            border-radius: 14px; width: 440px; max-width: 93vw; max-height: 72vh;
            display: flex; flex-direction: column;
            box-shadow: 0 16px 48px rgba(0,0,0,.7);
            border: 1px solid rgba(255,255,255,.08); overflow: hidden;
        }
        .csp-header {
            display: flex; align-items: center; gap: 8px;
            padding: 16px 18px 14px;
            border-bottom: 1px solid rgba(255,255,255,.08);
            font-size: 14px; font-weight: 700; flex-shrink: 0;
        }
        .csp-icon { color: #FF4432; flex-shrink: 0; }
        .csp-title { flex: 1; }
        .csp-count { font-size: 11px; font-weight: normal; opacity: .5; }
        .csp-list  { flex: 1; overflow-y: auto; padding: 6px 0; }
        .csp-item  {
            display: flex; flex-direction: column; gap: 3px;
            padding: 11px 18px; text-decoration: none; color: inherit; cursor: pointer;
            transition: background .12s; border-bottom: 1px solid rgba(255,255,255,.04);
        }
        .csp-item:last-child { border-bottom: none; }
        .csp-item:hover  { background: rgba(150,150,150,.07); }
        .csp-name { font-size: 13px; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .csp-memo { font-size: 11px; color: var(--muted-foreground, #888); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .csp-footer { display: flex; justify-content: flex-end; padding: 12px 18px; border-top: 1px solid rgba(255,255,255,.08); flex-shrink: 0; }
        .csp-btn { padding: 7px 18px; border-radius: 7px; border: 1px solid rgba(255,255,255,.15); background: rgba(255,255,255,.06); color: inherit; font-size: 13px; cursor: pointer; }
        .csp-btn:hover { background: rgba(255,255,255,.12); }

        /* ── 하위 보관함 관리 모달 ── */
        #crack-sub-modal {
            position: fixed; inset: 0; background: rgba(0,0,0,.55);
            display: flex; align-items: center; justify-content: center;
            z-index: 99999;
        }
        .csub-box {
            background: var(--surface_secondary, #1e1e1e);
            color: var(--text_primary, #eee);
            border-radius: 12px; width: 400px; max-width: 93vw; max-height: 80vh;
            display: flex; flex-direction: column; gap: 0;
            box-shadow: 0 12px 36px rgba(0,0,0,.7);
            border: 1px solid rgba(255,255,255,.08); overflow: hidden;
        }
        .csub-header {
            padding: 14px 16px; font-size: 14px; font-weight: 700;
            border-bottom: 1px solid rgba(255,255,255,.1); flex-shrink: 0;
        }
        .csub-section-title {
            font-size: 11px; font-weight: 600; letter-spacing: .04em;
            color: var(--muted-foreground, #888); text-transform: uppercase;
            padding: 12px 16px 4px;
        }
        .csub-children {
            padding: 0 12px 8px; display: flex; flex-direction: column; gap: 4px;
        }
        .csub-child-row {
            display: flex; align-items: center; justify-content: space-between;
            padding: 6px 8px; border-radius: 6px;
            background: rgba(255,255,255,.05); font-size: 13px;
        }
        .csub-remove-btn {
            background: none; border: none; cursor: pointer;
            color: var(--muted-foreground, #888); font-size: 12px; padding: 2px 4px;
            border-radius: 3px; transition: color .12s, background .12s;
        }
        .csub-remove-btn:hover { color: #ff6b6b; background: rgba(255,59,48,.12); }
        .csub-empty { padding: 6px 8px; font-size: 12px; color: var(--muted-foreground, #888); }
        .csub-assign-row {
            display: flex; gap: 6px; align-items: center;
            padding: 4px 12px 10px;
        }
        .csub-select, .csub-input {
            flex: 1; padding: 6px 8px; border-radius: 6px;
            border: 1px solid rgba(255,255,255,.15);
            background: rgba(255,255,255,.07); color: inherit;
            font-size: 13px; outline: none;
        }
        .csub-select:focus, .csub-input:focus { border-color: var(--primary, #FF4432); }
        .csub-input::placeholder { color: rgba(255,255,255,.3); }
        .csub-btn {
            padding: 6px 12px; border-radius: 6px;
            border: 1px solid rgba(255,255,255,.15);
            background: rgba(255,255,255,.07); color: inherit;
            font-size: 13px; cursor: pointer; white-space: nowrap;
            transition: background .12s;
        }
        .csub-btn:hover { background: rgba(255,255,255,.14); }
        .csub-btn-primary { background: var(--primary, #FF4432) !important; border-color: var(--primary, #FF4432) !important; color: #fff !important; }
        .csub-btn-primary:hover { background: #e03a29 !important; }
        .csub-hint {
            font-size: 11px; color: var(--muted-foreground, #777);
            padding: 0 16px 10px; line-height: 1.5;
        }
        .csub-footer {
            display: flex; justify-content: flex-end;
            padding: 10px 16px; border-top: 1px solid rgba(255,255,255,.08);
            flex-shrink: 0;
        }
    `);

})();
