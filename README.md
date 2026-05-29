# tea-data

`tea-data` contains supporting dictionary datasets used by the Tea package. It builds consolidated Chinese dictionary partitions from several upstream sources and stores them as JSON/data files for runtime consumption.

## Contents

- `cedict_ts.u8` - CC-CEDICT source dictionary export
- `cccedict-canto-readings-150923.txt` - Cantonese readings table
- `cccanto-webdist.txt` - Additional Cantonese web dictionary entries
- `hsk-wordlist.json` - HSK wordlist and level annotations (generated from PDF extraction)
- `wordlist.txt` - legacy fallback source
- `partitions.json` - generated artifact file (JSON dictionary partitions)
- `generate.ts` / `generate.js` - dictionary loading and partition generation
- `scripts/update-cedict-partitions.ts` - script to refresh CC-CEDICT source
- `scripts/extract-hsk-wordlist.ts` / `scripts/extract-hsk-wordlist.js` - script to extract canonical HSK list from syllabus PDF
- `pinyin.ts` - helper utilities for pinyin tone normalization

## Prerequisites

- Node.js (TypeScript-compatible environment)
- npm

## Install

```bash
npm install
```

## Generate partition data

```bash
npm run start
```

This compiles TypeScript and writes the generated partition file (`partitions.json`) by:

- loading local dictionary inputs (`cedict_ts.u8`, `cccedict-canto-readings-150923.txt`, `cccanto-webdist.txt`, `hsk-wordlist.json`)
- parsing and normalizing entries
- augmenting missing Jyutping data from Cantonese sources when possible
- merging duplicate `(traditional, simplified)` entries
- splitting entries by HSK level into partition buckets

If `hsk-wordlist.json` is missing, generation falls back to `wordlist.txt`.

### Update HSK wordlist

Download the official PDF locally first:

```bash
npm run download:hsk-pdf -- --out /path/to/HSK30-2022.pdf
```

Then build the extracted JSON:

```bash
npm run update:hsk-wordlist -- --pdf <path-to-pdf> --out hsk-wordlist.json
```

The extractor parses HSK level annotations like `1`, `1（2）`, `2（7-9）`, `7-9` and strips disambiguator suffixes from words (e.g. `本1` -> `本`).

The generated extraction includes a quality report that summarizes:

- parse coverage and failure counts
- level bucket distribution
- deduplication behavior
- diff statistics versus `wordlist.txt` (or `--legacy <path>`)

Pass `--report <path>` only if you need a JSON report artifact.

Use `--strict` to fail the run on low-confidence parses.

## Update CC-CEDICT data

```bash
npm run update:cedict
```

Downloads the latest CC-CEDICT export from MDBG, validates entry formatting, and updates `cedict_ts.u8` when the upstream payload changes.

## Data model (high level)

Each generated entry includes:

- `t`: traditional form
- `s`: simplified form
- `p`: pinyin pronunciations (normalized tone marks)
- `j`: Cantonese/Jyutping readings
- `d`: definitions/annotations
- `h` (optional): HSK level bucket
