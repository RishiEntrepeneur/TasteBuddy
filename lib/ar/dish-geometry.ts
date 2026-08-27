import * as THREE from "three";

/**
 * Parametric dish geometry.
 *
 * Every dish that has no generated `.glb` — one still in the pipeline, one
 * whose CDN object has been purged, or every dish at all when the generator is
 * running as a mock — still has to put something recognisable on the diner's
 * plate. A single dome on a cylinder does not do that; a diner looking at an
 * orange hemisphere learns nothing about the portion in front of them.
 *
 * So each dish is composed from an archetype recipe: a vessel, a mass, and
 * scattered components. Rice is hundreds of individually oriented grains in one
 * instanced draw call, noodles are swept tubes, a steak is sliced and fanned.
 * It is not a reconstruction of the real dish and does not pretend to be, but
 * it reads as food and it scales honestly with the portion.
 *
 * Budgets are deliberately below what the same recipes would use off-camera:
 * this renders on top of a live camera feed and a tracking loop, so component
 * counts are roughly a third of what a standalone viewer would spend.
 */

export type DishArchetype =
  | "risotto"
  | "noodles"
  | "roast"
  | "cake"
  | "salad"
  | "soup"
  | "seafood"
  | "drink"
  | "steamed"
  | "bread"
  | "crepe"
  | "dumpling"
  | "dip"
  | "fried"
  | "wrap"
  | "generic"
  /** Nothing is known about this dish, so nothing is drawn on the plate. */
  | "unknown";

export interface BuiltDish {
  group: THREE.Group;
  /** Frees every geometry and material the recipe created. */
  dispose: () => void;
  archetype: DishArchetype;
  triangles: number;
}

/* -------------------------------------------------------------------------- */
/*  Archetype selection                                                        */
/* -------------------------------------------------------------------------- */

/**
 * First match wins, so the order encodes precedence: a noodle *soup* is a soup,
 * and a rice dish is only rice once the soups have had their turn.
 *
 * The short words are anchored on word boundaries, which is not fussiness: an
 * unanchored `tea` matches "tear the crust off", "steamed" and "instead", and
 * a cheese bread rendered as a glass of iced tea is what that costs.
 */
const MATCHERS: readonly (readonly [DishArchetype, RegExp])[] = [
  [
    "drink",
    /coffee|cà phê|espresso|latte|\btea\b|\bjuice\b|\bsoda\b|cocktail|\bbeer\b|\bwine\b|smoothie/i,
  ],
  [
    "dumpling",
    /dumpling|xiao long|xiaolongbao|gyoza|jiaozi|momo|pierogi|pelmeni|ravioli|tortellini|empanada|wonton|mandu|khinkali/i,
  ],
  ["soup", /\bpho\b|phở|ramen|broth|soup|curry|stew|laksa|bisque|chowder|\bdal\b|\bdaal\b|sambar|rasam/i],
  [
    "steamed",
    /idli|\bbao\b|baozi|dim sum|mochi|tamale|dhokla|\btteok\b|tteokbokki|puttu|steamed bun|rice cake/i,
  ],
  [
    "dip",
    /hummus|houmous|guacamole|baba ganoush|tzatziki|\braita\b|chutney|\bsalsa\b|\bdip\b|tahini|taramasalata|\bmezze\b/i,
  ],
  [
    "fried",
    /falafel|tempura|karaage|katsu|croquet|croquet[ta]|fritter|pakora|\bvada\b|samosa|spring roll|churro|onion ring|schnitzel/i,
  ],
  [
    "wrap",
    /burrito|\btaco\b|tacos|shawarma|shwarma|\bkebab\b|\bdoner\b|döner|\bgyro\b|souvlaki|\bwrap\b|cuốn|quesadilla/i,
  ],
  ["crepe", /\bdosa\b|\bdose\b|crêpe|\bcrepe\b|galette|\bblintz/i],
  [
    "bread",
    /\bnaan\b|\broti\b|paratha|chapati|\bpita\b|baguette|focaccia|ciabatta|injera|khachapuri|uttapam|\bpav\b|\bbun\b|brioche|sandwich|bánh mì|banh mi|\barepa\b|pancake|crêpe|\bcrepe\b|\btoast\b|\bbread\b/i,
  ],
  [
    "seafood",
    /octopus|squid|prawn|shrimp|crab|lobster|mussel|clam|oyster|bream|bass|salmon|cod|fish|seafood|cuốn/i,
  ],
  ["risotto", /risotto|paella|pilaf|biryani|congee|\brice\b|grain/i],
  [
    "noodles",
    /noodle|pasta|spaghetti|linguine|tagliatelle|carbonara|bún|vermicelli|udon|soba/i,
  ],
  [
    "roast",
    /steak|ribeye|sirloin|lamb|beef|brisket|duck|pork|chicken|chop|roast|shoulder|grill/i,
  ],
  ["cake", /cheesecake|cake|tart|pudding|brownie|tiramisu|dessert|praline/i],
  [
    "salad",
    /salad|greens|slaw|rocket|leaf|broccoli|burrata|caprese|vegetable/i,
  ],
];

/**
 * The archetypes worth inferring from an ingredient list, in the order to try.
 *
 * The name says what a dish *is*; the description only says what is in it, and
 * those are different questions. Hummus is not a drink because there is lemon
 * juice in it, and pad thai is not a seafood plate because there is dried
 * shrimp in the sauce — so `drink` never comes from a description at all, and
 * the shape of the dish is asked about before its protein.
 */
