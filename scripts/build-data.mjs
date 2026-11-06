import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const data = JSON.parse(await fs.readFile(path.join(root, 'source/directory.json'), 'utf8'));
const ids = new Set();
for (const provider of data.providers) {
  if (!provider.id || ids.has(provider.id)) throw new Error('Provider IDs must be unique.');
  ids.add(provider.id);
  if (!provider.firstName || !Array.isArray(provider.locations)) throw new Error('A provider needs a name and locations.');
  for (const office of provider.locations) {
    if (!office.id || ids.has(office.id)) throw new Error('Location IDs must be unique.');
    ids.add(office.id);
    if (!office.address) throw new Error('A location needs an address.');
  }
}
await fs.writeFile(path.join(root, 'dist/data.js'), 'window.LFMM_REFERRAL_DATA = ' + JSON.stringify(data, null, 2) + ';\n');
console.log(`${data.providers.length} referral networks written.`);
