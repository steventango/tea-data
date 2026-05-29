import { createHash } from 'crypto';
import { promises as fs } from 'fs';
import https from 'https';
import path from 'path';
import { createGunzip } from 'zlib';
import { IncomingHttpHeaders } from 'http';

const CEDICT_URL = 'https://www.mdbg.net/chinese/export/cedict/cedict_1_0_ts_utf-8_mdbg.txt.gz';
const CEDICT_ENTRY_PATTERN = new RegExp(String.raw`([^ ]*?) ([^ ]*?) \[(.*?)\](?: \{(.*?)\})*(?: \/(.*)\/)*`);

interface UpdateOptions {
  force: boolean;
  dryRun: boolean;
  workdir: string;
}

interface FetchResult {
  gzipped: Buffer;
  headers: IncomingHttpHeaders;
}

interface UpstreamMetadata {
  date: string;
  entries: number;
}

function hashBuffer(data: Buffer | string) {
  return createHash('sha256').update(data).digest('hex');
}

function parseArgs(argv: string[]): UpdateOptions {
  const options: UpdateOptions = {
    force: false,
    dryRun: false,
    workdir: process.cwd(),
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--force') {
      options.force = true;
      continue;
    }
    if (arg === '--dry-run') {
      options.dryRun = true;
      continue;
    }
    if (arg === '--workdir') {
      const value = argv[i + 1];
      if (!value) {
        throw new Error('--workdir requires a value');
      }
      options.workdir = path.resolve(process.cwd(), value);
      i += 1;
      continue;
    }
    if (arg.startsWith('--workdir=')) {
      options.workdir = path.resolve(process.cwd(), arg.slice('--workdir='.length));
      continue;
    }
    throw new Error(`Unknown option: ${arg}`);
  }

  return options;
}

function countEntries(text: string) {
  const entries = text
    .split('\n')
    .filter((line) => line.trim().length > 0 && !line.startsWith('#'));
  const invalid = entries.filter((line) => !CEDICT_ENTRY_PATTERN.test(line));
  if (invalid.length > 0) {
    throw new Error(`Invalid entry format detected (${invalid.length} lines)`);
  }
  return entries.length;
}

function readHeaderMetadata(lines: string[]) {
  const metadata = new Map<string, string>();
  const commentLines = lines.filter((line) => line.startsWith('#!'));

  for (const line of commentLines) {
    const match = line.match(/^#!\s*([^=]+?)\s*=\s*(.*)$/);
    if (match) {
      metadata.set(match[1].trim().toLowerCase(), match[2].trim());
    }
  }

  return metadata;
}

function parseUpstreamMetadata(text: string, headers: IncomingHttpHeaders): UpstreamMetadata {
  const lines = text.split('\n');
  const metadata = readHeaderMetadata(lines);
  const version = metadata.get('version');

  if (version && version !== '1') {
    throw new Error('Unexpected CC-CEDICT header format: unsupported version=' + version);
  }

  const date =
    metadata.get('date') ||
    metadata.get('generated') ||
    metadata.get('created') ||
    headers['last-modified']?.toString() ||
    headers['date']?.toString() ||
    'unknown';

  return { date, entries: countEntries(text) };
}

async function fetchCedictArchive(url: string, redirects = 0): Promise<FetchResult> {
  if (redirects > 5) {
    throw new Error('Too many redirects while fetching CC-CEDICT archive');
  }

  return new Promise((resolve, reject) => {
    const request = https.request(url, (response) => {
      if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        response.resume();
        const redirected = new URL(response.headers.location, url).toString();
        fetchCedictArchive(redirected, redirects + 1).then(resolve).catch(reject);
        return;
      }

      if (!response.statusCode || response.statusCode < 200 || response.statusCode >= 300) {
        response.resume();
        reject(new Error(`Failed to download archive: ${response.statusCode} ${response.statusMessage}`));
        return;
      }

      const chunks: Buffer[] = [];
      response.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
      response.on('end', () => {
        resolve({
          gzipped: Buffer.concat(chunks),
          headers: response.headers,
        });
      });
      response.on('error', reject);
    });

    request.on('error', reject);
    request.end();
  });
}

async function decompressGzip(payload: Buffer) {
  const chunks: Buffer[] = [];
  return new Promise<Buffer>((resolve, reject) => {
    const gunzip = createGunzip();
    gunzip.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    gunzip.on('error', reject);
    gunzip.on('end', () => {
      resolve(Buffer.concat(chunks));
    });
    gunzip.write(payload);
    gunzip.end();
  });
}

async function localHash(filePath: string) {
  try {
    const content = await fs.readFile(filePath);
    return { exists: true, hash: hashBuffer(content) };
  } catch {
    return { exists: false, hash: null };
  }
}

async function writeAtomic(targetPath: string, contents: string) {
  const tempPath = `${targetPath}.tmp-${Date.now()}`;
  await fs.writeFile(tempPath, contents, 'utf8');
  await fs.rename(tempPath, targetPath);
}

async function run() {
  const { force, dryRun, workdir } = parseArgs(process.argv.slice(2));
  const cedictPath = path.join(workdir, 'cedict_ts.u8');

  const result = await fetchCedictArchive(CEDICT_URL);
  const upstreamBytes = await decompressGzip(result.gzipped);
  const upstreamText = upstreamBytes.toString('utf8');
  const metadata = parseUpstreamMetadata(upstreamText, result.headers);

  const local = await localHash(cedictPath);
  const upstreamHash = hashBuffer(upstreamBytes);
  const unchanged = local.exists && local.hash === upstreamHash;

  console.log(`upstream date: ${metadata.date}`);
  console.log(`upstream entries: ${metadata.entries}`);

  if (dryRun) {
    return;
  }

  console.log(`downloaded bytes: ${upstreamBytes.length}`);
  console.log(`local hash match: ${unchanged ? 'yes' : 'no'}`);
  if (unchanged && !force) {
    console.log('update decision: no-op (no payload changes)');
    return;
  }

  await writeAtomic(cedictPath, upstreamText);
  console.log('update decision: wrote cedict_ts.u8');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
