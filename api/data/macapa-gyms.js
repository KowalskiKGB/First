const VERIFIED_AT = '2026-08-31T00:00:00.000Z';

const source = query => ({
  label: 'Google Maps',
  url: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`,
  confidence: 'medium',
  verifiedAt: VERIFIED_AT
});

const gym = ({ id, name, address, neighborhood, latitude, longitude, networkName }) => ({
  id,
  name,
  ...(networkName ? { networkName } : {}),
  state: 'AP',
  city: 'Macapá',
  address,
  neighborhood,
  latitude,
  longitude,
  status: 'unverified',
  visibility: 'public',
  openingHours: [],
  openingHoursNote: '',
  exerciseIds: [],
  source: source(`${name}, ${address}, Macapá AP`),
  createdAt: VERIFIED_AT,
  updatedAt: VERIFIED_AT
});

export const MACAPA_GYM_SEED_VERSION = 'macapa-2026-08-31';
export const MACAPA_GYM_SEED = Object.freeze([
  gym({ id: 'gym-macapa-smart-fit', name: 'Smart Fit Macapá', networkName: 'Smart Fit', address: 'Rua Leopoldo Machado, 2334', neighborhood: 'Central', latitude: 0.0339, longitude: -51.0667 }),
  gym({ id: 'gym-macapa-maioral-tucuju', name: 'Maioral Tucuju Academia', address: 'Rua Tancredo Neves, 224', neighborhood: 'São Lázaro', latitude: 0.0505, longitude: -51.0612 }),
  gym({ id: 'gym-macapa-energy-zona-norte', name: 'Academia Energy Zona Norte', address: 'Rua Adílson José Pinto Pereira, 1919', neighborhood: 'Infraero', latitude: 0.0731, longitude: -51.0739 }),
  gym({ id: 'gym-macapa-energy-sport', name: 'Energy Sport', address: 'Avenida Almirante Barroso, 1756', neighborhood: 'Central', latitude: 0.0371, longitude: -51.066 }),
  gym({ id: 'gym-macapa-box-cross', name: 'Box Cross Macapá', address: 'Avenida Henrique Galucio, 2467', neighborhood: 'Santa Rita', latitude: 0.0275, longitude: -51.0602 }),
  gym({ id: 'gym-macapa-box-tucuju', name: 'Box Tucuju', address: 'Avenida Anhanguera, 1246A', neighborhood: 'Buritizal', latitude: 0.0155, longitude: -51.0562 }),
  gym({ id: 'gym-macapa-t30-intensity', name: 'T30 Intensity', address: 'Avenida Henrique Galucio, 769', neighborhood: 'Central', latitude: 0.0395, longitude: -51.0645 }),
  gym({ id: 'gym-macapa-life-fit', name: 'Life Fit Academia', address: 'Rua Paraná, 602', neighborhood: 'Santa Rita', latitude: 0.0261, longitude: -51.0607 }),
  gym({ id: 'gym-macapa-best-gym', name: 'Best Gym', address: 'Avenida Décima Quinta, 2087', neighborhood: 'Marabaixo', latitude: 0.0095, longitude: -51.0988 }),
  gym({ id: 'gym-macapa-iron-men', name: 'Academia Iron Men', address: 'Avenida Tupiniquins, 84', neighborhood: 'Beirol', latitude: 0.0201, longitude: -51.0551 }),
  gym({ id: 'gym-macapa-shape-fitness', name: 'Academia Shape Fitness', address: 'Rua São Paulo, 723', neighborhood: 'Pacoval', latitude: 0.0601, longitude: -51.0705 })
]);
