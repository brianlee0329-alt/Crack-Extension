// ==UserScript==
// @name         채팅 세션 관리
// @namespace    https://github.com/workforomg/Utill
// @version      2.0.0
// @description  유저 편집 폴더, 채팅방 검색(메모 포함), 세션별 메모 삽입
// @match        https://crack.wrtn.ai/*
// @grant        GM_addStyle
// @run-at       document-end
// ==/UserScript==

(function() {
    'use strict';

    const FOLDER_KEY = 'my_custom_chat_folders_v1';
    const MEMO_KEY   = 'crack_session_memos_v1';

    const expandedFolders = new Set();
    let _isRendering  = false;
    let _lastRenderSig = ''; // 폴더 데이터 서명 — 변경이 없으면 렌더 생략

    // =================================================================
    // 0. 사이드바 루트
    // =================================================================
    function getSidebarRoot() {
        const c = document.querySelector('.css-kvsjdq');
        if (c) return c;
        for (const el of document.querySelectorAll('p, span, div')) {
            if (el.innerText && el.innerText.trim() === '채팅 내역') {
                const h = el.closest('div');
                if (h && h.nextElementSibling) return h.nextElementSibling;
            }
        }
        return null;
    }

    // =================================================================
    // 1. 폴더 데이터
    // =================================================================
    function getFolders() {
        try {
            return (JSON.parse(localStorage.getItem(FOLDER_KEY)) || []).map(f => ({
                id: f.id, name: f.name,
                parentId: f.parentId || null,
                sessions: f.sessions || f.items || []
            }));
        } catch { return []; }
    }
    function saveFolders(folders) {
        localStorage.setItem(FOLDER_KEY, JSON.stringify(folders));
        _lastRenderSig = ''; // 저장 후 반드시 재렌더
    }
    function foldersSig(folders) {
        return folders.map(f => f.id + ':' + (f.parentId || '') + ':' + f.sessions.join(','))
                      .join('|');
    }

    // =================================================================
    // 2. 메모 데이터
    // =================================================================
    function getMemos()             { try { return JSON.parse(localStorage.getItem(MEMO_KEY)) || {}; } catch { return {}; } }
    function getMemo(href)          { return getMemos()[href] || ''; }
    function saveMemo(href, text)   {
        const m = getMemos();
        if (text.trim() === '') delete m[href]; else m[href] = text.trim();
        localStorage.setItem(MEMO_KEY, JSON.stringify(m));
    }

    // =================================================================
    // 3. 세션 제목 추출
    // =================================================================
    function extractTitle(a) {
        const n = a.querySelector('.chat-list-item-character-name');
        if (n && n.innerText.trim()) return n.innerText.trim();
        const img = a.querySelector('img[alt]');
        if (img && img.alt.trim()) return img.alt.trim();
        return (a.innerText || '').split('\n')[0].trim() || '이름 없는 세션';
    }

    // =================================================================
    // 4. 메모 UI 주입 (setInterval 대신 renderSidebarFolders 후 호출)
    // =================================================================
    function injectMemoUI() {
        document.querySelectorAll('a[href*="/stories/"][href*="/episodes/"]').forEach(link => {
            const href = link.getAttribute('href');
            if (!href) return;

            // ⋮ 버튼 위치 탐색
            const moreBtn = link.querySelector('button[aria-haspopup="menu"]');
            if (!moreBtn) return;
            const titleRow = moreBtn.closest('div');
            if (!titleRow) return;

            // ── 이름 변경 후 재렌더 대응 ──────────────────────────────
            // data-memoInjected 대신 실제 버튼 존재 여부로 판단.
            // 플랫폼이 카드 내부를 다시 그리면 버튼이 사라지므로 재주입 필요.
            const alreadyHasBtn = !!titleRow.querySelector('.crack-memo-btn');

            if (!alreadyHasBtn) {
                const memoBtn = document.createElement('button');
                memoBtn.className = moreBtn.className;
                memoBtn.setAttribute('type', 'button');
                memoBtn.setAttribute('title', '메모');
                memoBtn.classList.add('crack-memo-btn');
                memoBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" fill="var(--icon_primary)" viewBox="0 0 24 24" width="14px" height="14px"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>`;
                memoBtn.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); openMemoModal(href); });
                titleRow.insertBefore(memoBtn, moreBtn);
            }

            // 미리보기: 없으면 추가, 이미 있으면 스킵
            const bottomArea = link.querySelector('.css-1owehid');
            if (bottomArea && !bottomArea.querySelector('.crack-memo-preview')) {
                const preview = document.createElement('div');
                preview.className = 'crack-memo-preview';
                preview.dataset.memoHref = href;
                preview.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); openMemoModal(href); });
                bottomArea.appendChild(preview);
            }

            // 카드 높이 고정 해제
            link.querySelector('.css-7ylhi9')?.classList.add('crack-memo-card');
        });
        refreshPreviews();
    }

    function refreshPreviews() {
        document.querySelectorAll('.crack-memo-preview[data-memo-href]').forEach(el => {
            const text = getMemo(el.dataset.memoHref);
            el.textContent = text ? '📝 ' + text : '';
            el.style.display = text ? 'block' : 'none';
        });
    }

    // =================================================================
    // 5. 메모 모달
    // =================================================================
    function openMemoModal(href) {
        document.getElementById('crack-memo-modal')?.remove();
        const current = getMemo(href);

        const title = (() => {
            const a = document.querySelector(`a[href="${href}"]`);
            return a ? extractTitle(a) : href;
        })();

        const modal = document.createElement('div');
        modal.id = 'crack-memo-modal';
        modal.innerHTML = `
            <div class="cmemo-box">
                <div class="cmemo-header">
                    <span class="cmemo-icon">📝</span>
                    <span class="cmemo-title" title="${title}">${title}</span>
                </div>
                <textarea id="cmemo-textarea" placeholder="이 세션에 대한 메모를 입력하세요...">${current}</textarea>
                <div class="cmemo-footer">
                    <button id="cmemo-delete" class="cmemo-btn cmemo-btn-danger" ${current ? '' : 'style="display:none"'}>삭제</button>
                    <div style="flex:1"></div>
                    <button id="cmemo-cancel" class="cmemo-btn">취소</button>
                    <button id="cmemo-save" class="cmemo-btn cmemo-btn-primary">저장</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);

        const ta = modal.querySelector('#cmemo-textarea');
        ta.focus();
        ta.setSelectionRange(ta.value.length, ta.value.length);

        modal.querySelector('#cmemo-save').onclick   = () => { saveMemo(href, ta.value); refreshPreviews(); modal.remove(); };
        modal.querySelector('#cmemo-cancel').onclick = () => modal.remove();
        modal.querySelector('#cmemo-delete').onclick = () => {
            if (confirm('메모를 삭제하시겠습니까?')) { saveMemo(href, ''); refreshPreviews(); modal.remove(); }
        };
        modal.onclick = e => { if (e.target === modal) modal.remove(); };

        const onKey = e => { if (e.key === 'Escape') { modal.remove(); document.removeEventListener('keydown', onKey); } };
        document.addEventListener('keydown', onKey);
    }

    // =================================================================
    // 6. 폴더 관리 버튼
    // =================================================================
    function injectManagerButton() {
        if (document.getElementById('my-folder-manager-btn')) return;

        let hdr = null;
        for (const el of document.querySelectorAll('p, span, div')) {
            if (el.innerText && el.innerText.trim() === '채팅 내역') { hdr = el; break; }
        }
        if (!hdr) return;
        const container = hdr.closest('div');
        if (!container) return;

        let target = null;
        for (const btn of container.querySelectorAll('button')) {
            if (btn.innerText.trim() === '편집' && !btn.id) { target = btn; break; }
        }
        if (!target) return;

        const btn = target.cloneNode(true);
        btn.id = 'my-folder-manager-btn';
        const sp = btn.querySelector('span');
        if (sp) sp.innerText = '폴더 관리'; else btn.innerText = '폴더 관리';
        btn.style.marginRight = '8px';
        btn.onclick = e => {
            e.preventDefault(); e.stopPropagation();
            if (document.getElementById('my-folder-settings-modal')) return;
            const ex = document.getElementById('my-folder-manager-modal');
            if (ex) ex.remove(); else openFolderManagerModal();
        };
        target.parentElement.insertBefore(btn, target);
    }

    // =================================================================
    // 7. 검색창
    // =================================================================
    function injectSearchBar() {
        if (document.getElementById('my-search-container')) return;
        const root = getSidebarRoot();
        if (!root || !root.parentNode) return;

        const c = document.createElement('div');
        c.id = 'my-search-container';
        c.innerHTML = `
            <div id="my-search-wrapper">
                <span class="my-search-icon">🔍</span>
                <input type="text" id="my-search-input" placeholder="공백 없이 검색해도 됩니다">
            </div>
        `;
        root.parentNode.insertBefore(c, root);
        document.getElementById('my-search-input').addEventListener('input', e => filterSessions(e.target.value));
    }

    function filterSessions(raw) {
        const kw = raw.toLowerCase().replace(/\s+/g, '');
        const root = getSidebarRoot();
        if (!root) return;

        root.querySelectorAll('a[href*="/stories/"]').forEach(a => {
            const t    = extractTitle(a).toLowerCase().replace(/\s+/g, '');
            const tp   = (a.querySelector('.chat-list-item-topic')?.innerText || '').toLowerCase().replace(/\s+/g, '');
            const memo = getMemo(a.getAttribute('href') || '').toLowerCase().replace(/\s+/g, '');
            const show = !kw || t.includes(kw) || tp.includes(kw) || memo.includes(kw);
            if (show) a.removeAttribute('data-search-hidden');
            else      a.setAttribute('data-search-hidden', '1');
        });

        root.querySelectorAll('.my-sb-folder').forEach(el => {
            if (!kw) { el.removeAttribute('data-search-hidden'); return; }
            const vis = el.querySelectorAll('a[href*="/stories/"]:not([data-search-hidden])');
            if (vis.length === 0) el.setAttribute('data-search-hidden', '1');
            else                  el.removeAttribute('data-search-hidden');
        });
    }

    // =================================================================
    // 8. 통합 폴더 관리 모달
    // =================================================================
    function openFolderManagerModal() {
        document.getElementById('my-folder-manager-modal')?.remove();
        const modal = document.createElement('div');
        modal.id = 'my-folder-manager-modal';
        document.body.appendChild(modal);

        function rebuild() {
            let folders = getFolders();
            modal.innerHTML = `
                <div class="fmgr-box">
                    <div class="fmgr-header">
                        <span>📁 폴더 관리</span>
                        <button class="fmgr-btn-new" id="fmgr-new">+ 새 폴더</button>
                    </div>
                    <div class="fmgr-list" id="fmgr-list"></div>
                    <div class="fmgr-footer">
                        <button class="fmgr-btn" id="fmgr-close">닫기</button>
                    </div>
                </div>
            `;
            modal.querySelector('#fmgr-new').onclick   = () => { modal.remove(); openSettingsModal(null); };
            modal.querySelector('#fmgr-close').onclick = () => modal.remove();

            const list = modal.querySelector('#fmgr-list');
            if (!folders.length) {
                list.innerHTML = '<div class="fmgr-empty">생성된 폴더가 없습니다.</div>';
                return;
            }

            const renderTree = (parentId, depth) => {
                const siblings = folders.filter(f => (f.parentId || null) === (parentId || null));
                siblings.forEach((f, i) => {
                    const row = document.createElement('div');
                    row.className = 'fmgr-row';
                    if (depth > 0) row.style.marginLeft = (depth * 16) + 'px';
                    row.innerHTML = `
                        <div class="fmgr-row-info">
                            <span>${depth > 0 ? '└📂' : '📁'}</span>
                            <span class="fmgr-row-name">${f.name}</span>
                            <span class="fmgr-row-count">(${f.sessions.length})</span>
                        </div>
                        <div class="fmgr-row-btns">
                            <button class="fmgr-icon-btn bu" ${i === 0 ? 'disabled' : ''}>▲</button>
                            <button class="fmgr-icon-btn bd" ${i === siblings.length-1 ? 'disabled' : ''}>▼</button>
                            <button class="fmgr-icon-btn bs">설정</button>
                            <button class="fmgr-icon-btn bd2 fmgr-danger-txt">삭제</button>
                        </div>
                    `;
                    const swap = (ia, ib) => {
                        [folders[ia], folders[ib]] = [folders[ib], folders[ia]];
                        saveFolders(folders); renderSidebarFolders(); rebuild();
                    };
                    row.querySelector('.bu').onclick  = () => swap(folders.indexOf(f), folders.indexOf(siblings[i-1]));
                    row.querySelector('.bd').onclick  = () => swap(folders.indexOf(f), folders.indexOf(siblings[i+1]));
                    row.querySelector('.bs').onclick  = () => { modal.remove(); openSettingsModal(f.id); };
                    row.querySelector('.bd2').onclick = () => {
                        if (!confirm(`'${f.name}'을(를) 삭제하시겠습니까?\n(하위 폴더는 최상위로 분리됩니다. 세션은 유지됩니다.)`)) return;
                        folders.forEach(c => { if (c.parentId === f.id) c.parentId = null; });
                        folders = folders.filter(x => x.id !== f.id);
                        saveFolders(folders); renderSidebarFolders(); rebuild();
                    };
                    list.appendChild(row);
                    renderTree(f.id, depth + 1);
                });
            };
            renderTree(null, 0);
        }
        rebuild();
    }

    // =================================================================
    // 9. 개별 폴더 설정 모달
    // =================================================================
    function openSettingsModal(folderId) {
        document.getElementById('my-folder-settings-modal')?.remove();

        let folders = getFolders();
        const isNew = !folderId;
        let cur = isNew
            ? { id: 'f_' + Date.now(), name: '', parentId: null, sessions: [] }
            : folders.find(f => f.id === folderId);
        if (!cur) return;

        const getDescIds = tid => {
            let ids = [];
            folders.filter(f => f.parentId === tid).forEach(c => { ids.push(c.id); ids = ids.concat(getDescIds(c.id)); });
            return ids;
        };
        const invalidPids = new Set(folderId ? [folderId, ...getDescIds(folderId)] : []);

        const root = getSidebarRoot();
        const raw = []; const seen = new Set();
        if (root) {
            root.querySelectorAll('a[href*="/stories/"]').forEach(a => {
                const h = a.getAttribute('href');
                if (!h || seen.has(h)) return;
                seen.add(h);
                let n = extractTitle(a);
                if (n.length > 36) n = n.substring(0, 36) + '…';
                raw.push({ href: h, name: n });
            });
        }

        const parentFolder  = cur.parentId ? folders.find(f => f.id === cur.parentId) : null;
        const parentSet     = new Set(parentFolder ? parentFolder.sessions : []);
        const curSet        = new Set(cur.sessions);
        const occupiedElsewhere = new Set();
        folders.forEach(f => {
            if (f.id === folderId || f.id === cur.parentId) return;
            f.sessions.forEach(h => occupiedElsewhere.add(h));
        });
        const avail = raw.filter(s => !occupiedElsewhere.has(s.href) || curSet.has(s.href));

        const modal = document.createElement('div');
        modal.id = 'my-folder-settings-modal';
        const pOpts = folders.filter(f => !invalidPids.has(f.id))
            .map(f => `<option value="${f.id}" ${f.id === cur.parentId ? 'selected' : ''}>${f.name}</option>`).join('');

        modal.innerHTML = `
            <div class="fset-box">
                <div class="fset-header">${isNew ? '새 폴더 생성' : '폴더 설정'}</div>
                <div class="fset-body">
                    <div class="fset-field">
                        <label class="fset-label">폴더 이름</label>
                        <input type="text" id="fset-name" class="fset-input" value="${cur.name}" placeholder="폴더 이름을 입력하세요">
                    </div>
                    <div class="fset-field">
                        <label class="fset-label">상위 폴더 <span class="fset-label-sub">(선택 시 하위 폴더)</span></label>
                        <select id="fset-parent" class="fset-select">
                            <option value="">없음 (최상위)</option>${pOpts}
                        </select>
                    </div>
                    <div class="fset-field">
                        <label class="fset-label">채팅 세션
                            <span class="fset-label-sub">(${avail.length}개 이용 가능${parentFolder ? ' · 상위 폴더 세션 포함' : ''})</span>
                        </label>
                        <div class="fset-session-list" id="fset-sessions"></div>
                    </div>
                </div>
                <div class="fset-footer">
                    ${!isNew ? '<button class="fset-btn fset-btn-danger" id="fset-delete">폴더 삭제</button>' : ''}
                    <div style="flex:1"></div>
                    <button class="fset-btn" id="fset-cancel">취소</button>
                    <button class="fset-btn fset-btn-primary" id="fset-save">저장</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);

        const sList = modal.querySelector('#fset-sessions');
        if (!avail.length) {
            sList.innerHTML = '<div class="fset-empty">이용 가능한 채팅 세션이 없습니다.</div>';
        } else {
            avail.forEach(s => {
                const id  = 'fchk_' + s.href.replace(/\W/g, '_');
                const memo = getMemo(s.href);
                const label = memo
                    ? `${s.name} <span class="fset-session-memo">— ${memo.length > 20 ? memo.substring(0,20)+'…' : memo}</span>`
                    : s.name;
                const div = document.createElement('div');
                div.className = 'fset-session-item';
                div.innerHTML = `
                    <input type="checkbox" id="${id}" value="${s.href}" ${curSet.has(s.href) ? 'checked' : ''}>
                    <label for="${id}" title="${s.name}${memo ? ' — '+memo : ''}">
                        ${label}
                        ${parentSet.has(s.href) && !curSet.has(s.href) ? '<span class="fset-badge-parent">상위</span>' : ''}
                    </label>
                `;
                sList.appendChild(div);
            });
        }

        const goBack = () => { modal.remove(); openFolderManagerModal(); };
        modal.querySelector('#fset-cancel').onclick = goBack;

        if (!isNew) {
            modal.querySelector('#fset-delete').onclick = () => {
                if (!confirm(`'${cur.name}'을(를) 삭제하시겠습니까?`)) return;
                let f = getFolders();
                f.forEach(c => { if (c.parentId === folderId) c.parentId = null; });
                f = f.filter(x => x.id !== folderId);
                saveFolders(f); renderSidebarFolders(); goBack();
            };
        }

        modal.querySelector('#fset-save').onclick = () => {
            const nameVal = modal.querySelector('#fset-name').value.trim();
            if (!nameVal) { alert('폴더 이름을 입력해주세요!'); return; }
            const newPid     = modal.querySelector('#fset-parent').value || null;
            const checked    = Array.from(modal.querySelectorAll('#fset-sessions input:checked')).map(cb => cb.value);

            let f = getFolders();
            if (newPid) {
                const pi = f.findIndex(x => x.id === newPid);
                if (pi !== -1) f[pi] = { ...f[pi], sessions: f[pi].sessions.filter(h => !checked.includes(h)) };
            }
            const updated = { ...cur, name: nameVal, parentId: newPid, sessions: checked };
            if (isNew) f.push(updated);
            else { const i = f.findIndex(x => x.id === folderId); if (i !== -1) f[i] = updated; }

            saveFolders(f); renderSidebarFolders(); goBack();
        };
    }

    // =================================================================
    // 10. 사이드바 폴더 렌더링
    //
    //  깜빡임 방지 핵심:
    //  → foldersSig()로 데이터가 실제로 바뀌었는지 먼저 확인
    //  → 이미 올바른 위치에 납치된 세션이 모두 있으면 렌더 생략
    //  → DOM 조작 시 _isRendering 플래그로 재진입 차단
    // =================================================================
    function renderSidebarFolders() {
        if (_isRendering) return;

        const root = getSidebarRoot();
        if (!root) return;

        const folders = getFolders();
        const sig = foldersSig(folders);

        // ── 스킵 판단 ─────────────────────────────────────────────
        if (sig === _lastRenderSig) {
            // 데이터 미변경 → 배정된 세션이 이미 올바른 폴더 안에 있는지만 확인
            const assigned = new Set(folders.flatMap(f => f.sessions));
            const hasOrphan = Array.from(
                root.querySelectorAll('a[href*="/stories/"]:not([data-in-folder])')
            ).some(a => assigned.has(a.getAttribute('href')));
            if (!hasOrphan) return; // 이미 올바른 상태 → 건너뜀
        }
        // ──────────────────────────────────────────────────────────

        _isRendering = true;
        try {
            // ① 납치된 세션 원위치 복원 (wrapper 제거 전에 먼저)
            const existing = root.querySelector('.my-sb-folder-wrapper');
            if (existing) {
                existing.querySelectorAll('a[data-in-folder]').forEach(a => {
                    a.removeAttribute('data-in-folder');
                    root.appendChild(a);
                });
                existing.remove();
            }

            if (!folders.length) { _lastRenderSig = sig; return; }

            // ② 세션 맵
            const assigned = new Set(folders.flatMap(f => f.sessions));
            const sessionMap = new Map();
            root.querySelectorAll('a[href*="/stories/"]').forEach(a => {
                const h = a.getAttribute('href');
                if (h && !sessionMap.has(h)) sessionMap.set(h, a);
            });

            // ③ 폴더 DOM 빌더 (재귀)
            const buildFolder = (fd, depth) => {
                const isOpen    = expandedFolders.has(fd.id);
                const subs      = folders.filter(f => f.parentId === fd.id);
                const wrapper   = document.createElement('div');
                wrapper.className = depth > 0 ? 'my-sb-folder my-sb-subfolder' : 'my-sb-folder';

                const hdr = document.createElement('div');
                hdr.className = 'my-sb-folder-header';
                const total = fd.sessions.length + subs.reduce((s, f) => s + f.sessions.length, 0);
                hdr.innerHTML = `
                    <span>📂</span>
                    <span class="my-sb-name">${fd.name}</span>
                    <span class="my-sb-count">(${total})</span>
                `;

                const content = document.createElement('div');
                content.className = 'my-sb-folder-content';
                if (!isOpen) content.style.display = 'none';

                hdr.addEventListener('click', () => {
                    const op = content.style.display === 'none';
                    content.style.display = op ? '' : 'none';
                    if (op) expandedFolders.add(fd.id); else expandedFolders.delete(fd.id);
                });

                subs.forEach(sub => content.appendChild(buildFolder(sub, depth + 1)));

                // ④ 납치
                fd.sessions.forEach(h => {
                    const a = sessionMap.get(h);
                    if (!a) return;
                    a.setAttribute('data-in-folder', '1');
                    content.appendChild(a);
                });

                wrapper.appendChild(hdr);
                wrapper.appendChild(content);
                return wrapper;
            };

            const outer = document.createElement('div');
            outer.className = 'my-sb-folder-wrapper';
            folders.filter(f => !f.parentId).forEach(rf => outer.appendChild(buildFolder(rf, 0)));
            root.insertBefore(outer, root.firstChild);

            _lastRenderSig = sig;

            // 메모 UI + 검색 필터 재적용
            injectMemoUI();
            const si = document.getElementById('my-search-input');
            if (si && si.value) filterSessions(si.value);

        } finally {
            _isRendering = false;
        }
    }

    // =================================================================
    // 11. 실행
    // =================================================================
    setInterval(() => {
        injectManagerButton();
        injectSearchBar();
        injectMemoUI();
        renderSidebarFolders();
    }, 3000);

    let _debounce = null;
    new MutationObserver(mutations => {
        if (_isRendering) return;
        const internal = mutations.every(m => m.target.closest?.('.my-sb-folder-wrapper'));
        if (internal) return;
        clearTimeout(_debounce);
        _debounce = setTimeout(() => {
            injectManagerButton();
            injectSearchBar();
            injectMemoUI();
            renderSidebarFolders();
        }, 400);
    }).observe(document.body, { childList: true, subtree: true });

    // =================================================================
    // 12. 스타일
    // =================================================================
    GM_addStyle(`
        /* 검색 숨김 */
        a[data-search-hidden="1"]            { display: none !important; }
        .my-sb-folder[data-search-hidden="1"]{ display: none !important; }

        /* ── 검색창 ── */
        #my-search-container {
            display: flex; align-items: center;
            padding: 6px 12px;
            border-bottom: 1px solid rgba(125,125,125,0.15);
        }
        #my-search-wrapper {
            display: flex; align-items: center; width: 100%;
            background: rgba(128,128,128,0.1);
            border-radius: 6px; padding: 4px 8px;
            border: 1px solid transparent; transition: border .2s;
        }
        #my-search-wrapper:focus-within { border-color: var(--primary, #00bbff); }
        #my-search-input {
            border: none; background: none; outline: none;
            color: inherit; font-size: 13px; width: 100%; margin-left: 4px;
        }
        .my-search-icon { font-size: 13px; opacity: .55; }

        /* ── 사이드바 폴더 ── */
        .my-sb-folder-wrapper { margin-bottom: 8px; }

        .my-sb-folder {
            margin-bottom: 4px;
            background-color: rgba(125,125,125,0.08);
            border: 1px solid rgba(125,125,125,0.2);
            border-radius: 8px; overflow: hidden; color: inherit;
        }
        .my-sb-subfolder {
            margin: 3px 6px 3px 14px; border-radius: 6px;
            background-color: rgba(125,125,125,0.05);
        }
        .my-sb-folder-header {
            display: flex; align-items: center; gap: 6px;
            padding: 10px 14px; cursor: pointer; font-weight: bold;
            background-color: rgba(125,125,125,0.1); user-select: none;
        }
        .my-sb-folder-header:hover { background-color: rgba(125,125,125,0.18); }
        .my-sb-name  { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .my-sb-count { margin-left: 4px; font-size: .9em; opacity: .7; font-weight: normal; flex-shrink: 0; }
        .my-sb-folder-content { border-top: 1px solid rgba(125,125,125,0.1); }

        /* ── 메모 버튼 ── */
        /* 플랫폼이 ⋮ 버튼을 a:hover 시에만 표시하는 구조이므로,
           className을 복사한 메모 버튼도 동일한 hide 규칙을 물려받음.
           visibility/display/opacity 세 축 모두 강제 표시로 덮어씀. */
        .crack-memo-btn {
            display: inline-flex !important;
            visibility: visible !important;
            opacity: .35 !important;
            transition: opacity .15s;
        }
        a:hover .crack-memo-btn, .crack-memo-btn:hover { opacity: 1 !important; }
        a[data-memo-injected="1"]:has(.crack-memo-preview:not([style*="display: none"])) .crack-memo-btn {
            opacity: 1 !important;
            color: var(--brand-color, #FF4432) !important;
        }
        .crack-memo-btn svg { pointer-events: none; }

        /* 카드 높이 자동 */
        .crack-memo-card { height: auto !important; min-height: 64px; }

        /* 메모 미리보기 */
        .crack-memo-preview {
            display: none; font-size: 11px; line-height: 1.4;
            color: var(--text_tertiary, #999);
            padding: 3px 0 4px; max-height: 36px;
            overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
            width: 100%; cursor: pointer;
        }
        .crack-memo-preview:hover { color: var(--text_primary, #333); }

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
        #cmemo-textarea {
            width: 100%; min-height: 120px; max-height: 300px;
            resize: vertical; padding: 10px 12px;
            border: 1px solid rgba(0,0,0,.5); border-radius: 8px;
            background: #e8e8e8; color: #1e1e1e;
            font-size: 13px; line-height: 1.6;
            box-sizing: border-box; outline: none; font-family: inherit;
            transition: border-color .15s;
        }
        #cmemo-textarea:focus   { border-color: #FF4432; }
        #cmemo-textarea::placeholder { color: rgba(0,0,0,.5); }
        .cmemo-footer { display: flex; gap: 8px; align-items: center; }
        .cmemo-btn {
            padding: 7px 14px; border-radius: 6px;
            border: 1px solid rgba(0,0,0,.5);
            background: rgba(255,255,255,.06); color: #1e1e1e;
            font-size: 13px; cursor: pointer; transition: background .15s;
        }
        .cmemo-btn:hover         { background: rgba(255,255,255,.12); }
        .cmemo-btn-primary       { background: #FF4432; color: #fff; border-color: #FF4432; }
        .cmemo-btn-primary:hover { background: #e03a29; border-color: #e03a29; }
        .cmemo-btn-danger        { background: transparent; color: #ff6b6b; border-color: rgba(255,59,48,.4); }
        .cmemo-btn-danger:hover  { background: rgba(255,59,48,.15); border-color: #ff3b30; }

        /* ── 폴더 관리 모달 ── */
        #my-folder-manager-modal {
            position: fixed; inset: 0; background: rgba(0,0,0,.5);
            z-index: 9999; display: flex; justify-content: center; align-items: center;
        }
        .fmgr-box {
            background: #fff; color: #333; border-radius: 12px; padding: 20px;
            width: 440px; max-width: 92vw; max-height: 80vh;
            display: flex; flex-direction: column; gap: 12px;
            box-shadow: 0 8px 28px rgba(0,0,0,.35);
        }
        .fmgr-header { display: flex; align-items: center; justify-content: space-between; font-size: 17px; font-weight: bold; }
        .fmgr-list   { flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 5px; min-height: 60px; }
        .fmgr-footer { display: flex; justify-content: flex-end; }
        .fmgr-empty  { text-align: center; padding: 24px 0; color: #999; font-size: 13px; }

        .fmgr-row {
            display: flex; align-items: center; justify-content: space-between;
            padding: 8px 10px; border: 1px solid rgba(125,125,125,.2);
            border-radius: 7px; background: rgba(125,125,125,.04);
        }
        .fmgr-row-info  { display: flex; align-items: center; gap: 5px; flex: 1; overflow: hidden; min-width: 0; }
        .fmgr-row-name  { font-size: 13px; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .fmgr-row-count { font-size: 11px; color: #999; flex-shrink: 0; }
        .fmgr-row-btns  { display: flex; gap: 4px; flex-shrink: 0; margin-left: 8px; }
        .fmgr-icon-btn  {
            padding: 3px 8px; border-radius: 5px; border: 1px solid #ddd;
            background: #fff; cursor: pointer; font-size: 11px; color: #444;
        }
        .fmgr-icon-btn:hover:not(:disabled) { background: #f0f0f0; }
        .fmgr-icon-btn:disabled { opacity: .3; cursor: default; }
        .fmgr-danger-txt { color: #dd2222 !important; }
        .fmgr-btn {
            padding: 7px 16px; border-radius: 7px; border: 1px solid #ccc;
            background: #fff; cursor: pointer; font-size: 13px; color: #333;
        }
        .fmgr-btn:hover { background: #f5f5f5; }
        .fmgr-btn-new   {
            padding: 5px 12px; border-radius: 6px; border: none;
            background: #007aff; color: #fff; font-size: 13px; cursor: pointer;
        }
        .fmgr-btn-new:hover { background: #005fd4; }

        /* ── 설정 모달 ── */
        #my-folder-settings-modal {
            position: fixed; inset: 0; background: rgba(0,0,0,.5);
            z-index: 10000; display: flex; justify-content: center; align-items: center;
        }
        .fset-box {
            background: #fff; color: #333; border-radius: 12px; padding: 20px;
            width: 480px; max-width: 92vw; max-height: 86vh;
            display: flex; flex-direction: column; gap: 14px;
            box-shadow: 0 8px 28px rgba(0,0,0,.35);
        }
        .fset-header { font-size: 17px; font-weight: bold; }
        .fset-body   { flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 13px; padding-right: 3px; }
        .fset-footer { display: flex; gap: 8px; align-items: center; padding-top: 10px; border-top: 1px solid #eee; }
        .fset-field  { display: flex; flex-direction: column; gap: 5px; }
        .fset-label  { font-size: 12px; font-weight: 600; color: #555; }
        .fset-label-sub { font-weight: normal; color: #999; }
        .fset-input, .fset-select {
            padding: 8px 10px; border: 1px solid #ddd; border-radius: 7px;
            font-size: 13px; background: #fff; color: #333;
            box-sizing: border-box; width: 100%;
        }
        .fset-session-list { border: 1px solid #ddd; border-radius: 7px; max-height: 210px; overflow-y: auto; padding: 3px; }
        .fset-session-item {
            display: flex; align-items: center; gap: 7px;
            padding: 6px 8px; border-bottom: 1px solid #f2f2f2; font-size: 13px;
        }
        .fset-session-item:last-child { border-bottom: none; }
        .fset-session-item label {
            flex: 1; cursor: pointer;
            white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
            display: flex; align-items: center; gap: 5px;
        }
        .fset-session-item input[type="checkbox"] { cursor: pointer; flex-shrink: 0; }
        .fset-badge-parent { font-size: 10px; background: rgba(0,122,255,.1); color: #007aff; border-radius: 3px; padding: 1px 5px; flex-shrink: 0; }
        .fset-session-memo { font-size: 11px; color: #999; font-style: italic; }
        .fset-empty { padding: 12px; color: #999; font-size: 12px; text-align: center; }
        .fset-btn   { padding: 7px 16px; border-radius: 7px; border: 1px solid #ccc; background: #fff; cursor: pointer; font-size: 13px; color: #333; }
        .fset-btn:hover          { background: #f5f5f5; }
        .fset-btn-primary        { background: #007aff; color: #fff; border-color: #007aff; }
        .fset-btn-primary:hover  { background: #005fd4; }
        .fset-btn-danger         { background: #ff3b30; color: #fff; border-color: #ff3b30; }
        .fset-btn-danger:hover   { background: #d42b21; }

        /* ── 다크 모드 ── */
        @media (prefers-color-scheme: dark) {
            .fmgr-box, .fset-box      { background: #2c2c2c; color: #eee; }
            .fmgr-row                 { background: rgba(255,255,255,.04); border-color: #444; }
            .fmgr-icon-btn, .fmgr-btn { background: #3a3a3a; color: #ccc; border-color: #555; }
            .fmgr-icon-btn:hover:not(:disabled), .fmgr-btn:hover { background: #484848; }
            .fset-footer              { border-color: #444; }
            .fset-input, .fset-select { background: #3a3a3a; color: #eee; border-color: #555; }
            .fset-session-list        { border-color: #555; }
            .fset-session-item        { border-color: #3d3d3d; }
            .fset-btn                 { background: #3a3a3a; color: #eee; border-color: #555; }
            .fset-btn:hover           { background: #484848; }
        }
    `);
})();
