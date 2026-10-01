// Golf Ball Fitter — Questionnaire definitions.
// Each question's `key` matches the answers-object shape scoring-engine.js
// expects exactly (see test-scoring.js for reference). `showIf` controls
// conditional visibility; questions without it always show.

export const BRANDS = [
  'Amazon Basics', 'Bridgestone', 'Callaway', 'Kirkland', 'Maxfli', 'Mizuno',
  'PXG', 'Snell', 'Srixon', 'TaylorMade', 'Titleist', 'Tour Edge', 'Vice', 'Wilson',
];

export const AU_STATES = ['NSW', 'VIC', 'QLD', 'WA', 'SA', 'TAS', 'ACT', 'NT'];

export const QUESTIONS = [
  // ---------------- Section 1: Golfer profile ----------------
  {
    number: 1, section: 'profile', key: 'swingSpeedBand', type: 'single-select',
    prompt: "What's your driver swing speed?",
    options: [
      { value: 'under85', label: 'Under 85 mph' },
      { value: '85-95', label: '85–95 mph' },
      { value: '95-105', label: '95–105 mph' },
      { value: '105-115', label: '105–115 mph' },
      { value: '115+', label: '115+ mph' },
      { value: 'dontknow', label: "I don't know" },
    ],
  },
  {
    number: 2, section: 'profile', key: 'carryDistanceM', type: 'number',
    prompt: 'Roughly how far does your driver carry, in metres?',
    unit: 'm', min: 100, max: 320,
    showIf: (a) => a.swingSpeedBand === 'dontknow',
  },
  {
    number: 3, section: 'profile', key: 'handicap', type: 'number',
    prompt: "What's your handicap, or your typical score?",
    unit: '', min: 0, max: 54,
  },
  {
    number: 4, section: 'profile', key: 'ballFlight', type: 'single-select',
    prompt: 'How would you describe your typical ball flight?',
    options: [
      { value: 'low', label: 'Low' },
      { value: 'mid', label: 'Mid' },
      { value: 'high', label: 'High' },
    ],
  },
  {
    number: 5, section: 'profile', key: 'shotShape', type: 'single-select',
    prompt: "What's your stock shot shape?",
    options: [
      { value: 'draw', label: 'Draw' },
      { value: 'fade', label: 'Fade' },
      { value: 'straight', label: 'Straight' },
      { value: 'varies', label: 'Varies' },
    ],
  },
  {
    number: 6, section: 'profile', key: 'missPattern', type: 'single-select',
    prompt: 'Under pressure, what's your typical miss?',
    options: [
      { value: 'hook', label: 'Hook' },
      { value: 'slice', label: 'Slice' },
      { value: 'both', label: 'Both hook and slice' },
      { value: 'push', label: 'Push' },
      { value: 'pull', label: 'Pull' },
      { value: 'thinfat', label: 'Thin or fat' },
      { value: 'none', label: 'No dominant miss' },
    ],
  },
  {
    number: 7, section: 'profile', key: 'launchMonitor', type: 'launch-monitor',
    prompt: 'Got launch monitor numbers? They override the guess above.',
    optional: true,
  },
  {
    number: 8, section: 'profile', key: 'conditions', type: 'conditions',
    prompt: 'Where — and in what conditions — do you mostly play?',
  },

  // ---------------- Section 2: Ball module ----------------
  {
    number: 9, section: 'ball', key: 'currentBall', type: 'current-ball',
    prompt: "What ball do you play now, and what do you like or dislike about it?",
  },
  {
    number: 10, section: 'ball', key: 'pastBalls', type: 'ball-multiselect',
    prompt: "Which balls have you played well with before? (This won't affect your score — it's just a sanity check on the results.)",
    optional: true,
  },
  {
    number: 11, section: 'ball', key: 'feelPreference', type: 'feel-scale',
    prompt: 'How do you like the ball to feel off the face?',
  },
  {
    number: 12, section: 'ball', key: 'greensideFrequency', type: 'single-select',
    prompt: 'How many shots a round, inside 100 metres, need to check up or stop quickly?',
    options: [
      { value: 'few', label: 'Few' },
      { value: 'some', label: 'Some' },
      { value: 'lots', label: 'Lots' },
    ],
  },
  {
    number: 13, section: 'ball', key: 'shortGameStyle', type: 'single-select',
    prompt: "What's your short-game style around the green?",
    options: [
      { value: 'bumprun', label: 'Mostly bump-and-run' },
      { value: 'mix', label: 'A mix' },
      { value: 'flopcheck', label: 'Mostly flop-and-check' },
    ],
  },
  {
    number: 14, section: 'ball', key: 'priorities', type: 'rank',
    prompt: 'Tap these in order, most important first.',
    options: [
      { value: 'distance', label: 'Distance' },
      { value: 'spinControl', label: 'Spin control' },
      { value: 'feel', label: 'Feel' },
      { value: 'price', label: 'Price' },
      { value: 'durability', label: 'Durability' },
    ],
  },
  {
    number: 15, section: 'ball', key: 'budget', type: 'single-select',
    prompt: 'Budget per dozen, in Australian dollars?',
    options: [
      { value: 'under40', label: 'Under $40' },
      { value: '40-60', label: '$40–60' },
      { value: '60-80', label: '$60–80' },
      { value: 'nolimit', label: 'No limit' },
    ],
  },
  {
    number: 16, section: 'ball', key: 'ballsLostPerRound', type: 'single-select',
    prompt: 'How many balls do you lose per round, on average?',
    options: [
      { value: '0-1', label: '0–1' },
      { value: '2-3', label: '2–3' },
      { value: '4+', label: '4 or more' },
    ],
  },
  {
    number: 17, section: 'ball', key: 'colourPref', type: 'single-select',
    prompt: 'Colour?',
    options: [
      { value: 'whiteOnly', label: 'White only' },
      { value: 'openToColour', label: 'Open to colour' },
    ],
  },
  {
    number: 18, section: 'ball', key: 'brandsToAvoid', type: 'brand-multiselect',
    prompt: 'Any brands to avoid?',
    optional: true,
  },
  {
    number: 19, section: 'ball', key: 'loyalBrand', type: 'brand-single-optional',
    prompt: "Any brand you're loyal to, regardless?",
    optional: true,
  },
];

export const TOTAL_QUESTIONS = QUESTIONS.length; // 19
