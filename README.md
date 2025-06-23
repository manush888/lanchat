# WebChat - A Node.js Voice Chat Application

This project is a web-based voice chat application built with Node.js, Express, and WebSockets for signaling, aiming for WebRTC integration for audio communication.

## Current Status

Basic project structure with an HTTP server (Express.js) and WebSocket signaling server (`ws` library) is implemented. Clients can connect to the server, and basic text messages are exchanged over WebSockets.

## Features (Planned & In Progress)

*   **Backend:** Node.js with Express.js
*   **Frontend:** HTML, CSS, Vanilla JavaScript
*   **Signaling:** WebSockets (`ws` library)
*   **Audio Communication:** WebRTC (to be implemented)
*   User authentication (future)
*   Chat rooms/channels (future)

## Project Structure

*   `server.js`: Main Node.js application file (Express server and WebSocket server).
*   `public/`: Directory for static frontend files.
    *   `index.html`: Main HTML page for the client.
    *   `style.css`: Basic CSS for the client.
    *   `client.js`: Client-side JavaScript for WebSocket communication and UI interaction.
*   `package.json`: Node.js project manifest, lists dependencies.
*   `package-lock.json`: Records exact versions of dependencies.
*   `.gitignore`: Specifies intentionally untracked files by Git (e.g., `node_modules`).

## Prerequisites

*   [Node.js](https://nodejs.org/) (version 14.x or later recommended)
*   [npm](https://www.npmjs.com/) (usually comes with Node.js)

## Setup and Usage

1.  **Clone the repository (if you haven't already):**
    ```bash
    git clone <repository_url>
    cd <repository_directory>
    ```

2.  **Install dependencies:**
    Navigate to the project's root directory in your terminal and run:
    ```bash
    npm install
    ```
    This will install all the necessary packages defined in `package.json` into the `node_modules` directory.

3.  **Generate Self-Signed SSL Certificates (for local development):**
    Microphone access via `getUserMedia` requires a secure context (HTTPS). For local development, you can generate self-signed certificates. If you have OpenSSL installed, run this command in the project root:
    ```bash
    openssl req -x509 -newkey rsa:2048 -keyout key.pem -out cert.pem -sha256 -days 365 -nodes -subj "/C=XX/ST=State/L=City/O=Organization/OU=OrgUnit/CN=localhost"
    ```
    This will create `key.pem` and `cert.pem`. These files are included in `.gitignore` and should not be committed if they are specific to your local setup.
    *(Note: If OpenSSL is not available, you may need to find an alternative way to generate these files, e.g., using Node.js tools like `selfsigned` or other system utilities.)*

4.  **Run the server:**
    ```bash
    node server.js
    ```
    The server will attempt to start using HTTPS on `https://localhost:3000` (or your configured `PORT`). You should see log messages indicating whether HTTPS or HTTP (fallback) server started. For WebRTC voice features, HTTPS is required.

5.  **Access the application:**
    Open your web browser and navigate to `https://localhost:3000`.
    *   **Browser Warning:** Since you're using a self-signed certificate, your browser will display a security warning (e.g., "Your connection is not private", "NET::ERR_CERT_AUTHORITY_INVALID"). This is expected.
    *   **Bypass Warning:** You need to bypass this warning. Look for an "Advanced" button or link, then click "Proceed to localhost (unsafe)" or a similar option.
    *   Once bypassed, the page should load, and microphone access should now be possible.

## Development

*   **Server-side code:** Modify `server.js` for backend logic, API routes, and WebSocket handling.
*   **Client-side code:** Modify files in the `public/` directory (`index.html`, `style.css`, `client.js`) for frontend structure, styling, and behavior.

Remember to restart the Node.js server (`Ctrl+C` then `node server.js`) after making changes to `server.js` to see them take effect. For frontend changes, usually, a browser refresh is sufficient. Tools like `nodemon` can be used for automatic server restarts during development.
