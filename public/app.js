import { screenKey, acceptSnapshot, canSelect, normalizeCode } from './client-state.js';
import { GAME_MODES, getGameMode } from './game-modes.js';

const $ = selector => document.querySelector(selector);
const app = $('#app');
const escape = value => String(value).replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const inviteCode = normalizeCode(new URLSearchParams(location.search).get('join') || '');
let token, code = '', state = null, savedCode = '', generation = 0;
let mode = inviteCode ? 'join' : 'create', busy = false, restoring = false;
let selection = null, renderedKey = '', rosterKey = '', roundsChoice = null;
let draftName = '', draftCode = inviteCode, pollTimer, failures = 0, noticeTimer;
let selectedGameMode = 'family', joinLobby = null;

try {
  token = localStorage.getItem('ml.token');
  savedCode = localStorage.getItem('ml.code') || '';
  draftName = localStorage.getItem('ml.name') || '';
  if (!token) {
    token = Array.from(crypto.getRandomValues(new Uint8Array(32)), n => n.toString(16).padStart(2, '0')).join('');
    localStorage.setItem('ml.token', token);
  }
} catch {
  app.innerHTML = '<h1>Enable browser storage</h1><p>This game needs browser storage to keep your seat when you reconnect.</p>';
  throw Error('Storage unavailable');
}

