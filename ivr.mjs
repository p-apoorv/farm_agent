import WebSocket, { WebSocketServer } from 'ws';

function pcmFromBase64Audio(encoded) {
  const audio = Buffer.from(encoded, 'base64');
  if (audio.length > 44 && audio.toString('ascii', 0, 4) === 'RIFF') {
    let offset = 12;
    while (offset + 8 <= audio.length) {
      const size = audio.readUInt32LE(offset + 4);
      if (audio.toString('ascii', offset, offset + 4) === 'data') return audio.subarray(offset + 8, offset + 8 + size);
      offset += 8 + size + (size % 2);
    }
  }
  return audio;
}

async function makeSpeech(text, languageCode, sarvamKey) {
  if (!sarvamKey) throw new Error('SARVAM_API_SUBSCRIPTION_KEY is not configured');
  const response = await fetch('https://api.sarvam.ai/text-to-speech', {
    method: 'POST',
    headers: { 'api-subscription-key': sarvamKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, model: 'bulbul:v3', language_code: languageCode, speaker: languageCode === 'kn-IN' ? 'shubh' : 'shubh', output_audio_codec: 'linear16', speech_sample_rate: 8000 }),
    signal: AbortSignal.timeout(20000)
  });
  if (!response.ok) throw new Error(`Sarvam TTS returned ${response.status}`);
  const result = await response.json();
  if (!result.audios?.[0]) throw new Error('Sarvam TTS returned no audio');
  return pcmFromBase64Audio(result.audios[0]);
}

function sendExotelAudio(socket, streamSid, pcm) {
  if (socket.readyState !== WebSocket.OPEN || !streamSid || !pcm?.length) return;
  const maxChunk = 3200;
  for (let offset = 0; offset < pcm.length; offset += maxChunk) {
    let chunk = pcm.subarray(offset, Math.min(offset + maxChunk, pcm.length));
    if (chunk.length % 2) chunk = chunk.subarray(0, chunk.length - 1);
    socket.send(JSON.stringify({ event: 'media', stream_sid: streamSid, media: { payload: chunk.toString('base64') } }));
  }
}

async function answerTurn(transcript, language) {
  const apiPort = Number(process.env.PORT || 4173);
  const baseUrl = process.env.NELAM_INTERNAL_URL || `http://127.0.0.1:${apiPort}`;
  const response = await fetch(`${baseUrl}/api/ivr/turn`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ transcript, language, channel: 'ivr' }), signal: AbortSignal.timeout(30000)
  });
  if (!response.ok) throw new Error(`IVR conversation service returned ${response.status}`);
  return response.json();
}

export function attachIvr(server) {
  const sarvamKey = process.env.SARVAM_API_SUBSCRIPTION_KEY;
  const streamToken = process.env.IVR_STREAM_TOKEN;
  const wss = new WebSocketServer({ noServer: true, maxPayload: 256 * 1024 });
  server.on('upgrade', (request, socket, head) => {
    const url = new URL(request.url, 'http://localhost');
    if (url.pathname !== '/media') { socket.destroy(); return; }
    if (!streamToken || url.searchParams.get('token') !== streamToken) { socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n'); socket.destroy(); return; }
    wss.handleUpgrade(request, socket, head, client => wss.emit('connection', client, request));
  });

  wss.on('connection', exotel => {
    let streamSid;
    let stt;
    let detectedLanguage = 'ta-IN';
    let callEnded = false;
    let responseBusy = false;

    const closeStt = () => { if (stt && stt.readyState < WebSocket.CLOSING) stt.close(); };
    exotel.on('message', async data => {
      let event;
      try { event = JSON.parse(data.toString()); } catch { return; }
      if (event.event === 'connected') return;
      if (event.event === 'start') {
        streamSid = event.start?.stream_sid || event.stream_sid;
        if (!sarvamKey) { exotel.close(1011, 'IVR requires Sarvam API key'); return; }
        const sarvamUrl = new URL('wss://api.sarvam.ai/speech-to-text-realtime/ws');
        sarvamUrl.searchParams.set('model', process.env.SARVAM_STT_MODEL || 'saaras:v3-realtime');
        sarvamUrl.searchParams.set('language_code', 'auto');
        sarvamUrl.searchParams.set('stream_type', 'fast');
        sarvamUrl.searchParams.set('endpointing', 'vad');
        sarvamUrl.searchParams.set('encoding', 'linear16');
        sarvamUrl.searchParams.set('sample_rate', '8000');
        sarvamUrl.searchParams.set('mode', 'transcribe');
        stt = new WebSocket(sarvamUrl, { headers: { 'api-subscription-key': sarvamKey } });
        stt.on('open', async () => {
          try {
            const [taPrompt, knPrompt] = await Promise.all([
              makeSpeech('வணக்கம். தமிழில் பேசுங்கள். பயிர் ஆலோசனை, திட்ட உதவி அல்லது புகார் பற்றி கேளுங்கள்.', 'ta-IN', sarvamKey),
              makeSpeech('ನಮಸ್ಕಾರ. ಕನ್ನಡದಲ್ಲಿ ಮಾತನಾಡಿ. ಬೆಳೆ ಸಲಹೆ, ಯೋಜನೆ ಅಥವಾ ದೂರು ಬಗ್ಗೆ ಕೇಳಿ.', 'kn-IN', sarvamKey)
            ]);
            sendExotelAudio(exotel, streamSid, Buffer.concat([taPrompt, knPrompt]));
          } catch (error) { console.error('IVR greeting failed:', error.message); }
        });
        stt.on('message', async message => {
          let result;
          try { result = JSON.parse(message.toString()); } catch { return; }
          if (result.event === 'error') { console.error('Sarvam STT error:', result.message); return; }
          if (result.event !== 'transcript.final' || !result.text?.trim() || responseBusy || callEnded) return;
          responseBusy = true;
          detectedLanguage = result.language === 'kn-IN' ? 'kn-IN' : result.language === 'ta-IN' ? 'ta-IN' : detectedLanguage;
          try {
            const answer = await answerTurn(result.text.trim(), detectedLanguage);
            const reply = answer.reply || answer.answer;
            if (reply) sendExotelAudio(exotel, streamSid, await makeSpeech(reply, answer.language === 'kn' || answer.language === 'kn-IN' ? 'kn-IN' : detectedLanguage, sarvamKey));
          } catch (error) { console.error('IVR turn failed:', error.message); }
          finally { responseBusy = false; }
        });
        stt.on('error', error => console.error('Sarvam STT connection failed:', error.message));
        return;
      }
      if (event.event === 'media' && stt?.readyState === WebSocket.OPEN && !responseBusy) {
        stt.send(JSON.stringify({ event: 'audio_input', audio: event.media?.payload || '' }));
      }
      if (event.event === 'stop') { callEnded = true; closeStt(); }
    });
    exotel.on('close', () => { callEnded = true; closeStt(); });
    exotel.on('error', error => { console.error('Exotel stream error:', error.message); closeStt(); });
  });

  return { active: Boolean(sarvamKey && streamToken), path: '/media' };
}
