# Animation contributions

[Project home](../README.md) · [项目中文介绍](../README.zh-CN.md)

White Dragon Girl has 21 chibi clips, covering core interactions, work states and everyday gestures. Recent additions include a cushion break, a star-cookie snack, wing fanning, a wave, a ticklish shrug and wing-assisted steps. There are five click reactions and two walking actions. Balance and chatter events reuse suitable clips; shared entries are labelled in the right-click menu.

We welcome new gestures and improvements to existing clips. A small action that suits the character is a good place to start.

Open an [Issue](https://github.com/Wxy545/codex-pet/issues) with a preview before spending time on a full set. Offering a clip does not import it into the pet automatically; the maintainer still needs to review its rights, adapt it, and test it on Windows.

## What to send

- A small preview and the intended action, character, duration, and loop/one-shot behavior.
- The original source and the artist or rights holder. For generated work, include the tool/model, your prompt, and the origin and permission of every reference image.
- Permission for this project to distribute and adapt the clip, plus any attribution, noncommercial, or other restrictions.
- The original export if available. Share large files through a download link; keep personal information out of the archive.

White Dragon Girl clips are now included with the creator's permission; see the character's [asset notice](../assets/white-dragon/NOTICE.md). For new characters or reference art, include permission covering this project's use and distribution.

## Proposed delivery specs

These are production targets for review, not a promise that every file can already be imported.

| Item | Target |
| --- | --- |
| Runtime delivery | Transparent WebM, preferably VP9 with alpha; no audio |
| Working source | Keep the original video; a solid green-background source is useful for keying |
| Camera | One character, fixed full-body camera, stable scale and feet position |
| Framing | Leave room for horns, hair, wings, tail, hands, props, and motion; avoid clipped edges |
| Canvas | Keep each clip's canvas fixed and align body scale and foot anchors across clips; wider actions can use extra transparent padding |
| Frame rate | Constant frame rate; state the actual rate and avoid timing changes during conversion |
| Loop | Idle/walk/work loops should return to their starting pose without a visible jump |
| One-shot | Click, success, and error should start and end in a usable neutral pose |
| Background | Real alpha for the runtime file; no baked checkerboard, colored fringe, floor, captions, or watermark |

Start with a 4-second source clip. Use a longer clip when the gesture needs more time; a short loop can be trimmed from it after the join is checked.

The current character set focuses on chibi animations.

## Review before merge

The maintainer checks permission and attribution first, then transparency, framing, identity consistency, timing, loops, transitions, and runtime behavior. A four-pose atlas is a frame study; it is not a finished video animation. Passing a file check does not replace playback testing in the pet.

Code and documentation use MIT. Third-party assets keep their own licenses; do not label a contributed character or animation MIT unless the rights holder has granted that license.

## 中文投稿要点

先开 Issue 附小预览、动作名称、时长和来源许可，再决定是否做整套。最终素材需要实际透明通道，并验证循环、动作衔接和 Windows 播放。绿底源视频可以先保留，后期另做抠像。白龙娘已有 21 段 Q 版视频，覆盖核心互动、工作状态及日常动作；新增坐垫歇息、吃星形饼干、扇翼纳凉、招手眨眼、怕痒缩肩和振翼踏步。点击回应共五种，走位两种；余额与碎碎念复用合适视频，菜单标明共用。欢迎继续扩充符合龙娘性格的动作，角色素材许可见[说明](../assets/white-dragon/NOTICE.md)。投稿由维护者逐项适配。
