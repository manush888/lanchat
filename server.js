const express = require('express');
const http = require('http');
const path = require('path');
const WebSocket = require('ws');
const { v4: uuidv4 } = require('uuid'); // For generating unique user IDs

const app = express();
const server = http.createServer(app);

// --- In-memory data storage ---
// rooms: Map roomName -> { name: roomName, users: Map(userId -> ws_connection) }
// Note: Storing full ws_connection in room.users might be redundant if clients map has it.
// Consider storing just userId or a lightweight user object if memory/performance becomes an issue.
let rooms = {
  'General': { name: 'General', users: new Map() },
  'Tech Talk': { name: 'Tech Talk', users: new Map() },
  'Random': { name: 'Random', users: new Map() }
};
// clients: Map ws_connection -> { id: userId, username: string, room: roomName|null, isAdmin: boolean }
let clients = new Map();

const ADMIN_SECRET = "supersecret"; // In a real app, use environment variables for secrets.

// Serve static files from the 'public' directory
app.use(express.static(path.join(__dirname, 'public')));

// Basic route for the homepage
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});

// Initialize WebSocket server
const wss = new WebSocket.Server({ server });
console.log('WebSocket server initialized and attached to HTTP server.');

wss.on('connection', (ws) => {
  // ws object is the connection to a single client
  console.log('A new client is attempting to connect via WebSocket...');

  // Actual user registration and ID assignment will happen upon receiving a 'register' message.
  // For now, ws is just the raw connection.

  ws.on('message', (message) => {
    let parsedMessage;
    try {
      parsedMessage = JSON.parse(message);
      // console.log('Received message:', parsedMessage); // Can be verbose, enable if needed
    } catch (e) {
      console.error('Failed to parse message or message is not JSON:', message.toString());
      ws.send(JSON.stringify({ type: 'error', message: 'Invalid message format. Expected JSON.' }));
      return;
    }

    // Message handling logic
    switch (parsedMessage.type) {
      case 'register':
        handleRegister(ws, parsedMessage);
        break;
      case 'joinRoom':
        handleJoinRoom(ws, parsedMessage);
        break;
      case 'textMessage':
        handleTextMessage(ws, parsedMessage);
        break;
      // Admin actions to be implemented: createRoom, deleteRoom, renameRoom
      default:
        console.log(`Received unhandled message type: ${parsedMessage.type} from client.`);
        ws.send(JSON.stringify({ type: 'error', message: `Unknown message type: ${parsedMessage.type}` }));
    }
  });

  ws.on('close', () => {
    const clientData = clients.get(ws); // Find client data associated with this ws connection
    if (clientData) {
      console.log(`Client ${clientData.username} (ID: ${clientData.id}) disconnected.`);
      const oldRoom = clientData.room; // Store room before deleting client data

      // Remove from room
      if (oldRoom && rooms[oldRoom]) {
        rooms[oldRoom].users.delete(clientData.id);
        console.log(`${clientData.username} removed from room ${oldRoom}.`);
        // Notify other users in the room
        broadcastToRoom(oldRoom, {
          type: 'userLeft',
          roomName: oldRoom,
          user: { id: clientData.id, username: clientData.username }
        });
      }

      // Remove from global clients list
      clients.delete(ws);
      console.log(`Client ${clientData.username} fully removed from server records.`);

      // Broadcast updated room list if a user left a room (user counts change)
      if (oldRoom) {
        broadcastRoomList();
      }

    } else {
      console.log('An unregistered or already cleaned-up client disconnected (ws connection not in clients Map).');
    }
  });

  ws.on('error', (error) => {
    const clientData = clients.get(ws);
    if (clientData) {
        console.error(`WebSocket error for client ${clientData.username} (ID: ${clientData.id}):`, error);
    } else {
        console.error('WebSocket error for an unidentified client:', error);
    }
  });

  // Send a welcome message or request registration immediately upon connection.
  // This helps the client know the connection is open and what to do next.
  ws.send(JSON.stringify({ type: 'info', message: 'Connection established. Please register with your username.' }));
});

// --- Helper Functions ---
function getRoomDataForClient() {
  const roomData = {};
  for (const roomName in rooms) {
    roomData[roomName] = {
      name: rooms[roomName].name,
      userCount: rooms[roomName].users.size
    };
  }
  return roomData;
}

function broadcastRoomList() {
    const roomData = getRoomDataForClient();
    clients.forEach(clientObj => {
        if (clientObj.ws.readyState === WebSocket.OPEN) {
            clientObj.ws.send(JSON.stringify({ type: 'roomList', rooms: roomData }));
        }
    });
}


