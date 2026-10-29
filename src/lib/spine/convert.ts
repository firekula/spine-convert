/**
 * 转换编排：探测 → 解析 → 降级 → 序列化。
 */
import type {
  ConvertOptions, ConversionReport, SkeletonIR, SkeletonStats, SpineVersion,
} from './types';
import { detect, type Detected } from './detect';
import { readJson } from './jsonReader';
import { writeJson } from './jsonWriter';
import { readBinary } from './binReader';
import { writeBinary } from './binWriter';
import { degrade, Reporter } from './degrade';
import { convertSkeletonCurves } from './color';
import { PROFILES, cmpVer, ALL_VERSIONS } from './spec';

export interface ConversionResult {
  ok: boolean;
  error?: string;
  detected: Detected;
  stats: SkeletonStats;
  report: ConversionReport;
  output?: {
    data: Uint8Array | string;
    fileName: string;
    mime: string;
    size: number;
  };
}

export function statsOf(ir: SkeletonIR): SkeletonStats {
  let attachments = 0;
  for (const s of [ir.defaultSkin, ...ir.skins]) {
    if (s) attachments += s.entries.length;
  }
  let timelines = 0;
  const countKeys = (o: unknown): number => {
    if (Array.isArray(o)) return o.length;
    if (o != null && typeof o === 'object') {
      return Object.values(o).reduce((s: number, v) => s + countKeys(v), 0);
    }
    return 0;
  };
  for (const anim of ir.animations) {
    timelines += countKeys(anim.bone) + countKeys(anim.slot) + countKeys(anim.ik)
      + countKeys(anim.transform) + countKeys(anim.path) + countKeys(anim.physics)
      + countKeys(anim.deform) + countKeys(anim.sequence) + anim.drawOrder.length + anim.events.length;
  }
  return {
    bones: ir.bones.length,
    slots: ir.slots.length,
    skins: (ir.defaultSkin ? 1 : 0) + ir.skins.length,
    attachments,
    ik: ir.ik.length,
    transform: ir.transform.length,
    path: ir.path.length,
    physics: ir.physics.length,
    events: ir.events.length,
    animations: ir.animations.length,
    timelines,
  };
}

