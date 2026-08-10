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
    const QR_CORNER_RATIO = 0.18;

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

    async function scanManifestQrOnPage(pdf, pageNum) {
        if (typeof jsQR !== 'function' || !window.ManifestQR || typeof window.ManifestQR.parsePayload !== 'function') return null;

        const page = await pdf.getPage(pageNum);
        const viewport = page.getViewport({ scale: SCALE });
        const canvas = document.createElement('canvas');
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        await page.render({ canvasContext: ctx, viewport }).promise;

        const w = canvas.width;
        const h = canvas.height;
        const cw = Math.max(240, Math.floor(w * QR_CORNER_RATIO));
        const ch = Math.max(240, Math.floor(h * QR_CORNER_RATIO));
        const corners = [
            [w - cw, h - ch],
            [0, h - ch],
            [w - cw, 0],
            [0, 0]
        ];

        try {
            for (const [x, y] of corners) {
                const image = ctx.getImageData(Math.max(0, x), Math.max(0, y), Math.min(cw, w), Math.min(ch, h));
                const code = jsQR(image.data, image.width, image.height);
                if (!code || !code.data) continue;
                const parsed = window.ManifestQR.parsePayload(code.data);
                if (parsed) return { ...parsed, page: pageNum };
            }
            return null;
        } finally {
            canvas.width = 1;
            canvas.height = 1;
        }
    }

    async function findManifestQr(pdf, pages) {
        for (const pageNum of pages) {
            if (cancelled) return null;
            const hit = await scanManifestQrOnPage(pdf, pageNum);
            if (hit) return hit;
        }
        return null;
    }

    async function textLayer(pdf, pages) {
        const out = [];
        for (const pageNum of pages) {
            if (cancelled) break;
            try {
                const page = await pdf.getPage(pageNum);
                const text = await page.getTextContent();
                const combined = text.items
                    .map(item => `${item.str || ''}${item.hasEOL ? '\n' : ' '}`)
                    .join('');
                out.push({ page: pageNum, text: combined });
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

    function looksLikeLoadingList(text) {
        const source = String(text || '');
        if (!source.trim()) return false;
        const signals = [
            /loading\s*list/i,
            /amount\s*of\s*orders/i,
            /order\s*number/i,
            /reference\s*no/i,
            /logistics\s*service\s*provider/i,
            /transport\s*start/i
        ];
        return signals.reduce((count, pattern) => count + (pattern.test(source) ? 1 : 0), 0) >= 2;
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
            `${s.qrFiles} file${s.qrFiles === 1 ? '' : 's'} resolved from Manifest QR`,
            `${s.ocrPages} page${s.ocrPages === 1 ? '' : 's'} required OCR`,
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
        const issues = [];
        const failed = [];
        const jobs = [];
        let totalPages = 0;
        let donePages = 0;
        let qrFiles = 0;
        let ocrPages = 0;

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

                setProgress(donePages, totalPages, `Checking Manifest QR: ${job.file.name}`);
                const qr = await findManifestQr(job.pdf, job.pages);
                if (cancelled) throw new Error('__cancelled__');
                if (qr && qr.dns.length) {
                    confirmed.push(...qr.dns);
                    qrFiles++;
                    donePages += job.pages.length;
                    continue;
                }

                const forceOCR = !!(modeForceInput && modeForceInput.checked);
                const textByPage = new Map();
                if (!forceOCR) {
                    setProgress(donePages, totalPages, `Checking text layer: ${job.file.name}`);
                    const textPages = await textLayer(job.pdf, job.pages);
                    textPages.forEach(item => textByPage.set(item.page, item.text || ''));
                }

                let ocr = null;
                for (const pageNum of job.pages) {
                    if (cancelled) throw new Error('__cancelled__');

                    if (!forceOCR) {
                        const pageText = textByPage.get(pageNum) || '';
                        const parsedText = window.OCRDNExtractor.extractDNNumbersFromOCRText(pageText, pageNum);
                        const labelCount = (pageText.match(/\bDN\b/gi) || []).length;

                        if (parsedText.confirmed.length) {
                            confirmed.push(...parsedText.confirmed);
                        }

                        const textLooksComplete = parsedText.confirmed.length > 0 &&
                            parsedText.possible.length === 0 &&
                            labelCount <= parsedText.confirmed.length;

                        if (textLooksComplete) {
                            donePages++;
                            continue;
                        }

                        const hasMeaningfulText = pageText.trim().length >= 80;
                        if (hasMeaningfulText && !looksLikeLoadingList(pageText)) {
                            donePages++;
                            continue;
                        }
                    }

                    if (!ocr) ocr = await getWorker();
                    setProgress(donePages, totalPages, `${job.file.name} — page ${pageNum}`);
                    try {
                        const canvas = await renderPage(job.pdf, pageNum);
                        const result = await ocr.recognize(canvas);
                        const data = result && result.data ? result.data : {};
                        const parsed = window.OCRDNExtractor.extractDNNumbersFromOCRText(data.text || '', pageNum);
                        confirmed.push(...parsed.confirmed);
                        parsed.possible.forEach(item => issues.push({ ...item, file: job.file.name }));
                        canvas.width = 1;
                        canvas.height = 1;
                    } catch (_) {
                        failed.push({ file: job.file.name, page: pageNum });
                    }
                    donePages++;
                    ocrPages++;
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
                qrFiles,
                ocrPages,
                issues: issues.length,
                failed: failed.length
            });
            if (unique.length) {
                setStatus(qrFiles ? 'Done. Manifest QR verified; OCR was skipped where available.' : (failed.length ? 'Done, with page errors shown in the summary.' : 'Done.'), 'success');
            } else {
                setStatus('No DN numbers found.', 'error');
            }
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