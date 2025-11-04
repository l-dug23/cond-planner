// ============================================
// SHARED UTILITIES (load first)
// ============================================
document.addEventListener("DOMContentLoaded", () => {

  // Expose a single app namespace
  const App = (window.App = window.App || {});

  // ---------- General helpers ----------
  App.parseTimeInput = function parseTimeInput(val) {
    if (!val) return NaN;
    const parts = val.split(":").map(Number);
    if (parts.length === 2) return parts[0] * 60 + parts[1];
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
    return NaN;
  };

  App.formatTime = function formatTime(sec) {
    const min = Math.floor(sec / 60);
    const s = Math.round(sec % 60).toString().padStart(2, "0");
    return `${min}:${s}`;
  };

  App.formatPace = function formatPace(secPerKm) {
    const min = Math.floor(secPerKm / 60);
    const sec = Math.round(secPerKm % 60).toString().padStart(2, "0");
    return `${min}:${sec}/km`;
  };

  // ---------- Cycling metrics ----------
  App.avg = arr => arr.reduce((a, b) => a + b, 0) / (arr.length || 1);

  App.normalizedPower = function normalizedPower(powerData) {
    if (powerData.length < 30) return App.avg(powerData);
    const rolling = [];
    for (let i = 0; i < powerData.length - 29; i++) {
      const winAvg = App.avg(powerData.slice(i, i + 30));
      rolling.push(Math.pow(winAvg, 4));
    }
    const mean4 = App.avg(rolling);
    return Math.pow(mean4, 0.25);
  };

  App.variabilityIndex = (np, ap) => (ap ? np / ap : 0);
  App.totalWorkKJ = (powerData, dt = 1) =>
    powerData.reduce((a, p) => a + p * dt, 0) / 1000;

  App.workAboveCPKJ = (powerData, cp, dt = 1) =>
    powerData.reduce((a, p) => a + Math.max(0, p - cp) * dt, 0) / 1000;

  App.intensityFactor = (np, cp) => (cp ? np / cp : 0);
  App.trainingLoadTSS = (np, IF, durationSec, cp) =>
    cp ? ((durationSec * np * IF) / (cp * 3600)) * 100 : 0;

  // ---------- Running metrics ----------
  App.avgSpeed = App.avg; // m/s per second
  App.normalizedSpeed = function normalizedSpeed(speedData) {
    if (speedData.length < 30) return App.avgSpeed(speedData);
    const rolling = [];
    for (let i = 0; i < speedData.length - 29; i++) {
      const winAvg = App.avgSpeed(speedData.slice(i, i + 30));
      rolling.push(Math.pow(winAvg, 4));
    }
    const mean4 = App.avg(rolling);
    return Math.pow(mean4, 0.25);
  };
});

