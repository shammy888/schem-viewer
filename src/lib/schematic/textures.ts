import * as THREE from "three";

const TEXTURE_PACK_VERSION = "1.21";
const TEXTURE_BASE_URL = `https://assets.mcasset.cloud/${TEXTURE_PACK_VERSION}/assets/minecraft/textures/block`;

export interface BlockTextureCandidates {
  side: string[];
  top?: string[];
  bottom?: string[];
}

export interface BlockTextureSet {
  side: THREE.Texture;
  top: THREE.Texture;
  bottom: THREE.Texture;
}

const CANDIDATE_OVERRIDES: Record<string, BlockTextureCandidates> = {
  grass_block: {
    side: ["grass_block_side", "grass_side"],
    top: ["grass_block_top", "grass_top"],
    bottom: ["dirt"],
  },
  mycelium: {
    side: ["mycelium_side"],
    top: ["mycelium_top"],
    bottom: ["dirt"],
  },
  podzol: {
    side: ["podzol_side"],
    top: ["podzol_top"],
    bottom: ["dirt"],
  },
  dirt_path: {
    side: ["dirt_path_side"],
    top: ["dirt_path_top"],
    bottom: ["dirt"],
  },
  farmland: {
    side: ["farmland"],
    top: ["farmland_moist", "farmland"],
    bottom: ["dirt"],
  },
  comparator: {
    side: ["smooth_stone"],
    top: ["comparator"],
    bottom: ["smooth_stone"],
  },
  repeater: {
    side: ["smooth_stone"],
    top: ["repeater"],
    bottom: ["smooth_stone"],
  },
  redstone_wire: {
    side: ["redstone_block"],
    top: ["redstone_dust_dot", "redstone_block"],
    bottom: ["redstone_block"],
  },
  hopper: {
    side: ["hopper_outside", "hopper_inside"],
    top: ["hopper_top", "hopper_inside"],
    bottom: ["hopper_outside"],
  },
};

const NON_CUBE_TEXTURE_FALLBACK: Record<string, string> = {
  torch: "coal_block",
  wall_torch: "coal_block",
  lever: "cobblestone",
  ladder: "oak_planks",
  rail: "iron_block",
  powered_rail: "gold_block",
  detector_rail: "iron_block",
  activator_rail: "iron_block",
};

const STRIP_SUFFIXES = [
  "_stairs",
  "_slab",
  "_wall",
  "_fence",
  "_fence_gate",
  "_button",
  "_pressure_plate",
  "_trapdoor",
  "_door",
  "_sign",
  "_hanging_sign",
  "_banner",
  "_carpet",
];

const textureCache = new Map<string, THREE.Texture | null>();
const texturePromiseCache = new Map<string, Promise<THREE.Texture | null>>();

export function resolveTextureCandidates(material: string): BlockTextureCandidates | null {
  const blockName = toBlockName(material);
  if (!blockName) {
    return null;
  }

  const directOverride = CANDIDATE_OVERRIDES[blockName];
  if (directOverride) {
    return directOverride;
  }

  const nonCubeFallback = NON_CUBE_TEXTURE_FALLBACK[blockName];
  if (nonCubeFallback) {
    return { side: [nonCubeFallback] };
  }

  if (blockName.endsWith("_log") || blockName.endsWith("_stem")) {
    return {
      side: [blockName, simplifyBlockName(blockName)],
      top: [`${blockName}_top`, `${simplifyBlockName(blockName)}_top`],
      bottom: [`${blockName}_top`, `${simplifyBlockName(blockName)}_top`],
    };
  }

  if (blockName.endsWith("_pillar")) {
    return {
      side: [blockName, simplifyBlockName(blockName)],
      top: [`${blockName}_top`],
      bottom: [`${blockName}_top`],
    };
  }

  const simplifiedName = simplifyBlockName(blockName);
  return {
    side: uniqueStrings([blockName, simplifiedName]),
  };
}

export async function loadTextureSet(
  candidates: BlockTextureCandidates,
): Promise<BlockTextureSet | null> {
  const sideTexture = await loadFirstAvailableTexture(candidates.side);
  if (!sideTexture) {
    return null;
  }

  const topTexture = candidates.top
    ? (await loadFirstAvailableTexture(candidates.top)) ?? sideTexture
    : sideTexture;
  const bottomTexture = candidates.bottom
    ? (await loadFirstAvailableTexture(candidates.bottom)) ?? sideTexture
    : sideTexture;

  return {
    side: sideTexture,
    top: topTexture,
    bottom: bottomTexture,
  };
}

function toBlockName(material: string): string | null {
  if (!material.startsWith("minecraft:")) {
    return null;
  }

  const stateName = material.split("[")[0] ?? material;
  const [, blockName] = stateName.split(":");
  if (!blockName) {
    return null;
  }

  return blockName.toLowerCase();
}

function simplifyBlockName(name: string): string {
  for (const suffix of STRIP_SUFFIXES) {
    if (name.endsWith(suffix)) {
      return name.slice(0, -suffix.length);
    }
  }

  if (name.endsWith("_wall_sign")) {
    return name.slice(0, -"_wall_sign".length) + "_planks";
  }

  if (name.endsWith("_hanging_sign")) {
    return name.slice(0, -"_hanging_sign".length) + "_planks";
  }

  return name;
}

async function loadFirstAvailableTexture(names: string[]): Promise<THREE.Texture | null> {
  for (const name of uniqueStrings(names)) {
    const texture = await loadTexture(name);
    if (texture) {
      return texture;
    }
  }

  return null;
}

async function loadTexture(textureName: string): Promise<THREE.Texture | null> {
  if (textureCache.has(textureName)) {
    return textureCache.get(textureName) ?? null;
  }

  const pending = texturePromiseCache.get(textureName);
  if (pending) {
    return pending;
  }

  const loader = new THREE.TextureLoader();
  loader.setCrossOrigin("anonymous");

  const promise = new Promise<THREE.Texture | null>((resolve) => {
    const url = `${TEXTURE_BASE_URL}/${textureName}.png`;

    loader.load(
      url,
      (texture) => {
        configureMinecraftTexture(texture);
        textureCache.set(textureName, texture);
        texturePromiseCache.delete(textureName);
        resolve(texture);
      },
      undefined,
      () => {
        textureCache.set(textureName, null);
        texturePromiseCache.delete(textureName);
        resolve(null);
      },
    );
  });

  texturePromiseCache.set(textureName, promise);
  return promise;
}

function configureMinecraftTexture(texture: THREE.Texture): void {
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestMipmapNearestFilter;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.length > 0))];
}
