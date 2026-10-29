'use client';

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Check, Minus, ArrowDownUp } from 'lucide-react';

interface Row {
  feature: string;
  since: string;
  downgrade: string;
}

/* 依据 research/spine-format-spec.md 的版本能力矩阵 */
const ROWS: Row[] = [
  { feature: '变换约束 transform', since: '3.3', downgrade: '→ 3.2：移除并警告' },
  { feature: '路径约束 path + path 附件', since: '3.4', downgrade: '→ 3.3：移除并警告' },
  { feature: 'blend=screen、约束 order', since: '3.5', downgrade: '→ 3.4：order 按排序输出（等价）；screen→normal' },
  { feature: '双色 tint black（dark 颜色）', since: '3.6', downgrade: '→ 3.5：丢弃 dark 通道' },
  { feature: 'point / clipping 附件', since: '3.6', downgrade: '→ 3.5：移除附件并清空槽位引用' },
  { feature: 'IK compress/stretch/uniform', since: '3.7', downgrade: '→ 3.6：丢弃（false）' },
  { feature: '事件音频 balance、二进制 audioPath', since: '3.7', downgrade: '→ 3.6：丢弃 balance' },
  { feature: 'IK softness、skinRequired、皮肤级 bones 列表', since: '3.8', downgrade: '→ 3.7：丢弃并警告' },
  { feature: 'skins 数组结构（3.2~3.7 为对象）', since: '3.8', downgrade: '纯格式映射，无损' },
  { feature: '单轴时间轴 translatex/y 等', since: '4.0', downgrade: '→ 3.8：采样合并为双轴时间轴' },
  { feature: '槽位时间轴 rgba/rgb/alpha、逐值贝塞尔', since: '4.0', downgrade: '→ 3.8：改名回 color/twoColor；rgb/alpha 合并进 color' },
  { feature: '约束字段改名 mixRotate/mixX + mixY', since: '4.0', downgrade: '→ 3.8：改回 rotateMix 等；不等值丢弃 mixY' },
  { feature: 'proportional 间距模式', since: '4.0', downgrade: '→ 3.8：退化为 length' },
  { feature: '序列帧 sequence（附件与时间轴）', since: '4.1', downgrade: '→ 4.0：保留为静态附件或移除（可选）' },
  { feature: '物理约束 + 物理时间轴', since: '4.2', downgrade: '→ 4.1：移除并警告' },
  { feature: 'inherit 时间轴、骨骼 icon/visible', since: '4.2', downgrade: '→ 4.1：移除（编辑器元数据不影响运行时）' },
];

const VERSIONS = ['3.2', '3.3', '3.4', '3.5', '3.6', '3.7', '3.8', '4.0', '4.1', '4.2'];
const vNum = (v: string) => parseInt(v.replace('.', ''), 10) * 10 + (v.startsWith('4.') && v !== '4.0' ? 0 : 0);

function verNum(v: string): number {
  const [a, b] = v.split('.').map(Number);
  return a * 100 + b;
}

export function SupportMatrix() {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-950/60">
      <div className="border-b border-zinc-800 px-5 py-4">
        <h2 className="text-base font-semibold text-zinc-100">版本能力矩阵与降级策略</h2>
        <p className="mt-1 text-sm text-zinc-500">
          特性向下兼容规则：高版本特性转为低版本等价实现，无法等价表达时舍弃并在转换报告中逐项列出。
          向上转换（低 → 高）为纯格式映射，不丢失数据。
        </p>
      </div>
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow className="border-zinc-800 hover:bg-transparent">
              <TableHead className="min-w-44 text-zinc-400">特性</TableHead>
              <TableHead className="text-zinc-400">引入版本</TableHead>
              {VERSIONS.map((v) => (
                <TableHead key={v} className="w-11 text-center text-zinc-400 font-mono text-xs">{v}</TableHead>
              ))}
              <TableHead className="min-w-56 text-zinc-400">降级策略（往低版本转换）</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {ROWS.map((row) => {
              const since = verNum(row.since);
              return (
                <TableRow key={row.feature} className="border-zinc-800/70">
                  <TableCell className="text-zinc-200 font-medium">{row.feature}</TableCell>
                  <TableCell className="font-mono text-teal-300 text-xs">{row.since}</TableCell>
                  {VERSIONS.map((v) => {
                    const ok = verNum(v) >= since;
                    return (
                      <TableCell key={v} className="text-center">
                        {ok ? (
                          <Check className="mx-auto h-3.5 w-3.5 text-emerald-500" />
                        ) : (
                          <Minus className="mx-auto h-3.5 w-3.5 text-zinc-700" />
                        )}
                      </TableCell>
                    );
                  })}
                  <TableCell className="text-zinc-500 text-xs leading-5">
                    <ArrowDownUp className="mr-1 inline h-3 w-3 text-zinc-600" />
                    {row.downgrade}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
