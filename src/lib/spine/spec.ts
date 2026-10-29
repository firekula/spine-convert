/**
 * 版本能力档案 —— 全部依据官方运行时源码实证（见 research/spine-format-spec.md）。
 */
import type { SpineVersion } from './types';

export const ALL_VERSIONS: SpineVersion[] = [
  '3.2', '3.3', '3.4', '3.5', '3.6', '3.7', '3.8', '4.0', '4.1', '4.2',
];

/** 数字化版本号便于比较：'3.8' → 308，'4.2' → 402 */
export function verNum(v: SpineVersion): number {
  const [a, b] = v.split('.').map(Number);
  return a * 100 + b;
}

export function cmpVer(a: SpineVersion, b: SpineVersion): number {
  return verNum(a) - verNum(b);
}

/** 二进制格式族 */
export type BinaryFamily = 'A' | 'B' | 'B2' | 'C' | 'D' | 'E' | 'F';

export interface VersionProfile {
  ver: SpineVersion;
  num: number;
  binaryFamily: BinaryFamily | null;
  /* ---- JSON 能力 ---- */
  skinsAsArray: boolean;          // 3.8+ 数组；3.2~3.7 对象
  slotColorNames: 'color' | 'rgba'; // 3.x: color/twoColor；4.x: rgba/rgb/rgba2/rgb2/alpha
  hasTwoColor: boolean;           // 3.6+
  hasSlotDark: boolean;           // 3.6+
  hasPoint: boolean;              // 3.6+
  hasClipping: boolean;           // 3.6+
  hasTransformConstraints: boolean; // 3.3+
  hasPathConstraints: boolean;    // 3.4+
  hasIkSoftness: boolean;         // 3.8+
  hasIkStretch: boolean;          // 3.7+（compress/stretch/uniform）
  hasConstraintOrder: boolean;    // 3.5+
  hasTransformModes: boolean;     // 3.5+（3.4- 用 inheritRotation/inheritScale）
  hasEventAudio: boolean;         // 3.7+（audio/volume/balance）
  hasSkinRequired: boolean;       // 3.8+
  hasSkinBones: boolean;          // 3.8+（皮肤级 bones/constraints）
  hasSkeletonOffset: boolean;     // 3.8+（骨架 x/y）
  hasPerValueCurves: boolean;     // 4.0+
  hasSingleAxis: boolean;         // 4.0+（translatex/scalex/shearx...）
  hasAlphaTimeline: boolean;      // 4.0+
  hasMixY: boolean;               // 4.0+（transform mixY/mixScaleY、path mixY）
  transformMixStyle: 'rotateMix' | 'mixRotate'; // 3.x vs 4.x 字段名
  hasSequence: boolean;           // 4.1+
  deformSection: 'deform' | 'attachments'; // 4.1+ 改名
  hasPhysics: boolean;            // 4.2+
  hasInheritTimeline: boolean;    // 4.2+
  hasBoneIcon: boolean;           // 4.2+
  blendHasScreen: boolean;        // 3.5+
  hasBoneColors: boolean;         // JSON 一直可写（编辑器颜色，nonessential）；二进制 3.4+ nonessential
  /* ---- 二进制族内差异 ---- */
  bin: {
    hasStrTable: boolean;         // 3.8+
    hasSkeletonXY: boolean;       // 3.8+
    hasRefScale: boolean;         // 4.2
    hasFps: boolean;              // 3.5+
    hasAudioPath: boolean;        // 3.7+
    hashAsLong: boolean;          // 4.0+
    hasSlotDark: boolean;         // 3.6+
    hasTwoColorTimeline: boolean; // 3.6+
    hasPoint: boolean;
    hasClipping: boolean;
    hasConstraintOrder: boolean;  // 3.5+
    hasTransformModes: boolean;   // 3.5+（3.4- 为 inheritRotation/inheritScale 两布尔）
    hasIkStretch: boolean;        // 3.7+
    hasIkSoftness: boolean;       // 3.8+
    hasSkinRequired: boolean;     // 3.8+
    hasSkinBones: boolean;        // 3.8+
    hasEventAudio: boolean;       // 3.7+
    hasInheritDeform: boolean;    // 3.8+（linkedmesh deform 布尔）
    byteColors: boolean;          // 4.0+ 动画槽位颜色为单字节
    perValueCurves: boolean;      // 4.0+
    hasBezierCount: boolean;      // 4.0+
    hasSequence: boolean;         // 4.1+
    hasAttachTypeByte: boolean;   // 4.1+（deform 节内类型字节）
    hasPhysics: boolean;          // 4.2
    flagsConstraints: boolean;    // 4.2（IK/transform/path flags 压缩）
    attachmentFlags: boolean;     // 4.2（附件 flags 字节）
    shortAsVarint: boolean;       // 4.2（short 数组以 varint 编码）
    meshNewLayout: boolean;       // 4.2（hullLength 前移、triangles 派生计数）
    linkedBySkinIndex: boolean;   // 4.2
    skinColor: boolean;           // 4.2
    boneIconVisible: boolean;     // 4.2
    inheritAsByte: boolean;       // 4.2（transformMode 读为字节而非 varint）
    eventStringNoBool: boolean;   // 4.2（事件串无布尔前缀）
    /** 3.2/3.3 目标：不写 transform/path 约束节 */
    omitTransformPathSections: boolean;
  };
}

