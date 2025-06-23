# LAN Voice Chat for Gamers

This project aims to create a simple, low-latency LAN voice chat application primarily for gamers on Linux.

## Current Status

Initial project structure has been set up. The next step is to implement the basic server functionality.

## Features (Planned)

*   Server-client architecture
*   Push-to-Talk (PTT)
*   High-quality audio using Opus codec
*   Low latency
*   Cross-platform (initially Linux, potentially Windows/macOS later)

## Project Structure

*   `src/`: Contains the core source code.
    *   `client.py`: Client application logic.
    *   `server.py`: Server application logic.
    *   `audio_utils.py`: Utilities for audio processing.
    *   `constants.py`: Shared constants like network ports and audio settings.
*   `tests/`: Contains unit and integration tests.
*   `docs/`: Contains detailed documentation.
*   `requirements.txt`: Lists Python dependencies.
*   `.gitignore`: Specifies intentionally untracked files that Git should ignore.

## Setup and Usage

1.  **Install dependencies:**
    ```bash
    pip install -r requirements.txt
    ```

2.  **Run the server:**
    Open a terminal in the **root directory** of the project. To ensure Python correctly handles the project's package structure, run the server as a module:
    ```bash
    python -m src.server
    ```
    The server will print the IP and port it's listening on.
    *(Note: Running `python src/server.py` directly will result in an `ImportError` due to how Python handles packages.)*

3.  **Run the client:**
    Open another terminal in the **root directory** of the project. Similar to the server, run the client as a module:
    ```bash
    python -m src.client <server_ip>
    ```
    Replace `<server_ip>` with the IP address the server is running on (e.g., `192.168.1.5` or `127.0.0.1` if running on the same machine).
    *(Note: Running `python src/client.py <server_ip>` directly will also cause import errors.)*
    You can optionally specify the server's TCP port using the `-p` or `--port` flag if it's different from the default.

    Example:
    ```bash
    python -m src.client 192.168.1.100
    python -m src.client 127.0.0.1 -p 12345
    ```

    Press and hold the `Right Ctrl` key to talk (Push-to-Talk).

## Development

(Information for developers, build instructions, etc.)

### Prerequisites

*   Python 3.8+
*   PortAudio (for `sounddevice` library). On Debian/Ubuntu, you can install it with:
    ```bash
    sudo apt-get update
    sudo apt-get install libportaudio2
    ```
    For other systems, please refer to the PortAudio website or your system's package manager.
*   (Later: Opus library)

### Running the server (for development)

From the project root directory:
```bash
python -m src.server
```

### Running the client (for development)

From the project root directory:
```bash
python -m src.client <server_ip>
```
