# Nelam Farm Assistant

A responsive prototype for a Tamil-first / Kannada-first farm assistant across WhatsApp and IVR. It demonstrates crop advisory, scheme eligibility, and grievance filing and tracking. The current UI runs without credentials and uses clearly labelled sample responses; it is not connected to Sarvam, a live weather feed, a government scheme registry, a DSS, WhatsApp, IVR, or a grievance department.

## Run the prototype

Install Node.js 20 or newer and run `npm start` in this directory. Open `http://localhost:4173`. Users can register or sign in with a phone number or email and a password; registration collects a name. Web user APIs require the signed-in session, apart from health, auth and configuration status. The internal IVR turn endpoint uses the configured stream token. Admin data endpoints are not available to farmer sessions. The local server persists demo grievance records, scheme checks and recent advisory context in `data/demo-store.json`; this file is git-ignored and is not a production datastore. The optional browser setting `window.NELAM_API_BASE` selects the middleware base URL; it defaults to `/api`.

Copy `.env.example` to `.env` as a reference and set the adapter URLs in the server process environment. The server loads `.env` locally when present. Provider API keys belong in server-side environment settings, never in browser code. Configure a stable `AUTH_SESSION_SECRET` (or the existing stable `USER_ID_SECRET`) for signed sessions and account IDs. Passwords are salted and derived with scrypt; the original password is not stored. Accounts are keyed by a keyed hash of the normalized contact. The contact itself is not verified, and password reset is not set up yet. Without other adapter URLs, crop advice and scheme checks remain demonstrations, and grievance IDs/statuses exist only in the local demo register.

## Farmer profiles and chat memory

The crop advisory panel saves preferred crop, fertilizer choices, soil type, irrigation method, location and language against the account ID. Profiles and grievance tracking are protected by an HttpOnly, signed session cookie; user-supplied phone numbers are not used to retrieve account data. Keep the session secret stable across restarts so existing sessions continue to work.

When PostgreSQL is configured with `DATABASE_URL`, profiles are stored in the `farmer_profiles` table (created automatically). `DATABASE_SSL=true` enables TLS with certificate verification disabled, intended for providers requiring that connection mode; prefer provider-recommended TLS configuration for production. Without a working database, the service uses `data/demo-store.json` and labels the profile as local demo storage. That file is ephemeral on Render's free web service and must not be treated as durable storage.

The farmer must opt in using the Mem0 checkbox before chat summaries are searched or saved. A pseudonymous account ID is used with Mem0; the contact address is not sent to Mem0. Set `MEM0_API_KEY` to enable it and keep the key server-side. Profile preference storage is separate from Mem0 and does not require Mem0 to be enabled. Render's free filesystem and free database offerings are not a durability guarantee; provision a database appropriate for the required retention period before relying on saved farmer preferences.

## Intended service flow

```text
WhatsApp Business webhook ─┐
IVR / telephony gateway ───┼─> Nelam middleware ──> Sarvam Conversational AI
Web assistant ────────────┘          │              (Tamil/Kannada STT, NLP, TTS)
                                     ├──────────────> Sarvam Knowledge Engine
                                     ├──────────────> Weather provider
                                     ├──────────────> Existing DSS adapter (yield/crop models)
                                     ├──────────────> Authoritative scheme data / eligibility service
                                     └──────────────> Grievance system / department workflow
```

The middleware should own consent, language selection, authentication, data minimisation, retries, audit logging, and escalation to a human agriculture officer. Treat model output as guidance; use approved crop advice, current weather, DSS outputs and authoritative scheme criteria as grounded sources. For schemes, verify each named programme and its current rules with the responsible authority before production use.

## Exotel IVR setup

The server includes an Exotel AgentStream Voicebot WebSocket at `/media`. It receives Exotel bidirectional 8 kHz linear PCM, streams caller audio to Sarvam realtime STT (Tamil/Kannada auto-detection), sends transcripts to `/api/ivr/turn`, and returns a bilingual spoken greeting and spoken response through Sarvam TTS. The app gates the public stream URL with `IVR_STREAM_TOKEN`.

