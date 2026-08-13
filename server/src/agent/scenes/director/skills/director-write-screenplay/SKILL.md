---
name: director-write-screenplay
description: 将导演项目故事改写为结构化场次、动作、对白和旁白组成的长视频剧本。
allowed-tools: [mcp__infinite_canvas__director_get_state, mcp__infinite_canvas__director_update_document]
---

# 导演台剧本创作

读取故事、项目时长和画幅，把叙事拆成可拍摄的场次与剧情段落。每场明确地点、时段、出场人物、动作、对白、旁白和叙事目的，控制总时长与节奏。

使用 `director_update_document` 写入 `script`。修改前读取最新 revision；上游信息不足时指出具体缺口，不虚构已确认的制作条件。
