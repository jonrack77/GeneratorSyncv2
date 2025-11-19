/* ///////////// TABLE OF CONTENTS /////////////
  Section 1 — File Header & Overview
    1.A Feature summary banner

  Section 2 — Debug Harness
    2.A __setDebugWindow
    2.B logDebug

  Section 3 — Utilities
    3.A clamp / lerp / normAngleRad / deg2rad / rad2deg

  Section 4 — Switch Drag/Rotate Wiring (hit zones)
    4.A Config & globals (switches, sensitivity, knobStates)
    4.B Per-switch wiring & event handlers (setAngle/onMove/onUp)
    4.C angleOf helper

  Section 5 — Simulator Core (IIFE)
    5.A Rated constants (RATED)
    5.B State object (state) + exposure
    5.C Gate setpoint variable (Gate_Setpoint)
    5.D Master start/stop ramps (gateRamp/stopRamp)
    5.E Voltage slew params (KV_* constants)
    5.F Angle watch thresholds & maps (THRESH/WATCH/prevAngles)
    5.G setFlag86
    5.H handleAction (all operator actions)
    5.I watchAngles
    5.J updateGateSet (Knob_65)
    5.K updateVoltageSet (Knob_90)
    5.L updateSyncCheck (sync permissive)
    5.M updatePhysics (governor/AVR/power)
    5.N slewGenKV (kV tracker)
    5.O Syncroscope & Lamps
        5.O.1 SYNC struct
        5.O.2 parseRotateCenter
        5.O.3 initSyncUI
        5.O.4 updateSyncScopeAndLamps
    5.P Glow helpers (setGlow / setGlowWhite)
    5.Q updateGlows
    5.R updateGateGauge
    5.S Hz needle binding (IIFE)
    5.T updateKVgauge
    5.U fmtNoLeadingZeros
    5.V updateDigitals
    5.W Main tick loop (requestAnimationFrame)
    5.X Oscilloscope (Bus & Gen waveforms)

  Section 6 — RPM Text Binding (IIFE)
/////////////////////////////////////////// */

/* ///////////// Section 1 — File Header & Overview ///////////// */
/* ///////////// Section 1.A Feature summary banner ///////////// */
/* Sim_8.js
   Complete build with:
   - Switch drag wiring
   - Start/Stop ramps + 86G trip/reset w/ flag color
   - Gate nudge (Knob_65)
   - Speed permissive
   - Sync-check permissive (±3% V, ±0.15 Hz, <10°)
   - Gen kV model + gauge (GenVolts_Rotation: 36°=0, 180°=13, 324°=15)
   - Manual voltage (Knob_90); AVR only acts after 52G closes
   - Digital readouts: Value_MW / Value_AMPS / Value_MVAR / Value_PowerFactor
   - Hz needle + RPM text
   - Status/permissive glows
   - Syncroscope needle (SyncScope_Rotation) and TWO sync lamps
     Lamps brightness ∝ |Vg∠θg − Vb∠θb|; both lamps identical behavior
*/

/* ///////////// Section 2 — Debug Harness ///////////// */
/* ///////////// Section 2.A __setDebugWindow ///////////// */
let __DEBUG_WIN = null;
function __setDebugWindow(win){ __DEBUG_WIN = win; }

/* ///////////// Section 2.B logDebug ///////////// */
function logDebug(message){
  try {
    try { console.log(message); } catch(_) {}
    const el = document.getElementById('Debug_Log');
    if (el){
      if (typeof el.value === 'string'){
        el.value += (el.value ? "\n" : "") + String(message);
      } else {
        el.textContent = (el.textContent ? el.textContent + "\n" : "") + String(message);
      }
    }
    if(__DEBUG_WIN && !__DEBUG_WIN.closed){
      __DEBUG_WIN.postMessage(String(message), '*');
    }
  } catch(_) {}
}

/* ///////////// Section 3 — Utilities ///////////// */
/* ///////////// Section 3.A clamp / lerp / normAngleRad / deg2rad / rad2deg ///////////// */
function clamp(v, lo, hi){ return Math.max(lo, Math.min(hi, v)); }
function lerp(a,b,t){ return a + (b - a) * t; }
function normAngleRad(a){
  // normalize to (-π, +π]
  a = ((a + Math.PI) % (2*Math.PI) + 2*Math.PI) % (2*Math.PI) - Math.PI;
  return a;
}
function deg2rad(d){ return d * Math.PI / 180; }
function rad2deg(r){ return r * 180 / Math.PI; }

/* ///////////// Section 4 — Switch Drag/Rotate Wiring (hit zones) ///////////// */
/* ///////////// Section 4.A Config & globals (switches, sensitivity, knobStates) ///////////// */
const switches = [
  { parentId:'52G_Switch',   knobId:'Knob_52G',   upperHitId:'Hit_52G_Upper',   lowerHitId:'Hit_52G_Lower',   type:'momentary', minAngle:-45, maxAngle:45 },
  { parentId:'41_Switch',    knobId:'Knob_41',    upperHitId:'Hit_41_Upper',    lowerHitId:'Hit_41_Lower',    type:'momentary', minAngle:-45, maxAngle:45 },
  { parentId:'86G_Switch',   knobId:'Knob_86G',   upperHitId:'Hit_86G_Upper',   lowerHitId:'Hit_86G_Lower',   type:'latching',  minAngle:-45, maxAngle:0  },
  { parentId:'AVR_Switch',   knobId:'Knob_AVR',   upperHitId:'Hit_AVR_Upper',   lowerHitId:'Hit_AVR_Lower',   type:'latching',  minAngle:-45, maxAngle:45 },
  { parentId:'Sync_Switch',  knobId:'Knob_Sync',  upperHitId:'Hit_Sync_Upper',  lowerHitId:'Hit_Sync_Lower',  type:'latching',  minAngle:-45, maxAngle:45 },
  { parentId:'Master_Switch',knobId:'Knob_Master',upperHitId:'Hit_Master_Upper',lowerHitId:'Hit_Master_Lower',type:'momentary', minAngle:-45, maxAngle:45 },
  { parentId:'65_Switch',    knobId:'Knob_65',    upperHitId:'Hit_65_Upper',    lowerHitId:'Hit_65_Lower',    type:'momentary', minAngle:-45, maxAngle:45 },
  { parentId:'90_Switch',    knobId:'Knob_90',    upperHitId:'Hit_90_Upper',    lowerHitId:'Hit_90_Lower',    type:'momentary', minAngle:-45, maxAngle:45 },
];
const sensitivity = 0.5; // deg per px
const knobStates = {};

/* ///////////// Section 4.B Per-switch wiring & event handlers (setAngle/onMove/onUp) ///////////// */
switches.forEach(cfg => {
  const svg = document.getElementById(cfg.parentId);
  const knob = document.getElementById(cfg.knobId);
  const hitU = document.getElementById(cfg.upperHitId);
  const hitL = document.getElementById(cfg.lowerHitId);
  if (!svg || !knob || !hitU || !hitL) return;

  const bb = svg.getBBox();
  const cx = bb.x + bb.width/2;
  const cy = bb.y + bb.height/2;

  knobStates[cfg.knobId] = { isDragging:false, startX:0, currentAngle:0, centerX:cx, centerY:cy, minAngle:cfg.minAngle, maxAngle:cfg.maxAngle, type:cfg.type };

  function setAngle(knobId, ang){
    knobStates[knobId].currentAngle = ang;
    knob.setAttribute('transform', `rotate(${ang} ${cx} ${cy})`);
  }

  hitU.addEventListener('mousedown', (e)=>{
    e.preventDefault();
    knobStates[cfg.knobId].isDragging = true;
    knobStates[cfg.knobId].startX = e.clientX;
    document.addEventListener('mousemove', onMoveU);
    document.addEventListener('mouseup', onUp);
  });
  function onMoveU(e){
    if(!knobStates[cfg.knobId].isDragging) return;
    const dx = e.clientX - knobStates[cfg.knobId].startX;
    const ang = clamp(dx * sensitivity, cfg.minAngle, cfg.maxAngle);
    setAngle(cfg.knobId, ang);
  }

  hitL.addEventListener('mousedown', (e)=>{
    e.preventDefault();
    knobStates[cfg.knobId].isDragging = true;
    knobStates[cfg.knobId].startX = e.clientX;
    document.addEventListener('mousemove', onMoveL);
    document.addEventListener('mouseup', onUp);
  });
  function onMoveL(e){
    if(!knobStates[cfg.knobId].isDragging) return;
    const dx = e.clientX - knobStates[cfg.knobId].startX;
    const ang = clamp(-dx * sensitivity, cfg.minAngle, cfg.maxAngle);
    setAngle(cfg.knobId, ang);
  }

  function onUp(){
  if(!knobStates[cfg.knobId].isDragging) return;
  knobStates[cfg.knobId].isDragging = false;

  // Improved: allow special return angle if defined
  if (cfg.type === 'momentary') {
    const returnAngle = (knobStates[cfg.knobId].momentaryReturnAngle != null)
      ? knobStates[cfg.knobId].momentaryReturnAngle
      : 0;
    setAngle(cfg.knobId, returnAngle);
  }

  document.removeEventListener('mousemove', onMoveU);
  document.removeEventListener('mousemove', onMoveL);
  document.removeEventListener('mouseup', onUp);
}

});

