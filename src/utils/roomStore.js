import { db, ref, set, get, update, onValue, off } from './firebase.js';

export async function createRoom(code, hostTeam, hostName, auctionType) {
  const room = {
    code, hostTeam, hostName, auctionType,
    players: [{ name: hostName, team: hostTeam, isHost: true }],
    status: 'waiting',
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

export function generateRoomCode() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}