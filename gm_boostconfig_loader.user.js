// ==UserScript==
// @name         GoMining BoostConfig Loader
// @version      1.3
// @description  Charge la configuration des boosts depuis un document externe (nouvelle structure avec timing inline)
// @author       CyrilG.
// @match        https://app.gomining.com/*
// @grant        GM_xmlhttpRequest
// @connect      githubusercontent.com
// @updateURL    https://github.com/CSCyril/GMMW_bot/raw/refs/heads/main/gm_boostconfig_loader.user.js
// @downloadURL  https://github.com/CSCyril/GMMW_bot/raw/refs/heads/main/gm_boostconfig_loader.user.js
// ==/UserScript==

(function () {
    const CONFIG_URL = "https://raw.githubusercontent.com/CSCyril/GMMW_bot/refs/heads/main/config";

    function resolveConfig(raw) {
        const { boostIds, config } = raw;
        const clickDelays = {};
        const sequenceDelays = {};

        for (const group of Object.values(config)) {
            for (const level of Object.values(group)) {
                for (const multKey of Object.keys(level.config)) {
                    level.config[multKey] = level.config[multKey].map(entry => {
                        const originalId = entry.boostId;
                        const uuid = boostIds[originalId] || originalId;

                        if (entry.timing) {
                            clickDelays[uuid] = entry.timing.clickDelay;
                            sequenceDelays[uuid] = entry.timing.sequenceDelay;
                            delete entry.timing;
                        }

                        return {
                            boostId: uuid,
                            count: entry.count
                        };
                    });
                }
            }
        }

        return { boostConfig: config, clickDelays, sequenceDelays };
    }

    GM_xmlhttpRequest({
        method: "GET",
        url: CONFIG_URL,
        headers: { "Accept": "application/json" },
        onload: (res) => {
            try {
                const raw = JSON.parse(res.responseText);
                const parsed = resolveConfig(raw);
                localStorage.setItem("gomining_boost_config", JSON.stringify(parsed.boostConfig));
                localStorage.setItem("gomining_click_delays", JSON.stringify(parsed.clickDelays));
                localStorage.setItem("gomining_sequence_delays", JSON.stringify(parsed.sequenceDelays));
                console.log("[TM:Config] 📦 Boost config (new format) enregistrée avec succès");
            } catch (e) {
                console.warn("[TM:Config] ❌ Erreur parsing config :", e);
            }
        },
        onerror: (err) => {
            console.warn("[TM:Config] ❌ Erreur HTTP config :", err);
        }
    });
})();
