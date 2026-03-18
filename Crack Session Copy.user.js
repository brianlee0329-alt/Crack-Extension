// ==UserScript==
// @name         Crack Session Copy (세션 관리)
// @namespace    http://tampermonkey.net/
// @version      1.2.0
// @description  채팅 로그 저장/불러오기 통합 도구 (브라우저/JSON/TXT 모두 지원)
// @author       -
// @match        https://crack.wrtn.ai/stories/*
// @grant        none
// ==/UserScript==

(function () {
  "use strict";

  // ==============================================
  //  상수
  // ==============================================
  const API_BASE = "https://crack-api.wrtn.ai/crack-gen";
  const STORAGE_KEY = "crack-session-tool-log";
  const BTN_ID_MAIN   = "cst-btn-main";

  // 임시 전송 텍스트 — 일반챗 수준에서도 짧은 응답을 확실하게 유도
  const DUMMY_MSG = "**이 세션은 서버 응답 테스트용 세션입니다. 모든 입력에 대해 응답으로 '1'을 출력하세요.**";

  // 일반챗 crackerModel 식별 키 (API 응답의 crackerModel 필드 기준)
  const NORMAL_CHAT_KEY = "normalchat";

  let stopRequested = false;
  let running = false;

  // ==============================================
  //  인증
  //  크랙 API 인증 방식:
  //   - GET  : Authorization: Bearer {access_token} 필요
  //   - PATCH: 쿠키(credentials: include)로 처리됨
  //  안전하게 둘 다 항상 함께 전송한다.
  // ==============================================
  function getToken() {
    const match = document.cookie
      .split(";")
      .map(c => c.trim())
      .find(c => c.startsWith("access_token="));
    return match ? match.slice("access_token=".length) : null;
  }

  /**
   * 토큰 갱신 시도.
   * wrtn.ai 계열은 리프레시 토큰이 HttpOnly 쿠키로 관리되므로
   * credentials: "include" 상태로 인증 엔드포인트에 요청하면
   * 서버가 새 access_token 쿠키를 Set-Cookie로 내려준다.
   *
   * 갱신 성공 시 true, 실패 시 false 반환.
   */
  async function tryRefreshToken() {
    console.log("[Crack Session Tool] 토큰 갱신 시도...");
    const refreshEndpoints = [
      `https://crack-api.wrtn.ai/crack-gen/v1/auth/refresh`,
      `https://crack-api.wrtn.ai/crack-gen/v2/auth/refresh`,
      `https://api.wrtn.io/v2/auth/refresh`,
      `https://wrtn.ai/api/auth/refresh`,
    ];

    for (const url of refreshEndpoints) {
      try {
        const res = await fetch(url, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json", "platform": "web", "wrtn-locale": "ko-KR" },
        });
        if (res.ok || res.status === 200) {
          // 응답 후 쿠키가 갱신됐는지 확인
          await sleep(300);
          const newToken = getToken();
          if (newToken) {
            console.log("[Crack Session Tool] ✓ 토큰 갱신 성공 (엔드포인트:", url, ")");
            return true;
          }
        }
      } catch { /* 다음 엔드포인트 시도 */ }
    }

    // 엔드포인트 갱신 실패 시 — 페이지 fetch로 쿠키 재발급 유도
    try {
      const res = await fetch(location.href, { credentials: "include", method: "GET" });
      if (res.ok) {
        await sleep(300);
        const newToken = getToken();
        if (newToken) {
          console.log("[Crack Session Tool] ✓ 페이지 fetch로 토큰 갱신 성공");
          return true;
        }
      }
    } catch { /* 무시 */ }

    console.warn("[Crack Session Tool] ✗ 토큰 갱신 실패 — 재로그인이 필요할 수 있습니다.");
    return false;
  }

  function jsonHeaders() {
    const token = getToken();
    // 크랙 API가 요청 유효성 검증에 사용하는 헤더 세트
    // (Network 탭 실제 요청 기준: platform, wrtn-locale, x-wrtn-id 필수)
    const wrtnId = document.cookie.split(";").map(c => c.trim())
      .find(c => c.startsWith("__w_id="))?.slice("__w_id=".length) ?? "";
    const mpId = (() => {
      try {
        const raw = localStorage.getItem("mp_78c86210f74e622ec77ded5882a5762b_mixpanel");
        return raw ? (JSON.parse(raw)?.distinct_id ?? "") : "";
      } catch { return ""; }
    })();

    const headers = {
      "Content-Type": "application/json",
      "platform": "web",
      "wrtn-locale": "ko-KR",
    };
    if (token) headers["Authorization"] = `Bearer ${token}`;
    if (wrtnId) headers["x-wrtn-id"] = wrtnId;
    if (mpId)   headers["mixpanel-distinct-id"] = mpId;
    return headers;
  }

  // 하위 호환성
  function authHeaders() { return jsonHeaders(); }

  // ==============================================
  //  URL에서 storyId / chatId 파싱
  //  /stories/{storyId}/episodes/{chatId}
  // ==============================================
  function parsePath() {
    const m = location.pathname.match(/\/stories\/([^/]+)\/episodes\/([^/]+)/);
    if (!m) return null;
    return { storyId: m[1], chatId: m[2] };
  }

  function isChattingPage() {
    return !!parsePath();
  }

  // ==============================================
  //  API 헬퍼 (401 시 토큰 갱신 후 1회 자동 재시도)
  // ==============================================
  let _warnedLogin = false;

  async function apiGet(url) {
    let res = await fetch(url, {
      headers: jsonHeaders(),
      credentials: "include",
    });

    // 401: 토큰 만료 -> 갱신 후 1회 재시도
    if (res.status === 401) {
      console.warn("[Crack Session Tool] 401 감지 — 토큰 갱신 후 재시도:", url);
      const refreshed = await tryRefreshToken();
      if (refreshed) {
        res = await fetch(url, {
          headers: jsonHeaders(),
          credentials: "include",
        });
      } else {
        if (!_warnedLogin) {
          _warnedLogin = true;
          alert(
            "인증 토큰이 만료되었고 자동 갱신에 실패했습니다.\n\n" +
            "페이지를 새로고침하거나 재로그인 후 다시 시도해 주세요."
          );
        }
        const text = await res.text().catch(() => "");
        throw new Error(`API 오류 ${res.status}: ${text.slice(0, 200)}`);
      }
    }

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`API 오류 ${res.status}: ${text.slice(0, 200)}`);
    }
    return res.json();
  }

  async function apiPatch(url, body) {
    let res = await fetch(url, {
      method: "PATCH",
      headers: jsonHeaders(),
      credentials: "include",
      body: JSON.stringify(body),
    });

    // 401: 토큰 만료 -> 갱신 후 1회 재시도
    if (res.status === 401) {
      console.warn("[Crack Session Tool] PATCH 401 감지 — 토큰 갱신 후 재시도:", url);
      const refreshed = await tryRefreshToken();
      if (refreshed) {
        res = await fetch(url, {
          method: "PATCH",
          headers: jsonHeaders(),
          credentials: "include",
          body: JSON.stringify(body),
        });
      } else {
        const text = await res.text().catch(() => "");
        throw new Error(`PATCH 오류 ${res.status}: ${text.slice(0, 200)}`);
      }
    }

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`PATCH 오류 ${res.status}: ${text.slice(0, 200)}`);
    }
    return res.json();
  }

  async function fetchAllMessages(chatId) {
    const messages = [];
    let cursor = null;
    let page = 0;

    while (true) {
      if (stopRequested) break;
      page++;
      setStatus(`메시지 로딩 중... (${page}페이지 / 현재 ${messages.length}개)`);

      const url = cursor
        ? `${API_BASE}/v3/chats/${chatId}/messages?limit=50&cursor=${encodeURIComponent(cursor)}`
        : `${API_BASE}/v3/chats/${chatId}/messages?limit=50`;

      const json = await apiGet(url);
      const data = json.data ?? json;
      const batch = data.messages ?? [];

      if (!batch.length) break;
      messages.push(...batch);

      if (!data.hasNext || !data.nextCursor) break;
      cursor = data.nextCursor;
      await sleep(300);
    }

    // API는 최신순 반환 → 역순(오래된 것 먼저)
    messages.reverse();
    return messages;
  }

  /**
   * 전송 전 메시지 수를 기록해두고, 전송 후 새로 생긴 메시지만 반환.
   * limit을 충분히 크게 잡아 경고 메시지가 끼어도 새 메시지를 정확히 식별.
   */
  async function fetchNewMessages(chatId, prevCount) {
    // 넉넉하게 최근 10개를 가져와서 이전에 없던 것만 추린다
    const json = await apiGet(`${API_BASE}/v3/chats/${chatId}/messages?limit=10`);
    const data = json.data ?? json;
    const all = data.messages ?? [];
    // API는 최신순 반환 → 앞쪽이 새것
    // prevCount 이후에 생긴 것 = 전체 메시지 수 - prevCount 개
    return all; // 호출 측에서 role 기준으로 최신 user/bot 1개씩 추림
  }

  async function fetchTotalMessageCount(chatId) {
    const json = await apiGet(`${API_BASE}/v3/chats/${chatId}/messages?limit=1`);
    const data = json.data ?? json;
    // hasNext + nextCursor로 총 개수 파악이 어려우니, 가장 최신 메시지 ID를 앵커로 쓴다
    const msgs = data.messages ?? [];
    return msgs.length > 0 ? (msgs[0]._id ?? msgs[0].id) : null;
  }

  /** 메시지 내용 수정 — 크랙 API는 필드명 'message' 사용 */
  async function editMessage(chatId, messageId, content) {
    return apiPatch(
      `${API_BASE}/v3/chats/${chatId}/messages/${messageId}`,
      { message: content }
    );
  }

  // ==============================================
  //  채팅 모델 관련
  // ==============================================
  /**
   * 채팅방의 현재 모델 정보를 가져옴.
   */
  async function fetchChatInfo(chatId) {
    const json = await apiGet(`${API_BASE}/v3/chats/${chatId}`);
    return json.data ?? json;
  }

  /**
   * 일반챗(normalchat) chatModelId를 다단계로 탐색.
   *
   * 전략 A — __NEXT_DATA__에서 추출:
   *   크랙 SPA는 페이지 로드 시 전체 채팅방·모델 정보를
   *   <script id="__NEXT_DATA__"> 안에 인라인으로 내려준다.
   *   crackerModels 또는 chatModels 배열에서 crackerModel === "normalchat"인
   *   항목의 chatModelId(_id)를 찾는다.
   *
   * 전략 B — 현재 세션 메시지 이력에서 역추출:
   *   페이지에 이미 로드된 메시지들 중 crackerModel이 "normalchat"인
   *   메시지의 chatModelId를 꺼낸다.
   *
   * 전략 C — API 엔드포인트 순차 시도:
   *   /v2/crackers/models, /v3/chat-models, /v2/chat-models
   */
  async function findNormalChatModelId(chatId) {
    // ── 전략 A: __NEXT_DATA__ ──
    try {
      const raw = document.getElementById("__NEXT_DATA__")?.textContent;
      if (raw) {
        const nd = JSON.parse(raw);

        // 방법 A-1: fallback."/v3/chats/{chatId}" 안의 maxOutputSettings에서
        // chatModelId 목록을 꺼낸 뒤, 같은 fallback 안의 메시지들로 역추적
        const chatKey = Object.keys(nd.props?.pageProps?.fallback ?? {})
          .find(k => k.includes("/v3/chats/") && !k.includes("/messages"));
        const chatData = chatKey ? nd.props.pageProps.fallback[chatKey]?.data : null;

        // 방법 A-2: 메시지 목록에서 normalchat 항목의 chatModelId 역추출
        const msgKeys = Object.keys(nd.props?.pageProps?.fallback ?? {})
          .filter(k => k.includes("/messages"));
        for (const mk of msgKeys) {
          const msgs = nd.props.pageProps.fallback[mk]?.data?.messages ?? [];
          const hit = msgs.find(m =>
            (m.crackerModel ?? "").toLowerCase() === NORMAL_CHAT_KEY
          );
          if (hit?.chatModelId) {
            console.log("[Crack Session Tool] normalchat ID found via __NEXT_DATA__ messages:", hit.chatModelId);
            return hit.chatModelId;
          }
        }

        // 방법 A-3: crackerModels / chatModels 배열 직접 탐색
        function searchModels(obj) {
          if (!obj || typeof obj !== "object") return null;
          if (Array.isArray(obj)) {
            for (const item of obj) {
              if (typeof item === "object" && item !== null) {
                const key = (item.crackerModel ?? item.key ?? item.type ?? item.name ?? "").toLowerCase();
                if (key === NORMAL_CHAT_KEY) return item.chatModelId ?? item._id ?? item.id ?? null;
                const deep = searchModels(item);
                if (deep) return deep;
              }
            }
            return null;
          }
          for (const v of Object.values(obj)) {
            const r = searchModels(v);
            if (r) return r;
          }
          return null;
        }
        const fromTree = searchModels(nd.props?.pageProps);
        if (fromTree) {
          console.log("[Crack Session Tool] normalchat ID found via __NEXT_DATA__ tree:", fromTree);
          return fromTree;
        }
      }
    } catch (e) {
      console.warn("[Crack Session Tool] __NEXT_DATA__ 파싱 실패:", e.message);
    }

    // ── 전략 B: DOM 메시지에서 역추출 ──
    try {
      // 이미 렌더링된 메시지 그룹에서 data-cracker-model 속성 탐색
      const groups = document.querySelectorAll("[data-message-group-id]");
      // React fiber로 props 접근 시도
      for (const el of groups) {
        const fiberKey = Object.keys(el).find(k => k.startsWith("__reactFiber") || k.startsWith("__reactInternalInstance"));
        if (!fiberKey) continue;
        let fiber = el[fiberKey];
        let depth = 0;
        while (fiber && depth++ < 30) {
          const p = fiber.memoizedProps ?? fiber.pendingProps;
          if (p?.crackerModel?.toLowerCase() === NORMAL_CHAT_KEY && p?.chatModelId) {
            console.log("[Crack Session Tool] normalchat ID found via React fiber:", p.chatModelId);
            return p.chatModelId;
          }
          fiber = fiber.return;
        }
      }
    } catch (e) {
      console.warn("[Crack Session Tool] React fiber 탐색 실패:", e.message);
    }

    // ── 전략 C: API 순차 시도 ──
    const endpoints = [
      `${API_BASE}/v2/crackers/models`,
      `${API_BASE}/v3/chat-models`,
      `${API_BASE}/v2/chat-models`,
      `${API_BASE}/v1/crackers/models`,
    ];
    for (const url of endpoints) {
      try {
        const json = await apiGet(url);
        const list = json.data ?? json;
        const arr = Array.isArray(list) ? list : (list.models ?? list.crackerModels ?? list.chatModels ?? []);
        const hit = arr.find(m =>
          (m.crackerModel ?? m.key ?? m.type ?? m.name ?? "").toLowerCase() === NORMAL_CHAT_KEY
        );
        if (hit) {
          const id = hit.chatModelId ?? hit._id ?? hit.id;
          if (id) {
            console.log(`[Crack Session Tool] normalchat ID found via API (${url}):`, id);
            return id;
          }
        }
      } catch { /* 다음 시도 */ }
    }

    console.warn("[Crack Session Tool] 모든 전략으로 normalchat ID를 찾지 못했습니다.");
    return null;
  }

  /**
   * 채팅방의 모델을 일반챗으로 전환.
   * PATCH 엔드포인트 두 곳을 순서대로 시도.
   */
  async function switchToNormalChat(chatId) {
    // 이미 일반챗인지 확인
    try {
      const info = await fetchChatInfo(chatId);
      const cur = (info.crackerModel ?? "").toLowerCase();
      if (cur === NORMAL_CHAT_KEY) {
        console.log("[Crack Session Tool] 이미 일반챗입니다.");
        return true;
      }
    } catch { /* 확인 실패 시 변경 시도 계속 */ }

    const normalId = await findNormalChatModelId(chatId);
    if (!normalId) return false;

    const patchTargets = [
      { url: `${API_BASE}/v3/chats/${chatId}/model`, body: { chatModelId: normalId } },
      { url: `${API_BASE}/v3/chats/${chatId}`,       body: { chatModelId: normalId } },
    ];
    for (const pt of patchTargets) {
      try {
        await apiPatch(pt.url, pt.body);
        console.log(`[Crack Session Tool] 일반챗 전환 완료 (${pt.url})`);
        return true;
      } catch (e) {
        console.warn(`[Crack Session Tool] 전환 실패 (${pt.url}):`, e.message);
      }
    }
    return false;
  }

  // ==============================================
  //  DOM: textarea + 전송 버튼 탐색
  //  HTML 분석 결과:
  //    textarea.class.__chat_input_textarea
  //    전송 버튼: style="background-color: rgb(255, 99, 1);" 을 포함하는 버튼
  //              + SVG path d="M18.77 11.13..."
  // ==============================================
  function findTextarea() {
    return (
      document.querySelector("textarea.__chat_input_textarea") ||
      document.querySelector("textarea[placeholder*='메시지']") ||
      document.querySelector("textarea.rc-textarea")
    );
  }

  function findSendButton() {
    // 1순위: 클래스 기반 - 활성 전송 버튼
    const byClass = document.querySelector(
      "button.bg-primary.text-primary-foreground.rounded-full:not([disabled])"
    );
    if (byClass) return byClass;

    // 2순위: 색상 기반 - 일반챗의 전송 버튼
    const byColor = document.querySelector(
      "button[style*='background-color: rgb(255, 99, 1)']:not([disabled])"
    );
    if (byColor) return byColor;

    // 3순위: textarea 컨테이너 내 rounded-full 버튼 중 마지막 것
    const ta = findTextarea();
    if (ta) {
      let container = ta.parentElement;
      for (let i = 0; i < 6 && container; i++) {
        const btns = Array.from(
          container.querySelectorAll("button.rounded-full:not([disabled])")
        );
        if (btns.length) return btns[btns.length - 1];
        container = container.parentElement;
      }
    }

    // 4순위: SVG path 기반 (보조 수단)
    const allPaths = document.querySelectorAll('button svg path');
    for (const path of allPaths) {
      const d = path.getAttribute('d');
      if (d && d.includes('M18.77 11.13')) {
        const btn = path.closest('button');
        if (btn && !btn.disabled) return btn;
      }
    }

    return null;
  }

  /** 중단 버튼 감지 (SVG path 기반) */
  function findStopButton() {
    const allPaths = document.querySelectorAll('button svg path');
    for (const path of allPaths) {
      const d = path.getAttribute('d');
      // 중단 버튼의 정사각형: "M6 6h12v12H6Z"
      if (d && (d.includes('M6 6h12v12H6') || d.includes('M6 6h12v12H6Z'))) {
        return path.closest('button');
      }
    }
    return null;
  }

  // ==============================================
  //  에러 감지 및 재시도 로직
  // ==============================================

  /**
   * 에러 메시지/경고 감지
   * 크랙 플랫폼의 에러는 보통 toast, dialog, alert 형태
   */
  function detectError() {
    // Toast 알림 (일반적인 에러)
    const toasts = document.querySelectorAll('[role="alert"], [role="status"], .toast, [class*="toast"]');
    for (const toast of toasts) {
      const text = toast.textContent.toLowerCase();
      if (text.includes('오류') || text.includes('error') || text.includes('실패') ||
          text.includes('fail') || text.includes('문제') || text.includes('problem')) {
        return { found: true, type: 'toast', element: toast, message: toast.textContent };
      }
    }

    // Dialog/Modal (심각한 에러)
    const dialogs = document.querySelectorAll('[role="dialog"], [role="alertdialog"], .dialog, .modal');
    for (const dialog of dialogs) {
      const style = window.getComputedStyle(dialog);
      if (style.display !== 'none' && style.visibility !== 'hidden') {
        const text = dialog.textContent.toLowerCase();
        if (text.includes('오류') || text.includes('error') || text.includes('실패')) {
          return { found: true, type: 'dialog', element: dialog, message: dialog.textContent };
        }
      }
    }

    // 인라인 에러 메시지
    const errorTexts = document.querySelectorAll('[class*="error"], [class*="Error"]');
    for (const el of errorTexts) {
      const style = window.getComputedStyle(el);
      if (style.display !== 'none' && style.visibility !== 'hidden') {
        const text = el.textContent.trim();
        if (text.length > 5 && text.length < 200) { // 너무 짧거나 긴 것 제외
          return { found: true, type: 'inline', element: el, message: text };
        }
      }
    }

    return { found: false };
  }

  /**
   * 에러 메시지 닫기 시도
   */
  function dismissError(errorInfo) {
    if (!errorInfo || !errorInfo.found) return;

    try {
      const container = errorInfo.element;

      // 닫기 버튼 찾기
      const closeBtn = container.querySelector('button[aria-label*="닫기"], button[aria-label*="close"], button.close, [role="button"][aria-label*="dismiss"]');
      if (closeBtn) {
        console.log('[CST] 에러 메시지 닫기 버튼 클릭');
        closeBtn.click();
        return;
      }

      // ESC 키 시뮬레이션
      if (errorInfo.type === 'dialog') {
        console.log('[CST] ESC 키로 에러 다이얼로그 닫기 시도');
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27 }));
      }
    } catch (err) {
      console.warn('[CST] 에러 메시지 닫기 실패:', err);
    }
  }

  /**
   * 재시도 로직이 포함된 메시지 전송
   * @param {string} text - 전송할 텍스트
   * @param {number} maxRetries - 최대 재시도 횟수 (기본 3회)
   * @returns {Promise<boolean>} 성공 여부
   */
  async function sendMessageWithRetry(text, maxRetries = 3) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        console.log(`[CST] 전송 시도 ${attempt}/${maxRetries}`);

        // 전송 전 에러 확인 및 제거
        const preError = detectError();
        if (preError.found) {
          console.warn(`[CST] 전송 전 에러 감지: ${preError.message.slice(0, 50)}`);
          dismissError(preError);
          await sleep(1000);
        }

        // 메시지 전송
        await sendMessageViaDOM(text);

        // 전송 직후 에러 확인
        await sleep(800);
        const postError = detectError();
        if (postError.found) {
          console.warn(`[CST] 전송 후 에러 감지 (시도 ${attempt}): ${postError.message.slice(0, 80)}`);
          dismissError(postError);

          if (attempt < maxRetries) {
            await sleep(2000); // 재시도 전 대기
            continue;
          } else {
            return false; // 최종 실패
          }
        }

        // 성공
        console.log(`[CST] ✓ 전송 성공 (시도 ${attempt})`);
        return true;

      } catch (err) {
        console.error(`[CST] 전송 시도 ${attempt} 예외:`, err.message);

        if (attempt < maxRetries) {
          await sleep(2000);
        } else {
          return false;
        }
      }
    }
    return false;
  }

  /**
   * 메시지가 에러 메시지인지 판별
   * 크랙 API의 에러 메시지는 편집 불가능하며, 특정 패턴을 가짐
   */
  function isErrorMessage(message) {
    if (!message) return false;

    // 1. role이 system이나 error인 경우
    const role = (message.role ?? "").toLowerCase();
    if (role === "system" || role === "error") {
      console.log('[CST] 에러 메시지 감지 (role):', message._id ?? message.id, role);
      return true;
    }

    // 2. 메시지 타입이 error인 경우
    const messageType = (message.messageType ?? message.type ?? "").toLowerCase();
    if (messageType === "error" || messageType === "warning") {
      console.log('[CST] 에러 메시지 감지 (type):', message._id ?? message.id, messageType);
      return true;
    }

    // 3. isError 플래그가 true인 경우
    if (message.isError === true) {
      console.log('[CST] 에러 메시지 감지 (isError):', message._id ?? message.id);
      return true;
    }

    // 4. content에 에러 패턴이 있는 경우 (보조 수단)
    const content = (message.content ?? "").trim();
    if (content.length > 0 && content.length < 500) {
      const errorPatterns = [
        /오류가 발생했습니다/i,
        /에러가 발생했습니다/i,
        /일시적인 문제가 발생했습니다/i,
        /서버에 문제가 있습니다/i,
        /요청을 처리할 수 없습니다/i,
        /rate limit/i,
        /too many requests/i
      ];

      for (const pattern of errorPatterns) {
        if (pattern.test(content)) {
          console.log('[CST] 에러 메시지 감지 (content pattern):', message._id ?? message.id, content.slice(0, 50));
          return true;
        }
      }
    }

    return false;
  }

  /**
   * 최신 N개 메시지를 가져오되, anchorId 이후에 생긴 것만 필터
   * 에러 메시지 필터링 전/후 데이터를 모두 반환
   */
  async function getNewMessages(chatId, anchorId) {
    const json = await apiGet(`${API_BASE}/v3/chats/${chatId}/messages?limit=10`);
    const data = json.data ?? json;
    const all = data.messages ?? []; // 최신순

    console.log("[CST] getNewMessages raw (최신순):", JSON.stringify(
      all.map(m => ({ id: m._id ?? m.id, role: m.role, content: (m.content ?? "").slice(0, 20) }))
    ));
    console.log("[CST] anchorId:", anchorId);

    // anchorId 이후 메시지만 추출
    let afterAnchor = all;
    if (anchorId) {
      const cutIdx = all.findIndex(m => (m._id ?? m.id) === anchorId);
      console.log("[CST] cutIdx:", cutIdx, "→ newMsgs count:", cutIdx === -1 ? all.length : cutIdx);
      afterAnchor = cutIdx === -1 ? all : all.slice(0, cutIdx);
    }

    // 에러 메시지 필터링
    const beforeFilter = afterAnchor.length;
    const withoutErrors = afterAnchor.filter(m => !isErrorMessage(m));
    const afterFilter = withoutErrors.length;

    if (beforeFilter !== afterFilter) {
      console.warn(`[CST] ⚠ 에러 메시지 ${beforeFilter - afterFilter}개 필터링됨`);
    }

    // 필터링 전/후 데이터 모두 반환
    return {
      all: afterAnchor,           // 에러 포함 전체
      filtered: withoutErrors,     // 에러 제외
      errorCount: beforeFilter - afterFilter
    };
  }

  /**
   * 현재 최신 메시지 ID를 앵커로 기록
   */
  async function getLatestId(chatId) {
    const json = await apiGet(`${API_BASE}/v3/chats/${chatId}/messages?limit=1`);
    const data = json.data ?? json;
    const msgs = data.messages ?? [];
    const id = msgs.length > 0 ? (msgs[0]._id ?? msgs[0].id) : null;
    console.log("[CST] getLatestId →", id, msgs.length > 0 ? `role:${msgs[0].role}` : "(없음)");
    return id;
  }

  /**
   * 메시지 생성 검증 (anchorId 이후 새 메시지 확인)
   * @returns {Object} { success: boolean, userMsg, botMsg, newMsgs, hasErrorOnly: boolean, needsResend: boolean }
   */
  async function verifyAndGetMessages(chatId, anchorId, expectedRoles = ['user', 'assistant']) {
    await sleep(600);

    // API 한 번만 호출
    const result = await getNewMessages(chatId, anchorId);
    const allMsgs = result.all;           // 에러 포함
    const newMsgs = result.filtered;      // 에러 제외
    const hasErrorOnly = allMsgs.length > 0 && newMsgs.length === 0;

    const verification = {
      success: false,
      userMsg: null,
      botMsg: null,
      newMsgs: newMsgs,
      hasErrorOnly: hasErrorOnly,
      needsResend: false
    };

    // 기대하는 role의 메시지가 있는지 확인
    if (expectedRoles.includes('user')) {
      verification.userMsg = newMsgs.find(m => m.role === 'user');
    }
    if (expectedRoles.includes('assistant')) {
      verification.botMsg = newMsgs.find(m => m.role === 'assistant');
    }

    // 최소 1개 이상의 기대 메시지가 있으면 성공
    verification.success = (expectedRoles.includes('user') && verification.userMsg) ||
                           (expectedRoles.includes('assistant') && verification.botMsg) ||
                           (!expectedRoles.includes('user') && !expectedRoles.includes('assistant'));

    // 에러 메시지만 있고 정상 메시지가 없으면 재전송 필요
    if (hasErrorOnly && !verification.success) {
      console.warn('[CST] ⚠ 에러 메시지만 감지됨, 재전송 필요');
      verification.needsResend = true;
    }

    console.log('[CST] 메시지 검증:', {
      newCount: newMsgs.length,
      allCount: allMsgs.length,
      hasUser: !!verification.userMsg,
      hasBot: !!verification.botMsg,
      hasErrorOnly: hasErrorOnly,
      needsResend: verification.needsResend,
      success: verification.success
    });

    return verification;
  }

  /** React controlled input에 값 주입 */
  function setReactValue(el, value) {
    const nativeSetter = Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype,
      "value"
    ).set;
    nativeSetter.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }

  // ==============================================
  //  생성 완료 감지
  //  크랙 HTML 분석:
  //   - 생성 중: 전송 버튼이 비활성화되거나 숨겨짐
  //   - 생성 완료: 전송 버튼 rgb(255,99,1)이 다시 활성화
  //   - 추가 신호: [data-generating], stop 버튼 존재 여부
  // ==============================================
  async function waitForGenerationEnd(timeout = 150_000) {
    const start = Date.now();

    console.log('[CST] === 응답 대기 시작 ===');

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // 1단계: 중단 버튼(정사각형)이 나타날 때까지 대기 (최대 6초)
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    let stopBtn = null;
    const waitForStopStart = Date.now();
    while (Date.now() - waitForStopStart < 6000) {
      if (stopRequested) return;
      stopBtn = findStopButton();
      if (stopBtn) {
        console.log('[CST] ✓ 1단계: 중단 버튼 감지됨 (', Date.now() - waitForStopStart, 'ms)');
        break;
      }
      await sleep(100); // 빠른 폴링
    }

    if (!stopBtn) {
      console.warn('[CST] ⚠ 1단계: 중단 버튼 미감지 (짧은 응답이거나 이미 완료) - 안전 대기 후 종료');
      await sleep(800);
      return;
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // 2단계: 중단 버튼이 사라질 때까지 대기 (응답 생성 중)
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    const waitForDisappearStart = Date.now();
    while (Date.now() - start < timeout) {
      if (stopRequested) return;

      stopBtn = findStopButton();
      if (!stopBtn) {
        console.log('[CST] ✓ 2단계: 중단 버튼 소멸 (응답 완료,', Date.now() - waitForDisappearStart, 'ms)');
        break;
      }
      await sleep(500); // 중간 속도 폴링
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // 3단계: 전송 버튼(재생 삼각형)이 다시 나타날 때까지 대기
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    let sendBtn = null;
    const waitForSendStart = Date.now();
    while (Date.now() - waitForSendStart < 4000) {
      if (stopRequested) return;
      sendBtn = findSendButton();
      if (sendBtn && !sendBtn.disabled) {
        const style = window.getComputedStyle(sendBtn);
        if (style.display !== 'none' && style.visibility !== 'hidden') {
          console.log('[CST] ✓ 3단계: 전송 버튼 재등장 확인 (', Date.now() - waitForSendStart, 'ms)');
          break;
        }
      }
      await sleep(100); // 빠른 폴링
    }

    if (!sendBtn) {
      console.warn('[CST] ⚠ 3단계: 전송 버튼 미감지 - UI 안정화 대기');
    }

    // 최종 안정화: DOM 업데이트 최소 정착 시간만 확보
    await sleep(300);
    console.log('[CST] === 응답 대기 완료 (총', Date.now() - start, 'ms) ===');
  }

  // ==============================================
  //  DOM으로 메시지 전송
  // ==============================================
  async function sendMessageViaDOM(text) {
    const textarea = findTextarea();
    if (!textarea) throw new Error("채팅 입력창을 찾을 수 없습니다.");

    setReactValue(textarea, text);

    // 전송 버튼이 활성화될 때까지 능동 대기 (최대 2초)
    const waitStart = Date.now();
    let sendBtn = null;
    while (Date.now() - waitStart < 2000) {
      sendBtn = findSendButton();
      if (sendBtn && !sendBtn.disabled) {
        const style = window.getComputedStyle(sendBtn);
        if (style.display !== 'none' && style.visibility !== 'hidden') {
          console.log('[CST] 전송 버튼 활성화 확인 (', Date.now() - waitStart, 'ms)');
          break;
        }
      }
      await sleep(50); // 매우 빠른 폴링
    }

    if (!sendBtn) {
      sendBtn = findSendButton();
      if (!sendBtn) throw new Error("전송 버튼을 찾을 수 없습니다.");
    }

    sendBtn.click();

    await waitForGenerationEnd();
  }

  // ==============================================
  //  저장하기
  // ==============================================
  async function exportLog(format) {
    const ids = parsePath();
    if (!ids) { alert("채팅방 페이지에서만 사용 가능합니다."); return; }

    setStatus("메시지 수집 시작...");
    const messages = await fetchAllMessages(ids.chatId);

    if (!messages.length) { alert("메시지가 없습니다."); return; }

    const log = {
      exportedAt: new Date().toISOString(),
      sourceUrl: location.href,
      storyId: ids.storyId,
      chatId: ids.chatId,
      messageCount: messages.length,
      messages: messages
        .filter(m => !m.isPrologue)
        .map(m => ({
          id: m._id ?? m.id,
          role: m.role,
          content: m.content,
          crackerModel: m.crackerModel,
          chatModelId: m.chatModelId,
        })),
    };

    const ts = new Date().toISOString().slice(0, 19).replace("T", "_").replace(/:/g, "-");

    if (format === "browser") {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(log));
    } else if (format === "json") {
      downloadJson(log, `crack_log_${ts}.json`);
    } else if (format === "txt") {
      const txtContent = messagesToText(log.messages);
      downloadText(txtContent, `crack_log_${ts}.txt`);
    }

    const modeLabel = {
      browser: "브라우저에 임시 보관",
      json: "JSON 파일로 다운로드",
      txt: "TXT 파일로 다운로드"
    }[format];

    setStatus(`완료! ${log.messages.length}개 메시지 저장됨`);

    alert(
      `${log.messages.length}개 메시지를 저장했습니다.\n저장 방식: ${modeLabel}\n\n` +
      `이제 새 세션을 만들고 그 채팅방으로 이동한 뒤 다시 [세션 관리] 버튼으로 불러오기를 진행해주세요.`
    );
  }

  // ==============================================
  //  불러오기
  // ==============================================
  async function importLog(logData) {
    const ids = parsePath();
    if (!ids) { alert("채팅방 페이지에서만 사용 가능합니다."); return; }

    let log;
    try {
      log = typeof logData === "string" ? JSON.parse(logData) : logData;
    } catch (e) {
      alert("JSON 파싱 오류: " + e.message);
      return;
    }

    if (!log.messages?.length) {
      alert("이식할 메시지가 없습니다.");
      return;
    }

    // 사전 DOM 검증
    if (!findTextarea()) {
      alert("채팅 입력창을 찾을 수 없습니다.\n페이지가 완전히 로드됐는지 확인해주세요.");
      return;
    }

    if (!confirm(
      `${log.messages.length}개 메시지를 현재 채팅방(${ids.chatId})에 이식합니다.\n\n` +
      `원본: ${log.sourceUrl}\n\n` +
      `⚠️ 이식 전 채팅 모델을 일반챗으로 자동 전환합니다.\n` +
      `⚠️ 이식 중에는 채팅창에서 다른 작업을 하지 마세요.\n` +
      `⚠️ 이식이 끝나기 전에 페이지를 이동하지 마세요.\n\n` +
      `계속하시겠습니까?`
    )) return;

    // 일반챗으로 전환 (비용 절감 + 짧은 응답 유도)
    setStatus("일반챗으로 전환 중...");
    const switched = await switchToNormalChat(ids.chatId);
    if (!switched) {
      if (!confirm("일반챗 전환에 실패했습니다.\n현재 모델 그대로 이식을 계속할까요?\n(유료 크래커가 소모될 수 있습니다)")) return;
    }

    stopRequested = false;

    const messages = log.messages;
    let i = 0;
    let successCount = 0;

    try {
      while (i < messages.length) {
        if (stopRequested) { setStatus("중단됨"); break; }

        const cur = messages[i];

        if (cur.role === "user") {
          const next = messages[i + 1];
          const hasBotNext = next && next.role === "assistant";

          // 전송 전 앵커 ID 기록
          const anchorId = await getLatestId(ids.chatId);

          // ── 유저 + 봇 쌍 ──
          if (hasBotNext) {
            setStatus(`전송 중... (${i + 1}–${i + 2} / ${messages.length})`);

            // 재시도 포함 전송
            const sent = await sendMessageWithRetry(DUMMY_MSG, 3);
            if (!sent) {
              console.error('[CST] ❌ 전송 실패 (최대 재시도 초과)');
              const userChoice = confirm(
                `메시지 ${i + 1}-${i + 2} 전송에 실패했습니다.\n\n` +
                `[확인] = 건너뛰고 계속\n[취소] = 이식 중단`
              );
              if (!userChoice) {
                stopRequested = true;
                break;
              }
              i += 2; // 건너뛰기
              continue;
            }

            if (stopRequested) break;

            // 메시지 검증 및 재시도
            let verified = await verifyAndGetMessages(ids.chatId, anchorId, ['user', 'assistant']);
            let retryCount = 0;

            while (!verified.success && retryCount < 2) {
              retryCount++;

              // 에러 메시지만 감지된 경우 재전송
              if (verified.needsResend) {
                console.warn(`[CST] 에러 메시지 감지, 재전송 시도 ${retryCount}/2`);
                const resentAnchor = await getLatestId(ids.chatId);
                await sendMessageWithRetry(DUMMY_MSG, 2);
                await sleep(1500);
                verified = await verifyAndGetMessages(ids.chatId, resentAnchor, ['user', 'assistant']);
              } else {
                // 단순 재조회
                console.warn(`[CST] 메시지 미확인, 재조회 시도 ${retryCount}/2`);
                await sleep(1500);
                verified = await verifyAndGetMessages(ids.chatId, anchorId, ['user', 'assistant']);
              }
            }

            const userMsg = verified.userMsg;
            const botMsg = verified.botMsg;
            const newMsgs = verified.newMsgs;

            console.log("[CST] newMsgs count:", newMsgs.length, "userMsg:", userMsg ? (userMsg._id ?? userMsg.id) : "없음", "botMsg:", botMsg ? (botMsg._id ?? botMsg.id) : "없음");

            if (userMsg) {
              setStatus(`편집 중... 유저 (${i + 1} / ${messages.length})`);
              console.log("[CST] editMessage user →", userMsg._id ?? userMsg.id);
              const r1 = await editMessage(ids.chatId, userMsg._id ?? userMsg.id, cur.content);
              console.log("[CST] editMessage user 응답:", JSON.stringify(r1)?.slice(0, 100));
              await sleep(500);
              successCount++;
            } else {
              console.warn("[CST] ⚠ userMsg 없음 — 메시지 누락, 건너뛰기");
            }
            if (botMsg) {
              setStatus(`편집 중... 봇 (${i + 2} / ${messages.length})`);
              console.log("[CST] editMessage bot →", botMsg._id ?? botMsg.id);
              const r2 = await editMessage(ids.chatId, botMsg._id ?? botMsg.id, next.content);
              console.log("[CST] editMessage bot 응답:", JSON.stringify(r2)?.slice(0, 100));
              await sleep(500);
              successCount++;
            } else {
              console.warn("[CST] ⚠ botMsg 없음 — 메시지 누락, 건너뛰기");
            }

            i += 2;

          } else {
            // ── 유저 단독 ──
            setStatus(`전송 중... (${i + 1} / ${messages.length})`);

            const sent = await sendMessageWithRetry(DUMMY_MSG, 3);
            if (!sent) {
              console.error('[CST] ❌ 전송 실패 (최대 재시도 초과)');
              const userChoice = confirm(
                `메시지 ${i + 1} 전송에 실패했습니다.\n\n` +
                `[확인] = 건너뛰고 계속\n[취소] = 이식 중단`
              );
              if (!userChoice) {
                stopRequested = true;
                break;
              }
              i++;
              continue;
            }

            if (stopRequested) break;

            let verified = await verifyAndGetMessages(ids.chatId, anchorId, ['user']);
            let retryCount = 0;

            while (!verified.success && retryCount < 2) {
              retryCount++;

              if (verified.needsResend) {
                console.warn(`[CST] 에러 메시지 감지, 재전송 시도 ${retryCount}/2`);
                const resentAnchor = await getLatestId(ids.chatId);
                await sendMessageWithRetry(DUMMY_MSG, 2);
                await sleep(1500);
                verified = await verifyAndGetMessages(ids.chatId, resentAnchor, ['user']);
              } else {
                console.warn(`[CST] 메시지 미확인, 재조회 시도 ${retryCount}/2`);
                await sleep(1500);
                verified = await verifyAndGetMessages(ids.chatId, anchorId, ['user']);
              }
            }

            const userMsg = verified.userMsg;

            if (userMsg) {
              setStatus(`편집 중... (${i + 1} / ${messages.length})`);
              await editMessage(ids.chatId, userMsg._id ?? userMsg.id, cur.content);
              await sleep(500);
              successCount++;
            } else {
              console.warn("[CST] ⚠ userMsg 없음 — 메시지 누락, 건너뛰기");
            }
            i++;
          }

        } else if (cur.role === "assistant") {
          // ── 봇 단독 ──
          const anchorId = await getLatestId(ids.chatId);
          setStatus(`봇 메시지 삽입 중... (${i + 1} / ${messages.length})`);

          const sent = await sendMessageWithRetry(DUMMY_MSG, 3);
          if (!sent) {
            console.error('[CST] ❌ 전송 실패 (최대 재시도 초과)');
            const userChoice = confirm(
              `메시지 ${i + 1} 전송에 실패했습니다.\n\n` +
              `[확인] = 건너뛰고 계속\n[취소] = 이식 중단`
            );
            if (!userChoice) {
              stopRequested = true;
              break;
            }
            i++;
            continue;
          }

          if (stopRequested) break;

          let verified = await verifyAndGetMessages(ids.chatId, anchorId, ['assistant']);
          let retryCount = 0;

          while (!verified.success && retryCount < 2) {
            retryCount++;

            if (verified.needsResend) {
              console.warn(`[CST] 에러 메시지 감지, 재전송 시도 ${retryCount}/2`);
              const resentAnchor = await getLatestId(ids.chatId);
              await sendMessageWithRetry(DUMMY_MSG, 2);
              await sleep(1500);
              verified = await verifyAndGetMessages(ids.chatId, resentAnchor, ['assistant']);
            } else {
              console.warn(`[CST] 메시지 미확인, 재조회 시도 ${retryCount}/2`);
              await sleep(1500);
              verified = await verifyAndGetMessages(ids.chatId, anchorId, ['assistant']);
            }
          }

          const botMsg = verified.botMsg;

          if (botMsg) {
            await editMessage(ids.chatId, botMsg._id ?? botMsg.id, cur.content);
            await sleep(500);
            successCount++;
          } else {
            console.warn("[CST] ⚠ botMsg 없음 — 메시지 누락, 건너뛰기");
          }
          i++;

        } else {
          console.warn(`[Crack Session Tool] 알 수 없는 role: ${cur.role}, 건너뜀`);
          i++;
        }

        // 루프 간 쿨다운 — 서버 rate limiting 대응
        await sleep(2000);
      }

      if (!stopRequested) {
        setStatus("이식 완료!");
        alert(`세션 이식이 완료됐습니다!\n총 ${successCount}개 메시지 이식됨.\n\n페이지를 새로고침해서 확인해보세요.`);
      } else {
        alert(`이식이 중단됐습니다.\n현재까지 ${successCount}개 메시지 이식됨.`);
      }

    } catch (err) {
      alert("오류 발생: " + err.message);
      console.error("[Crack Session Tool]", err);
      setStatus("오류 발생: " + err.message);
    }
  }

  // ==============================================
  //  통합 메뉴: 저장/불러오기 + 옵션 선택
  // ==============================================
  function showMainMenu() {
    return new Promise((resolve) => {
      const saved = localStorage.getItem(STORAGE_KEY);
      let currentMode = "export"; // 'export' or 'import'

      const overlay = document.createElement("div");
      overlay.style.cssText = `
        position:fixed;inset:0;z-index:200000;
        background:rgba(0,0,0,0.6);
        display:flex;align-items:center;justify-content:center;
      `;

      const box = document.createElement("div");
      box.style.cssText = `
        width:380px;background:#1a1a1a;color:#fff;
        border-radius:14px;padding:24px;
        font-family:system-ui,sans-serif;
        box-shadow:0 10px 40px rgba(0,0,0,0.5);
      `;

      const savedInfo = saved ? (() => {
        try {
          const p = JSON.parse(saved);
          return `${p.messages?.length ?? "?"}개 메시지`;
        } catch { return "로그 있음"; }
      })() : null;

      box.innerHTML = `
        <div style="font-size:17px;font-weight:700;margin-bottom:18px;">🔧 세션 관리</div>

        <!-- 모드 선택 -->
        <div style="display:flex;gap:8px;margin-bottom:20px;">
          <button id="mode-export" style="${modeButtonStyle(true)}">💾 저장하기</button>
          <button id="mode-import" style="${modeButtonStyle(false)}">📥 불러오기</button>
        </div>

        <!-- 구분선 -->
        <div style="border-top:1px solid rgba(255,255,255,0.1);margin-bottom:16px;"></div>

        <!-- 옵션 선택 -->
        <div style="display:flex;flex-direction:column;gap:10px;">
          <button id="opt-browser" style="${btnStyleStr('#5E35B1')}">
            🗃️ 브라우저<br><small style="opacity:.7;font-weight:400" id="desc-browser">임시 보관 · 같은 브라우저에서 바로 이식</small>
          </button>
          <button id="opt-json" style="${btnStyleStr('#1565C0')}">
            📂 JSON<br><small style="opacity:.7;font-weight:400" id="desc-json">파일 다운로드 · 다른 기기 이식 가능</small>
          </button>
          <button id="opt-txt" style="${btnStyleStr('#F57C00')}">
            📄 TXT<br><small style="opacity:.7;font-weight:400" id="desc-txt">텍스트 형식 · 에디터로 수정 가능</small>
          </button>
        </div>
      `;

      overlay.appendChild(box);
      document.body.appendChild(overlay);

      const btnModeExport = box.querySelector("#mode-export");
      const btnModeImport = box.querySelector("#mode-import");
      const btnOptBrowser = box.querySelector("#opt-browser");
      const btnOptJson = box.querySelector("#opt-json");
      const btnOptTxt = box.querySelector("#opt-txt");
      const descBrowser = box.querySelector("#desc-browser");
      const descJson = box.querySelector("#desc-json");
      const descTxt = box.querySelector("#desc-txt");

      function updateMode(mode) {
        currentMode = mode;
        const isExport = mode === "export";

        // 모드 버튼 스타일 업데이트
        btnModeExport.style.cssText = modeButtonStyle(isExport);
        btnModeImport.style.cssText = modeButtonStyle(!isExport);

        if (isExport) {
          // 저장 모드
          descBrowser.textContent = "임시 보관 · 같은 브라우저에서 바로 이식";
          descJson.textContent = "파일 다운로드 · 다른 기기 이식 가능";
          descTxt.textContent = "텍스트 형식 · 에디터로 수정 가능";
          btnOptBrowser.disabled = false;
          btnOptJson.disabled = false;
          btnOptTxt.disabled = false;
          btnOptBrowser.style.opacity = "1";
          btnOptJson.style.opacity = "1";
          btnOptTxt.style.opacity = "1";
        } else {
          // 불러오기 모드
          const hasSaved = !!saved;
          descBrowser.textContent = hasSaved ? `${savedInfo} 저장됨` : "저장된 로그 없음";
          descJson.textContent = "JSON 파일 선택 다이얼로그 열기";
          descTxt.textContent = "TXT 파일 선택 · 에디터로 수정 가능";

          btnOptBrowser.disabled = !hasSaved;
          btnOptBrowser.style.opacity = hasSaved ? "1" : "0.4";
          btnOptBrowser.style.cursor = hasSaved ? "pointer" : "not-allowed";

          btnOptJson.disabled = false;
          btnOptJson.style.opacity = "1";
          btnOptJson.style.cursor = "pointer";

          btnOptTxt.disabled = false;
          btnOptTxt.style.opacity = "1";
          btnOptTxt.style.cursor = "pointer";
        }
      }

      function close(val) { overlay.remove(); resolve(val); }

      btnModeExport.onclick = () => updateMode("export");
      btnModeImport.onclick = () => updateMode("import");

      btnOptBrowser.onclick = () => {
        if (currentMode === "export") {
          close({ mode: "export", format: "browser" });
        } else {
          if (saved) close({ mode: "import", source: "browser", data: saved });
        }
      };

      btnOptJson.onclick = () => {
        if (currentMode === "export") {
          close({ mode: "export", format: "json" });
        } else {
          // 파일 선택 다이얼로그
          overlay.remove();
          const input = document.createElement("input");
          input.type = "file";
          input.accept = ".json";
          input.onchange = (e) => {
            const file = e.target.files[0];
            if (!file) { resolve(null); return; }
            const reader = new FileReader();
            reader.onload = (ev) => resolve({ mode: "import", source: "json", data: ev.target.result });
            reader.readAsText(file);
          };
          input.click();
        }
      };

      btnOptTxt.onclick = () => {
        if (currentMode === "export") {
          close({ mode: "export", format: "txt" });
        } else {
          // TXT 파일 불러오기
          overlay.remove();
          const input = document.createElement("input");
          input.type = "file";
          input.accept = ".txt";
          input.onchange = (e) => {
            const file = e.target.files[0];
            if (!file) { resolve(null); return; }
            const reader = new FileReader();
            reader.onload = (ev) => {
              const txtContent = ev.target.result;
              const messages = parseTextToMessages(txtContent);
              if (!messages.length) {
                alert("TXT 파일에서 메시지를 파싱할 수 없습니다.\n형식이 올바른지 확인해주세요.");
                resolve(null);
                return;
              }
              // JSON 형식으로 변환하여 반환
              const log = {
                exportedAt: new Date().toISOString(),
                sourceUrl: "imported_from_txt",
                messageCount: messages.length,
                messages: messages
              };
              resolve({ mode: "import", source: "txt", data: JSON.stringify(log) });
            };
            reader.readAsText(file);
          };
          input.click();
        }
      };

      overlay.onclick = (e) => { if (e.target === overlay) close(null); };

      // 초기 모드 설정
      updateMode("export");
    });
  }

  function modeButtonStyle(active) {
    return `
      flex:1;padding:10px 12px;border-radius:10px;
      border:${active ? 'none' : '1px solid rgba(255,255,255,0.2)'};
      background:${active ? '#5E35B1' : 'transparent'};
      color:white;font-weight:${active ? '700' : '600'};
      cursor:pointer;font-size:13px;
      transition:all 0.2s;
    `;
  }

  function btnStyleStr(bg, border = false) {
    return `
      padding:10px 14px;border-radius:10px;
      border:${border ? '1px solid rgba(255,255,255,0.2)' : 'none'};
      background:${bg};color:white;font-weight:600;
      cursor:pointer;font-size:13px;width:100%;text-align:left;
    `;
  }

  // ==============================================
  //  UI: 플로팅 버튼
  // ==============================================
  function mountButtons() {
    if (!isChattingPage()) {
      removeButtons();
      return;
    }
    if (document.getElementById(BTN_ID_MAIN)) return;

    const btnMain = document.createElement("button");
    btnMain.id = BTN_ID_MAIN;
    btnMain.textContent = "세션 관리";
    btnMain.style.cssText = floatBtnStyle("#5E35B1", "20px");

    btnMain.onclick = async () => {
      // 실행 중이면 중단 요청
      if (running) {
        stopRequested = true;
        btnMain.textContent = "중단 요청됨...";
        btnMain.disabled = true;
        return;
      }

      try {
        const result = await showMainMenu();
        if (!result) return; // 취소

        // 선택 완료 후 버튼을 붉은색 중단 버튼으로 변경
        running = true;
        stopRequested = false;
        btnMain.style.cssText = floatBtnStyle("#B71C1C", "20px");
        btnMain.textContent = "⏹ 중단";
        btnMain.disabled = false; // 중단 가능하도록 활성화

        if (result.mode === "export") {
          await exportLog(result.format);
        } else if (result.mode === "import") {
          await importLog(result.data);
        }
      } catch (e) {
        alert("오류: " + e.message);
        console.error("[Crack Session Tool]", e);
        setStatus("오류: " + e.message);
      } finally {
        running = false;
        stopRequested = false;
        btnMain.disabled = false;
        btnMain.style.cssText = floatBtnStyle("#5E35B1", "20px");
        btnMain.textContent = "세션 관리";
      }
    };

    document.body.appendChild(btnMain);
  }

  function removeButtons() {
    document.getElementById(BTN_ID_MAIN)?.remove();
  }

  function floatBtnStyle(bg, bottom) {
    return `
      position:fixed;bottom:${bottom};right:20px;z-index:99999;
      padding:10px 16px;font-size:13px;font-weight:700;color:white;
      background:${bg};border:none;border-radius:22px;
      cursor:pointer;box-shadow:0 4px 10px rgba(0,0,0,0.35);
      transition:opacity 0.2s;
    `;
  }

  function setStatus(msg) {
    console.log("[Crack Session Tool]", msg);
    const truncated = msg.length > 18 ? msg.slice(0, 18) + "…" : msg;
    const btn = document.getElementById(BTN_ID_MAIN);
    if (btn?.disabled) btn.textContent = truncated;
  }

  // ==============================================
  //  유틸
  // ==============================================
  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  function downloadJson(obj, filename) {
    const blob = new Blob([JSON.stringify(obj, null, 2)], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function downloadText(content, filename) {
    const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  /**
   * 메시지 배열을 읽기 쉬운 TXT 형식으로 변환
   * - 역할 구분 ([사용자] / [AI])
   * - 구분선으로 메시지 분리
   * - 마크다운, 코드블록 등 원본 서식 완전 보존
   */
  function messagesToText(messages) {
    return messages.map(m => {
      const role = m.role === 'user' ? '사용자' : 'AI';
      const content = m.content || '';
      return `[${role}]\n${content}`;
    }).join('\n\n' + '-'.repeat(50) + '\n\n');
  }

  /**
   * TXT 형식을 메시지 배열로 역변환
   * - 50자 구분선 기준으로 섹션 분리
   * - [사용자] / [AI] 태그로 role 파싱
   */
  function parseTextToMessages(txtContent) {
    const separator = '\n\n' + '-'.repeat(50) + '\n\n';
    const sections = txtContent.split(separator);

    return sections.map(section => {
      const trimmed = section.trim();
      if (!trimmed) return null;

      const lines = trimmed.split('\n');
      const firstLine = lines[0];

      // [사용자] 또는 [AI] 태그 추출
      const roleMatch = firstLine.match(/^\[(사용자|AI)\]$/);
      if (!roleMatch) return null;

      const role = roleMatch[1] === '사용자' ? 'user' : 'assistant';
      const content = lines.slice(1).join('\n').trim();

      return { role, content };
    }).filter(m => m !== null);
  }

  // ==============================================
  //  마운트 / SPA 대응
  // ==============================================
  window.addEventListener("load", mountButtons);

  let _lastUrl = location.href;
  new MutationObserver(() => {
    const url = location.href;
    if (url !== _lastUrl) {
      _lastUrl = url;
      setTimeout(mountButtons, 800);
      setTimeout(mountButtons, 1500);
    }
  }).observe(document, { subtree: true, childList: true });

  setInterval(() => {
    if (isChattingPage()) mountButtons();
    else removeButtons();
  }, 2000);

})();
