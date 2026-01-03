#!/usr/bin/env python3
"""
Stealth Subtitle Translator - AI Engine

Bu script Electron uygulamasının sidecar process'i olarak çalışır.
- BlackHole 2ch'den sistem sesini yakalar
- Faster-Whisper ile transkripsiyon yapar
- ArgosTranslate ile İngilizce -> Türkçe çeviri yapar
- ZeroMQ PUB socket ile Electron'a sonuçları gönderir

Optimizasyonlar:
- VAD (Voice Activity Detection) ile sessizlik tespiti
- int8 quantization ile düşük bellek kullanımı
- Streaming mode ile düşük latency

Gereksinimler:
- BlackHole 2ch virtual audio driver kurulu olmalı
- Apple Silicon için optimize edilmiş (M1/M2/M3)
"""

import sys
import time
import json
import signal
import threading
from typing import Optional, Callable
from dataclasses import dataclass, asdict
from collections import deque
from pathlib import Path

import numpy as np
import sounddevice as sd
import zmq
import torch
import webrtcvad
from faster_whisper import WhisperModel
import argostranslate.package
import argostranslate.translate
from deep_translator import GoogleTranslator

# Lazy imports for faster startup
_whisper_model = None
_translator = None

# ═══════════════════════════════════════════════════════════════════════════════
# CONFIGURATION
# ═══════════════════════════════════════════════════════════════════════════════

@dataclass
class EngineConfig:
    """Engine configuration parameters"""
    # Audio settings
    sample_rate: int = 16000
    channels: int = 1
    chunk_duration: float = 0.5  # seconds per chunk
    buffer_duration: float = 3.0  # seconds to accumulate before transcription
    
    # Whisper settings
    whisper_model: str = "small"  # tiny, base, small, medium, large-v3
    whisper_device: str = "cpu"   # cpu veya mps (experimental)
    whisper_compute_type: str = "int8"  # int8, float16, float32
    whisper_language: str = "en"  # Source language
    
    # VAD settings
    vad_mode: int = 3  # 0-3, higher = more aggressive
    vad_frame_duration: int = 30  # ms (10, 20, or 30)
    
    # Translation settings
    source_lang: str = "en"
    target_lang: str = "tr"
    
    # ZMQ settings
    zmq_address: str = "tcp://127.0.0.1:5555"
    
    # Audio device
    audio_device: Optional[str] = "BlackHole 2ch"  # None for default

    # Streaming setting
    streaming_mode: bool = False

CONFIG = EngineConfig()


# ═══════════════════════════════════════════════════════════════════════════════
# DATA STRUCTURES
# ═══════════════════════════════════════════════════════════════════════════════

@dataclass
class TranscriptResult:
    """Transcription result to send to Electron"""
    original: str
    translated: str
    timestamp: float
    isFinal: bool
    confidence: float = 0.0


# ═══════════════════════════════════════════════════════════════════════════════
# VOICE ACTIVITY DETECTION
# ═══════════════════════════════════════════════════════════════════════════════

class VoiceActivityDetector:
    """
    WebRTC VAD wrapper for detecting speech in audio.
    Falls back to energy-based detection if webrtcvad is unavailable.
    """
    
    def __init__(self, mode: int = 3, sample_rate: int = 16000, frame_duration: int = 30):
        self.mode = mode
        self.sample_rate = sample_rate
        self.frame_duration = frame_duration
        self.frame_size = int(sample_rate * frame_duration / 1000)
        self.vad = None
        self._use_energy_fallback = False
        
        try:
            import webrtcvad
            self.vad = webrtcvad.Vad(mode)
            print(f"[VAD] WebRTC VAD initialized (mode={mode})")
        except ImportError:
            print("[VAD] webrtcvad not available, using energy-based detection")
            self._use_energy_fallback = True
    
    def is_speech(self, audio_chunk: np.ndarray) -> bool:
        """Check if audio chunk contains speech"""
        if self._use_energy_fallback:
            return self._energy_based_detection(audio_chunk)
        
        try:
            # Convert to int16 for webrtcvad
            audio_int16 = (audio_chunk * 32767).astype(np.int16)
            
            # Process in frames
            speech_frames = 0
            total_frames = 0
            
            for i in range(0, len(audio_int16) - self.frame_size, self.frame_size):
                frame = audio_int16[i:i + self.frame_size].tobytes()
                if len(frame) == self.frame_size * 2:  # 2 bytes per sample
                    if self.vad.is_speech(frame, self.sample_rate):
                        speech_frames += 1
                    total_frames += 1
            
            # Return True if more than 30% of frames contain speech
            return total_frames > 0 and (speech_frames / total_frames) > 0.3
            
        except Exception as e:
            print(f"[VAD] Error: {e}, falling back to energy detection")
            return self._energy_based_detection(audio_chunk)
    
    def _energy_based_detection(self, audio_chunk: np.ndarray, threshold: float = 0.01) -> bool:
        """Simple energy-based voice detection fallback"""
        rms = np.sqrt(np.mean(audio_chunk ** 2))
        return rms > threshold


