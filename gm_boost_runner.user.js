// ==UserScript==
// @name         GoMining Boost Runner
// @version      1.0
// @description  Active automatiquement les boosts en fonction du hashrate et du round en cours
// @author       CyrilG.
// @match        https://app.gomining.com/*
// @run-at       document-start
// @grant        none
// @updateURL    https://github.com/CSCyril/GMMW_bot/raw/refs/heads/main/gm_boost_runner.user.js
// @downloadURL  https://github.com/CSCyril/GMMW_bot/raw/refs/heads/main/gm_boost_runner.user.js
// ==/UserScript==

(function () {
    const GAME_WS_DOMAIN = "nft.ws.gomining.com";

    const clickDelays = JSON.parse(localStorage.getItem("gomining_click_delays") || "{}");
    const sequenceDelays = JSON.parse(localStorage.getItem("gomining_sequence_delays") || "{}");

    let currentGameWS = null;
    let lastSentRoundId = null;
    let roundLock = false;
    let currentBoostConfig = null;

    function nowIso() {
        return new Date().toISOString().replace("T", " ").replace("Z", "");
    }

    function uuidv4() {
        return ([1e7]+-1e3+-4e3+-8e3+-1e11).replace(/[018]/g, c =>
            (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16)
        );
    }

    function sleep(ms) {
      return new Promise(resolve => setTimeout(resolve, ms));
    }

    function getBearer() {
        let t = localStorage.getItem('access_token');
        if (t) return t;
        let m = document.cookie.match(/access_token=([^;]+)/);
        if (m) return m[1];
        return null;
    }

    async function getCurrentHashrateEhs() {
        try {
            const res = await fetch("https://api.blockchair.com/bitcoin/stats");
            const json = await res.json();
            const rate = json?.data?.hashrate_24h;
            return rate ? rate / 1e18 : null;
        } catch (e) {
            console.warn("[TM] ❌ Erreur récupération hashrate :", e);
            return null;
        }
    }

    async function updateBoostConfig() {
        const stored = localStorage.getItem("gomining_boost_config");
        if (!stored) {
            console.warn("[TM] ❌ Aucune config boost trouvée dans localStorage !");
            currentBoostConfig = null;
            return;
        }

        let parsed;
        try {
            parsed = JSON.parse(stored);
        } catch (e) {
            console.warn("[TM] ❌ Erreur de parsing de la config :", e);
            currentBoostConfig = null;
            return;
        }

        const now = new Date();
        const day = now.getDay(); // 0 = dimanche
        const hour = now.getHours();

        // Mardi 18h → samedi 8h inclus
        const useDefault =
            (day === 2 && hour >= 18) || // mardi soir
            (day > 2 && day < 6) ||      // mercredi à vendredi
            (day === 6 && hour < 8);     // samedi matin avant 8h

        const configSetName = useDefault ? "default" : "late";
        const selectedGroup = parsed?.[configSetName];

        if (!selectedGroup) {
            console.warn(`[TM] ❌ Config introuvable pour '${configSetName}'`);
            currentBoostConfig = null;
            return;
        }

        const hashrate = await getCurrentHashrateEhs();
        if (!hashrate) {
            console.warn("[TM] ⚠️ Hashrate indisponible → profil low");
            currentBoostConfig = selectedGroup?.low?.config ?? {};
            return;
        }

        for (const range of Object.values(selectedGroup)) {
            if (hashrate >= range.min && hashrate < range.max) {
                currentBoostConfig = range.config;
                console.log(`[TM] 📡 Hashrate = ${hashrate.toFixed(2)} EH/s → ${configSetName}.${range.min}-${range.max}`);
                return;
            }
        }

        currentBoostConfig = selectedGroup?.low?.config ?? {};
        console.warn(`[TM] ⚠️ Hashrate hors plage dans '${configSetName}' → fallback 'low'`);
    }


    function sendAbility(boostId, count, roundId) {
        if (!window.__myws_jeu || window.__myws_jeu.readyState !== 1) {
            console.warn("[TM] ❌ WebSocket jeu non prêt");
            return;
        }

        const delay = clickDelays[boostId] ?? 250;

        for (let i = 0; i < count; i++) {
            const payload = {
                abilityId: boostId,
                idempotencyKey: uuidv4(),
                roundId: roundId
            };

            const msg = "42" + JSON.stringify(["ability", payload]);
            const delayToApply = i * delay;

            setTimeout(() => {
                //window.__myws_jeu.send(msg);
                console.log(`[TM] ✅ Boost ${boostId} envoyé (${i + 1}/${count}) - delay ${delayToApply}ms`);
            }, delayToApply);
        }
    }

    async function performBoost() {
        const roundId = window._lastRoundId;
        const boostConfigSnapshot = currentBoostConfig;
        const multiplier = window._lastMultiplier;

        if (!roundId || roundId === lastSentRoundId || !boostConfigSnapshot || !multiplier) return;

        const actions = boostConfigSnapshot[multiplier];
        if (!actions || actions.length === 0) {
            console.log(`[TM] ℹ️ Aucun boost défini pour x${multiplier}`);
            return;
        }

        console.log(`[TM] 🚀 Séquence boost x${multiplier} (roundId ${roundId})`);

        for (let i = 0; i < actions.length; i++) {
            const { boostId, count } = actions[i];
            sendAbility(boostId, count, roundId);

            if (i < actions.length - 1) {
                const sequenceDelay = sequenceDelays[boostId] ?? 800;
                console.log(`[TM] ⏸️ Attente ${sequenceDelay}ms avant prochain boost...`);
                await sleep(sequenceDelay);
            }
        }

        lastSentRoundId = roundId;
    }

    function waitForGameWS(timeout = 10000) {
        return new Promise(resolve => {
            const start = Date.now();
            const interval = setInterval(() => {
                if (window.__myws_jeu && window.__myws_jeu.readyState === 1) {
                    clearInterval(interval);
                    console.log("[TM] ✅ __myws_jeu prêt");
                    resolve(true);
                } else if (Date.now() - start > timeout) {
                    clearInterval(interval);
                    console.warn("[TM] ⏳ Timeout d’attente WebSocket");
                    resolve(false);
                }
            }, 250);
        });
    }

    function listenToRoundOpened() {
        if (!window.__myws_jeu) {
            console.warn("[TM] ⏳ __myws_jeu non défini");
            return;
        }

        window.__myws_jeu.addEventListener("message", async evt => {
            if (typeof evt.data === "string" && evt.data.startsWith('42["roundOpened"')) {
                if (!roundLock) {
                    roundLock = true;
                    //await updateRoundIdFromApi();
                    await updateBoostConfig();

                    const delay = Math.random() * 1000 + 2000;
                    console.log(`[TM] ⏳ Attente ${delay.toFixed(0)}ms avant boost...`);
                    setTimeout(() => {
                        performBoost();
                        roundLock = false;
                    }, delay);
                }
            }
        });

        console.log("[TM] 🎧 Listener roundOpened attaché sur __myws_jeu");
    }


    (async () => {
        const ready = await waitForGameWS();
        if (!ready) return;

        listenToRoundOpened(); // ✅ démarre l'écoute dès que __myws_jeu est prêt
        updateBoostConfig();

        setInterval(() => {
            if (window.__myws_jeu?.readyState !== 1) {
                console.warn(`[TM] ❌ __myws_jeu fermé → reload forcé`);
                location.reload();
            }
        }, 300000); // vérifie toutes les 5 minutes
    })();
})();
