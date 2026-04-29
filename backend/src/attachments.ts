import { randomUUID } from 'node:crypto';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { inflateRawSync } from 'node:zlib';
import { basename, extname, isAbsolute, join, normalize } from 'node:path';
import { Readable } from 'node:stream';
import type { Request } from 'express';
import type { EngineAttachment } from '@claude-oca/runtime';
import type { ImageOcrResult } from './ocr.js';

const TEXT_EXTENSIONS = new Map<string, string>([
  ['.cjs', 'application/javascript'],
  ['.conf', 'text/plain'],
  ['.css', 'text/css'],
  ['.csv', 'text/csv'],
  ['.env', 'text/plain'],
  ['.html', 'text/html'],
  ['.ini', 'text/plain'],
  ['.java', 'text/plain'],
  ['.js', 'application/javascript'],
  ['.json', 'application/json'],
  ['.jsx', 'text/plain'],
  ['.log', 'text/plain'],
  ['.md', 'text/markdown'],
  ['.mjs', 'application/javascript'],
  ['.py', 'text/x-python'],
  ['.rb', 'text/plain'],
  ['.rs', 'text/plain'],
  ['.scss', 'text/x-scss'],
  ['.sh', 'text/x-shellscript'],
  ['.sql', 'application/sql'],
  ['.toml', 'application/toml'],
  ['.ts', 'text/typescript'],
  ['.tsx', 'text/typescript'],
  ['.txt', 'text/plain'],
  ['.xml', 'application/xml'],
  ['.yaml', 'application/yaml'],
  ['.yml', 'application/yaml']
]);

const TEXT_MEDIA_TYPES = new Set<string>([
  'application/javascript',
  'application/json',
  'application/sql',
  'application/toml',
  'application/xml',
  'application/yaml',
  'text/markdown',
  'text/typescript',
  'text/x-python',
  'text/x-scss',
  'text/x-shellscript'
]);

const IMAGE_MEDIA_TYPES = new Map<string, string>([
  ['.bmp', 'image/bmp'],
  ['.gif', 'image/gif'],
  ['.jpeg', 'image/jpeg'],
  ['.jpg', 'image/jpeg'],
  ['.png', 'image/png'],
  ['.webp', 'image/webp']
]);

const ZIP_MEDIA_TYPES = new Set(['application/zip', 'application/x-zip-compressed']);
const MAX_ZIP_FILES = 200;
const MAX_ZIP_TOTAL_UNCOMPRESSED = 100 * 1024 * 1024;
const MAX_ZIP_ENTRY_SIZE = 25 * 1024 * 1024;

export type ImageTextExtractor = (imagePath: string) => Promise<ImageOcrResult>;

export function sessionUploadDir(cwd: string, sessionId: string): string {
  return join(cwd, '.claude-oca', 'uploads', sessionId);
}

function sanitizeFileName(name: string): string {
  const safeName = basename(name).replace(/[^a-zA-Z0-9._-]/g, '_');
  return safeName || 'attachment';
}

function classifyByNameAndType(
  name: string,
  type = ''
): { kind: EngineAttachment['kind']; mediaType: string } | null {
  const extension = extname(name).toLowerCase();
  const mediaType = type.trim().toLowerCase();

  if (mediaType.startsWith('text/') || TEXT_MEDIA_TYPES.has(mediaType)) {
    return {
      kind: 'text',
      mediaType: mediaType || TEXT_EXTENSIONS.get(extension) || 'text/plain'
    };
  }

  if (TEXT_EXTENSIONS.has(extension)) {
    return {
      kind: 'text',
      mediaType: mediaType || TEXT_EXTENSIONS.get(extension) || 'text/plain'
    };
  }

  if (mediaType.startsWith('image/')) {
    return {
      kind: 'image',
      mediaType: mediaType || IMAGE_MEDIA_TYPES.get(extension) || 'image/png'
    };
  }

  if (IMAGE_MEDIA_TYPES.has(extension)) {
    return {
      kind: 'image',
      mediaType: mediaType || IMAGE_MEDIA_TYPES.get(extension) || 'image/png'
    };
  }

  return null;
}

function classifyFile(file: File): { kind: EngineAttachment['kind']; mediaType: string } | null {
  return classifyByNameAndType(file.name, file.type);
}

function isZipFile(file: File): boolean {
  return extname(file.name).toLowerCase() === '.zip' || ZIP_MEDIA_TYPES.has(file.type.trim().toLowerCase());
}

