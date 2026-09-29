const API_BASE = window.NELAM_API_BASE || '/api';
const views = ['home', 'crop', 'schemes', 'grievance'];
const activity = [];
let toastTimer;
let mem0Available = false;
const memoryCopy = {
  en: { label: 'Optionally save short chat summaries to Mem0, linked to your phone number.', checking: 'Checking whether memory storage is available…', unavailable: 'Mem0 is not configured on this service, so nothing will be sent or saved.', off: 'Enter your phone number below to link summaries to your account.', on: 'Memory is on for this phone number. You can turn it off for future chats.', saved: 'Summary sent to Mem0 for this phone-linked account.' },
  ta: { label: 'தொலைபேசி எண்ணுடன் இணைத்து உரையாடல் சுருக்கங்களை Mem0-இல் விருப்பமாகச் சேமிக்கவும்.', checking: 'நினைவக சேமிப்பு உள்ளதா எனச் சரிபார்க்கிறது…', unavailable: 'இந்த சேவையில் Mem0 அமைக்கப்படவில்லை; எதுவும் அனுப்பவோ சேமிக்கவோ மாட்டோம்.', off: 'சுருக்கங்களை உங்கள் கணக்குடன் இணைக்க கீழே தொலைபேசி எண்ணை உள்ளிடவும்.', on: 'இந்த எண்ணுக்கான நினைவகம் இயக்கப்பட்டுள்ளது. அடுத்த உரையாடல்களுக்கு அணைக்கலாம்.', saved: 'இந்த தொலைபேசி கணக்கிற்கான சுருக்கம் Mem0-க்கு அனுப்பப்பட்டது.' },
  kn: { label: 'ಫೋನ್ ಸಂಖ್ಯೆಗೆ ಜೋಡಿಸಿ ಚಾಟ್ ಸಾರಾಂಶಗಳನ್ನು Mem0 ನಲ್ಲಿ ಐಚ್ಛಿಕವಾಗಿ ಉಳಿಸಿ.', checking: 'ಮೆಮೊರಿ ಸಂಗ್ರಹ ಲಭ್ಯವಿದೆಯೇ ಎಂದು ಪರಿಶೀಲಿಸಲಾಗುತ್ತಿದೆ…', unavailable: 'ಈ ಸೇವೆಯಲ್ಲಿ Mem0 ಹೊಂದಿಸಿಲ್ಲ; ಯಾವುದನ್ನೂ ಕಳುಹಿಸುವುದಿಲ್ಲ ಅಥವಾ ಉಳಿಸುವುದಿಲ್ಲ.', off: 'ಸಾರಾಂಶಗಳನ್ನು ಖಾತೆಗೆ ಜೋಡಿಸಲು ಕೆಳಗೆ ಫೋನ್ ಸಂಖ್ಯೆಯನ್ನು ನಮೂದಿಸಿ.', on: 'ಈ ಫೋನ್ ಸಂಖ್ಯೆಗೆ ಮೆಮೊರಿ ಸಕ್ರಿಯವಾಗಿದೆ. ಮುಂದಿನ ಚಾಟ್‌ಗಳಿಗೆ ನಿಲ್ಲಿಸಬಹುದು.', saved: 'ಈ ಫೋನ್ ಖಾತೆಯ ಸಾರಾಂಶವನ್ನು Mem0 ಗೆ ಕಳುಹಿಸಲಾಗಿದೆ.' }
};

function updateMemoryConsentCopy(saved = false) {
  const language = document.getElementById('language')?.value || 'en';
  const copy = memoryCopy[language] || memoryCopy.en;
  const checkbox = document.getElementById('rememberChat');
  if (!checkbox) return;
  let consent = false;
  try { consent = localStorage.getItem('nelam-memory-consent') === 'yes'; } catch (_) { /* Storage may be unavailable in private browsing. */ }
  checkbox.disabled = !mem0Available;
  checkbox.checked = mem0Available && consent;
  document.getElementById('memoryConsentCopy').textContent = copy.label;
  document.getElementById('memoryConsentStatus').textContent = !mem0Available ? copy.unavailable : saved ? copy.saved : checkbox.checked ? copy.on : copy.off;
}

