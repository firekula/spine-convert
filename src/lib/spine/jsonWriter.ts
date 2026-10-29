/**
 * JSON 序列化器 —— 将 IR 写出为指定目标版本的 Spine JSON。
 * 输出风格对齐官方编辑器：省略默认值、字段顺序一致、紧凑排版。
 */
import {
  type SkeletonIR, type SpineVersion, type AnimationIR, type AttachmentIR,
  type SkinIR, type DeformKey, type Curve, type XYKey, type SingleKey,
} from './types';
import { PROFILES, VERSION_STRINGS, type VersionProfile } from './spec';
import { curvesToJson38, curvesToJson4, convertSkeletonCurves, hexToRgba } from './color';

type JObj = Record<string, unknown>;

export function writeJson(
  ir: SkeletonIR,
  target: SpineVersion,
  opts: { pretty?: boolean; clearHash?: boolean; versionString?: string },
): string {
  const P = PROFILES[target];
  /* 曲线空间与目标版本不一致时，在副本上转换（不改动调用方 IR） */
  const wantAbs = target.startsWith('4.');
  if ((ir.curveSpace ?? 'norm') !== (wantAbs ? 'abs' : 'norm')) {
    ir = convertSkeletonCurves(structuredClone(ir), target);
  }
  const root: JObj = {};

  /* ---------- skeleton ---------- */
  const skeleton: JObj = {};
  if (!opts.clearHash && ir.hash) skeleton.hash = ir.hash;
  skeleton.spine = opts.versionString ?? VERSION_STRINGS[target];
  if (P.hasSkeletonOffset) {
    if (ir.x !== 0) skeleton.x = ir.x;
    if (ir.y !== 0) skeleton.y = ir.y;
  }
  if (ir.width !== 0) skeleton.width = ir.width;
  if (ir.height !== 0) skeleton.height = ir.height;
  if (ir.imagesPath != null && ir.imagesPath !== '') skeleton.images = ir.imagesPath;
  if (ir.audioPath != null && ir.audioPath !== '') skeleton.audio = ir.audioPath;
  root.skeleton = skeleton;

  /* ---------- bones ---------- */
  root.bones = ir.bones.map((b) => {
    const o: JObj = {};
    o.name = b.name;
    if (b.parent) o.parent = b.parent;
    if (b.length !== 0) o.length = b.length;
    if (b.rotation !== 0) o.rotation = b.rotation;
    if (b.x !== 0) o.x = b.x;
    if (b.y !== 0) o.y = b.y;
    if (b.scaleX !== 1) o.scaleX = b.scaleX;
    if (b.scaleY !== 1) o.scaleY = b.scaleY;
    if (b.shearX !== 0) o.shearX = b.shearX;
    if (b.shearY !== 0) o.shearY = b.shearY;
    if (P.hasTransformModes) {
      /* 4.2：键名为 inherit；更早版本为 transform */
      const key = P.num >= 402 ? 'inherit' : 'transform';
      if (b.transformMode !== 'normal') o[key] = b.transformMode;
    } else {
      if (b.inheritRotation === false) o.inheritRotation = false;
      if (b.inheritScale === false) o.inheritScale = false;
    }
    if (P.hasSkinRequired && b.skinRequired) o.skin = true;
    if (b.color != null && b.color !== '9b9b9bff') o.color = b.color;
    if (P.hasBoneIcon && b.icon != null) o.icon = b.icon;
    return o;
  });

  /* ---------- slots ---------- */
  root.slots = ir.slots.map((s) => {
    const o: JObj = {};
    o.name = s.name;
    o.bone = s.bone;
    if (s.color !== 'ffffffff') o.color = s.color;
    if (P.hasSlotDark && s.dark) o.dark = s.dark;
    if (s.attachment != null) o.attachment = s.attachment;
    if (s.blend !== 'normal') o.blend = s.blend;
    return o;
  });

  /* ---------- 约束 ---------- */
  if (ir.ik.length) {
    root.ik = ir.ik.map((c) => {
      const o: JObj = { name: c.name };
      if (P.hasConstraintOrder && c.order !== 0) o.order = c.order;
      if (P.hasSkinRequired && c.skinRequired) o.skin = true;
      o.bones = c.bones;
      o.target = c.target;
      if (c.mix !== 1) o.mix = c.mix;
      if (P.hasIkSoftness && c.softness !== 0) o.softness = c.softness;
      if (c.bendDirection === -1) o.bendPositive = false;
      if (P.hasIkStretch) {
        if (c.compress) o.compress = true;
        if (c.stretch) o.stretch = true;
        if (c.uniform) o.uniform = true;
      }
      return o;
    });
  }
  if (ir.transform.length) {
    root.transform = ir.transform.map((c) => {
      const o: JObj = { name: c.name };
      if (c.order !== 0) o.order = c.order;
      if (P.hasSkinRequired && c.skinRequired) o.skin = true;
      o.bones = c.bones;
      o.target = c.target;
      if (P.num >= 306) {
        if (c.local) o.local = true;
        if (c.relative) o.relative = true;
      }
      if (c.offsetRotation !== 0) o.rotation = c.offsetRotation;
      if (c.offsetX !== 0) o.x = c.offsetX;
      if (c.offsetY !== 0) o.y = c.offsetY;
      if (c.offsetScaleX !== 0) o.scaleX = c.offsetScaleX;
      if (c.offsetScaleY !== 0) o.scaleY = c.offsetScaleY;
      if (c.offsetShearY !== 0) o.shearY = c.offsetShearY;
      if (P.transformMixStyle === 'mixRotate') {
        if (c.mixRotate !== 1) o.mixRotate = c.mixRotate;
        if (c.mixX !== 1) o.mixX = c.mixX;
        if (c.mixY !== c.mixX) o.mixY = c.mixY;
        if (c.mixScaleX !== 1) o.mixScaleX = c.mixScaleX;
        if (c.mixScaleY !== c.mixScaleX) o.mixScaleY = c.mixScaleY;
        if (c.mixShearY !== 1) o.mixShearY = c.mixShearY;
      } else {
        if (c.mixRotate !== 1) o.rotateMix = c.mixRotate;
        if (c.mixX !== 1) o.translateMix = c.mixX;
        if (c.mixScaleX !== 1) o.scaleMix = c.mixScaleX;
        if (c.mixShearY !== 1) o.shearMix = c.mixShearY;
      }
      return o;
    });
  }
  if (ir.path.length) {
    root.path = ir.path.map((c) => {
      const o: JObj = { name: c.name };
      if (c.order !== 0) o.order = c.order;
      if (P.hasSkinRequired && c.skinRequired) o.skin = true;
      o.bones = c.bones;
      o.target = c.target;
      if (c.positionMode !== 'percent') o.positionMode = c.positionMode;
      if (c.spacingMode !== 'length') o.spacingMode = c.spacingMode;
      if (c.rotateMode !== 'tangent') o.rotateMode = c.rotateMode;
      if (c.offsetRotation !== 0) o.rotation = c.offsetRotation;
      if (c.position !== 0) o.position = c.position;
      if (c.spacing !== 0) o.spacing = c.spacing;
      if (P.transformMixStyle === 'mixRotate') {
        if (c.mixRotate !== 1) o.mixRotate = c.mixRotate;
        if (c.mixX !== 1) o.mixX = c.mixX;
        if (c.mixY !== c.mixX) o.mixY = c.mixY;
      } else {
        if (c.mixRotate !== 1) o.rotateMix = c.mixRotate;
        if (c.mixX !== 1) o.translateMix = c.mixX;
      }
      return o;
    });
  }
  if (ir.physics.length) {
    root.physics = ir.physics.map((c) => {
      const o: JObj = { name: c.name };
      if (c.order !== 0) o.order = c.order;
      if (c.skinRequired) o.skin = true;
      o.bone = c.bone;
      if (c.x !== 0) o.x = c.x;
      if (c.y !== 0) o.y = c.y;
      if (c.rotate !== 0) o.rotate = c.rotate;
      if (c.scaleX !== 0) o.scaleX = c.scaleX;
      if (c.shearX !== 0) o.shearX = c.shearX;
      if (c.limit !== 5000) o.limit = c.limit;
      if (c.fps !== 60) o.fps = c.fps;
      if (c.inertia !== 1) o.inertia = c.inertia;
      if (c.strength !== 100) o.strength = c.strength;
      if (c.damping !== 1) o.damping = c.damping;
      if (c.mass !== 1) o.mass = c.mass;
      if (c.wind !== 0) o.wind = c.wind;
      if (c.gravity !== 0) o.gravity = c.gravity;
      if (c.mix !== 1) o.mix = c.mix;
      if (c.inertiaGlobal) o.inertiaGlobal = true;
      if (c.strengthGlobal) o.strengthGlobal = true;
      if (c.dampingGlobal) o.dampingGlobal = true;
      if (c.massGlobal) o.massGlobal = true;
      if (c.windGlobal) o.windGlobal = true;
      if (c.gravityGlobal) o.gravityGlobal = true;
      if (c.mixGlobal) o.mixGlobal = true;
      return o;
    });
  }

  /* ---------- skins ---------- */
  const allSkins: SkinIR[] = [];
  if (ir.defaultSkin) allSkins.push(ir.defaultSkin);
  allSkins.push(...ir.skins);

  const skinToObj = (s: SkinIR): JObj => {
    const attachments: JObj = {};
    for (const e of s.entries) {
      if (!attachments[e.slot]) attachments[e.slot] = {};
      (attachments[e.slot] as JObj)[e.name] = writeAttachment(e.attachment, e.name, P);
    }
    return { attachments };
  };

  if (P.skinsAsArray) {
    root.skins = allSkins.map((s) => {
      const o: JObj = { name: s.name };
      if (s.bones.length) o.bones = s.bones;
      if (s.constraints.ik.length) o.ik = s.constraints.ik;
      if (s.constraints.transform.length) o.transform = s.constraints.transform;
      if (s.constraints.path.length) o.path = s.constraints.path;
      if (P.hasPhysics && s.constraints.physics.length) o.physics = s.constraints.physics;
      const att = skinToObj(s);
      if (Object.keys(att).length) Object.assign(o, { attachments: att.attachments });
      else o.attachments = {};
      return o;
    });
  } else {
    const skins: JObj = {};
    for (const s of allSkins) {
      const att = skinToObj(s);
      skins[s.name] = att.attachments ?? {};
    }
    root.skins = skins;
  }

  /* ---------- events ---------- */
  if (ir.events.length) {
    const events: JObj = {};
    for (const e of ir.events) {
      const o: JObj = {};
      if (e.int !== 0) o.int = e.int;
      if (e.float !== 0) o.float = e.float;
      if (e.string !== '') o.string = e.string;
      if (P.hasEventAudio && e.audio != null) {
        o.audio = e.audio;
        if (e.volume !== 1) o.volume = e.volume;
        if (e.balance !== 0) o.balance = e.balance;
      }
      events[e.name] = o;
    }
    root.events = events;
  }

  /* ---------- animations ---------- */
  if (ir.animations.length) {
    const animations: JObj = {};
    for (const anim of ir.animations) {
      animations[anim.name] = writeAnimation(anim, ir, P);
    }
    root.animations = animations;
  }

  return JSON.stringify(root, null, opts.pretty ? 2 : undefined);
}

