# 声明式预演格式

坐标单位为米，Y 向上，正 Z 为人物正面；旋转单位为弧度。所有时间为段内绝对秒数，所有数值有限。只允许数据，不允许脚本、外部模型路径或动态执行。

场景 `scene.json`：`version:1`、`id`、`name`、`order`、`summary`、`objects`。每个对象有 `id/name/kind/position`，可选 `assetId/rotation/size/color/height/build/ears/tail`。`position/rotation/size` 为三元数组。颜色为十六进制，尺寸为正。类型包括 `human`（人）、`animal`（拟人动物）、`quadruped`（四足动物）、`box/sphere/ground/slope/platform/bridge`。身高 0.1–30，体型 0.3–3，耳长 0–1，尾长 0–2。

分镜段 `previs.json`：

- `version:1/segmentId/duration`，时长大于 0、最多 3600 秒。
- `initial`：以对象 ID 为 key，值为 `{position:[x,y,z],yaw:弧度}`。每个角色必须声明；场景静物可沿用场景坐标。
- `tracks`：`[{objectId,keys:[{time,position,yaw}]}]`。同对象只设一条，时间严格递增。关键帧之间位置线性插值，转角取最短方向；角色移动应从 0 时刻明确起点。
- `actions`：`[{id,objectId,kind,start,end,side,target}]`。`kind` 仅支持 `stand/walk/run/turn/look/raise/point/hold/give/touch`；`side` 为 left/right，默认 right；look/point/give/touch 必须有目标对象 ID。动作区间不得越界。跨段持续动作可用非负 phaseSeconds 指定段首已经进行的秒数，避免抬手或步态从零重播；位置、持物与机位仍须显式初始化。
- `attachments`：`[{time,objectId,parentId,hand,offset}]`，将道具附着在角色手部。交接时为同一道具写新父对象。释放写 `parentId:null` 与显式世界 `position`。禁止将角色附着到手部。
- `shots`：`[{id,name,start,end,keys:[{time,position,target,fov,follow}]}]`。按时间排列并无缝覆盖全段，首关键帧位于本镜头起点。`target` 是视线点，`fov` 为 10–120 度；follow 指定对象后，position 和 target 是相对于该对象位置的偏移。相邻镜头硬切；同镜头关键帧插值实现推拉和运动。
- `dialogue`：`[{id,objectId?,start,end,text}]`，作为时间轴提示，不合成声音；声音在正式制作中处理。

参考样例中的 `scene` 应单独保存为场景 scene.json，`plan` 保存为分镜段 previs.json。不要把包装对象写成工程文件。

## 本段素材需求

`segment.md` 的 Frontmatter 可写 `assetReferences: [{objectId: old-fir, variantId: opened}]（`variantId` 可省略）`。引用当前场景对象，素材身份仍由对象的 `assetId` 定义，变体必须属于该素材。声明本段需要的静态主体、场景、关键道具与变体；这不是视频输入列表，视频仍须显式写 `referenceImages`。

界面结合本段轨迹、动作与目标、附着、对白和摄影跟随识别参与对象；不以全场景 `initial` 判定出场。未显式声明时纳入当前场景已绑定的整体场景素材。多个实例按素材与变体去重；参与角色漏绑提示待绑定，引用存在但无主图提示待生成。无独立素材需求的几何部件仍可点选修订，不列为缺图。
