import { QUESTIONS, BRANDS, AU_STATES } from './questions.js';
import { getRecommendations, getConditionsSet } from './scoring-engine.js';
import { saveFittingSubmission, saveFeedback } from './supabase-client.js';

const state = {
  currentIndex: 0,
  answers: {
    swingSpeedBand: null, carryDistanceM: null, handicap: null,
    ballFlight: null, shotShape: null, missPattern: null,
    launchMonitor: null,
    conditions: { state: null, tags: [] },
    currentBall: { name: '', notes: '' },
    pastBalls: [],
    feelPreference: null,
    greensideFrequency: null, shortGameStyle: null,
    priorities: [],
    budget: null, ballsLostPerRound: null, colourPref: null,
    brandsToAvoid: [], loyalBrand: null,
  },
};

let database = null;

const app = document.getElementById('app');

function visibleQuestions() {
  return QUESTIONS.filter(q => !q.showIf || q.showIf(state.answers));
}

function currentQuestion() {
  return visibleQuestions()[state.currentIndex];
}

function isAnswered(q) {
  const v = state.answers[q.key];
  switch (q.type) {
    case 'single-select':
      return v !== null && v !== undefined;
    case 'number':
      return typeof v === 'number' && !Number.isNaN(v);
    case 'launch-monitor':
      return true; // always optional — null is a valid final answer
    case 'conditions':
      return v && v.state;
    case 'current-ball':
      return true; // optional free text
    case 'ball-multiselect':
    case 'brand-multiselect':
      return true; // optional, empty array is valid
    case 'feel-scale':
      return v !== null && v !== undefined;
    case 'rank':
      return Array.isArray(v) && v.length === q.options.length;
    case 'brand-single-optional':
      return true;
    default:
      return true;
  }
}

function goNext() {
  const qs = visibleQuestions();
  if (state.currentIndex < qs.length - 1) {
    state.currentIndex += 1;
    render();
  } else {
    finish();
  }
}

function goBack() {
  if (state.currentIndex > 0) {
    state.currentIndex -= 1;
    render();
  }
}

function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  Object.entries(props).forEach(([k, v]) => {
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2).toLowerCase(), v);
    else node.setAttribute(k, v);
  });
  children.forEach(c => node.appendChild(c));
  return node;
}

// ---------------------------------------------------------------------
// Per-question-type renderers. Each returns a DOM node appended below the
// question prompt. Single-choice types auto-advance on selection; others
// show an explicit Continue button, enabled once isAnswered() passes.
// ---------------------------------------------------------------------

function renderSingleSelect(q) {
  const wrap = el('div', { class: 'options' });
  q.options.forEach(opt => {
    const btn = el('button', {
      class: 'option-btn' + (state.answers[q.key] === opt.value ? ' selected' : ''),
      text: opt.label,
      onClick: () => {
        state.answers[q.key] = opt.value;
        render();
        setTimeout(goNext, 220);
      },
    });
    wrap.appendChild(btn);
  });
  return wrap;
}

function renderNumber(q) {
  const wrap = el('div', { class: 'number-input-wrap' });
  const input = el('input', {
    type: 'number', class: 'number-input',
    min: q.min, max: q.max,
    value: state.answers[q.key] ?? '',
    placeholder: q.unit ? `e.g. 220 ${q.unit}` : 'e.g. 12',
  });
  input.addEventListener('input', () => {
    const n = parseFloat(input.value);
    state.answers[q.key] = Number.isNaN(n) ? null : n;
    updateContinueState();
  });
  wrap.appendChild(input);
  if (q.unit) wrap.appendChild(el('span', { class: 'unit-label', text: q.unit }));
  return wrap;
}

