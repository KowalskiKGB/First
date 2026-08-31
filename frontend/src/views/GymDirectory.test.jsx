import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'

vi.mock('../lib/i18n.js', () => ({
  exerciseName: exercise => exercise.namePt || exercise.name,
  t: (message, ...args) => {
    const pt = {
      'Find your gym': 'Encontre sua academia',
      'Where do you train?': 'Onde você treina?',
      State: 'UF',
      Municipality: 'Município',
      'Select a state': 'Selecione a UF',
      'Select a state first': 'Selecione a UF primeiro',
      'Select a municipality': 'Selecione o município',
      'Choose a state and municipality to see nearby gyms.': 'Escolha uma UF e um município para ver as academias.',
      'Search gyms': 'Pesquisar academia',
      'Search by name or address': 'Pesquise por nome ou endereço',
      'Select this gym': 'Selecionar academia',
      'Selected gym': 'Academia selecionada',
      'Opening hours': 'Dias e horários',
      'Available exercises': 'Exercícios disponíveis',
      'Could not find your equipment? Click here to register it': 'Não encontrou seu aparelho? Clique aqui para cadastrar',
      'Use my location': 'Usar minha localização',
      'All gyms': 'Todas',
      Nearby: 'Próximas',
      Favorites: 'Favoritas',
      Trending: 'Em alta',
      'Could not find the gym? Create it here': 'Não encontrou a academia? Crie aqui',
      'Suggest a correction': 'Sugerir correção',
      'Add equipment': 'Adicionar aparelho',
      'Report closure': 'Informar fechamento',
      'Community reviews': 'Avaliações da comunidade',
    }
    return args.reduce((value, arg, index) => value.replaceAll(`{${index}}`, arg), pt[message] || message)
  },
}))

vi.mock('../components/Icon.jsx', () => ({ default: ({ name }) => <i data-icon={name} /> }))
vi.mock('../components/ExerciseCatalogPicker.jsx', () => ({
  default: ({ selectedIds = [], readOnly = false, searchName }) => (
    <section
      className="exercise-catalog-picker"
      data-selected-ids={selectedIds.join(',')}
      data-read-only={String(readOnly)}
      data-search-name={searchName}
    />
  ),
  ExerciseCatalogPicker: ({ selectedIds = [], readOnly = false, searchName }) => (
    <section
      className="exercise-catalog-picker"
      data-selected-ids={selectedIds.join(',')}
      data-read-only={String(readOnly)}
      data-search-name={searchName}
    />
  ),
}))

import GymDirectory, { reverseLocationPath } from './GymDirectory.jsx'

const gyms = [
  {
    id: 'gym-x',
    name: 'Academia X',
    networkName: 'Rede X',
    state: 'CE',
    city: 'Fortaleza',
    address: 'Rua ABC, 123',
    status: 'unverified',
    openingHoursNote: 'Segunda a sexta, 6:00 às 22:00',
    openingHours: [
      { day: 1, open: '06:00', close: '22:00', closed: false },
      { day: 0, closed: true },
    ],
    exerciseIds: ['0043', '0085'],
    averageRating: 4.8,
    reviewCount: 27,
    tags: ['Preferida', 'Em alta'],
  },
  {
    id: 'gym-y',
    name: 'Academia Y',
    state: 'SP',
    city: 'Campinas',
    address: 'Avenida Central, 40',
    status: 'verified',
    openingHours: [],
    exerciseIds: ['0739'],
  },
]

describe('GymDirectory', () => {
  it('limits reverse-geocoding coordinates to 3 decimals without losing zero or negative signs', () => {
    expect(reverseLocationPath({ latitude: 0, longitude: -51.06656 }))
      .toBe('/api/location/reverse?latitude=0&longitude=-51.067')
    expect(reverseLocationPath({ latitude: -3.73154, longitude: 0 }))
      .toBe('/api/location/reverse?latitude=-3.732&longitude=0')
  })

  it('offers locality and gym search before authentication is needed', () => {
    const markup = renderToStaticMarkup(
      <GymDirectory gyms={gyms} selectedGymId={null} onSelect={vi.fn()} onRequestEquipment={vi.fn()} />,
    )

    expect(markup).toContain('gym-directory')
    expect(markup).toContain('Encontre sua academia')
    expect(markup).toContain('name="gym-state"')
    expect(markup).toContain('name="gym-city"')
    expect(markup).toContain('name="gym-search"')
    expect(markup.match(/<option/g)).toHaveLength(29)
    expect(markup).toContain('Selecione a UF')
    expect(markup).toContain('Selecione a UF primeiro')
    expect(markup).toContain('Escolha uma UF e um município para ver as academias.')
    expect(markup).not.toContain('No gyms found in this location.')
    expect(markup).not.toContain('Academia X')
    expect(markup).not.toMatch(/faça login|entre para continuar/i)
  })

  it('preserves the locality of a previously selected gym', () => {
    const markup = renderToStaticMarkup(
      <GymDirectory gyms={gyms} selectedGymId="gym-y" onSelect={vi.fn()} />,
    )

    expect(markup).toContain('gym-directory-detail-view')
    expect(markup).toContain('Campinas / SP')
    expect(markup).toContain('Academia Y')
  })

  it('shows address, opening hours and the shared exercise catalog in gym detail', () => {
    const markup = renderToStaticMarkup(
      <GymDirectory gyms={gyms} selectedGymId="gym-x" onSelect={vi.fn()} onRequestEquipment={vi.fn()} />,
    )

    expect(markup).toContain('Academia X')
    expect(markup).toContain('Rua ABC, 123')
    expect(markup).toContain('06:00')
    expect(markup).toContain('22:00')
    expect(markup).toContain('Segunda a sexta, 6:00 às 22:00')
    expect(markup).toContain('exercise-catalog-picker')
    expect(markup).toContain('data-selected-ids="0043,0085"')
    expect(markup).toContain('data-read-only="true"')
    expect(markup).toContain('data-search-name="gym-exercise-search"')
    expect(markup).toContain('Adicionar aparelho')
    expect(markup).toContain('Academia selecionada')
    expect(markup).toContain('aria-pressed="true"')
    expect(markup).toContain('role="radiogroup"')
    expect(markup.match(/type="radio"/g)).toHaveLength(5)
    expect(markup).toContain('Sugerir correção')
    expect(markup).toContain('Informar fechamento')
    expect(markup).toContain('Avaliações da comunidade')
  })

  it('renders compact social filters without the old explicit location action', () => {
    const markup = renderToStaticMarkup(<GymDirectory gyms={gyms} authenticated={false} />)

    expect(markup).not.toContain('Usar minha localização')
    expect(markup).toContain('Todas')
    expect(markup).toContain('Próximas')
    expect(markup).toContain('Favoritas')
    expect(markup).toContain('Em alta')
    expect(markup).toContain('Não encontrou a academia? Crie aqui')
  })

  it('gives the detail back control a 44px touch target', () => {
    const css = readFileSync(new URL('../index.css', import.meta.url), 'utf8')
    expect(css).toMatch(/\.gym-detail-nav \.iconbtn\{[^}]*min-width:44px[^}]*min-height:44px/)
  })
})
