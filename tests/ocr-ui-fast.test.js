const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const ManifestQR = require('../manifest-qr.js');
const OCRDNExtractor = require('../ocr-dn-extractor.js');

const source = fs.readFileSync(path.join(__dirname, '../ocr-ui-fast.js'), 'utf8');

class Element {
    constructor() {
        this.value = '';
        this.checked = false;
        this.disabled = false;
        this.children = [];
        this.style = {};
        this.classList = { add() {}, remove() {}, toggle() {} };
    }
    addEventListener() {}
    querySelectorAll() { return []; }
    append(...children) { this.children.push(...children); }
    appendChild(child) { this.append(child); }
}

function createReader(documents, { range = '', forceOCR = false, cancelOnQR = false } = {}) {
    const elements = new Map();
    const element = id => {
        if (!elements.has(id)) elements.set(id, new Element());
        return elements.get(id);
    };
    const pages = new Map();
    const scanned = new Set();
    const textRead = [];
    const ocrRead = [];
    let nextId = 1;
    const files = documents.map((definitions, fileIndex) => {
        const pdfPages = definitions.map((definition, pageIndex) => {
            const id = nextId++;
            const key = `${fileIndex + 1}:${pageIndex + 1}`;
            const page = { ...definition, key };
            pages.set(id, page);
            return {
                getViewport: () => ({ width: 600, height: 400 }),
                render({ canvasContext }) {
                    canvasContext.canvas.pageId = id;
                    return { promise: Promise.resolve() };
                },
                async getTextContent() {
                    textRead.push(key);
                    return { items: [{ str: page.text || '', hasEOL: true }] };
                }
            };
        });
        return {
            name: `manifest-${fileIndex + 1}.pdf`, type: 'application/pdf',
            size: definitions.length, lastModified: 1,
            async arrayBuffer() {
                return { numPages: pdfPages.length, getPage: async n => pdfPages[n - 1] };
            }
        };
    });
    const context = {
        console, setTimeout, clearTimeout, OCRDNExtractor, ManifestQR,
        addEventListener() {},
        document: {
            getElementById: element,
            createElement(tag) {
                if (tag !== 'canvas') return new Element();
                const canvas = new Element();
                canvas.getContext = () => ({
                    canvas, fillRect() {}, putImageData() {},
                    getImageData(x, y, width, height) {
                        return { data: new Uint8ClampedArray([canvas.pageId, 0, 0, 255]), width, height };
                    }
                });
                return canvas;
            }
        },
        pdfjsLib: { getDocument: ({ data }) => ({ promise: Promise.resolve(data) }) },
        jsQR(data) {
            const page = pages.get(data[0]);
            scanned.add(page.key);
            if (page.qrError) throw new Error('QR decoding failed');
            if (page.qr && cancelOnQR) element('ocr-cancel-btn').onclick();
            return page.qr ? { data: page.qr } : null;
        },
        Tesseract: {
            async createWorker() {
                return {
                    async setParameters() {},
                    async recognize(canvas) {
                        const page = pages.get(canvas.pageId);
                        ocrRead.push(page.key);
                        if (page.ocrError) throw new Error('OCR failed');
                        return { data: { text: page.ocr || '' } };
                    }
                };
            }
        }
    };
    context.window = context;
    element('ocr-pages-all').checked = !range;
    element('ocr-pages-range').checked = !!range;
    element('ocr-page-range-text').value = range;
    element('ocr-mode-force').checked = forceOCR;
    vm.runInNewContext(source, context);
    element('ocr-file-input').files = files;
    element('ocr-file-input').onchange();
    return {
        element, scanned, textRead, ocrRead,
        async run() {
            await element('ocr-extract-btn').onclick();
            return element('ocr-confirmed-output').value.split('\n').filter(Boolean);
        },
        summary() {
            const ul = element('ocr-summary-text').children.at(-1);
            return ul ? ul.children.map(child => child.textContent) : [];
        }
    };
}

const qrDNs = Array.from({ length: 18 }, (_, i) => String(58000000 + i));
const mixedPages = Array.from({ length: 90 }, (_, i) =>
    i === 52 || i === 53
        ? { qr: ManifestQR.createPayload(qrDNs) }
        : { text: `DN ${57000001 + i}` }
);