/* ///////////// Section 4.C angleOf helper ///////////// */
function angleOf(id){
  try{
    if (knobStates[id] && typeof knobStates[id].currentAngle === 'number') return knobStates[id].currentAngle;
  }catch(_){}
  const el = document.getElementById(id);
  if(!el) return 0;
  const t = el.getAttribute('transform') || '';
  const m = t.match(/rotate\(([-\d.]+)/);
  return m ? parseFloat(m[1]) : 0;
}

/* ///////////// Section 5 — Simulator Core (IIFE) ///////////// */
(function(){
  /* ///////////// Section 5.A Rated constants (RATED) ///////////// */
  const RATED = {
    KV_LL: 13.8,            // kV line-line nominal
    MVA:   25,              // MVA rating
    MW:    23.5,            // continuous MW
    MVAR_LAG_MAX: 15.5,     // +Q
    MVAR_LEAD_MAX: 19.4,    // -Q
    AMPS:  1046.9           // at 13.8kV
  };

  /* ///////////// Section 5.B State object (state) + exposure ///////////// */
const state = {
  Master_Started:false,
  AVR_On:false,
  Sync_On:false,

  // NEW: Latches TRUE when 52G closes; does NOT auto-unlatch on open
  GeneratorOnline:false,

  '41_Brk_Var':false,     // field breaker
  '52G_Brk_Var':false,    // gen breaker (FALSE=open, TRUE=closed)
  '86G_Trip_Var':false,

  Gate_Pos_Var:0,         // %
  Gen_Freq_Var:0,         // Hz
  Gen_RPM_Var:0,          // calc

  Speed_Perm_Var:false,
  SyncCheck_Perm_Var:false,

  // Bus references
  Bus_Freq_Hz:60,
  Bus_Voltage_kV:13.8,

  // Voltage model
  Gen_kV_Var:0,           // actual terminal kV “inside the 52G”
  Gen_kV_SP:13.5,         // operator/AVR setpoint (kV)

  // Power model
  MW:0,
  MVAR:0,
  AMPS:0,
  PF:0
};
try{ window.SimState = state; }catch(_){}


  /* ///////////// Section 5.C Gate setpoint variable (Gate_Setpoint) ///////////// */
  let Gate_Setpoint = 0;

  /* ///////////// Section 5.D Master start/stop ramps (gateRamp/stopRamp) ///////////// */
  const gateRamp = { active:false, from:0, to:19.83, dur:3000, t0:0 };
  const stopRamp = { active:false, from:0, to:0,     dur:2000, t0:0 }; // ramp-to-zero on STOP

 /* ///////////// Section 5.E Voltage slew params (KV_* constants) ///////////// */
const KV_SLEW_MANUAL = 2;     // kV/s tracking rate to SP (manual)
const KV_SLEW_AUTO   = 1.2;   // kV/s when AVR is acting
const KV_MIN = 0.0, KV_MAX = 16.0;

/* Frequency tuning (single-mode) */
const FREQ_PER_GATE   = 3;   // Hz per % gate when rising
const FREQ_DECEL_HZ_S = 3;   // fixed fall rate (Hz/s) when raw < current

// AVR line-drop compensation (disabled if 0)
const AVR_LDC_PU = 0.00;

// Manual (AVR OFF) droop: pu kV sag per 1.0 pu stator current
const MANUAL_DROOP_PU = 0.12;   // try 0.08–0.15
const MANUAL_Q_GAIN   = 0.0;    // extra sag for lagging vars (0..1)

// Power mapping: physical gate needed for ~0 MW when paralleled
const NO_LOAD_GATE_PCT = 20;    // set near your sync gate (e.g., 18–20)
const REV_PWR_LIMIT_MW = -5;  // cap reverse power (negative)

// Manual-close PF/MW targets (used when AVR is OFF, at 52G close)
const CLOSE_REV_PWR_TARGET_MW = -0.01;
const CLOSE_PF_TARGET         = -0.95;

// Small manual kV bias at close (optional)
const MANUAL_CLOSE_V_BIAS_KV  = 12.5;

// Reactive gain shaping (keeps vars small near zero load)
const Q_GAIN_MIN     = 2.0;     // MVAR per kV near zero-load
const Q_GAIN_MAX     = 30.0;    // MVAR per kV at high load
const Q_GAIN_SHAPE_N = 1.0;     // 1=linear

// ---------- Loss Of Excitation (41 OPEN while 52G CLOSED) tunables ----------
const LOE_REV_PWR_MW       = -0.4;  // small reverse MW on field loss
const LOE_Q_IMPORT_MVAR    = 15.0;  // inductive vars imported on field loss (+ = lagging)
const LOE_SETTLE_MS        = 250;   // time constant to settle MW/Q to targets








  /* ///////////// Section 5.F Angle watch thresholds & maps (THRESH/WATCH/prevAngles) ///////////// */
const THRESH = { up:20, down:-20 };
const WATCH = [
  { knobIds:['Knob_Master'], upper:'MASTER_START', lower:'MASTER_STOP' },
  { knobIds:['Knob_AVR'],    upper:'AVR_ON',       lower:'AVR_OFF'    },
  { knobIds:['Knob_Sync'],   upper:'SYNC_ON',      lower:'SYNC_OFF'   },
  { knobIds:['Knob_41'],     upper:'41_CLOSE',     lower:'41_OPEN'    },
  { knobIds:['Knob_52G'],    upper:'52G_CLOSE',    lower:'52G_OPEN'   },
  { knobIds:['Knob_86G','Knob_86'], special:'86G' },
];
const prevAngles = Object.create(null);

/* ///////////// Section 5.G setFlag86 (REPLACE this section) ///////////// */
function setFlag86(){
  try{
    const el = document.getElementById('Flag_86G');
    if (!el) return;

    const k = (typeof knobStates !== 'undefined') ? knobStates['Knob_86G'] : null;
    const angle = (k && typeof k.currentAngle === 'number') ? k.currentAngle : 0;

    // < -44° = dark orange; > -1° = default color
    el.style.fill = (angle < -44) ? '#CD5A00' : '';
  }catch(_){}
}

 /* ///////////// Section 5.H handleAction (all operator actions) ///////////// */
function handleAction(tag){
  switch(tag){
    /* ---- Syncroscope switch ---- */
    case 'SYNC_ON':
      if (!state.Sync_On){ state.Sync_On = true; try { logDebug('SYNCROSCOPE: ON'); } catch(_){} }
      break;
    case 'SYNC_OFF':
      if (state.Sync_On){ state.Sync_On = false; try { logDebug('SYNCROSCOPE: OFF'); } catch(_){} }
      break;

    /* ---- AVR switch ---- */
    case 'AVR_ON':
      if (!state.AVR_On){ state.AVR_On = true; try { logDebug('AVR: AUTO'); } catch(_){} }
      break;
    case 'AVR_OFF':
      if (state.AVR_On){ state.AVR_On = false; try { logDebug('AVR: MANUAL'); } catch(_){} }
      break;

    /* ---- Master ---- */
    case 'MASTER_START': {
      // 86G knob permissive + not tripped
      const k86   = (typeof knobStates !== 'undefined') ? knobStates['Knob_86G'] : null;
      const ang86 = (k86 && typeof k86.currentAngle === 'number') ? k86.currentAngle : 0;
      if (ang86 <= -1){ try{ logDebug('Master: BLOCKED (86G Permissive)'); }catch(_){ } break; }
      if (state['86G_Trip_Var']){ try{ logDebug('Master: BLOCKED (86G Tripped)'); }catch(_){ } break; }

      // prevent double staging
      if (state.__prestartBusy) break;
      state.__prestartBusy = true;
      if (!Array.isArray(state.__prestartTimers)) state.__prestartTimers = [];
      const T  = state.__prestartTimers;
      const at = (ms, fn) => T.push(setTimeout(fn, ms));

      try{ logDebug('Master: START'); }catch(_){}

      // +1.0s — permissives
      at(1000, () => {
        const perm52 = !state['52G_Brk_Var'];
        if (perm52) try{ logDebug('52G Permissive OK'); }catch(_){}
        const k86s   = knobStates?.['Knob_86G'];
        const ang86s = (k86s && typeof k86s.currentAngle === 'number') ? k86s.currentAngle : 0;
        if (ang86s > -1) try{ logDebug('86G Permissive OK'); }catch(_){}
      });

      // +2.0s — lift pump
      at(2000, () => { try{ logDebug('Lift Pump On'); }catch(_){}; });

      // +4.0s — pressure ok
      at(4000, () => { try{ logDebug('Lift Pump Pressure OK'); }catch(_){}; });

      // +5.0s — brakes release
      at(5000, () => { try{ logDebug('Brakes Released'); }catch(_){}; });

      // +5.1s — handoff to normal start
      at(5100, () => {
        const k86f = knobStates?.['Knob_86G'];
        const ang86f = (k86f && typeof k86f.currentAngle === 'number') ? k86f.currentAngle : 0;
        const ok86   = (ang86f > -1) && !state['86G_Trip_Var'];
        if (!ok86){ state.__prestartBusy = false; return; }

        if (!state.Master_Started){
          state.Master_Started = true;
          stopRamp.active = false;
          gateRamp.active = true;
          gateRamp.from = (typeof Gate_Setpoint === 'number') ? Gate_Setpoint : 0;
          gateRamp.to   = 19.83;
          gateRamp.dur  = 3000;
          gateRamp.t0   = performance.now();
        }

        state.__prestartBusy = false;
        while (T.length) clearTimeout(T.pop());
      });

      break;
    }

    case 'MASTER_STOP': {
      try{ logDebug('Master: STOP'); }catch(_){}
      // cancel any staged start sequence
      state.__prestartBusy = false;
      if (Array.isArray(state.__prestartTimers)) {
        while (state.__prestartTimers.length) clearTimeout(state.__prestartTimers.pop());
      }
      // start STOP ramp
      gateRamp.active = false;
      stopRamp.active = true;
      stopRamp.from = (typeof Gate_Setpoint === 'number') ? Gate_Setpoint : 0;
      stopRamp.to   = 0;
      stopRamp.dur  = 2000;
      stopRamp.t0   = performance.now();
      break;
    }

    /* ---- 41 Field breaker ---- */
    case '41_CLOSE':
      if(!state['41_Brk_Var']){
        if (state.Speed_Perm_Var){
          state['41_Brk_Var'] = true;
          try{ logDebug('Field Breaker: CLOSED'); }catch(_){}
          if (state['52G_Brk_Var'] && state.AVR_On){
            state.Gen_kV_SP  = 13.8;
            state.Gen_kV_Var = state.Gen_kV_SP;
          } else {
            state.Gen_kV_SP  = 13.65;
            state.Gen_kV_Var = state.Gen_kV_SP;
          }
        } else {
          try{ logDebug('41: BLOCKED'); }catch(_){}
        }
      }
      break;

    case '41_OPEN':
      if(state['41_Brk_Var']){
        state['41_Brk_Var'] = false;
        try{ logDebug('Field Breaker: OPEN'); }catch(_){}
      }
      break;

    /* ---- 52G Generator breaker ---- */
    case '52G_CLOSE':
      if(!state['52G_Brk_Var']){
        if (state.SyncCheck_Perm_Var){
          state['52G_Brk_Var'] = true;
          try{ logDebug('52G: CLOSED'); }catch(_){}

          // Latch "online" (no auto-unlatch)
          if (!state.GeneratorOnline){
            state.GeneratorOnline = true;
            try { logDebug('Unit Online'); } catch(_){}
          }

          // No-load calibration at close
          (function(){
            const slope = 100 / Math.max(1e-3, (100 - NO_LOAD_GATE_PCT));
            const MWpu  = (CLOSE_REV_PWR_TARGET_MW) / (RATED.MW || 1);
            const effNeededPct = (MWpu * 100) / slope; // negative for reverse
            state.NoLoadGateCal = clamp(state.Gate_Pos_Var - effNeededPct, 0, 100);
          })();

          if (state.AVR_On){
            state.Gen_kV_SP  = 13.8;
            state.Gen_kV_Var = state.Gen_kV_SP;
          } else {
            // manual bias at close
            const S    = (RATED.MVA || 1);
            const pAbs = Math.abs(CLOSE_REV_PWR_TARGET_MW);
            const qAbs = Math.sqrt(Math.max(0, S*S - pAbs*pAbs));
            const qTarget = (CLOSE_PF_TARGET < 0 ? -qAbs : qAbs);
            const qGainClose = Q_GAIN_MIN;
            let dvBias = (qGainClose > 1e-6) ? (qTarget / qGainClose) : 0;
            dvBias = clamp(dvBias + MANUAL_CLOSE_V_BIAS_KV, -0.5, 0.5);
            state.Gen_kV_SP  = Math.max(0, (+state.Gen_kV_SP || 0) + dvBias);
            state.Gen_kV_Var = state.Gen_kV_SP;
          }
        }
      }
      break;

    case '52G_OPEN':
      if(state['52G_Brk_Var']){
        state['52G_Brk_Var'] = false;
        delete state.NoLoadGateCal;
        try{ logDebug('52G: OPEN'); }catch(_){}
      }
      break;

    /* ---- 86G Lockout ---- */
    case '86G_TRIP':
      if(!state['86G_Trip_Var']){
        state['86G_Trip_Var'] = true;
        setFlag86(true);
        if(state['41_Brk_Var']){ state['41_Brk_Var'] = false; try{ logDebug('41: TRIPPED'); }catch(_){} }
        if(state['52G_Brk_Var']){ state['52G_Brk_Var'] = false; try{ logDebug('52G: TRIPPED'); }catch(_){} }
        gateRamp.active = false;
        stopRamp.active = true;
        stopRamp.from = (typeof Gate_Setpoint === 'number') ? Gate_Setpoint : 0;
        stopRamp.to   = 0;
        stopRamp.dur  = 5000;
        stopRamp.t0   = performance.now();
        try{ logDebug('86G: TRIP'); }catch(_){}
      }
      break;

    case '86G_RESET':
      if(state['86G_Trip_Var']){
        state['86G_Trip_Var'] = false;
        setFlag86(false);
        try{ logDebug('86G: RESET'); }catch(_){}
      }
      break;
  }
}



/* ///////////// Section 5.H.1 Enforce 86G Permissive on MASTER_START (add-on) ///////////// */
/* Place this AFTER Section 5.H (so handleAction exists). */
(function Enforce86GPermOnStart(){
  const S = window.SimState || window.state || (window.state = {});
  const _old = window.handleAction;

  function readKnob86Angle(){
    // preferred: knobStates cache
    const ks = (window.knobStates && window.knobStates['Knob_86G']) || null;
    if (ks && typeof ks.currentAngle === 'number') return ks.currentAngle;

    // fallback: parse DOM transform
    const el = document.getElementById('Knob_86G');
    if (el){
      const tr = el.getAttribute('transform') || '';
      const m = tr.match(/rotate\((-?\d+(?:\.\d+)?)/i);
      if (m) return parseFloat(m[1]);
    }
    return 0; // default safe
  }

  function get86GPermissive(){
    const ang = readKnob86Angle();
    const perm = (ang > -1);     // same threshold used for Glow_Perm_86G
    S['86G_Perm_Var'] = perm;    // keep a state bit for reuse
    return perm;
  }

  window.handleAction = function(tag){
    if (tag === 'MASTER_START'){
      // Block if 86G knob not in NORMAL or lockout is tripped
      const perm86 = get86GPermissive();
      if (!perm86){
        try{ logDebug('Master: BLOCKED (86G Permissive)'); }catch(_){}
        return;
      }
      if (S['86G_Trip_Var'] === true){
        try{ logDebug('Master: BLOCKED (86G Tripped)'); }catch(_){}
        return;
      }
    }
    return _old ? _old.apply(this, arguments) : undefined;
  };
})();


/* ///////////// Section 5.H.2 AVR takeover harmonizer (non-invasive) ///////////// */
(function AVRTakeoverHarmonizer(){
  if (typeof window === 'undefined') return;
  const origHandle = (typeof window.handleAction === 'function') ? window.handleAction : null;
  if (!origHandle) return;

  window.handleAction = function(tag){
    // Pre-transition context
    const wasAVR = !!(state && state.AVR_On);

    // On enabling AVR while paralleled, freeze SP to the present terminal kV
    if (tag === 'AVR_ON' && !wasAVR && state && state['52G_Brk_Var']) {
      const kv = +state.Gen_kV_Var || 0;
      if (typeof clamp === 'function') {
        state.Gen_kV_SP = clamp(kv, KV_MIN, KV_MAX);
      } else {
        state.Gen_kV_SP = Math.min(KV_MAX, Math.max(KV_MIN, kv));
      }
      
    }

    // On disabling AVR while field or tie is live, freeze SP to current kV
    if (tag === 'AVR_OFF' && wasAVR && state && (state['41_Brk_Var'] || state['52G_Brk_Var'])) {
      const kv = Math.max(0, +state.Gen_kV_Var || 0);
      state.Gen_kV_SP = kv; // manual mode allows up to current value (upper bound handled elsewhere)
      
    }

    // Delegate to original action handler
    return origHandle.call(this, tag);
  };
})();




  /* ///////////// Section 5.I watchAngles ///////////// */
  function watchAngles(){
    for(const w of WATCH){
      let ang = null;
      for(const id of w.knobIds){
        const a = angleOf(id);
        if(a !== 0 || document.getElementById(id)){ ang = a; break; }
      }
      if(ang === null) continue;
      const key = w.knobIds[0];
      const prev = prevAngles[key] ?? ang;

      if (w.special === '86G'){
  const T = -1; // degrees
  const hadPrev = Object.prototype.hasOwnProperty.call(prevAngles, key);

  if (!hadPrev){
    // First run: align state to current knob position
    if (ang <= T) { handleAction('86G_TRIP'); }
    else          { handleAction('86G_RESET'); }
  } else {
    // Subsequent frames: edge-detect crossings
    if (prev > T && ang <= T) handleAction('86G_TRIP');
    if (prev <= T && ang > T) handleAction('86G_RESET');
  }
} else {
  if (prev < THRESH.up   && ang >= THRESH.up)   handleAction(w.upper);
  if (prev > THRESH.down && ang <= THRESH.down) handleAction(w.lower);
}
      prevAngles[key] = ang;
    }
  }

  /* ///////////// Section 5.J updateGateSet (Knob_65) ///////////// */
  function updateGateSet(){
    const NUDGE_THRESH = 20;            // degrees
    const NUDGE_RATE_OPEN   = 0.125;    // %/s when 52G OPEN
    const NUDGE_RATE_CLOSED = 10;       // %/s when 52G CLOSED
    const NUDGE_RATE = state['52G_Brk_Var'] ? NUDGE_RATE_CLOSED : NUDGE_RATE_OPEN;

    const now = performance.now();
    if (typeof updateGateSet._tPrev !== 'number') updateGateSet._tPrev = now;
    const dt = Math.min(150, now - updateGateSet._tPrev) / 1000;
    updateGateSet._tPrev = now;

    const a65 = angleOf('Knob_65') || 0;

    if (a65 >= NUDGE_THRESH){
  Gate_Setpoint = Math.min(100, Gate_Setpoint + NUDGE_RATE * dt);
  if (updateGateSet._lastLog == null || Math.abs(Gate_Setpoint - updateGateSet._lastLog) >= 0.5){
    updateGateSet._lastLog = Gate_Setpoint;
  }
} else if (a65 <= -NUDGE_THRESH){
  Gate_Setpoint = Math.max(0, Gate_Setpoint - NUDGE_RATE * dt);
  if (updateGateSet._lastLog == null || Math.abs(Gate_Setpoint - updateGateSet._lastLog) >= 0.5){
    updateGateSet._lastLog = Gate_Setpoint;
      }
    }
  }

  /* ///////////// Section 5.K updateVoltageSet (Knob_90) ///////////// */
function updateVoltageSet(){
  const TH = 20; // deg threshold
  const now = performance.now();
  if (typeof updateVoltageSet._tPrev !== 'number') updateVoltageSet._tPrev = now;
  const dt = Math.min(150, now - updateVoltageSet._tPrev) / 1000;
  updateVoltageSet._tPrev = now;

  const a90 = angleOf('Knob_90') || 0;
  const NU = 0.01;                         // sensitivity
  const RATE = NU * (KV_MAX - KV_MIN);     // kV/s equivalent

  if (a90 >= TH){
    state.Gen_kV_SP = state.AVR_On
      ? clamp(state.Gen_kV_SP + RATE*dt, KV_MIN, KV_MAX)
      : Math.max(0, state.Gen_kV_SP + RATE*dt);   // no upper limit when AVR OFF
  } else if (a90 <= -TH){
    state.Gen_kV_SP = state.AVR_On
      ? clamp(state.Gen_kV_SP - RATE*dt, KV_MIN, KV_MAX)
      : Math.max(0, state.Gen_kV_SP - RATE*dt);   // allow down to 0 only
  }
}


  /* ///////////// Section 5.L updateSyncCheck (sync permissive) ///////////// */
function updateSyncCheck(){
  const V_TOL_FRAC = 0.03;  // ±3%
  const F_TOL_HZ   = 0.15;  // ±0.15 Hz
  const PHASE_DEG  = 10.0;  // ±10°

  const snap = PhaseTracker.snap;
  const vb = snap ? snap.vb : (+state.Bus_Voltage_kV || 13.8);
  const vg = snap ? snap.vg : (+state.Gen_kV_Var    || 0);
  const fb = snap ? snap.fb : (+state.Bus_Freq_Hz   || 60);
  const fg = snap ? snap.fg : (+state.Gen_Freq_Var  || 0);
  const ddeg = snap ? snap.dphiDeg : PhaseTracker.deltaDeg();

  const vOK = Math.abs(vg - vb) <= V_TOL_FRAC * vb;
  const fOK = Math.abs(fg - fb) <= F_TOL_HZ;
  const pOK = Math.abs(ddeg)    <= PHASE_DEG;

  const ok = !!(vOK && fOK && pOK);
  if (ok !== state.SyncCheck_Perm_Var){
    state.SyncCheck_Perm_Var = ok;
    
  }
}

/* ///////////// Section 5.M updatePhysics (governor/AVR/power) — REPLACE ENTIRE SECTION ///////////// */
function updatePhysics(){
  if (!state.Master_Started) {
    gateRamp.active = false;
    stopRamp.active = false;

    state.Gen_Freq_Var = 0;
    state.Gen_RPM_Var  = 0;

    const targetKV = state['41_Brk_Var'] ? state.Gen_kV_SP : 0;
    slewGenKV(targetKV, KV_SLEW_MANUAL);

    if (state.Speed_Perm_Var !== false) {
      state.Speed_Perm_Var = false;
    }

    // reset run latch
    updatePhysics._wasRunning = false;

    state.MW = 0; state.MVAR = 0; state.AMPS = 0; state.PF = 0;
    return;
  }

  // Gate setpoint ramps
  if (gateRamp.active){
    const p = clamp((performance.now() - gateRamp.t0) / gateRamp.dur, 0, 1);
    Gate_Setpoint = gateRamp.from + (gateRamp.to - gateRamp.from) * p;
    if (p >= 1){
      gateRamp.active = false;
    }
  } else if (stopRamp.active){
    const p = clamp((performance.now() - stopRamp.t0) / stopRamp.dur, 0, 1);
    Gate_Setpoint = stopRamp.from + (stopRamp.to - stopRamp.from) * p;
    if (p >= 1){
      stopRamp.active = false;
      Gate_Setpoint = 0;
      // do NOT snap gates/freq or clear Master_Started here
    }
  }

  // Governor: actual gate follows setpoint (separate rates for TRIP vs NORMAL)
  const RATE_OPEN_NORMAL    = 5  / 1000; // %/ms (≈5 %/s)     — used when 52G OPEN
  const RATE_CLOSED_NORMAL  = 20 / 1000; // %/ms (≈20 %/s)    — used when 52G CLOSED
  const RATE_OPEN_TRIP      = 20 / 1000; // %/ms (≈20 %/s)    — TRIP ramp when 52G OPEN
  const RATE_CLOSED_TRIP    = 80 / 1000; // %/ms (≈80 %/s)    — TRIP ramp when 52G CLOSED

  const isTripSlew = !!(stopRamp.active && state['86G_Trip_Var']);
  const rate = state['52G_Brk_Var']
    ? (isTripSlew ? RATE_CLOSED_TRIP : RATE_CLOSED_NORMAL)
    : (isTripSlew ? RATE_OPEN_TRIP   : RATE_OPEN_NORMAL);

  const now = performance.now();
  if (typeof updatePhysics._tPrev !== 'number') updatePhysics._tPrev = now;
  const dt = Math.min(100, now - updatePhysics._tPrev);
  updatePhysics._tPrev = now;

  const maxStep = rate * dt;
  const err = Gate_Setpoint - state.Gate_Pos_Var;
  if (Math.abs(err) > maxStep){
    state.Gate_Pos_Var += Math.sign(err) * maxStep;
  } else {
    state.Gate_Pos_Var = Gate_Setpoint;
  }

  // Frequency (single-owner slew): on-grid=60; off-grid rises follow gate; falls decay at fixed rate
  {
    const onGrid = !!state['52G_Brk_Var'];
    const raw    = onGrid ? 60 : (FREQ_PER_GATE * state.Gate_Pos_Var);
    const curr   = +state.Gen_Freq_Var || 0;
    const dt_s   = Math.max(0, dt) / 1000;

    const next   = (raw >= curr) ? raw : Math.max(raw, curr - FREQ_DECEL_HZ_S * dt_s);

    state.Gen_Freq_Var = clamp(next, 0, 94);
    state.Gen_RPM_Var  = state.Gen_Freq_Var * 1.667;
  }

  // Mark as having run (prevents immediate "Unit Stopped" right after Master Start)
  {
    if (state.Master_Started && (state.Gate_Pos_Var > 0.5 || state.Gen_Freq_Var > 0.2)) {
      updatePhysics._wasRunning = true;
    }
  }

  // Latch "Unit Stopped" only when we are actually stopping AND gates ~0 AND frequency ~0 (off-grid)
  {
    const CLOSE_LATCH_EPS = 0.5; // %
    const FREQ_LATCH_EPS  = 0.2; // Hz
    const stoppingIntent  = stopRamp.active || state['86G_Trip_Var'] || !!updatePhysics._wasRunning;

    if (!state['52G_Brk_Var'] &&
        state.Master_Started &&
        stoppingIntent &&
        state.Gate_Pos_Var <= CLOSE_LATCH_EPS &&
        state.Gen_Freq_Var <= FREQ_LATCH_EPS) {
      state.Gate_Pos_Var   = 0;
      state.Master_Started = false;
      stopRamp.active      = false;
      updatePhysics._wasRunning = false;
      logDebug('Unit Stopped');
    }
  }

  // Speed Permissive toggle
  const spNext = !!(state.Master_Started && (state.Gate_Pos_Var > 0) && (state.Gen_RPM_Var > 50));
  if (state.Speed_Perm_Var !== spNext) {
    state.Speed_Perm_Var = spNext;
  }

  // AVR & kV tracking
  const Vbus = state.Bus_Voltage_kV || 13.8;
  if (state['52G_Brk_Var']) {
    if (state.AVR_On){
      let kvTargetSP = state.Gen_kV_SP;
      slewGenKV(kvTargetSP, KV_SLEW_AUTO);
    } else {
      // MANUAL: droop with load
      const Ipu = clamp((state.AMPS || 0) / (RATED.AMPS || 1), 0, 2);
      const Qpu = clamp((state.MVAR || 0) / (RATED.MVAR_LAG_MAX || 1), -1, 1);
      const extra = 1 + MANUAL_Q_GAIN * Math.max(0, Qpu);
      const V_droop = Vbus * MANUAL_DROOP_PU * Ipu * extra;
      const target  = state.Gen_kV_SP - V_droop;
      slewGenKV(target, KV_SLEW_MANUAL);
    }
  } else {
    // Not paralleled: track SP if field on, else decay to 0
    const tgt = state['41_Brk_Var'] ? state.Gen_kV_SP : 0;
    slewGenKV(tgt, KV_SLEW_MANUAL);
  }

  // Power model (with no-load gate offset; does NOT move the gates)
  let MW = 0;
  if (state['52G_Brk_Var']){
    const noLoad = (typeof state.NoLoadGateCal === 'number') ? state.NoLoadGateCal : NO_LOAD_GATE_PCT;
    const effGate = state.Gate_Pos_Var - noLoad;                      // can be negative
    const slope   = 100 / Math.max(1e-3, (100 - NO_LOAD_GATE_PCT));   // keep 100% gate => rated MW
    let MW_pu     = (effGate * slope) / 100;                          // per-unit MW
    const min_pu  = (REV_PWR_LIMIT_MW) / (RATED.MW || 1);
    MW_pu = clamp(MW_pu, min_pu, 1);
    MW = MW_pu * RATED.MW;
  }

  // Reactive power: scale gain with effective gate so MVAR is small at close
  let Q = 0;
  if (state['52G_Brk_Var']){
    const dv = (state.Gen_kV_Var - Vbus); // kV
    const noLoad = (typeof state.NoLoadGateCal === 'number') ? state.NoLoadGateCal : NO_LOAD_GATE_PCT;
    const effGatePU = clamp(
      (state.Gate_Pos_Var - noLoad) / Math.max(1e-3, (100 - NO_LOAD_GATE_PCT)),
      0, 1
    );
    const qGain = Q_GAIN_MIN + (Q_GAIN_MAX - Q_GAIN_MIN) * Math.pow(effGatePU, Q_GAIN_SHAPE_N);
    Q = clamp(dv * qGain, -RATED.MVAR_LEAD_MAX, RATED.MVAR_LAG_MAX);
  }

  // -------- Loss Of Excitation override (52G CLOSED & 41 OPEN) ----------
  if (state['52G_Brk_Var'] && !state['41_Brk_Var']){
    const t = performance.now();
    if (typeof updatePhysics._loeT0 !== 'number') updatePhysics._loeT0 = t;
    const α = Math.min(1, (t - updatePhysics._loeT0) / LOE_SETTLE_MS);

    // Blend current values toward LOE targets
    MW = MW + (LOE_REV_PWR_MW - MW) * α;          // small reverse
    Q  = Q  + (LOE_Q_IMPORT_MVAR - Q) * α;        // inductive import (positive)
  } else {
    delete updatePhysics._loeT0;
  }
  // ----------------------------------------------------------------------

  // Apparent + amps + PF
  const S = Math.sqrt(MW*MW + Q*Q);
  const I_kA = (S) / (Math.sqrt(3) * (Vbus));
  const I_A  = I_kA * 1000;
  const PFmag = S > 1e-6 ? (Math.abs(MW) / S) : 0;
  const PFsigned = (Q < 0 ? -PFmag : PFmag);

  state.MW = MW;
  state.MVAR = Q;
  state.AMPS = I_A;
  state.PF = PFsigned;
}



  /* ///////////// Section 5.N slewGenKV (kV tracker) ///////////// */
  function slewGenKV(target, rate_kV_per_s){
    const now = performance.now();
    if (typeof slewGenKV._tPrev !== 'number') slewGenKV._tPrev = now;
    const dt = Math.min(100, now - slewGenKV._tPrev)/1000;
    slewGenKV._tPrev = now;
    const step = rate_kV_per_s * dt;
    const err = target - state.Gen_kV_Var;
    if (Math.abs(err) <= step){
      state.Gen_kV_Var = target;
    } else {
      state.Gen_kV_Var += Math.sign(err) * step;
    }
    state.Gen_kV_Var = clamp(state.Gen_kV_Var, KV_MIN, KV_MAX);
  }

  /* ///////////// Section 5.O Syncroscope & Lamps ///////////// */
/* ///////////// Section 5.O.0 PhaseTracker (shared Δθ + snapshot) ///////////// */
const PhaseTracker = {
  busPhase: 0,
  genPhase: 0,
  tPrev: null,
  snap: null, // { vb, vg, fb, fg, dphiDeg, ts }

  update(fb, fg) {
    const t = performance.now() * 0.001;
    if (this.tPrev == null) this.tPrev = t;
    let dt = t - this.tPrev;
    if (dt > 0.2) dt = 0.2;
    if (dt < 0) dt = 0;
    this.tPrev = t;

    this.busPhase = (this.busPhase + 2 * Math.PI * (fb || 0) * dt) % (2 * Math.PI);
    this.genPhase = (this.genPhase + 2 * Math.PI * (fg || 0) * dt) % (2 * Math.PI);
    return this.deltaDeg();
  },

  deltaDeg() {
    const dphi = normAngleRad(this.genPhase - this.busPhase); // (-π,π]
    return rad2deg(dphi); // (-180,180]
  },

  snapshot(vb, vg, fb, fg) {
    this.snap = {
      vb: (vb != null ? vb : 13.8),
      vg: Math.max(0, vg || 0),
      fb: (fb != null ? fb : 60),
      fg: (fg || 0),
      dphiDeg: this.deltaDeg(),
      ts: performance.now()
    };
    return this.snap;
  }
};

  /* ///////////// Section 5.O.1 SYNC struct ///////////// */
  const SYNC = {
    needleEl: null, center: null,
    lampL: null, lampR: null,
    busPhase: 0, genPhase: 0, tPrev: null
  };

  /* ///////////// Section 5.O.2 parseRotateCenter ///////////// */
  function parseRotateCenter(el) {
    const t = (el.getAttribute("transform") || "").trim();
    const m = t.match(/rotate\(\s*([\-0-9.]+)\s*,\s*([\-0-9.]+)\s*,\s*([\-0-9.]+)\s*\)/i);
    if (m) return { cx: parseFloat(m[2]), cy: parseFloat(m[3]) };
    try { const bb = el.getBBox(); return { cx: bb.x + bb.width/2, cy: bb.y + bb.height/2 }; }
    catch { return { cx: 0, cy: 0 }; }
  }

  /* ///////////// Section 5.O.3 initSyncUI ///////////// */
  function initSyncUI(){
    if (!SYNC.needleEl){
      SYNC.needleEl = document.getElementById("SyncScope_Rotation");
      if (SYNC.needleEl) SYNC.center = parseRotateCenter(SYNC.needleEl);
    }
    if (!SYNC.lampL) SYNC.lampL = document.getElementById('Glow_SyncLeft');
    if (!SYNC.lampR) SYNC.lampR = document.getElementById('Glow_SyncRight');
  }

/* ///////////// Section 5.O.4 updateSyncScopeAndLamps ///////////// */
function updateSyncScopeAndLamps(){
  initSyncUI();
  const snap = PhaseTracker.snap;
  if (!snap) return;

  const DEFAULT_SYNC_ANGLE = 0; // needle's default clamped angle
  const fg = +state.Gen_Freq_Var || 0;
  const syncSwitchOff   = !state.Sync_On;
  const breaker52Closed = !!state['52G_Brk_Var']; // TRUE = closed
  const clampNeedle = (Math.abs(fg) < 0.01) || syncSwitchOff || breaker52Closed;

  // Needle angle (clamped when Hz=0 OR Sync switch OFF OR 52G closed)
  if (SYNC.needleEl && SYNC.center){
    const angle = clampNeedle
      ? DEFAULT_SYNC_ANGLE
      : ((snap.dphiDeg % 360) + 360) % 360; // 0..360 from shared Δθ
    SYNC.needleEl.setAttribute('transform', `rotate(${angle},${SYNC.center.cx},${SYNC.center.cy})`);
  }

  // Lamps brightness from true differential voltage magnitude
  (function(){
    const clamp01 = x => x < 0 ? 0 : (x > 1 ? 1 : x);

    const Vb = snap.vb;
    const Vg = snap.vg;
    const dphiRad = deg2rad(snap.dphiDeg);

    // |Vg∠θg − Vb∠θb|
    const Vr_kV = Math.sqrt(Vg*Vg + Vb*Vb - 2*Vg*Vb*Math.cos(dphiRad));

    const Vnom = (state.Bus_Voltage_kV_nom != null ? state.Bus_Voltage_kV_nom : 13.8);
    const Vr_pu = Vr_kV / (Vnom || 1);

    const LAMP_GAIN = 2;
    const GAMMA     = 1.1;
    const SYNC_FUDGE_MIN_KV = 13.2;
    const SYNC_FUDGE_MAX_KV = 14.5;

    let bright = clamp01(Math.pow(clamp01(Vr_pu * LAMP_GAIN), GAMMA));

    // Fudge band: outside band = full ON
    const inBand = (Vg > SYNC_FUDGE_MIN_KV) && (Vg < SYNC_FUDGE_MAX_KV);
    if (!inBand) bright = 1.0;

    // Only show while syncing (Sync switch ON, 52G OPEN)
    const syncing = !!state.Sync_On && !state['52G_Brk_Var'];
    if (!syncing) bright = 0;

    if (SYNC.lampL){ SYNC.lampL.style.opacity = String(bright); SYNC.lampL.setAttribute('fill', '#FFFFFF'); }
    if (SYNC.lampR){ SYNC.lampR.style.opacity = String(bright); SYNC.lampR.setAttribute('fill', '#FFFFFF'); }
  })();
}

  /* ///////////// Section 5.P Glow helpers (setGlow / setGlowWhite) ///////////// */
  function setGlow(id, on){
    const el = document.getElementById(id);
    if(!el) return;
    el.style.opacity = on ? '1' : '0';
  }
  function setGlowWhite(id, on){
    const el = document.getElementById(id);
    if(!el) return;
    el.style.fill = on ? '#FFFFFF' : '';
    el.style.opacity = on ? '1' : '0';
  }

 /* ///////////// Section 5.Q updateGlows (REPLACE this section) ///////////// */
function updateGlows(){
  const is52Open   = !state['52G_Brk_Var'];
  const is41Closed = !!state['41_Brk_Var'];

  // 86G permissive & flag based ONLY on knob position
  const k86  = (typeof knobStates !== 'undefined') ? knobStates['Knob_86G'] : null;
  const ang  = (k86 && typeof k86.currentAngle === 'number') ? k86.currentAngle : 0;
  const is86NormalByKnob = (ang > -1);

  // Permissives
  setGlow('Glow_Perm_52G',        is52Open);
  setGlow('Glow_Perm_86G',        is86NormalByKnob);
  setGlow('Glow_Perm_Speed',      !!state.Speed_Perm_Var);
  setGlow('Glow_Perm_Excitation', is41Closed);
  setGlowWhite('Glow_Perm_SyncCheck', !!state.SyncCheck_Perm_Var); // white

  // 52G status
  setGlow('Glow_Green_52G', is52Open);
  setGlow('Glow_Red_52G',   !is52Open);

  // 41 status
  setGlow('Glow_Green_41', !is41Closed);
  setGlow('Glow_Red_41',    is41Closed);

  // Ensure 86G flag tracks knob position continuously
  try { setFlag86(); } catch(_){}
}


  /* ///////////// Section 5.R updateGateGauge ///////////// */
  // Gate position (GatePos_Rotation, 0%->36°, 100%->324°)
  function updateGateGauge(){
    const el = document.getElementById("GatePos_Rotation");
    if (!el) return;
    const pct = clamp(state.Gate_Pos_Var, 0, 100);
    const minAng = 36, maxAng = 324;
    const ang = minAng + (pct / 100) * (maxAng - minAng);
    const center = (function(){
      const t = (el.getAttribute("transform") || "").trim();
      const m = t.match(/rotate\(\s*([\-0-9.]+)\s*,\s*([\-0-9.]+)\s*,\s*([\-0-9.]+)\s*\)/i);
      if (m) return { cx: parseFloat(m[2]), cy: parseFloat(m[3]) };
      try { const bb = el.getBBox(); return { cx: bb.x + bb.width/2, cy: bb.y + bb.height/2 }; }
      catch { return { cx: 0, cy: 0 }; }
    })();
    el.setAttribute("transform", `rotate(${ang},${center.cx},${center.cy})`);
  }

  /* ///////////// Section 5.S Hz needle binding (IIFE) ///////////// */
  (function(){
    const PTS = [
      {hz: 0,   ang: 36},
      {hz: 59,  ang: 108},
      {hz: 60,  ang: 180},
      {hz: 61,  ang: 252},
      {hz: 62,  ang: 324},
    ];
    function mapHzToAngle(hz) {
      if (!isFinite(hz)) return 36;
      hz = clamp(hz, 0, 62);
      for (let i = 0; i < PTS.length - 1; i++) {
        const a = PTS[i], b = PTS[i+1];
        if (hz >= a.hz && hz <= b.hz) {
          const t = (hz - a.hz) / (b.hz - a.hz || 1);
          return a.ang + t * (b.ang - a.ang);
        }
      }
      return 324;
    }
    let hzEl = null, center = null;
    function initHz() {
      hzEl = document.getElementById("Hz_Rotation");
      if (!hzEl) return false;
      const t = (hzEl.getAttribute("transform") || "").trim();
      const m = t.match(/rotate\(\s*([\-0-9.]+)\s*,\s*([\-0-9.]+)\s*,\s*([\-0-9.]+)\s*\)/i);
      if (m) center = { cx: parseFloat(m[2]), cy: parseFloat(m[3]) };
      else {
        try { const bb = hzEl.getBBox(); center = { cx: bb.x + bb.width/2, cy: bb.y + bb.height/2 }; }
        catch { center = { cx: 0, cy: 0 }; }
      }
      return true;
    }
    function updateRPMText() {
      const el = document.getElementById("Value_RPM");
      if (!el) return;
      const v = Math.round(state.Master_Started ? (state.Gen_RPM_Var || 0) : 0);
      if (el.textContent !== String(v)) el.textContent = String(v);
    }
    function updateHz() {
      if (!hzEl && !initHz()) return;
      const angle = mapHzToAngle(state.Master_Started ? (state.Gen_Freq_Var || 0) : 0);
      hzEl.setAttribute("transform", `rotate(${angle},${center.cx},${center.cy})`);
    }
    function tick(){ updateRPMText(); updateHz(); }
    document.addEventListener("DOMContentLoaded", () => { initHz(); tick(); });
    clearInterval(window.__v6k_iv);
    window.__v6k_iv = setInterval(tick, 100);
  })();

  /* ///////////// Section 5.T updateKVgauge ///////////// */
  // Gen Volts gauge (GenVolts_Rotation: 36°=0 kV, 180°=13 kV, 324°=15 kV)
  function updateKVgauge(){
    const el = document.getElementById("GenVolts_Rotation");
    if (!el) return;
    const v = clamp(state.Gen_kV_Var, 0, 15); // gauge tops at 15
    let ang;
    if (v <= 13){
      // map 0..13 kV to 36..180°
      const t = v / 13;
      ang = 36 + t * (180 - 36);
    } else {
      // map 13..15 to 180..324°
      const t = (v - 13) / 2;
      ang = 180 + t * (324 - 180);
    }
    const center = (function(){
      const t = (el.getAttribute("transform") || "").trim();
      const m = t.match(/rotate\(\s*([\-0-9.]+)\s*,\s*([\-0-9.]+)\s*,\s*([\-0-9.]+)\s*\)/i);
      if (m) return { cx: parseFloat(m[2]), cy: parseFloat(m[3]) };
      try { const bb = el.getBBox(); return { cx: bb.x + bb.width/2, cy: bb.y + bb.height/2 }; }
      catch { return { cx: 0, cy: 0 }; }
    })();
    el.setAttribute("transform", `rotate(${ang},${center.cx},${center.cy})`);
  }

  /* ///////////// Section 5.U fmtNoLeadingZeros ///////////// */
  function fmtNoLeadingZeros(n, decimals){
    if (!isFinite(n)) return '0';
    const s = (decimals != null) ? n.toFixed(decimals) : String(Math.round(n));
    return s;
  }

  /* ///////////// Section 5.V updateDigitals ///////////// */
function updateDigitals(){
  const elMW   = document.getElementById("Value_MW");
  const elA    = document.getElementById("Value_AMPS");
  const elMVAR = document.getElementById("Value_MVAR");
  const elPF   = document.getElementById("Value_PowerFactor");

  const MW   = +state.MW   || 0;
  const MVAR = +state.MVAR || 0;
  const AMPS = +state.AMPS || 0;

  // PF display — show "unity at tiny load" only when AVR is ON
  const S_MVA = Math.sqrt(MW*MW + MVAR*MVAR);
  const PF_SMALL_THRESH_MVA = 0.3;
  let pfDisp;
  if (state.AVR_On && state['52G_Brk_Var'] && S_MVA < PF_SMALL_THRESH_MVA){
    pfDisp = (MVAR < 0 ? -1 : 1);
  } else if (S_MVA < 1e-6){
    pfDisp = 1;
  } else {
    pfDisp = clamp(+state.PF || 0, -1, 1);
  }

  if (elMW){
    const s = fmtNoLeadingZeros(MW, 1);
    if (elMW.textContent !== s) elMW.textContent = s;
  }
  if (elA){
    const s = fmtNoLeadingZeros(AMPS, 0);
    if (elA.textContent !== s) elA.textContent = s;
  }
  if (elMVAR){
    const s = fmtNoLeadingZeros(MVAR, 1);
    if (elMVAR.textContent !== s) elMVAR.textContent = s;
  }
  if (elPF){
    const s = fmtNoLeadingZeros(pfDisp, 2);
    if (elPF.textContent !== s) elPF.textContent = s;
  }
}



/* ///////////// Section 5.W Main tick loop (requestAnimationFrame) ///////////// */
function tick(){
  watchAngles();
  updateGateSet();
  updateVoltageSet();
  updatePhysics();

  // Instant zero kV if 52G CLOSED and 41 OPEN
  if (state['52G_Brk_Var'] && !state['41_Brk_Var']) {
    state.Gen_kV_Var = 0;
  }

  // ---- Shared phase + snapshot (single source of truth) ----
  const fb = +state.Bus_Freq_Hz  || 60;
  const fg = +state.Gen_Freq_Var || 0;
  const vb = +state.Bus_Voltage_kV || 13.8;
  const vg = +state.Gen_kV_Var     || 0;
  PhaseTracker.update(fb, fg);
  PhaseTracker.snapshot(vb, vg, fb, fg);
  // ----------------------------------------------------------

  updateSyncCheck();
  updateGlows();
  updateGateGauge();
  updateKVgauge();
  updateSyncScopeAndLamps();
  if (window.Osc && typeof window.Osc.update === 'function') window.Osc.update(); // Oscilloscope
  updateDigitals();
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);



/* ///////////// Section 5.Y — Oscilloscope (Bus & Gen waveforms) ///////////// */
(function(){
  const Osc = {
    inited:false,
    els:{ bg:null, bus:null, gen:null },
    rect:null,
    busDrawn:false,

    $: id => document.getElementById(id),

    ensureInit(){
      if (this.inited) return true;
      this.els.bg  = this.$('Osc_Background');
      this.els.bus = this.$('Osc_BusWave');
      this.els.gen = this.$('Osc_GenWave');
      if (!this.els.bg || !this.els.bus || !this.els.gen) return false;

      const x = parseFloat(this.els.bg.getAttribute('x')) || 0;
      const y = parseFloat(this.els.bg.getAttribute('y')) || 0;
      const w = parseFloat(this.els.bg.getAttribute('width'))  || (this.els.bg.getBBox?.().width  || 0);
      const h = parseFloat(this.els.bg.getAttribute('height')) || (this.els.bg.getBBox?.().height || 0);
      this.rect = { x, y, w, h, cx:x+w/2, cy:y+h/2 };
      this.inited = true;
      return true;
    },

    sinePath(x, w, cy, cycles, amp, phaseRad, samples){
      const k = 2*Math.PI*cycles;
      let d = `M ${x} ${ (cy - amp*Math.sin(phaseRad)).toFixed(1) }`;
      for(let i=1;i<=samples;i++){
        const t = i/samples;
        const xx = x + t*w;
        const yy = cy - amp*Math.sin(k*t + phaseRad);
        d += ` L ${xx.toFixed(1)} ${yy.toFixed(1)}`;
      }
      return d;
    },

    drawBusOnce(){
      if (!this.ensureInit()) return;
      if (this.busDrawn) return;
      const r = this.rect;
      const A = 0.90*(r.h/2);
      const cycles = 4;
      const d = this.sinePath(r.x, r.w, r.cy, cycles, A, 0, 480);
      this.els.bus.setAttribute('d', d);
      this.busDrawn = true;
    },

    updateGen(){
      if (!this.ensureInit()) return;
      const r = this.rect;
      const s = (window.SimState || window.state || {});
      const snap = (typeof PhaseTracker !== 'undefined' && PhaseTracker.snap) ? PhaseTracker.snap : null;

      const fg   = +s.Gen_Freq_Var || 0;
      const vGen = Math.max(0, +s.Gen_kV_Var || 0);
      const vNom = (+s.Bus_Voltage_kV_nom) || (+s.Bus_Voltage_kV) || 13.8;

      const Amax = 0.90*(r.h/2);
      const A    = Amax * (vGen / (vNom || 13.8));

      const busHz   = (+s.Bus_Freq_Hz) || 60;
      const T_win   = 4 / busHz;                 // ~4 bus cycles across width
      const cyclesG = fg * T_win;

      // Clamp phase to 0° when 52G is CLOSED (snap in-phase with bus)
      const synced  = !!s['52G_Brk_Var'];
      const phiGen  = synced ? 0 : (snap ? deg2rad(snap.dphiDeg) : 0);

      const d = this.sinePath(r.x, r.w, r.cy, cyclesG, A, phiGen, 480);
      this.els.gen.setAttribute('d', d);
    },

    update(){
      this.drawBusOnce();
      this.updateGen();
    }
  };

  try { window.Osc = Osc; } catch(_){}
})();


/* ///////////// Section 5.Z Protections (add-on; REPLACE this whole section) ///////////// */
(function ProtectionsAddon(){
  const S = window.SimState || window.state || (window.state = {});
  Object.assign(S, {
    Alarm_32:false, Alarm_55:false, Alarm_27:false, Alarm_59:false, Alarm_81:false,
    Trip_32:false, Trip_40:false, Trip_27_59:false, Trip_81:false
  });

  const PROT = (window.__PROT__ = window.__PROT__ || {
    tprev: performance.now(), lastNow: 0, dtCache: 0,
    prev52: !!S['52G_Brk_Var'],
    inhibit32UntilMs: 0,
    a32:0, a55:0, a55sev:0, a27:0, a59:0, a81UF:0, a81OF:0,
    t32:0, t40A:0, t40B:0, t27:0, t59:0, t27Backup:0, t59Backup:0, t81UF:0, t81OF:0,
  });

  function getDt(){
    const now = performance.now();
    if (now - PROT.lastNow < 5) return PROT.dtCache;
    const dt = Math.max(0, (now - PROT.tprev)/1000);
    PROT.tprev = now; PROT.lastNow = now; PROT.dtCache = dt;
    return dt;
  }

  function logFlag(name, on){
    if (S[name] !== on){
      S[name] = on;

      // --- Suppress OLD trip notifications (commented out on purpose) ---
      if (name === 'Trip_32' || name === 'Trip_40' || name === 'Trip_27_59' || name === 'Trip_81') {
        // old generic trip logs we no longer want:
        // try { logDebug(`${name.replaceAll('_',' ').toUpperCase()}: ${on?'TRUE':'FALSE'}`); } catch(_){}
        return; // keep logic intact; no debug line
      }
      // ------------------------------------------------------------------

      // Alarm messages
      if (name.startsWith('Alarm_')){
        const onoff = on ? 'ACTIVE' : 'FALSE';
        const code = name.split('_')[1];
        try { logDebug(`ALARM ${code}: ${onoff}`); } catch(_) {}
        return;
      }

      // Trip messages (explicit)
      let msg = '';
      if (name === 'Trip_32' && on) msg = 'TRIP 32 (Reverse Power) LATCHED';
      if (name === 'Trip_40' && on) msg = '41: TRIPPED';
      if (name === 'Trip_27_59' && on) msg = 'TRIP 27 (Undervoltage) LATCHED; TRIP 59 (Overvoltage) LATCHED';
      if (name === 'Trip_81' && on) msg = 'TRIP 81 (Frequency) LATCHED';
      if (msg){
        try { logDebug(msg); } catch(_) {}
      }
    }
  }

  function setGlow(id, on){
    const el = document.getElementById(id);
    if (!el) return;
    el.style.opacity = on ? 1 : 0;
    try{ el.setAttribute('opacity', on ? '1' : '0'); }catch(_){}
  }

  // ---------- Alarms (self-reset) ----------
  window.evaluateAlarms = function(){
    const now = performance.now();
    const dt  = getDt();

    // Master Stop mask: block alarms during normal shutdown
    if (S.MasterStopMask === true) {
      logFlag('Alarm_32', false);
      logFlag('Alarm_55', false);
      logFlag('Alarm_27', false);
      logFlag('Alarm_59', false);
      logFlag('Alarm_81', false);
      PROT.a32 = PROT.a55 = PROT.a27 = PROT.a59 = PROT.a81UF = PROT.a81OF = 0;
      return;
    }

    if (!PROT.prev52 && S['52G_Brk_Var']) PROT.inhibit32UntilMs = now + 15000;
    PROT.prev52 = !!S['52G_Brk_Var'];

    if (!S.GeneratorOnline){
      logFlag('Alarm_32', false);
      logFlag('Alarm_55', false);
      logFlag('Alarm_27', false);
      logFlag('Alarm_59', false);
      logFlag('Alarm_81', false);
      PROT.a32 = PROT.a55 = PROT.a27 = PROT.a59 = PROT.a81UF = PROT.a81OF = 0;
      return;
    }

    const RatedMW  = Math.max(1e-6, +((window.RATED && RATED.MW) || 23.5));
    const MW       = +S.MW || 0;
    const Q        = +S.MVAR || 0;
    const Vpu      = Math.max(0, (+S.Gen_kV_Var || 0) / ((window.RATED && RATED.KV_LL) || 13.8));
    const Hz       = +S.Gen_Freq_Var || 0;

    // 32 — Reverse Power (self-reset alarm)
    const ppu = MW / RatedMW;
    const a32 = (ppu < -0.01);
    PROT.a32 = a32 ? PROT.a32 + dt : 0;
    logFlag('Alarm_32', PROT.a32 >= 0.2);

    // 55 — LOE / Field Issues (proxy alarm)
    const a55 = (!S['41_Brk_Var'] && S['52G_Brk_Var']);
    PROT.a55 = a55 ? PROT.a55 + dt : 0;
    logFlag('Alarm_55', PROT.a55 >= 0.2);

    // 27 — Undervoltage (self-reset, immediate)
    const a27 = (Vpu < 0.96);
    PROT.a27 = a27 ? PROT.a27 + dt : 0;
    logFlag('Alarm_27', a27); // use a time threshold here if you want a delay

    // 59 — Overvoltage (self-reset, immediate)
    const a59 = (Vpu > 1.04);
    PROT.a59 = a59 ? PROT.a59 + dt : 0;
    logFlag('Alarm_59', a59); // use a time threshold here if you want a delay

    // 81 — Frequency (5 s either side)
    const a81UF = (Hz < 59.8);
    const a81OF = (Hz > 60.2);
    PROT.a81UF = a81UF ? PROT.a81UF + dt : 0;
    PROT.a81OF = a81OF ? PROT.a81OF + dt : 0;
    logFlag('Alarm_81', (PROT.a81UF >= 5.0) || (PROT.a81OF >= 5.0));
  };

  // ---------- Trips (LATCHED) ----------
  window.evaluateTrips = function(){
    const dt = getDt();

    // Master Stop mask: block trip evaluation during normal shutdown
    if (S.MasterStopMask === true) {
      return;
    }

    if (!S.GeneratorOnline){
      // Latching: do NOT auto-clear trips when offline
      return;
    }

    const RatedMW  = Math.max(1e-6, +((window.RATED && RATED.MW) || 23.5));
    const RatedMVA = Math.max(1e-6, +((window.RATED && RATED.MVA) || RatedMW));
    const MW       = +S.MW || 0;
    const Q        = +S.MVAR || 0;
    const Vpu      = Math.max(0, (+S.Gen_kV_Var || 0) / ((window.RATED && RATED.KV_LL) || 13.8));
    const Hz       = +S.Gen_Freq_Var || 0;

    // 32 — Reverse Power (0.5 s, inhibit for 15s after close)
    const now = performance.now();
    const inhibit32 = (now < PROT.inhibit32UntilMs);
    PROT.t32 = (MW < -0.02 * RatedMW && !inhibit32) ? PROT.t32 + dt : 0;
    if (!S.Trip_32 && PROT.t32 >= 0.5) {
      logFlag('Trip_32', true);
    }

    // 40 — Field Breaker trip (proxy)
    const t40 = (!S['41_Brk_Var'] && S['52G_Brk_Var']);
    PROT.t40A = t40 ? PROT.t40A + dt : 0;
    PROT.t40B = t40 ? PROT.t40B + dt : 0;
    if (!S.Trip_40 && (PROT.t40A >= 0.05 || PROT.t40B >= 0.05)) {
      logFlag('Trip_40', true);
    }

    // 27/59 — Voltage trips (0.5 s either side)
    const v27 = (Vpu < 0.90);
    const v59 = (Vpu > 1.10);
    PROT.t27 = v27 ? PROT.t27 + dt : 0;
    PROT.t59 = v59 ? PROT.t59 + dt : 0;

    const trip27 = (PROT.t27 >= 0.5);
    const trip59 = (PROT.t59 >= 0.5);
    if ((!S.Trip_27_59) && (trip27 || trip59)) {
      logFlag('Trip_27_59', true);
      try {
        if (trip27) logDebug('TRIP 27 (Undervoltage) LATCHED');
        if (trip59) logDebug('TRIP 59 (Overvoltage) LATCHED');
      } catch(_) {}
    }

    // 81 — Frequency
    PROT.t81UF = (Hz < 59.0) ? PROT.t81UF + dt : 0;
    PROT.t81OF = (Hz > 61.5) ? PROT.t81OF + dt : 0;
    if (!S.Trip_81 && ((PROT.t81UF >= 0.5) || (PROT.t81OF >= 0.5))) {
      logFlag('Trip_81', true);
      try {
        if (PROT.t81UF >= 0.5) logDebug('TRIP 81 (Underfrequency) LATCHED');
        if (PROT.t81OF >= 0.5) logDebug('TRIP 81 (Overfrequency) LATCHED');
      } catch(_) {}
    }
  };

  window.updateProtectionGlows = function(){
    setGlow('Glow_Alarm_32', S.Alarm_32 === true);
    setGlow('Glow_Alarm_55', S.Alarm_55 === true);
    setGlow('Glow_Alarm_27', (S.Alarm_27 === true) || (S.Alarm_59 === true));
    setGlow('Glow_Alarm_81', S.Alarm_81 === true);
    setGlow('Glow_Trip_32',   S.Trip_32 === true);
    setGlow('Glow_Trip_40',   S.Trip_40 === true);
    setGlow('Glow_Trip_27',   S.Trip_27_59 === true);
    setGlow('Glow_Trip_81',   S.Trip_81 === true);
    setGlow('Glow_Alarm_86G', S['86G_Trip_Var'] === true);
  };

  // Fallback looper
  if (!window.__PROT_LOOP__){
    window.__PROT_LOOP__ = true;
    (function loop(){
      try{
        if (typeof window.evaluateAlarms === 'function') window.evaluateAlarms();
        if (typeof window.evaluateTrips  === 'function') window.evaluateTrips();
        if (typeof window.updateProtectionGlows === 'function') window.updateProtectionGlows();
      }catch(_){}
      requestAnimationFrame(loop);
    })();
  }
})();



/* ///////////// Section 5.Z1: Consolidated 86G Trip & Knob Management ///////////// */
(function Auto86GTripAndKnobManager() {
  const KNOB_ID = 'Knob_86G';
  const TRIP_ANGLE = -45;
  const RESET_ANGLE = 0;

  const switchConfig = switches.find(s => s.knobId === KNOB_ID);
  const originalType = switchConfig ? switchConfig.type : 'latching';

  function rotateKnob(angle) {
    const state = knobStates[KNOB_ID];
    const el = document.getElementById(KNOB_ID);
    if (!state || !el) return;
    const cx = state.centerX, cy = state.centerY;
    state.currentAngle = angle;
    if (prevAngles) prevAngles[KNOB_ID] = angle;
    el.setAttribute('transform', `rotate(${angle} ${cx} ${cy})`);
  }

  function loop() {
    const s = window.SimState || window.state;
    const k = knobStates[KNOB_ID];
    if (!s || !switchConfig || !k) { requestAnimationFrame(loop); return; }

    const isTripped = s['86G_Trip_Var'];
    const anyProt = !!(s.Trip_32 || s.Trip_40 || s.Trip_27_59 || s.Trip_81);

    // Driveback and Auto-trip logic
    if (anyProt && !isTripped) {
      // Initiate driveback: set gate setpoint to 0 immediately.
      // This will cause the actual gate position (Gate_Pos_Var) to ramp down.
      Gate_Setpoint = 0;
      gateRamp.active = false; // Ensure any conflicting start ramps are cancelled.

      // Check if the actual gate position has driven back far enough to trip.
      if (s.Gate_Pos_Var <= 30) {
        // If below the threshold, execute the 86G trip action.
        handleAction('86G_TRIP');
        rotateKnob(TRIP_ANGLE); // Visually snap knob to trip position.
      }
    }

    // Behavior while tripped (unchanged from original)
    if (isTripped) {
      switchConfig.type = 'momentary';
      k.momentaryReturnAngle = TRIP_ANGLE;
      switchConfig.maxAngle = -5;

      if (!k.isDragging && k.currentAngle !== TRIP_ANGLE) {
        rotateKnob(TRIP_ANGLE);
      }
    } else {
      // Reset restores latching behavior (unchanged from original)
      switchConfig.type = originalType;
      k.momentaryReturnAngle = null;
      switchConfig.maxAngle = RESET_ANGLE;
    }

    requestAnimationFrame(loop);
  }
  loop();
})();

/* ///////////// Section 5.Z2 — Reset Button Debug Hook ///////////// */
(function ResetButtonDebugHook(){
  function wire(){
    const btn = document.getElementById('Button_RESET');  // <-- corrected ID
    if(!btn || btn.dataset._dbgHooked) return !!btn;
    btn.dataset._dbgHooked = '1';
    

    // Use both pointerdown and click for safety
    btn.addEventListener('pointerdown', () => {
     
    }, {passive:true});

    btn.addEventListener('click', () => {
      
    }, {passive:true});

    return true;
  }

  if(!wire()){
    let tries = 0;
    const iv = setInterval(() => {
      if (wire() || ++tries > 50) clearInterval(iv);
    }, 100);
  }
})();

/* ///////////// Section 5.Z3 — Reset Handler (fixed) ///////////// */
(function ResetHandler(){
  function doReset(){
    // Clear all auto trip latches (both internal vars and manager flags)
    state['32_Trip_Var']     = false;
    state['40_Trip_Var']     = false;
    state['27_59_Trip_Var']  = false;
    state['81_Trip_Var']     = false;
    state['Trip_32']         = false;
    state['Trip_40']         = false;
    state['Trip_27_59']      = false;
    state['Trip_81']         = false;

    // Clear lockout latch (86G)
    state['86G_Trip_Var'] = false;
    try { setFlag86(false); } catch(_){}

    // Clear online latch so logic can restart clean
    state['GeneratorOnline'] = false;

    // Refresh lamps
    try { updateProtectionGlows(); } catch(_){}

    // Debug
    try {
      
    } catch(_){
      console.log('RESET: Trips (32/40/27-59/81) and 86G cleared; GeneratorOnline reset');
    }
  }

  const btn = document.getElementById('Button_RESET');
  if(btn && !btn.dataset._resetHandler){
    btn.dataset._resetHandler = '1';
    btn.addEventListener('pointerdown', doReset, {passive:true});
  }
})();

/* ///////////// Section 5.Z4 — Master Stop Protections Inhibit (non-invasive) ///////////// */
(function MasterStopProtectionsInhibit(){
  const S = window.SimState || window.state || (window.state = {});
  if (typeof S.MasterStopMask !== 'boolean') S.MasterStopMask = false;

  const origHandle = (typeof window.handleAction === 'function') ? window.handleAction : null;
  window.handleAction = function(tag){
    try{
      if (tag === 'MASTER_STOP') {
        if (!S.MasterStopMask){
          S.MasterStopMask = true;
          try{ logDebug('Protections: Master Stop mask ENABLED'); }catch(_){}
        }
      } else if (tag === 'MASTER_START') {
        if (S.MasterStopMask){
          S.MasterStopMask = false;
          try{ logDebug('Protections: Master Stop mask CLEARED (start)'); }catch(_){}
        }
      }
    }catch(_){}
    return origHandle ? origHandle.apply(this, arguments) : undefined;
  };

  // Auto-clear when fully stopped
  if (!window.__MS_MASK_LOOP__){
    window.__MS_MASK_LOOP__ = true;
    (function loop(){
      try{
        if (S.MasterStopMask){
          const stopped = (!S['52G_Brk_Var']) &&
                          (!S.Master_Started) &&
                          ((+S.Gate_Pos_Var || 0) <= 0.5) &&
                          ((+S.Gen_Freq_Var || 0) <= 0.2);
          if (stopped){
            S.MasterStopMask = false;
            try{ logDebug('Protections: Master Stop mask CLEARED (unit stopped)'); }catch(_){}
          }
        }
      }catch(_){}
      requestAnimationFrame(loop);
    })();
  }
})();


})();


/* ///////////// Section 6 — RPM Text Binding (IIFE) ///////////// */
(function () {
  function getState() { return window.state || window.SimState || null; }
  function calcRPM() {
    const s = getState();
    if (!s) return null;
    if (typeof s.Gen_RPM_Var === "number") return s.Gen_RPM_Var;
    if (typeof s.Gen_Freq_Var === "number") return s.Gen_Freq_Var * 1.667;
    return null;
  }
  function updateRPMText() {
    const el = document.getElementById("Value_RPM");
    if (!el) return;
    const rpm = calcRPM();
    if (rpm == null || isNaN(rpm)) return;
    const v = Math.round(rpm);
    if (el.textContent !== String(v)) el.textContent = String(v);
  }
  clearInterval(window.__rpm_bind_iv);
  window.__rpm_bind_iv = setInterval(updateRPMText, 200);
  document.addEventListener("DOMContentLoaded", updateRPMText);
})();