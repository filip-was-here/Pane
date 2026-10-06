import { open } from 'fs/promises';
import { mediaFileKind } from '../../../shared/utils/mediaFile';

/** Inspect at most 8 KiB before any UTF-8 decode. Incomplete trailing UTF-8 is OK. */
export async function isBinaryFile(filePath: string): Promise<boolean> {
  if (mediaFileKind(filePath)) return true;
  const file = await open(filePath, 'r');
  try {
    const buffer = Buffer.alloc(8192);
    const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
    const sample = buffer.subarray(0, bytesRead);
    if (sample.some(byte => byte === 0 || byte < 7 || (byte > 13 && byte < 32))) return true;
    try {
      new TextDecoder('utf-8', { fatal: true }).decode(sample, { stream: bytesRead === buffer.length });
      return false;
    } catch {
      return true;
    }
  } finally {
    await file.close();
  }
}
