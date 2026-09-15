/* ==========================================================
   RAJADA  -  versao 20
   Correcoes:
     - Carabina: cano para frente
     - Times: spawn/atribuicao ANTES de spawn e bots
     - Vitoria/Derrota considerando o time do jogador
     - Dano entre times diferentes funciona
     - Fogo amigo bloqueado
     - Deteccao de time pela COR
     - Mira dinamica (abre ao atirar / ao mirar inimigo)
     - Saida da partida ao cair rede / fechar pagina / inativo
     - Botao engrenagem funcional no celular
     - Wake Lock: mantem a tela ligada no celular
     - Placar (Tab) no celular: fecha com X e toque no fundo
     - Texturas dos botoes carregadas por JS (qualquer tamanho)
     - Botao Chat mobile + botao Placar mobile
     - Login bloqueado se houver sessao ativa em outro dispositivo
   ========================================================== */
const VERSAO_JOGO = 26;

/* ==========================================================
   ENDERECOS DO SERVIDOR
   ----------------------------------------------------------
   TROQUE AQUI pelo endereco do seu site. Dentro do APK nao
   existe "pasta do site", entao o caminho precisa ser completo.
   No navegador, o jogo continua usando o caminho relativo.
   ========================================================== */
const SERVIDOR = {
  /* onde esta o backend.php hospedado */
  site : 'http://mc.elylphosting.com.br:25565/api',
  /* servidor de partidas (server.js) */
  ws   : 'ws://mc.elylphosting.com.br:25565'
};

/* o app roda em capacitor:// ou file://; o site roda em http(s):// */
const DENTRO_DO_APP = !/^https?:$/.test(location.protocol);

const NET_URL = SERVIDOR.ws;

console.log('%c RAJADA v'+VERSAO_JOGO+' (MP) carregado ',
  'background:#f0a020;color:#0d0f11;font-weight:bold;padding:3px 8px;border-radius:4px');

const CFG = {
  partida:{ duracao:180, metaAbates:20, respawn:3, botsAliados:3, botsInimigos:4 },
  jogador:{ vida:100, colete:100, altura:1.72, alturaAgachado:1.05,
    velocidade:5.4, velCorrida:8.6, velMira:2.6, velAgachado:0.55,
    pulo:6.4, gravidade:20, kits:3, granadas:2, curaKit:45 },
  granada:{ dano:110, raio:7, fusivel:1.8, forca:17 },
  bot:{ vida:100, velPatrulha:2.6, velAvanco:4.2, velFlanco:3.6,
    dano:9, alcance:46, cadencia:0.34, precisaoBase:0.62,
    tempoReacao:0.28, memoria:3.0, pente:30, recarga:2.1,
    campoVisao:0.62, respawn:3, distBarra:16 },
  xp:{ porAbate:12, vitoria:220, empate:90,
    perdaDerrotaXp:45, perdaDerrotaCoins:18,
    coinsPorAbate:4, coinsVitoria:130, coinsEmpate:55 },
  mapa:{ largura:104, fundo:78 },
  audio:{ volSomPadrao:70, volMusicaPadrao:35 },
  killcam:{ distancia:4.6, altura:2.6, suavidade:6.0 }
};

/* ==========================================================
   WAKE LOCK - impede o celular de apagar a tela
   ========================================================== */
let _wakeLock = null;
async function ligarTela(){
  try{
    if (_wakeLock) return;
    if ('wakeLock' in navigator){
      _wakeLock = await navigator.wakeLock.request('screen');
      _wakeLock.addEventListener('release', ()=>{ _wakeLock = null; });
    }
  }catch(e){ /* silencioso */ }
}
function reforcarWakeLock(){ ligarTela(); }
document.addEventListener('visibilitychange', ()=>{ if (!document.hidden) reforcarWakeLock(); });
window.addEventListener('pointerdown', reforcarWakeLock);
window.addEventListener('touchstart',  reforcarWakeLock, { passive:true });
window.addEventListener('keydown',     reforcarWakeLock);
setInterval(reforcarWakeLock, 20000);

/* =========== NET =========== */
const NET = {
  ws: null, conectado: false, meuId: null, nick: 'Anon',
  emFila: false, sala: null, team: null,
  remotos: new Map(), ultimoEnvio: 0, taxaEnvio: 1/20, tentativas: 0,
  _mmTimer: null, _hb: null,

  conectar(nick){
    if (this.ws && this.ws.readyState <= 1) return;
    this.nick = nick || 'Anon';
    try { this.ws = new WebSocket(NET_URL); }
    catch(e){ console.warn('[NET] falha ao abrir ws', e); return; }
    this.ws.onopen = () => {
      this.conectado = true; this.tentativas = 0;
      this.enviar({ type:'identify', nick: this.nick });
      clearInterval(this._hb);
      this._hb = setInterval(()=>{ this.enviar({ type:'ping', t: Date.now() }); }, 12000);
      console.log('%c[NET] conectado a '+NET_URL, 'color:#5ec97a');
    };
    this.ws.onmessage = (ev) => {
      let m; try { m = JSON.parse(ev.data); } catch(e){ return; }
      this._receber(m);
    };
    this.ws.onclose = () => {
      this.conectado = false; this.emFila = false;
      const estavaEmPartida = (typeof S !== 'undefined' && S.ativa && this.sala);
      this.tentativas++;
      if (estavaEmPartida){
        console.warn('[NET] desconectado durante partida - voltando ao lobby');
        try{ if(typeof S !== 'undefined'){ S.ativa = false; S.fim = true; } }catch(e){}
        setTimeout(() => { location.reload(); }, 600);
        return;
      }
      console.warn('[NET] desconectado, retry em', this.tentativas*2, 's');
      if (this.tentativas < 8) setTimeout(() => this.conectar(this.nick), this.tentativas*2000);
    };
    this.ws.onerror = () => {};
  },

  enviar(obj){
    if (this.ws && this.ws.readyState === 1){
      try { this.ws.send(JSON.stringify(obj)); } catch(e){}
    }
  },

  entrarFila(modo){
    this.emFila = true;
    const m = modo || 'tatico';
    if (!this.conectado){
      this.conectar(P.nick);
      const wait = setInterval(() => {
        if (this.conectado){ clearInterval(wait); this.enviar({ type:'queue', modo: m }); }
      }, 120);
      setTimeout(()=> clearInterval(wait), 6000);
    } else {
      this.enviar({ type:'queue', modo: m });
    }
  },
  sairFila(){ this.emFila = false; this.enviar({ type:'leave_queue' }); },
  sairPartida(){ this.enviar({ type:'leave_match' }); this.sala = null; },

  _receber(m){
    switch(m.type){
      case 'hello': this.meuId = m.id; break;
      case 'queue_status': {
        const e = el('mmStatus');
        if (e) e.textContent = m.total > 1 ? `${m.total} jogadores na fila` : 'Procurando jogadores...';
        break;
      }
      case 'match_found': {
        this.sala = m.roomId; this.team = m.team; this.meuId = m.yourId;
        esconderMatchmaking();
        mostrarMatchEncontrado(m);
        setTimeout(() => {
          esconderMatchEncontrado();
          carregarEIniciarMultiplayer(m);
        }, (m.countdown||3)*1000);
        break;
      }
      case 'lobby_tick': {
        const e = el('mmCountdown'); if (e) e.textContent = Math.max(0, m.left);
        break;
      }
      case 'match_start': { iniciarCountdownInGame(m); break; }
      case 'state': {
        const r = this.remotos.get(m.id);
        if (r){
          r.pos = m.pos; r.yaw = m.yaw; r.hp = m.hp;
          r.alive = m.alive; r.kills = m.kills;
          r.ultimoUpdate = performance.now();
          r.moving = m.moving;
          if (m.weapon && r.weapon !== m.weapon){
            r.weapon = m.weapon;
            trocarArmaRemoto(r, m.weapon);
          }
        }
        break;
      }
      case 'shot': {
        if (cena && m.to && m.from){
          const de = new THREE.Vector3(m.from.x, m.from.y, m.from.z);
          const para = new THREE.Vector3(m.to.x, m.to.y, m.to.z);
          /* Tracer do tiro remoto */
          VFX.tracer(de, para, 0xffdd99);
          /* Flash de impacto no ponto final */
          VFX.impactoParede(para, new THREE.Vector3(0, 0, 1), 0xc8c0b0);
        } else if (cena && m.to){
          const to = new THREE.Vector3(m.to.x, m.to.y, m.to.z);
          VFX.impactoParede(to, new THREE.Vector3(0,0,1), 0xc8c0b0);
        }
        break;
      }
      case 'hit_confirm': marcarHit(false); vibrar(18); break;

      case 'hit': {
        if (m.id === this.meuId && J.vivo){
          const novoHp = Math.max(0, m.hp | 0);
          if (novoHp < J.vida){
            const dano = J.vida - novoHp;
            if (J.colete > 0){
              const abs = Math.min(J.colete, dano * 0.58);
              J.colete = Math.max(0, J.colete - abs);
            }
            J.vida = novoHp;
            pintarVida();
            flashDano();
            animarDanoPlayer();
            AUDIO.play('dano');
            if (J.vida <= 0 && J.vivo){
              const atirador = this.remotos.get(m.by);
              const nomeAtirador = atirador ? atirador.nick : (m.byNick || '???');
              morrerJogador(nomeAtirador);
            }
          }
        }
        break;
      }

      case 'kill': {
        feedKill(m.killerNick, m.victimNick, m.killer === this.meuId, m.headshot);
        if (typeof S !== 'undefined'){
          S.scA = m.scoreBlue; S.scV = m.scoreRed;
          pintarPlacar();
        }
        if (m.victim === this.meuId && J.vivo) morrerJogador(m.killerNick);
        const rv = this.remotos.get(m.victim);
        if (rv){ rv.alive = false; rv.bot.vivo = false; rv.bot.grupo.visible = false; }
        break;
      }
      case 'score_update': {
        if (typeof S !== 'undefined'){
          S.scA = m.scoreBlue;
          S.scV = m.scoreRed;
          pintarPlacar();
          checarFim();
        }
        break;
      }
      case 'respawn': {
        const r = this.remotos.get(m.id);
        if (r){ r.pos = m.pos; r.alive = true; r.hp = 100;
          r.bot.vivo = true; r.bot.grupo.visible = true;
          r.bot.grupo.position.set(m.pos.x, 0, m.pos.z);
        }
        break;
      }
      case 'player_left': {
        const r = this.remotos.get(m.id);
        if (r){
          const teamSaiu = r.team;
          if (r.bot){
            if (J.spectando === r.bot) J.spectando = null;
            const i = S.bots.indexOf(r.bot);
            if (i >= 0) S.bots.splice(i, 1);
            if (r.bot.grupo && cena) cena.remove(r.bot.grupo);
          }
          this.remotos.delete(m.id);

          /* Modo tático: substitui o player que saiu por um NPC */
          if (S.ativa && S.modo && S.modo.id === 'tatico' && !S.fim){
            const nBotsDoTime = S.bots.filter(b => !b.remoto && b.time === teamSaiu).length;
            const SLOTS_TIME  = 4;
            const nPlayersDoTime = [...this.remotos.values()].filter(rv => rv.team === teamSaiu).length
                                 + (teamSaiu === NET.team ? 1 : 0);
            const botsNecessarios = Math.max(0, SLOTS_TIME - nPlayersDoTime);
            if (nBotsDoTime < botsNecessarios){
              /* Cria NPC de reposição assíncronamente */
              const idxNpc = nBotsDoTime;
              const nomesPool = teamSaiu === 'aliado' ? NOMES_BOT.aliado : NOMES_BOT.inimigo;
              const nomeNpc = nomesPool[Math.min(idxNpc, nomesPool.length - 1)] + '_sub';
              criarBot(teamSaiu, nomeNpc, idxNpc).then(bot => {
                if (S.ativa && !S.fim) S.bots.push(bot);
                montarPainelEquipe();
              });
            }
          }
        }
        if (S.ativa) atualizarPainelEquipe();
        break;
      }
      case 'chat': addChat(m.nick, m.msg, m.id === this.meuId); break;
      case 'admin_update': {
        if (m.coins  !== undefined){ P.coins  = m.coins;  }
        if (m.xp     !== undefined){ P.xp     = m.xp;     }
        if (m.nivel  !== undefined){ P.nivel  = m.nivel;  }
        try{ localStorage.setItem('rajada_perfil', JSON.stringify(P)); }catch(e){}
        pintarLobby();
        if (m.msg) aviso(m.msg);
        break;
      }
      /* Convite para grupo */
      case 'convite_grupo': {
        AMIGOS.receberConviteGrupo(m);
        break;
      }
      /* Grupo foi atualizado (entrou/saiu membro) */
      case 'grupo_atualizado': {
        const souLiderAtual = m.membros && m.membros.some(mb => mb.lider && mb.nick === P.nick);
        AMIGOS.grupoAtual = { id: m.grupoId, membros: m.membros, modo: m.modo, lider: souLiderAtual };
        AMIGOS.renderGrupo();
        break;
      }
      case 'grupo_criado': {
        AMIGOS.grupoAtual = { id: m.grupoId, membros: [{ nick: P.nick, lider: true }], modo: m.modo, lider: true };
        AMIGOS.renderGrupo();
        break;
      }
      case 'grupo_saiu': {
        AMIGOS.grupoAtual = null;
        AMIGOS.renderGrupo();
        break;
      }
      case 'convite_enviado': {
        /* Confirmação do servidor que o convite chegou */
        aviso('✓ Convite enviado para ' + m.nick);
        break;
      }
      case 'error': {
        const msgs = {
          jogador_offline: 'Jogador não está online',
          sem_grupo: 'Erro ao criar grupo',
          nao_lider: 'Apenas o líder pode convidar',
          grupo_cheio: 'Grupo cheio',
          ja_em_sala: 'Você já está em uma sala'
        };
        if(m.msg && msgs[m.msg]) aviso(msgs[m.msg]);
        break;
      }
      /* Status de players online */
      case 'player_status': {
        AMIGOS.atualizarStatusOnline(m.nick, m.status, m.modo);
        break;
      }
      case 'lista_online': {
        AMIGOS.setListaOnline(m.players);
        break;
      }
      case 'match_end': {
        if (typeof S !== 'undefined' && S.ativa && !S.fim){
          S.scA = m.scoreBlue; S.scV = m.scoreRed;
          /* Razão especial: oponente abandonou em X1/X2 */
          if(m.reason === 'oponente_saiu'){
            aviso('Oponente saiu — você venceu!');
            /* Força placar vencedor para quem ficou */
            const meuTime = timeDoJogador();
            if(meuTime === 'aliado') S.scA = Math.max(S.scA, S.scV + 1);
            else                     S.scV = Math.max(S.scV, S.scA + 1);
          }
          terminarPartida();
        }
        break;
      }
    }
  }
};

/* =========== CATALOGO =========== */
const MODOS = [
  { id:'tatico', tag:'4 vs 4', nome:'TATICO', selo:'TATICO', cena:'squad',
    desc:'Trabalhe em equipe, mate todos. Estrategia e tudo.',
    img:'imagens/modo-tatico.jpg', icone:'alvo', vagas:'4 vs 4', tipo:'PVP',
    aliados:3, inimigos:4, semBots:false },
  { id:'x1', tag:'1 vs 1', nome:'DUELO X1', selo:'X1', cena:'duelo',
    desc:'Um contra um. Sem bots, sem desculpas. Prove que e o melhor.',
    img:'imagens/x1.jpg', icone:'mira', vagas:'1 vs 1', tipo:'PVP',
    aliados:0, inimigos:1, semBots:true },
  { id:'x2', tag:'2 vs 2', nome:'DUELO X2', selo:'X2', cena:'duelo',
    desc:'Dois contra dois. Coordenacao e a chave da vitoria.',
    img:'imagens/x2.jpg', icone:'mira', vagas:'2 vs 2', tipo:'PVP',
    aliados:1, inimigos:2, semBots:true }
];
const SLOTS_VAZIOS = 1;
const ICO = {
  mira:'<svg viewBox="0 0 24 24"><path d="M12 8a4 4 0 100 8 4 4 0 000-8zm8.9 3A9 9 0 0013 3.1V1h-2v2.1A9 9 0 003.1 11H1v2h2.1A9 9 0 0011 20.9V23h2v-2.1a9 9 0 007.9-7.9H23v-2h-2.1zM12 19a7 7 0 110-14 7 7 0 010 14z"/></svg>',
  alvo:'<svg viewBox="0 0 24 24"><path d="M12 2L4 7v5c0 5 3.4 9.4 8 10.5 4.6-1.1 8-5.5 8-10.5V7l-8-5zm0 4.5l2 3.5h-4l2-3.5zM8.5 12h7l-3.5 6-3.5-6z"/></svg>',
  faca:'<svg viewBox="0 0 24 24"><path d="M21 3l-9 9 3 3 9-9V3h-3zM3.5 14.5l6 6L11 19l-6-6-1.5 1.5z"/></svg>'
};
const SKINS = [
  { id:'padrao', nome:'Soldado', cor:0x2266dd, preco:0, info:'Inicial' },
  { id:'cmd', nome:'Comandante', cor:0x3355aa, preco:400, info:'Tático' },
  { id:'elite', nome:'Elite', cor:0xcc3322, preco:850, info:'Raro' },
  { id:'sombra', nome:'Sombra', cor:0x1a1d24, preco:1400, info:'Épico' },
  { id:'selva', nome:'Selva', cor:0x3f5a2a, preco:700, info:'Camuflado' },
  { id:'artico', nome:'Ártico', cor:0xa8c4d8, preco:1100, info:'Raro' }
];
const ARMAS = [
  { id:'faca', nome:'FACA TÁTICA', preco:0, info:'Secundária · corpo a corpo',
    dano:55, cadencia:0.4, pente:1, reserva:1, recarga:0,
    alcance:3, espalha:0, espalhaMira:0, coice:0, zoom:0, melee:true },
  { id:'rifle', nome:'RIFLE', preco:0, info:'Equilibrada',
    dano:26, cadencia:0.108, pente:30, reserva:150, recarga:1.9,
    alcance:95, espalha:0.013, espalhaMira:0.002, coice:0.017, zoom:0.62 },
  { id:'smg', nome:'SMG', preco:600, info:'Rápida',
    dano:17, cadencia:0.068, pente:35, reserva:175, recarga:1.6,
    alcance:55, espalha:0.026, espalhaMira:0.008, coice:0.013, zoom:0.75 },
  { id:'ar', nome:'CARABINA', preco:950, info:'Precisa',
    dano:34, cadencia:0.155, pente:25, reserva:125, recarga:2.1,
    alcance:110, espalha:0.009, espalhaMira:0.001, coice:0.024, zoom:0.55 },
  { id:'doze', nome:'ESCOPETA', preco:1200, info:'Letal de perto',
    dano:18, cadencia:0.7, pente:8, reserva:32, recarga:3.0,
    alcance:30, espalha:0.08, espalhaMira:0.05, coice:0.06, zoom:0.8, pellets:8 },
  { id:'sniper', nome:'SNIPER', preco:1600, info:'Letal de longe',
    dano:96, cadencia:1.15, pente:5, reserva:35, recarga:2.8,
    alcance:190, espalha:0.03, espalhaMira:0.0003, coice:0.07, zoom:0.3 },
  { id:'lmg', nome:'METRALHADORA', preco:2200, info:'Supressão',
    dano:22, cadencia:0.09, pente:100, reserva:200, recarga:4.5,
    alcance:100, espalha:0.03, espalhaMira:0.01, coice:0.02, zoom:0.7 },

  /* ==========================================================
     COMO ADICIONAR UMA NOVA ARMA:
     1. Copie um bloco abaixo e ajuste os valores.
     2. Escolha um id unico (sem espacos, minusculo).
     3. Adicione o mesmo id em MODELO_ARMA (caminho .glb).
     4. Adicione em TEXTURA_ARMA (caminho .jpg — pode ser null).
     5. Adicione em AJUSTE_ARMA (tamanho/rotacao/offset na tela).
     6. Coloque a imagem em imagens/arma_<id>.png para a loja.
     7. Se quiser desconto, adicione em DESCONTOS: { <id>: 15 }.

     REFERENCIA DOS CAMPOS:
       id        → identificador unico (ex: 'pistola')
       nome      → nome exibido na loja
       preco     → 0 = gratis; qualquer valor = compra com coins
       info      → descricao curta exibida no card
       dano      → dano por tiro (sem headshot)
       cadencia  → segundos entre tiros (menor = mais rapido)
       pente     → balas por carregador
       reserva   → balas na reserva
       recarga   → segundos para recarregar
       alcance   → distancia maxima em unidades 3D
       espalha   → espalhamento sem mirar (0 = perfeito)
       espalhaMira → espalhamento mirando (0 = perfeito)
       coice     → quanto sobe a mira por tiro
       zoom      → o quanto o FOV fecha ao mirar (0=nada, 0.3=muito)
       pellets   → (opcional) projéteis por tiro, para escopeta
       melee     → (opcional) true para arma corpo a corpo
     ========================================================== */

  /* --- PISTOLA --- */
  { id:'pistola', nome:'PISTOLA', preco:300, info:'Leve e rápida',
    dano:28, cadencia:0.22, pente:12, reserva:60, recarga:1.3,
    alcance:60, espalha:0.018, espalhaMira:0.004, coice:0.012, zoom:0.72 },

  /* --- REVOLVER --- */
  { id:'revolver', nome:'REVÓLVER', preco:750, info:'Alto dano · 6 tiros',
    dano:58, cadencia:0.45, pente:6, reserva:36, recarga:2.4,
    alcance:80, espalha:0.022, espalhaMira:0.003, coice:0.045, zoom:0.65 },

  /* --- ESCOPETA DUPLA --- */
  { id:'dupla', nome:'DUPLA CANO', preco:1050, info:'2 tiros devastadores',
    dano:28, cadencia:0.55, pente:2, reserva:16, recarga:2.0,
    alcance:18, espalha:0.12, espalhaMira:0.07, coice:0.09, zoom:0.85, pellets:10 },

  /* --- AK-47 --- */
  { id:'ak47', nome:'AK-47', preco:1400, info:'Alto dano · rifle de assalto',
    dano:36, cadencia:0.095, pente:30, reserva:150, recarga:2.2,
    alcance:100, espalha:0.02, espalhaMira:0.003, coice:0.032, zoom:0.60 },

  /* --- M4A1 --- */
  { id:'m4a1', nome:'M4A1', preco:1300, info:'Precisa · versátil',
    dano:28, cadencia:0.085, pente:30, reserva:150, recarga:2.0,
    alcance:105, espalha:0.013, espalhaMira:0.002, coice:0.021, zoom:0.58 },

  /* --- SCAR --- */
  { id:'scar', nome:'SCAR', preco:1800, info:'Potente · longo alcance',
    dano:42, cadencia:0.13, pente:20, reserva:100, recarga:2.3,
    alcance:120, espalha:0.011, espalhaMira:0.0015, coice:0.028, zoom:0.52 },

  /* --- MP5 --- */
  { id:'mp5', nome:'MP5', preco:700, info:'Compacta · controlável',
    dano:19, cadencia:0.072, pente:30, reserva:150, recarga:1.7,
    alcance:58, espalha:0.022, espalhaMira:0.006, coice:0.014, zoom:0.72 },

  /* --- UMP --- */
  { id:'ump', nome:'UMP-45', preco:850, info:'Dano médio · SMG pesada',
    dano:26, cadencia:0.11, pente:25, reserva:125, recarga:1.9,
    alcance:62, espalha:0.02, espalhaMira:0.005, coice:0.018, zoom:0.70 },

  /* --- UZI --- */
  { id:'uzi', nome:'UZI', preco:550, info:'Cadência extrema · curto alcance',
    dano:14, cadencia:0.055, pente:32, reserva:160, recarga:1.5,
    alcance:45, espalha:0.032, espalhaMira:0.01, coice:0.011, zoom:0.80 },

  /* --- SUBMACHINE (P90) --- */
  { id:'submachine', nome:'P90', preco:1100, info:'50 balas · alta cadência',
    dano:20, cadencia:0.065, pente:50, reserva:200, recarga:2.1,
    alcance:65, espalha:0.019, espalhaMira:0.005, coice:0.012, zoom:0.74 },

  /* --- MP40 --- */
  { id:'mp40', nome:'MP40', preco:480, info:'Clássica · estável',
    dano:22, cadencia:0.10, pente:32, reserva:160, recarga:1.8,
    alcance:50, espalha:0.018, espalhaMira:0.005, coice:0.013, zoom:0.76 },

  /* --- BARRETT --- */
  { id:'barrett', nome:'BARRETT M82', preco:2800, info:'Anti-material · devastadora',
    dano:145, cadencia:1.4, pente:10, reserva:40, recarga:3.2,
    alcance:220, espalha:0.025, espalhaMira:0.0002, coice:0.12, zoom:0.25 }
];
const NOMES_BOT = {
  aliado : ['ALPHA','BRAVO','CHARLIE','DELTA','ECHO'],
  inimigo: ['VIPER','KILO','TANGO','ZERO','RAVEN','GHOST']
};

const DESCONTOS = {
  ar: 10,
  smg: 10,
  sniper: 10,
  lmg:    10
};

const P = {
  nick:'', coins:500, xp:0, nivel:1,
  skin:'padrao', arma:'rifle',
  skinsTem:['padrao'], armasTem:['rifle'],
  facaAtiva:true,
  sens:100, sensMira:55, fov:78, qual:2,
  volSom:70, volMusica:35
};
const xpDoNivel = n => 400 + (n-1)*260;
function carregarPerfil(){
  try{ const s = localStorage.getItem('rajada_perfil'); if(s) Object.assign(P, JSON.parse(s)); }catch(e){}
  if (P.arma === 'faca') P.arma = 'rifle';
  if (typeof P.facaAtiva !== 'boolean') P.facaAtiva = true;
}
function salvarPerfil(){
  try{ localStorage.setItem('rajada_perfil', JSON.stringify(P)); }catch(e){}
  /* Envia ao servidor — usa keepalive para nao ser cancelado ao fechar a pagina */
  if(typeof API !== 'undefined' && API.token){
    API.salvarPerfilAgora();
  }
}

/* =========== MODELOS =========== */
const Modelos = {
  loader: null, cache: new Map(),
  init() {
    if (typeof THREE.GLTFLoader === 'function') {
      this.loader = new THREE.GLTFLoader();
      if (typeof THREE.DRACOLoader === 'function') {
        try {
          const draco = new THREE.DRACOLoader();
          draco.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.5/');
          this.loader.setDRACOLoader(draco);
        } catch(e){}
      }
    }
  },
  carregar(caminho) {
    if (!this.loader || !caminho) return Promise.resolve(null);
    if (this.cache.has(caminho)) return Promise.resolve(this.cache.get(caminho));
    return new Promise((res) => {
      this.loader.load(caminho, (g) => { this.cache.set(caminho, g); res(g); },
        undefined, () => { this.cache.set(caminho, null); res(null); });
    });
  },
  aplicarSombras(obj) {
    obj.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true; o.receiveShadow = true;
        if (o.material) { o.material.side = THREE.FrontSide; o.material.envMapIntensity = 1; }
      }
    });
    return obj;
  },
  clonar(obj) {
    if (typeof THREE.SkeletonUtils !== 'undefined' && THREE.SkeletonUtils.clone)
      return THREE.SkeletonUtils.clone(obj);
    return obj.clone(true);
  },
  medir(obj) {
    obj.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(obj);
    const tamanho = new THREE.Vector3();
    const centro = new THREE.Vector3();
    box.getSize(tamanho); box.getCenter(centro);
    return { tamanho, centro };
  }
};

const MODELO_ARMA = {
  faca:'Modelos/faca.glb', rifle:'Modelos/rifle.glb', smg:'Modelos/smg.glb',
  ar:'Modelos/carabina.glb', doze:'Modelos/escopeta.glb',
  sniper:'Modelos/sniper.glb', lmg:'Modelos/metralhadora.glb',
  pistola:'Modelos/pistola.glb', revolver:'Modelos/revolver.glb', dupla:'Modelos/dupla.glb',
  ak47:'Modelos/ak47.glb', m4a1:'Modelos/m4a1.glb', scar:'Modelos/scar.glb',
  mp5:'Modelos/mp5.glb', ump:'Modelos/ump.glb', uzi:'Modelos/uzi.glb',
  submachine:'Modelos/submachine.glb', mp40:'Modelos/mp40.glb', barrett:'Modelos/barrett.glb'
};
const TEXTURA_ARMA = {
  faca:'Texturas/faca.jpg', rifle:'Texturas/rifle.jpg', smg:'Texturas/smg.jpg',
  ar:'Texturas/carabina.jpg', doze:'Texturas/escopeta.jpg',
  sniper:'Texturas/sniper.jpg', lmg:'Texturas/metralhadora.jpg',
  pistola:'Texturas/pistola.jpg', revolver:'Texturas/revolver.jpg', dupla:'Texturas/dupla.jpg',
  ak47:'Texturas/ak47.jpg', m4a1:'Texturas/m4a1.jpg', scar:'Texturas/scar.jpg',
  mp5:'Texturas/mp5.jpg', ump:'Texturas/ump.jpg', uzi:'Texturas/uzi.jpg',
  submachine:'Texturas/submachine.jpg', mp40:'Texturas/mp40.jpg', barrett:'Texturas/barrett.jpg'
};

const AJUSTE_ARMA = {
  faca:   { tamanho:0.35, rotacao:[0, Math.PI/2, 0],       offset:[0, 0, 0.06],     brilho: 0 },
  rifle:  { tamanho:0.75, rotacao:[0, Math.PI, 0],         offset:[0, -0.02, 0.02], brilho: 0 },
  smg:    { tamanho:0.55, rotacao:[0, -Math.PI/2, 0],      offset:[0, -0.02, 0.02], brilho: 0 },
  ar:     { tamanho:0.80, rotacao:[0, 0, 0],               offset:[0, -0.02, 0.02], brilho: 0 },
  /* escopeta: o modelo ja nasce apontando para frente, entao
     rotacao Y = 0. Se algum dia precisar ajustar, use no console:
     girarArma('doze', 90)  — aceita 0, 90, 180 ou 270 graus. */
  doze:   { tamanho:0.75, rotacao:[0, 0, 0],               offset:[0, -0.02, 0.02], brilho: 0 },
  sniper: { tamanho:1.10, rotacao:[0, Math.PI, 0],         offset:[0, -0.02, 0.02], brilho: 0 },
  lmg:    { tamanho:0.95, rotacao:[0, Math.PI, 0],         offset:[0, -0.02, 0.02], brilho: 0 },
  /* Novas armas — ajuste tamanho/rotacao se tiver modelo 3D.
     Com modelo null o jogo gera uma geometria automatica. */
  pistola:  { tamanho:0.25, rotacao:[0, 0, 0],           offset:[0, -0.02, 0.02], brilho: 0 },
  revolver: { tamanho:0.25, rotacao:[0, -Math.PI/2, 0],  offset:[0, -0.02, 0.02], brilho: 0 },
  dupla:    { tamanho:0.72, rotacao:[0, 0, 0],            offset:[0, -0.02, 0.02], brilho: 0 },
  ak47:       { tamanho:0.85, rotacao:[0, Math.PI/2, 0],   offset:[0, -0.02, 0.02], brilho: 0 },
  m4a1:       { tamanho:0.80, rotacao:[0, -Math.PI/2, 0],   offset:[0, -0.02, 0.02], brilho: 0 },
  scar:       { tamanho:0.75, rotacao:[0, 0, 0],   offset:[0, -0.02, 0.02], brilho: 0 },
  mp5:        { tamanho:0.55, rotacao:[0, -Math.PI/2, 0],   offset:[0, -0.02, 0.02], brilho: 0 },
  ump:        { tamanho:0.55, rotacao:[0, Math.PI/2, 0],   offset:[0, -0.02, 0.02], brilho: 0 },
  uzi:        { tamanho:0.40, rotacao:[0, 0, 0],   offset:[0, -0.02, 0.02], brilho: 0 },
  submachine: { tamanho:0.58, rotacao:[0, Math.PI, 0],   offset:[0, -0.02, 0.02], brilho: 0 },
  mp40:       { tamanho:0.60, rotacao:[0, Math.PI, 0],   offset:[0, -0.02, 0.02], brilho: 0 },
  barrett:    { tamanho:0.75, rotacao:[0, Math.PI, 0],   offset:[0, -0.02, 0.02], brilho: 0 }
};


/* ==========================================================
   AJUSTE DE ARMA AO VIVO
   Abra o console (F12) durante a partida e use:

     girarArma('doze', 90)    gira a escopeta 90 graus
     girarArma('doze')        mostra o valor atual
     armas()                  lista os apelidos das armas

   Apelidos: faca, rifle, smg, ar, doze, sniper, lmg
   O valor fica salvo no aparelho e vale para as proximas vezes.
   ========================================================== */
/* Ao mudar um angulo aqui no codigo, suba este numero.
   Isso apaga os ajustes que ficaram salvos no aparelho
   durante os testes, para o valor novo valer. */
const VERSAO_GIROS = 2;

function carregarGiros(){
  try{
    const ver = +(localStorage.getItem('rajada_giros_ver') || 0);
    if(ver !== VERSAO_GIROS){
      /* ajustes antigos ficaram para tras: comeca limpo */
      localStorage.removeItem('rajada_giros');
      localStorage.setItem('rajada_giros_ver', VERSAO_GIROS);
      return;
    }
    const s = localStorage.getItem('rajada_giros');
    if(!s) return;
    const d = JSON.parse(s);
    for(const k in d){
      if(AJUSTE_ARMA[k]) AJUSTE_ARMA[k].rotacao[1] = d[k] * Math.PI / 180;
    }
  }catch(e){}
}

/* apaga todos os ajustes manuais e volta para os valores do codigo */
function resetarGiros(){
  try{
    localStorage.removeItem('rajada_giros');
    localStorage.setItem('rajada_giros_ver', VERSAO_GIROS);
  }catch(e){}
  console.log('Ajustes de arma apagados. Recarregue a pagina.');
}
function salvarGiro(id, graus){
  try{
    localStorage.setItem('rajada_giros_ver', VERSAO_GIROS);
    const s = localStorage.getItem('rajada_giros');
    const d = s ? JSON.parse(s) : {};
    d[id] = graus;
    localStorage.setItem('rajada_giros', JSON.stringify(d));
  }catch(e){}
}
function girarArma(id, graus){
  const a = AJUSTE_ARMA[id];
  if(!a){ console.warn('Arma nao existe. Use: ' + Object.keys(AJUSTE_ARMA).join(', ')); return; }
  if(graus === undefined){
    console.log(id + ' esta em ' + Math.round(a.rotacao[1] * 180 / Math.PI) + ' graus');
    return;
  }
  a.rotacao[1] = graus * Math.PI / 180;
  salvarGiro(id, graus);
  try{ montarArmaNaTela(); }catch(e){}
  console.log(id + ' agora em ' + graus + ' graus (salvo)');
}
function armas(){
  console.table(Object.keys(AJUSTE_ARMA).map(k=>({
    apelido:k,
    graus: Math.round(AJUSTE_ARMA[k].rotacao[1] * 180 / Math.PI),
    tamanho: AJUSTE_ARMA[k].tamanho
  })));
}

const MODELO_NPC = 'Modelos/soldado.glb';
const TEXTURA_NPC_AZUL = 'Texturas/soldado_azul.jpg';
const TEXTURA_NPC_VERM = 'Texturas/soldado_verm.jpg';
const TEXTURA_NPC_PLAYER = 'Texturas/soldado_player.jpg';
const ANIM = {
  parado:'Animacoes/parado.glb', andando:'Animacoes/andando.glb',
  correndo:'Animacoes/correndo.glb', recarregar:'Animacoes/recarregar.glb',
  atirar:'Animacoes/atirar.glb', mirar:'Animacoes/mirar.glb',
  dano:'Animacoes/dano.glb', morte:'Animacoes/morte.glb',
  faca:'Animacoes/faca.glb', granada:'Animacoes/granada.glb'
};
const TEXTURA_MAPA = {
  chao:'Texturas/chao.jpg', parede:'Texturas/mapa_parede.jpg',
  blocoCentral:'Texturas/mapa_bloco_central.jpg', muro:'Texturas/mapa_muro.jpg',
  caixa:'Texturas/mapa_caixa.jpg', torre:'Texturas/mapa_torre.jpg',
  plataformaAzul:'Texturas/mapa_plataforma_azul.jpg',
  plataformaVerm:'Texturas/mapa_plataforma_verm.jpg'
};

const CACHE_TEX = {};
function texturaDoMapa(caminho){
  if(!caminho) return null;
  if(CACHE_TEX[caminho]) return CACHE_TEX[caminho];
  const tex = new THREE.TextureLoader().load(caminho, undefined, undefined, ()=>{
    delete CACHE_TEX[caminho];
  });
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping; tex.wrapT = THREE.RepeatWrapping;
  CACHE_TEX[caminho] = tex;
  return tex;
}

