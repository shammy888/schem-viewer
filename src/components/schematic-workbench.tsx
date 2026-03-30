"use client";

import { FlyControls, OrbitControls } from "@react-three/drei";
import { Canvas } from "@react-three/fiber";
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import type { ParsedSchematic } from "@/lib/schematic/parser";
import { parseSchematicFile } from "@/lib/schematic/parser";
import styles from "./schematic-workbench.module.css";

type NavigationMode = "orbit" | "fly";

interface VoxelGroup {
  material: string;
  color: string;
  positions: [number, number, number][];
}

const ACCEPTED_EXTENSIONS = ".schem,.litematic,.schematic,.nbt";

export function SchematicWorkbench() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [parsed, setParsed] = useState<ParsedSchematic | null>(null);
  const [navigationMode, setNavigationMode] = useState<NavigationMode>("orbit");
  const [isDragging, setIsDragging] = useState(false);
  const [isParsing, setIsParsing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [materialFilter, setMaterialFilter] = useState("");

  const filteredMaterials = useMemo(() => {
    if (!parsed) {
      return [];
    }

    const query = materialFilter.trim().toLowerCase();
    if (!query) {
      return parsed.materials;
    }

    return parsed.materials.filter(
      (entry) =>
        entry.material.toLowerCase().includes(query) ||
        entry.exampleState.toLowerCase().includes(query),
    );
  }, [materialFilter, parsed]);

  const fillRatio =
    parsed && parsed.volume > 0 ? ((parsed.blockCount / parsed.volume) * 100).toFixed(1) : "0.0";

  const handleFile = useCallback(async (file: File) => {
    setIsParsing(true);
    setError(null);

    try {
      const result = await parseSchematicFile(file);
      setParsed(result);
      setMaterialFilter("");
    } catch (parseError) {
      const message =
        parseError instanceof Error
          ? parseError.message
          : "Something went wrong while reading this schematic.";
      setParsed(null);
      setError(message);
    } finally {
      setIsParsing(false);
    }
  }, []);

  const onBrowseClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const onInputChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const nextFile = event.currentTarget.files?.[0];
      if (!nextFile) {
        return;
      }
      void handleFile(nextFile);
      event.currentTarget.value = "";
    },
    [handleFile],
  );

  const onDragOver = useCallback((event: React.DragEvent<HTMLElement>) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    setIsDragging(true);
  }, []);

  const onDragLeave = useCallback((event: React.DragEvent<HTMLElement>) => {
    event.preventDefault();
    setIsDragging(false);
  }, []);

  const onDrop = useCallback(
    (event: React.DragEvent<HTMLElement>) => {
      event.preventDefault();
      setIsDragging(false);

      const droppedFile = event.dataTransfer.files?.[0];
      if (!droppedFile) {
        return;
      }

      void handleFile(droppedFile);
    },
    [handleFile],
  );

  return (
    <div className={styles.workbench}>
      <aside className={styles.sidebar}>
        <h1 className={styles.heading}>Minecraft Schematic Viewer</h1>
        <p className={styles.subheading}>
          Upload a schematic and inspect it in 3D with navigation controls, material totals, and
          build stats.
        </p>

        <section
          className={`${styles.dropZone} ${isDragging ? styles.dropZoneActive : ""}`}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
        >
          <input
            ref={fileInputRef}
            className={styles.fileInput}
            type="file"
            accept={ACCEPTED_EXTENSIONS}
            onChange={onInputChange}
          />
          <button type="button" className={styles.primaryButton} onClick={onBrowseClick}>
            {isParsing ? "Loading..." : "Choose Schematic"}
          </button>
          <p className={styles.dropHint}>or drag and drop a file here</p>
          <p className={styles.supportedFormats}>
            Supports `.schem`, `.litematic`, `.nbt`, and legacy `.schematic`.
          </p>
        </section>

        {error ? <div className={styles.errorBox}>{error}</div> : null}

        {parsed ? (
          <section className={styles.statsCard}>
            <h2>Build Stats</h2>
            <ul className={styles.statsList}>
              <li>
                <span>File</span>
                <strong>{parsed.fileName}</strong>
              </li>
              <li>
                <span>Format</span>
                <strong>{parsed.formatLabel}</strong>
              </li>
              <li>
                <span>Dimensions</span>
                <strong>
                  {parsed.dimensions.width} x {parsed.dimensions.height} x {parsed.dimensions.length}
                </strong>
              </li>
              <li>
                <span>Volume</span>
                <strong>{parsed.volume.toLocaleString()} blocks</strong>
              </li>
              <li>
                <span>Non-air blocks</span>
                <strong>{parsed.blockCount.toLocaleString()}</strong>
              </li>
              <li>
                <span>Fill ratio</span>
                <strong>{fillRatio}%</strong>
              </li>
              <li>
                <span>Unique materials</span>
                <strong>{parsed.materials.length.toLocaleString()}</strong>
              </li>
            </ul>
          </section>
        ) : null}

        {parsed ? (
          <section className={styles.materialCard}>
            <h2>Material List</h2>
            <input
              className={styles.searchInput}
              type="search"
              value={materialFilter}
              onChange={(event) => setMaterialFilter(event.currentTarget.value)}
              placeholder="Filter materials..."
            />

            <div className={styles.materialList}>
              {filteredMaterials.map((entry) => (
                <article key={entry.material} className={styles.materialItem}>
                  <span
                    className={styles.materialSwatch}
                    style={{ backgroundColor: entry.color }}
                    aria-hidden
                  />
                  <div className={styles.materialDetails}>
                    <h3>{entry.material}</h3>
                    <p>
                      {entry.count.toLocaleString()} blocks ({entry.stacks64.toLocaleString()} stacks)
                    </p>
                  </div>
                </article>
              ))}

              {filteredMaterials.length === 0 ? (
                <p className={styles.noMaterials}>No materials match your filter.</p>
              ) : null}
            </div>
          </section>
        ) : null}
      </aside>

      <main className={styles.viewerPanel}>
        <header className={styles.viewerToolbar}>
          <div>
            <h2>3D Explorer</h2>
            <p>
              {navigationMode === "orbit"
                ? "Orbit mode: drag to rotate, scroll to zoom."
                : "Fly mode: click and drag to look, W/A/S/D + R/F to move."}
            </p>
          </div>
          <div className={styles.modeButtons} role="tablist" aria-label="Navigation mode">
            <button
              type="button"
              className={navigationMode === "orbit" ? styles.modeButtonActive : styles.modeButton}
              onClick={() => setNavigationMode("orbit")}
            >
              Orbit
            </button>
            <button
              type="button"
              className={navigationMode === "fly" ? styles.modeButtonActive : styles.modeButton}
              onClick={() => setNavigationMode("fly")}
            >
              Fly
            </button>
          </div>
        </header>

        <section className={styles.canvasCard}>
          {parsed ? (
            <SchematicScene parsed={parsed} navigationMode={navigationMode} />
          ) : (
            <div className={styles.placeholder}>
              <h3>Upload a schematic to start exploring</h3>
              <p>Once loaded, the 3D viewer, material list, and stats will appear automatically.</p>
            </div>
          )}
        </section>

        {parsed?.warnings.length ? (
          <section className={styles.warningCard}>
            <h3>Parsing Notes</h3>
            <ul>
              {parsed.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          </section>
        ) : null}
      </main>
    </div>
  );
}