// ============================================
// CYCLING MODULE
// ============================================
document.addEventListener("DOMContentLoaded", () => {
  if (!document.getElementById("cycling")) return;

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  // Globals
  let CP, FTP, WPRIME;

  // ---------- CP/FTP FORM ----------
const cpForm = document.getElementById("cp-form");
if (cpForm) {
  cpForm.addEventListener("submit", (e) => {
    e.preventDefault();

    // Scope all queries to the CP form to avoid collisions
    const p3 = parseFloat(cpForm.querySelector("#p3min")?.value);
    const p6 = parseFloat(cpForm.querySelector("#p6min")?.value);
    const p20 = parseFloat(cpForm.querySelector("#p20min")?.value);
    const model = cpForm.querySelector('input[name="cycleModel"]:checked')?.value;  // <-- scoped

    // Quick sanity logging (you can remove after verifying)
    console.log("[CP submit] p3:", p3, "p6:", p6, "p20:", p20, "model:", model);

    if ([p3, p6, p20].some(v => Number.isNaN(v))) {
      document.getElementById("results").innerHTML = "Please enter 3, 6, and 20-min powers.";
      return;
    }

    // Times (s) and powers (W)
    const times = [180, 360, 1200];
    const powers = [p3, p6, p20];

    let cp, wprime, tau;

    if (model === "2pModel") {
      // 2-parameter model via linear regression on Work = CP*t + W'
      const work = times.map((t, i) => powers[i] * t);
      const n = times.length;
      const sumT  = times.reduce((a, b) => a + b, 0);
      const sumW  = work.reduce((a, b) => a + b, 0);
      const sumTT = times.reduce((a, t) => a + t * t, 0);         // correct t^2
      const sumTW = times.reduce((a, t, i) => a + t * work[i], 0);

      const denom = (n * sumTT - sumT * sumT);
      if (denom === 0) {
        document.getElementById("results").innerHTML = "Unable to compute CP (check inputs).";
        return;
      }

      cp     = (n * sumTW - sumT * sumW) / denom;
      wprime = (sumW - cp * sumT) / n;
    }

    if (model === "3pModel") {
      // Simple grid search (rough) for CP and tau; estimate W′ as avg work above CP
      let bestErr = Infinity;
      for (let testCP = 100; testCP <= 400; testCP += 1) {
        for (let testTau = 1; testTau <= 200; testTau += 5) {
          const wEst  = times.reduce((acc, t, i) => acc + (powers[i] - testCP) * t, 0) / times.length;
          const preds = times.map(t => testCP + wEst / (t + testTau));
          const err   = preds.reduce((acc, pred, i) => acc + (pred - powers[i]) ** 2, 0);
          if (err < bestErr) {
            bestErr = err;
            cp = testCP;
            tau = testTau;
            wprime = wEst;
          }
        }
      }
    }

    if (!Number.isFinite(cp) || !Number.isFinite(wprime)) {
      document.getElementById("results").innerHTML = "Calculation failed (check inputs).";
      return;
    }

    const ftp = p20 * 0.95;
    const lt1 = cp * 0.75;
    const lt2 = cp * 0.90;

    let html = `
      <p><strong>FTP:</strong> ${ftp.toFixed(1)} W</p>
      <p><strong>CP:</strong> ${cp.toFixed(1)} W</p>
      <p><strong>W′:</strong> ${(wprime / 1000).toFixed(1)} kJ</p>
      <p><strong>LT1 (≈75% CP):</strong> ${lt1.toFixed(1)} W</p>
      <p><strong>LT2 (≈90% CP):</strong> ${lt2.toFixed(1)} W</p>
    `;
    if (model === "3pModel" && Number.isFinite(tau)) {
      html += `<p><strong>τ:</strong> ${tau.toFixed(1)} s</p>`;
    }
    document.getElementById("results").innerHTML = html;

/// ===== Predicted Powers at 1–6 min for % of W′ used =====
const timePoints = [60, 120, 180, 240, 300, 360]; // 1–6 min in seconds
const wprimePercents = [100, 90, 80, 70, 60, 50]; // % W′ used
let effortHtml = "<h4>Predicted Power (W) for 1–6 min Efforts at % W′ Use</h4>";
effortHtml += "<table><tr><th>Duration</th>";

wprimePercents.forEach(p => (effortHtml += `<th>${p}% W′</th>`));
effortHtml += "</tr>";

timePoints.forEach(t => {
  effortHtml += `<tr><td>${t / 60} min</td>`;
  wprimePercents.forEach(pct => {
    const wEff = wprime * (pct / 100);
    const predPower = cp + wEff / t;
    effortHtml += `<td>${predPower.toFixed(0)}</td>`;
  });
  effortHtml += "</tr>";
});

effortHtml += "</table>";
const predDiv = document.getElementById("cycle-predictions");
if (predDiv) predDiv.innerHTML = effortHtml;


// ===== Training Zones =====
const zones = [
  { name: "Z1 – Active Recovery", low: 0.0, high: 0.55, color: "#71d874" },
  { name: "Z2 – Endurance",      low: 0.56, high: 0.75, color: "#d8c518" },
  { name: "Z3 – Tempo",          low: 0.76, high: 0.90, color: "#ffe082" },
  { name: "Z4 – Threshold",      low: 0.91, high: 1.05, color: "#e68264" },
  { name: "Z5 – VO₂max",         low: 1.06, high: 1.20, color: "#e04141" },
  { name: "Z6 – Anaerobic",      low: 1.21, high: 1.50, color: "#e62968" },
  { name: "Z7 – Neuromuscular",  low: 1.51, high: Infinity, color: "#c528e1" },
];
let zoneHtml = "<h4>Power Training Zones (by % CP)</h4><table><tr><th>Zone</th><th>%CP</th><th>Watts</th></tr>";
zones.forEach(z => {
  const lo = (z.low * cp).toFixed(0);
  const hi = isFinite(z.high) ? (z.high * cp).toFixed(0) : ">";
  zoneHtml += `<tr style="background:${z.color}30"><td>${z.name}</td><td>${Math.round(z.low*100)}–${isFinite(z.high)?Math.round(z.high*100):"∞"}%</td><td>${lo}–${hi}</td></tr>`;
});
zoneHtml += "</table>";
const zoneDiv = document.getElementById("cycle-zones");
if (zoneDiv) zoneDiv.innerHTML = zoneHtml;



    // expose to session generator
    CP = cp;
    FTP = ftp;
    WPRIME = wprime;

    window.cp = cp;
    window.ftp = ftp;
    window.wprime = wprime;
  });
}


  // ---------- Save / Recall (Cycling) ----------
  const saveBtn = $("#save-athlete");
  const athleteSelect = $("#athlete-select");

  function updateAthleteList() {
    if (!athleteSelect) return;
    athleteSelect.innerHTML = "<option value=''>Select athlete</option>";
    Object.keys(localStorage)
      .filter((k) => k.startsWith("athlete_"))
      .forEach((key) => {
        const name = key.replace("athlete_", "");
        const opt = document.createElement("option");
        opt.value = name;
        opt.textContent = name;
        athleteSelect.appendChild(opt);
      });
  }
  if (saveBtn && athleteSelect && cpForm) {
    updateAthleteList();
    saveBtn.addEventListener("click", (e) => {
      e.preventDefault();
      const name = $("#cp-name").value.trim();
      if (!name) return alert("Please enter a name before saving.");
      const data = { name };
      cpForm.querySelectorAll("input[type='number']").forEach((inp) => (data[inp.id] = inp.value));
      const model = cpForm.querySelector("input[name='Model']:checked");
      data.model = model ? model.value : "";
      localStorage.setItem("athlete_" + name, JSON.stringify(data));
      alert("Saved data for " + name);
      updateAthleteList();
      athleteSelect.value = name;
    });

    athleteSelect.addEventListener("change", () => {
      const sel = athleteSelect.value;
      if (!sel) return;
      const data = JSON.parse(localStorage.getItem("athlete_" + sel) || "{}");
      $("#cp-name").value = data.name || "";
      cpForm.querySelectorAll("input[type='number']").forEach((inp) => {
        if (data[inp.id] !== undefined) inp.value = data[inp.id];
      });
      const modelRadio = cpForm.querySelector(`input[value='${data.model}']`);
      if (modelRadio) modelRadio.checked = true;
    });
  }

  // ---------- Session Generator (Cycling) ----------
  const genBtn = $("#generate-session");
  const canvas = $("#session-graph");
  const baseForm = $("#train-select");

  // zone colors for bars
  const zoneColors = [
    { low: 0.0, high: 0.55, color: "#71d874ff" },
    { low: 0.56, high: 0.75, color: "#d8c518ff" },
    { low: 0.76, high: 0.90, color: "#ffe082" },
    { low: 0.91, high: 1.05, color: "#e68264ff" },
    { low: 1.06, high: 1.20, color: "#e04141ff" },
    { low: 1.21, high: 1.50, color: "#e62968ff" },
    { low: 1.51, high: Infinity, color: "#c528e1ff" }
  ];
  function getZoneColor(power, cp) {
    const r = cp ? power / cp : 0;
    for (const z of zoneColors) {
      if (r >= z.low && r <= z.high) return z.color;
    }
    return "#9e9e9e";
  }

  // Parse helper: time + @ % OR absolute W OR range W
  function parseCycleInterval(str, base) {
    // Section label
    let m = str.match(/(.+)\s*>>/i);
    if (m) return { section: m[1].trim() };

    // % (of base)
    m = str.match(/(?:(\d+)min)?\s*(?:(\d+)sec)?\s*@\s*(\d+)%/i);
    if (m) {
      const dur = (parseInt(m[1] || 0, 10) * 60) + (parseInt(m[2] || 0, 10));
      const pct = parseInt(m[3], 10) / 100;
      return { dur, power: base * pct };
    }

    // absolute watts
    m = str.match(/(?:(\d+)min)?\s*(?:(\d+)sec)?\s*@\s*(\d+)\s*w/i);
    if (m) {
      const dur = (parseInt(m[1] || 0, 10) * 60) + (parseInt(m[2] || 0, 10));
      const power = parseInt(m[3], 10);
      return { dur, power };
    }

    // watt range "low-high w"
    m = str.match(/(?:(\d+)min)?\s*(?:(\d+)sec)?\s*@\s*(\d+)\s*-\s*(\d+)\s*w/i);
    if (m) {
      const dur = (parseInt(m[1] || 0, 10) * 60) + (parseInt(m[2] || 0, 10));
      const low = parseInt(m[3], 10);
      const high = parseInt(m[4], 10);
      return { dur, power: (low + high) / 2, low, high };
    }

    return null;
  }

  function updateCycleMetrics(powerSeries, cp) {
    const ap = App.avg(powerSeries);
    const np = App.normalizedPower(powerSeries);
    const vi = App.variabilityIndex(np, ap);
    const work = App.totalWorkKJ(powerSeries);
    const workAbove = App.workAboveCPKJ(powerSeries, cp);
    const IF = App.intensityFactor(np, cp);
    const tss = App.trainingLoadTSS(np, IF, powerSeries.length, cp);

    $("#avg-power").textContent = ap.toFixed(1);
    $("#np").textContent = np.toFixed(1);
    $("#vi").textContent = vi.toFixed(2);
    $("#work").textContent = work.toFixed(1);
    $("#work-above").textContent = workAbove.toFixed(1);
    $("#if").textContent = IF.toFixed(2);
    $("#tss").textContent = tss.toFixed(0);
  }

  if (genBtn && canvas && baseForm) {
    genBtn.addEventListener("click", () => {
      if (!CP || !FTP) return alert("Please calculate CP/FTP first.");
      const baseChoice = document.querySelector('#train-select input[name="trainBase"]:checked')?.value || "CP";
      const base = baseChoice === "CP" ? CP : FTP;

      const text = document.getElementById("session-input").value;
      const lines = text.split("\n").map(s => s.trim()).filter(Boolean);

      let intervals = [];
      let sections = [];
      let tCursor = 0;

      lines.forEach(line => {
        const repeat = line.match(/(\d+)x\s*\((.+)\)/i);
        if (repeat) {
          const reps = parseInt(repeat[1], 10);
          const block = repeat[2].split(",").map(s => s.trim());
          for (let r = 0; r < reps; r++) {
            block.forEach(b => {
              const parsed = parseCycleInterval(b, base);
              if (!parsed) return;
              if (parsed.section) {
                sections.push({ label: parsed.section, start: tCursor });
              } else {
                intervals.push(parsed);
                tCursor += parsed.dur;
              }
            });
          }
        } else {
          const parsed = parseCycleInterval(line, base);
          if (!parsed) return;
          if (parsed.section) {
            sections.push({ label: parsed.section, start: tCursor });
          } else {
            intervals.push(parsed);
            tCursor += parsed.dur;
          }
        }
      });

      if (!intervals.length) return alert("No valid session lines found.");

      // Build series
      const dt = 1;
      let wpbal = WPRIME ?? 0;
      const powerPoints = [];
      const wbalPoints = [];
      let powerSeries = [];
      let cursor = 0;

      intervals.forEach((iv) => {
        for (let i = 0; i < iv.dur; i++) {
          const tSec = cursor + i + 1;
          const tMin = tSec / 60;
          powerPoints.push({ x: tMin, y: iv.power, c: getZoneColor(iv.power, CP) });
          powerSeries.push(iv.power);

          // crude W'bal: deplete above CP, recover below CP with simple exp term
          if (iv.power > CP) {
            wpbal -= (iv.power - CP) * dt;
          } else {
            // Simple bounded recovery
            wpbal += (CP - iv.power) * dt * (1 - wpbal / (WPRIME || 1));
          }
          wpbal = Math.max(0, Math.min(wpbal, WPRIME || 0));
          wbalPoints.push({ x: tMin, y: wpbal });
        }
        cursor += iv.dur;
      });

      // annotations (sections + ranges)
      const annotations = {};
      intervals.reduce((acc, iv, idx) => {
        // draw watt range band
        if (iv.low && iv.high) {
          const startMin = acc / 60;
          const endMin = (acc + iv.dur) / 60;
          annotations["rng" + idx] = {
            type: "box",
            xScaleID: "x",
            yScaleID: "y1",
            xMin: startMin,
            xMax: endMin,
            yMin: iv.low,
            yMax: iv.high,
            backgroundColor: "rgba(30,144,255,0.18)",
            borderWidth: 0,
            drawTime: "beforeDatasetsDraw",
          };
        }
        return acc + iv.dur;
      }, 0);

      // --- Section background + labels (Warm-up, Main Set, Cool Down)
sections.forEach((s, i) => {
  const start = s.start / 60;
  const end = (sections[i + 1]?.start ?? cursor) / 60;
  const colors = [
    "rgba(113, 216, 116, 0.15)", // green tint - warm up
    "rgba(232, 130, 100, 0.15)", // orange tint - main set
    "rgba(100, 181, 246, 0.15)"  // blue tint - cool down
  ];
  const labelColors = ["#388e3c", "#c62828", "#1565c0"];
  const bg = colors[i % colors.length];
  const textColor = labelColors[i % labelColors.length];

  annotations[`sec_${i}`] = {
    type: "box",
    xScaleID: "x",
    yScaleID: "y1",
    xMin: start,
    xMax: end,
    yMin: 0,
    yMax: "max",
    backgroundColor: bg,
    borderWidth: 0,
    drawTime: "beforeDatasetsDraw",
    label: {
      display: true,
      content: s.label,
      position: "start",
      yAdjust: -15,
      color: textColor,
      font: { weight: "bold", size: 13 }
    },
  };
});

      // Draw chart
      const ctx = canvas.getContext("2d");
      if (window.sessionChart) window.sessionChart.destroy();
      window.sessionChart = new Chart(ctx, {
  type: "bar",
  data: {
    datasets: [
      {
        label: `Power (${baseChoice})`,
        data: powerPoints,
        parsing: false,
        yAxisID: "y1",
        backgroundColor: powerPoints.map(p => p.c),
        borderWidth: 0,
      },
      {
        label: "W′bal (J)",
        data: wbalPoints,
        type: "line",
        parsing: false,
        yAxisID: "y2",
        borderColor: "red",
        borderWidth: 2,
        pointRadius: 0
      },
    ],
  },
  options: {
    responsive: true,

    // 👇 ADD THIS block just after responsive: true
    layout: {
      padding: { top: 30 } // ensures header labels aren’t clipped
    },

    plugins: {
  annotation: {
    annotations: {
      // Existing section boxes (reuse parsed sections)
      ...annotations,

      // Add a dotted CP reference line
      cpLine: {
        type: "line",
        yScaleID: "y1",
        yMin: CP,
        yMax: CP,
        borderColor: "#1E4696",
        borderWidth: 2,
        borderDash: [6, 6],
        label: {
          display: true,
          content: "Critical Power",
          position: "end",
          backgroundColor: "rgba(30,70,150,0.1)",
          color: "#1E4696",
          font: { weight: "bold", size: 11 },
          yAdjust: -6
        },
      },
    },
  },
  legend: { position: "top" },
},


    scales: {
      x: { type: "linear", title: { display: true, text: "Time (min)" }, min: 0 },
      y1: { type: "linear", position: "left", title: { display: true, text: "Power (W)" }, beginAtZero: true },
      y2: { type: "linear", position: "right", title: { display: true, text: "W′bal (J)" }, min: 0, max: WPRIME || undefined, beginAtZero: true },
    },
  },
});


      // Metrics
      updateCycleMetrics(powerSeries, CP);
    });
  }

// ---------- Save / Recall Session Text ----------
const saveSessionBtn = document.getElementById("save-session");
const sessionSelect = document.getElementById("session-select");
const sessionInput = document.getElementById("session-input");

function updateSessionList() {
  sessionSelect.innerHTML = "<option value=''>Select session</option>";
  Object.keys(localStorage)
    .filter(k => k.startsWith("cycle_session_"))
    .forEach(key => {
      const name = key.replace("cycle_session_", "");
      const opt = document.createElement("option");
      opt.value = name;
      opt.textContent = name;
      sessionSelect.appendChild(opt);
    });
}

// Populate dropdown on load
updateSessionList();

// --- Save Session ---
if (saveSessionBtn) {
  saveSessionBtn.addEventListener("click", e => {
    e.preventDefault();
    const name = document.getElementById("session-name").value.trim();
    const text = sessionInput.value.trim();
    if (!name) return alert("Please enter a session name.");
    if (!text) return alert("Please enter session text before saving.");

    localStorage.setItem("cycle_session_" + name, text);
    updateSessionList();
    sessionSelect.value = name;
    alert("Saved session: " + name);
  });
}

// --- Load Session ---
if (sessionSelect) {
  sessionSelect.addEventListener("change", () => {
    const sel = sessionSelect.value;
    if (!sel) return;
    const text = localStorage.getItem("cycle_session_" + sel);
    if (text) {
      sessionInput.value = text;
      alert("Loaded session: " + sel);
    }
  });
}



// ---------- Enhanced PDF export (Cycling – Professional Layout) ----------
const pdfBtn = document.getElementById("download-pdf");
if (pdfBtn) {
  pdfBtn.addEventListener("click", async () => {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF("p", "mm", "a4");
    const accent = [66, 133, 244]; // blue accent (Google-style). Change RGB here for brand colour.
    let y = 20;

    // ---- Header ----
    doc.setFontSize(20);
    doc.setTextColor(accent[0], accent[1], accent[2]);
    doc.text("Cycling Conditioning Report", 14, y);
    y += 10;
    doc.setDrawColor(accent[0], accent[1], accent[2]);
    doc.setLineWidth(0.5);
    doc.line(14, y, 195, y);
    y += 8;

    // ---- Athlete ----
    const athleteName = document.getElementById("cp-name")?.value?.trim();
    if (athleteName) {
      doc.setFontSize(13);
      doc.setTextColor(0, 0, 0);
      doc.text(`Athlete: ${athleteName}`, 14, y);
      y += 8;
    }

    // ---- Power Profile ----
    const resultsEl = document.getElementById("results");
    if (resultsEl && resultsEl.innerHTML.trim() !== "") {
      doc.setFontSize(14);
      doc.setTextColor(accent[0], accent[1], accent[2]);
      doc.text("Power Profile", 14, y);
      y += 6;
      doc.setTextColor(0, 0, 0);
      doc.setFontSize(11);

      const tmp = document.createElement("div");
      tmp.innerHTML = resultsEl.innerHTML;
      Array.from(tmp.querySelectorAll("p")).forEach((p) => {
        doc.text(p.innerText, 20, y);
        y += 6;
      });
      y += 4;
    }

    // ---- Training Zones ----
    const zoneEl = document.getElementById("cycle-zones");
    if (zoneEl && zoneEl.innerHTML.trim() !== "") {
      doc.setFontSize(14);
      doc.setTextColor(accent[0], accent[1], accent[2]);
      doc.text("Training Zones", 14, y);
      y += 6;

      doc.setDrawColor(180, 180, 180);
      doc.setLineWidth(0.1);
      const tmp = document.createElement("div");
      tmp.innerHTML = zoneEl.innerHTML;
      Array.from(tmp.querySelectorAll("tr")).forEach((tr, i) => {
        const cells = Array.from(tr.querySelectorAll("td,th")).map(td => td.innerText);
        if (i === 0) {
          doc.setFontSize(11);
          doc.setTextColor(255, 255, 255);
          doc.setFillColor(accent[0], accent[1], accent[2]);
          doc.rect(14, y - 4, 180, 8, "F");
          doc.text(cells.join(" | "), 16, y + 2);
          y += 8;
        } else {
          doc.setFontSize(10);
          doc.setTextColor(0, 0, 0);
          doc.text(cells.join(" | "), 16, y + 2);
          y += 6;
        }
        if (y > 270) { doc.addPage(); y = 20; }
      });
      y += 4;
    }

    // ---- Predicted Powers ----
    const predEl = document.getElementById("cycle-predictions");
    if (predEl && predEl.innerHTML.trim() !== "") {
      doc.setFontSize(14);
      doc.setTextColor(accent[0], accent[1], accent[2]);
      doc.text("Predicted Powers (1–6 min @ %W′)", 14, y);
      y += 6;

      const tmp = document.createElement("div");
      tmp.innerHTML = predEl.innerHTML;
      Array.from(tmp.querySelectorAll("tr")).forEach((tr, i) => {
        const cells = Array.from(tr.querySelectorAll("td,th")).map(td => td.innerText);
        if (i === 0) {
          doc.setFontSize(11);
          doc.setTextColor(255, 255, 255);
          doc.setFillColor(accent[0], accent[1], accent[2]);
          doc.rect(14, y - 4, 180, 8, "F");
          doc.text(cells.join(" | "), 16, y + 2);
          y += 8;
        } else {
          doc.setFontSize(10);
          doc.setTextColor(0, 0, 0);
          doc.text(cells.join(" | "), 16, y + 2);
          y += 6;
        }
        if (y > 270) { doc.addPage(); y = 20; }
      });
      y += 4;
    }

    // ---- Session Plan ----
    const plan = document.getElementById("session-input").value.trim();
    if (plan) {
      if (y > 220) { doc.addPage(); y = 20; }
      doc.setFontSize(14);
      doc.setTextColor(accent[0], accent[1], accent[2]);
      doc.text("Session Plan", 14, y);
      y += 6;
      doc.setFontSize(11);
      doc.setTextColor(0, 0, 0);
      plan.split("\n").forEach((line) => {
        doc.text(line, 20, y);
        y += 6;
        if (y > 270) { doc.addPage(); y = 20; }
      });
      y += 4;
    }

    // ---- Session Graph ----
    const cv = document.getElementById("session-graph");
    if (cv && cv.toDataURL) {
      const img = cv.toDataURL("image/png", 1.0);
      if (y > 160) { doc.addPage(); y = 20; }
      doc.setFontSize(14);
      doc.setTextColor(accent[0], accent[1], accent[2]);
      doc.text("Session Graph", 14, y);
      y += 6;
      doc.addImage(img, "PNG", 15, y, 180, 90);
      y += 100;
    }

    // ---- Footer ----
    doc.setDrawColor(accent[0], accent[1], accent[2]);
    doc.setLineWidth(0.3);
    doc.line(14, 285, 195, 285);
    doc.setFontSize(9);
    doc.setTextColor(100);
    doc.text("Generated by Cycling Conditioning Planner", 14, 290);

    // Save file
    const filename = athleteName ? `${athleteName.replace(/\s+/g, "_")}_Cycling_Report.pdf` : "Cycling_Report.pdf";
    doc.save(filename);
  });
}



// ---------- Functional ZWO / FIT Exports ----------
const zwoBtn = document.getElementById("export-.zwo");
const fitBtn = document.getElementById("export-.fit");

if (zwoBtn) {
  zwoBtn.addEventListener("click", () => {
    const text = document.getElementById("session-input").value.trim();
    if (!text) return alert("Please enter or generate a session first.");
    if (!CP || !FTP) return alert("Please calculate CP/FTP first.");

    // Parse the same text you use for the graph
    const baseChoice = document.querySelector('#train-select input[name="trainBase"]:checked')?.value || "CP";
    const base = baseChoice === "CP" ? CP : FTP;
    const lines = text.split("\n").map(s => s.trim()).filter(Boolean);

    let intervals = [];
    lines.forEach(line => {
      const repeat = line.match(/(\d+)x\s*\((.+)\)/i);
      if (repeat) {
        const reps = parseInt(repeat[1], 10);
        const block = repeat[2].split(",").map(s => s.trim());
        for (let r = 0; r < reps; r++) {
          block.forEach(b => {
            const parsed = parseCycleInterval(b, base);
            if (parsed?.dur && parsed?.power) intervals.push(parsed);
          });
        }
      } else {
        const parsed = parseCycleInterval(line, base);
        if (parsed?.dur && parsed?.power) intervals.push(parsed);
      }
    });

    if (!intervals.length) return alert("No valid session found.");

    // Build ZWO XML
    let xml = `<?xml version="1.0" encoding="UTF-8"?>\n<workout_file>\n`;
    xml += `  <author>Jenni Douglas Coaching</author>\n`;
    xml += `  <name>${document.getElementById("session-name")?.value || "Cycling Workout"}</name>\n`;
    xml += `  <description>Generated from CP/FTP tool</description>\n`;
    xml += `  <sportType>bike</sportType>\n`;
    xml += `  <tags>\n    <tag name="Custom"/>\n  </tags>\n`;
    xml += `  <workout>\n`;

    intervals.forEach(iv => {
      const target = iv.power / FTP; // Zwift expects FTP fractions
      xml += `    <SteadyState Duration="${iv.dur}" Power="${target.toFixed(2)}"/>\n`;
    });

    xml += `  </workout>\n</workout_file>`;

    // Download as .zwo
    const blob = new Blob([xml], { type: "application/xml" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${(document.getElementById("session-name")?.value || "session")}.zwo`;
    a.click();
  });
}
});

// ============================================
// RUNNING MODULE
// ============================================
document.addEventListener("DOMContentLoaded", () => {
  if (!document.getElementById("running")) return;

  // ---- UNIT + INPUT MODE TOGGLES ----
let currentUnit = "metric";      // 'metric' or 'imperial'
let inputMode = "pace";          // 'pace' or 'duration'

// Map for distances in meters
const distSets = {
  metric: [
    { id: "1k", label: "1 km", dist: 1000 },
    { id: "3k", label: "3 km", dist: 3000 },
    { id: "5k", label: "5 km", dist: 5000 },
    { id: "10k", label: "10 km", dist: 10000 },
  ],
  imperial: [
    { id: "1mi", label: "1 mi", dist: 1609.34 },
    { id: "3mi", label: "3 mi", dist: 4828.02 },
    { id: "5mi", label: "5 mi", dist: 8046.7 },
    { id: "10mi", label: "10 mi", dist: 16093.4 },
  ]
};

// Refresh form labels dynamically
function updateDistanceLabels() {
  const dists = distSets[currentUnit];
  dists.forEach((d, i) => {
    const input = document.querySelector(`#cs-form input[data-idx="${i}"]`);
    if (input) input.placeholder = inputMode === "pace"
      ? `Pace for ${d.label} (min:sec per ${currentUnit === 'metric' ? 'km' : 'mi'})`
      : `Total time for ${d.label} (min:sec)`;
    const label = document.querySelector(`#cs-form label[for="${input.id}"]`);
    if (label) label.textContent = d.label;
  });
}

// Build or rebuild the input fields
function buildCSInputs() {
  const container = document.getElementById("cs-inputs");
  if (!container) return;
  container.innerHTML = "";
  distSets[currentUnit].forEach((d, i) => {
    const row = document.createElement("div");
    row.innerHTML = `
      <label for="${d.id}">${d.label}</label>
      <input type="text" id="${d.id}" data-idx="${i}" placeholder="${
        inputMode === 'pace'
          ? `Pace for ${d.label} (min:sec per ${currentUnit === 'metric' ? 'km' : 'mi'})`
          : `Total time for ${d.label} (min:sec)`
      }" />
    `;
    container.appendChild(row);
  });
}

// Initialize selectors
const unitSel = document.getElementById("unit-toggle");
const inputSel = document.getElementById("input-toggle");

if (unitSel && inputSel) {
  unitSel.addEventListener("change", () => {
    currentUnit = unitSel.value;
    buildCSInputs();
  });
  inputSel.addEventListener("change", () => {
    inputMode = inputSel.value;
    updateDistanceLabels();
  });
}

buildCSInputs();


  const $ = (sel) => document.querySelector(sel);

  // Globals
  let CS = null, DPRIME = null;

  // ---------- CS / D' FORM ----------
  const csForm = document.getElementById("cs-form");
  if (csForm) {
    csForm.addEventListener("submit", (e) => {
      e.preventDefault();
      const inputs = distSets[currentUnit];


      const dists = [], times = [];
      inputs.forEach((d) => {
        const t = App.parseTimeInput(document.getElementById(d.id).value);
        if (!isNaN(t)) {
          dists.push(d.dist);
          if (inputMode === "pace") {
  // pace = time per km/mi → convert to total time for distance
  times.push(t * (d.dist / (currentUnit === "metric" ? 1000 : 1609.34)));
} else {
  // total duration input
  times.push(t);
}

        }
      });

      if (dists.length < 2) {
        document.getElementById("run-results").innerHTML = "Please enter at least two valid paces.";
        return;
      }

      const n = dists.length;
      let sumT = 0, sumD = 0, sumTT = 0, sumTD = 0;
      for (let i = 0; i < n; i++) {
        sumT += times[i];
        sumD += dists[i];
        sumTT += times[i] * times[i];
        sumTD += times[i] * dists[i];
      }
      CS = (n * sumTD - sumT * sumD) / (n * sumTT - sumT * sumT);
      DPRIME = (sumD - CS * sumT) / n;
      window.CS = CS;
      window.Dprime = DPRIME;

      document.getElementById("run-results").innerHTML =
        `<p><strong>Critical Speed (CS):</strong> ${CS.toFixed(2)} m/s (${App.formatPace(1000 / CS)})</p>
         <p><strong>D′:</strong> ${DPRIME.toFixed(1)} m</p>`;

         // ===== Predicted paces for 1–10 km =====
const predDists = [1000, 2000, 3000, 5000, 10000];
let predRunHtml = "<h4>Predicted Paces</h4><table><tr><th>Distance</th><th>Speed (m/s)</th><th>Pace</th></tr>";
predDists.forEach(d => {
  const t = (d - DPRIME) / CS;      // simple linear CS–D′ model
  const spd = d / t;
  const pace = App.formatPace(1000 / spd);
  predRunHtml += `<tr><td>${d/1000} km</td><td>${spd.toFixed(2)}</td><td>${pace}</td></tr>`;
});
predRunHtml += "</table>";
document.getElementById("run-predictions").innerHTML = predRunHtml;

// ===== Predicted Speeds & Paces for 1–10 km at % of D′ Used =====
const runDprimePercents = [100, 90, 80, 70];
const runDistances = [1000, 2000, 3000, 5000, 10000];
let effortRunHtml = "<h4>Predicted Paces for 1–10 km Efforts at % of D′ Use</h4>";
effortRunHtml += "<table><tr><th>Distance</th>";

runDprimePercents.forEach(p => (effortRunHtml += `<th>${p}% D′</th>`));
effortRunHtml += "</tr>";

runDistances.forEach(d => {
  effortRunHtml += `<tr><td>${d / 1000} km</td>`;
  runDprimePercents.forEach(pct => {
    const dEff = DPRIME * (pct / 100);
    const t = (d - dEff) / CS;       // adjusted duration using reduced D′ use
    const spd = d / t;               // m/s
    const pace = App.formatPace(1000 / spd);
    effortRunHtml += `<td>${pace}</td>`;
  });
  effortRunHtml += "</tr>";
});

effortRunHtml += "</table>";
const effortDiv = document.getElementById("run-predictions");
if (effortDiv) effortDiv.innerHTML += effortRunHtml;


// ===== Running Zones =====
const runZones = [
  { name: "Z1 – Easy",      low: 0.0,  high: 0.80, color: "#c8e6c9" },
  { name: "Z2 – Steady",    low: 0.80, high: 0.90, color: "#fff9c4" },
  { name: "Z3 – Tempo",     low: 0.90, high: 1.00, color: "#ffe082" },
  { name: "Z4 – Threshold", low: 1.00, high: 1.05, color: "#ffccbc" },
  { name: "Z5 – Interval",  low: 1.05, high: 1.20, color: "#ef9a9a" },
];
let zoneRunHtml = "<h4>Speed Zones (by % CS)</h4><table><tr><th>Zone</th><th>%CS</th><th>Pace</th></tr>";
runZones.forEach(z => {
  const loSpd = CS * z.low;
  const hiSpd = CS * z.high;
  const loPace = App.formatPace(1000 / hiSpd);
  const hiPace = App.formatPace(1000 / loSpd);
  zoneRunHtml += `<tr style="background:${z.color}30"><td>${z.name}</td><td>${Math.round(z.low*100)}–${Math.round(z.high*100)}%</td><td>${loPace}–${hiPace}</td></tr>`;
});
zoneRunHtml += "</table>";
document.getElementById("run-zones").innerHTML = zoneRunHtml;
  
    });
  }

  // ---------- Save / Recall (Running) ----------
  const saveRunBtn = document.getElementById("save-runner");
  const runSelect = document.getElementById("runner-select");

  function updateRunnerList() {
    if (!runSelect) return;
    runSelect.innerHTML = "<option value=''>Select runner</option>";
    Object.keys(localStorage)
      .filter((k) => k.startsWith("runner_"))
      .forEach((key) => {
        const name = key.replace("runner_", "");
        const opt = document.createElement("option");
        opt.value = name;
        opt.textContent = name;
        runSelect.appendChild(opt);
      });
  }

  if (saveRunBtn && runSelect && csForm) {
    updateRunnerList();
    saveRunBtn.addEventListener("click", (e) => {
      e.preventDefault();
      const name = document.getElementById("cs-name").value.trim();
      if (!name) return alert("Please enter a name before saving.");
      const data = { name };
      ["1km", "3km", "5km", "10km"].forEach((id) => (data[id] = document.getElementById(id).value));
      localStorage.setItem("runner_" + name, JSON.stringify(data));
      alert("Saved data for " + name);
      updateRunnerList();
      runSelect.value = name;
    });

    runSelect.addEventListener("change", () => {
      const sel = runSelect.value;
      if (!sel) return;
      const data = JSON.parse(localStorage.getItem("runner_" + sel) || "{}");
      document.getElementById("cs-name").value = data.name || "";
      ["1km", "3km", "5km", "10km"].forEach((id) => {
        if (data[id]) document.getElementById(id).value = data[id];
      });
    });
  }

  // ---------- Running Session Generator + Metrics ----------
  const genRunBtn = document.getElementById("generate-run-session");
  const runCanvas = document.getElementById("run-session-graph");

  const runZones = [
    { name: "Z1", low: 0.0, high: 0.80, color: "#7fd282ff" },
    { name: "Z2", low: 0.80, high: 0.90, color: "#e7dc74ff" },
    { name: "Z3", low: 0.90, high: 1.00, color: "#eac042ff" },
    { name: "Z4", low: 1.00, high: 1.05, color: "#ea9378ff" },
    { name: "Z5", low: 1.05, high: Infinity, color: "#e45959ff" },
  ];
  window.runZones = runZones; // for tooltip coloring

  function parseRunInterval(str) {
    // Section
    let m = str.match(/(.+)\s*>>/i);
    if (m) return { section: m[1].trim() };

    // Time-based @ %CS
    m = str.match(/(?:(\d+)min)?\s*(?:(\d+)sec)?\s*@\s*(\d+)(?:-(\d+))?%CS/i);
    if (m) {
      const dur = (parseInt(m[1] || 0, 10) * 60) + (parseInt(m[2] || 0, 10));
      const low = parseInt(m[3], 10) / 100;
      const high = m[4] ? parseInt(m[4], 10) / 100 : low;
      const perc = (low + high) / 2;
      const speed = CS * perc;
      const pace = 1000 / speed;
      return { dur, intensity: perc, pace };
    }

    // Distance-based %CS (e.g., 1k @ 95%CS)
    m = str.match(/(\d+)(m|km)\s*@\s*(\d+)(?:-(\d+))?%CS/i);
    if (m) {
      const dist = parseInt(m[1], 10) * (m[2] === "km" ? 1000 : 1);
      const low = parseInt(m[3], 10) / 100;
      const high = m[4] ? parseInt(m[4], 10) / 100 : low;
      const perc = (low + high) / 2;
      const speed = CS * perc;
      const pace = 1000 / speed;
      const dur = dist / speed;
      return { dur, intensity: perc, pace };
    }

    // Absolute pace like "5:00/km" (optional: treat as steady)
    m = str.match(/(?:(\d+)min)?\s*(?:(\d+)sec)?\s*@\s*(\d+):(\d+)\/km/i);
    if (m) {
      const dur = (parseInt(m[1] || 0, 10) * 60) + (parseInt(m[2] || 0, 10));
      const paceSec = parseInt(m[3], 10) * 60 + parseInt(m[4], 10);
      const speed = 1000 / paceSec;
      const perc = CS ? speed / CS : 1;
      return { dur, intensity: perc, pace: paceSec };
    }

    return null;
  }

  function updateRunMetrics(speedSeries, cs) {
    const ap = App.avgSpeed(speedSeries);
    const ns = App.normalizedSpeed(speedSeries);
    const vi = ap ? ns / ap : 0;
    const IF = cs ? ns / cs : 0;
    const tss = cs ? ((speedSeries.length * ns * IF) / (cs * 3600)) * 100 : 0;

    document.getElementById("run-avg-speed").textContent = ap.toFixed(2);
    document.getElementById("run-avg-pace").textContent = App.formatPace(1000 / ap);
    document.getElementById("run-ns").textContent = ns.toFixed(2);
    document.getElementById("run-ns-pace").textContent = App.formatPace(1000 / ns);
    document.getElementById("run-vi").textContent = vi.toFixed(2);
    document.getElementById("run-if").textContent = IF.toFixed(2);
    document.getElementById("run-tss").textContent = tss.toFixed(0);
  }

  if (genRunBtn && runCanvas) {
    genRunBtn.addEventListener("click", () => {
      if (!CS) return alert("Please calculate Critical Speed (CS) first!");

      const text = document.getElementById("run-session-input").value;
      const lines = text.split("\n").map(s => s.trim()).filter(Boolean);

      let intervals = [];
      let sections = [];
      let cursor = 0;

      lines.forEach(line => {
        if (line.includes(">>")) {
          sections.push({ label: line.replace(">>", "").trim(), start: cursor });
          return;
        }
        const repeat = line.match(/(\d+)x\s*\((.+)\)/i);
        if (repeat) {
          const reps = parseInt(repeat[1], 10);
          const block = repeat[2].split(",").map(s => s.trim());
          for (let r = 0; r < reps; r++) {
            block.forEach(b => {
              const iv = parseRunInterval(b);
              if (!iv) return;
              intervals.push(iv);
              cursor += iv.dur;
            });
          }
        } else {
          const iv = parseRunInterval(line);
          if (!iv) return;
          intervals.push(iv);
          cursor += iv.dur;
        }
      });

      if (!intervals.length) return alert("No valid running session lines found.");

      // Build series + D′bal (Skiba-style)
const bars = [];
const speedSeries = [];
const dBalPoints = [];
const dt = 1;                      // 1 s sampling (matches your other code)
let t = 0;
let dBal = DPRIME ?? 0;            // start full D′

intervals.forEach(iv => {
  for (let i = 0; i < iv.dur; i++) {
    t++;
    const timeMin = t / 60;
    const spd = CS * iv.intensity;   // m/s for this second
    speedSeries.push(spd);

    // --- Deplete/recover D′ like your cycling W′bal heuristic ---
    if (spd > CS) {
      // above CS → deplete by (v - CS) * dt  (metres per second * s = metres)
      dBal -= (spd - CS) * dt;
    } else {
      // below CS → recover; bounded, a simple exponential-like term
      // same shape as your cycling code; tweak factor (0.5) if you want slower/faster recovery
      const recover = (CS - spd) * dt * (1 - dBal / (DPRIME || 1)) * 0.5;
      dBal += recover;
    }
    dBal = Math.max(0, Math.min(dBal, DPRIME || 0));

    // bar for %CS
    const ratio = iv.intensity;
    const z = runZones.find(z => ratio >= z.low && ratio < z.high) || runZones[runZones.length - 1];
    bars.push({ x: timeMin, y: ratio * 100, pace: App.formatPace(1000 / spd), c: z.color });

    // D′bal trace (metres)
    dBalPoints.push({ x: timeMin, y: dBal });
  }
});


      // section labels as annotations
      const annotations = {};
      sections.forEach((s, i) => {
        const start = s.start / 60;
        const end = (sections[i + 1]?.start ?? t) / 60;
        annotations["sec" + i] = {
          type: "box",
          xScaleID: "x",
          yScaleID: "y",
          xMin: start,
          xMax: end,
          yMin: 0,
          yMax: "max",
          backgroundColor: "rgba(0,0,0,0.06)",
          borderWidth: 0,
          label: { content: s.label, enabled: true, position: "start" },
          drawTime: "beforeDatasetsDraw",
        };
      });

      // === Add a dotted line at 100% CS ===
annotations["csLine"] = {
  type: "line",
  xScaleID: "x",
  yScaleID: "y1",     // attach to the %CS axis
  yMin: 100,
  yMax: 100,
  borderColor: "rgba(0, 0, 0, 0.6)", // greyish tone
  borderWidth: 1.5,
  borderDash: [6, 4], // dotted line
  label: {
    display: true,
    content: "100% CS",
    position: "end",
    backgroundColor: "rgba(255,255,255,0.7)",
    color: "black",
    font: { size: 11, style: "italic" },
  },
  drawTime: "afterDatasetsDraw",
};

      const ctx = runCanvas.getContext("2d");
      if (window.runSessionChart) window.runSessionChart.destroy();
      window.runSessionChart = new Chart(ctx, {
        type: "bar",
    data: {
  datasets: [
    {
      label: "Running Intensity (%CS)",
      data: bars,
      parsing: false,
      backgroundColor: bars.map(b => b.c),
      yAxisID: "y1"
    },
    {
      label: "D′bal (m)",
      data: dBalPoints,
      type: "line",
      parsing: false,
      borderColor: "red",
      borderWidth: 2,
      pointRadius: 0,
      yAxisID: "y2"
    }
  ]
},
options: {
  responsive: true,
  plugins: {
    tooltip: {
      callbacks: {
        label: (ctx) => {
          if (ctx.dataset.label.startsWith("Running")) {
            return `Pace: ${ctx.raw.pace}`;
          }
          return `D′bal: ${ctx.raw.y.toFixed(0)} m`;
        }
      }
    },
    annotation: { annotations }
  },
  scales: {
    x: { type: "linear", title: { display: true, text: "Time (min)" }, min: 0 },
    y1: { title: { display: true, text: "%CS" }, min: 50, max: 130 },
    y2: {
      position: "right",
      title: { display: true, text: "D′bal (m)" },
      min: 0,
      max: DPRIME || undefined,
      beginAtZero: true,
      grid: { drawOnChartArea: false }
    }
  }
}

      });

      // Metrics
      updateRunMetrics(speedSeries, CS);
    });
  }

// ---------- Save / Recall Run Session Text ----------
const runSaveSessionBtn = document.getElementById("run-save-session");
const runSessionSelect = document.getElementById("run-session-select");
const runSessionInput = document.getElementById("run-session-input");

function updateRunSessionList() {
  runSessionSelect.innerHTML = "<option value=''>Select session</option>";
  Object.keys(localStorage)
    .filter(k => k.startsWith("run_session_"))
    .forEach(key => {
      const name = key.replace("run_session_", "");
      const opt = document.createElement("option");
      opt.value = name;
      opt.textContent = name;
      runSessionSelect.appendChild(opt);
    });
}

// Populate dropdown on load
updateRunSessionList();

// --- Save Run Session ---
if (runSaveSessionBtn) {
  runSaveSessionBtn.addEventListener("click", e => {
    e.preventDefault();
    const name = document.getElementById("run-session-name").value.trim();
    const text = runSessionInput.value.trim();
    if (!name) return alert("Please enter a session name.");
    if (!text) return alert("Please enter session text before saving.");

    localStorage.setItem("run_session_" + name, text);
    updateRunSessionList();
    runSessionSelect.value = name;
    alert("Saved run session: " + name);
  });
}

// --- Load Run Session ---
if (runSessionSelect) {
  runSessionSelect.addEventListener("change", () => {
    const sel = runSessionSelect.value;
    if (!sel) return;
    const text = localStorage.getItem("run_session_" + sel);
    if (text) {
      runSessionInput.value = text;
      alert("Loaded run session: " + sel);
    }
  });
}


// ---------- PDF export (Running) ----------
const runPdfBtn = document.getElementById("download-run-pdf");
if (runPdfBtn) {
  runPdfBtn.addEventListener("click", async () => {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF("p", "mm", "a4");
    const name = document.getElementById("cs-name")?.value || "Runner";

    // === TITLE HEADER ===
    doc.setFont("helvetica", "bold");
    doc.setFontSize(18);
    doc.setTextColor(30, 70, 150);
    doc.text(`Running Performance Report — ${name}`, 14, 20);

    let y = 30;

    // === PERFORMANCE PROFILE ===
    const resultsEl = document.getElementById("run-results");
    if (resultsEl && resultsEl.innerHTML.trim() !== "") {
      doc.setFont("helvetica", "bold");
      doc.setFontSize(14);
      doc.setTextColor(30, 70, 150);
      doc.text("Performance Profile", 14, y);
      y += 8;

      doc.setFont("helvetica", "normal");
      doc.setFontSize(12);
      doc.setTextColor(0, 0, 0);

      const tmp = document.createElement("div");
      tmp.innerHTML = resultsEl.innerHTML;
      const lines = tmp.innerText.split("\n").filter(l => l.trim() !== "");
      lines.forEach(line => {
        doc.text(line, 16, y);
        y += 6;
      });
    }

    // === PREDICTED PACES TABLE ===
    const predEl = document.getElementById("run-predictions");
    if (predEl && y < 250) {
      y += 8;
      doc.setFont("helvetica", "bold");
      doc.setFontSize(14);
      doc.setTextColor(30, 70, 150);
      doc.text("Predicted Paces & D′ Use", 14, y);
      y += 6;

      const tmp = document.createElement("div");
      tmp.innerHTML = predEl.innerHTML;
      const rows = Array.from(tmp.querySelectorAll("tr"));
      doc.setFont("helvetica", "normal");
      doc.setFontSize(10);
      rows.forEach((row, i) => {
        const cols = Array.from(row.querySelectorAll("td,th")).map(td => td.innerText.trim());
        if (cols.length) {
          if (i === 0) {
            doc.setFillColor(220, 230, 250);
            doc.rect(14, y - 4, 180, 6, "F");
            doc.setFont("helvetica", "bold");
          } else {
            if (i % 2 === 0) {
              doc.setFillColor(245, 245, 245);
              doc.rect(14, y - 4, 180, 6, "F");
            }
            doc.setFont("helvetica", "normal");
          }
          doc.text(cols.join("   "), 16, y);
          y += 6;
        }
        if (y > 270) {
          doc.addPage();
          y = 20;
        }
      });
    }

    // === RUNNING ZONES ===
    const zonesEl = document.getElementById("run-zones");
    if (zonesEl) {
      y += 8;
      doc.setFont("helvetica", "bold");
      doc.setFontSize(14);
      doc.setTextColor(30, 70, 150);
      doc.text("Running Zones", 14, y);
      y += 6;

      const tmp = document.createElement("div");
      tmp.innerHTML = zonesEl.innerHTML;
      const rows = Array.from(tmp.querySelectorAll("tr"));
      doc.setFont("helvetica", "normal");
      doc.setFontSize(10);
      rows.forEach((row, i) => {
        const cols = Array.from(row.querySelectorAll("td,th")).map(td => td.innerText.trim());
        if (cols.length) {
          if (i === 0) {
            doc.setFillColor(220, 230, 250);
            doc.rect(14, y - 4, 180, 6, "F");
            doc.setFont("helvetica", "bold");
          } else {
            if (i % 2 === 0) {
              doc.setFillColor(245, 245, 245);
              doc.rect(14, y - 4, 180, 6, "F");
            }
            doc.setFont("helvetica", "normal");
          }
          doc.text(cols.join("   "), 16, y);
          y += 6;
        }
        if (y > 270) {
          doc.addPage();
          y = 20;
        }
      });
    }

    // === SESSION PLAN ===
    const plan = document.getElementById("run-session-input").value.trim();
    if (plan) {
      doc.addPage();
      y = 20;
      doc.setFont("helvetica", "bold");
      doc.setFontSize(14);
      doc.setTextColor(30, 70, 150);
      doc.text("Session Plan", 14, y);
      y += 8;

      doc.setFont("helvetica", "normal");
      doc.setFontSize(11);
      doc.setTextColor(0, 0, 0);
      plan.split("\n").forEach((line) => {
        doc.text(line, 20, y);
        y += 6;
        if (y > 270) {
          doc.addPage();
          y = 20;
        }
      });
    }

    // === ADD GRAPH ===
    const cv = document.getElementById("run-session-graph");
    if (cv && cv.toDataURL) {
      doc.addPage();
      const img = cv.toDataURL("image/png", 1.0);
      doc.addImage(img, "PNG", 15, 25, 180, 90);
      doc.setFont("helvetica", "italic");
      doc.setFontSize(10);
      doc.setTextColor(100);
      doc.text("Running Session Graph — Intensity (%CS) and D′ Balance", 15, 120);
    }

    // === SAVE ===
    doc.save(`${name.replace(/\s+/g, "_")}_Running_Report.pdf`);
  });
}

});


// ============================================
// ASR MODULE
// ============================================
document.addEventListener("DOMContentLoaded", () => {
  if (!document.getElementById("ASR")) return;

  const asrForm = document.getElementById("asr-form");
  if (!asrForm) return;

  asrForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const mas = parseFloat(document.getElementById("mas").value);
    const mxs = parseFloat(document.getElementById("mxs").value);
    const resultEl = document.querySelector(".asr-results");
    if (isNaN(mas) || isNaN(mxs) || mxs <= mas) {
      resultEl.textContent = "Please enter valid MAS and MSS values (MSS must be greater than MAS).";
      return;
    }
    const asr = mxs - mas;
    resultEl.textContent = `Your ASR is ${asr.toFixed(2)} m/s (MSS ${mxs} - MAS ${mas}).`;

    // Chart
    let ctx = document.getElementById("asrChart");
    if (!ctx) {
      ctx = document.createElement("canvas");
      ctx.id = "asrChart";
      document.querySelector(".asr-results-report").appendChild(ctx);
    }
    if (window.asrChart && typeof window.asrChart.destroy === "function") {
  window.asrChart.destroy();
}


if (window.asrChart && typeof window.asrChart.destroy === "function") {
  window.asrChart.destroy();
}

const asrValue = mxs - mas;

window.asrChart = new Chart(ctx, {
  type: "bar",
  data: {
    labels: ["Speed Components"],
    datasets: [
      {
        label: "Aerobic (MAS)",
        data: [mas],
        backgroundColor: "#4CAF50"
      },
      {
        label: "Anaerobic Reserve (ASR)",
        data: [asrValue],
        backgroundColor: "#F44336"
      }
    ]
  },
  options: {
    responsive: true,
    plugins: {
      title: {
        display: true,
        text: "Anaerobic Speed Reserve Breakdown"
      },
      legend: {
        position: "bottom"
      }
    },
    scales: {
      x: {
        stacked: true,
        title: { display: false }
      },
      y: {
        stacked: true,
        beginAtZero: true,
        title: { display: true, text: "Speed (m/s)" },
        suggestedMax: mxs * 1.1
      }
    }
  }
});
// === Predicted Distances at %ASR (30%→80%) for durations 20–100s ===
const percentSteps = [30, 40, 50, 60, 70, 80];     // %ASR columns
const durations = [20, 40, 60, 80, 100];           // seconds

let tableHtml = `
  <h4>Predicted Distance by %ASR</h4>
  <table style="border-collapse:collapse;width:100%;text-align:center;font-size:13px">
    <thead>
      <tr>
        <th style="background:#1E4696;color:#fff;padding:6px 4px">Duration (s)</th>
        ${percentSteps.map(p => `<th style="background:#1E4696;color:#fff;padding:6px 4px">${p}% ASR</th>`).join("")}
      </tr>
    </thead>
    <tbody>
      ${durations.map((t,iRow) => {
        const rowBg = iRow % 2 ? "#f7f7f7" : "#ffffff";
        return `
          <tr style="background:${rowBg}">
            <td style="padding:6px 4px"><strong>${t}</strong></td>
            ${percentSteps.map(p => {
              const pct = p / 100;
              const speed = mas + asr * pct;      // m/s  => MAS + %ASR * ASR
              const dist = speed * t;             // meters
              return `<td style="padding:6px 4px">${dist.toFixed(1)} m</td>`;
            }).join("")}
          </tr>
        `;
      }).join("")}
    </tbody>
  </table>
`;

// append under the ASR results section
const asrSection = document.querySelector(".asr-results-report");
if (asrSection) {
  // remove a previous table if present, so we don’t duplicate on recalcs
  const old = asrSection.querySelector(".asr-distance-table");
  if (old) old.remove();
  const wrap = document.createElement("div");
  wrap.className = "asr-distance-table";
  wrap.innerHTML = tableHtml;
  asrSection.appendChild(wrap);
}
// === Predicted Times for Set Distances at %ASR (30→80%) ===
const distanceList = [50, 100, 150, 200];    // metres
const asrPercents = [30, 40, 50, 60, 70, 80];

let timeTableHtml = `
  <h4>Predicted Time to Cover Distance by %ASR</h4>
  <table style="border-collapse:collapse;width:100%;text-align:center;font-size:13px;margin-top:10px">
    <thead>
      <tr>
        <th style="background:#1E4696;color:#fff;padding:6px 4px">Distance (m)</th>
        ${asrPercents.map(p => `<th style="background:#1E4696;color:#fff;padding:6px 4px">${p}% ASR</th>`).join("")}
      </tr>
    </thead>
    <tbody>
      ${distanceList.map((d, iRow) => {
        const bg = iRow % 2 ? "#f7f7f7" : "#ffffff";
        return `
          <tr style="background:${bg}">
            <td style="padding:6px 4px"><strong>${d}</strong></td>
            ${asrPercents.map(p => {
              const pct = p / 100;
              const speed = mas + asr * pct;
              const time = d / speed; // seconds
              return `<td style="padding:6px 4px">${time.toFixed(1)} s</td>`;
            }).join("")}
          </tr>
        `;
      }).join("")}
    </tbody>
  </table>
`;

const asrResults = document.querySelector(".asr-results-report");
if (asrResults) {
  const wrap = document.createElement("div");
  wrap.className = "asr-time-table";
  wrap.innerHTML = timeTableHtml;
  asrResults.appendChild(wrap);
}

  });
});

