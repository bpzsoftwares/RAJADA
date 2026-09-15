<<<<<<< HEAD
/* =====================================================================
   RAJADA  —  jogo2.js
   - Sistema de Temporadas
   - Caixas Misteriosas (somente caixa_comum / chave_comum)
   - Abertura de caixa por VIDEO MP4 (modal grande)

   NESTA VERSÃO:
   - Todo o sorteio/aplicação de recompensa é feito NO SERVIDOR
   - O cliente só envia o id da caixa; o servidor responde
     { recompensa, chaves, coins, xp, nivel, armasTem }
   - Vídeo ocupa quase toda a tela do modal
   - Sem emojis em nenhum lugar
   - Coins mostra "C" dourado, XP mostra "XP" verde
   - Arma usa imagens/arma_<id>.png com fallback texto
   - Chave usa imagens/chave_comum.png com fallback texto
   ===================================================================== */

/* =====================================================================
   CONFIGURACAO — TEMPORADAS
   ===================================================================== */
const CFG_TEMPORADAS = {
  duracao_dias: 30,
  reset: {
    coins_remover_pct: 20,
    nivel_remover:     2,
    armas_remover: ['ak47','m4a1','scar','lmg','sniper','barrett'],
    preservar_sempre: ['faca','rifle']
  },
  recompensas_top: [
    { posicao: 1,  coins: 5000, xp: 2000, chaves: 3, titulo: 'Campeao da Temporada' },
    { posicao: 2,  coins: 3000, xp: 1500, chaves: 2, titulo: 'Vice-Campeao' },
    { posicao: 3,  coins: 2000, xp: 1000, chaves: 2, titulo: '3o Lugar' },
    { posicao: 4,  coins: 1200, xp:  700, chaves: 1, titulo: '4o Lugar' },
    { posicao: 5,  coins: 1000, xp:  600, chaves: 1, titulo: '5o Lugar' },
    { posicao: 6,  coins:  800, xp:  500, chaves: 1, titulo: '6o Lugar' },
    { posicao: 7,  coins:  700, xp:  400, chaves: 1, titulo: '7o Lugar' },
    { posicao: 8,  coins:  600, xp:  300, chaves: 1, titulo: '8o Lugar' },
    { posicao: 9,  coins:  500, xp:  200, chaves: 1, titulo: '9o Lugar' },
    { posicao: 10, coins:  400, xp:  100, chaves: 1, titulo: '10o Lugar' }
  ]
};

/* =====================================================================
   CONFIGURACAO — CHAVES (somente chave_comum)
   ===================================================================== */
const CHAVES_CFG = [
  {
    id:     'chave_comum',
    nome:   'Chave Comum',
    img:    'imagens/chave_comum.png',
    preco:  800,
    info:   'Abre caixas comuns',
    caixa:  'caixa_comum'
  }
];

/* =====================================================================
   CONFIGURACAO — CAIXAS (apenas VISUAL — a recompensa vem do servidor)
   Para adicionar uma nova caixa:
     1. Copie o objeto abaixo e mude id/nome/img/video
     2. Adicione a mesma chave em CAIXAS_SERVIDOR dentro de api.js
     3. Coloque o video em Videos/<nome>.mp4
   ===================================================================== */
const CAIXAS_CFG = [
  {
    id:      'caixa_comum',
    nome:    'Caixa Comum',
    img:     'imagens/caixa_comum.png',
    gif:     'Videos/abrir_caixa_comum.gif',
    webm:    'Videos/bau_magico_animado.webm',
    chave:   'chave_comum',
    /* Lista apenas INFORMATIVA para a UI "Possiveis Recompensas".
       O sorteio real acontece no servidor (api.js). */
    recompensas: [
      { tipo:'coins', valor:200,           chance:35, nome:'200 Coins'   },
      { tipo:'coins', valor:500,           chance:25, nome:'500 Coins'   },
      { tipo:'xp',    valor:300,           chance:20, nome:'300 XP'      },
      { tipo:'arma',  valor:'pistola',     chance:10, nome:'Pistola'     },
      { tipo:'arma',  valor:'smg',         chance:7,  nome:'SMG'         },
      { tipo:'chave', valor:'chave_comum', chance:3,  nome:'Chave Comum' }
    ]
  }
];

/* =====================================================================
   VISUAL DE RECOMPENSA
     coins -> letra "C" (ouro)
     xp    -> texto "XP" (verde)
     arma  -> imagens/arma_<id>.png com fallback texto "ARMA"
     chave -> imagens/chave_comum.png com fallback texto "CHAVE"
   ===================================================================== */
function visualRecompensa(r){
  if (!r) return { tipo:'texto', texto:'?', cor:'#8a929c' };
  switch (r.tipo){
    case 'coins':
      return { tipo:'texto', texto:'C', cor:'#f0a020' };
    case 'xp':
      return { tipo:'texto', texto:'XP', cor:'#5ec97a' };
    case 'arma':
      return { tipo:'img', src:'imagens/arma_' + r.valor + '.png', fallback:'ARMA' };
    case 'chave':
      return { tipo:'img', src:'imagens/' + r.valor + '.png', fallback:'CHAVE' };
    default:
      return { tipo:'texto', texto:'?', cor:'#8a929c' };
  }
}

/* =====================================================================
   ESTADO LOCAL DAS CHAVES
   ------------------------------------------------------------
   O servidor é a fonte da verdade. Estas funções só espelham o
   estado para exibição rápida entre requisições.
   ===================================================================== */
function carregarChaves(){
  try{
    const s = localStorage.getItem('rajada_chaves');
    return s ? JSON.parse(s) : {};
  }catch(e){ return {}; }
}
function salvarChavesLocal(chaves){
  try{ localStorage.setItem('rajada_chaves', JSON.stringify(chaves)); }catch(e){}
}
function getChaves(){ return P._chaves || (P._chaves = carregarChaves()); }
function qtdChave(id){ return getChaves()[id] || 0; }

async function sincronizarChaves(){
  if(typeof API === 'undefined' || !API.token) return;
  try{
    const r = await API.pedir('get_chaves', {});
    if(r.ok){
      P._chaves = r.chaves;
      salvarChavesLocal(r.chaves);
    }
  }catch(e){}
}

/* =====================================================================
   ESTADO DA TEMPORADA
   ===================================================================== */
const TEMP_STATE = {
  numero:    1,
  inicio:    0,
  fim:       0,
  recompensaPendente: null,
  top10:     [],
  _carregado: false,

  diasRestantes(){
    const restam = (this.fim - Math.floor(Date.now()/1000)) / 86400;
    return Math.max(0, restam);
  },
  percentual(){
    const total   = this.fim - this.inicio;
    const passado = Math.floor(Date.now()/1000) - this.inicio;
    if(total <= 0) return 0;
    return Math.min(100, (passado / total) * 100);
  },

  async carregar(){
    if(typeof API === 'undefined' || !API.token) return;
    try{
      const r = await API.pedir('get_temporada', {});
      if(!r.ok) return;
      this.numero              = r.temporada.numero;
      this.inicio              = r.temporada.inicio;
      this.fim                 = r.temporada.fim;
      this.recompensaPendente  = r.recompensaPendente || null;
      this.top10               = r.top10 || [];
      this._carregado          = true;
    }catch(e){}
  }
};

/* =====================================================================
   INJECAO DE CSS
   ===================================================================== */
function injetarCSSJogo2(){
  if(document.getElementById('cssJogo2')) return;
  const st = document.createElement('style');
  st.id = 'cssJogo2';
  st.textContent = `
  #navTemporadas, #navCaixas { cursor:pointer; }
  #paginaTemporadas, #paginaCaixas { display:none; flex-direction:column; gap:16px; animation:fadeInPag .25s ease; }
  #paginaTemporadas.on, #paginaCaixas.on { display:flex; }

  .tempHeader { background: linear-gradient(135deg,rgba(240,160,32,.18),rgba(240,80,80,.12)); border: 1px solid rgba(240,160,32,.35); border-radius: 14px; padding: 18px; display:flex; flex-direction:column; gap:10px; }
  .tempNumero { font-size: 10px; font-weight:800; letter-spacing:.3em; color:var(--c1); text-transform:uppercase; }
  .tempTitulo { font-size:22px; font-weight:900; letter-spacing:.06em; }
  .tempProgresso { display:flex; flex-direction:column; gap:5px; }
  .tempProgBar { height:6px; background:rgba(255,255,255,.08); border-radius:99px; overflow:hidden; }
  .tempProgBar i { display:block; height:100%; border-radius:99px; background:linear-gradient(90deg,var(--c2),var(--c1)); transition:width .6s; }
  .tempDias { font-size:10px; color:var(--fraco); letter-spacing:.08em; }

  .tempRecompPendente { background: linear-gradient(135deg,rgba(94,201,122,.18),rgba(94,201,122,.08)); border: 1px solid rgba(94,201,122,.5); border-radius:13px; padding:16px; display:flex; align-items:center; gap:14px; animation: pulseVerde 2s infinite; }
  @keyframes pulseVerde { 0%,100%{ box-shadow:0 0 0 0 rgba(94,201,122,0); } 50%{ box-shadow:0 0 0 8px rgba(94,201,122,.12); } }
  .tempRecompIco {
    width:38px; height:38px; border-radius:9px; flex-shrink:0;
    display:flex; align-items:center; justify-content:center;
    background:rgba(94,201,122,.2); border:1px solid rgba(94,201,122,.55);
    color:#7ee088; font-family:var(--mono); font-weight:900; font-size:15px;
  }
  .tempRecompInfo { flex:1; }
  .tempRecompTit { font-size:13px; font-weight:800; color:var(--verde); }
  .tempRecompSub { font-size:10px; color:var(--fraco); margin-top:3px; }

  .tempSecTit { font-size:10px; font-weight:800; letter-spacing:.24em; color:var(--fraco); text-transform:uppercase; padding-bottom:8px; border-bottom:1px solid var(--linha); }
  .tempTop10 { display:flex; flex-direction:column; gap:6px; }
  .tempTopLinha { display:flex; align-items:center; gap:10px; padding:10px 12px; background:var(--sup); border:1px solid var(--linha); border-radius:9px; }
  .tempTopLinha.eu { border-color:rgba(240,160,32,.5); background:rgba(240,160,32,.08); }
  .tempTopPos { font-size:13px; font-weight:900; font-family:var(--mono); min-width:28px; text-align:center; }
  .tempTopPos.ouro  { color:#f0c030; }
  .tempTopPos.prata { color:#a0a8b8; }
  .tempTopPos.bronze{ color:#cd7f32; }
  .tempTopNick { flex:1; font-size:12px; font-weight:700; }
  .tempTopPts { font-size:10px; font-family:var(--mono); color:var(--c1); }
  .tempTopRecomp { font-size:9px; color:var(--verde); }

  .tempRecompLista { display:grid; grid-template-columns:repeat(auto-fill,minmax(140px,1fr)); gap:10px; }
  .tempRecompCard { background:var(--sup); border:1px solid var(--linha); border-radius:11px; padding:12px; display:flex; flex-direction:column; align-items:center; gap:6px; text-align:center; }
  .tempRecompCard .ico { font-size:14px; font-weight:900; font-family:var(--mono); color:var(--c1); letter-spacing:.06em; }
  .tempRecompCard .nome { font-size:10px; font-weight:700; }
  .tempRecompCard .val { font-size:12px; font-weight:900; font-family:var(--mono); color:var(--c1); }

  .caixasGrade { display:grid; grid-template-columns:repeat(auto-fill,minmax(150px,1fr)); gap:12px; }
  .caixaCard { background:var(--sup); border:1px solid var(--linha); border-radius:13px; padding:14px 12px; display:flex; flex-direction:column; align-items:center; gap:9px; text-align:center; cursor:pointer; transition:.18s; position:relative; overflow:hidden; }
  .caixaCard:hover { border-color:var(--c1); transform:translateY(-3px); box-shadow:0 10px 28px rgba(0,0,0,.5); }
  .caixaCard.sem-chave { opacity:.55; cursor:default; filter:grayscale(.4); }
  .caixaCard.sem-chave:hover { transform:none; border-color:var(--linha); box-shadow:none; }
  .caixaImg { width:90px; height:90px; object-fit:contain; filter:drop-shadow(0 6px 16px rgba(240,160,32,.5)); }
  .caixaFallback3d { width:90px; height:90px; }
  .caixaNome { font-size:11px; font-weight:800; letter-spacing:.06em; }
  .caixaChaveInfo { font-size:9px; color:var(--fraco); display:flex; align-items:center; gap:5px; }
  .caixaChaveInfo img { width:14px; height:14px; object-fit:contain; }
  .caixaQtdChave { position:absolute; top:8px; right:8px; background:var(--c1); color:#0d0f11; font-size:9px; font-weight:900; padding:2px 7px; border-radius:99px; }
  .btAbrirCaixa { width:100%; padding:8px; border-radius:8px; border:0; cursor:pointer; background:linear-gradient(135deg,var(--c2),var(--c1)); color:#0d0f11; font-size:10px; font-weight:900; letter-spacing:.12em; transition:.18s; }
  .btAbrirCaixa:hover { filter:brightness(1.12); }
  .btAbrirCaixa:disabled { background:var(--linha); color:var(--fraco); cursor:default; }

  .chavesSecTit { font-size:10px; font-weight:800; letter-spacing:.24em; color:var(--fraco); text-transform:uppercase; padding-bottom:8px; border-bottom:1px solid var(--linha); }
  .chavesGrade { display:grid; grid-template-columns:repeat(auto-fill,minmax(130px,1fr)); gap:10px; }
  .chaveCard { background:var(--sup); border:1px solid var(--linha); border-radius:11px; padding:11px; display:flex; flex-direction:column; align-items:center; gap:7px; text-align:center; }
  .chaveImg { width:56px; height:56px; object-fit:contain; filter:drop-shadow(0 4px 10px rgba(240,160,32,.4)); }
  .chaveNome { font-size:10px; font-weight:800; }
  .chaveQtd { font-size:16px; font-weight:900; font-family:var(--mono); color:var(--c1); }
  .chavePreco { font-size:9px; color:var(--fraco); }

  /* ---- Modal backdrop ---- */
  #mdAbrirCaixa {
    position: fixed; inset: 0; z-index: 600;
    display: none; align-items: center; justify-content: center;
    flex-direction: column; gap: 0;
    background: rgba(0,0,0,.82);
    backdrop-filter: blur(12px);
    padding: 16px;
  }
  #mdAbrirCaixa.on { display: flex; }

  /* Título acima da caixa */
  .caixaModalTit {
    font-size: 10px; font-weight: 800; letter-spacing: .32em;
    color: var(--c1); text-transform: uppercase; text-align: center;
    margin-bottom: 12px;
    text-shadow: 0 0 12px rgba(240,160,32,.6);
  }

  /* Container do GIF — menor, centralizado */
  #gifCaixaWrap {
    position: relative;
    width:  min(340px, 82vw);
    height: min(340px, 82vw);
    max-height: 55vh;
    border-radius: 14px;
    overflow: hidden;
    border: 2px solid #f0a020;
    box-shadow:
      0 0 22px rgba(240,160,32,.55),
      0 0 56px rgba(240,160,32,.22),
      inset 0 0 18px rgba(240,160,32,.1);
    animation: gifBordaPulsa 1.2s ease-in-out infinite alternate;
    flex-shrink: 0;
  }
  @keyframes gifBordaPulsa {
    from { box-shadow: 0 0 18px rgba(240,160,32,.45), 0 0 44px rgba(240,160,32,.18), inset 0 0 12px rgba(240,160,32,.08); }
    to   { box-shadow: 0 0 32px rgba(240,160,32,.80), 0 0 72px rgba(240,160,32,.35), inset 0 0 24px rgba(240,160,32,.18); }
  }

  /* GIF preenche o container sem barras pretas */
  #gifCaixaWrap > #gifCaixa {
    width: 100%; height: 100%;
    object-fit: cover;
    object-position: center;
    display: block;
  }

  /* Vinheta interna suave */
  #gifCaixaVinheta {
    position: absolute; inset: 0; pointer-events: none; z-index: 2;
    box-shadow: inset 0 0 36px rgba(0,0,0,.4);
    border-radius: 14px;
  }

  /* Status "Abrindo..." abaixo */
  #caixaStatus {
    margin-top: 14px; font-size: 9px;
    color: rgba(255,255,255,.35); letter-spacing: .24em;
    text-align: center; text-transform: uppercase;
  }

  /* Celular pequeno */
  @media (max-height: 560px) {
    #gifCaixaWrap { width: min(260px, 78vw); height: min(260px, 78vw); max-height: 52vh; }
    .caixaModalTit { margin-bottom: 8px; }
    #caixaStatus { margin-top: 8px; }
  }

  #mdAbrirCaixa > #canvasCaixa {
    position: static !important;
    inset: auto !important;
    top: auto !important; left: auto !important;
    right: auto !important; bottom: auto !important;
    opacity: 1 !important;
    display: block !important;
    transition: none !important;
    border-radius: 16px;
    background: transparent;
  }

  .caixaCard > .caixaFallback3d {
    position: static !important;
    inset: auto !important;
    opacity: 1 !important;
    transition: none;
  }

  #mdRecompensa { position:fixed; inset:0; z-index:700; display:none; align-items:center; justify-content:center; background:rgba(0,0,0,.88); backdrop-filter:blur(16px); }
  #mdRecompensa.on { display:flex; }
  .recompCx { background:var(--painel); border:1px solid var(--c1); border-radius:20px; padding:28px 24px; display:flex; flex-direction:column; align-items:center; gap:14px; text-align:center; animation:sobeM .5s cubic-bezier(.34,1.5,.5,1); min-width:260px; max-width:340px; box-shadow:0 0 60px rgba(240,160,32,.3); }
  .recompCifrau { font-size:10px; font-weight:800; letter-spacing:.3em; color:var(--c1); }
  .recompImg { width:110px; height:110px; object-fit:contain; filter:drop-shadow(0 8px 24px rgba(240,160,32,.7)); animation:pulsaRecomp 1.4s ease-in-out infinite; }
  @keyframes pulsaRecomp { 0%,100%{ transform:scale(1) rotate(-2deg); } 50%{ transform:scale(1.08) rotate(2deg); } }
  .recompNome { font-size:18px; font-weight:900; letter-spacing:.08em; }
  .recompDesc { font-size:11px; color:var(--fraco); }
  .btColetar { padding:13px 30px; border-radius:11px; border:0; cursor:pointer; background:linear-gradient(135deg,var(--c2),var(--c1)); color:#0d0f11; font-size:12px; font-weight:900; letter-spacing:.14em; transition:.18s; width:100%; }
  .btColetar:hover { filter:brightness(1.12); transform:scale(1.02); }

  .particula { position:fixed; pointer-events:none; z-index:650; border-radius:50%; animation:voaParticula linear forwards; }
  @keyframes voaParticula { 0% { transform:translate(0,0) scale(1); opacity:1; } 100% { transform:translate(var(--dx),var(--dy)) scale(0); opacity:0; } }

  .recompIconeArea {
    display:flex; align-items:center; justify-content:center;
    min-height:110px; width:100%;
  }
  .recompIconeTexto {
    font-family: var(--mono);
    font-weight: 900;
    line-height: 1;
    letter-spacing: .05em;
    filter: drop-shadow(0 4px 14px rgba(240,160,32,.55));
  }
  `;
  document.head.appendChild(st);
}

