import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { detectPackLocale, seedHarnessPack } from './pack.mjs';
import { prepareHarnessDependency } from './motion-fix.mjs';
import { prepareHarnessBalance } from './native-balance.mjs';
import { prepareHarnessRemoteState, installHarnessRemoteState } from './native-remote-state.mjs';
import { prepareHarnessTasks, installHarnessTasks } from './native-tasks.mjs';

export const name = 'codex-pet-harness';
export const inject = ['profileContext'];

export function refreshHarnessClientModules(ctx) {
  return ctx.inject(['clientModules'], child => { child.clientModules.rebuilt('dsh-pet'); });
}

export function apply(ctx, config = {}) {
  const locale = detectPackLocale(config.locale);
  const sourceRoot = dirname(fileURLToPath(import.meta.url));
  const motion = prepareHarnessDependency({ profileDir: ctx.profileContext.dir });
  const balance = prepareHarnessBalance({ profileDir: ctx.profileContext.dir, sourceRoot, locale,withTasks:true });
  const remote = prepareHarnessRemoteState({ profileDir: ctx.profileContext.dir });
  installHarnessRemoteState(ctx,{sourceRoot,locale});
  const tasks=prepareHarnessTasks({profileDir:ctx.profileContext.dir});
  installHarnessTasks(ctx,{locale});
  // 模块服务可晚于种类包启动；按真实服务生命周期刷新本次修改的网页缓存。
  if (motion.files.includes('lib/client.js') || balance.files.includes('lib/client.js')) {
    refreshHarnessClientModules(ctx);
  }
  const result = seedHarnessPack({ sourceRoot, dshHome: ctx.profileContext.home, locale });
  // 提供服务后才让 dsh-pet apply，避免首次启动扫描到半个素材包。
  ctx.provide('codexPetDragonPack', { ...result, motion, balance, remote, tasks });
  if (result.preserved.length) console.warn('[codex-pet-harness] Kept customized files: ' + result.preserved.join(', '));
}
