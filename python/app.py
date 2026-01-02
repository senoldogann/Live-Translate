import os
import sys
import json
import time
import queue
import numpy as np
import pyaudio
from faster_whisper import WhisperModel
import ctranslate2
import sentencepiece as spm
from huggingface_hub import snapshot_download, hf_hub_download
import onnxruntime

# --- Configuration ---
SAMPLE_RATE = 16000
CHANNELS = 1
# VAD Config
VAD_THRESHOLD = 0.5
SILERO_URL = "https://github.com/snakers4/silero-vad/raw/master/files/silero_vad.onnx"
# Model Configs
WHISPER_SIZE = "tiny"
NLLB_MODEL_ID = "JustFrederik/nllb-200-distilled-600M-ct2-int8" 
DEVICE = "cpu" 
COMPUTE_TYPE = "int8"

# --- Global State ---
audio_queue = queue.Queue()
running = True

class SileroVAD:
    def __init__(self):
        self.session = None
        self.reset_states()
        self._download_model()

    def _download_model(self):
        """Downloads Silero VAD ONNX model if not exists."""
        model_path = os.path.join(os.path.dirname(__file__), "models", "silero_vad.onnx")
        
        # Self-healing: Try to load, if fails, assume corrupt and re-download
        try:
            if os.path.exists(model_path):
                 opts = onnxruntime.SessionOptions()
                 opts.log_severity_level = 3
                 self.session = onnxruntime.InferenceSession(model_path, sess_options=opts, providers=['CPUExecutionProvider'])
                 return # Loaded successfully
        except Exception as e:
            print(json.dumps({"status": "error", "message": f"Corrupt VAD model found, deleting... {e}"}), flush=True)
            try:
                os.remove(model_path)
            except: pass
            
        if not os.path.exists(model_path):
            print(json.dumps({"status": "downloading_vad", "message": "Downloading Silero VAD..."}), flush=True)
            import requests
            os.makedirs(os.path.dirname(model_path), exist_ok=True)
            
            # Try specific version first, then master
            urls = [
                "https://github.com/snakers4/silero-vad/raw/v4.0/files/silero_vad.onnx",
                "https://github.com/snakers4/silero-vad/raw/master/files/silero_vad.onnx"
            ]
            
            downloaded = False
            for url in urls:
                try:
                    response = requests.get(url, allow_redirects=True)
                    if response.status_code == 200:
                        with open(model_path, "wb") as f:
                            f.write(response.content)
                        downloaded = True
                        break
                except:
                    continue
            
            if not downloaded:
                raise Exception("Failed to download Silero VAD model from GitHub.")

        # Initialize ONNX Runtime
        opts = onnxruntime.SessionOptions()
        opts.log_severity_level = 3
        self.session = onnxruntime.InferenceSession(model_path, sess_options=opts, providers=['CPUExecutionProvider'])

    def reset_states(self):
        self._h = np.zeros((2, 1, 64), dtype=np.float32)
        self._c = np.zeros((2, 1, 64), dtype=np.float32)

    def is_speech(self, audio_chunk):
        """
        Returns probability of speech in the audio chunk.
        Input audio_chunk: np.array of float32, length must be 512, 1024, or 1536 for Silero.
        """
        if self.session is None: return 0.0
        
        # Silero expects exact chunk sizes. 
        # We will assume the caller handles chunking or we pad/trim. 
        # Ideally, we pass 512 samples (32ms) at a time.
        
        # Prepare inputs
        inputs = {
            'input': audio_chunk.reshape(1, -1),
            'h': self._h,
            'c': self._c,
            'sr': np.array([SAMPLE_RATE], dtype=np.int64)
        }
        
        output, h, c = self.session.run(None, inputs)
        
        self._h = h
        self._c = c
        
        return output[0][0]

class NLLBTranslator:
    def __init__(self):
        self.translator = None
        self.tokenizer = None
        self._load_model()

    def _load_model(self):
        print(json.dumps({"status": "downloading_nllb", "message": "Downloading NLLB Translation Model..."}), flush=True)
        model_dir = snapshot_download(repo_id=NLLB_MODEL_ID)
        
        self.translator = ctranslate2.Translator(model_dir, device=DEVICE, compute_type=COMPUTE_TYPE)
        self.tokenizer = spm.SentencePieceProcessor()
        sp_model_path = os.path.join(model_dir, "sentencepiece.model")
        if not os.path.exists(sp_model_path):
            try:
                sp_model_path = hf_hub_download(repo_id="facebook/nllb-200-distilled-600M", filename="sentencepiece.bpe.model")
            except Exception as e:
                # Fallback or re-raise
                print(json.dumps({"status": "error", "message": f"Failed to download SP model: {e}"}), flush=True)
                raise e
        
        self.tokenizer.load(sp_model_path)

    def translate(self, text, source_lang="eng_Latn", target_lang="tur_Latn"):
        if not text.strip(): return ""
        
        source_tokens = self.tokenizer.encode(text, out_type=str)
        source_tokens = [source_lang] + source_tokens # NLLB prompt format
        
        results = self.translator.translate_batch(
            [source_tokens],
            target_prefix=[[target_lang]]
        )
        
        target_tokens = results[0].hypotheses[0]
        # Remove target lang token if present at start (usually handled by SP but good to check)
        if target_tokens and target_tokens[0] == target_lang:
            target_tokens = target_tokens[1:]
            
        return self.tokenizer.decode(target_tokens)

