# H3合并运行时部署验收

当前状态：部署前隔离验证已取得证据，正式服务未切换。不得将隔离端口测试计为导演台正式默认加速已生效。

## 已验证副本

工作区 `.tmp/h3-evaluation/formal-pdd-music-stage/runtime` 基于当前正式ComfyUI，保留KJNodes、Turbo和VoxCPM，加入PDD、原生状态和社区续接节点。Python依赖只读复用原正式环境，没有对原环境执行包安装或升级。模型目录合并稳定入口及实验权重，保留原权重实体；新增模型仍在SSD。

目录比较保留正式1180节点并新增10节点。实际发现初版复制误排除嵌套源码，以及模型目录软链接被跳过，两项均已修复准备脚本。VoxCPM必须检查模型选项包含VoxCPM2，不能只检查节点名字存在。

| 隔离验证 | 权威报告 | 限制 |
| --- | --- | --- |
| 节点目录 | `media-executor/examples/h3-evaluation/merged-runtime-catalog-report.json` | 仅启动与目录 |
| Music3 | `media-executor/examples/h3-evaluation/merged-runtime-music3-report.json` | 未完成听感、混音 |
| PDD八步 | `media-executor/examples/h3-evaluation/merged-runtime-pdd-report.json` | 图片参考单样例，未证明多模态或成片质量 |
| VoxCPM | `media-executor/examples/h3-evaluation/merged-runtime-voxcpm-report.json` | 当前生产图真实推理，未完成听感 |
| 原生续接 | `media-executor/examples/h3-evaluation/merged-runtime-continuation-report.json` | 原状态身份及双流前缀一致，未证明完整播放无破绽 |

## 正式接入操作范围

1. 将验收副本提升到稳定的revision目录；保留插件源码哈希、Python依赖清单及模型软链接，重新验证所有链接可达。不能把正式入口长期指向`.tmp`。
2. 正式8189以新目录启动并使用该副本的合并模型目录；旧参数`--models-directory /data/sas/ComfyUI/models`不能直接照搬，否则新权重可能不可见。回环监听、CUDA13动态库路径和禁用Comfy Compiler保持；本次隔离实测使用`--cache-none`，任何额外显存保留参数调整需要单独验证。
3. 保留旧运行时与启动清单；正式`infinite-media-executor.service`工作目录仍为项目`media-executor`，连接`127.0.0.1:8189`，任务目录保持现有路径，不迁移或清空任务。
4. 切换前查询正式和隔离Comfy队列及执行器任务，拒绝在排队或执行时重启。停止本次探测副本后切换8189，核对基础/PDD指纹及模型目录，再重启执行器使其加载当前代码。
5. 从应用端读取执行器能力，确认PDD、原生状态、Music3；通过真实导演预检与生成分别核对默认PDD和显式基础重做。保留新任务记录与最终媒体，不能用健康检查代替。
6. 任一启动、身份或能力检查失败时恢复旧启动方式和原运行时入口，并检查原执行器健康与任务读取。完整视听验收、Agent样章和多模态验证继续独立记录。

此前自动审批拒绝了正式停止/切换、入口链接更新及执行器重启，要求明确部署批准；本轮没有重新执行这些动作。上述步骤仍需形成可执行、可审阅的切换与回滚脚本，并完成稳定副本核验后再处理正式批准。

## 稳定副本与切换脚本就绪

稳定目录为 `ComfyUI-40c4fcdf513a4523e39d54a9d391908af8df8171-pdd-music-5b01ca7c647e`，1189源码文件哈希匹配、993模型入口已整理，独立8193启动后1190节点可见、VoxCPM2可发现、基础/PDD指纹与实测副本一致。详见 `stable-runtime-promotion-report.json`。移出临时目录后尚未另做推理，已有推理证据来自源码相同的原隔离副本。

可审阅脚本 `.tmp/h3-evaluation/formal-pdd-music-stage/switch-stable.py` 默认只读，已通过实际检查；仅 `--apply` 进入正式切换。脚本核对源码、指纹、模型与所有队列，停止本轮所属空闲探测进程后切换，失败恢复旧运行时和原启动参数；成功后仍需应用真实生成验收。正式分支未执行，等待解决此前自动审批要求的明确部署批准。

为导演台真实视频预览释放GPU上下文，已在确认队列为空后停止本轮8192/8193探测进程，正式8189/8290保持不变。后续批准部署后须先重新启动这两个探测副本并执行默认只读检查；脚本依赖实时端口与指纹，旧检查通过不是当前就绪证明。

启动参数审阅发现旧脚本新运行时分支遗漏正式命令的 `--reserve-vram 2`。现改为复制实际记录的启动参数，仅替换解释器和模型目录并加入已验证的 `--cache-none`；静态核验保留回环地址、端口、显存预留和禁用Compiler，回滚命令逐项等于原命令。报告 `media-executor/examples/h3-evaluation/stable-launch-parameter-review.json`。未执行正式切换，启动与真实生成仍待批准后的运行时验收。
