// The thirty-two ships, and what a ship is worth knowing about.
//
// WHERE THE STATS COME FROM
// -------------------------
// There is a settled vocabulary for this. Elite, X, EVE, Freelancer and Star
// Citizen all describe a hull with broadly the same ten numbers, because they
// are the ten a pilot actually chooses between: how much punishment it takes,
// how fast it goes, how hard it turns, how hard it hits, how long it can keep
// hitting, what it can carry, who has to be aboard, how heavy it is, and how
// easily it is seen. So those are the ten here.
//
// They are not invented per ship. Each CLASS has a character — a bomber is
// slow and hits like a truck, a stealth hull is fast and made of paper — and
// every ship in that class is that character. What separates two ships in the
// same class is the tier.
//
// TIERS
// -----
// Geoff: "if there's more than one variety of each class of ship, then include
// them all, and increase the stats of Tier 1, Tier 2, etc by 10% for improved
// ships." So the variant number IS the tier: Fighter 01 is tier 1 and the
// baseline, Fighter 02 is 10% better at everything, Fighter 03 is 21% better,
// and so on compounding. Signature is the exception and goes the other way,
// because a lower signature is a better one.

/** The ten numbers, and what each one means to a pilot. */
export interface ShipStats {
  /** What it can take once the shields are down. */
  hull: number;
  /** What it can take before that, and what comes back between fights. */
  shield: number;
  /** Flat-out, in the game's units a second. */
  speed: number;
  /** How hard it turns, in degrees a second. The number that decides a dogfight. */
  agility: number;
  /** Damage a second with everything firing. */
  firepower: number;
  /** Rounds carried before a resupply. */
  ammo: number;
  /** Hold, in tonnes. */
  cargo: number;
  /** How many it takes to fly. */
  crew: number;
  /** Tonnes empty. Decides how hard it is shoved by a hit. */
  mass: number;
  /** How far off it can be seen, in the same units as speed. LOWER IS BETTER. */
  signature: number;
}

export interface ShipClassSpec {
  /** How it is written on the panel. */
  name: string;
  /** One line on what it is for. */
  role: string;
  /** The tier-1 numbers. Everything above tier 1 is these, compounded. */
  base: ShipStats;
  /** The model ids, in tier order: index 0 is tier 1. */
  models: string[];
}

/* ---- the classes ----
   Read down a column and the trade-offs are the point: nothing is good at
   everything, and the big hulls pay for their hull in agility and signature. */
export const SHIP_CLASSES: ShipClassSpec[] = [
  {
    name: "Fighter",
    role: "Cheap, quick and disposable. The hull most pilots learn on.",
    base: { hull: 180, shield: 220, speed: 42, agility: 140, firepower: 34, ammo: 60, cargo: 4, crew: 1, mass: 12, signature: 40 },
    models: [
      "space_SM_Ship_Fighter_01", "space_SM_Ship_Fighter_02", "space_SM_Ship_Fighter_03",
      "space_SM_Ship_Fighter_04", "space_SM_Ship_Fighter_05",
    ],
  },
  {
    name: "Heavy Fighter",
    role: "A fighter that expects to be hit back. Slower, and much harder to kill.",
    base: { hull: 340, shield: 380, speed: 34, agility: 105, firepower: 52, ammo: 90, cargo: 8, crew: 2, mass: 26, signature: 58 },
    models: [
      "space_SM_Ship_Fighter_Heavy_01", "space_SM_Ship_Fighter_Heavy_02",
      "space_SM_Ship_Fighter_Heavy_03", "space_SM_Ship_Fighter_Heavy_04",
    ],
  },
  {
    name: "Bomber",
    role: "Built around its ordnance. Wins the exchange it starts, loses the one it does not.",
    base: { hull: 420, shield: 300, speed: 28, agility: 72, firepower: 96, ammo: 40, cargo: 14, crew: 3, mass: 44, signature: 76 },
    models: [
      "space_SM_Ship_Bomber_01", "space_SM_Ship_Bomber_02",
      "space_SM_Ship_Bomber_03", "space_SM_Ship_Bomber_04",
    ],
  },
  {
    name: "Stealth",
    role: "Seen late and hit hard, on the understanding that it cannot take a reply.",
    base: { hull: 130, shield: 160, speed: 48, agility: 158, firepower: 44, ammo: 45, cargo: 2, crew: 1, mass: 9, signature: 11 },
    models: [
      "space_SM_Ship_Stealth_01", "space_SM_Ship_Stealth_02", "space_SM_Ship_Stealth_03",
      "space_SM_Ship_Stealth_04", "space_SM_Ship_Stealth_05",
    ],
  },
  {
    name: "Cruiser",
    role: "A line ship. Nothing in this class is quick, and nothing in it is fragile.",
    base: { hull: 1400, shield: 1600, speed: 22, agility: 38, firepower: 210, ammo: 400, cargo: 120, crew: 40, mass: 900, signature: 210 },
    models: [
      "space_SM_Ship_Cruiser_01", "space_SM_Ship_Cruiser_02", "space_SM_Ship_Cruiser_03",
    ],
  },
  {
    name: "Transport",
    role: "A hold with engines. Everything else was traded for the hold.",
    base: { hull: 900, shield: 700, speed: 19, agility: 26, firepower: 28, ammo: 120, cargo: 2400, crew: 12, mass: 1600, signature: 260 },
    models: ["space_SM_Ship_Transport_01", "space_SM_Ship_Massive_Transport_01"],
  },
  {
    name: "Galactic Carrier",
    role: "Brings the fighters. A mobile base with a runway down the middle.",
    base: { hull: 6200, shield: 5400, speed: 14, agility: 11, firepower: 340, ammo: 1200, cargo: 4800, crew: 900, mass: 42_000, signature: 700 },
    models: ["space_SM_Ship_Galactic_Carrier_01", "space_SM_Ship_Galactic_Carrier_Armor_01"],
  },
  {
    name: "Colossal",
    role: "Six hundred units of hull. It does not manoeuvre, it arrives.",
    base: { hull: 24_000, shield: 19_000, speed: 9, agility: 4, firepower: 1100, ammo: 4000, cargo: 12_000, crew: 3400, mass: 210_000, signature: 1500 },
    models: ["space_SM_Ship_Colossal_01"],
  },
  {
    name: "Station",
    role: "Does not fly at all. Somewhere to dock, repair and be shot at.",
    base: { hull: 42_000, shield: 30_000, speed: 0, agility: 0, firepower: 900, ammo: 9000, cargo: 40_000, crew: 6000, mass: 900_000, signature: 2600 },
    models: [
      "space_SM_Ship_Station_01", "space_SM_Ship_Station_02", "space_SM_Ship_Station_03",
      "space_SM_Ship_Station_04", "space_SM_Ship_Station_05", "space_SM_Ship_Station_06",
    ],
  },
];

