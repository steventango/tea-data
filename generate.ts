import { promises as fs } from 'fs';
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

interface HSK_wordlist_entry {
  word: string;
  h: number;
}

interface HSK_wordlist {
  words: Array<HSK_wordlist_entry>;
}

interface GenerateOptions {
  outPath: string;
  topicsPath?: string;
}

type TopicWordMap = Map<string, Set<string>>;

function normalizeHskWord(word: string) {
  return word
    .replace(/（[^）]*）/g, '')
    .replace(/\([^)]*\)/g, '')
    .replace(/（[^）]*$/g, '')
    .replace(/）/g, '')
    .replace(/…/g, '')
    .replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹]/g, '')
    .replace(/\d+$/g, '')
    .trim();
}

function parseHskJson(text: string) {
  const parsed: HSK_wordlist = JSON.parse(text);
  const hskMap = new Map<string, number>();
  if (!Array.isArray(parsed?.words)) {
    return hskMap;
  }

  for (const item of parsed.words) {
    if (!item || typeof item.word !== 'string' || typeof item.h !== 'number') {
      continue;
    }
    if (item.h === 0) {
      continue;
    }
    const word = normalizeHskWord(item.word);
    if (word.length > 0) {
      hskMap.set(word, item.h);
    }
  }
  return hskMap;
}

function isStringArray(value: unknown): value is Array<string> {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isTopicRecord(value: unknown): value is Record<string, Array<string>> {
  if (!isObject(value)) {
    return false;
  }

  for (const [topic, words] of Object.entries(value)) {
    if (typeof topic !== 'string' || !isStringArray(words)) {
      return false;
    }
  }

  return true;
}

function isTopicList(value: unknown): value is Array<{topic: string; words: Array<string>}> {
  if (!Array.isArray(value)) {
    return false;
  }

  return value.every((entry) => {
    return isObject(entry) && typeof entry.topic === 'string' && isStringArray(entry.words);
  });
}

function parseTopicsJson(text: string): TopicWordMap {
  const parsed: unknown = JSON.parse(text);
  const source: Record<string, Array<string>> = {};

  if (isTopicRecord(parsed)) {
    Object.assign(source, parsed);
  } else if (isObject(parsed) && isTopicRecord(parsed.topics)) {
    Object.assign(source, parsed.topics);
  } else if (isTopicList(parsed)) {
    for (const item of parsed) {
      source[item.topic] = item.words.slice();
    }
  } else {
    throw new Error('Invalid topics file. Expected object map, top-level `{ topics: { ... } }`, or array of `{ topic, words }`.');
  }

  const wordToTopics: TopicWordMap = new Map<string, Set<string>>();
  for (const [topic, words] of Object.entries(source)) {
    if (!topic.trim()) {
      continue;
    }
    for (const rawWord of words) {
      const normalizedWord = normalizeHskWord(rawWord);
      if (!normalizedWord) {
        continue;
      }
      const topics = wordToTopics.get(normalizedWord);
      if (topics) {
        topics.add(topic);
      } else {
        wordToTopics.set(normalizedWord, new Set([topic]));
      }
    }
  }

  return wordToTopics;
}

function getTopicsForEntry(entry: DICT_entry, wordToTopics: TopicWordMap): Array<string> {
  const result = new Set<string>();
  const sTopics = wordToTopics.get(entry.s);
  const tTopics = wordToTopics.get(entry.t);

  if (sTopics) {
    for (const topic of sTopics) {
      result.add(topic);
    }
  }

  if (tTopics) {
    for (const topic of tTopics) {
      result.add(topic);
    }
  }

  return Array.from(result);
}

function parseArgs(argv: string[]): GenerateOptions {
  const options: GenerateOptions = {
    outPath: 'partitions.json',
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];

    if (arg === '--out') {
      const value = argv[i + 1];
      if (!value) {
        throw new Error('--out requires a file path');
      }
      options.outPath = value;
      i++;
      continue;
    }

    if (arg === '--topics') {
      const value = argv[i + 1];
      if (!value) {
        throw new Error('--topics requires a file path');
      }
      options.topicsPath = value;
      i++;
      continue;
    }
  }

  return options;
}

function buildPartitionPayload(entries: Array<DICT_entry>, wordToTopics?: TopicWordMap) {
  const partitions = new Map<number, Array<DICT_entry>>();
  const topicPartitions = new Map<string, Array<DICT_entry>>();
  const hskTopicPartitions = new Map<number, Map<string, Array<DICT_entry>>>();

  partitions.set(0, []);

  for (const entry of entries) {
    const h = entry.h ?? 0;
    const bucket = partitions.get(h);
    if (!bucket) {
      partitions.set(h, [entry]);
    } else {
      bucket.push(entry);
    }

    if (!wordToTopics) {
      continue;
    }

    const topics = getTopicsForEntry(entry, wordToTopics);
    for (const topic of topics) {
      const topicBucket = topicPartitions.get(topic);
      if (!topicBucket) {
        topicPartitions.set(topic, [entry]);
      } else {
        topicBucket.push(entry);
      }

      let topicsByHsk = hskTopicPartitions.get(h);
      if (!topicsByHsk) {
        topicsByHsk = new Map<string, Array<DICT_entry>>();
        hskTopicPartitions.set(h, topicsByHsk);
      }

      const hskTopicBucket = topicsByHsk.get(topic);
      if (!hskTopicBucket) {
        topicsByHsk.set(topic, [entry]);
      } else {
        hskTopicBucket.push(entry);
      }
    }
  }

  const payload: Record<string, Array<DICT_entry>> = {};
  for (const [bucket, values] of partitions.entries()) {
    payload[String(bucket)] = values;
  }

  const withTopics = payload as PartitionPayload;
  if (wordToTopics && topicPartitions.size > 0) {
    withTopics._topics = {};
    for (const [topic, values] of topicPartitions.entries()) {
      withTopics._topics[topic] = values;
    }

    withTopics._hskTopics = {};
    for (const [bucket, topics] of hskTopicPartitions.entries()) {
      const byTopic: Record<string, Array<DICT_entry>> = {};
      for (const [topic, values] of topics.entries()) {
        byTopic[topic] = values;
      }
      withTopics._hskTopics[String(bucket)] = byTopic;
    }
  }

  return withTopics;
}

interface PartitionPayload {
  _topics?: Record<string, Array<DICT_entry>>;
  _hskTopics?: Record<string, Record<string, Array<DICT_entry>>>;
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
        hskWordlistJson
      ] = await Promise.all([
        fs.readFile('cedict_ts.u8', 'utf8'),
        fs.readFile('cccedict-canto-readings-150923.txt', 'utf8'),
        fs.readFile('cccanto-webdist.txt', 'utf8'),
        fs.readFile('hsk-wordlist.json', 'utf8').catch(() => '')
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

      const hskMap = hskWordlistJson
        ? parseHskJson(hskWordlistJson)
        : new Map<string, number>();

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
        const h = hskMap.get(entry.s) ?? hskMap.get(entry.t);
        if (h !== undefined) {
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
  const options = parseArgs(process.argv.slice(2));
  const dict = new DICT();
  const data = await dict.data;

  if (!data) {
    return;
  }

  let wordToTopics: TopicWordMap | undefined;
  if (options.topicsPath) {
    const topicsText = await fs.readFile(options.topicsPath, 'utf8');
    wordToTopics = parseTopicsJson(topicsText);
  }

  const partitions = buildPartitionPayload(data, wordToTopics);
  await fs.writeFile(options.outPath, JSON.stringify(partitions, null, 2), 'utf8');
}

generate();
