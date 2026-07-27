# FIXI 2.0 Community

开源版 FIXI 图片修复器。此仓库不含任何网关地址、API Key、用户历史、修复图片或调用记录。

## 本地运行

```powershell
pnpm install
pnpm dev
```

打开终端显示的本地地址。生产构建使用：

```powershell
pnpm build
pnpm start
```

## 配置修复网关

打开右上角的“网关设置”，分别为以下两类模型填写自己的信息：

- NanoBanana：图生图网关地址、模型 ID 与 API Key。
- ChatGPT Image 2：图生图网关地址、模型 ID 与 API Key。

每个配置卡片均有“测试连接”。它会使用当前输入的地址和 API Key 请求网关的模型目录，反馈认证、网络连接和模型 ID 是否正常；测试不会生成图片，也不会消耗图像生成额度。保存后，密钥仅写入运行这套应用的机器的 `data/community-settings.json`，该文件已被 Git 忽略。

## 安全说明

- 请不要提交 `.env`、`data/` 或任何包含 API Key 的文件。
- 只将密钥交给自己信任的图像网关。
- 本项目的修复请求会将用户选择的图片和提示词发送给用户配置的第三方网关。
