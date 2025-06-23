console.log("client.js loaded.");

// --- DOM Elements ---
const connectionArea = document.getElementById('connection-area');
const usernameInput = document.getElementById('username');
const adminTokenInput = document.getElementById('adminToken');
const connectButton = document.getElementById('connectButton');
const connectionStatusP = document.getElementById('connection-status');

const chatContainer = document.getElementById('chat-container');
const roomListUl = document.getElementById('roomList');
// const adminControlsDiv = document.getElementById('admin-controls'); // Removed

const currentRoomNameH2 = document.getElementById('currentRoomName');
const userListUl = document.getElementById('userList');
const messagesDiv = document.getElementById('messages');
const messageInput = document.getElementById('messageInput');
const sendMessageButton = document.getElementById('sendMessageButton');
const enableVoiceButton = document.getElementById('enableVoiceButton');
const toggleVoiceModeButton = document.getElementById('toggleVoiceModeButton');
const voiceStatusP = document.getElementById('voice-status');
const localAudioPlayback = document.getElementById('localAudioPlayback'); // Optional
const remoteAudioContainer = document.getElementById('remoteAudioContainer');

// Old Admin UI elements are removed. Per-room buttons are handled via event delegation.

// --- WebSocket and State ---
let socket = null;
let userId = null;
let currentUsername = '';
let isAdmin = false;
let currentRoom = null;
let localAudioStream = null;
let peerConnections = {}; // Map peerId to RTCPeerConnection object
let isVoiceActive = false; // True if getUserMedia successful and voice features are generally on
let currentMicMode = 'ptt'; // 'ptt' or 'open'
let isPttKeyDown = false; // Tracks if PTT key is currently held down
// Removed old isMicMuted variable

const PTT_KEY = 'Space'; // Using 'Space' (event.code) or ' ' (event.key)
// const PTT_KEY_CODE = 'Space'; // More specific for event.code

const ICE_SERVERS = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' }
    // Add more STUN/TURN servers if needed
];

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

roomListUl.addEventListener('click', (event) => {
    if (!isAdmin) return; // Only admins can use these buttons

    const target = event.target;
    const roomName = target.dataset.roomname;

    if (!roomName) return; // Click was not on a button with roomname

    if (target.classList.contains('rename-room-btn')) {
        const newName = prompt(`Enter new name for room "${roomName}":`, roomName);
        if (newName && newName.trim() !== '' && newName.trim() !== roomName) {
            sendMessage({ type: 'renameRoom', oldName: roomName, newName: newName.trim() });
        } else if (newName !== null) { // Not cancelled, but empty or same name
            alert("New room name must be different and not empty.");
        }
    } else if (target.classList.contains('delete-room-btn')) {
        if (confirm(`Are you sure you want to delete room "${roomName}"?`)) {
            sendMessage({ type: 'deleteRoom', roomName: roomName });
        }
    }
});

enableVoiceButton.addEventListener('click', async () => {
    if (!isVoiceActive) { // Button is "Enable Voice"
        try {
            voiceStatusP.textContent = 'Requesting microphone access...';
            localAudioStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });

            isVoiceActive = true;
            currentMicMode = 'ptt'; // Default to PTT
            localAudioStream.getTracks().forEach(track => track.enabled = false); // PTT default: muted

            enableVoiceButton.textContent = 'Disable Voice';
            enableVoiceButton.disabled = false; // It's now the disable button

            toggleVoiceModeButton.textContent = 'Use Open Mic';
            toggleVoiceModeButton.style.display = 'inline-block';
            toggleVoiceModeButton.disabled = false;

            voiceStatusP.textContent = `PTT Active: Hold ${PTT_KEY} to Talk`;

            console.log("Local audio stream obtained. PTT Mode active by default.", localAudioStream);
            addPttListeners();
            initiateCallsToExistingRoomMembers();
        } catch (error) {
            console.error('Error accessing microphone:', error);
            voiceStatusP.textContent = `Error: ${error.name} - ${error.message}. Ensure mic is allowed and page is HTTPS.`;
            localAudioStream = null;
            isVoiceActive = false;
            enableVoiceButton.textContent = 'Enable Voice'; // Reset button
            toggleVoiceModeButton.style.display = 'none'; // Hide toggle button
        }
    } else { // Button is "Disable Voice"
        // Call completelyDisableVoice() - This function will be created in the next step.
        // For now, let's log it.
        // console.log("Disable Voice button clicked. Will call completelyDisableVoice().");
        completelyDisableVoice();
    }
});

