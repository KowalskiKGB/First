const VERIFIED_AT = '2026-08-31T00:00:00.000Z';
const osmUrl = (kind, id) => `https://www.openstreetmap.org/${kind}/${id}`;
const googleMapsSearch = query => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;

const evidence = ({ provider = 'OpenStreetMap', url, confidence }) => ({
  label: provider,
  url,
  confidence,
  verifiedAt: VERIFIED_AT
});

const gym = ({ id, name, address, neighborhood, latitude, longitude, networkName, reference, coordinateEvidence = reference, coordinateApproximate = false }) => ({
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
    provider: coordinateEvidence.provider || 'OpenStreetMap',
    url: coordinateEvidence.url,
    confidence: coordinateEvidence.confidence,
    verifiedAt: VERIFIED_AT,
    ...(coordinateEvidence.note ? { note: coordinateEvidence.note } : {})
  },
  createdAt: VERIFIED_AT,
  updatedAt: VERIFIED_AT
});

const node = id => ({ url: osmUrl('node', id), confidence: 'high' });
const way = id => ({ url: osmUrl('way', id), confidence: 'medium' });
const cadastral = url => ({ provider: 'Econodata CNPJ', url, confidence: 'medium' });

export const MACAPA_GYM_SEED_VERSION = 'macapa-2026-09-02-social-1';
export const MACAPA_GYM_SEED = Object.freeze([
  gym({ id: 'gym-macapa-smart-fit', name: 'Smart Fit Macapá', networkName: 'Smart Fit', address: 'Rua Leopoldo Machado, 2334', neighborhood: 'Central', latitude: 0.0310698, longitude: -51.0627507, reference: node(5879406675) }),
  gym({ id: 'gym-macapa-maioral-tucuju', name: 'Maioral Tucuju Academia', address: 'Rua Tancredo Neves, 224', neighborhood: 'São Lázaro', latitude: 0.0737488, longitude: -51.0554312, reference: way(296270887) }),
  gym({ id: 'gym-macapa-energy-zona-norte', name: 'Academia Energy Zona Norte', address: 'Rua Adílson José Pinto Pereira, 1919', neighborhood: 'Infraero', latitude: 0.0782089, longitude: -51.0704844, reference: way(162924212) }),
  gym({ id: 'gym-macapa-energy-sport', name: 'Energy Sport', address: 'Avenida Almirante Barroso, 1756', neighborhood: 'Central', latitude: 0.0368499, longitude: -51.0637899, reference: way(129304634) }),
  gym({ id: 'gym-macapa-box-cross', name: 'Box Cross Macapá', address: 'Avenida Henrique Galucio, 2467', neighborhood: 'Santa Rita', latitude: 0.0321713, longitude: -51.0731483, reference: way(1136417161) }),
  gym({ id: 'gym-macapa-box-tucuju', name: 'Box Tucuju', address: 'Avenida Anhanguera, 1246A', neighborhood: 'Buritizal', latitude: 0.0213344, longitude: -51.0716876, reference: way(162971760) }),
  gym({ id: 'gym-macapa-t30-intensity', name: 'T30 Intensity', address: 'Avenida Henrique Galucio, 769', neighborhood: 'Central', latitude: 0.0313461, longitude: -51.0610619, reference: way(91252011) }),
  gym({ id: 'gym-macapa-life-fit', name: 'Life Fit Academia', address: 'Rua Paraná, 602', neighborhood: 'Santa Rita', latitude: 0.040453, longitude: -51.0765133, reference: node(13520870449) }),
  gym({
    id: 'gym-macapa-best-gym', name: 'Best Gym', address: 'Avenida Décima Quinta, 2087', neighborhood: 'Marabaixo',
    latitude: 0.049152, longitude: -51.11808, coordinateApproximate: true,
    reference: cadastral('https://www.econodata.com.br/consulta-empresa/51326678000108-academia-best-gym-ltda'),
    coordinateEvidence: {
      provider: 'Google Maps center', confidence: 'medium',
      url: googleMapsSearch('Academia Best Gym Avenida Décima Quinta 2087 Macapá AP'),
      note: 'Google Maps og:image center=0.049152,-51.11808; reverse OSM: Marabaixo III, Macapá (way 589902440).'
    }
  }),
  gym({ id: 'gym-macapa-iron-men', name: 'Academia Iron Men', address: 'Avenida Tupiniquins, 84', neighborhood: 'Beirol', latitude: 0.0184874, longitude: -51.0633551, reference: way(162971757) }),
  gym({ id: 'gym-macapa-shape-fitness', name: 'Academia Shape Fitness', address: 'Rua São Paulo, 723', neighborhood: 'Pacoval', latitude: 0.0597096, longitude: -51.0535042, reference: way(162923254) })
]);

const demoReview = (id, gymId, rating, comment) => ({
  id,
  gymId,
  userId: `demo-first-community-${id.slice(-2)}`,
  rating,
  comment: `Demonstração — exemplo fictício: ${comment}`,
  status: 'published',
  demo: true,
  createdAt: VERIFIED_AT,
  updatedAt: VERIFIED_AT
});

export const MACAPA_GYM_REVIEW_SEED = Object.freeze([
  demoReview('gym-demo-review-01', 'gym-macapa-smart-fit', 5, 'boa variedade para montar treinos diferentes.'),
  demoReview('gym-demo-review-02', 'gym-macapa-maioral-tucuju', 4, 'ambiente organizado para acompanhar a rotina.'),
  demoReview('gym-demo-review-03', 'gym-macapa-energy-zona-norte', 4, 'opções práticas para um treino completo.'),
  demoReview('gym-demo-review-04', 'gym-macapa-box-cross', 5, 'espaço interessante para treinos funcionais.'),
  demoReview('gym-demo-review-05', 'gym-macapa-life-fit', 4, 'experiência simples de descobrir e avaliar a academia.'),
  demoReview('gym-demo-review-06', 'gym-macapa-shape-fitness', 3, 'comentário criado somente para testar a comunidade.')
]);
