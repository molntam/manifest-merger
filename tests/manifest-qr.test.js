const ManifestQR = require('../manifest-qr.js');

function assert(condition, message) {
    if (!condition) throw new Error(message);
}

const dns = [
    '57820511',
    '57814610',
    '57812526',
    '57822040',
    '57812521',
    '57825481',
    '57824143',
    '57828483'
];

const payload = ManifestQR.createPayload(dns);
const parsed = ManifestQR.parsePayload(payload);
assert(parsed, 'valid payload should parse');
assert(parsed.count === dns.length, 'count should match');
assert(JSON.stringify(parsed.dns) === JSON.stringify(dns), 'DN order should be preserved');

const uniquePayload = ManifestQR.createPayload(['57820511', '57820511', 'bad', '57814610']);
const uniqueParsed = ManifestQR.parsePayload(uniquePayload);
assert(JSON.stringify(uniqueParsed.dns) === JSON.stringify(['57820511', '57814610']), 'payload should contain unique valid DNs');

const tampered = payload.replace('57820511', '57820512');
assert(ManifestQR.parsePayload(tampered) === null, 'checksum should reject modified payload');
assert(ManifestQR.parsePayload('not-a-manifest-qr') === null, 'unrelated QR should be ignored');

console.log('Manifest QR tests passed.');
