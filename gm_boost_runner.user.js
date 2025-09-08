// ==UserScript==
// @name         GoMining Boost Runner - Prod + Test Fusion (RoundId Watcher)
// @version      1.9.0
// @description  Runner fusion Prod/Test + déclenchement sur roundOpened OU changement window._lastRoundId
// @match        https://app.gomining.com/*
// @run-at       document-start
// @grant        none
// @updateURL    https://github.com/CSCyril/GMMW_bot/raw/refs/heads/main/gm_boost_runner.user.js
// @downloadURL  https://github.com/CSCyril/GMMW_bot/raw/refs/heads/main/gm_boost_runner.user.js
// ==/UserScript==

(function () {
    const GAME_WS_DOMAIN = "nft.ws.gomining.com";
    const TEST_MODE = false;

    let lastSentRoundId = null;
    let lastSeenRoundId = null; // <--- nouvelle variable pour watcher
    let roundLock = false;
    let currentBoostConfig = null;
    window._lastRoundId = window._lastRoundId ?? null;
    window._lastMultiplier = window._lastMultiplier ?? null;

    function nowIso() { return new Date().toISOString().replace("T", " ").replace("Z", ""); }
    function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
    function uuidv4() { return ([1e7]+-1e3+-4e3+-8e3+-1e11).replace(/[018]/g, c =>
        (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16)
    ); }

    function setPendingBoost(roundId, multiplier) {
        localStorage.setItem("gomining_pending_boost", JSON.stringify({ roundId, multiplier, ts: Date.now() }));
    }
    function clearPendingBoost() { localStorage.removeItem("gomining_pending_boost"); }
    function getPendingBoost() {
        try { return JSON.parse(localStorage.getItem("gomining_pending_boost")); }
        catch { return null; }
    }

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

        setPendingBoost(roundId, multiplier);
        console.log(`[${nowIso()}] ⚡ Séquence boost x${multiplier} (roundId ${roundId}) — ${actions.length} actions`);

        for (const { boostId, count, timing } of actions) {
            const seqDelay = Math.max(50, (timing?.sequenceDelay ?? 0) * 1000 + Math.random() * 5000);
            await sleep(seqDelay);
            for (let j = 0; j < count; j++) {
                const clickDelay = Math.max(50, (timing?.clickDelay ?? 250) + Math.random() * 500);
                sendAbility(boostId, 1, roundId, clickDelay);
                await sleep(clickDelay);
            }
        }
        lastSentRoundId = roundId;
        clearPendingBoost();
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
                        triggerBoostSequence("WS roundOpened");
                    }
                });
            }
            return ws;
        };
        window.WebSocket.prototype = originalWebSocket.prototype;
    }

    // --- RoundId watcher (nouvelle logique) ---
    setInterval(() => {
        if (window._lastRoundId && window._lastRoundId !== lastSeenRoundId && !roundLock) {
            lastSeenRoundId = window._lastRoundId;
            triggerBoostSequence("roundId watcher");
        }
    }, 500);

    async function triggerBoostSequence(source) {
        if (roundLock) return;
        roundLock = true;
        console.log(`[TM] 🔔 Nouveau round détecté via ${source} → préparation boost...`);
        await updateRoundIdFromApi();
        await updateBoostConfig();
        setTimeout(async () => {
            try { await performBoost(); }
            catch (e) { console.error("[TM] Erreur performBoost:", e); }
            finally { roundLock = false; }
        }, 0);
    }

    // --- Init ---
    updateBoostConfig().then(() => {
        console.log(TEST_MODE ? "[TEST MODE] Runner prêt." : "[TM] Runner prêt pour prod.");
    });

})();
