import asyncio
import socket
from constants import DEFAULT_SERVER_IP, DEFAULT_SERVER_PORT, AUDIO_PORT_OFFSET

# Using a set for clients for efficient add/remove operations.
# Stores (writer, address) tuples for TCP control connections
# and (address) for UDP audio "connections" (just remote address).
clients_tcp = {} # Maps client address (ip, port) to their asyncio StreamWriter
clients_udp_audio = {} # Maps client control address (ip, tcp_port) to their audio address (ip, udp_port)

class ServerAudioProtocol(asyncio.DatagramProtocol):
    def __init__(self, server):
        self.server = server
        self.transport = None

    def connection_made(self, transport):
        self.transport = transport
        print("Audio UDP socket opened.")

    def datagram_received(self, data, addr):
        # When audio data is received from a client, broadcast it to all other clients.
        # print(f"Audio data received from {addr}: {len(data)} bytes")

        # Identify the sender based on their audio address
        sender_control_addr = None
        for control_addr, audio_addr in clients_udp_audio.items():
            if audio_addr == addr:
                sender_control_addr = control_addr
                break

        if not sender_control_addr:
            # print(f"Warning: Received audio from unknown source {addr}")
            return

        for control_addr, audio_addr_target in clients_udp_audio.items():
            if audio_addr_target != addr: # Don't send audio back to the sender
                # print(f"Relaying audio from {sender_control_addr} to {control_addr} via {audio_addr_target}")
                self.transport.sendto(data, audio_addr_target)

    def error_received(self, exc):
        print(f"Audio UDP socket error: {exc}")

    def connection_lost(self, exc):
        print("Audio UDP socket closed.")


async def handle_client_tcp(reader, writer):
    addr = writer.get_extra_info('peername')
    print(f"Client {addr} connected via TCP.")
    clients_tcp[addr] = writer

    # The first message from the client should be its UDP port for audio
    try:
        client_audio_port_data = await reader.read(100)
        client_audio_port_str = client_audio_port_data.decode().strip()

        if not client_audio_port_str.startswith("AUDIO_PORT:"):
            raise ValueError("Invalid audio port message format.")

        client_audio_port = int(client_audio_port_str.split(":")[1])
        client_audio_addr = (addr[0], client_audio_port)
        clients_udp_audio[addr] = client_audio_addr
        print(f"Client {addr} registered audio endpoint {client_audio_addr}")
        writer.write("AUDIO_OK\n".encode())
        await writer.drain()

    except Exception as e:
        print(f"Error setting up audio endpoint for {addr}: {e}")
        writer.close()
        await writer.wait_closed()
        clients_tcp.pop(addr, None)
        clients_udp_audio.pop(addr, None)
        return

    try:
        while True:
            data = await reader.read(1024) # Max size of control messages
            if not data:
                break
            message = data.decode().strip()
            print(f"Received from {addr} (TCP): {message}")

            # Basic PTT signaling (example)
            # Client might send "PTT_START" or "PTT_STOP"
            # Server could broadcast this to other clients if needed, or use it for other logic.
            # For now, TCP is mainly for connection management and future control messages.

    except asyncio.CancelledError:
        print(f"Connection with {addr} cancelled.")
    except ConnectionResetError:
        print(f"Client {addr} forcibly closed connection.")
    except Exception as e:
        print(f"Error with client {addr}: {e}")
    finally:
        print(f"Client {addr} disconnected.")
        clients_tcp.pop(addr, None)
        clients_udp_audio.pop(addr, None) # Remove audio mapping as well
        writer.close()
        await writer.wait_closed()
        # Inform other clients about disconnection? (Future enhancement)

async def main():
    loop = asyncio.get_running_loop()

    # Start TCP server for control messages
    server_tcp = await asyncio.start_server(
        handle_client_tcp, DEFAULT_SERVER_IP, DEFAULT_SERVER_PORT
    )
    addr_tcp = server_tcp.sockets[0].getsockname()
    print(f"TCP Server listening on {addr_tcp}")

    # Start UDP server for audio data
    # The audio port is derived from the TCP port for simplicity
    audio_server_port = DEFAULT_SERVER_PORT + AUDIO_PORT_OFFSET

    # Pass 'server_instance' if ServerAudioProtocol needs to access server's state directly
    # For now, it's self-contained enough or uses global `clients_udp_audio`
    transport_udp, protocol_udp = await loop.create_datagram_endpoint(
        lambda: ServerAudioProtocol(None), # Pass server instance if needed
        local_addr=(DEFAULT_SERVER_IP, audio_server_port)
    )
    print(f"UDP Audio Server listening on {DEFAULT_SERVER_IP}:{audio_server_port}")

    async with server_tcp:
        try:
            await server_tcp.serve_forever()
        except KeyboardInterrupt:
            print("Server shutting down...")
        finally:
            transport_udp.close()
            # Clean up TCP connections
            for addr, writer in list(clients_tcp.items()):
                writer.close()
                try:
                    await writer.wait_closed()
                except Exception as e:
                    print(f"Error closing writer for {addr}: {e}")
            clients_tcp.clear()
            clients_udp_audio.clear()
            print("Server shutdown complete.")

if __name__ == "__main__":
    print("Server application starting...")
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("Server process interrupted by user.")
    except Exception as e:
        print(f"Server failed to start or run: {e}")
