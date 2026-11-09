import { Canvas, useThree } from "@react-three/fiber";
import { OrbitControls, OrthographicCamera, PerspectiveCamera, Environment, Lightformer, Grid } from "@react-three/drei";
import { useEffect, useMemo } from "react";
import * as THREE from "three";
import type { Mdl } from "@/lib/mdl";

export type CamMode = "right" | "left" | "orbit" | "ortho";
export type ShadeMode = "textured" | "wireframe" | "uv";
export type OrbitView = "free" | "front" | "back" | "left" | "right" | "top" | "bottom";

function uvChecker() {
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const g = c.getContext("2d")!;
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    g.fillStyle = (x + y) % 2 ? `hsl(${x * 22},70%,55%)` : `hsl(${y * 22},40%,25%)`;
    g.fillRect(x * 16, y * 16, 16, 16);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function Model({ mdl, textures, shade, mirror }: { mdl: Mdl; textures: THREE.Texture[]; shade: ShadeMode; mirror: boolean }) {
  const checker = useMemo(uvChecker, []);
  const geos = useMemo(() => mdl.meshes.map((m) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(m.positions, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(m.uvs, 2));
    g.computeVertexNormals();
    return g;
  }), [mdl]);
  return (
    // GoldSrc is Z-up, X-forward. Convert to three's Y-up.
    <group rotation={[-Math.PI / 2, 0, 0]} scale={[1, mirror ? -1 : 1, 1]}>
      {mdl.meshes.map((m, i) => {
        const ti = mdl.skinTable[m.skinref] ?? m.skinref;
        const masked = (mdl.textures[ti]?.flags & 0x40) !== 0;
        return (
          <mesh key={i} geometry={geos[i]}>
            <meshStandardMaterial
              map={shade === "uv" ? checker : textures[ti]}
              wireframe={shade === "wireframe"}
              color={shade === "wireframe" ? "#e8b84a" : "#ffffff"}
              side={THREE.DoubleSide}
              alphaTest={masked ? 0.5 : 0}
              roughness={0.55}
              metalness={0.25}
            />
          </mesh>
        );
      })}
    </group>
  );
}

function bounds(mdl: Mdl) {
  const b = new THREE.Box3();
  for (const m of mdl.meshes) for (let i = 0; i < m.positions.length; i += 3) {
    // to three space: (x, z, -y)
    b.expandByPoint(new THREE.Vector3(m.positions[i], m.positions[i + 2], -m.positions[i + 1]));
  }
  return b;
}

function OrbitRig({ center, radius, view, resetKey, ortho }: { center: THREE.Vector3; radius: number; view: OrbitView; resetKey: number; ortho: boolean }) {
  const { camera, controls } = useThree() as unknown as { camera: THREE.Camera; controls: { target: THREE.Vector3; update: () => void } | null };
  useEffect(() => {
    const d = radius * 2.2;
    const dirs: Record<OrbitView, [number, number, number]> = {
      free: [0.8, 0.45, 0.9], front: [1, 0, 0], back: [-1, 0, 0], left: [0, 0, -1], right: [0, 0, 1], top: [0, 1, 0.0001], bottom: [0, -1, 0.0001],
    };
    const v = new THREE.Vector3(...dirs[view]).normalize().multiplyScalar(d);
    camera.position.copy(center).add(v);
    camera.lookAt(center);
    if (ortho && camera instanceof THREE.OrthographicCamera) { camera.zoom = 400 / radius; camera.updateProjectionMatrix(); }
    if (controls) { controls.target.copy(center); controls.update(); }
  }, [view, resetKey, center, radius, camera, controls, ortho]);
  return null;
}

export function Viewport({ mdl, textures, cam, shade, view, resetKey }: { mdl: Mdl; textures: THREE.Texture[]; cam: CamMode; shade: ShadeMode; view: OrbitView; resetKey: number }) {
  const box = useMemo(() => bounds(mdl), [mdl]);
  const center = useMemo(() => box.getCenter(new THREE.Vector3()), [box]);
  const radius = useMemo(() => Math.max(box.getSize(new THREE.Vector3()).length() / 2, 1), [box]);
  const firstPerson = cam === "right" || cam === "left";
  return (
    <Canvas
      gl={{ antialias: true, preserveDrawingBuffer: true }}
      onCreated={({ gl }) => { gl.toneMapping = THREE.ACESFilmicToneMapping; gl.domElement.parentElement?.setAttribute("data-scene-ready", "1"); }}
    >
      <color attach="background" args={["#17181b"]} />
      {firstPerson ? (
        // View-model camera sits at the eye (origin) looking down +X (three: +X too).
        <PerspectiveCamera makeDefault fov={64} near={0.5} far={2000} position={[0, 0, 0]} onUpdate={(c) => c.lookAt(1, 0, 0)} />
      ) : cam === "ortho" ? (
        <OrthographicCamera makeDefault near={-5000} far={5000} />
      ) : (
        <PerspectiveCamera makeDefault fov={40} near={0.5} far={5000} />
      )}
      {!firstPerson && <OrbitControls makeDefault enableDamping dampingFactor={0.08} />}
      {!firstPerson && <OrbitRig center={center} radius={radius} view={view} resetKey={resetKey} ortho={cam === "ortho"} />}
      <ambientLight intensity={0.35} />
      <directionalLight position={[40, 80, 60]} intensity={1.6} />
      <directionalLight position={[-60, 20, -40]} intensity={0.5} color="#9fb4d0" />
      <Environment resolution={64}>
        <Lightformer intensity={2} position={[0, 5, 0]} scale={[10, 10, 1]} />
        <Lightformer intensity={1} color="#c9d6ff" position={[-5, 1, -1]} rotation-y={Math.PI / 2} scale={[20, 1, 1]} />
        <Lightformer intensity={1.2} color="#ffd9a0" position={[5, 1, 1]} rotation-y={-Math.PI / 2} scale={[20, 1, 1]} />
      </Environment>
      <Model mdl={mdl} textures={textures} shade={shade} mirror={cam === "left"} />
      {!firstPerson && <Grid position={[center.x, box.min.y - 0.5, center.z]} args={[400, 400]} cellSize={4} sectionSize={32} cellColor="#2a2c31" sectionColor="#3b3e45" fadeDistance={radius * 8} infiniteGrid />}
    </Canvas>
  );
}
