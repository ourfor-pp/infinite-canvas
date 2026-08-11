# 无限画布文档索引

## 项目介绍

- [快速开始](/zh-CN/docs/overview/quick-start)
- [功能介绍](/zh-CN/docs/overview/features)
- [Render 部署](/zh-CN/docs/overview/render)
- [Docker 部署](/zh-CN/docs/overview/docker)
- [第三方 GitHub 提示词仓库](/zh-CN/docs/overview/third-party-prompt-repositories)

## 操作手册

- [画布节点操作手册](/zh-CN/docs/canvas/canvas-node-manual)
- [画布快捷键](/zh-CN/docs/canvas/canvas-shortcuts)

## 开发与数据

- [本地开发](/zh-CN/docs/development/local-development)
- [fnOS 原生应用部署与统一网关](/zh-CN/docs/development/fnos-application-deployment)
- [画布数据结构](/zh-CN/docs/development/canvas-data-structure)

## 商务合作

- [开源协议](/zh-CN/docs/business/license)
- [商务合作](/zh-CN/docs/business/business)

## 支持与安全

- [漏洞提交](/zh-CN/docs/support/security)
- [赞助支持](/zh-CN/docs/support/sponsor)

## 项目进度

- [更新日志](/zh-CN/docs/progress/changelog)
- [待测试](/zh-CN/docs/progress/pending-test)
- [TODO](/zh-CN/docs/progress/todo)

## 说明

- 画布项目、“我的素材”、生成记录、媒体和模型设置现由 Express 后端保存；浏览器 IndexedDB 只作为旧数据导入源，并继续保存界面、插件与远程提示词缓存。
- 内网 ComfyUI 调用与 WebDAV 完整快照均由后端执行。本开发里程碑中的公网 OpenAI 兼容渠道仍由浏览器请求，但 API Key 会由后端加密落盘。
- 新后端架构的 Docker、Render、Vercel 与 fnOS 打包属于后续工作，v0.17.0 开发版暂不维护这些生产部署方式。

## 原理说明

- [本地 Codex 连接画布原理](/zh-CN/docs/development/local-codex-canvas)
