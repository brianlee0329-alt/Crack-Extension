// ==UserScript==
// @name         Crack Memory Transfer (요약 메모리 이식)
// @namespace    http://tampermonkey.net/
// @version      1.3.0
// @description  요약 메모리 창의 [편집]/[추가] 버튼 옆에 [저장] / [불러오기] 버튼을 추가합니다. 장기·단기 기억 모두 저장하고, 신규 세션의 장기 기억으로 이식합니다.
// @author       -
// @match        https://crack.wrtn.ai/*
// @grant        none
// ==/UserScript==

(function () {
  "use strict";

  const STORAGE_KEY   = "crack-memory-transfer-data";
  const BTN_SAVE_ID   = "cmt-btn-save";
  const BTN_LOAD_ID   = "cmt-btn-load";
  const INJECTED_ATTR = "data-cmt-injected";

  // ─────────────────────────────────────────────
  //  유틸
  // ─────────────────────────────────────────────
  function setReactValue(el, value) {
    const proto  = el.tagName === "TEXTAREA"
      ? window.HTMLTextAreaElement.prototype
      : window.HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value").set;
    setter.call(el, value);
    el.dispatchEvent(new Event("input",  { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  async function waitUntil(cond, timeoutMs) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (cond()) return true;
      await sleep(60);
    }
    return false;
  }

  // ─────────────────────────────────────────────
  //  다이얼로그 헬퍼
  // ─────────────────────────────────────────────
  function getMemoryDialog() {
    for (const d of document.querySelectorAll('[role="dialog"][data-state="open"]')) {
      const h2 = d.querySelector("h2");
      if (h2 && h2.textContent.trim() === "요약 메모리") return d;
    }
    return null;
  }

  function getFooterRow(dialog) {
    for (const btn of dialog.querySelectorAll("button[type='button']")) {
      if (btn.textContent.trim() === "편집") return btn.parentElement;
    }
    return null;
  }

  // ─────────────────────────────────────────────
  //  탭 버튼 헬퍼
  //  탭 행: div.flex.space-x-2.px-6.pb-5 안의 버튼들
  // ─────────────────────────────────────────────
  function getTabBtn(dialog, label) {
    const tabRow = dialog.querySelector("div.flex.space-x-2.px-6.pb-5");
    if (!tabRow) return null;
    return Array.from(tabRow.querySelectorAll("button"))
      .find(b => b.textContent.trim() === label) || null;
  }

  // 현재 활성 탭 레이블
  function getActiveTabLabel(dialog) {
    const tabRow = dialog.querySelector("div.flex.space-x-2.px-6.pb-5");
    if (!tabRow) return null;
    const active = tabRow.querySelector("button.bg-primary");
    return active ? active.textContent.trim() : null;
  }

  // 탭 클릭 후 컨텐츠 전환 대기
  async function clickTabAndWait(dialog, label) {
    const btn = getTabBtn(dialog, label);
    if (!btn) return false;
    if (btn.classList.contains("bg-primary")) return true; // 이미 활성

    btn.click();
    // 탭 버튼이 bg-primary 로 바뀔 때까지 대기
    await waitUntil(() => btn.classList.contains("bg-primary"), 2000);
    await sleep(200); // 컨텐츠 렌더링 여유
    return true;
  }

  // ─────────────────────────────────────────────
  //  총 개수 읽기
  // ─────────────────────────────────────────────
  function getTotalCount(dialog) {
    const span = dialog.querySelector("span.text-gray-2");
    if (!span) return null;
    const m = span.textContent.match(/(\d+)/);
    return m ? parseInt(m[1], 10) : null;
  }

  // ─────────────────────────────────────────────
  //  스크롤 컨테이너
  // ─────────────────────────────────────────────
  function getScrollContainer(dialog) {
    return dialog.querySelector("div.overflow-y-auto.h-\\[272px\\]");
  }

  // ─────────────────────────────────────────────
  //  아코디언 항목 수집
  // ─────────────────────────────────────────────
  function getAccordionItems(dialog) {
    const titleBtns = dialog.querySelectorAll(
      "h3 > button[data-radix-collection-item]"
    );
    const seen  = new Set();
    const items = [];
    for (const btn of titleBtns) {
      let el = btn.parentElement;
      while (el && !(el.dataset.orientation === "vertical" && el.tagName !== "H3")) {
        el = el.parentElement;
      }
      if (el && !seen.has(el)) {
        seen.add(el);
        items.push({ root: el, titleBtn: btn });
      }
    }
    return items;
  }

  // ─────────────────────────────────────────────
  //  지연 로드 해소 (20개 단위 스크롤 로딩)
  // ─────────────────────────────────────────────
  async function ensureAllLoaded(dialog, setBtnText) {
    const total = getTotalCount(dialog);
    if (total === null) return;

    const container = getScrollContainer(dialog);
    if (!container) return;

    let prev = -1;
    let stuckCount = 0;

    while (stuckCount < 5) {
      const current = getAccordionItems(dialog).length;
      if (current >= total) break;

      if (setBtnText) setBtnText(`로딩 중… (${current}/${total})`);

      container.scrollTo({ top: container.scrollHeight, behavior: "smooth" });
      await sleep(500);

      const after = getAccordionItems(dialog).length;
      stuckCount = (after === prev) ? stuckCount + 1 : 0;
      prev = after;
    }

    container.scrollTo({ top: 0, behavior: "smooth" });
    await sleep(200);
  }

  // ─────────────────────────────────────────────
  //  아코디언 항목 내용 읽기 (닫혀 있으면 열기)
  // ─────────────────────────────────────────────
  async function readAccordionContent(titleBtn) {
    const wasOpen = titleBtn.getAttribute("aria-expanded") === "true";

    if (!wasOpen) {
      titleBtn.click();
      await waitUntil(() => {
        const rid = titleBtn.getAttribute("aria-controls");
        if (!rid) return false;
        const r = document.getElementById(rid);
        return r && !r.hidden;
      }, 1000);
    }

    const rid = titleBtn.getAttribute("aria-controls");
    let content = "";
    if (rid) {
      const region = document.getElementById(rid);
      if (region) {
        const inner = region.querySelector("div");
        content = (inner ? inner.textContent : region.textContent).trim();
      }
    }

    if (!wasOpen) {
      titleBtn.click();
      await sleep(80);
    }

    return content;
  }

  // ─────────────────────────────────────────────
  //  장기 기억 수집
  // ─────────────────────────────────────────────
  async function collectLongTerm(dialog, setBtnText) {
    await clickTabAndWait(dialog, "장기 기억");
    await ensureAllLoaded(dialog, setBtnText);

    const items = [];
    const accordionItems = getAccordionItems(dialog);

    for (let i = 0; i < accordionItems.length; i++) {
      const { titleBtn } = accordionItems[i];

      let title = "";
      for (const node of titleBtn.childNodes) {
        if (node.nodeType === Node.TEXT_NODE) title += node.textContent;
      }
      title = title.trim();
      if (!title) continue;

      if (setBtnText) setBtnText(`장기 기억 읽는 중… (${i + 1}/${accordionItems.length})`);
      const content = await readAccordionContent(titleBtn);
      items.push({ title, content });
    }

    // 최신순 → reverse → 오래된 것 먼저
    items.reverse();
    return items;
  }

  // ─────────────────────────────────────────────
  //  단기 기억 수집
  //  단기 기억은 기본 오픈 상태이므로 아코디언 여부를 자동 감지
  //  ① 아코디언(data-radix-collection-item) 구조면 open 상태로 바로 읽기
  //  ② 아코디언 없이 단순 div 카드 구조면 텍스트 직접 읽기
  // ─────────────────────────────────────────────
  async function collectShortTerm(dialog, setBtnText) {
    const ok = await clickTabAndWait(dialog, "단기 기억");
    if (!ok) return []; // 단기 기억 탭 없으면 빈 배열

    await sleep(300);

    const container = getScrollContainer(dialog);
    const items = [];

    // ── 케이스 A: 아코디언 구조 (장기 기억과 동일)
    const accordionItems = getAccordionItems(dialog);
    if (accordionItems.length > 0) {
      // 단기 기억도 지연 로드 가능성 고려
      await ensureAllLoaded(dialog, setBtnText);
      const refreshed = getAccordionItems(dialog);

      for (let i = 0; i < refreshed.length; i++) {
        const { titleBtn } = refreshed[i];

        let title = "";
        for (const node of titleBtn.childNodes) {
          if (node.nodeType === Node.TEXT_NODE) title += node.textContent;
        }
        title = title.trim();
        if (!title) continue;

        if (setBtnText) setBtnText(`단기 기억 읽는 중… (${i + 1}/${refreshed.length})`);
        // 단기 기억은 기본 오픈이므로 이미 열려 있을 가능성 높음 → readAccordionContent가 처리
        const content = await readAccordionContent(titleBtn);
        items.push({ title, content });
      }

      items.reverse();
      return items;
    }

    // ── 케이스 B: 단순 카드 구조 (아코디언 없음)
    //    예상 패턴: div.border-b > [제목 span/p] + [내용 div/p]
    if (container) {
      // 제목+내용 쌍을 가진 카드들 탐색
      // border-b 로 구분된 각 행
      const cards = container.querySelectorAll("div.border-b, div[class*='border-b']");

      for (let i = 0; i < cards.length; i++) {
        const card = cards[i];
        const allText = card.innerText || card.textContent || "";
        const lines = allText.split("\n").map(l => l.trim()).filter(Boolean);

        if (lines.length >= 2) {
          items.push({ title: lines[0], content: lines.slice(1).join("\n").trim() });
        } else if (lines.length === 1) {
          items.push({ title: lines[0], content: "" });
        }

        if (setBtnText) setBtnText(`단기 기억 읽는 중… (${i + 1}/${cards.length})`);
      }

      // 카드 구조도 없을 경우: 컨테이너 전체 텍스트를 단일 항목으로
      if (items.length === 0 && container.textContent.trim()) {
        items.push({ title: "단기 기억", content: container.textContent.trim() });
      }

      // 최신순 → reverse → 오래된 것 먼저
      items.reverse();
    }

    return items;
  }

  // ─────────────────────────────────────────────
  //  저장
  // ─────────────────────────────────────────────
  async function saveMemories(dialog) {
    const saveBtn = document.getElementById(BTN_SAVE_ID);
    const set = t => { if (saveBtn) saveBtn.textContent = t; };
    if (saveBtn) saveBtn.disabled = true;

    set("읽는 중…");

    // ① 장기 기억
    const longTerm  = await collectLongTerm(dialog, set);

    // ② 단기 기억 (탭이 있을 경우)
    const shortTerm = await collectShortTerm(dialog, set);

    // ③ 원래 탭(장기 기억)으로 복귀
    await clickTabAndWait(dialog, "장기 기억");

    const total = longTerm.length + shortTerm.length;

    if (total === 0) {
      toast("저장할 메모리 항목이 없습니다.", "warn");
      if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = "저장"; }
      return;
    }

    const payload = {
      savedAt:    new Date().toISOString(),
      sourceUrl:  location.href,
      longTerm,
      shortTerm,
    };

    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));

    if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = "저장"; }

    const parts = [];
    if (longTerm.length  > 0) parts.push(`장기 ${longTerm.length}개`);
    if (shortTerm.length > 0) parts.push(`단기 ${shortTerm.length}개`);
    toast(`${parts.join(" + ")} 저장 완료!`, "success");
  }

  // ─────────────────────────────────────────────
  //  불러오기
  //  장기 기억 + 단기 기억 항목 모두 → 장기 기억 탭에서 [추가]로 삽입
  // ─────────────────────────────────────────────
  async function loadMemories(dialog) {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) { toast("저장된 메모리가 없습니다.", "warn"); return; }

    let data;
    try { data = JSON.parse(raw); }
    catch (e) { toast("저장 데이터 파싱 오류: " + e.message, "error"); return; }

    // 이전 버전 호환 (items 키 사용 시)
    const longTerm  = data.longTerm  || data.items || [];
    const shortTerm = data.shortTerm || [];
    const allItems  = [...longTerm, ...shortTerm];

    if (allItems.length === 0) {
      toast("이식할 항목이 없습니다.", "warn");
      return;
    }

    const savedAt = new Date(data.savedAt).toLocaleString("ko-KR");
    const parts = [];
    if (longTerm.length  > 0) parts.push(`장기 ${longTerm.length}개`);
    if (shortTerm.length > 0) parts.push(`단기 ${shortTerm.length}개`);

    if (!confirm(
      `저장된 메모리 (${parts.join(" + ")})를 불러옵니다.\n\n` +
      `저장 시각: ${savedAt}\n` +
      `저장 출처: ${data.sourceUrl}\n\n` +
      `장기 기억 탭에 순서대로 추가됩니다.\n` +
      `⚠️ 진행 중에는 창을 닫거나 다른 조작을 하지 마세요.\n\n` +
      `계속하시겠습니까?`
    )) return;

    // 장기 기억 탭 활성화
    await clickTabAndWait(dialog, "장기 기억");

    const footerRow = getFooterRow(dialog);
    if (!footerRow) { toast("[추가] 버튼 행을 찾을 수 없습니다.", "error"); return; }

    const getAddBtn = () =>
      Array.from(footerRow.querySelectorAll("button")).find(
        b => b.textContent.trim() === "추가" && !b.disabled
      );

    if (!getAddBtn()) { toast("[추가] 버튼을 찾을 수 없습니다.", "error"); return; }

    const loadBtnEl = document.getElementById(BTN_LOAD_ID);
    const set = t => { if (loadBtnEl) loadBtnEl.textContent = t; };
    if (loadBtnEl) loadBtnEl.disabled = true;

    let successCount = 0;

    for (let i = 0; i < allItems.length; i++) {
      const { title, content } = allItems[i];
      const isShort = i >= longTerm.length;
      const label   = isShort ? "[단기→장기]" : "";

      const addBtn = getAddBtn();
      if (!addBtn) { toast(`항목 ${i + 1} 실패: [추가] 버튼 없음`, "error"); break; }

      addBtn.click();
      await sleep(500);

      const newDialog = await waitForDialog(
        t => ["신규 메모리", "메모리 추가", "새 메모리"].some(s => t.includes(s)),
        3000
      );

      if (!newDialog) {
        toast(`항목 ${i + 1} 실패: 입력 폼 열리지 않음`, "error");
        break;
      }

      const titleInput  = newDialog.querySelector("input[name='title'], input[type='text']");
      const contentArea = newDialog.querySelector("textarea");

      if (!titleInput || !contentArea) {
        toast(`항목 ${i + 1} 실패: 입력 필드 없음`, "error");
        const cancelBtn = Array.from(newDialog.querySelectorAll("button"))
          .find(b => b.textContent.trim() === "취소");
        if (cancelBtn) cancelBtn.click();
        break;
      }

      setReactValue(titleInput,  title);
      await sleep(150);
      setReactValue(contentArea, content);
      await sleep(200);

      const submitBtn = newDialog.querySelector("button[type='submit']")
        || Array.from(newDialog.querySelectorAll("button")).find(
             b => b.textContent.trim() === "추가" && !b.disabled
           );

      if (!submitBtn) {
        toast(`항목 ${i + 1} 실패: 제출 버튼 없음`, "error");
        const cancelBtn = Array.from(newDialog.querySelectorAll("button"))
          .find(b => b.textContent.trim() === "취소");
        if (cancelBtn) cancelBtn.click();
        break;
      }

      await waitUntil(() => !submitBtn.disabled, 1500);
      submitBtn.click();
      await sleep(700);

      successCount++;
      set(`이식 중… ${label}(${successCount}/${allItems.length})`);
      await sleep(200);
    }

    if (loadBtnEl) { loadBtnEl.disabled = false; loadBtnEl.textContent = "불러오기"; }
    if (successCount > 0) toast(`${successCount}/${allItems.length}개 이식 완료!`, "success");
  }

  // ─────────────────────────────────────────────
  //  조건 만족 다이얼로그 대기
  // ─────────────────────────────────────────────
  async function waitForDialog(titleTest, timeoutMs) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      for (const d of document.querySelectorAll('[role="dialog"][data-state="open"]')) {
        const h2 = d.querySelector("h2");
        if (h2 && titleTest(h2.textContent)) return d;
      }
      await sleep(100);
    }
    return null;
  }

  // ─────────────────────────────────────────────
  //  버튼 생성
  // ─────────────────────────────────────────────
  function createBtn(id, label, accentColor) {
    const btn = document.createElement("button");
    btn.id   = id;
    btn.type = "button";
    btn.textContent = label;
    btn.className = [
      "relative inline-flex items-center justify-center gap-1",
      "overflow-hidden whitespace-nowrap text-sm font-medium",
      "transition-colors duration-200",
      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus",
      "disabled:pointer-events-none disabled:opacity-50",
      "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg]:fill-current",
      "h-9 rounded-md px-4 py-2 [&_svg]:size-4",
      "border border-solid border-border bg-background text-foreground",
      "hover:bg-accent active:bg-accent/80",
    ].join(" ");
    btn.style.borderColor = accentColor;
    btn.style.color       = accentColor;
    return btn;
  }

  // ─────────────────────────────────────────────
  //  토스트
  // ─────────────────────────────────────────────
  function toast(msg, type = "info") {
    const palette = { success:"#16a34a", warn:"#d97706", error:"#dc2626", info:"#2563eb" };
    const el = document.createElement("div");
    el.textContent = msg;
    el.style.cssText = `
      position:fixed;bottom:24px;left:50%;transform:translateX(-50%);
      z-index:999999;background:#1a1a1a;color:#fff;
      padding:10px 18px;border-radius:8px;
      font-size:13px;font-family:system-ui,sans-serif;
      border-left:4px solid ${palette[type]||palette.info};
      box-shadow:0 4px 16px rgba(0,0,0,.4);
      pointer-events:none;opacity:1;transition:opacity .4s;
    `;
    document.body.appendChild(el);
    setTimeout(() => { el.style.opacity="0"; setTimeout(()=>el.remove(),400); }, 2800);
  }

  // ─────────────────────────────────────────────
  //  버튼 주입
  // ─────────────────────────────────────────────
  function injectButtons(dialog) {
    const footerRow = getFooterRow(dialog);
    if (!footerRow) return;
    if (footerRow.hasAttribute(INJECTED_ATTR)) return;
    footerRow.setAttribute(INJECTED_ATTR, "1");

    const saveBtn = createBtn(BTN_SAVE_ID, "저장", "#7c3aed");
    saveBtn.title = "장기·단기 기억 전체를 브라우저에 저장";
    saveBtn.addEventListener("click", e => {
      e.stopPropagation();
      const dlg = getMemoryDialog();
      dlg ? saveMemories(dlg) : toast("요약 메모리 창을 찾을 수 없습니다.", "error");
    });

    const loadBtn = createBtn(BTN_LOAD_ID, "불러오기", "#0369a1");
    loadBtn.title = "저장된 메모리를 현재 세션 장기 기억에 이식";
    loadBtn.addEventListener("click", e => {
      e.stopPropagation();
      const dlg = getMemoryDialog();
      dlg ? loadMemories(dlg) : toast("요약 메모리 창을 찾을 수 없습니다.", "error");
    });

    // 순서: [저장] [불러오기] [편집] [추가]
    const editBtn = Array.from(footerRow.querySelectorAll("button"))
      .find(b => b.textContent.trim() === "편집");
    footerRow.insertBefore(loadBtn, editBtn);
    footerRow.insertBefore(saveBtn, loadBtn);
  }

  // ─────────────────────────────────────────────
  //  MutationObserver
  // ─────────────────────────────────────────────
  new MutationObserver(() => {
    const d = getMemoryDialog();
    if (d) injectButtons(d);
  }).observe(document.body, {
    subtree: true, childList: true,
    attributes: true, attributeFilter: ["data-state"],
  });

  const existing = getMemoryDialog();
  if (existing) injectButtons(existing);

})();