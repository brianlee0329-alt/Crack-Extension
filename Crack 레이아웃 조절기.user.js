// ==UserScript==
// @name         Crack 레이아웃 조절기 (Layout Controller)
// @namespace    https://github.com/local/crack-layout
// @version      1.0.0
// @description  채팅창 너비를 플로팅 버튼으로 실시간 조절 + 이미지 최대 너비 730px 고정
// @author       Tyme
// @match        https://crack.wrtn.ai/stories/*/episodes/*
// @grant        GM_setValue
// @grant        GM_getValue
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    // =========================================================================
    //  설정
    // =========================================================================
    const CFG = {
        chatWidth: GM_getValue('ck_chatWidth', 768),
    };

    function save() {
        GM_setValue('ck_chatWidth', CFG.chatWidth);
    }

    // =========================================================================
    //  CSS 주입
    //  · 채팅 컬럼  → max-w-[768px]  (+ 입력창 max-w-[808px]/816px)
    //  · 이미지     → 730px 고정 (컬럼 너비와 무관)
    // =========================================================================
    function injectCSS() {
        const ID = 'ck-layout-style';
        const el = document.getElementById(ID) || (() => {
            const s = document.createElement('style');
            s.id = ID;
            document.head.appendChild(s);
            return s;
        })();

        el.textContent = `
            /* ── 채팅 컬럼 너비 ── */
            div.max-w-\\[768px\\] {
                max-width: ${CFG.chatWidth}px !important;
            }
            /* ── 입력창 (채팅 컬럼 너비 추종) ── */
            div.max-w-\\[808px\\],
            div.max-w-\\[816px\\] {
                max-width: ${CFG.chatWidth}px !important;
            }
            /* ── 이미지 너비 고정 ── */
            div.max-w-\\[768px\\] img {
                max-width: 730px !important;
                width: auto !important;
                height: auto !important;
            }

            /* ── 패널 슬라이더 ── */
            #ck-panel input[type=range] {
                -webkit-appearance: none;
                appearance: none;
                width: 100%;
                height: 3px;
                border-radius: 2px;
                background: #3a3835;
                outline: none;
                cursor: pointer;
                margin-top: 4px;
            }
            #ck-panel input[type=range]::-webkit-slider-thumb {
                -webkit-appearance: none;
                width: 16px;
                height: 16px;
                border-radius: 50%;
                background: #FFB938;
                box-shadow: 0 0 0 3px rgba(255,185,56,0.3);
                cursor: pointer;
            }
            #ck-panel input[type=range]::-moz-range-thumb {
                width: 16px;
                height: 16px;
                border: none;
                border-radius: 50%;
                background: #FFB938;
                box-shadow: 0 0 0 3px rgba(255,185,56,0.3);
                cursor: pointer;
            }
        `;
    }

    // =========================================================================
    //  플로팅 UI 생성
    // =========================================================================
    function buildUI() {
        if (document.getElementById('ck-fab')) return;

        // ── FAB 버튼 ──────────────────────────────────────────────────────────
        const fab = document.createElement('button');
        fab.id = 'ck-fab';
        fab.title = '레이아웃 조절';
        fab.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 3H3"/><path d="M21 21H3"/><path d="M6 12H18"/><path d="M15 8l3 4-3 4"/><path d="M9 8L6 12l3 4"/></svg>`;
        Object.assign(fab.style, {
            position:       'fixed',
            bottom:         '80px',
            right:          '80px',
            zIndex:         '99998',
            width:          '40px',
            height:         '40px',
            display:        'flex',
            alignItems:     'center',
            justifyContent: 'center',
            borderRadius:   '50%',
            background:     '#242321',
            border:         '1px solid #3a3835',
            color:          '#FFB938',
            cursor:         'pointer',
            boxShadow:      '0 2px 8px rgba(0,0,0,0.5)',
            transition:     'background .15s, transform .15s',
        });
        fab.addEventListener('mouseenter', () => {
            fab.style.background = '#2E2D2B';
            fab.style.transform  = 'scale(1.08)';
        });
        fab.addEventListener('mouseleave', () => {
            fab.style.background = '#242321';
            fab.style.transform  = 'scale(1)';
        });

        // ── 패널 ──────────────────────────────────────────────────────────────
        const panel = document.createElement('div');
        panel.id = 'ck-panel';
        Object.assign(panel.style, {
            position:      'fixed',
            bottom:        '130px',
            right:         '68px',
            zIndex:        '99997',
            width:         '220px',
            background:    '#1E1D1C',
            border:        '1px solid #3a3835',
            borderRadius:  '12px',
            padding:       '16px',
            boxShadow:     '0 8px 24px rgba(0,0,0,0.6)',
            display:       'none',
            flexDirection: 'column',
            fontFamily:    'inherit',
        });

        // 패널 타이틀
        const titleEl = document.createElement('div');
        Object.assign(titleEl.style, {
            fontSize:     '0.8125rem',
            fontWeight:   '600',
            color:        '#F0EFEB',
            marginBottom: '14px',
            display:      'flex',
            alignItems:   'center',
            gap:          '6px',
        });
        titleEl.innerHTML = `<span style="color:#FFB938">◀▶</span> 레이아웃 조절`;
        panel.appendChild(titleEl);

        // ── 채팅 컬럼 슬라이더 ────────────────────────────────────────────────
        const header = document.createElement('div');
        header.style.cssText = 'display:flex; justify-content:space-between; margin-bottom:6px;';

        const lbl = document.createElement('span');
        lbl.style.cssText = 'font-size:0.75rem; color:#85837D;';
        lbl.textContent = '채팅 컬럼 너비';

        const valEl = document.createElement('span');
        valEl.style.cssText = 'font-size:0.75rem; font-weight:600; color:#F0EFEB;';
        valEl.textContent = CFG.chatWidth + 'px';

        header.appendChild(lbl);
        header.appendChild(valEl);

        const slider = document.createElement('input');
        slider.type  = 'range';
        slider.min   = 600;
        slider.max   = 1600;
        slider.step  = 40;
        slider.value = CFG.chatWidth;
        slider.addEventListener('input', () => {
            const v = parseInt(slider.value, 10);
            valEl.textContent = v + 'px';
            CFG.chatWidth = v;
            save();
            injectCSS();
        });

        panel.appendChild(header);
        panel.appendChild(slider);

        // 구분선
        const hr = document.createElement('div');
        hr.style.cssText = 'height:1px; background:#3a3835; margin:14px 0 12px;';
        panel.appendChild(hr);

        // 초기화 버튼
        const resetBtn = document.createElement('button');
        resetBtn.textContent = '기본값으로 초기화';
        resetBtn.style.cssText = `
            width: 100%;
            padding: 6px 0;
            background: rgba(255,185,56,0.08);
            border: 1px solid rgba(255,185,56,0.25);
            border-radius: 7px;
            color: #FFB938;
            font-size: 0.6875rem;
            cursor: pointer;
            transition: background .15s;
        `;
        resetBtn.addEventListener('mouseenter', () => { resetBtn.style.background = 'rgba(255,185,56,0.18)'; });
        resetBtn.addEventListener('mouseleave', () => { resetBtn.style.background = 'rgba(255,185,56,0.08)'; });
        resetBtn.addEventListener('click', () => {
            CFG.chatWidth = 768;
            save();
            injectCSS();
            slider.value      = 768;
            valEl.textContent = '768px';
        });
        panel.appendChild(resetBtn);

        const note = document.createElement('div');
        note.style.cssText = 'margin-top:8px; font-size:0.625rem; color:#61605A; text-align:center;';
        note.textContent = '설정은 자동 저장됩니다';
        panel.appendChild(note);

        // ── FAB 토글 ──────────────────────────────────────────────────────────
        let open = false;
        fab.addEventListener('click', () => {
            open = !open;
            panel.style.display   = open ? 'flex' : 'none';
            fab.style.background  = open ? '#2E2D2B' : '#242321';
            fab.style.borderColor = open ? '#FFB938' : '#3a3835';
        });
        document.addEventListener('click', e => {
            if (open && !panel.contains(e.target) && e.target !== fab) {
                open = false;
                panel.style.display   = 'none';
                fab.style.background  = '#242321';
                fab.style.borderColor = '#3a3835';
            }
        }, true);

        document.body.appendChild(fab);
        document.body.appendChild(panel);
    }

    // =========================================================================
    //  초기화
    // =========================================================================
    function init() {
        injectCSS();
        buildUI();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    // SPA 라우팅 감지
    let lastHref = location.href;
    new MutationObserver(() => {
        if (location.href !== lastHref) {
            lastHref = location.href;
            setTimeout(injectCSS, 600);
        }
    }).observe(document.body, { childList: true, subtree: true });

})();
