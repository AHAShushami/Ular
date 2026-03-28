// Google Sheets data source
const SPREADSHEET_ID = "2PACX-1vQ3_hIsLiJsYCKrqcNgfVyk1eEyLbSepimBIHw6mIyKrLuemccUsGNVFA_HxdSpJ_rWBvU1P1vfBDI1";
const GID = "457876414";
const RAW_CSV_URL = `https://docs.google.com/spreadsheets/d/e/${SPREADSHEET_ID}/pub?gid=${GID}&single=true&output=csv`;

const FETCH_ENDPOINTS = [
    RAW_CSV_URL,
    `https://api.allorigins.win/raw?url=${encodeURIComponent(RAW_CSV_URL)}`,
    `https://corsproxy.io/?${encodeURIComponent(RAW_CSV_URL)}`,
    `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(RAW_CSV_URL)}`,
];

const SPECIES_FIELD = "Nyatakan Spesis Ular Jika Kes Patukan Ular";

let casesData = [];
let filteredData = [];
let hospitalChartInst = null;
let typeChartInst = null;
let speciesChartInst = null;
let timelineChartInst = null;

// ─── Date Parsing Helper ────────────────────────────────────────
// The CSV dates come in DD/MM/YYYY format. Parse to a Date object.
function parseDate(dateStr) {
    if (!dateStr) return null;
    const trimmed = dateStr.trim();
    // Try DD/MM/YYYY
    const parts = trimmed.split('/');
    if (parts.length === 3) {
        const d = parseInt(parts[0], 10);
        const m = parseInt(parts[1], 10) - 1;
        const y = parseInt(parts[2], 10);
        if (!isNaN(d) && !isNaN(m) && !isNaN(y)) {
            return new Date(y, m, d);
        }
    }
    // Fallback: try native parsing
    const fallback = new Date(trimmed);
    return isNaN(fallback.getTime()) ? null : fallback;
}

