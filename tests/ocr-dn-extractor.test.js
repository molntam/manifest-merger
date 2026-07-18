// Tests for ocr-dn-extractor.js
//
// Mirrors the style of tests/dn-extractor.test.js: no external framework,
// runs both in Node (`node tests/ocr-dn-extractor.test.js`) and in the
// browser via tests.html.

(function (root) {
    const isNode = typeof module === 'object' && module.exports;
    const OCRDNExtractor = isNode
        ? require('../ocr-dn-extractor.js')
        : root.OCRDNExtractor;

    if (!OCRDNExtractor || typeof OCRDNExtractor.extractDNNumbersFromOCRText !== 'function') {
        throw new Error('OCRDNExtractor is not available; make sure ocr-dn-extractor.js is loaded first.');
    }

    const {
        parsePageRange,
        deduplicatePreservingOrder,
        extractDNNumbersFromOCRText
    } = OCRDNExtractor;

    const results = [];

    function arraysEqual(a, b) {
        if (!Array.isArray(a) || !Array.isArray(b)) return false;
        if (a.length !== b.length) return false;
        for (let i = 0; i < a.length; i++) {
            if (a[i] !== b[i]) return false;
        }
        return true;
    }

    function test(name, fn) {
        try {
            fn();
            results.push({ name, passed: true });
        } catch (err) {
            results.push({ name, passed: false, error: err && err.message ? err.message : String(err) });
        }
    }

    function assertEqualArray(actual, expected, label) {
        if (!arraysEqual(actual, expected)) {
            throw new Error(
                (label ? label + ': ' : '') +
                'expected [' + expected.join(', ') + '] but got [' + (Array.isArray(actual) ? actual.join(', ') : String(actual)) + ']'
            );
        }
    }

    function assertEqual(actual, expected, label) {
        if (actual !== expected) {
            throw new Error(
                (label ? label + ': ' : '') +
                'expected ' + JSON.stringify(expected) + ' but got ' + JSON.stringify(actual)
            );
        }
    }

    function assertThrows(fn, expectedMessagePart, label) {
        try {
            fn();
        } catch (err) {
            if (expectedMessagePart && String(err.message || '').indexOf(expectedMessagePart) === -1) {
                throw new Error(
                    (label ? label + ': ' : '') +
                    'expected error to contain "' + expectedMessagePart + '" but got "' + err.message + '"'
                );
            }
            return;
        }
        throw new Error((label ? label + ': ' : '') + 'expected function to throw, but it did not');
    }

    // ── parsePageRange ────────────────────────────────────────────────────
    test('parsePageRange: empty input returns null (all pages)', () => {
        assertEqual(parsePageRange(''), null);
        assertEqual(parsePageRange('   '), null);
        assertEqual(parsePageRange(null), null);
        assertEqual(parsePageRange(undefined), null);
    });

    test('parsePageRange: single page', () => {
        assertEqualArray(parsePageRange('3'), [3]);
    });

    test('parsePageRange: simple range 1-5', () => {
        assertEqualArray(parsePageRange('1-5'), [1, 2, 3, 4, 5]);
    });

    test('parsePageRange: comma-separated list is supported', () => {
        assertEqualArray(parsePageRange('1,3,5'), [1, 3, 5]);
    });

    test('parsePageRange: mixed ranges and singles', () => {
        assertEqualArray(parsePageRange('1-3,5,7-8'), [1, 2, 3, 5, 7, 8]);
    });

    test('parsePageRange: duplicates deduped and sorted', () => {
        assertEqualArray(parsePageRange('5,3,1-2,3'), [1, 2, 3, 5]);
    });

    test('parsePageRange: reject non-numeric', () => {
        assertThrows(() => parsePageRange('a-3'), 'Invalid');
        assertThrows(() => parsePageRange('foo'), 'Invalid');
    });

    test('parsePageRange: reject inverted range', () => {
        assertThrows(() => parsePageRange('5-2'), 'start > end');
    });

    test('parsePageRange: reject zero/negative pages', () => {
        assertThrows(() => parsePageRange('0-3'), 'Invalid');
        assertThrows(() => parsePageRange('-1'), 'Invalid');
    });

    test('parsePageRange: reject out-of-range vs totalPages', () => {
        assertThrows(() => parsePageRange('1-6', 5), 'out of range');
    });

    test('parsePageRange: totalPages check passes for valid range', () => {
        assertEqualArray(parsePageRange('1-5', 10), [1, 2, 3, 4, 5]);
    });

    // ── deduplicatePreservingOrder ────────────────────────────────────────
    test('deduplicatePreservingOrder: removes duplicates keeping first', () => {
        assertEqualArray(
            deduplicatePreservingOrder(['a', 'b', 'a', 'c', 'b']),
            ['a', 'b', 'c']
        );
    });

    test('deduplicatePreservingOrder: works with numbers', () => {
        assertEqualArray(
            deduplicatePreservingOrder([1, 2, 1, 3, 2, 4]),
            [1, 2, 3, 4]
        );
    });

    test('deduplicatePreservingOrder: safely handles null/undefined', () => {
        assertEqualArray(deduplicatePreservingOrder(null), []);
        assertEqualArray(deduplicatePreservingOrder(undefined), []);
    });

    // ── extractDNNumbersFromOCRText ───────────────────────────────────────
    test('extractDNNumbersFromOCRText: extracts basic DN + 8 digits variants', () => {
        const { confirmed, possible } = extractDNNumbersFromOCRText(
            'DN 57116344 DN: 57109142 DN57110459 DN - 57109913 DN.57111844',
            1
        );
        assertEqualArray(confirmed, ['57116344', '57109142', '57110459', '57109913', '57111844']);
        assertEqual(possible.length, 0);
    });

    test('extractDNNumbersFromOCRText: is case-insensitive', () => {
        const { confirmed } = extractDNNumbersFromOCRText('dn 57116344 Dn: 57109142');
        assertEqualArray(confirmed, ['57116344', '57109142']);
    });

    test('extractDNNumbersFromOCRText: rejects longer numbers (not part of longer)', () => {
        const { confirmed } = extractDNNumbersFromOCRText('DN 571163444 DN 571091422');
        assertEqualArray(confirmed, []);
    });

    test('extractDNNumbersFromOCRText: rejects short numbers', () => {
        const { confirmed } = extractDNNumbersFromOCRText('DN 5711634 DN 5710914');
        assertEqualArray(confirmed, []);
    });

    test('extractDNNumbersFromOCRText: flags OCR-confusable characters as possible issues', () => {
        // "571I6344" contains an "I" instead of "1" — classic OCR mistake.
        const { confirmed, possible } = extractDNNumbersFromOCRText('DN 571I6344', 4);
        assertEqualArray(confirmed, []);
        assertEqual(possible.length, 1);
        assertEqual(possible[0].page, 4);
        if (possible[0].text.indexOf('571I6344') === -1) {
            throw new Error('expected possible text to include the OCR fragment, got: ' + possible[0].text);
        }
    });

    test('extractDNNumbersFromOCRText: flags too-short / too-long numeric values', () => {
        const { confirmed, possible } = extractDNNumbersFromOCRText('DN 5711634\nDN 571163444', 7);
        assertEqualArray(confirmed, []);
        assertEqual(possible.length, 2);
        for (const p of possible) {
            assertEqual(p.page, 7);
        }
    });

    test('extractDNNumbersFromOCRText: does not double-report confirmed matches as possible', () => {
        const { confirmed, possible } = extractDNNumbersFromOCRText('DN 57116344 DN 571I6344', 2);
        assertEqualArray(confirmed, ['57116344']);
        assertEqual(possible.length, 1);
        if (possible[0].text.indexOf('571I6344') === -1) {
            throw new Error('expected only the OCR-flawed value to be flagged, got: ' + possible[0].text);
        }
    });

    test('extractDNNumbersFromOCRText: ignores standalone 8-digit numbers with no DN prefix', () => {
        const { confirmed, possible } = extractDNNumbersFromOCRText('57116344 12345678 RF 57116344', 3);
        assertEqualArray(confirmed, []);
        assertEqual(possible.length, 0);
    });

    test('extractDNNumbersFromOCRText: handles empty / null / non-string input', () => {
        assertEqualArray(extractDNNumbersFromOCRText('').confirmed, []);
        assertEqualArray(extractDNNumbersFromOCRText(null).confirmed, []);
        assertEqualArray(extractDNNumbersFromOCRText(undefined).confirmed, []);
    });

    test('extractDNNumbersFromOCRText: preserves in-text order of confirmed numbers', () => {
        const { confirmed } = extractDNNumbersFromOCRText(
            'DN 57109142\nDN 57110459\nDN 57109913\nDN 57111844\nDN 57116344'
        );
        assertEqualArray(confirmed, ['57109142', '57110459', '57109913', '57111844', '57116344']);
    });

    const summary = {
        total: results.length,
        passed: results.filter(r => r.passed).length,
        failed: results.filter(r => !r.passed).length,
        results
    };

    if (isNode) {
        for (const r of results) {
            const tag = r.passed ? 'PASS' : 'FAIL';
            console.log(`  [${tag}] ${r.name}${r.passed ? '' : '\n         ' + r.error}`);
        }
        console.log(`\n${summary.passed}/${summary.total} passed, ${summary.failed} failed.`);
        if (summary.failed > 0) process.exit(1);
    } else {
        root.__OCR_DN_EXTRACTOR_TEST_RESULTS__ = summary;
        if (typeof root.__renderOCRDNExtractorTestResults === 'function') {
            root.__renderOCRDNExtractorTestResults(summary);
        }
    }
}(typeof self !== 'undefined' ? self : this));