/* ---------------- 附件 ---------------- */

function vertsToPacked(att: { verts: { weighted: boolean; vertices: number[]; bones?: number[] } }): number[] {
  const v = att.verts;
  if (!v.weighted) return v.vertices;
  const out: number[] = [];
  const bones = v.bones ?? [];
  let bi = 0, wi = 0;
  while (bi < bones.length) {
    const n = bones[bi]; bi += 1;
    out.push(n);
    for (let k = 0; k < n; k++) {
      out.push(bones[bi], v.vertices[wi], v.vertices[wi + 1], v.vertices[wi + 2]);
      bi += 1; wi += 3;
    }
  }
  return out;
}

function writeSequence(seq: NonNullable<AttachmentIR extends never ? never : { sequence?: unknown }> | any): JObj | undefined {
  if (!seq) return undefined;
  const o: JObj = { count: seq.count };
  if (seq.start !== 1) o.start = seq.start;
  if (seq.digits !== 0) o.digits = seq.digits;
  if (seq.setup !== 0) o.setup = seq.setup;
  return o;
}

function writeAttachment(a: AttachmentIR, keyName: string, P: { hasSequence: boolean }): JObj {
  const o: JObj = {};
  if (a.name !== keyName) o.name = a.name;
  switch (a.type) {
    case 'region': {
      if (a.path != null && a.path !== a.name) o.path = a.path;
      if (a.rotation !== 0) o.rotation = a.rotation;
      if (a.x !== 0) o.x = a.x;
      if (a.y !== 0) o.y = a.y;
      if (a.scaleX !== 1) o.scaleX = a.scaleX;
      if (a.scaleY !== 1) o.scaleY = a.scaleY;
      if (a.width) o.width = a.width;
      if (a.height) o.height = a.height;
      if (a.color != null && a.color !== 'ffffffff') o.color = a.color;
      if (P.hasSequence && a.sequence) o.sequence = writeSequence(a.sequence);
      return o;
    }
    case 'boundingbox': {
      o.type = 'boundingbox';
      o.vertexCount = a.verts.weighted
        ? (a.verts.bones?.length ? countPackedVertices(a.verts.bones) : a.verts.vertices.length / 6)
        : a.verts.vertices.length / 2;
      o.vertices = vertsToPacked(a);
      if (a.color != null && a.color !== '606060ff') o.color = a.color;
      return o;
    }
    case 'mesh': {
      o.type = 'mesh';
      if (a.path != null && a.path !== a.name) o.path = a.path;
      if (a.color != null && a.color !== 'ffffffff') o.color = a.color;
      if (a.width) o.width = a.width;
      if (a.height) o.height = a.height;
      o.uvs = a.uvs;
      o.triangles = a.triangles;
      o.vertices = vertsToPacked(a);
      if (a.hull > 0) o.hull = a.hull;
      if (a.edges && a.edges.length) o.edges = a.edges;
      if (P.hasSequence && a.sequence) o.sequence = writeSequence(a.sequence);
      return o;
    }
    case 'linkedmesh': {
      o.type = 'linkedmesh';
      if (a.path != null && a.path !== a.name) o.path = a.path;
      if (a.color != null && a.color !== 'ffffffff') o.color = a.color;
      if (a.skin != null) o.skin = a.skin;
      o.parent = a.parent;
      if (!a.deform) o.deform = false;
      if (a.width) o.width = a.width;
      if (a.height) o.height = a.height;
      if (P.hasSequence && a.sequence) o.sequence = writeSequence(a.sequence);
      return o;
    }
    case 'path': {
      o.type = 'path';
      if (a.closed) o.closed = true;
      if (!a.constantSpeed) o.constantSpeed = false;
      o.vertexCount = a.vertexCount;
      o.vertices = vertsToPacked(a);
      o.lengths = a.lengths;
      if (a.color != null && a.color !== 'ffd119ff') o.color = a.color;
      return o;
    }
    case 'point': {
      o.type = 'point';
      if (a.rotation !== 0) o.rotation = a.rotation;
      if (a.x !== 0) o.x = a.x;
      if (a.y !== 0) o.y = a.y;
      if (a.color != null && a.color !== 'f1f100ff') o.color = a.color;
      return o;
    }
    case 'clipping': {
      o.type = 'clipping';
      o.end = a.end;
      o.vertexCount = a.vertexCount;
      o.vertices = vertsToPacked(a);
      if (a.color != null && a.color !== 'ce3a3aff') o.color = a.color;
      return o;
    }
  }
}

