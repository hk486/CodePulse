import * as fs from "fs";
import * as path from "path";
import * as zlib from "zlib";
import { createReadStream, createWriteStream } from "fs";
import { Readable } from "stream";

/**
 * Folders that never carry source worth analysing. They are skipped when a
 * project is archived, which keeps the archive small and the analysis fast.
 */
export const IGNORED_DIRECTORIES = new Set([
  ".git",
  ".hg",
  ".svn",
  "node_modules",
  "bower_components",
  "vendor",
  "dist",
  "build",
  "out",
  "target",
  "coverage",
  ".next",
  ".nuxt",
  ".svelte-kit",
  ".turbo",
  ".cache",
  ".parcel-cache",
  ".gradle",
  ".idea",
  ".vscode",
  ".venv",
  "venv",
  "env",
  "__pycache__",
  ".pytest_cache",
  ".mypy_cache",
  ".ruff_cache",
  ".tox",
  "bin",
  "obj",
  "Pods",
  "DerivedData",
  ".terraform",
  ".dart_tool",
  ".stack-work",
  "elm-stuff",
]);

/** Files that are never worth archiving. */
export const IGNORED_FILES = new Set([
  ".DS_Store",
  "Thumbs.db",
  "npm-debug.log",
  "yarn-error.log",
  "pnpm-debug.log",
]);

const BLOCK_SIZE = 512;

/**
 * Build one tar header block.
 */
function tarHeader(name: string, size: number, mtime: Date, isDirectory: boolean): Buffer {
  const header = Buffer.alloc(BLOCK_SIZE);

  // The name is split between prefix and name for long paths
  let prefix = "";
  let fileName = name;
  if (Buffer.byteLength(name) > 100) {
    const cut = name.lastIndexOf("/", name.length - 100);
    if (cut > 0) {
      prefix = name.slice(0, cut);
      fileName = name.slice(cut + 1);
    } else {
      fileName = name.slice(0, 100);
    }
  }

  header.write(fileName, 0, 100, "utf-8");
  header.write(isDirectory ? "0000755" : "0000644", 100, 8, "utf-8");
  header.write("0000000", 108, 8, "utf-8"); // uid
  header.write("0000000", 116, 8, "utf-8"); // gid
  header.write(size.toString(8).padStart(11, "0") + "\0", 124, 12, "utf-8");
  header.write(Math.floor(mtime.getTime() / 1000).toString(8).padStart(11, "0") + "\0", 136, 12, "utf-8");
  header.write("        ", 148, 8, "utf-8"); // checksum placeholder
  header.write(isDirectory ? "5" : "0", 156, 1, "utf-8"); // type flag
  header.write("ustar\0", 257, 6, "utf-8");
  header.write("00", 263, 2, "utf-8");
  header.write("codepulse", 265, 32, "utf-8");
  header.write("codepulse", 297, 32, "utf-8");
  if (prefix) header.write(prefix, 345, 155, "utf-8");

  // The checksum is the sum of every header byte with the checksum field
  // treated as spaces.
  let checksum = 0;
  for (let i = 0; i < BLOCK_SIZE; i++) checksum += header[i];
  header.write(checksum.toString(8).padStart(6, "0") + "\0 ", 148, 8, "utf-8");

  return header;
}

/**
 * List the files of a directory that should be archived.
 */
export function collectFiles(root: string): string[] {
  const files: string[] = [];

  const walk = (dir: string, prefix: string) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (IGNORED_DIRECTORIES.has(entry.name)) continue;
        walk(path.join(dir, entry.name), prefix ? `${prefix}/${entry.name}` : entry.name);
      } else if (entry.isFile()) {
        if (IGNORED_FILES.has(entry.name)) continue;
        const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
        files.push(relative);
      }
    }
  };

  walk(root, "");
  return files.sort();
}

export interface ArchiveResult {
  /** The path of the created archive. */
  archivePath: string;
  /** How many files went into it. */
  fileCount: number;
  /** The size of the archive in bytes. */
  size: number;
}

/**
 * Create a gzipped tar archive of a folder using only Node built-ins, so the
 * CLI works on any machine without an external zip or tar binary.
 *
 * The archive is written to disk in a streaming fashion, so a large project
 * never has to fit in memory.
 */
export async function createArchive(
  root: string,
  targetPath: string
): Promise<ArchiveResult> {
  const files = collectFiles(root);

  // The tar stream is piped through gzip into the target file
  const gzip = zlib.createGzip({ level: 6 });
  // Every file adds listeners to the gzip stream
  gzip.setMaxListeners(0);
  const output = createWriteStream(targetPath);
  const write = (chunk: Buffer) =>
    new Promise<void>((resolve, reject) => {
      if (gzip.write(chunk)) resolve();
      else gzip.once("drain", resolve);
      gzip.once("error", reject);
    });

  /**
   * Copy one file into the archive without closing the gzip stream.
   */
  const appendFile = (absolute: string): Promise<void> =>
    new Promise<void>((resolve, reject) => {
      const source = createReadStream(absolute);
      source.on("error", reject);
      source.on("end", resolve);
      source.pipe(gzip, { end: false });
    });

  const done = new Promise<void>((resolve, reject) => {
    output.on("finish", () => resolve());
    output.on("error", reject);
    gzip.on("error", reject);
  });

  gzip.pipe(output);

  for (const relative of files) {
    const absolute = path.join(root, relative);
    let stat: fs.Stats;
    try {
      stat = fs.statSync(absolute);
    } catch {
      continue;
    }
    await write(tarHeader(relative, stat.size, stat.mtime, false));
    await appendFile(absolute);

    // The data of every entry is padded to a multiple of the block size
    const padding = (BLOCK_SIZE - (stat.size % BLOCK_SIZE)) % BLOCK_SIZE;
    if (padding > 0) await write(Buffer.alloc(padding));
  }

  // Two empty blocks mark the end of a tar archive
  await write(Buffer.alloc(BLOCK_SIZE * 2));
  gzip.end();
  await done;

  const size = fs.statSync(targetPath).size;
  return { archivePath: targetPath, fileCount: files.length, size };
}

/**
 * Create a readable stream of an archive, for uploading it.
 */
export function archiveStream(archivePath: string): Readable {
  return createReadStream(archivePath);
}
