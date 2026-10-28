function once(source, anchor, replacement, label) {
  if (source.split(anchor).length !== 2) throw new Error(`启动演出${label}定位失败。`);
  return source.replace(anchor, replacement);
}
const trayPets = `pets.map((pet) => ({
          label: pet.name || pet.id,
          type: 'checkbox',
          checked: isDesktopDisplay(pet.display),
          click: () => traySetPetDisplay(pet.id, toggleDisplay(pet.display)),
        })),`;
const hook = `// codex-startup-main-v1
const codexStartup = require('./codex-startup.cjs').install({
  hostRequest: codexPanelRequest, dataRoot: process.env.DSH_HOME, disabled: DPI_PROBE,
  onPetEnabled: enabled => {
    if (enabled) { if (!windows.size) createPetWindows(); }
    else { for (const win of [...windows.values()]) if (!win.isDestroyed()) win.destroy(); }
  },
  onModeChanged: async () => { if (tray) { tray.destroy(); tray = null; } await startTray(); },
});
// codex-startup-main-end`;

/** 只在原宿主的建窗与托盘入口接线；动画、物理、显示配置不改。 */
export function patchStartupMain(input) {
  let source = input.replaceAll('\r\n', '\n');
  const gate = "function createPetWindows() {\n  // codex-startup-pet-gate-v1\n  if (!codexStartup.petEnabled()) return;";
  if (!source.includes(gate)) source = once(source, 'function createPetWindows() {', gate, '宠物建窗');
  const keepAlive = '// 仅演出模式允许空窗；托盘异步重建时也保持宿主常驻。\n  if (tray || !codexStartup.petEnabled()) return;';
  if (!source.includes(keepAlive)) source = once(source, 'if (tray) return;\n  app.quit();', keepAlive + '\n  app.quit();', '空窗常驻');
  if (!source.includes('...codexStartup.trayItems()')) source = once(source, trayPets, `[...${trayPets.slice(0, -1)}, { type: 'separator' }, ...codexStartup.trayItems()],`, '托盘');
  if (source.includes('// codex-startup-main-v1')) {
    const pattern = /\/\/ codex-startup-main-v1[\s\S]*?\/\/ codex-startup-main-end/g;
    if ([...source.matchAll(pattern)].length !== 1) throw new Error('启动演出主进程定位失败。');
    source = source.replace(pattern, hook);
  } else source += '\n' + hook + '\n';
  return source;
}
