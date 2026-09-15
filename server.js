/* =====================================================================
   RAJADA — Servidor unificado
   ---------------------------------------------------------------------
   • WebSocket  em /              → matchmaking + partidas em tempo real
   • HTTP API   em /api           → registrar, login, perfil, ranque
   • Health     em /health        → monitoramento
   ===================================================================== */
const WebSocket = require('ws');
const http      = require('http');
const crypto    = require('crypto');

const api = require('./api');   // rotas HTTP (registrar, login, perfil...)
const db  = require('./db');    // pool MySQL + criação do schema

const clients = new Map();

/* ---------- Configuração ---------- */
const PORT = parseInt(
  process.env.RAJADA_PORT ||
  process.env.SERVER_PORT ||
  process.env.PORT ||
  '8080',
  10
);
const HOST = process.env.RAJADA_HOST || process.env.HOST || '0.0.0.0';

const MAX_PER_ROOM     = 8;
const QUEUE_TIMEOUT_MS = 30000;
const LOBBY_COUNTDOWN  = 10;
const MATCH_COUNTDOWN  = 5;
const MATCH_DURATION   = 180;
const KILL_TARGET      = 20;

/* Filas separadas por modo */
const queues = {
  tatico:     [],   /* 4v4 com bots */
  x1:         [],   /* 1v1 sem bots, só players */
  x2:         []    /* 2v2 sem bots */
};
const rooms  = new Map();
const grupos = new Map(); /* id -> { lider, membros:Set<clientId>, modo } */

const log = (...a) => console.log(`[${new Date().toISOString()}]`, ...a);
const uid = () => crypto.randomBytes(8).toString('hex');

/* ---------- Helpers WebSocket ---------- */
function send(ws, obj) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    try { ws.send(JSON.stringify(obj)); } catch (e) {}
  }
}

function broadcast(room, obj, exceptId) {
  const msg = JSON.stringify(obj);
  for (const p of room.players) {
    if (!p.ws || p.id === exceptId) continue;
    if (p.ws.readyState === WebSocket.OPEN) {
      try { p.ws.send(msg); } catch (e) {}
    }
  }
}

/* ---------- Helpers de cliente ---------- */
function clientePorNick(nick) {
  for (const [, c] of clients)
    if (c.nick.toLowerCase() === nick.toLowerCase()) return c;
  return null;
}
function clientePorId(id) { return clients.get(id) || null; }

/* Notifica todos os amigos online sobre mudança de status */
function notificarAmigosOnline(client, status) {
  if (!client.amigosIds || client.amigosIds.length === 0) return;
  for (const aid of client.amigosIds) {
    const amigo = clients.get(aid);
    if (amigo) send(amigo.ws, {
      type: 'amigo_status',
      nick: client.nick,
      status,         /* 'online' | 'offline' | 'em_partida' */
      modo: client.modoAtual || null
    });
  }
}

/* ---------- Filas ---------- */
function queueStatus(modo) {
  const q = queues[modo] || [];
  return q.map((c, i) => ({ id: c.id, nick: c.nick, pos: i + 1 }));
}

function pushQueue(client, modo) {
  const q = queues[modo]; if (!q) return;
  if (q.find(c => c.id === client.id)) return;
  client.queuedAt = Date.now();
  client.modoFila  = modo;
  client.room      = null;
  q.push(client);
  broadcastQueue(modo);
}

function removeFromQueues(client) {
  for (const modo in queues) {
    const q = queues[modo];
    const i = q.findIndex(c => c.id === client.id);
    if (i >= 0) { q.splice(i, 1); broadcastQueue(modo); }
  }
}

function broadcastQueue(modo) {
  const q = queues[modo] || [];
  const st = queueStatus(modo);
  for (let i = 0; i < q.length; i++) {
    send(q[i].ws, { type: 'queue_status', modo, pos: i + 1, total: q.length, list: st });
  }
}

/* ---------- Salas ---------- */
function createRoom(players, mode) {
  const room = {
    id: uid(), mode: mode || 'tatico', players: [],
    phase: 'countdown',
    countdownEnd: Date.now() + LOBBY_COUNTDOWN * 1000,
    matchEnd: 0, scoreBlue: 0, scoreRed: 0, chat: []
  };

  /* Para X1 e X2 não há bots — times menores */
  const maxAliados = mode === 'x1' ? 1 : mode === 'x2' ? 2 : Math.ceil(players.length / 2);
  const shuffled   = players.slice().sort(() => Math.random() - 0.5);

  shuffled.forEach((p, idx) => {
    p.team = idx < maxAliados ? 'aliado' : 'inimigo';
    const base = p.team === 'aliado'
      ? { x: -46, z: (idx - 0.5) * 4 }
      : { x:  46, z: (idx - maxAliados - 0.5) * 4 };
    p.pos  = { x: base.x, y: 1.72, z: base.z };
    p.yaw  = p.team === 'aliado' ? Math.PI / 2 : -Math.PI / 2;
    p.hp   = 100; p.alive = true; p.kills = 0;
    p.room = room; p.modoAtual = mode;
    room.players.push(p);
  });

  rooms.set(room.id, room);
  return room;
}

