// Tests for dn-extractor.js

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

    test('extracts normal DN values', () => {
        assertEqualArray(
            extractUniqueDNNumbers(['DN 57109142', 'DN 57110459']),
            ['57109142', '57110459']
        );
    });

    test('accepts whitespace between DN and digits', () => {
        assertEqualArray(
            extractUniqueDNNumbers(['DN57109142', 'DN   57110459', 'DN\t57120277']),
            ['57109142', '57110459', '57120277']
        );
    });

    test('stitches horizontal whitespace inside an eight-digit DN', () => {
        assertEqualArray(
            extractUniqueDNNumbers([
                'DN 578281 87',
                'DN 578 28187',
                'DN 57 82 81 88',
                'DN\t578281\t89'
            ]),
            ['57828187', '57828188', '57828189']
        );
    });

    test('does not stitch across a line break', () => {
        assertEqualArray(
            extractUniqueDNNumbers(['DN 578281\n87', 'DN 578281\r\n88']),
            []
        );
    });

    test('is case-insensitive', () => {
        assertEqualArray(
            extractUniqueDNNumbers(['dn 57109142', 'Dn 57110459', 'dN57120277']),
            ['57109142', '57110459', '57120277']
        );
    });

    test('removes duplicates across cells', () => {
        assertEqualArray(
            extractUniqueDNNumbers(['DN 57109142', 'DN 57109142', 'dn 57109142']),
            ['57109142']
        );
    });

    test('ignores RF-prefixed order numbers', () => {
        assertEqualArray(
            extractUniqueDNNumbers(['RF 57120277', 'RF57109142', 'rf 57110459']),
            []
        );
    });

    test('ignores standalone 8-digit numbers with no DN prefix', () => {
        assertEqualArray(
            extractUniqueDNNumbers(['57109142', ' 57110459 ', '10164032']),
            []
        );
    });

    test('safely skips empty values', () => {
        assertEqualArray(
            extractUniqueDNNumbers([null, undefined, '', '   ', '\t\n', 'DN 57109142']),
            ['57109142']
        );
    });

    test('captures multiple DN values inside a single cell', () => {
        assertEqualArray(
            extractUniqueDNNumbers(['DN 57109142 DN 57110459 dn57120277']),
            ['57109142', '57110459', '57120277']
        );
    });

    test('preserves first-occurrence order', () => {
        assertEqualArray(
            extractUniqueDNNumbers([
                'DN 57109142',
                'DN 57110459',
                'DN 57109913',
                'DN 57111844',
                'DN 57108666',
                'DN 57108862',
                'DN 57120277',
                'DN 57114963',
                'DN 57123667',
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

    test('ignores DN values with fewer or more than eight digits', () => {
        assertEqualArray(
            extractUniqueDNNumbers([
                'DN 1234567',
                'DN 123456789',
                'DN 123 456 789'
            ]),
            []
        );
    });

    test('extracts only valid eight-digit values when mixed', () => {
        assertEqualArray(
            extractUniqueDNNumbers(['DN 1234567 DN 57109142 DN 123456789 DN 578281 87']),
            ['57109142', '57828187']
        );
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
