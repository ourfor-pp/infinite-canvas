---
name: director-adapt-long-fiction
description: 将长篇小说按分块检索与分层摘要改编为导演项目的故事总纲。
allowed-tools: [mcp__infinite_canvas__director_get_state, mcp__infinite_canvas__director_get_document, mcp__infinite_canvas__director_search_source, mcp__infinite_canvas__director_update_document]
---

# 导演台长篇改编

先读取项目状态与来源摘要，再按卷、章节或关键词分批检索正文，梳理人物动机、主要冲突、因果链和结局。不要要求一次读取整部小说。

根据目标时长收束主线，明确合并或删除的支线，以 Markdown 写入 `story` 文档。更新前读取最新 revision；保留用户原意，不擅自改动关键结局。
