# Spine 版本转换工具 - 工作日志

---
Task ID: 1
Agent: main
Task: 初始化全栈开发环境

Work Log:
- curl init-fullstack.sh 完成，Next.js 16 + Tailwind 4 + shadcn/ui 项目就绪（/home/z/my-project）
- dev server 自动运行于 3000 端口

Stage Summary:
- 项目骨架可用，等待业务代码

---
Task ID: 2
Agent: main
Task: 调研 Spine 3.2~4.2 各版本 JSON/二进制格式规范

Work Log:
- raw.githubusercontent.com 被墙、jsdelivr 对大仓库受限、GitHub API 限流（共享IP）
- 成功渠道：Maven Central 下载 spine-libgdx 官方源码 jar（3.5.51.1/3.6.53.1/3.7.94.1/3.8.99.1/4.0.18.1/4.1.0/4.2.12，Java 版与 TS 版格式一致）
- api.github.com + codeload.github.com 可用：获取 3.4.02 tag 的 Java 源码、3.6/3.8/4.0/4.2 分支完整示例资产（86 个 json+skel）
- npm @esotericsoftware/spine-core@4.2.120 作为 TS 侧参考
- 精读 8 个版本 SkeletonJson.java + SkeletonBinary.java，并用 Python 探针逐字节验证真实 .skel（3.4/3.6/3.8/4.0/4.2 全部对上官方 .json）

Stage Summary:
- 完整版本能力矩阵已确认（详见 research/spine-format-spec.md）
- JSON 家族：3.2~3.7 skins 为对象；3.8+ 为数组；4.0 槽位时间轴改名 rgba/rgb/rgba2/rgb2/alpha、约束字段改名 mixRotate/mixX 等；4.1 deform 节改名 attachments + sequence；4.2 物理约束 + inherit 时间轴 + 单轴时间轴(4.0+) + 逐值曲线(4.x)
- 二进制家族：3.4/3.5（无order/fps差异）/3.6+3.7（相同）/3.8（字符串表）/4.0/4.1（hash为long、逐值曲线、字节颜色）/4.2（referenceScale、物理、flags压缩、变长short）
- 3.x 曲线为共享（4元素），4.x 为逐值（4×n 元素）；JSON drawOrder 用槽位名，二进制用索引

---
Task ID: 3
Agent: main
Task: 实现核心转换库（JSON/二进制 读写 × 全版本）

Work Log:
- 构建 12 个模块共 ~6500 行：types（IR 超集）/spec（版本档案）/detect（格式版本探测）/jsonReader（容忍式解析）/jsonWriter（版本化序列化）/binReader/binWriter（六格式族）/color（曲线与颜色）/degrade（特性降级引擎）/convert（编排）
- 修复上一会话遗留的 14 项测试失败，根因全部定位：
  1. 4.x 曲线坐标系实为绝对坐标（时间/值），3.x 为归一化——重构为 curveSpace 字段 + 写出前统一转换（convertSkeletonCurves）
  2. 4.2 writeVerts 漏写 vertexCount（官方 readVertices 无条件先读 vc）——全部 4.2 顶点附件崩溃根源
  3. linkedmesh 3.4~4.1 漏写 color int32
  4. 皮肤条目顺序：官方文件按编辑器内部序（非槽位索引序），写入器改为保持 IR 原序、仅合并相邻同槽位
  5. region 3.4~4.1 的 color 位置在 height 之后（非 rotation 后）；4.1 sequence 在 color 后
  6. 4.2 IK/transform 约束 flags 的 mix 字段默认值为 0（Java 字段默认），bit5=mix≠0、bit6=显式浮点
  7. PositionMode 4.2 flags 位映射（bit0=1→percent）；SpacingMode 官方枚举序 [length,fixed,percent,proportional]（此前映射颠倒）
  8. 4.2 物理约束二进制存 massInverse=1/mass（JSON 为 mass）
  9. 4.x hash 为 8 字节大端 long，JSON 表示为同值 base64 —— 互转实现
  10. drawOrder 负偏移需 int32 回绕；4.2 point 附件需 flags 布局；4.2 骨骼 JSON 键名 inherit（非 transform）
  11. 槽位 dark 仅 -1 为无（0xFFFFFF 是合法白色）；事件 volume/balance 仅显式携带时设置
  12. 全线性曲线数组归一化（pruneLinear）；3.2~3.7 空非默认皮肤按官方丢弃
- 官方数据怪癖考证（非我方 bug，官方 json/skel 编辑器出写不一致）：个别 IK 约束 mix/bend、约束曲线省略、deform 稀疏策略差异——测试侧归一化处理并注释

Stage Summary:
- scripts/test-convert.ts：216/216 通过（官方同源双格式互证 7 对 + round-trip 9 文件 ×2 格式 + 跨版本冒烟 180 项 + 产物回读）
- scripts/test-att-types.ts：52/52 通过（合成附件 11 类型 × 5 版本 round-trip）
- 3.2/3.3 二进制按 3.4 家族尽力支持（UI 已注明）

