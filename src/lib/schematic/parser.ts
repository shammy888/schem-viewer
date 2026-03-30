import { read } from "nbtify";

export type SchematicFormat =
  | "sponge-schematic"
  | "structure-nbt"
  | "legacy-schematic";

export interface SchematicDimensions {
  width: number;
  height: number;
  length: number;
}

export interface SchematicVoxel {
  x: number;
  y: number;
  z: number;
  state: string;
  material: string;
}

export interface MaterialStat {
  material: string;
  count: number;
  percentage: number;
  stacks64: number;
  exampleState: string;
  color: string;
}

export interface ParsedSchematic {
  fileName: string;
  format: SchematicFormat;
  formatLabel: string;
  dimensions: SchematicDimensions;
  volume: number;
  blockCount: number;
  paletteSize: number;
  materials: MaterialStat[];
  voxels: SchematicVoxel[];
  warnings: string[];
}

type NbtCompound = Record<string, unknown>;

const AIR_MATERIALS = new Set<string>([
  "air",
  "minecraft:air",
  "minecraft:cave_air",
  "minecraft:void_air",
  "cave_air",
  "void_air",
]);

const KEYWORD_COLORS: Array<[RegExp, string]> = [
  [/stone|andesite|diorite|granite|deepslate/, "#8f949e"],
  [/cobblestone|gravel|tuff/, "#737984"],
  [/dirt|mud|clay|podzol|farmland/, "#8d6748"],
  [/grass|moss|leaves|vine|sapling|bamboo/, "#6faa4f"],
  [/oak|spruce|birch|jungle|acacia|mangrove|cherry|crimson|warped/, "#b48a60"],
  [/plank|log|wood|stripped/, "#b38554"],
  [/sand|sandstone|end_stone/, "#d6c58e"],
  [/water|kelp|seagrass|ice/, "#4f8fd8"],
  [/lava|magma|fire/, "#d2692d"],
  [/gold|bell|honey/, "#d4a536"],
  [/iron|chain|anvil|cauldron/, "#9ca9b3"],
  [/copper|cut_copper|oxidized|weathered/, "#ba7d53"],
  [/diamond|prismarine|sea_lantern/, "#64bdb9"],
  [/redstone|red_|nether_wart/, "#b54545"],
  [/wool|concrete|terracotta|carpet|glass|glazed_terracotta/, "#c0a68f"],
  [/obsidian|blackstone|basalt|coal|netherite/, "#32343b"],
  [/snow|quartz|white_|bone_block|calcite/, "#d9dde4"],
  [/amethyst|purpur/, "#9065c8"],
  [/emerald|slime/, "#43b06f"],
];

export async function parseSchematicFile(file: File): Promise<ParsedSchematic> {
  const extension = file.name.toLowerCase().split(".").pop() ?? "";
  const bytes = await file.arrayBuffer();

  let nbtRoot: unknown;

  try {
    const parsed = await read(bytes);
    nbtRoot = parsed.data;
  } catch (error) {
    throw new Error(
      `Could not read NBT data from "${file.name}". Make sure the file is a valid schematic.`,
      { cause: error },
    );
  }

  if (!isCompound(nbtRoot)) {
    throw new Error(`"${file.name}" does not contain a valid NBT compound root.`);
  }

  const root = unwrapRoot(nbtRoot);

  if (looksLikeSpongeSchematic(root)) {
    return parseSpongeSchematic(file.name, root);
  }

  if (looksLikeStructureNbt(root)) {
    return parseStructureNbt(file.name, root);
  }

  if (looksLikeLegacySchematic(root)) {
    return parseLegacySchematic(file.name, root);
  }

  if (!["schem", "schematic", "nbt"].includes(extension)) {
    throw new Error(
      `Unsupported file extension ".${extension}". Supported types are .schem, .schematic, and .nbt.`,
    );
  }

  throw new Error(
    `Unsupported schematic layout in "${file.name}". This viewer currently supports Sponge .schem, structure .nbt, and legacy .schematic files.`,
  );
}

