# 贡献指南

感谢你关注 spine-convert！无论是报告问题、改进文档、修正转换逻辑还是添加新特性，都非常欢迎。

在开始之前，请先通读 [README.md](README.md) 了解项目背景：本工具基于对官方运行时源码的逐字节逆向实证，实现 Spine 3.2 ~ 4.2 全版本 JSON ↔ 二进制互转。**格式正确性是本项目的生命线**——产出的二进制要与官方读取器逐字节兼容，这也是本指南用大量篇幅讲测试与证据的原因。

## 环境准备

- [Bun](https://bun.sh) 1.2+（本项目唯一运行时，测试与脚本都依赖它，无需另装 Node）
- Git

```bash
git clone git@github.com:firekula/spine-convert.git
cd spine-convert
bun install
bun run db:generate   # 生成 Prisma Client（首次必跑，否则 next build 报错）
bun run dev           # http://localhost:3000
```

## 项目结构速览

完整结构见 README"项目结构"一节。贡献者最常打交道的部分：

| 位置 | 说明 |
|---|---|
| `src/lib/spine/` | 核心转换库（纯 TypeScript、零依赖），全部格式逻辑在这里 |
| `src/app/`、`src/components/` | Next.js 界面 |
| `scripts/test-*.ts` | 三套回归测试（共 319 项） |
| `research/` | 官方源码考证与测试夹具（只读参考，勿手工修改夹具内容） |

## 开发工作流

1. 从 `main` 拉出功能分支，前缀用 `feat/`、`fix/`、`docs/`（如 `git checkout -b fix/bin-writer-38-string-table`）
2. 改动并完成本地自测（见下一节）
3. 推送并开 PR 到 `main`

## 提交与 PR 规范

- **提交信息**遵循 Conventional Commits，`type(scope): 中文描述`，与本仓库现有历史保持一致，例如：
  - `feat(convert): 支持 4.2 物理约束降级到 4.1`
  - `fix(bin-writer): 修正 3.8 字符串引用表偏移`
  - 其余常用 type：`docs` / `chore` / `refactor` / `test`
- **PR 标题**与提交信息同格式；描述需写清三件事：变更动机、实现要点、如何验证
- **合并前提**：CI 全绿——319 项回归测试、ESLint、生产构建、tsc 类型检查一项都不能少

## 测试要求（重点）

三套回归全部通过是任何代码改动合入的**硬性前提**：

```bash
bun run scripts/test-convert.ts          # 216 项：官方同源双格式互证 + round-trip + 跨版本冒烟
bun run scripts/test-att-types.ts        # 52 项：11 类附件 × 5 版本 round-trip
bun run scripts/test-official-compat.ts  # 51 项：官方读取器兼容性（字节级）
bun run lint                             # ESLint
bun run build                            # 生产构建（tsc 检查依赖的 next-env.d.ts 在此时生成）
```

- **修 bug**：先在对应测试套件中添加**失败用例**（用户案例类问题加进 `test-official-compat.ts`），再修复至用例通过——这是防止回归的唯一手段
- **新特性**：必须附带测试；涉及新版本或新格式族的，需同步更新 `research/spine-format-spec.md` 的能力矩阵
- 测试夹具位于 `research/spine/branch-*`（官方示例导出，已随仓库提供），**不要手工编辑夹具文件本身**；缺失时可按 README"参考资料"一节的脚本重新获取

## 格式逻辑贡献的特别要求

`src/lib/spine/` 的每一行为都要求有**官方源码依据**，不接受"试出来能跑就行"：

- 改动解析 / 序列化逻辑时，PR 描述中需注明依据：官方 spine-libgdx 对应版本的类名与行为（可参考 `research/spine/java-*` 下的解包源码，或从 Maven Central / spine-ts 仓库自行获取）
- 无法提供依据的推断式实现，只有在无官方源码佐证的版本边界内（目前仅 3.2 / 3.3 二进制）才可接受，且必须在代码注释与转换报告中标注其推断性质
- 曲线坐标系、字符串引用表、flags 压缩这几处历史坑最多，改动前先读 `research/spine-format-spec.md` 对应小节

## 报告 Issue

转换失败类问题请尽量附带（可脱敏）：

1. 源文件，或最小复现文件
2. 源版本 / 格式 → 目标版本 / 格式
3. 页面上的转换报告输出（五级分类列表）
4. 浏览器控制台报错文本或截图

## 版权与许可

- 提交 PR 即表示你同意你的代码以 [MIT](LICENSE) 随本项目发布
- **不得引入 Esoteric Software 官方资产**（jar 包、完整运行时源码等）；`research/spine/branch-*` 测试夹具与 `public/samples/` 是仅有的例外（版权归属见 README"版权说明"），且仅限官方示例导出文件
- 官方参考材料永远通过 `scripts/download-*.sh` 重新获取，不要把它们的完整副本提交进仓库

## 发布流程（维护者参考）

1. 合入 `main` 后确认 CI 与 Docker 流水线全绿
2. 更新 `CHANGELOG.md` 与 `package.json` 版本号（格式行为变化至少 minor，修复为 patch）
3. 打标签：`git tag v1.x.y && git push origin v1.x.y`
4. Docker 流水线自动构建双架构镜像推送 GHCR，并创建 GitHub Release 附离线镜像 tar.gz
