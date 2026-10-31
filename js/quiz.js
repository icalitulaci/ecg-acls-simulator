// Rhythm quiz: flashcards with Anki-style spaced repetition. A random rhythm is shown on a
// full-screen monitor with no labels; reveal the answer, then rate yourself.
import { MonitorView } from './monitor-view.js';
import { RHYTHM_MAP } from './rhythms.js';
import { defaultState } from './state.js';
import { icon, load, store, requestFullscreen, exitFullscreen, fullscreenElement } from './util.js';

const KEY = 'acls-monsim.quiz.v1';
const MIN = 60e3;
const DAY = 864e5;
const LEARN_STEPS = [1, 10]; // minutes
const RELEARN_STEPS = [10]; // minutes
const GRADUATE_DAYS = 1;
const EASY_DAYS = 4;
const LEARN_AHEAD = 20 * MIN; // show learning cards early if nothing else is due

// hr: random rate range, or hrList to pick from. unstable: sometimes shown with low BP.
export const CARDS = [
  { id: 'nsr', rhythm: 'nsr', hr: [62, 98],
    features: 'Regular, rate 60–100, an upright P wave before every QRS, normal PR.',
    acls: 'No treatment needed.' },
  { id: 'sbrady', rhythm: 'sbrady', hr: [34, 54], unstable: true,
    features: 'Regular sinus rhythm under 60/min. Every P wave is followed by a QRS.',
    acls: 'Symptomatic? Bradycardia algorithm.' },
  { id: 'stach', rhythm: 'stach', hr: [106, 150],
    features: 'Regular sinus rhythm over 100/min. P waves can merge into the preceding T wave.',
    acls: 'Find and treat the cause (pain, fever, hypovolaemia, hypoxia…).' },
  { id: 'svt', rhythm: 'svt', hr: [160, 220], unstable: true,
    features: 'Regular narrow-complex tachycardia, usually 150–250/min, P waves not visible.',
    acls: 'Stable: vagal manoeuvres, then adenosine. Unstable: synchronised cardioversion.' },
  { id: 'afib', rhythm: 'afib', hr: [70, 150], unstable: true,
    features: 'Irregularly irregular rhythm, no P waves, wavy fibrillatory baseline.',
    acls: 'Unstable: synchronised cardioversion. Stable: rate control.' },
  { id: 'aflutter', rhythm: 'aflutter', hrList: [75, 100, 150], unstable: true,
    features: 'Sawtooth flutter waves at about 300/min with regular conduction (2:1, 3:1 or 4:1).',
    acls: 'Unstable: synchronised cardioversion. Stable: rate control.' },
  { id: 'junctional', rhythm: 'junctional', hr: [40, 58], unstable: true,
    features: 'Regular narrow QRS at 40–60/min. P waves absent or inverted right next to the QRS.',
    acls: 'Symptomatic? Bradycardia algorithm.' },
  { id: 'avb1', rhythm: 'avb1', hr: [56, 90],
    features: 'Sinus rhythm with a long but constant PR interval (over 0.20 s). Every P conducts.',
    acls: 'Usually benign. Monitor.' },
  { id: 'avb2i', rhythm: 'avb2i', hr: [46, 72],
    features: 'PR interval gets longer and longer until a P wave is not followed by a QRS (grouped beats).',
    acls: 'Usually benign. Symptomatic? Bradycardia algorithm.' },
  { id: 'avb2ii', rhythm: 'avb2ii', hr: [34, 58], unstable: true,
    features: 'Constant PR interval with sudden dropped QRS complexes. QRS often wide.',
    acls: 'Can progress to complete block: prepare for transcutaneous pacing.' },
  { id: 'avb3', rhythm: 'avb3', hr: [28, 44], unstable: true,
    features: 'P waves and QRS complexes march independently (AV dissociation). Slow escape rhythm.',
    acls: 'Symptomatic: transcutaneous pacing. Atropine often doesn’t work.' },
  { id: 'idio', rhythm: 'idio', hr: [26, 44],
    features: 'Slow, regular, wide QRS complexes with no P waves (ventricular escape rhythm).',
    acls: 'Often seen after reperfusion or ROSC. Don’t suppress it.' },
  { id: 'vt', rhythm: 'vt', hr: [150, 210], unstable: true,
    features: 'Regular wide-complex tachycardia, usually over 120/min, no P waves.',
    acls: '' },
  { id: 'torsades', rhythm: 'torsades', hr: [200, 260],
    features: 'Polymorphic VT: the QRS amplitude waxes and wanes, twisting around the baseline.',
    acls: 'Pulseless: defibrillate and CPR. Give magnesium.' },
  { id: 'vf_coarse', rhythm: 'vf_coarse',
    features: 'Chaotic, irregular waveform with no identifiable QRS complexes.',
    acls: 'Cardiac arrest, shockable: defibrillate, CPR, epinephrine, amiodarone.' },
  { id: 'vf_fine', rhythm: 'vf_fine',
    features: 'Low-amplitude chaotic waveform. Easy to mistake for asystole.',
    acls: 'Cardiac arrest, shockable: defibrillate, CPR, epinephrine, amiodarone.' },
  { id: 'asystole', rhythm: 'asystole',
    features: 'Flat line with only slight baseline drift. Check leads and gain.',
    acls: 'Cardiac arrest, non-shockable: CPR, epinephrine as soon as possible.' },
  { id: 'pea', rhythm: 'pea', hr: [40, 90],
    features: 'Organised electrical rhythm but no pulse: no pleth wave and no SpO₂ or BP reading.',
    acls: 'Cardiac arrest, non-shockable: CPR, epinephrine, look for the H’s and T’s.' },
  { id: 'pvc', rhythm: 'nsr', ectopy: 'freq', hr: [66, 92], name: 'Sinus rhythm with PVCs',
    features: 'Early, wide, bizarre QRS complexes with no P wave, followed by a pause.',
    acls: 'Look for a cause (ischaemia, electrolytes). Usually no specific treatment.' },
  { id: 'bigem', rhythm: 'nsr', ectopy: 'bigem', hr: [62, 88], name: 'Ventricular bigeminy',
    features: 'Every other beat is a PVC: normal beat, PVC, normal beat, PVC…',
    acls: 'Look for a cause (ischaemia, electrolytes, drugs).' },
];

