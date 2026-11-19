/**
 * Self-Hosted AI Interviewer Bot — Virtual On-Screen Question Display & MediaStream Hook.
 *
 * Injected via Playwright `addInitScript` BEFORE page scripts execute.
 * - Renders a 1280x720 HD Question Card with live ticking countdown timer on an offscreen HTML5 Canvas.
 * - Intercepts `navigator.mediaDevices.getUserMedia` and `getDisplayMedia` so Zoom Web, Google Meet,
 *   and Microsoft Teams receive the live Canvas stream as the bot's real camera / screen-share feed.
 * - Cross-platform: requires ZERO virtual webcam drivers (no OBS, no v4l2loopback).
 */
(() => {
  if (window.__AI_INTERVIEWER_DISPLAY__) return;

  const WIDTH = 1280;
  const HEIGHT = 720;
  const FPS = 15;

  const state = {
    mode: "welcome", // "welcome" | "question" | "transition" | "completed"
    brandTitle: "Eklakhya Interview Panel",
    candidateName: "Candidate",
    topic: "Technical Assessment",
    questionIndex: 0,
    totalQuestions: 10,
    questionText: "Welcome! Your Technical Interview is about to begin.",
    subtitle: "Speak clearly into your microphone. Use chat commands to navigate.",
    statusText: "Initializing interview session...",
    transitionIcon: "✅",
    transitionColor: "#10b981",
    timeLimitSec: 300,
    deadlineMs: 0,
    pausedRemainingSec: null,
    finalScore: null,
  };

  let canvas = null;
  let ctx = null;
  let masterVideoStream = null;
  let silentAudioStream = null;
  let renderTimer = null;
  let frameCount = 0;

  function ensureCanvas() {
    if (canvas && ctx) return true;
    if (typeof document === "undefined") return false;
    canvas = document.createElement("canvas");
    canvas.width = WIDTH;
    canvas.height = HEIGHT;
    ctx = canvas.getContext("2d", { alpha: false });
    startRenderLoop();
    return true;
  }

  function getSilentAudioTrack() {
    try {
      if (!silentAudioStream) {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        const ac = new AudioCtx();
        ac.__AI_BOT_INTERNAL_CTX__ = true;
        const osc = ac.createOscillator();
        const gain = ac.createGain();
        gain.gain.value = 0.00001; // Virtually silent keep-alive signal
        osc.connect(gain);
        const dest = ac.createMediaStreamDestination();
        gain.connect(dest);
        osc.start();
        silentAudioStream = dest.stream;
      }
      const track = silentAudioStream.getAudioTracks()[0];
      return track ? track.clone() : null;
    } catch (e) {
      return null;
    }
  }

  function getCanvasVideoTrack() {
    ensureCanvas();
    if (!canvas) return null;
    // Draw at least one frame before capturing
    renderFrame();
    if (!masterVideoStream) {
      masterVideoStream = canvas.captureStream(FPS);
    }
    const track = masterVideoStream.getVideoTracks()[0];
    if (!track) return null;
    const cloned = track.clone();
    // Spoof track settings so WebRTC clients recognize 1280x720@15fps cleanly
    const origGetSettings = cloned.getSettings ? cloned.getSettings.bind(cloned) : () => ({});
    cloned.getSettings = () => ({
      ...origGetSettings(),
      width: WIDTH,
      height: HEIGHT,
      frameRate: FPS,
      deviceId: "ai-interviewer-virtual-cam",
    });
    return cloned;
  }

  function drawRoundedRect(c, x, y, w, h, r) {
    const radius = Math.min(r, w / 2, h / 2);
    c.beginPath();
    c.moveTo(x + radius, y);
    c.arcTo(x + w, y, x + w, y + h, radius);
    c.arcTo(x + w, y + h, x, y + h, radius);
    c.arcTo(x, y + h, x, y, radius);
    c.arcTo(x, y, x + w, y, radius);
    c.closePath();
  }

  function wrapLines(c, text, maxWidth) {
    const paragraphs = String(text || "").split("\n");
    const lines = [];
    for (const para of paragraphs) {
      if (!para.trim()) {
        lines.push("");
        continue;
      }
      const words = para.split(/\s+/);
      let current = "";
      for (const word of words) {
        const test = current ? current + " " + word : word;
        if (c.measureText(test).width <= maxWidth) {
          current = test;
        } else {
          if (current) lines.push(current);
          // Break ultra-long tokens if needed
          if (c.measureText(word).width > maxWidth) {
            let chunk = "";
            for (const ch of word) {
              if (c.measureText(chunk + ch).width > maxWidth) {
                lines.push(chunk);
                chunk = ch;
              } else {
                chunk += ch;
              }
            }
            current = chunk;
          } else {
            current = word;
          }
        }
      }
      if (current) lines.push(current);
    }
    return lines;
  }

  function formatTime(sec) {
    const clamped = Math.max(0, Math.ceil(sec));
    const m = Math.floor(clamped / 60);
    const s = clamped % 60;
    return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }

  function getRemainingSec() {
    if (state.pausedRemainingSec !== null && state.pausedRemainingSec !== undefined) {
      return Math.max(0, state.pausedRemainingSec);
    }
    if (!state.deadlineMs) return state.timeLimitSec;
    return Math.max(0, (state.deadlineMs - Date.now()) / 1000);
  }

  function renderFrame() {
    if (!ctx) return;
    frameCount++;

    // 1. Background gradient
    const bg = ctx.createLinearGradient(0, 0, WIDTH, HEIGHT);
    bg.addColorStop(0, "#090e1a");
    bg.addColorStop(0.55, "#0f172a");
    bg.addColorStop(1, "#131c33");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);

    // Subtle decorative ambient glows
    const glow1 = ctx.createRadialGradient(200, 120, 20, 200, 120, 420);
    glow1.addColorStop(0, "rgba(79, 70, 229, 0.16)");
    glow1.addColorStop(1, "rgba(79, 70, 229, 0)");
    ctx.fillStyle = glow1;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);

    const glow2 = ctx.createRadialGradient(WIDTH - 180, HEIGHT - 120, 20, WIDTH - 180, HEIGHT - 120, 380);
    glow2.addColorStop(0, "rgba(14, 165, 233, 0.14)");
    glow2.addColorStop(1, "rgba(14, 165, 233, 0)");
    ctx.fillStyle = glow2;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);

    // Safe-zone margins (important for Meet/Teams dynamic tile cropping)
    const PAD_X = 64;
    const PAD_Y = 44;

    // 2. Top Header Bar
    // Live pulsing dot
    const pulse = 0.55 + 0.45 * Math.sin(frameCount * 0.25);
    ctx.beginPath();
    ctx.arc(PAD_X + 10, PAD_Y + 18, 7, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(34, 197, 94, ${pulse.toFixed(2)})`;
    ctx.fill();

    // Brand Title
    ctx.font = "700 22px 'Segoe UI', Roboto, Arial, sans-serif";
    ctx.fillStyle = "#f8fafc";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(state.brandTitle, PAD_X + 28, PAD_Y + 18);

    // Candidate Name Pill
    ctx.font = "600 16px 'Segoe UI', Roboto, Arial, sans-serif";
    const candLabel = `Candidate: ${state.candidateName}`;
    ctx.fillStyle = "#94a3b8";
    ctx.fillText(candLabel, PAD_X + 28, PAD_Y + 46);

    // Right-side Topic + Question Progress Badges
    const qBadgeText =
      state.mode === "question"
        ? `QUESTION ${state.questionIndex + 1} OF ${state.totalQuestions}`
        : state.mode === "completed"
        ? "SESSION COMPLETE"
        : state.mode === "transition"
        ? "SAVING RESPONSE"
        : "READY TO START";

    ctx.font = "700 16px 'Segoe UI', Roboto, Arial, sans-serif";
    const qBadgeW = ctx.measureText(qBadgeText).width + 36;
    const qBadgeX = WIDTH - PAD_X - qBadgeW;
    drawRoundedRect(ctx, qBadgeX, PAD_Y + 4, qBadgeW, 38, 19);
    ctx.fillStyle = state.mode === "completed" ? "rgba(16, 185, 129, 0.2)" : "rgba(99, 102, 241, 0.22)";
    ctx.fill();
    ctx.strokeStyle = state.mode === "completed" ? "#10b981" : "#6366f1";
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.fillStyle = state.mode === "completed" ? "#34d399" : "#a5b4fc";
    ctx.textAlign = "center";
    ctx.fillText(qBadgeText, qBadgeX + qBadgeW / 2, PAD_Y + 23);

    // Topic pill to the left of Q badge
    if (state.topic) {
      const topicText = state.topic.toUpperCase().slice(0, 28);
      ctx.font = "600 14px 'Segoe UI', Roboto, Arial, sans-serif";
      const tBadgeW = ctx.measureText(topicText).width + 28;
      const tBadgeX = qBadgeX - tBadgeW - 14;
      drawRoundedRect(ctx, tBadgeX, PAD_Y + 6, tBadgeW, 34, 17);
      ctx.fillStyle = "rgba(30, 41, 59, 0.85)";
      ctx.fill();
      ctx.strokeStyle = "#334155";
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillStyle = "#38bdf8";
      ctx.fillText(topicText, tBadgeX + tBadgeW / 2, PAD_Y + 23);
    }

    // 3. Main Center Card
    const cardX = PAD_X;
    const cardY = 122;
    const cardW = WIDTH - PAD_X * 2;
    const cardH = 446;

    drawRoundedRect(ctx, cardX, cardY, cardW, cardH, 24);
    ctx.fillStyle = "rgba(15, 23, 42, 0.88)";
    ctx.fill();
    ctx.strokeStyle = "rgba(148, 163, 184, 0.22)";
    ctx.lineWidth = 2;
    ctx.stroke();

    // Accent strip on top of card
    ctx.save();
    drawRoundedRect(ctx, cardX, cardY, cardW, cardH, 24);
    ctx.clip();
    const stripGrad = ctx.createLinearGradient(cardX, cardY, cardX + cardW, cardY);
    if (state.mode === "completed") {
      stripGrad.addColorStop(0, "#10b981");
      stripGrad.addColorStop(1, "#06b6d4");
    } else if (state.mode === "transition") {
      stripGrad.addColorStop(0, state.transitionColor || "#10b981");
      stripGrad.addColorStop(1, "#38bdf8");
    } else {
      stripGrad.addColorStop(0, "#6366f1");
      stripGrad.addColorStop(0.5, "#38bdf8");
      stripGrad.addColorStop(1, "#818cf8");
    }
    ctx.fillStyle = stripGrad;
    ctx.fillRect(cardX, cardY, cardW, 6);
    ctx.restore();

    // Render Card Body based on mode
    if (state.mode === "question") {
      renderQuestionCardBody(cardX, cardY, cardW, cardH);
    } else if (state.mode === "transition") {
      renderTransitionCardBody(cardX, cardY, cardW, cardH);
    } else if (state.mode === "completed") {
      renderCompletedCardBody(cardX, cardY, cardW, cardH);
    } else {
      renderWelcomeCardBody(cardX, cardY, cardW, cardH);
    }

    // 4. Bottom Footer Bar (Listening indicator + Chat Commands)
    const footY = HEIGHT - 66;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";

    // Mini animated soundwave bars
    for (let i = 0; i < 4; i++) {
      const h = 8 + Math.abs(Math.sin(frameCount * 0.35 + i * 1.1)) * 16;
      ctx.fillStyle = "#38bdf8";
      drawRoundedRect(ctx, PAD_X + i * 8, footY - h / 2, 4, h, 2);
      ctx.fill();
    }

    ctx.font = "600 18px 'Segoe UI', Roboto, Arial, sans-serif";
    ctx.fillStyle = "#cbd5e1";
    ctx.fillText(state.statusText || "Listening to your microphone...", PAD_X + 44, footY);

    // Command Shortcuts on right
    const commands = [
      { cmd: "/submit", desc: "Next" },
      { cmd: "/skip", desc: "Skip" },
      { cmd: "/repeat", desc: "Repeat" },
      { cmd: "/end", desc: "Finish" },
    ];
    let curX = WIDTH - PAD_X;
    for (let i = commands.length - 1; i >= 0; i--) {
      const item = commands[i];
      ctx.font = "600 15px 'Segoe UI', Roboto, Arial, sans-serif";
      const descW = ctx.measureText(item.desc).width;
      ctx.font = "700 15px Consolas, monospace";
      const cmdW = ctx.measureText(item.cmd).width;
      const pillW = cmdW + descW + 30;
      curX -= pillW;

      drawRoundedRect(ctx, curX, footY - 17, pillW, 34, 8);
      ctx.fillStyle = "rgba(30, 41, 59, 0.9)";
      ctx.fill();
      ctx.strokeStyle = "rgba(71, 85, 105, 0.7)";
      ctx.lineWidth = 1;
      ctx.stroke();

      ctx.textAlign = "left";
      ctx.font = "700 15px Consolas, monospace";
      ctx.fillStyle = "#38bdf8";
      ctx.fillText(item.cmd, curX + 10, footY);

      ctx.font = "500 15px 'Segoe UI', Roboto, Arial, sans-serif";
      ctx.fillStyle = "#94a3b8";
      ctx.fillText(item.desc, curX + 18 + cmdW, footY);

      curX -= 10;
    }
  }

  function renderQuestionCardBody(cardX, cardY, cardW, cardH) {
    const innerPad = 52;
    const textMaxW = cardW - innerPad * 2;
    const qText = state.questionText || "";

    // Choose font size dynamically based on question length
    let fontSize = 38;
    let lineHeight = 52;
    if (qText.length > 180) {
      fontSize = 28;
      lineHeight = 40;
    } else if (qText.length > 110) {
      fontSize = 32;
      lineHeight = 45;
    }

    ctx.font = `700 ${fontSize}px 'Segoe UI', Roboto, Arial, sans-serif`;
    const lines = wrapLines(ctx, qText, textMaxW).slice(0, 6);

    // Center text vertically in upper 70% of card
    const textAreaTop = cardY + 46;
    const textAreaHeight = cardH - 165;
    const totalTextH = lines.length * lineHeight;
    let startY = textAreaTop + Math.max(0, (textAreaHeight - totalTextH) / 2) + lineHeight / 2;

    ctx.fillStyle = "#f8fafc";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    for (const line of lines) {
      ctx.fillText(line, cardX + innerPad, startY);
      startY += lineHeight;
    }

    // Bottom Timer + Progress Bar inside card
    const remaining = getRemainingSec();
    const total = Math.max(1, state.timeLimitSec || 300);
    const ratio = Math.max(0, Math.min(1, remaining / total));

    let timerColor = "#38bdf8";
    if (remaining <= 20) timerColor = "#ef4444";
    else if (remaining <= 60) timerColor = "#f59e0b";

    const barY = cardY + cardH - 72;
    const barW = cardW - innerPad * 2 - 190;

    // Timer Label
    ctx.font = "600 15px 'Segoe UI', Roboto, Arial, sans-serif";
    ctx.fillStyle = "#94a3b8";
    ctx.textAlign = "left";
    ctx.fillText("TIME REMAINING FOR THIS QUESTION", cardX + innerPad, barY - 22);

    // Progress bar track
    drawRoundedRect(ctx, cardX + innerPad, barY, barW, 14, 7);
    ctx.fillStyle = "#1e293b";
    ctx.fill();

    // Progress bar fill
    if (ratio > 0.01) {
      drawRoundedRect(ctx, cardX + innerPad, barY, Math.max(14, barW * ratio), 14, 7);
      ctx.fillStyle = timerColor;
      ctx.fill();
    }

    // Digital countdown clock on right
    const clockBoxX = cardX + cardW - innerPad - 165;
    drawRoundedRect(ctx, clockBoxX, barY - 34, 165, 58, 14);
    ctx.fillStyle = "rgba(15, 23, 42, 0.95)";
    ctx.fill();
    ctx.strokeStyle = timerColor;
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.font = "700 32px Consolas, 'Courier New', monospace";
    ctx.fillStyle = timerColor;
    ctx.textAlign = "center";
    ctx.fillText(formatTime(remaining), clockBoxX + 82.5, barY - 4);
  }

  function renderWelcomeCardBody(cardX, cardY, cardW, cardH) {
    const cx = cardX + cardW / 2;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    ctx.font = "700 44px 'Segoe UI', Roboto, Arial, sans-serif";
    ctx.fillStyle = "#f8fafc";
    ctx.fillText(`Welcome, ${state.candidateName}!`, cx, cardY + 130);

    ctx.font = "500 24px 'Segoe UI', Roboto, Arial, sans-serif";
    ctx.fillStyle = "#94a3b8";
    ctx.fillText(
      `Your Technical Interview (${state.totalQuestions} Questions) is starting shortly.`,
      cx,
      cardY + 195
    );

    // Instruction box
    const boxW = cardW - 180;
    const boxX = cardX + 90;
    const boxY = cardY + 250;
    drawRoundedRect(ctx, boxX, boxY, boxW, 130, 16);
    ctx.fillStyle = "rgba(30, 41, 59, 0.7)";
    ctx.fill();
    ctx.strokeStyle = "rgba(99, 102, 241, 0.35)";
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.font = "600 20px 'Segoe UI', Roboto, Arial, sans-serif";
    ctx.fillStyle = "#e2e8f0";
    ctx.fillText("1. Read each question shown here & in the meeting chat", cx, boxY + 34);
    ctx.fillText("2. Speak your answer clearly into your microphone", cx, boxY + 68);
    ctx.fillText("3. Type /submit in chat when done (or wait for timer)", cx, boxY + 102);
  }

  function renderTransitionCardBody(cardX, cardY, cardW, cardH) {
    const cx = cardX + cardW / 2;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    ctx.font = "700 64px 'Segoe UI Emoji', 'Segoe UI', sans-serif";
    ctx.fillStyle = state.transitionColor || "#10b981";
    ctx.fillText(state.transitionIcon || "✅", cx, cardY + 150);

    ctx.font = "700 38px 'Segoe UI', Roboto, Arial, sans-serif";
    ctx.fillStyle = "#f8fafc";
    ctx.fillText(state.questionText || "Answer Recorded!", cx, cardY + 235);

    ctx.font = "500 22px 'Segoe UI', Roboto, Arial, sans-serif";
    ctx.fillStyle = "#94a3b8";
    ctx.fillText(state.subtitle || "Loading next question...", cx, cardY + 295);
  }

  function renderCompletedCardBody(cardX, cardY, cardW, cardH) {
    const cx = cardX + cardW / 2;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    ctx.font = "700 58px 'Segoe UI Emoji', 'Segoe UI', sans-serif";
    ctx.fillText("🎉", cx, cardY + 125);

    ctx.font = "700 42px 'Segoe UI', Roboto, Arial, sans-serif";
    ctx.fillStyle = "#34d399";
    ctx.fillText("Interview Completed!", cx, cardY + 205);

    ctx.font = "500 23px 'Segoe UI', Roboto, Arial, sans-serif";
    ctx.fillStyle = "#cbd5e1";
    ctx.fillText(
      `Thank you, ${state.candidateName}. All responses have been captured.`,
      cx,
      cardY + 265
    );

    if (state.finalScore !== null && state.finalScore !== undefined) {
      const scoreLabel = `Score: ${state.finalScore}`;
      ctx.font = "700 28px 'Segoe UI', Roboto, Arial, sans-serif";
      const pillW = Math.max(320, ctx.measureText(scoreLabel).width + 68);
      drawRoundedRect(ctx, cx - pillW / 2, cardY + 310, pillW, 68, 16);
      ctx.fillStyle = "rgba(16, 185, 129, 0.16)";
      ctx.fill();
      ctx.strokeStyle = "#10b981";
      ctx.lineWidth = 2;
      ctx.stroke();

      ctx.fillStyle = "#34d399";
      ctx.fillText(scoreLabel, cx, cardY + 344);
    } else {
      ctx.font = "500 20px 'Segoe UI', Roboto, Arial, sans-serif";
      ctx.fillStyle = "#94a3b8";
      ctx.fillText(
        "Your AI Evaluation Report is being generated and sent to your dashboard.",
        cx,
        cardY + 335
      );
    }
  }

  function startRenderLoop() {
    if (renderTimer) return;
    renderFrame();
    renderTimer = setInterval(renderFrame, Math.round(1000 / FPS));
  }

  // =========================================================================
  // Hook navigator.mediaDevices so meeting platforms pick up our virtual feed.
  // CRITICAL: We DO NOT intercept on Google Accounts/authentication pages so that
  // real webcam face verification, 2FA, passkeys, and normal sign-in work seamlessly.
  // =========================================================================
  function isMeetingPlatform() {
    try {
      if (window.__AI_USE_REAL_CAMERA__ === true) return false;
      const host = (window.location && window.location.hostname) ? window.location.hostname.toLowerCase() : "";
      const path = (window.location && window.location.pathname) ? window.location.pathname.toLowerCase() : "";

      // Explicitly bypass on ANY authentication, login, account, or verification page
      if (
        host.includes("accounts.google") ||
        host.includes("myaccount.google") ||
        host.includes("identity.google") ||
        host.includes("passkeys.google") ||
        path.includes("/signin") ||
        path.includes("/challenge") ||
        path.includes("/v3/signin") ||
        path.includes("/identifier") ||
        path.includes("/verify") ||
        path.includes("/speedbump")
      ) {
        return false;
      }

      // Intercept only on known meeting platforms or local test servers (empty host for mock set_content)
      if (
        host === "" ||
        host === "about:blank" ||
        host.includes("meet.google.com") ||
        host.includes("zoom.us") ||
        host.includes("teams.microsoft.com") ||
        host.includes("teams.live.com") ||
        host.includes("localhost") ||
        host === "127.0.0.1"
      ) {
        return true;
      }

      return false;
    } catch (e) {
      return true;
    }
  }

  function installMediaHooks() {
    if (!navigator.mediaDevices) {
      try {
        Object.defineProperty(navigator, "mediaDevices", {
          value: {},
          configurable: true,
        });
      } catch (e) {
        return;
      }
    }

    const md = navigator.mediaDevices;
    const origGetUserMedia = (md && typeof md.getUserMedia === "function") ? md.getUserMedia.bind(md) : null;
    const origGetDisplayMedia = (md && typeof md.getDisplayMedia === "function") ? md.getDisplayMedia.bind(md) : null;
    const origEnumerate = (md && typeof md.enumerateDevices === "function") ? md.enumerateDevices.bind(md) : null;

    md.getUserMedia = async (constraints = {}) => {
      if (!isMeetingPlatform()) {
        if (origGetUserMedia) {
          return await origGetUserMedia(constraints);
        }
        throw new Error("Physical camera not available on non-meeting domain");
      }
      const tracks = [];
      if (constraints.video) {
        const vt = getCanvasVideoTrack();
        if (vt) tracks.push(vt);
      }
      if (constraints.audio) {
        const at = getSilentAudioTrack();
        if (at) tracks.push(at);
      }
      if (tracks.length === 0) {
        const vt = getCanvasVideoTrack();
        if (vt) tracks.push(vt);
      }
      return new MediaStream(tracks);
    };

    md.getDisplayMedia = async (options) => {
      if (!isMeetingPlatform() && origGetDisplayMedia) {
        return await origGetDisplayMedia(options);
      }
      const tracks = [];
      const vt = getCanvasVideoTrack();
      if (vt) tracks.push(vt);
      return new MediaStream(tracks);
    };

    md.enumerateDevices = async () => {
      if (!isMeetingPlatform() && origEnumerate) {
        return await origEnumerate();
      }
      let existing = [];
      try {
        if (origEnumerate) existing = await origEnumerate();
      } catch (e) {
        existing = [];
      }
      const hasCam = existing.some((d) => d.kind === "videoinput");
      const hasMic = existing.some((d) => d.kind === "audioinput");
      const result = [...existing];
      if (!hasCam) {
        result.push({
          deviceId: "ai-interviewer-virtual-cam",
          groupId: "ai-interviewer-group",
          kind: "videoinput",
          label: "AI Interviewer Display Camera",
          toJSON() {
            return this;
          },
        });
      }
      if (!hasMic) {
        result.push({
          deviceId: "ai-interviewer-virtual-mic",
          groupId: "ai-interviewer-group",
          kind: "audioinput",
          label: "AI Interviewer Virtual Mic",
          toJSON() {
            return this;
          },
        });
      }
      return result;
    };
  }

  installMediaHooks();

  // Public control API called from Python via Playwright page.evaluate(...)
  window.__AI_INTERVIEWER_DISPLAY__ = {
    useRealCamera(enable = true) {
      window.__AI_USE_REAL_CAMERA__ = !!enable;
      return { ok: true, usingRealCamera: window.__AI_USE_REAL_CAMERA__ };
    },
    update(patch = {}) {
      Object.assign(state, patch);
      if (typeof patch.timeLimitSec === "number" && patch.resetTimer) {
        state.deadlineMs = Date.now() + patch.timeLimitSec * 1000;
        state.pausedRemainingSec = null;
      }
      ensureCanvas();
      renderFrame();
      return { ok: true, mode: state.mode, questionIndex: state.questionIndex };
    },
    getState() {
      return { ...state, remainingSec: getRemainingSec(), frameCount };
    },
    snapshotDataUrl() {
      ensureCanvas();
      renderFrame();
      return canvas ? canvas.toDataURL("image/png") : null;
    },
  };
})();
