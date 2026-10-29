/** 格式与版本探测 */
import { parseVersionString } from './spec';
import type { SpineVersion } from './types';

export interface Detected {
  format: 'json' | 'binary';
  /** 原始版本串（如 "4.2.22"）；二进制 3.x/4.x 均可从文件头读出 */
  versionString: string | null;
  /** 解析出的主次版本；无法确定时为 null */
  version: SpineVersion | null;
  /** 版本推断说明（用于 UI 提示） */
  note?: string;
}

/** 探测二进制 .skel 的版本（读取头部 hash+version 字符串） */
export function detectBinary(data: ArrayBuffer): Detected {
  const d = new DataView(data);
  const r = new BinPeek(d);
  try {
    // 4.x：hash 为 8 字节 long；3.x：hash 为字符串
    // 先按 3.x 读：字符串首字节是 varint 长度（通常 < 0x80）
    const b0 = d.getUint8(0);
    if (b0 === 0) {
      // hash long == 0？继续读版本字符串判断 4.x
      const ver = r.tryStringAt(8);
      if (ver != null && /^\d+\.\d+\./.test(ver)) {
        return { format: 'binary', versionString: ver, version: parseVersionString(ver) };
      }
      throw new Error('无法识别的二进制头部');
    }
    if (b0 < 0x80 && b0 > 0) {
      // 可能是 3.x 字符串 hash
      const hash = r.tryStringAt(0);
      if (hash != null) {
        const off = r.lastEnd;
        const ver = r.tryStringAt(off);
        if (ver != null && /^\d+\.\d+\./.test(ver)) {
          return { format: 'binary', versionString: ver, version: parseVersionString(ver) };
        }
      }
      // 也可能是 4.x：前 8 字节恰好首字节 <0x80
      const ver4 = r.tryStringAt(8);
      if (ver4 != null && /^\d+\.\d+\./.test(ver4)) {
        return { format: 'binary', versionString: ver4, version: parseVersionString(ver4) };
      }
    }
    // 4.x：hash 首字节 >= 0x80（varint 字符串长度不可能）
    const ver4 = r.tryStringAt(8);
    if (ver4 != null && /^\d+\.\d+\./.test(ver4)) {
      return { format: 'binary', versionString: ver4, version: parseVersionString(ver4) };
    }
    throw new Error('无法识别的二进制头部（读取版本字符串失败）');
  } catch (e) {
    // 兜底：扫描前 64 字节寻找版本字符串模式
    const bytes = new Uint8Array(data.slice(0, 64));
    const text = String.fromCharCode(...bytes);
    const m = /(\d)\.(\d)\.(\d+)/.exec(text);
    if (m) {
      const ver = `${m[1]}.${m[2]}` as SpineVersion;
      return {
        format: 'binary', versionString: m[0],
        version: parseVersionString(m[0]),
        note: '版本号由启发式扫描得出',
      };
    }
    throw e;
  }
}

class BinPeek {
  lastEnd = 0;
  constructor(private d: DataView) {}
  tryStringAt(offset: number): string | null {
    try {
      // varint 长度
      let i = offset;
      let b = this.d.getUint8(i); i += 1;
      let len = b & 0x7f; let shift = 7;
      while (b & 0x80) {
        if (i >= this.d.byteLength) return null;
        b = this.d.getUint8(i); i += 1;
        len += (b & 0x7f) * Math.pow(2, shift); shift += 7;
        if (shift > 35) return null;
      }
      if (len === 0 || len - 1 > 32 || i + len - 1 > this.d.byteLength) return null;
      const bytes = new Uint8Array(this.d.buffer, this.d.byteOffset + i, len - 1);
      const s = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
      this.lastEnd = i + len - 1;
      return s;
    } catch {
      return null;
    }
  }
}

/** 探测 JSON 并读取 skeleton.spine 版本 */
export function detectJson(text: string): Detected {
  let root: unknown;
  try {
    root = JSON.parse(text);
  } catch {
    throw new Error('JSON 解析失败：文件不是有效的 JSON');
  }
  if (typeof root !== 'object' || root == null || !('bones' in root)) {
    throw new Error('JSON 结构不符合 Spine 骨骼数据格式（缺少 bones 节）');
  }
  const obj = root as Record<string, unknown>;
  const skel = (obj.skeleton ?? null) as Record<string, unknown> | null;
  const spine = skel && typeof skel.spine === 'string' ? skel.spine : null;
  const ver = parseVersionString(spine);
  const detected: Detected = {
    format: 'json', versionString: spine, version: ver,
  };
  if (!ver) {
    // 无版本字段：按结构特征推断（3.5 及更早可能没有 spine 字段——实测 3.4 就有，
    // 但手写/早期文件可能缺失）
    const hasPath = 'path' in obj;
    const hasTransform = 'transform' in obj;
    if (hasPath) {
      detected.note = '文件缺少 spine 版本字段；检测到路径约束，推断为 3.4~3.5（可在下方手动指定）';
    } else if (hasTransform) {
      detected.note = '文件缺少 spine 版本字段；检测到变换约束，推断为 3.3~3.4（可在下方手动指定）';
    } else {
      detected.note = '文件缺少 spine 版本字段，推断为 3.2 或更早（可在下方手动指定）';
    }
  }
  return detected;
}

/** 检测任意输入（先尝试 JSON 文本特征，再按二进制） */
export function detect(data: ArrayBuffer, fileName = ''): Detected {
  const name = fileName.toLowerCase();
  if (name.endsWith('.json')) {
    return detectJson(new TextDecoder('utf-8', { fatal: false }).decode(data));
  }
  if (name.endsWith('.skel') || name.endsWith('.bin')) {
    return detectBinary(data);
  }
  // 按内容判断：JSON 以 { 或空白+{ 开头
  const head = new Uint8Array(data.slice(0, 64));
  let i = 0;
  while (i < head.length && (head[i] === 0xef || head[i] === 0xbb || head[i] === 0xbf
    || head[i] === 0x20 || head[i] === 0x09 || head[i] === 0x0a || head[i] === 0x0d)) i++;
  if (i < head.length && head[i] === 0x7b) {
    return detectJson(new TextDecoder('utf-8', { fatal: false }).decode(data));
  }
  return detectBinary(data);
}
