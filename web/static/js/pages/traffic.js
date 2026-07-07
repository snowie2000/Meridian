// Traffic statistics page
let trafficRefreshTimer = null;
let trafficChartLoading = false;

function renderTraffic() {
  const page = document.getElementById('page-traffic');
  page.innerHTML = `
    <h1 class="section-title fade-up">流量统计</h1>
    <p class="section-sub fade-up stagger-1">查看各站点流量使用情况</p>
    <div class="controls-row fade-up stagger-1">
      <select class="form-select" id="traffic-site-select">
        <option value="">加载中...</option>
      </select>
      <select class="form-select" id="traffic-hours-select">
        <option value="24">最近 24 小时</option>
        <option value="168">最近 7 天</option>
        <option value="720">最近 30 天</option>
      </select>
    </div>
    <div class="chart-wrap fade-up stagger-2">
      <div class="chart-head">
        <h3>流量趋势</h3>
        <div class="chart-legend">
          <div class="legend-item"><div class="legend-dot in"></div>入站流量</div>
          <div class="legend-item"><div class="legend-dot out"></div>出站流量</div>
        </div>
      </div>
      <canvas id="trafficChart"></canvas>
    </div>
    <div class="traffic-totals" id="traffic-totals">
      <div class="total-card fade-up stagger-3">
        <div class="total-label">入站流量</div>
        <div class="total-value" id="traffic-total-in">0 B</div>
      </div>
      <div class="total-card fade-up stagger-4">
        <div class="total-label">出站流量</div>
        <div class="total-value" id="traffic-total-out">0 B</div>
      </div>
      <div class="total-card fade-up stagger-5">
        <div class="total-label">累计使用</div>
        <div class="total-value" id="traffic-total-used">0 B</div>
        <div class="total-delta" id="traffic-total-quota" style="color:var(--white-38)"></div>
      </div>
    </div>
  `;

  loadTrafficSites();
  startTrafficRefresh();

  document.getElementById('traffic-site-select').onchange = loadTrafficChart;
  document.getElementById('traffic-hours-select').onchange = loadTrafficChart;
}

function startTrafficRefresh() {
  if (trafficRefreshTimer) return;
  trafficRefreshTimer = setInterval(() => {
    if (Router.current === 'traffic' && API.token) loadTrafficChart();
  }, 5000);
}

async function loadTrafficSites() {
  try {
    const sites = await API.listSites();
    const sel = document.getElementById('traffic-site-select');
    if (!sites || sites.length === 0) {
      sel.innerHTML = '<option value="">暂无站点</option>';
      return;
    }
    sel.innerHTML = sites.map(s => `<option value="${s.id}">${esc(s.name)}</option>`).join('');
    loadTrafficChart();
  } catch (e) {
    if (API.isAuthExpiredError(e)) return;
    Toast.error('加载站点失败');
  }
}

async function loadTrafficChart() {
  const siteId = document.getElementById('traffic-site-select').value;
  const hours = parseInt(document.getElementById('traffic-hours-select').value);
  if (!siteId || trafficChartLoading) return;

  try {
    trafficChartLoading = true;
    const logs = await API.getTraffic(siteId, hours);
    const sites = await API.listSites();
    const site = sites.find(s => s.id === parseInt(siteId));

    // Update totals
    const totalIn = logs.reduce((a, l) => a + (l.bytes_in || 0), 0);
    const totalOut = logs.reduce((a, l) => a + (l.bytes_out || 0), 0);

    updateTrafficTotals(totalIn, totalOut, site);

    drawTrafficChart(logs, hours);
  } catch (e) {
    if (API.isAuthExpiredError(e)) return;
    console.error('Traffic load error:', e);
  } finally {
    trafficChartLoading = false;
  }
}

function updateTrafficTotals(totalIn, totalOut, site) {
  setTextIfChanged('traffic-total-in', formatBytes(totalIn));
  setTextIfChanged('traffic-total-out', formatBytes(totalOut));
  setTextIfChanged('traffic-total-used', formatBytes(site ? site.traffic_used : 0));
  setTextIfChanged('traffic-total-quota', site && site.traffic_quota > 0 ? '额度 ' + formatBytes(site.traffic_quota) : '');
}

function setTextIfChanged(id, value) {
  const el = document.getElementById(id);
  if (el && el.textContent !== value) el.textContent = value;
}

