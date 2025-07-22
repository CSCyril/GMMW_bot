// ==UserScript==
// @name         GoMining WS + RoundId Tracker
// @version      1.0
// @description  Fonction principale dédiée à l'écoute du socket et à la mise à jour des rounds
// @author       CyrilG.
// @match        https://app.gomining.com/*
// @run-at       document-start
// @grant        none
// @updateURL    https://github.com/CSCyril/GMMW_bot/raw/refs/heads/main/gm_tracker.user.js
// @downloadURL  https://github.com/CSCyril/GMMW_bot/raw/refs/heads/main/gm_tracker.user.js
// ==/UserScript==

(function () {
    const GAME_WS_SUBSTRING = "nft.ws.gomining.com";
    let _pendingRoundUpdate = false;

    window._lastRoundId = null;
    window._lastMultiplier = null;
    window._lastSentRoundId = null;

    function nowIso() {
        return new Date().toISOString().replace("T", " ").replace("Z", "");
    }

    function getBearer() {
        let t = localStorage.getItem('access_token');
        if (t) return t;
        let m = document.cookie.match(/access_token=([^;]+)/);
        if (m) return m[1];
        return null;
    }

    async function updateRoundIdFromApi() {
        const bearer = getBearer();
        if (!bearer) {
            console.warn("[TM] Bearer introuvable !");
            return;
        }
        const url = "https://api.gomining.com/api/nft-game/round/get-last";
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
        const txt = await resp.text();
        if (!resp.ok) {
            console.warn("[TM] Erreur HTTP API :", resp.status, txt);
            if (resp.status === 403 && txt.includes("JWT_TOKEN_EXPIRED")) {
                console.warn("[TM] ❌ Token expiré → reload...");
                setTimeout(() => location.reload(), 1500);
            }
            return;
        }
        try {
            const data = JSON.parse(txt);
            if (data && data.data && data.data.id) {
                _lastRoundId = data.data.id;
                _lastMultiplier = data.data.multiplier ?? null;
                console.log("[TM]", nowIso(), `- ✅ roundId: ${_lastRoundId}, multiplier: ${_lastMultiplier}`);
            } else {
                console.warn("[TM] Réponse inattendue :", data);
            }
        } catch (e) {
            console.warn("[TM] Erreur parse JSON :", e);
        }
    }

    function hookWebSocket() {
        const OldWS = window.WebSocket;
        window.WebSocket = function (...args) {
            const ws = new OldWS(...args);

            try {
                if (typeof args[0] === "string" && args[0].includes(GAME_WS_SUBSTRING)) {
                    console.log("[TM] 🎯 Tentative de capture WS :", args[0]);

                    if (!window.__myws_jeu || window.__myws_jeu.readyState !== 1) {
                        window.__myws_jeu = ws;
                        console.log("[TM] ✅ WS du jeu capturée :", ws.url);

                        ws.addEventListener('message', async evt => {
                            if (typeof evt.data === "string" && evt.data.startsWith('42["roundOpened"')) {
                                if (!_pendingRoundUpdate) {
                                    _pendingRoundUpdate = true;
                                    await updateRoundIdFromApi();
                                    _pendingRoundUpdate = false;
                                }
                            }
                        });
                    }
                }
            } catch (e) {
                console.warn("[TM] ⚠️ Erreur hook WS :", e);
            }

            return ws;
        };
        window.WebSocket.prototype = OldWS.prototype;
    }

    // === Init ===
    hookWebSocket();
    setTimeout(updateRoundIdFromApi, 4000);
    setInterval(hookWebSocket, 10000); // relance toutes les 10s au cas où le WS arrive après
      setInterval(() => {
        if (window.__myws_jeu && window.__myws_jeu.readyState !== 1) {
            console.warn(`[TM] ❌ __myws_jeu readyState = ${window.__myws_jeu.readyState} → reload forcé`);
            location.reload();
        }
    }, 300000); // vérifie toutes les 5 minutes
})();
