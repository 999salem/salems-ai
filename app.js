(() => {
  const $ = (s, root = document) => root.querySelector(s);
  const $$ = (s, root = document) => [...root.querySelectorAll(s)];
  const money = n => new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD', maximumFractionDigits: 0 }).format(Number(n || 0));
  const nowTime = () => new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  let state;
  let currentModule = null;
  let toastTimer = null;
  let lastSubmitText = '';
  let lastSubmitAt = 0;

  const moduleMeta = {
    finance: { title: 'Finance', subtitle: 'Savings, cards, bills and money decisions' },
    work: { title: 'Harry & Sons', subtitle: 'Shifts, shop tasks and social content' },
    people: { title: 'People', subtitle: 'Family, work, friends, clients and follow-ups' },
    '999salem': { title: '999salem', subtitle: 'Minecraft, streaming and content' },
    barber: { title: 'Marcus X Barber', subtitle: 'Personal barber brand and content' },
    fitness: { title: 'Training', subtitle: 'Beginner calisthenics and consistency' },
    marvel: { title: 'Marvel Database', subtitle: 'Reading progress, lists and theories' },
    reminders: { title: 'Reminders', subtitle: 'Finance, work, fitness and personal' }
  };

  document.addEventListener('DOMContentLoaded', () => {
    // Release the boot screen independently of application initialization.
    // A bad local cache/database state should never leave the app stuck on the logo.
    const boot = $('#boot');
    setTimeout(() => boot?.classList.add('hidden'), 1100);
    init().catch(error => {
      console.error('[S.A.L.E.M.] initialization error', error);
      boot?.classList.add('hidden');
      const status = $('#salStateText');
      if (status) status.textContent = 'LOCAL SYSTEM RECOVERY MODE';
      const db = $('#dbStatus');
      if (db) db.textContent = 'RETRY NEEDED';
    });
  });

  async function init() {
    state = await SalemDB.get();
    seedWelcomeIfNeeded();
    bindUI();
    renderAll();
    updateNetwork();
    window.addEventListener('online', updateNetwork);
    window.addEventListener('offline', updateNetwork);
    registerServiceWorker();
    handleLaunchParams();
  }

  function handleLaunchParams() {
    const params = new URLSearchParams(location.search);
    const view = params.get('view');
    const action = params.get('action');
    if (view && ['home','chat','modules','insights','profile'].includes(view)) setTimeout(() => navigate(view), 0);
    if (action === 'status') setTimeout(() => { navigate('chat'); handleMessage('SAL status'); }, 80);
    if (params.has('view') || params.has('action') || params.has('source')) {
      const clean = `${location.pathname}${location.hash || ''}`;
      history.replaceState({}, '', clean);
    }
  }

  function seedWelcomeIfNeeded() {
    if (!state.chat?.length) {
      state.chat = [{
        role: 'assistant',
        text: `Welcome back, ${state.profile?.name || 'Marcus'}. I have your finances, schedule, work and projects ready. What are we handling?`,
        time: nowTime()
      }];
      SalemDB.set(state);
    }
  }

  function bindUI() {
    $$('.nav-btn').forEach(btn => btn.addEventListener('click', () => navigate(btn.dataset.nav)));
    $('#settingsBtn').addEventListener('click', () => navigate('profile'));
    $('#clearChatBtn').addEventListener('click', clearChat);

    bindComposer('#chatForm', '#chatInput');
    bindComposer('#chatFormFull', '#chatInputFull');
    $('#micBtn').addEventListener('click', () => startVoice($('#chatInput')));
    $('#micBtnFull').addEventListener('click', () => startVoice($('#chatInputFull')));

    $$('.suggestions button').forEach(b => b.addEventListener('click', () => handleMessage(b.dataset.prompt)));
    $$('[data-action]').forEach(b => b.addEventListener('click', () => handleAction(b.dataset.action)));
    $$('[data-open-module]').forEach(b => b.addEventListener('click', () => openModule(b.dataset.openModule)));

    $('#backToModules').addEventListener('click', () => navigate('modules'));
    $('#saveSettingsBtn').addEventListener('click', saveSettings);
    $('#exportBtn').addEventListener('click', exportData);
    $('#importInput').addEventListener('change', importData);
  }

  function bindComposer(formSelector, inputSelector) {
    const form = $(formSelector);
    const input = $(inputSelector);
    if (!form || !input) return;
    const send = form.querySelector('.composer__send');

    const fire = () => submitInput(input);
    form.addEventListener('submit', e => {
      e.preventDefault();
      fire();
    });

    // iOS can use the first tap to dismiss/focus the keyboard instead of submitting.
    // Handling pointer-down makes the first physical tap send immediately; the
    // duplicate guard in submitInput prevents the following submit event firing twice.
    send?.addEventListener('pointerdown', e => {
      if (e.pointerType === 'touch' || e.pointerType === 'pen') {
        e.preventDefault();
        fire();
      }
    });

    input.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        fire();
      }
    });
  }

  function navigate(view) {
    $$('.view').forEach(v => v.classList.remove('view--active'));
    const target = $(`[data-view="${view}"]`);
    if (target) target.classList.add('view--active');
    $$('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.nav === view));
    if (view === 'modules') renderModules();
    if (view === 'insights') renderInsights();
    if (view === 'profile') renderProfile();
    if (view === 'chat') renderChats();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function handleAction(action) {
    const map = {
      'sal-status': 'SAL status',
      'plan-day': 'Plan my day',
      'money-check': 'Give me a money check'
    };
    if (action === 'voice') return startVoice($('#chatInput'));
    if (map[action]) {
      navigate('chat');
      handleMessage(map[action]);
    }
  }

  async function submitInput(input) {
    const text = input.value.trim();
    if (!text) return;

    const now = Date.now();
    if (text === lastSubmitText && now - lastSubmitAt < 900) return;
    lastSubmitText = text;
    lastSubmitAt = now;

    input.value = '';
    await handleMessage(text);
  }

  async function handleMessage(text) {
    addChat('user', text);
    setCoreState('thinking', 'PROCESSING');
    renderChats();

    const googleQuery = extractGoogleQuery(text);
    if (googleQuery) {
      if (!navigator.onLine) {
        addChat('assistant', 'Network offline. I can still use your local S.A.L.E.M. data, but live search needs a connection.');
        setCoreState('offline', 'NETWORK OFFLINE');
        renderAll();
        return;
      }

      // If the user is asking for news and a Cloudflare relay is configured,
      // keep the result inside S.A.L.E.M. instead of launching Google.
      if (state.profile?.backendUrl && isNewsQuery(googleQuery)) {
        setCoreState('searching', 'CHECKING LIVE NEWS');
        try {
          const reply = await askNewsRelay(googleQuery);
          addChat('assistant', reply.answer || 'I found live news.', Array.isArray(reply.sources) ? reply.sources : []);
          setCoreState('idle', 'LIVE NEWS READY');
        } catch (err) {
          addChat('assistant', 'I could not reach the live news relay. Your local systems are still online.');
          setCoreState('idle', 'LOCAL SYSTEMS ONLINE');
        }
        renderAll();
        return;
      }

      // Generic no-key searches still open Google because a browser-only app
      // cannot safely read arbitrary Google result pages.
      const url = googleSearchURL(googleQuery);
      const opened = window.open(url, '_blank', 'noopener,noreferrer');
      addChat('assistant', `I opened Google for “${googleQuery}”. ${opened ? '' : 'Tap the source below if iOS blocked the new tab.'}`.trim(), [
        { title: `Google — ${googleQuery}`, url }
      ]);
      setCoreState('idle', 'GOOGLE SEARCH READY');
      renderAll();
      return;
    }

    const local = await runLocalCommand(text);
    if (local.handled) {
      await delay(180);
      addChat('assistant', local.reply);
      setCoreState('idle', navigator.onLine ? 'ONLINE • ALL SYSTEMS NOMINAL' : 'NETWORK OFFLINE');
      renderAll();
      if (state.settings?.voice && local.speak) speak(local.reply);
      return;
    }

    const currentInfo = needsLiveInfo(text);
    if (currentInfo && !navigator.onLine) {
      addChat('assistant', `Network unavailable. I can answer from your saved information, but I can't verify current information right now.`);
      setCoreState('offline', 'NETWORK OFFLINE');
      renderAll();
      return;
    }

    if (state.profile?.backendUrl && isNewsQuery(text)) {
      setCoreState('searching', 'CHECKING LIVE NEWS');
      try {
        const reply = await askNewsRelay(text);
        addChat('assistant', reply.answer || 'I found live news.', Array.isArray(reply.sources) ? reply.sources : []);
        setCoreState('idle', 'LIVE NEWS READY');
        renderAll();
      } catch (err) {
        addChat('assistant', 'I could not reach the live news relay. Check the Worker URL in Profile and try again.');
        setCoreState('idle', 'LOCAL SYSTEMS ONLINE');
        renderAll();
      }
      return;
    }

    if (state.profile?.backendUrl) {
      setCoreState(currentInfo ? 'searching' : 'thinking', currentInfo ? 'SEARCHING NETWORK' : 'PROCESSING');
      try {
        const reply = await askBackend(text, currentInfo);
        if (Array.isArray(reply.actions) && reply.actions.length) await applyBackendActions(reply.actions);
        const answerText = reply.answer || reply.text || 'Response received.';
        const sources = Array.isArray(reply.sources) ? reply.sources.slice(0, 8) : [];
        addChat('assistant', answerText, sources);
        setCoreState('idle', 'ONLINE • ALL SYSTEMS NOMINAL');
        renderAll();
      } catch (err) {
        addChat('assistant', `AI connection unavailable. Local systems are still operational. ${err.message ? 'The backend returned an error.' : ''}`);
        setCoreState('idle', 'LOCAL SYSTEMS ONLINE');
        renderAll();
      }
    } else {
      if (navigator.onLine) {
        const url = googleSearchURL(text);
        const reply = currentInfo
          ? `I don't have a live AI backend connected, but Google search is available without an API key. Tap the Google source below, or say “Search Google for …” and I'll open it automatically.`
          : `That isn't in my local S.A.L.E.M. data. I can still hand the question to Google without an API key. Tap the source below, or say “Search Google for …” to open it automatically.`;
        addChat('assistant', reply, [{ title: `Google — ${text}`, url }]);
        setCoreState('idle', 'GOOGLE SEARCH READY');
      } else {
        addChat('assistant', `Network offline. I can still answer from your saved S.A.L.E.M. data, but Google search needs a connection.`);
        setCoreState('offline', 'NETWORK OFFLINE');
      }
      renderAll();
    }
  }

  async function runLocalCommand(raw) {
    const t = raw.toLowerCase().trim();

    if (/^(sal\s*)?status\b|sal status/.test(t)) {
      return { handled: true, reply: buildSalStatus(), speak: true };
    }

    if (/how much.*sav|what.*sav|check my savings/.test(t)) {
      const gap = Math.max(0, state.finance.savingsFloor - state.finance.savings);
      return { handled: true, reply: `You currently have ${money(state.finance.savings)} saved. Your minimum target is ${money(state.finance.savingsFloor)}, so you're ${money(gap)} below the floor.` };
    }

    if (/money check|financial status|check my money/.test(t)) {
      const used = state.finance.cards.reduce((sum, card) => sum + card.balance, 0);
      const limit = state.finance.cards.reduce((sum, card) => sum + card.limit, 0);
      const gap = Math.max(0, state.finance.savingsFloor - state.finance.savings);
      const due = state.finance.bills.filter(b => b.status !== 'paid').map(b => `${b.name}${b.amount ? ` ${money(b.amount)}` : ''}`).join(', ');
      return { handled: true, reply: `Money check: ${money(state.finance.savings)} saved, ${money(gap)} below your ${money(state.finance.savingsFloor)} floor. Credit used is ${money(used)} of ${money(limit)}. ${due ? `Open priorities: ${due}.` : 'No unpaid bills are currently saved.'}` };
    }

    let m = t.match(/(?:set|update) my savings (?:to )?\$?([\d,.]+)/);
    if (m) {
      state.finance.savings = parseMoney(m[1]);
      await persist();
      const gap = Math.max(0, state.finance.savingsFloor - state.finance.savings);
      return { handled: true, reply: `Savings updated to ${money(state.finance.savings)}. You're now ${money(gap)} below your ${money(state.finance.savingsFloor)} floor.` };
    }

    m = t.match(/(?:set|update) (?:my )?savings (?:floor|minimum) (?:to )?\$?([\d,.]+)/);
    if (m) {
      state.finance.savingsFloor = parseMoney(m[1]);
      await persist();
      const gap = Math.max(0, state.finance.savingsFloor - state.finance.savings);
      return { handled: true, reply: `Savings floor updated to ${money(state.finance.savingsFloor)}. Current gap: ${money(gap)}.` };
    }

    m = t.match(/(?:set|update) (?:my )?cash (?:to )?\$?([\d,.]+)/);
    if (m) {
      state.finance.cash = parseMoney(m[1]);
      await persist();
      return { handled: true, reply: `Cash updated to ${money(state.finance.cash)}.` };
    }

    m = t.match(/(?:i got paid|log my paycheque|paycheque)\s*\$?([\d,.]+)/);
    if (m) {
      const amt = parseMoney(m[1]);
      state.finance.paycheque = amt;
      await persist();
      return { handled: true, reply: `Paycheque logged at ${money(amt)}. Tell me where you want it allocated and I'll update the relevant balances.` };
    }

    m = t.match(/(?:set|update) (?:credit )?card\s*(1|one|2|two) (?:to )?\$?([\d,.]+)/);
    if (m) {
      const idx = ['1','one'].includes(m[1]) ? 0 : 1;
      state.finance.cards[idx].balance = parseMoney(m[2]);
      await persist();
      return { handled: true, reply: `${state.finance.cards[idx].name} updated to ${money(state.finance.cards[idx].balance)} used.` };
    }

    if (/paid insurance|insurance is paid|resolve insurance/.test(t)) {
      const bill = state.finance.bills.find(b => b.id === 'insurance');
      if (bill) bill.status = 'paid';
      const r = state.reminders.find(r => r.id === 'insurance-reminder');
      if (r) r.done = true;
      await persist();
      return { handled: true, reply: `Insurance marked paid. Financial priority cleared.` };
    }

    if (/bills.*coming|upcoming bills|what bills/.test(t)) {
      const due = state.finance.bills.filter(b => b.status !== 'paid');
      const lines = due.map(b => `${b.name}${b.amount ? ` — ${money(b.amount)}` : ''} (${b.due})`).join('; ');
      return { handled: true, reply: due.length ? `Coming up: ${lines}.` : `You don't have any unpaid bills saved.` };
    }

    if (/can i afford/.test(t)) {
      m = t.match(/\$?([\d,.]+)/);
      if (!m) return { handled: true, reply: `Give me the price and I'll compare it against your savings floor and current priorities.` };
      const price = parseMoney(m[1]);
      const after = state.finance.savings - price;
      const insuranceDue = state.finance.bills.some(b => b.id === 'insurance' && b.status !== 'paid');
      const verdict = after >= state.finance.savingsFloor && !insuranceDue
        ? `Yes. Spending ${money(price)} would leave ${money(after)} in savings, still above your floor.`
        : `You technically can, but I wouldn't call it a clean buy. ${insuranceDue ? 'Insurance still needs attention, and ' : ''}spending ${money(price)} from savings would leave ${money(after)}, below your ${money(state.finance.savingsFloor)} floor.`;
      return { handled: true, reply: verdict };
    }

    if (/next shift|when do i work|work tomorrow|shift tomorrow|shift today|today.*shift|what(?:'s| is) my shift today/.test(t)) {
      return { handled: true, reply: getNextShiftReply(/tomorrow/.test(t) ? 1 : 0) };
    }

    if (/plan my day|what.*doing today|today.*plan/.test(t)) {
      return { handled: true, reply: buildDayPlan() };
    }

    if (/what should i do tonight|what should i do next|recommended next/.test(t)) {
      const insuranceDue = state.finance.bills.some(b => b.id === 'insurance' && b.status !== 'paid');
      return { handled: true, reply: insuranceDue ? `Insurance first. Then you've earned some Minecraft.` : `Your money is calmer. Pick one useful task, then give 999salem some time.` };
    }

    if (/next workout|today.*workout|what is my workout/.test(t)) {
      const ex = state.fitness.exercises.map(x => `${x.name} ${x.sets}`).join(', ');
      return { handled: true, reply: `${state.fitness.planName}: ${ex}. Use Start Workout in Training when you want the exercise-by-exercise flow.` };
    }

    if (/next exercise|next set/.test(t) && Number.isInteger(state.fitness.activeExercise)) {
      state.fitness.activeExercise += 1;
      if (state.fitness.activeExercise >= state.fitness.exercises.length) {
        state.fitness.activeExercise = null;
        state.fitness.completedThisWeek = Math.min(state.fitness.weeklyTarget, state.fitness.completedThisWeek + 1);
        state.fitness.lastWorkout = new Date().toISOString();
        await persist();
        return { handled: true, reply: `Workout complete. You're at ${state.fitness.completedThisWeek}/${state.fitness.weeklyTarget} sessions this week.` };
      }
      const ex = state.fitness.exercises[state.fitness.activeExercise];
      await persist();
      return { handled: true, reply: `Next: ${ex.name} — ${ex.sets}. Tell me “next exercise” when you're done.` };
    }

    if (/finished my workout|complete.*workout|workout done/.test(t)) {
      state.fitness.completedThisWeek = Math.min(state.fitness.weeklyTarget, state.fitness.completedThisWeek + 1);
      state.fitness.lastWorkout = new Date().toISOString();
      await persist();
      return { handled: true, reply: `Workout logged. You're at ${state.fitness.completedThisWeek}/${state.fitness.weeklyTarget} sessions this week.` };
    }

    m = raw.match(/(?:finished|completed|read)\s+(.+?#\s*\d+)/i);
    if (m) {
      const title = m[1].trim();
      if (!state.marvel.completed.includes(title)) state.marvel.completed.push(title);
      state.marvel.currentIssue = title;
      await persist();
      return { handled: true, reply: `${title} marked completed in the Marvel Database.` };
    }

    if (/marvel.*read.*next|what.*marvel.*read|mutant.*reading order|mutant.*roadmap|reading order.*mutant|after secret wars/.test(t)) {
      return { handled: true, reply: `For your next mutant-focused path: House of M → Messiah Complex → Messiah War → Second Coming → Schism → Avengers vs. X-Men → House of X / Powers of X. I can also Google a more detailed issue-by-issue order if you ask.` };
    }

    if (/marvel progress|what.*reading|continue reading/.test(t)) {
      return { handled: true, reply: `Marvel Database: current marker is “${state.marvel.currentIssue}”. Your tracked lists are ${state.marvel.lists.join(', ')}.` };
    }

    if (/999salem|minecraft tasks|stream plan/.test(t)) {
      return { handled: true, reply: `999salem active projects: ${state.projects['999salem'].tasks.join(', ')}.` };
    }

    m = raw.match(/remind me to (?:talk to|ask) (dad|uncle) about (.+)/i);
    if (m) {
      const who = m[1].toLowerCase();
      const title = `${m[1][0].toUpperCase()+m[1].slice(1)} — ${m[2].trim()}`;
      const person = state.people.find(p => p.id === who);
      if (person) person.openItems.push(m[2].trim());
      state.reminders.unshift({ id: uid(), title, category: 'personal', priority: 'normal', due: 'Unscheduled', done: false });
      await persist();
      return { handled: true, reply: `Added that follow-up for ${m[1].toLowerCase()}.` };
    }

    m = raw.match(/add (?:a )?note about (dad|uncle)[:,-]?\s*(.+)/i);
    if (m) {
      const person = state.people.find(p => p.id === m[1].toLowerCase());
      if (person) person.notes.push(m[2].trim());
      await persist();
      return { handled: true, reply: `Note added for ${m[1].toLowerCase()}.` };
    }

    if (/who do i need to follow up with|follow-?ups/.test(t)) {
      const items = state.people.filter(p => p.openItems?.length).map(p => `${p.name}: ${p.openItems.join(', ')}`);
      return { handled: true, reply: items.length ? `Open follow-ups: ${items.join('; ')}.` : `You don't have any saved people follow-ups.` };
    }

    m = raw.match(/remind me to (.+)/i);
    if (m) {
      const title = m[1].trim();
      state.reminders.unshift({ id: uid(), title, category: 'personal', priority: 'normal', due: 'Unscheduled', done: false });
      await persist();
      return { handled: true, reply: `Added to S.A.L.E.M. reminders: “${title}”.` };
    }

    if (/who do i need to follow up with|people follow.?ups|follow.?ups/.test(t)) {
      const people = state.people.filter(p => Array.isArray(p.openItems) && p.openItems.length);
      return { handled: true, reply: people.length ? `People follow-ups: ${people.map(p => `${p.name}: ${p.openItems.join(', ')}`).join('; ')}.` : `You don't have any person-specific follow-ups saved right now.` };
    }

    if (/show reminders|what.*reminders/.test(t)) {
      const list = state.reminders.filter(r => !r.done).slice(0, 6);
      return { handled: true, reply: list.length ? `Open reminders: ${list.map(r => `${r.title} — ${r.due}`).join('; ')}.` : `No open reminders.` };
    }

    return { handled: false };
  }

  function extractGoogleQuery(raw) {
    const text = String(raw || '').trim();
    const patterns = [
      /^search\s+(?:google|the web|online)\s+(?:for\s+)?(.+)$/i,
      /^google\s+(.+)$/i,
      /^look\s+up\s+(.+?)\s+(?:on\s+google|online)$/i,
      /^find\s+(.+?)\s+(?:on\s+google|online)$/i
    ];
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match?.[1]?.trim()) return match[1].trim();
    }
    return '';
  }

  function googleSearchURL(query) {
    return `https://www.google.com/search?q=${encodeURIComponent(String(query || '').trim())}`;
  }

  function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function needsLiveInfo(t) {
    return /\b(today|latest|current|right now|recent|this week|news|weather|score|price|near me|upcoming|next release|search|look up|find online|internet)\b/i.test(t);
  }

  function isNewsQuery(text) {
    return /\b(news|headlines|latest|recent|today|this week|what(?:'s| is) new|updates?)\b/i.test(String(text || ''));
  }

  async function askNewsRelay(query) {
    const base = state.profile.backendUrl.replace(/\/$/, '');
    const res = await fetch(`${base}/api/news?q=${encodeURIComponent(String(query || '').trim())}`, {
      method: 'GET',
      headers: { 'Accept': 'application/json' }
    });
    if (!res.ok) throw new Error(`News relay ${res.status}`);
    return res.json();
  }

  async function askBackend(message, live) {
    const base = state.profile.backendUrl.replace(/\/$/, '');
    const payload = {
      message,
      live,
      context: buildBackendContext(),
      conversation: state.chat.slice(-12)
    };
    const res = await fetch(`${base}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!res.ok) throw new Error(`Backend ${res.status}`);
    return res.json();
  }

  async function applyBackendActions(actions) {
    for (const action of actions) {
      if (!action || typeof action.type !== 'string') continue;
      if (action.type === 'updateSavings' && Number.isFinite(Number(action.value))) state.finance.savings = Number(action.value);
      if (action.type === 'updateSavingsFloor' && Number.isFinite(Number(action.value))) state.finance.savingsFloor = Number(action.value);
      if (action.type === 'updateCreditCard') {
        const idx = Number(action.cardIndex ?? 0);
        if (state.finance.cards[idx] && Number.isFinite(Number(action.value))) state.finance.cards[idx].balance = Number(action.value);
      }
      if (action.type === 'completeBill') {
        const bill = state.finance.bills.find(b => b.id === action.id || b.name.toLowerCase() === String(action.name || '').toLowerCase());
        if (bill) bill.status = 'paid';
      }
      if (action.type === 'createReminder' && action.title) {
        state.reminders.unshift({ id: globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : String(Date.now()), title: String(action.title), category: action.category || 'personal', priority: action.priority || 'normal', due: action.due || 'Unscheduled', done: false });
      }
      if (action.type === 'completeWorkout') {
        state.fitness.completedThisWeek = Math.min(state.fitness.weeklyTarget, state.fitness.completedThisWeek + 1);
        state.fitness.lastWorkout = new Date().toISOString();
        state.fitness.activeExercise = null;
      }
      if (action.type === 'updateMarvelProgress' && action.issue) state.marvel.currentIssue = String(action.issue);
    }
    await persist();
  }

  function buildBackendContext() {
    return {
      profile: state.profile,
      finance: state.finance,
      work: state.work,
      fitness: { planName: state.fitness.planName, completedThisWeek: state.fitness.completedThisWeek },
      marvel: state.marvel,
      reminders: state.reminders.filter(r => !r.done),
      projects: state.projects
    };
  }

  function addChat(role, text, sources = []) {
    state.chat.push({ role, text, time: nowTime(), sources: Array.isArray(sources) ? sources : [] });
    if (state.chat.length > 80) state.chat = state.chat.slice(-80);
    SalemDB.set(state);
  }

  async function clearChat() {
    state.chat = [];
    seedWelcomeIfNeeded();
    await persist();
    renderChats();
  }

  function renderAll() {
    renderHeader();
    renderGlance();
    renderFinance();
    renderToday();
    renderChats();
    renderModules();
    renderInsights();
    renderProfile();
    renderSystemStatus();
    if (currentModule) renderModuleDetail(currentModule);
  }

  function renderHeader() {
    const hour = new Date().getHours();
    const part = hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening';
    $('#greetingText').textContent = `Good ${part}, ${state.profile?.name || 'Marcus'}.`;
    const lines = ['Everything’s under control.', 'Your move.', 'Local systems standing by.', 'Ready when you are.'];
    const line = $('#heroLine');
    if (line) line.textContent = lines[Math.floor((Date.now()/3600000)) % lines.length];
  }

  function renderGlance() {
    const gap = Math.max(0, state.finance.savingsFloor - state.finance.savings);
    if ($('#glanceSavings')) $('#glanceSavings').textContent = gap ? money(gap) : 'ON TARGET';
    const open = state.reminders.filter(r => !r.done).length;
    if ($('#glanceReminders')) $('#glanceReminders').textContent = String(open);
    const shift = getNextShiftData();
    if ($('#glanceShift')) $('#glanceShift').textContent = shift ? `${compactTime(shift.start)}–${compactTime(shift.end)}` : '—';
  }

  function renderFinance() {
    $('#savingsMetric').textContent = money(state.finance.savings);
    $('#savingsFloorMetric').textContent = money(state.finance.savingsFloor);
    const used = state.finance.cards.reduce((s,c)=>s+c.balance,0);
    const lim = state.finance.cards.reduce((s,c)=>s+c.limit,0);
    $('#creditMetric').textContent = `${money(used)} / ${money(lim)}`;
    $('#savingsProgress').style.width = `${Math.min(100, state.finance.savings / state.finance.savingsFloor * 100)}%`;
    const urgent = state.finance.bills.find(b => b.status !== 'paid' && b.priority === 'urgent');
    $('#priorityMetric').textContent = urgent ? `${urgent.name}${urgent.amount ? ` — ${money(urgent.amount)}` : ''}` : 'No urgent bill';
    $('#financeStatusDot')?.classList.toggle('warn', !!urgent || state.finance.savings < state.finance.savingsFloor);
    $('#financeStatusDot')?.classList.toggle('good', !urgent && state.finance.savings >= state.finance.savingsFloor);
  }

  function renderToday() {
    const date = new Date();
    $('#todayDate').textContent = date.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' });
    const items = getTodayItems();
    $('#todayTimeline').innerHTML = items.length ? items.map(x => `
      <div class="timeline-item"><i></i><time>${escapeHTML(x.time)}</time><b>${escapeHTML(x.title)}</b></div>`).join('') :
      `<div class="timeline-item"><i></i><time>—</time><b>No scheduled shift saved today.</b></div>`;
  }

  function getTodayItems() {
    const d = new Date();
    const sched = state.work.schedule[d.getDay()];
    const items = [];
    if (sched) items.push({ time: sched.start, title: `Harry & Sons — ${sched.start}–${sched.end}` });
    const openReminder = state.reminders.find(r => !r.done && r.priority === 'urgent');
    if (openReminder) items.push({ time: 'Priority', title: openReminder.title });
    if (state.fitness.completedThisWeek < state.fitness.weeklyTarget) items.push({ time: 'Later', title: 'Workout available' });
    return items.slice(0,5);
  }

  function renderChats() {
    const html = state.chat.map(m => {
      const sources = Array.isArray(m.sources) && m.sources.length ? `<div class="source-links"><span>SOURCES</span>${m.sources.map((src, i) => {
        const url = safeURL(src.url);
        if (!url) return '';
        return `<a href="${escapeHTML(url)}" target="_blank" rel="noopener noreferrer">${i + 1}. ${escapeHTML(src.title || new URL(url).hostname)}</a>`;
      }).join('')}</div>` : '';
      return `<div class="msg ${m.role === 'user' ? 'msg--user' : ''}"><div class="bubble">${formatText(m.text)}${sources}<small>${m.role === 'user' ? 'You' : 'S.A.L.E.M.'} • ${escapeHTML(m.time || '')}</small></div></div>`;
    }).join('');
    ['chatLog','chatLogFull'].forEach(id => {
      const el = document.getElementById(id);
      if (!el) return;
      el.innerHTML = html;
      el.scrollTop = el.scrollHeight;
    });
  }

  function renderSystemStatus() {
    $('#dbStatus').textContent = 'READY';
    $('#aiStatus').textContent = state.profile?.backendUrl ? 'LIVE RELAY' : 'LOCAL MODE';
    $('#searchStatus').textContent = !navigator.onLine ? 'OFFLINE' : (state.profile?.backendUrl ? 'NEWS READY' : 'GOOGLE READY');
    $('#voiceStatus').textContent = ('speechSynthesis' in window) ? 'READY' : 'LIMITED';
    if ($('#pwaStatus')) $('#pwaStatus').textContent = 'serviceWorker' in navigator ? (isStandalone() ? 'INSTALLED' : 'READY') : 'LIMITED';
  }

  function renderModules() {
    const el = $('#moduleList');
    if (!el) return;
    el.innerHTML = Object.entries(moduleMeta).map(([key,m]) => `<button class="module-tile" data-module="${key}"><span>${key.toUpperCase()}</span><h3>${m.title}</h3><p>${m.subtitle}</p></button>`).join('');
    $$('.module-tile', el).forEach(b => b.addEventListener('click', () => openModule(b.dataset.module)));
  }

  function openModule(key) {
    currentModule = key;
    renderModuleDetail(key);
    navigate('module-detail');
  }

  function renderModuleDetail(key) {
    const target = $('#moduleDetail');
    if (!target) return;
    const meta = moduleMeta[key] || { title:key, subtitle:'' };
    let body = '';
    if (key === 'finance') body = financeModule();
    if (key === 'work') body = workModule();
    if (key === 'people') body = peopleModule();
    if (key === '999salem') body = projectModule('999salem');
    if (key === 'barber') body = projectModule('barber');
    if (key === 'fitness') body = fitnessModule();
    if (key === 'marvel') body = marvelModule();
    if (key === 'reminders') body = remindersModule();
    target.innerHTML = `<section class="panel"><div class="module-hero"><div class="panel__kicker">MODULE</div><h2>${meta.title}</h2><p>${meta.subtitle}</p></div>${body}</section>`;
    bindModuleActions(key, target);
  }

  function financeModule() {
    const used = state.finance.cards.reduce((s,c)=>s+c.balance,0), lim=state.finance.cards.reduce((s,c)=>s+c.limit,0);
    return `<div class="data-list">
      ${row('Savings', money(state.finance.savings))}${row('Savings floor', money(state.finance.savingsFloor))}${row('Cash', money(state.finance.cash))}${row('Credit used', `${money(used)} / ${money(lim)}`)}${state.finance.bills.map(b=>row(b.name, `${b.amount?money(b.amount)+' • ':''}${b.status} • ${b.due}`)).join('')}
    </div>
    <div class="inline-edit"><input id="financeSavingsInput" type="number" inputmode="decimal" placeholder="New savings amount"><button data-mod-action="set-savings">Update</button></div>
    <div class="module-actions"><button data-chat="Can I afford $100?">Affordability</button><button data-chat="What bills are coming?">Upcoming Bills</button><button data-chat="SAL status">SAL Status</button></div>`;
  }

  function workModule() {
    const days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    return `<div class="data-list">${row('Employer', state.work.employer)}${row('Role', state.work.role)}${row('Locations', state.work.locations.join(' / '))}${Object.entries(state.work.schedule).map(([d,s])=>row(days[d], `${s.start}–${s.end}${s.note?` • ${s.note}`:''}`)).join('')}</div><div class="module-actions"><button data-chat="What is my next shift?">Next Shift</button><button data-chat="Write a Harry & Sons Instagram caption">Write Post</button><button data-chat="What should I post for Harry & Sons?">Content Ideas</button></div>`;
  }

  function peopleModule() {
    return `<div class="data-list">${state.people.map(p=>row(p.name, `${p.context}${p.openItems.length?` • ${p.openItems.length} open`:''}`)).join('')}</div><div class="module-actions"><button data-chat="Who do I need to follow up with?">Follow-ups</button><button data-chat="Remind me to talk to Dad about ">Add Dad Reminder</button></div>`;
  }

  function projectModule(key) {
    const p = state.projects[key];
    return `<div class="data-list">${row('Project', p.title)}${row('Focus', p.subtitle)}${p.tasks.map((t,i)=>row(`Task ${i+1}`, t)).join('')}</div><div class="module-actions">${key==='999salem'?'<button data-chat="Give me my 999salem Minecraft tasks">Minecraft Tasks</button><button data-chat="Make me a stream plan">Stream Plan</button><button data-chat="Give me a build idea">Build Idea</button>':'<button data-chat="Give me a Marcus X Barber post idea">Post Idea</button><button data-chat="Write me a barber caption">Write Caption</button>'}</div>`;
  }

  function fitnessModule() {
    const active = Number.isInteger(state.fitness.activeExercise) ? state.fitness.exercises[state.fitness.activeExercise] : null;
    const activeBox = active ? `<div class="workout-active"><span>ACTIVE WORKOUT • ${state.fitness.activeExercise + 1}/${state.fitness.exercises.length}</span><h3>${escapeHTML(active.name)}</h3><p>${escapeHTML(active.sets)}</p><button data-mod-action="next-exercise">Next Exercise</button></div>` : '';
    return `${activeBox}<div class="data-list">${row('Plan', state.fitness.planName)}${row('This week', `${state.fitness.completedThisWeek}/${state.fitness.weeklyTarget} workouts`)}${state.fitness.exercises.map(e=>row(e.name,e.sets)).join('')}</div><div class="module-actions"><button data-mod-action="start-workout">Start Workout</button><button data-chat="I finished my workout">Complete Workout</button><button data-chat="What is my next workout?">Today's Workout</button></div>`;
  }

  function marvelModule() {
    return `<div class="data-list">${row('Current marker', state.marvel.currentIssue)}${row('Lists', state.marvel.lists.join(' • '))}${row('Completed tracked', String(state.marvel.completed.length))}</div><div class="inline-edit"><input id="marvelIssueInput" placeholder="e.g. Fantastic Four #570"><button data-mod-action="set-marvel">Set Current</button></div><div class="module-actions"><button data-chat="Continue reading">Continue Reading</button><button data-chat="What is happening with Marvel today?">Live Marvel News</button><button data-chat="Help me with a Doomsday theory">Doomsday Theory</button></div>`;
  }

  function remindersModule() {
    const open = state.reminders.filter(r=>!r.done);
    const list = open.length ? open.map(r=>`<div class="reminder-item"><div><small>${escapeHTML(r.category.toUpperCase())} • ${escapeHTML(r.due)}</small><b>${escapeHTML(r.title)}</b></div><button data-reminder-done="${escapeHTML(r.id)}">Done</button></div>`).join('') : row('Status','No open reminders');
    return `<div class="data-list">${list}</div><div class="inline-edit"><input id="reminderInput" placeholder="New reminder"><button data-mod-action="add-reminder">Add</button></div>`;
  }

  function bindModuleActions(key, root) {
    $$('[data-chat]', root).forEach(b => b.addEventListener('click', () => {
      navigate('chat');
      const preset = b.dataset.chat;
      $('#chatInputFull').value = preset;
      if (!preset.endsWith(' ')) handleMessage(preset); else $('#chatInputFull').focus();
    }));
    $$('[data-mod-action]', root).forEach(b => b.addEventListener('click', async () => {
      const a = b.dataset.modAction;
      if (a === 'set-savings') {
        const v = Number($('#financeSavingsInput').value);
        if (Number.isFinite(v)) await handleMessage(`Set my savings to ${v}`);
      }
      if (a === 'set-marvel') {
        const v = $('#marvelIssueInput').value.trim();
        if (v) { state.marvel.currentIssue = v; await persist(); renderAll(); }
      }
      if (a === 'add-reminder') {
        const v = $('#reminderInput').value.trim();
        if (v) await handleMessage(`Remind me to ${v}`);
      }
      if (a === 'start-workout') startWorkoutFlow();
      if (a === 'next-exercise') await handleMessage('next exercise');
    }));
    $$('[data-reminder-done]', root).forEach(b => b.addEventListener('click', async () => {
      const r = state.reminders.find(x => x.id === b.dataset.reminderDone);
      if (r) { r.done = true; await persist(); renderAll(); showToast('Reminder completed.'); }
    }));
  }

  async function startWorkoutFlow() {
    navigate('chat');
    const first = state.fitness.exercises[0];
    addChat('assistant', `Workout started. First: ${first.name} — ${first.sets}. Complete that, then tell me “next exercise.”`);
    state.fitness.activeExercise = 0;
    await persist();
    renderAll();
  }

  function renderInsights() {
    const target = $('#insightsList');
    if (!target) return;
    const used = state.finance.cards.reduce((s,c)=>s+c.balance,0), lim=state.finance.cards.reduce((s,c)=>s+c.limit,0);
    const gap = Math.max(0,state.finance.savingsFloor-state.finance.savings);
    const insights = [
      ['Savings floor', gap ? `${money(gap)} to go before you reach your minimum.` : `You're at or above your minimum savings floor.`],
      ['Credit usage', `${Math.round(used/lim*100)}% of your tracked credit limits are currently used.`],
      ['Training', `${state.fitness.completedThisWeek}/${state.fitness.weeklyTarget} workouts logged this week.`],
      ['Projects', `999salem and Marcus X Barber are active in your local dashboard.`],
      ['Marvel', `${state.marvel.completed.length} tracked reading items marked completed.`]
    ];
    target.innerHTML = insights.map(([h,p])=>`<article class="panel"><div class="module-hero"><div class="panel__kicker">INSIGHT</div><h3>${h}</h3><p>${p}</p></div></article>`).join('');
  }

  function renderProfile() {
    $('#backendUrlInput').value = state.profile?.backendUrl || '';
    $('#userNameInput').value = state.profile?.name || 'Marcus';
  }

  async function saveSettings() {
    state.profile.backendUrl = $('#backendUrlInput').value.trim();
    state.profile.name = $('#userNameInput').value.trim() || 'Marcus';
    await persist();
    renderAll();
    addChat('assistant', `Settings saved. ${state.profile.backendUrl ? 'Live connection configured. News can now appear inside S.A.L.E.M.' : 'Running in local mode.'}`);
    renderChats();
  }

  function exportData() {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `SALEM-backup-${new Date().toISOString().slice(0,10)}.json`;
    a.click();
    setTimeout(()=>URL.revokeObjectURL(url),500);
  }

  async function importData(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      if (!parsed.finance || !parsed.profile || !parsed.meta) throw new Error('Invalid backup');
      state = parsed;
      await SalemDB.set(state);
      renderAll();
      addChat('assistant', 'S.A.L.E.M. backup imported successfully.');
      renderChats();
    } catch {
      alert('That does not look like a valid S.A.L.E.M. backup.');
    }
    e.target.value = '';
  }

  function isStandalone() {
    return window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true;
  }

  function isIOS() {
    return /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  }

  function showToast(message) {
    const el = $('#toast');
    if (!el) return;
    clearTimeout(toastTimer);
    el.textContent = message;
    el.classList.add('show');
    toastTimer = setTimeout(() => el.classList.remove('show'), 2400);
  }

  function updateNetwork() {
    const online = navigator.onLine;
    $('#networkStatus').textContent = online ? 'ONLINE' : 'OFFLINE';
    setCoreState(online ? 'idle' : 'offline', online ? (state?.profile?.backendUrl ? 'ONLINE • ALL SYSTEMS NOMINAL' : 'LOCAL MODE • NETWORK READY') : 'NETWORK OFFLINE');
    renderSystemStatus();
  }

  function setCoreState(mode, label) {
    const core = $('#heroCore');
    if (core) core.dataset.state = mode;
    if ($('#salStateText')) $('#salStateText').textContent = label;
  }

  function startVoice(targetInput) {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      addChat('assistant', 'Voice recognition is not available in this browser. Text input is still ready.');
      renderChats();
      return;
    }
    const rec = new SR();
    rec.lang = 'en-CA';
    rec.interimResults = false;
    rec.maxAlternatives = 1;
    setCoreState('listening', 'LISTENING');
    rec.onresult = e => { targetInput.value = e.results[0][0].transcript; submitInput(targetInput); };
    rec.onerror = () => setCoreState('idle','VOICE INPUT ENDED');
    rec.onend = () => { if ($('#heroCore')?.dataset.state === 'listening') setCoreState('idle','ONLINE • ALL SYSTEMS NOMINAL'); };
    rec.start();
  }

  function speak(text) {
    if (!('speechSynthesis' in window)) return;
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text.replace(/\n/g,' '));
    const voices = speechSynthesis.getVoices();
    u.voice = voices.find(v => /en-GB/i.test(v.lang) && /male|daniel|arthur/i.test(v.name)) || voices.find(v => /en-GB/i.test(v.lang)) || null;
    u.rate = .97; u.pitch = .93;
    u.onstart = () => setCoreState('speaking','SPEAKING');
    u.onend = () => setCoreState('idle', navigator.onLine ? 'ONLINE • ALL SYSTEMS NOMINAL' : 'NETWORK OFFLINE');
    speechSynthesis.speak(u);
  }

  function buildSalStatus() {
    const used = state.finance.cards.reduce((s,c)=>s+c.balance,0);
    const urgent = state.finance.bills.find(b=>b.status!=='paid'&&b.priority==='urgent');
    const remaining = state.reminders.filter(r=>!r.done).length;
    const shift = getNextShiftReply(0, true);
    const recommendation = urgent ? `Resolve ${urgent.name.toLowerCase()} before discretionary spending.` : state.finance.savings < state.finance.savingsFloor ? `Keep rebuilding savings toward ${money(state.finance.savingsFloor)}.` : `Finances are stable. Pick the highest-value project task next.`;
    return `S.A.L.E.M. STATUS\n\nFINANCES\nSavings: ${money(state.finance.savings)}\nGoal floor: ${money(state.finance.savingsFloor)}\nCards: ${money(used)} total used${urgent?`\n${urgent.name}: ${money(urgent.amount)} needs attention`:''}\n\nWORK\n${shift}\n\nPROJECTS\n999salem — active\nMarcus X Barber — active\n\nFITNESS\n${state.fitness.completedThisWeek}/${state.fitness.weeklyTarget} workouts this week\n\nREMINDERS\n${remaining} open\n\nRECOMMENDED NEXT ACTION\n${recommendation}`;
  }

  function buildDayPlan() {
    const items = getTodayItems();
    if (!items.length) return `No fixed shift or urgent item is saved for today. Use the open space for one useful task, a workout, then 999salem if you want it.`;
    return `Today's local plan: ${items.map(x=>`${x.time} — ${x.title}`).join('; ')}.`;
  }

  function getNextShiftReply(offsetDays = 0, compact = false) {
    const start = new Date();
    start.setDate(start.getDate() + offsetDays);
    for (let i=0;i<8;i++) {
      const d = new Date(start); d.setDate(start.getDate()+i);
      const s = state.work.schedule[d.getDay()];
      if (s) {
        const day = d.toLocaleDateString([], { weekday:'long', month:'short', day:'numeric' });
        return compact ? `Next Harry & Sons shift: ${day}, ${s.start}–${s.end}.` : `Your next saved Harry & Sons shift is ${day}, ${s.start}–${s.end}.${s.note?` ${s.note}.`:''} Location isn't assumed unless you save it or connect calendar data.`;
      }
    }
    return 'No upcoming saved shift found.';
  }

  async function persist() { state = await SalemDB.set(state); }
  function parseMoney(s){ return Number(String(s).replace(/,/g,'')); }
  function row(a,b){ return `<div class="data-row"><span>${escapeHTML(a)}</span><b>${escapeHTML(String(b))}</b></div>`; }
  function escapeHTML(v){ return String(v).replace(/[&<>'"]/g, c=>({ '&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;' }[c])); }
  function formatText(v){ return escapeHTML(v).replace(/\n/g,'<br>'); }
  function safeURL(v){ try { const u = new URL(String(v)); return ['http:','https:'].includes(u.protocol) ? u.href : ''; } catch { return ''; } }

  function registerServiceWorker() {
    if (!('serviceWorker' in navigator) || !(location.protocol === 'https:' || location.hostname === 'localhost')) return;
    navigator.serviceWorker.register('./sw.js?v=1.4.0').then(reg => {
      reg.addEventListener('updatefound', () => {
        const worker = reg.installing;
        if (!worker) return;
        worker.addEventListener('statechange', () => {
          if (worker.state === 'installed' && navigator.serviceWorker.controller) showToast('S.A.L.E.M. update ready. Reopen the app to load it.');
        });
      });
    }).catch(()=>{});
  }

  function uid() {
    return globalThis.crypto?.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function getNextShiftData() {
    const start = new Date();
    for (let i=0;i<8;i++) {
      const d = new Date(start); d.setDate(start.getDate()+i);
      const s = state.work.schedule[d.getDay()];
      if (s) return { ...s, date:d };
    }
    return null;
  }

  function compactTime(v) {
    return String(v || '').replace(':00','').replace(/\s?AM/i,'a').replace(/\s?PM/i,'p');
  }
})();
