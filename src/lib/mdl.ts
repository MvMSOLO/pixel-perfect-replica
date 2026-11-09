// GoldSrc (Half-Life / CS 1.6) studio model v10 reader and texture patcher. Fully deterministic.
export type MdlTexture = { name: string; flags: number; width: number; height: number; index: number; headerOffset: number };
export type MdlMesh = { skinref: number; positions: number[]; uvs: number[] };
export type Mdl = { name: string; textures: MdlTexture[]; skinTable: number[]; meshes: MdlMesh[]; buffer: ArrayBuffer };

const str = (dv: DataView, off: number, len: number) => {
  let s = "";
  for (let i = 0; i < len; i++) { const c = dv.getUint8(off + i); if (!c) break; s += String.fromCharCode(c); }
  return s;
};

type M = number[]; // 3x4 row-major
function boneMatrix(v: number[]): M {
  const [x, y, z, ax, ay, az] = v;
  const sr = Math.sin(ax), cr = Math.cos(ax), sp = Math.sin(ay), cp = Math.cos(ay), sy = Math.sin(az), cy = Math.cos(az);
  // GoldSrc AngleMatrix (angles = pitch-like X roll, Y, Z order as in studio bone values)
  return [
    cp * cy, sr * sp * cy - cr * sy, cr * sp * cy + sr * sy, x,
    cp * sy, sr * sp * sy + cr * cy, cr * sp * sy - sr * cy, y,
    -sp, sr * cp, cr * cp, z,
  ];
}
function mul(a: M, b: M): M {
  const o = new Array(12).fill(0);
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 4; c++) {
      o[r * 4 + c] = a[r * 4] * b[c] + a[r * 4 + 1] * b[4 + c] + a[r * 4 + 2] * b[8 + c] + (c === 3 ? a[r * 4 + 3] : 0);
    }
  }
  return o;
}

