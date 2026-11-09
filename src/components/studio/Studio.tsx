import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import sheetAsset from "@/assets/ak47_gold_sheet.png.asset.json";
import { REGIONS, SHEET_H, SHEET_W, checkRegions, composeSheet, regionForTexture, type Align, type RegionCheck } from "@/lib/atlas";
import { parseMdl, patchTextures, textureToRGBA, verifyExport, type Mdl } from "@/lib/mdl";
import { Viewport, type CamMode, type OrbitView, type ShadeMode } from "./Viewport";

type Step = 1 | 2 | 3;
const ACCEPT = ["image/png", "image/jpeg", "image/bmp", "image/webp"];

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((res, rej) => {
    const i = new Image();
    i.crossOrigin = "anonymous";
    i.onload = () => res(i);
    i.onerror = () => rej(new Error("Image could not be decoded."));
    i.src = src;
  });
}

/** Crop a sheet region and fit it to the MDL texture's exact pixel size. */
function regionImage(sheet: HTMLCanvasElement, texName: string, slot: number, w: number, h: number): ImageData | null {
  const r = regionForTexture(texName, slot);
  if (!r) return null;
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const g = c.getContext("2d")!;
  g.imageSmoothingEnabled = r.w !== w || r.h !== h;
  g.imageSmoothingQuality = "high";
  g.drawImage(sheet, r.x, r.y, r.w, r.h, 0, 0, w, h);
  return g.getImageData(0, 0, w, h);
}

function toTexture(img: ImageData) {
  const t = new THREE.DataTexture(img.data, img.width, img.height, THREE.RGBAFormat);
  t.flipY = true;
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = THREE.NearestFilter;
  t.needsUpdate = true;
  return t;
}

function Drop({ label, hint, accept, onFile }: { label: string; hint: string; accept: string; onFile: (f: File) => void }) {
  const [over, setOver] = useState(false);
  return (
    <label
      className={`studio-drop ${over ? "is-over" : ""}`}
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); const f = e.dataTransfer.files[0]; if (f) onFile(f); }}
    >
      <input type="file" accept={accept} className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ""; }} />
      <span className="text-sm font-medium text-foreground">{label}</span>
      <span className="text-xs text-muted-foreground">{hint}</span>
    </label>
  );
}