/* =========== API =========== */
const API = {
  /* No app usa o endereco completo. No site usa o arquivo ao lado. */
  base: SERVIDOR.site,
  token: null,
  init(){ try { this.token = localStorage.getItem('rajada_token') || null; }catch(e){} },
  temSessao(){ return !!this.token; },
  salvarToken(t){ this.token = t; try{ localStorage.setItem('rajada_token', t); }catch(e){} },
  limparToken(){ this.token = null; try{ localStorage.removeItem('rajada_token'); }catch(e){} },
  async pedir(acao, dados = {}){
    const body = { acao, ...dados };
    if (this.token) body.token = this.token;
    try {
      const r = await fetch(this.base, {
        method:'POST', credentials: DENTRO_DO_APP ? 'omit' : 'same-origin',
        headers:{ 'Content-Type':'application/json' },
        body: JSON.stringify(body)
      });
      return await r.json();
    } catch(e){ return { ok:false, erro:'rede' }; }
  },
  async registrar(email, nick, senha){
    const r = await this.pedir('registrar', { email, nick, senha });
    if (r.ok && r.token) this.salvarToken(r.token);
    return r;
  },
  /* forcar = true encerra as outras sessoes da conta */
  async login(email, senha, forcar){
    const r = await this.pedir('login', { email, senha, forcar_login: !!forcar });
    if (r.ok && r.token) this.salvarToken(r.token);
    return r;
  },
  async logout(){ const r = await this.pedir('logout'); this.limparToken(); return r; },
  async carregarPerfilServidor(){
    const r = await this.pedir('perfil');
    if (!r.ok) {
      if (r.erro === 'sessao_invalida') this.limparToken();
      return false;
    }
    Object.assign(P, r.perfil);
    if (P.arma === 'faca') P.arma = 'rifle';
    if (typeof P.facaAtiva !== 'boolean') P.facaAtiva = true;
    try{ localStorage.setItem('rajada_perfil', JSON.stringify(P)); }catch(e){}
    return true;
  },
  async salvarPerfil(){
    if (!this.token) return;
    await this.pedir('salvar_perfil', {
      coins: P.coins, xp: P.xp, nivel: P.nivel,
      skin: P.skin, arma: P.arma,
      skins_tem: P.skinsTem, armas_tem: P.armasTem,
      total_abates: P.totalAbates|0,
      total_vitorias: P.totalVitorias|0,
      total_partidas: P.totalPartidas|0,
      sens: P.sens, sens_mira: P.sensMira, fov: P.fov, qual: P.qual,
      vol_som: P.volSom|0, vol_musica: P.volMusica|0
    });
  },
  /* Versao sincrona/keepalive: usa fetch com keepalive:true para nao ser
     abortado se o usuario fechar/recarregar a pagina imediatamente apos comprar */
  salvarPerfilAgora(){
    if (!this.token) return;
    const body = JSON.stringify({
      acao: 'salvar_perfil',
      token: this.token,
      coins: P.coins, xp: P.xp, nivel: P.nivel,
      skin: P.skin, arma: P.arma,
      skins_tem: P.skinsTem, armas_tem: P.armasTem,
      total_abates: P.totalAbates|0,
      total_vitorias: P.totalVitorias|0,
      total_partidas: P.totalPartidas|0,
      sens: P.sens, sens_mira: P.sensMira, fov: P.fov, qual: P.qual,
      vol_som: P.volSom|0, vol_musica: P.volMusica|0
    });
    try {
      /* keepalive: o browser continua o request mesmo se a pagina fechar */
      fetch(this.base, {
        method: 'POST',
        credentials: DENTRO_DO_APP ? 'omit' : 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body,
        keepalive: true
      }).then(r => r.json()).then(r => {
        if (!r.ok && r.erro === 'sessao_invalida') this.limparToken();
      }).catch(() => {
        /* falha de rede: nao faz nada, o localStorage ja tem a copia local */
      });
    } catch(e) {}
  },
  async ranqueGlobal(){ const r = await this.pedir('ranque'); return r.ok ? r.lista : []; }
};
API.init();

/* =========== CENAS =========== */
const el = id => document.getElementById(id);
const qs = s => document.querySelector(s);
let cenaAtual = 'cLoad';
function liga(id, evento, fn){ const e = el(id); if(!e) return null; e['on'+evento] = fn; return e; }

const SOM = {
  _toca(tipo){
    try{
      if(typeof AUDIO === 'undefined' || !AUDIO) return;
      if(!AUDIO.ctx) AUDIO.init();
      if(AUDIO.ctx && AUDIO.ctx.state === 'suspended') AUDIO.ctx.resume();
      AUDIO.play(tipo);
    }catch(e){}
  },
  clique(){ this._toca('clique'); }, tiro(){ this._toca('tiro'); },
  faca(){ this._toca('faca'); }, recarga(){ this._toca('reload'); },
  init(){ try{ if(typeof AUDIO!=='undefined' && AUDIO) AUDIO.init(); }catch(e){} },
  retomar(){ try{ if(AUDIO && AUDIO.ctx && AUDIO.ctx.state==='suspended') AUDIO.ctx.resume(); }catch(e){} }
};

function mostrarCena(id){
  const novo = el(id); if(!novo) return;
  const velho = el(cenaAtual);
  if(velho && velho !== novo){
    velho.classList.remove('on');
    setTimeout(()=> velho.classList.remove('viva'), 460);
  }
  novo.classList.add('viva');
  requestAnimationFrame(()=> requestAnimationFrame(()=> novo.classList.add('on')));
  cenaAtual = id;
  el('cv').style.opacity = (id === 'cJogo') ? '1' : '0';
  try{ AUDIO.fundo(id === 'cLobby'); } catch(e){}
}

let loadTimer = null, loadTimerWatch = null;
function carregar(textos, aoTerminar){
  clearInterval(loadTimer);
  const cx = el('cLoad'), bar = el('loadBar'), pct = el('loadPct'), txt = el('loadTxt');
  cx.classList.add('viva'); cx.style.zIndex = 900;
  requestAnimationFrame(()=>{
    cx.classList.add('on');
    bar.style.width = '0%'; pct.textContent = '0%'; txt.textContent = textos[0] || '';
    let v = 0, i = 0;
    clearTimeout(loadTimerWatch);
    loadTimerWatch = setTimeout(()=>{
      if (parseFloat(bar.style.width) < 100){
        clearInterval(loadTimer);
        bar.style.width = '100%'; pct.textContent = '100%';
        txt.textContent = 'Pronto';
        cx.classList.remove('on');
        setTimeout(()=>{ cx.classList.remove('viva'); try{ aoTerminar && aoTerminar(); }catch(e){ console.error(e); } }, 320);
      }
    }, 15000);
    setTimeout(()=>{
      loadTimer = setInterval(()=>{
        const passo = v < 70 ? 1.4 + Math.random()*2.6
                    : v < 92 ? 0.5 + Math.random()*1.1
                             : 0.7 + Math.random()*1.6;
        v = Math.min(100, v + passo);
        bar.style.width = v + '%'; pct.textContent = Math.floor(v) + '%';
        const k = Math.min(textos.length-1, Math.floor(v/100*textos.length));
        if(k !== i){ i = k; txt.textContent = textos[k]; }
        if(v >= 100){
          clearInterval(loadTimer);
          txt.textContent = textos[textos.length-1] || 'Pronto';
          clearTimeout(loadTimerWatch);
          setTimeout(()=>{
            cx.classList.remove('on');
            setTimeout(()=>{ cx.classList.remove('viva'); try{ aoTerminar && aoTerminar(); }catch(e){ console.error(e); } }, 460);
          }, 380);
        }
      }, 34);
    }, 140);
  });
}

function particulasLoad(){
  const c = el('loadFundo'); if(!c) return;
  c.innerHTML = '';
  for(let i=0;i<34;i++){
    const p = document.createElement('i');
    const t = 1.5 + Math.random()*2.5;
    p.style.cssText = `left:${Math.random()*100}%;width:${t}px;height:${t}px;--dx:${(Math.random()-.5)*180}px;animation-duration:${5+Math.random()*8}s;animation-delay:${-Math.random()*10}s`;
    c.appendChild(p);
  }
}

/* =========== LOBBY =========== */
function pintarLobby(){
  montarModos();
  const inicial = (P.nick[0]||'?').toUpperCase();
  const setar = (id,v)=>{ const e=el(id); if(e) e.textContent = v; };
  setar('lbNick', P.nick); setar('lbNick2', P.nick);
  setar('lbAvalTxt', inicial); setar('lbFotoTxt', inicial);
  setar('lbCoins', P.coins.toLocaleString('pt-BR'));
  const nec = xpDoNivel(P.nivel);
  setar('lbNivel', 'Nivel '+P.nivel);
  setar('lbXpNum', P.xp+' / '+nec);
  const barra = el('lbXpBar');
  if(barra) barra.style.width = Math.min(100, P.xp/nec*100)+'%';
  setar('lbStK', (P.totalAbates||0).toLocaleString('pt-BR'));
  setar('lbStV', (P.totalVitorias||0));
  setar('lbStP', (P.totalPartidas||0));
  try{ AUDIO.fundo(true); }catch(e){}
  if (!NET.conectado) NET.conectar(P.nick || 'Anon');
  if (el('paginaLoja') && el('paginaLoja').classList.contains('on')) renderLoja();
  if (el('paginaInv')  && el('paginaInv').classList.contains('on'))  renderInventario();
  AMIGOS.carregarDoServidor();
}

/* =====================================================================
   SISTEMA DE AMIGOS + GRUPOS
   ===================================================================== */
const AMIGOS = {
  lista:      [],   /* { nick, nivel, amizadeId } */
  recebidos:  [],   /* pedidos recebidos */
  enviados:   [],   /* pedidos enviados */
  onlineMap:  new Map(), /* nick -> { status, modo } */
  grupoAtual: null, /* { id, membros[], modo, lider } */
  _carregando: false,

  async carregarDoServidor(){
    if(!API.token || this._carregando) return;
    this._carregando = true;
    try{
      const r = await API.pedir('listar_amigos', {});
      if(r.ok){
        const novaLista     = r.amigos    || [];
        const novosRecebidos= r.recebidos || [];
        const novosEnviados = r.enviados  || [];
        /* Só re-renderiza se houve mudança real */
        const mudouLista     = JSON.stringify(novaLista)     !== JSON.stringify(this.lista);
        const mudouRecebidos = JSON.stringify(novosRecebidos)!== JSON.stringify(this.recebidos);
        const mudouEnviados  = JSON.stringify(novosEnviados) !== JSON.stringify(this.enviados);
        this.lista     = novaLista;
        this.recebidos = novosRecebidos;
        this.enviados  = novosEnviados;
        if(mudouRecebidos) this.atualizarBadge();
        if(mudouLista || mudouRecebidos || mudouEnviados){
          this.renderOnlineLobby();
          const modal = el('mdAmigos');
          if(modal && modal.classList.contains('on')) this.renderModal();
        }
        if(NET.conectado) NET.enviar({ type:'status_amigos' });
      }
    }finally{ this._carregando = false; }
  },

  /* Poll silencioso chamado pelo loop — não bloqueia, não pisca */
  async pollSilencioso(){
    if(!API.token || this._carregando) return;
    this._carregando = true;
    try{
      const r = await API.pedir('listar_amigos', {});
      if(!r.ok){ this._carregando = false; return; }
      const novaLista     = r.amigos    || [];
      const novosRecebidos= r.recebidos || [];
      const novosEnviados = r.enviados  || [];
      const mudouRecebidos = JSON.stringify(novosRecebidos) !== JSON.stringify(this.recebidos);
      const mudouQualquer  = mudouRecebidos
        || JSON.stringify(novaLista)    !== JSON.stringify(this.lista)
        || JSON.stringify(novosEnviados)!== JSON.stringify(this.enviados);
      this.lista     = novaLista;
      this.recebidos = novosRecebidos;
      this.enviados  = novosEnviados;
      if(mudouRecebidos) this.atualizarBadge();
      if(mudouQualquer){
        this.renderOnlineLobbyDiff(); /* atualiza sem piscar */
        const modal = el('mdAmigos');
        if(modal && modal.classList.contains('on')) this.renderModal();
      }
    }finally{ this._carregando = false; }
  },

  atualizarBadge(){
    const badge = el('amigosNotif');
    if(badge){
      const n = this.recebidos.length;
      badge.textContent = n;
      badge.style.display = n > 0 ? 'flex' : 'none';
    }
  },

  setListaOnline(players){
    this.onlineMap.clear();
    players.forEach(p => this.onlineMap.set(p.nick, { status: p.status, modo: p.modo }));
    const modal = el('mdAmigos');
    if(modal && modal.classList.contains('on')) this.renderModal();
    this.renderOnlineLobbyDiff();
  },

  atualizarStatusOnline(nick, status, modo){
    if(status === 'offline') this.onlineMap.delete(nick);
    else this.onlineMap.set(nick, { status, modo });
    const modal = el('mdAmigos');
    if(modal && modal.classList.contains('on')) this.renderModal();
    this.renderOnlineLobbyDiff();
    /* Atualiza pontos de presença no grupo sem rebuild */
    if(this.grupoAtual){
      const row = document.querySelector(`#grupoMembros .grupoMembro span.pontoOn[data-nick="${nick}"]`);
      /* fallback: rebuild grupo só se necessário */
      const grupoMembros = el('grupoMembros');
      if(grupoMembros) grupoMembros.querySelectorAll('.grupoMembro').forEach(el=>{
        const nickEl = el.querySelector('span:not(.pontoOn)');
        if(nickEl && nickEl.textContent.trim() === nick){
          const ponto = el.querySelector('.pontoOn');
          if(ponto) ponto.style.background = status==='em_partida'?'#f0a020': status==='online'?'#5ec97a':'#4a5158';
        }
      });
    }
  },

  renderOnlineLobby(){
    const box = el('amigosOnlineList'); if(!box) return;
    const amigosOnline = this.lista.filter(a => this.onlineMap.has(a.nick));
    box.innerHTML = '';
    if(amigosOnline.length === 0){
      box.innerHTML = '<div class="amigoVazio" style="padding:8px 0;font-size:10px">Nenhum amigo online</div>';
      return;
    }
    amigosOnline.slice(0,6).forEach(a=>{
      const st  = this.onlineMap.get(a.nick);
      const cor = st.status==='em_partida'?'#f0a020':'#5ec97a';
      const txt = st.status==='em_partida'?'Em partida':'Online';
      const d   = document.createElement('div');
      d.className = 'amigosOnlineItem';
      d.dataset.nick = a.nick;
      d.innerHTML = `<span class="pontoOn" style="background:${cor}"></span>`+
        `<span style="flex:1">${a.nick}</span>`+
        `<span style="font-size:9px;color:var(--fraco)">${txt}</span>`;
      box.appendChild(d);
    });
    if(amigosOnline.length > 6){
      const more = document.createElement('div');
      more.style.cssText='font-size:9px;color:var(--fraco);text-align:center;padding-top:4px';
      more.textContent=`+${amigosOnline.length-6} mais`;
      box.appendChild(more);
    }
  },

  /* Atualiza o painel do lobby SEM recriar o HTML — só muda o que mudou */
  renderOnlineLobbyDiff(){
    const box = el('amigosOnlineList'); if(!box) return;
    const amigosOnline = this.lista.filter(a => this.onlineMap.has(a.nick));

    /* Se o conjunto de nicks mudou, rebuild completo (raro) */
    const nicksAtuais = amigosOnline.slice(0,6).map(a=>a.nick).join(',');
    const nicksDOM    = [...box.querySelectorAll('[data-nick]')].map(e=>e.dataset.nick).join(',');
    if(nicksAtuais !== nicksDOM){ this.renderOnlineLobby(); return; }

    /* Só atualiza cor e texto dos itens que mudaram */
    amigosOnline.slice(0,6).forEach(a=>{
      const st  = this.onlineMap.get(a.nick);
      const cor = st.status==='em_partida'?'#f0a020':'#5ec97a';
      const txt = st.status==='em_partida'?'Em partida':'Online';
      const row = box.querySelector(`[data-nick="${a.nick}"]`); if(!row) return;
      const ponto = row.querySelector('.pontoOn');
      const label = row.lastElementChild;
      if(ponto && ponto.style.background !== cor) ponto.style.background = cor;
      if(label && label.textContent !== txt) label.textContent = txt;
    });
  },

  receberConviteGrupo(m){
    /* Mostra notificação de convite */
    const div = document.createElement('div');
    div.className = 'conviteGrupo';
    div.innerHTML =
      `<span><b>${m.de}</b> convidou para jogar <b>${(m.modo||'tatico').toUpperCase()}</b></span>`+
      `<div style="display:flex;gap:7px;margin-top:8px">`+
        `<button class="edBt pri" id="aceitarConvite">Aceitar</button>`+
        `<button class="edBt" id="recusarConvite">Recusar</button>`+
      `</div>`;
    document.body.appendChild(div);
    setTimeout(()=> div.style.opacity='1', 10);
    const fechar = ()=>{ div.style.opacity='0'; setTimeout(()=>div.remove(),400); };
    div.querySelector('#aceitarConvite').onclick = ()=>{
      NET.enviar({ type:'entrar_grupo', grupoId: m.grupoId });
      fechar();
    };
    div.querySelector('#recusarConvite').onclick = fechar;
    setTimeout(fechar, 18000);
  },

  renderGrupo(){
    const box = el('grupoBox');
    if(!box) return;
    if(!this.grupoAtual){ box.innerHTML = ''; box.style.display='none'; return; }
    box.style.display = 'block';
    const g = this.grupoAtual;

    /* Detecta se sou o líder — tanto via flag direta quanto via lista de membros */
    const souLider = !!g.lider
      || (g.membros||[]).some(m => m.lider && (m.nick === P.nick || m.nick === (P.nick||'').trim()));

    const modoNome = { tatico:'TÁTICO 4v4', x1:'DUELO 1v1', x2:'DUELO 2v2' };
    const modoAtual = g.modo || 'tatico';
    const totalMembros = (g.membros||[]).length;
    const maxMembros   = modoAtual==='x1'?2 : modoAtual==='x2'?4 : 8;

    /* Monta HTML */
    box.innerHTML =
      `<div class="grupoTit">`+
        `<span>GRUPO</span>`+
        `<span style="color:var(--c1);margin-left:6px">${modoNome[modoAtual]||modoAtual.toUpperCase()}</span>`+
        `<span style="color:var(--fraco);font-size:9px;margin-left:6px">(${totalMembros}/${maxMembros})</span>`+
      `</div>`+
      `<div class="grupoMembros" id="grupoMembros"></div>`+
      /* Seletor de modo — só para o líder */
      (souLider
        ? `<div style="display:flex;align-items:center;gap:7px;margin-top:8px;margin-bottom:2px">`+
            `<span style="font-size:9px;color:var(--fraco);letter-spacing:.1em">MODO:</span>`+
            `<select id="selModoGrupo" style="background:var(--sup);border:1px solid var(--linha);`+
              `border-radius:6px;color:var(--txt);font-size:10px;font-weight:700;padding:4px 8px;cursor:pointer">`+
              `<option value="tatico" ${modoAtual==='tatico'?'selected':''}>Tático 4v4</option>`+
              `<option value="x1"     ${modoAtual==='x1'    ?'selected':''}>Duelo 1v1</option>`+
              `<option value="x2"     ${modoAtual==='x2'    ?'selected':''}>Duelo 2v2</option>`+
            `</select>`+
          `</div>`
        : '')
      +`<div style="display:flex;gap:7px;margin-top:8px;flex-wrap:wrap">`+
        (souLider
          ? `<button class="edBt pri" id="btJogarGrupo">▶ Buscar Partida</button>`+
            `<button class="edBt" id="btConvidarGrupo">+ Convidar</button>`
          : `<span style="font-size:9px;color:var(--fraco)">Aguardando o líder iniciar...</span>`)
        +`<button class="edBt" id="btSairGrupo" style="color:#ff8ea0">Sair</button>`+
      `</div>`;

    /* Membros */
    const mm = el('grupoMembros');
    if(mm){
      (g.membros||[]).forEach(m=>{
        const st  = this.onlineMap.get(m.nick);
        const cor = st?.status==='em_partida'?'#f0a020' : st?.status==='online'?'#5ec97a':'#4a5158';
        const d   = document.createElement('div');
        d.className = 'grupoMembro';
        d.innerHTML =
          `<span class="pontoOn" style="background:${cor}"></span>`+
          `<span style="flex:1">${m.nick}</span>`+
          (m.lider?'<span style="font-size:9px;color:var(--c1)">★ Líder</span>':'');
        mm.appendChild(d);
      });
    }

    /* Liga eventos APÓS o innerHTML estar no DOM */

    /* Troca de modo pelo líder */
    const sel = el('selModoGrupo');
    if(sel) sel.addEventListener('change', ()=>{
      NET.enviar({ type:'mudar_modo_grupo', modo: sel.value });
    });

    const bjg = el('btJogarGrupo');
    if(bjg) bjg.addEventListener('click', ()=>{
      NET.enviar({ type:'jogar_grupo' });
      mostrarMatchmaking(g.modo || 'tatico');
    });

    const bci = el('btConvidarGrupo');
    if(bci) bci.addEventListener('click', ()=>{ abrirModalConvidarAmigo(); });

    const bsg = el('btSairGrupo');
    if(bsg) bsg.addEventListener('click', ()=>{
      NET.enviar({ type:'sair_grupo' });
      AMIGOS.grupoAtual = null;
      AMIGOS.renderGrupo();
      aviso('Você saiu do grupo');
    });
  },

  renderModal(){
    const corpo = el('amigosCorpo'); if(!corpo) return;
    corpo.innerHTML = '';

    /* Pedidos recebidos */
    if(this.recebidos.length > 0){
      const sec = document.createElement('div');
      sec.innerHTML = '<div class="amigoSecTit">Pedidos recebidos</div>';
      this.recebidos.forEach(r=>{
        const d = document.createElement('div');
        d.className = 'amigoLinha';
        d.innerHTML =
          `<div class="amigoInfo"><span class="amigoNick">${r.nick}</span><span class="amigoNiv">Nível ${r.nivel||1}</span></div>`+
          `<div style="display:flex;gap:6px">`+
            `<button class="edBt pri" data-id="${r.amizadeId}" data-ac="aceitar">Aceitar</button>`+
            `<button class="edBt" data-id="${r.amizadeId}" data-ac="recusar">Recusar</button>`+
          `</div>`;
        sec.appendChild(d);
      });
      corpo.appendChild(sec);
    }

    /* Amigos aceitos */
    const secA = document.createElement('div');
    secA.innerHTML = '<div class="amigoSecTit">Amigos</div>';
    if(this.lista.length === 0){
      secA.innerHTML += '<div class="amigoVazio">Nenhum amigo ainda. Adicione alguém!</div>';
    } else {
      this.lista.forEach(a=>{
        const st = this.onlineMap.get(a.nick) || { status:'offline' };
        const cor = st.status==='em_partida'?'#f0a020': st.status==='online'?'#5ec97a':'#4a5158';
        const txtSt = st.status==='em_partida'?`Em partida (${st.modo||''})`
                     :st.status==='online'?'Online':'Offline';
        const d = document.createElement('div');
        d.className = 'amigoLinha';
        d.innerHTML =
          `<div class="amigoInfo">`+
            `<span class="pontoOn" style="background:${cor}"></span>`+
            `<div><div class="amigoNick">${a.nick}</div><div class="amigoNiv">${txtSt}</div></div>`+
          `</div>`+
          `<div style="display:flex;gap:6px">`+
            (st.status==='online'
              ? `<button class="edBt" data-nick="${a.nick}" data-ac="convidar">Convidar</button>` : '')
            +`<button class="edBt" data-nick="${a.nick}" data-ac="remover" style="color:#ff8ea0">Remover</button>`+
          `</div>`;
        secA.appendChild(d);
      });
    }
    corpo.appendChild(secA);

    /* Pedidos enviados */
    if(this.enviados.length > 0){
      const secE = document.createElement('div');
      secE.innerHTML = '<div class="amigoSecTit" style="color:var(--fraco)">Pedidos enviados</div>';
      this.enviados.forEach(e=>{
        const d = document.createElement('div');
        d.className = 'amigoLinha';
        d.innerHTML =
          `<div class="amigoInfo">`+
            `<span class="amigoNick">${e.nick}</span>`+
            `<span class="amigoNiv" style="color:var(--fraco)">Aguardando...</span>`+
          `</div>`+
          `<button class="edBt" data-id="${e.amizadeId}" data-ac="cancelar" style="color:#ff8ea0">Cancelar</button>`;
        secE.appendChild(d);
      });
      corpo.appendChild(secE);
    }

    /* Eventos */
    corpo.querySelectorAll('[data-ac]').forEach(bt=>{
      bt.onclick = async ()=>{
        const ac = bt.dataset.ac;
        if(ac==='aceitar'||ac==='recusar'){
          await API.pedir('responder_solicitacao',{ id:+bt.dataset.id, aceitar:ac==='aceitar' });
          await AMIGOS.carregarDoServidor();
          AMIGOS.renderModal();
        } else if(ac==='cancelar'){
          await API.pedir('cancelar_solicitacao', { id:+bt.dataset.id });
          await AMIGOS.carregarDoServidor();
          AMIGOS.renderModal();
        } else if(ac==='remover'){
          await API.pedir('remover_amigo',{ nick:bt.dataset.nick });
          await AMIGOS.carregarDoServidor();
          AMIGOS.renderModal();
        } else if(ac==='convidar'){
          const nickAlvo = bt.dataset.nick;
          /* Se não tem grupo, cria um automaticamente com o modo atual ou tatico */
          if(!AMIGOS.grupoAtual){
            const modoGrupo = (S.ativa && modoEscolhido) ? modoEscolhido.id : 'tatico';
            NET.enviar({ type:'criar_grupo', modo: modoGrupo });
            /* Aguarda servidor confirmar criação antes de convidar */
            const esperarGrupo = new Promise(resolve=>{
              const t = setTimeout(()=>resolve(false), 3000);
              const orig = NET._receber.bind(NET);
              NET._receberTemp = (m)=>{
                if(m.type==='grupo_criado'){ clearTimeout(t); resolve(true); }
                orig(m);
              };
            });
            /* Fallback: convida direto após 300ms mesmo sem confirmação */
            setTimeout(()=>{
              NET.enviar({ type:'convidar_grupo', nick: nickAlvo });
              aviso('Convite enviado para '+nickAlvo);
            }, 350);
          } else {
            NET.enviar({ type:'convidar_grupo', nick: nickAlvo });
            aviso('Convite enviado para '+nickAlvo);
          }
        }
      };
    });
  },

  abrirModal(){
    this.carregarDoServidor().then(()=>{ this.renderModal(); });
    const md = el('mdAmigos'); if(md) md.classList.add('on');
    if(NET.conectado) NET.enviar({ type:'status_amigos' });
  }
};

function abrirModalModoCompetitivo(modo){
  /* Modal simples: buscar na fila ou jogar com grupo */
  const md = el('mdModoComp'); if(!md) return;
  const tit = md.querySelector('.mdCompTit');
  if(tit) tit.textContent = modo.nome;
  const sub = md.querySelector('.mdCompSub');
  if(sub) sub.textContent = `${modo.vagas} · Apenas players reais, sem bots`;
  md.dataset.modo = modo.id;
  md.classList.add('on');
}

function abrirModalConvidarAmigo(){
  const md = el('mdConvidar'); if(!md) return;
  const lista = el('convidarLista'); if(!lista) return;
  lista.innerHTML = '';
  AMIGOS.lista.forEach(a=>{
    const st = AMIGOS.onlineMap.get(a.nick);
    if(!st || st.status !== 'online') return;
    const d = document.createElement('div');
    d.className = 'amigoLinha';
    d.innerHTML = `<span class="amigoNick">${a.nick}</span>`+
      `<button class="edBt pri">Convidar</button>`;
    d.querySelector('button').onclick = ()=>{
      NET.enviar({ type:'convidar_grupo', nick:a.nick });
      aviso('Convite enviado para '+a.nick);
      fecharModal('mdConvidar');
    };
    lista.appendChild(d);
  });
  if(!lista.children.length)
    lista.innerHTML='<div class="amigoVazio">Nenhum amigo online disponível.</div>';
  md.classList.add('on');
}

function montarModos(){
  const c = el('listaModos'); if(!c) return;
  c.innerHTML = '';
  MODOS.forEach((m,i)=>{
    const d = document.createElement('div');
    d.className = 'cardModo' + (i===0 ? ' sel' : '');
    if(m.img){
      d.style.backgroundImage    = "url('"+m.img+"')";
      d.style.backgroundSize     = 'cover';
      d.style.backgroundPosition = 'center';
      d.style.backgroundRepeat   = 'no-repeat';
    }
    d.innerHTML =
      '<div class="cardVeu"></div>'+
      '<div class="cardTopo">'+
        '<div class="cardIco">'+(ICO[m.icone]||ICO.mira)+'</div>'+
        '<div class="cardTag">'+m.tag+'</div>'+
      '</div>'+
      '<div class="cardBase">'+
        '<div class="cardNome">'+m.nome+
          '<svg viewBox="0 0 24 24"><path d="M10 17l5-5-5-5v10z"/></svg></div>'+
        '<div class="cardDesc">'+m.desc+'</div>'+
        '<div class="cardPe">'+
          '<span class="cardPeIt">'+
            '<svg viewBox="0 0 24 24"><path d="M16 11c1.7 0 3-1.3 3-3s-1.3-3-3-3-3 1.3-3 3 1.3 3 3 3zm-8 0c1.7 0 3-1.3 3-3S9.7 5 8 5 5 6.3 5 8s1.3 3 3 3zm0 2c-2.3 0-7 1.2-7 3.5V19h14v-2.5c0-2.3-4.7-3.5-7-3.5zm8 0c-.3 0-.6 0-1 .1 1.2.8 2 1.9 2 3.4V19h6v-2.5c0-2.3-4.7-3.5-7-3.5z"/></svg>'+
            m.vagas+'</span>'+
          '<span class="cardPeIt">'+m.tipo+'</span>'+
        '</div>'+
      '</div>';
    d.onclick = ()=>{
      document.querySelectorAll('.cardModo').forEach(x=> x.classList.remove('sel'));
      d.classList.add('sel');
      modoEscolhido = m;
      SOM.clique();
      /* X1 e X2 só jogam com players — mostra painel de opções */
      if(m.semBots){
        abrirModalModoCompetitivo(m);
      } else {
        NET.conectar(P.nick || 'Anon');
        NET.entrarFila(m.id);
        mostrarMatchmaking(m);
      }
    };
    c.appendChild(d);
  });
  for(let k=0;k<SLOTS_VAZIOS;k++){
    const v = document.createElement('div');
    v.className = 'cardBloq';
    v.innerHTML =
      '<div class="cadeado"><svg viewBox="0 0 24 24"><path d="M18 8h-1V6A5 5 0 007 6v2H6a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V10a2 2 0 00-2-2zM9 6a3 3 0 016 0v2H9V6zm3 12a2 2 0 110-4 2 2 0 010 4z"/></svg></div>'+
      '<div class="cardBloqT">Em breve</div>'+
      '<div class="cardBloqS">Novos modos de jogo</div>';
    c.appendChild(v);
  }
}

let modoEscolhido = MODOS[0];

function mostrarMatchmaking(modo){
  const modoObj = typeof modo === 'object' ? modo : MODOS.find(m=>m.id===modo) || MODOS[0];
  const o = el('mmOverlay'); if (o) o.classList.add('on');
  const e = el('mmTimer'); if (e) e.textContent = modoObj.semBots ? '∞' : 30;
  const s = el('mmStatus');
  if (s) s.textContent = modoObj.semBots
    ? `Procurando oponente ${modoObj.tag}...`
    : 'Procurando jogadores...';
  let left = 30;
  clearInterval(NET._mmTimer);
  if (!modoObj.semBots){
    NET._mmTimer = setInterval(() => {
      left--;
      if (e) e.textContent = Math.max(0, left);
      if (left <= 0){ clearInterval(NET._mmTimer); }
    }, 1000);
  }
}
function esconderMatchmaking(){
  const o = el('mmOverlay'); if (o) o.classList.remove('on');
  clearInterval(NET._mmTimer);
}
function mostrarMatchEncontrado(m){
  const o = el('mmFound'); if (o) o.classList.add('on');
  const c = el('mmCountdown'); if (c) c.textContent = m.countdown || 3;
  const info = el('mmFoundInfo');
  if (info){
    const a = m.players.filter(p => p.team === 'aliado').length;
    const i = m.players.filter(p => p.team === 'inimigo').length;
    info.textContent = `${m.players.length} jogadores · ${a}v${i}`;
  }
}
function esconderMatchEncontrado(){
  const o = el('mmFound'); if (o) o.classList.remove('on');
}

