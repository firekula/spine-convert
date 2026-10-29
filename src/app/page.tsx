'use client';

import { useCallback, useRef, useState } from 'react';
import {
  convert, inspect, VERSIONS, VERSION_STRINGS,
  type ConversionResult, type Detected, type SkeletonStats, type SpineVersion, type TargetFormat,
} from '@/lib/spine';
import type { ConvertOptions } from '@/lib/spine/types';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { useToast } from '@/hooks/use-toast';
import { ReportView } from '@/components/spine/report-view';
import { SupportMatrix } from '@/components/spine/support-matrix';
import {
  Bone, UploadCloud, FileJson, Binary, Download, RefreshCw, ChevronDown,
  Boxes, Layers, Speech, Clapperboard, Sparkles, ShieldCheck, Zap, TriangleAlert, Loader2,
} from 'lucide-react';

interface LoadedFile {
  name: string;
  size: number;
  buffer: ArrayBuffer;
  detected: Detected;
  stats: SkeletonStats;
  error?: string;
}

const SAMPLES: { label: string; file: string; desc: string }[] = [
  { label: 'alien 3.4', file: '/samples/alien-3.4.json', desc: 'JSON · 3.4' },
  { label: 'spineboy 3.6', file: '/samples/spineboy-3.6.json', desc: 'JSON · 3.6' },
  { label: 'spineboy 3.8', file: '/samples/spineboy-3.8.skel', desc: '二进制 · 3.8' },
  { label: 'celestial-circus 4.2', file: '/samples/celestial-circus-4.2.json', desc: 'JSON · 4.2 · 物理' },
];

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

