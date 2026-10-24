/*
 * VoiceKhata local Whisper speech-to-text.
 * Audio is captured with MediaRecorder and inferred in this browser via
 * Transformers.js + a quantized multilingual Whisper model. The speech audio
 * is not uploaded to a transcription API. On first use, the app downloads the
 * model/runtime and the browser caches them for later use.
 */

const TRANSFORMERS_MODULE_URLS = [
  "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1",
  "https://esm.sh/@huggingface/transformers@3.8.1"
];
// Use the supported multilingual tiny model for reliable loading on mobile devices.
const WHISPER_MODEL = "onnx-community/whisper-tiny";
const WHISPER_HINDI_MODEL = "onnx-community/whisper-base";
const TARGET_SAMPLE_RATE = 16000;
const MAX_RECORDING_SECONDS = 25;
const MAX_TRANSCRIPTION_SECONDS = 25;

let recorder = null;
let mediaStream = null;
let audioChunks = [];
let recording = false;
let processing = false;
let cancelRequested = false;
let transcriberPromise = null;
let transcriberMode = "";

let modelWarmupError = null;
let previousTranscription = "";
let lastRecordedBlob = null;
let lastRecordedLanguage = "hi-IN";
let modelReady = false;
let recordingTimer = null;

const getElement = (id) => document.getElementById(id);

function showStatus(status, hint) {
  const statusNode = getElement("micStatus");
  const hintNode = getElement("micHint");
  if (statusNode && status) statusNode.textContent = status;
  if (hintNode && hint) hintNode.textContent = hint;
}

function toast(message) {
  if (typeof window.showToast === "function") window.showToast(message);
  else console.warn("[VoiceKhata]", message);
}

function setMicVisual(isActive) {
  const button = getElement("micBtn");
  if (!button) return;
  button.classList.toggle("recording", isActive);
  button.textContent = isActive ? "⏹" : "🎙️";
  button.setAttribute("aria-label", isActive ? "Stop recording" : "Start recording");
}

function releaseMicrophone() {
  if (recordingTimer) {
    clearTimeout(recordingTimer);
    recordingTimer = null;
  }
  if (mediaStream) {
    mediaStream.getTracks().forEach((track) => track.stop());
    mediaStream = null;
  }
  recorder = null;
  recording = false;
  setMicVisual(false);
}

function setModelProgress(progress) {
  if (!progress || typeof progress.progress !== "number") return;
  const percent = Math.max(0, Math.min(100, Math.round(progress.progress)));
  const file = String(progress.file || "").split("/").pop();
  if (recording) {
    showStatus("RECORDING NOW", file
      ? "Recording is active. Preparing the local speech model (" + percent + "%)."
      : "Recording is active. Speak clearly, then tap the microphone to stop.");
  } else if (processing) {
    showStatus("LOADING LOCAL SPEECH MODEL", file
      ? "Preparing " + file + " (" + percent + "%). First use may take a while."
      : "Preparing the speech model (" + percent + "%).");
  }
}

function loadTranscriber(selectedLanguage = "hi-IN") {
  const mode = (selectedLanguage === "hi-IN" || selectedLanguage === "auto") ? "hindi" : "other";
  if (!transcriberPromise || transcriberMode !== mode) {
    transcriberMode = mode;
    modelWarmupError = null;
    modelReady = false;
    transcriberPromise = (async () => {
      if (!recording) showStatus("LOADING SPEECH MODEL", "The first use downloads a model. After it is cached, on-device transcription can work offline.");
      let transformers;
      let lastError;
      for (const url of TRANSFORMERS_MODULE_URLS) {
        try {
          transformers = await import(url);
          if (transformers?.pipeline) break;
        } catch (error) { lastError = error; }
      }
      if (!transformers?.pipeline) throw new Error("Speech library could not download: " + (lastError?.message || "connection blocked"));
      const preferred = mode === "hindi" ? WHISPER_HINDI_MODEL : WHISPER_MODEL;
      try {
        const model = await transformers.pipeline("automatic-speech-recognition", preferred,
          {device:"wasm", dtype:"q8", progress_callback:setModelProgress});
        modelReady = true;
        return model;
      } catch (error) {
        if (preferred === WHISPER_MODEL) throw error;
        console.warn("Hindi Whisper base unavailable; using lighter model", error);
        showStatus("PREPARING SMALLER MODEL", "Hindi base model unavailable. Trying lighter multilingual Whisper instead.");
        const model = await transformers.pipeline("automatic-speech-recognition", WHISPER_MODEL,
          {device:"wasm", dtype:"q8", progress_callback:setModelProgress});
        modelReady = true;
        return model;
      }
    })().catch(error => {
      modelWarmupError = error;
      modelReady = false;
      transcriberPromise = null;
      transcriberMode = "";
      throw error;
    });
  }
  return transcriberPromise;
}