/* =========== CHAT =========== */
let chatAberto = false;
function addChat(nick, msg, souEu){
  const log = el('chatLog'); if (!log) return;
  const d = document.createElement('div');
  d.className = 'chatLinha' + (souEu ? ' eu' : '');
  const safe = String(msg).replace(/[<>&]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;'}[c]));
  d.innerHTML = '<b>' + nick + '</b>' + safe;
  log.appendChild(d);
  log.scrollTop = log.scrollHeight;
  while (log.children.length > 12) log.firstChild.remove();
  setTimeout(() => { if (d.parentNode) d.style.opacity = '0.55'; }, 9000);
}
function abrirChat(){
  if (chatAberto || !S.ativa) return;
  chatAberto = true;
  const cx = el('chatBox'); if (cx) cx.classList.add('on');
  const i = el('chatInput');
  if (i){
    i.disabled = false;
    i.classList.add('on');
    i.readOnly = false;
    /* O foco precisa acontecer AGORA, ainda dentro do gesto do
       usuario, senao o Android bloqueia o teclado virtual. */
    try{ i.focus({ preventScroll:true }); }catch(e){ try{ i.focus(); }catch(e2){} }
    try{ i.click(); }catch(e){}
    /* segunda tentativa para navegadores mais lentos */
    setTimeout(()=>{ if(chatAberto){ try{ i.focus(); }catch(e){} } }, 60);
  }
  if (document.pointerLockElement) document.exitPointerLock();
}
function fecharChat(){
  chatAberto = false;
  const i = el('chatInput');
  if (i){ i.disabled = true; i.classList.remove('on'); i.value = ''; i.blur(); }
  if (S.ativa && !S.pausada && !ehCelular()) pedirMouse();
}

/* =========== MUNDO =========== */
let cena, cam, ren, relogio, grupoArma;
const MUNDO = { blocos:[], meshBlocos:[] };
const S = {
  ativa:false, fim:false, pausada:false, tabAberto:false,
  modo:null, scA:0, scV:0, tempo:0, timer:null,
  bots:[], granadas:[], abates:0, mortes:0
};
let TRAVADO = false;

function criarRenderer(){
  ren = new THREE.WebGLRenderer({ canvas:el('cv'), antialias:P.qual>1 });
  ren.setSize(innerWidth, innerHeight);
  ren.toneMapping = THREE.ACESFilmicToneMapping;
  ren.toneMappingExposure = 0.85;
  ren.outputEncoding = THREE.sRGBEncoding;
  aplicarQualidade();
  cam = new THREE.PerspectiveCamera(P.fov, innerWidth/innerHeight, 0.01, 320);
  relogio = new THREE.Clock();
  addEventListener('resize', ()=>{
    ren.setSize(innerWidth, innerHeight);
    cam.aspect = innerWidth/innerHeight;
    cam.updateProjectionMatrix();
  });
}
function aplicarQualidade(){
  if(!ren) return;
  const esc = P.qual===1 ? 0.7 : 1;
  ren.setPixelRatio(Math.min(devicePixelRatio, P.qual===3?2:1.4) * esc);
  ren.shadowMap.enabled = P.qual >= 2;
  ren.shadowMap.type = THREE.PCFSoftShadowMap;
}
function bloco(x,z,l,a,p,cor,semSombra,textura){
  const tex = texturaDoMapa(textura);
  let mat;
  if (tex) {
    tex.repeat.set(Math.max(1, Math.round(l/4)), Math.max(1, Math.round(a/4)));
    tex.anisotropy = 8;
    mat = new THREE.MeshStandardMaterial({ map: tex, color: 0xffffff, roughness: 0.85, metalness: 0.15 });
  } else {
    mat = new THREE.MeshStandardMaterial({ color: cor, roughness: 0.8, metalness: 0.2 });
  }
  const m = new THREE.Mesh(new THREE.BoxGeometry(l+0.02, a, p+0.02), mat);
  m.position.set(x, a/2, z);
  if(!semSombra) m.castShadow = true;
  m.receiveShadow = true; cena.add(m);
  MUNDO.blocos.push({ x1:x-l/2, x2:x+l/2, z1:z-p/2, z2:z+p/2, topo:a });
  MUNDO.meshBlocos.push(m);
  return m;
}
function montarMapa(){
  cena = new THREE.Scene();
  cena.background = new THREE.Color(0x87b8d8);
  cena.fog = new THREE.FogExp2(0xa8c8e0, 0.006);
  MUNDO.blocos = []; MUNDO.meshBlocos = [];

  cena.add(new THREE.AmbientLight(0x9fb0c0, 0.38));
  const hemi = new THREE.HemisphereLight(0xc4d8ec, 0x4a5038, 0.32);
  cena.add(hemi);
  const sol = new THREE.DirectionalLight(0xfff2d8, 1.05);
  sol.position.set(42, 68, 30);
  if(P.qual>=2){
    sol.castShadow = true;
    sol.shadow.mapSize.set(P.qual===3?2048:1024, P.qual===3?2048:1024);
    const d = 78;
    sol.shadow.camera.left=-d; sol.shadow.camera.right=d;
    sol.shadow.camera.top=d; sol.shadow.camera.bottom=-d;
    sol.shadow.camera.far=170; sol.shadow.bias=-0.0007;
  }
  cena.add(sol);
  const preen = new THREE.DirectionalLight(0xc4d4e8, 0.28);
  preen.position.set(-28, 34, -22); cena.add(preen);
  const bounce = new THREE.DirectionalLight(0xe8d8b8, 0.14);
  bounce.position.set(20, -10, 14); cena.add(bounce);

  const texChao = texturaDoMapa(TEXTURA_MAPA.chao);
  let matChao;
  if (texChao) {
    texChao.repeat.set(1, 1);
    texChao.anisotropy = 8;
    matChao = new THREE.MeshStandardMaterial({ map: texChao, color: 0xc0c4c8, roughness: 0.9, metalness: 0.1 });
  } else {
    matChao = new THREE.MeshStandardMaterial({ color: 0x707880, roughness: 0.9, metalness: 0.1 });
  }
  const chao = new THREE.Mesh(new THREE.PlaneGeometry(CFG.mapa.largura+50, CFG.mapa.fundo+50), matChao);
  chao.rotation.x = -Math.PI/2; chao.receiveShadow = true;
  cena.add(chao);

  const LX = CFG.mapa.largura/2, LZ = CFG.mapa.fundo/2;
  bloco(0, LZ, CFG.mapa.largura+4, 9, 2.5, 0x1e2228, false, TEXTURA_MAPA.parede);
  bloco(0,-LZ, CFG.mapa.largura+4, 9, 2.5, 0x1e2228, false, TEXTURA_MAPA.parede);
  bloco( LX,0, 2.5, 9, CFG.mapa.fundo, 0x1e2228, false, TEXTURA_MAPA.parede);
  bloco(-LX,0, 2.5, 9, CFG.mapa.fundo, 0x1e2228, false, TEXTURA_MAPA.parede);

  const L = [
    [ 0,  0, 10,6.5,10,0x2a3038, TEXTURA_MAPA.blocoCentral],
    [ 0,  0, 14,2.6, 3,0x252b32, TEXTURA_MAPA.torre],
    [ 0,-19, 17,3.4, 3,0x252b32, TEXTURA_MAPA.torre],
    [ 0, 19, 17,3.4, 3,0x252b32, TEXTURA_MAPA.torre],
    [-19,-11, 3,3.8,13,0x2c3228, TEXTURA_MAPA.muro],
    [ 19,-11, 3,3.8,13,0x2c3228, TEXTURA_MAPA.muro],
    [-19, 11, 3,3.8,13,0x2c3228, TEXTURA_MAPA.muro],
    [ 19, 11, 3,3.8,13,0x2c3228, TEXTURA_MAPA.muro],
    [-31,  0, 6,2.4, 6,0x38301e, TEXTURA_MAPA.caixa],
    [ 31,  0, 6,2.4, 6,0x38301e, TEXTURA_MAPA.caixa],
    [-11,-29, 7,2.8, 3,0x2a3038, TEXTURA_MAPA.torre],
    [ 11,-29, 7,2.8, 3,0x2a3038, TEXTURA_MAPA.torre],
    [-11, 29, 7,2.8, 3,0x2a3038, TEXTURA_MAPA.torre],
    [ 11, 29, 7,2.8, 3,0x2a3038, TEXTURA_MAPA.torre],
    [-38,-21, 5,3.4, 5,0x252b32, TEXTURA_MAPA.torre],
    [ 38,-21, 5,3.4, 5,0x252b32, TEXTURA_MAPA.torre],
    [-38, 21, 5,3.4, 5,0x252b32, TEXTURA_MAPA.torre],
    [ 38, 21, 5,3.4, 5,0x252b32, TEXTURA_MAPA.torre],
    [-12, -9, 2,1.4, 7,0x38301e, TEXTURA_MAPA.muro],
    [ 12, -9, 2,1.4, 7,0x38301e, TEXTURA_MAPA.muro],
    [-12,  9, 2,1.4, 7,0x38301e, TEXTURA_MAPA.muro],
    [ 12,  9, 2,1.4, 7,0x38301e, TEXTURA_MAPA.muro],
    [-26,-31, 9,2.2, 2,0x2c3228, TEXTURA_MAPA.muro],
    [ 26,-31, 9,2.2, 2,0x2c3228, TEXTURA_MAPA.muro],
    [-26, 31, 9,2.2, 2,0x2c3228, TEXTURA_MAPA.muro],
    [ 26, 31, 9,2.2, 2,0x2c3228, TEXTURA_MAPA.muro],
    [ -6,-10, 4,1.1, 4,0x38301e, TEXTURA_MAPA.caixa],
    [  6, 10, 4,1.1, 4,0x38301e, TEXTURA_MAPA.caixa]
  ];
  L.forEach(a => bloco(a[0], a[1], a[2], a[3], a[4], a[5], false, a[6]));
  plataforma(-46, 0x1a5dcc, TEXTURA_MAPA.plataformaAzul);
  plataforma( 46, 0xcc4422, TEXTURA_MAPA.plataformaVerm);
}
function plataforma(x, cor, textura){
  const tex = texturaDoMapa(textura);
  let mat;
  if (tex) { tex.repeat.set(4, 6); mat = new THREE.MeshLambertMaterial({ map: tex, color: 0xffffff }); }
  else { mat = new THREE.MeshLambertMaterial({ color:cor, emissive:cor, emissiveIntensity:0.24 }); }
  const p = new THREE.Mesh(new THREE.BoxGeometry(13,0.3,22), mat);
  p.position.set(x,0.15,0); p.receiveShadow = true; cena.add(p);
  const l = new THREE.PointLight(cor, 1.5, 30);
  l.position.set(x,6,0); cena.add(l);
}
function colide(x,z,r){
  for(let i=0;i<MUNDO.blocos.length;i++){
    const b = MUNDO.blocos[i];
    if(x>b.x1-r && x<b.x2+r && z>b.z1-r && z<b.z2+r) return true;
  }
  return false;
}
function mover(pos,dx,dz,r){
  const nx = pos.x+dx; if(!colide(nx,pos.z,r)) pos.x = nx;
  const nz = pos.z+dz; if(!colide(pos.x,nz,r)) pos.z = nz;
  const LX = CFG.mapa.largura/2-2, LZ = CFG.mapa.fundo/2-2;
  pos.x = Math.max(-LX,Math.min(LX,pos.x));
  pos.z = Math.max(-LZ,Math.min(LZ,pos.z));
}

function timeDoJogador(){ return NET.team || 'aliado'; }

const _ray = new THREE.Raycaster();
const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3();
const _vOlho = new THREE.Vector3();
function visaoLivre(de, para){
  _v1.subVectors(para, de);
  const d = _v1.length();
  if(d < 0.4) return true;
  _v1.normalize(); _ray.set(de,_v1); _ray.far = d - 0.35;
  return _ray.intersectObjects(MUNDO.meshBlocos,false).length === 0;
}

/* =========== JOGADOR =========== */
const J = {
  pos:new THREE.Vector3(), vel:new THREE.Vector3(),
  yaw:0, pitch:0, vida:100, colete:100, vivo:true, tResp:0,
  noChao:true, agachado:false, arma:null, pente:0, reserva:0,
  tTiro:0, recarregando:false, tRec:0, coice:0, mirando:false, mira:0,
  kits:3, granadas:2, spawn:new THREE.Vector3(-46,1.72,0), balanco:0,
  spectando: null,
  spectandoNome: ''
};
const IN = {
  fre:0,tras:0,esq:0,dir:0, correndo:false, atirando:false, pulou:false,
  olhX:0, olhY:0
};
const POSE = {
  quadril : new THREE.Vector3( 0.215,-0.185,-0.40),
  mira    : new THREE.Vector3( 0.000,-0.10,-0.28)
};

/* ==========================================================
   MIRA DINAMICA
   ========================================================== */
const MIRA = {
  gapBase: 5,
  gapMax: 22,
  gap: 5,
  tiro: 0,
  alvo: false,
  _tCheck: 0,
  /* snap de mira: inimigo mais proximo dentro do cone apertado ao atirar */
  _alvoSnap: null,

  disparar(){
    this.tiro = Math.min(1, this.tiro + 0.7);
  },

  /* Chamado a cada frame enquanto IN.atirando=true e mira vermelha (alvo=true) */
  aplicarSnap(dt){
    if (!this.alvo || !this._alvoSnap || !cam || !J.vivo || !S.ativa) return;
    const alvoPos = this._alvoSnap;
    const dirAlvo = new THREE.Vector3().subVectors(alvoPos, cam.position).normalize();
    const snapYaw   = Math.atan2(-dirAlvo.x, -dirAlvo.z);
    const snapPitch = Math.asin(Math.max(-1, Math.min(1, dirAlvo.y)));
    let dYaw = snapYaw - J.yaw;
    /* normaliza diferenca de yaw para [-PI, PI] */
    while (dYaw >  Math.PI) dYaw -= Math.PI * 2;
    while (dYaw < -Math.PI) dYaw += Math.PI * 2;
    const dPitch = snapPitch - J.pitch;
    /* velocidade: solta=sem snap, normal=leve, precisa=forte */
    const modo = (typeof OPC !== 'undefined' ? OPC.modoMira : 'normal') || 'normal';
    if (modo === 'solta') return;
    const velocidade = modo === 'precisa' ? Math.min(1, dt * 22) : Math.min(1, dt * 8);
    J.yaw   += dYaw   * velocidade;
    J.pitch += dPitch * velocidade;
    J.pitch = Math.max(-1.46, Math.min(1.46, J.pitch));
  },

  update(dt){
    const alvo = this.gapBase
      + (this.alvo ? 7 : 0)
      + this.tiro * (this.gapMax - this.gapBase);
    this.gap += (alvo - this.gap) * Math.min(1, dt * 11);
    this.tiro = Math.max(0, this.tiro - dt * 4);
    const m = document.getElementById('mira');
    if(m){
      m.style.setProperty('--gap', this.gap.toFixed(2) + 'px');
      if(this.alvo){
        m.classList.add('miraNoinimigo');
      } else {
        m.classList.remove('miraNoinimigo');
      }
    }
    /* snap continuo: gruda a mira no inimigo enquanto esta atirando e mira vermelha */
    if(IN.atirando && this.alvo && J.vivo && !J.recarregando && !TRAVADO) this.aplicarSnap(dt);
  },

  checkAlvo(){
    if (!S.ativa || !J.vivo) { this.alvo = false; this._alvoSnap = null; return; }
    const meuTime = timeDoJogador();
    const pos = cam.position;
    const dir = new THREE.Vector3();
    cam.getWorldDirection(dir);

    /* Monta lista de hitboxes inimigas (igual ao sistema de tiro) */
    const hitboxes = [];
    for (const b of S.bots){
      if (b.vivo && b.time !== meuTime && b.hbCorpo)
        hitboxes.push({ mesh: b.hbCorpo, centro: b.grupo.position },
                      { mesh: b.hbCabeca, centro: b.grupo.position });
    }
    for (const r of NET.remotos.values()){
      if (r.bot && r.bot.vivo && r.team !== NET.team && r.bot.hbCorpo)
        hitboxes.push({ mesh: r.bot.hbCorpo, centro: r.bot.grupo.position },
                      { mesh: r.bot.hbCabeca, centro: r.bot.grupo.position });
    }

    this.alvo = false;
    this._alvoSnap = null;
    if (hitboxes.length === 0) return;

    /* Raycast direto: so fica vermelho se o raio bater NA hitbox do inimigo */
    _ray.set(pos, dir);
    _ray.far = 200;
    const meshes = hitboxes.map(h => h.mesh).filter(Boolean);
    const hits = _ray.intersectObjects(meshes, false);
    if (hits.length > 0){
      this.alvo = true;
      /* Para o snap: pega o centro do bot acertado */
      const hitMesh = hits[0].object;
      const entrada = hitboxes.find(h => h.mesh === hitMesh);
      if (entrada) this._alvoSnap = entrada.centro.clone().add(new THREE.Vector3(0, 0.9, 0));
    }
  }
};

/* =================================================================
   SISTEMA DE PARTÍCULAS 3D — RAJADA VFX ENGINE
   -----------------------------------------------------------------
   Pool de partículas reutilizáveis, física real, iluminação
   dinâmica, rastros de bala, debris sólidos, fumaça volumétrica.
   ================================================================= */
const VFX = (() => {
  /* --- Pool de partículas --- */
  const POOL_MAX = 512;
  const pool     = [];       /* partículas livres */
  const ativos   = [];       /* partículas em uso */

  /* Geometrias e materiais compartilhados */
  const _geoSfera   = new THREE.SphereGeometry(1, 5, 4);
  const _geoCubo    = new THREE.BoxGeometry(1, 1, 1);
  const _geoCilindro= new THREE.CylinderGeometry(0.5, 0.5, 1, 5);
  const _geoCone    = new THREE.ConeGeometry(0.5, 1, 5);

  function alocar(){
    if (pool.length > 0) return pool.pop();
    if (ativos.length >= POOL_MAX) return null;
    return {
      mesh: null, vel: new THREE.Vector3(), acc: new THREE.Vector3(),
      vida: 0, vidaMax: 1, cor: new THREE.Color(),
      escalaIni: 1, escalaFim: 0, opacIni: 1, opacFim: 0,
      gravidade: 0, bounce: 0, solo: false, rotVel: 0,
      emissivo: false, tipo: 'sfera'
    };
  }

  function devolver(p){
    if (p.mesh){
      if (p.mesh.parent) p.mesh.parent.remove(p.mesh);
      /* reseta para reutilização */
      p.mesh.visible = false;
    }
    const i = ativos.indexOf(p);
    if (i >= 0) ativos.splice(i, 1);
    pool.push(p);
  }

  /* Cria mesh sob demanda, reutilizando o mesmo objeto quando possível */
  function garantirMesh(p, geo, corHex, emissivo){
    if (!p.mesh){
      const mat = new THREE.MeshStandardMaterial({
        color: corHex,
        emissive: emissivo ? new THREE.Color(corHex) : new THREE.Color(0x000000),
        emissiveIntensity: emissivo ? 0.8 : 0,
        roughness: 0.7, metalness: 0.3,
        transparent: true, opacity: 1,
        depthWrite: false
      });
      p.mesh = new THREE.Mesh(geo, mat.clone());
      p.mesh.renderOrder = 998;
      p.mesh.castShadow = false;
    }
    p.mesh.material.color.setHex(corHex);
    if (emissivo){
      p.mesh.material.emissive.setHex(corHex);
      p.mesh.material.emissiveIntensity = 0.9;
    } else {
      p.mesh.material.emissiveIntensity = 0;
    }
    p.mesh.material.opacity = 1;
    p.mesh.visible = true;
    return p.mesh;
  }

  function spawn(opt){
    const p = alocar(); if (!p) return;
    const tipo = opt.tipo || 'sfera';
    const geo  = tipo === 'cubo'     ? _geoCubo
               : tipo === 'cilindro' ? _geoCilindro
               : tipo === 'cone'     ? _geoCone
               : _geoSfera;
    garantirMesh(p, geo, opt.cor || 0xffffff, opt.emissivo !== false);
    p.mesh.position.copy(opt.pos);
    const escala = opt.escala || 0.05;
    p.mesh.scale.setScalar(escala);
    p.escalaIni = escala;
    p.escalaFim = opt.escalaFim != null ? opt.escalaFim : 0;
    p.opacIni   = opt.opacIni  != null ? opt.opacIni   : 1;
    p.opacFim   = opt.opacFim  != null ? opt.opacFim   : 0;
    p.vel.copy(opt.vel || new THREE.Vector3());
    p.acc.set(0, opt.gravidade != null ? opt.gravidade : -9.8, 0);
    p.vida    = 0;
    p.vidaMax = opt.dur || 0.6;
    p.gravidade = opt.gravidade != null ? opt.gravidade : -9.8;
    p.bounce  = opt.bounce || 0;
    p.solo    = false;
    p.rotVel  = opt.rotVel != null ? opt.rotVel : (Math.random() - 0.5) * 12;
    p.cor.setHex(opt.cor || 0xffffff);
    p.emissivo = opt.emissivo !== false;
    p.tipo = tipo;
    if (cena && p.mesh && !p.mesh.parent) cena.add(p.mesh);
    ativos.push(p);
  }

  function tick(dt){
    for (let i = ativos.length - 1; i >= 0; i--){
      const p = ativos[i];
      p.vida += dt;
      const t = Math.min(1, p.vida / p.vidaMax);
      if (t >= 1){ devolver(p); continue; }

      /* física */
      p.vel.x += p.acc.x * dt;
      p.vel.y += p.acc.y * dt;
      p.vel.z += p.acc.z * dt;
      p.vel.x *= (1 - 2.5 * dt); /* arrasto do ar */
      p.vel.z *= (1 - 2.5 * dt);
      p.mesh.position.x += p.vel.x * dt;
      p.mesh.position.y += p.vel.y * dt;
      p.mesh.position.z += p.vel.z * dt;
      /* bounce no chão */
      if (p.bounce > 0 && p.mesh.position.y <= 0.04 && !p.solo){
        p.mesh.position.y = 0.04;
        if (Math.abs(p.vel.y) < 0.8){ p.solo = true; p.vel.set(0,0,0); }
        else { p.vel.y *= -p.bounce; p.vel.x *= 0.6; p.vel.z *= 0.6; }
      }
      /* rotação */
      p.mesh.rotation.x += p.rotVel * dt;
      p.mesh.rotation.z += p.rotVel * 0.7 * dt;

      /* interpolação visual */
      const escala = p.escalaIni + (p.escalaFim - p.escalaIni) * t;
      p.mesh.scale.setScalar(Math.max(0.001, escala));
      const opac  = p.opacIni  + (p.opacFim  - p.opacIni)  * t;
      p.mesh.material.opacity = Math.max(0, opac);
      /* escurece progressivamente a emissão */
      if (p.emissivo) p.mesh.material.emissiveIntensity = 0.9 * (1 - t);
    }
  }

  /* ---------- Emissores de alto nível ---------- */

  /* Luz dinâmica temporária */
  const _luzPool = [];
  function luzTemp(pos, cor, intens, raio, dur){
    let luz;
    if (_luzPool.length > 0){
      luz = _luzPool.pop();
    } else {
      luz = new THREE.PointLight(cor, intens, raio, 2);
    }
    luz.color.setHex(cor);
    luz.intensity = intens;
    luz.distance  = raio;
    luz.position.copy(pos);
    if (cena) cena.add(luz);
    const t0 = performance.now();
    const fade = () => {
      const t = (performance.now() - t0) / (dur * 1000);
      if (t >= 1){
        luz.intensity = 0;
        if (luz.parent) luz.parent.remove(luz);
        _luzPool.push(luz);
        return;
      }
      luz.intensity = intens * (1 - t * t);
      requestAnimationFrame(fade);
    };
    requestAnimationFrame(fade);
  }

  /* Tracer de bala: linha fina luminosa */
  function tracer(de, para, cor){
    if (!cena) return;
    const dir = new THREE.Vector3().subVectors(para, de);
    const dist = dir.length();
    if (dist < 0.1) return;
    const mat = new THREE.MeshBasicMaterial({
      color: cor, transparent: true, opacity: 0.7,
      depthWrite: false
    });
    const geo = new THREE.CylinderGeometry(0.004, 0.004, Math.min(dist, 18), 4);
    const m = new THREE.Mesh(geo, mat);
    const meio = new THREE.Vector3().addVectors(de, para).multiplyScalar(0.5);
    m.position.copy(meio);
    m.lookAt(para);
    m.rotateX(Math.PI / 2);
    m.renderOrder = 997;
    cena.add(m);
    const t0 = performance.now();
    const fade = () => {
      const t = (performance.now() - t0) / 80;
      if (t >= 1){ cena.remove(m); geo.dispose(); mat.dispose(); return; }
      mat.opacity = 0.7 * (1 - t);
      requestAnimationFrame(fade);
    };
    requestAnimationFrame(fade);
  }

  /* Anel de onda de choque */
  function ondaChoque(pos, cor, raioFim, dur){
    if (!cena) return;
    const geo = new THREE.TorusGeometry(1, 0.04, 6, 28);
    const mat = new THREE.MeshBasicMaterial({
      color: cor, transparent: true, opacity: 0.85, depthWrite: false
    });
    const m = new THREE.Mesh(geo, mat);
    m.position.copy(pos);
    m.position.y += 0.15;
    m.rotation.x = Math.PI / 2;
    m.renderOrder = 996;
    cena.add(m);
    const t0 = performance.now();
    const animar = () => {
      const t = Math.min(1, (performance.now() - t0) / (dur * 1000));
      if (t >= 1){ cena.remove(m); geo.dispose(); mat.dispose(); return; }
      const ease = 1 - (1 - t) * (1 - t); /* ease-out */
      m.scale.setScalar(ease * raioFim);
      mat.opacity = 0.85 * (1 - t * t);
      requestAnimationFrame(animar);
    };
    requestAnimationFrame(animar);
  }

  /* ========================
     EFEITOS PRONTOS
     ======================== */

  /* Flash de boca (muzzle flash) — chamado na ponta da arma */
  function muzzleFlash(pos, cor){
    cor = cor || 0xffdd88;
    /* bola central brilhante */
    for(let i = 0; i < 3; i++){
      spawn({
        pos, cor,
        escala: 0.04 + Math.random() * 0.06,
        escalaFim: 0.12 + Math.random() * 0.05,
        opacIni: 1, opacFim: 0,
        vel: new THREE.Vector3(
          (Math.random()-0.5)*0.5,
          (Math.random()-0.5)*0.5,
          -(Math.random() * 0.4 + 0.1)
        ),
        gravidade: 0, dur: 0.055 + Math.random()*0.03,
        emissivo: true, tipo: 'sfera', rotVel: 0
      });
    }
    /* faíscas quentes */
    for(let i = 0; i < 8; i++){
      const ang = Math.random() * Math.PI * 2;
      const f   = 1.8 + Math.random() * 3.2;
      spawn({
        pos,
        cor: Math.random() < 0.5 ? 0xffcc44 : 0xff8811,
        escala: 0.012 + Math.random() * 0.018,
        escalaFim: 0,
        opacIni: 1, opacFim: 0,
        vel: new THREE.Vector3(
          Math.cos(ang) * f * 0.2,
          (Math.random() * 0.5) * f * 0.2,
          -(Math.random() * 0.6 + 0.05)
        ),
        gravidade: -6, dur: 0.08 + Math.random() * 0.06,
        emissivo: true, tipo: 'sfera', bounce: 0.3
      });
    }
    luzTemp(pos, cor, 3.5, 2.8, 0.07);
  }

  /* Impacto em parede: lascas + poeira + cratêra */
  function impactoParede(pos, normalVec, cor){
    cor = cor || 0xb0a898;
    const n = normalVec || new THREE.Vector3(0, 0, 1);
    /* lascas de concreto/metal */
    for(let i = 0; i < 14; i++){
      const a = Math.random() * Math.PI * 2;
      const f = 2.5 + Math.random() * 5.0;
      const perp1 = new THREE.Vector3(n.z, 0, -n.x).normalize();
      const perp2 = new THREE.Vector3().crossVectors(n, perp1).normalize();
      spawn({
        pos: pos.clone().addScaledVector(n, 0.04),
        cor: i % 3 === 0 ? 0x888888 : cor,
        escala: 0.02 + Math.random() * 0.04,
        escalaFim: 0,
        opacIni: 1, opacFim: 0,
        vel: new THREE.Vector3(
          (n.x + perp1.x*(Math.random()-0.5)*2 + perp2.x*(Math.random()-0.5)*2) * f * 0.3,
          (0.4 + Math.random() * 0.8) * f * 0.3,
          (n.z + perp1.z*(Math.random()-0.5)*2 + perp2.z*(Math.random()-0.5)*2) * f * 0.3
        ),
        gravidade: -16, dur: 0.25 + Math.random() * 0.35,
        emissivo: false, tipo: Math.random()<0.4?'cubo':'sfera',
        bounce: 0.28
      });
    }
    /* nuvem de pó volumétrica */
    for(let i = 0; i < 6; i++){
      spawn({
        pos: pos.clone().addScaledVector(n, 0.06),
        cor: 0xd8d0c4,
        escala: 0.03,
        escalaFim: 0.22 + Math.random() * 0.18,
        opacIni: 0.6, opacFim: 0,
        vel: new THREE.Vector3(
          n.x * 0.4 + (Math.random()-0.5) * 0.8,
          0.15 + Math.random() * 0.4,
          n.z * 0.4 + (Math.random()-0.5) * 0.8
        ),
        gravidade: -1.5, dur: 0.35 + Math.random() * 0.3,
        emissivo: false, tipo: 'sfera', rotVel: (Math.random()-0.5)*3
      });
    }
    /* flash de impacto */
    luzTemp(pos, 0xffeebb, 1.6, 1.2, 0.04);
  }

  /* Impacto em corpo: sangue + spray */
  function impactoCorpo(pos, cabeca){
    const n = cabeca ? 16 : 10;
    const corBase = 0xcc1111;
    for(let i = 0; i < n; i++){
      const a = Math.random() * Math.PI * 2;
      const f = 1.5 + Math.random() * (cabeca ? 5.5 : 3.5);
      spawn({
        pos: pos.clone(),
        cor: Math.random() < 0.6 ? corBase : 0x991111,
        escala: 0.016 + Math.random() * (cabeca ? 0.032 : 0.022),
        escalaFim: 0,
        opacIni: 1, opacFim: 0,
        vel: new THREE.Vector3(
          Math.cos(a) * f * 0.3,
          (0.3 + Math.random() * 0.9) * f * 0.3,
          Math.sin(a) * f * 0.3
        ),
        gravidade: -18, dur: 0.18 + Math.random() * 0.22,
        emissivo: false, tipo: 'sfera', bounce: 0
      });
    }
    /* gotículas */
    for(let i = 0; i < (cabeca ? 8 : 4); i++){
      spawn({
        pos: pos.clone(),
        cor: 0x880000,
        escala: 0.008 + Math.random() * 0.012,
        escalaFim: 0,
        opacIni: 0.9, opacFim: 0,
        vel: new THREE.Vector3(
          (Math.random()-0.5)*5,
          Math.random() * 3,
          (Math.random()-0.5)*5
        ),
        gravidade: -22, dur: 0.28 + Math.random() * 0.2,
        emissivo: false, tipo: 'sfera', bounce: 0.15
      });
    }
  }

  /* Explosão completa de granada */
  function explosao(pos){
    const P = pos.clone();

    /* 1. Bola de fogo central — camadas */
    const camadas = [
      { cor:0xffffff, esc:0.12, escF:2.4,  dur:0.14, opI:1,   opF:0 },
      { cor:0xffee66, esc:0.08, escF:1.8,  dur:0.18, opI:1,   opF:0 },
      { cor:0xff8800, esc:0.06, escF:2.8,  dur:0.28, opI:0.9, opF:0 },
      { cor:0xff4400, esc:0.04, escF:3.2,  dur:0.38, opI:0.8, opF:0 },
    ];
    camadas.forEach(c => {
      spawn({
        pos: P.clone(), cor: c.cor,
        escala: c.esc, escalaFim: c.escF,
        opacIni: c.opI, opacFim: c.opF,
        vel: new THREE.Vector3(0,0,0),
        gravidade: 0, dur: c.dur,
        emissivo: true, tipo: 'sfera', rotVel: 0
      });
    });

    /* 2. Fumaça densa pós-explosão */
    for(let i = 0; i < 18; i++){
      const a = Math.random() * Math.PI * 2;
      const up = 1.2 + Math.random() * 2.8;
      const lat = Math.random() * 2.5;
      spawn({
        pos: P.clone().add(new THREE.Vector3(
          (Math.random()-0.5)*0.4,
          Math.random()*0.3,
          (Math.random()-0.5)*0.4
        )),
        cor: Math.random() < 0.5 ? 0x383838 : 0x4a4a4a,
        escala: 0.05,
        escalaFim: 1.4 + Math.random() * 1.2,
        opacIni: 0.75, opacFim: 0,
        vel: new THREE.Vector3(
          Math.cos(a) * lat,
          up,
          Math.sin(a) * lat
        ),
        gravidade: -0.4, dur: 1.4 + Math.random() * 1.2,
        emissivo: false, tipo: 'sfera', rotVel: (Math.random()-0.5)*1.5
      });
    }

    /* 3. Fragmentos metálicos brilhantes (shrapnel) */
    for(let i = 0; i < 28; i++){
      const a = Math.random() * Math.PI * 2;
      const inc = (Math.random()-0.5) * Math.PI;
      const f = 5.0 + Math.random() * 10.0;
      spawn({
        pos: P.clone(),
        cor: Math.random() < 0.5 ? 0xffcc44 : 0xff6600,
        escala: 0.018 + Math.random() * 0.030,
        escalaFim: 0,
        opacIni: 1, opacFim: 0,
        vel: new THREE.Vector3(
          Math.cos(a)*Math.cos(inc)*f,
          Math.sin(inc)*f + 2,
          Math.sin(a)*Math.cos(inc)*f
        ),
        gravidade: -20, dur: 0.45 + Math.random() * 0.55,
        emissivo: true, tipo: 'cubo', bounce: 0.35
      });
    }

    /* 4. Brasas / faíscas de longa duração */
    for(let i = 0; i < 22; i++){
      const a = Math.random() * Math.PI * 2;
      const f = 3.0 + Math.random() * 7.0;
      const inc = Math.random() * Math.PI * 0.5;
      spawn({
        pos: P.clone(),
        cor: Math.random() < 0.6 ? 0xff7700 : 0xffcc00,
        escala: 0.008 + Math.random() * 0.014,
        escalaFim: 0,
        opacIni: 1, opacFim: 0,
        vel: new THREE.Vector3(
          Math.cos(a)*f,
          Math.abs(Math.sin(inc))*f + 1.5,
          Math.sin(a)*f
        ),
        gravidade: -12, dur: 0.6 + Math.random() * 0.8,
        emissivo: true, tipo: 'sfera', bounce: 0.45
      });
    }

    /* 5. Debris sólidos (pedaços de chão/concreto) */
    for(let i = 0; i < 16; i++){
      const a = Math.random() * Math.PI * 2;
      const f = 2.5 + Math.random() * 6.0;
      spawn({
        pos: P.clone().add(new THREE.Vector3(0, 0.1, 0)),
        cor: Math.random() < 0.4 ? 0x787060 : 0x4a4540,
        escala: 0.03 + Math.random() * 0.07,
        escalaFim: 0,
        opacIni: 1, opacFim: 0,
        vel: new THREE.Vector3(
          Math.cos(a)*f,
          (1.5 + Math.random()*3) * f * 0.22,
          Math.sin(a)*f
        ),
        gravidade: -20, dur: 0.5 + Math.random() * 0.6,
        emissivo: false, tipo: 'cubo', bounce: 0.3
      });
    }

    /* 6. Ondas de choque no chão */
    ondaChoque(P, 0xff8800, 7.0, 0.28);
    setTimeout(() => ondaChoque(P, 0x444444, 5.5, 0.45), 60);

    /* 7. Luz de explosão super intensa */
    luzTemp(P, 0xff8800, 14, 18, 0.22);
    setTimeout(() => luzTemp(P, 0xff4400, 6, 12, 0.30), 80);
    setTimeout(() => luzTemp(P, 0x331100, 2, 8, 0.45), 200);
  }

  /* Faíscas genéricas de disparo de bot/remoto */
  function faiscaDisparo(pos, cor){
    cor = cor || 0xffcc44;
    for(let i = 0; i < 5; i++){
      const a = Math.random() * Math.PI * 2;
      spawn({
        pos,
        cor: Math.random() < 0.5 ? cor : 0xff8800,
        escala: 0.015 + Math.random() * 0.02,
        escalaFim: 0,
        opacIni: 1, opacFim: 0,
        vel: new THREE.Vector3(
          Math.cos(a)*1.5,
          0.3 + Math.random()*0.8,
          Math.sin(a)*1.5
        ),
        gravidade: -10, dur: 0.1 + Math.random() * 0.1,
        emissivo: true, tipo: 'sfera', bounce: 0
      });
    }
    luzTemp(pos, cor, 2.5, 2.0, 0.05);
  }

  return { spawn, tick, muzzleFlash, impactoParede, impactoCorpo,
           explosao, tracer, faiscaDisparo, luzTemp };
})();

/* faisca() mantida como atalho retrocompatível — não usada internamente */
function faisca(pos, cor, forca, ms){
  /* redireciona para o VFX engine */
  if (forca > 8){
    VFX.explosao(pos);
  } else if (forca > 2.0){
    VFX.faiscaDisparo(pos, cor);
  } else {
    VFX.impactoParede(pos, new THREE.Vector3(0,0,1), cor);
  }
}

function aplicarTextura(obj, urlTex){
  if(!urlTex) return;
  const tex = new THREE.TextureLoader().load(urlTex, undefined, undefined, ()=>{});
  tex.colorSpace = THREE.SRGBColorSpace;
  obj.traverse(o => {
    if (o.isMesh && o.material) {
      if (Array.isArray(o.material))
        o.material.forEach(mt => { mt.map = tex; mt.needsUpdate = true; });
      else { o.material = o.material.clone(); o.material.map = tex; o.material.needsUpdate = true; }
    }
  });
}
async function montarArmaNaTela(){
  if(grupoArma){ cam.remove(grupoArma); grupoArma = null; }
  grupoArma = new THREE.Group();
  const a = J.arma;

  const modelo = await Modelos.carregar(MODELO_ARMA[a.id]);
  if (modelo && modelo.scene) {
    const m = Modelos.clonar(modelo.scene);
    m.updateMatrixWorld(true);

    const { tamanho, centro } = Modelos.medir(m);
    const maiorDim = Math.max(tamanho.x, tamanho.y, tamanho.z) || 1;

    const ajuste = AJUSTE_ARMA[a.id] || {
      tamanho:0.6, rotacao:[0,0,0], offset:[0,0,0], brilho:0
    };
    const escala = ajuste.tamanho / maiorDim;

    m.position.set(-centro.x, -centro.y, -centro.z);

    let temMapEmbutido = false;
    m.traverse(o => {
      if (o.isMesh && o.material) {
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        mats.forEach(mt => { if (mt.map) temMapEmbutido = true; });
      }
    });
    if (!temMapEmbutido) {
      aplicarTextura(m, TEXTURA_ARMA[a.id]);
    }
    Modelos.aplicarSombras(m);

    const brilho = ajuste.brilho ?? 0;
    if (!temMapEmbutido && brilho > 0) {
      m.traverse(o => {
        if (o.isMesh && o.material) {
          const mats = Array.isArray(o.material) ? o.material : [o.material];
          mats.forEach(mt => {
            mt.emissive = new THREE.Color(0xffffff);
            mt.emissiveIntensity = brilho * 0.35;
            mt.needsUpdate = true;
          });
        }
      });
    }

    m.traverse(o => { if (o.isMesh) o.renderOrder = 999; });

    const holder = new THREE.Group();
    holder.add(m);
    holder.scale.setScalar(escala);
    holder.rotation.set(ajuste.rotacao[0], ajuste.rotacao[1], ajuste.rotacao[2]);
    holder.position.set(ajuste.offset[0], ajuste.offset[1], ajuste.offset[2]);
    grupoArma.add(holder);

    if (!cam.getObjectByName('luzArma')) {
      const luzArma = new THREE.PointLight(0xffffff, 0.5, 2.5, 1.5);
      luzArma.name = 'luzArma';
      luzArma.position.set(0.35, 0.25, -0.05);
      cam.add(luzArma);
    }
  } else {
    const metal  = new THREE.MeshStandardMaterial({ color:0x8a9099, roughness:0.35, metalness:0.85 });
    const escuro = new THREE.MeshStandardMaterial({ color:0x2a2e36, roughness:0.5, metalness:0.7 });
    const det    = new THREE.MeshStandardMaterial({ color:0x5a6068, roughness:0.45, metalness:0.6 });
    const pele   = new THREE.MeshStandardMaterial({ color:0x9a6b4f, roughness:0.9 });

    if (a.melee) {
      const aco   = new THREE.MeshStandardMaterial({ color:0xd8dde3, roughness:0.18, metalness:0.95 });
      const acoS  = new THREE.MeshStandardMaterial({ color:0xb8c0c8, roughness:0.28, metalness:0.9 });
      const caboM = new THREE.MeshStandardMaterial({ color:0x1a1d22, roughness:0.85, metalness:0.15 });
      const detal = new THREE.MeshStandardMaterial({ color:0x3a3f48, roughness:0.5, metalness:0.6 });

      const mao1 = new THREE.Mesh(new THREE.BoxGeometry(0.085, 0.11, 0.13), pele);
      mao1.position.set(0, -0.005, 0.01); grupoArma.add(mao1);
      const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.017, 0.10, 10), caboM);
      grip.rotation.x = Math.PI/2;
      grip.position.set(0, 0, -0.025); grupoArma.add(grip);
      for (let i = 0; i < 4; i++){
        const anel = new THREE.Mesh(new THREE.TorusGeometry(0.017, 0.0018, 6, 12), detal);
        anel.position.set(0, 0, -0.055 + i*0.018);
        grupoArma.add(anel);
      }
      const guarda = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.012, 0.028), detal);
      guarda.position.set(0, 0.008, -0.075); grupoArma.add(guarda);
      const lamina = new THREE.Mesh(new THREE.BoxGeometry(0.014, 0.30, 0.045), aco);
      lamina.position.set(0, 0.165, -0.115);
      lamina.rotation.x = -0.08;
      grupoArma.add(lamina);
      const fio = new THREE.Mesh(new THREE.BoxGeometry(0.004, 0.30, 0.012), acoS);
      fio.position.set(0.0055, 0.165, -0.135);
      fio.rotation.x = -0.08;
      grupoArma.add(fio);
      const ponta = new THREE.Mesh(new THREE.ConeGeometry(0.024, 0.075, 4), aco);
      ponta.rotation.x = Math.PI/2 + 0.15;
      ponta.position.set(0, 0.32, -0.125);
      grupoArma.add(ponta);
      for (let i = 0; i < 5; i++){
        const dente = new THREE.Mesh(new THREE.BoxGeometry(0.004, 0.008, 0.01), acoS);
        dente.position.set(-0.0075, 0.11 + i*0.05, -0.115);
        dente.rotation.x = -0.08;
        grupoArma.add(dente);
      }
    } else {
      /* ---- comprimento base por tipo de arma ---- */
      const longo = a.id==='sniper' || a.id==='barrett' ? 0.95
                  : a.id==='smg' || a.id==='mp5' || a.id==='ump'
                    || a.id==='uzi' || a.id==='submachine' || a.id==='mp40' ? 0.44
                  : a.id==='lmg' ? 0.72
                  : 0.62;

      const temLuneta      = a.id==='sniper' || a.id==='barrett';
      const temBipode      = a.id==='barrett' || a.id==='lmg';
      const temCulatra     = a.id==='ak47' || a.id==='scar';
      const temSilenciador = a.id==='m4a1' || a.id==='mp5';

      /* ---- PISTOLA ---- */
      if(a.id === 'pistola'){
        const corpo = new THREE.Mesh(new THREE.BoxGeometry(0.062, 0.115, 0.185), metal);
        corpo.position.set(0, -0.01, -0.09); grupoArma.add(corpo);
        const cano = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.18, 10), escuro);
        cano.rotation.x = Math.PI/2;
        cano.position.set(0, 0.028, -0.15); grupoArma.add(cano);
        const cabo = new THREE.Mesh(new THREE.BoxGeometry(0.058, 0.13, 0.072), det);
        cabo.position.set(0, -0.115, -0.03); grupoArma.add(cabo);
        const gatilho = new THREE.Mesh(new THREE.BoxGeometry(0.014, 0.038, 0.022), escuro);
        gatilho.position.set(0, -0.055, -0.075); grupoArma.add(gatilho);
        const mao1 = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.095, 0.1), pele);
        mao1.position.set(0.01, -0.11, -0.03); grupoArma.add(mao1);

      /* ---- REVÓLVER ---- */
      } else if(a.id === 'revolver'){
        const corpo = new THREE.Mesh(new THREE.BoxGeometry(0.068, 0.11, 0.22), metal);
        corpo.position.set(0, 0.01, -0.1); grupoArma.add(corpo);
        const cano = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.28, 10), escuro);
        cano.rotation.x = Math.PI/2;
        cano.position.set(0, 0.042, -0.17); grupoArma.add(cano);
        /* tambor */
        const tambor = new THREE.Mesh(new THREE.CylinderGeometry(0.048, 0.048, 0.058, 12), det);
        tambor.rotation.x = Math.PI/2;
        tambor.position.set(0, 0.0, -0.092); grupoArma.add(tambor);
        for(let i = 0; i < 6; i++){
          const ang = (i / 6) * Math.PI * 2;
          const furo = new THREE.Mesh(new THREE.CylinderGeometry(0.013, 0.013, 0.062, 8), escuro);
          furo.rotation.x = Math.PI/2;
          furo.position.set(Math.cos(ang)*0.028, Math.sin(ang)*0.028, -0.092);
          grupoArma.add(furo);
        }
        const cabo = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.145, 0.082), det);
        cabo.rotation.z = 0.18;
        cabo.position.set(0, -0.108, -0.015); grupoArma.add(cabo);
        const mao1 = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.1, 0.1), pele);
        mao1.position.set(0.01, -0.11, -0.02); grupoArma.add(mao1);

      /* ---- DUPLA CANO (escopeta) ---- */
      } else if(a.id === 'dupla'){
        const corpo = new THREE.Mesh(new THREE.BoxGeometry(0.088, 0.1, 0.52), metal);
        corpo.position.set(0, -0.01, -0.24); grupoArma.add(corpo);
        /* dois canos paralelos */
        const cano1 = new THREE.Mesh(new THREE.CylinderGeometry(0.017, 0.017, 0.62, 10), escuro);
        cano1.rotation.x = Math.PI/2;
        cano1.position.set( 0.022, 0.022, -0.47); grupoArma.add(cano1);
        const cano2 = new THREE.Mesh(new THREE.CylinderGeometry(0.017, 0.017, 0.62, 10), escuro);
        cano2.rotation.x = Math.PI/2;
        cano2.position.set(-0.022, 0.022, -0.47); grupoArma.add(cano2);
        const coronha = new THREE.Mesh(new THREE.BoxGeometry(0.082, 0.105, 0.26), det);
        coronha.position.set(0, -0.02, 0.16); grupoArma.add(coronha);
        const guardaMao = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.062, 0.19), escuro);
        guardaMao.position.set(0, -0.055, -0.27); grupoArma.add(guardaMao);
        const mao1 = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.1, 0.12), pele);
        mao1.position.set(0.02, -0.12, -0.35); grupoArma.add(mao1);
        const mao2 = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.1, 0.12), pele);
        mao2.position.set(-0.01, -0.1, -0.06); grupoArma.add(mao2);

      /* ---- ARMAS GENÉRICAS (rifle/carabina/lmg/etc.) ---- */
      } else {
        const corpo = new THREE.Mesh(new THREE.BoxGeometry(0.11,0.14,longo), metal);
        corpo.position.set(0,-0.02,-longo/2+0.04); grupoArma.add(corpo);
        const cano = new THREE.Mesh(new THREE.CylinderGeometry(0.021,0.021, longo*0.72, 10), escuro);
        cano.rotation.x = Math.PI/2;
        cano.position.set(0,0.012,-longo-0.1); grupoArma.add(cano);
        if(temSilenciador){
          const sil = new THREE.Mesh(new THREE.CylinderGeometry(0.028,0.028,0.14,10), escuro);
          sil.rotation.x = Math.PI/2;
          sil.position.set(0,0.012,-longo-0.26); grupoArma.add(sil);
        }
        if(temCulatra){
          const cul = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.16, 0.1), det);
          cul.position.set(0,-0.01, 0.08); grupoArma.add(cul);
        }
        const penteM = new THREE.Mesh(new THREE.BoxGeometry(0.075,0.21,0.1), escuro);
        penteM.position.set(0,-0.16,-longo*0.34); grupoArma.add(penteM);
        const coronha = new THREE.Mesh(new THREE.BoxGeometry(0.095,0.12,0.27), det);
        coronha.position.set(0,-0.03,0.17); grupoArma.add(coronha);
        const miraT = new THREE.Group();
        const base = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.008, 0.035), det);
        base.position.set(0, 0.054, -0.15); miraT.add(base);
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.005, 0.018, 0.005), escuro);
        post.position.set(0, 0.067, -0.15); miraT.add(post);
        grupoArma.add(miraT);
        if(temLuneta){
          const luneta = new THREE.Mesh(new THREE.CylinderGeometry(0.038,0.038,0.32,12), escuro);
          luneta.rotation.x = Math.PI/2;
          luneta.position.set(0,0.115,-0.24); grupoArma.add(luneta);
        }
        if(temBipode){
          const bp1 = new THREE.Mesh(new THREE.BoxGeometry(0.008,0.095,0.012), escuro);
          bp1.position.set( 0.028,-0.09,-longo+0.1); grupoArma.add(bp1);
          const bp2 = new THREE.Mesh(new THREE.BoxGeometry(0.008,0.095,0.012), escuro);
          bp2.position.set(-0.028,-0.09,-longo+0.1); grupoArma.add(bp2);
        }
        const mao1g = new THREE.Mesh(new THREE.BoxGeometry(0.08,0.1,0.12), pele);
        mao1g.position.set(0.02,-0.12,-longo*0.7); grupoArma.add(mao1g);
        const mao2g = new THREE.Mesh(new THREE.BoxGeometry(0.08,0.1,0.12), pele);
        mao2g.position.set(-0.01,-0.11,-0.06); grupoArma.add(mao2g);
      } /* fecha else generico */
    }
  }

  grupoArma.traverse(o => {
    if (o.isMesh) {
      o.renderOrder = 999;
      if (o.material) {
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        mats.forEach(mt => { mt.depthTest = false; mt.depthWrite = false; });
      }
    }
  });
  cam.add(grupoArma);
  if(!cena.children.includes(cam)) cena.add(cam);
}
function animarDanoPlayer(){
  if (!grupoArma) return;
  const p0 = grupoArma.position.clone();
  grupoArma.position.y += 0.06;
  grupoArma.rotation.z += 0.18;
  setTimeout(()=> { if (grupoArma) { grupoArma.position.copy(p0); grupoArma.rotation.z = 0; } }, 120);
}

