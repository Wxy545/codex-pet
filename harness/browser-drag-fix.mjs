// 从 PC2005-cloud/dsh-pet c58f018 择取浏览器捕获丢失后的鼠标松开兜底；不改桌面拖拽物理。
const count = (source, value) => source.split(value).length - 1;
function replaceOne(source, before, after) {
  const oldCount = count(source, before), newCount = count(source, after);
  if (newCount === 1 && oldCount === count(after, before)) return source;
  if (oldCount !== 1 || newCount !== 0) throw Error('harness-browser-drag-anchor-mismatch');
  return source.replace(before, after);
}
const DOWN = '\t\tconst handlePointerDown = (e) => {';
const SUPPORT = `		// codex-pet-browser-mouse-release-v1: 只在鼠标按下期间监听，回调读取本次渲染的收尾。
		const mouseReleaseRef = useRef(null);
		const releaseLatestRef = useRef(null);
		const clearMouseRelease = () => {
			const listener = mouseReleaseRef.current;
			mouseReleaseRef.current = null;
			if (listener) window.removeEventListener("mouseup", listener, true);
		};
		const armMouseRelease = (hit) => {
			clearMouseRelease();
			const listener = (event) => {
				// 以左键位是否已松开为准；左键松开时仍按右键也必须结束左拖拽。
				if ((event.buttons & 1) !== 0) return;
				releaseLatestRef.current?.({ hit, x: event.clientX, y: event.clientY });
			};
			mouseReleaseRef.current = listener;
			window.addEventListener("mouseup", listener, true);
		};
		useEffect(() => clearMouseRelease, []);
`;
const TOUCH = '\t\t\tif (e.pointerType !== "mouse" && e.pointerType !== "pen") {';
const ARM = '\t\t\tif (e.pointerType === "mouse") armMouseRelease(e.currentTarget);\n\t\t\telse clearMouseRelease();\n';
const RELEASE_BEFORE = '\t\tconst handlePointerUp = (e) => {\n\t\t\tconst d = dragRef.current;';
const RELEASE_AFTER = '\t\tconst settlePointerRelease = (point) => {\n\t\t\tclearMouseRelease();\n\t\t\tconst d = dragRef.current;\n\t\t\tconst wasActive = d.active;';
const CLICK = '\t\tconst handleClick = () => {';
const RELEASE_WRAPPER = '\t\treleaseLatestRef.current = settlePointerRelease;\n\t\tconst handlePointerUp = (event) => settlePointerRelease({ hit: event.currentTarget, x: event.clientX, y: event.clientY });\n';

export function patchBrowserMouseRelease(input) {
  if (typeof input !== 'string') throw Error('harness-browser-drag-anchor-mismatch');
  let source = input.replaceAll('\r\n', '\n');
  if (source.includes('// codex-pet-browser-mouse-release-v1:') && (
    count(source, '// codex-pet-browser-mouse-release-v1:') !== 1 || count(source, SUPPORT + DOWN) !== 1 ||
    count(source, ARM + TOUCH) !== 1 || count(source, RELEASE_AFTER) !== 1 || count(source, RELEASE_WRAPPER + CLICK) !== 1
  )) throw Error('harness-browser-drag-anchor-mismatch');
  source = replaceOne(source, DOWN, SUPPORT + DOWN);
  source = replaceOne(source, TOUCH, ARM + TOUCH);
  const oldCount = count(source, RELEASE_BEFORE), newCount = count(source, RELEASE_AFTER);
  if (oldCount === 0 && newCount === 1) {
    if (count(source, RELEASE_WRAPPER) !== 1 || count(source, SUPPORT) !== 1 || count(source, ARM) !== 1) throw Error('harness-browser-drag-anchor-mismatch');
    return source;
  }
  if (oldCount !== 1 || newCount !== 0 || count(source, CLICK) !== 1) throw Error('harness-browser-drag-anchor-mismatch');
  const start = source.indexOf(RELEASE_BEFORE), end = source.indexOf(CLICK, start);
  if (end < 0) throw Error('harness-browser-drag-anchor-mismatch');
  const before = source.slice(start, end);
  // 当前0.3.8收尾只读取事件的三个字段；若上游增加事件操作，必须重新审核，不能猜造事件对象。
  if (!before.endsWith('\t\t};\n') || count(before, 'e.currentTarget') !== 2 || count(before, 'e.clientX') !== 4 || count(before, 'e.clientY') !== 4) throw Error('harness-browser-drag-anchor-mismatch');
  let after = before.replace(RELEASE_BEFORE, RELEASE_AFTER).replaceAll('e.currentTarget', 'point.hit').replaceAll('e.clientX', 'point.x').replaceAll('e.clientY', 'point.y');
  const cleanupAnchor = 'point.hit.classList.remove("dragging");\n\t\t\tstopDragFollow();';
  if (count(after, cleanupAnchor) !== 1) throw Error('harness-browser-drag-anchor-mismatch');
  // 触屏长按菜单会先把active清掉，松手仍需清定时器与拖拽样式；只跳过重复运动结算。
  after = after.replace(cleanupAnchor, 'point.hit.classList.remove("dragging");\n\t\t\tif (!wasActive) return;\n\t\t\tstopDragFollow();');
  if (/\be\./.test(after)) throw Error('harness-browser-drag-anchor-mismatch');
  after += RELEASE_WRAPPER;
  return source.slice(0, start) + after + source.slice(end);
}
