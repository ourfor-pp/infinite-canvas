# Infinite Canvas Documentation Index

## Overview

- [Quick Start](/docs/overview/quick-start)
- [Features](/docs/overview/features)
- [Deploy on Render](/docs/overview/render)
- [Docker Deployment](/docs/overview/docker)
- [Third-party GitHub Prompt Repositories](/docs/overview/third-party-prompt-repositories)

## Canvas Guide

- [Canvas Node Guide](/docs/canvas/canvas-node-manual)
- [Canvas Shortcuts](/docs/canvas/canvas-shortcuts)

## Development and Data

- [画布图片、视频与音频输入契约验收](./research/canvas-media-input-contracts.md)

- [中立媒体能力与执行器边界](/docs/development/media-capabilities)
- [中立服务音乐、ASR 与 TTS 选型](./research/audio-capability-selection.md)

- [Local Development](/docs/development/local-development)
- [Testing Strategy](/docs/development/testing-strategy)
- [fnOS Application Deployment and Unified Gateway](/docs/development/fnos-application-deployment)
- [Canvas Data Structure](/docs/development/canvas-data-structure)
- [Director File Project Format](/docs/development/director-file-project)
- [Director Codex](/docs/development/director-codex)
- [Director Realtime Sync Version Plan](./research/director-realtime-sync-plan.md)
- [Local ComfyUI Integration Handoff](./COMFYUI_HANDOFF.md)
- [MiniMax H3 Ecosystem and Iteration Research](./research/minimax-h3-ecosystem-iteration.md)
- [OpenVDN Single-GPU Reproduction Research](./research/openvdn-single-gpu-reproduction.md)
- [MiniMax H3 First-batch Validation](./research/minimax-h3-first-batch-validation.md)
- [MiniMax H3 Multi-scenario Validation](./research/minimax-h3-second-batch-validation.md)
- [MiniMax H3 Multiseed Validation](./research/minimax-h3-multiseed-validation.md)
- [H3 Storyboard Layout Validation](./research/h3-storyboard-layout-validation.md)
- [H3 Native Continuation Validation](./research/h3-native-continuation-validation.md)
- [H3 Native Continuation Integration](./research/h3-native-continuation-integration.md)
- [H3-World Control Candidate](./research/h3-world-control-candidate.md)
- [H3 Short-drama Sample Plan](./research/h3-short-drama-sample-plan.md)
- [H3 Short-film References](./research/h3-short-film-references.md)
- [H3 Realism People Validation](./research/h3-realism-people-validation.md)
- [H3 Short-drama Quality Target](./research/h3-short-drama-quality-target.md)
- [H3 Iteration Decision and Acceptance Gaps](./research/h3-iteration-decision.md)
- [生成能力与导演台职责梳理](./research/generation-capability-boundaries.md)
- [导演 v3 三维预演实施与验收](./research/director-v3-acceptance.md)
- [MiniMax H3 Ref2V v1.0 and Upgrade Validation](./research/minimax-h3-ref8-upgrade-validation.md)
- [MiniMax H3 Community Anomaly Research](./research/minimax-h3-community-anomalies.md)

## Business

- [Open-source License](/docs/business/license)
- [Business Cooperation](/docs/business/business)

## Support and Security

- [Report a Vulnerability](/docs/support/security)
- [Sponsor the Project](/docs/support/sponsor)

## Project Progress

- [Changelog](/docs/progress/changelog)
- [Pending Tests](/docs/progress/pending-test)
- [TODO](/docs/progress/todo)

## Notes

- [H3 三维预演与角色参考对照](research/h3-previs-reference-test.md)：真实三组生成、同步视频与适用边界。

- Canvas projects, My Assets, generation records, media, and model settings are now stored by the Express backend. Browser IndexedDB remains only as an import source and for UI/plugin/remote-prompt caches.
- All AI provider calls, internal ComfyUI work, the built-in Canvas Agent, and WebDAV snapshots run on the backend; provider credentials never reach the browser.
- Docker, Render, Vercel, and fnOS packaging are follow-up work for the new backend architecture and are not maintained by this development milestone yet.

- [导演 Agent 长视频落地路线](research/h3-agent-production-roadmap.md)：默认 Ref2VA 加速接入、配方身份和创作 Skills 研究入口。

- `research/audio-v0152-acceptance.md`：音频固定输入对照、GPU 调度恢复及正式部署验收与听审边界。

- `content/docs/development/qwen-voice-design.mdx`：Qwen VoiceDesign、CustomVoice、Base 参数边界与参考声音保存复用协议示例。

- `research/qwen-v0153-acceptance.md`：Qwen 节奏配对、真实重启复用、正式应用传输及试听边界。
