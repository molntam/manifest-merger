(function (root, factory) {
    const api = factory(root);
    if (typeof module === 'object' && module.exports) {
        module.exports = api;
    } else {
        root.ManifestQR = api;
        const install = () => api.installPdfFooter();
        if (typeof document !== 'undefined' && document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', install, { once: true });
        } else if (typeof document !== 'undefined') {
            setTimeout(install, 0);
        }
    }
}(typeof self !== 'undefined' ? self : globalThis, function (root) {
    'use strict';

    const PREFIX = 'MM1';
    const QR_SIZE = 42;
    const QUIET_ZONE = 4;

    function crc32(text) {
        let crc = 0xFFFFFFFF;
        for (let i = 0; i < text.length; i++) {
            crc ^= text.charCodeAt(i);
            for (let bit = 0; bit < 8; bit++) {
                crc = (crc >>> 1) ^ ((crc & 1) ? 0xEDB88320 : 0);
            }
        }
        return ((crc ^ 0xFFFFFFFF) >>> 0).toString(16).toUpperCase().padStart(8, '0');
    }

    function normalizeDNs(values) {
        const out = [];
        const seen = new Set();
        for (const value of values || []) {
            const dn = String(value == null ? '' : value).trim();
            if (!/^[0-9]{8}$/.test(dn) || seen.has(dn)) continue;
            seen.add(dn);
            out.push(dn);
        }
        return out;
    }

    function createPayload(values) {
        const dns = normalizeDNs(values);
        if (!dns.length) return '';
        const digits = dns.join('');
        const core = `${PREFIX}:${dns.length}:${digits}`;
        return `${core}:${crc32(core)}`;
    }

    function parsePayload(value) {
        const text = String(value == null ? '' : value).trim();
        const parts = text.split(':');
        if (parts.length !== 4 || parts[0] !== PREFIX) return null;

        const count = Number(parts[1]);
        const digits = parts[2];
        const checksum = parts[3].toUpperCase();
        if (!Number.isInteger(count) || count < 1 || count > 9999) return null;
        if (!/^[0-9]+$/.test(digits) || digits.length !== count * 8) return null;

        const core = `${PREFIX}:${count}:${digits}`;
        if (!/^[0-9A-F]{8}$/.test(checksum) || crc32(core) !== checksum) return null;

        const dns = [];
        const seen = new Set();
        for (let i = 0; i < digits.length; i += 8) {
            const dn = digits.slice(i, i + 8);
            if (seen.has(dn)) return null;
            seen.add(dn);
            dns.push(dn);
        }
        return { version: PREFIX, count, dns, checksum };
    }

    function extractCurrentDNs() {
        try {
            if (typeof data === 'undefined' || !data || !Array.isArray(data.rows)) return [];
            const values = data.rows.map(row => row && row.length > 2 ? row[2] : '');
            if (root.DNExtractor && typeof root.DNExtractor.extractUniqueDNNumbers === 'function') {
                return root.DNExtractor.extractUniqueDNNumbers(values);
            }
            const out = [];
            const seen = new Set();
            const re = /\bDN\s*(\d{8})\b/gi;
            for (const value of values) {
                re.lastIndex = 0;
                let match;
                while ((match = re.exec(String(value || ''))) !== null) {
                    if (seen.has(match[1])) continue;
                    seen.add(match[1]);
                    out.push(match[1]);
                }
            }
            return out;
        } catch (_) {
            return [];
        }
    }

    function moduleIsDark(modules, row, col) {
        if (modules && typeof modules.get === 'function') return !!modules.get(row, col);
        return !!(modules && modules.data && modules.data[row * modules.size + col]);
    }

    function drawPayloadOnPage(page, payload) {
        if (!page || !payload || !root.QRCode || !root.PDFLib) return;
        const qr = root.QRCode.create(payload, { errorCorrectionLevel: 'Q' });
        const modules = qr && qr.modules;
        if (!modules || !modules.size) return;

        const totalModules = modules.size + QUIET_ZONE * 2;
        const moduleSize = QR_SIZE / totalModules;
        const pageWidth = typeof page.getWidth === 'function' ? page.getWidth() : 842;
        const x = pageWidth - 30 - QR_SIZE;
        const y = 1;
        const white = root.PDFLib.rgb(1, 1, 1);
        const black = root.PDFLib.rgb(0, 0, 0);

        page.drawRectangle({ x, y, width: QR_SIZE, height: QR_SIZE, color: white });
        for (let row = 0; row < modules.size; row++) {
            for (let col = 0; col < modules.size; col++) {
                if (!moduleIsDark(modules, row, col)) continue;
                page.drawRectangle({
                    x: x + (col + QUIET_ZONE) * moduleSize,
                    y: y + QR_SIZE - (row + QUIET_ZONE + 1) * moduleSize,
                    width: moduleSize + 0.02,
                    height: moduleSize + 0.02,
                    color: black
                });
            }
        }
    }

    function installPdfFooter() {
        if (!root || typeof root.drawFooter !== 'function' || !root.QRCode || !root.PDFLib) return false;
        if (root.drawFooter.__manifestQrWrapped) return true;

        const original = root.drawFooter;
        let cachedKey = '';
        let cachedPayload = '';

        function wrappedDrawFooter(page) {
            original.apply(this, arguments);
            try {
                const dns = extractCurrentDNs();
                if (!dns.length) return;
                const key = dns.join(',');
                if (key !== cachedKey) {
                    cachedKey = key;
                    cachedPayload = createPayload(dns);
                }
                drawPayloadOnPage(page, cachedPayload);
            } catch (err) {
                try { console.warn('[Manifest QR] Could not draw DN QR:', err); } catch (_) {}
            }
        }

        wrappedDrawFooter.__manifestQrWrapped = true;
        root.drawFooter = wrappedDrawFooter;
        return true;
    }

    return {
        PREFIX,
        crc32,
        normalizeDNs,
        createPayload,
        parsePayload,
        drawPayloadOnPage,
        installPdfFooter
    };
}));
