import { config } from 'dotenv';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
config({ path: resolve(projectRoot, '.env') });
await import(pathToFileURL(resolve(projectRoot, 'apps/connector/dist/server.js')).href);