---
Task ID: 4
Agent: main
Task: 构建 UI 与端到端验证

Work Log:
- layout.tsx：中文元数据、深色主题
- page.tsx：四步流程（拖拽/点选上传 + 4 个官方示例 → 源信息卡（格式/版本徽章 + 统计网格）→ 目标版本十宫格 + 格式切换 + 三项转换选项 → 转换结果（下载 + 分级报告 + JSON 预览））
- report-view.tsx：转换报告分级渲染（兼容转换/降级/舍弃/注意/说明 五级色标 + 汇总徽章 + 可折叠明细）
- support-matrix.tsx：版本能力矩阵表（16 项特性 × 10 版本支持勾选 + 降级策略列）
- public/samples/：alien-3.4 / spineboy-3.6 / spineboy-3.8.skel / celestial-circus-4.2 官方示例
- agent-browser 端到端验证：celestial 4.2→3.8（物理×30 移除 + 曲线×87 降级报告 ✓）、3.8skel→4.2json 升级、3.4→4.2 跨 8 版本升级（曲线空间转换 ✓）、二进制下载回读（60 骨骼/7 动画 ✓）、非 Spine 文件错误提示 ✓、页面无 console 错误
- next build 生产构建通过；tsc 零错误

Stage Summary:
- 完整可用的在线工具：http://localhost:3000
- 全部转换在浏览器本地完成（无上传），毫秒级速度

---
Task ID: 7
Agent: main
Task: 修复 3.6 JSON → 4.2 二进制导入报错（字节 51 NPE）+ 新增精确版本号选择

用户报错（Spine 4.2.22 Professional 导入）：
  Error at byte: 51 / [npe] Cannot invoke "String.isEmpty()" because "<local3>.F" is null

Work Log:
- 根因定位：官方 Java 读取器（3.4~4.2 全版本）对头部 imagesPath/audioPath 调用 isEmpty()，
  写成 null（0x00）会直接 NPE。3.6 JSON 无 audio 字段 → IR.audioPath=null → 旧写入器写 0x00。
  字节推演完全吻合：hash(8)+version(7)+xywh(16)+refScale(4)+nonessential(1)+fps(4)=40，
  imagesPath "./images/" 占 40-49，audioPath null 在 50 → 读取位置 51 抛 NPE。
- 修复 1（binWriter 头部）：imagesPath/audioPath 统一写 ?? ''（空串，官方容忍）；
  3.4~3.8 的字符串 hash 同理写 ''（官方同样 isEmpty()，clearHash 不再产生 null）
- 修复 2（皮肤索引）：写出口径与官方 skeletonData.skins 严格对齐 —— 默认皮肤仅在有条目时
  进索引表，否则 4.x deform 时间轴/linkedmesh 的 skinIndex 整体错位
- 修复 3（贝塞尔计数）：4.x 的 bezierCount 必须按"每含贝塞尔段消耗 valueCount 个槽位"精确计数
  （linear/stepped 值以等价贝塞尔占位）。旧算法按逐值统计，混合曲线时低报 → 官方 Java 预分配
  数组后 setBezier 越界。deform 计数排除末帧。
- 修复 4（占位曲线编码）：二进制 bezier 段内 linear 值必须写三分点控制点（旧端点控制点是 S 形
  缓动，动画会变形）；stepped 值写阶梯控制点 (t_end,v0)→(t_end,v1)
- 修复 5（jsonReader）：读取 skeleton.referenceScale（4.2 JSON 有此字段）
- 新功能（版本号精确控制）：ConvertOptions.versionString → binWriter/jsonWriter 透传；
  convert 校验格式与主次版本一致性（4.0+ 编辑器不兼容邻近版本导入）；UI 版本网格下新增
  "写出版本号"输入框，切换目标版本自动重置为该系列默认（3.2.08/…/4.2.22），可改成编辑器
  实际补丁号（如 4.2.45）
- 新增回归套件 scripts/test-official-compat.ts（51 项）：
  用户案例字节级复现（断言字节 50=0x01 非 0x00）、全版本头部严格校验（20 组）、版本串自定义、
  混合曲线贝塞尔计数与占位编码、空默认皮肤 skinIndex、3.6→4.x 结构等价 + mesh 保留
- 全量回归：216（原套件）+ 51（新套件）= 267 项全部通过；ESLint 无错误；
  浏览器端到端验证（加载 3.6 示例 → 选 4.2 → 二进制 → 转换成功可下载）

Stage Summary:
- 3.6 JSON → 4.2 二进制现已与官方 Spine 4.2.22 读取器逐字节兼容（NPE 根因消除）
- 同类隐患（3.4~3.8 hash null、皮肤索引错位、贝塞尔计数低报）一并修复
- 4.0+ 精确版本号需求落地：版本网格 + 可编辑版本串双保险
