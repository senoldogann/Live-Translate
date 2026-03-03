import sys
try:
    import websockets.sync.client
    print("Has sync!")
except ImportError as e:
    print(f"No sync: {e}")
except Exception as e:
    print(f"Other err: {e}")
