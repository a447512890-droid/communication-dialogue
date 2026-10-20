# Qwen AI 商务陪练 Demo

这是一个单独运行的本地语音体验 Demo，使用浏览器 WebRTC 连接阿里云百炼 `qwen3.8-omni-flash-realtime`。API Key 只由本地 Node 服务读取并用于转发 SDP，不会下发到浏览器。页面不会保存音频或聊天记录。

## 准备

- Node.js 18 或更高版本
- 千问 AI 平台 API Key

复制 `.env.example` 为 `.env`，填写 `DASHSCOPE_API_KEY`。`.env` 已加入 Git 忽略规则。平台依据 Key 路由到它所属的业务空间。

```sh
node server.mjs
```

默认打开 http://127.0.0.1:8766/ ，进入已接入实时语音的需求原型。独立 Demo 仍可在 http://127.0.0.1:8766/qwen-ai-practice-demo/ 访问。允许浏览器访问麦克风后即可开始。换模型或端口时修改 `.env`，再重启服务。

## 说明

- 场景提示词参照项目的 `docs/AI/场景化演练提示词.md`，本 Demo 将已确认目标直接传入实时会话。
- 页面只展示本轮实时转录，不提供点评、账号、额度控制或云端存储。
- 浏览器和本地服务都不会将真实电话接入此 Demo。
- 模型及实时 WebRTC 接入以[模型说明](https://www.qianwenai.com/models/qwen3.8-omni-flash-realtime)、[Realtime 鉴权文档](https://platform.qianwenai.com/docs/api-reference/realtime-api/token-auth)和[Omni 客户端事件文档](https://platform.qianwenai.com/docs/api-reference/real-time-multimodal/client-events)为准。

音轨初始化：先通过`addTrack(track, stream)`注册实际媒体流，再暂时`replaceTrack(null)`阻止提前上传；会话配置确认后恢复麦克风音轨。仅创建无流的audio transceiver可能导致已连接但无有效转写。
