/**
 * 二进制 .skel 序列化器 —— 将 IR 写出为 3.4~4.2 各版本二进制格式。
 * 关键字节序规则（与官方读取器逐字节对齐）：
 * - 3.x 时间轴：[t, values, curve]×N（曲线紧随本帧之后）
 * - 4.x 普通时间轴：[t0 v0][t1 v1 curve0][t2 v2 curve1]...（曲线跟在下一帧数据之后）
 * - 4.x IK(4.0/4.1)：[t0 m0 s0 b0 c0 s0][t1 m1 s1 curve0 b1 c1 s1]...
 * - 4.x IK(4.2)：[flags0 t0 v0][flags1 t1 v1 curveFloats0]...（曲线位在下一帧 flags 中）
 * - 4.x deform：[t0 block0][t1 curve0 block1][t2 curve1 block2]...
 * - 3.x deform：[t0 block0 curve0][t1 block1 curve1]...
 */
import {
  type SkeletonIR, type SpineVersion, type AttachmentIR, type SkinIR,
  type AnimationIR, type Curve, type VerticesIR,
} from './types';
import { PROFILES, VERSION_STRINGS } from './spec';
import { BinWriter, hashToBytes64 } from './binIo';
import { hexToRgba, rgbaHexToInt32, rgbHexToInt32, DARK_NONE_INT, convertSkeletonCurves } from './color';

interface Ctx {
  boneIndex: Map<string, number>;
  slotIndex: Map<string, number>;
  skinIndexMap: Map<string, number>;
  hasStrTable: boolean;
  ref: (s: string | null) => void;
  inline: (s: string | null) => void;
}

