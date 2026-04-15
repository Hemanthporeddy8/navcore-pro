// js/engine.js
// CORE NAVIGATION & AUTOMATIC ROUTING ENGINE

let watchId = null;
let journeyPath = [];
let alertsQueue = [];
let currentTarget = null;
let previousTarget = null;
let totalSegmentDistance = 0;
let lastLat = null;
let lastLng = null;
let searchTarget = 'start'; // 'start' or 'end'
let isSimulating = false;
let simInterval = null;
let simProgress = 0;
let simPathIdx = 0;
let lastUpdateTimestamp = null;
let currentSpeedKmph = 0;
let stopCountdownInterval = null;

// PRO SIM PHYSICS STATE
let simStartTime = 0;
let simPhase = 'Ready';
let currentSimStationDist = 0;
let simTotalElapsed = 0;
let isDwelling = false;
let simSpeedMultiplier = 20; // Default to Fast Mode (20x)

// Announcement debounce — prevents audio chain from stacking up during fast simulation
let lastAnnouncedKey = null;     // Tracks last announced station+type key
let lastAnnounceTime = 0;        // Timestamp of last announcement
let lastAnnouncedSimIdx = -1;    // Tracks which simPathIdx we last announced for
const ANNOUNCE_COOLDOWN = 3000;  // 3s minimum between real-GPS announcements

// 1. UI INITIALIZATION
window.onload = function () {
    // Initial Population of custom dropdowns
    populateCustomDropdown('start');
    populateCustomDropdown('end');

    // Close dropdowns on outside click
    window.addEventListener('click', (e) => {
        if (!e.target.closest('.navcore-select')) {
            document.querySelectorAll('.select-menu').forEach(m => m.style.display = 'none');
        }
    });

    // Initial setup
    autoCalculateRecommend();
};

function populateCustomDropdown(target) {
    const itemsContainer = document.getElementById(`${target}-items`);
    itemsContainer.innerHTML = '';
    
    const sortedStations = Object.keys(stationsDB).sort();
    
    sortedStations.forEach(station => {
        const line = stationsDB[station].line;
        const color = line === "Red" ? "#ef4444" : line === "Blue" ? "#3b82f6" : "#10b981";
        
        const item = document.createElement('div');
        item.className = 'menu-item';
        item.onclick = () => selectDropdownStation(target, station);
        item.setAttribute('data-station', station.toLowerCase());
        item.innerHTML = `
            <span class="item-name">${station}</span>
            <span class="item-line-badge" style="background: ${color}">${line}</span>
        `;
        itemsContainer.appendChild(item);
    });
}

function renderScrollTrack() {
    const content = document.getElementById('track-content');
    const train = document.getElementById('moving-train');
    content.innerHTML = ''; 
    content.appendChild(train); // Keep train inside

    journeyPath.forEach((station, index) => {
        const node = document.createElement('div');
        node.className = 'track-node';
        node.id = `node-${index}`;
        node.innerHTML = `
            <div class="dot"></div>
            <span class="node-label">${station}</span>
            ${index < journeyPath.length - 1 ? '<div class="track-connector"></div>' : ''}
        `;
        content.appendChild(node);
    });

    document.getElementById('train-track-container').style.display = 'block';
}

function toggleDropdown(target) {
    const menu = document.getElementById(`${target}-menu`);
    const isVisible = menu.style.display === 'flex';
    
    // Close others
    document.querySelectorAll('.select-menu').forEach(m => m.style.display = 'none');
    
    if (!isVisible) {
        menu.style.display = 'flex';
        document.getElementById(`${target}-menu-search`).value = '';
        filterDropdown(target); // Reset filter
        document.getElementById(`${target}-menu-search`).focus();
    }
}

function filterDropdown(target) {
    const query = document.getElementById(`${target}-menu-search`).value.toLowerCase();
    const items = document.getElementById(`${target}-items`).querySelectorAll('.menu-item');
    
    items.forEach(item => {
        const name = item.getAttribute('data-station');
        item.style.display = name.includes(query) ? 'flex' : 'none';
    });
}

function selectDropdownStation(target, station) {
    document.getElementById(`${target}-display`).innerText = station;
    document.getElementById(`${target}-station`).value = station;
    document.getElementById(`${target}-menu`).style.display = 'none';
    
    autoCalculateRecommend();
}


function autoCalculateRecommend() {
    const start = document.getElementById('start-station').value;
    const end = document.getElementById('end-station').value;
    
    if (start === end) return;

    // Get current path to find "N stations before"
    const path = findShortestPath(start, end);
    if (!path) return;

    // Update the custom station list for this specific route
    const wakeupStationSelect = document.getElementById('wakeup-station');
    wakeupStationSelect.innerHTML = "";
    path.forEach(station => {
        const line = stationsDB[station].line;
        wakeupStationSelect.add(new Option(`${station} (${line})`, station));
    });

    updateWakeupOptions(); // Apply recommendation based on current mode
}

function updateWakeupOptions() {
    const mode = document.getElementById('wakeup-mode').value;
    const customSelect = document.getElementById('wakeup-station');
    const start = document.getElementById('start-station').value;
    const end = document.getElementById('end-station').value;
    
    if (mode === "custom") {
        customSelect.style.display = "block";
    } else {
        customSelect.style.display = "none";
        
        // Calculate recommended station
        const path = findShortestPath(start, end);
        if (path && path.length > 1) {
            const offset = parseInt(mode);
            const index = Math.max(0, path.length - 1 - offset);
            customSelect.value = path[index];
        }
    }
}


// 2. ROUTING ENGINE (BFS)
function findShortestPath(startNode, endNode) {
    let queue = [[startNode]];
    let visited = new Set([startNode]);

    while (queue.length > 0) {
        let path = queue.shift();
        let node = path[path.length - 1];

        if (node === endNode) return path;

        for (let neighbor of stationsDB[node].connections) {
            if (!visited.has(neighbor)) {
                visited.add(neighbor);
                let newPath = [...path, neighbor];
                queue.push(newPath);
            }
        }
    }
    return null;
}