export function Studio() {
  const [step, setStep] = useState<Step>(1);
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [imgName, setImgName] = useState("ak47_gold (default)");
  const [align, setAlign] = useState<Align>({ x: 0, y: 0, scale: 1 });
  const [error, setError] = useState<string | null>(null);
  const [checks, setChecks] = useState<RegionCheck[]>([]);
  const [sheet, setSheet] = useState<HTMLCanvasElement | null>(null);
  const [mdl, setMdl] = useState<Mdl | null>(null);
  const [mdlName, setMdlName] = useState("");
  const [cam, setCam] = useState<CamMode>("right");
  const [shade, setShade] = useState<ShadeMode>("textured");
  const [view, setView] = useState<OrbitView>("free");
  const [resetKey, setResetKey] = useState(0);
  const [showOriginal, setShowOriginal] = useState(false);
  const [zoom, setZoom] = useState(0.5);
  const [showUV, setShowUV] = useState(true);
  const [exportState, setExportState] = useState<{ ok: boolean; msg: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const inspectRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => { loadImage(sheetAsset.url).then(setImg).catch((e) => setError(e.message)); }, []);

  // Compose + validate whenever image or alignment change.
  useEffect(() => {
    if (!img) return;
    const c = composeSheet(img, align);
    setSheet(c);
    setChecks(checkRegions(c));
  }, [img, align]);

  // Draw inspector.
  useEffect(() => {
    const cv = inspectRef.current;
    if (!cv || !sheet) return;
    const g = cv.getContext("2d")!;
    g.clearRect(0, 0, SHEET_W, SHEET_H);
    g.imageSmoothingEnabled = false;
    g.drawImage(sheet, 0, 0);
    if (showUV) {
      g.lineWidth = 2;
      g.font = "bold 13px ui-monospace, monospace";
      for (const c of checks) {
        const r = c.region;
        g.strokeStyle = c.ok ? "rgba(120,220,160,0.95)" : "rgba(255,90,80,0.95)";
        g.setLineDash(c.ok ? [] : [8, 5]);
        g.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);
        g.fillStyle = g.strokeStyle;
        g.fillText(r.label, r.x + 4, r.y - 6);
      }
      g.setLineDash([]);
    }
  }, [sheet, checks, showUV]);

  const onImage = useCallback(async (f: File) => {
    setError(null);
    if (!ACCEPT.includes(f.type)) return setError(`"${f.name}" is not PNG, JPEG, BMP or WebP.`);
    const url = URL.createObjectURL(f);
    try {
      const i = await loadImage(url);
      const ratio = i.width / i.height, want = SHEET_W / SHEET_H;
      if (i.width < 256 || i.height < 256) return setError(`Image is ${i.width}×${i.height}. Too small for this layout.`);
      setImg(i);
      setImgName(f.name);
      // exact size → no change; otherwise start with a fit-to-width suggestion the user adjusts.
      setAlign(i.width === SHEET_W && i.height === SHEET_H ? { x: 0, y: 0, scale: 1 } : { x: 0, y: 0, scale: +(SHEET_W / i.width).toFixed(4) });
      if (Math.abs(ratio - want) > 0.02) setError(`Aspect ratio ${ratio.toFixed(3)} differs from the layout (${want.toFixed(3)}). Align it with the frame before continuing.`);
    } catch (e) { setError((e as Error).message); }
  }, []);

  const onModel = useCallback(async (f: File) => {
    setError(null);
    if (!/\.mdl$/i.test(f.name)) return setError("Please choose a .mdl file.");
    try {
      const m = parseMdl(await f.arrayBuffer());
      const unmatched = m.textures.filter((t, i) => !regionForTexture(t.name, i));
      if (unmatched.length) return setError(`These model textures have no place on the sheet: ${unmatched.map((t) => t.name).join(", ")}.`);
      setMdl(m); setMdlName(f.name); setExportState(null);
    } catch (e) { setError((e as Error).message); }
  }, []);

  const newImages = useMemo(() => {
    if (!mdl || !sheet) return null;
    const map = new Map<number, ImageData>();
    mdl.textures.forEach((t, i) => { const d = regionImage(sheet, t.name, i, t.width, t.height); if (d) map.set(i, d); });
    return map;
  }, [mdl, sheet]);

  const textures = useMemo(() => {
    if (!mdl) return [];
    return mdl.textures.map((t, i) => toTexture(showOriginal || !newImages?.get(i) ? textureToRGBA(mdl, t) : newImages.get(i)!));
  }, [mdl, newImages, showOriginal]);
  useEffect(() => () => textures.forEach((t) => t.dispose()), [textures]);

  const sheetOk = checks.length > 0 && checks.every((c) => c.ok);

  const doExport = async () => {
    if (!mdl || !newImages) return;
    setBusy(true); setExportState(null);
    await new Promise((r) => setTimeout(r, 30));
    try {
      const out = patchTextures(mdl, newImages);
      const errs = verifyExport(mdl, out);
      if (errs.length) { setExportState({ ok: false, msg: `Export stopped: ${errs.join(" ")}` }); return; }
      const blob = new Blob([out], { type: "application/octet-stream" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = mdlName || "v_ak47.mdl";
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 30000);
      setExportState({ ok: true, msg: `${a.download} — ${(out.byteLength / 1024).toFixed(1)} KB. Re-imported and checked: ${mdl.textures.length} textures, geometry unchanged.` });
    } catch (e) { setExportState({ ok: false, msg: `Export failed: ${(e as Error).message}` }); }
    finally { setBusy(false); }
  };

  const steps: [Step, string][] = [[1, "Sheet"], [2, "Model"], [3, "Preview & export"]];

  return (
    <div className="studio-shell">
      <header className="studio-bar">
        <div className="flex items-center gap-3">
          <div className="studio-logo" />
          <span className="font-display text-sm tracking-wide text-foreground">AK-47 Skin Studio</span>
        </div>
        <nav className="flex gap-1">
          {steps.map(([n, l]) => (
            <button key={n} className={`studio-tab ${step === n ? "is-active" : ""}`} disabled={(n >= 2 && !sheetOk) || (n === 3 && !mdl)} onClick={() => setStep(n)}>
              <span className="studio-num">{n}</span>{l}
            </button>
          ))}
        </nav>
        <span className="font-mono text-xs text-muted-foreground">{SHEET_W}×{SHEET_H} · {REGIONS.length} regions</span>
      </header>

      <div className="studio-body">
        <aside className="studio-panel">
          {step === 1 && (
            <>
              <h2 className="studio-h">Texture sheet</h2>
              <Drop label="Drop a skin sheet" hint="PNG / JPEG / BMP / WebP · same layout as the gold sheet" accept={ACCEPT.join(",")} onFile={onImage} />
              <p className="studio-meta">Current: {imgName}{img && ` · ${img.width}×${img.height}px`}</p>
              <h3 className="studio-h">Fit to frame</h3>
              <p className="text-xs text-muted-foreground">Move and scale the picture until every region sits inside its outline.</p>
              {(["x", "y"] as const).map((k) => (
                <label key={k} className="studio-field">
                  <span>Offset {k.toUpperCase()}</span>
                  <input type="range" min={-400} max={400} step={1} value={align[k]} onChange={(e) => setAlign({ ...align, [k]: +e.target.value })} />
                  <input type="number" value={align[k]} onChange={(e) => setAlign({ ...align, [k]: +e.target.value || 0 })} />
                </label>
              ))}
              <label className="studio-field">
                <span>Scale</span>
                <input type="range" min={0.25} max={4} step={0.001} value={align.scale} onChange={(e) => setAlign({ ...align, scale: +e.target.value })} />
                <input type="number" step={0.001} value={align.scale} onChange={(e) => setAlign({ ...align, scale: +e.target.value || 1 })} />
              </label>
              <button className="studio-btn-ghost" onClick={() => setAlign({ x: 0, y: 0, scale: 1 })}>Reset to 1:1 (original pixels)</button>
              <h3 className="studio-h">Checks</h3>
              <ul className="space-y-1">
                {checks.map((c) => (
                  <li key={c.region.key} className="flex justify-between font-mono text-xs">
                    <span className={c.ok ? "text-foreground" : "text-destructive"}>{c.region.label}</span>
                    <span className={c.ok ? "text-success" : "text-destructive"}>{c.message}</span>
                  </li>
                ))}
              </ul>
              <button className="studio-btn" disabled={!sheetOk} onClick={() => setStep(2)}>Next</button>
            </>
          )}
          {step === 2 && (
            <>
              <h2 className="studio-h">Master model</h2>
              <p className="text-xs text-muted-foreground">Add the original <b>v_ak47.mdl</b> (GoldSrc v10, built-in textures). Its shape, bones and animations are never changed — only texture pixels are replaced.</p>
              <Drop label="Drop v_ak47.mdl" hint="Read in your browser — not uploaded anywhere" accept=".mdl" onFile={onModel} />
              {mdl && (
                <div className="space-y-1 font-mono text-xs">
                  <p className="text-foreground">{mdlName} · {mdl.meshes.length} meshes · {mdl.meshes.reduce((s, m) => s + m.positions.length / 9, 0)} tris</p>
                  {mdl.textures.map((t, i) => (
                    <p key={i} className="flex justify-between text-muted-foreground"><span>{t.name}</span><span>{t.width}×{t.height} → {regionForTexture(t.name, i)?.label}</span></p>
                  ))}
                </div>
              )}
              <button className="studio-btn" disabled={!mdl} onClick={() => setStep(3)}>Next</button>
            </>
          )}
          {step === 3 && mdl && (
            <>
              <h2 className="studio-h">Camera</h2>
              <div className="studio-seg">
                {([["right", "Right hand"], ["left", "Left hand"], ["orbit", "Free"], ["ortho", "Ortho"]] as const).map(([k, l]) => (
                  <button key={k} className={cam === k ? "is-active" : ""} onClick={() => setCam(k)}>{l}</button>
                ))}
              </div>
              {(cam === "orbit" || cam === "ortho") && (
                <div className="studio-seg flex-wrap">
                  {(["front", "back", "left", "right", "top", "bottom"] as const).map((v) => (
                    <button key={v} className={view === v ? "is-active" : ""} onClick={() => { setView(v); setResetKey((k) => k + 1); }}>{v}</button>
                  ))}
                  <button onClick={() => { setView("free"); setResetKey((k) => k + 1); }}>reset</button>
                </div>
              )}
              <h2 className="studio-h">Display</h2>
              <div className="studio-seg">
                {(["textured", "wireframe", "uv"] as const).map((s) => (
                  <button key={s} className={shade === s ? "is-active" : ""} onClick={() => setShade(s)}>{s}</button>
                ))}
              </div>
              <label className="flex items-center gap-2 text-xs text-muted-foreground"><input type="checkbox" checked={showOriginal} onChange={(e) => setShowOriginal(e.target.checked)} /> Show original model textures (compare)</label>
              <h2 className="studio-h">Export</h2>
              <p className="text-xs text-muted-foreground">Builds a new .mdl with your skin (256 colours per texture, as the game requires), then reads it back to check it before download.</p>
              <button className="studio-btn" disabled={busy} onClick={doExport}>{busy ? "Building…" : "Download .mdl"}</button>
              {exportState && <p className={`text-xs ${exportState.ok ? "text-success" : "text-destructive"}`}>{exportState.msg}</p>}
            </>
          )}
          {error && <p className="studio-error">{error}</p>}
        </aside>

        <main className="studio-view">
          {step === 3 && mdl ? (
            <Viewport mdl={mdl} textures={textures} cam={cam} shade={shade} view={view} resetKey={resetKey} />
          ) : (
            <div className="studio-inspect">
              <div style={{ width: SHEET_W * zoom, height: SHEET_H * zoom }}>
                <canvas ref={inspectRef} width={SHEET_W} height={SHEET_H} className="studio-canvas" style={{ width: SHEET_W * zoom, height: SHEET_H * zoom }} />
              </div>
            </div>
          )}
          {step !== 3 && (
            <div className="studio-float">
              <span>Zoom</span>
              <input type="range" min={0.25} max={6} step={0.05} value={zoom} onChange={(e) => setZoom(+e.target.value)} />
              <span className="w-12 font-mono">{Math.round(zoom * 100)}%</span>
              <label className="flex items-center gap-1"><input type="checkbox" checked={showUV} onChange={(e) => setShowUV(e.target.checked)} />Frame</label>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
