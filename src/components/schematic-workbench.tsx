"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ParsedSchematic } from "@/lib/schematic/parser";
import { parseSchematicFile } from "@/lib/schematic/parser";
import styles from "./schematic-workbench.module.css";

type NavigationMode = "orbit" | "fly";
type CameraMode = "perspective" | "isometric" | "perspective_fpv";

interface UploadedSchematicSource {
  id: string;
  fileName: string;
  bytes: ArrayBuffer;
}

interface ViewerRenderer {
  dispose: () => void;
  setCameraMode: (mode: CameraMode) => void;
  schematicManager?: {
    loadSchematic: (
      name: string,
      schematicData: ArrayBuffer,
      properties?: Partial<{ focused: boolean }>,
    ) => Promise<void>;
    removeAllSchematics?: () => Promise<void>;
  };
  cameraManager?: {
    focusOnSchematics?: () => void;
    setFlyControlsSettings?: (settings: {
      keybinds?: Partial<{ up: string; down: string }>;
    }) => void;
  };
  keyboardControls?: {
    setKeybinds?: (keybinds: Partial<{ up: string; down: string }>) => void;
  };
}

interface SchematicRendererModule {
  SchematicRenderer: new (
    canvas: HTMLCanvasElement,
    schematicData?: { [key: string]: () => Promise<ArrayBuffer> },
    defaultResourcePacks?: Record<string, () => Promise<Blob>>,
    options?: Record<string, unknown>,
  ) => ViewerRenderer;
}

const ACCEPTED_EXTENSIONS = ".schem,.litematic,.schematic,.nbt";
const DEFAULT_RESOURCE_PACKS: Record<string, () => Promise<Blob>> = {
  "minecraft-default-v2": async () => {
    const response = await fetch("/resourcepacks/minecraft-default-pack.zip");
    if (!response.ok) {
      throw new Error(`Failed to load default resource pack (${response.status}).`);
    }
    return response.blob();
  },
};