function drawTrafficChart(logs, hours, hoverIndex) {
  const canvas = document.getElementById('trafficChart');
  if (!canvas) return;
  canvas._trafficLogs = logs;
  canvas._trafficHours = hours;
  if (hoverIndex === undefined && typeof canvas._trafficHoverIndex === 'number') {
    hoverIndex = canvas._trafficHoverIndex;
  }
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  const w = rect.width || canvas.clientWidth || canvas.parentElement.clientWidth;
  const h = rect.height || 280;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  canvas.style.cursor = 'crosshair';
  ctx.scale(dpr, dpr);

  const pad = { top: 24, right: 24, bottom: 54, left: 54 };
  const cw = w - pad.left - pad.right;
  const ch = h - pad.top - pad.bottom;

  // Prepare data arrays
  const numPoints = Math.min(hours, 24);
  const inbound = new Array(numPoints).fill(0);
  const outbound = new Array(numPoints).fill(0);
  const now = Date.now();
  const bucketMs = hours * 3600000 / numPoints;
  const rightBucket = new Date(now);
  rightBucket.setMinutes(0, 0, 0);
  const rangeStart = rightBucket.getTime() - (numPoints - 1) * bucketMs;

  if (logs.length > 0) {
    logs.forEach(l => {
      const t = parseTrafficRecordedAt(l.recorded_at);
      let idx = Math.round((t - rangeStart) / bucketMs);
      if (idx >= 0 && idx < numPoints) {
        inbound[idx] += l.bytes_in / (1024 * 1024); // Convert to MB
        outbound[idx] += l.bytes_out / (1024 * 1024);
      }
    });
  }

  const maxV = Math.max(1, ...inbound, ...outbound) * 1.2;
  const x = i => pad.left + (i / (numPoints - 1 || 1)) * cw;
  const y = v => pad.top + (1 - v / maxV) * ch;
  const bottom = pad.top + ch;

  // Clear
  ctx.clearRect(0, 0, w, h);

  // Grid lines
  ctx.strokeStyle = 'rgba(255,255,255,.04)';
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const yy = pad.top + (i / 4) * ch;
    ctx.beginPath(); ctx.moveTo(pad.left, yy); ctx.lineTo(w - pad.right, yy); ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,.2)';
    ctx.font = '11px Inter, system-ui';
    ctx.textAlign = 'right';
    const label = ((4 - i) / 4 * maxV).toFixed(0);
    ctx.fillText(label + ' MB', pad.left - 12, yy + 4);
  }

  // X axis
  ctx.strokeStyle = 'rgba(255,255,255,.16)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(pad.left, bottom);
  ctx.lineTo(w - pad.right, bottom);
  ctx.stroke();

  ctx.strokeStyle = 'rgba(255,255,255,.07)';
  for (let i = 0; i < numPoints; i++) {
    const tickX = x(i);
    ctx.beginPath();
    ctx.moveTo(tickX, bottom);
    ctx.lineTo(tickX, bottom + 3);
    ctx.stroke();
  }

  ctx.fillStyle = 'rgba(255,255,255,.38)';
  ctx.font = '11px Inter, system-ui';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  const labelIndexes = trafficAxisLabelIndexes(numPoints, cw, hours);
  labelIndexes.forEach(i => {
    const tickX = x(i);
    ctx.strokeStyle = 'rgba(255,255,255,.12)';
    ctx.beginPath();
    ctx.moveTo(tickX, bottom);
    ctx.lineTo(tickX, bottom + 5);
    ctx.stroke();
    const labelTime = i === numPoints - 1 ? new Date(now) : new Date(rangeStart + i * bucketMs);
    ctx.fillText(formatAxisTime(labelTime, hours), tickX, bottom + 9);
  });

  // Empty state
  if (logs.length === 0) {
    ctx.fillStyle = 'rgba(255,255,255,.2)';
    ctx.font = '14px Inter, system-ui';
    ctx.textAlign = 'center';
    ctx.fillText('暂无流量数据', w / 2, h / 2);
    return;
  }

  // Draw lines
  function smoothLine(data, color, glowColor) {
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(x(0), y(data[0]));
    for (let i = 1; i < data.length; i++) {
      const xc = (x(i - 1) + x(i)) / 2;
      const yc = (y(data[i - 1]) + y(data[i])) / 2;
      ctx.quadraticCurveTo(x(i - 1), y(data[i - 1]), xc, yc);
    }
    ctx.lineTo(x(data.length - 1), y(data[data.length - 1]));

    ctx.shadowColor = glowColor;
    ctx.shadowBlur = 16;
    ctx.strokeStyle = color;
    ctx.lineWidth = 2.5;
    ctx.stroke();
    ctx.shadowBlur = 0;

    // Area fill
    ctx.lineTo(x(data.length - 1), pad.top + ch);
    ctx.lineTo(x(0), pad.top + ch);
    ctx.closePath();
    const grad = ctx.createLinearGradient(0, pad.top, 0, pad.top + ch);
    grad.addColorStop(0, color.replace(')', ',.12)').replace('rgb', 'rgba'));
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.restore();
  }

  smoothLine(outbound, 'rgb(100,210,255)', 'rgba(100,210,255,.4)');
  smoothLine(inbound, 'rgb(10,132,255)', 'rgba(10,132,255,.4)');

  if (typeof hoverIndex === 'number') {
    drawTrafficHover(ctx, {
      hoverIndex,
      inbound,
      outbound,
      hours,
      numPoints,
      now,
      rangeStart,
      bucketMs,
      pad,
      w,
      bottom,
      x,
    });
  }

  bindTrafficChartHover(canvas, Array.from({ length: numPoints }, (_, i) => x(i)));
}

