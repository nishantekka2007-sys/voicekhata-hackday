/*
 * VoiceKhata local Whisper speech-to-text.
 * Audio is captured with MediaRecorder and inferred in this browser via
 * Transformers.js + a quantized multilingual Whisper model. The speech audio
 * is not uploaded to a transcription API. On first use, the app downloads the
 * model/runtime and the browser caches them for later use.
 */

const TRANSFORMERS_MODULE_URL = "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1";
const WHISPER_MODEL = "onnx-community/whisper-tiny";
const TARGET_SAMPLE_RATE = 16000;
const MAX_RECORDING_SECONDS = 25;

let recorder = null;
let mediaStream = null;
let audioChunks = [];
let recording = false;
let processing = false;
let cancelRequested = false;
let transcriberPromise = null;
let modelWarmupError = null;
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

function loadTranscriber() {
  if (!transcriberPromise) {
    modelWarmupError = null;
    transcriberPromise = (async () => {
      showStatus("LOADING LOCAL SPEECH MODEL", "First use downloads the speech model. It will be cached by your browser.");
      const transformers = await import(TRANSFORMERS_MODULE_URL);
      if (!transformers || typeof transformers.pipeline !== "function") {
        throw new Error("The local speech model library could not be loaded.");
      }
      return transformers.pipeline(
        "automatic-speech-recognition",
        WHISPER_MODEL,
        { progress_callback: setModelProgress }
      );
    })().catch((error) => {
      modelWarmupError = error;
      transcriberPromise = null;
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
    if (!audioBuffer.length || audioBuffer.duration < 0.25) {
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
  return "english";
}

async function transcribeBlob(blob, selectedLanguage) {
  processing = true;
  showStatus("PREPARING AUDIO", "Converting the microphone recording for local transcription.");
  try {
    const [asr, samples] = await Promise.all([
      loadTranscriber(),
      decodeAudioTo16k(blob)
    ]);

    if (cancelRequested) return;
    showStatus("TRANSCRIBING ON THIS DEVICE", "Whisper is processing the recording in your browser.");
    const result = await asr(samples, {
      language: whisperLanguage(selectedLanguage),
      task: "transcribe"
    });

    if (cancelRequested) return;
    const transcript = String(result && result.text || "").trim();
    if (!transcript) {
      toast("No speech was recognized. Try speaking closer to the microphone.");
      showStatus("TAP TO RECORD", "No text captured. Try again or type the transaction.");
      return;
    }

    const transcriptBox = getElement("transcriptBox");
    if (transcriptBox) {
      transcriptBox.value = transcript;
      transcriptBox.className = "";
      transcriptBox.placeholder = "Your speech will appear here... or type manually.";
      transcriptBox.dispatchEvent(new Event("input", { bubbles: true }));
    }
    showStatus("TRANSCRIPTION READY", "Check the transcript, then choose Understand Transaction.");
    toast("Speech converted to text. Check it before preparing the transaction.");
  } catch (error) {
    console.error("VoiceKhata local transcription failed:", error);
    const detail = modelWarmupError ? String(modelWarmupError.message || modelWarmupError) : String(error && error.message || error);
    if (/fetch|network|load|download|wasm|model/i.test(detail)) {
      toast("Could not load the local Whisper model. Check access to jsDelivr and Hugging Face, then refresh and retry.");
    } else {
      toast("Local transcription failed: " + detail);
    }
    showStatus("TAP TO RECORD", "Local speech model could not start. You can still type the transaction.");
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
    await transcribeBlob(blob, selectedLanguage);
  };

  recorder.start(250);
  recording = true;
  setMicVisual(true);
  showStatus("RECORDING NOW", "Speak clearly. Tap the microphone again to transcribe locally. Max " + MAX_RECORDING_SECONDS + " seconds.");
  
  // Begin downloading/loading the speech engine while the user is speaking.
  loadTranscriber().catch((error) => {
    console.warn("Whisper model pre-load failed; it will retry after recording:", error);
  });

  recordingTimer = setTimeout(() => {
    if (recording && recorder && recorder.state === "recording") {
      toast("Reached the " + MAX_RECORDING_SECONDS + "-second recording limit. Transcribing now.");
      recorder.stop();
    }
  }, MAX_RECORDING_SECONDS * 1000);
}

async function toggle(selectedLanguage) {
  if (processing) {
    toast("Please wait for the current transcription to finish.");
    return;
  }
  if (recording && recorder && recorder.state === "recording") {
    recorder.stop();
    return;
  }
  try {
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

function cancel() {
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
  get isRecording() { return recording; },
  get isProcessing() { return processing; }
};

