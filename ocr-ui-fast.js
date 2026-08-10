(function () {
    'use strict';

    const $ = id => document.getElementById(id);
    const fileInput = $('ocr-file-input');
    const fileNameLabel = $('ocr-file-name');
    const fileListEl = $('ocr-file-list');
    const dropArea = $('ocr-drop-area');
    const selectBtn = $('ocr-select-btn');
    const extractBtn = $('ocr-extract-btn');
    const cancelBtn = $('ocr-cancel-btn');
    const modeForceInput = $('ocr-mode-force');
    const pagesAllInput = $('ocr-pages-all');
    const pagesRangeInput = $('ocr-pages-range');
    const pageRangeText = $('ocr-page-range-text');
    const progressWrap = $('ocr-progress');
    const progressBar = $('ocr-progress-bar');
    const progressLabel = $('ocr-progress-label');
    const confirmedOutput = $('ocr-confirmed-output');
    const copyBtn = $('ocr-copy-btn');
    const issuesList = $('ocr-issues-list');
    const issuesWrap = $('ocr-issues-wrap');
    const summaryEl = $('ocr-summary-text');
    const statusEl = $('ocr-status');

    if (!fileInput || !extractBtn || !window.OCRDNExtractor) return;

    let selectedFiles = [];
    let processing = false;
    let cancelled = false;
    let worker = null;
    let copyTimer = null;
    const SCALE = 300 / 72;

    function setStatus(text, tone) {
        if (!statusEl) return;
        statusEl.textContent = text || '';
        statusEl.classList.remove('error', 'success', 'info');
        if (tone) statusEl.classList.add(tone);
    }

    function setDisabled(disabled) {
        processing = disabled;
        if (selectBtn) selectBtn.disabled = disabled;
        if (fileInput) fileInput.disabled = disabled;
        if (modeForceInput) modeForceInput.disabled = disabled;
        if (pagesAllInput) pagesAllInput.disabled = disabled;
        if (pagesRangeInput) pagesRangeInput.disabled = disabled;
        if (pageRangeText) pageRangeText.disabled = disabled || !(pagesRangeInput && pagesRangeInput.checked);
        if (extractBtn) extractBtn.disabled = disabled || !selectedFiles.length;
        if (dropArea) dropArea.classList.toggle('disabled', disabled);
        if (fileListEl) fileListEl.querySelectorAll('button').forEach(btn => { btn.disabled = disabled; });
    }

    function setProgress(current, total, text) {
        if (progressBar) progressBar.style.width = `${total ? Math.round(current / total * 100) : 0}%`;
        if (progressLabel) progressLabel.textContent = text || '';
    }

    function showProgress(show) {
        if (progressWrap) progressWrap.classList.toggle('visible', show);
        if (cancelBtn) cancelBtn.classList.toggle('visible', show);
    }

    function clearResults() {
        if (confirmedOutput) confirmedOutput.value = '';
        if (copyBtn) copyBtn.disabled = true;
        if (issuesList) issuesList.innerHTML = '';
        if (issuesWrap) issuesWrap.classList.remove('has-items');
        if (summaryEl) summaryEl.textContent = '';
    }

    function fileKey(file) {
        return `${file.name}|${file.size}|${file.lastModified}`;
    }

    function isPdf(file) {
        return file && (file.type === 'application/pdf' || /\.pdf$/i.test(file.name || ''));
    }

    function renderFiles() {
        if (fileNameLabel) fileNameLabel.textContent = selectedFiles.length
            ? `${selectedFiles.length} PDF file${selectedFiles.length === 1 ? '' : 's'} selected`
            : 'No files selected';
        if (fileListEl) {
            fileListEl.innerHTML = '';
            selectedFiles.forEach((file, index) => {
                const row = document.createElement('div');
                row.className = 'ocr-selected-file';
                const name = document.createElement('span');
                name.className = 'ocr-selected-file-name';
                name.textContent = file.name;
                const remove = document.createElement('button');
                remove.type = 'button';
                remove.className = 'ocr-remove-file';
                remove.textContent = 'Remove';
                remove.disabled = processing;
                remove.onclick = () => {
                    if (processing) return;
                    selectedFiles.splice(index, 1);
                    clearResults();
                    renderFiles();
                };
                row.append(name, remove);
                fileListEl.appendChild(row);
            });
        }
        if (extractBtn) extractBtn.disabled = processing || !selectedFiles.length;
    }

    function addFiles(files) {
        if (processing || !files) return;
        const existing = new Set(selectedFiles.map(fileKey));
        let ignored = 0;
        for (const file of Array.from(files)) {
            if (!isPdf(file)) { ignored++; continue; }
            const key = fileKey(file);
            if (existing.has(key)) continue;
            existing.add(key);
            selectedFiles.push(file);
        }
        clearResults();
        renderFiles();
        setStatus(ignored ? `${ignored} non-PDF file${ignored === 1 ? '' : 's'} ignored.` : '', ignored ? 'info' : null);
    }

    if (selectBtn) selectBtn.onclick = event => {
        event.stopPropagation();
        if (!processing) fileInput.click();
    };
    fileInput.onchange = () => {
        addFiles(fileInput.files);
        fileInput.value = '';
    };

    if (dropArea) {
        const stop = event => { event.preventDefault(); event.stopPropagation(); };
        ['dragenter', 'dragover'].forEach(type => dropArea.addEventListener(type, event => {
            stop(event);
            if (!processing) dropArea.classList.add('dragover');
        }));
        ['dragleave', 'drop'].forEach(type => dropArea.addEventListener(type, event => {
            stop(event);
            dropArea.classList.remove('dragover');
        }));
        dropArea.addEventListener('drop', event => { if (!processing) addFiles(event.dataTransfer.files); });
        dropArea.addEventListener('click', event => {
            if (!processing && event.target !== selectBtn && !(selectBtn && selectBtn.contains(event.target))) fileInput.click();
        });
    }

    if (pagesAllInput) pagesAllInput.onchange = () => {
        if (pageRangeText) pageRangeText.disabled = pagesAllInput.checked || processing;
    };
    if (pagesRangeInput) pagesRangeInput.onchange = () => {
        if (!pageRangeText) return;
        pageRangeText.disabled = !pagesRangeInput.checked || processing;
        if (!pageRangeText.disabled) pageRangeText.focus();
    };

    function preprocess(canvas) {
        const ctx = canvas.getContext('2d');
        const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const px = image.data;
        const hist = new Uint32Array(256);
        for (let i = 0; i < px.length; i += 4) {
            const y = (0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2]) | 0;
            px[i] = px[i + 1] = px[i + 2] = y;
            hist[y]++;
        }
        const total = canvas.width * canvas.height;
        let sum = 0, low = 0, high = 255;
        for (let i = 0; i < 256; i++) { sum += hist[i]; if (sum >= total * 0.02) { low = i; break; } }
        sum = 0;
        for (let i = 0; i < 256; i++) { sum += hist[i]; if (sum >= total * 0.98) { high = i; break; } }
        if (high <= low) { low = 0; high = 255; }
        for (let i = 0; i < px.length; i += 4) {
            const v = Math.max(0, Math.min(255, ((px[i] - low) * 255 / (high - low)) | 0));
            px[i] = px[i + 1] = px[i + 2] = v;
        }
        ctx.putImageData(image, 0, 0);
    }

    async function loadPdf(file) {
        try {
            return await pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
        } catch (err) {
            const e = new Error(err && err.name === 'PasswordException'
                ? `${file.name} is password-protected.`
                : `Could not open ${file.name}.`);
            e.userMessage = true;
            throw e;
        }
    }

    async function renderPage(pdf, pageNum) {
        const page = await pdf.getPage(pageNum);
        const viewport = page.getViewport({ scale: SCALE });
        const canvas = document.createElement('canvas');
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        await page.render({ canvasContext: ctx, viewport }).promise;
        preprocess(canvas);
        return canvas;
    }

    async function textLayer(pdf, pages) {
        const out = [];
        for (const pageNum of pages) {
            if (cancelled) break;
            try {
                const page = await pdf.getPage(pageNum);
                const text = await page.getTextContent();
                out.push({ page: pageNum, text: text.items.map(item => item.str || '').join(' ') });
            } catch (_) { out.push({ page: pageNum, text: '' }); }
        }
        return out;
    }

    async function getWorker() {
        if (worker) return worker;
        if (typeof Tesseract === 'undefined') {
            const e = new Error('OCR engine is not available.');
            e.userMessage = true;
            throw e;
        }
        setStatus('Loading OCR engine…', 'info');
        worker = await Tesseract.createWorker('eng', 1);
        await worker.setParameters({ tessedit_pageseg_mode: '6', preserve_interword_spaces: '1' });
        return worker;
    }

    function repeatedCandidates(text, confirmed) {
        const counts = new Map();
        const confirmedSet = new Set(confirmed);
        const re = /\b([0-9]{8})\b/g;
        let m;
        while ((m = re.exec(text || ''))) counts.set(m[1], (counts.get(m[1]) || 0) + 1);
        return Array.from(counts.entries())
            .filter(([value, count]) => count >= 2 && !confirmedSet.has(value))
            .map(([value]) => value);
    }

    function geometricCandidates(data, canvas, confirmed) {
        const words = data && Array.isArray(data.words) ? data.words : [];
        const confirmedSet = new Set(confirmed);
        const groups = new Map();
        for (const word of words) {
            const value = String(word && word.text || '').trim();
            if (!/^[0-9]{8}$/.test(value) || confirmedSet.has(value) || !word.bbox) continue;
            if (!groups.has(value)) groups.set(value, []);
            groups.get(value).push(word.bbox);
        }
        const recovered = [];
        for (const [value, boxes] of groups) {
            if (boxes.length < 2) continue;
            let ok = false;
            for (let i = 0; i < boxes.length && !ok; i++) {
                for (let j = i + 1; j < boxes.length; j++) {
                    const a = boxes[i], b = boxes[j];
                    const ax = (a.x0 + a.x1) / 2, bx = (b.x0 + b.x1) / 2;
                    const ay = (a.y0 + a.y1) / 2, by = (b.y0 + b.y1) / 2;
                    if (ax > canvas.width * 0.42 && bx > canvas.width * 0.42 &&
                        Math.abs(ax - bx) < canvas.width * 0.16 &&
                        Math.abs(ay - by) < canvas.height * 0.14) ok = true;
                }
            }
            if (ok) recovered.push(value);
        }
        return recovered;
    }

    function renderIssues(issues) {
        if (!issuesList || !issuesWrap) return;
        issuesList.innerHTML = '';
        if (!issues.length) { issuesWrap.classList.remove('has-items'); return; }
        for (const item of issues) {
            const li = document.createElement('li');
            li.textContent = `${item.file} — page ${item.page}: ${item.text}`;
            issuesList.appendChild(li);
        }
        issuesWrap.classList.add('has-items');
    }

    function renderSummary(s) {
        if (!summaryEl) return;
        summaryEl.innerHTML = '';
        const ul = document.createElement('ul');
        [
            `${s.files} PDF file${s.files === 1 ? '' : 's'} processed`,
            `${s.pages} page${s.pages === 1 ? '' : 's'} processed`,
            `${s.dns} DN number${s.dns === 1 ? '' : 's'} found`,
            `${s.recovered} DN number${s.recovered === 1 ? '' : 's'} recovered by the lightweight safety check`,
            `${s.issues} possible OCR issue${s.issues === 1 ? '' : 's'}`,
            `${s.failed} failed page${s.failed === 1 ? '' : 's'}`
        ].forEach(text => {
            const li = document.createElement('li');
            li.textContent = text;
            ul.appendChild(li);
        });
        summaryEl.appendChild(ul);
    }

    async function run() {
        if (processing || !selectedFiles.length) return;
        clearResults();
        cancelled = false;
        setDisabled(true);
        showProgress(true);
        setStatus('');

        const confirmed = [];
        const recovered = [];
        const issues = [];
        const failed = [];
        const jobs = [];
        let totalPages = 0;
        let donePages = 0;

        try {
            for (const file of selectedFiles) {
                const pdf = await loadPdf(file);
                const rangeText = pagesAllInput && pagesAllInput.checked ? '' : (pageRangeText ? pageRangeText.value : '');
                const parsed = window.OCRDNExtractor.parsePageRange(rangeText, pdf.numPages);
                const pages = parsed || Array.from({ length: pdf.numPages }, (_, i) => i + 1);
                jobs.push({ file, pdf, pages });
                totalPages += pages.length;
            }

            for (const job of jobs) {
                if (cancelled) throw new Error('__cancelled__');
                let useTextLayer = false;
                if (!(modeForceInput && modeForceInput.checked)) {
                    setProgress(donePages, totalPages, `Checking text layer: ${job.file.name}`);
                    const pages = await textLayer(job.pdf, job.pages);
                    const found = [];
                    pages.forEach(item => found.push(...window.OCRDNExtractor.extractDNNumbersFromOCRText(item.text, item.page).confirmed));
                    if (found.length) {
                        confirmed.push(...found);
                        donePages += job.pages.length;
                        useTextLayer = true;
                    }
                }
                if (useTextLayer) continue;

                const ocr = await getWorker();
                for (const pageNum of job.pages) {
                    if (cancelled) throw new Error('__cancelled__');
                    setProgress(donePages, totalPages, `${job.file.name} — page ${pageNum}`);
                    try {
                        const canvas = await renderPage(job.pdf, pageNum);
                        const result = await ocr.recognize(canvas);
                        const data = result && result.data ? result.data : {};
                        const parsed = window.OCRDNExtractor.extractDNNumbersFromOCRText(data.text || '', pageNum);
                        const rescue = window.OCRDNExtractor.deduplicatePreservingOrder([
                            ...repeatedCandidates(data.text || '', parsed.confirmed),
                            ...geometricCandidates(data, canvas, parsed.confirmed)
                        ]);
                        confirmed.push(...parsed.confirmed, ...rescue);
                        rescue.forEach(value => recovered.push(value));
                        parsed.possible.forEach(item => issues.push({ ...item, file: job.file.name }));
                        canvas.width = 1;
                        canvas.height = 1;
                    } catch (err) {
                        failed.push({ file: job.file.name, page: pageNum });
                    }
                    donePages++;
                }
            }

            const unique = window.OCRDNExtractor.deduplicatePreservingOrder(confirmed);
            if (confirmedOutput) confirmedOutput.value = unique.join('\n');
            if (copyBtn) copyBtn.disabled = !unique.length;
            renderIssues(issues);
            renderSummary({
                files: selectedFiles.length,
                pages: donePages,
                dns: unique.length,
                recovered: window.OCRDNExtractor.deduplicatePreservingOrder(recovered).length,
                issues: issues.length,
                failed: failed.length
            });
            setStatus(unique.length ? (failed.length ? 'Done, with page errors shown in the summary.' : 'Done.') : 'No DN numbers found.', unique.length ? 'success' : 'error');
        } catch (err) {
            setStatus(err && err.message === '__cancelled__' ? 'OCR cancelled.' : (err.userMessage ? err.message : `OCR failed: ${err.message || 'unknown error'}`), err && err.message === '__cancelled__' ? 'info' : 'error');
        } finally {
            setDisabled(false);
            showProgress(false);
            renderFiles();
        }
    }

    extractBtn.onclick = run;
    if (cancelBtn) cancelBtn.onclick = () => { if (processing) { cancelled = true; setStatus('Cancelling…', 'info'); } };
    if (copyBtn) copyBtn.onclick = async () => {
        if (!confirmedOutput || !confirmedOutput.value) return;
        try {
            await navigator.clipboard.writeText(confirmedOutput.value);
            copyBtn.textContent = 'Copied';
            if (copyTimer) clearTimeout(copyTimer);
            copyTimer = setTimeout(() => { copyBtn.textContent = 'Copy DN Numbers'; }, 1500);
        } catch (_) { setStatus('Copy failed. Please copy manually.', 'error'); }
    };
    window.addEventListener('beforeunload', () => { if (worker) worker.terminate(); });

    renderFiles();
    setDisabled(false);
}());
