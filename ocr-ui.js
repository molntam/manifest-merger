// ocr-ui.js
//
// UI orchestration for the "OCR DN Extraction" tab.
//
// This module is deliberately isolated from the existing Manifest Merger
// logic in script.js: it only reads/writes DOM inside `#tab-ocr` and does not
// touch any of the existing globals (`pdfFiles`, `data`, `qrEntries`, etc.).
//
// Processing workflow (see task spec):
//   1. Try the existing text-layer extraction first (pdf.js `getTextContent`
//      + the same DN pattern used by DNExtractor). This is fast and works on
//      normal, non-scanned PDFs.
//   2. If mode is "Force OCR", or if the text-layer produced no confirmed DN
//      numbers, render each selected page at ~300 DPI via pdf.js, preprocess
//      the canvas (grayscale + contrast + light thresholding), and run
//      Tesseract.js on it.
//   3. Match the strict DN pattern against the OCR text for each page. Track
//      confirmed matches and any "possible" DN-labelled fragments that don't
//      cleanly match the 8-digit rule (for the manual verification list).
//   4. De-duplicate confirmed matches while preserving first-occurrence order.
//   5. Populate the UI.
//
// Everything runs client-side — no document content leaves the browser.

(function () {
    'use strict';

    // ── DOM refs (all inside #tab-ocr) ────────────────────────────────────
    const fileInput            = document.getElementById('ocr-file-input');
    const fileNameLabel        = document.getElementById('ocr-file-name');
    const selectBtn            = document.getElementById('ocr-select-btn');
    const extractBtn           = document.getElementById('ocr-extract-btn');
    const cancelBtn            = document.getElementById('ocr-cancel-btn');
    const modeAutomaticInput   = document.getElementById('ocr-mode-automatic');
    const modeForceInput       = document.getElementById('ocr-mode-force');
    const pagesAllInput        = document.getElementById('ocr-pages-all');
    const pagesRangeInput      = document.getElementById('ocr-pages-range');
    const pageRangeText        = document.getElementById('ocr-page-range-text');
    const progressWrap         = document.getElementById('ocr-progress');
    const progressBar          = document.getElementById('ocr-progress-bar');
    const progressLabel        = document.getElementById('ocr-progress-label');
    const confirmedOutput      = document.getElementById('ocr-confirmed-output');
    const copyBtn              = document.getElementById('ocr-copy-btn');
    const issuesList           = document.getElementById('ocr-issues-list');
    const issuesWrap           = document.getElementById('ocr-issues-wrap');
    const summaryEl            = document.getElementById('ocr-summary-text');
    const statusEl             = document.getElementById('ocr-status');

    // If the OCR tab isn't rendered on this page (e.g. tests.html) just bail.
    if (!fileInput || !extractBtn) return;

    // ── State ─────────────────────────────────────────────────────────────
    let selectedFile   = null;
    let isProcessing   = false;
    let cancelRequested = false;
    let tesseractWorker = null;
    // Timer for transient "Copied" feedback on the copy button.
    let copyResetTimer = null;

    const DEFAULT_DPI = 300;
    // pdf.js scale = target DPI / 72. 300 DPI → scale ≈ 4.17.
    const DEFAULT_SCALE = DEFAULT_DPI / 72;

    // ── Small helpers ─────────────────────────────────────────────────────
    function log(...args) {
        try { console.log('[OCR]', ...args); } catch (_) {}
    }

    function setStatus(message, tone) {
        if (!statusEl) return;
        statusEl.textContent = message || '';
        statusEl.classList.remove('error', 'success', 'info');
        if (tone) statusEl.classList.add(tone);
    }

    function setControlsDisabled(disabled) {
        if (selectBtn) selectBtn.disabled = disabled;
        if (extractBtn) extractBtn.disabled = disabled || !selectedFile;
        if (fileInput) fileInput.disabled = disabled;
        if (modeAutomaticInput) modeAutomaticInput.disabled = disabled;
        if (modeForceInput) modeForceInput.disabled = disabled;
        if (pagesAllInput) pagesAllInput.disabled = disabled;
        if (pagesRangeInput) pagesRangeInput.disabled = disabled;
        if (pageRangeText) pageRangeText.disabled = disabled || !pagesRangeInput.checked;
    }

    function showProgress(show) {
        if (!progressWrap) return;
        progressWrap.classList.toggle('visible', !!show);
        if (cancelBtn) cancelBtn.classList.toggle('visible', !!show);
    }

    function updateProgress(current, total, label) {
        if (progressBar && total > 0) {
            const pct = Math.max(0, Math.min(100, Math.round((current / total) * 100)));
            progressBar.style.width = pct + '%';
        }
        if (progressLabel) {
            progressLabel.textContent = label || '';
        }
    }

    function clearResults() {
        if (confirmedOutput) confirmedOutput.value = '';
        if (copyBtn) {
            copyBtn.disabled = true;
            copyBtn.textContent = 'Copy DN Numbers';
            copyBtn.classList.remove('copied');
        }
        if (issuesList) issuesList.innerHTML = '';
        if (issuesWrap) issuesWrap.classList.remove('has-items');
        if (summaryEl) summaryEl.textContent = '';
    }

    function selectMode() {
        return (modeForceInput && modeForceInput.checked) ? 'force' : 'automatic';
    }

    function selectedPageRangeText() {
        if (pagesAllInput && pagesAllInput.checked) return '';
        return (pageRangeText && pageRangeText.value) || '';
    }

    // ── File selection ────────────────────────────────────────────────────
    function updateFileNameLabel() {
        if (!fileNameLabel) return;
        fileNameLabel.textContent = selectedFile ? selectedFile.name : 'No file selected';
        if (extractBtn) extractBtn.disabled = !selectedFile || isProcessing;
    }

    function onFileSelected(files) {
        if (!files || !files.length) return;
        const f = files[0];
        if (f.type && f.type !== 'application/pdf') {
            setStatus('Only PDF files are supported.', 'error');
            return;
        }
        selectedFile = f;
        clearResults();
        setStatus('');
        updateFileNameLabel();
        log('Selected file:', f.name, `(${f.size} bytes)`);
    }

    if (selectBtn) {
        selectBtn.addEventListener('click', () => {
            if (isProcessing) return;
            fileInput.click();
        });
    }
    if (fileInput) {
        fileInput.addEventListener('change', () => onFileSelected(fileInput.files));
    }

    // Reflect radio changes on the page-range text field's enabled state.
    if (pagesAllInput) {
        pagesAllInput.addEventListener('change', () => {
            if (pageRangeText) pageRangeText.disabled = pagesAllInput.checked || isProcessing;
        });
    }
    if (pagesRangeInput) {
        pagesRangeInput.addEventListener('change', () => {
            if (pageRangeText) {
                pageRangeText.disabled = !pagesRangeInput.checked || isProcessing;
                if (pagesRangeInput.checked) pageRangeText.focus();
            }
        });
    }

    // ── Image preprocessing ───────────────────────────────────────────────
    // Grayscale + contrast stretch + light Otsu-style thresholding.
    // Kept conservative so clean 300 DPI scans aren't harmed (per spec:
    // "Avoid excessive processing that makes clean scans worse").
    function preprocessCanvas(canvas) {
        const ctx = canvas.getContext('2d');
        const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const px = imgData.data;

        // First pass: grayscale + histogram.
        const hist = new Array(256).fill(0);
        for (let i = 0; i < px.length; i += 4) {
            const r = px[i], g = px[i + 1], b = px[i + 2];
            // Rec. 601 luma coefficients (standard grayscale conversion).
            const y = (0.299 * r + 0.587 * g + 0.114 * b) | 0;
            px[i] = px[i + 1] = px[i + 2] = y;
            hist[y]++;
        }

        // Simple percentile-based contrast stretch (2nd–98th percentile) to
        // handle scanners that produce washed-out or slightly dark scans.
        const total = canvas.width * canvas.height;
        const lowCut = total * 0.02;
        const highCut = total * 0.98;
        let running = 0;
        let low = 0, high = 255;
        for (let v = 0; v < 256; v++) {
            running += hist[v];
            if (running >= lowCut) { low = v; break; }
        }
        running = 0;
        for (let v = 0; v < 256; v++) {
            running += hist[v];
            if (running >= highCut) { high = v; break; }
        }
        if (high <= low) { low = 0; high = 255; }
        const range = high - low;

        for (let i = 0; i < px.length; i += 4) {
            let v = px[i];
            v = ((v - low) * 255 / range) | 0;
            if (v < 0) v = 0; else if (v > 255) v = 255;
            px[i] = px[i + 1] = px[i + 2] = v;
        }

        ctx.putImageData(imgData, 0, 0);
        return canvas;
    }

    // ── PDF rendering & text extraction ───────────────────────────────────
    async function loadPdfDocument(file) {
        const buf = await file.arrayBuffer();
        try {
            return await pdfjsLib.getDocument({ data: buf }).promise;
        } catch (err) {
            // pdf.js throws PasswordException for encrypted PDFs.
            if (err && err.name === 'PasswordException') {
                const e = new Error('This PDF is password-protected. Please unlock it before running OCR.');
                e.userMessage = true;
                throw e;
            }
            const e = new Error('Could not open PDF. The file may be corrupt or not a valid PDF.');
            e.userMessage = true;
            throw e;
        }
    }

    async function extractTextFromPages(pdf, pages) {
        const texts = [];
        for (const p of pages) {
            if (cancelRequested) return texts;
            try {
                const page = await pdf.getPage(p);
                const txt = await page.getTextContent();
                const flat = txt.items.map(it => (it && it.str) ? it.str : '').join(' ');
                texts.push({ page: p, text: flat });
            } catch (err) {
                log('Text extraction failed for page', p, err);
                texts.push({ page: p, text: '', error: err && err.message ? err.message : String(err) });
            }
        }
        return texts;
    }

    async function renderPageToCanvas(pdf, pageNum, scale) {
        const page = await pdf.getPage(pageNum);
        const viewport = page.getViewport({ scale });
        const canvas = document.createElement('canvas');
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        const ctx = canvas.getContext('2d');
        // White background so Tesseract's inversion detection stays stable.
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        await page.render({ canvasContext: ctx, viewport }).promise;
        return canvas;
    }

    // ── Tesseract worker lifecycle ────────────────────────────────────────
    async function getTesseractWorker() {
        if (typeof Tesseract === 'undefined') {
            const e = new Error(
                'OCR engine (Tesseract.js) is not available. Check your internet connection or contact IT to vendor the OCR library locally.'
            );
            e.userMessage = true;
            throw e;
        }
        if (tesseractWorker) return tesseractWorker;
        setStatus('Loading OCR engine…', 'info');
        try {
            // Tesseract.js v5 exposes `createWorker` which handles worker,
            // core, and language loading in one call.
            tesseractWorker = await Tesseract.createWorker('eng', 1, {
                logger: m => {
                    if (!m || !m.status) return;
                    // Only surface progress on the actual recognize step; the
                    // per-page label is set by the caller.
                    if (m.status === 'recognizing text' && typeof m.progress === 'number') {
                        // Nested progress within a page — reflect via label.
                        // (Coarse page-level progress is driven from processPdf.)
                    }
                }
            });
            // Restrict to printed-text mode; do NOT restrict to digits only
            // because we must still see the "DN" label to accept a number.
            await tesseractWorker.setParameters({
                tessedit_pageseg_mode: '6', // Assume a single uniform block of text
                preserve_interword_spaces: '1'
            });
            return tesseractWorker;
        } catch (err) {
            tesseractWorker = null;
            const e = new Error(
                'Failed to initialize the OCR engine: ' + (err && err.message ? err.message : String(err))
            );
            e.userMessage = true;
            throw e;
        }
    }

    async function terminateTesseractWorker() {
        if (!tesseractWorker) return;
        try {
            await tesseractWorker.terminate();
        } catch (err) {
            log('Worker termination failed:', err);
        }
        tesseractWorker = null;
    }

    // ── Main extraction workflow ──────────────────────────────────────────
    async function runExtraction() {
        if (isProcessing) return;
        clearResults();
        setStatus('');

        if (!selectedFile) {
            setStatus('Please select a scanned PDF first.', 'error');
            return;
        }

        const mode = selectMode();
        const rangeText = selectedPageRangeText();

        isProcessing = true;
        cancelRequested = false;
        setControlsDisabled(true);
        showProgress(true);
        updateProgress(0, 1, 'Opening PDF…');

        let confirmedAll = [];
        let possibleAll = [];
        let pagesProcessed = 0;
        let pagesOcrd = 0;
        let extractionMethod = 'PDF text layer';
        let usedFallbackOCR = false;
        const failedPages = [];

        try {
            const pdf = await loadPdfDocument(selectedFile);
            log('Opened PDF with', pdf.numPages, 'page(s).');

            // Resolve page selection against the actual PDF page count.
            let pagesToProcess;
            try {
                const parsed = window.OCRDNExtractor.parsePageRange(rangeText, pdf.numPages);
                pagesToProcess = parsed || Array.from({ length: pdf.numPages }, (_, i) => i + 1);
            } catch (err) {
                setStatus('Invalid page range: ' + (err.message || 'please check the format like 1-5.'), 'error');
                return;
            }
            if (!pagesToProcess.length) {
                setStatus('No pages selected.', 'error');
                return;
            }

            log('Mode:', mode, '| pages to process:', pagesToProcess.join(','));

            // ── Step 1: PDF text-layer pass ─────────────────────────────
            if (mode === 'automatic') {
                updateProgress(0, pagesToProcess.length, 'Reading PDF text layer…');
                const textPages = await extractTextFromPages(pdf, pagesToProcess);
                if (cancelRequested) throw cancelledError();

                for (const p of textPages) {
                    const res = window.OCRDNExtractor.extractDNNumbersFromOCRText(p.text, p.page);
                    confirmedAll.push(...res.confirmed);
                    // We only surface "possible" issues from the OCR pass —
                    // the text layer either has the number or it doesn't.
                }
                pagesProcessed = pagesToProcess.length;

                if (confirmedAll.length > 0) {
                    extractionMethod = 'PDF text layer';
                    log('Text-layer pass found', confirmedAll.length, 'confirmed DN(s); skipping OCR.');
                } else {
                    // No DNs in text layer → escalate to OCR.
                    usedFallbackOCR = true;
                    log('Text-layer pass found no DN numbers; falling back to OCR.');
                }
            }

            // ── Step 2: OCR pass (Force OCR or automatic fallback) ──────
            const shouldRunOCR = (mode === 'force') || usedFallbackOCR;
            if (shouldRunOCR) {
                extractionMethod = 'OCR';
                // Reset counters so we don't double-count the text pass.
                confirmedAll = [];
                possibleAll = [];
                pagesProcessed = 0;

                const worker = await getTesseractWorker();
                if (cancelRequested) throw cancelledError();

                for (let i = 0; i < pagesToProcess.length; i++) {
                    if (cancelRequested) throw cancelledError();
                    const pageNum = pagesToProcess[i];
                    updateProgress(
                        i,
                        pagesToProcess.length,
                        `Processing page ${pageNum} of ${pagesToProcess.length} selected (${i + 1}/${pagesToProcess.length})`
                    );

                    let canvas;
                    try {
                        canvas = await renderPageToCanvas(pdf, pageNum, DEFAULT_SCALE);
                        preprocessCanvas(canvas);
                    } catch (err) {
                        log('Render failed for page', pageNum, err);
                        failedPages.push({ page: pageNum, reason: 'render failed' });
                        continue;
                    }

                    if (cancelRequested) throw cancelledError();

                    let ocrText = '';
                    try {
                        const { data } = await worker.recognize(canvas);
                        ocrText = (data && data.text) || '';
                    } catch (err) {
                        log('OCR failed for page', pageNum, err);
                        failedPages.push({ page: pageNum, reason: 'OCR failed' });
                        continue;
                    }

                    const res = window.OCRDNExtractor.extractDNNumbersFromOCRText(ocrText, pageNum);
                    confirmedAll.push(...res.confirmed);
                    possibleAll.push(...res.possible);
                    pagesProcessed++;
                    pagesOcrd++;
                    log(
                        `Page ${pageNum}: +${res.confirmed.length} confirmed, ` +
                        `+${res.possible.length} possible.`
                    );
                }
                updateProgress(pagesToProcess.length, pagesToProcess.length, 'Finalizing…');
            }

            // ── Step 3: dedupe + render ─────────────────────────────────
            const beforeDedup = confirmedAll.length;
            const confirmedUnique = window.OCRDNExtractor.deduplicatePreservingOrder(confirmedAll);
            const duplicatesRemoved = beforeDedup - confirmedUnique.length;

            renderConfirmed(confirmedUnique);
            renderPossibleIssues(possibleAll);
            renderSummary({
                pagesProcessed,
                pagesOcrd,
                confirmedCount: confirmedUnique.length,
                duplicatesRemoved,
                possibleCount: possibleAll.length,
                failedPages,
                extractionMethod
            });

            if (confirmedUnique.length === 0 && possibleAll.length === 0) {
                setStatus('No DN numbers found.', 'error');
            } else if (failedPages.length) {
                setStatus(
                    `Done, but ${failedPages.length} page${failedPages.length === 1 ? '' : 's'} failed to process. See summary.`,
                    'info'
                );
            } else {
                setStatus('Done.', 'success');
            }

            log(
                'Extraction complete.',
                'method=', extractionMethod,
                'confirmed=', confirmedUnique.length,
                'duplicatesRemoved=', duplicatesRemoved,
                'possible=', possibleAll.length,
                'pagesProcessed=', pagesProcessed,
                'pagesOcrd=', pagesOcrd,
                'failedPages=', failedPages.map(p => p.page).join(',') || 'none'
            );
        } catch (err) {
            if (err && err.__ocrCancelled) {
                setStatus('OCR cancelled.', 'info');
                log('OCR cancelled by user.');
            } else if (err && err.userMessage) {
                setStatus(err.message, 'error');
                log('OCR error:', err.message);
            } else {
                setStatus('OCR processing failed: ' + (err && err.message ? err.message : 'unknown error'), 'error');
                console.error('[OCR] Unexpected error:', err);
            }
        } finally {
            isProcessing = false;
            cancelRequested = false;
            setControlsDisabled(false);
            showProgress(false);
        }
    }

    function cancelledError() {
        const e = new Error('cancelled');
        e.__ocrCancelled = true;
        return e;
    }

    // ── UI rendering ──────────────────────────────────────────────────────
    function renderConfirmed(numbers) {
        if (!confirmedOutput) return;
        const list = Array.isArray(numbers) ? numbers : [];
        confirmedOutput.value = list.join('\n');
        if (copyBtn) {
            copyBtn.disabled = list.length === 0;
            copyBtn.textContent = 'Copy DN Numbers';
            copyBtn.classList.remove('copied');
        }
    }

    function renderPossibleIssues(issues) {
        if (!issuesList || !issuesWrap) return;
        issuesList.innerHTML = '';
        if (!issues || !issues.length) {
            issuesWrap.classList.remove('has-items');
            return;
        }
        for (const item of issues) {
            const li = document.createElement('li');
            const pageTag = document.createElement('span');
            pageTag.className = 'issue-page';
            pageTag.textContent = 'Page ' + (item.page != null ? item.page : '?');
            const codeTag = document.createElement('code');
            codeTag.className = 'issue-text';
            codeTag.textContent = item.text;
            const note = document.createElement('span');
            note.className = 'issue-note';
            note.textContent = 'Manual verification required';
            li.appendChild(pageTag);
            li.appendChild(codeTag);
            li.appendChild(note);
            issuesList.appendChild(li);
        }
        issuesWrap.classList.add('has-items');
    }

    function renderSummary(s) {
        if (!summaryEl) return;
        const lines = [];
        lines.push(`${s.pagesProcessed} page${s.pagesProcessed === 1 ? '' : 's'} processed`);
        lines.push(`${s.confirmedCount} confirmed DN number${s.confirmedCount === 1 ? '' : 's'} found`);
        lines.push(`${s.duplicatesRemoved} duplicate${s.duplicatesRemoved === 1 ? '' : 's'} removed`);
        lines.push(`${s.possibleCount} possible OCR issue${s.possibleCount === 1 ? '' : 's'} found`);
        if (s.failedPages && s.failedPages.length) {
            const failedList = s.failedPages.map(p => `${p.page} (${p.reason})`).join(', ');
            lines.push(`${s.failedPages.length} page${s.failedPages.length === 1 ? '' : 's'} failed: ${failedList}`);
        }
        lines.push(`Extraction method: ${s.extractionMethod}`);

        summaryEl.innerHTML = '';
        const ul = document.createElement('ul');
        for (const line of lines) {
            const li = document.createElement('li');
            li.textContent = line;
            ul.appendChild(li);
        }
        summaryEl.appendChild(ul);
    }

    // ── Copy button ───────────────────────────────────────────────────────
    async function copyConfirmedToClipboard() {
        if (!confirmedOutput || !copyBtn || copyBtn.disabled) return;
        const text = confirmedOutput.value;
        if (!text) return;

        const flash = () => {
            copyBtn.textContent = 'Copied';
            copyBtn.classList.add('copied');
            if (copyResetTimer) clearTimeout(copyResetTimer);
            copyResetTimer = setTimeout(() => {
                copyBtn.textContent = 'Copy DN Numbers';
                copyBtn.classList.remove('copied');
            }, 1800);
        };

        try {
            if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
                await navigator.clipboard.writeText(text);
                flash();
                return;
            }
        } catch (err) {
            log('clipboard.writeText failed, falling back:', err);
        }
        // Fallback for older browsers / non-secure contexts.
        try {
            const prevStart = confirmedOutput.selectionStart;
            const prevEnd = confirmedOutput.selectionEnd;
            confirmedOutput.focus();
            confirmedOutput.select();
            const ok = document.execCommand && document.execCommand('copy');
            confirmedOutput.setSelectionRange(prevStart, prevEnd);
            if (ok) { flash(); } else { setStatus('Copy failed. Please copy manually.', 'error'); }
        } catch (err) {
            console.error('[OCR] Fallback clipboard copy failed:', err);
            setStatus('Copy failed. Please copy manually.', 'error');
        }
    }

    // ── Wiring ────────────────────────────────────────────────────────────
    if (extractBtn) {
        extractBtn.addEventListener('click', () => {
            runExtraction();
        });
    }
    if (cancelBtn) {
        cancelBtn.addEventListener('click', () => {
            if (!isProcessing) return;
            cancelRequested = true;
            setStatus('Cancelling…', 'info');
        });
    }
    if (copyBtn) {
        copyBtn.addEventListener('click', copyConfirmedToClipboard);
    }

    // Clean up the Tesseract worker when the tab / window is closed to free
    // its WebAssembly memory. Not strictly required but keeps things tidy.
    window.addEventListener('beforeunload', () => {
        terminateTesseractWorker();
    });

    // Initial UI state.
    updateFileNameLabel();
    setControlsDisabled(false);
    if (pageRangeText) {
        pageRangeText.disabled = !(pagesRangeInput && pagesRangeInput.checked);
    }
})();
