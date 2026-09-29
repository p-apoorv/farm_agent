import http from 'node:http';
import { createHmac, randomUUID, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { attachIvr } from './ivr.mjs';
import { isMem0Configured, normalizePhoneNumber, searchUserMemories, storeChatSummary } from './mem0.mjs';

try { process.loadEnvFile(); } catch { /* Local .env is optional; deployments should inject environment variables. */ }

const root = dirname(fileURLToPath(import.meta.url));
const dataPath = join(root, 'data', 'demo-store.json');
const port = Number(process.env.PORT || 4173);
const maxBodyBytes = 12 * 1024 * 1024;
const db = { grievances: [], eligibilityChecks: [], conversations: [], farmerProfiles: {}, farmerGrievanceTracking: [], authUsers: {} };
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

let profilePool = null;
if (process.env.DATABASE_URL) {
  try {
    const { Pool } = await import('pg');
    profilePool = new Pool({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 10000, ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : undefined });
    await profilePool.query(`CREATE TABLE IF NOT EXISTS farmer_profiles (user_id TEXT PRIMARY KEY, preferences JSONB NOT NULL DEFAULT '{}'::jsonb, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
    await profilePool.query(`CREATE TABLE IF NOT EXISTS farmer_grievance_tracking (id TEXT PRIMARY KEY, case_id TEXT NOT NULL, farmer_id TEXT NOT NULL, state TEXT NOT NULL, category TEXT NOT NULL, authority_level TEXT NOT NULL, portal TEXT NOT NULL, portal_url TEXT NOT NULL, tracking_id TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'submitted', filed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
    await profilePool.query(`CREATE TABLE IF NOT EXISTS auth_users (id TEXT PRIMARY KEY, contact_channel TEXT NOT NULL CHECK (contact_channel IN ('phone','email')), contact_value TEXT NOT NULL, name TEXT NOT NULL, password_salt TEXT NOT NULL, password_hash TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
    await profilePool.query(`ALTER TABLE auth_users ADD COLUMN IF NOT EXISTS password_salt TEXT`);
    await profilePool.query(`ALTER TABLE auth_users ADD COLUMN IF NOT EXISTS password_hash TEXT`);
  } catch (error) {
    console.error('Profile database initialization failed. Check DATABASE_URL and database availability.');
    profilePool = null;
  }
}
const profileStorage = () => profilePool ? 'postgres' : 'local-demo';
const authCookieName = 'nelam_session';
const authSecret = process.env.AUTH_SESSION_SECRET || process.env.USER_ID_SECRET || (process.env.DATABASE_URL ? createHmac('sha256', process.env.DATABASE_URL).update('nelam-auth-session-v1').digest('hex') : null);
const scryptAsync = promisify(scrypt);
function authUserId(channel, contact) {
  return authSecret ? createHmac('sha256', authSecret).update(`${channel}:${contact}`).digest('hex') : null;
}
function constantTimeBufferEqual(left, right) {
  return left.length === right.length && left.length > 0 && timingSafeEqual(left, right);
}
function cookieValue(req, name) {
  const raw = req.headers.cookie || '';
  const entry = raw.split(';').map(value => value.trim()).find(value => value.startsWith(`${name}=`));
  if (!entry) return '';
  try { return decodeURIComponent(entry.slice(name.length + 1)); } catch { return ''; }
}
function createSession(userId) {
  const payload = Buffer.from(JSON.stringify({ userId, exp: Date.now() + 30 * 24 * 60 * 60 * 1000 })).toString('base64url');
  const signature = createHmac('sha256', authSecret).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}
function sessionUser(req) {
  if (!authSecret) return null;
  const token = cookieValue(req, authCookieName);
  const [payload, signature, extra] = token.split('.');
  if (!payload || !signature || extra) return null;
  const expected = createHmac('sha256', authSecret).update(payload).digest();
  let supplied;
  try { supplied = Buffer.from(signature, 'base64url'); } catch { return null; }
  if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) return null;
  try {
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return typeof claims.userId === 'string' && claims.exp > Date.now() ? { userId: claims.userId } : null;
  } catch { return null; }
}
function sessionCookie(token) {
  const secure = process.env.NODE_ENV === 'production' || process.env.RENDER === 'true' ? '; Secure' : '';
  return `${authCookieName}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000${secure}`;
}
async function readAuthUser(userId) {
  if (profilePool) {
    const { rows } = await profilePool.query('SELECT id, name, contact_channel AS "contactChannel", password_salt AS "passwordSalt", password_hash AS "passwordHash" FROM auth_users WHERE id=$1', [userId]);
    return rows[0] || null;
  }
  return db.authUsers[userId] || null;
}
async function passwordHash(password, saltText) {
  const salt = saltText ? Buffer.from(saltText, 'base64url') : randomBytes(16);
  const hash = await scryptAsync(password, salt, 64, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  return { salt: salt.toString('base64url'), hash: Buffer.from(hash).toString('base64url') };
}
async function createPasswordUser(userId, channel, contactHash, name, password) {
  const credentials = await passwordHash(password);
  if (profilePool) {
    const { rows } = await profilePool.query(`INSERT INTO auth_users (id, contact_channel, contact_value, name, password_salt, password_hash) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (id) DO NOTHING RETURNING id,name,contact_channel AS "contactChannel",password_salt AS "passwordSalt",password_hash AS "passwordHash"`, [userId, channel, contactHash, name, credentials.salt, credentials.hash]);
    return rows[0] || null;
  }
  if (db.authUsers[userId]) return null;
  const user = { id: userId, name, contactChannel: channel, contactValue: contactHash, ...credentials };
  db.authUsers[userId] = user; await persist(); return user;
}
async function verifyPassword(user, password) {
  if (!user?.passwordSalt || !user?.passwordHash) return false;
  try {
    const actual = Buffer.from((await passwordHash(password, user.passwordSalt)).hash, 'base64url');
    const expected = Buffer.from(user.passwordHash, 'base64url');
    return constantTimeBufferEqual(actual, expected);
  }
  catch { return false; }
}
const trackingPortals = {
  'Tamil Nadu CM Helpline': 'cmhelpline.tnega.org',
  'Karnataka Janaspandana (iPGRS)': 'ipgrs.karnataka.gov.in',
  'PM Fasal Bima Yojana (PMFBY)': 'pmfby.gov.in',
  'PM-KISAN grievance form': 'pmkisan.gov.in',
  'CPGRAMS': 'pgportal.gov.in'
};

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
  const text = await response.text();
  if (!text) return null;
  try { return JSON.parse(text); } catch { return { result: text.slice(0, 1000) }; }
}

async function loadChatMemory(body, accountId) {
  if (body.rememberChat !== true || !isMem0Configured()) return { userId: null, summaries: [] };
  const userId = `nelam-${accountId}`;
  try {
    const summaries = await searchUserMemories(userId, body.message);
    return { userId, summaries };
  } catch (error) {
    console.warn('Mem0 memory search failed:', error.message);
    return { userId, summaries: [] };
  }
}

const preferenceFields = ['crop', 'fertilizerChoices', 'soilType', 'irrigation', 'farmLocation', 'language'];
function cleanPreferences(value) {
  const limits = { crop: 80, fertilizerChoices: 300, soilType: 80, irrigation: 80, farmLocation: 120, language: 2 };
  const result = {};
  for (const field of preferenceFields) {
    const text = typeof value?.[field] === 'string' ? value[field].trim().slice(0, limits[field]) : '';
    if (text) result[field] = text;
  }
  if (result.language && !['en', 'ta', 'kn'].includes(result.language)) delete result.language;
  return result;
}
async function getFarmerProfile(userId) {
  if (profilePool) {
    let rows;
    try { ({ rows } = await profilePool.query('SELECT preferences, updated_at FROM farmer_profiles WHERE user_id = $1', [userId])); }
    catch { throw Object.assign(new Error('Profile database is unavailable.'), { status: 503 }); }
    return rows[0] ? { preferences: rows[0].preferences, updatedAt: rows[0].updated_at } : null;
  }
  return db.farmerProfiles[userId] || null;
}
async function saveFarmerProfile(userId, preferences) {
  if (profilePool) {
    let rows;
    try { ({ rows } = await profilePool.query(`INSERT INTO farmer_profiles (user_id, preferences) VALUES ($1, $2::jsonb) ON CONFLICT (user_id) DO UPDATE SET preferences = EXCLUDED.preferences, updated_at = NOW() RETURNING preferences, updated_at`, [userId, JSON.stringify(preferences)])); }
    catch { throw Object.assign(new Error('Profile database is unavailable.'), { status: 503 }); }
    return { preferences: rows[0].preferences, updatedAt: rows[0].updated_at };
  }
  const profile = { preferences, updatedAt: new Date().toISOString() };
  db.farmerProfiles[userId] = profile;
  await persist();
  return profile;
}

async function listGrievanceTracking(farmerId) {
  if (profilePool) {
    try {
      const { rows } = await profilePool.query('SELECT id, case_id AS "caseId", state, category, authority_level AS "authorityLevel", portal, portal_url AS "portalUrl", tracking_id AS "trackingId", status, filed_at AS "filedAt", updated_at AS "updatedAt" FROM farmer_grievance_tracking WHERE farmer_id = $1 ORDER BY filed_at DESC', [farmerId]);
      return rows;
    } catch { throw Object.assign(new Error('Grievance tracking database is unavailable.'), { status: 503 }); }
  }
  return db.farmerGrievanceTracking.filter(item => item.farmerId === farmerId).sort((a,b) => b.filedAt.localeCompare(a.filedAt)).map(({ farmerId: _farmerId, ...safe }) => safe);
}
async function saveGrievanceTracking(item) {
  if (profilePool) {
    try {
      const { rows } = await profilePool.query('INSERT INTO farmer_grievance_tracking (id, case_id, farmer_id, state, category, authority_level, portal, portal_url, tracking_id, status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id, case_id AS "caseId", state, category, authority_level AS "authorityLevel", portal, portal_url AS "portalUrl", tracking_id AS "trackingId", status, filed_at AS "filedAt", updated_at AS "updatedAt"', [item.id,item.caseId,item.farmerId,item.state,item.category,item.authorityLevel,item.portal,item.portalUrl,item.trackingId,item.status]);
      return rows[0];
    } catch { throw Object.assign(new Error('Grievance tracking database is unavailable.'), { status: 503 }); }
  }
  const stored = { ...item, filedAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  db.farmerGrievanceTracking.push(stored); await persist();
  const { farmerId: _farmerId, ...safe } = stored;
  return safe;
}
async function updateGrievanceTracking(id, farmerId, status) {
  if (profilePool) {
    try {
      const { rows } = await profilePool.query('UPDATE farmer_grievance_tracking SET status=$3, updated_at=NOW() WHERE id=$1 AND farmer_id=$2 RETURNING id', [id, farmerId, status]);
      return rows.length > 0;
    } catch { throw Object.assign(new Error('Grievance tracking database is unavailable.'), { status: 503 }); }
  }
  const item = db.farmerGrievanceTracking.find(entry => entry.id === id && entry.farmerId === farmerId);
  if (!item) return false;
  item.status = status; item.updatedAt = new Date().toISOString(); await persist(); return true;
}

async function saveChatMemory(memory, body, reply) {
  if (!memory.userId) return false;
  try {
    return await storeChatSummary({ userId: memory.userId, message: body.message, reply, language: body.language, module: 'crop-advisory' });
  } catch (error) {
    console.warn('Mem0 summary save failed:', error.message);
    return false;
  }
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
  const samathuvapuramUrl = 'https://tnrd.tn.gov.in/project/go_files/3_722_2023_91.pdf';
  const krushakUrl = 'https://krushak.odisha.gov.in/';
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

  if (pmStatus === 'possible_match' && ['after', 'inheritance'].includes(body.landAcquisition)) {
    pmStatus = 'manual_review';
    pmReason = schemeText(lang, 'You reported a post-cutoff land transfer or succession. The portal flags such cases for verification; succession can be treated differently, so a manual check is needed.', 'காலக்கெடுவுக்குப் பிந்தைய நில மாற்றம் அல்லது வாரிசுரிமை எனத் தெரிவித்துள்ளீர்கள். வாரிசுரிமைக்கு வேறு விதி இருக்கலாம்; எனவே அலுவலகச் சரிபார்ப்பு தேவை.', 'ಕಟ್‌ಆಫ್ ನಂತರದ ಭೂ ವರ್ಗಾವಣೆ ಅಥವಾ ವಾರಸುದಾರಿಕೆ ಎಂದು ತಿಳಿಸಿದ್ದಾರೆ. ವಾರಸುದಾರಿಕೆಗೆ ಬೇರೆ ನಿಯಮ ಇರಬಹುದು; ಆದ್ದರಿಂದ ಕೈಯಾರೆ ಪರಿಶೀಲನೆ ಅಗತ್ಯ.');
  } else if (pmStatus === 'possible_match' && body.familyBenefit === 'yes') {
    pmStatus = 'manual_review';
    pmReason = schemeText(lang, 'You reported another beneficiary in the same farmer family. Duplicate family records may be withheld pending verification.', 'அதே விவசாயக் குடும்பத்தில் மற்றொரு பயனாளர் இருப்பதாகத் தெரிவித்துள்ளீர்கள். நகல் குடும்பப் பதிவுகள் சரிபார்ப்பு வரை நிறுத்தப்படலாம்.', 'ಅದೇ ರೈತ ಕುಟುಂಬದಲ್ಲಿ ಮತ್ತೊಬ್ಬ ಫಲಾನುಭವಿ ಇದ್ದಾರೆ ಎಂದು ತಿಳಿಸಿದ್ದಾರೆ. ಕುಟುಂಬದ ನಕಲಿ ದಾಖಲೆಗಳು ಪರಿಶೀಲನೆಗಾಗಿ ತಡೆಹಿಡಿಯಬಹುದು.');
  } else if (pmStatus === 'possible_match' && (body.landAcquisition === 'unsure' || body.familyBenefit === 'unsure')) {
    pmStatus = 'manual_review';
    pmReason = schemeText(lang, 'One or more land-transfer or family-benefit facts are unknown, so a thorough PM-KISAN screen needs a manual check.', 'நில மாற்றம் அல்லது குடும்பப் பயனாளர் தொடர்பான விவரங்களில் ஒன்று தெரியவில்லை; எனவே PM-KISAN-க்கு கூடுதல் சரிபார்ப்பு தேவை.', 'ಭೂ ವರ್ಗಾವಣೆ ಅಥವಾ ಕುಟುಂಬದ ಫಲಾನುಭವಿಯ ವಿವರಗಳಲ್ಲಿ ಒಂದು ತಿಳಿದಿಲ್ಲ; ಆದ್ದರಿಂದ PM-KISAN ಗೆ ಕೈಯಾರೆ ಪರಿಶೀಲನೆ ಬೇಕು.');
  }

  let samathuvapuram = body.state === 'Tamil Nadu'
    ? possible('Periyar Ninaivu Samathuvapuram (housing)', schemeText(lang,
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

  if (body.state === 'Tamil Nadu') {
    if (body.samInterest === 'no') {
      samathuvapuram.status = 'not_eligible'; samathuvapuram.eligible = false;
      samathuvapuram.reason = schemeText(lang, 'You said you are not seeking a Samathuvapuram house; this is a housing allotment, not a general farmer grant.', 'சமத்துவபுரம் வீடு வேண்டாம் எனத் தெரிவித்துள்ளீர்கள்; இது வீட்டு ஒதுக்கீடு, பொதுவான விவசாயி மானியம் அல்ல.', 'ಸಮತ್ತುವಪುರಂ ಮನೆ ಬೇಡ ಎಂದು ತಿಳಿಸಿದ್ದಾರೆ; ಇದು ಮನೆ ಹಂಚಿಕೆ ಯೋಜನೆ, ಸಾಮಾನ್ಯ ರೈತ ಅನುದಾನವಲ್ಲ.');
    } else if (body.houseRoof === 'rcc' || body.priorHousing === 'yes') {
      samathuvapuram.status = 'not_eligible'; samathuvapuram.eligible = false;
      samathuvapuram.reason = schemeText(lang, 'Your answer conflicts with a published exclusion (RCC-roof housing or prior government housing benefit). Confirm the current Government Order with the local Block Development Office.', 'உங்கள் பதில் வெளியிடப்பட்ட விலக்கு நிபந்தனையுடன் முரண்படுகிறது (கான்கிரீட் கூரை வீடு அல்லது முந்தைய அரசு வீட்டு நன்மை). தற்போதைய அரசாணையை வட்டார வளர்ச்சி அலுவலகத்தில் உறுதிப்படுத்தவும்.', 'ನಿಮ್ಮ ಉತ್ತರ ಪ್ರಕಟಿತ ಹೊರತಾಗುವಿಕೆ ಷರತ್ತಿಗೆ ವಿರುದ್ಧವಾಗಿದೆ (RCC ಛಾವಣಿ ಮನೆ ಅಥವಾ ಹಿಂದಿನ ಸರ್ಕಾರಿ ವಸತಿ ಸೌಲಭ್ಯ). ಪ್ರಸ್ತುತ ಸರ್ಕಾರಿ ಆದೇಶವನ್ನು ಸ್ಥಳೀಯ ಕಚೇರಿಯಲ್ಲಿ ದೃಢಪಡಿಸಿ.');
    } else if (body.samInterest !== 'yes' || body.houseRoof === 'unsure' || body.priorHousing === 'unsure' || body.permanentStay !== 'yes') {
      samathuvapuram.status = 'manual_review'; samathuvapuram.eligible = false;
      samathuvapuram.reason = schemeText(lang, 'Some housing eligibility answers are missing or uncertain. The published rules also require a current local allotment and selection by the district committee.', 'வீட்டு தகுதி விவரங்களில் சில இல்லை அல்லது உறுதியில்லை. தற்போதைய உள்ளூர் ஒதுக்கீடும் மாவட்டக் குழு தேர்வும் அவசியம்.', 'ಮನೆ ಅರ್ಹತೆಯ ಕೆಲವು ಉತ್ತರಗಳು ಇಲ್ಲ ಅಥವಾ ಖಚಿತವಿಲ್ಲ. ಪ್ರಸ್ತುತ ಸ್ಥಳೀಯ ಹಂಚಿಕೆ ಮತ್ತು ಜಿಲ್ಲಾ ಸಮಿತಿಯ ಆಯ್ಕೆ ಕೂಡ ಅಗತ್ಯ.');
    } else {
      samathuvapuram.status = 'possible_match'; samathuvapuram.eligible = true;
      samathuvapuram.reason = schemeText(lang, 'Your answers pass the published first screen. This is not an allotment: local availability, residence area, priority, committee selection and Collector approval still apply.', 'உங்கள் பதில்கள் வெளியிடப்பட்ட முதற்கட்ட நிபந்தனைகளைப் பூர்த்தி செய்கின்றன. இது வீடு ஒதுக்கீடு அல்ல; உள்ளூர் காலியிடம், பகுதி, முன்னுரிமை, குழுத் தேர்வு, ஆட்சியர் ஒப்புதல் தேவை.', 'ನಿಮ್ಮ ಉತ್ತರಗಳು ಪ್ರಕಟಿತ ಪ್ರಾಥಮಿಕ ಪರಿಶೀಲನೆಯನ್ನು ಪೂರೈಸುತ್ತವೆ. ಇದು ಮನೆ ಹಂಚಿಕೆ ಅಲ್ಲ; ಸ್ಥಳೀಯ ಲಭ್ಯತೆ, ವಾಸ ಪ್ರದೇಶ, ಆದ್ಯತೆ, ಸಮಿತಿ ಆಯ್ಕೆ ಮತ್ತು ಜಿಲ್ಲಾಧಿಕಾರಿ ಅನುಮೋದನೆ ಬೇಕು.');
    }
  }

  const krushak = possible('Krushak Yojana', schemeText(lang,
    'The name “Krushak Yojana” does not identify one verified active scheme for Tamil Nadu or Karnataka. Odisha has multiple distinct Krushak programmes; they should not be treated as interchangeable.',
    '“Krushak Yojana” என்ற பெயர் தமிழ்நாடு அல்லது கர்நாடகத்தில் ஒரு குறிப்பிட்ட தற்போதைய திட்டத்தை அடையாளம் காட்டவில்லை. ஒடிசாவில் பல வேறு Krushak திட்டங்கள் உள்ளன; அவற்றை ஒன்றாகக் கருத முடியாது.',
    '“Krushak Yojana” ಎಂಬ ಹೆಸರು ತಮಿಳುನಾಡು ಅಥವಾ ಕರ್ನಾಟಕದ ಒಂದು ನಿರ್ದಿಷ್ಟ ಸಕ್ರಿಯ ಯೋಜನೆಯನ್ನು ಗುರುತಿಸುವುದಿಲ್ಲ. ಒಡಿಶಾದಲ್ಲಿ ಹಲವು ವಿಭಿನ್ನ Krushak ಯೋಜನೆಗಳಿವೆ; ಅವುಗಳನ್ನು ಒಂದೇ ಎಂದು ಪರಿಗಣಿಸಬಾರದು.'), schemeText(lang,
    'This is not a verified Tamil Nadu or Karnataka scheme. If you meant Odisha CM-KISAN or another programme in Krushak Odisha, select the exact programme and verify Odisha residency and current rules on the portal.',
    'இது தமிழ்நாடு அல்லது கர்நாடகத்தின் உறுதிப்படுத்தப்பட்ட திட்டம் அல்ல. ஒடிசா CM-KISAN அல்லது Krushak Odisha திட்டத்தை குறித்தால் சரியான திட்டத்தைத் தேர்ந்து ஒடிசா குடியிருப்பு மற்றும் தற்போதைய விதிகளைப் பார்க்கவும்.',
    'ಇದು ತಮಿಳುನಾಡು ಅಥವಾ ಕರ್ನಾಟಕದ ದೃಢೀಕೃತ ಯೋಜನೆಯಲ್ಲ. ಒಡಿಶಾ CM-KISAN ಅಥವಾ Krushak Odisha ಯೋಜನೆ ಎಂದಿದ್ದರೆ ನಿಖರ ಯೋಜನೆ, ಒಡಿಶಾ ನಿವಾಸ ಮತ್ತು ಪ್ರಸ್ತುತ ನಿಯಮಗಳನ್ನು ಪರಿಶೀಲಿಸಿ.'), krushakUrl, body.state === 'Tamil Nadu' || body.state === 'Karnataka' ? 'not_eligible' : 'manual_review');

  let uzhavar = null;
  if (body.state === 'Tamil Nadu') {
    let status = 'manual_review';
    let reason = schemeText(lang, 'Uzhavar Pathukappu covers specified small/marginal farmers (including tenants) and agricultural labourers aged 18–65; the full category and land limits must be confirmed.', 'உழவர் பாதுகாப்புத் திட்டம் 18–65 வயதுடைய குறிப்பிட்ட சிறு/குறு விவசாயிகள் (குத்தகை உட்பட) மற்றும் விவசாயத் தொழிலாளர்களுக்கானது; முழு வகை, நில வரம்பை உறுதிப்படுத்த வேண்டும்.', 'ಉಳುವರ್ ಪಾತುಕಾಪ್ಪು 18–65 ವರ್ಷದ ನಿರ್ದಿಷ್ಟ ಸಣ್ಣ/ಅತಿಸಣ್ಣ ರೈತರು (ಗುತ್ತಿಗೆದಾರರು ಸೇರಿ) ಮತ್ತು ಕೃಷಿ ಕಾರ್ಮಿಕರಿಗೆ; ವರ್ಗ ಹಾಗೂ ಭೂ ಮಿತಿಯನ್ನು ದೃಢಪಡಿಸಬೇಕು.');
    if (body.ageBand === 'under18' || body.ageBand === 'over65' || body.farmerType === 'other' || (body.farmerType === 'cultivator' && body.safetyLand === 'no')) {
      status = 'not_eligible';
      reason = schemeText(lang, 'Your answers do not meet the published age, worker-category or land-limit screen for this scheme.', 'இந்தத் திட்டத்தின் வெளியிடப்பட்ட வயது, தொழில் வகை அல்லது நில அளவு முதற்கட்ட நிபந்தனைகளை உங்கள் பதில்கள் பூர்த்தி செய்யவில்லை.', 'ನಿಮ್ಮ ಉತ್ತರಗಳು ಪ್ರಕಟಿತ ವಯಸ್ಸು, ಕೆಲಸದ ವರ್ಗ ಅಥವಾ ಭೂ ಮಿತಿ ಪ್ರಾಥಮಿಕ ಷರತ್ತನ್ನು ಪೂರೈಸುವುದಿಲ್ಲ.');
    } else if (['18to65'].includes(body.ageBand) && ['cultivator', 'tenant', 'agri_labour'].includes(body.farmerType) && (body.farmerType === 'agri_labour' || body.safetyLand === 'yes' || body.safetyLand === 'not_applicable')) {
      status = 'possible_match';
      reason = schemeText(lang, 'Your answers appear to meet the first screen for age and worker category. Confirm membership, land details and current benefits with the Revenue Department.', 'வயது மற்றும் தொழில் வகை முதற்கட்ட நிபந்தனைகளை பூர்த்தி செய்யலாம். வருவாய்த் துறையில் உறுப்பினர் நிலை, நில விவரங்கள், தற்போதைய நன்மைகளை உறுதிப்படுத்தவும்.', 'ವಯಸ್ಸು ಮತ್ತು ಕೆಲಸದ ವರ್ಗದ ಪ್ರಾಥಮಿಕ ಷರತ್ತುಗಳನ್ನು ಪೂರೈಸುವ ಸಾಧ್ಯತೆ ಇದೆ. ಸದಸ್ಯತ್ವ, ಭೂ ವಿವರ ಮತ್ತು ಪ್ರಸ್ತುತ ಸೌಲಭ್ಯಗಳನ್ನು ಕಂದಾಯ ಇಲಾಖೆಯಲ್ಲಿ ದೃಢಪಡಿಸಿ.');
    }
    uzhavar = possible('Chief Minister’s Uzhavar Pathukappu Thittam', reason, schemeText(lang, 'Ask the Village Administrative Officer / Taluk Revenue Office about membership or benefits; bring land/tenancy or agricultural-labour proof and age proof.', 'உறுப்பினர் சேர்க்கை அல்லது நன்மைக்கு VAO / வட்டாட்சியர் அலுவலகத்தை அணுகி நிலம்/குத்தகை அல்லது விவசாயத் தொழில் மற்றும் வயது ஆதாரங்களை எடுத்துச் செல்லவும்.', 'ಸದಸ್ಯತ್ವ ಅಥವಾ ಸೌಲಭ್ಯಕ್ಕಾಗಿ ಗ್ರಾಮ ಆಡಳಿತಾಧಿಕಾರಿ / ತಾಲ್ಲೂಕು ಕಂದಾಯ ಕಚೇರಿಯನ್ನು ಸಂಪರ್ಕಿಸಿ; ಭೂಮಿ/ಗುತ್ತಿಗೆ ಅಥವಾ ಕೃಷಿ ಕೆಲಸ ಮತ್ತು ವಯಸ್ಸಿನ ದಾಖಲೆ ತೆಗೆದುಕೊಂಡು ಹೋಗಿ.'), 'https://landreforms.tn.gov.in/UPT.html', status);
  }

  const statePortal = body.state === 'Tamil Nadu'
    ? possible('Tamil Nadu Agriculture scheme directory (AGRISNET)', schemeText(lang, 'State agriculture input subsidies vary by crop, district, season, category and open application window; this portal publishes scheme eligibility and required documents.', 'மாநில வேளாண் இடுபொருள் மானியங்கள் பயிர், மாவட்டம், பருவம், வகை, விண்ணப்ப காலத்தைப் பொறுத்தவை; AGRISNET தகுதி மற்றும் ஆவணங்களைப் பட்டியலிடுகிறது.', 'ರಾಜ್ಯ ಕೃಷಿ ಒಳಿತಿನ ಸಬ್ಸಿಡಿಗಳು ಬೆಳೆ, ಜಿಲ್ಲೆ, ಋತು, ವರ್ಗ ಮತ್ತು ಅರ್ಜಿ ಅವಧಿಯಂತೆ ಬದಲಾಗುತ್ತವೆ; AGRISNET ಅರ್ಹತೆ ಮತ್ತು ದಾಖಲೆಗಳನ್ನು ತೋರಿಸುತ್ತದೆ.'), schemeText(lang, 'Choose your crop/input on the portal or ask the Block Agriculture Officer; exact eligibility cannot be screened without the current component and district.', 'தற்போதைய கூறு மற்றும் மாவட்ட விவரமின்றி துல்லியத் தகுதியைச் சரிபார்க்க முடியாது; பயிர்/இடுபொருளைத் தேர்வு செய்யவும் அல்லது வட்டார வேளாண் அலுவலரை அணுகவும்.', 'ಪ್ರಸ್ತುತ ಘಟಕ ಮತ್ತು ಜಿಲ್ಲೆ ಇಲ್ಲದೆ ನಿಖರ ಅರ್ಹತೆ ಪರಿಶೀಲಿಸಲಾಗದು; ಬೆಳೆ/ಒಳಿತಿನ ಆಯ್ಕೆ ಮಾಡಿ ಅಥವಾ ಬ್ಲಾಕ್ ಕೃಷಿ ಅಧಿಕಾರಿಯನ್ನು ಸಂಪರ್ಕಿಸಿ.'), 'https://www.tnagrisnet.tn.gov.in/home/schemes/tm', 'manual_review')
    : possible('Karnataka Department of Agriculture (Raitamitra)', schemeText(lang, 'Use the Karnataka Agriculture portal to identify current state and central benefit components; rules and application windows differ by programme.', 'தற்போதைய கர்நாடக மாநில/மத்திய திட்டங்களை வேளாண் துறை தளத்தில் தேர்வு செய்யவும்; ஒவ்வொரு திட்டத்திற்கும் விதி, விண்ணப்ப காலம் மாறும்.', 'ಪ್ರಸ್ತುತ ಕರ್ನಾಟಕ ರಾಜ್ಯ/ಕೇಂದ್ರ ಯೋಜನೆಗಳನ್ನು ಕೃಷಿ ಇಲಾಖೆಯ ಪೋರ್ಟಲ್‌ನಲ್ಲಿ ಆಯ್ಕೆಮಾಡಿ; ನಿಯಮ ಮತ್ತು ಅರ್ಜಿ ಅವಧಿ ಪ್ರತಿ ಯೋಜನೆಗೆ ಬದಲಾಗುತ್ತದೆ.'), schemeText(lang, 'Select the exact benefit and district on Raitamitra or contact the Raitha Samparka Kendra; do not treat portal registration as approval.', 'Raitamitra-வில் சரியான நன்மை, மாவட்டத்தைத் தேர்வு செய்யவும் அல்லது ರೈತ ಸಂಪರ್ಕ ಕೇಂದ್ರத்தை அணுகவும்; பதிவு ஒப்புதல் அல்ல.', 'Raitamitra ನಲ್ಲಿ ನಿಖರ ಸೌಲಭ್ಯ ಮತ್ತು ಜಿಲ್ಲೆಯನ್ನು ಆಯ್ಕೆಮಾಡಿ ಅಥವಾ ರೈತ ಸಂಪರ್ಕ ಕೇಂದ್ರವನ್ನು ಸಂಪರ್ಕಿಸಿ; ನೋಂದಣಿ ಅನುಮೋದನೆ ಅಲ್ಲ.'), 'https://raitamitra.karnataka.gov.in/', 'manual_review');

  const pmChecks = [
    ['Land records', body.landholding === 'own' ? 'pass' : body.landholding === 'unsure' ? 'review' : 'fail'],
    ['Exclusion categories', body.exclusions === 'no' ? 'pass' : body.exclusions === 'yes' ? 'fail' : 'review'],
    ['Land cutoff / succession', body.landAcquisition === 'before' ? 'pass' : 'review'],
    ['One beneficiary per family', body.familyBenefit === 'no' ? 'pass' : 'review'],
    ['eKYC and bank/DBT readiness', body.aadhaarLinkedBankAccount === 'yes' ? 'pass' : body.aadhaarLinkedBankAccount === 'no' ? 'pending' : 'review']
  ];
  const checkText = { pass: ['Meets screen', 'முதற்கட்டத்தில் பொருந்துகிறது', 'ಪ್ರಾಥಮಿಕವಾಗಿ ಹೊಂದುತ್ತದೆ'], fail: ['Does not meet', 'பொருந்தவில்லை', 'ಹೊಂದುವುದಿಲ್ಲ'], review: ['Needs verification', 'சரிபார்ப்பு தேவை', 'ಪರಿಶೀಲನೆ ಅಗತ್ಯ'], pending: ['Follow-up needed', 'தொடர்பு நடவடிக்கை தேவை', 'ಮುಂದಿನ ಕ್ರಮ ಅಗತ್ಯ'] };
  const makeChecks = rows => rows.map(([label, status]) => ({ label, status, result: schemeText(lang, ...checkText[status]) }));
  const pmKisan = possible('PM-KISAN', pmReason, pmAction, pmkisanUrl, pmStatus);
  pmKisan.checks = makeChecks(pmChecks);
  samathuvapuram.checks = makeChecks(body.state === 'Tamil Nadu' ? [
    ['Tamil Nadu programme / interest', body.samInterest === 'yes' ? 'pass' : body.samInterest === 'no' ? 'fail' : 'review'],
    ['RCC roof / prior government housing', body.houseRoof === 'rcc' || body.priorHousing === 'yes' ? 'fail' : body.houseRoof === 'unsure' || body.priorHousing === 'unsure' ? 'review' : 'pass'],
    ['Housing priority information (2023 Government Order)', body.housingPriority === 'yes' || body.housingLand === 'no' ? 'pass' : body.housingPriority === 'no' && body.housingLand === 'yes' ? 'pending' : 'review'],
    ['Location and permanent residence', body.district && body.permanentStay === 'yes' ? 'pass' : body.permanentStay === 'no' ? 'fail' : 'review'],
    ['Current local opening, priority and Collector approval', 'review']
  ] : [['Tamil Nadu programme jurisdiction', 'fail']]);
  if (uzhavar) uzhavar.checks = makeChecks([
    ['Age 18–65', body.ageBand === '18to65' ? 'pass' : ['under18', 'over65'].includes(body.ageBand) ? 'fail' : 'review'],
    ['Farmer / tenant / agricultural labour category', ['cultivator', 'tenant', 'agri_labour'].includes(body.farmerType) ? 'pass' : body.farmerType === 'other' ? 'fail' : 'review'],
    ['Applicable land limit / direct cultivation', body.farmerType === 'agri_labour' || ['yes', 'not_applicable'].includes(body.safetyLand) ? 'pass' : body.safetyLand === 'no' ? 'fail' : 'review'],
    ['Membership and current benefit confirmation', 'review']
  ]);
  return { mode: 'rules-screening', matches: [pmKisan, samathuvapuram, ...(uzhavar ? [uzhavar] : []), krushak, statePortal], checkedAt: rulesCheckedAt, disclaimer: schemeText(lang, 'Pre-screen only: no live land-record lookup, portal submission or government decision. Confirm current rules and application windows with the linked department.', 'முதற்கட்டச் சரிபார்ப்பு மட்டுமே: நிலப் பதிவு நேரடி தேடல், விண்ணப்பச் சமர்ப்பிப்பு அல்லது அரசு முடிவு இங்கு இல்லை. இணைக்கப்பட்ட துறையில் தற்போதைய விதி/காலத்தை உறுதிப்படுத்தவும்.', 'ಪ್ರಾಥಮಿಕ ಪರಿಶೀಲನೆ ಮಾತ್ರ: ನೇರ ಭೂ ದಾಖಲೆ ಹುಡುಕಾಟ, ಅರ್ಜಿ ಸಲ್ಲಿಕೆ ಅಥವಾ ಸರ್ಕಾರಿ ತೀರ್ಮಾನ ಇಲ್ಲಿ ಇಲ್ಲ. ಲಿಂಕ್ ಮಾಡಿದ ಇಲಾಖೆಯಲ್ಲಿ ಪ್ರಸ್ತುತ ನಿಯಮ/ಅವಧಿ ದೃಢಪಡಿಸಿ.') };
}

async function handle(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = decodeURIComponent(url.pathname);
  if (req.method === 'GET' && pathname === '/api/health') return send(res, 200, { service: 'nelam-middleware', mode: 'demo', persistentStore: profileStorage(), integrations: { sarvam: Boolean(process.env.SARVAM_ADAPTER_URL || process.env.SARVAM_API_SUBSCRIPTION_KEY), knowledgeEngine: Boolean(process.env.KNOWLEDGE_ADAPTER_URL), weather: Boolean(process.env.WEATHER_ADAPTER_URL), dss: Boolean(process.env.DSS_ADAPTER_URL), schemeRegistry: Boolean(process.env.SCHEME_ADAPTER_URL), grievanceSystem: Boolean(process.env.GRIEVANCE_ADAPTER_URL), whatsapp: Boolean(process.env.WHATSAPP_ADAPTER_URL), ivr: ivrStatus.active } });

  if (req.method === 'GET' && pathname === '/api/auth/status') return send(res, 200, { enabled: Boolean(authSecret), durable: Boolean(profilePool), storage: profileStorage() });
  if (req.method === 'GET' && pathname === '/api/auth/session') {
    const session = sessionUser(req); const user = session && await readAuthUser(session.userId);
    return send(res, 200, { authenticated: Boolean(user?.name && user.passwordHash), user: user ? { accountKey: user.id, name: user.name, contactChannel: user.contactChannel } : null });
  }
  if ((req.method === 'POST' && pathname === '/api/auth/register') || (req.method === 'POST' && pathname === '/api/auth/login')) {
    if (!authSecret) return send(res, 503, { error: 'Sign-in is unavailable. A stable session secret must be configured.' });
    const isRegister = pathname === '/api/auth/register';
    const body = await jsonBody(req); const input = typeof body.contact === 'string' ? body.contact.trim() : '';
    let channel, contact;
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input)) { channel = 'email'; contact = input.toLowerCase().slice(0, 254); }
    else { contact = normalizePhoneNumber(input); channel = 'phone'; }
    if (!contact) return send(res, 400, { error: 'Enter a valid phone number with country code or email address.' });
    const password = typeof body.password === 'string' ? body.password : '';
    if (password.length < 10 || password.length > 128) return send(res, 400, { error: 'Use a password between 10 and 128 characters.' });
    const userId = authUserId(channel, contact);
    let user;
    if (isRegister) {
      const name = typeof body.name === 'string' ? body.name.trim().replace(/\s+/g, ' ').slice(0, 80) : '';
      if (name.length < 2) return send(res, 400, { error: 'Enter your name to create an account.' });
      user = await createPasswordUser(userId, channel, userId, name, password);
      if (!user) return send(res, 409, { error: 'An account already exists for this contact. Sign in instead.' });
    } else {
      user = await readAuthUser(userId);
      if (!await verifyPassword(user, password)) return send(res, 401, { error: 'The contact or password is incorrect.' });
    }
    return send(res, 200, { authenticated: true, user: { accountKey: user.id, name: user.name, contactChannel: user.contactChannel } }, { 'Set-Cookie': sessionCookie(createSession(user.id)) });
  }
  if (req.method === 'POST' && pathname === '/api/auth/logout') return send(res, 200, { signedOut: true }, { 'Set-Cookie': `${authCookieName}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${process.env.NODE_ENV === 'production' || process.env.RENDER === 'true' ? '; Secure' : ''}` });

  if (req.method === 'POST' && pathname === '/api/ivr/turn' && (!process.env.IVR_STREAM_TOKEN || req.headers['x-ivr-internal-token'] !== process.env.IVR_STREAM_TOKEN)) return send(res, 401, { error: 'IVR session is not authorized.' });
  const isPublicApi = pathname === '/api/health' || pathname.startsWith('/api/auth/') || pathname === '/api/ivr/turn' || pathname.startsWith('/api/channels/');
  if (pathname.startsWith('/api/admin/')) return send(res, 403, { error: 'Admin access is not available through the farmer sign-in.' });
  if (pathname.startsWith('/api/') && !isPublicApi && pathname !== '/api/memory/status' && pathname !== '/api/profile/status') {
    const session = sessionUser(req);
    if (!session) return send(res, 401, { error: 'Please sign in to continue.' });
    const account = await readAuthUser(session.userId);
    if (!account?.name) return send(res, 403, { error: 'Finish setting up your account before continuing.' });
    req.farmerSession = session;
  }

  if (req.method === 'GET' && pathname === '/api/memory/status') return send(res, 200, { configured: isMem0Configured(), provider: 'mem0', scope: 'account', requiresPhone: false });
  if (req.method === 'GET' && pathname === '/api/profile/status') return send(res, 200, { configured: Boolean(profilePool), storage: profileStorage(), durable: Boolean(profilePool), identityAuthentication: 'password' });
  if (req.method === 'GET' && pathname === '/api/grievance-tracking') {
    return send(res, 200, { grievances: await listGrievanceTracking(req.farmerSession.userId), storage: profileStorage(), liveGovernmentStatus: false });
  }
  if (req.method === 'POST' && pathname === '/api/grievance-tracking') {
    const body = await jsonBody(req);
    const farmerId = req.farmerSession.userId;
    if (body.consent !== true) return send(res, 400, { error: 'Consent is required to save a portal tracking ID.' });
    const portalHost = trackingPortals[body.portal];
    let parsedUrl;
    try { parsedUrl = new URL(body.portalUrl); } catch {}
    if (!portalHost || parsedUrl?.protocol !== 'https:' || parsedUrl.hostname !== portalHost) return send(res, 400, { error: 'Choose a listed official grievance portal.' });
    if (!['Tamil Nadu','Karnataka'].includes(body.state) || !['local','higher'].includes(body.authorityLevel) || !['submitted','in_progress','unresolved','resolved'].includes(body.status) || !body.category?.trim() || !body.trackingId?.trim()) return send(res, 400, { error: 'Complete the grievance tracking details.' });
    const item = { id: randomUUID(), caseId: typeof body.caseId === 'string' && /^[0-9a-f-]{36}$/i.test(body.caseId) ? body.caseId : randomUUID(), farmerId, state: body.state, category: body.category.trim().slice(0,100), authorityLevel: body.authorityLevel, portal: body.portal, portalUrl: parsedUrl.href, trackingId: body.trackingId.trim().slice(0,120), status: body.status };
    return send(res, 201, { grievance: await saveGrievanceTracking(item), storage: profileStorage() });
  }
  if (req.method === 'PUT' && pathname.startsWith('/api/grievance-tracking/')) {
    const id = pathname.slice('/api/grievance-tracking/'.length);
    const body = await jsonBody(req);
    const farmerId = req.farmerSession.userId;
    if (!['submitted','in_progress','unresolved','resolved'].includes(body.status)) return send(res, 400, { error: 'Choose a valid status.' });
    if (!await updateGrievanceTracking(id, farmerId, body.status)) return send(res, 404, { error: 'Saved grievance not found for this phone number.' });
    return send(res, 200, { updated: true });
  }
  if (req.method === 'GET' && pathname === '/api/profile') {
    const userId = req.farmerSession.userId;
    const profile = await getFarmerProfile(userId);
    return send(res, 200, { profile: profile?.preferences || {}, updatedAt: profile?.updatedAt || null, storage: profileStorage() });
  }
  if (req.method === 'PUT' && pathname === '/api/profile') {
    const body = await jsonBody(req);
    const userId = req.farmerSession.userId;
    const preferences = cleanPreferences(body.preferences);
    const profile = await saveFarmerProfile(userId, preferences);
    return send(res, 200, { profile: profile.preferences, updatedAt: profile.updatedAt, storage: profileStorage() });
  }

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
    const memory = await loadChatMemory(body, req.farmerSession.userId);
    const grievanceRecords = await listGrievanceTracking(req.farmerSession.userId);
    const grievanceContext = grievanceRecords.map(({ caseId, state, category, authorityLevel, portal, portalUrl, trackingId, status, updatedAt }) => ({ caseId, state, category, authorityLevel, portal, portalUrl, trackingId, status, updatedAt }));
    const base = { ...body, channel: 'web-demo', memoryContext: memory.summaries, grievanceContext };
    const [knowledge, weather, dss] = await Promise.all([
      callAdapter(process.env.KNOWLEDGE_ADAPTER_URL, 'crop-advisory', base),
      /weather|rain|மழை|மழை|ಮಳೆ/i.test(body.message || '') ? callAdapter(process.env.WEATHER_ADAPTER_URL, 'forecast', base) : null,
      /yield|optim|விளைச்சல்|இಳುವರಿ/i.test(body.message || '') ? callAdapter(process.env.DSS_ADAPTER_URL, 'crop-recommendation', base) : null
    ]);
    const speechAnswer = await callAdapter(process.env.SARVAM_ADAPTER_URL, 'conversation', { ...base, knowledgeContext: knowledge?.context || knowledge?.results, weatherContext: weather, dssContext: dss });
    const asksGrievance = /griev|complaint|status|track|follow.?up|புகார்|நிலை|கண்காணி|ದೂರು|ಸ್ಥಿತಿ|ಪರಿಶೀಲನೆ/i.test(body.message || '');
    const savedGrievanceReply = asksGrievance && grievanceContext.length ? localized(body.language,
      `Your saved grievance references are: ${grievanceContext.map(item => `${item.portal}: ${item.trackingId} (${item.status.replace('_',' ')})`).join('; ')}. Open the original portal to check the live status.`,
      `சேமித்த புகார் குறிப்பு எண்கள்: ${grievanceContext.map(item => `${item.portal}: ${item.trackingId} (${item.status.replace('_',' ')})`).join('; ')}. தற்போதைய நிலையை அசல் அரசு தளத்தில் சரிபார்க்கவும்.`,
      `ನಿಮ್ಮ ಉಳಿಸಿದ ದೂರು ಉಲ್ಲೇಖಗಳು: ${grievanceContext.map(item => `${item.portal}: ${item.trackingId} (${item.status.replace('_',' ')})`).join('; ')}. ನೈಜ ಸ್ಥಿತಿಯನ್ನು ಮೂಲ ಸರ್ಕಾರಿ ಪೋರ್ಟಲ್‌ನಲ್ಲಿ ಪರಿಶೀಲಿಸಿ.`) : null;
    const reply = speechAnswer?.reply || dss?.reply || weather?.reply || knowledge?.reply || savedGrievanceReply || localized(body.language,
      'Demo response: add Sarvam Conversational AI, Knowledge Engine, live weather and DSS adapters for grounded farm guidance.',
      'மாதிரி பதில்: துல்லியமான பண்ணை ஆலோசனைக்கு சர்வம், நேரடி வானிலை மற்றும் DSS இணைப்புகளை அமைக்கவும்.',
      'ಮಾದರಿ ಉತ್ತರ: ನಿಖರ ಕೃಷಿ ಸಲಹೆಗಾಗಿ ಸರ್ವಂ, ನೈಜ ಹವಾಮಾನ ಮತ್ತು DSS ಸಂಪರ್ಕಗಳನ್ನು ಹೊಂದಿಸಿ.');
    const memoryStored = await saveChatMemory(memory, body, reply);
    const record = { id: randomUUID(), message: body.message || '', language: body.language || 'ta', createdAt: new Date().toISOString(), source: speechAnswer ? 'sarvam-adapter' : knowledge ? 'knowledge-engine' : 'demo' };
    db.conversations.unshift(record); db.conversations.length = Math.min(db.conversations.length, 500); await persist();
    return send(res, 200, { reply, language: body.language || 'ta', sources: speechAnswer?.sources || knowledge?.sources || dss?.sources || [], weather: weather || undefined, dssRecommendation: dss || undefined, memory: { available: isMem0Configured(), requested: body.rememberChat === true, saved: memoryStored, recalled: memory.summaries.length, phoneRequired: body.rememberChat === true && !memory.userId }, grievanceTracking: grievanceContext, mode: speechAnswer || knowledge || weather || dss ? 'connected-adapter' : 'demo' });
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
    const record = { id, ownerId: req.farmerSession.userId, category: classification?.category || body.category || classifyGrievance(body.description), description: body.description.trim(), summary: classification?.summary || body.description.trim().slice(0, 240), village: body.village.trim(), language: body.language || 'ta', status: external?.status || 'Received', routing: external?.routing || 'Demo queue · configure department routing', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), demo: !external };
    db.grievances.unshift(record); await persist();
    return send(res, external ? 201 : 201, { id, status: record.status, demo: record.demo, message: record.demo ? 'Stored in the local demo case register; no government office has received this grievance.' : undefined });
  }

  const caseMatch = pathname.match(/^\/api\/grievances\/([^/]+)$/);
  if (req.method === 'GET' && caseMatch) {
    const record = db.grievances.find(item => item.id === caseMatch[1]);
    if (!record || record.ownerId !== req.farmerSession.userId) return send(res, 404, { error: 'Grievance ID not found.' });
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
