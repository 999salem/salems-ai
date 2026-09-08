/* S.A.L.E.M. local-first data layer. No secrets belong here. */
const SalemDB = (() => {
  const DB_NAME = 'salem_ai_local';
  const DB_VERSION = 1;
  const STORE = 'state';
  const KEY = 'profile';

  const seed = {
    meta: { schemaVersion: 2, updatedAt: new Date().toISOString() },
    profile: { name: 'Marcus', backendUrl: '' },
    finance: {
      savings: 300,
      savingsFloor: 1500,
      cash: 5,
      paycheque: 1100,
      cards: [
        { id: 'card1', name: 'Credit Card 1', balance: 4000, limit: 5000 },
        { id: 'card2', name: 'Credit Card 2', balance: 4000, limit: 5000 }
      ],
      bills: [
        { id: 'insurance', name: 'Insurance', amount: 322, due: 'needs attention', status: 'due', priority: 'urgent' },
        { id: 'phone', name: 'Phone', amount: null, due: '19th', status: 'upcoming', priority: 'soon' }
      ]
    },
    work: {
      employer: 'Harry & Sons Barbershop',
      locations: ['Walnut Grove', 'Cloverdale'],
      role: 'Barber + social media',
      schedule: {
        1: { start: '10:00 AM', end: '5:00 PM', note: 'Alternating Mondays in Walnut Grove' },
        2: { start: '12:00 PM', end: '8:00 PM', note: '' },
        3: { start: '12:00 PM', end: '8:00 PM', note: '' },
        4: { start: '12:00 PM', end: '8:00 PM', note: '' },
        5: { start: '10:00 AM', end: '5:00 PM', note: '' },
        6: { start: '8:00 AM', end: '5:00 PM', note: '' }
      },
      tasks: [
        { id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()), title: 'Check Harry & Sons social/content needs', done: false, category: 'work' }
      ]
    },
    people: [
      { id: 'dad', name: 'Dad', category: 'Family / Work', context: 'Harry & Sons / Owner', notes: [], openItems: [] },
      { id: 'uncle', name: 'Uncle', category: 'Family / Work', context: 'Harry & Sons / Owner', notes: [], openItems: [] }
    ],
    projects: {
      '999salem': {
        title: '999salem', subtitle: 'Minecraft • Streaming • Content',
        tasks: [
          'Railway / station network',
          'District builds',
          'Large builds',
          'SalemCraft ideas'
        ],
        contentQueue: []
      },
      barber: {
        title: 'Marcus X Barber', subtitle: 'Personal barber brand',
        tasks: ['Content ideas', 'Photos / reels to post', 'Captions', 'Branding', 'Booking tasks']
      }
    },
    fitness: {
      planName: 'Month 1 Beginner Calisthenics',
      weeklyTarget: 3,
      completedThisWeek: 0,
      exercises: [
        { name: 'Push-ups', sets: '3 × 8–12' },
        { name: 'Pull-ups / Inverted Rows', sets: '3 × 5–8' },
        { name: 'Dips', sets: '3 × 8–12' },
        { name: 'Squats', sets: '3 × 15–20' },
        { name: 'Lunges', sets: '3 × 10–15 / leg' },
        { name: 'Plank', sets: '3 × 30–60 sec' }
      ],
      lastWorkout: null,
      activeExercise: null
    },
    marvel: {
      currentTitle: 'Marvel reading',
      currentIssue: 'Set current issue',
      completed: ['Secret Wars (2015) #9'],
      lists: ['Doctor Doom', 'Secret Wars', 'Mutant Saga', 'MCU Prep'],
      notes: []
    },
    reminders: [
      { id: 'insurance-reminder', title: 'Resolve insurance payment', category: 'finance', priority: 'urgent', due: 'Now', done: false },
      { id: 'phone-reminder', title: 'Phone bill', category: 'finance', priority: 'soon', due: '19th', done: false }
    ],
    chat: [],
    settings: { bootAnimation: true, sounds: false, voice: true, reduceMotion: false }
  };

  let dbPromise;
  function openDB() {
    if (!('indexedDB' in window)) return Promise.reject(new Error('IndexedDB unavailable'));
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbPromise;
  }

  function deepClone(v) { return JSON.parse(JSON.stringify(v)); }

  function mergeDefaults(defaults, current) {
    if (Array.isArray(defaults)) return Array.isArray(current) ? current : deepClone(defaults);
    if (defaults && typeof defaults === 'object') {
      const out = {};
      const src = current && typeof current === 'object' && !Array.isArray(current) ? current : {};
      for (const [k, v] of Object.entries(defaults)) out[k] = mergeDefaults(v, src[k]);
      for (const [k, v] of Object.entries(src)) if (!(k in out)) out[k] = v;
      return out;
    }
    return current === undefined || current === null ? defaults : current;
  }

  async function get() {
    try {
      const db = await openDB();
      const value = await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, 'readonly');
        const req = tx.objectStore(STORE).get(KEY);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      if (value) {
        const normalized = mergeDefaults(seed, value);
        normalized.meta.schemaVersion = 2;
        if (JSON.stringify(normalized) !== JSON.stringify(value)) await set(normalized);
        return normalized;
      }
      const initial = deepClone(seed);
      await set(initial);
      return initial;
    } catch (e) {
      const raw = localStorage.getItem('salem_fallback_state');
      if (raw) return mergeDefaults(seed, JSON.parse(raw));
      const initial = deepClone(seed);
      localStorage.setItem('salem_fallback_state', JSON.stringify(initial));
      return initial;
    }
  }

  async function set(state) {
    state.meta = state.meta || {};
    state.meta.schemaVersion = 2;
    state.meta.updatedAt = new Date().toISOString();
    try {
      const db = await openDB();
      await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).put(state, KEY);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } catch (e) {
      localStorage.setItem('salem_fallback_state', JSON.stringify(state));
    }
    return state;
  }

  async function update(mutator) {
    const state = await get();
    const maybe = await mutator(state);
    return set(maybe || state);
  }

  async function reset() {
    return set(deepClone(seed));
  }

  return { get, set, update, reset, seed };
})();
