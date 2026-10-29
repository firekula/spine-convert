/**
 * 特性降级引擎 —— 将 IR 规范化到目标版本能力范围。
 * 策略：优先"兼容实现"（如单轴时间轴合并、约束按 order 排序、序列帧转静态），
 * 无法等价表达时"舍弃"并记录报告。
 */
import type {
  SkeletonIR, SpineVersion, ConversionReport, ReportItem, AnimationIR,
  SlotTimelinesIR, BoneTimelinesIR, SingleKey, XYKey, ColorKey, Curve,
} from './types';
import { PROFILES, cmpVer } from './spec';
import { sampleTimeline, hexToRgba, rgbaToHex } from './color';

export class Reporter {
  items: ReportItem[] = [];
  add(level: ReportItem['level'], category: string, message: string, count?: number) {
    const last = this.items[this.items.length - 1];
    if (last && last.level === level && last.category === category && last.message === message) {
      last.count = (last.count ?? 1) + (count ?? 1);
      return;
    }
    this.items.push({ level, category, message, count });
  }
  get report(): ConversionReport { return { items: this.items }; }
}

export function degrade(ir: SkeletonIR, target: SpineVersion, rep: Reporter, opts: {
  sequenceDowngrade?: 'keep-static' | 'remove';
}): void {
  const P = PROFILES[target];

  /* ---------- 4.2 → 更低：物理约束 ---------- */
  if (!P.hasPhysics && ir.physics.length > 0) {
    let tlCount = 0;
    for (const anim of ir.animations) {
      tlCount += Object.keys(anim.physics).length;
      anim.physics = {};
    }
    rep.add('drop', '物理约束',
      `物理约束 ×${ir.physics.length} 已移除（${target} 不支持，骨骼将保持 setup 姿态）`, ir.physics.length);
    if (tlCount > 0) rep.add('drop', '物理约束', `物理约束时间轴 ×${tlCount} 已移除`, tlCount);
    ir.physics = [];
    // 皮肤级物理约束引用
    for (const skin of [ir.defaultSkin, ...ir.skins]) {
      if (skin && skin.constraints.physics.length) skin.constraints.physics = [];
    }
  }

  /* ---------- 4.2 → 更低：inherit 时间轴 ---------- */
  if (!P.hasInheritTimeline) {
    let n = 0;
    for (const anim of ir.animations) {
      for (const bt of Object.values(anim.bone)) {
        if (bt.inherit) { n += bt.inherit.length; delete bt.inherit; }
      }
    }
    if (n > 0) rep.add('drop', '骨骼继承', `骨骼继承(inherit)时间轴 ×${n} 已移除（${target} 不支持运行时切换继承模式）`, n);
  }

  /* ---------- 4.2 骨骼 icon / 皮肤 color 清理 ---------- */
  if (!P.hasBoneIcon) {
    for (const b of ir.bones) { b.icon = null; }
    for (const s of [ir.defaultSkin, ...ir.skins]) if (s) s.color = null;
  }

  /* ---------- 4.1 → 更低：序列帧 ---------- */
  if (!P.hasSequence) {
    let seqAtt = 0, seqTl = 0;
    const seqRemovedEntries: { skin: string; slot: string; name: string }[] = [];
    for (const skin of [ir.defaultSkin, ...ir.skins]) {
      if (!skin) continue;
      const kept: import('./types').SkinEntryIR[] = [];
      for (const e of skin.entries) {
        const hasSeq = 'sequence' in e.attachment && (e.attachment as { sequence?: unknown }).sequence != null;
        if (!hasSeq) { kept.push(e); continue; }
        seqAtt++;
        if (opts.sequenceDowngrade === 'remove') {
          seqRemovedEntries.push({ skin: skin.name, slot: e.slot, name: e.name });
        } else {
          // 保留为静态附件：去掉 sequence 字段，保留原始 path
          if ('sequence' in e.attachment) {
            (e.attachment as { sequence?: unknown }).sequence = null;
          }
          kept.push(e);
        }
      }
      skin.entries = kept;
    }
    if (seqRemovedEntries.length) {
      clearSlotReferences(ir, seqRemovedEntries);
    }
    for (const anim of ir.animations) {
      for (const slots of Object.values(anim.sequence)) {
        for (const atts of Object.values(slots)) seqTl += Object.keys(atts).length;
      }
      anim.sequence = {};
    }
    if (seqAtt > 0) {
      if (opts.sequenceDowngrade === 'remove') {
        rep.add('drop', '序列帧', `序列帧附件 ×${seqAtt} 已移除（${target} 不支持序列帧）`, seqAtt);
      } else {
        rep.add('convert', '序列帧',
          `序列帧附件 ×${seqAtt} 已转为静态附件（保留首帧路径，需确保图集含该区域）`, seqAtt);
      }
      if (seqTl > 0) rep.add('drop', '序列帧', `序列帧时间轴 ×${seqTl} 已移除`, seqTl);
    }
  }

  /* ---------- 4.0 → 3.x：单轴时间轴合并 ---------- */
  if (!P.hasSingleAxis) {
    let merged = 0;
    for (const anim of ir.animations) {
      for (const [boneName, bt] of Object.entries(anim.bone)) {
        const bone = ir.bones.find((b) => b.name === boneName);
        const m1 = mergeAxis2(bt.translate, bt.translatex, bt.translatey, 0, 0);
        if (m1.merged) {
          bt.translate = m1.result; delete bt.translatex; delete bt.translatey; merged += m1.count;
        }
        const m2 = mergeAxis2(bt.scale, bt.scalex, bt.scaley, bone?.scaleX ?? 1, bone?.scaleY ?? 1);
        if (m2.merged) {
          bt.scale = m2.result; delete bt.scalex; delete bt.scaley; merged += m2.count;
        }
        const m3 = mergeAxis2(bt.shear, bt.shearx, bt.sheary, bone?.shearX ?? 0, bone?.shearY ?? 0);
        if (m3.merged) {
          bt.shear = m3.result; delete bt.shearx; delete bt.sheary; merged += m3.count;
        }
      }
    }
    if (merged > 0) {
      rep.add('convert', '单轴时间轴',
        `translatex/y、scalex/y、shearx/y 时间轴 ×${merged} 已合并为双轴时间轴（按采样重采样，曲线在键时刻不一致时退化为线性）`, merged);
    }
  }

  /* ---------- 4.0 → 3.x：alpha 时间轴合并进 color ---------- */
  if (!P.hasAlphaTimeline) {
    let merged = 0;
    for (const anim of ir.animations) {
      for (const [slotName, st] of Object.entries(anim.slot)) {
        if (st.alpha == null) continue;
        const slot = ir.slots.find((s) => s.name === slotName);
        const setup = hexToRgba(slot?.color ?? 'ffffffff');
        const alphaKeys = st.alpha;
        const colorKeys = st.color ?? [];
        const times = new Set<number>([...alphaKeys.map((k) => k.time), ...colorKeys.map((k) => k.time)]);
        if (colorKeys.length > 0) times.add(0);
        const sorted = [...times].sort((a, b) => a - b);
        const newKeys: ColorKey[] = sorted.map((t) => {
          const c = colorKeys.length
            ? sampleTimeline(colorKeys, t,
              (i) => hexToRgba(colorKeys[i].color), (i) => colorKeys[i].curves, 4)
            : [setup[0], setup[1], setup[2], setup[3]];
          const a = sampleTimeline(alphaKeys, t,
            (i) => [alphaKeys[i].value], (i) => alphaKeys[i].curves, 1)[0];
          const finalA = colorKeys.length && alphaKeys.length === 0 ? c[3] : a * 255;
          return {
            time: t,
            color: rgbaToHex(c[0], c[1], c[2], colorKeys.length ? (alphaKeys.length ? a * 255 : c[3]) : finalA),
            curves: pickCurves(colorKeys, alphaKeys, t),
          };
        });
        st.color = newKeys;
        delete st.alpha;
        merged++;
      }
    }
    if (merged > 0) {
      rep.add('convert', '槽位颜色', `alpha 时间轴 ×${merged} 已合并进 color 时间轴`, merged);
    }
  }

  /* ---------- twoColor → color（target ≤ 3.5） ---------- */
  if (!P.hasTwoColor) {
    let n = 0;
    for (const anim of ir.animations) {
      for (const st of Object.values(anim.slot)) {
        if (st.twoColor && st.twoColor.length) {
          if (!st.color || st.color.length === 0) {
            st.color = st.twoColor.map((k) => ({
              time: k.time, color: k.light, curves: k.curves?.slice(0, 4),
            }));
          }
          n += st.twoColor.length;
          st.twoColor = undefined;
        }
      }
    }
    if (n > 0) rep.add('degrade', '双色 tint black',
      `双色(twoColor)时间轴 ×${n} 已降级为单色（丢弃 dark 颜色通道）`, n);
    let darkSlots = 0;
    for (const s of ir.slots) {
      if (s.dark) { s.dark = null; darkSlots++; }
    }
    if (darkSlots > 0) rep.add('drop', '双色 tint black', `槽位 dark 颜色 ×${darkSlots} 已移除`, darkSlots);
  }

  /* ---------- point / clipping 移除（target ≤ 3.5） ---------- */
  if (!P.hasPoint || !P.hasClipping) {
    const removed: { skin: string; slot: string; name: string }[] = [];
    let ptCount = 0, clipCount = 0;
    for (const skin of [ir.defaultSkin, ...ir.skins]) {
      if (!skin) continue;
      const kept: import('./types').SkinEntryIR[] = [];
      for (const e of skin.entries) {
        if (e.attachment.type === 'point' && !P.hasPoint) {
          ptCount++; removed.push({ skin: skin.name, slot: e.slot, name: e.name });
        } else if (e.attachment.type === 'clipping' && !P.hasClipping) {
          clipCount++; removed.push({ skin: skin.name, slot: e.slot, name: e.name });
        } else kept.push(e);
      }
      skin.entries = kept;
    }
    if (removed.length) {
      clearSlotReferences(ir, removed);
      let tl = 0;
      for (const anim of ir.animations) {
        for (const slots of Object.values(anim.deform)) {
          for (const atts of Object.values(slots)) {
            for (const name of removed.map((x) => x.name)) {
              if (atts[name]) { tl++; delete atts[name]; }
            }
          }
        }
      }
      if (ptCount) rep.add('drop', 'point 附件', `point 附件 ×${ptCount} 已移除（${target} 不支持）`, ptCount);
      if (clipCount) rep.add('drop', '剪切 clipping', `clipping 附件 ×${clipCount} 已移除（${target} 不支持，受剪裁区域将完整显示）`, clipCount);
      if (tl) rep.add('drop', 'point 附件', `对应变形时间轴 ×${tl} 已移除`, tl);
    }
  }

  /* ---------- 路径约束移除（target ≤ 3.3） ---------- */
  if (!P.hasPathConstraints && ir.path.length > 0) {
    const pathAttNames = new Set<string>();
    let pathAttCount = 0;
    for (const skin of [ir.defaultSkin, ...ir.skins]) {
      if (!skin) continue;
      const kept = skin.entries.filter((e) => {
        if (e.attachment.type === 'path') {
          pathAttNames.add(e.name); pathAttCount++;
          return false;
        }
        return true;
      });
      skin.entries = kept;
    }
    let tl = 0;
    for (const anim of ir.animations) {
      tl += Object.keys(anim.path).length;
      anim.path = {};
      for (const slots of Object.values(anim.deform)) {
        for (const atts of Object.values(slots)) {
          for (const name of pathAttNames) if (atts[name]) { tl++; delete atts[name]; }
        }
      }
    }
    rep.add('drop', '路径约束', `路径约束 ×${ir.path.length} 已移除（${target} 不支持路径约束）`, ir.path.length);
    if (pathAttCount) rep.add('drop', '路径约束', `path 附件 ×${pathAttCount} 已移除`, pathAttCount);
    if (tl) rep.add('drop', '路径约束', `相关时间轴 ×${tl} 已移除`, tl);
    ir.path = [];
  }

  /* ---------- 变换约束移除（target ≤ 3.2） ---------- */
  if (!P.hasTransformConstraints && ir.transform.length > 0) {
    let tl = 0;
    for (const anim of ir.animations) {
      tl += Object.keys(anim.transform).length;
      anim.transform = {};
    }
    rep.add('drop', '变换约束', `变换约束 ×${ir.transform.length} 已移除（${target} 不支持变换约束）`, ir.transform.length);
    if (tl) rep.add('drop', '变换约束', `变换约束时间轴 ×${tl} 已移除`, tl);
    ir.transform = [];
  }

  /* ---------- IK softness（target ≤ 3.7） ---------- */
  if (!P.hasIkSoftness) {
    let setupN = 0, keyN = 0;
    for (const c of ir.ik) {
      if (c.softness !== 0) { setupN++; c.softness = 0; }
    }
    for (const anim of ir.animations) {
      for (const keys of Object.values(anim.ik)) {
        for (const k of keys) {
          if (k.softness !== 0) keyN++;
          k.softness = 0;
        }
      }
    }
    if (setupN + keyN > 0) {
      rep.add('degrade', 'IK 柔软度', `IK softness 已归零（setup ×${setupN}、时间轴键 ×${keyN}；${target} 不支持）`, setupN + keyN);
    }
  }

  /* ---------- IK compress/stretch/uniform（target ≤ 3.6） ---------- */
  if (!P.hasIkStretch) {
    let n = 0;
    for (const c of ir.ik) {
      if (c.compress || c.stretch || c.uniform) n++;
      c.compress = false; c.stretch = false; c.uniform = false;
    }
    for (const anim of ir.animations) {
      for (const keys of Object.values(anim.ik)) {
        for (const k of keys) { k.compress = false; k.stretch = false; }
      }
    }
    if (n > 0) rep.add('degrade', 'IK 拉伸', `IK compress/stretch/uniform ×${n} 已关闭（${target} 不支持）`, n);
  }

  /* ---------- 事件 audio/volume/balance（target ≤ 3.6） ---------- */
  if (!P.hasEventAudio) {
    let n = 0;
    for (const e of ir.events) {
      if (e.audio != null) { n++; e.audio = null; e.volume = 1; e.balance = 0; }
    }
    for (const anim of ir.animations) {
      for (const k of anim.events) { k.volume = undefined; k.balance = undefined; }
    }
    if (n > 0) rep.add('drop', '事件音效', `事件音频路径 ×${n} 已移除（${target} 不支持事件音效）`, n);
  }

  /* ---------- skinRequired（target ≤ 3.7） ---------- */
  if (!P.hasSkinRequired) {
    for (const b of ir.bones) b.skinRequired = undefined;
    for (const c of [...ir.ik, ...ir.transform, ...ir.path, ...ir.physics]) c.skinRequired = false;
  }

  /* ---------- 皮肤级 bones/constraints（target ≤ 3.7） ---------- */
  if (!P.hasSkinBones) {
    let n = 0;
    for (const s of [ir.defaultSkin, ...ir.skins]) {
      if (!s) continue;
      n += s.bones.length + s.constraints.ik.length + s.constraints.transform.length
        + s.constraints.path.length + s.constraints.physics.length;
      s.bones = [];
      s.constraints = { ik: [], transform: [], path: [], physics: [] };
    }
    if (n > 0) {
      rep.add('drop', '皮肤约束', `皮肤级骨骼/约束引用 ×${n} 已移除（${target} 不支持按皮肤启用约束）`, n);
    }
  }

  /* ---------- 骨架 x/y（target ≤ 3.7） ---------- */
  if (!P.hasSkeletonOffset && (ir.x !== 0 || ir.y !== 0)) {
    rep.add('warn', '骨架偏移', `骨架偏移 x=${round(ir.x)}, y=${round(ir.y)} 已丢弃（${target} 不支持，渲染整体位置会偏移）`);
    ir.x = 0; ir.y = 0;
  }

  /* ---------- mixY / mixScaleY（target ≤ 3.8） ---------- */
  if (!P.hasMixY) {
    let warnN = 0;
    for (const c of ir.transform) {
      if (c.mixY !== c.mixX) warnN++;
      c.mixY = c.mixX;
      if (c.mixScaleY !== c.mixScaleX) warnN++;
      c.mixScaleY = c.mixScaleX;
    }
    for (const c of ir.path) {
      if (c.mixY !== c.mixX) warnN++;
      c.mixY = c.mixX;
    }
    /* 4.0 引入的 proportional 间距模式：低版本无等价实现，退化为 length（间距按路径长度分布） */
    if (P.num < 400) {
      let propN = 0;
      for (const c of ir.path) {
        if (c.spacingMode === 'proportional') { c.spacingMode = 'length'; propN++; }
      }
      if (propN > 0) {
        rep.add('degrade', '路径约束', `proportional 间距模式 ×${propN} 已退化为 length（${target} 不支持 proportional）`, propN);
      }
    }
    let tlWarn = 0;
    for (const anim of ir.animations) {
      for (const keys of Object.values(anim.transform)) {
        for (const k of keys) {
          if (k.mixY !== k.mixX) tlWarn++;
          k.mixY = k.mixX;
          if (k.mixScaleY !== k.mixScaleX) tlWarn++;
          k.mixScaleY = k.mixScaleX;
        }
      }
      for (const pt of Object.values(anim.path)) {
        if (pt.mix) for (const k of pt.mix) {
          if (k.mixY !== k.mixX) tlWarn++;
          k.mixY = k.mixX;
        }
      }
    }
    if (warnN + tlWarn > 0) {
      rep.add('degrade', '约束混合',
        `mixY/mixScaleY 与 X 轴不一致的约束 ×${warnN + tlWarn} 已合并为 X 轴取值（${target} 无独立 Y 轴混合）`, warnN + tlWarn);
    }
  }

  /* ---------- transform local/relative（target ≤ 3.5） ---------- */
  if (!(PROFILES[target].num >= 306)) {
    let n = 0;
    for (const c of ir.transform) {
      if (c.local || c.relative) n++;
      c.local = false; c.relative = false;
    }
    if (n > 0) {
      rep.add('degrade', '变换约束', `变换约束 local/relative 模式 ×${n} 已重置为 false（${target} 不支持，约束行为会有差异）`, n);
    }
  }

  /* ---------- blend screen（target ≤ 3.4） ---------- */
  if (!P.blendHasScreen) {
    let n = 0;
    for (const s of ir.slots) {
      if (s.blend === 'screen') { s.blend = 'normal'; n++; }
    }
    if (n > 0) rep.add('degrade', '混合模式', `screen 混合模式槽位 ×${n} 已转为 normal`, n);
  }

  /* ---------- transformMode → inheritRotation/inheritScale（target ≤ 3.4） ---------- */
  if (!P.hasTransformModes) {
    let approx = 0;
    for (const b of ir.bones) {
      switch (b.transformMode) {
        case 'normal': b.inheritRotation = true; b.inheritScale = true; break;
        case 'onlyTranslation': b.inheritRotation = false; b.inheritScale = false; break;
        case 'noRotationOrReflection': b.inheritRotation = false; b.inheritScale = true; approx++; break;
        case 'noScale': b.inheritRotation = true; b.inheritScale = false; break;
        case 'noScaleOrReflection': b.inheritRotation = true; b.inheritScale = false; approx++; break;
      }
    }
    if (approx > 0) {
      rep.add('degrade', '骨骼继承', `${approx} 个骨骼的 noRotationOrReflection / noScaleOrReflection 继承模式已近似映射为 3.4 的布尔继承`, approx);
    }
  }

  /* ---------- 约束 order（target ≤ 3.4）：按 order 排序等价实现 ---------- */
  if (!P.hasConstraintOrder) {
    const before = [
      ...ir.ik.map((c) => c.name), ...ir.transform.map((c) => c.name), ...ir.path.map((c) => c.name),
    ].join(',');
    ir.ik.sort((a, b) => a.order - b.order);
    ir.transform.sort((a, b) => a.order - b.order);
    ir.path.sort((a, b) => a.order - b.order);
    const after = [
      ...ir.ik.map((c) => c.name), ...ir.transform.map((c) => c.name), ...ir.path.map((c) => c.name),
    ].join(',');
    if (before !== after) {
      rep.add('convert', '约束顺序', `约束已按 order 字段重新排序输出（${target} 无 order 字段，按数组顺序应用约束）`);
    }
  }

  /* ---------- 逐值曲线一致性检查（target ≤ 3.8） ---------- */
  if (!P.hasPerValueCurves) {
    let inconsistent = 0;
    const check = (curves?: Curve[]) => {
      if (!curves || curves.length < 2) return;
      const first = curves[0];
      for (const c of curves) {
        if (!curveEq(c, first)) { inconsistent++; return; }
      }
    };
    for (const anim of ir.animations) {
      for (const bt of Object.values(anim.bone)) {
        for (const tl of [bt.translate, bt.scale, bt.shear]) {
          if (tl) for (const k of tl) check(k.curves);
        }
      }
      for (const st of Object.values(anim.slot)) {
        if (st.color) for (const k of st.color) check(k.curves);
        if (st.twoColor) for (const k of st.twoColor) check(k.curves);
      }
      for (const keys of Object.values(anim.ik)) for (const k of keys) check(k.curves);
      for (const keys of Object.values(anim.transform)) for (const k of keys) check(k.curves);
    }
    if (inconsistent > 0) {
      rep.add('degrade', '贝塞尔曲线',
        `×${inconsistent} 处各值独立的贝塞尔曲线已统一为 X 轴（首值）曲线（${target} 曲线在各值间共享）`, inconsistent);
    }
  }
}

