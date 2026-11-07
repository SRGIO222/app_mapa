/* =====================================================================
   MapaVivo · Catálogo de categorías
   ---------------------------------------------------------------------
   Cada categoría define:
     id      → identificador interno (se guarda en localStorage)
     label   → texto del botón
     emoji   → icono que se pinta en el mapa y en la lista
     color   → color del pin y del botón
     tags    → pares [clave, valor] de OpenStreetMap que la definen.
               Se usan tanto para construir la consulta Overpass como
               para clasificar los resultados.
   Para añadir una categoría basta con añadir un objeto a esta lista.
   ===================================================================== */
window.CATEGORIES = [
  { id: 'restaurant', label: 'Restaurantes', emoji: '🍽️', color: '#f97316',
    tags: [['amenity', 'restaurant'], ['amenity', 'fast_food'], ['amenity', 'food_court']] },

  { id: 'cafe', label: 'Cafeterías', emoji: '☕', color: '#b45309',
    tags: [['amenity', 'cafe']] },

  { id: 'bar', label: 'Bares', emoji: '🍺', color: '#eab308',
    tags: [['amenity', 'bar'], ['amenity', 'pub'], ['amenity', 'biergarten']] },

  { id: 'nightlife', label: 'Ocio nocturno', emoji: '🪩', color: '#db2777',
    tags: [['amenity', 'nightclub'], ['amenity', 'casino']] },

  { id: 'hotel', label: 'Hoteles', emoji: '🏨', color: '#0ea5e9',
    tags: [['tourism', 'hotel'], ['tourism', 'hostel'], ['tourism', 'guest_house'], ['tourism', 'motel']] },

  { id: 'supermarket', label: 'Súpers', emoji: '🛒', color: '#16a34a',
    tags: [['shop', 'supermarket'], ['shop', 'convenience'], ['shop', 'greengrocer'], ['shop', 'butcher']] },

  { id: 'bakery', label: 'Panaderías', emoji: '🥐', color: '#d97706',
    tags: [['shop', 'bakery'], ['shop', 'pastry'], ['shop', 'confectionery']] },

  { id: 'pharmacy', label: 'Farmacias', emoji: '💊', color: '#22c55e',
    tags: [['amenity', 'pharmacy']] },

  { id: 'hospital', label: 'Salud', emoji: '🏥', color: '#ef4444',
    tags: [['amenity', 'hospital'], ['amenity', 'clinic'], ['amenity', 'doctors'], ['amenity', 'dentist']] },

  { id: 'atm', label: 'Bancos', emoji: '🏧', color: '#64748b',
    tags: [['amenity', 'atm'], ['amenity', 'bank'], ['amenity', 'bureau_de_change']] },

  { id: 'fuel', label: 'Gasolineras', emoji: '⛽', color: '#78716c',
    tags: [['amenity', 'fuel'], ['amenity', 'charging_station']] },

  { id: 'transport', label: 'Transporte', emoji: '🚉', color: '#3b82f6',
    tags: [['railway', 'station'], ['railway', 'halt'], ['railway', 'tram_stop'],
           ['railway', 'subway_entrance'], ['highway', 'bus_stop'],
           ['amenity', 'bus_station'], ['public_transport', 'station']] },

  { id: 'parking', label: 'Parking', emoji: '🅿️', color: '#6366f1',
    tags: [['amenity', 'parking']] },

  { id: 'park', label: 'Parques', emoji: '🌳', color: '#84cc16',
    tags: [['leisure', 'park'], ['leisure', 'garden'], ['leisure', 'playground'], ['leisure', 'nature_reserve']] },

  { id: 'gym', label: 'Deporte', emoji: '🏋️', color: '#f43f5e',
    tags: [['leisure', 'fitness_centre'], ['leisure', 'sports_centre'],
           ['leisure', 'swimming_pool'], ['leisure', 'stadium']] },

  { id: 'museum', label: 'Cultura', emoji: '🏛️', color: '#a855f7',
    tags: [['tourism', 'museum'], ['tourism', 'gallery'], ['tourism', 'attraction'],
           ['tourism', 'artwork'], ['amenity', 'arts_centre']] },

  { id: 'cinema', label: 'Cine y teatro', emoji: '🎬', color: '#8b5cf6',
    tags: [['amenity', 'cinema'], ['amenity', 'theatre']] },

  { id: 'education', label: 'Educación', emoji: '🎓', color: '#2563eb',
    tags: [['amenity', 'school'], ['amenity', 'university'], ['amenity', 'college'],
           ['amenity', 'kindergarten'], ['amenity', 'library']] },

  { id: 'emergency', label: 'Emergencias', emoji: '🚨', color: '#1d4ed8',
    tags: [['amenity', 'police'], ['amenity', 'fire_station'], ['amenity', 'post_office']] },

  { id: 'toilets', label: 'Aseos', emoji: '🚻', color: '#0891b2',
    tags: [['amenity', 'toilets']] },

  { id: 'viewpoint', label: 'Miradores', emoji: '📸', color: '#0d9488',
    tags: [['tourism', 'viewpoint']] },

  { id: 'beach', label: 'Playas', emoji: '🏖️', color: '#06b6d4',
    tags: [['natural', 'beach']] },
];

/* ---------------------------------------------------------------------
   Etiquetas legibles para los tipos de lugar.
   --------------------------------------------------------------------- */
