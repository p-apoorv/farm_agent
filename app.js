const API_BASE = window.NELAM_API_BASE || '/api';
const views = ['home', 'crop', 'schemes', 'grievance'];
const activity = [];
let toastTimer;

function toast(message) {
  const el = document.getElementById('toast');
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2800);
}

function navigate(view) {
  if (!views.includes(view)) return;
  document.querySelectorAll('.view').forEach(el => el.classList.toggle('active', el.id === `${view}-view`));
  document.querySelectorAll('.nav-item').forEach(el => el.classList.toggle('active', el.dataset.view === view));
  const labels = { home: 'Overview', crop: 'Crop advisory', schemes: 'Scheme eligibility', grievance: 'Grievance help' };
  document.getElementById('crumb').textContent = labels[view];
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

document.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click', () => navigate(button.dataset.view)));

let lastSchemeResults = [];
const schemeLabels = {
  en: { pageTitle: 'Find schemes for you', intro: 'This quick screen checks the official scheme rules and explains what to verify next.', title: 'Let’s check your family’s details', state: 'Which state is your farm in?', states: ['Karnataka', 'Tamil Nadu'], land: 'Does your farmer family have cultivable land recorded in land records?', lands: ['Yes, recorded in family name(s)', 'Lease only; no family land record', 'No cultivable land', 'Not sure'], exclusions: 'Does any family member fall under a PM-KISAN exclusion category?', exclusionHelp: 'Examples: institutional landholder, income-tax payer, specified government post/pension, or practising professional.', exclusionOptions: ['Not sure', 'No known exclusions', 'Yes, one or more'], aadhaar: 'Is PM-KISAN eKYC and bank/DBT setup complete?', aadhaarOptions: ['Yes', 'No', 'Not sure'], check: 'Check scheme eligibility', results: 'Preliminary scheme screening', disclaimer: 'A possible match is not approval. The department verifies land records, exclusions and current openings.' },
  ta: { pageTitle: 'உங்களுக்கான திட்டங்களைக் கண்டறியுங்கள்', intro: 'அதிகாரப்பூர்வ திட்ட விதிகளின் அடிப்படையில் முதற்கட்டமாகச் சரிபார்த்து அடுத்த படிகளை விளக்குகிறோம்.', title: 'உங்கள் குடும்ப விவரங்களைச் சரிபார்ப்போம்', state: 'உங்கள் பண்ணை எந்த மாநிலத்தில் உள்ளது?', states: ['கர்நாடகா', 'தமிழ்நாடு'], land: 'விவசாயக் குடும்பத்தின் பெயரில் பயிரிடத்தக்க நிலம் வருவாய்ப் பதிவில் உள்ளதா?', lands: ['ஆம், குடும்பப் பெயரில் பதிவு உள்ளது', 'குத்தகை மட்டும்; குடும்ப நிலப் பதிவு இல்லை', 'பயிரிடத்தக்க நிலம் இல்லை', 'தெரியவில்லை'], exclusions: 'குடும்ப உறுப்பினர்களில் யாராவது PM-KISAN விலக்கு வகையில் உள்ளார்களா?', exclusionHelp: 'உதாரணம்: நிறுவன நிலம், வருமானவரி செலுத்துபவர், குறிப்பிட்ட அரசு பதவி/ஓய்வூதியம் அல்லது தொழில் நிபுணர்.', exclusionOptions: ['தெரியவில்லை', 'தெரிந்த விலக்கு இல்லை', 'ஆம், ஒன்று அல்லது அதற்கு மேல்'], aadhaar: 'PM-KISAN eKYC மற்றும் வங்கி/DBT ஏற்பாடு முடிந்ததா?', aadhaarOptions: ['ஆம்', 'இல்லை', 'தெரியவில்லை'], check: 'திட்டத் தகுதியைச் சரிபார்க்கவும்', results: 'திட்டங்களின் முதற்கட்ட சரிபார்ப்பு', disclaimer: 'பொருத்தம் என்பது ஒப்புதல் அல்ல. நிலப் பதிவுகள், விலக்குகள் மற்றும் தற்போதைய அறிவிப்புகளைத் துறை உறுதிப்படுத்தும்.' },
  kn: { pageTitle: 'ನಿಮಗಾಗಿ ಯೋಜನೆಗಳನ್ನು ಹುಡುಕಿ', intro: 'ಅಧಿಕೃತ ಯೋಜನಾ ನಿಯಮಗಳ ಆಧಾರದ ಮೇಲೆ ಪ್ರಾಥಮಿಕವಾಗಿ ಪರಿಶೀಲಿಸಿ ಮುಂದಿನ ಹಂತಗಳನ್ನು ತಿಳಿಸುತ್ತೇವೆ.', title: 'ನಿಮ್ಮ ಕುಟುಂಬದ ವಿವರಗಳನ್ನು ಪರಿಶೀಲಿಸೋಣ', state: 'ನಿಮ್ಮ ಹೊಲ ಯಾವ ರಾಜ್ಯದಲ್ಲಿದೆ?', states: ['ಕರ್ನಾಟಕ', 'ತಮಿಳುನಾಡು'], land: 'ರೈತ ಕುಟುಂಬದ ಹೆಸರಿನಲ್ಲಿ ಕೃಷಿಯೋಗ್ಯ ಭೂಮಿ ದಾಖಲಾಗಿದೆಯೇ?', lands: ['ಹೌದು, ಕುಟುಂಬದ ಹೆಸರಿನಲ್ಲಿ ದಾಖಲಾಗಿದೆ', 'ಗುತ್ತಿಗೆ ಮಾತ್ರ; ಕುಟುಂಬದ ಭೂ ದಾಖಲೆ ಇಲ್ಲ', 'ಕೃಷಿಯೋಗ್ಯ ಭೂಮಿ ಇಲ್ಲ', 'ತಿಳಿದಿಲ್ಲ'], exclusions: 'ಕುಟುಂಬದ ಯಾರಾದರೂ PM-KISAN ಹೊರತಾಗುವ ವರ್ಗದಲ್ಲಿದ್ದಾರೆಯೇ?', exclusionHelp: 'ಉದಾಹರಣೆ: ಸಂಸ್ಥೆಯ ಭೂಮಾಲೀಕ, ಆದಾಯ ತೆರಿಗೆದಾರ, ನಿರ್ದಿಷ್ಟ ಸರ್ಕಾರಿ ಹುದ್ದೆ/ಪಿಂಚಣಿ ಅಥವಾ ವೃತ್ತಿಪರರು.', exclusionOptions: ['ತಿಳಿದಿಲ್ಲ', 'ತಿಳಿದಿರುವ ಹೊರತಾಗುವಿಕೆ ಇಲ್ಲ', 'ಹೌದು, ಒಂದು ಅಥವಾ ಹೆಚ್ಚು'], aadhaar: 'PM-KISAN eKYC ಮತ್ತು ಬ್ಯಾಂಕ್/DBT ವ್ಯವಸ್ಥೆ ಪೂರ್ಣಗೊಂಡಿದೆಯೇ?', aadhaarOptions: ['ಹೌದು', 'ಇಲ್ಲ', 'ತಿಳಿದಿಲ್ಲ'], check: 'ಯೋಜನಾ ಅರ್ಹತೆ ಪರಿಶೀಲಿಸಿ', results: 'ಯೋಜನೆಗಳ ಪ್ರಾಥಮಿಕ ಪರಿಶೀಲನೆ', disclaimer: 'ಸಂಭಾವ್ಯ ಹೊಂದಾಣಿಕೆ ಅನುಮೋದನೆ ಅಲ್ಲ. ಭೂ ದಾಖಲೆ, ಹೊರತಾಗುವಿಕೆ ಮತ್ತು ಪ್ರಸ್ತುತ ಅರ್ಜಿಗಳನ್ನು ಇಲಾಖೆ ದೃಢಪಡಿಸುತ್ತದೆ.' }
};

function setupSchemeQuestions() {
  const acresLabel = document.getElementById('acres').closest('label');
  if (acresLabel) acresLabel.hidden = true;
  document.getElementById('land').add(new Option('Not sure', 'unsure'));
  const landLabel = document.getElementById('land').closest('label');
  landLabel.insertAdjacentHTML('afterend', '<label id="exclusionsLabel">Does any family member fall under a PM-KISAN exclusion category?<select id="exclusions"><option value="unsure">Not sure</option><option value="no">No known exclusions</option><option value="yes">Yes, one or more</option></select><small id="exclusionHelp">Examples: institutional landholder, income-tax payer, specified government post/pension, or practising professional.</small></label>');
  const aadhaarLabel = document.getElementById('aadhaar').closest('label');
  aadhaarLabel.insertAdjacentHTML('afterend', '<p class="scheme-scope-note" id="schemeScopeNote">You do not need to enter an Aadhaar number. These answers are only a first screen; final eligibility is confirmed by the scheme authority.</p>');
}

function updateSchemeCopy(language) {
  const copy = schemeLabels[language] || schemeLabels.en;
  const setLabel = (id, text) => { const label = document.getElementById(id)?.closest('label'); if (label?.firstChild) label.firstChild.textContent = `${text} `; };
  document.querySelector('#schemes-view .page-intro h1').textContent = copy.pageTitle;
  document.querySelector('#schemes-view .page-intro > p').textContent = copy.intro;
  document.querySelector('#schemeForm [data-step="1"] h2').textContent = copy.title;
  document.querySelector('#schemeForm [data-step="1"] > p').textContent = copy.intro;
  document.querySelector('#schemeResults h2').textContent = copy.results;
  document.querySelector('#schemeResults > p').textContent = copy.disclaimer;
  setLabel('state', copy.state); setLabel('land', copy.land); setLabel('aadhaar', copy.aadhaar); setLabel('exclusions', copy.exclusions);
  document.getElementById('exclusionHelp').textContent = copy.exclusionHelp;
  document.getElementById('checkSchemes').firstChild.textContent = `${copy.check} `;
  for (const [id, labels] of [['state', copy.states], ['land', copy.lands], ['aadhaar', copy.aadhaarOptions], ['exclusions', copy.exclusionOptions]]) {
    [...document.getElementById(id).options].forEach((option, index) => { if (labels[index]) option.textContent = labels[index]; });
  }
  if (lastSchemeResults.length) renderSchemeResults(language);
}

function schemeStatusText(status, language) {
  const terms = {
    en: { possible_match: 'Possible match', not_eligible: 'Does not match', manual_review: 'Needs official check' },
    ta: { possible_match: 'பொருந்த வாய்ப்பு', not_eligible: 'பொருந்தவில்லை', manual_review: 'அதிகாரப்பூர்வ சரிபார்ப்பு தேவை' },
    kn: { possible_match: 'ಹೊಂದಾಣಿಕೆ ಇರಬಹುದು', not_eligible: 'ಹೊಂದಾಣಿಕೆ ಇಲ್ಲ', manual_review: 'ಅಧಿಕೃತ ಪರಿಶೀಲನೆ ಅಗತ್ಯ' }
  };
  return (terms[language] || terms.en)[status] || (terms[language] || terms.en).manual_review;
}

function renderSchemeResults(language = document.getElementById('language').value) {
  document.getElementById('resultsList').innerHTML = lastSchemeResults.map(item => {
    const status = item.status || (item.eligible ? 'possible_match' : 'manual_review');
    const review = status !== 'possible_match';
    return `<div class="result-card"><div><b>${escapeHtml(item.name)}</b><p>${escapeHtml(item.reason || item.note || '')}<br><strong>${language === 'ta' ? 'அடுத்த படி' : language === 'kn' ? 'ಮುಂದಿನ ಹಂತ' : 'Next step'}:</strong> ${escapeHtml(item.action || '')}${item.sourceUrl ? `<br><a href="${escapeHtml(item.sourceUrl)}" target="_blank" rel="noreferrer">${language === 'ta' ? 'அதிகாரப்பூர்வ ஆதாரம்' : language === 'kn' ? 'ಅಧಿಕೃತ ಮೂಲ' : 'Official source'} ↗</a>` : ''}</p></div><span class="result-status ${review ? 'review' : ''}">${schemeStatusText(status, language)}</span></div>`;
  }).join('');
}

setupSchemeQuestions();
updateSchemeCopy('ta');

function addActivity(title, detail) {
  activity.unshift({ title, detail });
  document.getElementById('activityList').innerHTML = activity.slice(0, 3).map(item =>
    `<div class="activity-item"><i class="activity-dot"></i><b>${escapeHtml(item.title)}</b><small>${escapeHtml(item.detail)}</small></div>`
  ).join('');
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}

const languageCopy = {
  ta: { greeting: 'வணக்கம்', welcome: 'இன்று உங்கள் பண்ணைக்கு என்ன உதவி தேவை?', placeholder: 'தமிழ், ಕನ್ನಡ அல்லது English-ல் கேளுங்கள்…' },
  kn: { greeting: 'ನಮಸ್ಕಾರ', welcome: 'ಇಂದು ನಿಮ್ಮ ಹೊಲಕ್ಕೆ ಯಾವ ಸಹಾಯ ಬೇಕು?', placeholder: 'தமிழ், ಕನ್ನಡ ಅಥವಾ English-ல் கேளுங்கள்…' },
  en: { greeting: 'Hello', welcome: 'Your farm is in good hands. What can we help with today?', placeholder: 'Ask in Tamil, Kannada or English…' }
};
document.getElementById('language').addEventListener('change', event => {
  const copy = languageCopy[event.target.value];
  document.getElementById('greeting').textContent = copy.greeting;
  document.getElementById('welcomeText').textContent = copy.welcome;
  document.getElementById('chatInput').placeholder = copy.placeholder;
  updateSchemeCopy(event.target.value);
});

const demoReplies = [
  { match: /yellow|இலை|ಹಳದಿ/i, text: 'Yellowing leaves can come from waterlogging or a nutrient issue. Check whether water is standing around the roots, and inspect a few plants across the field. Share a clear photo of the whole plant and leaf close-up for a better assessment.' },
  { match: /rain|weather|மழை|ಮಳೆ/i, text: 'Mandya forecast: light showers are expected tomorrow afternoon (about 8–12 mm). Clear field drains and move harvested grain to a covered, dry place. This is a demo forecast; connect your weather feed for live alerts.' },
  { match: /pest|borer|பூச்சி|புழு|ಕೀಟ/i, text: 'I can help assess pest symptoms from a clear crop photo. Photograph the affected plant, the damaged area, and any visible insect. The photo check needs the Sarvam Knowledge Engine and crop diagnostic service connected before it can identify a pest.' },
  { match: /yield|optim|விளைச்சல்|ಇಳುವರಿ/i, text: 'Yield guidance is provided through your existing DSS crop model. Connect the DSS adapter with crop, sowing date, soil and location data to return a field-specific recommendation here.' }
];

async function askAdvisory(message, extra = {}) {
  const area = document.getElementById('chatBody');
  const user = document.createElement('div');
  user.className = 'user-message';
  user.innerHTML = `<div>${escapeHtml(message)}</div>`;
  area.appendChild(user);
  area.scrollTop = area.scrollHeight;
  addActivity('Crop advisory question', 'Just now');
  try {
    const response = await fetch(`${API_BASE}/crop/advisory`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, language: document.getElementById('language').value, location: 'Mandya, Karnataka', ...extra })
    });
    if (response.ok) {
      const data = await response.json();
      return appendBot(data.reply || data.answer || 'I could not find a recommendation. Please try again.');
    }
  } catch (_) { /* Local demo responses are used when middleware is not running. */ }
  const result = demoReplies.find(item => item.match.test(message));
  appendBot(result?.text || 'I can help with weather alerts, pest symptoms and yield optimisation. Tell me your crop, location and what you are seeing.');
}

