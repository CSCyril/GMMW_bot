// ==UserScript==
// @name         GoMining WS + RoundId Tracker (Debug WS State)
// @version      1.3
// @description  Écoute permanente du WS, update roundId, __myws_jeu et logs debug sans reload auto
// @author       CyrilG.
// @match        https://app.gomining.com/*
// @run-at       document-start
// @grant        none
// ==/UserScript==

(function () {
    const GAME_WS_SUBSTRING = "nft.ws.gomining.com";
    let _pendingRoundUpdate = false;

    window._lastRoundId = null;
    window._lastMultiplier = null;
    window._lastSentRoundId = null;
    window.__myws_jeu = null;

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
            const txt = await resp.text();
            if (!resp.ok) {
                console.warn("[TM] Erreur HTTP API :", resp.status, txt);
                if (resp.status === 403 && txt.includes("JWT_TOKEN_EXPIRED")) {
                    console.warn("[TM] ❌ Token expiré → reload manuel nécessaire");
                }
                return;
            }
            const data = JSON.parse(txt);
            if (data?.data?.id) {
                _lastRoundId = data.data.id;
                window._lastRoundId = data.data.id;
                _lastMultiplier = data.data.multiplier ?? null;
                window._lastMultiplier = data.data.multiplier ?? null;
                console.log("[TM]", nowIso(), `- ✅ roundId: ${window._lastRoundId}, multiplier: ${window._lastMultiplier}`);
            } else {
                console.warn("[TM] Réponse inattendue :", data);
            }
        } catch (e) {
            console.warn("[TM] Erreur fetch / parse JSON :", e);
        }
    }

    function hookWebSocketPersistent() {
        const OldWS = window.WebSocket;
        const trackedWS = new Map();

        class MyWebSocket extends OldWS {
            constructor(...args) {
                super(...args);
                try {
                    const url = args[0];
                    if (typeof url === "string" && url.includes(GAME_WS_SUBSTRING)) {
                        console.log("[TM] 🎯 WS du jeu détectée :", url);
                        trackedWS.set(this, { url, createdAt: nowIso() });

                        // ✅ Toujours définir __myws_jeu sur la dernière WS capturée
                        window.__myws_jeu = this;
                        console.log("[TM] 🔗 Nouvelle __myws_jeu définie :", this.url);

                        // Message listener
                        this.addEventListener('message', async evt => {
                            //console.log("[TM] 📩 WS message reçu :", evt.data.slice(0, 100), evt.data.length > 100 ? "..." : "");
                            if (typeof evt.data === "string" && evt.data.startsWith('42["roundOpened"')) {
                                console.log("[TM] ⚡ roundOpened détecté, mise à jour roundId...");
                                if (!_pendingRoundUpdate) {
                                    _pendingRoundUpdate = true;
                                    await updateRoundIdFromApi();
                                    _pendingRoundUpdate = false;
                                } else {
                                    console.log("[TM] 🔄 Update déjà en cours, skip");
                                }
                            }
                        });

                        // Close listener
                        this.addEventListener('close', evt => {
                            console.warn(`[TM] ❌ WS fermée (${url}) code=${evt.code} reason=${evt.reason}`);
                            trackedWS.delete(this);

                            // 🔎 Si c’était la WS courante → on vide __myws_jeu
                            if (window.__myws_jeu === this) {
                                console.warn("[TM] 🚫 __myws_jeu était cette WS, on la supprime");
                                window.__myws_jeu = null;
                            }
                        });

                        // Error listener
                        this.addEventListener('error', evt => {
                            console.error("[TM] ⚠️ WS erreur :", evt);
                        });

                        console.log("[TM] WS readyState initial =", this.readyState);
                    }
                } catch (e) {
                    console.error("[TM] ⚠️ Erreur constructeur MyWebSocket :", e);
                }
            }
        }

        window.WebSocket = MyWebSocket;
        window.WebSocket.prototype = OldWS.prototype;

        console.log("[TM] ✅ Hook WS permanent activé");
    }

    // === Init ===
    hookWebSocketPersistent();

    // Update initial après 4s
    setTimeout(updateRoundIdFromApi, 4000);

    // Surveillance santé WS toutes les 2 min (debug, sans reload auto)
    setInterval(() => {
        if (!window.__myws_jeu) {
            console.warn("[TM] 🚫 Pas de __myws_jeu actuellement");
        } else if (window.__myws_jeu.readyState !== 1) {
            console.warn("[TM] 🚫 __myws_jeu readyState =", window.__myws_jeu.readyState);
        } else {
            console.log("[TM] ✅ WS OK, state =", window.__myws_jeu.readyState);
        }
    }, 120000);
})();