function aplicarCamEspectador(dt){
  const alvo = J.spectando;
  if (!alvo || !alvo.grupo || !alvo.grupo.visible){
    J.spectando = null;
    return;
  }
  const p = alvo.grupo.position;
  const ang = (typeof alvo.yaw === 'number') ? alvo.yaw : 0;
  const dist = CFG.killcam.distancia;
  const alt  = CFG.killcam.altura;
  const suav = CFG.killcam.suavidade;

  const tx = p.x - Math.sin(ang) * dist;
  const tz = p.z - Math.cos(ang) * dist;
  const ty = p.y + alt;

  cam.position.x += (tx - cam.position.x) * Math.min(1, dt * suav);
  cam.position.y += (ty - cam.position.y) * Math.min(1, dt * suav);
  cam.position.z += (tz - cam.position.z) * Math.min(1, dt * suav);

  cam.rotation.order = 'YXZ';
  const dx = p.x - cam.position.x;
  const dy = (p.y + 1.4) - cam.position.y;
  const dz = p.z - cam.position.z;
  const lookYaw = Math.atan2(-dx, -dz);
  const lookPitch = Math.atan2(dy, Math.hypot(dx, dz));

  let dY = lookYaw - cam.rotation.y;
  while(dY >  Math.PI) dY -= Math.PI*2;
  while(dY < -Math.PI) dY += Math.PI*2;

  cam.rotation.y += dY * Math.min(1, dt * suav);
  cam.rotation.x += (lookPitch - cam.rotation.x) * Math.min(1, dt * suav);
}

function atualizarJogador(dt){
  if(!J.vivo){
    J.tResp -= dt;
    const rn = el('respNum'); if(rn) rn.textContent = Math.max(0, Math.ceil(J.tResp));
    aplicarCamEspectador(dt);
    if(J.tResp <= 0) renascerJogador();
    return;
  }
  const sensBase = (P.sens/100) * 0.0021;
  const sens = J.mira > 0.5 && !J.arma.melee ? sensBase * (P.sensMira/100) : sensBase;
  J.yaw -= IN.olhX * sens; J.pitch -= IN.olhY * sens;
  J.pitch = Math.max(-1.46, Math.min(1.46, J.pitch));
  IN.olhX = 0; IN.olhY = 0;
  if(J.coice > 0){
    J.coice *= Math.max(0, 1 - dt * 10);
    if(J.coice < 0.0004) J.coice = 0;
  }
  const alvoMira = (J.mirando && !J.arma.melee) ? 1 : 0;
  J.mira += (alvoMira - J.mira) * Math.min(1, dt*11);
  const fovAlvo = P.fov * (1 - (1-J.arma.zoom) * J.mira);
  if(Math.abs(cam.fov - fovAlvo) > 0.05){
    cam.fov = cam.fov + (fovAlvo - cam.fov) * Math.min(1, dt*11);
    cam.updateProjectionMatrix();
  }
  const mirEl = el('mira');
  if(mirEl) mirEl.style.opacity = (J.arma.melee) ? 0.35 : (1 - J.mira*0.95);
  const fre = _v1.set(-Math.sin(J.yaw),0,-Math.cos(J.yaw));
  const lad = _v2.set( Math.cos(J.yaw),0,-Math.sin(J.yaw));
  const mv = new THREE.Vector3();
  if(IN.fre)  mv.add(fre); if(IN.tras) mv.sub(fre);
  if(IN.dir)  mv.add(lad); if(IN.esq)  mv.sub(lad);
  let vel = CFG.jogador.velocidade;
  if(J.agachado) vel *= CFG.jogador.velAgachado;
  if(J.mira > 0.3) vel = CFG.jogador.velMira + (CFG.jogador.velocidade-CFG.jogador.velMira)*(1-J.mira);
  else if(IN.correndo && IN.fre && !J.agachado) vel = CFG.jogador.velCorrida;
  const andando = mv.lengthSq() > 0;
  if(andando){ mv.normalize(); mover(J.pos, mv.x*vel*dt, mv.z*vel*dt, 0.42); }
  if(IN.pulou && J.noChao && !J.agachado){ J.vel.y = CFG.jogador.pulo; J.noChao = false; }
  IN.pulou = false;
  const alturaAlvo = J.agachado ? CFG.jogador.alturaAgachado : CFG.jogador.altura;
  if (J.noChao) {
    const diff = alturaAlvo - J.pos.y;
    J.pos.y += diff * Math.min(1, dt * 14);
    if (Math.abs(diff) < 0.01) J.pos.y = alturaAlvo;
    J.vel.y = 0;
  } else {
    J.vel.y -= CFG.jogador.gravidade*dt;
    J.pos.y += J.vel.y*dt;
    if(J.pos.y <= alturaAlvo){ J.pos.y = alturaAlvo; J.vel.y = 0; J.noChao = true; }
  }
  cam.position.copy(J.pos);
  cam.rotation.order = 'YXZ';
  cam.rotation.y = J.yaw; cam.rotation.x = J.pitch;
  if(grupoArma){
    J.balanco += dt * (andando ? (IN.correndo?13:9) : 0);
    const amp = (1-J.mira) * (IN.correndo?0.03:0.016) * (andando?1:0);
    const px = POSE.quadril.x + (POSE.mira.x - POSE.quadril.x)*J.mira;
    const py = POSE.quadril.y + (POSE.mira.y - POSE.quadril.y)*J.mira;
    const pz = POSE.quadril.z + (POSE.mira.z - POSE.quadril.z)*J.mira;
    const extraZ = J.mira * 0.02;
    grupoArma.position.set(
      px + Math.sin(J.balanco)*amp,
      py + Math.abs(Math.cos(J.balanco))*amp*0.8,
      pz + J.coice*1.5 + extraZ
    );
    grupoArma.rotation.z = (1-J.mira) * Math.sin(J.balanco*0.5)*0.02;
  }
  if(J.recarregando){
    J.tRec -= dt;
    if(grupoArma && !J.arma.melee){
      const passado = J.arma.recarga - J.tRec;
      const durAnim = 0.38;
      const tAnim = Math.min(1, passado / durAnim);

      let dip;
      if (tAnim < 0.4)       dip = tAnim / 0.4;
      else if (tAnim < 0.55) dip = 1;
      else                   dip = Math.max(0, (1 - tAnim) / 0.45);
      dip = Math.max(0, Math.min(1, dip));
      dip = dip * dip * (3 - 2 * dip);

      grupoArma.rotation.x = -dip * 0.75;
      grupoArma.rotation.z += dip * 0.20;
      grupoArma.position.y -= dip * 0.055;
      grupoArma.position.x += dip * 0.025;
    }
    if(J.tRec <= 0){
      const falta = J.arma.pente - J.pente;
      const usa = Math.min(falta, J.reserva);
      J.pente += usa; J.reserva -= usa;
      J.recarregando = false;
      if(grupoArma) grupoArma.rotation.x = 0;
      pintarMunicao();
    }
  }
  J.tTiro -= dt;
  /* Tiro automático: só dispara se a mira estiver vermelha (sobre inimigo) agora */
  if(OPC.tiroAuto && MIRA.alvo && J.vivo && S.ativa && !J.recarregando && !TRAVADO && !J.arma.melee){
    IN.atirando = true;
  }
  if(IN.atirando && !J.recarregando && J.tTiro <= 0) atirar();
}
function atirar(){
  if (TRAVADO || !S.ativa || S.fim) return;
  if (J.arma.melee) {
    J.tTiro = J.arma.cadencia;
    AUDIO.play('faca');
    if (grupoArma) {
      grupoArma.position.z -= 0.3;
      grupoArma.rotation.x -= 0.5;
      setTimeout(() => { if(grupoArma){ grupoArma.position.z += 0.3; grupoArma.rotation.x += 0.5; } }, 100);
    }
  } else {
    if(J.pente <= 0){ recarregar(); return; }
    J.pente--; J.tTiro = J.arma.cadencia;
    AUDIO.play('tiro'); pintarMunicao();
    MIRA.disparar();
    J.coice += J.arma.coice * (1 - J.mira*0.35);
  }
  const dir = new THREE.Vector3();
  cam.getWorldDirection(dir);
  if (!J.arma.melee) {
    let esp = J.arma.espalha + (J.arma.espalhaMira - J.arma.espalha) * J.mira;
    if(IN.correndo && J.mira < 0.3) esp *= 2.4;
    if(!J.noChao) esp *= 1.7;
    dir.x += (Math.random()-0.5)*esp;
    dir.y += (Math.random()-0.5)*esp;
    dir.z += (Math.random()-0.5)*esp;
    dir.normalize();
  }
  _ray.set(cam.position, dir);
  _ray.far = J.arma.alcance;
  const alvos = [];
  const meuTime = timeDoJogador();

  for(const b of S.bots){
    if(b.vivo && b.time !== meuTime) alvos.push(b.hbCorpo, b.hbCabeca);
  }
  for (const r of NET.remotos.values()){
    if (r.bot && r.bot.vivo && r.team !== NET.team && r.bot.hbCorpo)
      alvos.push(r.bot.hbCorpo, r.bot.hbCabeca);
  }
  const hitBot = _ray.intersectObjects(alvos,false)[0];
  const hitMur = _ray.intersectObjects(MUNDO.meshBlocos,false)[0];
  if(!J.arma.melee){
    /* Muzzle flash na ponta da arma */
    const ponta = cam.localToWorld(new THREE.Vector3(POSE.quadril.x*(1-J.mira), -0.16, -1.25));
    VFX.muzzleFlash(ponta, J.arma.id === 'sniper' || J.arma.id === 'barrett' ? 0xaaddff : 0xffdd88);

    /* Tracer de bala visível */
    const tracerFim = cam.position.clone().addScaledVector(dir,
      Math.min(J.arma.alcance, hitBot ? hitBot.distance : (hitMur ? hitMur.distance : J.arma.alcance))
    );
    const corTracer = J.arma.id === 'sniper' || J.arma.id === 'barrett' ? 0x88ccff
                    : J.arma.id === 'lmg' ? 0xffee44 : 0xffe8aa;
    VFX.tracer(ponta, tracerFim, corTracer);

    const origin = cam.position;
    NET.enviar({ type:'shot',
      from:{x:origin.x,y:origin.y,z:origin.z},
      to:{x:tracerFim.x,y:tracerFim.y,z:tracerFim.z} });
  }
  if(hitBot && (!hitMur || hitBot.distance < hitMur.distance)){
    const b = S.bots.find(x=> x.hbCorpo===hitBot.object || x.hbCabeca===hitBot.object);
    let remoto = null;
    for (const r of NET.remotos.values()){
      if (r.bot && (r.bot.hbCorpo===hitBot.object || r.bot.hbCabeca===hitBot.object)){ remoto = r; break; }
    }
    if (remoto && remoto.team !== NET.team){
      const cabeca = (hitBot.object === remoto.bot.hbCabeca);
      const dano = cabeca ? J.arma.dano * 2.6 : J.arma.dano;
      marcarHit(cabeca); vibrar(cabeca?42:18);
      /* Efeito de impacto em corpo remoto */
      VFX.impactoCorpo(hitBot.point, cabeca);
      NET.enviar({ type:'damage', targetId: remoto.id, damage: dano, headshot: cabeca });
    } else if (b){
      const cabeca = (hitBot.object === b.hbCabeca);
      const dano = cabeca ? J.arma.dano * 2.6 : J.arma.dano;
      marcarHit(cabeca);
      if(!J.arma.melee) VFX.impactoCorpo(hitBot.point, cabeca);
      ferirBot(b, dano, null, cabeca);
      b.suspeita.copy(J.pos); b.tSuspeita = CFG.bot.memoria;
    }
  } else if(hitMur){
    /* Impacto em parede com normal real */
    if(!J.arma.melee){
      const normal = hitMur.face ? hitMur.face.normal.clone()
                                    .applyMatrix3(new THREE.Matrix3().getNormalMatrix(hitMur.object.matrixWorld))
                                    .normalize()
                                 : new THREE.Vector3(0,0,1);
      VFX.impactoParede(hitMur.point, normal, 0xb8b0a0);
    }
  }
}
function recarregar(){
  if(!S.ativa || S.fim) return;
  if(J.arma.melee || J.recarregando || J.reserva<=0 || J.pente>=J.arma.pente) return;
  J.recarregando = true; J.tRec = J.arma.recarga;
  AUDIO.play('reload'); aviso('RECARREGANDO');
}
function usarKit(){
  if(!S.ativa || S.fim) return;
  if(J.kits<=0 || J.vida>=CFG.jogador.vida || !J.vivo || TRAVADO) return;
  J.kits--;
  J.vida = Math.min(CFG.jogador.vida, J.vida + CFG.jogador.curaKit);
  AUDIO.play('kit');
  pintarItens();
  pintarVida(); aviso('+'+CFG.jogador.curaKit+' VIDA');
}
function criarModeloGranada(){
  const g = new THREE.Group();
  const matCorpo = new THREE.MeshStandardMaterial({ color:0x2a3a28, roughness:0.62, metalness:0.35 });
  const matMetal = new THREE.MeshStandardMaterial({ color:0x59636e, roughness:0.35, metalness:0.9 });
  const corpo = new THREE.Mesh(new THREE.SphereGeometry(0.11, 14, 12), matCorpo);
  g.add(corpo);
  const friso = new THREE.Mesh(new THREE.TorusGeometry(0.112, 0.006, 6, 20), matCorpo);
  friso.rotation.x = Math.PI/2; g.add(friso);
  const friso2 = friso.clone(); friso2.position.y =  0.045; friso2.scale.setScalar(0.82); g.add(friso2);
  const friso3 = friso.clone(); friso3.position.y = -0.045; friso3.scale.setScalar(0.82); g.add(friso3);
  const tampa = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.055, 0.05, 10), matMetal);
  tampa.position.y = 0.115; g.add(tampa);
  const alav = new THREE.Mesh(new THREE.BoxGeometry(0.014, 0.09, 0.022), matMetal);
  alav.position.set(0.05, 0.15, 0); alav.rotation.z = -0.18; g.add(alav);
  const pino = new THREE.Mesh(new THREE.TorusGeometry(0.018, 0.004, 6, 12), matMetal);
  pino.position.set(-0.052, 0.155, 0); pino.rotation.y = Math.PI/2; g.add(pino);
  g.traverse(o => { if(o.isMesh){ o.castShadow = true; o.receiveShadow = true; } });
  return g;
}
function lancarGranada(){
  if(!S.ativa || S.fim) return;
  if(J.granadas<=0 || !J.vivo || TRAVADO) return;
  J.granadas--;
  AUDIO.play('granada');
  pintarItens();
  const g = criarModeloGranada();
  g.position.copy(cam.position);
  const d = new THREE.Vector3(); cam.getWorldDirection(d);
  cena.add(g);
  S.granadas.push({
    mesh:g,
    vel:d.multiplyScalar(CFG.granada.forca).add(new THREE.Vector3(0,3.2,0)),
    t:CFG.granada.fusivel, dono:'jogador'
  });
  aviso('GRANADA');
}
function atualizarGranadas(dt){
  for(let i=S.granadas.length-1;i>=0;i--){
    const g = S.granadas[i];
    g.vel.y -= 22*dt;
    const p = g.mesh.position;
    const nx = p.x + g.vel.x*dt, nz = p.z + g.vel.z*dt;
    if(colide(nx,p.z,0.2)){ g.vel.x *= -0.42; } else p.x = nx;
    if(colide(p.x,nz,0.2)){ g.vel.z *= -0.42; } else p.z = nz;
    p.y += g.vel.y*dt;
    if(p.y <= 0.16){ p.y = 0.16; g.vel.y *= -0.34; g.vel.x *= 0.7; g.vel.z *= 0.7; }
    g.mesh.rotation.x += dt * 6.0; g.mesh.rotation.y += dt * 4.5;
    g.t -= dt;
    if(g.t <= 0){ explodir(p.clone(), g.dono); cena.remove(g.mesh); S.granadas.splice(i,1); }
  }
}
function explodir(pos, dono){
  AUDIO.play('explosao');
  /* Sistema de partículas 3D profissional */
  VFX.explosao(pos);

  /* Camera shake proporcional à distância do player */
  const distExplosaoJog = J.pos.distanceTo(pos);
  if (distExplosaoJog < CFG.granada.raio * 2.5){
    const fatShake = Math.max(0, 1 - distExplosaoJog / (CFG.granada.raio * 2.5));
    camShake(0.12 * fatShake, 0.55 * fatShake + 0.1);
  }

  for(const b of S.bots){
    if(!b.vivo) continue;
    const d = b.grupo.position.distanceTo(pos);
    if(d < CFG.granada.raio){
      const dano = CFG.granada.dano * (1 - d/CFG.granada.raio);
      if(dono === 'jogador' && b.time !== timeDoJogador()) ferirBot(b, dano, null, false);
      else if(dono !== 'jogador'){
        const q = S.bots.find(x=>x.id===dono);
        if(q && q.time !== b.time) ferirBot(b, dano, q, false);
      }
    }
  }
  if(J.vivo){
    const d = J.pos.distanceTo(pos);
    if(d < CFG.granada.raio && dono !== 'jogador'){
      const q = S.bots.find(x=>x.id===dono);
      if(!q || q.time !== timeDoJogador())
        ferirJogador(CFG.granada.dano*(1-d/CFG.granada.raio), q ? q.nome : 'GRANADA');
    }
  }
}
function ferirJogador(dano, autor){
  if(!J.vivo || TRAVADO) return;
  AUDIO.play('dano');
  let d = dano;
  if(J.colete > 0){
    const abs = Math.min(J.colete, d*0.58);
    J.colete -= abs; d -= abs;
  }
  J.vida = Math.max(0, J.vida - d);
  pintarVida(); flashDano(); animarDanoPlayer();
  if(J.vida <= 0) morrerJogador(autor);
}

function acharBotOuRemoto(nome){
  if(!nome) return null;
  for(const b of S.bots){
    if(!b.remoto && b.nome === nome) return b;
  }
  for(const r of NET.remotos.values()){
    if(r.nick === nome && r.bot) return r.bot;
  }
  return null;
}

function morrerJogador(autor){
  J.vivo = false; J.tResp = CFG.partida.respawn;
  S.mortes++;

  const meuTime = timeDoJogador();
  if (meuTime === 'aliado') S.scV++; else S.scA++;
  AUDIO.play('morte');

  J.spectando = acharBotOuRemoto(autor);
  J.spectandoNome = autor || '';

  for(const b of S.bots){
    if(b.alvo && b.alvo.ehJog){ b.alvo = null; b.viuAlvo = false; }
    b.tSuspeita = 0;
    b.tMemoria = 0;
  }

  const tm = el('telaMorte'); if(tm) tm.classList.add('on');
  const rq = el('respQuem'); if(rq) rq.textContent = 'Eliminado por ' + (autor || '???');
  feedKill(autor, P.nick, false);
  pintarPlacar(); checarFim();
  NET.enviar({ type:'respawn', inSeconds: CFG.partida.respawn });
}
function renascerJogador(){
  J.vivo = true;
  J.vida = CFG.jogador.vida; J.colete = CFG.jogador.colete;
  J.pente = J.arma.pente; J.reserva = J.arma.reserva;
  J.kits = CFG.jogador.kits; J.granadas = CFG.jogador.granadas;

  const baseX = timeDoJogador() === 'inimigo' ? 46 : -46;
  J.spawn.set(baseX, CFG.jogador.altura, 0);
  J.pos.copy(J.spawn);
  J.pos.z += (Math.random()-0.5)*12;
  J.vel.set(0,0,0);
  J.yaw = (timeDoJogador() === 'inimigo') ? -Math.PI/2 : Math.PI/2;
  J.pitch = 0;
  J.agachado = false;
  J.spectando = null;
  J.spectandoNome = '';
  const tm = el('telaMorte'); if(tm) tm.classList.remove('on');
  pintarVida(); pintarMunicao();
  pintarItens();
  NET.enviar({ type:'respawn' });
}

/* =========== HP em % =========== */
function criarHPTexto(time){
  const canvas = document.createElement('canvas');
  canvas.width = 256; canvas.height = 128;
  const ctx = canvas.getContext('2d');
  const tex = new THREE.CanvasTexture(canvas);
  tex.minFilter = THREE.LinearFilter; tex.magFilter = THREE.LinearFilter;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(1.2, 0.6, 1);
  sprite.renderOrder = 999;
  function pintar(hp, nome){
    const p = Math.max(0, Math.min(100, Math.round(hp)));
    ctx.clearRect(0, 0, 256, 128);
    let cor = '#7ee088';
    if (p <= 30) cor = '#e74c3c';
    else if (p <= 60) cor = '#f0a020';
    if (nome){
      ctx.font = 'bold 22px ui-monospace,monospace';
      ctx.fillStyle = time === 'aliado' ? '#4aa3ff' : '#e8b923';
      ctx.textAlign = 'center';
      ctx.strokeStyle = 'rgba(0,0,0,0.8)'; ctx.lineWidth = 4;
      ctx.strokeText(nome, 128, 36);
      ctx.fillText(nome, 128, 36);
    }
    ctx.font = 'bold 74px ui-monospace,monospace';
    ctx.fillStyle = cor;
    ctx.textAlign = 'center';
    ctx.strokeStyle = 'rgba(0,0,0,0.85)'; ctx.lineWidth = 6;
    ctx.strokeText(p + '%', 128, 110);
    ctx.fillText(p + '%', 128, 110);
    tex.needsUpdate = true;
  }
  return { sprite, pintar, tex };
}

