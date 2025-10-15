// ==UserScript==
// @name         GoMining Boost Runner
// @version      2.1.0
// @description  Runner avec mélange humain des boosts et gestion optimisée des délais
// @match        https://app.gomining.com/*
// @run-at       document-start
// @grant        none
// @updateURL    https://github.com/CSCyril/GMMW_bot/raw/refs/heads/main/gm_boost_runner.user.js
// @downloadURL  https://github.com/CSCyril/GMMW_bot/raw/refs/heads/main/gm_boost_runner.user.js
// ==/UserScript__

(function () {
    const GAME_WS_DOMAIN = "nft.ws.gomining.com";
    const TEST_MODE = false; // Activer le mode test
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
    // anti-doublon spécifique au handler "roundOpened"
    let _lastRoundOpenedProcessedId = null;
    let _lastRoundOpenedProcessedTs = 0;

    function nowIso() {
        return new Date().toISOString().replace("T", " ").replace("Z", "");
    }

    function sleep(ms) {
        return new Promise(r => setTimeout(r, ms));
    }

    function uuidv4() {
        return ([1e7]+-1e3+-4e3+-8e3+-1e11).replace(/[018]/g, c =>
            (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16)
        );
    }

    function shuffle(arr) {
        for (let i = arr.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [arr[i], arr[j]] = [arr[j], arr[i]];
        }
    }

    function getLevelFromHashrate(hashrate, selectedGroupName) {
        const stored = localStorage.getItem("gomining_level_ranges");
        if (!stored) return "low";
        let parsedRanges;
        try { parsedRanges = JSON.parse(stored); } catch { return "low"; }
        const levels = parsedRanges?.[selectedGroupName];
        if (!levels) return "low";
        for (const [levelName, range] of Object.entries(levels)) {
            if (hashrate >= range.min && hashrate < range.max) {
                return levelName;
            }
        }
        return "low";
    }

    async function isWithinTimeRanges() {
        const storedTimeRanges = localStorage.getItem("gomining_time_ranges");
        if (!storedTimeRanges) return false;
        let parsedTimeRanges;
        try {
            parsedTimeRanges = JSON.parse(storedTimeRanges);
        } catch {
            return false;
        }
        const now = new Date();
        const day = now.getDay();
        const hour = now.getHours();
        const currentMinutes = now.getMinutes();
        const currentTime = hour * 60 + currentMinutes;
        const useDefault = (day === 2 && hour >= 18) || (day > 2 && day < 6) || (day === 6 && hour < 8);
        const selectedGroupName = useDefault ? "default" : "late";
        const multiplier = window._lastMultiplier;
        if (multiplier === null || multiplier === undefined) return false;
        const hashrate = await getCurrentHashrateEhs();
        const level = hashrate ? getLevelFromHashrate(hashrate, selectedGroupName) : "low";
        const timeRangeKey = `${selectedGroupName}_${level}_${multiplier}`;
        const timeRanges = parsedTimeRanges[timeRangeKey];
        if (!timeRanges || timeRanges.length === 0) return true;
        for (const range of timeRanges) {
            const [startHour, startMin] = range.start.split(':').map(Number);
            const [endHour, endMin] = range.end.split(':').map(Number);
            const startMinutes = startHour * 60 + startMin;
            const endMinutes = endHour * 60 + endMin;
            if (currentTime >= startMinutes && currentTime < endMinutes) {
                return true;
            }
        }
        console.log(`[TM] ⏰ Hors des plages horaires autorisées pour le multiplicateur ${multiplier} et le niveau ${level}.`);
        return false;
    }

    function setPendingBoost(roundId, multiplier) {
        localStorage.setItem("gomining_pending_boost", JSON.stringify({ roundId, multiplier, ts: Date.now() }));
    }

    function clearPendingBoost() {
        localStorage.removeItem("gomining_pending_boost");
    }

    function getPendingBoost() {
        const raw = localStorage.getItem("gomining_pending_boost");
        if (!raw) return null;
        try { return JSON.parse(raw); } catch { return null; }
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
                window._lastLeagueId = json.data.leagueId ?? null;
                console.log("[TM] ✅ roundId:", window._lastRoundId, ", multiplier:", window._lastMultiplier, ", league:", window._lastLeagueId);
            }
        } catch (e) {
            console.warn("[TM] ❌ API round/get-last failed:", e);
        }
    }

    async function getCurrentHashrateEhs() {
        try {
            const res = await fetch("https://api.blockchair.com/bitcoin/stats");
            const json = await res.json();
            return json?.data?.hashrate_24h ? json.data.hashrate_24h / 1e18 : null;
        } catch {
            return null;
        }
    }

    async function updateBoostConfig() {
        const stored = localStorage.getItem("gomining_boost_config");
        const storedTimeRanges = localStorage.getItem("gomining_time_ranges");
        if (!stored || !storedTimeRanges) return;
        let parsedConfig, parsedTimeRanges;
        try {
            parsedConfig = JSON.parse(stored);
            parsedTimeRanges = JSON.parse(storedTimeRanges);
        } catch { return; }
        const now = new Date();
        const day = now.getDay();
        const hour = now.getHours();
        const currentMinutes = now.getMinutes();
        const currentTime = hour * 60 + currentMinutes;
        const useDefault = (day === 2 && hour >= 18) || (day > 2 && day < 6) || (day === 6 && hour < 8);
        const selectedGroupName = useDefault ? "default" : "late";
        const multiplier = window._lastMultiplier;
        if (multiplier === null || multiplier === undefined) return;
        const hashrate = await getCurrentHashrateEhs();
        const level = hashrate ? getLevelFromHashrate(hashrate, selectedGroupName) : "low";
        const timeRangeKey = `${selectedGroupName}_${level}_${multiplier}`;
        const timeRanges = parsedTimeRanges[timeRangeKey];
        let isWithinTimeRange = false;
        if (timeRanges) {
            for (const range of timeRanges) {
                const [startHour, startMin] = range.start.split(':').map(Number);
                const [endHour, endMin] = range.end.split(':').map(Number);
                const startMinutes = startHour * 60 + startMin;
                const endMinutes = endHour * 60 + endMin;
                if (currentTime >= startMinutes && currentTime < endMinutes) {
                    isWithinTimeRange = true;
                    break;
                }
            }
        }
        if (!isWithinTimeRange) {
            console.log(`[TM] ⏰ Hors des plages horaires définies pour ${timeRangeKey}.`);
            return;
        }
        const boostConfigKey = `${selectedGroupName}_${level}_${multiplier}`;
        currentBoostConfig = parsedConfig[boostConfigKey]?.boosts ?? {};
    }

    function sendAbility(boostId, roundId) {
        const payload = { abilityId: boostId, idempotencyKey: uuidv4(), roundId };
        const msg = "42" + JSON.stringify(["ability", payload]);
        if (TEST_MODE) {
            console.log(`[TEST][${nowIso()}] boost ${boostId} (round ${roundId})`);
        } else {
            if (!window.__myws_jeu || window.__myws_jeu.readyState !== 1) return;
            window.__myws_jeu.send(msg);
            console.log(`[TM][${nowIso()}] ✅ Boost ${boostId} envoyé`);
        }
    }

    // NOUVELLES FONCTIONS POUR LE MÉLANGE HUMAIN
    function groupBoostsByTimeRange(boosts, rangeMs = 1000) {
        const groups = [];
        const sortedBoosts = [...boosts].sort((a, b) => a.timing.sequenceDelay - b.timing.sequenceDelay);

        for (const boost of sortedBoosts) {
            const delay = boost.timing.sequenceDelay;
            let foundGroup = false;

            for (const group of groups) {
                const firstDelay = group[0].timing.sequenceDelay;
                if (Math.abs(delay - firstDelay) <= rangeMs) {
                    group.push(boost);
                    foundGroup = true;
                    break;
                }
            }

            if (!foundGroup) {
                groups.push([boost]);
            }
        }

        return groups;
    }

    function expandBoostsToClicks(boosts) {
        const clicks = [];
        for (const boost of boosts) {
            for (let i = 0; i < boost.count; i++) {
                clicks.push({
                    boostId: boost.boostId,
                    clickDelay: boost.timing.clickDelay,
                });
            }
        }
        return clicks;
    }

    function prepareHumanLikeSequence(groups) {
        return groups.map(group => {
            const clicks = expandBoostsToClicks(group);
            shuffle(clicks);
            return {
                startDelay: group[0].timing.sequenceDelay,
                clicks: clicks,
            };
        });
    }

    async function sendMixedBoosts(groups, roundId) {
        for (const group of groups) {
            // Attendre le début de la plage (avec un léger bruit)
            const waitTime = Math.max(0, group.startDelay + (Math.random() * 1000 - 500)); // ±500 ms
            await sleep(waitTime);

            // Envoyer chaque clic avec son propre clickDelay + bruit
            for (const click of group.clicks) {
                sendAbility(click.boostId, roundId);

                // Attendre le clickDelay du boost actuel + bruit
                const delay = Math.max(50, click.clickDelay + (Math.random() * 200 - 100)); // ±100 ms
                await sleep(delay);
            }
        }
    }

    async function performBoost(multiplierOverride = null, manualRoundId = null, skipPriorityCheck = false) {
        const isWithinRanges = await isWithinTimeRanges();
        if (!isWithinRanges) {
            console.log(`[TM] ❌ Hors des plages horaires → Aucun boost ne sera joué.`);
            return;
        }
        const multiplier = multiplierOverride ?? window._lastMultiplier;
        const roundId = manualRoundId ?? window._lastRoundId;
        if (roundId === lastSentRoundId) {
            console.log(`[TM] ⚠️ Round ${roundId} déjà traité.`);
            return;
        }
        const boostConfigSnapshot = currentBoostConfig;
        if (!roundId || !boostConfigSnapshot || !multiplier) return;
        let actions = boostConfigSnapshot;
        if (!actions?.length) return;
        const priorityActions = actions.filter(a => (a.priority ?? 2) === 1);
        const otherActions = actions.filter(a => (a.priority ?? 2) !== 1);
        const mergedActions = {};
        [...priorityActions, ...otherActions].forEach(action => {
            const { boostId, count, timing, priority } = action;
            if (mergedActions[boostId]) {
                mergedActions[boostId].count += count;
                if (priority === 1) {
                    mergedActions[boostId].priority = 1;
                    mergedActions[boostId].timing = timing;
                }
            } else {
                mergedActions[boostId] = { ...action };
            }
        });
        const uniqueActions = Object.values(mergedActions);
        const finalPriorityActions = uniqueActions.filter(a => a.priority === 1);
        const finalOtherActions = uniqueActions.filter(a => a.priority !== 1);

        // ⚡ Exécuter uniquement les boosts prioritaires si skipPriorityCheck = true
        if (skipPriorityCheck && finalPriorityActions.length > 0) {
            console.log(`[${nowIso()}] ⚡ Boosts prioritaires x${multiplier} (roundId ${roundId}) — ${finalPriorityActions.length} actions`);
            for (const { boostId, count, timing } of finalPriorityActions) {
                const seqDelay = Math.max(50, (timing?.sequenceDelay ?? 0) + Math.random() * 750);
                await sleep(seqDelay);
                for (let j = 0; j < count; j++) {
                    const clickDelay = Math.max(50, (timing?.clickDelay ?? 250) + Math.random() * 500);
                    sendAbility(boostId, roundId);
                    await sleep(clickDelay);
                }
            }
        }

        // ⏳ Exécuter les non-prioritaires avec mélange humain
        if (!skipPriorityCheck && finalOtherActions.length > 0) {
            setPendingBoost(roundId, multiplier);
            console.log(`[${nowIso()}] ⏳ Boosts non-prioritaires x${multiplier} (roundId ${roundId}) — ${finalOtherActions.length} actions (mélange humain)`);

            // Regrouper et mélanger les boosts
            const groups = groupBoostsByTimeRange(finalOtherActions, 1000);
            const mixedGroups = prepareHumanLikeSequence(groups);

            // Envoyer les boosts mélangés
            await sendMixedBoosts(mixedGroups, roundId);

            lastSentRoundId = roundId;
            clearPendingBoost();
        }
    }

    // --- Replay au reload ---
    (async function checkPending() {
        const pend = getPendingBoost();
        if (!pend) return;
        console.log("[TM] 🔁 Pending boost trouvé :", pend);
        await updateRoundIdFromApi();
        await updateBoostConfig();
        if (pend.roundId === window._lastRoundId) {
            console.log("[TM] ➡️ Premier round après reload, reprise du pending boost", pend.roundId);
            await performBoost(pend.multiplier, pend.roundId, true);
            clearPendingBoost();
        } else {
            console.log("[TM] ➡️ Pending boost pour round antérieur, on peut ignorer ou traiter selon logique");
            clearPendingBoost();
        }
    })();

    // --- WS interception ---
    if (!TEST_MODE) {
        const originalWebSocket = window.WebSocket;
        window.WebSocket = function (url, protocols) {
            const ws = protocols ? new originalWebSocket(url, protocols) : new originalWebSocket(url);
            if (url.includes(GAME_WS_DOMAIN)) {
                console.log("[TM] 🎮 WS interceptée :", url);
                window.__myws_jeu = ws;
                ws.addEventListener("message", evt => {
                    if (evt.data.startsWith('42["roundOpened"')) {
                        try {
                            const payload = JSON.parse(evt.data.slice(2));
                            const roundInfo = payload[1];
                            const newRoundId = roundInfo?.id;
                            const now = Date.now();

                            if (_lastRoundOpenedProcessedId === newRoundId && (now - _lastRoundOpenedProcessedTs) < 3000) {
                                console.log(`[TM] ⚠️ roundOpened doublon rapproché ignoré (roundId=${newRoundId})`);
                                return;
                            }
                            _lastRoundOpenedProcessedId = newRoundId;
                            _lastRoundOpenedProcessedTs = now;
                            window._lastRoundId = newRoundId;
                            window._lastLeagueId = roundInfo?.leagueId ?? null;
                            lastObservedRoundId = newRoundId;
                            console.log(`[TM] 🎯 roundOpened leagueId=${window._lastLeagueId}, roundId=${newRoundId}`);
                        } catch (e) {
                            console.warn("[TM] ⚠️ Impossible de parser roundOpened:", e);
                            window._lastLeagueId = null;
                        }

                        console.log(`[TM] 🔍 Nouveau round. Exécution des boosts prioritaires...`);
                        (async () => {
                            await updateBoostConfig();
                            await performBoost(null, null, true);
                        })();

                        if (window._lastLeagueId === 1) {
                            if (roundLock) return;
                            roundLock = true;
                            playerPlayed = false;
                            roundStartTimeout = setTimeout(async () => {
                                if (!playerPlayed) {
                                    console.log(`[TM] ⏳ Aucun joueur surveillé → Boosts non-prioritaires autorisés.`);
                                    await performBoost();
                                } else {
                                    console.log(`[TM] ❌ Joueur surveillé a joué → Boosts non-prioritaires annulés.`);
                                }
                            }, 30000);
                        } else {
                            (async () => {
                                console.log(`[TM] ⚡ League ≠ 1 → exécution immédiate des boosts non-prioritaires`);
                                await performBoost();
                            })();
                        }
                    }
                    if (evt.data.startsWith('42["winner"')) {
                        console.log(`[TM] 🏆 Winner détecté → fin du round.`);
                        if (roundStartTimeout) {
                            clearTimeout(roundStartTimeout);
                            roundStartTimeout = null;
                        }
                        roundLock = false;
                    }
                    if (evt.data.startsWith('42["abilityUsage"')) {
                        try {
                            const data = JSON.parse(evt.data.slice(2));
                            const userAlias = data[1]?.userAlias;
                            if (userAlias && PLAYERS_TO_WATCH.includes(userAlias)) {
                                playerPlayed = true;
                                console.log(`[TM] ⚠️ ${userAlias} a joué ! Les boosts non-prioritaires seront annulés.`);
                            }
                        } catch (e) {
                            console.warn("[TM] Erreur analyse message WS :", e);
                        }
                    }
                });
            }
            return ws;
        };
        window.WebSocket.prototype = originalWebSocket.prototype;
    }

    // --- Observer sur roundId global ---
    const roundObserver = new MutationObserver(() => {
        if (window._lastRoundId && window._lastRoundId !== lastObservedRoundId) {
            lastObservedRoundId = window._lastRoundId;
            if (isFirstRound) {
                console.log(`[TM] ⏭ Premier roundId ${lastObservedRoundId} ignoré (démarrage script).`);
                isFirstRound = false;
                return;
            }
            triggerBoost("RoundWatcher");
        }
    });

    setInterval(() => {
        if (window._lastRoundId && window._lastRoundId !== lastObservedRoundId) {
            lastObservedRoundId = window._lastRoundId;
            if (isFirstRound) {
                console.log(`[TM] ⏭ Premier roundId ${lastObservedRoundId} ignoré (démarrage script).`);
                isFirstRound = false;
                return;
            }
            triggerBoost("RoundWatcher");
        }
    }, 500);

    async function triggerBoost(source) {
        if (roundLock) return;
        if (source === "RoundWatcher" && window._lastRoundId === lastSentRoundId) {
            console.log(`[TM] ⚠️ Round ${window._lastRoundId} déjà traité via WS, ignoré.`);
            return;
        }
        roundLock = true;
        await updateBoostConfig();
        console.log(`[TM] 🔔 Déclenchement via ${source}, roundId=${window._lastRoundId}`);
        try {
            await performBoost();
        } catch (e) {
            console.error("[TM] Erreur performBoost:", e);
        } finally {
            roundLock = false;
        }
    }

    // --- Init ---
    updateBoostConfig().then(() => {
        console.log(TEST_MODE ? "[TEST MODE] Runner prêt." : "[TM] Runner prêt pour prod.");
    });

    // Fonction pour le mode test
    function simulateRound(mult) {
        if (!TEST_MODE) {
            console.log("Le mode test doit être activé pour utiliser simulateRound.");
            return;
        }
        window._lastRoundId = "test_round_id";
        window._lastMultiplier = mult;
        console.log(`[TEST] Simulation d'un round avec le multiplicateur ${mult}`);
        performBoost(mult, "test_round_id", true);
    }

    window.simulateRound = simulateRound;
})();
