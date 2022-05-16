dict = {}

for (let entry of temp1) {
  if (dict[entry.t]) {
    dict[entry.t].push(entry);
  } else {
    dict[entry.t] = [entry];
  }
}

Object.values(dict).sort((a, b) => b.length - a.length);