export function materialToColor(material: string): string {
  const normalized = material.toLowerCase();

  for (const [pattern, color] of KEYWORD_COLORS) {
    if (pattern.test(normalized)) {
      return color;
    }
  }

  const hash = hashString(normalized);
  const hue = hash % 360;
  const saturation = 44 + ((hash >>> 9) % 24);
  const lightness = 34 + ((hash >>> 17) % 24);
  return `hsl(${hue} ${saturation}% ${lightness}%)`;
}

function parseSpongeSchematic(fileName: string, root: NbtCompound): ParsedSchematic {
  const width = requireDimension(root.Width, "Width");
  const height = requireDimension(root.Height, "Height");
  const length = requireDimension(root.Length, "Length");

  const paletteTag = root.Palette;
  if (!isCompound(paletteTag)) {
    throw new Error(`"${fileName}" is missing a valid Palette field.`);
  }

  const blockData = toByteArray(root.BlockData);
  if (!blockData) {
    throw new Error(`"${fileName}" is missing a valid BlockData field.`);
  }

  const paletteByIndex = buildPaletteByIndex(paletteTag);
  const indices = decodeVarIntArray(blockData);

  const volume = width * height * length;
  if (volume <= 0) {
    throw new Error(`"${fileName}" has invalid dimensions.`);
  }
  if (indices.length < volume) {
    throw new Error(
      `"${fileName}" has incomplete BlockData. Expected at least ${volume.toLocaleString()} entries but got ${indices.length.toLocaleString()}.`,
    );
  }

  const warnings: string[] = [];
  if (indices.length > volume) {
    warnings.push(
      `BlockData had ${indices.length.toLocaleString()} entries; only the first ${volume.toLocaleString()} were used.`,
    );
  }

  const voxels: SchematicVoxel[] = [];

  for (let i = 0; i < volume; i += 1) {
    const stateIndex = indices[i] ?? 0;
    const state = paletteByIndex.get(stateIndex) ?? `unknown:${stateIndex}`;
    const material = extractMaterial(state);

    if (isAir(material)) {
      continue;
    }

    const y = Math.floor(i / (width * length));
    const withinLayer = i - y * width * length;
    const z = Math.floor(withinLayer / width);
    const x = withinLayer - z * width;

    voxels.push({ x, y, z, state, material });
  }

  return finalizeParsed(
    fileName,
    "sponge-schematic",
    "Sponge .schem",
    { width, height, length },
    paletteByIndex.size,
    voxels,
    warnings,
  );
}

function parseStructureNbt(fileName: string, root: NbtCompound): ParsedSchematic {
  const size = toNumberArray(root.size);
  if (!size || size.length < 3) {
    throw new Error(`"${fileName}" is missing a valid size field.`);
  }

  const width = Math.max(0, Math.trunc(size[0]));
  const height = Math.max(0, Math.trunc(size[1]));
  const length = Math.max(0, Math.trunc(size[2]));
  if (width === 0 || height === 0 || length === 0) {
    throw new Error(`"${fileName}" has invalid structure dimensions.`);
  }

  const paletteTag = root.palette;
  const blocksTag = root.blocks;
  if (!Array.isArray(paletteTag) || !Array.isArray(blocksTag)) {
    throw new Error(
      `"${fileName}" does not look like a Minecraft structure .nbt file (missing palette/blocks).`,
    );
  }

  const paletteStates = paletteTag.map((entry, index) =>
    parseStructurePaletteEntry(entry, index),
  );

  const voxels: SchematicVoxel[] = [];
  const warnings: string[] = [];

  for (const block of blocksTag) {
    if (!isCompound(block)) {
      continue;
    }

    const pos = toNumberArray(block.pos);
    const rawState = toInteger(block.state);
    if (!pos || pos.length < 3 || rawState === null) {
      continue;
    }

    const state = paletteStates[rawState] ?? `unknown:${rawState}`;
    const material = extractMaterial(state);

    if (isAir(material)) {
      continue;
    }

    const x = Math.trunc(pos[0]);
    const y = Math.trunc(pos[1]);
    const z = Math.trunc(pos[2]);

    if (x < 0 || y < 0 || z < 0 || x >= width || y >= height || z >= length) {
      warnings.push(
        `Ignored out-of-bounds block at (${x}, ${y}, ${z}) with state "${state}".`,
      );
      continue;
    }

    voxels.push({ x, y, z, state, material });
  }

  return finalizeParsed(
    fileName,
    "structure-nbt",
    "Structure .nbt",
    { width, height, length },
    paletteStates.length,
    voxels,
    warnings,
  );
}

