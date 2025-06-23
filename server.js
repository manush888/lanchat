const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs'); // Require File System module
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
const ROOMS_FILE_PATH = './rooms-data.json';

// Serve static files from the 'public' directory
app.use(express.static(path.join(__dirname, 'public')));

// Load rooms from file on startup
loadRoomsFromFile(); // Call before server starts listening

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
      case 'createRoom':
        handleCreateRoom(ws, parsedMessage);
        break;
      case 'deleteRoom':
        handleDeleteRoom(ws, parsedMessage);
        break;
      case 'renameRoom':
        handleRenameRoom(ws, parsedMessage);
        break;
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

// --- Admin Action Handlers ---
function handleCreateRoom(ws, message) {
    const clientData = clients.get(ws);
    if (!clientData || !clientData.isAdmin) {
        ws.send(JSON.stringify({ type: 'error', message: 'Unauthorized: Admin privileges required.' }));
        return;
    }
    const { roomName } = message;
    if (!roomName || roomName.trim().length === 0) {
        ws.send(JSON.stringify({ type: 'error', message: 'Room name cannot be empty.' }));
        return;
    }
    if (rooms[roomName]) {
        ws.send(JSON.stringify({ type: 'error', message: `Room '${roomName}' already exists.` }));
        return;
    }
    rooms[roomName] = { name: roomName, users: new Map() };
    console.log(`Admin ${clientData.username} created room: ${roomName}`);
    saveRoomsToFile(); // Save after successful creation
    broadcastRoomList();
    ws.send(JSON.stringify({ type: 'info', message: `Room '${roomName}' created successfully.` }));
}

function handleDeleteRoom(ws, message) {
    const clientData = clients.get(ws);
    if (!clientData || !clientData.isAdmin) {
        ws.send(JSON.stringify({ type: 'error', message: 'Unauthorized: Admin privileges required.' }));
        return;
    }
    const { roomName } = message;
    if (!roomName || !rooms[roomName]) {
        ws.send(JSON.stringify({ type: 'error', message: `Room '${roomName}' not found.` }));
        return;
    }
    if (roomName === 'General') { // Prevent deleting the default 'General' room
        ws.send(JSON.stringify({ type: 'error', message: "Cannot delete the default 'General' room." }));
        return;
    }

    // Move users from the deleted room to 'General'
    const usersToMove = Array.from(rooms[roomName].users.keys()); // Get user IDs
    usersToMove.forEach(userId => {
        // Find the ws connection for each userId to update their clientData and send messages
        for (const [conn, cData] of clients) {
            if (cData.id === userId) {
                cData.room = 'General'; // Update client's current room
                rooms['General'].users.set(userId, conn); // Add to General room's user map
                conn.send(JSON.stringify({
                    type: 'info',
                    message: `Room '${roomName}' was deleted. You have been moved to 'General'.`
                }));
                // Force client to "re-join" General to get updated user list for General
                conn.send(JSON.stringify({
                    type: 'joinedRoom',
                    roomName: 'General',
                    users: getUsersInRoomForClient('General')
                }));
                break;
            }
        }
    });

    delete rooms[roomName];
    console.log(`Admin ${clientData.username} deleted room: ${roomName}. Users moved to General.`);
    saveRoomsToFile(); // Save after successful deletion
    broadcastRoomList();
    ws.send(JSON.stringify({ type: 'info', message: `Room '${roomName}' deleted. Users (if any) moved to 'General'.` }));
}

function handleRenameRoom(ws, message) {
    const clientData = clients.get(ws);
    if (!clientData || !clientData.isAdmin) {
        ws.send(JSON.stringify({ type: 'error', message: 'Unauthorized: Admin privileges required.' }));
        return;
    }
    const { oldName, newName } = message;
    if (!oldName || !newName || oldName.trim().length === 0 || newName.trim().length === 0) {
        ws.send(JSON.stringify({ type: 'error', message: 'Both old and new room names must be provided.' }));
        return;
    }
    if (!rooms[oldName]) {
        ws.send(JSON.stringify({ type: 'error', message: `Room '${oldName}' not found.` }));
        return;
    }
    if (rooms[newName]) {
        ws.send(JSON.stringify({ type: 'error', message: `Room name '${newName}' already exists.` }));
        return;
    }
    if (oldName === 'General' && newName !== 'General') { // Prevent renaming the default 'General' room away
        ws.send(JSON.stringify({ type: 'error', message: "Cannot rename the default 'General' room to something else."}));
        return;
    }

    // Update room name and transfer users
    rooms[newName] = rooms[oldName]; // Copy users map and original name property
    rooms[newName].name = newName;   // Update the name property
    delete rooms[oldName];

    // Update room name for all clients currently in that room
    clients.forEach(cData => {
        if (cData.room === oldName) {
            cData.room = newName;
        }
    });

    // Notify users in the renamed room
    broadcastToRoom(newName, {
        type: 'roomRenamed',
        oldName: oldName,
        newName: newName,
        message: `Room '${oldName}' has been renamed to '${newName}'. Your current room has been updated.`
    });

    console.log(`Admin ${clientData.username} renamed room '${oldName}' to '${newName}'.`);
    saveRoomsToFile(); // Save after successful rename
    broadcastRoomList(); // Update everyone with the new list of rooms
    ws.send(JSON.stringify({ type: 'info', message: `Room '${oldName}' successfully renamed to '${newName}'.` }));
}

// --- Persistence Functions ---
function loadRoomsFromFile() {
    try {
        if (fs.existsSync(ROOMS_FILE_PATH)) {
            const data = fs.readFileSync(ROOMS_FILE_PATH, 'utf8');
            const loadedRoomsConfig = JSON.parse(data);
            // Reconstruct rooms with empty user maps
            const tempRooms = {};
            for (const roomName in loadedRoomsConfig) {
                tempRooms[roomName] = {
                    name: loadedRoomsConfig[roomName].name, // Ensure name property is consistent
                    users: new Map() // Users are transient, always start empty
                };
            }
            rooms = tempRooms; // Assign to the global rooms variable
            console.log('Rooms loaded from file:', ROOMS_FILE_PATH);
        } else {
            console.log('No rooms data file found. Using default rooms.');
            // Default rooms are already initialized, so do nothing more here.
            // Optionally, save default rooms immediately: saveRoomsToFile();
        }
    } catch (error) {
        console.error('Error loading rooms from file:', error);
        // Fallback to default rooms if loading fails
        initializeDefaultRooms(); // Make sure this function exists or rooms is already default
    }
}

function saveRoomsToFile() {
    try {
        // Prepare a version of rooms for saving (without live user WebSocket connections)
        const roomsToSave = {};
        for (const roomName in rooms) {
            roomsToSave[roomName] = {
                name: rooms[roomName].name // Just save the name (and any other persistent config)
                // Do NOT save rooms[roomName].users as it contains live WebSocket objects
            };
        }
        fs.writeFileSync(ROOMS_FILE_PATH, JSON.stringify(roomsToSave, null, 2), 'utf8');
        console.log('Rooms data saved to file:', ROOMS_FILE_PATH);
    } catch (error) {
        console.error('Error saving rooms to file:', error);
    }
}

function initializeDefaultRooms() { // Helper in case of load failure
    rooms = {
      'General': { name: 'General', users: new Map() },
      'Tech Talk': { name: 'Tech Talk', users: new Map() },
      'Random': { name: 'Random', users: new Map() }
    };
    console.log("Initialized with default rooms.");
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