/* =====================================================================
   NAVBAR
   ===================================================================== */
function injetarNavJogo2(){
  const lado = document.querySelector('.lbLado');
  if(!lado || document.getElementById('navTemporadas')) return;

  const navT = document.createElement('div');
  navT.className = 'navItem';
  navT.id = 'navTemporadas';
  navT.dataset.nav = 'temporadas';
  navT.innerHTML = `
    <svg viewBox="0 0 24 24"><path d="M12 2l3.1 6.3L22 9.3l-5 4.9 1.2 6.8L12 17.8l-6.2 3.2L7 14.2 2 9.3l6.9-1L12 2z"/></svg>
    <span>Temporadas</span>
  `;
  lado.appendChild(navT);

  const navC = document.createElement('div');
  navC.className = 'navItem';
  navC.id = 'navCaixas';
  navC.dataset.nav = 'caixas';
  navC.innerHTML = `
    <svg viewBox="0 0 24 24"><path d="M20 7H4a2 2 0 00-2 2v10a2 2 0 002 2h16a2 2 0 002-2V9a2 2 0 00-2-2zm0 12H4V9h16v10zM12 3l-4 4h8l-4-4z"/></svg>
    <span>Caixas</span>
  `;
  lado.appendChild(navC);
}

/* =====================================================================
   PAGINAS
   ===================================================================== */
function injetarPaginasJogo2(){
  const meio = document.querySelector('.lbMeio');
  if(!meio || document.getElementById('paginaTemporadas')) return;

  const pgT = document.createElement('div');
  pgT.id = 'paginaTemporadas';
  pgT.className = 'paginaLobby';
  meio.appendChild(pgT);

  const pgC = document.createElement('div');
  pgC.id = 'paginaCaixas';
  pgC.className = 'paginaLobby';
  meio.appendChild(pgC);
}

/* =====================================================================
   RENDER — TEMPORADAS
   ===================================================================== */
async function renderTemporadas(){
  const pg = document.getElementById('paginaTemporadas'); if(!pg) return;
  pg.innerHTML = '<div style="text-align:center;padding:40px;color:var(--fraco)">Carregando...</div>';

  await TEMP_STATE.carregar();

  if(!TEMP_STATE._carregado){
    pg.innerHTML = '<div style="text-align:center;padding:40px;color:var(--fraco)">Faca login para ver as temporadas.</div>';
    return;
  }

  const top10    = TEMP_STATE.top10;
  const minhaPos = top10.findIndex(p => p.nick === P.nick);
  const pending  = TEMP_STATE.recompensaPendente;

  let html = `
    <div class="tempHeader">
      <div class="tempNumero">Temporada ${TEMP_STATE.numero}</div>
      <div class="tempTitulo">Batalha Tatica</div>
      <div class="tempProgresso">
        <div class="tempProgBar"><i style="width:${TEMP_STATE.percentual().toFixed(1)}%"></i></div>
        <div class="tempDias">${Math.ceil(TEMP_STATE.diasRestantes())} dias restantes - encerra em ${diasParaData(TEMP_STATE.diasRestantes())}</div>
      </div>
    </div>
  `;

  if(pending){
    html += `
      <div class="tempRecompPendente" id="tempRecompPendente">
        <div class="tempRecompIco">REC</div>
        <div class="tempRecompInfo">
          <div class="tempRecompTit">Recompensa disponivel - ${pending.titulo}</div>
          <div class="tempRecompSub">${pending.coins} coins - ${pending.xp} XP - ${pending.chaves} chave(s)</div>
        </div>
        <button class="edBt pri" id="btColetarTempRecomp" style="flex-shrink:0">Coletar</button>
      </div>
    `;
  }

  html += `<div class="tempSecTit">Recompensas da Temporada - Top 10</div>`;
  html += `<div class="tempRecompLista">`;
  CFG_TEMPORADAS.recompensas_top.forEach(r => {
    html += `
      <div class="tempRecompCard">
        <div class="ico">${r.posicao}o</div>
        <div class="nome">${r.titulo}</div>
        <div class="val">${r.coins.toLocaleString('pt-BR')} C</div>
        <div style="font-size:9px;color:var(--fraco)">${r.xp} XP - ${r.chaves} chave(s)</div>
      </div>
    `;
  });
  html += `</div>`;

  html += `<div class="tempSecTit">Classificacao Atual - Top 10</div>`;
  if(top10.length === 0){
    html += `<div class="amigoVazio">Nenhum jogador classificado ainda.</div>`;
  } else {
    html += `<div class="tempTop10">`;
    top10.forEach((p, i) => {
      const pos = i + 1;
      const clsPos = pos===1?'ouro':pos===2?'prata':pos===3?'bronze':'';
      const clsLinha = p.nick === P.nick ? 'tempTopLinha eu' : 'tempTopLinha';
      const recomp = CFG_TEMPORADAS.recompensas_top[i];
      html += `
        <div class="${clsLinha}">
          <span class="tempTopPos ${clsPos}">${pos}</span>
          <span class="tempTopNick">${p.nick}${p.nick===P.nick?' (voce)':''}</span>
          <span class="tempTopPts">${(p.pontos||0).toLocaleString('pt-BR')} pts</span>
          ${recomp ? `<span class="tempTopRecomp">${recomp.coins}C</span>` : ''}
        </div>
      `;
    });
    html += `</div>`;
    if(minhaPos < 0){
      html += `<div style="font-size:10px;color:var(--fraco);text-align:center;margin-top:6px">Voce nao esta no top 10 ainda. Continue jogando!</div>`;
    }
  }

  html += `
    <div style="background:rgba(255,80,80,.08);border:1px solid rgba(255,80,80,.25);border-radius:11px;padding:13px;font-size:10px;color:var(--fraco);line-height:1.7">
      <b style="color:#ff8ea0">Ao fim da temporada:</b>
      ${CFG_TEMPORADAS.reset.coins_remover_pct}% dos seus coins serao removidos -
      ${CFG_TEMPORADAS.reset.nivel_remover} niveis serao removidos -
      Algumas armas serao removidas do inventario.
      <br>Os top 10 recebem recompensas exclusivas!
    </div>
  `;

  pg.innerHTML = html;

  const btColetar = document.getElementById('btColetarTempRecomp');
  if(btColetar && pending){
    btColetar.addEventListener('click', async () => {
      btColetar.disabled = true;
      try{
        const r = await API.pedir('coletar_recompensa_temp', { recompensa_id: pending.id });
        if(r.ok){
          P.coins = r.coins; P.xp = r.xp;
          P._chaves = r.chaves; salvarChavesLocal(r.chaves);
          TEMP_STATE.recompensaPendente = null;
          if(typeof pintarLobby === 'function') pintarLobby();
          if(typeof aviso === 'function') aviso('Recompensa coletada! +'+pending.coins+' coins');
          renderTemporadas();
        }
      }catch(e){ btColetar.disabled = false; }
    });
  }
}

function diasParaData(dias){
  const d = new Date(Date.now() + dias * 86400000);
  return d.toLocaleDateString('pt-BR', { day:'2-digit', month:'2-digit' });
}

/* =====================================================================
   RENDER — CAIXAS
   ===================================================================== */
function renderCaixas(){
  const pg = document.getElementById('paginaCaixas'); if(!pg) return;
  const chaves = getChaves();

  let html = `
    <div style="max-width:700px;margin:0 auto;display:flex;flex-direction:column;gap:20px">

      <!-- Minhas Chaves -->
      <div>
        <div class="secTit" style="margin-bottom:12px">Minhas Chaves</div>
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:12px">
  `;
  CHAVES_CFG.forEach(ch => {
    const qtd = chaves[ch.id] || 0;
    html += `
      <div class="chaveCard" style="padding:18px 14px;gap:10px">
        <img class="chaveImg" src="${ch.img}" alt="${ch.nome}" style="width:72px;height:72px">
        <div class="chaveNome" style="font-size:12px">${ch.nome}</div>
        <div class="chaveQtd" style="font-size:28px">${qtd}</div>
        <div class="chavePreco" style="font-size:9px">${ch.preco.toLocaleString('pt-BR')} coins na loja</div>
      </div>
    `;
  });
  html += `</div></div>`;

  /* Caixas disponíveis */
  html += `
    <div>
      <div class="secTit" style="margin-bottom:12px">Caixas Disponiveis</div>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:14px">
  `;
  CAIXAS_CFG.forEach(cx => {
    const chaveCfg = CHAVES_CFG.find(c => c.id === cx.chave);
    const qtdChaveDisp = chaves[cx.chave] || 0;
    const semChave = qtdChaveDisp <= 0;
    html += `
      <div class="caixaCard ${semChave?'sem-chave':''}" data-caixaid="${cx.id}"
           style="padding:20px 16px;gap:12px;border-radius:14px">
        ${qtdChaveDisp > 0 ? `<span class="caixaQtdChave">${qtdChaveDisp}x</span>` : ''}
        <img src="${cx.img}" class="caixaImg" alt="${cx.nome}"
             data-caixaid="${cx.id}" style="width:120px;height:120px">
        <canvas class="caixaFallback3d" style="display:none;width:120px;height:120px"
                width="120" height="120" data-caixaid="${cx.id}"></canvas>
        <div class="caixaNome" style="font-size:13px">${cx.nome}</div>
        <div class="caixaChaveInfo" style="font-size:10px">
          <img src="${chaveCfg?.img||''}" alt="" style="width:16px;height:16px">
          <span>${chaveCfg?.nome||'Chave'} ${semChave?'<span style="color:var(--verm)">(0)</span>':'<b style="color:var(--c1)">('+qtdChaveDisp+')</b>'}</span>
        </div>
        <button class="btAbrirCaixa" data-caixaid="${cx.id}" ${semChave?'disabled':''}
                style="padding:11px;font-size:11px;letter-spacing:.16em">
          ${semChave?'Sem chave':'&#9654; Abrir caixa'}
        </button>
      </div>
    `;
  });
  html += `</div></div>`;

  /* Possíveis Recompensas */
  html += `<div><div class="secTit" style="margin-bottom:12px">Possiveis Recompensas</div>`;
  CAIXAS_CFG.forEach(cx => {
    html += `<div style="margin-bottom:8px">
      <div style="font-size:10px;font-weight:800;letter-spacing:.1em;margin-bottom:8px;color:var(--fraco)">${cx.nome}</div>
      <div style="display:flex;flex-wrap:wrap;gap:7px">`;
    cx.recompensas.forEach(r => {
      const vis = visualRecompensa(r);
      let iconeHtml = vis.tipo === 'img'
        ? `<img src="${vis.src}" style="width:18px;height:18px;object-fit:contain" data-recomp-img="1">`
        : `<span style="font-weight:900;font-family:var(--mono);color:${vis.cor};font-size:12px;line-height:1">${vis.texto}</span>`;
      html += `<div style="background:var(--sup);border:1px solid var(--linha);border-radius:9px;
        padding:7px 12px;font-size:9.5px;display:flex;align-items:center;gap:6px">
        ${iconeHtml}<span>${r.nome}</span>
        <span style="color:var(--fraco);font-family:var(--mono)">${r.chance}%</span></div>`;
    });
    html += `</div></div>`;
  });
  html += `</div></div>`;

  pg.innerHTML = html;

  pg.querySelectorAll('img.chaveImg').forEach(img => {
    const t = () => { img.style.display = 'none'; };
    img.addEventListener('error', t, { once:true });
    if (img.complete && img.naturalWidth === 0) t();
  });

  pg.querySelectorAll('img.caixaImg').forEach(img => {
    const mostrarFallback = () => {
      img.style.display = 'none';
      const cv = img.nextElementSibling;
      if (cv && cv.classList.contains('caixaFallback3d')){
        cv.style.display = 'block';
        if (!cv.dataset.desenhou){ desenharCaixaFallback(cv); cv.dataset.desenhou = '1'; }
      }
    };
    img.addEventListener('error', mostrarFallback, { once:true });
    if (img.complete && img.naturalWidth === 0) mostrarFallback();
  });

  pg.querySelectorAll('img[data-recomp-img]').forEach(img => {
    const t = () => { img.style.display = 'none'; };
    img.addEventListener('error', t, { once:true });
    if (img.complete && img.naturalWidth === 0) t();
  });

  pg.querySelectorAll('.btAbrirCaixa:not([disabled])').forEach(bt => {
    bt.addEventListener('click', (e) => {
      e.stopPropagation();
      abrirCaixa(bt.dataset.caixaid);
    });
  });
}

