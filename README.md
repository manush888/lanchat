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

3.  **Run the server:**
    ```bash
    node server.js
    ```
    By default, the server will start on `http://localhost:3000`. You should see a log message in your console: `Server listening on port 3000` and `WebSocket server created.`.

4.  **Access the application:**
    Open your web browser and navigate to `http://localhost:3000`.
    You should see the "Welcome to WebChat!" page, and your browser's developer console should show logs related to the WebSocket connection.

## Development

*   **Server-side code:** Modify `server.js` for backend logic, API routes, and WebSocket handling.
*   **Client-side code:** Modify files in the `public/` directory (`index.html`, `style.css`, `client.js`) for frontend structure, styling, and behavior.

Remember to restart the Node.js server (`Ctrl+C` then `node server.js`) after making changes to `server.js` to see them take effect. For frontend changes, usually, a browser refresh is sufficient. Tools like `nodemon` can be used for automatic server restarts during development.
