'use strict';
const { readFile, writeFile, mkdir, rename, open } = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL, fileURLToPath } = require('node:url');
const { randomUUID } = require('node:crypto');
const A = require('./skin-actions.cjs');
const { readCharacter, characterCopy } = require('./codex-character.cjs');
const L = require('./codex-locale.cjs');
const CHARACTERS = [{ id: 'white-dragon', label: '白龙娘', originalVideo: false }, { id: 'bluefish', label: '大肥鱼', originalVideo: true }, { id: 'curly-sheep', label: '卷卷', originalVideo: false }];
const knownCharacter = value => value && CHARACTERS.some(character => character.id === value.character);
const validSelection = value => knownCharacter(value) && value.mode === 'q';

async function saveJson(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(value, null, 2) + '\n', 'utf8');
  await rename(temporary, file);
}

async function pngAsset(directory, name) {
  const file = path.join(directory, name);
  let handle;
  try {
    handle = await open(file, 'r');
    const header = Buffer.alloc(24);
    const { bytesRead } = await handle.read(header, 0, header.length, 0);
    if (bytesRead !== 24 || !header.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return { available: false };
    const width = header.readUInt32BE(16); const height = header.readUInt32BE(20);
    if (!width || !height || width > 32768 || height > 32768) return { available: false };
    return { available: true, url: pathToFileURL(file).href, width, height };
  } catch { return { available: false }; }
  finally { await handle?.close().catch(() => {}); }
}

async function videoAsset(directory, name) {
  let handle;
  try {
    const file = path.join(directory, name);
    handle = await open(file, 'r');
    const header = Buffer.alloc(512);
    const { bytesRead } = await handle.read(header, 0, header.length, 0);
    const data = header.subarray(0, bytesRead);
    // 仅读取WebM容器头；实际解码由Electron完成，不把其他文件当成本地视频开放。
    if (!data.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3])) || !data.includes(Buffer.from([0x42, 0x82, 0x84, 0x77, 0x65, 0x62, 0x6d]))) return { available: false };
    return { available: true, type: 'video', url: pathToFileURL(file).href };
  } catch { return { available: false }; }
  finally { await handle?.close().catch(() => {}); }
}

function createSkinStore({ dataRoot, hostRequest, logger = console } = {}) {
  if (!dataRoot || !path.isAbsolute(dataRoot)) throw new Error('skin-data-root-required');
  const skinsRoot = path.join(dataRoot, 'skins');
  const selectionFile = path.join(skinsRoot, 'selection.json');
  let selection;
  let catalog;

  async function actionCatalog() {
    if (catalog) return catalog;
    if (typeof hostRequest !== 'function') return null;
    try {
      const response = await hostRequest('GET', '/dsh-pet-7340/config');
      if (response.status !== 200) return null;
      const config = JSON.parse(response.body);
      const animations = config.main?.animations ?? config.animations;
      if (!animations?.idle || !animations.moves) return null;
      catalog = A.catalogFromAnimations(animations);
      return catalog;
    } catch { return null; }
  }

  async function characterModel(character, entries) {
    const directory = path.join(skinsRoot, character.id);
    let input;
    try { input = JSON.parse(await readFile(path.join(directory, 'manifest.json'), 'utf8')); }
    catch (error) {
      if (error.code !== 'ENOENT') { logger.warn('[Codex Pet] '+L.t('形象清单无法读取，保留原版显示。')); return { ...character, available: { q: character.originalVideo }, invalidManifest: true, assets: {}, manifest: A.defaultManifest() }; }
    }
    let manifest;
    try { manifest = A.normalizeManifest(input); }
    catch { logger.warn('[Codex Pet] '+L.t('形象清单格式无效，保留原版显示。')); return { ...character, available: { q: character.originalVideo }, invalidManifest: true, assets: {}, manifest: A.defaultManifest() }; }
    const names = [...new Set(Object.values(manifest.profiles).map(profile => profile.file))];
    const images = await Promise.all(names.map(async name => [name, await (name.endsWith('.webm') ? videoAsset : pngAsset)(directory, name)]));
    const assets = Object.fromEntries(images);
    const q = character.originalVideo || A.profileReady(manifest.profiles.idle, assets);
    return { ...character, available: { q }, assets, manifest, coverage: entries ? {
      q: character.originalVideo ? { summary: { total: entries.length, dedicated: entries.length, shared: 0, missing: 0 }, originalVideos: true } : A.buildCoverage(entries, manifest, assets),
    } : null };
  }

  async function readModel() {
    const entries = await actionCatalog();
    const characters = await Promise.all(CHARACTERS.map(character => characterModel(character, entries)));
    const identity = readCharacter(dataRoot);
    for (const character of characters) {
      character.copy = characterCopy(character.id, identity.locale);
      character.label = character.copy.name;
      if (character.id === identity.id) character.copy = { ...character.copy, name: identity.name, persona: identity.persona };
    }
    if (!selection) {
      try {
        const saved = JSON.parse(await readFile(selectionFile, 'utf8'));
        // 旧选择仅迁移到同角色Q；旧素材留在磁盘，不再作为可选形态。
        if (knownCharacter(saved) && ['q', 'sister', 'occasional'].includes(saved.mode)) {
          selection = { character: saved.character, mode: 'q' };
          if (saved.mode !== 'q') await saveJson(selectionFile, { ...saved, mode: 'q' });
        }
      } catch (error) { if (error.code !== 'ENOENT') logger.warn('[Codex Pet] '+L.t('形象选择无法读取。')); }
      const preferred = process.env.CODEX_PET_HOST === 'workbuddy' ? 'curly-sheep' : 'white-dragon';
      selection ??= { character: characters.find(character => character.id === preferred)?.available.q ? preferred : 'bluefish', mode: 'q' };
    }
    const selected = characters.find(character => character.id === selection.character);
    // 已选素材被移走时明确回原视频，不写掉用户保存的选择，恢复文件后仍能切回。
    const effectiveSelection = selected?.available.q ? selection : { character: 'bluefish', mode: 'q' };
    const model = { schemaVersion: 1, locale: identity.locale, selection: effectiveSelection, requestedSelection: selection, characters, catalog: entries, catalogStatus: entries ? 'known' : 'unknown' };
    await saveJson(path.join(skinsRoot, 'coverage.json'), { schemaVersion: 1, catalogStatus: model.catalogStatus, total: entries?.length ?? null, characters: Object.fromEntries(characters.map(character => [character.id, character.coverage ?? null])) });
    return model;
  }

  async function select(value) {
    if (!validSelection(value)) throw new Error('invalid-skin-selection');
    const model = await readModel();
    if (!model.characters.find(character => character.id === value.character)?.available.q) throw new Error('skin-unavailable');
    const next = { character: value.character, mode: 'q' };
    await saveJson(selectionFile, { schemaVersion: 1, ...next });
    selection = next;
    return readModel();
  }

  return { readModel, select };
}

