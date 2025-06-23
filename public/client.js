console.log("client.js loaded.");

const messagesDiv = document.getElementById('messages');
const statusP = document.querySelector('p'); // To update connection status

// Determine WebSocket protocol based on HTTP protocol
const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
const wsUrl = `${wsProtocol}//${window.location.host}`;

console.log(`Attempting to connect WebSocket to: ${wsUrl}`);
const socket = new WebSocket(wsUrl);

socket.onopen = () => {
    console.log('WebSocket connection established.');
    statusP.textContent = 'Connected to WebSocket server!';
    messagesDiv.innerHTML += '<p><em>Connected to WebSocket server!</em></p>';
    socket.send('Hello Server from Client!');
};

socket.onmessage = (event) => {
    console.log('Message from server:', event.data);
    const messageText = event.data instanceof Blob ? 'Received a Blob' : event.data;
    messagesDiv.innerHTML += `<p>Server: ${messageText}</p>`;
};

socket.onclose = (event) => {
    console.log('WebSocket connection closed.', event);
    statusP.textContent = 'Disconnected from WebSocket server.';
    messagesDiv.innerHTML += `<p><em>Disconnected from WebSocket server. Code: ${event.code}, Reason: ${event.reason || 'N/A'}</em></p>`;
};

socket.onerror = (error) => {
    console.error('WebSocket error:', error);
    statusP.textContent = 'WebSocket connection error.';
    messagesDiv.innerHTML += '<p><em>Error connecting to WebSocket server.</em></p>';
};

// Example: Sending a message after a delay (for testing)
setTimeout(() => {
    if (socket.readyState === WebSocket.OPEN) {
        socket.send('This is a delayed test message from client.');
    }
}, 3000);
