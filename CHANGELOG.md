# 更新日志

本项目的所有显著变更都记录在此文件中。

格式约定参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [1.1.1] - 2026-10-29

### 新增

- **MIT 许可证**：代码以 MIT 开源（© 2026 firekula，见 LICENSE）；官方 Spine 示例资产仍归 Esoteric Software 所有，不在 MIT 授权范围内
- **GitHub Actions CI**（`.github/workflows/ci.yml`）：push / PR 触发，依次执行三套回归测试（319 项）→ ESLint → next build 生产构建 → tsc 类型检查；Bun 运行时，15 分钟超时保护
- README 顶部新增 CI 状态徽章与 License 徽章

### 修复

- `scripts/test-convert.ts` 7 处类型错误（`Object.values/entries` 对 any 入参的重载推导为 unknown，补显式断言），CI 的 tsc 检查得以通过

### 变更

- `package.json`：声明 `license: MIT` 字段，版本号 1.1.0 → 1.1.1
- ESLint 忽略 `research/**`（官方源码与导出文件参考副本，非本项目代码）
- tsconfig `exclude` 增加 `research` / `examples` / `skills`（官方参考副本与脚手架示例不参与类型检查；`next-env.d.ts` 不入库，CI 中 tsc 排在 next build 之后执行）

## [1.1.0] - 2026-10-28

### 修复

- **3.6 JSON → 4.2 二进制导入报错（Spine 4.2.22 报 "Error at byte: 51" NPE）**：
  - 根因为官方 Java 读取器对头部 `imagesPath`/`audioPath` 调用 `isEmpty()`，写入 null（0x00）直接崩溃；二进制头部路径字段统一写空串，3.4~3.8 的字符串 hash 同理
  - 皮肤索引口径与官方 `skeletonData.skins` 严格对齐（默认皮肤仅在有条目时进索引表），消除 4.x deform 时间轴 / linkedmesh 的 skinIndex 整体错位
  - 4.x `bezierCount` 改为按"每含贝塞尔段消耗 valueCount 个槽位"精确计数，修复混合曲线低报导致官方读取器 `setBezier` 越界
  - 二进制贝塞尔段内 linear/stepped 占位值改写三分点/阶梯控制点，消除 S 形缓动变形
  - jsonReader 补读 `skeleton.referenceScale`（4.2 JSON 字段）

### 新增

- **精确版本号写出**：版本网格下新增"写出版本号"输入框，切换目标版本自动填入该系列默认版本串（3.2.08 / … / 4.2.22），可改为编辑器实际补丁号（如 4.2.45）；主次版本与目标版本不一致时拦截并提示（4.0+ 编辑器不兼容邻近版本导入）
- 新增 `scripts/test-official-compat.ts` 回归套件（51 项）：用户案例字节级复现、全版本头部严格校验（20 组）、版本串自定义校验、混合曲线贝塞尔计数、空默认皮肤 skinIndex、3.6 → 4.x 结构等价与 mesh 保留

### 测试

- 全量回归 319 项通过（原 216 + 附件 52 + 兼容性 51）；ESLint 无错误；浏览器端到端验证通过

## [1.0.0] - 2026-10-27

### 新增

- **核心转换库**（`src/lib/spine/`，12 模块约 6500 行）：全版本 IR 中间表示、版本能力档案、格式/版本探测、JSON 与二进制（六格式族 A/B/B2/C/D/E/F）读写、颜色与贝塞尔曲线坐标系转换、特性降级引擎、转换编排
- **特性降级引擎**：高版本 → 低版本自动转换或舍弃并逐项报告（变换/路径约束、双色槽位、point/clipping 附件、单轴时间轴、逐值曲线、rgba 语义、sequence、物理约束等 30+ 条规则）
- **Web 界面**（Next.js 16 + Tailwind 4 + shadcn/ui）：拖拽/点选上传、4 个官方示例一键载入、源信息卡（格式/版本徽章 + 统计网格）、目标版本十宫格 + 格式切换 + 三项转换选项、转换结果下载与五级分级报告、版本能力矩阵表
- **格式规范考证**：精读官方 spine-libgdx 3.5 ~ 4.2 全系 SkeletonJson/SkeletonBinary 源码，Python 探针逐字节验证真实 .skel 文件，沉淀为 `research/spine-format-spec.md`
- **测试体系**：官方同源双格式互证（7 对）、round-trip（9 文件 × 2 格式）、跨版本冒烟（180 项）、附件类型 round-trip（11 类 × 5 版本），共 268 项
- 修复开发过程中的 14 项格式疑难：4.x 曲线绝对坐标系、4.2 writeVerts 顶点计数、linkedmesh 颜色、皮肤条目顺序、region 颜色位置、IK flags 默认值、PositionMode/SpacingMode 位映射、物理约束 massInverse、8 字节 hash 互转、drawOrder 负偏移回绕等

### 已知限制

- 3.2 / 3.3 二进制格式无官方源码佐证，按 3.4 家族尽力支持（UI 已注明，建议使用 JSON）
