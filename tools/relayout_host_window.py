import re, sys, io
p = 'index.html'
s = io.open(p, encoding='utf-8').read()
start = s.index('        <div class="main">')
end = s.index('            <div id="remoteScreen">')
new = '''        <div class="main">
            <section class="card" id="cardSession">
                <h2>&#128640; Session Control</h2>
                <div class="segmented" id="modeSwitch">
                    <button class="seg-btn active" data-mode="host" onclick="setMode('host')">&#128640; Host</button>
                    <button class="seg-btn" data-mode="join" onclick="setMode('join')">&#128279; Join</button>
                </div>
                <div id="hostMode">
                    <input type="text" id="customRoomCode" placeholder="Optional: Persistent Room Code" style="text-transform:uppercase">
                    <select id="monitorSelect" style="display:none"></select>
                    <div class="mon-head"><span>Screen to share</span><button type="button" class="mon-refresh" id="monRefresh" onclick="loadSources(true)">&#8635; Refresh</button></div>
                    <div class="mon-grid" id="monitorGrid"></div>
                    <button onclick="userClickedHost=true; createAndHost()">&#128640; Start Hosting (Share Screen)</button>
                </div>
                <div id="viewerMode" style="display:none;">
                    <input type="text" id="roomCodeInput" placeholder="Enter Room Code" maxlength="32" style="text-transform:uppercase">
                    <button onclick="joinSession()">&#128279; Join Remote Session</button>
                </div>
                <div id="activeSession" style="display:none;">
                    <div class="room-code" id="displayCode">———</div>
                    <div class="pair-grid">
                        <img id="pairQr" alt="Scan to join" style="display:none">
                        <div class="pair-addr">
                            <label for="pairHost">Pairing address</label>
                            <div class="pair-row">
                                <input type="text" id="pairHost" spellcheck="false" autocomplete="off" autocapitalize="off" placeholder="detecting…">
                                <button type="button" class="pair-reset" id="pairReset" title="Reset to the detected address">&#8635;</button>
                            </div>
                            <div class="pair-hint" id="pairHint"></div>
                            <div class="btn-row" style="margin-top:8px">
                                <button class="success" onclick="copyCode()">&#128203; Code</button>
                                <button class="info" onclick="copyLink()">&#128279; Link</button>
                            </div>
                        </div>
                    </div>
                    <div class="pair-addr" id="remotePanel" style="display:none">
                        <label>Remote access</label>
                        <div class="pair-hint" id="tunnelHint">tunnel: checking…</div>
                        <div class="remote-grid">
                            <div>
                                <button class="info" type="button" onclick="enrollDevice()">&#128273; Enroll a device</button>
                                <div class="pair-hint" id="enrollHint"></div>
                                <div id="deviceList" class="device-list"></div>
                            </div>
                            <img id="enrollQr" alt="Scan to enroll" style="display:none">
                        </div>
                    </div>
                    <button class="danger" onclick="endSession()">&#9940; End Session</button>
                </div>
            </section>
            <section class="card" id="cardStream">
                <h2>&#9881;&#65039; Stream Settings <span id="liveSettingsPill" class="live-pill" style="display:none;">LIVE</span></h2>
                <div class="settings-grid">
                    <div class="setting-row">
                        <label>Resolution</label>
                        <select id="resolutionSelect" onchange="onUserStreamChange()">
                            <option value="source" selected>Source (native)</option>
                            <option value="1920x1080">1080p — 1920×1080</option>
                            <option value="1280x720">720p — 1280×720</option>
                            <option value="2560x1440">1440p — 2560×1440</option>
                            <option value="3840x2160">4K — 3840×2160</option>
                        </select>
                    </div>
                    <div class="setting-row">
                        <label>Frame Rate</label>
                        <select id="fpsSelect" onchange="onUserStreamChange()">
                            <option value="60" selected>60 fps</option>
                            <option value="30">30 fps</option>
                            <option value="24">24 fps</option>
                            <option value="15">15 fps</option>
                        </select>
                    </div>
                </div>
                <div class="setting-row">
                    <label>Bitrate</label>
                    <input type="range" id="qualitySlider" min="500" max="20000" step="500" value="12000" oninput="onSliderInput()">
                    <span class="quality-val" id="qualityLabel">12 Mbps</span>
                </div>
                <div id="autoHint" class="auto-hint">&#128640; Auto-adapting to network</div>
                <div class="settings-grid">
                    <div class="toggle-row">
                        <label>Auto Bitrate <span style="font-size:10px;color:#64748b;font-weight:400;">(adapts to signal)</span></label>
                        <label class="toggle"><input type="checkbox" id="autoBitrateToggle" checked onchange="toggleAutoBitrate()"><span class="slider"></span></label>
                    </div>
                    <div class="toggle-row">
                        <label>Audio</label>
                        <label class="toggle"><input type="checkbox" id="audioToggle" checked onchange="applyStreamSettings()"><span class="slider"></span></label>
                    </div>
                    <div class="toggle-row">
                        <label>Lock Viewer Input</label>
                        <label class="toggle"><input type="checkbox" id="lockInputToggle" onchange="toggleInputLock()"><span class="slider"></span></label>
                    </div>
                    <div class="toggle-row">
                        <label>View Only (this side)</label>
                        <label class="toggle"><input type="checkbox" id="viewOnlyToggle"><span class="slider"></span></label>
                    </div>
                    <div class="toggle-row">
                        <label>Tray while hosting <span style="font-size:10px;color:#64748b;font-weight:400;">(hides chrome)</span></label>
                        <label class="toggle"><input type="checkbox" id="trayToggle" onchange="onTrayToggle()"><span class="slider"></span></label>
                    </div>
                </div>
                <h2 class="section-head">&#128202; Connection Stats</h2>
                <div class="stat-grid">
                    <div class="stat-box"><div class="stat-label">Bitrate</div><div class="stat-val" id="statBitrate">—</div></div>
                    <div class="stat-box"><div class="stat-label">FPS</div><div class="stat-val" id="statFps">—</div></div>
                    <div class="stat-box"><div class="stat-label">Latency</div><div class="stat-val" id="statLatency">—</div></div>
                    <div class="stat-box"><div class="stat-label">Loss</div><div class="stat-val" id="statLoss">—</div></div>
                    <div class="stat-box"><div class="stat-label">Resolution</div><div class="stat-val" id="statRes">—</div></div>
                    <div class="stat-box"><div class="stat-label">Signal</div><div class="stat-val signal-pill" id="statSignal"><span class="signal-dot" id="signalDot"></span><span id="signalText">—</span></div></div>
                </div>
            </section>
            <section class="card" id="cardLog">
                <h2>&#128196; Connection Log</h2>
                <div id="log" class="log"></div>
            </section>
'''
s = s[:start] + new + s[end:]
css = '''        .main { display: grid; grid-template-columns: minmax(340px, 420px) minmax(360px, 1fr) minmax(320px, 460px); grid-template-rows: minmax(0, 1fr); gap: 16px; padding: 16px; flex: 1; min-height: 0; overflow: hidden; }
        .card { background: var(--surface); border: 1px solid #334155; border-radius: 14px; padding: 18px; min-height: 0; overflow-y: auto; display: flex; flex-direction: column; scrollbar-width: thin; scrollbar-color: #334155 transparent; }
        .card::-webkit-scrollbar { width: 4px; }
        .card::-webkit-scrollbar-thumb { background: #334155; border-radius: 4px; }
        #cardLog .log { flex: 1; }
        .main:has(#remoteScreen[style*="flex"]) { grid-template-columns: minmax(320px, 360px) 1fr; grid-template-rows: minmax(0, 1fr) 220px; }
        .main:has(#remoteScreen[style*="flex"]) #cardStream { display: none; }
        .main:has(#remoteScreen[style*="flex"]) #cardSession { grid-column: 1; grid-row: 1; }
        .main:has(#remoteScreen[style*="flex"]) #cardLog { grid-column: 1; grid-row: 2; }
        .main:has(#remoteScreen[style*="flex"]) #remoteScreen { grid-column: 2; grid-row: 1 / 3; }
        @media (max-width: 1100px) { .main { grid-template-columns: 1fr 1fr; grid-template-rows: minmax(0, 1fr) 220px; } #cardLog { grid-column: 1 / 3; } }
        @media (max-width: 760px) { .main { grid-template-columns: 1fr; grid-template-rows: auto auto 220px; overflow-y: auto; } #cardLog { grid-column: 1; } }
        .pair-grid { display: grid; grid-template-columns: 150px 1fr; gap: 14px; align-items: start; margin-top: 4px; }
        .pair-grid img, .remote-grid img { width: 150px; height: 150px; background: #fff; border-radius: 8px; padding: 6px; object-fit: contain; display: block; }
        .pair-grid .pair-addr { margin: 0; }
        .remote-grid { display: grid; grid-template-columns: 1fr 150px; gap: 14px; align-items: start; margin-top: 8px; }
        .remote-grid button { margin-bottom: 8px; }
        .device-list { font-size: 12px; line-height: 1.7; }
        .device-list a { color: #fda4af; margin-left: 6px; }
        .settings-grid { display: grid; grid-template-columns: 1fr 1fr; column-gap: 18px; }
        .settings-grid .setting-row { flex-direction: column; align-items: stretch; gap: 4px; }
        .settings-grid .toggle-row { padding: 6px 0; border-bottom: 1px solid #1e293b; }
        .settings-grid .toggle-row:nth-last-child(-n+2) { border-bottom: none; }
    </style>'''
s = s.replace('    </style>', css, 1)
io.open(p, 'w', encoding='utf-8', newline='\n').write(s)
print('relayout ok')