/* =========== BOTS =========== */
async function criarBot(time, nome, idx){
  const g = new THREE.Group();
  const skinCor  = time==='aliado' ? 0x2266dd : 0xcc3322;
  let mixer = null, actions = {}, modeloAtual = null;
  const gltf = await Modelos.carregar(MODELO_NPC);
  if (gltf && gltf.scene) {
    modeloAtual = Modelos.clonar(gltf.scene);
    modeloAtual.scale.setScalar(1.0);
    const texUrl = time === 'aliado' ? TEXTURA_NPC_AZUL : TEXTURA_NPC_VERM;
    const tex = new THREE.TextureLoader().load(texUrl, undefined, undefined, ()=>{});
    tex.colorSpace = THREE.SRGBColorSpace;
    modeloAtual.traverse(o => {
      if (o.isMesh) {
        o.castShadow = true; o.receiveShadow = true;
        if (o.material && tex.image) {
          if (Array.isArray(o.material)) o.material.forEach(mt => mt.map = tex);
          else { o.material = o.material.clone(); o.material.map = tex; o.material.needsUpdate = true; }
        }
      }
    });
    g.add(modeloAtual);
    mixer = new THREE.AnimationMixer(modeloAtual);
    for (const clip of (gltf.animations || [])) actions[clip.name.toLowerCase()] = mixer.clipAction(clip);
    for (const chave of Object.keys(ANIM)) {
      const url = ANIM[chave]; if (!url) continue;
      const gl = await Modelos.carregar(url);
      if (gl && gl.animations && gl.animations[0]) actions[chave] = mixer.clipAction(gl.animations[0]);
    }
  } else {
    const matC = new THREE.MeshStandardMaterial({ color:skinCor, roughness:0.75, metalness:0.2 });
    const matP = new THREE.MeshStandardMaterial({ color:0x9a6b4f, roughness:0.9 });
    const tronco = new THREE.Mesh(new THREE.CylinderGeometry(0.32,0.32,0.95,12), matC);
    tronco.position.y = 0.92; tronco.castShadow = true; g.add(tronco);
    const om = new THREE.Mesh(new THREE.SphereGeometry(0.32,12,8), matC);
    om.position.y = 1.39; om.castShadow = true; g.add(om);
    const ob = new THREE.Mesh(new THREE.SphereGeometry(0.32,12,8), matC);
    ob.position.y = 0.45; ob.castShadow = true; g.add(ob);
    const perna1 = new THREE.Mesh(new THREE.CylinderGeometry(0.11,0.1,0.5,8), matC);
    perna1.position.set(0.13,0.25,0); g.add(perna1);
    const perna2 = perna1.clone(); perna2.position.x = -0.13; g.add(perna2);
    const cabeca = new THREE.Mesh(new THREE.SphereGeometry(0.23,14,10), matP);
    cabeca.position.y = 1.73; cabeca.castShadow = true; g.add(cabeca);
    const capa = new THREE.Mesh(new THREE.SphereGeometry(0.265,14,8,0,Math.PI*2,0,Math.PI/2), matC);
    capa.position.y = 1.75; g.add(capa);
  }

  const grupoArmaNpc = new THREE.Group();
  grupoArmaNpc.position.set(0.24, 1.18, 0.16);
  let armaNpcCarregada = false;
  try {
    const gltfArmaNpc = await Modelos.carregar(MODELO_ARMA.rifle);
    if (gltfArmaNpc && gltfArmaNpc.scene) {
      const armaM = Modelos.clonar(gltfArmaNpc.scene);
      armaM.updateMatrixWorld(true);
      const med = Modelos.medir(armaM);
      const maiorDim = Math.max(med.tamanho.x, med.tamanho.y, med.tamanho.z) || 1;
      const escala = 0.75 / maiorDim;
      armaM.position.set(-med.centro.x, -med.centro.y, -med.centro.z);
      let temMapEmbutido = false;
      armaM.traverse(o => {
        if (o.isMesh && o.material) {
          const mats = Array.isArray(o.material) ? o.material : [o.material];
          mats.forEach(mt => { if (mt.map) temMapEmbutido = true; });
        }
      });
      if (!temMapEmbutido) aplicarTextura(armaM, TEXTURA_ARMA.rifle);
      Modelos.aplicarSombras(armaM);

      const holderNpc = new THREE.Group();
      holderNpc.add(armaM);
      holderNpc.scale.setScalar(escala);
      holderNpc.rotation.set(0, 0, 0);
      grupoArmaNpc.add(holderNpc);
      armaNpcCarregada = true;
    }
  } catch(e) { armaNpcCarregada = false; }

  if (!armaNpcCarregada) {
    const matArmaCorpo = new THREE.MeshStandardMaterial({ color:0x2a2e36, roughness:0.55, metalness:0.75 });
    const matArmaDet   = new THREE.MeshStandardMaterial({ color:0x14171c, roughness:0.4, metalness:0.85 });
    const corpoArma = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.09, 0.42), matArmaCorpo);
    corpoArma.position.set(0, 0, 0.06); grupoArmaNpc.add(corpoArma);
    const canoNpc = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.32, 8), matArmaDet);
    canoNpc.rotation.x = Math.PI/2;
    canoNpc.position.set(0, 0.012, 0.44); grupoArmaNpc.add(canoNpc);
    const penteNpc = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.13, 0.06), matArmaDet);
    penteNpc.position.set(0, -0.10, 0.02);
    penteNpc.rotation.x = 0.15; grupoArmaNpc.add(penteNpc);
    const coronhaNpc = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.07, 0.16), matArmaDet);
    coronhaNpc.position.set(0, -0.015, -0.18); grupoArmaNpc.add(coronhaNpc);
    const miraNpc = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.02, 0.03), matArmaDet);
    miraNpc.position.set(0, 0.065, 0.18); grupoArmaNpc.add(miraNpc);
  }
  grupoArmaNpc.traverse(o => { if (o.isMesh) { o.castShadow = true; } });
  g.add(grupoArmaNpc);

  const invis = new THREE.MeshBasicMaterial({ visible:false });
  const hbCorpo = new THREE.Mesh(new THREE.BoxGeometry(0.78,1.35,0.56), invis);
  hbCorpo.position.y = 0.92; g.add(hbCorpo);
  const hbCabeca = new THREE.Mesh(new THREE.SphereGeometry(0.29,8,6), invis);
  hbCabeca.position.y = 1.74; g.add(hbCabeca);

  const hp = criarHPTexto(time);
  hp.sprite.position.y = 2.25;
  hp.sprite.visible = false;
  hp.pintar(100, nome);
  g.add(hp.sprite);

  const lado = time==='aliado' ? -46 : 46;
  const sz = (idx - 1.5) * 6;
  g.position.set(lado, 0, sz);
  cena.add(g);
  return {
    id:'b'+time+idx+Math.random().toString(36).slice(2,6),
    nome, time, grupo:g,
    hpSprite: hp.sprite, hpPintar: hp.pintar,
    hbCorpo, hbCabeca,
    vida:CFG.bot.vida, vivo:true, tResp:0, kills:0,
    spawn:new THREE.Vector3(lado,0,sz),
    estado:'PATRULHA', tEstado:0,
    alvo:null, viuAlvo:false, tVisao:0, tMemoria:0,
    suspeita:new THREE.Vector3(), tSuspeita:0,
    destino:new THREE.Vector3(lado,0,sz),
    tRota:0, tTiro:0, tReacao:0,
    pente:CFG.bot.pente, recarregando:false, tRecarga:0,
    strafe:(Math.random()<0.5?-1:1), tStrafe:0,
    pericia:0.8 + Math.random()*0.45, yaw:0,
    mixer, actions, modeloAtual, grupoArmaNpc,
    _velAnt:new THREE.Vector3(lado,0,sz)
  };
}
function tocarAnim(bot, nome, loop = true, fade = 0.2){
  if (!bot.actions || !bot.actions[nome]) return;
  if (bot.animAtual === nome) return;
  const ant = bot.actions[bot.animAtual];
  const novo = bot.actions[nome];
  if (ant) ant.fadeOut(fade);
  novo.reset().fadeIn(fade).play();
  novo.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
  bot.animAtual = nome;
}
async function criarBots(modo){
  S.bots = [];
  const nA = modo.aliados ?? CFG.partida.botsAliados;
  const nI = modo.inimigos ?? CFG.partida.botsInimigos;
  const jobs = [];
  for(let i=0;i<nA;i++) jobs.push(criarBot('aliado', NOMES_BOT.aliado[i], i));
  for(let i=0;i<nI;i++) jobs.push(criarBot('inimigo', NOMES_BOT.inimigo[i], i));
  S.bots = await Promise.all(jobs);
  montarPainelEquipe();
}
function olhosDe(b){ return _vOlho.set(b.grupo.position.x, 1.6, b.grupo.position.z); }
function atualizarBots(dt){
  const meuTimeAgora = timeDoJogador();
  for(const b of S.bots){
    if(b.mixer) b.mixer.update(dt);
    if(b.remoto) continue;
    if(!b.vivo){
      b.tResp -= dt;
      if(b.tResp <= 0) renascerBot(b);
      continue;
    }
    const distJ = b.grupo.position.distanceTo(J.pos);
    const mostrarBarra = distJ < CFG.bot.distBarra;
    b.hpSprite.visible = mostrarBarra;
    if(b.recarregando){
      b.tRecarga -= dt;
      if(b.tRecarga <= 0){ b.pente = CFG.bot.pente; b.recarregando = false; }
    } else if(b.pente <= 0){
      b.recarregando = true; b.tRecarga = CFG.bot.recarga;
      b.estado = 'RECUAR'; b.tEstado = CFG.bot.recarga;
    }
    const olho = olhosDe(b);
    let melhor = null, melhorD = Infinity;
    for(const o of S.bots){
      if(!o.vivo || o.time === b.time || o.remoto) continue;
      const d = b.grupo.position.distanceTo(o.grupo.position);
      if(d > CFG.bot.alcance*1.4) continue;
      if(!noCampoDeVisao(b,o.grupo.position)) continue;
      const alvoOlho = _v2.set(o.grupo.position.x,1.5,o.grupo.position.z);
      if(!visaoLivre(olho, alvoOlho)) continue;
      if(d < melhorD){ melhorD = d; melhor = { obj:o, ehJog:false }; }
    }
    if(b.time !== meuTimeAgora && J.vivo && !TRAVADO){
      const d = b.grupo.position.distanceTo(J.pos);
      if(d <= CFG.bot.alcance*1.4 && noCampoDeVisao(b,J.pos) && visaoLivre(olho,J.pos)){
        if(d < melhorD){ melhorD = d; melhor = { obj:null, ehJog:true }; }
      }
    }
    if(melhor){
      if(!b.viuAlvo) b.tReacao = CFG.bot.tempoReacao * (2 - b.pericia);
      b.alvo = melhor; b.viuAlvo = true; b.tMemoria = CFG.bot.memoria;
      b.suspeita.copy(melhor.ehJog ? J.pos : melhor.obj.grupo.position);
      b.tSuspeita = CFG.bot.memoria;
    } else {
      b.viuAlvo = false; b.tMemoria -= dt;
      if(b.tMemoria <= 0) b.alvo = null;
    }
    if(b.tSuspeita > 0) b.tSuspeita -= dt;
    if(b.tReacao > 0) b.tReacao -= dt;
    b.tEstado -= dt;
    if(b.tEstado <= 0) decidirEstado(b, melhorD);
    executarEstado(b, dt, melhorD);
    if(b.viuAlvo && !b.recarregando && b.tReacao <= 0 && melhorD < CFG.bot.alcance && b.estado !== 'RECUAR'){
      b.tTiro -= dt;
      if(b.tTiro <= 0){
        b.tTiro = CFG.bot.cadencia * (0.75 + Math.random()*0.55) / b.pericia;
        dispararBot(b, melhorD);
      }
    }
    const vel = b.grupo.position.distanceTo(b._velAnt) / Math.max(dt, 1e-3);
    b._velAnt.copy(b.grupo.position);
    if(!b.vivo)                 tocarAnim(b, 'morte', false);
    else if(b.recarregando)     tocarAnim(b, 'recarregar', false);
    else if(b.viuAlvo && b.tTiro > CFG.bot.cadencia*0.5) tocarAnim(b, 'atirar', false);
    else if(vel > 3.5)          tocarAnim(b, 'correndo');
    else if(vel > 0.3)          tocarAnim(b, 'andando');
    else                        tocarAnim(b, 'parado');
  }
}
function noCampoDeVisao(b, alvo){
  const dx = alvo.x - b.grupo.position.x, dz = alvo.z - b.grupo.position.z;
  const d = Math.hypot(dx,dz); if(d < 0.001) return true;
  const fx = Math.sin(b.yaw), fz = Math.cos(b.yaw);
  return (dx/d)*fx + (dz/d)*fz > CFG.bot.campoVisao;
}
function decidirEstado(b, dist){
  const r = Math.random();
  if(b.recarregando){ b.estado='RECUAR'; b.tEstado = b.tRecarga; return; }
  if(b.viuAlvo){
    if(dist < 7)                     { b.estado='RECUAR';  b.tEstado=0.8+r*0.6; }
    else if(dist > 26)               { b.estado='AVANCAR'; b.tEstado=1.4+r; }
    else if(r < 0.34)                { b.estado='FLANCO';  b.tEstado=1.6+r*1.4; b.strafe = Math.random()<0.5?-1:1; }
    else                             { b.estado='COMBATE'; b.tEstado=1.1+r*0.9; }
  } else if(b.tSuspeita > 0){
    b.estado = 'AVANCAR'; b.tEstado = 1.2+r;
    b.destino.copy(b.suspeita);
  } else {
    b.estado = 'PATRULHA'; b.tEstado = 2.4+r*2.6; novaRota(b);
  }
}
function novaRota(b){
  const frenteX = b.time==='aliado' ? 1 : -1;
  b.destino.set(frenteX * (6 + Math.random()*38), 0, (Math.random()-0.5) * (CFG.mapa.fundo-14));
}
function executarEstado(b, dt, dist){
  const pos = b.grupo.position;
  const alvoPos = b.alvo ? (b.alvo.ehJog ? J.pos : b.alvo.obj.grupo.position) : null;
  let mirarEm = alvoPos || (b.tSuspeita>0 ? b.suspeita : b.destino);
  const vx = mirarEm.x - pos.x, vz = mirarEm.z - pos.z;
  const alvoYaw = Math.atan2(vx,vz);
  let dif = alvoYaw - b.yaw;
  while(dif >  Math.PI) dif -= Math.PI*2;
  while(dif < -Math.PI) dif += Math.PI*2;
  b.yaw += dif * Math.min(1, dt * (b.viuAlvo ? 7 : 3.2));
  b.grupo.rotation.y = b.yaw;
  let vx2 = 0, vz2 = 0, v = 0;
  switch(b.estado){
    case 'PATRULHA': {
      v = CFG.bot.velPatrulha;
      const dx = b.destino.x-pos.x, dz = b.destino.z-pos.z;
      const d = Math.hypot(dx,dz);
      if(d < 3){ novaRota(b); break; }
      vx2 = dx/d; vz2 = dz/d; break;
    }
    case 'AVANCAR': {
      v = CFG.bot.velAvanco;
      const m = alvoPos || b.destino;
      const dx = m.x-pos.x, dz = m.z-pos.z;
      const d = Math.hypot(dx,dz);
      if(d > 1){ vx2 = dx/d; vz2 = dz/d; }
      break;
    }
    case 'COMBATE': {
      v = CFG.bot.velFlanco*0.7;
      if(alvoPos){
        const dx = alvoPos.x-pos.x, dz = alvoPos.z-pos.z;
        const d = Math.hypot(dx,dz) || 1;
        vx2 = -dz/d * b.strafe; vz2 =  dx/d * b.strafe;
        b.tStrafe -= dt;
        if(b.tStrafe <= 0){ b.tStrafe = 0.9+Math.random(); b.strafe *= -1; }
      }
      break;
    }
    case 'FLANCO': {
      v = CFG.bot.velFlanco;
      if(alvoPos){
        const dx = alvoPos.x-pos.x, dz = alvoPos.z-pos.z;
        const d = Math.hypot(dx,dz) || 1;
        vx2 = (-dz/d)*b.strafe*0.85 + (dx/d)*0.4;
        vz2 = ( dx/d)*b.strafe*0.85 + (dz/d)*0.4;
      }
      break;
    }
    case 'RECUAR': {
      v = CFG.bot.velAvanco*0.9;
      if(alvoPos){
        const dx = pos.x-alvoPos.x, dz = pos.z-alvoPos.z;
        const d = Math.hypot(dx,dz) || 1;
        vx2 = dx/d; vz2 = dz/d;
      } else { vx2 = b.time==='aliado' ? -1 : 1; }
      break;
    }
  }
  if(vx2 || vz2){
    const n = Math.hypot(vx2,vz2) || 1;
    const antes = pos.x, antesZ = pos.z;
    mover(pos, (vx2/n)*v*dt, (vz2/n)*v*dt, 0.4);
    if(Math.abs(pos.x-antes) < 0.005 && Math.abs(pos.z-antesZ) < 0.005){
      b.destino.x = pos.x + (Math.random() - 0.5) * 30;
      b.destino.z = pos.z + (Math.random() - 0.5) * 30;
      b.estado = 'PATRULHA'; b.tEstado = 1.0;
    }
  }
}
function dispararBot(b, dist){
  /* Nunca dispara se for um player remoto (humano) — dano vem pelo servidor */
  if (b.remoto) return;
  b.pente--;
  /* Posição da ponta da arma do bot */
  const posArma = b.grupo.position.clone();
  posArma.y += 1.22;
  const frente = new THREE.Vector3(Math.sin(b.yaw), 0, Math.cos(b.yaw));
  posArma.addScaledVector(frente, 0.32);

  /* Muzzle flash 3D na ponta da arma do bot */
  VFX.muzzleFlash(posArma, 0xffcc66);

  /* Tracer em direção ao alvo */
  if (b.alvo){
    const alvoPos = b.alvo.ehJog ? J.pos.clone().setY(J.pos.y + 1.4)
                                  : b.alvo.obj.grupo.position.clone().setY(b.alvo.obj.grupo.position.y + 1.4);
    VFX.tracer(posArma, alvoPos, 0xffdd88);
  }

  try{
    const distJ = J.vivo ? J.pos.distanceTo(b.grupo.position) : 999;
    if (distJ < 60) { const vol = Math.max(0.15, 1 - distJ/60) * 0.55; AUDIO.play('tiro', { volume: vol }); }
  }catch(e){}
  let chance = CFG.bot.precisaoBase * b.pericia;
  chance *= 1 - Math.min(0.55, dist/CFG.bot.alcance*0.6);
  if(b.estado === 'FLANCO') chance *= 0.7;
  if(Math.random() > chance) return;
  const naCabeca = Math.random() < 0.08;
  const dano = CFG.bot.dano * (naCabeca ? 2.4 : 1);
  if(b.alvo && b.alvo.ehJog) ferirJogador(dano, b.nome);
  else if(b.alvo && b.alvo.obj && !b.alvo.obj.remoto) {
    /* Só fere bots NPC, nunca players remotos */
    ferirBot(b.alvo.obj, dano, b, naCabeca);
    if (!b.alvo.obj.vivo) b.kills++;
  }
}
function ferirBot(b, dano, autor, naCabeca){
  /* Nunca aplica dano de NPC em players remotos (humanos) — dano deles vem pelo servidor */
  if(!b.vivo || b.remoto) return;
  b.vida -= dano;
  b.hpPintar(b.vida, b.nome);
  if(autor){ b.suspeita.copy(autor.grupo.position); b.tSuspeita = CFG.bot.memoria; }
  atualizarPainelEquipe();
  if(b.vida <= 0){
    b.vivo = false; b.tResp = CFG.bot.respawn;
    b.grupo.visible = false;
    AUDIO.play('morte');
    const nomeAutor = autor ? autor.nome : P.nick;
    const timeAutor = autor ? autor.time : timeDoJogador();
    if(timeAutor === 'aliado') S.scA++; else S.scV++;
    if(!autor){ S.abates++; }
    else if(autor && autor.kills !== undefined) { autor.kills++; }
    if (NET.conectado && NET.sala){
      NET.enviar({ type:'score', team: timeAutor, delta: 1 });
    }
    feedKill(nomeAutor, b.nome, !autor, naCabeca);
    pintarPlacar(); atualizarPainelEquipe(); checarFim();
  }
}
function renascerBot(b){
  /* Nunca reposiciona players remotos — respawn deles vem pelo servidor */
  if (b.remoto) return;
  b.vivo = true; b.vida = CFG.bot.vida;
  b.pente = CFG.bot.pente; b.recarregando = false;
  b.grupo.visible = true;
  b.grupo.position.copy(b.spawn);
  b.grupo.position.z += (Math.random()-0.5)*8;
  b.hpPintar(100, b.nome);
  b.estado = 'PATRULHA'; b.tEstado = 1; b.alvo = null; b.viuAlvo = false;
  novaRota(b);
  atualizarPainelEquipe();
}

/* =========== REMOTOS =========== */
async function trocarArmaRemoto(r, weaponId){
  const bot = r && r.bot; if(!bot || !bot.grupoArmaNpc) return;
  const a = ARMAS.find(x=>x.id===weaponId);
  if(!a || a.melee){ bot.grupoArmaNpc.visible = false; return; }
  try{
    const gltfArmaNpc = await Modelos.carregar(MODELO_ARMA[a.id]);
    if(!gltfArmaNpc || !gltfArmaNpc.scene) return;
    const armaM = Modelos.clonar(gltfArmaNpc.scene);
    armaM.updateMatrixWorld(true);
    const med = Modelos.medir(armaM);
    const maiorDim = Math.max(med.tamanho.x, med.tamanho.y, med.tamanho.z) || 1;
    armaM.position.set(-med.centro.x, -med.centro.y, -med.centro.z);
    aplicarTextura(armaM, TEXTURA_ARMA[a.id]);
    Modelos.aplicarSombras(armaM);
    const holderNpc = new THREE.Group();
    holderNpc.add(armaM);
    holderNpc.scale.setScalar(0.75 / maiorDim);
    bot.grupoArmaNpc.clear();
    bot.grupoArmaNpc.add(holderNpc);
    bot.grupoArmaNpc.visible = true;
  }catch(e){}
}
async function criarRemoto(p){
  const bot = await criarBot(p.team, p.nick, 0);
  bot.remoto = true; bot.remotoId = p.id;
  bot.grupo.position.set(p.pos.x, 0, p.pos.z);
  bot.grupo.rotation.y = p.yaw || 0;
  bot.grupo.visible = true;      /* garante modelo visível desde o início */
  bot.estado = 'PARADO';
  /* HP sprite de player remoto fica sempre visível (gerenciado por atualizarRemotos) */
  if (bot.hpSprite) bot.hpSprite.visible = true;
  if (bot.hpPintar) bot.hpPintar(100, p.nick);
  NET.remotos.set(p.id, {
    id: p.id, nick: p.nick, team: p.team,
    pos: p.pos, yaw: p.yaw || 0, hp: 100, alive: true, kills: 0,
    bot, ultimoUpdate: performance.now()
  });
  return bot;
}
function atualizarRemotos(dt){
  for (const r of NET.remotos.values()){
    if (!r.bot || !r.bot.grupo) continue;
    r.bot.grupo.position.x += (r.pos.x - r.bot.grupo.position.x) * Math.min(1, dt*14);
    r.bot.grupo.position.z += (r.pos.z - r.bot.grupo.position.z) * Math.min(1, dt*14);
    let dy = (r.yaw - r.bot.grupo.rotation.y + Math.PI) % (Math.PI*2) - Math.PI;
    r.bot.grupo.rotation.y += dy * Math.min(1, dt*12);
    r.bot.yaw = r.bot.grupo.rotation.y;
    r.bot.vida = r.hp;
    r.bot.vivo = r.alive;
    r.bot.grupo.visible = r.alive;
    /* HP sprite: visível quando próximo e vivo */
    if (r.bot.hpSprite){
      const distJ = r.bot.grupo.position.distanceTo(J.pos);
      r.bot.hpSprite.visible = r.alive && distJ < CFG.bot.distBarra;
    }
    if (r.bot.hpPintar) r.bot.hpPintar(r.hp, r.nick);
  }
}
function enviarMeuEstado(){
  if (!NET.conectado || !NET.sala || !S.ativa || TRAVADO) return;
  const agora = performance.now();
  if (agora - NET.ultimoEnvio < (1000*NET.taxaEnvio)) return;
  NET.ultimoEnvio = agora;
  NET.enviar({
    type:'state',
    pos: { x: J.pos.x, y: J.pos.y, z: J.pos.z },
    yaw: J.yaw,
    hp: J.vida,
    alive: J.vivo,
    kills: S.abates,
    moving: !!(IN.fre || IN.tras || IN.esq || IN.dir),
    weapon: J.arma ? J.arma.id : 'rifle'
  });
}

/* =========== HUD =========== */
function pintarVida(){
  const hf = el('hpFill'), hn = el('hpNum'), af = el('arFill'), an = el('arNum');
  if(hf){ hf.style.width = J.vida+'%'; hf.classList.toggle('crit', J.vida < 32); }
  if(hn) hn.textContent = Math.ceil(J.vida);
  if(af) af.style.width = J.colete+'%';
  if(an) an.textContent = Math.ceil(J.colete);
}
function atualizarImgArmaHud(){
  let im = el('armaImgHud');
  if(!im){
    im = document.createElement('img');
    im.id = 'armaImgHud';
    im.alt = '';
    im.style.cssText = 'width:56px;height:30px;object-fit:contain;display:block;margin:0 0 5px auto;filter:drop-shadow(0 2px 5px rgba(0,0,0,.65));pointer-events:none;';
    const pa = el('pArma');
    if(pa) pa.insertBefore(im, pa.firstChild);
  }
  if(J.arma && !J.arma.melee){
    im.style.display = 'block';
    im.onerror = ()=>{ im.style.display = 'none'; };
    im.src = 'imagens/arma_' + J.arma.id + '.png';
  } else {
    im.style.display = 'none';
  }
}
function pintarMunicao(){
  atualizarImgArmaHud();
  const m = el('municao'), r = el('reserva');
  if(!m || !r) return;
  if (J.arma.melee) { m.textContent = '-'; r.textContent = '/ -'; m.classList.remove('vazio'); }
  else { m.textContent = J.pente; r.textContent = '/ ' + J.reserva; m.classList.toggle('vazio', J.pente === 0); }
}
function pintarPlacar(){
  const a = el('scAzul'), v = el('scVerm');
  if(a) a.textContent = S.scA;
  if(v) v.textContent = S.scV;
}

/* ==========================================================
   PLACAR (Tab) - fecha com X, com toque no fundo e rolagem
   ========================================================== */
function togglePlacarTab(abrir){
  S.tabAberto = abrir;
  if (!el('placarTab')) criarTabelaPlacar();
  const t = el('placarTab');
  const b = el('placarTabBack');
  if (abrir){
    atualizarTabelaTab();
    t && t.classList.add('on');
    b && b.classList.add('on');
  } else {
    t && t.classList.remove('on');
    b && b.classList.remove('on');
  }
}
function criarTabelaPlacar(){
  if (!el('estilosPro')){
    const st = document.createElement('style');
    st.id = 'estilosPro';
    st.textContent = `
      #placarTabBack{position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:9998;display:none;pointer-events:auto}
      #placarTabBack.on{display:block}
      #placarTab{position:fixed;top:50%;left:50%;transform:translate(-50%,-50%) scale(.95);
        width:min(92vw,560px);max-height:82vh;overflow-y:auto;overflow-x:hidden;
        background:rgba(20,23,26,.97);border:1px solid #2a2f36;
        box-shadow:0 20px 50px rgba(0,0,0,.85);backdrop-filter:blur(12px);border-radius:12px;
        padding:16px;color:#fff;z-index:9999;display:none;opacity:0;transition:all .2s;
        touch-action:pan-y;-webkit-overflow-scrolling:touch;pointer-events:auto;box-sizing:border-box}
      #placarTab.on{display:block;opacity:1;transform:translate(-50%,-50%) scale(1)}
      .tabelaPlacarHeader{display:flex;justify-content:space-between;align-items:center;
        border-bottom:1px solid #2a2f36;padding-bottom:10px;margin-bottom:12px;font-weight:800;
        letter-spacing:1px;color:#f0a020;gap:10px;font-size:12px}
      .placarFechar{width:34px;height:34px;border:1px solid #2a2f36;border-radius:8px;
        background:#14171a;color:#8a929c;font-size:22px;line-height:1;cursor:pointer;
        display:flex;align-items:center;justify-content:center;flex-shrink:0;padding:0;
        transition:transform .12s,color .15s,border-color .15s}
      .placarFechar:hover{color:#fff;border-color:#f0a020}
      .placarFechar:active{transform:scale(.9)}
      .tabelaLinha{display:flex;justify-content:space-between;padding:9px 12px;margin-bottom:5px;
        background:rgba(255,255,255,.03);border-radius:6px;align-items:center;
        font-family:monospace;font-size:13px;gap:8px}
      .tabelaLinha span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .tabelaLinha.eu{background:rgba(240,160,32,.2);border-left:4px solid #f0a020}
      .timeTagBlue{color:#4aa3ff;font-weight:bold}.timeTagRed{color:#e8b923;font-weight:bold}
      @media (max-width:560px){
        #placarTab{padding:12px;border-radius:10px;max-height:86vh}
        .tabelaLinha{font-size:11.5px;padding:7px 9px}
        .tabelaPlacarHeader{font-size:10.5px;padding-bottom:8px;margin-bottom:10px}
        .placarFechar{width:30px;height:30px;font-size:19px}
      }
      @media (max-height:420px){
        #placarTab{max-height:92vh;padding:10px}
        .tabelaLinha{font-size:11px;padding:6px 8px;margin-bottom:4px}
        .tabelaPlacarHeader{margin-bottom:8px;padding-bottom:6px}
      }
    `;
    document.head.appendChild(st);
  }
  if (!el('placarTabBack')){
    const back = document.createElement('div');
    back.id = 'placarTabBack';
    const fechar = (e)=>{ if(e) e.preventDefault(); togglePlacarTab(false); };
    back.addEventListener('click', fechar);
    document.body.appendChild(back);
  }
  if (!el('placarTab')){
    const div = document.createElement('div');
    div.id = 'placarTab';
    div.innerHTML =
      '<div class="tabelaPlacarHeader">'+
        '<span>JOGADOR / ESQUADRAO</span>'+
        '<button class="placarFechar" id="placarFecharX" aria-label="Fechar">&times;</button>'+
      '</div>'+
      '<div id="corpoPlacarTab"></div>';
    document.body.appendChild(div);
    const x = el('placarFecharX');
    if (x){
      x.onclick = (e)=>{ if(e) e.stopPropagation(); togglePlacarTab(false); };
      x.addEventListener('touchend', (e)=>{ e.preventDefault(); e.stopPropagation(); togglePlacarTab(false); }, {passive:false});
    }
  }
}
function atualizarTabelaTab(){
  const corpo = el('corpoPlacarTab'); if (!corpo) return;
  corpo.innerHTML = '';
  const linhaEu = document.createElement('div');
  linhaEu.className = 'tabelaLinha eu';
  const meuTag = NET.team === 'aliado' ? 'timeTagBlue' : 'timeTagRed';
  const meuNome = NET.team === 'aliado' ? '[AZUL]' : '[AMARELO]';
  linhaEu.innerHTML = `<span><b class="${meuTag}">${meuNome}</b> ${P.nick} (Voce)</span> <span>${S.abates} / ${S.mortes}</span>`;
  corpo.appendChild(linhaEu);
  NET.remotos.forEach(r => {
    const l = document.createElement('div');
    l.className = 'tabelaLinha';
    const tag = r.team === 'aliado' ? '<b class="timeTagBlue">[AZUL]</b>' : '<b class="timeTagRed">[AMARELO]</b>';
    l.innerHTML = `<span>${tag} ${r.nick}</span> <span>${r.kills || 0}</span>`;
    corpo.appendChild(l);
  });
  /* Lista apenas bots NPC (não-remotos) para evitar duplicatas */
  S.bots.filter(b => !b.remoto).forEach(b => {
    const l = document.createElement('div');
    l.className = 'tabelaLinha';
    const tag = b.time === 'aliado' ? '<b class="timeTagBlue">[AZUL]</b>' : '<b class="timeTagRed">[AMARELO]</b>';
    l.innerHTML = `<span>${tag} ${b.nome}</span> <span>${b.kills || 0}</span>`;
    corpo.appendChild(l);
  });
}
function montarPainelEquipe(){
  const c = el('pEquipe'); if(!c) return;
  c.innerHTML = '';
  const add = (nome, id) =>{
    const d = document.createElement('div');
    d.className = 'linhaAliado';
    d.innerHTML = `<span class="pontoTime"></span><span class="nomeAliado">${nome}</span><span class="hpMini"><i id="${id}" style="width:100%"></i></span>`;
    c.appendChild(d);
  };
  add(P.nick, 'hpAli_eu');
  S.bots.filter(b=>b.time==='aliado' && !b.remoto).forEach((b,i)=> add(b.nome, 'hpAli_'+i));
}
function atualizarPainelEquipe(){
  const eu = el('hpAli_eu');
  if(eu){ eu.style.width = J.vida+'%'; eu.classList.toggle('morto', !J.vivo); }
  S.bots.filter(b=>b.time==='aliado' && !b.remoto).forEach((b,i)=>{
    const e = el('hpAli_'+i);
    if(e){ e.style.width = Math.max(0,b.vida)+'%'; e.classList.toggle('morto', !b.vivo); }
  });
}
function feedKill(autor, vitima, souEu, naCabeca){
  const f = el('feed'); if(!f) return;
  const d = document.createElement('div');
  d.className = 'kill' + (souEu ? ' eu' : '');
  d.innerHTML = `<b>${autor}</b><s>${naCabeca?'// HS //':'&rsaquo;&rsaquo;'}</s><u>${vitima}</u>`;
  f.appendChild(d);
  setTimeout(()=> d.remove(), 3600);
  if(f.children.length > 5) f.firstChild.remove();
}
let tAviso;
function aviso(t){
  const a = el('aviso'); if(!a) return;
  a.textContent = t; a.style.opacity = 1;
  clearTimeout(tAviso);
  tAviso = setTimeout(()=> a.style.opacity = 0, 950);
}
function marcarHit(cabeca){
  const m = el('miraHit'); if(!m) return;
  m.style.opacity = 1;
  m.style.transform = 'rotate(45deg) scale('+(cabeca?1.5:1)+')';
  setTimeout(()=> m.style.opacity = 0, cabeca?230:150);
  if(cabeca){ AUDIO.play('headshot'); aviso('HEADSHOT'); }
}
/* Variáveis de camera shake */
let _shakeIntens = 0, _shakeDur = 0, _shakeT = 0;
let _shakeOrigX = 0, _shakeOrigY = 0;
function camShake(intensidade, duracao){
  _shakeIntens = intensidade;
  _shakeDur    = duracao;
  _shakeT      = 0;
}
function tickCamShake(dt){
  if (_shakeDur <= 0) return;
  _shakeT += dt;
  const t = _shakeT / _shakeDur;
  if (t >= 1){ _shakeDur = 0; return; }
  const decay = 1 - t * t;
  const ampX = (Math.random() - 0.5) * _shakeIntens * decay;
  const ampY = (Math.random() - 0.5) * _shakeIntens * decay;
  if (cam){
    cam.rotation.z = ampX;
    cam.rotation.x = J.pitch + ampY;
  }
}
function flashDano(){
  const v = el('vinheta'); if(!v) return;
  v.style.opacity = 1;
  setTimeout(()=> v.style.opacity = 0, 150);
  /* Camera shake ao tomar dano */
  camShake(0.035, 0.22);
  /* Partículas de sangue em frente à câmera (espaço mundo) */
  if (cam && typeof VFX !== 'undefined'){
    const posRef = cam.position.clone();
    posRef.y -= 0.05;
    for (let i = 0; i < 8; i++){
      VFX.spawn({
        pos: posRef.clone().add(new THREE.Vector3(
          (Math.random()-0.5)*0.18,
          (Math.random()-0.5)*0.12,
          -(Math.random()*0.12+0.08)
        )),
        cor: Math.random() < 0.6 ? 0xcc0000 : 0x990000,
        escala: 0.012 + Math.random() * 0.016,
        escalaFim: 0,
        opacIni: 0.85, opacFim: 0,
        vel: new THREE.Vector3(
          (Math.random()-0.5)*0.6,
          -(Math.random()*0.4+0.1),
          -(Math.random()*0.3)
        ),
        gravidade: -2, dur: 0.18 + Math.random()*0.12,
        emissivo: false, tipo: 'sfera', bounce: 0, rotVel: 0
      });
    }
  }
}