function trustedSender(event, rendererFile = path.join(__dirname, 'index.html')) {
  try {
    if (event.senderFrame && event.sender.mainFrame && event.senderFrame !== event.sender.mainFrame) return false;
    return fileURLToPath(event.sender.getURL()) === rendererFile;
  } catch { return false; }
}

function install({ hostRequest, dataRoot = process.env.DSH_HOME, electronApi, onSelectionChanged } = {}) {
  const { app, ipcMain, BrowserWindow } = electronApi ?? require('electron');
  const store = createSkinStore({ hostRequest, dataRoot });
  const get = async event => { if (!trustedSender(event)) throw new Error('skin-sender-denied'); return store.readModel(); };
  const select = async (event, value) => {
    if (!trustedSender(event)) throw new Error('skin-sender-denied');
    const previousCharacter = readCharacter(dataRoot).id;
    const model = await store.select(value);
    if (previousCharacter !== model.selection.character) {
      try {
        const cleared = await hostRequest('POST', '/dsh-pet-7340/bubble/clear?pet=main');
        if (cleared.status !== 200 || JSON.parse(cleared.body).ok !== true) throw new Error('unavailable');
      } catch { console.warn('[Codex Pet] '+L.t('旧角色气泡未能清除。')); }
    }
    for (const win of BrowserWindow.getAllWindows()) if (!win.isDestroyed() && trustedSender({ sender: win.webContents })) win.webContents.send('codex-skin:changed', model);
    await onSelectionChanged?.(model);
    return model;
  };
  ipcMain.handle('codex-skin:get', get);
  ipcMain.handle('codex-skin:select', select);
  app.once('before-quit', () => { ipcMain.removeHandler('codex-skin:get'); ipcMain.removeHandler('codex-skin:select'); });
  return store;
}

function installPreload() {
  const { contextBridge, ipcRenderer } = require('electron');
  contextBridge.exposeInMainWorld('codexSkins', {
    getState: () => ipcRenderer.invoke('codex-skin:get'),
    select: value => ipcRenderer.invoke('codex-skin:select', value),
    onChanged(callback) {
      const handler = (_event, model) => callback(model);
      ipcRenderer.on('codex-skin:changed', handler);
      return () => ipcRenderer.removeListener('codex-skin:changed', handler);
    },
  });
}

module.exports = { createSkinStore, trustedSender, install, installPreload };
