// ==UserScript==
// @name         GoMining WS Tracker + Captcha/Bearer + RoundId Fusion (+ Fallback roundClosed)
// @version      2.1.0
// @author       CyrilG.
// @description  Intercepte WS, capture roundId direct depuis roundOpened, captcha/bearer, fallback API, monitoring robuste, + recovery roundClosed
// @match        https://app.gomining.com/*
// @run-at       document-start
// @grant        none
// @updateURL    https://github.com/CSCyril/GMMW_bot/raw/refs/heads/main/gm_tracker.user.js
// @downloadURL  https://github.com/CSCyril/GMMW_bot/raw/refs/heads/main/gm_tracker.user.js
// ==/UserScript==

(function () {
    const GAME_WS_SUBSTRING = "nft.ws.gomining.com";
    const WS_HEALTH_INTERVAL = 120_000;
    const WS_INIT_TIMEOUT = 60_000;
    const ROUND_CLOSED_FALLBACK_DELAY = 15_000;

    let _pendingRoundUpdate = false;
    let _roundClosedTimeout = null;
    window._myws_logs = window._myws_logs || [];

    // Derniers états globaux
    window._lastRoundId = null;
    window._lastMultiplier = null;
    window._lastCaptcha = null;
    window._lastBearer = null;
    window.__myws_jeu = null;

    function nowIso() {
        return new Date().toISOString().replace("T", " ").replace("Z", "");
    }

    function getBearer() {
        let t = localStorage.getItem('access_token');
        if (t) return t;
        let m = document.cookie.match(/access_token=([^;]+)/);
        return m ? m[1] : null;
    }

    async function updateRoundIdFromApi() {
        const bearer = getBearer();
        if (!bearer) {
            console.warn("[TM] Bearer introuvable (API backup impossible)");
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
            if (!resp.ok) {
                const txt = await resp.text();
                console.warn("[TM] Erreur HTTP API :", resp.status, txt);
                if (resp.status === 403 && txt.includes("JWT_TOKEN_EXPIRED")) {
                    console.warn("[TM] ❌ Token expiré → reload manuel nécessaire");
                }
                return;
            }
            const data = await resp.json();
            if (data?.data?.id) {
                window._lastRoundId = data.data.id;
                window._lastMultiplier = data.data.multiplier ?? null;
                console.log("[TM]", nowIso(), `- ✅ (API) roundId: ${window._lastRoundId}, multiplier: ${window._lastMultiplier}`);
            } else {
                console.warn("[TM] Réponse API inattendue :", data);
            }
        } catch (e) {
            console.warn("[TM] Erreur fetch / parse JSON API :", e);
        }
    }

    function processRoundOpenedPayload(payload) {
        try {
            if (!payload?.id) return;
            const newId = payload.id;
            if (window._lastRoundId !== newId) {
                window._lastRoundId = newId;
                window._lastMultiplier = payload.multiplier ?? null;
                console.log("[TM]", nowIso(), `- ⚡ (WS) roundId capté: ${window._lastRoundId}, multiplier: ${window._lastMultiplier}`);
            }
            // Si un roundOpened arrive, annule tout fallback en attente
            if (_roundClosedTimeout) {
                clearTimeout(_roundClosedTimeout);
                _roundClosedTimeout = null;
                console.log("[TM] ✅ Nouveau round détecté → fallback roundClosed annulé");
            }
        } catch (e) {
            console.warn("[TM] Erreur parse roundOpened payload:", e);
        }
    }

    function processRoundClosedPayload(payload) {
        console.log("[TM]", nowIso(), "- ⏳ roundClosed détecté, attente 20s avant fallback...");
        if (_roundClosedTimeout) clearTimeout(_roundClosedTimeout);
        const prevRound = window._lastRoundId;
        _roundClosedTimeout = setTimeout(() => {
            if (window._lastRoundId === prevRound) {
                console.warn("[TM] ⚠️ Aucun roundOpened détecté depuis roundClosed → fallback API");
                updateRoundIdFromApi();
            }
        }, ROUND_CLOSED_FALLBACK_DELAY);
    }

    function hookWebSocketPersistent() {
        const OldWS = window.WebSocket;
        class MyWebSocket extends OldWS {
            constructor(...args) {
                super(...args);
                try {
                    const url = args[0];
                    if (typeof url === "string" && url.includes(GAME_WS_SUBSTRING)) {
                        console.log("[TM] 🎯 WS du jeu détectée :", url);
                        window.__myws_jeu = this;
                        console.log("[TM] 🔗 Nouvelle __myws_jeu définie :", this.url);

                        this.addEventListener("message", async evt => {
                            window._myws_logs.push({ type: "recv", data: evt.data });

                            if (typeof evt.data !== "string" || !evt.data.startsWith("42[")) return;

                            // roundOpened
                            if (evt.data.startsWith('42["roundOpened"')) {
                                try {
                                    const arr = JSON.parse(evt.data.slice(2));
                                    if (arr?.[1]) processRoundOpenedPayload(arr[1]);
                                } catch (e) {
                                    console.warn("[TM] Erreur parse roundOpened JSON:", e);
                                }
                            }

                            // roundClosed
                            if (evt.data.startsWith('42["roundClosed"')) {
                                try {
                                    processRoundClosedPayload();
                                } catch (e) {
                                    console.warn("[TM] Erreur process roundClosed payload:", e);
                                }
                            }
                        });

                        this.addEventListener("close", evt => {
                            console.warn(`[TM] ❌ WS fermée code=${evt.code} reason=${evt.reason}`);
                            if (window.__myws_jeu === this) {
                                window.__myws_jeu = null;
                                console.warn("[TM] 🚫 __myws_jeu reset (WS fermée)");
                            }
                        });

                        this.addEventListener("error", evt => {
                            console.error("[TM] ⚠️ WS erreur :", evt);
                        });
                    }
                } catch (e) {
                    console.error("[TM] ⚠️ Erreur constructeur MyWebSocket :", e);
                }
            }

            send(data) {
                window._myws_logs.push({ type: "sent", data });
                if (typeof data === "string" && data.startsWith("40")) {
                    try {
                        const obj = JSON.parse(data.slice(2));
                        if (obj?.captcha && obj?.token?.startsWith("Bearer ")) {
                            window._lastCaptcha = obj.captcha;
                            window._lastBearer = obj.token;
                            console.log("[TM] 🔑 Captcha capté :", window._lastCaptcha);
                            console.log("[TM] 🔑 Bearer capté :", window._lastBearer);
                        }
                    } catch (e) {}
                }
                return super.send(data);
            }
        }

        window.WebSocket = MyWebSocket;
        window.WebSocket.prototype = OldWS.prototype;
        console.log("[TM] ✅ Hook WS permanent activé");
    }

    // === Init ===
    hookWebSocketPersistent();

    // Backup API après 4s pour init
    setTimeout(updateRoundIdFromApi, 4000);

    // Surveillance santé WS toutes les 2 min
    setInterval(() => {
        if (!window.__myws_jeu) {
            console.warn("[TM] 🚫 Pas de __myws_jeu actuellement");
        } else if (window.__myws_jeu.readyState !== 1) {
            console.warn("[TM] 🚫 __myws_jeu readyState =", window.__myws_jeu.readyState);
        } else {
            console.log("[TM] ✅ WS OK, state =", window.__myws_jeu.readyState);
        }
    }, WS_HEALTH_INTERVAL);

    // Reload si aucune WS détectée après 1 minute
    setTimeout(() => {
        if (!window.__myws_jeu) {
            console.error("[TM] ⏰ Toujours aucune WS détectée après 1 min → reload !");
            window.location.reload();
        }
    }, WS_INIT_TIMEOUT);
})();