function resampleAudio(input, sourceRate, targetRate) {
  if (sourceRate === targetRate) return input;
  const outputLength = Math.round(input.length * targetRate / sourceRate);
  const output = new Float32Array(outputLength);
  const ratio = sourceRate / targetRate;
  for (let i = 0; i < outputLength; i++) {
    const sourcePosition = i * ratio;
    const leftIndex = Math.floor(sourcePosition);
    const rightIndex = Math.min(leftIndex + 1, input.length - 1);
    const fraction = sourcePosition - leftIndex;
    output[i] = input[leftIndex] * (1 - fraction) + input[rightIndex] * fraction;
  }
  return output;
}

async function decodeAudioTo16k(blob) {
  let audioContext;
  try {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) throw new Error("This browser cannot decode the recorded audio.");
    try {
      audioContext = new AudioContextClass({ sampleRate: TARGET_SAMPLE_RATE });
    } catch {
      audioContext = new AudioContextClass();
    }
    const bytes = await blob.arrayBuffer();
    const audioBuffer = await audioContext.decodeAudioData(bytes);
    if (!audioBuffer.length || audioBuffer.duration < 0.6) {
      throw new Error("The recording was too short. Please speak for at least one second.");
    }
    if (audioBuffer.duration > MAX_RECORDING_SECONDS + 2) {
      throw new Error("Please keep each voice entry under " + MAX_RECORDING_SECONDS + " seconds.");
    }

    const mono = new Float32Array(audioBuffer.length);
    const channels = audioBuffer.numberOfChannels;
    for (let channel = 0; channel < channels; channel++) {
      const values = audioBuffer.getChannelData(channel);
      for (let i = 0; i < values.length; i++) mono[i] += values[i] / channels;
    }

    const rms = Math.sqrt(mono.reduce((sum, sample) => sum + sample * sample, 0) / mono.length);
    if (rms < 0.001) throw new Error("No clear speech detected. Check the microphone input and speak louder.");
    return resampleAudio(mono, audioBuffer.sampleRate, TARGET_SAMPLE_RATE);
  } finally {
    if (audioContext && audioContext.state !== "closed") {
      try { await audioContext.close(); } catch { /* no-op */ }
    }
  }
}

function whisperLanguage(selectedLanguage) {
  if (selectedLanguage === "hi-IN") return "hindi";
  if (selectedLanguage === "mr-IN") return "marathi";
  if (selectedLanguage === "en-IN") return "english";
  return null; // Auto-detect Hindi/English/Hinglish rather than forcing English.
}

async function transcribeBlob(blob, selectedLanguage) {
  processing = true;
  showStatus("PREPARING AUDIO", "Converting the microphone recording for local transcription.");
  try {
    const [asr, samples] = await Promise.all([
      loadTranscriber(selectedLanguage),
      decodeAudioTo16k(blob)
    ]);

    if (cancelRequested) return;
    showStatus("TRANSCRIBING ON THIS DEVICE", "Whisper is processing the recording in your browser.");
    const chosenLanguage = whisperLanguage(selectedLanguage);
    const options = {
      task: "transcribe",
      return_timestamps: false,
      chunk_length_s: MAX_TRANSCRIPTION_SECONDS,
      stride_length_s: 2,
      // Short transactional phrases need consistent deterministic decoding.
      temperature: 0,
      num_beams: 3
    };
    if (chosenLanguage) options.language = chosenLanguage;
    const result = await asr(samples, options);

    if (cancelRequested) return;
    const transcript = String(result && result.text || "").trim();
    const likelyHallucination = /^(?:thank you\.?|thanks\.?|subtitles by|music|you|thanks for watching|subscribe)$/i.test(transcript);
    if (likelyHallucination) {
      toast("Speech was unclear. Please record again or edit the transcript.");
      showStatus("TAP TO RECORD", "Could not reliably recognize your transaction.");
      return;
    }
    if (!transcript) {
      toast("No speech was recognized. Try speaking closer to the microphone.");
      showStatus("TAP TO RECORD", "No text captured. Try again or type the transaction.");
      return;
    }

    const transcriptBox = getElement("transcriptBox");
    if (transcriptBox) {
      // Never silently erase a manually edited transcription when retrying.
      const existing = transcriptBox.value.trim();
      if (existing && existing !== previousTranscription && existing !== transcript) {
        if (!window.confirm("Replace your current edited transcription with this new result?")) {
          showStatus("TRANSCRIPT KEPT", "Your manually edited text was preserved.");
          return;
        }
      }
      previousTranscription = transcript;
      transcriptBox.value = transcript;
      transcriptBox.className = "";
      transcriptBox.placeholder = "Your speech will appear here... or type manually.";
      transcriptBox.dispatchEvent(new Event("input", { bubbles: true }));
    }
    showStatus("TRANSCRIPTION READY", "Check every Hindi word, especially the customer name and rupee amount. Correct any mistakes before parsing.");
    toast("Speech converted to text. Check it before preparing the transaction.");
  } catch (error) {
    console.error("VoiceKhata local transcription failed:", error);
    const detail = modelWarmupError ? String(modelWarmupError.message || modelWarmupError) : String(error && error.message || error);
    if (/fetch|network|load|download|wasm|model/i.test(detail)) {
      toast("On-device speech model could not download or start. An internet connection is required for the FIRST model download; try another network, or type the transaction.");
    } else {
      toast("Local transcription failed: " + detail);
    }
    showStatus("TAP TO RECORD", "Local speech needs a downloaded model. Check your connection once, or enter the transaction as text.");
  } finally {
    processing = false;
    cancelRequested = false;
    releaseMicrophone();
  }
}