function desenharCaixaFallback(canvas){
  canvas.style.display = 'block';
  const ctx = canvas.getContext('2d');
  const w = canvas.width  = 90;
  const h = canvas.height = 90;
  const cx = w/2, cy = h/2;

  ctx.clearRect(0, 0, w, h);

  ctx.beginPath();
  ctx.moveTo(cx, cy-14); ctx.lineTo(cx+26, cy);
  ctx.lineTo(cx+26, cy+18); ctx.lineTo(cx, cy+30);
  ctx.fillStyle = '#2a3038'; ctx.fill();
  ctx.strokeStyle = 'rgba(240,160,32,.5)'; ctx.lineWidth=1; ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(cx, cy-14); ctx.lineTo(cx-26, cy);
  ctx.lineTo(cx-26, cy+18); ctx.lineTo(cx, cy+30);
  ctx.fillStyle = '#1e2228'; ctx.fill();
  ctx.strokeStyle = 'rgba(240,160,32,.35)'; ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(cx, cy-30); ctx.lineTo(cx+26, cy-14);
  ctx.lineTo(cx, cy); ctx.lineTo(cx-26, cy-14);
  ctx.fillStyle = '#3a4250'; ctx.fill();
  ctx.strokeStyle = 'rgba(240,160,32,.6)'; ctx.stroke();

  ctx.strokeStyle = 'rgba(240,160,32,.7)'; ctx.lineWidth=1.5;
  ctx.beginPath(); ctx.moveTo(cx, cy-30); ctx.lineTo(cx, cy); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(cx-26, cy-14); ctx.lineTo(cx+26, cy-14); ctx.stroke();
}

/* =====================================================================
   ABERTURA DA CAIXA — COM SERVIDOR COMO FONTE DA VERDADE
   ---------------------------------------------------------------------
   Fluxo:
     1. Cliente envia { acao:'abrir_caixa', caixa_id }
     2. Servidor confere chave, desconta, sorteia, aplica no banco
     3. Servidor devolve { recompensa, chaves, coins, xp, nivel, armasTem }
     4. Cliente atualiza estado local e toca o video
     5. Ao terminar o video, mostra modal de recompensa
     6. Botao "Coletar" apenas fecha o modal (nada mais a aplicar)
   ===================================================================== */
let _caixaAbrindo = false;

async function abrirCaixa(caixaId){
  if(_caixaAbrindo) return;
  const cx = CAIXAS_CFG.find(c => c.id === caixaId); if(!cx) return;

  _caixaAbrindo = true;
  try {
    let r;
    try {
      r = await API.pedir('abrir_caixa', { caixa_id: caixaId });
    } catch(e){
      if(typeof aviso === 'function') aviso('Erro de rede');
      return;
    }

    if (!r.ok){
      if (r.erro === 'sem_chave')          { if(typeof aviso==='function') aviso('Sem chave para essa caixa'); return; }
      if (r.erro === 'muitas_tentativas')  { if(typeof aviso==='function') aviso('Calma! Muitas aberturas seguidas'); return; }
      if (r.erro === 'sessao_invalida')    { if(typeof aviso==='function') aviso('Sessao expirada'); return; }
      if (r.erro === 'caixa_invalida')     { if(typeof aviso==='function') aviso('Caixa invalida'); return; }
      if(typeof aviso==='function') aviso('Erro: ' + (r.erro||'desconhecido'));
      return;
    }

    /* Sincroniza o estado local com o que o servidor devolveu */
    P._chaves  = r.chaves;       salvarChavesLocal(r.chaves);
    P.coins    = r.coins;
    P.xp       = r.xp;
    P.nivel    = r.nivel;
    P.armasTem = r.armasTem;
    salvarPerfil();
    if(typeof pintarLobby === 'function') pintarLobby();
    if(typeof renderCaixas === 'function') renderCaixas();

    /* Agora toca o video (ou fallback 2D) e mostra a recompensa */
    abrirModalCaixaVideo(cx, r.recompensa);

  } finally {
    /* Só liberamos o flag quando o modal terminar (finalizarAbertura) */
    if (!document.getElementById('mdAbrirCaixa') ||
        !document.getElementById('mdAbrirCaixa').classList.contains('on')){
      _caixaAbrindo = false;
    }
  }
}

/* =====================================================================
   ABERTURA DA CAIXA POR GIF  (modal grande)
   ---------------------------------------------------------------------
   O GIF ocupa quase toda a tela e dura exatamente 1,7 segundos.
   Ao fim do tempo o modal fecha e a recompensa é exibida.
   Fallback 2D é mantido caso o GIF não carregue em 3 s.
   ===================================================================== */
function abrirModalCaixaVideo(caixaCfg, recompensa){
  let md = document.getElementById('mdAbrirCaixa');
  if(!md){
    md = document.createElement('div');
    md.id = 'mdAbrirCaixa';
    document.body.appendChild(md);
  }

  const GIF_DURACAO_MS = 1700; /* duração exata do GIF em milissegundos — só usado no fallback GIF abaixo */

  /* Usa gif se disponível, senão cai no video (retrocompatibilidade) */
  const webmSrc = caixaCfg.webm  || null;
  const gifSrc  = caixaCfg.gif   || null;
  const videoSrc = caixaCfg.video || null;

  /* Prefere WebM (62fps real) → GIF → fallback 2D */
  const usarWebm = !!webmSrc;
  const src = webmSrc || gifSrc || videoSrc;
  const DURACAO_MS = usarWebm ? 5800 : (caixaCfg.gifDuracao || 4800);

  if (usarWebm) {
    /* ---- WebM: <video> mudo, sem controles ---- */
    md.innerHTML =
      '<div class="caixaModalTit">' + caixaCfg.nome + '</div>' +
      '<div id="gifCaixaWrap">' +
        '<video id="gifCaixa" playsinline muted preload="auto" ' +
          'style="width:100%;height:100%;object-fit:cover;display:block;border-radius:14px">' +
          '<source src="' + src + '?t=' + Date.now() + '" type="video/webm">' +
        '</video>' +
        '<div id="gifCaixaVinheta"></div>' +
      '</div>' +
      '<div id="caixaStatus" style="font-size:9px;opacity:.5;letter-spacing:.18em">TOQUE PARA PULAR</div>';
    md.classList.add('on');

    const vid = document.getElementById('gifCaixa');
    let finalizado = false, timerFim = null, timerFallback = null;

    const finalizar = (motivo) => {
      if (finalizado) return;
      finalizado = true;
      clearTimeout(timerFim); clearTimeout(timerFallback);
      md.removeEventListener('click', pularAnim);
      try { vid.pause(); vid.removeAttribute('src'); vid.load(); } catch(e){}
      finalizarAbertura(md, recompensa, caixaCfg);
    };

    /* Clique/toque na tela pula a animação */
    const pularAnim = () => finalizar('skip');
    /* Pequeno delay para não pular imediatamente ao clicar no botão "Abrir caixa" */
    setTimeout(() => md.addEventListener('click', pularAnim), 400);

    /* Fallback generoso: 12s — WebM pode demorar para carregar no celular */
    timerFallback = setTimeout(() => {
      if (!finalizado){
        finalizado = true;
        md.removeEventListener('click', pularAnim);
        mostrarFallback2DNoModal(md, caixaCfg, recompensa);
      }
    }, 12000);

    const tentarTocar = () => {
      clearTimeout(timerFallback);
      const p = vid.play();
      if (p && p.catch) p.catch(() => { vid.muted = true; vid.play().catch(() => {}); });
      timerFim = setTimeout(() => finalizar('webm-ended'), DURACAO_MS);
    };

    /* canplay dispara assim que tem dados suficientes para tocar */
    vid.addEventListener('canplay', tentarTocar, { once: true });

    /* Se demorar 8s sem canplay, tenta tocar mesmo assim */
    const timerForcar = setTimeout(() => {
      if (!finalizado && vid.readyState < 2) tentarTocar();
    }, 8000);

    vid.addEventListener('ended', () => finalizar('ended'));
    vid.addEventListener('error', () => {
      clearTimeout(timerFallback); clearTimeout(timerForcar);
      if (!finalizado){ finalizado = true; md.removeEventListener('click', pularAnim); mostrarFallback2DNoModal(md, caixaCfg, recompensa); }
    }, { once: true });

  } else {
    /* ---- GIF: <img> com timer fixo ---- */
    md.innerHTML =
      '<div class="caixaModalTit">' + caixaCfg.nome + '</div>' +
      '<div id="gifCaixaWrap">' +
        '<img id="gifCaixa" alt="Abrindo caixa">' +
        '<div id="gifCaixaVinheta"></div>' +
      '</div>' +
      '<div id="caixaStatus" style="font-size:9px;opacity:.5;letter-spacing:.18em">TOQUE PARA PULAR</div>';
    md.classList.add('on');

    const gifEl = document.getElementById('gifCaixa');
    let finalizado = false, timerGif = null, timerFallback = null;

    const finalizar = (motivo) => {
      if (finalizado) return;
      finalizado = true;
      clearTimeout(timerGif); clearTimeout(timerFallback);
      md.removeEventListener('click', pularAnim);
      try { gifEl.src = ''; } catch(e){}
      finalizarAbertura(md, recompensa, caixaCfg);
    };

    const pularAnim = () => finalizar('skip');
    setTimeout(() => md.addEventListener('click', pularAnim), 400);

    timerFallback = setTimeout(() => {
      if (!finalizado){ finalizado = true; clearTimeout(timerGif);
        md.removeEventListener('click', pularAnim);
        try{ gifEl.src=''; }catch(e){}
        mostrarFallback2DNoModal(md, caixaCfg, recompensa); }
    }, 6000);

    gifEl.addEventListener('load', () => {
      clearTimeout(timerFallback);
      timerGif = setTimeout(() => finalizar('gif-ended'), DURACAO_MS);
    }, { once: true });

    gifEl.addEventListener('error', () => {
      clearTimeout(timerFallback);
      if (!finalizado){ finalizado = true; md.removeEventListener('click', pularAnim);
        try{ gifEl.src=''; }catch(e){} mostrarFallback2DNoModal(md, caixaCfg, recompensa); }
    }, { once: true });

    gifEl.src = src + '?t=' + Date.now();
  }
}

function mostrarFallback2DNoModal(md, caixaCfg, recompensa){
  const W = Math.min(innerWidth  * 0.85, 700);
  const H = Math.min(innerHeight * 0.75, 560);

  md.innerHTML =
    '<div class="caixaModalTit">' + caixaCfg.nome + '</div>' +
    '<canvas id="canvasCaixa" width="' + W + '" height="' + H + '" ' +
      'style="width:' + W + 'px;height:' + H + 'px;position:static;opacity:1;display:block;' +
      'border-radius:18px"></canvas>' +
    '<div id="caixaStatus" style="font-size:11px;color:var(--fraco);margin-top:10px;letter-spacing:.1em;max-width:90vw;text-align:center">Abrindo...</div>';

  animarCaixaFallback(W, H, caixaCfg, () => {
    finalizarAbertura(md, recompensa, caixaCfg);
  });
}

/* A recompensa ja foi aplicada pelo servidor — aqui so exibimos */
function finalizarAbertura(md, recompensa, caixaCfg){
  _caixaAbrindo = false;
  md.classList.remove('on');
  mostrarRecompensa(recompensa, caixaCfg);
  lancaParticulas();
  if(typeof renderCaixas === 'function') renderCaixas();
  if(typeof pintarLobby === 'function') pintarLobby();
}

/* =====================================================================
   FALLBACK 2D
   ===================================================================== */
