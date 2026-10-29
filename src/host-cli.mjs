import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import Host from './pet-host.cjs';
const options = process.argv.slice(2);
if (options.length !== 2 || options[0] !== '--host' || !Host.validHost(options[1])) {
  throw new Error('usage: node src/host-cli.mjs --host codex|workbuddy');
}
console.log(JSON.stringify(Host.writeHost(resolve(fileURLToPath(new URL('../data/', import.meta.url))), options[1])));
