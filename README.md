# Nelam Farm Assistant

A responsive prototype for a Tamil-first / Kannada-first farm assistant across WhatsApp and IVR. It demonstrates crop advisory, scheme eligibility, and grievance filing and tracking. The current UI runs without credentials and uses clearly labelled sample responses; it is not connected to Sarvam, a live weather feed, a government scheme registry, a DSS, WhatsApp, IVR, or a grievance department.

## Run the prototype

Install Node.js 20 or newer and run `npm start` in this directory. Open `http://localhost:4173`. The local server persists demo grievance records, scheme checks and recent advisory context in `data/demo-store.json`; this file is git-ignored and is not a production datastore. The admin support endpoints are `GET /api/admin/grievances` and `GET /api/admin/eligibility-checks` (protect them with authentication before deployment). The optional browser setting `window.NELAM_API_BASE` selects the middleware base URL; it defaults to `/api`.

Copy `.env.example` to `.env` as a reference and set the adapter URLs in the server process environment. The sample server does not load `.env` automatically. Provider API keys belong in the secured adapter service, never in browser code. Without adapter URLs, text advice and scheme checks are demonstrations, and grievance IDs/statuses exist only in the local demo register.

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

`POST /api/schemes/eligibility` now runs a deterministic local rules screen for the three names in the brief and stores each check. It returns a status, explanation, next step and source link for each programme. PM-KISAN only returns a preliminary match when recorded cultivable family land is reported and no exclusion is declared; a known exclusion screens out, and an unknown answer requires manual review. Aadhaar/eKYC is treated as a follow-up readiness step, not as the sole legal eligibility rule.

Samathuvapuram is identified as a Tamil Nadu housing programme rather than a general farmer cash benefit; current district allotment and beneficiary selection must be confirmed locally. “Krushak Yojana” is treated as ambiguous because it does not identify one specific Tamil Nadu/Karnataka programme. The checker asks the farmer to verify the exact name/state rather than substituting an Odisha scheme. No result is an official approval or a live portal lookup.

The scheme rules are based on the [PM-KISAN official portal](https://pmkisan.gov.in/), [Tamil Nadu Rural Development Samathuvapuram scheme page](https://tnrd.tn.gov.in/schemes/st_samathuvapuram.html), and [Odisha Agriculture Department KALIA page](https://agri.odisha.gov.in/en/agriculturedepartmentagricultu/kalia). Re-check current orders and availability before production use.

Wire the crop UI's photo selection to `/api/crop/photo` when that service is available. Configure `NELAM_API_BASE`, provider credentials, approved scheme sources, weather source, DSS adapter, WhatsApp webhook and IVR telephony gateway in the deployment environment. Never put provider secrets in browser code.

## Production readiness

- Connect Sarvam Conversational AI for Tamil/Kannada STT, NLP and TTS, and Sarvam Knowledge Engine for grounded retrieval.
- Implement the DSS adapter using the existing DSS team’s model inputs and response schema; preserve model version and recommendation provenance.
- Replace demo weather and eligibility responses with timestamped authoritative data.
- Connect grievance create/status routes to the authorized case system and expose the true reference ID and status.
- Configure WhatsApp Business and a telephony/IVR provider. The prototype's channel controls are setup prompts, not live links.
- Restrict the admin endpoints, encrypt and expire stored personal data, and configure identity and consent flows before any real farmer data is accepted.
- Add identity and consent flows suitable for voice-only access, secure storage, rate limits, human escalation, and operational monitoring.