/* =========== PARTIDA =========== */
function carregarEIniciarMultiplayer(m){
  /* Usa o modo local escolhido pelo player, mas força semBots
     caso o servidor indique que a sala é sem bots (x1/x2).
     Isso evita que NPCs sejam criados mesmo se modoEscolhido
     estiver desatualizado. */
  S.modo = modoEscolhido || MODOS[0];
  if (m.semBots) S.modo = Object.assign({}, S.modo, { semBots: true });
  carregar(
    ['Sincronizando sala','Preparando terreno','Conectando jogadores','Pronto'],
    async () => {
      mostrarCena('cJogo');
      await iniciarPartida(S.modo, m);
    }
  );
}
async function iniciarPartida(modo, multiplayer){
  if(cena){
    while(cena.children.length) cena.remove(cena.children[0]);
  }
  montarMapa();
  J.arma = ARMAS.find(a=>a.id===P.arma) || ARMAS[1];
  J.pente = J.arma.pente; J.reserva = J.arma.reserva;
  J.vida = CFG.jogador.vida; J.colete = CFG.jogador.colete;
  J.kits = CFG.jogador.kits; J.granadas = CFG.jogador.granadas;
  J.vivo = true; J.recarregando = false; J.coice = 0;
  J.mira = 0; J.mirando = false; J.agachado = false;
  J.spectando = null; J.spectandoNome = '';

  /* Modos X1/X2: sem bots */
  const semBots = modo && modo.semBots;

  if (multiplayer){
    NET.sala = multiplayer.roomId;
    NET.team = multiplayer.team;
  } else {
    NET.team = 'aliado';
  }

  const baseX = (NET.team === 'inimigo') ? 46 : -46;
  J.spawn.set(baseX, CFG.jogador.altura, 0);
  J.pos.copy(J.spawn);
  J.vel.set(0,0,0);
  J.yaw = (NET.team === 'inimigo') ? -Math.PI/2 : Math.PI/2;
  J.pitch = 0;

  cam.fov = P.fov; cam.updateProjectionMatrix();
  await montarArmaNaTela();

  /* semBots também pode vir do próprio pacote multiplayer (x1/x2).
     Garante que NPCs nunca sejam criados nesses modos. */
  const realmente_sem_bots = semBots || (multiplayer && multiplayer.semBots);

  if (multiplayer && !realmente_sem_bots && modo && modo.id === 'tatico'){
    /* =====================================================================
       MODO TÁTICO 4v4 INTELIGENTE
       -----------------------------------------------------------------------
       - Cada time tem 4 slots totais
       - Cada player real substitui exatamente 1 NPC do seu time
       - 1 player solo  → 3 bots aliados + 4 bots inimigos
       - 2 aliados      → 2 bots aliados + 4 bots inimigos
       - 4 aliados + 4 inimigos → 0 bots (sala cheia de players)
       ===================================================================== */
    const todosPlayers      = multiplayer.players;
    const nPlayersAliados   = todosPlayers.filter(p => p.team === 'aliado'  && p.id !== multiplayer.yourId).length;
    const nPlayersInimigos  = todosPlayers.filter(p => p.team === 'inimigo' && p.id !== multiplayer.yourId).length;
    const SLOTS_TIME = 4;
    const botsNecAliados    = Math.max(0, SLOTS_TIME - 1 - nPlayersAliados);
    const botsNecInimigos   = Math.max(0, SLOTS_TIME     - nPlayersInimigos);
    S.bots = [];
    const jobs = [];
    for(let i = 0; i < botsNecAliados;  i++) jobs.push(criarBot('aliado',  NOMES_BOT.aliado[i],  i));
    for(let i = 0; i < botsNecInimigos; i++) jobs.push(criarBot('inimigo', NOMES_BOT.inimigo[i], i));
    S.bots = await Promise.all(jobs);
    montarPainelEquipe();
  } else if (!realmente_sem_bots){
    await criarBots(modo);
  }

  if (multiplayer){
    const me = multiplayer.players.find(p => p.id === multiplayer.yourId);
    if (me){ J.pos.set(me.pos.x, me.pos.y, me.pos.z); J.yaw = me.yaw; }

    for (const p of multiplayer.players){
      if (p.id === multiplayer.yourId) continue;
      await criarRemoto(p);
    }

    if (realmente_sem_bots){
      /* x1/x2: remove TODOS os bots NPC que possam ter sido criados por engano */
      for (let i = S.bots.length - 1; i >= 0; i--){
        const b = S.bots[i];
        if (!b.remoto){
          if (cena) cena.remove(b.grupo);
          S.bots.splice(i, 1);
        }
      }
    }
    mostrarChat();
  }
  S.ativa = true; S.fim = false; S.pausada = false; S.tabAberto = false;
  S.scA = 0; S.scV = 0; S.abates = 0; S.mortes = 0;
  S.tempo = CFG.partida.duracao;
  S.granadas = [];
  const an = el('armaNome'); if(an) an.textContent = J.arma.nome;
  pintarItens();
  const mt = el('meta'); if(mt) mt.textContent = 'Meta '+CFG.partida.metaAbates+' abates';
  const tm = el('telaMorte'); if(tm) tm.classList.remove('on');
  pintarVida(); pintarMunicao(); pintarPlacar(); atualizarPainelEquipe();
  const fd = el('feed'); if(fd) fd.innerHTML = '';
  const hud = el('hud'); if(hud) hud.style.display = 'block';
  TELA.manter();
  const mob = el('mob'); if(mob && ehCelular()) mob.style.display = 'block';
  clearInterval(S.timer);
  S.timer = setInterval(()=>{
    if(!S.ativa || S.pausada) return;
    S.tempo--;
    const m = Math.floor(S.tempo/60), s = S.tempo%60;
    const rl = el('relogio');
    if(rl) rl.textContent = m+':'+String(s).padStart(2,'0');
    if(S.tempo <= 0) terminarPartida();
  }, 1000);
  if(!ehCelular()) pedirMouse();
}
function mostrarChat(){
  const c = el('chatBox'); if (c) c.classList.add('on');
  aplicarChatBoxPos();
}
function esconderChat(){
  const c = el('chatBox'); if (c) c.classList.remove('on');
}
function iniciarCountdownInGame(m){
  TRAVADO = true;
  const cd = el('startCountdown'), num = el('scNum');
  if (cd) cd.classList.add('on');
  let left = m.inGameCountdown || 5;
  if (num) num.textContent = left;
  if (m.players){
    for (const p of m.players){
      if (p.id === NET.meuId){
        J.pos.set(p.pos.x, p.pos.y, p.pos.z);
        J.yaw = p.yaw || 0;
      }
    }
  }
  const iv = setInterval(() => {
    left--;
    if (num){
      num.textContent = Math.max(0, left);
      num.style.animation = 'none'; void num.offsetWidth;
      num.style.animation = 'zoomIn .9s ease-out';
    }
    if (left <= 0){
      clearInterval(iv);
      TRAVADO = false;
      if (cd) cd.classList.remove('on');
      aviso('VAI!');
    }
  }, 1000);
}
function checarFim(){
  if(S.scA >= CFG.partida.metaAbates || S.scV >= CFG.partida.metaAbates) terminarPartida();
}
function terminarPartida(){
  if(S.fim) return;
  S.fim = true; S.ativa = false;
  clearInterval(S.timer);
  if(document.pointerLockElement) document.exitPointerLock();
  const hud = el('hud'); if(hud) hud.style.display = 'none';
  const mob = el('mob'); if(mob) mob.style.display = 'none';
  const pausa = el('pausa'); if(pausa) pausa.classList.remove('on');
  esconderChat();
  togglePlacarTab(false);

  const meuTime = timeDoJogador();
  const pontosMeu     = (meuTime === 'aliado') ? S.scA : S.scV;
  const pontosInimigo = (meuTime === 'aliado') ? S.scV : S.scA;
  const venceu = pontosMeu > pontosInimigo;
  const empate = pontosMeu === pontosInimigo;

  if (venceu) AUDIO.play('vitoria');
  else if (!empate) AUDIO.play('derrota');

  let xp = 0, co = 0;
  if(venceu){ xp = CFG.xp.vitoria + S.abates*CFG.xp.porAbate; co = CFG.xp.coinsVitoria + S.abates*CFG.xp.coinsPorAbate; }
  else if(empate){ xp = CFG.xp.empate + S.abates*CFG.xp.porAbate; co = CFG.xp.coinsEmpate + S.abates*CFG.xp.coinsPorAbate; }
  else {
    const gx = S.abates*CFG.xp.porAbate, gc = S.abates*CFG.xp.coinsPorAbate;
    xp = gx - CFG.xp.perdaDerrotaXp; co = gc - CFG.xp.perdaDerrotaCoins;
  }
  P.xp = Math.max(0, P.xp + xp);
  P.coins = Math.max(0, P.coins + co);
  P.totalAbates   = (P.totalAbates||0) + S.abates;
  P.totalPartidas = (P.totalPartidas||0) + 1;
  if(venceu) P.totalVitorias = (P.totalVitorias||0) + 1;
  let subiu = 0;
  while(P.xp >= xpDoNivel(P.nivel)){ P.xp -= xpDoNivel(P.nivel); P.nivel++; subiu++; }
  salvarPerfil();
  const tabela = [{n:P.nick, k:S.abates, eu:true}];
  /* Apenas NPCs na tabela — players remotos são listados via NET.remotos */
  S.bots.filter(b => !b.remoto).forEach(b=> tabela.push({n:b.nome, k:b.kills || 0, eu:false}));
  NET.remotos.forEach(r=> tabela.push({n:r.nick, k:r.kills || 0, eu:false}));
  tabela.sort((a,b)=> b.k - a.k);
  const pos = tabela.findIndex(t=>t.eu) + 1;
  carregar(['Encerrando partida','Calculando pontuacao','Distribuindo recompensas'], ()=>{
    const t = el('fimTit');
    if(t){ t.textContent = empate ? 'EMPATE' : (venceu ? 'VITORIA' : 'DERROTA'); t.className = empate ? 'e' : (venceu ? 'v' : 'd'); }
    const s = el('fimSub'); if(s) s.textContent = S.modo.nome + ' · ' + S.modo.selo;
    const sa = el('fimScA'); if(sa) sa.textContent = S.scA;
    const sv = el('fimScV'); if(sv) sv.textContent = S.scV;
    const fk = el('fimK'); if(fk) fk.textContent = S.abates;
    const fm = el('fimM'); if(fm) fm.textContent = S.mortes;
    const fkd = el('fimKD'); if(fkd) fkd.textContent = (S.abates/Math.max(1,S.mortes)).toFixed(1);
    const fp = el('fimPos'); if(fp) fp.textContent = pos;
    const ex = el('fimXp'), ec = el('fimCo');
    if(ex){ ex.textContent = (xp>=0?'+':'') + xp; ex.className = 'premioVal ' + (xp>=0?'mais':'menos'); }
    if(ec){ ec.textContent = (co>=0?'+':'') + co; ec.className = 'premioVal ' + (co>=0?'mais':'menos'); }
    const nec = xpDoNivel(P.nivel);
    const na = el('fimNivA'); if(na) na.textContent = 'NIVEL ' + P.nivel + (subiu?'  (+'+subiu+')':'');
    const xn = el('fimXpNum'); if(xn) xn.textContent = P.xp + ' / ' + nec;
    const xb = el('fimXpBar');
    if(xb){ xb.style.width = '0%'; setTimeout(()=> xb.style.width = Math.min(100,P.xp/nec*100)+'%', 260); }
    mostrarCena('cFim');
  });
}
function sairDaPartida(){
  S.ativa = false; S.fim = true;
  clearInterval(S.timer);
  if(document.pointerLockElement) document.exitPointerLock();
  /* Remove todos os bots e jogadores remotos da cena */
  if(cena){
    S.bots.forEach(b=>{ if(b.grupo) cena.remove(b.grupo); });
    NET.remotos.forEach(r=>{ if(r.bot && r.bot.grupo) cena.remove(r.bot.grupo); });
  }
  S.bots = [];
  NET.remotos.clear();
  /* Granadas */
  S.granadas.forEach(g=>{ if(cena && g.mesh) cena.remove(g.mesh); });
  S.granadas = [];
  /* Arma da tela */
  if(grupoArma){ cam.remove(grupoArma); grupoArma = null; }
  const hud = el('hud'); if(hud) hud.style.display = 'none';
  const mob = el('mob'); if(mob) mob.style.display = 'none';
  const pausa = el('pausa'); if(pausa) pausa.classList.remove('on');
  esconderChat();
  togglePlacarTab(false);
  NET.sairPartida();
  S.pausada = false;
  TRAVADO = false;
  carregar(['Salvando progresso','Retornando ao menu principal'], ()=>{
    pintarLobby(); mostrarCena('cLobby');
  });
}
function togglePausa(estado){
  if(!S.ativa) return;
  S.pausada = estado !== undefined ? estado : !S.pausada;
  const p = el('pausa'); if(p) p.classList.toggle('on', S.pausada);
  if(S.pausada){ if(document.pointerLockElement) document.exitPointerLock(); }
  else if(!ehCelular()) pedirMouse();
}

/* =========== CONTROLES =========== */
function ehCelular(){
  return /Android|iPhone|iPad|iPod|Mobi/i.test(navigator.userAgent)
      || ('ontouchstart' in window && innerWidth < 1100);
}
function pedirMouse(){
  const cv = el('cv');
  if(document.pointerLockElement === cv) return;
  try{ const r = cv.requestPointerLock(); if(r && r.catch) r.catch(()=>{}); }catch(e){}
}
function ligarTeclado(){
  document.addEventListener('contextmenu', e => e.preventDefault());
  addEventListener('keydown', e=>{
    if(chatAberto){
      if (e.code === 'Escape') fecharChat();
      return;
    }
    if (e.code === 'KeyT' && S.ativa){ e.preventDefault(); abrirChat(); return; }
    if(!S.ativa) return;
    switch(e.code){
      case 'KeyW': case 'ArrowUp':    IN.fre=1; break;
      case 'KeyS': case 'ArrowDown':  IN.tras=1; break;
      case 'KeyA': case 'ArrowLeft':  IN.esq=1; break;
      case 'KeyD': case 'ArrowRight': IN.dir=1; break;
      case 'ShiftLeft': IN.correndo=true; break;
      case 'Space': e.preventDefault(); IN.pulou=true; break;
      case 'KeyC': J.agachado = true; break;
      case 'KeyR': recarregar(); break;
      case 'KeyH': usarKit(); break;
      case 'KeyG': lancarGranada(); break;
      case 'KeyQ': abrirInvArmas(); break;
      case 'Tab': e.preventDefault(); togglePlacarTab(true); break;
      case 'Digit1': equiparArma(P.arma); break;
      case 'Digit2':
        if(!P.facaAtiva) break;
        equiparArma('faca'); break;
      case 'Escape':
        if(S.tabAberto){ togglePlacarTab(false); break; }
        togglePausa(); break;
    }
  });
  addEventListener('keyup', e=>{
    if (chatAberto) return;
    switch(e.code){
      case 'KeyW': case 'ArrowUp':    IN.fre=0; break;
      case 'KeyS': case 'ArrowDown':  IN.tras=0; break;
      case 'KeyA': case 'ArrowLeft':  IN.esq=0; break;
      case 'KeyD': case 'ArrowRight': IN.dir=0; break;
      case 'ShiftLeft': IN.correndo=false; break;
      case 'KeyC': J.agachado = false; break;
      case 'Tab': e.preventDefault(); togglePlacarTab(false); break;
    }
  });
  const cv = el('cv');
  cv.addEventListener('mousedown', e=>{
    if(!S.ativa || S.pausada || S.tabAberto || chatAberto) return;
    if(e.button===0) IN.atirando = true;
    if(e.button===2) J.mirando = true;
  });
  addEventListener('mouseup', e=>{
    if(e.button===0) IN.atirando = false;
    if(e.button===2) J.mirando = false;
  });
  addEventListener('mousemove', e=>{
    if(document.pointerLockElement !== cv) return;
    IN.olhX += e.movementX; IN.olhY += e.movementY;
  });
  cv.addEventListener('click', ()=>{ if(S.ativa && !S.pausada && !S.tabAberto && !ehCelular()) pedirMouse(); });
  let arr=false, aX=0, aY=0;
  cv.addEventListener('mousedown', e=>{
    if(document.pointerLockElement===cv) return;
    arr=true; aX=e.clientX; aY=e.clientY;
  });
  addEventListener('mouseup', ()=> arr=false);
  addEventListener('mousemove', e=>{
    if(!arr || document.pointerLockElement===cv) return;
    IN.olhX += (e.clientX-aX)*1.3; IN.olhY += (e.clientY-aY)*1.3;
    aX=e.clientX; aY=e.clientY;
  });
  const inp = el('chatInput');
  if (inp){
    inp.addEventListener('keydown', (e) => {
      if (e.key === 'Enter'){
        e.preventDefault();
        const v = inp.value.trim();
        if (v){
          NET.enviar({ type:'chat', msg: v });
        }
        fecharChat();
      }
      e.stopPropagation();
    });
    inp.addEventListener('keyup', (e) => { e.stopPropagation(); });
  }

  /* Fechar chat com botao VOLTAR do Android / ESC */
  document.addEventListener('keydown', (e)=>{
    if (e.key === 'Escape' && chatAberto){
      e.preventDefault();
      fecharChat();
    }
  }, true);
}
function criarBotoesMobile(){
  const mob = el('mob'); if(!mob) return;
  const mk = (id, hud, nome) => {
    if (el(id)) return el(id);
    const d = document.createElement('div');
    d.className = 'tBtn'; d.id = id; d.dataset.hud = hud;
    d.innerHTML = '<span>'+nome+'</span>';
    mob.appendChild(d);
    return d;
  };
  mk('tPlacar','placar','PLACAR');
  mk('tChat','chat','CHAT');
  pintarItens();
}


/* ==========================================================
   Contadores de kit e granada — atualiza o painel do HUD
   e o numerinho ao lado do botao do celular.
   ========================================================== */

/* ==========================================================
   NAO DEIXAR A TELA APAGAR DURANTE O JOGO
   Usa a Wake Lock API. Onde nao existir, cai para um video
   minusculo em loop, que segura a tela do mesmo jeito.
   ========================================================== */
const TELA = {
  lock:null, video:null, ligado:false,

  async manter(){
    if(this.ligado) return;
    this.ligado = true;
    /* caminho moderno */
    try{
      if('wakeLock' in navigator){
        this.lock = await navigator.wakeLock.request('screen');
        this.lock.addEventListener('release', ()=>{ this.lock = null; });
        return;
      }
    }catch(e){}
    /* reserva: video invisivel em loop */
    this.reserva();
  },

  reserva(){
    if(this.video) return;
    try{
      const v = document.createElement('video');
      v.setAttribute('playsinline',''); v.setAttribute('muted','');
      v.muted = true; v.loop = true;
      v.style.cssText = 'position:fixed;width:1px;height:1px;opacity:0;pointer-events:none;left:-9px;top:-9px';
      /* clipe mp4 de 1 frame, embutido no proprio codigo */
      v.src = 'data:video/mp4;base64,AAAAIGZ0eXBtcDQyAAAAAG1wNDJpc29tYXZjMQAAAAhmcmVlAAAAG21kYXQAAAGzABAHAAABthADAowdbb9/AAAC6W1vb3YAAABsbXZoZAAAAAB8JbCAfCWwgAAAA+gAAAAsAAEAAAEAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACAAACFHRyYWsAAABcdGtoZAAAAAN8JbCAfCWwgAAAAAEAAAAAAAAALAAAAAAAAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAEAAAAAAoAAAAFoAAAAAACRlZHRzAAAAHGVsc3QAAAAAAAAAAQAAACwAAAAAAAEAAAAAAYxtZGlhAAAAIG1kaGQAAAAAfCWwgHwlsIAAAV+QAAAAAFXEAAAAAAAtaGRscgAAAAAAAAAAdmlkZQAAAAAAAAAAAAAAAFZpZGVvSGFuZGxlcgAAAAE3bWluZgAAABR2bWhkAAAAAQAAAAAAAAAAAAAAJGRpbmYAAAAcZHJlZgAAAAAAAAABAAAADHVybCAAAAABAAAA93N0YmwAAACzc3RzZAAAAAAAAAABAAAAo2F2YzEAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAAAoABaAEgAAABIAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABj//wAAADFhdmNDAWQACv/hABhnZAAKrNlCjfkhAAADAAEAAAMAAg8SJZYBAAZo6+PLIsAAAAAYc3R0cwAAAAAAAAABAAAAAQAAAAAAAAAcc3RzYwAAAAAAAAABAAAAAQAAAAEAAAABAAAAFHN0c3oAAAAAAAAAFwAAAAEAAAAUc3RjbwAAAAAAAAABAAAAMA==';
      document.body.appendChild(v);
      this.video = v;
      const tocar = ()=>{ const p = v.play(); if(p && p.catch) p.catch(()=>{}); };
      tocar();
      document.addEventListener('visibilitychange', ()=>{ if(!document.hidden) tocar(); });
    }catch(e){}
  },

  soltar(){
    this.ligado = false;
    try{ if(this.lock){ this.lock.release(); this.lock = null; } }catch(e){}
    try{ if(this.video){ this.video.pause(); } }catch(e){}
  },

  /* o navegador solta o lock ao trocar de aba: pegar de volta */
  ligar(){
    document.addEventListener('visibilitychange', async ()=>{
      if(document.hidden) return;
      if(this.ligado && !this.lock && 'wakeLock' in navigator){
        try{ this.lock = await navigator.wakeLock.request('screen'); }catch(e){}
      }
    });
  }
};

function pintarItens(){
  const por = (idPainel, idBotao, idBt, valor)=>{
    const p = el(idPainel); if(p) p.textContent = valor;
    const n = el(idBotao);
    if(n){
      n.textContent = valor;
      n.classList.toggle('zero', valor <= 0);
    }
    const b = el(idBt);
    if(b) b.classList.toggle('semItem', valor <= 0);
  };
  por('qtMed',  'qtMedBt',  'tMed',  J.kits);
  por('qtGren', 'qtGrenBt', 'tGren', J.granadas);
}

function ligarToque(){
  const zo = el('zonaOlhar');
  if(!zo) return;
  /* Suporta até 2 toques simultâneos na zona de olhar —
     um pode ser o dedo que segurou atirar e escorregou para cá,
     o outro move a câmera normalmente. */
  let idO=null, oX=0, oY=0, remX=0, remY=0;
  let idO2=null, oX2=0, oY2=0; /* segundo toque de câmera */

  zo.addEventListener('touchstart', e=>{
    if(HUD.editando) return;
    e.preventDefault();
    for(const t of e.changedTouches){
      if(idO === null){
        idO=t.identifier; oX=t.clientX; oY=t.clientY; remX=0; remY=0;
      } else if(idO2 === null && t.identifier !== idO){
        /* Segundo toque — câmera continua mesmo atirando */
        idO2=t.identifier; oX2=t.clientX; oY2=t.clientY;
      }
    }
  },{passive:false});

  zo.addEventListener('touchmove', e=>{
    e.preventDefault();
    for(const t of e.changedTouches){
      if(t.identifier === idO){
        remX += t.clientX-oX; remY += t.clientY-oY;
        oX=t.clientX; oY=t.clientY;
        const passo = 2.4 * (P.sens/100);
        IN.olhX += remX * passo;
        IN.olhY += remY * passo;
        remX = 0; remY = 0;
      } else if(t.identifier === idO2){
        const dx = t.clientX-oX2, dy = t.clientY-oY2;
        oX2=t.clientX; oY2=t.clientY;
        const passo = 2.4 * (P.sens/100);
        IN.olhX += dx * passo;
        IN.olhY += dy * passo;
      }
    }
  },{passive:false});

  const fimO = e=>{
    for(const t of e.changedTouches){
      if(t.identifier===idO){ idO=null; remX=0; remY=0; }
      if(t.identifier===idO2){ idO2=null; }
    }
  };
  zo.addEventListener('touchend',   fimO, {passive:false});
  zo.addEventListener('touchcancel',fimO, {passive:false});
  const zj = el('zonaJoy'), jb = el('joyB'), jk = el('joyK');
  if(zj && jb && jk){
    let idJ=null, jx=0, jy=0; const R=54;
    const posFixa = ()=>({ x: innerWidth*0.155, y: innerHeight*0.70 });
    if(OPC.joyFixo){
      const p = posFixa();
      jb.style.left=jk.style.left=p.x+'px';
      jb.style.top =jk.style.top =p.y+'px';
      jb.style.opacity='0.55';
    }
    zj.addEventListener('touchstart', e=>{
      if(HUD.editando) return;
      e.preventDefault();
      const t=e.changedTouches[0];
      idJ=t.identifier;
      if(OPC.joyFixo){ const p=posFixa(); jx=p.x; jy=p.y; }
      else { jx=t.clientX; jy=t.clientY; }
      jb.style.left=jk.style.left=jx+'px';
      jb.style.top =jk.style.top =jy+'px';
      jb.style.opacity=jk.style.opacity=1;
    },{passive:false});
    zj.addEventListener('touchmove', e=>{
      e.preventDefault();
      for(const t of e.changedTouches){
        if(t.identifier!==idJ) continue;
        let dx=t.clientX-jx, dy=t.clientY-jy;
        const L=Math.hypot(dx,dy);
        if(L>R){ dx=dx/L*R; dy=dy/L*R; }
        jk.style.left=(jx+dx)+'px'; jk.style.top=(jy+dy)+'px';
        const nx=dx/R, ny=dy/R;
        IN.fre  = ny<-0.24?1:0; IN.tras = ny> 0.24?1:0;
        IN.esq  = nx<-0.24?1:0; IN.dir  = nx> 0.24?1:0;
        IN.correndo = ny < -0.78;
      }
    },{passive:false});
    const fimJ = e=>{
      for(const t of e.changedTouches){
        if(t.identifier!==idJ) continue;
        idJ=null;
        if(OPC.joyFixo){
          const p=posFixa();
          jb.style.opacity='0.55'; jk.style.opacity='0.55';
          jk.style.left=p.x+'px'; jk.style.top=p.y+'px';
        } else { jb.style.opacity=jk.style.opacity=0; }
        IN.fre=IN.tras=IN.esq=IN.dir=0; IN.correndo=false;
      }
    };
    zj.addEventListener('touchend', fimJ);
    zj.addEventListener('touchcancel', fimJ);
  }
  const bt = (id, ini, fim, semPrevenir) =>{
    const b = el(id); if(!b) return;
    b.addEventListener('touchstart', e=>{
      if(HUD.editando) return;
      /* Alguns botoes (chat) precisam deixar o toque seguir,
         senao o Android nao abre o teclado virtual. */
      if(!semPrevenir) e.preventDefault();
      vibrar(12); ini();
    },{passive:!!semPrevenir});
    if(fim){
      b.addEventListener('touchend', e=>{
        if(HUD.editando) return;
        if(!semPrevenir) e.preventDefault();
        fim();
      },{passive:!!semPrevenir});
      b.addEventListener('touchcancel', ()=>{ if(!HUD.editando) fim(); });
    }
  };
  /* tAtirar: segura atira, mas se deslizar o dedo também move a câmera */
  const bAtirar = el('tAtirar');
  if(bAtirar){
    let idAt=null, atX=0, atY=0;
    bAtirar.addEventListener('touchstart', e=>{
      if(HUD.editando) return;
      e.preventDefault();
      vibrar(12);
      IN.atirando = true;
      const t = e.changedTouches[0];
      idAt=t.identifier; atX=t.clientX; atY=t.clientY;
    },{passive:false});
    bAtirar.addEventListener('touchmove', e=>{
      e.preventDefault();
      for(const t of e.changedTouches){
        if(t.identifier !== idAt) continue;
        const dx = t.clientX - atX, dy = t.clientY - atY;
        atX = t.clientX; atY = t.clientY;
        /* Limiar mínimo para não tremer ao pressionar */
        if(Math.abs(dx) > 1 || Math.abs(dy) > 1){
          const passo = 2.4 * (P.sens/100);
          IN.olhX += dx * passo;
          IN.olhY += dy * passo;
        }
      }
    },{passive:false});
    const fimAt = e=>{
      for(const t of e.changedTouches){
        if(t.identifier===idAt){ IN.atirando=false; idAt=null; }
      }
    };
    bAtirar.addEventListener('touchend',   fimAt, {passive:false});
    bAtirar.addEventListener('touchcancel',fimAt, {passive:false});
  }
  bt('tMira',   ()=> J.mirando=!J.mirando);
  bt('tRec',    ()=> recarregar());
  bt('tPular',  ()=> IN.pulou=true);
  bt('tMed',    ()=> usarKit());
  bt('tGren',   ()=> lancarGranada());
  bt('tCorrer', ()=> IN.correndo=true, ()=> IN.correndo=false);
  bt('tAgachar',()=>{ J.agachado = !J.agachado; });
  bt('tPlacar', ()=> togglePlacarTab(!S.tabAberto));
  /* o quarto parametro deixa o toque seguir para o teclado abrir */
  bt('tChat',   ()=> abrirChat(), null, true);
  const bch = el('tChat');
  if(bch) bch.addEventListener('click', ()=>{ if(!HUD.editando) abrirChat(); });
  bt('tTrocar', ()=>{
    const ehFaca = J.arma && J.arma.id === 'faca';
    if(ehFaca) equiparArma(P.arma);
    else if(P.facaAtiva) equiparArma('faca');
  });

  /* Fecha o chat ao tocar fora dele */
  document.addEventListener('touchstart', (e)=>{
    if (!chatAberto) return;
    const box = el('chatBox');
    if (box && !box.contains(e.target)){
      fecharChat();
    }
  }, { passive:true });
}

/* =========== AUDIO =========== */
const AUDIO = {
  ctx: null, volumeEfeitos: 0.7, volumeFundo: 0.35,
  cache: {}, _tentandoFundo: false,
  sons: {
    'tiro':'Sons/tiro.mp3','faca':'Sons/faca.mp3','reload':'Sons/reload.mp3',
    'recarga':'Sons/reload.mp3','dano':'Sons/dano.mp3','morte':'Sons/morte.mp3',
    'kit':'Sons/kit.mp3','cura':'Sons/kit.mp3','granada':'Sons/granada.mp3',
    'explosao':'Sons/explosao.mp3','headshot':'Sons/headshot.mp3',
    'clique':'Sons/clique.mp3','vitoria':'Sons/vitoria.mp3',
    'derrota':'Sons/derrota.mp3','fundo':'Sons/fundo.mp3'
  },
  init(){ if (!this.ctx) { try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch(e){} } this.preCarregar(); },
  preCarregar(){ for (const nome in this.sons) this.carregar(nome); },
  carregar(nome){
    if (this.cache[nome]) return this.cache[nome];
    const caminho = this.sons[nome]; if (!caminho) return null;
    const audio = new Audio(); audio.preload = 'auto';
    audio._pronto = false; audio._falhou = false;
    const marcarPronto = () => {
      audio._pronto = true;
      if (nome === 'fundo' && cenaAtual === 'cLobby') setTimeout(()=> { try{ AUDIO.fundo(true); }catch(e){} }, 50);
    };
    audio.addEventListener('canplaythrough', marcarPronto, { once:true });
    audio.addEventListener('loadeddata', marcarPronto, { once:true });
    audio.addEventListener('error', () => { audio._falhou = true; }, { once:true });
    audio.src = caminho; this.cache[nome] = audio;
    if (audio.readyState >= 3) marcarPronto();
    return audio;
  },
  play(tipo, opts = {}){
    const base = this.cache[tipo] || this.carregar(tipo);
    if (base && !base._falhou && (base._pronto || base.readyState >= 3)) {
      try {
        const clone = base.cloneNode(true);
        clone.volume = Math.min(1, (opts.volume ?? 1) * this.volumeEfeitos);
        clone.playbackRate = opts.rate ?? 1;
        const p = clone.play(); if (p && p.catch) p.catch(()=>{});
        return;
      } catch(e){}
    }
    this._oscilador(tipo);
  },
  _oscilador(tipo){
    if (!this.ctx) return;
    try {
      const t = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.connect(gain); gain.connect(this.ctx.destination);
      if (tipo === 'tiro') {
        osc.type='square'; osc.frequency.setValueAtTime(150,t);
        osc.frequency.exponentialRampToValueAtTime(40,t+0.1);
        gain.gain.setValueAtTime(0.25 * this.volumeEfeitos, t);
        gain.gain.exponentialRampToValueAtTime(0.01, t+0.1);
        osc.start(t); osc.stop(t+0.1);
      } else if (tipo === 'faca' || tipo === 'headshot') {
        osc.type='triangle'; osc.frequency.setValueAtTime(800,t);
        osc.frequency.exponentialRampToValueAtTime(100,t+0.05);
        gain.gain.setValueAtTime(0.35 * this.volumeEfeitos, t);
        gain.gain.exponentialRampToValueAtTime(0.01, t+0.05);
        osc.start(t); osc.stop(t+0.05);
      } else {
        osc.type='sine'; osc.frequency.setValueAtTime(300,t);
        osc.frequency.linearRampToValueAtTime(600,t+0.2);
        gain.gain.setValueAtTime(0.08 * this.volumeEfeitos, t);
        gain.gain.linearRampToValueAtTime(0, t+0.2);
        osc.start(t); osc.stop(t+0.2);
      }
    } catch(e){}
  },
  fundo(on){
    const base = this.cache['fundo'] || this.carregar('fundo');
    if (!base || base._falhou) return;
    if (!base._pronto && base.readyState < 3) return;
    if (on) {
      base.loop = true; base.volume = this.volumeFundo;
      if (base.paused) {
        const p = base.play();
        if (p && p.catch) {
          p.catch(()=>{
            if (this._tentandoFundo) return;
            this._tentandoFundo = true;
            const tentar = ()=>{ this._tentandoFundo = false; if (cenaAtual === 'cLobby' && base.paused) { const p2 = base.play(); if (p2 && p2.catch) p2.catch(()=>{}); } };
            window.addEventListener('pointerdown', tentar, { once:true });
            window.addEventListener('keydown', tentar, { once:true });
            window.addEventListener('touchstart', tentar, { once:true });
          });
        }
      }
    } else { try { base.pause(); } catch(e){} }
  },
  setVolumeEfeitos(v01){ this.volumeEfeitos = Math.max(0, Math.min(1, v01)); },
  setVolumeFundo(v01){ this.volumeFundo = Math.max(0, Math.min(1, v01)); const f = this.cache['fundo']; if (f) f.volume = this.volumeFundo; },

  retomar(){
    try {
      if (!this.ctx) this.init();
      if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
    } catch(e){}
  }
};

/* =========== INVENTARIO DE ARMAS =========== */
let invArmasAberto = false;
function injetarCSSExtra(){
  if(el('cssExtraHud')) return;
  const st = document.createElement('style');
  st.id = 'cssExtraHud';
  st.textContent = `
    #invArmas{position:fixed;left:50%;bottom:118px;transform:translateX(-50%) translateY(16px);
      z-index:860;display:none;opacity:0;transition:opacity .16s,transform .16s;
      background:rgba(16,19,23,.94);border:1px solid var(--linha);border-radius:14px;
      padding:12px 14px;backdrop-filter:blur(12px);pointer-events:auto;
      box-shadow:0 18px 50px rgba(0,0,0,.6)}
    #invArmas.on{display:block;opacity:1;transform:translateX(-50%) translateY(0)}
    .invTit{font-size:10px;letter-spacing:.34em;color:var(--c1);text-align:center;
      margin-bottom:10px;font-weight:800;text-transform:uppercase}
    .invGrade{display:flex;gap:9px;max-width:86vw;overflow-x:auto;padding-bottom:2px}
    .invCard{flex:0 0 auto;width:96px;padding:10px 6px 9px;background:var(--sup);
      border:1px solid var(--linha);border-radius:11px;text-align:center;cursor:pointer;
      transition:transform .12s,border-color .16s,box-shadow .16s}
    .invCard img{width:78px;height:40px;object-fit:contain;display:block;margin:0 auto 7px;
      filter:drop-shadow(0 4px 8px rgba(0,0,0,.6));pointer-events:none}
    .invCard span{font-size:8.5px;font-weight:800;letter-spacing:.08em;color:var(--txt);
      text-transform:uppercase;pointer-events:none}
    .invCard.eq{border-color:var(--c1);background:rgba(240,160,32,.12);
      box-shadow:0 0 16px rgba(240,160,32,.4)}
    .invCard:active{transform:scale(.94)}
    @media (max-height:560px){
      #invArmas{bottom:86px;padding:9px 10px}
      .invCard{width:80px;padding:7px 5px 6px}
      .invCard img{width:62px;height:32px}
    }
  `;
  document.head.appendChild(st);
}
function renderInvArmas(){
  const grade = el('invGrade'); if(!grade) return;
  grade.innerHTML = '';
  const ids = P.armasTem && P.armasTem.length ? P.armasTem : ['rifle'];
  ids.forEach(id=>{
    const a = ARMAS.find(x=>x.id===id); if(!a) return;
    const c = document.createElement('div');
    c.className = 'invCard' + ((J.arma && J.arma.id===id) ? ' eq' : '');
    c.innerHTML = '<img src="imagens/arma_'+id+'.png" alt="" '+
      'onerror="this.style.display=\'none\'"><span>'+a.nome+'</span>';
    const escolher = (e)=>{
      if(e){ e.preventDefault(); e.stopPropagation(); }
      equiparArma(id);
      renderInvArmas();
    };
    c.addEventListener('pointerdown', escolher);
    grade.appendChild(c);
  });
}
function abrirInvArmas(){
  if(invArmasAberto){ fecharInvArmas(); return; }
  if(!S.ativa || S.fim || !J.vivo) return;
  invArmasAberto = true;
  if(document.pointerLockElement) document.exitPointerLock();
  let p = el('invArmas');
  if(!p){
    p = document.createElement('div');
    p.id = 'invArmas';
    p.innerHTML = '<div class="invTit">Arsenal</div><div class="invGrade" id="invGrade"></div>';
    document.body.appendChild(p);
  }
  renderInvArmas();
  p.classList.add('on');
  try{ AUDIO.play('clique'); }catch(e){}
}
function fecharInvArmas(){
  invArmasAberto = false;
  const p = el('invArmas'); if(p) p.classList.remove('on');
  if(S.ativa && !S.pausada && !S.tabAberto && !chatAberto && !ehCelular()) pedirMouse();
}
function equiparArma(id, silencioso){
  const a = ARMAS.find(x=>x.id===id);
  if(!a) return;
  if(id !== 'faca' && !(P.armasTem||[]).includes(id)) return;
  if(J.arma && J.arma.id === id) return;
  J.arma = a;
  J.pente = a.pente; J.reserva = a.reserva;
  J.recarregando = false; J.tRec = 0;
  if(grupoArma) grupoArma.rotation.x = 0;
  montarArmaNaTela(); pintarMunicao();
  const an = el('armaNome'); if(an) an.textContent = a.nome;
  if(!silencioso) try{ AUDIO.play('reload'); }catch(e){}
  if(NET.conectado && NET.sala){
    NET.enviar({ type:'state',
      pos:{x:J.pos.x,y:J.pos.y,z:J.pos.z}, yaw:J.yaw,
      hp:J.vida, alive:J.vivo, kills:S.abates, moving:false, weapon:a.id });
  }
}

let armaIndex = 0;
window.addEventListener('wheel', (e) => {
  if (!S.ativa || S.pausada || S.tabAberto || !J.vivo || chatAberto) return;
  const inventario = P.facaAtiva ? [P.arma, 'faca'] : [P.arma];
  if (inventario.length < 2) return;
  AUDIO.play('reload');
  if (e.deltaY > 0) armaIndex = (armaIndex + 1) % inventario.length;
  else armaIndex = (armaIndex - 1 + inventario.length) % inventario.length;
  equiparArma(inventario[armaIndex]);
});
window.addEventListener('click', ()=>{ AUDIO.init(); AUDIO.retomar(); }, { once:true });
window.addEventListener('touchstart', ()=>{ AUDIO.init(); AUDIO.retomar(); }, { once:true });
document.addEventListener('pointerdown', ()=>{
  if (AUDIO.ctx && AUDIO.ctx.state === 'suspended') AUDIO.ctx.resume();
  if (cenaAtual === 'cLobby') AUDIO.fundo(true);
}, { passive:true });
document.addEventListener('keydown', ()=>{
  if (AUDIO.ctx && AUDIO.ctx.state === 'suspended') AUDIO.ctx.resume();
  if (cenaAtual === 'cLobby') AUDIO.fundo(true);
});

/* =========== LOOP =========== */
let _tPainelEq = 0, _tTab = 0, _tAmigos = 0;
function loop(){
  requestAnimationFrame(loop);
  const dt = Math.min(relogio.getDelta(), 0.05);
  if(S.ativa && !S.tabAberto){
    if (TRAVADO){
      cam.position.copy(J.pos);
      cam.rotation.order='YXZ';
      cam.rotation.y=J.yaw; cam.rotation.x=J.pitch;
      IN.fre=IN.tras=IN.esq=IN.dir=0;
      IN.atirando=false; IN.pulou=false;
    } else if (!chatAberto){
      atualizarJogador(dt);
    }
    MIRA.update(dt);
    MIRA._tCheck -= dt;
    /* Se tiro automático ligado, checa o alvo todo frame para precisão máxima */
    if(OPC.tiroAuto || MIRA._tCheck <= 0){ MIRA.checkAlvo(); MIRA._tCheck = 0.08; }
    atualizarBots(dt);
    atualizarRemotos(dt);
    atualizarGranadas(dt);
    VFX.tick(dt);
    tickCamShake(dt);
    enviarMeuEstado();
    _tPainelEq -= dt;
    if(_tPainelEq <= 0){ atualizarPainelEquipe(); _tPainelEq = 0.12; }
  }
  _tTab -= dt;
  if(S.ativa && S.tabAberto && _tTab <= 0){ atualizarTabelaTab(); _tTab = 0.5; }
  if((!S.ativa || S.fim) && invArmasAberto) fecharInvArmas();
  /* Tick de amigos: poll silencioso a cada 15s quando no lobby */
  if(!S.ativa){
    _tAmigos -= dt;
    if(_tAmigos <= 0){
      _tAmigos = 15;
      if(API.token && NET.conectado){
        /* Pede lista de online via WebSocket (sem custo de HTTP) */
        NET.enviar({ type:'status_amigos' });
        /* Poll HTTP para pedidos novos a cada 15s */
        AMIGOS.pollSilencioso();
      }
    }
  }
  if(cena && cam) ren.render(cena, cam);
}

