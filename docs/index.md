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

- [Local Development](/docs/development/local-development)
- [Testing Strategy](/docs/development/testing-strategy)
- [fnOS Application Deployment and Unified Gateway](/docs/development/fnos-application-deployment)
- [Canvas Data Structure](/docs/development/canvas-data-structure)
- [Director File Project Format](/docs/development/director-file-project)
- [Local ComfyUI Integration Handoff](./COMFYUI_HANDOFF.md)
- [MiniMax H3 Ecosystem and Iteration Research](./research/minimax-h3-ecosystem-iteration.md)
- [MiniMax H3 First-batch Validation](./research/minimax-h3-first-batch-validation.md)
- [MiniMax H3 Multi-scenario Validation](./research/minimax-h3-second-batch-validation.md)
- [MiniMax H3 Multiseed Validation](./research/minimax-h3-multiseed-validation.md)
- [H3 Storyboard Layout Validation](./research/h3-storyboard-layout-validation.md)
- [H3 Native Continuation Validation](./research/h3-native-continuation-validation.md)
- [H3 Native Continuation Integration](./research/h3-native-continuation-integration.md)
- [H3 Short-drama Sample Plan](./research/h3-short-drama-sample-plan.md)
- [H3 Short-film References](./research/h3-short-film-references.md)
- [H3 Short-drama Quality Target](./research/h3-short-drama-quality-target.md)
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

- Canvas projects, My Assets, generation records, media, and model settings are now stored by the Express backend. Browser IndexedDB remains only as an import source and for UI/plugin/remote-prompt caches.
- All AI provider calls, internal ComfyUI work, the built-in Canvas Agent, and WebDAV snapshots run on the backend; provider credentials never reach the browser.
- Docker, Render, Vercel, and fnOS packaging are follow-up work for the new backend architecture and are not maintained by this development milestone yet.