function base(ver: SpineVersion): VersionProfile {
  return {
    ver, num: verNum(ver), binaryFamily: null,
    skinsAsArray: false, slotColorNames: 'color', hasTwoColor: false, hasSlotDark: false,
    hasPoint: false, hasClipping: false, hasTransformConstraints: false, hasPathConstraints: false,
    hasIkSoftness: false, hasIkStretch: false, hasConstraintOrder: false, hasTransformModes: false,
    hasEventAudio: false, hasSkinRequired: false, hasSkinBones: false, hasSkeletonOffset: false,
    hasPerValueCurves: false, hasSingleAxis: false, hasAlphaTimeline: false, hasMixY: false,
    transformMixStyle: 'rotateMix', hasSequence: false, deformSection: 'deform',
    hasPhysics: false, hasInheritTimeline: false, hasBoneIcon: false, blendHasScreen: false,
    hasBoneColors: true,
    bin: {
      hasStrTable: false, hasSkeletonXY: false, hasRefScale: false, hasFps: false,
      hasAudioPath: false, hashAsLong: false, hasSlotDark: false, hasTwoColorTimeline: false,
      hasPoint: false, hasClipping: false, hasConstraintOrder: false, hasTransformModes: false,
      hasIkStretch: false, hasIkSoftness: false, hasSkinRequired: false, hasSkinBones: false,
      hasEventAudio: false, hasInheritDeform: false, byteColors: false, perValueCurves: false,
      hasBezierCount: false, hasSequence: false, hasAttachTypeByte: false, hasPhysics: false,
      flagsConstraints: false, attachmentFlags: false, shortAsVarint: false, meshNewLayout: false,
      linkedBySkinIndex: false, skinColor: false, boneIconVisible: false, inheritAsByte: false,
      eventStringNoBool: false, omitTransformPathSections: false,
    },
  };
}

function make(ver: SpineVersion, mut: (p: VersionProfile) => void): VersionProfile {
  const p = base(ver);
  mut(p);
  return p;
}

