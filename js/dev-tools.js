/* DEV MODE - loaded only when the page is opened with ?dev (e.g. index.html?dev).
   Edit text, add / move / duplicate / delete cards and sections, attach files,
   then Save overwrites the existing index.html (and writes uploads into docs/ or images/). */
(function () {
    'use strict';

    // ---------- helpers ----------
    const $ = (s, r = document) => r.querySelector(s);
    const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
    const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const html = str => { const t = document.createElement('template'); t.innerHTML = str.trim(); return t.content.firstElementChild; };

    const content = $('#content-wrapper');
    const nav = $('#nav-menu');
    const bar = $('#dev-bar');
    const statusEl = $('#dev-status');
    const toggleBtn = $('#dev-toggle-btn');
    const saveBtn = $('#dev-save-btn');
    const undoBtn = $('#dev-undo-btn');
    const sectionRow = $('#dev-section-row');

    let editing = false, dirty = false, saving = false;
    let dirHandle = null;
    const pending = new Map();   // 'docs/x.pdf' -> { file, urls: [blob urls] }
    const undoStack = [];

    // Everything that becomes typeable in edit mode (existing data-editable ones plus a few extras)
    const EDITABLE_SEL = '[data-editable="true"], .skill-card h3, .tech-pill, .doc-card .doc-tag, .doc-card h3, .doc-card p, .open-badge';

    // ---------- card / item types (markup mirrors the existing cards exactly) ----------
    const KINDS = [
        { cls: 'project-card', box: 'projects-grid', name: 'Project', make: () => html(`
<div class="project-card">
    <div class="corner-fill" data-langs="Python:100"></div>
    <div class="project-head">
        <h3 class="project-title" data-editable="true">Project<br>Title</h3>
        <a href="https://github.com/" target="_blank" class="github-link">SRC ↗</a>
    </div>
    <p class="project-desc" data-editable="true">Describe what this project does.</p>
    <div>
        <span class="tech-pill" data-editable="true">Tech</span>
    </div>
</div>`) },
        { cls: 'skill-card', box: 'skills-grid', name: 'Skill group', make: () => html(
            '<div class="skill-card"><h3>Category</h3><span class="tech-pill">Skill</span></div>') },
        { cls: 'timeline-item', box: 'timeline', name: 'Entry', make: () => html(`
<div class="timeline-item">
    <span class="timeline-date" data-editable="true">Month YYYY — Month YYYY</span>
    <h3 class="timeline-title" data-editable="true">Role Title</h3>
    <div class="timeline-company" data-editable="true">Company</div>
    <p class="timeline-desc" data-editable="true">Describe what you did and the impact.</p>
</div>`) },
        { cls: 'edu-card', box: 'edu-grid', name: 'Card', make: () => html(`
<div class="edu-card">
    <h3 data-editable="true">Title</h3>
    <h4 data-editable="true">Subtitle</h4>
    <p data-editable="true">Describe it here.</p>
</div>`) },
        { cls: 'cert-card', box: 'certs-grid', name: 'Cert', make: () => html(`
<div class="cert-card">
    <h4 data-editable="true">Certification Name</h4>
    <span class="cert-issuer" data-editable="true">Issuer</span>
    <p data-editable="true">What it covers.</p>
</div>`) },
        { cls: 'doc-card', box: 'docs-grid', name: 'Doc', make: () => html(
            '<div class="doc-card soon"><span class="doc-tag">Coming soon</span><h3>Document Title</h3><p>Short description.</p></div>') },
        { cls: 'contact-card', box: 'contact-links', name: 'Contact', make: () => html(
            '<a href="https://example.com" target="_blank" class="contact-card"><span data-editable="true">Label</span> <span data-editable="true">Value</span></a>') }
    ];
    const kindOf = el => el && KINDS.find(k => el.classList.contains(k.cls));
    const ITEM_SEL = KINDS.map(k => '#content-wrapper .' + k.cls).join(',') + ',#content-wrapper .btn-row a.btn';

    const LANG_CLASSES = [['', '(none)'], ['python', 'Python'], ['qiskit', 'Qiskit'], ['typescript', 'TypeScript'], ['js', 'JavaScript'],
        ['html', 'HTML'], ['css', 'CSS'], ['jupyter', 'Jupyter'], ['pytorch', 'PyTorch'], ['sql', 'SQL'], ['plaid', 'Plaid']];

    const LAYOUTS = [['projects-grid', 'Project cards'], ['skills-grid', 'Skill groups'], ['timeline', 'Timeline entries'],
        ['edu-grid', 'Education cards'], ['docs-grid', 'Docs / file cards'], ['contact-links', 'Contact cards']];

    // ---------- status / dirty / undo ----------
    function updateStatus() {
        const parts = [editing ? 'EDITING' : 'Dev mode'];
        parts.push(dirHandle ? 'folder: ' + dirHandle.name : 'no folder connected');
        if (dirty) parts.push('unsaved changes');
        if (pending.size) parts.push(pending.size + ' file' + (pending.size > 1 ? 's' : '') + ' queued');
        statusEl.textContent = parts.join(' · ');
        saveBtn.classList.toggle('dirty', dirty);
        undoBtn.disabled = !undoStack.length;
    }
    function markDirty() { dirty = true; updateStatus(); }
    function pushUndo(fn) { undoStack.push(fn); if (undoStack.length > 60) undoStack.shift(); updateStatus(); }
    function changed() { markDirty(); hideTbs(); renderSectionRow(); }

    function opInsert(node, parent, before) { parent.insertBefore(node, before); setEditable(node, editing); pushUndo(() => node.remove()); changed(); }
    function opRemove(node) {
        const parent = node.parentNode, next = node.nextSibling;
        node.remove();
        pushUndo(() => parent.insertBefore(node, next));
        changed();
    }
    function opMove(node, dir) {
        const sib = dir < 0 ? node.previousElementSibling : node.nextElementSibling;
        if (!sib) return;
        const parent = node.parentNode, next = node.nextSibling;
        if (dir < 0) parent.insertBefore(node, sib); else sib.after(node);
        pushUndo(() => parent.insertBefore(node, next));
        changed();
    }

    // ---------- editable text ----------
    function setEditable(root, on) {
        const list = $$(EDITABLE_SEL, root);
        if (root.matches && root.matches(EDITABLE_SEL)) list.push(root);
        list.forEach(el => on ? el.setAttribute('contenteditable', 'true') : el.removeAttribute('contenteditable'));
    }
    function focusText(el) {
        if (!el) return;
        el.focus();
        const r = document.createRange(); r.selectNodeContents(el);
        const s = getSelection(); s.removeAllRanges(); s.addRange(r);
    }

    document.addEventListener('input', e => { if (editing && e.target.closest && e.target.closest('[contenteditable="true"]')) markDirty(); });
    document.addEventListener('keydown', e => {
        if (!editing) return;
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); save(); return; }
        const el = e.target.closest && e.target.closest('[contenteditable="true"]');
        if (!el) return;
        if (e.key === 'Enter') {
            e.preventDefault();
            if (el.tagName !== 'SPAN') document.execCommand('insertLineBreak');
        }
    });
    document.addEventListener('paste', e => {
        if (!editing) return;
        const el = e.target.closest && e.target.closest('[contenteditable="true"]');
        if (!el) return;
        e.preventDefault();
        const t = (e.clipboardData || window.clipboardData).getData('text/plain').replace(/\s*\r?\n\s*/g, ' ');
        document.execCommand('insertText', false, t);
    });
    // links are not clickable while editing
    document.addEventListener('click', e => {
        if (editing && e.target.closest && e.target.closest('#content-wrapper a')) e.preventDefault();
    }, true);

    // ---------- folder access (so Save can overwrite the real files) ----------
    function idb() {
        return new Promise((res, rej) => {
            const r = indexedDB.open('portfolio-dev', 1);
            r.onupgradeneeded = () => r.result.createObjectStore('h');
            r.onsuccess = () => res(r.result);
            r.onerror = () => rej(r.error);
        });
    }
    async function idbGet(k) {
        try { const db = await idb(); return await new Promise(res => { const q = db.transaction('h').objectStore('h').get(k); q.onsuccess = () => res(q.result); q.onerror = () => res(null); }); }
        catch { return null; }
    }
    async function idbSet(k, v) {
        try { const db = await idb(); await new Promise(res => { const t = db.transaction('h', 'readwrite'); t.objectStore('h').put(v, k); t.oncomplete = res; t.onerror = res; }); } catch { /* ignore */ }
    }
    async function hasPerm(h) {
        const o = { mode: 'readwrite' };
        if ((await h.queryPermission(o)) === 'granted') return true;
        return (await h.requestPermission(o)) === 'granted';
    }
    async function hasIndex(h) { try { await h.getFileHandle('index.html'); return true; } catch { return false; } }

    async function ensureFolder() {
        if (!window.showDirectoryPicker) {
            alert('Saving in place needs Chrome or Edge on desktop (Firefox and Safari cannot write to files).');
            return false;
        }
        try { if (dirHandle && await hasPerm(dirHandle)) return true; } catch { dirHandle = null; }
        try {
            const stored = await idbGet('folder');
            if (stored && await hasPerm(stored) && await hasIndex(stored)) { dirHandle = stored; updateStatus(); return true; }
        } catch { /* fall through to picker */ }
        let h;
        try { h = await showDirectoryPicker({ id: 'portfolio-site', mode: 'readwrite' }); } catch { return false; }
        if (!(await hasIndex(h))) { alert('That folder has no index.html in it. Pick the folder that contains your index.html (the one with css, js and images inside).'); return false; }
        dirHandle = h; await idbSet('folder', h); updateStatus();
        return true;
    }

    // ---------- file queue (nothing touches disk until Save) ----------
    function pathOfHref(href) {
        if (!href) return null;
        if (href.startsWith('blob:')) { for (const [p, e] of pending) if (e.urls.includes(href)) return p; return null; }
        if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('#') || href.startsWith('/')) return null;
        return href.replace(/^\.\//, '');
    }
    async function taken(path) {
        if (pending.has(path)) return true;
        try {
            const parts = path.split('/'); let d = dirHandle;
            for (const p of parts.slice(0, -1)) d = await d.getDirectoryHandle(p);
            await d.getFileHandle(parts[parts.length - 1]);
            return true;
        } catch { return false; }
    }
    // keepPath: the file this upload is deliberately replacing (e.g. re-uploading resume.pdf onto the resume card)
    async function queueFile(file, dir, keepPath) {
        const clean = file.name.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'file';
        let path = dir + '/' + clean;
        if (path !== keepPath) {
            const ext = (clean.match(/\.[^.]*$/) || [''])[0];
            const base = clean.slice(0, clean.length - ext.length);
            let n = 1;
            while (await taken(path)) { n++; path = `${dir}/${base}-${n}${ext}`; }
        }
        const url = URL.createObjectURL(file);
        const e = pending.get(path) || { file, urls: [] };
        e.file = file; e.urls.push(url); pending.set(path, e);
        markDirty();
        return { path, url };
    }
    const extTag = name => ((name.match(/\.([^.]+)$/) || [, 'FILE'])[1]).toUpperCase().slice(0, 6);

    // ---------- modal form builder ----------
    function closeModal() { const m = $('#dev-modal'); if (m) m.remove(); }
    function openForm(opts) {
        closeModal();
        const m = document.createElement('div'); m.id = 'dev-modal';
        const box = document.createElement('div'); box.className = 'dm-box';
        box.innerHTML = `<h4>${esc(opts.title)}</h4>`;
        const form = document.createElement('form'); box.appendChild(form);
        const inputs = {};
        opts.fields.forEach(f => {
            if (f.type === 'heading') { form.appendChild(html(`<div class="dm-head">${esc(f.label)}</div>`)); return; }
            if (f.type === 'note') { form.appendChild(html(`<div class="dm-note">${esc(f.label)}</div>`)); return; }
            const wrap = document.createElement('label'); wrap.className = 'dm-field' + (f.type === 'checkbox' ? ' dm-check' : '');
            let inp;
            if (f.type === 'select') {
                inp = document.createElement('select');
                f.options.forEach(([v, l]) => { const o = document.createElement('option'); o.value = v; o.textContent = l; inp.appendChild(o); });
                inp.value = f.value != null ? f.value : f.options[0][0];
            } else if (f.type === 'textarea') { inp = document.createElement('textarea'); inp.rows = 3; inp.value = f.value || ''; }
            else if (f.type === 'checkbox') { inp = document.createElement('input'); inp.type = 'checkbox'; inp.checked = !!f.value; }
            else if (f.type === 'file') { inp = document.createElement('input'); inp.type = 'file'; if (f.accept) inp.accept = f.accept; }
            else { inp = document.createElement('input'); inp.type = 'text'; inp.value = f.value || ''; if (f.placeholder) inp.placeholder = f.placeholder; }
            const span = document.createElement('span'); span.textContent = f.label;
            if (f.type === 'checkbox') wrap.append(inp, span); else wrap.append(span, inp);
            form.appendChild(wrap); inputs[f.key] = [f, inp];
        });
        const actions = html('<div class="dm-actions"><button type="button">Cancel</button><button type="submit"></button></div>');
        actions.lastElementChild.textContent = opts.submitLabel || 'Apply';
        actions.firstElementChild.addEventListener('click', closeModal);
        form.appendChild(actions);
        form.addEventListener('submit', async ev => {
            ev.preventDefault();
            const v = {};
            for (const k in inputs) {
                const [f, inp] = inputs[k];
                v[k] = f.type === 'checkbox' ? inp.checked : f.type === 'file' ? (inp.files[0] || null) : inp.value.trim();
            }
            try { await opts.onSubmit(v); closeModal(); changed(); } catch (err) { alert(err.message || err); }
        });
        m.addEventListener('mousedown', ev => { if (ev.target === m) closeModal(); });
        m.appendChild(box); document.body.appendChild(m);
        const first = $('input[type="text"], textarea, select', form); if (first) first.focus();
    }
    document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

    // ---------- type-specific editors ----------
    function toLiveDoc(card, href, tag) {
        let a = card;
        if (card.tagName !== 'A') {
            a = document.createElement('a'); a.className = 'doc-card';
            while (card.firstChild) a.appendChild(card.firstChild);
            card.replaceWith(a);
        }
        a.classList.remove('soon');
        a.setAttribute('href', href); a.setAttribute('target', '_blank'); a.setAttribute('rel', 'noopener');
        const t = $('.doc-tag', a); if (t && tag) t.textContent = tag;
        setEditable(a, editing);
        return a;
    }
    function toSoonDoc(card, tag) {
        let d = card;
        if (card.tagName === 'A') {
            d = document.createElement('div'); d.className = 'doc-card';
            while (card.firstChild) d.appendChild(card.firstChild);
            card.replaceWith(d);
        }
        d.classList.add('soon');
        ['href', 'target', 'rel'].forEach(a => d.removeAttribute(a));
        const t = $('.doc-tag', d); if (t) t.textContent = tag || 'Coming soon';
        setEditable(d, editing);
        return d;
    }
    function editDoc(card) {
        const live = card.tagName === 'A';
        const cur = live ? card.getAttribute('href') : '';
        openForm({
            title: 'Doc card: file & status',
            fields: [
                { type: 'note', label: 'Upload a PDF / image / document, or paste a link. Files are copied into your docs/ folder when you press Save. Edit the title and description by clicking them on the page.' },
                { key: 'file', type: 'file', label: 'Upload file' },
                { key: 'url', type: 'text', label: 'Or link / path', value: cur && !cur.startsWith('blob:') ? cur : '', placeholder: 'docs/letter.pdf or https://…' },
                { key: 'tag', type: 'text', label: 'Tag shown on card', value: $('.doc-tag', card).textContent.trim() },
                { key: 'soon', type: 'checkbox', label: 'Mark as "Coming soon" (not clickable)', value: !live }
            ],
            onSubmit: async v => {
                // supplying a file (or a link on a card that was "Coming soon") always makes it live
                const supplied = v.file || (v.url && !live);
                if (v.soon && !supplied) { toSoonDoc(card, !v.tag || v.tag === 'PDF' ? 'Coming soon' : v.tag); return; }
                let href = v.url, tag = v.tag;
                if (v.file) {
                    const r = await queueFile(v.file, 'docs', pathOfHref(cur));
                    href = r.url;
                    if (!tag || tag === 'Coming soon' || tag === $('.doc-tag', card).textContent.trim()) tag = extTag(v.file.name);
                }
                if (!href) throw new Error('Choose a file or enter a link, or tick "Coming soon".');
                if (!v.file && (!tag || tag === 'Coming soon')) tag = 'LINK';
                toLiveDoc(card, href, tag);
            }
        });
    }
    function editLink(a, allowFile) {
        const cur = a.getAttribute('href') || '';
        openForm({
            title: 'Edit link',
            fields: [
                { key: 'url', type: 'text', label: 'Link (URL, mailto:, or file path)', value: cur.startsWith('blob:') ? (pathOfHref(cur) || '') : cur },
                ...(allowFile ? [{ type: 'note', label: 'Or upload a file to point this link at (saved into docs/ on Save). Uploading a file with the same name as the current one replaces it.' },
                    { key: 'file', type: 'file', label: 'Upload file' }] : []),
                { key: 'tab', type: 'checkbox', label: 'Open in a new tab', value: a.getAttribute('target') === '_blank' }
            ],
            onSubmit: async v => {
                let href = v.url;
                if (v.file) { const r = await queueFile(v.file, 'docs', pathOfHref(cur)); href = r.url; }
                if (!href) throw new Error('Enter a link.');
                a.setAttribute('href', href);
                if (v.tab) { a.setAttribute('target', '_blank'); a.setAttribute('rel', 'noopener'); }
                else { a.removeAttribute('target'); a.removeAttribute('rel'); }
            }
        });
    }
    function parseLinks(card) {
        const head = $('.project-head', card);
        return $$(':scope > .github-link, :scope > .link-row > .github-link', head).map(el => ({
            label: el.textContent.trim(), url: el.getAttribute('href') || '',
            style: (el.tagName === 'SPAN' || el.classList.contains('disabled')) ? 'disabled' : el.classList.contains('live') ? 'live' : 'src'
        }));
    }
    function editProjectLinks(card) {
        const links = parseLinks(card);
        const fields = [{ type: 'note', label: 'Up to 3 buttons in the top-right of the card. Leave the label empty to remove one.' }];
        for (let i = 0; i < 3; i++) {
            const l = links[i] || { label: '', url: '', style: 'src' };
            fields.push({ type: 'heading', label: 'Button ' + (i + 1) });
            fields.push({ key: 'l' + i, type: 'text', label: 'Label', value: l.label, placeholder: i === 0 ? 'SRC ↗' : 'PLAY ↗' });
            fields.push({ key: 'u' + i, type: 'text', label: 'URL', value: l.url });
            fields.push({ key: 's' + i, type: 'select', label: 'Style', value: l.style, options: [['src', 'Source (outlined)'], ['live', 'Live / Play (highlighted)'], ['disabled', 'Badge, no link (e.g. IN DEV)']] });
        }
        openForm({
            title: 'Project buttons', fields,
            onSubmit: async v => {
                const rows = [0, 1, 2].map(i => ({ label: v['l' + i], url: v['u' + i], style: v['s' + i] })).filter(r => r.label);
                rows.forEach(r => { if (r.style !== 'disabled' && !r.url) throw new Error('"' + r.label + '" needs a URL (or set its style to Badge).'); });
                const head = $('.project-head', card);
                $$(':scope > .github-link, :scope > .link-row', head).forEach(n => n.remove());
                const mk = r => {
                    if (r.style === 'disabled') { const s = document.createElement('span'); s.className = 'github-link disabled'; s.textContent = r.label; return s; }
                    const a = document.createElement('a'); a.href = r.url; a.target = '_blank';
                    a.className = 'github-link' + (r.style === 'live' ? ' live' : '');
                    if (r.style === 'live' || rows.length > 1) a.rel = 'noopener';
                    a.textContent = r.label; return a;
                };
                if (rows.length === 1) head.appendChild(mk(rows[0]));
                else if (rows.length > 1) { const lr = document.createElement('div'); lr.className = 'link-row'; rows.forEach(r => lr.appendChild(mk(r))); head.appendChild(lr); }
            }
        });
    }
    function editLangs(card) {
        const cf = $('.corner-fill', card);
        openForm({
            title: 'Language split (corner color)',
            fields: [
                { type: 'note', label: 'Format: Language:percent, Language:percent. Known colors: Python, TypeScript, JavaScript, HTML, CSS, Jupyter Notebook, PLpgSQL (others show gray).' },
                { key: 'langs', type: 'text', label: 'Languages', value: cf ? cf.dataset.langs : '' }
            ],
            onSubmit: async v => {
                const ok = v.langs.split(',').every(p => /^[^:]+:\s*\d+(\.\d+)?$/.test(p.trim()));
                if (!v.langs || !ok) throw new Error('Use the format Python:60, HTML:40');
                let el = cf;
                if (!el) { el = document.createElement('div'); el.className = 'corner-fill'; card.prepend(el); }
                el.dataset.langs = v.langs; paintCornerFill(el);
            }
        });
    }
    function editPillColor(pill) {
        openForm({
            title: 'Pill hover color',
            fields: [{ key: 'c', type: 'select', label: 'Color it takes on when the card is hovered', value: pill.getAttribute('data-lang') || '', options: LANG_CLASSES }],
            onSubmit: async v => { if (v.c) pill.setAttribute('data-lang', v.c); else pill.removeAttribute('data-lang'); }
        });
    }

    // ---------- adding things ----------
    function pillBox(card) {
        if (card.classList.contains('skill-card')) return card;
        return $$(':scope > div', card).filter(d => !d.classList.contains('corner-fill') && !d.classList.contains('project-head')).pop();
    }
    function addPill(card, after) {
        const box = pillBox(card); if (!box) return;
        const p = document.createElement('span'); p.className = 'tech-pill'; p.textContent = 'New';
        if (card.classList.contains('project-card')) p.setAttribute('data-editable', 'true');
        const tight = card.classList.contains('skill-card');
        const ref = after || $$('.tech-pill', box).pop();
        const frag = document.createDocumentFragment();
        if (!tight) frag.appendChild(document.createTextNode(' '));
        frag.appendChild(p);
        if (ref && ref.parentNode === box) ref.after(frag); else box.appendChild(frag);
        setEditable(p, editing);
        pushUndo(() => p.remove()); changed();
        focusText(p);
    }
    function addItem(kind, container, afterEl) {
        const node = kind.make();
        if (kind.cls === 'project-card') paintCornerFill($('.corner-fill', node));
        opInsert(node, container, afterEl ? afterEl.nextSibling : null);
        node.scrollIntoView({ block: 'center', behavior: 'smooth' });
        if (kind.cls === 'doc-card') editDoc(node);
        else focusText($('[contenteditable="true"]', node));
    }
    function slug(s) {
        let base = s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'section';
        let id = base, n = 1;
        while (document.getElementById(id)) id = base + '-' + (++n);
        return id;
    }
    function syncNav() {
        $$('#content-wrapper > section.screen').forEach(s => {
            const l = $('a.nav-link[href="#' + s.id + '"]', nav);
            if (l) nav.appendChild(l);
        });
    }
    function addSection(after, title, layout, label) {
        const kind = KINDS.find(k => k.box === layout);
        const id = slug(title);
        const sec = html(`<section id="${id}" class="screen"><h2 class="screen-title" data-editable="true">${esc(title)}</h2><p class="section-intro" data-editable="true">Add a short intro for this section.</p><div class="${layout}"></div></section>`);
        const item = kind.make();
        if (kind.cls === 'project-card') paintCornerFill($('.corner-fill', item));
        $('.' + layout, sec).appendChild(item);
        after.after(sec);
        const link = html(`<a class="nav-link" href="#${id}">${esc(label || title)}</a>`);
        nav.appendChild(link); syncNav();
        setEditable(sec, editing);
        pushUndo(() => { sec.remove(); link.remove(); });
        changed();
        sec.scrollIntoView({ behavior: 'smooth' });
    }

    // ---------- floating toolbars ----------
    const itemTb = document.createElement('div'); itemTb.id = 'dev-item-tb';
    const pillTb = document.createElement('div'); pillTb.id = 'dev-pill-tb';
    document.body.append(itemTb, pillTb);
    let curItem = null, curPill = null, hideTimer = null;

    function btn(label, title, fn, danger) {
        const b = document.createElement('button'); b.type = 'button'; b.textContent = label; b.title = title;
        if (danger) b.className = 'danger';
        b.addEventListener('mousedown', e => e.preventDefault());   // keep text selection / focus
        b.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); fn(); });
        return b;
    }
    const sep = () => { const s = document.createElement('span'); s.className = 'sep'; return s; };

    function place(tb, el) {
        tb.style.display = 'flex';
        const r = el.getBoundingClientRect(), w = tb.offsetWidth, h = tb.offsetHeight;
        let top = r.top - h - 2;
        if (top < 90) top = Math.max(r.top + 4, 90);
        top = Math.min(top, innerHeight - h - 4);
        const left = Math.min(Math.max(r.right - w, 4), innerWidth - w - 4);
        tb.style.top = top + 'px'; tb.style.left = left + 'px';
    }
    function hideTbs() { itemTb.style.display = 'none'; pillTb.style.display = 'none'; curItem = curPill = null; }

    function showItem(el) {
        curPill = null; pillTb.style.display = 'none';
        if (curItem !== el) {
            curItem = el; itemTb.innerHTML = '';
            const kind = kindOf(el);
            if (!kind) {                                   // hero button: link only
                itemTb.append(btn('Link / file…', 'Edit where this button goes', () => editLink(curItem, true)));
            } else {
                itemTb.append(
                    btn('◀', 'Move earlier', () => opMove(curItem, -1)),
                    btn('▶', 'Move later', () => opMove(curItem, 1)),
                    btn('⧉', 'Duplicate', () => { const c = curItem.cloneNode(true); setEditable(c, true); opInsert(c, curItem.parentNode, curItem.nextSibling); }),
                    btn('＋', 'Add a new ' + kind.name.toLowerCase() + ' after this one', () => addItem(kind, curItem.parentNode, curItem))
                );
                if (kind.cls === 'project-card') itemTb.append(sep(), btn('Buttons…', 'Edit SRC / PLAY buttons', () => editProjectLinks(curItem)), btn('Languages…', 'Edit corner color split', () => editLangs(curItem)), btn('＋Pill', 'Add a tech pill', () => addPill(curItem)));
                if (kind.cls === 'skill-card') itemTb.append(sep(), btn('＋Pill', 'Add a skill', () => addPill(curItem)));
                if (kind.cls === 'doc-card') itemTb.append(sep(), btn('File / status…', 'Upload a file, set link or Coming soon', () => editDoc(curItem)));
                if (kind.cls === 'contact-card') itemTb.append(sep(), btn('Link…', 'Edit where this goes', () => editLink(curItem, false)));
                itemTb.append(sep(), btn('✕', 'Delete (Undo available)', () => { const n = curItem; opRemove(n); }, true));
            }
        }
        place(itemTb, el);
    }
    function showPill(el) {
        curItem = null; itemTb.style.display = 'none';
        if (curPill !== el) {
            curPill = el; pillTb.innerHTML = '';
            const card = el.closest('.project-card, .skill-card');
            pillTb.append(btn('＋', 'Add a pill after this', () => addPill(curPill.closest('.project-card, .skill-card'), curPill)));
            if (card && card.classList.contains('project-card')) pillTb.append(btn('Color…', 'Hover color', () => editPillColor(curPill)));
            pillTb.append(btn('✕', 'Remove pill', () => { opRemove(curPill); }, true));
        }
        place(pillTb, el);
    }
    function scheduleHide() { clearTimeout(hideTimer); hideTimer = setTimeout(hideTbs, 250); }
    [itemTb, pillTb].forEach(tb => tb.addEventListener('mouseenter', () => clearTimeout(hideTimer)));

    document.addEventListener('mouseover', e => {
        if (!editing || $('#dev-modal')) return;
        const t = e.target;
        if (t.closest('#dev-item-tb, #dev-pill-tb')) { clearTimeout(hideTimer); return; }
        if (t.closest('#dev-bar')) return;
        const pill = t.closest('#content-wrapper .tech-pill');
        const item = t.closest(ITEM_SEL);
        clearTimeout(hideTimer);
        if (pill && item) showPill(pill);
        else if (item) showItem(item);
        else scheduleHide();
    });
    window.addEventListener('scroll', () => {
        if (curItem && document.contains(curItem)) place(itemTb, curItem);
        else if (curPill && document.contains(curPill)) place(pillTb, curPill);
        else hideTbs();
        const s = currentSection();
        if (s !== shownSection) renderSectionRow();
    }, { passive: true });
    window.addEventListener('resize', hideTbs);

    // ---------- section panel ----------
    let shownSection = null;
    function currentSection() {
        const secs = $$('#content-wrapper > section.screen');
        let cur = secs[0];
        secs.forEach(s => { if (window.scrollY >= s.offsetTop - 180) cur = s; });
        return cur;
    }
    function sectionTitle(s) { const h = $('.screen-title', s); return h ? h.textContent.trim() : s.id; }
    function renderSectionRow() {
        sectionRow.innerHTML = '';
        shownSection = null;
        if (!editing) return;
        const sec = currentSection(); if (!sec) return;
        shownSection = sec;
        const isHome = sec.id === 'home';
        const secs = $$('#content-wrapper > section.screen');
        const idx = secs.indexOf(sec);
        const lab = document.createElement('div'); lab.className = 'dev-label'; lab.textContent = 'Section: ' + (isHome ? 'Home' : sectionTitle(sec));
        sectionRow.appendChild(lab);
        const mini = (label, title, fn, o = {}) => {
            const b = document.createElement('button'); b.type = 'button'; b.className = 'dev-mini' + (o.danger ? ' danger' : '');
            b.textContent = label; b.title = title; b.disabled = !!o.disabled; b.addEventListener('click', fn); sectionRow.appendChild(b);
        };
        mini('▲', 'Move section up', () => moveSection(sec, -1), { disabled: isHome || idx <= 1 });
        mini('▼', 'Move section down', () => moveSection(sec, 1), { disabled: isHome || idx === secs.length - 1 });
        KINDS.forEach(k => {
            const box = $('.' + k.box, sec);
            if (box) mini('＋ ' + k.name, 'Add a new ' + k.name.toLowerCase() + ' to this section', () => addItem(k, box, null));
        });
        if ($('.docs-grid', sec)) mini('⇪ Upload files', 'Add one doc card per file', () => uploadDocs(sec));
        mini('＋ Section', 'Add a new section below this one', () => newSectionForm(sec));
        mini('Nav label', 'Rename the menu link', () => navLabelForm(sec), { disabled: isHome && !$('a.nav-link[href="#home"]', nav) });
        mini('✕ Section', 'Delete this whole section', () => deleteSection(sec), { danger: true, disabled: isHome });
    }
    function moveSection(sec, dir) {
        const sib = dir < 0 ? sec.previousElementSibling : sec.nextElementSibling;
        if (!sib || sib.id === 'home' && dir < 0) return;
        const parent = sec.parentNode, next = sec.nextSibling;
        if (dir < 0) parent.insertBefore(sec, sib); else sib.after(sec);
        syncNav();
        pushUndo(() => { parent.insertBefore(sec, next); syncNav(); });
        changed(); sec.scrollIntoView({ behavior: 'smooth' });
    }
    function deleteSection(sec) {
        if (!confirm('Delete the whole "' + sectionTitle(sec) + '" section and its menu link? (You can press Undo.)')) return;
        const parent = sec.parentNode, next = sec.nextSibling;
        const link = $('a.nav-link[href="#' + sec.id + '"]', nav);
        sec.remove(); if (link) link.remove();
        pushUndo(() => { parent.insertBefore(sec, next); if (link) nav.appendChild(link); syncNav(); });
        changed();
    }
    function newSectionForm(after) {
        openForm({
            title: 'Add a section',
            fields: [
                { key: 'title', type: 'text', label: 'Section title', placeholder: 'e.g. Awards' },
                { key: 'layout', type: 'select', label: 'Card layout', options: LAYOUTS },
                { key: 'label', type: 'text', label: 'Menu label (blank = same as title)' }
            ],
            onSubmit: async v => { if (!v.title) throw new Error('Give the section a title.'); addSection(after, v.title, v.layout, v.label); }
        });
    }
    function navLabelForm(sec) {
        const link = $('a.nav-link[href="#' + sec.id + '"]', nav);
        if (!link) return;
        openForm({
            title: 'Menu label',
            fields: [{ key: 'l', type: 'text', label: 'Text shown in the top menu', value: link.textContent.trim() }],
            onSubmit: async v => { if (!v.l) throw new Error('Label cannot be empty.'); link.textContent = v.l; }
        });
    }
    function uploadDocs(sec) {
        const box = $('.docs-grid', sec);
        const inp = document.createElement('input'); inp.type = 'file'; inp.multiple = true;
        inp.addEventListener('change', async () => {
            for (const f of Array.from(inp.files)) {
                const card = KINDS.find(k => k.cls === 'doc-card').make();
                const r = await queueFile(f, 'docs');
                const title = f.name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ');
                $('h3', card).textContent = title;
                $('p', card).textContent = 'Add a description.';
                const live = toLiveDoc(card, r.url, extTag(f.name));
                box.appendChild(live);
                pushUndo(() => live.remove());
            }
            changed();
        });
        inp.click();
    }

    // ---------- profile picture ----------
    $('#dev-photo-btn').addEventListener('click', () => {
        if (!editing) { alert('Turn Edit on first so I know which folder to save the picture into.'); return; }
        $('#photo-upload-input').click();
    });
    $('#photo-upload-input').addEventListener('change', async e => {
        const f = e.target.files[0]; e.target.value = '';
        if (!f) return;
        const img = $('#profile-pic'), old = img.getAttribute('src');
        const r = await queueFile(f, 'images');
        img.src = r.url;
        pushUndo(() => { img.setAttribute('src', old); });
        changed();
    });

    // ---------- edit toggle / undo ----------
    async function setEditing(on) {
        if (on && !(await ensureFolder())) return;
        editing = on;
        document.body.classList.toggle('dev-editing', on);
        toggleBtn.textContent = on ? 'Edit: ON' : 'Edit: OFF';
        toggleBtn.classList.toggle('on', on);
        setEditable(document, on);
        if (!on) hideTbs();
        renderSectionRow(); updateStatus();
    }
    toggleBtn.addEventListener('click', () => setEditing(!editing));
    undoBtn.addEventListener('click', () => { const fn = undoStack.pop(); if (fn) { fn(); markDirty(); hideTbs(); renderSectionRow(); } updateStatus(); });
    statusEl.addEventListener('click', () => bar.classList.toggle('collapsed'));
    saveBtn.addEventListener('click', save);

    // ---------- SAVE: overwrite the existing index.html ----------
    function cleanClone(clone) {
        clone.querySelector('#bg-canvas-container').innerHTML = '';
        clone.querySelectorAll('[data-dev-injected], #dev-item-tb, #dev-pill-tb, #dev-modal').forEach(n => n.remove());
        clone.querySelectorAll('[contenteditable]').forEach(n => n.removeAttribute('contenteditable'));
        const body = clone.querySelector('body'); body.classList.remove('dev', 'dev-editing');
        clone.querySelector('#nav-menu').classList.remove('open');
        const mb = clone.querySelector('#menu-btn'); if (mb) mb.setAttribute('aria-expanded', 'false');
        clone.querySelectorAll('.nav-link').forEach((l, i) => l.classList.toggle('active', i === 0));
        clone.querySelector('#dev-status').textContent = 'Dev mode loading…';
        clone.querySelector('#dev-section-row').innerHTML = '';
        const tb = clone.querySelector('#dev-toggle-btn'); tb.textContent = 'Edit: OFF'; tb.classList.remove('on');
        clone.querySelector('#dev-save-btn').classList.remove('dirty');
        clone.querySelector('#dev-undo-btn').removeAttribute('disabled');
        clone.querySelector('#dev-bar').classList.remove('collapsed');
    }
    async function writeFile(path, data) {
        const parts = path.split('/'); let d = dirHandle;
        for (const p of parts.slice(0, -1)) d = await d.getDirectoryHandle(p, { create: true });
        const fh = await d.getFileHandle(parts[parts.length - 1], { create: true });
        const w = await fh.createWritable(); await w.write(data); await w.close();
    }
    async function save() {
        if (saving) return;
        if (!(await ensureFolder())) return;
        saving = true; statusEl.textContent = 'Saving…';
        try {
            const clone = document.documentElement.cloneNode(true);
            cleanClone(clone);
            let out = '<!DOCTYPE html>\n' + clone.outerHTML;

            // only queued files that are still referenced get written
            const written = [];
            for (const [path, e] of pending) {
                if (!e.urls.some(u => out.includes(u))) continue;
                await writeFile(path, e.file);
                e.urls.forEach(u => { out = out.split(u).join(path); });
                written.push([path, e]);
            }

            // index.html MUST already exist: we open it without create, so this can never make a new file
            let fh;
            try { fh = await dirHandle.getFileHandle('index.html'); }
            catch { throw new Error('index.html was not found in the connected folder, so nothing was changed.'); }
            const w = await fh.createWritable(); await w.write(out); await w.close();

            // point the live page at the real files and release the temporary blob URLs
            written.forEach(([path, e]) => {
                $$('[href^="blob:"], [src^="blob:"]').forEach(el => {
                    ['href', 'src'].forEach(a => { const v = el.getAttribute(a); if (v && e.urls.includes(v)) el.setAttribute(a, path); });
                });
                e.urls.forEach(u => URL.revokeObjectURL(u));
                pending.delete(path);
            });
            dirty = false;
            statusEl.textContent = 'Saved ' + new Date().toLocaleTimeString() + ' · ' + dirHandle.name + '/index.html' + (written.length ? ' + ' + written.length + ' file(s)' : '');
            setTimeout(updateStatus, 4000);
            saveBtn.classList.remove('dirty'); undoBtn.disabled = !undoStack.length;
        } catch (err) {
            console.error(err);
            alert('Save failed: ' + (err.message || err));
            updateStatus();
        } finally { saving = false; }
    }

    window.addEventListener('beforeunload', e => { if (dirty) { e.preventDefault(); e.returnValue = ''; } });
    updateStatus();
    statusEl.textContent = 'Dev mode · press Edit to connect your site folder';
})();
