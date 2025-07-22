// ==UserScript==
// @name         GoMining BoostConfig Loader
// @version      1.0
// @description  Charge la configuration des boosts depuis un document externe
// @author       CyrilG.
// @match        https://app.gomining.com/*
// @grant        GM_xmlhttpRequest
// @connect      microbin.eu
// @updateURL    https://github.com/CSCyril/GMMW_bot/blob/main/gm_boostconfig_loader.user.js
// @downloadURL  https://github.com/CSCyril/GMMW_bot/blob/main/gm_boostconfig_loader.user.js
// ==/UserScript==

(function () {
    const CONFIG_URL = "https://pub.microbin.eu/raw/monkey-bat-snail";

    function resolveConfig(raw) {
        const { boostIds, timing, config } = raw;
        const clickDelays = {};
        const sequenceDelays = {};

        for (const key in timing) {
            if (timing[key].clickDelay) clickDelays[boostIds[key]] = timing[key].clickDelay;
            if (timing[key].sequenceDelay) sequenceDelays[boostIds[key]] = timing[key].sequenceDelay;
        }

        for (const group of Object.values(config)) {
            for (const range of Object.values(group)) {
                for (const multKey of Object.keys(range.config)) {
                    range.config[multKey] = range.config[multKey].map(entry => ({
                        boostId: boostIds[entry.boostId] || entry.boostId,
                        count: entry.count
                    }));
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
                console.log("[TM:Config] 📦 Boost config, delays enregistrés avec succès");
            } catch (e) {
                console.warn("[TM:Config] ❌ Erreur parsing config :", e);
            }
        },
        onerror: (err) => {
            console.warn("[TM:Config] ❌ Erreur HTTP config :", err);
        }
    });
})();
