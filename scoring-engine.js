/**
 * Golf Ball Fitter — Scoring Engine
 * Implements Step A of the handover doc: maps the 19 questionnaire answers
 * to the MyGolfSpy-derived ball ratings and produces best overall / best
 * value / premium alternative picks.
 *
 * Locked decisions this code implements (see Project Setup + Step A chat):
 *  - Carry is the scoring metric for driver & 7-iron at every speed band
 *    (Total is display-only, per the Mid-band-total-groupings-are-weak override).
 *  - 105-115mph swing speed uses the pre-computed "blend" band in the
 *    database (average of Mid+Fast, ties round up).
 *  - Durability (Q14) and Colour (Q17) have NO data source yet — they are
 *    wired up as no-op placeholders so the app doesn't silently misbehave;
 *    they do nothing until real data is added.
 *  - Balls played well before (Q10) are NEVER used for scoring.
 */

// ---------------------------------------------------------------------
// 1. Speed band selection (Q1)
// ---------------------------------------------------------------------

/** @returns {'slow'|'mid'|'blend'|'fast'} */
function getSpeedBand(swingSpeedBand) {
  switch (swingSpeedBand) {
    case 'under85':
    case '85-95':
      return 'slow';
    case '95-105':
      return 'mid';
    case '105-115':
      return 'blend';
    case '115+':
      return 'fast';
    default:
      // Q1 = "don't know" — caller should have already estimated a band
      // from Q2 (carry distance) before reaching here.
      return 'mid';
  }
}

/**
 * Q2 fallback: rough carry-distance-to-swing-speed-band mapping when the
 * golfer doesn't know their swing speed. Bands are wide on purpose —
 * this is a fallback, not a measurement.
 */
function estimateBandFromCarryMetres(carryM) {
  if (carryM < 180) return 'slow';   // under 85 / 85-95 mph territory
  if (carryM < 220) return 'mid';    // 95-105 mph
  if (carryM < 245) return 'blend';  // 105-115 mph
  return 'fast';                     // 115+ mph
}

// ---------------------------------------------------------------------
// 2. Category weights from Q14 (ranked priorities) — the master weight-setter
// ---------------------------------------------------------------------

const CATEGORIES = ['distance', 'spinControl', 'feel', 'price', 'durability'];

/**
 * Q14: golfer ranks 5 categories best-to-worst. Rank 1 (most important)
 * gets weight 5, rank 5 (least important) gets weight 1, then normalized
 * to sum to 1.0. Durability has no data yet, so its weight is computed
 * but has nothing to multiply against (see scoreBall) — ranking it highly
 * currently has no effect. This is a known placeholder, not a bug.
 */
function computeCategoryWeights(priorities) {
  const weights = {};
  priorities.forEach((cat, index) => {
    weights[cat] = 5 - index; // rank 0 (1st) -> 5, rank 4 (5th) -> 1
  });
  const total = Object.values(weights).reduce((a, b) => a + b, 0);
  for (const cat of CATEGORIES) {
    weights[cat] = (weights[cat] || 0) / total;
  }
  return weights;
}

// ---------------------------------------------------------------------
// 3. Driver spin preference (Q6 miss pattern, overridden by Q7 launch monitor)
// ---------------------------------------------------------------------

/** @returns {'low'|'high'|'neutral'} preferred direction on driver spin RATING (1-5) */
function driverSpinPreference(answers) {
  // Q7 overrides Q6 when real numbers are supplied.
  if (answers.launchMonitor && typeof answers.launchMonitor.driverSpin === 'number') {
    const spin = answers.launchMonitor.driverSpin;
    if (spin > 2800) return 'low';   // golfer already spins it a lot -> wants a low-spin ball
    if (spin < 2200) return 'high';  // golfer spins it very little -> more spin is safe/beneficial
    return 'neutral';
  }
  switch (answers.missPattern) {
    case 'hook':
    case 'slice':
    case 'both':
      return 'low'; // curving misses -> lower driver spin helps
    default:
      return 'neutral'; // push/pull/thinfat/none -> no spin-direction signal
  }
}