function startRoomCountdown(room) {
  room.phase = 'countdown';
  room.countdownEnd = Date.now() + LOBBY_COUNTDOWN * 1000;
  for (const p of room.players) {
    send(p.ws, {
      type: 'match_found', roomId: room.id, yourId: p.id,
      team: p.team, countdown: LOBBY_COUNTDOWN, modo: room.mode,
      semBots: room.mode === 'x1' || room.mode === 'x2',
      players: room.players.map(q => ({ id: q.id, nick: q.nick, team: q.team, pos: q.pos, yaw: q.yaw }))
    });
    notificarAmigosOnline(p, 'em_partida');
  }
  let left = LOBBY_COUNTDOWN;
  const iv = setInterval(() => {
    left--;
    broadcast(room, { type: 'lobby_tick', left });
    if (left <= 0) { clearInterval(iv); beginMatch(room); }
  }, 1000);
}

function beginMatch(room) {
  room.phase   = 'playing';
  room.matchEnd = Date.now() + MATCH_DURATION * 1000;
  for (const p of room.players) {
    p.pos = p.team === 'aliado'
      ? { x: -46, y: 1.72, z: (Math.random() - 0.5) * 12 }
      : { x:  46, y: 1.72, z: (Math.random() - 0.5) * 12 };
    p.yaw = p.team === 'aliado' ? Math.PI / 2 : -Math.PI / 2;
    p.hp  = 100; p.alive = true;
  }
  broadcast(room, {
    type: 'match_start', startAt: Date.now(),
    inGameCountdown: MATCH_COUNTDOWN, duration: MATCH_DURATION,
    modo: room.mode, semBots: room.mode === 'x1' || room.mode === 'x2',
    players: room.players.map(q => ({ id: q.id, nick: q.nick, team: q.team, pos: q.pos, yaw: q.yaw }))
  });
  room._endTimer = setTimeout(() => endRoom(room, 'timeout'), MATCH_DURATION * 1000);
}

function endRoom(room, reason) {
  if (room.phase === 'ended') return;
  room.phase = 'ended';
  if (room._endTimer) clearTimeout(room._endTimer);
  broadcast(room, { type: 'match_end', reason, scoreBlue: room.scoreBlue, scoreRed: room.scoreRed });
  for (const p of room.players) {
    p.room = null; p.modoAtual = null;
    notificarAmigosOnline(p, 'online');
  }
  setTimeout(() => rooms.delete(room.id), 5000);
}

/* Verifica se X1/X2 ficou sem oponentes e encerra com vencedor por kills */
function verificarSobrouSo1(room) {
  if (room.phase !== 'playing') return;
  /* Só aplica em modos sem bots */
  if (room.mode !== 'x1' && room.mode !== 'x2') return;

  const ativos = room.players.filter(p => p.ws && p.ws.readyState === 1);
  if (ativos.length === 0) { endRoom(room, 'empty'); return; }
  if (ativos.length >= 2) return; /* ainda tem oponentes — continua */

  /* Sobrou só 1 player — encerra e declara vencedor por kills */
  const vencedor = ativos[0];
  /* Soma kills de todos do mesmo time para o placar final */
  room.players.forEach(p => {
    if (p.team === 'aliado') room.scoreBlue = Math.max(room.scoreBlue, p.kills || 0);
    else                     room.scoreRed  = Math.max(room.scoreRed,  p.kills || 0);
  });

  if (room.phase === 'ended') return;
  room.phase = 'ended';
  if (room._endTimer) clearTimeout(room._endTimer);

  /* Notifica o vencedor com razão especial */
  send(vencedor.ws, {
    type: 'match_end',
    reason: 'oponente_saiu',
    scoreBlue: room.scoreBlue,
    scoreRed:  room.scoreRed,
    vencedor:  vencedor.id
  });

  for (const p of room.players) {
    p.room = null; p.modoAtual = null;
    notificarAmigosOnline(p, 'online');
  }
  setTimeout(() => rooms.delete(room.id), 5000);
  log(`[${room.mode}] Sala ${room.id} encerrada — oponente saiu. Vencedor: ${vencedor.nick}`);
}

/* ---------- Matchmaking automático por modo ---------- */
const QUEUE_SIZES = { tatico: { min: 2, max: 8 }, x1: { min: 2, max: 2 }, x2: { min: 4, max: 4 } };

/*
  Monta grupos de players para uma sala respeitando grupos existentes:
  - Players do mesmo grupoId entram juntos na mesma sala e no mesmo time
  - Players solo completam os slots restantes
  Retorna array de arrays: cada sub-array é um "bloco" (grupo ou solo)
*/
function montarBlocos(fila, maxSala) {
  /* Separa players por grupoId */
  const porGrupo = new Map(); /* grupoId -> [clients] */
  const solos    = [];
  for (const c of fila) {
    if (c.grupoId) {
      if (!porGrupo.has(c.grupoId)) porGrupo.set(c.grupoId, []);
      porGrupo.get(c.grupoId).push(c);
    } else {
      solos.push(c);
    }
  }

  /* Ordena grupos por tempo de entrada do primeiro membro (FIFO) */
  const blocos = [...porGrupo.values()].sort((a,b) => a[0].queuedAt - b[0].queuedAt);
  /* Solos também entram como blocos de 1 */
  solos.sort((a,b) => a.queuedAt - b.queuedAt).forEach(c => blocos.push([c]));

  /* Seleciona blocos até encher a sala */
  const selecionados = [];
  let total = 0;
  for (const bloco of blocos) {
    if (total + bloco.length > maxSala) continue; /* bloco não cabe — pula */
    selecionados.push(...bloco);
    total += bloco.length;
    if (total >= maxSala) break;
  }
  return selecionados;
}