// 3. JOURNEY CONTROLS
function startJourney() {
    const start = document.getElementById('start-station').value;
    const end = document.getElementById('end-station').value;
    const wakeUpStation = document.getElementById('wakeup-station').value;

    if (!stationsDB[start] || !stationsDB[end]) {
        alert("Please select your stations first!");
        return;
    }

    // Calculate the path
    journeyPath = findShortestPath(start, end);
    
    if (!journeyPath) {
        alert("No route found between these stations.");
        return;
    }

    // Build Alerts Queue
    alertsQueue = [];
    
    // Auto-detect transfers
    for (let i = 0; i < journeyPath.length - 1; i++) {
        const currentLine = stationsDB[journeyPath[i]].line;
        const nextLine = stationsDB[journeyPath[i+1]].line;
        
        if (currentLine !== nextLine && currentLine !== "Interchange" && nextLine !== "Interchange") {
            // This case shouldn't happen with our DB structure, but for safety:
            alertsQueue.push({ name: journeyPath[i], type: "TRANSFER", data: stationsDB[journeyPath[i]] });
        } else if (stationsDB[journeyPath[i]].line === "Interchange" && i > 0) {
            const prevLine = stationsDB[journeyPath[i-1]].line;
            const nextLineActual = stationsDB[journeyPath[i+1]].line;
            if (prevLine !== nextLineActual) {
                alertsQueue.push({ name: journeyPath[i], type: "TRANSFER", data: stationsDB[journeyPath[i]], alertMode: 'voice' });
            }
        }
    }

    // Add final wakeup alarm
    alertsQueue.push({ name: wakeUpStation, type: "WAKEUP ALARM", data: stationsDB[wakeUpStation], alertMode: 'voice' });

    // UI State Change
    document.getElementById('setup-panel').style.display = 'none';
    document.querySelector('.view-map-btn').style.display = 'none';
    document.getElementById('stop-btn').style.display = 'block';
    document.getElementById('live-status-bar').style.display = 'block';
    document.getElementById('current-location-banner').style.display = 'flex';

    // Reset UI State
    if (!isSimulating) {
        document.getElementById('current-station-text').innerText = "Locating...";
    }
    document.getElementById('live-status-bar').classList.remove('alarm-active');

    renderActiveRoute(journeyPath, alertsQueue);
    renderScrollTrack();
    loadNextTarget(start);

    // Only use fake initial position in simulation —
    // In real mode, real GPS handles start position. Faking it causes
    // the train to appear to "move on its own" when user is at home.
    if (isSimulating) {
        const startData = stationsDB[start];
        updatePosition({ coords: { latitude: startData.lat, longitude: startData.lng } });
    }
    // Reset announcement debounce for fresh journey
    lastAnnouncedKey = null;
    lastAnnounceTime = 0;
    lastAnnouncedSimIdx = -1;

    // Activate DIY wake lock — keeps screen on for the whole journey
    enableWakeLock();

    if (navigator.geolocation && !isSimulating) {
        watchId = navigator.geolocation.watchPosition(updatePosition, handleError, {
            enableHighAccuracy: true, maximumAge: 0, timeout: 10000
        });
    }
}

function stopJourney() {
    if (watchId) navigator.geolocation.clearWatch(watchId);
    disableWakeLock();
    
    // Clear State
    currentTarget = null;
    previousTarget = null;
    alertsQueue = [];
    journeyPath = [];

    // Reset UI
    document.getElementById('setup-panel').style.display = 'block';
    document.getElementById('stop-btn').style.display = 'none';
    document.getElementById('sim-controls').style.display = 'none';
    document.getElementById('active-route').style.display = 'none';
    document.getElementById('train-track-container').style.display = 'none';
    document.getElementById('live-status-bar').style.display = 'none';
    document.getElementById('live-status-bar').classList.remove('alarm-active');
    document.querySelector('.view-map-btn').style.display = 'flex';
    document.getElementById('moving-train').style.display = ''; // Restore train for next journey
}

function renderActiveRoute(path, alerts) {
    const routeDiv = document.getElementById('active-route');
    routeDiv.style.display = 'block';
    
    let html = `<div style="font-weight: bold; margin-bottom: 10px; color: #0f172a;">Journey Path (${path.length} stations)</div>`;
    
    path.forEach((station, index) => {
        const isAlert = alerts.find(a => a.name === station);
        const dotColor = stationsDB[station].line === "Red" ? "#ef4444" : 
                         stationsDB[station].line === "Blue" ? "#3b82f6" : 
                         stationsDB[station].line === "Green" ? "#10b981" : "#f59e0b";
        
        html += `
            <div class="waypoint-item" style="display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 4px 0;">
                <div style="display: flex; align-items: center; gap: 10px;">
                    <div style="width: 10px; height: 10px; border-radius: 50%; background: ${dotColor};"></div>
                    <span style="font-size: 13px; font-weight: 500;">${station}</span>
                    ${isAlert ? `<span class="badge ${isAlert.type === "TRANSFER" ? 'transfer' : 'wakeup'}" style="font-size: 9px;">${isAlert.type}</span>` : ''}
                </div>
                
                ${isAlert ? `
                <div style="display: flex; align-items: center; gap: 5px; background: #f1f5f9; padding: 2px 6px; border-radius: 20px;">
                    <span style="font-size: 12px; cursor: pointer;" title="Alert Mode">🔔</span>
                    <select onchange="updateAlertMode('${station}', this.value)" style="border: none; background: transparent; font-size: 10px; font-weight: bold; color: #475569; cursor: pointer; outline: none;">
                        <option value="voice" ${isAlert.alertMode === 'voice' ? 'selected' : ''}>Voice</option>
                        <option value="bell" ${isAlert.alertMode === 'bell' ? 'selected' : ''}>Bell</option>
                        <option value="vibrate" ${isAlert.alertMode === 'vibrate' ? 'selected' : ''}>Vibrate</option>
                        <option value="silent" ${isAlert.alertMode === 'silent' ? 'selected' : ''}>Silent</option>
                    </select>
                </div>
                ` : ''}
            </div>
        `;
    });
    
    routeDiv.innerHTML = html;
}