window.TYPE_LABELS = {
  'amenity=restaurant': 'Restaurante',
  'amenity=fast_food': 'Comida rápida',
  'amenity=food_court': 'Patio de comidas',
  'amenity=cafe': 'Cafetería',
  'amenity=bar': 'Bar',
  'amenity=pub': 'Pub',
  'amenity=biergarten': 'Cervecería',
  'amenity=nightclub': 'Discoteca',
  'amenity=casino': 'Casino',
  'amenity=pharmacy': 'Farmacia',
  'amenity=hospital': 'Hospital',
  'amenity=clinic': 'Clínica',
  'amenity=doctors': 'Consulta médica',
  'amenity=dentist': 'Dentista',
  'amenity=veterinary': 'Veterinaria',
  'amenity=atm': 'Cajero automático',
  'amenity=bank': 'Banco',
  'amenity=bureau_de_change': 'Casa de cambio',
  'amenity=fuel': 'Gasolinera',
  'amenity=charging_station': 'Punto de carga',
  'amenity=parking': 'Aparcamiento',
  'amenity=bus_station': 'Estación de autobuses',
  'amenity=cinema': 'Cine',
  'amenity=theatre': 'Teatro',
  'amenity=arts_centre': 'Centro cultural',
  'amenity=school': 'Colegio',
  'amenity=university': 'Universidad',
  'amenity=college': 'Instituto',
  'amenity=kindergarten': 'Guardería',
  'amenity=library': 'Biblioteca',
  'amenity=police': 'Policía',
  'amenity=fire_station': 'Bomberos',
  'amenity=post_office': 'Oficina de correos',
  'amenity=toilets': 'Aseos públicos',
  'amenity=marketplace': 'Mercado',
  'tourism=hotel': 'Hotel',
  'tourism=hostel': 'Albergue',
  'tourism=guest_house': 'Casa de huéspedes',
  'tourism=motel': 'Motel',
  'tourism=museum': 'Museo',
  'tourism=gallery': 'Galería de arte',
  'tourism=attraction': 'Atracción turística',
  'tourism=artwork': 'Obra de arte',
  'tourism=viewpoint': 'Mirador',
  'shop=supermarket': 'Supermercado',
  'shop=convenience': 'Tienda de conveniencia',
  'shop=greengrocer': 'Frutería',
  'shop=butcher': 'Carnicería',
  'shop=bakery': 'Panadería',
  'shop=pastry': 'Pastelería',
  'shop=confectionery': 'Dulcería',
  'leisure=park': 'Parque',
  'leisure=garden': 'Jardín',
  'leisure=playground': 'Parque infantil',
  'leisure=nature_reserve': 'Reserva natural',
  'leisure=fitness_centre': 'Gimnasio',
  'leisure=sports_centre': 'Centro deportivo',
  'leisure=swimming_pool': 'Piscina',
  'leisure=stadium': 'Estadio',
  'railway=station': 'Estación de tren',
  'railway=halt': 'Apeadero',
  'railway=tram_stop': 'Parada de tranvía',
  'railway=subway_entrance': 'Boca de metro',
  'highway=bus_stop': 'Parada de autobús',
  'public_transport=station': 'Estación de transporte',
  'natural=beach': 'Playa',
};

/* Cocinas → nombre del local */
window.CUISINE_LABELS = {
  pizza: 'Pizzería',
  burger: 'Hamburguesería',
  sushi: 'Sushi',
  ramen: 'Ramen',
  kebab: 'Kebab',
  poke: 'Poke',
  tapas: 'Tapas',
  seafood: 'Marisquería',
  fish_and_chips: 'Pescado con patatas',
  chicken: 'Pollería',
  ice_cream: 'Heladería',
  dessert: 'Postres',
  sandwich: 'Bocadillos',
  breakfast: 'Desayunos',
  coffee_shop: 'Cafetería',
  italian: 'Cocina italiana',
  spanish: 'Cocina española',
  mexican: 'Cocina mexicana',
  chinese: 'Cocina china',
  japanese: 'Cocina japonesa',
  indian: 'Cocina india',
  thai: 'Cocina tailandesa',
  greek: 'Cocina griega',
  french: 'Cocina francesa',
  asian: 'Cocina asiática',
  vegetarian: 'Vegetariano',
  vegan: 'Vegano',
  regional: 'Cocina regional',
  international: 'Cocina internacional',
};

/* Devuelve un nombre legible del tipo de lugar: "Pizzería", "Farmacia"… */
window.describePlace = function describePlace(tags) {
  const baseKey = ['amenity', 'tourism', 'shop', 'leisure', 'railway', 'highway', 'public_transport', 'natural']
    .map((k) => (tags[k] ? `${k}=${tags[k]}` : null))
    .find((key) => key && window.TYPE_LABELS[key]);

  const base = baseKey ? window.TYPE_LABELS[baseKey] : 'Lugar';

  if (tags.cuisine && baseKey && /^amenity=(restaurant|fast_food)$/.test(baseKey)) {
    const first = tags.cuisine.split(';')[0].trim().toLowerCase();
    if (window.CUISINE_LABELS[first]) return window.CUISINE_LABELS[first];
  }
  return base;
};

window.formatAddress = function formatAddress(tags) {
  const street = tags['addr:street'];
  const number = tags['addr:housenumber'];
  if (street) return number ? `${street} ${number}` : street;
  if (tags['addr:place']) return tags['addr:place'];
  if (tags['addr:city']) return tags['addr:city'];
  if (tags['addr:suburb']) return tags['addr:suburb'];
  return '';
};
