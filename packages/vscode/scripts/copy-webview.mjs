// Copies the diagram page built by @jpv/web into the extension, like buildWebview does for the IntelliJ plugin.
import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
mkdirSync(resolve(root, 'media'), { recursive: true });
copyFileSync(resolve(root, '../web/dist-embed/embed.html'), resolve(root, 'media/embed.html'));
copyFileSync(resolve(root, '../../LICENSE'), resolve(root, 'LICENSE'));
