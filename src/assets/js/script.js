/**
 * AI Interview Platform — Student Dashboard v7
 * Features:
 *   • ProctoringSystem (tab‑switch, blur, fullscreen, copy/paste, DevTools)
 *   • Per‑question countdown timer (5 minutes)
 *   • Answer buffer → batch AI evaluation at completion
 *   • Browser speech recognition (Web Speech API) – reliable, no backend
 *   • Diarization (multiple speaker detection via WebSocket)
 */
'use strict';

const api = window.location.origin;

/* ── Config ──────────────────────────────────────────────────────────────── */
const QUESTION_TIME_LIMIT = 5 * 60;   // seconds per question (5 minutes)

/* ── Question state ─────────────────────────────────────────────────────── */
let allQuestions = [];
let currentIndex = 0;
let answeredCount = 0;
let currentQuestion = { id: null, text: '', category: '' };

/* ── Answer buffer (for batch AI evaluation) ────────────────────────────── */
let answeredBuffer = [];

/* ── Question timer ─────────────────────────────────────────────────────── */
let timerInterval = null;
let timerSeconds = QUESTION_TIME_LIMIT;

/* ── Exam recording ─────────────────────────────────────────────────────── */
let examStream = null;
let examRecorder = null;
let examChunks = [];
let examBlob = null;
let examRecording = false;
let examElapsed = 0;
let examTimer = null;

/* ── Speech state (browser recognition) ─────────────────────────────────── */
let recognition = null;
let isListening = false;
let restartTimer = null;
let textBeforeSession = '';
let sessionFinals = '';

/* ── Diarization (multiple speakers) ────────────────────────────────────── */
let diarizationSocket = null;
let audioContext = null;
let mediaStreamForDiarization = null;

/* ── Proctoring ─────────────────────────────────────────────────────────── */
let proctor = null;

/* ── Session ────────────────────────────────────────────────────────────── */
let sessionStart = Date.now();
let interviewStarted = false;
let skipBtn;

/* ── DOM refs ───────────────────────────────────────────────────────────── */
let videoPreview, videoOverlay, recIndicator, recDuration,
  micBtn, micStatus, waveform,
  answerText, charCount, submitBtn, nextBtn, clearBtn, questionText;

function initDomRefs() {
  const g = id => document.getElementById(id);
  videoPreview = g('video-preview');
  videoOverlay = g('video-overlay');
  recIndicator = g('rec-indicator');
  recDuration = g('rec-duration');
  micBtn = g('mic-btn');
  micStatus = g('mic-status');
  waveform = g('waveform');
  answerText = g('answer-text');
  charCount = g('char-count');
  submitBtn = g('submit-btn');
  nextBtn = g('next-btn');
  clearBtn = g('clear-btn');
  questionText = g('question-text');
  skipBtn = g('skip-btn');
}

/* ══════════════════════════════════════════════════════════════════════════
   BOOT
   ══════════════════════════════════════════════════════════════════════════ */
window.addEventListener('DOMContentLoaded', async () => {
  initDomRefs();
  if (sessionStorage.getItem('role') === 'admin') {
    window.location.href = 'admin.html'; return;
  }
  populateUser();
  startSessionTimer();
  await loadAllQuestions();
  await initCameraAndAutoRecord();
  initSpeechRecognition();   // sets up the browser recognition object
  bindEvents();
  showStartScreen();
});

function populateUser() {
  const name = sessionStorage.getItem('name') || 'Student';
  document.getElementById('user-name').textContent = name;
  document.getElementById('user-avatar').textContent = name[0].toUpperCase();
}

