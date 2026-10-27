# 第三方来源与许可

本文记录 dsh-pet-codex 使用的主要第三方来源与许可边界，由项目维护者随依赖和分发方式更新。适用范围为本仓库及其运行时准备流程；核对日期为 2026-10-28。

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
| Codex 接入与本项目适配 | dsh-pet-codex contributors |

上游 README 标明角色为社区二创形象，并链接了 ZipZipPipe 于 2026-09-20 发布的[形象使用声明](https://www.bilibili.com/opus/1247156596114456581)。该声明采用 [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/)：署名、非商业、相同方式共享。使用或改编角色材料时，应提供适当署名和协议链接，注明修改，并按该协议要求分享改编材料。

角色形象的 CC 许可与上游素材的非商用说明分别保留；本项目不据此推定其他第三方内容也适用同一协议，也不代表原作者或 DeepSeek 为本项目背书。

## 其他依赖

传递依赖、Electron、字体及其他随依赖安装的内容，按其各自随包提供的许可使用。`package-lock.json` 记录实际依赖版本；本项目不替代这些权利人的许可，也不将它们统一重新授权为 MIT。更改依赖或制作二进制分发包时，应重新核对实际纳入的第三方内容。
