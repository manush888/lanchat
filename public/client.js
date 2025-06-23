console.log("client.js loaded.");

// --- DOM Elements ---
const connectionArea = document.getElementById('connection-area');
const usernameInput = document.getElementById('username');
const adminTokenInput = document.getElementById('adminToken');
const connectButton = document.getElementById('connectButton');
const connectionStatusP = document.getElementById('connection-status');

const chatContainer = document.getElementById('chat-container');
const roomListUl = document.getElementById('roomList');
const adminControlsDiv = document.getElementById('admin-controls');

const currentRoomNameH2 = document.getElementById('currentRoomName');
const userListUl = document.getElementById('userList');
const messagesDiv = document.getElementById('messages');
const messageInput = document.getElementById('messageInput');
const sendMessageButton = document.getElementById('sendMessageButton');

// Admin UI elements
const newRoomNameInput = document.getElementById('newRoomName');
const createRoomButton = document.getElementById('createRoomButton');
const roomToDeleteInput = document.getElementById('roomToDelete');
const deleteRoomButton = document.getElementById('deleteRoomButton');
const oldRoomNameInput = document.getElementById('oldRoomName');
const renamedRoomNameInput = document.getElementById('renamedRoomName');
const renameRoomButton = document.getElementById('renameRoomButton');

// --- WebSocket and State ---
let socket = null;
let userId = null;
let currentUsername = '';
let isAdmin = false;
let currentRoom = null;

// --- Event Listeners ---
connectButton.addEventListener('click', () => {
    currentUsername = usernameInput.value.trim();
    const adminToken = adminTokenInput.value.trim();

    if (!currentUsername) {
        connectionStatusP.textContent = 'Please enter a username.';
        return;
    }
    connectionStatusP.textContent = 'Connecting...';
    connectWebSocket(currentUsername, adminToken);
});

sendMessageButton.addEventListener('click', sendTextMessage);
messageInput.addEventListener('keypress', (event) => {
    if (event.key === 'Enter' && !messageInput.disabled) {
        sendTextMessage();
    }
});

createRoomButton.addEventListener('click', () => {
    if (!isAdmin) { console.warn("Create room action attempted by non-admin."); return; }
    const roomName = newRoomNameInput.value.trim();
    if (roomName) {
        sendMessage({ type: 'createRoom', roomName: roomName });
        newRoomNameInput.value = '';
    } else {
        alert("New room name cannot be empty.");
    }
});

deleteRoomButton.addEventListener('click', () => {
    if (!isAdmin) { console.warn("Delete room action attempted by non-admin."); return; }
    const roomName = roomToDeleteInput.value.trim();
    if (roomName) {
        if (confirm(`Are you sure you want to delete room: ${roomName}?`)) {
            sendMessage({ type: 'deleteRoom', roomName: roomName });
            roomToDeleteInput.value = '';
        }
    } else {
        alert("Room name to delete cannot be empty.");
    }
});

renameRoomButton.addEventListener('click', () => {
    if (!isAdmin) { console.warn("Rename room action attempted by non-admin."); return; }
    const oldName = oldRoomNameInput.value.trim();
    const newName = renamedRoomNameInput.value.trim();
    if (oldName && newName) {
        sendMessage({ type: 'renameRoom', oldName: oldName, newName: newName });
        oldRoomNameInput.value = '';
        renamedRoomNameInput.value = '';
    } else {
        alert("Both old and new room names must be provided.");
    }
});