// Format date as YYYY-MM-DD (for <input type="date">)
function toISODate(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

// Format date as DD/MM/YYYY for display
function toDisplayDate(date) {
    const d = String(date.getDate()).padStart(2, '0');
    const m = String(date.getMonth() + 1).padStart(2, '0');
    return `${d}/${m}/${date.getFullYear()}`;
}

// ─── Loading / Error UI helpers ─────────────────────────────────
function showLoading() {
    const container = document.querySelector('.dashboard-container');
    const prev = document.getElementById('loadingOverlay');
    if (prev) prev.remove();

    const overlay = document.createElement('div');
    overlay.id = 'loadingOverlay';
    overlay.innerHTML = `
        <div class="loading-spinner"></div>
        <p>Memuatkan data daripada Google Sheets…</p>
        <p class="loading-sub">Sila tunggu sebentar</p>
    `;
    container.prepend(overlay);
}

function hideLoading() {
    const overlay = document.getElementById('loadingOverlay');
    if (overlay) overlay.remove();
}

function showNetworkError(message) {
    hideLoading();
    document.getElementById('totalCasesVal').innerText = "–";
    document.getElementById('heatCasesVal').innerText = "–";
    document.getElementById('snakeCasesVal').innerText = "–";
    document.getElementById('unreportedSpeciesVal').innerText = "–";

    const dashboardHeader = document.querySelector('.header-status');
    if (dashboardHeader) {
        dashboardHeader.classList.add('error');
        document.getElementById('syncStatusText').innerText = 'Ralat Sambungan';
    }

    const tbody = document.getElementById('casesTbody');
    tbody.innerHTML = `
        <tr>
            <td colspan="6" style="text-align:center; padding:3rem 1rem;">
                <div style="display:flex; flex-direction:column; align-items:center; gap:1rem;">
                    <svg width="48" height="48" fill="none" stroke="#dc2626" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path></svg>
                    <strong style="color:#dc2626; font-size:1.1rem;">${message}</strong>
                    <p style="color:#64748b; max-width:500px; font-size:0.9rem;">
                        Pastikan anda mempunyai akses Internet dan tidak disekat oleh Firewall hospital/klinik.<br>
                        Cuba buka <a href="${RAW_CSV_URL}" target="_blank" style="color:#0f4c81;">pautan Google Sheets ini</a> untuk mengesahkan.
                    </p>
                    <button onclick="location.reload()" style="background:#0f4c81; color:white; border:none; padding:0.6rem 1.5rem; border-radius:8px; cursor:pointer; font-size:0.9rem; font-weight:600;">
                        ↻ Cuba Semula
                    </button>
                </div>
            </td>
        </tr>
    `;
}

// ─── Species Helpers ────────────────────────────────────────────
function isSpeciesReported(speciesValue) {
    if (!speciesValue) return false;
    const trimmed = speciesValue.trim().toUpperCase();
    if (trimmed === '' || trimmed === 'TIADA' || trimmed === '-' || trimmed === 'N/A' || trimmed === 'NIL') return false;
    return true;
}

function normalizeSpecies(raw) {
    if (!isSpeciesReported(raw)) return "Tidak Dilaporkan";
    const lower = raw.trim().toLowerCase();
    if (lower.includes("malayan pit viper") || lower.includes("malayan pit vaper") || lower.includes("calloselasma") || lower.includes("kapak")) return "Malayan Pit Viper";
    if (lower.includes("non venomous") || lower.includes("non-venomous") || lower.includes("nonvenomous") || lower.includes("colegnathus") || lower.includes("coelognathus")) return "Non-Venomous Snake";
    if (lower.includes("unidentified") || lower.includes("unindentified") || lower.includes("alleged snake") || lower.includes("alleged indentified")) return "Tidak Dikenal Pasti";
    if (lower.includes("viper")) return "Viper (Lain-lain)";
    return raw.trim().length > 40 ? raw.trim().substring(0, 40) + "…" : raw.trim();
}

// ─── Data Fetching (parallel race — fastest valid response wins) ─
async function fetchCSVData() {
    const allEndpoints = [
        ...FETCH_ENDPOINTS,
        `https://docs.google.com/spreadsheets/d/e/${SPREADSHEET_ID}/gviz/tq?tqx=out:csv&gid=${GID}`,
    ];

    // Race all endpoints in parallel
    const fetchOne = async (endpoint) => {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 8000);
        try {
            const response = await fetch(endpoint, { cache: "no-store", signal: controller.signal });
            clearTimeout(timeoutId);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const text = await response.text();
            if (text && text.includes('Timestamp')) {
                console.log(`[Dashboard] ✓ Fast response from: ${endpoint.substring(0, 50)}…`);
                return text;
            }
            throw new Error("Invalid CSV content");
        } catch (e) {
            clearTimeout(timeoutId);
            console.warn(`[Dashboard] ✗ ${endpoint.substring(0, 50)}… → ${e.message}`);
            throw e;
        }
    };

    try {
        return await Promise.any(allEndpoints.map(fetchOne));
    } catch (e) {
        throw new Error("Unable to connect to Google Sheets from any endpoint.");
    }
}

// ─── Dashboard Init ─────────────────────────────────────────────
async function initDashboard() {
    showLoading();
    try {
        const csvText = await fetchCSVData();
        Papa.parse(csvText, {
            header: true,
            skipEmptyLines: true,
            complete: function (results) {
                hideLoading();
                if (!results.data || results.data.length === 0) {
                    showNetworkError("Tiada data dijumpai (No data found)");
                    return;
                }
                casesData = results.data;
                filteredData = casesData; // Start with all data
                processAndRender(filteredData);
                const statusText = document.getElementById('syncStatusText');
                if (statusText) statusText.innerText = `Masa Nyata · ${casesData.length} rekod`;
                document.querySelector('.header-status')?.classList.remove('error');
            },
            error: function (err) {
                console.error("Parse error:", err);
                showNetworkError("Kesilapan Format Data (Parse Error)");
            },
        });
    } catch (error) {
        console.error("Init error:", error);
        showNetworkError("Gagal memuat data — Rangkaian disekat / tiada Internet");
    }
}

