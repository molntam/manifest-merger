const DNExtractor = require('../dn-extractor.js');
const OCRDNExtractor = require('../ocr-dn-extractor.js');

function assertArray(actual, expected, label) {
    const a = JSON.stringify(actual);
    const e = JSON.stringify(expected);
    if (a !== e) throw new Error(`${label}: expected ${e}, got ${a}`);
}

assertArray(
    DNExtractor.extractUniqueDNNumbers([
        'DN 578281 87',
        'DN 578 28188',
        'DN 57 82 81 89'
    ]),
    ['57828187', '57828188', '57828189'],
    'Manifest Merger source extraction should stitch horizontal whitespace'
);

assertArray(
    DNExtractor.extractUniqueDNNumbers(['DN 578281\n87', 'DN 578281\r\n88']),
    [],
    'Manifest Merger source extraction must not stitch across lines'
);

assertArray(
    OCRDNExtractor.extractDNNumbersFromOCRText(
        'DN 57828192\nDN 57828191\nDN 57828188\nDN 578281 87\nDN 57828186\nDN 57828185'
    ).confirmed,
    ['57828192', '57828191', '57828188', '57828187', '57828186', '57828185'],
    'OCR fallback should recover the real Alpega split-digit case'
);

assertArray(
    OCRDNExtractor.extractDNNumbersFromOCRText('DN 578281\n87').confirmed,
    [],
    'OCR fallback must not stitch across lines'
);

console.log('DN spacing regression tests passed.');