// 4. LIVE TRACKING LOGIC
function loadNextTarget(lastKnownStation) {
    if (alertsQueue.length > 0) {
        previousTarget = { name: lastKnownStation, data: stationsDB[lastKnownStation] };
        currentTarget = alertsQueue[0];

        console.log(`[NAV] Target Updated: ${currentTarget.name} (${currentTarget.type})`);
        const statusEl = document.getElementById('status-text');
        if (statusEl) statusEl.innerText = `NEXT: ${currentTarget.type} at ${currentTarget.name}`;
        document.getElementById('live-status-bar').classList.remove('alarm-active');
    } else {
        finishJourney();
    }
}

function scrubSimulation(value) {
    if (!isSimulating) return;

    const percent = value / 1000; // 0.0 to 1.0
    document.getElementById('scrub-percent').innerText = `${Math.round(percent * 100)}%`;
    
    // Total number of segments
    const totalSegments = journeyPath.length - 1;
    if (totalSegments <= 0) return;

    // Find which segment we are in
    const exactPos = percent * totalSegments;
    simPathIdx = Math.floor(exactPos);
    simProgress = exactPos - simPathIdx;

    // Handle end-of-journey boundary
    if (simPathIdx >= totalSegments) {
        simPathIdx = totalSegments - 1;
        simProgress = 1.0;
    }

    simPhase = 'Scrubbing';
    currentSpeedKmph = 0; // Speed is zero while manual scrubbing
    
    // Update the position immediately
    const fromNode = journeyPath[simPathIdx];
    const toNode = journeyPath[simPathIdx + 1];
    const lat = stationsDB[fromNode].lat + (stationsDB[toNode].lat - stationsDB[fromNode].lat) * simProgress;
    const lng = stationsDB[fromNode].lng + (stationsDB[toNode].lng - stationsDB[fromNode].lng) * simProgress;

    updatePosition({ coords: { latitude: lat, longitude: lng } });
}

function setSimSpeed(multiplier) {
    simSpeedMultiplier = multiplier;
    
    // Update UI highlights
    const isFast = multiplier > 1;
    document.getElementById('sim-speed-fast').style.background = isFast ? '#3b82f6' : '#e2e8f0';
    document.getElementById('sim-speed-fast').style.color = isFast ? 'white' : '#64748b';
    document.getElementById('sim-speed-real').style.background = !isFast ? '#3b82f6' : '#e2e8f0';
    document.getElementById('sim-speed-real').style.color = !isFast ? 'white' : '#64748b';
}

function startSimulation() {
    const start = document.getElementById('start-station').value;
    const end = document.getElementById('end-station').value;
    
    if (!stationsDB[start] || !stationsDB[end]) {
        alert("Please pick stations first!");
        return;
    }
    
    // 🤖 AUTOPILOT INITIALIZATION
    isSimulating = true;
    simPathIdx = 0;
    simProgress = 0.05; // Kickstart past the first 50m to avoid "Boarding Alarm"
    simTotalElapsed = 1;
    isDwelling = false;
    currentSimStationDist = 0;
    currentSpeedKmph = 0;
    
    // Safety: Ensure any previous GPS banner is cleared
    const stationTitle = document.getElementById('current-station-text');
    if (stationTitle) stationTitle.innerText = "Simulating GPS...";

    // UI for simulation
    document.getElementById('sim-controls').style.display = 'block';
    document.getElementById('stop-btn').style.display = 'none'; 
    document.getElementById('telemetry-panel').style.display = 'block';
    // Hide moving train emoji in test mode — user requested
    document.getElementById('moving-train').style.display = 'none';
    
    const statusEl = document.getElementById('status-text');
    if (statusEl) statusEl.innerText = "AUTOPILOT: DEPARTING STATION...";

    startJourney();
    
    console.log(`[SIM] Autopilot Ready - Starting voyage to ${end}`);

    if (simInterval) clearInterval(simInterval);
    simInterval = setInterval(simulationTick, 1000); 
}

function simulationTick() {
    if (!isSimulating || simPathIdx >= journeyPath.length - 1) {
        if (simPathIdx >= journeyPath.length - 1) finishJourney();
        return;
    }

    const fromNode = journeyPath[simPathIdx];
    const toNode = journeyPath[simPathIdx + 1];
    
    // Calculate distance of this segment once
    const segmentDist = calculateDistance(
        stationsDB[fromNode].lat, stationsDB[fromNode].lng,
        stationsDB[toNode].lat, stationsDB[toNode].lng
    );

    if (isDwelling && simProgress >= 1) {
        console.log("[SIM] Station Stop Active...");
        return; 
    }

    const tickDelta = 1 * simSpeedMultiplier; // Scale time by multiplier
    simTotalElapsed += 1; // Increment internal ticker for physics math
    const effectiveElapsed = simTotalElapsed * simSpeedMultiplier;

    const topSpeedMs = (60 * 1000) / 3600; // 60 km/h max
    const accelTime = 25; 
    const deccelDist = 350; // meters before station to start braking
    const acceleration = topSpeedMs / accelTime;

    // Current distance traveled in segment
    let currentDistMoved = simProgress * segmentDist;
    let distRemaining = segmentDist - currentDistMoved;

    // PHYSICS MODEL
    let currentSpeedMs = 0;
    if (distRemaining < deccelDist) {
        simPhase = 'Arriving';
        currentSpeedMs = topSpeedMs * (distRemaining / deccelDist);
        if (currentSpeedMs < 2) currentSpeedMs = 2; // slow crawl
    } else if (effectiveElapsed < accelTime) {
        simPhase = 'Departing';
        currentSpeedMs = acceleration * effectiveElapsed;
    } else {
        simPhase = 'Cruising';
        currentSpeedMs = topSpeedMs;
    }

    currentSpeedKmph = (currentSpeedMs * 3600) / 1000;
    
    // Move train
    const addedProgress = (currentSpeedMs * tickDelta) / segmentDist;
    simProgress += addedProgress;

    // Update Slider UI
    const totalSegments = journeyPath.length - 1;
    const totalPos = ((simPathIdx + simProgress) / totalSegments) * 1000;
    const scrubber = document.getElementById('sim-scrubber');
    if (scrubber) {
        scrubber.value = totalPos;
        document.getElementById('scrub-percent').innerText = `${Math.round((totalPos / 1000) * 100)}%`;
    }

    if (simProgress >= 1) {
        simProgress = 1;
        // Logic handled in updatePosition -> triggerAlarm
    }

    const lat = stationsDB[fromNode].lat + (stationsDB[toNode].lat - stationsDB[fromNode].lat) * simProgress;
    const lng = stationsDB[fromNode].lng + (stationsDB[toNode].lng - stationsDB[fromNode].lng) * simProgress;

    // Telemetry & UI Bridge
    const telemetry = document.getElementById('telemetry-content');
    if (telemetry) {
        telemetry.innerHTML = `
            <div style="color: #60a5fa; font-weight: bold;">[AUTOPILOT ACTIVE]</div>
            <div>SEGMENT: ${fromNode} → ${toNode}</div>
            <div>STATION PROGRESS: ${(simProgress * 100).toFixed(1)}%</div>
            <div>SPEED: ${Math.round(currentSpeedKmph)} km/h</div>
            <div style="color: #fbbf24;">PHASE: ${simPhase.toUpperCase()}</div>
        `;
    }

    updatePosition({ coords: { latitude: lat, longitude: lng } });
}