/* =========== RANQUE =========== */
const PATENTES = [
  { n:1,  nome:'RECRUTA' },      { n:3,  nome:'SOLDADO' },
  { n:6,  nome:'CABO' },         { n:10, nome:'SARGENTO' },
  { n:15, nome:'TENENTE' },      { n:21, nome:'CAPITAO' },
  { n:28, nome:'MAJOR' },        { n:36, nome:'CORONEL' },
  { n:45, nome:'GENERAL' },      { n:60, nome:'LENDA' }
];
function patenteDe(nivel){
  let atual = PATENTES[0], prox = null;
  for(let i=0;i<PATENTES.length;i++){
    if(nivel >= PATENTES[i].n){ atual = PATENTES[i]; prox = PATENTES[i+1] || null; }
  }
  return { atual, prox };
}
async function abrirRanque(){
  const t = (id,v)=>{ const e=el(id); if(e) e.textContent = v; };
  const nec = xpDoNivel(P.nivel);
  const { atual, prox } = patenteDe(P.nivel);
  t('rkNivel',  P.nivel); t('rkPatente', atual.nome);
  t('rkProx', prox ? ('Proxima: '+prox.nome+' (nivel '+prox.n+')') : 'Patente maxima');
  t('rkXpNum', P.xp+' / '+nec);
  const bar = el('rkXpBar');
  if(bar){ bar.style.width='0%'; setTimeout(()=> bar.style.width = Math.min(100,P.xp/nec*100)+'%', 120); }
  const ab = P.totalAbates||0, vi = P.totalVitorias||0, pa = P.totalPartidas||0;
  t('rkAbates', ab.toLocaleString('pt-BR')); t('rkVitorias', vi); t('rkPartidas', pa);
  t('rkTaxa', pa ? Math.round(vi/pa*100)+'%' : '0%');
  const lista = el('rkLista');
  if(lista){
    lista.innerHTML = '<div class="rkLinha">Carregando...</div>';
    const dados = await API.ranqueGlobal();
    lista.innerHTML = '';
    if (!dados.length) lista.innerHTML = '<div class="rkLinha">Sem jogadores ainda.</div>';
    else dados.slice(0,20).forEach((b,i)=>{
      const eu = (b.nick === P.nick);
      const d = document.createElement('div');
      d.className = 'rkLinha' + (eu ? ' eu' : '');
      const cls = i===0?' ouro':i===1?' prata':i===2?' bronze':'';
      d.innerHTML = '<span class="rkPos'+cls+'">'+(i+1)+'</span>'+'<span class="rkNome">'+b.nick+'</span>'+'<span class="rkPts">'+(b.pontos||0).toLocaleString('pt-BR')+'</span>';
      lista.appendChild(d);
    });
  }
  abrirModal('mdRanque');
}
function abrirModal(id){ const e = el(id); if(e) e.classList.add('on'); }
function fecharModal(id){ const e = el(id); if(e) e.classList.remove('on'); }

/* ==========================================================
   LOJA + INVENTARIO
   ========================================================== */
let lojaFiltro = 'todas';
let lojaBusca  = '';
let invBusca   = '';

function precoArma(id){
  const base = ARMAS.find(a => a.id === id);
  if(!base) return null;
  const pct = DESCONTOS[id] || 0;
  const final = Math.round(base.preco * (1 - pct/100));
  return { base: base.preco, final, pct, temDesconto: pct > 0 };
}
function imgArma(id){ return `imagens/arma_${id}.png`; }

function renderArmaCard(a, ctx){
  const isFaca = a.id === 'faca';
  const preco  = precoArma(a.id);
  const tem    = P.armasTem.includes(a.id) || isFaca;
  const eq     = !isFaca && P.arma === a.id;

  let precoHtml = '';
  let btnHtml   = '';
  let toggleOn  = false;

  if(ctx === 'inv'){
    if(isFaca){
      toggleOn = !!P.facaAtiva;
      precoHtml = `<span class="cardArmaPrecoV ${toggleOn?'tem':''}">${toggleOn ? 'ATIVA' : 'INATIVA'}</span>`;
      btnHtml   = toggleOn
        ? `<button class="cardArmaBtn equipar">Desequipar</button>`
        : `<button class="cardArmaBtn">Equipar</button>`;
    } else {
      btnHtml = eq
        ? `<button class="cardArmaBtn equipar">Equipada</button>`
        : `<button class="cardArmaBtn">Equipar</button>`;
    }
  } else {
    if(tem && eq){
      precoHtml = `<span class="cardArmaPrecoV tem">EQUIPADA</span>`;
    } else if(tem){
      precoHtml = `<span class="cardArmaPrecoV tem">Possui</span>`;
      btnHtml   = `<button class="cardArmaBtn equipar">Equipar</button>`;
    } else {
      if(preco && preco.temDesconto){
        precoHtml = `<span class="cardArmaPrecoV">${preco.final} C</span>`+
                    `<span class="cardArmaPrecoOrig">${preco.base} C</span>`;
      } else if(preco) {
        precoHtml = `<span class="cardArmaPrecoV">${preco.base} C</span>`;
      }
      btnHtml = `<button class="cardArmaBtn">Comprar</button>`;
    }
  }

  const tagDesc = (ctx === 'oferta' && preco && preco.temDesconto && !tem)
    ? `<div class="cardArmaTag">-${preco.pct}%</div>` : '';
  const tagSec  = (ctx === 'inv' && isFaca)
    ? `<div class="cardArmaTag sec">SECUNDARIA</div>` : '';

  const card = document.createElement('div');
  card.className = 'cardArma'
    + (eq ? ' equipada' : '')
    + (tem && !eq && !isFaca ? ' tem' : '')
    + (isFaca && toggleOn ? ' equipada' : '')
    + (isFaca && !toggleOn ? ' desativada' : '');
  card.innerHTML = `
    <div class="cardArmaImg">
      ${tagDesc}
      ${tagSec}
      <span class="fallback">${a.nome}</span>
      <img src="${imgArma(a.id)}" alt="${a.nome}"
           onerror="this.style.display='none'"
           onload="var f=this.previousElementSibling; if(f&&f.classList.contains('fallback')) f.style.display='none';">
    </div>
    <div class="cardArmaInfo">
      <div class="cardArmaNome">${a.nome}</div>
      <div class="cardArmaSub">${a.info}</div>
      <div class="cardArmaPreco">${precoHtml}</div>
      ${btnHtml}
    </div>
  `;

  card.addEventListener('click', () => {
    SOM.clique();
    if(ctx === 'inv' && isFaca){
      P.facaAtiva = !P.facaAtiva;
      if(!P.facaAtiva && J.arma && J.arma.id === 'faca'){
        J.arma = ARMAS.find(x => x.id === P.arma) || ARMAS[1];
      }
      salvarPerfil();
      renderInventario();
      aviso(P.facaAtiva ? 'FACA EQUIPADA' : 'FACA DESEQUIPADA');
      return;
    }
    if(ctx === 'inv' || tem){
      P.arma = a.id;
      salvarPerfil(); pintarLobby();
      if(ctx === 'inv') renderInventario(); else renderLoja();
      aviso('EQUIPADO: ' + a.nome);
    } else {
      if(!preco){ return; }
      if(P.coins < preco.final){ aviso('COINS INSUFICIENTES'); return; }
      P.coins -= preco.final;
      P.armasTem.push(a.id);
      P.arma = a.id;
      salvarPerfil(); pintarLobby();
      renderLoja();
      aviso('COMPRADO: ' + a.nome);
    }
  });

  return card;
}

function renderLoja(){
  const grid = el('gradeLoja');
  if(!grid) return;
  grid.innerHTML = '';

  const todas = ARMAS.filter(a => a.id !== 'faca');
  const busca = lojaBusca;

  let lista = todas.filter(a => {
    if(busca && !a.nome.toLowerCase().includes(busca) && !a.id.toLowerCase().includes(busca)) return false;
    const preco = precoArma(a.id);
    if(lojaFiltro === 'desconto' && !preco.temDesconto) return false;
    if(lojaFiltro === 'semDesconto' && preco.temDesconto) return false;
    return true;
  });

  if(lista.length === 0){
    grid.innerHTML = '<div class="lojaVazio">Nenhuma arma encontrada.</div>';
  } else {
    lista.forEach(a => grid.appendChild(renderArmaCard(a, 'loja')));
  }

  const trilho = el('ofertasTrilho');
  const wrap   = el('ofertasWrap');
  if(trilho && wrap){
    const ofertas = ARMAS.filter(a => {
      if(a.id === 'faca') return false;
      return (DESCONTOS[a.id] || 0) > 0;
    });

    if(ofertas.length === 0){
      wrap.style.display = 'none';
    } else {
      wrap.style.display = 'block';
      trilho.innerHTML = '';
      for(let pass = 0; pass < 2; pass++){
        ofertas.forEach(a => trilho.appendChild(renderArmaCard(a, 'oferta')));
      }
      const dur = Math.max(20, ofertas.length * 8);
      trilho.style.animationDuration = dur + 's';
    }
  }
}

function renderInventario(){
  const grid = el('gradeInv');
  if(!grid) return;
  grid.innerHTML = '';

  const busca = invBusca;
  const minhas = ARMAS.filter(a => a.id === 'faca' || P.armasTem.includes(a.id));
  const lista = minhas.filter(a => {
    if(busca && !a.nome.toLowerCase().includes(busca) && !a.id.toLowerCase().includes(busca)) return false;
    return true;
  });

  if(lista.length === 0){
    grid.innerHTML = '<div class="lojaVazio">Voce ainda nao possui armas.</div>';
    return;
  }

  lista.sort((x,y) => (x.id === 'faca' ? 1 : 0) - (y.id === 'faca' ? 1 : 0));
  lista.forEach(a => grid.appendChild(renderArmaCard(a, 'inv')));
}

function mostrarPaginaLobby(nome){
  /* Esconde todas as páginas — incluindo as injetadas pelo jogo2.js */
  document.querySelectorAll('.paginaLobby').forEach(p => p.classList.remove('on'));
  document.querySelectorAll('.navItem').forEach(x => x.classList.remove('on'));

  /* Ativa a página pedida */
  const mapa = { inicio:'paginaInicio', loja:'paginaLoja', inv:'paginaInv',
                 temporadas:'paginaTemporadas', caixas:'paginaCaixas' };
  const navMapa = { inicio:'.navItem[data-nav="inicio"]', loja:'#navLoja', inv:'#navInv',
                    temporadas:'#navTemporadas', caixas:'#navCaixas' };

  const pgId = mapa[nome];
  if(pgId){ const pg = el(pgId); if(pg) pg.classList.add('on'); }
  const navSel = navMapa[nome];
  if(navSel){ const nav = document.querySelector(navSel); if(nav) nav.classList.add('on'); }

  if(nome === 'loja') renderLoja();
  if(nome === 'inv')  renderInventario();
  if(nome === 'temporadas' && typeof renderTemporadas === 'function') renderTemporadas();
  if(nome === 'caixas'     && typeof renderCaixas     === 'function') renderCaixas();
}

function abrirLoja(){ mostrarPaginaLobby('loja'); }

/* ==========================================================
   INJECAO CSS LOJA + EDITOR
   ========================================================== */
function injetarCSSLoja(){
  if(el('cssLojaInv')) return;
  const st = document.createElement('style');
  st.id = 'cssLojaInv';
  st.textContent = `
    .paginaLobby{ display:none; flex-direction:column; gap:14px; animation:fadeInPag .25s ease; }
    .paginaLobby.on{ display:flex; }
    @keyframes fadeInPag{ from{opacity:0;transform:translateY(6px)} to{opacity:1;transform:none} }

    .lojaTopo{ display:flex; align-items:center; justify-content:space-between; gap:14px; flex-wrap:wrap; }
    .lojaControles{ display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
    .lojaBusca{
      background:var(--sup); border:1px solid var(--linha); border-radius:7px;
      color:var(--txt); font-size:11px; padding:7px 11px; width:200px;
      outline:none; transition:border-color .18s; font-weight:600;
      letter-spacing:.04em; -webkit-user-select:text; user-select:text;
    }
    .lojaBusca:focus{ border-color:var(--c1); box-shadow:0 0 0 3px rgba(240,160,32,.14); }
    .lojaBusca::placeholder{ color:#4a5158; }
    .lojaFiltro{
      background:var(--sup); border:1px solid var(--linha); border-radius:7px;
      color:var(--txt); font-size:11px; padding:7px 11px; outline:none;
      cursor:pointer; font-weight:700; letter-spacing:.06em;
    }
    .lojaFiltro:focus{ border-color:var(--c1); }
    .lojaFiltro option{ background:var(--sup); color:var(--txt); }

    .gradeArmas{
      display:grid;
      grid-template-columns:repeat(auto-fill, minmax(150px, 1fr));
      gap:11px;
    }
    .lojaVazio{
      grid-column:1/-1; text-align:center; color:var(--fraco);
      padding:34px 12px; font-size:12px; letter-spacing:.16em;
      text-transform:uppercase; border:1px dashed var(--linha); border-radius:11px;
    }

    .cardArma{
      background:rgba(20,23,26,.72);
      border:1px solid var(--linha);
      border-radius:11px;
      overflow:hidden;
      display:flex; flex-direction:column;
      cursor:pointer;
      transition:border-color .18s, transform .14s, box-shadow .2s, opacity .2s;
      position:relative;
    }
    .cardArma:hover{
      border-color:var(--c1);
      transform:translateY(-3px);
      box-shadow:0 10px 26px rgba(0,0,0,.5);
    }
    .cardArma.tem{ border-color:rgba(240,160,32,.38); }
    .cardArma.equipada{
      border-color:rgba(94,201,122,.55);
      box-shadow:0 0 0 1px rgba(94,201,122,.25) inset;
    }
    .cardArma.desativada{
      border-color:rgba(120,120,120,.28);
      opacity:.62;
      filter:grayscale(.35);
    }
    .cardArma.desativada:hover{ opacity:.85; filter:grayscale(.15); }

    .cardArmaImg{
      height:118px;
      background:
        radial-gradient(circle at 50% 55%, rgba(240,160,32,.13), transparent 65%),
        linear-gradient(160deg,#232a31,#12161a);
      display:flex; align-items:center; justify-content:center;
      position:relative; overflow:hidden;
      border-bottom:1px solid rgba(255,255,255,.04);
    }
    .cardArmaImg .fallback{
      position:absolute; inset:0;
      display:flex; align-items:center; justify-content:center;
      text-align:center; padding:0 8px;
      font-family:var(--mono); font-size:12px; font-weight:800;
      color:rgba(240,160,32,.55); letter-spacing:.14em;
      text-transform:uppercase; line-height:1.3;
    }
    .cardArmaImg img{
      position:relative; z-index:1;
      max-width:85%; max-height:85%;
      object-fit:contain;
      filter:drop-shadow(0 6px 14px rgba(0,0,0,.65));
      -webkit-user-drag:none; user-select:none; pointer-events:none;
    }

    .cardArmaTag{
      position:absolute; top:7px; right:7px; z-index:2;
      background:linear-gradient(135deg,#e74c3c,#c0392b);
      color:#fff; font-size:9px; font-weight:900;
      padding:3px 8px; border-radius:5px;
      letter-spacing:.1em;
      box-shadow:0 3px 10px rgba(231,76,60,.5);
    }
    .cardArmaTag.sec{
      top:7px; left:7px; right:auto;
      background:linear-gradient(135deg,#4aa3ff,#2a6dbf);
      box-shadow:0 3px 10px rgba(74,163,255,.5);
    }

    .cardArmaInfo{
      padding:10px 12px 11px;
      display:flex; flex-direction:column; gap:4px; flex:1;
    }
    .cardArmaNome{
      font-size:12px; font-weight:800; letter-spacing:.06em;
      overflow:hidden; text-overflow:ellipsis; white-space:nowrap;
    }
    .cardArmaSub{
      font-size:9px; color:var(--fraco);
      letter-spacing:.12em; text-transform:uppercase;
    }
    .cardArmaPreco{
      display:flex; align-items:center; gap:8px;
      margin-top:auto; padding-top:6px;
      flex-wrap:wrap;
    }
    .cardArmaPrecoV{
      font-family:var(--mono); font-size:14px; font-weight:900;
      color:var(--ouro);
    }
    .cardArmaPrecoV.tem{ color:var(--verde); font-size:11px; letter-spacing:.08em; }
    .cardArmaPrecoOrig{
      font-family:var(--mono); font-size:10px; color:var(--fraco);
      text-decoration:line-through;
    }

    .cardArmaBtn{
      border:0; margin-top:6px;
      background:linear-gradient(135deg,var(--c2),var(--c1));
      color:#0d0f11;
      font-size:10px; font-weight:900; letter-spacing:.16em;
      padding:8px 10px; border-radius:7px;
      cursor:pointer; text-transform:uppercase;
      transition:filter .18s, transform .12s;
    }
    .cardArmaBtn:hover{ filter:brightness(1.12); }
    .cardArmaBtn:active{ transform:scale(.97); }
    .cardArmaBtn.equipar{
      background:rgba(240,160,32,.12);
      border:1px solid var(--c1);
      color:var(--c1);
    }
    .cardArma.equipada .cardArmaBtn.equipar{
      background:rgba(94,201,122,.14);
      border-color:var(--verde);
      color:var(--verde);
      cursor:default;
    }

    .ofertasWrap{ display:flex; flex-direction:column; gap:8px; }
    .ofertasJanela{
      overflow:hidden; position:relative;
      border-radius:12px;
      padding:2px 0;
      mask-image:linear-gradient(90deg, transparent, #000 4%, #000 96%, transparent);
      -webkit-mask-image:linear-gradient(90deg, transparent, #000 4%, #000 96%, transparent);
    }
    .ofertasTrilho{
      display:flex; gap:11px;
      width:max-content;
      animation:desliza 40s linear infinite;
      will-change:transform;
    }
    .ofertasJanela:hover .ofertasTrilho{ animation-play-state:paused; }
    @keyframes desliza{
      0%   { transform:translateX(0); }
      100% { transform:translateX(-50%); }
    }
    .ofertasTrilho .cardArma{
      width:170px; flex-shrink:0;
      border-color:rgba(231,76,60,.42);
      background:linear-gradient(180deg, rgba(231,76,60,.08), rgba(20,23,26,.72) 40%);
    }
    .ofertasTrilho .cardArma::before{
      content:"OFERTA";
      position:absolute; left:7px; top:7px; z-index:2;
      font-size:8px; font-weight:900; letter-spacing:.16em;
      color:#e74c3c;
      background:rgba(231,76,60,.14);
      border:1px solid rgba(231,76,60,.4);
      padding:2px 6px; border-radius:4px;
    }
    .ofertasTrilho .cardArma:hover{
      border-color:var(--c1);
    }
  `;
  document.head.appendChild(st);
}

function injetarCSSEditorHud(){
  if(el('cssEditorHudElem')) return;
  const st = document.createElement('style');
  st.id = 'cssEditorHudElem';
  st.textContent = `
    .editandoHud .hudEditEl{
      outline:2px dashed rgba(240,160,32,.75)!important;
      outline-offset:3px;cursor:grab;opacity:.96}
    .editandoHud #hud .pnl,.editandoHud #mira,.editandoHud #feed,
    .editandoHud #btPausa,.editandoHud #armaImgHud{pointer-events:auto}
    .editandoHud #feed .kill{animation:none}
    .editandoHud #chatBox{cursor:grab}
    .editandoHud #chatBox .chatInput{pointer-events:none}
    /* Paineis do editor ficam arrastaveis */
    .edTopo{cursor:grab}
    .edTopo:active{cursor:grabbing}
    #edPainel{cursor:grab}
    #edPainel input,#edPainel button{cursor:pointer}

    /* Mira vermelha ao apontar para inimigo */
    #mira.miraNoinimigo i{
      background:#ff3344!important;
      box-shadow:0 0 5px #ff3344,0 0 11px rgba(255,51,68,.7)!important;
      transition:background .08s, box-shadow .08s;
    }
    #mira.miraNoinimigo span{
      background:#ff3344!important;
      box-shadow:0 0 7px #ff3344,0 0 14px rgba(255,51,68,.8)!important;
      transition:background .08s, box-shadow .08s;
    }
    #mira i{transition:background .15s, box-shadow .15s}
    #mira span{transition:background .15s, box-shadow .15s}

    /* chatBox posicionavel */
    #chatBox{
      position:fixed;
      transition:none;
    }
  `;
  document.head.appendChild(st);
}

function prepararPaginasLobby(){
  const meio = document.querySelector('.lbMeio');
  if(!meio || el('paginaInicio')) return;

  const wrap = document.createElement('div');
  wrap.id = 'paginaInicio';
  wrap.className = 'paginaLobby on';
  while(meio.firstChild) wrap.appendChild(meio.firstChild);
  meio.appendChild(wrap);

  const loja = document.createElement('div');
  loja.id = 'paginaLoja';
  loja.className = 'paginaLobby';
  loja.innerHTML = `
    <div class="lojaTopo">
      <div class="secTit">Loja</div>
      <div class="lojaControles">
        <input class="lojaBusca" id="lojaBusca" placeholder="Buscar arma..." spellcheck="false" autocomplete="off">
        <select class="lojaFiltro" id="lojaFiltro">
          <option value="todas">Todas</option>
          <option value="desconto">Com desconto</option>
          <option value="semDesconto">Sem desconto</option>
        </select>
      </div>
    </div>
    <div class="ofertasWrap" id="ofertasWrap">
      <div class="secTit">Ofertas</div>
      <div class="ofertasJanela">
        <div class="ofertasTrilho" id="ofertasTrilho"></div>
      </div>
    </div>
    <div class="secTit">Arsenal</div>
    <div class="gradeArmas" id="gradeLoja"></div>
  `;
  meio.appendChild(loja);

  const inv = document.createElement('div');
  inv.id = 'paginaInv';
  inv.className = 'paginaLobby';
  inv.innerHTML = `
    <div class="lojaTopo">
      <div class="secTit">Meu Inventario</div>
      <div class="lojaControles">
        <input class="lojaBusca" id="invBusca" placeholder="Buscar arma..." spellcheck="false" autocomplete="off">
      </div>
    </div>
    <div class="gradeArmas" id="gradeInv"></div>
  `;
  meio.appendChild(inv);

  const b  = el('lojaBusca');
  const f  = el('lojaFiltro');
  const ib = el('invBusca');
  if(b)  b.addEventListener('input',  ()=>{ lojaBusca  = b.value.trim().toLowerCase(); renderLoja(); });
  if(f)  f.addEventListener('change', ()=>{ lojaFiltro = f.value; renderLoja(); });
  if(ib) ib.addEventListener('input', ()=>{ invBusca   = ib.value.trim().toLowerCase(); renderInventario(); });
}

function injetarNavInventario(){
  const lado = document.querySelector('.lbLado');
  if(!lado || el('navInv')) return;

  const nav = document.createElement('div');
  nav.className = 'navItem';
  nav.id = 'navInv';
  nav.dataset.nav = 'inventario';
  nav.innerHTML = `
    <svg viewBox="0 0 24 24"><path d="M20 6h-4V4a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2H4a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2zM10 4h4v2h-4V4zm10 15H4V8h16v11z"/></svg>
    <span>Inventario</span>
  `;
  const navLoja = el('navLoja');
  if(navLoja && navLoja.nextSibling){
    lado.insertBefore(nav, navLoja.nextSibling);
  } else {
    lado.appendChild(nav);
  }
  nav.onclick = ()=>{ SOM.clique(); mostrarPaginaLobby('inv'); };
}

/* =========== ONDAS =========== */
function ligarOndas(){
  const alvos = '.navItem,.lbItem,.chipUser,.iconeBtn,.bannerCard,.cardModo,.produto,.aba,.pilula.ouro,.cartaoPerfil,#btJogar,.btn,.modo,.slot,.cardArma';
  document.addEventListener('pointerdown', e=>{
    const alvo = e.target.closest(alvos);
    if(!alvo || alvo.classList.contains('cardBloq')) return;
    const r = alvo.getBoundingClientRect();
    const o = document.createElement('span');
    o.className = 'ondinha';
    const t = Math.max(r.width, r.height)*1.9;
    o.style.width = o.style.height = t+'px';
    o.style.left = (e.clientX - r.left)+'px';
    o.style.top  = (e.clientY - r.top)+'px';
    const posOrig = getComputedStyle(alvo).position;
    if(posOrig === 'static') alvo.style.position = 'relative';
    if(getComputedStyle(alvo).overflow === 'visible') alvo.style.overflow = 'hidden';
    alvo.appendChild(o);
    setTimeout(()=> o.remove(), 560);
  });
}

/* =========== HUD MOBILE =========== */
const HUD_PADRAO = {
  tAtirar : { x:88,   y:68, tam:86, opa:100 },
  tMira   : { x:74.5, y:52, tam:58, opa:100 },
  tRec    : { x:74.5, y:76, tam:54, opa:100 },
  tPular  : { x:94,   y:88, tam:54, opa:100 },
  tMed    : { x:62,   y:60, tam:50, opa:100 },
  tGren   : { x:62,   y:81, tam:50, opa:100 },
  tCorrer : { x:33,   y:88, tam:54, opa:100 },
  tAgachar: { x:20,   y:88, tam:52, opa:100 },
  tTrocar : { x:86,   y:40, tam:52, opa:100 },
  tPlacar : { x:63,   y:12, tam:46, opa:100 },
  tChat   : { x:76,   y:12, tam:46, opa:100 }
};
const HUD_NOMES = {
  tAtirar:'Atirar', tMira:'Mirar', tRec:'Recarregar', tPular:'Pular',
  tMed:'Kit medico', tGren:'Granada', tCorrer:'Correr',
  tAgachar:'Agachar', tTrocar:'Trocar arma',
  tPlacar:'Placar (Tab)',
  tChat:'Chat'
};

const HUD = {
  cfg:{}, escala:100, opacidade:100,
  editando:false, escolhido:null,

  carregar(){
    this.cfg = {};
    for(const k in HUD_PADRAO) this.cfg[k] = Object.assign({}, HUD_PADRAO[k]);
    try{
      const s = localStorage.getItem('rajada_hud');
      if(s){
        const d = JSON.parse(s);
        for(const k in d) if(this.cfg[k]) Object.assign(this.cfg[k], d[k]);
      }
      const e = localStorage.getItem('rajada_hud_escala');
      if(e) this.escala = +e;
      const o = localStorage.getItem('rajada_hud_opacidade');
      if(o) this.opacidade = +o;
    }catch(err){}
    this.aplicar();
  },
  salvar(){
    try{
      localStorage.setItem('rajada_hud', JSON.stringify(this.cfg));
      localStorage.setItem('rajada_hud_escala', this.escala);
      localStorage.setItem('rajada_hud_opacidade', this.opacidade);
    }catch(err){}
  },
  restaurar(){
    for(const k in HUD_PADRAO) this.cfg[k] = Object.assign({}, HUD_PADRAO[k]);
    this.escala = 100; this.opacidade = 100;
    this.aplicar(); this.salvar();
    const se=el('slEscalaHud'), ve=el('vlEscalaHud');
    if(se){ se.value=100; } if(ve){ ve.textContent='100%'; }
    const so=el('slOpacidadeHud'), vo=el('vlOpacidadeHud');
    if(so){ so.value=100; } if(vo){ vo.textContent='100%'; }
  },

  aplicar(){
    const f = this.escala/100;
    for(const id in this.cfg){
      const b = el(id); if(!b) continue;
      const c = this.cfg[id];
      const t = Math.round(c.tam * f);
      b.style.width = t+'px';
      b.style.height = t+'px';
      b.style.left = c.x+'%';
      b.style.top  = c.y+'%';
      b.style.right = 'auto';
      b.style.bottom = 'auto';
      b.style.marginLeft = (-t/2)+'px';
      b.style.marginTop  = (-t/2)+'px';
      b.style.opacity = (c.opa/100) * (this.opacidade/100);
      b.style.fontSize = Math.max(7, Math.round(t*0.15))+'px';
    }
    this.checarImagens();
  },

  /* Carrega imagens de TODOS os botoes via data-hud.
     Usa background-size:contain (definido no CSS) para encaixar
     imagens de qualquer tamanho no botao. */
  checarImagens(){
    for(const id in this.cfg){
      const b = el(id); if(!b || b.dataset.imgOk) continue;
      const nome = b.dataset.hud;
      if(!nome) continue;
      const url = 'imagens/hud/' + nome + '.png';
      const img = new Image();
      img.onload = ()=>{
        b.style.backgroundImage = `url('${url}')`;
        b.classList.add('comImg');
        b.dataset.imgOk = '1';
      };
      img.onerror = ()=>{
        b.classList.remove('comImg');
        b.dataset.imgOk = '0';
      };
      img.src = url;
    }
  },

  abrirEditor(){
    this.editando = true;
    this.escolhido = null;
    this.escolhidoElem = null;
    fecharModal('mdCfg');
    if(typeof S !== 'undefined' && !S.ativa){
      /* Cena vazia: sem mapa, sem bots, sem arma, sem partida rodando */
      this.modoCenaVazia = true;
      mostrarCena('cJogo');
      /* Limpa a cena 3D */
      if(cena){
        while(cena.children.length) cena.remove(cena.children[0]);
      } else {
        cena = new THREE.Scene();
      }
      cena.background = new THREE.Color(0x0d0f11);
      cena.fog = null;
      cena.add(new THREE.AmbientLight(0xffffff, 0.3));
      /* posiciona camera parada */
      if(cam){
        cam.position.set(0, 1.72, 0);
        cam.rotation.set(0, 0, 0);
        if(cam.parent) cam.parent.remove(cam);
        cena.add(cam);
      }
      /* NAO liga S.ativa para nao rodar bots/timer/rede */
      if(document.pointerLockElement) document.exitPointerLock();
      const hud = el('hud'); if(hud) hud.style.display = 'block';
      const mob = el('mob'); if(mob) mob.style.display = 'block';
      /* chatBox visivel para poder arrastar */
      const chatBx = el('chatBox'); if(chatBx) chatBx.classList.add('on');
    } else if(typeof S !== 'undefined' && S.ativa){
      TRAVADO = true;
      if(document.pointerLockElement) document.exitPointerLock();
      const p = el('pausa'); if(p) p.classList.remove('on');
      S.pausada = false;
      el('mob').style.display = 'block';
    }
    el('mob').classList.add('editando');
    el('editorHud').classList.add('on');
    el('edPainel').classList.remove('on');
    document.body.classList.add('editandoHud');
    HUD_ELEM_EDIT.forEach(([sel])=>{
      const e = document.querySelector(sel);
      if(e){ e.style.pointerEvents = 'auto'; e.classList.add('hudEditEl'); }
    });
    /* chatBox tambem editavel */
    const chatBxEl = el('chatBox');
    if(chatBxEl){ chatBxEl.style.pointerEvents = 'auto'; chatBxEl.classList.add('hudEditEl'); ligarArrastoChatBox(); }
  },
  fecharEditor(){
    this.editando = false;
    this.escolhido = null;
    this.escolhidoElem = null;
    el('mob').classList.remove('editando');
    el('editorHud').classList.remove('on');
    el('edPainel').classList.remove('on');
    document.body.classList.remove('editandoHud');
    document.querySelectorAll('.tBtn').forEach(b=> b.classList.remove('escolhido'));
    HUD_ELEM_EDIT.forEach(([sel])=>{
      const e = document.querySelector(sel);
      if(e){ e.classList.remove('hudEditEl'); e.style.pointerEvents = ''; }
    });
    /* remove classe de edicao do chatBox */
    const chatBxEl = el('chatBox');
    if(chatBxEl){ chatBxEl.classList.remove('hudEditEl'); chatBxEl.style.pointerEvents = ''; }
    this.salvar();
    salvarHudElem();
    salvarChatBoxPos();
    if(this.modoCenaVazia){
      this.modoCenaVazia = false;
      const hud = el('hud'); if(hud) hud.style.display = 'none';
      const mob = el('mob'); if(mob) mob.style.display = 'none';
      const chatBx2 = el('chatBox'); if(chatBx2) chatBx2.classList.remove('on');
      pintarLobby(); mostrarCena('cLobby');
      return;
    }
    if(typeof S !== 'undefined' && S.ativa && !S.fim) TRAVADO = false;
    if(!(typeof S !== 'undefined' && S.ativa)) el('mob').style.display = 'none';
  },
  escolherElem(sel){
    this.escolhido = sel;
    document.querySelectorAll('.tBtn').forEach(b=> b.classList.remove('escolhido'));
    const c = HUD_ELEM_CFG[sel] = HUD_ELEM_CFG[sel] || { x:50, y:50, opa:100, s:1 };
    if(c.x === undefined){ c.x = 50; c.y = 50; }
    if(c.opa === undefined) c.opa = 100;
    if(c.s === undefined) c.s = 1;
    const nome = (HUD_ELEM_EDIT.find(x=>x[0]===sel) || [sel, sel])[1];
    el('edNomeBt').textContent = nome;
    const t=el('edTam'), tv=el('edTamV'), o=el('edOpa'), ov=el('edOpaV');
    if(t){ t.value = Math.round(c.s * 100); } if(tv){ tv.textContent = Math.round(c.s * 100) + '%'; }
    if(o){ o.value = c.opa; } if(ov){ ov.textContent = c.opa + '%'; }
    el('edPainel').classList.add('on');
    this.escolhidoElem = sel;
  },
  escolher(id){
    this.escolhido = id;
    this.escolhidoElem = null;
    document.querySelectorAll('.tBtn').forEach(b=>
      b.classList.toggle('escolhido', b.id === id));
    const c = this.cfg[id]; if(!c) return;
    el('edNomeBt').textContent = HUD_NOMES[id] || id;
    const t=el('edTam'), tv=el('edTamV'), o=el('edOpa'), ov=el('edOpaV');
    if(t){ t.value=c.tam; } if(tv){ tv.textContent=c.tam; }
    if(o){ o.value=c.opa; } if(ov){ ov.textContent=c.opa+'%'; }
    el('edPainel').classList.add('on');
  },

  ligar(){
    this.carregar();
    carregarHudElem();

    document.querySelectorAll('.tBtn').forEach(b=>{
      let arrastando=false, idToque=null, dx=0, dy=0;

      b.addEventListener('touchstart', e=>{
        if(!HUD.editando) return;
        e.preventDefault(); e.stopPropagation();
        const t = e.changedTouches[0];
        idToque = t.identifier; arrastando = true;
        HUD.escolher(b.id);
        const r = b.getBoundingClientRect();
        dx = t.clientX - (r.left + r.width/2);
        dy = t.clientY - (r.top + r.height/2);
      }, {passive:false});

      b.addEventListener('touchmove', e=>{
        if(!HUD.editando || !arrastando) return;
        e.preventDefault(); e.stopPropagation();
        for(const t of e.changedTouches){
          if(t.identifier !== idToque) continue;
          const c = HUD.cfg[b.id]; if(!c) continue;
          c.x = Math.max(4, Math.min(96, (t.clientX-dx)/innerWidth*100));
          c.y = Math.max(6, Math.min(94, (t.clientY-dy)/innerHeight*100));
          HUD.aplicar();
        }
      }, {passive:false});

      const soltar = ()=>{ arrastando=false; idToque=null; };
      b.addEventListener('touchend', soltar);
      b.addEventListener('touchcancel', soltar);

      b.addEventListener('mousedown', e=>{
        if(!HUD.editando) return;
        e.preventDefault();
        HUD.escolher(b.id);
        const r = b.getBoundingClientRect();
        const mx = e.clientX-(r.left+r.width/2), my = e.clientY-(r.top+r.height/2);
        const mover = ev=>{
          const c = HUD.cfg[b.id]; if(!c) return;
          c.x = Math.max(4, Math.min(96, (ev.clientX-mx)/innerWidth*100));
          c.y = Math.max(6, Math.min(94, (ev.clientY-my)/innerHeight*100));
          HUD.aplicar();
        };
        const parar = ()=>{ removeEventListener('mousemove',mover); removeEventListener('mouseup',parar); };
        addEventListener('mousemove',mover); addEventListener('mouseup',parar);
      });
    });

    HUD_ELEM_EDIT.forEach(([sel])=>{
      const e = document.querySelector(sel);
      if(e) ligarArrastoElem(e, sel);
    });

    const lg=(id,ev,fn)=>{ const e=el(id); if(e) e.addEventListener(ev,fn); };
    lg('edTam','input', e=>{
      if(HUD.escolhidoElem){
        const c = HUD_ELEM_CFG[HUD.escolhidoElem]; if(!c) return;
        c.s = Math.max(0.5, Math.min(1.8, (+e.target.value) / 100));
        el('edTamV').textContent = e.target.value + '%';
        aplicarHudElem(); salvarHudElem();
        return;
      }
      if(!HUD.escolhido) return;
      HUD.cfg[HUD.escolhido].tam = +e.target.value;
      el('edTamV').textContent = e.target.value;
      HUD.aplicar();
    });
    lg('edOpa','input', e=>{
      if(HUD.escolhidoElem){
        const c = HUD_ELEM_CFG[HUD.escolhidoElem]; if(!c) return;
        c.opa = +e.target.value;
        el('edOpaV').textContent = e.target.value + '%';
        aplicarHudElem(); salvarHudElem();
        return;
      }
      if(!HUD.escolhido) return;
      HUD.cfg[HUD.escolhido].opa = +e.target.value;
      el('edOpaV').textContent = e.target.value+'%';
      HUD.aplicar();
    });
    lg('edSalvar','click', ()=>{ HUD.fecharEditor(); abrirModal('mdCfg'); });
    lg('edRestaurar','click', ()=>{ HUD.restaurar(); resetHudElem(); });

    /* Arrasto do edTopo e edPainel para nao atrapalhar a visao dos botoes */
    ligarArrastoEditorPanel(document.querySelector('.edTopo'), 'edTopo');
    ligarArrastoEditorPanel(el('edPainel'), 'edPainel');

    lg('slEscalaHud','input', e=>{
      HUD.escala = +e.target.value;
      el('vlEscalaHud').textContent = e.target.value+'%';
      HUD.aplicar(); HUD.salvar();
    });
    lg('slOpacidadeHud','input', e=>{
      HUD.opacidade = +e.target.value;
      el('vlOpacidadeHud').textContent = e.target.value+'%';
      HUD.aplicar(); HUD.salvar();
    });
    lg('btEditarHud','click', ()=> HUD.abrirEditor());

    const se=el('slEscalaHud'), ve=el('vlEscalaHud');
    if(se){ se.value=this.escala; } if(ve){ ve.textContent=this.escala+'%'; }
    const so=el('slOpacidadeHud'), vo=el('vlOpacidadeHud');
    if(so){ so.value=this.opacidade; } if(vo){ vo.textContent=this.opacidade+'%'; }
  }
};

