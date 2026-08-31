const VERIFIED_AT = '2026-08-31T00:00:00.000Z';
const nominatimUrl = query => `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=${encodeURIComponent(query)}`;
const osmUrl = (kind, id) => `https://www.openstreetmap.org/${kind}/${id}`;

const evidence = ({ provider = 'OpenStreetMap', url, confidence }) => ({
  label: provider,
  url,
  confidence,
  verifiedAt: VERIFIED_AT
});

const gym = ({ id, name, address, neighborhood, latitude, longitude, networkName, reference, coordinateApproximate = false }) => ({
  id,
  name,
  ...(networkName ? { networkName } : {}),
  state: 'AP',
  city: 'Macapá',
  address,
  neighborhood,
  latitude,
  longitude,
  coordinateApproximate,
  status: 'unverified',
  visibility: 'public',
  openingHours: [],
  openingHoursNote: '',
  exerciseIds: [],
  source: evidence(reference),
  coordinateVerification: {
    provider: reference.provider || 'OpenStreetMap',
    url: reference.url,
    confidence: reference.confidence,
    verifiedAt: VERIFIED_AT
  },
  createdAt: VERIFIED_AT,
  updatedAt: VERIFIED_AT
});

const node = id => ({ url: osmUrl('node', id), confidence: 'high' });
const way = id => ({ url: osmUrl('way', id), confidence: 'medium' });
const unresolved = query => ({ provider: 'OpenStreetMap Nominatim', url: nominatimUrl(query), confidence: 'medium' });

export const MACAPA_GYM_SEED_VERSION = 'macapa-2026-09-01';
export const MACAPA_GYM_SEED = Object.freeze([
  gym({ id: 'gym-macapa-smart-fit', name: 'Smart Fit Macapá', networkName: 'Smart Fit', address: 'Rua Leopoldo Machado, 2334', neighborhood: 'Central', latitude: 0.0310698, longitude: -51.0627507, reference: node(5879406675) }),
  gym({ id: 'gym-macapa-maioral-tucuju', name: 'Maioral Tucuju Academia', address: 'Rua Tancredo Neves, 224', neighborhood: 'São Lázaro', latitude: 0.0737488, longitude: -51.0554312, reference: way(296270887) }),
  gym({ id: 'gym-macapa-energy-zona-norte', name: 'Academia Energy Zona Norte', address: 'Rua Adílson José Pinto Pereira, 1919', neighborhood: 'Infraero', latitude: 0.0782089, longitude: -51.0704844, reference: way(162924212) }),
  gym({ id: 'gym-macapa-energy-sport', name: 'Energy Sport', address: 'Avenida Almirante Barroso, 1756', neighborhood: 'Central', latitude: 0.0368499, longitude: -51.0637899, reference: way(129304634) }),
  gym({ id: 'gym-macapa-box-cross', name: 'Box Cross Macapá', address: 'Avenida Henrique Galucio, 2467', neighborhood: 'Santa Rita', latitude: 0.0321713, longitude: -51.0731483, reference: way(1136417161) }),
  gym({ id: 'gym-macapa-box-tucuju', name: 'Box Tucuju', address: 'Avenida Anhanguera, 1246A', neighborhood: 'Buritizal', latitude: 0.0213344, longitude: -51.0716876, reference: way(162971760) }),
  gym({ id: 'gym-macapa-t30-intensity', name: 'T30 Intensity', address: 'Avenida Henrique Galucio, 769', neighborhood: 'Central', latitude: 0.0313461, longitude: -51.0610619, reference: way(91252011) }),
  gym({ id: 'gym-macapa-life-fit', name: 'Life Fit Academia', address: 'Rua Paraná, 602', neighborhood: 'Santa Rita', latitude: 0.040453, longitude: -51.0765133, reference: node(13520870449) }),
  gym({ id: 'gym-macapa-best-gym', name: 'Best Gym', address: 'Avenida Décima Quinta, 2087', neighborhood: 'Marabaixo', latitude: null, longitude: null, coordinateApproximate: true, reference: unresolved('Best Gym, Avenida Décima Quinta 2087, Marabaixo, Macapá, AP, Brasil') }),
  gym({ id: 'gym-macapa-iron-men', name: 'Academia Iron Men', address: 'Avenida Tupiniquins, 84', neighborhood: 'Beirol', latitude: 0.0184874, longitude: -51.0633551, reference: way(162971757) }),
  gym({ id: 'gym-macapa-shape-fitness', name: 'Academia Shape Fitness', address: 'Rua São Paulo, 723', neighborhood: 'Pacoval', latitude: 0.0597096, longitude: -51.0535042, reference: way(162923254) })
]);
