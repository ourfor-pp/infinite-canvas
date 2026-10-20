# H3 生成阶段：实际创作者流程与小脸证据

本轮最值得补测的是 **Singularity + 作者指定的 Ref2V Turbo4**，其次是**分开准备脸部/身体参考，并保留条件做高分辨率 H3 二采**。本机刚完成的无 Turbo BASE20 结果仍然有效，但没有覆盖作者推荐的采样工作点。没有找到能证明“中远景指定身份已普遍解决”的完整公开配方；不能把半身大脸演示、作者宣传或原生尺寸不明的发布片算成这项证明。

只做公开资料读取、小型 workflow/源码缓存及 CPU 解码检查，没有模型下载、GPU 推理、安装或服务改动。原始文件、SHA、网络失败记录均在 `h3-generation-sources/`，结构化摘要在 `h3-generation.json`。

## 1. Singularity：遗漏了作者强调的 Turbo4 工作点

一手来源：[固定模型卡](https://huggingface.co/WarmBloodAban/Minimax-h3_Singularity/blob/af671d9214a6e41ab8c2f43e9f871ea56246115f/README.md)、[原作者讨论 #7](https://huggingface.co/WarmBloodAban/Minimax-h3_Singularity/discussions/7)、[作者链接的实际 RunningHub 流程](https://www.runninghub.ai/post/2096339589492432897/)。模型卡明确指定 `minimax_h3_ref2v_turbo_4step_v0.1`；讨论中作者解释早期阶段噪声/动态很激进，因此依赖四步加速 LoRA，并倾向 simple 这类均衡 scheduler。此处是作者解释，尚非本机成功结果。

RunningHub 公共页面实际名为多参考＋双采样 latent 放大，共33节点；公开清单包含 Singularity v1.3 **完整 INT8**、FL2VA pruned、Turbo4、LBH latent upscaler、多个 VAE/编码器以及 Sol/Sage 相关节点。但清单不能证明哪些节点实际启用、展示用了哪个权重；SSR 的 `workflowContent=null`，本轮没有取到作者完整 graph。公开访问标记 `granted=true/encrypted=false`，不能因此谎称收费或权限阻断。

可下载的最小替代图是社区作者 ssssssanjiu 的[固定纯核心节点 Ref2V4 图](https://github.com/ssssssanjiu/minimax-h3-turbo/blob/002398206ebdfcb65579ab22a4d05022a235072a/ref2v-4step.json)，已保存 `core-ref2v-4step.json`。实读参数：Ref2VA pruned INT8 ConvRot，Qwen3VL32B NVFP4 AWQ，视频VAE FP16/音频VAE FP32，Turbo Ref2V v0.1 **strength1.0**，**Euler/simple4/denoise1、SigmaShift video12/audio3**，1344×768、124帧、24fps、reference=`match`。这份是社区图，不冒充 Singularity 作者原图；simple 与作者口头建议相符，其余参数仍是明确待测的组合。

实际原片：[作者 video/3.mp4](https://huggingface.co/WarmBloodAban/Minimax-h3_Singularity/resolve/af671d9214a6e41ab8c2f43e9f871ea56246115f/video/3.mp4)已下载并全 CPU 解码，1246×720、24fps、296帧/12.333秒，有音频；查看1fps抽帧及末段，是带多次切镜的风格化武打片。可见中远景及清楚的近景，但远景脸停留短、没有身份输入/同seed基线、发布尺寸也不能还原生成尺寸，因此只算作者展示。它不是4K或小脸身份纠正的独立证据。

最小验证：保持本轮同一身份板、六段提示、1344×768/124/seed73412，做“官方底座＋Turbo4”与“现有 Singularity pruned INT8＋同 Turbo4”两条；不叠 PDD/Realism、不加后期。先审原生身份/年龄/头向并记录脸占幅，确有收益再第二seed。当前 Comfy `models/loras` 没找到该 Ref2V4 文件；需另核实际稳定权重入口，未下载。公开大小约1.96GB；4对20仅表示采样步数少80%，不等于冷启动或整条耗时少80%。作者页面涉及的完整INT8未被这一最小验证覆盖。

## 2. LBH：真实学习型 latent 放大，再由 H3 补采样

一手来源：[固定模型仓](https://huggingface.co/LBH-123-AI/Minimax_h3_latent_Upscaler/tree/3f941d5d182014dd5c0a5e16330420ee2d4aa0c6)、[固定节点源码](https://github.com/LBH-123-AI/Comfyui_Minimax_h3_latent_Upscaler/tree/40316cf008b2fd8663263270669eb4da23f89d2c)、[作者 R2V 完整图](https://huggingface.co/LBH-123-AI/Minimax_h3_latent_Upscaler/blob/3f941d5d182014dd5c0a5e16330420ee2d4aa0c6/workflow_templates/minimax_h3_r2v_Latent%20Upscaler%20example%20workflow3.json)。已保存 `lbh-r2v.json`，不是空泛的“latent upscale”节点名。

按实际连线：低分辨率0.2MP、reference=`match`、5秒映射124帧；**完整 Ref2VA INT8**（非pruned）、NVFP4 AWQ、视频FP16/音频FP32 VAE；实际 LoRA 字段是 `minimax_h3_fl2v_lightx2v_turbo_4step_v0.1_comfy.safetensors` strength1，不能擅改写成标准 Ref2V4。Euler；低段取 `BasicScheduler(simple8,denoise1)` 的前4步，低段输出的 video latent 经学习型3D模型放至1.0MP，audio分开保留后重新拼接；高段是独立 **3步 ManualSigmas=[0.9035,0.6316,0.3158,0]**，并非笼统“余下4步”。实际两个 guider 都用原来的参考 conditioning。调度器接原始底座、采样模型经12/3 shift，也须按原图留证，不能把旁边未接入的 sigma 节点当执行配置。

配套[四格比较视频](https://huggingface.co/LBH-123-AI/Minimax_h3_latent_Upscaler/resolve/3f941d5d182014dd5c0a5e16330420ee2d4aa0c6/examples/Minimax_h3_latent_Upscaler_001.mp4)已完整解码：2460×1510、24fps、129帧/5.375秒，是四格拼版，**不是单条原生视频尺寸**。2fps抽帧可见普通 latent 插值格严重重影，学习型格较完整；主角是较大正脸、运动轻，无明确参考真值，不能外推小侧脸身份。VAE upscale格同样清楚，不能凭这个演示认定学习型方案全面胜过它。

依赖为 LBH 节点＋约691MB FP16/BF16 upscaler；示例还有 KJNodes preview、ResolutionSelector 等辅助节点，当前核心/schema兼容未验证。实际 graph 文件名仍指老的 `...3d_fp16`，固定模型仓新文件为 `...3d_conv_v1_fp16`，导入时需明确选取对应文件，不能只原样导入便宣称可运行。当前本机 latent_upscale_models 仅占位文件。高段仍在目标分辨率采样，作者明确说节约时间而非保证节约峰值显存。

最小验证：先保留同一低段 latent，比较对齐后的普通插值与学习型上采样，使用相同参考/高段sigma/noise；先以约1MP封顶检查脸结构。若改用现有pruned底座、改LoRA或替代节点，都记为本机适配，不能称作者原样；不从1MP直接跳4K。

## 3. OmniChar：原始图揭示“多角度脸＋去脸身体＋分离服装”

一手来源：[作者工作流页](https://www.omnichar.org/workflows/minimax-h3-guided-consistent-characters-via-reference-identity-face-body-cloths)、[原始导出JSON](https://www.omnichar.org/api/workflows/minimax-h3-guided-consistent-characters-via-reference-identity-face-body-cloths/graph)、[固定作者代码](https://github.com/omnichar/OmniChar/tree/ee646fba219a2325cfe15bad42af05f0d06b7fcd)。导出已保存 `omnichar-graph.json`，SHA记录于JSON摘要；这是 **Inline Studio 图，不是可直接导入当前 ComfyUI 的 graph**。

原图：Ref2VA pruned **FP8 scaled**、NVFP4 AWQ、视频FP16/音频FP32 VAE，768×1024、50步、24fps、`match`；角色reference_resolution512、最多9图、角色名emmy、角色参考直接送生成。它同时保存duration5.17、num_frames141与duration_seconds5.875，存在重复派生字段；已取得的 lakeside 原片实际141帧/5.875秒，不能任选一个字段称精确时长。

作者建议：脸参考提供不同视角；身体参考裁去脸，服装另裁；避免服装槽仍含整张脸而产生冲突。两个原片均已解码与抽帧：湖边768×1024/5.875秒、室内768×1280/约3.695秒，都是半身或近景，粗粒度面貌/服装连贯，但**没有验证本题远景小脸**。网页要求24GB+显存/64GB RAM；50步比本机20步更贵，实际秒数没有可比计时。

最小验证不必部署另一个平台：先把本机现有身份板拆出单独脸部图、无脸身体/服装图，仍走当前原生 Ref2VA，固定提示/seed/采样与景别，只对比参考组织方式；可另试 `match`→`max`，不能同时换图和尺寸。三栏板仅有正脸，不能用生成的侧脸假装真实侧参考；若以后补合成角度，必须另记可能强化错误身份。该验证是借鉴参考组织原则，不宣称复现 `.char` 实现。

## 4. RefMod 教程：拿到完整图后，不能再把标题当单一算法

一手来源：[cgpixel23原帖与教程/图链接](https://www.reddit.com/r/comfyui/comments/1x38n4c/comfyui_tutorial_consistent_ai_characters_in/)、[作者共享原图](https://drive.google.com/file/d/1Em2zTlhFMbpeO2WBTN08Qpu0dP6oUBTD/view)、[RefMod原作者固定README](https://github.com/Luisacaotica/ComfyUI-MiniMaxH3Mod/blob/517e8c419a8584fbf69fceb487bc39d83e6a6ec8/README.md)。244905B原图已取到并保存 `creator-refmod-original.json`，含子图共89节点，不是按帖子文字推测参数。

原图默认：RefMod名pink、strength0.9；构建区为 Full Reference、1024、max_items8、max_tokens16384（该区默认bypass）。生成实际用 `minimax_h3_fused_refdelta_r1024_turbo8_mystic07_int8_convrot`、Qwen3VL32B **Q2_K GGUF**、INT8视频VAE，5秒/0.6MP外层覆盖，**ER-SDE/simple8、12/3 shift**；后面还接LBH learned latent upscale至约1.2MP、**Euler/simple4 denoise0.2**。二采重新建 `8k, high resolution` 条件，没有接回同一 RefMod conditioning，不能宣传成明确身份引导的二采。图里还存在SLA/Veda/低显存attention等子图选项，不能按所有节点mode0就认定所有补丁在同一激活路径叠加。

依赖随图自述包括 RefMod 多个不同revision（d0aea3…、22ca77…、f94620…）、GGUF、KJNodes、VHS、rgthree/easy-use、稀疏注意力等；本机没有验证它们整体兼容，也没有核实融合权重原作者来源。教程是“一张图→Qwen2.1生成8角度→RefMod→视频”，同时混入多个变量。讨论中用户直接指出角色面貌变化，教程作者承认需要调strength或更多图，故不能列为身份已成功的受控证据。

另实取 RefMod 原作者 `id_sucess.gif` 并全解码/抽帧：是红发人物的多个近景/风格变化展示，**不是远景身份基准**。原作者README本身明确：RefMod储存/压缩VAE参考token，不训练H3身份权重，压缩损失信息，脸、衣服、背景和构图仍可能混合，示例不是受控 benchmark。1024方形encode每张约1024个参考token，8张约8192个，文件小不代表推理成本无变化。

最小验证：若需继续，应只抽取“Full Reference encode多张真实角度，strength1”这一变量，与原生多图Ref2VA比较；不要照搬陌生融合权重＋Q2_K＋多个attention补丁来宣称是RefMod收益。原图可供逐项审查，当前不建议直接装全套或为它下载另一份大底座。

## 最小投入顺序与停止条件

1. **先补一组作者Turbo4工作点**：两个现有底座使用同一个Turbo4配方，先一seed，无后期；若脸像素预算明显不匹配，先报告取景变化，不能靠锐度定胜负。
2. **无新增权重的参考图拆分实验**：只换身份参考组织，测试同一身份的年龄、颧颊/鼻唇结构及侧向连续性；已有三栏板不等于多角度脸参考。
3. 有明确原生收益后再尝试 LBH 约1MP二采；保留中间latent、sigma、参考及原音频。跨模或4K再生成留到后面，不用更精致的脸替代同一个人。
4. 拒绝的结论是“当前证据还不够”，不是“网上没人成功”。已取的作者样片确实有清晰片段，但大脸、风格化人物、多次切镜和没有公开完整来源参数，均限制其对远景指定身份的证明力。

补充对照：[仍在使用Singularity＋DMAD却报告宽景脸模糊的原始用户讨论](https://www.reddit.com/r/StableDiffusion/comments/1x3124n/blurry_facesmini_max_h3/)说明换融合基座/加速LoRA也不是通用保证；它只是个人使用反馈，没有完整参数和原始视频，不作为“方案必失败”的证据。本次只有研究材料变化，正式产品todo/pending-test无需修改。