function renderLaunchMonitor(q) {
  const wrap = el('div', { class: 'launch-monitor' });
  const has = state.answers.launchMonitor !== null;
  const toggle = el('div', { class: 'options' }, [
    el('button', {
      class: 'option-btn' + (has ? ' selected' : ''),
      text: 'Yes, I have numbers',
      onClick: () => {
        if (!state.answers.launchMonitor) {
          state.answers.launchMonitor = { ballSpeed: null, driverSpin: null, launchAngle: null };
        }
        render();
      },
    }),
    el('button', {
      class: 'option-btn' + (!has ? ' selected' : ''),
      text: 'No, skip this',
      onClick: () => { state.answers.launchMonitor = null; goNext(); },
    }),
  ]);
  wrap.appendChild(toggle);

  if (has) {
    const fields = [
      ['ballSpeed', 'Ball speed (mph)'],
      ['driverSpin', 'Driver spin (rpm)'],
      ['launchAngle', 'Launch angle (°)'],
    ];
    const grid = el('div', { class: 'launch-grid' });
    fields.forEach(([key, label]) => {
      const field = el('div', { class: 'field' });
      field.appendChild(el('label', { text: label }));
      const input = el('input', {
        type: 'number', value: state.answers.launchMonitor[key] ?? '',
      });
      input.addEventListener('input', () => {
        const n = parseFloat(input.value);
        state.answers.launchMonitor[key] = Number.isNaN(n) ? null : n;
      });
      field.appendChild(input);
      grid.appendChild(field);
    });
    wrap.appendChild(grid);
  }
  return wrap;
}

function renderConditions(q) {
  const wrap = el('div', { class: 'conditions' });
  const stateField = el('div', { class: 'field' });
  stateField.appendChild(el('label', { text: 'State / territory' }));
  const select = el('select', {});
  select.appendChild(el('option', { value: '', text: 'Choose one…' }));
  AU_STATES.forEach(s => select.appendChild(el('option', { value: s, text: s })));
  select.value = state.answers.conditions.state || '';
  select.addEventListener('change', () => {
    state.answers.conditions.state = select.value || null;
    updateContinueState();
  });
  stateField.appendChild(select);
  wrap.appendChild(stateField);

  const tagLabel = el('div', { class: 'sub-label', text: 'Conditions you play in (pick any)' });
  wrap.appendChild(tagLabel);
  const tagOptions = [
    { value: 'wind', label: 'Wind' },
    { value: 'heat', label: 'Heat' },
    { value: 'wet', label: 'Wet or soft' },
    { value: 'firm', label: 'Firm and fast' },
  ];
  const tagWrap = el('div', { class: 'options' });
  tagOptions.forEach(opt => {
    const active = state.answers.conditions.tags.includes(opt.value);
    const btn = el('button', {
      class: 'option-btn toggle' + (active ? ' selected' : ''),
      text: opt.label,
      onClick: () => {
        const tags = state.answers.conditions.tags;
        const i = tags.indexOf(opt.value);
        if (i === -1) tags.push(opt.value); else tags.splice(i, 1);
        render();
      },
    });
    tagWrap.appendChild(btn);
  });
  wrap.appendChild(tagWrap);
  return wrap;
}

function renderCurrentBall(q) {
  const wrap = el('div', { class: 'current-ball' });
  const nameField = el('div', { class: 'field' });
  nameField.appendChild(el('label', { text: 'Ball name' }));
  const nameInput = el('input', { type: 'text', value: state.answers.currentBall.name });
  nameInput.addEventListener('input', () => { state.answers.currentBall.name = nameInput.value; });
  nameField.appendChild(nameInput);
  wrap.appendChild(nameField);

  const notesField = el('div', { class: 'field' });
  notesField.appendChild(el('label', { text: 'What you like or dislike about it' }));
  const notesInput = el('textarea', { rows: '3' });
  notesInput.value = state.answers.currentBall.notes;
  notesInput.addEventListener('input', () => { state.answers.currentBall.notes = notesInput.value; });
  notesField.appendChild(notesInput);
  wrap.appendChild(notesField);
  return wrap;
}