function countPackedVertices(bones: number[]): number {
  let n = 0, i = 0;
  while (i < bones.length) {
    const c = bones[i]; i += 1 + c;
    n++;
  }
  return n;
}

/* ---------------- 动画 ---------------- */


function writeAnimation(anim: AnimationIR, ir: SkeletonIR, P: VersionProfile): JObj {
  const out: JObj = {};
  const is38 = P.ver === '3.8';
  const is4 = P.num >= 400;

  /** 曲线写入：3.2~3.7 共享归一化数组；3.8 兄弟键；4.x 逐值绝对坐标数组 */
  const putCurve = (
    o: JObj, keys: { time: number; curves?: Curve[] }[], i: number,
    getValues: (i: number) => number[],
  ) => {
    const curves = keys[i]?.curves;
    if (!curves) return;
    const first = curves[0];
    if (first == null) return;
    if (is4) {
      if (curves.length > 0 && curves.every((c) => c != null && 'stepped' in c)) { o.curve = 'stepped'; return; }
      if (!curves.some((c) => c != null && 'bezier' in c)) return;
      /* 曲线已由 convertSkeletonCurves 统一为 4.x 绝对坐标，原样写出；缺值用端点占位 */
      const t0 = keys[i].time;
      const t1 = keys[i + 1] ? keys[i + 1].time : t0;
      const v0 = getValues(i);
      const v1 = keys[i + 1] ? getValues(i + 1) : v0;
      const out: number[] = [];
      for (let val = 0; val < curves.length; val++) {
        const c = curves[val];
        if (c && 'bezier' in c) out.push(...c.bezier);
        else out.push(t0, v0[val] ?? 0, t1, v1[val] ?? 0);
      }
      o.curve = out;
      return;
    }
    if ('stepped' in first) { o.curve = 'stepped'; return; }
    if (is38) {
      o.curve = first.bezier[0];
      if (first.bezier[1] !== 0) o.c2 = first.bezier[1];
      if (first.bezier[2] !== 1) o.c3 = first.bezier[2];
      if (first.bezier[3] !== 1) o.c4 = first.bezier[3];
      return;
    }
    o.curve = [...first.bezier];
  };

  const t = (v: number) => (v !== 0 ? v : undefined);

  /* 槽位 */
  const slots: JObj = {};
  for (const [slotName, st] of Object.entries(anim.slot)) {
    const tl: JObj = {};
    if (st.attachment?.length) {
      tl.attachment = st.attachment.map((k) => {
        const o: JObj = {};
        if (k.time !== 0) o.time = k.time;
        o.name = k.name;
        return o;
      });
    }
    if (st.color?.length) {
      const name = P.slotColorNames === 'rgba' ? 'rgba' : 'color';
      tl[name] = st.color.map((k, i) => {
        const o: JObj = {};
        if (k.time !== 0) o.time = k.time;
        o.color = k.color;
        putCurve(o, st.color!, i, (j) => hexToRgba(st.color![j].color).map((x) => x / 255));
        return o;
      });
    }
    if (st.twoColor?.length && P.hasTwoColor) {
      const name = P.slotColorNames === 'rgba' ? 'rgba2' : 'twoColor';
      tl[name] = st.twoColor.map((k, i) => {
        const o: JObj = {};
        if (k.time !== 0) o.time = k.time;
        o.light = k.light;
        o.dark = k.dark;
        putCurve(o, st.twoColor!, i, (j) => [...hexToRgba(st.twoColor![j].light).map((x) => x / 255), ...hexToRgba(st.twoColor![j].dark).slice(0, 3).map((x) => x / 255)]);
        return o;
      });
    }
    if (st.alpha?.length && P.hasAlphaTimeline) {
      tl.alpha = st.alpha.map((k, i) => {
        const o: JObj = {};
        if (k.time !== 0) o.time = k.time;
        if (k.value !== 0) o.value = k.value;
        putCurve(o, st.alpha!, i, (j) => [st.alpha![j].value]);
        return o;
      });
    }
    if (Object.keys(tl).length) slots[slotName] = tl;
  }
  if (Object.keys(slots).length) out.slots = slots;

  /* 骨骼 */
  const bones: JObj = {};
  for (const [boneName, bt] of Object.entries(anim.bone)) {
    const tl: JObj = {};
    if (bt.rotate?.length) {
      tl.rotate = bt.rotate.map((k, i) => {
        const o: JObj = {};
        if (k.time !== 0) o.time = k.time;
        if (k.angle !== 0) {
          if (is4) o.value = k.angle; else o.angle = k.angle;
        }
        putCurve(o, bt.rotate!, i, (j) => [bt.rotate![j].angle]);
        return o;
      });
    }
    const writeXY = (key: string, keys: XYKey[] | undefined, dx: number, dy: number) => {
      if (!keys?.length) return;
      tl[key] = keys.map((k, i) => {
        const o: JObj = {};
        if (k.time !== 0) o.time = k.time;
        if (k.x !== dx) o.x = k.x;
        if (k.y !== dy) o.y = k.y;
        putCurve(o, keys, i, (j) => [keys[j].x, keys[j].y]);
        return o;
      });
    };
    writeXY('translate', bt.translate, 0, 0);
    writeXY('scale', bt.scale, 1, 1);
    writeXY('shear', bt.shear, 0, 0);
    if (P.hasSingleAxis) {
      const write1 = (key: string, keys: SingleKey[] | undefined, dflt: number) => {
        if (!keys?.length) return;
        tl[key] = keys.map((k, i) => {
          const o: JObj = {};
          if (k.time !== 0) o.time = k.time;
          if (k.value !== dflt) o.value = k.value;
          putCurve(o, keys, i, (j) => [keys[j].value]);
          return o;
        });
      };
      write1('translatex', bt.translatex, 0);
      write1('translatey', bt.translatey, 0);
      write1('scalex', bt.scalex, 1);
      write1('scaley', bt.scaley, 1);
      write1('shearx', bt.shearx, 0);
      write1('sheary', bt.sheary, 0);
    }
    if (bt.inherit?.length && P.hasInheritTimeline) {
      tl.inherit = bt.inherit.map((k) => {
        const o: JObj = {};
        if (k.time !== 0) o.time = k.time;
        o.inherit = k.inherit;
        return o;
      });
    }
    if (Object.keys(tl).length) bones[boneName] = tl;
  }
  if (Object.keys(bones).length) out.bones = bones;

  /* IK */
  const iks: JObj = {};
  for (const [name, keys] of Object.entries(anim.ik)) {
    if (!keys.length) continue;
    iks[name] = keys.map((k, i) => {
      const o: JObj = {};
      if (k.time !== 0) o.time = k.time;
      if (k.mix !== 1) o.mix = k.mix;
      if (P.hasIkSoftness && k.softness !== 0) o.softness = k.softness;
      if (k.bendDirection === -1) o.bendPositive = false;
      if (P.hasIkStretch) {
        if (k.compress) o.compress = true;
        if (k.stretch) o.stretch = true;
      }
      putCurve(o, keys, i, (j) => [keys[j].mix, keys[j].softness]);
      return o;
    });
  }
  if (Object.keys(iks).length) out.ik = iks;

  /* 变换约束 */
  const transforms: JObj = {};
  for (const [name, keys] of Object.entries(anim.transform)) {
    if (!keys.length) continue;
    transforms[name] = keys.map((k, i) => {
      const o: JObj = {};
      if (k.time !== 0) o.time = k.time;
      if (P.transformMixStyle === 'mixRotate') {
        if (k.mixRotate !== 1) o.mixRotate = k.mixRotate;
        if (k.mixX !== 1) o.mixX = k.mixX;
        if (k.mixY !== k.mixX) o.mixY = k.mixY;
        if (k.mixScaleX !== 1) o.mixScaleX = k.mixScaleX;
        if (k.mixScaleY !== k.mixScaleX) o.mixScaleY = k.mixScaleY;
        if (k.mixShearY !== 1) o.mixShearY = k.mixShearY;
      } else {
        if (k.mixRotate !== 1) o.rotateMix = k.mixRotate;
        if (k.mixX !== 1) o.translateMix = k.mixX;
        if (k.mixScaleX !== 1) o.scaleMix = k.mixScaleX;
        if (k.mixShearY !== 1) o.shearMix = k.mixShearY;
      }
      putCurve(o, keys, i, (j) => [keys[j].mixRotate, keys[j].mixX, keys[j].mixY, keys[j].mixScaleX, keys[j].mixScaleY, keys[j].mixShearY]);
      return o;
    });
  }
  if (Object.keys(transforms).length) out.transform = transforms;

  /* 路径约束 */
  const paths: JObj = {};
  for (const [name, pt] of Object.entries(anim.path)) {
    const tl: JObj = {};
    const single = (field: 'position' | 'spacing', keys: SingleKey[] | undefined) => {
      if (!keys?.length) return;
      tl[field] = keys.map((k, i) => {
        const o: JObj = {};
        if (k.time !== 0) o.time = k.time;
        const v = k.value !== 0 ? k.value : undefined;
        if (v !== undefined) {
          if (is4) o.value = v; else o[field] = v;
        }
        putCurve(o, keys, i, (j) => [keys[j].value]);
        return o;
      });
    };
    single('position', pt.position);
    single('spacing', pt.spacing);
    if (pt.mix?.length) {
      tl.mix = pt.mix.map((k, i) => {
        const o: JObj = {};
        if (k.time !== 0) o.time = k.time;
        if (P.transformMixStyle === 'mixRotate') {
          if (k.mixRotate !== 1) o.mixRotate = k.mixRotate;
          if (k.mixX !== 1) o.mixX = k.mixX;
          if (k.mixY !== k.mixX) o.mixY = k.mixY;
        } else {
          if (k.mixRotate !== 1) o.rotateMix = k.mixRotate;
          if (k.mixX !== 1) o.translateMix = k.mixX;
        }
        putCurve(o, pt.mix!, i, (j) => [pt.mix![j].mixRotate, pt.mix![j].mixX, pt.mix![j].mixY]);
        return o;
      });
    }
    if (Object.keys(tl).length) paths[name] = tl;
  }
  if (Object.keys(paths).length) out.path = paths;

  /* 物理（4.2） */
  if (P.hasPhysics) {
    const phys: JObj = {};
    for (const [name, pt] of Object.entries(anim.physics)) {
      const tl: JObj = {};
      for (const field of ['inertia', 'strength', 'damping', 'mass', 'wind', 'gravity', 'mix'] as const) {
        const keys = pt[field];
        if (!keys?.length) continue;
        tl[field] = keys.map((k, i) => {
          const o: JObj = {};
          if (k.time !== 0) o.time = k.time;
          if (k.value !== 0) o.value = k.value;
          putCurve(o, keys, i, (j) => [keys[j].value]);
          return o;
        });
      }
      if (pt.reset?.length) {
        tl.reset = pt.reset.map((k) => {
          const o: JObj = {};
          if (k.time !== 0) o.time = k.time;
          return o;
        });
      }
      if (Object.keys(tl).length) phys[name] = tl;
    }
    if (Object.keys(phys).length) out.physics = phys;
  }

  /* deform / attachments 节（皮肤 > 槽位 > 附件） */
  const section: JObj = {};
  const atts = P.deformSection === 'attachments';
  for (const [skinName, slots] of Object.entries(anim.deform)) {
    const slotsOut: JObj = (section[skinName] as JObj) ??= {};
    for (const [slotName, slotAtts] of Object.entries(slots)) {
      const slotOut: JObj = (slotsOut[slotName] as JObj) ??= {};
      for (const [attName, keys] of Object.entries(slotAtts)) {
        if (!keys.length) continue;
        const deformKeys = keys.map(writeDeformKeyJson38(is38));
        if (atts) {
          const target: JObj = (slotOut[attName] as JObj) ??= {};
          target.deform = deformKeys;
        } else {
          slotOut[attName] = deformKeys;
        }
      }
    }
  }
  if (P.hasSequence) {
    for (const [skinName, slots] of Object.entries(anim.sequence)) {
      const slotsOut: JObj = (section[skinName] as JObj) ??= {};
      for (const [slotName, slotAtts] of Object.entries(slots)) {
        const slotOut: JObj = (slotsOut[slotName] as JObj) ??= {};
        for (const [attName, keys] of Object.entries(slotAtts)) {
          if (!keys.length) continue;
          const seqKeys = keys.map((k) => {
            const o: JObj = {};
            if (k.time !== 0) o.time = k.time;
            if (k.delay !== 0) o.delay = k.delay;
            if (k.mode !== 'hold') o.mode = k.mode;
            if (k.index !== 0) o.index = k.index;
            return o;
          });
          if (atts) {
            const existing = slotOut[attName];
            const target: JObj = Array.isArray(existing)
              ? { deform: existing }
              : ((existing as JObj) ?? {});
            slotOut[attName] = target;
            target.sequence = seqKeys;
          }
        }
      }
    }
  }
  if (Object.keys(section).length) out[P.deformSection] = section;

  /* drawOrder */
  if (anim.drawOrder.length) {
    out.drawOrder = anim.drawOrder.map((k) => {
      const o: JObj = {};
      if (k.time !== 0) o.time = k.time;
      if (k.offsets != null && k.offsets.length) {
        o.offsets = k.offsets.map((off) => ({ slot: off.slot, offset: off.offset }));
      }
      return o;
    });
  }

  /* 事件 */
  if (anim.events.length) {
    out.events = anim.events.map((k) => {
      const o: JObj = {};
      if (k.time !== 0) o.time = k.time;
      o.name = k.name;
      if (k.int != null && k.int !== 0) o.int = k.int;
      if (k.float != null && k.float !== 0) o.float = k.float;
      if (k.string != null && k.string !== '') o.string = k.string;
      if (k.volume != null && k.volume !== 1) o.volume = k.volume;
      if (k.balance != null && k.balance !== 0) o.balance = k.balance;
      return o;
    });
  }

  return out;
}

/** deform 键 → JSON（3.8 曲线为兄弟键形式） */
function writeDeformKeyJson38(is38: boolean) {
  return (k: DeformKey): JObj => {
    const o: JObj = {};
    if (k.time !== 0) o.time = k.time;
    if (k.vertices != null && k.vertices.length) {
      if (k.offset !== 0) o.offset = k.offset;
      o.vertices = k.vertices;
    }
    if (k.curve) {
      if ('stepped' in k.curve) o.curve = 'stepped';
      else if (is38) {
        o.curve = k.curve.bezier[0];
        if (k.curve.bezier[1] !== 0) o.c2 = k.curve.bezier[1];
        if (k.curve.bezier[2] !== 1) o.c3 = k.curve.bezier[2];
        if (k.curve.bezier[3] !== 1) o.c4 = k.curve.bezier[3];
      } else {
        o.curve = [...k.curve.bezier];
      }
    }
    return o;
  };
}