function forceNextStation() {
    if (!isSimulating) return;
    
    // 1. Force exit dwell if stuck
    isDwelling = false;
    
    // 2. Advance to next segment
    if (simPathIdx < journeyPath.length - 1) {
        simPathIdx++;
    } else {
        // Wrap around to start if at the end (for continuous testing)
        simPathIdx = 0;
    }
    
    // 3. Reset progress to just past the station
    simProgress = 0.05; 
    
    // 4. Update the NavTarget for the new segment
    const navIndex = simPathIdx + 1 < journeyPath.length ? simPathIdx + 1 : simPathIdx;
    const nextStationName = journeyPath[navIndex];
    const isFinalStation = (navIndex === journeyPath.length - 1);
    
    // 5. Check if this station is an active alarm point
    const activeAlert = alertsQueue.find(a => a.name === nextStationName);
    const isAlarmStation = !!activeAlert;
    
    // 6. Force the correct Smart Announcement based on Alert Mode
    const mode = activeAlert?.alertMode || 'sound';
    console.log(`[TEST] Force Advancing: ${nextStationName} (Alarm: ${isAlarmStation}, Mode: ${mode})`);
    
    if (isAlarmStation) {
        if (mode === 'voice') {
            // Full Professional Chain (Alert + Arriving + Station)
            playSmartAnnouncement(activeAlert.type === "TRANSFER" ? "Transfer arriving" : "arriving", nextStationName, true);
            if (navigator.vibrate) navigator.vibrate([1000, 500, 1000]);
        } else if (mode === 'bell') {
            // New 10-Second Looping Bell Alarm (No voice, no vibrate)
            playBellLoop(10000);
        } else if (mode === 'vibrate') {
            if (navigator.vibrate) navigator.vibrate([1000, 500, 1000]);
        }
    } else if (isFinalStation) {
        playSmartAnnouncement("arriving", nextStationName);
    } else {
        playSmartAnnouncement("next station", nextStationName);
    }

    // Refresh display
    const statusEl = document.getElementById('status-text');
    if (statusEl) statusEl.innerText = `[TEST] NEXT: ${nextStationName} ${isAlarmStation ? '🔔' : ''}`;
}

function updateAlertMode(stationName, newMode) {
    // Fix: was referencing undefined 'activeAlerts' — use alertsQueue directly
    const alertInQueue = alertsQueue.find(a => a.name === stationName);
    if (alertInQueue) alertInQueue.alertMode = newMode;
    console.log(`[ALARM] Mode updated for ${stationName}: ${newMode}`);
}

function skipToArrival() {
    if (!isSimulating) return;
    
    // Force wake up if dwelling
    isDwelling = false;
    
    simProgress = 0.98; // Jump closer to exact arrival triggers
    simPhase = 'Manual Skip';
    console.log("[SIM] Physics Warp: Skipping to arrival...");
}

// PURE ELEVENLABS AUDIO ENGINE (NO TTS)
let currentAudioChain = null;
let bellLoopActive = false;

function playBellLoop(durationMs) {
    if (bellLoopActive) return;
    bellLoopActive = true;
    
    const bell = new Audio('assets/bell.wav');
    const playNext = () => {
        if (!bellLoopActive) return;
        bell.currentTime = 0;
        bell.play().catch(e => console.warn("[AUDIO] Bell file missing", e));
    };
    
    bell.onended = playNext;
    playNext(); // Start first play
    
    setTimeout(() => {
        bellLoopActive = false;
        bell.pause();
        bell.currentTime = 0;
        console.log("[AUDIO] Bell loop completed.");
    }, durationMs);
}

function playSmartAnnouncement(prefixType, stationName = null, isEmergency = false) {
    // Stop all audio including bell loops
    if (currentAudioChain) {
        currentAudioChain.pause();
        currentAudioChain = null;
    }
    bellLoopActive = false;

    let files = [];
    
    // 1. Alert Prefix (Optional)
    if (isEmergency) {
        const alertFile = prefixType.includes("Transfer") ? "assets/transfer.mp3" : "assets/wakeup.mp3";
        files.push(alertFile);
    }

    // 2. Sentence Prefix
    if (prefixType.toLowerCase().includes("arriving")) {
        files.push("assets/arriving.mp3");
    } else if (prefixType.toLowerCase().includes("next")) {
        files.push("assets/next_station.mp3");
    }

    // 3. Station Name
    if (stationName) {
        files.push(`assets/stations/${stationName}.mp3`);
    }

    playAudioChain(files);
}

