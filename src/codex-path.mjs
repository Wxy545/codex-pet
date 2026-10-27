import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import { isAbsolute, join, win32 } from 'node:path';

const EXPLICIT_ERROR = 'CODEX_PET_CLI 无效；请指定存在且可直接运行的 Codex CLI 绝对路径，Windows 需使用 .exe 文件。';
const NOT_FOUND_ERROR = '未找到可直接运行的 Codex CLI；请安装 Codex CLI，或用 CODEX_PET_CLI 指定可执行文件的绝对路径。';

export function locateCodex({ env = process.env, platform = process.platform, execFileSyncImpl = execFileSync, fsImpl } = {}) {
  const filesystem = fsImpl ? { ...fs, ...fsImpl } : fs;
  const windows = platform === 'win32';
  const absolute = windows ? win32.isAbsolute : isAbsolute;

  const executablePath = candidate => {
    if (typeof candidate !== 'string' || !absolute(candidate) || (windows && !/\.exe$/i.test(candidate))) return null;
    try {
      // realpath 与 stat 均需成功，避免选中已被更新程序删除的版本或目录。
      const real = filesystem.realpathSync(candidate);
      if (!absolute(real) || (windows && !/\.exe$/i.test(real)) || !filesystem.statSync(real).isFile()) return null;
      if (!windows) filesystem.accessSync(real, filesystem.constants.X_OK);
      return real;
    } catch {
      return null;
    }
  };

  // 显式配置错误应直接暴露，不能静默改用另一套 CLI。
  if (env.CODEX_PET_CLI !== undefined) {
    const explicit = executablePath(env.CODEX_PET_CLI);
    if (!explicit) throw new Error(EXPLICIT_ERROR);
    return explicit;
  }

  try {
    const output = execFileSyncImpl(windows ? 'where.exe' : 'which', [windows ? 'codex.exe' : 'codex'], {
      encoding: 'utf8', windowsHide: true, shell: false, env, timeout: 5000,
    });
    for (const candidate of String(output ?? '').split(/\r?\n/).map(line => line.trim()).filter(Boolean)) {
      const found = executablePath(candidate);
      if (found) return found;
    }
  } catch {
    // PATH 查询失败后继续检查桌面版安装目录，不向日志传出命令诊断或用户路径。
  }

  if (windows && typeof env.LOCALAPPDATA === 'string' && absolute(env.LOCALAPPDATA)) {
    const bin = join(env.LOCALAPPDATA, 'OpenAI', 'Codex', 'bin');
    let versions = [];
    try {
      versions = filesystem.readdirSync(bin, { withFileTypes: true }).flatMap(entry => {
        if (!entry.isDirectory()) return [];
        const directory = join(bin, entry.name);
        try {
          const stat = filesystem.statSync(directory);
          if (!stat.isDirectory()) return [];
          return [{ directory, name: entry.name, mtime: Number.isFinite(stat.mtimeMs) ? stat.mtimeMs : 0 }];
        } catch {
          return [];
        }
      });
    } catch {
      // 首装、卸载或更新中的目录可能不存在，统一交给最终错误提示。
    }
    versions.sort((left, right) => right.mtime - left.mtime || right.name.localeCompare(left.name));
    for (const version of versions) {
      const found = executablePath(join(version.directory, 'codex.exe'));
      if (found) return found;
    }
  }

  throw new Error(NOT_FOUND_ERROR);
}