1. Create an Exotel account, provision an ExoPhone/virtual number, and configure its inbound App Bazaar flow with a **Voicebot** applet (bidirectional audio, 8 kHz linear PCM). Map your ExoPhone to that flow.
2. Deploy this Node service behind a public TLS/WSS domain. Exotel must reach `wss://YOUR_HOST/media?token=YOUR_LONG_RANDOM_TOKEN`; localhost is not reachable from Exotel. Set `PUBLIC_WSS_URL` and `IVR_STREAM_TOKEN` in the server environment.
3. Add your server-side `SARVAM_API_SUBSCRIPTION_KEY`. Keep it secret; do not put it in client code or a public repository.
4. Configure `SARVAM_ADAPTER_URL` (or `IVR_ADAPTER_URL`) to an adapter that accepts `POST /conversation` (or `POST /turn`) with `{transcript, message, language, channel, module}` and returns `{reply, language}`. This adapter must route utterances to crop advisory, official scheme rules, or grievance create/status tools with an explicit consent step for filing. Add the Knowledge Engine and DSS adapters in `.env` for grounded advice.
5. Set the Exotel Voicebot applet's stream URL to the public WSS URL above, then place an inbound call to the provisioned ExoPhone. The app's **Set up IVR** panel shows whether the server-side key/token are configured.

The inbound number and Exotel account cannot be provisioned from this repository. Never use the local demo store for real grievance submissions.

### Deploy a free Render demo

This repository includes `render.yaml` for a free Render web service. Push the project to a GitHub repository, create a new Blueprint in Render, and select that repository. Render will install dependencies, run `npm start`, and use `/api/ivr/status` as its health check. The service binds to Render's assigned port on `0.0.0.0` and accepts WebSocket upgrades on `/media`.

After the first deploy, open the service's **Environment** settings and set:

