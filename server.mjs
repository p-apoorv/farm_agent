import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { attachIvr } from './ivr.mjs';

try { process.loadEnvFile(); } catch { /* Local .env is optional; deployments should inject environment variables. */ }

const root = dirname(fileURLToPath(import.meta.url));
const dataPath = join(root, 'data', 'demo-store.json');
const port = Number(process.env.PORT || 4173);
const maxBodyBytes = 12 * 1024 * 1024;
const db = { grievances: [], eligibilityChecks: [], conversations: [] };
const ivrStatus = {
  active: Boolean(process.env.SARVAM_API_SUBSCRIPTION_KEY && process.env.IVR_STREAM_TOKEN && process.env.PUBLIC_WSS_URL && (process.env.IVR_ADAPTER_URL || process.env.SARVAM_ADAPTER_URL)),
  hasSarvamKey: Boolean(process.env.SARVAM_API_SUBSCRIPTION_KEY),
  hasStreamToken: Boolean(process.env.IVR_STREAM_TOKEN),
  hasPublicUrl: Boolean(process.env.PUBLIC_WSS_URL),
  hasConversationAdapter: Boolean(process.env.IVR_ADAPTER_URL || process.env.SARVAM_ADAPTER_URL),
  path: '/media'
};
let writeQueue = Promise.resolve();

await mkdir(dirname(dataPath), { recursive: true });
try { Object.assign(db, JSON.parse(await readFile(dataPath, 'utf8'))); } catch { await persist(); }

async function persist() {
  writeQueue = writeQueue.then(() => writeFile(dataPath, JSON.stringify(db, null, 2), 'utf8'));
  return writeQueue;
}

function send(res, status, body, extraHeaders = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extraHeaders });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', chunk => {
      size += chunk.length;
      if (size > maxBodyBytes) { reject(Object.assign(new Error('Request too large'), { status: 413 })); req.destroy(); return; }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function jsonBody(req) {
  const body = await readBody(req);
  try { return JSON.parse(body.toString('utf8') || '{}'); }
  catch { throw Object.assign(new Error('Expected a JSON request body'), { status: 400 }); }
}

function localized(language, english, tamil, kannada) {
  if (language === 'ta') return tamil;
  if (language === 'kn') return kannada;
  return english;
}