const randInt = (a, b) => Math.round(a + Math.random() * (b - a));

// Build a plausible patient for a card.
function scenario(card, beep) {
  const R = RHYTHM_MAP[card.rhythm];
  const s = defaultState();
  s.rhythm = card.rhythm;
  s.ectopy = card.ectopy || 'none';
  s.pulse = R.locked ? false : card.id === 'vt' ? Math.random() < 0.55 : R.pulse !== false;
  if (card.hrList) s.hr = card.hrList[Math.floor(Math.random() * card.hrList.length)];
  else if (card.hr) s.hr = randInt(card.hr[0], card.hr[1]);
  if (!s.pulse) {
    // arrest with CPR and ventilations under way
    Object.assign(s, { spo2: randInt(78, 90), sys: 70, dia: 40, rr: 10, etco2: randInt(9, 20) });
  } else if (card.unstable && Math.random() < 0.5) {
    const sys = randInt(72, 90);
    Object.assign(s, { spo2: randInt(89, 95), sys, dia: Math.round(sys * 0.58), rr: randInt(18, 26), etco2: randInt(27, 34) });
  } else {
    Object.assign(s, { spo2: randInt(95, 99), sys: randInt(108, 138), dia: randInt(64, 84), rr: randInt(12, 18), etco2: randInt(34, 42) });
  }
  s.temp = Math.round((36.4 + Math.random() * 0.8) * 10) / 10;
  s.alarms = false; // alarm banners like "VENT FIB" would give the answer away
  s.sound = { beep, alarm: false };
  return s;
}