function notice(message, persistent = false) {
  clearTimeout(noticeTimer);
  $('#notice').textContent = message;
  if (message && !persistent) noticeTimer = setTimeout(() => { $('#notice').textContent = ''; }, 5000);
}
function announce(message) { $('#announcer').textContent = message; }
function connection(online) {
  const node = $('#connection');
  if (node) { node.textContent = online ? '● You’re connected' : '◌ Reconnecting… your seat is saved'; node.classList.toggle('offline', !online); }
}
$('#rules').onclick = () => $('#rulesDialog').showModal();
$('#rulesDialog .close').onclick = () => $('#rulesDialog').close();
for (const dialog of document.querySelectorAll('dialog')) {
  dialog.addEventListener('click', event => { if (event.target === dialog) { const rect = dialog.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close(); } });
}
function confirmAction(title, description, label = 'Continue') {
  const dialog = $('#confirmDialog');
  if (dialog.open) return Promise.resolve(false);
  $('#confirmTitle').textContent = title;
  $('#confirmDescription').textContent = description;
  $('#confirmAccept').textContent = label;
  dialog.returnValue = '';
  return new Promise(resolve => {
    dialog.addEventListener('close', () => resolve(dialog.returnValue === 'confirm'), { once: true });
    dialog.showModal();
  });
}
async function api(action, data = {}, room = code) {
  const response = await fetch('/api/game', {
    method: 'POST', headers: {'Content-Type':'application/json', Authorization:`Bearer ${token}`},
    body: JSON.stringify({action, code:room, ...data}), signal: AbortSignal.timeout(12000)
  });
  let body;
  try { body = await response.json(); } catch { throw Error('We couldn’t reach the game. Please try again.'); }
  if (!response.ok) { const error = Error(body.error || 'Could not connect. Please retry.'); error.status = response.status; throw error; }
  return body;
}
function adopt(next) {
  if (!acceptSnapshot(state, next)) return;
  const previous = state;
  if (!previous || screenKey(previous) !== screenKey(next)) selection = null;
  if (!previous || previous.game !== next.game) roundsChoice = null;
  state = next; code = next.code; restoring = false; failures = 0;
  localStorage.setItem('ml.code', code);
  render(previous);
  connection(true);
}
function syncBusy() {
  app.setAttribute('aria-busy', String(busy));
  for (const button of app.querySelectorAll('[data-action]')) button.disabled = busy || button.dataset.unavailable === 'true';
  for (const field of app.querySelectorAll('input, select, [data-mode]')) field.disabled = busy;
  for (const button of app.querySelectorAll('[data-loading-label]')) {
    const loading = busy && button.dataset.action === app.dataset.pending;
    button.classList.toggle('is-loading', loading);
    if (!button.dataset.idle) button.dataset.idle = button.innerHTML;
    button.innerHTML = loading ? `<span class="spinner" aria-hidden="true"></span>${escape(button.dataset.loadingLabel)}` : button.dataset.idle;
  }
  syncSelection();
}
async function action(type, data = {}, room = code) {
  if (busy) return false;
  const epoch = generation;
  busy = true; app.dataset.pending = type; notice(''); syncBusy();
  try {
    const next = await api(type, {game:state?.game, ...data}, room);
    if (epoch !== generation) return false;
    adopt(next);
    return true;
  } catch (error) {
    if (epoch !== generation) return false;
    notice(error.name === 'TimeoutError' || error.name === 'TypeError' ? 'Connection interrupted. Your seat is saved—please try again.' : error.message, true);
    if (state) {
      try { const next = await api('state'); if (epoch === generation) adopt(next); } catch { connection(false); }
    }
    return false;
  } finally {
    // A response from an old lobby must not update a new screen or session.
    if (epoch === generation) { busy = false; delete app.dataset.pending; syncBusy(); schedulePoll(2000); }
  }
}
function avatar(player) {
  const color = Array.from(player.name).reduce((sum, char) => sum + char.codePointAt(0), 0) % 4;
  return `<span class="avatar tone-${color}" aria-hidden="true">${escape(Array.from(player.name)[0]?.toUpperCase() || '?')}</span>`;
}
function button(actionName, text, loadingLabel, extra = '') {
  return `<button class="primary" data-action="${actionName}" data-loading-label="${loadingLabel}" ${extra}>${text}</button>`;
}
function modePicker() {
  return `<fieldset class="mode-picker"><legend>Pick your kind of judgment.</legend>${Object.entries(GAME_MODES).map(([id, option]) => `<label class="mode-option"><input type="radio" name="gameMode" value="${id}" ${id === selectedGameMode ? 'checked' : ''}><span class="mode-card"><strong><span aria-hidden="true">${option.symbol}</span> ${option.label}<small>${option.count} prompts</small></strong><span>${option.description}</span></span></label>`).join('')}</fieldset><label class="adult-consent" id="hostConsentWrap" ${selectedGameMode === 'adults' ? '' : 'hidden'}><input id="hostAdultsConsent" type="checkbox" ${selectedGameMode === 'adults' ? 'required' : ''}><span>I’m 18 or older and want to create an explicit Adults Only game.</span></label>`;
}
function modeBadge() {
  const selected = getGameMode(state.gameMode || 'family');
  return `<div class="mode-banner mode-${state.gameMode || 'family'}"><strong>${selected.symbol} ${selected.label}</strong><span>${selected.count} prompts · ${selected.ageRestricted ? '18+ · explicit' : 'no explicit content'}</span></div>`;
}
function updateJoinPreview() {
  const slot = $('#joinPreview');
  if (!slot) return;
  const current = joinLobby && joinLobby.code === normalizeCode(draftCode);
  const selected = current && getGameMode(joinLobby.gameMode);
  slot.innerHTML = selected ? `<section class="join-preview mode-${joinLobby.gameMode}" aria-label="Lobby game mode"><strong>${selected.symbol} ${selected.label}</strong><p>${selected.description}</p><span>${joinLobby.playerCount}/${joinLobby.capacity} players · ${selected.count} prompts</span>${joinLobby.phase !== 'lobby' ? '<p>This game has started. Returning players can rejoin their seat.</p>' : ''}</section>${selected.ageRestricted ? '<label class="adult-consent"><input id="joinAdultsConsent" type="checkbox" required><span>I’m 18 or older and agree to join this explicit Adults Only game.</span></label>' : ''}` : '';
  const submit = $('#entry button[type="submit"]');
  if (submit) {
    submit.dataset.action = current ? 'join' : 'lobby';
    submit.dataset.loadingLabel = current ? 'Getting your seat…' : 'Finding your lobby…';
    submit.dataset.idle = current ? 'Join the lobby ↗' : 'Find my lobby ↗';
    submit.innerHTML = submit.dataset.idle;
  }
}
async function findLobby() {
  const epoch = generation, room = normalizeCode(draftCode);
  busy = true; app.dataset.pending = 'lobby'; notice(''); syncBusy();
  try {
    const preview = await api('lobby', {}, room);
    if (epoch !== generation) return;
    joinLobby = preview; updateJoinPreview();
    announce(`${preview.label} lobby found. Review the game mode before joining.`);
  } catch (error) { if (epoch === generation) notice(error.message, true); }
  finally { if (epoch === generation) { busy = false; delete app.dataset.pending; syncBusy(); } }
}

