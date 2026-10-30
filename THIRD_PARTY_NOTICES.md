# 第三方来源与许可

本文记录 codex-pet 使用的主要第三方来源与许可边界，由项目维护者随依赖和分发方式更新。适用范围为本仓库及其运行时准备流程；核对日期为 2026-10-31。

根目录 [LICENSE](LICENSE) 只适用于本项目自有代码与文档，不替代第三方软件、角色或素材的许可。安装依赖、公开源代码与分发成品时，都应保留所用第三方内容要求的版权和许可说明。

## dsh-pet 代码

- 原仓库：[PC2005-cloud/dsh-pet](https://github.com/PC2005-cloud/dsh-pet)
- 本项目使用版本：npm 包 `dsh-pet@0.3.8`，由 `package-lock.json` 锁定。
- 代码许可：[MIT](https://github.com/PC2005-cloud/dsh-pet/blob/main/LICENSE)。
- 本项目保留原角色、动画播放、物理互动和菜单实现，增加 Codex 与 WorkBuddy 宿主、事件聚合、Codex 额度和 CLI 聊天、通知及兼容性检查。`scripts/prepare-runtime.mjs` 对已安装的固定版本生成适配入口和局部补丁。

2026-10-30 从上游 [1f191657](https://github.com/PC2005-cloud/dsh-pet/commit/1f1916573b4cca13299aabcff5e748e4f9c6ba2a) 择取隐藏角色的自动碎念门控，未引入同次提交的语音协议。该代码沿用上游 MIT 许可与版权署名；角色、动画及提示词仍按下文各自条款处理。

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

## 卷卷小羊角色与动画

卷卷小羊 Curly 的 AI 参考图由 **Wxy545** 提供，并已授权本项目使用和公开分发。角色和动作参考图使用 OpenAI 图像生成工具制作，视频使用 MiniMax H3 生成，再剪辑并抠成透明动画。

内置 7 段透明动画：待机、侧向行走、开心回应、思考、打字工作、等待和招呼。出错与低额度状态共用思考视频。素材许可与代码的 MIT 许可分开，见 [assets/curly-sheep/NOTICE.md](assets/curly-sheep/NOTICE.md)。

## WorkBuddy 接入

WorkBuddy 接入使用用户本机 Windows 客户端提供的插件与 Hook 接口，目前适配 5.9.3。仓库提供桌宠侧接入代码与事件插件，安装方法及接口资料来源见 [workbuddy/README.md](workbuddy/README.md)。

积分查询的调查参考了 [zhujiaowo-sudo/workbuddy-desktop-pet](https://github.com/zhujiaowo-sudo/workbuddy-desktop-pet/tree/30749c66a28ffd2f52d03d6b416a4540d4e8486a) 和 [pigeon189/zcode-fox-widget 的 workbuddy 分支](https://github.com/pigeon189/zcode-fox-widget/tree/5456f05a9f9f887cfed01e3859c0f94f508874e3)。前者没有授予代码开源许可，本项目未复制其实现；后者代码采用 MIT，其记录的单次消耗和上下文余量不能当作 WorkBuddy 剩余积分。

本项目另行核对用户本机 WorkBuddy 5.9.3 的 WBIPC 和账单响应，独立实现固定的本机只读查询。仅在 WorkBuddy 模式使用本机通道票据完成双向认证，不读取或导出账号访问令牌。该通道随客户端版本变化，不视为腾讯提供了稳定的公开余额 API。

## QQ、OneBot 与 NapCat 接入

QQ 官方机器人连接使用用户申请的 QQ 开放平台机器人。普通 QQ 小号连接由本项目独立实现 [OneBot 11 正向 WebSocket 协议](https://github.com/botuniverse/onebot-11/blob/master/communication/ws.md)及其[鉴权约定](https://github.com/botuniverse/onebot-11/blob/master/communication/authorization.md)。OneBot 是协议，无需另外安装同名软件。

小号运行时来自 [NapNeko/NapCatQQ v4.18.42](https://github.com/NapNeko/NapCatQQ/tree/v4.18.42)，作者版权为 **Copyright © 2024 Mlikiowa**。本项目从[官方发布地址](https://github.com/NapNeko/NapCatQQ/releases/download/v4.18.42/NapCat.Shell.Windows.Node.zip)原样下载 `NapCat.Shell.Windows.Node.zip`，核对大小 `124162399` 字节和 SHA256 `77397ac38d66f46383e48f08f35d5f9d37ec575c22069f62d6c600e73b4521ed`，运行时保留来源清单与完整许可证。扫码接入方式参考了[官方创建机器人指南](https://napneko.github.io/NapCatQQ-Desktop/docs/first-bot/)。

NapCat 采用 [Limited Redistribution License for NapCat](https://github.com/NapNeko/NapCatQQ/blob/v4.18.42/LICENSE)，禁止商用，要求再分发时保留完整许可、来源与版权，且修改后的代码不得公开发布。本仓库只提供独立的协议适配与本机准备代码；NapCat 官方运行时在用户端另行下载，未纳入本项目的 MIT 授权，也不作为 MIT 安装包重新分发。包内 QQ、Node 及其他第三方组件仍遵循各自条款。

NapCat 许可证全文：

```text
Limited Redistribution License for NapCat

Copyright © 2024 Mlikiowa

1. Usage and Reproduction:
   - Unauthorized use, reproduction, modification, or distribution of this code is prohibited without explicit permission from the main author of the NapCat repository.

2. Redistribution:
   - Redistribution of this code is permitted, provided that the full text of this license is included, and the source and copyright information is clearly stated.
   - Minor modifications and extensions are allowed for redistribution purposes, but the modified code must not be publicly released.

3. Non-Commercial Use:
   - This code is not to be used for any commercial purposes.

4. Additional Permissions:
   - Any rights not explicitly addressed in this license must be requested from and granted by the main author of the NapCat repository.

5. Disclaimer:
   - This code is provided "as is," without any express or implied warranties, including but not limited to the implied warranties of merchantability and fitness for a particular purpose. In no event shall the author be liable for any damages or other liability arising from, out of, or in connection with the use or distribution of this code.
```

## 启动动画实现参考

启动动画方案参考 [884048454/codex-startup-animation](https://github.com/884048454/codex-startup-animation) 的 Windows 进程监听、独立覆盖窗口和演出结束后交还应用窗口的做法。

该项目自有代码采用 [MIT](https://github.com/884048454/codex-startup-animation/blob/main/LICENSE)，版权声明为 `Copyright (c) 2026 Codex Startup Animation contributors`。纳入或修改其代码时须保留该版权声明与完整许可证；参考实现不代表原作者为本项目背书。

该项目的动画页面另基于沈宏宏的 [dsh-startup-screen](https://github.com/6shenhonghong9/dsh-startup-screen)，来源与许可见其 [NOTICE.md](https://github.com/884048454/codex-startup-animation/blob/main/NOTICE.md) 和 [DSH-LICENSE.txt](https://github.com/884048454/codex-startup-animation/blob/main/DSH-LICENSE.txt)。采用相关页面或样式时，也须保留这层上游署名与许可。

其安装器下载的第三方配音和音效不属于代码的 MIT 授权范围。本项目不会将这些声音视为已获授权的素材，新增演出使用自制或取得明确授权的声音。

启动窗口交接与本地视频导入还参考了 [yushua0808-cpu/dragon-codex-boot](https://github.com/yushua0808-cpu/dragon-codex-boot)（核对提交 `c63a203e5857e85fb3c8a9891eddb570e7a27b54`）等待真实主窗口、按目标屏幕播放和结束后交还焦点的做法。其代码采用 [MIT](https://github.com/yushua0808-cpu/dragon-codex-boot/blob/main/LICENSE)，版权声明为 `Copyright (c) 2026 Dragon Codex Boot contributors`；媒体另有说明。本项目独立实现接线与页面，不复制其代码、视频、角色或声音，不接管快捷方式。

本地视频库、解码检查、过渡与超时退出的设计参考了 [linke-e/dsh-opening-animation](https://github.com/linke-e/dsh-opening-animation)。其代码采用 [MIT](https://github.com/linke-e/dsh-opening-animation/blob/main/LICENSE)，版权声明为 `Copyright (c) 2026 dsh-opening-animation contributors`。本项目仅借鉴实现思路，视频管理、探针与播放器独立编写，未复制该项目源码或素材。用户自行导入的视频只保存在本机，不纳入本仓库分发。

桌宠交互参考 [jingh12312-rgb/bailong-desktop-pet](https://github.com/jingh12312-rgb/bailong-desktop-pet) 的公开说明及 v0.4.1 随包源码。该源码和素材没有另授开放许可，本项目仅借鉴交互思路，未纳入其代码、美术或声音；截图与新版发布说明不作为本项目已经支持某项功能的依据。

## 其他依赖

传递依赖、Electron、字体及其他随依赖安装的内容，按其各自随包提供的许可使用。`package-lock.json` 记录实际依赖版本；本项目不替代这些权利人的许可，也不将它们统一重新授权为 MIT。更改依赖或制作二进制分发包时，应重新核对实际纳入的第三方内容。
