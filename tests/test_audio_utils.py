import unittest
import numpy as np
import sys
import os

import unittest.mock as mock # Moved to top
import src.audio_utils as au # Moved to top
import sys # Ensure sys is imported if not already
import os # Ensure os is imported if not already

# Adjust path to import from parent directory (project root)
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from src.audio_utils import encode_audio, decode_audio, opus_encoder, opus_decoder # type: ignore
from src.constants import CHUNK_SIZE, SAMPLE_RATE, CHANNELS # type: ignore

class TestAudioUtils(unittest.TestCase):

    def setUp(self):
        # Create sample audio data for testing
        # A simple sine wave
        duration = float(CHUNK_SIZE) / SAMPLE_RATE
        frequency = 440  # Hz
        t = np.linspace(0, duration, CHUNK_SIZE, endpoint=False, dtype=np.float32)
        self.sample_audio_float32 = 0.5 * np.sin(2 * np.pi * frequency * t)

        # Expected int16 version (for fallback tests)
        self.sample_audio_int16 = (np.clip(self.sample_audio_float32, -1.0, 1.0) * 32767).astype(np.int16)
        self.sample_audio_int16_bytes = self.sample_audio_int16.tobytes()

    @unittest.skipIf(not opus_encoder or not opus_decoder, "Opus library not available or failed to initialize")
    def test_opus_encode_decode_cycle(self):
        """Test encoding and then decoding with Opus returns data of the correct type and shape."""
        encoded_data = au.encode_audio(self.sample_audio_float32) # Use au.encode_audio
        self.assertIsNotNone(encoded_data, "Encoded data should not be None")
        self.assertIsInstance(encoded_data, bytes, "Encoded data should be bytes")
        self.assertTrue(0 < len(encoded_data) < len(self.sample_audio_int16_bytes),
                        "Opus encoded data should be smaller than raw PCM data but not empty.")

        decoded_audio = au.decode_audio(encoded_data) # Use au.decode_audio
        self.assertIsNotNone(decoded_audio, "Decoded audio should not be None")
        self.assertIsInstance(decoded_audio, np.ndarray, "Decoded audio should be a NumPy array")
        self.assertEqual(decoded_audio.dtype, np.float32, "Decoded audio dtype should be float32")
        self.assertEqual(decoded_audio.shape, (CHUNK_SIZE,),
                         f"Decoded audio shape should be ({CHUNK_SIZE},) but was {decoded_audio.shape}")

        # Check MSE - this can be high for Opus, so use a lenient threshold
        # This test is more about the process working than perfect reconstruction
        if decoded_audio.size == self.sample_audio_float32.size:
            mse = np.mean((self.sample_audio_float32 - decoded_audio)**2)
            self.assertLess(mse, 0.2, f"MSE {mse} too high, indicates significant data corruption or decode issue.")
        else:
            self.fail(f"Decoded audio size {decoded_audio.size} does not match original {self.sample_audio_float32.size}")

    def test_fallback_encode_float32(self):
        """Test fallback encoding for float32 input."""
        with mock.patch.object(au, 'opus_encoder', None):
            encoded_data = au.encode_audio(self.sample_audio_float32) # Use au.encode_audio
            self.assertIsNotNone(encoded_data)
            self.assertIsInstance(encoded_data, bytes)
            self.assertEqual(len(encoded_data), CHUNK_SIZE * CHANNELS * 2, # 2 bytes per int16 sample
                             "Fallback encoded data length is incorrect.")
            self.assertEqual(encoded_data, self.sample_audio_int16_bytes,
                             "Fallback encoded data does not match expected int16 bytes.")

    def test_fallback_decode_int16_bytes(self):
        """Test fallback decoding for int16 byte input."""
        with mock.patch.object(au, 'opus_decoder', None):
            decoded_audio = au.decode_audio(self.sample_audio_int16_bytes)
            self.assertIsNotNone(decoded_audio)
            self.assertIsInstance(decoded_audio, np.ndarray)
            self.assertEqual(decoded_audio.dtype, np.float32)
            self.assertEqual(decoded_audio.shape, (CHUNK_SIZE,),
                             f"Decoded audio shape should be ({CHUNK_SIZE},) but was {decoded_audio.shape}")

            # Compare with original float32 data, allowing for quantization errors
            # (float -> int -> float conversion)
            mse = np.mean((self.sample_audio_float32 - decoded_audio)**2)
            self.assertLess(mse, 1e-8, f"Fallback decode MSE {mse} too high. Should be near zero.")

    def test_encode_empty_input(self):
        """Test encoding with empty NumPy array."""
        empty_audio = np.array([], dtype=np.float32)
        # This should ideally raise an error or return None/empty bytes,
        # depending on opuslib's behavior or our handling.
        # Opus encoder expects a specific number of samples.
        if opus_encoder:
            with self.assertRaises(Exception): # Opus will likely error out
                 encode_audio(empty_audio)
        else: # Fallback
            encoded = encode_audio(empty_audio)
            self.assertEqual(len(encoded),0)


    def test_decode_empty_input(self):
        """Test decoding with empty bytes."""
        empty_bytes = b''
        decoded_audio = decode_audio(empty_bytes)
        self.assertIsInstance(decoded_audio, np.ndarray)
        self.assertEqual(decoded_audio.size, 0, "Decoding empty bytes should result in an empty array")

    def test_decode_invalid_opus_data(self):
        """Test decoding random bytes (highly unlikely to be valid Opus)."""
        random_bytes = os.urandom(100) # 100 random bytes
        if opus_decoder: # Only run if Opus is active
            decoded_audio = decode_audio(random_bytes)
            self.assertIsInstance(decoded_audio, np.ndarray)
            # Opus decoder should ideally return empty or indicate error (which decode_audio turns to empty array)
            self.assertEqual(decoded_audio.size, 0,
                             "Decoding random bytes with Opus should result in an empty array or error")
        else:
            # Fallback decode will try to interpret as int16. Might produce data if len is even.
            # If len is odd, frombuffer will error.
            # This test is more relevant for Opus robustness.
            self.skipTest("Skipping invalid data test for fallback decode, focus is on Opus behavior.")


if __name__ == '__main__':
    unittest.main()
