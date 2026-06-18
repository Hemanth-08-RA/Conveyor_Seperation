// Factory I/O Separating Station Simulation
// Created by Antigravity Agent

(function() {
  // --- Canvas & Core Setup ---
  const canvas = document.getElementById('simCanvas');
  const ctx = canvas.getContext('2d');
  
  // Simulation speed and state
  let isPlaying = true;
  let isEStop = false;
  let simSpeed = 1.0;
  let lastTime = 0;
  let runtime = 0; // in milliseconds
  
  // Configuration parameters (from sidebar sliders)
  let spawnInterval = 2500; // ms
  let conveyorSpeed = 2.0;   // virtual speed factor
  let greenRatio = 0.5;      // 0.0 to 1.0
  let nextSpawnTime = 0;     // runtime trigger
  
  // View mode
  let currentView = 'isometric'; // 'isometric' | 'topdown' | 'separator' | 'rpc'
  let showHUD = true;
  
  // Dynamic camera Orbit / Zoom parameters
  let camTheta = 0.6;
  let camPhi = 0.5;
  let camZoom = 0.85;
  let camCenterX = 400;
  let camCenterY = 150;
  let camCenterZ = -15;
  
  // RPC View variables
  let rpcPackets = [];
  let rpcLog = [];
  let rpcPollTimer = 0;
  let rpcMotorTimer = 0;
  
  // Lists of active entities
  let items = [];
  let servoHorn = { x: 460, y: 150, angle: 0, targetAngle: 0, length: 55, speed: 0.08 };
  let boxes = {
    upper: { lane: 'upper', items: [], x: 780, y: 134, z: -20, state: 'filling', progress: 0, boxNo: 1, joltTimer: 0 },
    lower: { lane: 'lower', items: [], x: 780, y: 166, z: -20, state: 'filling', progress: 0, boxNo: 1, joltTimer: 0 }
  };
  
  // AMR (Autonomous Mobile Robot) Forklift & Warehouse Rack System
  let amr = {
    x: 880, y: 280, z: -20,
    angle: 0,
    state: 'idle', // 'idle' | 'moving_to_box' | 'extending_forks' | 'lifting' | 'retracting_forks' | 'carrying_to_rack' | 'extending_at_rack' | 'lowering' | 'retracting_at_rack' | 'returning'
    targetLane: null,
    box: null,
    forkZ: -20,
    forkExt: 0, // telescoping fork extension length
    slotIndex: -1,
    progress: 0,
    speed: 2.0
  };
  
  let rackSlots = [
    { x: 700, y: 35, z: -20, box: null, clearTimer: 0 },
    { x: 745, y: 35, z: -20, box: null, clearTimer: 0 },
    { x: 700, y: 35, z: 25, box: null, clearTimer: 0 },
    { x: 745, y: 35, z: 25, box: null, clearTimer: 0 }
  ];
  
  let amrQueue = [];
  
  // Laser sensors
  let sensors = {
    lidar: { x: 350, y: 150, z: 25, beamActive: true, detectedItem: null, cooldown: 0 },
    upperBox: { x: 750, y: 134, z: 0, beamActive: true },
    lowerBox: { x: 750, y: 166, z: 0, beamActive: true }
  };
  
  // Dust particles floating in laser beam
  let dustParticles = Array.from({ length: 15 }, () => ({
    yOffset: Math.random() * 70 - 35,
    z: Math.random() * 25,
    speed: 0.05 + Math.random() * 0.1,
    size: 0.5 + Math.random() * 1.5,
    alpha: 0.2 + Math.random() * 0.6
  }));
  
  // Statistics
  let stats = {
    green: 0,
    blue: 0,
    total: 0,
    divertSuccess: 0,
    divertAttempt: 0
  };

  // --- Web Audio API Synth Engine ---
  let audioCtx = null;
  let machineHumNode = null;
  let eStopSirenNode = null;
  
  function initAudio() {
    if (audioCtx) return;
    try {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      startMachineHum();
    } catch (e) {
      console.warn("Web Audio API not supported or blocked: ", e);
    }
  }
  
  function startMachineHum() {
    if (!audioCtx || machineHumNode) return;
    if (audioCtx.state === 'suspended') return;
    
    // Conveyor humming sound (low drone)
    const osc1 = audioCtx.createOscillator();
    const osc2 = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    
    osc1.type = 'sawtooth';
    osc1.frequency.value = 60; // 60Hz hum
    
    osc2.type = 'triangle';
    osc2.frequency.value = 121; // beats slightly with osc1
    
    // Low pass filter to make it a deep rumble
    const filter = audioCtx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 150;
    
    gain.gain.value = 0.03;
    
    osc1.connect(filter);
    osc2.connect(filter);
    filter.connect(gain);
    gain.connect(audioCtx.destination);
    
    osc1.start(0);
    osc2.start(0);
    
    machineHumNode = { osc1, osc2, gain, filter };
  }
  
  function stopMachineHum() {
    if (machineHumNode) {
      try {
        machineHumNode.osc1.stop();
        machineHumNode.osc2.stop();
      } catch (e) {}
      machineHumNode = null;
    }
  }
  
  function playSound(type) {
    if (!audioCtx) return;
    if (audioCtx.state === 'suspended') {
      audioCtx.resume();
    }
    
    const now = audioCtx.currentTime;
    
    if (type === 'scan') {
      // High-pitched laser scanner blip
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(1000, now);
      osc.frequency.exponentialRampToValueAtTime(2500, now + 0.08);
      gain.gain.setValueAtTime(0.04, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start(now);
      osc.stop(now + 0.08);
    } else if (type === 'push') {
      // Pneumatic cylinder air release: hiss-clunk
      const duration = 0.15;
      const bufferSize = audioCtx.sampleRate * duration;
      const buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
      const data = buffer.getChannelData(0);
      // White noise buffer
      for (let i = 0; i < bufferSize; i++) {
        data[i] = Math.random() * 2 - 1;
      }
      
      const noise = audioCtx.createBufferSource();
      noise.buffer = buffer;
      
      const filter = audioCtx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(800, now);
      filter.frequency.exponentialRampToValueAtTime(150, now + duration);
      
      const gain = audioCtx.createGain();
      gain.gain.setValueAtTime(0.08, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
      
      noise.connect(filter);
      filter.connect(gain);
      gain.connect(audioCtx.destination);
      noise.start(now);
      
      // Metallic thud of piston hitting limit
      const osc = audioCtx.createOscillator();
      const oscGain = audioCtx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(90, now);
      osc.frequency.linearRampToValueAtTime(10, now + 0.05);
      oscGain.gain.setValueAtTime(0.15, now);
      oscGain.gain.exponentialRampToValueAtTime(0.001, now + 0.05);
      osc.connect(oscGain);
      oscGain.connect(audioCtx.destination);
      osc.start(now);
      osc.stop(now + 0.05);
    } else if (type === 'drop') {
      // Deep item cardboard dropping thud
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(120, now);
      osc.frequency.exponentialRampToValueAtTime(30, now + 0.12);
      gain.gain.setValueAtTime(0.25, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start(now);
      osc.stop(now + 0.12);
    } else if (type === 'ship') {
      // Hydraulic slide whistle (heavy load moving)
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(150, now);
      osc.frequency.linearRampToValueAtTime(320, now + 0.5);
      gain.gain.setValueAtTime(0.08, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.5);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start(now);
      osc.stop(now + 0.5);
    }
  }

  function startEStopSiren() {
    if (!audioCtx || eStopSirenNode) return;
    const now = audioCtx.currentTime;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    
    osc.type = 'sine';
    osc.frequency.setValueAtTime(440, now);
    
    // Warble effect
    const lfo = audioCtx.createOscillator();
    const lfoGain = audioCtx.createGain();
    lfo.frequency.value = 2; // 2Hz siren oscillation
    lfoGain.gain.value = 150; // swing frequency +/- 150Hz
    
    lfo.connect(lfoGain);
    lfoGain.connect(osc.frequency);
    
    gain.gain.value = 0.05;
    
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    
    lfo.start(now);
    osc.start(now);
    
    eStopSirenNode = { osc, lfo, gain };
  }

  function stopEStopSiren() {
    if (eStopSirenNode) {
      try {
        eStopSirenNode.osc.stop();
        eStopSirenNode.lfo.stop();
      } catch (e) {}
      eStopSirenNode = null;
    }
  }

  // --- HMI Diagnostic Log Console ---
  const logTerminal = document.getElementById('log-terminal');
  
  function addLog(message, type = 'info') {
    const timeStr = formatClockTime(runtime);
    const entry = document.createElement('div');
    entry.className = `log-entry ${type}`;
    entry.innerHTML = `<span class="timestamp">[${timeStr}]</span> ${message}`;
    logTerminal.appendChild(entry);
    
    // Prune logs if too long
    while (logTerminal.children.length > 60) {
      logTerminal.removeChild(logTerminal.firstChild);
    }
    
    // Auto-scroll
    logTerminal.scrollTop = logTerminal.scrollHeight;
  }
  
  function triggerRPCPacket(from, to, method, args, returnVal = null) {
    const timeStr = formatClockTime(runtime);
    const logText = `[${timeStr}] ${from} -> ${to}: ${returnVal ? 'RETURN ' + returnVal : 'CALL "' + method + '" (' + args + ')'}`;
    rpcLog.push(logText);
    if (rpcLog.length > 5) rpcLog.shift();
    
    rpcPackets.push({
      from,
      to,
      method,
      args,
      returnVal,
      progress: 0,
      speed: 0.03
    });
  }
  
  document.getElementById('clear-log').addEventListener('click', () => {
    logTerminal.innerHTML = '';
    addLog("Event log cleared.", "system");
  });

  // --- Coordinate & Projection Utilities ---
  // Transforms virtual coordinates (x: 0..850, y: 0..300, z: -40..100) to Canvas screen coordinates
  function toScreen(x, y, z = 0, viewMode = currentView) {
    if (viewMode === 'rpc') {
      return { x, y };
    }
    
    // Shift relative to camera focus center
    const dx = x - camCenterX;
    const dy = y - camCenterY;
    const dz = z - camCenterZ;
    
    // 1. Rotate around Z-axis (horizontal angle camTheta)
    const cosT = Math.cos(camTheta);
    const sinT = Math.sin(camTheta);
    const rx = dx * cosT - dy * sinT;
    const ry = dx * sinT + dy * cosT;
    
    // 2. Rotate around X-axis (vertical angle camPhi)
    const cosP = Math.cos(camPhi);
    const sinP = Math.sin(camPhi);
    const rz = dz * cosP - ry * sinP;
    
    // 3. Project to canvas screen space (center at 480, 240)
    const screenX = 480 + rx * camZoom;
    const screenY = 240 - rz * camZoom;
    
    return { x: screenX, y: screenY };
  }

  // Helper to draw isometric bounding box
  function drawIsoBox(ctx, x, y, z, sizeX, sizeY, sizeZ, style = {}) {
    const ptBase = [
      toScreen(x, y, z),
      toScreen(x + sizeX, y, z),
      toScreen(x + sizeX, y + sizeY, z),
      toScreen(x, y + sizeY, z)
    ];
    
    const ptTop = [
      toScreen(x, y, z + sizeZ),
      toScreen(x + sizeX, y, z + sizeZ),
      toScreen(x + sizeX, y + sizeY, z + sizeZ),
      toScreen(x, y + sizeY, z + sizeZ)
    ];
    
    // Draw Bottom Face
    ctx.fillStyle = style.fillBottom || style.fill || 'rgba(50, 50, 50, 0.5)';
    ctx.beginPath();
    ctx.moveTo(ptBase[0].x, ptBase[0].y);
    ctx.lineTo(ptBase[1].x, ptBase[1].y);
    ctx.lineTo(ptBase[2].x, ptBase[2].y);
    ctx.lineTo(ptBase[3].x, ptBase[3].y);
    ctx.closePath();
    ctx.fill();
    
    // Draw Side (Left-Front) Face
    ctx.fillStyle = style.fillFrontLeft || style.fill || 'rgba(100, 100, 100, 0.5)';
    ctx.beginPath();
    ctx.moveTo(ptBase[0].x, ptBase[0].y);
    ctx.lineTo(ptBase[3].x, ptBase[3].y);
    ctx.lineTo(ptTop[3].x, ptTop[3].y);
    ctx.lineTo(ptTop[0].x, ptTop[0].y);
    ctx.closePath();
    ctx.fill();
    if (style.stroke) { ctx.strokeStyle = style.stroke; ctx.lineWidth = style.lineWidth || 1; ctx.stroke(); }
    
    // Draw Side (Right-Front) Face
    ctx.fillStyle = style.fillFrontRight || style.fill || 'rgba(120, 120, 120, 0.5)';
    ctx.beginPath();
    ctx.moveTo(ptBase[3].x, ptBase[3].y);
    ctx.lineTo(ptBase[2].x, ptBase[2].y);
    ctx.lineTo(ptTop[2].x, ptTop[2].y);
    ctx.lineTo(ptTop[3].x, ptTop[3].y);
    ctx.closePath();
    ctx.fill();
    if (style.stroke) { ctx.stroke(); }
    
    // Draw Top Face
    ctx.fillStyle = style.fillTop || style.fill || 'rgba(150, 150, 150, 0.5)';
    ctx.beginPath();
    ctx.moveTo(ptTop[0].x, ptTop[0].y);
    ctx.lineTo(ptTop[1].x, ptTop[1].y);
    ctx.lineTo(ptTop[2].x, ptTop[2].y);
    ctx.lineTo(ptTop[3].x, ptTop[3].y);
    ctx.closePath();
    ctx.fill();
    if (style.stroke) { ctx.stroke(); }
  }

  // Draw decals on exterior faces of the cardboard boxes (UP arrows, Fragile wine glass, shipping label)
  function drawFaceDecals(ctx, faceName, fx, fy, fz, sizeX, sizeY, currentSizeZ, isExterior, viewMode) {
    if (!isExterior || viewMode !== 'isometric') return;
    
    ctx.save();
    
    if (faceName === 'front' || faceName === 'back') {
      // Y-face: constant Y = fy. Decals drawn along X and Z
      const yOffset = (faceName === 'front') ? 0.3 : -0.3;
      const dy = fy + yOffset;
      
      // 1. Shipping Label (white paper background)
      const labelX1 = fx + 6;
      const labelX2 = fx + 20;
      const labelZ1 = fz + 6;
      const labelZ2 = fz + 18;
      
      const p0 = toScreen(labelX1, dy, labelZ1, viewMode);
      const p1 = toScreen(labelX2, dy, labelZ1, viewMode);
      const p2 = toScreen(labelX2, dy, labelZ2, viewMode);
      const p3 = toScreen(labelX1, dy, labelZ2, viewMode);
      
      ctx.fillStyle = '#f8fafc';
      ctx.beginPath();
      ctx.moveTo(p0.x, p0.y); ctx.lineTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); ctx.lineTo(p3.x, p3.y);
      ctx.closePath();
      ctx.fill();
      
      // Barcode lines
      ctx.strokeStyle = '#1e293b';
      ctx.lineWidth = 1;
      for (let lz = labelZ1 + 3; lz < labelZ2 - 2; lz += 3) {
        const lineStart = toScreen(labelX1 + 3, dy, lz, viewMode);
        const lineEnd = toScreen(labelX2 - 3, dy, lz, viewMode);
        ctx.beginPath();
        ctx.moveTo(lineStart.x, lineStart.y);
        ctx.lineTo(lineEnd.x, lineEnd.y);
        ctx.stroke();
      }
      
      // 2. Handling Decal: UP Arrows (↑ ↑)
      const arrowX = fx + 25;
      const arrowZ = fz + 12;
      ctx.strokeStyle = '#7f1d1d'; // dark red stencil
      ctx.lineWidth = 1.2;
      
      // Left arrow
      const a1_bottom = toScreen(arrowX, dy, arrowZ - 4, viewMode);
      const a1_top = toScreen(arrowX, dy, arrowZ + 4, viewMode);
      ctx.beginPath(); ctx.moveTo(a1_bottom.x, a1_bottom.y); ctx.lineTo(a1_top.x, a1_top.y); ctx.stroke();
      const aHeadL1 = toScreen(arrowX - 2, dy, arrowZ + 1, viewMode);
      const aHeadR1 = toScreen(arrowX + 2, dy, arrowZ + 1, viewMode);
      ctx.beginPath(); ctx.moveTo(aHeadL1.x, aHeadL1.y); ctx.lineTo(a1_top.x, a1_top.y); ctx.lineTo(aHeadR1.x, aHeadR1.y); ctx.stroke();
      
      // Right arrow
      const a2_bottom = toScreen(arrowX + 5, dy, arrowZ - 4, viewMode);
      const a2_top = toScreen(arrowX + 5, dy, arrowZ + 4, viewMode);
      ctx.beginPath(); ctx.moveTo(a2_bottom.x, a2_bottom.y); ctx.lineTo(a2_top.x, a2_top.y); ctx.stroke();
      const aHeadL2 = toScreen(arrowX + 3, dy, arrowZ + 1, viewMode);
      const aHeadR2 = toScreen(arrowX + 7, dy, arrowZ + 1, viewMode);
      ctx.beginPath(); ctx.moveTo(aHeadL2.x, aHeadL2.y); ctx.lineTo(a2_top.x, a2_top.y); ctx.lineTo(aHeadR2.x, aHeadR2.y); ctx.stroke();
      
      // Bottom line
      const barStart = toScreen(arrowX - 2, dy, arrowZ - 5, viewMode);
      const barEnd = toScreen(arrowX + 7, dy, arrowZ - 5, viewMode);
      ctx.beginPath();
      ctx.moveTo(barStart.x, barStart.y);
      ctx.lineTo(barEnd.x, barEnd.y);
      ctx.stroke();
      
      // 3. Handling Decal: Fragile Glass Cup (goblet with a crack)
      const cupX = fx + 34;
      const cupZ = fz + 12;
      ctx.strokeStyle = '#7f1d1d';
      ctx.lineWidth = 1.0;
      
      const cupTopL = toScreen(cupX - 2, dy, cupZ + 4, viewMode);
      const cupTopR = toScreen(cupX + 2, dy, cupZ + 4, viewMode);
      const cupBotL = toScreen(cupX - 2, dy, cupZ, viewMode);
      const cupBotR = toScreen(cupX + 2, dy, cupZ, viewMode);
      const stemTop = toScreen(cupX, dy, cupZ, viewMode);
      const stemBot = toScreen(cupX, dy, cupZ - 4, viewMode);
      const baseL = toScreen(cupX - 2, dy, cupZ - 4, viewMode);
      const baseR = toScreen(cupX + 2, dy, cupZ - 4, viewMode);
      
      ctx.beginPath(); ctx.moveTo(cupTopL.x, cupTopL.y); ctx.lineTo(cupBotL.x, cupBotL.y); ctx.lineTo(cupBotR.x, cupBotR.y); ctx.lineTo(cupTopR.x, cupTopR.y); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(stemTop.x, stemTop.y); ctx.lineTo(stemBot.x, stemBot.y); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(baseL.x, baseL.y); ctx.lineTo(baseR.x, baseR.y); ctx.stroke();
      
      const crackStart = toScreen(cupX - 1, dy, cupZ + 3, viewMode);
      const crackMid = toScreen(cupX + 1, dy, cupZ + 1, viewMode);
      const crackEnd = toScreen(cupX, dy, cupZ - 1, viewMode);
      ctx.beginPath(); ctx.moveTo(crackStart.x, crackStart.y); ctx.lineTo(crackMid.x, crackMid.y); ctx.lineTo(crackEnd.x, crackEnd.y); ctx.stroke();
      
    } else if (faceName === 'left' || faceName === 'right') {
      // X-face: constant X = fx. Decals drawn along Y and Z
      const xOffset = (faceName === 'right') ? 0.3 : -0.3;
      const dx = fx + xOffset;
      
      // 1. Shipping Label (white paper)
      const labelY1 = fy + 6;
      const labelY2 = fy + 20;
      const labelZ1 = fz + 6;
      const labelZ2 = fz + 18;
      
      const p0 = toScreen(dx, labelY1, labelZ1, viewMode);
      const p1 = toScreen(dx, labelY2, labelZ1, viewMode);
      const p2 = toScreen(dx, labelY2, labelZ2, viewMode);
      const p3 = toScreen(dx, labelY1, labelZ2, viewMode);
      
      ctx.fillStyle = '#f8fafc';
      ctx.beginPath();
      ctx.moveTo(p0.x, p0.y); ctx.lineTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); ctx.lineTo(p3.x, p3.y);
      ctx.closePath();
      ctx.fill();
      
      // Barcode lines
      ctx.strokeStyle = '#1e293b';
      ctx.lineWidth = 1;
      for (let lz = labelZ1 + 3; lz < labelZ2 - 2; lz += 3) {
        const lineStart = toScreen(dx, labelY1 + 3, lz, viewMode);
        const lineEnd = toScreen(dx, labelY2 - 3, lz, viewMode);
        ctx.beginPath();
        ctx.moveTo(lineStart.x, lineStart.y);
        ctx.lineTo(lineEnd.x, lineEnd.y);
        ctx.stroke();
      }
      
      // 2. Handling Decal: UP Arrows
      const arrowY = fy + 25;
      const arrowZ = fz + 12;
      ctx.strokeStyle = '#7f1d1d';
      ctx.lineWidth = 1.2;
      
      const a1_bottom = toScreen(dx, arrowY, arrowZ - 4, viewMode);
      const a1_top = toScreen(dx, arrowY, arrowZ + 4, viewMode);
      ctx.beginPath(); ctx.moveTo(a1_bottom.x, a1_bottom.y); ctx.lineTo(a1_top.x, a1_top.y); ctx.stroke();
      const aHeadL1 = toScreen(dx, arrowY - 2, arrowZ + 1, viewMode);
      const aHeadR1 = toScreen(dx, arrowY + 2, arrowZ + 1, viewMode);
      ctx.beginPath(); ctx.moveTo(aHeadL1.x, aHeadL1.y); ctx.lineTo(a1_top.x, a1_top.y); ctx.lineTo(aHeadR1.x, aHeadR1.y); ctx.stroke();
      
      const a2_bottom = toScreen(dx, arrowY + 5, arrowZ - 4, viewMode);
      const a2_top = toScreen(dx, arrowY + 5, arrowZ + 4, viewMode);
      ctx.beginPath(); ctx.moveTo(a2_bottom.x, a2_bottom.y); ctx.lineTo(a2_top.x, a2_top.y); ctx.stroke();
      const aHeadL2 = toScreen(dx, arrowY + 3, arrowZ + 1, viewMode);
      const aHeadR2 = toScreen(dx, arrowY + 7, arrowZ + 1, viewMode);
      ctx.beginPath(); ctx.moveTo(aHeadL2.x, aHeadL2.y); ctx.lineTo(a2_top.x, a2_top.y); ctx.lineTo(aHeadR2.x, aHeadR2.y); ctx.stroke();
      
      const barStart = toScreen(dx, arrowY - 2, arrowZ - 5, viewMode);
      const barEnd = toScreen(dx, arrowY + 7, arrowZ - 5, viewMode);
      ctx.beginPath(); ctx.moveTo(barStart.x, barStart.y); ctx.lineTo(barEnd.x, barEnd.y); ctx.stroke();
      
      // 3. Handling Decal: Fragile Glass Cup
      const cupY = fy + 34;
      const cupZ = fz + 12;
      ctx.strokeStyle = '#7f1d1d';
      ctx.lineWidth = 1.0;
      
      const cupTopL = toScreen(dx, cupY - 2, cupZ + 4, viewMode);
      const cupTopR = toScreen(dx, cupY + 2, cupZ + 4, viewMode);
      const cupBotL = toScreen(dx, cupY - 2, cupZ, viewMode);
      const cupBotR = toScreen(dx, cupY + 2, cupZ, viewMode);
      const stemTop = toScreen(dx, cupY, cupZ, viewMode);
      const stemBot = toScreen(dx, cupY, cupZ - 4, viewMode);
      const baseL = toScreen(dx, cupY - 2, cupZ - 4, viewMode);
      const baseR = toScreen(dx, cupY + 2, cupZ - 4, viewMode);
      
      ctx.beginPath(); ctx.moveTo(cupTopL.x, cupTopL.y); ctx.lineTo(cupBotL.x, cupBotL.y); ctx.lineTo(cupBotR.x, cupBotR.y); ctx.lineTo(cupTopR.x, cupTopR.y); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(stemTop.x, stemTop.y); ctx.lineTo(stemBot.x, stemBot.y); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(baseL.x, baseL.y); ctx.lineTo(baseR.x, baseR.y); ctx.stroke();
      
      const crackStart = toScreen(dx, cupY - 1, cupZ + 3, viewMode);
      const crackMid = toScreen(dx, cupY + 1, cupZ + 1, viewMode);
      const crackEnd = toScreen(dx, cupY, cupZ - 1, viewMode);
      ctx.beginPath(); ctx.moveTo(crackStart.x, crackStart.y); ctx.lineTo(crackMid.x, crackMid.y); ctx.lineTo(crackEnd.x, crackEnd.y); ctx.stroke();
    }
    
    ctx.restore();
  }

  // Draw a realistic hollow open cardboard box with bottom shadows, cavity walls, decals, and interior items
  function drawHollowBox(ctx, x, y, z, sizeX, sizeY, sizeZ, itemsList, boxNo, viewMode, joltTimer = 0) {
    // 1. Compute dynamic height scaling from landing jolt
    let boxScaleZ = 1.0;
    if (joltTimer > 0) {
      boxScaleZ = 1.0 - Math.sin(joltTimer * 1.2) * 0.12 * (joltTimer / 10);
    }
    const currentSizeZ = sizeZ * boxScaleZ;
    
    // 2. Draw semi-transparent bottom floor shadow in 3D views
    if (viewMode === 'isometric') {
      const shadowPts = [
        toScreen(x - 3, y - 3, z, viewMode),
        toScreen(x + sizeX + 3, y - 3, z, viewMode),
        toScreen(x + sizeX + 3, y + sizeY + 3, z, viewMode),
        toScreen(x - 3, y + sizeY + 3, z, viewMode)
      ];
      ctx.save();
      ctx.fillStyle = 'rgba(15, 23, 42, 0.22)';
      ctx.beginPath();
      ctx.moveTo(shadowPts[0].x, shadowPts[0].y);
      ctx.lineTo(shadowPts[1].x, shadowPts[1].y);
      ctx.lineTo(shadowPts[2].x, shadowPts[2].y);
      ctx.lineTo(shadowPts[3].x, shadowPts[3].y);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
    
    // 3. Compute camera direction components for back-to-front depth sorting
    let cosT = Math.cos(camTheta);
    let sinT = Math.sin(camTheta);
    let cosP = Math.cos(camPhi);
    let sinP = Math.sin(camPhi);
    
    if (viewMode === 'topdown' || viewMode === 'separator') {
      cosT = 1; sinT = 0;
      cosP = 0; sinP = 1;
    }
    
    // Direction vector towards camera
    const nx = sinT * cosP;
    const ny = cosT * cosP;
    const nz = sinP;
    
    // 4. Define the 5 box faces
    const faces = [
      {
        name: 'left',
        center: { x: x, y: y + sizeY / 2, z: z + currentSizeZ / 2 },
        vertices: [
          { x: x, y: y, z: z },
          { x: x, y: y + sizeY, z: z },
          { x: x, y: y + sizeY, z: z + currentSizeZ },
          { x: x, y: y, z: z + currentSizeZ }
        ],
        isExterior: nx < 0,
        fill: nx < 0 ? '#b45309' : '#7c2d12',
        stroke: '#78350f',
        flap: {
          vertices: [
            { x: x, y: y, z: z + currentSizeZ },
            { x: x, y: y + sizeY, z: z + currentSizeZ },
            { x: x - 12, y: y + sizeY, z: z + currentSizeZ + 8 },
            { x: x - 12, y: y, z: z + currentSizeZ + 8 }
          ],
          fill: '#b45309'
        }
      },
      {
        name: 'right',
        center: { x: x + sizeX, y: y + sizeY / 2, z: z + currentSizeZ / 2 },
        vertices: [
          { x: x + sizeX, y: y, z: z },
          { x: x + sizeX, y: y + sizeY, z: z },
          { x: x + sizeX, y: y + sizeY, z: z + currentSizeZ },
          { x: x + sizeX, y: y, z: z + currentSizeZ }
        ],
        isExterior: nx > 0,
        fill: nx > 0 ? '#b45309' : '#7c2d12',
        stroke: '#78350f',
        flap: {
          vertices: [
            { x: x + sizeX, y: y, z: z + currentSizeZ },
            { x: x + sizeX, y: y + sizeY, z: z + currentSizeZ },
            { x: x + sizeX + 12, y: y + sizeY, z: z + currentSizeZ + 8 },
            { x: x + sizeX + 12, y: y, z: z + currentSizeZ + 8 }
          ],
          fill: '#d97706'
        }
      },
      {
        name: 'back',
        center: { x: x + sizeX / 2, y: y, z: z + currentSizeZ / 2 },
        vertices: [
          { x: x, y: y, z: z },
          { x: x + sizeX, y: y, z: z },
          { x: x + sizeX, y: y, z: z + currentSizeZ },
          { x: x, y: y, z: z + currentSizeZ }
        ],
        isExterior: ny < 0,
        fill: ny < 0 ? '#d97706' : '#7c2d12',
        stroke: '#78350f',
        flap: {
          vertices: [
            { x: x, y: y, z: z + currentSizeZ },
            { x: x + sizeX, y: y, z: z + currentSizeZ },
            { x: x + sizeX, y: y - 12, z: z + currentSizeZ + 8 },
            { x: x, y: y - 12, z: z + currentSizeZ + 8 }
          ],
          fill: '#b45309'
        }
      },
      {
        name: 'front',
        center: { x: x + sizeX / 2, y: y + sizeY, z: z + currentSizeZ / 2 },
        vertices: [
          { x: x, y: y + sizeY, z: z },
          { x: x + sizeX, y: y + sizeY, z: z },
          { x: x + sizeX, y: y + sizeY, z: z + currentSizeZ },
          { x: x, y: y + sizeY, z: z + currentSizeZ }
        ],
        isExterior: ny > 0,
        fill: ny > 0 ? '#92400e' : '#5c2200',
        stroke: '#78350f',
        flap: {
          vertices: [
            { x: x, y: y + sizeY, z: z + currentSizeZ },
            { x: x + sizeX, y: y + sizeY, z: z + currentSizeZ },
            { x: x + sizeX, y: y + sizeY + 12, z: z + currentSizeZ + 8 },
            { x: x, y: y + sizeY + 12, z: z + currentSizeZ + 8 }
          ],
          fill: '#92400e'
        }
      },
      {
        name: 'bottom',
        center: { x: x + sizeX / 2, y: y + sizeY / 2, z: z },
        vertices: [
          { x: x, y: y, z: z },
          { x: x + sizeX, y: y, z: z },
          { x: x + sizeX, y: y + sizeY, z: z },
          { x: x, y: y + sizeY, z: z }
        ],
        isExterior: nz < 0,
        fill: '#431407', // dark interior shadow
        stroke: '#361005',
        flap: null
      }
    ];
    
    // 5. Gather elements (faces + interior items) to sort
    const elements = [];
    
    faces.forEach(face => {
      const depth = face.center.x * nx + face.center.y * ny + face.center.z * nz;
      elements.push({
        type: 'face',
        depth: depth,
        data: face
      });
    });
    
    itemsList.forEach((item, index) => {
      const row = Math.floor(index / 2);
      const col = index % 2;
      const itemOffsetX = 10 + col * 20;
      const itemOffsetY = 10 + row * 20;
      const itemZ = z + 2;
      
      const itemCX = x + itemOffsetX;
      const itemCY = y + itemOffsetY;
      const itemCZ = itemZ;
      
      const depth = itemCX * nx + itemCY * ny + itemCZ * nz;
      elements.push({
        type: 'item',
        depth: depth,
        data: {
          x: itemCX,
          y: itemCY,
          z: itemCZ,
          type: item.type
        }
      });
    });
    
    // Sort elements from back to front (ascending depth value)
    elements.sort((a, b) => a.depth - b.depth);
    
    // 6. Draw each element
    elements.forEach(el => {
      if (el.type === 'face') {
        const face = el.data;
        
        // Draw open cardboard flap
        if (face.flap && viewMode === 'isometric') {
          ctx.save();
          ctx.fillStyle = face.flap.fill;
          ctx.strokeStyle = face.stroke;
          ctx.lineWidth = 1;
          
          const fp0 = toScreen(face.flap.vertices[0].x, face.flap.vertices[0].y, face.flap.vertices[0].z, viewMode);
          const fp1 = toScreen(face.flap.vertices[1].x, face.flap.vertices[1].y, face.flap.vertices[1].z, viewMode);
          const fp2 = toScreen(face.flap.vertices[2].x, face.flap.vertices[2].y, face.flap.vertices[2].z, viewMode);
          const fp3 = toScreen(face.flap.vertices[3].x, face.flap.vertices[3].y, face.flap.vertices[3].z, viewMode);
          
          ctx.beginPath();
          ctx.moveTo(fp0.x, fp0.y);
          ctx.lineTo(fp1.x, fp1.y);
          ctx.lineTo(fp2.x, fp2.y);
          ctx.lineTo(fp3.x, fp3.y);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
          ctx.restore();
        }
        
        // Draw face polygon
        const pt = face.vertices.map(v => toScreen(v.x, v.y, v.z, viewMode));
        ctx.save();
        ctx.fillStyle = face.fill;
        ctx.strokeStyle = face.stroke;
        ctx.lineWidth = 1.5;
        
        ctx.beginPath();
        ctx.moveTo(pt[0].x, pt[0].y);
        ctx.lineTo(pt[1].x, pt[1].y);
        ctx.lineTo(pt[2].x, pt[2].y);
        ctx.lineTo(pt[3].x, pt[3].y);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.restore();
        
        // Draw stencil markings on exterior walls
        drawFaceDecals(ctx, face.name, x, y, z, sizeX, sizeY, currentSizeZ, face.isExterior, viewMode);
        
      } else if (el.type === 'item') {
        const item = el.data;
        // Draw the 3D miniature item inside the cavity (scaled 0.8x)
        drawItem3D(ctx, item.x, item.y, item.z, item.type, 0.8, viewMode, 1.0, null);
      }
    });
    
    // 7. Draw box number badge on top of the front edge
    if (boxNo !== null) {
      const labelSc = toScreen(x + sizeX * 0.5, y + sizeY * 0.8, z + currentSizeZ, viewMode);
      ctx.save();
      ctx.fillStyle = 'rgba(15, 23, 42, 0.7)';
      ctx.fillRect(labelSc.x - 14, labelSc.y - 4, 28, 8);
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 5px var(--font-display)';
      ctx.textAlign = 'center';
      ctx.fillText(`BOX #${boxNo}`, labelSc.x, labelSc.y + 2);
      ctx.restore();
    }
  }

  // Draw an inclined gravity roller chute at the end of branch conveyor belts
  function drawInclinedChute(ctx, y1, yCenter, y2, viewMode) {
    // Start x=710, z=10. End x=782, z=-6. Width spans y1 to y2.
    
    // Side Rails (Slate Steel channels)
    const leftRail = {
      tS: toScreen(710, y1, 10, viewMode),
      tE: toScreen(782, y1, -6, viewMode),
      bS: toScreen(710, y1, 6, viewMode),
      bE: toScreen(782, y1, -10, viewMode)
    };
    
    const rightRail = {
      tS: toScreen(710, y2, 10, viewMode),
      tE: toScreen(782, y2, -6, viewMode),
      bS: toScreen(710, y2, 6, viewMode),
      bE: toScreen(782, y2, -10, viewMode)
    };
    
    ctx.save();
    ctx.fillStyle = '#64748b'; // Slate steel
    ctx.strokeStyle = '#334155';
    ctx.lineWidth = 1;
    
    // Left channel plate
    ctx.beginPath();
    ctx.moveTo(leftRail.tS.x, leftRail.tS.y);
    ctx.lineTo(leftRail.tE.x, leftRail.tE.y);
    ctx.lineTo(leftRail.bE.x, leftRail.bE.y);
    ctx.lineTo(leftRail.bS.x, leftRail.bS.y);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    
    // Right channel plate
    ctx.beginPath();
    ctx.moveTo(rightRail.tS.x, rightRail.tS.y);
    ctx.lineTo(rightRail.tE.x, rightRail.tE.y);
    ctx.lineTo(rightRail.bE.x, rightRail.bE.y);
    ctx.lineTo(rightRail.bS.x, rightRail.bS.y);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    
    // Spun Cylindrical Rollers (placed closer for passive gravity slide action)
    const rollerSpacing = 12;
    for (let rx = 716; rx <= 776; rx += rollerSpacing) {
      const rz = 10 - (rx - 710) * (16 / 72);
      
      const rStart = toScreen(rx, y1 + 1, rz, viewMode);
      const rEnd = toScreen(rx, y2 - 1, rz, viewMode);
      
      // Draw base roller cylinder
      ctx.strokeStyle = '#94a3b8';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(rStart.x, rStart.y);
      ctx.lineTo(rEnd.x, rEnd.y);
      ctx.stroke();
      
      // Rollers rotation highlight stripe (continuously active to convey gravity kinetic slide)
      const rotationAngle = (runtime * 0.03 * conveyorSpeed + rx) % (Math.PI * 2);
      const offset = Math.sin(rotationAngle) * 1.0;
      
      const stripeStart = toScreen(rx + offset, y1 + 1, rz + 0.5, viewMode);
      const stripeEnd = toScreen(rx + offset, y2 - 1, rz + 0.5, viewMode);
      
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.moveTo(stripeStart.x, stripeStart.y);
      ctx.lineTo(stripeEnd.x, stripeEnd.y);
      ctx.stroke();
    }
    
    ctx.restore();
  }

  // Unified 3D item rendering helper
  function drawItem3D(ctx, x, y, z, type, sizeScale = 1.0, viewMode = currentView, opacity = 1.0, itemID = null) {
    const sc = toScreen(x, y, z, viewMode);
    ctx.save();
    ctx.globalAlpha = opacity;
    
    // Industrial soft drop shadow
    if (viewMode === 'isometric') {
      ctx.shadowColor = 'rgba(0, 0, 0, 0.3)';
      ctx.shadowBlur = 3;
      ctx.shadowOffsetY = 2;
    }
    
    if (type === 'green') {
      const radius = ((viewMode === 'separator') ? 16 : 8.0) * sizeScale;
      const height = ((viewMode === 'separator') ? 12 : 6.0) * sizeScale;
      
      // Bottom Ellipse - Metallic grey base collar
      ctx.fillStyle = '#64748b';
      ctx.beginPath();
      ctx.ellipse(sc.x, sc.y, radius, radius * 0.5, 0, 0, Math.PI * 2);
      ctx.fill();
      
      // Side Wall
      const wallGrad = ctx.createLinearGradient(sc.x - radius, sc.y, sc.x + radius, sc.y);
      wallGrad.addColorStop(0, '#064e3b');
      wallGrad.addColorStop(0.3, '#10b981');
      wallGrad.addColorStop(0.7, '#10b981');
      wallGrad.addColorStop(1, '#022c22');
      ctx.fillStyle = wallGrad;
      ctx.beginPath();
      ctx.moveTo(sc.x - radius, sc.y);
      ctx.lineTo(sc.x - radius, sc.y - height);
      ctx.ellipse(sc.x, sc.y - height, radius, radius * 0.5, 0, Math.PI, 0, false);
      ctx.lineTo(sc.x + radius, sc.y);
      ctx.ellipse(sc.x, sc.y, radius, radius * 0.5, 0, 0, Math.PI, true);
      ctx.closePath();
      ctx.fill();
      
      // Top Face
      const topGrad = ctx.createRadialGradient(sc.x - radius*0.2, sc.y - height - radius*0.1, 1, sc.x, sc.y - height, radius);
      topGrad.addColorStop(0, '#a7f3d0');
      topGrad.addColorStop(0.5, '#10b981');
      topGrad.addColorStop(1, '#047857');
      ctx.fillStyle = topGrad;
      ctx.beginPath();
      ctx.ellipse(sc.x, sc.y - height, radius, radius * 0.5, 0, 0, Math.PI * 2);
      ctx.fill();
      
      // Bevel rim highlight
      ctx.strokeStyle = 'rgba(255,255,255,0.4)';
      ctx.lineWidth = 0.8 * sizeScale;
      ctx.beginPath();
      ctx.ellipse(sc.x, sc.y - height, radius * 0.85, radius * 0.425, 0, 0, Math.PI * 2);
      ctx.stroke();
      
      // Center core notch
      ctx.fillStyle = '#064e3b';
      ctx.beginPath();
      ctx.ellipse(sc.x, sc.y - height, radius * 0.3, radius * 0.15, 0, 0, Math.PI * 2);
      ctx.fill();
    } else {
      const radius = ((viewMode === 'separator') ? 14 : 7.0) * sizeScale;
      const height = ((viewMode === 'separator') ? 14 : 7.0) * sizeScale;
      
      // Base rim (Silver metallic steel ring)
      const rimGrad = ctx.createLinearGradient(sc.x - radius, sc.y, sc.x + radius, sc.y);
      rimGrad.addColorStop(0, '#475569');
      rimGrad.addColorStop(0.5, '#cbd5e1');
      rimGrad.addColorStop(1, '#334155');
      ctx.fillStyle = rimGrad;
      ctx.beginPath();
      ctx.ellipse(sc.x, sc.y, radius, radius * 0.5, 0, 0, Math.PI * 2);
      ctx.fill();
      
      // Body Dome
      const domeGrad = ctx.createRadialGradient(sc.x - radius*0.3, sc.y - height*0.5, 1, sc.x, sc.y - height*0.2, radius);
      domeGrad.addColorStop(0, '#60a5fa');
      domeGrad.addColorStop(0.4, '#2563eb');
      domeGrad.addColorStop(1, '#1e3a8a');
      ctx.fillStyle = domeGrad;
      ctx.beginPath();
      ctx.arc(sc.x, sc.y - height * 0.1, radius, Math.PI, 0, false);
      ctx.ellipse(sc.x, sc.y, radius, radius * 0.5, 0, 0, Math.PI, false);
      ctx.closePath();
      ctx.fill();
      
      // Specular highlight
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.beginPath();
      ctx.ellipse(sc.x - radius * 0.25, sc.y - height * 0.5, radius * 0.18, radius * 0.09, Math.PI/6, 0, Math.PI * 2);
      ctx.fill();
    }
    
    // HUD Overlays if active
    if (showHUD && itemID !== null) {
      ctx.shadowColor = 'transparent';
      ctx.strokeStyle = type === 'green' ? 'rgba(16, 185, 129, 0.7)' : 'rgba(6, 182, 212, 0.7)';
      ctx.lineWidth = 1;
      const boxSize = ((viewMode === 'separator') ? 36 : 18) * sizeScale;
      ctx.strokeRect(sc.x - boxSize, sc.y - boxSize * 1.6, boxSize * 2, boxSize * 1.8);
      
      ctx.fillStyle = '#fff';
      ctx.font = '6px var(--font-mono)';
      ctx.textAlign = 'center';
      ctx.fillText(`ID:${itemID}`, sc.x, sc.y - boxSize * 1.6 - 2);
    }
    
    ctx.restore();
  }

  // --- Entity Management ---
  
  class Item {
    constructor(type, manual = false) {
      this.id = Math.floor(Math.random() * 10000);
      this.type = type; // 'green' | 'blue'
      this.radius = (type === 'green') ? 8 : 7;
      this.height = (type === 'green') ? 6 : 7;
      this.manual = manual;
      
      // Spawning variables
      this.x = 20;
      this.y = 150;
      this.z = 0;
      this.vx = 0;
      this.vy = 0;
      
      this.state = 'main'; // Starts directly on main belt: 'main' | 'divert' | 'branch' | 'falling' | 'boxed' | 'rejected'
      this.progress = 0;    // progress along segment
      this.scanned = false;
      this.divertSuccess = false;
      this.divertAttempted = false;
      this.fallTimer = 0;
      this.opacity = 1.0;
      
      addLog(`Emitter spawned ${type.toUpperCase()} base unit (ID #${this.id})${manual ? ' [MANUAL]' : ''}.`, "info");
    }
    
    update(dt, speedFactor) {
      const spd = conveyorSpeed * speedFactor * dt * 0.06;
      
      if (this.state === 'chute') {
        // Sliding down the entry gravity chutes
        this.x += spd * 1.5;
        // Slide downwards from side to center (y = 150)
        if (this.type === 'green') {
          this.y += spd * 0.7;
          if (this.y > 150) this.y = 150;
        } else {
          this.y -= spd * 0.7;
          if (this.y < 150) this.y = 150;
        }
        // Decline height
        this.z -= spd * 0.4;
        if (this.z < 0) this.z = 0;
        
        // Check transition to main conveyor belt
        if (this.x >= 200) {
          this.x = 200;
          this.y = 150;
          this.z = 0;
          this.state = 'main';
        }
      }
      
      else if (this.state === 'main') {
        // Traveling along main conveyor belt
        this.x += spd;
        
        // Scan Trigger Check
        if (this.x >= sensors.lidar.x && !this.scanned) {
          this.scanned = true;
          playSound('scan');
          sensors.lidar.detectedItem = this;
          sensors.lidar.cooldown = 15; // frames of scan line visual
          
          // SCADA Sensor HMI update
          const readout = document.getElementById('sensor-readout-val');
          readout.textContent = this.type.toUpperCase() === 'GREEN' ? 'BASE (GREEN)' : 'LID (BLUE)';
          readout.className = `sensor-value detect-${this.type}`;
          
          addLog(`Laser sensor scanned item ID #${this.id}: Specifier matched [${this.type.toUpperCase()}].`, "success");
          triggerRPCPacket('MCU', 'MPU', 'publish_sensor_state', `lidar, detected: ${this.type.toUpperCase()}`);
        }
        
        // Divert decision boundary: trigger servo rotation early
        if (this.x >= 400) {
          this.state = 'divert';
          this.divertAttempted = true;
          stats.divertAttempt++;
          
          // Set target servo angle based on specifier
          if (this.type === 'green') {
            servoHorn.targetAngle = Math.PI / 10; // swing down to guide item up
          } else {
            servoHorn.targetAngle = -Math.PI / 10; // swing up to guide item down
          }
          playSound('push'); // play servo hydraulic sound
          triggerRPCPacket('MPU', 'MCU', 'set_servo_angle', `${(servoHorn.targetAngle * 180 / Math.PI).toFixed(0)} deg`);
        }
      }
      
      else if (this.state === 'divert') {
        // Forward progress along conveyor
        this.x += spd;
        
        // Target Y coordinate based on specifier
        const targetY = (this.type === 'green') ? 134 : 166;
        
        // Apply lateral guiding drift towards target lane
        this.y += Math.sign(targetY - this.y) * spd * 0.35;
        
        // Physical Collision Solver with the Rotating Servo Horn Gate Arm
        // Gate pivot at A = (460, 150)
        const ax = 460;
        const ay = 150;
        // Gate tip at B = (tipX, tipY)
        const bx = 460 + 55 * Math.cos(servoHorn.angle);
        const by = 150 + 55 * Math.sin(servoHorn.angle);
        
        // Project item center P = (this.x, this.y) onto the segment AB
        const dx = bx - ax;
        const dy = by - ay;
        const lenSq = dx * dx + dy * dy;
        
        if (lenSq > 0) {
          let u = ((this.x - ax) * dx + (this.y - ay) * dy) / lenSq;
          u = Math.min(1.0, Math.max(0.0, u)); // clamp to segment
          
          const cx = ax + u * dx;
          const cy = ay + u * dy;
          
          const vx = this.x - cx;
          const vy = this.y - cy;
          const dist = Math.sqrt(vx * vx + vy * vy);
          const contactRadius = this.radius + 3.5; // item radius + gate half-width
          
          if (dist < contactRadius) {
            // Push item away from the gate arm surface
            const nx = dist === 0 ? 0 : vx / dist;
            const ny = dist === 0 ? (this.type === 'green' ? -1 : 1) : vy / dist;
            
            this.x = cx + nx * contactRadius;
            this.y = cy + ny * contactRadius;
          }
        }
        
        // Smooth transition guide once the item passes the pivot point (x = 460)
        if (this.x >= 460) {
          this.y += Math.sign(targetY - this.y) * spd * 0.6;
        }
        
        // Check exit from divert junction (x = 520)
        if (this.x >= 520) {
          // Verify if sorting was successful (aligned with target branch lane)
          if (this.type === 'green' && this.y < 146) {
            this.y = 134;
            this.state = 'branch';
            this.divertSuccess = true;
            stats.divertSuccess++;
          } else if (this.type === 'blue' && this.y > 154) {
            this.y = 166;
            this.state = 'branch';
            this.divertSuccess = true;
            stats.divertSuccess++;
          } else {
            // Jammed/Failed rotation -> Item goes down the middle reject lane
            this.state = 'rejected';
            addLog(`WARNING: Item ID #${this.id} failed divert alignment check (y = ${Math.round(this.y)}). Heading to Reject Bin.`, "warning");
          }
        }
      }
      
      else if (this.state === 'branch') {
        // Travelling along separated conveyor belt
        this.x += spd;
        
        // At the end of the flat belt (x = 710), transition to the sloped gravity chute
        if (this.x >= 710) {
          this.state = 'chute';
        }
      }
      
      else if (this.state === 'chute') {
        // Slides down the inclined roller chute
        this.x += spd;
        // Slide down inclination (z goes from 10 down to -6 over distance of 72px)
        this.z = 10 - (this.x - 710) * (16 / 72);
        
        // Once reaching the end of the chute, drop into the box
        if (this.x >= 782) {
          this.x = 782;
          this.state = 'falling';
          this.vx = spd * 0.9; // carry slide velocity forward
          this.vy = 0;
          this.vz = -0.5; // slight initial downward velocity
        }
      }
      
      else if (this.state === 'falling') {
        // Fall off conveyor into boxes
        this.x += this.vx;
        this.vz = (this.vz || 0) - 0.98 * speedFactor * dt * 0.08; // gravity
        this.z += this.vz;
        
        const targetBox = (this.type === 'green') ? boxes.upper : boxes.lower;
        
        // Check if item hit bottom of box (z = -20)
        if (this.z <= targetBox.z) {
          this.z = targetBox.z;
          this.state = 'boxed';
          this.vx = 0;
          this.vz = 0;
          
          playSound('drop');
          targetBox.items.push(this);
          targetBox.joltTimer = 10; // Trigger physical jolt bounce
          
          if (this.type === 'green') {
            stats.green++;
            document.getElementById('stats-green').textContent = String(stats.green).padStart(4, '0');
          } else {
            stats.blue++;
            document.getElementById('stats-blue').textContent = String(stats.blue).padStart(4, '0');
          }
          stats.total++;
          document.getElementById('stats-total').textContent = String(stats.total).padStart(4, '0');
          
          // Re-calculate efficiency
          const effVal = stats.divertAttempt > 0 ? Math.round((stats.divertSuccess / stats.divertAttempt) * 100) : 100;
          document.getElementById('stats-efficiency').textContent = `${effVal}%`;
          
          addLog(`Item ID #${this.id} deposited into Box #${targetBox.boxNo}. Count: ${targetBox.items.length}/4.`, "info");
          
          // Trigger Box pickup by AMR if full
          if (targetBox.items.length >= 4 && targetBox.state === 'filling') {
            targetBox.state = 'full';
            amrQueue.push(targetBox.lane);
            playSound('ship');
            addLog(`Box #${targetBox.boxNo} (${this.type.toUpperCase()}) is full. Dispatching AMR forklift robot.`, "success");
            triggerRPCPacket('MPU', 'MCU', 'dispatch_amr', `lane: ${targetBox.lane.toUpperCase()}`);
          }
        }
      }
      
      else if (this.state === 'rejected') {
        // Goes straight off main belt
        this.x += spd;
        if (this.x >= 630) {
          // Fall off
          this.vz = (this.vz || 0) - 0.98 * speedFactor * dt * 0.08;
          this.z += this.vz;
          if (this.z < -100) {
            this.opacity -= 0.1;
            if (this.opacity <= 0) {
              this.state = 'boxed'; // clears from active list
              addLog(`Item ID #${this.id} cleared from reject bin.`, "system");
            }
          }
        }
      }
    }
    
    draw(ctx, viewMode) {
      if (this.state === 'boxed' && this.z <= -20) return; // drawn inside the box instead
      
      // Draw soft drop shadow on conveyor surface (z = 0)
      if (viewMode === 'isometric' && this.state !== 'falling' && this.state !== 'boxed') {
        const shadowSc = toScreen(this.x, this.y, 0, viewMode);
        ctx.save();
        // Faint shadow opacity depending on item's actual Z height
        const shadowOpacity = Math.max(0, 0.25 - (this.z * 0.003));
        ctx.fillStyle = `rgba(0, 0, 0, ${shadowOpacity})`;
        ctx.beginPath();
        const sRad = (this.type === 'green') ? 8 : 7;
        ctx.ellipse(shadowSc.x, shadowSc.y + 1, sRad, sRad * 0.5, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
      
      // Draw the realistic 3D item
      drawItem3D(ctx, this.x, this.y, this.z, this.type, 1.0, viewMode, this.opacity, showHUD ? this.id : null);
    }
  }

  // --- Servo Horn Diverter Logic ---
  function updateServoHorn(dt, speedFactor) {
    const rotateSpeed = servoHorn.speed * speedFactor * dt * 0.06;
    const diff = servoHorn.targetAngle - servoHorn.angle;
    
    if (Math.abs(diff) < rotateSpeed) {
      servoHorn.angle = servoHorn.targetAngle;
    } else {
      servoHorn.angle += Math.sign(diff) * rotateSpeed;
    }
    
    // If no items are near, return servo horn to neutral center position
    const itemsApproaching = items.some(item => item.x > 300 && item.x < 520);
    if (!itemsApproaching) {
      servoHorn.targetAngle = 0;
    }
  }

  function drawServoHorn(ctx, viewMode) {
    const s = servoHorn;
    const scBase = toScreen(s.x, s.y, 0, viewMode);
    
    // Calculate tip of the horn based on current angle
    const tipX = s.x + s.length * Math.cos(s.angle);
    const tipY = s.y + s.length * Math.sin(s.angle);
    const scTip = toScreen(tipX, tipY, 0, viewMode);
    
    ctx.save();
    
    // 1. Draw Servo Mount Base (Circular pivot drum)
    ctx.fillStyle = '#334155'; // Dark metallic casing
    ctx.beginPath();
    ctx.arc(scBase.x, scBase.y, (viewMode === 'separator') ? 14 : 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 2;
    ctx.stroke();
    
    // Inner metal core
    ctx.fillStyle = '#94a3b8';
    ctx.beginPath();
    ctx.arc(scBase.x, scBase.y, (viewMode === 'separator') ? 8 : 4, 0, Math.PI * 2);
    ctx.fill();
    
    // 2. Draw rotating gate arm (yellow/black warning stripes look)
    ctx.strokeStyle = '#f59e0b'; // Amber warning color
    ctx.lineWidth = (viewMode === 'separator') ? 10 : 5;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(scBase.x, scBase.y);
    ctx.lineTo(scTip.x, scTip.y);
    ctx.stroke();
    
    // Guide plate metal trim overlay
    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = (viewMode === 'separator') ? 2 : 1;
    ctx.beginPath();
    ctx.moveTo(scBase.x, scBase.y);
    ctx.lineTo(scTip.x, scTip.y);
    ctx.stroke();
    
    // 3. Draw Dynamic Pneumatic Actuator Cylinder (Piston slides as gate rotates)
    // Anchor the actuator body on the conveyor frame at (415, 115)
    const actAnchorX = 415;
    const actAnchorY = 115;
    // Attach the actuator shaft to the horn guide arm at 22px from pivot
    const attachX = s.x + 22 * Math.cos(s.angle);
    const attachY = s.y + 22 * Math.sin(s.angle);
    
    const scAnchor = toScreen(actAnchorX, actAnchorY, 5, viewMode);
    const scAttach = toScreen(attachX, attachY, 5, viewMode);
    
    // Draw Actuator Cylinder Body (metallic gray tube)
    ctx.strokeStyle = '#475569';
    ctx.lineWidth = (viewMode === 'separator') ? 5 : 2.5;
    ctx.lineCap = 'square';
    
    // Cylinder body goes 45% of the way to the attachment
    const midX = scAnchor.x + (scAttach.x - scAnchor.x) * 0.45;
    const midY = scAnchor.y + (scAttach.y - scAnchor.y) * 0.45;
    ctx.beginPath();
    ctx.moveTo(scAnchor.x, scAnchor.y);
    ctx.lineTo(midX, midY);
    ctx.stroke();
    
    // Draw Shiny Steel Piston Shaft (extending out of the cylinder body to the arm connection)
    ctx.strokeStyle = '#cbd5e1';
    ctx.lineWidth = (viewMode === 'separator') ? 2.5 : 1.25;
    ctx.beginPath();
    ctx.moveTo(midX, midY);
    ctx.lineTo(scAttach.x, scAttach.y);
    ctx.stroke();
    
    // Pivot connection bolt
    ctx.fillStyle = '#1e293b';
    ctx.beginPath();
    ctx.arc(scAttach.x, scAttach.y, 2, 0, Math.PI * 2);
    ctx.fill();
    
    ctx.restore();
  }

  // --- Box Loading Station Logic ---
  function updateBoxes(dt, speedFactor) {
    const shipSpeed = 0.02 * speedFactor * dt * 0.06;
    
    for (let key in boxes) {
      let b = boxes[key];
      
      if (b.joltTimer > 0) {
        b.joltTimer -= speedFactor * dt * 0.06;
        if (b.joltTimer < 0) b.joltTimer = 0;
      }
      
      if (b.state === 'sliding_in') {
        b.progress += shipSpeed * 1.5;
        if (b.progress >= 1.0) {
          b.progress = 0;
          b.state = 'filling';
        }
      }
    }
  }

  function drawBox(ctx, lane, viewMode) {
    const b = boxes[lane];
    if (b.state === 'idle') return; // no box at dock
    
    const boxSizeX = 40;
    const boxSizeY = 40;
    const boxSizeZ = 30;
    
    let currentX = b.x;
    let currentY = b.y - boxSizeY / 2;
    let currentZ = b.z;
    
    if (b.state === 'sliding_in') {
      currentY = (b.y - boxSizeY / 2) - (1.0 - b.progress) * 120;
      currentZ = b.z + (1.0 - b.progress) * 40;
    } else if (amr.state === 'lifting' && amr.targetLane === lane) {
      currentZ = amr.forkZ;
    }
    
    drawHollowBox(ctx, currentX, currentY, currentZ, boxSizeX, boxSizeY, boxSizeZ, b.items, b.boxNo, viewMode, b.joltTimer);
  }

  // --- AMR Forklift Robot Logic ---
  function updateAMR(dt, speedFactor) {
    const spd = amr.speed * speedFactor * dt * 0.06;
    
    // Clear rack slots timers (self-clear shelf packages to run indefinitely)
    rackSlots.forEach((slot, index) => {
      if (slot.box) {
        slot.clearTimer += dt * speedFactor;
        if (slot.clearTimer >= 15000) { // Keep boxes on shelf for 15 seconds, then ship away
          addLog(`Warehouse Rack Slot #${index + 1} cleared: Box #${slot.box.boxNo} shipped to client logistics truck.`, "success");
          slot.box = null;
          slot.clearTimer = 0;
        }
      }
    });

    if (amr.state === 'idle') {
      // Check queue
      if (amrQueue.length > 0) {
        // Find if there is an empty slot on the rack
        const emptySlotIndex = rackSlots.findIndex(slot => slot.box === null);
        if (emptySlotIndex !== -1) {
          amr.targetLane = amrQueue.shift();
          amr.slotIndex = emptySlotIndex;
          amr.state = 'moving_to_box';
          amr.progress = 0;
          amr.forkExt = 0; // ensure retracted
          // Spawn AMR at warehouse entrance
          amr.x = 880;
          amr.y = 280;
          amr.z = -20;
          amr.angle = Math.PI; // pointing left
          addLog(`AMR dispatched to pick up full box from ${amr.targetLane.toUpperCase()} lane. Assigned rack slot: #${emptySlotIndex + 1}.`, "info");
        }
      }
    }
    
    else if (amr.state === 'moving_to_box') {
      // Approach path: (880, 280) -> (850, 280) -> (850, laneY) (stops at x=850 to leave space for reach forks)
      const targetY = amr.targetLane === 'upper' ? 134 : 166;
      
      if (amr.x > 850) {
        if (amr.x - 850 > spd) {
          amr.x -= spd;
        } else {
          amr.x = 850;
        }
        amr.angle = Math.PI; // left
      } else if (Math.abs(amr.y - targetY) > spd) {
        amr.angle = amr.y > targetY ? -Math.PI/2 : Math.PI/2; // up or down
        amr.y += Math.sign(targetY - amr.y) * spd;
      } else {
        // Stop exactly at position
        amr.x = 850;
        amr.y = targetY;
        amr.angle = Math.PI; // facing left
        amr.state = 'extending_forks';
        amr.progress = 0;
        addLog(`AMR reach truck in position at ${amr.targetLane.toUpperCase()} lane. Extending reach forks...`, "info");
      }
    }
    
    else if (amr.state === 'extending_forks') {
      // Telescoping reach mechanism slides forks forward under the box
      amr.forkExt += spd * 1.5;
      if (amr.forkExt >= 38) {
        amr.forkExt = 38;
        amr.state = 'lifting';
        addLog(`Reach forks fully extended. Engaging lift mast...`, "info");
      }
    }
    
    else if (amr.state === 'lifting') {
      // Forks raise box z from -20 to -10
      amr.forkZ += spd * 0.4;
      if (amr.forkZ >= -10) {
        amr.forkZ = -10;
        
        // Grab the box
        const targetB = boxes[amr.targetLane];
        amr.box = {
          boxNo: targetB.boxNo,
          items: [...targetB.items],
          lane: targetB.lane
        };
        
        // Spawn empty box in its place immediately
        targetB.items = [];
        targetB.boxNo++;
        targetB.state = 'sliding_in';
        targetB.progress = 0;
        
        amr.state = 'retracting_forks';
        addLog(`Box #${amr.box.boxNo} secured. Retracting reach forks...`, "info");
      }
    }
    
    else if (amr.state === 'retracting_forks') {
      // Telescoping reach mechanism retracts forks carrying the box closer to chassis
      amr.forkExt -= spd * 1.5;
      if (amr.forkExt <= 0) {
        amr.forkExt = 0;
        amr.state = 'carrying_to_rack';
        addLog(`Forks retracted. Navigating load through warehouse aisle...`, "info");
      }
    }
    
    else if (amr.state === 'carrying_to_rack') {
      // Navigates along the dedicated aisle at y = 81 (clear of conveyors and racks)
      // Path: (850, laneY) -> (850, 81) -> (slot.x, 81) -> Rotate to -Math.PI/2 (up, facing rack)
      const slot = rackSlots[amr.slotIndex];
      const aisleY = 81;
      
      if (Math.abs(amr.y - aisleY) > spd) {
        amr.angle = amr.y > aisleY ? -Math.PI/2 : Math.PI/2; // up or down
        amr.y += Math.sign(aisleY - amr.y) * spd;
      } else {
        amr.y = aisleY; // snap y to aisle height
        
        if (Math.abs(amr.x - slot.x) > spd) {
          amr.angle = amr.x > slot.x ? Math.PI : 0; // left or right
          amr.x += Math.sign(slot.x - amr.x) * spd;
        } else {
          // Arrived in aisle in front of slot. Turn facing rack (upwards)
          amr.x = slot.x;
          amr.angle = -Math.PI/2; // up
          
          // Before extending forks, if depositing on upper shelf, we raise the lift mast first to avoid collision
          if (slot.z > -20) {
            // Upper shelf (z = 25). Lift forks to z = 30 to clear shelf frame.
            if (amr.forkZ < 30) {
              amr.forkZ += spd * 0.4;
            } else {
              amr.state = 'extending_at_rack';
              addLog(`Reached Slot #${amr.slotIndex + 1}. Mast raised. Extending reach forks...`, "info");
            }
          } else {
            // Lower shelf (z = -20). Forks are at z = -10 (which clears the shelf). Extend immediately.
            amr.state = 'extending_at_rack';
            addLog(`Reached Slot #${amr.slotIndex + 1}. Extending reach forks...`, "info");
          }
        }
      }
    }
    
    else if (amr.state === 'extending_at_rack') {
      // Slides reach forks forward into the rack shelf slot center (y = 35)
      amr.forkExt += spd * 1.5;
      if (amr.forkExt >= 38) {
        amr.forkExt = 38;
        amr.state = 'lowering';
        addLog(`Forks extended. Lowering box onto shelf...`, "info");
      }
    }
    
    else if (amr.state === 'lowering') {
      const slot = rackSlots[amr.slotIndex];
      
      // Lower load onto the shelf surface
      if (amr.forkZ > slot.z) {
        amr.forkZ -= spd * 0.2;
      } else {
        // Release box onto shelf slot
        amr.forkZ = slot.z;
        slot.box = amr.box;
        slot.clearTimer = 0;
        amr.box = null; // empty hands
        
        amr.state = 'retracting_at_rack';
        addLog(`Box deposited in Rack Slot #${amr.slotIndex + 1}. Retracting forks...`, "success");
      }
    }
    
    else if (amr.state === 'retracting_at_rack') {
      // Telescopes forks back (now empty) to the AMR chassis
      amr.forkExt -= spd * 1.5;
      if (amr.forkExt <= 0) {
        amr.forkExt = 0;
        
        // Lower empty forks to default carry height (-20)
        if (amr.forkZ > -20) {
          amr.forkZ -= spd * 0.4;
        } else {
          amr.forkZ = -20;
          amr.state = 'returning';
          addLog(`Forks retracted. Returning to staging area.`, "info");
        }
      }
    }
    
    else if (amr.state === 'returning') {
      // Path: (slot.x, 81) -> (850, 81) -> (850, 280) -> (880, 280)
      if (amr.x < 850) {
        if (850 - amr.x > spd) {
          amr.x += spd;
        } else {
          amr.x = 850;
        }
        amr.angle = 0; // right
      } else if (amr.y < 280) {
        if (280 - amr.y > spd) {
          amr.y += spd;
        } else {
          amr.y = 280;
        }
        amr.angle = Math.PI/2; // down
      } else if (amr.x < 880) {
        if (880 - amr.x > spd) {
          amr.x += spd;
        } else {
          amr.x = 880;
        }
        amr.angle = 0; // right
      } else {
        // Returned to warehouse exit! Go idle.
        amr.state = 'idle';
        amr.targetLane = null;
        amr.slotIndex = -1;
        amr.forkExt = 0;
        amr.forkZ = -20;
        addLog(`AMR forklift returned to staging zone. Standby.`, "info");
      }
    }
  }

  function drawAMR(ctx, viewMode) {
    ctx.save();
    
    // Draw LIDAR Safety Scanner Arc on floor (glowing red sector in front of robot) when active
    if (viewMode === 'isometric' && amr.state !== 'idle') {
      const scFloorCenter = toScreen(amr.x, amr.y, -20, viewMode);
      ctx.save();
      ctx.shadowColor = 'rgba(239, 68, 68, 0.4)';
      ctx.shadowBlur = 10;
      ctx.fillStyle = 'rgba(239, 68, 68, 0.08)';
      ctx.strokeStyle = 'rgba(239, 68, 68, 0.35)';
      ctx.lineWidth = 1.5;
      
      ctx.beginPath();
      ctx.moveTo(scFloorCenter.x, scFloorCenter.y);
      
      const scanAngle = amr.angle;
      const fov = Math.PI / 3; // 60 degree fov
      const dist = 35;
      
      // Interpolate safety arc outer edge
      for (let a = scanAngle - fov; a <= scanAngle + fov; a += 0.2) {
        let ax = amr.x + Math.cos(a) * dist;
        let ay = amr.y + Math.sin(a) * dist;
        let p = toScreen(ax, ay, -20, viewMode);
        ctx.lineTo(p.x, p.y);
      }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      
      // Draw concentric radar safety sweep rings inside the LIDAR field
      ctx.strokeStyle = 'rgba(239, 68, 68, 0.15)';
      ctx.lineWidth = 1;
      for (let r = 12; r <= dist; r += 12) {
        ctx.beginPath();
        for (let a = scanAngle - fov; a <= scanAngle + fov; a += 0.1) {
          let ax = amr.x + Math.cos(a) * r;
          let ay = amr.y + Math.sin(a) * r;
          let p = toScreen(ax, ay, -20, viewMode);
          if (a === scanAngle - fov) ctx.moveTo(p.x, p.y);
          else ctx.lineTo(p.x, p.y);
        }
        ctx.stroke();
      }
      
      // Draw soft yellow headlight cone projected on the floor
      const hx = amr.x + Math.cos(amr.angle) * 14;
      const hy = amr.y + Math.sin(amr.angle) * 14;
      const scLightCenter = toScreen(hx, hy, -16, viewMode);
      
      ctx.fillStyle = 'rgba(253, 224, 71, 0.05)';
      ctx.beginPath();
      ctx.moveTo(scLightCenter.x, scLightCenter.y);
      
      const lightFov = Math.PI / 4; // 45 degree beam width
      const lightDist = 65;
      for (let la = scanAngle - lightFov; la <= scanAngle + lightFov; la += 0.1) {
        let lx = hx + Math.cos(la) * lightDist;
        let ly = hy + Math.sin(la) * lightDist;
        let lp = toScreen(lx, ly, -20, viewMode);
        ctx.lineTo(lp.x, lp.y);
      }
      ctx.closePath();
      ctx.fill();
      
      ctx.restore();
    }
    
    // 1. Draw AMR robot base chassis (neon red/orange and slate gray box)
    const amrSizeX = 24;
    const amrSizeY = 24;
    const amrSizeZ = 12;
    
    const styleAMR = {
      fillTop: '#f97316',       // Safety orange
      fillFrontLeft: '#475569', // Steel grey side panels
      fillFrontRight: '#334155',
      stroke: '#1e293b',
      lineWidth: 1.5
    };
    
    // Draw wheels under the chassis base (two wheels visible depending on side angle)
    if (viewMode === 'isometric') {
      ctx.save();
      ctx.fillStyle = '#1e293b'; // wheel black
      const w1 = toScreen(amr.x - 8, amr.y + 12, -20, viewMode);
      ctx.beginPath(); ctx.arc(w1.x, w1.y + 3, 5, 0, Math.PI * 2); ctx.fill();
      const w2 = toScreen(amr.x + 8, amr.y + 12, -20, viewMode);
      ctx.beginPath(); ctx.arc(w2.x, w2.y + 3, 5, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
    
    // Draw AMR body structure
    drawIsoBox(ctx, amr.x - amrSizeX/2, amr.y - amrSizeY/2, -20, amrSizeX, amrSizeY, amrSizeZ, styleAMR);
    
    // 2. Draw Lifter Mast (vertical steel columns at the front depending on angle)
    const forkLen = 16;
    const fx = amr.x + Math.cos(amr.angle) * (amrSizeX/2);
    const fy = amr.y + Math.sin(amr.angle) * (amrSizeY/2);
    
    const scMastLeft = toScreen(fx - 4 * Math.sin(amr.angle), fy + 4 * Math.cos(amr.angle), -20, viewMode);
    const scMastLeftTop = toScreen(fx - 4 * Math.sin(amr.angle), fy + 4 * Math.cos(amr.angle), 28, viewMode);
    const scMastRight = toScreen(fx + 4 * Math.sin(amr.angle), fy - 4 * Math.cos(amr.angle), -20, viewMode);
    const scMastRightTop = toScreen(fx + 4 * Math.sin(amr.angle), fy - 4 * Math.cos(amr.angle), 28, viewMode);
    
    ctx.save();
    ctx.strokeStyle = '#64748b'; // chrome upright rails
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(scMastLeft.x, scMastLeft.y); ctx.lineTo(scMastLeftTop.x, scMastLeftTop.y);
    ctx.moveTo(scMastRight.x, scMastRight.y); ctx.lineTo(scMastRightTop.x, scMastRightTop.y);
    ctx.stroke();
    
    // Draw vertical lift chains/cables inside mast channels
    ctx.strokeStyle = '#334155';
    ctx.lineWidth = 1;
    const scChainLeft = toScreen(fx - 2 * Math.sin(amr.angle), fy + 2 * Math.cos(amr.angle), -20, viewMode);
    const scChainLeftTop = toScreen(fx - 2 * Math.sin(amr.angle), fy + 2 * Math.cos(amr.angle), amr.forkZ + 15, viewMode);
    const scChainRight = toScreen(fx + 2 * Math.sin(amr.angle), fy - 2 * Math.cos(amr.angle), -20, viewMode);
    const scChainRightTop = toScreen(fx + 2 * Math.sin(amr.angle), fy - 2 * Math.cos(amr.angle), amr.forkZ + 15, viewMode);
    ctx.beginPath();
    ctx.moveTo(scChainLeft.x, scChainLeft.y); ctx.lineTo(scChainLeftTop.x, scChainLeftTop.y);
    ctx.moveTo(scChainRight.x, scChainRight.y); ctx.lineTo(scChainRightTop.x, scChainRightTop.y);
    ctx.stroke();
    
    // Mast cross bracket
    ctx.strokeStyle = '#475569';
    ctx.lineWidth = 4;
    const scMastMid = toScreen(fx, fy, 28, viewMode);
    const scMastMidTop = toScreen(fx, fy, 32, viewMode);
    ctx.beginPath(); ctx.moveTo(scMastMid.x, scMastMid.y); ctx.lineTo(scMastMidTop.x, scMastMidTop.y); ctx.stroke();
    ctx.restore();
    
    // 3. Draw forks carrying the box (drawn at amr.forkZ height)
    // Base forks (short, fixed to mast)
    const baseForkLen = 14;
    const baseForkX2 = fx + Math.cos(amr.angle) * baseForkLen;
    const baseForkY2 = fy + Math.sin(amr.angle) * baseForkLen;
    
    // Telescoping extension forks (slides out by amr.forkExt)
    const extForkX1 = fx + Math.cos(amr.angle) * amr.forkExt;
    const extForkY1 = fy + Math.sin(amr.angle) * amr.forkExt;
    const extForkX2 = extForkX1 + Math.cos(amr.angle) * forkLen;
    const extForkY2 = extForkY1 + Math.sin(amr.angle) * forkLen;
    
    // Draw Base Forks (darker guide rails)
    const fxLBase1 = fx - 5 * Math.sin(amr.angle);
    const fyLBase1 = fy + 5 * Math.cos(amr.angle);
    const fxLBase2 = baseForkX2 - 5 * Math.sin(amr.angle);
    const fyLBase2 = baseForkY2 + 5 * Math.cos(amr.angle);
    const scForkLBaseStart = toScreen(fxLBase1, fyLBase1, amr.forkZ, viewMode);
    const scForkLBaseEnd = toScreen(fxLBase2, fyLBase2, amr.forkZ, viewMode);

    const fxRBase1 = fx + 5 * Math.sin(amr.angle);
    const fyRBase1 = fy - 5 * Math.cos(amr.angle);
    const fxRBase2 = baseForkX2 + 5 * Math.sin(amr.angle);
    const fyRBase2 = baseForkY2 - 5 * Math.cos(amr.angle);
    const scForkRBaseStart = toScreen(fxRBase1, fyRBase1, amr.forkZ, viewMode);
    const scForkRBaseEnd = toScreen(fxRBase2, fyRBase2, amr.forkZ, viewMode);
    
    ctx.save();
    ctx.strokeStyle = '#475569'; // steel blue grey fork base
    ctx.lineWidth = 3.5;
    ctx.beginPath();
    ctx.moveTo(scForkLBaseStart.x, scForkLBaseStart.y); ctx.lineTo(scForkLBaseEnd.x, scForkLBaseEnd.y);
    ctx.moveTo(scForkRBaseStart.x, scForkRBaseStart.y); ctx.lineTo(scForkRBaseEnd.x, scForkRBaseEnd.y);
    ctx.stroke();
    ctx.restore();
    
    // Draw Telescoping Extension Forks (bright chrome silver, sliding out)
    const fxL1_ext = extForkX1 - 4 * Math.sin(amr.angle);
    const fyL1_ext = extForkY1 + 4 * Math.cos(amr.angle);
    const fxL2_ext = extForkX2 - 4 * Math.sin(amr.angle);
    const fyL2_ext = extForkY2 + 4 * Math.cos(amr.angle);
    const scForkLBase = toScreen(fxL1_ext, fyL1_ext, amr.forkZ, viewMode);
    const scForkLTip = toScreen(fxL2_ext, fyL2_ext, amr.forkZ, viewMode);
    
    const fxR1_ext = extForkX1 + 4 * Math.sin(amr.angle);
    const fyR1_ext = extForkY1 - 4 * Math.cos(amr.angle);
    const fxR2_ext = extForkX2 + 4 * Math.sin(amr.angle);
    const fyR2_ext = extForkY2 - 4 * Math.cos(amr.angle);
    const scForkRBase = toScreen(fxR1_ext, fyR1_ext, amr.forkZ, viewMode);
    const scForkRTip = toScreen(fxR2_ext, fyR2_ext, amr.forkZ, viewMode);
    
    ctx.save();
    ctx.strokeStyle = '#cbd5e1'; // bright chrome sliding forks
    ctx.lineWidth = 2.0;
    ctx.beginPath();
    ctx.moveTo(scForkLBase.x, scForkLBase.y); ctx.lineTo(scForkLTip.x, scForkLTip.y);
    ctx.moveTo(scForkRBase.x, scForkRBase.y); ctx.lineTo(scForkRTip.x, scForkRTip.y);
    ctx.stroke();
    ctx.restore();
    
    // 4. Draw box on forks if carrying
    if (amr.box) {
      const boxSizeX = 40;
      const boxSizeY = 40;
      const boxSizeZ = 30;
      const bx = extForkX2 - boxSizeX/2;
      const by = extForkY2 - boxSizeY/2;
      const bz = amr.forkZ;
      drawHollowBox(ctx, bx, by, bz, boxSizeX, boxSizeY, boxSizeZ, amr.box.items, amr.box.boxNo, viewMode, 0);
    }
    
    // 5. Flashing amber warning beacon on top of AMR (rich lens flare effect when active)
    const scBeacon = toScreen(amr.x, amr.y, -8, viewMode);
    const flash = (amr.state !== 'idle') && (Math.floor(Date.now() / 250) % 2 === 0);
    
    if (flash) {
      const beaconGrad = ctx.createRadialGradient(scBeacon.x, scBeacon.y, 1, scBeacon.x, scBeacon.y, 9);
      beaconGrad.addColorStop(0, '#ffffff');
      beaconGrad.addColorStop(0.3, 'rgba(245, 158, 11, 0.95)'); // Amber alert beacon
      beaconGrad.addColorStop(1, 'rgba(245, 158, 11, 0)');
      
      ctx.fillStyle = beaconGrad;
      ctx.beginPath();
      ctx.arc(scBeacon.x, scBeacon.y, 9, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.fillStyle = '#78350f';
      ctx.beginPath();
      ctx.arc(scBeacon.x, scBeacon.y, 3, 0, Math.PI * 2);
      ctx.fill();
    }
    
    ctx.restore();
  }

  // --- Main Conveyor Structures & Static Art ---
  function drawStaticInfrastructure(ctx, viewMode) {
    // 1. Draw concrete floor polygon & warehouse walls (only in isometric view)
    if (viewMode === 'isometric') {
      // Draw light gray warehouse wall
      ctx.fillStyle = '#d1d5db';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      
      // Coordinates of the floor grid boundary (isometric polygon)
      const f1 = toScreen(0, 0, -100);
      const f2 = toScreen(920, 0, -100);
      const f3 = toScreen(920, 300, -100);
      const f4 = toScreen(0, 300, -100);
      
      // Draw light concrete floor
      ctx.fillStyle = '#eceee9';
      ctx.beginPath();
      ctx.moveTo(f1.x, f1.y);
      ctx.lineTo(f2.x, f2.y);
      ctx.lineTo(f3.x, f3.y);
      ctx.lineTo(f4.x, f4.y);
      ctx.closePath();
      ctx.fill();
      
      // Draw dark slate baseboard joint
      ctx.strokeStyle = '#94a3b8';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(f1.x, f1.y);
      ctx.lineTo(f2.x, f2.y);
      ctx.stroke();
      
      // Draw vertical concrete columns along back wall
      ctx.fillStyle = '#c5c7c4'; // slightly darker column color
      const pillarWidth = 16;
      const pillarsX = [80, 260, 440, 620, 800];
      pillarsX.forEach(px => {
        const basePt = toScreen(px, 0, -100);
        // Column goes straight up to the top of the canvas
        ctx.fillRect(basePt.x - pillarWidth/2, 0, pillarWidth, basePt.y);
        
        // Column shadow line
        ctx.strokeStyle = '#94a3b8';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(basePt.x + pillarWidth/2, 0);
        ctx.lineTo(basePt.x + pillarWidth/2, basePt.y);
        ctx.stroke();
      });
      
      // Draw blue safety fence panels behind conveyors (Y = 15)
      ctx.save();
      const fenceY = 15;
      const fenceXPoints = [20, 140, 260, 380, 500, 620, 740, 860];
      
      ctx.strokeStyle = 'rgba(71, 85, 105, 0.25)'; // mesh lines
      ctx.lineWidth = 0.5;
      
      for (let i = 0; i < fenceXPoints.length - 1; i++) {
        const x1 = fenceXPoints[i];
        const x2 = fenceXPoints[i+1];
        
        const pBot1 = toScreen(x1, fenceY, -100);
        const pBot2 = toScreen(x2, fenceY, -100);
        const pTop1 = toScreen(x1, fenceY, -40); // fence height 60
        const pTop2 = toScreen(x2, fenceY, -40);
        
        // Semi-transparent mesh panel
        ctx.fillStyle = 'rgba(148, 163, 184, 0.05)';
        ctx.beginPath();
        ctx.moveTo(pBot1.x, pBot1.y);
        ctx.lineTo(pBot2.x, pBot2.y);
        ctx.lineTo(pTop2.x, pTop2.y);
        ctx.lineTo(pTop1.x, pTop1.y);
        ctx.closePath();
        ctx.fill();
        
        // Mesh vertical/horizontal wires
        ctx.beginPath();
        for (let t = 0; t <= 1.0; t += 0.08) {
          let bx = x1 + (x2 - x1) * t;
          let pt1 = toScreen(bx, fenceY, -100);
          let pt2 = toScreen(bx, fenceY, -40);
          ctx.moveTo(pt1.x, pt1.y);
          ctx.lineTo(pt2.x, pt2.y);
        }
        for (let hz = -100; hz <= -40; hz += 12) {
          let pt1 = toScreen(x1, fenceY, hz);
          let pt2 = toScreen(x2, fenceY, hz);
          ctx.moveTo(pt1.x, pt1.y);
          ctx.lineTo(pt2.x, pt2.y);
        }
        ctx.stroke();
        
        // Steel blue top rail
        ctx.strokeStyle = '#475569';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(pTop1.x, pTop1.y);
        ctx.lineTo(pTop2.x, pTop2.y);
        ctx.stroke();
      }
      
      // Fence upright posts (blue steel)
      fenceXPoints.forEach(px => {
        const pBot = toScreen(px, fenceY, -100);
        const pTop = toScreen(px, fenceY, -40);
        
        ctx.strokeStyle = '#3b82f6'; // Clean blue post
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(pBot.x, pBot.y);
        ctx.lineTo(pTop.x, pTop.y);
        ctx.stroke();
        
        // Post yellow cap
        ctx.fillStyle = '#eab308';
        ctx.beginPath();
        ctx.arc(pTop.x, pTop.y, 2, 0, Math.PI*2);
        ctx.fill();
      });
      ctx.restore();
      
      // Draw faded stenciled shop telemetry decals
      ctx.fillStyle = 'rgba(75, 85, 99, 0.15)';
      ctx.font = '800 9px var(--font-display)';
      ctx.textAlign = 'center';
      
      const bayA = toScreen(780, 95, -100);
      ctx.fillText("LOAD DOCK A", bayA.x, bayA.y);
      const bayB = toScreen(780, 205, -100);
      ctx.fillText("LOAD DOCK B", bayB.x, bayB.y);
      
      const rackLbl = toScreen(720, 75, -100);
      ctx.fillText("WAREHOUSE RACK A", rackLbl.x, rackLbl.y);
      
      const amrLbl = toScreen(860, 230, -100);
      ctx.fillText("AMR ZONE", amrLbl.x, amrLbl.y);
    }
    
    // 2. Conveyor Belts (Steel frames with textured belts)
    const conveyorBeltStyle = {
      fillTop: '#111827',       // Dark rubber belt
      fillFrontLeft: '#cbd5e1', // Clean light gray/steel frame
      fillFrontRight: '#94a3b8',
      stroke: '#475569',
      lineWidth: 1
    };
    
    // Main Belt: x 20..460, y 150, z = 0, width = 50
    drawIsoBox(ctx, 20, 125, 0, 440, 50, 10, conveyorBeltStyle);
    
    // Divert transition plate
    drawIsoBox(ctx, 460, 120, 0, 60, 60, 6, { fill: '#cbd5e1', stroke: '#475569' });
    
    // Upper Branch Belt: x 520..710, y 134, z = 0, width = 24
    drawIsoBox(ctx, 520, 122, 0, 190, 24, 10, conveyorBeltStyle);
    
    // Lower Branch Belt: x 520..710, y 166, z = 0, width = 24
    drawIsoBox(ctx, 520, 154, 0, 190, 24, 10, conveyorBeltStyle);
    
    // Divider rail between branch belts
    drawIsoBox(ctx, 580, 146, 0, 130, 8, 12, { fillTop: '#cbd5e1', fillFrontLeft: '#94a3b8', fillFrontRight: '#64748b', stroke: '#475569' });
    
    // Draw Inclined Gravity Roller Chutes
    drawInclinedChute(ctx, 122, 134, 146, viewMode); // Upper
    drawInclinedChute(ctx, 154, 166, 178, viewMode); // Lower
    
    // Slide texture markings for motion indication
    if (isPlaying && !isEStop) {
      ctx.save();
      ctx.fillStyle = 'rgba(255, 255, 255, 0.05)';
      const beltOffset = (runtime * 0.045 * conveyorSpeed) % 20;
      
      // Main Belt motion dots
      for (let bx = 20 + beltOffset; bx < 460; bx += 20) {
        const dotPt = toScreen(bx, 150, 10, viewMode);
        ctx.beginPath();
        ctx.arc(dotPt.x, dotPt.y, (viewMode === 'separator') ? 3 : 1.5, 0, Math.PI * 2);
        ctx.fill();
      }
      
      // Branch belt dots
      for (let bx = 520 + beltOffset; bx < 710; bx += 20) {
        const dotPtUpper = toScreen(bx, 134, 10, viewMode);
        const dotPtLower = toScreen(bx, 166, 10, viewMode);
        ctx.beginPath();
        ctx.arc(dotPtUpper.x, dotPtUpper.y, 1, 0, Math.PI * 2);
        ctx.arc(dotPtLower.x, dotPtLower.y, 1, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
    
    // Draw Spinning Cylindrical Rollers along the conveyor edges
    const rollerSpacing = 35;
    ctx.strokeStyle = '#cbd5e1';
    
    // Main belt rollers
    for (let rx = 35; rx < 450; rx += rollerSpacing) {
      const ptLeft = toScreen(rx, 125, 9.5, viewMode);
      const ptRight = toScreen(rx, 175, 9.5, viewMode);
      
      ctx.lineWidth = (viewMode === 'separator') ? 4 : 2;
      ctx.beginPath(); ctx.moveTo(ptLeft.x, ptLeft.y); ctx.lineTo(ptRight.x, ptRight.y); ctx.stroke();
      
      // Roller rotation highlight stripe
      const rotationAngle = (runtime * 0.015 * conveyorSpeed + rx) % (Math.PI * 2);
      const offset = Math.sin(rotationAngle) * 3;
      const stripePtLeft = toScreen(rx + offset, 125, 10, viewMode);
      const stripePtRight = toScreen(rx + offset, 175, 10, viewMode);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.22)';
      ctx.lineWidth = (viewMode === 'separator') ? 1.5 : 0.8;
      ctx.beginPath(); ctx.moveTo(stripePtLeft.x, stripePtLeft.y); ctx.lineTo(stripePtRight.x, stripePtRight.y); ctx.stroke();
      ctx.strokeStyle = '#cbd5e1'; // reset
    }
    
    // Branch belt rollers
    for (let rx = 530; rx < 710; rx += rollerSpacing) {
      const rotationAngle = (runtime * 0.015 * conveyorSpeed + rx) % (Math.PI * 2);
      const offset = Math.sin(rotationAngle) * 1.5;
      
      // Upper branch rollers
      const uLeft = toScreen(rx, 122, 9.5, viewMode);
      const uRight = toScreen(rx, 146, 9.5, viewMode);
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(uLeft.x, uLeft.y); ctx.lineTo(uRight.x, uRight.y); ctx.stroke();
      
      const uStripeL = toScreen(rx + offset, 122, 10, viewMode);
      const uStripeR = toScreen(rx + offset, 146, 10, viewMode);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.22)';
      ctx.lineWidth = 0.6;
      ctx.beginPath(); ctx.moveTo(uStripeL.x, uStripeL.y); ctx.lineTo(uStripeR.x, uStripeR.y); ctx.stroke();
      ctx.strokeStyle = '#cbd5e1';
      
      // Lower branch rollers
      const lLeft = toScreen(rx, 154, 9.5, viewMode);
      const lRight = toScreen(rx, 178, 9.5, viewMode);
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(lLeft.x, lLeft.y); ctx.lineTo(lRight.x, lRight.y); ctx.stroke();
      
      const lStripeL = toScreen(rx + offset, 154, 10, viewMode);
      const lStripeR = toScreen(rx + offset, 178, 10, viewMode);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.22)';
      ctx.lineWidth = 0.6;
      ctx.beginPath(); ctx.moveTo(lStripeL.x, lStripeL.y); ctx.lineTo(lStripeR.x, lStripeR.y); ctx.stroke();
      ctx.strokeStyle = '#cbd5e1';
    }
    
    // Reject Bin: placed in the center gap (x 520..570, y 146..154)
    const rejectBinStyle = {
      fillTop: 'rgba(30, 30, 30, 0.9)',
      fillFrontLeft: '#cbd5e1',
      fillFrontRight: '#94a3b8',
      stroke: '#475569',
      lineWidth: 1
    };
    drawIsoBox(ctx, 520, 146, -50, 50, 8, 40, rejectBinStyle);
    
    // Conveyor Legs Support
    ctx.strokeStyle = '#cbd5e1';
    ctx.lineWidth = (viewMode === 'separator') ? 6 : 3;
    const legs = [100, 250, 400, 520, 650, 750];
    legs.forEach(lx => {
      const ly = lx > 450 ? 134 : 150;
      let topPt = toScreen(lx, ly, 0);
      let botPt = toScreen(lx, ly, -70);
      ctx.beginPath(); ctx.moveTo(topPt.x, topPt.y); ctx.lineTo(botPt.x, botPt.y); ctx.stroke();
      
      // Draw foot mount
      ctx.fillStyle = '#475569';
      ctx.beginPath(); ctx.arc(botPt.x, botPt.y, 4, 0, Math.PI * 2); ctx.fill();
      
      if (lx > 450) {
        let topPt2 = toScreen(lx, 166, 0);
        let botPt2 = toScreen(lx, 166, -70);
        ctx.beginPath(); ctx.moveTo(topPt2.x, topPt2.y); ctx.lineTo(botPt2.x, botPt2.y); ctx.stroke();
        
        ctx.beginPath(); ctx.arc(botPt2.x, botPt2.y, 4, 0, Math.PI * 2); ctx.fill();
      }
    });

    // 4. Warehouse Pallet Rack (Storage Rack for filled boxes)
    if (viewMode === 'isometric') {
      const rackX1 = 680;
      const rackX2 = 765;
      const rackYFront = 50;
      const rackYBack = 20;
      const rackHeight = 60;
      
      ctx.strokeStyle = '#1d4ed8'; // Blue steel uprights
      ctx.lineWidth = 3;
      
      // Upright posts
      const posts = [rackX1, rackX1 + 45, rackX2];
      posts.forEach(px => {
        let pBackBot = toScreen(px, rackYBack, -20);
        let pBackTop = toScreen(px, rackYBack, rackHeight - 20);
        ctx.beginPath(); ctx.moveTo(pBackBot.x, pBackBot.y); ctx.lineTo(pBackTop.x, pBackTop.y); ctx.stroke();
        
        let pFrontBot = toScreen(px, rackYFront, -20);
        let pFrontTop = toScreen(px, rackYFront, rackHeight - 20);
        ctx.beginPath(); ctx.moveTo(pFrontBot.x, pFrontBot.y); ctx.lineTo(pFrontTop.x, pFrontTop.y); ctx.stroke();
        
        // Connect front and back with diagonal braces
        ctx.strokeStyle = '#3b82f6';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(pFrontBot.x, pFrontBot.y); ctx.lineTo(pBackTop.x, pBackTop.y);
        ctx.moveTo(pBackBot.x, pBackBot.y); ctx.lineTo(pFrontTop.x, pFrontTop.y);
        ctx.stroke();
        ctx.strokeStyle = '#1d4ed8';
        ctx.lineWidth = 3;
      });
      
      // Horizontal support beams (Orange)
      ctx.strokeStyle = '#ea580c'; // Heavy load orange
      ctx.lineWidth = 4;
      
      // Upper shelf beams (z = 25)
      let pUpperFrontL = toScreen(rackX1, rackYFront, 25);
      let pUpperFrontR = toScreen(rackX2, rackYFront, 25);
      ctx.beginPath(); ctx.moveTo(pUpperFrontL.x, pUpperFrontL.y); ctx.lineTo(pUpperFrontR.x, pUpperFrontR.y); ctx.stroke();
      
      let pUpperBackL = toScreen(rackX1, rackYBack, 25);
      let pUpperBackR = toScreen(rackX2, rackYBack, 25);
      ctx.beginPath(); ctx.moveTo(pUpperBackL.x, pUpperBackL.y); ctx.lineTo(pUpperBackR.x, pUpperBackR.y); ctx.stroke();
      
      // Floor shelf beams (z = -20)
      let pLowerFrontL = toScreen(rackX1, rackYFront, -20);
      let pLowerFrontR = toScreen(rackX2, rackYFront, -20);
      ctx.beginPath(); ctx.moveTo(pLowerFrontL.x, pLowerFrontL.y); ctx.lineTo(pLowerFrontR.x, pLowerFrontR.y); ctx.stroke();
      
      let pLowerBackL = toScreen(rackX1, rackYBack, -20);
      let pLowerBackR = toScreen(rackX2, rackYBack, -20);
      ctx.beginPath(); ctx.moveTo(pLowerBackL.x, pLowerBackL.y); ctx.lineTo(pLowerBackR.x, pLowerBackR.y); ctx.stroke();
    }
  }

  // --- Sensors & Laser Scan Effects ---
  function drawSensors(ctx, viewMode) {
    const s = sensors.lidar;
    
    // Laser bridge structure
    const scBridgeLeft = toScreen(s.x, s.y - 35, s.z + 10, viewMode);
    const scBridgeRight = toScreen(s.x, s.y + 35, s.z + 10, viewMode);
    const scLaserEmitter = toScreen(s.x, s.y, s.z, viewMode);
    const scLaserTarget = toScreen(s.x, s.y, 0, viewMode);
    
    ctx.save();
    
    // 1. Draw metal bridge bracket
    ctx.strokeStyle = '#475569';
    ctx.lineWidth = (viewMode === 'separator') ? 6 : 3;
    ctx.beginPath();
    ctx.moveTo(scBridgeLeft.x, scBridgeLeft.y);
    ctx.lineTo(scBridgeRight.x, scBridgeRight.y);
    ctx.stroke();
    
    // Support vertical poles
    const supportLeftBot = toScreen(s.x, s.y - 35, -5, viewMode);
    const supportRightBot = toScreen(s.x, s.y + 35, -5, viewMode);
    ctx.beginPath();
    ctx.moveTo(scBridgeLeft.x, scBridgeLeft.y);
    ctx.lineTo(supportLeftBot.x, supportLeftBot.y);
    ctx.moveTo(scBridgeRight.x, scBridgeRight.y);
    ctx.lineTo(supportRightBot.x, supportRightBot.y);
    ctx.stroke();
    
    // Emitter cylinder
    ctx.fillStyle = '#f59e0b'; // Gold colored photo-eye sensor
    ctx.beginPath();
    ctx.arc(scLaserEmitter.x, scLaserEmitter.y, (viewMode === 'separator') ? 8 : 4, 0, Math.PI * 2);
    ctx.fill();
    
    // 2. Draw glowing red laser beam and particles
    if (s.beamActive) {
      ctx.strokeStyle = 'rgba(239, 68, 68, 0.7)';
      ctx.lineWidth = (viewMode === 'separator') ? 3 : 1.5;
      ctx.shadowColor = '#ef4444';
      ctx.shadowBlur = 10;
      ctx.beginPath();
      ctx.moveTo(scLaserEmitter.x, scLaserEmitter.y);
      ctx.lineTo(scLaserTarget.x, scLaserTarget.y);
      ctx.stroke();
      
      // Draw glowing dot at target intersection
      ctx.fillStyle = '#ff8787';
      ctx.beginPath();
      ctx.arc(scLaserTarget.x, scLaserTarget.y, (viewMode === 'separator') ? 5 : 2.5, 0, Math.PI*2);
      ctx.fill();
      
      // Update and draw laser dust particles
      dustParticles.forEach(p => {
        p.z -= p.speed * (isPlaying && !isEStop ? simSpeed : 0) * 1.5;
        if (p.z < 0) {
          p.z = 25;
          p.yOffset = Math.random() * 70 - 35;
        }
        p.yOffset += Math.sin(runtime * 0.005 + p.z) * 0.05;
        
        const pY = s.y + p.yOffset * (p.z / 25);
        const pPt = toScreen(s.x, pY, p.z, viewMode);
        
        ctx.fillStyle = `rgba(239, 68, 68, ${p.alpha * 0.75})`;
        ctx.shadowColor = '#ef4444';
        ctx.shadowBlur = 3;
        ctx.beginPath();
        ctx.arc(pPt.x, pPt.y, p.size, 0, Math.PI * 2);
        ctx.fill();
      });
    }
    
    // If scanning animation active
    if (s.cooldown > 0 && s.detectedItem) {
      s.cooldown--;
      // Draw scanning laser cone plane
      const scItem = toScreen(s.detectedItem.x, s.detectedItem.y, s.detectedItem.z, viewMode);
      
      ctx.shadowColor = '#06b6d4';
      ctx.strokeStyle = 'rgba(6, 182, 212, 0.8)';
      ctx.fillStyle = 'rgba(6, 182, 212, 0.15)';
      ctx.lineWidth = 2;
      
      ctx.beginPath();
      ctx.moveTo(scLaserEmitter.x, scLaserEmitter.y);
      ctx.lineTo(scItem.x - 12, scItem.y);
      ctx.lineTo(scItem.x + 12, scItem.y);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      
      // Emit scanning sparks/particles
      for (let i = 0; i < 4; i++) {
        const pZ = Math.random() * s.z;
        const pY = s.y + (Math.random() * 24 - 12) * (pZ / s.z);
        const pPt = toScreen(s.x, pY, pZ, viewMode);
        ctx.fillStyle = 'rgba(6, 182, 212, 0.85)';
        ctx.shadowColor = '#06b6d4';
        ctx.shadowBlur = 5;
        ctx.beginPath();
        ctx.arc(pPt.x, pPt.y, 0.8 + Math.random() * 1.2, 0, Math.PI * 2);
        ctx.fill();
      }
      
      if (s.cooldown === 0) {
        s.detectedItem = null;
      }
    }
    
    ctx.restore();
  }

  // --- Clock formatting utility ---
  function formatClockTime(ms) {
    const totalSecs = Math.floor(ms / 1000);
    const hr = String(Math.floor(totalSecs / 3600)).padStart(2, '0');
    const min = String(Math.floor((totalSecs % 3600) / 60)).padStart(2, '0');
    const sec = String(totalSecs % 60).padStart(2, '0');
    const dsec = String(Math.floor((ms % 1000) / 100));
    return `${hr}:${min}:${sec}.${dsec}`;
  }

  // --- The Core Game loop ---
  function loop(timestamp) {
    if (!lastTime) lastTime = timestamp;
    let dt = timestamp - lastTime;
    lastTime = timestamp;
    
    // Limit delta time to prevent physics breaking on background tab wake
    if (dt > 100) dt = 16.66;
    
    // Handle pause states
    if (isPlaying && !isEStop) {
      const activeSpeed = simSpeed;
      runtime += dt * activeSpeed;
      
      // Periodic RPC packet generation for visualizer
      rpcPollTimer -= activeSpeed;
      if (rpcPollTimer <= 0) {
        rpcPollTimer = 80;
        triggerRPCPacket('MPU', 'MCU', 'get_encoder_ticks', '', `[${stats.green * 45}, ${stats.blue * 45}]`);
      }
      
      rpcMotorTimer -= activeSpeed;
      if (rpcMotorTimer <= 0) {
        rpcMotorTimer = 140;
        triggerRPCPacket('MPU', 'MCU', 'set_motor_speeds', `${Math.round(conveyorSpeed * 80)}, ${Math.round(conveyorSpeed * 80)}`);
      }
      
      // Update running clock
      document.getElementById('runtime-clock').textContent = formatClockTime(runtime);
      
      // 1. Spawning system
      if (runtime >= nextSpawnTime) {
        // Spawn item
        const rand = Math.random();
        const type = (rand < greenRatio) ? 'green' : 'blue';
        items.push(new Item(type));
        
        // Calculate next spawn
        nextSpawnTime = runtime + spawnInterval;
      }
      
      // 2. Entity update loops
      items.forEach(item => item.update(dt, activeSpeed));
      updateServoHorn(dt, activeSpeed);
      updateBoxes(dt, activeSpeed);
      updateAMR(dt, activeSpeed);
      
      // Clean up boxed items that have landed
      items = items.filter(item => {
        if (item.state === 'boxed') {
          // If boxed but not yet reached z, let it stay. 
          // If fully in box (z <= -20), filter out from main active rendering lists
          return item.z > -20;
        }
        return true;
      });
    }
    
    // 3. RENDER PHASE
    draw();
    
    requestAnimationFrame(loop);
  }

  // --- Pedestal Control Box ---
  function drawPedestalControlBox(ctx, viewMode) {
    const px = 240;
    const py = 190;
    const pz = -100;
    
    // Draw stand (black steel post)
    const standBot = toScreen(px, py, pz, viewMode);
    const standTop = toScreen(px, py, -20, viewMode);
    
    ctx.save();
    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(standBot.x, standBot.y);
    ctx.lineTo(standTop.x, standTop.y);
    ctx.stroke();
    
    // Base floor flange
    ctx.fillStyle = '#0f172a';
    ctx.beginPath();
    ctx.ellipse(standBot.x, standBot.y, 6, 3, 0, 0, Math.PI*2);
    ctx.fill();
    
    // Beige enclosure box
    const boxSizeX = 14;
    const boxSizeY = 14;
    const boxSizeZ = 20;
    const boxStyle = {
      fillTop: '#fef08a',       // Pale industrial beige
      fillFrontLeft: '#fef08a',
      fillFrontRight: '#ca8a04', // shadow side
      stroke: '#a16207',
      lineWidth: 1
    };
    drawIsoBox(ctx, px - boxSizeX/2, py - boxSizeY/2, -20, boxSizeX, boxSizeY, boxSizeZ, boxStyle);
    
    // Controls on front-left face (visible in isometric)
    const faceSc = toScreen(px, py + boxSizeY/2 + 0.1, -10, viewMode);
    
    // Start (green)
    ctx.fillStyle = '#10b981';
    ctx.beginPath(); ctx.arc(faceSc.x - 3, faceSc.y - 2, 1.5, 0, Math.PI*2); ctx.fill();
    
    // Stop (red)
    ctx.fillStyle = '#ef4444';
    ctx.beginPath(); ctx.arc(faceSc.x + 3, faceSc.y - 2, 1.5, 0, Math.PI*2); ctx.fill();
    
    // Emergency Stop mushroom cap (large red circle on yellow backing)
    ctx.fillStyle = '#eab308';
    ctx.beginPath(); ctx.arc(faceSc.x, faceSc.y + 4, 3, 0, Math.PI*2); ctx.fill();
    ctx.fillStyle = '#ef4444';
    ctx.beginPath(); ctx.arc(faceSc.x, faceSc.y + 4, 2, 0, Math.PI*2); ctx.fill();
    
    ctx.restore();
  }

  // --- Drawing Master Function ---
  function draw() {
    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    if (currentView === 'rpc') {
      drawRPCView();
      return;
    }
    
    // Draw background texture (warehouse wall base color)
    ctx.fillStyle = '#d1d5db';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    // Draw Grid and conveyor frameworks
    drawStaticInfrastructure(ctx, currentView);
    
    // Depth sorting logic:
    // 1. Draw static indicators & lasers
    drawSensors(ctx, currentView);
    
    // Draw pedestal control box in isometric view
    if (currentView === 'isometric') {
      drawPedestalControlBox(ctx, currentView);
    }
    
    // 2. Draw rotating servo horn diverter
    drawServoHorn(ctx, currentView);
        
    // 3. Draw Boxes at the end of conveyors
    drawBox(ctx, 'upper', currentView);
    drawBox(ctx, 'lower', currentView);
    
    // Draw Boxes stored on warehouse rack
    rackSlots.forEach(slot => {
      if (slot.box) {
        const boxSize = 40;
        drawHollowBox(ctx, slot.x - boxSize/2, slot.y - boxSize/2, slot.z, boxSize, boxSize, 30, slot.box.items, slot.box.boxNo, currentView, 0);
      }
    });
    
    // Draw AMR forklift
    drawAMR(ctx, currentView);
    
    // 4. Draw moving Items
    items.forEach(item => item.draw(ctx, currentView));
    
    // 5. Draw overlay scanners / grid specs if HUD Display toggled on
    if (showHUD) {
      drawHUDOverlays();
    }
    
    // Scrubber update - cycle every 2 minutes for demo scrubber representation
    const scrubberPercent = (runtime % 120000) / 120000 * 100;
    document.getElementById('sim-scrubber-progress').style.width = `${scrubberPercent}%`;
    document.getElementById('sim-scrubber-handle').style.left = `${scrubberPercent}%`;
  }

  function drawRoundRect(x, y, w, h, r, fill = true, stroke = true) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
    if (fill) ctx.fill();
    if (stroke) ctx.stroke();
  }

  function drawRPCView() {
    // 1. Draw sleek dark-blue circuit board background
    ctx.fillStyle = '#0f172a'; // Deep dark slate/blue
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    // Draw grid circuit tracks
    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 1.5;
    for (let i = 0; i < canvas.width; i += 60) {
      ctx.beginPath();
      ctx.moveTo(i, 0);
      ctx.lineTo(i, canvas.height);
      ctx.stroke();
    }
    for (let j = 0; j < canvas.height; j += 60) {
      ctx.beginPath();
      ctx.moveTo(0, j);
      ctx.lineTo(canvas.width, j);
      ctx.stroke();
    }
    
    // Draw some stylized neon-green circuit tracks
    ctx.strokeStyle = 'rgba(16, 185, 129, 0.15)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(100, 100); ctx.lineTo(200, 100); ctx.lineTo(250, 150);
    ctx.moveTo(700, 80); ctx.lineTo(800, 80); ctx.lineTo(850, 130);
    ctx.moveTo(50, 300); ctx.lineTo(150, 300); ctx.lineTo(180, 270);
    ctx.stroke();
    
    // 2. Draw Qualcomm MPU on the Left
    const mpuX = 140, mpuY = 40, mpuW = 180, mpuH = 180;
    
    // Outer shadow / glow
    ctx.shadowColor = 'rgba(56, 189, 248, 0.3)';
    ctx.shadowBlur = 15;
    
    // Chip Body
    ctx.fillStyle = '#1e293b';
    ctx.strokeStyle = '#38bdf8'; // Cyan border
    ctx.lineWidth = 3;
    drawRoundRect(mpuX, mpuY, mpuW, mpuH, 10, true, true);
    
    // Reset shadow
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    
    // Pin details
    ctx.fillStyle = '#94a3b8';
    for (let i = 15; i < mpuH - 10; i += 20) {
      ctx.fillRect(mpuX - 8, mpuY + i, 8, 4); // Left pins
      ctx.fillRect(mpuX + mpuW, mpuY + i, 8, 4); // Right pins
    }
    for (let i = 15; i < mpuW - 10; i += 20) {
      ctx.fillRect(mpuX + i, mpuY - 8, 4, 8); // Top pins
      ctx.fillRect(mpuX + i, mpuY + mpuH, 4, 8); // Bottom pins
    }
    
    // Text Labels on MPU
    ctx.fillStyle = '#38bdf8';
    ctx.font = '900 12px var(--font-display)';
    ctx.textAlign = 'center';
    ctx.fillText('QUALCOMM MPU', mpuX + mpuW/2, mpuY + 40);
    ctx.fillText('QRB2210', mpuX + mpuW/2, mpuY + 58);
    
    ctx.fillStyle = '#94a3b8';
    ctx.font = '700 9px var(--font-mono)';
    ctx.fillText('OS: Debian Linux', mpuX + mpuW/2, mpuY + 90);
    ctx.fillText('ROS 2 Jazzy Host', mpuX + mpuW/2, mpuY + 105);
    
    // Draw Daemon sub-box
    ctx.fillStyle = 'rgba(56, 189, 248, 0.1)';
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 1;
    drawRoundRect(mpuX + 15, mpuY + 130, mpuW - 30, 35, 4, true, true);
    ctx.fillStyle = '#38bdf8';
    ctx.font = '600 8px var(--font-mono)';
    ctx.fillText('arduino-router daemon', mpuX + mpuW/2, mpuY + 152);
    
    // 3. Draw STM32 MCU on the Right
    const mcuX = 640, mcuY = 50, mcuW = 160, mcuH = 160;
    
    ctx.shadowColor = 'rgba(52, 211, 153, 0.3)';
    ctx.shadowBlur = 15;
    
    ctx.fillStyle = '#1e293b';
    ctx.strokeStyle = '#34d399'; // Green border
    ctx.lineWidth = 3;
    drawRoundRect(mcuX, mcuY, mcuW, mcuH, 10, true, true);
    
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    
    // Pin details
    ctx.fillStyle = '#94a3b8';
    for (let i = 15; i < mcuH - 10; i += 20) {
      ctx.fillRect(mcuX - 8, mcuY + i, 8, 4);
      ctx.fillRect(mcuX + mcuW, mcuY + i, 8, 4);
    }
    for (let i = 15; i < mcuW - 10; i += 20) {
      ctx.fillRect(mcuX + i, mcuY - 8, 4, 8);
      ctx.fillRect(mcuX + i, mcuY + mcuH, 4, 8);
    }
    
    ctx.fillStyle = '#34d399';
    ctx.font = '900 12px var(--font-display)';
    ctx.fillText('STM32 MCU', mcuX + mcuW/2, mcuY + 38);
    ctx.fillText('STM32U585', mcuX + mcuW/2, mcuY + 56);
    
    ctx.fillStyle = '#94a3b8';
    ctx.font = '700 9px var(--font-mono)';
    ctx.fillText('Core: ARM Cortex-M33', mcuX + mcuW/2, mcuY + 85);
    ctx.fillText('Sketch: Separator HMI', mcuX + mcuW/2, mcuY + 98);
    
    // Draw Bridge Library sub-box
    ctx.fillStyle = 'rgba(52, 211, 153, 0.1)';
    ctx.strokeStyle = '#34d399';
    ctx.lineWidth = 1;
    drawRoundRect(mcuX + 15, mcuY + 115, mcuW - 30, 30, 4, true, true);
    ctx.fillStyle = '#34d399';
    ctx.font = '600 7px var(--font-mono)';
    ctx.fillText('Arduino_RouterBridge', mcuX + mcuW/2, mcuY + 133);
    
    // 4. Draw Interconnect Serial Bus
    const busY1 = 120, busY2 = 140;
    const busStart = mpuX + mpuW;
    const busEnd = mcuX;
    
    ctx.strokeStyle = '#475569';
    ctx.lineWidth = 4;
    
    // Upper wire (MPU -> MCU)
    ctx.beginPath();
    ctx.moveTo(busStart, busY1);
    ctx.lineTo(busEnd, busY1);
    ctx.stroke();
    
    // Lower wire (MCU -> MPU)
    ctx.beginPath();
    ctx.moveTo(busStart, busY2);
    ctx.lineTo(busEnd, busY2);
    ctx.stroke();
    
    // Draw bus arrows/labels
    ctx.fillStyle = '#475569';
    ctx.font = '800 8px var(--font-display)';
    ctx.textAlign = 'center';
    ctx.fillText('HIGH-SPEED SERIAL BUS (UART / 115200 BAUD)', (busStart + busEnd)/2, 105);
    
    // Arrowheads
    ctx.fillStyle = '#475569';
    ctx.beginPath();
    ctx.moveTo(busEnd - 5, busY1 - 4); ctx.lineTo(busEnd, busY1); ctx.lineTo(busEnd - 5, busY1 + 4); ctx.fill();
    ctx.beginPath();
    ctx.moveTo(busStart + 5, busY2 - 4); ctx.lineTo(busStart, busY2); ctx.lineTo(busStart + 5, busY2 + 4); ctx.fill();
    
    // 5. Update and Draw RPC Packets
    rpcPackets.forEach((p, idx) => {
      p.progress += p.speed;
      if (p.progress > 1.0) p.progress = 1.0;
      
      const startX = p.from === 'MPU' ? busStart : busEnd;
      const endX = p.to === 'MPU' ? busStart : busEnd;
      const pX = startX + (endX - startX) * p.progress;
      const pY = p.from === 'MPU' ? busY1 : busY2;
      
      // Draw glowing pulse
      ctx.shadowColor = p.from === 'MPU' ? '#38bdf8' : '#34d399';
      ctx.shadowBlur = 8;
      ctx.fillStyle = p.from === 'MPU' ? '#38bdf8' : '#34d399';
      ctx.beginPath();
      ctx.arc(pX, pY, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.shadowColor = 'transparent';
      
      // Draw flying packet text
      ctx.fillStyle = '#ffffff';
      ctx.font = '600 7px var(--font-mono)';
      ctx.textAlign = 'center';
      const text = p.returnVal ? p.returnVal : p.method;
      ctx.fillText(text, pX, pY - 8);
    });
    
    // Filter out finished packets
    rpcPackets = rpcPackets.filter(p => p.progress < 1.0);
    
    // 6. Draw RPC Console Log Terminal
    const consoleX = 50, consoleY = 245, consoleW = 860, consoleH = 205;
    ctx.fillStyle = '#020617'; // Absolute black
    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 2;
    drawRoundRect(consoleX, consoleY, consoleW, consoleH, 8, true, true);
    
    // Console Header
    ctx.fillStyle = '#1e293b';
    ctx.fillRect(consoleX, consoleY, consoleW, 25);
    ctx.fillStyle = '#94a3b8';
    ctx.font = '700 8px var(--font-display)';
    ctx.textAlign = 'left';
    ctx.fillText('LIVE RPC COMMUNICATION TELEMETRY MONITOR', consoleX + 15, consoleY + 16);
    
    // Draw logs
    ctx.font = '500 10px var(--font-mono)';
    rpcLog.forEach((log, i) => {
      if (log.includes('MPU -> MCU')) {
        ctx.fillStyle = '#38bdf8'; // Blue for Call
      } else {
        ctx.fillStyle = '#34d399'; // Green for Return/Publish
      }
      ctx.fillText(log, consoleX + 15, consoleY + 50 + i * 28);
    });
    
    if (rpcLog.length === 0) {
      ctx.fillStyle = '#64748b';
      ctx.fillText('Waiting for virtual RPC events... (Play simulation to trigger data packets)', consoleX + 15, consoleY + 50);
    }
  }

  function drawHUDOverlays() {
    ctx.save();
    
    // Faint label in upper corner
    ctx.fillStyle = 'rgba(75, 85, 99, 0.4)';
    ctx.font = '700 8px var(--font-display)';
    ctx.textAlign = 'left';
    ctx.fillText(`PLC STATUS: RUNNING  |  MODE: AUTO`, 15, 20);
    
    // Laser grid scan overlay in viewport if active
    if (sensors.lidar.cooldown > 0) {
      document.getElementById('laser-overlay').classList.add('active');
    } else {
      document.getElementById('laser-overlay').classList.remove('active');
    }
    
    ctx.restore();
  }

  // --- UI Event Handlers & Control Binding ---
  
  function updateUIState() {
    const playBtn = document.getElementById('play-pause-btn');
    const playIcon = document.getElementById('play-icon');
    const pauseIcon = document.getElementById('pause-icon');
    
    const dot = document.getElementById('system-status-dot');
    const text = document.getElementById('system-status-text');
    
    const lampRun = document.getElementById('lamp-run');
    const lampIdle = document.getElementById('lamp-idle');
    const lampAlarm = document.getElementById('lamp-alarm');
    
    if (isEStop) {
      dot.className = "status-dot pulse red";
      text.textContent = "EMERGENCY HALT";
      lampRun.classList.remove('on');
      lampIdle.classList.remove('on');
      lampAlarm.classList.add('on');
      playIcon.style.display = 'block';
      pauseIcon.style.display = 'none';
      stopMachineHum();
      startEStopSiren();
    } else if (isPlaying) {
      dot.className = "status-dot pulse green";
      text.textContent = "SYSTEM OPERATIONAL";
      lampRun.classList.add('on');
      lampIdle.classList.remove('on');
      lampAlarm.classList.remove('on');
      playIcon.style.display = 'none';
      pauseIcon.style.display = 'block';
      initAudio();
      if (audioCtx && audioCtx.state !== 'suspended') startMachineHum();
      stopEStopSiren();
    } else {
      dot.className = "status-dot yellow";
      text.textContent = "SYSTEM PAUSED";
      lampRun.classList.remove('on');
      lampIdle.classList.add('on');
      lampAlarm.classList.remove('on');
      playIcon.style.display = 'block';
      pauseIcon.style.display = 'none';
      stopMachineHum();
      stopEStopSiren();
    }
  }
  
  // Play/Pause button handler
  document.getElementById('play-pause-btn').addEventListener('click', () => {
    if (isEStop) {
      addLog("Cannot resume: EMERGENCY STOP is active. Press RESET to clear alarms.", "error");
      return;
    }
    isPlaying = !isPlaying;
    updateUIState();
    addLog(isPlaying ? "Simulation playback resumed." : "Simulation playback paused.", isPlaying ? "system" : "warning");
  });
  
  // Step frame button
  document.getElementById('step-frame-btn').addEventListener('click', () => {
    if (isPlaying || isEStop) return;
    // Advance simulation by 50ms manually
    const stepMs = 50;
    runtime += stepMs;
    document.getElementById('runtime-clock').textContent = formatClockTime(runtime);
    
    // Run physics updates
    items.forEach(item => item.update(stepMs, simSpeed));
    updateServoHorn(stepMs, simSpeed);
    updateBoxes(stepMs, simSpeed);
    updateAMR(stepMs, simSpeed);
    
    // filter
    items = items.filter(item => !(item.state === 'boxed' && item.z <= -20));
    
    draw();
    addLog(`Frame advanced +${stepMs}ms.`, "system");
  });
  
  // Speed multiplier
  document.getElementById('speed-multiplier').addEventListener('change', (e) => {
    simSpeed = parseFloat(e.target.value);
    addLog(`Simulation scale speed set to ${simSpeed}x.`, "info");
  });
  
  // Manual green base spawn
  document.getElementById('spawn-green-btn').addEventListener('click', () => {
    if (isEStop) return;
    initAudio();
    items.push(new Item('green', true));
  });
  
  // Manual blue lid spawn
  document.getElementById('spawn-blue-btn').addEventListener('click', () => {
    if (isEStop) return;
    initAudio();
    items.push(new Item('blue', true));
  });
  
  // View Switchers
  const viewButtons = document.querySelectorAll('.view-btn');
  viewButtons.forEach(btn => {
    btn.addEventListener('click', (e) => {
      viewButtons.forEach(b => b.classList.remove('active'));
      e.target.classList.add('active');
      currentView = e.target.dataset.view;
      
      // Reset camera presets based on selection
      if (currentView === 'isometric') {
        camTheta = 0.6;
        camPhi = 0.5;
        camZoom = 0.85;
        camCenterX = 400;
        camCenterY = 150;
        camCenterZ = -15;
      } else if (currentView === 'topdown') {
        camTheta = 0.0;
        camPhi = Math.PI / 2 - 0.01;
        camZoom = 0.9;
        camCenterX = 425;
        camCenterY = 150;
        camCenterZ = -20;
      } else if (currentView === 'separator') {
        camTheta = 0.6;
        camPhi = 0.45;
        camZoom = 1.8;
        camCenterX = 430;
        camCenterY = 150;
        camCenterZ = -10;
      }
      
      addLog(`Camera view switched to: ${currentView.toUpperCase()}_VIEW. Drag mouse to rotate, scroll to zoom.`, "system");
    });
  });
  
  // Toggle HUD Display
  document.getElementById('toggle-hud').addEventListener('click', (e) => {
    showHUD = !showHUD;
    e.target.classList.toggle('active');
    addLog(`Diagnostics HMI vector grid overlay ${showHUD ? 'ENABLED' : 'DISABLED'}.`, "info");
  });
  
  // Toggle Diagnostic Event Log
  document.getElementById('toggle-log').addEventListener('click', (e) => {
    const logPanel = document.querySelector('.log-panel');
    const isCollapsed = logPanel.classList.toggle('collapsed');
    e.target.classList.toggle('active', !isCollapsed);
    addLog(`Diagnostic Event Log panel ${isCollapsed ? 'HIDDEN' : 'SHOWN'}.`, "info");
  });
  
  // Configuration inputs
  const cfgSpawn = document.getElementById('cfg-spawn-rate');
  cfgSpawn.addEventListener('input', (e) => {
    const val = parseFloat(e.target.value);
    spawnInterval = val * 1000;
    document.getElementById('val-spawn-rate').textContent = `${val}s`;
  });
  
  const cfgSpeed = document.getElementById('cfg-belt-speed');
  cfgSpeed.addEventListener('input', (e) => {
    const val = parseFloat(e.target.value);
    conveyorSpeed = val;
    document.getElementById('val-belt-speed').textContent = `${val.toFixed(1)} m/s`;
  });
  
  const cfgRatio = document.getElementById('cfg-item-ratio');
  cfgRatio.addEventListener('input', (e) => {
    const val = parseInt(e.target.value);
    greenRatio = val / 100;
    document.getElementById('val-item-ratio').textContent = `${val}%`;
  });
  
  // Cabinet physical buttons binding
  document.getElementById('cab-start').addEventListener('click', () => {
    if (isEStop) {
      addLog("Cannot start: EMERGENCY STOP is active. Pull E-Stop or RESET cabinet.", "error");
      return;
    }
    if (!isPlaying) {
      isPlaying = true;
      updateUIState();
      addLog("PLC cycle started. Motor contactors closed.", "success");
    }
  });
  
  document.getElementById('cab-stop').addEventListener('click', () => {
    if (isPlaying) {
      isPlaying = false;
      updateUIState();
      addLog("PLC cycle stopped. Motor deceleration sequence triggered.", "warning");
    }
  });
  
  document.getElementById('cab-reset').addEventListener('click', () => {
    // Clear elements
    items = [];
    isEStop = false;
    isPlaying = true;
    runtime = 0;
    nextSpawnTime = 0;
    
    // Clear stats
    stats = { green: 0, blue: 0, total: 0, divertSuccess: 0, divertAttempt: 0 };
    document.getElementById('stats-green').textContent = "0000";
    document.getElementById('stats-blue').textContent = "0000";
    document.getElementById('stats-total').textContent = "0000";
    document.getElementById('stats-efficiency').textContent = "100%";
    
    // Clear boxes
    boxes.upper = { lane: 'upper', items: [], x: 780, y: 134, z: -20, state: 'filling', progress: 0, boxNo: 1, joltTimer: 0 };
    boxes.lower = { lane: 'lower', items: [], x: 780, y: 166, z: -20, state: 'filling', progress: 0, boxNo: 1, joltTimer: 0 };
    
    // Clear servo horn state
    servoHorn.angle = 0;
    servoHorn.targetAngle = 0;
    
    // Reset readout
    const readout = document.getElementById('sensor-readout-val');
    readout.textContent = "NO OBJECT";
    readout.className = "sensor-value idle";
    
    updateUIState();
    addLog("System reset complete. Registers cleared. Alarms acknowledged.", "success");
  });
  
  document.getElementById('cab-estop').addEventListener('click', () => {
    isEStop = true;
    isPlaying = false;
    updateUIState();
    addLog("CRITICAL: EMERGENCY STOP TRIGGERED VIA HMI CABINET BUTTON.", "error");
  });
  
  // Fullscreen support
  document.getElementById('fullscreen-btn').addEventListener('click', () => {
    const vc = document.querySelector('.video-container');
    if (!document.fullscreenElement) {
      vc.requestFullscreen().catch(err => {
        console.error("Error enabling fullscreen: ", err);
      });
    } else {
      document.exitFullscreen();
    }
  });

  // Dynamic Camera Drag-to-Rotate & Scroll-to-Zoom Event Handlers
  let isDragging = false;
  let prevMouseX = 0;
  let prevMouseY = 0;
  
  canvas.addEventListener('mousedown', (e) => {
    if (currentView === 'rpc') return;
    isDragging = true;
    prevMouseX = e.clientX;
    prevMouseY = e.clientY;
  });
  
  window.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    const deltaX = e.clientX - prevMouseX;
    const deltaY = e.clientY - prevMouseY;
    
    // Adjust camera angles
    camTheta -= deltaX * 0.007;
    camPhi = Math.max(0.05, Math.min(Math.PI / 2 - 0.02, camPhi - deltaY * 0.005));
    
    prevMouseX = e.clientX;
    prevMouseY = e.clientY;
  });
  
  window.addEventListener('mouseup', () => {
    isDragging = false;
  });
  
  canvas.addEventListener('wheel', (e) => {
    if (currentView === 'rpc') return;
    e.preventDefault();
    camZoom = Math.max(0.3, Math.min(4.0, camZoom - e.deltaY * 0.001));
  }, { passive: false });

  // Audio Context unlock for Chrome
  window.addEventListener('click', () => {
    initAudio();
  }, { once: true });

  // Start loop
  nextSpawnTime = runtime + 500; // spawn first item quickly
  updateUIState();
  requestAnimationFrame(loop);
  
})();