function appendBot(message) {
  const area = document.getElementById('chatBody');
  const bubble = document.createElement('div');
  bubble.className = 'bot-message';
  bubble.innerHTML = `<span class="mini-avatar">நி</span><div><small>Nelam · Farm assistant</small><p>${escapeHtml(message)}</p><time>Just now</time></div>`;
  area.appendChild(bubble);
  area.scrollTop = area.scrollHeight;
}

document.getElementById('chatForm').addEventListener('submit', event => {
  event.preventDefault();
  const input = document.getElementById('chatInput');
  const message = input.value.trim();
  if (!message) return;
  input.value = '';
  askAdvisory(message);
});
document.querySelectorAll('.quick-prompts button').forEach(button => button.addEventListener('click', () => askAdvisory(button.dataset.prompt)));
document.getElementById('newChat').addEventListener('click', () => {
  document.getElementById('chatBody').innerHTML = '<div class="bot-message"><span class="mini-avatar">நி</span><div><small>Vanakkam, Ravi! 🌱</small><p>What would you like help with on your farm today?</p><time>Just now</time></div></div>';
});

document.getElementById('cropPhoto').addEventListener('change', event => {
  const file = event.target.files?.[0];
  if (!file) return;
  const preview = document.getElementById('photoPreview');
  preview.textContent = `Photo ready: ${file.name} · Checking for a connected crop diagnostic service…`;
  addActivity('Crop photo added', 'Pest check · Just now');
  const form = new FormData();
  form.append('photo', file);
  form.append('language', document.getElementById('language').value);
  form.append('location', 'Mandya, Karnataka');
  fetch(`${API_BASE}/crop/photo`, { method: 'POST', body: form }).then(async response => {
    if (!response.ok) throw new Error('Service unavailable');
    const data = await response.json();
    appendBot(data.reply || data.assessment || 'Photo assessment received.');
    preview.textContent = `Assessment: ${data.assessment || data.reply || 'See advisory above.'}`;
  }).catch(() => { preview.textContent = `Photo ready: ${file.name} · Demo only. Connect the Sarvam Knowledge Engine and approved crop diagnostic service to analyse it.`; });
});

