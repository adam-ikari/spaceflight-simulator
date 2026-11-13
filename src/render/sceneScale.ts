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
