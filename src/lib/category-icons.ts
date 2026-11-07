/**
 * Disegni delle icone di categoria (viewBox 64×64, solo tratto), condivisi tra
 * CategoryIcon.astro e i componenti Preact (es. il menu della categoria nella modifica).
 */
const WHEELS = 'M6 40a10 10 0 1 0 20 0a10 10 0 1 0-20 0M38 40a10 10 0 1 0 20 0a10 10 0 1 0-20 0';

export const ICON_PATHS: Record<string, string> = {
  desk: 'M6 24h52M10 24v26M54 24v26M36 24v13h18M41 30.5h8',
  bike: `${WHEELS}M16 40l9-17h17l6 17M25 23l7 17 10-17M22 18h8M42 23l-2-6h6`,
  ski: 'M14 54L44 8M22 56L52 10M18 44l8 3M26 33l8 3',
  scooter: 'M14 44h20l8-18h8M42 26l-4-8h-6M24 44v-8h14',
  car: 'M8 40l6-14h36l6 14v8H8zM8 40h48M18 26l4-6h20l4 6',
  stroller: 'M14 18a16 16 0 0016 16V18zM14 34h34l-6 10H22zM48 34l6-14h4',
  camera: 'M8 22h48v28H8zM22 22l4-6h12l4 6',
  phone: 'M22 8h20a3 3 0 013 3v42a3 3 0 01-3 3H22a3 3 0 01-3-3V11a3 3 0 013-3zM29 50h6',
  laptop: 'M14 14h36v26H14zM6 48h52l-4-8H10z',
  gamepad: 'M14 24h36a8 8 0 018 8v6a8 8 0 01-14 5l-4-5H24l-4 5a8 8 0 01-14-5v-6a8 8 0 018-8zM20 30v8M16 34h8M42 31h.01M46 36h.01',
  appliance: 'M16 8h32v48H16zM16 20h32M22 14h4',
  shirt: 'M22 10l-12 8 6 10 6-4v30h20V24l6 4 6-10-12-8a10 10 0 01-20 0z',
  guitar: 'M40 10l14 14M44 20L30 34M20 30a10 10 0 1014 14 6 6 0 006-8l-4-4a6 6 0 00-8-6',
  vase: 'M24 8h16M26 8v8a14 14 0 00-8 14c0 12 8 26 14 26s14-14 14-26a14 14 0 00-8-14V8',
  garden: 'M32 56V30M32 30c0-10 8-18 18-18 0 10-8 18-18 18zM32 38c0-8-6-14-14-14 0 8 6 14 14 14z',
  box: 'M8 20l24-10 24 10v26L32 56 8 46zM8 20l24 10 24-10M32 30v26',
  house: 'M8 30L32 10l24 20M14 25v29h36V25M27 54V40h10v14',
  key: 'M10 30a10 10 0 1020 0 10 10 0 10-20 0M30 30h24M46 30v8M52 30v6',
  briefcase: 'M10 22h44v30H10zM24 22v-8h16v8M10 34h44',
  wrench: 'M42 8a12 12 0 00-12 16L10 44l10 10 20-20a12 12 0 0016-12l-8 6-8-2-2-8z',
  paw: 'M32 34c-8 0-14 8-14 13s6 5 14 5 14 0 14-5-6-13-14-13zM22 16v8M42 16v8M12 28v6M52 28v6',
  book: 'M10 14h18a4 4 0 014 4v36a4 4 0 00-4-4H10zM54 14H36a4 4 0 00-4 4v36a4 4 0 014-4h18z',
  ball: 'M8 32a24 24 0 1048 0 24 24 0 10-48 0M10 26h44M10 38h44M32 8c-8 8-8 40 0 48M32 8c8 8 8 40 0 48',
  ticket: 'M8 20h48v8a4 4 0 000 8v8H8v-8a4 4 0 000-8zM40 20v24',
  suitcase: 'M12 22h40v30H12zM24 22v-8h16v8M22 22v30M42 22v30',
  drop: 'M32 8c-10 14-16 22-16 30a16 16 0 0032 0c0-8-6-16-16-30zM26 40h12M32 34v12',
  bottle: 'M28 8h8v12c6 3 8 8 8 14v22H20V34c0-6 2-11 8-14zM20 38h24',
  shop: 'M8 26l4-14h40l4 14zM12 26v28h40V26M26 54V40h12v14',
};

export function iconPath(icon: string): string {
  return ICON_PATHS[icon] ?? ICON_PATHS.box;
}