let recorder;
let recordingStream;
let recordedChunks = [];
async function toggleVoice() {
  if (recorder?.state === 'recording') { recorder.stop(); return; }
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
    toast('Use the IVR adapter for voice-only phones. Browser recording needs a supported device and secure connection.');
    return;
  }
  try {
    recordingStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    recorder = new MediaRecorder(recordingStream);
    recordedChunks = [];
    recorder.addEventListener('dataavailable', event => { if (event.data.size) recordedChunks.push(event.data); });
    recorder.addEventListener('stop', async () => {
      recordingStream.getTracks().forEach(track => track.stop());
      const blob = new Blob(recordedChunks, { type: recorder.mimeType || 'audio/webm' });
      toast('Sending voice message…');
      try {
        const response = await fetch(`${API_BASE}/crop/voice`, { method: 'POST', headers: { 'Content-Type': blob.type, 'X-Language': document.getElementById('language').value }, body: blob });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Voice service unavailable.');
        const user = document.createElement('div');
        user.className = 'user-message';
        user.innerHTML = `<div>${escapeHtml(data.transcript)}</div>`;
        document.getElementById('chatBody').appendChild(user);
        appendBot(data.reply);
        addActivity('Voice advisory', 'Just now');
        if (data.audioBase64) new Audio(`data:${data.audioContentType || 'audio/wav'};base64,${data.audioBase64}`).play().catch(() => {});
        toast('Voice message received');
      } catch (error) { toast(error.message || 'Connect Sarvam speech middleware to process voice.'); }
    }, { once: true });
    recorder.start();
    toast('Recording… tap the microphone again to send.');
  } catch (_) { toast('Microphone permission is needed for browser voice input.'); }
}
document.getElementById('chatVoice').addEventListener('click', toggleVoice);
document.getElementById('voiceButton').addEventListener('click', () => { navigate('crop'); toggleVoice(); });
function closeIvrSetup() { document.getElementById('ivrSetup').hidden = true; }
function showIvrSetup() {
  const modal = document.getElementById('ivrSetup');
  modal.hidden = false;
  fetch(`${API_BASE}/ivr/status`).then(response => response.json()).then(status => {
    const ready = status.active && status.publicStreamUrl;
    const missing = [];
    if (!status.hasSarvamKey) missing.push('Sarvam API key');
    if (!status.hasStreamToken) missing.push('stream token');
    if (!status.hasPublicUrl) missing.push('public WSS URL');
    if (!status.hasConversationAdapter) missing.push('conversation adapter for crop, scheme and grievance routing');
    document.getElementById('ivrStatus').textContent = ready
      ? `Stream service configured: ${status.publicStreamUrl}`
      : `Sarvam key ${status.hasSarvamKey ? 'configured' : 'missing'}. Still required: ${missing.join(', ') || 'Exotel account, number and Voicebot flow'}.`;
  }).catch(() => { document.getElementById('ivrStatus').textContent = 'Start the local server to view IVR setup status.'; });
}
document.getElementById('callHelp').addEventListener('click', showIvrSetup);
document.getElementById('closeIvr').addEventListener('click', closeIvrSetup);
document.getElementById('closeIvrDone').addEventListener('click', closeIvrSetup);
document.getElementById('ivrSetup').addEventListener('click', event => { if (event.target.id === 'ivrSetup') closeIvrSetup(); });
document.getElementById('whatsappButton').addEventListener('click', () => toast('Configure the WhatsApp Business number and webhook to enable messaging.'));
document.getElementById('allActivity').addEventListener('click', () => toast(activity.length ? `${activity.length} recent farm update${activity.length === 1 ? '' : 's'}` : 'Your activity will appear here when you use an assistant module.'));

