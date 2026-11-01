# 海外聊天连接

海外入口已接入本机连接管理、本人配对和三应用任务引擎，真实平台状态均为**未验证**。当前基础检查使用合成账号、模拟协议与本机回环 HTTP，没有登录海外账号、发送真实消息或调用模型。

| 平台 | 账号方式 | 接入方式 |
| --- | --- | --- |
| Telegram | 官方机器人 | Bot API 长轮询；首次从收件箱尾部建立游标 |
| Telegram | 普通账号 | teleproto `1.232.1`；独立登录会话 |
| Discord | 官方机器人 | Gateway DM 事件与 REST 发送 |
| LINE | Official Account | 签名 webhook 与 Messaging API |
| WhatsApp | Cloud API 官方号码 | 订阅验证、签名 webhook 与文字消息接口 |

Discord 不提供个人号 self-bot。LINE 与 WhatsApp 的普通账号方式尚未实现。公开 HTTPS 入口、平台账号准入及实际消息收发还需后续验收。

## 创建连接

打开控制中心的「海外连接」，新建连接后选择平台、账号方式、任务应用和项目文件夹。Codex、WorkBuddy、DeepSeek Harness 分别保存消息模式、文件权限、Shell、MCP 与会话；更换任务应用不会更换本机桌宠的联动应用或形象。

每条连接可选择「会话与任务」或「角色闲聊 · 无工具」。后者只生成角色回复，不提供电脑工具。也可以对单条消息使用 `/role 你好` 或 `/task 检查 README`。文件权限、Shell 与 MCP 另行授权；Shell 和 MCP 默认关闭。

密钥只在本机窗口填写。保存时使用当前 Windows 用户的 DPAPI；状态接口不返回 Token、登录会话字符串、手机号或验证码。Telegram 普通号的验证码、二步密码和邮箱验证码只供本次登录使用，不写入配置。

## Telegram

机器人：通过窗口中的「创建账号 / 机器人」打开 [BotFather](https://t.me/BotFather)，创建机器人后，将 Token 填入本机窗口，选择项目并保存。连接显示就绪后点击「本人配对」，使用自己的 Telegram 私聊机器人发送窗口里的 `/pair 六位码`。

普通号：先在 Telegram 官方客户端注册账号，再到 [my.telegram.org/apps](https://my.telegram.org/apps) 取得 API ID 与 API Hash。选择普通账号并保存，按本机窗口提示输入电话号码、验证码或二步密码。登录完成后，用本人的另一个 Telegram 账号私聊该账号完成配对。如果平台要求额外风控验证，先在官方客户端完成，再重新连接。

两种方式的登录、配对、会话和结果分别保存。接收范围仅限私聊文字；群消息、自发、机器人消息、转发和附件不会转成电脑任务。

## Discord

在 [Discord Developer Portal](https://discord.com/developers/applications) 创建官方机器人，将 Bot Token 填入本机窗口。适配器检查真实 bot 身份后订阅私聊消息；添加机器人、账号资格和 DM 可达条件仍由 Discord 决定。通过本人的私聊发送窗口中的配对码。群消息、Webhook 作者和机器人消息不进入任务引擎。

## LINE 与 WhatsApp

这两种方式需要本人已有的公开 HTTPS 入口。桌宠只在启用相应连接时开启独立的 `127.0.0.1:17640` 回调监听，不改防火墙，不公开管理面板。端口被占用时会明确报错，不自动另占端口。

保存连接后，窗口显示本机回调地址。将公开 HTTPS 地址转发到这个**固定路径**，转发请求使用本机目标的 Host，不携带 Origin，保留原始正文、查询参数及平台签名。只转发该回调路径。桌宠管理接口仍使用原有鉴权，回调接口分别验证平台签名。

LINE：填写 Channel access token 与 Channel secret，在 [LINE Developers](https://developers.line.biz/en/docs/messaging-api/getting-started/) 配置公开 webhook，使用平台的 Verify 发送签名检查。有效回调到达后才能本人配对。回复优先使用新消息的单次 reply token，过期后使用官方 push；平台额度、资费和发送结果按实际返回处理。

WhatsApp：填写 Phone number ID、Access token、Meta App secret、本人设置的 Verify token，以及控制台要求的 Graph API 版本。Verify token 用于 GET 订阅验证，App secret 用于 POST 签名，二者不能混用。收到的消息还须匹配已核实的号码元数据和私聊来源。当前仅发送文字，不自动改发模板或重试未确认的发送；平台拒绝后保留任务结果，待本人再次取回。

有效 webhook 不等于开放任务权限。只有已配对本人发来的文字才能进入所选应用；群、过期消息、非文字和签名错误的请求会被拒绝。

## 会话与任务

配对后发送 `/help` 查看当前命令。项目由本机原生目录选择器授权，聊天里只能按新鲜列表选择项目和会话，不能提交任意电脑路径。Codex 可在授权项目内接着已有桌面会话聊；WorkBuddy 与 Harness 只恢复本连接创建且权限一致的原生会话。

`/status` 查看当前任务，`/cancel` 取消。操作确认、拒绝和问题回答使用当前回合的一次性代码；过期或已经消费的代码无效。结果投递失败会保留，使用 `/result` 取回，不重新执行模型任务。变更连接、项目或工具前会检查任务是否空闲。

## 依据与验证范围

- [Telegram Bot API](https://core.telegram.org/bots/api)：getMe、getUpdates、sendMessage 与私聊消息结构。
- [teleproto 文档](https://docs.teleproto.dev/)及[GramJS 迁移说明](https://docs.teleproto.dev/migrating-from-gramjs)：普通号认证、会话与新消息事件。固定包已完成离线装载检查。
- [Discord Gateway](https://docs.discord.com/developers/events/gateway)：Bot 身份、Direct Messages intent、心跳、重连与恢复。
- [LINE 签名验证](https://developers.line.biz/en/docs/messaging-api/verify-webhook-signature/)和[Messaging API](https://developers.line.biz/en/reference/messaging-api/)：原始字节 HMAC、用户消息及 reply/push。
- [Meta 官方 webhook 文档](https://whatsapp.github.io/WhatsApp-Nodejs-SDK/api-reference/webhooks/start/)与[官方 API 示例](https://github.com/fbsamples/whatsapp-api-examples)：订阅验证、App secret 验签和号码消息路径。实现独立编写；Graph API 版本由本人填写。新文档页本轮返回 HTTP 429，未据此宣称最新平台版本已经核验。

单元与合成检查已覆盖账号指纹、群和自发过滤、一次性登录、独立项目权限、审批、取消、同会话续接、结果留存、签名与回调体积限制。隐藏 Electron 检查覆盖中英文、系统深浅配色、600px 窗口和各平台表单。真实账号、平台网络、消息送达和公开 HTTPS 转发保持未验证。