// ---------------------------------------------------------------------
// 4. Greenside spin importance (Q12 frequency x Q13 style)
// ---------------------------------------------------------------------

/** @returns {number} 0-1 multiplier for how much wedge/iron spin should count */
function greensideSpinImportance(answers) {
  const freqWeight = { few: 0.3, some: 0.6, lots: 1.0 }[answers.greensideFrequency] ?? 0.5;
  const styleWeight = { bumprun: 0.4, mix: 0.7, flopcheck: 1.0 }[answers.shortGameStyle] ?? 0.6;
  return (freqWeight + styleWeight) / 2;
}

// ---------------------------------------------------------------------
// 5. Feel matching (Q11 firm-to-soft scale vs ball compression)
// ---------------------------------------------------------------------

/**
 * Q11 is a 1 (firm) to 5 (soft) scale, or 'dontcare'.
 * Compression in the database is a raw number (roughly 45-105 in this field).
 * We map the golfer's 1-5 preference onto that range and score balls by
 * closeness — closer compression = higher feel score.
 */
function feelScore(ball, answers) {
  if (!answers.feelPreference || answers.feelPreference === 'dontcare') return 0.5; // neutral
  const prefToCompression = { 1: 100, 2: 90, 3: 80, 4: 65, 5: 50 }; // 1=firm..5=soft
  const target = prefToCompression[answers.feelPreference] ?? 80;
  const diff = Math.abs(ball.compression - target);
  // Closer = better. Normalize: diff of 0 -> 1.0, diff of 50+ -> 0.
  return Math.max(0, 1 - diff / 50);
}

// ---------------------------------------------------------------------
// 6. Trajectory preference (Q4 ball flight + Q8 conditions)
// ---------------------------------------------------------------------

/** @returns {'higher'|'lower'|'neutral'} preferred direction on height/descent RATING */
function trajectoryPreference(answers) {
  let pref = 'neutral';
  if (answers.ballFlight === 'low') pref = 'higher';   // low natural flight -> wants a higher-flighting ball
  if (answers.ballFlight === 'high') pref = 'lower';    // high natural flight -> wants a flatter ball

  const tags = (answers.conditions && answers.conditions.tags) || [];
  if (tags.includes('wind') || tags.includes('firm')) {
    // Wind and firm/fast conditions both favour a flatter, roll-out trajectory,
    // regardless of the golfer's natural flight. Conditions take priority here
    // because they're about scoring well on the course, not personal preference.
    pref = 'lower';
  }
  return pref;
}

// ---------------------------------------------------------------------
// 7. AU availability + budget + brand filters
// ---------------------------------------------------------------------

const BUDGET_CEILING_AUD = { under40: 40, '40-60': 60, '60-80': 80, nolimit: Infinity };

function passesFilters(ball, answers) {
  if (ball.au.availability_status === 'not_available') return false;

  if (answers.brandsToAvoid && answers.brandsToAvoid.length) {
    const nameLower = ball.name.toLowerCase();
    if (answers.brandsToAvoid.some(b => nameLower.includes(b.toLowerCase()))) return false;
  }

  // Q17 colour filter: NO DATA YET. Deliberately not enforced — see colour_field
  // placeholder in the database. Enforcing "white only" against unknown colour
  // data would incorrectly exclude balls we simply haven't tagged.

  const ceiling = BUDGET_CEILING_AUD[answers.budget] ?? Infinity;
  if (ball.au.price_aud_per_dozen !== null && ball.au.price_aud_per_dozen > ceiling) {
    return false;
  }
  // Balls with no confirmed AU price are NOT excluded by budget — we can't
  // filter on a price we don't have. They're just not eligible for the
  // "best value" slot (see pickBestValue), which needs a real number.

  return true;
}

// ---------------------------------------------------------------------
// 8. Core per-ball score
// ---------------------------------------------------------------------

/**
 * @param {Object} overrides - Used only by the conditions-based ball sets
 *   (Step A.4) to temporarily force a trajectory/spin preference that
 *   overrides the golfer's own Q4/Q6/Q8 answers — e.g. "flatter descent"
 *   for windy links regardless of the golfer's natural ball flight.
 *   Leave empty for normal personal-fit scoring.
 */
