/**
 * Single source of truth for the scene's unit system.
 *
 * One scene unit is 100 m. That makes the launch vehicle (about 80 m) roughly
 * 0.8 units tall and the Earth (6,371 km radius) 63,710 units across, so the
 * vehicle/Earth ratio is the physical one. Keeping this constant shared with
 * `vehicleGeometry` prevents the rocket from silently rendering 1000x too
 * large next to the planet.
 */
export const METRES_PER_UNIT = 100;
/** Scene units per kilometre (director positions are in km). */
export const UNITS_PER_KM = 1000 / METRES_PER_UNIT;
/** Earth mean radius, km. */
export const EARTH_RADIUS_KM = 6371;
/** Earth mean radius in scene units. */
export const EARTH_RADIUS_UNITS = EARTH_RADIUS_KM * UNITS_PER_KM;

/**
 * Cruise scale: one scene unit is 1000 km. Earth, Moon and their separation
 * keep their true ratios; the fine-scale vehicle would be sub-pixel, so cruise
 * views draw a position marker instead.
 */
export const METRES_PER_UNIT_CRUISE = 1e6;
/** Scene units per kilometre at cruise scale. */
export const UNITS_PER_KM_CRUISE = 1000 / METRES_PER_UNIT_CRUISE;
/** Fine-mesh to cruise-mesh scale ratio (1 unit = 100 m vs 1 unit = 1000 km). */
export const CRUISE_MESH_SCALE = METRES_PER_UNIT / METRES_PER_UNIT_CRUISE;
/** Moon mean radius, km. */
export const MOON_RADIUS_KM = 1737.4;
/** Moon mean radius in fine-view scene units. */
export const MOON_RADIUS_UNITS = MOON_RADIUS_KM * UNITS_PER_KM;
/** Moon mean radius in cruise scene units. */
export const MOON_RADIUS_UNITS_CRUISE = MOON_RADIUS_KM * UNITS_PER_KM_CRUISE;
/** Mean Earth–Moon centre distance, km. */
export const MOON_DISTANCE_KM = 384400;
/** Mean Earth–Moon centre distance in cruise scene units. */
export const MOON_DISTANCE_UNITS_CRUISE = MOON_DISTANCE_KM * UNITS_PER_KM_CRUISE;
