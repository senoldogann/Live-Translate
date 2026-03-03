from engine import SubtitleEngine, EngineConfig
import time

config = EngineConfig(engine_type="cloud")
e = SubtitleEngine(config)
e.start()
print("Running...")
time.sleep(2)
e.stop()
print("Done!")