function scoreBall(ball, answers, weights, speedBand, overrides = {}) {
  const driverBand = ball.driver[speedBand];
  const ironBand = ball.iron7[speedBand === 'blend' ? 'blend' : speedBand];

  // --- Distance component: driver Carry rating at the selected speed band ---
  const distanceScore = driverBand.carry / 5; // normalize 1-5 -> 0.2-1.0

  // --- Spin control component ---
  // Driver spin direction preference (curving misses / launch monitor),
  // or a conditions-set override (e.g. "low" for windy/dry links):
  const spinPref = overrides.driverSpinPrefOverride || driverSpinPreference(answers);
  let driverSpinScore = 0.5; // neutral
  if (spinPref === 'low') driverSpinScore = 1 - (driverBand.spin_rating - 1) / 4; // reward LOW rating
  if (spinPref === 'high') driverSpinScore = (driverBand.spin_rating - 1) / 4;    // reward HIGH rating

  // Greenside spin (7-iron + wedge full-wedge dry as the representative wedge condition).
  // A conditions-set override ('high', for wet parkland) forces reward-high-spin
  // directly instead of weighting it by the golfer's own Q12/Q13 frequency answers.
  const wedgeDry = ball.wedge.dry;
  const rawGreensideSpinScore = ((ironBand.spin_rating - 1) / 4) * 0.5 + ((wedgeDry.spin_rating - 1) / 4) * 0.5;
  let spinControlScore;
  if (overrides.greensideSpinPrefOverride === 'high') {
    spinControlScore = (driverSpinScore * 0.5) + (rawGreensideSpinScore * 0.5);
  } else {
    const greensideWeight = greensideSpinImportance(answers);
    spinControlScore = (driverSpinScore * 0.5) + (rawGreensideSpinScore * greensideWeight * 0.5);
  }

  // --- Feel component ---
  const feelComponentScore = feelScore(ball, answers);

  // --- Trajectory nudge (folded into distance/feel rather than its own
  //     top-level category, since Q14 doesn't rank "trajectory" separately) ---
  const trajPref = overrides.trajectoryPrefOverride || trajectoryPreference(answers);
  let trajectoryAdjustment = 0;
  if (trajPref === 'higher') trajectoryAdjustment = (driverBand.height - 3) / 20; // small nudge, +/-0.1 max
  if (trajPref === 'lower') trajectoryAdjustment = (3 - driverBand.height) / 20;

  // --- Wedge wet-spin-kept bonus (conditions-set only, for wet parkland) ---
  let wetSpinBonus = 0;
  if (overrides.wedgeWetSpinBoost && ball.wedge.wet_spin_kept_rating != null) {
    wetSpinBonus = ((ball.wedge.wet_spin_kept_rating - 1) / 4) * 0.15; // small dedicated bonus
  }

  // --- Price component: cheaper = higher score, relative to budget ceiling ---
  const ceiling = BUDGET_CEILING_AUD[answers.budget] ?? 90;
  const effectiveCeiling = ceiling === Infinity ? 90 : ceiling;
  let priceScore = 0.5; // unknown price -> neutral, don't punish or reward
  if (ball.au.price_aud_per_dozen !== null) {
    priceScore = Math.max(0, 1 - ball.au.price_aud_per_dozen / effectiveCeiling);
  }
  // Q16: heavy ball-losers get an extra price weight push regardless of Q14 ranking.
  const lossPushMultiplier = { '0-1': 1.0, '2-3': 1.15, '4+': 1.35 }[answers.ballsLostPerRound] ?? 1.0;

  // --- Durability: NO DATA — weight computed but multiplies against nothing. ---
  const durabilityScore = 0; // placeholder; contributes 0 regardless of Q14 rank until data exists

  // --- Weighted composite ---
  let total =
    weights.distance * distanceScore +
    weights.spinControl * spinControlScore +
    weights.feel * feelComponentScore +
    weights.price * priceScore * lossPushMultiplier +
    weights.durability * durabilityScore +
    trajectoryAdjustment +
    wetSpinBonus;

  // --- Q19 loyalty tie-break: small bonus only, applied last ---
  if (answers.loyalBrand && ball.name.toLowerCase().includes(answers.loyalBrand.toLowerCase())) {
    total += 0.02; // deliberately tiny — "small tie-break bonus only" per spec
  }

  return {
    total,
    breakdown: { distanceScore, spinControlScore, feelComponentScore, priceScore, trajectoryAdjustment },
  };
}

