import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { detectPackLocale, seedHarnessPack } from './pack.mjs';
import { prepareHarnessDependency } from './motion-fix.mjs';
import { prepareHarnessBalance } from './native-balance.mjs';
import { prepareHarnessRemoteState, installHarnessRemoteState } from './native-remote-state.mjs';

export const name = 'codex-pet-harness';
export const inject = ['profileContext'];

export function apply(ctx, config = {}) {
  const locale = detectPackLocale(config.locale);
  const sourceRoot = dirname(fileURLToPath(import.meta.url));
  const motion = prepareHarnessDependency({ profileDir: ctx.profileContext.dir });
  const balance = prepareHarnessBalance({ profileDir: ctx.profileContext.dir, sourceRoot, locale });
  const remote = prepareHarnessRemoteState({ profileDir: ctx.profileContext.dir });
  installHarnessRemoteState(ctx,{sourceRoot,locale});
  // 模块服务可能已缓存旧client；只有本次修过web文件才刷新该包的已有缓存。
  if (motion.files.includes('lib/client.js') || balance.files.includes('lib/client.js')) ctx.get?.('clientModules')?.rebuilt?.('dsh-pet');
  const result = seedHarnessPack({ sourceRoot, dshHome: ctx.profileContext.home, locale });
  // 提供服务后才让 dsh-pet apply，避免首次启动扫描到半个素材包。
  ctx.provide('codexPetDragonPack', { ...result, motion, balance, remote });
  if (result.preserved.length) console.warn('[codex-pet-harness] Kept customized files: ' + result.preserved.join(', '));
}