export default function Home() {
  const { toast } = useToast();
  const [file, setFile] = useState<LoadedFile | null>(null);
  const [dragging, setDragging] = useState(false);
  const [targetVersion, setTargetVersion] = useState<SpineVersion>('3.8');
  const [versionString, setVersionString] = useState<string>(VERSION_STRINGS['3.8']);
  const [targetFormat, setTargetFormat] = useState<TargetFormat>('json');
  const [prettyJson, setPrettyJson] = useState(false);
  const [keepSequenceStatic, setKeepSequenceStatic] = useState(true);
  const [nonessential, setNonessential] = useState(true);
  const [result, setResult] = useState<ConversionResult | null>(null);
  const [converting, setConverting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const resultRef = useRef<HTMLDivElement>(null);

  const loadBuffer = useCallback((name: string, buffer: ArrayBuffer) => {
    setResult(null);
    try {
      const detected = (() => {
        try {
          return inspect(buffer, name).detected;
        } catch (e) {
          throw e;
        }
      })();
      const { stats } = inspect(buffer, name);
      setFile({ name, size: buffer.byteLength, buffer, detected, stats });
      if (detected.version) {
        setTargetVersion(detected.version);
        setVersionString(VERSION_STRINGS[detected.version]);
      }
    } catch (e) {
      setFile({
        name, size: buffer.byteLength, buffer,
        detected: { format: 'json', versionString: null, version: null },
        stats: emptyStats(),
        error: (e as Error).message,
      });
      toast({ title: '文件解析失败', description: (e as Error).message, variant: 'destructive' });
    }
  }, [toast]);

  const pickTargetVersion = useCallback((v: SpineVersion) => {
    setTargetVersion(v);
    /* 切换目标版本时同步重置版本串为该系列默认（用户可再手动改成编辑器实际补丁号） */
    setVersionString(VERSION_STRINGS[v]);
  }, []);

  const onFiles = useCallback((files: FileList | null) => {
    const f = files?.[0];
    if (!f) return;
    f.arrayBuffer().then((buf) => loadBuffer(f.name, buf));
  }, [loadBuffer]);

  const loadSample = useCallback(async (sample: typeof SAMPLES[number]) => {
    try {
      const resp = await fetch(sample.file);
      if (!resp.ok) throw new Error(`示例文件加载失败（${resp.status}）`);
      const buf = await resp.arrayBuffer();
      loadBuffer(sample.file.split('/').pop()!, buf);
    } catch (e) {
      toast({ title: '示例加载失败', description: (e as Error).message, variant: 'destructive' });
    }
  }, [loadBuffer, toast]);

  const doConvert = useCallback(() => {
    if (!file || file.error) return;
    setConverting(true);
    setTimeout(() => {
      try {
        const opts: ConvertOptions = {
          targetVersion,
          targetFormat,
          prettyJson,
          sequenceDowngrade: keepSequenceStatic ? 'keep-static' : 'remove',
          nonessential,
          versionString: versionString.trim() || undefined,
        };
        const res = convert(file.buffer, file.name, opts);
        setResult(res);
        if (!res.ok) {
          toast({ title: '转换失败', description: res.error, variant: 'destructive' });
        } else {
          requestAnimationFrame(() => resultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
        }
      } catch (e) {
        toast({ title: '转换异常', description: (e as Error).message, variant: 'destructive' });
      } finally {
        setConverting(false);
      }
    }, 30);
  }, [file, targetVersion, targetFormat, prettyJson, keepSequenceStatic, nonessential, versionString, toast]);

  const download = useCallback(() => {
    if (!result?.ok || !result.output) return;
    const { data, fileName, mime } = result.output;
    const blob = typeof data === 'string'
      ? new Blob([data], { type: mime })
      : new Blob([new Uint8Array(data as Uint8Array)], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(url);
  }, [result]);

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      {/* 背景网格 */}
      <div
        className="pointer-events-none fixed inset-0 opacity-[0.35]"
        style={{
          backgroundImage:
            'linear-gradient(rgba(63,63,70,0.25) 1px, transparent 1px), linear-gradient(90deg, rgba(63,63,70,0.25) 1px, transparent 1px)',
          backgroundSize: '44px 44px',
          maskImage: 'radial-gradient(ellipse 80% 50% at 50% 0%, black 40%, transparent 100%)',
        }}
      />
      <div className="relative mx-auto max-w-5xl px-4 pb-20 pt-14 sm:px-6">
        {/* ===== 头部 ===== */}
        <header className="mb-10 text-center">
          <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-teal-500/30 bg-teal-500/10 px-3 py-1 text-xs text-teal-300">
            <Sparkles className="h-3.5 w-3.5" />
            3.2 → 4.2 全版本 · JSON ↔ 二进制 · 浏览器本地转换
          </div>
          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
            Spine 骨骼数据<span className="text-teal-400">版本转换</span>工具
          </h1>
          <p className="mx-auto mt-3 max-w-2xl text-sm leading-6 text-zinc-400">
            上传 Spine 导出的 <code className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-xs text-zinc-300">.json</code> 或{' '}
            <code className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-xs text-zinc-300">.skel</code> 骨骼数据文件，
            转换为任意目标版本。高版本专属特性将自动降级为低版本兼容实现，或按策略舍弃——每一步都会在转换报告中说明。
          </p>
          <div className="mt-4 flex flex-wrap items-center justify-center gap-2 text-xs text-zinc-500">
            <span className="inline-flex items-center gap-1.5"><ShieldCheck className="h-3.5 w-3.5 text-emerald-500" />文件不离开浏览器</span>
            <span className="inline-flex items-center gap-1.5"><Zap className="h-3.5 w-3.5 text-amber-500" />毫秒级转换</span>
            <span className="inline-flex items-center gap-1.5"><Bone className="h-3.5 w-3.5 text-teal-400" />格式布局逐字节对齐官方运行时</span>
          </div>
        </header>

        {/* ===== 步骤 1：上传 ===== */}
        <section className="mb-5">
          <StepTitle n={1} done={!!file && !file.error}>选择文件</StepTitle>
          <div
            className={`relative rounded-xl border-2 border-dashed transition-colors ${
              dragging ? 'border-teal-400 bg-teal-500/5' : 'border-zinc-800 bg-zinc-900/40 hover:border-zinc-700'
            }`}
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => { e.preventDefault(); setDragging(false); onFiles(e.dataTransfer.files); }}
            onClick={() => inputRef.current?.click()}
          >
            <input
              ref={inputRef} type="file" className="hidden"
              accept=".json,.skel,.bin,application/json,application/octet-stream"
              onChange={(e) => onFiles(e.target.files)}
            />
            <div className="flex flex-col items-center gap-3 px-6 py-10 text-center">
              <UploadCloud className={`h-10 w-10 ${dragging ? 'text-teal-400' : 'text-zinc-600'}`} />
              <div>
                <p className="text-sm font-medium text-zinc-200">拖拽文件到此处，或点击选择</p>
                <p className="mt-1 text-xs text-zinc-500">支持 .json / .skel / .bin，单个文件</p>
              </div>
              <div className="mt-2 flex flex-wrap items-center justify-center gap-2" onClick={(e) => e.stopPropagation()}>
                <span className="text-xs text-zinc-600">或试试示例：</span>
                {SAMPLES.map((s) => (
                  <button
                    key={s.file}
                    onClick={() => loadSample(s)}
                    className="rounded-full border border-zinc-700 bg-zinc-800/60 px-3 py-1 text-xs text-zinc-300 transition-colors hover:border-teal-500/50 hover:text-teal-300"
                  >
                    {s.label} <span className="text-zinc-600">{s.desc}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* ===== 步骤 2：源信息 ===== */}
        {file && (
          <section className="mb-5">
            <StepTitle n={2} done>源文件信息</StepTitle>
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-5">
              {file.error ? (
                <div className="flex items-start gap-3 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
                  <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{file.error}</span>
                </div>
              ) : (
                <>
                  <div className="flex flex-wrap items-center gap-2">
                    {file.detected.format === 'json'
                      ? <Badge className="gap-1 border-amber-500/30 bg-amber-500/10 text-amber-300"><FileJson className="h-3 w-3" />JSON</Badge>
                      : <Badge className="gap-1 border-sky-500/30 bg-sky-500/10 text-sky-300"><Binary className="h-3 w-3" />二进制</Badge>}
                    {file.detected.versionString
                      ? <Badge className="border-teal-500/30 bg-teal-500/10 font-mono text-teal-300">Spine {file.detected.versionString}</Badge>
                      : <Badge className="border-orange-500/30 bg-orange-500/10 text-orange-300">版本未标注</Badge>}
                    <span className="font-mono text-xs text-zinc-500">{file.name} · {fmtSize(file.size)}</span>
                  </div>
                  {file.detected.note && (
                    <p className="mt-2 text-xs text-orange-300/90">{file.detected.note}</p>
                  )}
                  <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
                    <Stat icon={<Bone className="h-3.5 w-3.5" />} label="骨骼" value={file.stats.bones} />
                    <Stat icon={<Layers className="h-3.5 w-3.5" />} label="槽位" value={file.stats.slots} />
                    <Stat icon={<Boxes className="h-3.5 w-3.5" />} label="皮肤/附件" value={`${file.stats.skins}/${file.stats.attachments}`} />
                    <Stat icon={<Speech className="h-3.5 w-3.5" />} label="事件/动画" value={`${file.stats.events}/${file.stats.animations}`} />
                    <Stat icon={<Clapperboard className="h-3.5 w-3.5" />} label="时间轴" value={file.stats.timelines} />
                  </div>
                  {(file.stats.ik + file.stats.transform + file.stats.path + file.stats.physics) > 0 && (
                    <p className="mt-3 text-xs text-zinc-500">
                      约束：IK ×{file.stats.ik} · 变换 ×{file.stats.transform} · 路径 ×{file.stats.path}
                      {file.stats.physics > 0 && <span className="text-fuchsia-300"> · 物理 ×{file.stats.physics}</span>}
                    </p>
                  )}
                </>
              )}
            </div>
          </section>
        )}

        {/* ===== 步骤 3：目标设置 ===== */}
        {file && !file.error && (
          <section className="mb-5">
            <StepTitle n={3} done>目标版本与格式</StepTitle>
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-5">
              <Label className="text-xs text-zinc-500">目标 Spine 版本（无 3.9 —— 官方版本序列为 3.8 → 4.0）</Label>
              <div className="mt-2 grid grid-cols-5 gap-2 sm:grid-cols-10">
                {VERSIONS.map((v) => (
                  <button
                    key={v}
                    onClick={() => pickTargetVersion(v)}
                    className={`rounded-lg border px-2 py-2.5 font-mono text-sm transition-all ${
                      targetVersion === v
                        ? 'border-teal-400 bg-teal-500/15 text-teal-300 shadow-[0_0_12px_rgba(45,212,191,0.15)]'
                        : 'border-zinc-800 bg-zinc-900/60 text-zinc-400 hover:border-zinc-600 hover:text-zinc-200'
                    }`}
                  >
                    {v}
                  </button>
                ))}
              </div>

              {/* 写出版本号：Spine 4.0+ 编辑器要求导入数据的主次版本与编辑器完全一致 */}
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Label htmlFor="version-string" className="shrink-0 text-xs text-zinc-500">写出版本号</Label>
                <input
                  id="version-string"
                  value={versionString}
                  onChange={(e) => setVersionString(e.target.value)}
                  spellCheck={false}
                  className="h-8 w-32 shrink-0 rounded-lg border border-zinc-800 bg-zinc-900/60 px-2.5 font-mono text-xs text-zinc-200 outline-none transition-colors focus:border-teal-500/60"
                />
                <p className="min-w-52 flex-1 text-xs leading-5 text-zinc-600">
                  Spine 4.0+ 编辑器不再兼容导入邻近版本（如 4.1 编辑器只能号 4.1 数据），补丁号一般不影响导入；
                  若需与编辑器完全一致（如 4.2.45），可在此修改。
                </p>
              </div>

              <div className="mt-5 grid gap-5 sm:grid-cols-2">
                <div>
                  <Label className="text-xs text-zinc-500">输出格式</Label>
                  <RadioGroup
                    value={targetFormat}
                    onValueChange={(v) => setTargetFormat(v as TargetFormat)}
                    className="mt-2 flex gap-2"
                  >
                    <label className="flex-1">
                      <RadioGroupItem value="json" className="peer sr-only" />
                      <FormatCard selected={targetFormat === 'json'} icon={<FileJson className="h-4 w-4" />} title="JSON" desc=".json 文本，可读可 diff" />
                    </label>
                    <label className="flex-1">
                      <RadioGroupItem value="binary" className="peer sr-only" />
                      <FormatCard selected={targetFormat === 'binary'} icon={<Binary className="h-4 w-4" />} title="二进制" desc=".skel，体积更小加载更快" />
                    </label>
                  </RadioGroup>
                </div>
                <div className="space-y-3">
                  <Label className="text-xs text-zinc-500">转换选项</Label>
                  <div className="flex items-center justify-between rounded-lg border border-zinc-800 bg-zinc-900/60 px-3 py-2.5">
                    <span className="text-sm text-zinc-300">JSON 美化输出（缩进）</span>
                    <Switch checked={prettyJson} onCheckedChange={setPrettyJson} disabled={targetFormat !== 'json'} />
                  </div>
                  <div className="flex items-center justify-between rounded-lg border border-zinc-800 bg-zinc-900/60 px-3 py-2.5">
                    <span className="text-sm text-zinc-300">
                      序列帧降级策略
                      <span className="ml-1.5 text-xs text-zinc-500">{keepSequenceStatic ? '保留为静态附件' : '直接移除'}</span>
                    </span>
                    <Switch checked={keepSequenceStatic} onCheckedChange={setKeepSequenceStatic} />
                  </div>
                  <div className="flex items-center justify-between rounded-lg border border-zinc-800 bg-zinc-900/60 px-3 py-2.5">
                    <span className="text-sm text-zinc-300">
                      二进制附带元数据
                      <span className="ml-1.5 text-xs text-zinc-500">fps/图片路径/编辑器颜色</span>
                    </span>
                    <Switch checked={nonessential} onCheckedChange={setNonessential} disabled={targetFormat !== 'binary'} />
                  </div>
                </div>
              </div>

              <Button
                onClick={doConvert}
                disabled={converting}
                className="mt-6 w-full bg-teal-500 text-zinc-950 hover:bg-teal-400 disabled:opacity-50 h-11 text-base font-semibold"
              >
                {converting
                  ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />转换中…</>
                  : <><RefreshCw className="mr-2 h-4 w-4" />开始转换 → {targetVersion} {targetFormat === 'json' ? 'JSON' : '.skel'}</>}
              </Button>
            </div>
          </section>
        )}

        {/* ===== 步骤 4：结果 ===== */}
        {result && (
          <section className="mb-5" ref={resultRef}>
            <StepTitle n={4} done={result.ok}>{result.ok ? '转换完成' : '转换失败'}</StepTitle>
            {result.ok && result.output ? (
              <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-5">
                <div className="flex flex-wrap items-center gap-3">
                  <Button onClick={download} className="bg-teal-500 text-zinc-950 hover:bg-teal-400 h-11 gap-2 px-5 font-semibold">
                    <Download className="h-4 w-4" />
                    下载 {result.output.fileName}
                  </Button>
                  <div className="text-sm text-zinc-400">
                    <span className="font-mono text-zinc-300">{fmtSize(result.output.size)}</span>
                    <span className="mx-2 text-zinc-700">|</span>
                    源 {result.detected.versionString ?? '未知版本'} → 目标 {targetVersion}
                  </div>
                </div>
                <div className="mt-4">
                  <ReportView report={result.report} />
                </div>
                {typeof result.output.data === 'string' && (
                  <Collapsible className="group mt-4">
                    <CollapsibleTrigger className="inline-flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-300">
                      预览输出 JSON（前 4000 字符）
                      <ChevronDown className="h-3.5 w-3.5 transition-transform group-data-[state=open]:rotate-180" />
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      <pre className="mt-2 max-h-80 overflow-auto rounded-lg border border-zinc-800 bg-zinc-950 p-4 font-mono text-xs leading-5 text-zinc-400">
                        {(result.output.data as string).slice(0, 4000)}
                        {(result.output.data as string).length > 4000 ? '\n…' : ''}
                      </pre>
                    </CollapsibleContent>
                  </Collapsible>
                )}
              </div>
            ) : (
              <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-5 text-sm text-red-300">
                {result.error}
              </div>
            )}
          </section>
        )}

        {/* ===== 支持矩阵 ===== */}
        <div className="mb-5">
          <SupportMatrix />
        </div>

        {/* ===== 底部说明 ===== */}
        <footer className="mt-10 space-y-3 text-xs leading-6 text-zinc-600">
          <p>
            <span className="text-zinc-400">数据可靠性：</span>
            JSON 与二进制的读写布局逐字节对齐官方 spine-libgdx 运行时源码（3.4~4.2 各版本），并以官方示例导出文件
            （alien、spineboy、goblins、raptor、tank、celestial-circus 等含物理约束与序列帧的全特性样本）做过同源双格式互证与
            写读回环验证。
          </p>
          <p>
            <span className="text-zinc-400">二进制说明：</span>
            3.2/3.3 的二进制格式无官方运行时源码佐证（最早可考为 3.4），将按 3.4 布局尽力解析与写出，建议优先使用 JSON；
            4.x 的 .skel 中 hash 为 8 字节整数，转换后默认清空（hash 与内容不再对应）。
          </p>
          <p>
            <span className="text-zinc-400">隐私：</span>
            全部转换在浏览器本地完成（WebAssembly 级别的纯 JavaScript 实现），文件不会上传到任何服务器。
          </p>
        </footer>
      </div>
    </div>
  );
}

function emptyStats(): SkeletonStats {
  return { bones: 0, slots: 0, skins: 0, attachments: 0, ik: 0, transform: 0, path: 0, physics: 0, events: 0, animations: 0, timelines: 0 };
}

function StepTitle({ n, done, children }: { n: number; done?: boolean; children: React.ReactNode }) {
  return (
    <div className="mb-3 flex items-center gap-2.5">
      <span className={`flex h-6 w-6 items-center justify-center rounded-full border text-xs font-semibold ${
        done ? 'border-teal-500/50 bg-teal-500/15 text-teal-300' : 'border-zinc-700 bg-zinc-900 text-zinc-500'
      }`}>{n}</span>
      <h2 className="text-sm font-semibold text-zinc-200">{children}</h2>
    </div>
  );
}

function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: number | string }) {
  return (
    <div className="rounded-lg border border-zinc-800/80 bg-zinc-900/60 px-3 py-2.5">
      <div className="flex items-center gap-1.5 text-[11px] text-zinc-500">{icon}{label}</div>
      <div className="mt-0.5 font-mono text-lg font-semibold text-zinc-100">{value}</div>
    </div>
  );
}

function FormatCard({ selected, icon, title, desc }: { selected: boolean; icon: React.ReactNode; title: string; desc: string }) {
  return (
    <div className={`cursor-pointer rounded-lg border px-4 py-3 transition-all ${
      selected ? 'border-teal-400 bg-teal-500/10' : 'border-zinc-800 bg-zinc-900/60 hover:border-zinc-600'
    }`}>
      <div className={`flex items-center gap-2 text-sm font-medium ${selected ? 'text-teal-300' : 'text-zinc-300'}`}>{icon}{title}</div>
      <div className="mt-0.5 text-xs text-zinc-500">{desc}</div>
    </div>
  );
}
