export type County = {
  /** Auto plate code, used in URLs (e.g. CJ). */
  code: string;
  name: string;
  /** Eurostat NUTS3 id, links the county to its map shape. Absent for diaspora. */
  nuts?: string;
};

export const COUNTIES: County[] = [
  { code: 'AB', name: 'Alba', nuts: 'RO121' },
  { code: 'AR', name: 'Arad', nuts: 'RO421' },
  { code: 'AG', name: 'Argeș', nuts: 'RO311' },
  { code: 'BC', name: 'Bacău', nuts: 'RO211' },
  { code: 'BH', name: 'Bihor', nuts: 'RO111' },
  { code: 'BN', name: 'Bistrița-Năsăud', nuts: 'RO112' },
  { code: 'BT', name: 'Botoșani', nuts: 'RO212' },
  { code: 'BR', name: 'Brăila', nuts: 'RO221' },
  { code: 'BV', name: 'Brașov', nuts: 'RO122' },
  { code: 'B', name: 'București', nuts: 'RO321' },
  { code: 'BZ', name: 'Buzău', nuts: 'RO222' },
  { code: 'CL', name: 'Călărași', nuts: 'RO312' },
  { code: 'CS', name: 'Caraș-Severin', nuts: 'RO422' },
  { code: 'CJ', name: 'Cluj', nuts: 'RO113' },
  { code: 'CT', name: 'Constanța', nuts: 'RO223' },
  { code: 'CV', name: 'Covasna', nuts: 'RO123' },
  { code: 'DB', name: 'Dâmbovița', nuts: 'RO313' },
  // Romanians abroad answer the same questions; on the map they are their own cluster.
  { code: 'DIASPORA', name: 'Diaspora' },
  { code: 'DJ', name: 'Dolj', nuts: 'RO411' },
  { code: 'GL', name: 'Galați', nuts: 'RO224' },
  { code: 'GR', name: 'Giurgiu', nuts: 'RO314' },
  { code: 'GJ', name: 'Gorj', nuts: 'RO412' },
  { code: 'HR', name: 'Harghita', nuts: 'RO124' },
  { code: 'HD', name: 'Hunedoara', nuts: 'RO423' },
  { code: 'IL', name: 'Ialomița', nuts: 'RO315' },
  { code: 'IS', name: 'Iași', nuts: 'RO213' },
  { code: 'IF', name: 'Ilfov', nuts: 'RO322' },
  { code: 'MM', name: 'Maramureș', nuts: 'RO114' },
  { code: 'MH', name: 'Mehedinți', nuts: 'RO413' },
  { code: 'MS', name: 'Mureș', nuts: 'RO125' },
  { code: 'NT', name: 'Neamț', nuts: 'RO214' },
  { code: 'OT', name: 'Olt', nuts: 'RO414' },
  { code: 'PH', name: 'Prahova', nuts: 'RO316' },
  { code: 'SJ', name: 'Sălaj', nuts: 'RO116' },
  { code: 'SM', name: 'Satu Mare', nuts: 'RO115' },
  { code: 'SB', name: 'Sibiu', nuts: 'RO126' },
  { code: 'SV', name: 'Suceava', nuts: 'RO215' },
  { code: 'TR', name: 'Teleorman', nuts: 'RO317' },
  { code: 'TM', name: 'Timiș', nuts: 'RO424' },
  { code: 'TL', name: 'Tulcea', nuts: 'RO225' },
  { code: 'VL', name: 'Vâlcea', nuts: 'RO415' },
  { code: 'VS', name: 'Vaslui', nuts: 'RO216' },
  { code: 'VN', name: 'Vrancea', nuts: 'RO226' },
];

export const countyByCode = (code: string | null | undefined) =>
  COUNTIES.find((c) => c.code === code?.toUpperCase());