fetch(`${API_BASE}/memory/status`).then(response => response.json()).then(status => {
  mem0Available = Boolean(status.configured);
  updateMemoryConsentCopy();
}).catch(() => updateMemoryConsentCopy());

document.getElementById('rememberChat').addEventListener('change', event => {
  try { localStorage.setItem('nelam-memory-consent', event.target.checked ? 'yes' : 'no'); } catch (_) { /* Consent remains for this page view. */ }
  updateMemoryConsentCopy();
});

const profileForm = document.getElementById('farmerProfileForm');
const profileInputs = { crop: 'profileCrop', fertilizerChoices: 'profileFertilizer', soilType: 'profileSoil', irrigation: 'profileIrrigation', farmLocation: 'profileLocation' };
function profileMessage(en, ta, kn) { const lang = document.getElementById('language').value; return lang === 'ta' ? ta : lang === 'kn' ? kn : en; }
async function loadFarmerProfile() {
  const phoneNumber = document.getElementById('profilePhone').value.trim();
  if (!phoneNumber) return;
  const status = document.getElementById('profileStatus');
  status.textContent = profileMessage('Loading saved preferences…', 'சேமித்த விருப்பங்களை ஏற்றுகிறது…', 'ಉಳಿಸಿದ ಆದ್ಯತೆಗಳನ್ನು ಲೋಡ್ ಮಾಡಲಾಗುತ್ತಿದೆ…');
  try {
    const response = await fetch(`${API_BASE}/profile`, { headers: { 'X-Farmer-Phone': phoneNumber } });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Could not load profile');
    for (const [key, id] of Object.entries(profileInputs)) document.getElementById(id).value = data.profile?.[key] || '';
    status.textContent = data.storage === 'postgres' ? profileMessage('Saved profile loaded from the database.', 'தரவுத்தளத்தில் சேமித்த சுயவிவரம் ஏற்றப்பட்டது.', 'ಡೇಟಾಬೇಸ್‌ನಿಂದ ಉಳಿಸಿದ ಪ್ರೊಫೈಲ್ ಲೋಡ್ ಆಯಿತು.') : profileMessage('Local demo profile loaded. Connect a database for durable storage.', 'உள்ளூர் மாதிரி சுயவிவரம் ஏற்றப்பட்டது. நீடித்த சேமிப்புக்கு தரவுத்தளத்தை இணைக்கவும்.', 'ಸ್ಥಳೀಯ ಡೆಮೊ ಪ್ರೊಫೈಲ್ ಲೋಡ್ ಆಯಿತು. ಶಾಶ್ವತ ಸಂಗ್ರಹಕ್ಕೆ ಡೇಟಾಬೇಸ್ ಸಂಪರ್ಕಿಸಿ.');
  } catch (_) { status.textContent = profileMessage('Enter a valid phone number to load a profile.', 'சுயவிவரத்தை ஏற்ற சரியான தொலைபேசி எண்ணை உள்ளிடவும்.', 'ಪ್ರೊಫೈಲ್ ಲೋಡ್ ಮಾಡಲು ಸರಿಯಾದ ಫೋನ್ ಸಂಖ್ಯೆಯನ್ನು ನಮೂದಿಸಿ.'); }
}
document.getElementById('profilePhone').addEventListener('blur', loadFarmerProfile);
profileForm.addEventListener('submit', async event => {
  event.preventDefault();
  const status = document.getElementById('profileStatus');
  const phoneNumber = document.getElementById('profilePhone').value.trim();
  const preferences = Object.fromEntries(Object.entries(profileInputs).map(([key, id]) => [key, document.getElementById(id).value.trim()]));
  preferences.language = document.getElementById('language').value;
  status.textContent = profileMessage('Saving…', 'சேமிக்கிறது…', 'ಉಳಿಸಲಾಗುತ್ತಿದೆ…');
  try {
    const response = await fetch(`${API_BASE}/profile`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phoneNumber, preferences }) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Save failed');
    status.textContent = data.storage === 'postgres' ? profileMessage('Preferences saved to the database.', 'விருப்பங்கள் தரவுத்தளத்தில் சேமிக்கப்பட்டன.', 'ಆದ್ಯತೆಗಳನ್ನು ಡೇಟಾಬೇಸ್‌ನಲ್ಲಿ ಉಳಿಸಲಾಗಿದೆ.') : profileMessage('Saved in local demo storage; connect a database for durable storage.', 'உள்ளூர் மாதிரியில் சேமிக்கப்பட்டது; நீடித்த சேமிப்புக்கு தரவுத்தளத்தை இணைக்கவும்.', 'ಸ್ಥಳೀಯ ಡೆಮೊದಲ್ಲಿ ಉಳಿಸಲಾಗಿದೆ; ಶಾಶ್ವತ ಸಂಗ್ರಹಕ್ಕೆ ಡೇಟಾಬೇಸ್ ಸಂಪರ್ಕಿಸಿ.');
  } catch (error) { status.textContent = error.message || profileMessage('Could not save preferences.', 'விருப்பங்களைச் சேமிக்க முடியவில்லை.', 'ಆದ್ಯತೆಗಳನ್ನು ಉಳಿಸಲಾಗಲಿಲ್ಲ.'); }
});

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
  updateMemoryConsentCopy();
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
      body: JSON.stringify({ message, language: document.getElementById('language').value, location: document.getElementById('profileLocation').value || 'Mandya, Karnataka', phoneNumber: document.getElementById('profilePhone').value.trim(), rememberChat: document.getElementById('rememberChat').checked, ...extra })
    });
    if (response.ok) {
      const data = await response.json();
      if (data.memory?.saved) updateMemoryConsentCopy(true);
      if (data.memory?.phoneRequired) document.getElementById('memoryConsentStatus').textContent = profileMessage('Add a valid phone number in My farm preferences to link chat memory.', 'உரையாடல் நினைவகத்தை இணைக்க My farm preferences பகுதியில் சரியான தொலைபேசி எண்ணைச் சேர்க்கவும்.', 'ಚಾಟ್ ಮೆಮೊರಿಯನ್ನು ಜೋಡಿಸಲು My farm preferences ನಲ್ಲಿ ಸರಿಯಾದ ಫೋನ್ ಸಂಖ್ಯೆಯನ್ನು ಸೇರಿಸಿ.');
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

const grievancePortals = {
  state(state) {
    return state === 'Tamil Nadu'
      ? { label: 'Tamil Nadu CM Helpline', url: 'https://cmhelpline.tnega.org/portal/en/home', note: 'Statewide public grievance portal; choose the responsible department.' }
      : { label: 'Karnataka Janaspandana (iPGRS)', url: 'https://ipgrs.karnataka.gov.in/', note: 'Karnataka’s public grievance system; choose the relevant department or service.' };
  },
  forIssue(category, state) {
    const links = [];
    links.push({ ...grievancePortals.state(state), note: `${grievancePortals.state(state).note} Start here first. Tamil Nadu follow-up: use the one-time appeal/reopen option or call 1100. Karnataka follow-up: check Janaspandana or call 1902.` });
    if (category === 'Crop damage / insurance') links.push({ label: 'PM Fasal Bima Yojana (PMFBY)', url: 'https://pmfby.gov.in/', note: 'Report crop loss or raise a crop insurance query. Helpline: 14447.' });
    if (category === 'Scheme payment not received') links.push({ label: 'PM-KISAN grievance form', url: 'https://www.pmkisan.gov.in/Grievance.aspx', note: 'Use this for PM-KISAN registration, installment or beneficiary issues.' });
    links.push({ label: 'CPGRAMS — Central Government grievance portal', url: 'https://pgportal.gov.in/', note: 'For a Central Government department, or escalation where appropriate.' });
    return links;
  }
};

const trackingPortalOptions = {
  'Tamil Nadu CM Helpline': 'https://cmhelpline.tnega.org/portal/en/home',
  'Karnataka Janaspandana (iPGRS)': 'https://ipgrs.karnataka.gov.in/',
  'PM Fasal Bima Yojana (PMFBY)': 'https://pmfby.gov.in/',
  'PM-KISAN grievance form': 'https://www.pmkisan.gov.in/Grievance.aspx',
  'CPGRAMS': 'https://pgportal.gov.in/'
};
function portalForTracking(state, category, level) {
  if (level === 'higher') return state === 'Tamil Nadu' ? 'Tamil Nadu CM Helpline' : 'Karnataka Janaspandana (iPGRS)';
  return state === 'Tamil Nadu' ? 'Tamil Nadu CM Helpline' : 'Karnataka Janaspandana (iPGRS)';
}
function refreshTrackingPortalOptions() {
  const state = document.getElementById('trackingState').value;
  const category = document.getElementById('trackingCategory').value;
  const level = document.getElementById('trackingLevel').value;
  const preferred = portalForTracking(state, category, level);
  const allowed = level === 'higher'
    ? (state === 'Tamil Nadu' ? ['Tamil Nadu CM Helpline'] : ['Karnataka Janaspandana (iPGRS)'])
    : [state === 'Tamil Nadu' ? 'Tamil Nadu CM Helpline' : 'Karnataka Janaspandana (iPGRS)', preferred, ...(category === 'Crop damage / insurance' ? ['PM Fasal Bima Yojana (PMFBY)'] : category === 'Scheme payment not received' ? ['PM-KISAN grievance form'] : [])].filter((item, index, all) => all.indexOf(item) === index);
  const select = document.getElementById('trackingPortal');
  select.innerHTML = allowed.map(name => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join('');
}
['trackingState','trackingCategory','trackingLevel'].forEach(id => document.getElementById(id).addEventListener('change', refreshTrackingPortalOptions));
refreshTrackingPortalOptions();

function renderDepartmentLinks(target, category, state) {
  const links = grievancePortals.forIssue(category, state);
  target.innerHTML = `<b>Suggested official filing portals</b><p>Choose the portal that matches your issue. Your description is not sent automatically.</p><div class="department-link-list">${links.map(link => `<a class="department-link" href="${link.url}" target="_blank" rel="noopener noreferrer"><span><b>${escapeHtml(link.label)}</b><small>${escapeHtml(link.note)}</small></span><span aria-hidden="true">↗</span></a>`).join('')}</div>`;
}

const departmentRouting = document.getElementById('departmentRouting');
const issueCategory = document.getElementById('issueCategory');
const grievanceState = document.getElementById('grievanceState');
const updateDepartmentRouting = () => renderDepartmentLinks(departmentRouting, issueCategory.value, grievanceState.value);
issueCategory.addEventListener('change', updateDepartmentRouting);
grievanceState.addEventListener('change', updateDepartmentRouting);
updateDepartmentRouting();

const grievanceForm = document.getElementById('grievanceForm');
grievanceForm.noValidate = true;
let filingDetailsAdded = false;
function addFilingDetails() {
  if (filingDetailsAdded) return;
  const state = grievanceState.value;
  const isKarnataka = state === 'Karnataka';
  const profilePhone = document.getElementById('profilePhone')?.value.trim() || '';
  const location = document.getElementById('profileLocation')?.value.trim() || '';
  const addressParts = location.split(',').map(part => part.trim()).filter(Boolean);
  const required = '<span class="required-mark">Required</span>';
  const field = (id, label, placeholder, value = '', requiredField = true, type = 'text') => `<label>${label}${requiredField ? required : '<span class="optional-mark">Optional</span>'}<input id="${id}" name="${id}" type="${type}" ${requiredField ? 'data-required="true"' : ''} value="${escapeHtml(value)}" placeholder="${escapeHtml(placeholder)}" autocomplete="${id === 'filingPhone' ? 'tel' : 'off'}" /></label>`;
  const fields = `<div class="filing-details" id="filingDetails"><h3>Details needed for ${isKarnataka ? 'Janaspandana' : 'Tamil Nadu CM Helpline'}</h3><p>We’ve prepared the portal-specific fields. Please complete anything missing; these details stay in this browser until you open the government portal.</p>${field('filingName','Full name as on your grievance account','Your full name')}${field('filingPhone','Mobile number','+91 98765 43210',profilePhone,true,'tel')}${field('filingDistrict','District','District name',addressParts.at(-1) || '')}${isKarnataka ? field('filingTaluk','Taluk','Taluk name') : ''}${field('filingVillage','Village / Gram Panchayat','Village name',document.getElementById('village').value.trim())}${isKarnataka ? field('filingHouse','House number','House or door number') + field('filingStreet','Street address','Street') + field('filingLocality','Locality','Locality') + field('filingLandmark','Landmark','Nearby landmark', '', false) + field('filingPin','PIN code','6-digit PIN code','',true,'text') : field('filingAddress','Address / locality','Street or locality',location,false)}${!isKarnataka ? `<label>Department<select id="filingDepartment" data-required="true"><option value="">Choose a department</option><option>Agriculture</option><option>Revenue</option><option>Rural Development / Panchayat</option><option>Electricity</option><option>Other Petitions — help me identify it</option></select></label>` : ''}${field('filingIncidentDate','Date of incident (if known)','', '',false,'date')}<div class="missing-details" id="missingFilingDetails" aria-live="polite"></div><small class="portal-limit">${isKarnataka ? 'Official login/OTP, CAPTCHA, attachments and final submission remain on Janaspandana.' : 'Tamil Nadu CM Helpline accepts Tamil or English. Official login/OTP, attachments and final submission remain on its portal.'} This draft does not ask for Aadhaar. Enter sensitive identifiers only directly on the official government site if it requires them.</small></div>`;
  grievanceForm.querySelector('.primary-button').insertAdjacentHTML('beforebegin', fields);
  grievanceForm.querySelector('.primary-button').innerHTML = 'Prepare filled form <span>→</span>';
  filingDetailsAdded = true;
}
grievanceForm.addEventListener('submit', event => {
  event.preventDefault();
  const consent = document.getElementById('consent');
  if (!consent.checked) { toast('Please confirm that you will review and submit on the official portal.'); consent.focus(); return; }
  const issueDetails = document.getElementById('issueText');
  const issueVillage = document.getElementById('village');
  if (!issueDetails.value.trim()) { toast('Please describe what happened so I can prepare the complaint.'); issueDetails.focus(); return; }
  if (!issueVillage.value.trim()) { toast('Please tell me the village or nearest town.'); issueVillage.focus(); return; }
  if (!filingDetailsAdded) { grievanceState.disabled = true; addFilingDetails(); document.getElementById('filingName').focus(); toast('I’ve filled in details already provided. Please answer the remaining portal questions.'); return; }
  const missing = [...grievanceForm.querySelectorAll('[data-required="true"]')].filter(input => !input.value.trim());
  const missingPanel = document.getElementById('missingFilingDetails');
  if (missing.length) {
    missingPanel.innerHTML = `<b>I still need these details:</b><ul>${missing.map(input => `<li>${escapeHtml(input.closest('label').childNodes[0].textContent.trim())}</li>`).join('')}</ul>`;
    missing[0].focus(); toast(`Please add ${missing[0].closest('label').childNodes[0].textContent.trim()}.`); return;
  }
  const phone = document.getElementById('filingPhone').value.trim();
  if (!/^\+?[0-9\s()-]{10,17}$/.test(phone)) { missingPanel.innerHTML = '<b>Enter a valid phone number including country code, for example +91 98765 43210.</b>'; document.getElementById('filingPhone').focus(); return; }
  const pin = document.getElementById('filingPin');
  if (pin && !/^\d{6}$/.test(pin.value.trim())) { missingPanel.innerHTML = '<b>Enter a valid 6-digit PIN code.</b>'; pin.focus(); return; }
  missingPanel.textContent = '';
  const category = issueCategory.value;
  const state = grievanceState.value;
  const description = document.getElementById('issueText').value.trim();
  const village = document.getElementById('village').value.trim();
  const details = [...grievanceForm.querySelectorAll('#filingDetails input, #filingDetails select')].filter(input => input.value.trim()).map(input => `${input.closest('label').childNodes[0].textContent.trim()}: ${input.value.trim()}`);
  const packet = `${details.join('\n')}\nIssue category: ${category}\nState: ${state}\nVillage / town: ${village}\nDepartment: ${document.getElementById('filingDepartment')?.value || 'Select the responsible department on the portal'}\n\nIssue details:\n${description}`;
  document.getElementById('grievanceFormWrap').hidden = true;
  const success = document.getElementById('grievanceSuccess');
  success.hidden = false;
  success.className = 'grievance-success';
  const links = grievancePortals.forIssue(category, state);
  const localPortal = links[0];
  success.innerHTML = `<div class="result-mark">✓</div><h2>Your filing draft is ready</h2><p>I filled the app’s filing draft with your answers. Nothing has been sent and no tracking ID exists yet. Copy the prepared details, open the local portal and paste them into its matching fields. The portal may ask you to sign in with OTP, complete CAPTCHA, choose a department, attach documents and submit.</p><div class="filing-preview"><b>Prepared details</b><pre>${escapeHtml(packet)}</pre></div><div class="department-link-list">${links.map(link => `<a class="department-link" href="${link.url}" target="_blank" rel="noopener noreferrer"><span><b>${escapeHtml(link.label)}</b><small>${escapeHtml(link.note)}</small></span><span aria-hidden="true">↗</span></a>`).join('')}</div><button class="primary-button" type="button" id="copyAndOpenPortal">Copy draft and open local portal <span>↗</span></button> <button class="outline-button" type="button" id="copyGrievanceSummary">Copy draft only</button> <button class="outline-button" type="button" id="editGrievanceDraft">← Edit answers</button> <button class="outline-button" type="button" id="anotherGrievance">＋ Start again</button><small class="copy-status" id="copySummaryStatus" aria-live="polite"></small>`;
  const copyDraft = async () => {
    const status = success.querySelector('#copySummaryStatus');
    try { await navigator.clipboard.writeText(packet); status.textContent = 'Draft copied. Paste each answer into its matching portal field and check everything before submitting.'; return true; }
    catch { status.textContent = 'Clipboard unavailable. Use the prepared details shown above and copy them manually.'; return false; }
  };
  success.querySelector('#copyGrievanceSummary').addEventListener('click', copyDraft);
  success.querySelector('#copyAndOpenPortal').addEventListener('click', async () => { await copyDraft(); window.open(localPortal.url, '_blank', 'noopener,noreferrer'); });
  success.querySelector('#editGrievanceDraft').addEventListener('click', () => { success.hidden = true; document.getElementById('grievanceFormWrap').hidden = false; document.getElementById('filingName').focus(); });
  success.querySelector('#anotherGrievance').addEventListener('click', () => { success.hidden = true; document.getElementById('grievanceFormWrap').hidden = false; grievanceForm.reset(); grievanceForm.querySelector('#filingDetails')?.remove(); filingDetailsAdded = false; grievanceState.disabled = false; grievanceForm.querySelector('.primary-button').innerHTML = 'Get filing links <span>→</span>'; issueCategory.value = 'Crop damage / insurance'; grievanceState.value = 'Karnataka'; updateDepartmentRouting(); });
});

function renderSavedGrievances(records, container, phone) {
  if (!records.length) { container.innerHTML = '<p class="tracking-empty">No saved IDs found for this phone number.</p>'; return; }
  const groups = new Map();
  records.forEach(row => { if (!groups.has(row.caseId)) groups.set(row.caseId, []); groups.get(row.caseId).push(row); });
  container.innerHTML = [...groups.entries()].map(([caseId, items]) => {
    const first = items.find(item => item.authorityLevel === 'local') || items[items.length - 1];
    const unresolved = items.some(item => ['unresolved','in_progress'].includes(item.status));
    const stages = items.map(item => `<div class="saved-stage"><b>${item.authorityLevel === 'local' ? 'Local / first portal' : 'Higher-level follow-up'} · ${escapeHtml(item.portal)}</b><small>ID: ${escapeHtml(item.trackingId)} · Status saved: ${escapeHtml(item.status.replace('_',' '))} · ${new Date(item.updatedAt || item.filedAt).toLocaleDateString()}</small><div><a href="${escapeHtml(item.portalUrl)}" target="_blank" rel="noopener noreferrer">Open portal to check live status ↗</a><select data-status-id="${escapeHtml(item.id)}" aria-label="Update saved status"><option value="submitted" ${item.status==='submitted'?'selected':''}>Submitted</option><option value="in_progress" ${item.status==='in_progress'?'selected':''}>In progress</option><option value="unresolved" ${item.status==='unresolved'?'selected':''}>Still unresolved</option><option value="resolved" ${item.status==='resolved'?'selected':''}>Resolved</option></select></div></div>`).join('');
    const escalate = unresolved ? `<button type="button" class="outline-button escalate-grievance" data-case-id="${escapeHtml(caseId)}" data-state="${escapeHtml(first.state)}" data-category="${escapeHtml(first.category)}">Add higher-level tracking ID</button>` : '';
    return `<article class="saved-grievance"><b>${escapeHtml(first.category)} · ${escapeHtml(first.state)}</b>${stages}<small class="tracking-note">Saved status is entered by you; it is not confirmed by the government system.</small>${escalate}</article>`;
  }).join('');
  container.querySelectorAll('[data-status-id]').forEach(select => select.addEventListener('change', async () => {
    try { const response = await fetch(`/api/grievance-tracking/${encodeURIComponent(select.dataset.statusId)}`, { method:'PUT', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ phoneNumber: phone, status: select.value }) }); const result = await response.json(); if (!response.ok) throw new Error(result.error); toast('Saved status updated'); }
    catch (error) { toast(error.message || 'Could not update status'); }
  }));
  container.querySelectorAll('.escalate-grievance').forEach(button => button.addEventListener('click', () => {
    document.getElementById('trackingCaseId').value = button.dataset.caseId;
    document.getElementById('trackingState').value = button.dataset.state;
    document.getElementById('trackingCategory').value = button.dataset.category;
    document.getElementById('trackingLevel').value = 'higher'; refreshTrackingPortalOptions();
    document.getElementById('trackingPhone').value = phone; document.getElementById('trackingFindPhone').value = phone;
    document.getElementById('trackingId').focus();
    toast('After filing the appeal, enter the new authority’s tracking ID');
  }));
}
document.getElementById('trackingFindForm').addEventListener('submit', async event => {
  event.preventDefault();
  const phone = document.getElementById('trackingFindPhone').value.trim();
  const target = document.getElementById('savedGrievances'); target.innerHTML = '<p class="tracking-empty">Loading saved grievances…</p>';
  try { const response = await fetch('/api/grievance-tracking', { headers:{'X-Farmer-Phone': phone} }); const result = await response.json(); if (!response.ok) throw new Error(result.error); renderSavedGrievances(result.grievances, target, phone); }
  catch (error) { target.innerHTML = `<p class="tracking-empty">${escapeHtml(error.message || 'Could not load saved grievances.')}</p>`; }
});
document.getElementById('trackingSaveForm').addEventListener('submit', async event => {
  event.preventDefault();
  const phone = document.getElementById('trackingPhone').value.trim();
  const body = { phoneNumber:phone, caseId:document.getElementById('trackingCaseId').value || undefined, state:document.getElementById('trackingState').value, category:document.getElementById('trackingCategory').value, authorityLevel:document.getElementById('trackingLevel').value, portal:document.getElementById('trackingPortal').value, portalUrl:trackingPortalOptions[document.getElementById('trackingPortal').value], trackingId:document.getElementById('trackingId').value.trim(), status:document.getElementById('trackingStatus').value, consent:document.getElementById('trackingConsent').checked };
  try {
    const response = await fetch('/api/grievance-tracking', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body) }); const result = await response.json(); if (!response.ok) throw new Error(result.error);
    document.getElementById('trackingFindPhone').value = phone; document.getElementById('trackingCaseId').value = ''; document.getElementById('trackingId').value = ''; document.getElementById('trackingConsent').checked = false;
    const findForm = document.getElementById('trackingFindForm'); findForm.requestSubmit(); toast('Official tracking ID saved');
  } catch (error) { toast(error.message || 'Could not save tracking ID'); }
});

document.getElementById('today').textContent = new Intl.DateTimeFormat('en', { weekday: 'long', day: '2-digit', month: 'long' }).format(new Date()).toUpperCase();
