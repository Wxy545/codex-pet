import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { patchModularCanvas047, patchModularMenu047 } from '../harness/modular-runtime-fix.mjs';
import { readUpstream, upstreamVersion } from './support/harness-upstream.mjs';

const only047 = { skip: upstreamVersion !== '0.4.7' };

class MenuElement extends EventTarget {
  children = [];
  style = {};
  classList = new Set();
  offsetWidth = 100;
  offsetHeight = 50;

  appendChild(child) {
    this.children.push(child);
    child.parentElement = this;
  }

  querySelectorAll(selector) {
    return this.children.filter(child => '.' + child.className === selector);
  }

  getBoundingClientRect() {
    return { left: 0, top: 0, right: this.offsetWidth, bottom: this.offsetHeight };
  }

  remove() {
    this.parentElement.children = this.parentElement.children.filter(child => child !== this);
    this.parentElement = null;
  }
}

function loadMenu(source) {
  const start = source.indexOf('//#region src/shared/menu/mount.ts');
  const end = source.indexOf('//#endregion', start);
  assert.ok(start >= 0 && end > start);
  const document = Object.assign(new EventTarget(), {
    body: new MenuElement(),
    createElement: () => new MenuElement(),
  });
  return vm.runInNewContext(source.slice(start, end) + '\nmountContextMenu', {
    document,
    window: { innerWidth: 800, innerHeight: 600 },
    pickPanelPosition: () => ({ left: 0, top: 0 }),
  });
}

for (const name of ['runtime/electron-helper/shared-core.js', 'lib/client.js']) {
  test(name + ' 实际菜单移至叶子项时收起子菜单和后代，主菜单可继续操作', only047, () => {
    const raw = readUpstream(name);
    const patched = patchModularMenu047(raw);
    const leaf = { label: '招手', action: 'wave' };
    const actions = [];
    let closed = 0;
    const menu = loadMenu(patched)({
      tree: [{ label: '动作', children: [{ label: '问候', children: [leaf] }] }, leaf],
      x: 40, y: 40,
      onAction: node => actions.push(node),
      onClose: () => closed++,
    });
    const [root, child, grandchild] = menu.el.children;
    root.children[0].dispatchEvent(new Event('mouseenter'));
    child.children[0].dispatchEvent(new Event('mouseenter'));
    assert.equal(child.style.display, 'block');
    assert.equal(grandchild.style.display, 'block');

    root.children[1].dispatchEvent(new Event('mouseenter'));
    assert.equal(child.style.display, 'none');
    assert.equal(grandchild.style.display, 'none');
    assert.equal(root.style.display, 'block');
    assert.equal(closed, 0);

    root.children[0].dispatchEvent(new Event('mouseenter'));
    assert.equal(child.style.display, 'block');
    assert.equal(grandchild.style.display, 'none');
    root.children[1].dispatchEvent(new Event('click'));
    assert.equal(closed, 1);
    assert.deepEqual(actions, [leaf]);

    assert.equal(patchModularMenu047(patched), patched);
    assert.equal(patchModularMenu047(raw.replaceAll('\n', '\r\n')), patched.replaceAll('\n', '\r\n'));
    assert.throws(() => patchModularMenu047(raw + raw), /anchor-mismatch/);
    assert.throws(() => patchModularMenu047(patched.replace('if (prev) hideChain(prev);', 'if (prev) void prev;')), /anchor-mismatch/);
  });
}

test('047桌面画布原点与窗口内容区重合，原视频滤镜及其它样式保持原样', only047, () => {
  const raw = readUpstream('runtime/electron-helper/index.html');
  const fixed = patchModularCanvas047(raw);
  assert.match(fixed, /#root \{\n {8}position: absolute;\n {8}inset: 0;\n {6}\}/);
  const nativeRule = / {6}#root \{[^}]+\}/;
  assert.equal(fixed.replace(nativeRule, raw.match(nativeRule)[0]), raw);
  assert.equal(patchModularCanvas047(fixed), fixed);
  assert.equal(patchModularCanvas047(raw.replaceAll('\n', '\r\n')), fixed.replaceAll('\n', '\r\n'));
  assert.throws(() => patchModularCanvas047(raw + fixed), /anchor-mismatch/);
  assert.throws(() => patchModularCanvas047(fixed.replace('        inset: 0;', '        inset: 1px;')), /anchor-mismatch/);
});