/*
  Cria a sala garantindo que players do mesmo grupo fiquem no mesmo time.
  Aloca times: grupos inteiros → um time. Solos → completam o time menor.
*/
function createRoomComGrupos(players, mode) {
  const room = {
    id: uid(), mode, players: [],
    phase: 'countdown',
    countdownEnd: Date.now() + LOBBY_COUNTDOWN * 1000,
    matchEnd: 0, scoreBlue: 0, scoreRed: 0, chat: []
  };

  const maxAliados = mode === 'x1' ? 1 : mode === 'x2' ? 2 : Math.ceil(players.length / 2);

  /* Separa por grupo para alocar times coesos */
  const porGrupo = new Map();
  const solos    = [];
  for (const c of players) {
    if (c.grupoId) {
      if (!porGrupo.has(c.grupoId)) porGrupo.set(c.grupoId, []);
      porGrupo.get(c.grupoId).push(c);
    } else {
      solos.push(c);
    }
  }

  const aliados  = [];
  const inimigos = [];

  const alocar = (player) => {
    if (aliados.length < maxAliados)  aliados.push(player);
    else                               inimigos.push(player);
  };

  /* Grupos inteiros vão para o time que ainda tem espaço */
  for (const grupo of porGrupo.values()) {
    /* Se o grupo cabe todo no time aliado, põe lá */
    if (aliados.length + grupo.length <= maxAliados) {
      grupo.forEach(p => aliados.push(p));
    } else if (inimigos.length + grupo.length <= (players.length - maxAliados)) {
      grupo.forEach(p => inimigos.push(p));
    } else {
      /* Não cabe inteiro em nenhum time — distribui normalmente */
      grupo.forEach(p => alocar(p));
    }
  }
  /* Solos completam os times */
  solos.forEach(p => alocar(p));

  /* Monta os jogadores na sala com os times definidos */
  [...aliados, ...inimigos].forEach((p, idx) => {
    p.team = aliados.includes(p) ? 'aliado' : 'inimigo';
    const base = p.team === 'aliado'
      ? { x: -46, z: (aliados.indexOf(p) - 0.5) * 4 }
      : { x:  46, z: (inimigos.indexOf(p) - 0.5) * 4 };
    p.pos  = { x: base.x, y: 1.72, z: base.z };
    p.yaw  = p.team === 'aliado' ? Math.PI / 2 : -Math.PI / 2;
    p.hp   = 100; p.alive = true; p.kills = 0;
    p.room = room; p.modoAtual = mode;
    room.players.push(p);
  });

  rooms.set(room.id, room);
  return room;
}

setInterval(() => {
  const now = Date.now();
  for (const modo in queues) {
    const q = queues[modo];
    if (q.length === 0) continue;
    const cfg = QUEUE_SIZES[modo];

    /* Sala cheia ou mínimo atingido */
    const prontoParaIniciar =
      q.length >= cfg.max ||
      (modo === 'tatico' && q.length >= cfg.min) ||
      (modo === 'x1'     && q.length >= cfg.min) ||
      (modo === 'x2'     && q.length >= cfg.min);

    if (prontoParaIniciar) {
      /* Monta seleção respeitando grupos */
      const selecionados = montarBlocos(q, cfg.max);
      if (selecionados.length < cfg.min) {
        /* Grupos grandes demais para caber juntos — aguarda */
        continue;
      }
      /* Remove selecionados da fila */
      selecionados.forEach(c => {
        const i = q.findIndex(x => x.id === c.id);
        if (i >= 0) q.splice(i, 1);
        c.queuedAt = null;
      });
      broadcastQueue(modo);
      const room = createRoomComGrupos(selecionados, modo);
      startRoomCountdown(room);
      log(`[${modo}] Sala criada: ${room.id} (${selecionados.length} players, com grupos)`);
      continue;
    }

    /* Timeout solo — apenas tatico vai com bots */
    if (modo === 'tatico') {
      const c = q[0];
      if (c && now - c.queuedAt >= QUEUE_TIMEOUT_MS) {
        q.splice(0, 1); broadcastQueue(modo);
        const room = createRoomComGrupos([c], modo);
        startRoomCountdown(room);
        log(`[tatico] Sala solo (bots): ${room.id}`);
      }
    }
    /* X1/X2: aguarda o mínimo indefinidamente */
  }
}, 500);

/* =====================================================================
   HTTP — API em /api, health em /
   ===================================================================== */
const server = http.createServer(async (req, res) => {
  const url = req.url || '/';

  /* API REST (registrar, login, logout, perfil, salvar_perfil, ranque) */
  if (url.startsWith('/api')) {
    return api.handle(req, res);
  }

  /* Health-check / landing */
  if (url === '/' || url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    return res.end(JSON.stringify({
      ok: true,
      jogo: 'RAJADA',
      players: clients.size,
      queue: queue.length,
      rooms: rooms.size,
      uptime: Math.floor(process.uptime())
    }));
  }

  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Not found');
});

/* =====================================================================
   WebSocket — jogo em tempo real
   ===================================================================== */