function playAudioChain(files) {
    if (files.length === 0) return;

    const playNext = (index) => {
        if (index >= files.length) {
            currentAudioChain = null;
            return;
        }

        const audio = new Audio(files[index]);
        currentAudioChain = audio;
        
        audio.play().catch(e => {
            console.warn(`[AUDIO] Missing or failed file: ${files[index]}`, e);
            // Even if one fails, try the next in the chain
            playNext(index + 1);
        });

        audio.onended = () => playNext(index + 1);
    };

    playNext(0);
}

// Full TTS Fallback removed to ensure 100% ElevenLabs experience as requested.
function speakAnnouncement(message) { 
    console.log("[AUDIO] TTS Disabled. Use playSmartAnnouncement with MP3 assets.");
}

// skipToNextStation removed as requested

// ============================================================
// DIY SCREEN WAKE LOCK — Our Own Engine (No External API)
// Prevents screen from sleeping during active metro journey
// Uses 3 independent methods for maximum reliability:
//   1. Silent Web Audio oscillator (keeps media session alive)
//   2. Periodic DOM heartbeat (prevents tab throttling)
//   3. Visibility change re-arm (restores after tab switch)
// ============================================================
let wakeAudioCtx = null;
let wakeOscillator = null;
let wakeGainNode = null;
let wakeHeartbeatInterval = null;
let isWakeLockActive = false;

function enableWakeLock() {
    if (isWakeLockActive) return;
    isWakeLockActive = true;

    // METHOD 1: Silent oscillator at zero gain — Android Chrome won't
    // throttle or sleep the screen while an AudioContext is running.
    try {
        wakeAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
        wakeOscillator = wakeAudioCtx.createOscillator();
        wakeGainNode = wakeAudioCtx.createGain();
        wakeGainNode.gain.value = 0; // Completely silent — zero amplitude
        wakeOscillator.connect(wakeGainNode);
        wakeGainNode.connect(wakeAudioCtx.destination);
        wakeOscillator.start();
        console.log('[WAKE] Silent audio session started');
    } catch (e) {
        console.warn('[WAKE] AudioContext unavailable:', e);
    }

    // METHOD 2: Periodic DOM touch — prevents background tab throttling
    wakeHeartbeatInterval = setInterval(() => {
        const t = document.title;
        document.title = t; // Lightweight keep-alive signal
        console.log('[WAKE] Heartbeat — journey tracking active');
    }, 20000); // fire every 20s

    // METHOD 3: Tab visibility listener — re-arm AudioContext on return
    document.addEventListener('visibilitychange', handleWakeVisibilityChange);
    console.log('[WAKE] Wake lock ENABLED — screen will stay on');
}

function disableWakeLock() {
    if (!isWakeLockActive) return;
    isWakeLockActive = false;

    try {
        if (wakeOscillator) { wakeOscillator.stop(); wakeOscillator = null; }
        if (wakeAudioCtx)   { wakeAudioCtx.close();  wakeAudioCtx = null;  }
        wakeGainNode = null;
    } catch (e) {}

    if (wakeHeartbeatInterval) {
        clearInterval(wakeHeartbeatInterval);
        wakeHeartbeatInterval = null;
    }

    document.removeEventListener('visibilitychange', handleWakeVisibilityChange);
    console.log('[WAKE] Wake lock RELEASED');
}

function handleWakeVisibilityChange() {
    // If user came back to the tab, resume audio context if it was suspended
    if (document.visibilityState === 'visible' && isWakeLockActive) {
        if (wakeAudioCtx && wakeAudioCtx.state === 'suspended') {
            wakeAudioCtx.resume().then(() => {
                console.log('[WAKE] AudioContext resumed after visibility restore');
            });
        }
    }
}

