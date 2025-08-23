// ==UserScript==
// @name         GoMining Boost Runner - Prod + Test Fusion
// @version      1.8.3
// @description  Runner fusion Prod/Test avec FLAG TEST_MODE + replay si reload
// @match        https://app.gomining.com/*
// @run-at       document-start
// @grant        none
// ==/UserScript==

(function () {
    const GAME_WS_DOMAIN = "nft.ws.gomining.com";
    const TEST_MODE = false; // <-- changer pour passer en prod

    let lastSentRoundId = null;
    let roundLock = false;
    let currentBoostConfig = null;
    window._lastRoundId = null;
    window._lastMultiplier = null;

    // --- helpers ---
    function nowIso() { return new Date().toISOString().replace("T", " ").replace("Z", ""); }
    function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
    function uuidv4() { return ([1e7]+-1e3+-4e3+-8e3+-1e11).replace(/[018]/g, c =>
        (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16)
    ); }

    // --- persistence pending boost ---
    function setPendingBoost(roundId, multiplier) {
        localStorage.setItem("gomining_pending_boost", JSON.stringify({
            roundId, multiplier, ts: Date.now()
        }));
    }
    function clearPendingBoost() { localStorage.removeItem("gomining_pending_boost"); }
    function getPendingBoost() {
        const raw = localStorage.getItem("gomining_pending_boost");
        if (!raw) return null;
        try {
            return JSON.parse(raw);
        } catch { return null; }
    }

    // --- API ---
    function getBearer() {
        let t = localStorage.getItem('access_token');
        if (t) return t;
        let m = document.cookie.match(/access_token=([^;]+)/);
        return m ? m[1] : null;
    }

    async function updateRoundIdFromApi() {
        const bearer = getBearer();
        if (!bearer) return;
        try {
            const resp = await fetch("https://api.gomining.com/api/nft-game/round/get-last", {
                headers: { "authorization": `Bearer ${bearer}` },
                credentials: "include"
            });
            const json = await resp.json();
            if (json?.data?.id) {
                window._lastRoundId = json.data.id;
                window._lastMultiplier = json.data.multiplier ?? null;
                console.log("[TM] ✅ roundId:", window._lastRoundId, ", multiplier:", window._lastMultiplier);
            }
        } catch (e) { console.warn("[TM] ❌ API round/get-last failed:", e); }
    }

    async function getCurrentHashrateEhs() {
        try {
            const res = await fetch("https://api.blockchair.com/bitcoin/stats");
            const json = await res.json();
            return json?.data?.hashrate_24h ? json.data.hashrate_24h / 1e18 : null;
        } catch { return null; }
    }

    async function updateBoostConfig() {
        const stored = localStorage.getItem("gomining_boost_config");
        if (!stored) return;
        let parsed; try { parsed = JSON.parse(stored); } catch { return; }
        const now = new Date(), day = now.getDay(), hour = now.getHours();
        const useDefault = (day === 2 && hour >= 18) || (day > 2 && day < 6) || (day === 6 && hour < 8);
        const selectedGroup = parsed?.[useDefault ? "default" : "late"];
        const hashrate = await getCurrentHashrateEhs();
        if (!hashrate) { currentBoostConfig = selectedGroup?.low?.config ?? {}; return; }
        for (const range of Object.values(selectedGroup)) {
            if (hashrate >= range.min && hashrate < range.max) { currentBoostConfig = range.config; return; }
        }
        currentBoostConfig = selectedGroup?.low?.config ?? {};
    }

    // --- boost execution ---
    function sendAbility(boostId, count, roundId, clickDelay = 250) {
        for (let i = 0; i < count; i++) {
            const payload = { abilityId: boostId, idempotencyKey: uuidv4(), roundId };
            const msg = "42" + JSON.stringify(["ability", payload]);
            setTimeout(() => {
                if (TEST_MODE) {
                    console.log(`[TEST][${nowIso()}] boost ${boostId} (round ${roundId})`);
                } else {
                    if (!window.__myws_jeu || window.__myws_jeu.readyState !== 1) return;
                    window.__myws_jeu.send(msg);
                    console.log(`[TM][${nowIso()}] ✅ Boost ${boostId} envoyé`);
                }
            }, i * clickDelay);
        }
    }

    async function performBoost(multiplierOverride = null, manualRoundId = null) {
        const multiplier = multiplierOverride ?? window._lastMultiplier;
        const roundId = manualRoundId ?? window._lastRoundId;
        const boostConfigSnapshot = currentBoostConfig;
        if (!roundId || roundId === lastSentRoundId || !boostConfigSnapshot || !multiplier) return;

        let actions = boostConfigSnapshot[multiplier];
        if (!actions?.length) return;

        // marquer pending
        setPendingBoost(roundId, multiplier);

        console.log(`[${nowIso()}] ⚡ Séquence boost x${multiplier} (roundId ${roundId}) — ${actions.length} actions`);

        for (const { boostId, count, timing } of actions) {
            const seqDelay = Math.max(50, (timing?.sequenceDelay ?? 0) * 1000 + Math.random() * 15000);
            await sleep(seqDelay);
            for (let j = 0; j < count; j++) {
                const clickDelay = Math.max(50, (timing?.clickDelay ?? 250) + Math.random() * 2000);
                sendAbility(boostId, 1, roundId, clickDelay);
                await sleep(clickDelay);
            }
        }
        lastSentRoundId = roundId;
        clearPendingBoost(); // ✅ boost exécuté, on nettoie
    }

    // --- Replay au reload ---
    (async function checkPending() {
        const pend = getPendingBoost();
        if (pend) {
            console.log("[TM] 🔁 Pending boost trouvé :", pend);
            await updateRoundIdFromApi();
            await updateBoostConfig();
            if (pend.roundId === window._lastRoundId) {
                console.log("[TM] ➡️ Rejeu du boost manqué round", pend.roundId);
                performBoost(pend.multiplier, pend.roundId);
            } else {
                console.log("[TM] ❌ RoundId expiré, on nettoie le pending.");
                clearPendingBoost();
            }
        }
    })();

    // --- WS interception (prod only) ---
    if (!TEST_MODE) {
        const originalWebSocket = window.WebSocket;
        window.WebSocket = function (url, protocols) {
            const ws = protocols ? new originalWebSocket(url, protocols) : new originalWebSocket(url);
            if (url.includes(GAME_WS_DOMAIN)) {
                console.log("[TM] 🎮 WS interceptée :", url);
                window.__myws_jeu = ws;

                ws.addEventListener("message", evt => {
                    if (evt.data.startsWith('42["roundOpened"') && !roundLock) {
                        roundLock = true;
                        (async () => {
                            await updateRoundIdFromApi();
                            await updateBoostConfig();
                            const delay = Math.random()*2000 + 3000;
                            console.log(`[TM] ⏳ Attente ${delay.toFixed(0)}ms avant boost...`);
                            setTimeout(async () => {
                                try { await performBoost(); }
                                catch(e){ console.error("[TM] Erreur performBoost:", e); }
                                finally { roundLock = false; }
                            }, delay);
                        })();
                    }
                });
            }
            return ws;
        };
        window.WebSocket.prototype = originalWebSocket.prototype;
    }

    // --- Init ---
    updateBoostConfig().then(() => {
        console.log(TEST_MODE ? "[TEST MODE] Runner prêt." : "[TM] Runner prêt pour prod.");
    });

})();
