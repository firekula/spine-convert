'use client';

import type { ConversionReport, ReportLevel } from '@/lib/spine/types';
import { Badge } from '@/components/ui/badge';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { ChevronDown } from 'lucide-react';

const LEVEL_STYLE: Record<ReportLevel, { label: string; cls: string }> = {
  convert: { label: '兼容转换', cls: 'bg-sky-500/15 text-sky-300 border-sky-500/30' },
  degrade: { label: '降级', cls: 'bg-amber-500/15 text-amber-300 border-amber-500/30' },
  drop: { label: '舍弃', cls: 'bg-red-500/15 text-red-300 border-red-500/30' },
  warn: { label: '注意', cls: 'bg-orange-500/15 text-orange-300 border-orange-500/30' },
  info: { label: '说明', cls: 'bg-zinc-500/15 text-zinc-400 border-zinc-500/30' },
};

export function ReportView({ report }: { report: ConversionReport }) {
  if (!report.items.length) {
    return (
      <div className="rounded-lg border border-emerald-500/25 bg-emerald-500/5 px-4 py-3 text-sm text-emerald-300">
        完美转换：无需任何特性降级，目标版本完全兼容源数据的全部特性。
      </div>
    );
  }
  const counts = {
    convert: report.items.filter((i) => i.level === 'convert').length,
    degrade: report.items.filter((i) => i.level === 'degrade').length,
    drop: report.items.filter((i) => i.level === 'drop').length,
    warn: report.items.filter((i) => i.level === 'warn').length,
  };
  return (
    <Collapsible defaultOpen className="group">
      <div className="mb-2 flex flex-wrap items-center gap-1.5 text-xs">
        <span className="text-zinc-500 mr-1">转换报告</span>
        {counts.convert > 0 && <Badge className="border-sky-500/30 bg-sky-500/15 text-sky-300">{counts.convert} 兼容转换</Badge>}
        {counts.degrade > 0 && <Badge className="border-amber-500/30 bg-amber-500/15 text-amber-300">{counts.degrade} 降级</Badge>}
        {counts.drop > 0 && <Badge className="border-red-500/30 bg-red-500/15 text-red-300">{counts.drop} 舍弃</Badge>}
        {counts.warn > 0 && <Badge className="border-orange-500/30 bg-orange-500/15 text-orange-300">{counts.warn} 注意</Badge>}
        <CollapsibleTrigger className="ml-auto inline-flex items-center gap-1 text-zinc-500 hover:text-zinc-300 transition-colors">
          收起明细（{report.items.length} 条）
          <ChevronDown className="h-3.5 w-3.5 transition-transform group-data-[state=open]:rotate-180" />
        </CollapsibleTrigger>
      </div>
      <CollapsibleContent>
        <ul className="space-y-1.5 max-h-72 overflow-y-auto pr-1">
          {report.items.map((item, i) => {
            const s = LEVEL_STYLE[item.level];
            return (
              <li key={i} className="flex items-start gap-2.5 rounded-md border border-zinc-800/80 bg-zinc-900/60 px-3 py-2 text-sm">
                <span className={`mt-0.5 inline-flex shrink-0 items-center rounded border px-1.5 py-px text-[11px] leading-4 ${s.cls}`}>{s.label}</span>
                <span className="text-zinc-300 leading-5">
                  <span className="text-zinc-500">{item.category} · </span>
                  {item.message}
                  {item.count != null && item.count > 1 && <span className="text-zinc-500">（×{item.count}）</span>}
                </span>
              </li>
            );
          })}
        </ul>
      </CollapsibleContent>
    </Collapsible>
  );
}
