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
- [fnOS Application Deployment and Unified Gateway](/docs/development/fnos-application-deployment)
- [Canvas Data Structure](/docs/development/canvas-data-structure)
- [How the Local Codex Connection Works](/docs/development/local-codex-canvas)
- [Local ComfyUI Integration Handoff](./COMFYUI_HANDOFF.md)

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
- Internal ComfyUI calls and WebDAV snapshots run on the backend. Public OpenAI-compatible providers still run in the browser in this milestone, although their settings are encrypted at rest by the backend.
- Docker, Render, Vercel, and fnOS packaging are follow-up work for the new backend architecture and are not maintained by v0.17.0 development yet.
