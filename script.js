document.addEventListener("DOMContentLoaded", () => {

  // ============================================
  // CYCLING CP/FTP FORM
  // ============================================
  document.getElementById("cp-form").addEventListener("submit", function (e) {
    e.preventDefault();

    const p3 = parseFloat(document.getElementById("3min").value);
    const p6 = parseFloat(document.getElementById("6min").value);
    const p20 = parseFloat(document.getElementById("20min").value);
    const model = document.querySelector('input[name="Model"]:checked').value;

    if (isNaN(p3) || isNaN(p6) || isNaN(p20)) {
      document.getElementById("results").innerHTML = "Please enter 3, 6, and 20-min powers.";
      return;
    }

    // Times in seconds
    const times = [180, 360, 1200];
    const powers = [p3, p6, p20];

    let cp, wprime, tau;

    if (model === "2pModel") {
      const work = times.map((t, i) => powers[i] * t);
      const n = times.length;
      const sumT = times.reduce((a, b) => a + b, 0);
      const sumW = work.reduce((a, b) => a + b, 0);
      const sumTT = times.reduce((a, b) => a + b * b, 0);
      const sumTW = times.reduce((a, t, i) => a + t * work[i], 0);

      cp = (n * sumTW - sumT * sumW) / (n * sumTT - sumT * sumT);
      wprime = (sumW - cp * sumT) / n;
    }

    if (model === "3pModel") {
      let bestErr = Infinity;
      for (let testCP = 100; testCP <= 400; testCP += 1) {
        for (let testTau = 1; testTau <= 200; testTau += 5) {
          const wEst = times.reduce((acc, t, i) => acc + (powers[i] - testCP) * (t + testTau), 0) / times.length;
          const preds = times.map((t, i) => testCP + wEst / (t + testTau));
          const err = preds.reduce((acc, pred, i) => acc + (pred - powers[i]) ** 2, 0);
          if (err < bestErr) {
            bestErr = err;
            cp = testCP;
            tau = testTau;
            wprime = wEst;
          }
        }
      }
    }

    // Predicted efforts
    const fractions = [1.0, 0.9, 0.8, 0.7, 0.6, 0.5];
    const durationsMin = [1, 2, 3, 4, 5, 6];
    let predRows = "";
    durationsMin.forEach(m => {
      const t = m * 60;
      predRows += `<tr><td>${m} min</td>`;
      fractions.forEach(f => {
        let pPred = (model === "2pModel")
          ? cp + (f * wprime / t)
          : cp + (f * wprime / (t + tau));
        predRows += `<td>${pPred.toFixed(1)} W</td>`;
      });
      predRows += "</tr>";
    });
    let predTable = `<h3>Predicted Max Efforts (from CP & W′)</h3>
                   <table>
                     <tr><th>Duration</th>${fractions.map(f => `<th>${Math.round(f * 100)}% W′</th>`).join("")}</tr>
                     ${predRows}
                   </table>`;

    // Zone tables
    const zones = [
      { name: "Zone 1", low: 0, high: 0.55, color: "#c8e6c9" },
      { name: "Zone 2", low: 0.56, high: 0.75, color: "#fff9c4" },
      { name: "Zone 3", low: 0.76, high: 0.90, color: "#ffe082" },
      { name: "Zone 4", low: 0.91, high: 1.05, color: "#ffccbc" },
      { name: "Zone 5", low: 1.06, high: 1.20, color: "#ef9a9a" },
      { name: "Zone 6", low: 1.21, high: 1.50, color: "#f48fb1" },
      { name: "Zone 7", low: 1.51, high: null, color: "#ce93d8" }
    ];
    function buildZoneTable(base, label) {
      let html = `<h3>${label} Zones</h3><table>
                 <tr><th>Zone</th><th>% of ${label}</th><th>Watts</th></tr>`;
      zones.forEach(z => {
        const lowW = (base * z.low).toFixed(0);
        const highW = z.high ? (base * z.high).toFixed(0) : "∞";
        html += `<tr style="background:${z.color};">
                 <td>${z.name}</td>
                 <td>${(z.low * 100).toFixed(0)}${z.high ? "–" + (z.high * 100).toFixed(0) : "+"}%</td>
                 <td>${lowW} – ${highW}</td>
               </tr>`;
      });
      html += "</table>";
      return html;
    }

    const ftp = p20 * 0.95;
    const lt1 = cp * 0.75;
    const lt2 = cp * 0.90;

    let output = `<p><strong>Estimated FTP:</strong> ${ftp.toFixed(1)} W</p>
                <p><strong>Critical Power (CP):</strong> ${cp.toFixed(1)} W</p>
                <p><strong>W′:</strong> ${(wprime / 1000).toFixed(1)} kJ</p>
                <p><strong>Estimated LT1:</strong> ${lt1.toFixed(1)} W</p>
                <p><strong>Estimated LT2:</strong> ${lt2.toFixed(1)} W</p>`;
    if (model === "3pModel") {
      output += `<p><strong>Tau (τ):</strong> ${tau.toFixed(1)} s</p>`;
    }
    output += `<div class="zone-tables">
               ${buildZoneTable(ftp, "FTP")}
               ${buildZoneTable(cp, "CP")}
             </div>`;
    output += predTable;

    document.getElementById("results").innerHTML = output;

    // Store globals
    window.cp = cp;
    window.ftp = ftp;
    window.wprime = wprime;
  });


  // ============================================
  // CYCLING SESSION GENERATOR (fixed ranges)
  // ============================================
  document.getElementById("generate-session").addEventListener("click", function () {
    if (!window.cp || !window.ftp) {
      alert("Please calculate CP/FTP first!");
      return;
    }

    const selected = document.querySelector('#train-select input[name="trainBase"]:checked').value;
    const base = (selected === "CP") ? window.cp : window.ftp;

    const text = document.getElementById("session-input").value;
    const lines = text.split("\n").map(l => l.trim()).filter(l => l);

    let intervals = [];
    let sections = [];
    let currentTime = 0; // seconds elapsed when parsing (for section starts)

    lines.forEach(line => {
      const repeatMatch = line.match(/(\d+)x\s*\((.+)\)/i);
      if (repeatMatch) {
        const reps = parseInt(repeatMatch[1], 10);
        const block = repeatMatch[2].split(",").map(s => s.trim());
        for (let r = 0; r < reps; r++) {
          block.forEach(b => {
            const parsed = parseCycleInterval(b, base, currentTime);
            if (!parsed) return;
            if (parsed.isSection) {
              sections.push({ label: parsed.label, start: currentTime });
            } else {
              intervals.push(parsed);
              currentTime += parsed.dur;
            }
          });
        }
      } else {
        const parsed = parseCycleInterval(line, base, currentTime);
        if (!parsed) return;
        if (parsed.isSection) {
          sections.push({ label: parsed.label, start: currentTime });
        } else {
          intervals.push(parsed);
          currentTime += parsed.dur;
        }
      }
    });

    if (intervals.length === 0) {
      alert("No valid session lines found.");
      return;
    }

    // ---- Zone colours ----
    const zoneColors = [
      { name: "Zone 1", low: 0, high: 0.55, color: "#71d874ff" },
      { name: "Zone 2", low: 0.56, high: 0.75, color: "#d8c518ff" },
      { name: "Zone 3", low: 0.76, high: 0.90, color: "#ffe082" },
      { name: "Zone 4", low: 0.91, high: 1.05, color: "#e68264ff" },
      { name: "Zone 5", low: 1.06, high: 1.20, color: "#e04141ff" },
      { name: "Zone 6", low: 1.21, high: 1.50, color: "#e62968ff" },
      { name: "Zone 7", low: 1.51, high: null, color: "#c528e1ff" }
    ];
    function getZoneColor(power, cp) {
      const ratio = power / cp;
      for (const z of zoneColors) {
        if (!z.high || (ratio >= z.low && ratio <= z.high)) return z.color;
      }
      return "gray";
    }

    // ---- Build datasets & annotations ----
    let powers = [];   // {x,y,c}
    let wbal = [];   // {x,y}
    const annotations = {}; // section & range boxes go here

    let wpbal = window.wprime;
    const dt = 1;
    const CP = window.cp;

    // cursor = start time of current interval (seconds)
    let cursor = 0;

    intervals.forEach((intv, idx) => {
      const startMin = cursor / 60;
      const endMin = (cursor + intv.dur) / 60;

      // If this interval had a watt range, add ONE shaded box for the whole interval
      if (intv.low && intv.high) {
        annotations["range" + idx] = {
          type: 'box',
          xScaleID: 'x',
          yScaleID: 'y1',
          xMin: startMin,
          xMax: endMin,
          yMin: intv.low,
          yMax: intv.high,
          backgroundColor: 'rgba(30,144,255,0.18)', // semi-opaque
          borderWidth: 0,
          drawTime: 'beforeDatasetsDraw'
        };
      }

      // Per-second points for power & W′bal
      for (let i = 0; i < intv.dur; i++) {
        const tSec = cursor + i + 1;
        const timeMin = tSec / 60;

        powers.push({
          x: timeMin,
          y: intv.power,
          c: getZoneColor(intv.power, CP)
        });

        if (intv.power > CP) {
          wpbal -= (intv.power - CP) * dt;
        } else {
          wpbal += (CP - intv.power) * dt * (1 - wpbal / window.wprime);
        }
        if (wpbal < 0) wpbal = 0;
        if (wpbal > window.wprime) wpbal = window.wprime;

        wbal.push({ x: timeMin, y: wpbal });
      }

      cursor += intv.dur;
    });

    // ---- Section shading boxes (Warm up >>, etc.) ----
    sections.forEach((s, i) => {
      const end = sections[i + 1] ? sections[i + 1].start / 60 : cursor / 60;
      annotations["section" + i] = {
        type: 'box',
        xScaleID: 'x',
        yScaleID: 'y1',
        xMin: s.start / 60,
        xMax: end,
        yMin: 0,
        yMax: 'max',
        backgroundColor: 'rgba(0,0,0,0.06)',
        borderWidth: 0,
        label: { content: s.label, enabled: true, position: "start" },
        drawTime: 'beforeDatasetsDraw'
      };
    });

    // ---- Build metrics ----
const powerData = powers.map(p => p.y); // extract watts only
updateMetrics(powerData, CP);

function averagePower(powerData) {
  return powerData.reduce((a, b) => a + b, 0) / powerData.length;
}

function normalizedPower(powerData) {
  if (powerData.length < 30) return averagePower(powerData);
  const rolling = [];
  for (let i = 0; i < powerData.length - 29; i++) {
    const window = powerData.slice(i, i + 30);
    const avg = window.reduce((a, b) => a + b, 0) / 30;
    rolling.push(Math.pow(avg, 4));
  }
  const mean4 = rolling.reduce((a, b) => a + b, 0) / rolling.length;
  return Math.pow(mean4, 0.25);
}

function variabilityIndex(np, ap) {
  return np / ap;
}

function totalWork(powerData, dt = 1) {
  const joules = powerData.reduce((a, p) => a + p * dt, 0);
  return joules / 1000; // kJ
}

function workAboveCP(powerData, cp, dt = 1) {
  const joules = powerData.reduce((a, p) => a + Math.max(0, p - cp) * dt, 0);
  return joules / 1000; // kJ
}

function intensityFactor(np, cp) {
  return np / cp;
}

function trainingLoad(np, ifactor, durationSec, cp) {
  return (durationSec * np * ifactor) / (cp * 3600) * 100;
}

function updateMetrics(powerData, cp) {
  const ap = averagePower(powerData);
  const np = normalizedPower(powerData);
  const vi = variabilityIndex(np, ap);
  const work = totalWork(powerData);
  const workAbove = workAboveCP(powerData, cp);
  const ifactor = intensityFactor(np, cp);
  const tss = trainingLoad(np, ifactor, powerData.length, cp);

  document.getElementById('avg-power').textContent = ap.toFixed(1);
  document.getElementById('np').textContent = np.toFixed(1);
  document.getElementById('vi').textContent = vi.toFixed(2);
  document.getElementById('work').textContent = work.toFixed(1);
  document.getElementById('work-above').textContent = workAbove.toFixed(1);
  document.getElementById('if').textContent = ifactor.toFixed(2);
  document.getElementById('tss').textContent = tss.toFixed(0);
}

    // ---- Draw chart ----
    const ctx = document.getElementById("session-graph").getContext("2d");
    if (window.sessionChart) window.sessionChart.destroy();
    window.sessionChart = new Chart(ctx, {
      type: 'bar',
      data: {
        datasets: [
          {
            label: `Power (using ${selected})`,
            data: powers,
            yAxisID: 'y1',
            backgroundColor: powers.map(p => p.c),
            borderWidth: 0
          },
          {
            label: "W′bal (J)",
            data: wbal,
            type: 'line',
            borderColor: 'red',
            borderWidth: 2,
            yAxisID: 'y2',
            parsing: false
          }
        ]
      },
      options: {
        plugins: {
          annotation: { annotations }
        },
        scales: {
          x: { type: 'linear', title: { display: true, text: "Time (min)" }, min: 0, ticks: { stepSize: 1 } },
          y1: { type: 'linear', position: 'left', title: { display: true, text: "Power (W)" }, beginAtZero: true },
          y2: { type: 'linear', position: 'right', title: { display: true, text: "W′bal (J)" }, min: 0, max: window.wprime, beginAtZero: true }
        }
      }
    });
  });



  // ============================================
  // HELPER FOR INTERVAL PARSING
  // ============================================
  function parseCycleInterval(str, base, currentTime) {
    // Section labels like "Warm up >>"
    let match = str.match(/(.+)\s*>>/i);
    if (match) {
      return { isSection: true, label: match[1].trim() };
    }

    // %CP or %FTP
    match = str.match(/(?:(\d+)min)?\s*(?:(\d+)sec)?\s*@\s*(\d+)%/i);
    if (match) {
      const mins = parseInt(match[1] || 0, 10);
      const secs = parseInt(match[2] || 0, 10);
      const dur = mins * 60 + secs;
      const perc = parseInt(match[3], 10) / 100;
      const power = base * perc;
      return { dur, power };
    }

    // Absolute watts
    match = str.match(/(?:(\d+)min)?\s*(?:(\d+)sec)?\s*@\s*(\d+)\s*w/i);
    if (match) {
      const mins = parseInt(match[1] || 0, 10);
      const secs = parseInt(match[2] || 0, 10);
      const dur = mins * 60 + secs;
      const power = parseInt(match[3], 10);
      return { dur, power };
    }

    // Watt range e.g. "200-250w"
    match = str.match(/(?:(\d+)min)?\s*(?:(\d+)sec)?\s*@\s*(\d+)\s*-\s*(\d+)\s*w/i);
    if (match) {
      const mins = parseInt(match[1] || 0, 10);
      const secs = parseInt(match[2] || 0, 10);
      const dur = mins * 60 + secs;
      const low = parseInt(match[3], 10);
      const high = parseInt(match[4], 10);
      const power = (low + high) / 2; // midpoint
      return { dur, power, low, high };
    }

    return null;
  }

  // ============================================
  // RUNNING CS FORM
  // ============================================
  function parseTimeInput(val) {
    if (!val) return NaN;
    const parts = val.split(":").map(Number);
    if (parts.length === 2) return parts[0] * 60 + parts[1];
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
    return NaN;
  }
  function formatTime(sec) {
    const min = Math.floor(sec / 60);
    const s = Math.round(sec % 60).toString().padStart(2, '0');
    return `${min}:${s}`;
  }
  function formatPace(secPerKm) {
    const min = Math.floor(secPerKm / 60);
    const sec = Math.round(secPerKm % 60).toString().padStart(2, '0');
    return `${min}:${sec}/km`;
  }
  function averageSpeed(data) {
  return data.reduce((a, b) => a + b, 0) / data.length;
}

function normalizedSpeed(data) {
  if (data.length < 30) return averageSpeed(data);
  const rolling = [];
  for (let i = 0; i < data.length - 29; i++) {
    const avg = data.slice(i, i + 30).reduce((a, b) => a + b, 0) / 30;
    rolling.push(Math.pow(avg, 4));
  }
  const mean4 = rolling.reduce((a, b) => a + b, 0) / rolling.length;
  return Math.pow(mean4, 0.25);
}
function updateRunMetrics(speedData, cs) {
  const ap = averageSpeed(speedData);
  const ns = normalizedSpeed(speedData);
  const vi = ns / ap;
  const ifactor = ns / cs;
  const tss = (speedData.length * ns * ifactor) / (cs * 3600) * 100;

  const apPace = formatPace(1000 / ap);
  const nsPace = formatPace(1000 / ns);

  document.getElementById('run-avg-speed').textContent = ap.toFixed(2);
  document.getElementById('run-avg-pace').textContent = apPace;
  document.getElementById('run-ns').textContent = ns.toFixed(2);
  document.getElementById('run-ns-pace').textContent = nsPace;
  document.getElementById('run-vi').textContent = vi.toFixed(2);
  document.getElementById('run-if').textContent = ifactor.toFixed(2);
  document.getElementById('run-tss').textContent = tss.toFixed(0);
}

  document.getElementById("cs-form").addEventListener("submit", function (e) {
    e.preventDefault();

    const inputs = [
      { id: "1km", dist: 1000 },
      { id: "3km", dist: 3000 },
      { id: "5km", dist: 5000 },
      { id: "10km", dist: 10000 }
    ];

    let distances = [];
    let times = [];
    inputs.forEach(d => {
      const pace = parseTimeInput(document.getElementById(d.id).value);
      if (!isNaN(pace)) {
        distances.push(d.dist);
        times.push(pace * (d.dist / 1000));
      }
    });

    if (distances.length < 2) {
      document.getElementById("run-results").innerHTML = "Please enter at least two valid paces.";
      return;
    }

    const n = distances.length;
    let sumT = 0, sumD = 0, sumTT = 0, sumTD = 0;
    for (let i = 0; i < n; i++) {
      sumT += times[i];
      sumD += distances[i];
      sumTT += times[i] * times[i];
      sumTD += times[i] * distances[i];
    }
    const CS = (n * sumTD - sumT * sumD) / (n * sumTT - sumT * sumT);
    const Dprime = (sumD - CS * sumT) / n;

    window.CS = CS;
    window.Dprime = Dprime;

    let output = `<p><strong>Critical Speed (CS):</strong> ${CS.toFixed(2)} m/s (${formatPace(1000 / CS)})</p>`;
    output += `<p><strong>D′:</strong> ${Dprime.toFixed(1)} m</p>`;

    const fractions = [1.0, 0.9, 0.8, 0.7, 0.6, 0.5];
    output += "<h3>Predicted Performances</h3><table><tr><th>Distance</th>";
    fractions.forEach(f => output += `<th>${Math.round(f * 100)}% D′</th>`);
    output += "</tr>";

    [1, 2, 3, 4, 5, 10].forEach(km => {
      const D = km * 1000;
      output += `<tr><td>${km} km</td>`;
      fractions.forEach(f => {
        const T = (D - (f * Dprime)) / CS;
        const pace = T / km;
        output += `<td>${formatTime(T)} (${formatPace(pace)})</td>`;
      });
      output += "</tr>";
    });
    output += "</table>";

    // Running Zones
    const runZones = [
      { name: "Zone 1", low: 0.0, high: 0.80, color: "#c8e6c9" },
      { name: "Zone 2", low: 0.80, high: 0.90, color: "#fff9c4" },
      { name: "Zone 3", low: 0.90, high: 1.00, color: "#ffe082" },
      { name: "Zone 4", low: 1.00, high: 1.05, color: "#ffccbc" },
      { name: "Zone 5", low: 1.05, high: null, color: "#ef9a9a" }
    ];
    window.runZones = runZones;

    output += "<h3>Running Zones (based on CS)</h3><table><tr><th>Zone</th><th>%CS</th><th>Pace</th></tr>";
    runZones.forEach(z => {
      const lowSpeed = CS * z.low;
      const highSpeed = z.high ? CS * z.high : Infinity;
      const lowPace = formatPace(1000 / lowSpeed);
      const highPace = z.high ? formatPace(1000 / highSpeed) : "faster";
      output += `<tr style="background:${z.color};"><td>${z.name}</td><td>${(z.low * 100).toFixed(0)}${z.high ? "–" + (z.high * 100).toFixed(0) : "+"}%</td><td>${lowPace} – ${highPace}</td></tr>`;
    });
    output += "</table>";

    document.getElementById("run-results").innerHTML = output;
  });


  // ============================================
  // RUNNING CS FORM
  // ============================================
  function parseTimeInput(val) {
    if (!val) return NaN;
    const parts = val.split(":").map(Number);
    if (parts.length === 2) return parts[0] * 60 + parts[1];
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
    return NaN;
  }
  function formatTime(sec) {
    const min = Math.floor(sec / 60);
    const s = Math.round(sec % 60).toString().padStart(2, '0');
    return `${min}:${s}`;
  }
  function formatPace(secPerKm) {
    const min = Math.floor(secPerKm / 60);
    const sec = Math.round(secPerKm % 60).toString().padStart(2, '0');
    return `${min}:${sec}/km`;
  }

  document.getElementById("cs-form").addEventListener("submit", function (e) {
    e.preventDefault();

    const inputs = [
      { id: "1km", dist: 1000 },
      { id: "3km", dist: 3000 },
      { id: "5km", dist: 5000 },
      { id: "10km", dist: 10000 }
    ];

    let distances = [];
    let times = [];
    inputs.forEach(d => {
      const pace = parseTimeInput(document.getElementById(d.id).value);
      if (!isNaN(pace)) {
        distances.push(d.dist);
        times.push(pace * (d.dist / 1000));
      }
    });

    if (distances.length < 2) {
      document.getElementById("run-results").innerHTML = "Please enter at least two valid paces.";
      return;
    }

    const n = distances.length;
    let sumT = 0, sumD = 0, sumTT = 0, sumTD = 0;
    for (let i = 0; i < n; i++) {
      sumT += times[i];
      sumD += distances[i];
      sumTT += times[i] * times[i];
      sumTD += times[i] * distances[i];
    }
    const CS = (n * sumTD - sumT * sumD) / (n * sumTT - sumT * sumT);
    const Dprime = (sumD - CS * sumT) / n;

    window.CS = CS;

    let output = `<p><strong>Critical Speed (CS):</strong> ${CS.toFixed(2)} m/s (${formatPace(1000 / CS)})</p>`;
    output += `<p><strong>D′:</strong> ${Dprime.toFixed(1)} m</p>`;

    const fractions = [1.0, 0.9, 0.8, 0.7, 0.6, 0.5];
    output += "<h3>Predicted Performances</h3><table><tr><th>Distance</th>";
    fractions.forEach(f => output += `<th>${Math.round(f * 100)}% D′</th>`);
    output += "</tr>";

    [1, 2, 3, 4, 5, 10].forEach(km => {
      const D = km * 1000;
      output += `<tr><td>${km} km</td>`;
      fractions.forEach(f => {
        const T = (D - (f * Dprime)) / CS;
        const pace = T / km;
        output += `<td>${formatTime(T)} (${formatPace(pace)})</td>`;
      });
      output += "</tr>";
    });
    output += "</table>";

    // Running Zones
    const runZones = [
      { name: "Zone 1", low: 0.0, high: 0.80, color: "#c8e6c9" },
      { name: "Zone 2", low: 0.80, high: 0.90, color: "#fff9c4" },
      { name: "Zone 3", low: 0.90, high: 1.00, color: "#ffe082" },
      { name: "Zone 4", low: 1.00, high: 1.05, color: "#ffccbc" },
      { name: "Zone 5", low: 1.05, high: null, color: "#ef9a9a" }
    ];
    window.runZones = runZones;

    output += "<h3>Running Zones (based on CS)</h3><table><tr><th>Zone</th><th>%CS</th><th>Pace</th></tr>";
    runZones.forEach(z => {
      const lowSpeed = CS * z.low;
      const highSpeed = z.high ? CS * z.high : Infinity;
      const lowPace = formatPace(1000 / lowSpeed);
      const highPace = z.high ? formatPace(1000 / highSpeed) : "faster";
      output += `<tr style="background:${z.color};"><td>${z.name}</td><td>${(z.low * 100).toFixed(0)}${z.high ? "–" + (z.high * 100).toFixed(0) : "+"}%</td><td>${lowPace} – ${highPace}</td></tr>`;
    });
    output += "</table>";

    document.getElementById("run-results").innerHTML = output;
  });


  // ============================================
  // RUNNING SESSION GENERATOR
  // ============================================
  document.getElementById("generate-run-session").addEventListener("click", function () {
    if (!window.CS) {
      alert("Please calculate Critical Speed (CS) first!");
      return;
    }

    const text = document.getElementById("run-session-input").value;
    const lines = text.split("\n").map(l => l.trim()).filter(l => l);

    let intervals = [];
    let descriptors = [];
    let currentDesc = "";

    lines.forEach(line => {
      if (line.includes(">>")) {
        currentDesc = line.replace(">>", "").trim();
      } else {
        const repeatMatch = line.match(/(\d+)x\s*\((.+)\)/i);
        if (repeatMatch) {
          const reps = parseInt(repeatMatch[1], 10);
          const block = repeatMatch[2].split(",").map(s => s.trim());
          for (let r = 0; r < reps; r++) {
            block.forEach(b => parseRunInterval(b, intervals, currentDesc, descriptors));
          }
        } else {
          parseRunInterval(line, intervals, currentDesc, descriptors);
        }
      }
    });

    if (intervals.length === 0) {
      alert("No valid running session lines found. Use format: '10min @ 95%CS' or '1k @ 95%CS'.");
      return;
    }

    let t = 0;
    let data = [];
    let sectionLabels = [];

    intervals.forEach(intv => {
      for (let i = 0; i < intv.dur; i++) {
        t++;
        const timeMin = t / 60;
        data.push({
          x: timeMin,
          y: intv.intensity * 100,
          pace: formatPace(intv.pace)
        });
      }
      if (intv.desc) {
        sectionLabels.push({
          x: t / 60 - intv.dur / 120,
          y: intv.intensity * 100 + 5,
          text: `${intv.desc} (${formatPace(intv.pace)})`
        });
      }
    });

    const ctx = document.getElementById("run-session-graph").getContext("2d");
    if (window.runSessionChart) window.runSessionChart.destroy();

    window.runSessionChart = new Chart(ctx, {
      type: 'bar',
      data: {
        datasets: [{
          label: "Running Intensity (%CS)",
          data: data,
          parsing: false,
          backgroundColor: data.map(d => {
            const zone = window.runZones.find(z => d.y / 100 >= z.low && (!z.high || d.y / 100 < z.high));
            return zone ? zone.color : "#90caf9";
          })
        }]
      },
      options: {
        plugins: {
          tooltip: {
            callbacks: {
              label: function (context) {
                return `Pace: ${context.raw.pace}`;
              }
            }
          },
          annotation: {
            annotations: sectionLabels.map((s, i) => ({
              type: 'label',
              xValue: s.x,
              yValue: s.y,
              backgroundColor: 'rgba(0,0,0,0)',
              content: [s.text],
              font: { weight: "bold" },
              rotation: -90
            }))
          }
        },
        scales: {
          x: { type: 'linear', title: { display: true, text: "Time (min)" }, min: 0 },
          y: { title: { display: true, text: "%CS" }, min: 50, max: 130 }
        }
      }
    });
    const speedData = intervals.flatMap(intv => Array(intv.dur).fill(window.CS * intv.intensity));
updateRunMetrics(speedData, window.CS);
window.runIntervals = intervals; // optional: for export
  });



  function parseRunInterval(str, intervals, currentDesc, descriptors) {
    // Match time-based %CS
    let match = str.match(/(?:(\d+)min)?\s*(?:(\d+)sec)?\s*@\s*(\d+)(?:-(\d+))?%CS/i);
    if (match) {
      const mins = parseInt(match[1] || 0, 10);
      const secs = parseInt(match[2] || 0, 10);
      const dur = mins * 60 + secs;
      const percLow = parseInt(match[3], 10) / 100;
      const percHigh = match[4] ? parseInt(match[4], 10) / 100 : percLow;
      const perc = (percLow + percHigh) / 2;
      const speed = window.CS * perc;
      const pace = 1000 / speed;
      intervals.push({ dur, intensity: perc, pace, desc: currentDesc });
      return;
    }

    // Match distance-based %CS (e.g., 1k @ 95%CS or 400m @ 100%CS)
    match = str.match(/(\d+)(m|km)\s*@\s*(\d+)(?:-(\d+))?%CS/i);
    if (match) {
      const dist = parseInt(match[1], 10) * (match[2] === "km" ? 1000 : 1);
      const percLow = parseInt(match[3], 10) / 100;
      const percHigh = match[4] ? parseInt(match[4], 10) / 100 : percLow;
      const perc = (percLow + percHigh) / 2;
      const speed = window.CS * perc;
      const pace = 1000 / speed;
      const dur = dist / speed;
      intervals.push({ dur, intensity: perc, pace, desc: currentDesc });
    }
  }

  // === PDF Export for Cycling ===
  const cyclePdfBtn = document.getElementById("download-pdf");
  if (cyclePdfBtn) {
    cyclePdfBtn.addEventListener("click", async () => {
      const { jsPDF } = window.jspdf;
      const doc = new jsPDF("p", "mm", "a4");

      doc.setFontSize(18);
      doc.text("Cycling Conditioning Analysis Report", 14, 20);

      let y = 30;

      // Collect results content
      const resultsHtml = document.getElementById("results").innerHTML;
      const tempDiv = document.createElement("div");
      tempDiv.innerHTML = resultsHtml;

      Array.from(tempDiv.querySelectorAll("p, h3, table")).forEach(el => {
        if (el.tagName === "P" || el.tagName === "H3") {
          doc.setFontSize(el.tagName === "H3" ? 14 : 11);
          doc.text(el.innerText, 14, y);
          y += 8;
        } else if (el.tagName === "TABLE") {
          const rows = Array.from(el.querySelectorAll("tr")).map(tr =>
            Array.from(tr.querySelectorAll("td,th")).map(td => td.innerText)
          );
          doc.autoTable({ head: [rows[0]], body: rows.slice(1), startY: y });
          y = doc.lastAutoTable.finalY + 10;
        }
      });

      // Add session plan text
      const sessionPlan = document.getElementById("session-input").value;
      if (sessionPlan) {
        doc.setFontSize(14);
        doc.text("Cycling Session Plan", 14, y);
        y += 8;
        doc.setFontSize(11);
        sessionPlan.split("\n").forEach(line => {
          doc.text(line, 20, y);
          y += 6;
        });
        y += 10;
      }

      // Add session metrics
const metrics = [
  { label: "Average Power", id: "avg-power", unit: "W" },
  { label: "Normalized Power", id: "np", unit: "W" },
  { label: "Variability Index", id: "vi", unit: "" },
  { label: "Total Work", id: "work", unit: "kJ" },
  { label: "Work Above CP", id: "work-above", unit: "kJ" },
  { label: "Intensity Factor", id: "if", unit: "" },
  { label: "Load (TSS)", id: "tss", unit: "" }
];

doc.setFontSize(14);
doc.text("Session Metrics", 14, y);
y += 8;
doc.setFontSize(11);

metrics.forEach(m => {
  const value = document.getElementById(m.id)?.textContent || "--";
  doc.text(`${m.label}: ${value} ${m.unit}`, 20, y);
  y += 6;
});

y += 10;

      // Add the chart image, scaled nicely
      const canvas = document.getElementById("session-graph");
      if (canvas) {
        const imgData = canvas.toDataURL("image/png", 1.0);
        const pageWidth = doc.internal.pageSize.getWidth() - 30;
        const imgWidth = pageWidth;
        const imgHeight = (canvas.height / canvas.width) * imgWidth;

        // If image too tall, add new page
        if (y + imgHeight > doc.internal.pageSize.getHeight() - 20) {
          doc.addPage();
          y = 20;
        }

        doc.addImage(imgData, "PNG", 15, y, imgWidth, imgHeight);
      }

      doc.save("Cycling_Report.pdf");
    });
  }
  // === PDF Export for Running ===
const runPdfBtn = document.getElementById("download-run-pdf");
if (runPdfBtn) {
  runPdfBtn.addEventListener("click", async () => {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF("p", "mm", "a4");

    doc.setFontSize(18);
    doc.text("Running Conditioning Analysis Report", 14, 20);

    let y = 30;

    // Collect results
    const resultsHtml = document.getElementById("run-results").innerHTML;
    const tempDiv = document.createElement("div");
    tempDiv.innerHTML = resultsHtml;

    Array.from(tempDiv.querySelectorAll("p, h3, table")).forEach(el => {
      if (el.tagName === "P" || el.tagName === "H3") {
        doc.setFontSize(el.tagName === "H3" ? 14 : 11);
        doc.text(el.innerText, 14, y);
        y += 8;
      } else if (el.tagName === "TABLE") {
        const rows = Array.from(el.querySelectorAll("tr")).map(tr =>
          Array.from(tr.querySelectorAll("td,th")).map(td => td.innerText)
        );
        doc.autoTable({ head: [rows[0]], body: rows.slice(1), startY: y });
        y = doc.lastAutoTable.finalY + 10;
      }
    });

    // Add run session plan
    const sessionPlan = document.getElementById("run-session-input").value;
    if (sessionPlan) {
      doc.setFontSize(14);
      doc.text("Running Session Plan", 14, y);
      y += 8;
      doc.setFontSize(11);
      sessionPlan.split("\n").forEach(line => {
        doc.text(line, 20, y);
        y += 6;
      });
      y += 10;
    }

    // Add run metrics
    const runMetrics = [
      { label: "Avg Speed", id: "run-avg-speed", unit: "m/s" },
      { label: "Avg Pace", id: "run-avg-pace", unit: "" },
      { label: "Normalized Speed", id: "run-ns", unit: "m/s" },
      { label: "Normalized Pace", id: "run-ns-pace", unit: "" },
      { label: "Variability Index", id: "run-vi", unit: "" },
      { label: "Intensity Factor", id: "run-if", unit: "" },
      { label: "Load (TSS)", id: "run-tss", unit: "" }
    ];

    doc.setFontSize(14);
    doc.text("Session Metrics", 14, y);
    y += 8;
    doc.setFontSize(11);

    runMetrics.forEach(m => {
      const value = document.getElementById(m.id)?.textContent || "--";
      doc.text(`${m.label}: ${value} ${m.unit}`, 20, y);
      y += 6;
    });

    y += 10;

    // Add run session chart image
    const canvas = document.getElementById("run-session-graph");
    if (canvas) {
      const imgData = canvas.toDataURL("image/png", 1.0);
      const pageWidth = doc.internal.pageSize.getWidth() - 30;
      const imgWidth = pageWidth;
      const imgHeight = (canvas.height / canvas.width) * imgWidth;

      if (y + imgHeight > doc.internal.pageSize.getHeight() - 20) {
        doc.addPage();
        y = 20;
      }

      doc.addImage(imgData, "PNG", 15, y, imgWidth, imgHeight);
    }

    doc.save("Running_Report.pdf");
  });
}

  // ============================================
  // LOCAL STORAGE + SAVE / RECALL ATHLETE DATA
  // ============================================

  // === AUTO-SAVE individual form fields ===
  const cpForm = document.getElementById("cp-form");
  if (cpForm) {
    ["cp-name", "1min", "3min", "6min", "12min", "20min"].forEach(id => {
      const saved = localStorage.getItem("cpform-" + id);
      if (saved) document.getElementById(id).value = saved;
    });
    cpForm.addEventListener("input", e => {
      if (e.target.id) localStorage.setItem("cpform-" + e.target.id, e.target.value);
    });
  }

  const csForm = document.getElementById("cs-form");
  if (csForm) {
    ["cs-name", "1km", "3km", "5km", "10km"].forEach(id => {
      const saved = localStorage.getItem("csform-" + id);
      if (saved) document.getElementById(id).value = saved;
    });
    csForm.addEventListener("input", e => {
      if (e.target.id) localStorage.setItem("csform-" + e.target.id, e.target.value);
    });
  }

  // === SAVE / RECALL ATHLETE DATA for CP Form ===
  const saveButton = document.getElementById("save-athlete");
  const select = document.getElementById("athlete-select");

  if (saveButton && select && cpForm) {
    updateAthleteList();

    saveButton.addEventListener("click", e => {
      e.preventDefault(); // prevent form refresh if inside <form>
      console.log("Save button clicked ✅");

      const name = cpForm.querySelector("#cp-name").value.trim();
      if (!name) {
        alert("Please enter a name before saving.");
        return;
      }

      const formData = { name };

      // Save all number inputs by ID
      cpForm.querySelectorAll("input[type='number']").forEach(input => {
        formData[input.id] = input.value;
      });

      // Handle model radio safely
      const modelRadio = cpForm.querySelector("input[name='Model']:checked");
      formData.model = modelRadio ? modelRadio.value : "";

      // Save to localStorage
      localStorage.setItem(`athlete_${name}`, JSON.stringify(formData));
      alert(`Saved data for ${name}`);

      updateAthleteList();
      select.value = name;
    });

    select.addEventListener("change", () => {
      const selected = select.value;
      if (!selected) return;

      const data = JSON.parse(localStorage.getItem(`athlete_${selected}`));
      if (!data) return;

      cpForm.querySelector("#cp-name").value = data.name || "";

      cpForm.querySelectorAll("input[type='number']").forEach(input => {
        if (data[input.id] !== undefined) input.value = data[input.id];
      });

      const modelRadio = cpForm.querySelector(`input[value='${data.model}']`);
      if (modelRadio) modelRadio.checked = true;
    });

    function updateAthleteList() {
      select.innerHTML = "<option value=''>Select athlete</option>";
      Object.keys(localStorage)
        .filter(key => key.startsWith("athlete_"))
        .forEach(key => {
          const name = key.replace("athlete_", "");
          const opt = document.createElement("option");
          opt.value = name;
          opt.textContent = name;
          select.appendChild(opt);
        });
    }
  }
});