const wss = new WebSocket.Server({ server });

wss.on('connection', (ws) => {
  const client = {
    id: uid(), ws, nick: 'Anon', team: null, room: null,
    pos: { x: 0, y: 1.72, z: 0 }, yaw: 0, hp: 100, alive: true, kills: 0,
    lastSeen: Date.now(), modoAtual: null, modoFila: null,
    amigosIds: [], grupoId: null
  };
  clients.set(client.id, client);
  send(ws, { type: 'hello', id: client.id });

  ws.on('message', (raw) => {
    let m;
    try { m = JSON.parse(raw.toString()); } catch (e) { return; }
    client.lastSeen = Date.now();

    switch (m.type) {
      case 'identify': {
        client.nick = String(m.nick || 'Anon').slice(0, 14) || 'Anon';
        /* Carrega lista de amigos do banco para notificações online */
        db.pool.query(`
          SELECT CASE WHEN solicitante=u.id THEN destinatario ELSE solicitante END AS amigoId
          FROM amizades, usuarios u
          WHERE u.nick=? AND (solicitante=u.id OR destinatario=u.id) AND status='aceita'
        `, [client.nick]).then(([rows]) => {
          client.amigosIds = rows.map(r => {
            /* resolve cliente online pelo id de banco → ws client id é diferente;
               vamos guardar nick dos amigos e resolver no momento */
            return r.amigoId;
          });
        }).catch(() => {});
        send(ws, { type: 'identified', id: client.id, nick: client.nick });
        /* Notifica amigos online que entrou */
        setTimeout(() => notificarAmigosOnlinePorNick(client, 'online'), 300);
        break;
      }

      case 'queue': {
        if (client.room) { send(ws, { type: 'error', msg: 'ja_em_sala' }); return; }
        const modo = ['tatico','x1','x2'].includes(m.modo) ? m.modo : 'tatico';
        pushQueue(client, modo);
        break;
      }

      case 'leave_queue': removeFromQueues(client); break;

      /* ---------- GRUPOS ---------- */
      case 'criar_grupo': {
        if (client.grupoId) {
          /* já está em grupo — sai do atual */
          sairDoGrupo(client);
        }
        const gid = uid().slice(0, 8).toUpperCase();
        const modo = ['tatico','x1','x2'].includes(m.modo) ? m.modo : 'tatico';
        grupos.set(gid, { id: gid, lider: client.id, membros: new Set([client.id]), modo });
        client.grupoId = gid;
        send(ws, { type: 'grupo_criado', grupoId: gid, modo });
        break;
      }

      case 'convidar_grupo': {
        /* Se o cliente não tem grupo, cria um automaticamente */
        if (!client.grupoId) {
          const gid = uid().slice(0, 8).toUpperCase();
          const modo = ['tatico','x1','x2'].includes(m.modo) ? m.modo : 'tatico';
          grupos.set(gid, { id: gid, lider: client.id, membros: new Set([client.id]), modo });
          client.grupoId = gid;
          send(client.ws, { type: 'grupo_criado', grupoId: gid, modo });
        }
        const grupo = grupos.get(client.grupoId);
        if (!grupo) { send(ws, { type: 'error', msg: 'sem_grupo' }); return; }
        const alvoNick = String(m.nick || '').slice(0, 14);
        const alvo = clientePorNick(alvoNick);
        if (!alvo) { send(ws, { type: 'error', msg: 'jogador_offline' }); return; }
        send(alvo.ws, { type: 'convite_grupo', grupoId: client.grupoId, de: client.nick, modo: grupo.modo });
        send(client.ws, { type: 'convite_enviado', nick: alvoNick });
        break;
      }

      case 'entrar_grupo': {
        const gid2 = String(m.grupoId || '');
        const grupo2 = grupos.get(gid2);
        if (!grupo2) { send(ws, { type: 'error', msg: 'grupo_nao_encontrado' }); return; }
        const maxG = grupo2.modo === 'x1' ? 2 : grupo2.modo === 'x2' ? 4 : 8;
        if (grupo2.membros.size >= maxG) { send(ws, { type: 'error', msg: 'grupo_cheio' }); return; }
        if (client.grupoId) sairDoGrupo(client);
        grupo2.membros.add(client.id);
        client.grupoId = gid2;
        /* Notifica todos os membros */
        for (const mid of grupo2.membros) {
          const mc = clientePorId(mid);
          if (mc) send(mc.ws, { type: 'grupo_atualizado', grupoId: gid2, membros: listarMembroGrupo(grupo2), modo: grupo2.modo });
        }
        break;
      }

      case 'sair_grupo': sairDoGrupo(client); break;

      case 'jogar_grupo': {
        if (!client.grupoId) { send(ws, { type: 'error', msg: 'sem_grupo' }); return; }
        const g3 = grupos.get(client.grupoId);
        if (!g3 || g3.lider !== client.id) { send(ws, { type: 'error', msg: 'nao_lider' }); return; }
        const modo3 = g3.modo;
        const cfg3  = QUEUE_SIZES[modo3] || { min: 2, max: 8 };
        const membros = [...g3.membros].map(mid => clientePorId(mid)).filter(c => c && !c.room);
        if (membros.length < 1) { send(ws, { type: 'error', msg: 'grupo_vazio' }); return; }

        /* Grupo tem o número exato para uma sala → cria direto sem passar pela fila */
        if (membros.length >= cfg3.min && membros.length <= cfg3.max && modo3 !== 'tatico') {
          const room = createRoomComGrupos(membros, modo3);
          startRoomCountdown(room);
          grupos.delete(client.grupoId);
          membros.forEach(c => { c.grupoId = null; });
          log(`[${modo3}] Sala de grupo direto: ${room.id} (${membros.length} players)`);
        } else {
          /* Coloca todos na fila — o matchmaking agrupa pelo grupoId */
          membros.forEach(c => pushQueue(c, modo3));
          send(client.ws, { type: 'queue_grupo', modo: modo3, total: membros.length });
        }
        break;
      }

      /* ---------- AMIGOS ---------- */
      case 'status_amigos': {
        /* Cliente pede status online dos amigos */
        const lista = [];
        for (const [, c] of clients) {
          lista.push({ nick: c.nick, status: c.room ? 'em_partida' : 'online', modo: c.modoAtual });
        }
        send(ws, { type: 'lista_online', players: lista });
        break;
      }

      /* ---------- JOGO ---------- */
      case 'state': {
        if (!client.room || client.room.phase !== 'playing') return;
        client.pos   = m.pos   || client.pos;
        client.yaw   = m.yaw   ?? client.yaw;
        client.hp    = m.hp    ?? client.hp;
        client.alive = m.alive ?? client.alive;
        client.kills = m.kills ?? client.kills;
        broadcast(client.room, {
          type: 'state', id: client.id,
          pos: client.pos, yaw: client.yaw, hp: client.hp,
          alive: client.alive, kills: client.kills,
          moving: !!m.moving, weapon: m.weapon || undefined
        }, client.id);
        break;
      }

      case 'shot': {
        if (!client.room) return;
        broadcast(client.room, { type: 'shot', id: client.id, from: m.from, to: m.to }, client.id);
        break;
      }

      case 'damage': {
        if (!client.room) return;
        if (!client.alive) return;
        const targetId = m.targetId;
        const damage   = Math.max(0, Math.min(200, m.damage | 0));
        const victim   = client.room.players.find(p => p.id === targetId);
        if (!victim) return;
        if (victim.team === client.team) return;
        victim.hp = Math.max(0, (victim.hp ?? 100) - damage);
        if (victim.hp <= 0 && victim.alive) {
          victim.alive = false;
          client.kills = (client.kills || 0) + 1;
          if (client.team === 'aliado') client.room.scoreBlue++;
          else                          client.room.scoreRed++;
          broadcast(client.room, {
            type: 'kill', killer: client.id, killerNick: client.nick,
            victim: victim.id, victimNick: victim.nick, headshot: !!m.headshot,
            scoreBlue: client.room.scoreBlue, scoreRed: client.room.scoreRed
          });
          if (client.room.scoreBlue >= KILL_TARGET || client.room.scoreRed >= KILL_TARGET) {
            endRoom(client.room, 'kills');
          }
        } else {
          broadcast(client.room, {
            type: 'hit', id: victim.id, damage, hp: victim.hp, by: client.id, byNick: client.nick
          }, client.id);
          send(client.ws, { type: 'hit_confirm', targetId: victim.id, hp: victim.hp });
        }
        break;
      }

      case 'score': {
        if (!client.room) return;
        const team  = m.team === 'aliado' ? 'blue' : 'red';
        const delta = Math.max(1, Math.min(5, m.delta | 0 || 1));
        if (team === 'blue') client.room.scoreBlue += delta;
        else                 client.room.scoreRed  += delta;
        broadcast(client.room, { type: 'score_update', scoreBlue: client.room.scoreBlue, scoreRed: client.room.scoreRed });
        if (client.room.scoreBlue >= KILL_TARGET || client.room.scoreRed >= KILL_TARGET) endRoom(client.room, 'kills');
        break;
      }

      case 'respawn': {
        if (!client.room) return;
        const p = client.room.players.find(x => x.id === client.id); if (!p) return;
        p.alive = true; p.hp = 100;
        p.pos = p.team === 'aliado'
          ? { x: -46, y: 1.72, z: (Math.random() - 0.5) * 12 }
          : { x:  46, y: 1.72, z: (Math.random() - 0.5) * 12 };
        broadcast(client.room, { type: 'respawn', id: client.id, pos: p.pos });
        break;
      }

      case 'chat': {
        if (!client.room) return;
        const txt = String(m.msg || '').slice(0, 180);
        if (!txt.trim()) return;
        broadcast(client.room, { type: 'chat', id: client.id, nick: client.nick, msg: txt, ts: Date.now() });
        break;
      }

      case 'leave_match': {
        removeFromQueues(client);
        if (client.room) {
          const r = client.room;
          broadcast(r, { type: 'player_left', id: client.id, nick: client.nick, temporary: false });
          r.players = r.players.filter(p => p.id !== client.id);
          client.room = null; client.modoAtual = null;
          notificarAmigosOnlinePorNick(client, 'online');
          /* X1/X2: se sobrou só 1, encerra com vencedor */
          verificarSobrouSo1(r);
          if (r.players.filter(p => p.ws).length === 0) endRoom(r, 'empty');
        }
        send(ws, { type: 'left_match_ok' });
        break;
      }

      case 'ping': send(ws, { type: 'pong', t: m.t }); break;
    }
  });

  ws.on('close', () => {
    log(`Cliente ${client.nick} (${client.id}) desconectou`);
    clients.delete(client.id);
    removeFromQueues(client);
    if (client.grupoId) sairDoGrupo(client);
    notificarAmigosOnlinePorNick(client, 'offline');
    if (client.room) {
      const r = client.room;
      broadcast(r, {
        type: 'player_left', id: client.id, nick: client.nick, temporary: true,
        lastPos: client.pos, lastTeam: client.team, lastYaw: client.yaw
      });
      r.players = r.players.filter(p => p.id !== client.id);
      client.room = null;
      /* Pequeno delay para desconexões temporárias (queda de rede breve) */
      setTimeout(() => {
        verificarSobrouSo1(r);
        if (r.players.filter(p => p.ws).length === 0) endRoom(r, 'empty');
      }, 8000); /* 8s de graça para reconectar antes de encerrar */
    }
  });

  ws.on('error', () => {});
});