export function writeBinary(
  ir: SkeletonIR,
  target: SpineVersion,
  opts: { clearHash?: boolean; nonessential?: boolean; versionString?: string },
): Uint8Array {
  const P = PROFILES[target];
  const b = P.bin;
  const is4 = target.startsWith('4.');
  const nonessential = opts.nonessential ?? true;
  /* 曲线空间与目标版本不一致时，在副本上转换（不改动调用方 IR） */
  const wantAbs = is4;
  if ((ir.curveSpace ?? 'norm') !== (wantAbs ? 'abs' : 'norm')) {
    ir = convertSkeletonCurves(structuredClone(ir), target);
  }
  const w = new BinWriter();

  /* ---------- 头部 ---------- */
  if (b.hashAsLong) {
    /* 4.x：hash 为 8 字节大端 int64（支持 base64/十进制/十六进制字符串形式）；0 = 空，官方容许 */
    const hb = opts.clearHash ? null : hashToBytes64(ir.hash);
    for (let i = 0; i < 8; i++) w.writeByte(hb ? hb[i] : 0);
  } else {
    /* 3.4~3.8：hash 为字符串，官方 Java 读取器调用 isEmpty()，null 会直接 NPE —— 必须写非 null */
    w.writeString(opts.clearHash ? '' : (ir.hash ?? ''));
  }
  w.writeString(opts.versionString ?? VERSION_STRINGS[target]);
  if (b.hasSkeletonXY) { w.writeFloat(ir.x); w.writeFloat(ir.y); }
  w.writeFloat(ir.width);
  w.writeFloat(ir.height);
  if (b.hasRefScale) w.writeFloat(ir.referenceScale || 100);
  w.writeBoolean(nonessential);
  if (nonessential) {
    if (b.hasFps) w.writeFloat(ir.fps || 30);
    /* 官方 Java 读取器对 imagesPath/audioPath 调用 isEmpty()，null 会 NPE（Spine 4.2 导入报错
     * “Error at byte: 51 / Cannot invoke String.isEmpty()”的根因）—— 统一写空串表示“无路径” */
    w.writeString(ir.imagesPath ?? '');
    if (b.hasAudioPath) w.writeString(ir.audioPath ?? '');
  }

  /* ---------- 字符串表占位（最后回填） ---------- */
  const tablePos = w.byteLength;
  if (b.hasStrTable) w.writeVarint(0);

  const ref = (s: string | null) => {
    if (s == null) { w.writeVarint(0); return; }
    w.registerString(s);
    w.writeStringRef(s);
  };
  const inline = (s: string | null) => w.writeString(s);

  /* ---------- 骨骼 ---------- */
  const boneIndex = new Map(ir.bones.map((x, i) => [x.name, i]));
  w.writeVarint(ir.bones.length);
  ir.bones.forEach((bone, i) => {
    w.writeString(bone.name);
    if (i > 0) w.writeVarint(bone.parent != null ? boneIndex.get(bone.parent) ?? 0 : 0);
    w.writeFloat(bone.rotation);
    w.writeFloat(bone.x); w.writeFloat(bone.y);
    w.writeFloat(bone.scaleX); w.writeFloat(bone.scaleY);
    w.writeFloat(bone.shearX); w.writeFloat(bone.shearY);
    w.writeFloat(bone.length);
    if (b.hasTransformModes) {
      const tm = ['normal', 'onlyTranslation', 'noRotationOrReflection', 'noScale', 'noScaleOrReflection'].indexOf(bone.transformMode);
      if (b.inheritAsByte) w.writeByte(tm);
      else w.writeVarint(tm);
    } else {
      w.writeBoolean(bone.inheritRotation !== false);
      w.writeBoolean(bone.inheritScale !== false);
    }
    if (b.hasSkinRequired) w.writeBoolean(!!bone.skinRequired);
    if (nonessential) {
      w.writeInt32(rgbaHexToInt32(bone.color ?? '9b9b9bff'));
      if (b.boneIconVisible) {
        w.writeString(bone.icon ?? null);
        w.writeBoolean(bone.visible !== false);
      }
    }
  });

  /* ---------- 槽位 ---------- */
  const slotIndex = new Map(ir.slots.map((x, i) => [x.name, i]));
  const blendIdx = (blend: string) => ['normal', 'additive', 'multiply', 'screen'].indexOf(blend);
  w.writeVarint(ir.slots.length);
  for (const s of ir.slots) {
    w.writeString(s.name);
    w.writeVarint(boneIndex.get(s.bone) ?? 0);
    w.writeInt32(rgbaHexToInt32(s.color));
    if (b.hasSlotDark) w.writeInt32(s.dark ? rgbHexToInt32(s.dark) : DARK_NONE_INT);
    if (b.hasStrTable) ref(s.attachment ?? null);
    else inline(s.attachment ?? null);
    w.writeVarint(blendIdx(s.blend));
    if (b.boneIconVisible && nonessential) w.writeBoolean(s.visible !== false);
  }

  /* ---------- IK 约束 ---------- */
  w.writeVarint(ir.ik.length);
  for (const c of ir.ik) {
    w.writeString(c.name);
    if (b.hasConstraintOrder) w.writeVarint(c.order);
    if (b.flagsConstraints) {
      w.writeVarint(c.bones.length);
      for (const bn of c.bones) w.writeVarint(boneIndex.get(bn) ?? 0);
      w.writeVarint(boneIndex.get(c.target) ?? 0);
      let flags = 0;
      if (c.skinRequired) flags |= 1;
      if (c.bendDirection === 1) flags |= 2;
      if (c.compress) flags |= 4;
      if (c.stretch) flags |= 8;
      if (c.uniform) flags |= 16;
      /* 官方语义：字段默认 mix=0 —— mix≠0 置 bit5；mix∉{0,1} 再置 bit6 并写浮点（bit5 单独置位读作 1） */
      if (c.mix !== 0) flags |= 32;
      if (c.mix !== 0 && c.mix !== 1) flags |= 64;
      if (c.softness !== 0) flags |= 128;
      w.writeByte(flags);
      if ((flags & 64) !== 0) w.writeFloat(c.mix);
      if (c.softness !== 0) w.writeFloat(c.softness);
      continue;
    }
    if (b.hasSkinRequired) w.writeBoolean(c.skinRequired);
    w.writeVarint(c.bones.length);
    for (const bn of c.bones) w.writeVarint(boneIndex.get(bn) ?? 0);
    w.writeVarint(boneIndex.get(c.target) ?? 0);
    w.writeFloat(c.mix);
    if (b.hasIkSoftness) w.writeFloat(c.softness);
    w.writeByte(c.bendDirection === 1 ? 1 : 255);
    if (b.hasIkStretch) {
      w.writeBoolean(c.compress);
      w.writeBoolean(c.stretch);
      w.writeBoolean(c.uniform);
    }
  }

  /* ---------- 变换约束 ---------- */
  if (!b.omitTransformPathSections) {
    w.writeVarint(ir.transform.length);
    for (const c of ir.transform) {
      w.writeString(c.name);
      if (b.hasConstraintOrder) w.writeVarint(c.order);
      if (b.flagsConstraints) {
        w.writeVarint(c.bones.length);
        for (const bn of c.bones) w.writeVarint(boneIndex.get(bn) ?? 0);
        w.writeVarint(boneIndex.get(c.target) ?? 0);
        let f1 = 0;
        if (c.skinRequired) f1 |= 1;
        if (c.local) f1 |= 2;
        if (c.relative) f1 |= 4;
        if (c.offsetRotation !== 0) f1 |= 8;
        if (c.offsetX !== 0) f1 |= 16;
        if (c.offsetY !== 0) f1 |= 32;
        if (c.offsetScaleX !== 0) f1 |= 64;
        if (c.offsetScaleY !== 0) f1 |= 128;
        w.writeByte(f1);
        if (c.offsetRotation !== 0) w.writeFloat(c.offsetRotation);
        if (c.offsetX !== 0) w.writeFloat(c.offsetX);
        if (c.offsetY !== 0) w.writeFloat(c.offsetY);
        if (c.offsetScaleX !== 0) w.writeFloat(c.offsetScaleX);
        if (c.offsetScaleY !== 0) w.writeFloat(c.offsetScaleY);
        let f2 = 0;
        if (c.offsetShearY !== 0) f2 |= 1;
        /* 官方语义：字段默认 mix=0 —— 非 0 才置位并写浮点 */
        if (c.mixRotate !== 0) f2 |= 2;
        if (c.mixX !== 0) f2 |= 4;
        if (c.mixY !== 0) f2 |= 8;
        if (c.mixScaleX !== 0) f2 |= 16;
        if (c.mixScaleY !== 0) f2 |= 32;
        if (c.mixShearY !== 0) f2 |= 64;
        w.writeByte(f2);
        if (c.offsetShearY !== 0) w.writeFloat(c.offsetShearY);
        if (c.mixRotate !== 0) w.writeFloat(c.mixRotate);
        if (c.mixX !== 0) w.writeFloat(c.mixX);
        if (c.mixY !== 0) w.writeFloat(c.mixY);
        if (c.mixScaleX !== 0) w.writeFloat(c.mixScaleX);
        if (c.mixScaleY !== 0) w.writeFloat(c.mixScaleY);
        if (c.mixShearY !== 0) w.writeFloat(c.mixShearY);
        continue;
      }
      if (b.hasSkinRequired) w.writeBoolean(c.skinRequired);
      w.writeVarint(c.bones.length);
      for (const bn of c.bones) w.writeVarint(boneIndex.get(bn) ?? 0);
      w.writeVarint(boneIndex.get(c.target) ?? 0);
      if (b.hasSlotDark) { w.writeBoolean(c.local); w.writeBoolean(c.relative); }
      w.writeFloat(c.offsetRotation);
      w.writeFloat(c.offsetX); w.writeFloat(c.offsetY);
      w.writeFloat(c.offsetScaleX); w.writeFloat(c.offsetScaleY);
      w.writeFloat(c.offsetShearY);
      w.writeFloat(c.mixRotate);
      if (is4) {
        w.writeFloat(c.mixX); w.writeFloat(c.mixY);
        w.writeFloat(c.mixScaleX); w.writeFloat(c.mixScaleY);
        w.writeFloat(c.mixShearY);
      } else {
        w.writeFloat(c.mixX); w.writeFloat(c.mixScaleX); w.writeFloat(c.mixShearY);
      }
    }
  }

  /* ---------- 路径约束 ---------- */
  if (!b.omitTransformPathSections) {
    w.writeVarint(ir.path.length);
    for (const c of ir.path) {
      w.writeString(c.name);
      if (b.hasConstraintOrder) w.writeVarint(c.order);
      if (b.flagsConstraints) {
        /* 4.2：路径约束 skinRequired 为独立布尔 */
        w.writeBoolean(c.skinRequired);
        w.writeVarint(c.bones.length);
        for (const bn of c.bones) w.writeVarint(boneIndex.get(bn) ?? 0);
        w.writeVarint(slotIndex.get(c.target) ?? 0);
        /* 官方枚举序：PositionMode [fixed, percent]（bit0=1 → percent）；SpacingMode [length, fixed, percent, proportional] */
        const pm = c.positionMode === 'percent' ? 1 : 0;
        const sm = ['length', 'fixed', 'percent', 'proportional'].indexOf(c.spacingMode);
        const rm = ['tangent', 'chain', 'chainScale'].indexOf(c.rotateMode);
        let flags = (pm & 1) | ((sm & 3) << 1) | ((rm & 3) << 3);
        if (c.offsetRotation !== 0) flags |= 128;
        w.writeByte(flags);
        if (c.offsetRotation !== 0) w.writeFloat(c.offsetRotation);
      } else {
        if (b.hasSkinRequired) w.writeBoolean(c.skinRequired);
        w.writeVarint(c.bones.length);
        for (const bn of c.bones) w.writeVarint(boneIndex.get(bn) ?? 0);
        w.writeVarint(slotIndex.get(c.target) ?? 0);
        w.writeVarint(c.positionMode === 'fixed' ? 0 : 1);
        w.writeVarint(['length', 'fixed', 'percent'].indexOf(c.spacingMode));
        w.writeVarint(['tangent', 'chain', 'chainScale'].indexOf(c.rotateMode));
        w.writeFloat(c.offsetRotation);
      }
      w.writeFloat(c.position);
      w.writeFloat(c.spacing);
      if (is4) {
        w.writeFloat(c.mixRotate); w.writeFloat(c.mixX); w.writeFloat(c.mixY);
      } else {
        w.writeFloat(c.mixRotate); w.writeFloat(c.mixX);
      }
    }
  }

  /* ---------- 物理约束（4.2） ---------- */
  if (b.hasPhysics) {
    w.writeVarint(ir.physics.length);
    for (const c of ir.physics) {
      w.writeString(c.name);
      w.writeVarint(c.order);
      w.writeVarint(boneIndex.get(c.bone) ?? 0);
      let f1 = 0;
      if (c.skinRequired) f1 |= 1;
      if (c.x !== 0) f1 |= 2;
      if (c.y !== 0) f1 |= 4;
      if (c.rotate !== 0) f1 |= 8;
      if (c.scaleX !== 0) f1 |= 16;
      if (c.shearX !== 0) f1 |= 32;
      if (c.limit !== 5000) f1 |= 64;
      if (c.mass !== 1) f1 |= 128;
      w.writeByte(f1);
      if (c.x !== 0) w.writeFloat(c.x);
      if (c.y !== 0) w.writeFloat(c.y);
      if (c.rotate !== 0) w.writeFloat(c.rotate);
      if (c.scaleX !== 0) w.writeFloat(c.scaleX);
      if (c.shearX !== 0) w.writeFloat(c.shearX);
      if (c.limit !== 5000) w.writeFloat(c.limit);
      w.writeByte(Math.max(1, Math.round(c.fps || 60)));
      w.writeFloat(c.inertia); w.writeFloat(c.strength); w.writeFloat(c.damping);
      if (c.mass !== 1) w.writeFloat(c.mass === 0 ? 0 : 1 / c.mass); /* 官方存 massInverse */
      w.writeFloat(c.wind); w.writeFloat(c.gravity);
      let f2 = 0;
      if (c.inertiaGlobal) f2 |= 1;
      if (c.strengthGlobal) f2 |= 2;
      if (c.dampingGlobal) f2 |= 4;
      if (c.massGlobal) f2 |= 8;
      if (c.windGlobal) f2 |= 16;
      if (c.gravityGlobal) f2 |= 32;
      if (c.mixGlobal) f2 |= 64;
      if (c.mix !== 1) f2 |= 128;
      w.writeByte(f2);
      if (c.mix !== 1) w.writeFloat(c.mix);
    }
  }

  /* ---------- 皮肤 ---------- */
  /* 注意：官方 skeletonData.skins 数组仅在实际写出的皮肤上建立索引 ——
   * 默认皮肤只在有条目时写出（官方 readSkin 对 slotCount==0 返回 null），
   * 因此这里的索引表必须与写出内容严格一致，否则 4.x 的 deform 皮肤索引与 linkedmesh 皮肤索引会整体错位 */
  const defaultSkinWritten = ir.defaultSkin && ir.defaultSkin.entries.length > 0 ? ir.defaultSkin : null;
  const skins = [defaultSkinWritten, ...ir.skins].filter(Boolean) as SkinIR[];
  const skinIndexMap = new Map(skins.map((s, i) => [s.name, i]));
  const ctx: Ctx = { boneIndex, slotIndex, skinIndexMap, hasStrTable: b.hasStrTable, ref, inline };

  const writeSkin = (skin: SkinIR | null, isDefault: boolean) => {
    const entries = isDefault ? ir.defaultSkin?.entries ?? [] : skin!.entries;
    /* 按原序分组：仅合并相邻同槽位条目（官方文件为编辑器内部顺序，不按槽位索引重排） */
    const groups: { si: number; list: { name: string; attachment: AttachmentIR }[] }[] = [];
    for (const e of entries) {
      const si = slotIndex.get(e.slot);
      if (si == null) continue;
      const last = groups[groups.length - 1];
      if (last && last.si === si) last.list.push({ name: e.name, attachment: e.attachment });
      else groups.push({ si, list: [{ name: e.name, attachment: e.attachment }] });
    }
    if (isDefault) {
      w.writeVarint(groups.length);
      if (groups.length === 0) return;
    } else {
      const s = skin!;
      if (b.hasStrTable && !b.flagsConstraints) ref(s.name);
      else inline(s.name);
      if (b.skinColor && nonessential) w.writeInt32(rgbaHexToInt32(s.color ?? 'ffffffff'));
      if (b.hasSkinBones) {
        w.writeVarint(s.bones.length);
        for (const bn of s.bones) w.writeVarint(boneIndex.get(bn) ?? 0);
        const ikIdx = new Map(ir.ik.map((c, i) => [c.name, i]));
        const tfIdx = new Map(ir.transform.map((c, i) => [c.name, i]));
        const pathIdx = new Map(ir.path.map((c, i) => [c.name, i]));
        const phIdx = new Map(ir.physics.map((c, i) => [c.name, i]));
        w.writeVarint(s.constraints.ik.length);
        for (const n of s.constraints.ik) w.writeVarint(ikIdx.get(n) ?? 0);
        w.writeVarint(s.constraints.transform.length);
        for (const n of s.constraints.transform) w.writeVarint(tfIdx.get(n) ?? 0);
        w.writeVarint(s.constraints.path.length);
        for (const n of s.constraints.path) w.writeVarint(pathIdx.get(n) ?? 0);
        if (b.hasPhysics) {
          w.writeVarint(s.constraints.physics.length);
          for (const n of s.constraints.physics) w.writeVarint(phIdx.get(n) ?? 0);
        }
      }
      w.writeVarint(groups.length);
    }
    for (const g of groups) {
      w.writeVarint(g.si);
      w.writeVarint(g.list.length);
      for (const e of g.list) {
        if (b.hasStrTable) ref(e.name);
        else inline(e.name);
        writeAttachment(w, e.attachment, e.name, target, nonessential, ctx);
      }
    }
  };

  writeSkin(defaultSkinWritten, true);
  /* 3.2~3.7：官方 readSkin 对空非默认皮肤返回 null（丢弃），此处同样跳过 */
  const writableSkins = b.hasStrTable ? ir.skins : ir.skins.filter((s) => s.entries.length > 0);
  w.writeVarint(writableSkins.length);
  for (const s of writableSkins) writeSkin(s, false);

  /* ---------- 事件 ---------- */
  w.writeVarint(ir.events.length);
  for (const e of ir.events) {
    if (b.hasStrTable && !b.flagsConstraints) ref(e.name);
    else inline(e.name);
    w.writeVarintZ(e.int);
    w.writeFloat(e.float);
    w.writeString(e.string);
    if (b.hasEventAudio) {
      w.writeString(e.audio);
      if (e.audio != null) {
        w.writeFloat(e.volume);
        w.writeFloat(e.balance);
      }
    }
  }

  /* ---------- 动画 ---------- */
  w.writeVarint(ir.animations.length);
  for (const anim of ir.animations) {
    w.writeString(anim.name);
    writeAnimation(w, anim, ir, target, { ...ctx, skins });
  }

  /* ---------- 回填字符串表 ---------- */
  let out = w.toUint8Array();
  if (b.hasStrTable) {
    const tw = new BinWriter();
    tw.writeVarint(w.strings.length);
    for (const s of w.strings) tw.writeString(s);
    const tableBytes = Array.from(tw.toUint8Array());
    out = new Uint8Array([
      ...Array.from(out.slice(0, tablePos)),
      ...tableBytes,
      ...Array.from(out.slice(tablePos + 1)),
    ]);
  }
  return out;
}

