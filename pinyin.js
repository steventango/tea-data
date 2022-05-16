const pinyin_map = new Map([
    ['a1', 'ā'],
    ['a2', 'á'],
    ['a3', 'ǎ'],
    ['a4', 'à'],
    ['o1', 'ō'],
    ['o2', 'ó'],
    ['o3', 'ǒ'],
    ['o4', 'ò'],
    ['e1', 'ē'],
    ['e2', 'é'],
    ['e3', 'ě'],
    ['e4', 'è'],
    ['iu1', 'iū'],
    ['iu2', 'iú'],
    ['iu3', 'iǔ'],
    ['iu4', 'iù'],
    ['i1', 'ī'],
    ['i2', 'í'],
    ['i3', 'ǐ'],
    ['i4', 'ì'],
    ['u1', 'ū'],
    ['u2', 'ú'],
    ['u3', 'ǔ'],
    ['u4', 'ù'],
    ['ü1', 'ǖ'],
    ['ü2', 'ǘ'],
    ['ü3', 'ǚ'],
    ['ü4', 'ǜ']
]);
const pinyin_order = ['a', 'o', 'e', 'iu', 'i', 'u', 'u:'];
export default function unicode_pinyin(pinyin) {
    const out = [];
    for (let p of pinyin.split(' ')) {
        let last = p.charAt(p.length - 1);
        p = p.replace('u:', 'ü');
        if (/[12345]/.test(last)) {
            const tone = parseInt(last);
            p = p.substring(0, p.length - 1);
            if (tone !== 5) {
                for (let c of pinyin_order) {
                    if (p.includes(c)) {
                        p = p.replace(c, pinyin_map.get(`${c}${tone}`));
                        break;
                    }
                }
            }
        }
        out.push(p);
    }
    return out.join(' ');
}
//# sourceMappingURL=pinyin.js.map