export function SchematicWorkbench() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [parsed, setParsed] = useState<ParsedSchematic | null>(null);
  const [source, setSource] = useState<UploadedSchematicSource | null>(null);
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
      const fileBytes = await file.arrayBuffer();
      const parseFile = new File([fileBytes], file.name, { type: file.type });
      const result = await parseSchematicFile(parseFile);
      setParsed(result);
      setSource({
        id: `${file.name}:${file.lastModified}:${Date.now()}`,
        fileName: file.name,
        bytes: fileBytes,
      });
      setMaterialFilter("");
    } catch (parseError) {
      const message =
        parseError instanceof Error
          ? parseError.message
          : "Something went wrong while reading this schematic.";
      setParsed(null);
      setSource(null);
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
          {parsed && source ? (
            <SchematicScene parsed={parsed} source={source} navigationMode={navigationMode} />
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
  source,
  navigationMode,
}: {
  parsed: ParsedSchematic;
  source: UploadedSchematicSource;
  navigationMode: NavigationMode;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<ViewerRenderer | null>(null);
  const [viewerError, setViewerError] = useState<string | null>(null);
  const [isViewerLoading, setIsViewerLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    const initializeRenderer = async () => {
      const canvas = canvasRef.current;
      if (!canvas) {
        setIsViewerLoading(false);
        return;
      }

      setViewerError(null);
      setIsViewerLoading(true);

      try {
        const rendererModule = (await import("schematic-renderer")) as SchematicRendererModule;

        if (cancelled) {
          return;
        }

        let resolveReady: (() => void) | null = null;
        const readyPromise = new Promise<void>((resolve) => {
          resolveReady = resolve;
        });

        const renderer = new rendererModule.SchematicRenderer(canvas, {}, DEFAULT_RESOURCE_PACKS, {
          enableDragAndDrop: false,
          singleSchematicMode: true,
          enableProgressBar: false,
          showGrid: false,
          showAxes: false,
          targetFPS: 36,
          idleFPS: 2,
          idleThreshold: 80,
          enableAdaptiveFPS: true,
          postProcessingOptions: {
            enabled: false,
            enableSSAO: false,
            enableSMAA: false,
            enableGamma: false,
          },
          sidebarOptions: { enabled: false },
          keyboardControlsOptions: {
            keybinds: {
              up: "KeyR",
              down: "KeyF",
            },
          },
          callbacks: {
            onRendererInitialized: () => {
              resolveReady?.();
            },
          },
        });

        rendererRef.current = renderer;
        await waitForRendererInitialization(readyPromise, 20000);

        if (!renderer.schematicManager) {
          throw new Error("Renderer did not finish initialization.");
        }

        applyFlyKeybinds(renderer);

        await renderer.schematicManager.loadSchematic(
          source.fileName,
          source.bytes.slice(0),
          { focused: true },
        );

        if (cancelled) {
          return;
        }

        renderer.cameraManager?.focusOnSchematics?.();
        setIsViewerLoading(false);
      } catch (renderError) {
        if (cancelled) {
          return;
        }

        rendererRef.current?.dispose();
        rendererRef.current = null;
        setIsViewerLoading(false);
        setViewerError(getViewerErrorMessage(renderError));
      }
    };

    void initializeRenderer();

    return () => {
      cancelled = true;
      const renderer = rendererRef.current;
      rendererRef.current = null;

      if (!renderer) {
        return;
      }

      void renderer.schematicManager?.removeAllSchematics?.().catch(() => undefined);
      renderer.dispose();
    };
  }, [source.id, source.fileName, source.bytes]);

  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer) {
      return;
    }

    applyFlyKeybinds(renderer);
    applyCameraMode(renderer, navigationMode);
  }, [navigationMode, source.id]);

  useEffect(() => {
    if (navigationMode !== "fly") {
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code === "Space") {
        event.preventDefault();
      }
    };

    window.addEventListener("keydown", onKeyDown, { passive: false });
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [navigationMode]);

  return (
    <div
      key={`${parsed.fileName}:${parsed.blockCount}:${parsed.volume}:${source.id}`}
      className={styles.rendererHost}
    >
      <canvas ref={canvasRef} className={styles.viewerCanvas} />

      {isViewerLoading ? (
        <div className={styles.viewerOverlay}>
          <p>Loading full 3D Minecraft block models...</p>
        </div>
      ) : null}

      {viewerError ? (
        <div className={styles.viewerError}>
          <h3>3D renderer failed</h3>
          <p>{viewerError}</p>
          <p>
            Stats and materials are still available. Try another file if this one uses unsupported
            metadata.
          </p>
        </div>
      ) : null}
    </div>
  );
}

function applyCameraMode(renderer: ViewerRenderer, navigationMode: NavigationMode) {
  renderer.setCameraMode(navigationMode === "fly" ? "perspective_fpv" : "perspective");
}

function applyFlyKeybinds(renderer: ViewerRenderer) {
  renderer.cameraManager?.setFlyControlsSettings?.({
    keybinds: {
      up: "KeyR",
      down: "KeyF",
    },
  });
  renderer.keyboardControls?.setKeybinds?.({
    up: "KeyR",
    down: "KeyF",
  });
}

async function waitForRendererInitialization(readyPromise: Promise<void>, timeoutMs: number) {
  let timeoutId: number | null = null;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = window.setTimeout(() => {
      reject(new Error("Renderer initialization timed out. Please try again."));
    }, timeoutMs);
  });

  try {
    await Promise.race([readyPromise, timeoutPromise]);
  } finally {
    if (timeoutId !== null) {
      window.clearTimeout(timeoutId);
    }
  }
}

function getViewerErrorMessage(renderError: unknown): string {
  if (renderError instanceof Error && renderError.message.trim().length > 0) {
    return renderError.message;
  }

  if (typeof renderError === "string" && renderError.trim().length > 0) {
    return renderError;
  }

  return "Unknown rendering error while loading this schematic.";
}