// ---------------------------------------------------------------------
// 9. Recommendations: best overall / best value / premium alternative
// ---------------------------------------------------------------------

/**
 * "Concretely buyable" = confirmed AU availability AND a confirmed current
 * price. A ball with unconfirmed price or only "limited" availability can
 * still fit the golfer's data extremely well — it just can't headline a
 * recommendation slot the golfer would expect to be able to walk up and buy.
 */
function isConcretelyBuyable(ball) {
  return ball.au.availability_status === 'available' && ball.au.price_aud_per_dozen !== null;
}

/**
 * How close (as a fraction of the top buyable score) an unverified ball
 * must score to be worth surfacing as an "also fits, but unverified" pick.
 * Deliberately generous (0.85) — the point is not to hide a good fit,
 * only to keep it out of the confident top-3 slots.
 */
const UNVERIFIED_SURFACE_THRESHOLD = 0.85;
const UNVERIFIED_MAX_PICKS = 3;

function getRecommendations(answers, database) {
  const speedBand =
    answers.swingSpeedBand === 'dontknow'
      ? estimateBandFromCarryMetres(answers.carryDistanceM)
      : getSpeedBand(answers.swingSpeedBand);

  const weights = computeCategoryWeights(answers.priorities);

  const eligible = Object.values(database.balls).filter(b => passesFilters(b, answers));

  const scored = eligible
    .map(ball => ({ ball, ...scoreBall(ball, answers, weights, speedBand) }))
    .sort((a, b) => b.total - a.total);

  if (scored.length === 0) {
    return {
      speedBand, weights,
      bestOverall: null, bestValue: null, premiumAlternative: null,
      unverifiedPicks: [], scored: [],
    };
  }

  // Top recommendation slots draw ONLY from concretely-buyable balls.
  const buyable = scored.filter(s => isConcretelyBuyable(s.ball));

  const bestOverall = buyable[0] || null;

  // Best value: among buyable balls scoring reasonably well (within 20% of
  // the top buyable score), the cheapest — not just the cheapest ball overall.
  let bestValue = null;
  let bestValueCandidates = [];
  if (buyable.length) {
    const valueThreshold = bestOverall.total * 0.8;
    bestValueCandidates = buyable
      .slice()
      .sort((a, b) => {
        const aQualifies = a.total >= valueThreshold;
        const bQualifies = b.total >= valueThreshold;
        if (aQualifies !== bQualifies) return aQualifies ? -1 : 1;
        return a.ball.au.price_aud_per_dozen - b.ball.au.price_aud_per_dozen;
      });
    bestValue = bestValueCandidates[0] || null;
  }

  // Premium alternative: best buyable ball priced above the golfer's ceiling
  // (or simply the 2nd-best buyable pick when budget is "no limit").
  // NOTE: `scored`/`buyable` were built from `eligible`, which already
  // excludes anything over the golfer's budget ceiling — so searching
  // "above ceiling" within `buyable` would always come up empty. This
  // recomputes a separate, budget-unrestricted pool just for this search.
  let premiumAlternative = null;
  let premiumCandidates = [];
  if (answers.budget !== 'nolimit') {
    const ceiling = BUDGET_CEILING_AUD[answers.budget];
    const unrestrictedAnswers = { ...answers, budget: 'nolimit' };
    premiumCandidates = Object.values(database.balls)
      .filter(b => passesFilters(b, unrestrictedAnswers))
      .filter(b => isConcretelyBuyable(b) && b.au.price_aud_per_dozen > ceiling)
      .map(ball => ({ ball, ...scoreBall(ball, answers, weights, speedBand) }))
      .sort((a, b) => b.total - a.total);
    premiumAlternative = premiumCandidates[0] || null;
  } else {
    premiumCandidates = buyable.slice(1);
    premiumAlternative = premiumCandidates[0] || null;
  }

  // Unverified-but-fits picks: balls that scored close to the top buyable
  // score but got excluded from the headline slots purely for lacking a
  // confirmed price and/or availability status. Surfaced separately with
  // a caveat, never silently dropped.
  const buyableNames = new Set(buyable.map(s => s.ball.name));
  const referenceScore = bestOverall ? bestOverall.total : scored[0].total;
  const unverifiedPicks = scored
    .filter(s => !buyableNames.has(s.ball.name))
    .filter(s => s.total >= referenceScore * UNVERIFIED_SURFACE_THRESHOLD)
    .slice(0, UNVERIFIED_MAX_PICKS)
    .map(s => ({
      ...s,
      note:
        s.ball.au.availability_status === 'limited'
          ? `Fits your profile well based on the test data, but Australian availability is limited or unconfirmed for this ball — verify stock with the retailer before buying.`
          : `Fits your profile well based on the test data, but we don't have a confirmed current Australian price for this ball — verify the price yourself before buying.`,
    }));

  // Close-call comparisons, per headline slot, using each slot's own
  // candidate ordering (buyable-by-score for Best Overall, value-sorted
  // for Best Value, above-ceiling-by-score for Premium Alternative).
  const wedgeBandForComparison = 'dry'; // matches the representative wedge condition used in scoreBall
  const qualifyingValueCandidates = bestValueCandidates.filter(
    c => bestOverall && c.total >= bestOverall.total * 0.8
  );
  const closeCalls = {
    bestOverall: attachCloseCall(buyable, speedBand, wedgeBandForComparison),
    bestValue: attachValueCloseCall(qualifyingValueCandidates, speedBand, wedgeBandForComparison),
    premiumAlternative: attachCloseCall(premiumCandidates, speedBand, wedgeBandForComparison),
  };

  return { speedBand, weights, bestOverall, bestValue, premiumAlternative, unverifiedPicks, closeCalls, scored };
}

