import React,{useState,useEffect,useRef} from 'react';
import {createRoom,joinRoom,listenRoom,updateRoomData,generateRoomCode} from './utils/roomStore.js';
import {TEAMS,RETENTION_RULES,TOTAL_BUDGET} from './data/teams.js';
import {MINI_PLAYERS_2026,MEGA_PLAYERS_2025,getSets} from './data/players.js';
import {SQUADS_2025} from './data/squads2025.js';
import {fmtCr,getBidIncrement,shuffle,ROLE_COLORS,CAT_COLORS,FLAG,isOverseas,aiShouldBid} from './utils/helpers.js';
import './styles/main.css';

const pName = p => `${p.fn} ${p.ln}`;

// ── AI retention — smart, rule-following ─────────────────────────────────────
function buildAIRetentions(myTeamId, pool) {
  const retentions = {};
  const poolNames  = new Set(pool.map(pName));

  TEAMS.forEach(t => {
    if (t.id === myTeamId) return;
    const squad = SQUADS_2025[t.id] || [];
    const retained = [];
    let usedBudget  = 0;

    // Sort: prefer high-quality capped overseas first, then capped Indian, then uncapped
    const sorted = [...squad].sort((a,b) => {
      const score = p => {
        if (p.cat === 'Uncapped') return 1;
        if (isOverseas(p.country)) return 4;
        return 3;
      };
      return score(b) - score(a);
    });

    for (const p of sorted) {
      if (retained.length >= 5) break;
      const ov = retained.filter(x => isOverseas(x.country));
      const uc = retained.filter(x => x.cat === 'Uncapped');
      const cp = retained.filter(x => x.cat !== 'Uncapped' && !isOverseas(x.country));

      let cost = null;
      if (p.cat === 'Uncapped') {
        if (uc.length < 1) cost = RETENTION_RULES.uncappedCost;
      } else if (isOverseas(p.country)) {
        cost = RETENTION_RULES.overseasCost[ov.length] || null;
      } else {
        cost = RETENTION_RULES.cappedSlots[cp.length] || null;
      }
      if (!cost) continue;
      if (usedBudget + cost > TOTAL_BUDGET - 600) continue;

      // 75% chance AI retains each eligible player
      if (Math.random() < 0.75) {
        retained.push({...p, name:pName(p), retentionCost:cost});
        usedBudget += cost;
      }
    }
    if (retained.length > 0) retentions[t.id] = retained;
  });
  return retentions;
}