/* ---------------- 附件写出 ---------------- */

function vertexCountOf(v: VerticesIR): number {
  if (!v.weighted) return v.vertices.length / 2;
  const bones = v.bones ?? [];
  let n = 0, i = 0;
  while (i < bones.length) {
    const c = bones[i];
    i += 1 + c;
    n++;
  }
  return n;
}

function writeVerts(w: BinWriter, verts: VerticesIR, weightedFlagExplicit: boolean, explicitVc: boolean) {
  const vc = vertexCountOf(verts);
  if (!verts.weighted) {
    if (explicitVc) w.writeVarint(vc);
    if (weightedFlagExplicit) w.writeBoolean(false);
    w.writeFloatArray(verts.vertices);
    return;
  }
  if (explicitVc) w.writeVarint(vc);
  if (weightedFlagExplicit) w.writeBoolean(true);
  const bones = verts.bones ?? [];
  let bi = 0, wi = 0;
  while (bi < bones.length) {
    const n = bones[bi]; bi += 1;
    w.writeVarint(n);
    for (let k = 0; k < n; k++) {
      w.writeVarint(bones[bi]);
      w.writeFloat(verts.vertices[wi]);
      w.writeFloat(verts.vertices[wi + 1]);
      w.writeFloat(verts.vertices[wi + 2]);
      bi += 1; wi += 3;
    }
  }
}

function writeSequence(w: BinWriter, seq: { count: number; start: number; digits: number; setup: number } | null | undefined, boolPrefix: boolean) {
  if (boolPrefix) {
    w.writeBoolean(!!seq);
    if (!seq) return;
  } else if (!seq) return;
  const s = seq!;
  w.writeVarint(s.count);
  w.writeVarint(s.start);
  w.writeVarint(s.digits);
  w.writeVarint(s.setup);
}

