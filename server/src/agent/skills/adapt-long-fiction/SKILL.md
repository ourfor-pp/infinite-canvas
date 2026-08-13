---
name: adapt-long-fiction
description: 将超长小说按持久分块与分层摘要改编为可确认的长视频故事总纲。
allowed-tools: [mcp__infinite_canvas__director_get_state, mcp__infinite_canvas__director_search_source, mcp__infinite_canvas__director_update_document]
---
# 长篇改编

先读取导演项目状态与来源摘要。按卷、章节或关键词小批量检索正文分块，记录人物动机、主要冲突、因果链与结局，不得要求一次读取全书。将结果收束为适配目标时长的 Markdown 故事，保留主线，明确合并或删除的支线。写回前读取故事最新 revision；写回即作为当前采用版本，不要再要求用户确认。