/** One buyable hull: a class, at a tier. */
export interface Ship {
  id: string;
  /** "Fighter II", which is how it is written on the panel. */
  name: string;
  className: string;
  role: string;
  tier: number;
  stats: ShipStats;
}

const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII"];

/** Ten percent better per tier, compounding. Tier 1 is exactly the base. */
export function atTier(base: ShipStats, tier: number): ShipStats {
  const k = Math.pow(1.1, tier - 1);
  const round = (n: number) => (n >= 100 ? Math.round(n) : Math.round(n * 10) / 10);
  /* People and tonnes are counted, not measured. A crew of 1.3 is nonsense on
     a panel, and it also made the tier rule look broken when it was only the
     rounding: 1 -> 1.1 -> 1.2 is a step of 9%, not 10%. */
  const whole = (n: number) => Math.max(1, Math.round(n));
  return {
    hull: round(base.hull * k),
    shield: round(base.shield * k),
    speed: round(base.speed * k),
    agility: round(base.agility * k),
    firepower: round(base.firepower * k),
    ammo: round(base.ammo * k),
    cargo: whole(base.cargo * k),
    crew: whole(base.crew * k),
    mass: round(base.mass * k),
    /* The one that improves by going DOWN. A better hull is a quieter one, so
       the same ten percent is applied as a reduction. */
    signature: round(base.signature / k),
  };
}

/** Every ship in the market, in class order and tier order within a class. */
export function shipCatalog(): Ship[] {
  const out: Ship[] = [];
  for (const cls of SHIP_CLASSES) {
    cls.models.forEach((id, i) => {
      const tier = i + 1;
      out.push({
        id,
        name: cls.models.length > 1 ? `${cls.name} ${ROMAN[i] ?? tier}` : cls.name,
        className: cls.name,
        role: cls.role,
        tier,
        stats: atTier(cls.base, tier),
      });
    });
  }
  return out;
}

/** The ten stats in the order they are shown, with their units. */
export const STAT_ROWS: Array<{ key: keyof ShipStats; label: string; unit: string; lowerIsBetter?: boolean }> = [
  { key: "hull", label: "Hull", unit: "" },
  { key: "shield", label: "Shield", unit: "" },
  { key: "speed", label: "Speed", unit: "u/s" },
  { key: "agility", label: "Agility", unit: "°/s" },
  { key: "firepower", label: "Firepower", unit: "dps" },
  { key: "ammo", label: "Ammunition", unit: "rds" },
  { key: "cargo", label: "Cargo", unit: "t" },
  { key: "crew", label: "Crew", unit: "" },
  { key: "mass", label: "Mass", unit: "t" },
  { key: "signature", label: "Signature", unit: "", lowerIsBetter: true },
];
