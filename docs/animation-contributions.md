# Animation contributions

[Project home](../README.md) · [项目中文介绍](../README.zh-CN.md)

White Dragon Girl has 23 chibi clips, covering core interactions, work states and everyday gestures. Recent additions include spellbook reading, hugging a gem, a cushion break, a star-cookie snack, wing fanning, a wave, a ticklish shrug and wing-assisted steps. There are five click reactions and two walking actions. Balance and chatter events reuse suitable clips; shared entries are labelled in the right-click menu.

Curly the sheep has seven transparent clips: breathing, walking, a cheerful response, thinking, typing, waiting, and waving. Success shares the cheerful response; errors and low-quota states share thinking.

We welcome new gestures and improvements to existing clips. A small action that suits the character is a good place to start.

Open an [Issue](https://github.com/Wxy545/codex-pet/issues) with a preview before making a full set. The maintainer reviews the source and permissions, adapts the clip, and checks its playback in the pet on Windows.

## What to send

- A small preview and the intended action, character, duration, and loop/one-shot behavior.
- The original source and the artist or rights holder. For generated work, include the tool/model, your prompt, and the origin and permission of every reference image.
- Permission for this project to distribute and adapt the clip, plus any attribution, noncommercial, or other restrictions.
- The original export if available. Share large files through a download link; keep personal information out of the archive.

White Dragon Girl clips are now included with the creator's permission; see the character's [asset notice](../assets/white-dragon/NOTICE.md). For new characters or reference art, include permission covering this project's use and distribution.

Curly's AI-created reference was provided by Wxy545 with permission to use and distribute it in Codex Pet. Her [asset notice](../assets/curly-sheep/NOTICE.md) records the tools and terms.

## Clip format

| Item | Target |
| --- | --- |
| Runtime delivery | Transparent WebM, preferably VP9 with alpha; no audio |
| Working source | Keep the original video; a uniform green background throughout the shot is useful for keying |
| Camera | One character, fixed full-body camera, stable scale and feet position |
| Framing | Keep all of the character's features in view, including ears, horns, hair, wings or tail when present, hands, feet, and props; leave room for motion |
| Canvas | Keep each clip's canvas fixed and align body scale and foot anchors across clips; wider actions can use extra transparent padding |
| Frame rate | Constant frame rate; state the actual rate and avoid timing changes during conversion |
| Loop | Idle/walk/work loops should return to their starting pose without a visible jump |
| One-shot | Click, success, and error should start and end in a usable neutral pose |
| Background | Real alpha for the runtime file; keep the source background fixed and remove colored fringes, floor, captions, and watermarks |

Start with a 4-second source clip. Use a longer clip when the gesture needs more time; a short loop can be trimmed from it after the join is checked.

The current character set focuses on chibi animations.

For a first/last-frame video, check the actual input image before submitting: use the intended pose, keep the ears, horns, hair, feet, any wings or tail, and props visible, and leave at least 20% clear space on each side for a small gesture. Put held objects or a desk in the reference itself. Fix the canvas before generating. In the current MiniMax Design H3 first/last-frame mode, the frame images determine the aspect ratio; check its live contract before adding an aspect-ratio parameter.

## Review before merge

The maintainer checks permission and attribution, then transparency, full-body framing, identity consistency, timing, loops, transitions, and playback in the pet. Walk loops need a continuous gait through the join; click and greeting clips need a clear entrance and return pose. A clip with changing background colors, deformed horns or tail, or hands passing through props needs fixing before it can be included.

Code and documentation use MIT. Third-party assets keep their own licenses; do not label a contributed character or animation MIT unless the rights holder has granted that license.

## 中文投稿要点

先开 Issue 附小预览、动作名称、时长和来源许可，再决定是否做整套。最终素材需要实际透明通道，并检查循环、动作衔接和 Windows 播放。保留绿底源视频，背景整段使用同一纯色，后期再抠像。

白龙娘已有 23 段 Q 版视频，点击回应共五种、走位两种；卷卷小羊有 7 段透明视频，覆盖待机、行走、开心回应、思考、打字、等待和招呼。小羊的完成状态共用开心回应，出错和低额度共用思考。角色来源与许可分别见[白龙娘](../assets/white-dragon/NOTICE.md)和[卷卷小羊](../assets/curly-sheep/NOTICE.md)的素材说明。

生成前先看首尾图：姿势、手持道具或工作桌已经到位，呆毛、耳、角、鞋、角色原有的翼尾和道具完整，每边至少留 20% 空白。先修构图，再提交视频。当前 MiniMax Design 的 H3 首尾帧模式继承图片本身比例，参数以实时模型合约为准。行走循环要保留连续步态，点击和招呼要保留进入与回原姿态的过程；出现彩色背景变化、角尾变形或手部穿模时，修好后再投稿。
