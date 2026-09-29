const API_BASE = window.NELAM_API_BASE || '/api';
const views = ['home', 'crop', 'schemes', 'grievance'];
const activity = [];
let toastTimer;
let mem0Available = false;
let signedInUser = null;

const authScreen = document.getElementById('authScreen');
const appShell = document.getElementById('appShell');
const authStatus = document.getElementById('authStatus');
let authMode = 'login';
function setAuthMode(mode, message = '') {
  authMode = mode;
  const registering = mode === 'register';
  document.getElementById('authLoginMode').classList.toggle('active', !registering);
  document.getElementById('authRegisterMode').classList.toggle('active', registering);
  document.getElementById('authLoginMode').setAttribute('aria-selected', String(!registering));
  document.getElementById('authRegisterMode').setAttribute('aria-selected', String(registering));
  document.getElementById('authNameField').hidden = !registering;
  document.getElementById('authName').required = registering;
  document.getElementById('authConfirmField').hidden = !registering;
  document.getElementById('authConfirm').required = registering;
  document.getElementById('authPassword').autocomplete = registering ? 'new-password' : 'current-password';
  document.getElementById('authTitle').textContent = registering ? 'Create your account' : 'Welcome to Nelam';
  document.getElementById('authDescription').textContent = registering ? 'Choose a phone number or email and create a password for your farm account.' : 'Sign in with your phone number or email and password.';
  document.getElementById('authSubmit').innerHTML = registering ? 'Register <span>→</span>' : 'Sign in <span>→</span>';
  authStatus.textContent = message;
}
async function enterApp(user) {
  signedInUser = user;
  authScreen.hidden = true;
  appShell.hidden = false;
  const name = user.name || 'Farmer';
  document.getElementById('sidebarUserName').textContent = name;
  document.getElementById('welcomeName').textContent = name;
  document.getElementById('userAvatar').textContent = [...name][0]?.toUpperCase() || 'F';
  updateMemoryConsentCopy();
  await loadFarmerProfile();
}
async function refreshAuth() {
  try {
    const [statusResponse, sessionResponse] = await Promise.all([fetch(`${API_BASE}/auth/status`), fetch(`${API_BASE}/auth/session`)]);
    const status = await statusResponse.json(); const session = await sessionResponse.json();
    document.getElementById('authSubmit').disabled = !status.enabled;
    if (!status.enabled) { setAuthMode('login', 'Sign-in is unavailable. Configure a stable session secret on the server.'); return; }
    if (!session.authenticated) { setAuthMode('login'); return; }
    await enterApp(session.user);
  } catch (_) { setAuthMode('login', 'Could not connect to sign-in. Please refresh and try again.'); }
}
document.getElementById('authLoginMode').addEventListener('click', () => setAuthMode('login'));
document.getElementById('authRegisterMode').addEventListener('click', () => setAuthMode('register'));
document.getElementById('authForm').addEventListener('submit', async event => {
  event.preventDefault();
  if (authMode === 'register' && document.getElementById('authPassword').value !== document.getElementById('authConfirm').value) { authStatus.textContent = 'The passwords do not match.'; return; }
  const button = document.getElementById('authSubmit'); button.disabled = true; authStatus.textContent = authMode === 'register' ? 'Creating your account…' : 'Signing in…';
  try {
    const route = authMode === 'register' ? 'register' : 'login';
    const payload = { contact: document.getElementById('authContact').value.trim(), password: document.getElementById('authPassword').value };
    if (authMode === 'register') payload.name = document.getElementById('authName').value.trim();
    const response = await fetch(`${API_BASE}/auth/${route}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Could not access your account.'); await enterApp(result.user);
  } catch (error) { authStatus.textContent = error.message; }
  finally { button.disabled = false; }
});
document.getElementById('logoutButton').addEventListener('click', async () => { await fetch(`${API_BASE}/auth/logout`, { method: 'POST' }); signedInUser = null; appShell.hidden = true; authScreen.hidden = false; document.getElementById('authPassword').value = ''; document.getElementById('authConfirm').value = ''; setAuthMode('login', 'You have signed out.'); });
refreshAuth();
const memoryCopy = {
  en: { label: 'Optionally save short chat summaries to Mem0 for this account.', checking: 'Checking whether memory storage is available…', unavailable: 'Mem0 is not configured on this service, so nothing will be sent or saved.', off: 'Turn on to link summaries to your account.', on: 'Memory is on for this account. You can turn it off for future chats.', saved: 'Summary sent to Mem0 for this account.' },
  hi: { label: 'इस खाते के लिए चैट सारांश Mem0 में वैकल्पिक रूप से सहेजें।', checking: 'जाँच रहे हैं कि मेमोरी स्टोरेज उपलब्ध है या नहीं…', unavailable: 'इस सेवा पर Mem0 सेट नहीं है, इसलिए कुछ भी भेजा या सहेजा नहीं जाएगा।', off: 'सारांशों को अपने खाते से जोड़ने के लिए चालू करें।', on: 'इस खाते के लिए मेमोरी चालू है। आगे की चैट के लिए इसे बंद कर सकते हैं।', saved: 'इस खाते का सारांश Mem0 को भेजा गया।' },
  ta: { label: 'இந்தக் கணக்கிற்காக உரையாடல் சுருக்கங்களை Mem0-இல் விருப்பமாகச் சேமிக்கவும்.', checking: 'நினைவக சேமிப்பு உள்ளதா எனச் சரிபார்க்கிறது…', unavailable: 'இந்த சேவையில் Mem0 அமைக்கப்படவில்லை; எதுவும் அனுப்பவோ சேமிக்கவோ மாட்டோம்.', off: 'சுருக்கங்களை உங்கள் கணக்குடன் இணைக்க இயக்கவும்.', on: 'இந்தக் கணக்கிற்கு நினைவகம் இயக்கப்பட்டுள்ளது. அடுத்த உரையாடல்களுக்கு அணைக்கலாம்.', saved: 'இந்தக் கணக்கிற்கான சுருக்கம் Mem0-க்கு அனுப்பப்பட்டது.' },
  kn: { label: 'ಈ ಖಾತೆಗೆ ಚಾಟ್ ಸಾರಾಂಶಗಳನ್ನು Mem0 ನಲ್ಲಿ ಐಚ್ಛಿಕವಾಗಿ ಉಳಿಸಿ.', checking: 'ಮೆಮೊರಿ ಸಂಗ್ರಹ ಲಭ್ಯವಿದೆಯೇ ಎಂದು ಪರಿಶೀಲಿಸಲಾಗುತ್ತಿದೆ…', unavailable: 'ಈ ಸೇವೆಯಲ್ಲಿ Mem0 ಹೊಂದಿಸಿಲ್ಲ; ಯಾವುದನ್ನೂ ಕಳುಹಿಸುವುದಿಲ್ಲ ಅಥವಾ ಉಳಿಸುವುದಿಲ್ಲ.', off: 'ಸಾರಾಂಶಗಳನ್ನು ನಿಮ್ಮ ಖಾತೆಗೆ ಜೋಡಿಸಲು ಸಕ್ರಿಯಗೊಳಿಸಿ.', on: 'ಈ ಖಾತೆಗೆ ಮೆಮೊರಿ ಸಕ್ರಿಯವಾಗಿದೆ. ಮುಂದಿನ ಚಾಟ್‌ಗಳಿಗೆ ನಿಲ್ಲಿಸಬಹುದು.', saved: 'ಈ ಖಾತೆಯ ಸಾರಾಂಶವನ್ನು Mem0 ಗೆ ಕಳುಹಿಸಲಾಗಿದೆ.' }
};

function updateMemoryConsentCopy(saved = false) {
  const language = document.getElementById('language')?.value || 'en';
  const copy = memoryCopy[language] || memoryCopy.en;
  const checkbox = document.getElementById('rememberChat');
  if (!checkbox) return;
  let consent = false;
  const consentKey = `nelam-memory-consent:${signedInUser?.accountKey || 'signed-out'}`;
  try { consent = localStorage.getItem(consentKey) === 'yes'; } catch (_) { /* Storage may be unavailable in private browsing. */ }
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
  const consentKey = `nelam-memory-consent:${signedInUser?.accountKey || 'signed-out'}`;
  try { localStorage.setItem(consentKey, event.target.checked ? 'yes' : 'no'); } catch (_) { /* Consent remains for this page view. */ }
  updateMemoryConsentCopy();
});

const profileForm = document.getElementById('farmerProfileForm');
const profileInputs = { crop: 'profileCrop', fertilizerChoices: 'profileFertilizer', soilType: 'profileSoil', irrigation: 'profileIrrigation', farmLocation: 'profileLocation' };
function profileMessage(en, ta, kn) { const lang = document.getElementById('language').value; return lang === 'ta' ? ta : lang === 'kn' ? kn : en; }
async function loadFarmerProfile() {
  const status = document.getElementById('profileStatus');
  status.textContent = profileMessage('Loading saved preferences…', 'சேமித்த விருப்பங்களை ஏற்றுகிறது…', 'ಉಳಿಸಿದ ಆದ್ಯತೆಗಳನ್ನು ಲೋಡ್ ಮಾಡಲಾಗುತ್ತಿದೆ…');
  try {
    const response = await fetch(`${API_BASE}/profile`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Could not load profile');
    for (const [key, id] of Object.entries(profileInputs)) document.getElementById(id).value = data.profile?.[key] || '';
    status.textContent = data.storage === 'postgres' ? profileMessage('Saved profile loaded from the database.', 'தரவுத்தளத்தில் சேமித்த சுயவிவரம் ஏற்றப்பட்டது.', 'ಡೇಟಾಬೇಸ್‌ನಿಂದ ಉಳಿಸಿದ ಪ್ರೊಫೈಲ್ ಲೋಡ್ ಆಯಿತು.') : profileMessage('Local demo profile loaded. Connect a database for durable storage.', 'உள்ளூர் மாதிரி சுயவிவரம் ஏற்றப்பட்டது. நீடித்த சேமிப்புக்கு தரவுத்தளத்தை இணைக்கவும்.', 'ಸ್ಥಳೀಯ ಡೆಮೊ ಪ್ರೊಫೈಲ್ ಲೋಡ್ ಆಯಿತು. ಶಾಶ್ವತ ಸಂಗ್ರಹಕ್ಕೆ ಡೇಟಾಬೇಸ್ ಸಂಪರ್ಕಿಸಿ.');
  } catch (_) { status.textContent = profileMessage('Could not load your saved preferences.', 'சேமித்த விருப்பங்களை ஏற்ற முடியவில்லை.', 'ಉಳಿಸಿದ ಆದ್ಯತೆಗಳನ್ನು ಲೋಡ್ ಮಾಡಲು ಸಾಧ್ಯವಾಗಲಿಲ್ಲ.'); }
}
profileForm.addEventListener('submit', async event => {
  event.preventDefault();
  const status = document.getElementById('profileStatus');
  const preferences = Object.fromEntries(Object.entries(profileInputs).map(([key, id]) => [key, document.getElementById(id).value.trim()]));
  preferences.language = document.getElementById('language').value;
  status.textContent = profileMessage('Saving…', 'சேமிக்கிறது…', 'ಉಳಿಸಲಾಗುತ್ತಿದೆ…');
  try {
    const response = await fetch(`${API_BASE}/profile`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ preferences }) });
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
  kn: { pageTitle: 'ನಿಮಗಾಗಿ ಯೋಜನೆಗಳನ್ನು ಹುಡುಕಿ', intro: 'ಅಧಿಕೃತ ಯೋಜನಾ ನಿಯಮಗಳ ಆಧಾರದ ಮೇಲೆ ಪ್ರಾಥಮಿಕವಾಗಿ ಪರಿಶೀಲಿಸಿ ಮುಂದಿನ ಹಂತಗಳನ್ನು ತಿಳಿಸುತ್ತೇವೆ.', title: 'ನಿಮ್ಮ ಕುಟುಂಬದ ವಿವರಗಳನ್ನು ಪರಿಶೀಲಿಸೋಣ', state: 'ನಿಮ್ಮ ಹೊಲ ಯಾವ ರಾಜ್ಯದಲ್ಲಿದೆ?', states: ['ಕರ್ನಾಟಕ', 'ತಮಿಳುನಾಡು'], land: 'ರೈತ ಕುಟುಂಬದ ಹೆಸರಿನಲ್ಲಿ ಕೃಷಿಯೋಗ್ಯ ಭೂಮಿ ದಾಖಲಾಗಿದೆಯೇ?', lands: ['ಹೌದು, ಕುಟುಂಬದ ಹೆಸರಿನಲ್ಲಿ ದಾಖಲಾಗಿದೆ', 'ಗುತ್ತಿಗೆ ಮಾತ್ರ; ಕುಟುಂಬದ ಭೂ ದಾಖಲೆ ಇಲ್ಲ', 'ಕೃಷಿಯೋಗ್ಯ ಭೂಮಿ ಇಲ್ಲ', 'ತಿಳಿದಿಲ್ಲ'], exclusions: 'ಕುಟುಂಬದ ಯಾರಾದರೂ PM-KISAN ಹೊರತಾಗುವ ವರ್ಗದಲ್ಲಿದ್ದಾರೆಯೇ?', exclusionHelp: 'ಉದಾಹರಣೆ: ಸಂಸ್ಥೆಯ ಭೂಮಾಲೀಕ, ಆದಾಯ ತೆರಿಗೆದಾರ, ನಿರ್ದಿಷ್ಟ ಸರ್ಕಾರಿ ಹುದ್ದೆ/ಪಿಂಚಣಿ ಅಥವಾ ವೃತ್ತಿಪರರು.', exclusionOptions: ['ತಿಳಿದಿಲ್ಲ', 'ತಿಳಿದಿರುವ ಹೊರತಾಗುವಿಕೆ ಇಲ್ಲ', 'ಹೌದು, ಒಂದು ಅಥವಾ ಹೆಚ್ಚು'], aadhaar: 'PM-KISAN eKYC ಮತ್ತು ಬ್ಯಾಂಕ್/DBT ವ್ಯವಸ್ಥೆ ಪೂರ್ಣಗೊಂಡಿದೆಯೇ?', aadhaarOptions: ['ಹೌದು', 'ಇಲ್ಲ', 'ತಿಳಿದಿಲ್ಲ'], check: 'ಯೋಜನಾ ಅರ್ಹತೆ ಪರಿಶೀಲಿಸಿ', results: 'ಯೋಜನೆಗಳ ಪ್ರಾಥಮಿಕ ಪರಿಶೀಲನೆ', disclaimer: 'ಸಂಭಾವ್ಯ ಹೊಂದಾಣಿಕೆ ಅನುಮೋದನೆ ಅಲ್ಲ. ಭೂ ದಾಖಲೆ, ಹೊರತಾಗುವಿಕೆ ಮತ್ತು ಪ್ರಸ್ತುತ ಅರ್ಜಿಗಳನ್ನು ಇಲಾಖೆ ದೃಢಪಡಿಸುತ್ತದೆ.' },
  hi: { pageTitle: 'अपने लिए योजनाएँ खोजें', intro: 'यह प्रारंभिक जाँच सरकारी योजना के नियमों के आधार पर अगले कदम बताती है।', title: 'आपके परिवार की जानकारी जाँचें', state: 'आपका खेत किस राज्य में है?', states: ['कर्नाटक', 'तमिलनाडु'], land: 'क्या किसान परिवार की खेती योग्य भूमि राजस्व अभिलेखों में दर्ज है?', lands: ['हाँ, परिवार के सदस्य के नाम दर्ज', 'केवल पट्टे पर; परिवार के नाम भूमि दर्ज नहीं', 'खेती योग्य भूमि नहीं', 'पता नहीं'], exclusions: 'क्या परिवार का कोई सदस्य PM-KISAN की अपात्रता श्रेणी में आता है?', exclusionHelp: 'उदाहरण: संस्थागत भूमि धारक, आयकरदाता, कुछ सरकारी पद/पेंशन या पंजीकृत पेशेवर।', exclusionOptions: ['पता नहीं', 'कोई ज्ञात अपात्रता नहीं', 'हाँ, एक या अधिक'], aadhaar: 'क्या PM-KISAN eKYC और बैंक/DBT व्यवस्था पूरी है?', aadhaarOptions: ['हाँ', 'नहीं', 'पता नहीं'], check: 'योजना पात्रता जाँचें', results: 'योजनाओं की प्रारंभिक जाँच', disclaimer: 'संभावित पात्रता स्वीकृति नहीं है। विभाग भूमि अभिलेख, अपात्रता और वर्तमान आवेदन अवधि की पुष्टि करेगा।' }
};

const schemeExtraCopy = {
  en: { location: 'District / taluk / village', labels: ['When was the land first recorded in the family’s name?', 'Is another member of this farmer family already receiving PM-KISAN?', 'Are you interested in an available Samathuvapuram house allotment in your village/block?', 'Does your household own any land?', 'Does anyone in the household fall into a listed vulnerability / priority group?', 'What best describes your current house roof?', 'Has anyone in your household already received a government house under a housing scheme?', 'Would your household be willing to live permanently in the Samathuvapuram settlement if selected?', 'Your age band', 'Which best describes your work?', 'For wet land, is the holding no more than 2.5 acres, or for dry land no more than 5 acres?'], groups: ['Tamil Nadu options', 'These questions help screen housing and farmer-safety support separately from PM-KISAN.'], options: {
    landAcquisition: ['On or before 1 February 2019', 'After 1 February 2019', 'After that date by inheritance/succession', 'Not sure'], familyBenefit: ['Not sure', 'No', 'Yes'], samInterest: ['Not sure / checking all schemes', 'Yes', 'No'], housingLand: ['Not sure / prefer not to say', 'No, landless household', 'Yes'], housingPriority: ['Not sure / prefer not to say', 'Yes', 'No'], houseRoof: ['Not sure / prefer not to say', 'Thatched', 'Tiled', 'RCC / concrete', 'Houseless'], priorHousing: ['Not sure', 'No', 'Yes'], permanentStay: ['Not sure', 'Yes', 'No'], ageBand: ['Not sure / prefer not to say', 'Under 18', '18–65', 'Over 65'], farmerType: ['Not sure / other', 'Small/marginal farmer doing direct cultivation', 'Tenant farmer', 'Agricultural labourer', 'Other'], safetyLand: ['Not sure', 'Yes', 'No', 'Not applicable / agricultural labourer']
  } },
  ta: { location: 'மாவட்டம் / வட்டம் / கிராமம்', labels: ['குடும்பத்தின் பெயரில் நிலம் முதலில் எப்போது பதிவு செய்யப்பட்டது?', 'இந்த விவசாயக் குடும்பத்தில் வேறு ஒருவர் PM-KISAN பெறுகிறாரா?', 'உங்கள் ஊர்/வட்டாரத்தில் சமத்துவபுரம் வீடு ஒதுக்கீடு திறந்தால் விண்ணப்பிக்க விரும்புகிறீர்களா?', 'உங்கள் குடும்பத்துக்கு நிலம் உள்ளதா?', 'திட்டத்தின் முன்னுரிமை / பாதிப்பு வகையில் குடும்பத்தில் யாராவது உள்ளார்களா?', 'தற்போதைய வீட்டின் கூரை வகை என்ன?', 'குடும்பத்தில் யாராவது ஏற்கெனவே அரசு வீட்டு திட்டத்தின் கீழ் வீடு பெற்றுள்ளார்களா?', 'தேர்வு செய்யப்பட்டால் சமத்துவபுரத்தில் நிரந்தரமாக வசிக்க உங்கள் குடும்பம் தயாரா?', 'வயது வரம்பு', 'உங்கள் வேலை வகை', 'நஞ்சை நிலம் 2.5 ஏக்கருக்குள் அல்லது புஞ்சை நிலம் 5 ஏக்கருக்குள் உள்ளதா?'], groups: ['தமிழ்நாடு திட்டங்கள்', 'PM-KISAN-இலிருந்து தனியாக வீட்டு மற்றும் விவசாயி பாதுகாப்புத் திட்டங்களைச் சரிபார்க்கும் கேள்விகள்.'], options: {
    landAcquisition: ['1 பிப்ரவரி 2019 அன்று அல்லது அதற்கு முன்', '1 பிப்ரவரி 2019க்குப் பின்', 'அதற்குப் பின் வாரிசுரிமை மூலம்', 'தெரியவில்லை'], familyBenefit: ['தெரியவில்லை', 'இல்லை', 'ஆம்'], samInterest: ['தெரியவில்லை / எல்லா திட்டங்களையும் சரிபார்க்கிறேன்', 'ஆம்', 'இல்லை'], housingLand: ['தெரியவில்லை / பகிர விருப்பமில்லை', 'இல்லை, நிலமற்ற குடும்பம்', 'ஆம்'], housingPriority: ['தெரியவில்லை / பகிர விருப்பமில்லை', 'ஆம்', 'இல்லை'], houseRoof: ['தெரியவில்லை / பகிர விருப்பமில்லை', 'கீற்று', 'ஓடு', 'கான்கிரீட்', 'வீடற்றவர்'], priorHousing: ['தெரியவில்லை', 'இல்லை', 'ஆம்'], permanentStay: ['தெரியவில்லை', 'ஆம்', 'இல்லை'], ageBand: ['தெரியவில்லை / பகிர விருப்பமில்லை', '18க்கு கீழ்', '18–65', '65க்கு மேல்'], farmerType: ['தெரியவில்லை / மற்றவை', 'நேரடியாகப் பயிரிடும் சிறு/குறு விவசாயி', 'குத்தகை விவசாயி', 'விவசாயத் தொழிலாளர்', 'மற்றவை'], safetyLand: ['தெரியவில்லை', 'ஆம்', 'இல்லை', 'பொருந்தாது / விவசாயத் தொழிலாளர்']
  } },
  kn: { location: 'ಜಿಲ್ಲೆ / ತಾಲ್ಲೂಕು / ಗ್ರಾಮ', labels: ['ಕುಟುಂಬದ ಹೆಸರಿಗೆ ಭೂಮಿ ಮೊದಲಿಗೆ ಯಾವಾಗ ದಾಖಲಾಗಿದೆ?', 'ಈ ರೈತ ಕುಟುಂಬದ ಮತ್ತೊಬ್ಬರು PM-KISAN ಪಡೆಯುತ್ತಿದ್ದಾರೆಯೇ?', 'ನಿಮ್ಮ ಗ್ರಾಮ/ತಾಲೂಕಿನಲ್ಲಿ ಸಮತ್ತುವಪುರಂ ಮನೆ ಹಂಚಿಕೆ ತೆರೆದರೆ ಅರ್ಜಿ ಸಲ್ಲಿಸಲು ಆಸಕ್ತಿಯಿದೆಯೇ?', 'ಕುಟುಂಬಕ್ಕೆ ಯಾವುದೇ ಭೂಮಿ ಇದೆಯೇ?', 'ಯೋಜನೆಯ ಆದ್ಯತೆ / ದುರ್ಬಲ ವರ್ಗಕ್ಕೆ ಕುಟುಂಬದ ಯಾರಾದರೂ ಸೇರುತ್ತಾರೆಯೇ?', 'ಪ್ರಸ್ತುತ ಮನೆಯ ಮೇಲ್ಛಾವಣಿ ಯಾವುದು?', 'ಕುಟುಂಬದ ಯಾರಾದರೂ ಈಗಾಗಲೇ ಸರ್ಕಾರಿ ವಸತಿ ಯೋಜನೆಯಡಿ ಮನೆ ಪಡೆದಿದ್ದಾರೆಯೇ?', 'ಆಯ್ಕೆಯಾದರೆ ಸಮತ್ತುವಪುರಂನಲ್ಲಿ ಶಾಶ್ವತವಾಗಿ ವಾಸಿಸಲು ಕುಟುಂಬ ಸಿದ್ಧವಿದೆಯೇ?', 'ವಯಸ್ಸಿನ ವ್ಯಾಪ್ತಿ', 'ನಿಮ್ಮ ಕೆಲಸದ ವರ್ಗ', 'ನೀರಾವರಿ ಭೂಮಿ 2.5 ಎಕರೆ ಒಳಗೆ ಅಥವಾ ಒಣ ಭೂಮಿ 5 ಎಕರೆ ಒಳಗಿದೆಯೇ?'], groups: ['ತಮಿಳುನಾಡು ಆಯ್ಕೆಗಳು', 'PM-KISAN ನಿಂದ ಪ್ರತ್ಯೇಕವಾಗಿ ವಸತಿ ಮತ್ತು ರೈತ ಸುರಕ್ಷತಾ ಯೋಜನೆಗಳನ್ನು ಪರಿಶೀಲಿಸುವ ಪ್ರಶ್ನೆಗಳು.'], options: {
    landAcquisition: ['1 ಫೆಬ್ರವರಿ 2019 ರಂದು ಅಥವಾ ಮೊದಲು', '1 ಫೆಬ್ರವರಿ 2019 ನಂತರ', 'ನಂತರ ವಾರಸುದಾರಿಕೆಯಿಂದ', 'ತಿಳಿದಿಲ್ಲ'], familyBenefit: ['ತಿಳಿದಿಲ್ಲ', 'ಇಲ್ಲ', 'ಹೌದು'], samInterest: ['ತಿಳಿದಿಲ್ಲ / ಎಲ್ಲ ಯೋಜನೆಗಳನ್ನು ಪರಿಶೀಲಿಸುತ್ತಿದ್ದೇನೆ', 'ಹೌದು', 'ಇಲ್ಲ'], housingLand: ['ತಿಳಿದಿಲ್ಲ / ಹೇಳಲು ಇಷ್ಟವಿಲ್ಲ', 'ಇಲ್ಲ, ಭೂಹೀನ ಕುಟುಂಬ', 'ಹೌದು'], housingPriority: ['ತಿಳಿದಿಲ್ಲ / ಹೇಳಲು ಇಷ್ಟವಿಲ್ಲ', 'ಹೌದು', 'ಇಲ್ಲ'], houseRoof: ['ತಿಳಿದಿಲ್ಲ / ಹೇಳಲು ಇಷ್ಟವಿಲ್ಲ', 'ಹುಲ್ಲಿನ/ಕೀರು ಛಾವಣಿ', 'ಹಂಚಿನ ಛಾವಣಿ', 'RCC / ಕಾಂಕ್ರೀಟ್', 'ಮನೆ ಇಲ್ಲ'], priorHousing: ['ತಿಳಿದಿಲ್ಲ', 'ಇಲ್ಲ', 'ಹೌದು'], permanentStay: ['ತಿಳಿದಿಲ್ಲ', 'ಹೌದು', 'ಇಲ್ಲ'], ageBand: ['ತಿಳಿದಿಲ್ಲ / ಹೇಳಲು ಇಷ್ಟವಿಲ್ಲ', '18ಕ್ಕಿಂತ ಕಡಿಮೆ', '18–65', '65ಕ್ಕಿಂತ ಹೆಚ್ಚು'], farmerType: ['ತಿಳಿದಿಲ್ಲ / ಇತರೆ', 'ನೇರ ಕೃಷಿ ಮಾಡುವ ಸಣ್ಣ/ಅತಿಸಣ್ಣ ರೈತ', 'ಗುತ್ತಿಗೆ ರೈತ', 'ಕೃಷಿ ಕಾರ್ಮಿಕ', 'ಇತರೆ'], safetyLand: ['ತಿಳಿದಿಲ್ಲ', 'ಹೌದು', 'ಇಲ್ಲ', 'ಅನ್ವಯಿಸುವುದಿಲ್ಲ / ಕೃಷಿ ಕಾರ್ಮಿಕ']
   } },
  hi: { location: 'जिला / तालुक / गाँव', labels: ['परिवार के नाम भूमि पहली बार कब दर्ज हुई?', 'क्या इस किसान परिवार का कोई अन्य सदस्य PM-KISAN ले रहा है?', 'क्या आप अपने गाँव/ब्लॉक में उपलब्ध समथुवपुरम आवास के लिए आवेदन करना चाहेंगे?', 'क्या आपके परिवार के पास कोई भूमि है?', 'क्या परिवार का कोई सदस्य योजना की प्राथमिकता / कमजोर वर्ग में आता है?', 'आपके वर्तमान घर की छत किस प्रकार की है?', 'क्या परिवार को पहले किसी सरकारी आवास योजना से घर मिला है?', 'चयन होने पर क्या परिवार समथुवपुरम बस्ती में स्थायी रूप से रहना चाहेगा?', 'आपकी आयु सीमा', 'आपका काम किस प्रकार का है?', 'क्या सिंचित भूमि 2.5 एकड़ या कम, अथवा असिंचित भूमि 5 एकड़ या कम है?'], groups: ['तमिलनाडु विकल्प', 'ये प्रश्न PM-KISAN से अलग आवास और किसान सुरक्षा सहायता की प्रारंभिक जाँच करते हैं।'], options: {
    landAcquisition: ['1 फरवरी 2019 को या उससे पहले', '1 फरवरी 2019 के बाद', 'उस तारीख के बाद उत्तराधिकार से', 'पता नहीं'], familyBenefit: ['पता नहीं', 'नहीं', 'हाँ'], samInterest: ['पता नहीं / सभी योजनाएँ जाँच रहे हैं', 'हाँ', 'नहीं'], housingLand: ['पता नहीं / बताना नहीं चाहते', 'नहीं, भूमिहीन परिवार', 'हाँ'], housingPriority: ['पता नहीं / बताना नहीं चाहते', 'हाँ', 'नहीं'], houseRoof: ['पता नहीं / बताना नहीं चाहते', 'फूस', 'टाइल', 'RCC / कंक्रीट', 'बेघर'], priorHousing: ['पता नहीं', 'नहीं', 'हाँ'], permanentStay: ['पता नहीं', 'हाँ', 'नहीं'], ageBand: ['पता नहीं / बताना नहीं चाहते', '18 से कम', '18–65', '65 से अधिक'], farmerType: ['पता नहीं / अन्य', 'सीधे खेती करने वाले छोटे/सीमांत किसान', 'पट्टेदार किसान', 'कृषि मजदूर', 'अन्य'], safetyLand: ['पता नहीं', 'हाँ', 'नहीं', 'लागू नहीं / कृषि मजदूर']
  } }
};

const schemePresentationCopy = {
  en: { progress: 'ELIGIBILITY PRE-CHECK', step: 'Step 1 of 2', resultsStep: 'Results', asideTitle: 'Check before applying', asideIntro: 'We compare your answers with published government rules and link you to the right department portal.', asideList: ['Covered in this first screen', 'PM-KISAN · Central', 'Samathuvapuram · Tamil Nadu housing', 'Uzhavar Pathukappu · Tamil Nadu', 'State agriculture directories · TN / Karnataka', 'Krushak Odisha · jurisdiction check'], asideNote: 'No Aadhaar, bank or document numbers are collected. The pre-check does not query government records or submit applications.', scope: 'Do not enter Aadhaar, bank account or document numbers here. This is a rules-based pre-check only; it cannot query land records, confirm a live application window or approve benefits.', family: 'The scheme is assessed at family level (husband, wife and minor children); duplicate-family cases may be held for verification.', landDate: 'Recent land transfers may need a manual PM-KISAN review; succession cases can be treated differently.', priority: 'Landless and vulnerable households are priority groups under the 2023 Government Order. No personal details are needed here.', locationPlaceholder: 'Enter your district and village' },
  ta: { progress: 'தகுதி முதற்கட்டச் சரிபார்ப்பு', step: 'படி 1 / 2', resultsStep: 'முடிவுகள்', asideTitle: 'விண்ணப்பிக்கும் முன் சரிபார்க்கவும்', asideIntro: 'அரசு வெளியிட்ட விதிகளுடன் உங்கள் பதில்களை ஒப்பிட்டு, தொடர்புடைய துறை இணையதளத்தை இணைக்கிறோம்.', asideList: ['இந்த முதற்கட்டத்தில் உள்ளவை', 'PM-KISAN · மத்திய அரசு', 'சமத்துவபுரம் · தமிழ்நாடு வீடு', 'உழவர் பாதுகாப்பு · தமிழ்நாடு', 'வேளாண் திட்டப் பட்டியல் · தமிழ்நாடு / கர்நாடகம்', 'Krushak Odisha · மாநில வரம்பு சரிபார்ப்பு'], asideNote: 'ஆதார், வங்கி அல்லது ஆவண எண்கள் சேகரிக்கப்படாது. அரசு பதிவுகளை நேரடியாகத் தேடவோ விண்ணப்பிக்கவோ இந்த முதற்கட்டச் சரிபார்ப்பால் முடியாது.', scope: 'இங்கு ஆதார், வங்கி அல்லது ஆவண எண்களை உள்ளிட வேண்டாம். இது விதி அடிப்படையிலான முதற்கட்டச் சரிபார்ப்பு மட்டுமே; நிலப் பதிவுகளைத் தேடவோ, தற்போதைய விண்ணப்ப காலத்தை உறுதிசெய்யவோ, நன்மையை ஒப்புதலளிக்கவோ முடியாது.', family: 'திட்டம் கணவன், மனைவி, சிறுவர் குழந்தைகள் அடங்கிய குடும்பத்தை அடிப்படையாகக் கணக்கிடுகிறது; ஒரே குடும்பத்தில் பல பயனாளர் பதிவுகள் இருந்தால் சரிபார்ப்புக்காக நிறுத்தப்படலாம்.', landDate: 'சமீபத்திய நில மாற்றங்களுக்கு PM-KISAN அலுவலகச் சரிபார்ப்பு தேவைப்படலாம்; வாரிசுரிமைக்கு வேறு விதி இருக்கலாம்.', priority: '2023 அரசாணையில் நிலமற்ற மற்றும் பாதிப்புக்குள்ளான குடும்பங்களுக்கு முன்னுரிமை உண்டு. தனிப்பட்ட விவரங்கள் தேவையில்லை.', locationPlaceholder: 'உங்கள் மாவட்டம், கிராமத்தை உள்ளிடவும்' },
  kn: { progress: 'ಅರ್ಹತಾ ಪ್ರಾಥಮಿಕ ಪರಿಶೀಲನೆ', step: 'ಹಂತ 1 / 2', resultsStep: 'ಫಲಿತಾಂಶಗಳು', asideTitle: 'ಅರ್ಜಿ ಸಲ್ಲಿಸುವ ಮೊದಲು ಪರಿಶೀಲಿಸಿ', asideIntro: 'ನಿಮ್ಮ ಉತ್ತರಗಳನ್ನು ಪ್ರಕಟಿತ ಸರ್ಕಾರಿ ನಿಯಮಗಳೊಂದಿಗೆ ಹೋಲಿಸಿ ಸಂಬಂಧಿತ ಇಲಾಖೆಯ ಪೋರ್ಟಲ್ ನೀಡುತ್ತೇವೆ.', asideList: ['ಈ ಪ್ರಾಥಮಿಕ ಪರಿಶೀಲನೆಯಲ್ಲಿ', 'PM-KISAN · ಕೇಂದ್ರ ಸರ್ಕಾರ', 'ಸಮತ್ತುವಪುರಂ · ತಮಿಳುನಾಡು ವಸತಿ', 'ಉಳುವರ್ ಪಾತುಕಾಪ್ಪು · ತಮಿಳುನಾಡು', 'ಕೃಷಿ ಯೋಜನೆಗಳ ಪಟ್ಟಿ · ತಮಿಳುನಾಡು / ಕರ್ನಾಟಕ', 'Krushak Odisha · ರಾಜ್ಯ ವ್ಯಾಪ್ತಿ ಪರಿಶೀಲನೆ'], asideNote: 'ಆಧಾರ್, ಬ್ಯಾಂಕ್ ಅಥವಾ ದಾಖಲೆ ಸಂಖ್ಯೆಯನ್ನು ಸಂಗ್ರಹಿಸುವುದಿಲ್ಲ. ಈ ಪರಿಶೀಲನೆ ಸರ್ಕಾರಿ ದಾಖಲೆ ಹುಡುಕುವುದಿಲ್ಲ ಅಥವಾ ಅರ್ಜಿಯನ್ನು ಸಲ್ಲಿಸುವುದಿಲ್ಲ.', scope: 'ಇಲ್ಲಿ ಆಧಾರ್, ಬ್ಯಾಂಕ್ ಅಥವಾ ದಾಖಲೆ ಸಂಖ್ಯೆಯನ್ನು ನಮೂದಿಸಬೇಡಿ. ಇದು ನಿಯಮಾಧಾರಿತ ಪ್ರಾಥಮಿಕ ಪರಿಶೀಲನೆ ಮಾತ್ರ; ಭೂ ದಾಖಲೆ, ಪ್ರಸ್ತುತ ಅರ್ಜಿ ಅವಧಿ ಅಥವಾ ಸರ್ಕಾರಿ ಅನುಮೋದನೆಯನ್ನು ಪರಿಶೀಲಿಸಲಾಗದು.', family: 'ಯೋಜನೆ ಗಂಡ, ಹೆಂಡತಿ ಮತ್ತು ಅಪ್ರಾಪ್ತ ಮಕ್ಕಳ ರೈತ ಕುಟುಂಬವನ್ನು ಒಟ್ಟಾಗಿ ಪರಿಗಣಿಸುತ್ತದೆ; ಒಂದೇ ಕುಟುಂಬದ ಅನೇಕ ಫಲಾನುಭವಿ ದಾಖಲೆಗಳನ್ನು ಪರಿಶೀಲನೆಗಾಗಿ ತಡೆಹಿಡಿಯಬಹುದು.', landDate: 'ಇತ್ತೀಚಿನ ಭೂ ವರ್ಗಾವಣೆಗೆ PM-KISAN ಕೈಯಾರೆ ಪರಿಶೀಲನೆ ಬೇಕಾಗಬಹುದು; ವಾರಸುದಾರಿಕೆಗೆ ಬೇರೆ ನಿಯಮ ಇರಬಹುದು.', priority: '2023ರ ಸರ್ಕಾರಿ ಆದೇಶದಲ್ಲಿ ಭೂಹೀನ ಮತ್ತು ದುರ್ಬಲ ಕುಟುಂಬಗಳಿಗೆ ಆದ್ಯತೆಯಿದೆ. ವೈಯಕ್ತಿಕ ವಿವರಗಳ ಅಗತ್ಯವಿಲ್ಲ.', locationPlaceholder: 'ನಿಮ್ಮ ಜಿಲ್ಲೆ ಮತ್ತು ಗ್ರಾಮ ನಮೂದಿಸಿ' },
  hi: { progress: 'पात्रता की प्रारंभिक जाँच', step: 'चरण 1 / 2', resultsStep: 'परिणाम', asideTitle: 'आवेदन से पहले जाँचें', asideIntro: 'हम आपके उत्तरों की तुलना प्रकाशित सरकारी नियमों से करते हैं और संबंधित विभाग का पोर्टल बताते हैं।', asideList: ['इस प्रारंभिक जाँच में शामिल', 'PM-KISAN · केंद्र सरकार', 'समथुवपुरम · तमिलनाडु आवास', 'उझवर पाथुकाप्पु · तमिलनाडु', 'राज्य कृषि योजनाएँ · TN / कर्नाटक', 'कृषक ओडिशा · राज्य सीमा जाँच'], asideNote: 'आधार, बैंक या दस्तावेज़ संख्या नहीं ली जाती। यह जाँच सरकारी रिकॉर्ड नहीं देखती और आवेदन जमा नहीं करती।', scope: 'यहाँ आधार, बैंक खाता या दस्तावेज़ संख्या न डालें। यह केवल नियम-आधारित प्रारंभिक जाँच है; भूमि रिकॉर्ड, वर्तमान आवेदन अवधि या सरकारी मंज़ूरी की पुष्टि नहीं करती।', family: 'योजना में पति, पत्नी और नाबालिग बच्चों के किसान परिवार को एक इकाई माना जाता है; परिवार में दोहरे लाभार्थी मामलों की जाँच हो सकती है।', landDate: 'हाल में भूमि हस्तांतरण होने पर PM-KISAN की मैन्युअल जाँच हो सकती है; उत्तराधिकार के मामले अलग हो सकते हैं।', priority: '2023 के सरकारी आदेश में भूमिहीन और कमजोर परिवारों को प्राथमिकता है। यहाँ निजी जानकारी की आवश्यकता नहीं है।', locationPlaceholder: 'अपना जिला और गाँव लिखें' }
};

function setupSchemeQuestions() {
  const acresLabel = document.getElementById('acres').closest('label');
  if (acresLabel) acresLabel.hidden = true;
  document.getElementById('land').add(new Option('Not sure', 'unsure'));
  const stateLabel = document.getElementById('state').closest('label');
  stateLabel.insertAdjacentHTML('afterend', '<label>District / taluk / village<input id="schemeLocation" maxlength="140" autocomplete="address-level2" placeholder="Enter your district and village" required /></label>');
  document.getElementById('schemeLocation').value = document.getElementById('profileLocation').value.trim();
  const landLabel = document.getElementById('land').closest('label');
  landLabel.insertAdjacentHTML('afterend', '<label id="landDateLabel">When was the land first recorded in the family’s name?<select id="landAcquisition"><option value="before">On or before 1 February 2019</option><option value="after">After 1 February 2019</option><option value="inheritance">After that date by inheritance/succession</option><option value="unsure">Not sure</option></select><small>Recent land transfers may need a manual PM-KISAN review; succession cases can be treated differently.</small></label><label id="exclusionsLabel">Does anyone in the farmer family meet a PM-KISAN exclusion rule?<select id="exclusions"><option value="unsure">Not sure</option><option value="no">No, after checking the categories below</option><option value="yes">Yes, at least one category</option></select><small id="exclusionHelp">Exclusions include institutional landholders; constitutional office holders; ministers/legislators, mayors and district panchayat chairs; most serving or retired government/local-body employees (except MTS/Class IV/Group D); pensioners receiving ₹10,000 or more monthly (with stated exceptions); anyone who paid income tax in the last assessment year; and registered practising professionals such as doctors, engineers, lawyers, CAs or architects.</small></label><label>Is another member of this farmer family already receiving PM-KISAN?<select id="familyBenefit"><option value="unsure">Not sure</option><option value="no">No</option><option value="yes">Yes</option></select><small>The scheme is assessed at family level (husband, wife and minor children); duplicate-family cases may be held for verification.</small></label>');
  const aadhaarLabel = document.getElementById('aadhaar').closest('label');
  aadhaarLabel.insertAdjacentHTML('afterend', '<div id="tnSchemeQuestions" class="scheme-extra-questions"><h3>Tamil Nadu options</h3><p>These questions help screen housing and farmer-safety support separately from PM-KISAN.</p><label>Are you interested in an available Samathuvapuram house allotment in your village/block?<select id="samInterest"><option value="unsure">Not sure / checking all schemes</option><option value="yes">Yes</option><option value="no">No</option></select></label><label>Does your household own any land?<select id="housingLand"><option value="unsure">Not sure / prefer not to say</option><option value="no">No, landless household</option><option value="yes">Yes</option></select><small>Landless households are a priority group in the 2023 Government Order.</small></label><label>What best describes your current house roof?<select id="houseRoof"><option value="unsure">Not sure / prefer not to say</option><option value="thatched">Thatched</option><option value="tiled">Tiled</option><option value="rcc">RCC / concrete</option><option value="houseless">Houseless</option></select></label><label>Has anyone in your household already received a government house under a housing scheme?<select id="priorHousing"><option value="unsure">Not sure</option><option value="no">No</option><option value="yes">Yes</option></select></label><label>Would your household be willing to live permanently in the Samathuvapuram settlement if selected?<select id="permanentStay"><option value="unsure">Not sure</option><option value="yes">Yes</option><option value="no">No</option></select></label><label>Your age band<select id="ageBand"><option value="unsure">Not sure / prefer not to say</option><option value="under18">Under 18</option><option value="18to65">18–65</option><option value="over65">Over 65</option></select></label><label>Which best describes your work?<select id="farmerType"><option value="unsure">Not sure / other</option><option value="cultivator">Small/marginal farmer doing direct cultivation</option><option value="tenant">Tenant farmer</option><option value="agri_labour">Agricultural labourer</option><option value="other">Other</option></select></label><label>For wet land, is the holding no more than 2.5 acres, or for dry land no more than 5 acres?<select id="safetyLand"><option value="unsure">Not sure</option><option value="yes">Yes</option><option value="no">No</option><option value="not_applicable">Not applicable / agricultural labourer</option></select></label></div><p class="scheme-scope-note" id="schemeScopeNote">Do not enter Aadhaar, bank account or document numbers here. This is a rules-based pre-check only; it cannot query land records, confirm a live application window or approve benefits.</p>');
  document.getElementById('housingLand').closest('label').insertAdjacentHTML('afterend', '<label>Does anyone in the household fall into a vulnerability / priority group listed by the scheme?<select id="housingPriority"><option value="unsure">Not sure / prefer not to say</option><option value="yes">Yes</option><option value="no">No</option></select><small>For example, disability, widow or women-headed household, destitution, transgender person, severe illness, disaster loss, or very poor household. No personal details are needed here.</small></label>');
  const toggleTamilNaduQuestions = () => { document.getElementById('tnSchemeQuestions').hidden = document.getElementById('state').value !== 'Tamil Nadu'; };
  document.getElementById('state').addEventListener('change', toggleTamilNaduQuestions);
  toggleTamilNaduQuestions();
}

function updateSchemeCopy(language) {
  const copy = schemeLabels[language] || schemeLabels.en;
  const extra = schemeExtraCopy[language] || schemeExtraCopy.en;
  const presentation = schemePresentationCopy[language] || schemePresentationCopy.en;
  const setLabel = (id, text) => { const label = document.getElementById(id)?.closest('label'); if (label?.firstChild) label.firstChild.textContent = `${text} `; };
  document.querySelector('#schemes-view .page-intro h1').textContent = copy.pageTitle;
  document.querySelector('#schemes-view .page-intro > p').textContent = copy.intro;
  document.querySelector('#schemeForm [data-step="1"] h2').textContent = copy.title;
  document.querySelector('#schemeForm [data-step="1"] > p').textContent = copy.intro;
  document.querySelector('#schemeResults h2').textContent = copy.results;
  document.querySelector('#schemeResults > p').textContent = copy.disclaimer;
  document.querySelector('.progress-label > span:first-child').textContent = presentation.progress;
  document.querySelector('.scheme-aside h3').textContent = presentation.asideTitle;
  document.querySelector('.scheme-aside > p').textContent = presentation.asideIntro;
  const asideList = document.querySelector('.scheme-aside .scheme-note');
  asideList.querySelector('b').textContent = presentation.asideList[0];
  [...asideList.querySelectorAll('span')].forEach((item, index) => { if (presentation.asideList[index + 1]) item.textContent = presentation.asideList[index + 1]; });
  document.querySelector('.scheme-aside > small').textContent = presentation.asideNote;
  document.getElementById('schemeScopeNote').textContent = presentation.scope;
  document.querySelector('#landDateLabel small').textContent = presentation.landDate;
  document.querySelector('#familyBenefit').parentElement.querySelector('small').textContent = presentation.family;
  document.querySelector('#housingLand').parentElement.querySelector('small').textContent = presentation.priority;
  document.getElementById('schemeLocation').placeholder = presentation.locationPlaceholder;
  document.getElementById('stepLabel').textContent = document.getElementById('schemeResults').classList.contains('active') ? presentation.resultsStep : presentation.step;
  setLabel('state', copy.state); setLabel('land', copy.land); setLabel('aadhaar', copy.aadhaar); setLabel('exclusions', copy.exclusions);
  setLabel('schemeLocation', extra.location);
  for (const [index, id] of ['landAcquisition','familyBenefit','samInterest','housingLand','housingPriority','houseRoof','priorHousing','permanentStay','ageBand','farmerType','safetyLand'].entries()) setLabel(id, extra.labels[index]);
  document.querySelector('#tnSchemeQuestions h3').textContent = extra.groups[0];
  document.querySelector('#tnSchemeQuestions > p').textContent = extra.groups[1];
  for (const [id, labels] of Object.entries(extra.options)) [...document.getElementById(id).options].forEach((option, index) => { if (labels[index]) option.textContent = labels[index]; });
  const exclusionDetails = language === 'hi'
    ? ' पूरी सूची: संस्थागत भूमि धारक; वर्तमान/पूर्व संवैधानिक पदाधिकारी, मंत्री, सांसद/विधायक, महापौर और जिला पंचायत अध्यक्ष; MTS/Class IV/Group D को छोड़कर अधिकांश सरकारी/स्थानीय निकाय कर्मचारी; बताई गई छूट के साथ ₹10,000 या अधिक मासिक पेंशन पाने वाले; पिछले आकलन वर्ष में आयकर देने वाले; पंजीकृत डॉक्टर, इंजीनियर, वकील, CA और वास्तुकार।'
    : language === 'ta'
    ? ' முழு பட்டியல்: நிறுவன நில உரிமையாளர்; தற்போதைய/முன்னாள் அரசியலமைப்பு பதவி, அமைச்சர், நாடாளுமன்ற/சட்டமன்ற உறுப்பினர், மாநகர மேயர், மாவட்ட ஊராட்சி தலைவர்; MTS/Class IV/Group D தவிர பெரும்பாலான அரசு/உள்ளாட்சி ஊழியர்கள்; விதிவிலக்குகளுடன் மாதம் ₹10,000+ ஓய்வூதியதாரர்; கடந்த மதிப்பீட்டு ஆண்டில் வருமானவரி செலுத்தியவர்; பதிவு பெற்றுப் பணிபுரியும் மருத்துவர், பொறியாளர், வழக்கறிஞர், CA, கட்டிடக் கலைஞர்.'
    : language === 'kn'
      ? ' ಪೂರ್ಣ ಪಟ್ಟಿ: ಸಂಸ್ಥೆಯ ಭೂಮಾಲೀಕರು; ಪ್ರಸ್ತುತ/ಮಾಜಿ ಸಂವಿಧಾನಿಕ ಹುದ್ದೆದಾರರು, ಸಚಿವರು, ಸಂಸದರು/ಶಾಸಕರು, ಮೇಯರ್‌ಗಳು, ಜಿಲ್ಲಾ ಪಂಚಾಯತ್ ಅಧ್ಯಕ್ಷರು; MTS/Class IV/Group D ಹೊರತುಪಡಿಸಿ ಬಹುತೇಕ ಸರ್ಕಾರಿ/ಸ್ಥಳೀಯ ಸಂಸ್ಥೆ ನೌಕರರು; ವಿನಾಯಿತಿಗಳೊಂದಿಗೆ ತಿಂಗಳಿಗೆ ₹10,000+ ಪಿಂಚಣಿದಾರರು; ಕಳೆದ ಮೌಲ್ಯಮಾಪನ ವರ್ಷದಲ್ಲಿ ಆದಾಯ ತೆರಿಗೆ ಪಾವತಿಸಿದವರು; ನೋಂದಾಯಿತ ವೈದ್ಯರು, ಎಂಜಿನಿಯರ್‌ಗಳು, ವಕೀಲರು, CAಗಳು, ವಾಸ್ತುಶಿಲ್ಪಿಗಳು.'
      : ' Full list: institutional landholders; current/former constitutional office holders, ministers, MPs/MLAs, mayors and district panchayat chairs; most government/local-body employees except MTS/Class IV/Group D; pensioners at ₹10,000+ monthly with stated exceptions; anyone who paid income tax in the last assessment year; registered practising doctors, engineers, lawyers, CAs and architects.';
  document.getElementById('exclusionHelp').textContent = `${copy.exclusionHelp}${exclusionDetails}`;
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
    kn: { possible_match: 'ಹೊಂದಾಣಿಕೆ ಇರಬಹುದು', not_eligible: 'ಹೊಂದಾಣಿಕೆ ಇಲ್ಲ', manual_review: 'ಅಧಿಕೃತ ಪರಿಶೀಲನೆ ಅಗತ್ಯ' },
    hi: { possible_match: 'संभावित पात्रता', not_eligible: 'शर्तें पूरी नहीं', manual_review: 'आधिकारिक जाँच आवश्यक' }
  };
  return (terms[language] || terms.en)[status] || (terms[language] || terms.en).manual_review;
}

function renderSchemeResults(language = document.getElementById('language').value) {
  document.getElementById('resultsList').innerHTML = lastSchemeResults.map(item => {
    const status = item.status || (item.eligible ? 'possible_match' : 'manual_review');
    const review = status !== 'possible_match';
    const checks = item.checks?.length ? `<ul class="scheme-checklist">${item.checks.map(check => `<li><span>${escapeHtml(check.label)}</span><b class="check-${escapeHtml(check.status)}">${escapeHtml(check.result)}</b></li>`).join('')}</ul>` : '';
    return `<div class="result-card"><div><b>${escapeHtml(item.name)}</b><p>${escapeHtml(item.reason || item.note || '')}<br><strong>${language === 'ta' ? 'அடுத்த படி' : language === 'kn' ? 'ಮುಂದಿನ ಹಂತ' : language === 'hi' ? 'अगला कदम' : 'Next step'}:</strong> ${escapeHtml(item.action || '')}${item.sourceUrl ? `<br><a href="${escapeHtml(item.sourceUrl)}" target="_blank" rel="noreferrer">${language === 'ta' ? 'அதிகாரப்பூர்வ ஆதாரம்' : language === 'kn' ? 'ಅಧಿಕೃತ ಮೂಲ' : language === 'hi' ? 'आधिकारिक स्रोत' : 'Official source'} ↗</a>` : ''}</p>${checks}</div><span class="result-status ${review ? 'review' : ''}">${schemeStatusText(status, language)}</span></div>`;
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
  hi: { greeting: 'नमस्ते', welcome: 'आज आपको अपने खेत के लिए किस मदद की ज़रूरत है?', placeholder: 'हिंदी, தமிழ், ಕನ್ನಡ या English में पूछें…', chatGreeting: 'नमस्ते! 🌱', chatIntro: 'आप अपनी फसल के बारे में क्या जानना चाहते हैं? कीट पहचानने के लिए तस्वीर भेजें।', chatTranslate: 'मैं फसल स्वास्थ्य, कीट और स्थानीय मौसम की जानकारी में मदद कर सकता हूँ।' },
  en: { greeting: 'Hello', welcome: 'Your farm is in good hands. What can we help with today?', placeholder: 'Ask in Tamil, Kannada, Hindi or English…' }
};
document.getElementById('language').addEventListener('change', event => {
  const copy = languageCopy[event.target.value];
  document.getElementById('greeting').textContent = copy.greeting;
  document.getElementById('welcomeText').textContent = copy.welcome;
  document.getElementById('chatInput').placeholder = copy.placeholder;
  if (event.target.value === 'hi') {
    const welcomeBubble = document.querySelector('#chatBody > .bot-message');
    welcomeBubble.querySelector('small').textContent = copy.chatGreeting;
    welcomeBubble.querySelector('p').textContent = copy.chatIntro;
    welcomeBubble.querySelector('.translate').textContent = copy.chatTranslate;
  }
  document.querySelector('.voice-button small').textContent = event.target.value === 'hi' ? 'Speak in Hindi, Tamil or Kannada' : 'Speak in Tamil, Kannada or Hindi';
  updateSchemeCopy(event.target.value);
  updateMemoryConsentCopy();
});

const demoReplies = [
  { match: /yellow|இலை|ಹಳದಿ|पीली|पीला|पत्ते/i, text: 'Yellowing leaves can come from waterlogging or a nutrient issue. Check whether water is standing around the roots, and inspect a few plants across the field. Share a clear photo of the whole plant and leaf close-up for a better assessment.', hi: 'पत्तियाँ पीली पड़ना जलभराव या पोषक तत्वों की कमी से हो सकता है। जड़ों के पास पानी जमा है या नहीं देखें और खेत के कुछ पौधों की जाँच करें। बेहतर सलाह के लिए पूरे पौधे और पत्ती की साफ़ तस्वीर भेजें।' },
  { match: /rain|weather|மழை|ಮಳೆ|बारिश|मौसम/i, text: 'Mandya forecast: light showers are expected tomorrow afternoon (about 8–12 mm). Clear field drains and move harvested grain to a covered, dry place. This is a demo forecast; connect your weather feed for live alerts.', hi: 'मांड्या का डेमो पूर्वानुमान: कल दोपहर हल्की बारिश (लगभग 8–12 मिमी) हो सकती है। खेत की नालियाँ साफ़ रखें और कटी फसल को ढके, सूखे स्थान पर रखें। लाइव चेतावनी के लिए मौसम सेवा जोड़ें।' },
  { match: /pest|borer|பூச்சி|புழு|ಕೀಟ|कीट|इल्लि|कीड़ा/i, text: 'I can help assess pest symptoms from a clear crop photo. Photograph the affected plant, the damaged area, and any visible insect. The photo check needs the Sarvam Knowledge Engine and crop diagnostic service connected before it can identify a pest.', hi: 'साफ़ फसल तस्वीर से कीट के लक्षण समझने में मदद करूँगा। प्रभावित पौधे, नुकसान वाले हिस्से और दिख रहे कीट की तस्वीर लें। सही पहचान के लिए Sarvam Knowledge Engine और फसल निदान सेवा जोड़ना आवश्यक है।' },
  { match: /yield|optim|விளைச்சல்|ಇಳುವರಿ|उपज|पैदावार/i, text: 'Yield guidance is provided through your existing DSS crop model. Connect the DSS adapter with crop, sowing date, soil and location data to return a field-specific recommendation here.', hi: 'उपज बढ़ाने की सलाह आपके DSS फसल मॉडल से मिलती है। खेत के अनुसार सुझाव पाने के लिए फसल, बुवाई की तारीख, मिट्टी और स्थान के डेटा वाला DSS एडेप्टर जोड़ें।' }
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
      body: JSON.stringify({ message, language: document.getElementById('language').value, location: document.getElementById('profileLocation').value || 'Mandya, Karnataka', rememberChat: document.getElementById('rememberChat').checked, ...extra })
    });
    if (response.ok) {
      const data = await response.json();
      if (data.memory?.saved) updateMemoryConsentCopy(true);
      if (data.memory?.phoneRequired) document.getElementById('memoryConsentStatus').textContent = profileMessage('Add a valid phone number in My farm preferences to link chat memory.', 'உரையாடல் நினைவகத்தை இணைக்க My farm preferences பகுதியில் சரியான தொலைபேசி எண்ணைச் சேர்க்கவும்.', 'ಚಾಟ್ ಮೆಮೊರಿಯನ್ನು ಜೋಡಿಸಲು My farm preferences ನಲ್ಲಿ ಸರಿಯಾದ ಫೋನ್ ಸಂಖ್ಯೆಯನ್ನು ಸೇರಿಸಿ.');
      return appendBot(data.reply || data.answer || 'I could not find a recommendation. Please try again.');
    }
  } catch (_) { /* Local demo responses are used when middleware is not running. */ }
  const result = demoReplies.find(item => item.match.test(message));
  const isHindi = document.getElementById('language').value === 'hi';
  appendBot(isHindi ? result?.hi || 'मैं मौसम, कीट के लक्षण और फसल की उपज पर मदद कर सकता हूँ। अपनी फसल, स्थान और समस्या बताएँ।' : result?.text || 'I can help with weather alerts, pest symptoms and yield optimisation. Tell me your crop, location and what you are seeing.');
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
  document.getElementById('chatBody').innerHTML = `<div class="bot-message"><span class="mini-avatar">நி</span><div><small>Vanakkam, ${escapeHtml(signedInUser?.name || 'Farmer')}! 🌱</small><p>What would you like help with on your farm today?</p><time>Just now</time></div></div>`;
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
  const location = document.getElementById('schemeLocation').value.trim() || document.getElementById('profileLocation').value.trim();
  const payload = { language: document.getElementById('language').value, state, district: location, landholding: land, landAcquisition: document.getElementById('landAcquisition').value, exclusions, familyBenefit: document.getElementById('familyBenefit').value, aadhaarLinkedBankAccount: aadhaar, samInterest: document.getElementById('samInterest').value, housingLand: document.getElementById('housingLand').value, housingPriority: document.getElementById('housingPriority').value, houseRoof: document.getElementById('houseRoof').value, priorHousing: document.getElementById('priorHousing').value, permanentStay: document.getElementById('permanentStay').value, ageBand: document.getElementById('ageBand').value, farmerType: document.getElementById('farmerType').value, safetyLand: document.getElementById('safetyLand').value };
  if (!location) { toast(profileMessage('Enter your district and village to find the correct local portal.', 'சரியான உள்ளூர் தளத்தைக் கண்டறிய மாவட்டம், கிராமத்தை உள்ளிடவும்.', 'ಸರಿಯಾದ ಸ್ಥಳೀಯ ಪೋರ್ಟಲ್ ಹುಡುಕಲು ಜಿಲ್ಲೆ ಮತ್ತು ಗ್ರಾಮ ನಮೂದಿಸಿ.')); document.getElementById('schemeLocation').focus(); return; }
  let results;
  try {
    const response = await fetch(`${API_BASE}/schemes/eligibility`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    if (!response.ok) throw new Error('Service unavailable');
    const data = await response.json();
    results = data.matches || [];
    if (data.disclaimer) document.querySelector('#schemeResults > p').textContent = data.disclaimer;
  } catch (_) {
    results = [
      { name: 'PM-KISAN', status: 'manual_review', reason: 'The local scheme service is unavailable, so none of your answers were checked. Do not rely on a scheme match until the check runs.', action: 'Retry when connected, or verify directly with PM-KISAN.', sourceUrl: 'https://pmkisan.gov.in/' },
      { name: 'Periyar Ninaivu Samathuvapuram (housing)', status: 'manual_review', reason: 'Tamil Nadu housing allotment programme; the eligibility service is unavailable, so no answers were evaluated.', action: 'Ask the local Block Development Office about the current Government Order and local allotments.', sourceUrl: 'https://tnrd.tn.gov.in/project/go_files/3_722_2023_91.pdf' },
      { name: 'Krushak Yojana', status: 'not_eligible', reason: 'This name does not identify a verified Tamil Nadu/Karnataka scheme. Odisha programmes have separate residency rules.', action: 'Choose the exact Odisha programme only if you are an Odisha resident.', sourceUrl: 'https://krushak.odisha.gov.in/' },
      { name: state === 'Tamil Nadu' ? 'Tamil Nadu AGRISNET scheme directory' : 'Karnataka Raitamitra', status: 'manual_review', reason: 'The state scheme catalogue needs to be checked for the exact district, crop, input and current application window.', action: 'Open the department directory and select a specific benefit.', sourceUrl: state === 'Tamil Nadu' ? 'https://www.tnagrisnet.tn.gov.in/home/schemes/tm' : 'https://raitamitra.karnataka.gov.in/' }
    ];
    document.querySelector('#schemeResults > p').textContent = profileMessage('Pre-screen only. There is no live land-record lookup or government decision. Confirm current rules and open applications with the department.', 'முதற்கட்டச் சரிபார்ப்பு மட்டுமே. நேரடி நிலப் பதிவு தேடல் அல்லது அரசு முடிவு இல்லை. தற்போதைய விதி, விண்ணப்ப திறப்பைத் துறையில் உறுதிப்படுத்தவும்.', 'ಪ್ರಾಥಮಿಕ ಪರಿಶೀಲನೆ ಮಾತ್ರ. ನೇರ ಭೂ ದಾಖಲೆ ಹುಡುಕಾಟ ಅಥವಾ ಸರ್ಕಾರಿ ತೀರ್ಮಾನವಿಲ್ಲ. ಪ್ರಸ್ತುತ ನಿಯಮ ಮತ್ತು ತೆರೆದ ಅರ್ಜಿಗಳನ್ನು ಇಲಾಖೆಯಲ್ಲಿ ದೃಢಪಡಿಸಿ.');
  }
  lastSchemeResults = results;
  renderSchemeResults();
  document.querySelector('[data-step="1"]').classList.remove('active');
  document.getElementById('schemeResults').classList.add('active');
  document.getElementById('stepLabel').textContent = schemePresentationCopy[document.getElementById('language').value]?.resultsStep || 'Results';
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
  const profilePhone = '';
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

function renderSavedGrievances(records, container) {
  if (!records.length) { container.innerHTML = '<p class="tracking-empty">No saved grievance IDs for this account yet.</p>'; return; }
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
    try { const response = await fetch(`/api/grievance-tracking/${encodeURIComponent(select.dataset.statusId)}`, { method:'PUT', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ status: select.value }) }); const result = await response.json(); if (!response.ok) throw new Error(result.error); toast('Saved status updated'); }
    catch (error) { toast(error.message || 'Could not update status'); }
  }));
  container.querySelectorAll('.escalate-grievance').forEach(button => button.addEventListener('click', () => {
    document.getElementById('trackingCaseId').value = button.dataset.caseId;
    document.getElementById('trackingState').value = button.dataset.state;
    document.getElementById('trackingCategory').value = button.dataset.category;
    document.getElementById('trackingLevel').value = 'higher'; refreshTrackingPortalOptions();
    document.getElementById('trackingId').focus();
    toast('After filing the appeal, enter the new authority’s tracking ID');
  }));
}
document.getElementById('trackingFindForm').addEventListener('submit', async event => {
  event.preventDefault();
  const target = document.getElementById('savedGrievances'); target.innerHTML = '<p class="tracking-empty">Loading saved grievances…</p>';
  try { const response = await fetch('/api/grievance-tracking'); const result = await response.json(); if (!response.ok) throw new Error(result.error); renderSavedGrievances(result.grievances, target); }
  catch (error) { target.innerHTML = `<p class="tracking-empty">${escapeHtml(error.message || 'Could not load saved grievances.')}</p>`; }
});
document.getElementById('trackingSaveForm').addEventListener('submit', async event => {
  event.preventDefault();
  const body = { caseId:document.getElementById('trackingCaseId').value || undefined, state:document.getElementById('trackingState').value, category:document.getElementById('trackingCategory').value, authorityLevel:document.getElementById('trackingLevel').value, portal:document.getElementById('trackingPortal').value, portalUrl:trackingPortalOptions[document.getElementById('trackingPortal').value], trackingId:document.getElementById('trackingId').value.trim(), status:document.getElementById('trackingStatus').value, consent:document.getElementById('trackingConsent').checked };
  try {
    const response = await fetch('/api/grievance-tracking', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body) }); const result = await response.json(); if (!response.ok) throw new Error(result.error);
    document.getElementById('trackingCaseId').value = ''; document.getElementById('trackingId').value = ''; document.getElementById('trackingConsent').checked = false;
    const findForm = document.getElementById('trackingFindForm'); findForm.requestSubmit(); toast('Official tracking ID saved');
  } catch (error) { toast(error.message || 'Could not save tracking ID'); }
});

document.getElementById('today').textContent = new Intl.DateTimeFormat('en', { weekday: 'long', day: '2-digit', month: 'long' }).format(new Date()).toUpperCase();