function animarCaixaFallback(W, H, caixaCfg, onFim){
  const canvas = document.getElementById('canvasCaixa');
  if(!canvas){ setTimeout(onFim, 2000); return; }
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');

  const duracao = 2400;
  const inicio  = performance.now();

  const img = new Image();
  img.src = caixaCfg.img;

  function frame(now){
    const t  = Math.min(1, (now - inicio) / duracao);
    ctx.clearRect(0, 0, W, H);

    const grad = ctx.createRadialGradient(W/2, H/2, 0, W/2, H/2, W/1.4);
    grad.addColorStop(0, 'rgba(240,160,32,' + (0.12 + Math.sin(t*Math.PI*4)*0.06) + ')');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = grad; ctx.fillRect(0, 0, W, H);

    const escala = t < 0.3 ? (t/0.3) * 1.1 : t < 0.5 ? 1.1 - (t-0.3)/0.2*0.1 : 1.0;
    const tremor = t > 0.5 && t < 0.85 ? Math.sin(t * 80) * 4 * (1 - (t-0.5)/0.35) : 0;
    const opacidade = t > 0.85 ? Math.max(0, 1 - (t - 0.85) / 0.15) : 1;

    ctx.save();
    ctx.globalAlpha = opacidade;
    ctx.translate(W/2 + tremor, H/2);
    ctx.scale(escala, escala);

    if(img.complete && img.naturalWidth > 0){
      const sz = Math.min(W, H) * 0.7;
      ctx.drawImage(img, -sz/2, -sz/2, sz, sz);
    } else {
      desenharCaixaCtx(ctx, 0, 0, Math.min(W,H)*0.4);
    }

    if(t > 0.5){
      const int = (t - 0.5) / 0.5;
      for(let i = 0; i < 8; i++){
        const ang = (i/8) * Math.PI*2 + t*3;
        const len = 60 * int + Math.sin(t*20 + i)*10;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(Math.cos(ang)*len, Math.sin(ang)*len);
        ctx.strokeStyle = 'rgba(240,160,32,' + (0.4*int) + ')';
        ctx.lineWidth = 2; ctx.stroke();
      }
    }
    ctx.restore();

    if(t > 0.6 && t < 0.85){
      const a = Math.sin((t - 0.6) / 0.25 * Math.PI);
      ctx.save();
      ctx.globalAlpha = a;
      ctx.font = 'bold 13px sans-serif';
      ctx.fillStyle = 'rgba(240,160,32,0.9)';
      ctx.textAlign = 'center';
      ctx.fillText('Abrindo...', W/2, H - 18);
      ctx.restore();
    }

    if(t < 1){
      requestAnimationFrame(frame);
    } else {
      animarExplosaoFinal(ctx, W, H, onFim);
    }
  }
  requestAnimationFrame(frame);
}

function desenharCaixaCtx(ctx, x, y, s){
  ctx.beginPath();
  ctx.moveTo(x, y-s*0.35); ctx.lineTo(x+s*0.5, y);
  ctx.lineTo(x+s*0.5, y+s*0.35); ctx.lineTo(x, y+s*0.7);
  ctx.fillStyle = '#2a3038'; ctx.fill();
  ctx.strokeStyle = 'rgba(240,160,32,.6)'; ctx.lineWidth=1.5; ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(x, y-s*0.35); ctx.lineTo(x-s*0.5, y);
  ctx.lineTo(x-s*0.5, y+s*0.35); ctx.lineTo(x, y+s*0.7);
  ctx.fillStyle = '#1e2228'; ctx.fill();
  ctx.strokeStyle = 'rgba(240,160,32,.4)'; ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(x, y-s*0.7); ctx.lineTo(x+s*0.5, y-s*0.35);
  ctx.lineTo(x, y); ctx.lineTo(x-s*0.5, y-s*0.35);
  ctx.fillStyle = '#3a4250'; ctx.fill();
  ctx.strokeStyle = 'rgba(240,160,32,.8)'; ctx.stroke();
}

function animarExplosaoFinal(ctx, W, H, onFim){
  const inicio = performance.now();
  const dur    = 600;

  function frame(now){
    const t = Math.min(1, (now - inicio) / dur);
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(240,160,32,' + Math.max(0, 0.8 - t * 0.8) + ')';
    ctx.fillRect(0, 0, W, H);
    ctx.beginPath();
    ctx.arc(W/2, H/2, t * W * 0.8, 0, Math.PI*2);
    ctx.strokeStyle = 'rgba(240,160,32,' + (1 - t) + ')';
    ctx.lineWidth = 4 * (1 - t);
    ctx.stroke();
    if(t < 1) requestAnimationFrame(frame);
    else       onFim();
  }
  requestAnimationFrame(frame);
}

/* =====================================================================
   PARTICULAS
   ===================================================================== */
function lancaParticulas(){
  const cores = ['#f0a020','#f0c030','#5ec97a','#4aa3ff','#e74c3c','#ffffff'];
  for(let i = 0; i < 60; i++){
    const p = document.createElement('div');
    p.className = 'particula';
    const sz    = 4 + Math.random() * 8;
    const dx    = (Math.random() - 0.5) * innerWidth * 0.9;
    const dy    = -(Math.random() * innerHeight * 0.7 + 100);
    const dur   = 800 + Math.random() * 1200;
    const cor   = cores[Math.floor(Math.random() * cores.length)];
    p.style.cssText = 'width:'+sz+'px; height:'+sz+'px; background:'+cor+'; left:'+(innerWidth/2 + (Math.random()-0.5)*80)+'px; top:'+(innerHeight/2)+'px; --dx:'+dx+'px; --dy:'+dy+'px; animation-duration:'+dur+'ms;';
    document.body.appendChild(p);
    setTimeout(function(){ p.remove(); }, dur + 100);
  }
}

/* =====================================================================
   MODAL DE RECOMPENSA
     A recompensa já foi aplicada pelo servidor. O botão "Coletar"
     só fecha o modal e confirma pro jogador.
   ===================================================================== */
function mostrarRecompensa(recompensa, caixaCfg){
  let md = document.getElementById('mdRecompensa');
  if(!md){
    md = document.createElement('div');
    md.id = 'mdRecompensa';
    document.body.appendChild(md);
  }

  const descTipo = {
    coins: '+' + (recompensa.valor*(recompensa.qtd||1)).toLocaleString('pt-BR') + ' Coins',
    xp:    '+' + (recompensa.valor*(recompensa.qtd||1)).toLocaleString('pt-BR') + ' XP',
    arma:  'Nova arma desbloqueada!',
    chave: '+' + (recompensa.qtd||1) + ' chave(s)'
  };

  md.innerHTML =
    '<div class="recompCx">' +
      '<div class="recompCifrau">VOCE GANHOU</div>' +
      '<div class="recompIconeArea" id="recompIconeArea"></div>' +
      '<div class="recompNome">' + recompensa.nome + '</div>' +
      '<div class="recompDesc">' + (descTipo[recompensa.tipo] || '') + '</div>' +
      '<button class="btColetar" id="btColetarCaixa">Coletar</button>' +
    '</div>';
  md.classList.add('on');

  /* Monta o icone da recompensa */
  const area = md.querySelector('#recompIconeArea');
  const vis  = visualRecompensa(recompensa);

  if (vis.tipo === 'img'){
    const img = document.createElement('img');
    img.className = 'recompImg';
    img.alt = '';
    img.src = vis.src;
    img.style.display = 'none';

    const txt = document.createElement('div');
    txt.className = 'recompIconeTexto';
    txt.style.fontSize = '30px';
    txt.style.color = '#f0a020';
    txt.textContent = vis.fallback;

    img.addEventListener('load', () => { img.style.display = 'block'; txt.style.display = 'none'; });
    img.addEventListener('error', () => { img.style.display = 'none'; txt.style.display = 'block'; });

    area.appendChild(img);
    area.appendChild(txt);

    if (img.complete && img.naturalWidth === 0){
      img.style.display = 'none';
      txt.style.display = 'block';
    }
  } else {
    const txt = document.createElement('div');
    txt.className = 'recompIconeTexto';
    txt.style.fontSize = vis.texto.length > 1 ? '54px' : '86px';
    txt.style.color = vis.cor;
    txt.textContent = vis.texto;
    area.appendChild(txt);
  }

  const btCol = document.getElementById('btColetarCaixa');
  if(btCol){
    btCol.addEventListener('click', function(){
      /* A recompensa já foi creditada no servidor. Só fechamos. */
      md.classList.remove('on');
      if(typeof aviso === 'function') aviso('Coletado: ' + recompensa.nome);
    });
  }
}

/* =====================================================================
   LOJA — chave
   ===================================================================== */
function injetarChavesNaLoja(){
  const orig = typeof renderLoja === 'function' ? renderLoja : null;
  if(!orig) return;

  window._renderLojaOriginal = orig;
  window.renderLoja = function(){
    window._renderLojaOriginal();
    setTimeout(function(){
      const grid = document.getElementById('gradeLoja'); if(!grid) return;
      if(grid.querySelector('.secChavesLoja')) return;

      const secao = document.createElement('div');
      secao.className = 'secChavesLoja';
      secao.style.cssText = 'grid-column:1/-1;margin-top:10px';

      let cards = '';
      CHAVES_CFG.forEach(function(ch){
        const qtd = qtdChave(ch.id);
        cards +=
          '<div class="cardArma" style="cursor:pointer" data-chave="' + ch.id + '">' +
            '<div class="cardArmaImg" style="height:90px">' +
              '<span class="fallback">' + ch.nome + '</span>' +
              '<img src="' + ch.img + '" alt="' + ch.nome + '" style="max-width:75%;max-height:75%;object-fit:contain" ' +
                'onload="var f=this.previousElementSibling;if(f)f.style.display=\'none\'" ' +
                'onerror="this.style.display=\'none\'">' +
            '</div>' +
            '<div class="cardArmaInfo">' +
              '<div class="cardArmaNome">' + ch.nome + '</div>' +
              '<div class="cardArmaSub">' + ch.info + '</div>' +
              '<div class="cardArmaPreco">' +
                (qtd > 0 ? '<span class="cardArmaPrecoV tem">Possui ' + qtd + '</span>' : '<span class="cardArmaPrecoV">' + ch.preco.toLocaleString('pt-BR') + ' C</span>') +
              '</div>' +
              '<button class="cardArmaBtn" data-chave="' + ch.id + '">' +
                (qtd > 0 ? 'Comprar mais' : 'Comprar') +
              '</button>' +
            '</div>' +
          '</div>';
      });

      secao.innerHTML =
        '<div class="secTit" style="margin-bottom:10px">Chaves de Caixas</div>' +
        '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:10px">' +
          cards +
        '</div>';
      grid.appendChild(secao);

      secao.querySelectorAll('button.cardArmaBtn[data-chave]').forEach(function(btn){
        btn.addEventListener('click', async function(e){
          e.stopPropagation(); /* impede bubble para o div pai */
          if(btn.disabled) return; /* guard contra clique duplo */
          const id = btn.dataset.chave;
          const cfg = CHAVES_CFG.find(function(c){ return c.id === id; }); if(!cfg) return;
          if(P.coins < cfg.preco){
            if(typeof aviso === 'function') aviso('Coins insuficientes');
            return;
          }
          /* Desabilita o botão imediatamente para evitar compra dupla */
          btn.disabled = true;
          btn.textContent = 'Comprando...';
          try {
            if(typeof API !== 'undefined' && API.token){
              const r = await API.pedir('comprar_chave', { chave_id: id });
              if(!r.ok){
                if(typeof aviso === 'function') aviso(r.erro === 'coins_insuficientes' ? 'Coins insuficientes' : 'Erro na compra');
                btn.disabled = false;
                btn.textContent = 'Comprar mais';
                return;
              }
              P.coins   = r.coins;
              P._chaves = r.chaves;
              salvarChavesLocal(r.chaves);
            } else {
              P.coins -= cfg.preco;
              const ch = getChaves(); ch[id] = (ch[id]||0)+1; P._chaves = ch; salvarChavesLocal(ch);
              salvarPerfil();
            }
            if(typeof pintarLobby === 'function') pintarLobby();
            if(typeof renderLoja === 'function') renderLoja();
            if(typeof aviso === 'function') aviso('Comprado: ' + cfg.nome);
          } catch(err) {
            btn.disabled = false;
            btn.textContent = 'Comprar mais';
          }
        });
      });
    }, 100);
  };
}

/* =====================================================================
   VERIFICACAO
   ===================================================================== */
async function verificarRecompensaTemporada(){
  if(!API || !API.token) return;
  await TEMP_STATE.carregar();
  if(TEMP_STATE.recompensaPendente){
    setTimeout(function(){
      const r = TEMP_STATE.recompensaPendente;
      if(typeof aviso === 'function')
        aviso(r.titulo + '! Recompensa disponivel em Temporadas.');
    }, 2000);
  }
}

/* =====================================================================
   BOOT
   ===================================================================== */
function iniciarJogo2(){
  P._chaves = carregarChaves();
  injetarCSSJogo2();
  injetarNavJogo2();
  injetarPaginasJogo2();
  injetarChavesNaLoja();

  setTimeout(async function(){
    await sincronizarChaves();
    await verificarRecompensaTemporada();
  }, 1500);

  const origPintarLobby = typeof pintarLobby === 'function' ? pintarLobby : null;
  if(origPintarLobby && !window._jogo2PatchedLobby){
    window._jogo2PatchedLobby = true;
    window.pintarLobby = function(){
      origPintarLobby();
      const nav = document.getElementById('navTemporadas');
      if(nav && TEMP_STATE.recompensaPendente){
        if(!nav.querySelector('.tempBadge')){
          const b = document.createElement('span');
          b.className = 'tempBadge';
          b.style.cssText = 'position:absolute;top:-3px;right:-3px;width:8px;height:8px;border-radius:50%;background:#5ec97a;display:block';
          nav.style.position='relative';
          nav.appendChild(b);
        }
      } else if(nav){
        const b = nav.querySelector('.tempBadge');
        if(b) b.remove();
      }
    };
  }

  console.log('%c RAJADA jogo2.js carregado ', 'background:#5ec97a;color:#0d0f11;font-weight:bold;padding:2px 7px;border-radius:4px');
}

(function bootJogo2(){
  function tentar(tentativas){
    const meio = document.querySelector('.lbMeio');
    const paginaOk = document.getElementById('paginaInicio');
    const ladoOk   = document.querySelector('.lbLado');

    if(meio && paginaOk && ladoOk){
      iniciarJogo2();
    } else if(tentativas < 40){
      setTimeout(function(){ tentar(tentativas + 1); }, 100);
    } else {
      console.warn('[jogo2] Timeout aguardando lbMeio - iniciando assim mesmo');
      iniciarJogo2();
    }
  }

  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', function(){ tentar(0); });
  } else {
    tentar(0);
  }
})();

