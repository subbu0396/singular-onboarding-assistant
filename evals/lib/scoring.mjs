// Field-by-field scorer for intake extraction.
//
// Each field type has its own similarity metric. A field only counts toward
// the fixture's score when the expected value is defined — undefined in the
// fixture means "don't test this field."
//
// Field-level score is 0..1. Fixture score is the mean of field scores.
// Suite score is the mean of fixture scores, plus per-field averages so we
// can see which fields the model consistently misses.

const ENUM_FIELDS = new Set([
  'targetMmp',
  'currentMmp',
  'industry',
  'primaryMarket',
  'attributionModel',
  'eventTrackingMethod',
  'backendLanguage',
  'authMethod',
  'onboardingUrgency',
]);

const ARRAY_ENUM_FIELDS = new Set([
  'platforms',
  'integrationMethods',
  'dataExportMethods',
]);

const BOOLEAN_FIELDS = new Set(['hasDataWarehouse', 'usesCdp']);
const STRING_FIELDS = new Set(['clientName', 'cdpName']);
const DATE_FIELD = 'targetGoLiveDate';

function scoreEnum(expected, actual) {
  if (expected === null) return actual === null || actual === '' ? 1 : 0;
  if (!actual) return 0;
  return expected === actual ? 1 : 0;
}

function scoreArray(expected, actual) {
  if (!Array.isArray(expected) || !Array.isArray(actual)) return 0;
  if (expected.length === 0) return actual.length === 0 ? 1 : 0;
  const expSet = new Set(expected);
  const actSet = new Set(actual);
  const intersection = [...expSet].filter((x) => actSet.has(x)).length;
  const union = new Set([...expSet, ...actSet]).size;
  return union === 0 ? 1 : intersection / union;
}

function scoreBoolean(expected, actual) {
  if (expected === null) return actual === null ? 1 : 0;
  return expected === actual ? 1 : 0;
}

function scoreString(expected, actual) {
  if (expected === null) return actual === null || actual === '' ? 1 : 0;
  if (typeof actual !== 'string' || !actual) return 0;
  const e = expected.trim().toLowerCase();
  const a = actual.trim().toLowerCase();
  if (e === a) return 1;
  if (a.includes(e) || e.includes(a)) return 0.5;
  return 0;
}

function scoreDate(expected, actual) {
  if (expected === null) return actual === null || actual === '' ? 1 : 0;
  if (typeof actual !== 'string' || !actual) return 0;
  if (expected === actual) return 1;
  const ed = new Date(expected).getTime();
  const ad = new Date(actual).getTime();
  if (Number.isNaN(ed) || Number.isNaN(ad)) return 0;
  const daysApart = Math.abs(ed - ad) / (24 * 60 * 60 * 1000);
  if (daysApart <= 3) return 0.5;
  return 0;
}

export function scoreFixture(expected, actual) {
  const perField = {};
  let sum = 0;
  let count = 0;

  for (const [field, expectedValue] of Object.entries(expected)) {
    if (expectedValue === undefined) continue;
    const actualValue = actual?.[field];

    let score;
    if (field === DATE_FIELD) score = scoreDate(expectedValue, actualValue);
    else if (ENUM_FIELDS.has(field)) score = scoreEnum(expectedValue, actualValue);
    else if (ARRAY_ENUM_FIELDS.has(field)) score = scoreArray(expectedValue, actualValue);
    else if (BOOLEAN_FIELDS.has(field)) score = scoreBoolean(expectedValue, actualValue);
    else if (STRING_FIELDS.has(field)) score = scoreString(expectedValue, actualValue);
    else continue;

    perField[field] = { expected: expectedValue, actual: actualValue ?? null, score };
    sum += score;
    count += 1;
  }

  return {
    overall: count === 0 ? 1 : sum / count,
    fields: perField,
    fieldsTested: count,
  };
}

// Aggregate across all fixtures — mean fixture score, plus a per-field
// average that lets us see "clientName scores 1.0 across all 8 fixtures,
// but targetGoLiveDate averages 0.6."
export function aggregate(results) {
  const perField = {};
  let sum = 0;
  for (const r of results) {
    sum += r.overall;
    for (const [field, info] of Object.entries(r.fields)) {
      if (!perField[field]) perField[field] = { sum: 0, count: 0 };
      perField[field].sum += info.score;
      perField[field].count += 1;
    }
  }
  const perFieldAvg = {};
  for (const [field, { sum: s, count: c }] of Object.entries(perField)) {
    perFieldAvg[field] = { avg: c === 0 ? 0 : s / c, samples: c };
  }
  return {
    overall: results.length === 0 ? 0 : sum / results.length,
    perFieldAvg,
    fixtures: results.length,
  };
}
