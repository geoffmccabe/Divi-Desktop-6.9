// Spikeworld: every number, in one place.
//
// See docs/DIVI-REBELS-VOXEL-PLANET-PLAN.md for why each of these is what it
// is. Nothing else in the voxel code carries a dimension of its own: change a
// number here and the planet, its collision, its meshes and its tests all move
// together.
//
// MODULARITY, WHICH IS THE POINT
// ------------------------------
// This folder has NO imports from the game, the wallet, three.js or the DOM.
// That is deliberate and it is what lets the same code run in four places:
//
//   - the cockpit, to draw the planet
//   - a Web Worker, to build chunk meshes off the main thread
//   - the room (a Cloudflare Worker), to decide whether a ship hit a cube
//   - node, to test all of it
//
// It also means three agents can work in this repo without treading on each
// other: nothing outside this folder has to change for the planet to exist, and
// when the build agent moves the game into a package this folder moves with it
// like any other game file.

/** How many cubes across the whole grid is. Geoff: "I want to do it 1000". */
export const GRID = 1000;

/**
 * How big one cube is, in the game's world units.
 *
 * Geoff: "each cube should be around 3x the width of the average heavy fighter
 * spaceship, to make it possible to navigate through the maze of holes to get
 * to the center." A heavy fighter is about three units across (SHIP_LENGTH is
 * 2.6 and a fighter's wingspan is close to its length), so three of those is
 * nine.
 *
 * Every other distance in the game can be read off this: the planet is 9,000
 * units across, which is forty-five times Earth's diameter here.
 */
export const CUBE = 9;

/** The outer surface, in cubes. Half the grid. */
export const R_OUTER = GRID / 2;
/**
 * The inner face of the shell, in cubes.
 *
 * Geoff: "The center 50% would be empty". Half the DIAMETER empty means the
 * cavity reaches to a quarter of the way out... but read the other way, half
 * the radius. Taken as radius, which is the reading that leaves a shell thick
 * enough to be a maze: 250 cubes of rock, 2,250 world units.
 */
export const R_INNER = GRID / 4;

/** The heart at the centre: "a second smaller sphere of 50x50x50". */
export const R_HEART = 25;
/** How many spokes join the heart to the shell. Geoff: "like 24 or so". */
export const SPOKES = 24;
/** How thick a spoke is, in cubes. */
export const SPOKE_R = 2;

/**
 * How big the clumps of rock are, in cubes.
 *
 * THE decision of the whole design, and the one Geoff settled by eye: "10 cubes
 * sounds right." Rooms and walls about ninety units across, thirty ships
 * abreast, eleven seconds to cross at cruise. Caves, not rubble and not
 * cathedrals.
 *
 * It is also what makes the planet affordable. The same quarter fill scattered
 * one cube at a time costs 4.54 exposed faces per cube and 74,326 triangles a
 * chunk; clumped at this size it is 0.87 faces and 6,110 triangles. Twelve
 * times, for free, by arranging the same rock differently.
 */
export const CLUMP = 10;
/** The fine octave, for roughness on the clumps. A third of the clump size. */
export const CLUMP_FINE = CLUMP / 3;
/** How much of the field the fine octave is worth. */
export const FINE_WEIGHT = 0.28;

/** What fraction of the shell is solid, averaged over its thickness. */
export const FILL = 0.25;
/**
 * The crust profile: how the fill leans from the outer surface to the cavity.
 *
 * FLAT, both one. It used to lean, denser outside and thinner in, on the
 * argument that a planet wants a skin and a ragged ceiling. That was my idea
 * and not the brief, and it pushed the fill at the surface to 31% and measured
 * 37% in a chunk there. Geoff: "the distribution is wrong... I had asked for 3
 * out of 4 cubes to be holes so only 25% of slots have cubes, but it's far more
 * solid than that." He asked for a quarter, so it is a quarter everywhere.
 *
 * Kept as two numbers rather than deleted, because a lean is a dial somebody
 * may want later; it is simply not on.
 */
export const CRUST_OUTER = 1;
export const CRUST_INNER = 1;