function updatePosition(position) {
    const userLat = position.coords.latitude;
    const userLng = position.coords.longitude;
    
    // Speed Calculation
    if (lastUpdateTimestamp && lastLat && lastLng) {
        const now = Date.now();
        const timeDiff = (now - lastUpdateTimestamp) / 1000 / 3600; // hours
        const dist = calculateDistance(lastLat, lastLng, userLat, userLng) / 1000; // km
        if (timeDiff > 0) {
            const calculatedSpeed = dist / timeDiff;
            // Filter realistic speeds
            if (calculatedSpeed > 0 && calculatedSpeed < 120) currentSpeedKmph = calculatedSpeed;
        }
    }
    
    // In simulation, ETA is derived from physics speed model
    lastUpdateTimestamp = Date.now();
    lastLat = userLat;
    lastLng = userLng;

    // 1. Find Nearest Station (PATH AWARE)
    let closestStation = "Locating...";
    let shortestDistance = Infinity;

    const searchScope = isSimulating ? journeyPath : Object.keys(stationsDB);
    for (const name of searchScope) {
        const data = stationsDB[name];
        const dist = calculateDistance(userLat, userLng, data.lat, data.lng);
        if (dist < shortestDistance) {
            shortestDistance = dist;
            closestStation = name;
        }
    }

    document.getElementById('current-station-text').innerText = (shortestDistance < 250) ? `${closestStation} (Arrived)` : closestStation;

    if (!currentTarget) {
        console.warn("[NAV] No currentTarget - UI might not update metrics.");
        if (isSimulating && alertsQueue.length > 0) {
            loadNextTarget(closestStation);
        }
        return;
    }

    // --- PATH-AWARE POSITION TRACKING ---
    // IMPORTANT: Must be calculated BEFORE nav targeting to avoid
    // the 'let' Temporal Dead Zone (TDZ) ReferenceError bug.
    let closestPathIdx = 0;
    let shortestPathDist = Infinity;
    for (let i = 0; i < journeyPath.length; i++) {
        const data = stationsDB[journeyPath[i]];
        const dist = calculateDistance(userLat, userLng, data.lat, data.lng);
        if (dist < shortestPathDist) {
            shortestPathDist = dist;
            closestPathIdx = i;
        }
    }

    let distPrev = Infinity;
    if (closestPathIdx > 0) {
        const st = stationsDB[journeyPath[closestPathIdx - 1]];
        distPrev = calculateDistance(userLat, userLng, st.lat, st.lng);
    }
    let distNext = Infinity;
    if (closestPathIdx < journeyPath.length - 1) {
        const st = stationsDB[journeyPath[closestPathIdx + 1]];
        distNext = calculateDistance(userLat, userLng, st.lat, st.lng);
    }

    let idxCurrent = closestPathIdx;
    // If the previous station is closer than the next, we are in the previous segment
    if (distPrev < distNext && closestPathIdx > 0) {
        idxCurrent = closestPathIdx - 1;
    }
    // Prevent out of bounds
    idxCurrent = Math.max(0, Math.min(idxCurrent, journeyPath.length - 2));

    let segmentProgress = 0;
    if (journeyPath.length > 1) {
        const from = stationsDB[journeyPath[idxCurrent]];
        const to   = stationsDB[journeyPath[idxCurrent + 1]];
        const df = calculateDistance(userLat, userLng, from.lat, from.lng);
        const dt = calculateDistance(userLat, userLng, to.lat,   to.lng);
        segmentProgress = (df + dt > 0) ? df / (df + dt) : 0;
    }

    // --- 2. NAVIGATION & VOICE TRACKING ---
    // Decouple current stop (Navigation) from wake-up point (Alarm)
    let navTargetIndex = closestPathIdx + 1;
    if (navTargetIndex >= journeyPath.length) navTargetIndex = journeyPath.length - 1;
    
    const navStationName = journeyPath[navTargetIndex];
    const navStationData = stationsDB[navStationName];
    const distToNavTarget = calculateDistance(userLat, userLng, navStationData.lat, navStationData.lng);

    // Announcement Logic — TWO SEPARATE MODES to prevent audio queue stacking
    const announcementEl = document.getElementById('announcement-text');
    const isAnnounceEvery = document.getElementById('announce-every')?.checked;
    const isAtDestination = (navTargetIndex === journeyPath.length - 1);

    if (isSimulating) {
        // ⭐ SIMULATION MODE: Announce ONCE per segment change — never on distance.
        // This completely eliminates the audio queue stacking / glitching issue.
        if (simPathIdx !== lastAnnouncedSimIdx) {
            lastAnnouncedSimIdx = simPathIdx;
            const nextIdx = Math.min(simPathIdx + 1, journeyPath.length - 1);
            const nextStation = journeyPath[nextIdx];
            announcementEl.innerText = `Next Station: ${nextStation}`;
            if (isAnnounceEvery) {
                const specificAlert = alertsQueue.find(a => a.name === nextStation);
                if (!specificAlert || specificAlert.alertMode === 'voice') {
                    playSmartAnnouncement("next station", nextStation);
                }
            }
        }
    } else {
        // 📍 REAL GPS MODE: Distance-based with 3s cooldown to prevent double-firing
        const nowMs = Date.now();
        if (distToNavTarget < 500 && distToNavTarget > 100) {
            announcementEl.innerText = `Next Station: ${navStationName}`;
            const key = navStationName + '_next';
            if (isAnnounceEvery && key !== lastAnnouncedKey && (nowMs - lastAnnounceTime) > ANNOUNCE_COOLDOWN) {
                const specificAlert = alertsQueue.find(a => a.name === navStationName);
                if (!specificAlert || specificAlert.alertMode === 'voice') {
                    lastAnnouncedKey = key;
                    lastAnnounceTime = nowMs;
                    playSmartAnnouncement("next station", navStationName);
                }
            }
        } else if (distToNavTarget <= 100) {
            const arrivingMsg = isAtDestination
                ? `Arriving at Destination: ${navStationName}`
                : `Arriving at: ${navStationName}`;
            announcementEl.innerText = arrivingMsg;
            const key = navStationName + '_arriving';
            if (isAnnounceEvery && key !== lastAnnouncedKey && (nowMs - lastAnnounceTime) > ANNOUNCE_COOLDOWN) {
                const specificAlert = alertsQueue.find(a => a.name === navStationName);
                if (!specificAlert || specificAlert.alertMode === 'voice') {
                    lastAnnouncedKey = key;
                    lastAnnounceTime = nowMs;
                    playSmartAnnouncement("arriving", navStationName);
                }
            }
        } else {
            announcementEl.innerText = `Travelling towards ${journeyPath[journeyPath.length-1]} • Smart HMR tracking active`;
        }
    }

    // --- 3. ALARM TRACKING (Independent of nav) ---
    const targetCoords = currentTarget.data;
    const distToAlarmTarget = calculateDistance(userLat, userLng, targetCoords.lat, targetCoords.lng);

    // 2. Tracking Math
    const distToTarget = calculateDistance(userLat, userLng, currentTarget.data.lat, currentTarget.data.lng);
    
    // Update UI Metrics
    document.getElementById('distance-text').innerText = `${Math.round(distToTarget)}m`;
    document.getElementById('speed-text').innerText = `${Math.round(currentSpeedKmph)} km/h`;
    
    const phaseEl = document.getElementById('phase-text');
    phaseEl.innerText = isDwelling ? 'Stopped' : simPhase;
    phaseEl.className = 'value ' + (isDwelling ? 'phase-dwell' : 
                                   simPhase === 'Scrubbing' ? 'phase-scrub' :
                                   simPhase === 'Departing' ? 'phase-accel' : 
                                   simPhase === 'Cruising' ? 'phase-cruise' : 'phase-brake');

    // ETA Calculation
    const speedMs = (currentSpeedKmph * 1000) / 3600;
    const etaText = document.getElementById('eta-text');
    if (speedMs > 1.5) { 
        const secondsToTarget = distToTarget / speedMs;
        const mins = Math.floor(secondsToTarget / 60);
        const secs = Math.round(secondsToTarget % 60);
        etaText.innerText = `${mins}m ${secs}s`;
    } else {
        etaText.innerText = "--:--";
    }

    // Stop Timer visibility
    if (shortestDistance > 200) {
        document.getElementById('stop-timer-container').style.display = 'none';
    }

    const idxTarget = journeyPath.indexOf(currentTarget.name);

    // Smooth Auto-Scrolling and Train Positioning
    const nodeWidth = 90;
    const nodeOffset = 45; 
    
    // In simulation mode, use the hyper-accurate internal values instead of reverse distance math
    const displayIdx      = isSimulating ? simPathIdx  : idxCurrent;
    const displayProgress = isSimulating ? simProgress : segmentProgress;

    const currentTrainPos = (displayIdx * nodeWidth) + (displayProgress * nodeWidth) + nodeOffset;
    document.getElementById('moving-train').style.left = currentTrainPos + 'px';
    document.getElementById('track-content').style.left = `calc(50% - ${currentTrainPos}px)`;

    // Update active nodes
    document.querySelectorAll('.track-node').forEach((node, i) => {
        node.classList.toggle('active', i === closestPathIdx);
        node.classList.toggle('target', i === idxTarget);
    });

    // simulation logic remains below...
    if (isSimulating && distToTarget < 50 && simProgress >= 1) {
        if (simPathIdx < journeyPath.length - 1) {
            const isAlarmStation = alertsQueue.length > 0 && currentTarget.name === closestStation;
            if (isAlarmStation) {
                // If it's an alarm station, let triggerAlarm handle the advance
            } else {
                // Move silently to next intermediate station in path
                simPathIdx++;
                simProgress = 0;
                previousTarget = { name: closestStation, data: stationsDB[closestStation] };
            }
        }
    }

    // 4. Map Marker Update
    updateMapMarker(userLat, userLng);

    // Alarm Trigger (Checks Alarm Target)
    const alarmThreshold = 250; 
    if (distToAlarmTarget < alarmThreshold) {
        console.log(`[NAV] Geofence HIT for Alarm: ${currentTarget.name}`);
        triggerAlarm(closestStation, distToAlarmTarget);
    }

    // Final Auto-Finish Check
    if (navTargetIndex === journeyPath.length - 1 && distToNavTarget < 50) {
        console.log("[NAV] Final Destination Reached.");
        finishJourney();
    }
}

