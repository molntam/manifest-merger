// dn-extractor.js

(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.DNExtractor = factory();
    }
}(typeof self !== 'undefined' ? self : this, function () {
    const DN_PATTERN = /\bDN[^\S\r\n]*((?:\d[^\S\r\n]*){7}\d)(?![^\S\r\n]*\d)/gi;

    function safeToString(value) {
        if (value === null || value === undefined) return '';
        try {
            return String(value);
        } catch (_) {
            return '';
        }
    }

    function compactDN(value) {
        return safeToString(value).replace(/[^\S\r\n]/g, '');
    }

    function extractUniqueDNNumbers(values) {
        const results = [];
        const seen = new Set();

        if (values === null || values === undefined) return results;
        if (typeof values[Symbol.iterator] !== 'function') return results;

        for (const value of values) {
            const text = safeToString(value).trim();
            if (!text) continue;

            DN_PATTERN.lastIndex = 0;
            let match;
            while ((match = DN_PATTERN.exec(text)) !== null) {
                const number = compactDN(match[1]);
                if (!/^\d{8}$/.test(number) || seen.has(number)) continue;
                seen.add(number);
                results.push(number);
            }
        }

        return results;
    }

    return {
        DN_PATTERN,
        extractUniqueDNNumbers
    };
}));