const HUD_ELEM_EDIT = [
  ['#pTopo',    'Placar / tempo'],
  ['#pEquipe',  'Painel da equipe'],
  ['#pVida',    'Vida / colete'],
  ['#pItens',   'Itens'],
  ['#pArma',    'Municao'],
  ['#armaImgHud','Imagem da arma'],
  ['#mira',     'Mira'],
  ['#feed',     'Registro de abates'],
  ['#btPausa',  'Botao de pausa'],
  ['#chatBox',  'Chat (mensagens)']
];
let HUD_ELEM_CFG = {};
function carregarHudElem(){
  HUD_ELEM_CFG = {};
  try{
    const s = localStorage.getItem('rajada_hud_elem');
    if (s) HUD_ELEM_CFG = JSON.parse(s) || {};
  }catch(e){}
  aplicarHudElem();
  aplicarChatBoxPos();
}
function salvarHudElem(){
  try{ localStorage.setItem('rajada_hud_elem', JSON.stringify(HUD_ELEM_CFG)); }catch(e){}
}
function aplicarHudElem(){
  for(const sel in HUD_ELEM_CFG){
    const e = document.querySelector(sel); if(!e) continue;
    const c = HUD_ELEM_CFG[sel];
    if(c.x !== undefined){
      e.style.left = c.x + '%';
      e.style.top  = c.y + '%';
      e.style.right = 'auto';
      e.style.bottom = 'auto';
      e.style.transform = 'translate(-50%,-50%)' + (c.s && c.s !== 1 ? ' scale(' + c.s + ')' : '');
    } else if (c.s && c.s !== 1){
      e.style.transform = 'translate(-50%,-50%) scale(' + c.s + ')';
    }
    if(c.opa !== undefined) e.style.opacity = c.opa / 100;
  }
  /* aplica posicao salva do chatBox separadamente */
  aplicarChatBoxPos();
}
function resetHudElem(){
  HUD_ELEM_CFG = {};
  salvarHudElem();
  HUD_ELEM_EDIT.forEach(([sel])=>{
    const e = document.querySelector(sel); if(!e) return;
    e.style.left = ''; e.style.top = ''; e.style.right = '';
    e.style.bottom = ''; e.style.transform = ''; e.style.opacity = '';
  });
  /* reseta o chatBox para posicao padrao */
  const chatBxR = el('chatBox');
  if(chatBxR){
    chatBxR.style.left = ''; chatBxR.style.top = '';
    chatBxR.style.right = ''; chatBxR.style.bottom = '';
    chatBxR.style.transform = '';
  }
  location.reload();
}
function ligarArrastoElem(e, sel){
  let arr = false, idT = null, px = 0, py = 0;
  const moverPara = (cx, cy)=>{
    const c = HUD_ELEM_CFG[sel] = HUD_ELEM_CFG[sel] || {};
    c.x = Math.max(3, Math.min(97, (cx - px) / innerWidth * 100));
    c.y = Math.max(4, Math.min(96, (cy - py) / innerHeight * 100));
    aplicarHudElem();
  };
  e.addEventListener('touchstart', ev=>{
    if(!HUD.editando) return;
    ev.preventDefault(); ev.stopPropagation();
    const t = ev.changedTouches[0];
    idT = t.identifier; arr = true;
    HUD.escolherElem(sel);
    px = 0; py = 0;
    const r = e.getBoundingClientRect();
    px = t.clientX - (r.left + r.width/2);
    py = t.clientY - (r.top + r.height/2);
  }, {passive:false});
  e.addEventListener('touchmove', ev=>{
    if(!HUD.editando || !arr) return;
    ev.preventDefault(); ev.stopPropagation();
    for(const t of ev.changedTouches){
      if(t.identifier !== idT) continue;
      moverPara(t.clientX, t.clientY);
    }
  }, {passive:false});
  const fim = ev=>{
    for(const t of ev.changedTouches) if(t.identifier === idT){ arr = false; idT = null; }
  };
  e.addEventListener('touchend', fim);
  e.addEventListener('touchcancel', fim);
  e.addEventListener('mousedown', ev=>{
    if(!HUD.editando) return;
    ev.preventDefault(); ev.stopPropagation();
    HUD.escolherElem(sel);
    const r = e.getBoundingClientRect();
    const ox = ev.clientX - (r.left + r.width/2);
    const oy = ev.clientY - (r.top + r.height/2);
    const mv2 = ev2=>{ moverPara(ev2.clientX - ox, ev2.clientY - oy); };
    const up = ()=>{ removeEventListener('mousemove', mv2); removeEventListener('mouseup', up); };
    addEventListener('mousemove', mv2); addEventListener('mouseup', up);
  });
}

/* =========== ARRASTO DOS PAINEIS DO EDITOR (edTopo / edPainel) =========== */
const _edPainelPos = {};
function ligarArrastoEditorPanel(elem, chave){
  if(!elem || elem._arrastoEd) return;
  elem._arrastoEd = true;

  /* Transforma o elemento em posicionado livremente */
  const aplicar = (px, py)=>{
    elem.style.position  = 'fixed';
    elem.style.left      = px + 'px';
    elem.style.top       = py + 'px';
    elem.style.right     = 'auto';
    elem.style.bottom    = 'auto';
    elem.style.transform = 'none';
    _edPainelPos[chave] = { x: px, y: py };
  };

  /* Restaura posicao salva (session apenas, nao persiste) */
  if(_edPainelPos[chave]){
    const s = _edPainelPos[chave];
    elem.style.position = 'fixed';
    elem.style.left = s.x + 'px'; elem.style.top = s.y + 'px';
    elem.style.right = 'auto'; elem.style.bottom = 'auto';
    elem.style.transform = 'none';
  }

  let idT = null, arr = false, ox = 0, oy = 0;

  elem.addEventListener('touchstart', ev=>{
    if(!HUD.editando) return;
    /* Nao arrasta se clicar em input/button */
    if(ev.target.matches('input,button,select')) return;
    ev.preventDefault(); ev.stopPropagation();
    const t = ev.changedTouches[0];
    idT = t.identifier; arr = true;
    const r = elem.getBoundingClientRect();
    ox = t.clientX - r.left; oy = t.clientY - r.top;
  },{passive:false});

  elem.addEventListener('touchmove', ev=>{
    if(!arr) return;
    ev.preventDefault(); ev.stopPropagation();
    for(const t of ev.changedTouches){
      if(t.identifier !== idT) continue;
      const r = elem.getBoundingClientRect();
      const nx = Math.max(0, Math.min(innerWidth  - r.width,  t.clientX - ox));
      const ny = Math.max(0, Math.min(innerHeight - r.height, t.clientY - oy));
      aplicar(nx, ny);
    }
  },{passive:false});

  const fimT = ev=>{
    for(const t of ev.changedTouches) if(t.identifier===idT){ arr=false; idT=null; }
  };
  elem.addEventListener('touchend', fimT);
  elem.addEventListener('touchcancel', fimT);

  elem.addEventListener('mousedown', ev=>{
    if(!HUD.editando) return;
    if(ev.target.matches('input,button,select')) return;
    ev.preventDefault();
    elem.style.cursor = 'grabbing';
    const r = elem.getBoundingClientRect();
    const lox = ev.clientX - r.left, loy = ev.clientY - r.top;
    const mv = ev2=>{
      const nx = Math.max(0, Math.min(innerWidth  - r.width,  ev2.clientX - lox));
      const ny = Math.max(0, Math.min(innerHeight - r.height, ev2.clientY - loy));
      aplicar(nx, ny);
    };
    const up = ()=>{
      elem.style.cursor = 'grab';
      removeEventListener('mousemove', mv);
      removeEventListener('mouseup', up);
    };
    addEventListener('mousemove', mv);
    addEventListener('mouseup', up);
  });
}

/* =========== ARRASTO DO CHATBOX NO EDITOR HUD =========== */
let _chatBxDragAtivo = false;
function ligarArrastoChatBox(){
  const box = el('chatBox');
  if(!box || box._arrastoChat) return;
  box._arrastoChat = true;

  /* garante que o box esta posicionado de forma absoluta/fixa */
  const moverPara = (cx, cy)=>{
    const px = Math.max(2, Math.min(98, cx / innerWidth  * 100));
    const py = Math.max(2, Math.min(94, cy / innerHeight * 100));
    box.style.left   = px + '%';
    box.style.top    = py + '%';
    box.style.bottom = 'auto';
    box.style.right  = 'auto';
    box.style.transform = 'translate(-50%,-50%)';
    const cfg = HUD_ELEM_CFG['#chatBox'] = HUD_ELEM_CFG['#chatBox'] || {};
    cfg.x = px; cfg.y = py;
    salvarHudElem();
  };

  let arrT = false, idT = null, oxT = 0, oyT = 0;
  box.addEventListener('touchstart', ev=>{
    if(!HUD.editando) return;
    /* so arrasta se tocar no log (nao no input) */
    if(ev.target.closest('#chatInput')) return;
    ev.preventDefault(); ev.stopPropagation();
    const t = ev.changedTouches[0];
    idT = t.identifier; arrT = true;
    const r = box.getBoundingClientRect();
    oxT = t.clientX - (r.left + r.width/2);
    oyT = t.clientY - (r.top  + r.height/2);
    HUD.escolherElem('#chatBox');
  },{passive:false});
  box.addEventListener('touchmove', ev=>{
    if(!HUD.editando || !arrT) return;
    ev.preventDefault(); ev.stopPropagation();
    for(const t of ev.changedTouches){
      if(t.identifier !== idT) continue;
      moverPara(t.clientX - oxT, t.clientY - oyT);
    }
  },{passive:false});
  const fimT = ev=>{
    for(const t of ev.changedTouches) if(t.identifier===idT){ arrT=false; idT=null; }
  };
  box.addEventListener('touchend',   fimT);
  box.addEventListener('touchcancel',fimT);

  box.addEventListener('mousedown', ev=>{
    if(!HUD.editando) return;
    if(ev.target.closest('#chatInput')) return;
    ev.preventDefault(); ev.stopPropagation();
    HUD.escolherElem('#chatBox');
    const r = box.getBoundingClientRect();
    const ox = ev.clientX - (r.left + r.width/2);
    const oy = ev.clientY - (r.top  + r.height/2);
    const mv = ev2=>{ moverPara(ev2.clientX - ox, ev2.clientY - oy); };
    const up = ()=>{ removeEventListener('mousemove',mv); removeEventListener('mouseup',up); };
    addEventListener('mousemove', mv);
    addEventListener('mouseup',   up);
  });
}

function salvarChatBoxPos(){
  const box = el('chatBox'); if(!box) return;
  const cfg = HUD_ELEM_CFG['#chatBox'];
  if(cfg) salvarHudElem();
}

function aplicarChatBoxPos(){
  const cfg = HUD_ELEM_CFG['#chatBox'];
  if(!cfg || cfg.x === undefined) return;
  const box = el('chatBox'); if(!box) return;
  box.style.left      = cfg.x + '%';
  box.style.top       = cfg.y + '%';
  box.style.bottom    = 'auto';
  box.style.right     = 'auto';
  box.style.transform = 'translate(-50%,-50%)';
}

function ligarAbasCfg(){
  document.querySelectorAll('.cfgAba').forEach(a=>{
    a.onclick = ()=>{
      const alvo = a.dataset.cfg;
      document.querySelectorAll('.cfgAba').forEach(x=> x.classList.remove('on'));
      a.classList.add('on');
      document.querySelectorAll('.cfgPag').forEach(p=> p.classList.remove('on'));
      const mapa = { mira:'cfgMira', video:'cfgVideo', audio:'cfgAudio', controles:'cfgControles' };
      const p = el(mapa[alvo]); if(p) p.classList.add('on');
      if(typeof SOM !== 'undefined' && SOM.clique) SOM.clique();
    };
  });
  document.querySelectorAll('.chaveBt').forEach(c=>{
    c.onclick = ()=>{
      c.classList.toggle('on');
      const v = c.classList.contains('on');
      if(c.id === 'chTelaCheia'){ OPC.telaCheia = v; if(v) pedirTelaCheia(); else sairTelaCheia(); }
      if(c.id === 'chTiroAuto') OPC.tiroAuto = v;
      if(c.id === 'chVibrar')   OPC.vibrar   = v;
      if(c.id === 'chJoyFixo')  OPC.joyFixo  = v;
      salvarOpcoes();
      if(typeof SOM !== 'undefined' && SOM.clique) SOM.clique();
    };
  });
  /* Modo de mira — radio buttons */
  document.querySelectorAll('input[name="modoMira"]').forEach(r=>{
    r.onchange = ()=>{
      if(!r.checked) return;
      OPC.modoMira = r.value;
      atualizarDescModoMira();
      salvarOpcoes();
      if(typeof SOM !== 'undefined' && SOM.clique) SOM.clique();
    };
  });
}

const OPC = { telaCheia:true, tiroAuto:false, vibrar:true, joyFixo:false, modoMira:'normal' };
function salvarOpcoes(){
  try{ localStorage.setItem('rajada_opcoes', JSON.stringify(OPC)); }catch(e){}
}
function carregarOpcoes(){
  try{
    const s = localStorage.getItem('rajada_opcoes');
    if(s) Object.assign(OPC, JSON.parse(s));
  }catch(e){}
  const par = [['chTelaCheia','telaCheia'],['chTiroAuto','tiroAuto'],
               ['chVibrar','vibrar'],['chJoyFixo','joyFixo']];
  par.forEach(([id,k])=>{ const c=el(id); if(c) c.classList.toggle('on', !!OPC[k]); });
  /* Restaura radio de modoMira */
  const modoAtual = OPC.modoMira || 'normal';
  document.querySelectorAll('input[name="modoMira"]').forEach(r=>{
    r.checked = (r.value === modoAtual);
  });
  atualizarDescModoMira();
}
function atualizarDescModoMira(){
  const desc = el('descModoMira'); if(!desc) return;
  const textos = {
    solta:  'A mira não gruda — você mira manualmente.',
    normal: 'A mira corrige levemente ao atirar no inimigo.',
    precisa:'A mira gruda forte no inimigo ao atirar.'
  };
  desc.textContent = textos[OPC.modoMira || 'normal'] || '';
}
function vibrar(ms){
  if(!OPC.vibrar || !navigator.vibrate) return;
  try{ navigator.vibrate(ms||18); }catch(e){}
}

function pedirTelaCheia(){
  if(!ehCelular()) return;
  const d = document.documentElement;
  const f = d.requestFullscreen || d.webkitRequestFullscreen || d.mozRequestFullScreen;
  if(f){ try{ const p = f.call(d, {navigationUI:'hide'}); if(p&&p.catch) p.catch(()=>{}); }catch(e){} }
  travarPaisagem();
  ligarTela();
}
function sairTelaCheia(){
  const f = document.exitFullscreen || document.webkitExitFullscreen;
  if(f && document.fullscreenElement){ try{ f.call(document); }catch(e){} }
}
function travarPaisagem(){
  try{
    if(screen.orientation && screen.orientation.lock){
      const p = screen.orientation.lock('landscape');
      if(p && p.catch) p.catch(()=>{});
    }
  }catch(e){}
}

function checarOrientacao(){
  const tela = el('girar'); if(!tela) return;
  if(!ehCelular()){ tela.classList.remove('on'); return; }
  const emPe = innerHeight > innerWidth;
  tela.classList.toggle('on', emPe);
  if(emPe){
    if(typeof S !== 'undefined' && S.ativa && !S.pausada) togglePausa(true);
  }
}
function ligarOrientacao(){
  checarOrientacao();
  addEventListener('resize', checarOrientacao);
  addEventListener('orientationchange', ()=> setTimeout(checarOrientacao, 220));
  const entrar = ()=>{
    if(OPC.telaCheia) pedirTelaCheia();
    ligarTela();
    removeEventListener('touchend', entrar);
    removeEventListener('click', entrar);
  };
  addEventListener('touchend', entrar, {passive:true});
  addEventListener('click', entrar);
}

function ligarInterface(){
  ligarOndas();
  document.querySelectorAll('[data-fecha]').forEach(b=> b.onclick = ()=> fecharModal(b.dataset.fecha));
  document.querySelectorAll('.modal').forEach(m=> m.addEventListener('click', e=>{ if(e.target===m) m.classList.remove('on'); }));

  let modoAuth = 'login';
  const setAuthModo = (m) => {
    modoAuth = m;
    const tl = el('tabLogin'), tr = el('tabRegistrar');
    if(tl) tl.classList.toggle('on', m === 'login');
    if(tr) tr.classList.toggle('on', m === 'registrar');
    const at = el('authTitulo'), as = el('authSub');
    if(at) at.textContent = m === 'login' ? 'Entrar no jogo' : 'Criar conta';
    if(as) as.textContent = m === 'login' ? 'Use seu e-mail e senha para acessar.' : 'Escolha um e-mail, nick e senha (min. 8 caracteres).';
    /* Mostra/esconde campo nick e seu wrapper */
    const wn = el('wrapNick');
    if(wn) wn.style.display = (m === 'registrar') ? 'block' : 'none';
    const nn = el('inpNickAuth'); if(nn) nn.style.display = '';
    const ba = el('btAuth');
    if(ba) ba.textContent = (m === 'login') ? 'ENTRAR NO CAMPO' : 'CRIAR CONTA';
    const se = el('inpSenha'); if(se) se.autocomplete = (m === 'login') ? 'current-password' : 'new-password';
    const am = el('authMsg'); if(am){ am.textContent = ''; am.className = 'authMsg'; }
  };
  const tabLogin = el('tabLogin'), tabRegistrar = el('tabRegistrar');
  if(tabLogin) tabLogin.onclick = ()=> setAuthModo('login');
  if(tabRegistrar) tabRegistrar.onclick = ()=> setAuthModo('registrar');
  const formAuth = el('formAuth');
  if(formAuth) formAuth.addEventListener('submit', (e)=>{ e.preventDefault(); const bt = el('btAuth'); if(bt) bt.click(); });
  const btAuth = el('btAuth');

  const entrarComoLogado = async () => {
    await API.carregarPerfilServidor();
    AUDIO.setVolumeEfeitos((P.volSom ?? 70) / 100);
    AUDIO.setVolumeFundo((P.volMusica ?? 35) / 100);
    carregar(['Autenticando','Sincronizando progresso','Carregando menu principal'], ()=>{ pintarLobby(); mostrarCena('cLobby'); });
  };

  if(btAuth){
    btAuth.onclick = async () => {
      const email = el('inpEmail').value.trim();
      const nick  = el('inpNickAuth').value.trim();
      const senha = el('inpSenha').value;
      const msg   = el('authMsg');
      if(msg) msg.className = 'authMsg';
      if (!email || !senha || (modoAuth === 'registrar' && !nick)) { if(msg) msg.textContent = 'Preencha todos os campos.'; return; }
      el('btAuth').disabled = true;
      try {
        let r = modoAuth === 'login' ? await API.login(email, senha) : await API.registrar(email, nick, senha);

        /* Conta em uso em outro dispositivo */
        if (!r.ok && r.erro === 'conta_em_uso' && modoAuth === 'login'){
          const ok = confirm('Esta conta ja esta sendo usada em outro dispositivo.\n\nDeseja desconectar a outra sessao e continuar aqui?');
          if (!ok){
            msg.textContent = 'Conta em uso em outro dispositivo.';
            return;
          }
          r = await API.login(email, senha, true); /* forcar_login = true */
          if (!r.ok){
            msg.textContent = 'Nao foi possivel encerrar a outra sessao. Tente novamente.';
            return;
          }
        }

        if (!r.ok) {
          const textos = {
            credenciais:'E-mail ou senha incorretos.', email_invalido:'E-mail invalido.',
            nick_invalido:'Nick invalido (3 a 14 letras/numeros/_-.).', senha_curta:'A senha precisa de pelo menos 8 caracteres.',
            ja_existe:'Esse e-mail ou nick ja esta em uso.', muitas_tentativas:'Muitas tentativas. Aguarde alguns minutos.',
            conta_em_uso:'Conta em uso em outro dispositivo.',
            rede:'Falha de rede. Verifique sua conexao.'
          };
          msg.textContent = textos[r.erro] || 'Erro. Tente novamente.'; return;
        }
        await entrarComoLogado();
      } finally { el('btAuth').disabled = false; }
    };
  }
  const inpSenha = el('inpSenha');
  if(inpSenha) inpSenha.addEventListener('keydown', e=>{ if(e.key==='Enter'){ e.preventDefault(); const b=el('btAuth'); if(b) b.click(); } });
  const btLogout = el('btLogout');
  if(btLogout) btLogout.onclick = async () => { await API.logout(); P.nick=''; carregar(['Encerrando sessao'], ()=>{ mostrarCena('cAuth'); setAuthModo('login'); }); };
  if (el('cAuth')) setAuthModo('login');
  const btJogar = el('btJogar');
  if(btJogar) btJogar.onclick = ()=>{ SOM.clique(); NET.conectar(P.nick || 'Anon'); NET.entrarFila('tatico'); mostrarMatchmaking(MODOS[0]); };

  /* Botão amigos no lobby */
  const btAmigos = el('btAmigos');
  if(btAmigos) btAmigos.onclick = ()=>{ SOM.clique(); AMIGOS.abrirModal(); };
  const btAbrirAmigos = el('btAbrirAmigos');
  if(btAbrirAmigos) btAbrirAmigos.onclick = ()=>{ SOM.clique(); AMIGOS.abrirModal(); };

  /* Modal modo competitivo (X1/X2) */
  const mdComp = el('mdModoComp');
  if(mdComp){
    const btFilaComp = el('btFilaComp');
    if(btFilaComp) btFilaComp.onclick = ()=>{
      const modo = mdComp.dataset.modo || 'x1';
      fecharModal('mdModoComp');
      NET.conectar(P.nick || 'Anon');
      NET.entrarFila(modo);
      mostrarMatchmaking(MODOS.find(m=>m.id===modo));
    };
    const btGrupoComp = el('btGrupoComp');
    if(btGrupoComp) btGrupoComp.onclick = ()=>{
      const modo = mdComp.dataset.modo || 'x1';
      fecharModal('mdModoComp');
      NET.conectar(P.nick || 'Anon');
      NET.enviar({ type:'criar_grupo', modo });
      aviso('Grupo criado! Convide amigos.');
    };
  }

  /* Adicionar amigo */
  const btAddAmigo = el('btAddAmigo');
  if(btAddAmigo) btAddAmigo.onclick = async ()=>{
    const inp = el('inpAddAmigo');
    if(!inp) return;
    const nick = inp.value.trim();
    if(!nick){ aviso('Digite um nick'); return; }
    const r = await API.pedir('enviar_solicitacao', { nick });
    if(r.ok){ aviso('Pedido enviado para '+nick); inp.value=''; await AMIGOS.carregarDoServidor(); AMIGOS.renderModal(); }
    else {
      const msgs = { nick_invalido:'Nick inválido', usuario_nao_encontrado:'Jogador não encontrado',
        ja_amigos:'Já são amigos', solicitacao_pendente:'Pedido já enviado' };
      aviso(msgs[r.erro] || 'Erro ao enviar pedido');
    }
  };
  const mmCancel = el('mmCancelar');
  if (mmCancel) mmCancel.onclick = ()=>{ NET.sairFila(); esconderMatchmaking(); };

  /* Event delegation — captura cliques em navItems presentes E futuros */
  const lbLado = document.querySelector('.lbLado');
  if(lbLado){
    lbLado.addEventListener('click', e => {
      const n = e.target.closest('.navItem');
      if(!n) return;
      SOM.clique();
      const alvo = n.dataset.nav;
      const id   = n.id;
      if(alvo === 'inicio'){
        mostrarPaginaLobby('inicio');
      } else if(alvo === 'jogar' || id === 'navJogar'){
        mostrarPaginaLobby('inicio');
        const l = el('listaModos'); if(l) l.scrollIntoView({behavior:'smooth',block:'center'});
      } else if(alvo === 'loja' || id === 'navLoja'){
        mostrarPaginaLobby('loja');
      } else if(alvo === 'inventario' || id === 'navInv'){
        mostrarPaginaLobby('inv');
      } else if(alvo === 'ranque' || id === 'navRanque'){
        abrirRanque();
      } else if(id === 'btAmigos'){
        AMIGOS.abrirModal();
      } else if(id === 'navTemporadas'){
        mostrarPaginaLobby('temporadas');
      } else if(id === 'navCaixas'){
        mostrarPaginaLobby('caixas');
      } else {
        document.querySelectorAll('.navItem').forEach(x => x.classList.remove('on'));
        n.classList.add('on');
      }
    });
  }

  const btCfgTopo = el('btCfgTopo');
  if(btCfgTopo) btCfgTopo.onclick = ()=>{ SOM.clique(); abrirModal('mdCfg'); };
  const btBannerCard = el('btBannerCard');
  if(btBannerCard) btBannerCard.onclick = ()=>{ SOM.clique(); NET.conectar(P.nick || 'Anon'); NET.entrarFila(); mostrarMatchmaking(); };
  const cp = document.querySelector('.cartaoPerfil');
  if(cp){ cp.style.cursor='pointer'; cp.onclick = ()=>{ SOM.clique(); abrirRanque(); }; }
  const pc = document.querySelector('.pilula.ouro');
  if(pc){ pc.style.cursor='pointer'; pc.onclick = ()=>{ SOM.clique(); mostrarPaginaLobby('loja'); }; }
  addEventListener('keydown', e=>{
    if(e.key !== 'Escape') return;
    const aberto = document.querySelector('.modal.on');
    if(aberto){ aberto.classList.remove('on'); e.stopPropagation(); }
  });
  const btp = el('btPausa');
  if(btp){
    btp.innerHTML = '<svg viewBox="0 0 24 24" style="width:20px;height:20px;fill:#e8eaed"><path d="M19.1 12.9c0-.3.1-.6.1-.9s0-.6-.1-.9l2-1.6c.2-.1.2-.4.1-.6l-1.9-3.3c-.1-.2-.4-.3-.6-.2l-2.4 1c-.5-.4-1-.7-1.6-.9l-.4-2.6c0-.2-.2-.4-.5-.4h-3.8c-.2 0-.4.2-.5.4l-.4 2.6c-.6.2-1.1.6-1.6.9l-2.4-1c-.2-.1-.5 0-.6.2L2.7 8.9c-.1.2-.1.4.1.6l2 1.6c0 .3-.1.6-.1.9s0 .6.1.9l-2 1.6c-.2.1-.2.4-.1.6l1.9 3.3c.1.2.4.3.6.2l2.4-1c.5.4 1 .7 1.6.9l.4 2.6c.1.2.2.4.5.4h3.8c.2 0 .4-.2.5-.4l.4-2.6c.6-.2 1.1-.6 1.6-.9l2.4 1c.2.1.5 0 .6-.2l1.9-3.3c.1-.2.1-.5-.1-.6l-2-1.6zM12 15.6c-2 0-3.6-1.6-3.6-3.6S10 8.4 12 8.4s3.6 1.6 3.6 3.6-1.6 3.6-3.6 3.6z"/></svg>';
    btp.title = 'Menu / Pausa';
  }
  liga('btPausa','click', ()=> togglePausa(true));
  liga('btRetomar','click', ()=> togglePausa(false));
  liga('btSairPartida','click', ()=> sairDaPartida());
  liga('btVoltarLobby','click', ()=>{ carregar(['Carregando menu','Sincronizando perfil'], ()=>{ pintarLobby(); mostrarCena('cLobby'); }); });
  const par = (a,b,rot,aplica,fmt)=>{
    const sync = v =>{
      const ea=el(a), eb=el(b), r0=el(rot[0]), r1=el(rot[1]);
      if(ea) ea.value = v; if(eb) eb.value = v;
      const txt = fmt ? fmt(v) : v+'%';
      if(r0) r0.textContent = txt; if(r1) r1.textContent = txt;
      aplica(+v); salvarPerfil();
    };
    liga(a,'input', e=> sync(e.target.value));
    liga(b,'input', e=> sync(e.target.value));
    return sync;
  };
  const syncSens = par('slSens','slSensP',['vlSens','vlSensP'], v=> P.sens=v);
  const syncMira = par('slSensMira','slSensMiraP',['vlSensMira','vlSensMiraP'], v=> P.sensMira=v);
  par('slVolSom', 'slVolSomP', ['vlVolSom', 'vlVolSomP'], v => { P.volSom = v; AUDIO.setVolumeEfeitos(v/100); }, v => v+'%');
  par('slVolMusica', 'slVolMusicaP', ['vlVolMusica', 'vlVolMusicaP'], v => { P.volMusica = v; AUDIO.setVolumeFundo(v/100); }, v => v+'%');
  const QUAL = ['','Baixa','Media','Alta'];
  const texto = (id,v)=>{ const e=el(id); if(e) e.textContent = v; };
  const valor = (id,v)=>{ const e=el(id); if(e) e.value = v; };
  liga('slFov','input', e=>{
    P.fov = +e.target.value; texto('vlFov', P.fov);
    if(cam && J.mira < 0.1){ cam.fov = P.fov; cam.updateProjectionMatrix(); }
    salvarPerfil();
  });
  liga('slQual','input', e=>{ P.qual = +e.target.value; texto('vlQual', QUAL[P.qual]); aplicarQualidade(); salvarPerfil(); });
  syncSens(P.sens); syncMira(P.sensMira);
  valor('slFov', P.fov);   texto('vlFov', P.fov);
  valor('slQual', P.qual); texto('vlQual', QUAL[P.qual]);
  const vSomIni = (P.volSom ?? 70);
  const vMusIni = (P.volMusica ?? 35);
  AUDIO.setVolumeEfeitos(vSomIni/100); AUDIO.setVolumeFundo(vMusIni/100);
  ['slVolSom','slVolSomP'].forEach(id => { const e=el(id); if(e) e.value=vSomIni; });
  ['slVolMusica','slVolMusicaP'].forEach(id => { const e=el(id); if(e) e.value=vMusIni; });
  ['vlVolSom','vlVolSomP'].forEach(id => { const e=el(id); if(e) e.textContent=vSomIni+'%'; });
  ['vlVolMusica','vlVolMusicaP'].forEach(id => { const e=el(id); if(e) e.textContent=vMusIni+'%'; });
}

/* =========== SAIR DA PARTIDA AO FECHAR / PERDER FOCO =========== */
function avisarSaidaPartida(){
  try{
    if (NET.ws && NET.ws.readyState === 1 && NET.sala){
      NET.ws.send(JSON.stringify({ type:'leave_match' }));
    }
  }catch(e){}
}
window.addEventListener('beforeunload', avisarSaidaPartida);
window.addEventListener('pagehide', avisarSaidaPartida);

let _tOculto = 0;
document.addEventListener('visibilitychange', ()=>{
  if (document.hidden){
    _tOculto = Date.now();
    return;
  }
  const ficouOculto = Date.now() - _tOculto;
  if (ficouOculto > 45000 && S.ativa){
    console.warn('[RAJADA] ausente por muito tempo - voltando ao lobby');
    try{ avisarSaidaPartida(); }catch(e){}
    location.reload();
  }
});

/* =========== BOOT =========== */
function iniciar(){
  carregarPerfil();
  particulasLoad();
  criarRenderer();
  Modelos.init();
  AUDIO.init();
  AUDIO.setVolumeEfeitos((P.volSom ?? 70) / 100);
  AUDIO.setVolumeFundo((P.volMusica ?? 35) / 100);

  injetarCSSLoja();
  injetarCSSExtra();
  injetarCSSEditorHud();
  prepararPaginasLobby();
  injetarNavInventario();
  criarBotoesMobile();

  ligarInterface();
  ligarTeclado();
  carregarOpcoes();
  ligarAbasCfg();
  carregarGiros();
  HUD.ligar();
  ligarOrientacao();
  TELA.ligar();
  /* o primeiro toque ja segura a tela acesa */
  const segurarTela = ()=>{ TELA.manter(); };
  addEventListener('pointerdown', segurarTela, { once:true });
  addEventListener('keydown', segurarTela, { once:true });
  if(ehCelular()) ligarToque();
  ligarTela();  /* liga o wake lock */
  cena = new THREE.Scene();
  cena.background = new THREE.Color(0x0d0f11);
  loop();
  carregar(
    ['Inicializando motor grafico','Compilando shaders','Carregando texturas PBR',
     'Configurando audio tatico','Validando perfil','Pronto para combate'],
    ()=>{
      if (API.temSessao()) {
        API.carregarPerfilServidor().then(ok => {
          if (ok) {
            AUDIO.setVolumeEfeitos((P.volSom ?? 70) / 100);
            AUDIO.setVolumeFundo((P.volMusica ?? 35) / 100);
            pintarLobby(); mostrarCena('cLobby');
          } else { mostrarCena('cAuth'); }
        });
      } else { mostrarCena('cAuth'); }
    }
  );
}

document.addEventListener('visibilitychange', ()=>{
  if(document.hidden) return;
  try{ AUDIO.retomar(); }catch(e){}
  NET.ultimoEnvio = 0;
  enviarMeuEstado();
  if(S.ativa && !S.pausada && !S.tabAberto && !chatAberto && !ehCelular()) pedirMouse();
  /* Ao voltar ao app (celular minimizou, abriu outra aba, etc):
     - Reconecta WebSocket se caiu
     - Recarrega amigos e status online imediatamente */
  if(!S.ativa && API.token){
    if(!NET.conectado) NET.conectar(P.nick || 'Anon');
    /* Pequeno delay para garantir que a conexão WS esteja pronta */
    setTimeout(()=>{
      if(NET.conectado) NET.enviar({ type:'status_amigos' });
      AMIGOS.pollSilencioso()
    }, 600);
    _tAmigos = 0; /* força próximo tick imediato */
  }
});

if(typeof THREE === 'undefined'){
  document.body.innerHTML = '<div style="color:#ff6b7f;font:15px system-ui;padding:44px;text-align:center;line-height:2">Coloque <b>three_min.js</b> na mesma pasta deste arquivo.</div>';
} else {
  try { iniciar(); }
  catch(err){
    console.error('[RAJADA] Erro ao iniciar:', err);
    const lt = el('loadTxt');
    if (lt) lt.textContent = 'ERRO: ' + (err && err.message ? err.message : err);
  }
}