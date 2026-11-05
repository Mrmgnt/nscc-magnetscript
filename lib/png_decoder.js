'use strict';
const zlib = require('zlib');

/**
 * Pure JavaScript PNG decoder for 8-bit truecolor (RGB) and truecolor with alpha (RGBA).
 * Requires only Node.js built-in 'zlib'.
 * @param {Buffer} buffer 
 * @returns {{ width: number, height: number, rgba: Buffer }}
 */
function decodePNG(buffer) {
    if (!Buffer.isBuffer(buffer)) {
        buffer = Buffer.from(buffer);
    }
    if (buffer.length < 8 || buffer.slice(0, 8).toString('hex') !== '89504e470d0a1a0a') {
        throw new Error('Invalid PNG signature');
    }
    let pos = 8;
    let width = 0, height = 0, bitDepth = 0, colorType = 0;
    const idatChunks = [];
    while (pos < buffer.length) {
        const len = buffer.readUInt32BE(pos); pos += 4;
        const type = buffer.slice(pos, pos + 4).toString('ascii'); pos += 4;
        const data = buffer.slice(pos, pos + len); pos += len;
        pos += 4; // skip CRC
        if (type === 'IHDR') {
            width = data.readUInt32BE(0);
            height = data.readUInt32BE(4);
            bitDepth = data[8];
            colorType = data[9];
            const compression = data[10];
            const filter = data[11];
            const interlace = data[12];
            if (bitDepth !== 8 || interlace !== 0) {
                throw new Error('Unsupported bitDepth/interlace: ' + bitDepth + '/' + interlace);
            }
            if (colorType !== 2 && colorType !== 6) {
                throw new Error('Unsupported colorType: ' + colorType + ' (only 2=RGB and 6=RGBA supported)');
            }
        } else if (type === 'IDAT') {
            idatChunks.push(data);
        } else if (type === 'IEND') {
            break;
        }
    }
    const decompressed = zlib.inflateSync(Buffer.concat(idatChunks));
    const bpp = colorType === 6 ? 4 : 3;
    const rowBytes = width * bpp;
    const rgba = Buffer.alloc(width * height * 4);

    function paeth(a, b, c) {
        const p = a + b - c;
        const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        return (pa <= pb && pa <= pc) ? a : (pb <= pc) ? b : c;
    }

    let srcPos = 0;
    const rawRow = Buffer.alloc(rowBytes);
    const priorRow = Buffer.alloc(rowBytes);

    for (let y = 0; y < height; y++) {
        const filter = decompressed[srcPos++];
        for (let i = 0; i < rowBytes; i++) {
            const filt = decompressed[srcPos++];
            const left = i >= bpp ? rawRow[i - bpp] : 0;
            const up = priorRow[i];
            const upLeft = i >= bpp ? priorRow[i - bpp] : 0;
            let val = 0;
            if (filter === 0) val = filt;
            else if (filter === 1) val = (filt + left) & 0xff;
            else if (filter === 2) val = (filt + up) & 0xff;
            else if (filter === 3) val = (filt + Math.floor((left + up) / 2)) & 0xff;
            else if (filter === 4) val = (filt + paeth(left, up, upLeft)) & 0xff;
            rawRow[i] = val;
        }
        rawRow.copy(priorRow);

        for (let x = 0; x < width; x++) {
            const dstIdx = (y * width + x) * 4;
            const srcIdx = x * bpp;
            rgba[dstIdx] = rawRow[srcIdx];
            rgba[dstIdx + 1] = rawRow[srcIdx + 1];
            rgba[dstIdx + 2] = rawRow[srcIdx + 2];
            rgba[dstIdx + 3] = (bpp === 4) ? rawRow[srcIdx + 3] : 255;
        }
    }
    return { width, height, rgba };
}

module.exports = { decodePNG };