function home() {
  renderedKey = ''; rosterKey = '';
  app.innerHTML = `<div class="home screen-enter"><section><p class="eyebrow"><span class="live-dot"></span> THE PARTY STARTS WITH A QUESTION</p><h1>Good friends.<br>Questionable<br><em>reputations.</em></h1><p class="intro">Who’s most likely to…? You know the people. Now find out what they really think.</p><div class="pills"><span class="pill">✳ 2–15 friends</span><span class="pill">↗ Play on your phone</span><span class="pill">♡ No sign-up</span><span class="pill">✦ 750 questions · 3 ways to play</span></div><div class="art" aria-hidden="true"><div class="mock-card"><span class="tag">WHO’S MOST LIKELY TO…</span><p>make friends<br>with absolutely<br>anyone?</p></div><span class="scribble">✳</span><div class="mock-card second"><span class="tag">WHO’S MOST LIKELY TO…</span><p>take game night<br>way too<br>seriously?</p></div><span class="sticker">You already know who. ↗</span></div></section><section class="panel entry-panel"><div class="tabs" aria-label="Choose how to play"><button data-mode="create" class="${mode === 'create' ? 'active' : ''}" aria-pressed="${mode === 'create'}">Host a game</button><button data-mode="join" class="${mode === 'join' ? 'active' : ''}" aria-pressed="${mode === 'join'}">Join your friends</button></div><h2>${mode === 'create' ? 'Your people. Your lobby.' : 'Got an invite?'}</h2><p class="subtle">${mode === 'create' ? 'Get everyone together. We’ll bring the questions.' : 'Enter your name, pull up a seat, and let’s play.'}</p><form id="entry"><label for="name">What should we call you?</label><input id="name" name="name" placeholder="Your first name or nickname" maxlength="24" autocomplete="nickname" value="${escape(draftName)}" required>${mode === 'join' ? `<label for="code">Lobby code</label><input id="code" class="code-input" name="code" placeholder="ABC123" minlength="6" maxlength="12" autocapitalize="characters" autocomplete="off" spellcheck="false" value="${escape(draftCode)}" required>` : ''}${mode === 'create' ? modePicker() : '<div id="joinPreview"></div>'}${button(mode === 'create' ? 'create' : 'lobby', mode === 'create' ? 'Create a lobby ↗' : 'Find my lobby ↗', mode === 'create' ? 'Getting your seat…' : 'Finding your lobby…', 'type="submit"')}</form><p class="fine">${mode === 'create' ? 'You set the rounds. Your friends bring the opinions.' : 'No account. No downloads. Just your people.'}</p><div class="steps"><span><b>01 &nbsp; Gather</b>Share your lobby code</span><span><b>02 &nbsp; Vote</b>Choose your suspects</span><span><b>03 &nbsp; Reveal</b>Let the debate begin</span></div></section></div>`;
  for (const tab of app.querySelectorAll('[data-mode]')) tab.onclick = () => { if (!busy) { mode = tab.dataset.mode; home(); } };
  $('#name').oninput = event => { draftName = event.target.value; };
  if ($('#code')) $('#code').oninput = event => { draftCode = event.target.value; joinLobby = null; updateJoinPreview(); };
  for (const radio of app.querySelectorAll('[name="gameMode"]')) radio.onchange = () => {
    selectedGameMode = radio.value;
    const adults = selectedGameMode === 'adults';
    $('#hostConsentWrap').hidden = !adults;
    $('#hostAdultsConsent').required = adults;
    $('#hostAdultsConsent').checked = false;
  };
  updateJoinPreview();
  $('#entry').onsubmit = async event => {
    event.preventDefault(); if (busy) return;
    const name = draftName.trim();
    if (!name) { $('#name').setCustomValidity('Tell us your name first.'); $('#name').reportValidity(); $('#name').oninput = event => { draftName = event.target.value; event.target.setCustomValidity(''); }; return; }
    draftCode = normalizeCode(draftCode);
    if (mode === 'join' && !/^[A-Z2-9]{6}$/.test(draftCode)) { notice('Use the six-character code from your host.', true); $('#code').focus(); return; }
    localStorage.setItem('ml.name', name);
    if (mode === 'join') $('#code').value = draftCode;
    if (mode === 'join' && (!joinLobby || joinLobby.code !== draftCode)) { await findLobby(); return; }
    const adultsConfirmed = mode === 'create' ? !!$('#hostAdultsConsent')?.checked : !!$('#joinAdultsConsent')?.checked;
    await action(mode === 'create' ? 'create' : 'join', {name, gameMode:selectedGameMode, adultsConfirmed}, mode === 'join' ? draftCode : '');
  };
  syncBusy();
}
function header(title) {
  return `<div class="roomhead"><h2 id="screenTitle" tabindex="-1">${title}</h2><button class="roomcode" id="copycode" aria-label="Copy lobby code ${escape(code)}">${escape(code)} <span aria-hidden="true">⧉</span></button></div>`;
}
function controls() { return '<div class="statusline room-footer"><span class="connection" id="connection">● You’re connected</span><button class="textbutton" id="leave">Leave this screen ↗</button></div>'; }
function stepper(phase) {
  return `<nav class="game-steps" aria-label="Game progress">${['lobby','voting','results'].map((step, i) => `<span ${step === phase ? 'aria-current="step"' : ''}><b>${i + 1}</b>${['Gather','Vote','Reveal'][i]}</span>`).join('')}</nav>`;
}
function lobbyMarkup(host) {
  return `${header('The gathering spot.')}${stepper('lobby')}<div class="lobby-grid"><section class="panel invite-panel"><p class="eyebrow">YOUR PEOPLE GO HERE</p><button class="codebig" id="bigcode" aria-label="Copy lobby code ${escape(code)}">${escape(code)} <span aria-hidden="true">⧉</span></button><p class="subtle">One code. All your friends.<br>Share the link or have them enter it here.</p><div class="share-actions"><button class="secondary" id="invite">Share invite ↗</button><button class="textbutton" id="copylink">Copy link ⧉</button></div>${host ? `<div class="round-setting"><label for="rounds">Make it a quick one or go all in.</label><select id="rounds" aria-describedby="roundHelp"></select><p id="roundHelp" class="subtle"></p></div>${button('start', 'Everyone’s here. Let’s play ↗', 'Starting the game…', 'id="start"')}<p class="fine" id="startHelp"></p>` : '<div class="waiting compact"><span class="waiting-symbol" aria-hidden="true">✳</span><strong>You’re on the list.</strong><p class="subtle">Your host will choose the rounds and start the game.</p></div>'}</section><section class="guest-panel"><div class="section-label"><p class="eyebrow">THE GUEST LIST</p><span class="count-badge" id="guestCount"></span></div><div class="players" id="roster"></div><p class="subtle">A little friendly judgment is on the way.<br>Keep it kind. Make it memorable.</p></section></div>`;
}
function updateLobby(previous) {
  const s = state, host = s.me === s.host;
  $('#guestCount').textContent = `${s.players.length} / 15`;
  if (host) {
    const select = $('#rounds');
    // Keep the select element itself, its focus and the host's choice across joins.
    const optionsKey = String(s.players.length);
    if (select.dataset.count !== optionsKey) {
      select.innerHTML = s.players.map((_, i) => `<option value="${i + 1}">${i + 1} ${i ? 'rounds' : 'round'}${i + 1 === s.players.length ? ' · everyone gets a turn' : ''}</option>`).join('');
      select.dataset.count = optionsKey;
    }
    select.value = Math.min(roundsChoice ?? 5, s.players.length);
    $('#roundHelp').textContent = `Pick each friend just once. Up to ${s.players.length} ${s.players.length === 1 ? 'round' : 'rounds'} with this group.`;
    const start = $('#start'); start.dataset.unavailable = String(s.players.length < 2);
    $('#startHelp').textContent = s.players.length < 2 ? 'Invite at least one friend to get started.' : `${s.players.length} players are in. Start when everyone is ready.`;
    select.onchange = () => { roundsChoice = Number(select.value); };
  }
  const key = JSON.stringify(s.players);
  if (key !== rosterKey) {
    const roster = $('#roster');
    const keep = new Set(s.players.map(p => p.id));
    for (const node of roster.children) if (!keep.has(node.dataset.player)) node.remove();
    for (const p of s.players) {
      if (Array.from(roster.children).some(node => node.dataset.player === p.id)) continue;
      const item = document.createElement('div'); item.className = 'person guest-arrival'; item.dataset.player = p.id;
      item.innerHTML = `${avatar(p)}<div class="name">${escape(p.name)}${p.id === s.me ? ' <span class="you-label">you</span>' : ''}<small>${p.id === s.host ? 'HOSTING THE GOOD TIMES' : 'READY TO PLAY'}</small></div>${host && p.id !== s.me ? `<button class="remove" data-action="remove" aria-label="Remove ${escape(p.name)}">×</button>` : ''}`;
      const remove = item.querySelector('.remove');
      if (remove) remove.onclick = async () => { const game = s.game; if (await confirmAction(`Remove ${p.name}?`, 'They can join again with the lobby code before the game starts.', 'Remove player')) action('remove', {target:p.id, game}); };
      roster.append(item);
    }
    rosterKey = key;
    if (previous?.phase === 'lobby' && s.players.length > previous.players.length) announce(`${s.players.length} friends are in the lobby.`);
  }
}
function votingMarkup() {
  const s = state;
  return `${header('Trust your instincts.')}${stepper('voting')}<div class="round-meta"><span class="round-badge">ROUND ${s.round + 1}<span> / ${s.rounds}</span></span><span class="vote-count" id="voteCount"></span></div><progress id="voteProgress" class="progress" max="${s.players.length}" value="${s.ready.length}" aria-label="Votes submitted"></progress><section class="prompt"><p class="eyebrow">WHO’S MOST LIKELY TO…</p><h2>${escape(s.prompt)}?</h2><span class="prompt-stamp" aria-hidden="true">✳</span></section>${s.voted ? `<section class="waiting locked-state"><div class="locked-seal" aria-hidden="true">✓</div><h3>Locked in. Lips sealed.</h3><p class="subtle">Your vote is safe. Let’s see what everyone else thinks.</p></section>` : `<div class="section-label"><p class="eyebrow">WHO COMES TO MIND?</p><span class="subtle">Pick first. Lock it in below.</span></div><div class="votegrid">${s.players.map(p => `<button class="person vote" data-vote="${p.id}" aria-pressed="false" ${s.used.includes(p.id) ? 'disabled' : ''}>${avatar(p)}<span class="name">${escape(p.name)}${p.id === s.me ? ' <span class="you-label">you</span>' : ''}<small>${s.used.includes(p.id) ? 'ALREADY PICKED' : 'AVAILABLE'}</small></span><span class="pick-check" aria-hidden="true">✓</span></button>`).join('')}</div><div class="vote-dock"><div class="pick-description"><span class="eyebrow">YOUR PICK</span><strong id="pickName">Go with your gut.</strong><span class="subtle" id="pickHint">Choose a friend above.</span></div>${button('vote', 'Lock in my vote ↗', 'Locking it in…', 'id="lockVote" data-unavailable="true" disabled')}</div>`}<section class="voter-status" aria-label="Player voting status"><p class="eyebrow" id="waitingLabel"></p><div class="voter-chips" id="voterChips"></div></section>${s.me === s.host ? '<button class="textbutton muted-action" id="skip" data-action="skip">Missing someone? Close this round ↗</button>' : ''}`;
}
function syncSelection() {
  if (!state || state.phase !== 'voting') return;
  if (!canSelect(state, selection)) selection = null;
  for (const node of app.querySelectorAll('[data-vote]')) {
    const selected = node.dataset.vote === selection;
    node.classList.toggle('selected', selected); node.setAttribute('aria-pressed', String(selected));
    node.disabled = busy || !canSelect(state, node.dataset.vote);
  }
  const lock = $('#lockVote');
  if (lock) {
    lock.dataset.unavailable = String(!selection); lock.disabled = busy || !selection;
    const p = state.players.find(p => p.id === selection);
    $('#pickName').textContent = p ? p.name : 'Go with your gut.';
    $('#pickHint').textContent = p ? 'One tap to make it official.' : 'Choose a friend above.';
  }
}
function updateVoting() {
  const s = state;
  $('#voteCount').textContent = `${s.ready.length} of ${s.players.length} locked in`;
  $('#voteProgress').value = s.ready.length;
  $('#waitingLabel').textContent = s.voted ? `WAITING ON ${s.players.length - s.ready.length} MORE ${s.players.length - s.ready.length === 1 ? 'FRIEND' : 'FRIENDS'}` : 'THE ROOM IS THINKING…';
  // Status changes do not replace the selection grid, focus, or lock-in button.
  const chips = $('#voterChips');
  if (!chips.children.length) chips.innerHTML = s.players.map(p => `<span class="voter-chip" data-status="${p.id}"><span class="status-symbol" aria-hidden="true"></span>${escape(p.name)}<span class="sr-only"></span></span>`).join('');
  for (const chip of chips.children) {
    const ready = s.ready.includes(chip.dataset.status);
    chip.classList.toggle('ready', ready);
    chip.querySelector('.status-symbol').textContent = ready ? '✓' : '·';
    chip.querySelector('.sr-only').textContent = ready ? ' has voted' : ' is thinking';
  }
  syncSelection();
}
function resultsMarkup(host) {
  const s = state, r = s.results.at(-1), complete = s.reveal === s.rounds - 1;
  const celebration = '<div class="confetti" aria-hidden="true">' + Array.from({length:14}, (_, i) => `<i class="piece piece-${i}"></i>`).join('') + '</div>';
  const prompt = r ? `<section class="prompt result-card">${r.winners.length ? celebration : ''}<p class="eyebrow">MOST LIKELY TO…</p><h2>${escape(r.prompt)}?</h2><span class="result-caption">${r.winners.length > 1 ? 'GREAT MINDS. SHARED REPUTATIONS.' : r.winners.length ? 'THE GROUP HAS SPOKEN.' : 'A MYSTERY FOR ANOTHER DAY.'}</span><div class="winners">${r.winners.length ? r.winners.map(id => { const p = s.players.find(p => p.id === id); return `<div class="winner">${avatar(p)}<strong>${escape(p.name)}</strong><p>${r.counts[id]} ${r.counts[id] === 1 ? 'vote' : 'votes'}${r.winners.length > 1 ? ' · tied winner' : ''}</p></div>`; }).join('') : '<p>No votes were cast this round.</p>'}</div></section><details class="tally"><summary>The vote breakdown <span>${r.total} votes ↓</span></summary>${Object.entries(r.counts).sort((a,b) => b[1] - a[1]).map(([id,count]) => `<div class="tallyrow"><span>${escape(s.players.find(p => p.id === id).name)}</span><meter min="0" max="${s.players.length}" value="${count}" aria-label="${escape(s.players.find(p => p.id === id).name)} votes">${count}</meter><strong>${count}</strong></div>`).join('')}</details>` : `<section class="waiting reveal-ready"><span class="reveal-star" aria-hidden="true">✳</span><p class="eyebrow">EVERY VOTE TELLS A STORY</p><h3>A few reputations<br>are about to change.</h3><p class="subtle">${host ? 'Gather your friends. The big reveal is yours.' : 'Eyes on your host. The big reveal is coming.'}</p></section>`;
  return `${header('The people have spoken.')}${stepper('results')}<div class="round-meta"><span class="round-badge">${r ? `REVEAL ${s.reveal + 1}<span> / ${s.rounds}</span>` : 'THE BIG REVEAL'}</span><span class="subtle">${complete ? 'That’s a wrap. What a group.' : 'One prompt. One reputation.'}</span></div>${prompt}${host ? (complete ? button('reset', 'Same friends. Another round? ↗', 'Bringing everyone back…', 'id="reset"') : button('reveal', r ? 'And the next one is… ↗' : 'Let’s see what everyone thinks ↗', 'Revealing…', 'id="reveal"')) : `<p class="fine">${complete ? 'Your host can bring everyone back for another game.' : 'Your host will reveal the next result. Stay tuned.'}</p>`}${s.results.length > 1 ? `<details class="archive"><summary>The story so far <span>${s.results.length - 1} previous ${s.results.length === 2 ? 'result' : 'results'} ↓</span></summary>${s.results.slice(0,-1).map((result,i) => `<div class="past-result"><span class="tag">ROUND ${i + 1}</span><p>Most likely to ${escape(result.prompt)}?</p><strong>${result.winners.map(id => escape(s.players.find(p => p.id === id).name)).join(' & ') || 'No votes'}</strong></div>`).join('')}</details>` : ''}`;
}
function bindRoom() {
  $('#copycode').onclick = () => copy(code, 'Lobby code copied. Pass it around.');
  if ($('#bigcode')) $('#bigcode').onclick = $('#copycode').onclick;
  if ($('#invite')) $('#invite').onclick = shareInvite;
  if ($('#copylink')) $('#copylink').onclick = () => copy(`${location.origin}/?join=${code}`, 'Invite link copied. Send it to your friends.');
  if ($('#start')) $('#start').onclick = () => action('start', {rounds:Number($('#rounds').value)});
  for (const node of app.querySelectorAll('[data-vote]')) node.onclick = () => {
    if (busy || !canSelect(state, node.dataset.vote)) return;
    selection = node.dataset.vote; syncSelection();
    announce(`${state.players.find(p => p.id === selection).name} selected. Lock in your vote when ready.`);
  };
  if ($('#lockVote')) $('#lockVote').onclick = () => { if (selection) action('vote', {target:selection, round:state.round}); };
  if ($('#skip')) $('#skip').onclick = async () => {
    const snapshot = state;
    if (await confirmAction('Ready to move on?', 'Close this round with the votes already cast. Friends who haven’t voted will sit this question out.', 'Close this round')) action('skip', {round:snapshot.round, game:snapshot.game});
  };
  if ($('#reveal')) $('#reveal').onclick = () => action('reveal', {reveal:state.reveal});
  if ($('#reset')) $('#reset').onclick = () => action('reset');
  $('#leave').onclick = async () => {
    if (await confirmAction('Step away for a bit?', 'Your seat stays saved. You can rejoin with the same browser and lobby code.', 'Leave this screen')) leave();
  };
}
function render(previous) {
  const key = screenKey(state);
  const changed = key !== renderedKey;
  if (changed) {
    const host = state.me === state.host;
    const content = state.phase === 'lobby' ? lobbyMarkup(host) : state.phase === 'voting' ? votingMarkup() : resultsMarkup(host);
    app.innerHTML = `<div class="room ${state.phase === 'results' ? 'results' : ''} screen-enter">${modeBadge()}${content}${controls()}</div>`;
    renderedKey = key; rosterKey = '';
    bindRoom();
    if (previous && previous.phase !== 'lobby') window.scrollTo({top:0, behavior:'instant'});
    if (previous && !document.querySelector('dialog[open]')) $('#screenTitle').focus({preventScroll:true});
    if (state.phase === 'voting') announce(state.voted ? 'Your vote is locked in.' : `Round ${state.round + 1}. Most likely to ${state.prompt}?`);
    if (state.phase === 'results') announce(state.reveal < 0 ? 'All votes are in. Time for the reveal.' : `Result ${state.reveal + 1} revealed.`);
  }
  if (state.phase === 'lobby') updateLobby(previous);
  if (state.phase === 'voting') updateVoting();
  syncBusy();
}
function leave() {
  generation++; busy = false; restoring = false; state = null; code = ''; savedCode = ''; roundsChoice = null; selection = null;
  localStorage.removeItem('ml.code'); history.replaceState({}, '', '/');
  delete app.dataset.pending; home(); notice('Your seat is saved. Use your lobby code to rejoin.');
}
async function copy(text, message) {
  try { await navigator.clipboard.writeText(text); notice(message); }
  catch {
    const dialog = $('#copyDialog'); $('#copyValue').value = text; dialog.showModal(); $('#copyValue').select();
  }
}
async function shareInvite() {
  const url = `${location.origin}/?join=${code}`;
  if (navigator.share) {
    try { await navigator.share({title:'You’re invited to Most Likely', text:`Join my ${getGameMode(state.gameMode || 'family').label} game! Lobby code: ${code}`, url}); return; }
    catch (error) { if (error.name === 'AbortError') return; }
  }
  await copy(url, 'Invite link copied. Send it to your friends.');
}
function schedulePoll(delay) { clearTimeout(pollTimer); pollTimer = setTimeout(poll, delay); }
let polling = false;
async function poll() {
  if (polling) return;
  if (!code || (!state && !restoring) || busy || document.hidden) { schedulePoll(2000); return; }
  const epoch = generation, room = code;
  polling = true;
  try {
    const next = await api('state', {}, room);
    if (epoch === generation) adopt(next);
  } catch (error) {
    if (epoch !== generation) return;
    failures++;
    if ([401,404].includes(error.status)) {
      generation++; state = null; code = ''; restoring = false;
      localStorage.removeItem('ml.code'); home(); notice(error.message, true);
    } else {
      connection(false);
      if (restoring) {
        app.innerHTML = '<section class="waiting"><h2>Still finding your seat…</h2><p class="subtle">We’ll keep trying. Your lobby is saved.</p><button class="secondary" id="stopRestore">Back to the start</button></section>';
        $('#stopRestore').onclick = leave;
      }
    }
  } finally {
    polling = false;
    schedulePoll(Math.min(15000, 2000 * (2 ** Math.min(failures, 3))));
  }
}
document.addEventListener('visibilitychange', () => { if (!document.hidden) { clearTimeout(pollTimer); poll(); } });
window.addEventListener('online', () => { failures = 0; poll(); });
window.addEventListener('offline', () => connection(false));
home();
if (savedCode && (!inviteCode || inviteCode === savedCode)) {
  code = savedCode; restoring = true;
  app.innerHTML = '<section class="waiting"><span class="spinner" aria-hidden="true"></span><h2>Finding your seat…</h2><p class="subtle">Picking up right where you left off.</p><button class="textbutton" id="stopRestore">Back to the start</button></section>';
  $('#stopRestore').onclick = leave; poll();
} else schedulePoll(2000);
