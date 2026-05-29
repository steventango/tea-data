import { createWriteStream } from 'fs';
import { promises as fs } from 'fs';
import { dirname, resolve } from 'path';
import { get as httpsGet } from 'https';
import { get as httpGet } from 'http';
const DEFAULT_HSK_PDF_URL = 'https://hsk.cn-bj.ufileos.com/3.0/%E6%96%B0%E7%89%88HSK%E8%80%83%E8%AF%95%E5%A4%A7%E7%BA%B21219.pdf';
function parseArgs(argv) {
    const args = {
        url: DEFAULT_HSK_PDF_URL,
        outPath: 'hsk-wordlist.pdf',
        force: false,
    };
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === '--url') {
            const value = argv[i + 1];
            if (!value) {
                throw new Error('--url requires a value');
            }
            args.url = value;
            i++;
            continue;
        }
        if (arg === '--out') {
            const value = argv[i + 1];
            if (!value) {
                throw new Error('--out requires a value');
            }
            args.outPath = value;
            i++;
            continue;
        }
        if (arg === '--force') {
            args.force = true;
            continue;
        }
        if (arg === '--help' || arg === '-h') {
            usage();
        }
    }
    return args;
}
function usage() {
    console.log(`Usage:
  node download-hsk-pdf.js [--url <url>] [--out <file>] [--force]

Options:
  --url <url>   Source PDF URL (default: official HSK 3.0 pdf)
  --out <path>  Destination file (default: hsk-wordlist.pdf)
  --force       Overwrite existing file
  --help        Show this message`);
    process.exit(1);
}
function getRequest(url, redirects = 0) {
    if (redirects > 5) {
        throw new Error('Too many redirects while downloading PDF');
    }
    return new Promise((resolve, reject) => {
        const transport = url.startsWith('https:') ? httpsGet : httpGet;
        const request = transport(url, (response) => {
            if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
                response.resume();
                const nextUrl = new URL(response.headers.location, url).toString();
                getRequest(nextUrl, redirects + 1).then(resolve).catch(reject);
                return;
            }
            if (response.statusCode !== 200) {
                response.resume();
                reject(new Error(`Download failed: ${response.statusCode} ${response.statusMessage}`));
                return;
            }
            resolve(response);
        });
        request.on('error', reject);
    });
}
async function downloadPdf(args) {
    const outPath = resolve(args.outPath);
    if (!args.force) {
        try {
            await fs.access(outPath);
            throw new Error(`Output already exists: ${outPath} (pass --force to overwrite)`);
        }
        catch (error) {
            if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
            }
            else if (error instanceof Error && error.message.startsWith('Output already exists')) {
                throw error;
            }
            else if (error) {
                throw error;
            }
        }
    }
    const response = await getRequest(args.url);
    await fs.mkdir(dirname(outPath), { recursive: true });
    await new Promise((resolve, reject) => {
        const stream = createWriteStream(outPath, { flags: args.force ? 'w' : 'wx' });
        response.pipe(stream);
        stream.on('error', (error) => {
            reject(error);
        });
        stream.on('finish', () => {
            resolve();
        });
    });
    console.log(`Downloaded ${args.url} -> ${outPath}`);
}
async function run() {
    const args = parseArgs(process.argv.slice(2));
    await downloadPdf(args);
}
run().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
});
//# sourceMappingURL=download-hsk-pdf.js.map