// =============================
// REPEAT SPRINT ABILITY (RSA)
// =============================
const rsaCalcBtn = document.getElementById("rsa-calc-btn");
const rsaInputs = Array.from(document.querySelectorAll(".rsaform input"));
const rsaCanvas = document.getElementById("rsa-graph");

if (rsaCalcBtn && rsaInputs.length) {
  rsaCalcBtn.addEventListener("click", () => {
    const values = rsaInputs
      .map(inp => parseFloat(inp.value))
      .filter(v => !isNaN(v) && v > 0);

    if (values.length < 2) {
      alert("Please enter at least two valid sprint times.");
      return;
    }

    // Core RSA metrics
    const bst = Math.min(...values);
    const ast = values.reduce((a, b) => a + b, 0) / values.length;
    const tst = values.reduce((a, b) => a + b, 0);
    const dec = ((tst / (bst * values.length)) - 1) * 100; // % decrement

    // Display results
    document.getElementById("rsa-bst").textContent = bst.toFixed(2);
    document.getElementById("rsa-ast").textContent = ast.toFixed(2);
    document.getElementById("rsa-tst").textContent = tst.toFixed(2);
    document.getElementById("rsa-dec").textContent = dec.toFixed(2);

    // --- Bar Chart (Rep Times) ---
    if (window.rsaChart) window.rsaChart.destroy();
    const ctx = rsaCanvas.getContext("2d");
    window.rsaChart = new Chart(ctx, {
      type: "line",
      data: {
        labels: values.map((_, i) => `Rep ${i + 1}`),
        datasets: [{
          label: "Sprint Time (s)",
          data: values,
          backgroundColor: "#4caf50aa",
          borderColor: "#2e7d32",
          borderWidth: 1
        }]
      },
      options: {
        plugins: {
          title: {
            display: true,
            text: "Repeat Sprint Times"
          }
        },
        scales: {
          y: {
            beginAtZero: true,
            title: { display: true, text: "Time (s)" }
          },
          x: {
            title: { display: true, text: "Repetition" }
          }
        }
      }
    });
  });
}

