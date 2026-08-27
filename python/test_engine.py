import time

from engine import EngineConfig, SubtitleEngine

config = EngineConfig(engine_type="cloud")
e = SubtitleEngine(config)
e.start()
print("Running...")
time.sleep(2)
e.stop()
print("Done!")