// Old admin button event listeners (createRoomButton, deleteRoomButton, renameRoomButton) are removed.
// New per-room admin actions are handled by event delegation on roomListUl.

toggleVoiceModeButton.addEventListener('click', () => {
    if (!isVoiceActive || !localAudioStream) {
        console.warn("toggleVoiceModeButton clicked but voice is not active or stream not available.");
        return;
    }

    if (currentMicMode === 'ptt') {
        // Switching to Open Mic
        currentMicMode = 'open';
        localAudioStream.getTracks().forEach(track => track.enabled = true); // Enable tracks for open mic
        toggleVoiceModeButton.textContent = 'Use PTT Mode';
        voiceStatusP.textContent = 'Open Mic: Transmitting';
        isPttKeyDown = false; // Ensure PTT key state is reset
        console.log("Switched to Open Mic mode.");
        // PTT listeners remain, but PTT handlers will check currentMicMode
    } else { // currentMicMode === 'open'
        // Switching back to PTT
        currentMicMode = 'ptt';
        localAudioStream.getTracks().forEach(track => track.enabled = false); // Disable tracks for PTT default
        toggleVoiceModeButton.textContent = 'Use Open Mic';
        voiceStatusP.textContent = `PTT Active: Hold ${PTT_KEY} to Talk`;
        console.log("Switched to PTT mode.");
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
            case 'webrtcOffer':
                handleWebRTCOffer(msg);
                break;
            case 'webrtcAnswer':
                handleWebRTCAnswer(msg);
                break;
            case 'webrtcIceCandidate':
                handleWebRTCIceCandidate(msg);
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
        // adminControlsDiv.style.display = 'none'; // Old admin controls div logic removed
        socket = null; // Clear the socket object
        closeAllPeerConnections(); // Clean up WebRTC connections for UI consistency
        resetVoiceControlsToDefault(); // Stop mic & reset UI fully on disconnect
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

async function handleWebRTCAnswer(message) {
    const { senderUserId, answer } = message;
    console.log(`Received WebRTC answer from ${senderUserId}:`, answer.sdp.substring(0,30) + "...");

    const pc = peerConnections[senderUserId];
    if (!pc) {
        console.error(`Received answer from ${senderUserId}, but no peer connection found.`);
        return;
    }

    // Check if signaling state is appropriate for setting remote answer
    // For example, 'have-local-offer' is a common state when expecting an answer.
    if (pc.signalingState === 'have-local-offer' || pc.signalingState === 'stable') { // Stable if polite peer resets state
        try {
            await pc.setRemoteDescription(new RTCSessionDescription(answer));
            console.log(`Remote description (answer) set for ${senderUserId}. Connection should establish.`);
        } catch (error) {
            console.error(`Error setting remote description (answer) from ${senderUserId}:`, error);
        }
    } else {
        console.warn(`Received answer from ${senderUserId}, but signaling state is ${pc.signalingState}. May not be able to apply answer.`);
        // Potentially, if state is stable, it might be a re-negotiation or a polite peer scenario.
        // If it's unexpected, it might indicate a glare issue or out-of-order messages.
        // For robustness, one might buffer answers if state is not yet 'have-local-offer',
        // or handle more complex state transitions. For now, we'll log a warning.
    }
}

async function handleWebRTCOffer(message) {
    const { senderUserId, offer } = message;
    console.log(`Received WebRTC offer from ${senderUserId}:`, offer.sdp.substring(0,30) + "...");

    if (!localAudioStream) {
        console.warn("Received an offer but local audio stream is not ready. Ignoring offer.");
        // Optionally, send a message back to senderUserId indicating not ready for call.
        return;
    }

    // Ensure a PC exists or create one. If creating, this client is NOT the initiator for this exchange.
    const pc = peerConnections[senderUserId] || createPeerConnection(senderUserId, false);
    if (!pc) { // Should not happen if createPeerConnection is robust
        console.error("Failed to get/create peer connection for offer from", senderUserId);
        return;
    }

    try {
        await pc.setRemoteDescription(new RTCSessionDescription(offer));
        console.log(`Remote description (offer) set for ${senderUserId}.`);

        const answer = await pc.createAnswer();
        console.log(`Created answer for ${senderUserId}:`, answer.sdp.substring(0,30) + "...");

        await pc.setLocalDescription(answer);
        console.log(`Local description (answer) set for ${senderUserId}. Sending answer.`);

        sendMessage({
            type: 'webrtcAnswer',
            targetUserId: senderUserId,
            answer: pc.localDescription // Send the whole localDescription object
        });
    } catch (error) {
        console.error(`Error handling WebRTC offer from ${senderUserId}:`, error);
    }
}

// --- UI Update Functions (will be expanded) ---
function displayRooms(roomsData) {
    roomListUl.innerHTML = ''; // Clear existing list
    if (roomsData && Object.keys(roomsData).length > 0) {
        for (const roomKey in roomsData) { // Iterate over keys from server, which are room names
            const room = roomsData[roomKey];
            const li = document.createElement('li');
            li.classList.add('room-item');

            const roomNameSpan = document.createElement('span');
            roomNameSpan.textContent = `${room.name} (${room.userCount} users)`;
            roomNameSpan.dataset.roomName = room.name; // For joining
            roomNameSpan.style.cursor = 'pointer'; // Indicate it's clickable for joining
            roomNameSpan.addEventListener('click', () => {
                console.log(`Attempting to join room: ${room.name}`);
                sendMessage({ type: 'joinRoom', roomName: room.name });
            });
            li.appendChild(roomNameSpan);

            if (isAdmin && room.name !== 'General') {
                const renameBtn = document.createElement('button');
                renameBtn.textContent = 'Rename';
                renameBtn.classList.add('admin-action-button', 'rename-room-btn');
                renameBtn.dataset.roomname = room.name;
                li.appendChild(renameBtn);

                const deleteBtn = document.createElement('button');
                deleteBtn.textContent = 'Delete';
                deleteBtn.classList.add('admin-action-button', 'delete-room-btn');
                deleteBtn.dataset.roomname = room.name;
                li.appendChild(deleteBtn);
            }
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

    // if (isAdmin) { // Old admin controls div logic removed
    //     adminControlsDiv.style.display = 'block';
    //     console.log('Admin status confirmed by server.');
    // } else {
    //     adminControlsDiv.style.display = 'none';
    // }
    // Per-room admin buttons are now shown/hidden by displayRooms() based on isAdmin state.
    console.log(`Admin status: ${isAdmin}`);
    // The room list is typically sent right after 'registered' or can be requested.
    // If server sends 'roomList' automatically after 'registered', displayRooms will be called.

    // After registering and getting room list, if user is already in a room (e.g. reconnect)
    // and has mic enabled, they might need to initiate calls.
    // However, current flow: join room -> enable mic -> then initiate.
}

function initiateCallsToExistingRoomMembers() {
    if (!localAudioStream || !currentRoom) {
        console.log("Cannot initiate calls: local audio not ready or not in a room.");
        return;
    }
    console.log("Attempting to initiate calls to existing room members...");
    // Need to get the current list of users in the room.
    // This info is in `message.users` of `handleJoinedRoom` or can be requested.
    // For now, let's assume we have a way to get this list.
    // We'll refine this when `updateUserList` is more fleshed out or if server sends user list separately.

    // A simple way: iterate over the displayed user list elements if they store IDs.
    const userElements = userListUl.querySelectorAll('li[data-user-id]');
    userElements.forEach(el => {
        const peerId = el.dataset.userId;
        if (peerId !== userId) { // Don't connect to self
            console.log(`Found user ${peerId} in room, initiating PC (if not exists).`);
            // The createPeerConnection will handle offer creation if isInitiator is true.
            // The logic for who is initiator needs to be defined (next step).
            // For now, let's assume this client initiates to everyone new.
            // This will be refined in step 4.
            createPeerConnection(peerId, true); // Tentatively, this client initiates.
        }
    });
}

async function handleWebRTCIceCandidate(message) {
    const { senderUserId, candidate } = message;
    // console.log(`Received ICE candidate from ${senderUserId}:`, candidate); // Can be very verbose

    const pc = peerConnections[senderUserId];
    if (!pc) {
        console.error(`Received ICE candidate from ${senderUserId}, but no peer connection found.`);
        return;
    }

    if (candidate) {
        try {
            // Ensure remote description is set before adding ICE candidates if an offer was just processed
            // or if candidates arrive out of order.
            if (pc.remoteDescription || pc.signalingState === 'stable') { // 'stable' might mean ready for candidates too
                 await pc.addIceCandidate(new RTCIceCandidate(candidate));
                // console.log(`Added ICE candidate from ${senderUserId}`);
            } else {
                console.warn(`Received ICE candidate from ${senderUserId} but remote description not yet set. Buffering or ignoring.`);
                // Simple approach: ignore. Robust: buffer candidates and apply after remoteDescription is set.
                // For now, we'll rely on typical ordering where offer/answer exchange completes enough for candidates to be added.
            }
        } catch (error) {
            console.error(`Error adding received ICE candidate from ${senderUserId}:`, error);
        }
    }
}

function completelyDisableVoice() {
    console.log("Disabling all voice features.");
    isVoiceActive = false;
    if (localAudioStream) {
        localAudioStream.getTracks().forEach(track => track.stop()); // Stop the tracks to release mic
        localAudioStream = null;
    }
    removePttListeners();

    toggleVoiceModeButton.style.display = 'none';
    // toggleVoiceModeButton.textContent = 'Use Open Mic'; // Reset text for next time

    enableVoiceButton.textContent = 'Enable Voice';
    // enableVoiceButton.disabled is handled by calling context (e.g. resetVoiceControlsToDefault will disable it)

    voiceStatusP.textContent = 'Voice disabled.';
    currentMicMode = 'ptt'; // Reset to default mode
    isPttKeyDown = false;

    closeAllPeerConnections();
}

// resetVoiceControlsToDefault is called on socket.onclose
function resetVoiceControlsToDefault() {
    completelyDisableVoice(); // This stops streams, resets states, hides toggle button etc.
    enableVoiceButton.disabled = true; // After full disable, button is disabled as user is not in a room.
    voiceStatusP.textContent = 'Disconnected. Voice disabled.'; // More specific status for full disconnect
}


// Initial UI state
connectionArea.style.display = 'block';
chatContainer.style.display = 'none';
// adminControlsDiv.style.display = 'none'; // Old admin controls div logic removed

function handleJoinedRoom(message) {
    // Close any existing peer connections before joining a new room
    closeAllPeerConnections();

    currentRoom = message.roomName;
    currentRoomNameH2.textContent = `Room: ${currentRoom}`;
    messagesDiv.innerHTML = ''; // Clear messages from previous room
    updateUserList(message.users); // This will list users, including self if server sends it

    // Enable message input and voice button
    messageInput.disabled = false;
    sendMessageButton.disabled = false;
    enableVoiceButton.disabled = false;
    voiceStatusP.textContent = 'Voice chat available. Click "Enable Voice".';
    console.log(`Successfully joined room: ${currentRoom}`);

    // If mic is already enabled, try to connect to existing users
    if (localAudioStream) {
        console.log("Mic already enabled, initiating calls to users in newly joined room.");
        initiateCallsToExistingRoomMembers();
    }
}

function handleUserJoined(message) {
    if (message.roomName === currentRoom) {
        const newUser = message.user;
        console.log(`${newUser.username} joined the room.`);
        // Add user to UI list
        const existingUserLi = userListUl.querySelector(`li[data-user-id="${newUser.id}"]`);
        if (!existingUserLi) {
            const li = document.createElement('li');
            li.textContent = newUser.username;
            li.dataset.userId = newUser.id;
            userListUl.appendChild(li);
        }
        messagesDiv.innerHTML += `<p><em>${newUser.username} joined the room.</em></p>`;

        // If local audio is ready, and this new user is not self, initiate a peer connection
        if (localAudioStream && newUser.id !== userId) {
            console.log(`New user ${newUser.username} joined, initiating peer connection.`);
            // The createPeerConnection will handle offer creation if isInitiator is true.
            // The logic for who is initiator needs to be defined (next step).
            // For now, this client (who was already in the room) initiates to the new joiner.
            // This will be refined in step 4.
            createPeerConnection(newUser.id, true); // Tentatively, this client initiates.
        }
    }
}

function handleUserLeft(message) {
    if (message.roomName === currentRoom) {
        const departedUser = message.user;
        console.log(`${departedUser.username} left the room.`);
        // Remove user from UI list
        const userLi = userListUl.querySelector(`li[data-user-id="${departedUser.id}"]`);
        if (userLi) {
            userLi.remove();
        }
        messagesDiv.innerHTML += `<p><em>${departedUser.username} left the room.</em></p>`;
        // Close the peer connection for this user
        closePeerConnection(departedUser.id);
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

function createPeerConnection(peerId, isInitiator = false) {
    if (peerConnections[peerId]) {
        console.log(`Peer connection with ${peerId} already exists or is being established.`);
        return peerConnections[peerId];
    }
    console.log(`Creating new PeerConnection for peer: ${peerId}, initiator: ${isInitiator}`);

    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    peerConnections[peerId] = pc;

    // Add local audio tracks to the connection
    if (localAudioStream) {
        localAudioStream.getTracks().forEach(track => {
            pc.addTrack(track, localAudioStream);
            console.log(`Added local audio track to PC for peer ${peerId}`);
        });
    } else {
        console.warn("Local audio stream not available when creating peer connection for", peerId);
        // This should ideally not happen if UI flow is correct (mic enabled before calls)
    }

    pc.onicecandidate = (event) => {
        if (event.candidate) {
            console.log(`ICE candidate for ${peerId}:`, event.candidate);
            sendMessage({
                type: 'webrtcIceCandidate',
                targetUserId: peerId,
                candidate: event.candidate
            });
        }
    };

    pc.ontrack = (event) => {
        console.log(`Remote track received from ${peerId}:`, event.streams[0]);
        handleRemoteStream(peerId, event.streams[0]);
    };

    pc.oniceconnectionstatechange = () => {
        console.log(`ICE connection state for ${peerId}: ${pc.iceConnectionState}`);
        if (pc.iceConnectionState === 'failed' || pc.iceConnectionState === 'disconnected' || pc.iceConnectionState === 'closed') {
            // Handle potential cleanup or reconnection logic here
            console.warn(`Peer connection with ${peerId} ${pc.iceConnectionState}.`);
            // closePeerConnection(peerId); // Consider when to automatically close
        }
    };

    pc.onsignalingstatechange = () => {
        console.log(`Signaling state for ${peerId}: ${pc.signalingState}`);
    };

    // If this client is the initiator, it will create and send an offer
    if (isInitiator) {
        pc.createOffer()
            .then(offer => {
                console.log(`Created offer for ${peerId}:`, offer.sdp.substring(0,30) + "..."); // Log snippet
                return pc.setLocalDescription(offer);
            })
            .then(() => {
                console.log(`Local description set for ${peerId}. Sending offer.`);
                sendMessage({
                    type: 'webrtcOffer',
                    targetUserId: peerId,
                    offer: pc.localDescription // Send the whole localDescription object
                });
            })
            .catch(e => console.error(`Error creating offer for ${peerId}:`, e));
    }

    return pc;
}

function handleRemoteStream(peerId, stream) {
    let audioEl = document.getElementById(`audio_${peerId}`);
    if (!audioEl) {
        audioEl = document.createElement('audio');
        audioEl.id = `audio_${peerId}`;
        audioEl.autoplay = true;
        // audioEl.controls = true; // Optional: for debugging
        remoteAudioContainer.appendChild(audioEl);
        console.log(`Created audio element for peer ${peerId}`);
    }
    audioEl.srcObject = stream;
    audioEl.play().catch(e => console.error("Error playing remote audio:", e));
}

function closePeerConnection(peerId) {
    if (peerConnections[peerId]) {
        peerConnections[peerId].close();
        delete peerConnections[peerId];
        const audioEl = document.getElementById(`audio_${peerId}`);
        if (audioEl) {
            audioEl.remove();
        }
        console.log(`Closed peer connection and cleaned up UI for ${peerId}`);
    }
}

function closeAllPeerConnections() {
    console.log("Closing all peer connections.");
    for (const peerId in peerConnections) {
        closePeerConnection(peerId);
    }
    // Also reset local voice state if connections are closed due to leaving a room / disconnecting
    if (localAudioStream) {
        // Don't stop tracks or nullify localAudioStream here if user might join another room.
        // Instead, reset the UI elements to their pre-voice-enabled state.
        enableVoiceButton.textContent = 'Enable Voice';
        enableVoiceButton.disabled = true; // Will be re-enabled when they join a new room
        voiceStatusP.textContent = '';
        isMicMuted = true; // Reset mute state
        // If we wanted to fully stop mic:
        // localAudioStream.getTracks().forEach(track => track.stop());
        // localAudioStream = null;
        // console.log("Local audio stream stopped and reset due to closing all peer connections.");
    }
}

function resetVoiceControlsToDefault() {
    if (localAudioStream) {
        localAudioStream.getTracks().forEach(track => track.stop());
        localAudioStream = null;
        console.log("Local audio stream stopped and fully reset.");
    }
    enableVoiceButton.textContent = 'Enable Voice';
    enableVoiceButton.disabled = true; // Disabled until in a room
    voiceStatusP.textContent = '';
    // isMicMuted = true; // Removed
    isVoiceActive = false; // Ensure this is reset
    currentMicMode = 'ptt'; // Reset to default mode
    isPttKeyDown = false; // Reset PTT key state
    removePttListeners();
}

// --- PTT Key Handlers ---
function handlePttKeyDown(event) {
    if (isVoiceActive && currentMicMode === 'ptt' && event.code === PTT_KEY && localAudioStream && !isPttKeyDown) {
        isPttKeyDown = true;
        localAudioStream.getTracks().forEach(track => track.enabled = true);
        voiceStatusP.textContent = 'TALKING...';
        // console.log("PTT Key Down - Mic Enabled");
    }
}

function handlePttKeyUp(event) {
    if (isVoiceActive && currentMicMode === 'ptt' && event.code === PTT_KEY && localAudioStream && isPttKeyDown) {
        isPttKeyDown = false;
        localAudioStream.getTracks().forEach(track => track.enabled = false);
        voiceStatusP.textContent = `PTT Active: Hold ${PTT_KEY} to Talk`;
        // console.log("PTT Key Up - Mic Disabled");
    }
}

// Add PTT event listeners globally if PTT is the intended mode
// We'll add them when voice is enabled, and remove them if voice is disabled (future feature)
function addPttListeners() {
    window.addEventListener('keydown', handlePttKeyDown);
    window.addEventListener('keyup', handlePttKeyUp);
    console.log("PTT listeners added.");
}

function removePttListeners() {
    window.removeEventListener('keydown', handlePttKeyDown);
    window.removeEventListener('keyup', handlePttKeyUp);
    console.log("PTT listeners removed.");
}

// Modify the enableVoiceButton listener to add PTT listeners on success
// And potentially a "Disable Voice" button would remove them.


console.log('Client-side script fully loaded and initialized.');