function answerFor(card, s) {
  const R = RHYTHM_MAP[card.rhythm];
  let name = card.name || R.name;
  let acls = card.acls;
  if (card.id === 'vt') {
    name = s.pulse ? 'Ventricular tachycardia with a pulse' : 'Pulseless ventricular tachycardia';
    acls = s.pulse
      ? 'Stable: antiarrhythmic, expert consult. Unstable: synchronised cardioversion.'
      : 'Cardiac arrest, shockable: defibrillate, CPR, epinephrine, amiodarone.';
  }
  const onScreen = R.hr
    ? `On screen: HR ${s.hr} · ${s.pulse ? `BP ${s.sys}/${s.dia} · SpO₂ ${s.spo2}%` : 'no pulse'}`
    : 'On screen: no countable rate · no pulse';
  return { name, features: card.features, acls, onScreen };
}

// ---------------------------------------------------------------- scheduling

const newCard = () => ({ state: 'new', step: 0, due: 0, ivl: 0, ease: 2.5, reps: 0, lapses: 0 });

function loadDeck() {
  try {
    const d = JSON.parse(load(KEY) || 'null');
    if (d && typeof d === 'object' && d.cards && typeof d.cards === 'object') return d;
  } catch {
    /* corrupted: start over */
  }
  return { cards: {} };
}

const saveDeck = (d) => store(KEY, JSON.stringify(d));

export function resetQuiz() {
  store(KEY, null);
}

// Returns the card's new scheduling state after a rating (1 Again, 2 Hard, 3 Good, 4 Easy).
export function schedule(prev, rating, now) {
  const c = { ...prev, reps: prev.reps + 1 };
  if (c.state === 'review') {
    const hard = Math.max(c.ivl + 1, Math.round(c.ivl * 1.2));
    const good = Math.max(hard + 1, Math.round(c.ivl * c.ease));
    const easy = Math.max(good + 1, Math.round(c.ivl * c.ease * 1.3));
    if (rating === 1) {
      Object.assign(c, { lapses: c.lapses + 1, ease: Math.max(1.3, c.ease - 0.2), state: 'relearning', step: 0, ivl: 1 });
      c.due = now + RELEARN_STEPS[0] * MIN;
    } else if (rating === 2) {
      Object.assign(c, { ease: Math.max(1.3, c.ease - 0.15), ivl: hard });
      c.due = now + hard * DAY;
    } else if (rating === 3) {
      c.ivl = good;
      c.due = now + good * DAY;
    } else {
      Object.assign(c, { ease: c.ease + 0.15, ivl: easy });
      c.due = now + easy * DAY;
    }
    return c;
  }
  // new / learning / relearning: short steps in minutes
  const relearn = c.state === 'relearning';
  const steps = relearn ? RELEARN_STEPS : LEARN_STEPS;
  if (c.state === 'new') c.state = 'learning';
  const graduate = (days) => {
    Object.assign(c, { state: 'review', step: 0, ivl: days });
    c.due = now + days * DAY;
  };
  if (rating === 1) {
    c.step = 0;
    c.due = now + steps[0] * MIN;
  } else if (rating === 2) {
    const m = c.step === 0 && steps.length > 1 ? (steps[0] + steps[1]) / 2 : steps[c.step] * (steps.length === 1 ? 1.5 : 1);
    c.due = now + m * MIN;
  } else if (rating === 3) {
    if (c.step + 1 < steps.length) {
      c.step++;
      c.due = now + steps[c.step] * MIN;
    } else graduate(relearn ? Math.max(1, c.ivl) : GRADUATE_DAYS);
  } else graduate(relearn ? Math.max(1, c.ivl) + 1 : EASY_DAYS);
  return c;
}

export function fmtInterval(ms) {
  if (ms < 60 * MIN) return `${Math.max(1, Math.round(ms / MIN))}m`;
  if (ms < DAY - 30 * MIN) return `${Math.round(ms / (60 * MIN))}h`;
  if (ms < 30 * DAY) return `${Math.round(ms / DAY)}d`;
  if (ms < 365 * DAY) return `${(ms / (30 * DAY)).toFixed(1)}mo`;
  return `${(ms / (365 * DAY)).toFixed(1)}y`;
}

const isLearning = (s) => s.state === 'learning' || s.state === 'relearning';

