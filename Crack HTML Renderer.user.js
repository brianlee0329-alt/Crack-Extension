// ==UserScript==
// @name         Crack HTML Renderer
// @namespace    http://tampermonkey.net/
// @version      1.0.0
// @description  Crack(crack.wrtn.ai) 채팅 메시지 내 HTML 코드를 감지, 직접 DOM에 렌더링합니다.
// @author       -
// @match        https://crack.wrtn.ai/*
// @grant        GM_addStyle
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  // ============================================================
  //  전역 스타일
  // ============================================================
  GM_addStyle(`

    /* ── 공통 컨테이너 ───────────────────────────────────────── */
    .crk-html-root {
      margin: 5px 0 3px;
      font-family: inherit;
      font-size: 14px;
      line-height: 1.65;
      word-break: break-word;
      overflow-wrap: anywhere;
    }

    /* ── 조건부 색상 상속 ────────────────────────────── */
    .crk-html-root p:not([style*="color"]),
    .crk-html-root strong:not([style*="color"]),
    .crk-html-root b:not([style*="color"]),
    .crk-html-root em:not([style*="color"]),
    .crk-html-root i:not([style*="color"]),
    .crk-html-root span:not([style*="color"]) {
      color: inherit !important;
      background: transparent !important;
    }

    /* ── 조건부 div 배경 투명화 ───────────────────────── */
    .crk-html-root div:not([style*="background"]) {
      background: transparent !important;
    }

    /* ── 기본 HTML 태그 본연의 기능 강제 복구 (CSS Reset 무력화) ── */

    .crk-html-root p {
      display: block !important;
      margin: 0.75em 0 !important;
    }
    .crk-html-root p:first-child { margin-top: 0 !important; }
    .crk-html-root p:last-child { margin-bottom: 0 !important; }

    .crk-html-root strong, .crk-html-root b { font-weight: bold !important; }
    .crk-html-root em, .crk-html-root i { font-style: italic !important; }

    /* ── [수정됨] 목록 태그(ul, ol) 강제 보호 ─────────────────
       목록 기호가 잘리지 않도록 왼쪽 여백을 충분히(1.5em) 강제 확보하고
       목록 기호가 정상적으로 보이도록 스타일을 강제합니다. */
    .crk-html-root ul {
      list-style-type: disc !important;
      padding-left: 1.8em !important;
      margin: 4px 0 8px !important;
    }
    .crk-html-root ol {
      list-style-type: decimal !important;
      padding-left: 1.8em !important;
      margin: 4px 0 8px !important;
    }
    .crk-html-root li {
      display: list-item !important;
      margin-bottom: 4px !important;
    }


    /* ── <details> 최소 스타일 (원형 복귀) ──────────────── */
    .crk-html-root details {
      margin: 3px 0;
      border-radius: 4px;
      overflow: hidden; /* 이 속성 때문에 여백이 없으면 점이 잘립니다 */
      border: 1px solid rgba(0, 0, 0, 0.08);
      background: transparent !important;
    }

    .crk-html-root summary {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 6px 11px;
      cursor: pointer;
      font-size: 13px;
      font-weight: 500;
      background: rgba(0, 0, 0, 0.02);
      list-style: none;
      user-select: none;
      transition: background 0.15s;
    }
    .crk-html-root summary::-webkit-details-marker { display: none; }
    .crk-html-root summary::before {
      content: '▶';
      font-size: 9px;
      flex-shrink: 0;
      opacity: .6;
      transition: transform .15s, opacity .15s;
    }
    .crk-html-root summary:hover { background: rgba(0, 0, 0, 0.04); }
    .crk-html-root summary:hover::before { opacity: 1; }

    .crk-html-root details[open] > summary {
      border-bottom: 1px solid rgba(0, 0, 0, 0.08);
    }
    .crk-html-root details[open] > summary::before {
      transform: rotate(90deg);
    }
    .crk-html-root details > :not(summary) {
      padding: 8px 12px;
      font-size: 13px;
      line-height: 1.65;
    }

    /* ── <aside> 박스 스타일 (시각적 강조용) ─────────────── */
    .crk-html-root aside {
      margin: 6px 0;
      padding: 12px;
      border-radius: 8px;
      border: 1px solid #c9dff7;
      background: #f5f9ff;
    }

    .crk-html-root aside:not([style*="color"]) {
      color: #2c2b28;
    }

    /* ── 다크 테마 ───────────────────────────────────────────── */
    body[data-theme="dark"] .crk-html-root details {
      border-color: rgba(255, 255, 255, 0.08);
      background: transparent !important;
    }
    body[data-theme="dark"] .crk-html-root summary {
      background: rgba(255, 255, 255, 0.02);
    }
    body[data-theme="dark"] .crk-html-root summary:hover {
      background: rgba(255, 255, 255, 0.04);
    }
    body[data-theme="dark"] .crk-html-root details[open] > summary {
      border-bottom-color: rgba(255, 255, 255, 0.08);
    }

    body[data-theme="dark"] .crk-html-root aside {
      border-color: #2a3f5c;
      background: #1a2535;
    }

    body[data-theme="dark"] .crk-html-root aside:not([style*="color"]) {
      color: #d4d3cd;
    }

    /* ── 부가 기본 요소 ───────────────────────────────────────────── */
    .crk-html-root a  { color: var(--text_action_blue_secondary, #1a88ff); }
    .crk-html-root img { max-width: 100%; border-radius: 8px; display: block; }
    .crk-html-root hr {
      border: none;
      border-top: 1px solid var(--divider_secondary, #dbdad5);
      margin: 10px 0;
    }
    .crk-html-root h1, .crk-html-root h2,
    .crk-html-root h3, .crk-html-root h4 {
      margin: .7em 0 .35em; font-weight: 700; line-height: 1.3;
    }
    .crk-html-root table {
      border-collapse: collapse; width: 100%; font-size: 13px; margin: 6px 0;
    }
    .crk-html-root th, .crk-html-root td {
      border: 1px solid var(--divider_secondary, #dbdad5); padding: 5px 8px;
    }
    .crk-html-root th { background: var(--surface_secondary, #f0efeb); font-weight: 600; }
    .crk-html-root code {
      background: var(--surface_secondary, #f0efeb);
      padding: 1px 5px; border-radius: 4px;
      font-family: 'Consolas', 'Courier New', monospace; font-size: .88em;
    }
    .crk-html-root pre {
      background: var(--surface_secondary, #f0efeb);
      padding: 10px 12px; border-radius: 6px; overflow-x: auto;
      white-space: pre-wrap; margin: 6px 0;
    }
    .crk-html-root pre code { background: none; padding: 0; }
  `);

  // ============================================================
  //  상수 / 상태
  // ============================================================

  const RENDER_ATTR  = 'data-crk-rendered';
  const processedSet = new WeakSet();
  const timers       = new WeakMap();
  const MIN_LEN      = 30;
  const BLOCK_TAGS = ['details', 'div', 'section', 'article', 'aside'];

  // ============================================================
  //  처리 큐 (debounce 600ms)
  // ============================================================

  function queueProcessing(mdEl) {
    if (processedSet.has(mdEl)) return;
    if (timers.has(mdEl)) clearTimeout(timers.get(mdEl));
    timers.set(mdEl, setTimeout(() => {
      timers.delete(mdEl);
      processMarkdownEl(mdEl);
    }, 600));
  }

  // ============================================================
  //  핵심 처리
  // ============================================================

  function processMarkdownEl(mdEl) {
    if (processedSet.has(mdEl)) return;
    processedSet.add(mdEl);

    const blocks = collectBlocks(mdEl);
    for (const block of blocks) {
      if (block.fragmented) {
        injectFragmented(block);
      } else {
        injectDirectly(block.node, block.html);
      }
    }
  }

  function collectBlocks(root) {
    const complete    = [];
    const fragmented  = [];
    const usedNodes   = new WeakSet();

    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (node.parentElement?.closest(`[${RENDER_ATTR}]`)) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });

    let node;
    while ((node = walker.nextNode())) {
      if (usedNodes.has(node)) continue;
      const text = node.textContent.trim();
      if (!text || text.length < MIN_LEN) continue;

      const completedTag = getCompleteBlockTag(text);
      if (completedTag) {
        complete.push({ node, html: text, tag: completedTag, fragmented: false });
        continue;
      }

      const openingTag = getOpeningOnlyTag(text);
      if (openingTag) {
        const assembled = assembleFragmented(node, text, openingTag, usedNodes);
        if (assembled) fragmented.push(assembled);
      }
    }

    const all = [...complete, ...fragmented];

    return all.filter(({ html: a }) =>
      !all.some(({ html: b }) => b !== a && b.includes(a))
    );
  }

  function getCompleteBlockTag(text) {
    for (const tag of BLOCK_TAGS) {
      if (new RegExp(`<${tag}[\\s>/]`, 'i').test(text) &&
          new RegExp(`</${tag}>`, 'i').test(text)) return tag;
    }
    return null;
  }

  function getOpeningOnlyTag(text) {
    for (const tag of BLOCK_TAGS) {
      if (new RegExp(`^\\s*<${tag}[\\s>/]`, 'i').test(text) &&
          !new RegExp(`</${tag}>`, 'i').test(text)) return tag;
    }
    return null;
  }

  function assembleFragmented(openingNode, openingText, tag, usedNodes) {
    const closeRe = new RegExp(`</\\s*${tag}\\s*>`, 'i');

    let bodyHTML   = openingText;
    const extraNodes = [];
    let closingNode  = null;
    let depth        = 1;

    let sibling = openingNode.nextSibling;
    let guard   = 0;

    while (sibling && guard++ < 50) {
      if (sibling.nodeType === Node.TEXT_NODE) {
        const t = sibling.textContent;
        const opens  = (t.match(new RegExp(`<${tag}[\\s>/]`, 'gi')) || []).length;
        const closes = (t.match(closeRe) || []).length;

        depth += opens - closes;
        bodyHTML += t;

        if (depth <= 0) {
          closingNode = sibling;
          break;
        }
        extraNodes.push(sibling);
      } else if (sibling.nodeType === Node.ELEMENT_NODE) {
        bodyHTML += sibling.outerHTML;
        extraNodes.push(sibling);
      }
      sibling = sibling.nextSibling;
    }

    if (!closingNode) return null;

    usedNodes.add(openingNode);
    extraNodes.forEach(n => usedNodes.add(n));
    usedNodes.add(closingNode);

    return {
      node:       openingNode,
      html:       bodyHTML,
      tag,
      fragmented: true,
      extraNodes,
      closingNode,
    };
  }

  function injectDirectly(textNode, html) {
    const anchor = wrapHidden(textNode);
    const wrapper = createWrapper(html);
    if (wrapper) anchor.insertAdjacentElement('afterend', wrapper);
  }

  function injectFragmented(block) {
    const { node, html, extraNodes, closingNode } = block;
    const anchor = wrapHidden(node);
    const wrapper = createWrapper(html);
    if (wrapper) anchor.insertAdjacentElement('afterend', wrapper);

    extraNodes.forEach(n => n.remove());

    if (closingNode) {
      const remaining = closingNode.textContent.replace(/<\/\w+>/gi, '').trim();
      if (remaining) {
        closingNode.textContent = remaining;
      } else {
        closingNode.remove();
      }
    }
  }

  function wrapHidden(textNode) {
    const anchor = document.createElement('span');
    anchor.style.display = 'none';
    textNode.parentNode.insertBefore(anchor, textNode);
    anchor.appendChild(textNode);
    return anchor;
  }

  function createWrapper(html) {
    const frag = parseHTML(html);
    if (!frag) return null;

    const wrapper = document.createElement('div');
    wrapper.setAttribute(RENDER_ATTR, '1');
    wrapper.className = 'crk-html-root';
    wrapper.appendChild(frag);
    return wrapper;
  }

  function parseHTML(html) {
    const cleaned = html
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g,  '<')
      .replace(/&gt;/g,  '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'");

    const template = document.createElement('template');
    template.innerHTML = cleaned;
    const frag = template.content;

    frag.querySelectorAll('[node]').forEach(el => el.removeAttribute('node'));
    frag.querySelectorAll('script, link[rel="stylesheet"]').forEach(el => el.remove());

    return frag;
  }

  const observer = new MutationObserver(mutations => {
    for (const mutation of mutations) {
      for (const added of mutation.addedNodes) {
        if (added.nodeType !== Node.ELEMENT_NODE) continue;
        if (added.classList?.contains('wrtn-markdown')) { queueProcessing(added); continue; }
        added.querySelectorAll?.('div.wrtn-markdown').forEach(queueProcessing);
        const parentMd = added.closest?.('div.wrtn-markdown');
        if (parentMd) queueProcessing(parentMd);
      }
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });

  function processExisting() {
    document.querySelectorAll('div.wrtn-markdown').forEach(el => {
      if (el.closest('[data-message-group-id]')) queueProcessing(el);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', processExisting);
  } else {
    setTimeout(processExisting, 800);
  }

  let lastPath = location.pathname;
  setInterval(() => {
    if (location.pathname !== lastPath) {
      lastPath = location.pathname;
      setTimeout(processExisting, 1000);
    }
  }, 500);

})();
