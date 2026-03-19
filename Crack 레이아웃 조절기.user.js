// ==UserScript==
// @name         Crack 레이아웃 조절기 (Layout Controller)
// @namespace    https://github.com/local/crack-layout
// @version      1.5.0
// @description  채팅창 너비 조절 + 컴팩트 모드(이미지 옆 텍스트 배치) + 아이콘/썸네일 크기 보호
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
        chatWidth:   GM_getValue('ck_chatWidth',   768),
        compactMode: GM_getValue('ck_compactMode', false),
        imgRatio:    GM_getValue('ck_imgRatio',    50),   // 컴팩트 모드 이미지 열 비율(%)
    };

    function save() {
        GM_setValue('ck_chatWidth',   CFG.chatWidth);
        GM_setValue('ck_compactMode', CFG.compactMode);
        GM_setValue('ck_imgRatio',    CFG.imgRatio);
    }

    // =========================================================================
    //  CSS 주입
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
            /* ── 콘텐츠 이미지 너비 고정 ── */
            div.max-w-\\[768px\\] img {
                max-width: 730px !important;
                width: auto !important;
                height: auto !important;
            }
            /* ── Next.js fill 썸네일 보호 (data-nimg="fill") ── */
            div.max-w-\\[768px\\] img[data-nimg="fill"] {
                max-width: none !important;
                width: 100% !important;
                height: 100% !important;
            }
            /* ── 채팅 대표 이미지 보호 (width="100%") ── */
            div.max-w-\\[768px\\] img[width="100%"],
            div.max-w-\\[768px\\] img[height="100%"] {
                max-width: none !important;
                width: 100% !important;
                height: 100% !important;
                object-fit: cover !important;
            }
            /* ── 소형 아이콘 보호 (width/height="20px"|"25px") ── */
            div.max-w-\\[768px\\] img[width="20px"],
            div.max-w-\\[768px\\] img[height="20px"],
            div.max-w-\\[768px\\] img[width="25px"],
            div.max-w-\\[768px\\] img[height="25px"] {
                max-width: 25px !important;
                width: revert !important;
                height: revert !important;
            }

            /* ── 컴팩트 모드: 이미지-텍스트 row ─────────────────────────────────
               · .ck-row        : 플렉스 행 컨테이너. 텍스트가 이미지보다 길면 자연
                                  스럽게 행 높이가 늘어남.
               · .ck-row-img    : 이미지 열. imgRatio% 너비 고정.
                                  이미지 자체는 열 너비의 100%를 채우도록 override.
               · .ck-row-txt    : 텍스트 열. 남은 공간을 flex: 1로 차지.
                                  min-width: 0 은 flex 자식이 overflow 없이 줄어들기
                                  위한 표준 패턴.
            ─────────────────────────────────────────────────────────────────── */
            .ck-row {
                display: flex;
                flex-direction: row;
                align-items: flex-start;
                gap: 16px;
                width: 100%;
            }
            .ck-row-img {
                flex: 0 0 ${CFG.imgRatio}%;
                max-width: ${CFG.imgRatio}%;
            }
            /* 이미지 열 내부의 img는 열 너비를 꽉 채우되 최대 너비 제한 해제 */
            .ck-row-img img.rounded-lg {
                width: 100% !important;
                max-width: 100% !important;
                height: auto !important;
            }
            .ck-row-txt {
                flex: 1 1 0;
                min-width: 0;
            }

            /* ── 패널 슬라이더 공통 ── */
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
    //  컴팩트 모드: DOM 재구성 / 원상복구
    //
    //  채팅 본문 구조:
    //    <div class="wrtn-markdown">
    //      <p><span class="w-full pt-5 block"><img class="rounded-lg"></span></p>  ← 이미지 단락
    //      <p>텍스트...</p>   ← 이미지 A ~ 이미지 B 사이의 텍스트 단락들
    //      <p>텍스트...</p>
    //      <p><span class="w-full pt-5 block"><img class="rounded-lg"></span></p>  ← 다음 이미지
    //    </div>
    //
    //  재구성 후:
    //    <div class="wrtn-markdown">
    //      <div class="ck-row">
    //        <div class="ck-row-img"><p><span>...</span></p></div>   ← 이미지 열
    //        <div class="ck-row-txt"><p>텍스트</p><p>텍스트</p></div> ← 텍스트 열
    //      </div>
    //      ...
    //    </div>
    // =========================================================================

    /** img.rounded-lg 를 포함하는 <p> 판별 */
    function isImgParagraph(el) {
        return el.tagName === 'P' && !!el.querySelector('img.rounded-lg');
    }

    /**
     * .wrtn-markdown 하나를 컴팩트 레이아웃으로 재구성.
     * data-ck-compact 속성으로 중복 처리 방지.
     */
    function restructureMarkdown(md) {
        if (md.dataset.ckCompact === '1') return;
        md.dataset.ckCompact = '1';

        // children 스냅샷 (DOM 조작 중 live 목록 변경 방지)
        const children = Array.from(md.children);
        let i = 0;

        while (i < children.length) {
            const el = children[i];

            if (isImgParagraph(el)) {
                // 다음 이미지 단락 전까지의 텍스트 단락 수집
                const texts = [];
                let j = i + 1;
                while (j < children.length && !isImgParagraph(children[j])) {
                    texts.push(children[j]);
                    j++;
                }

                if (texts.length > 0) {
                    // row 래퍼를 el 바로 앞에 삽입
                    const row    = document.createElement('div');
                    row.className = 'ck-row';
                    md.insertBefore(row, el);

                    // 이미지 열: el을 이동
                    const imgDiv = document.createElement('div');
                    imgDiv.className = 'ck-row-img';
                    row.appendChild(imgDiv);
                    imgDiv.appendChild(el);          // el이 md → imgDiv로 이동

                    // 텍스트 열: 텍스트 단락들을 이동
                    const txtDiv = document.createElement('div');
                    txtDiv.className = 'ck-row-txt';
                    row.appendChild(txtDiv);
                    texts.forEach(t => txtDiv.appendChild(t)); // md → txtDiv로 이동

                    i = j; // 처리 완료된 인덱스만큼 건너뜀
                } else {
                    // 뒤에 텍스트 없는 이미지는 그대로 둠
                    i++;
                }
            } else {
                i++;
            }
        }
    }

    /**
     * .wrtn-markdown 하나를 원래 구조로 복구.
     * .ck-row 래퍼를 제거하고 자식들을 원 위치(row 앞)로 되돌림.
     */
    function restoreMarkdown(md) {
        if (md.dataset.ckCompact !== '1') return;

        md.querySelectorAll('.ck-row').forEach(row => {
            const imgDiv = row.querySelector('.ck-row-img');
            const txtDiv = row.querySelector('.ck-row-txt');

            // imgDiv 자식(이미지 단락) 복구 → row 앞에 삽입
            if (imgDiv) {
                while (imgDiv.firstChild) {
                    md.insertBefore(imgDiv.firstChild, row);
                }
            }
            // txtDiv 자식(텍스트 단락들) 복구 → row 앞에 삽입 (순서 유지)
            if (txtDiv) {
                while (txtDiv.firstChild) {
                    md.insertBefore(txtDiv.firstChild, row);
                }
            }
            row.remove();
        });

        delete md.dataset.ckCompact;
    }

    function applyCompactAll() {
        document.querySelectorAll('.wrtn-markdown').forEach(restructureMarkdown);
    }

    function removeCompactAll() {
        document.querySelectorAll('.wrtn-markdown[data-ck-compact]').forEach(restoreMarkdown);
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

        // ── 채팅 컬럼 너비 슬라이더 ──────────────────────────────────────────
        const widthHeader = document.createElement('div');
        widthHeader.style.cssText = 'display:flex; justify-content:space-between; margin-bottom:6px;';

        const widthLbl = document.createElement('span');
        widthLbl.style.cssText = 'font-size:0.75rem; color:#85837D;';
        widthLbl.textContent = '채팅 컬럼 너비';

        const widthVal = document.createElement('span');
        widthVal.style.cssText = 'font-size:0.75rem; font-weight:600; color:#F0EFEB;';
        widthVal.textContent = CFG.chatWidth + 'px';

        widthHeader.appendChild(widthLbl);
        widthHeader.appendChild(widthVal);

        const widthSlider = document.createElement('input');
        widthSlider.type  = 'range';
        widthSlider.min   = 600;
        widthSlider.max   = 1600;
        widthSlider.step  = 40;
        widthSlider.value = CFG.chatWidth;
        widthSlider.addEventListener('input', () => {
            const v = parseInt(widthSlider.value, 10);
            widthVal.textContent = v + 'px';
            CFG.chatWidth = v;
            save();
            injectCSS();
        });

        panel.appendChild(widthHeader);
        panel.appendChild(widthSlider);

        // ── 구분선 ────────────────────────────────────────────────────────────
        const hr1 = document.createElement('div');
        hr1.style.cssText = 'height:1px; background:#3a3835; margin:14px 0 12px;';
        panel.appendChild(hr1);

        // ── 컴팩트 모드 토글 ──────────────────────────────────────────────────
        const compactHeader = document.createElement('div');
        compactHeader.style.cssText = 'display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;';

        const compactLbl = document.createElement('span');
        compactLbl.style.cssText = 'font-size:0.75rem; color:#85837D;';
        compactLbl.textContent = '컴팩트 모드';

        // 토글 스위치
        const toggleWrap = document.createElement('label');
        toggleWrap.style.cssText = 'position:relative; display:inline-block; width:32px; height:18px; cursor:pointer;';

        const toggleInput = document.createElement('input');
        toggleInput.type = 'checkbox';
        toggleInput.checked = CFG.compactMode;
        toggleInput.style.cssText = 'opacity:0; width:0; height:0; position:absolute;';

        const toggleSlider = document.createElement('span');
        toggleSlider.style.cssText = `
            position: absolute; inset: 0;
            background: ${CFG.compactMode ? '#FFB938' : '#3a3835'};
            border-radius: 18px;
            transition: background .2s;
        `;
        const toggleKnob = document.createElement('span');
        toggleKnob.style.cssText = `
            position: absolute;
            width: 12px; height: 12px;
            background: #F0EFEB;
            border-radius: 50%;
            top: 3px;
            left: ${CFG.compactMode ? '17px' : '3px'};
            transition: left .2s;
        `;
        toggleSlider.appendChild(toggleKnob);
        toggleWrap.appendChild(toggleInput);
        toggleWrap.appendChild(toggleSlider);

        compactHeader.appendChild(compactLbl);
        compactHeader.appendChild(toggleWrap);
        panel.appendChild(compactHeader);

        // ── 이미지 열 비율 슬라이더 (컴팩트 모드 ON일 때만 표시) ──────────────
        const ratioSection = document.createElement('div');
        ratioSection.style.cssText = `display:${CFG.compactMode ? 'block' : 'none'};`;

        const ratioHeader = document.createElement('div');
        ratioHeader.style.cssText = 'display:flex; justify-content:space-between; margin-bottom:6px;';

        const ratioLbl = document.createElement('span');
        ratioLbl.style.cssText = 'font-size:0.75rem; color:#85837D;';
        ratioLbl.textContent = '이미지 열 너비';

        const ratioVal = document.createElement('span');
        ratioVal.style.cssText = 'font-size:0.75rem; font-weight:600; color:#F0EFEB;';
        ratioVal.textContent = CFG.imgRatio + '%';

        ratioHeader.appendChild(ratioLbl);
        ratioHeader.appendChild(ratioVal);

        const ratioSlider = document.createElement('input');
        ratioSlider.type  = 'range';
        ratioSlider.min   = 30;
        ratioSlider.max   = 70;
        ratioSlider.step  = 5;
        ratioSlider.value = CFG.imgRatio;
        ratioSlider.addEventListener('input', () => {
            const v = parseInt(ratioSlider.value, 10);
            ratioVal.textContent = v + '%';
            CFG.imgRatio = v;
            save();
            injectCSS();          // CSS 변수(.ck-row-img width) 갱신
        });

        ratioSection.appendChild(ratioHeader);
        ratioSection.appendChild(ratioSlider);
        panel.appendChild(ratioSection);

        // 컴팩트 모드 토글 이벤트
        toggleInput.addEventListener('change', () => {
            CFG.compactMode = toggleInput.checked;
            toggleSlider.style.background = CFG.compactMode ? '#FFB938' : '#3a3835';
            toggleKnob.style.left         = CFG.compactMode ? '17px' : '3px';
            ratioSection.style.display    = CFG.compactMode ? 'block' : 'none';
            save();

            if (CFG.compactMode) {
                applyCompactAll();
            } else {
                removeCompactAll();
            }
        });

        // ── 구분선 ────────────────────────────────────────────────────────────
        const hr2 = document.createElement('div');
        hr2.style.cssText = 'height:1px; background:#3a3835; margin:14px 0 12px;';
        panel.appendChild(hr2);

        // ── 초기화 버튼 ───────────────────────────────────────────────────────
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
            // 너비 초기화
            CFG.chatWidth = 768;
            widthSlider.value = 768;
            widthVal.textContent = '768px';

            // 컴팩트 모드 초기화
            if (CFG.compactMode) {
                removeCompactAll();
                CFG.compactMode = false;
                toggleInput.checked = false;
                toggleSlider.style.background = '#3a3835';
                toggleKnob.style.left         = '3px';
                ratioSection.style.display    = 'none';
            }

            // 비율 초기화
            CFG.imgRatio = 50;
            ratioSlider.value = 50;
            ratioVal.textContent = '50%';

            save();
            injectCSS();
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
        // 페이지 로드 시 컴팩트 모드가 저장돼 있으면 즉시 적용
        if (CFG.compactMode) {
            // DOM이 완전히 로드된 후 적용
            setTimeout(applyCompactAll, 800);
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    // =========================================================================
    //  MutationObserver
    //  · SPA 라우팅 감지 → CSS 재주입
    //  · 새 .wrtn-markdown 감지 → 컴팩트 모드 적용
    // =========================================================================
    let lastHref = location.href;
    let mdTimer  = null;

    new MutationObserver(mutations => {
        // SPA 라우팅
        if (location.href !== lastHref) {
            lastHref = location.href;
            setTimeout(injectCSS, 600);
        }

        // 새 .wrtn-markdown 출현 감지 (debounce 200ms)
        if (CFG.compactMode) {
            const hasNew = mutations.some(m =>
                Array.from(m.addedNodes).some(n =>
                    n.nodeType === 1 && (
                        n.classList?.contains('wrtn-markdown') ||
                        n.querySelector?.('.wrtn-markdown')
                    )
                )
            );
            if (hasNew) {
                clearTimeout(mdTimer);
                mdTimer = setTimeout(applyCompactAll, 200);
            }
        }
    }).observe(document.body, { childList: true, subtree: true });

})();
