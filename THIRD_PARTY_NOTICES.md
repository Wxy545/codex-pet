# 第三方来源与许可

本文记录 codex-pet 使用的主要第三方来源与许可边界，由项目维护者随依赖和分发方式更新。适用范围为本仓库及其运行时准备流程；核对日期为 2026-10-29。

根目录 [LICENSE](LICENSE) 只适用于本项目自有代码与文档，不替代第三方软件、角色或素材的许可。安装依赖、公开源代码与分发成品时，都应保留所用第三方内容要求的版权和许可说明。

## dsh-pet 代码

- 原仓库：[PC2005-cloud/dsh-pet](https://github.com/PC2005-cloud/dsh-pet)
- 本项目使用版本：npm 包 `dsh-pet@0.3.8`，由 `package-lock.json` 锁定。
- 代码许可：[MIT](https://github.com/PC2005-cloud/dsh-pet/blob/main/LICENSE)。
- 本项目保留原角色、动画播放、物理互动和菜单实现，并增加 Codex 宿主、事件聚合、额度接入、CLI 聊天、通知及兼容性检查。`scripts/prepare-runtime.mjs` 对已安装的固定版本生成适配入口和局部补丁。

上游 MIT 许可全文如下，版权归属保持原样：

```text
MIT License

Copyright (c) 2026 PC2005-cloud

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## dsh-pet 动画、提示词与源视频

上游 [README 的许可说明](https://github.com/PC2005-cloud/dsh-pet#许可) 将代码与素材分开：代码采用 MIT；动画、提示词、源视频允许开源使用，禁止商用。上游还要求公开的衍生、改版或换皮作品注明其 GitHub 仓库地址。本项目保留该来源声明，不将素材归入自有代码的 MIT 许可。

原素材通过 npm 依赖取得；本仓库不直接提交 `node_modules/` 或另行打包、重新授权原素材。若后续制作含第三方素材的安装包或其他分发形式，仍须保留原来源与适用条件，不能因它们来自依赖包而省略许可说明。

## 蓝色大肥鱼角色形象

| 内容 | 来源 |
| --- | --- |
| 原型“溟月” | [上善无形](https://space.bilibili.com/4456176) |
| DeepSeek 版女仆鲸鱼娘设计 | [ZipZipPipe](https://space.bilibili.com/4168597) |
| 桌宠动画与运行实现 | [PC2005-cloud/dsh-pet](https://github.com/PC2005-cloud/dsh-pet) |
| Codex 接入与本项目适配 | codex-pet contributors |

上游 README 标明角色为社区二创形象，并链接了 ZipZipPipe 于 2026-09-20 发布的[形象使用声明](https://www.bilibili.com/opus/1247156596114456581)。该声明采用 [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/)：署名、非商业、相同方式共享。使用或改编角色材料时，应提供适当署名和协议链接，注明修改，并按该协议要求分享改编材料。

角色形象的 CC 许可与上游素材的非商用说明分别保留；本项目不据此推定其他第三方内容也适用同一协议，也不代表原作者或 DeepSeek 为本项目背书。

## 白龙娘角色与动画

角色参考图署名为小红书号 **233534463**。原作者已同意本项目使用白龙娘形象并公开发布。内置的 23 段 Q 版视频由本项目使用 MiniMax H3 生成，再完成剪辑、循环处理和透明抠像；其中 10 段覆盖核心动作，另有整理龙翼、抱尾小憩、掌心微光、害羞卷尾、叉腰得意、吃星形饼干、扇翼纳凉、招手眨眼、怕痒缩肩、振翼踏步、坐垫歇息、抱书阅读和护住小宝石。工作与结果状态共用打字视频。护宝石片的盘尾以同片正确首帧做局部视频合成，保留原手部、宝石与眼神动作。

角色及素材许可与项目代码的 MIT 许可分开，详见 [assets/white-dragon/NOTICE.md](assets/white-dragon/NOTICE.md)。本项目的 Codex 桌宠和 DeepSeek Harness 角色插件使用同一套 Q 版素材，并保留该说明。

姐姐形象用于独立启动电影；新的关键画面由本项目根据获授权的形象生成，再经 MiniMax H3 制作连续角色镜头。软件窗口、揭幕和声音由本项目合成，不使用参考项目的视频或音轨。电影素材的单独说明见 [assets/startup/NOTICE.md](assets/startup/NOTICE.md)。桌宠角色仍为 Q 版。

## 启动动画实现参考

启动动画方案参考 [884048454/codex-startup-animation](https://github.com/884048454/codex-startup-animation) 的 Windows 进程监听、独立覆盖窗口和演出结束后交还应用窗口的做法。

该项目自有代码采用 [MIT](https://github.com/884048454/codex-startup-animation/blob/main/LICENSE)，版权声明为 `Copyright (c) 2026 Codex Startup Animation contributors`。纳入或修改其代码时须保留该版权声明与完整许可证；参考实现不代表原作者为本项目背书。

该项目的动画页面另基于沈宏宏的 [dsh-startup-screen](https://github.com/6shenhonghong9/dsh-startup-screen)，来源与许可见其 [NOTICE.md](https://github.com/884048454/codex-startup-animation/blob/main/NOTICE.md) 和 [DSH-LICENSE.txt](https://github.com/884048454/codex-startup-animation/blob/main/DSH-LICENSE.txt)。采用相关页面或样式时，也须保留这层上游署名与许可。

其安装器下载的第三方配音和音效不属于代码的 MIT 授权范围。本项目不会将这些声音视为已获授权的素材，新增演出使用自制或取得明确授权的声音。

本次启动窗口交接还参考了 [yushua0808-cpu/dragon-codex-boot](https://github.com/yushua0808-cpu/dragon-codex-boot)（核对提交 `c63a203e5857e85fb3c8a9891eddb570e7a27b54`）等待真实主窗口、按目标屏幕播放和结束后交还焦点的做法。其代码采用 MIT，版权声明为 `Copyright (c) 2026 Dragon Codex Boot contributors`；媒体另有说明。本项目独立实现接线与页面，不复制其代码、视频、角色或声音，不接管快捷方式。

桌宠交互参考 [jingh12312-rgb/bailong-desktop-pet](https://github.com/jingh12312-rgb/bailong-desktop-pet) 的公开说明及 v0.4.1 随包源码。该源码和素材没有另授开放许可，本项目仅借鉴交互思路，未纳入其代码、美术或声音；截图与新版发布说明不作为本项目已经支持某项功能的依据。

## 其他依赖

传递依赖、Electron、字体及其他随依赖安装的内容，按其各自随包提供的许可使用。`package-lock.json` 记录实际依赖版本；本项目不替代这些权利人的许可，也不将它们统一重新授权为 MIT。更改依赖或制作二进制分发包时，应重新核对实际纳入的第三方内容。
