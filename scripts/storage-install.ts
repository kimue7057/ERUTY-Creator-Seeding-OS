import { createHash } from "node:crypto";
import { mkdir, writeFile, readFile, chmod } from "node:fs/promises";
import { resolve, join } from "node:path";
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
const platforms = {
  win32: { archive: "windows_amd64.zip", hash: "fe90c04c0620ad1a1c756f86cd5e1443773f56a446688077a4bb5ec04c3cc874", binary: "weed.exe" },
  linux: { archive: "linux_amd64.tar.gz", hash: "4a7d108384d044d95212d1342cdda9533fa55842c1c9b41f606ca3c8a9561124", binary: "weed" },
};
const platform = platforms[process.platform as keyof typeof platforms];
if (!platform || process.arch !== "x64") throw new Error("Use your own S3 test service on this OS/architecture.");
const dir = resolve(".local/bin/seaweedfs-4.48");
await mkdir(dir, { recursive: true });
const archive = join(dir, platform.archive);
if (!existsSync(archive)) {
  const response = await fetch(`https://github.com/seaweedfs/seaweedfs/releases/download/4.48/${platform.archive}`);
  if (!response.ok) throw new Error(`Official SeaweedFS download failed: ${response.status}`);
  await writeFile(archive, Buffer.from(await response.arrayBuffer()));
}
if (createHash("sha256").update(await readFile(archive)).digest("hex") !== platform.hash) throw new Error("Archive checksum mismatch; binary was not executed.");
// BSD tar on Windows and GNU tar on Linux both detect the archive format.
const result = spawnSync("tar", ["-xf", archive, "-C", dir], { stdio: "inherit", windowsHide: true });
if (result.status !== 0) throw new Error("Archive extraction failed");
if (process.platform !== "win32") await chmod(join(dir, platform.binary), 0o755);
console.log("Installed checksum-verified SeaweedFS 4.48 in ignored .local/bin.");
