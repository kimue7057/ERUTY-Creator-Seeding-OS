import { mkdir, readFile, unlink } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable, Transform } from "node:stream";
import { fileTypeFromFile } from "file-type";
import sharp from "sharp";
import { PDFDocument } from "pdf-lib";
import { AssetError } from "./errors";
import type { AcceptedMime } from "../validation/assets";
// Runtime-generated quarantine files are never deployment assets.
export const uploadTmpDir = () => resolve(/* turbopackIgnore: true */ process.env.UPLOAD_TMP_DIR ?? join(tmpdir(), "eruty-creator-seeding-os-uploads"));
export async function receiveFile(body: ReadableStream<Uint8Array>, expectedSize: number, mime: AcceptedMime, signal: AbortSignal) {
  await mkdir(uploadTmpDir(), { recursive: true });
  const path = join(uploadTmpDir(), `${randomUUID()}.tmp`);
  let size = 0; const hash = createHash("sha256");
  try {
    await pipeline(Readable.fromWeb(body as import("node:stream/web").ReadableStream<Uint8Array>), new Transform({ transform(chunk: Buffer, _, callback) {
      size += chunk.length;
      if (size > expectedSize) { callback(new AssetError(413, "size_exceeded", "업로드 파일 크기가 허용 범위를 초과했습니다.")); return; }
      hash.update(chunk); callback(null, chunk);
    } }), createWriteStream(path, { flags: "wx", mode: 0o600 }), { signal });
    if (size !== expectedSize) throw new AssetError(422, "incomplete", "업로드가 중단되었거나 파일 크기가 일치하지 않습니다.");
    const detected = await fileTypeFromFile(path).catch(() => undefined);
    if (detected?.mime !== mime) throw new AssetError(422, "type_mismatch", "실제 파일 시그니처가 선언한 파일 종류와 일치하지 않습니다.");
    try {
      if (mime.startsWith("image/")) {
        // Decode, rather than trusting only header dimensions. Bound decompression work.
        // Buffer input avoids libvips retaining a Windows file handle in cache.
        await sharp(await readFile(path), { limitInputPixels: 40_000_000, failOn: "warning" }).resize(1, 1).raw().toBuffer();
      } else if (mime === "application/pdf") {
        const pdf = await PDFDocument.load(await readFile(path), { updateMetadata: false });
        if (!pdf.getPageCount()) throw new Error("No PDF pages");
      } else {
        const bytes = await readFile(path); let offset = 0; const boxes = new Set<string>();
        while (offset + 8 <= bytes.length) {
          let length = bytes.readUInt32BE(offset); const type = bytes.toString("ascii", offset + 4, offset + 8);
          if (length === 1) { if (offset + 16 > bytes.length) throw new Error("Invalid MP4"); length = Number(bytes.readBigUInt64BE(offset + 8)); }
          if (length === 0) length = bytes.length - offset;
          if (length < 8 || offset + length > bytes.length) throw new Error("Truncated MP4");
          boxes.add(type); offset += length;
        }
        if (offset !== bytes.length || !["ftyp", "moov", "mdat"].every(b => boxes.has(b))) throw new Error("Invalid MP4 structure");
      }
    } catch { throw new AssetError(422, "invalid_content", "파일이 손상되었거나 올바른 PDF·이미지·MP4 구조가 아닙니다."); }
    return { path, size, sha256: hash.digest("hex"), mime };
  } catch (error) { await unlink(path).catch(() => {}); throw error; }
}
