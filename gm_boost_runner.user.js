// ==UserScript==
// @name         GoMining Boost Runner - Prod Modifié
// @version      1.7.1
// @description  Runner avec sequenceDelay + 0→15s, clickDelay ± random, priorités, envoi réel
// @author       CyrilG.
// @match        https://app.gomining.com/*
// @run-at       document-start
// @grant        none
// @updateURL    https://github.com/CSCyril/GMMW_bot/raw/refs/heads/main/gm_boost_runner.user.js
// @downloadURL  https://github.com/CSCyril/GMMW_bot/raw/refs/heads/main/gm_boost_runner.user.js
// ==/UserScript==

(function () {
    const GAME_WS_DOMAIN = "nft.ws.gomining.com";

    let lastSentRoundId = null;
    let roundLock = false;
    let currentBoostConfig = null;
    window._lastRoundId = null;
    window._lastMultiplier = null;

    function nowIso() { return new Date().toISOString().replace("T", " ").replace("Z", ""); }

    function uuidv4() {
        return ([1e7]+-1e3+-4e3+-8e3+-1e11).replace(/[018]/g, c =>
            (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16)
        );
    }

    function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

    function getBearer() {
        let t = localStorage.getItem('access_token');
        if (t) return t;
        let m = document.cookie.match(/access_token=([^;]+)/);
        return m ? m[1] : null;
    }

    async function updateRoundIdFromApi() {
        const bearer = getBearer();
        if (!bearer) return;
        const url = "https://api.gomining.com/api/nft-game/round/get-last";
        try {
            const resp = await fetch(url, {
                method: "GET",
                headers: {
                    "accept": "application/json, text/plain, */*",
                    "authorization": `Bearer ${bearer}`,
                    "origin": "https://app.gomining.com",
                    "referer": "https://app.gomining.com/",
                    "x-device-type": "desktop"
                },
                credentials: "include"
            });
            const json = await resp.json();
            if (json?.data?.id) {
                window._lastRoundId = json.data.id;
                window._lastMultiplier = json.data.multiplier ?? null;
                console.log("[TM] ✅ roundId: ", window._lastRoundId, ", multiplier:", window._lastMultiplier);
            }
        } catch (e) { console.warn("[TM] ❌ API round/get-last failed:", e); }
    }

    async function getCurrentHashrateEhs() {
        try {
            const res = await fetch("https://api.blockchair.com/bitcoin/stats");
            const json = await res.json();
            const rate = json?.data?.hashrate_24h;
            return rate ? rate / 1e18 : null;
        } catch (e) { console.warn("[TM] ❌ Erreur récupération hashrate:", e); return null; }
    }

    async function updateBoostConfig() {
        const stored = localStorage.getItem("gomining_boost_config");
        if (!stored) return;
        let parsed;
        try { parsed = JSON.parse(stored); } catch(e){ return; }
        const now = new Date();
        const day = now.getDay();
        const hour = now.getHours();
        const useDefault = (day === 2 && hour >= 18) || (day > 2 && day < 6) || (day === 6 && hour < 8);
        const configSetName = useDefault ? "default" : "late";
        const selectedGroup = parsed?.[configSetName];
        const hashrate = await getCurrentHashrateEhs();
        if (!hashrate) { currentBoostConfig = selectedGroup?.low?.config ?? {}; return; }
        for (const range of Object.values(selectedGroup)) {
            if (hashrate >= range.min && hashrate < range.max) { currentBoostConfig = range.config; return; }
        }
        currentBoostConfig = selectedGroup?.low?.config ?? {};
        console.log("[TM] Boost config chargée via updateBoostConfig()");
    }

    function sendAbility(boostId, count, roundId, clickDelay = 250) {
        if (!window.__myws_jeu || window.__myws_jeu.readyState !== 1) return;
        for (let i = 0; i < count; i++) {
            const payload = { abilityId: boostId, idempotencyKey: uuidv4(), roundId };
            const msg = "42" + JSON.stringify(["ability", payload]);
            const delayToApply = i * clickDelay;
            setTimeout(() => {
                window.__myws_jeu.send(msg);
                console.log(`[TM][${nowIso()}] ✅ Boost ${boostId} envoyé (${i+1}/${count})`);
            }, delayToApply);
        }
    }

    function shuffle(arr) {
        for (let i = arr.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [arr[i], arr[j]] = [arr[j], arr[i]];
        }
    }

    function applyPriorityOrder(actions) {
        const fixed = actions.filter(a => (a.priority ?? 2) === 1);
        const randomized = actions.filter(a => (a.priority ?? 2) !== 1);
        shuffle(randomized);
        const finalSeq = [];
        let randIndex = 0, fixedIndex = 0;
        for (let i = 0; i < actions.length; i++) {
            if ((actions[i].priority ?? 2) === 1) finalSeq.push(fixed[fixedIndex++]);
            else finalSeq.push(randomized[randIndex++]);
        }
        return finalSeq;
    }

    async function performBoost() {
        const roundId = window._lastRoundId;
        const boostConfigSnapshot = currentBoostConfig;
        const multiplier = window._lastMultiplier;
        if (!roundId || roundId === lastSentRoundId || !boostConfigSnapshot || !multiplier) return;

        let actions = boostConfigSnapshot[multiplier];
        if (!actions?.length) return;

        actions = applyPriorityOrder(actions);

        console.log(`[TM] Séquence boost x${multiplier} (roundId ${roundId}) — ${actions.length} actions (priority-aware)`);

        for (let i = 0; i < actions.length; i++) {
            const { boostId, count, timing } = actions[i];
            const baseClick = timing?.clickDelay ?? 250;
            const baseSeq = timing?.sequenceDelay ?? 0;

            const sequenceDelay = Math.max(50, baseSeq * 1000 + (Math.random() * 15000));
            const clickDelay = Math.max(50, baseClick + (Math.random() * 120 - 60));

            await sleep(sequenceDelay);
            sendAbility(boostId, count, roundId, clickDelay);

            if (i < actions.length - 1) await sleep(50);
        }

        lastSentRoundId = roundId;
    }

    const originalWebSocket = window.WebSocket;
    window.WebSocket = function (url, protocols) {
        const ws = protocols ? new originalWebSocket(url, protocols) : new originalWebSocket(url);

        if (url.includes(GAME_WS_DOMAIN)) {
            console.log("[TM] 🎮 WS interceptée :", url);
            window.__myws_jeu = ws;

            let userOnMessage = null;
            Object.defineProperty(ws, "onmessage", {
                configurable: true,
                enumerable: true,
                get() { return userOnMessage; },
                set(fn) { userOnMessage = fn; }
            });

            ws.addEventListener("message", evt => {
                if (evt.data.startsWith('42["roundOpened"')) {
                    if (!roundLock) {
                        roundLock = true;
                        (async () => {
                            await updateRoundIdFromApi();
                            await updateBoostConfig();
                            const delay = Math.random() * 2000 + 3000;
                            console.log(`[TM] ⏳ Attente ${delay.toFixed(0)}ms avant boost...`);
                            const failSafeTimeout = setTimeout(() => {
                                console.warn("[TM] ❗ Boost non exécuté → reload forcé");
                                location.reload();
                            }, 10000);
                            setTimeout(async () => {
                                try { await performBoost(); clearTimeout(failSafeTimeout); }
                                catch (e) { console.error("[TM] ❌ Erreur performBoost:", e); location.reload(); }
                                finally { roundLock = false; }
                            }, delay);
                        })();
                    }
                }

                if (typeof userOnMessage === "function") {
                    try { userOnMessage.call(ws, evt); } catch (e) { console.warn("[TM] ❌ Erreur dans onmessage utilisateur:", e); }
                }
            });
        }

        return ws;
    };
    window.WebSocket.prototype = originalWebSocket.prototype;

    setInterval(async () => {
        const bearer = getBearer();
        if (!bearer) return;
        const res = await fetch("https://api.gomining.com/api/nft-game/round/get-last", { headers: { Authorization: `Bearer ${bearer}` } });
        const json = await res.json();
        const apiRoundId = json?.data?.id;
        if (apiRoundId && apiRoundId !== window._lastRoundId) {
            console.warn("[TM] 🔁 roundOpened manqué → fallback déclenché");
            window._lastRoundId = apiRoundId;
            window._lastMultiplier = json?.data?.multiplier;
            await updateBoostConfig();
            await performBoost();
        }
    }, 10000);

})();