- `SARVAM_API_SUBSCRIPTION_KEY` to the Sarvam key (keep it in Render's secret environment settings; never commit it).
- `IVR_ADAPTER_URL` or `SARVAM_ADAPTER_URL` to a deployed conversation adapter.
- `PUBLIC_WSS_URL` to `wss://<your-service>.onrender.com/media?token=<IVR_STREAM_TOKEN>`, using the exact generated `IVR_STREAM_TOKEN` value shown in Render. Save and redeploy, then use the same URL in the Exotel Voicebot applet.

Render's free service is for a demo: it can spin down after inactivity, so a call may encounter a cold start; deploys and instance restarts interrupt active WebSocket calls. Its filesystem is ephemeral, so demo grievance and eligibility records can disappear on restart/deploy. Use an always-on plan and durable database/storage before handling real calls or records.

References: [Exotel AgentStream protocol](https://developer.exotel.com/docs/agentstream/websocket-protocol), [Exotel setup choices](https://developer.exotel.com/docs/agentstream/what-to-use-when), [Sarvam realtime STT](https://docs.sarvam.ai/api/api-guides-tutorials/speech-to-text/realtime-streaming), [Sarvam TTS REST API](https://docs.sarvam.ai/api-reference/text-to-speech/convert).

## Middleware API contract

Implement these routes in the existing service or an adapter. Responses should include the detected/requested language and a source or freshness timestamp where relevant.

| Method and route | Purpose |
| --- | --- |
| `POST /api/crop/advisory` | `{message, language, location, crop?, sowingDate?}`. Return `{reply, language, sources?, weather?, dssRecommendation?}`. Route weather questions to a live forecast provider, and yield questions to the existing DSS crop models. |
| `POST /api/crop/photo` | Multipart crop image plus `{language, location, crop?}`. Run consent and file checks, then use the Sarvam Knowledge Engine / approved vision diagnostic path. Return suspected issue, confidence, evidence and safe next steps; never present an uncertain photo match as confirmed. |
| `POST /api/schemes/eligibility` | `{language, state, district?, landholding?, farmerCategory?, answers?}`. Ground responses in current official eligibility rules and return possible matches, unmet criteria, required documents and source date. |
| `POST /api/grievances` | `{language, category, description, village, contactReference?, consent}`. Persist via the authorized grievance service and return its actual tracking ID. Do not issue a success ID until persistence succeeds. |
| `GET /api/grievances/{id}` | Return an authorized status, latest update and next step for a tracking ID. |
| `POST /api/channels/whatsapp/webhook` | Verify provider signature, parse inbound text/media/voice, call the same middleware services, and send replies through the WhatsApp Business API. |
| `POST /api/channels/ivr/session` | IVR session hook: Sarvam STT for incoming Tamil/Kannada audio, middleware intent routing, and Sarvam TTS audio response. Support transfer to a human and DTMF fallback. |

## Scheme eligibility screening

`POST /api/schemes/eligibility` runs a deterministic pre-screen for PM-KISAN, Periyar Ninaivu Samathuvapuram housing (Tamil Nadu only), Chief Minister's Uzhavar Pathukappu Thittam (Tamil Nadu), and links to the Tamil Nadu AGRISNET or Karnataka Raitamitra scheme directory. It asks for state and district, land-record status and transfer date, family-level PM-KISAN exclusions and duplicate benefit, eKYC/DBT readiness, and additional state-specific housing or worker-category details. Results include a rule-by-rule checklist, reason, next step, status and official source URL.

Samathuvapuram is identified as a Tamil Nadu housing programme rather than a general farmer cash benefit. Its 2023 Government Order establishes priority categories, while RCC-roof households and recipients of specified prior housing schemes are excluded; local openings, field verification and Collector approval remain essential. “Krushak Yojana” does not identify a verified Tamil Nadu/Karnataka programme; the Odisha Krushak portal is linked only to clarify the jurisdiction. The state agriculture directories expose multiple changing scheme components, so the app directs users to select the exact crop/input and district instead of claiming a generic eligibility match. No result is an official approval or live record lookup. Aadhaar, bank and document numbers are not collected by the pre-check.

The rules and routing reference the [PM-KISAN portal](https://pmkisan.gov.in/), [Tamil Nadu Samathuvapuram 2023 Government Order](https://tnrd.tn.gov.in/project/go_files/3_722_2023_91.pdf), [Uzhavar Pathukappu](https://landreforms.tn.gov.in/UPT.html), [Tamil Nadu AGRISNET](https://www.tnagrisnet.tn.gov.in/home/schemes/tm), [Karnataka Raitamitra](https://raitamitra.karnataka.gov.in/), and [Krushak Odisha](https://krushak.odisha.gov.in/). Re-check current orders and availability before production use.

Wire the crop UI's photo selection to `/api/crop/photo` when that service is available. Configure `NELAM_API_BASE`, provider credentials, approved scheme sources, weather source, DSS adapter, WhatsApp webhook and IVR telephony gateway in the deployment environment. Never put provider secrets in browser code.

## Production readiness

- Connect Sarvam Conversational AI for Tamil/Kannada STT, NLP and TTS, and Sarvam Knowledge Engine for grounded retrieval.
- Implement the DSS adapter using the existing DSS team’s model inputs and response schema; preserve model version and recommendation provenance.
- Replace demo weather and eligibility responses with timestamped authoritative data.
- Connect grievance create/status routes to the authorized case system and expose the true reference ID and status.
- Configure WhatsApp Business and a telephony/IVR provider. The prototype's channel controls are setup prompts, not live links.
- Restrict the admin endpoints, encrypt and expire stored personal data, and configure identity and consent flows before any real farmer data is accepted.
- Add identity and consent flows suitable for voice-only access, secure storage, rate limits, human escalation, and operational monitoring.