function startSessionTimer() {
  setInterval(() => {
    const s = Math.floor((Date.now() - sessionStart) / 1000);
    document.getElementById('session-timer').textContent =
      `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  }, 1000);
}

/* ══════════════════════════════════════════════════════════════════════════
   START SCREEN
   ══════════════════════════════════════════════════════════════════════════ */
function showStartScreen() {
  const overlay = document.getElementById('start-overlay');
  if (overlay) overlay.classList.remove('hidden');
}

/* ══════════════════════════════════════════════════════════════════════════
   BEGIN INTERVIEW – starts proctoring, camera, STT, diarization, timer
   ══════════════════════════════════════════════════════════════════════════ */
function beginInterview() {
  const overlay = document.getElementById('start-overlay');
  if (overlay) overlay.classList.add('hidden');
  interviewStarted = true;

  // Init proctoring
  proctor = new ProctoringSystem({
    maxWarnings: 5,
    noFaceTriggerDelay: 5,
    onWarning: handleProctoringWarning,
    onTerminate: handleProctoringTerminate,
    onEvent: handleProctoringEvent,
    onFaceAlert: (msg) => {
      if (msg.includes('✅') || msg.includes('OK')) {
        updateProctoringBadge('Active', 'ok');
        updateFaceStatusUI(1);
      } else if (msg.includes('MULTIPLE') || msg.includes('multiple') || msg.includes('people')) {
        updateProctoringBadge('⚠ Multiple faces', 'warn');
        updateFaceStatusUI(2);
        showToast('error', '👥 Multiple Faces Detected', 'Only YOU should be visible on camera.');
      } else if (msg.includes('No face') || msg.includes('no face') || msg.includes('missing')) {
        updateProctoringBadge('⚠ Face missing', 'warn');
        updateFaceStatusUI(0);
        showToast('warn', '😶 Face Not Detected', 'Please stay visible in the camera frame.');
      }
    },
    onNoFaceCountdown: (secondsLeft) => handleNoFaceCountdown(secondsLeft),
  });
  proctor.start();
  proctor.requestFullscreen();

  // Start face detection
  if (videoPreview) {
    const launchFaceDetection = () => {
      proctor.startFaceDetection(videoPreview);
      console.log('[Init] Face detection started');
    };
    if (videoPreview.srcObject && videoPreview.readyState >= 2) {
      launchFaceDetection();
    } else if (videoPreview.srcObject) {
      videoPreview.addEventListener('loadeddata', launchFaceDetection, { once: true });
    } else {
      const poll = setInterval(() => {
        if (videoPreview.srcObject) {
          clearInterval(poll);
          videoPreview.addEventListener('loadeddata', launchFaceDetection, { once: true });
          if (videoPreview.readyState >= 2) launchFaceDetection();
        }
      }, 300);
    }
  }

  // ========== START BROWSER SPEECH RECOGNITION ==========
  setTimeout(() => {
    try {
      startListening();
      console.log('[Init] Browser speech recognition started');
    } catch (err) {
      console.error('[Init] Failed to start speech recognition:', err);
      showToast('error', 'Speech Error', 'Could not start microphone. Please check permissions.');
    }
  }, 1000);

  // ========== START DIARIZATION (multiple speaker detection) ==========
  setTimeout(() => {
    try {
      startDiarization();
      console.log('[Init] Diarization started');
    } catch (err) {
      console.error('[Init] Failed to start diarization:', err);
    }
  }, 1500);

  // Start question timer
  startQuestionTimer();
  updateProctoringBadge('Active', 'ok');
}

/* ══════════════════════════════════════════════════════════════════════════
   PROCTORING HANDLERS (unchanged)
   ══════════════════════════════════════════════════════════════════════════ */
function handleProctoringWarning(warning) {
  showWarningModal(warning);
  updateProctoringBadge(`⚠ ${warning.count} violation(s)`, 'warn');
  addProctoringLog(warning.type);
}

function handleProctoringTerminate(info) {
  closeWarningModal();
  hideNoFaceBanner();
  const reason = info.type === 'no_face_prolonged'
    ? 'Exam flagged: You were absent from the camera for too long.'
    : (info.reason || 'Exceeded maximum violations');
  showTerminationModal(reason, info.type);
}

function handleProctoringEvent(event) {
  addProctoringLog(event.event);
}

function showWarningModal(warning) {
  const modal = document.getElementById('warning-modal');
  if (!modal) return;
  document.getElementById('warn-title').textContent = warningTitle(warning.type);
  document.getElementById('warn-body').textContent = warning.message || 'Suspicious activity detected.';
  document.getElementById('warn-count').textContent = `Warning ${warning.count} of ${warning.count + warning.remaining}`;
  document.getElementById('warn-remain').textContent = `${warning.remaining} remaining before exam is flagged`;
  modal.classList.remove('hidden');
  setTimeout(closeWarningModal, 6000);
}

function closeWarningModal() {
  const modal = document.getElementById('warning-modal');
  if (modal) modal.classList.add('hidden');
}

function showTerminationModal(reason, type) {
  const modal = document.getElementById('termination-modal');
  if (!modal) return;
  const isNoFace = type === 'no_face_prolonged';
  const iconEl = document.getElementById('term-icon');
  if (iconEl) iconEl.textContent = isNoFace ? '😶' : '🚫';
  document.getElementById('term-reason').textContent = reason;
  modal.classList.remove('hidden');
}

function handleNoFaceCountdown(secondsLeft) {
  if (secondsLeft === -1) {
    hideNoFaceBanner();
    return;
  }
  showNoFaceBanner(secondsLeft);
}

function showNoFaceBanner(secondsLeft) {
  let banner = document.getElementById('no-face-banner');
  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'no-face-banner';
    banner.style.cssText = `
      position: fixed;
      top: 0; left: 0; right: 0;
      z-index: 9999;
      background: linear-gradient(90deg, #ff4560, #c0000f);
      color: #fff;
      font-family: 'Syne', Arial, sans-serif;
      font-weight: 700;
      font-size: .95rem;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 1rem;
      padding: .75rem 1.5rem;
      box-shadow: 0 4px 24px rgba(255,69,96,.5);
      animation: bannerSlide .3s cubic-bezier(.4,0,.2,1);
    `;
    if (!document.getElementById('no-face-banner-style')) {
      const style = document.createElement('style');
      style.id = 'no-face-banner-style';
      style.textContent = `
        @keyframes bannerSlide {
          from { transform: translateY(-100%); opacity: 0; }
          to   { transform: translateY(0);    opacity: 1; }
        }
        @keyframes bannerPulse {
          0%,100% { box-shadow: 0 4px 24px rgba(255,69,96,.5); }
          50%     { box-shadow: 0 4px 40px rgba(255,69,96,.9); }
        }
        #no-face-banner { animation: bannerSlide .3s cubic-bezier(.4,0,.2,1), bannerPulse 1s ease infinite; }
      `;
      document.head.appendChild(style);
    }
    document.body.prepend(banner);
  }
  const urgent = secondsLeft <= 5;
  banner.innerHTML = `
    <span style="font-size:1.3rem">😶</span>
    <span>
      <strong>⚠ FACE NOT DETECTED</strong> — Return to camera immediately!
      Exam will be <strong>flagged</strong> in
      <span style="font-size:1.15rem; background:rgba(0,0,0,.25); padding:.1rem .55rem; border-radius:6px; ${urgent ? 'color:#ffeb3b;' : ''}">
        ${secondsLeft}s
      </span>
    </span>
    <span style="font-size:.78rem; opacity:.85;">Look at your camera now</span>
  `;
  banner.style.background = urgent
    ? 'linear-gradient(90deg, #b00020, #ff0033)'
    : 'linear-gradient(90deg, #ff4560, #c0000f)';
}

function hideNoFaceBanner() {
  const banner = document.getElementById('no-face-banner');
  if (!banner) return;
  banner.style.transition = 'transform .3s ease, opacity .3s ease';
  banner.style.transform = 'translateY(-100%)';
  banner.style.opacity = '0';
  setTimeout(() => banner.remove(), 320);
}

function warningTitle(type) {
  const map = {
    tab_switch: '🚨 Tab Switch Detected',
    window_blur: '⚠ Window Focus Lost',
    fullscreen_exit: '📺 Fullscreen Exited',
    copy_attempt: '⛔ Copy Blocked',
    devtools_attempt: '🔒 DevTools Blocked',
    print_attempt: '🖨 Print Blocked',
    right_click: '🖱 Right-Click Blocked',
    no_face_detected: '😶 Face Not Detected',
    multiple_faces_detected: '👥 Multiple Faces Detected',
    face_returned: '✅ Face Returned',
    multiple_speakers_detected: '👥 Multiple Speakers Detected',
  };
  return map[type] || '⚠ Violation Detected';
}

function addProctoringLog(eventType) {
  const log = document.getElementById('proctor-log');
  if (!log) return;
  const noEvents = log.querySelector('.no-events');
  if (noEvents) noEvents.remove();
  const chip = document.createElement('div');
  chip.className = 'proctor-chip';
  chip.textContent = eventType.replace(/_/g, ' ');
  log.appendChild(chip);
  log.scrollTop = log.scrollHeight;
  const count = log.querySelectorAll('.proctor-chip').length;
  const counter = document.getElementById('proctor-count');
  if (counter) counter.textContent = count;
}

function updateProctoringBadge(text, type) {
  const badge = document.getElementById('proctor-badge');
  if (!badge) return;
  badge.textContent = text;
  badge.className = `status-badge ${type}`;
}

function updateFaceStatusUI(count) {
  let indicator = document.getElementById('face-overlay-indicator');
  if (!indicator) {
    const container = document.querySelector('.video-container');
    if (!container) return;
    indicator = document.createElement('div');
    indicator.id = 'face-overlay-indicator';
    indicator.style.cssText = `
      position: absolute;
      bottom: .6rem; right: .6rem;
      display: flex; align-items: center; gap: .35rem;
      background: rgba(0,0,0,.72);
      padding: .25rem .65rem;
      border-radius: 20px;
      font-size: .72rem;
      font-weight: 600;
      pointer-events: none;
      z-index: 10;
      transition: all .3s;
    `;
    container.appendChild(indicator);
  }
  if (count === 0) {
    indicator.innerHTML = `<span style="width:8px;height:8px;border-radius:50%;background:#ff4560;display:inline-block;animation:pulse 1s infinite"></span><span style="color:#ff4560">No Face</span>`;
  } else if (count === 1) {
    indicator.innerHTML = `<span style="width:8px;height:8px;border-radius:50%;background:#00e5a0;display:inline-block"></span><span style="color:#00e5a0">Face OK</span>`;
  } else {
    indicator.innerHTML = `<span style="width:8px;height:8px;border-radius:50%;background:#ffc846;display:inline-block;animation:pulse 1s infinite"></span><span style="color:#ffc846">Multiple (${count})</span>`;
  }
}

/* ══════════════════════════════════════════════════════════════════════════
   QUESTION TIMER
   ══════════════════════════════════════════════════════════════════════════ */
function startQuestionTimer() {
  stopQuestionTimer();
  timerSeconds = QUESTION_TIME_LIMIT;
  updateTimerDisplay();
  timerInterval = setInterval(() => {
    timerSeconds--;
    updateTimerDisplay();
    if (timerSeconds <= 0) {
      stopQuestionTimer();
      autoSubmitOnTimeout();
    }
  }, 1000);
}

function stopQuestionTimer() {
  clearInterval(timerInterval);
  timerInterval = null;
}

function updateTimerDisplay() {
  const el = document.getElementById('timer-value');
  if (!el) return;
  const m = String(Math.floor(timerSeconds / 60)).padStart(2, '0');
  const s = String(timerSeconds % 60).padStart(2, '0');
  el.textContent = `${m}:${s}`;
  const wrap = document.getElementById('timer-display');
  if (!wrap) return;
  if (timerSeconds <= 30) wrap.className = 'timer-display timer-urgent';
  else if (timerSeconds <= 60) wrap.className = 'timer-display timer-warning';
  else wrap.className = 'timer-display';
}

async function autoSubmitOnTimeout() {
  if (!answerText || answerText.disabled) return;
  const text = answerText.value.trim();
  if (text) {
    showToast('warn', 'Time Up!', 'Auto-submitting your answer…');
    await submitAnswer();
  } else {
    showToast('warn', 'Time Up!', 'No answer — moving to next question.');
    bufferedAnswer('[No answer — timed out]');
    if (skipBtn) skipBtn.style.display = 'none';
    advanceToNext();
  }
}

/* ══════════════════════════════════════════════════════════════════════════
   QUESTIONS & PROGRESS
   ══════════════════════════════════════════════════════════════════════════ */
async function loadAllQuestions() {
  try {
    const res = await fetch(`${API}/questions/all`);
    const data = await res.json();
    const allQ = data.questions || [];
    const intro = allQ.find(q => q.id === 11);
    if (!intro) console.warn('Introduction question (id 11) not found');
    const easy = allQ.filter(q => q.difficulty === 'Easy' && q.id !== 11);
    const medium = allQ.filter(q => q.difficulty === 'Medium' && q.id !== 11);
    const hard = allQ.filter(q => q.difficulty === 'Hard' && q.id !== 11);
    const getRandom = (arr, count) => {
      if (arr.length === 0) return [];
      const shuffled = [...arr];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }
      return shuffled.slice(0, count);
    };
    const selectedEasy = getRandom(easy, 3);
    const selectedMedium = getRandom(medium, 3);
    const selectedHard = getRandom(hard, 3);
    let finalQuestions = [];
    if (intro) finalQuestions.push(intro);
    finalQuestions = finalQuestions.concat(selectedEasy, selectedMedium, selectedHard);
    if (finalQuestions.length === 0) throw new Error('No questions available');
    if (selectedEasy.length < 3) console.warn(`Only ${selectedEasy.length} easy questions available.`);
    if (selectedMedium.length < 3) console.warn(`Only ${selectedMedium.length} medium questions available.`);
    if (selectedHard.length < 3) console.warn(`Only ${selectedHard.length} hard questions available.`);
    allQuestions = finalQuestions;
  } catch (err) {
    console.error(err);
    if (questionText) questionText.textContent = '⚠ Could not load questions.';
    return;
  }
  buildProgressDots();
  showQuestion(0);
}

function buildProgressDots() {
  const c = document.getElementById('q-dots');
  if (!c) return;
  c.innerHTML = '';
  allQuestions.forEach((_, i) => {
    const d = document.createElement('div');
    d.className = 'q-dot' + (i === 0 ? ' current' : '');
    d.id = `qdot-${i}`;
    d.title = `Question ${i + 1}`;
    c.appendChild(d);
  });
}

function showQuestion(index) {
  currentIndex = index;
  currentQuestion = {
    id: allQuestions[index].id,
    text: allQuestions[index].text,
    category: allQuestions[index].category || 'General',
  };
  const q = allQuestions[index];
  if (questionText) questionText.textContent = q.text;
  const badge = document.getElementById('question-badge');
  if (badge) badge.innerHTML = `💡 ${q.category} · <span style="color:var(--text2);font-size:.65rem">${q.difficulty || 'Medium'}</span>`;
  const counter = document.getElementById('q-counter-label');
  if (counter) counter.textContent = `Question ${index + 1} of ${allQuestions.length}`;
  const fill = document.getElementById('progress-fill');
  if (fill) fill.style.width = `${(index / allQuestions.length) * 100}%`;
  allQuestions.forEach((_, i) => {
    const d = document.getElementById(`qdot-${i}`);
    if (d) d.className = 'q-dot' + (i < index ? ' done' : i === index ? ' current' : '');
  });
  if (answerText) { answerText.value = ''; answerText.disabled = false; }
  updateCharCount();
  if (skipBtn) skipBtn.style.display = 'inline-flex';
  if (submitBtn) {
    submitBtn.style.display = 'inline-flex';
    submitBtn.disabled = false;
    submitBtn.innerHTML = '<span>Submit Answer</span> <span>→</span>';
  }
  if (nextBtn) nextBtn.style.display = 'none';
  const banner = document.getElementById('submitted-banner');
  if (banner) banner.classList.remove('visible');
  if (isListening) stopListening();   // stop speech recognition when moving to next question
  if (interviewStarted) startQuestionTimer();
}

function advanceToNext() {
  if (currentIndex + 1 >= allQuestions.length) {
    showCompletion();
  } else {
    showQuestion(currentIndex + 1);
  }
}

async function showCompletion() {
  if (isListening) stopListening();   // stop browser STT
  stopDiarization();                  // stop diarization WebSocket
  stopQuestionTimer();
  if (proctor) proctor.stop();
  await stopAndUploadExamRecording();
  await sendProctoringEvents();
  await triggerEvaluation();
}

async function sendProctoringEvents() {
  if (!proctor) return;
  try {
    const fd = new FormData();
    fd.append('username', sessionStorage.getItem('username') || 'anonymous');
    fd.append('events_json', JSON.stringify(proctor.getEvents()));
    await fetch(`${API}/store-proctoring`, { method: 'POST', body: fd });
  } catch (e) {
    console.warn('Proctoring upload failed:', e);
  }
}

async function triggerEvaluation() {
  document.getElementById('interview-content').style.display = 'none';
  const evalScreen = document.getElementById('evaluation-screen');
  if (evalScreen) evalScreen.classList.add('visible');
  const username = sessionStorage.getItem('username') || 'anonymous';
  try {
    const fd = new FormData();
    fd.append('username', username);
    if (answeredBuffer.length) fd.append('answers_json', JSON.stringify(answeredBuffer));
    if (proctor) fd.append('events_json', JSON.stringify(proctor.getEvents()));
    const res = await fetch(`${API}/evaluate`, { method: 'POST', body: fd });
    const data = await res.json();
    if (res.ok && data.success) {
      setTimeout(() => { window.location.href = 'results.html'; }, 1000);
    } else {
      throw new Error(data.detail || 'Evaluation failed');
    }
  } catch (err) {
    console.error('Evaluation failed:', err);
    setTimeout(() => { window.location.href = 'results.html'; }, 2000);
  }
}

function bufferedAnswer(overrideAnswer) {
  answeredBuffer.push({
    question_id: currentQuestion.id,
    question_text: currentQuestion.text,
    category: currentQuestion.category,
    answer: overrideAnswer || (answerText ? answerText.value.trim() : ''),
  });
}

async function skipQuestion() {
  if (answerText.disabled) {
    showToast('warn', 'Already Submitted', 'You cannot skip after submitting.');
    return;
  }
  if (isListening) stopListening();
  stopQuestionTimer();
  bufferedAnswer('[Skipped by student]');
  advanceToNext();
}

/* ══════════════════════════════════════════════════════════════════════════
   EXAM RECORDING
   ══════════════════════════════════════════════════════════════════════════ */
async function initCameraAndAutoRecord() {
  try {
    examStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    videoPreview.srcObject = examStream;
    videoOverlay.classList.add('hidden');
    setStatus('status-camera', 'ok', 'Active');
    startExamRecording();
    return;
  } catch (_) { }
  try {
    const vid = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    videoPreview.srcObject = vid;
    videoOverlay.classList.add('hidden');
    setStatus('status-camera', 'ok', 'Video only');
    try {
      const aud = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      examStream = new MediaStream([...vid.getVideoTracks(), ...aud.getAudioTracks()]);
    } catch { examStream = vid; }
    startExamRecording();
    return;
  } catch (_) { }
  try {
    examStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    videoOverlay.classList.remove('hidden');
    videoOverlay.querySelector('.cam-icon').textContent = '🎙';
    videoOverlay.querySelector('span:last-child').textContent = 'Audio-only';
    setStatus('status-camera', 'warn', 'Audio only');
    startExamRecording();
    return;
  } catch (_) { }
  setStatus('status-camera', 'warn', 'Denied');
  setStatus('status-rec', 'warn', 'No Stream');
  showToast('error', 'Permission Denied', 'Allow Camera & Mic in browser settings.');
}

function startExamRecording() {
  if (!examStream || examRecording) return;
  examChunks = [];
  examBlob = null;
  examRecording = true;
  const mime = getSupportedMime();
  try { examRecorder = mime ? new MediaRecorder(examStream, { mimeType: mime }) : new MediaRecorder(examStream); }
  catch { examRecorder = new MediaRecorder(examStream); }
  examRecorder.ondataavailable = e => { if (e.data?.size > 0) examChunks.push(e.data); };
  examRecorder.onstop = () => { examBlob = new Blob(examChunks, { type: mime || 'video/webm' }); };
  examRecorder.start(500);
  recIndicator.classList.add('visible');
  setStatus('status-rec', 'warn', 'REC ●');
  examElapsed = 0;
  examTimer = setInterval(() => {
    examElapsed++;
    const m = String(Math.floor(examElapsed / 60)).padStart(2, '0');
    const s = String(examElapsed % 60).padStart(2, '0');
    if (recDuration) recDuration.textContent = `${m}:${s}`;
  }, 1000);
}

async function stopAndUploadExamRecording() {
  if (!examRecording || !examRecorder) return;
  await new Promise(resolve => {
    examRecorder.onstop = () => {
      examBlob = new Blob(examChunks, { type: getSupportedMime() || 'video/webm' });
      resolve();
    };
    try { examRecorder.stop(); } catch { resolve(); }
  });
  examRecording = false;
  clearInterval(examTimer);
  recIndicator.classList.remove('visible');
  setStatus('status-rec', 'ok', 'Uploading…');
  if (!examBlob || examBlob.size === 0) { setStatus('status-rec', 'warn', 'No data'); return; }
  try {
    const username = sessionStorage.getItem('username') || 'anonymous';
    const ext = (getSupportedMime() || '').includes('mp4') ? 'mp4' : 'webm';
    const fd = new FormData();
    fd.append('username', username);
    fd.append('duration', String(examElapsed));
    fd.append('video', examBlob, `exam_${username}.${ext}`);
    const res = await fetch(`${API}/submit/exam-recording`, { method: 'POST', body: fd });
    const data = await res.json();
    if (res.ok) setStatus('status-rec', 'ok', 'Uploaded ✓');
    else throw new Error(data.detail);
  } catch (err) {
    console.error('Exam upload failed:', err);
    setStatus('status-rec', 'warn', 'Upload failed');
  }
}

function getSupportedMime() {
  for (const t of ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'])
    if (MediaRecorder.isTypeSupported(t)) return t;
  return '';
}

/* ══════════════════════════════════════════════════════════════════════════
   BROWSER SPEECH RECOGNITION (Web Speech API)
   ══════════════════════════════════════════════════════════════════════════ */
function initSpeechRecognition() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) {
    setStatus('status-speech', 'warn', 'Unsupported');
    setStatus('status-mic', 'warn', 'Use Chrome');
    if (micBtn) { micBtn.disabled = true; micBtn.style.opacity = '.4'; }
    if (micStatus) micStatus.textContent = '⚠ Use Google Chrome for voice input';
    return;
  }
  setStatus('status-speech', 'ok', 'Ready');
  setStatus('status-mic', 'ok', 'Ready');

  recognition = new SR();
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.lang = 'en-US';

  recognition.onstart = () => {
    textBeforeSession = answerText.value;
    sessionFinals = '';
    micBtn.classList.add('listening');
    micBtn.textContent = '⏹';
    micStatus.textContent = 'Listening… speak now';
    micStatus.classList.add('listening');
    waveform.classList.add('active');
    setStatus('status-mic', 'ok', 'Active');
    setStatus('status-speech', 'ok', 'Listening');
  };

  recognition.onresult = event => {
    let interim = '';
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const t = event.results[i][0].transcript;
      if (event.results[i].isFinal) { sessionFinals += (sessionFinals ? ' ' : '') + t.trim(); interim = ''; }
      else interim += t;
    }
    const sep1 = textBeforeSession && (sessionFinals || interim) ? ' ' : '';
    const sep2 = sessionFinals && interim ? ' ' : '';
    answerText.value = textBeforeSession + sep1 + sessionFinals + sep2 + interim;
    updateCharCount();
    if (interim) micStatus.textContent = `🎙 "${interim}"`;
    else if (sessionFinals) micStatus.textContent = 'Listening… keep speaking';
  };

  recognition.onerror = event => {
    if (event.error === 'no-speech') { micStatus.textContent = 'No speech — still listening…'; return; }
    if (event.error === 'aborted') return;
    if (event.error === 'not-allowed') {
      stopListening();
      setStatus('status-mic', 'warn', 'Denied');
      showToast('error', 'Mic Blocked', 'Allow Microphone in browser settings.');
    }
  };

  recognition.onend = () => {
    if (!isListening) return;
    clearTimeout(restartTimer);
    restartTimer = setTimeout(() => {
      if (!isListening) return;
      textBeforeSession = answerText.value;
      sessionFinals = '';
      try { recognition.start(); } catch (_) { }
    }, 300);
  };
}

function toggleMic() { isListening ? stopListening() : startListening(); }

function startListening() {
  if (!recognition) { showToast('error', 'Not Available', 'Use Google Chrome.'); return; }
  if (isListening) return;
  isListening = true;
  clearTimeout(restartTimer);
  try { recognition.start(); } catch (_) { }
}

function stopListening() {
  if (!recognition) return;
  isListening = false;
  clearTimeout(restartTimer);
  try { recognition.stop(); } catch (_) { }
  if (micBtn) { micBtn.classList.remove('listening'); micBtn.textContent = '🎤'; }
  if (micStatus) { micStatus.textContent = 'Click 🎤 to start voice input'; micStatus.classList.remove('listening'); }
  waveform.classList.remove('active');
  setStatus('status-speech', 'ok', 'Ready');
  setStatus('status-mic', 'ok', 'Ready');
}

/* ══════════════════════════════════════════════════════════════════════════
   SUBMIT ANSWER
   ══════════════════════════════════════════════════════════════════════════ */
async function submitAnswer() {
  const text = answerText.value.trim();
  if (!text) { showToast('error', 'Empty Answer', 'Please type or speak an answer.'); return; }
  if (!currentQuestion.id) { showToast('error', 'No Question', 'Question not loaded.'); return; }
  if (isListening) stopListening();

  submitBtn.disabled = true;
  submitBtn.innerHTML = '<span>Submitting…</span>';
  try {
    const fd = new FormData();
    fd.append('answer', text);
    fd.append('username', sessionStorage.getItem('username') || 'anonymous');
    fd.append('question_id', String(currentQuestion.id));
    fd.append('question_text', currentQuestion.text);
    fd.append('question_category', currentQuestion.category);
    const res = await fetch(`${API}/submit`, { method: 'POST', body: fd });
    const data = await res.json();
    if (res.ok) {
      answeredCount++;
      bufferedAnswer(text);
      const banner = document.getElementById('submitted-banner');
      if (banner) banner.classList.add('visible');
      answerText.disabled = true;
      stopQuestionTimer();
      submitBtn.style.display = 'none';
      nextBtn.style.display = 'inline-flex';
      const isLast = currentIndex === allQuestions.length - 1;
      nextBtn.innerHTML = isLast
        ? '<span>Finish & Get Results 🎉</span>'
        : `<span>Next (${currentIndex + 2}/${allQuestions.length})</span> <span>→</span>`;
      setStatus('status-answer', 'ok', 'Submitted');
      showToast('success', 'Submitted!', 'Answer saved.');
    } else {
      showToast('error', 'Failed', data.detail || 'Submission error.');
      submitBtn.disabled = false;
      submitBtn.innerHTML = '<span>Submit Answer</span> <span>→</span>';
    }
  } catch {
    showToast('error', 'Network Error', 'Cannot reach backend on port 7000.');
    submitBtn.disabled = false;
    submitBtn.innerHTML = '<span>Submit Answer</span> <span>→</span>';
  }
}

/* ── Helpers ─────────────────────────────────────────────────────────────── */
function updateCharCount() {
  const len = answerText ? answerText.value.length : 0;
  if (charCount) charCount.textContent = len;
  setStatus('status-answer', len > 0 ? 'ok' : 'off', len > 0 ? `${len} chars` : 'Empty');
}

function setStatus(id, type, label) {
  const el = document.getElementById(id);
  if (!el) return;
  el.className = `status-badge ${type}`;
  el.textContent = label;
}

function showToast(type, title, message) {
  const t = document.createElement('div');
  t.className = `toast ${type === 'warn' ? 'error' : type}`;
  t.innerHTML = `<span class="toast-icon">${type === 'success' ? '✅' : '⚠️'}</span>
    <div class="toast-body"><div class="toast-title">${title}</div><div>${message}</div></div>`;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 5000);
}

async function logout() {
  if (isListening) stopListening();
  if (proctor) proctor.stop();
  if (examRecording) {
    showToast('warn', 'Saving recording…', 'Please wait.');
    await stopAndUploadExamRecording();
  }
  stopDiarization();
  sessionStorage.clear();
  window.location.href = 'login.html';
}

function bindEvents() {
  if (micBtn) micBtn.addEventListener('click', toggleMic);
  if (submitBtn) submitBtn.addEventListener('click', submitAnswer);
  if (nextBtn) nextBtn.addEventListener('click', advanceToNext);
  if (skipBtn) skipBtn.addEventListener('click', skipQuestion);
  if (clearBtn) clearBtn.addEventListener('click', () => {
    if (answerText && !answerText.disabled) {
      answerText.value = '';
      textBeforeSession = '';
      sessionFinals = '';
      updateCharCount();
    }
  });
  if (answerText) answerText.addEventListener('input', updateCharCount);
  const beginBtn = document.getElementById('begin-interview-btn');
  if (beginBtn) beginBtn.addEventListener('click', beginInterview);
}

/* ══════════════════════════════════════════════════════════════════════════
   DIARIZATION (multiple speaker detection) – uses diart backend
   ══════════════════════════════════════════════════════════════════════════ */
async function startDiarization() {
  const username = sessionStorage.getItem('username');
  if (!username) {
    console.warn('[DIAR] No username, cannot start diarization');
    return;
  }
  const diarWsProto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  diarizationSocket = new WebSocket(`${diarWsProto}//${window.location.host}/ws/diarize`);
  diarizationSocket.onopen = () => {
    console.log('[DIAR] WebSocket opened');
    diarizationSocket.send(JSON.stringify({ username: username }));
    navigator.mediaDevices.getUserMedia({ audio: true })
      .then(stream => {
        mediaStreamForDiarization = stream;
        audioContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
        const source = audioContext.createMediaStreamSource(stream);
        const processor = audioContext.createScriptProcessor(4096, 1, 1);
        processor.onaudioprocess = (event) => {
          if (diarizationSocket.readyState !== WebSocket.OPEN) return;
          const inputData = event.inputBuffer.getChannelData(0);
          const pcm = new Int16Array(inputData.length);
          for (let i = 0; i < inputData.length; i++) {
            const s = Math.max(-1, Math.min(1, inputData[i]));
            pcm[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
          }
          diarizationSocket.send(pcm.buffer);
        };
        source.connect(processor);
        // processor.connect(audioContext.destination);
        console.log('[DIAR] Audio capture started');
      })
      .catch(err => console.error('[DIAR] Microphone error:', err));
  };
  diarizationSocket.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      if (data.speaker && data.speaker !== 'SPEAKER_00' && window.proctor) {
        window.proctor.warn('multiple_speakers_detected', `Speaker: ${data.speaker}`);
      }
    } catch (e) { }
  };
  diarizationSocket.onerror = (err) => console.error('[DIAR] WebSocket error', err);
  diarizationSocket.onclose = () => {
    console.log('[DIAR] WebSocket closed');
    if (audioContext) audioContext.close();
    if (mediaStreamForDiarization) mediaStreamForDiarization.getTracks().forEach(t => t.stop());
  };
}

function stopDiarization() {
  if (diarizationSocket && diarizationSocket.readyState === WebSocket.OPEN) {
    diarizationSocket.close();
  }
}