async function startRecording(selectedLanguage) {
  if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== "function") {
    throw new Error("Microphone access requires HTTPS or localhost. Open the GitHub Pages link or http://localhost.");
  }
  if (typeof MediaRecorder === "undefined") {
    throw new Error("This browser does not support audio recording. Try the latest version of Chrome.");
  }

  mediaStream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
  });
  audioChunks = [];
  cancelRequested = false;

  const mimeTypes = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"];
  const mimeType = mimeTypes.find((type) => typeof MediaRecorder.isTypeSupported === "function" && MediaRecorder.isTypeSupported(type));
  recorder = new MediaRecorder(mediaStream, mimeType ? { mimeType } : undefined);

  recorder.ondataavailable = (event) => {
    if (event.data && event.data.size > 0) audioChunks.push(event.data);
  };
  recorder.onerror = (event) => {
    toast("The browser could not record audio: " + (event.error && event.error.message || "unknown recording error"));
    releaseMicrophone();
    showStatus("TAP TO RECORD", "Check microphone permission and try again.");
  };
  recorder.onstop = async () => {
    if (recordingTimer) {
      clearTimeout(recordingTimer);
      recordingTimer = null;
    }
    const type = recorder && recorder.mimeType || mimeType || "audio/webm";
    const blob = new Blob(audioChunks, { type });
    audioChunks = [];
    releaseMicrophone();
    if (cancelRequested || !blob.size) {
      showStatus("TAP TO RECORD", "Recording cleared. Tap the microphone to try again.");
      cancelRequested = false;
      return;
    }
    lastRecordedBlob = blob;
    lastRecordedLanguage = selectedLanguage;
    await transcribeBlob(blob, selectedLanguage);
  };

  recorder.start(250);
  recording = true;
  setMicVisual(true);
  showStatus("RECORDING NOW", "Speak clearly. Tap the microphone again to transcribe locally. Max " + MAX_RECORDING_SECONDS + " seconds.");
  
  // The language-specific model is prepared before microphone recording begins.

  recordingTimer = setTimeout(() => {
    if (recording && recorder && recorder.state === "recording") {
      toast("Reached the " + MAX_RECORDING_SECONDS + "-second recording limit. Transcribing now.");
      recorder.stop();
    }
  }, MAX_RECORDING_SECONDS * 1000);
}

async function localToggle(selectedLanguage) {
  if (processing) {
    toast("Please wait for the current transcription to finish.");
    return;
  }
  if (recording && recorder && recorder.state === "recording") {
    recorder.stop();
    return;
  }
  try {
    if (!modelReady || !transcriberPromise || (transcriberMode === "hindi") !== (selectedLanguage === "hi-IN" || selectedLanguage === "auto")) {
      showStatus("PREPARING HINDI MODEL", "Downloading or opening speech model before recording. The first use needs internet.");
      await loadTranscriber(selectedLanguage);
      showStatus("MODEL READY", "Tap recording and speak slowly, with a brief pause before and after your sentence.");
    }
    await startRecording(selectedLanguage);
  } catch (error) {
    console.error("VoiceKhata microphone error:", error);
    releaseMicrophone();
    const message = String(error && error.message || error);
    if (error && (error.name === "NotAllowedError" || error.name === "PermissionDeniedError")) {
      toast("Microphone permission was denied. Allow microphone access for this site in Chrome's site settings.");
    } else if (error && error.name === "NotFoundError") {
      toast("No microphone was found. Check your Mac's input device.");
    } else {
      toast(message);
    }
    showStatus("TAP TO RECORD", "Allow microphone access, then try again.");
  }
}