// --- WebSocket Message Handlers ---
function handleRegister(ws, message) {
  const { username, adminToken } = message;

  if (!username || username.trim().length === 0) {
    ws.send(JSON.stringify({ type: 'error', message: 'Username cannot be empty.' }));
    return;
  }

  // Check if username is already taken (optional, good for usability)
  for (const clientData of clients.values()) {
    if (clientData.username === username) {
      ws.send(JSON.stringify({ type: 'error', message: `Username '${username}' is already taken.` }));
      return;
    }
  }

  const userId = uuidv4();
  const isAdmin = (adminToken === ADMIN_SECRET);

  const clientData = {
    id: userId,
    username: username,
    room: null, // Not in a room initially
    isAdmin: isAdmin,
    ws: ws // Store the WebSocket connection object itself
  };
  clients.set(ws, clientData); // Map the ws connection to its data

  console.log(`Client registered: ${username} (ID: ${userId}), Admin: ${isAdmin}`);

  ws.send(JSON.stringify({
    type: 'registered',
    userId: userId,
    username: username,
    isAdmin: isAdmin,
    message: `Welcome, ${username}!`
  }));

  // Send initial room list to the newly registered client
  ws.send(JSON.stringify({ type: 'roomList', rooms: getRoomDataForClient() }));
}

function handleJoinRoom(ws, message) {
  const clientData = clients.get(ws);
  if (!clientData) {
    ws.send(JSON.stringify({ type: 'error', message: 'Not registered. Please register first.' }));
    console.log('Unregistered client tried to join room.');
    return;
  }

  const { roomName } = message;
  if (!rooms[roomName]) {
    ws.send(JSON.stringify({ type: 'error', message: `Room '${roomName}' does not exist.` }));
    console.log(`Client ${clientData.username} tried to join non-existent room: ${roomName}`);
    return;
  }

  // Leave current room if any
  if (clientData.room && rooms[clientData.room]) {
    if (clientData.room === roomName) {
      ws.send(JSON.stringify({ type: 'info', message: `You are already in room '${roomName}'.`}));
      return; // Already in the target room
    }
    rooms[clientData.room].users.delete(clientData.id);
    // Notify users in old room
    broadcastToRoom(clientData.room, {
      type: 'userLeft',
      roomName: clientData.room,
      user: { id: clientData.id, username: clientData.username }
    }, ws); // Exclude the user who is leaving
    console.log(`${clientData.username} left room ${clientData.room}`);
  }

  // Join new room
  clientData.room = roomName;
  rooms[roomName].users.set(clientData.id, clientData.ws); // Store ws connection for direct messaging if needed, or just userId

  console.log(`${clientData.username} (ID: ${clientData.id}) joined room ${roomName}`);

  // Send confirmation to the client who joined
  ws.send(JSON.stringify({
    type: 'joinedRoom',
    roomName: roomName,
    users: getUsersInRoomForClient(roomName)
  }));

  // Notify users in the new room
  broadcastToRoom(roomName, {
    type: 'userJoined',
    roomName: roomName,
    user: { id: clientData.id, username: clientData.username }
  }, ws); // Exclude the user who just joined (they got 'joinedRoom')

  // Broadcast updated room list (user counts change)
  broadcastRoomList();
}

function getUsersInRoomForClient(roomName) {
    if (!rooms[roomName]) return [];
    const usersArray = [];
    for (const userId of rooms[roomName].users.keys()) {
        // Find the client data by iterating through the main `clients` Map's values
        // This is a bit inefficient. A reverse map from userId to clientData might be better for large scale.
        for (const c of clients.values()) {
            if (c.id === userId) {
                usersArray.push({ id: c.id, username: c.username });
                break;
            }
        }
    }
    return usersArray;
}

function broadcastToRoom(roomName, messageObject, excludeWs = null) {
  if (!rooms[roomName]) {
    console.warn(`Attempted to broadcast to non-existent or empty room: ${roomName}`);
    return;
  }

  // Iterate over all connected clients ONCE
  clients.forEach((clientData, clientWs) => {
    // Check if this client is in the target room and should not be excluded
    if (clientData.room === roomName && clientWs !== excludeWs && clientWs.readyState === WebSocket.OPEN) {
      clientWs.send(JSON.stringify(messageObject));
    }
  });
}

function handleTextMessage(ws, message) {
  const clientData = clients.get(ws);
  if (!clientData || !clientData.room) {
    ws.send(JSON.stringify({ type: 'error', message: 'You must be in a room to send messages.' }));
    console.log(`Client (ID: ${clientData ? clientData.id : 'N/A'}) tried to send message without being in a room.`);
    return;
  }

  if (!message.content || message.content.trim().length === 0) {
    ws.send(JSON.stringify({ type: 'error', message: 'Message content cannot be empty.' }));
    return;
  }

  const messageObject = {
    type: 'newTextMessage',
    username: clientData.username,
    content: message.content.trim(), // Sanitize/validate content further in a real app
    timestamp: new Date().toISOString() // Optional: add a server-side timestamp
  };

  broadcastToRoom(clientData.room, messageObject); // Send to all in room, including sender
  console.log(`Message from ${clientData.username} in room ${clientData.room}: ${message.content.trim()}`);
}


module.exports = server;