const FROM_DESCRIPTION: readonly DishArchetype[] = [
  "soup",
  "noodles",
  "dumpling",
  "steamed",
  "crepe",
  "bread",
  "risotto",
  "salad",
  "cake",
  "fried",
  "wrap",
  "dip",
  "seafood",
  "roast",
];

/**
 * Form words from how a dish is *served*, which is a better clue than what is
 * in it and a worse one than what it is called.
 *
 * "one long roll with chutney and sambar" is a masala dosa's own description of
 * its shape, and the app already writes that sentence for every dish. Only
 * words that name a form outright are here: "a bowl" is not one, because a
 * bowl holds soup, rice, salad and dip alike.
 */
const SERVED_MATCHERS: readonly (readonly [DishArchetype, RegExp])[] = [
  ["crepe", /long roll|one roll\b/i],
  ["wrap", /\brolls\b|\bwrap\b|in pita|\btacos?\b/i],
  ["dumpling", /steamer|\bbasket\b/i],
  ["drink", /\bglass\b/i],
  ["cake", /\bwedge\b|\bslice\b/i],
  ["bread", /\bboat\b|\bbreads?\b|\bpancake\b/i],
];

/**
 * Picks the shape to build.
 *
 * `name` is asked first and against everything. `description` is a fallback for
 * the many dishes whose names carry no clue at all — bibimbap, okonomiyaki,
 * tteokbokki — and is only allowed to answer the narrower question above.
 */
export function pickArchetype(
  name: string,
  description = "",
  servedAs = "",
): DishArchetype {
  for (const [archetype, pattern] of MATCHERS) {
    if (pattern.test(name)) return archetype;
  }

  for (const [archetype, pattern] of SERVED_MATCHERS) {
    if (servedAs && pattern.test(servedAs)) return archetype;
  }

  if (description) {
    for (const wanted of FROM_DESCRIPTION) {
      const match = MATCHERS.find(([archetype]) => archetype === wanted);
      if (match && match[1].test(description)) return wanted;
    }
  }

  return "generic";
}

/* -------------------------------------------------------------------------- */
/*  Deterministic randomness                                                   */
/* -------------------------------------------------------------------------- */