let browserRecognition = null;
let browserRecording = false;
let browserFinal = "";
function stopBrowserSpeech() {
  if (browserRecognition) {
    try { browserRecognition.stop(); } catch {}
  }
}
function beginBrowserSpeech(selectedLanguage) {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    toast("Browser speech recognition is not supported here. Try Chrome, or select Local Whisper.");
    showStatus("BROWSER SPEECH UNAVAILABLE", "You can type a transaction or try local Whisper.");
    return;
  }
  if (browserRecording) { stopBrowserSpeech(); return; }
  let recognition;
  try { recognition = new SpeechRecognition(); }
  catch (error) { toast("Browser speech could not start: " + error.message); return; }
  browserRecognition = recognition;
  recognition.lang = selectedLanguage === "mr-IN" ? "mr-IN" : selectedLanguage === "en-IN" ? "en-IN" : "hi-IN";
  recognition.interimResults = true;
  recognition.continuous = true;
  recognition.maxAlternatives = 1;
  const input = getElement("transcriptBox");
  const prior = input?.value.trim() || "";
  browserFinal = prior ? prior + " " : "";
  recognition.onstart = () => {
    browserRecording = true;
    setMicVisual(true);
    showStatus("LISTENING", "Speak in Hindi or Hinglish. Tap the mic to stop. Review the text before saving.");
  };
  recognition.onresult = event => {
    let provisional = "";
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const phrase = event.results[i][0]?.transcript || "";
      if (event.results[i].isFinal) browserFinal += phrase + " ";
      else provisional += phrase;
    }
    if (input) input.value = (browserFinal + provisional).trim();
  };
  recognition.onerror = event => {
    const issue = {
      "not-allowed": "Microphone permission denied. Allow microphone access in browser site settings.",
      "service-not-allowed": "Browser speech service is unavailable. Select Local Whisper instead.",
      "network": "The browser speech provider failed, which can happen even when the internet works. Choose Local Whisper instead.",
      "no-speech": "No speech detected. Speak clearly and try again.",
      "audio-capture": "No microphone was found. Check your system microphone settings.",
      "language-not-supported": "This browser does not support the selected language. Try Hindi or Local Whisper."
    }[event.error] || "Voice recognition failed (" + event.error + ").";
    toast(issue);
    showStatus("RECORDING ERROR", issue);
  };
  recognition.onend = () => {
    browserRecording = false;
    browserRecognition = null;
    setMicVisual(false);
    const hasText = !!input?.value.trim();
    if (hasText) showStatus("TRANSCRIPT READY", "Review the recognized text, then tap Understand Transaction.");
    else showStatus("TAP TO RECORD", "No transcript captured. Try again or type your transaction.");
  };
  try { recognition.start(); } catch (error) {
    browserRecognition = null;
    browserRecording = false;
    setMicVisual(false);
    toast("Browser microphone could not start: " + error.message);
  }
}
async function retryTranscription() {
  if (!lastRecordedBlob) {
    toast("Record a transaction first. There is no saved audio to retry.");
    return;
  }
  if (recording || browserRecording || processing) {
    toast("Finish the current recording first.");
    return;
  }
  const selected = getElement("langSelect")?.value || lastRecordedLanguage;
  await transcribeBlob(lastRecordedBlob, selected);
}

async function toggle(selectedLanguage) {
  const mode = getElement("speechEngine")?.value || "local";
  if (browserRecording) { stopBrowserSpeech(); return; }
  if (recording || processing) { await localToggle(selectedLanguage); return; }
  if (mode === "browser") beginBrowserSpeech(selectedLanguage);
  else await localToggle(selectedLanguage);
}

function cancel() {
  if (browserRecording) stopBrowserSpeech();
  if (recording && recorder && recorder.state === "recording") {
    cancelRequested = true;
    recorder.stop();
  } else if (processing) {
    cancelRequested = true;
  }
}

window.VoiceKhataWhisper = {
  toggle,
  cancel,
  retryTranscription,
  prepare: loadTranscriber,
  get modelReady() { return modelReady; },
  get isRecording() { return recording || browserRecording; },
  get isProcessing() { return processing; }
};