document.addEventListener('DOMContentLoaded', function(){
  setTimeout(function(){
    if(typeof NET === 'undefined') return;
    const origReceber = NET._receber.bind(NET);
    NET._receber = function(m){
      origReceber(m);
      if(m.type === 'temporada_reset'){
        TEMP_STATE._carregado = false;
        sincronizarChaves();
        if(typeof salvarPerfil === 'function') salvarPerfil();
        if(typeof API !== 'undefined' && API.token){
          API.carregarPerfilServidor().then(function(){
            if(typeof pintarLobby === 'function') pintarLobby();
          });
        }
        if(typeof aviso === 'function')
          aviso(m.msg || 'Nova temporada iniciada!');
      }
    };
  }, 2000);
=======
/* =====================================================================
   RAJADA  —  jogo2.js
   - Sistema de Temporadas
   - Caixas Misteriosas (somente caixa_comum / chave_comum)
   - Abertura de caixa por VIDEO MP4 (modal grande)

   NESTA VERSÃO:
   - Todo o sorteio/aplicação de recompensa é feito NO SERVIDOR
   - O cliente só envia o id da caixa; o servidor responde
     { recompensa, chaves, coins, xp, nivel, armasTem }
   - Vídeo ocupa quase toda a tela do modal
   - Sem emojis em nenhum lugar
   - Coins mostra "C" dourado, XP mostra "XP" verde
   - Arma usa imagens/arma_<id>.png com fallback texto
   - Chave usa imagens/chave_comum.png com fallback texto
   ===================================================================== */

/* =====================================================================
   CONFIGURACAO — TEMPORADAS
   ===================================================================== */
const CFG_TEMPORADAS = {
  duracao_dias: 30,
  reset: {
    coins_remover_pct: 20,
    nivel_remover:     2,
    armas_remover: ['ak47','m4a1','scar','lmg','sniper','barrett'],
    preservar_sempre: ['faca','rifle']
  },
  recompensas_top: [
    { posicao: 1,  coins: 5000, xp: 2000, chaves: 3, titulo: 'Campeao da Temporada' },
    { posicao: 2,  coins: 3000, xp: 1500, chaves: 2, titulo: 'Vice-Campeao' },
    { posicao: 3,  coins: 2000, xp: 1000, chaves: 2, titulo: '3o Lugar' },
    { posicao: 4,  coins: 1200, xp:  700, chaves: 1, titulo: '4o Lugar' },
    { posicao: 5,  coins: 1000, xp:  600, chaves: 1, titulo: '5o Lugar' },
    { posicao: 6,  coins:  800, xp:  500, chaves: 1, titulo: '6o Lugar' },
    { posicao: 7,  coins:  700, xp:  400, chaves: 1, titulo: '7o Lugar' },
    { posicao: 8,  coins:  600, xp:  300, chaves: 1, titulo: '8o Lugar' },
    { posicao: 9,  coins:  500, xp:  200, chaves: 1, titulo: '9o Lugar' },
    { posicao: 10, coins:  400, xp:  100, chaves: 1, titulo: '10o Lugar' }
  ]
};

/* =====================================================================
   CONFIGURACAO — CHAVES (somente chave_comum)
   ===================================================================== */
const CHAVES_CFG = [
  {
    id:     'chave_comum',
    nome:   'Chave Comum',
    img:    'imagens/chave_comum.png',
    preco:  800,
    info:   'Abre caixas comuns',
    caixa:  'caixa_comum'
  }
];

/* =====================================================================
   CONFIGURACAO — CAIXAS (apenas VISUAL — a recompensa vem do servidor)
   Para adicionar uma nova caixa:
     1. Copie o objeto abaixo e mude id/nome/img/video
     2. Adicione a mesma chave em CAIXAS_SERVIDOR dentro de api.js
     3. Coloque o video em Videos/<nome>.mp4
   ===================================================================== */
const CAIXAS_CFG = [
  {
    id:      'caixa_comum',
    nome:    'Caixa Comum',
    img:     'imagens/caixa_comum.png',
    gif:     'Videos/abrir_caixa_comum.gif',
    webm:    'Videos/bau_magico_animado.webm',
    chave:   'chave_comum',
    /* Lista apenas INFORMATIVA para a UI "Possiveis Recompensas".
       O sorteio real acontece no servidor (api.js). */
    recompensas: [
      { tipo:'coins', valor:200,           chance:35, nome:'200 Coins'   },
      { tipo:'coins', valor:500,           chance:25, nome:'500 Coins'   },
      { tipo:'xp',    valor:300,           chance:20, nome:'300 XP'      },
      { tipo:'arma',  valor:'pistola',     chance:10, nome:'Pistola'     },
      { tipo:'arma',  valor:'smg',         chance:7,  nome:'SMG'         },
      { tipo:'chave', valor:'chave_comum', chance:3,  nome:'Chave Comum' }
    ]
  }
];

/* =====================================================================
   VISUAL DE RECOMPENSA
     coins -> letra "C" (ouro)
     xp    -> texto "XP" (verde)
     arma  -> imagens/arma_<id>.png com fallback texto "ARMA"
     chave -> imagens/chave_comum.png com fallback texto "CHAVE"
   ===================================================================== */
function visualRecompensa(r){
  if (!r) return { tipo:'texto', texto:'?', cor:'#8a929c' };
  switch (r.tipo){
    case 'coins':
      return { tipo:'texto', texto:'C', cor:'#f0a020' };
    case 'xp':
      return { tipo:'texto', texto:'XP', cor:'#5ec97a' };
    case 'arma':
      return { tipo:'img', src:'imagens/arma_' + r.valor + '.png', fallback:'ARMA' };
    case 'chave':
      return { tipo:'img', src:'imagens/' + r.valor + '.png', fallback:'CHAVE' };
    default:
      return { tipo:'texto', texto:'?', cor:'#8a929c' };
  }
}

/* =====================================================================
   ESTADO LOCAL DAS CHAVES
   ------------------------------------------------------------
   O servidor é a fonte da verdade. Estas funções só espelham o
   estado para exibição rápida entre requisições.
   ===================================================================== */
function carregarChaves(){
  try{
    const s = localStorage.getItem('rajada_chaves');
    return s ? JSON.parse(s) : {};
  }catch(e){ return {}; }
}
function salvarChavesLocal(chaves){
  try{ localStorage.setItem('rajada_chaves', JSON.stringify(chaves)); }catch(e){}
}
function getChaves(){ return P._chaves || (P._chaves = carregarChaves()); }
function qtdChave(id){ return getChaves()[id] || 0; }

async function sincronizarChaves(){
  if(typeof API === 'undefined' || !API.token) return;
  try{
    const r = await API.pedir('get_chaves', {});
    if(r.ok){
      P._chaves = r.chaves;
      salvarChavesLocal(r.chaves);
    }
  }catch(e){}
}

/* =====================================================================
   ESTADO DA TEMPORADA
   ===================================================================== */
const TEMP_STATE = {
  numero:    1,
  inicio:    0,
  fim:       0,
  recompensaPendente: null,
  top10:     [],
  _carregado: false,

  diasRestantes(){
    const restam = (this.fim - Math.floor(Date.now()/1000)) / 86400;
    return Math.max(0, restam);
  },
  percentual(){
    const total   = this.fim - this.inicio;
    const passado = Math.floor(Date.now()/1000) - this.inicio;
    if(total <= 0) return 0;
    return Math.min(100, (passado / total) * 100);
  },

  async carregar(){
    if(typeof API === 'undefined' || !API.token) return;
    try{
      const r = await API.pedir('get_temporada', {});
      if(!r.ok) return;
      this.numero              = r.temporada.numero;
      this.inicio              = r.temporada.inicio;
      this.fim                 = r.temporada.fim;
      this.recompensaPendente  = r.recompensaPendente || null;
      this.top10               = r.top10 || [];
      this._carregado          = true;
    }catch(e){}
  }
};

/* =====================================================================
   INJECAO DE CSS
   ===================================================================== */
function injetarCSSJogo2(){
  if(document.getElementById('cssJogo2')) return;
  const st = document.createElement('style');
  st.id = 'cssJogo2';
  st.textContent = `
  #navTemporadas, #navCaixas { cursor:pointer; }
  #paginaTemporadas, #paginaCaixas { display:none; flex-direction:column; gap:16px; animation:fadeInPag .25s ease; }
  #paginaTemporadas.on, #paginaCaixas.on { display:flex; }

  .tempHeader { background: linear-gradient(135deg,rgba(240,160,32,.18),rgba(240,80,80,.12)); border: 1px solid rgba(240,160,32,.35); border-radius: 14px; padding: 18px; display:flex; flex-direction:column; gap:10px; }
  .tempNumero { font-size: 10px; font-weight:800; letter-spacing:.3em; color:var(--c1); text-transform:uppercase; }
  .tempTitulo { font-size:22px; font-weight:900; letter-spacing:.06em; }
  .tempProgresso { display:flex; flex-direction:column; gap:5px; }
  .tempProgBar { height:6px; background:rgba(255,255,255,.08); border-radius:99px; overflow:hidden; }
  .tempProgBar i { display:block; height:100%; border-radius:99px; background:linear-gradient(90deg,var(--c2),var(--c1)); transition:width .6s; }
  .tempDias { font-size:10px; color:var(--fraco); letter-spacing:.08em; }

  .tempRecompPendente { background: linear-gradient(135deg,rgba(94,201,122,.18),rgba(94,201,122,.08)); border: 1px solid rgba(94,201,122,.5); border-radius:13px; padding:16px; display:flex; align-items:center; gap:14px; animation: pulseVerde 2s infinite; }
  @keyframes pulseVerde { 0%,100%{ box-shadow:0 0 0 0 rgba(94,201,122,0); } 50%{ box-shadow:0 0 0 8px rgba(94,201,122,.12); } }
  .tempRecompIco {
    width:38px; height:38px; border-radius:9px; flex-shrink:0;
    display:flex; align-items:center; justify-content:center;
    background:rgba(94,201,122,.2); border:1px solid rgba(94,201,122,.55);
    color:#7ee088; font-family:var(--mono); font-weight:900; font-size:15px;
  }
  .tempRecompInfo { flex:1; }
  .tempRecompTit { font-size:13px; font-weight:800; color:var(--verde); }
  .tempRecompSub { font-size:10px; color:var(--fraco); margin-top:3px; }

  .tempSecTit { font-size:10px; font-weight:800; letter-spacing:.24em; color:var(--fraco); text-transform:uppercase; padding-bottom:8px; border-bottom:1px solid var(--linha); }
  .tempTop10 { display:flex; flex-direction:column; gap:6px; }
  .tempTopLinha { display:flex; align-items:center; gap:10px; padding:10px 12px; background:var(--sup); border:1px solid var(--linha); border-radius:9px; }
  .tempTopLinha.eu { border-color:rgba(240,160,32,.5); background:rgba(240,160,32,.08); }
  .tempTopPos { font-size:13px; font-weight:900; font-family:var(--mono); min-width:28px; text-align:center; }
  .tempTopPos.ouro  { color:#f0c030; }
  .tempTopPos.prata { color:#a0a8b8; }
  .tempTopPos.bronze{ color:#cd7f32; }
  .tempTopNick { flex:1; font-size:12px; font-weight:700; }
  .tempTopPts { font-size:10px; font-family:var(--mono); color:var(--c1); }
  .tempTopRecomp { font-size:9px; color:var(--verde); }

  .tempRecompLista { display:grid; grid-template-columns:repeat(auto-fill,minmax(140px,1fr)); gap:10px; }
  .tempRecompCard { background:var(--sup); border:1px solid var(--linha); border-radius:11px; padding:12px; display:flex; flex-direction:column; align-items:center; gap:6px; text-align:center; }
  .tempRecompCard .ico { font-size:14px; font-weight:900; font-family:var(--mono); color:var(--c1); letter-spacing:.06em; }
  .tempRecompCard .nome { font-size:10px; font-weight:700; }
  .tempRecompCard .val { font-size:12px; font-weight:900; font-family:var(--mono); color:var(--c1); }

  .caixasGrade { display:grid; grid-template-columns:repeat(auto-fill,minmax(150px,1fr)); gap:12px; }
  .caixaCard { background:var(--sup); border:1px solid var(--linha); border-radius:13px; padding:14px 12px; display:flex; flex-direction:column; align-items:center; gap:9px; text-align:center; cursor:pointer; transition:.18s; position:relative; overflow:hidden; }
  .caixaCard:hover { border-color:var(--c1); transform:translateY(-3px); box-shadow:0 10px 28px rgba(0,0,0,.5); }
  .caixaCard.sem-chave { opacity:.55; cursor:default; filter:grayscale(.4); }
  .caixaCard.sem-chave:hover { transform:none; border-color:var(--linha); box-shadow:none; }
  .caixaImg { width:90px; height:90px; object-fit:contain; filter:drop-shadow(0 6px 16px rgba(240,160,32,.5)); }
  .caixaFallback3d { width:90px; height:90px; }
  .caixaNome { font-size:11px; font-weight:800; letter-spacing:.06em; }
  .caixaChaveInfo { font-size:9px; color:var(--fraco); display:flex; align-items:center; gap:5px; }
  .caixaChaveInfo img { width:14px; height:14px; object-fit:contain; }
  .caixaQtdChave { position:absolute; top:8px; right:8px; background:var(--c1); color:#0d0f11; font-size:9px; font-weight:900; padding:2px 7px; border-radius:99px; }
  .btAbrirCaixa { width:100%; padding:8px; border-radius:8px; border:0; cursor:pointer; background:linear-gradient(135deg,var(--c2),var(--c1)); color:#0d0f11; font-size:10px; font-weight:900; letter-spacing:.12em; transition:.18s; }
  .btAbrirCaixa:hover { filter:brightness(1.12); }
  .btAbrirCaixa:disabled { background:var(--linha); color:var(--fraco); cursor:default; }

  .chavesSecTit { font-size:10px; font-weight:800; letter-spacing:.24em; color:var(--fraco); text-transform:uppercase; padding-bottom:8px; border-bottom:1px solid var(--linha); }
  .chavesGrade { display:grid; grid-template-columns:repeat(auto-fill,minmax(130px,1fr)); gap:10px; }
  .chaveCard { background:var(--sup); border:1px solid var(--linha); border-radius:11px; padding:11px; display:flex; flex-direction:column; align-items:center; gap:7px; text-align:center; }
  .chaveImg { width:56px; height:56px; object-fit:contain; filter:drop-shadow(0 4px 10px rgba(240,160,32,.4)); }
  .chaveNome { font-size:10px; font-weight:800; }
  .chaveQtd { font-size:16px; font-weight:900; font-family:var(--mono); color:var(--c1); }
  .chavePreco { font-size:9px; color:var(--fraco); }

  /* ---- Modal backdrop ---- */
  #mdAbrirCaixa {
    position: fixed; inset: 0; z-index: 600;
    display: none; align-items: center; justify-content: center;
    flex-direction: column; gap: 0;
    background: rgba(0,0,0,.82);
    backdrop-filter: blur(12px);
    padding: 16px;
  }
  #mdAbrirCaixa.on { display: flex; }

  /* Título acima da caixa */
  .caixaModalTit {
    font-size: 10px; font-weight: 800; letter-spacing: .32em;
    color: var(--c1); text-transform: uppercase; text-align: center;
    margin-bottom: 12px;
    text-shadow: 0 0 12px rgba(240,160,32,.6);
  }

  /* Container do GIF — menor, centralizado */
  #gifCaixaWrap {
    position: relative;
    width:  min(340px, 82vw);
    height: min(340px, 82vw);
    max-height: 55vh;
    border-radius: 14px;
    overflow: hidden;
    border: 2px solid #f0a020;
    box-shadow:
      0 0 22px rgba(240,160,32,.55),
      0 0 56px rgba(240,160,32,.22),
      inset 0 0 18px rgba(240,160,32,.1);
    animation: gifBordaPulsa 1.2s ease-in-out infinite alternate;
    flex-shrink: 0;
  }
  @keyframes gifBordaPulsa {
    from { box-shadow: 0 0 18px rgba(240,160,32,.45), 0 0 44px rgba(240,160,32,.18), inset 0 0 12px rgba(240,160,32,.08); }
    to   { box-shadow: 0 0 32px rgba(240,160,32,.80), 0 0 72px rgba(240,160,32,.35), inset 0 0 24px rgba(240,160,32,.18); }
  }

  /* GIF preenche o container sem barras pretas */
  #gifCaixaWrap > #gifCaixa {
    width: 100%; height: 100%;
    object-fit: cover;
    object-position: center;
    display: block;
  }

  /* Vinheta interna suave */
  #gifCaixaVinheta {
    position: absolute; inset: 0; pointer-events: none; z-index: 2;
    box-shadow: inset 0 0 36px rgba(0,0,0,.4);
    border-radius: 14px;
  }

  /* Status "Abrindo..." abaixo */
  #caixaStatus {
    margin-top: 14px; font-size: 9px;
    color: rgba(255,255,255,.35); letter-spacing: .24em;
    text-align: center; text-transform: uppercase;
  }

  /* Celular pequeno */
  @media (max-height: 560px) {
    #gifCaixaWrap { width: min(260px, 78vw); height: min(260px, 78vw); max-height: 52vh; }
    .caixaModalTit { margin-bottom: 8px; }
    #caixaStatus { margin-top: 8px; }
  }

  #mdAbrirCaixa > #canvasCaixa {
    position: static !important;
    inset: auto !important;
    top: auto !important; left: auto !important;
    right: auto !important; bottom: auto !important;
    opacity: 1 !important;
    display: block !important;
    transition: none !important;
    border-radius: 16px;
    background: transparent;
  }

  .caixaCard > .caixaFallback3d {
    position: static !important;
    inset: auto !important;
    opacity: 1 !important;
    transition: none;
  }

  #mdRecompensa { position:fixed; inset:0; z-index:700; display:none; align-items:center; justify-content:center; background:rgba(0,0,0,.88); backdrop-filter:blur(16px); }
  #mdRecompensa.on { display:flex; }
  .recompCx { background:var(--painel); border:1px solid var(--c1); border-radius:20px; padding:28px 24px; display:flex; flex-direction:column; align-items:center; gap:14px; text-align:center; animation:sobeM .5s cubic-bezier(.34,1.5,.5,1); min-width:260px; max-width:340px; box-shadow:0 0 60px rgba(240,160,32,.3); }
  .recompCifrau { font-size:10px; font-weight:800; letter-spacing:.3em; color:var(--c1); }
  .recompImg { width:110px; height:110px; object-fit:contain; filter:drop-shadow(0 8px 24px rgba(240,160,32,.7)); animation:pulsaRecomp 1.4s ease-in-out infinite; }
  @keyframes pulsaRecomp { 0%,100%{ transform:scale(1) rotate(-2deg); } 50%{ transform:scale(1.08) rotate(2deg); } }
  .recompNome { font-size:18px; font-weight:900; letter-spacing:.08em; }
  .recompDesc { font-size:11px; color:var(--fraco); }
  .btColetar { padding:13px 30px; border-radius:11px; border:0; cursor:pointer; background:linear-gradient(135deg,var(--c2),var(--c1)); color:#0d0f11; font-size:12px; font-weight:900; letter-spacing:.14em; transition:.18s; width:100%; }
  .btColetar:hover { filter:brightness(1.12); transform:scale(1.02); }

  .particula { position:fixed; pointer-events:none; z-index:650; border-radius:50%; animation:voaParticula linear forwards; }
  @keyframes voaParticula { 0% { transform:translate(0,0) scale(1); opacity:1; } 100% { transform:translate(var(--dx),var(--dy)) scale(0); opacity:0; } }

  .recompIconeArea {
    display:flex; align-items:center; justify-content:center;
    min-height:110px; width:100%;
  }
  .recompIconeTexto {
    font-family: var(--mono);
    font-weight: 900;
    line-height: 1;
    letter-spacing: .05em;
    filter: drop-shadow(0 4px 14px rgba(240,160,32,.55));
  }
  `;
  document.head.appendChild(st);
}

/* =====================================================================
   NAVBAR
   ===================================================================== */
function injetarNavJogo2(){
  const lado = document.querySelector('.lbLado');
  if(!lado || document.getElementById('navTemporadas')) return;

  const navT = document.createElement('div');
  navT.className = 'navItem';
  navT.id = 'navTemporadas';
  navT.dataset.nav = 'temporadas';
  navT.innerHTML = `
    <svg viewBox="0 0 24 24"><path d="M12 2l3.1 6.3L22 9.3l-5 4.9 1.2 6.8L12 17.8l-6.2 3.2L7 14.2 2 9.3l6.9-1L12 2z"/></svg>
    <span>Temporadas</span>
  `;
  lado.appendChild(navT);

  const navC = document.createElement('div');
  navC.className = 'navItem';
  navC.id = 'navCaixas';
  navC.dataset.nav = 'caixas';
  navC.innerHTML = `
    <svg viewBox="0 0 24 24"><path d="M20 7H4a2 2 0 00-2 2v10a2 2 0 002 2h16a2 2 0 002-2V9a2 2 0 00-2-2zm0 12H4V9h16v10zM12 3l-4 4h8l-4-4z"/></svg>
    <span>Caixas</span>
  `;
  lado.appendChild(navC);
}

/* =====================================================================
   PAGINAS
   ===================================================================== */
function injetarPaginasJogo2(){
  const meio = document.querySelector('.lbMeio');
  if(!meio || document.getElementById('paginaTemporadas')) return;

  const pgT = document.createElement('div');
  pgT.id = 'paginaTemporadas';
  pgT.className = 'paginaLobby';
  meio.appendChild(pgT);

  const pgC = document.createElement('div');
  pgC.id = 'paginaCaixas';
  pgC.className = 'paginaLobby';
  meio.appendChild(pgC);
}

/* =====================================================================
   RENDER — TEMPORADAS
   ===================================================================== */
async function renderTemporadas(){
  const pg = document.getElementById('paginaTemporadas'); if(!pg) return;
  pg.innerHTML = '<div style="text-align:center;padding:40px;color:var(--fraco)">Carregando...</div>';

  await TEMP_STATE.carregar();

  if(!TEMP_STATE._carregado){
    pg.innerHTML = '<div style="text-align:center;padding:40px;color:var(--fraco)">Faca login para ver as temporadas.</div>';
    return;
  }

  const top10    = TEMP_STATE.top10;
  const minhaPos = top10.findIndex(p => p.nick === P.nick);
  const pending  = TEMP_STATE.recompensaPendente;

  let html = `
    <div class="tempHeader">
      <div class="tempNumero">Temporada ${TEMP_STATE.numero}</div>
      <div class="tempTitulo">Batalha Tatica</div>
      <div class="tempProgresso">
        <div class="tempProgBar"><i style="width:${TEMP_STATE.percentual().toFixed(1)}%"></i></div>
        <div class="tempDias">${Math.ceil(TEMP_STATE.diasRestantes())} dias restantes - encerra em ${diasParaData(TEMP_STATE.diasRestantes())}</div>
      </div>
    </div>
  `;

  if(pending){
    html += `
      <div class="tempRecompPendente" id="tempRecompPendente">
        <div class="tempRecompIco">REC</div>
        <div class="tempRecompInfo">
          <div class="tempRecompTit">Recompensa disponivel - ${pending.titulo}</div>
          <div class="tempRecompSub">${pending.coins} coins - ${pending.xp} XP - ${pending.chaves} chave(s)</div>
        </div>
        <button class="edBt pri" id="btColetarTempRecomp" style="flex-shrink:0">Coletar</button>
      </div>
    `;
  }

  html += `<div class="tempSecTit">Recompensas da Temporada - Top 10</div>`;
  html += `<div class="tempRecompLista">`;
  CFG_TEMPORADAS.recompensas_top.forEach(r => {
    html += `
      <div class="tempRecompCard">
        <div class="ico">${r.posicao}o</div>
        <div class="nome">${r.titulo}</div>
        <div class="val">${r.coins.toLocaleString('pt-BR')} C</div>
        <div style="font-size:9px;color:var(--fraco)">${r.xp} XP - ${r.chaves} chave(s)</div>
      </div>
    `;
  });
  html += `</div>`;

  html += `<div class="tempSecTit">Classificacao Atual - Top 10</div>`;
  if(top10.length === 0){
    html += `<div class="amigoVazio">Nenhum jogador classificado ainda.</div>`;
  } else {
    html += `<div class="tempTop10">`;
    top10.forEach((p, i) => {
      const pos = i + 1;
      const clsPos = pos===1?'ouro':pos===2?'prata':pos===3?'bronze':'';
      const clsLinha = p.nick === P.nick ? 'tempTopLinha eu' : 'tempTopLinha';
      const recomp = CFG_TEMPORADAS.recompensas_top[i];
      html += `
        <div class="${clsLinha}">
          <span class="tempTopPos ${clsPos}">${pos}</span>
          <span class="tempTopNick">${p.nick}${p.nick===P.nick?' (voce)':''}</span>
          <span class="tempTopPts">${(p.pontos||0).toLocaleString('pt-BR')} pts</span>
          ${recomp ? `<span class="tempTopRecomp">${recomp.coins}C</span>` : ''}
        </div>
      `;
    });
    html += `</div>`;
    if(minhaPos < 0){
      html += `<div style="font-size:10px;color:var(--fraco);text-align:center;margin-top:6px">Voce nao esta no top 10 ainda. Continue jogando!</div>`;
    }
  }

  html += `
    <div style="background:rgba(255,80,80,.08);border:1px solid rgba(255,80,80,.25);border-radius:11px;padding:13px;font-size:10px;color:var(--fraco);line-height:1.7">
      <b style="color:#ff8ea0">Ao fim da temporada:</b>
      ${CFG_TEMPORADAS.reset.coins_remover_pct}% dos seus coins serao removidos -
      ${CFG_TEMPORADAS.reset.nivel_remover} niveis serao removidos -
      Algumas armas serao removidas do inventario.
      <br>Os top 10 recebem recompensas exclusivas!
    </div>
  `;

  pg.innerHTML = html;

  const btColetar = document.getElementById('btColetarTempRecomp');
  if(btColetar && pending){
    btColetar.addEventListener('click', async () => {
      btColetar.disabled = true;
      try{
        const r = await API.pedir('coletar_recompensa_temp', { recompensa_id: pending.id });
        if(r.ok){
          P.coins = r.coins; P.xp = r.xp;
          P._chaves = r.chaves; salvarChavesLocal(r.chaves);
          TEMP_STATE.recompensaPendente = null;
          if(typeof pintarLobby === 'function') pintarLobby();
          if(typeof aviso === 'function') aviso('Recompensa coletada! +'+pending.coins+' coins');
          renderTemporadas();
        }
      }catch(e){ btColetar.disabled = false; }
    });
  }
}

function diasParaData(dias){
  const d = new Date(Date.now() + dias * 86400000);
  return d.toLocaleDateString('pt-BR', { day:'2-digit', month:'2-digit' });
}

/* =====================================================================
   RENDER — CAIXAS
   ===================================================================== */
function renderCaixas(){
  const pg = document.getElementById('paginaCaixas'); if(!pg) return;
  const chaves = getChaves();

  let html = `
    <div style="max-width:700px;margin:0 auto;display:flex;flex-direction:column;gap:20px">

      <!-- Minhas Chaves -->
      <div>
        <div class="secTit" style="margin-bottom:12px">Minhas Chaves</div>
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:12px">
  `;
  CHAVES_CFG.forEach(ch => {
    const qtd = chaves[ch.id] || 0;
    html += `
      <div class="chaveCard" style="padding:18px 14px;gap:10px">
        <img class="chaveImg" src="${ch.img}" alt="${ch.nome}" style="width:72px;height:72px">
        <div class="chaveNome" style="font-size:12px">${ch.nome}</div>
        <div class="chaveQtd" style="font-size:28px">${qtd}</div>
        <div class="chavePreco" style="font-size:9px">${ch.preco.toLocaleString('pt-BR')} coins na loja</div>
      </div>
    `;
  });
  html += `</div></div>`;

  /* Caixas disponíveis */
  html += `
    <div>
      <div class="secTit" style="margin-bottom:12px">Caixas Disponiveis</div>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:14px">
  `;
  CAIXAS_CFG.forEach(cx => {
    const chaveCfg = CHAVES_CFG.find(c => c.id === cx.chave);
    const qtdChaveDisp = chaves[cx.chave] || 0;
    const semChave = qtdChaveDisp <= 0;
    html += `
      <div class="caixaCard ${semChave?'sem-chave':''}" data-caixaid="${cx.id}"
           style="padding:20px 16px;gap:12px;border-radius:14px">
        ${qtdChaveDisp > 0 ? `<span class="caixaQtdChave">${qtdChaveDisp}x</span>` : ''}
        <img src="${cx.img}" class="caixaImg" alt="${cx.nome}"
             data-caixaid="${cx.id}" style="width:120px;height:120px">
        <canvas class="caixaFallback3d" style="display:none;width:120px;height:120px"
                width="120" height="120" data-caixaid="${cx.id}"></canvas>
        <div class="caixaNome" style="font-size:13px">${cx.nome}</div>
        <div class="caixaChaveInfo" style="font-size:10px">
          <img src="${chaveCfg?.img||''}" alt="" style="width:16px;height:16px">
          <span>${chaveCfg?.nome||'Chave'} ${semChave?'<span style="color:var(--verm)">(0)</span>':'<b style="color:var(--c1)">('+qtdChaveDisp+')</b>'}</span>
        </div>
        <button class="btAbrirCaixa" data-caixaid="${cx.id}" ${semChave?'disabled':''}
                style="padding:11px;font-size:11px;letter-spacing:.16em">
          ${semChave?'Sem chave':'&#9654; Abrir caixa'}
        </button>
      </div>
    `;
  });
  html += `</div></div>`;

  /* Possíveis Recompensas */
  html += `<div><div class="secTit" style="margin-bottom:12px">Possiveis Recompensas</div>`;
  CAIXAS_CFG.forEach(cx => {
    html += `<div style="margin-bottom:8px">
      <div style="font-size:10px;font-weight:800;letter-spacing:.1em;margin-bottom:8px;color:var(--fraco)">${cx.nome}</div>
      <div style="display:flex;flex-wrap:wrap;gap:7px">`;
    cx.recompensas.forEach(r => {
      const vis = visualRecompensa(r);
      let iconeHtml = vis.tipo === 'img'
        ? `<img src="${vis.src}" style="width:18px;height:18px;object-fit:contain" data-recomp-img="1">`
        : `<span style="font-weight:900;font-family:var(--mono);color:${vis.cor};font-size:12px;line-height:1">${vis.texto}</span>`;
      html += `<div style="background:var(--sup);border:1px solid var(--linha);border-radius:9px;
        padding:7px 12px;font-size:9.5px;display:flex;align-items:center;gap:6px">
        ${iconeHtml}<span>${r.nome}</span>
        <span style="color:var(--fraco);font-family:var(--mono)">${r.chance}%</span></div>`;
    });
    html += `</div></div>`;
  });
  html += `</div></div>`;

  pg.innerHTML = html;

  pg.querySelectorAll('img.chaveImg').forEach(img => {
    const t = () => { img.style.display = 'none'; };
    img.addEventListener('error', t, { once:true });
    if (img.complete && img.naturalWidth === 0) t();
  });

  pg.querySelectorAll('img.caixaImg').forEach(img => {
    const mostrarFallback = () => {
      img.style.display = 'none';
      const cv = img.nextElementSibling;
      if (cv && cv.classList.contains('caixaFallback3d')){
        cv.style.display = 'block';
        if (!cv.dataset.desenhou){ desenharCaixaFallback(cv); cv.dataset.desenhou = '1'; }
      }
    };
    img.addEventListener('error', mostrarFallback, { once:true });
    if (img.complete && img.naturalWidth === 0) mostrarFallback();
  });

  pg.querySelectorAll('img[data-recomp-img]').forEach(img => {
    const t = () => { img.style.display = 'none'; };
    img.addEventListener('error', t, { once:true });
    if (img.complete && img.naturalWidth === 0) t();
  });

  pg.querySelectorAll('.btAbrirCaixa:not([disabled])').forEach(bt => {
    bt.addEventListener('click', (e) => {
      e.stopPropagation();
      abrirCaixa(bt.dataset.caixaid);
    });
  });
}

function desenharCaixaFallback(canvas){
  canvas.style.display = 'block';
  const ctx = canvas.getContext('2d');
  const w = canvas.width  = 90;
  const h = canvas.height = 90;
  const cx = w/2, cy = h/2;

  ctx.clearRect(0, 0, w, h);

  ctx.beginPath();
  ctx.moveTo(cx, cy-14); ctx.lineTo(cx+26, cy);
  ctx.lineTo(cx+26, cy+18); ctx.lineTo(cx, cy+30);
  ctx.fillStyle = '#2a3038'; ctx.fill();
  ctx.strokeStyle = 'rgba(240,160,32,.5)'; ctx.lineWidth=1; ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(cx, cy-14); ctx.lineTo(cx-26, cy);
  ctx.lineTo(cx-26, cy+18); ctx.lineTo(cx, cy+30);
  ctx.fillStyle = '#1e2228'; ctx.fill();
  ctx.strokeStyle = 'rgba(240,160,32,.35)'; ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(cx, cy-30); ctx.lineTo(cx+26, cy-14);
  ctx.lineTo(cx, cy); ctx.lineTo(cx-26, cy-14);
  ctx.fillStyle = '#3a4250'; ctx.fill();
  ctx.strokeStyle = 'rgba(240,160,32,.6)'; ctx.stroke();

  ctx.strokeStyle = 'rgba(240,160,32,.7)'; ctx.lineWidth=1.5;
  ctx.beginPath(); ctx.moveTo(cx, cy-30); ctx.lineTo(cx, cy); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(cx-26, cy-14); ctx.lineTo(cx+26, cy-14); ctx.stroke();
}

/* =====================================================================
   ABERTURA DA CAIXA — COM SERVIDOR COMO FONTE DA VERDADE
   ---------------------------------------------------------------------
   Fluxo:
     1. Cliente envia { acao:'abrir_caixa', caixa_id }
     2. Servidor confere chave, desconta, sorteia, aplica no banco
     3. Servidor devolve { recompensa, chaves, coins, xp, nivel, armasTem }
     4. Cliente atualiza estado local e toca o video
     5. Ao terminar o video, mostra modal de recompensa
     6. Botao "Coletar" apenas fecha o modal (nada mais a aplicar)
   ===================================================================== */
let _caixaAbrindo = false;

async function abrirCaixa(caixaId){
  if(_caixaAbrindo) return;
  const cx = CAIXAS_CFG.find(c => c.id === caixaId); if(!cx) return;

  _caixaAbrindo = true;
  try {
    let r;
    try {
      r = await API.pedir('abrir_caixa', { caixa_id: caixaId });
    } catch(e){
      if(typeof aviso === 'function') aviso('Erro de rede');
      return;
    }

    if (!r.ok){
      if (r.erro === 'sem_chave')          { if(typeof aviso==='function') aviso('Sem chave para essa caixa'); return; }
      if (r.erro === 'muitas_tentativas')  { if(typeof aviso==='function') aviso('Calma! Muitas aberturas seguidas'); return; }
      if (r.erro === 'sessao_invalida')    { if(typeof aviso==='function') aviso('Sessao expirada'); return; }
      if (r.erro === 'caixa_invalida')     { if(typeof aviso==='function') aviso('Caixa invalida'); return; }
      if(typeof aviso==='function') aviso('Erro: ' + (r.erro||'desconhecido'));
      return;
    }

    /* Sincroniza o estado local com o que o servidor devolveu */
    P._chaves  = r.chaves;       salvarChavesLocal(r.chaves);
    P.coins    = r.coins;
    P.xp       = r.xp;
    P.nivel    = r.nivel;
    P.armasTem = r.armasTem;
    salvarPerfil();
    if(typeof pintarLobby === 'function') pintarLobby();
    if(typeof renderCaixas === 'function') renderCaixas();

    /* Agora toca o video (ou fallback 2D) e mostra a recompensa */
    abrirModalCaixaVideo(cx, r.recompensa);

  } finally {
    /* Só liberamos o flag quando o modal terminar (finalizarAbertura) */
    if (!document.getElementById('mdAbrirCaixa') ||
        !document.getElementById('mdAbrirCaixa').classList.contains('on')){
      _caixaAbrindo = false;
    }
  }
}

/* =====================================================================
   ABERTURA DA CAIXA POR GIF  (modal grande)
   ---------------------------------------------------------------------
   O GIF ocupa quase toda a tela e dura exatamente 1,7 segundos.
   Ao fim do tempo o modal fecha e a recompensa é exibida.
   Fallback 2D é mantido caso o GIF não carregue em 3 s.
   ===================================================================== */
function abrirModalCaixaVideo(caixaCfg, recompensa){
  let md = document.getElementById('mdAbrirCaixa');
  if(!md){
    md = document.createElement('div');
    md.id = 'mdAbrirCaixa';
    document.body.appendChild(md);
  }

  const GIF_DURACAO_MS = 1700; /* duração exata do GIF em milissegundos — só usado no fallback GIF abaixo */

  /* Usa gif se disponível, senão cai no video (retrocompatibilidade) */
  const webmSrc = caixaCfg.webm  || null;
  const gifSrc  = caixaCfg.gif   || null;
  const videoSrc = caixaCfg.video || null;

  /* Prefere WebM (62fps real) → GIF → fallback 2D */
  const usarWebm = !!webmSrc;
  const src = webmSrc || gifSrc || videoSrc;
  const DURACAO_MS = usarWebm ? 5800 : (caixaCfg.gifDuracao || 4800);

  if (usarWebm) {
    /* ---- WebM: <video> mudo, sem controles ---- */
    md.innerHTML =
      '<div class="caixaModalTit">' + caixaCfg.nome + '</div>' +
      '<div id="gifCaixaWrap">' +
        '<video id="gifCaixa" playsinline muted preload="auto" ' +
          'style="width:100%;height:100%;object-fit:cover;display:block;border-radius:14px">' +
          '<source src="' + src + '?t=' + Date.now() + '" type="video/webm">' +
        '</video>' +
        '<div id="gifCaixaVinheta"></div>' +
      '</div>' +
      '<div id="caixaStatus" style="font-size:9px;opacity:.5;letter-spacing:.18em">TOQUE PARA PULAR</div>';
    md.classList.add('on');

    const vid = document.getElementById('gifCaixa');
    let finalizado = false, timerFim = null, timerFallback = null;

    const finalizar = (motivo) => {
      if (finalizado) return;
      finalizado = true;
      clearTimeout(timerFim); clearTimeout(timerFallback);
      md.removeEventListener('click', pularAnim);
      try { vid.pause(); vid.removeAttribute('src'); vid.load(); } catch(e){}
      finalizarAbertura(md, recompensa, caixaCfg);
    };

    /* Clique/toque na tela pula a animação */
    const pularAnim = () => finalizar('skip');
    /* Pequeno delay para não pular imediatamente ao clicar no botão "Abrir caixa" */
    setTimeout(() => md.addEventListener('click', pularAnim), 400);

    /* Fallback generoso: 12s — WebM pode demorar para carregar no celular */
    timerFallback = setTimeout(() => {
      if (!finalizado){
        finalizado = true;
        md.removeEventListener('click', pularAnim);
        mostrarFallback2DNoModal(md, caixaCfg, recompensa);
      }
    }, 12000);

    const tentarTocar = () => {
      clearTimeout(timerFallback);
      const p = vid.play();
      if (p && p.catch) p.catch(() => { vid.muted = true; vid.play().catch(() => {}); });
      timerFim = setTimeout(() => finalizar('webm-ended'), DURACAO_MS);
    };

    /* canplay dispara assim que tem dados suficientes para tocar */
    vid.addEventListener('canplay', tentarTocar, { once: true });

    /* Se demorar 8s sem canplay, tenta tocar mesmo assim */
    const timerForcar = setTimeout(() => {
      if (!finalizado && vid.readyState < 2) tentarTocar();
    }, 8000);

    vid.addEventListener('ended', () => finalizar('ended'));
    vid.addEventListener('error', () => {
      clearTimeout(timerFallback); clearTimeout(timerForcar);
      if (!finalizado){ finalizado = true; md.removeEventListener('click', pularAnim); mostrarFallback2DNoModal(md, caixaCfg, recompensa); }
    }, { once: true });

  } else {
    /* ---- GIF: <img> com timer fixo ---- */
    md.innerHTML =
      '<div class="caixaModalTit">' + caixaCfg.nome + '</div>' +
      '<div id="gifCaixaWrap">' +
        '<img id="gifCaixa" alt="Abrindo caixa">' +
        '<div id="gifCaixaVinheta"></div>' +
      '</div>' +
      '<div id="caixaStatus" style="font-size:9px;opacity:.5;letter-spacing:.18em">TOQUE PARA PULAR</div>';
    md.classList.add('on');

    const gifEl = document.getElementById('gifCaixa');
    let finalizado = false, timerGif = null, timerFallback = null;

    const finalizar = (motivo) => {
      if (finalizado) return;
      finalizado = true;
      clearTimeout(timerGif); clearTimeout(timerFallback);
      md.removeEventListener('click', pularAnim);
      try { gifEl.src = ''; } catch(e){}
      finalizarAbertura(md, recompensa, caixaCfg);
    };

    const pularAnim = () => finalizar('skip');
    setTimeout(() => md.addEventListener('click', pularAnim), 400);

    timerFallback = setTimeout(() => {
      if (!finalizado){ finalizado = true; clearTimeout(timerGif);
        md.removeEventListener('click', pularAnim);
        try{ gifEl.src=''; }catch(e){}
        mostrarFallback2DNoModal(md, caixaCfg, recompensa); }
    }, 6000);

    gifEl.addEventListener('load', () => {
      clearTimeout(timerFallback);
      timerGif = setTimeout(() => finalizar('gif-ended'), DURACAO_MS);
    }, { once: true });

    gifEl.addEventListener('error', () => {
      clearTimeout(timerFallback);
      if (!finalizado){ finalizado = true; md.removeEventListener('click', pularAnim);
        try{ gifEl.src=''; }catch(e){} mostrarFallback2DNoModal(md, caixaCfg, recompensa); }
    }, { once: true });

    gifEl.src = src + '?t=' + Date.now();
  }
}

function mostrarFallback2DNoModal(md, caixaCfg, recompensa){
  const W = Math.min(innerWidth  * 0.85, 700);
  const H = Math.min(innerHeight * 0.75, 560);

  md.innerHTML =
    '<div class="caixaModalTit">' + caixaCfg.nome + '</div>' +
    '<canvas id="canvasCaixa" width="' + W + '" height="' + H + '" ' +
      'style="width:' + W + 'px;height:' + H + 'px;position:static;opacity:1;display:block;' +
      'border-radius:18px"></canvas>' +
    '<div id="caixaStatus" style="font-size:11px;color:var(--fraco);margin-top:10px;letter-spacing:.1em;max-width:90vw;text-align:center">Abrindo...</div>';

  animarCaixaFallback(W, H, caixaCfg, () => {
    finalizarAbertura(md, recompensa, caixaCfg);
  });
}

/* A recompensa ja foi aplicada pelo servidor — aqui so exibimos */
function finalizarAbertura(md, recompensa, caixaCfg){
  _caixaAbrindo = false;
  md.classList.remove('on');
  mostrarRecompensa(recompensa, caixaCfg);
  lancaParticulas();
  if(typeof renderCaixas === 'function') renderCaixas();
  if(typeof pintarLobby === 'function') pintarLobby();
}

/* =====================================================================
   FALLBACK 2D
   ===================================================================== */
function animarCaixaFallback(W, H, caixaCfg, onFim){
  const canvas = document.getElementById('canvasCaixa');
  if(!canvas){ setTimeout(onFim, 2000); return; }
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');

  const duracao = 2400;
  const inicio  = performance.now();

  const img = new Image();
  img.src = caixaCfg.img;

  function frame(now){
    const t  = Math.min(1, (now - inicio) / duracao);
    ctx.clearRect(0, 0, W, H);

    const grad = ctx.createRadialGradient(W/2, H/2, 0, W/2, H/2, W/1.4);
    grad.addColorStop(0, 'rgba(240,160,32,' + (0.12 + Math.sin(t*Math.PI*4)*0.06) + ')');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = grad; ctx.fillRect(0, 0, W, H);

    const escala = t < 0.3 ? (t/0.3) * 1.1 : t < 0.5 ? 1.1 - (t-0.3)/0.2*0.1 : 1.0;
    const tremor = t > 0.5 && t < 0.85 ? Math.sin(t * 80) * 4 * (1 - (t-0.5)/0.35) : 0;
    const opacidade = t > 0.85 ? Math.max(0, 1 - (t - 0.85) / 0.15) : 1;

    ctx.save();
    ctx.globalAlpha = opacidade;
    ctx.translate(W/2 + tremor, H/2);
    ctx.scale(escala, escala);

    if(img.complete && img.naturalWidth > 0){
      const sz = Math.min(W, H) * 0.7;
      ctx.drawImage(img, -sz/2, -sz/2, sz, sz);
    } else {
      desenharCaixaCtx(ctx, 0, 0, Math.min(W,H)*0.4);
    }

    if(t > 0.5){
      const int = (t - 0.5) / 0.5;
      for(let i = 0; i < 8; i++){
        const ang = (i/8) * Math.PI*2 + t*3;
        const len = 60 * int + Math.sin(t*20 + i)*10;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(Math.cos(ang)*len, Math.sin(ang)*len);
        ctx.strokeStyle = 'rgba(240,160,32,' + (0.4*int) + ')';
        ctx.lineWidth = 2; ctx.stroke();
      }
    }
    ctx.restore();

    if(t > 0.6 && t < 0.85){
      const a = Math.sin((t - 0.6) / 0.25 * Math.PI);
      ctx.save();
      ctx.globalAlpha = a;
      ctx.font = 'bold 13px sans-serif';
      ctx.fillStyle = 'rgba(240,160,32,0.9)';
      ctx.textAlign = 'center';
      ctx.fillText('Abrindo...', W/2, H - 18);
      ctx.restore();
    }

    if(t < 1){
      requestAnimationFrame(frame);
    } else {
      animarExplosaoFinal(ctx, W, H, onFim);
    }
  }
  requestAnimationFrame(frame);
}

function desenharCaixaCtx(ctx, x, y, s){
  ctx.beginPath();
  ctx.moveTo(x, y-s*0.35); ctx.lineTo(x+s*0.5, y);
  ctx.lineTo(x+s*0.5, y+s*0.35); ctx.lineTo(x, y+s*0.7);
  ctx.fillStyle = '#2a3038'; ctx.fill();
  ctx.strokeStyle = 'rgba(240,160,32,.6)'; ctx.lineWidth=1.5; ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(x, y-s*0.35); ctx.lineTo(x-s*0.5, y);
  ctx.lineTo(x-s*0.5, y+s*0.35); ctx.lineTo(x, y+s*0.7);
  ctx.fillStyle = '#1e2228'; ctx.fill();
  ctx.strokeStyle = 'rgba(240,160,32,.4)'; ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(x, y-s*0.7); ctx.lineTo(x+s*0.5, y-s*0.35);
  ctx.lineTo(x, y); ctx.lineTo(x-s*0.5, y-s*0.35);
  ctx.fillStyle = '#3a4250'; ctx.fill();
  ctx.strokeStyle = 'rgba(240,160,32,.8)'; ctx.stroke();
}

function animarExplosaoFinal(ctx, W, H, onFim){
  const inicio = performance.now();
  const dur    = 600;

  function frame(now){
    const t = Math.min(1, (now - inicio) / dur);
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(240,160,32,' + Math.max(0, 0.8 - t * 0.8) + ')';
    ctx.fillRect(0, 0, W, H);
    ctx.beginPath();
    ctx.arc(W/2, H/2, t * W * 0.8, 0, Math.PI*2);
    ctx.strokeStyle = 'rgba(240,160,32,' + (1 - t) + ')';
    ctx.lineWidth = 4 * (1 - t);
    ctx.stroke();
    if(t < 1) requestAnimationFrame(frame);
    else       onFim();
  }
  requestAnimationFrame(frame);
}

/* =====================================================================
   PARTICULAS
   ===================================================================== */
function lancaParticulas(){
  const cores = ['#f0a020','#f0c030','#5ec97a','#4aa3ff','#e74c3c','#ffffff'];
  for(let i = 0; i < 60; i++){
    const p = document.createElement('div');
    p.className = 'particula';
    const sz    = 4 + Math.random() * 8;
    const dx    = (Math.random() - 0.5) * innerWidth * 0.9;
    const dy    = -(Math.random() * innerHeight * 0.7 + 100);
    const dur   = 800 + Math.random() * 1200;
    const cor   = cores[Math.floor(Math.random() * cores.length)];
    p.style.cssText = 'width:'+sz+'px; height:'+sz+'px; background:'+cor+'; left:'+(innerWidth/2 + (Math.random()-0.5)*80)+'px; top:'+(innerHeight/2)+'px; --dx:'+dx+'px; --dy:'+dy+'px; animation-duration:'+dur+'ms;';
    document.body.appendChild(p);
    setTimeout(function(){ p.remove(); }, dur + 100);
  }
}

/* =====================================================================
   MODAL DE RECOMPENSA
     A recompensa já foi aplicada pelo servidor. O botão "Coletar"
     só fecha o modal e confirma pro jogador.
   ===================================================================== */
function mostrarRecompensa(recompensa, caixaCfg){
  let md = document.getElementById('mdRecompensa');
  if(!md){
    md = document.createElement('div');
    md.id = 'mdRecompensa';
    document.body.appendChild(md);
  }

  const descTipo = {
    coins: '+' + (recompensa.valor*(recompensa.qtd||1)).toLocaleString('pt-BR') + ' Coins',
    xp:    '+' + (recompensa.valor*(recompensa.qtd||1)).toLocaleString('pt-BR') + ' XP',
    arma:  'Nova arma desbloqueada!',
    chave: '+' + (recompensa.qtd||1) + ' chave(s)'
  };

  md.innerHTML =
    '<div class="recompCx">' +
      '<div class="recompCifrau">VOCE GANHOU</div>' +
      '<div class="recompIconeArea" id="recompIconeArea"></div>' +
      '<div class="recompNome">' + recompensa.nome + '</div>' +
      '<div class="recompDesc">' + (descTipo[recompensa.tipo] || '') + '</div>' +
      '<button class="btColetar" id="btColetarCaixa">Coletar</button>' +
    '</div>';
  md.classList.add('on');

  /* Monta o icone da recompensa */
  const area = md.querySelector('#recompIconeArea');
  const vis  = visualRecompensa(recompensa);

  if (vis.tipo === 'img'){
    const img = document.createElement('img');
    img.className = 'recompImg';
    img.alt = '';
    img.src = vis.src;
    img.style.display = 'none';

    const txt = document.createElement('div');
    txt.className = 'recompIconeTexto';
    txt.style.fontSize = '30px';
    txt.style.color = '#f0a020';
    txt.textContent = vis.fallback;

    img.addEventListener('load', () => { img.style.display = 'block'; txt.style.display = 'none'; });
    img.addEventListener('error', () => { img.style.display = 'none'; txt.style.display = 'block'; });

    area.appendChild(img);
    area.appendChild(txt);

    if (img.complete && img.naturalWidth === 0){
      img.style.display = 'none';
      txt.style.display = 'block';
    }
  } else {
    const txt = document.createElement('div');
    txt.className = 'recompIconeTexto';
    txt.style.fontSize = vis.texto.length > 1 ? '54px' : '86px';
    txt.style.color = vis.cor;
    txt.textContent = vis.texto;
    area.appendChild(txt);
  }

  const btCol = document.getElementById('btColetarCaixa');
  if(btCol){
    btCol.addEventListener('click', function(){
      /* A recompensa já foi creditada no servidor. Só fechamos. */
      md.classList.remove('on');
      if(typeof aviso === 'function') aviso('Coletado: ' + recompensa.nome);
    });
  }
}

/* =====================================================================
   LOJA — chave
   ===================================================================== */
function injetarChavesNaLoja(){
  const orig = typeof renderLoja === 'function' ? renderLoja : null;
  if(!orig) return;

  window._renderLojaOriginal = orig;
  window.renderLoja = function(){
    window._renderLojaOriginal();
    setTimeout(function(){
      const grid = document.getElementById('gradeLoja'); if(!grid) return;
      if(grid.querySelector('.secChavesLoja')) return;

      const secao = document.createElement('div');
      secao.className = 'secChavesLoja';
      secao.style.cssText = 'grid-column:1/-1;margin-top:10px';

      let cards = '';
      CHAVES_CFG.forEach(function(ch){
        const qtd = qtdChave(ch.id);
        cards +=
          '<div class="cardArma" style="cursor:pointer" data-chave="' + ch.id + '">' +
            '<div class="cardArmaImg" style="height:90px">' +
              '<span class="fallback">' + ch.nome + '</span>' +
              '<img src="' + ch.img + '" alt="' + ch.nome + '" style="max-width:75%;max-height:75%;object-fit:contain" ' +
                'onload="var f=this.previousElementSibling;if(f)f.style.display=\'none\'" ' +
                'onerror="this.style.display=\'none\'">' +
            '</div>' +
            '<div class="cardArmaInfo">' +
              '<div class="cardArmaNome">' + ch.nome + '</div>' +
              '<div class="cardArmaSub">' + ch.info + '</div>' +
              '<div class="cardArmaPreco">' +
                (qtd > 0 ? '<span class="cardArmaPrecoV tem">Possui ' + qtd + '</span>' : '<span class="cardArmaPrecoV">' + ch.preco.toLocaleString('pt-BR') + ' C</span>') +
              '</div>' +
              '<button class="cardArmaBtn" data-chave="' + ch.id + '">' +
                (qtd > 0 ? 'Comprar mais' : 'Comprar') +
              '</button>' +
            '</div>' +
          '</div>';
      });

      secao.innerHTML =
        '<div class="secTit" style="margin-bottom:10px">Chaves de Caixas</div>' +
        '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:10px">' +
          cards +
        '</div>';
      grid.appendChild(secao);

      secao.querySelectorAll('button.cardArmaBtn[data-chave]').forEach(function(btn){
        btn.addEventListener('click', async function(e){
          e.stopPropagation(); /* impede bubble para o div pai */
          if(btn.disabled) return; /* guard contra clique duplo */
          const id = btn.dataset.chave;
          const cfg = CHAVES_CFG.find(function(c){ return c.id === id; }); if(!cfg) return;
          if(P.coins < cfg.preco){
            if(typeof aviso === 'function') aviso('Coins insuficientes');
            return;
          }
          /* Desabilita o botão imediatamente para evitar compra dupla */
          btn.disabled = true;
          btn.textContent = 'Comprando...';
          try {
            if(typeof API !== 'undefined' && API.token){
              const r = await API.pedir('comprar_chave', { chave_id: id });
              if(!r.ok){
                if(typeof aviso === 'function') aviso(r.erro === 'coins_insuficientes' ? 'Coins insuficientes' : 'Erro na compra');
                btn.disabled = false;
                btn.textContent = 'Comprar mais';
                return;
              }
              P.coins   = r.coins;
              P._chaves = r.chaves;
              salvarChavesLocal(r.chaves);
            } else {
              P.coins -= cfg.preco;
              const ch = getChaves(); ch[id] = (ch[id]||0)+1; P._chaves = ch; salvarChavesLocal(ch);
              salvarPerfil();
            }
            if(typeof pintarLobby === 'function') pintarLobby();
            if(typeof renderLoja === 'function') renderLoja();
            if(typeof aviso === 'function') aviso('Comprado: ' + cfg.nome);
          } catch(err) {
            btn.disabled = false;
            btn.textContent = 'Comprar mais';
          }
        });
      });
    }, 100);
  };
}

/* =====================================================================
   VERIFICACAO
   ===================================================================== */
async function verificarRecompensaTemporada(){
  if(!API || !API.token) return;
  await TEMP_STATE.carregar();
  if(TEMP_STATE.recompensaPendente){
    setTimeout(function(){
      const r = TEMP_STATE.recompensaPendente;
      if(typeof aviso === 'function')
        aviso(r.titulo + '! Recompensa disponivel em Temporadas.');
    }, 2000);
  }
}

/* =====================================================================
   BOOT
   ===================================================================== */
function iniciarJogo2(){
  P._chaves = carregarChaves();
  injetarCSSJogo2();
  injetarNavJogo2();
  injetarPaginasJogo2();
  injetarChavesNaLoja();

  setTimeout(async function(){
    await sincronizarChaves();
    await verificarRecompensaTemporada();
  }, 1500);

  const origPintarLobby = typeof pintarLobby === 'function' ? pintarLobby : null;
  if(origPintarLobby && !window._jogo2PatchedLobby){
    window._jogo2PatchedLobby = true;
    window.pintarLobby = function(){
      origPintarLobby();
      const nav = document.getElementById('navTemporadas');
      if(nav && TEMP_STATE.recompensaPendente){
        if(!nav.querySelector('.tempBadge')){
          const b = document.createElement('span');
          b.className = 'tempBadge';
          b.style.cssText = 'position:absolute;top:-3px;right:-3px;width:8px;height:8px;border-radius:50%;background:#5ec97a;display:block';
          nav.style.position='relative';
          nav.appendChild(b);
        }
      } else if(nav){
        const b = nav.querySelector('.tempBadge');
        if(b) b.remove();
      }
    };
  }

  console.log('%c RAJADA jogo2.js carregado ', 'background:#5ec97a;color:#0d0f11;font-weight:bold;padding:2px 7px;border-radius:4px');
}

(function bootJogo2(){
  function tentar(tentativas){
    const meio = document.querySelector('.lbMeio');
    const paginaOk = document.getElementById('paginaInicio');
    const ladoOk   = document.querySelector('.lbLado');

    if(meio && paginaOk && ladoOk){
      iniciarJogo2();
    } else if(tentativas < 40){
      setTimeout(function(){ tentar(tentativas + 1); }, 100);
    } else {
      console.warn('[jogo2] Timeout aguardando lbMeio - iniciando assim mesmo');
      iniciarJogo2();
    }
  }

  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', function(){ tentar(0); });
  } else {
    tentar(0);
  }
})();

document.addEventListener('DOMContentLoaded', function(){
  setTimeout(function(){
    if(typeof NET === 'undefined') return;
    const origReceber = NET._receber.bind(NET);
    NET._receber = function(m){
      origReceber(m);
      if(m.type === 'temporada_reset'){
        TEMP_STATE._carregado = false;
        sincronizarChaves();
        if(typeof salvarPerfil === 'function') salvarPerfil();
        if(typeof API !== 'undefined' && API.token){
          API.carregarPerfilServidor().then(function(){
            if(typeof pintarLobby === 'function') pintarLobby();
          });
        }
        if(typeof aviso === 'function')
          aviso(m.msg || 'Nova temporada iniciada!');
      }
    };
  }, 2000);
>>>>>>> 34fffe9 (Primeiro commit)
});