function renderBallMultiselect(q) {
  const wrap = el('div', { class: 'ball-multiselect' });
  const filterInput = el('input', { type: 'text', placeholder: 'Filter…', class: 'filter-input' });
  wrap.appendChild(filterInput);
  const listWrap = el('div', { class: 'checkbox-list' });
  wrap.appendChild(listWrap);

  const ballNames = database ? Object.keys(database.balls).sort() : [];

  function renderList(filter = '') {
    listWrap.innerHTML = '';
    ballNames
      .filter(n => n.toLowerCase().includes(filter.toLowerCase()))
      .forEach(name => {
        const checked = state.answers.pastBalls.includes(name);
        const row = el('label', { class: 'checkbox-row' });
        const cb = el('input', { type: 'checkbox' });
        cb.checked = checked;
        cb.addEventListener('change', () => {
          const arr = state.answers.pastBalls;
          const i = arr.indexOf(name);
          if (cb.checked && i === -1) arr.push(name);
          if (!cb.checked && i !== -1) arr.splice(i, 1);
        });
        row.appendChild(cb);
        row.appendChild(el('span', { text: name }));
        listWrap.appendChild(row);
      });
  }
  filterInput.addEventListener('input', () => renderList(filterInput.value));
  renderList();
  return wrap;
}

function renderFeelScale(q) {
  const wrap = el('div', { class: 'options' });
  const scale = [
    { value: 1, label: 'Firm' }, { value: 2, label: '' }, { value: 3, label: 'In between' },
    { value: 4, label: '' }, { value: 5, label: 'Soft' },
  ];
  scale.forEach(opt => {
    const btn = el('button', {
      class: 'option-btn scale-btn' + (state.answers.feelPreference === opt.value ? ' selected' : ''),
      text: opt.label || String(opt.value),
      onClick: () => { state.answers.feelPreference = opt.value; render(); setTimeout(goNext, 220); },
    });
    wrap.appendChild(btn);
  });
  const dontCare = el('button', {
    class: 'option-btn' + (state.answers.feelPreference === 'dontcare' ? ' selected' : ''),
    text: "Don't care",
    onClick: () => { state.answers.feelPreference = 'dontcare'; render(); setTimeout(goNext, 220); },
  });
  const outer = el('div', {}, [wrap, dontCare]);
  return outer;
}

function renderRank(q) {
  const wrap = el('div', { class: 'rank-list' });
  const ranked = state.answers.priorities;
  q.options.forEach(opt => {
    const rankIndex = ranked.indexOf(opt.value);
    const btn = el('button', {
      class: 'rank-btn' + (rankIndex !== -1 ? ' ranked' : ''),
      onClick: () => {
        if (rankIndex !== -1) {
          ranked.splice(rankIndex, 1);
        } else {
          ranked.push(opt.value);
        }
        render();
      },
    });
    btn.appendChild(el('span', { class: 'rank-number', text: rankIndex !== -1 ? String(rankIndex + 1) : '' }));
    btn.appendChild(el('span', { class: 'rank-label', text: opt.label }));
    wrap.appendChild(btn);
  });
  if (ranked.length) {
    wrap.appendChild(el('button', {
      class: 'reset-link', text: 'Reset order',
      onClick: () => { state.answers.priorities = []; render(); },
    }));
  }
  return wrap;
}

function renderBrandMultiselect(q) {
  const wrap = el('div', { class: 'options' });
  BRANDS.forEach(brand => {
    const active = state.answers.brandsToAvoid.includes(brand);
    const btn = el('button', {
      class: 'option-btn toggle' + (active ? ' selected' : ''),
      text: brand,
      onClick: () => {
        const arr = state.answers.brandsToAvoid;
        const i = arr.indexOf(brand);
        if (i === -1) arr.push(brand); else arr.splice(i, 1);
        render();
      },
    });
    wrap.appendChild(btn);
  });
  return wrap;
}

