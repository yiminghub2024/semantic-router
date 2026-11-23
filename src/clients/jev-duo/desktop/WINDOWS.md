# Jev Duo · Windows 11 x64

首次启动默认英文。左栏底部的语言菜单可以在 English 和简体中文之间切换，选择会自动保存。

完整解压 ZIP，双击 `JevDuo.exe`。同目录的 runtime、desktop 和 src 供应用使用。发行包内置 Node.js，图形界面使用 Windows 自带的 .NET Framework。当前发行包未进行 Authenticode 签名。

## 配置并开始对话

1. 在主窗口的“服务”中选择 vLLM · System Duo、TypeSafe Jev 或本地决策模型，点击“连接设置”。
2. “编辑决策服务”中可修改模型 ID、Endpoint 和 API Key。Endpoint 填 API 根地址（如 `http://127.0.0.1:8009/v1`）。本地决策支持 `systemone` 或 `chat` 协议。
3. vLLM 预置了 System Duo 的决策与生成模型，使用同一 Key 时在决策服务中填写一次即可。TypeSafe 和本地配置可通过“添加模型”接入多个生成端点，按部署实际情况填写别名、模型 ID、地址和 Key，勾选图片或视频能力。生成模型使用 OpenAI 兼容的 Chat Completions 接口。请为上下文和输出留足预算。写好“路由描述”有助于决策服务选择模型。
4. 点击“确定”，然后“保存设置”。主窗口可选“自动路由”或手动指定生成模型，输入问题后点击“发送”。“添加附件”只影响当前轮。提交成功后输入框和附件清空，请求失败时保留草稿。
5. “是非判断”模式直接询问 System One 模型，例如添加视频后问“画面中有人走过吗？”。TypeSafe Jev 可处理文本和符合服务限制的 PNG/JPEG 图片，System Duo 决策可接收视频。本地决策适配器接受文本。选择判断模式时无需配置生成模型。

从左侧切换会话。“新会话”创建独立历史编号，第一次成功发送后持久保存。每次切回纯文本模型都只发送可用的文本历史。需要再次读图或视频时重新添加附件。

## 本地数据

主窗口的“流式输出”和“显示选择原因”默认关闭，会记住上次选择。“流式输出”适用于支持 OpenAI SSE 的生成端点，收到正文后逐段显示。“显示选择原因”适用于 System Duo 对话，勾选后每次生成请求带上 `X-Vsr-Debug: true`。答复下方显示服务返回的路由类别和原始追踪字段，历史中的路由信息仅用于界面展示。是非判断使用独立的 System One 接口。

连接设置与 Key 使用 Windows 当前用户的 DPAPI 加密，保存在 `%LOCALAPPDATA%\JevDuo\profiles.dpapi`。会话和原始附件与此项目的 CLI 共用 `%USERPROFILE%\.jev-duo\history.sqlite`，可用 `JEV_DATA_DIR` 调整。每个后端使用独立的模型池。端点请填写你信任的服务地址，访问云端时使用 HTTPS。

## 从源代码构建

Windows x64 开发机需安装带 node:sqlite 的 x64 Node.js 和系统 .NET Framework 4.x 编译器。在仓库根目录运行 `powershell -ExecutionPolicy Bypass -File desktop/build.ps1`。发行包位于 dist 目录。
