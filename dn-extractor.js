// dn-extractor.js
//
// Pure, UI-independent extraction of DN order numbers from the
// "Order number, Reference no." column of the merged loading list.
//
// The extractor looks for values shaped like "DN 12345678" (case-insensitive,
// optional whitespace between "DN" and the digits) and returns the captured
// 8-digit numbers, de-duplicated while preserving first-occurrence order.
//
// Intentionally does not touch the DOM so it can be unit-tested in isolation
// (see tests.html / tests/dn-extractor.test.js).

(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.DNExtractor = factory();
    }
}(typeof self !== 'undefined' ? self : this, function () {
    // \bDN\s*(\d{8})\b, case-insensitive, global so we can find every match
    // inside a single cell.
    const DN_PATTERN = /\bDN\s*(\d{8})\b/gi;

    function safeToString(value) {
        if (value === null || value === undefined) return '';
        try {
            return String(value);
        } catch (e) {
            return '';
        }
    }

    /**
     * Extract unique 8-digit DN order numbers from an iterable of raw cell values.
     *
     * - Skips null / undefined / empty cells.
     * - Coerces non-string values (numbers, objects, etc.) to strings safely.
     * - Trims leading/trailing whitespace before matching.
     * - Matches case-insensitively; multiple DN values inside one cell are all captured.
     * - Preserves the order of the first occurrence and removes duplicates.
     * - Ignores RF numbers, standalone 8-digit numbers, and numbers with a
     *   different digit count.
     *
     * @param {Iterable<*>} values
     * @returns {string[]} de-duplicated 8-digit numbers in first-occurrence order
     */
    function extractUniqueDNNumbers(values) {
        const results = [];
        const seen = new Set();

        if (values === null || values === undefined) return results;
        if (typeof values[Symbol.iterator] !== 'function') return results;

        for (const value of values) {
            const text = safeToString(value).trim();
            if (!text) continue;

            // Reset lastIndex defensively because DN_PATTERN is a shared, stateful /g regex.
            DN_PATTERN.lastIndex = 0;
            let match;
            while ((match = DN_PATTERN.exec(text)) !== null) {
                const number = match[1];
                if (!seen.has(number)) {
                    seen.add(number);
                    results.push(number);
                }
            }
        }

        return results;
    }

    return {
        DN_PATTERN,
        extractUniqueDNNumbers
    };
}));