def audio_callback(in_data, frame_count, time_info, status):
    if running:
        audio_data = np.frombuffer(in_data, dtype=np.float32)
        audio_queue.put(audio_data)
    return (in_data, pyaudio.paContinue)

def main():
    global running
    
    # 1. Init VAD
    vad = SileroVAD()
    
    # 2. Init Whisper
    print(json.dumps({"status": "loading", "message": "Loading Whisper..."}), flush=True)
    whisper = WhisperModel(WHISPER_SIZE, device=DEVICE, compute_type=COMPUTE_TYPE)
    
    # 3. Init Translator
    nllb = NLLBTranslator()

    # 4. Audio Stream
    p = pyaudio.PyAudio()
    # Chunk size: Silero likes 512 (32ms). We can read bigger chunks and split for VAD.
    # Reading 1024 samples (64ms) is a happy medium for python loop overhead vs latency.
    READ_CHUNK_SIZE = 1024 
    stream = p.open(format=pyaudio.paFloat32,
                    channels=CHANNELS,
                    rate=SAMPLE_RATE,
                    input=True,
                    frames_per_buffer=READ_CHUNK_SIZE,
                    stream_callback=audio_callback)

    print(json.dumps({"status": "ready", "message": "Listening (Silero VAD + NLLB)..."}), flush=True)
    stream.start_stream()

    buffer_limit = SAMPLE_RATE * 5 # Max 5 seconds buffer
    speech_buffer = np.array([], dtype=np.float32)
    silence_counter = 0
    is_speaking = False
    
    # State for accumulating audio AFTER VAD trigger
    pending_transcription_audio = np.array([], dtype=np.float32)

    try:
        while running:
            if not audio_queue.empty():
                chunk = audio_queue.get()
                
                # VAD Processing (Split chunk into 512 sample sub-chunks for Silero)
                # chunk is 1024.
                vad_scores = []
                sub_chunks = np.array_split(chunk, len(chunk) // 512)
                
                for sub in sub_chunks:
                    if len(sub) == 512:
                        prob = vad.is_speech(sub)
                        vad_scores.append(prob)
                
                # Check if speech is active in this chunk
                # If any sub-chunk is speech, we consider it speech-heavy
                chunk_is_speech = any(s > VAD_THRESHOLD for s in vad_scores)

                if chunk_is_speech:
                    is_speaking = True
                    silence_counter = 0
                    pending_transcription_audio = np.concatenate((pending_transcription_audio, chunk))
                else:
                    silence_counter += 1
                    # Keep a little tail of silence for better phrases
                    if is_speaking:
                         pending_transcription_audio = np.concatenate((pending_transcription_audio, chunk))
                
                # Logic: If we have gathered enough audio AND we hit a silence (or buffer full)
                # We assume the phrase might be complete-ish
                
                # Simple condition: If we are speaking, and have > 2 seconds, transcribe intermediate
                # OR if we stopped speaking (silence > 500ms approx 8 chunks of 64ms) -> transcribe final
                
                audio_len_sec = len(pending_transcription_audio) / SAMPLE_RATE
                
                should_transcribe = False
                is_final_segment = False
                
                if is_speaking and audio_len_sec > 2.0:
                    should_transcribe = True
                elif is_speaking and silence_counter > 8 and audio_len_sec > 0.5:
                    should_transcribe = True
                    is_final_segment = True
                    is_speaking = False # Reset state
                
                
                if should_transcribe:
                    segments, info = whisper.transcribe(
                        pending_transcription_audio, 
                        beam_size=5, 
                        language="en",
                        vad_filter=False # We already did VAD
                    )
                    
                    full_text = " ".join([s.text for s in segments]).strip()
                    
                    if full_text:
                        translated = nllb.translate(full_text)
                        print(json.dumps({
                            "original": full_text,
                            "translated": translated,
                            "is_final": is_final_segment
                        }), flush=True)

                    if is_final_segment or audio_len_sec > 5.0:
                        pending_transcription_audio = np.array([], dtype=np.float32)
                        vad.reset_states() # Reset RNN states for next sentence
                
            else:
                time.sleep(0.01)

    except KeyboardInterrupt:
        pass
    finally:
        running = False
        stream.stop_stream()
        stream.close()
        p.terminate()

if __name__ == "__main__":
    main()
