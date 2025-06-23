import asyncio
import socket
import sounddevice as sd
import numpy as np
import keyboard # For PTT
import argparse
import threading

from .constants import (
    DEFAULT_SERVER_PORT,
    AUDIO_PORT_OFFSET,
    SAMPLE_RATE,
    CHANNELS,
    CHUNK_SIZE,
    PTT_KEY
)
from .audio_utils import encode_audio, decode_audio

# Global state
is_ptt_active = False
shutdown_event = asyncio.Event() # Used to signal all tasks to shut down
loop = None # Will hold the asyncio event loop for the main client thread

# Audio callback for sounddevice stream (input)
def audio_input_callback(indata, frames, time, status):
    """
    This is called by sounddevice in a separate thread for each new audio chunk from the microphone.
    """
    global is_ptt_active
    if status:
        print(f"Audio input status: {status}", flush=True)

    if is_ptt_active and hasattr(audio_input_callback, 'udp_socket') and hasattr(audio_input_callback, 'server_audio_addr'):
        # print(f"PTT active, sending {frames} frames", flush=True)
        encoded_data = encode_audio(indata) # indata is a NumPy array
        if encoded_data:
            try:
                audio_input_callback.udp_socket.sendto(encoded_data, audio_input_callback.server_audio_addr)
            except Exception as e:
                print(f"Error sending audio data: {e}", flush=True)
    # else:
        # print(f"PTT not active or UDP not ready. Frames: {frames}", flush=True)


# Audio output callback for sounddevice stream (output) - not directly used for playback from network
# Instead, we will directly use sd.play() or manage an OutputStream buffer.
# For simplicity, received audio will be played directly in the network listening loop.

def ptt_on():
    global is_ptt_active
    if not is_ptt_active:
        # print("PTT ON", flush=True)
        is_ptt_active = True

def ptt_off():
    global is_ptt_active
    if is_ptt_active:
        # print("PTT OFF", flush=True)
        is_ptt_active = False

async def listen_for_audio(udp_socket, output_stream):
    """
    Listens for incoming audio data on the UDP socket and plays it.
    """
    print(f"Listening for audio on UDP {udp_socket.getsockname()}", flush=True)
    try:
        while not shutdown_event.is_set():
            try:
                # Use a small timeout to allow checking shutdown_event periodically
                udp_socket.settimeout(0.1)
                data, addr = udp_socket.recvfrom(CHUNK_SIZE * 4) # Buffer size, assuming max compression still fits
                # print(f"Received audio from {addr}, {len(data)} bytes", flush=True)
                if data:
                    decoded_audio = decode_audio(data)
                    if decoded_audio.size > 0:
                        output_stream.write(decoded_audio) # Play decoded audio
                    # else:
                        # print("Decoded audio is empty, possibly a decode error or silent packet.", flush=True)
            except socket.timeout:
                continue # Just to check shutdown_event
            except Exception as e:
                print(f"Error receiving/playing audio: {e}", flush=True)
                await asyncio.sleep(0.01) # Avoid busy-looping on continuous errors
    except asyncio.CancelledError:
        print("Audio listening task cancelled.", flush=True)
    finally:
        print("Audio listening stopped.", flush=True)