async function callAdapter(baseUrl, route, payload) {
  if (!baseUrl) return null;
  const response = await fetch(`${baseUrl.replace(/\/$/, '')}/${route}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal: AbortSignal.timeout(15000)
  });
  if (!response.ok) throw Object.assign(new Error(`Configured adapter returned ${response.status}`), { status: 502 });
  return response.json();
}

const categories = [
  { name: 'Crop damage / insurance', words: ['crop', 'damage', 'insurance', 'பயிர்', 'ಬೆಳೆ'] },
  { name: 'Scheme payment not received', words: ['payment', 'scheme', 'installment', 'தொகை', 'ಹಣ'] },
  { name: 'Input or fertilizer issue', words: ['fertilizer', 'seed', 'input', 'உரம்', 'ಗೊಬ್ಬರ'] },
  { name: 'Irrigation / electricity', words: ['water', 'irrigation', 'power', 'மின்சாரம்', 'ನೀರು'] }
];
function classifyGrievance(description) {
  const text = description.toLocaleLowerCase();
  return categories.find(category => category.words.some(word => text.includes(word)))?.name || 'Other';
}

function schemeText(language, english, tamil, kannada) {
  return localized(language, english, tamil, kannada);
}

function evaluateSchemeEligibility(body) {
  const lang = body.language || 'en';
  const rulesCheckedAt = new Date().toISOString();
  const pmkisanUrl = 'https://pmkisan.gov.in/';
  const samathuvapuramUrl = 'https://tnrd.tn.gov.in/schemes/st_samathuvapuram.html';
  const krushakUrl = 'https://agri.odisha.gov.in/en/agriculturedepartmentagricultu/kalia';
  const possible = (name, reason, action, sourceUrl, status = 'possible_match') => ({ name, status, eligible: status === 'possible_match', reason, action, sourceUrl, source: 'Official government source', updatedAt: rulesCheckedAt });

  let pmReason;
  let pmAction;
  let pmStatus;
  if (body.landholding !== 'own') {
    pmStatus = body.landholding === 'unsure' ? 'manual_review' : 'not_eligible';
    pmReason = body.landholding === 'unsure'
      ? schemeText(lang, 'We could not confirm cultivable land in the farmer family land records.', 'விவசாயக் குடும்பத்தின் நிலப் பதிவில் பயிரிடத்தக்க நிலம் உள்ளதா என்பதை உறுதிப்படுத்த முடியவில்லை.', 'ರೈತ ಕುಟುಂಬದ ಭೂ ದಾಖಲೆಗಳಲ್ಲಿ ಕೃಷಿಯೋಗ್ಯ ಭೂಮಿ ಇದೆಯೇ ಎಂಬುದನ್ನು ಖಚಿತಪಡಿಸಲಾಗಲಿಲ್ಲ.')
      : schemeText(lang, 'This screening requires cultivable land recorded in the farmer family land records; lease-only or no-land answers do not meet that first check.', 'இந்த முதற்கட்ட சரிபார்ப்புக்கு விவசாயக் குடும்பத்தின் நிலப் பதிவில் பயிரிடத்தக்க நிலம் இருக்க வேண்டும்; குத்தகை மட்டும் அல்லது நிலமில்லை என்ற பதில் இதை பூர்த்தி செய்யாது.', 'ಈ ಪ್ರಾಥಮಿಕ ಪರಿಶೀಲನೆಗೆ ರೈತ ಕುಟುಂಬದ ಭೂ ದಾಖಲೆಗಳಲ್ಲಿ ಕೃಷಿಯೋಗ್ಯ ಭೂಮಿ ಇರಬೇಕು; ಗುತ್ತಿಗೆ ಮಾತ್ರ ಅಥವಾ ಭೂಮಿ ಇಲ್ಲ ಎಂಬ ಉತ್ತರ ಇದನ್ನು ಪೂರೈಸುವುದಿಲ್ಲ.');
    pmAction = schemeText(lang, 'If a family member owns cultivable land, check the official PM-KISAN status using those land records.', 'குடும்ப உறுப்பினருக்கு பயிரிடத்தக்க நிலம் இருந்தால், அந்த நிலப் பதிவுகளுடன் அதிகாரப்பூர்வ PM-KISAN நிலையைச் சரிபார்க்கவும்.', 'ಕುಟುಂಬದ ಸದಸ್ಯರ ಹೆಸರಿನಲ್ಲಿ ಕೃಷಿಯೋಗ್ಯ ಭೂಮಿ ಇದ್ದರೆ, ಆ ಭೂ ದಾಖಲೆಗಳೊಂದಿಗೆ ಅಧಿಕೃತ PM-KISAN ಸ್ಥಿತಿಯನ್ನು ಪರಿಶೀಲಿಸಿ.');
  } else if (body.exclusions === 'yes') {
    pmStatus = 'not_eligible';
    pmReason = schemeText(lang, 'You reported a possible PM-KISAN exclusion category. The family is unlikely to qualify unless the authority confirms an exception.', 'PM-KISAN விலக்கு வகை இருக்கலாம் எனத் தெரிவித்துள்ளீர்கள். அதிகாரப்பூர்வமாக விதிவிலக்கு உறுதி செய்யப்படாவிட்டால் குடும்பம் தகுதி பெற வாய்ப்பு குறைவு.', 'PM-KISAN ಹೊರತಾಗುವ ವರ್ಗ ಇರಬಹುದು ಎಂದು ನೀವು ತಿಳಿಸಿದ್ದಾರೆ. ಅಧಿಕಾರಿಗಳು ವಿನಾಯಿತಿಯನ್ನು ದೃಢಪಡಿಸದಿದ್ದರೆ ಕುಟುಂಬ ಅರ್ಹವಾಗಿರುವ ಸಾಧ್ಯತೆ ಕಡಿಮೆ.');
    pmAction = schemeText(lang, 'Confirm the exact category with the PM-KISAN helpdesk before applying.', 'விண்ணப்பிக்கும் முன் PM-KISAN உதவி மையத்தில் சரியான வகையை உறுதிப்படுத்தவும்.', 'ಅರ್ಜಿ ಸಲ್ಲಿಸುವ ಮೊದಲು PM-KISAN ಸಹಾಯವಾಣಿಯಲ್ಲಿ ನಿಖರ ವರ್ಗವನ್ನು ದೃಢಪಡಿಸಿ.');
  } else if (body.exclusions !== 'no') {
    pmStatus = 'manual_review';
    pmReason = schemeText(lang, 'Land records appear to meet the first screen, but the PM-KISAN exclusion check is incomplete.', 'நிலப் பதிவுகள் முதற்கட்ட நிபந்தனையைப் பூர்த்தி செய்யலாம்; ஆனால் PM-KISAN விலக்கு சரிபார்ப்பு முழுமையடையவில்லை.', 'ಭೂ ದಾಖಲೆಗಳು ಪ್ರಾಥಮಿಕ ಪರಿಶೀಲನೆಯನ್ನು ಪೂರೈಸಬಹುದು; ಆದರೆ PM-KISAN ಹೊರತಾಗುವಿಕೆ ಪರಿಶೀಲನೆ ಪೂರ್ಣಗೊಂಡಿಲ್ಲ.');
    pmAction = schemeText(lang, 'Check the family against the exclusion list shown above and verify on the official portal.', 'மேலே உள்ள விலக்கு பட்டியலுடன் குடும்ப விவரங்களைச் சரிபார்த்து அதிகாரப்பூர்வ இணையதளத்தில் உறுதி செய்யவும்.', 'ಮೇಲಿನ ಹೊರತಾಗುವಿಕೆ ಪಟ್ಟಿಯೊಂದಿಗೆ ಕುಟುಂಬದ ವಿವರಗಳನ್ನು ಹೋಲಿಸಿ ಅಧಿಕೃತ ಪೋರ್ಟಲ್‌ನಲ್ಲಿ ಪರಿಶೀಲಿಸಿ.');
  } else {
    pmStatus = 'possible_match';
    pmReason = schemeText(lang, 'The farmer family reports recorded cultivable land and no known exclusion. This is a preliminary match, not an approval.', 'குடும்பத்தின் பெயரில் பயிரிடத்தக்க நிலப் பதிவு உள்ளது என்றும் தெரிந்த விலக்குகள் இல்லை என்றும் தெரிவித்துள்ளீர்கள். இது முதற்கட்ட பொருத்தம் மட்டுமே; ஒப்புதல் அல்ல.', 'ರೈತ ಕುಟುಂಬದ ಹೆಸರಿನಲ್ಲಿ ಕೃಷಿಯೋಗ್ಯ ಭೂಮಿ ದಾಖಲಾಗಿದೆ ಮತ್ತು ತಿಳಿದಿರುವ ಹೊರತಾಗುವಿಕೆಗಳಿಲ್ಲ ಎಂದು ತಿಳಿಸಿದ್ದಾರೆ. ಇದು ಪ್ರಾಥಮಿಕ ಹೊಂದಾಣಿಕೆ ಮಾತ್ರ; ಅನುಮೋದನೆ ಅಲ್ಲ.');
    pmAction = schemeText(lang, 'Complete mandatory eKYC and check beneficiary status, land verification and bank/DBT details on PM-KISAN.', 'கட்டாய eKYC-ஐ முடித்து PM-KISAN-ல் பயனாளர் நிலை, நிலச் சரிபார்ப்பு மற்றும் வங்கி/DBT விவரங்களைப் பார்க்கவும்.', 'ಕಡ್ಡಾಯ eKYC ಪೂರ್ಣಗೊಳಿಸಿ PM-KISAN ನಲ್ಲಿ ಫಲಾನುಭವಿ ಸ್ಥಿತಿ, ಭೂ ಪರಿಶೀಲನೆ ಮತ್ತು ಬ್ಯಾಂಕ್/DBT ವಿವರಗಳನ್ನು ಪರಿಶೀಲಿಸಿ.');
  }

  const samathuvapuram = body.state === 'Tamil Nadu'
    ? possible('Mukhyamantri Samathuvapuram', schemeText(lang,
      'This is Tamil Nadu’s Samathuvapuram housing programme, not a general farmer cash/benefit scheme. House allotment depends on an active local settlement, beneficiary selection and district approval.',
      'இது தமிழ்நாட்டின் சமத்துவபுரம் குடியிருப்புத் திட்டம்; பொதுவான விவசாயி பண உதவித் திட்டம் அல்ல. உள்ளூர் குடியிருப்பு, பயனாளர் தேர்வு மற்றும் மாவட்ட ஒப்புதலைப் பொறுத்து வீடு ஒதுக்கப்படும்.',
      'ಇದು ತಮಿಳುನಾಡಿನ ಸಮத்தುವಪುರಂ ವಸತಿ ಯೋಜನೆ; ಸಾಮಾನ್ಯ ರೈತ ನಗದು/ಲಾಭ ಯೋಜನೆ ಅಲ್ಲ. ಮನೆ ಹಂಚಿಕೆ ಸ್ಥಳೀಯ ವಸತಿ, ಫಲಾನುಭವಿಗಳ ಆಯ್ಕೆ ಮತ್ತು ಜಿಲ್ಲಾಧಿಕಾರಿ ಅನುಮೋದನೆಗೆ ಒಳಪಟ್ಟಿದೆ.'), schemeText(lang,
      'Ask the Block Development Office whether a Samathuvapuram allotment is open in your area and request the current beneficiary criteria.',
      'உங்கள் பகுதியில் சமத்துவபுரம் வீடு ஒதுக்கீடு திறந்திருப்பதா என்று வட்டார வளர்ச்சி அலுவலகத்தில் கேட்டு தற்போதைய பயனாளர் நிபந்தனைகளைப் பெறவும்.',
      'ನಿಮ್ಮ ಪ್ರದೇಶದಲ್ಲಿ ಸಮತ್ತುವಪುರಂ ಮನೆ ಹಂಚಿಕೆ ತೆರೆದಿದೆಯೇ ಎಂದು ಬ್ಲಾಕ್ ಅಭಿವೃದ್ಧಿ ಕಚೇರಿಯಲ್ಲಿ ಕೇಳಿ ಪ್ರಸ್ತುತ ಫಲಾನುಭವಿ ಮಾನದಂಡಗಳನ್ನು ಪಡೆಯಿರಿ.'), samathuvapuramUrl, 'manual_review')
    : possible('Mukhyamantri Samathuvapuram', schemeText(lang,
      'The official Samathuvapuram programme is a Tamil Nadu housing scheme; it is not available as a Karnataka farmer benefit.',
      'அதிகாரப்பூர்வ சமத்துவபுரம் திட்டம் தமிழ்நாட்டின் குடியிருப்புத் திட்டம்; இது கர்நாடக விவசாயி நலனாக கிடையாது.',
      'ಅಧಿಕೃತ ಸಮತ್ತುವಪುರಂ ಯೋಜನೆ ತಮಿಳುನಾಡಿನ ವಸತಿ ಯೋಜನೆ; ಇದು ಕರ್ನಾಟಕದ ರೈತ ಸೌಲಭ್ಯವಲ್ಲ.'), schemeText(lang,
      'Check Tamil Nadu Rural Development and Panchayat Raj only if you are seeking a housing allotment in Tamil Nadu.',
      'தமிழ்நாட்டில் வீடு ஒதுக்கீடு தேவைப்பட்டால் மட்டுமே தமிழ்நாடு ஊரக வளர்ச்சி மற்றும் ஊராட்சித் துறையை அணுகவும்.',
      'ತಮಿಳುನಾಡಿನಲ್ಲಿ ಮನೆ ಹಂಚಿಕೆ ಬೇಕಿದ್ದರೆ ಮಾತ್ರ ತಮಿಳುನಾಡು ಗ್ರಾಮೀಣಾಭಿವೃದ್ಧಿ ಮತ್ತು ಪಂಚಾಯತ್ ರಾಜ್ ಇಲಾಖೆಯನ್ನು ಸಂಪರ್ಕಿಸಿ.'), samathuvapuramUrl, 'not_eligible');

  const krushak = possible('Krushak Yojana', schemeText(lang,
    'The name “Krushak Yojana” does not identify one verified active scheme for Tamil Nadu or Karnataka. Odisha has multiple distinct Krushak programmes; they should not be treated as interchangeable.',
    '“Krushak Yojana” என்ற பெயர் தமிழ்நாடு அல்லது கர்நாடகத்தில் ஒரு குறிப்பிட்ட தற்போதைய திட்டத்தை அடையாளம் காட்டவில்லை. ஒடிசாவில் பல வேறு Krushak திட்டங்கள் உள்ளன; அவற்றை ஒன்றாகக் கருத முடியாது.',
    '“Krushak Yojana” ಎಂಬ ಹೆಸರು ತಮಿಳುನಾಡು ಅಥವಾ ಕರ್ನಾಟಕದ ಒಂದು ನಿರ್ದಿಷ್ಟ ಸಕ್ರಿಯ ಯೋಜನೆಯನ್ನು ಗುರುತಿಸುವುದಿಲ್ಲ. ಒಡಿಶಾದಲ್ಲಿ ಹಲವು ವಿಭಿನ್ನ Krushak ಯೋಜನೆಗಳಿವೆ; ಅವುಗಳನ್ನು ಒಂದೇ ಎಂದು ಪರಿಗಣಿಸಬಾರದು.'), schemeText(lang,
    'Please provide the exact scheme name and state. If you meant an Odisha programme, eligibility must be checked under that programme’s current guidelines and Odisha residency rules.',
    'திட்டத்தின் சரியான பெயர் மற்றும் மாநிலத்தைத் தெரிவிக்கவும். ஒடிசா திட்டத்தை குறித்திருந்தால் அதன் தற்போதைய வழிகாட்டுதல்கள் மற்றும் ஒடிசா குடியிருப்பு நிபந்தனைகளின் அடிப்படையில் சரிபார்க்க வேண்டும்.',
    'ಯೋಜನೆಯ ನಿಖರ ಹೆಸರು ಮತ್ತು ರಾಜ್ಯವನ್ನು ತಿಳಿಸಿ. ಒಡಿಶಾ ಯೋಜನೆಯನ್ನು ಉದ್ದೇಶಿಸಿದ್ದರೆ ಅದರ ಪ್ರಸ್ತುತ ಮಾರ್ಗಸೂಚಿ ಮತ್ತು ಒಡಿಶಾ ನಿವಾಸ ನಿಯಮಗಳ ಪ್ರಕಾರ ಪರಿಶೀಲಿಸಬೇಕು.'), krushakUrl, 'manual_review');

  return { mode: 'rules-screening', matches: [possible('PM-KISAN', pmReason, pmAction, pmkisanUrl, pmStatus), samathuvapuram, krushak], checkedAt: rulesCheckedAt };
}

async function handle(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = decodeURIComponent(url.pathname);
  if (req.method === 'GET' && pathname === '/api/health') return send(res, 200, { service: 'nelam-middleware', mode: 'demo', persistentStore: 'local-json', integrations: { sarvam: Boolean(process.env.SARVAM_ADAPTER_URL || process.env.SARVAM_API_SUBSCRIPTION_KEY), knowledgeEngine: Boolean(process.env.KNOWLEDGE_ADAPTER_URL), weather: Boolean(process.env.WEATHER_ADAPTER_URL), dss: Boolean(process.env.DSS_ADAPTER_URL), schemeRegistry: Boolean(process.env.SCHEME_ADAPTER_URL), grievanceSystem: Boolean(process.env.GRIEVANCE_ADAPTER_URL), whatsapp: Boolean(process.env.WHATSAPP_ADAPTER_URL), ivr: ivrStatus.active } });

  if (req.method === 'GET' && pathname === '/api/ivr/status') return send(res, 200, { ...ivrStatus, publicStreamUrl: process.env.PUBLIC_WSS_URL || null, requires: ['Exotel ExoPhone + Voicebot applet', 'SARVAM_API_SUBSCRIPTION_KEY', 'IVR_STREAM_TOKEN', 'public TLS WSS deployment', 'SARVAM_ADAPTER_URL for conversational routing'] });

  if (req.method === 'POST' && pathname === '/api/ivr/turn') {
    const body = await jsonBody(req);
    if (!body.transcript?.trim()) return send(res, 400, { error: 'Voice transcript is required.' });
    const adapter = process.env.IVR_ADAPTER_URL || process.env.SARVAM_ADAPTER_URL;
    const route = process.env.IVR_ADAPTER_URL ? 'turn' : 'conversation';
    const answer = adapter ? await callAdapter(adapter, route, { ...body, message: body.transcript, module: 'farm-assistant' }) : null;
    const language = body.language === 'kn-IN' ? 'kn' : 'ta';
    const reply = answer?.reply || localized(language,
      'The IVR is connected in demo mode. Add the Sarvam conversation adapter for live crop, scheme and grievance help.',
      'தொலைபேசி உதவி மாதிரி நிலையில் உள்ளது. பயிர், திட்டம் மற்றும் புகார் உதவிக்கு சர்வம் உரையாடல் இணைப்பை அமைக்கவும்.',
      'ಫೋನ್ ಸಹಾಯಕ ಡೆಮೋ ಸ್ಥಿತಿಯಲ್ಲಿದೆ. ಬೆಳೆ, ಯೋಜನೆ ಮತ್ತು ದೂರು ಸಹಾಯಕ್ಕಾಗಿ ಸರ್ವಂ ಸಂಭಾಷಣೆ ಅಡಾಪ್ಟರ್ ಹೊಂದಿಸಿ.');
    db.conversations.unshift({ id: randomUUID(), message: body.transcript, language, channel: 'ivr', createdAt: new Date().toISOString(), source: answer ? 'ivr-adapter' : 'demo' });
    await persist();
    return send(res, 200, { reply, language: answer?.language || language, mode: answer ? 'connected-adapter' : 'demo', module: answer?.module || 'farm-assistant' });
  }

  if (req.method === 'POST' && pathname === '/api/crop/advisory') {
    const body = await jsonBody(req);
    const base = { ...body, channel: 'web-demo' };
    const [knowledge, weather, dss] = await Promise.all([
      callAdapter(process.env.KNOWLEDGE_ADAPTER_URL, 'crop-advisory', base),
      /weather|rain|மழை|மழை|ಮಳೆ/i.test(body.message || '') ? callAdapter(process.env.WEATHER_ADAPTER_URL, 'forecast', base) : null,
      /yield|optim|விளைச்சல்|இಳುವರಿ/i.test(body.message || '') ? callAdapter(process.env.DSS_ADAPTER_URL, 'crop-recommendation', base) : null
    ]);
    const speechAnswer = await callAdapter(process.env.SARVAM_ADAPTER_URL, 'conversation', { ...base, knowledgeContext: knowledge?.context || knowledge?.results, weatherContext: weather, dssContext: dss });
    const reply = speechAnswer?.reply || dss?.reply || weather?.reply || knowledge?.reply || localized(body.language,
      'Demo response: add Sarvam Conversational AI, Knowledge Engine, live weather and DSS adapters for grounded farm guidance.',
      'மாதிரி பதில்: துல்லியமான பண்ணை ஆலோசனைக்கு சர்வம், நேரடி வானிலை மற்றும் DSS இணைப்புகளை அமைக்கவும்.',
      'ಮಾದರಿ ಉತ್ತರ: ನಿಖರ ಕೃಷಿ ಸಲಹೆಗಾಗಿ ಸರ್ವಂ, ನೈಜ ಹವಾಮಾನ ಮತ್ತು DSS ಸಂಪರ್ಕಗಳನ್ನು ಹೊಂದಿಸಿ.');
    const record = { id: randomUUID(), message: body.message || '', language: body.language || 'ta', createdAt: new Date().toISOString(), source: speechAnswer ? 'sarvam-adapter' : knowledge ? 'knowledge-engine' : 'demo' };
    db.conversations.unshift(record); db.conversations.length = Math.min(db.conversations.length, 500); await persist();
    return send(res, 200, { reply, language: body.language || 'ta', sources: speechAnswer?.sources || knowledge?.sources || dss?.sources || [], weather: weather || undefined, dssRecommendation: dss || undefined, mode: speechAnswer || knowledge || weather || dss ? 'connected-adapter' : 'demo' });
  }

  if (req.method === 'POST' && pathname === '/api/crop/voice') {
    const audio = await readBody(req);
    if (!audio.length) return send(res, 400, { error: 'Voice recording is empty.' });
    const language = req.headers['x-language'] || 'ta';
    const contentType = req.headers['content-type'] || 'audio/webm';
    const speech = await callAdapter(process.env.SARVAM_ADAPTER_URL, 'speech-to-text', { audioBase64: audio.toString('base64'), contentType, language });
    if (!speech?.transcript) return send(res, 503, { error: 'Sarvam speech recognition adapter is not configured or returned no transcript.' });
    const answer = await callAdapter(process.env.SARVAM_ADAPTER_URL, 'conversation', { message: speech.transcript, language, channel: 'voice-demo' });
    if (!answer?.reply) return send(res, 503, { transcript: speech.transcript, error: 'Sarvam conversational adapter did not return an answer.' });
    return send(res, 200, { transcript: speech.transcript, reply: answer.reply, language, audioBase64: answer.audioBase64, audioContentType: answer.audioContentType, sources: answer.sources || [] });
  }

  if (req.method === 'POST' && pathname === '/api/crop/photo') {
    const contentType = req.headers['content-type'] || '';
    if (!contentType.includes('multipart/form-data')) return send(res, 415, { error: 'Upload a multipart image.' });
    const bytes = await readBody(req);
    const boundary = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/)?.slice(1).find(Boolean);
    if (!boundary) return send(res, 400, { error: 'Multipart boundary missing.' });
    const raw = bytes.toString('latin1');
    const parts = raw.split(`--${boundary}`);
    const filePart = parts.find(part => /name="photo"/.test(part) && /filename="[^"]+"/.test(part));
    if (!filePart) return send(res, 400, { error: 'Crop photo is required.' });
    const mime = filePart.match(/Content-Type:\s*([^\r\n]+)/i)?.[1] || '';
    if (!mime.startsWith('image/')) return send(res, 415, { error: 'Only image files are accepted.' });
    const formValue = name => parts.find(part => part.includes(`name="${name}"`))?.split('\r\n\r\n')[1]?.split('\r\n')[0] || '';
    const payload = { language: formValue('language') || 'ta', location: formValue('location'), mimeType: mime, photoBase64: Buffer.from(filePart.split('\r\n\r\n')[1]?.replace(/\r\n$/, '') || '', 'latin1').toString('base64') };
    const assessment = await callAdapter(process.env.KNOWLEDGE_ADAPTER_URL || process.env.SARVAM_ADAPTER_URL, 'crop-photo', payload);
    if (!assessment) return send(res, 503, { error: 'Photo diagnosis is not connected. Configure the Sarvam Knowledge Engine / approved crop diagnostic adapter.' });
    return send(res, 200, { assessment: assessment.assessment || assessment.reply, reply: assessment.reply, confidence: assessment.confidence, sources: assessment.sources || [], language: payload.language });
  }

  if (req.method === 'POST' && pathname === '/api/schemes/eligibility') {
    const body = await jsonBody(req);
    if (!['own', 'lease', 'none', 'unsure'].includes(body.landholding) || !['yes', 'no', 'unsure'].includes(body.exclusions)) return send(res, 400, { error: 'Please answer the land-record and exclusion questions before checking.' });
    const result = evaluateSchemeEligibility(body);
    let assistant = null;
    try { assistant = await callAdapter(process.env.SCHEME_ADAPTER_URL, 'explain', { ...body, rulesResults: result.matches }); } catch { /* Curated rules still return a result if the optional language adapter is offline. */ }
    if (assistant?.reply) result.reply = assistant.reply;
    if (assistant?.sources) result.assistantSources = assistant.sources;
    const check = { id: randomUUID(), answers: body, result, createdAt: new Date().toISOString() };
    db.eligibilityChecks.unshift(check); db.eligibilityChecks.length = Math.min(db.eligibilityChecks.length, 1000); await persist();
    return send(res, 200, { ...result, checkId: check.id, checkedAt: check.createdAt });
  }

  if (req.method === 'POST' && pathname === '/api/grievances') {
    const body = await jsonBody(req);
    if (!body.description?.trim() || !body.village?.trim() || !body.consent) return send(res, 400, { error: 'Description, village and consent are required.' });
    const classification = await callAdapter(process.env.SARVAM_ADAPTER_URL, 'grievance-intake', { description: body.description, language: body.language, categories: categories.map(item => item.name) });
    const external = await callAdapter(process.env.GRIEVANCE_ADAPTER_URL, 'grievances', { ...body, category: classification?.category || body.category || classifyGrievance(body.description), summary: classification?.summary || body.description.trim().slice(0, 240) });
    const id = external?.id || `NL-${new Date().getFullYear()}-${String(Date.now()).slice(-6)}`;
    const record = { id, category: classification?.category || body.category || classifyGrievance(body.description), description: body.description.trim(), summary: classification?.summary || body.description.trim().slice(0, 240), village: body.village.trim(), language: body.language || 'ta', status: external?.status || 'Received', routing: external?.routing || 'Demo queue · configure department routing', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), demo: !external };
    db.grievances.unshift(record); await persist();
    return send(res, external ? 201 : 201, { id, status: record.status, demo: record.demo, message: record.demo ? 'Stored in the local demo case register; no government office has received this grievance.' : undefined });
  }

  const caseMatch = pathname.match(/^\/api\/grievances\/([^/]+)$/);
  if (req.method === 'GET' && caseMatch) {
    const record = db.grievances.find(item => item.id === caseMatch[1]);
    if (!record) return send(res, 404, { error: 'Grievance ID not found.' });
    const external = await callAdapter(process.env.GRIEVANCE_ADAPTER_URL, `grievances/${encodeURIComponent(record.id)}/status`, {});
    return send(res, 200, { ...record, ...(external || {}) });
  }

  if (req.method === 'GET' && pathname === '/api/admin/grievances') return send(res, 200, { mode: 'demo', total: db.grievances.length, grievances: db.grievances });
  if (req.method === 'GET' && pathname === '/api/admin/eligibility-checks') return send(res, 200, { mode: 'demo', total: db.eligibilityChecks.length, checks: db.eligibilityChecks });

  if (pathname.startsWith('/api/channels/')) {
    const isIvr = pathname.startsWith('/api/channels/ivr');
    const target = isIvr ? process.env.IVR_ADAPTER_URL : process.env.WHATSAPP_ADAPTER_URL;
    if (!target) return send(res, 503, { error: `${isIvr ? 'IVR' : 'WhatsApp'} adapter is not configured.` });
    const body = await jsonBody(req);
    const result = await callAdapter(target, pathname.split('/').slice(4).join('/') || 'webhook', body);
    return send(res, 200, result || { accepted: true });
  }

  if (req.method === 'GET' && pathname === '/') {
    const html = await readFile(join(root, 'index.html'));
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); return res.end(html);
  }
  const relative = normalize(pathname.slice(1));
  const asset = join(root, relative);
  if (asset.startsWith(root) && ['.css', '.js', '.svg', '.png', '.ico'].includes(extname(asset))) {
    try { const content = await readFile(asset); res.writeHead(200, { 'Content-Type': extname(asset) === '.css' ? 'text/css; charset=utf-8' : extname(asset) === '.js' ? 'text/javascript; charset=utf-8' : 'application/octet-stream' }); return res.end(content); } catch { /* Fall through to 404. */ }
  }
  return send(res, 404, { error: 'Not found' });
}

const server = http.createServer((req, res) => {
  handle(req, res).catch(error => {
    if (!res.headersSent) send(res, error.status || 502, { error: error.message || 'Middleware request failed.' });
    else res.destroy();
  });
});
attachIvr(server);
server.listen(port, '0.0.0.0', () => console.log(`Nelam demo server listening on port ${port}`));