function triggerAlarm(closestStation, distToTarget) {
    const statusBar = document.getElementById('live-status-bar');
    statusBar.classList.add('alarm-active');
    
    const statusEl = document.getElementById('status-text');
    const displayMsg = currentTarget.type === "TRANSFER" ? `TRANSFER: ${currentTarget.name}` : `WAKE UP: ${currentTarget.name}`;
    if (statusEl) statusEl.innerText = displayMsg;

    // --- 5. PER-STATION ALERT FEEDBACK ---
    const mode = currentTarget.alertMode || 'voice';
    
    if (mode === 'voice') {
        // Full Chain
        playSmartAnnouncement(currentTarget.type === "TRANSFER" ? "Transfer arriving" : "arriving", currentTarget.name, true);
        if (navigator.vibrate) navigator.vibrate([1000, 500, 1000, 500, 2000]);
    } else if (mode === 'bell') {
        // New 10-Second Looping Bell Alarm (No voice, no vibrate)
        playBellLoop(10000);
    } else if (mode === 'vibrate') {
        if (navigator.vibrate) navigator.vibrate([1000, 500, 1000, 500, 2000]);
    }
    // 'silent' just updates status/UI
    
    alertsQueue.shift();
    const lastTargetName = currentTarget.name;
    
    // DO NOT trigger alarm if we are already at the station we are boarding (Journey Start)
    const isJourneyStart = (simPathIdx === 0 && simProgress < 0.25);

    if (isJourneyStart) {
        // Just move to the next target without stopping (boarding station skip)
        if (isSimulating) {
            simProgress = 0.1; // Kickstart movement
            loadNextTarget(lastTargetName);
        } else {
            loadNextTarget(lastTargetName);
            watchId = navigator.geolocation.watchPosition(updatePosition, handleError, { enableHighAccuracy: true });
        }
    } else if (alertsQueue.length > 0) {
        // Stop the train simulation for mission stop
        isDwelling = true;
        simTotalElapsed = 0; 
        currentSpeedKmph = 0;

        const dwellTime = isSimulating ? 15000 : 30000; // 15s dwell for sim
        let remainingDwell = dwellTime / 1000;
        
        document.getElementById('stop-timer-container').style.display = 'block';
        const timerEl = document.getElementById('stop-timer');
        timerEl.innerText = `${remainingDwell}s`;

        if (stopCountdownInterval) clearInterval(stopCountdownInterval);
        stopCountdownInterval = setInterval(() => {
            remainingDwell--;
            if (remainingDwell >= 0) timerEl.innerText = `${remainingDwell}s`;
            else clearInterval(stopCountdownInterval);
        }, 1000);

        setTimeout(() => {
            isDwelling = false;
            document.getElementById('stop-timer-container').style.display = 'none';
            if (isSimulating) {
                simPathIdx++; 
                simProgress = 0;
                loadNextTarget(lastTargetName);
            } else {
                loadNextTarget(lastTargetName);
                if (!isSimulating) {
                    watchId = navigator.geolocation.watchPosition(updatePosition, handleError, { enableHighAccuracy: true });
                }
            }
        }, dwellTime);
    } else {
        // We cleared all ALERTS. But are we at the FINAL DESTINATION?
        const finalDest = journeyPath[journeyPath.length - 1];
        if (closestStation === finalDest || (distToTarget < 50)) {
            finishJourney();
        } else {
            console.log("[NAV] Station Alert Cleared, continuing to final destination...");
            // No more specific alerts, but keep tracking until the very end
            currentTarget = { name: finalDest, type: "FINAL DESTINATION", data: stationsDB[finalDest] };
            const statusEl = document.getElementById('status-text');
            if (statusEl) statusEl.innerText = `DESTINATION: ${finalDest}`;
        }
    }
}

