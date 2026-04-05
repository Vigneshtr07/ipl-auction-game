const KEY = 'ipl_room_';
export function createRoom(code, hostTeam, hostName, auctionType) {
  const room = { code, hostTeam, hostName, auctionType,
    players:[{name:hostName, team:hostTeam, isHost:true}],
    status:'waiting', createdAt:Date.now() };
  localStorage.setItem(KEY+code, JSON.stringify(room));
  return room;
}
export function joinRoom(code, name, teamId) {
  const raw = localStorage.getItem(KEY+code);
  if (!raw) return null;
  const room = JSON.parse(raw);
  if (room.players.find(p => p.team===teamId)) return 'TEAM_TAKEN';
  if (room.players.length >= 10) return 'ROOM_FULL';
  room.players.push({name, team:teamId, isHost:false});
  localStorage.setItem(KEY+code, JSON.stringify(room));
  return room;
}
export function generateRoomCode() {
  return Math.random().toString(36).substring(2,8).toUpperCase();
}