from python.deepgram_engine import DeepgramWSClient

import time
engine = DeepgramWSClient(None)
engine.start()
time.sleep(2)
engine.stop()
print("Done!")