function round(n: number): number { return Math.round(n * 100) / 100; }

function curveEq(a: Curve, b: Curve): boolean {
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  if ('stepped' in a && 'stepped' in b) return true;
  if ('bezier' in a && 'bezier' in b) return a.bezier.every((v, i) => v === b.bezier[i]);
  return false;
}

/** 清理槽位对已删除附件的引用及相关时间轴 */
function clearSlotReferences(ir: SkeletonIR, removed: { skin: string; slot: string; name: string }[]) {
  const removedNames = new Set(removed.map((r) => r.name));
  for (const slot of ir.slots) {
    if (slot.attachment && removedNames.has(slot.attachment)) slot.attachment = null;
  }
  for (const anim of ir.animations) {
    for (const [slotName, atts] of Object.entries(anim.deform)) {
      for (const [attName, keys] of Object.entries(atts)) {
        if (removedNames.has(attName) || removedNames.has(`${slotName}/${attName}`)) delete atts[attName];
      }
    }

  }
}

/** 合并 translate/translatex/translatey（或 scale/shear 系列）为双轴时间轴 */
function mergeAxis2(
  base: XYKey[] | undefined, ax: SingleKey[] | undefined, ay: SingleKey[] | undefined,
  setupX: number, setupY: number,
): { merged: boolean; result: XYKey[]; count: number } {
  if (!ax && !ay) return { merged: false, result: base ?? [], count: 0 };
  const src = base ?? [];
  const times = new Set<number>([...src.map((k) => k.time)]);
  if (ax) for (const k of ax) times.add(k.time);
  if (ay) for (const k of ay) times.add(k.time);
  if (src.length) times.add(0);
  if (ax && ax.length) times.add(0);
  if (ay && ay.length) times.add(0);
  const sorted = [...times].sort((a, b) => a - b);
  const sample = (keys: { time: number }[], i: (idx: number) => number[], c: (idx: number) => Curve[] | undefined, t: number, dflt: number) => {
    if (!keys.length) return dflt;
    return sampleTimeline(keys, t, i, c, 1)[0];
  };
  const result: XYKey[] = sorted.map((t) => {
    const x = ax && ax.length
      ? sample(ax, (i) => [ax[i].value], (i) => ax[i].curves, t, setupX)
      : (src.length ? sample(src, (i) => [src[i].x], (i) => src[i].curves, t, setupX) : setupX);
    const y = ay && ay.length
      ? sample(ay, (i) => [ay[i].value], (i) => ay[i].curves, t, setupY)
      : (src.length ? sample(src, (i) => [src[i].y], (i) => src[i].curves, t, setupY) : setupY);
    // 曲线：若该区间在源时间轴上是完整片段则沿用其曲线
    const curves: Curve[] = [
      segmentCurve(ax, src, t, 'x'),
      segmentCurve(ay, src, t, 'y'),
    ];
    return { time: t, x, y, curves };
  });
  // 清理与 setup 相同且无曲线的首键（可保留，运行时无害）——保留以保真
  const count = (ax?.length ?? 0) + (ay?.length ?? 0);
  return { merged: true, result, count };
}