document.getElementById('checkSchemes').addEventListener('click', async () => {
  const state = document.getElementById('state').value;
  const land = document.getElementById('land').value;
  const aadhaar = document.getElementById('aadhaar').value;
  const exclusions = document.getElementById('exclusions').value;
  const payload = { language: document.getElementById('language').value, state, landholding: land, exclusions, aadhaarLinkedBankAccount: aadhaar };
  let results;
  try {
    const response = await fetch(`${API_BASE}/schemes/eligibility`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    if (!response.ok) throw new Error('Service unavailable');
    const data = await response.json();
    results = data.matches || [];
  } catch (_) {
    results = [
      { name: 'PM-KISAN', status: land === 'own' && exclusions === 'no' ? 'possible_match' : 'manual_review', reason: 'The local scheme service is unavailable. Check the official PM-KISAN portal before relying on this screening.', action: 'Retry when connected, or verify directly with PM-KISAN.', sourceUrl: 'https://pmkisan.gov.in/' },
      { name: 'Mukhyamantri Samathuvapuram', status: 'manual_review', reason: 'Tamil Nadu housing allotment programme; not a general farmer benefit.', action: 'Ask the local Block Development Office about current allotments.', sourceUrl: 'https://tnrd.tn.gov.in/schemes/st_samathuvapuram.html' },
      { name: 'Krushak Yojana', status: 'manual_review', reason: 'The exact programme and state are unclear.', action: 'Provide the exact scheme name and state to an agriculture office.', sourceUrl: 'https://agri.odisha.gov.in/en/agriculturedepartmentagricultu/kalia' }
    ];
  }
  lastSchemeResults = results;
  renderSchemeResults();
  document.querySelector('[data-step="1"]').classList.remove('active');
  document.getElementById('schemeResults').classList.add('active');
  document.getElementById('stepLabel').textContent = 'Results';
  document.getElementById('progressBar').style.width = '100%';
  addActivity('Scheme eligibility checked', '3 schemes reviewed');
});
document.getElementById('editAnswers').addEventListener('click', () => {
  document.getElementById('schemeResults').classList.remove('active');
  document.querySelector('[data-step="1"]').classList.add('active');
  document.getElementById('stepLabel').textContent = 'Step 1 of 2';
  document.getElementById('progressBar').style.width = '50%';
});

document.getElementById('grievanceForm').addEventListener('submit', async event => {
  event.preventDefault();
  if (!document.getElementById('consent').checked) return;
  const caseId = `NL-2026-${Math.floor(1000 + Math.random() * 9000)}`;
  const payload = { category: document.getElementById('issueCategory').value, description: document.getElementById('issueText').value, village: document.getElementById('village').value, language: document.getElementById('language').value, consent: true };
  let status = 'Received · Demo reference';
  try {
    const response = await fetch(`${API_BASE}/grievances`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    if (response.ok) { const data = await response.json(); payload.caseId = data.id || data.caseId; status = data.demo ? 'Demo reference stored locally; not sent to a department' : 'Submitted to the connected grievance service'; }
  } catch (_) { /* Demo case only; no authority receives this submission. */ }
  const id = payload.caseId || caseId;
  document.getElementById('grievanceFormWrap').hidden = true;
  const success = document.getElementById('grievanceSuccess');
  success.hidden = false;
  success.className = 'grievance-success';
  success.innerHTML = `<div class="result-mark">✓</div><h2>Grievance recorded</h2><p>This is a ${escapeHtml(status.toLowerCase())} in the prototype. A live deployment must connect the grievance service to the relevant department.</p><div class="case-id">Reference ID &nbsp; <b>${escapeHtml(id)}</b></div><button class="outline-button" type="button" id="anotherGrievance">＋ Raise another issue</button>`;
  success.querySelector('#anotherGrievance').addEventListener('click', () => { success.hidden = true; document.getElementById('grievanceFormWrap').hidden = false; document.getElementById('grievanceForm').reset(); });
  document.getElementById('trackId').value = id;
  addActivity('Grievance recorded', id);
});

document.getElementById('trackForm').addEventListener('submit', async event => {
  event.preventDefault();
  const id = document.getElementById('trackId').value.trim();
  let message = 'No live grievance system is connected. This reference can be tracked after the department grievance API is configured.';
  try {
    const response = await fetch(`${API_BASE}/grievances/${encodeURIComponent(id)}`);
    if (response.ok) { const item = await response.json(); message = `Status: ${item.status || 'In progress'} · Updated ${item.updatedAt ? new Date(item.updatedAt).toLocaleString() : 'recently'}${item.demo ? ' · Demo record' : ''}`; }
  } catch (_) { /* Keep the local demo explanation. */ }
  document.getElementById('trackResult').innerHTML = `<div class="tip"><b>${escapeHtml(id)}</b><p>${escapeHtml(message)}</p></div>`;
});

document.getElementById('today').textContent = new Intl.DateTimeFormat('en', { weekday: 'long', day: '2-digit', month: 'long' }).format(new Date()).toUpperCase();