# ═══════════════════════════════════════════════════════════════════════════════
# AUDIO CAPTURE
# ═══════════════════════════════════════════════════════════════════════════════

class AudioCapture:
    """
    Captures audio from BlackHole or system audio device.
    Uses sounddevice for modern, async-native audio capture.
    """
    
    def __init__(
        self,
        device_name: Optional[str] = None,
        sample_rate: int = 16000,
        channels: int = 1,
        chunk_duration: float = 0.5,
        callback: Optional[Callable[[np.ndarray], None]] = None
    ):
        self.device_name = device_name
        self.sample_rate = sample_rate
        self.channels = channels
        self.chunk_size = int(sample_rate * chunk_duration)
        self.callback = callback
        self.stream = None
        self._running = False
        
        # Import sounddevice
        try:
            import sounddevice as sd
            self.sd = sd
        except ImportError:
            raise RuntimeError("sounddevice is required. Install with: pip install sounddevice")
        
        # Find device
        self.device_id = self._find_device()
        
    def _find_device(self) -> Optional[int]:
        """Find the audio device by name"""
        if self.device_name is None:
            return None  # Use default
        
        devices = self.sd.query_devices()
        for i, device in enumerate(devices):
            if self.device_name.lower() in device['name'].lower():
                if device['max_input_channels'] > 0:
                    print(f"[Audio] Found device: {device['name']} (id={i})")
                    return i
        
        print(f"[Audio] Device '{self.device_name}' not found, available devices:")
        for i, device in enumerate(devices):
            if device['max_input_channels'] > 0:
                print(f"  [{i}] {device['name']}")
        
        return None
    
    def _audio_callback(self, indata: np.ndarray, frames: int, time_info, status):
        """Called for each audio chunk"""
        if status:
            print(f"[Audio] Status: {status}")
        
        if self.callback and self._running:
            # Convert to mono float32
            audio = indata[:, 0] if indata.ndim > 1 else indata.flatten()
            self.callback(audio.astype(np.float32))
    
    def start(self):
        """Start audio capture"""
        if self._running:
            return
        
        self._running = True
        
        try:
            self.stream = self.sd.InputStream(
                device=self.device_id,
                samplerate=self.sample_rate,
                channels=self.channels,
                blocksize=self.chunk_size,
                callback=self._audio_callback,
                dtype=np.float32
            )
            self.stream.start()
            print(f"[Audio] Capture started (device={self.device_id}, rate={self.sample_rate})")
        except Exception as e:
            print(f"[Audio] Failed to start capture: {e}")
            self._running = False
            raise
    
    def stop(self):
        """Stop audio capture"""
        self._running = False
        if self.stream:
            self.stream.stop()
            self.stream.close()
            self.stream = None
            print("[Audio] Capture stopped")


# ═══════════════════════════════════════════════════════════════════════════════
# TRANSCRIPTION ENGINE
# ═══════════════════════════════════════════════════════════════════════════════