//====================================
// chat bot
//====================================
document.getElementById('chatButton').addEventListener('click', () => {
  const box = document.getElementById('chatbox');
  box.style.display = box.style.display === 'none' ? 'block' : 'none';
});

let responses = {};

// Load the JSON data
fetch('responses.json')
  .then(res => res.json())
  .then(data => responses = data)
  .catch(err => console.error('Error loading responses:', err));

const messages = document.getElementById('messages');
const input = document.getElementById('userInput');
const sendBtn = document.getElementById('sendBtn');

sendBtn.addEventListener('click', sendMessage);
input.addEventListener('keypress', function(e) {
  if (e.key === 'Enter') sendMessage();
});

function sendMessage() {
  const text = input.value.trim().toLowerCase();
  if (!text) return;

  addMessage(`You: ${input.value}`, 'user');

  // Find a matching response (by keyword)
  const reply = getResponse(text);
  setTimeout(() => addMessage(`Boz: ${reply}`, 'boz'), 500);

  input.value = '';
}

function getResponse(inputText) {
  for (let key in responses) {
    if (inputText.includes(key)) {
      return responses[key];
    }
  }
  return responses['default'];
}

function addMessage(msg, cls) {
  const p = document.createElement('p');
  p.textContent = msg;
  p.className = cls;
  messages.appendChild(p);
  messages.scrollTop = messages.scrollHeight;
}