// ─── Date Filtering ─────────────────────────────────────────────
function applyDateFilter() {
    const fromInput = document.getElementById('filterFrom').value;
    const toInput = document.getElementById('filterTo').value;

    if (!fromInput && !toInput) {
        filteredData = casesData;
    } else {
        const fromDate = fromInput ? new Date(fromInput + 'T00:00:00') : null;
        const toDate = toInput ? new Date(toInput + 'T23:59:59') : null;

        filteredData = casesData.filter(row => {
            const dateStr = row['Tarikh Kejadian'] || row['Tarikh Notifikasi'];
            const rowDate = parseDate(dateStr);
            if (!rowDate) return false;
            if (fromDate && rowDate < fromDate) return false;
            if (toDate && rowDate > toDate) return false;
            return true;
        });
    }

    processAndRender(filteredData);

    // Update status
    const statusText = document.getElementById('syncStatusText');
    if (filteredData.length === casesData.length) {
        statusText.innerText = `Masa Nyata · ${casesData.length} rekod`;
    } else {
        statusText.innerText = `Ditapis · ${filteredData.length} / ${casesData.length} rekod`;
    }
}

function setPresetFilter(days) {
    // Update active state on preset buttons
    document.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('active'));
    event.target.classList.add('active');

    if (days === 'all') {
        document.getElementById('filterFrom').value = '';
        document.getElementById('filterTo').value = '';
    } else {
        const today = new Date();
        const from = new Date();
        from.setDate(today.getDate() - parseInt(days));
        document.getElementById('filterFrom').value = toISODate(from);
        document.getElementById('filterTo').value = toISODate(today);
    }
    applyDateFilter();
}

// Wire up filter controls
document.getElementById('applyFilterBtn').addEventListener('click', () => {
    document.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('active'));
    applyDateFilter();
});

document.getElementById('resetFilterBtn').addEventListener('click', () => {
    document.getElementById('filterFrom').value = '';
    document.getElementById('filterTo').value = '';
    document.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('active'));
    document.querySelector('.preset-btn[data-days="all"]').classList.add('active');
    applyDateFilter();
});

document.querySelectorAll('.preset-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
        setPresetFilter(btn.dataset.days);
    });
});

// ─── Data Processing & Rendering ────────────────────────────────
function processAndRender(data) {
    if (!data || data.length === 0) {
        document.getElementById('totalCasesVal').innerText = "0";
        document.getElementById('heatCasesVal').innerText = "0";
        document.getElementById('snakeCasesVal').innerText = "0";
        document.getElementById('unreportedSpeciesVal').innerText = "0";
        renderTable([]);
        return;
    }

    let heatCases = 0;
    let snakeCases = 0;
    let unreportedSpecies = 0;
    let hospitalCounts = {};
    let speciesCounts = {};
    let dateCounts = {}; // { "YYYY-MM-DD": { heat: N, snake: N } }

    data.forEach((item) => {
        const diag = (item["Diagnosis"] || "").toLowerCase();
        const isSnake = diag.includes("ular") || diag.includes("snake");
        const isHeat = diag.includes("haba") || diag.includes("heat") || diag.includes("kejang");

        if (isHeat) heatCases++;
        else if (isSnake) {
            snakeCases++;
            const speciesRaw = item[SPECIES_FIELD];
            speciesCounts[normalizeSpecies(speciesRaw)] = (speciesCounts[normalizeSpecies(speciesRaw)] || 0) + 1;
            if (!isSpeciesReported(speciesRaw)) unreportedSpecies++;
        }

        const hosp = item["Hospital"] || "Unknown";
        hospitalCounts[hosp] = (hospitalCounts[hosp] || 0) + 1;

        // Timeline data
        const dateStr = item['Tarikh Kejadian'] || item['Tarikh Notifikasi'];
        const rowDate = parseDate(dateStr);
        if (rowDate) {
            const key = toISODate(rowDate);
            if (!dateCounts[key]) dateCounts[key] = { heat: 0, snake: 0 };
            if (isHeat) dateCounts[key].heat++;
            else if (isSnake) dateCounts[key].snake++;
        }
    });

    animateValue("totalCasesVal", data.length);
    animateValue("heatCasesVal", heatCases);
    animateValue("snakeCasesVal", snakeCases);
    animateValue("unreportedSpeciesVal", unreportedSpecies);

    renderHospitalChart(hospitalCounts);
    renderTypeChart(heatCases, snakeCases);
    renderTimelineChart(dateCounts);
    renderSpeciesChart(speciesCounts);
    renderTable(data);
}

