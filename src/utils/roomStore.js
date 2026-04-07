import { db, ref, set, get, update, onValue, off } from './firebase.js';

export async function createRoom(code, hostTeam, hostName, auctionType) {
  const room = {
    code, hostTeam, hostName, auctionType,
    players: [{ name: hostName, team: hostTeam, isHost: true }],
    status: 'waiting',        // waiting | retention | started | auction
    retentions: {},           // each team's retained players stored here
    readyPlayers: {},         // who clicked Ready
    auctionState: null,
    createdAt: Date.now(),
  };
  await set(ref(db, `rooms/${code}`), room);
  return room;
}

export async function joinRoom(code, name, teamId) {
  const snapshot = await get(ref(db, `rooms/${code}`));
  if (!snapshot.exists()) return null;
  const room = snapshot.val();
  const players = room.players || [];
  if (players.find(p => p.team === teamId)) return 'TEAM_TAKEN';
  if (players.length >= 10) return 'ROOM_FULL';
  const newPlayers = [...players, { name, team: teamId, isHost: false }];
  await update(ref(db, `rooms/${code}`), { players: newPlayers });
  return { ...room, players: newPlayers };
}

export function listenRoom(code, callback) {
  const roomRef = ref(db, `rooms/${code}`);
  onValue(roomRef, (snap) => {
    if (snap.exists()) callback(snap.val());
  });
  return () => off(roomRef);
}

export async function updateRoomData(code, data) {
  await update(ref(db, `rooms/${code}`), data);
}

// Save one team's retentions to Firebase
export async function saveMyRetentions(code, teamId, retainedPlayers) {
  await update(ref(db, `rooms/${code}/retentions`), {
    [teamId]: retainedPlayers
  });
}

// Mark myself as ready
export async function markReady(code, teamId) {
  await update(ref(db, `rooms/${code}/readyPlayers`), {
    [teamId]: true
  });
}

export function generateRoomCode() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}