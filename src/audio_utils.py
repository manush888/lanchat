import sounddevice as sd
import numpy as np
from opuslib import Encoder, Decoder, OpusError
# When running as a script, handle imports differently
if __name__ == '__main__':
    from constants import SAMPLE_RATE, CHANNELS, CHUNK_SIZE
else:
    from .constants import SAMPLE_RATE, CHANNELS, CHUNK_SIZE

# Opus Encoder and Decoder
# These are created once and reused.
try:
    opus_encoder = Encoder(SAMPLE_RATE, CHANNELS, 'voip') # 'voip', 'audio', or 'restricted_lowdelay'
    opus_decoder = Decoder(SAMPLE_RATE, CHANNELS)
except OpusError as e:
    print(f"Failed to initialize Opus encoder/decoder: {e}")
    # Fallback or error handling if Opus is not available or fails to initialize
    opus_encoder = None
    opus_decoder = None

def encode_audio(audio_data_np):
    """
    Encodes raw PCM audio data (NumPy array) using Opus.
    audio_data_np: NumPy array of shape (CHUNK_SIZE,) or (CHUNK_SIZE, CHANNELS)
                   dtype should be np.float32 or np.int16.
                   sounddevice typically provides float32. Opus needs int16.
    """
    if not opus_encoder:
        # print("Opus encoder not available. Using fallback raw int16.")
        if audio_data_np.dtype == np.float32:
            audio_data_np_clipped = np.clip(audio_data_np, -1.0, 1.0)
            audio_data_int16 = (audio_data_np_clipped * 32767).astype(np.int16)
            return audio_data_int16.tobytes()
        elif audio_data_np.dtype == np.int16:
            return audio_data_np.tobytes()
        else:
            raise ValueError(f"Fallback encode: Unsupported audio data type: {audio_data_np.dtype}")

    try:
        # Ensure data is in the correct format (int16) for opuslib
        # Also, Opus expects host byte order. NumPy tobytes() gives host byte order by default.
        if audio_data_np.dtype == np.float32:
            # Clipping before conversion to prevent wrap-around and ensure values are within int16 range
            audio_data_np = np.clip(audio_data_np, -1.0, 1.0)
            audio_data_int16 = (audio_data_np * 32767).astype(np.int16)
        elif audio_data_np.dtype == np.int16:
            audio_data_int16 = audio_data_np
        else:
            raise ValueError(f"Unsupported audio data type: {audio_data_np.dtype}")

        # Opuslib expects bytes
        pcm_bytes = audio_data_int16.tobytes()
        encoded_data = opus_encoder.encode(pcm_bytes, CHUNK_SIZE) # CHUNK_SIZE is frames per buffer
        # print(f"Encoded {len(pcm_bytes)} ({audio_data_int16.dtype}) bytes to {len(encoded_data)} bytes")
        return encoded_data
    except OpusError as e:
        print(f"Opus encoding error: {e}")
        return None # Indicate error
    except Exception as e:
        print(f"Unexpected error during encoding: {e}")
        return None

def decode_audio(encoded_data):
    """
    Decodes Opus-encoded audio data to raw PCM (NumPy array, float32).
    encoded_data: Bytes object containing Opus encoded audio.
    """
    if not opus_decoder:
        # print("Opus decoder not available. Returning raw data as int16 numpy array.")
        # Fallback: assume raw int16 if decoder is missing
        try:
            return np.frombuffer(encoded_data, dtype=np.int16).astype(np.float32) / 32767.0
        except Exception: # If frombuffer fails (e.g. odd length)
            return np.array([], dtype=np.float32)


    try:
        # Opuslib decode returns bytes (PCM int16)
        # The number of samples (frames) must be known. CHUNK_SIZE is what we expect.
        decoded_pcm_bytes = opus_decoder.decode(encoded_data, CHUNK_SIZE, decode_fec=False)

        # Convert PCM bytes back to NumPy array (int16)
        decoded_audio_np_int16 = np.frombuffer(decoded_pcm_bytes, dtype=np.int16)

        # Convert to float32 for sounddevice playback
        decoded_audio_np_float32 = decoded_audio_np_int16.astype(np.float32) / 32767.0
        # print(f"Decoded {len(encoded_data)} bytes to {len(decoded_pcm_bytes)} bytes ({decoded_audio_np_float32.shape})")
        return decoded_audio_np_float32
    except OpusError as e:
        print(f"Opus decoding error: {e}")
        # Return an empty array or handle error appropriately
        # This can happen if the packet is corrupted or not an Opus packet
        return np.array([], dtype=np.float32)
    except Exception as e:
        print(f"Unexpected error during decoding: {e}")
        return np.array([], dtype=np.float32)