function writeAttachment(w: BinWriter, a: AttachmentIR, attName: string, target: SpineVersion, nonessential: boolean, ctx: Ctx) {
  const b = PROFILES[target].bin;
  const is42 = b.attachmentFlags;
  const nameDiff = a.name !== attName;

  switch (a.type) {
    case 'region': {
      const pathNeeded = a.path != null && a.path !== a.name;
      if (is42) {
        let flags = 0;
        if (nameDiff) flags |= 8;
        if (pathNeeded) flags |= 16;
        const colorNeeded = a.color != null && a.color !== 'ffffffff';
        if (colorNeeded) flags |= 32;
        if (a.sequence) flags |= 64;
        if (a.rotation !== 0) flags |= 128;
        w.writeByte(flags);
        if (nameDiff) ctx.ref(a.name);
        if (pathNeeded) ctx.ref(a.path);
        if (colorNeeded) w.writeInt32(rgbaHexToInt32(a.color!));
        if (a.sequence) writeSequence(w, a.sequence, false);
        if (a.rotation !== 0) w.writeFloat(a.rotation);
      } else {
        if (b.hasStrTable) ctx.ref(nameDiff ? a.name : null);
        else ctx.inline(nameDiff ? a.name : null);
        w.writeByte(0);
        if (b.hasStrTable) ctx.ref(pathNeeded ? a.path : null);
        else ctx.inline(pathNeeded ? a.path : null);
        /* 3.4~4.1 官方布局：rotation, x, y, scaleX, scaleY, width, height, color, [sequence(4.1)] */
        w.writeFloat(a.rotation);
        w.writeFloat(a.x); w.writeFloat(a.y);
        w.writeFloat(a.scaleX); w.writeFloat(a.scaleY);
        w.writeFloat(a.width); w.writeFloat(a.height);
        w.writeInt32(rgbaHexToInt32(a.color ?? 'ffffffff'));
        if (b.hasSequence) writeSequence(w, a.sequence, true);
        return;
      }
      w.writeFloat(a.x); w.writeFloat(a.y);
      w.writeFloat(a.scaleX); w.writeFloat(a.scaleY);
      w.writeFloat(a.width); w.writeFloat(a.height);
      return;
    }
    case 'boundingbox': {
      if (is42) {
        let flags = 1;
        if (nameDiff) flags |= 8;
        if (a.verts.weighted) flags |= 16;
        w.writeByte(flags);
        if (nameDiff) ctx.ref(a.name);
        /* 4.2：readVertices 无条件先读 vertexCount */
        writeVerts(w, a.verts, false, true);
      } else {
        if (b.hasStrTable) ctx.ref(nameDiff ? a.name : null);
        else ctx.inline(nameDiff ? a.name : null);
        w.writeByte(1);
        writeVerts(w, a.verts, true, true);
      }
      if (nonessential) w.writeInt32(rgbaHexToInt32(a.color ?? '606060ff'));
      return;
    }
    case 'mesh': {
      const pathNeeded = a.path != null && a.path !== a.name;
      if (is42) {
        let flags = 2;
        if (nameDiff) flags |= 8;
        if (pathNeeded) flags |= 16;
        const colorNeeded = a.color != null && a.color !== 'ffffffff';
        if (colorNeeded) flags |= 32;
        if (a.sequence) flags |= 64;
        if (a.verts.weighted) flags |= 128;
        w.writeByte(flags);
        if (nameDiff) ctx.ref(a.name);
        if (pathNeeded) ctx.ref(a.path);
        if (colorNeeded) w.writeInt32(rgbaHexToInt32(a.color!));
        if (a.sequence) writeSequence(w, a.sequence, false);
        w.writeVarint(a.hull);
        /* 4.2：readVertices 无条件先读 vertexCount；triangles 数量由 (vc*2-hull-2)*3 派生，必须严格匹配 */
        const vc42 = vertexCountOf(a.verts);
        const expectTri = (vc42 * 2 - a.hull - 2) * 3;
        if (a.triangles.length !== expectTri) {
          throw new Error(`网格附件 "${a.name}" 的三角形数量(${a.triangles.length})与 4.2 格式派生公式不符(应为 ${expectTri}，vc=${vc42}，hull=${a.hull})`);
        }
        writeVerts(w, a.verts, false, true);
        w.writeFloatArray(a.uvs);
        w.writeShortValuesVarint(a.triangles);
        if (nonessential) {
          w.writeVarint(a.edges?.length ?? 0);
          if (a.edges?.length) w.writeShortValuesVarint(a.edges);
          w.writeFloat(a.width); w.writeFloat(a.height);
        }
      } else {
        if (b.hasStrTable) ctx.ref(nameDiff ? a.name : null);
        else ctx.inline(nameDiff ? a.name : null);
        w.writeByte(2);
        if (b.hasStrTable) ctx.ref(pathNeeded ? a.path : null);
        else ctx.inline(pathNeeded ? a.path : null);
        w.writeInt32(rgbaHexToInt32(a.color ?? 'ffffffff'));
        const vc = vertexCountOf(a.verts);
        w.writeVarint(vc);
        w.writeFloatArray(a.uvs);
        w.writeShortArrayRaw(a.triangles);
        writeVerts(w, a.verts, true, false);
        w.writeVarint(a.hull);
        if (b.hasSequence) writeSequence(w, a.sequence, true);
        if (nonessential) {
          w.writeShortArrayRaw(a.edges ?? []);
          w.writeFloat(a.width); w.writeFloat(a.height);
        }
      }
      return;
    }
    case 'linkedmesh': {
      const pathNeeded = a.path != null && a.path !== a.name;
      if (is42) {
        let flags = 3;
        if (nameDiff) flags |= 8;
        if (pathNeeded) flags |= 16;
        const colorNeeded = a.color != null && a.color !== 'ffffffff';
        if (colorNeeded) flags |= 32;
        if (a.sequence) flags |= 64;
        if (a.deform) flags |= 128;
        w.writeByte(flags);
        if (nameDiff) ctx.ref(a.name);
        if (pathNeeded) ctx.ref(a.path);
        if (colorNeeded) w.writeInt32(rgbaHexToInt32(a.color!));
        if (a.sequence) writeSequence(w, a.sequence, false);
        const skinIdx = a.skin == null ? 0 : (ctx.skinIndexMap.get(a.skin) ?? 0);
        w.writeVarint(skinIdx);
        ctx.ref(a.parent);
        if (nonessential) { w.writeFloat(a.width); w.writeFloat(a.height); }
      } else {
        if (b.hasStrTable) ctx.ref(nameDiff ? a.name : null);
        else ctx.inline(nameDiff ? a.name : null);
        w.writeByte(3);
        if (b.hasStrTable) { ctx.ref(pathNeeded ? a.path : null); w.writeInt32(rgbaHexToInt32(a.color ?? 'ffffffff')); ctx.ref(a.skin); ctx.ref(a.parent); }
        else { ctx.inline(pathNeeded ? a.path : null); w.writeInt32(rgbaHexToInt32(a.color ?? 'ffffffff')); ctx.inline(a.skin); ctx.inline(a.parent); }
        if (b.hasInheritDeform) w.writeBoolean(a.deform);
        if (b.hasSequence) writeSequence(w, a.sequence, true);
        if (nonessential) { w.writeFloat(a.width); w.writeFloat(a.height); }
      }
      return;
    }
    case 'path': {
      if (is42) {
        let flags = 4;
        if (nameDiff) flags |= 8;
        if (a.closed) flags |= 16;
        if (a.constantSpeed) flags |= 32;
        if (a.verts.weighted) flags |= 64;
        w.writeByte(flags);
        if (nameDiff) ctx.ref(a.name);
        /* 4.2：readVertices 无条件先读 vertexCount */
        writeVerts(w, a.verts, false, true);
      } else {
        if (b.hasStrTable) ctx.ref(nameDiff ? a.name : null);
        else ctx.inline(nameDiff ? a.name : null);
        w.writeByte(4);
        w.writeBoolean(a.closed);
        w.writeBoolean(a.constantSpeed);
        writeVerts(w, a.verts, true, true);
      }
      const segCount = Math.max(0, Math.floor(vertexCountOf(a.verts) / 3));
      for (let i = 0; i < segCount; i++) w.writeFloat(a.lengths[i] ?? 0);
      if (nonessential) w.writeInt32(rgbaHexToInt32(a.color ?? 'ffd119ff'));
      return;
    }
    case 'point': {
      if (is42) {
        /* 4.2：flags 字节（低 3 位类型，bit3 名称引用） */
        let flags = 5;
        if (nameDiff) flags |= 8;
        w.writeByte(flags);
        if (nameDiff) ctx.ref(a.name);
      } else {
        if (b.hasStrTable) ctx.ref(nameDiff ? a.name : null);
        else ctx.inline(nameDiff ? a.name : null);
        w.writeByte(5);
      }
      w.writeFloat(a.rotation);
      w.writeFloat(a.x); w.writeFloat(a.y);
      if (nonessential) w.writeInt32(rgbaHexToInt32(a.color ?? 'f1f100ff'));
      return;
    }
    case 'clipping': {
      if (is42) {
        let flags = 6;
        if (nameDiff) flags |= 8;
        if (a.verts.weighted) flags |= 16;
        w.writeByte(flags);
        if (nameDiff) ctx.ref(a.name);
        w.writeVarint(ctx.slotIndex.get(a.end) ?? 0);
        /* 4.2：readVertices 无条件先读 vertexCount */
        writeVerts(w, a.verts, false, true);
      } else {
        if (b.hasStrTable) ctx.ref(nameDiff ? a.name : null);
        else ctx.inline(nameDiff ? a.name : null);
        w.writeByte(6);
        w.writeVarint(ctx.slotIndex.get(a.end) ?? 0);
        writeVerts(w, a.verts, true, true);
      }
      if (nonessential) w.writeInt32(rgbaHexToInt32(a.color ?? 'ce3a3aff'));
      return;
    }
  }
}

