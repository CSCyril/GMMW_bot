// ==UserScript==
// @name         GoMining Boost Runner Debug
// @version      1.9.14
// @description  Runner avec debug complet
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
    let lastObservedRoundId = null;
    let roundLock = false;
    let currentBoostConfig = null;
    let isFirstRound = true;
    window._lastRoundId = window._lastRoundId || null;
    window._lastMultiplier = window._lastMultiplier || null;
    const PLAYERS_TO_WATCH = ["💚 Fanny 💚", "Dany 🚀"];
    let playerPlayed = false;
    let roundStartTimeout = null;

    // --- Fonctions utilitaires ---
    function nowIso() { return new Date().toISOString().replace("T", " ").replace("Z", ""); }
    function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
    function uuidv4() { return ([1e7]+-1e3+-4e3+-8e3+-1e11).replace(/[018]/g, c => (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16)); }
    function shuffle(arr) { for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; } }

    // --- Exposition globale pour debug ---
    window._currentBoostConfig = currentBoostConfig;
    window._debugRunner = {
        lastSentRoundId,
        lastObservedRoundId,
        roundLock,
        playerPlayed,
        roundStartTimeout
    };

    async function getCurrentHashrateEhs() {
        try {
            const res = await fetch("https://api.blockchair.com/bitcoin/stats");
            const json = await res.json();
            console.log("[DEBUG] Hashrate actuel (EH/s):", json?.data?.hashrate_24h / 1e18);
            return json?.data?.hashrate_24h ? json.data.hashrate_24h / 1e18 : null;
        } catch (e) {
            console.warn("[DEBUG] Erreur getCurrentHashrateEhs:", e);
            return null;
        }
    }

    async function updateBoostConfig() {
        console.log("[DEBUG] updateBoostConfig start");
        const stored = localStorage.getItem("gomining_boost_config");
        const storedTimeRanges = localStorage.getItem("gomining_time_ranges");
        if (!stored || !storedTimeRanges) {
            console.log("[DEBUG] Pas de config ou plages horaires en localStorage");
            return;
        }

        let parsedConfig, parsedTimeRanges;
        try { parsedConfig = JSON.parse(stored); parsedTimeRanges = JSON.parse(storedTimeRanges); } catch (e) { console.warn("[DEBUG] JSON parse error:", e); return; }

        const now = new Date(), day = now.getDay(), hour = now.getHours(), currentMinutes = now.getMinutes(), currentTime = hour*60 + currentMinutes;
        const useDefault = (day === 2 && hour >= 18) || (day > 2 && day < 6) || (day === 6 && hour < 8);
        const selectedGroupName = useDefault ? "default" : "late";
        const multiplier = window._lastMultiplier;
        if (!multiplier) { console.log("[DEBUG] Pas de multiplier défini"); return; }

        const hashrate = await getCurrentHashrateEhs();
        const level = hashrate ? getLevelFromHashrate(hashrate, selectedGroupName) : "low";
        const timeRangeKey = `${selectedGroupName}_${level}_${multiplier}`;
        const timeRanges = parsedTimeRanges[timeRangeKey] || [];

        let isWithinTimeRange = timeRanges.length === 0 ? true : false;
        for (const range of timeRanges) {
            const [startH,startM] = range.start.split(':').map(Number);
            const [endH,endM] = range.end.split(':').map(Number);
            const startMin = startH*60 + startM, endMin = endH*60 + endM;
            if (currentTime >= startMin && currentTime < endMin) isWithinTimeRange = true;
        }
        if (!isWithinTimeRange) console.log(`[DEBUG] Hors des plages horaires ${timeRangeKey}`);

        const boostConfigKey = `${selectedGroupName}_${level}_${multiplier}`;
        currentBoostConfig = parsedConfig[boostConfigKey]?.config ?? {};
        window._currentBoostConfig = currentBoostConfig;
        console.log("[DEBUG] currentBoostConfig mis à jour:", currentBoostConfig);
    }

    function sendAbility(boostId, count, roundId, clickDelay=250) {
        console.log(`[DEBUG] sendAbility boostId=${boostId} count=${count} roundId=${roundId}`);
        for (let i=0;i<count;i++) {
            const payload = { abilityId: boostId, idempotencyKey: uuidv4(), roundId };
            const msg = "42" + JSON.stringify(["ability", payload]);
            setTimeout(() => {
                if (TEST_MODE) {
                    console.log(`[TEST] boost ${boostId} round ${roundId}`);
                } else {
                    if (!window.__myws_jeu || window.__myws_jeu.readyState !== 1) { console.warn("[DEBUG] WS non ready"); return; }
                    window.__myws_jeu.send(msg);
                    console.log(`[DEBUG] Boost ${boostId} envoyé via WS`);
                }
            }, i*clickDelay);
        }
    }

    async function performBoost(multiplierOverride=null, manualRoundId=null, skipPriorityCheck=false) {
        console.log("[DEBUG] performBoost start", {multiplierOverride, manualRoundId, skipPriorityCheck});
        const isWithinRanges = await isWithinTimeRanges();
        if (!isWithinRanges) { console.log("[DEBUG] Hors plages horaires"); return; }

        const multiplier = multiplierOverride ?? window._lastMultiplier;
        const roundId = manualRoundId ?? window._lastRoundId;
        if (roundId === lastSentRoundId) { console.log("[DEBUG] Round déjà traité"); return; }

        const boostConfigSnapshot = currentBoostConfig;
        if (!roundId || !boostConfigSnapshot || !multiplier) { console.log("[DEBUG] Boost config ou roundId ou multiplier manquant"); return; }

        let actions = boostConfigSnapshot[multiplier];
        if (!actions?.length) { console.log("[DEBUG] Pas d'actions pour ce multiplier"); return; }

        console.log("[DEBUG] Actions à exécuter:", actions);

        // Prioritaires
        const priorityActions = actions.filter(a => (a.priority ?? 2)===1);
        const otherActions = actions.filter(a => (a.priority ?? 2)!==1);

        for (const action of [...priorityActions, ...otherActions]) {
            console.log("[DEBUG] Envoi boost:", action);
            await sleep((action.timing?.sequenceDelay ?? 0)*1000);
            sendAbility(action.boostId, action.count, roundId, (action.timing?.clickDelay ?? 250));
        }

        lastSentRoundId = roundId;
    }

    // --- Exposition fonctions debug ---
    window._performBoost = performBoost;
    window._updateBoostConfig = updateBoostConfig;
    window._sendAbility = sendAbility;

    // --- Simulation round test ---
    function simulateRound(mult) {
        if (!TEST_MODE) { console.log("[DEBUG] Activer TEST_MODE pour simulateRound"); return; }
        window._lastRoundId = "test_round_id";
        window._lastMultiplier = mult;
        console.log(`[TEST] Simulation round mult=${mult}`);
        performBoost(mult, "test_round_id");
    }
    window.simulateRound = simulateRound;

    console.log("[DEBUG] Runner debug initialisé");
})();