/** FNV-1a, so the same dish name always plates identically. */
export function hashSeed(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

type Rand = () => number;

function makeRand(seed: number): Rand {
  let state = seed >>> 0 || 1;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

/* -------------------------------------------------------------------------- */
/*  Shared construction helpers                                                */
/* -------------------------------------------------------------------------- */

/**
 * Collects everything a recipe allocates so it can all be released in one call.
 * R3F disposes what it creates from JSX, but these groups are built
 * imperatively and would otherwise leak a few hundred KB per dish switch.
 */
class Builder {
  readonly group = new THREE.Group();
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly materials: THREE.Material[] = [];

  constructor(readonly rand: Rand) {}

  geo<T extends THREE.BufferGeometry>(geometry: T): T {
    this.geometries.push(geometry);
    return geometry;
  }

  mat(
    params: THREE.MeshStandardMaterialParameters,
  ): THREE.MeshStandardMaterial {
    const material = new THREE.MeshStandardMaterial(params);
    this.materials.push(material);
    return material;
  }

  add<T extends THREE.Object3D>(object: T): T {
    this.group.add(object);
    return object;
  }

  dispose(): void {
    for (const geometry of this.geometries) geometry.dispose();
    for (const material of this.materials) material.dispose();
  }
}

/** sRGB hex to a linear-space colour, matching the renderer's working space. */
function colour(hex: number): THREE.Color {
  return new THREE.Color(hex).convertSRGBToLinear();
}

function vary(base: THREE.Color, rand: Rand, amount: number): THREE.Color {
  const hsl = { h: 0, s: 0, l: 0 };
  base.getHSL(hsl);
  return new THREE.Color().setHSL(
    hsl.h + (rand() - 0.5) * amount * 0.4,
    THREE.MathUtils.clamp(hsl.s + (rand() - 0.5) * amount, 0, 1),
    THREE.MathUtils.clamp(hsl.l + (rand() - 0.5) * amount, 0, 1),
  );
}

const CERAMIC = { color: colour(0xf2ede4), roughness: 0.32, metalness: 0.02 };
const WOOD = { color: colour(0x8a5f3c), roughness: 0.7, metalness: 0 };

function plateGeometry(radius: number, rim: number): THREE.LatheGeometry {
  return new THREE.LatheGeometry(
    [
      new THREE.Vector2(0, 0),
      new THREE.Vector2(radius * 0.62, 0.004),
      new THREE.Vector2(radius * 0.86, rim * 0.42),
      new THREE.Vector2(radius * 0.98, rim),
      new THREE.Vector2(radius, rim * 0.96),
      new THREE.Vector2(radius * 0.9, rim * 0.3),
      new THREE.Vector2(radius * 0.6, -0.03),
      new THREE.Vector2(0, -0.035),
    ],
    64,
  );
}

function bowlGeometry(radius: number, depth: number): THREE.LatheGeometry {
  const points: THREE.Vector2[] = [];
  for (let i = 0; i <= 12; i += 1) {
    const t = i / 12;
    points.push(
      new THREE.Vector2(
        radius * Math.sin(t * Math.PI * 0.5),
        depth * (1 - Math.cos(t * Math.PI * 0.5)),
      ),
    );
  }
  for (let i = 12; i >= 0; i -= 1) {
    const t = i / 12;
    points.push(
      new THREE.Vector2(
        (radius - 0.035) * Math.sin(t * Math.PI * 0.5),
        depth * (1 - Math.cos(t * Math.PI * 0.5)) - 0.03,
      ),
    );
  }
  return new THREE.LatheGeometry(points, 64);
}

const BOWL_RADIUS = 1.05;
const BOWL_DEPTH = 0.42;

/** Height of the bowl's inner wall at a given radius — where food must sit. */
function bowlWallHeight(radius: number): number {
  return (
    BOWL_DEPTH * (1 - Math.cos(Math.asin(Math.min(1, radius / BOWL_RADIUS))))
  );
}

type Vessel = "plate" | "bowl" | "board" | "glass";

function addVessel(b: Builder, kind: Vessel): void {
  let mesh: THREE.Mesh;
  if (kind === "board") {
    mesh = new THREE.Mesh(
      b.geo(new THREE.BoxGeometry(2.1, 0.05, 1.5)),
      b.mat(WOOD),
    );
    mesh.position.y = 0.025;
  } else if (kind === "bowl") {
    const material = b.mat({ ...CERAMIC, side: THREE.DoubleSide });
    mesh = new THREE.Mesh(
      b.geo(bowlGeometry(BOWL_RADIUS, BOWL_DEPTH)),
      material,
    );
  } else if (kind === "glass") {
    const material = b.mat({
      color: colour(0xdfe6e8),
      roughness: 0.08,
      metalness: 0.1,
      transparent: true,
      opacity: 0.34,
      side: THREE.DoubleSide,
    });
    mesh = new THREE.Mesh(
      b.geo(new THREE.CylinderGeometry(0.44, 0.36, 1.05, 40, 1, true)),
      material,
    );
    mesh.position.y = 0.53;
  } else {
    const material = b.mat({ ...CERAMIC, side: THREE.DoubleSide });
    mesh = new THREE.Mesh(b.geo(plateGeometry(1.2, 0.1)), material);
  }
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  b.add(mesh);
}

function addMound(
  b: Builder,
  radius: number,
  height: number,
  hex: number,
  y: number,
): void {
  const geometry = b.geo(
    new THREE.SphereGeometry(radius, 32, 16, 0, Math.PI * 2, 0, Math.PI * 0.5),
  );
  geometry.scale(1, height / radius, 1);
  const mesh = new THREE.Mesh(
    geometry,
    b.mat({ color: colour(hex), roughness: 0.72 }),
  );
  mesh.position.y = y;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  b.add(mesh);
}

interface ScatterOptions {
  geometry: THREE.BufferGeometry;
  count: number;
  radius: number;
  height: number;
  y: number;
  hex: number;
  variance?: number;
  sink?: number;
  roughness?: number;
}

/**
 * Distributes instances across the dome implied by `radius`/`height`.
 *
 * One draw call regardless of count — this is what makes a plate of rice read
 * as rice on a phone that is also decoding a camera stream.
 */
function addScatter(b: Builder, options: ScatterOptions): void {
  const material = b.mat({
    color: 0xffffff,
    roughness: options.roughness ?? 0.66,
  });
  const mesh = new THREE.InstancedMesh(
    options.geometry,
    material,
    options.count,
  );
  mesh.castShadow = true;

  const dummy = new THREE.Object3D();
  const base = colour(options.hex);
  const { rand } = b;

  for (let i = 0; i < options.count; i += 1) {
    const angle = rand() * Math.PI * 2;
    const radius = Math.sqrt(rand()) * options.radius;
    const ratio = radius / options.radius;
    const lift = options.height * Math.sqrt(Math.max(0, 1 - ratio * ratio));

    dummy.position.set(
      Math.cos(angle) * radius,
      options.y + lift - (options.sink ?? 0),
      Math.sin(angle) * radius,
    );
    dummy.rotation.set(
      rand() * 0.9 - 0.45,
      rand() * Math.PI * 2,
      rand() * 0.9 - 0.45,
    );
    const scale = 0.75 + rand() * 0.5;
    dummy.scale.setScalar(scale);
    dummy.updateMatrix();

    mesh.setMatrixAt(i, dummy.matrix);
    mesh.setColorAt(i, vary(base, rand, options.variance ?? 0.14));
  }

  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  b.add(mesh);
}

/** A thin curved sliver: parmesan, a leaf, a sheet of nori. */
function sliverGeometry(
  width: number,
  height: number,
  bend: number,
): THREE.PlaneGeometry {
  const geometry = new THREE.PlaneGeometry(width, height, 4, 2);
  const position = geometry.attributes.position;
  for (let i = 0; i < position.count; i += 1) {
    const x = position.getX(i);
    position.setZ(i, (x / (width / 2)) ** 2 * bend);
  }
  geometry.computeVertexNormals();
  return geometry;
}

function addTube(
  b: Builder,
  points: THREE.Vector3[],
  radius: number,
  hex: number,
  roughness = 0.5,
): void {
  const geometry = b.geo(
    new THREE.TubeGeometry(
      new THREE.CatmullRomCurve3(points),
      20,
      radius,
      6,
      false,
    ),
  );
  const mesh = new THREE.Mesh(
    geometry,
    b.mat({ color: colour(hex), roughness }),
  );
  mesh.castShadow = true;
  b.add(mesh);
}

/* -------------------------------------------------------------------------- */
/*  Recipes                                                                    */
/* -------------------------------------------------------------------------- */

type Recipe = (b: Builder) => void;

const RECIPES: Readonly<Record<DishArchetype, Recipe>> = {
  risotto(b) {
    addVessel(b, "bowl");
    // Seat the mass on the bowl's inner wall, or its edge sinks below the
    // lathe and the grains show through the outside of the bowl.
    const radius = 0.72;
    const y = bowlWallHeight(radius) - 0.02;
    addMound(b, radius, 0.19, 0xe0b45c, y);

    const grain = b.geo(new THREE.SphereGeometry(0.03, 6, 4));
    grain.scale(0.55, 0.5, 1.15);
    addScatter(b, {
      geometry: grain,
      count: 380,
      radius,
      height: 0.19,
      y,
      sink: 0.012,
      hex: 0xecc978,
      variance: 0.16,
    });

    const shaving = b.geo(sliverGeometry(0.34, 0.1, 0.05));
    const shavingMat = b.mat({
      color: colour(0xf6efd7),
      roughness: 0.55,
      side: THREE.DoubleSide,
    });
    for (let i = 0; i < 5; i += 1) {
      const mesh = new THREE.Mesh(shaving, shavingMat);
      const angle = b.rand() * Math.PI * 2;
      const distance = 0.15 + b.rand() * 0.4;
      mesh.position.set(
        Math.cos(angle) * distance,
        y + 0.19,
        Math.sin(angle) * distance,
      );
      mesh.rotation.set(-0.9 - b.rand() * 0.5, b.rand() * Math.PI * 2, 0);
      mesh.castShadow = true;
      b.add(mesh);
    }

    for (let i = 0; i < 7; i += 1) {
      const angle = b.rand() * Math.PI * 2;
      const distance = b.rand() * 0.5;
      const x = Math.cos(angle) * distance;
      const z = Math.sin(angle) * distance;
      addTube(
        b,
        [
          new THREE.Vector3(x, y + 0.2, z),
          new THREE.Vector3(x + 0.06, y + 0.21, z + 0.04),
          new THREE.Vector3(x + 0.11, y + 0.195, z - 0.02),
        ],
        0.006,
        0xa8371a,
        0.6,
      );
    }
  },

  noodles(b) {
    addVessel(b, "bowl");
    const y = bowlWallHeight(0.7) - 0.02;
    addMound(b, 0.7, 0.1, 0xc9762f, y);
    for (let i = 0; i < 18; i += 1) {
      const angle = b.rand() * Math.PI * 2;
      const distance = 0.12 + b.rand() * 0.5;
      const points: THREE.Vector3[] = [];
      for (let k = 0; k < 5; k += 1) {
        const t = k / 4;
        const a = angle + t * (2 + b.rand() * 3);
        const r = distance * (0.6 + t * 0.55);
        points.push(
          new THREE.Vector3(
            Math.cos(a) * r,
            y + 0.12 + Math.sin(t * 3) * 0.04,
            Math.sin(a) * r,
          ),
        );
      }
      addTube(b, points, 0.021, 0xe8c877, 0.45);
    }
    const herb = b.geo(new THREE.SphereGeometry(0.02, 5, 4));
    herb.scale(0.5, 0.4, 1.8);
    addScatter(b, {
      geometry: herb,
      count: 20,
      radius: 0.55,
      height: 0.1,
      y: y + 0.14,
      hex: 0x4f7a33,
      variance: 0.22,
    });
  },

  roast(b) {
    addVessel(b, "plate");
    const jus = new THREE.Mesh(
      b.geo(new THREE.CircleGeometry(0.62, 32)),
      b.mat({ color: colour(0x5a2f16), roughness: 0.28 }),
    );
    jus.rotation.x = -Math.PI / 2;
    jus.position.y = 0.012;
    b.add(jus);

    // Six materials per slice: seared faces, a darker crust, and the cut face.
    const crust = b.mat({ color: colour(0x3d1f14), roughness: 0.62 });
    const top = b.mat({ color: colour(0x2a160f), roughness: 0.5 });
    const bottom = b.mat({ color: colour(0x4a2517), roughness: 0.6 });
    const cut = b.mat({ color: colour(0xa8484a), roughness: 0.55 });
    const slice = b.geo(new THREE.BoxGeometry(0.62, 0.13, 0.2));

    for (let i = 0; i < 5; i += 1) {
      const mesh = new THREE.Mesh(slice, [crust, crust, top, bottom, cut, cut]);
      mesh.position.set(-0.28 + i * 0.14, 0.09 + i * 0.012, -0.16 + i * 0.075);
      mesh.rotation.set(0.1, 0.16 + b.rand() * 0.1, -0.16);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      b.add(mesh);
    }

    const herb = b.geo(new THREE.SphereGeometry(0.02, 5, 4));
    herb.scale(0.4, 0.4, 2.2);
    addScatter(b, {
      geometry: herb,
      count: 22,
      radius: 0.5,
      height: 0.06,
      y: 0.17,
      hex: 0x4d7a33,
      variance: 0.22,
    });
  },

  cake(b) {
    addVessel(b, "plate");
    const body = new THREE.Mesh(
      b.geo(new THREE.CylinderGeometry(0.5, 0.46, 0.34, 40)),
      b.mat({ color: colour(0xe8cf9c), roughness: 0.55 }),
    );
    body.position.y = 0.19;
    body.castShadow = true;
    b.add(body);

    const burnt = new THREE.Mesh(
      b.geo(new THREE.CylinderGeometry(0.5, 0.5, 0.03, 40)),
      b.mat({ color: colour(0x8a5324), roughness: 0.48 }),
    );
    burnt.position.y = 0.365;
    b.add(burnt);

    const drizzle: THREE.Vector3[] = [];
    for (let i = 0; i < 7; i += 1) {
      drizzle.push(
        new THREE.Vector3(
          -0.35 + i * 0.12,
          0.4 - i * 0.012,
          -0.1 + Math.sin(i * 1.3) * 0.16,
        ),
      );
    }
    addTube(b, drizzle, 0.017, 0xa9691f, 0.3);

    const crumb = b.geo(new THREE.SphereGeometry(0.022, 5, 4));
    addScatter(b, {
      geometry: crumb,
      count: 34,
      radius: 0.95,
      height: 0.02,
      y: 0.03,
      hex: 0xa9793f,
      variance: 0.24,
    });
  },

  salad(b) {
    addVessel(b, "bowl");
    const leaf = b.geo(sliverGeometry(0.3, 0.22, 0.08));
    const material = b.mat({
      color: 0xffffff,
      roughness: 0.6,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.InstancedMesh(leaf, material, 48);
    const dummy = new THREE.Object3D();
    const base = colour(0x4f7d33);
    for (let i = 0; i < 48; i += 1) {
      const angle = b.rand() * Math.PI * 2;
      const distance = Math.sqrt(b.rand()) * 0.7;
      dummy.position.set(
        Math.cos(angle) * distance,
        0.12 + b.rand() * 0.2,
        Math.sin(angle) * distance,
      );
      dummy.rotation.set(
        b.rand() * 2 - 1,
        b.rand() * Math.PI * 2,
        b.rand() * 2 - 1,
      );
      dummy.scale.setScalar(0.7 + b.rand() * 0.6);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      mesh.setColorAt(i, vary(base, b.rand, 0.3));
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.castShadow = true;
    b.add(mesh);

    const tomato = b.geo(new THREE.SphereGeometry(0.075, 12, 8));
    addScatter(b, {
      geometry: tomato,
      count: 7,
      radius: 0.55,
      height: 0.22,
      y: 0.15,
      hex: 0xb8342a,
      variance: 0.1,
      roughness: 0.32,
    });
  },

  soup(b) {
    addVessel(b, "bowl");
    const level = 0.27;
    const broth = new THREE.Mesh(
      b.geo(new THREE.CircleGeometry(0.985, 48)),
      b.mat({ color: colour(0xc9a367), roughness: 0.16, metalness: 0.04 }),
    );
    broth.rotation.x = -Math.PI / 2;
    broth.position.y = level;
    b.add(broth);

    for (let i = 0; i < 18; i += 1) {
      const angle = b.rand() * Math.PI * 2;
      const distance = 0.18 + b.rand() * 0.58;
      const points: THREE.Vector3[] = [];
      for (let k = 0; k < 5; k += 1) {
        const t = k / 4;
        const a = angle + t * (1.6 + b.rand() * 2.4);
        const r = distance * (0.72 + t * 0.4);
        points.push(
          new THREE.Vector3(
            Math.cos(a) * r,
            level + 0.012 + Math.sin(t * 5) * 0.02,
            Math.sin(a) * r,
          ),
        );
      }
      addTube(b, points, 0.017, 0xf0dda6, 0.42);
    }

    const white = new THREE.Mesh(
      b.geo(
        new THREE.SphereGeometry(
          0.19,
          16,
          12,
          0,
          Math.PI * 2,
          0,
          Math.PI * 0.5,
        ),
      ),
      b.mat({ color: colour(0xf7f1e2), roughness: 0.42 }),
    );
    white.position.set(-0.4, level + 0.02, 0.26);
    white.castShadow = true;
    b.add(white);

    const yolk = new THREE.Mesh(
      b.geo(
        new THREE.SphereGeometry(
          0.095,
          14,
          10,
          0,
          Math.PI * 2,
          0,
          Math.PI * 0.5,
        ),
      ),
      b.mat({ color: colour(0xe09a1e), roughness: 0.5 }),
    );
    // Proud of the white, or it is simply buried inside the dome.
    yolk.position.set(-0.4, level + 0.128, 0.26);
    b.add(yolk);

    const pork = b.geo(new THREE.CylinderGeometry(0.2, 0.2, 0.032, 20));
    const porkMat = b.mat({ color: colour(0xb9764c), roughness: 0.52 });
    for (let i = 0; i < 2; i += 1) {
      const mesh = new THREE.Mesh(pork, porkMat);
      mesh.position.set(
        0.3 + i * 0.13,
        level + 0.03 + i * 0.03,
        -0.2 + i * 0.16,
      );
      mesh.rotation.set(0.12, 0, 0.14);
      mesh.castShadow = true;
      b.add(mesh);
    }

    const ring = b.geo(new THREE.TorusGeometry(0.028, 0.009, 5, 10));
    addScatter(b, {
      geometry: ring,
      count: 20,
      radius: 0.7,
      height: 0.02,
      y: level + 0.02,
      hex: 0x6f9440,
      variance: 0.22,
    });
  },

  seafood(b) {
    addVessel(b, "plate");
    // A tapered body rather than a dome — the silhouette is what identifies it.
    const body = new THREE.Mesh(
      b.geo(new THREE.SphereGeometry(0.34, 20, 14)),
      b.mat({ color: colour(0xd8cbb4), roughness: 0.38 }),
    );
    body.scale.set(1.9, 0.62, 0.72);
    body.position.set(0, 0.13, 0);
    body.rotation.y = 0.18;
    body.castShadow = true;
    b.add(body);

    const tail = new THREE.Mesh(
      b.geo(new THREE.ConeGeometry(0.2, 0.3, 5, 1, true)),
      b.mat({
        color: colour(0xc3b294),
        roughness: 0.45,
        side: THREE.DoubleSide,
      }),
    );
    tail.position.set(-0.66, 0.15, 0);
    tail.rotation.set(0, 0, Math.PI / 2);
    tail.scale.set(1, 1, 0.35);
    b.add(tail);

    const wedge = new THREE.Mesh(
      b.geo(
        new THREE.CylinderGeometry(0.15, 0.15, 0.07, 16, 1, false, 0, Math.PI),
      ),
      b.mat({ color: colour(0xe8c93f), roughness: 0.5 }),
    );
    wedge.position.set(0.52, 0.05, 0.34);
    wedge.rotation.set(Math.PI / 2, 0, 0.4);
    wedge.castShadow = true;
    b.add(wedge);

    const herb = b.geo(new THREE.SphereGeometry(0.018, 5, 4));
    herb.scale(0.5, 0.4, 1.9);
    addScatter(b, {
      geometry: herb,
      count: 24,
      radius: 0.6,
      height: 0.05,
      y: 0.16,
      hex: 0x54783a,
      variance: 0.24,
    });
  },

  drink(b) {
    addVessel(b, "glass");
    const liquid = new THREE.Mesh(
      b.geo(new THREE.CylinderGeometry(0.4, 0.34, 0.72, 36)),
      b.mat({ color: colour(0x54301c), roughness: 0.14, metalness: 0.05 }),
    );
    liquid.position.y = 0.4;
    b.add(liquid);

    const milk = new THREE.Mesh(
      b.geo(new THREE.CylinderGeometry(0.36, 0.34, 0.2, 36)),
      b.mat({ color: colour(0xdcc09a), roughness: 0.2 }),
    );
    milk.position.y = 0.14;
    b.add(milk);

    const cube = b.geo(new THREE.BoxGeometry(0.15, 0.15, 0.15));
    const iceMat = b.mat({
      color: colour(0xeaf4f7),
      roughness: 0.1,
      metalness: 0.05,
      transparent: true,
      opacity: 0.55,
    });
    for (let i = 0; i < 5; i += 1) {
      const mesh = new THREE.Mesh(cube, iceMat);
      mesh.position.set(
        (b.rand() - 0.5) * 0.4,
        0.28 + i * 0.14,
        (b.rand() - 0.5) * 0.4,
      );
      mesh.rotation.set(b.rand() * 2, b.rand() * 2, b.rand() * 2);
      b.add(mesh);
    }
  },

  /**
   * Nothing on the plate.
   *
   * When the dish is not recognised there is no honest shape to draw, and a
   * plate of confident-looking food under a name nobody knows is the same lie
   * as a green tick on an unknown dish — worse, because a picture is believed
   * faster than a sentence. So: the plate, and nothing on it.
   */
  unknown(b) {
    addVessel(b, "plate");
  },

  /** Idli, bao, dhokla: pale, smooth, steamed. */
  steamed(b) {
    addVessel(b, "plate");

    const count = 3;
    const dome = b.geo(
      new THREE.SphereGeometry(0.36, 26, 16, 0, Math.PI * 2, 0, Math.PI * 0.6),
    );
    dome.scale(1, 0.62, 1);
    const mesh = new THREE.InstancedMesh(
      dome,
      b.mat({ color: 0xffffff, roughness: 0.88 }),
      count,
    );
    const dummy = new THREE.Object3D();
    const base = colour(0xf7f4ed);
    for (let i = 0; i < count; i += 1) {
      const angle = (i / count) * Math.PI * 2 + 0.5;
      dummy.position.set(Math.cos(angle) * 0.36, 0.02, Math.sin(angle) * 0.36);
      dummy.rotation.set(0, b.rand() * Math.PI, 0);
      dummy.scale.setScalar(0.9 + b.rand() * 0.18);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      mesh.setColorAt(i, vary(base, b.rand, 0.05));
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    b.add(mesh);
  },

  /** Flatbread: one browned disc off a board. Flat — a naan is not a bun. */
  bread(b) {
    addVessel(b, "board");

    const loaf = b.geo(
      new THREE.SphereGeometry(0.62, 30, 18, 0, Math.PI * 2, 0, Math.PI * 0.5),
    );
    loaf.scale(1.32, 0.1, 0.86);
    const mesh = new THREE.Mesh(
      loaf,
      b.mat({ color: colour(0xe0bd83), roughness: 0.9 }),
    );
    mesh.position.y = 0.05;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    b.add(mesh);

    // The blisters a tandoor leaves: small, shallow, and the same bread only
    // darker. Big dark lumps read as fruit, which is how this looked before.
    const spot = b.geo(new THREE.SphereGeometry(0.055, 10, 5));
    spot.scale(1.5, 0.09, 1.15);
    addScatter(b, {
      geometry: spot,
      count: 14,
      radius: 0.62,
      height: 0.05,
      y: 0.092,
      hex: 0xbe9257,
      variance: 0.05,
      roughness: 0.94,
    });
  },

  /**
   * A dosa: one long roll, thin and pale, longer than the board.
   *
   * Rolled rather than laid flat, because that is how it arrives and because a
   * crepe drawn flat is indistinguishable from a pancake at this size.
   */
  crepe(b) {
    addVessel(b, "board");

    const roll = b.geo(new THREE.CylinderGeometry(0.115, 0.098, 1.95, 26, 1));
    const mesh = new THREE.Mesh(
      roll,
      b.mat({ color: colour(0xf0d49b), roughness: 0.46 }),
    );
    // Z, not X: a cylinder's axis is Y, so this lays it down the long way and
    // the scorch marks below are placed against the same axis.
    mesh.rotation.set(0, 0, Math.PI / 2 + 0.05);
    mesh.position.set(0, 0.15, 0.02);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    b.add(mesh);

    // Where it caught the griddle. Placed along the roll rather than scattered
    // over a dome, which is what every other recipe here needs.
    const count = 26;
    const scorch = b.geo(new THREE.SphereGeometry(0.05, 8, 5));
    scorch.scale(1.6, 0.24, 1);
    const marks = new THREE.InstancedMesh(
      scorch,
      b.mat({ color: 0xffffff, roughness: 0.7 }),
      count,
    );
    const dummy = new THREE.Object3D();
    const base = colour(0xc98f43);
    for (let i = 0; i < count; i += 1) {
      const along = (b.rand() - 0.5) * 1.75;
      const around = b.rand() * Math.PI * 2;
      const r = 0.108;
      dummy.position.set(
        along,
        0.15 + Math.sin(around) * r,
        0.02 + Math.cos(around) * r,
      );
      dummy.rotation.set(around, 0, (b.rand() - 0.5) * 0.4);
      dummy.scale.setScalar(0.5 + b.rand() * 0.7);
      dummy.updateMatrix();
      marks.setMatrixAt(i, dummy.matrix);
      marks.setColorAt(i, vary(base, b.rand, 0.22));
    }
    marks.instanceMatrix.needsUpdate = true;
    if (marks.instanceColor) marks.instanceColor.needsUpdate = true;
    b.add(marks);

    // The potato showing at the open end, so it reads as filled.
    const filling = new THREE.Mesh(
      b.geo(new THREE.SphereGeometry(0.115, 14, 10)),
      b.mat({ color: colour(0xd6a132), roughness: 0.85 }),
    );
    filling.position.set(0.9, 0.15, 0.02);
    filling.scale.set(0.55, 0.95, 0.95);
    b.add(filling);
  },

  /** Parcels: gyoza, pierogi, momo, empanadas. */
  dumpling(b) {
    addVessel(b, "plate");

    const count = 5;
    const body = b.geo(new THREE.SphereGeometry(0.21, 18, 12));
    body.scale(1, 0.74, 1.35);
    const mesh = new THREE.InstancedMesh(
      body,
      b.mat({ color: 0xffffff, roughness: 0.78 }),
      count,
    );
    const dummy = new THREE.Object3D();
    const base = colour(0xefe4cc);
    for (let i = 0; i < count; i += 1) {
      const angle = (i / count) * Math.PI * 2 + 0.3;
      dummy.position.set(Math.cos(angle) * 0.42, 0.17, Math.sin(angle) * 0.42);
      dummy.rotation.set(0, angle + Math.PI / 2 + (b.rand() - 0.5) * 0.4, 0);
      dummy.scale.setScalar(0.92 + b.rand() * 0.16);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      mesh.setColorAt(i, vary(base, b.rand, 0.08));
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.castShadow = true;
    b.add(mesh);

    // The pinched seam along the top of each.
    const seam = b.geo(new THREE.TorusGeometry(0.14, 0.022, 6, 14, Math.PI));
    const seams = new THREE.InstancedMesh(
      seam,
      b.mat({ color: 0xffffff, roughness: 0.8 }),
      count,
    );
    for (let i = 0; i < count; i += 1) {
      const angle = (i / count) * Math.PI * 2 + 0.3;
      dummy.position.set(Math.cos(angle) * 0.42, 0.29, Math.sin(angle) * 0.42);
      dummy.rotation.set(0, angle + Math.PI / 2, 0);
      dummy.scale.setScalar(1);
      dummy.updateMatrix();
      seams.setMatrixAt(i, dummy.matrix);
      seams.setColorAt(i, vary(colour(0xe4d7ba), b.rand, 0.06));
    }
    seams.instanceMatrix.needsUpdate = true;
    if (seams.instanceColor) seams.instanceColor.needsUpdate = true;
    b.add(seams);
  },

  /** Hummus, guacamole, raita: a smooth shallow bowl with a well in it. */
  dip(b) {
    addVessel(b, "bowl");

    const radius = 0.8;
    const y = bowlWallHeight(radius) - 0.02;
    addMound(b, radius, 0.11, 0xe6d6ac, y);

    // The well pressed into the middle, and the oil that sits in it.
    const pool = new THREE.Mesh(
      b.geo(new THREE.CircleGeometry(0.3, 32)),
      b.mat({ color: colour(0x93992f), roughness: 0.18 }),
    );
    pool.rotation.x = -Math.PI / 2;
    pool.position.y = y + 0.108;
    b.add(pool);

    const dust = b.geo(new THREE.SphereGeometry(0.016, 5, 4));
    addScatter(b, {
      geometry: dust,
      count: 90,
      radius: radius * 0.9,
      height: 0.11,
      y: y + 0.004,
      hex: 0xa8431c,
      variance: 0.3,
      roughness: 0.95,
    });
  },

  /** Deep-fried: falafel, pakora, croquetas. Golden, uneven, in a pile. */
  fried(b) {
    addVessel(b, "plate");

    const piece = b.geo(new THREE.SphereGeometry(0.2, 12, 9));
    piece.scale(1, 0.9, 1);
    addScatter(b, {
      geometry: piece,
      count: 6,
      radius: 0.52,
      height: 0.16,
      y: 0.14,
      hex: 0xb0722a,
      variance: 0.2,
      roughness: 0.86,
    });

    const crumb = b.geo(new THREE.SphereGeometry(0.03, 6, 4));
    addScatter(b, {
      geometry: crumb,
      count: 40,
      radius: 0.72,
      height: 0.06,
      y: 0.04,
      hex: 0xc98f45,
      variance: 0.3,
      roughness: 0.9,
    });
  },

  /** Rolled and handheld: burritos, shawarma, spring rolls. */
  wrap(b) {
    addVessel(b, "board");

    const count = 2;
    const roll = b.geo(new THREE.CylinderGeometry(0.21, 0.19, 1.1, 22, 1));
    const mesh = new THREE.InstancedMesh(
      roll,
      b.mat({ color: 0xffffff, roughness: 0.82 }),
      count,
    );
    const dummy = new THREE.Object3D();
    const base = colour(0xe6cf9c);
    for (let i = 0; i < count; i += 1) {
      dummy.position.set((i - 0.5) * 0.5, 0.22, (b.rand() - 0.5) * 0.16);
      dummy.rotation.set(Math.PI / 2, 0, 0.22 + (b.rand() - 0.5) * 0.26);
      dummy.scale.setScalar(0.94 + b.rand() * 0.12);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      mesh.setColorAt(i, vary(base, b.rand, 0.1));
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.castShadow = true;
    b.add(mesh);

    // The cut end, so it reads as full rather than as two pipes.
    const filling = b.geo(new THREE.CircleGeometry(0.17, 20));
    const ends = new THREE.InstancedMesh(
      filling,
      b.mat({ color: 0xffffff, roughness: 0.7, side: THREE.DoubleSide }),
      count,
    );
    for (let i = 0; i < count; i += 1) {
      dummy.position.set((i - 0.5) * 0.5 + 0.06, 0.22, 0.56);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.setScalar(1);
      dummy.updateMatrix();
      ends.setMatrixAt(i, dummy.matrix);
      ends.setColorAt(i, vary(colour(0xa8562f), b.rand, 0.2));
    }
    ends.instanceMatrix.needsUpdate = true;
    if (ends.instanceColor) ends.instanceColor.needsUpdate = true;
    b.add(ends);
  },

  generic(b) {
    addVessel(b, "plate");
    addMound(b, 0.6, 0.2, 0xc98f52, 0.03);
    const piece = b.geo(new THREE.SphereGeometry(0.05, 8, 6));
    piece.scale(1, 0.7, 1.2);
    addScatter(b, {
      geometry: piece,
      count: 90,
      radius: 0.6,
      height: 0.2,
      y: 0.03,
      sink: 0.02,
      hex: 0xcf9a5c,
      variance: 0.2,
    });
    const herb = b.geo(new THREE.SphereGeometry(0.018, 5, 4));
    herb.scale(0.5, 0.4, 1.8);
    addScatter(b, {
      geometry: herb,
      count: 16,
      radius: 0.48,
      height: 0.2,
      y: 0.06,
      hex: 0x577f36,
      variance: 0.2,
    });
  },
};

/* -------------------------------------------------------------------------- */
/*  Entry point                                                                */
/* -------------------------------------------------------------------------- */

export interface BuildDishOptions {
  /** The dish's name. What it is, and the first thing asked. */
  name: string;
  /** What is in it. A fallback for names that carry no clue — see `pickArchetype`. */
  description?: string;
  /** How it turns up: "one long roll", "a steamer basket". Names the form. */
  servedAs?: string;
  /**
   * False when nothing is actually known about this dish. Nothing is drawn on
   * the plate: see the `unknown` recipe for why.
   */
  recognised?: boolean;
  /** Overrides the archetype the name and description would have selected. */
  archetype?: DishArchetype;
}

function countTriangles(root: THREE.Object3D): number {
  let total = 0;
  root.traverse((object) => {
    const mesh = object as THREE.Mesh & {
      isInstancedMesh?: boolean;
      count?: number;
    };
    const geometry = mesh.geometry;
    if (!geometry) return;
    const perInstance = geometry.index
      ? geometry.index.count / 3
      : (geometry.attributes.position?.count ?? 0) / 3;
    total += perInstance * (mesh.isInstancedMesh ? (mesh.count ?? 1) : 1);
  });
  return Math.round(total);
}

/**
 * Builds a dish. The result is deterministic for a given `text`, so the same
 * dish plates identically every time a diner opens it.
 *
 * The caller owns the result and must call `dispose()` when it unmounts.
 */
export function buildDish(options: BuildDishOptions): BuiltDish {
  const archetype =
    options.archetype ??
    (options.recognised === false
      ? "unknown"
      : pickArchetype(options.name, options.description, options.servedAs));
  const seed = `${options.name} ${options.description ?? ""}`.trim();
  const builder = new Builder(makeRand(hashSeed(seed || archetype)));

  RECIPES[archetype](builder);

  return {
    group: builder.group,
    dispose: () => builder.dispose(),
    archetype,
    triangles: countTriangles(builder.group),
  };
}
