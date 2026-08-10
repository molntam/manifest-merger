const OCRDNExtractor = require('../ocr-dn-extractor.js');

function assert(condition, message) {
    if (!condition) throw new Error(message);
}

function test(name, fn) {
    try {
        fn();
        console.log('[PASS]', name);
    } catch (err) {
        console.error('[FAIL]', name, '-', err.message);
        process.exitCode = 1;
    }
}

test('normalizes common OCR confusables without auto-accepting them', () => {
    const result = OCRDNExtractor.normalizeDNToken('57B12516');
    assert(result.valid, 'expected normalized token to be valid');
    assert(result.value === '57812516', `unexpected value ${result.value}`);
    assert(result.corrected === true, 'expected corrected flag');
});

test('collects standalone eight-digit values as evidence', () => {
    const result = OCRDNExtractor.extractDNCandidatesFromOCRText('57812526\nDN 57812526', 1, 'pass-a');
    assert(result.evidence.some(item => item.value === '57812526' && !item.labelled), 'standalone evidence missing');
    assert(result.evidence.some(item => item.value === '57812526' && item.labelled), 'labelled evidence missing');
});

test('verifies a DN when independent OCR sources agree with a DN-labelled observation', () => {
    const a = OCRDNExtractor.extractDNCandidatesFromOCRText('57822040\nDN 57822040', 1, 'pass-a');
    const b = OCRDNExtractor.extractDNCandidatesFromOCRText('57822040\nDN 57822040', 1, 'pass-b');
    const result = OCRDNExtractor.evaluateDNEvidence([...a.evidence, ...b.evidence]);
    assert(result.verified.includes('57822040'), 'expected DN to be verified');
});

test('does not auto-verify an unlabelled repeated eight-digit number', () => {
    const a = OCRDNExtractor.extractDNCandidatesFromOCRText('57812517\n57812517', 1, 'pass-a');
    const b = OCRDNExtractor.extractDNCandidatesFromOCRText('57812517\n57812517', 1, 'pass-b');
    const result = OCRDNExtractor.evaluateDNEvidence([...a.evidence, ...b.evidence]);
    assert(!result.verified.includes('57812517'), 'unlabelled number must not be auto-verified');
    assert(result.unresolved.some(item => item.value === '57812517'), 'unlabelled repeated number should be reviewable');
});

test('keeps a single-source DN candidate unresolved', () => {
    const a = OCRDNExtractor.extractDNCandidatesFromOCRText('DN 57823597', 1, 'pass-a');
    const result = OCRDNExtractor.evaluateDNEvidence(a.evidence);
    assert(!result.verified.includes('57823597'), 'single-source DN must not be auto-verified');
    assert(result.unresolved.some(item => item.value === '57823597'), 'single-source DN should require review');
});

test('recovers a corrected labelled candidate only after independent agreement', () => {
    const a = OCRDNExtractor.extractDNCandidatesFromOCRText('DN 57B12516', 1, 'pass-a');
    const b = OCRDNExtractor.extractDNCandidatesFromOCRText('DN 57812516', 1, 'pass-b');
    const result = OCRDNExtractor.evaluateDNEvidence([...a.evidence, ...b.evidence]);
    assert(result.verified.includes('57812516'), 'corrected DN should verify after corroboration');
});