// ---------------------------------------------------------------------
// 10. Close-call side-by-side display (Step A.3)
// ---------------------------------------------------------------------
//
// Uses MyGolfSpy's own top/bottom statistical groupings (pre-parsed into
// each band's `flags` object) to decide whether two candidate balls are
// genuinely separated on a metric or just "close enough to call a tie."
// This never changes which ball wins the score — it only controls whether
// the UI is allowed to present a confident #1 vs #2, or must show "≈
// statistically tied" instead.

const CLUB_METRIC_CODES = {
  driver: ['Sp', 'C', 'T', 'D', 'K'],
  iron7: ['Sp', 'C', 'D', 'K'],
  wedge: ['Sp', 'C', 'D', 'K'],
};

const METRIC_LABELS = {
  Sp: 'Ball speed',
  C: 'Carry',
  T: 'Total distance',
  D: 'Dispersion (accuracy)',
  K: 'Consistency (carry distance)',
};

const RATING_KEY_MAP = { Sp: 'speed', C: 'carry', T: 'total', D: 'dispersion', K: 'consistency' };

function getSignal(ball, clubType, band, code) {
  const bandData = ball[clubType] && ball[clubType][band];
  if (!bandData || !bandData.flags) return 'none';
  return bandData.flags[code] || 'none';
}

/**
 * The entire A.3 truth table collapses to one rule: two balls are tied on
 * a metric whenever they carry the SAME signal (both top, both bottom, or
 * both none/no-signal) — any mismatch means MyGolfSpy's own grouping
 * separates them, so the score order stands.
 */
function compareMetricSignals(ballA, ballB, clubType, band, code) {
  const sigA = getSignal(ballA, clubType, band, code);
  const sigB = getSignal(ballB, clubType, band, code);
  return sigA === sigB ? 'tied' : 'separated';
}

/**
 * Full side-by-side comparison across every metric with grouping data.
 * driverIronBand: 'slow'|'mid'|'blend'|'fast' (the golfer's own speed band).
 * wedgeBand: '35y'|'dry'|'wet' — currently always 'dry' from getRecommendations,
 * matching the representative wedge condition used in scoreBall itself.
 */
