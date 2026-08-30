import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = process.cwd();
const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as Record<
  string,
  unknown
>;
const failures: string[] = [];
const allowedFiles = new Set(['dist', 'README.md', 'LICENSE', 'SECURITY.md']);

if (!existsSync(join(root, 'bun.lock')) || statSync(join(root, 'bun.lock')).size === 0)
  failures.push('bun.lock is missing or empty');
if ((manifest.packageManager as string | undefined) !== 'bun@1.4.0')
  failures.push('packageManager must pin bun@1.4.0');
if (
  (manifest.publishConfig as { registry?: string } | undefined)?.registry !==
  'https://registry.npmjs.org'
)
  failures.push('publishConfig must use the npm registry');
if (JSON.stringify(manifest.files) !== JSON.stringify([...allowedFiles]))
  failures.push('files allowlist changed');

for (const section of ['dependencies', 'devDependencies'] as const) {
  for (const [name, version] of Object.entries(
    (manifest[section] as Record<string, string> | undefined) ?? {},
  )) {
    if (!/^\d+\.\d+\.\d+(?:-[\w.]+)?$/.test(version))
      failures.push(`${section}.${name} is not exactly pinned: ${version}`);
  }
}

for (const key of Object.keys((manifest.scripts as Record<string, string> | undefined) ?? {})) {
  if (['preinstall', 'install', 'postinstall', 'prepare', 'prepack', 'postpack'].includes(key))
    failures.push(`disallowed lifecycle script: ${key}`);
}

function visit(dir: string): void {
  for (const name of readdirSync(dir)) {
    const file = join(dir, name);
    const relativePath = relative(root, file);
    if (['node_modules', '.git'].includes(name)) continue;
    if (statSync(file).isDirectory()) visit(file);
    else if (/\.(?:ts|js|json|md)$/u.test(name)) {
      const text = readFileSync(file, 'utf8');
      if (/\b(?:sk-[A-Za-z0-9_-]{20,}|ya29\.[A-Za-z0-9._-]{20,})\b/u.test(text))
        failures.push(`possible credential in ${relativePath}`);
    }
  }
}
visit(join(root, 'src'));
visit(join(root, 'dist'));
if (failures.length)
  throw new Error(`Supply-chain verification failed:\n- ${failures.join('\n- ')}`);
console.log('Supply-chain verification passed.');