class TranscriptionEngine:
    """
    Faster-Whisper based transcription engine.
    Optimized for Apple Silicon with int8 quantization.
    """
    
    def __init__(
        self,
        model_name: str = "small",
        device: str = "cpu",
        compute_type: str = "int8",
        language: str = "en"
    ):
        self.model_name = model_name
        self.device = device
        self.compute_type = compute_type
        self.language = language
        self.model = None
        
    def load(self):
        """Load the Whisper model (lazy loading)"""
        if self.model is not None:
            return
        
        print(f"[Whisper] Loading model '{self.model_name}' (device={self.device}, compute={self.compute_type})...")
        start_time = time.time()
        
        try:
            from faster_whisper import WhisperModel
            
            self.model = WhisperModel(
                self.model_name,
                device=self.device,
                compute_type=self.compute_type,
                download_root=str(Path.home() / ".cache" / "whisper")
            )
            
            elapsed = time.time() - start_time
            print(f"[Whisper] Model loaded in {elapsed:.2f}s")
            
        except ImportError:
            raise RuntimeError("faster-whisper is required. Install with: pip install faster-whisper")
        except Exception as e:
            print(f"[Whisper] Failed to load model: {e}")
            raise
    
    def transcribe(self, audio: np.ndarray, sample_rate: int = 16000, prompt: str = "") -> tuple[str, float]:
        """
        Transcribe audio to text.
        Returns (text, confidence)
        """
        if self.model is None:
            self.load()
        
        try:
            segments, info = self.model.transcribe(
                audio,
                language=self.language,
                beam_size=5,
                best_of=5,
                temperature=0.0,
                condition_on_previous_text=False,
                initial_prompt=prompt,  # <--- Context Awareness
                vad_filter=True,  # Built-in VAD
                vad_parameters=dict(
                    min_silence_duration_ms=500,
                    speech_pad_ms=400,
                )
            )
            
            # Collect all segments
            text_parts = []
            total_confidence = 0.0
            segment_count = 0
            
            for segment in segments:
                text_parts.append(segment.text.strip())
                total_confidence += segment.avg_logprob
                segment_count += 1
            
            text = " ".join(text_parts)
            avg_confidence = (total_confidence / segment_count) if segment_count > 0 else 0.0
            
            return text, avg_confidence
            
        except Exception as e:
            print(f"[Whisper] Transcription error: {e}")
            return "", 0.0


# ═══════════════════════════════════════════════════════════════════════════════
# TRANSLATION ENGINE
# ═══════════════════════════════════════════════════════════════════════════════

class TranslationEngine:
    """
    Hybrid Translation Engine (Google Translate + Argos Offline Fallback).
    Priority: Google Translate (Quality) -> Argos (Offline/Fallback)
    """
    
    def __init__(self, source_lang: str = "en", target_lang: str = "tr"):
        self.source_lang = source_lang
        self.target_lang = target_lang
        self.translator = None
        self._installed = False
        self.google_translator = GoogleTranslator(source=source_lang, target=target_lang)
        
    def load(self):
        """Load translation models"""
        if self._installed: # Already attempted setup
            return
            
        print(f"[Translate] Initializing Hybrid Engine {self.source_lang} -> {self.target_lang}...")
        
        # Google Translate is API based, no "loading" needed but let's check basic connectivity?
        # No, better to try it on first request.
        
        # Load Offline Model (Argos) as Backup
        try:
            import argostranslate.package
            import argostranslate.translate
            
            # Update package index and install if necessary
            # Note: In production, maybe check if installed first to be faster
            argostranslate.package.update_package_index()
            available_packages = argostranslate.package.get_available_packages()
            package_to_install = next(
                filter(
                    lambda x: x.from_code == self.source_lang and x.to_code == self.target_lang,
                    available_packages
                ), None
            )
            
            if package_to_install:
                if package_to_install not in argostranslate.package.get_installed_packages():
                    print(f"[Translate] Installing offline package: {package_to_install}")
                    argostranslate.package.install_from_path(package_to_install.download())
                
                # Get translator object
                installed_languages = argostranslate.translate.get_installed_languages()
                source = next((l for l in installed_languages if l.code == self.source_lang), None)
                target = next((l for l in installed_languages if l.code == self.target_lang), None)
                
                if source and target:
                    self.translator = source.get_translation(target)
                    print(f"[Translate] Fallback Offline Model Loaded: {source.name} -> {target.name}")
            else:
                print("[Translate] Offline package not available.")
                
        except Exception as e:
            print(f"[Translate] Offline model setup failed: {e}")
            
        self._installed = True

    def translate(self, text: str) -> str:
        """Translate text with fallback logic"""
        if not text or not text.strip():
            return ""
            
        # 1. Try Google Translate (High Quality)
        try:
            result = self.google_translator.translate(text)
            if result:
                return result
        except Exception as e:
            # Silent fallback (uncomment to debug)
            # print(f"[Translate] Google API failed: {e}")
            pass
            
        # 2. Fallback to Argos (Offline)
        if self.translator:
            try:
                return self.translator.translate(text)
            except Exception as e:
                print(f"[Translate] Offline failed: {e}")
                return text
        
        return text