// --- WebSocket Functions ---
function connectWebSocket(username, adminToken) {
    if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
        console.log('WebSocket is already open or connecting.');
        return;
    }

    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${wsProtocol}//${window.location.host}`;

    console.log(`Attempting to connect WebSocket to: ${wsUrl}`);
    socket = new WebSocket(wsUrl);

    socket.onopen = () => {
        console.log('WebSocket connection established.');
        connectionStatusP.textContent = 'Connection open. Registering...';
        // Send registration message
        sendMessage({
            type: 'register',
            username: username,
            adminToken: adminToken // Send token, server will validate
        });
    };

    socket.onmessage = (event) => {
        let msg;
        try {
            msg = JSON.parse(event.data);
            console.log('Message from server:', msg);
        } catch (e) {
            console.error('Error parsing message from server:', event.data);
            return;
        }

        switch (msg.type) {
            case 'info':
                // General info from server, e.g., initial connection before registration
                connectionStatusP.textContent = msg.message;
                break;
            case 'error':
                connectionStatusP.textContent = `Error: ${msg.message}`;
                console.error('Server error:', msg.message);
                // Could potentially close connection or reset UI if error is critical
                if (socket.readyState === WebSocket.OPEN) {
                    socket.close();
                }
                break;
            case 'echo': // Temporary for testing
                messagesDiv.innerHTML += `<p><em>Server Echo: ${JSON.stringify(msg.originalMessage)}</em></p>`;
                break;
            case 'registered':
                handleRegistered(msg);
                break;
            case 'roomList':
                displayRooms(msg.rooms);
                break;
            case 'joinedRoom':
                handleJoinedRoom(msg);
                break;
            case 'userJoined': // A user joined the current room
                handleUserJoined(msg);
                break;
            case 'userLeft': // A user left the current room
                handleUserLeft(msg);
                break;
            case 'newTextMessage':
                displayNewTextMessage(msg);
                break;
            case 'roomRenamed':
                handleRoomRenamed(msg);
                break;
            default:
                console.log('Received unhandled message type:', msg.type);
        }
    };

    socket.onclose = (event) => {
        console.log('WebSocket connection closed.', event);
        connectionStatusP.textContent = `Disconnected. Code: ${event.code}. Reason: ${event.reason || 'N/A'}`;
        chatContainer.style.display = 'none';
        connectionArea.style.display = 'block';
        adminControlsDiv.style.display = 'none';
        socket = null; // Clear the socket object
    };

    socket.onerror = (error) => {
        console.error('WebSocket error:', error);
        connectionStatusP.textContent = 'WebSocket connection error. See console.';
        // UI reset might be needed here too
        if (socket && socket.readyState !== WebSocket.CLOSED) {
            socket.close(); // Attempt to close if not already closed due to error
        }
    };
}

function sendMessage(messageObject) {
    if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify(messageObject));
    } else {
        console.error('WebSocket is not connected. Cannot send message.');
        connectionStatusP.textContent = 'Not connected. Please connect first.';
    }
}

// --- UI Update Functions (will be expanded) ---
function displayRooms(roomsData) {
    roomListUl.innerHTML = ''; // Clear existing list
    if (roomsData && Object.keys(roomsData).length > 0) {
        for (const roomKey in roomsData) { // Iterate over keys from server, which are room names
            const room = roomsData[roomKey];
            const li = document.createElement('li');
            li.textContent = `${room.name} (${room.userCount} users)`;
            li.dataset.roomName = room.name; // Use the actual name for sending to server
            li.classList.add('room-item'); // Add a class for styling or easier selection
            li.addEventListener('click', () => {
                console.log(`Attempting to join room: ${room.name}`);
                sendMessage({ type: 'joinRoom', roomName: room.name });
            });
            roomListUl.appendChild(li);
        }
    } else {
        roomListUl.innerHTML = '<li>No rooms available.</li>';
    }
}

function handleRegistered(message) {
    userId = message.userId;
    isAdmin = message.isAdmin;
    currentUsername = message.username; // Update local username in case server modified/confirmed it

    connectionStatusP.textContent = message.message;
    connectionArea.style.display = 'none'; // Hide connection form
    chatContainer.style.display = 'flex'; // Show main chat interface (flex for layout)

    if (isAdmin) {
        adminControlsDiv.style.display = 'block'; // Show admin controls
        console.log('Admin status confirmed by server.');
    } else {
        adminControlsDiv.style.display = 'none';
    }
    // The room list is typically sent right after 'registered' or can be requested.
    // If server sends 'roomList' automatically after 'registered', displayRooms will be called.
}