async def main_client(server_ip, server_port_tcp):
    global loop
    loop = asyncio.get_running_loop() # Get the loop for this async context

    # --- Setup PTT ---
    # keyboard.on_press_key(PTT_KEY, lambda _: ptt_on(), suppress=False)
    # keyboard.on_release_key(PTT_KEY, lambda _: ptt_off(), suppress=False)
    # Using keyboard.add_hotkey for better PTT semantics (triggers once on press/release)
    try:
        keyboard.add_hotkey(PTT_KEY, ptt_on, suppress=False, trigger_on_release=False)
        keyboard.add_hotkey(PTT_KEY, ptt_off, suppress=False, trigger_on_release=True)
        print(f"PTT enabled. Press and hold '{PTT_KEY}' to talk.", flush=True)
    except Exception as e:
        print(f"Could not set up PTT hotkey '{PTT_KEY}'. Is 'sudo' required or is the key name correct? Error: {e}", flush=True)
        print("PTT will NOT work. You may need to run as root or configure input permissions.", flush=True)


    # --- Setup UDP socket for audio ---
    # Create UDP socket for sending and receiving audio
    # Client needs to pick a free UDP port.
    client_udp_socket = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    client_udp_socket.bind(('', 0)) # Bind to any available local port
    client_udp_port = client_udp_socket.getsockname()[1]
    print(f"Client UDP audio endpoint: {client_udp_socket.getsockname()}", flush=True)

    server_audio_port_udp = server_port_tcp + AUDIO_PORT_OFFSET
    server_audio_addr = (server_ip, server_audio_port_udp)

    # Make server_audio_addr available to the audio_input_callback
    audio_input_callback.udp_socket = client_udp_socket
    audio_input_callback.server_audio_addr = server_audio_addr


    # --- TCP Connection to Server ---
    try:
        reader, writer = await asyncio.open_connection(server_ip, server_port_tcp)
        print(f"Connected to server {server_ip}:{server_port_tcp} via TCP.", flush=True)

        # Send our UDP audio port to the server
        writer.write(f"AUDIO_PORT:{client_udp_port}\n".encode())
        await writer.drain()

        response = await reader.read(100)
        if response.decode().strip() == "AUDIO_OK":
            print("Server acknowledged UDP audio port.", flush=True)
        else:
            print("Server did NOT acknowledge UDP audio port. Exiting.", flush=True)
            client_udp_socket.close()
            writer.close()
            await writer.wait_closed()
            return
    except ConnectionRefusedError:
        print(f"Connection refused by server {server_ip}:{server_port_tcp}. Is it running?", flush=True)
        client_udp_socket.close()
        return
    except Exception as e:
        print(f"Failed to connect to server or register audio port: {e}", flush=True)
        client_udp_socket.close()
        return

    # --- Setup Audio Streams (Input and Output) ---
    # Using a callback for input, and direct play for output.
    # dtype='float32' is standard for sounddevice and works well with NumPy.
    try:
        # Input stream (microphone)
        input_stream = sd.InputStream(
            samplerate=SAMPLE_RATE,
            channels=CHANNELS,
            dtype='float32',
            blocksize=CHUNK_SIZE, # This is frames per buffer
            callback=audio_input_callback
        )
        # Output stream (speakers)
        output_stream = sd.OutputStream(
            samplerate=SAMPLE_RATE,
            channels=CHANNELS,
            dtype='float32',
            blocksize=CHUNK_SIZE # This is frames per buffer
        )
        input_stream.start()
        output_stream.start()
        print("Audio input and output streams started.", flush=True)
    except Exception as e:
        print(f"Error starting audio streams: {e}", flush=True)
        print("Make sure you have a working microphone and speaker configuration.", flush=True)
        # Attempt to clean up network connections before exiting
        writer.write("QUIT\n".encode()) # Inform server
        await writer.drain()
        writer.close()
        await writer.wait_closed()
        client_udp_socket.close()
        return


    # --- Main Client Loop ---
    # Create task for listening to incoming audio
    audio_listener_task = asyncio.create_task(listen_for_audio(client_udp_socket, output_stream))

    try:
        while not shutdown_event.is_set():
            # Keep the main connection alive, listen for control messages from server (if any)
            # For now, just check if the TCP connection is still alive by trying to read with a timeout.
            try:
                # Set a timeout for the read operation
                control_data = await asyncio.wait_for(reader.read(1024), timeout=1.0)
                if not control_data:
                    print("Server closed TCP connection. Exiting...", flush=True)
                    break
                # Process control_data if server sends any (e.g., "KICK", "MUTE")
                print(f"Server message: {control_data.decode().strip()}", flush=True)
            except asyncio.TimeoutError:
                pass # No data received, which is fine, just checking connection.
            except ConnectionResetError:
                print("Server connection lost (reset). Exiting...", flush=True)
                break
            except Exception as e:
                print(f"Error on TCP connection: {e}", flush=True)
                break

            # Allow other tasks to run
            await asyncio.sleep(0.1)

    except KeyboardInterrupt:
        print("Shutdown requested by user (Ctrl+C).", flush=True)
    except asyncio.CancelledError:
        print("Main client task cancelled.", flush=True)
    finally:
        print("Shutting down client...", flush=True)
        shutdown_event.set() # Signal all tasks to stop

        if 'keyboard' in globals() and PTT_KEY:
            try:
                keyboard.remove_all_hotkeys() # Clean up PTT hooks
                print("PTT hotkeys removed.", flush=True)
            except Exception as e:
                print(f"Error removing PTT hotkeys: {e}", flush=True)

        if 'input_stream' in locals() and input_stream:
            input_stream.stop()
            input_stream.close()
            print("Audio input stream stopped and closed.", flush=True)
        if 'output_stream' in locals() and output_stream:
            output_stream.stop()
            output_stream.close()
            print("Audio output stream stopped and closed.", flush=True)

        if 'audio_listener_task' in locals() and audio_listener_task:
            audio_listener_task.cancel()
            try:
                await audio_listener_task
            except asyncio.CancelledError:
                print("Audio listener task successfully cancelled.", flush=True)
            except Exception as e:
                print(f"Error during audio_listener_task cleanup: {e}", flush=True)

        if 'writer' in locals() and writer:
            if not writer.is_closing():
                try:
                    writer.write("QUIT\n".encode()) # Inform server
                    await writer.drain()
                except Exception as e:
                    print(f"Error sending QUIT to server: {e}", flush=True)
                finally:
                    writer.close()
                    try:
                        await writer.wait_closed()
                    except Exception as e:
                         print(f"Error waiting for writer to close: {e}", flush=True)
            print("TCP writer closed.", flush=True)

        if 'client_udp_socket' in locals() and client_udp_socket:
            client_udp_socket.close()
            print("UDP socket closed.", flush=True)

        print("Client shutdown complete.", flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="LAN Voice Chat Client")
    parser.add_argument("server_ip", help="IP address of the server")
    parser.add_argument("-p", "--port", type=int, default=DEFAULT_SERVER_PORT,
                        help=f"TCP port of the server (default: {DEFAULT_SERVER_PORT})")
    args = parser.parse_args()

    print("Client application starting...", flush=True)
    # sd.query_devices() # Useful for debugging audio devices
    # print(f"Default input device: {sd.default.device[0]}, Default output device: {sd.default.device[1]}", flush=True)


    try:
        asyncio.run(main_client(args.server_ip, args.port))
    except KeyboardInterrupt:
        print("Client terminated by user (main asyncio run).", flush=True)
    except Exception as e:
        print(f"Unhandled exception in client: {e}", flush=True)
    finally:
        # Ensure PTT is off if loop was somehow exited abruptly
        ptt_off()
        # One final attempt to clean hotkeys if loop didn't handle it
        # This is tricky because keyboard hooks might be in a different thread
        # and rely on the main loop running for their context in some cases.
        # The `finally` in `main_client` is the preferred place for this.
        print("Client application finished.", flush=True)