# ═══════════════════════════════════════════════════════════════════════════════
# ZMQ PUBLISHER
# ═══════════════════════════════════════════════════════════════════════════════

class ZmqPublisher:
    """
    ZeroMQ PUB socket for sending transcripts to Electron.
    Low latency pub/sub pattern.
    """
    
    def __init__(self, address: str = "tcp://127.0.0.1:5555"):
        self.address = address
        self.socket = None
        self.context = None
        
    def start(self):
        """Start ZMQ publisher"""
        try:
            import zmq
            
            self.context = zmq.Context()
            self.socket = self.context.socket(zmq.PUB)
            self.socket.bind(self.address)
            
            # High water mark for message buffering
            self.socket.setsockopt(zmq.SNDHWM, 10)
            
            print(f"[ZMQ] Publisher bound to {self.address}")
            
        except ImportError:
            print("[ZMQ] pyzmq not available, using stdout fallback")
            self.socket = None
        except Exception as e:
            print(f"[ZMQ] Failed to start: {e}")
            self.socket = None
    
    def publish(self, result):
        """Publish transcript result or generic dict"""
        if hasattr(result, '__dataclass_fields__'):
            data = json.dumps(asdict(result))
        elif isinstance(result, dict):
            data = json.dumps(result)
        else:
            return # Ignore unknown types
        
        if self.socket:
            try:
                self.socket.send_string(data)
            except Exception as e:
                print(f"[ZMQ] Send error: {e}")
        # else:
            # Fallback for stdout debugging (optional, too noisy for audio levels)
            # if not isinstance(result, dict) or result.get('type') != 'audio_level':
            #    print(f"[TRANSCRIPT] {data}", flush=True)

    def publish_audio_level(self, level: float):
        """Publish audio RMS level for visualizer"""
        msg = {
            "type": "audio_level",
            "level": float(level)
        }
        self.publish(msg)

    
    def stop(self):
        """Stop ZMQ publisher"""
        if self.socket:
            self.socket.close()
            self.socket = None
        if self.context:
            self.context.term()
            self.context = None
        print("[ZMQ] Publisher stopped")


# ═══════════════════════════════════════════════════════════════════════════════
# MAIN ENGINE
# ═══════════════════════════════════════════════════════════════════════════════