function toHeaders(req: Request): Headers {
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        headers.append(key, item);
      }
      continue;
    }

    if (typeof value === 'string') {
      headers.set(key, value);
    }
  }

  return headers;
}

export async function readMultipartFiles(req: Request): Promise<File[]> {
  const request = new Request(`http://localhost${req.originalUrl}`, {
    method: req.method,
    headers: toHeaders(req),
    body: Readable.toWeb(req) as BodyInit,
    duplex: 'half'
  } as RequestInit);
  const formData = await request.formData();

  return formData
    .getAll('files')
    .filter((value): value is File => typeof File !== 'undefined' && value instanceof File);
}

export async function ingestAttachments(input: {
  cwd: string;
  sessionId: string;
  files: File[];
  extractImageText: ImageTextExtractor;
}): Promise<EngineAttachment[]> {
  if (!input.files.length) {
    throw new Error('At least one attachment is required.');
  }

  const attachments: EngineAttachment[] = [];
  await mkdir(sessionUploadDir(input.cwd, input.sessionId), { recursive: true });
  for (const file of input.files) {
    if (isZipFile(file)) {
      attachments.push(...await ingestZipFile(input, file));
      continue;
    }

    const classification = classifyFile(file);
    if (!classification) {
      throw new Error(`Unsupported attachment type: ${file.name}`);
    }

    const id = randomUUID();
    const safeName = sanitizeFileName(file.name);
    const storedName = `${id.slice(0, 8)}-${safeName}`;
    const localPath = join(sessionUploadDir(input.cwd, input.sessionId), storedName);
    const buffer = Buffer.from(await file.arrayBuffer());
    await writeFile(localPath, buffer);

    let ocrStatus: EngineAttachment['ocrStatus'] = 'unavailable';
    let extractedText: string | undefined;
    if (classification.kind === 'image') {
      const ocrResult = await input.extractImageText(localPath);
      ocrStatus = ocrResult.status;
      extractedText = ocrResult.text;
    }

    attachments.push({
      id,
      originalName: file.name,
      storedName,
      mediaType: classification.mediaType,
      kind: classification.kind,
      localPath,
      size: buffer.byteLength,
      promptVisibility: 'available',
      ocrStatus,
      ...(extractedText ? { extractedText } : {}),
      uploadedAt: new Date().toISOString()
    });
  }

  return attachments;
}

async function ingestZipFile(input: {
  cwd: string;
  sessionId: string;
  extractImageText: ImageTextExtractor;
}, file: File): Promise<EngineAttachment[]> {
  const archiveId = randomUUID();
  const archiveName = sanitizeFileName(file.name);
  const buffer = Buffer.from(await file.arrayBuffer());
  const entries = extractSupportedZipEntries(buffer, file.name);
  if (!entries.length) {
    throw new Error(`ZIP archive contains no supported files: ${file.name}`);
  }

  const uploadDir = sessionUploadDir(input.cwd, input.sessionId);
  const attachments: EngineAttachment[] = [];
  for (const entry of entries) {
    const classification = classifyByNameAndType(entry.relativePath);
    if (!classification) {
      continue;
    }

    const id = randomUUID();
    const safeEntryName = sanitizeArchiveStoredName(entry.relativePath);
    const originalName = basename(entry.relativePath) || safeEntryName;
    const storedName = `${id.slice(0, 8)}-${archiveName.replace(/\.zip$/i, '')}-${safeEntryName}`;
    const localPath = join(uploadDir, storedName);
    await writeFile(localPath, entry.data);

    let ocrStatus: EngineAttachment['ocrStatus'] = 'unavailable';
    let extractedText: string | undefined;
    if (classification.kind === 'image') {
      const ocrResult = await input.extractImageText(localPath);
      ocrStatus = ocrResult.status;
      extractedText = ocrResult.text;
    }

    attachments.push({
      id,
      originalName,
      storedName,
      mediaType: classification.mediaType,
      kind: classification.kind,
      localPath,
      size: entry.data.byteLength,
      promptVisibility: 'available',
      ocrStatus,
      sourceArchive: {
        id: archiveId,
        name: file.name,
        relativePath: entry.relativePath
      },
      ...(extractedText ? { extractedText } : {}),
      uploadedAt: new Date().toISOString()
    });
  }

  if (!attachments.length) {
    throw new Error(`ZIP archive contains no supported files: ${file.name}`);
  }

  return attachments;
}

