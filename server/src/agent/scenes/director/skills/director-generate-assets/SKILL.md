---
name: director-generate-assets
description: 将已设计的素材提示提交给当前引擎，管理图片或声音结果的落盘、状态查询与实际验收。
allowed-tools: [Read, Glob, Grep, LS, mcp__infinite_canvas__director_list_models, mcp__infinite_canvas__director_generate_asset, mcp__infinite_canvas__director_get_generation_status]
---

# 素材生成与验收

读取目标工作区和当前风格；图片任务阅读 [图片提交契约](references/image-generation.md)，完成后按 [资产验收清单](references/asset-qc.md) 检查。角色、场景、道具的设计方法由对应设计 Skill 负责，这里不重新选角或改变身份。

图片使用当前引擎声明的图片能力。Codex 使用原生生图及系统规定的工程缓存、哈希复核和落盘方式，不查询管理员图片模型或 MCP 生图任务。其他引擎遵循当前可用的图片生成工具。`prompt.md` 必须是完整最终提示，缺少身份、风格、输出用途或参考说明时先返回对应设计步骤修订，不在提交阶段隐式补写。

声音读取 `voice/sound.md` 或 `sound/sound.md`；角色试听台词来自 `sampleText`，参考声音最多一个。Codex 调用 `director_generate_sound({ assetPath, expectedHash })`，哈希按该目标声音提示文件的当前字节计算，模型由后台声音配置选择；其他引擎按素材生成工具的声音目标提交。随后只按返回的同一任务 ID 查询 `director_get_generation_status({ id })`，不得以重复提交代替查询。

每次提交对应用户授权的一个目标。完成后实际打开图片或试听分析声音，报告具体证据与不确定项；若后端返回自动检查结果，将其作为辅助证据。没有自动质检结果不能宣称“自动验收通过”。检查失败先说明问题，不自动再次消费额度。结果归入目标工作区；哈希已变化时保留历史产物，不能覆盖新设计。

单阶段任务到此交付；用户已经授权更完整的制作时，继续组合下一阶段 Skill，无需重复询问同一授权。
