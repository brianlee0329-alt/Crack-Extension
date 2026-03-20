// ==UserScript==
// @name         Crack 레이아웃 조절기 (Layout Controller)
// @namespace    https://github.com/local/crack-layout
// @version      1.5.1
// @description  채팅창 너비 조절 + 컴팩트 모드(그룹 BFC float, 코드블럭/인용 독립) + 이미지 높이 제한 440px
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
    };

    function save() {
        GM_setValue('ck_chatWidth',   CFG.chatWidth);
        GM_setValue('ck_compactMode', CFG.compactMode);
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
            /* ── 콘텐츠 이미지 높이 제한 ────────────────────────────────────
               너비 기준 → 높이 기준으로 전환 (440px).
               세로로 긴 이미지가 너비는 같아도 칸을 과도하게 늘리는 문제 해소.
            ────────────────────────────────────────────────────────────────────── */
            div.max-w-\\[768px\\] img {
                max-height: 440px !important;
                width: auto !important;
                height: auto !important;
            }
            /* ── Next.js fill 썸네일 보호 ── */
            div.max-w-\\[768px\\] img[data-nimg="fill"] {
                max-width: none !important;
                width: 100% !important;
                height: 100% !important;
            }
            /* ── 채팅 대표 이미지 보호 ── */
            div.max-w-\\[768px\\] img[width="100%"],
            div.max-w-\\[768px\\] img[height="100%"] {
                max-width: none !important;
                width: 100% !important;
                height: 100% !important;
                object-fit: cover !important;
            }
            /* ── 소형 아이콘 보호 ── */
            div.max-w-\\[768px\\] img[width="20px"],
            div.max-w-\\[768px\\] img[height="20px"],
            div.max-w-\\[768px\\] img[width="25px"],
            div.max-w-\\[768px\\] img[height="25px"] {
                max-width: 25px !important;
                width: revert !important;
                height: revert !important;
            }

            /* ── 컴팩트 모드: 그룹 BFC float ────────────────────────────────────
               핵심 원리:
                 이미지 단락들을 "그룹 컨테이너"로 묶은 뒤, 각 컨테이너에
                 overflow:hidden(= BFC 생성)을 적용.

                 BFC(Block Formatting Context)는 내부 float을 외부로 누출시키지
                 않으므로, IMG A 그룹의 텍스트가 IMG B 구간으로 흘러내리는 현상이
                 발생하지 않음. 각 그룹이 독립된 레이아웃 컨텍스트를 형성:

                 ┌─ .ck-group (overflow:hidden) ────────────────────────┐
                 │ ┌────────┐  텍스트가 이미지 우측 상단부터 시작        │
                 │ │ IMG A  │  이미지보다 길면 이미지 하단으로 흘러내림   │
                 │ └────────┘  (BFC 벽에서 멈춤)                        │
                 └──────────────────────────────────────────────────────┘
                 ┌─ .ck-group (overflow:hidden) ────────────────────────┐
                 │ ┌────────┐  다음 그룹은 이전 그룹과 완전히 분리       │
                 │ │ IMG B  │                                            │
                 │ └────────┘                                            │
                 └──────────────────────────────────────────────────────┘

               .ck-group        : BFC 컨테이너. overflow:hidden이 핵심.
               .ck-group-img    : float:left 이미지 단락.
               .ck-group-img img: 그룹 너비의 45%를 꽉 채움.
            ──────────────────────────────────────────────────────────────── */
            .ck-group {
                overflow: hidden;
                margin-bottom: 8px;
            }
            .ck-group-img {
                float: left !important;
                width: 45% !important;
                margin: 0 16px 8px 0 !important;
                padding: 0 !important;
            }
            .ck-group-img img.rounded-lg {
                width: 100% !important;
                max-width: 100% !important;
                height: auto !important;
                display: block !important;
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
                width: 16px; height: 16px; border-radius: 50%;
                background: #FFB938;
                box-shadow: 0 0 0 3px rgba(255,185,56,0.3);
                cursor: pointer;
            }
            #ck-panel input[type=range]::-moz-range-thumb {
                width: 16px; height: 16px; border: none; border-radius: 50%;
                background: #FFB938;
                box-shadow: 0 0 0 3px rgba(255,185,56,0.3);
                cursor: pointer;
            }
        `;
    }

    // =========================================================================
    //  컴팩트 모드: DOM 그룹화 / 복구
    //
    //  변환 전 (.wrtn-markdown 내부):
    //    <p><span><img class="rounded-lg"></span></p>   ← 이미지 단락
    //    <p>텍스트 A</p>
    //    <p>텍스트 B</p>
    //    <p><span><img class="rounded-lg"></span></p>   ← 이미지 단락
    //    <p>텍스트 C</p>
    //
    //  변환 후:
    //    <div class="ck-group">
    //      <p class="ck-group-img">...</p>              ← float:left
    //      <p>텍스트 A</p>                               ← BFC 안에서 우측으로 흐름
    //      <p>텍스트 B</p>
    //    </div>                                         ← overflow:hidden이 float 차단
    //    <div class="ck-group">
    //      <p class="ck-group-img">...</p>
    //      <p>텍스트 C</p>
    //    </div>
    //
    //  복구: data-ck-orig 에 원래 outerHTML을 저장해두고 그대로 교체.
    //  → React 가상 DOM과 충돌 우려가 있으므로, 복구 시 innerHTML 교체 방식 사용.
    // =========================================================================

    function isImgParagraph(el) {
        return el.tagName === 'P' && !!el.querySelector('img.rounded-lg');
    }

    /**
     * 코드블럭(.wrtn-codeblock div)·인용문(blockquote)을 그룹 구분자로 판별.
     * 이 요소들은 독립 블럭으로 배치되어 float 흐름에 포함되지 않음.
     */
    function isBreaker(el) {
        return el.tagName === 'BLOCKQUOTE' ||
               (el.tagName === 'DIV' && el.classList.contains('wrtn-codeblock'));
    }

    function applyCompact(md) {
        if (md.dataset.ckCompact === '1') return;

        // 복구를 위해 원본 HTML 저장
        md.dataset.ckOrig = md.innerHTML;
        md.dataset.ckCompact = '1';

        const children = Array.from(md.children);

        // 출력 목록: { type: 'group'|'standalone', ... }
        // group   : { imgEl, textEls[], breakerEls[] }
        //   - textEls   : 이미지 옆에서 wrap될 일반 <p> 단락들
        //   - breakerEls: 그룹 하단에 full-width로 배치될 코드블럭·인용문
        //     (텍스트 사이에 낀 breaker도 모두 textEls 수집이 끝난 뒤 하단에 몰아 배치)
        const output = [];
        let i = 0;

        // 첫 이미지 이전 요소 → standalone
        while (i < children.length && !isImgParagraph(children[i])) {
            output.push({ type: 'standalone', el: children[i] });
            i++;
        }

        // 이미지 단위로 그룹 생성
        while (i < children.length) {
            if (isImgParagraph(children[i])) {
                const imgEl      = children[i];
                const textEls    = [];   // 이미지 옆 wrap 텍스트
                const breakerEls = [];   // 그룹 하단 독립 블럭
                i++;

                // 다음 이미지 단락 전까지 수집
                // · isBreaker → breakerEls 큐에 적재 (하단에 몰아 배치)
                // · 일반 <p>  → textEls에 추가
                // ※ breaker 이후에 오는 <p>도 textEls에 계속 추가.
                //   이렇게 해야 "텍스트와 텍스트 사이에 코드블럭 삽입" 현상이 사라짐.
                while (i < children.length && !isImgParagraph(children[i])) {
                    if (isBreaker(children[i])) {
                        breakerEls.push(children[i]);
                    } else {
                        textEls.push(children[i]);
                    }
                    i++;
                }

                output.push({ type: 'group', imgEl, textEls, breakerEls });
            } else {
                output.push({ type: 'standalone', el: children[i] });
                i++;
            }
        }

        if (!output.some(o => o.type === 'group')) return;

        // md 비우고 재구성
        md.innerHTML = '';

        output.forEach(item => {
            if (item.type === 'group') {
                // ck-group: 이미지(float) + wrap 텍스트
                const wrapper = document.createElement('div');
                wrapper.className = 'ck-group';
                item.imgEl.classList.add('ck-group-img');
                wrapper.appendChild(item.imgEl);
                item.textEls.forEach(el => wrapper.appendChild(el));
                md.appendChild(wrapper);

                // 그룹 하단에 코드블럭·인용문을 full-width로 배치
                item.breakerEls.forEach(el => md.appendChild(el));
            } else {
                md.appendChild(item.el);
            }
        });
    }

    function restoreCompact(md) {
        if (md.dataset.ckCompact !== '1') return;
        if (md.dataset.ckOrig) {
            md.innerHTML = md.dataset.ckOrig;
        }
        delete md.dataset.ckCompact;
        delete md.dataset.ckOrig;
    }

    function applyCompactAll()  { document.querySelectorAll('.wrtn-markdown').forEach(applyCompact); }
    function removeCompactAll() { document.querySelectorAll('.wrtn-markdown[data-ck-compact]').forEach(restoreCompact); }

    // =========================================================================
    //  플로팅 UI 생성
    // =========================================================================
    function buildUI() {
        if (document.getElementById('ck-fab')) return;

        const fab = document.createElement('button');
        fab.id = 'ck-fab';
        fab.title = '레이아웃 조절';
        fab.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 3H3"/><path d="M21 21H3"/><path d="M6 12H18"/><path d="M15 8l3 4-3 4"/><path d="M9 8L6 12l3 4"/></svg>`;
        Object.assign(fab.style, {
            position:'fixed', bottom:'80px', right:'80px', zIndex:'99998',
            width:'40px', height:'40px', display:'flex',
            alignItems:'center', justifyContent:'center',
            borderRadius:'50%', background:'#242321',
            border:'1px solid #3a3835', color:'#FFB938',
            cursor:'pointer', boxShadow:'0 2px 8px rgba(0,0,0,0.5)',
            transition:'background .15s, transform .15s',
        });
        fab.addEventListener('mouseenter', () => { fab.style.background = '#2E2D2B'; fab.style.transform = 'scale(1.08)'; });
        fab.addEventListener('mouseleave', () => { fab.style.background = '#242321'; fab.style.transform  = 'scale(1)'; });

        const panel = document.createElement('div');
        panel.id = 'ck-panel';
        Object.assign(panel.style, {
            position:'fixed', bottom:'130px', right:'68px', zIndex:'99997',
            width:'220px', background:'#1E1D1C',
            border:'1px solid #3a3835', borderRadius:'12px',
            padding:'16px', boxShadow:'0 8px 24px rgba(0,0,0,0.6)',
            display:'none', flexDirection:'column', fontFamily:'inherit',
        });

        function makeRow(labelText, valueText) {
            const row = document.createElement('div');
            row.style.cssText = 'display:flex; justify-content:space-between; margin-bottom:6px;';
            const lbl = document.createElement('span');
            lbl.style.cssText = 'font-size:0.75rem; color:#85837D;';
            lbl.textContent = labelText;
            const val = document.createElement('span');
            val.style.cssText = 'font-size:0.75rem; font-weight:600; color:#F0EFEB;';
            val.textContent = valueText;
            row.appendChild(lbl); row.appendChild(val);
            return { row, val };
        }
        function makeSlider(min, max, step, value) {
            const s = document.createElement('input');
            s.type = 'range'; s.min = min; s.max = max; s.step = step; s.value = value;
            return s;
        }
        function makeHr() {
            const d = document.createElement('div');
            d.style.cssText = 'height:1px; background:#3a3835; margin:14px 0 12px;';
            return d;
        }

        // 타이틀
        const titleEl = document.createElement('div');
        Object.assign(titleEl.style, { fontSize:'0.8125rem', fontWeight:'600', color:'#F0EFEB', marginBottom:'14px', display:'flex', alignItems:'center', gap:'6px' });
        titleEl.innerHTML = `<span style="color:#FFB938">◀▶</span> 레이아웃 조절`;
        panel.appendChild(titleEl);

        // 채팅 컬럼 너비
        const { row: wRow, val: wVal } = makeRow('채팅 컬럼 너비', CFG.chatWidth + 'px');
        const wSlider = makeSlider(600, 1600, 40, CFG.chatWidth);
        wSlider.addEventListener('input', () => {
            CFG.chatWidth = parseInt(wSlider.value, 10);
            wVal.textContent = CFG.chatWidth + 'px';
            save(); injectCSS();
        });
        panel.appendChild(wRow); panel.appendChild(wSlider);
        panel.appendChild(makeHr());

        // 컴팩트 모드 토글
        const compactRow = document.createElement('div');
        compactRow.style.cssText = 'display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;';
        const compactLbl = document.createElement('span');
        compactLbl.style.cssText = 'font-size:0.75rem; color:#85837D;';
        compactLbl.textContent = '컴팩트 모드';

        const toggleWrap = document.createElement('label');
        toggleWrap.style.cssText = 'position:relative; display:inline-block; width:32px; height:18px; cursor:pointer;';
        const toggleInput = document.createElement('input');
        toggleInput.type = 'checkbox'; toggleInput.checked = CFG.compactMode;
        toggleInput.style.cssText = 'opacity:0; width:0; height:0; position:absolute;';
        const tTrack = document.createElement('span');
        tTrack.style.cssText = `position:absolute; inset:0; border-radius:18px; transition:background .2s; background:${CFG.compactMode ? '#FFB938' : '#3a3835'};`;
        const tKnob = document.createElement('span');
        tKnob.style.cssText = `position:absolute; width:12px; height:12px; background:#F0EFEB; border-radius:50%; top:3px; transition:left .2s; left:${CFG.compactMode ? '17px' : '3px'};`;
        tTrack.appendChild(tKnob);
        toggleWrap.appendChild(toggleInput); toggleWrap.appendChild(tTrack);
        compactRow.appendChild(compactLbl); compactRow.appendChild(toggleWrap);
        panel.appendChild(compactRow);

        toggleInput.addEventListener('change', () => {
            CFG.compactMode = toggleInput.checked;
            tTrack.style.background = CFG.compactMode ? '#FFB938' : '#3a3835';
            tKnob.style.left        = CFG.compactMode ? '17px' : '3px';
            save();
            CFG.compactMode ? applyCompactAll() : removeCompactAll();
        });

        panel.appendChild(makeHr());

        // 초기화 버튼
        const resetBtn = document.createElement('button');
        resetBtn.textContent = '기본값으로 초기화';
        resetBtn.style.cssText = `width:100%; padding:6px 0; background:rgba(255,185,56,0.08); border:1px solid rgba(255,185,56,0.25); border-radius:7px; color:#FFB938; font-size:0.6875rem; cursor:pointer; transition:background .15s;`;
        resetBtn.addEventListener('mouseenter', () => { resetBtn.style.background = 'rgba(255,185,56,0.18)'; });
        resetBtn.addEventListener('mouseleave', () => { resetBtn.style.background = 'rgba(255,185,56,0.08)'; });
        resetBtn.addEventListener('click', () => {
            CFG.chatWidth = 768; wSlider.value = 768; wVal.textContent = '768px';
            if (CFG.compactMode) {
                removeCompactAll();
                CFG.compactMode = false; toggleInput.checked = false;
                tTrack.style.background = '#3a3835'; tKnob.style.left = '3px';
            }
            save(); injectCSS();
        });
        panel.appendChild(resetBtn);

        const note = document.createElement('div');
        note.style.cssText = 'margin-top:8px; font-size:0.625rem; color:#61605A; text-align:center;';
        note.textContent = '설정은 자동 저장됩니다';
        panel.appendChild(note);

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
        if (CFG.compactMode) setTimeout(applyCompactAll, 800);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    // =========================================================================
    //  MutationObserver: SPA 라우팅 + 새 메시지 감지
    // =========================================================================
    let lastHref = location.href;
    let mdTimer  = null;

    new MutationObserver(mutations => {
        if (location.href !== lastHref) {
            lastHref = location.href;
            setTimeout(injectCSS, 600);
        }
        if (CFG.compactMode) {
            const hasNew = mutations.some(m =>
                Array.from(m.addedNodes).some(n =>
                    n.nodeType === 1 && (
                        n.classList?.contains('wrtn-markdown') ||
                        n.querySelector?.('.wrtn-markdown')
                    )
                )
            );
            if (hasNew) { clearTimeout(mdTimer); mdTimer = setTimeout(applyCompactAll, 200); }
        }
    }).observe(document.body, { childList: true, subtree: true });

})();
