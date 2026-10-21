import { mkdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import sharp from "sharp";
import ffmpeg from "ffmpeg-static";
import { writeFile } from "node:fs/promises";
export async function generateAssetFixtures(directory: string) {
  await mkdir(directory, { recursive: true });
  const pdf = await PDFDocument.create(); const font = await pdf.embedFont(StandardFonts.Helvetica);
  const page = pdf.addPage([420, 300]); page.drawText("ERUTY / SYNTHETIC BRAND BRIEF", { x: 30, y: 235, size: 19, font, color: rgb(.14, .37, .27) });
  page.drawText("Test document only. No proprietary brand claims.", { x: 30, y: 190, size: 12, font });
  const paths = { pdf: join(directory, "brand-test.pdf"), png: join(directory, "product-test.png"), jpg: join(directory, "product-test.jpg"), webp: join(directory, "product-test.webp"), png2: join(directory, "product-test-v2.png"), mp4: join(directory, "advertising-test.mp4") };
  await writeFile(paths.pdf, await pdf.save());
  for (const [format, path] of [["png", paths.png], ["jpeg", paths.jpg], ["webp", paths.webp]] as const) await sharp({ create: { width: 600, height: 400, channels: 3, background: "#6e9678" } }).toFormat(format).toFile(path);
  await sharp({ create: { width: 600, height: 400, channels: 3, background: "#b5c6a4" } }).png().toFile(paths.png2);
  if (!ffmpeg) throw new Error("ffmpeg-static is required for the synthetic MP4 test fixture");
  const result = spawnSync(ffmpeg, ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "color=c=0x6e9678:s=160x120:r=10", "-t", "0.3", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart", paths.mp4], { windowsHide: true });
  if (result.status !== 0) throw new Error("Synthetic MP4 fixture generation failed");
  return { paths, bytes: { pdf: await readFile(paths.pdf), png: await readFile(paths.png), png2: await readFile(paths.png2), jpg: await readFile(paths.jpg), webp: await readFile(paths.webp), mp4: await readFile(paths.mp4) } };
}
if (process.argv[1] && resolve(process.argv[1]) === resolve("tests/asset-fixtures.ts")) { await generateAssetFixtures(resolve(".local/qa/fixtures")); console.log("Generated synthetic test PDF, images and MP4 in .local/qa/fixtures."); }
