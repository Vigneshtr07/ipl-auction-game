export function fmtCr(n) {
  if (n >= 100) return (n/100).toFixed(2).replace(/\.?0+$/,'') + ' Cr';
  return n + 'L';
}
export function getBidIncrement(bid) {
  if (bid < 100)  return 5;
  if (bid < 200)  return 10;
  if (bid < 500)  return 25;
  if (bid < 1000) return 50;
  if (bid < 2000) return 100;
  return 200;
}
export function shuffle(arr) {
  const a=[...arr];
  for(let i=a.length-1;i>0;i--){
    const j=Math.floor(Math.random()*(i+1));
    [a[i],a[j]]=[a[j],a[i]];
  }
  return a;
}
export function generateRoomCode() {
  return Math.random().toString(36).substring(2,8).toUpperCase();
}
export const ROLE_COLORS = {
  Batter:        {bg:'#14532d', text:'#4ade80'},
  Bowler:        {bg:'#450a0a', text:'#f87171'},
  'All-Rounder': {bg:'#2e1065', text:'#c084fc'},
  Wicketkeeper:  {bg:'#431407', text:'#fb923c'},
  Spinner:       {bg:'#0c1a4f', text:'#60a5fa'},
};
export const CAT_COLORS = {
  Capped:   {bg:'#0f172a', text:'#38bdf8'},
  Uncapped: {bg:'#1c1917', text:'#a8a29e'},
};
export const FLAG = {
  India:'🇮🇳', Australia:'🇦🇺', England:'🏴󠁧󠁢󠁥󠁮󠁧󠁿', 'South Africa':'🇿🇦',
  'New Zealand':'🇳🇿', 'West Indies':'🏝️', 'Sri Lanka':'🇱🇰', Afghanistan:'🇦🇫',
  Bangladesh:'🇧🇩', Zimbabwe:'🇿🇼', Ireland:'🇮🇪',
};
export const isOverseas = c => c !== 'India';

// Smart AI bid — strategic, role-aware
export function aiShouldBid(currentBid, team, player, playersLeft) {
  const inc    = getBidIncrement(currentBid);
  const newBid = currentBid + inc;
  if (newBid > team.budget) return null;

  const squadSize = team.squad.length;
  const needed    = Math.max(0, 21 - squadSize);
  const minReserve = needed > 1 ? (needed - 1) * 35 : 0;
  if (newBid > team.budget - minReserve) return null;

  // Overseas cap
  if (isOverseas(player.country) && (team._overseasCount || 0) >= 8) return null;

  // Price ceiling — smarter based on player quality
  const multiplier = player.base >= 150 ? 5 : player.base >= 100 ? 4 : player.base >= 50 ? 3 : 2.5;
  const needBonus  = needed > 10 ? 1.5 : needed > 5 ? 1.2 : 1.0;
  const ceiling    = player.base * multiplier * needBonus * (0.6 + (team.budget / 9000) * 0.5);
  if (newBid > ceiling && Math.random() > 0.12) return null;

  // Aggressiveness based on how many players team still needs
  const aggr = needed > 14 ? 0.78 : needed > 10 ? 0.65 : needed > 6 ? 0.52 : needed > 3 ? 0.40 : 0.30;
  if (Math.random() > aggr) return null;

  return newBid;
}