export default function App() {
  const [screen,setScreen]           = useState('home');
  const [theme,setTheme]             = useState('dark');
  const [auctionType,setAuctionType] = useState(null);
  const [myTeamId,setMyTeamId]       = useState(null);
  const [myName,setMyName]           = useState('');
  const [isHost,setIsHost]           = useState(false);
  const [roomCode,setRoomCode]       = useState('');
  const [joinCode,setJoinCode]       = useState('');
  const [joinError,setJoinError]     = useState('');
  const [multiTeams,setMultiTeams]   = useState([]);

  // retention
  const [retentions,setRetentions]       = useState({});
  const [confirmRetain,setConfirmRetain] = useState(null);

  // auction
  const [teams,setTeams]           = useState(null);
  const [players,setPlayers]       = useState([]);
  const [playerIdx,setPlayerIdx]   = useState(0);
  const [currentBid,setCurrentBid] = useState(0);
  const [bidLeader,setBidLeader]   = useState(null);
  const [timer,setTimer]           = useState(20);
  const [phase,setPhase]           = useState('bidding');
  const [noBidYet,setNoBidYet]     = useState(true);
  const [bidHistory,setBidHistory] = useState([]);
  const [sold,setSold]             = useState([]);
  const [unsold,setUnsold]         = useState([]);
  const [goingPhase,setGoingPhase] = useState('');
  const [isAccelerated,setIsAccelerated] = useState(false);

  // finalize window
  const [finalizeWindow,setFinalizeWindow]       = useState(false);
  const [finalizeCountdown,setFinalizeCountdown] = useState(3);

  // accel select
  const [accelSelectScreen,setAccelSelectScreen] = useState(false);
  const [accelSelected,setAccelSelected]         = useState([]);

  // simulate
  const [simulating,setSimulating] = useState(false);

  // UI
  const [viewSquadId,setViewSquadId] = useState(null);
  const [viewSetData,setViewSetData] = useState(null);
  const [shake,setShake]             = useState(false);
  const [budgetErr,setBudgetErr]     = useState('');
  const [showConfetti,setShowConfetti] = useState(false);

  const timerRef    = useRef(null);
  const aiRef       = useRef(null);
  const goingRef    = useRef(null);
  const simRef      = useRef(null);
  const finalizeRef = useRef(null);
  const refs        = useRef({});

  useEffect(() => {
    refs.current = {
      teams,bidLeader,currentBid,phase,noBidYet,
      playerIdx,players,myTeamId,multiTeams,
      sold,unsold,isAccelerated,finalizeWindow
    };
  });
  // Firebase real-time room sync
useEffect(() => {
  if (screen !== 'roomLobby' || !roomCode) return;
  const unsubscribe = listenRoom(roomCode, (roomData) => {
    if (roomData?.players) {
      setMultiTeams(roomData.players);
    }
    if (roomData?.status === 'started' && !isHost) {
      setAuctionType(roomData.auctionType);
      setScreen(roomData.auctionType === 'mega' ? 'retention' : 'auction');
    }
  });
  return unsubscribe;
}, [screen, roomCode, isHost]);

  const pool = () => auctionType === 'mini' ? MINI_PLAYERS_2026 : MEGA_PLAYERS_2025;

  // ── helpers ─────────────────────────────────────────────────────────────────
  function teamOverseas(team) {
    return team.squad.filter(n => {
      const p = pool().find(x => pName(x) === n) ||
                (SQUADS_2025[team.id]||[]).find(x => pName(x) === n);
      return p && isOverseas(p.country);
    }).length;
  }
  function canBuy(team, player) {
    if (team.squad.length >= 25) return false;
    if (isOverseas(player.country) && teamOverseas(team) >= 8) return false;
    return true;
  }
  function needed(team) { return Math.max(0, 21 - team.squad.length); }

  // ── init teams ───────────────────────────────────────────────────────────────
  function initTeams(retObj = {}) {
    return TEAMS.map(t => {
      const ret  = retObj[t.id] || [];
      const cost = ret.reduce((s,p) => s + (p.retentionCost||0), 0);
      const ov   = ret.filter(p => isOverseas(p.country)).length;
      return { ...t, squad:ret.map(pName), budget:TOTAL_BUDGET-cost, spent:cost, _ov:ov };
    });
  }

  // ── build player order ───────────────────────────────────────────────────────
  function buildOrder(retObj) {
  const p = auctionType === 'mini' ? MINI_PLAYERS_2026 : MEGA_PLAYERS_2025;

  // Collect ALL retained player names across all teams
  const retainedNames = new Set();
  Object.values(retObj || {}).forEach(teamRetained => {
    teamRetained.forEach(player => {
      retainedNames.add(player.name || `${player.fn} ${player.ln}`);
    });
  });

  // Filter out retained players from auction pool
  const avail = p.filter(x => !retainedNames.has(`${x.fn} ${x.ln}`));

  const sets = {};
  avail.forEach(x => {
    if (!sets[x.set]) sets[x.set] = [];
    sets[x.set].push(x);
  });
  const out = [];
  Object.keys(sets).sort((a,b) => +a-+b).forEach(s => out.push(...shuffle(sets[s])));
  return out;
}

  // ── start auction ────────────────────────────────────────────────────────────
  function startAuction(userRetObj) {
    // AI teams also retain from their 2025 squads
    const aiRet = auctionType === 'mega' ? buildAIRetentions(myTeamId, pool()) : {};
    const fullRet = { ...aiRet, ...userRetObj };
    // User's retentions override AI for user's own team
    if (userRetObj[myTeamId]) fullRet[myTeamId] = userRetObj[myTeamId];

    const t = initTeams(fullRet);
    setTeams(t);
    setRetentions(fullRet);
    const ord = buildOrder(fullRet);
    setPlayers(ord); setPlayerIdx(0);
    setSold([]); setUnsold([]);
    setIsAccelerated(false); setSimulating(false);
    setFinalizeWindow(false);
    setScreen('auction');
  }

  // ── round init ───────────────────────────────────────────────────────────────
  useEffect(() => {
    if (screen === 'auction' && players.length > 0 && players[playerIdx]) {
      setCurrentBid(players[playerIdx].base);
      setBidLeader(null); setBidHistory([]); setNoBidYet(true);
      setPhase('bidding'); setTimer(isAccelerated ? 10 : 20);
      setBudgetErr(''); setGoingPhase('');
      setFinalizeWindow(false);
    }
  }, [playerIdx, screen, players.length, isAccelerated]);

  // ── timer ────────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (screen !== 'auction' || phase !== 'bidding' || simulating || finalizeWindow) return;
    clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      setTimer(t => {
        if (t <= 1) { clearInterval(timerRef.current); startGoingPhase(); return 0; }
        return t - 1;
      });
    }, 1000);
    return () => clearInterval(timerRef.current);
  }, [bidLeader, phase, screen, playerIdx, simulating, finalizeWindow]);

  // ── going once/twice/sold ────────────────────────────────────────────────────
  function startGoingPhase() {
    clearTimeout(goingRef.current); clearTimeout(aiRef.current);
    if (!refs.current.bidLeader) { finalizeUnsold(); return; }
    setPhase('going'); setGoingPhase('once');
    goingRef.current = setTimeout(() => {
      setGoingPhase('twice');
      goingRef.current = setTimeout(() => {
        setGoingPhase('sold');
        goingRef.current = setTimeout(finalizeSold, 700);
      }, 1200);
    }, 1200);
  }

  function finalizeUnsold() {
    setPhase('result');
    clearTimeout(goingRef.current); clearTimeout(aiRef.current); clearTimeout(finalizeRef.current);
    setFinalizeWindow(false);
    const p = refs.current.players[refs.current.playerIdx];
    setUnsold(prev => [...prev, p]);
    setTimeout(advance, 1600);
  }

  function finalizeSold() {
    setPhase('result');
    clearTimeout(aiRef.current); clearTimeout(finalizeRef.current);
    setFinalizeWindow(false);
    const p      = refs.current.players[refs.current.playerIdx];
    const leader = refs.current.bidLeader;
    const price  = refs.current.currentBid;
    if (leader) {
      setTeams(prev => prev.map(t => t.id === leader
        ? { ...t,
            squad:[...t.squad, pName(p)],
            budget:t.budget - price,
            spent:t.spent + price,
            _ov:t._ov + (isOverseas(p.country) ? 1 : 0)
          }
        : t));
      setSold(prev => [...prev, { player:p, team:leader, price }]);
      if (leader === refs.current.myTeamId) {
        setShowConfetti(true); setTimeout(() => setShowConfetti(false), 2500);
      }
    }
    setTimeout(advance, 1800);
  }

  function advance() {
    setPhase('bidding'); setGoingPhase(''); setFinalizeWindow(false);
    setPlayerIdx(p => {
      const next = p + 1;
      if (next >= refs.current.players.length) {
        if (!refs.current.isAccelerated && refs.current.unsold.length > 0) {
          setAccelSelectScreen(true); setAccelSelected([]); return p;
        }
        setScreen('summary'); return p;
      }
      return next;
    });
  }

  // ── finalize with bid window ─────────────────────────────────────────────────
  function onFinalize() {
    if (phase !== 'bidding' || !bidLeader) return;
    clearInterval(timerRef.current);
    setFinalizeWindow(true); setFinalizeCountdown(3);
    let count = 3;
    finalizeRef.current = setInterval(() => {
      count--;
      setFinalizeCountdown(count);
      if (count <= 0) {
        clearInterval(finalizeRef.current);
        setFinalizeWindow(false);
        startGoingPhase();
      }
    }, 1000);
  }

  // ── AI bidding ───────────────────────────────────────────────────────────────
  useEffect(() => {
    if (screen !== 'auction' || phase !== 'bidding' || simulating) return;
    clearTimeout(aiRef.current);
    const delay = finalizeWindow
      ? 400 + Math.random()*500  // faster during finalize window
      : isAccelerated
        ? 400 + Math.random()*600
        : 1200 + Math.random()*1600;

    aiRef.current = setTimeout(() => {
      const { phase:ph, teams:t, currentBid:cb, players:pl, playerIdx:idx, multiTeams:mt } = refs.current;
      if (ph !== 'bidding' || !t || !pl[idx]) return;
      const player     = pl[idx];
      const humanTeams = (mt||[]).map(m => m.team);
      const remaining  = pl.length - idx - 1;

      const candidates = t.filter(tm => {
        if (humanTeams.includes(tm.id)) return false;
        if (!canBuy(tm, player)) return false;
        return aiShouldBid(cb, tm, player, remaining) !== null;
      });
      if (!candidates.length) return;

      const bidder = candidates[Math.floor(Math.random()*candidates.length)];
      const newBid = aiShouldBid(cb, bidder, player, remaining);
      if (!newBid || newBid > bidder.budget) return;

      setCurrentBid(newBid); setBidLeader(bidder.id);
      setNoBidYet(false); setTimer(isAccelerated ? 8 : 15);
      setBidHistory(h => [...h, { team:bidder.short, bid:newBid, isHuman:false }]);

      // If in finalize window and AI bids — cancel finalize, reset timer
      if (refs.current.finalizeWindow) {
        clearInterval(finalizeRef.current);
        setFinalizeWindow(false);
        setTimer(isAccelerated ? 8 : 15);
      }
    }, delay);
    return () => clearTimeout(aiRef.current);
  }, [bidLeader, phase, screen, playerIdx, simulating, isAccelerated, finalizeWindow]);

  // ── user bid ─────────────────────────────────────────────────────────────────
  function userBid() {
    if (phase !== 'bidding' || simulating) return;
    const myTeam = refs.current.teams?.find(t => t.id === myTeamId);
    const player = refs.current.players[refs.current.playerIdx];
    if (!myTeam || !player) return;
    if (myTeam.squad.length >= 25) { setBudgetErr('Squad full! (max 25)'); setTimeout(()=>setBudgetErr(''),2e3); return; }
    if (isOverseas(player.country) && teamOverseas(myTeam) >= 8) { setBudgetErr('Max 8 overseas!'); setTimeout(()=>setBudgetErr(''),2e3); return; }
    const newBid = refs.current.currentBid + getBidIncrement(refs.current.currentBid);
    if (newBid > myTeam.budget) {
      setShake(true); setBudgetErr('Budget thara illa!');
      setTimeout(() => { setShake(false); setBudgetErr(''); }, 800); return;
    }

    // If in finalize window — cancel it
    if (refs.current.finalizeWindow) {
      clearInterval(finalizeRef.current);
      setFinalizeWindow(false);
    }
    clearInterval(timerRef.current);
    setCurrentBid(newBid); setBidLeader(myTeamId);
    setNoBidYet(false); setTimer(isAccelerated ? 8 : 15);
    setBidHistory(h => [...h, {
      team: TEAMS.find(t => t.id === myTeamId)?.short,
      bid: newBid, isHuman: true
    }]);
  }

  // ── simulate set ─────────────────────────────────────────────────────────────
  function simulateSet() {
    if (simulating || phase !== 'bidding') return;
    setSimulating(true);
    clearInterval(timerRef.current); clearTimeout(aiRef.current); clearTimeout(finalizeRef.current);
    setFinalizeWindow(false);
    const setNum = refs.current.players[refs.current.playerIdx]?.set;
    const rem    = refs.current.players.slice(refs.current.playerIdx).filter(p => p.set === setNum);
    let delay = 0;
    rem.forEach((player, i) => {
      simRef.current = setTimeout(() => {
        const t = refs.current.teams;
        if (!t) return;
        const humanTeams = (refs.current.multiTeams||[]).map(m => m.team);
        const eligible   = t.filter(tm => !humanTeams.includes(tm.id) && canBuy(tm, player) && tm.budget >= player.base);
        if (eligible.length > 0) {
          const buyer  = eligible[Math.floor(Math.random()*eligible.length)];
          const maxPay = Math.min(buyer.budget * 0.2, player.base * (1.5 + Math.random()*2));
          const price  = Math.max(player.base, Math.round(maxPay/getBidIncrement(player.base))*getBidIncrement(player.base));
          setTeams(prev => prev.map(tm => tm.id === buyer.id
            ? { ...tm, squad:[...tm.squad,pName(player)], budget:tm.budget-price, spent:tm.spent+price, _ov:tm._ov+(isOverseas(player.country)?1:0) }
            : tm));
          setSold(prev => [...prev, { player, team:buyer.id, price }]);
        } else {
          setUnsold(prev => [...prev, player]);
        }
        if (i === rem.length-1) {
          setSimulating(false);
          const all     = refs.current.players;
          const nextIdx = all.findIndex((p,xi) => xi > refs.current.playerIdx && p.set !== setNum);
          if (nextIdx === -1) {
            if (refs.current.unsold.length > 0) { setAccelSelectScreen(true); setAccelSelected([]); }
            else setScreen('summary');
          } else {
            setPlayerIdx(nextIdx);
          }
        }
      }, delay);
      delay += 220;
    });
  }

  // ── retention helpers ─────────────────────────────────────────────────────────
  function getRetCost(teamId, player) {
    const ex = retentions[teamId]||[];
    const ov = ex.filter(p => isOverseas(p.country));
    const uc = ex.filter(p => p.cat === 'Uncapped');
    const cp = ex.filter(p => p.cat !== 'Uncapped' && !isOverseas(p.country));
    if (player.cat === 'Uncapped') return uc.length < 1 ? RETENTION_RULES.uncappedCost : null;
    if (isOverseas(player.country)) return RETENTION_RULES.overseasCost[ov.length] || null;
    return RETENTION_RULES.cappedSlots[cp.length] || null;
  }
  function canRetain(teamId, player) {
    const ex   = retentions[teamId]||[];
    if (ex.length >= 5) return false;
    const cost = getRetCost(teamId, player);
    if (!cost) return false;
    const used = ex.reduce((s,p) => s+(p.retentionCost||0), 0);
    return used + cost <= TOTAL_BUDGET - 300;
  }
  function doRetain(teamId, player, cost) {
    const name = pName(player);
    setRetentions(prev => ({
      ...prev,
      [teamId]: [...(prev[teamId]||[]), {...player, name, retentionCost:cost}]
    }));
    setConfirmRetain(null);
  }
  function removeRetain(teamId, playerName) {
    setRetentions(prev => ({...prev, [teamId]: (prev[teamId]||[]).filter(p => p.name !== playerName)}));
  }

  // ── derived ──────────────────────────────────────────────────────────────────
  const cp          = players[playerIdx];
  const myTeamObj   = teams?.find(t => t.id === myTeamId);
  const tClass      = timer <= 5 ? 'danger' : timer <= 10 ? 'warn' : '';
  const tColor      = timer <= 5 ? 'var(--red)' : timer <= 10 ? 'var(--yellow)' : 'var(--green)';
  const progress    = players.length > 0 ? Math.round((playerIdx/players.length)*100) : 0;
  const userLeading = bidLeader === myTeamId;
  const leaderName  = bidLeader ? (userLeading ? `You (${myTeamId})` : TEAMS.find(t=>t.id===bidLeader)?.short) : '—';
  const currentPool = pool();
  const allSets     = getSets(currentPool);

  // ═══════════════════════════════════════════
  // ACCELERATED SELECT SCREEN
  // ═══════════════════════════════════════════
  if (accelSelectScreen) {
    return (
      <div className={`app ${theme}`}>
        <div className="top-bar">
          <div style={{fontWeight:'700',fontSize:'16px',color:'var(--gold)'}}>⚡ Accelerated Auction</div>
          <button className="theme-btn-sm" onClick={()=>setTheme(t=>t==='dark'?'light':'dark')}>{theme==='dark'?'☀️':'🌙'}</button>
        </div>
        <div style={{maxWidth:'700px',margin:'0 auto',padding:'20px 16px'}}>
          <div className="rules-box" style={{marginBottom:'16px'}}>
            Main auction done! Pick unsold players to bring back. <strong>10s timer. Unselected = permanently unsold.</strong>
          </div>
          <div className="field-label" style={{marginBottom:'10px'}}>Select ({accelSelected.length}/{unsold.length})</div>
          <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(190px,1fr))',gap:'8px',maxHeight:'380px',overflowY:'auto',marginBottom:'20px'}}>
            {unsold.map((p,i) => {
              const sel = accelSelected.find(x => pName(x) === pName(p));
              const rc  = ROLE_COLORS[p.role];
              return (
                <div key={i} className={`ret-player-card ${sel?'retained':''}`}
                  onClick={() => setAccelSelected(prev => sel ? prev.filter(x=>pName(x)!==pName(p)) : [...prev,p])}>
                  <div style={{fontWeight:'600',fontSize:'13px'}}>{pName(p)}</div>
                  <div style={{display:'flex',gap:'4px',marginTop:'4px',flexWrap:'wrap'}}>
                    <span className="mini-badge" style={{background:rc?.bg,color:rc?.text}}>{p.role.slice(0,4)}</span>
                    <span className="mini-badge" style={{background:'var(--bg2)',color:'var(--text-muted)'}}>{FLAG[p.country]||''}</span>
                    <span className="mini-badge" style={{background:'var(--bg2)',color:'var(--gold)'}}>Base {fmtCr(p.base)}</span>
                  </div>
                  {sel && <div style={{fontSize:'11px',color:'var(--green)',marginTop:'3px'}}>✓ Selected</div>}
                </div>
              );
            })}
          </div>
          <div style={{display:'flex',gap:'10px',flexWrap:'wrap'}}>
            <button className="btn btn-outline btn-lg" onClick={()=>setAccelSelected(unsold)}>All</button>
            <button className="btn btn-outline btn-lg" onClick={()=>setAccelSelected([])}>Clear</button>
            <button className="btn btn-gold btn-lg" style={{flex:1}}
              onClick={() => {
                setAccelSelectScreen(false);
                if (accelSelected.length > 0) {
                  setIsAccelerated(true); setPlayers(shuffle(accelSelected));
                  setPlayerIdx(0); setUnsold([]);
                } else {
                  setScreen('summary');
                }
              }}>
              {accelSelected.length > 0 ? `Start (${accelSelected.length} players) →` : 'Skip → End Auction'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ═══════════════════════════════════════════
  // HOME
  // ═══════════════════════════════════════════
  if (screen === 'home') return (
    <div className={`app ${theme}`}>
      <button className="theme-btn" onClick={()=>setTheme(t=>t==='dark'?'light':'dark')}>{theme==='dark'?'☀️':'🌙'}</button>
      <div className="home-screen">
        <div style={{textAlign:'center'}}>
          <div className="logo-ipl">🏏 IPL</div>
          <div className="logo-year">AUCTION SIMULATOR</div>
          <div className="logo-sub">2025 Mega · 2026 Mini · Realistic AI · Multiplayer</div>
        </div>
        <div className="home-btns">
          <button className="btn btn-gold btn-xl" onClick={()=>setScreen('modeSelect')}>Start Auction</button>
          <button className="btn btn-outline btn-xl" onClick={()=>setScreen('joinRoom')}>Join Friend's Room</button>
        </div>
        <div className="home-features">
          {['🏟️ 23 Sets · 155 Players','🔔 Going Once/Twice/SOLD!','🤖 AI retains + bids smart','👥 10 Player Rooms','⚡ Accelerated Round','🏏 3s Bid Window on Finalize'].map(f=>(
            <div key={f} className="feat">{f}</div>
          ))}
        </div>
      </div>
    </div>
  );

  // ═══════════════════════════════════════════
  // MODE SELECT
  // ═══════════════════════════════════════════
  if (screen === 'modeSelect') return (
    <div className={`app ${theme}`}>
      <TopBar title="Choose Auction Type" onBack={()=>setScreen('home')} theme={theme} setTheme={setTheme}/>
      <div className="center-screen">
        <div className="mode-grid">
          {[
            {k:'mega',icon:'🏟️',title:'Mega Auction 2025',desc:'155 players · 23 Sets · Real 2025 squads · AI retains · 90 Cr · Accelerated round for unsold'},
            {k:'mini',icon:'⚡',title:'Mini Auction 2026',desc:'134 players · 18 Sets · No retention · Fast paced · Great for friend sessions'},
          ].map(m => (
            <div key={m.k} className={`mode-card ${auctionType===m.k?'selected':''}`} onClick={()=>setAuctionType(m.k)}>
              <div className="mode-icon">{m.icon}</div>
              <div className="mode-title">{m.title}</div>
              <div className="mode-desc">{m.desc}</div>
            </div>
          ))}
        </div>
        <button className="btn btn-gold btn-lg" style={{marginTop:'20px',width:'100%'}} disabled={!auctionType} onClick={()=>setScreen('teamSelect')}>
          Next → Pick Team
        </button>
      </div>
    </div>
  );

  // ═══════════════════════════════════════════
  // TEAM SELECT
  // ═══════════════════════════════════════════
  if (screen === 'teamSelect') return (
    <div className={`app ${theme}`}>
      <TopBar title="Select Your Franchise" onBack={()=>setScreen('modeSelect')} theme={theme} setTheme={setTheme}/>
      <div className="team-select-screen">
        <div style={{marginBottom:'16px'}}>
          <label className="field-label">Your name</label>
          <input className="field-input" value={myName} onChange={e=>setMyName(e.target.value)} placeholder="Enter your name..."/>
        </div>
        <label className="field-label">Choose your franchise</label>
        <div className="team-grid-big" style={{marginBottom:'20px'}}>
          {TEAMS.map(t => (
            <div key={t.id} className={`team-big-card ${myTeamId===t.id?'selected':''}`}
              style={myTeamId===t.id?{borderColor:t.color,background:t.color+'18'}:{}}
              onClick={()=>setMyTeamId(t.id)}>
              <div className="team-dot-lg" style={{background:t.color}}/>
              <div>
                <div className="team-big-short" style={myTeamId===t.id?{color:t.color}:{}}>{t.short}</div>
                <div className="team-big-name">{t.name}</div>
              </div>
              <div className="team-big-budget">₹90 Cr</div>
            </div>
          ))}
        </div>
        <div className="row-btns" style={{gap:'10px'}}>
          <button className="btn btn-outline btn-lg" disabled={!myTeamId||!myName.trim()}
            onClick={()=>{
              setIsHost(true);
              const code = generateRoomCode();
              setRoomCode(code);
              setMultiTeams([{name:myName,team:myTeamId,isHost:true}]);
              createRoom(code,myTeamId,myName,auctionType);
              setScreen('roomLobby');
            }}>🏠 Create Room (max 10)</button>
          <button className="btn btn-gold btn-lg" disabled={!myTeamId||!myName.trim()}
            onClick={()=>{
              setIsHost(true);
              setMultiTeams([{name:myName,team:myTeamId,isHost:true}]);
              if (auctionType === 'mini') startAuction({});
              else setScreen('retention');
            }}>Solo Play →</button>
        </div>
      </div>
    </div>
  );

  // ═══════════════════════════════════════════
  // JOIN ROOM
  // ═══════════════════════════════════════════
  if (screen === 'joinRoom') return (
    <div className={`app ${theme}`}>
      <TopBar title="Join a Room" onBack={()=>setScreen('home')} theme={theme} setTheme={setTheme}/>
      <div className="center-screen">
        <div style={{marginBottom:'16px'}}>
          <label className="field-label">Your name</label>
          <input className="field-input" value={myName} onChange={e=>setMyName(e.target.value)} placeholder="Your name..."/>
        </div>
        <div style={{marginBottom:'16px'}}>
          <label className="field-label">Room code</label>
          <input className="field-input" value={joinCode} onChange={e=>setJoinCode(e.target.value.toUpperCase())}
            placeholder="e.g. AB12CD" maxLength={6} style={{letterSpacing:'3px',fontSize:'18px',textAlign:'center'}}/>
        </div>
        {joinError && <div className="error-box">{joinError}</div>}
        <label className="field-label">Pick your team</label>
        <div className="team-grid-big" style={{marginBottom:'16px'}}>
          {TEAMS.map(t => (
            <div key={t.id} className={`team-big-card ${myTeamId===t.id?'selected':''}`}
              style={myTeamId===t.id?{borderColor:t.color,background:t.color+'18'}:{}}
              onClick={()=>setMyTeamId(t.id)}>
              <div className="team-dot-lg" style={{background:t.color}}/>
              <div>
                <div className="team-big-short" style={myTeamId===t.id?{color:t.color}:{}}>{t.short}</div>
                <div className="team-big-name">{t.name}</div>
              </div>
            </div>
          ))}
        </div>
        <button className="btn btn-gold btn-lg btn-full" disabled={!myName.trim()||!joinCode||!myTeamId}
          onClick={()=>{
            const r = joinRoom(joinCode,myName,myTeamId);
            if (!r) {setJoinError('Room not found!');return;}
            if (r==='TEAM_TAKEN') {setJoinError('Team taken!');return;}
            if (r==='ROOM_FULL')  {setJoinError('Room full! (max 10)');return;}
            setIsHost(false); setRoomCode(joinCode);
            setMultiTeams(r.players); setAuctionType(r.auctionType);
            setScreen('roomLobby'); setJoinError('');
          }}>Join Room →</button>
      </div>
    </div>
  );

  // ═══════════════════════════════════════════
  // ROOM LOBBY
  // ═══════════════════════════════════════════
  if (screen === 'roomLobby') return (
    <div className={`app ${theme}`}>
      <TopBar title="Room Lobby" theme={theme} setTheme={setTheme}/>
      <div className="center-screen">
        <div className="room-code-box">
          <div style={{fontSize:'13px',color:'var(--text-muted)',marginBottom:'6px'}}>Share with friends (max 10)</div>
          <div className="room-code">{roomCode}</div>
          <button className="btn btn-outline" style={{marginTop:'10px'}} onClick={()=>navigator.clipboard?.writeText(roomCode)}>📋 Copy</button>
        </div>
        <div style={{marginBottom:'20px'}}>
          <div className="field-label" style={{marginBottom:'10px'}}>Players ({multiTeams.length}/10)</div>
          {multiTeams.map((p,i) => {
            const meta = TEAMS.find(t=>t.id===p.team);
            return (
              <div key={i} className="lobby-player-row">
                <div style={{display:'flex',alignItems:'center',gap:'8px'}}>
                  <div className="team-dot-lg" style={{background:meta?.color||'#888'}}/>
                  <span style={{fontWeight:'500'}}>{p.name}</span>
                  {p.isHost && <span className="badge-host">HOST</span>}
                </div>
                <span style={{fontSize:'13px',color:'var(--text-muted)'}}>{meta?.short}</span>
              </div>
            );
          })}
        </div>
        {isHost
            ? <button className="btn btn-gold btn-lg btn-full"
      onClick={async () => {
        await updateRoomData(roomCode, { status: 'started', auctionType });
        setScreen(auctionType === 'mega' ? 'retention' : 'auction');
      }}>
              Start {auctionType==='mega'?'Retention Phase':'Auction'} →
            </button>
          : <div style={{textAlign:'center',color:'var(--text-muted)',fontSize:'14px'}}>Waiting for host...</div>}
      </div>
    </div>
  );

  // ═══════════════════════════════════════════
  // RETENTION
  // ═══════════════════════════════════════════
  if (screen === 'retention') {
    const squad     = SQUADS_2025[myTeamId]||[];
    const myRet     = retentions[myTeamId]||[];
    const myRetCost = myRet.reduce((s,p) => s+(p.retentionCost||0), 0);

    return (
      <div className={`app ${theme}`}>
        <TopBar title={`Retain from ${myTeamId} 2025 Squad`} theme={theme} setTheme={setTheme}/>

        {/* Confirm popup */}
        {confirmRetain && (
          <div className="modal-backdrop" onClick={()=>setConfirmRetain(null)}>
            <div className="modal-box" style={{maxWidth:'340px'}} onClick={e=>e.stopPropagation()}>
              <div style={{fontSize:'16px',fontWeight:'700',marginBottom:'8px'}}>{pName(confirmRetain.player)}</div>
              <div style={{fontSize:'13px',color:'var(--text-muted)',marginBottom:'16px'}}>
                {confirmRetain.player.role} · {confirmRetain.player.cat} · {FLAG[confirmRetain.player.country]||''} {confirmRetain.player.country}
              </div>
              <div style={{background:'var(--bg3)',borderRadius:'10px',padding:'14px',textAlign:'center',marginBottom:'16px'}}>
                <div style={{fontSize:'12px',color:'var(--text-muted)'}}>Retention cost</div>
                <div style={{fontSize:'28px',fontWeight:'700',color:'var(--gold)',fontFamily:'var(--font-display)'}}>{fmtCr(confirmRetain.cost)}</div>
                <div style={{fontSize:'12px',color:'var(--text-muted)',marginTop:'4px'}}>
                  Budget remaining: {fmtCr(TOTAL_BUDGET - myRetCost - confirmRetain.cost)}
                </div>
              </div>
              <div style={{display:'flex',gap:'8px'}}>
                <button className="btn btn-outline btn-lg" style={{flex:1}} onClick={()=>setConfirmRetain(null)}>Cancel</button>
                <button className="btn btn-gold btn-lg" style={{flex:1}} onClick={()=>doRetain(myTeamId,confirmRetain.player,confirmRetain.cost)}>
                  Retain @ {fmtCr(confirmRetain.cost)}
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="retention-screen">
          <div className="ret-budget-bar">
            <div>
              <div style={{fontSize:'13px',color:'var(--text-muted)'}}>Budget after retention</div>
              <div style={{fontSize:'22px',fontWeight:'700',color:'var(--gold)'}}>{fmtCr(TOTAL_BUDGET-myRetCost)}</div>
            </div>
            <div style={{textAlign:'right'}}>
              <div style={{fontSize:'13px',color:'var(--text-muted)'}}>Retained</div>
              <div style={{fontSize:'22px',fontWeight:'700'}}>{myRet.length}/5</div>
            </div>
          </div>

          <div className="rules-box" style={{marginBottom:'14px'}}>
            <strong>Slot costs — click player to see & confirm:</strong><br/>
            Indian Capped: <strong>18Cr → 14Cr → 11Cr</strong><br/>
            Overseas Capped: <strong>18Cr → 14Cr</strong><br/>
            Uncapped (any): <strong>4Cr</strong><br/>
            Max 5 · Max 2 Overseas · Max 1 Uncapped · <strong>AI auto-retains for other 9 teams</strong>
          </div>

          {myRet.length > 0 && (
            <div style={{marginBottom:'14px'}}>
              <div className="field-label" style={{marginBottom:'8px'}}>Retained (click to remove)</div>
              <div style={{display:'flex',flexWrap:'wrap',gap:'6px'}}>
                {myRet.map((p,i) => (
                  <div key={i} className="retained-pill" onClick={()=>removeRetain(myTeamId,p.name)}>
                    {p.fn} {p.ln} <span style={{color:'var(--gold)'}}>@ {fmtCr(p.retentionCost)}</span> ✕
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="field-label" style={{marginBottom:'10px'}}>Your 2025 squad — click to retain</div>
          <div className="ret-player-grid">
            {squad.map((p,i) => {
              const name    = pName(p);
              const isRet   = myRet.find(r => r.name === name);
              const cost    = getRetCost(myTeamId,p);
              const canDo   = !isRet && canRetain(myTeamId,p);
              const rc      = ROLE_COLORS[p.role]||ROLE_COLORS.Batter;
              return (
                <div key={i}
                  className={`ret-player-card ${isRet?'retained':''} ${!isRet&&!canDo?'disabled':''}`}
                  onClick={() => {
                    if (isRet) { removeRetain(myTeamId,name); return; }
                    if (canDo && cost) setConfirmRetain({player:p, teamId:myTeamId, cost});
                  }}>
                  <div style={{fontWeight:'600',fontSize:'13px'}}>{p.fn} {p.ln}</div>
                  <div style={{display:'flex',gap:'4px',flexWrap:'wrap',marginTop:'4px'}}>
                    <span className="mini-badge" style={{background:rc.bg,color:rc.text}}>{p.role.slice(0,4)}</span>
                    <span className="mini-badge" style={{background:'var(--bg2)',color:'var(--text-muted)'}}>{FLAG[p.country]||''} {p.cat==='Uncapped'?'U':'C'}</span>
                  </div>
                  {isRet   && <div style={{fontSize:'11px',color:'var(--green)',marginTop:'3px'}}>✓ Retained @ {fmtCr(p.retentionCost)}</div>}
                  {!isRet && canDo && cost && <div style={{fontSize:'11px',color:'var(--gold)',marginTop:'3px'}}>Click → {fmtCr(cost)}</div>}
                  {!isRet && !canDo && <div style={{fontSize:'10px',color:'var(--red)',marginTop:'3px'}}>{cost===null?'Slot full':'—'}</div>}
                </div>
              );
            })}
          </div>

          <div className="row-btns" style={{marginTop:'20px',gap:'10px'}}>
            <button className="btn btn-outline btn-lg" onClick={()=>setRetentions(prev=>({...prev,[myTeamId]:[]}))}> Clear All</button>
            <button className="btn btn-gold btn-lg" onClick={()=>startAuction({[myTeamId]: retentions[myTeamId]||[]})}>
              Done → Start Auction ({myRet.length} retained)
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ═══════════════════════════════════════════
  // SUMMARY
  // ═══════════════════════════════════════════
  if (screen === 'summary') {
    const myTeam   = teams?.find(t => t.id === myTeamId);
    const myMeta   = TEAMS.find(t => t.id === myTeamId);
    const myBought = sold.filter(s => s.team === myTeamId).map(s => pName(s.player));
    const sorted   = [...(teams||[])].sort((a,b) => b.squad.length - a.squad.length);
    return (
      <div className={`app ${theme}`}>
        <TopBar title="Auction Complete 🏆" theme={theme} setTheme={setTheme}/>
        <div className="summary-screen">
          <div style={{textAlign:'center',marginBottom:'20px',fontSize:'14px',color:'var(--text-muted)'}}>
            {sold.length} sold · {unsold.length} unsold
          </div>

          <div className="card" style={{borderColor:myMeta?.color,borderWidth:'1.5px',marginBottom:'16px'}}>
            <div style={{fontSize:'13px',fontWeight:'600',color:myMeta?.color,marginBottom:'12px'}}>Your Squad — {myMeta?.name}</div>
            <div className="stat-grid3">
              {[{l:'Players',v:myTeam?.squad.length},{l:'Spent',v:fmtCr(myTeam?.spent||0)},{l:'Left',v:fmtCr(myTeam?.budget||0)}].map(s => (
                <div key={s.l} className="stat-box">
                  <div className="stat-label">{s.l}</div>
                  <div className="stat-val">{s.v}</div>
                </div>
              ))}
            </div>
            <div style={{height:'1px',background:'var(--border)',margin:'12px 0'}}/>
            <div style={{display:'flex',flexWrap:'wrap',gap:'6px'}}>
              {myTeam?.squad.map((p,i) => (
                <span key={i} className={`squad-pill ${myBought.includes(p)?'bought':''}`}>{p}</span>
              ))}
            </div>
          </div>

          <div className="field-label" style={{marginBottom:'10px'}}>All Franchises (click to view squad)</div>
          {sorted.map(t => {
            const meta = TEAMS.find(tm => tm.id===t.id);
            const ov   = teamOverseas(t);
            return (
              <div key={t.id} className="all-team-row" onClick={()=>setViewSquadId(t.id)}>
                <div style={{display:'flex',alignItems:'center',gap:'8px'}}>
                  <div className="team-dot-lg" style={{background:meta?.color}}/>
                  <span style={{fontWeight:'600'}}>{t.short}</span>
                  {t.id===myTeamId && <span className="badge-you">YOU</span>}
                </div>
                <div className="all-team-stats">
                  <span>{t.squad.length} players</span>
                  <span>🌍{ov}</span>
                  <span>Spent {fmtCr(t.spent)}</span>
                  <span style={{color:'var(--green)'}}>Left {fmtCr(t.budget)}</span>
                </div>
              </div>
            );
          })}

          {unsold.length > 0 && (
            <div className="card" style={{marginTop:'16px'}}>
              <div className="field-label" style={{marginBottom:'8px'}}>Unsold ({unsold.length})</div>
              <div style={{display:'flex',flexWrap:'wrap',gap:'6px'}}>
                {unsold.map((p,i) => <span key={i} className="squad-pill">{pName(p)}</span>)}
              </div>
            </div>
          )}

          <button className="btn btn-gold btn-lg btn-full" style={{marginTop:'20px'}}
            onClick={() => {
              setScreen('home'); setTeams(null); setSold([]); setUnsold([]);
              setRetentions({}); setPlayers([]); setIsAccelerated(false);
              setFinalizeWindow(false);
            }}>
            Play Again
          </button>
        </div>
        {viewSquadId && <SquadModal team={teams?.find(t=>t.id===viewSquadId)} meta={TEAMS.find(t=>t.id===viewSquadId)} sold={sold} onClose={()=>setViewSquadId(null)}/>}
      </div>
    );
  }

  // ═══════════════════════════════════════════
  // AUCTION SCREEN
  // ═══════════════════════════════════════════
  const setsInfo = allSets.map(s => {
    const soldInSet = sold.filter(x => x.player.set === s.set).length;
    const total     = currentPool.filter(p => p.set === s.set).length;
    return { ...s, soldInSet, total, isCurrent: s.set === cp?.set };
  });

  return (
    <div className={`app ${theme}`}>
      {showConfetti && <Confetti/>}
      {viewSquadId && <SquadModal team={teams?.find(t=>t.id===viewSquadId)} meta={TEAMS.find(t=>t.id===viewSquadId)} sold={sold} onClose={()=>setViewSquadId(null)}/>}

      {/* Set popup */}
      {viewSetData && (
        <div className="modal-backdrop" onClick={()=>setViewSetData(null)}>
          <div className="modal-box" onClick={e=>e.stopPropagation()}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'14px'}}>
              <div style={{fontWeight:'700',fontSize:'15px',color:'var(--gold)'}}>{viewSetData.name}</div>
              <button className="btn-close" onClick={()=>setViewSetData(null)}>✕</button>
            </div>
            <div style={{fontSize:'12px',color:'var(--text-muted)',marginBottom:'10px'}}>
              {viewSetData.players.length} players in this set
            </div>
            <div style={{display:'flex',flexWrap:'wrap',gap:'6px',maxHeight:'340px',overflowY:'auto'}}>
              {viewSetData.players.map((p,i) => {
                const isSold   = sold.find(s => pName(s.player) === pName(p));
                const isUnsold = unsold.find(x => pName(x) === pName(p));
                const rc = ROLE_COLORS[p.role];
                return (
                  <div key={i} style={{background:'var(--bg3)',border:'1px solid var(--border)',borderRadius:'8px',padding:'8px 10px',minWidth:'155px'}}>
                    <div style={{fontWeight:'600',fontSize:'13px',color:isSold?'var(--green)':isUnsold?'var(--text-hint)':'var(--text)'}}>{pName(p)}</div>
                    <div style={{display:'flex',gap:'4px',marginTop:'4px',flexWrap:'wrap'}}>
                      <span className="mini-badge" style={{background:rc?.bg,color:rc?.text}}>{p.role.slice(0,4)}</span>
                      <span className="mini-badge" style={{background:'var(--bg2)',color:'var(--gold)'}}>Base {fmtCr(p.base)}</span>
                    </div>
                    {isSold   && <div style={{fontSize:'10px',color:'var(--green)',marginTop:'3px'}}>✓ {isSold.team} @ {fmtCr(isSold.price)}</div>}
                    {isUnsold && <div style={{fontSize:'10px',color:'var(--text-hint)',marginTop:'3px'}}>Unsold</div>}
                    {!isSold && !isUnsold && p.set===cp?.set && <div style={{fontSize:'10px',color:'var(--yellow)',marginTop:'3px'}}>In auction</div>}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="auction-header">
        <div>
          <div className="header-logo">
            IPL {isAccelerated ? '⚡ ACCELERATED' : auctionType==='mini' ? '2026 MINI' : '2025 MEGA'} AUCTION
          </div>
          <div className="header-sub">{cp?.setName || `Player ${playerIdx+1}/${players.length}`}</div>
        </div>
        <div style={{display:'flex',alignItems:'center',gap:'8px'}}>
          <div className="purse-chip">{myTeamObj?.short} · {fmtCr(myTeamObj?.budget||0)}</div>
          <div style={{fontSize:'11px',color:'var(--text-muted)',whiteSpace:'nowrap'}}>👥{myTeamObj?.squad.length||0}/25</div>
          <button className="theme-btn-sm" onClick={()=>setTheme(t=>t==='dark'?'light':'dark')}>{theme==='dark'?'☀️':'🌙'}</button>
        </div>
      </div>
      <div className="progress-wrap"><div className="progress-fill" style={{width:`${progress}%`}}/></div>

      <div className="auction-layout">
        <div className="auction-left">

          {/* Set strip */}
          {!isAccelerated && (
            <div className="set-strip">
              {setsInfo.map(s => (
                <div key={s.set}
                  className={`set-chip ${s.isCurrent?'current':''} ${s.soldInSet===s.total?'done':''}`}
                  onClick={() => setViewSetData({name:s.name, players:currentPool.filter(p=>p.set===s.set)})}
                  title={`${s.name} — ${s.total} players`}>
                  <div style={{fontSize:'10px',fontWeight:'600'}}>S{s.set}</div>
                  <div style={{fontSize:'9px',color:s.isCurrent?'var(--gold)':'var(--text-muted)'}}>{s.soldInSet}/{s.total}</div>
                </div>
              ))}
            </div>
          )}

          {/* Player card */}
          {cp && (
            <div className="card player-card-big">
              {cp.setName && <div className="set-banner">{cp.setName}</div>}
              {isAccelerated && <div className="accel-banner">⚡ ACCELERATED AUCTION</div>}
              {simulating    && <div className="sim-banner">⏩ Simulating set — AI buying players...</div>}

              <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:'12px'}}>
                <div style={{flex:1}}>
                  <div style={{display:'flex',gap:'6px',flexWrap:'wrap',marginBottom:'8px'}}>
                    <span className="badge" style={{background:CAT_COLORS[cp.cat]?.bg,color:CAT_COLORS[cp.cat]?.text}}>{cp.cat}</span>
                    <span className="badge" style={{background:ROLE_COLORS[cp.role]?.bg,color:ROLE_COLORS[cp.role]?.text}}>{cp.role}</span>
                    <span className="badge" style={{background:'var(--bg2)',color:'var(--text-muted)'}}>{FLAG[cp.country]||''} {cp.country}</span>
                  </div>
                  <div className="player-name-big">{cp.fn} {cp.ln}</div>
                  <div style={{fontSize:'13px',color:'var(--text-muted)',marginTop:'2px'}}>
                    Age {cp.age} · T20I {cp.t20caps} caps · Base {fmtCr(cp.base)}
                  </div>
                </div>

                {phase==='bidding' && !simulating && (
                  <div className={`timer-ring ${tClass}`}>
                    <span className="timer-num-big" style={{color:tColor}}>{timer}</span>
                    <span className="timer-sec">s</span>
                  </div>
                )}
                {phase==='going' && (
                  <div className="going-ring">
                    <span className="going-text">
                      {goingPhase==='once'  && 'Going\nOnce...'}
                      {goingPhase==='twice' && 'Going\nTwice...'}
                      {goingPhase==='sold'  && '🔨 SOLD!'}
                    </span>
                  </div>
                )}
                {phase==='result' && bidLeader && <div className="sold-ring">✓</div>}
              </div>

              {/* Unsold warn */}
              {phase==='bidding' && noBidYet && timer<=5 && !simulating && (
                <div className="unsold-warn">⚠️ No bids — UNSOLD in {timer}s...</div>
              )}

              {/* Finalize window */}
              {finalizeWindow && (
                <div className="finalize-banner">
                  🔔 Going in {finalizeCountdown}s — bid NOW to counter! Leader: {leaderName}
                </div>
              )}

              {/* Going panel */}
              {phase==='going' && (
                <div className={`going-panel ${goingPhase==='sold'?'sold-anim':''}`}>
                  <div style={{fontSize:'14px',color:'var(--text-muted)',marginBottom:'4px'}}>
                    {TEAMS.find(t=>t.id===bidLeader)?.name}
                  </div>
                  <div style={{fontSize:'32px',fontWeight:'700',fontFamily:'var(--font-display)',color:'var(--gold)'}}>
                    {fmtCr(currentBid)}
                  </div>
                  <div className={`going-label ${goingPhase}`}>
                    {goingPhase==='once'  && '🔔 GOING ONCE...'}
                    {goingPhase==='twice' && '🔔🔔 GOING TWICE...'}
                    {goingPhase==='sold'  && '🔨 SOLD!'}
                  </div>
                </div>
              )}

              {/* Result */}
              {phase==='result' && (
                <div className={`result-panel ${bidLeader?'sold':'unsold'}`}>
                  {bidLeader
                    ? <>
                        <div style={{fontSize:'16px',fontWeight:'600',color:'var(--green)'}}>
                          {userLeading ? '🎉 Sold to YOU!' : `🔨 Sold to ${TEAMS.find(t=>t.id===bidLeader)?.name}`}
                        </div>
                        <div style={{fontSize:'30px',fontWeight:'700',color:'var(--green)',fontFamily:'var(--font-display)',marginTop:'4px'}}>
                          {fmtCr(currentBid)}
                        </div>
                      </>
                    : <>
                        <div style={{fontSize:'24px',marginBottom:'4px'}}>🔨</div>
                        <div style={{fontSize:'18px',fontWeight:'700',color:'var(--text-muted)'}}>UNSOLD</div>
                      </>}
                </div>
              )}

              {/* Bid controls */}
              {phase==='bidding' && !simulating && (
                <>
                  <div className="bid-display-row">
                    <div>
                      <div style={{fontSize:'12px',color:'var(--text-muted)'}}>{noBidYet?'Base price':'Current bid'}</div>
                      <div style={{fontSize:'34px',fontWeight:'700',fontFamily:'var(--font-display)',color:'var(--text)'}}>
                        {fmtCr(currentBid)}
                      </div>
                    </div>
                    <div style={{textAlign:'right'}}>
                      <div style={{fontSize:'12px',color:'var(--text-muted)'}}>Leader</div>
                      <div style={{fontSize:'16px',fontWeight:'600',color:userLeading?'var(--green)':'var(--text)'}}>
                        {leaderName}
                      </div>
                    </div>
                  </div>

                  <div style={{display:'flex',gap:'8px',marginBottom:'8px'}}>
                    <button className={`btn-bid ${shake?'shake':''}`} onClick={userBid}>
                      Bid → {fmtCr(currentBid+getBidIncrement(currentBid))}
                    </button>
                    {bidLeader && !finalizeWindow && (
                      <button className="btn-finalize" onClick={onFinalize}>Finalize 🔨</button>
                    )}
                    {!bidLeader && (
                      <button className="btn-skip" onClick={()=>{clearInterval(timerRef.current);finalizeUnsold();}}>
                        Skip
                      </button>
                    )}
                  </div>

                  {!isAccelerated && (
                    <button className="btn btn-outline btn-full" style={{fontSize:'12px',padding:'7px'}} onClick={simulateSet}>
                      ⏩ Simulate SET {cp.set} ({players.slice(playerIdx).filter(p=>p.set===cp.set).length} players left)
                    </button>
                  )}
                  {budgetErr && <div style={{fontSize:'12px',color:'var(--red)',marginTop:'6px',textAlign:'center'}}>{budgetErr}</div>}
                </>
              )}
            </div>
          )}

          {/* Bid history */}
          <div className="card" style={{padding:'12px'}}>
            <div className="field-label" style={{marginBottom:'8px'}}>Bid history</div>
            <div style={{maxHeight:'130px',overflowY:'auto'}}>
              {bidHistory.length===0
                ? <div style={{fontSize:'12px',color:'var(--text-muted)'}}>No bids — {isAccelerated?'10':'20'}s before UNSOLD</div>
                : [...bidHistory].reverse().map((b,i) => (
                  <div key={i} style={{display:'flex',justifyContent:'space-between',padding:'4px 0',borderBottom:'1px solid var(--border)',fontSize:'13px',color:b.isHuman?'var(--green)':'var(--text-muted)'}}>
                    <span>{b.team}{b.isHuman?' (you)':''}</span>
                    <span style={{fontWeight:'600'}}>{fmtCr(b.bid)}</span>
                  </div>
                ))}
            </div>
          </div>

          {/* Sold strip */}
          {sold.length > 0 && (
            <div className="card" style={{padding:'12px'}}>
              <div className="field-label" style={{marginBottom:'8px'}}>Sold ({sold.length}) · Unsold ({unsold.length})</div>
              <div style={{display:'flex',flexWrap:'wrap',gap:'5px'}}>
                {sold.slice(-8).map((s,i) => (
                  <span key={i} className="sold-chip">
                    {s.player.fn} {s.player.ln.slice(0,8)} → {s.team} @ {fmtCr(s.price)}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Teams sidebar */}
        <div className="teams-sidebar">
          {teams?.map(t => {
            const meta     = TEAMS.find(tm => tm.id===t.id);
            const spentPct = Math.min(100, Math.round((t.spent/(t.spent+t.budget+1))*100));
            const ov       = teamOverseas(t);
            const nd       = needed(t);
            return (
              <div key={t.id}
                className={`team-side-card ${t.id===myTeamId?'me':''} ${bidLeader===t.id?'active':''}`}
                onClick={()=>setViewSquadId(t.id)} title="Click to view squad">
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                  <div style={{display:'flex',alignItems:'center',gap:'5px'}}>
                    <div className="team-dot-sm" style={{background:meta?.color}}/>
                    <span style={{fontWeight:'600',fontSize:'13px',color:t.id===myTeamId?meta?.color:'var(--text)'}}>{t.short}</span>
                    {t.id===myTeamId   && <span className="badge-you">YOU</span>}
                    {bidLeader===t.id  && <span className="badge-bidding">BIDDING</span>}
                  </div>
                  <div style={{textAlign:'right'}}>
                    <div style={{fontSize:'12px',fontWeight:'600'}}>{fmtCr(t.budget)}</div>
                    <div style={{fontSize:'10px',color:'var(--text-muted)'}}>{t.squad.length}/25 · 🌍{ov}</div>
                  </div>
                </div>
                {nd > 0 && <div style={{fontSize:'10px',color:'var(--yellow)',marginTop:'1px'}}>Need {nd} more</div>}
                <div className="budget-track">
                  <div style={{height:'100%',borderRadius:'2px',background:meta?.color,width:`${spentPct}%`,transition:'width 0.4s'}}/>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── Sub components ────────────────────────────────────────────────────────────
function TopBar({title, onBack, theme, setTheme}) {
  return (
    <div className="top-bar">
      {onBack ? <button className="btn-back" onClick={onBack}>← Back</button> : <div/>}
      <div style={{fontWeight:'600',fontSize:'15px'}}>{title}</div>
      <button className="theme-btn-sm" onClick={()=>setTheme(t=>t==='dark'?'light':'dark')}>
        {theme==='dark'?'☀️':'🌙'}
      </button>
    </div>
  );
}

function SquadModal({team, meta, sold, onClose}) {
  if (!team) return null;
  const bought = sold.filter(s => s.team===team.id);
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-box" onClick={e=>e.stopPropagation()}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'14px'}}>
          <div style={{fontWeight:'700',fontSize:'17px',color:meta?.color}}>{meta?.name}</div>
          <button className="btn-close" onClick={onClose}>✕</button>
        </div>
        <div style={{display:'flex',gap:'12px',marginBottom:'14px',fontSize:'13px',color:'var(--text-muted)',flexWrap:'wrap'}}>
          <span>💰 {fmtCr(team.budget)} left</span>
          <span>👥 {team.squad.length}/25</span>
          <span>💸 {fmtCr(team.spent)} spent</span>
        </div>
        <div style={{display:'flex',flexWrap:'wrap',gap:'6px',maxHeight:'320px',overflowY:'auto'}}>
          {team.squad.length===0
            ? <span style={{color:'var(--text-muted)',fontSize:'13px'}}>No players yet</span>
            : team.squad.map((p,i) => {
                const sale = bought.find(s => `${s.player.fn} ${s.player.ln}`===p);
                return (
                  <div key={i} className="squad-pill-detail">
                    <span>{p}</span>
                    {sale && <span style={{fontSize:'10px',color:'var(--gold)',marginLeft:'4px'}}>@ {fmtCr(sale.price)}</span>}
                  </div>
                );
              })}
        </div>
      </div>
    </div>
  );
}

function Confetti() {
  const colors = ['#f5a623','#22c55e','#3b82f6','#ec4899','#a855f7'];
  return (
    <div style={{position:'fixed',top:0,left:0,width:'100%',height:'100%',pointerEvents:'none',zIndex:9999}}>
      {Array.from({length:40}).map((_,i) => (
        <div key={i} style={{
          position:'absolute', left:Math.random()*100+'%', top:'-10px',
          width:'8px', height:'8px', background:colors[i%colors.length],
          borderRadius:Math.random()>0.5?'50%':'0',
          animation:`confettiFall ${1+Math.random()*1.5}s ease-in forwards`,
          animationDelay:Math.random()*0.8+'s',
        }}/>
      ))}
    </div>
  );
}