/* ---------------- 动画写出 ---------------- */

function writeCurve3x(w: BinWriter, curve: Curve) {
  if (curve == null) { w.writeByte(0); return; }
  if ('stepped' in curve) { w.writeByte(1); return; }
  w.writeByte(2);
  for (const v of curve.bezier) w.writeFloat(v);
}

function writeCurves4(
  w: BinWriter, curves: Curve[] | undefined, valueCount: number,
  t0 = 0, t1 = 0, v0?: number[], v1?: number[],
) {
  const cs: Curve[] = [];
  for (let i = 0; i < valueCount; i++) cs.push(curves?.[i] ?? null);
  if (cs.length > 0 && cs.every((c) => c != null && 'stepped' in c)) {
    w.writeByte(1);
    return;
  }
  if (!cs.some((c) => c != null && 'bezier' in c)) { w.writeByte(0); return; }
  w.writeByte(2);
  /* 曲线已由 convertSkeletonCurves 统一为目标空间（4.x = 绝对坐标），原样写出。
   * 二进制里“bezier 段”对全部 valueCount 个值各写一组控制点：
   * - linear 值 → 三等分控制点（严格等价于直线；端点控制点是 S 形缓动，是错误编码）
   * - stepped 值 → 阶梯控制点 (t1, v0) → (t1, v1)（二进制无法按值单独表示 stepped） */
  for (let i = 0; i < cs.length; i++) {
    const c = cs[i];
    if (c && 'bezier' in c) {
      for (const v of c.bezier) w.writeFloat(v);
    } else {
      const a = v0?.[i] ?? 0;
      const bb = v1?.[i] ?? 0;
      if (c && 'stepped' in c) {
        w.writeFloat(t1); w.writeFloat(a);
        w.writeFloat(t1); w.writeFloat(bb);
      } else {
        w.writeFloat(t0 + (t1 - t0) / 3); w.writeFloat(a + (bb - a) / 3);
        w.writeFloat(t0 + ((t1 - t0) * 2) / 3); w.writeFloat(a + ((bb - a) * 2) / 3);
      }
    }
  }
}

/** 4.x 段曲线是否含贝塞尔（决定该段是否按 bezier 编码、消耗 valueCount 个贝塞尔槽位） */
function segHasBezier(curves: Curve[] | undefined, valueCount: number): boolean {
  for (let i = 0; i < valueCount; i++) {
    const c = curves?.[i];
    if (c && 'bezier' in c) return true;
  }
  return false;
}

/**
 * 4.x 贝塞尔计数的精确值：每个“含贝塞尔的段”消耗 valueCount 个槽位（linear/stepped 值以等价贝塞尔占位），
 * 末帧没有后继段不计数。官方 Java 读取器按该计数预分配数组，低报会数组越界 —— 必须精确。
 */
function bezCountTotal(keys: { curves?: Curve[] }[], valueCount: number): number {
  let n = 0;
  for (let i = 0; i < keys.length - 1; i++) {
    if (segHasBezier(keys[i].curves, valueCount)) n += valueCount;
  }
  return n;
}

interface KeyLike { time: number; curves?: Curve[] }

/** 3.x：[t,values,curve]×N */
function writeTL3(w: BinWriter, keys: KeyLike[], writeValues: (i: number) => void) {
  for (let i = 0; i < keys.length; i++) {
    w.writeFloat(keys[i].time);
    writeValues(i);
    if (i < keys.length - 1) writeCurve3x(w, keys[i].curves?.[0] ?? null);
  }
}

/** 4.x：[t0 v0][t1 v1 curve0][t2 v2 curve1]... 曲线写绝对坐标 */
function writeTL4(
  w: BinWriter, keys: KeyLike[], writeValues: (i: number) => void, valueCount: number,
  getValues?: (i: number) => number[],
) {
  if (keys.length === 0) return;
  w.writeFloat(keys[0].time);
  writeValues(0);
  for (let i = 1; i < keys.length; i++) {
    w.writeFloat(keys[i].time);
    writeValues(i);
    if (getValues) {
      writeCurves4(w, keys[i - 1].curves, valueCount, keys[i - 1].time, keys[i].time, getValues(i - 1), getValues(i));
    } else {
      writeCurves4(w, keys[i - 1].curves, valueCount);
    }
  }
}

