// ==UserScript==
// @name         GoMining Participants Abilities Tracker + Power + EE + PUP + Avatar Discount
// @namespace    http://tampermonkey.net/
// @version      3.0
// @description  Track participants abilities, calculate power, EE, PPS, PUP, and apply avatar discount
// @author       CyrilG.
// @match        https://app.gomining.com/*
// @grant        GM_xmlhttpRequest
// @grant        unsafeWindow
// @updateURL    https://github.com/CSCyril/GMMW_bot/raw/refs/heads/main/gm_abilities_tracker.user.js
// @downloadURL  https://github.com/CSCyril/GMMW_bot/raw/refs/heads/main/gm_abilities_tracker.user.js
// ==/UserScript==

(function() {
    'use strict';

    function getAccessToken() {
        const match = document.cookie.match(/(?:^|;\s*)access_token=([^;]+)/);
        return match ? match[1] : null;
    }

    function postRequest(url, data, token) {
        return new Promise((resolve) => {
            GM_xmlhttpRequest({
                method: "POST",
                url: url,
                data: JSON.stringify(data),
                headers: {
                    "accept": "application/json, text/plain, */*",
                    "content-type": "application/json",
                    "authorization": "Bearer " + token,
                    "origin": "https://app.gomining.com",
                    "referer": "https://app.gomining.com/",
                    "x-device-type": "desktop",
                    "cookie": "access_token=" + token
                },
                onload: function(response) {
                    try { resolve(JSON.parse(response.responseText)); }
                    catch(e) { console.error("❌ JSON parse error:", e); resolve(null); }
                },
                onerror: function(err) { console.error("❌ Network error:", err); resolve(null); }
            });
        });
    }

    async function fetchAllRoundIds(cycleId, leagueId = 4) {
        const token = getAccessToken();
        if (!token) return [];

        const limit = 50;
        let skip = 0;
        let allIds = [];

        const firstPage = await postRequest(
            "https://api.gomining.com/api/nft-game/round/find-by-cycleId",
            { cycleId, multipliers: [1,2,4,8,16,32,64], pagination: {limit, skip, count:0}, leagueId },
            token
        );

        const total = firstPage?.data?.count || 0;
        allIds.push(...firstPage.data.array.map(it => it.id));

        for(skip = limit; skip < total; skip += limit) {
            const page = await postRequest(
                "https://api.gomining.com/api/nft-game/round/find-by-cycleId",
                { cycleId, multipliers: [1,2,4,8,16,32,64], pagination: {limit, skip, count:0}, leagueId },
                token
            );
            if(Array.isArray(page.data.array)) allIds.push(...page.data.array.map(it => it.id));
        }

        return allIds;
    }

    async function fetchAbilitiesPriceMap() {
        const token = getAccessToken();
        if (!token) return {};

        const response = await postRequest("https://api.gomining.com/api/nft-game/nft-game-ability/find-all", {}, token);
        const array = response?.data?.array || [];
        const priceMap = {};
        array.forEach(a => priceMap[a.id] = { priceInGMT: a.priceInGMT || 0, name: a.name || "Unknown" });
        return priceMap;
    }

    async function fetchClanData(clanId) {
        const token = getAccessToken();
        if (!token) return null;
        return await postRequest(
            "https://api.gomining.com/api/nft-game/clan/get-by-id",
            { clanId, pagination:{limit:50, skip:0, count:0}, filters:{filterType:"none"}, sort:{sortType:"none"} },
            token
        );
    }

    function getUserStatsFromClan(clanData, userId) {
        const user = clanData?.data?.usersForClient?.find(u => u.id === userId);
        return {
            power: user?.power || 0,
            ee: user?.ee || 0,
            avatar: user?.avatar || null
        };
    }

    async function getParticipantsAbilities(cycleId, filterNames = [], leagueId = 4) {
        const token = getAccessToken();
        if (!token) return [];

        const roundIds = await fetchAllRoundIds(cycleId, leagueId);
        console.log(`📦 Total rounds: ${roundIds.length} (league ${leagueId})`);

        const priceMap = await fetchAbilitiesPriceMap();
        const participantsMap = {}; // { userId -> { alias, clanId, abilities } }

        for(const roundId of roundIds) {
            const leaderboard = await postRequest(
                "https://api.gomining.com/api/nft-game/round/user-leaderboard",
                { roundId, pagination: { limit: 20, skip: 0, count: 0 } },
                token
            );

            if(leaderboard?.data?.participants) {
                for(const p of leaderboard.data.participants) {
                    const userId = p.user.id;
                    const alias = p.user.alias;
                    const clanId = p.clan?.id;

                    if(filterNames.length && !filterNames.includes(alias)) continue;

                    if(!participantsMap[userId]) participantsMap[userId] = { alias, clanId, abilities: {} };

                    for(const ability of p.usedAbilities) {
                        const id = ability.nftGameAbilityId;
                        const count = ability.count || 0;
                        participantsMap[userId].abilities[id] = (participantsMap[userId].abilities[id] || 0) + count;
                    }
                }
            }
            console.log(`✅ Round ${roundId} traité`);
        }

        const result = [];
        for(const [userId, pData] of Object.entries(participantsMap)) {
            const clanData = await fetchClanData(pData.clanId);
            const { power, ee, avatar } = getUserStatsFromClan(clanData, parseInt(userId));

            const pps = ee ? (power * 28) / ee : 0;
            const pup = (pps / 18) * 0.7;

            const detailedAbilities = Object.entries(pData.abilities).map(([id, count]) => {
                let priceInGMT = priceMap[id]?.priceInGMT || 0;
                const abilityName = priceMap[id]?.name || id;

                if(abilityName === "Power Up Boost") priceInGMT = pup;

                if(avatar) priceInGMT *= 0.8; // 20% discount si avatar présent

                return { name: abilityName, count, priceInGMT, totalPrice: priceInGMT * count };
            });

            const totalGMT = detailedAbilities.reduce((sum, a) => sum + a.totalPrice, 0);

            result.push({
                userId: parseInt(userId),
                name: pData.alias,
                clanId: pData.clanId,
                power,
                ee,
                pps,
                pup: avatar ? pup * 0.8 : pup, // applique aussi remise à pup si avatar
                avatar,
                abilities: detailedAbilities,
                totalGMT
            });
        }

        console.log("🎯 Résultat final:", result);
        return result;
    }

    unsafeWindow.getParticipantsAbilities = getParticipantsAbilities;
    console.log("🔧 Utilise getParticipantsAbilities(cycleId, [names], leagueId) pour lancer le calcul filtré avec power, ee, pps, pup et avatar discount");
})();
