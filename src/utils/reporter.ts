import fs from 'node:fs/promises';
import path from 'node:path';

export async function saveQaResult(data: unknown, fileName: string) {
  const outDir = path.join(process.cwd(), 'qa-results');
  await fs.mkdir(outDir, { recursive: true });

  const fullPath = path.join(outDir, fileName);
  await fs.writeFile(fullPath, JSON.stringify(data, null, 2), 'utf8');

  return fullPath;
}