/* ---------- Helpers de grupo ---------- */
function listarMembroGrupo(grupo) {
  return [...grupo.membros].map(mid => {
    const c = clientePorId(mid);
    return c ? { id: mid, nick: c.nick, lider: mid === grupo.lider } : null;
  }).filter(Boolean);
}

function sairDoGrupo(client) {
  if (!client.grupoId) return;
  const g = grupos.get(client.grupoId);
  if (!g) { client.grupoId = null; return; }
  g.membros.delete(client.id);
  client.grupoId = null;
  if (g.membros.size === 0) { grupos.delete(g.id); return; }
  /* Transfere liderança se saiu o líder */
  if (g.lider === client.id) g.lider = [...g.membros][0];
  for (const mid of g.membros) {
    const mc = clientePorId(mid);
    if (mc) send(mc.ws, { type: 'grupo_atualizado', grupoId: g.id, membros: listarMembroGrupo(g), modo: g.modo });
  }
  send(client.ws, { type: 'grupo_saiu' });
}

/* Notifica por nick (sem depender do id de banco) */
function notificarAmigosOnlinePorNick(client, status) {
  for (const [, c] of clients) {
    if (c.id === client.id) continue;
    /* amigos são gerenciados pelo banco; aqui fazemos broadcast simplificado para online visibility */
    send(c.ws, { type: 'player_status', nick: client.nick, status, modo: client.modoAtual });
  }
}