export const PROFILES: Record<SpineVersion, VersionProfile> = {
  '3.2': make('3.2', (p) => {
    p.binaryFamily = 'A';
    p.bin.omitTransformPathSections = true;
  }),
  '3.3': make('3.3', (p) => {
    p.binaryFamily = 'A';
    p.hasTransformConstraints = true;
    p.bin.omitTransformPathSections = true;
  }),
  '3.4': make('3.4', (p) => {
    p.binaryFamily = 'A';
    p.hasTransformConstraints = true;
    p.hasPathConstraints = true;
  }),
  '3.5': make('3.5', (p) => {
    p.binaryFamily = 'B';
    p.hasTransformConstraints = true; p.hasPathConstraints = true;
    p.hasConstraintOrder = true; p.hasTransformModes = true; p.blendHasScreen = true;
    p.bin.hasConstraintOrder = true; p.bin.hasTransformModes = true; p.bin.hasFps = true;
  }),
  '3.6': make('3.6', (p) => {
    p.binaryFamily = 'B2';
    p.hasTransformConstraints = true; p.hasPathConstraints = true;
    p.hasConstraintOrder = true; p.hasTransformModes = true; p.blendHasScreen = true;
    p.hasTwoColor = true; p.hasSlotDark = true; p.hasPoint = true; p.hasClipping = true;
    p.bin.hasConstraintOrder = true; p.bin.hasTransformModes = true; p.bin.hasFps = true;
    p.bin.hasSlotDark = true; p.bin.hasTwoColorTimeline = true;
    p.bin.hasPoint = true; p.bin.hasClipping = true;
  }),
  '3.7': make('3.7', (p) => {
    p.binaryFamily = 'B2';
    Object.assign(p, {
      hasTransformConstraints: true, hasPathConstraints: true, hasConstraintOrder: true,
      hasTransformModes: true, blendHasScreen: true, hasTwoColor: true, hasSlotDark: true,
      hasPoint: true, hasClipping: true, hasIkStretch: true, hasEventAudio: true,
    });
    Object.assign(p.bin, {
      hasConstraintOrder: true, hasTransformModes: true, hasFps: true,
      hasSlotDark: true, hasTwoColorTimeline: true, hasPoint: true, hasClipping: true,
      hasIkStretch: true, hasAudioPath: true, hasEventAudio: true,
    });
  }),
  '3.8': make('3.8', (p) => {
    p.binaryFamily = 'C';
    Object.assign(p, {
      hasTransformConstraints: true, hasPathConstraints: true, hasConstraintOrder: true,
      hasTransformModes: true, blendHasScreen: true, hasTwoColor: true, hasSlotDark: true,
      hasPoint: true, hasClipping: true, hasIkStretch: true, hasEventAudio: true,
      hasIkSoftness: true, hasSkinRequired: true, hasSkinBones: true, hasSkeletonOffset: true,
      skinsAsArray: true,
    });
    Object.assign(p.bin, {
      hasConstraintOrder: true, hasTransformModes: true, hasFps: true,
      hasSlotDark: true, hasTwoColorTimeline: true, hasPoint: true, hasClipping: true,
      hasIkStretch: true, hasAudioPath: true, hasEventAudio: true, hasIkSoftness: true,
      hasSkinRequired: true, hasSkinBones: true, hasSkeletonXY: true, hasStrTable: true,
      hasInheritDeform: true,
    });
  }),
  '4.0': make('4.0', (p) => {
    p.binaryFamily = 'D';
    Object.assign(p, {
      hasTransformConstraints: true, hasPathConstraints: true, hasConstraintOrder: true,
      hasTransformModes: true, blendHasScreen: true, hasTwoColor: true, hasSlotDark: true,
      hasPoint: true, hasClipping: true, hasIkStretch: true, hasEventAudio: true,
      hasIkSoftness: true, hasSkinRequired: true, hasSkinBones: true, hasSkeletonOffset: true,
      skinsAsArray: true, slotColorNames: 'rgba', hasPerValueCurves: true, hasSingleAxis: true,
      hasAlphaTimeline: true, hasMixY: true, transformMixStyle: 'mixRotate',
    });
    Object.assign(p.bin, {
      hasConstraintOrder: true, hasTransformModes: true, hasFps: true,
      hasSlotDark: true, hasTwoColorTimeline: true, hasPoint: true, hasClipping: true,
      hasIkStretch: true, hasAudioPath: true, hasEventAudio: true, hasIkSoftness: true,
      hasSkinRequired: true, hasSkinBones: true, hasSkeletonXY: true, hasStrTable: true,
      hasInheritDeform: true, hashAsLong: true, byteColors: true, perValueCurves: true,
      hasBezierCount: true,
    });
  }),
  '4.1': make('4.1', (p) => {
    p.binaryFamily = 'E';
    Object.assign(p, {
      hasTransformConstraints: true, hasPathConstraints: true, hasConstraintOrder: true,
      hasTransformModes: true, blendHasScreen: true, hasTwoColor: true, hasSlotDark: true,
      hasPoint: true, hasClipping: true, hasIkStretch: true, hasEventAudio: true,
      hasIkSoftness: true, hasSkinRequired: true, hasSkinBones: true, hasSkeletonOffset: true,
      skinsAsArray: true, slotColorNames: 'rgba', hasPerValueCurves: true, hasSingleAxis: true,
      hasAlphaTimeline: true, hasMixY: true, transformMixStyle: 'mixRotate',
      hasSequence: true, deformSection: 'attachments',
    });
    Object.assign(p.bin, {
      hasConstraintOrder: true, hasTransformModes: true, hasFps: true,
      hasSlotDark: true, hasTwoColorTimeline: true, hasPoint: true, hasClipping: true,
      hasIkStretch: true, hasAudioPath: true, hasEventAudio: true, hasIkSoftness: true,
      hasSkinRequired: true, hasSkinBones: true, hasSkeletonXY: true, hasStrTable: true,
      hasInheritDeform: true, hashAsLong: true, byteColors: true, perValueCurves: true,
      hasBezierCount: true, hasSequence: true, hasAttachTypeByte: true,
    });
  }),
  '4.2': make('4.2', (p) => {
    p.binaryFamily = 'F';
    Object.assign(p, {
      hasTransformConstraints: true, hasPathConstraints: true, hasConstraintOrder: true,
      hasTransformModes: true, blendHasScreen: true, hasTwoColor: true, hasSlotDark: true,
      hasPoint: true, hasClipping: true, hasIkStretch: true, hasEventAudio: true,
      hasIkSoftness: true, hasSkinRequired: true, hasSkinBones: true, hasSkeletonOffset: true,
      skinsAsArray: true, slotColorNames: 'rgba', hasPerValueCurves: true, hasSingleAxis: true,
      hasAlphaTimeline: true, hasMixY: true, transformMixStyle: 'mixRotate',
      hasSequence: true, deformSection: 'attachments',
      hasPhysics: true, hasInheritTimeline: true, hasBoneIcon: true,
    });
    Object.assign(p.bin, {
      hasConstraintOrder: true, hasTransformModes: true, hasFps: true,
      hasSlotDark: true, hasTwoColorTimeline: true, hasPoint: true, hasClipping: true,
      hasIkStretch: true, hasAudioPath: true, hasEventAudio: true, hasIkSoftness: true,
      hasSkinRequired: true, hasSkinBones: true, hasSkeletonXY: true, hasStrTable: true,
      hasInheritDeform: true, hashAsLong: true, byteColors: true, perValueCurves: true,
      hasBezierCount: true, hasSequence: true, hasAttachTypeByte: true, hasPhysics: true,
      flagsConstraints: true, attachmentFlags: true, shortAsVarint: true, meshNewLayout: true,
      linkedBySkinIndex: true, skinColor: true, boneIconVisible: true, inheritAsByte: true,
      eventStringNoBool: true, hasRefScale: true,
    });
  }),
};

/** 从版本字符串（如 "3.8.55"）解析主次版本 */
export function parseVersionString(s: string | null | undefined): SpineVersion | null {
  if (!s) return null;
  const m = /^(\d)\.(\d)\./.exec(s.trim());
  if (!m) return null;
  const v = `${m[1]}.${m[2]}` as SpineVersion;
  return PROFILES[v] ? v : null;
}

/** 各版本写出的编辑器版本串（补丁号取该系列末期版本） */
export const VERSION_STRINGS: Record<SpineVersion, string> = {
  '3.2': '3.2.08', '3.3': '3.3.04', '3.4': '3.4.02', '3.5': '3.5.51',
  '3.6': '3.6.53', '3.7': '3.7.94', '3.8': '3.8.99',
  '4.0': '4.0.64', '4.1': '4.1.00', '4.2': '4.2.22',
};
