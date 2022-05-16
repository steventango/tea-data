import { promises as fs } from "fs";
import {performance} from 'perf_hooks';
import unicode_pinyin from './pinyin.js';

interface DICT_entry {
  t: string;
  s: string;
  p: Array<string>;
  j: Array<string>;
  h?: number;
  d: Array<string>;
}

class DICT {
  data: Promise<Array<DICT_entry> | undefined>;

  constructor() {
    this.data = this.load();
  }

  async load() {
    try {
      let t0 = performance.now();
      const [
        cedict_ts,
        cccedict_canto_readings,
        ccccanto_webdist,
        wordlist
      ] = await Promise.all([
        fs.readFile('cedict_ts.u8', 'utf8'),
        fs.readFile('cccedict-canto-readings-150923.txt', 'utf8'),
        fs.readFile('cccanto-webdist.txt', 'utf8'),
        fs.readFile('wordlist.txt', 'utf8')
      ]);
      let t1 = performance.now();
      console.log(`Loading data: ${Math.round(t1 - t0)} ms.`);
      t0 = performance.now();
      let data = cedict_ts
      .split('\n')
      .filter((line) => !line.startsWith('#'))
      .map((line) => this.parse_line(line))
      .filter((entry): entry is DICT_entry => entry !== null && entry !== undefined);

      data = data.concat(
        ccccanto_webdist
        .split('\n')
        .filter((line) => !line.startsWith('#'))
        .map((line) => this.parse_line(line))
        .filter((entry): entry is DICT_entry => entry !== null && entry !== undefined)
      );

      const augmented_data = new Map<string, DICT_entry>(
        cccedict_canto_readings
        .split('\n')
        .filter((line) => !line.startsWith('#'))
        .map((line) => this.parse_line(line))
        .filter((entry): entry is DICT_entry => entry !== null && entry !== undefined)
        .flatMap((entry) => this.augment_entries(entry))
        .map(entry => [entry.t, entry])
      );

      const hsk = wordlist
      .split('\n')
      .filter((line) => !line.startsWith('#') && line.length> 0)

      const hskMap = new Map<string, number>();

      let level = 0;
      for (const line of hsk) {
        if (/\d/.test(line[0])) {
          const matches = line.match(/\d+ (.*)/)?.slice(1);
          const words = matches!
          .flatMap((match: string) => match.split('｜'))
          .flatMap((match: string) => match.split('('))
          .flatMap((match: string) => match.split('、'))
          .map((word) => word.replace(')', '').trim());
          for (const match of words) {
            hskMap.set(match, level);
          }
        } else {
          level++;
        }
      }

      data = data.map((entry) => {
        if (entry.j.length === 0) {
          const augmented_entry = augmented_data.get(entry.t);
          if (augmented_entry) {
            entry.j = augmented_entry.j;
          } else {
            const j = [];
            let found = false;
            for (const p of entry.p) {
              const pinyin = p.split(' ');
              for (const [i, c] of Array.from(entry.t).entries()) {
                const augmented_entry = augmented_data.get(c);
                if (augmented_entry) {
                  j.push(augmented_entry.j);
                  found = true;
                } else {
                  if (pinyin[i] && pinyin.length === 1) {
                    j.push(pinyin[i]);
                  } else if (!/\p{Han}/.test(c)) {
                    j.push(c);
                  } else {
                    j.push('-');
                  }
                }
              }
            }
            if (found) {
              entry.j = [j.join(' ')];
            }
          }
        }
        const h = hskMap.get(entry.s);
        if (h) {
          entry.h = h;
        }
        return entry;
      });

      data = this.merge_duplicates(data);

      t1 = performance.now();
      console.log(`Processing data: ${Math.round(t1 - t0)} ms.`);
      console.log('Total entries: ' + data.length);
      return data;
    } catch (error) {
      console.error(error);
    }
  }

  parse_line(line: string) {
    const match = line.match(/([^ ]*?) ([^ ]*?) \[(.*?)\](?: \{(.*?)\})*(?: \/(.*)\/)*/);
    if (match) {
      return {
        t: match[1],
        s: match[2],
        p: [unicode_pinyin(match[3]).toLowerCase()],
        j: match[4] ? [match[4]] : [],
        d: match[5] ? match[5].split('/') : [],
      }
    }
  }

  augment_entries(entry: DICT_entry) {
    const result = [entry];
    for (const j of entry.j) {
    const jyutping = j.split(' ');
    const items = Array.from(entry.t).map((c, i) => ([c, jyutping[i]]));
    for (const [c, j] of items) {
      const new_entry = {
        t: c,
        s: entry.s,
        p: entry.p,
        j: [j],
        d: entry.d,
      };
      result.push(new_entry);
    }
  }
    return result;
  }

  merge_duplicates(data: DICT_entry[]) {
    const result = new Map<string, DICT_entry>();

    for (const entry of data) {
      const key = entry.t + entry.s;
      const e = result.get(key);
      if (e) {
        e.p = [...new Set([...e.p,...entry.p])].sort();
        e.j = [...new Set([...e.j,...entry.j])].sort();
        e.d = [...new Set([...e.d,...entry.d])].sort();
        result.set(key, e);
      } else {
        result.set(key, entry);
      }
    }

    return Array.from(result.values());
  }
}

async function generate() {
  const dict = new DICT();
  const data = await dict.data;

  const partitions = new Map<number, Array<DICT_entry>>();
  partitions.set(0, []);
  for (const entry of data!) {
    if (entry.h) {
      if (!partitions.has(entry.h)) {
        partitions.set(entry.h , [entry]);
      } else {
        partitions.get(entry.h)!.push(entry);
      }
    } else {
      partitions.get(0)!.push(entry);
    }
  }
  await fs.writeFile('partitions.json', JSON.stringify(Object.fromEntries(partitions.entries())));
}

generate();