function animateValue(elementId, target) {
    const el = document.getElementById(elementId);
    if (!el) return;
    if (target === 0) { el.innerText = "0"; return; }
    let current = 0;
    const step = Math.max(1, Math.floor(target / 25));
    const interval = 500 / (target / step);
    const timer = setInterval(() => {
        current += step;
        if (current >= target) { current = target; clearInterval(timer); }
        el.innerText = current;
    }, interval);
}

// ─── Charts ─────────────────────────────────────────────────────
Chart.defaults.color = "#64748b";
Chart.defaults.font.family = "Inter, sans-serif";

function renderHospitalChart(hospitalCounts) {
    const ctx = document.getElementById("hospitalChart").getContext("2d");
    const labels = Object.keys(hospitalCounts).sort((a, b) => hospitalCounts[b] - hospitalCounts[a]);
    const data = labels.map(l => hospitalCounts[l]);
    if (hospitalChartInst) hospitalChartInst.destroy();

    hospitalChartInst = new Chart(ctx, {
        type: "bar",
        data: {
            labels: labels.map(l => l.length > 22 ? l.substring(0, 22) + "…" : l),
            datasets: [{
                label: "Jumlah Kes",
                data: data,
                backgroundColor: "rgba(14, 165, 233, 0.85)",
                hoverBackgroundColor: "#0284c7",
                borderRadius: 6,
                borderSkipped: false,
            }],
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: { backgroundColor: "#1e293b", padding: 12, cornerRadius: 8, callbacks: { title: ctx => labels[ctx[0].dataIndex] } },
            },
            scales: {
                y: { beginAtZero: true, grid: { color: "rgba(226,232,240,0.6)" }, ticks: { precision: 0 } },
                x: { grid: { display: false } },
            },
            animation: { duration: 600, easing: "easeOutQuart" },
        },
    });
}

function renderTypeChart(heatCount, snakeCount) {
    const ctx = document.getElementById("typeChart").getContext("2d");
    if (typeChartInst) typeChartInst.destroy();
    typeChartInst = new Chart(ctx, {
        type: "doughnut",
        data: {
            labels: ["Penyakit Haba", "Patukan Ular"],
            datasets: [{ data: [heatCount, snakeCount], backgroundColor: ["#f59e0b", "#e11d48"], borderWidth: 3, borderColor: "#fff", hoverOffset: 8 }],
        },
        options: {
            responsive: true, maintainAspectRatio: false, cutout: "65%",
            plugins: { legend: { position: "bottom", labels: { padding: 16 } }, tooltip: { backgroundColor: "#1e293b", padding: 12, cornerRadius: 8 } },
            animation: { duration: 600, easing: "easeOutQuart" },
        },
    });
}

