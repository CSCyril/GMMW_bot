// ==UserScript==
// @name         GoMining Boost Runner - Prod + Test Fusion
// @version      1.8.2
// @description  Runner fusion Prod/Test avec FLAG TEST_MODE
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

    function nowIso() { return new Date().toISOString().replace("T", " ").replace("Z", ""); }

    function uuidv4() {
        return ([1e7]+-1e3+-4e3+-8e3+-1e11).replace(/[018]/g, c =>
            (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16)
        );
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
        } catch (e) {
            console.warn("[TM] ❌ API round/get-last failed:", e);
        }
    }
    
    function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

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

    function getBearer() {
        let t = localStorage.getItem('access_token');
        if (t) return t;
        let m = document.cookie.match(/access_token=([^;]+)/);
        return m ? m[1] : null;
    }

    async function getCurrentHashrateEhs() {
        try {
            const res = await fetch("https://api.blockchair.com/bitcoin/stats");
            const json = await res.json();
            const rate = json?.data?.hashrate_24h;
            return rate ? rate / 1e18 : null;
        } catch (e) { console.warn("[TM] Erreur récupération hashrate:", e); return null; }
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
        console.log(`[TM] Boost config chargée via updateBoostConfig()`);
    }

    function getRandomClickDelay(baseClick) {
        return Math.max(50, baseClick + Math.random() * 2000);
    }

    function sendAbility(boostId, count, roundId, clickDelay = 250) {
        for (let i = 0; i < count; i++) {
            const payload = { abilityId: boostId, idempotencyKey: uuidv4(), roundId };
            const msg = "42" + JSON.stringify(["ability", payload]);
            const delayToApply = i * clickDelay;
            setTimeout(() => {
                if (TEST_MODE) {
                    console.log(`[TEST][${nowIso()}] boost ${boostId} x1 (round ${roundId})`);
                } else {
                    if (!window.__myws_jeu || window.__myws_jeu.readyState !== 1) return;
                    window.__myws_jeu.send(msg);
                    console.log(`[TM][${nowIso()}] ✅ Boost ${boostId} envoyé (${i+1}/${count})`);
                }
            }, delayToApply);
        }
    }

    async function performBoost(multiplierOverride = null, manualRoundId = null) {
        const multiplier = multiplierOverride ?? window._lastMultiplier;
        const roundId = manualRoundId ?? window._lastRoundId;
        const boostConfigSnapshot = currentBoostConfig;
        if (!roundId || roundId === lastSentRoundId || !boostConfigSnapshot || !multiplier) return;

        let actions = boostConfigSnapshot[multiplier];
        if (!actions?.length) return;

        actions = applyPriorityOrder(actions);
        console.log(`[${nowIso()}] Séquence boost x${multiplier} (roundId ${roundId}) — ${actions.length} actions`);

        for (let i = 0; i < actions.length; i++) {
            const { boostId, count, timing } = actions[i];
            const baseClick = timing?.clickDelay ?? 250;
            const baseSeq = timing?.sequenceDelay ?? 0;

            // sequenceDelay ± 15s
            const sequenceDelay = Math.max(50, baseSeq*1000 + (Math.random() * 15000));
            await sleep(sequenceDelay);

            // envoyer chaque clic avec clickDelay aléatoire individuel
            for (let j = 0; j < count; j++) {
                const clickDelay = Math.max(50, baseClick + Math.random() * 2000);
                sendAbility(boostId, 1, roundId, clickDelay);
                await sleep(clickDelay);
            }
        }
        lastSentRoundId = roundId;
    }

    // --- WebSocket prod only ---
    if (!TEST_MODE) {
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
                                const delay = Math.random()*2000 + 3000;
                                console.log(`[TM] ⏳ Attente ${delay.toFixed(0)}ms avant boost...`);
                                const failSafeTimeout = setTimeout(() => { location.reload(); }, 10000);
                                setTimeout(async () => {
                                    try { await performBoost(); clearTimeout(failSafeTimeout); }
                                    catch(e){ console.error("[TM] Erreur performBoost:", e); location.reload(); }
                                    finally { roundLock = false; }
                                }, delay);
                            })();
                        }
                    }

                    if (typeof userOnMessage === "function") {
                        try { userOnMessage.call(ws, evt); } catch(e){ console.warn("[TM] Erreur onmessage utilisateur:", e); }
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
                window._lastRoundId = apiRoundId;
                window._lastMultiplier = json?.data?.multiplier;
                await updateBoostConfig();
                await performBoost();
            }
        }, 10000);
    }

    // --- Fonctions Test mode ---
    if (TEST_MODE) {
        window.runBoost = async function(multiplier) {
            if (!currentBoostConfig) {
                console.warn("[TEST] Boost config non chargée. Lancez updateBoostConfig() d'abord.");
                return;
            }
            const roundId = Date.now();
            console.log(`[TEST CMD] Déclenchement manuel x${multiplier} (roundId=${roundId})`);
            await performBoost(multiplier, roundId);
        };

        window.listBoosts = function() {
            if (!currentBoostConfig) {
                console.warn("[TEST] Boost config non chargée.");
                return;
            }
            console.log("[TEST] Multiplicateurs disponibles :", Object.keys(currentBoostConfig));
        };
    }

    // --- Init ---
    updateBoostConfig().then(() => {
        console.log(TEST_MODE ? "[TEST MODE] Runner prêt. Utilisez runBoost(mult) depuis la console." : "[TM] Runner prêt pour prod.");
        if (TEST_MODE) window.listBoosts();
    });

})();
