import { promises as fs } from 'fs';
import { spawn } from 'child_process';
const BUCKET_NAMES = {
    0: 'HSK 1',
    1: 'HSK 2',
    2: 'HSK 3',
    3: 'HSK 4',
    4: 'HSK 5',
    5: 'HSK 6',
    6: 'HSK 7-9',
};
function parseArgs(argv) {
    const args = {
        outPath: 'hsk-wordlist.json',
        layout: false,
        legacyWordlistPath: 'wordlist.txt',
        strict: false,
    };
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === '--pdf') {
            const value = argv[i + 1];
            if (!value) {
                throw new Error('--pdf requires a file path');
            }
            args.pdfPath = value;
            i++;
            continue;
        }
        if (arg === '--text') {
            const value = argv[i + 1];
            if (!value) {
                throw new Error('--text requires a file path');
            }
            args.textPath = value;
            i++;
            continue;
        }
        if (arg === '--out') {
            const value = argv[i + 1];
            if (!value) {
                throw new Error('--out requires a file path');
            }
            args.outPath = value;
            i++;
            continue;
        }
        if (arg === '--legacy') {
            const value = argv[i + 1];
            if (!value) {
                throw new Error('--legacy requires a file path');
            }
            args.legacyWordlistPath = value;
            i++;
            continue;
        }
        if (arg === '--report') {
            const value = argv[i + 1];
            if (!value) {
                throw new Error('--report requires a file path');
            }
            args.reportPath = value;
            i++;
            continue;
        }
        if (arg === '--layout') {
            args.layout = true;
            continue;
        }
        if (arg === '--strict') {
            args.strict = true;
            continue;
        }
        if (arg === '--help' || arg === '-h') {
            usage();
        }
    }
    if (!args.pdfPath && !args.textPath) {
        usage();
    }
    if (args.pdfPath && args.textPath) {
        throw new Error('--pdf and --text cannot be used together');
    }
    return args;
}
function usage() {
    console.log(`Usage:
  node extract-hsk-wordlist.js --pdf <path-to-pdf> [--out path] [--layout]
  node extract-hsk-wordlist.js --text <path-to-text> [--out path]

  Options:
  --pdf <path>    Input HSK syllabus PDF
  --text <path>   Input extracted PDF text (skip pdftotext)
  --out <path>    Output JSON file (default: hsk-wordlist.json)
  --report <path> Write quality report JSON
  --legacy <path> Legacy wordlist for diff checks (default: wordlist.txt)
  --layout        Use pdftotext -layout mode (fallback is -raw)
  --strict        Fail on low-quality parses
  --help          Show this message`);
    process.exit(1);
}
function normalizeHskWord(word) {
    return word
        .replace(/（[^）]*）/g, '')
        .replace(/\([^)]*\)/g, '')
        .replace(/…/g, '')
        .replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹]/g, '')
        .replace(/（[^）]*$/g, '')
        .replace(/）/g, '')
        .replace(/\d+$/g, '')
        .trim();
}
function parseHskLevelToken(levelToken) {
    const match = levelToken.match(/^(\d+)/);
    if (!match) {
        return undefined;
    }
    return Number(match[1]);
}
function canonicalHskBucket(level) {
    if (level >= 1 && level <= 6) {
        return level - 1;
    }
    if (level === 7 || level === 8 || level === 9) {
        return 6;
    }
    return undefined;
}
function parseHskText(rawText) {
    const byWord = new Map();
    const diagnostics = {
        totalRows: 0,
        candidateRows: 0,
        parsedRows: 0,
        skippedRows: 0,
        invalidSerialRows: 0,
        invalidLevelRows: 0,
        unsupportedLevelRows: 0,
        emptyWordRows: 0,
        duplicateRows: 0,
    };
    const rows = rawText.split(/\r?\n/);
    for (const row of rows) {
        const trimmed = row.trim();
        if (!trimmed) {
            diagnostics.skippedRows += 1;
            continue;
        }
        diagnostics.totalRows += 1;
        const parts = trimmed.split(/\s+/);
        if (parts.length < 3) {
            diagnostics.skippedRows += 1;
            continue;
        }
        const serial = Number(parts[0]);
        if (!Number.isFinite(serial) || !/^\d+$/.test(parts[0])) {
            diagnostics.invalidSerialRows += 1;
            continue;
        }
        diagnostics.candidateRows += 1;
        const levelToken = parts[1];
        if (!/^\d/.test(levelToken)) {
            diagnostics.invalidLevelRows += 1;
            continue;
        }
        const level = parseHskLevelToken(levelToken);
        if (level === undefined) {
            diagnostics.invalidLevelRows += 1;
            continue;
        }
        const bucket = canonicalHskBucket(level);
        if (bucket === undefined) {
            diagnostics.unsupportedLevelRows += 1;
            continue;
        }
        const normalizedWord = normalizeHskWord(parts[2]);
        if (!normalizedWord) {
            diagnostics.emptyWordRows += 1;
            continue;
        }
        const prevBucket = byWord.get(normalizedWord);
        if (prevBucket === undefined || bucket < prevBucket) {
            byWord.set(normalizedWord, bucket);
            diagnostics.parsedRows += 1;
        }
        else {
            diagnostics.duplicateRows += 1;
        }
    }
    const words = Array.from(byWord.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([word, h]) => ({ word, h }));
    return {
        words,
        count: byWord.size,
        parseDiagnostics: diagnostics,
    };
}
function parseLegacyWordlist(wordlist) {
    const lines = wordlist
        .split('\n')
        .filter((line) => !line.startsWith('#') && line.length > 0);
    const words = new Set();
    for (const line of lines) {
        if (/^\d/.test(line[0])) {
            const matches = line.match(/\d+ (.*)/)?.slice(1);
            if (!matches) {
                continue;
            }
            const rowWords = matches
                .flatMap((match) => match.split('｜'))
                .flatMap((match) => match.split('、'))
                .map((word) => normalizeHskWord(word))
                .filter((word) => word.length > 0);
            for (const word of rowWords) {
                words.add(word);
            }
            continue;
        }
    }
    return { words };
}
function calculateBucketCounts(words) {
    const counts = {};
    for (const item of words) {
        counts[item.h] = (counts[item.h] || 0) + 1;
    }
    return counts;
}
function compareWithLegacy(newWords, legacyWords) {
    if (!legacyWords) {
        return undefined;
    }
    const newWordSet = new Set(newWords.words.map((entry) => entry.word));
    const onlyInNew = [];
    const onlyInLegacy = [];
    for (const word of newWordSet) {
        if (!legacyWords.has(word)) {
            onlyInNew.push(word);
        }
    }
    for (const word of legacyWords) {
        if (!newWordSet.has(word)) {
            onlyInLegacy.push(word);
        }
    }
    const overlapCount = newWordSet.size - onlyInNew.length;
    return {
        onlyInNewCount: onlyInNew.length,
        onlyInLegacyCount: onlyInLegacy.length,
        overlapCount,
        onlyInNewSamples: onlyInNew.sort().slice(0, 40),
        onlyInLegacySamples: onlyInLegacy.sort().slice(0, 40),
    };
}
function printQualityReport(parsed, report) {
    console.log('HSK extraction quality report');
    console.log(`- unique entries: ${parsed.count}`);
    console.log(`- total rows scanned: ${report.parseDiagnostics.totalRows}`);
    console.log(`- candidate rows: ${report.parseDiagnostics.candidateRows}`);
    console.log(`- parsed/updated rows: ${report.parseDiagnostics.parsedRows}`);
    console.log(`- duplicates merged: ${report.parseDiagnostics.duplicateRows}`);
    console.log(`- skipped rows: ${report.parseDiagnostics.skippedRows}`);
    console.log(`- parse failures: ${report.parseDiagnostics.invalidSerialRows + report.parseDiagnostics.invalidLevelRows + report.parseDiagnostics.unsupportedLevelRows}`);
    const bucketCounts = report.bucketCounts;
    for (const [bucket, count] of Object.entries(bucketCounts).sort((a, b) => Number(a[0]) - Number(b[0]))) {
        const name = BUCKET_NAMES[Number(bucket)] || `bucket_${bucket}`;
        console.log(`- ${name} (${bucket}): ${count}`);
    }
    if (report.legacyDiff) {
        console.log(`- legacy overlap: ${report.legacyDiff.overlapCount}`);
        console.log(`- only in new: ${report.legacyDiff.onlyInNewCount}`);
        console.log(`- only in legacy: ${report.legacyDiff.onlyInLegacyCount}`);
        if (report.legacyDiff.onlyInNewSamples.length > 0) {
            console.log(`  only-in-new sample: ${report.legacyDiff.onlyInNewSamples.join(', ')}`);
        }
        if (report.legacyDiff.onlyInLegacySamples.length > 0) {
            console.log(`  only-in-legacy sample: ${report.legacyDiff.onlyInLegacySamples.join(', ')}`);
        }
    }
}
function buildQualityReport(parsed, args, legacyDiff) {
    const bucketCounts = calculateBucketCounts(parsed.words);
    return {
        generatedAt: new Date().toISOString(),
        source: {
            pdfPath: args.pdfPath,
            textPath: args.textPath,
            layout: args.layout,
            legacyWordlistPath: args.legacyWordlistPath,
        },
        outPath: args.outPath,
        parseDiagnostics: parsed.parseDiagnostics,
        bucketCounts,
        bucketNames: BUCKET_NAMES,
        duplicatesMerged: parsed.parseDiagnostics.duplicateRows,
        legacyDiff,
    };
}
function validateParsedQuality(parsed, strict = false) {
    const parseSuccessRate = parsed.parseDiagnostics.candidateRows > 0
        ? parsed.parseDiagnostics.parsedRows / parsed.parseDiagnostics.candidateRows
        : 0;
    const parseFailureRate = 1 - parseSuccessRate;
    if (strict) {
        if (parsed.count === 0) {
            throw new Error('Strict quality check failed: extracted 0 entries');
        }
        if (parseFailureRate > 0.7) {
            throw new Error(`Strict quality check failed: parse failure rate ${(parseFailureRate * 100).toFixed(2)}%`);
        }
    }
    if (parseFailureRate > 0.9) {
        console.warn(`Warning: parse failure rate is high (${(parseFailureRate * 100).toFixed(2)}%)`);
    }
}
async function extractPdfToText(pdfPath, layout = false) {
    return new Promise((resolve, reject) => {
        const args = [layout ? '-layout' : '-raw', pdfPath, '-'];
        const proc = spawn('pdftotext', args, { stdio: ['ignore', 'pipe', 'pipe'] });
        const stdout = [];
        let stderr = '';
        proc.stdout.on('data', (chunk) => {
            stdout.push(Buffer.from(chunk));
        });
        proc.stderr.on('data', (chunk) => {
            stderr += chunk.toString('utf8');
        });
        proc.on('error', (error) => {
            reject(new Error(`Failed to run pdftotext: ${error.message}`));
        });
        proc.on('close', (code) => {
            if (code !== 0) {
                reject(new Error(`pdftotext failed (exit ${code}): ${stderr || 'no stderr output'}`));
                return;
            }
            resolve(Buffer.concat(stdout).toString('utf8'));
        });
    });
}
async function extractHskWords(args) {
    let rawText;
    const source = {
        pdfPath: args.pdfPath,
        textPath: args.textPath,
        layout: args.layout,
    };
    if (args.textPath) {
        rawText = await fs.readFile(args.textPath, 'utf8');
    }
    else {
        rawText = await extractPdfToText(args.pdfPath, args.layout);
    }
    let parsed = parseHskText(rawText);
    if (parsed.count === 0 && args.pdfPath && !args.layout) {
        rawText = await extractPdfToText(args.pdfPath, true);
        parsed = parseHskText(rawText);
        source.layout = true;
    }
    if (parsed.count === 0) {
        throw new Error('No HSK rows parsed from input source');
    }
    let legacyDiff;
    if (args.legacyWordlistPath) {
        try {
            const legacyText = await fs.readFile(args.legacyWordlistPath, 'utf8');
            const legacy = parseLegacyWordlist(legacyText);
            legacyDiff = compareWithLegacy(parsed, legacy.words);
        }
        catch (error) {
            if (args.strict) {
                throw error;
            }
            console.warn(`warning: could not read legacy wordlist at ${args.legacyWordlistPath}`);
        }
    }
    validateParsedQuality(parsed, args.strict);
    const report = buildQualityReport(parsed, args, legacyDiff);
    const payload = {
        generatedAt: new Date().toISOString(),
        source,
        words: parsed.words,
    };
    await fs.writeFile(args.outPath, JSON.stringify(payload, null, 2), 'utf8');
    console.log(`Wrote ${parsed.count} entries to ${args.outPath}`);
    if (args.reportPath) {
        await fs.writeFile(args.reportPath, JSON.stringify(report, null, 2), 'utf8');
        console.log(`Wrote quality report to ${args.reportPath}`);
    }
    printQualityReport(parsed, report);
}
async function run() {
    const args = parseArgs(process.argv.slice(2));
    await extractHskWords(args);
}
run().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
});
//# sourceMappingURL=extract-hsk-wordlist.js.map