/**
 * How strongly the voids run radially, which is what makes tunnels rather than
 * pockets.
 *
 * The channel field is the ordinary noise evaluated on DIRECTION, with a slow
 * drift by radius so a shaft leans on the way in rather than being a laser
 * bore. This number is how slow that drift is, and bigger is straighter: at 40
 * a shaft wandered enough that only 4% of them stayed open the whole way down,
 * and at 120 it is 29%.
 */
export const CHANNEL_STRETCH = 120;
/**
 * Above this, the channel field carves.
 *
 * ---- THIS IS THE DIAL THAT MAKES THE PLANET LOOK HOLEY ----
 *
 * A quarter fill in a shell 250 cubes deep is OPAQUE, and no arrangement of it
 * is otherwise: a line of sight survives 0.75 to the power of how many cubes it
 * passes, and 0.75^250 is nothing at all. Measured, the view stopped after 47
 * cubes and 6% of straight lines reached the cavity, whatever the clump size:
 * at two cubes it was 35 and 6.3%, at ten it was 43 and 6.0%. Geoff saw the
 * consequence and read it as the rule being broken: "the rule of 3 holes to 1
 * solid cube isn't being observed and the chunks of cubes are nearly completely
 * solid." The rule IS observed, at 24.7%; a quarter of a thick slab simply
 * looks solid.
 *
 * What makes real, visible holes is the shafts, and they are worth measuring
 * rather than guessing. With straighter shafts and a lower threshold:
 *
 *     cut 0.66, wobble 40  -> 21% of the sky is shaft,  4% of lines go through
 *     cut 0.58, wobble 120 -> 36% of the sky is shaft, 29% of lines go through
 *     cut 0.52, wobble 120 -> 47% of the sky is shaft, 38% of lines go through
 *
 * At 0.58 and 120 the planet is riddled: a third of it is open shaft, nearly a
 * third of straight lines pass clean through to the cavity, and the stars show
 * behind it. The fill stays at a quarter, because the threshold aims high by
 * whatever the shafts carve (see thresholdAfterCarving).
 */
export const CHANNEL_CUT = 0.58;

/** Chunk edge, in cubes. The unit of generation, meshing and culling. */
export const CHUNK = 32;

/**
 * The detail levels: one cube standing for 1, 2, 4, 8 or 16.
 *
 * It used to stop at 8, because at the time a coarse level was made by
 * SUBSAMPLING a fine field, and a step-16 chunk of that was ten times the cost
 * of a fine one. Now the clumps grow with the level, so every level is equally
 * clumpy and costs about the same per chunk while covering eight times the
 * ground: more levels are very nearly free.
 *
 * The one that needs it is the view from inside the cavity, where the far side
 * of the shell is seven hundred cubes off and there is a great deal of it.
 */
export const LOD_STEPS = [1, 2, 4, 8, 16] as const;

/**
 * How high above the surface a ship may fly inside the shard, in cubes.
 *
 * This is the number the Phase 0 report was written to find, and the answer is
 * a budget rather than a taste: at 400 cubes up the visible face of the shell
 * costs about 104,000 triangles at the coarsest detail, and at 800 it costs
 * 127,000 and is over. So the shard's sky ends at 400 cubes, 3,600 units, and
 * the whole planet never has to be drawn at once.
 *
 * Above it there is nothing to fly to anyway: the rest of the sky is 200,000
 * units of empty space back to Earth, and the gate is how that is crossed.
 */
export const SKY_EDGE = 400;

/** Where the planet sits, in Earth diameters from Earth. Geoff: "at 1000 earth
 *  diameters... visible and potential to fly there." */
export const DISTANCE_IN_EARTHS = 1000;

/** The planet's width in world units, and its radius. For the sky body, the
 *  shard's size, and anything that has to hold it. */
export const WORLD_DIAMETER = GRID * CUBE;
export const WORLD_RADIUS = WORLD_DIAMETER / 2;

/** Cubes to world units, and back. The only place the two are converted. */
export const toWorld = (cubes: number): number => cubes * CUBE;
export const toCubes = (units: number): number => units / CUBE;