function trafficAxisLabelIndexes(numPoints, chartWidth, hours) {
  const minLabelWidth = hours <= 24 ? 48 : 76;
  const maxLabels = Math.max(4, Math.min(numPoints, Math.floor(chartWidth / minLabelWidth)));
  if (maxLabels >= numPoints) return Array.from({ length: numPoints }, (_, i) => i);

  const indexes = [];
  const step = Math.ceil((numPoints - 1) / (maxLabels - 1));
  for (let i = 0; i < numPoints; i += step) indexes.push(i);
  if (indexes[indexes.length - 1] !== numPoints - 1) indexes.push(numPoints - 1);
  return indexes;
}

function bindTrafficChartHover(canvas, pointXs) {
  canvas._trafficHoverMeta = { pointXs };
  if (canvas._trafficHoverBound) return;
  canvas._trafficHoverBound = true;

  canvas.addEventListener('mousemove', e => {
    const meta = canvas._trafficHoverMeta;
    if (!meta || !canvas._trafficLogs) return;

    const rect = canvas.getBoundingClientRect();
    const localX = e.clientX - rect.left;
    const idx = trafficHoverIndexFromX(localX, meta);
    if (idx !== canvas._trafficHoverIndex) {
      canvas._trafficHoverIndex = idx;
      drawTrafficChart(canvas._trafficLogs, canvas._trafficHours, idx);
    }
  });

  canvas.addEventListener('mouseleave', () => {
    if (canvas._trafficHoverIndex === null || canvas._trafficHoverIndex === undefined) return;
    canvas._trafficHoverIndex = null;
    drawTrafficChart(canvas._trafficLogs || [], canvas._trafficHours || 24, null);
  });
}

function trafficHoverIndexFromX(localX, meta) {
  const points = meta.pointXs || [];
  if (points.length <= 1) return 0;
  if (localX <= points[0]) return 0;
  if (localX >= points[points.length - 1]) return points.length - 1;

  let bestIdx = 0;
  let bestDist = Infinity;
  for (let i = 0; i < points.length; i++) {
    const dist = Math.abs(localX - points[i]);
    if (dist < bestDist) {
      bestDist = dist;
      bestIdx = i;
    }
  }
  return bestIdx;
}

function drawTrafficHover(ctx, state) {
  const idx = state.hoverIndex;
  const hoverX = state.x(idx);
  const inboundBytes = state.inbound[idx] * 1024 * 1024;
  const outboundBytes = state.outbound[idx] * 1024 * 1024;
  const time = idx === state.numPoints - 1
    ? new Date(state.now)
    : new Date(state.rangeStart + idx * state.bucketMs);

  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,.28)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(hoverX, state.pad.top);
  ctx.lineTo(hoverX, state.bottom);
  ctx.stroke();

  const lines = [
    formatHoverTime(time, state.hours),
    '入站 ' + formatBytes(inboundBytes),
    '出站 ' + formatBytes(outboundBytes),
  ];
  ctx.font = '12px Inter, system-ui';
  const boxW = Math.max(...lines.map(line => ctx.measureText(line).width)) + 24;
  const boxH = 76;
  let boxX = hoverX + 12;
  if (boxX + boxW > state.w - 12) boxX = hoverX - boxW - 12;
  const boxY = state.pad.top + 8;

  ctx.fillStyle = 'rgba(22,24,29,.96)';
  ctx.strokeStyle = 'rgba(255,255,255,.16)';
  ctx.lineWidth = 1;
  roundRect(ctx, boxX, boxY, boxW, boxH, 8);
  ctx.fill();
  ctx.stroke();

  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillStyle = 'rgba(255,255,255,.76)';
  ctx.fillText(lines[0], boxX + 12, boxY + 10);
  ctx.fillStyle = 'rgb(10,132,255)';
  ctx.fillText(lines[1], boxX + 12, boxY + 32);
  ctx.fillStyle = 'rgb(100,210,255)';
  ctx.fillText(lines[2], boxX + 12, boxY + 52);
  ctx.restore();
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function formatAxisTime(date, hours) {
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  if (hours <= 24) return hh + ':' + mm;
  return (date.getMonth() + 1) + '/' + date.getDate() + ' ' + hh + ':' + mm;
}

function formatHoverTime(date, hours) {
  const yyyy = date.getFullYear();
  const mo = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  if (hours <= 24) return hh + ':' + mm;
  return yyyy + '-' + mo + '-' + dd + ' ' + hh + ':' + mm;
}

function parseTrafficRecordedAt(value) {
  if (typeof value !== 'string') return new Date(value).getTime();
  const normalized = value.replace('T', ' ').replace(/Z$/, '');
  const match = normalized.match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})/);
  if (!match) return new Date(value).getTime();
  return new Date(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    Number(match[4]),
    Number(match[5]),
    Number(match[6])
  ).getTime();
}

window.addEventListener('resize', () => {
  if (Router.current === 'traffic') {
    const canvas = document.getElementById('trafficChart');
    if (canvas) loadTrafficChart();
  }
});