/** 找到覆盖 t..t2 的源曲线片段 */
function segmentCurve(single: SingleKey[] | undefined, base: XYKey[] | undefined, t: number, axis: 'x' | 'y'): Curve {
  const findIdx = (keys: { time: number }[]) => {
    for (let i = 0; i < keys.length; i++) if (keys[i].time === t) return i;
    return -1;
  };
  if (single && single.length) {
    const i = findIdx(single);
    if (i >= 0 && i < single.length - 1) return single[i].curves?.[0] ?? null;
    return null;
  }
  if (base && base.length) {
    const i = findIdx(base);
    if (i >= 0 && i < base.length - 1) return base[i].curves?.[axis === 'x' ? 0 : 1] ?? null;
    return null;
  }
  return null;
}

/** alpha 合并时的曲线挑选：优先 color 的前 4 值曲线 */
function pickCurves(colorKeys: ColorKey[], alphaKeys: SingleKey[], t: number): Curve[] | undefined {
  if (!colorKeys.length) {
    const i = alphaKeys.findIndex((k) => k.time === t);
    if (i >= 0 && i < alphaKeys.length - 1) {
      return [null, null, null, alphaKeys[i].curves?.[0] ?? null];
    }
    return undefined;
  }
  const i = colorKeys.findIndex((k) => k.time === t);
  if (i >= 0 && i < colorKeys.length - 1) return colorKeys[i].curves;
  return undefined;
}