function parseLegacySchematic(fileName: string, root: NbtCompound): ParsedSchematic {
  const width = requireDimension(root.Width, "Width");
  const height = requireDimension(root.Height, "Height");
  const length = requireDimension(root.Length, "Length");

  const blocks = toByteArray(root.Blocks);
  const data = toByteArray(root.Data);
  const addBlocks = toByteArray(root.AddBlocks);

  if (!blocks || !data) {
    throw new Error(`"${fileName}" is missing legacy Blocks/Data arrays.`);
  }

  const volume = width * height * length;
  if (blocks.length < volume || data.length < volume) {
    throw new Error(
      `"${fileName}" has incomplete legacy block arrays for the declared dimensions.`,
    );
  }

  const voxels: SchematicVoxel[] = [];
  const warnings: string[] = [
    "Legacy .schematic block IDs are shown as numeric IDs (best-effort mode).",
  ];

  for (let i = 0; i < volume; i += 1) {
    const lowId = blocks[i] & 0xff;
    const highNibble = getLegacyHighNibble(addBlocks, i);
    const blockId = (highNibble << 8) | lowId;
    const meta = data[i] & 0x0f;

    if (blockId === 0) {
      continue;
    }

    const y = Math.floor(i / (width * length));
    const withinLayer = i - y * width * length;
    const z = Math.floor(withinLayer / width);
    const x = withinLayer - z * width;

    voxels.push({
      x,
      y,
      z,
      state: `legacy:${blockId}:${meta}`,
      material: `legacy:${blockId}`,
    });
  }

  return finalizeParsed(
    fileName,
    "legacy-schematic",
    "Legacy .schematic",
    { width, height, length },
    0,
    voxels,
    warnings,
  );
}

function finalizeParsed(
  fileName: string,
  format: SchematicFormat,
  formatLabel: string,
  dimensions: SchematicDimensions,
  paletteSize: number,
  voxels: SchematicVoxel[],
  warnings: string[],
): ParsedSchematic {
  const volume = dimensions.width * dimensions.height * dimensions.length;
  const materials = buildMaterialStats(voxels, volume);

  return {
    fileName,
    format,
    formatLabel,
    dimensions,
    volume,
    blockCount: voxels.length,
    paletteSize,
    materials,
    voxels,
    warnings: dedupeWarnings(warnings),
  };
}

function buildMaterialStats(
  voxels: SchematicVoxel[],
  volume: number,
): MaterialStat[] {
  const materialCounts = new Map<string, number>();
  const materialExampleState = new Map<string, string>();

  for (const voxel of voxels) {
    materialCounts.set(voxel.material, (materialCounts.get(voxel.material) ?? 0) + 1);
    if (!materialExampleState.has(voxel.material)) {
      materialExampleState.set(voxel.material, voxel.state);
    }
  }

  return [...materialCounts.entries()]
    .map(([material, count]) => ({
      material,
      count,
      percentage: volume > 0 ? (count / volume) * 100 : 0,
      stacks64: Math.ceil(count / 64),
      exampleState: materialExampleState.get(material) ?? material,
      color: materialToColor(material),
    }))
    .sort((left, right) => right.count - left.count);
}

function looksLikeSpongeSchematic(root: NbtCompound): boolean {
  return (
    toInteger(root.Width) !== null &&
    toInteger(root.Height) !== null &&
    toInteger(root.Length) !== null &&
    isCompound(root.Palette) &&
    root.BlockData !== undefined
  );
}

function looksLikeStructureNbt(root: NbtCompound): boolean {
  return (
    toNumberArray(root.size)?.length === 3 &&
    Array.isArray(root.palette) &&
    Array.isArray(root.blocks)
  );
}

function looksLikeLegacySchematic(root: NbtCompound): boolean {
  return (
    toInteger(root.Width) !== null &&
    toInteger(root.Height) !== null &&
    toInteger(root.Length) !== null &&
    root.Blocks !== undefined &&
    root.Data !== undefined
  );
}