function buildCloseCallComparison(ballA, ballB, driverIronBand, wedgeBand) {
  const rows = [];
  for (const [clubType, codes] of Object.entries(CLUB_METRIC_CODES)) {
    const band = clubType === 'wedge' ? wedgeBand : driverIronBand;
    for (const code of codes) {
      const ratingKey = RATING_KEY_MAP[code];
      const bandDataA = ballA[clubType] && ballA[clubType][band];
      const bandDataB = ballB[clubType] && ballB[clubType][band];
      const ratingA = bandDataA ? (bandDataA[ratingKey] ?? null) : null;
      const ratingB = bandDataB ? (bandDataB[ratingKey] ?? null) : null;
      rows.push({
        club: clubType,
        metric: METRIC_LABELS[code],
        result: compareMetricSignals(ballA, ballB, clubType, band, code),
        ballA_rating: ratingA,
        ballB_rating: ratingB,
        // Driver ball speed was never given a 1-5 rating in the source data
        // (only 7-iron was) — the top/bottom SIGNAL is still real and used,
        // but there's no rating number to display alongside it.
        no_rating_data: ratingA === null && ratingB === null,
      });
    }
  }
  return rows;
}

/**
 * How close two candidates' scores must be (as a fraction of the leader's
 * score) before we bother building a close-call comparison at all. This
 * number wasn't specified numerically in the original design discussion —
 * 5% is a reasonable, adjustable default: close enough that a confident
 * #1/#2 ranking would be overstating the difference.
 */
const CLOSE_CALL_SCORE_GAP_FRACTION = 0.05;

function attachCloseCall(candidateList, driverIronBand, wedgeBand) {
  if (!candidateList || candidateList.length < 2) return null;
  const [first, second] = candidateList;
  if (!first || !second || first.total === 0) return null;
  const gap = (first.total - second.total) / first.total;
  if (gap > CLOSE_CALL_SCORE_GAP_FRACTION) return null;
  return {
    ballA: first.ball.name,
    ballB: second.ball.name,
    scoreGapFraction: gap,
    comparison: buildCloseCallComparison(first.ball, second.ball, driverIronBand, wedgeBand),
  };
}

/**
 * Best Value is ranked by PRICE among qualifying balls, not by score — so
 * its close-call check has to compare price gap, not score gap. Using
 * attachCloseCall (score-based) here would occasionally produce a nonsense
 * negative "gap" when the 2nd-cheapest ball happens to score higher than
 * the cheapest. threshold: how much more expensive the runner-up can be
 * (as a fraction of the cheapest's price) and still count as "basically
 * the same value pick" — 15% is a disclosed, adjustable default.
 */
const CLOSE_CALL_VALUE_PRICE_GAP_FRACTION = 0.15;

function attachValueCloseCall(qualifyingCandidates, driverIronBand, wedgeBand) {
  if (!qualifyingCandidates || qualifyingCandidates.length < 2) return null;
  const [first, second] = qualifyingCandidates;
  const priceA = first.ball.au.price_aud_per_dozen;
  const priceB = second.ball.au.price_aud_per_dozen;
  if (priceA == null || priceB == null || priceA === 0) return null;
  const gap = (priceB - priceA) / priceA;
  if (gap > CLOSE_CALL_VALUE_PRICE_GAP_FRACTION) return null;
  return {
    ballA: first.ball.name,
    ballB: second.ball.name,
    priceGapFraction: gap,
    comparison: buildCloseCallComparison(first.ball, second.ball, driverIronBand, wedgeBand),
  };
}

// ---------------------------------------------------------------------
// 11. Conditions-based ball sets (Step A.4)
// ---------------------------------------------------------------------
// 5-6 balls per golfer, each suited to a different playing condition —
// not just one "best overall" pick. Windy links and dry WA links share
// identical override logic (flatter descent, lower driver spin); this was
// accepted as-is per the working session, since nothing in the extracted
// MyGolfSpy data distinguishes wind resistance from dry-firm conditions
// any further.

