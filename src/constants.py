# LAN Voice Chat - Constants
# Network configuration
DEFAULT_SERVER_IP = '0.0.0.0' # Listen on all available interfaces
DEFAULT_SERVER_PORT = 12345    # Port for control messages (TCP)
AUDIO_PORT_OFFSET = 1          # Offset for audio data port (UDP), so UDP port = TCP_PORT + AUDIO_PORT_OFFSET

# Audio configuration
SAMPLE_RATE = 48000  # Hz
CHANNELS = 1         # Mono
CHUNK_SIZE = 960     # Samples per frame (20ms at 48kHz) Opus preferred frame sizes: 2.5, 5, 10, 20, 40, 60 ms
                     # For 48000 Hz, 20ms = 48000 * 0.020 = 960 samples
PTT_KEY = 'ctrl_r'   # Default Push-to-Talk key (using keyboard library names)
