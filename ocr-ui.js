(function () {
    'use strict';

    const fileInput = document.getElementById('ocr-file-input');
    const fileNameLabel = document.getElementById('ocr-file-name');
    const fileListEl = document.getElementById('ocr-file-list');
    const dropArea = document.getElementById('ocr-drop-area');
    const selectBtn = document.getElementById('ocr-select-btn');
    const extractBtn = document.getElementById('ocr-extract-btn');
    const cancelBtn = document.getElementById('ocr-cancel-btn');
    const modeForceInput = document.getElementById('ocr-mode-force');
    const pagesAllInput = document.getElementById('ocr-pages-all');
    const pagesRangeInput = document.getElementById('ocr-pages-range');
    const pageRangeText = document.getElementById('ocr-page-range-text');
    const progressWrap = document.getElementById('ocr-progress');
    const progressBar = document.getElementById('ocr-progress-bar');
    const progressLabel = document.getElementById('ocr-progress-label');
    const confirmedOutput = document.getElementById('ocr-confirmed-output');
    const copyBtn = document.getElementById('ocr-copy-btn');
    const issuesList = document.getElementById('ocr-issues-list');
    const issuesWrap = document.getElementById('ocr-issues-wrap');
    const summaryEl = document.getElementById('ocr-summary-text');
    const statusEl = document.getElementById('ocr-status');

    if (!fileInput || !extractBtn || !window.OCRDNExtractor) return;

    let selectedFiles = [];
    let isProcessing = false;
    let cancelRequested = false;
    let tesseractWorker = null;
    let copyResetTimer = null;
    let verifiedNumbers = [];
    let reviewItems = [];
    let nextReviewId = 1;

    const DEFAULT_DPI = 300;
    const DEFAULT_SCALE = DEFAULT_DPI / 72;
    const OCR_PASS_COUNT = 4;

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
        if (extractBtn) extractBtn.disabled = disabled || selectedFiles.length === 0;
        if (fileInput) fileInput.disabled = disabled;
        if (modeForceInput) modeForceInput.disabled = disabled;
        if (pagesAllInput) pagesAllInput.disabled = disabled;
        if (pagesRangeInput) pagesRangeInput.disabled = disabled;
        if (pageRangeText) pageRangeText.disabled = disabled || !(pagesRangeInput && pagesRangeInput.checked);
        if (dropArea) dropArea.classList.toggle('disabled', disabled);
        if (fileListEl) fileListEl.querySelectorAll('button').forEach(btn => { btn.disabled = disabled; });
        updateCopyState();
    }

    function showProgress(show) {
        if (!progressWrap) return;
        progressWrap.classList.toggle('visible', !!show);
        if (cancelBtn) cancelBtn.classList.toggle('visible', !!show);
    }

    function updateProgress(current, total, label) {
        if (progressBar) {
            const pct = total > 0 ? Math.max(0, Math.min(100, Math.round((current / total) * 100))) : 0;
            progressBar.style.width = pct + '%';
        }
        if (progressLabel) progressLabel.textContent = label || '';
    }

    function clearResults() {
        verifiedNumbers = [];
        reviewItems = [];
        nextReviewId = 1;
        if (confirmedOutput) confirmedOutput.value = '';
        if (issuesList) issuesList.innerHTML = '';
        if (issuesWrap) issuesWrap.classList.remove('has-items');
        if (summaryEl) summaryEl.textContent = '';
        updateCopyState();
    }

    function selectMode() {
        return modeForceInput && modeForceInput.checked ? 'force' : 'automatic';
    }

    function selectedPageRangeText() {
        if (pagesAllInput && pagesAllInput.checked) return '';
        return pageRangeText ? pageRangeText.value : '';
    }

    function isPdf(file) {
        if (!file) return false;
        if (file.type === 'application/pdf') return true;
        return /\.pdf$/i.test(file.name || '');
    }

    function fileKey(file) {
        return [file.name, file.size, file.lastModified].join('|');
    }

    function addFiles(files) {
        if (isProcessing || !files) return;
        const incoming = Array.from(files);
        const invalid = incoming.filter(file => !isPdf(file));
        const valid = incoming.filter(isPdf);
        const existing = new Set(selectedFiles.map(fileKey));
        for (const file of valid) {
            const key = fileKey(file);
            if (existing.has(key)) continue;
            selectedFiles.push(file);
            existing.add(key);
        }
        if (invalid.length) {
            setStatus(`${invalid.length} non-PDF file${invalid.length === 1 ? '' : 's'} ignored.`, 'info');
        } else {
            setStatus('');
        }
        clearResults();
        renderSelectedFiles();
    }

    function renderSelectedFiles() {
        if (fileNameLabel) {
            fileNameLabel.textContent = selectedFiles.length
                ? `${selectedFiles.length} PDF file${selectedFiles.length === 1 ? '' : 's'} selected`
                : 'No files selected';
        }
        if (fileListEl) {
            fileListEl.innerHTML = '';
            selectedFiles.forEach((file, index) => {
                const row = document.createElement('div');
                row.className = 'ocr-selected-file';
                const name = document.createElement('span');
                name.className = 'ocr-selected-file-name';
                name.textContent = file.name;
                name.title = file.name;
                const remove = document.createElement('button');
                remove.type = 'button';
                remove.className = 'ocr-remove-file';
                remove.textContent = 'Remove';
                remove.disabled = isProcessing;
                remove.addEventListener('click', () => {
                    if (isProcessing) return;
                    selectedFiles.splice(index, 1);
                    clearResults();
                    renderSelectedFiles();
                });
                row.appendChild(name);
                row.appendChild(remove);
                fileListEl.appendChild(row);
            });
        }
        if (extractBtn) extractBtn.disabled = isProcessing || selectedFiles.length === 0;
    }

    if (selectBtn) {
        selectBtn.addEventListener('click', event => {
            event.stopPropagation();
            if (!isProcessing) fileInput.click();
        });
    }

    fileInput.addEventListener('change', () => {
        addFiles(fileInput.files);
        fileInput.value = '';
    });

    if (dropArea) {
        const prevent = event => {
            event.preventDefault();
            event.stopPropagation();
        };
        ['dragenter', 'dragover'].forEach(type => {
            dropArea.addEventListener(type, event => {
                prevent(event);
                if (!isProcessing) dropArea.classList.add('dragover');
            });
        });
        ['dragleave', 'drop'].forEach(type => {
            dropArea.addEventListener(type, event => {
                prevent(event);
                dropArea.classList.remove('dragover');
            });
        });
        dropArea.addEventListener('drop', event => {
            if (isProcessing) return;
            addFiles(event.dataTransfer && event.dataTransfer.files);
        });
        dropArea.addEventListener('click', event => {
            if (isProcessing || event.target === selectBtn || (selectBtn && selectBtn.contains(event.target))) return;
            fileInput.click();
        });
        dropArea.addEventListener('keydown', event => {
            if (isProcessing) return;
            if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                fileInput.click();
            }
        });
    }

    if (pagesAllInput) {
        pagesAllInput.addEventListener('change', () => {
            if (pageRangeText) pageRangeText.disabled = pagesAllInput.checked || isProcessing;
        });
    }
    if (pagesRangeInput) {
        pagesRangeInput.addEventListener('change', () => {
            if (!pageRangeText) return;
            pageRangeText.disabled = !pagesRangeInput.checked || isProcessing;
            if (pagesRangeInput.checked) pageRangeText.focus();
        });
    }

    function createCanvas(width, height) {
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(width));
        canvas.height = Math.max(1, Math.round(height));
        return canvas;
    }

    function cloneCanvas(source) {
        const canvas = createCanvas(source.width, source.height);
        canvas.getContext('2d').drawImage(source, 0, 0);
        return canvas;
    }

    function grayscaleContrastCanvas(source) {
        const canvas = cloneCanvas(source);
        const ctx = canvas.getContext('2d');
        const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const px = img.data;
        const hist = new Uint32Array(256);

        for (let i = 0; i < px.length; i += 4) {
            const y = Math.round(0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2]);
            px[i] = px[i + 1] = px[i + 2] = y;
            hist[y]++;
        }

        const total = canvas.width * canvas.height;
        const lowTarget = total * 0.02;
        const highTarget = total * 0.98;
        let sum = 0;
        let low = 0;
        let high = 255;
        for (let i = 0; i < 256; i++) {
            sum += hist[i];
            if (sum >= lowTarget) { low = i; break; }
        }
        sum = 0;
        for (let i = 0; i < 256; i++) {
            sum += hist[i];
            if (sum >= highTarget) { high = i; break; }
        }
        if (high <= low + 5) { low = 0; high = 255; }
        const range = high - low;

        for (let i = 0; i < px.length; i += 4) {
            let value = Math.round((px[i] - low) * 255 / range);
            value = Math.max(0, Math.min(255, value));
            px[i] = px[i + 1] = px[i + 2] = value;
        }
        ctx.putImageData(img, 0, 0);
        return canvas;
    }

    function otsuThreshold(hist, total) {
        let sum = 0;
        for (let i = 0; i < 256; i++) sum += i * hist[i];
        let sumBackground = 0;
        let weightBackground = 0;
        let bestVariance = -1;
        let threshold = 160;

        for (let i = 0; i < 256; i++) {
            weightBackground += hist[i];
            if (!weightBackground) continue;
            const weightForeground = total - weightBackground;
            if (!weightForeground) break;
            sumBackground += i * hist[i];
            const meanBackground = sumBackground / weightBackground;
            const meanForeground = (sum - sumBackground) / weightForeground;
            const variance = weightBackground * weightForeground * Math.pow(meanBackground - meanForeground, 2);
            if (variance > bestVariance) {
                bestVariance = variance;
                threshold = i;
            }
        }
        return threshold;
    }

    function thresholdCanvas(source) {
        const canvas = cloneCanvas(source);
        const ctx = canvas.getContext('2d');
        const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const px = img.data;
        const hist = new Uint32Array(256);
        for (let i = 0; i < px.length; i += 4) hist[px[i]]++;
        const threshold = otsuThreshold(hist, canvas.width * canvas.height);
        for (let i = 0; i < px.length; i += 4) {
            const value = px[i] < threshold ? 0 : 255;
            px[i] = px[i + 1] = px[i + 2] = value;
        }
        ctx.putImageData(img, 0, 0);
        return canvas;
    }

    function cropCanvas(source, x, y, width, height, scale) {
        const multiplier = scale || 1;
        const canvas = createCanvas(width * multiplier, height * multiplier);
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.imageSmoothingEnabled = true;
        ctx.drawImage(source, x, y, width, height, 0, 0, canvas.width, canvas.height);
        return canvas;
    }

    function releaseCanvas(canvas) {
        if (!canvas) return;
        canvas.width = 1;
        canvas.height = 1;
    }

    function detectTableRows(binaryCanvas) {
        const ctx = binaryCanvas.getContext('2d');
        const w = binaryCanvas.width;
        const h = binaryCanvas.height;
        const xStart = Math.floor(w * 0.04);
        const xEnd = Math.floor(w * 0.96);
        const image = ctx.getImageData(0, 0, w, h).data;
        const lineYs = [];
        const xStep = Math.max(2, Math.floor(w / 900));

        for (let y = 0; y < h; y += 2) {
            let dark = 0;
            let sampled = 0;
            for (let x = xStart; x < xEnd; x += xStep) {
                sampled++;
                if (image[(y * w + x) * 4] < 80) dark++;
            }
            if (sampled && dark / sampled > 0.5) lineYs.push(y);
        }

        const grouped = [];
        for (const y of lineYs) {
            const last = grouped[grouped.length - 1];
            if (!last || y - last[last.length - 1] > 4) grouped.push([y]);
            else last.push(y);
        }
        const centers = grouped.map(group => Math.round(group.reduce((a, b) => a + b, 0) / group.length));
        const rows = [];
        for (let i = 0; i < centers.length - 1; i++) {
            const top = centers[i] + 2;
            const bottom = centers[i + 1] - 2;
            const height = bottom - top;
            if (height >= 24 && height <= Math.max(260, h * 0.09)) rows.push({ top, height });
        }
        return rows.slice(0, 80);
    }

    function rowHasUsefulInk(binaryCanvas, row) {
        const ctx = binaryCanvas.getContext('2d');
        const w = binaryCanvas.width;
        const x = Math.floor(w * 0.28);
        const width = w - x;
        const y = Math.max(0, row.top);
        const height = Math.min(row.height, binaryCanvas.height - y);
        if (width <= 0 || height <= 0) return false;
        const data = ctx.getImageData(x, y, width, height).data;
        const step = Math.max(1, Math.floor((width * height) / 60000));
        let dark = 0;
        let sampled = 0;
        for (let i = 0; i < data.length; i += 4 * step) {
            sampled++;
            if (data[i] < 80) dark++;
        }
        const ratio = sampled ? dark / sampled : 0;
        return ratio > 0.006 && ratio < 0.35;
    }

    async function loadPdfDocument(file) {
        const buf = await file.arrayBuffer();
        try {
            return await pdfjsLib.getDocument({ data: buf }).promise;
        } catch (err) {
            const e = new Error(
                err && err.name === 'PasswordException'
                    ? `${file.name} is password-protected. Unlock it before OCR.`
                    : `Could not open ${file.name}. The PDF may be corrupt.`
            );
            e.userMessage = true;
            throw e;
        }
    }

    async function renderPageToCanvas(pdf, pageNum) {
        const page = await pdf.getPage(pageNum);
        const viewport = page.getViewport({ scale: DEFAULT_SCALE });
        const canvas = createCanvas(viewport.width, viewport.height);
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        await page.render({ canvasContext: ctx, viewport }).promise;
        return canvas;
    }

    async function extractTextLayer(pdf, pageNum) {
        try {
            const page = await pdf.getPage(pageNum);
            const text = await page.getTextContent();
            return text.items.map(item => item && item.str ? item.str : '').join(' ');
        } catch (err) {
            log('Text layer failed', pageNum, err);
            return '';
        }
    }

    async function getTesseractWorker() {
        if (typeof Tesseract === 'undefined') {
            const e = new Error('OCR engine is unavailable. Check the network connection or vendor Tesseract.js locally.');
            e.userMessage = true;
            throw e;
        }
        if (tesseractWorker) return tesseractWorker;
        setStatus('Loading OCR engine…', 'info');
        try {
            tesseractWorker = await Tesseract.createWorker('eng', 1, { logger: () => {} });
            return tesseractWorker;
        } catch (err) {
            tesseractWorker = null;
            const e = new Error('Failed to initialize OCR engine: ' + (err && err.message ? err.message : String(err)));
            e.userMessage = true;
            throw e;
        }
    }

    async function recognize(worker, canvas, psm) {
        if (cancelRequested) throw cancelledError();
        await worker.setParameters({ tessedit_pageseg_mode: String(psm), preserve_interword_spaces: '1' });
        const result = await worker.recognize(canvas);
        return result && result.data && result.data.text ? result.data.text : '';
    }

    function addEvidenceFromText(accumulator, text, pageNum, sourceName) {
        if (!text) return;
        const parsed = window.OCRDNExtractor.extractDNCandidatesFromOCRText(text, pageNum, sourceName);
        accumulator.evidence.push(...parsed.evidence);
        accumulator.labelSignals.push(parsed.labelSignals);
        accumulator.successfulSources.push(sourceName);
    }

    async function runRowRecovery(worker, binaryCanvas, pageNum, fileName, progressText) {
        const rows = detectTableRows(binaryCanvas);
        const usefulRows = rows.filter(row => rowHasUsefulInk(binaryCanvas, row)).slice(0, 60);
        if (!usefulRows.length) return { text: '', rowCount: rows.length, usefulRowCount: 0 };

        const chunks = [];
        await worker.setParameters({ tessedit_pageseg_mode: '7', preserve_interword_spaces: '1' });
        for (let i = 0; i < usefulRows.length; i++) {
            if (cancelRequested) throw cancelledError();
            if (progressLabel) progressLabel.textContent = `${progressText} — row safety pass ${i + 1}/${usefulRows.length}`;
            const row = usefulRows[i];
            const x = Math.floor(binaryCanvas.width * 0.28);
            const width = binaryCanvas.width - x;
            const scale = row.height < 75 ? 1.5 : 1;
            const crop = cropCanvas(binaryCanvas, x, row.top, width, row.height, scale);
            try {
                const result = await worker.recognize(crop);
                const text = result && result.data && result.data.text ? result.data.text.trim() : '';
                if (text) chunks.push(text);
            } catch (err) {
                log('Row OCR failed', fileName, pageNum, i + 1, err);
            } finally {
                releaseCanvas(crop);
            }
        }
        return { text: chunks.join('\n'), rowCount: rows.length, usefulRowCount: usefulRows.length };
    }

    function makeReviewItem(fileName, page, candidate, reason, text) {
        return {
            id: nextReviewId++,
            file: fileName,
            page,
            candidate: candidate && /^[0-9]{8}$/.test(candidate) ? candidate : null,
            reason: reason || 'Manual verification required',
            text: text || ''
        };
    }

    function dedupeReviewItems(items) {
        const out = [];
        const seen = new Set();
        for (const item of items) {
            const key = [item.file, item.page, item.candidate || '', item.reason].join('|');
            if (seen.has(key)) continue;
            seen.add(key);
            out.push(item);
        }
        return out;
    }

    async function processPage(job, pageNum, worker, progressText) {
        const acc = { evidence: [], labelSignals: [], successfulSources: [] };
        const localIssues = [];
        let rowCount = 0;
        let usefulRowCount = 0;

        if (selectMode() === 'automatic') {
            const textLayer = await extractTextLayer(job.pdf, pageNum);
            addEvidenceFromText(acc, textLayer, pageNum, 'pdf-text');
        }

        let rendered = null;
        let contrast = null;
        let binary = null;
        let rightContrast = null;
        let rightBinary = null;
        let successfulOcrPasses = 0;

        try {
            rendered = await renderPageToCanvas(job.pdf, pageNum);
            contrast = grayscaleContrastCanvas(rendered);
            binary = thresholdCanvas(contrast);
            const rightX = Math.floor(contrast.width * 0.28);
            const rightWidth = contrast.width - rightX;
            rightContrast = cropCanvas(contrast, rightX, 0, rightWidth, contrast.height, 1);
            rightBinary = cropCanvas(binary, rightX, 0, rightWidth, binary.height, 1);

            const passes = [
                { canvas: contrast, psm: 6, source: 'full-contrast' },
                { canvas: binary, psm: 11, source: 'full-threshold' },
                { canvas: rightContrast, psm: 6, source: 'right-contrast' },
                { canvas: rightBinary, psm: 11, source: 'right-threshold' }
            ];

            for (let i = 0; i < passes.length; i++) {
                if (cancelRequested) throw cancelledError();
                if (progressLabel) progressLabel.textContent = `${progressText} — OCR safety pass ${i + 1}/${passes.length}`;
                try {
                    const text = await recognize(worker, passes[i].canvas, passes[i].psm);
                    addEvidenceFromText(acc, text, pageNum, passes[i].source);
                    successfulOcrPasses++;
                } catch (err) {
                    if (err && err.__ocrCancelled) throw err;
                    log('OCR pass failed', job.file.name, pageNum, passes[i].source, err);
                }
            }

            const rowResult = await runRowRecovery(worker, binary, pageNum, job.file.name, progressText);
            rowCount = rowResult.rowCount;
            usefulRowCount = rowResult.usefulRowCount;
            if (rowResult.text) addEvidenceFromText(acc, rowResult.text, pageNum, 'row-recovery');
        } finally {
            [rendered, contrast, binary, rightContrast, rightBinary].forEach(releaseCanvas);
        }

        const evaluation = window.OCRDNExtractor.evaluateDNEvidence(acc.evidence);
        const verifiedSet = new Set(evaluation.verified);
        const expectedLabels = acc.labelSignals.length ? Math.max(...acc.labelSignals) : 0;

        for (const unresolved of evaluation.unresolved) {
            if (verifiedSet.has(unresolved.value)) continue;
            localIssues.push(makeReviewItem(job.file.name, pageNum, unresolved.candidate, unresolved.reason, unresolved.candidate || ''));
        }

        if (successfulOcrPasses < 3) {
            localIssues.push(makeReviewItem(job.file.name, pageNum, null, `Only ${successfulOcrPasses}/${OCR_PASS_COUNT} main OCR safety passes succeeded`, ''));
        }

        if (expectedLabels > evaluation.verified.length) {
            localIssues.push(makeReviewItem(
                job.file.name,
                pageNum,
                null,
                `OCR detected ${expectedLabels} DN label${expectedLabels === 1 ? '' : 's'} but only ${evaluation.verified.length} DN value${evaluation.verified.length === 1 ? '' : 's'} reached verification consensus`,
                ''
            ));
        }

        const candidateGroups = evaluation.groups.filter(group => group.hasLabelled || group.independentSources >= 2 || group.repeatedStructure);
        if (rowCount >= 6 && usefulRowCount >= 4 && candidateGroups.length === 0) {
            localIssues.push(makeReviewItem(job.file.name, pageNum, null, 'Table-like rows were detected but no DN candidate could be verified. Review this page manually.', ''));
        }

        return {
            verified: evaluation.verified,
            issues: dedupeReviewItems(localIssues),
            evidenceCount: acc.evidence.length,
            expectedLabels,
            rowCount,
            successfulOcrPasses
        };
    }

    async function prepareJobs(rangeText) {
        const jobs = [];
        let totalPages = 0;
        for (const file of selectedFiles) {
            if (cancelRequested) throw cancelledError();
            const pdf = await loadPdfDocument(file);
            let pages;
            try {
                const parsed = window.OCRDNExtractor.parsePageRange(rangeText, pdf.numPages);
                pages = parsed || Array.from({ length: pdf.numPages }, (_, i) => i + 1);
            } catch (err) {
                const e = new Error(`${file.name}: ${err.message}`);
                e.userMessage = true;
                throw e;
            }
            jobs.push({ file, pdf, pages });
            totalPages += pages.length;
        }
        return { jobs, totalPages };
    }

    async function runExtraction() {
        if (isProcessing) return;
        clearResults();
        setStatus('');

        if (!selectedFiles.length) {
            setStatus('Select at least one scanned PDF first.', 'error');
            return;
        }

        isProcessing = true;
        cancelRequested = false;
        setControlsDisabled(true);
        showProgress(true);
        updateProgress(0, 1, 'Opening PDF files…');

        const summary = { files: selectedFiles.length, pages: 0, verified: 0, review: 0, evidence: 0, rowPages: 0 };

        try {
            const rangeText = selectedPageRangeText();
            const { jobs, totalPages } = await prepareJobs(rangeText);
            const worker = await getTesseractWorker();
            let completedPages = 0;
            const allVerified = [];
            const allIssues = [];

            for (const job of jobs) {
                for (const pageNum of job.pages) {
                    if (cancelRequested) throw cancelledError();
                    const progressText = `${job.file.name} — page ${pageNum} (${completedPages + 1}/${totalPages})`;
                    updateProgress(completedPages, totalPages, progressText);
                    const result = await processPage(job, pageNum, worker, progressText);
                    allVerified.push(...result.verified);
                    allIssues.push(...result.issues);
                    summary.evidence += result.evidenceCount;
                    if (result.rowCount > 0) summary.rowPages++;
                    completedPages++;
                    updateProgress(completedPages, totalPages, progressText);
                }
            }

            verifiedNumbers = window.OCRDNExtractor.deduplicatePreservingOrder(allVerified);
            reviewItems = dedupeReviewItems(allIssues).filter(item => !item.candidate || !verifiedNumbers.includes(item.candidate));
            summary.pages = totalPages;
            summary.verified = verifiedNumbers.length;
            summary.review = reviewItems.length;

            renderResults();
            renderSummary(summary);

            if (reviewItems.length) {
                setStatus(`${reviewItems.length} item${reviewItems.length === 1 ? '' : 's'} require manual verification before copying is enabled.`, 'error');
            } else if (verifiedNumbers.length) {
                setStatus('Done. Every extracted DN reached verification consensus.', 'success');
            } else {
                setStatus('No verified DN numbers found.', 'error');
            }
        } catch (err) {
            if (err && err.__ocrCancelled) {
                setStatus('OCR cancelled.', 'info');
            } else if (err && err.userMessage) {
                setStatus(err.message, 'error');
            } else {
                setStatus('OCR processing failed: ' + (err && err.message ? err.message : 'unknown error'), 'error');
                console.error('[OCR]', err);
            }
        } finally {
            isProcessing = false;
            cancelRequested = false;
            setControlsDisabled(false);
            showProgress(false);
            renderSelectedFiles();
            renderResults();
        }
    }

    function cancelledError() {
        const e = new Error('cancelled');
        e.__ocrCancelled = true;
        return e;
    }

    function renderResults() {
        if (confirmedOutput) confirmedOutput.value = verifiedNumbers.join('\n');
        renderReviewItems();
        updateCopyState();
    }

    function updateCopyState() {
        if (!copyBtn) return;
        const canCopy = !isProcessing && verifiedNumbers.length > 0 && reviewItems.length === 0;
        copyBtn.disabled = !canCopy;
        if (!copyBtn.classList.contains('copied')) copyBtn.textContent = 'Copy DN Numbers';
    }

    function renderReviewItems() {
        if (!issuesList || !issuesWrap) return;
        issuesList.innerHTML = '';
        if (!reviewItems.length) {
            issuesWrap.classList.remove('has-items');
            return;
        }

        for (const item of reviewItems) {
            const li = document.createElement('li');
            li.className = 'ocr-review-item';

            const meta = document.createElement('span');
            meta.className = 'issue-page';
            meta.textContent = `${item.file} — page ${item.page != null ? item.page : '?'}`;

            const note = document.createElement('span');
            note.className = 'issue-note';
            note.textContent = item.reason;

            const controls = document.createElement('div');
            controls.className = 'ocr-review-controls';

            const input = document.createElement('input');
            input.type = 'text';
            input.inputMode = 'numeric';
            input.maxLength = 8;
            input.className = 'ocr-review-input';
            input.placeholder = '8-digit DN';
            input.value = item.candidate || '';

            const add = document.createElement('button');
            add.type = 'button';
            add.className = 'ocr-btn ocr-btn-primary ocr-review-btn';
            add.textContent = item.candidate ? 'Confirm DN' : 'Add DN';
            add.addEventListener('click', () => {
                const value = input.value.trim();
                if (!/^[0-9]{8}$/.test(value)) {
                    setStatus('Manual DN must contain exactly 8 digits.', 'error');
                    input.focus();
                    return;
                }
                if (!verifiedNumbers.includes(value)) verifiedNumbers.push(value);
                reviewItems = reviewItems.filter(review => review.id !== item.id);
                setStatus(reviewItems.length ? `${reviewItems.length} review item${reviewItems.length === 1 ? '' : 's'} remaining.` : 'All review items resolved.', reviewItems.length ? 'info' : 'success');
                renderResults();
            });

            const dismiss = document.createElement('button');
            dismiss.type = 'button';
            dismiss.className = 'ocr-btn ocr-btn-secondary ocr-review-btn';
            dismiss.textContent = 'Not a DN';
            dismiss.addEventListener('click', () => {
                reviewItems = reviewItems.filter(review => review.id !== item.id);
                setStatus(reviewItems.length ? `${reviewItems.length} review item${reviewItems.length === 1 ? '' : 's'} remaining.` : 'All review items resolved.', reviewItems.length ? 'info' : 'success');
                renderResults();
            });

            controls.appendChild(input);
            controls.appendChild(add);
            controls.appendChild(dismiss);
            li.appendChild(meta);
            li.appendChild(note);
            li.appendChild(controls);
            issuesList.appendChild(li);
        }
        issuesWrap.classList.add('has-items');
    }

    function renderSummary(summary) {
        if (!summaryEl) return;
        const lines = [
            `${summary.files} PDF file${summary.files === 1 ? '' : 's'} processed`,
            `${summary.pages} page${summary.pages === 1 ? '' : 's'} processed`,
            `${summary.verified} DN number${summary.verified === 1 ? '' : 's'} verified by consensus`,
            `${summary.review} item${summary.review === 1 ? '' : 's'} sent to manual verification`,
            `${summary.evidence} OCR/text evidence hit${summary.evidence === 1 ? '' : 's'} cross-checked`,
            `${summary.rowPages} page${summary.rowPages === 1 ? '' : 's'} received row-by-row recovery OCR`,
            `Mode: ${selectMode() === 'force' ? 'Force OCR' : 'Automatic safety mode'}`
        ];
        summaryEl.innerHTML = '';
        const ul = document.createElement('ul');
        lines.forEach(line => {
            const li = document.createElement('li');
            li.textContent = line;
            ul.appendChild(li);
        });
        summaryEl.appendChild(ul);
    }

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
                updateCopyState();
            }, 1800);
        };

        try {
            if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
                await navigator.clipboard.writeText(text);
                flash();
                return;
            }
        } catch (err) {
            log('Clipboard API failed', err);
        }

        try {
            confirmedOutput.focus();
            confirmedOutput.select();
            const ok = document.execCommand && document.execCommand('copy');
            if (ok) flash();
            else setStatus('Copy failed. Please copy manually.', 'error');
        } catch (err) {
            setStatus('Copy failed. Please copy manually.', 'error');
        }
    }

    async function terminateTesseractWorker() {
        if (!tesseractWorker) return;
        try { await tesseractWorker.terminate(); } catch (_) {}
        tesseractWorker = null;
    }

    extractBtn.addEventListener('click', runExtraction);
    if (cancelBtn) {
        cancelBtn.addEventListener('click', () => {
            if (!isProcessing) return;
            cancelRequested = true;
            setStatus('Cancelling after the current OCR operation…', 'info');
        });
    }
    if (copyBtn) copyBtn.addEventListener('click', copyConfirmedToClipboard);
    window.addEventListener('beforeunload', terminateTesseractWorker);

    renderSelectedFiles();
    setControlsDisabled(false);
    if (pageRangeText) pageRangeText.disabled = !(pagesRangeInput && pagesRangeInput.checked);
}());