export function quizCounts(deck = loadDeck(), now = Date.now()) {
  let fresh = 0, learning = 0, due = 0;
  for (const card of CARDS) {
    const s = deck.cards[card.id] || newCard();
    if (s.state === 'new') fresh++;
    else if (isLearning(s)) learning++;
    else if (s.due <= now) due++;
  }
  return { fresh, learning, due };
}

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Next card: learning cards that are due, then due reviews, then new cards, then learning
// cards a little early. Avoid showing the same card twice in a row when there's a choice.
function pickCard(deck, now, lastId, ahead = false) {
  const all = CARDS.map((card) => ({ card, s: deck.cards[card.id] || newCard() }));
  const byDue = (a, b) => a.s.due - b.s.due;
  const lists = [
    all.filter((e) => isLearning(e.s) && e.s.due <= now).sort(byDue),
    all.filter((e) => e.s.state === 'review' && e.s.due <= now).sort(byDue),
    shuffle(all.filter((e) => e.s.state === 'new')),
    all.filter((e) => isLearning(e.s) && e.s.due <= now + LEARN_AHEAD).sort(byDue),
  ];
  if (ahead) lists.push(all.slice().sort(byDue)); // "review ahead": soonest due, whatever its state
  for (const l of lists) {
    const e = l.find((x) => x.card.id !== lastId);
    if (e) return e;
  }
  for (const l of lists) if (l.length) return l[0];
  return null;
}

// ---------------------------------------------------------------- quiz screen

