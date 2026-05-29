# tea-data

`tea-data` contains supporting dictionary datasets used by the Tea package. It builds consolidated Chinese dictionary partitions from several upstream sources and stores them as JSON/data files for runtime consumption.

## Contents

- `cedict_ts.u8` - CC-CEDICT source dictionary export
- `cccedict-canto-readings-150923.txt` - Cantonese readings table
- `cccanto-webdist.txt` - Additional Cantonese web dictionary entries
- `wordlist.txt` - HSK wordlist and level annotations
- `dict.json` / `partitions.json` - generated artifact files (JSON dictionary partitions)
- `generate.ts` / `generate.js` - dictionary loading and partition generation
- `scripts/update-cedict-partitions.ts` - script to refresh CC-CEDICT source
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

- loading local dictionary inputs (`cedict_ts.u8`, `cccedict-canto-readings-150923.txt`, `cccanto-webdist.txt`, `wordlist.txt`)
- parsing and normalizing entries
- augmenting missing Jyutping data from Cantonese sources when possible
- merging duplicate `(traditional, simplified)` entries
- splitting entries by HSK level into partition buckets

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

## License

This repository is MIT licensed. Source dictionaries and data files may have their own upstream licensing and usage terms.