export function parseMdl(buffer: ArrayBuffer): Mdl {
  const dv = new DataView(buffer);
  const len = buffer.byteLength;
  const fail = (m: string) => { throw new Error(m); };
  if (len < 244) fail("File is too small to be a model.");
  if (str(dv, 0, 4) !== "IDST") fail("Not a GoldSrc model (missing IDST header).");
  const version = dv.getInt32(4, true);
  if (version !== 10) fail(`Unsupported model version ${version} (need 10).`);
  const i32 = (o: number) => dv.getInt32(o, true);
  const f32 = (o: number) => dv.getFloat32(o, true);
  const inRange = (o: number, size: number, what: string) => { if (o < 0 || o + size > len) fail(`Corrupted model: ${what} out of bounds.`); };

  const numbones = i32(140), boneindex = i32(144);
  const numtex = i32(180), texindex = i32(184);
  const numskinref = i32(192), skinindex = i32(200);
  const numbodyparts = i32(204), bodypartindex = i32(208);
  if (numtex === 0) fail("This model keeps textures in a separate ...T.mdl file. Upload the model with built-in textures.");
  inRange(boneindex, numbones * 112, "bones");
  inRange(texindex, numtex * 80, "textures");

  const world: M[] = [];
  for (let b = 0; b < numbones; b++) {
    const o = boneindex + b * 112;
    const parent = i32(o + 32);
    const v = [0, 1, 2, 3, 4, 5].map((k) => f32(o + 64 + k * 4));
    const m = boneMatrix(v);
    world.push(parent >= 0 ? mul(world[parent], m) : m);
  }

  const textures: MdlTexture[] = [];
  for (let t = 0; t < numtex; t++) {
    const o = texindex + t * 80;
    const tex = { name: str(dv, o, 64), flags: i32(o + 64), width: i32(o + 68), height: i32(o + 72), index: i32(o + 76), headerOffset: o };
    if (tex.width <= 0 || tex.height <= 0 || tex.width > 4096 || tex.height > 4096) fail(`Corrupted texture size for ${tex.name}.`);
    inRange(tex.index, tex.width * tex.height + 768, `texture ${tex.name}`);
    textures.push(tex);
  }
  const skinTable: number[] = [];
  for (let s = 0; s < numskinref; s++) skinTable.push(dv.getInt16(skinindex + s * 2, true));

  const meshes: MdlMesh[] = [];
  for (let bp = 0; bp < numbodyparts; bp++) {
    const bo = bodypartindex + bp * 76;
    const modelindex = i32(bo + 72);
    // first model of each body part = default submodel
    const mo = modelindex;
    inRange(mo, 112, "submodel");
    const nummesh = i32(mo + 72), meshindex = i32(mo + 76), numverts = i32(mo + 80), vinfo = i32(mo + 84), vindex = i32(mo + 88);
    inRange(vindex, numverts * 12, "vertices");
    const verts: number[][] = [];
    for (let v = 0; v < numverts; v++) {
      const bone = dv.getUint8(vinfo + v);
      const p = [f32(vindex + v * 12), f32(vindex + v * 12 + 4), f32(vindex + v * 12 + 8)];
      const m = world[bone] ?? world[0];
      verts.push([0, 1, 2].map((r) => m[r * 4] * p[0] + m[r * 4 + 1] * p[1] + m[r * 4 + 2] * p[2] + m[r * 4 + 3]));
    }
    for (let me = 0; me < nummesh; me++) {
      const mso = meshindex + me * 20;
      const skinref = i32(mso + 8);
      const tex = textures[skinTable[skinref] ?? skinref];
      let p = i32(mso + 4);
      const positions: number[] = [], uvs: number[] = [];
      const push = (q: number[]) => {
        const v = verts[q[0]];
        if (!v) fail("Corrupted model: bad vertex reference.");
        positions.push(...v);
        uvs.push(q[2] / tex.width, 1 - q[3] / tex.height);
      };
      for (let guard = 0; guard < 100000; guard++) {
        inRange(p, 2, "triangle commands");
        let n = dv.getInt16(p, true); p += 2;
        if (n === 0) break;
        const fan = n < 0; n = Math.abs(n);
        const list: number[][] = [];
        for (let k = 0; k < n; k++) { list.push([0, 1, 2, 3].map((j) => dv.getInt16(p + j * 2, true))); p += 8; }
        for (let k = 2; k < n; k++) {
          if (fan) { push(list[0]); push(list[k - 1]); push(list[k]); }
          else if (k % 2) { push(list[k - 1]); push(list[k - 2]); push(list[k]); }
          else { push(list[k - 2]); push(list[k - 1]); push(list[k]); }
        }
      }
      meshes.push({ skinref, positions, uvs });
    }
  }
  return { name: str(dv, 8, 64), textures, skinTable, meshes, buffer };
}

/** Read an MDL texture (8-bit indexed) into RGBA. Masked textures make palette index 255 transparent. */
export function textureToRGBA(mdl: Mdl, t: MdlTexture): ImageData {
  const b = new Uint8Array(mdl.buffer);
  const n = t.width * t.height, pal = t.index + n;
  const out = new ImageData(t.width, t.height);
  const masked = (t.flags & 0x40) !== 0;
  for (let i = 0; i < n; i++) {
    const c = b[t.index + i];
    out.data.set([b[pal + c * 3], b[pal + c * 3 + 1], b[pal + c * 3 + 2], masked && c === 255 ? 0 : 255], i * 4);
  }
  return out;
}

