import { posix } from 'node:path';

const windowsSlashRE = /\\/g;
const isWindows = typeof process !== 'undefined' && process.platform === 'win32';

function slash(p)
{
  return p.replace(windowsSlashRE, '/')
}

export function normalizePath(id)
{
  return posix.normalize(isWindows ? slash(id) : id)
}