class SubtitleEngine:
    """
    Main engine orchestrating audio capture, transcription, translation, and publishing.
    """
    
    def __init__(self, config: EngineConfig):
        self.config = config
        self._running = False
        # self._audio_buffer Removed unused deque
        self._last_speech_time = 0.0  # Son ses algılama zamanı
        self._last_transcript_time = 0.0
        self._min_transcript_interval = 0.5  # Minimum seconds between transcriptions (SPEEDUP)
        
        # Cümle biriktirme sistemi
        self._sentence_buffer: list = []  # Biriken cümleler
        self._silence_threshold = 0.5  # 0.5 saniye sessizlik = yeni satır (SPEEDUP)
        self._current_speech_audio: list = []  # Şu anki konuşma sesi
        self._audio_lock = threading.Lock() # Thread safety lock
        
        # Components
        self.vad = VoiceActivityDetector(
            mode=config.vad_mode,
            sample_rate=config.sample_rate,
            frame_duration=config.vad_frame_duration
        )
        
        self.audio_capture = AudioCapture(
            device_name=config.audio_device,
            sample_rate=config.sample_rate,
            channels=config.channels,
            chunk_duration=config.chunk_duration,
            callback=self._on_audio_chunk
        )
        
        self.transcriber = TranscriptionEngine(
            model_name=config.whisper_model,
            device=config.whisper_device,
            compute_type=config.whisper_compute_type,
            language=config.whisper_language
        )
        
        self.translator = TranslationEngine(
            source_lang=config.source_lang,
            target_lang=config.target_lang
        )
        
        self.publisher = ZmqPublisher(address=config.zmq_address)
        
        # Processing thread
        self._process_thread: Optional[threading.Thread] = None
        self._process_event = threading.Event()

        # Command Listener (Config updates)
        self._command_thread: Optional[threading.Thread] = None
        self._command_context = zmq.Context()
        self._command_socket = self._command_context.socket(zmq.SUB)
        # Note: Electron Binds to 5556, we Connect to it.
        self._command_socket.connect("tcp://127.0.0.1:5556")
        self._command_socket.setsockopt_string(zmq.SUBSCRIBE, "")
        
        # Audio Level Broadcasting State
        self._last_audio_level_time = 0.0
        self._audio_level_interval = 1.0 / 30.0  # 30 FPS visualizer
        
    def _on_audio_chunk(self, audio: np.ndarray):
        """Callback for audio chunks"""
        if not self._running:
            return
        
        now = time.time()
        
        # 0. RMS (Enerji) Kontrolü - Dip gürültüyü filtrele ve Visualizer'a gönder
        rms = np.sqrt(np.mean(audio**2))
        
        # Broadcast Audio Level for Visualizer
        if now - self._last_audio_level_time >= self._audio_level_interval:
            # Normalize RMS roughly to 0.0 - 1.0 range based on typical speech volume
            # Typical speech RMS might be 0.01 to 0.1. 
            # Let's boost it visually.
            visual_level = min(1.0, rms * 10.0) 
            self.publisher.publish_audio_level(visual_level)
            self._last_audio_level_time = now

        MIN_RMS = 0.002 # Gürültü eşiği (deneme yanılma ile gerekirse ayarlanır)

        
        # VAD check
        is_speech = self.vad.is_speech(audio) and (rms > MIN_RMS)
        
        if is_speech:
            # Ses var - mevcut konuşma bufferına ekle
            with self._audio_lock:
                self._current_speech_audio.append(audio)
            
            self._last_speech_time = now
            # Hemen işlemesi için event set et (Streaming)
            self._process_event.set()
        else:
            # Sessizlik
            has_audio = False
            with self._audio_lock:
                has_audio = len(self._current_speech_audio) > 0

            if has_audio:
                # Hala bufferda ses var
                # Eğer sessizlik süresi dolduysa Finalize et
                if now - self._last_speech_time >= self._silence_threshold:
                    self._process_event.set()

    def _command_loop(self):
        """Listen for commands/config updates from Electron"""
        print("[Command] Listener started")
        while self._running:
            try:
                # Non-blocking check or poller could be better, but blocking with timeout is fine
                if self._command_socket.poll(timeout=500):
                    msg = self._command_socket.recv_string()
                    try:
                        data = json.loads(msg)
                        if data.get('type') == 'config':
                            key = data.get('key')
                            value = data.get('value')
                            print(f"[Command] Config update: {key} = {value}")
                            
                            if key == 'streaming_mode':
                                self.config.streaming_mode = bool(value)
                    except json.JSONDecodeError:
                        pass
                            
            except Exception as e:
                print(f"[Command] Error: {e}")
                time.sleep(1)

    def _process_loop(self):
        """Background processing loop - Real-time Streaming"""
        
        last_partial_text = ""
        last_context = ""  # Hafıza (Önceki cümle)
        
        # Maksimum segment süresi (saniye) - Çok uzarsa kesip yeni satıra geçsin
        MAX_SEGMENT_DURATION = 10.0 
        
        while self._running:
            # Wait for event
            self._process_event.wait(timeout=0.2) 
            self._process_event.clear()
            
            if not self._running:
                break
            
            now = time.time()
            
            with self._audio_lock:
                if not self._current_speech_audio:
                    continue
                # Copy buffer for processing to avoid holding lock during heavy ops
                current_audio_copy = list(self._current_speech_audio)
                
            # Determine Interval based on Streaming Mode
            # Streaming = Aggressive (50ms). Sentence = Config Default (0.5s or dynamic).
            interval = 0.05 if self.config.streaming_mode else self._min_transcript_interval

            # Rate limiting
            if now - self._last_transcript_time < interval:
                continue

            # 3. Determine if Final or Partial
            is_silence_final = (now - self._last_speech_time >= self._silence_threshold)
            
            # Ses buffer süresini hesapla
            total_samples = sum(len(c) for c in current_audio_copy)
            duration_sec = total_samples / self.config.sample_rate
            
            is_timeout_final = (duration_sec > MAX_SEGMENT_DURATION)
            
            is_final = is_silence_final or is_timeout_final
            
            # 4. Prepare Audio
            try:
                audio = np.concatenate(current_audio_copy)
            except ValueError:
                continue
                
            if len(audio) < self.config.sample_rate * 0.3: 
                if is_final:
                    with self._audio_lock:
                        self._current_speech_audio.clear()
                continue
            

            if not is_final:
                # Kullanıcı sadece bitmiş cümleleri görmek istiyor.
                # Partial update yapma, sadece bekle.
                continue
            
            # 5. Transcribe (Only at the end) with CONTEXT
            # last_partial_text'i prompt olarak kullan (veya bir önceki cümleyi)
            # Burada 'last_partial_text' streaming için kullanılıyordu, context için
            # bir üst scope'ta 'previous_sentence' tutmak daha iyi.
            
            text, confidence = self.transcriber.transcribe(
                audio, 
                self.config.sample_rate, 
                prompt=last_context  # <--- Use previous sentence as context
            )
            text = text.strip()
            
            if not text:
                with self._audio_lock:
                    self._current_speech_audio.clear()
                continue

            # 6. Translate
            translated = self.translator.translate(text)
            
            # 7. Publish
            result = TranscriptResult(
                original=text,
                translated=translated.strip(),
                timestamp=now,
                isFinal=is_final,
                confidence=confidence
            )
            
            self.publisher.publish(result)
            self._last_transcript_time = now
            
            if is_final:
                # Update context for next sentence
                last_context = text # "Hafıza" güncelle
                
                with self._audio_lock:
                    self._current_speech_audio.clear()
                # Eğer timeout ise ve hala konuşuyorsa (VAD true ise), son konuşma zamanını resetleme ki hemen yeni cümle başlasın?
                # Şimdilik direkt temizliyoruz, ses gelmeye devam ederse _on_audio_chunk yeni buffer dolduracak.
            else:
                pass
    
    def start(self):
        """Start the engine"""
        if self._running:
            return
        
        print("[Engine] Starting...")
        self._running = True
        
        # Pre-load models
        print("[Engine] Loading AI models (this may take a moment)...")
        self.transcriber.load()
        self.translator.load()
        
        # Start components
        self.publisher.start()
        
        # Start processing thread
        self._process_thread = threading.Thread(target=self._process_loop, daemon=True)
        self._process_thread.start()

        # Start command thread
        self._command_thread = threading.Thread(target=self._command_loop, daemon=True)
        self._command_thread.start()
        
        # Start audio capture (this blocks in callback mode)
        self.audio_capture.start()
        
        print("[Engine] Started successfully. Listening for audio...")
    
    def stop(self):
        """Stop the engine"""
        if not self._running:
            return
        
        print("[Engine] Stopping...")
        self._running = False
        self._process_event.set()  # Wake up processing thread
        
        # Stop components
        self.audio_capture.stop()
        self.publisher.stop()
        
        # Wait for processing thread
        if self._process_thread:
            self._process_thread.join(timeout=2.0)
        
        if self._command_thread:
            # Often ZMQ receive is blocking, so maybe it won't join easily without a message
            # But we used poll(timeout=500), so it should exit within 0.5s
            self._command_thread.join(timeout=2.0)
        
        print("[Engine] Stopped")
    
    def run(self):
        """Run the engine (blocking)"""
        # Signal handlers
        def signal_handler(sig, frame):
            print("\n[Engine] Received shutdown signal")
            self.stop()
            sys.exit(0)
        
        signal.signal(signal.SIGINT, signal_handler)
        signal.signal(signal.SIGTERM, signal_handler)
        
        try:
            self.start()
            
            # Keep running
            while self._running:
                time.sleep(1)
                
        except KeyboardInterrupt:
            pass
        finally:
            self.stop()


# ═══════════════════════════════════════════════════════════════════════════════
# ENTRY POINT
# ═══════════════════════════════════════════════════════════════════════════════

def main():
    """Main entry point"""
    print("=" * 60)
    print("  Stealth Subtitle Translator - AI Engine")
    print("  Faster-Whisper + ArgosTranslate + ZeroMQ")
    print("=" * 60)
    print()
    
    # Create and run engine
    engine = SubtitleEngine(CONFIG)
    engine.run()


if __name__ == "__main__":
    main()