/** Deterministic 256-colour quantisation: popularity over a 5-bit grid + 4 k-means passes. */
export function quantize(img: ImageData, reserveLast = false): { indices: Uint8Array; palette: Uint8Array } {
  const d = img.data, n = img.width * img.height, max = reserveLast ? 255 : 256;
  const hist = new Map<number, [number, number, number, number]>();
  for (let i = 0; i < n; i++) {
    const k = ((d[i * 4] >> 3) << 10) | ((d[i * 4 + 1] >> 3) << 5) | (d[i * 4 + 2] >> 3);
    const h = hist.get(k) ?? [0, 0, 0, 0];
    h[0] += d[i * 4]; h[1] += d[i * 4 + 1]; h[2] += d[i * 4 + 2]; h[3]++;
    hist.set(k, h);
  }
  const buckets = [...hist.entries()].sort((a, b) => b[1][3] - a[1][3] || a[0] - b[0]);
  let pal = buckets.slice(0, max).map(([, h]) => [h[0] / h[3], h[1] / h[3], h[2] / h[3]]);
  const nearest = (r: number, g: number, b: number) => {
    let best = 0, bd = Infinity;
    for (let p = 0; p < pal.length; p++) {
      const dr = r - pal[p][0], dg = g - pal[p][1], db = b - pal[p][2], dd = dr * dr + dg * dg + db * db;
      if (dd < bd) { bd = dd; best = p; }
    }
    return best;
  };
  const cache = new Map<number, number>();
  for (let pass = 0; pass < 4; pass++) {
    const acc = pal.map(() => [0, 0, 0, 0]);
    cache.clear();
    for (const [k, h] of buckets) {
      const p = nearest(h[0] / h[3], h[1] / h[3], h[2] / h[3]);
      cache.set(k, p);
      acc[p][0] += h[0]; acc[p][1] += h[1]; acc[p][2] += h[2]; acc[p][3] += h[3];
    }
    pal = pal.map((c, i) => (acc[i][3] ? [acc[i][0] / acc[i][3], acc[i][1] / acc[i][3], acc[i][2] / acc[i][3]] : c));
  }
  const indices = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    if (reserveLast && d[i * 4 + 3] < 128) { indices[i] = 255; continue; }
    const k = ((d[i * 4] >> 3) << 10) | ((d[i * 4 + 1] >> 3) << 5) | (d[i * 4 + 2] >> 3);
    indices[i] = cache.get(k) ?? nearest(d[i * 4], d[i * 4 + 1], d[i * 4 + 2]);
  }
  const palette = new Uint8Array(768);
  pal.forEach((c, i) => palette.set(c.map((v) => Math.round(v)), i * 3));
  if (reserveLast) palette.set([0, 0, 255], 765);
  return { indices, palette };
}

/** Write new pixels into a copy of the model. Geometry, bones and animations are untouched. */
export function patchTextures(mdl: Mdl, images: Map<number, ImageData>): ArrayBuffer {
  const out = mdl.buffer.slice(0);
  const b = new Uint8Array(out);
  for (const [ti, img] of images) {
    const t = mdl.textures[ti];
    if (img.width !== t.width || img.height !== t.height) throw new Error(`Size mismatch for ${t.name}.`);
    const q = quantize(img, (t.flags & 0x40) !== 0);
    b.set(q.indices, t.index);
    b.set(q.palette, t.index + t.width * t.height);
  }
  return out;
}

/** Re-import check: the exported file must parse and keep identical geometry and texture sizes. */
export function verifyExport(original: Mdl, exported: ArrayBuffer): string[] {
  const errs: string[] = [];
  let m: Mdl;
  try { m = parseMdl(exported); } catch (e) { return [`Re-import failed: ${(e as Error).message}`]; }
  if (exported.byteLength !== original.buffer.byteLength) errs.push("File length changed.");
  if (m.textures.length !== original.textures.length) errs.push("Texture count changed.");
  m.textures.forEach((t, i) => { const o = original.textures[i]; if (t.width !== o.width || t.height !== o.height) errs.push(`${t.name} size changed.`); });
  const a = new Uint8Array(original.buffer), b = new Uint8Array(exported);
  const texRanges = original.textures.map((t) => [t.index, t.index + t.width * t.height + 768]);
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i] && !texRanges.some(([s, e]) => i >= s && i < e)) { errs.push(`Non-texture byte changed at ${i}.`); break; }
  }
  return errs;
}
