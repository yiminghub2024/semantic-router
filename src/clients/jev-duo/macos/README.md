# Jev Duo · macOS

首次启动默认英文。左栏底部的语言菜单可以在 English 和简体中文之间切换，选择会自动保存。

支持 macOS 15 或以上版本。在苹果菜单中打开“关于本机”，查看“芯片”或“处理器”。按本机架构构建发行包。双击 ZIP，将 `Jev Duo.app` 放入“应用程序”后打开。每个包内置相应架构的 Node.js。发行包使用临时签名，尚无 Apple Developer ID 签名和公证。

## 首次配置

1. 在“服务”中选择 vLLM · System Duo、TypeSafe Jev 或本地决策模型，打开“连接设置”。
2. 在“决策服务”填写模型 ID、Endpoint 和 API Key。Endpoint 为 API 根地址（通常以 `/v1` 结尾）。本地决策端点可以选择 `systemone` 或 `chat` 协议。
3. System Duo 预置了 `vllm-sr/auto`。使用 TypeSafe 或本地后端进行对话时，点“添加模型”配置一个或多个 OpenAI 兼容生成端点。可以为每个模型设置独立的别名、路由描述、文本预算、图片或视频能力和 Key。生成模型的 Key 留空时可复用同一 Endpoint 的决策 Key。
4. 点“保存设置”。在主窗口选择自动路由或手动指定模型，输入问题，按 ⌘Return 发送。用“添加附件”选择本轮的图片或视频。“是非判断”模式直接调用 System One 的 Noul 决策，无需生成模型。

## 会话和输出

- 左栏可新建和切换会话。原始附件随成功的轮次写入本地 SQLite 归档。下一轮文本模型接收历史文字与识别结果。要再次检查原始媒体，重新添加附件。
- “流式输出”和“显示选择原因”默认关闭，应用会记住选择。流式对话逐段显示，完整收到后归档。System Duo 对话开启“显示选择原因”后，生成请求带上 `X-Vsr-Debug: true`，回复下方显示服务返回的路由类别与追踪信息。
- 连接设置和 Key 一起保存在此 Mac 的登录钥匙串中，服务标识为 `io.github.yiminghub2024.jev-duo`。会话与媒体归档是 `~/.jev-duo/history.sqlite`，与同机 CLI 共用。

## 构建与测试

在安装了 Xcode Command Line Tools 的 macOS 15 或更新版本上，从仓库根目录执行 `bash macos/build.sh`。脚本按本机架构生成 ZIP，校验捆绑 Node.js 的 SHA-256，然后验证应用签名。运行 `bash macos/test.sh arm64` 或 `bash macos/test.sh x64` 可解压发行包、执行流式请求测试并检查原生窗口是否打开。
