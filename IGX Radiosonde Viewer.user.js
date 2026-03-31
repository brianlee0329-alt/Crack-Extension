// ==UserScript==
// @name         IGX Radiosonde Viewer
// @namespace    igx-crack-rs-unified
// @version      1.1.0
// @description  라디오존데 상태 표시 + 점수 기반 IGX 알림 기능
// @match        https://crack.wrtn.ai/*
// @grant        GM_addStyle
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @connect      rs.igx.kr
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  // ────────────────────────────────────────────────────────────
  //  모델 목록 & 상수
  // ────────────────────────────────────────────────────────────
  const MODELS = [
    { slug: 'claude-opus-4.6',   label: 'Claude 4.6 Opus',   short: 'O4.6' },
    { slug: 'claude-sonnet-4.6', label: 'Claude 4.6 Sonnet', short: 'S4.6' },
    { slug: 'gemini-3-1-pro',    label: 'Gemini 3.1 Pro',    short: 'G3.1' },
    { slug: 'gemini-2.5-pro',    label: 'Gemini 2.5 Pro',    short: 'G2.5' },
  ];

  const API_BASE = 'https://rs.igx.kr/api/simple/';
  const POLL_MS  = 60_000;

  // ── GM 스토리지 키 (IGX Alert와 동일한 키 사용 → 설정 호환)
  const KEY = {
    watched:    'rsalert_watched',
    threshold:  'rsalert_threshold',
    sound:      'rsalert_sound',
    volume:     'rsalert_volume',
    popup:      'rsalert_popup',
    prevScores: 'rsalert_prev_scores',
    visibility: 'igx_rs_crack_vis_v1',
  };

  // ────────────────────────────────────────────────────────────
  //  GM 스토리지 헬퍼
  // ────────────────────────────────────────────────────────────
  function load(key, def) {
    try { const v = GM_getValue(key, null); return v === null ? def : v; } catch { return def; }
  }
  function save(key, val) { try { GM_setValue(key, val); } catch {} }
  function loadJSON(key, def) { try { return JSON.parse(load(key, null)) ?? def; } catch { return def; } }
  function saveJSON(key, val) { save(key, JSON.stringify(val)); }

  // ────────────────────────────────────────────────────────────
  //  API 헬퍼
  // ────────────────────────────────────────────────────────────
  function gmGetJson(url, timeoutMs = 6000) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: 'GET', url, timeout: timeoutMs,
        headers: { Accept: 'application/json' },
        onload:   (res) => { try { resolve(JSON.parse(res.responseText)); } catch (e) { reject(e); } },
        onerror:  reject,
        ontimeout: () => reject(new Error('timeout')),
      });
    });
  }

  function fmt2(x) { const n = Number(x); return Number.isFinite(n) ? n.toFixed(2) : null; }
  function fmt0(x) { const n = Number(x); return Number.isFinite(n) ? Math.round(n).toString() : null; }
  function latencySeconds(v) {
    const n = Number(v);
    if (!Number.isFinite(n)) return null;
    return (n >= 50 ? n / 1000 : n).toFixed(2);
  }

  // ────────────────────────────────────────────────────────────
  //  인메모리 최신 데이터
  // ────────────────────────────────────────────────────────────
  const lastData = new Map(); // slug → { status, score, lat, scoreNum }

  // 점수 → 색상 (≥70 녹색 / ≥50 노란색 / ≤40 붉은색 / 나머지 null=기본색)
  function scoreColor(scoreNum) {
    if (!Number.isFinite(scoreNum)) return null;
    if (scoreNum >= 70) return '#1d9e5c';
    if (scoreNum >= 50) return '#c8a000';
    if (scoreNum <= 40) return '#e84040';
    return null; // 41–49: 지정 없음 → 기본 텍스트 색
  }

  // ────────────────────────────────────────────────────────────
  //  오디오 (IGX Alert 엔진)
  // ────────────────────────────────────────────────────────────
  let _ctx = null;
  function getCtx() {
    if (!_ctx) { try { _ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch { return null; } }
    if (_ctx.state === 'suspended') _ctx.resume();
    return _ctx;
  }

  function _playTones(pairs) {
    const ctx = getCtx(); if (!ctx) return;
    const vol = Math.min(100, Math.max(0, Number(load(KEY.volume, 70)))) / 100 * 0.5;
    pairs.forEach(([hz, t, dur]) => {
      try {
        const osc = ctx.createOscillator(), gain = ctx.createGain();
        osc.connect(gain); gain.connect(ctx.destination);
        osc.type = 'sine';
        osc.frequency.setValueAtTime(hz, ctx.currentTime + t);
        gain.gain.setValueAtTime(0, ctx.currentTime + t);
        gain.gain.linearRampToValueAtTime(vol, ctx.currentTime + t + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + t + dur);
        osc.start(ctx.currentTime + t);
        osc.stop(ctx.currentTime + t + dur + 0.05);
      } catch {}
    });
  }
  const beep     = () => _playTones([[880, 0, 0.28], [1108, 0.20, 0.22]]);
  const beepDrop = () => _playTones([[600, 0, 0.25], [440,  0.18, 0.30]]);

  // ────────────────────────────────────────────────────────────
  //  인앱 토스트 (IGX Alert 스타일)
  // ────────────────────────────────────────────────────────────
  function updateToastPos() {
    const wrap = document.getElementById('crs-toast-wrap');
    if (!wrap || !btnBarEl) return;
    const rect = btnBarEl.getBoundingClientRect();
    // 버튼 바로 아래, 버튼 오른쪽 끝에 우측 정렬
    wrap.style.top   = (rect.bottom + 6) + 'px';
    wrap.style.right = (window.innerWidth - rect.right) + 'px';
  }

  function getToastWrap() {
    let w = document.getElementById('crs-toast-wrap');
    if (!w) { w = document.createElement('div'); w.id = 'crs-toast-wrap'; document.body.appendChild(w); }
    updateToastPos();
    return w;
  }

  function showToast(label, score, isDrop) {
    const t = document.createElement('div');
    t.className = isDrop ? 'crs-toast crs-drop' : 'crs-toast';
    t.innerHTML = isDrop
      ? `<div class="crs-toast-title">⚠️ 점수 기준치 이탈</div><div class="crs-toast-model">${label}</div><div class="crs-toast-score">${score}점으로 하락</div>`
      : `<div class="crs-toast-title">✅ 서버 상태 회복</div><div class="crs-toast-model">${label}</div><div class="crs-toast-score">${score}점 도달</div>`;
    getToastWrap().appendChild(t);
    setTimeout(() => {
      t.style.animation = 'crs-out 0.28s ease forwards';
      setTimeout(() => t.remove(), 300);
    }, 5500);
  }

  function sysNotify(label, score, isDrop) {
    if (Notification.permission !== 'granted') return;
    try {
      new Notification(isDrop ? 'Radiosonde — 점수 기준치 이탈' : 'Radiosonde — 상태 회복', {
        body: `${label} → ${score}점${isDrop ? '으로 하락' : ' 도달'}`,
        tag:  `rsalert-${isDrop ? 'drop-' : ''}${label}`,
      });
    } catch {}
  }

  function fireAlert(label, score, isDrop) {
    if (load(KEY.sound, true)) isDrop ? beepDrop() : beep();
    if (load(KEY.popup, true)) {
      if (Notification.permission === 'granted') sysNotify(label, score, isDrop);
      else showToast(label, score, isDrop);
    } else {
      showToast(label, score, isDrop);
    }
  }

  // ────────────────────────────────────────────────────────────
  //  알림 엣지 검출 (IGX Alert 핵심 로직 — API 점수 기반으로 이식)
  // ────────────────────────────────────────────────────────────
  function checkAlerts(freshScores) {
    // freshScores: Map<slug, scoreNum(NaN이면 데이터 없음)>
    const watched   = loadJSON(KEY.watched,   {});
    const threshold = Number(load(KEY.threshold, 70));
    const prev      = loadJSON(KEY.prevScores, {});

    const saveMap = {};
    const hits = [], drops = [];

    for (const m of MODELS) {
      const curScore  = freshScores.get(m.slug);
      const prevScore = m.slug in prev ? Number(prev[m.slug]) : null;

      if (Number.isFinite(curScore)) saveMap[m.slug] = curScore;
      if (!watched[m.slug] || !Number.isFinite(curScore)) continue;

      const wasBelow = prevScore === null || prevScore < threshold;
      const wasAbove = prevScore !== null && prevScore >= threshold;

      // 상승 엣지: 임계값 미만 → 이상 (상태 회복)
      if (wasBelow && curScore >= threshold) hits.push({ m, score: curScore });
      // 하락 엣지: 임계값 이상 → 미만 (기준치 이탈)
      if (wasAbove && curScore < threshold)  drops.push({ m, score: curScore });
    }

    // 이번 사이클 점수 저장 (다음 체크의 prev)
    saveJSON(KEY.prevScores, { ...prev, ...saveMap });

    if (hits.length)  setTimeout(() => hits.forEach(h  => fireAlert(h.m.label, h.score, false)), 900);
    if (drops.length) setTimeout(() => drops.forEach(d => fireAlert(d.m.label, d.score, true)),  900);
  }

  // ────────────────────────────────────────────────────────────
  //  표시 모델 가시성 상태
  // ────────────────────────────────────────────────────────────
  let visibility = {};
  try { visibility = JSON.parse(localStorage.getItem(KEY.visibility)) || {}; } catch {}
  MODELS.forEach(m => { if (visibility[m.slug] === undefined) visibility[m.slug] = true; });
  function saveVisibility() { try { localStorage.setItem(KEY.visibility, JSON.stringify(visibility)); } catch {} }

  // ────────────────────────────────────────────────────────────
  //  상태 클래스 유틸
  // ────────────────────────────────────────────────────────────
  const STATUS_CLS = ['crs-s-active', 'crs-s-degraded', 'crs-s-impacted', 'crs-s-unknown'];
  function setStateClass(el, status) {
    el.classList.remove(...STATUS_CLS);
    el.classList.add(`crs-s-${['active','degraded','impacted'].includes(status) ? status : 'unknown'}`);
  }
  function upperStatus(s) {
    const v = String(s || 'unknown').toUpperCase();
    return ['ACTIVE','DEGRADED','IMPACTED'].includes(v) ? v : 'UNKNOWN';
  }

  // ────────────────────────────────────────────────────────────
  //  UI 참조 (buildPanel에서 초기화)
  // ────────────────────────────────────────────────────────────
  const uiRows     = new Map();  // slug → { row, stateEl, metricEl }
  let footerTsEl   = null;       // 타임스탬프 span
  let barChipsEl   = null;
  let btnBarEl     = null;
  let panelEl      = null;
  let panelOpen    = false;
  let renderWatchedModelList = () => {}; // buildAlertPane에서 실체화

  // ────────────────────────────────────────────────────────────
  //  갱신 루프: fetch → 상태 UI → 알림 체크
  // ────────────────────────────────────────────────────────────
  async function refreshAll() {
    if (footerTsEl) footerTsEl.textContent = '갱신중…';

    const results = await Promise.allSettled(
      MODELS.map(m => gmGetJson(API_BASE + encodeURIComponent(m.slug)))
    );

    const freshScores = new Map();

    for (let i = 0; i < MODELS.length; i++) {
      const m  = MODELS[i];
      const ui = uiRows.get(m.slug);
      if (!ui) continue; // 패널 미빌드 시 스킵

      const res = results[i];
      if (res.status !== 'fulfilled' || !res.value?.success) {
        setStateClass(ui.row, 'unknown');
        ui.stateEl.querySelector('.crs-stxt').textContent = 'ERROR';
        ui.metricEl.textContent = '요청 실패';
        lastData.set(m.slug, { status: 'unknown', score: '—', lat: '—', scoreNum: NaN });
        freshScores.set(m.slug, NaN);
        continue;
      }

      const d      = res.value.data;
      const status = d.status || 'unknown';
      const lat    = latencySeconds(d.latency);
      const tps    = fmt2(d.tps);
      const score  = fmt0(d.score);
      const scoreNum = Number.isFinite(Number(d.score)) ? Math.round(Number(d.score)) : NaN;
      const fail   = Number.isFinite(Number(d.failureCount)) ? Number(d.failureCount) : 0;

      setStateClass(ui.row, status);
      ui.stateEl.querySelector('.crs-stxt').textContent = upperStatus(status);

      const scoreHtml = score != null
        ? `<span class="crs-score" style="color:${scoreColor(scoreNum) ?? 'inherit'}">${score}점</span>`
        : `<span class="crs-score">—점</span>`;
      const failHtml  = fail > 0 ? ` · <span class="crs-fail">실패 ${fail}</span>` : '';
      ui.metricEl.innerHTML = `응답 ${lat ?? '—'}s · TPS ${tps ?? '—'} · ${scoreHtml}${failHtml}`;

      lastData.set(m.slug, { status, score: score ?? '—', lat: lat ?? '—', scoreNum });
      freshScores.set(m.slug, scoreNum);
    }

    renderBarChips();
    renderWatchedModelList();
    updateBarBtn();
    if (footerTsEl) footerTsEl.textContent = `수신 ${new Date().toLocaleTimeString()}`;
    checkAlerts(freshScores);
  }

  // ── 바 버튼에 알림 ON 표시 갱신
  function updateBarBtn() {
    if (!btnBarEl) return;
    const watched = loadJSON(KEY.watched, {});
    btnBarEl.classList.toggle('crs-alert-on', Object.values(watched).some(Boolean));
  }

  // ── 헤더 내 바 칩 렌더링
  function renderBarChips() {
    if (!barChipsEl) return;
    const visible = MODELS.filter(m => visibility[m.slug]);
    if (visible.length === 0) {
      barChipsEl.innerHTML = '<span style="opacity:0.40;font-size:13px;">—</span>';
      return;
    }
    barChipsEl.innerHTML = visible.map(m => {
      const d      = lastData.get(m.slug) || {};
      const status = d.status  || 'unknown';
      const score  = d.score   ?? '—';
      const sc     = scoreColor(d.scoreNum);
      const sStyle = sc ? ` style="color:${sc}"` : '';
      // dot 없이: 풀네임 + 점수만, 구분자는 CSS border-left로 처리
      return `<span class="crs-bc crs-bc-${status}"><span class="crs-bname">${m.label}</span><span class="crs-bscore"${sStyle}>${score}</span></span>`;
    }).join('');
  }

  // ────────────────────────────────────────────────────────────
  //  스타일 주입
  // ────────────────────────────────────────────────────────────
  function injectStyles() {
    if (document.getElementById('crs-style')) return;
    const el = document.createElement('style');
    el.id = 'crs-style';
    el.textContent = `
      /* ═══ 상단 바 버튼 ═══ */
      #crs-bar-btn {
        display: inline-flex; align-items: center; gap: 0;
        padding: 0 14px; height: 40px; flex-shrink: 0;
        border-radius: 8px;
        border: 1px solid rgba(255,255,255,0.18);
        background: rgba(255,255,255,0.05);
        color: rgba(255,255,255,0.80);
        font-size: 13px; cursor: pointer; white-space: nowrap;
        font-family: system-ui,-apple-system,'Noto Sans KR',sans-serif;
        transition: background 0.15s, border-color 0.15s;
        max-width: 1000px; overflow: hidden;
      }
      body:not([data-theme="dark"]) #crs-bar-btn {
        border-color: rgba(0,0,0,0.15);
        background: rgba(0,0,0,0.03);
        color: rgba(0,0,0,0.70);
      }
      #crs-bar-btn:hover { background: rgba(255,255,255,0.10); border-color: rgba(255,255,255,0.28); }
      body:not([data-theme="dark"]) #crs-bar-btn:hover { background: rgba(0,0,0,0.07); border-color: rgba(0,0,0,0.22); }
      #crs-bar-btn.crs-alert-on { border-color: rgba(80,210,130,0.60); }
      #crs-bar-chips { display: flex; align-items: center; gap: 0; overflow: hidden; }

      /* ── 바 인라인 갱신 버튼 ── */
      #crs-refresh-btn {
        display: flex; align-items: center; justify-content: center;
        width: 28px; height: 28px; flex-shrink: 0;
        border-radius: 6px; border: 1px solid rgba(255,255,255,0.16);
        background: transparent; color: inherit;
        font-size: 15px; line-height: 1; cursor: pointer;
        transition: background 0.15s, border-color 0.15s;
        margin-right: 8px;
      }
      #crs-refresh-btn:hover { background: rgba(255,255,255,0.12); border-color: rgba(255,255,255,0.30); }
      body:not([data-theme="dark"]) #crs-refresh-btn { border-color: rgba(0,0,0,0.16); }
      body:not([data-theme="dark"]) #crs-refresh-btn:hover { background: rgba(0,0,0,0.08); border-color: rgba(0,0,0,0.28); }
      #crs-refresh-btn.spinning { animation: crs-spin 0.6s linear; }
      @keyframes crs-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }

      /* ── 바 칩: 구분자 방식 단일 블럭 ── */
      .crs-bc {
        display: inline-flex; align-items: center; gap: 6px;
        padding: 0 12px; font-size: 13px;
        border-left: 1px solid rgba(255,255,255,0.14);
      }
      .crs-bc:first-child { border-left: none; padding-left: 0; }
      body:not([data-theme="dark"]) .crs-bc { border-left-color: rgba(0,0,0,0.12); }
      .crs-bname { font-weight: 600; opacity: .80; }
      .crs-bscore { font-weight: 800; }
      .crs-bc-active   .crs-bscore { /* scoreColor()로 인라인 처리 */ }
      .crs-bc-degraded .crs-bscore { /* scoreColor()로 인라인 처리 */ }
      .crs-bc-impacted .crs-bscore { /* scoreColor()로 인라인 처리 */ }

      /* ═══ 드롭다운 패널 ═══ */
      #crs-panel {
        position: fixed; top: 60px; z-index: 99999;
        width: 300px; max-height: calc(100vh - 60px); overflow-y: auto;
        background: rgba(16,16,24,0.98);
        border: 1px solid rgba(255,255,255,0.12); border-top: none;
        border-radius: 0 0 12px 12px;
        backdrop-filter: blur(16px); -webkit-backdrop-filter: blur(16px);
        box-shadow: 0 14px 42px rgba(0,0,0,0.55);
        font-family: system-ui,-apple-system,'Noto Sans KR',sans-serif;
        font-size: 13px; color: rgba(255,255,255,0.82);
        display: none;
        scrollbar-width: thin; scrollbar-color: rgba(255,255,255,0.12) transparent;
      }
      #crs-panel::-webkit-scrollbar { width: 4px; }
      #crs-panel::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.12); border-radius: 4px; }
      #crs-panel.open { display: block; }
      body:not([data-theme="dark"]) #crs-panel {
        background: rgba(245,245,250,0.98);
        border-color: rgba(0,0,0,0.12);
        color: rgba(0,0,0,0.82);
        box-shadow: 0 14px 42px rgba(0,0,0,0.18);
      }

      /* ── 탭 바 ── */
      #crs-tabs {
        display: flex; border-bottom: 1px solid rgba(255,255,255,0.08);
        position: sticky; top: 0; background: rgba(16,16,24,0.98);
        backdrop-filter: blur(16px); z-index: 1;
      }
      body:not([data-theme="dark"]) #crs-tabs {
        border-bottom-color: rgba(0,0,0,0.08);
        background: rgba(245,245,250,0.98);
      }
      .crs-tab {
        flex: 1; padding: 9px 0; font-size: 12px; font-weight: 600;
        text-align: center; cursor: pointer;
        color: rgba(255,255,255,0.35);
        border-bottom: 2px solid transparent;
        border-top: none; border-left: none; border-right: none;
        background: transparent;
        transition: color 0.15s, border-color 0.15s;
        letter-spacing: 0.1px;
      }
      body:not([data-theme="dark"]) .crs-tab { color: rgba(0,0,0,0.32); }
      .crs-tab.active { color: rgba(100,220,160,1); border-bottom-color: rgba(100,220,160,0.80); }
      body:not([data-theme="dark"]) .crs-tab.active { color: rgba(18,155,75,1); border-bottom-color: rgba(18,155,75,0.80); }

      /* ── 탭 콘텐츠 ── */
      .crs-tab-pane { display: none; padding: 10px 12px 16px; }
      .crs-tab-pane.active { display: block; }

      /* 패널 상단 버튼 행 */
      #crs-panel-actions {
        display: flex; gap: 6px; justify-content: flex-end;
        padding: 8px 12px 0; position: sticky; top: 0; z-index: 2;
        pointer-events: none;
      }
      #crs-panel-actions > * { pointer-events: auto; }
      .crs-panel-btn {
        font-size: 11px; padding: 3px 9px; border-radius: 5px;
        border: 1px solid rgba(255,255,255,0.13);
        background: rgba(16,16,24,0.92);
        color: rgba(255,255,255,0.48); cursor: pointer;
        transition: background 0.15s, color 0.15s;
      }
      body:not([data-theme="dark"]) .crs-panel-btn {
        border-color: rgba(0,0,0,0.13); background: rgba(245,245,250,0.92); color: rgba(0,0,0,0.45);
      }
      .crs-panel-btn:hover { background: rgba(255,255,255,0.10); color: rgba(255,255,255,0.85); }
      body:not([data-theme="dark"]) .crs-panel-btn:hover { background: rgba(0,0,0,0.07); color: rgba(0,0,0,0.80); }

      /* ═══ 상태 탭: 모델 행 ═══ */
      .crs-row { padding: 6px 0; border-bottom: 1px solid rgba(255,255,255,0.07); }
      body:not([data-theme="dark"]) .crs-row { border-bottom-color: rgba(0,0,0,0.07); }
      .crs-row:last-of-type { border-bottom: none; }
      .crs-rtop { display: flex; justify-content: space-between; align-items: center; gap: 4px; }
      .crs-rname {
        font-size: 11.5px; font-weight: 600; color: rgba(255,255,255,0.88);
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis; flex: 1; min-width: 0;
      }
      body:not([data-theme="dark"]) .crs-rname { color: rgba(0,0,0,0.82); }
      .crs-rstate { font-size: 10px; font-weight: 700; flex-shrink: 0; white-space: nowrap; }
      .crs-dot { width: 6px; height: 6px; border-radius: 999px; display: inline-block; margin-right: 3px; vertical-align: middle; }
      .crs-metric { margin-top: 3px; font-size: 10.5px; color: rgba(255,255,255,0.52); line-height: 1.35; }
      body:not([data-theme="dark"]) .crs-metric { color: rgba(0,0,0,0.48); }
      .crs-score { font-weight: 800; }
      .crs-fail  { font-weight: 800; color: #ff9b9b; }

      .crs-s-active   .crs-dot   { background: #1d9e5c; }
      .crs-s-active   .crs-stxt  { color: #1d9e5c; }
      .crs-s-degraded .crs-dot   { background: #b88a00; }
      .crs-s-degraded .crs-stxt  { color: #b88a00; }
      .crs-s-impacted .crs-dot   { background: #ff5c5c; }
      .crs-s-impacted .crs-stxt  { color: #ff5c5c; }
      .crs-s-unknown  .crs-dot   { background: #9aa0a6; }
      .crs-s-unknown  .crs-stxt  { color: #9aa0a6; }

      body:not([data-theme="dark"]) .crs-s-active   .crs-dot   { background: #1da851; }
      body:not([data-theme="dark"]) .crs-s-active   .crs-stxt  { color: #1da851; }

      /* 푸터 */
      #crs-status-foot {
        display: flex; justify-content: space-between; align-items: center;
        margin-top: 8px; padding-top: 6px;
        border-top: 1px solid rgba(255,255,255,0.06);
        font-size: 10px; color: rgba(255,255,255,0.38);
      }
      body:not([data-theme="dark"]) #crs-status-foot { border-top-color: rgba(0,0,0,0.06); color: rgba(0,0,0,0.35); }
      #crs-status-foot a { color: rgba(120,200,255,0.85); text-decoration: none; border-bottom: 1px dotted rgba(120,200,255,0.35); }
      body:not([data-theme="dark"]) #crs-status-foot a { color: rgba(25,110,210,0.85); border-bottom-color: rgba(25,110,210,0.35); }

      /* 표시 모델 설정 */
      .crs-set-row {
        display: flex; align-items: center;
        padding: 5px 0; border-bottom: 1px solid rgba(255,255,255,0.05);
        font-size: 11px; color: rgba(255,255,255,0.70);
      }
      body:not([data-theme="dark"]) .crs-set-row { border-bottom-color: rgba(0,0,0,0.05); color: rgba(0,0,0,0.68); }
      .crs-set-row:last-child { border-bottom: none; }
      .crs-set-label { display: flex; align-items: center; gap: 6px; cursor: pointer; flex: 1; margin: 0; }
      .crs-set-chk   { width: 13px; height: 13px; accent-color: #1d9e5c; cursor: pointer; flex-shrink: 0; }

      /* ═══ 알림 탭 (IGX Alert 스타일 이식) ═══ */
      .crs-section { margin-bottom: 14px; }
      .crs-section-label {
        font-size: 10.5px; font-weight: 700;
        color: rgba(255,255,255,0.28); letter-spacing: 0.8px;
        text-transform: uppercase; margin-bottom: 8px;
      }
      body:not([data-theme="dark"]) .crs-section-label { color: rgba(0,0,0,0.28); }
      .crs-toggle-row { display: flex; align-items: center; justify-content: space-between; padding: 5px 0; }
      .crs-toggle-text { font-size: 12.5px; color: rgba(255,255,255,0.72); }
      body:not([data-theme="dark"]) .crs-toggle-text { color: rgba(0,0,0,0.68); }
      .crs-toggle-sub { font-size: 10.5px; color: rgba(255,255,255,0.28); margin-top: 1px; }
      body:not([data-theme="dark"]) .crs-toggle-sub { color: rgba(0,0,0,0.28); }

      .crs-sw { position: relative; width: 36px; height: 20px; flex-shrink: 0; }
      .crs-sw input { opacity: 0; width: 0; height: 0; position: absolute; }
      .crs-sw-track {
        position: absolute; inset: 0;
        background: rgba(255,255,255,0.10); border-radius: 20px;
        cursor: pointer; transition: background 0.2s;
      }
      body:not([data-theme="dark"]) .crs-sw-track { background: rgba(0,0,0,0.10); }
      .crs-sw-track::before {
        content: ''; position: absolute;
        width: 14px; height: 14px; left: 3px; top: 3px;
        background: rgba(255,255,255,0.45); border-radius: 50%;
        transition: transform 0.2s, background 0.2s;
      }
      body:not([data-theme="dark"]) .crs-sw-track::before { background: rgba(0,0,0,0.28); }
      .crs-sw input:checked + .crs-sw-track { background: rgba(70,195,115,0.50); }
      .crs-sw input:checked + .crs-sw-track::before { transform: translateX(16px); background: rgba(90,230,135,1); }

      .crs-vol-row { display: flex; align-items: center; gap: 8px; padding: 4px 0 3px; }
      .crs-vol-icon { font-size: 13px; flex-shrink: 0; width: 18px; text-align: center; color: rgba(255,255,255,0.50); }
      body:not([data-theme="dark"]) .crs-vol-icon { color: rgba(0,0,0,0.42); }
      .crs-vol-slider {
        flex: 1; -webkit-appearance: none; appearance: none;
        height: 3px; border-radius: 3px;
        background: rgba(255,255,255,0.12); outline: none; cursor: pointer;
      }
      body:not([data-theme="dark"]) .crs-vol-slider { background: rgba(0,0,0,0.12); }
      .crs-vol-slider::-webkit-slider-thumb {
        -webkit-appearance: none; width: 14px; height: 14px;
        border-radius: 50%; background: rgba(255,255,255,0.75); cursor: pointer;
      }
      .crs-vol-slider::-moz-range-thumb {
        width: 14px; height: 14px; border: none;
        border-radius: 50%; background: rgba(255,255,255,0.75); cursor: pointer;
      }
      .crs-vol-val { font-family: monospace; font-size: 11px; color: rgba(255,255,255,0.38); flex-shrink: 0; width: 26px; text-align: right; }
      body:not([data-theme="dark"]) .crs-vol-val { color: rgba(0,0,0,0.35); }
      .crs-test-btn {
        font-size: 10.5px; padding: 2px 8px; border-radius: 4px;
        border: 1px solid rgba(255,255,255,0.13); background: rgba(255,255,255,0.05);
        color: rgba(255,255,255,0.42); cursor: pointer; flex-shrink: 0; transition: background 0.15s;
      }
      body:not([data-theme="dark"]) .crs-test-btn { border-color: rgba(0,0,0,0.12); background: rgba(0,0,0,0.04); color: rgba(0,0,0,0.40); }
      .crs-test-btn:hover { background: rgba(255,255,255,0.11); color: rgba(255,255,255,0.80); }

      .crs-score-row { display: flex; align-items: center; gap: 10px; padding: 6px 0; }
      .crs-score-label { font-size: 12.5px; color: rgba(255,255,255,0.72); flex: 1; }
      body:not([data-theme="dark"]) .crs-score-label { color: rgba(0,0,0,0.68); }
      .crs-score-input {
        width: 58px; background: rgba(255,255,255,0.07);
        border: 1px solid rgba(255,255,255,0.15); border-radius: 6px;
        color: rgba(255,255,255,0.90); font-family: monospace;
        font-size: 13px; padding: 4px 8px; text-align: center; outline: none;
        transition: border-color 0.2s;
      }
      body:not([data-theme="dark"]) .crs-score-input { background: rgba(0,0,0,0.05); border-color: rgba(0,0,0,0.15); color: rgba(0,0,0,0.85); }
      .crs-score-input:focus { border-color: rgba(100,175,255,0.60); }
      .crs-score-unit { font-size: 11px; color: rgba(255,255,255,0.28); }
      body:not([data-theme="dark"]) .crs-score-unit { color: rgba(0,0,0,0.28); }

      .crs-divider { border: none; border-top: 1px solid rgba(255,255,255,0.07); margin: 10px 0 12px; }
      body:not([data-theme="dark"]) .crs-divider { border-top-color: rgba(0,0,0,0.07); }

      .crs-model-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
      .crs-model-actions { display: flex; gap: 5px; }
      .crs-mini-btn {
        font-size: 10.5px; padding: 2px 8px; border-radius: 4px;
        border: 1px solid rgba(255,255,255,0.13); background: rgba(255,255,255,0.05);
        color: rgba(255,255,255,0.42); cursor: pointer; transition: background 0.15s;
      }
      body:not([data-theme="dark"]) .crs-mini-btn { border-color: rgba(0,0,0,0.12); background: rgba(0,0,0,0.04); color: rgba(0,0,0,0.40); }
      .crs-mini-btn:hover { background: rgba(255,255,255,0.11); color: rgba(255,255,255,0.80); }

      .crs-model-list { display: flex; flex-direction: column; gap: 3px; }
      .crs-model-item {
        display: flex; align-items: center; gap: 8px; padding: 5px 6px;
        border-radius: 6px; cursor: pointer; transition: background 0.14s; user-select: none;
      }
      .crs-model-item:hover { background: rgba(255,255,255,0.05); }
      body:not([data-theme="dark"]) .crs-model-item:hover { background: rgba(0,0,0,0.04); }
      .crs-model-item input[type="checkbox"] { width: 13px; height: 13px; accent-color: #1d9e5c; cursor: pointer; flex-shrink: 0; }
      .crs-model-name { flex: 1; font-size: 11.5px; color: rgba(255,255,255,0.75); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      body:not([data-theme="dark"]) .crs-model-name { color: rgba(0,0,0,0.65); }
      .crs-model-score { font-size: 11px; font-family: monospace; flex-shrink: 0; }
      .crs-waiting {
        font-size: 9.5px; padding: 1px 5px; border-radius: 4px;
        background: rgba(255,200,60,0.12); border: 1px solid rgba(255,200,60,0.25);
        color: rgba(255,200,80,0.85); flex-shrink: 0;
      }
      .crs-perm-row { display: flex; align-items: center; gap: 8px; margin-top: 4px; }
      .crs-perm-label { font-size: 12px; color: rgba(255,255,255,0.40); flex: 1; }
      body:not([data-theme="dark"]) .crs-perm-label { color: rgba(0,0,0,0.38); }
      .crs-perm-btn {
        font-size: 11px; padding: 4px 10px; border-radius: 6px;
        border: 1px solid rgba(255,255,255,0.14); background: rgba(255,255,255,0.06);
        color: rgba(255,255,255,0.52); cursor: pointer; white-space: nowrap; transition: background 0.15s;
      }
      .crs-perm-btn:hover:not(:disabled) { background: rgba(255,255,255,0.12); color: rgba(255,255,255,0.88); }
      .crs-perm-btn.granted { border-color: rgba(70,195,115,0.45); color: rgba(80,225,130,0.90); }
      .crs-perm-btn.denied  { border-color: rgba(255,90,80,0.40); color: rgba(255,90,80,0.65); cursor: not-allowed; }

      /* ═══ 인앱 토스트 ═══ */
      #crs-toast-wrap {
        position: fixed; top: 52px; right: 16px; z-index: 100000;
        display: flex; flex-direction: column; gap: 8px; pointer-events: none;
      }
      .crs-toast {
        background: rgba(14,24,18,0.97); border: 1px solid rgba(70,200,110,0.45);
        border-radius: 10px; padding: 11px 15px; font-size: 12.5px;
        color: rgba(255,255,255,0.88); box-shadow: 0 6px 22px rgba(0,0,0,0.45);
        backdrop-filter: blur(10px); max-width: 270px;
        font-family: system-ui,-apple-system,sans-serif;
        animation: crs-in 0.28s cubic-bezier(.2,.8,.4,1) forwards;
      }
      .crs-toast.crs-drop { background: rgba(28,14,14,0.97); border-color: rgba(220,80,70,0.55); }
      .crs-toast-title { font-weight: 700; font-size: 12.5px; color: #1d9e5c; margin-bottom: 4px; }
      .crs-toast.crs-drop .crs-toast-title { color: rgba(255,100,90,1); }
      .crs-toast-model { font-family: monospace; font-size: 11.5px; color: rgba(255,255,255,0.52); }
      .crs-toast-score { font-family: monospace; font-size: 13px; color: rgba(255,255,255,0.90); margin-top: 2px; }
      @keyframes crs-in  { from { opacity:0; transform:translateX(18px) scale(0.97); } to { opacity:1; transform:translateX(0) scale(1); } }
      @keyframes crs-out { from { opacity:1; transform:translateX(0) scale(1); } to { opacity:0; transform:translateX(18px) scale(0.97); } }
    `;
    document.head.appendChild(el);
  }

  // ────────────────────────────────────────────────────────────
  //  패널 빌드
  // ────────────────────────────────────────────────────────────
  function buildPanel() {
    panelEl = document.createElement('div');
    panelEl.id = 'crs-panel';

    // ── 탭 헤더
    const tabs = document.createElement('div');
    tabs.id = 'crs-tabs';
    const tabStatus = document.createElement('button');
    tabStatus.className = 'crs-tab active'; tabStatus.textContent = '📡 상태';
    const tabAlert = document.createElement('button');
    tabAlert.className = 'crs-tab'; tabAlert.textContent = '🔔 알림';
    tabs.append(tabStatus, tabAlert);
    panelEl.appendChild(tabs);

    // ── 패널 내 갱신 버튼 (상태 탭 전용 우측 sticky)
    const actRow = document.createElement('div');
    actRow.id = 'crs-panel-actions';
    const refreshBtn2 = document.createElement('button');
    refreshBtn2.className = 'crs-panel-btn'; refreshBtn2.textContent = '↻ 갱신';
    refreshBtn2.addEventListener('click', (e) => { e.stopPropagation(); refreshAll(); });
    actRow.appendChild(refreshBtn2);
    panelEl.appendChild(actRow);

    // ── 탭 콘텐츠: 상태
    const paneStatus = document.createElement('div');
    paneStatus.className = 'crs-tab-pane active';

    for (const m of MODELS) {
      const row = document.createElement('div');
      row.className = 'crs-row crs-s-unknown';
      row.style.display = visibility[m.slug] ? '' : 'none';

      const rtop = document.createElement('div'); rtop.className = 'crs-rtop';
      const rname = document.createElement('div'); rname.className = 'crs-rname'; rname.textContent = m.label; rname.title = m.label;
      const rstate = document.createElement('div'); rstate.className = 'crs-rstate';
      rstate.innerHTML = `<span class="crs-dot"></span><span class="crs-stxt">WAIT</span>`;
      rtop.append(rname, rstate);

      const metric = document.createElement('div'); metric.className = 'crs-metric'; metric.textContent = '불러오는 중…';
      row.append(rtop, metric);
      paneStatus.appendChild(row);
      uiRows.set(m.slug, { row, stateEl: rstate, metricEl: metric });
    }

    // 푸터
    const foot = document.createElement('div'); foot.id = 'crs-status-foot';
    footerTsEl = document.createElement('span'); footerTsEl.textContent = '—';
    const footLink = document.createElement('a');
    footLink.href = 'https://rs.igx.kr/'; footLink.target = '_blank'; footLink.rel = 'noreferrer'; footLink.textContent = 'rs.igx.kr';
    foot.append(footerTsEl, footLink);
    paneStatus.appendChild(foot);

    // 표시 모델 설정
    const settingsDivider = document.createElement('hr'); settingsDivider.className = 'crs-divider';
    const settingsLabel = document.createElement('div'); settingsLabel.className = 'crs-section-label'; settingsLabel.textContent = '표시 모델';
    paneStatus.append(settingsDivider, settingsLabel);

    for (const m of MODELS) {
      const sRow = document.createElement('div'); sRow.className = 'crs-set-row';
      const sLabel = document.createElement('label'); sLabel.className = 'crs-set-label';
      const sChk = document.createElement('input');
      sChk.type = 'checkbox'; sChk.className = 'crs-set-chk'; sChk.checked = visibility[m.slug];
      sChk.addEventListener('change', (e) => {
        visibility[m.slug] = e.target.checked;
        saveVisibility();
        uiRows.get(m.slug).row.style.display = visibility[m.slug] ? '' : 'none';
        renderBarChips();
      });
      sLabel.append(sChk, document.createTextNode(' ' + m.label));
      sRow.appendChild(sLabel);
      paneStatus.appendChild(sRow);
    }

    panelEl.appendChild(paneStatus);

    // ── 탭 콘텐츠: 알림
    const paneAlert = document.createElement('div');
    paneAlert.className = 'crs-tab-pane';
    buildAlertPane(paneAlert);
    panelEl.appendChild(paneAlert);

    // ── 탭 전환
    tabStatus.addEventListener('click', () => {
      tabStatus.classList.add('active');    tabAlert.classList.remove('active');
      paneStatus.classList.add('active');   paneAlert.classList.remove('active');
      actRow.style.display = 'flex';
    });
    tabAlert.addEventListener('click', () => {
      tabAlert.classList.add('active');    tabStatus.classList.remove('active');
      paneAlert.classList.add('active');   paneStatus.classList.remove('active');
      actRow.style.display = 'none';
    });

    document.body.appendChild(panelEl);

    // 외부 클릭 시 닫기
    document.addEventListener('click', (e) => {
      if (panelOpen && !panelEl.contains(e.target) && !btnBarEl?.contains(e.target)) {
        panelOpen = false;
        panelEl.classList.remove('open');
      }
    });
  }

  // ────────────────────────────────────────────────────────────
  //  알림 탭 콘텐츠 빌드 (IGX Alert UI 이식)
  // ────────────────────────────────────────────────────────────
  function buildAlertPane(pane) {
    // 알림 방식 섹션
    const modeSec = document.createElement('div'); modeSec.className = 'crs-section';
    const modeLabel = document.createElement('div'); modeLabel.className = 'crs-section-label'; modeLabel.textContent = '알림 방식';
    modeSec.appendChild(modeLabel);

    // 소리 토글
    const soundRow = document.createElement('div'); soundRow.className = 'crs-toggle-row';
    const soundText = document.createElement('div');
    soundText.innerHTML = `<div class="crs-toggle-text">🔊 소리</div><div class="crs-toggle-sub">비프음 재생</div>`;
    const { wrap: soundSw, input: soundInput } = makeSwitch(KEY.sound, true);
    soundRow.append(soundText, soundSw);
    modeSec.appendChild(soundRow);

    // 볼륨 행
    const volRow = document.createElement('div'); volRow.className = 'crs-vol-row';
    const volIcon = document.createElement('span'); volIcon.className = 'crs-vol-icon'; volIcon.textContent = '🔉';
    const volSlider = document.createElement('input');
    volSlider.type = 'range'; volSlider.className = 'crs-vol-slider';
    volSlider.min = 0; volSlider.max = 100; volSlider.step = 1; volSlider.value = load(KEY.volume, 70);
    const volVal = document.createElement('span'); volVal.className = 'crs-vol-val'; volVal.textContent = volSlider.value;
    function refreshVolIcon(v) { volIcon.textContent = v <= 0 ? '🔇' : v < 40 ? '🔈' : v < 75 ? '🔉' : '🔊'; }
    refreshVolIcon(Number(volSlider.value));
    volSlider.addEventListener('input', () => { const v = Number(volSlider.value); volVal.textContent = v; save(KEY.volume, v); refreshVolIcon(v); });
    const testBtn = document.createElement('button'); testBtn.className = 'crs-test-btn'; testBtn.textContent = '테스트';
    testBtn.title = '현재 볼륨으로 미리 듣기';
    testBtn.addEventListener('click', (e) => { e.stopPropagation(); getCtx(); beep(); });
    function syncVol(on) { volRow.style.opacity = on ? '1' : '0.35'; volSlider.disabled = !on; testBtn.disabled = !on; }
    syncVol(soundInput.checked);
    soundInput.addEventListener('change', () => syncVol(soundInput.checked));
    volRow.append(volIcon, volSlider, volVal, testBtn);
    modeSec.appendChild(volRow);

    // 팝업 토글
    const popupRow = document.createElement('div'); popupRow.className = 'crs-toggle-row'; popupRow.style.marginTop = '4px';
    const popupText = document.createElement('div');
    popupText.innerHTML = `<div class="crs-toggle-text">🖥 팝업</div><div class="crs-toggle-sub">시스템 알림 또는 화면 내 토스트</div>`;
    const { wrap: popupSw } = makeSwitch(KEY.popup, true);
    popupRow.append(popupText, popupSw);
    modeSec.appendChild(popupRow);
    pane.appendChild(modeSec);

    // 임계 점수 섹션
    const scoreSec = document.createElement('div'); scoreSec.className = 'crs-section';
    const scoreSecLabel = document.createElement('div'); scoreSecLabel.className = 'crs-section-label'; scoreSecLabel.textContent = '임계 점수';
    scoreSec.appendChild(scoreSecLabel);
    const scoreRow = document.createElement('div'); scoreRow.className = 'crs-score-row';
    const scoreLbl = document.createElement('div'); scoreLbl.className = 'crs-score-label'; scoreLbl.textContent = '이 점수 이상이면 알림';
    const scoreInput = document.createElement('input');
    scoreInput.type = 'number'; scoreInput.className = 'crs-score-input';
    scoreInput.min = 0; scoreInput.max = 100; scoreInput.value = load(KEY.threshold, 70);
    scoreInput.addEventListener('change', () => {
      const v = Math.min(100, Math.max(0, parseInt(scoreInput.value) || 0));
      scoreInput.value = v; save(KEY.threshold, v);
      renderWatchedModelList();
    });
    const scoreUnit = document.createElement('span'); scoreUnit.className = 'crs-score-unit'; scoreUnit.textContent = '점';
    scoreRow.append(scoreLbl, scoreInput, scoreUnit);
    scoreSec.appendChild(scoreRow);
    pane.appendChild(scoreSec);

    const hr1 = document.createElement('hr'); hr1.className = 'crs-divider';
    pane.appendChild(hr1);

    // 감시 모델 섹션
    const modelSec = document.createElement('div'); modelSec.className = 'crs-section';
    const modelHeader = document.createElement('div'); modelHeader.className = 'crs-model-header';
    const modelSecLabel = document.createElement('div');
    modelSecLabel.className = 'crs-section-label'; modelSecLabel.style.marginBottom = '0'; modelSecLabel.textContent = '감시 모델';
    const modelActions = document.createElement('div'); modelActions.className = 'crs-model-actions';

    const watchedList = document.createElement('div'); watchedList.className = 'crs-model-list';

    // renderWatchedModelList를 모듈 수준에서 접근 가능하도록 할당
    renderWatchedModelList = function () {
      watchedList.innerHTML = '';
      const watched   = loadJSON(KEY.watched, {});
      const threshold = Number(load(KEY.threshold, 70));
      for (const m of MODELS) {
        const d        = lastData.get(m.slug) || {};
        const scoreNum = Number.isFinite(d.scoreNum) ? d.scoreNum : NaN;
        const isWatched = !!watched[m.slug];

        const item = document.createElement('label'); item.className = 'crs-model-item';
        const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = isWatched;
        cb.addEventListener('change', () => {
          const w = loadJSON(KEY.watched, {}); w[m.slug] = cb.checked;
          saveJSON(KEY.watched, w); updateBarBtn(); renderWatchedModelList();
        });
        const nameSpan = document.createElement('span'); nameSpan.className = 'crs-model-name'; nameSpan.textContent = m.label;
        const scoreSpan = document.createElement('span'); scoreSpan.className = 'crs-model-score';
        const sc = scoreColor(scoreNum);
        if (sc) scoreSpan.style.color = sc;
        scoreSpan.textContent = Number.isFinite(scoreNum) ? `${scoreNum}점` : '—';
        item.append(cb, nameSpan, scoreSpan);
        if (isWatched && Number.isFinite(scoreNum) && scoreNum < threshold) {
          const badge = document.createElement('span'); badge.className = 'crs-waiting'; badge.textContent = '대기 중';
          item.appendChild(badge);
        }
        watchedList.appendChild(item);
      }
    };
    renderWatchedModelList();

    function makeMinBtn(text, onClick) {
      const b = document.createElement('button'); b.className = 'crs-mini-btn'; b.textContent = text;
      b.addEventListener('click', onClick); return b;
    }
    modelActions.appendChild(makeMinBtn('전체 선택', () => {
      const w = {}; MODELS.forEach(m => { w[m.slug] = true; });
      saveJSON(KEY.watched, w); renderWatchedModelList(); updateBarBtn();
    }));
    modelActions.appendChild(makeMinBtn('전체 해제', () => {
      saveJSON(KEY.watched, {}); renderWatchedModelList(); updateBarBtn();
    }));

    modelHeader.append(modelSecLabel, modelActions);
    modelSec.append(modelHeader, watchedList);
    pane.appendChild(modelSec);

    const hr2 = document.createElement('hr'); hr2.className = 'crs-divider';
    pane.appendChild(hr2);

    // 알림 권한 행
    const permRow = document.createElement('div'); permRow.className = 'crs-perm-row';
    const permLbl = document.createElement('span'); permLbl.className = 'crs-perm-label'; permLbl.textContent = '시스템 알림 권한';
    const permBtn = document.createElement('button'); permBtn.className = 'crs-perm-btn';
    function refreshPermBtn() {
      const p = Notification.permission;
      if (p === 'granted') { permBtn.textContent = '✅ 허용됨'; permBtn.className = 'crs-perm-btn granted'; permBtn.disabled = true; }
      else if (p === 'denied') { permBtn.textContent = '❌ 거부됨'; permBtn.className = 'crs-perm-btn denied'; permBtn.disabled = true; }
      else { permBtn.textContent = '권한 요청'; permBtn.className = 'crs-perm-btn'; permBtn.disabled = false; }
    }
    refreshPermBtn();
    permBtn.addEventListener('click', () => { getCtx(); Notification.requestPermission().then(refreshPermBtn); });
    permRow.append(permLbl, permBtn);
    pane.appendChild(permRow);
  }

  function makeSwitch(storageKey, defaultVal, onChange) {
    const label = document.createElement('label'); label.className = 'crs-sw';
    const input = document.createElement('input'); input.type = 'checkbox'; input.checked = load(storageKey, defaultVal);
    input.addEventListener('change', () => { save(storageKey, input.checked); if (onChange) onChange(input.checked); });
    const track = document.createElement('span'); track.className = 'crs-sw-track';
    label.append(input, track);
    return { wrap: label, input };
  }

  // ────────────────────────────────────────────────────────────
  //  헤더 바 버튼 빌드
  // ────────────────────────────────────────────────────────────
  function buildBarBtn() {
    btnBarEl = document.createElement('button');
    btnBarEl.id = 'crs-bar-btn';
    btnBarEl.title = 'Radiosonde 상태 / 알림 설정';

    const icon = null; // 아이콘 제거 — 칩 텍스트만으로 구성
    barChipsEl = document.createElement('span'); barChipsEl.id = 'crs-bar-chips';
    barChipsEl.innerHTML = '<span style="opacity:0.40;font-size:13px;">불러오는 중…</span>';

    // 갱신 버튼 (아이콘이 있던 자리)
    const refreshInline = document.createElement('button');
    refreshInline.id = 'crs-refresh-btn';
    refreshInline.title = '지금 갱신';
    refreshInline.textContent = '↻';
    refreshInline.addEventListener('click', (e) => {
      e.stopPropagation();
      refreshInline.classList.add('spinning');
      refreshInline.addEventListener('animationend', () => refreshInline.classList.remove('spinning'), { once: true });
      refreshAll();
    });

    btnBarEl.append(refreshInline, barChipsEl);
    btnBarEl.addEventListener('click', (e) => {
      e.stopPropagation();
      getCtx(); // AudioContext 사전 초기화
      panelOpen = !panelOpen;
      panelEl.classList.toggle('open', panelOpen);
      if (panelOpen) {
        // 버튼 우측 끝에 패널 정렬
        const rect = btnBarEl.getBoundingClientRect();
        const rightOffset = Math.max(0, window.innerWidth - rect.right);
        panelEl.style.right = rightOffset + 'px';
      }
    });
    return btnBarEl;
  }

  // ────────────────────────────────────────────────────────────
  //  헤더 주입
  // ────────────────────────────────────────────────────────────
  // ─────────────────────────────────────────────────────────
  //  헤더 주입 — Chasm Ignitor 방식 (플래그 없이 DOM 직접 체크)
  // ─────────────────────────────────────────────────────────

  // 오른쪽 버튼 컨테이너 탐색
  // Chasm Ignitor 기준: css-l8r172[0] > childNodes[0] > div[0] > children[0] > last-child
  function findActionArea() {
    // [전략 1] Chasm Ignitor가 이미 삽입한 burner-button의 부모 (가장 안정적)
    const burner = document.querySelector('button.burner-button');
    if (burner?.parentElement) return burner.parentElement;

    // [전략 2] Chasm Ignitor와 동일한 emotion-css 클래스 + 탐색 경로
    const panels = document.getElementsByClassName('css-l8r172');
    if (panels.length > 0) {
      try {
        const firstChild = panels[0].childNodes[panels.length - 1];
        const divs = firstChild?.getElementsByTagName?.('div');
        if (divs?.length > 0) {
          const topList = divs[0].children?.[0]?.children;
          if (topList?.length > 0) return topList[topList.length - 1];
        }
      } catch (_) {}
    }

    // [전략 3] bg-bg_screen + h-12 헤더에서 오른쪽 flex 컨테이너
    const chatHeader = Array.from(document.querySelectorAll('div')).find(el => {
      const c = typeof el.className === 'string' ? el.className : '';
      return c.includes('h-12') && c.includes('px-5') &&
             c.includes('justify-between') && c.includes('bg-bg_screen');
    });
    if (chatHeader) {
      const rightFlex = [...chatHeader.children].reverse().find(
        el => el.tagName === 'DIV' && typeof el.className === 'string' && el.className.includes('flex')
      );
      if (rightFlex) return rightFlex;
    }

    return null;
  }

  function tryInjectHeader() {
    // 이미 주입돼 있으면 아무것도 안 함 (플래그 대신 DOM 직접 확인)
    if (document.getElementById('crs-bar-btn')) return;

    injectStyles();
    if (!document.getElementById('crs-panel')) {
      panelEl = null;
      renderWatchedModelList = () => {};
      buildPanel();
    }

    // ── [전략 0] 최상단 바 네이티브 검색창 옆에 삽입 (최우선)
    //    구조: div.gap-5.ml-auto > [div.w-full(검색)] [div.flex.shrink-0(아이콘)]
    //    → 검색 wrapper와 아이콘 그룹 사이에 삽입
    const nativeSearch = document.querySelector('input[placeholder="검색어를 입력해 주세요"]');
    if (nativeSearch) {
      // input → span.relative → div.w-full(검색 wrapper) → div.gap-5(부모 flex)
      const searchWrapper = nativeSearch.closest('div.w-full, div[class*="w-\\[335px\\]"]')
                         || nativeSearch.parentElement?.parentElement;
      const flexParent = searchWrapper?.parentElement;
      // 아이콘 그룹: 검색 wrapper 바로 다음 div
      const iconGroup = searchWrapper?.nextElementSibling;
      if (flexParent && searchWrapper) {
        buildBarBtn();
        // 검색창 바로 앞(좌측)에 삽입
        flexParent.insertBefore(btnBarEl, searchWrapper);
        updateBarBtn();
        startPollingOnce();
        return;
      }
    }

    // ── 기존 전략들 (폴백)
    const actionArea = findActionArea();
    if (!actionArea) return;

    buildBarBtn();
    const burnerNow = actionArea.querySelector('button.burner-button');
    if (burnerNow) {
      actionArea.insertBefore(btnBarEl, burnerNow);
    } else {
      actionArea.insertBefore(btnBarEl, actionArea.firstChild);
      let checks = 0;
      const watch = setInterval(() => {
        if (++checks > 30) { clearInterval(watch); return; }
        const ourBtn2 = document.getElementById('crs-bar-btn');
        if (!ourBtn2) { clearInterval(watch); return; }
        const burnerLate = actionArea.querySelector('button.burner-button');
        if (!burnerLate) return;
        const kids = Array.from(actionArea.children);
        if (kids.indexOf(burnerLate) < kids.indexOf(ourBtn2)) {
          actionArea.insertBefore(ourBtn2, burnerLate);
        }
        clearInterval(watch);
      }, 80);
    }

    updateBarBtn();
    startPollingOnce();
  }

  function startPollingOnce() {
    // 처음 주입 시에만 폴링 시작 (중복 방지)
    if (!window._crsPolling) {
      window._crsPolling = true;
      setTimeout(() => refreshAll(), 800);
      setInterval(() => refreshAll(), POLL_MS);
    }
  }

  // ─────────────────────────────────────────────────────────
  //  MutationObserver — Chasm Ignitor 방식으로 단순화
  // ─────────────────────────────────────────────────────────
  new MutationObserver(() => tryInjectHeader())
    .observe(document.body, { childList: true, subtree: true });

  // 초기 시도 폴백
  tryInjectHeader();
  setTimeout(() => tryInjectHeader(), 1000);
  setTimeout(() => tryInjectHeader(), 3000);

})();