function writeAnimation(w: BinWriter, anim: AnimationIR, ir: SkeletonIR, target: SpineVersion, ctx: Ctx & { skins: SkinIR[] }) {
  const b = PROFILES[target].bin;
  const is4 = target.startsWith('4.');
  const n = (x: number) => Math.max(0, x);

  /* 4.x：动画头部总时间轴计数 */
  if (is4) w.writeVarint(countTimelines(anim, ir, is4, b.hasPhysics, ctx));

  /* 槽位时间轴 */
  const slotEntries = Object.entries(anim.slot)
    .map(([name, tl]) => ({ idx: ctx.slotIndex.get(name) ?? -1, name, tl }))
    .filter((x) => x.idx >= 0)
    .sort((a, z) => a.idx - z.idx);
  w.writeVarint(slotEntries.length);
  for (const se of slotEntries) {
    w.writeVarint(se.idx);
    const tls: { type: number; write: () => void }[] = [];
    if (se.tl.attachment?.length) {
      const keys = se.tl.attachment;
      tls.push({
        type: 0,
        write: () => {
          w.writeVarint(keys.length);
          for (const k of keys) {
            w.writeFloat(k.time);
            if (ctx.hasStrTable) ctx.ref(k.name);
            else ctx.inline(k.name);
          }
        },
      });
    }
    if (se.tl.color?.length) {
      const keys = se.tl.color;
      tls.push(is4 ? {
        type: 1, // rgba
        write: () => {
          w.writeVarint(keys.length);
          w.writeVarint(bezCountTotal(keys, 4));
          writeTL4(w, keys, (i) => {
            const [r, g, bb, a] = hexToRgba(keys[i].color);
            w.writeByte(r); w.writeByte(g); w.writeByte(bb); w.writeByte(a);
          }, 4, (i) => hexToRgba(keys[i].color).map((x) => x / 255));
        },
      } : {
        type: 1, // color
        write: () => {
          w.writeVarint(keys.length);
          writeTL3(w, keys, (i) => w.writeInt32(rgbaHexToInt32(keys[i].color)));
        },
      });
    }
    if (se.tl.twoColor?.length) {
      const keys = se.tl.twoColor;
      tls.push(is4 ? {
        type: 3, // rgba2
        write: () => {
          w.writeVarint(keys.length);
          w.writeVarint(bezCountTotal(keys, 7));
          writeTL4(w, keys, (i) => {
            const [r, g, bb, a] = hexToRgba(keys[i].light);
            const [dr, dg, db] = hexToRgba(keys[i].dark);
            w.writeByte(r); w.writeByte(g); w.writeByte(bb); w.writeByte(a);
            w.writeByte(dr); w.writeByte(dg); w.writeByte(db);
          }, 7, (i) => [...hexToRgba(keys[i].light).map((x) => x / 255), ...hexToRgba(keys[i].dark).slice(0, 3).map((x) => x / 255)]);
        },
      } : {
        type: 2, // twoColor
        write: () => {
          w.writeVarint(keys.length);
          writeTL3(w, keys, (i) => {
            w.writeInt32(rgbaHexToInt32(keys[i].light));
            w.writeInt32(rgbHexToInt32(keys[i].dark));
          });
        },
      });
    }
    if (se.tl.alpha?.length && is4) {
      const keys = se.tl.alpha;
      tls.push({
        type: 5,
        write: () => {
          w.writeVarint(keys.length);
          w.writeVarint(bezCountTotal(keys, 1));
          writeTL4(w, keys, (i) => w.writeByte(Math.round(keys[i].value * 255)), 1, (i) => [keys[i].value]);
        },
      });
    }
    w.writeVarint(tls.length);
    for (const tl of tls) { w.writeByte(tl.type); tl.write(); }
  }

  /* 骨骼时间轴 */
  const boneEntries = Object.entries(anim.bone)
    .map(([name, tl]) => ({ idx: ctx.boneIndex.get(name) ?? -1, name, tl }))
    .filter((x) => x.idx >= 0)
    .sort((a, z) => a.idx - z.idx);
  w.writeVarint(boneEntries.length);
  for (const be of boneEntries) {
    w.writeVarint(be.idx);
    const tls: { type: number; write: () => void }[] = [];
    const pushXY = (type: number, keys: { time: number; x: number; y: number; curves?: Curve[] }[] | undefined) => {
      if (!keys?.length) return;
      tls.push(is4 ? {
        type,
        write: () => {
          w.writeVarint(keys.length);
          w.writeVarint(bezCountTotal(keys, 2));
          writeTL4(w, keys, (i) => { w.writeFloat(keys[i].x); w.writeFloat(keys[i].y); }, 2, (i) => [keys[i].x, keys[i].y]);
        },
      } : {
        type,
        write: () => {
          w.writeVarint(keys.length);
          writeTL3(w, keys, (i) => { w.writeFloat(keys[i].x); w.writeFloat(keys[i].y); });
        },
      });
    };
    const push1 = (type: number, keys: { time: number; value: number; curves?: Curve[] }[] | undefined) => {
      if (!keys?.length) return;
      tls.push({
        type,
        write: () => {
          w.writeVarint(keys.length);
          if (is4) {
            w.writeVarint(bezCountTotal(keys, 1));
            writeTL4(w, keys, (i) => w.writeFloat(keys[i].value), 1, (i) => [keys[i].value]);
          } else {
            writeTL3(w, keys, (i) => w.writeFloat(keys[i].value));
          }
        },
      });
    };
    if (be.tl.rotate?.length) {
      const keys = be.tl.rotate;
      tls.push({
        type: 0,
        write: () => {
          w.writeVarint(keys.length);
          if (is4) {
            w.writeVarint(bezCountTotal(keys, 1));
            writeTL4(w, keys, (i) => w.writeFloat(keys[i].angle), 1, (i) => [keys[i].angle]);
          } else {
            writeTL3(w, keys, (i) => w.writeFloat(keys[i].angle));
          }
        },
      });
    }
    if (is4) {
      pushXY(1, be.tl.translate);
      push1(2, be.tl.translatex);
      push1(3, be.tl.translatey);
      pushXY(4, be.tl.scale);
      push1(5, be.tl.scalex);
      push1(6, be.tl.scaley);
      pushXY(7, be.tl.shear);
      push1(8, be.tl.shearx);
      push1(9, be.tl.sheary);
    } else {
      /* 3.x：rotate=0 translate=1 scale=2 shear=3（单轴时间轴经降级合并，此处仅防御性处理） */
      pushXY(1, be.tl.translate);
      pushXY(2, be.tl.scale);
      pushXY(3, be.tl.shear);
    }
    if (be.tl.inherit?.length && b.hasPhysics) {
      const keys = be.tl.inherit;
      tls.push({
        type: 10,
        write: () => {
          w.writeVarint(keys.length);
          for (const k of keys) {
            w.writeFloat(k.time);
            const tm = ['normal', 'onlyTranslation', 'noRotationOrReflection', 'noScale', 'noScaleOrReflection'].indexOf(k.inherit);
            w.writeByte(tm);
          }
        },
      });
    }
    w.writeVarint(tls.length);
    for (const tl of tls) { w.writeByte(tl.type); tl.write(); }
  }

  /* IK 时间轴 */
  const ikEntries = Object.entries(anim.ik)
    .map(([name, keys]) => ({ idx: ir.ik.findIndex((c) => c.name === name), name, keys }))
    .filter((x) => x.idx >= 0 && x.keys.length);
  w.writeVarint(ikEntries.length);
  for (const e of ikEntries) {
    w.writeVarint(e.idx);
    const keys = e.keys;
    w.writeVarint(keys.length);
    if (b.flagsConstraints) {
      /* 4.2：[flags0 t0 v0][flags1 t1 v1 曲线浮点0]... 曲线位在下一帧 flags */
      w.writeVarint(bezCountTotal(keys, 2));
      const writeFrameHead = (k: typeof keys[number], prevCurves: Curve[] | undefined, prevKey?: typeof keys[number]) => {
        let flags = 0;
        if (k.mix !== 0) flags |= 1;
        if (k.mix !== 0 && k.mix !== 1) flags |= 2;
        if (k.softness !== 0) flags |= 4;
        if (k.bendDirection === 1) flags |= 8;
        if (k.compress) flags |= 16;
        if (k.stretch) flags |= 32;
        if (prevCurves) {
          if (prevCurves.every((c) => c != null && 'stepped' in c)) flags |= 64;
          else if (prevCurves.some((c) => c != null && 'bezier' in c)) flags |= 128;
        }
        w.writeByte(flags);
        w.writeFloat(k.time);
        if ((flags & 2) !== 0) w.writeFloat(k.mix);
        if (k.softness !== 0) w.writeFloat(k.softness);
        if (prevCurves && prevKey && (flags & 128) !== 0) {
          /* 曲线已为目标空间（绝对坐标），原样写出；占位值用等价贝塞尔（linear→三分点，stepped→阶梯） */
          for (let v = 0; v < 2; v++) {
            const c = prevCurves[v];
            if (c && 'bezier' in c) {
              for (const x of c.bezier) w.writeFloat(x);
            } else {
              const t0 = prevKey.time, t1 = k.time;
              const v0 = v === 0 ? prevKey.mix : prevKey.softness;
              const v1 = v === 0 ? k.mix : k.softness;
              if (c && 'stepped' in c) {
                w.writeFloat(t1); w.writeFloat(v0);
                w.writeFloat(t1); w.writeFloat(v1);
              } else {
                w.writeFloat(t0 + (t1 - t0) / 3); w.writeFloat(v0 + (v1 - v0) / 3);
                w.writeFloat(t0 + ((t1 - t0) * 2) / 3); w.writeFloat(v0 + ((v1 - v0) * 2) / 3);
              }
            }
          }
        }
      };
      writeFrameHead(keys[0], undefined, undefined);
      for (let i = 1; i < keys.length; i++) writeFrameHead(keys[i], keys[i - 1].curves, keys[i - 1]);
    } else if (is4) {
      /* 4.0/4.1：[t0 m0 s0 b0 c0 s0][t1 m1 s1 curve0 b1 c1 s1]... */
      w.writeVarint(bezCountTotal(keys, 2));
      const writeTail = (k: typeof keys[number]) => {
        w.writeByte(k.bendDirection === 1 ? 1 : 255);
        w.writeBoolean(k.compress);
        w.writeBoolean(k.stretch);
      };
      w.writeFloat(keys[0].time); w.writeFloat(keys[0].mix); w.writeFloat(keys[0].softness);
      writeTail(keys[0]);
      for (let i = 1; i < keys.length; i++) {
        w.writeFloat(keys[i].time); w.writeFloat(keys[i].mix); w.writeFloat(keys[i].softness);
        writeCurves4(w, keys[i - 1].curves, 2, keys[i - 1].time, keys[i].time,
          [keys[i - 1].mix, keys[i - 1].softness], [keys[i].mix, keys[i].softness]);
        writeTail(keys[i]);
      }
    } else {
      /* 3.x：[t m (s) b (c s) curve]×N */
      for (let i = 0; i < keys.length; i++) {
        const k = keys[i];
        w.writeFloat(k.time);
        w.writeFloat(k.mix);
        if (b.hasIkSoftness) w.writeFloat(k.softness);
        w.writeByte(k.bendDirection === 1 ? 1 : 255);
        if (b.hasIkStretch) { w.writeBoolean(k.compress); w.writeBoolean(k.stretch); }
        if (i < keys.length - 1) writeCurve3x(w, k.curves?.[0] ?? null);
      }
    }
  }

  /* 变换约束时间轴 */
  const tfEntries = Object.entries(anim.transform)
    .map(([name, keys]) => ({ idx: ir.transform.findIndex((c) => c.name === name), name, keys }))
    .filter((x) => x.idx >= 0 && x.keys.length);
  w.writeVarint(tfEntries.length);
  for (const e of tfEntries) {
    w.writeVarint(e.idx);
    const keys = e.keys;
    w.writeVarint(keys.length);
    if (is4) {
      w.writeVarint(bezCountTotal(keys, 6));
      writeTL4(w, keys, (i) => {
        const k = keys[i];
        w.writeFloat(k.mixRotate); w.writeFloat(k.mixX); w.writeFloat(k.mixY);
        w.writeFloat(k.mixScaleX); w.writeFloat(k.mixScaleY); w.writeFloat(k.mixShearY);
      }, 6, (i) => {
        const k = keys[i];
        return [k.mixRotate, k.mixX, k.mixY, k.mixScaleX, k.mixScaleY, k.mixShearY];
      });
    } else {
      writeTL3(w, keys, (i) => {
        const k = keys[i];
        w.writeFloat(k.mixRotate); w.writeFloat(k.mixX);
        w.writeFloat(k.mixScaleX); w.writeFloat(k.mixShearY);
      });
    }
  }

  /* 路径约束时间轴 */
  const pathEntries = Object.entries(anim.path)
    .map(([name, pt]) => ({ idx: ir.path.findIndex((c) => c.name === name), name, pt }))
    .filter((x) => x.idx >= 0);
  w.writeVarint(pathEntries.length);
  for (const e of pathEntries) {
    w.writeVarint(e.idx);
    const tls: { type: number; write: () => void }[] = [];
    const single = (type: number, keys: { time: number; value: number; curves?: Curve[] }[] | undefined) => {
      if (!keys?.length) return;
      tls.push({
        type,
        write: () => {
          w.writeVarint(keys.length);
          if (is4) {
            w.writeVarint(bezCountTotal(keys, 1));
            writeTL4(w, keys, (i) => w.writeFloat(keys[i].value), 1, (i) => [keys[i].value]);
          } else {
            writeTL3(w, keys, (i) => w.writeFloat(keys[i].value));
          }
        },
      });
    };
    single(0, e.pt.position);
    single(1, e.pt.spacing);
    if (e.pt.mix?.length) {
      const keys = e.pt.mix;
      tls.push({
        type: 2,
        write: () => {
          w.writeVarint(keys.length);
          if (is4) {
            w.writeVarint(bezCountTotal(keys, 3));
            writeTL4(w, keys, (i) => {
              w.writeFloat(keys[i].mixRotate); w.writeFloat(keys[i].mixX); w.writeFloat(keys[i].mixY);
            }, 3, (i) => [keys[i].mixRotate, keys[i].mixX, keys[i].mixY]);
          } else {
            writeTL3(w, keys, (i) => {
              w.writeFloat(keys[i].mixRotate); w.writeFloat(keys[i].mixX);
            });
          }
        },
      });
    }
    w.writeVarint(tls.length);
    for (const tl of tls) { w.writeByte(tl.type); tl.write(); }
  }

  /* 物理时间轴（4.2） */
  if (b.hasPhysics) {
    const phEntries = Object.entries(anim.physics).filter(([name, pt]) => {
      if (name !== '' && ir.physics.findIndex((c) => c.name === name) < 0) return false;
      return Object.values(pt).some((v) => Array.isArray(v) && v.length > 0);
    });
    w.writeVarint(phEntries.length);
    for (const [name, pt] of phEntries) {
      const idx = name === '' ? 0 : ir.physics.findIndex((c) => c.name === name) + 1;
      w.writeVarint(idx);
      const tls: { type: number; write: () => void }[] = [];
      const fields: [string, number][] = [
        ['inertia', 0], ['strength', 1], ['damping', 2], ['mass', 4], ['wind', 5], ['gravity', 6], ['mix', 7],
      ];
      for (const [field, type] of fields) {
        const keys = (pt as unknown as Record<string, { time: number; value: number; curves?: Curve[] }[]>)[field];
        if (!keys?.length) continue;
        tls.push({
          type,
          write: () => {
            w.writeVarint(keys.length);
            w.writeVarint(bezCountTotal(keys, 1));
            writeTL4(w, keys, (i) => w.writeFloat(keys[i].value), 1, (i) => [keys[i].value]);
          },
        });
      }
      if (pt.reset?.length) {
        const keys = pt.reset;
        tls.push({
          type: 8,
          write: () => {
            w.writeVarint(keys.length);
            for (const k of keys) w.writeFloat(k.time);
          },
        });
      }
      w.writeVarint(tls.length);
      for (const tl of tls) { w.writeByte(tl.type); tl.write(); }
    }
  }

  /* 附件（deform / sequence）时间轴：皮肤 → 槽位 → 条目。保持 IR 插入顺序，仅合并相邻同组 */
  interface EntryItem { skinIdx: number; slotIdx: number; attName: string; kind: 'deform' | 'sequence' }
  const skinIndexOf = new Map(ctx.skins.map((s, i) => [s.name, i]));
  const entries: EntryItem[] = [];
  const pushEntries = (source: Record<string, Record<string, Record<string, unknown[]>>>, kind: 'deform' | 'sequence') => {
    for (const [skinName, slots] of Object.entries(source)) {
      const skinIdx = skinIndexOf.get(skinName);
      if (skinIdx == null) continue;
      for (const [slotName, atts] of Object.entries(slots)) {
        const slotIdx = ctx.slotIndex.get(slotName);
        if (slotIdx == null) continue;
        for (const [attName, keys] of Object.entries(atts)) {
          if (keys.length) entries.push({ skinIdx, slotIdx, attName, kind });
        }
      }
    }
  };
  pushEntries(anim.deform as never, 'deform');
  if (b.hasSequence) pushEntries(anim.sequence as never, 'sequence');
  /* 相邻同 (skin, slot) 合并分组（不排序，保持原序） */
  const groups: { skinIdx: number; slotIdx: number; items: EntryItem[] }[] = [];
  for (const it of entries) {
    const last = groups[groups.length - 1];
    if (last && last.skinIdx === it.skinIdx && last.slotIdx === it.slotIdx) last.items.push(it);
    else groups.push({ skinIdx: it.skinIdx, slotIdx: it.slotIdx, items: [it] });
  }
  w.writeVarint(groups.length);
  for (const sg of groups) {
    w.writeVarint(sg.skinIdx);
    w.writeVarint(1); /* 该皮肤内槽数 */
    w.writeVarint(sg.slotIdx);
    w.writeVarint(sg.items.length);
    const skin = ctx.skins[sg.skinIdx];
    const slotName = ir.slots[sg.slotIdx]?.name ?? '';
    for (const item of sg.items) {
        if (b.hasStrTable) ctx.ref(item.attName);
        else ctx.inline(item.attName);
        if (b.hasAttachTypeByte) w.writeByte(item.kind === 'sequence' ? 1 : 0);
        if (item.kind === 'sequence') {
          const keys = anim.sequence[skin.name]?.[slotName]?.[item.attName] ?? [];
          w.writeVarint(keys.length);
          for (const k of keys) {
            w.writeFloat(k.time);
            const modeIdx = ['hold', 'once', 'loop', 'pingpong', 'onceReverse', 'loopReverse', 'pingpongReverse'].indexOf(k.mode);
            w.writeInt32(modeIdx | (k.index << 4));
            w.writeFloat(k.delay);
          }
          continue;
        }
        const keys = anim.deform[skin.name]?.[slotName]?.[item.attName] ?? [];
        w.writeVarint(keys.length);
        /* deform 贝塞尔数：仅前 len-1 帧（末帧无后继段） */
        if (b.hasBezierCount) w.writeVarint(keys.slice(0, -1).filter((k) => k.curve != null && 'bezier' in k.curve).length);
        if (is4) {
          /* 4.x：[t0 block0][t1 curve0 block1][t2 curve1 block2]... */
          w.writeFloat(keys[0].time);
          writeDeformBlock(w, keys[0]);
          for (let i = 1; i < keys.length; i++) {
            w.writeFloat(keys[i].time);
            writeCurve3x(w, keys[i - 1].curve);
            writeDeformBlock(w, keys[i]);
          }
        } else {
          /* 3.x：[t block curve]×N */
          for (let i = 0; i < keys.length; i++) {
            w.writeFloat(keys[i].time);
            writeDeformBlock(w, keys[i]);
            if (i < keys.length - 1) writeCurve3x(w, keys[i].curve);
          }
        }
    }
  }

  /* drawOrder */
  w.writeVarint(n(anim.drawOrder.length));
  for (const k of anim.drawOrder) {
    w.writeFloat(k.time);
    const offsets = k.offsets ?? [];
    w.writeVarint(offsets.length);
    for (const off of offsets) {
      w.writeVarint(ctx.slotIndex.get(off.slot) ?? 0);
      w.writeVarint(off.offset);
    }
  }

  /* 事件 */
  const eventIndex = new Map(ir.events.map((e, i) => [e.name, i]));
  w.writeVarint(n(anim.events.length));
  for (const k of anim.events) {
    w.writeFloat(k.time);
    w.writeVarint(eventIndex.get(k.name) ?? 0);
    w.writeVarintZ(k.int ?? 0);
    w.writeFloat(k.float ?? 0);
    if (b.eventStringNoBool) {
      w.writeString(k.string ?? null);
    } else if (k.string != null) {
      w.writeBoolean(true);
      w.writeString(k.string);
    } else {
      w.writeBoolean(false);
    }
    const def = ir.events[eventIndex.get(k.name) ?? -1];
    if (b.hasEventAudio && def?.audio != null) {
      w.writeFloat(k.volume ?? def.volume);
      w.writeFloat(k.balance ?? def.balance);
    }
  }
}

