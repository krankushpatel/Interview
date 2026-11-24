"""Playwright Browser Worker for the Self-Hosted AI Interviewer Bot.

Manages:
- Chromium/Chrome launch with media-stream and anti-automation flags.
- Automatic injection of `canvas_renderer.js` (1280x720 virtual Question Card stream)
  and `audio_tap.js` (WebRTC incoming audio interceptor + per-question recorder).
- High-level Python API to update the on-screen display and record per-question audio files.
"""
from __future__ import annotations

import asyncio
import base64
import logging
import time
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, Optional

from playwright.async_api import Browser, BrowserContext, Page, Playwright, async_playwright

from .config import SelfHostedBotConfig, load_bot_config

log = logging.getLogger("self_hosted_bot.browser_worker")

_INJECTED_DIR = Path(__file__).resolve().parent / "injected"


class BrowserWorker:
    def __init__(
        self,
        config: Optional[SelfHostedBotConfig] = None,
        username: Optional[str] = None,
    ) -> None:
        self.config = config or load_bot_config()
        self.username = username
        self._pw: Optional[Playwright] = None
        self._browser: Optional[Browser] = None
        self._context: Optional[BrowserContext] = None
        self.page: Optional[Page] = None
        self._camera_callback_registered: bool = False
        self._video_chunk_callback_registered: bool = False
        self._active_video_target: Optional[Path] = None
        self._active_video_size: int = 0
        self._cdp_session = None
        self._screencast_active: bool = False
        self._screencast_task: Optional[asyncio.Task] = None
        self._last_screencast_frame_ts: float = 0.0

    def _build_launch_args(self) -> list[str]:
        return [
            "--use-fake-ui-for-media-stream",
            "--autoplay-policy=no-user-gesture-required",
            "--disable-blink-features=AutomationControlled",
            "--disable-infobars",
            "--no-sandbox",
            "--disable-dev-shm-usage",
            "--window-size=1280,720",
            "--disable-background-timer-throttling",
            "--disable-backgrounding-occluded-windows",
            "--disable-renderer-backgrounding",
        ]

    async def start(self) -> Page:
        """Launch browser, inject virtual camera & audio tap scripts, and open a clean page."""
        if self.page:
            return self.page

        self._pw = await async_playwright().start()
        args = self._build_launch_args()

        canvas_js = (_INJECTED_DIR / "canvas_renderer.js").read_text(encoding="utf-8")
        audio_js = (_INJECTED_DIR / "audio_tap.js").read_text(encoding="utf-8")
        video_tap_path = _INJECTED_DIR / "candidate_video_tap.js"
        video_js = video_tap_path.read_text(encoding="utf-8") if video_tap_path.exists() else ""

        channels_to_try = []
        if self.config.browser_channel and self.config.browser_channel != "chromium":
            channels_to_try.append(self.config.browser_channel)
        for fallback in ("chrome", "msedge", None):
            if fallback not in channels_to_try:
                channels_to_try.append(fallback)

        last_err: Optional[Exception] = None
        for channel in channels_to_try:
            try:
                launch_kwargs: Dict[str, Any] = {
                    "headless": self.config.headless,
                    "args": args,
                    "ignore_default_args": ["--mute-audio"],
                }
                if channel:
                    launch_kwargs["channel"] = channel

                if self.config.use_persistent_profile:
                    self._context = await self._pw.chromium.launch_persistent_context(
                        user_data_dir=str(self.config.profile_dir),
                        viewport={"width": 1280, "height": 720},
                        permissions=["camera", "microphone"],
                        **launch_kwargs,
                    )
                    self._browser = self._context.browser
                else:
                    self._browser = await self._pw.chromium.launch(**launch_kwargs)
                    self._context = await self._browser.new_context(
                        viewport={"width": 1280, "height": 720},
                        permissions=["camera", "microphone"],
                        user_agent=(
                            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                            "AppleWebKit/537.36 (KHTML, like Gecko) "
                            "Chrome/131.0.0.0 Safari/537.36"
                        ),
                    )

                log.info("[BrowserWorker] Launched Chromium successfully (channel=%s, headless=%s)",
                         channel or "bundled", self.config.headless)
                break
            except Exception as exc:
                last_err = exc
                log.warning("[BrowserWorker] Failed channel=%s: %s", channel or "bundled", exc)

        if not self._context:
            await self.stop()
            raise RuntimeError(f"Could not launch any Chromium browser: {last_err}")

        # Inject scripts BEFORE any meeting page loads
        await self._context.add_init_script(canvas_js)
        await self._context.add_init_script(audio_js)
        if video_js:
            await self._context.add_init_script(video_js)

        if self._context.pages:
            self.page = self._context.pages[0]
        else:
            self.page = await self._context.new_page()

        await self._register_live_camera_callback()
        await self._register_video_chunk_callback()

        return self.page

    async def _register_video_chunk_callback(self) -> None:
        """Register page binding for real-time candidate video recording chunk streaming to disk."""
        if not self.page or self._video_chunk_callback_registered:
            return

        async def _on_candidate_video_chunk(chunk_b64: str):
            if chunk_b64 and self._active_video_target:
                try:
                    data = base64.b64decode(chunk_b64)
                    if data:
                        with open(self._active_video_target, "ab") as f:
                            f.write(data)
                        self._active_video_size += len(data)
                except Exception as e:
                    log.debug("[BrowserWorker] Error writing video chunk: %s", e)

        try:
            await self.page.expose_function("__onCandidateVideoChunk", _on_candidate_video_chunk)
            self._video_chunk_callback_registered = True
            log.info("[BrowserWorker] Registered __onCandidateVideoChunk hook for %s", self.username)
        except Exception as exc:
            log.debug("[BrowserWorker] expose_function __onCandidateVideoChunk notice: %s", exc)

    async def _register_live_camera_callback(self) -> None:
        """Register page binding for live candidate camera feed relay to Admin Live View."""
        if not self.page or self._camera_callback_registered or not self.username:
            return

        async def _on_candidate_camera_frame(frame_data: str):
            if self.username and frame_data:
                try:
                    from code.recording.screen_manager import screen_manager
                    await screen_manager.broadcast_camera_frame(self.username, frame_data)
                except Exception:
                    pass

        try:
            if self._context:
                await self._context.expose_function("__onCandidateCameraFrame", _on_candidate_camera_frame)
            elif self.page:
                await self.page.expose_function("__onCandidateCameraFrame", _on_candidate_camera_frame)
            self._camera_callback_registered = True
            log.info("[BrowserWorker] Registered __onCandidateCameraFrame hook for %s across context/iframes", self.username)
        except Exception as exc:
            log.debug("[BrowserWorker] expose_function notice: %s", exc)

    def set_username(self, username: str) -> None:
        """Set or update candidate username for live camera frame broadcasting."""
        self.username = username
        if self.page and not self._camera_callback_registered:
            import asyncio
            try:
                loop = asyncio.get_event_loop()
                if loop.is_running():
                    loop.create_task(self._register_live_camera_callback())
            except Exception:
                pass

    async def open_url(self, url: str, wait_until: str = "domcontentloaded", timeout_ms: int = 45000) -> None:
        if not self.page:
            await self.start()
        assert self.page is not None
        await self.page.goto(url, wait_until=wait_until, timeout=timeout_ms)

    # ------------------------------------------------------------------
    # Virtual On-Screen Question Display API (broadcasts to main + iframes)
    # ------------------------------------------------------------------
    async def update_display(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        if not self.page:
            raise RuntimeError("BrowserWorker has not been started")
        last_ok: Dict[str, Any] = {"ok": False}
        for frame in self.page.frames:
            try:
                res = await frame.evaluate(
                    "(patch) => window.__AI_INTERVIEWER_DISPLAY__ ? window.__AI_INTERVIEWER_DISPLAY__.update(patch) : {ok: false}",
                    payload,
                )
                if isinstance(res, dict) and res.get("ok"):
                    last_ok = res
            except Exception:
                continue
        return last_ok

    async def show_welcome(self, candidate_name: str, total_questions: int, topic: str = "Technical Interview") -> Dict[str, Any]:
        return await self.update_display({
            "mode": "welcome",
            "brandTitle": self.config.brand_title,
            "candidateName": candidate_name,
            "totalQuestions": total_questions,
            "topic": topic,
            "statusText": "Waiting to begin interview...",
        })

    async def show_question(
        self,
        *,
        candidate_name: str,
        q_index: int,
        total_questions: int,
        question_text: str,
        time_limit_sec: int = 300,
        topic: str = "Technical Assessment",
    ) -> Dict[str, Any]:
        return await self.update_display({
            "mode": "question",
            "brandTitle": self.config.brand_title,
            "candidateName": candidate_name,
            "questionIndex": q_index,
            "totalQuestions": total_questions,
            "questionText": question_text,
            "timeLimitSec": time_limit_sec,
            "resetTimer": True,
            "topic": topic,
            "statusText": "Listening to your answer... Type /submit when done.",
        })

    async def show_transition(
        self,
        title: str,
        subtitle: str = "Preparing next question...",
        icon: str = "✅",
        color: str = "#10b981",
    ) -> Dict[str, Any]:
        return await self.update_display({
            "mode": "transition",
            "questionText": title,
            "subtitle": subtitle,
            "transitionIcon": icon,
            "transitionColor": color,
            "statusText": title,
        })

    async def show_completed(self, candidate_name: str, final_score: Optional[str] = None) -> Dict[str, Any]:
        return await self.update_display({
            "mode": "completed",
            "candidateName": candidate_name,
            "finalScore": final_score,
            "statusText": "Interview finished. Disconnecting safely...",
        })

    async def save_canvas_snapshot(self, output_path: Path) -> Path:
        """Save the exact 1280x720 virtual camera canvas frame to disk as PNG."""
        if not self.page:
            raise RuntimeError("BrowserWorker has not been started")
        data_url: Optional[str] = await self.page.evaluate(
            "() => window.__AI_INTERVIEWER_DISPLAY__ ? window.__AI_INTERVIEWER_DISPLAY__.snapshotDataUrl() : null"
        )
        if not data_url or "," not in data_url:
            raise RuntimeError("Failed to capture canvas snapshot")
        raw_bytes = base64.b64decode(data_url.split(",", 1)[1])
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_bytes(raw_bytes)
        return output_path

    # ------------------------------------------------------------------
    # Per-Question Audio Capture API (works across main frame + Zoom iframes!)
    # ------------------------------------------------------------------
    async def start_audio_segment(self, q_index: int) -> Dict[str, Any]:
        if not self.page:
            raise RuntimeError("BrowserWorker has not been started")
        best: Dict[str, Any] = {"ok": False, "tappedTracks": 0, "wasmTapCount": 0}
        total_tracks = 0
        total_wasm = 0
        for frame in self.page.frames:
            try:
                res = await frame.evaluate(
                    "(idx) => window.__AI_INTERVIEWER_AUDIO__ ? window.__AI_INTERVIEWER_AUDIO__.startSegment(idx) : {ok: false}",
                    q_index,
                )
                if isinstance(res, dict) and res.get("ok"):
                    total_tracks += int(res.get("tappedTracks") or 0)
                    total_wasm += int(res.get("wasmTapCount") or 0)
                    best = res
            except Exception:
                continue
        best["tappedTracks"] = total_tracks
        best["wasmTapCount"] = total_wasm
        return best

    async def stop_audio_segment(self, save_path: Optional[Path] = None) -> Dict[str, Any]:
        if not self.page:
            raise RuntimeError("BrowserWorker has not been started")
        candidates: list[Dict[str, Any]] = []
        for frame in self.page.frames:
            try:
                res = await frame.evaluate(
                    "async () => window.__AI_INTERVIEWER_AUDIO__ ? await window.__AI_INTERVIEWER_AUDIO__.stopSegment() : {ok: false}"
                )
                if isinstance(res, dict) and res.get("ok"):
                    candidates.append(res)
            except Exception:
                continue

        if not candidates:
            return {"ok": False, "saved_path": None, "sizeBytes": 0}

        # Pick the frame that captured real candidate audio:
        # prioritize highest RMS speech energy > tappedTracks > wasmTapCount > sizeBytes
        def _rank(item: Dict[str, Any]) -> tuple:
            has_b64 = 1 if item.get("base64") else 0
            max_rms = float(item.get("maxRms") or 0.0)
            tracks = int(item.get("tappedTracks") or 0)
            wasm = int(item.get("wasmTapCount") or 0)
            size = int(item.get("sizeBytes") or 0)
            return (has_b64, 1 if max_rms > 0.005 else 0, max_rms, tracks, wasm, size)

        best = max(candidates, key=_rank)
        b64 = best.pop("base64", "")
        saved_file: Optional[str] = None
        if save_path and b64:
            save_path.parent.mkdir(parents=True, exist_ok=True)
            save_path.write_bytes(base64.b64decode(b64))
            saved_file = str(save_path)
        best["saved_path"] = saved_file
        log.info(
            "[BrowserWorker] Stopped Q%s audio: size=%s bytes, maxRms=%.4f, tracks=%s, wasmTaps=%s",
            best.get("qIndex"),
            best.get("sizeBytes"),
            float(best.get("maxRms") or 0.0),
            best.get("tappedTracks"),
            best.get("wasmTapCount"),
        )
        return best

    async def get_audio_status(self) -> Dict[str, Any]:
        if not self.page:
            return {"tappedTracks": 0, "wasmTapCount": 0, "recording": False}
        agg_tracks = 0
        agg_wasm = 0
        max_rms = 0.0
        latest_speech = 0
        recording = False
        cur_idx = -1
        for frame in self.page.frames:
            try:
                st = await frame.evaluate(
                    "() => window.__AI_INTERVIEWER_AUDIO__ ? window.__AI_INTERVIEWER_AUDIO__.getStatus() : null"
                )
                if not isinstance(st, dict):
                    continue
                agg_tracks += int(st.get("tappedTracks") or 0)
                agg_wasm += int(st.get("wasmTapCount") or 0)
                max_rms = max(max_rms, float(st.get("rmsLevel") or 0.0))
                if int(st.get("lastSpeechAt") or 0) > latest_speech:
                    latest_speech = int(st.get("lastSpeechAt") or 0)
                if st.get("recording"):
                    recording = True
                    cur_idx = int(st.get("currentSegmentIndex", -1))
            except Exception:
                continue
        import time as _t
        ms_since = int(_t.time() * 1000) - latest_speech if latest_speech else None
        return {
            "tappedTracks": agg_tracks,
            "wasmTapCount": agg_wasm,
            "recording": recording,
            "currentSegmentIndex": cur_idx,
            "rmsLevel": max_rms,
            "lastSpeechAt": latest_speech,
            "msSinceSpeech": ms_since,
        }

    # ------------------------------------------------------------------
    # Candidate Face Video Recording & Status API (MediaRecorder WebM)
    # ------------------------------------------------------------------
    async def start_candidate_video_recording(
        self,
        candidate_name: str,
        save_path: Optional[Path] = None,
    ) -> Dict[str, Any]:
        """Start continuous in-browser recording of candidate's face video + audio stream."""
        if not self.page:
            return {"ok": False, "error": "BrowserWorker has not been started"}

        if save_path:
            self._active_video_target = Path(save_path)
            self._active_video_size = 0
            self._active_video_target.parent.mkdir(parents=True, exist_ok=True)
            try:
                open(self._active_video_target, "wb").close()
            except Exception as e:
                log.warning("[BrowserWorker] Failed to create video target %s: %s", save_path, e)

        await self._register_video_chunk_callback()

        best: Dict[str, Any] = {"ok": False}
        for frame in self.page.frames:
            try:
                res = await frame.evaluate(
                    "(name) => window.__AI_CANDIDATE_VIDEO__ ? window.__AI_CANDIDATE_VIDEO__.startRecording(name) : {ok: false}",
                    candidate_name,
                )
                if isinstance(res, dict) and res.get("ok"):
                    best = res
            except Exception:
                continue
        log.info("[BrowserWorker] Started candidate video recording for %s (target=%s): %s", candidate_name, save_path, best)
        return best

    async def stop_candidate_video_recording(self, save_path: Optional[Path] = None) -> Dict[str, Any]:
        """Stop candidate video recording and ensure the resulting .webm file is on disk."""
        target = Path(save_path) if save_path else self._active_video_target
        if not self.page:
            if target and target.exists() and target.stat().st_size > 0:
                return {"ok": True, "saved_path": str(target), "sizeBytes": target.stat().st_size}
            return {"ok": False, "saved_path": None, "sizeBytes": 0}

        candidates: list[Dict[str, Any]] = []
        for frame in self.page.frames:
            try:
                res = await frame.evaluate(
                    "async () => window.__AI_CANDIDATE_VIDEO__ ? await window.__AI_CANDIDATE_VIDEO__.stopRecording() : {ok: false}"
                )
                if isinstance(res, dict) and res.get("ok"):
                    candidates.append(res)
            except Exception:
                continue

        # If live chunk streaming already populated the file on disk, return it!
        saved_file: Optional[str] = None
        if target and target.exists() and target.stat().st_size > 0:
            saved_file = str(target)
            file_size = target.stat().st_size
            log.info(
                "[BrowserWorker] Candidate video recording saved via live stream: %s (size=%d bytes)",
                saved_file,
                file_size,
            )
            return {"ok": True, "saved_path": saved_file, "sizeBytes": file_size}

        # Fallback to single base64 payload if stream did not capture chunks
        if candidates:
            best = max(candidates, key=lambda x: int(x.get("sizeBytes") or 0))
            b64 = best.pop("base64", "")
            if target and b64:
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(base64.b64decode(b64))
                saved_file = str(target)
                log.info(
                    "[BrowserWorker] Candidate video recording saved from blob: %s (size=%d bytes, duration=%ds)",
                    saved_file,
                    int(best.get("sizeBytes") or 0),
                    int(best.get("durationSec") or 0),
                )
                best["saved_path"] = saved_file
                return best

        return {"ok": False, "saved_path": None, "sizeBytes": 0}

    async def get_candidate_video_status(self) -> Dict[str, Any]:
        """Query current candidate video status across frames."""
        if not self.page:
            return {"recording": False, "hasActiveCandidateStream": False}
        for frame in self.page.frames:
            try:
                st = await frame.evaluate(
                    "() => window.__AI_CANDIDATE_VIDEO__ ? window.__AI_CANDIDATE_VIDEO__.getStatus() : null"
                )
                if isinstance(st, dict) and st.get("recording"):
                    return st
            except Exception:
                continue
        return {"recording": False, "hasActiveCandidateStream": False}

    def _dbg_log(self, msg: str) -> None:
        try:
            with open("D:/code/Interview/backend/screencast_debug.log", "a", encoding="utf-8") as f:
                f.write(f"[{datetime.now().isoformat()}] {msg}\n")
                f.flush()
        except Exception as e:
            print(f"[DBG LOG FAIL] {e}")

    async def start_screencast_stream(self) -> None:
        """
        Starts Chrome DevTools Protocol (CDP) live screencast.
        Captures raw rendered pixels directly from Chromium GPU/compositor at 8-10 FPS,
        bypassing Zoom's WebAssembly canvas isolation completely!
        """
        self._dbg_log(f"start_screencast_stream called: page={bool(self.page)}, active={self._screencast_active}")
        if not self.page or self._screencast_active:
            return
        try:
            self._cdp_session = await self._context.new_cdp_session(self.page)
            self._screencast_active = True
            self._screencast_task = asyncio.create_task(self._run_continuous_screencast_loop())
            self._dbg_log(f"CDP session created and screencast task started for {self.username}")
            log.info("[BrowserWorker] Started native CDP compositor screencast for %s", self.username)
        except Exception as exc:
            self._screencast_active = False
            self._dbg_log(f"CDP screencast start EXCEPTION: {exc}")
            log.warning("[BrowserWorker] Could not start CDP screencast: %s", exc)

    async def _get_candidate_tile_bbox(self) -> Optional[tuple[int, int, int, int]]:
        """
        Locates the candidate's video tile coordinates in Zoom Web Client.
        Returns (x1, y1, x2, y2) in 1280x720 screen space.
        """
        if not self.page:
            return None
        try:
            js_query = """
            () => {
                const selectors = [
                    '[class*="video-avatar"]',
                    '[class*="video-box"]',
                    '[class*="gallery-video"]',
                    '[class*="single-view"]',
                    '.speaker-view',
                    '#speaker-view-video',
                    '[id*="video-canvas"]',
                    'canvas[id*="speaker"]'
                ];
                for (const sel of selectors) {
                    const els = document.querySelectorAll(sel);
                    for (const el of els) {
                        const r = el.getBoundingClientRect();
                        if (r.width >= 140 && r.height >= 140 && r.x < window.innerWidth * 0.76) {
                            return { x: r.x, y: r.y, w: r.width, h: r.height };
                        }
                    }
                }
                const canvases = Array.from(document.querySelectorAll('canvas')).filter(c => {
                    const r = c.getBoundingClientRect();
                    return r.width >= 180 && r.height >= 180 && r.x < window.innerWidth * 0.76;
                });
                if (canvases.length > 0) {
                    const r = canvases[0].getBoundingClientRect();
                    return { x: r.x, y: r.y, w: r.width, h: r.height };
                }
                return null;
            }
            """
            bbox = await self.page.evaluate(js_query)
            if bbox and bbox.get("w", 0) >= 120 and bbox.get("h", 0) >= 120:
                x = max(0, int(bbox["x"]))
                y = max(0, int(bbox["y"]))
                w = min(1280 - x, int(bbox["w"]))
                h = min(720 - y, int(bbox["h"]))
                return (x, y, x + w, y + h)
        except Exception:
            pass
        return None

    async def _run_continuous_screencast_loop(self) -> None:
        """Continuously capture rendered frames from Chromium compositor at 8-10 FPS."""
        from code.recording.screen_manager import screen_manager
        self._dbg_log(f"Loop running: active={self._screencast_active}, cdp={bool(self._cdp_session)}")
        loop_count = 0
        last_bbox_check_ts: float = 0.0
        cached_bbox: Optional[tuple[int, int, int, int]] = None

        while self._screencast_active and self._cdp_session and self.page:
            try:
                # Refresh candidate tile coordinates every 2.0s without stalling the render loop
                now = time.time()
                if now - last_bbox_check_ts > 2.0:
                    last_bbox_check_ts = now
                    try:
                        detected_bbox = await self._get_candidate_tile_bbox()
                        if detected_bbox:
                            cached_bbox = detected_bbox
                    except Exception:
                        pass

                res = await self._cdp_session.send("Page.captureScreenshot", {
                    "format": "jpeg",
                    "quality": 55,
                    "clip": {"x": 0, "y": 0, "width": 1280, "height": 720, "scale": 0.55}
                })
                data_b64 = res.get("data")
                if data_b64 and self.username:
                    data_url = f"data:image/jpeg;base64,{data_b64}"
                    cam_url = data_url
                    try:
                        import io
                        from PIL import Image
                        raw_bytes = base64.b64decode(data_b64)
                        im = Image.open(io.BytesIO(raw_bytes))

                        if cached_bbox:
                            scale = 0.55
                            bx1, by1, bx2, by2 = cached_bbox
                            sx1 = max(0, int(bx1 * scale))
                            sy1 = max(0, int(by1 * scale))
                            sx2 = min(im.width, int(bx2 * scale))
                            sy2 = min(im.height, int(by2 * scale))
                            if sx2 - sx1 > 40 and sy2 - sy1 > 40:
                                cropped = im.crop((sx1, sy1, sx2, sy2))
                            else:
                                cropped = im.crop((0, 0, int(im.width * 0.74), im.height))
                        else:
                            crop_w = int(im.width * 0.74)
                            cropped = im.crop((0, 0, crop_w, im.height))

                        out_buf = io.BytesIO()
                        cropped.save(out_buf, format="JPEG", quality=60)
                        cam_url = f"data:image/jpeg;base64,{base64.b64encode(out_buf.getvalue()).decode('ascii')}"
                    except Exception as crop_err:
                        cam_url = data_url

                    loop_count += 1
                    if loop_count % 20 == 1:
                        self._dbg_log(f"Frame captured and broadcasting: count={loop_count}, len={len(cam_url)}")
                    await screen_manager.broadcast_camera_frame(self.username, cam_url)
                    await screen_manager.broadcast_screen_frame(self.username, data_url)
            except Exception as loop_err:
                err_str = str(loop_err)
                self._dbg_log(f"Loop iteration error: {loop_err}")
                if "Target page" in err_str or "closed" in err_str or "destroyed" in err_str:
                    break
                log.debug("[BrowserWorker] screencast loop frame notice: %s", loop_err)
            await asyncio.sleep(0.12)

    async def stop_screencast_stream(self) -> None:
        """Stop CDP screencast stream."""
        self._screencast_active = False
        if self._screencast_task and not self._screencast_task.done():
            self._screencast_task.cancel()
            self._screencast_task = None
        if self._cdp_session:
            try:
                await self._cdp_session.detach()
            except Exception:
                pass
            self._cdp_session = None
            log.info("[BrowserWorker] Stopped CDP screencast")

    async def screenshot(self, path: Path) -> Path:
        if not self.page:
            raise RuntimeError("BrowserWorker has not been started")
        path.parent.mkdir(parents=True, exist_ok=True)
        await self.page.screenshot(path=str(path))
        return path

    async def stop(self) -> None:
        """Cleanly tear down page, context, browser, and Playwright."""
        await self.stop_screencast_stream()
        for obj, method in (
            (self.page, "close"),
            (self._context, "close"),
            (self._browser, "close"),
            (self._pw, "stop"),
        ):
            if obj is not None:
                try:
                    await getattr(obj, method)()
                except Exception:
                    pass
        self.page = None
        self._context = None
        self._browser = None
        self._pw = None