test('a QR on pages 53-54 does not suppress the other 88 pages', async () => {
    const reader = createReader([mixedPages]);
    const expected = mixedPages.flatMap(page => page.qr ? qrDNs : [page.text.slice(3)]);
    assert.deepEqual(await reader.run(), [...new Set(expected)]);
    assert.equal(reader.scanned.size, 90);
    assert.equal(reader.textRead.length, 88);
    assert.deepEqual(reader.ocrRead, []);
    assert.ok(reader.summary().includes('90 pages processed'));
    assert.ok(reader.summary().includes('2 pages resolved from Manifest QR'));
    assert.equal(reader.element('ocr-copy-btn').disabled, false);
});

test('the full result equals the union of the separately selected ranges', async () => {
    const parts = [];
    for (const [range, count] of [['1-52', 52], ['53-54', 18], ['55-90', 36]]) {
        const reader = createReader([mixedPages], { range });
        const result = await reader.run();
        assert.equal(result.length, count);
        parts.push(...result);
        const selected = OCRDNExtractor.parsePageRange(range, mixedPages.length);
        assert.deepEqual([...reader.scanned], selected.map(page => `1:${page}`));
    }
    assert.deepEqual(await createReader([mixedPages]).run(), [...new Set(parts)]);
});

test('different manifest QRs and fallback pages accumulate across multiple files', async () => {
    const reader = createReader([
        [
            { qr: ManifestQR.createPayload(['57100001', '57100002']) },
            { text: 'DN 57100003' },
            { qr: ManifestQR.createPayload(['57100002', '57100004']) }
        ],
        [
            { ocr: 'DN 57100005' },
            { qr: ManifestQR.createPayload(['57100004', '57100006']) },
            { text: 'DN 57100007' }
        ]
    ]);
    assert.deepEqual(await reader.run(), Array.from({ length: 7 }, (_, i) => String(57100001 + i)));
    assert.deepEqual(reader.ocrRead, ['2:1']);
    assert.ok(reader.summary().includes('2 PDF files processed'));
    assert.ok(reader.summary().includes('3 pages resolved from Manifest QR'));
});

test('unrelated, corrupt and unreadable QRs fall back on their own pages', async () => {
    const corrupt = ManifestQR.createPayload(['57100001']).replace('57100001', '57100002');
    const reader = createReader([[
        { qr: 'https://example.com/tracking', text: 'DN 57100003' },
        { qr: corrupt, ocr: 'DN 57100004' },
        { qrError: true, text: 'DN 57100005' },
        { qr: ManifestQR.createPayload(['57100006']) }
    ]]);
    assert.deepEqual(await reader.run(), ['57100003', '57100004', '57100005', '57100006']);
    assert.deepEqual(reader.ocrRead, ['1:2']);
});

test('Force OCR still uses valid QRs and OCRs every other selected page', async () => {
    const reader = createReader([[
        { qr: ManifestQR.createPayload(['57100001']) },
        { text: 'DN 57999999', ocr: 'DN 57100002' },
        { qr: ManifestQR.createPayload(['57100003']) }
    ]], { forceOCR: true });
    assert.deepEqual(await reader.run(), ['57100001', '57100002', '57100003']);
    assert.deepEqual(reader.textRead, []);
    assert.deepEqual(reader.ocrRead, ['1:2']);
});

test('page failures do not discard other results or disappear behind QR success', async () => {
    const reader = createReader([[
        { qr: ManifestQR.createPayload(['57100001']) },
        { ocrError: true },
        { text: 'DN 57100002' }
    ]]);
    assert.deepEqual(await reader.run(), ['57100001', '57100002']);
    assert.ok(reader.summary().includes('1 failed page'));
    assert.match(reader.element('ocr-status').textContent, /page errors/);
});

test('cancelling during a QR scan stops before scanning later pages', async () => {
    const reader = createReader([[
        { qr: ManifestQR.createPayload(['57100001']) },
        { text: 'DN 57100002' }
    ]], { cancelOnQR: true });
    assert.deepEqual(await reader.run(), []);
    assert.deepEqual([...reader.scanned], ['1:1']);
    assert.equal(reader.element('ocr-status').textContent, 'OCR cancelled.');
    assert.equal(reader.element('ocr-extract-btn').disabled, false);
});