/* =====================================================================
   Boot — inicializa MySQL e sobe o servidor
   ===================================================================== */
(async () => {
  try {
    await db.initSchema();
    log('Schema MySQL OK');
  } catch (e) {
    log('ERRO ao inicializar MySQL:', e.message);
    log('Verifique DB_HOST, DB_PORT, DB_USER, DB_PASS, DB_NAME');
  }

  server.listen(PORT, HOST, () => {
    log(`RAJADA WebSocket server rodando em ws://${HOST}:${PORT}`);
    log(`RAJADA HTTP API disponivel em http://${HOST}:${PORT}/api`);
  });
})();

/* =====================================================================
   RESET AUTOMÁTICO DE TEMPORADA — roda a cada hora, verifica se expirou
   ===================================================================== */
const CFG_TEMP_RESET = {
  coins_remover_pct: 20,
  nivel_remover:     2,
  armas_remover: ['ak47','m4a1','scar','lmg','sniper','barrett'],
  preservar_sempre: ['faca','rifle'],
  recompensas_top: [
    { posicao:1,  coins:5000, xp:2000, chaves:3, titulo:'Campeão da Temporada' },
    { posicao:2,  coins:3000, xp:1500, chaves:2, titulo:'Vice-Campeão' },
    { posicao:3,  coins:2000, xp:1000, chaves:2, titulo:'3º Lugar' },
    { posicao:4,  coins:1200, xp: 700, chaves:1, titulo:'4º Lugar' },
    { posicao:5,  coins:1000, xp: 600, chaves:1, titulo:'5º Lugar' },
    { posicao:6,  coins: 800, xp: 500, chaves:1, titulo:'6º Lugar' },
    { posicao:7,  coins: 700, xp: 400, chaves:1, titulo:'7º Lugar' },
    { posicao:8,  coins: 600, xp: 300, chaves:1, titulo:'8º Lugar' },
    { posicao:9,  coins: 500, xp: 200, chaves:1, titulo:'9º Lugar' },
    { posicao:10, coins: 400, xp: 100, chaves:1, titulo:'10º Lugar' }
  ]
};

