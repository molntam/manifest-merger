(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.OCRDNExtractor = factory();
    }
}(typeof self !== 'undefined' ? self : this, function () {
    const DN_STRICT_PATTERN = /\bDN(?:[^\S\r\n]|[:.\-])*((?:[0-9][^\S\r\n]*){7}[0-9])(?![^\S\r\n]*[0-9])/gi;
    const DN_LOOSE_PATTERN = /\bDN[\s:.\-]*([0-9IlOoSBZGQD]{4,12})\b/gi;
    const STANDALONE_EIGHT_DIGIT_PATTERN = /\b([0-9]{8})\b/g;
    const OCR_CONFUSABLES = Object.freeze({
        I: '1', l: '1', O: '0', o: '0', S: '5', B: '8', Z: '2', G: '6', Q: '0', D: '0'
    });

    function safeToString(value) {
        if (value === null || value === undefined) return '';
        try { return String(value); } catch (_) { return ''; }
    }

    function compactHorizontalWhitespace(value) {
        return safeToString(value).replace(/[^\S\r\n]/g, '');
    }

    function parsePageRange(input, totalPages) {
        const text = safeToString(input).trim();
        if (!text) return null;

        const pages = new Set();
        for (const rawPart of text.split(',')) {
            const part = rawPart.trim();
            if (!part) continue;
            if (part.indexOf('-') !== -1) {
                const [rawStart, rawEnd, ...extra] = part.split('-');
                if (extra.length > 0) throw new Error(`Invalid page range: "${part}"`);
                const start = Number(rawStart.trim());
                const end = Number(rawEnd.trim());
                if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < 1) {
                    throw new Error(`Invalid page range: "${part}"`);
                }
                if (start > end) throw new Error(`Invalid page range (start > end): "${part}"`);
                for (let n = start; n <= end; n++) pages.add(n);
            } else {
                const n = Number(part);
                if (!Number.isInteger(n) || n < 1) throw new Error(`Invalid page number: "${part}"`);
                pages.add(n);
            }
        }

        const sorted = Array.from(pages).sort((a, b) => a - b);
        if (typeof totalPages === 'number' && Number.isFinite(totalPages)) {
            for (const p of sorted) {
                if (p > totalPages) {
                    throw new Error(`Page ${p} is out of range (document has ${totalPages} page${totalPages === 1 ? '' : 's'}).`);
                }
            }
        }
        return sorted;
    }

    function deduplicatePreservingOrder(values) {
        const out = [];
        const seen = new Set();
        if (values === null || values === undefined) return out;
        if (typeof values[Symbol.iterator] !== 'function') return out;
        for (const value of values) {
            if (seen.has(value)) continue;
            seen.add(value);
            out.push(value);
        }
        return out;
    }

    function normalizeDNToken(token) {
        const raw = safeToString(token).trim();
        const compact = raw.replace(/[\s.\-]/g, '');
        if (compact.length !== 8) {
            return { raw, compact, value: null, valid: false, corrected: false };
        }

        let value = '';
        let corrected = false;
        for (const ch of compact) {
            if (/[0-9]/.test(ch)) {
                value += ch;
                continue;
            }
            if (Object.prototype.hasOwnProperty.call(OCR_CONFUSABLES, ch)) {
                value += OCR_CONFUSABLES[ch];
                corrected = true;
                continue;
            }
            return { raw, compact, value: null, valid: false, corrected: false };
        }
        return { raw, compact, value, valid: /^[0-9]{8}$/.test(value), corrected };
    }

    function extractDNNumbersFromOCRText(text, pageNumber) {
        const result = { confirmed: [], possible: [] };
        const source = safeToString(text);
        if (!source) return result;

        const confirmedSpans = [];
        DN_STRICT_PATTERN.lastIndex = 0;
        let match;
        while ((match = DN_STRICT_PATTERN.exec(source)) !== null) {
            const number = compactHorizontalWhitespace(match[1]);
            if (/^[0-9]{8}$/.test(number)) result.confirmed.push(number);
            confirmedSpans.push([match.index, match.index + match[0].length]);
        }

        const isInsideConfirmed = (start, end) =>
            confirmedSpans.some(([cs, ce]) => start >= cs && end <= ce);

        DN_LOOSE_PATTERN.lastIndex = 0;
        while ((match = DN_LOOSE_PATTERN.exec(source)) !== null) {
            const start = match.index;
            const end = start + match[0].length;
            if (isInsideConfirmed(start, end)) continue;
            if (/^[0-9]{8}$/.test(match[1])) continue;
            result.possible.push({
                page: typeof pageNumber === 'number' ? pageNumber : null,
                text: match[0].trim()
            });
        }
        return result;
    }

    function extractDNCandidatesFromOCRText(text, pageNumber, sourceName) {
        const source = safeToString(text);
        const evidence = [];
        const possible = [];
        const labelledRanges = [];
        const sourceTag = safeToString(sourceName) || 'unknown';
        let labelSignals = 0;
        let globalOffset = 0;

        const lines = source.split(/\r?\n/);
        for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
            const line = lines[lineIndex];
            const labelRegex = /\bDN\b/gi;
            let labelMatch;
            while ((labelMatch = labelRegex.exec(line)) !== null) {
                labelSignals++;
                const tail = line.slice(labelMatch.index + labelMatch[0].length, labelMatch.index + labelMatch[0].length + 28);
                const tokenMatch = tail.match(/^[\s:.\-]*([0-9IlOoSBZGQD](?:[\s.\-]?[0-9IlOoSBZGQD]){3,11})/);
                if (!tokenMatch) {
                    possible.push({
                        page: pageNumber == null ? null : pageNumber,
                        source: sourceTag,
                        text: line.trim() || 'DN',
                        candidate: null,
                        reason: 'DN label found but the value could not be read'
                    });
                    continue;
                }

                const rawToken = tokenMatch[1];
                const normalized = normalizeDNToken(rawToken);
                const localStart = labelMatch.index;
                const localEnd = labelMatch.index + labelMatch[0].length + tokenMatch[0].length;
                labelledRanges.push([globalOffset + localStart, globalOffset + localEnd]);

                if (normalized.valid) {
                    evidence.push({
                        value: normalized.value,
                        page: pageNumber == null ? null : pageNumber,
                        source: sourceTag,
                        labelled: true,
                        corrected: normalized.corrected,
                        raw: `DN ${rawToken}`.trim(),
                        line: lineIndex + 1,
                        position: globalOffset + localStart
                    });
                    if (normalized.corrected) {
                        possible.push({
                            page: pageNumber == null ? null : pageNumber,
                            source: sourceTag,
                            text: `DN ${rawToken}`.trim(),
                            candidate: normalized.value,
                            reason: 'DN contains OCR-confusable characters; consensus verification required'
                        });
                    }
                } else {
                    possible.push({
                        page: pageNumber == null ? null : pageNumber,
                        source: sourceTag,
                        text: `DN ${rawToken}`.trim(),
                        candidate: null,
                        reason: 'DN value is not exactly eight readable digits'
                    });
                }
            }
            globalOffset += line.length + 1;
        }

        const isInsideLabelled = (start, end) =>
            labelledRanges.some(([ls, le]) => start >= ls && end <= le);

        STANDALONE_EIGHT_DIGIT_PATTERN.lastIndex = 0;
        let match;
        while ((match = STANDALONE_EIGHT_DIGIT_PATTERN.exec(source)) !== null) {
            const start = match.index;
            const end = start + match[0].length;
            if (isInsideLabelled(start, end)) continue;
            evidence.push({
                value: match[1],
                page: pageNumber == null ? null : pageNumber,
                source: sourceTag,
                labelled: false,
                corrected: false,
                raw: match[0],
                line: null,
                position: start
            });
        }

        const confusablePattern = /\b([0-9IlOoSBZGQD]{8})\b/g;
        while ((match = confusablePattern.exec(source)) !== null) {
            const token = match[1];
            if (/^[0-9]{8}$/.test(token)) continue;
            const digitCount = (token.match(/[0-9]/g) || []).length;
            if (digitCount < 6) continue;
            const start = match.index;
            const end = start + match[0].length;
            if (isInsideLabelled(start, end)) continue;
            const normalized = normalizeDNToken(token);
            if (!normalized.valid) continue;
            evidence.push({
                value: normalized.value,
                page: pageNumber == null ? null : pageNumber,
                source: sourceTag,
                labelled: false,
                corrected: true,
                raw: token,
                line: null,
                position: start
            });
        }

        return { evidence, possible, labelSignals };
    }

    function evaluateDNEvidence(evidence) {
        const groupsByValue = new Map();
        for (const item of Array.isArray(evidence) ? evidence : []) {
            if (!item || !/^[0-9]{8}$/.test(item.value || '')) continue;
            if (!groupsByValue.has(item.value)) groupsByValue.set(item.value, []);
            groupsByValue.get(item.value).push(item);
        }

        const verified = [];
        const unresolved = [];
        const groups = [];

        for (const [value, items] of groupsByValue) {
            const sourceSet = new Set(items.map(item => item.source || 'unknown'));
            const labelledItems = items.filter(item => item.labelled);
            const strictLabelledItems = labelledItems.filter(item => !item.corrected);
            const strictItems = items.filter(item => !item.corrected);
            const sourceCounts = new Map();
            for (const item of items) {
                const source = item.source || 'unknown';
                sourceCounts.set(source, (sourceCounts.get(source) || 0) + 1);
            }
            const maxOccurrencesInSource = Math.max(0, ...sourceCounts.values());
            const independentSources = sourceSet.size;
            const strictSources = new Set(strictItems.map(item => item.source || 'unknown')).size;
            const strictLabelledSources = new Set(strictLabelledItems.map(item => item.source || 'unknown')).size;
            const hasLabelled = labelledItems.length > 0;
            const repeatedStructure = maxOccurrencesInSource >= 2;
            const firstPosition = Math.min(...items.map(item => Number.isFinite(item.position) ? item.position : Number.MAX_SAFE_INTEGER));

            const isVerified = hasLabelled && (
                strictLabelledSources >= 2 ||
                (independentSources >= 2 && strictSources >= 1) ||
                (repeatedStructure && independentSources >= 2 && strictSources >= 2)
            );

            const group = {
                value,
                items,
                verified: isVerified,
                independentSources,
                strictSources,
                hasLabelled,
                repeatedStructure,
                firstPosition
            };
            groups.push(group);

            if (isVerified) {
                verified.push(value);
            } else if (hasLabelled || repeatedStructure || independentSources >= 2) {
                unresolved.push({
                    value,
                    page: items[0].page == null ? null : items[0].page,
                    candidate: value,
                    reason: hasLabelled
                        ? 'DN candidate did not receive enough independent OCR agreement'
                        : 'Repeated eight-digit candidate needs manual verification',
                    evidenceCount: items.length,
                    sourceCount: independentSources,
                    firstPosition
                });
            }
        }

        groups.sort((a, b) => a.firstPosition - b.firstPosition);
        const verifiedSet = new Set(verified);
        return {
            verified: groups.filter(group => verifiedSet.has(group.value)).map(group => group.value),
            unresolved: unresolved.sort((a, b) => a.firstPosition - b.firstPosition),
            groups
        };
    }

    return {
        DN_STRICT_PATTERN,
        DN_LOOSE_PATTERN,
        STANDALONE_EIGHT_DIGIT_PATTERN,
        parsePageRange,
        deduplicatePreservingOrder,
        normalizeDNToken,
        extractDNNumbersFromOCRText,
        extractDNCandidatesFromOCRText,
        evaluateDNEvidence
    };
}));