function renderTimelineChart(dateCounts) {
    const ctx = document.getElementById("timelineChart").getContext("2d");
    if (timelineChartInst) timelineChartInst.destroy();

    // Build a continuous date range (fill in missing dates with 0)
    const existingDates = Object.keys(dateCounts).sort();
    if (existingDates.length === 0) return;

    const startDate = new Date(existingDates[0] + 'T00:00:00');
    const endDate = new Date(existingDates[existingDates.length - 1] + 'T00:00:00');

    const allDates = [];
    const current = new Date(startDate);
    while (current <= endDate) {
        allDates.push(toISODate(current));
        current.setDate(current.getDate() + 1);
    }

    const heatData = allDates.map(d => (dateCounts[d] ? dateCounts[d].heat : 0));
    const snakeData = allDates.map(d => (dateCounts[d] ? dateCounts[d].snake : 0));

    // Format labels as DD/MM
    const labels = allDates.map(d => {
        const parts = d.split('-');
        return `${parts[2]}/${parts[1]}`;
    });

    // Keep reference for tooltip
    const sortedDates = allDates;

    timelineChartInst = new Chart(ctx, {
        type: "bar",
        data: {
            labels: labels,
            datasets: [
                {
                    label: "Penyakit Haba",
                    data: heatData,
                    backgroundColor: "rgba(245, 158, 11, 0.8)",
                    hoverBackgroundColor: "#f59e0b",
                    borderRadius: 4,
                    borderSkipped: false,
                },
                {
                    label: "Patukan Ular",
                    data: snakeData,
                    backgroundColor: "rgba(225, 29, 72, 0.8)",
                    hoverBackgroundColor: "#e11d48",
                    borderRadius: 4,
                    borderSkipped: false,
                },
            ],
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { position: "top", align: "end", labels: { usePointStyle: true, pointStyle: "rectRounded", padding: 16 } },
                tooltip: {
                    backgroundColor: "#1e293b",
                    padding: 12,
                    cornerRadius: 8,
                    callbacks: {
                        title: (ctx) => {
                            const idx = ctx[0].dataIndex;
                            const isoDate = sortedDates[idx];
                            const parts = isoDate.split('-');
                            return `${parts[2]}/${parts[1]}/${parts[0]}`;
                        },
                    },
                },
            },
            scales: {
                x: {
                    stacked: true,
                    grid: { display: false },
                    ticks: { maxRotation: 45, font: { size: 11 } },
                },
                y: {
                    stacked: true,
                    beginAtZero: true,
                    grid: { color: "rgba(226,232,240,0.6)" },
                    ticks: { precision: 0 },
                },
            },
            animation: { duration: 600, easing: "easeOutQuart" },
        },
    });
}

function renderSpeciesChart(speciesCounts) {
    const ctx = document.getElementById("speciesChart").getContext("2d");
    if (speciesChartInst) speciesChartInst.destroy();

    const sorted = Object.entries(speciesCounts).sort((a, b) => b[1] - a[1]);
    if (sorted.length === 0) {
        speciesChartInst = new Chart(ctx, {
            type: "bar",
            data: { labels: ["Tiada data"], datasets: [{ data: [0] }] },
            options: { responsive: true, maintainAspectRatio: false },
        });
        return;
    }

    const labels = sorted.map(([name]) => name);
    const data = sorted.map(([, count]) => count);
    const colors = labels.map(label => {
        if (label === "Tidak Dilaporkan") return "#ef4444";
        if (label === "Tidak Dikenal Pasti") return "#f97316";
        if (label === "Non-Venomous Snake") return "#22c55e";
        if (label.includes("Malayan Pit Viper")) return "#8b5cf6";
        if (label.includes("Viper")) return "#a855f7";
        return "#0ea5e9";
    });

    speciesChartInst = new Chart(ctx, {
        type: "bar",
        data: {
            labels,
            datasets: [{
                label: "Bilangan Kes",
                data,
                backgroundColor: colors.map(c => c + "dd"),
                hoverBackgroundColor: colors,
                borderRadius: 6,
                borderSkipped: false,
            }],
        },
        options: {
            indexAxis: "y",
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: { backgroundColor: "#1e293b", padding: 12, cornerRadius: 8 },
            },
            scales: {
                x: { beginAtZero: true, grid: { color: "rgba(226,232,240,0.6)" }, ticks: { precision: 0 } },
                y: {
                    grid: { display: false },
                    ticks: {
                        font: { weight: '500' },
                        color: (ctx) => {
                            const lbl = labels[ctx.index];
                            if (lbl === "Tidak Dilaporkan") return "#ef4444";
                            if (lbl === "Tidak Dikenal Pasti") return "#f97316";
                            return "#64748b";
                        }
                    },
                },
            },
            animation: { duration: 600, easing: "easeOutQuart" },
        },
    });
}