async function verificarResetTemporada() {
  try {
    const agora = Math.floor(Date.now() / 1000);

    /* Busca temporada ativa expirada */
    const [tRows] = await db.pool.query(
      'SELECT * FROM temporada WHERE encerrada=0 AND fim_em <= ? LIMIT 1', [agora]
    );
    if (!tRows.length) return; /* nenhuma temporada expirada */

    const temp = tRows[0];
    log(`[TEMPORADA] Encerrando temporada ${temp.numero}...`);

    /* Top 10 no momento do reset */
    const [top10] = await db.pool.query(`
      SELECT id, nick, coins, xp, nivel, armas_tem, chaves,
             (nivel*1000 + total_abates*25 + total_vitorias*80) AS pontos
      FROM usuarios ORDER BY pontos DESC LIMIT 10
    `);

    /* Grava recompensas para top 10 */
    const criado = agora;
    for (let i = 0; i < top10.length; i++) {
      const u = top10[i];
      const cfg = CFG_TEMP_RESET.recompensas_top[i];
      if (!cfg) continue;
      await db.pool.query(`
        INSERT INTO temporada_recompensas
          (usuario_id, temporada_num, posicao, coins, xp, chaves, titulo, coletada, criado_em)
        VALUES (?,?,?,?,?,?,?,0,?)
      `, [u.id, temp.numero, cfg.posicao, cfg.coins, cfg.xp, cfg.chaves, cfg.titulo, criado]);
    }

    /* Aplica penalidades em TODOS os jogadores */
    const [todos] = await db.pool.query('SELECT id, coins, nivel, armas_tem FROM usuarios');
    for (const u of todos) {
      const novoCoins = Math.max(0, Math.floor(u.coins * (1 - CFG_TEMP_RESET.coins_remover_pct / 100)));
      const novoNivel = Math.max(1, u.nivel - CFG_TEMP_RESET.nivel_remover);

      let armasTem = [];
      try { armasTem = JSON.parse(u.armas_tem || '["rifle"]'); } catch(e) { armasTem = ['rifle']; }
      armasTem = armasTem.filter(a =>
        CFG_TEMP_RESET.preservar_sempre.includes(a) ||
        !CFG_TEMP_RESET.armas_remover.includes(a)
      );
      if (!armasTem.includes('rifle')) armasTem.push('rifle');

      await db.pool.query(
        'UPDATE usuarios SET coins=?, nivel=?, armas_tem=? WHERE id=?',
        [novoCoins, novoNivel, JSON.stringify(armasTem), u.id]
      );
    }

    /* Encerra temporada atual */
    await db.pool.query('UPDATE temporada SET encerrada=1 WHERE id=?', [temp.id]);

    /* Cria nova temporada (mais 30 dias) */
    const novoInicio = agora;
    const novoFim    = agora + 30 * 86400;
    await db.pool.query(
      'INSERT INTO temporada (numero, inicio_em, fim_em, encerrada) VALUES (?,?,?,0)',
      [temp.numero + 1, novoInicio, novoFim]
    );

    log(`[TEMPORADA] Temporada ${temp.numero} encerrada. Nova temporada ${temp.numero+1} iniciada.`);

    /* Notifica todos os clientes online */
    for (const [, c] of clients) {
      send(c.ws, {
        type: 'temporada_reset',
        novaTemporada: temp.numero + 1,
        msg: `Temporada ${temp.numero} encerrada! Nova temporada iniciada.`
      });
    }
  } catch (e) {
    log('[TEMPORADA] Erro no reset:', e.message);
  }
}

/* Verifica a cada hora */
setInterval(verificarResetTemporada, 60 * 60 * 1000);
/* Também verifica ao iniciar o servidor */
setTimeout(verificarResetTemporada, 5000);
setInterval(() => {
  const now = Date.now();
  for (const [, c] of clients) {
    if (now - c.lastSeen > 60000) { try { c.ws.terminate(); } catch (e) {} }
  }
}, 20000);

/* =====================================================================
   CONSOLE DE ADMIN — lê comandos digitados no painel Pterodactyl
   ---------------------------------------------------------------------
   Comandos disponíveis:
     coins give <nick> <quantidade>     → adiciona coins ao jogador
     coins remove <nick> <quantidade>   → remove coins do jogador
     coins set <nick> <quantidade>      → define exatamente N coins
     coins get <nick>                   → mostra coins atuais
     xp give <nick> <quantidade>        → adiciona XP
     xp set <nick> <quantidade>         → define XP
     ban <nick>                         → deleta conta do jogador
     players                            → lista jogadores online
     help                               → mostra esta lista
   ===================================================================== */
/* Envia admin_update via WebSocket para o jogador se ele estiver online */
function notificarJogador(nick, dados, mensagem) {
  for (const [, c] of clients) {
    if (c.nick.toLowerCase() === nick.toLowerCase()) {
      send(c.ws, { type: 'admin_update', ...dados, msg: mensagem });
      return true;
    }
  }
  return false; /* jogador offline — banco já foi atualizado, verá na próxima sessão */
}

const readline = require('readline');

const rl = readline.createInterface({ input: process.stdin, terminal: false });

