(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const screens = ["welcomeScreen", "colorScreen", "gameScreen"];
  const PIECES = {
    wk:"♔", wq:"♕", wr:"♖", wb:"♗", wn:"♘", wp:"♙",
    bk:"♚", bq:"♛", br:"♜", bb:"♝", bn:"♞", bp:"♟"
  };
  let selectedColor = null, humanColor = "w", game = null, selectedSquare = null;
  let legalTargets = [], lastMove = null, gameLocked = false, engineBusy = false;
  let engine = null, engineReady = false, engineFailed = false, engineMode = "none";
  let requestId = 0, activeRequest = null, engineTimeout = null, mateTimer = null, toastTimer = null;
  let soundOn = true, audioContext = null, mateEventId = 0, resultShown = false;
  let moves = [], fallbackDepth = 2;

  function showScreen(id) {
    screens.forEach(s => $(s).classList.toggle("active", s === id));
    window.scrollTo({top:0, behavior:"smooth"});
  }
  function toast(message) {
    const el = $("toast"); el.textContent = message; el.classList.add("show");
    clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove("show"), 3200);
  }
  function unlockAudio() {
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (Ctx && !audioContext) audioContext = new Ctx();
      if (audioContext && audioContext.state === "suspended") audioContext.resume().catch(()=>{});
    } catch (_) {}
  }
  function tone(freq, duration=.09, type="sine", volume=.035, delay=0) {
    if (!soundOn) return;
    try {
      unlockAudio(); if (!audioContext) return;
      const start = audioContext.currentTime + delay;
      const osc = audioContext.createOscillator(), gain = audioContext.createGain();
      osc.type = type; osc.frequency.setValueAtTime(freq, start);
      gain.gain.setValueAtTime(.0001, start); gain.gain.exponentialRampToValueAtTime(volume, start+.012);
      gain.gain.exponentialRampToValueAtTime(.0001, start+duration);
      osc.connect(gain); gain.connect(audioContext.destination); osc.start(start); osc.stop(start+duration+.02);
    } catch (_) {}
  }
  function playMoveSound(capture=false, check=false) {
    if (check) { tone(620,.12,"triangle",.045); tone(420,.17,"triangle",.035,.11); }
    else if (capture) { tone(240,.08,"square",.025); tone(155,.12,"triangle",.04,.06); }
    else { tone(440,.055,"sine",.025); tone(570,.045,"sine",.018,.035); }
  }
  function playMateSound() { tone(392,.24,"triangle",.055); tone(311,.32,"triangle",.05,.18); tone(196,.6,"sine",.06,.42); }
  function stopSpeech() { try { if ("speechSynthesis" in window) window.speechSynthesis.cancel(); } catch (_) {} }
  function speakMate() {
    if (!soundOn || !("speechSynthesis" in window)) return;
    try {
      stopSpeech();
      const u = new SpeechSynthesisUtterance("This is the last move, Jesman. From Chrismi.");
      u.rate = .82; u.pitch = .78; u.volume = .95;
      const voices = window.speechSynthesis.getVoices();
      const preferred = voices.find(v => /en.*(male|david|mark|daniel|alex|fred)/i.test(v.name+" "+v.lang)) || voices.find(v => /^en/i.test(v.lang));
      if (preferred) u.voice = preferred;
      window.speechSynthesis.speak(u);
    } catch (_) {}
  }
  function setEngineStatus(text, state="ready") {
    $("engineStatus").textContent = text;
    $("engineLed").className = "engine-led" + (state==="busy" ? " busy" : state==="error" ? " error" : "");
  }

  // Prefer a genuine Stockfish worker. If the browser/network cannot load it, use
  // a legal-move fallback with chess.js and clearly disclose the reduced strength.
  function initEngine() {
    if (engineReady || engineBusy) return;
    engineFailed = false; setEngineStatus("Loading Stockfish…", "busy");
    const sources = [
      "https://cdnjs.cloudflare.com/ajax/libs/stockfish.js/10.0.2/stockfish.js",
      "https://cdn.jsdelivr.net/npm/stockfish@10.0.2/stockfish.js"
    ];
    let index = 0;
    function trySource() {
      if (index >= sources.length) {
        engineFailed = true; engineReady = true; engineMode = "fallback";
        setEngineStatus("Basic legal-move mode · Stockfish unavailable", "error");
        toast("Stockfish could not load. You can still play, but Chrismi strength is reduced.");
        if (game && humanColor === "b" && game.turn()==="w" && !game.game_over()) scheduleBotMove();
        return;
      }
      const src = sources[index++];
      try {
        const workerCode = `importScripts("${src}");`;
        const blob = new Blob([workerCode], {type:"application/javascript"});
        const url = URL.createObjectURL(blob);
        const candidate = new Worker(url);
        let gotUci = false;
        const failTimer = setTimeout(() => {
          if (!gotUci) { candidate.terminate(); URL.revokeObjectURL(url); trySource(); }
        }, 7000);
        candidate.onmessage = (e) => {
          const line = typeof e.data === "string" ? e.data : "";
          if (line.includes("uciok")) {
            gotUci = true; clearTimeout(failTimer);
            engine = candidate; engineReady = true; engineFailed = false; engineMode = "stockfish";
            try { URL.revokeObjectURL(url); } catch (_) {}
            engine.postMessage("isready");
            setEngineStatus("Stockfish ready · Strong engine", "ready");
            if (game && humanColor === "b" && game.turn()==="w" && !game.game_over()) scheduleBotMove();
          } else if (line.includes("bestmove") && activeRequest) {
            const req = activeRequest; activeRequest = null; clearTimeout(engineTimeout);
            const match = line.match(/bestmove\s([a-h][1-8][a-h][1-8][qrbn]?)/);
            if (!match) { recoverEngine("Chrismi couldn't find a move. Retry the engine."); return; }
            finishBotMove(match[1], req);
          } else if (line.includes("readyok") && engineMode==="stockfish") {
            // The worker is ready; no action needed.
          }
        };
        candidate.onerror = () => {
          clearTimeout(failTimer); try { candidate.terminate(); URL.revokeObjectURL(url); } catch (_) {}
          if (!gotUci) trySource(); else recoverEngine("Stockfish encountered an error.");
        };
        candidate.postMessage("uci");
      } catch (_) { trySource(); }
    }
    trySource();
  }
  function recoverEngine(message) {
    clearTimeout(engineTimeout); activeRequest = null; engineBusy = false;
    if (engine) { try { engine.terminate(); } catch (_) {} engine = null; }
    engineReady = false; engineFailed = true; engineMode = "fallback";
    setEngineStatus("Engine recovery mode · reduced strength", "error");
    if (!gameLocked && game && !game.game_over() && game.turn() !== humanColor) {
      toast(message + " Using fallback mode.");
      scheduleBotMove();
    } else toast(message);
  }
  function stopEngine() {
    clearTimeout(engineTimeout); activeRequest = null; engineBusy = false;
    if (engine) { try { engine.postMessage("stop"); } catch (_) {} }
    requestId++;
  }
  function newGame() {
    clearMateSequence(); stopSpeech(); stopEngine();
    game = new Chess(); selectedSquare = null; legalTargets = []; lastMove = null;
    gameLocked = false; resultShown = false; moves = []; mateEventId++;
    humanColor = selectedColor || "w";
    $("botColor").textContent = humanColor==="w" ? "BLACK" : "WHITE";
    $("humanColor").textContent = humanColor==="w" ? "WHITE" : "BLACK";
    $("humanSub").textContent = (humanColor==="w" ? "WHITE" : "BLACK") + " · PLAYER";
    $("resultOverlay").classList.add("hidden");
    showScreen("gameScreen"); renderBoard(); renderHistory(); updateStatus();
    if (!engineReady && !engineBusy) initEngine();
    else if (engineReady && humanColor==="b") scheduleBotMove();
  }
  function clearMateSequence() { clearTimeout(mateTimer); mateTimer = null; $("resultOverlay").classList.add("hidden"); document.body.classList.remove("thinking"); }
  function coord(file, rank) { return "abcdefgh"[file] + (8-rank); }
  function renderBoard() {
    if (!game) return;
    const board = $("board"); board.innerHTML = "";
    const isFlipped = humanColor === "b";
    const b = game.board();
    for (let row=0; row<8; row++) for (let col=0; col<8; col++) {
      const r = isFlipped ? 7-row : row, c = isFlipped ? 7-col : col;
      const squareName = coord(c,r), piece = b[r][c];
      const btn = document.createElement("button");
      btn.type = "button"; btn.className = "square " + ((r+c)%2===0 ? "light":"dark");
      btn.dataset.square = squareName; btn.setAttribute("role","gridcell");
      btn.setAttribute("aria-label", squareName + (piece ? " " + (piece.color==="w"?"white ":"black ") + piece.type : ""));
      if (piece) {
        const span = document.createElement("span"); span.className = "piece " + (piece.color==="w"?"white-piece":"black-piece");
        span.textContent = PIECES[piece.color+piece.type]; btn.appendChild(span);
        btn.classList.add(piece.color==="w" ? "white-piece" : "black-piece");
      }
      if (selectedSquare===squareName) btn.classList.add("selected-square");
      if (lastMove && (lastMove.from===squareName || lastMove.to===squareName)) btn.classList.add("last-move");
      if (legalTargets.includes(squareName)) btn.classList.add(piece ? "legal-capture" : "legal-target");
      if (piece && piece.type==="k" && piece.color===game.turn() && game.in_check()) btn.classList.add("in-check");
      if (gameLocked && game.in_checkmate() && piece && piece.type==="k" && piece.color===game.turn()) btn.classList.add("mate-king");
      if ((isFlipped ? c===7 : c===0)) {
        const label=document.createElement("span"); label.className="coord"; label.textContent=String(8-r); btn.appendChild(label);
      }
      if ((isFlipped ? r===0 : r===7)) {
        const label=document.createElement("span"); label.className="coord"; label.style.left="auto";label.style.right="3px";label.style.top="auto";label.style.bottom="3px";label.textContent="abcdefgh"[c];btn.appendChild(label);
      }
      btn.addEventListener("click", () => onSquareClick(squareName));
      board.appendChild(btn);
    }
  }
  function onSquareClick(sq) {
    unlockAudio();
    if (!game || gameLocked || engineBusy || game.game_over() || game.turn()!==humanColor) return;
    const piece = game.get(sq);
    if (selectedSquare && legalTargets.includes(sq)) { makeHumanMove(selectedSquare, sq); return; }
    if (piece && piece.color===humanColor) {
      selectedSquare = sq; legalTargets = game.moves({square:sq, verbose:true}).map(m=>m.to);
      renderBoard(); return;
    }
    selectedSquare = null; legalTargets = []; renderBoard();
  }
  function makeHumanMove(from,to) {
    const opts = {from,to,promotion:"q"};
    let move;
    try { move = game.move(opts); } catch (_) { move = null; }
    if (!move) { toast("That move is not legal."); selectedSquare=null;legalTargets=[];renderBoard();return; }
    lastMove={from:move.from,to:move.to}; selectedSquare=null;legalTargets=[];
    moves.push(move); playMoveSound(!!move.captured, game.in_check());
    renderBoard();renderHistory();updateStatus();
    if (game.game_over()) { handleGameEnd("human"); return; }
    scheduleBotMove();
  }
  function scheduleBotMove() {
    if (!game || gameLocked || engineBusy || game.game_over() || game.turn()===humanColor) return;
    engineBusy=true; document.body.classList.add("thinking");
    $("statusTag").textContent="CHRismi IS THINKING…"; $("statusTitle").textContent="Chrismi is thinking…";
    $("statusDetail").textContent="Calculating a response. Your board stays responsive.";
    $("thinkingDot").style.display="block"; setEngineStatus(engineMode==="stockfish"?"Analyzing position…":"Choosing a legal move…","busy");
    if (engineMode==="stockfish" && engine && engineReady) {
      const id=++requestId; activeRequest={id, fen:game.fen()};
      try {
        engine.postMessage("ucinewgame"); engine.postMessage("position fen "+game.fen());
        engine.postMessage("go depth 15");
        engineTimeout=setTimeout(()=>{ if(activeRequest && activeRequest.id===id) recoverEngine("Engine response timed out."); },18000);
      } catch (_) { recoverEngine("Unable to communicate with Stockfish."); }
    } else {
      const id=++requestId, fen=game.fen();
      activeRequest={id,fen};
      setTimeout(()=>{
        if(!activeRequest || activeRequest.id!==id || !game || game.fen()!==fen || gameLocked) return;
        const legal=game.moves({verbose:true});
        if(!legal.length){engineBusy=false;activeRequest=null;updateStatus();return;}
        // Fallback is intentionally disclosed; all candidate moves are still legal chess moves.
        const scored=legal.map(m=>({m,score:(m.captured?10:0)+(m.san.includes("+")?2:0)+(m.san.includes("#")?1000:0)+Math.random()})).sort((a,b)=>b.score-a.score);
        const chosen=scored[0].m;
        activeRequest=null; finishBotMove(chosen.from+chosen.to+(chosen.promotion||""),{id,fen});
      },650);
    }
  }
  function finishBotMove(uci, req) {
    if (!req || req.id!==requestId || !game || gameLocked || game.game_over() || game.turn()===humanColor || game.fen()!==req.fen) {
      engineBusy=false; document.body.classList.remove("thinking"); return;
    }
    const from=uci.slice(0,2),to=uci.slice(2,4),promotion=uci[4]||"q";
    let move=null;
    try { move=game.move({from,to,promotion}); } catch (_) {}
    if (!move) { recoverEngine("Stockfish returned an invalid move."); return; }
    engineBusy=false; document.body.classList.remove("thinking"); $("thinkingDot").style.display="none";
    lastMove={from:move.from,to:move.to}; moves.push(move);
    playMoveSound(!!move.captured,game.in_check());renderBoard();renderHistory();updateStatus();
    setEngineStatus(engineMode==="stockfish"?"Stockfish ready · Strong engine":"Fallback mode · reduced strength",engineFailed?"error":"ready");
    if (game.game_over()) { handleGameEnd("bot"); return; }
  }
  function renderHistory() {
    const root=$("moveHistory");root.innerHTML="";
    if (!moves.length) {root.innerHTML='<div class="history-empty">Your game will appear here.</div>';$("moveCount").textContent="00";return;}
    for(let i=0;i<moves.length;i+=2){
      const row=document.createElement("div");row.className="move-row";
      const num=document.createElement("span");num.className="move-number";num.textContent=String(i/2+1).padStart(2,"0")+".";
      const w=document.createElement("span");w.className="move-white";w.textContent=moves[i].san;
      const b=document.createElement("span");b.className="move-black";b.textContent=moves[i+1]?moves[i+1].san:"…";
      row.append(num,w,b);root.appendChild(row);
    }
    root.scrollTop=root.scrollHeight;$("moveCount").textContent=String(moves.length).padStart(2,"0");
  }
  function updateStatus() {
    if(!game)return;
    const turn=game.turn(), turnName=turn==="w"?"WHITE":"BLACK";
    $("turnValue").textContent=turnName;
    if(gameLocked)return;
    if(game.game_over())return;
    if(turn===humanColor){
      $("statusTag").textContent=game.in_check()?"CHECK!":"YOUR TURN";
      $("statusTitle").textContent=game.in_check()?"Your king is under attack.":"Make your move.";
      $("statusDetail").textContent=game.in_check()?"CHECK! YOUR KING IS UNDER ATTACK. Find a legal response.":"Select a piece, then choose a highlighted square.";
    }else{
      $("statusTag").textContent="CHRismi IS THINKING…";$("statusTitle").textContent="Chrismi is thinking…";$("statusDetail").textContent=game.in_check()?"Chrismi must answer the check.":"The engine is calculating its response.";
    }
    if(game.in_check() && turn!==humanColor){$("statusDetail").textContent="CHECK! Chrismi's king is under attack.";}
  }
  function handleGameEnd(lastMover) {
    gameLocked=true;engineBusy=false;document.body.classList.remove("thinking");$("thinkingDot").style.display="none";
    stopEngine();renderBoard();updateStatus();
    if(game.in_checkmate()){
      const winner=lastMover;
      if(winner==="bot" && game.turn()===humanColor){startMateSequence();return;}
      showResult("YOU WIN!","You checkmated Chrismi.","A brilliant finish. You earned this victory.","♔");
    }else if(game.in_stalemate()) showResult("DRAW — STALEMATE","Neither king can make a legal move.","The game ends in a draw by stalemate.","♟");
    else if(game.insufficient_material()) showResult("DRAW — INSUFFICIENT MATERIAL","There isn't enough material to force checkmate.","A draw according to the rules of chess.","♟");
    else if(game.in_threefold_repetition()) showResult("DRAW — REPETITION","The same position occurred three times.","A draw according to the rules of chess.","♟");
    else if(game.in_draw()) showResult("GAME DRAWN","The game ends in a draw.","Neither player wins this match.","♟");
    else showResult("GAME OVER","The game has ended.","Thanks for playing CHRismi Chess.","♚");
  }
  function startMateSequence() {
    const event=++mateEventId;
    $("statusTag").textContent="CHECKMATE";$("statusTitle").textContent="Checkmate. Chrismi wins.";
    $("statusDetail").textContent="The final position is locked. The result will appear in 60 seconds.";
    setEngineStatus("Match complete · Checkmate","ready");renderBoard();playMateSound();speakMate();
    // Leave the final position on screen for the full cinematic pause.
    mateTimer=setTimeout(()=>{if(event===mateEventId)showResult("CHRismi HAS WON!","YOU CAN'T GET A WIN FROM CHRismi.","Every move brought you here. The final move belongs to Chrismi.","♚");},60000);
  }
  function showResult(title,message,sub,emblem) {
    if(resultShown)return;resultShown=true;
    $("resultTitle").textContent=title;$("resultMessage").textContent=message;$("resultSub").textContent=sub;$("resultEmblem").textContent=emblem;
    $("resultOverlay").classList.remove("hidden");
  }
  function restartToColors() {
    clearMateSequence();stopSpeech();stopEngine();game=null;selectedSquare=null;legalTargets=[];moves=[];gameLocked=false;resultShown=false;
    selectedColor=null;document.querySelectorAll(".color-card").forEach(c=>{c.classList.remove("selected");c.setAttribute("aria-pressed","false")});
    $("enterButton").disabled=true;showScreen("colorScreen");
  }
  function leaveGame() {
    clearMateSequence();stopSpeech();stopEngine();game=null;selectedSquare=null;legalTargets=[];moves=[];gameLocked=false;resultShown=false;selectedColor=null;
    $("resultOverlay").classList.add("hidden");showScreen("welcomeScreen");
  }
  $("readyButton").addEventListener("click",()=>{unlockAudio();tone(520,.06);showScreen("colorScreen")});
  document.querySelectorAll(".color-card").forEach(card=>card.addEventListener("click",()=>{
    selectedColor=card.dataset.color;
    document.querySelectorAll(".color-card").forEach(c=>{const yes=c===card;c.classList.toggle("selected",yes);c.setAttribute("aria-pressed",String(yes))});
    $("enterButton").disabled=false;tone(480,.07);
  }));
  $("enterButton").addEventListener("click",()=>{if(!selectedColor)return;unlockAudio();newGame()});
  document.querySelectorAll("[data-back]").forEach(b=>b.addEventListener("click",()=>showScreen(b.dataset.back)));
  $("restartButton").addEventListener("click",()=>{
    if(!game)return;
    if(window.confirm("Restart this game? The current position and move history will be cleared.")){newGame();}
  });
  $("rematchButton").addEventListener("click",restartToColors);
  $("leaveButton").addEventListener("click",leaveGame);
  $("soundToggle").addEventListener("click",()=>{
    soundOn=!soundOn;$("soundLabel").textContent=soundOn?"SOUND ON":"SOUND OFF";
    $("soundToggle").setAttribute("aria-label",soundOn?"Turn sound off":"Turn sound on");
    $("soundToggle").style.color=soundOn?"var(--gold)":"var(--muted)";
    if(!soundOn)stopSpeech();else{unlockAudio();tone(520,.06);}
  });
  window.addEventListener("beforeunload",()=>{clearTimeout(mateTimer);clearTimeout(engineTimeout);stopSpeech();if(engine)engine.terminate();if(audioContext)audioContext.close().catch(()=>{});});
  // Surface missing chess.js / worker issues without leaving a blank game screen.
  window.addEventListener("error",e=>{if(String(e.message||"").includes("Chess"))toast("Chess rules library did not load. Check your internet connection and refresh.");});
  if(typeof Chess==="undefined"){
    setTimeout(()=>{if(typeof Chess==="undefined"){ $("engineStatus").textContent="Chess library unavailable · check connection";$("engineLed").className="engine-led error";$("readyButton").addEventListener("click",()=>toast("The chess rules library could not load. Please check your internet connection and refresh."));}},500);
  }
})();