const CONDITIONS_CONFIG = {
  windyLinks: {
    label: 'Windy links (e.g. Tasmania)',
    q8Tag: 'wind',
    overrides: { trajectoryPrefOverride: 'lower', driverSpinPrefOverride: 'low' },
  },
  wetParkland: {
    label: 'Wet parkland',
    q8Tag: 'wet',
    overrides: { trajectoryPrefOverride: 'higher', greensideSpinPrefOverride: 'high', wedgeWetSpinBoost: true },
  },
  dryWALinks: {
    label: 'Dry summer links (Western Australia)',
    q8Tag: 'heat', // Q8's tag options don't include a dedicated "dry" tag — 'heat' is
                    // the closest fit. Disclosed assumption, not locked down earlier.
    overrides: { trajectoryPrefOverride: 'lower', driverSpinPrefOverride: 'low' },
  },
  firmSandbelt: {
    label: 'Firm Sandbelt (Melbourne)',
    q8Tag: 'firm',
    overrides: { trajectoryPrefOverride: 'lower' },
  },
};

/**
 * @param {Object} mainRecommendations - the result of getRecommendations()
 *   for this same golfer, so a condition matching the golfer's own Q8
 *   answer can simply reuse their Best Overall pick instead of computing
 *   a redundant duplicate (per A.4 point 4).
 */
function getConditionsSet(answers, database, mainRecommendations) {
  const speedBand =
    answers.swingSpeedBand === 'dontknow'
      ? estimateBandFromCarryMetres(answers.carryDistanceM)
      : getSpeedBand(answers.swingSpeedBand);

  const weights = computeCategoryWeights(answers.priorities);
  const golferTags = (answers.conditions && answers.conditions.tags) || [];

  const buyableEligible = Object.values(database.balls).filter(
    b => passesFilters(b, answers) && isConcretelyBuyable(b)
  );

  const usedNames = new Set();
  const picks = {};

  for (const [key, config] of Object.entries(CONDITIONS_CONFIG)) {
    if (golferTags.includes(config.q8Tag) && mainRecommendations && mainRecommendations.bestOverall) {
      // Golfer already plays in these conditions — their main pick already
      // covers this slot, no need for a separate computed recommendation.
      // Still marked as "used" so later independently-computed conditions
      // don't redundantly re-pick the same ball — the point of the set is
      // covering DIFFERENT conditions with different balls where possible.
      const reused = mainRecommendations.bestOverall;
      usedNames.add(reused.ball.name);
      picks[key] = { ...reused, label: config.label, matchesGolferConditions: true, verified: true };
      continue;
    }

    const pool = buyableEligible.filter(b => !usedNames.has(b.name));
    const scoredPool = pool
      .map(ball => ({ ball, ...scoreBall(ball, answers, weights, speedBand, config.overrides) }))
      .sort((a, b) => b.total - a.total);

    let pick = scoredPool[0] || null;
    let verified = true;

    if (!pick) {
      // Fallback: every buyable ball already used elsewhere — allow a
      // non-buyable (unconfirmed price/limited) ball rather than leaving
      // the slot empty, clearly flagged as unverified.
      const fallbackPool = Object.values(database.balls).filter(
        b => passesFilters(b, answers) && !usedNames.has(b.name)
      );
      const fallbackScored = fallbackPool
        .map(ball => ({ ball, ...scoreBall(ball, answers, weights, speedBand, config.overrides) }))
        .sort((a, b) => b.total - a.total);
      pick = fallbackScored[0] || null;
      verified = false;
    }

    if (pick) {
      usedNames.add(pick.ball.name);
      picks[key] = { ...pick, label: config.label, matchesGolferConditions: false, verified };
    } else {
      picks[key] = null;
    }
  }

  return { speedBand, picks };
}

export {
  getSpeedBand,
  estimateBandFromCarryMetres,
  computeCategoryWeights,
  driverSpinPreference,
  greensideSpinImportance,
  feelScore,
  trajectoryPreference,
  passesFilters,
  scoreBall,
  getRecommendations,
  getConditionsSet,
};
