#!/usr/bin/env node
/**
 * lib/saz_reader.js — Pembaca Fiddler Classic .saz (ZIP) dan raw session files
 * tanpa dependency eksternal (memakai zlib bawaan Node.js).
 */
'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

function findEndOfCentralDirectory(buf) {
    const minOffset = Math.max(0, buf.length - 65557);
    for (let i = buf.length - 22; i >= minOffset; i--) {
        if (buf[i] === 0x50 && buf[i + 1] === 0x4B && buf[i + 2] === 0x05 && buf[i + 3] === 0x06) {
            const commentLen = buf.readUInt16LE(i + 20);
            if (i + 22 + commentLen <= buf.length) return i;
        }
    }
    return -1;
}

function readZipEntries(zipBuf) {
    const buf = Buffer.isBuffer(zipBuf) ? zipBuf : Buffer.from(zipBuf);
    const eocdOffset = findEndOfCentralDirectory(buf);
    if (eocdOffset === -1) {
        throw new Error('File bukan arsip ZIP/.saz yang valid (EOCD tidak ditemukan).');
    }

    const totalEntries = buf.readUInt16LE(eocdOffset + 10);
    const cdOffset = buf.readUInt32LE(eocdOffset + 16);
    if (cdOffset >= buf.length) {
        throw new Error('Offset Central Directory tidak valid.');
    }

    const entries = new Map();
    let pos = cdOffset;
    for (let i = 0; i < totalEntries; i++) {
        if (pos + 46 > buf.length || buf.readUInt32LE(pos) !== 0x02014B50) {
            throw new Error(`Central Directory header korup di entry #${i}.`);
        }
        const method = buf.readUInt16LE(pos + 10);
        const compressedSize = buf.readUInt32LE(pos + 20);
        const uncompressedSize = buf.readUInt32LE(pos + 24);
        const nameLen = buf.readUInt16LE(pos + 28);
        const extraLen = buf.readUInt16LE(pos + 30);
        const commentLen = buf.readUInt16LE(pos + 32);
        const localHeaderOffset = buf.readUInt32LE(pos + 42);

        const name = buf.toString('utf8', pos + 46, pos + 46 + nameLen).replace(/\\/g, '/');
        pos += 46 + nameLen + extraLen + commentLen;

        if (name.endsWith('/')) continue;
        if (localHeaderOffset + 30 > buf.length || buf.readUInt32LE(localHeaderOffset) !== 0x04034B50) {
            throw new Error(`Local File Header korup untuk entry ${name}.`);
        }

        const localNameLen = buf.readUInt16LE(localHeaderOffset + 26);
        const localExtraLen = buf.readUInt16LE(localHeaderOffset + 28);
        const dataStart = localHeaderOffset + 30 + localNameLen + localExtraLen;
        const dataEnd = dataStart + compressedSize;
        if (dataEnd > buf.length) {
            throw new Error(`Ukuran data melebihi buffer untuk entry ${name}.`);
        }

        const slice = buf.subarray(dataStart, dataEnd);
        let content;
        if (method === 0) {
            content = Buffer.from(slice);
        } else if (method === 8) {
            content = zlib.inflateRawSync(slice);
        } else {
            throw new Error(`Metode kompresi ZIP tidak didukung (${method}) untuk entry ${name}.`);
        }

        entries.set(name, {
            name,
            method,
            compressedSize,
            uncompressedSize,
            content
        });
    }
    return entries;
}

function groupRawSessionEntries(entriesIterable) {
    const sessions = new Map();
    for (const entry of entriesIterable) {
        const normName = String(entry.name || '').replace(/\\/g, '/');
        const m = normName.match(/(?:^|\/)(\d+)_([csm])\.(txt|xml)$/i);
        if (!m) continue;
        const id = m[1];
        const kind = m[2].toLowerCase();
        if (!sessions.has(id)) {
            sessions.set(id, { id, numericId: parseInt(id, 10), clientRaw: null, serverRaw: null, metaXml: null });
        }
        const session = sessions.get(id);
        if (kind === 'c') session.clientRaw = entry.content;
        else if (kind === 's') session.serverRaw = entry.content;
        else if (kind === 'm') session.metaXml = entry.content.toString('utf8');
    }
    return Array.from(sessions.values()).sort((a, b) => a.numericId - b.numericId);
}

function readSazFile(filePath) {
    const buf = fs.readFileSync(filePath);
    const entries = readZipEntries(buf);
    return groupRawSessionEntries(entries.values());
}

function readRawSessionDir(dirPath) {
    const items = [];
    const walk = dir => {
        for (const dirent of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, dirent.name);
            if (dirent.isDirectory()) walk(full);
            else items.push({ name: path.relative(dirPath, full), content: fs.readFileSync(full) });
        }
    };
    walk(dirPath);
    return groupRawSessionEntries(items);
}

module.exports = {
    readZipEntries,
    groupRawSessionEntries,
    readSazFile,
    readRawSessionDir
};
