// Fixed layout of the AK-47 texture sheet (pixel coordinates, never changed).
export const SHEET_W = 1100;
export const SHEET_H = 1534;

export type Region = { key: string; label: string; index: number; x: number; y: number; w: number; h: number };

export const REGIONS: Region[] = [
  { key: "QS_AK1", label: "v_3_QS_AK1", index: 3, x: 10, y: 24, w: 512, h: 480 },
  { key: "QS_AK2", label: "v_4_QS_AK2", index: 4, x: 537, y: 24, w: 512, h: 196 },
  { key: "QS_AK3", label: "v_5_QS_AK3", index: 5, x: 10, y: 548, w: 512, h: 360 },
  { key: "QS_AK4", label: "v_6_QS_AK4", index: 6, x: 537, y: 548, w: 512, h: 512 },
  { key: "QS_AK5", label: "v_7_QS_AK5", index: 7, x: 10, y: 1104, w: 240, h: 396 },
  { key: "view_skin", label: "v_1_view_skin", index: 1, x: 265, y: 1104, w: 256, h: 256 },
  { key: "view_glove", label: "v_0_view_glove", index: 0, x: 536, y: 1104, w: 248, h: 126 },
  { key: "view_finger", label: "v_2_view_finger", index: 2, x: 799, y: 1104, w: 128, h: 128 },
];

const norm = (s: string) => s.toLowerCase().replace(/\.bmp$/, "").replace(/[^a-z0-9]/g, "");

/** Find the sheet region for an MDL texture: by name first, then by texture slot number. */
export function regionForTexture(name: string, slot: number): Region | undefined {
  const n = norm(name);
  return REGIONS.find((r) => n === norm(r.key) || n.endsWith(norm(r.key))) ?? REGIONS.find((r) => r.index === slot);
}

export type Align = { x: number; y: number; scale: number };

/** Draw the uploaded image onto a canvas the size of the fixed sheet using the user's alignment. */
export function composeSheet(img: CanvasImageSource & { width: number; height: number }, a: Align): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = SHEET_W;
  c.height = SHEET_H;
  const g = c.getContext("2d")!;
  g.imageSmoothingEnabled = a.scale !== 1;
  g.drawImage(img, a.x, a.y, img.width * a.scale, img.height * a.scale);
  return c;
}

export type RegionCheck = { region: Region; ok: boolean; message: string };

/** Detect empty (flat) or out-of-image regions in the composed sheet. */
export function checkRegions(sheet: HTMLCanvasElement): RegionCheck[] {
  const g = sheet.getContext("2d")!;
  return REGIONS.map((r) => {
    const d = g.getImageData(r.x, r.y, r.w, r.h).data;
    let transparent = 0, sum = 0, sq = 0;
    const n = r.w * r.h;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] < 8) transparent++;
      const l = d[i] + d[i + 1] + d[i + 2];
      sum += l; sq += l * l;
    }
    const mean = sum / n, variance = sq / n - mean * mean;
    if (transparent / n > 0.02) return { region: r, ok: false, message: `${Math.round((transparent / n) * 100)}% outside the image` };
    if (variance < 4) return { region: r, ok: false, message: "region looks empty (flat colour)" };
    return { region: r, ok: true, message: "OK" };
  });
}
