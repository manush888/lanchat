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

(Instructions to be added here once the application is more developed)

## Development

(Information for developers, build instructions, etc.)

### Prerequisites

*   Python 3.x
*   (Later: PortAudio, Opus library)

### Running the server (Future)

```bash
python src/server.py
```

### Running the client (Future)

```bash
python src/client.py <server_ip>
```