# Note: Actual capture_audio and play_audio functions using sounddevice
# will be part of the client logic, as they involve streams that need to be
# actively managed (started/stopped). This file provides the encoding/decoding utilities.

if __name__ == '__main__':
    # Simple test for encoding and decoding
    print("Running audio_utils self-test...")
    if not opus_encoder or not opus_decoder:
        print("Opus not available. Skipping self-test.")
    else:
        print(f"Sample Rate: {SAMPLE_RATE}, Channels: {CHANNELS}, Chunk Size: {CHUNK_SIZE}")
        # Create a dummy audio chunk (sine wave)
        duration = float(CHUNK_SIZE) / SAMPLE_RATE  # seconds
        frequency = 440  # Hz (A4 note)
        t = np.linspace(0, duration, CHUNK_SIZE, endpoint=False, dtype=np.float32)
        dummy_audio_np = 0.5 * np.sin(2 * np.pi * frequency * t)

        print(f"Original data type: {dummy_audio_np.dtype}, shape: {dummy_audio_np.shape}")

        encoded = encode_audio(dummy_audio_np)
        if encoded:
            print(f"Encoded data length: {len(encoded)}")

            decoded = decode_audio(encoded)
            if decoded.size > 0:
                print(f"Decoded data type: {decoded.dtype}, shape: {decoded.shape}")
                # You could check if decoded is similar to dummy_audio_np, but lossy compression means not identical
                mse = np.mean((dummy_audio_np - decoded[:len(dummy_audio_np)])**2) if len(decoded) >= len(dummy_audio_np) else float('inf')
                print(f"Mean Squared Error (original vs decoded): {mse:.6f}")
                if mse < 0.01: # Threshold for successful test
                    print("Self-test: SUCCESS (low MSE)")
                else:
                    print("Self-test: WARNING (high MSE or mismatched length)")
            else:
                print("Self-test: FAILED (decoding returned empty)")
        else:
            print("Self-test: FAILED (encoding returned None)")

    # Test fallback if opus is not available
    print("\nTesting fallback (simulating no Opus)...")
    original_encoder, original_decoder = opus_encoder, opus_decoder
    opus_encoder, opus_decoder = None, None # Simulate Opus not being available

    # Create float32 data, then it will be converted to int16 by encode_audio's fallback
    dummy_audio_float32_for_fallback = np.random.rand(CHUNK_SIZE).astype(np.float32) * 0.8 # Use 0.8 to avoid max vals
    expected_int16_bytes = (dummy_audio_float32_for_fallback * 32767).astype(np.int16).tobytes()

    encoded_fallback = encode_audio(dummy_audio_float32_for_fallback)
    print(f"Fallback encoded length (should be raw int16 bytes): {len(encoded_fallback)}, Expected: {len(expected_int16_bytes)}")

    decoded_fallback_np = decode_audio(encoded_fallback) # This should convert back to float32
    print(f"Fallback decoded shape: {decoded_fallback_np.shape}, dtype: {decoded_fallback_np.dtype}")

    # To compare, convert the decoded float32 back to int16 bytes and compare with original int16 bytes
    # Or, compare the float versions with a tolerance
    # Fallback encode: float32 -> int16 -> bytes
    # Fallback decode: bytes -> int16 -> float32
    # So, decoded_fallback_np should be very close to dummy_audio_float32_for_fallback

    mse_fallback = np.mean((dummy_audio_float32_for_fallback - decoded_fallback_np)**2)
    print(f"Fallback MSE: {mse_fallback:.6f}")
    if mse_fallback < 1e-9: # Should be very small as it's just type conversions
         print("Fallback self-test: SUCCESS")
    else:
         print("Fallback self-test: FAILED")

    opus_encoder, opus_decoder = original_encoder, original_decoder # Restore