export function startQuiz({ audio, beep = true, onClose }) {
  const el = document.createElement('div');
  el.className = 'quiz';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', 'Rhythm quiz');
  el.innerHTML = `
    <div class="quiz-stage"></div>
    <div class="quiz-bar">
      <div class="quiz-meta">
        <span class="q-counts"><b class="q-new"></b> new · <b class="q-learn"></b> learning · <b class="q-due"></b> due</span>
        <span class="q-session"></span>
      </div>
      <div class="quiz-front">
        <div class="q-prompt">What's the rhythm?</div>
        <button type="button" class="btn primary big q-show">Show answer <kbd>Space</kbd></button>
      </div>
      <div class="quiz-back" hidden>
        <div class="q-answer">
          <div class="q-name"></div>
          <div class="q-features"></div>
          <div class="q-acls"></div>
          <div class="q-onscreen"></div>
        </div>
        <div class="q-rates">
          <button type="button" class="rate again" data-r="1"><small></small><b>Again</b><kbd>1</kbd></button>
          <button type="button" class="rate hard" data-r="2"><small></small><b>Hard</b><kbd>2</kbd></button>
          <button type="button" class="rate good" data-r="3"><small></small><b>Good</b><kbd>3</kbd></button>
          <button type="button" class="rate easy" data-r="4"><small></small><b>Easy</b><kbd>4</kbd></button>
        </div>
      </div>
      <div class="quiz-done" hidden>
        <div><div class="q-done-title">All caught up</div><div class="q-done-text"></div></div>
        <div class="q-done-btns">
          <button type="button" class="btn primary q-ahead">Keep practising</button>
          <button type="button" class="btn ghost q-finish">Finish</button>
        </div>
      </div>
    </div>`;
  document.body.append(el);
  document.body.classList.add('quiz-open');
  requestFullscreen(el); // must happen inside the click that opened the quiz

  const $ = (s) => el.querySelector(s);
  const view = new MonitorView($('.quiz-stage'), { audio });
  view.el.extra.innerHTML = `
    <button type="button" class="mon-btn q-sound" title="QRS beep"></button>
    <button type="button" class="mon-btn q-exit" title="End quiz">${icon('close')}<span>End quiz</span></button>`;

  let deck = loadDeck();
  let current = null; // { card, s, scenario }
  let revealed = false;
  let lastId = null;
  let beepOn = beep;
  const session = { reviewed: 0, again: 0 };

  function renderSound() {
    const b = $('.q-sound');
    b.innerHTML = icon(beepOn && audio.ready ? 'soundOn' : 'soundOff');
    b.classList.toggle('muted', !(beepOn && audio.ready));
  }

  function renderMeta() {
    const c = quizCounts(deck);
    $('.q-new').textContent = c.fresh;
    $('.q-learn').textContent = c.learning;
    $('.q-due').textContent = c.due;
    $('.q-session').textContent = session.reviewed
      ? `Reviewed ${session.reviewed} · ${Math.round(((session.reviewed - session.again) / session.reviewed) * 100)}% right`
      : '';
  }

  function show(part) {
    $('.quiz-front').hidden = part !== 'front';
    $('.quiz-back').hidden = part !== 'back';
    $('.quiz-done').hidden = part !== 'done';
  }

  function next(ahead = false) {
    const pick = pickCard(deck, Date.now(), lastId, ahead);
    revealed = false;
    if (!pick) {
      const soonest = Math.min(...CARDS.map((c) => (deck.cards[c.id] || newCard()).due));
      $('.q-done-text').textContent = `You've gone through every card that's due. The next one is due in ${fmtInterval(Math.max(0, soonest - Date.now()))}.`;
      show('done');
      renderMeta();
      return;
    }
    const st = scenario(pick.card, beepOn);
    current = { ...pick, scenario: st };
    lastId = pick.card.id;
    view.reset(st);
    show('front');
    renderMeta();
    $('.q-show').focus({ preventScroll: true });
  }

  function reveal() {
    if (!current || revealed) return;
    revealed = true;
    const a = answerFor(current.card, current.scenario);
    $('.q-name').textContent = a.name;
    $('.q-features').textContent = a.features;
    $('.q-acls').textContent = a.acls ? `ACLS: ${a.acls}` : '';
    $('.q-acls').hidden = !a.acls;
    $('.q-onscreen').textContent = a.onScreen;
    const now = Date.now();
    for (const b of el.querySelectorAll('.rate')) {
      const nextState = schedule(current.s, Number(b.dataset.r), now);
      b.querySelector('small').textContent = fmtInterval(nextState.due - now);
    }
    show('back');
    $('.rate.good').focus({ preventScroll: true });
  }

  function rate(r) {
    if (!current || !revealed) return;
    deck.cards[current.card.id] = schedule(current.s, r, Date.now());
    saveDeck(deck);
    session.reviewed++;
    if (r === 1) session.again++;
    next();
  }

  function close() {
    document.removeEventListener('keydown', onKey);
    offAudio();
    view.destroy();
    if (fullscreenElement() === el) exitFullscreen();
    el.remove();
    document.body.classList.remove('quiz-open');
    onClose?.();
  }

  function onKey(e) {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === 'Escape' && !fullscreenElement()) {
      close();
      return;
    }
    if (!$('.quiz-done').hidden) return;
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      if (!revealed) reveal();
      else rate(3);
    } else if (revealed && ['1', '2', '3', '4'].includes(e.key)) {
      e.preventDefault();
      rate(Number(e.key));
    }
  }
  // Leaving browser fullscreen (Esc) keeps the quiz open in the window; ✕ or Esc again closes it.
  const offAudio = audio.onChange(renderSound);
  document.addEventListener('keydown', onKey);
  $('.q-show').addEventListener('click', reveal);
  for (const b of el.querySelectorAll('.rate')) b.addEventListener('click', () => rate(Number(b.dataset.r)));
  $('.q-ahead').addEventListener('click', () => next(true));
  $('.q-finish').addEventListener('click', close);
  $('.q-exit').addEventListener('click', close);
  $('.q-sound').addEventListener('click', () => {
    const wasOn = beepOn && audio.ready;
    audio.unlock(); // the first tap also unlocks sound, so it turns the beep on
    beepOn = !wasOn;
    if (current) {
      current.scenario = { ...current.scenario, sound: { beep: beepOn, alarm: false } };
      view.applyState(current.scenario);
    }
    renderSound();
  });
  el.addEventListener('pointerdown', () => audio.unlock());

  renderSound();
  // Wait a frame so the overlay has its final size before drawing the first strip.
  requestAnimationFrame(() => next());
  return close;
}