rl.on('line', async (linha) => {
  const partes = linha.trim().split(/\s+/);
  const cmd    = (partes[0] || '').toLowerCase();
  const sub    = (partes[1] || '').toLowerCase();
  const nick   = partes[2] || '';
  const valor  = parseInt(partes[3], 10);

  /* ---- help ---- */
  if (cmd === 'help' || cmd === '?') {
    log('=== COMANDOS ADMIN ===');
    log('coins give <nick> <qtd>    — adiciona coins');
    log('coins remove <nick> <qtd>  — remove coins');
    log('coins set <nick> <qtd>     — define coins exatos');
    log('coins get <nick>           — consulta coins');
    log('xp give <nick> <qtd>       — adiciona XP');
    log('xp set <nick> <qtd>        — define XP exato');
    log('ban <nick>                 — deleta a conta');
    log('players                    — jogadores online agora');
    log('======================');
    return;
  }

  /* ---- players ---- */
  if (cmd === 'players') {
    if (clients.size === 0) { log('[ADMIN] Nenhum jogador online.'); return; }
    log(`[ADMIN] ${clients.size} jogador(es) online:`);
    for (const [, c] of clients) {
      log(`  • ${c.nick} | sala: ${c.room ? c.room.id : 'fila/lobby'}`);
    }
    return;
  }

  /* ---- ban ---- */
  if (cmd === 'ban') {
    if (!partes[1]) { log('[ADMIN] Uso: ban <nick>'); return; }
    const nickBan = partes[1];
    try {
      const [r] = await db.pool.query('DELETE FROM usuarios WHERE nick = ?', [nickBan]);
      if (r.affectedRows === 0) { log(`[ADMIN] Jogador "${nickBan}" não encontrado.`); return; }
      /* Desconecta se estiver online */
      for (const [, c] of clients) {
        if (c.nick.toLowerCase() === nickBan.toLowerCase()) {
          try { c.ws.terminate(); } catch(e) {}
        }
      }
      log(`[ADMIN] Conta "${nickBan}" deletada com sucesso.`);
    } catch (e) { log('[ADMIN] Erro ao banir:', e.message); }
    return;
  }

  /* ---- coins ---- */
  if (cmd === 'coins') {
    if (!nick) { log('[ADMIN] Uso: coins <give|remove|set|get> <nick> [quantidade]'); return; }

    if (sub === 'get') {
      try {
        const [rows] = await db.pool.query('SELECT nick, coins FROM usuarios WHERE nick = ?', [nick]);
        if (!rows[0]) { log(`[ADMIN] Jogador "${nick}" não encontrado.`); return; }
        log(`[ADMIN] ${rows[0].nick} → ${rows[0].coins} coins`);
      } catch (e) { log('[ADMIN] Erro:', e.message); }
      return;
    }

    if (isNaN(valor) || valor < 0) { log('[ADMIN] Quantidade inválida.'); return; }

    let sql, params, msg;
    if (sub === 'give') {
      sql = 'UPDATE usuarios SET coins = LEAST(coins + ?, 9999999) WHERE nick = ?';
      params = [valor, nick];
      msg = `+${valor} coins para "${nick}"`;
    } else if (sub === 'remove') {
      sql = 'UPDATE usuarios SET coins = GREATEST(coins - ?, 0) WHERE nick = ?';
      params = [valor, nick];
      msg = `-${valor} coins de "${nick}"`;
    } else if (sub === 'set') {
      sql = 'UPDATE usuarios SET coins = ? WHERE nick = ?';
      params = [Math.min(valor, 9999999), nick];
      msg = `Coins de "${nick}" definido para ${valor}`;
    } else {
      log('[ADMIN] Subcomando inválido. Use: give, remove, set ou get');
      return;
    }

    try {
      const [r] = await db.pool.query(sql, params);
      if (r.affectedRows === 0) { log(`[ADMIN] Jogador "${nick}" não encontrado.`); return; }
      log(`[ADMIN] ✓ ${msg}`);
      /* Mostra o saldo atual após a operação */
      const [rows] = await db.pool.query('SELECT coins FROM usuarios WHERE nick = ?', [nick]);
      if (rows[0]) {
        log(`[ADMIN] Saldo atual de "${nick}": ${rows[0].coins} coins`);
        /* Atualiza o cliente em tempo real se estiver online */
        const online = notificarJogador(nick, { coins: rows[0].coins }, `⚡ Admin: ${msg}`);
        log(`[ADMIN] Jogador ${online ? 'online — atualizado na hora' : 'offline — verá na próxima sessão'}`);
      }
    } catch (e) { log('[ADMIN] Erro:', e.message); }
    return;
  }

  /* ---- xp ---- */
  if (cmd === 'xp') {
    if (!nick || isNaN(valor) || valor < 0) {
      log('[ADMIN] Uso: xp <give|set> <nick> <quantidade>'); return;
    }
    let sql, msg;
    if (sub === 'give') {
      sql = `UPDATE usuarios SET xp = LEAST(xp + ${valor}, 9999999) WHERE nick = ?`;
      msg = `+${valor} XP para "${nick}"`;
    } else if (sub === 'set') {
      sql = `UPDATE usuarios SET xp = ${Math.min(valor, 9999999)} WHERE nick = ?`;
      msg = `XP de "${nick}" definido para ${valor}`;
    } else {
      log('[ADMIN] Subcomando inválido. Use: give ou set'); return;
    }
    try {
      const [r] = await db.pool.query(sql, [nick]);
      if (r.affectedRows === 0) { log(`[ADMIN] Jogador "${nick}" não encontrado.`); return; }
      log(`[ADMIN] ✓ ${msg}`);
      const [rows] = await db.pool.query('SELECT xp, nivel FROM usuarios WHERE nick = ?', [nick]);
      if (rows[0]) {
        const online = notificarJogador(nick, { xp: rows[0].xp, nivel: rows[0].nivel }, `⚡ Admin: ${msg}`);
        log(`[ADMIN] Jogador ${online ? 'online — atualizado na hora' : 'offline — verá na próxima sessão'}`);
      }
    } catch (e) { log('[ADMIN] Erro:', e.message); }
    return;
  }

  if (cmd) log(`[ADMIN] Comando desconhecido: "${cmd}". Digite "help" para ver os comandos.`);
});