function renderBrandSingleOptional(q) {
  const wrap = el('div', { class: 'options' });
  BRANDS.forEach(brand => {
    const btn = el('button', {
      class: 'option-btn' + (state.answers.loyalBrand === brand ? ' selected' : ''),
      text: brand,
      onClick: () => { state.answers.loyalBrand = brand; render(); setTimeout(goNext, 220); },
    });
    wrap.appendChild(btn);
  });
  wrap.appendChild(el('button', {
    class: 'option-btn' + (state.answers.loyalBrand === null ? ' selected' : ''),
    text: 'None',
    onClick: () => { state.answers.loyalBrand = null; goNext(); },
  }));
  return wrap;
}

const RENDERERS = {
  'single-select': renderSingleSelect,
  'number': renderNumber,
  'launch-monitor': renderLaunchMonitor,
  'conditions': renderConditions,
  'current-ball': renderCurrentBall,
  'ball-multiselect': renderBallMultiselect,
  'feel-scale': renderFeelScale,
  'rank': renderRank,
  'brand-multiselect': renderBrandMultiselect,
  'brand-single-optional': renderBrandSingleOptional,
};

const NO_AUTO_ADVANCE_TYPES = new Set([
  'number', 'launch-monitor', 'conditions', 'current-ball',
  'ball-multiselect', 'rank', 'brand-multiselect',
]);

let continueBtnRef = null;

function updateContinueState() {
  const q = currentQuestion();
  if (continueBtnRef) continueBtnRef.disabled = !isAnswered(q) && !q.optional;
}

function render() {
  const qs = visibleQuestions();
  const q = qs[state.currentIndex];
  app.innerHTML = '';

  const progress = el('div', { class: 'progress' });
  progress.appendChild(el('span', { class: 'progress-number', text: String(state.currentIndex + 1).padStart(2, '0') }));
  progress.appendChild(el('span', { class: 'progress-total', text: ` of ${qs.length}` }));
  const bar = el('div', { class: 'progress-bar' });
  bar.appendChild(el('div', { class: 'progress-fill', style: `width:${((state.currentIndex) / qs.length) * 100}%` }));
  app.appendChild(progress);
  app.appendChild(bar);

  app.appendChild(el('h1', { class: 'prompt', text: q.prompt }));

  const body = RENDERERS[q.type](q);
  app.appendChild(body);

  const footer = el('div', { class: 'footer' });
  if (state.currentIndex > 0) {
    footer.appendChild(el('button', { class: 'back-link', text: '← Back', onClick: goBack }));
  }
  if (NO_AUTO_ADVANCE_TYPES.has(q.type)) {
    const label = state.currentIndex === qs.length - 1 ? 'See my results' : 'Continue';
    const btn = el('button', {
      class: 'continue-btn', text: label,
      onClick: goNext,
    });
    btn.disabled = !isAnswered(q) && !q.optional;
    continueBtnRef = btn;
    footer.appendChild(btn);
  } else {
    continueBtnRef = null;
  }
  app.appendChild(footer);
}

// ---------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------

function ballCard(title, entry) {
  const card = el('div', { class: 'result-card' });
  card.appendChild(el('div', { class: 'result-label', text: title }));
  if (!entry) {
    card.appendChild(el('div', { class: 'result-name', text: 'No match found' }));
    return card;
  }
  card.appendChild(el('div', { class: 'result-name', text: entry.ball.name }));
  const price = entry.ball.au.price_aud_per_dozen;
  card.appendChild(el('div', { class: 'result-price', text: price ? `A$${price.toFixed(2)} / dozen` : 'Price unconfirmed' }));
  return card;
}

