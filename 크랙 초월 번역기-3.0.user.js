// ==UserScript==
// @name         크랙 초월 번역기
// @namespace    http://tampermonkey.net/
// @version      3.0
// @description  최신 AI 메시지를 자동 감지·번역·수정 삽입. 설정 패널에서 번역 실행 및 진행 상태 확인.
// @match        https://crack.wrtn.ai/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_addStyle
// @grant        GM_xmlhttpRequest
// @connect      generativelanguage.googleapis.com
// ==/UserScript==

(function () {
    'use strict';

    // =============================================
    //  상수
    // =============================================
    const API_BASE = 'https://crack-api.wrtn.ai/crack-gen';

    // 코드블럭 보존:
    //   ``` 펜스를 Gemini가 인식·제거하지 않도록
    //   전송 전 ===BLOCK_OPEN=== / ===BLOCK_CLOSE=== 로 치환,
    //   번역 완료 후 다시 ``` 로 복원한다.
    //   ===BLOCK_*=== 는 RP 본문에서 쓰이지 않는 형태이며
    //   Gemini가 구조적 경계로 인식해 내용을 건드리지 않는다.
    const CODE_BLOCK_RE   = /```([\s\S]*?)```/g;
    const FENCE_OPEN_SUB  = '===BLOCK_OPEN===';
    const FENCE_CLOSE_SUB = '===BLOCK_CLOSE===';

    // =============================================
    //  기본 번역 프롬프트
    //  ※ "마크다운 기호 안에 담아 출력" 지시 제거
    //     → 번역 결과가 ```로 감싸져 삽입되는 문제 원인이었음
    // =============================================
    const baseSystemPrompt = `[역할 및 목적]
당신은 최상급 웹소설 작가이자 인공지능 캐릭터 롤플레잉 전담 '초월 번역가'입니다. 제공되는 외국어 텍스트를 단순 기계 번역하는 것을 넘어, 캐릭터의 영혼과 감정, 문체, 그리고 상황적 맥락이 생생하게 호흡하는 완벽한 한국어 웹소설 문체로 재창조하는 것이 당신의 유일한 목표입니다.

[작품 전반의 설정 및 문체]
- 전반적인 문체 및 서술 방식: 고급스럽고 생동감 넘치는 웹소설 문체

[핵심 번역 원칙: 초월 번역]
1. 완벽한 탈(脫)번역투: 대명사('당신', '나', '그들' 등) 사용을 극도로 제한하고 자연스러운 호칭으로 대체하십시오. 수동태는 능동태로 변환하십시오.
2. 입체적인 캐릭터 목소리 및 작품 문체 최적화: 감정선의 미세한 변화를 포착하여 대사를 연출하십시오.
3. 지문과 대사의 극적 분리: 지문은 시각적이고 은유적으로, 대사는 구어체의 생동감과 호흡을 섬세하게 살려 표현하십시오.
4. 문화적/상황적 맥락의 현지화: 관용구나 유행어는 직역하지 않고 문맥에 어울리는 한국어 표현으로 대체하십시오.

[출력 및 시스템 규칙]
- 원문의 형태(줄바꿈, 별표*, 따옴표" " 등) 및 텍스트 기호 구조를 원형대로 유지하십시오.
- 번역 외의 부연 설명, 인사말, 감상, 주석 등은 절대 출력하지 마십시오. 오직 번역된 본문만 제공하십시오.`;

    // =============================================
    //  스타일
    // =============================================
    GM_addStyle(`
        /* ── 설정 버튼 ── */
        #trans-setting-btn {
            position: fixed; bottom: 20px; right: 20px; z-index: 999999;
            background-color: #FF4432; color: white; border: none; border-radius: 50%;
            width: 48px; height: 48px; font-size: 24px; cursor: pointer;
            box-shadow: 0 4px 6px rgba(0,0,0,0.1); transition: 0.3s;
            display: flex; align-items: center; justify-content: center;
        }
        #trans-setting-btn:hover { background-color: #e03c2a; transform: scale(1.05); }

        /* ── 설정 패널 ── */
        #trans-setting-panel {
            position: fixed; bottom: 80px; right: 20px; z-index: 999999;
            background-color: #F7F7F5; border: 1px solid #C7C5BD; border-radius: 8px;
            padding: 16px; box-shadow: 0 4px 12px rgba(0,0,0,0.15); display: none; width: 300px;
            max-width: 85vw;
        }
        #trans-setting-panel h4 {
            margin: 0 0 12px 0; color: #1A1918; font-family: sans-serif; font-size: 15px;
        }
        .trans-label {
            font-size: 13px; color: #61605A; margin-bottom: 4px; display: block;
            font-family: sans-serif; font-weight: bold;
        }
        #trans-api-key, #trans-model-select, #trans-mode-select, #trans-custom-prompt {
            width: 100%; box-sizing: border-box; padding: 8px; margin-bottom: 12px;
            border: 1px solid #C7C5BD; border-radius: 4px; font-size: 13px; font-family: sans-serif;
        }
        #trans-custom-prompt { resize: vertical; }

        /* ── 버튼 그룹: 기본값 복구 / 저장하기 / 번역하기 ── */
        .trans-btn-group { display: flex; gap: 6px; margin-bottom: 10px; }
        #trans-reset-btn {
            flex: 1; background-color: #61605A; color: white; border: none;
            padding: 8px 6px; border-radius: 4px; cursor: pointer; font-size: 12px;
            white-space: nowrap;
        }
        #trans-reset-btn:hover { background-color: #42413D; }
        #trans-save-btn {
            flex: 1; background-color: #FF4432; color: white; border: none;
            padding: 8px 6px; border-radius: 4px; cursor: pointer; font-weight: bold;
            font-size: 12px; white-space: nowrap;
        }
        #trans-save-btn:hover { background-color: #e03c2a; }
        #trans-translate-btn {
            flex: 1; background-color: #6A3DE8; color: white; border: none;
            padding: 8px 6px; border-radius: 4px; cursor: pointer; font-weight: bold;
            font-size: 12px; white-space: nowrap; display: none;
        }
        #trans-translate-btn:hover { background-color: #5228CC; }
        #trans-translate-btn:disabled { opacity: 0.55; cursor: not-allowed; }

        /* ── 진행 상태 표시줄 ── */
        #trans-status-box {
            margin-top: 2px; padding: 8px 10px; border-radius: 4px;
            background-color: #EEEEE; border: 1px solid #E5E5E1;
            font-size: 12px; font-family: sans-serif; color: #61605A;
            line-height: 1.5; min-height: 32px; display: none; word-break: break-word;
        }
        #trans-status-box.active { display: block; }
        #trans-status-box.ok   { color: #1a7a3a; background: #f0faf3; border-color: #a8d5b5; }
        #trans-status-box.err  { color: #b91c1c; background: #fff0f0; border-color: #f5a0a0; }
        #trans-status-box.info { color: #4A4A8A; background: #f3f0ff; border-color: #c4b8f5; }

        /* ── 토스트 ── */
        #trans-toast {
            position: fixed; bottom: 80px; left: 50%; transform: translateX(-50%);
            background: rgba(30,30,30,0.92); color: #fff; padding: 10px 20px;
            border-radius: 20px; font-size: 13px; font-family: sans-serif;
            z-index: 9999999; pointer-events: none; opacity: 0; transition: opacity 0.3s;
        }
        #trans-toast.show { opacity: 1; }
    `);

    // =============================================
    //  DOM 빌드
    // =============================================
    const settingBtn = document.createElement('button');
    settingBtn.id = 'trans-setting-btn';
    settingBtn.innerHTML = '⚙️';
    document.body.appendChild(settingBtn);

    const panel = document.createElement('div');
    panel.id = 'trans-setting-panel';
    panel.innerHTML = `
        <h4>초월 번역 설정</h4>

        <span class="trans-label">제미나이 모델 선택:</span>
        <select id="trans-model-select">
            <option value="gemini-3.1-pro-preview">Gemini 3.1 Pro Preview (최상급/권장)</option>
            <option value="gemini-3-flash-preview">Gemini 3 Flash Preview (다목적)</option>
            <option value="gemini-2.5-flash">Gemini 2.5 Flash (빠름/구세대)</option>
        </select>

        <span class="trans-label">API 키:</span>
        <input type="text" id="trans-api-key" placeholder="API 키를 입력해주세요">

        <span class="trans-label">번역 방식:</span>
        <select id="trans-mode-select">
            <option value="ko">한글 전용 (기본)</option>
            <option value="en">영문 혼용 (영어/한국어)</option>
        </select>

        <span class="trans-label">번역 지침서 (수정 가능):</span>
        <textarea id="trans-custom-prompt" rows="8"></textarea>

        <div class="trans-btn-group">
            <button id="trans-reset-btn">기본값 복구</button>
            <button id="trans-save-btn">저장하기</button>
            <button id="trans-translate-btn">✨ 번역</button>
        </div>

        <div id="trans-status-box"></div>
    `;
    document.body.appendChild(panel);

    const toast = document.createElement('div');
    toast.id = 'trans-toast';
    document.body.appendChild(toast);

    // =============================================
    //  설정 요소 참조 및 초기값 로드
    // =============================================
    const apiKeyInput       = document.getElementById('trans-api-key');
    const modelSelect       = document.getElementById('trans-model-select');
    const modeSelect        = document.getElementById('trans-mode-select');
    const customPromptInput = document.getElementById('trans-custom-prompt');
    const saveBtn           = document.getElementById('trans-save-btn');
    const resetBtn          = document.getElementById('trans-reset-btn');
    const translateBtn      = document.getElementById('trans-translate-btn');
    const statusBox         = document.getElementById('trans-status-box');

    apiKeyInput.value       = GM_getValue('apiKey', '');
    modelSelect.value       = GM_getValue('apiModel', 'gemini-3.1-pro-preview');
    modeSelect.value        = GM_getValue('transMode', 'ko');
    customPromptInput.value = GM_getValue('customPrompt', baseSystemPrompt);

    // =============================================
    //  유틸
    // =============================================
    function showToast(msg, duration = 3000) {
        toast.textContent = msg;
        toast.classList.add('show');
        setTimeout(() => toast.classList.remove('show'), duration);
    }

    function setStatus(msg, type = 'info') {
        // type: 'info' | 'ok' | 'err'
        statusBox.textContent = msg;
        statusBox.className   = `active ${type}`;
    }

    function clearStatus() {
        statusBox.className   = '';
        statusBox.textContent = '';
    }

    function getToken() {
        const match = document.cookie.split(';').map(c => c.trim())
            .find(c => c.startsWith('access_token='));
        return match ? match.slice('access_token='.length) : null;
    }

    function buildHeaders() {
        const token  = getToken();
        const wrtnId = document.cookie.split(';').map(c => c.trim())
            .find(c => c.startsWith('__w_id='))?.slice('__w_id='.length) ?? '';
        const h = { 'Content-Type': 'application/json', 'platform': 'web', 'wrtn-locale': 'ko-KR' };
        if (token)  h['Authorization'] = `Bearer ${token}`;
        if (wrtnId) h['x-wrtn-id'] = wrtnId;
        return h;
    }

    function parsePath() {
        const m = location.pathname.match(/\/stories\/([^/]+)\/episodes\/([^/]+)/);
        return m ? { storyId: m[1], chatId: m[2] } : null;
    }

    function isChattingPage() { return !!parsePath(); }

    function buildFinalPrompt() {
        let p = GM_getValue('customPrompt', baseSystemPrompt);
        if (GM_getValue('transMode', 'ko') === 'en')
            p += '\n- 대사 형식: 영어 대사는 "영어"(한국어) 형식으로 출력하십시오.';
        return p;
    }

    function getModel() {
        let m = GM_getValue('apiModel', 'gemini-3.1-pro-preview');
        if (['gemini-3.0-flash', 'gemini-1.5-pro', 'gemini-2.0-flash'].includes(m))
            m = 'gemini-3.1-pro-preview';
        return m;
    }

    // =============================================
    //  코드블럭 보존 유틸
    //  ``` 펜스를 ===BLOCK_OPEN=== / ===BLOCK_CLOSE=== 로 치환하여
    //  Gemini가 내용을 해체·삭제하지 못하도록 한 뒤,
    //  번역 완료 후 원래의 ``` 로 복원한다.
    //  ※ %%CODEBLOCK_N%% 방식은 Gemini가 통째로 제거하는 문제가 있었음
    // =============================================
    function maskCodeBlocks(text) {
        // ```내용``` → ===BLOCK_OPEN===내용===BLOCK_CLOSE===
        return text.replace(CODE_BLOCK_RE, (_, inner) =>
            FENCE_OPEN_SUB + inner + FENCE_CLOSE_SUB
        );
    }

    function unmaskCodeBlocks(text) {
        // ===BLOCK_OPEN=== / ===BLOCK_CLOSE=== → ```
        // = 를 이스케이프하지 않아도 RegExp 리터럴에서 문제없음
        return text
            .split(FENCE_OPEN_SUB).join('```')
            .split(FENCE_CLOSE_SUB).join('```');
    }

    // =============================================
    //  번역 결과 정제
    //  Gemini가 응답 전체를 ``` 로 감싸는 경우 외곽 펜스만 제거.
    //  (unmaskCodeBlocks 전에 실행하므로 내부 블럭에 영향 없음)
    // =============================================
    function stripOuterFence(text) {
        return text.replace(/^```[^\n]*\n([\s\S]*?)\n```\s*$/m, '$1').trim();
    }

    // =============================================
    //  Gemini API 호출
    // =============================================
    function callGemini(text) {
        return new Promise((resolve, reject) => {
            const apiKey = GM_getValue('apiKey', '').trim();
            if (!apiKey) { reject(new Error('API 키가 설정되지 않았습니다.')); return; }

            // 코드블럭 보존: ``` → ===BLOCK_*=== 치환 후 전송
            const masked = maskCodeBlocks(text);

            GM_xmlhttpRequest({
                method: 'POST',
                url: `https://generativelanguage.googleapis.com/v1beta/models/${getModel()}:generateContent?key=${apiKey}`,
                headers: { 'Content-Type': 'application/json' },
                data: JSON.stringify({
                    system_instruction: { parts: [{ text: buildFinalPrompt() }] },
                    contents: [{ parts: [{ text: masked }] }],
                    generationConfig: { temperature: 0.7 },
                }),
                onload(res) {
                    try {
                        const data = JSON.parse(res.responseText);
                        if (data.error) { reject(new Error(data.error.message)); return; }
                        const raw = data.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
                        // 외곽 마크다운 펜스 제거 → ===BLOCK_*=== 를 ``` 로 복원
                        const cleaned  = stripOuterFence(raw);
                        const restored = unmaskCodeBlocks(cleaned);
                        resolve(restored);
                    } catch (e) { reject(e); }
                },
                onerror() { reject(new Error('네트워크 오류가 발생했습니다.')); },
            });
        });
    }

    // =============================================
    //  Crack API 헬퍼
    // =============================================
    async function fetchLatestBotMessage(chatId) {
        const res = await fetch(
            `${API_BASE}/v3/chats/${chatId}/messages?limit=10`,
            { headers: buildHeaders(), credentials: 'include' }
        );
        if (!res.ok) throw new Error(`메시지 조회 실패 (${res.status})`);
        const json = await res.json();
        const msgs = (json.data ?? json).messages ?? [];
        // API는 최신순 반환 → 첫 번째 assistant가 최신 AI 메시지
        const bot = msgs.find(m => m.role === 'assistant');
        if (!bot) throw new Error('최신 AI 메시지를 찾을 수 없습니다.');
        return { id: bot._id ?? bot.id, content: bot.content ?? '' };
    }

    async function patchMessage(chatId, messageId, content) {
        const res = await fetch(
            `${API_BASE}/v3/chats/${chatId}/messages/${messageId}`,
            {
                method: 'PATCH',
                headers: buildHeaders(),
                credentials: 'include',
                body: JSON.stringify({ message: content }),
            }
        );
        if (!res.ok) {
            const text = await res.text().catch(() => '');
            throw new Error(`메시지 수정 실패 (${res.status}): ${text.slice(0, 100)}`);
        }
        return res.json();
    }

    // =============================================
    //  자동 번역 메인 플로우
    // =============================================
    async function autoTranslate() {
        const ids = parsePath();
        if (!ids) { showToast('채팅방 페이지에서만 사용 가능합니다.'); return; }

        if (!GM_getValue('apiKey', '').trim()) {
            setStatus('API 키가 설정되지 않았습니다. 위 항목에서 입력 후 저장해주세요.', 'err');
            return;
        }

        translateBtn.disabled = true;
        clearStatus();

        try {
            // ① 최신 AI 메시지 식별
            setStatus('① 최신 AI 메시지 탐색 중…', 'info');
            const { id: msgId, content: original } = await fetchLatestBotMessage(ids.chatId);

            if (!original.trim()) {
                setStatus('번역할 내용이 없습니다.', 'err');
                return;
            }

            // ② Gemini 번역 호출
            setStatus('② 번역 중… (잠시 기다려 주세요)', 'info');
            const translated = await callGemini(original);

            // ③ PATCH로 번역본 삽입
            setStatus('③ 번역본 삽입 중…', 'info');
            await patchMessage(ids.chatId, msgId, translated);

            setStatus('✅ 번역 완료! 페이지를 새로고침하면 반영됩니다.', 'ok');

        } catch (err) {
            setStatus(`❌ ${err.message}`, 'err');
            console.error('[초월 번역기]', err);
        } finally {
            translateBtn.disabled = false;
        }
    }

    // =============================================
    //  채팅 페이지 여부에 따라 번역 버튼 노출
    // =============================================
    function syncTranslateBtn() {
        translateBtn.style.display = isChattingPage() ? 'inline-block' : 'none';
    }

    // =============================================
    //  설정 패널 이벤트
    // =============================================
    settingBtn.addEventListener('click', () => {
        const isOpen = panel.style.display === 'block';
        panel.style.display = isOpen ? 'none' : 'block';
        if (!isOpen) clearStatus();
    });

    resetBtn.addEventListener('click', () => {
        if (confirm('지침서를 기본값으로 초기화할까요?'))
            customPromptInput.value = baseSystemPrompt;
    });

    saveBtn.addEventListener('click', () => {
        GM_setValue('apiKey',       apiKeyInput.value.trim());
        GM_setValue('apiModel',     modelSelect.value);
        GM_setValue('transMode',    modeSelect.value);
        GM_setValue('customPrompt', customPromptInput.value);
        saveBtn.textContent = '저장 완료!';
        setTimeout(() => { saveBtn.textContent = '저장하기'; }, 1200);
    });

    translateBtn.addEventListener('click', autoTranslate);

    // =============================================
    //  SPA 라우팅 대응
    // =============================================
    syncTranslateBtn();
    let _lastUrl = location.href;
    new MutationObserver(() => {
        if (location.href !== _lastUrl) { _lastUrl = location.href; setTimeout(syncTranslateBtn, 800); }
    }).observe(document, { subtree: true, childList: true });
    setInterval(syncTranslateBtn, 2000);

})();