// ─── Table ──────────────────────────────────────────────────────
function renderTable(data) {
    const tbody = document.getElementById("casesTbody");
    tbody.innerHTML = "";

    if (!data || data.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding:2rem; color:#94a3b8;">Tiada kes dalam julat tarikh yang dipilih.</td></tr>`;
        return;
    }

    const sortedData = [...data].reverse();

    sortedData.forEach(row => {
        const tr = document.createElement("tr");
        const diagLower = (row["Diagnosis"] || "").toLowerCase();
        const isSnake = diagLower.includes("ular") || diagLower.includes("snake");
        const isHeat = diagLower.includes("haba") || diagLower.includes("heat") || diagLower.includes("kejang");
        const badgeClass = isHeat ? "badge-heat" : "badge-snake";
        const typeLabel = isHeat ? "Heat Illness" : "Snake Bite";

        const date = row["Tarikh Kejadian"] || row["Tarikh Notifikasi"] || "-";
        const hospital = row["Hospital"] || "-";
        const outcome = row["Hasil Rawatan"] || "-";

        let speciesHtml = '<span style="color:#94a3b8;">—</span>';
        if (isSnake) {
            const speciesRaw = row[SPECIES_FIELD];
            if (isSpeciesReported(speciesRaw)) {
                speciesHtml = `<span class="species-reported">${speciesRaw.trim()}</span>`;
            } else {
                speciesHtml = `<span class="species-unreported">⚠ Tidak Dilaporkan</span>`;
            }
        }

        tr.innerHTML = `
            <td>${date}</td>
            <td><strong>${hospital}</strong></td>
            <td><span class="badge ${badgeClass}">${typeLabel}</span></td>
            <td>${speciesHtml}</td>
            <td>${outcome}</td>
            <td><button class="view-btn">Lihat Scorecard</button></td>
        `;
        tr.addEventListener("click", () => openScorecard(row));
        tbody.appendChild(tr);
    });
}

// ─── Scorecard Modal ────────────────────────────────────────────
const modal = document.getElementById("scorecardModal");
const closeBtn = document.getElementById("closeModalBtn");

function openScorecard(caseData) {
    document.getElementById("scDiagnosis").innerText = caseData["Diagnosis"] || "-";
    document.getElementById("scHospital").innerText = caseData["Hospital"] || "-";
    document.getElementById("scIncidentDate").innerText = caseData["Tarikh Kejadian"] || "-";

    const species = caseData[SPECIES_FIELD];
    const speciesEl = document.getElementById("scSpecies");
    const diagLower = (caseData["Diagnosis"] || "").toLowerCase();
    const isSnake = diagLower.includes("ular") || diagLower.includes("snake");

    if (isSpeciesReported(species)) {
        speciesEl.innerText = species.trim();
        speciesEl.className = "species-text";
    } else if (isSnake) {
        speciesEl.innerText = "⚠ TIDAK DILAPORKAN";
        speciesEl.className = "species-text-warning";
    } else {
        speciesEl.innerText = "N/A (Bukan kes ular)";
        speciesEl.className = "";
    }

    document.getElementById("scAge").innerText = caseData["Umur  Pesakit"] || "Unknown";
    document.getElementById("scGender").innerText = caseData["Jantina  Pesakit"] || "Unknown";
    document.getElementById("scJob").innerText = caseData["Pekerjaan  Pesakit"] || "Unknown";
    document.getElementById("scComorbid").innerText = caseData["Co-Morbid (DM/HPT/IHD/ESRF) / @ Tiada"] || "Tiada";
    document.getElementById("scActivity").innerText = caseData["Aktiviti Semasa Kejadian"] || "-";
    document.getElementById("scLocation").innerText = caseData["Tempat Kejadian"] || "-";
    document.getElementById("scTreatment").innerText = caseData["Jenis Rawatan"] || "-";
    document.getElementById("scOutcome").innerText = caseData["Hasil Rawatan"] || "-";

    modal.classList.remove("hidden");
    setTimeout(() => modal.classList.add("active"), 10);
}

function closeScorecard() {
    modal.classList.remove("active");
    setTimeout(() => modal.classList.add("hidden"), 200);
}

closeBtn.addEventListener("click", closeScorecard);
modal.addEventListener("click", (e) => { if (e.target === modal) closeScorecard(); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && modal.classList.contains("active")) closeScorecard(); });

// ─── Auto-refresh every 5 minutes ──────────────────────────────
setInterval(() => { console.log("[Dashboard] Auto-refreshing..."); initDashboard(); }, 5 * 60 * 1000);

// ─── Start ──────────────────────────────────────────────────────
initDashboard();