function unwrapRoot(root: NbtCompound): NbtCompound {
  const maybeNested = root.Schematic;
  if (isCompound(maybeNested)) {
    return maybeNested;
  }

  return root;
}

function isCompound(value: unknown): value is NbtCompound {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireDimension(value: unknown, label: string): number {
  const parsed = toInteger(value);
  if (parsed === null || parsed <= 0) {
    throw new Error(`Missing or invalid ${label} in schematic data.`);
  }
  return parsed;
}

function toInteger(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value);
  }
  if (typeof value === "bigint") {
    return Number(value);
  }
  return null;
}

function toByteArray(value: unknown): Uint8Array | null {
  if (value instanceof Uint8Array) {
    return value;
  }
  if (value instanceof Int8Array) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  if (Array.isArray(value)) {
    const normalized = value
      .map((entry) => toInteger(entry))
      .filter((entry): entry is number => entry !== null)
      .map((entry) => entry & 0xff);
    return Uint8Array.from(normalized);
  }
  return null;
}

function toNumberArray(value: unknown): number[] | null {
  if (Array.isArray(value)) {
    const parsed = value
      .map((entry) => toInteger(entry))
      .filter((entry): entry is number => entry !== null);
    return parsed.length === value.length ? parsed : null;
  }

  if (
    value instanceof Int8Array ||
    value instanceof Uint8Array ||
    value instanceof Uint8ClampedArray ||
    value instanceof Int16Array ||
    value instanceof Uint16Array ||
    value instanceof Int32Array ||
    value instanceof Uint32Array ||
    value instanceof Float32Array ||
    value instanceof Float64Array
  ) {
    return Array.from(value, (entry) => Number(entry));
  }

  if (value instanceof BigInt64Array || value instanceof BigUint64Array) {
    return Array.from(value, (entry) => Number(entry));
  }

  return null;
}

function parseStructurePaletteEntry(entry: unknown, index: number): string {
  if (!isCompound(entry)) {
    return `unknown:${index}`;
  }

  const name =
    typeof entry.Name === "string" && entry.Name.length > 0
      ? entry.Name
      : `unknown:${index}`;

  const properties = entry.Properties;
  if (!isCompound(properties) || Object.keys(properties).length === 0) {
    return name;
  }

  const propertyParts = Object.entries(properties)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${String(value)}`);

  return `${name}[${propertyParts.join(",")}]`;
}

function buildPaletteByIndex(palette: NbtCompound): Map<number, string> {
  const byIndex = new Map<number, string>();

  for (const [state, rawIndex] of Object.entries(palette)) {
    const index = toInteger(rawIndex);
    if (index === null) {
      continue;
    }
    byIndex.set(index, state);
  }

  return byIndex;
}

function decodeVarIntArray(bytes: Uint8Array): number[] {
  const values: number[] = [];
  let value = 0;
  let shift = 0;

  for (let index = 0; index < bytes.length; index += 1) {
    const current = bytes[index] & 0xff;
    value |= (current & 0x7f) << shift;

    if ((current & 0x80) === 0) {
      values.push(value >>> 0);
      value = 0;
      shift = 0;
      continue;
    }

    shift += 7;
    if (shift > 35) {
      throw new Error("Encountered an invalid VarInt sequence in BlockData.");
    }
  }

  if (shift !== 0) {
    throw new Error("Encountered an incomplete VarInt sequence in BlockData.");
  }

  return values;
}

function extractMaterial(blockState: string): string {
  const left = blockState.split("[")[0] ?? blockState;
  return left.includes(":") ? left : `minecraft:${left}`;
}

function isAir(material: string): boolean {
  return AIR_MATERIALS.has(material.toLowerCase());
}

function getLegacyHighNibble(addBlocks: Uint8Array | null, index: number): number {
  if (!addBlocks) {
    return 0;
  }

  const nibbleByte = addBlocks[Math.floor(index / 2)] ?? 0;
  return index % 2 === 0 ? nibbleByte & 0x0f : (nibbleByte >> 4) & 0x0f;
}

function hashString(value: string): number {
  let hash = 2166136261;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return hash >>> 0;
}

function dedupeWarnings(warnings: string[]): string[] {
  return [...new Set(warnings)];
}