export function convert(
  data: ArrayBuffer,
  fileName: string,
  options: ConvertOptions,
): ConversionResult {
  const rep = new Reporter();
  try {
    /* 1. 探测 */
    let detected: Detected;
    try {
      detected = detect(data, fileName);
    } catch (e) {
      return {
        ok: false, error: `格式识别失败：${(e as Error).message}`,
        detected: { format: 'binary', versionString: null, version: null },
        stats: emptyStats(), report: { items: [] },
      };
    }

    /* 2. 确定源版本 */
    let sourceVersion = detected.version;
    if (!sourceVersion) {
      if (options.sourceVersionOverride) {
        sourceVersion = options.sourceVersionOverride;
        rep.add('warn', '版本识别', `未在文件中检测到版本号，已按手动指定的 ${sourceVersion} 解析`);
      } else {
        // 无版本字段且未指定：JSON 按结构推断为 3.5 家族（spine 字段 3.4 起就有）
        sourceVersion = detected.format === 'json' ? '3.5' : '3.8';
        rep.add('warn', '版本识别',
          `未在文件中检测到版本号，已按 ${sourceVersion} 尽力解析。如结果异常请在选项中手动指定源版本`);
      }
    }

    /* 3. 解析 */
    let ir: SkeletonIR;
    if (detected.format === 'json') {
      const text = new TextDecoder('utf-8').decode(data);
      ir = readJson(text, sourceVersion);
    } else {
      if (sourceVersion === '3.2' || sourceVersion === '3.3') {
        rep.add('warn', '二进制兼容', '3.2/3.3 的二进制格式无官方运行时源码佐证，已按 3.4 家族尽力解析');
        sourceVersion = '3.4';
      }
      ir = readBinary(data, sourceVersion);
    }

    const stats = statsOf(ir);
    const target = options.targetVersion;
    if (!PROFILES[target]) {
      return { ok: false, error: `不支持的目标版本：${target}`, detected, stats, report: rep.report };
    }

    /* 4. 版本变化说明 */
    if (detected.version && detected.version !== target) {
      const dir = cmpVer(target, detected.version) < 0 ? '降级' : '升级';
      rep.add('info', '版本转换', `${detected.version} → ${target}（${dir}）`);
    } else if (!detected.version) {
      rep.add('info', '版本转换', `源版本未标注 → ${target}`);
    } else {
      rep.add('info', '格式转换', `版本不变（${target}），仅转换文件格式`);
    }

    /* 5. 曲线空间预转换：3.x 目标需要归一化曲线（降级层的采样合并依赖归一化）；
         4.x 目标由写出器在副本上自行转换（保持绝对坐标精度） */
    if (!target.startsWith('4.') && (ir.curveSpace ?? 'norm') === 'abs') {
      convertSkeletonCurves(ir, target);
    }

    /* 6. 降级 */
    degrade(ir, target, rep, {
      sequenceDowngrade: options.sequenceDowngrade ?? 'keep-static',
    });

    /* 6.5 自定义版本串校验（Spine 4.0+ 编辑器要求导入数据的主次版本与编辑器一致，补丁号可自定义） */
    let versionString: string | undefined;
    if (options.versionString != null && options.versionString !== '') {
      const vs = options.versionString.trim();
      if (!/^\d+\.\d+\.\d+\S*$/.test(vs)) {
        return {
          ok: false, error: `自定义版本串格式无效：“${vs}”，应形如 4.2.45`,
          detected, stats, report: rep.report,
        };
      }
      const m = /^(\d+)\.(\d+)\./.exec(vs)!;
      const majorMinor = `${m[1]}.${m[2]}`;
      if (majorMinor !== target) {
        return {
          ok: false,
          error: `自定义版本串 “${vs}” 的主次版本（${majorMinor}）与目标版本（${target}）不一致 —— 导入对应编辑器会被拒绝。请改为 ${target}.xx 或切换目标版本。`,
          detected, stats, report: rep.report,
        };
      }
      versionString = vs;
      rep.add('info', '版本串', `已按指定写入版本号 ${vs}`);
    }

    /* 7. hash 处理 */
    if (options.clearHash !== false && ir.hash) {
      rep.add('info', 'hash', '已清空骨架 hash（转换后 hash 与内容不再对应）');
    }

    /* 8. 序列化 */
    const baseName = fileName.replace(/\.(json|skel|bin|txt)$/i, '') || 'skeleton';
    if (options.targetFormat === 'json') {
      const text = writeJson(ir, target, {
        pretty: options.prettyJson ?? false,
        clearHash: options.clearHash ?? true,
        versionString,
      });
      return {
        ok: true, detected, stats, report: rep.report,
        output: {
          data: text,
          fileName: `${baseName}-${target.replace('.', '_')}.json`,
          mime: 'application/json',
          size: new TextEncoder().encode(text).length,
        },
      };
    }
    const bin = writeBinary(ir, target, {
      clearHash: options.clearHash ?? true,
      nonessential: options.nonessential ?? true,
      versionString,
    });
    if (options.nonessential === false) {
      rep.add('info', '二进制', '已省略 nonessential 元数据（fps、路径、编辑器颜色等）');
    }
    return {
      ok: true, detected, stats, report: rep.report,
      output: {
        data: bin,
        fileName: `${baseName}-${target.replace('.', '_')}.skel`,
        mime: 'application/octet-stream',
        size: bin.length,
      },
    };
  } catch (e) {
    return {
      ok: false,
      error: (e as Error).message || String(e),
      detected: { format: 'json', versionString: null, version: null },
      stats: emptyStats(),
      report: rep.report,
    };
  }
}

function emptyStats(): SkeletonStats {
  return {
    bones: 0, slots: 0, skins: 0, attachments: 0, ik: 0, transform: 0,
    path: 0, physics: 0, events: 0, animations: 0, timelines: 0,
  };
}

/** 仅供解析预览（不转换） */
export function inspect(data: ArrayBuffer, fileName: string, versionOverride?: SpineVersion): {
  detected: Detected;
  stats: SkeletonStats;
} {
  const detected = detect(data, fileName);
  let version = detected.version ?? versionOverride ?? (detected.format === 'json' ? '3.5' : '3.8');
  if (detected.format === 'json') {
    const ir = readJson(new TextDecoder('utf-8').decode(data), version);
    return { detected, stats: statsOf(ir) };
  }
  if (version === '3.2' || version === '3.3') version = '3.4';
  const ir = readBinary(data, version);
  return { detected, stats: statsOf(ir) };
}

export { ALL_VERSIONS };