// Initial UI state
connectionArea.style.display = 'block';
chatContainer.style.display = 'none';
adminControlsDiv.style.display = 'none'; // Ensure admin controls are hidden initially

function handleJoinedRoom(message) {
    currentRoom = message.roomName;
    currentRoomNameH2.textContent = `Room: ${currentRoom}`;
    messagesDiv.innerHTML = ''; // Clear messages from previous room
    updateUserList(message.users);
    // Enable message input area, etc.
    messageInput.disabled = false;
    sendMessageButton.disabled = false;
    console.log(`Successfully joined room: ${currentRoom}`);
}

function handleUserJoined(message) {
    if (message.roomName === currentRoom) {
        // Add user to list - assumes message.user is {id, username}
        // For simplicity, just re-fetch or re-render the whole list if not too many users.
        // Or, more efficiently, add the user to the existing list if not present.
        const existingUserLi = userListUl.querySelector(`li[data-user-id="${message.user.id}"]`);
        if (!existingUserLi) {
            const li = document.createElement('li');
            li.textContent = message.user.username;
            li.dataset.userId = message.user.id;
            userListUl.appendChild(li);
        }
        messagesDiv.innerHTML += `<p><em>${message.user.username} joined the room.</em></p>`;
    }
}

function handleUserLeft(message) {
    if (message.roomName === currentRoom) {
        // Remove user from list
        const userLi = userListUl.querySelector(`li[data-user-id="${message.user.id}"]`);
        if (userLi) {
            userLi.remove();
        }
        messagesDiv.innerHTML += `<p><em>${message.user.username} left the room.</em></p>`;
    }
}

function updateUserList(users) {
    userListUl.innerHTML = ''; // Clear existing user list
    if (users && users.length > 0) {
        users.forEach(user => {
            const li = document.createElement('li');
            li.textContent = user.username;
            li.dataset.userId = user.id; // Store user ID if needed for DMs or other features
            userListUl.appendChild(li);
        });
    } else {
        userListUl.innerHTML = '<li>No other users in this room.</li>';
    }
}

function sendTextMessage() {
    const messageText = messageInput.value.trim();
    if (messageText && currentRoom) {
        sendMessage({
            type: 'textMessage',
            content: messageText
        });
        messageInput.value = ''; // Clear input field
    } else if (!currentRoom) {
        console.warn("Cannot send message, not in a room.");
        // Optionally display this to the user in the UI
    }
}

function displayNewTextMessage(message) {
    // Ensure this client is in the room the message is for (though server should handle this)
    // For now, we assume if we receive it, it's for our current room or global.
    const p = document.createElement('p');
    p.innerHTML = `<strong>${message.username}:</strong> ${message.content}`; // Use innerHTML if you might include HTML tags from user, otherwise textContent and create nodes manually for safety.
    messagesDiv.appendChild(p);
    messagesDiv.scrollTop = messagesDiv.scrollHeight; // Scroll to bottom
}

function handleRoomRenamed(message) {
    // The server should have already updated the global room list via 'roomList' broadcast.
    // This handler is mostly for updating the current client's view if they are in the renamed room.
    if (currentRoom === message.oldName) {
        currentRoom = message.newName;
        currentRoomNameH2.textContent = `Room: ${currentRoom}`;
        messagesDiv.innerHTML += `<p><em>${message.message}</em></p>`;
    }
    // Potentially, also update the room name in the displayed list if it's not fully re-rendered by 'roomList'
    const roomLi = roomListUl.querySelector(`li[data-room-name="${message.oldName}"]`);
    if (roomLi) {
        roomLi.dataset.roomName = message.newName;
        // Re-extract user count or assume roomList message will refresh it.
        // For simplicity, let's assume roomList will handle the full text update.
        // If not, you'd update textContent here too.
        console.log(`Room ${message.oldName} was renamed to ${message.newName}. UI updated if it was current room.`);
    }
}

console.log('Client-side script fully loaded and initialized.');
