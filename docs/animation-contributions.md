# Animation contributions

[Project home](../README.md) · [项目中文介绍](../README.zh-CN.md)

We welcome original video clips for a small core animation set: idle, turn, walk, drag response, click response, thinking, working, waiting, success, and error. Start with idle, walk, or click response.

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

先开 Issue 附小预览、动作名称、时长和来源许可，再决定是否做整套。最终素材需要实际透明通道，并验证循环、动作衔接和 Windows 播放。绿底源视频可以先保留，后期另做抠像。白龙娘已有 10 段 Q 版核心视频，后续动作可在此基础上扩充，角色素材许可见[说明](../assets/white-dragon/NOTICE.md)。投稿由维护者逐项适配。