function finishJourney() {
    isSimulating = false;
    if (simInterval) clearInterval(simInterval);
    disableWakeLock();
    
    const statusEl = document.getElementById('status-text');
    if (statusEl) statusEl.innerText = "JOURNEY COMPLETE";
    
    document.getElementById('distance-text').innerText = "Hope you enjoyed your sleep!";
    document.getElementById('train-track-container').style.display = 'none';
    document.getElementById('sim-controls').style.display = 'none';
    if (watchId) navigator.geolocation.clearWatch(watchId);
}

// UTILITIES
function openMap() { document.getElementById('map-modal').style.display = 'flex'; }
function closeMap() { document.getElementById('map-modal').style.display = 'none'; }

// MAP INTERACTION (ZOOM & PAN)
let currentZoom = 1;
let mapPos = { x: 0, y: 0 };
let isDragging = false;
let startPos = { x: 0, y: 0 };

function zoomMap(delta) {
    currentZoom += delta;
    if (currentZoom < 0.5) currentZoom = 0.5;
    if (currentZoom > 5) currentZoom = 5;
    updateMapTransform();
}

function resetZoom() {
    currentZoom = 1;
    mapPos = { x: 0, y: 0 };
    updateMapTransform();
}

function updateMapTransform() {
    const img = document.getElementById('map-img');
    img.style.transform = `translate(${mapPos.x}px, ${mapPos.y}px) scale(${currentZoom})`;
}

// Drag to Pan
const viewport = document.getElementById('map-viewport');
viewport.addEventListener('mousedown', e => {
    isDragging = true;
    startPos = { x: e.clientX - mapPos.x, y: e.clientY - mapPos.y };
});

window.addEventListener('mousemove', e => {
    if (!isDragging) return;
    mapPos.x = e.clientX - startPos.x;
    mapPos.y = e.clientY - startPos.y;
    updateMapTransform();
});

window.addEventListener('mouseup', () => {
    isDragging = false;
});

// Touch support for mobile panning
viewport.addEventListener('touchstart', e => {
    isDragging = true;
    const touch = e.touches[0];
    startPos = { x: touch.clientX - mapPos.x, y: touch.clientY - mapPos.y };
});

viewport.addEventListener('touchmove', e => {
    if (!isDragging) return;
    const touch = e.touches[0];
    mapPos.x = touch.clientX - startPos.x;
    mapPos.y = touch.clientY - startPos.y;
    updateMapTransform();
    e.preventDefault();
}, { passive: false });

viewport.addEventListener('touchend', () => isDragging = false);

// 5. LIVE TRAIN ON MAP LOGIC
let isFollowing = false;

function toggleFollow() {
    isFollowing = !isFollowing;
    document.getElementById('follow-toggle').classList.toggle('active', isFollowing);
    if (isFollowing && lastLat && lastLng) {
        // Force a snap to train right now if we have coordinates
        updateMapMarker(lastLat, lastLng, true); 
    }
}

function updateMapMarker(lat, lng, forceCenter = false) {
    const marker = document.getElementById('live-train-marker');
    if (!marker) return;

    // If lat/lng not provided (e.g. from follow toggle), get from current nearest station or keep last
    if (!lat || !lng) {
        // Fallback to current target or mid-point if moving
        return; 
    }

    const pos = projectGPSToMap(lat, lng);
    marker.style.left = pos.x + '%';
    marker.style.top = pos.y + '%';

    if (isFollowing || forceCenter) {
        // Center the viewport on the marker
        centerMapOnMarker(pos);
    }
}

function projectGPSToMap(lat, lng) {
    // HMR SCHEMATIC CALIBRATION
    // These values map the HMR GPS boundaries to the 0-100% of our generated map image
    const mapBounds = {
        north: 17.51,
        south: 17.33,
        west: 78.34,
        east: 78.58
    };

    let x = ((lng - mapBounds.west) / (mapBounds.east - mapBounds.west)) * 100;
    let y = 100 - (((lat - mapBounds.south) / (mapBounds.north - mapBounds.south)) * 100);

    // Padding to keep inside map visual area
    return { 
        x: Math.max(5, Math.min(95, x)), 
        y: Math.max(10, Math.min(90, y)) 
    };
}

function centerMapOnMarker(pos) {
    const viewport = document.getElementById('map-viewport');
    const img = document.getElementById('map-img');
    
    // We update mapPos to align the marker with viewport center
    // Viewport is roughly center-origin for scale, but we need translation
    const vWidth = viewport.clientWidth;
    const vHeight = viewport.clientHeight;
    
    // Convert percentage to pixels relative to image size
    const imgWidth = img.scrollWidth;
    const imgHeight = img.scrollHeight;
    
    const targetX = (imgWidth * (pos.x / 100));
    const targetY = (imgHeight * (pos.y / 100));

    // Calculate translation to bring target to viewport center
    mapPos.x = (vWidth / 2) - targetX;
    mapPos.y = (vHeight / 2) - targetY;

    updateMapTransform();
}

function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371e3; // Earth radius in meters
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

function handleError(err) {
    document.getElementById('current-station-text').innerText = "GPS Error. Check settings.";
}

// openMap() and closeMap() are defined in UTILITIES section above — duplicates removed.

// App Update Utility
function checkForUpdates() {
    const btn = document.getElementById('update-btn');
    if (btn) btn.innerText = '⟳...';
    
    // Unregister service workers and clear caches
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.getRegistrations().then(function(registrations) {
            for(let registration of registrations) {
                registration.unregister();
            }
        });
    }
    
    if ('caches' in window) {
        caches.keys().then(function(names) {
            for (let name of names)
                caches.delete(name);
        });
    }
    
    // Complete the visual feedback and reload
    setTimeout(() => {
        window.location.reload(true);
    }, 500);
}