/* GemmaKhata - Voice Entry: record in the browser, send to /api/transcribe,
   show an editable transcript. The next step (Gemma extraction) listens for
   the "transcript:ready" event or calls window.GemmaKhata.getTranscript(). */
(() => {
  'use strict';

  const $ = (sel) => document.querySelector(sel);
  const micBtn = $('#mic');
  const statusEl = $('#status');
  const timerEl = $('#timer');
  const transcriptEl = $('#transcript');
  const metaEl = $('#meta');
  const fileInput = $('#file');
  const uploadBtn = $('#upload');
  const clearBtn = $('#clear');
  const langInputs = document.querySelectorAll('input[name="lang"]');

  const MAX_SECONDS = 120;            // auto-stop so a forgotten mic can't run forever
  const MIN_SECONDS = 0.7;            // shorter than this is an accidental tap
  const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
  const REQUEST_TIMEOUT_MS = 180000;  // first request may wait for the model to load
  const IDLE_TEXT = 'Tap the mic and speak';

  const LANG_NAMES = {
    hi: 'Hindi', mr: 'Marathi', en: 'English', gu: 'Gujarati', bn: 'Bengali',
    ta: 'Tamil', te: 'Telugu', kn: 'Kannada', pa: 'Punjabi', ur: 'Urdu',
  };

  // Chrome/Firefox/Android record webm; Safari/iOS records mp4.
  const MIME_CANDIDATES = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/mp4',
    'audio/ogg;codecs=opus',
  ];

  let state = 'idle'; // idle | recording | processing
  let stream = null;
  let recorder = null;
  let chunks = [];
  let startedAt = 0;
  let timerId = 0;
  let autoStopId = 0;
  let slowHintId = 0;
  let audioCtx = null;
  let meterRaf = 0;

  /* ---------- small helpers ---------- */

  function currentLang() {
    const checked = document.querySelector('input[name="lang"]:checked');
    return checked ? checked.value : 'auto';
  }

  function say(text, tone) {
    statusEl.textContent = text;
    statusEl.dataset.tone = tone || '';
  }

  function setState(next) {
    state = next;
    micBtn.classList.toggle('is-recording', next === 'recording');
    micBtn.classList.toggle('is-busy', next === 'processing');
    micBtn.setAttribute('aria-pressed', String(next === 'recording'));
    micBtn.setAttribute('aria-label', next === 'recording' ? 'Stop recording' : 'Start recording');
    micBtn.setAttribute('aria-busy', String(next === 'processing'));
    micBtn.disabled = next === 'processing';
    uploadBtn.disabled = next !== 'idle';
    langInputs.forEach((input) => { input.disabled = next !== 'idle'; });
    timerEl.classList.toggle('is-live', next === 'recording');
  }

  function formatTime(totalSeconds) {
    const s = Math.floor(totalSeconds);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }

  function pickMime() {
    if (!window.MediaRecorder || !MediaRecorder.isTypeSupported) return '';
    return MIME_CANDIDATES.find((t) => MediaRecorder.isTypeSupported(t)) || '';
  }

  function extensionFor(type) {
    if (type.includes('mp4')) return 'mp4';
    if (type.includes('ogg')) return 'ogg';
    if (type.includes('wav')) return 'wav';
    return 'webm';
  }

  function micErrorMessage(err) {
    switch (err && err.name) {
      case 'NotAllowedError':
      case 'SecurityError':
        return 'The microphone is blocked. Allow it for this site in your browser settings, then tap the mic again.';
      case 'NotFoundError':
        return 'No microphone found. Plug one in, or use Upload audio.';
      case 'NotReadableError':
        return 'Another app is using the microphone. Close it and tap the mic again.';
      default:
        return 'The microphone could not start. Reload the page and try again, or use Upload audio.';
    }
  }

  /* ---------- voice-level ring ---------- */

  function startMeter(mediaStream) {
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      audioCtx = new Ctx();
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      audioCtx.createMediaStreamSource(mediaStream).connect(analyser);
      const samples = new Uint8Array(analyser.fftSize);
      let level = 0;
      const tick = () => {
        analyser.getByteTimeDomainData(samples);
        let sum = 0;
        for (let i = 0; i < samples.length; i++) {
          const d = (samples[i] - 128) / 128;
          sum += d * d;
        }
        const target = Math.min(1, Math.sqrt(sum / samples.length) * 4);
        level += (target - level) * 0.3; // smooth so the ring doesn't flicker
        micBtn.style.setProperty('--level', level.toFixed(3));
        meterRaf = requestAnimationFrame(tick);
      };
      tick();
    } catch (_) {
      /* the ring is decoration; recording works without it */
    }
  }

  function stopMeter() {
    cancelAnimationFrame(meterRaf);
    meterRaf = 0;
    micBtn.style.setProperty('--level', '0');
    if (audioCtx) {
      audioCtx.close().catch(() => {});
      audioCtx = null;
    }
  }

  function releaseStream() {
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
      stream = null;
    }
  }

  /* ---------- recording ---------- */

  function tickTimer() {
    timerEl.textContent = formatTime((performance.now() - startedAt) / 1000);
  }

  async function startRecording() {
    if (state !== 'idle') return;

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || !window.MediaRecorder) {
      say(
        window.isSecureContext
          ? 'This browser cannot record audio. Use Upload audio instead.'
          : 'The microphone works only on localhost or HTTPS. Open http://localhost:8000, or use Upload audio.',
        'error'
      );
      return;
    }

    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
      });
    } catch (err) {
      say(micErrorMessage(err), 'error');
      return;
    }

    const mime = pickMime();
    try {
      recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    } catch (_) {
      releaseStream();
      say('This browser cannot record audio. Use Upload audio instead.', 'error');
      return;
    }

    chunks = [];
    recorder.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
    recorder.onstop = handleStop;
    recorder.start();

    startedAt = performance.now();
    setState('recording');
    say('Listening. Tap the button again when you finish.');
    tickTimer();
    timerId = setInterval(tickTimer, 250);
    autoStopId = setTimeout(stopRecording, MAX_SECONDS * 1000);
    startMeter(stream);
  }

  function stopRecording() {
    clearInterval(timerId);
    clearTimeout(autoStopId);
    stopMeter();
    if (recorder && recorder.state === 'recording') recorder.stop();
  }

  function handleStop() {
    const seconds = (performance.now() - startedAt) / 1000;
    const type = (recorder && recorder.mimeType) || 'audio/webm';
    releaseStream();
    const blob = new Blob(chunks, { type });
    chunks = [];

    if (seconds < MIN_SECONDS || blob.size < 1024) {
      setState('idle');
      say('That was too short. Tap the mic and speak a little longer.', 'error');
      return;
    }
    send(blob, `recording.${extensionFor(type)}`);
  }

  /* ---------- talking to the server ---------- */

  async function send(blob, filename) {
    setState('processing');
    say('Writing it down…');
    slowHintId = setTimeout(() => {
      say('Still working. The first entry is slower while the speech model loads.');
    }, 6000);

    const form = new FormData();
    form.append('audio', blob, filename);
    form.append('language', currentLang());

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const res = await fetch('/api/transcribe', { method: 'POST', body: form, signal: controller.signal });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(typeof body.detail === 'string' ? body.detail : `The server returned an error (${res.status}).`);
      }
      showResult(body);
    } catch (err) {
      let message = err.message;
      if (err.name === 'AbortError') message = 'This took too long. Try a shorter entry.';
      else if (err instanceof TypeError) message = 'Cannot reach the server. Check that it is running, then try again.';
      setState('idle');
      say(message, 'error');
    } finally {
      clearTimeout(timeoutId);
      clearTimeout(slowHintId);
    }
  }

  function showResult(result) {
    setState('idle');
    const text = (result.text || '').trim();
    if (!text) {
      metaEl.textContent = '';
      say('I could not hear any words. Move closer to the phone and try again.', 'error');
      return;
    }
    transcriptEl.value = text;
    const lang = LANG_NAMES[result.language] || result.language;
    metaEl.textContent = `Heard ${lang}. ${result.duration} s of audio, written in ${result.elapsed} s.`;
    say('Done. Fix any word that is wrong.', 'ok');
    document.dispatchEvent(new CustomEvent('transcript:ready', { detail: result }));
  }

  /* ---------- wiring ---------- */

  micBtn.addEventListener('click', () => {
    if (state === 'recording') stopRecording();
    else if (state === 'idle') startRecording();
  });

  uploadBtn.addEventListener('click', () => fileInput.click());

  fileInput.addEventListener('change', () => {
    const file = fileInput.files && fileInput.files[0];
    fileInput.value = '';
    if (!file || state !== 'idle') return;
    if (file.size > MAX_UPLOAD_BYTES) {
      say('That file is larger than 25 MB. Choose a shorter recording.', 'error');
      return;
    }
    send(file, file.name);
  });

  clearBtn.addEventListener('click', () => {
    transcriptEl.value = '';
    metaEl.textContent = '';
    if (state === 'idle') say(IDLE_TEXT);
  });

  try {
    const saved = localStorage.getItem('gk.lang');
    const el = saved && document.querySelector(`input[name="lang"][value="${saved}"]`);
    if (el) el.checked = true;
  } catch (_) { /* storage can be blocked; the default is fine */ }

  langInputs.forEach((input) => {
    input.addEventListener('change', () => {
      try { localStorage.setItem('gk.lang', currentLang()); } catch (_) { /* ignore */ }
    });
  });

  window.addEventListener('pagehide', () => { stopMeter(); releaseStream(); });

  // Hook for the next build step (Gemma extraction).
  window.GemmaKhata = {
    getTranscript: () => transcriptEl.value.trim(),
    getLanguage: currentLang,
  };

  say(IDLE_TEXT);
})();
