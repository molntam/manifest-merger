// Tests for dn-extractor.js
//
// Runs both in Node (`node tests/dn-extractor.test.js`) and in the browser
// via tests.html. No external test framework so the project stays dependency-
// free and consistent with its "open the HTML file" workflow.

(function (root) {
    const isNode = typeof module === 'object' && module.exports;
    const DNExtractor = isNode
        ? require('../dn-extractor.js')
        : root.DNExtractor;

    if (!DNExtractor || typeof DNExtractor.extractUniqueDNNumbers !== 'function') {
        throw new Error('DNExtractor is not available; make sure dn-extractor.js is loaded first.');
    }

    const { extractUniqueDNNumbers } = DNExtractor;
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

    // ── 1. Normal DN values with a space ────────────────────────────────
    test('extracts normal "DN <space> 8 digits" values', () => {
        assertEqualArray(
            extractUniqueDNNumbers(['DN 57109142', 'DN 57110459']),
            ['57109142', '57110459']
        );
    });

    // ── 2. DN with and without a space ──────────────────────────────────
    test('accepts DN with or without whitespace between prefix and digits', () => {
        assertEqualArray(
            extractUniqueDNNumbers(['DN57109142', 'DN   57110459', 'DN\t57120277']),
            ['57109142', '57110459', '57120277']
        );
    });

    // ── 3. Lowercase / mixed-case dn ────────────────────────────────────
    test('is case-insensitive (dn / Dn / dN all match)', () => {
        assertEqualArray(
            extractUniqueDNNumbers(['dn 57109142', 'Dn 57110459', 'dN57120277']),
            ['57109142', '57110459', '57120277']
        );
    });

    // ── 4. Duplicate DN values ──────────────────────────────────────────
    test('removes duplicates across cells', () => {
        assertEqualArray(
            extractUniqueDNNumbers(['DN 57109142', 'DN 57109142', 'dn 57109142']),
            ['57109142']
        );
    });

    // ── 5. RF values are ignored ────────────────────────────────────────
    test('ignores RF-prefixed order numbers', () => {
        assertEqualArray(
            extractUniqueDNNumbers(['RF 57120277', 'RF57109142', 'rf 57110459']),
            []
        );
    });

    // ── 6. Standalone 8-digit numbers are ignored ───────────────────────
    test('ignores standalone 8-digit numbers with no DN prefix', () => {
        assertEqualArray(
            extractUniqueDNNumbers(['57109142', ' 57110459 ', '10164032']),
            []
        );
    });

    // ── 7. Empty and null cells ─────────────────────────────────────────
    test('safely skips null, undefined, empty, and whitespace-only cells', () => {
        assertEqualArray(
            extractUniqueDNNumbers([null, undefined, '', '   ', '\t\n', 'DN 57109142']),
            ['57109142']
        );
    });

    // ── 8. Multiple DN values inside a single cell ──────────────────────
    test('captures multiple DN values inside a single cell', () => {
        assertEqualArray(
            extractUniqueDNNumbers(['DN 57109142 DN 57110459 dn57120277']),
            ['57109142', '57110459', '57120277']
        );
    });

    // ── 9. First-occurrence order is preserved ──────────────────────────
    test('preserves first-occurrence order when removing duplicates', () => {
        assertEqualArray(
            extractUniqueDNNumbers([
                'DN 57109142',
                '57110459',
                'DN 57110459',
                'DN 57109913',
                '57109913',
                'DN 57111844',
                'DN 57111844',
                'DN 57108666',
                '57108666',
                'DN 57108862',
                'DN 57108862',
                '10164032',
                'RF 57120277',
                'DN 57120277',
                'DN 57120277',
                'DN 57114963',
                '57123667',
                'DN 57123667',
                '57116344',
                'DN 57116344'
            ]),
            [
                '57109142',
                '57110459',
                '57109913',
                '57111844',
                '57108666',
                '57108862',
                '57120277',
                '57114963',
                '57123667',
                '57116344'
            ]
        );
    });

    // ── 10. Wrong digit counts are ignored ──────────────────────────────
    test('ignores DN with fewer or more than 8 digits', () => {
        assertEqualArray(
            extractUniqueDNNumbers([
                'DN 1234567',      // 7 digits
                'DN 123456789',    // 9 digits
                'DN 5710914',      // 7 digits
                'DN 571091423'     // 9 digits
            ]),
            []
        );
    });

    // ── 11. Wrong digit counts alongside a valid one ────────────────────
    test('extracts only the valid 8-digit DN when mixed with invalid ones', () => {
        assertEqualArray(
            extractUniqueDNNumbers(['DN 1234567 DN 57109142 DN 123456789']),
            ['57109142']
        );
    });

    // ── 12. Mixed data types coerced safely ─────────────────────────────
    test('coerces non-string values safely', () => {
        assertEqualArray(
            extractUniqueDNNumbers([
                57109142,                       // plain number, no DN → ignored
                { toString: () => 'DN 57110459' },
                ['DN 57120277']                 // Array#toString → "DN 57120277"
            ]),
            ['57110459', '57120277']
        );
    });

    // ── 13. Non-iterable / bad inputs ───────────────────────────────────
    test('returns [] for null / undefined / non-iterable inputs', () => {
        assertEqualArray(extractUniqueDNNumbers(null), []);
        assertEqualArray(extractUniqueDNNumbers(undefined), []);
        assertEqualArray(extractUniqueDNNumbers(12345), []);
    });

    // ── 14. Leading/trailing whitespace ─────────────────────────────────
    test('trims leading and trailing whitespace before matching', () => {
        assertEqualArray(
            extractUniqueDNNumbers(['   DN 57109142   ', '\n\tDN 57110459\n']),
            ['57109142', '57110459']
        );
    });

    // ── 15. Join produces exactly the UI-facing value ───────────────────
    test('joined output has no blank lines and no duplicates', () => {
        const numbers = extractUniqueDNNumbers([
            'DN 57109142', '', null, 'DN 57109142', 'DN 57110459', '   '
        ]);
        const joined = numbers.join('\n');
        if (joined !== '57109142\n57110459') {
            throw new Error('unexpected joined output: ' + JSON.stringify(joined));
        }
        if (joined.split('\n').some(line => line === '')) {
            throw new Error('joined output contains blank lines');
        }
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
        root.__DN_EXTRACTOR_TEST_RESULTS__ = summary;
        if (typeof root.__renderDNExtractorTestResults === 'function') {
            root.__renderDNExtractorTestResults(summary);
        }
    }
}(typeof self !== 'undefined' ? self : this));