function finish() {
  app.innerHTML = '<div class="loading">Scoring 48 balls against your answers…</div>';

  // Fill in reasonable defaults for anything left untouched.
  if (!state.answers.priorities.length) {
    state.answers.priorities = ['distance', 'spinControl', 'feel', 'price', 'durability'];
  }
  if (state.answers.feelPreference === null) state.answers.feelPreference = 'dontcare';
  if (state.answers.budget === null) state.answers.budget = 'nolimit';
  if (state.answers.ballsLostPerRound === null) state.answers.ballsLostPerRound = '2-3';

  const main = getRecommendations(state.answers, database);
  const conditionsSet = getConditionsSet(state.answers, database, main);

  // Fire the save in the background — don't make the golfer wait on a
  // network round trip to see results they already have client-side.
  // A failed save (bad config, offline) must never break the results view.
  const submissionSavePromise = saveFittingSubmission(state.answers, main).catch(err => {
    console.error('Submission save failed:', err);
    return null;
  });

  app.innerHTML = '';
  app.appendChild(el('h1', { class: 'prompt', text: 'Your results' }));

  const results = el('div', { class: 'results-grid' });
  results.appendChild(ballCard('Best overall', main.bestOverall));
  results.appendChild(ballCard('Best value', main.bestValue));
  results.appendChild(ballCard('Premium alternative', main.premiumAlternative));
  app.appendChild(results);

  if (main.unverifiedPicks && main.unverifiedPicks.length) {
    app.appendChild(el('h2', { class: 'section-heading', text: 'Also worth a look — unverified' }));
    main.unverifiedPicks.forEach(p => {
      const row = el('div', { class: 'unverified-row' });
      row.appendChild(el('div', { class: 'result-name', text: p.ball.name }));
      row.appendChild(el('div', { class: 'note', text: p.note }));
      app.appendChild(row);
    });
  }

  app.appendChild(el('h2', { class: 'section-heading', text: 'Your conditions set' }));
  const condGrid = el('div', { class: 'results-grid' });
  Object.entries(conditionsSet.picks).forEach(([key, pick]) => {
    condGrid.appendChild(ballCard(pick ? pick.label : key, pick));
  });
  app.appendChild(condGrid);

  app.appendChild(el('div', { class: 'attribution', text: 'Ratings sourced from the MyGolfSpy 2026 Ball Test.' }));

  renderFeedbackWidget(submissionSavePromise);
}

function renderFeedbackWidget(submissionSavePromise) {
  const wrap = el('div', { class: 'feedback-widget' });
  wrap.appendChild(el('h2', { class: 'section-heading', text: 'Does this feel right?' }));

  const options = el('div', { class: 'options' });
  const commentField = el('div', { class: 'field', style: 'display:none;margin-top:12px' });
  commentField.appendChild(el('label', { text: 'Anything you want to add? (optional)' }));
  const commentInput = el('textarea', { rows: '2' });
  commentField.appendChild(commentInput);

  const thanks = el('div', { class: 'feedback-thanks', style: 'display:none', text: 'Thanks — that helps tune this.' });

  let selectedRating = null;
  const ratingButtons = [];

  // One shared submit button, shown once a rating is picked — rather than
  // creating a new one per rating-button click, which would stack up
  // duplicate "Submit feedback" buttons if the tester changed their mind.
  const submitBtn = el('button', {
    class: 'continue-btn', text: 'Submit feedback',
    onClick: async () => {
      submitBtn.disabled = true;
      submitBtn.textContent = 'Sending…';
      const submissionId = await submissionSavePromise;
      await saveFeedback(submissionId, selectedRating, commentInput.value || null);
      wrap.querySelectorAll('button, textarea').forEach(node => node.remove());
      thanks.style.display = 'block';
    },
  });
  submitBtn.style.display = 'none';

  [
    { value: 'yes', label: 'Yes' },
    { value: 'sort_of', label: 'Sort of' },
    { value: 'no', label: 'No' },
  ].forEach(opt => {
    const btn = el('button', {
      class: 'option-btn',
      text: opt.label,
      onClick: () => {
        selectedRating = opt.value;
        ratingButtons.forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
        commentField.style.display = 'flex';
        submitBtn.style.display = 'inline-block';
      },
    });
    ratingButtons.push(btn);
    options.appendChild(btn);
  });

  wrap.appendChild(options);
  wrap.appendChild(commentField);
  wrap.appendChild(submitBtn);
  wrap.appendChild(thanks);
  app.appendChild(wrap);
}

// ---------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------

async function boot() {
  app.innerHTML = '<div class="loading">Loading ball data…</div>';
  const res = await fetch('./ball-database.json');
  database = await res.json();
  render();
}

boot();
