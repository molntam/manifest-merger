// ocr-dn-extractor.js
//
// Pure, UI-independent helpers for the OCR DN Extraction tab.
//
// This module contains only regex matching, page-range parsing, and
// order-preserving de-duplication. It intentionally does NOT touch the DOM,
// pdf.js, or the OCR engine so it can be unit-tested in isolation from Node
// (see tests/ocr-dn-extractor.test.js) and reused by the UI orchestration
// script (`ocr-ui.js`).
//
// The strict DN pattern is deliberately more permissive on the separator than
// the merger's `DNExtractor.DN_PATTERN` (whitespace, colon, dot or dash), so
// that OCR outputs like "DN: 12345678", "DN.12345678" or "DN - 12345678" are
// still accepted while a stray digit next to a DN label is not.

(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.OCRDNExtractor = factory();
    }
}(typeof self !== 'undefined' ? self : this, function () {

    // Strict: DN followed by optional separator (space, colon, dot, dash) and
    // exactly 8 digits, with word boundaries so we do not accept a longer
    // number that happens to start with 8 matching digits.
    const DN_STRICT_PATTERN = /\bDN[\s:.\-]*([0-9]{8})\b/gi;

    // Loose: DN followed by any run of characters that "look like" a DN value
    // (digits and common OCR confusables such as I / l / O / o / S / B / Z /
    // G / Q / D). We use this to detect *possible* OCR misreads for the
    // "Possible OCR Issues" panel. Length is bounded to avoid catching
    // arbitrary large numbers on the same line.
    const DN_LOOSE_PATTERN = /\bDN[\s:.\-]*([0-9IlOoSBZGQD]{4,12})\b/gi;

    function safeToString(value) {
        if (value === null || value === undefined) return '';
        try {
            return String(value);
        } catch (e) {
            return '';
        }
    }

    /**
     * Parse a page-range string such as "1-5", "2,4,7-9", or "" (empty).
     *
     * - Empty / whitespace-only input means "all pages" and returns null so
     *   the caller can decide what "all" means for a specific document.
     * - Ranges are inclusive.
     * - Duplicates are removed and the result is sorted ascending.
     * - Pages outside [1, totalPages] (when totalPages is given) trigger an
     *   error, matching the "Invalid page range" acceptance criteria.
     *
     * @param {string} input
     * @param {number} [totalPages] optional upper bound for validation
     * @returns {number[]|null} sorted unique page numbers, or null for "all"
     * @throws {Error} on invalid syntax or out-of-bounds pages
     */
    function parsePageRange(input, totalPages) {
        const text = safeToString(input).trim();
        if (!text) return null;

        const pages = new Set();
        const parts = text.split(',');
        for (const rawPart of parts) {
            const part = rawPart.trim();
            if (!part) continue;

            if (part.indexOf('-') !== -1) {
                const [rawStart, rawEnd, ...extra] = part.split('-');
                if (extra.length > 0) {
                    throw new Error(`Invalid page range: "${part}"`);
                }
                const start = Number(rawStart.trim());
                const end = Number(rawEnd.trim());
                if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < 1) {
                    throw new Error(`Invalid page range: "${part}"`);
                }
                if (start > end) {
                    throw new Error(`Invalid page range (start > end): "${part}"`);
                }
                for (let n = start; n <= end; n++) pages.add(n);
            } else {
                const n = Number(part);
                if (!Number.isInteger(n) || n < 1) {
                    throw new Error(`Invalid page number: "${part}"`);
                }
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

    /**
     * De-duplicate an array of primitives while preserving the order of the
     * first occurrence.
     *
     * @template T
     * @param {Iterable<T>} values
     * @returns {T[]}
     */
    function deduplicatePreservingOrder(values) {
        const out = [];
        const seen = new Set();
        if (values === null || values === undefined) return out;
        if (typeof values[Symbol.iterator] !== 'function') return out;
        for (const v of values) {
            if (seen.has(v)) continue;
            seen.add(v);
            out.push(v);
        }
        return out;
    }

    /**
     * Extract confirmed DN numbers and possible-OCR-issue snippets from a
     * single OCR text blob (typically the text of one page).
     *
     * Confirmed = strict DN + exactly 8 digits.
     * Possible = looks like "DN <value>" but the value does not cleanly match
     * the strict rule (wrong digit count, letter/digit confusables, etc.),
     * AND it is not a substring of an already-confirmed match on that page.
     *
     * @param {string} text
     * @param {number} [pageNumber] optional, used to tag possible issues
     * @returns {{ confirmed: string[], possible: Array<{page:number|null,text:string}> }}
     */
    function extractDNNumbersFromOCRText(text, pageNumber) {
        const result = { confirmed: [], possible: [] };
        const source = safeToString(text);
        if (!source) return result;

        // Range spans of confirmed matches so we can skip them when scanning
        // for possible issues (avoid flagging a valid match as suspicious).
        const confirmedSpans = [];
        DN_STRICT_PATTERN.lastIndex = 0;
        let m;
        while ((m = DN_STRICT_PATTERN.exec(source)) !== null) {
            result.confirmed.push(m[1]);
            confirmedSpans.push([m.index, m.index + m[0].length]);
        }

        const isInsideConfirmed = (start, end) =>
            confirmedSpans.some(([cs, ce]) => start >= cs && end <= ce);

        DN_LOOSE_PATTERN.lastIndex = 0;
        while ((m = DN_LOOSE_PATTERN.exec(source)) !== null) {
            const start = m.index;
            const end = start + m[0].length;
            if (isInsideConfirmed(start, end)) continue;

            const value = m[1];
            const strictlyValid = /^[0-9]{8}$/.test(value);
            if (strictlyValid) {
                // Already handled by the strict pass, or a false positive on
                // the loose regex (should not happen given the character
                // class, but keep the guard for safety).
                continue;
            }

            result.possible.push({
                page: (typeof pageNumber === 'number') ? pageNumber : null,
                text: m[0].trim()
            });
        }

        return result;
    }

    return {
        DN_STRICT_PATTERN,
        DN_LOOSE_PATTERN,
        parsePageRange,
        deduplicatePreservingOrder,
        extractDNNumbersFromOCRText
    };
}));