function SchematicScene({
  parsed,
  navigationMode,
}: {
  parsed: ParsedSchematic;
  navigationMode: NavigationMode;
}) {
  const maxDimension = Math.max(
    parsed.dimensions.width,
    parsed.dimensions.height,
    parsed.dimensions.length,
  );
  const gridSize = Math.max(18, Math.ceil(maxDimension * 2.4));
  const gridDivisions = Math.max(18, Math.min(420, Math.round(gridSize)));
  const cameraDistance = Math.max(14, maxDimension * 1.75);
  const cameraHeight = Math.max(8, parsed.dimensions.height * 1.15);

  return (
    <Canvas
      key={`${parsed.fileName}:${parsed.blockCount}:${parsed.volume}`}
      camera={{
        fov: 58,
        near: 0.1,
        far: Math.max(1000, maxDimension * 26),
        position: [cameraDistance, cameraHeight, cameraDistance],
      }}
      dpr={[1, 2]}
    >
      <color attach="background" args={["#0a1020"]} />
      <fog attach="fog" args={["#0a1020", 90, Math.max(900, maxDimension * 24)]} />

      <hemisphereLight args={["#d8ebff", "#111725", 0.95]} />
      <ambientLight intensity={0.42} />
      <directionalLight position={[90, 130, 60]} intensity={0.92} />

      <VoxelField parsed={parsed} />
      <gridHelper
        args={[gridSize, gridDivisions, new THREE.Color("#2f4468"), new THREE.Color("#19263f")]}
      />

      {navigationMode === "orbit" ? (
        <OrbitControls
          makeDefault
          target={[0, parsed.dimensions.height * 0.45, 0]}
          enableDamping
          dampingFactor={0.06}
          maxDistance={Math.max(30, maxDimension * 8)}
        />
      ) : (
        <FlyControls
          makeDefault
          dragToLook
          movementSpeed={Math.max(8, maxDimension * 0.6)}
          rollSpeed={0.7}
        />
      )}
    </Canvas>
  );
}

function VoxelField({ parsed }: { parsed: ParsedSchematic }) {
  const groupedVoxels = useMemo(() => buildVoxelGroups(parsed), [parsed]);

  return (
    <group>
      {groupedVoxels.map((group) => (
        <VoxelGroupMesh key={group.material} group={group} />
      ))}
    </group>
  );
}

function VoxelGroupMesh({ group }: { group: VoxelGroup }) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const tempObject = useMemo(() => new THREE.Object3D(), []);

  useLayoutEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) {
      return;
    }

    for (let index = 0; index < group.positions.length; index += 1) {
      const [x, y, z] = group.positions[index];
      tempObject.position.set(x, y, z);
      tempObject.updateMatrix();
      mesh.setMatrixAt(index, tempObject.matrix);
    }

    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [group.positions, tempObject]);

  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, group.positions.length]}>
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial color={group.color} roughness={0.88} metalness={0.05} />
    </instancedMesh>
  );
}

function buildVoxelGroups(parsed: ParsedSchematic): VoxelGroup[] {
  const xOffset = parsed.dimensions.width / 2;
  const zOffset = parsed.dimensions.length / 2;
  const materialColors = new Map(parsed.materials.map((entry) => [entry.material, entry.color]));
  const groups = new Map<string, VoxelGroup>();

  for (const voxel of parsed.voxels) {
    let group = groups.get(voxel.material);
    if (!group) {
      group = {
        material: voxel.material,
        color: materialColors.get(voxel.material) ?? "#888888",
        positions: [],
      };
      groups.set(voxel.material, group);
    }

    group.positions.push([
      voxel.x - xOffset + 0.5,
      voxel.y + 0.5,
      voxel.z - zOffset + 0.5,
    ]);
  }

  return [...groups.values()].sort((left, right) => right.positions.length - left.positions.length);
}