type ZipEntry = {
  relativePath: string;
  data: Buffer;
};

function extractSupportedZipEntries(buffer: Buffer, archiveName: string): ZipEntry[] {
  const eocdOffset = findEndOfCentralDirectory(buffer);
  if (eocdOffset < 0) {
    throw new Error(`Invalid ZIP archive: ${archiveName}`);
  }

  const totalEntries = buffer.readUInt16LE(eocdOffset + 10);
  const centralDirectoryOffset = buffer.readUInt32LE(eocdOffset + 16);
  const entries: ZipEntry[] = [];
  let offset = centralDirectoryOffset;
  let totalUncompressed = 0;

  for (let index = 0; index < totalEntries; index += 1) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) {
      throw new Error(`Invalid ZIP central directory: ${archiveName}`);
    }

    const compressionMethod = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const uncompressedSize = buffer.readUInt32LE(offset + 24);
    const fileNameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localHeaderOffset = buffer.readUInt32LE(offset + 42);
    const rawName = buffer.toString('utf8', offset + 46, offset + 46 + fileNameLength);
    offset += 46 + fileNameLength + extraLength + commentLength;

    const relativePath = normalizeZipPath(rawName);
    if (!relativePath || relativePath.endsWith('/') || classifyByNameAndType(relativePath) === null) {
      continue;
    }
    if (entries.length >= MAX_ZIP_FILES) {
      throw new Error(`ZIP archive has too many supported files: ${archiveName}`);
    }
    if (uncompressedSize > MAX_ZIP_ENTRY_SIZE) {
      throw new Error(`ZIP entry is too large: ${relativePath}`);
    }
    totalUncompressed += uncompressedSize;
    if (totalUncompressed > MAX_ZIP_TOTAL_UNCOMPRESSED) {
      throw new Error(`ZIP archive is too large after extraction: ${archiveName}`);
    }

    entries.push({
      relativePath,
      data: readZipEntryData(buffer, {
        archiveName,
        relativePath,
        localHeaderOffset,
        compressionMethod,
        compressedSize,
        uncompressedSize
      })
    });
  }

  return entries;
}

function findEndOfCentralDirectory(buffer: Buffer): number {
  const minOffset = Math.max(0, buffer.length - 65557);
  for (let offset = buffer.length - 22; offset >= minOffset; offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) {
      return offset;
    }
  }
  return -1;
}

function readZipEntryData(buffer: Buffer, input: {
  archiveName: string;
  relativePath: string;
  localHeaderOffset: number;
  compressionMethod: number;
  compressedSize: number;
  uncompressedSize: number;
}): Buffer {
  if (buffer.readUInt32LE(input.localHeaderOffset) !== 0x04034b50) {
    throw new Error(`Invalid ZIP local header in ${input.archiveName}`);
  }
  const fileNameLength = buffer.readUInt16LE(input.localHeaderOffset + 26);
  const extraLength = buffer.readUInt16LE(input.localHeaderOffset + 28);
  const dataStart = input.localHeaderOffset + 30 + fileNameLength + extraLength;
  const compressed = buffer.subarray(dataStart, dataStart + input.compressedSize);

  if (input.compressionMethod === 0) {
    return Buffer.from(compressed);
  }
  if (input.compressionMethod === 8) {
    const inflated = inflateRawSync(compressed);
    if (inflated.byteLength !== input.uncompressedSize) {
      throw new Error(`ZIP entry size mismatch: ${input.relativePath}`);
    }
    return inflated;
  }

  throw new Error(`Unsupported ZIP compression method in ${input.archiveName}: ${input.compressionMethod}`);
}

function normalizeZipPath(name: string): string | null {
  const normalized = normalize(name.replace(/\\/g, '/')).replace(/\\/g, '/');
  if (
    !normalized ||
    isAbsolute(normalized) ||
    normalized === '..' ||
    normalized.startsWith('../') ||
    normalized.includes('/../')
  ) {
    return null;
  }
  return normalized;
}

function sanitizeArchiveStoredName(name: string): string {
  return name
    .replace(/\\/g, '/')
    .split('/')
    .filter(Boolean)
    .map((part) => sanitizeFileName(part))
    .join('_') || 'attachment';
}

export async function deleteAttachmentFile(attachment: EngineAttachment): Promise<void> {
  await unlink(attachment.localPath).catch(() => undefined);
}