function writeDeformBlock(w: BinWriter, k: { vertices: number[] | null; offset: number }) {
  if (k.vertices == null || k.vertices.length === 0) {
    w.writeVarint(0);
    return;
  }
  w.writeVarint(k.vertices.length);
  w.writeVarint(k.offset);
  w.writeFloatArray(k.vertices);
}

/** 统计动画将写出的时间轴总数（4.x 动画头部计数） */
function countTimelines(anim: AnimationIR, ir: SkeletonIR, is4: boolean, hasPhysics: boolean, ctx: Ctx & { skins: SkinIR[] }): number {
  let n = 0;
  const skinNames = new Set(ctx.skins.map((s) => s.name));
  for (const [name, tl] of Object.entries(anim.slot)) {
    if (ctx.slotIndex.get(name) == null) continue;
    if (tl.attachment?.length) n++;
    if (tl.color?.length) n++;
    if (tl.twoColor?.length) n++;
    if (is4 && tl.alpha?.length) n++;
  }
  for (const [name, bt] of Object.entries(anim.bone)) {
    if (ctx.boneIndex.get(name) == null) continue;
    if (bt.rotate?.length) n++;
    if (bt.translate?.length) n++;
    if (is4) {
      if (bt.translatex?.length) n++;
      if (bt.translatey?.length) n++;
      if (bt.scalex?.length) n++;
      if (bt.scaley?.length) n++;
      if (bt.shearx?.length) n++;
      if (bt.sheary?.length) n++;
    }
    if (bt.scale?.length) n++;
    if (bt.shear?.length) n++;
    if (hasPhysics && bt.inherit?.length) n++;
  }
  for (const [name, keys] of Object.entries(anim.ik)) {
    if (keys.length && ir.ik.some((c) => c.name === name)) n++;
  }
  for (const [name, keys] of Object.entries(anim.transform)) {
    if (keys.length && ir.transform.some((c) => c.name === name)) n++;
  }
  for (const [name, pt] of Object.entries(anim.path)) {
    if (!ir.path.some((c) => c.name === name)) continue;
    if (pt.position?.length) n++;
    if (pt.spacing?.length) n++;
    if (pt.mix?.length) n++;
  }
  if (hasPhysics) {
    for (const [name, pt] of Object.entries(anim.physics)) {
      if (name !== '' && !ir.physics.some((c) => c.name === name)) continue;
      for (const field of ['inertia', 'strength', 'damping', 'mass', 'wind', 'gravity', 'mix', 'reset'] as const) {
        const keys = (pt as unknown as Record<string, unknown[]>)[field];
        if (Array.isArray(keys) && keys.length) n++;
      }
    }
  }
  const hasSkin = (skinName: string) => skinNames.has(skinName);
  for (const [skinName, slots] of Object.entries(anim.deform)) {
    if (!hasSkin(skinName)) continue;
    for (const [slotName, atts] of Object.entries(slots)) {
      if (ctx.slotIndex.get(slotName) == null) continue;
      for (const keys of Object.values(atts)) if (keys.length) n++;
    }
  }
  for (const [skinName, slots] of Object.entries(anim.sequence)) {
    if (!hasSkin(skinName)) continue;
    for (const [slotName, atts] of Object.entries(slots)) {
      if (ctx.slotIndex.get(slotName) == null) continue;
      for (const keys of Object.values(atts)) if (keys.length) n++;
    }
  }
  if (anim.drawOrder.length) n++;
  if (anim.events.length) n++;
  return n;
}

function groupBy<T>(items: T[], key: (t: T) => number): { key: number; items: T[] }[] {
  const map = new Map<number, T[]>();
  for (const t of items) {
    if (!map.has(key(t))) map.set(key(t), []);
    map.get(key(t))!.push(t);
  }
  return [...map.entries()].sort((a, z) => a[0] - z[0]).map(([k, v]) => ({ key: k, items: v }));
}
